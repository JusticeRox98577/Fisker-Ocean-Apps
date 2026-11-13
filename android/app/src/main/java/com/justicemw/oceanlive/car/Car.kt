package com.justicemw.oceanlive.car

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.obd.displayName
import com.justicemw.oceanlive.strings
import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.justicemw.oceanlive.OceanService
import com.justicemw.oceanlive.OceanWidget
import com.justicemw.oceanlive.WatchLink
import com.justicemw.oceanlive.bluetoothPermissions
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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

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
    /** True when the app stopped on its own so the car can sleep; [message] says why. */
    val resting: Boolean = false,
    /** While watching the 12V with the car asleep: when the adapter last answered ATRV. */
    val watchedAt: Long? = null,
    /** While watching: quick checks couldn't reach the adapter twice or more in a row. */
    val watchUnreachable: Boolean = false,
    /** While watching: when the next 12V check is due, or null while a check is running. */
    val nextCheckAt: Long? = null,
) {
    val connected: Boolean get() = status == Status.Live

    /** What to show while watching the 12V with the car asleep. */
    @get:StringRes
    val watchStatus: Int get() = if (watchUnreachable) R.string.v12_watch_unreachable else R.string.v12_watch_status
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

enum class CarAction(@StringRes val label: Int) { Clear(R.string.clear_codes), Restart(R.string.restart) }

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
    private lateinit var v12Store: V12Store
    private lateinit var watch: WatchLink
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val bus = Mutex()
    private var job: Job? = null
    private var wantConnected = false
    private var selectedEcu: Ecu? = null
    private val tracker = Tracker()
    private var lastAbrp = 0L
    private var lastWidget = 0L
    private var parkedMark: ParkedMark? = null
    private var lastMarkSave = 0L
    private val idleTimer = IdleTimer()
    private var reconnects = 0
    /** An app screen is showing (any activity started). */
    private var inForeground = false
    /** An Android Auto screen is connected. */
    private var carScreen = false
    /** The user tapped Disconnect; don't auto-connect again until they connect by hand. */
    private var userStopped = false

    // 12V history and watching the 12V while the car sleeps.
    private val v12Recorder = V12Recorder()
    private var v12Loaded = false
    private val pending12v = mutableListOf<V12Sample>()
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private val v12Io = Dispatchers.IO.limitedParallelism(1)
    private val wakeDetector = WakeDetector()
    private val lowAlarm = LowVoltAlarm()
    /** Asks watch mode for a reading now (the app opened); never more than once a minute. */
    private val watchPoke = Channel<Unit>(Channel.CONFLATED)
    /** A watch setting changed: the next poke ends the wait whatever the spacing. */
    private var watchForce = false
    private var lastWatchRead = 0L

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
    private val _parked = MutableStateFlow<List<ParkedDrain>>(emptyList())
    /** Recent periods the car sat parked while the app wasn't connected, oldest first. */
    val parked: StateFlow<List<ParkedDrain>> = _parked.asStateFlow()
    private val _v12 = MutableStateFlow<List<V12Sample>>(emptyList())
    /** 12V readings of the last 90 days, oldest first. */
    val v12: StateFlow<List<V12Sample>> = _v12.asStateFlow()
    private val _v12Misses = MutableStateFlow<List<Long>>(emptyList())
    /** Times of quick 12V checks that couldn't reach the adapter, last 14 days. */
    val v12Misses: StateFlow<List<Long>> = _v12Misses.asStateFlow()

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
        v12Store = V12Store(app)
        val prefs = Settings.prefs(app)
        _settings.value = Settings.load(prefs)
        parkedMark = ParkedDrains.decodeMark(prefs.getString(PARKED_MARK, null))
        _parked.value = ParkedDrains.decode(prefs.getString(PARKED_HISTORY, null))
        _v12Misses.value = V12Watch.decodeMisses(prefs.getString(V12_MISSES, null))
        _state.update { it.copy(adapterName = _settings.value.adapterName) }
        scope.launch(Dispatchers.IO) {
            _history.value = store.load()
            _pastScans.value = faultStore.load()
            loadDescriptions()
        }
        scope.launch {
            val loaded = withContext(Dispatchers.IO) { v12Store.load() }
            _v12.value = loaded
            v12Recorder.load(loaded)
            v12Loaded = true
            // Readings taken while the file was loading.
            val waiting = pending12v.toList()
            pending12v.clear()
            waiting.forEach { record12v(it.time, it.volts, it.source, it.mode, it.method) }
        }
        transport.onDisconnected = { scope.launch { onLost(app.getString(R.string.msg_adapter_disconnected)) } }
        // Mirror what the phone already has to a paired watch. Only follows the state; never connects or reads.
        watch = WatchLink(app)
        scope.launch { _state.collect { watch.update(WatchSync.reading(it, _settings.value, _history.value)) } }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                inForeground = true
                if (_state.value.status == Status.Watching) watchPoke.trySend(Unit) else autoConnect()
            }

            override fun onStop(owner: LifecycleOwner) {
                inForeground = false
            }
        })
    }

    /** Android Auto tells the car when its screen comes and goes; opening it counts as wanting live data. */
    fun setCarScreenConnected(connected: Boolean) {
        carScreen = connected
        if (connected && _state.value.status == Status.Watching) watchPoke.trySend(Unit)
        else if (connected) autoConnect()
    }

    /**
     * Connects to the saved adapter when the user opens the app or Android Auto, if
     * auto-connect is on. Never called on a timer, so the app can't wake a sleeping car.
     */
    fun autoConnect() {
        val s = _settings.value
        val status = _state.value.status
        if (!s.autoStart || s.adapterAddress == null || userStopped || (status != Status.Idle && status != Status.Error)) return
        val granted = bluetoothPermissions().filter { it != Manifest.permission.POST_NOTIFICATIONS }
            .all { ContextCompat.checkSelfPermission(app, it) == PackageManager.PERMISSION_GRANTED }
        if (granted) connectSaved()
    }

    fun updateSettings(change: (Settings) -> Settings) {
        val prev = _settings.value
        val next = change(prev)
        _settings.value = next
        next.save(Settings.prefs(app))
        if (prev.watch12v && !next.watch12v && _state.value.status == Status.Watching) {
            // Watching switched off: let go of the adapter like any other stop.
            stopJob()
            transport.disconnect()
            rest(app.getString(SleepPolicy.ASLEEP_MESSAGE))
        } else if ((next.watchEveryMin != prev.watchEveryMin || next.watchKeepConnected != prev.watchKeepConnected) &&
            _state.value.status == Status.Watching
        ) {
            watchForce = true
            watchPoke.trySend(Unit)
        }
    }

    // ── Connection ──────────────────────────────────────────────

    fun scan() {
        stopJob()
        transport.disconnect()
        if (wantConnected) {
            // Scanning ends any session: save the parked-drain mark and drop the service like a disconnect.
            wantConnected = false
            endSessions()
            OceanService.stop(app)
        }
        _found.value = emptyList()
        _state.update { it.copy(status = Status.Scanning, message = null, resting = false) }
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
        userStopped = false
        reconnects = 0
        idleTimer.reset()
        // Watch mode may still hold the adapter; a different adapter needs a fresh link.
        if (address != _settings.value.adapterAddress) transport.disconnect()
        updateSettings { it.copy(adapterAddress = address, adapterName = name) }
        _state.update { it.copy(status = Status.Connecting, message = null, resting = false, adapterName = name) }
        OceanService.start(app)
        job = scope.launch { runSession(address, firstAttempt = true) }
    }

    fun connectSaved() {
        val s = _settings.value
        if (s.adapterAddress != null) connect(s.adapterAddress, s.adapterName ?: app.getString(R.string.adapter_name_fallback))
    }

    fun disconnect() {
        wantConnected = false
        userStopped = true
        stopJob()
        transport.disconnect()
        endSessions()
        _state.update { it.copy(status = Status.Idle, message = null, resting = false, abrpStatus = null, watchedAt = null, watchUnreachable = false, nextCheckAt = null) }
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
                // Still connected after watch mode, when the car woke up by itself.
                if (!transport.connected) transport.connect(address)
                bus.withLock {
                    transport.initialize()
                    selectedEcu = null
                }
                v12Recorder.startSession()
                alerts.resetHealth()
                first = false
                _state.update { it.copy(status = Status.Live, message = null) }
                if (_state.value.vin == null) readVin()
                poll()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException && e !is TimeoutCancellationException) throw e
                if (!wantConnected) return
                if (e is StopReading && V12Watch.shouldWatch(_settings.value.watch12v, userStopped)) {
                    // Stop talking to the car and only ask the adapter for the 12V now and then.
                    endSessions()
                    if (!watch12v(address)) {
                        if (wantConnected) {
                            transport.disconnect()
                            rest(e.message ?: app.getString(SleepPolicy.ASLEEP_MESSAGE))
                        }
                        return
                    }
                    // The car woke up by itself: read it again as normal.
                    first = false
                    reconnects = 0
                    idleTimer.reset()
                    _state.update {
                        it.copy(status = Status.Connecting, message = app.getString(R.string.msg_car_woke), watchedAt = null, watchUnreachable = false, nextCheckAt = null)
                    }
                    continue
                }
                // Release the adapter straight away. endSessions saves the parked-drain mark too.
                transport.disconnect()
                endSessions()
                if (e is StopReading) {
                    rest(e.message ?: app.getString(SleepPolicy.ASLEEP_MESSAGE))
                    return
                }
                if (first) {
                    // A first attempt that fails is usually the wrong adapter or the car being off.
                    wantConnected = false
                    _state.update { it.copy(status = Status.Error, message = e.message ?: app.getString(R.string.msg_could_not_connect)) }
                    OceanService.stop(app)
                    return
                }
                // The adapter dropped while the car was answering: a few short tries, then give up.
                val wait = SleepPolicy.reconnectDelay(++reconnects)
                if (wait == null) {
                    wantConnected = false
                    _state.update { it.copy(status = Status.Error, message = app.getString(SleepPolicy.GAVE_UP_MESSAGE), abrpStatus = null) }
                    OceanService.stop(app)
                    refreshWidget(force = true)
                    return
                }
                _state.update { it.copy(status = Status.Reconnecting, message = e.message) }
                refreshWidget(force = true)
                delay(wait)
            }
        }
    }

    /** Stops reading and lets go of the adapter so the car can sleep. Reconnects only when the user asks. */
    private fun rest(reason: String) {
        wantConnected = false
        _state.update { it.copy(status = Status.Idle, message = reason, resting = true, abrpStatus = null, watchedAt = null, watchUnreachable = false, nextCheckAt = null) }
        OceanService.stop(app)
        refreshWidget(force = true)
    }

    /** Thrown from the poll loop to end the session without reconnecting. */
    private class StopReading(message: String) : Exception(message)

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
        // The adapter itself says "NO DATA" when the car is asleep; that isn't the car answering.
        return Elm.carAnswered(reply) to Elm.read(reply, did)
    }

    private suspend fun poll() {
        var misses = 0
        var cycle = 0
        while (scope.isActive && wantConnected) {
            var answered = false
            var fresh12v = false
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
                        snap.copy(aux12v = bms, aux12vSource = V12Log.SOURCE_BMS)
                    } else {
                        // ATRV is answered by the adapter itself, so it doesn't count as the car answering.
                        val v = query("ATRV")?.let { Elm.adapterVoltage(it) }
                        snap.copy(aux12v = v, aux12vSource = v?.let { V12Log.SOURCE_PORT })
                    }
                    fresh12v = snap.aux12v != null
                }
            }
            snap = snap.copy(time = System.currentTimeMillis())

            if (answered) {
                misses = 0
                onReading(snap)
                // Keeps the 12V reading just taken; never asks the car for anything extra.
                if (fresh12v) record12v(snap.time, snap.aux12v!!, snap.aux12vSource ?: V12Log.SOURCE_PORT, V12Mode.of(tracker.mode))
                if (idleTimer.shouldStop(tracker.mode, inForeground, carScreen, snap.time)) {
                    throw StopReading(app.getString(SleepPolicy.PARKED_MESSAGE))
                }
            } else if (SleepPolicy.carAsleep(++misses)) {
                // Asleep or switched off. Asking again would only keep it awake.
                throw StopReading(app.getString(SleepPolicy.ASLEEP_MESSAGE))
            }
            cycle++
            delay(POLL_MS)
        }
    }

    private fun onReading(snap: Snapshot) {
        reconnects = 0
        val finished = tracker.update(snap)
        trackParked(snap)
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

    // ── 12V battery ─────────────────────────────────────────────

    private fun record12v(time: Long, volts: Double, source: String, mode: V12Mode, method: V12Method? = null) {
        if (!v12Loaded) {
            pending12v.add(V12Sample(time, volts, source, mode, method = method))
            return
        }
        val sample = v12Recorder.add(time, volts, source, mode, method) ?: return
        val all = _v12.value + sample
        if (V12Log.needsCompaction(all, time)) {
            // Keeps the file to 90 days while the app stays running for a long time.
            val kept = V12Log.trim(all, time)
            _v12.value = kept
            scope.launch(v12Io) { v12Store.save(kept) }
        } else {
            _v12.value = all
            scope.launch(v12Io) { v12Store.append(sample) }
        }
    }

    /**
     * Watching the 12V while the car sleeps (only when the user turned it on). The adapter is
     * sent ATRV and nothing else that reads: the adapter measures OBD pin 16 itself, so nothing
     * goes on the car's network. No resets, no protocol search, no module requests.
     *
     * Normally each check is a quick one: connect over Bluetooth, echo/spaces off, ATRV, and
     * disconnect straight away so the adapter can go back to sleep (a vLinker uses about 3 mA
     * asleep against about 50 mA awake). With "Keep the adapter connected" on, the link stays
     * open between checks instead and is reconnected at most every 10 minutes if it drops.
     *
     * Returns true when the car woke up by itself (13.0 V or more twice in a row), false when
     * watching ended another way (the setting turned off).
     */
    private suspend fun watch12v(address: String): Boolean {
        wakeDetector.enter()
        while (watchPoke.tryReceive().isSuccess) Unit
        watchForce = false
        _state.update { it.copy(status = Status.Watching, message = null, resting = false, abrpStatus = null, watchUnreachable = false, nextCheckAt = null) }
        refreshWidget(force = true)
        var lastLinkTry = 0L
        var quickMisses = 0
        while (wantConnected && _settings.value.watch12v) {
            val every = _settings.value.watchEveryMin
            if (V12Watch.method(_settings.value.watchKeepConnected) == V12Method.Quick) {
                lastLinkTry = 0L
                _state.update { it.copy(nextCheckAt = null) }
                val (reached, volts) = quickCheck(address)
                lastWatchRead = System.currentTimeMillis()
                if (reached) {
                    quickMisses = 0
                    _state.update { it.copy(message = null, watchUnreachable = false) }
                } else {
                    quickMisses++
                    addMiss(lastWatchRead)
                    // Probably the adapter switched Bluetooth off in its own sleep. Keep trying at the
                    // chosen interval (a Bluetooth connect only); never fall back to keeping it open.
                    _state.update { it.copy(message = null, watchUnreachable = V12Watch.unreachable(quickMisses)) }
                }
                if (volts != null) onWatchReading(volts, V12Method.Quick)
                if (wakeDetector.add(volts)) return true
                refreshWidget(force = true)
                watchWait(V12Watch.quickDelay(every, wakeDetector.confirming), needLink = false)
                continue
            }
            quickMisses = 0
            if (_state.value.watchUnreachable) _state.update { it.copy(watchUnreachable = false) }
            if (!transport.connected) {
                val since = System.currentTimeMillis() - lastLinkTry
                val gap = V12Watch.nextDelay(every, connected = false, confirmingWake = false)
                if (since < gap) {
                    watchWait(gap - since, needLink = true)
                    continue
                }
                lastLinkTry = System.currentTimeMillis()
                _state.update { it.copy(nextCheckAt = null) }
                try {
                    transport.connect(address)
                    bus.withLock {
                        transport.initializeForWatch()
                        selectedEcu = null
                    }
                    _state.update { it.copy(message = null) }
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException && e !is TimeoutCancellationException) throw e
                    transport.disconnect()
                    val minutes = V12Watch.nextDelay(every, connected = false, confirmingWake = false) / 60_000
                    _state.update { it.copy(message = app.getString(R.string.msg_watch_unreachable, minutes)) }
                    continue
                }
            }
            val volts = try {
                bus.withLock { query(Elm.READ_VOLTAGE) }?.let { Elm.adapterVoltage(it) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException && e !is TimeoutCancellationException) throw e
                null
            }
            lastWatchRead = System.currentTimeMillis()
            if (volts != null) onWatchReading(volts, V12Method.KeptOpen)
            if (wakeDetector.add(volts)) return true
            if (!transport.connected) continue
            watchWait(V12Watch.nextDelay(every, connected = true, confirmingWake = wakeDetector.confirming), needLink = false)
        }
        return false
    }

    /**
     * One quick 12V check: connect (if not already), echo/spaces off, ATRV, then always let go
     * of the adapter so it can sleep. All within [V12Watch.QUICK_TIMEOUT_MS]. Returns whether the
     * adapter was reached, and the voltage it read.
     */
    private suspend fun quickCheck(address: String): Pair<Boolean, Double?> {
        var reached = false
        return try {
            val volts = withTimeout(V12Watch.QUICK_TIMEOUT_MS) {
                if (!transport.connected) transport.connect(address)
                reached = true
                bus.withLock {
                    selectedEcu = null
                    for (command in Elm.quickCheckCommands) {
                        try {
                            transport.send(command, 3_000)
                        } catch (_: TimeoutCancellationException) {
                            // This command's own wait ran out; stop only if the whole check did.
                            currentCoroutineContext().ensureActive()
                        }
                    }
                    transport.send(Elm.READ_VOLTAGE, 4_000)
                }.let { Elm.adapterVoltage(it) }
            }
            reached to volts
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException && e !is TimeoutCancellationException) throw e
            // Stopped (Disconnect, setting off) as the check timed out: not an unreachable adapter.
            currentCoroutineContext().ensureActive()
            reached to null
        } finally {
            transport.disconnect()
        }
    }

    private fun addMiss(time: Long) {
        val list = V12Watch.addMiss(_v12Misses.value, time)
        _v12Misses.value = list
        Settings.prefs(app).edit { putString(V12_MISSES, V12Watch.encodeMisses(list)) }
    }

    /**
     * Waits [ms], or less when the app asks for a reading (at most once a minute; with the
     * adapter kept connected, only while it is connected) or a watch setting changed.
     */
    private suspend fun watchWait(ms: Long, needLink: Boolean) {
        var until = System.currentTimeMillis() + ms
        _state.update { it.copy(nextCheckAt = until) }
        while (true) {
            val left = until - System.currentTimeMillis()
            if (left <= 0) return
            val poked = withTimeoutOrNull(left) { watchPoke.receive() } != null
            if (!poked) return
            if (!wantConnected || !_settings.value.watch12v) return
            val quick = V12Watch.method(_settings.value.watchKeepConnected) == V12Method.Quick
            if (watchForce) {
                watchForce = false
                // A link that is open but no longer wanted is let go (or a kept link made) straight away.
                // With quick checks and the link already closed, a new interval only moves the next
                // check: no extra Bluetooth connect, however often the setting is changed.
                if (!quick || transport.connected) return
                if (!wakeDetector.confirming) {
                    until = V12Watch.quickDue(lastWatchRead, _settings.value.watchEveryMin)
                    _state.update { it.copy(nextCheckAt = until) }
                }
                continue
            }
            if (!needLink && (quick || transport.connected) && System.currentTimeMillis() - lastWatchRead >= V12Watch.MIN_SPACING_MS) return
        }
    }

    private fun onWatchReading(volts: Double, method: V12Method) {
        val now = System.currentTimeMillis()
        _state.update { it.copy(snapshot = it.snapshot.copy(aux12v = volts, aux12vSource = V12Log.SOURCE_ASLEEP), watchedAt = now) }
        record12v(now, volts, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, method)
        lowAlarm.check(volts)?.let { alerts.low12v(it, volts, _settings.value) }
        refreshWidget(force = true)
    }

    // ── Parked drain ────────────────────────────────────────────

    /**
     * Remembers the last reading, and on the first reading after a long gap
     * records how much the battery dropped while the car sat parked.
     */
    private fun trackParked(snap: Snapshot) {
        val soc = snap.soc ?: return
        val chargingNow = tracker.mode == Mode.Charging || (snap.powerKw ?: 0.0) > Tracker.CHARGE_START_KW
        ParkedDrains.measure(parkedMark, soc, snap.odometerKm, snap.time, chargingNow)?.let { drain ->
            val list = ParkedDrains.add(_parked.value, drain)
            _parked.value = list
            Settings.prefs(app).edit { putString(PARKED_HISTORY, ParkedDrains.encode(list)) }
        }
        parkedMark = ParkedMark(snap.time, soc, snap.odometerKm, tracker.mode == Mode.Charging)
        // Saved now and then, so it survives the app being closed without a goodbye.
        if (snap.time - lastMarkSave >= 60_000) saveParkedMark()
    }

    private fun saveParkedMark() {
        val mark = parkedMark ?: return
        lastMarkSave = mark.time
        Settings.prefs(app).edit { putString(PARKED_MARK, ParkedDrains.encodeMark(mark)) }
    }

    private fun addHistory(entry: HistoryEntry) {
        if (entry.kind == EntryKind.Charge) alerts.chargingStopped(entry, _settings.value)
        val keep = when (entry.kind) {
            EntryKind.Drive -> (entry.distanceKm ?: 0.0) >= 0.3
            EntryKind.Charge -> entry.kwh >= 0.2
        }
        if (!keep) return
        val list = ChargeCurve.trim(_history.value + entry)
        _history.value = list
        scope.launch(Dispatchers.IO) { store.save(list) }
    }

    private fun endSessions() {
        saveParkedMark()
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
            val error = Abrp.send(tlm, settings, app.strings())
            _state.update { it.copy(abrpStatus = error ?: app.getString(R.string.abrp_sent)) }
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
                        _faults.update { it.copy(progress = index, current = ecu.displayName(app.strings())) }
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
                _faults.update { it.copy(running = false, error = e.message ?: app.getString(R.string.msg_scan_stopped)) }
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
                        _versions.update { it.copy(progress = index, current = ecu.displayName(app.strings())) }
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
            !s.connected -> app.getString(R.string.blocked_not_connected)
            s.mode == Mode.Driving -> app.getString(R.string.blocked_driving)
            s.mode == Mode.Charging -> app.getString(R.string.blocked_charging)
            _faults.value.running || _versions.value.running -> app.getString(R.string.blocked_scan_running)
            _action.value.running -> app.getString(R.string.blocked_action_running)
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
                        _action.update { it.copy(current = ecu.displayName(app.strings()), done = index) }
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

    private const val PARKED_MARK = "parked_mark"
    private const val PARKED_HISTORY = "parked_history"
    private const val V12_MISSES = "v12_misses"
    private const val POLL_MS = 2_000L
}
