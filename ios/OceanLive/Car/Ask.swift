import Foundation

/// One message in the "Any questions?" chat.
struct AskTurn: Identifiable, Equatable {
    let id = UUID()
    let fromOwner: Bool
    let text: String
}

/// "Any questions?": sends the owner's question to the Ocean Live proxy (ask-proxy/), which asks
/// Claude with a Fisker Ocean knowledge guide. The proxy holds the API key; the app never has one.
///
/// Car readings come only from what the app already has in memory. Asking never talks to the car.
/// The chat lives in memory only and is gone when the app closes.
@MainActor
final class Ask: ObservableObject {
    static let shared = Ask()

    /// The proxy address from the build (OCEAN_ASK_URL, via Info.plist); empty hides the feature.
    nonisolated static let url: URL? = {
        guard let s = (Bundle.main.object(forInfoDictionaryKey: "OceanAskURL") as? String)?
            .trimmingCharacters(in: .whitespaces), s.hasPrefix("https://") else { return nil }
        return URL(string: s)
    }()
    nonisolated static var enabled: Bool { url != nil }

    @Published private(set) var turns: [AskTurn] = []
    @Published private(set) var waiting = false
    @Published private(set) var error: String?
    /// The question that failed, to put back into the text field.
    @Published private(set) var retry: String?

    private static let maxTurns = 12

    func clear() {
        guard !waiting else { return }
        turns = []
        error = nil
        retry = nil
    }

    /// Sends `question` with the conversation so far. `car` is the readings text from `carSummary`,
    /// or nil when the owner turned sharing off.
    func send(_ question: String, car: String?) async {
        let q = String(question.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
        guard !q.isEmpty, !waiting, let url = Self.url else { return }
        turns.append(AskTurn(fromOwner: true, text: q))
        waiting = true
        error = nil
        retry = nil
        var recent = Array(turns.suffix(Self.maxTurns))
        while let first = recent.first, !first.fromOwner { recent.removeFirst() }
        let body = Self.requestBody(device: Self.installId(), turns: recent, car: car)
        let token = Accounts.shared.token
        let result = await Self.post(url, body: body, token: token)
        // The server no longer knows this session: back to the sign-in screen.
        if case .failure(let f) = result, f.signedOut { Accounts.shared.unauthorized(token: token) }
        switch result {
        case .success(let answer):
            turns.append(AskTurn(fromOwner: false, text: answer))
        case .failure(let message):
            // Take the question back out so the owner can try again; the text field gets it back.
            turns.removeLast()
            error = message.text
            retry = q
        }
        waiting = false
    }

    nonisolated static func requestBody(device: String, turns: [AskTurn], car: String?) -> [String: Any] {
        var body: [String: Any] = [
            "device": device,
            "messages": turns.map { ["role": $0.fromOwner ? "user" : "assistant", "text": $0.text] },
        ]
        if let car, !car.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body["car"] = car }
        return body
    }

    struct Failure: Error {
        let text: String
        /// The server answered 401: the session is gone.
        var signedOut = false
    }

    /// What the proxy's error codes mean for the owner.
    nonisolated static func errorMessage(status: Int, error: String?) -> String {
        if error == "signin_required" || status == 401 { return String(localized: "Sign in again to ask questions.") }
        if error == "rate_limited" || status == 429 { return String(localized: "That's all the questions for today. Try again tomorrow.") }
        if error == "budget" { return String(localized: "Questions are paused until next month.") }
        if error == "no_answer" { return String(localized: "Couldn't answer that one. Try asking another way.") }
        return String(localized: "Couldn't reach the questions service. Try again in a moment.")
    }

    private nonisolated static func post(_ url: URL, body: [String: Any], token: String?) async -> Result<String, Failure> {
        var request = URLRequest(url: url, timeoutInterval: 90)
        request.httpMethod = "POST"
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let answer = (json?["answer"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if (200..<300).contains(status), !answer.isEmpty { return .success(answer) }
            return .failure(Failure(text: errorMessage(status: status, error: json?["error"] as? String), signedOut: status == 401))
        } catch let e as URLError where e.code == .notConnectedToInternet || e.code == .networkConnectionLost {
            return .failure(Failure(text: String(localized: "No internet")))
        } catch {
            return .failure(Failure(text: errorMessage(status: 0, error: nil)))
        }
    }

    /// A random id for this install. The proxy counts questions per day by it and saves it with
    /// each question in the research log; the owner quotes it to have their questions deleted.
    nonisolated static func installId() -> String {
        if let id = UserDefaults.standard.string(forKey: "ask_device") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "ask_device")
        return id
    }

