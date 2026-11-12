import Foundation
import WatchConnectivity

/// The last reading the phone sent, kept so it shows straight away next time.
/// Display only: the watch never sends anything to the phone, so it can't start a connection to the car.
@MainActor
final class WatchStore: NSObject, ObservableObject {
    @Published private(set) var summary: WatchSummary? = WatchSummary.load()
    private var started = false

    func start() {
        guard !started, WCSession.isSupported() else { return }
        started = true
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    fileprivate func receive(_ next: WatchSummary) {
        // Ignore an older reading arriving late.
        if let summary, next.updatedAt < summary.updatedAt { return }
        guard next != summary else { return }
        summary = next
        next.save()
    }
}

extension WatchStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        // Whatever the phone sent while this app wasn't running.
        guard let next = WatchSummary(context: session.receivedApplicationContext) else { return }
        Task { @MainActor in self.receive(next) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let next = WatchSummary(context: applicationContext) else { return }
        Task { @MainActor in self.receive(next) }
    }
}
