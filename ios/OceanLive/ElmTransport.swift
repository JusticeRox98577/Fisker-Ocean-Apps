import CoreBluetooth
import Foundation

struct FoundAdapter: Identifiable, Equatable {
    let id: UUID
    let name: String
    var rssi: Int
}

enum ElmError: LocalizedError {
    case bluetoothOff, notFound, timeout, notAdapter, disconnected, busy

    var errorDescription: String? {
        switch self {
        case .bluetoothOff: return "Bluetooth is off or not allowed for Ocean Live."
        case .notFound: return "Adapter not found. Make sure it's plugged in and the car is on."
        case .timeout: return "The adapter didn't respond."
        case .notAdapter: return "This doesn't look like an OBD adapter."
        case .disconnected: return "Adapter disconnected."
        case .busy: return "The adapter is busy."
        }
    }
}

/// Talks to an ELM327-style Bluetooth LE OBD adapter (vLinker, OBDLink CX,
/// generic clones). Finds the adapter's UART service by looking for a
/// characteristic pair that can notify and be written, so it doesn't depend on
/// any one vendor's UUIDs. All CoreBluetooth callbacks arrive on the main queue.
@MainActor
final class ElmTransport: NSObject {
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?
    private var notifyChar: CBCharacteristic?
    private var writeType: CBCharacteristicWriteType = .withResponse
    private var pendingServices = 0

    private var poweredOnWaiters: [CheckedContinuation<Void, Error>] = []
    private var connectWaiter: CheckedContinuation<Void, Error>?
    private var connectToken = UUID()
    private var reply: CheckedContinuation<String, Error>?
    private var replyToken = UUID()
    private var buffer = ""

    private var onFound: (@MainActor (FoundAdapter) -> Void)?
    var onDisconnected: (@MainActor () -> Void)?

