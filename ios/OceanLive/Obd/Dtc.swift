import Foundation

enum DtcState: Int, CaseIterable {
    case active, pending, stored, lamp, other

    var label: String {
        switch self {
        case .active: return String(localized: "Active now")
        case .pending: return String(localized: "Pending")
        case .stored: return String(localized: "Stored (history)")
        case .lamp: return String(localized: "Warning lamp")
        case .other: return String(localized: "Other")
        }
    }
}

/// One fault code from a UDS ReadDTCInformation (19 02) reply.
struct Dtc: Hashable, Identifiable {
    let code: String
    let status: Int
    let ecu: Ecu

    var id: String { ecu.code + code }
    var state: DtcState { Dtcs.state(status) }
    var failureType: String? { Dtcs.failureType(code) }
    var info: DtcInfo { DtcCatalog.shared.describe(code, ecu: ecu) }
}

enum DtcReadResult: Equatable {
    /// `complete` is false when the ECU announced more records than arrived.
    case ok(codes: [Dtc], complete: Bool)
    case noAnswer
    case refused(nrc: Int)
    case garbled
}

enum Dtcs {
    /// Ask for every stored code, whatever its status.
    static let readAll = "1902FF"

    static func parse(_ response: String, ecu: Ecu) -> DtcReadResult {
        let reply = Elm.parse(response)
        let b = reply.bytes
        if reply.noData || b.isEmpty { return .noAnswer }
        let start = b.count > 2 ? (0..<(b.count - 2)).first(where: { b[$0] == 0x59 && b[$0 + 1] == 0x02 }) : nil
        guard let start else {
            let neg = b.count > 2 ? (0..<(b.count - 2)).first(where: { b[$0] == 0x7F && b[$0 + 1] == 0x19 }) : nil
            if let neg { return .refused(nrc: b[neg + 2]) }
            return .garbled
        }
        // Records start after "59 02 <availability mask>". Each is 3 code bytes + 1 status byte.
        var end = b.count
        if let declared = reply.declaredLength { end = Swift.min(b.count, start + declared) }
        let first = start + 3
        var codes: [Dtc] = []
        var i = first
        let padding: Set<Int> = [0x00, 0xAA, 0xCC, 0xFF]
        while i + 3 < end {
            let b0 = b[i], b1 = b[i + 1], b2 = b[i + 2], st = b[i + 3]
            i += 4
            if b0 == b1 && b1 == b2 && padding.contains(b0) { continue } // frame padding
            let c = code(b0, b1, b2)
            if DtcCatalog.placeholders.contains(c) { continue } // "no fault" placeholders, never real
            codes.append(Dtc(code: c, status: st, ecu: ecu))
        }
        let expected = reply.declaredLength.map { ($0 - 3) / 4 }
        let got = Swift.max(end - first, 0) / 4
        return .ok(codes: codes, complete: expected == nil || got >= expected!)
    }

    /// Three DTC bytes to the 7-character form, e.g. 0xD7 0x8B 0x11 -> "U178B11".
    static func code(_ b0: Int, _ b1: Int, _ b2: Int) -> String {
        let letters: [Character] = ["P", "C", "B", "U"]
        var s = String(letters[(b0 >> 6) & 3])
        s += String((b0 >> 4) & 3)
        s += hex(b0 & 0xF) + hex(b1 >> 4) + hex(b1 & 0xF) + hex(b2 >> 4) + hex(b2 & 0xF)
        return s
    }

    private static func hex(_ n: Int) -> String { String(Array("0123456789ABCDEF")[n & 0xF]) }

    /// For the "Active now" sort: every active code from every module (in scan order, then by code), and the rest.
    static func activeFirst(_ codes: [Dtc]) -> (active: [Dtc], rest: [Dtc]) {
        let order = Dictionary(Ecus.scanList.enumerated().map { ($1.code, $0) }, uniquingKeysWith: { a, _ in a })
        let active = codes.filter { $0.state == .active }.sorted { a, b in
            let oa = order[a.ecu.code] ?? Int.max, ob = order[b.ecu.code] ?? Int.max
            return oa != ob ? oa < ob : a.code < b.code
        }
        return (active, codes.filter { $0.state != .active })
    }

    /// ISO 14229 status byte to a plain state. Only bit 0 means "failing right now".
    static func state(_ status: Int) -> DtcState {
        if status & 0x01 != 0 { return .active }
        if status & 0x08 != 0 { return .stored }
        if status & 0x04 != 0 { return .pending }
        if status & 0x22 != 0 { return .stored }
        if status == 0x80 { return .lamp }
        return .other
    }

    /// SAE J2012 failure type: the last two characters of a 7-character code.
    static func failureType(_ code: String) -> String? {
        guard code.count == 7 else { return nil }
        let ftb = String(code.suffix(2))
        if ftb == "F1" { return "end-to-end message check failed" }
        if ftb.hasPrefix("F") { return "manufacturer-specific failure" }
        return failureTypes[ftb]
    }

