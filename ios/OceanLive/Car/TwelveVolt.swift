import Foundation

/// One saved 12V reading. Only readings the app already takes are saved: the BMS's own 12V value or the
/// adapter's ATRV while reading the car, and ATRV alone while the car sleeps (watch mode).
struct V12Sample: Equatable, Identifiable {
    enum Kind: String { case parked, driving, charging, asleep }

    var time: Int64
    var volts: Double
    var source: String
    var mode: Kind
    /// The first reading after the car had slept for 2 hours or more: the best sign of the battery's health.
    var resting = false

    var id: Int64 { time }
    var asleep: Bool { mode == .asleep }
}

extension V12Sample.Kind {
    init(_ mode: Mode) {
        switch mode {
        case .parked: self = .parked
        case .driving: self = .driving
        case .charging: self = .charging
        }
    }
}

enum V12Source {
    static let bms = "BMS"
    static let port = "OBD port"
    static let asleep = "OBD port while asleep"

    /// A saved source in the user's language. The saved value itself stays in English.
    static func label(_ source: String) -> String {
        switch source {
        case bms: return String(localized: "BMS")
        case port: return String(localized: "OBD port")
        case asleep: return String(localized: "OBD port while asleep")
        default: return source
        }
    }
}

/// A stretch of charging or driving, shaded on the graph.
struct V12Band: Equatable, Identifiable {
    var start: Int64
    var end: Int64
    var mode: V12Sample.Kind

    var id: Int64 { start }
}

/// One night of sleep: the resting voltage when the car went to sleep and the reading in the morning.
struct V12Night: Equatable, Identifiable {
    var start: Int64
    var end: Int64
    var from: Double
    var to: Double

    var id: Int64 { start }
    var drop: Double { from - to }
}

struct V12Stats: Equatable {
    var latest: V12Sample?
    /// The latest resting reading of all time, not just the range.
    var latestResting: V12Sample?
    var lowestResting: Double?
    var averageResting: Double?
    /// Share of the connected time (0...1) the car was charging the 12V, or nil without enough data.
    var chargedShare: Double?
    /// Last time it read 13.2 V or more, of all time.
    var lastCharged: Int64?
    var nights: [V12Night] = []

    var averageDrop: Double? {
        nights.isEmpty ? nil : nights.reduce(0) { $0 + $1.drop } / Double(nights.count)
    }
}

/// Pure logic for the 12V log, so it can be unit tested.
enum V12Log {
    static let keepMs: Int64 = 90 * 86_400_000
    /// About one saved reading a minute...
    static let everyMs: Int64 = 60_000
    /// ...plus every reading that moved this much.
    static let minChange = 0.05
    /// A gap this long means the car slept.
    static let restGapMs: Int64 = 2 * 3_600_000
    /// At or above this the car's DC-DC converter is charging the 12V, so a reading says nothing about rest.
    static let restMax = 13.0
    static let charging = 13.2
    static let low = 12.4
    static let veryLow = 12.0
    /// Gaps longer than this between readings are not counted as connected time.
    static let joinMs: Int64 = 5 * 60_000
    /// Shortest sleep that counts as a night.
    static let nightMs: Int64 = 4 * 3_600_000

    static func status(_ volts: Double) -> String {
        volts >= low ? String(localized: "Good") : volts >= veryLow ? String(localized: "Low") : String(localized: "Very low")
    }

    /// Whether a new reading is worth saving after the last saved one: once a minute, on a change of
    /// 0.05 V or more, when the car's mode changes, and always for a resting reading.
    static func shouldKeep(_ s: V12Sample, after last: V12Sample?) -> Bool {
        guard let last else { return true }
        if s.time <= last.time { return false }
        if s.resting || s.mode != last.mode { return true }
        return s.time - last.time >= everyMs || abs(s.volts - last.volts) >= minChange - 0.0001
    }