    private static let standardServices: Set<String> = ["1800", "1801", "180A", "180F"]

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }

    var connected: Bool { writeChar != nil }

    private func waitForPoweredOn() async throws {
        switch central.state {
        case .poweredOn: return
        case .unknown, .resetting:
            try await withCheckedThrowingContinuation { poweredOnWaiters.append($0) }
        default: throw ElmError.bluetoothOff
        }
    }

    func startScan(onFound: @escaping @MainActor (FoundAdapter) -> Void) async throws {
        try await waitForPoweredOn()
        self.onFound = onFound
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    func stopScan() {
        onFound = nil
        if central.state == .poweredOn { central.stopScan() }
    }

    func connect(id: UUID) async throws {
        stopScan()
        try await waitForPoweredOn()
        guard let p = central.retrievePeripherals(withIdentifiers: [id]).first else { throw ElmError.notFound }
        peripheral = p
        p.delegate = self
        let token = UUID()
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            connectWaiter = c
            connectToken = token
            central.connect(p)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if self.connectToken == token { self.failConnect(ElmError.timeout) }
            }
        }
    }

    /// Sends one command and waits for the ELM327 ">" prompt.
    func send(_ command: String, timeout: Double = 4) async throws -> String {
        guard let p = peripheral, let c = writeChar else { throw ElmError.disconnected }
        guard reply == nil else { throw ElmError.busy }
        let token = UUID()
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            buffer = ""
            reply = cont
            replyToken = token
            p.writeValue(Data("\(command)\r".utf8), for: c, type: writeType)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if self.replyToken == token, let pending = self.reply {
                    self.reply = nil
                    pending.resume(throwing: ElmError.timeout)
                }
            }
        }
    }

    func initialize() async throws {
        for command in Elm.initCommands {
            _ = try await send(command, timeout: command == "ATZ" ? 6 : 4)
            if command == "ATZ" { try await Task.sleep(nanoseconds: 300_000_000) }
        }
    }

    func disconnect() {
        stopScan()
        let p = peripheral
        teardown(ElmError.disconnected)
        if let p { central.cancelPeripheralConnection(p) }
    }

    private func teardown(_ error: Error) {
        writeChar = nil
        notifyChar = nil
        peripheral = nil
        failConnect(error)
        if let pending = reply {
            reply = nil
            pending.resume(throwing: error)
        }
    }

    private func failConnect(_ error: Error) {
        if let waiter = connectWaiter {
            connectWaiter = nil
            waiter.resume(throwing: error)
            if let p = peripheral, writeChar == nil {
                central.cancelPeripheralConnection(p)
            }
        }
    }

    private func finishConnect() {
        if let waiter = connectWaiter {
            connectWaiter = nil
            waiter.resume()
        }
    }

    private func onData(_ data: Data) {
        buffer += String(decoding: data, as: UTF8.self)
        if let end = buffer.firstIndex(of: ">") {
            let text = String(buffer[..<end])
            buffer = ""
            if let pending = reply {
                reply = nil
                pending.resume(returning: text)
            }
        }
    }

    // MARK: Delegate handling (main actor)

    fileprivate func handleState(_ state: CBManagerState) {
        let waiters = poweredOnWaiters
        poweredOnWaiters = []
        for w in waiters {
            if state == .poweredOn { w.resume() } else { w.resume(throwing: ElmError.bluetoothOff) }
        }
        if state != .poweredOn, peripheral != nil {
            let wasConnected = connected
            teardown(ElmError.bluetoothOff)
            if wasConnected { onDisconnected?() }
        }
    }

    fileprivate func handleDiscovered(_ p: CBPeripheral, advertisementName: String?, rssi: Int) {
        guard let onFound, let name = advertisementName ?? p.name, !name.isEmpty else { return }
        onFound(FoundAdapter(id: p.identifier, name: name, rssi: rssi))
    }

    fileprivate func handleConnected(_ p: CBPeripheral) {
        guard p == peripheral else { return }
        p.discoverServices(nil)
    }

    fileprivate func handleDisconnected(_ p: CBPeripheral) {
        guard p == peripheral else { return }
        let wasConnected = connected
        teardown(ElmError.disconnected)
        if wasConnected { onDisconnected?() }
    }

    fileprivate func handleServices(_ p: CBPeripheral, error: Error?) {
        guard p == peripheral else { return }
        let services = (p.services ?? []).filter { !Self.standardServices.contains($0.uuid.uuidString.uppercased()) }
        if error != nil || services.isEmpty {
            failConnect(ElmError.notAdapter)
            return
        }
        pendingServices = services.count
        for s in services { p.discoverCharacteristics(nil, for: s) }
    }

    fileprivate func handleCharacteristics(_ p: CBPeripheral) {
        guard p == peripheral, connectWaiter != nil else { return }
        pendingServices -= 1
        guard pendingServices <= 0 else { return }

        for service in p.services ?? [] where !Self.standardServices.contains(service.uuid.uuidString.uppercased()) {
            let chars = service.characteristics ?? []
            let notify = chars.first { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
            let write = chars.first { $0.properties.contains(.writeWithoutResponse) }
                ?? chars.first { $0.properties.contains(.write) }
            if let notify, let write {
                notifyChar = notify
                writeType = write.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
                p.setNotifyValue(true, for: notify)
                pendingWrite = write
                return
            }
        }
        failConnect(ElmError.notAdapter)
    }

    private var pendingWrite: CBCharacteristic?

    fileprivate func handleNotifyState(_ p: CBPeripheral, characteristic: CBCharacteristic, error: Error?) {
        guard p == peripheral, characteristic == notifyChar else { return }
        if error != nil || !characteristic.isNotifying {
            failConnect(ElmError.notAdapter)
            return
        }
        writeChar = pendingWrite
        finishConnect()
    }

    fileprivate func handleValue(_ p: CBPeripheral, characteristic: CBCharacteristic) {
        guard p == peripheral, let data = characteristic.value else { return }
        onData(data)
    }
}

extension ElmTransport: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let state = central.state
        MainActor.assumeIsolated { self.handleState(state) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                                    advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let rssi = RSSI.intValue
        MainActor.assumeIsolated { self.handleDiscovered(peripheral, advertisementName: name, rssi: rssi) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        MainActor.assumeIsolated { self.handleConnected(peripheral) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated { self.handleDisconnected(peripheral) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated { self.handleDisconnected(peripheral) }
    }
}

extension ElmTransport: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        MainActor.assumeIsolated { self.handleServices(peripheral, error: error) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        MainActor.assumeIsolated { self.handleCharacteristics(peripheral) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated { self.handleNotifyState(peripheral, characteristic: characteristic, error: error) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated { self.handleValue(peripheral, characteristic: characteristic) }
    }
}
