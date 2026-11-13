import BackgroundTasks
import Foundation
import UIKit

struct CarState: Equatable {
    var status: Status = .idle
    var message: String?
    var adapterName: String?
    var snapshot = Snapshot()
    var mode: Mode = .parked
    var currentCharge: HistoryEntry?
    var currentDrive: HistoryEntry?
    var vin: String?
    var abrpStatus: String?
    var lastUpdate: Int64?
    /// Charge lost while parked, measured when this connection started.
    var parked: ParkedDrain?
    /// Why the app stopped reading on its own (the car went to sleep, or it sat parked with the app
    /// in the background). Nil while connected, and after the user disconnects.
    var stopped: String?
    /// The car is asleep and the app only asks the adapter for the 12V now and then.
    var watching = false
    /// When the next 12V check is due while watching.
    var nextWatch: Int64?
    /// Quick checks couldn't reach the adapter twice in a row or more (it has probably turned its Bluetooth off).
    var watchUnreachable = false

    var connected: Bool { status == .live }
    /// The status line while watching the 12V.
    var watchStatus: String { V12Watch.status(unreachable: watchUnreachable) }
}

struct FaultScan {
    var running = false
    var progress = 0
    var total = Ecus.scanList.count
    var current: String?
    var codes: [Dtc] = []
    /// Module code to what happened: "ok", "no answer", "incomplete", ...
    var modules: [String: String] = [:]
    var finishedAt: Int64?
    var error: String?
    /// What changed since the last scan of this car.
    var changes = ScanChanges()
}

/// Reading software versions and part numbers from the modules. Read-only.
struct VersionRead {
    var running = false
    var progress = 0
    var total = 0
    var current: String?
    var list: [ModuleVersion] = []
    var finishedAt: Int64?
    var error: String?
}

enum CarAction {
    case clear, restart

    var label: String { self == .clear ? String(localized: "Clear codes") : String(localized: "Restart") }
}

struct ActionOutcome: Identifiable {
    let ecu: Ecu
    let action: CarAction
    let result: UdsResult
    /// Codes the module still reports after the action, or nil if the re-check got no answer.
    let remaining: Int?

    var id: String { ecu.code }
}

struct ActionRun {
    var running = false
    var action: CarAction?
    var current: String?
    var done = 0
    var total = 0
    var outcomes: [ActionOutcome] = []
}

/// One request at a time on the adapter, across the poll loop, the fault scan and actions.
@MainActor
final class AsyncLock {
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func lock() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func unlock() {
        if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
}

/// The one connection to the car, shared by every screen.
@MainActor
final class Car: ObservableObject {
    /// One connection shared by the phone screens and CarPlay.
    static let shared = Car()

    @Published private(set) var state = CarState()
    @Published private(set) var found: [FoundAdapter] = []
    @Published private(set) var history: [HistoryEntry] = []
    @Published private(set) var settings: Settings
    @Published private(set) var faults = FaultScan()
    @Published private(set) var action = ActionRun()
    @Published private(set) var importedCount = 0
    @Published private(set) var pastScans: [SavedScan] = []
    @Published private(set) var versions = VersionRead()
    /// The last 30 parked periods, oldest first.
    @Published private(set) var drains: [ParkedDrain] = []
    /// Saved 12V readings, last 90 days, oldest first.
    @Published private(set) var v12: [V12Sample] = []
    /// Quick checks that couldn't reach the adapter during the latest night of watching.
    @Published private(set) var v12Missed = 0

    private let transport = ElmTransport()
    private let bus = AsyncLock()
    private let tracker = Tracker()
    private let alerts = Alerts()
    private let location = LocationFeed()
    /// Charging Live Activity and home-screen widget. Display only.
    private let liveActivity = LiveActivityController()
    /// Latest reading for the Apple Watch app. Display only.
    private let watchLink = WatchLink()
    private var task: Task<Void, Never>?
    private var wantConnected = false
    private var selectedEcu: Ecu?
    private var lastAbrp: Int64 = 0
    /// Compare the first reading of a connection with the saved anchor.
    private var parkedCheckPending = false
    private var latestAnchor: ParkedAnchor?
    private var anchorSavedAt: Int64 = 0

    private var carPlayConnected = false
    /// The user tapped Disconnect: don't connect again just because the app came back on screen.
    private var userStopped = false
    /// When to stop reading so the car can sleep.
    private var sleepPolicy = SleepPolicy()
    /// Reconnect attempts since the adapter dropped. Back to 0 once the car answers.
    private var adapterRetries = 0

    /// The next 12V reading of this connection is its first.
    private var v12FirstOfConnection = true
    private var v12Alert = V12LowAlert(level: V12Store.loadAlertLevel())
    /// Watching the 12V while the car sleeps, or nil.
    private var watch: V12Watch?
    private var watchNextAt: Int64 = 0
    private var watchLastAt: Int64 = 0
    private var watchBusy = false
    /// The quick check in progress, so its time limit and its disconnect never touch a later connection.
    private var quickToken: UUID?
    /// Extra time asked of iPhone for the quick check in progress, so the app isn't paused with the link open.
    private var quickBackgroundTask: UIBackgroundTaskIdentifier = .invalid

    /// Seconds between readings: every second while CarPlay is showing, every two otherwise.
    private var pollInterval: Double { carPlayConnected ? 1 : 2 }

    func setCarPlayConnected(_ on: Bool) { carPlayConnected = on }

