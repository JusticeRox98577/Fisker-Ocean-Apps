import Foundation
import UIKit

enum Status { case idle, scanning, connecting, live, error }

/// Connects to the adapter and polls the car every couple of seconds.
@MainActor
final class Monitor: ObservableObject {
    @Published private(set) var status: Status = .idle
    @Published private(set) var message: String?
    @Published private(set) var found: [FoundAdapter] = []
    @Published private(set) var values: [String: Double] = [:]
    @Published private(set) var lastUpdate: Date?
    @Published private(set) var auxSource: String?
    @Published private(set) var savedID: UUID?
    @Published private(set) var savedName: String?

    private let transport = ElmTransport()
    private let defaults = UserDefaults.standard
    private var task: Task<Void, Never>?

    init() {
        savedID = defaults.string(forKey: "adapter_id").flatMap(UUID.init(uuidString:))
        savedName = defaults.string(forKey: "adapter_name")
        transport.onDisconnected = { [weak self] in
            guard let self else { return }
            self.task?.cancel()
            self.task = nil
            self.status = .error
            self.message = ElmError.disconnected.errorDescription
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    func scan() {
        stop()
        found = []
        message = nil
        status = .scanning
        task = Task {
            do {
                try await transport.startScan { [weak self] adapter in
                    guard let self else { return }
                    if let i = self.found.firstIndex(where: { $0.id == adapter.id }) {
                        self.found[i] = adapter
                    } else {
                        self.found.append(adapter)
                    }
                    self.found.sort { $0.rssi > $1.rssi }
                }
            } catch {
                status = .error
                message = error.localizedDescription
            }
        }
    }

    func connect(id: UUID, name: String) {
        stop()
        message = nil
        status = .connecting
        task = Task {
            do {
                try await transport.connect(id: id)
                try await transport.initialize()
                defaults.set(id.uuidString, forKey: "adapter_id")
                defaults.set(name, forKey: "adapter_name")
                savedID = id
                savedName = name
                status = .live
                UIApplication.shared.isIdleTimerDisabled = true
                try await poll()
            } catch {
                if Task.isCancelled { return }
                transport.disconnect()
                status = .error
                message = error.localizedDescription
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }

    private func query(_ command: String) async throws -> String? {
        do {
            return try await transport.send(command)
        } catch ElmError.timeout {
            return nil
        }
    }

    private func poll() async throws {
        var misses = 0
        while !Task.isCancelled {
            var answered = false
            var next = values

            for command in Obd.headerCommands { _ = try await query(command) }
            for pid in Obd.packPids {
                let reply = try await query(pid.command)
                if reply != nil { answered = true }
                next[pid.key] = reply.flatMap { Obd.read(pid, reply: $0) }
            }

            if let volts = next["voltage"], let amps = next["current"] {
                next["power"] = volts * amps / 1000
            } else {
                next["power"] = nil
            }

            // 12V: prefer the BMS reading, otherwise the adapter's own supply voltage.
            if let bms = next["aux_bms"] {
                next["aux_voltage"] = bms
                auxSource = "BMS"
            } else {
                let reply = try await query(Obd.auxVoltageCommand)
                if reply != nil { answered = true }
                let v = reply.flatMap(Obd.parseAdapterVoltage)
                next["aux_voltage"] = v
                auxSource = v == nil ? nil : "OBD port"
            }

            values = next
            if answered {
                misses = 0
                lastUpdate = Date()
            } else {
                misses += 1
                if misses >= 3 { throw ElmError.timeout }
            }
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        transport.disconnect()
        UIApplication.shared.isIdleTimerDisabled = false
        if status != .error { status = .idle }
    }

    func disconnect() {
        stop()
        status = .idle
        message = nil
        values = [:]
        lastUpdate = nil
    }

    func forgetAdapter() {
        defaults.removeObject(forKey: "adapter_id")
        defaults.removeObject(forKey: "adapter_name")
        savedID = nil
        savedName = nil
    }
}
