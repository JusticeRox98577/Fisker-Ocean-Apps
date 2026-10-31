package com.justice.obdsim

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

enum class Mode(val label: String) { Parked("Parked"), Driving("Driving"), Charging("Charging") }

data class SimState(
    val advertising: Boolean = false,
    val connected: Boolean = false,
    val status: String = "Stopped",
    val soc: Double = 76.9,
    val tempC: Double = 21.0,
    val mode: Mode = Mode.Parked,
    val drift: Boolean = true,
    val log: List<String> = emptyList()
)

// Pretends to be a Bluetooth OBD adapter with an ELM327 style command set, and answers the
// same battery requests the real car does, with made up numbers.
@SuppressLint("MissingPermission")
class Simulator(private val ctx: Context, private val onState: (SimState) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val mgr = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private var server: BluetoothGattServer? = null
    private var notifyChar: BluetoothGattCharacteristic? = null
    private var device: BluetoothDevice? = null
    private var advertiser: android.bluetooth.le.BluetoothLeAdvertiser? = null
    private var state = SimState()
    private var header = "7E1"
    private val rxBuf = StringBuilder()
    private val queue = ArrayDeque<ByteArray>()
    private var sending = false
    private var chunk = 20

    private val svcUuid = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB")
    private val notifyUuid = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB")
    private val writeUuid = UUID.fromString("0000FFF2-0000-1000-8000-00805F9B34FB")
    private val cccd = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")

    private val tick = object : Runnable {
        override fun run() {
            if (state.drift) {
                var s = state.soc
                when (state.mode) {
                    Mode.Driving -> s -= 0.03
                    Mode.Charging -> s += 0.05
                    Mode.Parked -> {}
                }
                push(state.copy(soc = min(100.0, max(0.0, s))))
            }
            main.postDelayed(this, 1000)
        }
    }

    private fun push(s: SimState) { state = s; onState(s) }
    private fun log(line: String) { push(state.copy(log = (state.log + line).takeLast(14))) }

    fun setMode(m: Mode) = push(state.copy(mode = m))
    fun setSoc(v: Double) = push(state.copy(soc = v))
    fun setTemp(v: Double) = push(state.copy(tempC = v))
    fun setDrift(v: Boolean) = push(state.copy(drift = v))

    fun start() {
        if (state.advertising) return
        val adapter = mgr.adapter
        if (adapter == null || !adapter.isEnabled) { push(state.copy(status = "Turn on Bluetooth")); return }
        try { adapter.name = "vLinker FD" } catch (_: Exception) {}
        server = mgr.openGattServer(ctx, callback)
        val svc = BluetoothGattService(svcUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val n = BluetoothGattCharacteristic(notifyUuid, BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
        n.addDescriptor(BluetoothGattDescriptor(cccd, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        val w = BluetoothGattCharacteristic(
            writeUuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        svc.addCharacteristic(n)
        svc.addCharacteristic(w)
        notifyChar = n
        server?.addService(svc)
        push(state.copy(status = "Starting"))
        main.postDelayed(tick, 1000)
    }

    fun stop() {
        main.removeCallbacks(tick)
        try { advertiser?.stopAdvertising(adCallback) } catch (_: Exception) {}
        try { server?.close() } catch (_: Exception) {}
        server = null
        device = null
        queue.clear()
        sending = false
        push(state.copy(advertising = false, connected = false, status = "Stopped"))
    }

    private fun advertise() {
        advertiser = mgr.adapter.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()
        val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(svcUuid)).build()
        val scan = AdvertiseData.Builder().setIncludeDeviceName(true).build()
        advertiser?.startAdvertising(settings, data, scan, adCallback)
    }

    private val adCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            main.post { push(state.copy(advertising = true, status = "Advertising as vLinker FD")) }
        }
        override fun onStartFailure(errorCode: Int) {
            main.post { push(state.copy(status = "Could not advertise, error $errorCode")) }
        }
    }

    private val callback = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService?) { main.post { advertise() } }

        override fun onConnectionStateChange(d: BluetoothDevice, status: Int, newState: Int) {
            main.post {
                if (newState == BluetoothGatt.STATE_CONNECTED) {
                    device = d
                    push(state.copy(connected = true, status = "Connected to a phone"))
                } else {
                    device = null
                    queue.clear()
                    sending = false
                    rxBuf.setLength(0)
                    header = "7E1"
                    push(state.copy(connected = false, status = if (state.advertising) "Advertising as vLinker FD" else "Stopped"))
                    if (state.advertising) advertise()
                }
            }
        }

        override fun onMtuChanged(d: BluetoothDevice, mtu: Int) { chunk = max(20, mtu - 3) }

        override fun onDescriptorWriteRequest(
            d: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean,
            responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            if (responseNeeded) server?.sendResponse(d, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
        }

        override fun onCharacteristicWriteRequest(
            d: BluetoothDevice, requestId: Int, c: BluetoothGattCharacteristic, preparedWrite: Boolean,
            responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            if (responseNeeded) server?.sendResponse(d, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            val text = String(value ?: return, Charsets.US_ASCII)
            main.post {
                for (ch in text) {
                    if (ch == '\r' || ch == '\n') {
                        val cmd = rxBuf.toString().trim()
                        rxBuf.setLength(0)
                        if (cmd.isNotEmpty()) handle(cmd)
                    } else rxBuf.append(ch)
                }
            }
        }

        override fun onNotificationSent(d: BluetoothDevice, status: Int) {
            main.post { sending = false; pump() }
        }
    }

    private fun handle(raw: String) {
        val cmd = raw.replace(" ", "").uppercase()
        val reply = when {
            cmd == "ATZ" || cmd == "ATI" -> "ELM327 v1.5"
            cmd == "ATRV" -> "12.6V"
            cmd.startsWith("ATSH") -> { header = cmd.removePrefix("ATSH"); "OK" }
            cmd.startsWith("AT") -> "OK"
            cmd == "1003" -> "5003003201F4"
            cmd.startsWith("22") && cmd.length == 6 -> readDid(cmd.substring(2))
            else -> "NO DATA"
        }
        log("$raw -> ${reply.take(24)}")
        send(reply + "\r\r>")
    }

    private fun hex(v: Int, bytes: Int): String = String.format("%0${bytes * 2}X", v and (if (bytes >= 4) -1 else (1 shl (bytes * 8)) - 1))

    // Numbers use the same layout the real battery module uses
    private fun readDid(did: String): String {
        if (header != "7E1") return "NO DATA"
        val soc = state.soc
        val volts = 330.0 + soc * 0.45
        val amps = when (state.mode) {
            Mode.Parked -> 0.6
            Mode.Driving -> 38.0 + 14.0 * Math.sin(System.currentTimeMillis() / 3500.0)
            Mode.Charging -> -(62.0 + 2.0 * Math.sin(System.currentTimeMillis() / 5000.0))
        }
        val data = when (did) {
            "2003" -> hex((volts * 10).toInt(), 2) + "FFEE0000AAAAAAAA"
            "2016" -> hex((amps * 10).toInt(), 4)
            "2038", "2039", "2040" -> hex(((state.tempC + 50) * 2).toInt(), 2)
            "2026", "2027" -> hex(((state.tempC + 50) * 2).toInt(), 2)
            "2050" -> hex((soc * 10).toInt(), 2)
            else -> return "NO DATA"
        }
        return "62$did$data"
    }

    private fun send(text: String) {
        val b = text.toByteArray(Charsets.US_ASCII)
        var i = 0
        while (i < b.size) {
            queue.addLast(b.copyOfRange(i, min(b.size, i + chunk)))
            i += chunk
        }
        pump()
    }

    @Suppress("DEPRECATION")
    private fun pump() {
        if (sending) return
        val d = device ?: return
        val c = notifyChar ?: return
        val next = queue.removeFirstOrNull() ?: return
        sending = true
        c.value = next
        val ok = server?.notifyCharacteristicChanged(d, c, false) ?: false
        if (!ok) { sending = false; main.postDelayed({ pump() }, 30) }
    }
}