    /// The phone app went off screen or came back. Coming back connects again if auto-connect is on,
    /// unless the user disconnected. Nothing reconnects while the app stays in the background.
    func setInBackground(_ on: Bool) {
        guard !on else { return }
        // While watching the 12V, coming back on screen only asks the adapter for the 12V, so the car stays asleep.
        if watch != nil {
            if watchCheckDue {
                watchSoon()
            } else if task == nil {
                // iPhone closed the app since the last check: just wait for the next one.
                task = Task { await runWatch() }
            }
        } else if !userStopped {
            autoStart()
        }
    }

    /// Whether the phone app is on screen. Asked of the scenes themselves, not remembered, so a launch
    /// that only brings up CarPlay (no phone screen at all) counts as the background once CarPlay goes.
    private var phoneOnScreen: Bool {
        UIApplication.shared.connectedScenes.contains {
            $0.session.role == .windowApplication && $0.activationState == .foregroundActive
        }
    }

    init() {
        settings = Settings.load()
        state.adapterName = settings.adapterName
        history = HistoryStore.load()
        pastScans = FaultHistoryStore.load()
        drains = ParkedStore.loadDrains()
        v12 = V12Store.load()
        loadDescriptions()
        location.setEnabled(settings.abrpEnabled && settings.abrpLocation)
        transport.onDisconnected = { [weak self] in self?.adapterDropped() }
        v12Missed = V12Store.loadMissed().total
        watchLastAt = V12Store.loadLastCheck()
        // iPhone ended the app while it was watching the 12V: carry on, without connecting until it gets time.
        if settings.v12Watch && V12Background.active && settings.adapterId != nil {
            beginWatch(carStoppedAnswering: true, at: nowMs() - V12Watch.settleMs, fresh: false)
        }
    }

    func updateSettings(_ change: (inout Settings) -> Void) {
        let before = settings
        var next = settings
        change(&next)
        settings = next
        next.save()
        location.setEnabled(next.abrpEnabled && next.abrpLocation)
        updateScreenLock()
        if !next.v12Watch && watch != nil {
            // Turned off while watching: let go of the adapter, as before this setting existed.
            stopTask()
            transport.disconnect()
            endWatch()
            state.stopped = SleepPolicy.asleepMessage
        } else if watch != nil && next.v12WatchKeepConnected != before.v12WatchKeepConnected {
            state.watchUnreachable = !next.v12WatchKeepConnected && (watch?.adapterUnreachable ?? false)
            state.stopped = state.watchStatus
            if next.v12WatchKeepConnected {
                // Open the link now and keep it, as the user asked.
                watchSoon()
            } else if !watchBusy {
                // Back to quick checks: let go of the link so the adapter can sleep until the next check.
                transport.disconnect()
            }
        }
    }

    // MARK: Connection

    func scan() {
        stopTask()
        endWatch()
        transport.disconnect()
        found = []
        state.status = .scanning
        state.message = nil
        state.stopped = nil
        task = Task {
            do {
                try await transport.startScan { [weak self] adapter in
                    guard let self else { return }
                    var list = self.found.filter { $0.id != adapter.id }
                    list.append(adapter)
                    self.found = list.sorted { a, b in
                        let la = Self.looksLikeObd(a.name), lb = Self.looksLikeObd(b.name)
                        return la != lb ? la : a.rssi > b.rssi
                    }
                }
            } catch {
                state.status = .error
                state.message = error.localizedDescription
            }
        }
    }

    func cancelScan() {
        transport.stopScan()
        state.status = .idle
    }

    func connect(_ adapter: FoundAdapter) { connect(id: adapter.id, name: adapter.name) }

    func connect(id: UUID, name: String) {
        stopTask()
        endWatch()
        wantConnected = true
        userStopped = false
        updateSettings { $0.adapterId = id.uuidString; $0.adapterName = name }
        state.status = .connecting
        state.message = nil
        state.stopped = nil
        state.adapterName = name
        task = Task { await runSession(id: id, firstAttempt: true) }
    }

    func connectSaved() {
        guard let raw = settings.adapterId, let id = UUID(uuidString: raw) else { return }
        connect(id: id, name: settings.adapterName ?? String(localized: "Adapter"))
    }

    func disconnect() {
        wantConnected = false
        userStopped = true
        stopTask()
        endWatch()
        transport.disconnect()
        endSessions()
        state.status = .idle
        state.message = nil
        state.stopped = nil
        state.abrpStatus = nil
        updateScreenLock()
    }

    /// Stops reading and lets go of the adapter so the car can sleep. No timer brings it back:
    /// the next connection waits for the user to open the app, CarPlay to connect, or a tap on Connect.
    private func stopReading(_ reason: String) {
        wantConnected = false
        task = nil // called from the session itself, as its last step
        transport.disconnect()
        endSessions() // saves the parked anchor, like a disconnect
        sleepPolicy.reset()
        adapterRetries = 0
        state.status = .idle
        state.message = nil
        state.stopped = reason
        state.abrpStatus = nil
        updateScreenLock()
    }

    func forgetAdapter() {
        disconnect()
        updateSettings { $0.adapterId = nil; $0.adapterName = nil }
        state.adapterName = nil
    }

    /// Auto-connect when the app opens or comes back on screen, or CarPlay connects. Never on a timer.
    func autoStart() {
        let notReading = state.status == .idle || state.status == .error
        if settings.autoStart && settings.adapterId != nil && notReading { connectSaved() }
    }

    private func stopTask() {
        task?.cancel()
        task = nil
        transport.stopScan()
    }

