import Foundation

enum CarModel: String, Codable, CaseIterable, Identifiable {
    case big = "Big", sport = "Sport", custom = "Custom"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .big: return "Ocean One, Extreme or Ultra"
        case .sport: return "Ocean Sport"
        case .custom: return "Other or custom"
        }
    }

    var usableKwh: Double {
        switch self {
        case .big: return 106.5
        case .sport: return 75.0
        case .custom: return 0
        }
    }
}

/// Everything the user can change, stored as JSON in UserDefaults.
struct Settings: Codable, Equatable {
    var adapterId: String? = nil
    var adapterName: String? = nil
    var autoStart = true
    var keepScreenOn = true
    var useMiles = true
    var useFahrenheit = true
    var model: CarModel = .big
    var customKwh = 106.5
    var alertsOn = false
    var alertHigh = 80
    var alertLow = 20
    var alertStop = true
    var healthAlerts = true
    var abrpToken = ""
    var abrpKey = ""
    var abrpEverySec = 10
    var abrpLocation = false
    var flipCurrent = false
    var currency = "$"
    /// Price per kWh at home. 0 means not set.
    var homePrice = 0.0
    /// Price per kWh at DC fast chargers. 0 means not set.
    var dcPrice = 0.0
    /// Keep the adapter connected while the car sleeps and ask it (only it) for the 12V now and then.
    var v12Watch = false
    /// Minutes between those readings: 5, 10 or 30.
    var v12WatchMinutes = 10

    var usableKwh: Double { model == .custom ? customKwh : model.usableKwh }
    var abrpEnabled: Bool {
        !abrpToken.trimmingCharacters(in: .whitespaces).isEmpty && !abrpKey.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static let key = "settings"

    static func load() -> Settings {
        guard let data = UserDefaults.standard.data(forKey: key),
              let s = try? JSONDecoder().decode(Settings.self, from: data) else {
            // Carry over the adapter saved by Ocean Live 3.0.
            var s = Settings()
            s.adapterId = UserDefaults.standard.string(forKey: "adapter_id")
            s.adapterName = UserDefaults.standard.string(forKey: "adapter_name")
            return s
        }
        return s
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    // Decode field by field so settings saved by an older version keep working when fields are added.
    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Settings()
        adapterId = try c.decodeIfPresent(String.self, forKey: .adapterId)
        adapterName = try c.decodeIfPresent(String.self, forKey: .adapterName)
        autoStart = try c.decodeIfPresent(Bool.self, forKey: .autoStart) ?? d.autoStart
        keepScreenOn = try c.decodeIfPresent(Bool.self, forKey: .keepScreenOn) ?? d.keepScreenOn
        useMiles = try c.decodeIfPresent(Bool.self, forKey: .useMiles) ?? d.useMiles
        useFahrenheit = try c.decodeIfPresent(Bool.self, forKey: .useFahrenheit) ?? d.useFahrenheit
        model = (try? c.decodeIfPresent(CarModel.self, forKey: .model)) ?? d.model
        customKwh = try c.decodeIfPresent(Double.self, forKey: .customKwh) ?? d.customKwh
        alertsOn = try c.decodeIfPresent(Bool.self, forKey: .alertsOn) ?? d.alertsOn
        alertHigh = try c.decodeIfPresent(Int.self, forKey: .alertHigh) ?? d.alertHigh
        alertLow = try c.decodeIfPresent(Int.self, forKey: .alertLow) ?? d.alertLow
        alertStop = try c.decodeIfPresent(Bool.self, forKey: .alertStop) ?? d.alertStop
        healthAlerts = try c.decodeIfPresent(Bool.self, forKey: .healthAlerts) ?? d.healthAlerts
        abrpToken = try c.decodeIfPresent(String.self, forKey: .abrpToken) ?? d.abrpToken
        abrpKey = try c.decodeIfPresent(String.self, forKey: .abrpKey) ?? d.abrpKey
        abrpEverySec = try c.decodeIfPresent(Int.self, forKey: .abrpEverySec) ?? d.abrpEverySec
        abrpLocation = try c.decodeIfPresent(Bool.self, forKey: .abrpLocation) ?? d.abrpLocation
        flipCurrent = try c.decodeIfPresent(Bool.self, forKey: .flipCurrent) ?? d.flipCurrent
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? d.currency
        homePrice = try c.decodeIfPresent(Double.self, forKey: .homePrice) ?? d.homePrice
        dcPrice = try c.decodeIfPresent(Double.self, forKey: .dcPrice) ?? d.dcPrice
        v12Watch = try c.decodeIfPresent(Bool.self, forKey: .v12Watch) ?? d.v12Watch
        v12WatchMinutes = V12Watch.interval(try c.decodeIfPresent(Int.self, forKey: .v12WatchMinutes) ?? d.v12WatchMinutes)
    }
}
