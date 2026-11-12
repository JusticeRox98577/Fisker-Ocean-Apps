import Foundation

/// How a report value should stand out.
enum ReportTone: Sendable {
    case plain, good, warn, bad, missing
}

struct ReportRow: Equatable, Sendable {
    let label: String
    let value: String
    var tone: ReportTone = .plain
}

struct ReportSection: Equatable, Sendable {
    let title: String
    var rows: [ReportRow]
}

/// The one-page battery health report, built only from what the app already has:
/// the last readings in memory, saved drives and charges, parked drain and the last fault scan.
/// It never talks to the car. Pure data so it can be unit tested and drawn off the main thread.
struct BatteryReport: Equatable, Sendable {
    static let title = "Ocean Live battery report"
    static let missing = "not measured yet"
    static let footer = "Read from the car by Ocean Live (unofficial). Values are measured, not a dealer diagnosis."
    static let fileName = "Ocean Live battery report.pdf"
    /// Most active codes listed before the rest are summed up, so the report stays on one page.
    static let maxCodes = 8

    var date: String
    var vin: String?
    var carLine: String
    /// Drawn in two columns on the page.
    var left: [ReportSection]
    var right: [ReportSection]
    /// The last fault scan, or nil when there isn't one.
    var faults: ReportSection?

    static func make(settings: Settings, snapshot s: Snapshot, history: [HistoryEntry], drains: [ParkedDrain],
                     vin: String?, scans: [SavedScan], now: Date = Date()) -> BatteryReport {
        func when(_ d: Date) -> String { d.formatted(date: .abbreviated, time: .shortened) }
        func row(_ label: String, _ value: String?, _ tone: ReportTone = .plain) -> ReportRow {
            value.map { ReportRow(label: label, value: $0, tone: tone) } ?? ReportRow(label: label, value: missing, tone: .missing)
        }
        func mv(_ v: Double?) -> String? { v.map { "\(Int($0.rounded())) mV" } }
        let rated = settings.usableKwh
        let ratedText = rated > 0 ? Format.n(rated, 1) + " kWh" : nil

        var car = ReportSection(title: "Car", rows: [
            row("Model", settings.model.label),
            row("Rated usable", ratedText),
        ])
        if let vin { car.rows.append(row("VIN", vin)) }
        car.rows.append(row("Last reading", s.time > 0 ? when(Format.date(s.time)) : nil))

        let measured = measuredCapacityKwh(history)
        let samples = history.filter { $0.impliedCapacityKwh != nil }.count
        let health = ReportSection(title: "Battery health", rows: [
            row("Measured usable", measured.map { Format.n($0, 1) + " kWh" }),
            row("Of rated", measured.flatMap { m -> String? in rated > 0 ? "\(Int((m / rated * 100).rounded()))%" : nil }),
            row("Based on", samples > 0 ? "\(samples) charging session\(samples == 1 ? "" : "s")" : nil),
        ])

        let spread = s.cellSpread
        let cells = ReportSection(title: "Cells", rows: [
            row("Highest", mv(s.cellMax)),
            row("Average", mv(s.cellAvg)),
            row("Lowest", mv(s.cellMin)),
            row("Spread", spread.map { "\(Int($0.rounded())) mV · \(balanceLabel($0))" }, spread.map(balanceTone) ?? .plain),
        ])

        let temps = ReportSection(title: "Temperatures", rows: [
            row("Battery highest", Format.temp(s.tempMax, settings)),
            row("Battery average", Format.temp(s.tempAvg, settings)),
            row("Battery lowest", Format.temp(s.tempMin, settings)),
            row("Coolant in", Format.temp(s.coolantIn, settings)),
            row("Coolant out", Format.temp(s.coolantOut, settings)),
        ])

        let electrical = ReportSection(title: "Electrical", rows: [
            row("Isolation resistance", s.isolation.map { "\(Int($0.rounded())) kΩ" }),
            row("12V battery", s.aux12v.map { Format.n($0, 2) + " V" }),
            row("12V status", s.aux12v.map(auxStatus), s.aux12v.map(auxTone) ?? .plain),
        ])

        let avgDrain = averageDrainPerDay(drains)
        let drain = ReportSection(title: "Parked drain", rows: [
            row("Average per day", avgDrain.map { Format.perDay($0, settings) }),
            row("Based on", avgDrain != nil ? "\(drains.count) parked period\(drains.count == 1 ? "" : "s")" : nil),
        ])

        let charges = history.filter { $0.kind == .Charge }
        let charging = ReportSection(title: "Charging totals", rows: [
            row("Sessions", charges.isEmpty ? nil : "\(charges.count)"),
            row("Energy added", charges.isEmpty ? nil : Format.n(charges.reduce(0) { $0 + $1.kwh }, 0) + " kWh"),
            row("DC fast sessions", charges.isEmpty ? nil : "\(charges.filter { $0.fast }.count)"),
        ])

        var faults: ReportSection?
        if let scan = FaultHistory.previous(for: vin, in: scans) {
            var rows = [
                row("Scanned", when(Format.date(scan.time))),
                row("Codes", "\(scan.active) active · \(scan.stored) stored", scan.active > 0 ? .warn : .good),
            ]
            // Every active code; `fitting` trims them to the room left on the page.
            for d in Dtcs.activeFirst(scan.dtcs).active {
                rows.append(ReportRow(label: "\(d.code) · \(d.ecu.code)", value: d.info.title))
            }
            faults = ReportSection(title: "Last fault scan", rows: rows)
        }

        return BatteryReport(
            date: when(now),
            vin: vin,
            carLine: settings.model.label + (ratedText.map { " · \($0) rated usable" } ?? ""),
            left: [car, health, cells, temps],
            right: [electrical, drain, charging],
            faults: faults
        )
    }

    /// The fault section cut down to `rows` rows at most: the scan date and counts, then as many
    /// active codes as fit (never more than `maxCodes`), then how many were left out.
    static func fitting(_ faults: ReportSection, rows: Int) -> ReportSection {
        let head = Array(faults.rows.prefix(2))
        let codes = Array(faults.rows.dropFirst(2))
        var shown = Swift.min(codes.count, maxCodes, Swift.max(rows - head.count, 0))
        if shown < codes.count { shown = Swift.min(shown, Swift.max(rows - head.count - 1, 0)) }
        var out = ReportSection(title: faults.title, rows: head + codes.prefix(shown))
        let left = codes.count - shown
        if left > 0 {
            out.rows.append(ReportRow(label: "", value: "and \(left) more active code\(left == 1 ? "" : "s")"))
        }
        return out
    }

    static func balanceTone(_ mv: Double) -> ReportTone { mv <= 60 ? .good : mv <= 100 ? .warn : .bad }

    static func auxTone(_ volts: Double) -> ReportTone {
        switch auxStatus(volts) {
        case "Charging", "Good": return .good
        case "Low": return .warn
        default: return .bad
        }
    }

    /// Every row, for tests and lookups.
    var allRows: [ReportRow] { (left + right + (faults.map { [$0] } ?? [])).flatMap(\.rows) }

    func value(_ section: String, _ label: String) -> String? {
        (left + right + (faults.map { [$0] } ?? [])).first { $0.title == section }?.rows.first { $0.label == label }?.value
    }
}
