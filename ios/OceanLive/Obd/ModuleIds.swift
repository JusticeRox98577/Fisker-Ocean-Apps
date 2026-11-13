import Foundation

/// Software and part numbers one module reported (standard UDS identification DIDs, read with service 22).
struct ModuleVersion: Codable, Hashable, Identifiable {
    /// Module code, e.g. "BMS".
    let ecu: String
    let name: String
    /// F189
    var softwareVersion: String? = nil
    /// F188
    var softwareNumber: String? = nil
    /// F187
    var partNumber: String? = nil

    var id: String { ecu }
    var isEmpty: Bool { softwareVersion == nil && softwareNumber == nil && partNumber == nil }

    /// Label and value pairs for the ones the module answered, in display order.
    var lines: [(String, String)] {
        var out: [(String, String)] = []
        if let v = softwareVersion { out.append((String(localized: "Software"), v)) }
        if let v = softwareNumber { out.append((String(localized: "Software no."), v)) }
        if let v = partNumber { out.append((String(localized: "Part no."), v)) }
        return out
    }
}

/// Standard UDS identification DIDs. Read-only.
enum ModuleIds {
    static let softwareVersion = "F189"
    static let softwareNumber = "F188"
    static let partNumber = "F187"

    static let all = [softwareVersion, softwareNumber, partNumber]

    static func command(_ did: String) -> String { "22" + did }

    /// Text value from a 22 Fxxx reply, or nil if the module didn't answer it positively.
    static func text(_ response: String, did: String) -> String? {
        Elm.didData(response, did: did).flatMap { decode($0) }
    }

    /// Printable ASCII, trimmed of padding and spaces. Anything else is shown as hex.
    static func decode(_ data: [Int]) -> String? {
        let padding: Set<Int> = [0x00, 0x20, 0xFF]
        var bytes = data.map { $0 & 0xFF }
        while let last = bytes.last, padding.contains(last) { bytes.removeLast() }
        while let first = bytes.first, padding.contains(first) { bytes.removeFirst() }
        if bytes.isEmpty { return nil }
        if bytes.allSatisfy({ (0x20...0x7E).contains($0) }) {
            let text = String(bytes: bytes.map { UInt8($0) }, encoding: .ascii) ?? ""
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty { return trimmed }
        }
        return bytes.map { String(format: "%02X", $0) }.joined()
    }
}
