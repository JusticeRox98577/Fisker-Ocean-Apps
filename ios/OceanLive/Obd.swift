import Foundation

/// What Ocean Live reads from the car. Every value comes from the Bluetooth OBD
/// adapter. Nothing here touches the network.
///
/// The pack readings are UDS ReadDataByIdentifier (service 22) requests to the
/// battery ECU at 7E1/7E9.
struct Pid {
    let key: String
    let command: String
    let formula: String
    var min: Double = -.infinity
    var max: Double = .infinity
}

enum Obd {
    /// AT commands sent once after connecting (ELM327 reset and quiet output).
    static let initCommands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP6", "ATST20"]

    /// Address the battery management ECU.
    static let headerCommands = ["ATSH7E1", "ATCRA7E9"]

    static let packPids: [Pid] = [
        Pid(key: "voltage", command: "222003", formula: "(A*256+B)/10", min: 60, max: 600),
        Pid(key: "current", command: "222016", formula: "T/10"),
        Pid(key: "batt_temp", command: "222038", formula: "(A*256+B)/2-50", min: -40, max: 100),
        Pid(key: "soc", command: "222050", formula: "(A*256+B)/10", min: 0, max: 100.5),
        Pid(key: "cell_max", command: "222137", formula: "A*256+B", min: 1000, max: 5000),
        Pid(key: "cell_min", command: "222138", formula: "A*256+B", min: 1000, max: 5000),
        // 12V battery (KL30 B+ terminal as seen by the BMS), millivolts. From the
        // Ocean ODX (KL30CVoltage). Falls back to ATRV if it doesn't answer.
        Pid(key: "aux_bms", command: "222130", formula: "(A*256+B)/1000", min: 8, max: 18),
    ]

    /// 12V fallback. ATRV reports the adapter's own supply voltage, which comes
    /// from OBD pin 16, the car's 12V system (about +/- 0.2 V of adapter error).
    static let auxVoltageCommand = "ATRV"

    static func parseAdapterVoltage(_ response: String) -> Double? {
        let text = response.replacingOccurrences(of: ">", with: "")
        guard let range = text.range(of: #"\d{1,2}(\.\d+)?"#, options: .regularExpression),
              let value = Double(text[range]), (5...20).contains(value) else { return nil }
        return value
    }

    /// Finds the positive response to `command` in an ELM327 reply and returns the
    /// data bytes after it. For "222003" the expected prefix is "622003". Handles
    /// ISO-TP multi-frame output ("0:", "1:" line prefixes and the length line).
    static func parseResponse(_ response: String, command: String) -> [Int]? {
        guard command.count >= 2, let service = Int(command.prefix(2), radix: 16) else { return nil }
        let prefix = (String(format: "%02X", service + 0x40) + command.dropFirst(2)).uppercased()
        let hex = response
            .replacingOccurrences(of: ">", with: "")
            .components(separatedBy: CharacterSet(charactersIn: "\r\n"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.range(of: "^[0-9A-Fa-f]{3}$", options: .regularExpression) == nil }
            .map { line -> String in
                if let r = line.range(of: "^[0-9A-Fa-f]:", options: .regularExpression) {
                    return String(line[r.upperBound...])
                }
                return line
            }
            .joined()
            .replacingOccurrences(of: " ", with: "")
            .uppercased()
        guard let found = hex.range(of: prefix) else { return nil }
        let tail = Array(hex[found.upperBound...])
        var bytes: [Int] = []
        var i = 0
        while i + 1 < tail.count {
            if let b = Int(String(tail[i...i + 1]), radix: 16) { bytes.append(b) }
            i += 2
        }
        return bytes
    }

    /// A to H are the data bytes. S, T, U are signed 16-bit words at bytes 0, 2, 4.
    static func byteVariables(_ bytes: [Int]) -> [Character: Double] {
        func signed(_ offset: Int) -> Double {
            guard offset + 1 < bytes.count else { return 0 }
            let value = bytes[offset] * 256 + bytes[offset + 1]
            return Double(value >= 32768 ? value - 65536 : value)
        }
        var vars: [Character: Double] = [:]
        let letters = Array("ABCDEFGH")
        for i in 0..<min(bytes.count, 8) { vars[letters[i]] = Double(bytes[i]) }
        vars["S"] = signed(0)
        vars["T"] = signed(2)
        vars["U"] = signed(4)
        return vars
    }

    static func read(_ pid: Pid, reply: String) -> Double? {
        guard let bytes = parseResponse(reply, command: pid.command),
              let value = Formula(pid.formula, variables: byteVariables(bytes)).evaluate(),
              value >= pid.min, value <= pid.max else { return nil }
        return value
    }
}

/// Tiny arithmetic evaluator for + - * / parentheses, numbers and single-letter variables.
struct Formula {
    private let text: [Character]
    private let variables: [Character: Double]
    private var index = 0

    private struct Bad: Error {}

    init(_ text: String, variables: [Character: Double]) {
        self.text = Array(text.filter { !$0.isWhitespace })
        self.variables = variables
    }

    func evaluate() -> Double? {
        var copy = self
        guard let result = try? copy.expression(), copy.index == text.count, result.isFinite else { return nil }
        return result
    }

    private mutating func take(_ c: Character) -> Bool {
        if index < text.count && text[index] == c {
            index += 1
            return true
        }
        return false
    }

    private mutating func expression() throws -> Double {
        var value = try term()
        while index < text.count {
            if take("+") { value += try term() }
            else if take("-") { value -= try term() }
            else { break }
        }
        return value
    }

    private mutating func term() throws -> Double {
        var value = try factor()
        while index < text.count {
            if take("*") { value *= try factor() }
            else if take("/") {
                let right = try factor()
                value = right == 0 ? 0 : value / right
            } else { break }
        }
        return value
    }

    private mutating func factor() throws -> Double {
        if take("-") { return -(try factor()) }
        if take("(") {
            let value = try expression()
            guard take(")") else { throw Bad() }
            return value
        }
        guard index < text.count else { throw Bad() }
        if let named = variables[text[index]] {
            index += 1
            return named
        }
        let start = index
        while index < text.count && (text[index].isNumber || text[index] == ".") { index += 1 }
        guard let number = Double(String(text[start..<index])) else { throw Bad() }
        return number
    }
}
