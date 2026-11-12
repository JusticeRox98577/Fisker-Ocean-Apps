import Foundation

enum Status { case idle, scanning, connecting, live, reconnecting, error }

enum Mode { case parked, driving, charging }

/// Milliseconds since 1970, matching the Android app's history format.
func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

/// Latest readings. Pack current and power are positive when energy flows into the pack.
struct Snapshot: Equatable {
    var soc: Double?
    var packV: Double?
    var packA: Double?
    var tempAvg: Double?
    var tempMax: Double?
    var tempMin: Double?
    var coolantIn: Double?
    var coolantOut: Double?
    var cellMax: Double?
    var cellMin: Double?
    var cellAvg: Double?
    var isolation: Double?
    var aux12v: Double?
    var aux12vSource: String?
    var odometerKm: Double?
    var time: Int64 = 0

    var powerKw: Double? {
        guard let v = packV, let a = packA else { return nil }
        return v * a / 1000
    }

    var cellSpread: Double? {
        guard let hi = cellMax, let lo = cellMin else { return nil }
        return hi - lo
    }

    func with(_ key: String, _ value: Double?) -> Snapshot {
        var s = self
        switch key {
        case "soc": s.soc = value
        case "packV": s.packV = value
        case "packA": s.packA = value
        case "tempAvg": s.tempAvg = value
        case "tempMax": s.tempMax = value
        case "tempMin": s.tempMin = value
        case "coolantIn": s.coolantIn = value
        case "coolantOut": s.coolantOut = value
        case "cellMax": s.cellMax = value
        case "cellMin": s.cellMin = value
        case "cellAvg": s.cellAvg = value
        case "isolation": s.isolation = value
        case "aux12v": s.aux12v = value
        case "odometer": s.odometerKm = value
        default: break
        }
        return s
    }
}

enum EntryKind: String, Codable { case Drive, Charge }

/// A finished drive or charging session. Energy is measured at the battery.
struct HistoryEntry: Codable, Equatable, Identifiable {
    var kind: EntryKind
    var start: Int64
    var end: Int64
    var socStart: Double?
    var socEnd: Double?
    /// Drive: net kWh taken from the pack. Charge: kWh put into the pack.
    var kwh: Double
    var distanceKm: Double? = nil
    var peakKw: Double? = nil
    var fast: Bool = false

    var id: String { "\(kind.rawValue)-\(start)" }
    var minutes: Int64 { (end - start) / 60_000 }

    var whPerKm: Double? {
        guard let km = distanceKm, km >= 0.5 else { return nil }
        return kwh * 1000 / km
    }

    /// Usable capacity implied by this charge: kWh in / fraction of the battery added.
    var impliedCapacityKwh: Double? {
        guard kind == .Charge, let a = socStart, let b = socEnd else { return nil }
        let delta = b - a
        return delta >= 20 ? kwh / (delta / 100) : nil
    }

    enum CodingKeys: String, CodingKey {
        case kind, start, end, socStart, socEnd, kwh, distanceKm = "km", peakKw, fast
    }
}

/// Works out from the readings whether the car is parked, driving or charging,
/// and builds up drive and charge sessions. Pure logic so it can be unit tested.
///
/// - Driving: the odometer moved in the last few minutes.
/// - Charging: steady power into the pack for a few readings while not moving.
///   Regen alone never lasts long enough, and the odometer moves during it.
final class Tracker {
    static let chargeStartKw = 0.8
    static let chargeStopKw = 0.3
    static let dcFastKw = 11.5
    static let driveIdleMs: Int64 = 180_000

    private(set) var mode: Mode = .parked
    private(set) var currentDrive: HistoryEntry?
    private(set) var currentCharge: HistoryEntry?

    private var lastTime: Int64?
    private var lastOdo: Double?
    private var lastMoveAt: Int64?
    private var driveStartOdo: Double?
    private var chargeEvidence = 0
    private var stopEvidence = 0