    private func runSession(id: UUID, firstAttempt: Bool) async {
        var first = firstAttempt
        adapterRetries = 0
        sleepPolicy.reset()
        while wantConnected && !Task.isCancelled {
            do {
                // Watch mode may have kept the link to this adapter open.
                if transport.connectedId != id {
                    transport.disconnect()
                    try await transport.connect(id: id)
                }
                await bus.lock()
                do {
                    try await transport.initialize()
                    selectedEcu = nil
                    bus.unlock()
                } catch {
                    bus.unlock()
                    throw error
                }
                alerts.resetHealth()
                parkedCheckPending = true
                v12FirstOfConnection = true
                first = false
                state.status = .live
                state.message = nil
                updateScreenLock()
                if state.vin == nil { try await readVin() }
                try await poll()
            } catch {
                if Task.isCancelled || !wantConnected { return }
                if let stop = error as? CarError {
                    if settings.v12Watch {
                        // Stop reading the car, but keep the adapter and ask it alone for the 12V now and then.
                        enterWatch(carStoppedAnswering: stop == .asleep)
                        return
                    }
                    // The car went quiet, or sat parked long enough: stop for good so it can sleep.
                    stopReading(stop.message)
                    return
                }
                transport.disconnect()
                endSessions()
                if first {
                    // A first attempt that fails is usually the wrong adapter or the car being off.
                    wantConnected = false
                    state.status = .error
                    state.message = error.localizedDescription
                    updateScreenLock()
                    return
                }
                // The adapter dropped while the car was answering: a few short tries, then stop.
                adapterRetries += 1
                guard let delay = SleepPolicy.retryDelay(attempt: adapterRetries) else {
                    if settings.v12Watch {
                        // Watch mode tries the adapter again at most once per check interval, and only asks it for the 12V.
                        enterWatch(carStoppedAnswering: true)
                        return
                    }
                    stopReading(SleepPolicy.adapterLostMessage)
                    return
                }
                state.status = .reconnecting
                state.message = error.localizedDescription
                updateScreenLock()
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    private func adapterDropped() {
        if watch != nil {
            // A kept link: try it again, no more than once per check interval. Quick checks let go of the link
            // on purpose, and a drop during one only fails that check.
            if settings.v12WatchKeepConnected { watchSoon() }
            return
        }
        onLost(String(localized: "Adapter disconnected."))
    }

    private func onLost(_ reason: String) {
        guard wantConnected, state.status == .live else { return }
        state.status = .reconnecting
        state.message = reason
    }

    private func updateScreenLock() {
        UIApplication.shared.isIdleTimerDisabled = state.status == .live && settings.keepScreenOn
    }

    // MARK: Polling

    /// One command; nil when the adapter timed out. Other errors (disconnects) are thrown.
    private func query(_ command: String, timeout: Double = 4) async throws -> String? {
        do {
            return try await transport.send(command, timeout: timeout)
        } catch ElmError.timeout {
            return nil
        }
    }

    private func selectEcu(_ ecu: Ecu) async throws {
        if selectedEcu == ecu { return }
        _ = try await query("ATSH" + ecu.request)
        _ = try await query("ATCRA" + ecu.response)
        selectedEcu = ecu
    }

    /// Whether the car answered (a "NO DATA" from the adapter doesn't count), and the value.
    private func read(_ did: Did) async throws -> (Bool, Double?) {
        try await selectEcu(did.ecu)
        guard let reply = try await query(did.command) else { return (false, nil) }
        return (Elm.carAnswered(reply), Elm.read(reply, did))
    }

    private func poll() async throws {
        var misses = 0
        var cycle = 0
        while wantConnected && !Task.isCancelled {
            let cycleStart = Date()
            var answered = false
            var snap = state.snapshot
            var fresh12v: (volts: Double, source: String)?
            let flip = settings.flipCurrent
            await bus.lock()
            do {
                var dids = Pids.fast
                if cycle % 5 == 0 { dids += Pids.slow.filter { $0 != Pids.aux12v } + [Pids.odometer] }
                for did in dids {
                    let (got, value) = try await read(did)
                    if got { answered = true }
                    let v = (did == Pids.packA && flip) ? value.map { -$0 } : value
                    // Keep slow values between their reads; fast ones go blank if the car stops answering.
                    if v != nil || Pids.fast.contains(did) { snap = snap.with(did.key, v) }
                }
                if cycle % 5 == 0 {
                    // 12V: the BMS's own reading of the 12V terminal, else the adapter's supply voltage (OBD pin 16).
                    if let bms = try await read(Pids.aux12v).1 {
                        snap.aux12v = bms
                        snap.aux12vSource = V12Source.bms
                        fresh12v = (bms, V12Source.bms)
                    } else {
                        // The adapter answers this itself, so it says nothing about whether the car is awake.
                        let reply = try await query("ATRV")
                        let v = reply.flatMap { Elm.adapterVoltage($0) }
                        snap.aux12v = v
                        snap.aux12vSource = v == nil ? nil : V12Source.port
                        if let v { fresh12v = (v, V12Source.port) }
                    }
                }
                bus.unlock()
            } catch {
                bus.unlock()
                throw error
            }
            snap.time = nowMs()

            if answered {
                misses = 0
                adapterRetries = 0
                onReading(snap)
                // Saves a reading the poll took anyway; never asks the car for anything extra.
                if let r = fresh12v { recordV12(r.volts, source: r.source, mode: V12Sample.Kind(tracker.mode)) }
            } else {
                misses += 1
            }
            switch sleepPolicy.afterPoll(misses: misses, retrying: adapterRetries > 0, mode: tracker.mode,
                                         background: !phoneOnScreen, carScreen: carPlayConnected, now: nowMs()) {
            case .keepReading: break
            case .carAsleep: throw CarError.asleep
            case .parkedIdle: throw CarError.parkedIdle
            }
            cycle += 1
            // Wait out the rest of the interval, so a reading lands every second (or two) no matter how long the adapter took.
            let wait = Swift.max(pollInterval - Date().timeIntervalSince(cycleStart), 0.05)
            try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
        }
    }

    private func onReading(_ snap: Snapshot) {
        let finished = tracker.update(snap)
        state.snapshot = snap
        state.lastUpdate = snap.time
        state.mode = tracker.mode
        state.currentCharge = tracker.currentCharge
        state.currentDrive = tracker.currentDrive
        finished.forEach(addHistory)
        alerts.check(snap, mode: tracker.mode, settings: settings)
        trackParked(snap)
        maybeSendAbrp(snap)
        liveActivity.onReading(state, settings: settings, history: history)
        watchLink.onReading(state, settings: settings, history: history)
    }

    // MARK: 12V log

    /// Saves a 12V reading: about once a minute, plus any change of 0.05 V or more.
    private func recordV12(_ volts: Double, source: String, mode: V12Sample.Kind, method: V12Method = .keptOpen) {
        let now = nowMs()
        let first = v12FirstOfConnection
        v12FirstOfConnection = false
        let resting = V12Log.isResting(volts: volts, mode: mode, firstOfConnection: first, now: now, in: v12)
        let sample = V12Sample(time: now, volts: volts, source: source, mode: mode, resting: resting, method: method)
        // Readings while the car is awake only re-arm the low-12V warning.
        checkV12Alert(volts, asleep: mode == .asleep)
        guard V12Log.shouldKeep(sample, after: v12.last) else { return }
        var list = v12
        list.append(sample)
        if let oldest = list.first, now - oldest.time > V12Log.keepMs + 86_400_000 {
            // Trim the file about once a day.
            list = V12Log.capped(list, now: now)
            V12Store.save(list)
        } else {
            V12Store.append(sample)
        }
        v12 = list
    }

    private func checkV12Alert(_ volts: Double, asleep: Bool) {
        let before = v12Alert.level
        let fire = v12Alert.check(volts, asleep: asleep)
        if v12Alert.level != before { V12Store.saveAlertLevel(v12Alert.level) }
        if fire != .none && settings.healthAlerts { alerts.v12Low(volts, veryLow: fire == .veryLow) }
    }

    // MARK: Watching the 12V while the car sleeps

    /// Called from the session instead of stopReading when the setting is on. Reading the car stops
    /// exactly as before. Normally the app then lets go of the adapter and only connects for a quick check
    /// now and then; with "Keep the adapter connected" on, the Bluetooth link stays open instead.
    private func enterWatch(carStoppedAnswering: Bool) {
        wantConnected = false
        endSessions()
        sleepPolicy.reset()
        adapterRetries = 0
        state.abrpStatus = nil
        beginWatch(carStoppedAnswering: carStoppedAnswering, at: nowMs(), fresh: true)
        // A first reading straight away marks when the car went to sleep. A quick check uses the link that is
        // still open for it, then lets go.
        watchNextAt = nowMs()
        task = Task { await runWatch() } // replaces the session, which ends right after this
        updateScreenLock()
    }

    /// `fresh` starts a new night of watching; otherwise it carries on one iPhone interrupted by closing the app.
    private func beginWatch(carStoppedAnswering: Bool, at time: Int64, fresh: Bool) {
        var missed = V12Store.loadMissed()
        if fresh {
            missed = (0, 0)
            V12Store.saveMissed(inRow: 0, total: 0)
        }
        let w = V12Watch(startedAt: time, carStoppedAnswering: carStoppedAnswering,
                         missedInRow: missed.inRow, missedTotal: missed.total)
        watch = w
        v12Missed = w.missedTotal
        let intervalMs = Int64(V12Watch.interval(settings.v12WatchMinutes)) * 60_000
        watchNextAt = !fresh && watchLastAt > 0 ? watchLastAt + intervalMs : nowMs() + intervalMs
        state.status = .idle
        state.message = nil
        state.watchUnreachable = !settings.v12WatchKeepConnected && w.adapterUnreachable
        state.stopped = state.watchStatus
        state.watching = true
        state.nextWatch = watchNextAt
        V12Background.setActive(true, minutes: settings.v12WatchMinutes)
    }

    /// Leaves watch mode. Doesn't touch the adapter link: the caller decides.
    private func endWatch() {
        guard watch != nil || state.watching else { return }
        watch = nil
        quickToken = nil
        state.watching = false
        state.nextWatch = nil
        if state.stopped == V12Watch.statusText || state.stopped == V12Watch.unreachableText { state.stopped = nil }
        state.watchUnreachable = false
        V12Background.setActive(false, minutes: settings.v12WatchMinutes)
    }

    /// Whether iPhone giving the app a moment (a background refresh, or the app coming on screen) should check now.
    private var watchCheckDue: Bool {
        if settings.v12WatchKeepConnected { return nowMs() - watchLastAt >= 60_000 }
        // Also due when the planned check has come, such as the quick re-check after a first high reading.
        if watchNextAt > 0 && nowMs() >= watchNextAt { return true }
        return V12Watch.checkDue(now: nowMs(), lastCheck: watchLastAt, intervalMinutes: settings.v12WatchMinutes)
    }

    /// Takes a 12V reading now if one is due, or tries the link again (no more than V12Watch allows).
    private func watchSoon() {
        guard watch != nil else { return }
        watchNextAt = Swift.min(watchNextAt, nowMs())
        task?.cancel()
        task = Task { await runWatch() }
    }

    private func runWatch() async {
        while watch != nil && !Task.isCancelled {
            let wait = watchNextAt - nowMs()
            if wait > 0 || watchBusy {
                try? await Task.sleep(nanoseconds: UInt64(Swift.max(wait, 1000)) * 1_000_000)
                continue
            }
            await watchReading()
        }
    }

    /// One check, either a quick one (the normal way) or over the kept link. Only adapter commands either way.
    private func watchReading() async {
        guard watch != nil, !watchBusy else { return }
        watchBusy = true
        defer { watchBusy = false }
        guard let raw = settings.adapterId, let id = UUID(uuidString: raw) else {
            endWatch()
            return
        }
        switch V12Watch.method(keepConnected: settings.v12WatchKeepConnected) {
        case .keptOpen:
            await keptOpenReading(id: id)
            // Switched back to quick checks during this one: let go of the link so the adapter can sleep.
            if watch != nil && !settings.v12WatchKeepConnected { transport.disconnect() }
        case .quick:
            await quickCheck(id: id)
        }
    }

    private func endQuickBackgroundTask() {
        guard quickBackgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(quickBackgroundTask)
        quickBackgroundTask = .invalid
    }

    private func markChecked(_ time: Int64) {
        watchLastAt = time
        V12Store.saveLastCheck(time)
    }

    /// A quick check: connect over Bluetooth, turn echo and spaces off, ask the adapter for its voltage (ATRV),
    /// then disconnect straight away so the adapter can sleep until the next one. ATE0, ATS0 and ATRV are
    /// answered by the adapter itself; nothing reaches the car's network. The whole check gives up after about 15 s.
    private func quickCheck(id: UUID) async {
        let token = UUID()
        quickToken = token
        // Ask iPhone for time to finish, even if the app leaves the screen meanwhile, so it is never paused
        // halfway with the link still open (which would keep the adapter awake). Out of time: let go now.
        endQuickBackgroundTask()
        quickBackgroundTask = UIApplication.shared.beginBackgroundTask(withName: "12V check") { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.quickToken == token { self.transport.abandon() }
                self.endQuickBackgroundTask()
            }
        }
        defer { endQuickBackgroundTask() }
        let deadline = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(V12Watch.quickCheckTimeoutMs) * 1_000_000)
            guard let self, !Task.isCancelled, self.quickToken == token else { return }
            // Letting go of the link ends a connect or a command still waiting.
            self.transport.abandon()
        }
        var volts: Double?
        do {
            // Right after the car went to sleep the link from reading it is still open: use it once.
            let alreadyOpen = transport.connectedId == id
            if !alreadyOpen {
                transport.disconnect()
                try await transport.connect(id: id)
            }
            await bus.lock()
            do {
                if !alreadyOpen { try await transport.initialize(Elm.quickCheckCommands) }
                let reply = try await transport.send(Elm.voltageCommand, timeout: 4)
                volts = Elm.adapterVoltage(reply)
                bus.unlock()
            } catch {
                bus.unlock()
                throw error
            }
        } catch {
            // Not reachable this time, or no answer in time: counted below.
        }
        deadline.cancel()
        // The user connected or stopped watching meanwhile: leave the link to them.
        guard quickToken == token, watch != nil else { return }
        quickToken = nil
        // Let go straight away so the adapter can sleep until the next check.
        transport.disconnect()
        guard var w = watch else { return }
        let now = nowMs()
        markChecked(now)
        guard let reading = volts else {
            // Keep trying at the chosen interval, with Bluetooth connect attempts only. Never switches to a kept link.
            let unreachable = w.quickCheckFailed()
            watch = w
            V12Store.saveMissed(inRow: w.missedInRow, total: w.missedTotal)
            v12Missed = w.missedTotal
            state.watchUnreachable = unreachable
            state.stopped = state.watchStatus
            watchNextAt = now + Int64(V12Watch.interval(settings.v12WatchMinutes)) * 60_000
            state.nextWatch = watchNextAt
            return
        }
        if w.missedInRow > 0 {
            w.quickCheckWorked()
            V12Store.saveMissed(inRow: w.missedInRow, total: w.missedTotal)
        }
        watch = w
        state.watchUnreachable = false
        state.stopped = state.watchStatus
        afterWatchReading(reading, method: .quick, id: id, now: now)
    }

