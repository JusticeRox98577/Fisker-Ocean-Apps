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

    var connected: Bool { status == .live }
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

    var label: String { self == .clear ? "Clear codes" : "Restart" }
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

    private let transport = ElmTransport()
    private let bus = AsyncLock()
    private let tracker = Tracker()
    private let alerts = Alerts()
    private let location = LocationFeed()
    private var task: Task<Void, Never>?
    private var wantConnected = false
    private var selectedEcu: Ecu?
    private var lastAbrp: Int64 = 0

    private var carPlayConnected = false

    /// Seconds between readings: every second while CarPlay is showing, every two otherwise.
    private var pollInterval: Double { carPlayConnected ? 1 : 2 }
    private static let reconnectNs: UInt64 = 10_000_000_000

    func setCarPlayConnected(_ on: Bool) { carPlayConnected = on }

    init() {
        settings = Settings.load()
        state.adapterName = settings.adapterName
        history = HistoryStore.load()
        pastScans = FaultHistoryStore.load()
        loadDescriptions()
        location.setEnabled(settings.abrpEnabled && settings.abrpLocation)
        transport.onDisconnected = { [weak self] in self?.onLost("Adapter disconnected.") }
    }

    func updateSettings(_ change: (inout Settings) -> Void) {
        var next = settings
        change(&next)
        settings = next
        next.save()
        location.setEnabled(next.abrpEnabled && next.abrpLocation)
        updateScreenLock()
    }

    // MARK: Connection

    func scan() {
        stopTask()
        transport.disconnect()
        found = []
        state.status = .scanning
        state.message = nil
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
        wantConnected = true
        updateSettings { $0.adapterId = id.uuidString; $0.adapterName = name }
        state.status = .connecting
        state.message = nil
        state.adapterName = name
        task = Task { await runSession(id: id, firstAttempt: true) }
    }

    func connectSaved() {
        guard let raw = settings.adapterId, let id = UUID(uuidString: raw) else { return }
        connect(id: id, name: settings.adapterName ?? "Adapter")
    }

    func disconnect() {
        wantConnected = false
        stopTask()
        transport.disconnect()
        endSessions()
        state.status = .idle
        state.message = nil
        state.abrpStatus = nil
        updateScreenLock()
    }

    func forgetAdapter() {
        disconnect()
        updateSettings { $0.adapterId = nil; $0.adapterName = nil }
        state.adapterName = nil
    }

    /// Auto-connect once when the app opens.
    func autoStart() {
        if settings.autoStart && settings.adapterId != nil && state.status == .idle { connectSaved() }
    }

    private func stopTask() {
        task?.cancel()
        task = nil
        transport.stopScan()
    }

    private func runSession(id: UUID, firstAttempt: Bool) async {
        var first = firstAttempt
        while wantConnected && !Task.isCancelled {
            do {
                try await transport.connect(id: id)
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
                first = false
                state.status = .live
                state.message = nil
                updateScreenLock()
                if state.vin == nil { try await readVin() }
                try await poll()
            } catch {
                if Task.isCancelled || !wantConnected { return }
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
                state.status = .reconnecting
                state.message = error.localizedDescription
                updateScreenLock()
                try? await Task.sleep(nanoseconds: Self.reconnectNs)
            }
        }
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

    private func read(_ did: Did) async throws -> (Bool, Double?) {
        try await selectEcu(did.ecu)
        guard let reply = try await query(did.command) else { return (false, nil) }
        return (true, Elm.read(reply, did))
    }

    private func poll() async throws {
        var misses = 0
        var cycle = 0
        while wantConnected && !Task.isCancelled {
            let cycleStart = Date()
            var answered = false
            var snap = state.snapshot
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
                        snap.aux12vSource = "BMS"
                    } else {
                        let reply = try await query("ATRV")
                        if reply != nil { answered = true }
                        let v = reply.flatMap { Elm.adapterVoltage($0) }
                        snap.aux12v = v
                        snap.aux12vSource = v == nil ? nil : "OBD port"
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
                onReading(snap)
            } else {
                misses += 1
                if misses >= 3 { throw CarError.stoppedAnswering }
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
        maybeSendAbrp(snap)
    }

    private func addHistory(_ entry: HistoryEntry) {
        if entry.kind == .Charge { alerts.chargingStopped(entry, settings: settings) }
        let keep = entry.kind == .Drive ? (entry.distanceKm ?? 0) >= 0.3 : entry.kwh >= 0.2
        guard keep else { return }
        history.append(entry)
        HistoryStore.save(history)
    }

    private func endSessions() {
        tracker.flush(nowMs()).forEach(addHistory)
        state.mode = .parked
        state.currentCharge = nil
        state.currentDrive = nil
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
            state.abrpStatus = error ?? "Sent to ABRP"
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
                        guard let reply = try await query(ModuleIds.command(did), timeout: 6) else { continue }
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
        if !state.connected { return "Connect to the car first." }
        if state.mode == .driving { return "The car is moving. Park it first." }
        if state.mode == .charging { return "The car is charging. Unplug it first." }
        if faults.running { return "Wait for the scan to finish." }
        if versions.running { return "Wait for the module versions to finish." }
        if action.running { return "Another action is still running." }
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

enum CarError: LocalizedError {
    case stoppedAnswering

    var errorDescription: String? { "The car stopped answering." }
}