    /// Readings thinned the way they are saved.
    static func thin(_ samples: [V12Sample]) -> [V12Sample] {
        var out: [V12Sample] = []
        for s in samples where shouldKeep(s, after: out.last) { out.append(s) }
        return out
    }

    /// The last 90 days.
    static func capped(_ samples: [V12Sample], now: Int64) -> [V12Sample] {
        let from = now - keepMs
        return samples.filter { $0.time >= from }
    }

    /// Whether a new reading counts as resting, given the saved ones before it.
    /// - While reading the car: the first reading of a connection, 2 h or more after the car was last seen awake.
    /// - While the car sleeps: the first reading 2 h or more after the car was last seen awake.
    /// Never at 13.0 V or more, where the car is charging the 12V.
    static func isResting(volts: Double, mode: V12Sample.Kind, firstOfConnection: Bool, now: Int64,
                          in samples: [V12Sample]) -> Bool {
        guard volts < restMax else { return false }
        var lastAwake: Int64?
        var restedSince = false
        for s in samples.reversed() {
            if !s.asleep { lastAwake = s.time; break }
            if s.resting { restedSince = true }
        }
        guard let lastAwake, now - lastAwake >= restGapMs else { return false }
        return mode == .asleep ? !restedSince : firstOfConnection
    }

    // MARK: File format: one reading per line, "time,volts,source,mode,resting"

    private static let sourceCodes = [V12Source.bms: "B", V12Source.port: "O", V12Source.asleep: "S"]
    private static let modeCodes: [V12Sample.Kind: String] = [.parked: "p", .driving: "d", .charging: "c", .asleep: "a"]

    static func line(_ s: V12Sample) -> String {
        let source = sourceCodes[s.source] ?? s.source.replacingOccurrences(of: ",", with: " ")
        return "\(s.time),\(String(format: "%.3f", s.volts)),\(source),\(modeCodes[s.mode] ?? "p"),\(s.resting ? 1 : 0)"
    }

    static func parse(_ line: Substring) -> V12Sample? {
        let f = line.split(separator: ",", omittingEmptySubsequences: false)
        guard f.count >= 5, let time = Int64(f[0]), let volts = Double(f[1]), volts.isFinite else { return nil }
        let code = String(f[2])
        let source = sourceCodes.first { $0.value == code }?.key ?? code
        guard let mode = modeCodes.first(where: { $0.value == String(f[3]) })?.key else { return nil }
        return V12Sample(time: time, volts: volts, source: source, mode: mode, resting: String(f[4]) == "1")
    }

    static func encode(_ samples: [V12Sample]) -> String {
        samples.map { line($0) + "\n" }.joined()
    }

    /// Unreadable lines (a half-written last line, say) are skipped.
    static func decode(_ text: String) -> [V12Sample] {
        let list = text.split(whereSeparator: { $0.isNewline }).compactMap { parse($0) }
        return zip(list, list.dropFirst()).allSatisfy({ pair in pair.0.time <= pair.1.time }) ? list : list.sorted { $0.time < $1.time }
    }

