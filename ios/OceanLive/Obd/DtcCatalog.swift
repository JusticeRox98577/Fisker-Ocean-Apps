import Foundation

enum DescriptionSource {
    case imported, ocean, sae, derived

    var label: String {
        switch self {
        case .imported: return "Your description list"
        case .ocean: return "Fisker Ocean"
        case .sae: return "SAE standard code"
        case .derived: return "Worked out from the code"
        }
    }
}

enum DtcSeverity: String {
    case info, warning, critical

    var label: String {
        switch self {
        case .info: return "Minor"
        case .warning: return "Warning"
        case .critical: return "Critical"
        }
    }
}

/// What a fault code means, in plain words. `note` is extra context such as "usually harmless".
/// Imported lists can add `impact`, possible `causes` and repair `steps`.
struct DtcInfo: Equatable {
    var title: String
    var source: DescriptionSource
    var note: String? = nil
    var from: String? = nil
    var severity: DtcSeverity? = nil
    var module: String? = nil
    var impact: String? = nil
    var causes: [String] = []
    var steps: [String] = []

    var sourceLabel: String { from ?? source.label }
    var hasDetails: Bool { impact != nil || !causes.isEmpty || !steps.isEmpty }
}

/// One imported description. `rank` decides which list wins when two describe the same code:
/// 4 your own list, 3 Fisker service guide, 2 Fisker ODX data, 1 community table.
struct DtcDetail: Equatable {
    var title: String? = nil
    var module: String? = nil
    var severity: DtcSeverity? = nil
    var impact: String? = nil
    var causes: [String] = []
    var steps: [String] = []
    var rank: Int = DtcDetail.rankUser

    static let rankUser = 4

    var isEmpty: Bool { title == nil && impact == nil && causes.isEmpty && steps.isEmpty }

    static func rankLabel(_ rank: Int) -> String {
        switch rank {
        case 3: return "Fisker service guide"
        case 2: return "Fisker diagnostic data"
        case 1: return "Community list"
        default: return "Your description list"
        }
    }
}

/// Turns fault codes into descriptions. Lookup order:
/// 1. a description list the user imported,
/// 2. Ocean-specific codes documented from real cars,
/// 3. SAE J2012 standard codes (the first five characters),
/// 4. a description built from the code's structure: system, reporting module and failure type.
final class DtcCatalog {
    static let shared = DtcCatalog()

    /// Codes some modules send in place of "no fault". Never real.
    static let placeholders: Set<String> = ["B2AAAAA", "U3FFFFF", "U17A100"]

    private var imported: [String: DtcDetail] = [:]

    var importedCount: Int { imported.count }

    func setImported(_ map: [String: DtcDetail]) {
        var out: [String: DtcDetail] = [:]
        for (k, v) in map where !v.isEmpty { out[k.trimmingCharacters(in: .whitespaces).uppercased()] = v }
        imported = out
    }

    func describe(_ code: String, ecu: Ecu?) -> DtcInfo {
        let c = code.uppercased()
        let base = builtIn(c, ecu: ecu)
        if let d = imported[c] { return withDetail(base, d, title: d.title) }
        if let d = imported[String(c.prefix(5))] { return withDetail(base, d, title: d.title.map { withType($0, c) }) }
        return base
    }

    private func builtIn(_ c: String, ecu: Ecu?) -> DtcInfo {
        if let o = Self.ocean[c] { return o }
        if let s = Self.sae[String(c.prefix(5))] { return DtcInfo(title: withType(s, c), source: .sae) }
        return DtcInfo(title: derive(c, ecu: ecu), source: .derived)
    }

    private func withDetail(_ base: DtcInfo, _ d: DtcDetail, title: String?) -> DtcInfo {
        var i = base
        if let title {
            i.title = title
            i.source = .imported
            i.from = DtcDetail.rankLabel(d.rank)
        }
        i.severity = d.severity
        i.module = d.module
        i.impact = d.impact
        i.causes = d.causes
        i.steps = d.steps
        return i
    }

