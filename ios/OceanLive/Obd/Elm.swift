import Foundation

/// A diagnostic module on the car's CAN bus: the 11-bit ID we send to and the
/// one it answers on (always request + 8 on the Ocean).
struct Ecu: Hashable, Identifiable {
    let code: String
    let name: String
    let request: String
    let response: String
    /// False for modules that implement no ECUReset at all (they answer 7F 11 12 to both kinds).
    var canRestart: Bool = true
    /// Telematics boxes expect a hard reset; everything else takes a soft one.
    var hardRestart: Bool = false

    var id: String { code }
}

/// One UDS ReadDataByIdentifier (service 0x22) value.
///
/// value = raw * scale + offset, then negated if `negate`. Readings outside
/// minValue...maxValue are thrown away so a garbled frame never shows up as a number.
struct Did: Hashable {
    let key: String
    let ecu: Ecu
    let did: String
    var bytes: Int = 2
    var scale: Double = 1
    var offset: Double = 0
    var negate: Bool = false
    var minValue: Double = -Double.infinity
    var maxValue: Double = Double.infinity
    /// Some cars send a wider field (e.g. pack current as 4 bytes). Accept this width too.
    var wideBytes: Int? = nil

    var command: String { "22" + did }

    /// Decodes the bytes that follow the "62 HH LL" positive response.
    func decode(_ data: [Int]) -> Double? {
        var width = bytes
        if let wide = wideBytes, data.count >= wide { width = wide }
        guard data.count >= width else { return nil }
        var raw: Int64 = 0
        for i in 0..<width { raw = (raw << 8) | Int64(data[i] & 0xFF) }
        var value = Double(raw) * scale + offset
        if negate { value = -value }
        guard value.isFinite, value >= minValue, value <= maxValue else { return nil }
        return value
    }
}

/// Module addresses on the Fisker Ocean (Magna BE21 platform). The scan list is
/// every module whose address has been seen answering on a real car.
enum Ecus {
    static let bms = Ecu(code: "BMS", name: "HV battery", request: "7E1", response: "7E9")
    static let bcm = Ecu(code: "BCM", name: "Body control", request: "7C1", response: "7C9")
    static let vcu = Ecu(code: "VCU", name: "Vehicle control", request: "7C2", response: "7CA")

    static let scanList: [Ecu] = [
        bms, vcu, bcm,
        Ecu(code: "MCU_F", name: "Front motor", request: "786", response: "78E"),
        Ecu(code: "MCU_R", name: "Rear motor", request: "7F2", response: "7FA"),
        Ecu(code: "PDU", name: "Power distribution", request: "7F3", response: "7FB"),
        Ecu(code: "PIU", name: "Power integration unit", request: "791", response: "799"),
        Ecu(code: "WTC", name: "HV coolant heater (A)", request: "752", response: "75A"),
        Ecu(code: "BTC", name: "HV coolant heater (B)", request: "7D5", response: "7DD"),
        Ecu(code: "ECC", name: "Climate control", request: "7F0", response: "7F8"),
        Ecu(code: "RAC", name: "Rear climate", request: "787", response: "78F", canRestart: false),
        Ecu(code: "ESP", name: "Stability control", request: "7D0", response: "7D8"),
        Ecu(code: "IBOOSTER", name: "Brake booster", request: "7F4", response: "7FC"),
        Ecu(code: "EPS", name: "Power steering", request: "7E3", response: "7EB"),
        Ecu(code: "EPS2", name: "Power steering (backup)", request: "7F5", response: "7FD"),
        Ecu(code: "ACU", name: "Airbags", request: "7A0", response: "7A8"),
        Ecu(code: "PKC", name: "Keys and NFC", request: "7A2", response: "7AA"),
        Ecu(code: "ICC", name: "Cockpit and screens", request: "7B1", response: "7B9"),
        Ecu(code: "GW", name: "Gateway", request: "7B6", response: "7BE"),
        Ecu(code: "TBOX_EU", name: "Telematics (EU)", request: "7D1", response: "7D9", hardRestart: true),
        Ecu(code: "TBOX_US", name: "Telematics (US)", request: "742", response: "74A", hardRestart: true),
        Ecu(code: "HYDRA", name: "Driver assist (ADAS)", request: "7A6", response: "7AE"),
        Ecu(code: "FCM", name: "Front camera", request: "780", response: "788"),
        Ecu(code: "MRR", name: "Front radar", request: "781", response: "789"),
        Ecu(code: "CMRR_FL", name: "Corner radar front left", request: "794", response: "79C"),
        Ecu(code: "CMRR_FR", name: "Corner radar front right", request: "782", response: "78A"),
        Ecu(code: "CMRR_RL", name: "Corner radar rear left", request: "796", response: "79E"),
        Ecu(code: "CMRR_RR", name: "Corner radar rear right", request: "7A7", response: "7AF"),
        Ecu(code: "OHC", name: "Overhead console", request: "783", response: "78B"),
        Ecu(code: "CIM", name: "Steering column", request: "7D3", response: "7DB"),
        Ecu(code: "MFSS", name: "Steering wheel switches", request: "797", response: "79F"),
        Ecu(code: "DSMC", name: "Driver seat", request: "7A4", response: "7AC"),
        Ecu(code: "PSM", name: "Passenger seat", request: "793", response: "79B"),
        Ecu(code: "PWC_L", name: "Wireless phone charger left", request: "785", response: "78D"),
        Ecu(code: "PWC_R", name: "Wireless phone charger right", request: "792", response: "79A"),
        Ecu(code: "PLGM", name: "Power liftgate", request: "7A3", response: "7AB"),
        Ecu(code: "TRM", name: "Trailer module", request: "7C7", response: "7CF"),
        Ecu(code: "AMP", name: "Audio amplifier", request: "7B5", response: "7BD"),
        Ecu(code: "VSP", name: "Pedestrian warning speaker", request: "7C6", response: "7CE"),
    ]

