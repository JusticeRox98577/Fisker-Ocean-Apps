package com.justicemw.oceanlive

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class Status { Idle, Scanning, Connecting, Live, Error }

/** Connects to the adapter and polls the car every couple of seconds. */
class Monitor(context: Context) {
    private val transport = ElmTransport(context)
    private val prefs = context.getSharedPreferences("ocean_live", Context.MODE_PRIVATE)
    private val scope = MainScope()
    private var job: Job? = null

    var status by mutableStateOf(Status.Idle)
        private set
    var message by mutableStateOf<String?>(null)
        private set
    val found = mutableStateListOf<FoundAdapter>()
    val values = mutableStateMapOf<String, Double>()
    var lastUpdate by mutableStateOf<Long?>(null)
        private set
    var auxSource by mutableStateOf<String?>(null)
        private set

    var savedAddress by mutableStateOf(prefs.getString("adapter_address", null))
        private set
    var savedName by mutableStateOf(prefs.getString("adapter_name", null))
        private set

    val bluetoothOn get() = transport.bluetoothOn

    init {
        transport.onDisconnected = {
            scope.launch {
                job?.cancel()
                status = Status.Error
                message = "Adapter disconnected."
            }
        }
    }

    fun scan() {
        stop()
        found.clear()
        message = null
        status = Status.Scanning
        transport.startScan { adapter ->
            scope.launch {
                val i = found.indexOfFirst { it.address == adapter.address }
                if (i >= 0) found[i] = adapter else found.add(adapter)
                found.sortByDescending { it.rssi }
            }
        }
    }

    fun connect(address: String, name: String) {
        stop()
        message = null
        status = Status.Connecting
        job = scope.launch {
            try {
                transport.connect(address)
                transport.initialize()
                prefs.edit().putString("adapter_address", address).putString("adapter_name", name).apply()
                savedAddress = address
                savedName = name
                status = Status.Live
                poll()
            } catch (e: Exception) {
                if (!isActive) return@launch
                transport.disconnect()
                status = Status.Error
                message = e.message ?: "Could not connect."
            }
        }
    }

    private suspend fun query(command: String): String? = try {
        transport.send(command)
    } catch (_: TimeoutCancellationException) {
        null
    }

    private suspend fun poll() {
        var misses = 0
        while (scope.isActive) {
            var answered = false

            for (command in Obd.headerCommands) query(command)
            for (pid in Obd.packPids) {
                val reply = query(pid.command)
                if (reply != null) answered = true
                val bytes = reply?.let { Obd.parseResponse(it, pid.command) }
                val value = bytes?.let { Formula(pid.formula, Obd.byteVariables(it)).evaluate() }
                    ?.takeIf { it >= pid.min && it <= pid.max }
                if (value != null) values[pid.key] = value else values.remove(pid.key)
            }

            // 12V: prefer the BMS reading, otherwise the adapter's own supply voltage.
            val bms12v = values["aux_bms"]
            if (bms12v != null) {
                values["aux_voltage"] = bms12v
                auxSource = "BMS"
            } else {
                val v = query(Obd.AUX_VOLTAGE_COMMAND)?.let {
                    answered = true
                    Obd.parseAdapterVoltage(it)
                }
                if (v != null) values["aux_voltage"] = v else values.remove("aux_voltage")
                auxSource = if (v != null) "OBD port" else null
            }

            val volts = values["voltage"]
            val amps = values["current"]
            if (volts != null && amps != null) values["power"] = volts * amps / 1000 else values.remove("power")

            if (answered) {
                misses = 0
                lastUpdate = System.currentTimeMillis()
            } else if (++misses >= 3) {
                throw IllegalStateException("Adapter stopped responding.")
            }
            delay(2_000)
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        transport.disconnect()
        if (status != Status.Error) status = Status.Idle
    }

    fun disconnect() {
        stop()
        status = Status.Idle
        message = null
        values.clear()
        lastUpdate = null
    }

    fun forgetAdapter() {
        prefs.edit().clear().apply()
        savedAddress = null
        savedName = null
    }

    fun close() {
        transport.disconnect()
        scope.cancel()
    }
}