    private static let failureTypes: [String: String] = [
        "01": "general electrical failure", "02": "general signal failure", "03": "frequency or PWM failure",
        "04": "internal system failure", "05": "programming failure", "06": "algorithm failure",
        "07": "mechanical failure", "08": "bus signal or message failure", "09": "component failure",
        "11": "short to ground", "12": "short to battery", "13": "open circuit", "14": "short to ground or open",
        "15": "short to battery or open", "16": "voltage below threshold", "17": "voltage above threshold",
        "18": "current below threshold", "19": "current above threshold", "1C": "voltage out of range",
        "1D": "current out of range", "1E": "resistance out of range", "21": "signal too low", "22": "signal too high",
        "29": "signal invalid", "31": "no signal", "41": "checksum failure", "42": "memory failure",
        "44": "data memory failure", "45": "program memory failure", "46": "calibration memory failure",
        "47": "watchdog failure", "49": "internal electronic failure", "4B": "over temperature",
        "51": "not programmed", "54": "not coded / missing calibration", "55": "not configured",
        "62": "communication verification failure", "64": "signal plausibility failure", "68": "event information",
        "71": "actuator stuck", "72": "actuator stuck open", "73": "actuator stuck closed",
        "81": "invalid data received", "82": "message counter wrong", "83": "message checksum wrong",
        "84": "signal below allowed range", "85": "signal above allowed range", "86": "signal invalid",
        "87": "message missing", "88": "bus off", "92": "performance or incorrect operation", "93": "no operation",
        "94": "unexpected operation", "95": "incorrect assembly", "96": "component internal failure",
        "97": "operation obstructed or blocked", "98": "over temperature",
    ]
}

/// Outcome of a UDS request that changes something (clear codes, restart a module).
enum UdsResult: Equatable {
    case done
    case refused(nrc: Int)
    case noAnswer
    case unclear

    var needsSecurity: Bool {
        if case .refused(let nrc) = self { return [0x33, 0x35, 0x36, 0x37].contains(nrc) }
        return false
    }
}

enum Uds {
    static let extendedSession = "1003"
    static let defaultSession = "1001"
    static let clearAll = "14FFFFFF"
    static let hardReset = "1101"
    static let softReset = "1103"
    /// ControlDTCSetting: stop logging new codes while clearing, then start again. Also undone by leaving the extended session.
    static let dtcSettingOff = "8502"
    static let dtcSettingOn = "8501"

    /// Reads a reply to `service` (0x14, 0x11, ...): positive is service + 0x40, negative is 7F service NRC.
    static func result(_ response: String?, service: Int) -> UdsResult {
        guard let response else { return .noAnswer }
        let reply = Elm.parse(response)
        let b = reply.bytes
        if b.isEmpty { return reply.noData ? .noAnswer : .unclear }
        // A module can answer 7F xx 78 ("busy, wait") and then the real answer in the same reply.
        if positiveAt(b, service) { return .done }
        if b.count > 2 {
            for i in 0..<(b.count - 2) where b[i] == 0x7F && b[i + 1] == service && b[i + 2] != 0x78 {
                return .refused(nrc: b[i + 2])
            }
        }
        return .unclear
    }

    /// True when the reply is only "busy, still working" (7F xx 78).
    static func pending(_ response: String?, service: Int) -> Bool {
        guard let response else { return false }
        let b = Elm.parse(response).bytes
        guard b.count > 2 else { return false }
        let busy = (0..<(b.count - 2)).contains { b[$0] == 0x7F && b[$0 + 1] == service && b[$0 + 2] == 0x78 }
        return busy && !positiveAt(b, service)
    }

    /// Positive reply byte at the start of the reply or right after a "busy" frame.
    private static func positiveAt(_ b: [Int], _ service: Int) -> Bool {
        b.indices.contains { i in
            b[i] == service + 0x40 && (i == 0 || (i >= 3 && b[i - 3] == 0x7F && b[i - 1] == 0x78))
        }
    }

    static func nrcText(_ nrc: Int) -> String {
        switch nrc {
        case 0x10: return String(localized: "the module rejected the request")
        case 0x11: return String(localized: "the module doesn't support this")
        case 0x12: return String(localized: "the module doesn't support this kind of request")
        case 0x13: return String(localized: "the request was malformed")
        case 0x14: return String(localized: "the reply was too long")
        case 0x21: return String(localized: "the module is busy, try again")
        case 0x22: return String(localized: "conditions not right (car must be on, in Park, not charging)")
        case 0x24: return String(localized: "request out of sequence")
        case 0x31: return String(localized: "value out of range")
        case 0x33: return String(localized: "security access required")
        case 0x35, 0x36, 0x37: return String(localized: "security access was refused")
        case 0x72: return String(localized: "the module failed to write its memory")
        case 0x7E, 0x7F: return String(localized: "not allowed in the current diagnostic session")
        default:
            let code = String(format: "0x%02X", nrc)
            return String(localized: "refused (code \(code))")
        }
    }
}