    /// The module with this code. A code that is no longer known comes back with the code as its name.
    static func byCode(_ code: String) -> Ecu {
        scanList.first { $0.code == code } ?? Ecu(code: code, name: code, request: "", response: "", canRestart: false)
    }
}

/// What Ocean Live reads. The BMS values were confirmed against the car's own
/// screen on a real Ocean (BMS at 7E1/7E9); the 12V reading comes from the
/// OEM data (KL30 terminal at the BMS) and falls back to the adapter's ATRV.
enum Pids {
    static let soc = Did(key: "soc", ecu: Ecus.bms, did: "2050", scale: 0.1, minValue: 0, maxValue: 100.5)
    static let packV = Did(key: "packV", ecu: Ecus.bms, did: "2003", scale: 0.1, minValue: 60, maxValue: 600)
    /// Pack current. Raw is offset by 2000 A; negated so charging and regen are positive.
    static let packA = Did(key: "packA", ecu: Ecus.bms, did: "2004", scale: 0.1, offset: -2000, negate: true,
                           minValue: -1500, maxValue: 1500, wideBytes: 4)
    static let tempAvg = Did(key: "tempAvg", ecu: Ecus.bms, did: "2038", scale: 0.5, offset: -50, minValue: -40, maxValue: 100)
    static let cellMax = Did(key: "cellMax", ecu: Ecus.bms, did: "2137", minValue: 1000, maxValue: 5000)
    static let cellMin = Did(key: "cellMin", ecu: Ecus.bms, did: "2138", minValue: 1000, maxValue: 5000)

    static let cellAvg = Did(key: "cellAvg", ecu: Ecus.bms, did: "2136", minValue: 1000, maxValue: 5000)
    static let tempMax = Did(key: "tempMax", ecu: Ecus.bms, did: "2039", scale: 0.5, offset: -50, minValue: -40, maxValue: 100)
    static let tempMin = Did(key: "tempMin", ecu: Ecus.bms, did: "2040", scale: 0.5, offset: -50, minValue: -40, maxValue: 100)
    static let coolantIn = Did(key: "coolantIn", ecu: Ecus.bms, did: "2026", scale: 0.5, offset: -50, minValue: -40, maxValue: 100)
    static let coolantOut = Did(key: "coolantOut", ecu: Ecus.bms, did: "2027", scale: 0.5, offset: -50, minValue: -40, maxValue: 100)
    static let isolation = Did(key: "isolation", ecu: Ecus.bms, did: "2069", minValue: 0, maxValue: 65535)
    static let aux12v = Did(key: "aux12v", ecu: Ecus.bms, did: "2130", scale: 0.001, minValue: 8, maxValue: 18)

    /// Odometer from the body controller, hundredths of a km.
    static let odometer = Did(key: "odometer", ecu: Ecus.bcm, did: "3409", bytes: 4, scale: 0.01, minValue: 0, maxValue: 2_000_000)

