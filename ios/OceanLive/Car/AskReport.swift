import Foundation

/// Why the owner reports an AI answer. The raw values are what the proxy expects.
enum ReportReason: String, CaseIterable, Identifiable {
    case offensive
    case harmful
    case wrong
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .offensive: return String(localized: "Offensive")
        case .harmful: return String(localized: "Harmful or dangerous")
        case .wrong: return String(localized: "Wrong or misleading")
        case .other: return String(localized: "Something else")
        }
    }
}

/// What the proxy said about a report.
enum ReportReply: Equatable {
    case sent
    /// `text` is shown as it is; `signedOut` means the server answered 401 and the session is gone.
    case failed(String, signedOut: Bool)
}

/// "Report this answer" in Any questions?: sends the answer's question id and a reason to the proxy
/// (POST /ask/report), which keeps the report with the logged question. Never talks to the car.
enum AskReport {
    /// The longest note the proxy keeps, in UTF-16 code units (JavaScript's string length, which the
    /// proxy checks), not in characters: an emoji counts as two.
    static let maxNote = 500

    /// The proxy's id for the logged question, from an /ask answer. A string or a whole number on the
    /// wire; the app keeps it as an opaque string. Nil when the server didn't send one (then the answer
    /// can't be reported).
    static func questionId(_ value: Any?) -> String? {
        if let s = value as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty || t.count > 200 ? nil : t
        }
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d.isFinite, d.rounded() == d, abs(d) < 9e15 else { return nil }
        return String(n.int64Value)
    }

    /// The report address: the server root (the "Any questions?" address without its "/ask") + "/ask/report".
    static func url(ask: URL?) -> URL? {
        guard let base = Accounts.baseURL(ask: ask) else { return nil }
        return URL(string: base.absoluteString + "/ask/report")
    }

    /// The note as sent: trimmed and at most `maxNote` UTF-16 units. Empty means none.
    static func cleanNote(_ note: String) -> String {
        cut(note.trimmingCharacters(in: .whitespacesAndNewlines), utf16: maxNote)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The longest start of `text` that is at most `limit` UTF-16 units, never splitting a character.
    static func cut(_ text: String, utf16 limit: Int) -> String {
        guard text.utf16.count > limit else { return text }
        var used = 0
        var out = ""
        for c in text {
            let n = c.utf16.count
            if used + n > limit { break }
            used += n
            out.append(c)
        }
        return out
    }

    /// The JSON body. `device` is the install id the app sends with every question, so an install
    /// without an account can report its own answers; a signed-in owner is also known by the bearer token.
    static func body(questionId: String, reason: ReportReason, note: String, device: String) -> [String: Any] {
        var body: [String: Any] = [
            "questionId": questionId,
            "reason": reason.rawValue,
            "device": device,
        ]
        let n = cleanNote(note)
        if !n.isEmpty { body["note"] = n }
        return body
    }

    /// Reads the proxy's reply. Pure, so it is unit tested.
    static func parse(status: Int, json: [String: Any]?) -> ReportReply {
        if (200..<300).contains(status), json?["ok"] as? Bool == true { return .sent }
        let error = json?["error"] as? String
        if status == 401 || error == "signin_required" {
            return .failed(String(localized: "Sign in again to report answers."), signedOut: status == 401)
        }
        if error == "not_found" || status == 404 {
            return .failed(String(localized: "This answer can't be reported any more."), signedOut: false)
        }
        if error == "rate_limited" || status == 429 {
            return .failed(String(localized: "You've sent a lot of reports today. Try again tomorrow."), signedOut: false)
        }
        return .failed(String(localized: "Couldn't send the report. Try again in a moment."), signedOut: false)
    }

    static func request(url: URL, body: [String: Any], token: String?) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }

    /// Sends one report with the same identity as the questions: the session token when signed in and
    /// this install's id.
    static func send(questionId: String, reason: ReportReason, note: String, token: String?) async -> ReportReply {
        guard let endpoint = url(ask: Ask.url) else {
            return .failed(String(localized: "Couldn't send the report. Try again in a moment."), signedOut: false)
        }
        let payload = body(questionId: questionId, reason: reason, note: note, device: Ask.installId())
        do {
            let (data, response) = try await URLSession.shared.data(for: request(url: endpoint, body: payload, token: token))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            return parse(status: status, json: json)
        } catch let e as URLError where e.code == .notConnectedToInternet || e.code == .networkConnectionLost {
            return .failed(String(localized: "No internet"), signedOut: false)
        } catch {
            return .failed(String(localized: "Couldn't send the report. Try again in a moment."), signedOut: false)
        }
    }
}