    func update(_ s: Snapshot) -> [HistoryEntry] {
        let now = s.time
        var finished: [HistoryEntry] = []
        var dtMs: Int64 = 0
        if let last = lastTime, (1...60_000).contains(now - last) { dtMs = now - last }
        lastTime = now

        let odo = s.odometerKm
        if let odo {
            if let prev = lastOdo, odo > prev + 0.005, odo - prev < 50 { lastMoveAt = now }
            lastOdo = odo
        }
        let movingRecently = lastMoveAt.map { now - $0 < Self.driveIdleMs } ?? false
        let movedLastMinute = lastMoveAt.map { now - $0 < 60_000 } ?? false
        let power = s.powerKw

        // Charging start / stop.
        if mode != .charging {
            if let p = power, p > Self.chargeStartKw, !movedLastMinute { chargeEvidence += 1 } else { chargeEvidence = 0 }
            if chargeEvidence >= 3 {
                if let d = currentDrive { finished.append(finishDrive(d, now, s)) }
                currentDrive = nil
                mode = .charging
                stopEvidence = 0
                currentCharge = HistoryEntry(kind: .Charge, start: now, end: now, socStart: s.soc, socEnd: s.soc, kwh: 0, peakKw: power)
            }
        } else {
            if power == nil || power! < Self.chargeStopKw { stopEvidence += 1 } else { stopEvidence = 0 }
            if stopEvidence >= 3 || movedLastMinute {
                if var c = currentCharge {
                    c.end = now
                    c.socEnd = s.soc ?? c.socEnd
                    finished.append(c)
                }
                currentCharge = nil
                mode = .parked
                chargeEvidence = 0
            }
        }

        // Driving start / stop.
        if mode != .charging {
            if movingRecently && currentDrive == nil {
                currentDrive = HistoryEntry(kind: .Drive, start: now, end: now, socStart: s.soc, socEnd: s.soc, kwh: 0, distanceKm: 0)
                driveStartOdo = odo
                mode = .driving
            } else if !movingRecently, let d = currentDrive {
                finished.append(finishDrive(d, now, s))
                currentDrive = nil
                mode = .parked
            }
        }

        // Energy.
        let hours = Double(dtMs) / 3_600_000
        if let p = power, hours > 0 {
            if var c = currentCharge {
                c.end = now
                c.socEnd = s.soc ?? c.socEnd
                c.kwh += Swift.max(p, 0) * hours
                c.peakKw = Swift.max(c.peakKw ?? 0, p)
                c.fast = c.fast || p > Self.dcFastKw
                currentCharge = c
            }
            if var d = currentDrive {
                d.end = now
                d.socEnd = s.soc ?? d.socEnd
                d.kwh -= p * hours
                d.distanceKm = driveDistance(odo) ?? d.distanceKm
                currentDrive = d
            }
        }
        return finished
    }

    /// Ends any open session, e.g. when the adapter disconnects.
    func flush(_ now: Int64) -> [HistoryEntry] {
        var out: [HistoryEntry] = []
        if var c = currentCharge { c.end = now; out.append(c) }
        if var d = currentDrive { d.end = now; out.append(d) }
        currentCharge = nil
        currentDrive = nil
        mode = .parked
        chargeEvidence = 0
        stopEvidence = 0
        lastTime = nil
        return out.filter { $0.end - $0.start >= 60_000 }
    }

    private func driveDistance(_ odo: Double?) -> Double? {
        guard let start = driveStartOdo, let odo else { return nil }
        return Swift.max(odo - start, 0)
    }

    private func finishDrive(_ d: HistoryEntry, _ now: Int64, _ s: Snapshot) -> HistoryEntry {
        var e = d
        e.end = now
        e.socEnd = s.soc ?? d.socEnd
        e.distanceKm = driveDistance(s.odometerKm) ?? d.distanceKm
        return e
    }
}

/// Distance-weighted average consumption of recent drives, Wh per km.
func learnedWhPerKm(_ history: [HistoryEntry]) -> Double? {
    let drives = history.filter { $0.kind == .Drive && ($0.distanceKm ?? 0) >= 3 && $0.kwh > 0 }.suffix(10)
    let km = drives.reduce(0) { $0 + ($1.distanceKm ?? 0) }
    guard km >= 10 else { return nil }
    let v = drives.reduce(0) { $0 + $1.kwh } * 1000 / km
    return (80...600).contains(v) ? v : nil
}

/// Median usable capacity implied by charges that added at least 20%.
func measuredCapacityKwh(_ history: [HistoryEntry]) -> Double? {
    let values = history.compactMap { $0.impliedCapacityKwh }.filter { (40...140).contains($0) }.sorted()
    guard !values.isEmpty else { return nil }
    return values[values.count / 2]
}