    static let fast = [soc, packV, packA, tempAvg, cellMax, cellMin]
    static let slow = [cellAvg, tempMax, tempMin, coolantIn, coolantOut, isolation, aux12v]
}

/// An ELM327 reply turned into bytes. `declaredLength` is the ISO-TP length line of a multi-frame reply.
struct ElmReply {
    let bytes: [Int]
    let declaredLength: Int?
    let noData: Bool
}

/// Pure parsing of ELM327 text output (headers off, CAN auto-formatting on).
enum Elm {
    /// AT commands sent once after connecting.
    static let initCommands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATCAF1", "ATSP6", "ATAT1", "ATST20"]

    static func isHex(_ c: Character) -> Bool {
        ("0"..."9").contains(c) || ("A"..."F").contains(c)
    }

    static func parse(_ response: String) -> ElmReply {
        let text = response.replacingOccurrences(of: ">", with: "").uppercased()
        let noData = ["NO DATA", "UNABLE", "CAN ERROR", "STOPPED", "BUS ERROR"].contains { text.contains($0) }
        var declared: Int? = nil
        var bytes: [Int] = []
        for raw in text.split(whereSeparator: { $0 == "\r" || $0 == "\n" }) {
            var chars = Array(raw.replacingOccurrences(of: " ", with: "").trimmingCharacters(in: .whitespaces))
            if chars.isEmpty { continue }
            if chars.count >= 2, chars[1] == ":", isHex(chars[0]) {
                chars = Array(chars.dropFirst(2))
            } else if chars.count == 3, chars.allSatisfy(isHex) {
                declared = Int(String(chars), radix: 16)
                continue
            }
            guard !chars.isEmpty, chars.count % 2 == 0, chars.allSatisfy(isHex) else { continue }
            var i = 0
            while i + 1 < chars.count {
                if let b = Int(String(chars[i...(i + 1)]), radix: 16) { bytes.append(b) }
                i += 2
            }
        }
        return ElmReply(bytes: bytes, declaredLength: declared, noData: noData)
    }

    /// Data bytes after "62 HH LL" for `did`, or nil if the reply has no positive answer for it.
    static func didData(_ response: String, did: String) -> [Int]? {
        let reply = parse(response)
        let b = reply.bytes
        guard b.count >= 3, let hi = Int(did.prefix(2), radix: 16), let lo = Int(did.suffix(2), radix: 16) else { return nil }
        for i in 0...(b.count - 3) where b[i] == 0x62 && b[i + 1] == hi && b[i + 2] == lo {
            // Multi-frame replies are padded out to whole CAN frames; the length line says where the data ends.
            var end = b.count
            if let declared = reply.declaredLength { end = Swift.min(b.count, i + declared) }
            let start = i + 3
            return start < end ? Array(b[start..<end]) : []
        }
        return nil
    }

    static func read(_ response: String, _ did: Did) -> Double? {
        didData(response, did: did.did).flatMap { did.decode($0) }
    }

    /// Parses an ATRV reply such as "12.6V".
    static func adapterVoltage(_ response: String) -> Double? {
        let text = response.replacingOccurrences(of: ">", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = Rx.firstGroup(#"(\d{1,2}(?:\.\d+)?)\s*V?"#, in: text, caseInsensitive: true),
              let v = Double(match), (5.0...20.0).contains(v) else { return nil }
        return v
    }

    /// VIN from a 22 F190 reply, if it is a well-formed 17-character VIN.
    static func vin(_ response: String) -> String? {
        guard let data = didData(response, did: "F190") else { return nil }
        let printable = data.filter { (0x20...0x7E).contains($0) }.map { UInt8($0) }
        let text = (String(bytes: printable, encoding: .ascii) ?? "").trimmingCharacters(in: .whitespaces)
        return Rx.matches(#"^[A-HJ-NPR-Z0-9]{17}$"#, text) ? text : nil
    }
}

/// Small regular-expression helpers on top of NSRegularExpression.
enum Rx {
    static func matches(_ pattern: String, _ s: String) -> Bool {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return false }
        return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    static func firstGroup(_ pattern: String, in s: String, caseInsensitive: Bool = false) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: s) else { return nil }
        return String(s[r])
    }

    static func replace(_ pattern: String, in s: String, with template: String, caseInsensitive: Bool = false) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else { return s }
        return re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: template)
    }
}
