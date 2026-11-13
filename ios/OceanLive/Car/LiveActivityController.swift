import ActivityKit
import Foundation
import WidgetKit

/// Lets something through at most once per interval.
struct Throttle {
    let interval: TimeInterval
    private(set) var last: Date?

    init(_ interval: TimeInterval) { self.interval = interval }

    mutating func ready(_ now: Date = Date()) -> Bool {
        if let last, now.timeIntervalSince(last) < interval { return false }
        last = now
        return true
    }

    mutating func mark(_ now: Date = Date()) { last = now }
}

/// What the Live Activity and the widget show, worked out from the car state. Pure, so it can be unit tested.
enum Glance {
    /// Minutes until the charge reaches the target at the current power, or nil if it can't be worked out.
    static func minutesToTarget(soc: Double?, powerKw: Double?, target: Int, usableKwh: Double) -> Int? {
        guard let soc, let powerKw, powerKw >= 0.5, soc < Double(target), usableKwh > 0 else { return nil }
        let kwh = (Double(target) - soc) / 100 * usableKwh
        return Int((kwh / powerKw * 60).rounded())
    }

    static func status(_ state: CarState, connected: Bool) -> String {
        guard connected else { return String(localized: "Not connected") }
        switch state.status {
        case .live: break
        case .reconnecting: return String(localized: "Reconnecting")
        default: return String(localized: "Not connected")
        }
        switch state.mode {
        case .charging: return state.currentCharge?.fast == true ? String(localized: "DC fast charging") : String(localized: "Charging")
        case .driving: return String(localized: "Driving")
        case .parked: return String(localized: "Parked")
        }
    }

    static func content(_ state: CarState, _ settings: Settings, _ history: [HistoryEntry],
                        now: Date = Date()) -> ChargeActivityAttributes.ContentState {
        let snap = state.snapshot
        return ChargeActivityAttributes.ContentState(
            soc: snap.soc,
            rangeText: Format.range(snap.soc, settings, history),
            powerKw: snap.powerKw,
            minutesToTarget: minutesToTarget(soc: snap.soc, powerKw: snap.powerKw, target: settings.alertHigh,
                                             usableKwh: settings.usableKwh),
            targetPercent: settings.alertHigh,
            charging: state.mode == .charging,
            fast: state.currentCharge?.fast == true,
            updatedAt: now)
    }

    static func widgetData(_ state: CarState, _ settings: Settings, _ history: [HistoryEntry],
                           connected: Bool, now: Date = Date()) -> WidgetData {
        let snap = state.snapshot
        return WidgetData(
            soc: snap.soc,
            rangeText: Format.range(snap.soc, settings, history),
            aux12v: snap.aux12v,
            status: status(state, connected: connected),
            charging: connected && state.mode == .charging,
            live: connected && state.status == .live,
            updatedAt: state.lastUpdate.map(Format.date) ?? now)
    }

    /// Whether two activity states show the same values (the time stamp aside).
    static func sameValues(_ a: ChargeActivityAttributes.ContentState, _ b: ChargeActivityAttributes.ContentState) -> Bool {
        var a = a
        a.updatedAt = b.updatedAt
        return a == b
    }
}

/// Feeds the charging Live Activity and the home-screen widget from the readings.
/// Display only: nothing here talks to the car.
@MainActor
final class LiveActivityController {
    private var activity: Activity<ChargeActivityAttributes>?
    private var lastContent: ChargeActivityAttributes.ContentState?
    private var activityPush = Throttle(5)
    private var startRetry = Throttle(60)
    private var widgetWrite = Throttle(30)
    private var widgetReload = Throttle(60)
    private var widgetShowsLive = false

    init() {
        // A charge left on screen by an earlier run of the app is out of date.
        for old in Activity<ChargeActivityAttributes>.activities {
            Task { await old.end(nil, dismissalPolicy: .immediate) }
        }
    }

    func onReading(_ state: CarState, settings: Settings, history: [HistoryEntry]) {
        let now = Date()
        if state.mode == .charging {
            let content = Glance.content(state, settings, history, now: now)
            if activity == nil {
                start(content, adapter: state.adapterName, now: now)
            } else {
                push(content, now: now)
            }
        } else {
            end()
        }
        if widgetWrite.ready(now) {
            Glance.widgetData(state, settings, history, connected: true, now: now).save()
            widgetShowsLive = true
            if widgetReload.ready(now) { reloadWidget(now) }
        }
    }

    /// The adapter disconnected or the user disconnected: end the activity and show the widget as offline.
    func onDisconnected(_ state: CarState, settings: Settings, history: [HistoryEntry]) {
        end()
        guard widgetShowsLive else { return }
        widgetShowsLive = false
        let now = Date()
        Glance.widgetData(state, settings, history, connected: false, now: now).save()
        widgetWrite.mark(now)
        reloadWidget(now)
    }

    private func start(_ content: ChargeActivityAttributes.ContentState, adapter: String?, now: Date) {
        // The widget extension that draws the Live Activity needs iOS 18; don't start one it can't show.
        guard #available(iOS 18.0, *) else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled, startRetry.ready(now) else { return }
        do {
            activity = try Activity<ChargeActivityAttributes>.request(
                attributes: ChargeActivityAttributes(carName: "Fisker Ocean", adapterName: adapter),
                content: ActivityContent(state: content, staleDate: now.addingTimeInterval(120)),
                pushType: nil)
            lastContent = content
            activityPush.mark(now)
        } catch {
            // Not allowed right now (for example while the app is in the background). Tries again in a minute.
        }
    }

    private func push(_ content: ChargeActivityAttributes.ContentState, now: Date) {
        guard let activity else { return }
        let changed = lastContent.map { !Glance.sameValues($0, content) } ?? true
        // Unchanged values are still sent now and then, so the activity doesn't go stale.
        let refreshDue = activityPush.last.map { now.timeIntervalSince($0) >= 60 } ?? true
        guard changed || refreshDue, activityPush.ready(now) else { return }
        lastContent = content
        let update = ActivityContent(state: content, staleDate: now.addingTimeInterval(120))
        Task { await activity.update(update) }
    }

    private func end() {
        guard let activity else { return }
        self.activity = nil
        var finished = lastContent
        finished?.charging = false
        finished?.powerKw = nil
        finished?.minutesToTarget = nil
        lastContent = nil
        let content = finished.map { ActivityContent(state: $0, staleDate: nil) }
        // Leave the finished charge on the lock screen for a little while.
        Task { await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(15 * 60))) }
    }

    private func reloadWidget(_ now: Date) {
        widgetReload.mark(now)
        WidgetCenter.shared.reloadTimelines(ofKind: OceanShared.widgetKind)
    }
}