    /// The car's latest readings and fault codes as plain text for Claude, in metric units with the
    /// owner's units noted. Leaves out the VIN and anything else that identifies the car or owner.
    /// Same wording as the Android app.
    nonisolated static func carSummary(state: CarState, faults: FaultScan, settings: Settings, now: Int64) -> String {
        let s = state.snapshot
        var lines: [String] = []
        func n(_ v: Double, _ d: Int) -> String { String(format: "%.\(d)f", locale: Locale(identifier: "en_US_POSIX"), v) }
        func ago(_ t: Int64) -> String {
            let min = max(0, (now - t) / 60_000)
            if min < 1 { return "just now" }
            if min < 120 { return "\(min) min ago" }
            if min < 48 * 60 { return "\(min / 60) h ago" }
            return "\(min / 1440) days ago"
        }
        let model: String
        switch settings.model {
        case .big: model = "Ultra / Extreme / One (about 106.5 kWh usable)"
        case .sport: model = "Sport (about 75 kWh usable)"
        case .custom: model = "custom, \(n(settings.customKwh, 1)) kWh usable"
        }
        lines.append("Car model set in the app: \(model)")
        lines.append("Owner's units: " + (settings.useMiles ? "miles" : "km") + ", " + (settings.useFahrenheit ? "°F" : "°C"))
        if s.time > 0 {
            lines.append("Readings taken: \(ago(s.time))" + (state.connected ? " (connected now)" : " (not connected now)"))
            let mode: String
            switch state.mode {
            case .parked: mode = "parked"
            case .driving: mode = "driving"
            case .charging: mode = "charging"
            }
            lines.append("Car state: \(mode)")
            if let v = s.soc { lines.append("State of charge: \(n(v, 1)) %") }
            if s.packV != nil || s.packA != nil {
                let parts = [s.packV.map { "\(n($0, 1)) V" }, s.packA.map { "\(n($0, 1)) A" }, s.powerKw.map { "\(n($0, 1)) kW" }].compactMap { $0 }
                lines.append("Pack: " + parts.joined(separator: ", ") + " (current and power are positive into the pack)")
            }
            if s.tempAvg != nil || s.tempMin != nil || s.tempMax != nil {
                let parts = [s.tempAvg.map { "avg \(n($0, 1))" }, s.tempMin.map { "min \(n($0, 1))" }, s.tempMax.map { "max \(n($0, 1))" }].compactMap { $0 }
                lines.append("Battery temperature: " + parts.joined(separator: ", ") + " °C")
            }
            if s.coolantIn != nil || s.coolantOut != nil {
                let parts = [s.coolantIn.map { "in \(n($0, 1))" }, s.coolantOut.map { "out \(n($0, 1))" }].compactMap { $0 }
                lines.append("Coolant: " + parts.joined(separator: ", ") + " °C")
            }
            if s.cellAvg != nil || s.cellMin != nil || s.cellMax != nil {
                let parts = [s.cellAvg.map { "avg \(n($0, 0))" }, s.cellMin.map { "min \(n($0, 0))" }, s.cellMax.map { "max \(n($0, 0))" }, s.cellSpread.map { "spread \(n($0, 0))" }].compactMap { $0 }
                lines.append("Cell voltage: " + parts.joined(separator: ", ") + " mV")
            }
            if let v = s.isolation { lines.append("Insulation resistance: \(n(v, 0)) kΩ") }
            if let v = s.aux12v { lines.append("12 V battery: \(n(v, 2)) V" + (s.aux12vSource.map { " (\($0))" } ?? "")) }
            if let v = s.odometerKm { lines.append("Odometer: \(n(v, 0)) km") }
        } else {
            lines.append("No readings yet (the app has not been connected to the car).")
        }
        if let finished = faults.finishedAt {
            let codes = faults.codes.filter { !DtcCatalog.placeholders.contains($0.code) }
            lines.append("Last fault scan: \(ago(finished)), \(codes.count) code(s)" + (codes.isEmpty ? "" : ":"))
            for d in codes.prefix(40) {
                lines.append("- \(d.code) from \(d.ecu.code) (\(d.ecu.name)), \(stateName(d.state)): \(d.info.title)")
            }
        } else {
            lines.append("No fault scan in this session.")
        }
        return lines.joined(separator: "\n")
    }

    private nonisolated static func stateName(_ s: DtcState) -> String {
        switch s {
        case .active: return "active"
        case .pending: return "pending"
        case .stored: return "stored"
        case .lamp: return "lamp"
        case .other: return "other"
        }
    }
}
