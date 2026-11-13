import Foundation

/// The latest reading, sent by the phone to the Apple Watch app. The watch only shows it:
/// it never asks the phone or the car for anything.
struct WatchSummary: Codable, Equatable {
    var soc: Double?
    var rangeText: String?
    var powerKw: Double?
    var charging: Bool
    var fast: Bool
    var minutesToTarget: Int?
    var targetPercent: Int
    var aux12v: Double?
    /// Plain words: "Charging", "Parked", "Not connected", ...
    var status: String
    /// The phone was reading the car when this was sent.
    var live: Bool
    /// Time of the reading.
    var updatedAt: Date

    static let key = "watchSummary"
    /// After this long without news, a live summary is shown as out of date.
    static let freshFor: TimeInterval = 5 * 60

    /// Whether two summaries show the same values (the time stamp aside).
    func sameValues(_ other: WatchSummary) -> Bool {
        var a = self
        a.updatedAt = other.updatedAt
        return a == other
    }

    // MARK: Sending and keeping

    /// What goes into the WatchConnectivity application context (property-list types only).
    var context: [String: Any] {
        guard let data = try? JSONEncoder().encode(self) else { return [:] }
        return [Self.key: data]
    }

    init?(context: [String: Any]) {
        guard let data = context[Self.key] as? Data,
              let decoded = try? JSONDecoder().decode(WatchSummary.self, from: data) else { return nil }
        self = decoded
    }

    init(soc: Double?, rangeText: String?, powerKw: Double?, charging: Bool, fast: Bool, minutesToTarget: Int?,
         targetPercent: Int, aux12v: Double?, status: String, live: Bool, updatedAt: Date) {
        self.soc = soc
        self.rangeText = rangeText
        self.powerKw = powerKw
        self.charging = charging
        self.fast = fast
        self.minutesToTarget = minutesToTarget
        self.targetPercent = targetPercent
        self.aux12v = aux12v
        self.status = status
        self.live = live
        self.updatedAt = updatedAt
    }

    static func load(_ defaults: UserDefaults = .standard) -> WatchSummary? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WatchSummary.self, from: data)
    }

    func save(_ defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: Self.key)
    }

    // MARK: Showing

    /// Live and heard from recently. The phone resends unchanged values every couple of minutes.
    func isFresh(now: Date = Date()) -> Bool {
        live && now.timeIntervalSince(updatedAt) < Self.freshFor
    }

    /// Charging right now, as far as the watch can tell.
    func chargingNow(now: Date = Date()) -> Bool { charging && isFresh(now: now) }

    func statusText(now: Date = Date()) -> String {
        live && !isFresh(now: now) ? String(localized: "Not updating") : status
    }

    /// "Updated just now", "Updated 4 min ago", "Updated 2 h ago", "Updated 3 days ago".
    func updatedText(now: Date = Date()) -> String {
        let minutes = Int(max(now.timeIntervalSince(updatedAt), 0) / 60)
        if minutes < 1 { return String(localized: "Updated just now") }
        if minutes < 60 { return String(localized: "Updated \(minutes) min ago") }
        let hours = minutes / 60
        if minutes < 24 * 60 { return String(localized: "Updated \(hours) h ago") }
        let days = minutes / (24 * 60)
        return String(localized: "Updated \(days) days ago")
    }

    /// "To 80%"
    var toTargetLabel: String { OceanShared.toTarget(targetPercent) }

    /// "≈ 35 min", "Reached", or "—" when it can't be worked out.
    var toTargetText: String {
        if let soc, soc >= Double(targetPercent) { return String(localized: "Reached") }
        return minutesToTarget.map { "≈ " + OceanShared.duration($0) } ?? "—"
    }

    /// Same words as the app's Live screen.
    var powerLabel: String {
        guard let p = powerKw else { return String(localized: "power") }
        if p > 0.3 { return charging ? String(localized: "into the battery") : String(localized: "regenerating") }
        if p < -0.3 { return String(localized: "from the battery") }
        return String(localized: "idle")
    }
}