    /// A check over the kept link: open it if it dropped (at most once per interval), then ATRV and nothing else.
    /// ATRV is answered by the adapter itself from OBD pin 16; it puts nothing on the car's network.
    private func keptOpenReading(id: UUID) async {
        let minutes = settings.v12WatchMinutes
        let intervalMs = Int64(V12Watch.interval(minutes)) * 60_000
        if transport.connectedId != id {
            guard var w = watch else { return }
            let allowed = w.mayReconnect(now: nowMs(), intervalMinutes: minutes)
            watch = w
            guard allowed else {
                watchNextAt = (w.lastReconnect ?? nowMs()) + intervalMs
                state.nextWatch = watchNextAt
                return
            }
            do {
                transport.disconnect()
                try await transport.connect(id: id)
                // Only how the adapter formats its replies: no reset, no protocol search, nothing to the car.
                await bus.lock()
                do {
                    try await transport.initialize(Elm.watchInitCommands)
                    bus.unlock()
                } catch {
                    bus.unlock()
                    throw error
                }
            } catch {
                transport.disconnect()
                guard watch != nil else { return }
                watchNextAt = nowMs() + intervalMs
                state.nextWatch = watchNextAt
                return
            }
            guard watch != nil else { return } // the user disconnected meanwhile
        }
        await bus.lock()
        let reply = try? await query(Elm.voltageCommand)
        bus.unlock()
        guard watch != nil else { return }
        let now = nowMs()
        markChecked(now)
        guard let volts = reply.flatMap({ Elm.adapterVoltage($0) }) else {
            watchNextAt = now + intervalMs
            state.nextWatch = watchNextAt
            return
        }
        afterWatchReading(volts, method: .keptOpen, id: id, now: now)
    }

