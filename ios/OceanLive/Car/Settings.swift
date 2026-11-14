import Foundation

enum CarModel: String, Codable, CaseIterable, Identifiable {
    case big = "Big", sport = "Sport", custom = "Custom"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .big: return String(localized: "Ocean One, Extreme or Ultra")
        case .sport: return "Ocean Sport"
        case .custom: return String(localized: "Other or custom")
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

/// Everything the user can change, stored as JSON in UserDefaults, except the ABRP token and API key:
/// those live in the Keychain (SecretStore) and are left out of the JSON.
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
    /// Kept in the Keychain, not in the saved JSON.
    var abrpToken = ""
    /// Kept in the Keychain, not in the saved JSON.
    var abrpKey = ""
    var abrpEverySec = 10
    var abrpLocation = false
    var flipCurrent = false
    var currency = "$"
    /// Price per kWh at home. 0 means not set.
    var homePrice = 0.0
    /// Price per kWh at DC fast chargers. 0 means not set.
    var dcPrice = 0.0
    /// While the car sleeps, ask the adapter (only it) for the 12V now and then.
    var v12Watch = false
    /// Minutes between those readings: 5, 10 or 30. Settings saved earlier keep their choice.
    var v12WatchMinutes = V12Watch.defaultMinutes
    /// Keep the Bluetooth link open between those readings instead of a quick connect, read and disconnect.
    /// Only for adapters that can't be woken over Bluetooth: it keeps the adapter awake (about 50 mA).
    var v12WatchKeepConnected = false
    /// "Any questions?": include the car's latest readings and fault codes with each question.
    var askShareCar = true

    var usableKwh: Double { model == .custom ? customKwh : model.usableKwh }
    var abrpEnabled: Bool {
        !abrpToken.trimmingCharacters(in: .whitespaces).isEmpty && !abrpKey.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static let key = "settings"
    /// The Keychain could be read when the settings were loaded, so saving may write the token and key to it.
    /// False before the first unlock since the iPhone started: then empty fields never erase saved ones.
    private static var secretsLoaded = false
    /// Settings saved by an older version still hold the token and key in their JSON, and they haven't reached
    /// the Keychain yet: keep them in the JSON until they have.
    private static var plainPending = false
    /// The token and key as they were when the settings were loaded, to tell later edits from values not read yet.
    private static var loadedToken = ""
    private static var loadedKey = ""

    static func load() -> Settings {
        var s: Settings
        if let data = UserDefaults.standard.data(forKey: key), let saved = try? JSONDecoder().decode(Settings.self, from: data) {
            s = saved
        } else {
            // Carry over the adapter saved by Ocean Live 3.0.
            s = Settings()
            s.adapterId = UserDefaults.standard.string(forKey: "adapter_id")
            s.adapterName = UserDefaults.standard.string(forKey: "adapter_name")
        }
        s.loadSecrets()
        return s
    }

    /// Reads the token and key from the Keychain. Ones an older version saved in the JSON move there once,
    /// and the settings are saved again without them.
    private mutating func loadSecrets() {
        let hadPlain = !abrpToken.isEmpty || !abrpKey.isEmpty
        Self.plainPending = hadPlain
        Self.loadedToken = abrpToken
        Self.loadedKey = abrpKey
        guard let token = SecretStore.get(SecretStore.tokenAccount), let key = SecretStore.get(SecretStore.keyAccount) else {
            // Keychain locked: use what the JSON has for now and try again with retrySecrets().
            Self.secretsLoaded = false
            return
        }
        Self.secretsLoaded = true
        if !token.isEmpty || !hadPlain { abrpToken = token }
        if !key.isEmpty || !hadPlain { abrpKey = key }
        if hadPlain { save() }
    }

    /// The Keychain couldn't be read at load (before the first unlock): read it now that it may be unlocked.
    /// A token or key typed in since then is kept and saved to it. Returns whether the settings changed.
    mutating func retrySecrets() -> Bool {
        guard !Self.secretsLoaded,
              let token = SecretStore.get(SecretStore.tokenAccount),
              let key = SecretStore.get(SecretStore.keyAccount) else { return false }
        Self.secretsLoaded = true
        let before = self
        if abrpToken == Self.loadedToken && !token.isEmpty { abrpToken = token }
        if abrpKey == Self.loadedKey && !key.isEmpty { abrpKey = key }
        save()
        return self != before
    }

    func save() {
        if Self.secretsLoaded {
            let stored = SecretStore.set(abrpToken, for: SecretStore.tokenAccount)
                && SecretStore.set(abrpKey, for: SecretStore.keyAccount)
            if stored { Self.plainPending = false }
        } else if abrpToken != Self.loadedToken || abrpKey != Self.loadedKey {
            // Typed in while the Keychain can't be read: keep them in the JSON until they reach it.
            Self.plainPending = true
        }
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    enum CodingKeys: String, CodingKey {
        case adapterId, adapterName, autoStart, keepScreenOn, useMiles, useFahrenheit, model, customKwh
        case alertsOn, alertHigh, alertLow, alertStop, healthAlerts, abrpToken, abrpKey, abrpEverySec, abrpLocation
        case flipCurrent, currency, homePrice, dcPrice, v12Watch, v12WatchMinutes, v12WatchKeepConnected
        case askShareCar
    }

    /// Everything but the ABRP token and key, which are in the Keychain (unless they couldn't be moved there yet).
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(adapterId, forKey: .adapterId)
        try c.encodeIfPresent(adapterName, forKey: .adapterName)
        try c.encode(autoStart, forKey: .autoStart)
        try c.encode(keepScreenOn, forKey: .keepScreenOn)
        try c.encode(useMiles, forKey: .useMiles)
        try c.encode(useFahrenheit, forKey: .useFahrenheit)
        try c.encode(model, forKey: .model)
        try c.encode(customKwh, forKey: .customKwh)
        try c.encode(alertsOn, forKey: .alertsOn)
        try c.encode(alertHigh, forKey: .alertHigh)
        try c.encode(alertLow, forKey: .alertLow)
        try c.encode(alertStop, forKey: .alertStop)
        try c.encode(healthAlerts, forKey: .healthAlerts)
        if Self.plainPending {
            try c.encode(abrpToken, forKey: .abrpToken)
            try c.encode(abrpKey, forKey: .abrpKey)
        }
        try c.encode(abrpEverySec, forKey: .abrpEverySec)
        try c.encode(abrpLocation, forKey: .abrpLocation)
        try c.encode(flipCurrent, forKey: .flipCurrent)
        try c.encode(currency, forKey: .currency)
        try c.encode(homePrice, forKey: .homePrice)
        try c.encode(dcPrice, forKey: .dcPrice)
        try c.encode(v12Watch, forKey: .v12Watch)
        try c.encode(v12WatchMinutes, forKey: .v12WatchMinutes)
        try c.encode(v12WatchKeepConnected, forKey: .v12WatchKeepConnected)
        try c.encode(askShareCar, forKey: .askShareCar)
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
        v12WatchKeepConnected = try c.decodeIfPresent(Bool.self, forKey: .v12WatchKeepConnected) ?? d.v12WatchKeepConnected
        askShareCar = try c.decodeIfPresent(Bool.self, forKey: .askShareCar) ?? d.askShareCar
    }
}