    private func withType(_ text: String, _ code: String) -> String {
        guard let type = Dtcs.failureType(code) else { return text }
        return "\(text) (\(type))"
    }

    private func derive(_ code: String, ecu: Ecu?) -> String {
        let module = ecu?.name ?? "A module"
        let type = Dtcs.failureType(code)
        let system: String
        switch code.first ?? "U" {
        case "P": system = "Powertrain"
        case "C": system = "Chassis"
        case "B": system = "Body"
        default: system = "Network"
        }
        if code.hasPrefix("U") {
            switch String(code.dropFirst(5)) {
            case "87": return "\(module) is missing messages from another module (lost communication)"
            case "88": return "\(module) reports the data bus went offline (bus off)"
            case "81", "86": return "\(module) received invalid data from another module"
            case "82", "83", "62", "F1": return "\(module) received a message that failed its integrity check"
            default: return "Communication fault in \(module)" + (type.map { ": \($0)" } ?? "")
            }
        }
        return "\(system) fault in \(module)" + (type.map { ": \($0)" } ?? "")
    }

    // MARK: Importing

    /// Fixes codes damaged by OCR in scanned manuals: a leading 8 for B, and O, I, T or L for 0, 1, 1, 1
    /// after the first character. Returns nil when the result still isn't a valid code.
    static func normalizeCode(_ raw: String) -> String? {
        let k = Array(raw.trimmingCharacters(in: .whitespaces).uppercased())
        guard k.count == 5 || k.count == 7 else { return nil }
        let first: Character = k[0] == "8" ? "B" : k[0]
        let rest = k.dropFirst().map { (c: Character) -> Character in
            switch c {
            case "O": return "0"
            case "I", "T", "L": return "1"
            default: return c
            }
        }
        let code = String(first) + String(rest)
        return Rx.matches("^[PCBU][0-3][0-9A-F]{3}([0-9A-F]{2})?$", code) ? code : nil
    }

    /// Reads an imported list. Accepts:
    /// - JSON {"CODE": "text"} or {"CODE": {"name": ..., "repairSteps": [...], ...}},
    ///   optionally wrapped as {"dtcLabels": {...}} (the format Fisker DTC tables are shared in),
    /// - CSV lines "CODE,text".
    static func parseImport(_ text: String) -> [String: DtcDetail] {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("\u{FEFF}") { trimmed.removeFirst() } // byte-order mark some editors add
        return trimmed.hasPrefix("{") ? parseJson(trimmed) : parseCsv(trimmed)
    }

    private static func parseCsv(_ text: String) -> [String: DtcDetail] {
        var out: [String: DtcDetail] = [:]
        for line in text.components(separatedBy: .newlines) {
            guard let sep = line.firstIndex(where: { $0 == "," || $0 == ";" || $0 == "\t" }) else { continue }
            let rawCode = line[..<sep].trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            let rawText = line[line.index(after: sep)...].trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            guard let code = normalizeCode(rawCode), let title = cleanTitle(rawText, code: code) else { continue }
            out[code] = DtcDetail(title: title)
        }
        return out
    }

    private static func parseJson(_ text: String) -> [String: DtcDetail] {
        guard let data = text.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        let table = (root["dtcLabels"] as? [String: Any]) ?? (root["codes"] as? [String: Any]) ?? root
        var out: [String: DtcDetail] = [:]
        var repaired: [(String, DtcDetail)] = []
        for (key, value) in table {
            guard let code = normalizeCode(key) else { continue }
            var detail: DtcDetail?
            if let s = value as? String {
                detail = cleanTitle(s, code: code).map { DtcDetail(title: $0) }
            } else if let o = value as? [String: Any] {
                detail = detailFrom(o, code: code)
            }
            guard let detail else { continue }
            // A clean key beats one repaired from OCR damage.
            if code == key.trimmingCharacters(in: .whitespaces).uppercased() {
                out[code] = merge(out[code], detail)
            } else {
                repaired.append((code, detail))
            }
        }
        for (code, d) in repaired where out[code] == nil { out[code] = d }
        return out
    }