    /// Saves a reading taken while watching and decides what comes next.
    private func afterWatchReading(_ volts: Double, method: V12Method, id: UUID, now: Int64) {
        guard var w = watch else { return }
        recordV12(volts, source: V12Source.asleep, mode: .asleep, method: method)
        state.snapshot.aux12v = volts
        state.snapshot.aux12vSource = V12Source.asleep
        let decision = w.afterReading(volts, now: now)
        watch = w
        if decision == .carWoke {
            resumeAfterWake(id: id)
            return
        }
        watchNextAt = now + w.nextDelayMs(intervalMinutes: settings.v12WatchMinutes)
        state.nextWatch = watchNextAt
    }

    /// The 12V stayed at 13.0 V or more: the car woke up by itself, so read it as usual again.
    private func resumeAfterWake(id: UUID) {
        endWatch()
        wantConnected = true
        userStopped = false
        state.status = .connecting
        state.stopped = nil
        task = Task { await runSession(id: id, firstAttempt: false) }
    }

    /// A background refresh from iPhone: one check if the interval has passed (a quick check, or the kept link
    /// reopened if it dropped). Never starts reading the car on its own.
    func handleV12Refresh(_ bgTask: BGTask) {
        let finish = BackgroundFinish(bgTask)
        guard settings.v12Watch, V12Background.active, settings.adapterId != nil else {
            finish.finish(true)
            return
        }
        V12Background.schedule(minutes: settings.v12WatchMinutes)
        // Already reading the car: nothing to do.
        if state.status != .idle && state.status != .error {
            finish.finish(true)
            return
        }
        if watch == nil { beginWatch(carStoppedAnswering: true, at: nowMs() - V12Watch.settleMs, fresh: false) }
        task?.cancel()
        task = nil
        let work = Task {
            for _ in 0..<50 where watchBusy { try? await Task.sleep(nanoseconds: 200_000_000) }
            if watchCheckDue { await watchReading() }
            if watch != nil && task == nil { task = Task { await runWatch() } }
            finish.finish(true)
        }
        bgTask.expirationHandler = {
            work.cancel()
            Task { @MainActor in finish.finish(false) }
        }
    }

