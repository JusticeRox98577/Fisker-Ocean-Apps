import Foundation

/// How a value should be coloured in the report.
enum ReportTone: Sendable {
    case normal, good, warn, bad, missing
}

struct ReportRow: Equatable, Sendable {
    let label: String
    let value: String
    var tone: ReportTone = .normal
}

/// A headline number at the top of the report.
struct ReportTile: Equatable, Sendable {
    let label: String
    let value: String
    let caption: String
    let tone: ReportTone
}

/// An active fault code with its plain-English description.
struct ReportCode: Equatable, Sendable {
    let module: String
    let code: String
    let description: String
}

struct ReportSection: Equatable, Sendable {
    let title: String
    var rows: [ReportRow]
    var note: String? = nil
    var codes: [ReportCode] = []
}

/// Everything on the one-page battery report, as plain text. Drawn by `BatteryReportPdf`.
struct BatteryReport: Equatable, Sendable {
    var title: String
    var date: String
    var carLine: String
    var tiles: [ReportTile]
    var sections: [ReportSection]
    var faults: ReportSection
    var footer: String
    /// File name of the shared PDF.
    var pdfName: String
}

/// Builds the battery report from data the app already has in memory and history.
/// It never talks to the car. Pure logic so it can be unit tested.
extension BatteryReport {
    static var reportTitle: String { String(localized: "Ocean Live battery report") }
    static var notMeasured: String { String(localized: "not measured yet") }
    static var reportFooter: String {
        String(localized: "Read from the car by Ocean Live (unofficial). Values are measured, not a dealer diagnosis.")
    }
    /// "Each charge that adds 20% or more is measured at the battery."
    static var measuredNote: String {
        let share = "20%"
        return String(localized: "Each charge that adds \(share) or more is measured at the battery.")
    }

    static func make(
        now: Int64,
        vin: String?,
        snapshot s: Snapshot,
        settings: Settings,
        history: [HistoryEntry],
        drains: [ParkedDrain],
        scans: [SavedScan],
        dateText: (Int64) -> String = BatteryReport.defaultDate,
        describe: (SavedCode) -> String = { $0.dtc.info.title }
    ) -> BatteryReport {
        let rated = settings.usableKwh
        let measured = measuredCapacityKwh(history)
        let pct: Double? = measured.flatMap { m -> Double? in rated > 0 ? m / rated * 100 : nil }
        let samples = history.filter { $0.impliedCapacityKwh != nil }.count
        let spread = s.cellSpread
        let aux = s.aux12v

        let capacityTone: ReportTone = pct.map { p -> ReportTone in p >= 85 ? .good : (p >= 70 ? .warn : .bad) } ?? .missing
        let spreadTone: ReportTone? = spread.map { balanceTone($0) }
        let twelveTone: ReportTone? = aux.map { auxTone($0) }
        let tiles = [
            ReportTile(label: String(localized: "Capacity"), value: pct.map { "\(Int($0.rounded()))%" } ?? "—",
                       caption: measured.map { String(localized: "\(Format.n($0, 1)) kWh usable") } ?? notMeasured, tone: capacityTone),
            ReportTile(label: String(localized: "Cell spread"), value: spread.map { "\(Int($0.rounded())) mV" } ?? "—",
                       caption: spread.map { balanceLabel($0) } ?? notMeasured, tone: spreadTone ?? .missing),
            ReportTile(label: String(localized: "12V battery"), value: aux.map { Format.n($0, 2) + " V" } ?? "—",
                       caption: aux.map { auxStatus($0) } ?? notMeasured, tone: twelveTone ?? .missing),
        ]

        let car = ReportSection(title: String(localized: "Car"), rows: [
            row(String(localized: "VIN"), vin),
            row(String(localized: "Model"), settings.model.label),
            row(String(localized: "Rated usable"), rated > 0 ? Format.n(rated, 1) + " kWh" : nil),
            row(String(localized: "Live readings from"), s.time > 0 ? dateText(s.time) : nil),
        ])

        let health = ReportSection(title: String(localized: "Battery health"), rows: [
            row(String(localized: "Measured usable"), measured.map { Format.n($0, 1) + " kWh" }),
            row(String(localized: "Share of rated"), pct.map { "\(Int($0.rounded()))%" }, capacityTone),
            row(String(localized: "Samples"), samples > 0 ? String(localized: "\(samples) charging sessions") : nil),
        ], note: measuredNote)

        let cells = ReportSection(title: String(localized: "Cells"), rows: [
            row(String(localized: "Highest"), s.cellMax.map { "\(Int($0.rounded())) mV" }),
            row(String(localized: "Average"), s.cellAvg.map { "\(Int($0.rounded())) mV" }),
            row(String(localized: "Lowest"), s.cellMin.map { "\(Int($0.rounded())) mV" }),
            row(String(localized: "Spread"), spread.map { "\(Int($0.rounded())) mV · \(balanceLabel($0))" }, spreadTone),
        ], note: String(localized: "Under 60 mV is normal."))

        let temps = ReportSection(title: String(localized: "Temperatures"), rows: [
            row(String(localized: "Battery highest"), Format.temp(s.tempMax, settings)),
            row(String(localized: "Battery average"), Format.temp(s.tempAvg, settings)),
            row(String(localized: "Battery lowest"), Format.temp(s.tempMin, settings)),
            row(String(localized: "Coolant in"), Format.temp(s.coolantIn, settings)),
            row(String(localized: "Coolant out"), Format.temp(s.coolantOut, settings)),
        ])

        let electrical = ReportSection(title: String(localized: "Insulation and 12V"), rows: [
            row(String(localized: "Insulation resistance"), s.isolation.map { "\(Int($0.rounded())) kΩ" }),
            row(String(localized: "12V battery"), aux.map { v -> String in Format.n(v, 2) + " V" + (s.aux12vSource.map { " (\(V12Source.label($0)))" } ?? "") }),
            row(String(localized: "12V status"), aux.map { auxStatus($0) }, twelveTone),
        ])

        let perDay = averageDrainPerDay(drains)
        let drain = ReportSection(title: String(localized: "Parked drain"), rows: [
            row(String(localized: "Average per day"), perDay.map { p -> String in
                Format.n(p, 1) + "%" + (rated > 0 ? " (" + String(localized: "about \(Format.n(p / 100 * rated, 1)) kWh") + ")" : "")
            }),
            row(String(localized: "Time measured"), perDay != nil ? Format.span(drains.reduce(0) { $0 + $1.hours }) : nil),
        ])

        let charges = history.filter { $0.kind == .Charge }
        let charging = ReportSection(title: String(localized: "Charging totals"), rows: [
            row(String(localized: "Sessions"), charges.isEmpty ? nil : "\(charges.count)"),
            row(String(localized: "Energy added"), charges.isEmpty ? nil : Format.n(charges.reduce(0) { $0 + $1.kwh }, 0) + " kWh"),
            row(String(localized: "DC fast sessions"), charges.isEmpty ? nil : "\(charges.filter { $0.fast }.count)"),
        ])

        let parts: [String?] = [
            "Fisker " + settings.model.label,
            rated > 0 ? String(localized: "\(Format.n(rated, 1)) kWh rated") : nil,
            vin.map { "VIN " + $0 },
        ]

        return BatteryReport(
            title: reportTitle,
            date: dateText(now),
            carLine: parts.compactMap { $0 }.joined(separator: " · "),
            tiles: tiles,
            sections: [car, health, cells, temps, electrical, drain, charging],
            faults: faultSection(scans.max { $0.time < $1.time }, dateText: dateText, describe: describe),
            footer: reportFooter,
            pdfName: fileName(now: now)
        )
    }

