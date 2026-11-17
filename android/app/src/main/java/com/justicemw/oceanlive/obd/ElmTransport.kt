package com.justicemw.oceanlive.obd

import com.justicemw.oceanlive.R
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.PowerManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

data class FoundAdapter(val address: String, val name: String, val rssi: Int)

/** The device connected but has no characteristic pair an OBD adapter would use. */
class NotObdAdapter(message: String) : IllegalStateException(message)

/**
 * Talks to an ELM327-style Bluetooth LE OBD adapter (vLinker, OBDLink CX,
 * generic clones). Works out the adapter's UART service by looking for a
 * characteristic pair that can notify and be written, so it doesn't depend
 * on any one vendor's UUIDs.
 */
@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
class ElmTransport(context: Context) {
    private val appContext = context.applicationContext
    private val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter

    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    private var ready: CompletableDeferred<Unit>? = null
    private var reply: CompletableDeferred<String>? = null
    private val buffer = StringBuilder()
    private val lock = Any()
    private val commandMutex = Mutex()
    private var scanCallback: ScanCallback? = null

    /** Called (on a Bluetooth thread) if the adapter drops the connection. */
    var onDisconnected: (() -> Unit)? = null

    val bluetoothOn: Boolean get() = adapter?.isEnabled == true
    val connected: Boolean get() = writeChar != null

    /** Lists advertising adapters until [stopScan]. [onFailed] gets Android's error code if the search couldn't run. */
    fun startScan(onFound: (FoundAdapter) -> Unit, onFailed: (Int) -> Unit) {
        stopScan()
        val scanner = adapter?.bluetoothLeScanner ?: return
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                found(result)?.let(onFound)
            }

