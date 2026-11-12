import CoreLocation
import Foundation
import UserNotifications

/// Drives and charging sessions, kept in a JSON file in the app's private storage.
enum HistoryStore {
    static let max = 1000

    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("history.json")
    }

    static func load() -> [HistoryEntry] {
        guard let data = try? Data(contentsOf: file),
              let list = try? JSONDecoder().decode([HistoryEntry].self, from: data) else { return [] }
        return list
    }

    static func save(_ entries: [HistoryEntry]) {
        guard let data = try? JSONEncoder().encode(Array(entries.suffix(max))) else { return }
        try? data.write(to: file, options: .atomic)
    }

    static func csv(_ entries: [HistoryEntry]) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd HH:mm"
        func date(_ ms: Int64) -> String { fmt.string(from: Date(timeIntervalSince1970: Double(ms) / 1000)) }
        func n(_ v: Double?, _ d: Int = 1) -> String { v.map { String(format: "%.\(d)f", $0) } ?? "" }
        var out = "type,start,end,minutes,soc_start,soc_end,kwh,distance_km,wh_per_km,peak_kw,dc_fast\n"
        for e in entries {
            let fields = [
                e.kind.rawValue.lowercased(), date(e.start), date(e.end), String(e.minutes),
                n(e.socStart), n(e.socEnd), n(e.kwh, 2), n(e.distanceKm, 2), n(e.whPerKm, 0), n(e.peakKw),
                e.kind == .Charge ? String(e.fast) : "",
            ]
            out += fields.joined(separator: ",") + "\n"
        }
        return out
    }
}

/// Charge and battery-health notifications. Decides when to fire; never repeats itself.
@MainActor
final class Alerts {
    private var highSent = false
    private var lowSent = false
    private var healthSent = Set<String>()

    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func check(_ s: Snapshot, mode: Mode, settings: Settings) {
        if settings.alertsOn, let soc = s.soc {
            if mode == .charging && soc >= Double(settings.alertHigh) && !highSent {
                highSent = true
                notify("high", "Charged to \(settings.alertHigh)%", "Your Ocean reached the level you set.")
            }
            if mode != .charging { highSent = false }
            if soc <= Double(settings.alertLow) && !lowSent && mode != .charging {
                lowSent = true
                notify("low", "Charge is low", "The battery is at \(Int(soc.rounded()))%.")
            }
            if soc > Double(settings.alertLow + 3) { lowSent = false }
        }
        if settings.healthAlerts {
            if let v = s.aux12v, v < 11.8, mode != .driving {
                health("12v", "12V battery is low", String(format: "It reads %.2f V. A weak 12V battery can stop the Ocean from waking up.", v))
            }
            if let spread = s.cellSpread, spread > 80 {
                health("cells", "Cell voltages are uneven", "Highest and lowest cells differ by \(Int(spread.rounded())) mV.")
            }
            if let t = s.tempMax, t > 55 {
                health("temp", "Battery is hot", "Hottest battery sensor reads \(Int(t.rounded())) °C.")
            }
        }
    }

    func chargingStopped(_ entry: HistoryEntry, settings: Settings) {
        guard settings.alertsOn, settings.alertStop else { return }
        let soc = entry.socEnd.map { "Charge is at \(Int($0.rounded()))%. " } ?? ""
        notify("stop", "Charging stopped", soc + String(format: "Added %.1f kWh.", entry.kwh))
    }

    /// Called on each new connection so health warnings can fire again for a new day.
    func resetHealth() { healthSent.removeAll() }

    private func health(_ key: String, _ title: String, _ body: String) {
        if healthSent.insert(key).inserted { notify("health-\(key)", title, body) }
    }

    private func notify(_ id: String, _ title: String, _ body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}

/// Sends live data to A Better Route Planner's generic telemetry API. Only runs
/// when the user has entered both their ABRP token and a telemetry API key.
enum Abrp {
    private static let endpoint = "https://api.iternio.com/1/tlm/send"

    static func telemetry(_ s: Snapshot, mode: Mode, fast: Bool, settings: Settings, location: CLLocation?) -> [String: Any] {
        func r(_ v: Double, _ d: Int) -> Double { let f = pow(10.0, Double(d)); return (v * f).rounded() / f }
        var t: [String: Any] = ["utc": s.time / 1000]
        if let v = s.soc { t["soc"] = r(v, 1) }
        // ABRP wants power and current positive while using energy.
        if let v = s.powerKw { t["power"] = r(-v, 2) }
        if let v = s.packA { t["current"] = r(-v, 1) }
        if let v = s.packV { t["voltage"] = r(v, 1) }
        if let v = s.tempAvg { t["batt_temp"] = r(v, 1) }
        if let v = s.odometerKm { t["odometer"] = r(v, 1) }
        t["is_charging"] = mode == .charging ? 1 : 0
        if mode == .charging { t["is_dcfc"] = fast ? 1 : 0 }
        t["is_parked"] = mode == .driving ? 0 : 1
        if settings.usableKwh > 0 { t["capacity"] = settings.usableKwh }
        if let loc = location, Date().timeIntervalSince(loc.timestamp) < 120 {
            t["lat"] = loc.coordinate.latitude
            t["lon"] = loc.coordinate.longitude
            if loc.verticalAccuracy >= 0 { t["elevation"] = r(loc.altitude, 0) }
            if loc.speed >= 0 { t["speed"] = r(loc.speed * 3.6, 1) }
        }
        return t
    }

    /// Returns nil on success or a short message for the UI.
    static func send(_ tlm: [String: Any], settings: Settings) async -> String? {
        var comps = URLComponents(string: endpoint)!
        comps.queryItems = [
            URLQueryItem(name: "token", value: settings.abrpToken.trimmingCharacters(in: .whitespaces)),
            URLQueryItem(name: "api_key", value: settings.abrpKey.trimmingCharacters(in: .whitespaces)),
        ]
        guard let url = comps.url, let json = try? JSONSerialization.data(withJSONObject: tlm) else { return "Could not build the ABRP request" }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let body = "tlm=" + (String(decoding: json, as: UTF8.self).addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data(body.utf8)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = String(decoding: data, as: UTF8.self)
            if code == 401 || code == 403 { return "ABRP rejected the token or API key" }
            if !(200...299).contains(code) { return "ABRP error \(code)" }
            if let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                if (o["status"] as? String) == "ok" { return nil }
                if let e = o["error"] as? String, !e.isEmpty { return e }
            }
            return text.contains("\"ok\"") ? nil : "ABRP did not accept the data"
        } catch let e as URLError where e.code == .notConnectedToInternet || e.code == .cannotFindHost {
            return "No internet"
        } catch {
            return "Could not reach ABRP"
        }
    }
}

/// Phone location for ABRP, only while the user has turned location sharing on.
@MainActor
final class LocationFeed: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private(set) var latest: CLLocation?
    private var running = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func setEnabled(_ on: Bool) {
        if on && !running {
            running = true
            manager.requestWhenInUseAuthorization()
            manager.startUpdatingLocation()
        } else if !on && running {
            running = false
            manager.stopUpdatingLocation()
            latest = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in self.latest = last }
    }
}