    private static func faultSection(_ scan: SavedScan?, dateText: (Int64) -> String,
                                     describe: (SavedCode) -> String) -> ReportSection {
        guard let scan else {
            return ReportSection(title: String(localized: "Latest fault scan"),
                                 rows: [ReportRow(label: String(localized: "Last scan"), value: String(localized: "not run yet"), tone: .missing)])
        }
        let active = scan.codes.filter { Dtcs.state($0.status) == .active }
        return ReportSection(
            title: String(localized: "Latest fault scan"),
            rows: [
                ReportRow(label: String(localized: "Scanned"), value: dateText(scan.time)),
                ReportRow(label: String(localized: "Active codes"), value: "\(scan.active)", tone: scan.active > 0 ? .bad : .good),
                ReportRow(label: String(localized: "Stored codes"), value: "\(scan.stored)", tone: scan.stored > 0 ? .warn : .normal),
            ],
            codes: active.map { ReportCode(module: $0.ecu, code: $0.code, description: describe($0)) }
        )
    }

    private static func row(_ label: String, _ value: String?, _ tone: ReportTone? = nil) -> ReportRow {
        guard let value else { return ReportRow(label: label, value: notMeasured, tone: .missing) }
        return ReportRow(label: label, value: value, tone: tone ?? .normal)
    }

    static func balanceTone(_ mv: Double) -> ReportTone { mv <= 60 ? .good : (mv <= 100 ? .warn : .bad) }

    static func auxTone(_ volts: Double) -> ReportTone { volts >= 12.4 ? .good : (volts >= 12.0 ? .warn : .bad) }

    static func defaultDate(_ time: Int64) -> String {
        Format.date(time).formatted(date: .abbreviated, time: .shortened)
    }

    /// A file name such as "ocean-live-battery-report-2026-11-12.pdf".
    static func fileName(now: Int64, calendar: Calendar = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return "ocean-live-battery-report-" + f.string(from: Format.date(now)) + ".pdf"
    }

    /// Splits sections of these `heights` into two columns without changing their order,
    /// so the taller column is as short as possible. Returns how many go in the left column.
    static func splitColumns(_ heights: [Double]) -> Int {
        if heights.count < 2 { return heights.count }
        let total = heights.reduce(0, +)
        var best = 1
        var bestMax = Double.greatestFiniteMagnitude
        var left = 0.0
        for i in 1..<heights.count {
            left += heights[i - 1]
            let m = Swift.max(left, total - left)
            if m < bestMax { bestMax = m; best = i }
        }
        return best
    }

    /// How many items of these `heights` fit in `space`. When some are left out, room is
    /// kept for a "+ N more" line of `moreHeight`.
    static func itemsThatFit(_ heights: [Double], space: Double, moreHeight: Double) -> Int {
        if heights.reduce(0, +) <= space { return heights.count }
        var used = moreHeight
        var n = 0
        for h in heights {
            if used + h > space { break }
            used += h
            n += 1
        }
        return n
    }

    /// The same report dated `now`, with a matching file name.
    func stamped(_ now: Int64) -> BatteryReport {
        var r = self
        r.date = BatteryReport.defaultDate(now)
        r.pdfName = BatteryReport.fileName(now: now)
        return r
    }

    /// Every row, for tests and lookups.
    var allRows: [ReportRow] { (sections + [faults]).flatMap(\.rows) }

    func value(_ section: String, _ label: String) -> String? {
        (sections + [faults]).first { $0.title == section }?.rows.first { $0.label == label }?.value
    }
}
