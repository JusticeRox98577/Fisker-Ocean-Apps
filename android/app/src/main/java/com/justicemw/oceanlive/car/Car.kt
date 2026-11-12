package com.justicemw.oceanlive.car

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import com.justicemw.oceanlive.OceanService
import com.justicemw.oceanlive.OceanWidget
import com.justicemw.oceanlive.obd.Did
import com.justicemw.oceanlive.obd.Dtc
import com.justicemw.oceanlive.obd.DtcCatalog
import com.justicemw.oceanlive.obd.DtcReadResult
import com.justicemw.oceanlive.obd.Dtcs
import com.justicemw.oceanlive.obd.Ecu
import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.Elm
import com.justicemw.oceanlive.obd.ElmTransport
import com.justicemw.oceanlive.obd.FoundAdapter
import com.justicemw.oceanlive.obd.Ident
import com.justicemw.oceanlive.obd.ModuleVersion
import com.justicemw.oceanlive.obd.Pids
import com.justicemw.oceanlive.obd.Uds
import com.justicemw.oceanlive.obd.UdsResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class CarState(
    val status: Status = Status.Idle,
    val message: String? = null,
    val adapterName: String? = null,
    val snapshot: Snapshot = Snapshot(),
    val mode: Mode = Mode.Parked,
    val currentCharge: HistoryEntry? = null,
    val currentDrive: HistoryEntry? = null,
    val vin: String? = null,
    val abrpStatus: String? = null,
    val lastUpdate: Long? = null,
) {
    val connected: Boolean get() = status == Status.Live
}

data class FaultScan(
    val running: Boolean = false,
    val progress: Int = 0,
    val total: Int = Ecus.scanList.size,
    val current: String? = null,
    val codes: List<Dtc> = emptyList(),
    /** Module code to what happened: "ok", "no answer", "incomplete", ... */
    val modules: Map<String, String> = emptyMap(),
    val finishedAt: Long? = null,
    val error: String? = null,
    /** New and cleared codes compared with the scan before this one. */
    val diff: ScanDiff = ScanDiff(),
)

data class VersionRun(
    val running: Boolean = false,
    val progress: Int = 0,
    val total: Int = 0,
    val current: String? = null,
    val versions: List<ModuleVersion> = emptyList(),
    val finishedAt: Long? = null,
)

enum class CarAction(val label: String) { Clear("Clear codes"), Restart("Restart") }

data class ActionOutcome(
    val ecu: Ecu,
    val action: CarAction,
    val result: UdsResult,
    /** Codes the module still reports after the action, or null if the re-check got no answer. */
    val remaining: Int?,
)

data class ActionRun(
    val running: Boolean = false,
    val action: CarAction? = null,
    val current: String? = null,
    val done: Int = 0,
    val total: Int = 0,
    val outcomes: List<ActionOutcome> = emptyList(),
)

/**
 * The one connection to the car, shared by the phone UI, the background
 * service, the widget and Android Auto.
 */
@SuppressLint("StaticFieldLeak") // holds the application context only
object Car {
    private lateinit var app: Context
    private lateinit var transport: ElmTransport
    private lateinit var store: HistoryStore
    private lateinit var alerts: Alerts
    private lateinit var faultStore: FaultHistoryStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val bus = Mutex()
    private var job: Job? = null
    private var wantConnected = false
    private var selectedEcu: Ecu? = null
    private val tracker = Tracker()
    private var lastAbrp = 0L
    private var lastWidget = 0L