    // MARK: Parked drain

    private func trackParked(_ snap: Snapshot) {
        guard let soc = snap.soc else { return }
        if parkedCheckPending {
            parkedCheckPending = false
            let charging = tracker.mode == .charging || (snap.powerKw ?? 0) > Tracker.chargeStartKw
            let drain = ParkedStore.loadAnchor().flatMap { ParkedDrain.measure($0, snap, charging: charging) }
            if let drain {
                state.parked = drain
                drains = Array((drains + [drain]).suffix(ParkedDrain.keep))
                ParkedStore.saveDrains(drains)
            }
        }
        let anchor = ParkedAnchor(soc: soc, time: snap.time, odometerKm: snap.odometerKm ?? latestAnchor?.odometerKm)
        latestAnchor = anchor
        // Saved once a minute while connected, and again whenever readings stop.
        if snap.time - anchorSavedAt >= 60_000 { saveParkedAnchor() }
    }

    /// Remembers the last reading, so the next connection can measure the drain since.
    func saveParkedAnchor() {
        guard let a = latestAnchor else { return }
        ParkedStore.saveAnchor(a)
        anchorSavedAt = a.time
    }

    private func addHistory(_ entry: HistoryEntry) {
        if entry.kind == .Charge { alerts.chargingStopped(entry, settings: settings) }
        let keep = entry.kind == .Drive ? (entry.distanceKm ?? 0) >= 0.3 : entry.kwh >= 0.2
        guard keep else { return }
        history = ChargeCurve.prune(history + [entry])
        HistoryStore.save(history)
    }

    private func endSessions() {
        saveParkedAnchor()
        tracker.flush(nowMs()).forEach(addHistory)
        state.mode = .parked
        state.currentCharge = nil
        state.currentDrive = nil
        liveActivity.onDisconnected(state, settings: settings, history: history)
        watchLink.onDisconnected(state, settings: settings, history: history)
    }

    func clearHistory() {
        history = []
        HistoryStore.save([])
    }

    func deleteHistory(_ entry: HistoryEntry) {
        history.removeAll { $0 == entry }
        HistoryStore.save(history)
    }

    private func maybeSendAbrp(_ snap: Snapshot) {
        guard settings.abrpEnabled else {
            if state.abrpStatus != nil { state.abrpStatus = nil }
            return
        }
        let now = nowMs()
        guard now - lastAbrp >= Int64(settings.abrpEverySec) * 1000 else { return }
        lastAbrp = now
        let s = settings
        let tlm = Abrp.telemetry(snap, mode: tracker.mode, fast: tracker.currentCharge?.fast == true, settings: s,
                                 location: s.abrpLocation ? location.latest : nil)
        Task {
            let error = await Abrp.send(tlm, settings: s)
            state.abrpStatus = error ?? Abrp.sentMessage
        }
    }