    private static func detailFrom(_ v: [String: Any], code: String) -> DtcDetail? {
        func str(_ k: String) -> String? { v[k] as? String }
        func list(_ k: String) -> [String] { (v[k] as? [Any])?.compactMap { $0 as? String } ?? [] }
        let title = ["name", "description", "title", "label"].lazy.compactMap { str($0).flatMap { cleanTitle($0, code: code) } }.first
        let rank: Int
        if let r = v["rank"] as? NSNumber {
            rank = r.intValue
        } else {
            switch str("source") {
            case "fisker-service-tsg": rank = 3
            case "odx-fast": rank = 2
            case "community-fisker-dtc": rank = 1
            default: rank = DtcDetail.rankUser
            }
        }
        var steps = cleanSteps(list("repairSteps") + list("steps"))
        if steps.isEmpty, let fix = str("oneLineFix") { steps = cleanSteps([fix]) }
        var module = str("ecu")?.trimmingCharacters(in: .whitespaces)
        if let m = module, m.isEmpty || isJunk(m) { module = nil }
        let d = DtcDetail(
            title: title,
            module: module,
            severity: str("severity").flatMap { DtcSeverity(rawValue: $0.lowercased()) },
            impact: str("impact").flatMap { clean($0) },
            causes: cleanList(list("rootCauses") + list("causes")),
            steps: steps,
            rank: rank
        )
        return d.isEmpty ? nil : d
    }

    /// Combines two descriptions of one code: the higher-ranked list wins each field, the other fills gaps.
    static func merge(_ a: DtcDetail?, _ b: DtcDetail) -> DtcDetail {
        guard let a else { return b }
        let (hi, lo) = b.rank >= a.rank ? (b, a) : (a, b)
        return DtcDetail(
            title: hi.title ?? lo.title,
            module: hi.module ?? lo.module,
            severity: hi.severity ?? lo.severity,
            impact: hi.impact ?? lo.impact,
            causes: hi.causes.isEmpty ? lo.causes : hi.causes,
            steps: hi.steps.isEmpty ? lo.steps : hi.steps,
            rank: hi.rank
        )
    }

    static func mergeAll(_ old: [String: DtcDetail], _ new: [String: DtcDetail]) -> [String: DtcDetail] {
        var out = old
        for (k, v) in new { out[k] = merge(out[k], v) }
        return out
    }