    static func csv(_ samples: [V12Sample]) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        var out = "time,volts,source,mode,resting\n"
        for s in samples {
            let time = fmt.string(from: Date(timeIntervalSince1970: Double(s.time) / 1000))
            out += "\(time),\(String(format: "%.2f", s.volts)),\(s.source),\(s.mode.rawValue),\(s.resting)\n"
        }
        return out
    }

    // MARK: Graph and stats

    /// Charging and driving stretches, joined across short gaps.
    static func bands(_ samples: [V12Sample]) -> [V12Band] {
        var out: [V12Band] = []
        var prev: V12Sample?
        for s in samples {
            defer { prev = s }
            guard s.mode == .charging || s.mode == .driving else { continue }
            if var last = out.last, let p = prev, p.mode == s.mode, s.time - last.end <= joinMs {
                last.end = s.time
                out[out.count - 1] = last
            } else {
                out.append(V12Band(start: s.time, end: s.time, mode: s.mode))
            }
        }
        // A single reading still gets a visible band.
        return out.map { band in
            var b = band
            b.end = Swift.max(b.end, b.start + everyMs)
            return b
        }
    }

    /// Line segments: a new one starts after a gap, and where the car falls asleep or wakes.
    static func segments(_ samples: [V12Sample]) -> [Int] {
        var out: [Int] = []
        var seg = 0
        for (i, s) in samples.enumerated() {
            if i > 0 {
                let p = samples[i - 1]
                let gap = s.asleep && p.asleep ? 3 * 3_600_000 : 20 * 60_000
                if p.asleep != s.asleep || s.time - p.time > Int64(gap) { seg += 1 }
            }
            out.append(seg)
        }
        return out
    }

    /// At most about `maxPoints` readings for the graph: the lowest and highest of each stretch, and every resting one.
    static func forChart(_ samples: [V12Sample], maxPoints: Int = 600) -> [V12Sample] {
        guard samples.count > maxPoints, maxPoints >= 4 else { return samples }
        let size = Int((Double(samples.count) / Double(maxPoints / 2)).rounded(.up))
        var out: [V12Sample] = []
        var i = 0
        while i < samples.count {
            let bucket = samples[i..<Swift.min(i + size, samples.count)]
            var keep: [V12Sample] = bucket.filter(\.resting)
            if let lo = bucket.min(by: { $0.volts < $1.volts }) { keep.append(lo) }
            if let hi = bucket.max(by: { $0.volts < $1.volts }) { keep.append(hi) }
            // A change between asleep and awake keeps both sides so the colours stay right.
            if let first = bucket.first { keep.append(first) }
            var seen = Set<Int64>()
            out += keep.filter { seen.insert($0.time).inserted }.sorted { $0.time < $1.time }
            i += size
        }
        return out
    }

    /// Nights the car slept with the 12V being watched: the first resting reading of the night (or the first
    /// one under 13.0 V) against the morning reading, which is the first reading after waking when it came
    /// within an hour, else the last one of the night.
    static func nights(_ samples: [V12Sample]) -> [V12Night] {
        var out: [V12Night] = []
        var i = 0
        while i < samples.count {
            guard samples[i].asleep else { i += 1; continue }
            var j = i
            while j + 1 < samples.count && samples[j + 1].asleep { j += 1 }
            var run = Array(samples[i...j])
            if j + 1 < samples.count, samples[j + 1].time - samples[j].time <= 3_600_000 { run.append(samples[j + 1]) }
            if let start = run.first(where: { $0.asleep && $0.resting }) ?? run.first(where: { $0.volts < restMax }),
               let end = run.last(where: { $0.volts < restMax && $0.time > start.time }),
               end.time - start.time >= nightMs {
                out.append(V12Night(start: start.time, end: end.time, from: start.volts, to: end.volts))
            }
            i = j + 1
        }
        return out
    }

    static func stats(_ all: [V12Sample], from: Int64) -> V12Stats {
        let range = all.filter { $0.time >= from }
        var s = V12Stats()
        s.latest = all.last
        s.latestResting = all.last { $0.resting }
        let resting = range.filter(\.resting).map(\.volts)
        s.lowestResting = resting.min()
        s.averageResting = resting.isEmpty ? nil : resting.reduce(0, +) / Double(resting.count)
        s.lastCharged = all.last { $0.volts >= charging }?.time

        var total: Int64 = 0
        var charged: Int64 = 0
        for (a, b) in zip(range, range.dropFirst()) where !a.asleep && !b.asleep {
            let dt = b.time - a.time
            guard dt > 0, dt <= joinMs else { continue }
            total += dt
            if a.volts >= charging { charged += dt }
        }
        s.chargedShare = total >= everyMs ? Double(charged) / Double(total) : nil
        s.nights = nights(range)
        return s
    }
}

