import Foundation

/// Decides when Ocean Live stops talking to the car so the car can go to sleep.
/// Every request on the OBD bus keeps the car's modules awake and drains the 12V battery,
/// so the app never keeps asking a car that has gone quiet, and never reconnects on a timer.
/// Pure, so it can be unit tested.
struct SleepPolicy {
    /// Polls in a row with no answer from the car before it counts as asleep.
    static let missesToSleep = 3
    /// Parked, app in the background and no CarPlay screen: stop reading after this long.
    static let parkedIdleMs: Int64 = 10 * 60_000
    /// Reconnect attempts after the adapter drops while the car was still answering.
    static let maxRetries = 3

    static let asleepMessage = String(localized: "The car is asleep. Ocean Live stopped reading so it can sleep.")
    static let parkedIdleMessage = String(localized: "The car has been parked for 10 minutes with Ocean Live in the background. Ocean Live stopped reading so the car can sleep.")
    static let adapterLostMessage = String(localized: "Lost the adapter. Ocean Live stopped trying so the car can sleep.")

    enum Decision: Equatable { case keepReading, carAsleep, parkedIdle }

    /// When the current parked-in-the-background stretch started, or nil when there isn't one.
    private(set) var parkedSince: Int64?

    /// Called after every poll. `misses` is the number of polls in a row the car didn't answer.
    /// `retrying` is true after an adapter drop, until the car answers again: then one miss is enough to stop.
    mutating func afterPoll(misses: Int, retrying: Bool = false, mode: Mode, background: Bool,
                            carScreen: Bool, now: Int64) -> Decision {
        if misses >= (retrying ? 1 : Self.missesToSleep) { return .carAsleep }
        // Charging, driving, the app on screen or a CarPlay screen: keep reading and start the timer over.
        guard mode == .parked, background, !carScreen else {
            parkedSince = nil
            return .keepReading
        }
        let since = parkedSince ?? now
        parkedSince = since
        return now - since >= Self.parkedIdleMs ? .parkedIdle : .keepReading
    }

    mutating func reset() { parkedSince = nil }

    /// Seconds to wait before reconnect attempt `attempt` (1, 2, 3): 5, 10, 20.
    /// Nil once the attempts are used up.
    static func retryDelay(attempt: Int) -> Double? {
        guard attempt >= 1, attempt <= maxRetries else { return nil }
        return 5 * Double(1 << (attempt - 1))
    }
}