    // MARK: Identity and fault codes

    private func readVin() async throws {
        await bus.lock()
        defer { bus.unlock() }
        for ecu in [Ecus.vcu, Ecus.bcm, Ecus.bms] {
            try await selectEcu(ecu)
            if let vin = try await query("22F190").flatMap({ Elm.vin($0) }) {
                state.vin = vin
                return
            }
        }
    }

    /// Reads stored fault codes from every module. Read-only: nothing is cleared or changed.
    func scanFaults() {
        guard !faults.running, !versions.running, state.connected else { return }
        faults = FaultScan(running: true)
        Task {
            await bus.lock()
            do {
                _ = try await query("ATST96") // give slow modules ~600 ms to start answering
                var codes: [Dtc] = []
                var modules: [String: String] = [:]
                for (index, ecu) in Ecus.scanList.enumerated() {
                    faults.progress = index
                    faults.current = ecu.name
                    try await selectEcu(ecu)
                    var result = DtcReadResult.noAnswer
                    for _ in 1...3 {
                        let reply = try await query(Dtcs.readAll, timeout: 6)
                        result = reply.map { Dtcs.parse($0, ecu: ecu) } ?? .garbled
                        var retry = false
                        switch result {
                        case .garbled: retry = true
                        case .ok(_, let complete): retry = !complete
                        case .refused(let nrc): retry = nrc == 0x78
                        case .noAnswer: retry = false
                        }
                        if !retry { break }
                    }
                    switch result {
                    case .ok(let list, let complete):
                        codes += list
                        modules[ecu.code] = complete ? "ok" : "incomplete"
                    case .noAnswer: modules[ecu.code] = "no answer"
                    case .refused: modules[ecu.code] = "refused"
                    case .garbled: modules[ecu.code] = "unreadable"
                    }
                    faults.codes = codes
                    faults.modules = modules
                }
                _ = try await query("ATST20")
                faults.running = false
                faults.progress = faults.total
                faults.current = nil
                let finished = nowMs()
                faults.finishedAt = finished
                saveScan(SavedScan(time: finished, vin: state.vin, modules: modules, codes: codes.map { SavedCode($0) }))
            } catch {
                faults.running = false
                faults.error = error.localizedDescription
            }
            bus.unlock()
        }
    }

    /// Compares a finished scan with the last one of the same car, then adds it to the saved history.
    private func saveScan(_ scan: SavedScan) {
        faults.changes = FaultHistory.compare(scan, to: FaultHistory.previous(for: scan.vin, in: pastScans))
        pastScans = FaultHistory.appending(scan, to: pastScans)
        FaultHistoryStore.save(pastScans)
    }

    // MARK: Module versions

    /// Reads the software version, software number and part number (F189, F188, F187) of each module
    /// that answered the last scan, or of every module if there was no scan. Read-only.
    func readModuleVersions() {
        guard !versions.running, !faults.running, !action.running, state.connected else { return }
        let answered = Ecus.scanList.filter { faults.modules[$0.code] == "ok" || faults.modules[$0.code] == "incomplete" }
        let targets = answered.isEmpty ? Ecus.scanList : answered
        versions = VersionRead(running: true, total: targets.count)
        Task {
            await bus.lock()
            do {
                _ = try await query("ATST96")
                var list: [ModuleVersion] = []
                for (index, ecu) in targets.enumerated() {
                    versions.progress = index
                    versions.current = ecu.name
                    try await selectEcu(ecu)
                    var version = ModuleVersion(ecu: ecu.code, name: ecu.name)
                    for did in ModuleIds.all {
                        let answer = try await query(ModuleIds.command(did), timeout: 6)
                        // A module that doesn't answer the first read is skipped, so a silent one costs one timeout, not three.
                        if did == ModuleIds.softwareVersion && (answer == nil || answer?.uppercased().contains("NO DATA") == true) { break }
                        guard let reply = answer else { continue }
                        let text = ModuleIds.text(reply, did: did)
                        switch did {
                        case ModuleIds.softwareVersion: version.softwareVersion = text
                        case ModuleIds.softwareNumber: version.softwareNumber = text
                        default: version.partNumber = text
                        }
                    }
                    if !version.isEmpty {
                        list.append(version)
                        versions.list = list
                    }
                }
                _ = try await query("ATST20")
                versions.progress = versions.total
                versions.finishedAt = nowMs()
                attachVersions(list)
            } catch {
                versions.error = error.localizedDescription
            }
            versions.running = false
            versions.current = nil
            bus.unlock()
        }
    }

    /// Keeps the versions with the latest saved scan so they show up in past scans too.
    private func attachVersions(_ list: [ModuleVersion]) {
        guard !list.isEmpty, let at = faults.finishedAt, let i = pastScans.lastIndex(where: { $0.time == at }) else { return }
        pastScans[i].versions = list
        FaultHistoryStore.save(pastScans)
    }

    // MARK: Changing things: clear codes, restart modules

    /// Why the car can't take a clear or restart right now, or nil if it can.
    var changeBlockedReason: String? {
        if !state.connected { return String(localized: "Connect to the car first.") }
        if state.mode == .driving { return String(localized: "The car is moving. Park it first.") }
        if state.mode == .charging { return String(localized: "The car is charging. Unplug it first.") }
        if faults.running { return String(localized: "Wait for the scan to finish.") }
        if versions.running { return String(localized: "Wait for the module versions to finish.") }
        if action.running { return String(localized: "Another action is still running.") }
        return nil
    }

