import CryptoKit
import Foundation
import UIKit

/// SuperNova remote commands from this iPhone (Oceanlive-nova docs/nrf.md). The same as the Android app's
/// car/Nova.kt: the phone has its own Ed25519 key (CryptoKit, standard RFC 8032); pairing uses the code on
/// the car screen and the owner's approval in the car; commands are signed here, carried by
/// hardware.oceanlive.org and checked again by the car. The private key never leaves the iPhone.
enum NovaCommands {
    static let lock = 1
    static let unlock = 2
    static let climateOn = 3
    static let climateOff = 4
    static let lights = 5
    static let lifeSeconds: UInt32 = 120

    /// Counters only go up, across phones too: 4 per second since 2023-11-14 (fits until 2057).
    static func counter(now: Int64, last: Int64) -> Int64 { max(last + 1, (now - 1_700_000_000) * 4) }

    /// The 40-byte body the car checks (fw/lib/novacmd layout); the signature is appended by `build`.
    static func body(uid: Data, slot: Int, action: Int, counter: UInt32, now: UInt32, arg: UInt16 = 0) -> Data {
        precondition(uid.count == 12)
        var b = Data(count: 40)
        func put32(_ o: Int, _ v: UInt32) { for k in 0..<4 { b[o + k] = UInt8((v >> (8 * UInt32(k))) & 0xFF) } }
        put32(0, 0x4D43_564E) // "NVCM"
        b[4] = 1
        b[5] = UInt8(action)
        b[6] = UInt8(arg & 0xFF)
        b[7] = UInt8(arg >> 8)
        b.replaceSubrange(8..<20, with: uid)
        put32(20, counter)
        put32(24, now)
        put32(28, now + lifeSeconds)
        b[32] = UInt8(slot)
        return b
    }

    static func build(key: Curve25519.Signing.PrivateKey, uid: Data, slot: Int, action: Int, counter: UInt32, now: UInt32) throws -> Data {
        let b = body(uid: uid, slot: slot, action: action, counter: counter, now: now)
        return b + (try key.signature(for: b))
    }

    /// Signature for GET /api/box/status: Ed25519 over "nova-status:<uid>:<t>".
    static func statusSignature(key: Curve25519.Signing.PrivateKey, uidHex: String, t: Int64) throws -> Data {
        try key.signature(for: Data("nova-status:\(uidHex):\(t)".utf8))
    }

    static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

    static func unhex(_ s: String) -> Data? {
        guard s.count % 2 == 0 else { return nil }
        var out = Data()
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(i, offsetBy: 2)
            guard let v = UInt8(s[i..<j], radix: 16) else { return nil }
            out.append(v)
            i = j
        }
        return out
    }
}

/// This iPhone's SuperNova pairing: the key in the Keychain, the car and the phone's slot in UserDefaults.
@MainActor
final class NovaPhone: ObservableObject {
    static let shared = NovaPhone()
    static let base = "https://hardware.oceanlive.org"
    private static let keyAccount = "novaPhoneKey"
    private let defaults = UserDefaults.standard

    struct Status {
        var lastSeen: Date?
        var v12mV: Int
        var lastResult: Int?
    }

    @Published private(set) var uid: String?
    @Published private(set) var slot: Int
    @Published var status: Status?

    var paired: Bool { uid != nil && slot >= 0 }

    private init() {
        uid = defaults.string(forKey: "nova.uid")
        slot = defaults.object(forKey: "nova.slot") as? Int ?? -1
    }

    /// The phone's key, made on first use.
    func key() throws -> Curve25519.Signing.PrivateKey {
        if let saved = SecretStore.get(Self.keyAccount), !saved.isEmpty, let raw = Data(base64Encoded: saved) {
            return try Curve25519.Signing.PrivateKey(rawRepresentation: raw)
        }
        let k = Curve25519.Signing.PrivateKey()
        guard SecretStore.set(k.rawRepresentation.base64EncodedString(), for: Self.keyAccount) else {
            throw NovaError.message("The iPhone's Keychain isn't available right now.")
        }
        return k
    }

    enum NovaError: LocalizedError {
        case message(String)
        var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
    }

    private func call(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: Self.base + path) else { throw NovaError.message("bad address") }
        var r = URLRequest(url: url, timeoutInterval: 15)
        if let body {
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: r)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw NovaError.message(json["error"] as? String ?? "HTTP \(code)")
        }
        return json
    }

    private static func cleanCode(_ code: String) -> String {
        code.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    /// Send this phone's public key for the code on the car screen.
    func requestPairing(code: String) async throws {
        let c = Self.cleanCode(code)
        _ = try await call("/api/box/pair/request", body: [
            "code": c,
            "phonePub": NovaCommands.hex(try key().publicKey.rawRepresentation),
            "phoneName": String(UIDevice.current.name.prefix(40)),
        ])
        defaults.set(c, forKey: "nova.pendingCode")
    }

    /// "waiting", "requested", "paired", "refused" or "none"; on "paired" the car and slot are kept.
    func pairingStatus() async throws -> String {
        guard let code = defaults.string(forKey: "nova.pendingCode") else { return paired ? "paired" : "none" }
        let j = try await call("/api/box/pair/status?code=\(code)")
        let st = j["status"] as? String ?? "waiting"
        if st == "paired", let u = j["uid"] as? String, let s = j["slot"] as? Int {
            defaults.set(u, forKey: "nova.uid")
            defaults.set(s, forKey: "nova.slot")
            defaults.removeObject(forKey: "nova.pendingCode")
            uid = u
            slot = s
        } else if st == "refused" {
            defaults.removeObject(forKey: "nova.pendingCode")
        }
        return st
    }

    func send(_ action: Int) async throws {
        guard let u = uid, let uidBytes = NovaCommands.unhex(u), uidBytes.count == 12 else { throw NovaError.message("not paired") }
        let now = Int64(Date().timeIntervalSince1970)
        let counter = NovaCommands.counter(now: now, last: Int64(defaults.integer(forKey: "nova.counter")))
        defaults.set(Int(counter), forKey: "nova.counter")
        let cmd = try NovaCommands.build(key: try key(), uid: uidBytes, slot: slot, action: action,
                                         counter: UInt32(truncatingIfNeeded: counter), now: UInt32(truncatingIfNeeded: now))
        _ = try await call("/api/box/command", body: ["uid": u, "cmd": NovaCommands.hex(cmd)])
    }

    func refresh() async throws {
        guard let u = uid else { return }
        let t = Int64(Date().timeIntervalSince1970)
        let sig = NovaCommands.hex(try NovaCommands.statusSignature(key: try key(), uidHex: u, t: t))
        let j = try await call("/api/box/status?uid=\(u)&slot=\(slot)&t=\(t)&sig=\(sig)")
        let box = j["box"] as? [String: Any]
        let last = (j["commands"] as? [[String: Any]])?.first
        status = Status(
            lastSeen: (box?["last_seen"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) },
            v12mV: box?["v12"] as? Int ?? 0,
            lastResult: last?["result"] as? Int
        )
    }

    func forget() {
        for k in ["nova.uid", "nova.slot", "nova.pendingCode"] { defaults.removeObject(forKey: k) }
        uid = nil
        slot = -1
        status = nil
    }
}
