import Foundation

/// Number formatting with the user's units.
enum Format {
    static let kmPerMi = 1.609344
    static let defaultWhPerKm = 210.0

    static func n(_ value: Double, _ decimals: Int) -> String {
        let f = NumberFormatter()
        f.minimumFractionDigits = decimals
        f.maximumFractionDigits = decimals
        f.usesGroupingSeparator = false
        return f.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    static func temp(_ c: Double?, _ s: Settings) -> String? {
        guard let c else { return nil }
        return s.useFahrenheit ? "\(Int((c * 9 / 5 + 32).rounded())) °F" : "\(n(c, 1)) °C"
    }

    static func distance(_ km: Double?, _ s: Settings, decimals: Int = 0) -> String? {
        guard let km else { return nil }
        return s.useMiles ? "\(n(km / kmPerMi, decimals)) mi" : "\(n(km, decimals)) km"
    }

    static func efficiency(_ whPerKm: Double?, _ s: Settings) -> String? {
        guard let w = whPerKm else { return nil }
        return s.useMiles ? "\(n(1000 / (w * kmPerMi), 2)) mi/kWh" : "\(Int(w.rounded())) Wh/km"
    }

    static func whPerKm(_ history: [HistoryEntry]) -> Double { learnedWhPerKm(history) ?? defaultWhPerKm }

    static func rangeKm(_ soc: Double?, _ s: Settings, _ history: [HistoryEntry]) -> Double? {
        guard let soc, s.usableKwh > 0 else { return nil }
        return soc / 100 * s.usableKwh * 1000 / whPerKm(history)
    }

    static func range(_ soc: Double?, _ s: Settings, _ history: [HistoryEntry]) -> String? {
        rangeKm(soc, s, history).flatMap { distance($0, s) }.map { "≈ " + $0 }
    }

    static func duration(_ minutes: Int64) -> String {
        minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h \(minutes % 60) min"
    }

    static func money(_ value: Double?, _ s: Settings) -> String? {
        guard let value else { return nil }
        let symbol = s.currency.trimmingCharacters(in: .whitespaces)
        return (symbol.isEmpty ? "$" : symbol) + n(value, 2)
    }

    /// A parked period's length: "45 min", "19 h", "3 days".
    static func span(_ hours: Double) -> String {
        if hours < 1 { return "\(Int((hours * 60).rounded())) min" }
        if hours < 48 { return "\(Int(hours.rounded())) h" }
        return "\(Int((hours / 24).rounded())) days"
    }

    /// "−2.1% over 19 h · about 2.2 kWh"
    static func drain(_ d: ParkedDrain, _ s: Settings) -> String {
        let kwh = d.kwh(s.usableKwh).map { " · about " + n($0, 1) + " kWh" } ?? ""
        return "−" + n(d.drop, 1) + "% over " + span(d.hours) + kwh
    }

    /// "≈ 2.7% · 2.9 kWh" for a drain rate in percent per day.
    static func perDay(_ pct: Double, _ s: Settings) -> String {
        let kwh = s.usableKwh > 0 ? " · " + n(pct / 100 * s.usableKwh, 1) + " kWh" : ""
        return "≈ " + n(pct, 1) + "%" + kwh
    }

    static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }
}

func balanceLabel(_ mv: Double) -> String {
    switch mv {
    case ...30: return "Well balanced"
    case ...60: return "Normal"
    case ...100: return "Uneven"
    default: return "Very uneven"
    }
}

/// Rough reading of a 12V voltage. Above ~13.2 V the car's DC-DC converter is charging it.
func auxStatus(_ volts: Double) -> String {
    switch volts {
    case 13.2...: return "Charging"
    case 12.4...: return "Good"
    case 12.0...: return "Low"
    default: return "Very low"
    }
}

func tempAdvice(_ c: Double) -> String {
    switch c {
    case ..<5: return "Cold battery: charging and regen are limited until it warms up."
    case ..<15: return "Cool battery: DC fast charging will be slower than its best."
    case ...40: return "Comfortable temperature for driving and charging."
    default: return "Warm battery: the car may limit fast-charging power to cool it."
    }
}
