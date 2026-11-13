import BackgroundTasks
import Foundation

/// The 12V log: one line per reading in a small text file in the app's private storage, last 90 days.
/// New readings are added to the end of the file, so saving one never rewrites the whole log.
enum V12Store {
    private static let alertKey = "v12_alert_level"

    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("v12-log.csv")
    }

    static func load(now: Int64 = nowMs()) -> [V12Sample] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        let all = V12Log.decode(text)
        let kept = V12Log.capped(all, now: now)
        if kept.count != all.count { save(kept) }
        return kept
    }

    static func save(_ samples: [V12Sample]) {
        try? Data(V12Log.encode(samples).utf8).write(to: file, options: .atomic)
    }

    static func append(_ sample: V12Sample) {
        let data = Data((V12Log.line(sample) + "\n").utf8)
        let url = file
        guard FileManager.default.fileExists(atPath: url.path), let handle = try? FileHandle(forWritingTo: url) else {
            try? data.write(to: url, options: .atomic)
            return
        }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }

    static func loadAlertLevel() -> Int { UserDefaults.standard.integer(forKey: alertKey) }
    static func saveAlertLevel(_ level: Int) { UserDefaults.standard.set(level, forKey: alertKey) }

    private static let missedInRowKey = "v12_missed_in_row"
    private static let missedTotalKey = "v12_missed_total"
    private static let lastCheckKey = "v12_last_check"

    /// Quick checks that couldn't reach the adapter: in a row, and over the latest night.
    /// Kept so the count survives iPhone closing the app overnight.
    static func loadMissed() -> (inRow: Int, total: Int) {
        (UserDefaults.standard.integer(forKey: missedInRowKey), UserDefaults.standard.integer(forKey: missedTotalKey))
    }

    static func saveMissed(inRow: Int, total: Int) {
        UserDefaults.standard.set(inRow, forKey: missedInRowKey)
        UserDefaults.standard.set(total, forKey: missedTotalKey)
    }

    /// When the last watch check ran (whether or not it reached the adapter), or 0.
    static func loadLastCheck() -> Int64 { Int64(UserDefaults.standard.double(forKey: lastCheckKey)) }
    static func saveLastCheck(_ time: Int64) { UserDefaults.standard.set(Double(time), forKey: lastCheckKey) }
}

/// iPhone gives an app in the background only occasional time. While the app is watching the 12V,
/// this asks iOS for a background refresh now and then. Each refresh does at most one check: connect the
/// Bluetooth link to the adapter, ask it for its voltage (ATRV) and disconnect again (or, with "Keep the
/// adapter connected" on, reopen the kept link if it dropped). It never talks to the car.
enum V12Background {
    static let id = "com.justice.OceanABRP.v12refresh"
    private static let activeKey = "v12_watch_active"

    /// True while watch mode is on, so a refresh after iPhone closed the app knows to carry on.
    static var active: Bool { UserDefaults.standard.bool(forKey: activeKey) }

    static func setActive(_ on: Bool, minutes: Int) {
        if !on && !active { return }
        UserDefaults.standard.set(on, forKey: activeKey)
        if on {
            schedule(minutes: minutes)
        } else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: id)
        }
    }

    static func schedule(minutes: Int) {
        let request = BGAppRefreshTaskRequest(identifier: id)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Double(V12Watch.interval(minutes)) * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Called once while the app launches.
    static func register() {
        _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: .main) { task in
            MainActor.assumeIsolated { Car.shared.handleV12Refresh(task) }
        }
    }
}

/// Makes sure a background task is marked finished exactly once.
@MainActor
final class BackgroundFinish {
    private let task: BGTask
    private var done = false

    init(_ task: BGTask) { self.task = task }

    func finish(_ success: Bool) {
        guard !done else { return }
        done = true
        task.setTaskCompleted(success: success)
    }
}
