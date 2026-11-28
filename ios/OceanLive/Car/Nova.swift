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

    /// The car's last check-in (GET /api/box/status) and the latest commands from any paired phone.
    struct Status: Equatable {
        struct Command: Equatable, Identifiable {
            var id: Int64 { counter }
            var action: Int
            var counter: Int64
            var sent: Date
            /// nil while the car hasn't acted on it yet; 0 done; otherwise why it refused.
            var result: Int?
        }
        var lastSeen: Date?
        var v12mV: Int
        var ignition: Bool
        /// enum nova_gear: 0 unknown, 1 P, 2 R, 3 N, 4 D.
        var gear: Int
        var speedKmh: Double
        var location: (lat: Double, lon: Double)?
        var rsrp: Int
        var phones: Int
        var firmware: Int
        /// A Nova Light (listen-only, no GPS) rather than a SuperNova.
        var isLight: Bool
        /// A Light's own car state: 0 starting, 1 parked, 2 awake, 3 saving the 12 V (self-protect).
        var lightState: Int
        /// Data a Light used this month, kB (its budget is 3,000 kB).
        var dataKb: Int
        var lightAlert: Bool
        var commands: [Command]
        var lastResult: Int? { commands.first?.result }

        static func == (a: Status, b: Status) -> Bool {
            a.lastSeen == b.lastSeen && a.v12mV == b.v12mV && a.ignition == b.ignition && a.gear == b.gear &&
                a.speedKmh == b.speedKmh && a.location?.lat == b.location?.lat && a.location?.lon == b.location?.lon &&
                a.rsrp == b.rsrp && a.phones == b.phones && a.firmware == b.firmware && a.commands == b.commands &&
                a.isLight == b.isLight && a.lightState == b.lightState && a.dataKb == b.dataKb && a.lightAlert == b.lightAlert
        }

        /// A made-up Nova Light, parked, checked in a minute ago (the demo).
        static func demoLight(now: Date = Date()) -> Status {
            Status(lastSeen: now.addingTimeInterval(-60), v12mV: 12610, ignition: false, gear: 0, speedKmh: 0,
                   location: nil, rsrp: -97, phones: 1, firmware: 0x0001_0000, isLight: true, lightState: 1,
                   dataKb: 41, lightAlert: false, commands: [])
        }

        /// Checked in within the last 3 minutes (it checks in every minute or so while it has signal).
        func online(now: Date = Date()) -> Bool { lastSeen.map { now.timeIntervalSince($0) < 180 } ?? false }

        static func parse(_ j: [String: Any]) -> Status {
            let box = j["box"] as? [String: Any]
            func int(_ k: String) -> Int { (box?[k] as? NSNumber)?.intValue ?? 0 }
            func dbl(_ k: String) -> Double? { (box?[k] as? NSNumber)?.doubleValue }
            let commands = (j["commands"] as? [[String: Any]] ?? []).compactMap { c -> Command? in
                guard let a = (c["action"] as? NSNumber)?.intValue, let n = (c["counter"] as? NSNumber)?.int64Value,
                      let t = (c["created_at"] as? NSNumber)?.doubleValue else { return nil }
                return Command(action: a, counter: n, sent: Date(timeIntervalSince1970: t / 1000),
                               result: (c["result"] as? NSNumber)?.intValue)
            }
            var location: (lat: Double, lon: Double)?
            if let lat = dbl("lat"), let lon = dbl("lon"), lat != 0 || lon != 0 { location = (lat, lon) }
            return Status(
                lastSeen: dbl("last_seen").map { Date(timeIntervalSince1970: $0 / 1000) },
                v12mV: int("v12"), ignition: int("ignition") != 0, gear: int("gear"),
                speedKmh: Double(int("speed")) / 100, location: location, rsrp: int("rsrp"),
                phones: int("phones"), firmware: int("fw"), isLight: (box?["kind"] as? String) == "light",
                lightState: int("state"), dataKb: int("budget_kb"), lightAlert: int("alerts") != 0, commands: commands
            )
        }
    }

    @Published private(set) var uid: String?
    @Published private(set) var slot: Int
    @Published var status: Status?
    /// The code this phone sent and is waiting on (kept across launches, so a wait is never lost).
    @Published private(set) var pendingCode: String?

    /// Showing a made-up Nova Light (sample data, nothing sent anywhere) instead of a paired car.
    @Published private(set) var demo: Bool

    var paired: Bool { (uid != nil && slot >= 0) || demo }

    private init() {
        demo = defaults.bool(forKey: "nova.demo")
        uid = defaults.string(forKey: "nova.uid")
        slot = defaults.object(forKey: "nova.slot") as? Int ?? -1
        pendingCode = defaults.string(forKey: "nova.pendingCode")
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
        case server(Int, String)
        var errorDescription: String? {
            switch self {
            case .message(let m), .server(_, let m): return m
            }
        }
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
            throw NovaError.server(code, json["error"] as? String ?? "HTTP \(code)")
        }
        return json
    }


    /// Letters and digits only, upper case: how both kinds of code are compared.
    static func cleanCode(_ code: String) -> String {
        code.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    /// A Nova Light: the 12-letter code printed inside its box pairs this iPhone at once.
    func claim(code: String) async throws {
        let j = try await call("/api/box/claim", body: [
            "code": Self.cleanCode(code),
            "phonePub": NovaCommands.hex(try key().publicKey.rawRepresentation),
            "phoneName": String(UIDevice.current.name.prefix(40)),
        ])
        guard let u = j["uid"] as? String, let s = (j["slot"] as? NSNumber)?.intValue else {
            throw NovaError.message("The server's answer wasn't understood.")
        }
        defaults.set(u, forKey: "nova.uid")
        defaults.set(s, forKey: "nova.slot")
        uid = u
        slot = s
        setPending(nil)
    }

    /// Send this phone's public key for the code on the car screen.
    func requestPairing(code: String) async throws {
        let c = Self.cleanCode(code)
        _ = try await call("/api/box/pair/request", body: [
            "code": c,
            "phonePub": NovaCommands.hex(try key().publicKey.rawRepresentation),
            "phoneName": String(UIDevice.current.name.prefix(40)),
        ])
        setPending(c)
    }

    private func setPending(_ c: String?) {
        if let c { defaults.set(c, forKey: "nova.pendingCode") } else { defaults.removeObject(forKey: "nova.pendingCode") }
        pendingCode = c
    }

    /// Stop waiting on the code (the car screen can start a new one).
    func cancelPairing() { setPending(nil) }

    /// "waiting", "requested", "paired", "refused", "expired" or "none"; on "paired" the car and slot are kept.
    func pairingStatus() async throws -> String {
        guard let code = pendingCode else { return paired ? "paired" : "none" }
        let j: [String: Any]
        do {
            j = try await call("/api/box/pair/status?code=\(code)")
        } catch NovaError.server(404, _) {
            setPending(nil)
            return "expired"
        }
        let st = j["status"] as? String ?? "waiting"
        if st == "paired", let u = j["uid"] as? String, let s = (j["slot"] as? NSNumber)?.intValue {
            defaults.set(u, forKey: "nova.uid")
            defaults.set(s, forKey: "nova.slot")
            uid = u
            slot = s
            setPending(nil)
        } else if st == "refused" {
            setPending(nil)
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

    /// The demo: a Nova Light dashboard with sample data, for trying the app without a box.
    func startDemo() {
        defaults.set(true, forKey: "nova.demo")
        demo = true
        status = Status.demoLight()
    }

    func refresh() async throws {
        if demo {
            status = Status.demoLight()
            return
        }
        guard let u = uid else { return }
        let t = Int64(Date().timeIntervalSince1970)
        let sig = NovaCommands.hex(try NovaCommands.statusSignature(key: try key(), uidHex: u, t: t))
        let j = try await call("/api/box/status?uid=\(u)&slot=\(slot)&t=\(t)&sig=\(sig)")
        let s = Status.parse(j)
        if s != status { status = s }
    }

    func forget() {
        for k in ["nova.uid", "nova.slot", "nova.pendingCode", "nova.demo"] { defaults.removeObject(forKey: k) }
        demo = false
        pendingCode = nil
        uid = nil
        slot = -1
        status = nil
    }
}
