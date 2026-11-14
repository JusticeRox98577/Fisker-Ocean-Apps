import Foundation

/// Fresh proof from this connection that the car is standing still and not charging, before Ocean Live
/// clears fault codes or restarts a module. Only uses readings the poll already takes (odometer and pack
/// power); it never asks the car for anything extra. Pure, so it can be unit tested.
///
/// The Tracker's mode alone isn't enough: it starts as Parked and only becomes Driving once the odometer
/// changes, or Charging after a few readings. So this asks for its own evidence, gathered since the
/// connection started, and forgets all of it whenever the connection ends or starts again.
struct ChangeGuard: Equatable {
    /// The newest odometer reading may be at most this old.
    static let maxOdometerAgeMs: Int64 = 25_000
    /// The power reading may be at most this old.
    static let maxPowerAgeMs: Int64 = 6_000
    /// Power into or out of the pack, either direction, at or above this blocks: charging, climate, driving.
    static let maxPowerKw = 1.0
    /// Odometer readings closer than this count as the same (it reads in steps of 0.01 km).
    static let sameOdometerKm = 0.005

    struct Reading: Equatable {
        let value: Double
        let time: Int64
    }

    enum Block: Equatable {
        case notConnected
        /// Not enough readings from this connection yet.
        case waiting
        /// The readings are too old: the poll has stopped or is held up.
        case stale
        case moving
        case charging
        /// Power is flowing in or out of the pack: plugged in or the climate is on.
        case power
        /// Part way through an action: the check reading got no answer.
        case noAnswer

        var message: String {
            switch self {
            case .notConnected: return String(localized: "Connect to the car first.")
            case .waiting: return String(localized: "Checking that the car is parked and not charging. Wait a few seconds.")
            case .stale: return String(localized: "The latest readings are too old. Wait for fresh readings from the car.")
            case .moving: return String(localized: "The car is moving. Park it first.")
            case .charging: return String(localized: "The car is charging. Unplug it first.")
            case .power: return String(localized: "Power is flowing in or out of the battery, so the car may be charging or the climate is on. Unplug the car and switch the climate off.")
            case .noAnswer: return String(localized: "The car didn't answer the safety check.")
            }
        }
    }

    /// The odometer reading before the newest one, both from this connection.
    private(set) var previousOdometer: Reading?
    private(set) var latestOdometer: Reading?
    /// Odometer readings since this connection started.
    private(set) var odometerCount = 0
    private(set) var power: Reading?

    /// A fresh odometer reading from the car (not a value kept from an earlier read).
    mutating func addOdometer(_ km: Double, at time: Int64) {
        previousOdometer = latestOdometer
        latestOdometer = Reading(value: km, time: time)
        odometerCount += 1
    }

    /// A fresh pack power reading, kW, either sign.
    mutating func addPower(_ kw: Double, at time: Int64) {
        power = Reading(value: kw, time: time)
    }

    /// The connection ended or started again: nothing seen before counts any more.
    mutating func reset() { self = ChangeGuard() }

    /// Why clearing codes or restarting a module isn't safe right now, or nil when it is.
    /// `mode` is the Tracker's view, still checked as well.
    func block(connected: Bool, mode: Mode, now: Int64) -> Block? {
        guard connected else { return .notConnected }
        if mode == .driving { return .moving }
        if mode == .charging { return .charging }
        guard odometerCount >= 2, let latest = latestOdometer, let previous = previousOdometer, let power = power else {
            return .waiting
        }
        if now - latest.time > Self.maxOdometerAgeMs || now - power.time > Self.maxPowerAgeMs { return .stale }
        if Self.moved(from: previous.value, to: latest.value) { return .moving }
        if Self.tooMuchPower(power.value) { return .power }
        return nil
    }

    /// The check between modules of an action, from readings taken right then. `startKm` is the odometer when
    /// the action started. Nil when it may carry on.
    static func midAction(powerKw: Double?, odometerKm: Double?, startKm: Double?) -> Block? {
        guard let powerKw, let odometerKm, let startKm else { return .noAnswer }
        if moved(from: startKm, to: odometerKm) { return .moving }
        if tooMuchPower(powerKw) { return .power }
        return nil
    }

    static func moved(from a: Double, to b: Double) -> Bool { abs(b - a) > sameOdometerKm }

    /// Sign doesn't matter, so the "flip current" setting can't hide charging.
    static func tooMuchPower(_ kw: Double) -> Bool { !kw.isFinite || abs(kw) >= maxPowerKw }
}

extension Ecus {
    /// Modules Ocean Live never offers to restart, whatever they support: brakes and stability, steering,
    /// airbags, drive (vehicle control and the motors), the gateway and the HV battery. Clearing their codes
    /// stays allowed, behind the same parked and not-charging check.
    static let safetyCritical: Set<String> = ["ESP", "IBOOSTER", "EPS", "EPS2", "ACU", "VCU", "MCU_F", "MCU_R", "GW", "BMS"]
}