    /// Clears stored fault codes on each module, then reads them again to show what stayed.
    func clearCodes(_ ecus: [Ecu]) { runAction(.clear, ecus) }

    /// Restarts one module (soft reset, or hard for the telematics boxes).
    func restartModule(_ ecu: Ecu) { runAction(.restart, [ecu]) }

    func dismissActionResults() {
        if !action.running { action = ActionRun() }
    }

    private func runAction(_ kind: CarAction, _ ecus: [Ecu]) {
        guard changeBlockedReason == nil, !ecus.isEmpty else { return }
        action = ActionRun(running: true, action: kind, total: ecus.count)
        Task {
            var outcomes: [ActionOutcome] = []
            await bus.lock()
            do {
                _ = try await query("ATST96")
                for (index, ecu) in ecus.enumerated() {
                    // Stop if the car starts moving or charging part way through.
                    if state.mode != .parked { break }
                    action.current = ecu.name
                    action.done = index
                    try await selectEcu(ecu)
                    _ = try await query(Uds.extendedSession) // some modules refuse this and still accept the request
                    let result: UdsResult
                    switch kind {
                    case .clear:
                        // Pause code logging so codes don't reappear mid-clear. Optional: a refusal changes nothing.
                        _ = try await query(Uds.dtcSettingOff)
                        do {
                            result = try await request(Uds.clearAll, service: 0x14)
                        } catch {
                            _ = try? await query(Uds.dtcSettingOn)
                            throw error
                        }
                        _ = try await query(Uds.dtcSettingOn) // leaving the extended session also turns it back on
                    case .restart:
                        if !ecu.canRestart {
                            result = .refused(nrc: 0x12)
                        } else {
                            result = try await request(ecu.hardRestart ? Uds.hardReset : Uds.softReset, service: 0x11)
                        }
                    }
                    if kind == .restart && result == .done {
                        try await Task.sleep(nanoseconds: 3_000_000_000) // let it boot
                    } else {
                        _ = try await query(Uds.defaultSession)
                    }
                    let remaining = try await recheck(ecu)
                    outcomes.append(ActionOutcome(ecu: ecu, action: kind, result: result, remaining: remaining))
                    action.outcomes = outcomes
                }
                _ = try await query("ATST20")
            } catch {
                // The connection dropped; the outcomes so far stay on screen.
            }
            bus.unlock()
            action.running = false
            action.current = nil
            action.done = action.total
        }
    }

    private func request(_ command: String, service: Int) async throws -> UdsResult {
        var reply = try await query(command, timeout: 8)
        // The adapter normally waits through "busy" replies itself; if it didn't, give the module a moment
        // and ask again. Only for clearing: asking twice to restart would restart the module twice.
        if service == 0x14 && Uds.pending(reply, service: service) {
            try await Task.sleep(nanoseconds: 1_500_000_000)
            reply = try await query(command, timeout: 8)
        }
        return Uds.result(reply, service: service)
    }

    /// Reads the module's codes again and updates the scan results. Returns the count, or nil if no answer.
    private func recheck(_ ecu: Ecu) async throws -> Int? {
        guard let reply = try await query(Dtcs.readAll, timeout: 6) else { return nil }
        guard case .ok(let codes, _) = Dtcs.parse(reply, ecu: ecu) else { return nil }
        if faults.finishedAt != nil {
            faults.codes = faults.codes.filter { $0.ecu != ecu } + codes
        }
        return codes.count
    }

    // MARK: Imported fault-code descriptions

    private var descriptionsFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("dtc-descriptions.json")
    }

    private func loadDescriptions() {
        if let text = try? String(contentsOf: descriptionsFile, encoding: .utf8) {
            DtcCatalog.shared.setImported(DtcCatalog.parseImport(text))
        }
        importedCount = DtcCatalog.shared.importedCount
    }

    /// Adds descriptions from a CSV or JSON file to the saved list. Returns how many were read, or nil if none.
    func importDescriptions(_ text: String) -> Int? {
        let parsed = DtcCatalog.parseImport(text)
        guard !parsed.isEmpty else { return nil }
        let existing = (try? String(contentsOf: descriptionsFile, encoding: .utf8)).map { DtcCatalog.parseImport($0) } ?? [:]
        let merged = DtcCatalog.mergeAll(existing, parsed)
        try? DtcCatalog.toJson(merged).write(to: descriptionsFile, atomically: true, encoding: .utf8)
        DtcCatalog.shared.setImported(merged)
        importedCount = DtcCatalog.shared.importedCount
        objectWillChange.send() // refresh descriptions on screen
        return parsed.count
    }

    func clearImportedDescriptions() {
        try? FileManager.default.removeItem(at: descriptionsFile)
        DtcCatalog.shared.setImported([:])
        importedCount = 0
        objectWillChange.send()
    }

    private static func looksLikeObd(_ name: String) -> Bool {
        let n = name.lowercased()
        return ["obd", "elm", "vlink", "vgate", "obdlink", "konnwei", "veepeak", "carista"].contains { n.contains($0) }
    }
}

/// Reasons the app stops reading on its own so the car can sleep.
enum CarError: LocalizedError {
    case asleep, parkedIdle

    var message: String {
        switch self {
        case .asleep: return SleepPolicy.asleepMessage
        case .parkedIdle: return SleepPolicy.parkedIdleMessage
        }
    }

    var errorDescription: String? { message }
}
