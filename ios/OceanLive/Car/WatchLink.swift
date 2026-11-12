import Foundation
import WatchConnectivity

extension Glance {
    /// What the Apple Watch app shows. Values are rounded so tiny changes don't count as news.
    static func watchSummary(_ state: CarState, _ settings: Settings, _ history: [HistoryEntry],
                             connected: Bool, now: Date = Date()) -> WatchSummary {
        let snap = state.snapshot
        let charging = connected && state.mode == .charging
        let power = connected ? tenth(snap.powerKw) : nil
        return WatchSummary(
            soc: tenth(snap.soc),
            rangeText: Format.range(snap.soc, settings, history),
            powerKw: power,
            charging: charging,
            fast: charging && state.currentCharge?.fast == true,
            minutesToTarget: charging ? minutesToTarget(soc: snap.soc, powerKw: power, target: settings.alertHigh,
                                                        usableKwh: settings.usableKwh) : nil,
            targetPercent: settings.alertHigh,
            aux12v: tenth(snap.aux12v),
            status: status(state, connected: connected),
            live: connected && state.status == .live,
            updatedAt: state.lastUpdate.map(Format.date) ?? now)
    }

    private static func tenth(_ v: Double?) -> Double? { v.map { ($0 * 10).rounded() / 10 } }
}

/// When the phone passes a summary on to the watch: only when something changed, at most every 15 s,
/// and the same values again every couple of minutes so the watch knows the phone is still reading.
struct WatchGate {
    static let minGap: TimeInterval = 15
    static let refresh: TimeInterval = 2 * 60

    private(set) var lastSent: WatchSummary?
    private(set) var lastAt: Date?

    func shouldSend(_ summary: WatchSummary, now: Date) -> Bool {
        guard let lastSent, let lastAt else { return true }
        let gap = now.timeIntervalSince(lastAt)
        if gap < Self.minGap { return false }
        return !lastSent.sameValues(summary) || gap >= Self.refresh
    }

    mutating func sent(_ summary: WatchSummary, now: Date) {
        lastSent = summary
        lastAt = now
    }
}

/// Passes the latest reading to the Apple Watch app with WatchConnectivity.
/// Display only: nothing here talks to the car, and nothing the watch does can start a connection.
@MainActor
final class WatchLink: NSObject {
    private var gate = WatchGate()
    private var pending: WatchSummary?
    private var started = false

    private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

    func onReading(_ state: CarState, settings: Settings, history: [HistoryEntry]) {
        let now = Date()
        let summary = Glance.watchSummary(state, settings, history, connected: true, now: now)
        guard gate.shouldSend(summary, now: now) else { return }
        send(summary, now: now)
    }

    /// Reading stopped: tell the watch straight away, without waiting for the throttle.
    func onDisconnected(_ state: CarState, settings: Settings, history: [HistoryEntry]) {
        guard gate.lastSent?.live == true else { return }
        let now = Date()
        send(Glance.watchSummary(state, settings, history, connected: false, now: now), now: now)
    }

    private func send(_ summary: WatchSummary, now: Date) {
        gate.sent(summary, now: now)
        pending = summary
        activate()
        flush()
    }

    /// The session is only switched on once there is something to send.
    private func activate() {
        guard !started, let session else { return }
        started = true
        session.delegate = self
        session.activate()
    }

    fileprivate func flush() {
        guard let summary = pending, let session, session.activationState == .activated else { return }
        guard session.isPaired, session.isWatchAppInstalled else {
            pending = nil
            return
        }
        do {
            try session.updateApplicationContext(summary.context)
            pending = nil
        } catch {
            // Kept, and tried again when the session is ready or with the next reading.
        }
    }
}

extension WatchLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        Task { @MainActor in self.flush() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        // The user switched to another watch.
        session.activate()
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.flush() }
    }
}
