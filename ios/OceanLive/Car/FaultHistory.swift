import Foundation

/// One fault code as saved in the scan history.
struct SavedCode: Codable, Hashable {
    /// Module code, e.g. "BMS".
    let ecu: String
    let code: String
    let status: Int

    init(ecu: String, code: String, status: Int) {
        self.ecu = ecu
        self.code = code
        self.status = status
    }

    init(_ dtc: Dtc) { self.init(ecu: dtc.ecu.code, code: dtc.code, status: dtc.status) }

    /// Same as `Dtc.id`.
    var key: String { ecu + code }
    var dtc: Dtc { Dtc(code: code, status: status, ecu: Ecus.byCode(ecu)) }
}

/// A finished fault scan, kept so the next scan can show what is new and what went away.
struct SavedScan: Codable, Hashable, Identifiable {
    let time: Int64
    let vin: String?
    /// Module code to what happened: "ok", "no answer", "incomplete", ...
    let modules: [String: String]
    let codes: [SavedCode]
    var versions: [ModuleVersion]? = nil

    var id: Int64 { time }
    var dtcs: [Dtc] { codes.map(\.dtc) }
    var active: Int { codes.filter { Dtcs.state($0.status) == .active }.count }
    var stored: Int { codes.count - active }
}

/// What changed since the last scan of the same car.
struct ScanChanges: Equatable {
    /// `Dtc.id` of codes that weren't there last time.
    var newIds: Set<String> = []
    /// Codes from last time that a module now answering in full no longer reports.
    var cleared: [SavedCode] = []
    /// When the scan it was compared to finished, or nil if there was none.
    var since: Int64? = nil
}

enum FaultHistory {
    static let max = 50

    private static func answered(_ status: String?) -> Bool { status == "ok" || status == "incomplete" }

    /// The latest saved scan of this car. Scans without a VIN match any car.
    static func previous(for vin: String?, in scans: [SavedScan]) -> SavedScan? {
        scans.last { vin == nil || $0.vin == nil || $0.vin == vin }
    }

    /// New codes only count for modules that answered last time, and cleared ones only
    /// for modules that gave a complete list this time, so a module that was silent
    /// doesn't make its codes look new or cleared.
    static func compare(_ scan: SavedScan, to previous: SavedScan?) -> ScanChanges {
        guard let previous else { return ScanChanges() }
        let before = Set(previous.codes.map(\.key))
        let now = Set(scan.codes.map(\.key))
        let newIds = scan.codes.filter { !before.contains($0.key) && answered(previous.modules[$0.ecu]) }.map(\.key)
        let cleared = previous.codes.filter { !now.contains($0.key) && scan.modules[$0.ecu] == "ok" }
        return ScanChanges(newIds: Set(newIds), cleared: cleared, since: previous.time)
    }

    /// Adds a scan, keeping the latest `max`.
    static func appending(_ scan: SavedScan, to scans: [SavedScan]) -> [SavedScan] {
        Array((scans + [scan]).suffix(max))
    }

    static func encode(_ scans: [SavedScan]) -> Data? { try? JSONEncoder().encode(scans) }

    static func decode(_ data: Data) -> [SavedScan] { (try? JSONDecoder().decode([SavedScan].self, from: data)) ?? [] }
}

/// Past fault scans, kept in a JSON file in the app's private storage.
enum FaultHistoryStore {
    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("fault-scans.json")
    }

    static func load() -> [SavedScan] {
        guard let data = try? Data(contentsOf: file) else { return [] }
        return FaultHistory.decode(data)
    }

    static func save(_ scans: [SavedScan]) {
        guard let data = FaultHistory.encode(Array(scans.suffix(FaultHistory.max))) else { return }
        try? data.write(to: file, options: .atomic)
    }
}
