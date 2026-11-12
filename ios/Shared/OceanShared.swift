import ActivityKit
import Foundation
import SwiftUI

// Compiled into both the app and the widget extension.

enum OceanShared {
    /// App Group both targets can read and write.
    static let appGroup = "group.com.justice.OceanABRP"
    /// Kind of the home-screen widget, used to reload its timeline.
    static let widgetKind = "OceanLiveStatus"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func number(_ value: Double, _ decimals: Int) -> String {
        let f = NumberFormatter()
        f.minimumFractionDigits = decimals
        f.maximumFractionDigits = decimals
        f.usesGroupingSeparator = false
        return f.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    static func percent(_ soc: Double?) -> String {
        soc.map { "\(Int($0.rounded()))%" } ?? "—"
    }

    static func power(_ kw: Double?) -> String {
        kw.map { number(abs($0), 1) + " kW" } ?? "— kW"
    }

    static func volts(_ v: Double?) -> String {
        v.map { number($0, 1) + " V" } ?? "—"
    }

    /// Same wording as the app: "45 min", "1 h 5 min".
    static func duration(_ minutes: Int) -> String {
        minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h \(minutes % 60) min"
    }
}

/// The latest reading, written by the app to the App Group for the home-screen widget.
struct WidgetData: Codable, Equatable {
    var soc: Double?
    var rangeText: String?
    var aux12v: Double?
    /// Plain words: "Charging", "Parked", "Not connected", ...
    var status: String
    var charging: Bool
    var live: Bool
    var updatedAt: Date

    static let key = "widgetData"

    static func load(_ defaults: UserDefaults? = OceanShared.defaults) -> WidgetData? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }

    func save(_ defaults: UserDefaults? = OceanShared.defaults) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults?.set(data, forKey: Self.key)
    }
}

/// The charging Live Activity (lock screen, Dynamic Island, Apple Watch and CarPlay).
struct ChargeActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var soc: Double?
        var rangeText: String?
        var powerKw: Double?
        var minutesToTarget: Int?
        var targetPercent: Int
        var charging: Bool
        var fast: Bool
        var updatedAt: Date

        var title: String {
            if !charging { return "Charge finished" }
            return fast ? "DC fast charging" : "Charging"
        }

        /// "≈ 35 min", "Reached", or "—" when it can't be worked out.
        var toTargetText: String {
            if let soc, soc >= Double(targetPercent) { return "Reached" }
            return minutesToTarget.map { "≈ " + OceanShared.duration($0) } ?? "—"
        }
    }

    var carName: String
    var adapterName: String?
}

/// Deep ocean palette, same values as the app's Theme.
enum OceanPalette {
    static let bg = rgb(0x060B12)
    static let bgTop = rgb(0x0B1A2A)
    static let card = rgb(0x0F1B28)
    static let track = rgb(0x13233A)
    static let dim = rgb(0x7E92A6)
    static let aqua = rgb(0x2EE6C9)
    static let cyan = rgb(0x38BDF8)
    static let violet = rgb(0x8B7CF6)
    static let good = rgb(0x4ADE80)
    static let warn = rgb(0xFBBF24)
    static let bad = rgb(0xFB7185)

    static let background = LinearGradient(colors: [bgTop, bg, bg], startPoint: .top, endPoint: .bottom)

    /// Same colours as the app's charge ring.
    static func ringColors(soc: Double?, charging: Bool) -> [Color] {
        if charging { return [good, aqua, good] }
        if let soc, soc < 20 { return [bad, warn, bad] }
        return [aqua, cyan, violet, aqua]
    }

    static func rgb(_ hex: UInt32, opacity: Double = 1) -> Color {
        Color(.sRGB,
              red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255,
              opacity: opacity)
    }
}