    private val _state = MutableStateFlow(CarState())
    val state: StateFlow<CarState> = _state.asStateFlow()
    private val _found = MutableStateFlow<List<FoundAdapter>>(emptyList())
    val found: StateFlow<List<FoundAdapter>> = _found.asStateFlow()
    private val _history = MutableStateFlow<List<HistoryEntry>>(emptyList())
    val history: StateFlow<List<HistoryEntry>> = _history.asStateFlow()
    private val _settings = MutableStateFlow(Settings())
    val settings: StateFlow<Settings> = _settings.asStateFlow()
    private val _faults = MutableStateFlow(FaultScan())
    val faults: StateFlow<FaultScan> = _faults.asStateFlow()
    private val _action = MutableStateFlow(ActionRun())
    val action: StateFlow<ActionRun> = _action.asStateFlow()
    private val _pastScans = MutableStateFlow<List<SavedScan>>(emptyList())
    /** Finished fault scans, oldest first (the latest [FaultHistory.MAX]). */
    val pastScans: StateFlow<List<SavedScan>> = _pastScans.asStateFlow()
    private val _versions = MutableStateFlow(VersionRun())
    val versions: StateFlow<VersionRun> = _versions.asStateFlow()

    /** Latest phone location, fed by the service when ABRP location sharing is on. */
    @Volatile var location: Location? = null