/// The last reading before the app stopped hearing from the car, kept so the next
/// connection can tell how much charge was lost while the car sat parked.
struct ParkedAnchor: Codable, Equatable {
    var soc: Double
    var time: Int64
    var odometerKm: Double? = nil
}

/// Charge lost while the car was parked and the app wasn't connected.
struct ParkedDrain: Codable, Equatable, Identifiable {
    var start: Int64
    var end: Int64
    var socStart: Double
    var socEnd: Double

    static let minGapMs: Int64 = 30 * 60_000
    static let maxGapMs: Int64 = 60 * 24 * 3_600_000
    static let keep = 30
    /// Bigger drops than this are misreads, not drain.
    static let maxDrop = 30.0
    /// Fastest believable drain, percent a day, for periods of 6 hours or more.
    static let maxPerDay = 20.0

    var id: Int64 { start }
    /// Percentage points lost. Never negative.
    var drop: Double { Swift.max(socStart - socEnd, 0) }
    var hours: Double { Double(end - start) / 3_600_000 }
    var perDay: Double { hours > 0 ? drop / hours * 24 : 0 }

    func kwh(_ usableKwh: Double) -> Double? { usableKwh > 0 ? drop / 100 * usableKwh : nil }

    /// The drain between the anchor and the first reading of a new connection, or nil when it
    /// doesn't count: too short a gap, charging, the car moved, the charge went up, or the numbers make no sense.
    static func measure(_ anchor: ParkedAnchor, _ s: Snapshot, charging: Bool) -> ParkedDrain? {
        guard !charging, let soc = s.soc else { return nil }
        let gap = s.time - anchor.time
        guard gap > minGapMs, gap <= maxGapMs else { return nil }
        guard (0...100).contains(anchor.soc), (0...100).contains(soc) else { return nil }
        if let a = anchor.odometerKm, let b = s.odometerKm, abs(b - a) > 0.5 { return nil }
        // A rise means it was charged while the app was away.
        if soc > anchor.soc + 0.05 { return nil }
        let d = ParkedDrain(start: anchor.time, end: s.time, socStart: anchor.soc, socEnd: soc)
        if d.drop > maxDrop { return nil }
        // Over 6 hours or more, a faster drop is more likely a misread than real drain.
        if d.hours >= 6 && d.perDay > maxPerDay { return nil }
        return d
    }
}

/// Average charge lost per day while parked, weighted by how long each period lasted.
/// Nil until there are at least 12 hours of measured time.
func averageDrainPerDay(_ drains: [ParkedDrain]) -> Double? {
    let hours = drains.reduce(0) { $0 + $1.hours }
    guard !drains.isEmpty, hours >= 12 else { return nil }
    return drains.reduce(0) { $0 + $1.drop } / hours * 24
}

/// What a charge cost at the user's current prices: DC price for fast charges, home price otherwise.
/// Nil for drives, or when the matching price isn't set.
func chargeCost(_ e: HistoryEntry, _ s: Settings) -> Double? {
    guard e.kind == .Charge else { return nil }
    let price = e.fast ? s.dcPrice : s.homePrice
    return price > 0 ? e.kwh * price : nil
}

struct ChargeTotals: Equatable {
    var kwh: Double = 0
    /// Nil when no price is set.
    var cost: Double? = nil
    var count = 0
}

/// Charging in [from, to), by start time.
func chargeTotals(_ history: [HistoryEntry], from: Int64, to: Int64, _ s: Settings) -> ChargeTotals {
    var t = ChargeTotals()
    for e in history where e.kind == .Charge && e.start >= from && e.start < to {
        t.kwh += e.kwh
        t.count += 1
        if let c = chargeCost(e, s) { t.cost = (t.cost ?? 0) + c }
    }
    return t
}

/// Charging this calendar month and the one before.
func monthlyCharging(_ history: [HistoryEntry], _ s: Settings, now: Date = Date(),
                     calendar: Calendar = .current) -> (this: ChargeTotals, last: ChargeTotals) {
    func ms(_ d: Date) -> Int64 { Int64(d.timeIntervalSince1970 * 1000) }
    guard let month = calendar.dateInterval(of: .month, for: now),
          let prevStart = calendar.date(byAdding: .month, value: -1, to: month.start) else {
        return (ChargeTotals(), ChargeTotals())
    }
    return (chargeTotals(history, from: ms(month.start), to: ms(month.end), s),
            chargeTotals(history, from: ms(prevStart), to: ms(month.start), s))
}