    /// The saved form of an imported list; `parseImport` reads it back.
    static func toJson(_ map: [String: DtcDetail]) -> String {
        var table: [String: Any] = [:]
        for (code, d) in map {
            var o: [String: Any] = ["rank": d.rank]
            if let t = d.title { o["name"] = t }
            if let m = d.module { o["ecu"] = m }
            if let s = d.severity { o["severity"] = s.rawValue }
            if let i = d.impact { o["impact"] = i }
            if !d.causes.isEmpty { o["rootCauses"] = d.causes }
            if !d.steps.isEmpty { o["repairSteps"] = d.steps }
            table[code] = o
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["dtcLabels": table], options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: Cleaning up scraped and OCR'd text

    private static let junk: Set<String> = ["nan", "ran", "na", "n/a", "tbd", "0", "#name?", "-", "none", "not_supported", "not supported", "case", "and"]
    private static let accessoryNote = "Note: Ensure the customer has not installed"
    private static let boilerplate = ["Reference Connector End View", "Ensure the customer has not installed"]

    private static func isJunk(_ s: String) -> Bool { junk.contains(s.trimmingCharacters(in: .whitespaces).lowercased()) }

    /// Tidies one string, or returns nil when nothing useful is left.
    static func clean(_ raw: String) -> String? {
        var s = raw
        if let r = s.range(of: accessoryNote, options: .caseInsensitive) { s = String(s[..<r.lowerBound]) }
        s = Rx.replace("(?<=[a-z])(\\?{2,3}|\\?€\\?)(?=[a-z])", in: s, with: "'")
        s = Rx.replace("\\?{3}|\\?€\\?|Â|»i", in: s, with: " ")
        s = Rx.replace("_?\\[command\\]", in: s, with: "")
        s = Rx.replace("_\\d+$", in: s, with: "") // "…disabled_12" numbering left by a spreadsheet export
        s = Rx.replace("\\s+", in: s, with: " ").trimmingCharacters(in: .whitespaces)
        while let f = s.first, ")-., ".contains(f) { s.removeFirst() }
        s = Rx.replace("^(nan|tbd|ran)\\b\\s*", in: s, with: "", caseInsensitive: true).trimmingCharacters(in: .whitespaces)
        if s.count < 3 || isJunk(s) { return nil }
        if boilerplate.contains(where: { s.lowercased().hasPrefix($0.lowercased()) }) { return nil }
        if s.contains("EC-1 Ignition Status") { return nil }
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    private static func cleanList(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.compactMap { clean($0) }.filter { seen.insert($0).inserted }
    }

    private static func cleanSteps(_ items: [String]) -> [String] { cleanList(items).filter { $0.count >= 5 } }

    private static let abbrev: [String: String] = [
        "OOR": "out of range", "VOLT": "voltage", "TEMP": "temperature", "CURR": "current",
        "DEVN": "deviation", "FLT": "fault", "ERR": "error", "SFTY": "safety", "COM": "communication",
        "HW": "hardware", "SW": "software", "NOK": "not OK", "ERATC": "erratic",
    ]

    private static let acronyms: Set<String> = [
        "CAN", "LIN", "ECU", "MCU", "VCU", "BMS", "BCM", "ACU", "ESP", "EPS", "ICC", "PDU", "OBC", "DCDC", "HV", "LV", "AC", "DC",
        "PWM", "NVM", "RAM", "ROM", "SRAM", "SBC", "RPS", "BLDC", "ADAS", "SECOC", "CRC", "OS", "MPU", "SMU", "DTS", "TBOX", "GW",
        "AGS", "EWP", "EXV", "CFM", "PTC", "WTC", "IGBT", "PCB", "NTC", "LED", "AEB", "APB", "WSS", "ASIC", "CDD", "PLD", "ED", "PN2", "PN3",
    ]

    /// Makes a readable title: drops a repeated code prefix and turns names like DTC_SYS_VOLTAGE_LOW into words.
    static func cleanTitle(_ raw: String, code: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.uppercased().hasPrefix(code) { s = String(s.dropFirst(code.count)) }
        guard var t = clean(s) else { return nil }
        if (t.contains("_") && !t.contains(" ")) || Rx.matches("^DTC_[A-Z0-9_]+$", t) {
            var name = t
            if name.hasPrefix("DTC_") { name = String(name.dropFirst(4)) }
            let words = name.split(separator: "_").map(String.init)
            t = words.map { (w: String) -> String in
                let u = w.uppercased()
                if let a = abbrev[u] { return a }
                if acronyms.contains(u) || w.contains(where: { $0.isNumber }) { return u }
                return w.lowercased()
            }.joined(separator: " ")
            t = t.prefix(1).uppercased() + t.dropFirst()
        }
        return t.count >= 3 && !isJunk(t) ? t : nil
    }

    // MARK: Built-in descriptions

    private static let oloopNote =
        "Common on cars running the O-Loop / ovloop 2.2.3+ software, where it is usually a side effect of the update rather than a real fault."

    /// Ocean codes whose meaning has been confirmed from the manufacturer's own fault text or real cars.
    private static let ocean: [String: DtcInfo] = [
        "U15AD87": DtcInfo(title: "Lost communication with the power steering module", source: .ocean),
        "U1613F1": DtcInfo(title: "End-to-end message check failed (a module received a message that failed its integrity check)", source: .ocean),
        "U199701": DtcInfo(title: "Lost communication with HV coolant heater H", source: .ocean, note: "Cabin heating may not work."),
        "U199702": DtcInfo(title: "Lost communication with HV coolant heater B", source: .ocean, note: "The high-voltage battery heater may not work."),
        "U201162": DtcInfo(title: "Communication verification failure", source: .ocean),
        "U201262": DtcInfo(title: "Communication verification failure", source: .ocean),
        "B20FE16": DtcInfo(title: "Trailer module supply voltage below threshold", source: .ocean, note: "Trailer lamps may not light up fully."),
        "B208896": DtcInfo(title: "Overhead console touch controller not responding (component internal failure)", source: .ocean),
        "B178854": DtcInfo(title: "Module not coded (configuration missing)", source: .ocean),
        "C21A531": DtcInfo(title: "Front camera: no signal on its Ethernet link (timeout)", source: .ocean),
        "C21A586": DtcInfo(title: "Front camera: invalid signal on its Ethernet link", source: .ocean),
        "U114281": DtcInfo(title: "Invalid value received from climate control", source: .ocean, note: oloopNote),
        "U1142F1": DtcInfo(title: "Climate control signal outdated (ambient / coolant temperature)", source: .ocean, note: oloopNote),
        "U114381": DtcInfo(title: "Invalid value received from stability control", source: .ocean, note: oloopNote),
        "U1143F1": DtcInfo(title: "Stability control (ABS) signal outdated", source: .ocean, note: oloopNote),
        "U114581": DtcInfo(title: "Invalid value received from the cockpit controller", source: .ocean, note: oloopNote),
        "U1145F1": DtcInfo(title: "Cockpit controller signal outdated", source: .ocean, note: oloopNote),
    ]

    /// SAE J2012 standard codes, keyed by the 5-character base code.
    private static let sae: [String: String] = [
        "P0562": "System voltage low", "P0563": "System voltage high",
        "P0601": "Control module memory checksum error", "P0602": "Control module programming error",
        "P0603": "Control module keep-alive memory error", "P0604": "Control module RAM error",
        "P0605": "Control module ROM error", "P0606": "Control module processor fault",
        "P0607": "Control module performance", "P0500": "Vehicle speed sensor A",
        "P0504": "Brake switch A/B correlation", "P0571": "Brake switch A circuit",
        "P0700": "Transmission control system (warning lamp requested)",
        "P0A0A": "High-voltage system interlock circuit", "P0A0B": "High-voltage system interlock circuit performance",
        "P0A0C": "High-voltage system interlock circuit low", "P0A0D": "High-voltage system interlock circuit high",
        "P0A1F": "Battery energy control module", "P0A78": "Drive motor A inverter performance",
        "P0A79": "Drive motor B inverter performance", "P0A7D": "High-voltage battery state of charge low",
        "P0A7E": "High-voltage battery over temperature", "P0A7F": "High-voltage battery deterioration",
        "P0A80": "Replace high-voltage battery pack", "P0A90": "Drive motor A performance",
        "P0A94": "DC/DC converter performance", "P0A95": "High-voltage fuse",
        "P0AA0": "High-voltage battery positive contactor circuit", "P0AA1": "High-voltage battery positive contactor stuck closed",
        "P0AA2": "High-voltage battery positive contactor stuck open", "P0AA6": "High-voltage isolation fault",
        "U0001": "High-speed CAN bus", "U0002": "High-speed CAN bus performance",
        "U0073": "Communication bus A off", "U0074": "Communication bus B off",
        "U0100": "Lost communication with powertrain control module", "U0111": "Lost communication with battery energy control module",
        "U0121": "Lost communication with ABS module", "U0122": "Lost communication with vehicle dynamics module",
        "U0126": "Lost communication with steering angle sensor", "U0131": "Lost communication with power steering module",
        "U0140": "Lost communication with body control module", "U0151": "Lost communication with airbag module",
        "U0155": "Lost communication with instrument cluster", "U0164": "Lost communication with climate control module",
        "U0184": "Lost communication with radio", "U0293": "Lost communication with hybrid/EV powertrain control module",
        "U0401": "Invalid data received from powertrain control module", "U0415": "Invalid data received from ABS module",
        "U0422": "Invalid data received from body control module", "U0428": "Invalid data received from steering angle sensor",
        "C0035": "Left front wheel speed sensor circuit", "C0040": "Right front wheel speed sensor circuit",
        "C0045": "Left rear wheel speed sensor circuit", "C0050": "Right rear wheel speed sensor circuit",
    ]
}