            override fun onScanFailed(errorCode: Int) {
                // Only this search's own failure; a newer search may have replaced it.
                if (scanCallback !== this) return
                stopScan()
                onFailed(errorCode)
            }
        }
        scanCallback = callback
        scanner.startScan(null, scanSettings(), callback)
    }

    /**
     * One search that ends at the first adapter [stopAt] accepts, or after [timeoutMs]. Returns
     * that adapter, or null. Only listens: nothing is connected and nothing reaches the car.
     * The search is always stopped before this returns, unless a newer one has taken over.
     * With the screen off it only looks for adapters advertising one of [names].
     */
    suspend fun scanOnce(timeoutMs: Long, names: Set<String>, stopAt: (FoundAdapter) -> Boolean): FoundAdapter? {
        stopScan()
        // Android pauses a search without a filter while the screen is off (a locked phone, Android Auto),
        // so search by name then. With the screen on, list everything as Find adapter does and let
        // stopAt check the name: some phones' name filters miss a name sent only in the scan response.
        val filters = if (screenOn() || names.isEmpty()) null else names.map { ScanFilter.Builder().setDeviceName(it).build() }
        val scanner = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner ?: return null
        val result = CompletableDeferred<FoundAdapter?>()
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, r: ScanResult) {
                val a = found(r) ?: return
                if (stopAt(a)) result.complete(a)
            }

            override fun onScanFailed(errorCode: Int) {
                result.complete(null)
            }
        }
        scanCallback = callback
        try {
            scanner.startScan(filters, scanSettings(), callback)
            return withTimeoutOrNull(timeoutMs) { result.await() }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            // Bluetooth turned off as the search started.
            return null
        } finally {
            if (scanCallback === callback) stopScan()
        }
    }

    private fun found(result: ScanResult): FoundAdapter? {
        val name = result.scanRecord?.deviceName ?: result.device.name
        if (name.isNullOrBlank()) return null
        return FoundAdapter(result.device.address, name, result.rssi)
    }

    private fun scanSettings(): ScanSettings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()

    private fun screenOn(): Boolean = appContext.getSystemService(PowerManager::class.java)?.isInteractive != false

    fun stopScan() {
        val callback = scanCallback ?: return
        scanCallback = null
        try {
            adapter?.bluetoothLeScanner?.stopScan(callback)
        } catch (_: Exception) {
        }
    }

    /** Connects and finds the UART characteristics. Retries the usual Android GATT 133 failures. */
    suspend fun connect(address: String) {
        stopScan()
        val device = adapter?.getRemoteDevice(address) ?: error(appContext.getString(R.string.elm_no_bluetooth))
        var lastError: Throwable? = null
        for (attempt in 1..3) {
            try {
                connectOnce(device)
                return
            } catch (e: Throwable) {
                lastError = e
                closeGatt()
                delay(600L * attempt)
            }
        }
        throw lastError ?: IllegalStateException(appContext.getString(R.string.elm_could_not_connect))
    }

    private suspend fun connectOnce(device: BluetoothDevice) {
        val done = CompletableDeferred<Unit>()
        ready = done
        gatt = device.connectGatt(appContext, false, callback, BluetoothDevice.TRANSPORT_LE)
        withTimeout(15_000) { done.await() }
    }

    /** Sends one command and waits for the ELM327 ">" prompt. Commands never overlap. */
    suspend fun send(command: String, timeoutMs: Long = 4_000): String = commandMutex.withLock {
        val g = gatt ?: error(appContext.getString(R.string.elm_not_connected))
        val c = writeChar ?: error(appContext.getString(R.string.elm_not_connected))
        val waiter = CompletableDeferred<String>()
        synchronized(lock) {
            buffer.setLength(0)
            reply = waiter
        }
        val bytes = "$command\r".toByteArray(Charsets.UTF_8)
        val ok = if (Build.VERSION.SDK_INT >= 33) {
            g.writeCharacteristic(c, bytes, writeType) == android.bluetooth.BluetoothStatusCodes.SUCCESS
        } else {
            c.writeType = writeType
            c.value = bytes
            g.writeCharacteristic(c)
        }
        if (!ok) {
            synchronized(lock) { reply = null }
            error(appContext.getString(R.string.elm_write_failed))
        }
        try {
            withTimeout(timeoutMs) { waiter.await() }
        } finally {
            synchronized(lock) { reply = null }
        }
    }

    suspend fun initialize() {
        for (command in Elm.initCommands) {
            if (command == "ATZ") {
                var retried = false
                try {
                    send(command, 6_000)
                } catch (_: TimeoutCancellationException) {
                    // A just-woken adapter can miss the first reset. One more try, nothing else is repeated.
                    currentCoroutineContext().ensureActive()
                    // A late answer to the first reset that arrives now, with nothing waiting, is dropped.
                    delay(1_000)
                    send(command, 6_000)
                    retried = true
                }
                // After a second reset, let it finish first: a late answer from either one must not
                // be taken as the answer to the next command, or echo could stay on.
                delay(if (retried) 1_500 else 300)
            } else {
                send(command, 4_000)
            }
        }
    }

    /** Set-up for watching the 12V while the car sleeps: adapter-only settings, nothing sent to the car. */
    suspend fun initializeForWatch() {
        for (command in Elm.watchInitCommands) send(command)
    }

    fun disconnect() {
        stopScan()
        closeGatt()
    }

    private fun closeGatt() {
        writeChar = null
        val g = gatt
        gatt = null
        try {
            g?.disconnect()
            g?.close()
        } catch (_: Exception) {
        }
        synchronized(lock) {
            reply?.completeExceptionally(IllegalStateException(appContext.getString(R.string.elm_disconnected)))
            reply = null
        }
    }

    private fun onData(bytes: ByteArray) {
        synchronized(lock) {
            buffer.append(String(bytes, Charsets.UTF_8))
            val end = buffer.indexOf(">")
            if (end >= 0) {
                val text = buffer.substring(0, end)
                buffer.setLength(0)
                reply?.complete(text)
            }
        }
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (gatt != null && g != gatt) return
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                val wasConnected = writeChar != null
                ready?.completeExceptionally(IllegalStateException(appContext.getString(R.string.elm_disconnected_status, status)))
                closeGatt()
                if (wasConnected) onDisconnected?.invoke()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                ready?.completeExceptionally(IllegalStateException(appContext.getString(R.string.elm_discovery_failed)))
                return
            }
            var notify: BluetoothGattCharacteristic? = null
            var write: BluetoothGattCharacteristic? = null
            for (service in g.services) {
                val short = service.uuid.toString().substring(4, 8).lowercase()
                if (service.uuid.toString().endsWith(BASE_UUID_SUFFIX) && short in STANDARD_SERVICES) continue
                var n: BluetoothGattCharacteristic? = null
                var w: BluetoothGattCharacteristic? = null
                for (c in service.characteristics) {
                    val p = c.properties
                    if (n == null && p and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) n = c
                    if (p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) {
                        if (w == null || w.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE == 0) w = c
                    } else if (w == null && p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) {
                        w = c
                    }
                }
                if (n != null && w != null) {
                    notify = n
                    write = w
                    break
                }
            }
            if (notify == null || write == null) {
                ready?.completeExceptionally(NotObdAdapter(appContext.getString(R.string.elm_not_obd)))
                return
            }
            writeType = if (write.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) {
                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            } else {
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            }
            pendingWrite = write
            g.setCharacteristicNotification(notify, true)
            val cccd = notify.getDescriptor(CCCD)
            if (cccd == null) {
                writeChar = write
                ready?.complete(Unit)
                return
            }
            val value = if (notify.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) {
                BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            } else {
                BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            }
            if (Build.VERSION.SDK_INT >= 33) {
                g.writeDescriptor(cccd, value)
            } else {
                    cccd.value = value
                    g.writeDescriptor(cccd)
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid != CCCD) return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                writeChar = pendingWrite
                ready?.complete(Unit)
            } else {
                ready?.completeExceptionally(IllegalStateException(appContext.getString(R.string.elm_subscribe_failed)))
            }
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            onData(value)
        }

        @Deprecated("Used on Android 12 and older")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            c.value?.let { onData(it) }
        }
    }

    private var pendingWrite: BluetoothGattCharacteristic? = null

    private companion object {
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb"
        val STANDARD_SERVICES = setOf("1800", "1801", "180a", "180f")
    }
}