    val bluetoothOn: Boolean get() = transport.bluetoothOn

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        transport = ElmTransport(app)
        store = HistoryStore(app)
        alerts = Alerts(app)
        faultStore = FaultHistoryStore(app)
        _settings.value = Settings.load(Settings.prefs(app))
        _state.update { it.copy(adapterName = _settings.value.adapterName) }
        scope.launch(Dispatchers.IO) {
            _history.value = store.load()
            _pastScans.value = faultStore.load()
            loadDescriptions()
        }
        transport.onDisconnected = { scope.launch { onLost("Adapter disconnected.") } }
    }

    fun updateSettings(change: (Settings) -> Settings) {
        val next = change(_settings.value)
        _settings.value = next
        next.save(Settings.prefs(app))
    }

    // ── Connection ──────────────────────────────────────────────

    fun scan() {
        stopJob()
        transport.disconnect()
        _found.value = emptyList()
        _state.update { it.copy(status = Status.Scanning, message = null) }
        transport.startScan { adapter ->
            scope.launch {
                val list = _found.value.filterNot { it.address == adapter.address } + adapter
                _found.value = list.sortedWith(compareByDescending<FoundAdapter> { looksLikeObd(it.name) }.thenByDescending { it.rssi })
            }
        }
    }

    fun cancelScan() {
        transport.stopScan()
        _state.update { it.copy(status = Status.Idle) }
    }

    fun connect(address: String, name: String) {
        stopJob()
        wantConnected = true
        updateSettings { it.copy(adapterAddress = address, adapterName = name) }
        _state.update { it.copy(status = Status.Connecting, message = null, adapterName = name) }
        OceanService.start(app)
        job = scope.launch { runSession(address, firstAttempt = true) }
    }

    fun connectSaved() {
        val s = _settings.value
        if (s.adapterAddress != null) connect(s.adapterAddress, s.adapterName ?: "Adapter")
    }

    fun disconnect() {
        wantConnected = false
        stopJob()
        transport.disconnect()
        endSessions()
        _state.update { it.copy(status = Status.Idle, message = null, abrpStatus = null) }
        OceanService.stop(app)
        refreshWidget(force = true)
    }

    fun forgetAdapter() {
        disconnect()
        updateSettings { it.copy(adapterAddress = null, adapterName = null) }
        _state.update { it.copy(adapterName = null) }
    }

    private fun stopJob() {
        job?.cancel()
        job = null
        transport.stopScan()
    }

    private suspend fun runSession(address: String, firstAttempt: Boolean) {
        var first = firstAttempt
        while (wantConnected) {
            try {
                transport.connect(address)
                bus.withLock {
                    transport.initialize()
                    selectedEcu = null
                }
                alerts.resetHealth()
                first = false
                _state.update { it.copy(status = Status.Live, message = null) }
                if (_state.value.vin == null) readVin()
                poll()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException && e !is TimeoutCancellationException) throw e
                if (!wantConnected) return
                transport.disconnect()
                endSessions()
                if (first) {
                    // A first attempt that fails is usually the wrong adapter or the car being off.
                    wantConnected = false
                    _state.update { it.copy(status = Status.Error, message = e.message ?: "Could not connect.") }
                    OceanService.stop(app)
                    return
                }
                _state.update { it.copy(status = Status.Reconnecting, message = e.message) }
                refreshWidget(force = true)
                delay(RECONNECT_MS)
            }
        }
    }

    private fun onLost(reason: String) {
        if (!wantConnected) return
        if (_state.value.status == Status.Live) {
            _state.update { it.copy(status = Status.Reconnecting, message = reason) }
        }
    }

    // ── Polling ─────────────────────────────────────────────────

    private suspend fun query(command: String, timeoutMs: Long = 4_000): String? = try {
        transport.send(command, timeoutMs)
    } catch (_: TimeoutCancellationException) {
        null
    }

    private suspend fun selectEcu(ecu: Ecu) {
        if (selectedEcu == ecu) return
        query("ATSH${ecu.request}")
        query("ATCRA${ecu.response}")
        selectedEcu = ecu
    }

    private suspend fun read(did: Did): Pair<Boolean, Double?> {
        selectEcu(did.ecu)
        val reply = query(did.command) ?: return false to null
        return true to Elm.read(reply, did)
    }

    private suspend fun poll() {
        var misses = 0
        var cycle = 0
        while (scope.isActive && wantConnected) {
            var answered = false
            var snap = _state.value.snapshot
            val flip = _settings.value.flipCurrent
            bus.withLock {
                val dids = if (cycle % 5 == 0) Pids.fast + (Pids.slow - Pids.aux12v) + Pids.odometer else Pids.fast
                for (did in dids) {
                    val (got, value) = read(did)
                    if (got) answered = true
                    val v = if (did == Pids.packA && flip) value?.let { -it } else value
                    // Keep slow values between their reads; fast ones go blank if the car stops answering.
                    if (v != null || did in Pids.fast) snap = snap.withValue(did.key, v)
                }
                if (cycle % 5 == 0) {
                    // 12V: the BMS's own reading of the 12V terminal, else the adapter's supply voltage (OBD pin 16).
                    val bms = read(Pids.aux12v).second
                    snap = if (bms != null) {
                        snap.copy(aux12v = bms, aux12vSource = "BMS")
                    } else {
                        val v = query("ATRV")?.let { answered = true; Elm.adapterVoltage(it) }
                        snap.copy(aux12v = v, aux12vSource = v?.let { "OBD port" })
                    }
                }
            }
            snap = snap.copy(time = System.currentTimeMillis())

            if (answered) {
                misses = 0
                onReading(snap)
            } else if (++misses >= 3) {
                throw IllegalStateException("The car stopped answering.")
            }
            cycle++
            delay(POLL_MS)
        }
    }

    private fun onReading(snap: Snapshot) {
        val finished = tracker.update(snap)
        _state.update {
            it.copy(
                snapshot = snap, lastUpdate = snap.time, mode = tracker.mode,
                currentCharge = tracker.currentCharge, currentDrive = tracker.currentDrive,
            )
        }
        finished.forEach { addHistory(it) }
        val settings = _settings.value
        alerts.check(snap, tracker.mode, settings)
        maybeSendAbrp(snap, settings)
        refreshWidget()
    }

    private fun addHistory(entry: HistoryEntry) {
        if (entry.kind == EntryKind.Charge) alerts.chargingStopped(entry, _settings.value)
        val keep = when (entry.kind) {
            EntryKind.Drive -> (entry.distanceKm ?: 0.0) >= 0.3
            EntryKind.Charge -> entry.kwh >= 0.2
        }
        if (!keep) return
        val list = _history.value + entry
        _history.value = list
        scope.launch(Dispatchers.IO) { store.save(list) }
    }

    private fun endSessions() {
        tracker.flush(System.currentTimeMillis()).forEach { addHistory(it) }
        _state.update { it.copy(mode = Mode.Parked, currentCharge = null, currentDrive = null) }
    }

    fun clearHistory() {
        _history.value = emptyList()
        scope.launch(Dispatchers.IO) { store.save(emptyList()) }
    }

    fun deleteHistory(entry: HistoryEntry) {
        val list = _history.value - entry
        _history.value = list
        scope.launch(Dispatchers.IO) { store.save(list) }
    }

    private fun maybeSendAbrp(snap: Snapshot, settings: Settings) {
        if (!settings.abrpEnabled) {
            if (_state.value.abrpStatus != null) _state.update { it.copy(abrpStatus = null) }
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastAbrp < settings.abrpEverySec * 1000L) return
        lastAbrp = now
        val tlm = Abrp.telemetry(snap, tracker.mode, tracker.currentCharge?.fast == true, settings, location)
        scope.launch {
            val error = Abrp.send(tlm, settings)
            _state.update { it.copy(abrpStatus = error ?: "Sent to ABRP") }
        }
    }

    private fun refreshWidget(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastWidget < 30_000) return
        lastWidget = now
        OceanWidget.updateAll(app)
    }

    // ── Identity and fault codes ────────────────────────────────

    private suspend fun readVin() {
        bus.withLock {
            for (ecu in listOf(Ecus.VCU, Ecus.BCM, Ecus.BMS)) {
                selectEcu(ecu)
                val vin = query("22F190")?.let { Elm.vin(it) }
                if (vin != null) {
                    _state.update { it.copy(vin = vin) }
                    return
                }
            }
        }
    }

    /** Reads stored fault codes from every module. Read-only: nothing is cleared or changed. */
    fun scanFaults() {
        if (_faults.value.running || _versions.value.running || !_state.value.connected) return
        _faults.value = FaultScan(running = true)
        scope.launch {
            try {
                bus.withLock {
                    query("ATST96") // give slow modules ~600 ms to start answering
                    val codes = mutableListOf<Dtc>()
                    val modules = linkedMapOf<String, String>()
                    Ecus.scanList.forEachIndexed { index, ecu ->
                        _faults.update { it.copy(progress = index, current = ecu.name) }
                        selectEcu(ecu)
                        var result: DtcReadResult = DtcReadResult.NoAnswer
                        for (attempt in 1..3) {
                            val reply = query(Dtcs.READ_ALL, 6_000)
                            result = if (reply == null) DtcReadResult.Garbled else Dtcs.parse(reply, ecu)
                            val retry = result is DtcReadResult.Garbled ||
                                (result is DtcReadResult.Ok && !result.complete) ||
                                (result is DtcReadResult.Refused && result.nrc == 0x78)
                            if (!retry) break
                        }
                        modules[ecu.code] = when (val r = result) {
                            is DtcReadResult.Ok -> {
                                codes.addAll(r.codes)
                                if (r.complete) "ok" else "incomplete"
                            }
                            DtcReadResult.NoAnswer -> "no answer"
                            is DtcReadResult.Refused -> "refused"
                            DtcReadResult.Garbled -> "unreadable"
                        }
                        _faults.update { it.copy(codes = codes.toList(), modules = modules.toMap()) }
                    }
                    query("ATST20")
                    val now = System.currentTimeMillis()
                    val saved = FaultHistory.snapshot(now, _state.value.vin, modules.toMap(), codes.toList())
                    val past = _pastScans.value
                    val diff = FaultHistory.diff(FaultHistory.previous(past, saved), saved)
                    val list = FaultHistory.append(past, saved)
                    _pastScans.value = list
                    scope.launch(Dispatchers.IO) { try { faultStore.save(list) } catch (_: Exception) {} }
                    _faults.update { it.copy(running = false, progress = it.total, current = null, finishedAt = now, diff = diff) }
                }
            } catch (e: Exception) {
                _faults.update { it.copy(running = false, error = e.message ?: "Scan stopped.") }
            }
        }
    }

    /**
     * Reads the software version, software number and part number (standard UDS identification
     * values, service 22) from each module. Read-only. Uses the modules that answered the last
     * fault scan, or every module if there wasn't one.
     */
    fun readVersions() {
        if (_versions.value.running || _faults.value.running || _action.value.running || !_state.value.connected) return
        val scan = _faults.value
        val ecus = if (scan.finishedAt != null) {
            Ecus.scanList.filter { scan.modules[it.code] == "ok" || scan.modules[it.code] == "incomplete" }
        } else Ecus.scanList
        _versions.value = VersionRun(running = true, total = ecus.size)
        scope.launch {
            val found = mutableListOf<ModuleVersion>()
            try {
                bus.withLock {
                    query("ATST96")
                    ecus.forEachIndexed { index, ecu ->
                        _versions.update { it.copy(progress = index, current = ecu.name) }
                        selectEcu(ecu)
                        val first = query("22${Ident.SOFTWARE_VERSION}", 3_000)
                        // A module that doesn't answer at all is skipped so a silent one costs one timeout, not three.
                        if (first == null || Elm.parse(first).bytes.isEmpty()) return@forEachIndexed
                        val v = ModuleVersion(
                            ecu,
                            softwareVersion = Ident.read(first, Ident.SOFTWARE_VERSION),
                            softwareNumber = Ident.read(query("22${Ident.SOFTWARE_NUMBER}", 3_000), Ident.SOFTWARE_NUMBER),
                            partNumber = Ident.read(query("22${Ident.PART_NUMBER}", 3_000), Ident.PART_NUMBER),
                        )
                        if (!v.isEmpty) {
                            found.add(v)
                            _versions.update { it.copy(versions = found.toList()) }
                        }
                    }
                    query("ATST20")
                }
            } catch (_: Exception) {
                // Keep whatever was read before the connection dropped.
            } finally {
                _versions.update { it.copy(running = false, progress = it.total, current = null, versions = found.toList(), finishedAt = System.currentTimeMillis()) }
            }
        }
    }

    // ── Changing things: clear codes, restart modules ───────────

    /** Why the car can't take a clear or restart right now, or null if it can. */
    fun changeBlockedReason(): String? {
        val s = _state.value
        return when {
            !s.connected -> "Connect to the car first."
            s.mode == Mode.Driving -> "The car is moving. Park it first."
            s.mode == Mode.Charging -> "The car is charging. Unplug it first."
            _faults.value.running || _versions.value.running -> "Wait for the scan to finish."
            _action.value.running -> "Another action is still running."
            else -> null
        }
    }

    /** Clears stored fault codes on each module, then reads them again to show what stayed. */
    fun clearCodes(ecus: List<Ecu>) = runAction(CarAction.Clear, ecus)

    /** Restarts one module (soft reset, or hard for the telematics boxes). */
    fun restartModule(ecu: Ecu) = runAction(CarAction.Restart, listOf(ecu))

    private fun runAction(action: CarAction, ecus: List<Ecu>) {
        if (changeBlockedReason() != null || ecus.isEmpty()) return
        _action.value = ActionRun(running = true, action = action, total = ecus.size)
        scope.launch {
            val outcomes = mutableListOf<ActionOutcome>()
            try {
                bus.withLock {
                    query("ATST96")
                    ecus.forEachIndexed { index, ecu ->
                        // Stop if the car starts moving or charging part way through.
                        if (_state.value.mode != Mode.Parked) return@forEachIndexed
                        _action.update { it.copy(current = ecu.name, done = index) }
                        selectEcu(ecu)
                        query(Uds.EXTENDED_SESSION) // some modules refuse this and still accept the request
                        val result = when (action) {
                            CarAction.Clear -> {
                                // Pause code logging so codes don't reappear mid-clear. Optional: a refusal changes nothing.
                                query(Uds.DTC_SETTING_OFF)
                                try {
                                    request(Uds.CLEAR_ALL, 0x14)
                                } finally {
                                    query(Uds.DTC_SETTING_ON) // the switch back to the default session below also turns it back on
                                }
                            }
                            CarAction.Restart -> if (!ecu.canRestart) UdsResult.Refused(0x12) else
                                request(if (ecu.hardRestart) Uds.HARD_RESET else Uds.SOFT_RESET, 0x11)
                        }
                        if (action == CarAction.Restart && result == UdsResult.Done) delay(3_000) // let it boot
                        else query(Uds.DEFAULT_SESSION)
                        val remaining = recheck(ecu)
                        outcomes.add(ActionOutcome(ecu, action, result, remaining))
                        _action.update { it.copy(outcomes = outcomes.toList()) }
                    }
                    query("ATST20")
                }
            } finally {
                _action.update { it.copy(running = false, current = null, done = it.total) }
            }
        }
    }

    private suspend fun request(command: String, service: Int): UdsResult {
        var reply = query(command, 8_000)
        // The adapter normally waits through "busy" replies itself; if it didn't, give the module a moment
        // and ask again. Only for clearing: asking twice to restart would restart the module twice.
        if (service == 0x14 && Uds.pending(reply, service)) {
            delay(1_500)
            reply = query(command, 8_000)
        }
        return Uds.result(reply, service)
    }

    /** Reads the module's codes again and updates the scan results. Returns the count, or null if no answer. */
    private suspend fun recheck(ecu: Ecu): Int? {
        val reply = query(Dtcs.READ_ALL, 6_000) ?: return null
        val r = Dtcs.parse(reply, ecu)
        val codes = when (r) {
            is DtcReadResult.Ok -> r.codes
            else -> return null // silent or garbled: don't guess, keep the old list
        }
        _faults.update { f ->
            if (f.finishedAt == null) f else f.copy(codes = f.codes.filterNot { it.ecu == ecu } + codes)
        }
        return codes.size
    }

    // ── Imported fault-code descriptions ────────────────────────

    private val descriptionsFile get() = java.io.File(app.filesDir, "dtc-descriptions.json")
    private val _importedDescriptions = MutableStateFlow(0)
    /** How many imported descriptions are loaded; also bumps the UI when it changes. */
    val importedDescriptions: StateFlow<Int> = _importedDescriptions.asStateFlow()

    private fun loadDescriptions() {
        try {
            if (descriptionsFile.exists()) DtcCatalog.setImported(DtcCatalog.parseImport(descriptionsFile.readText()))
        } catch (_: Exception) {
        }
        _importedDescriptions.value = DtcCatalog.importedCount
    }

    /** Adds descriptions from a CSV or JSON file to the saved list. Returns how many were read, or null if none. */
    fun importDescriptions(text: String): Int? {
        val parsed = try { DtcCatalog.parseImport(text) } catch (_: Exception) { emptyMap() }
        if (parsed.isEmpty()) return null
        val existing = try {
            if (descriptionsFile.exists()) DtcCatalog.parseImport(descriptionsFile.readText()) else emptyMap()
        } catch (_: Exception) { emptyMap() }
        val merged = DtcCatalog.mergeAll(existing, parsed)
        descriptionsFile.writeText(DtcCatalog.toJson(merged))
        DtcCatalog.setImported(merged)
        _importedDescriptions.value = DtcCatalog.importedCount
        return parsed.size
    }

    fun clearImportedDescriptions() {
        descriptionsFile.delete()
        DtcCatalog.setImported(emptyMap())
        _importedDescriptions.value = 0
    }

    fun dismissActionResults() {
        if (!_action.value.running) _action.value = ActionRun()
    }

    private fun looksLikeObd(name: String): Boolean {
        val n = name.lowercase()
        return listOf("obd", "elm", "vlink", "vgate", "obdlink", "ios-vlink", "android-vlink", "konnwei", "veepeak", "carista").any { it in n }
    }

    private const val POLL_MS = 2_000L
    private const val RECONNECT_MS = 10_000L
}