/// Watching the 12V while the car sleeps: the decisions, kept pure so they can be unit tested.
/// Watch mode only ever sends the adapter its own voltage command (ATRV), which puts nothing on the car's network.
struct V12Watch {
    static let intervals = [5, 10, 30]
    static let defaultMinutes = 10
    /// Two readings in a row at or above this: the car woke up by itself.
    static let wakeVolts = 13.0
    static let wakeReadings = 2
    /// Entered because the car sat parked (not because it stopped answering): readings in this first stretch
    /// may still be from an awake car, so they don't count as having seen it asleep.
    static let settleMs: Int64 = 30 * 60_000
    /// After a first high reading, check again this soon to confirm.
    static let confirmMs: Int64 = 30_000
    static let statusText = String(localized: "Car asleep · watching 12V")
    static let settingNote = String(localized: "Keeps the adapter connected and asks it for the 12V every 10 minutes. The car's network isn't touched, so the car stays asleep, but the adapter itself uses a little power (about 20-50 mA, depending on the adapter).")
    static let iPhoneNote = String(localized: "iPhone only lets apps check occasionally in the background, so overnight readings will be irregular.")

    enum Decision: Equatable { case keepWatching, carWoke }

    let startedAt: Int64
    let carStoppedAnswering: Bool
    /// A low reading was seen with the car asleep. Only then can a rise mean the car woke up.
    private(set) var seenAsleep = false
    private(set) var highInRow = 0
    private(set) var lastReconnect: Int64?

    init(startedAt: Int64, carStoppedAnswering: Bool) {
        self.startedAt = startedAt
        self.carStoppedAnswering = carStoppedAnswering
    }

    /// Whether to switch to watching instead of letting go of the adapter.
    static func shouldEnter(settingOn: Bool, stop: SleepPolicy.Decision) -> Bool {
        settingOn && stop != .keepReading
    }

    static func interval(_ minutes: Int) -> Int { intervals.contains(minutes) ? minutes : defaultMinutes }

    mutating func afterReading(_ volts: Double, now: Int64) -> Decision {
        if volts >= Self.wakeVolts {
            guard seenAsleep else { highInRow = 0; return .keepWatching }
            highInRow += 1
            return highInRow >= Self.wakeReadings ? .carWoke : .keepWatching
        }
        highInRow = 0
        if carStoppedAnswering || now - startedAt >= Self.settleMs { seenAsleep = true }
        return .keepWatching
    }

    /// Milliseconds until the next reading: the chosen interval, or a quick re-check after a first high reading.
    func nextDelayMs(intervalMinutes: Int) -> Int64 {
        highInRow > 0 ? Self.confirmMs : Int64(Self.interval(intervalMinutes)) * 60_000
    }

    /// Reconnecting the Bluetooth link after the adapter dropped: at most once per interval.
    mutating func mayReconnect(now: Int64, intervalMinutes: Int) -> Bool {
        if let last = lastReconnect, now - last < Int64(Self.interval(intervalMinutes)) * 60_000 { return false }
        lastReconnect = now
        return true
    }
}

/// Low-12V notification while the car sleeps: once under 12.2 V, again under 11.8 V,
/// and ready again once the voltage is back above 12.6 V.
struct V12LowAlert {
    static let low = 12.2
    static let veryLow = 11.8
    static let rearm = 12.6

    enum Fire: Equatable { case none, low, veryLow }

    /// 0 ready, 1 warned under 12.2 V, 2 warned under 11.8 V.
    private(set) var level: Int

    init(level: Int = 0) { self.level = Swift.min(Swift.max(level, 0), 2) }

    /// Readings taken while the car is awake only re-arm it; only sleeping ones warn.
    mutating func check(_ volts: Double, asleep: Bool) -> Fire {
        if volts > Self.rearm { level = 0; return .none }
        guard asleep else { return .none }
        if volts < Self.veryLow && level < 2 { level = 2; return .veryLow }
        if volts < Self.low && level < 1 { level = 1; return .low }
        return .none
    }
}
