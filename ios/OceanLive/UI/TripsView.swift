import Charts
import SwiftUI
import UniformTypeIdentifiers

struct CsvDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText] }
    var text: String

    init(text: String) { self.text = text }

    init(configuration: ReadConfiguration) throws {
        text = configuration.file.regularFileContents.map { String(decoding: $0, as: UTF8.self) } ?? ""
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

struct TripsView: View {
    @EnvironmentObject var car: Car
    @State private var filter: EntryKind? = nil
    @State private var confirmClear = false
    @State private var exporting = false

    var body: some View {
        Page {
            let history = car.history
            let settings = car.settings
            HStack(spacing: 8) {
                Chip(text: String(localized: "All"), selected: filter == nil) { filter = nil }
                Chip(text: String(localized: "Drives"), selected: filter == .Drive) { filter = .Drive }
                Chip(text: String(localized: "Charges"), selected: filter == .Charge) { filter = .Charge }
            }
            .padding(.top, 8)

            let drives = history.filter { $0.kind == .Drive }
            if !drives.isEmpty {
                SectionTitle(String(localized: "Totals"))
                HStack(spacing: 10) {
                    Tile(label: String(localized: "Distance"), value: Format.distance(drives.reduce(0) { $0 + ($1.distanceKm ?? 0) }, settings), accent: Theme.cyan)
                    Tile(label: String(localized: "Average"), value: Format.efficiency(Format.whPerKm(history), settings), accent: Theme.aqua)
                }
                let regenDrives = drives.filter { $0.regenKwh != nil }
                if !regenDrives.isEmpty {
                    let regen = regenDrives.reduce(0) { $0 + ($1.regenKwh ?? 0) }
                    let used = regenDrives.reduce(0) { $0 + $1.kwh }
                    Tile(label: String(localized: "Regen"), value: "+" + Format.n(regen, 1) + " kWh",
                         caption: used > 0.05 ? Self.ofEnergyUsed(regen / used * 100) : nil, accent: Theme.violet)
                        .padding(.top, 10)
                }
            }

            if history.contains(where: { $0.kind == .Charge }) {
                let months = monthlyCharging(history, settings)
                SectionTitle(String(localized: "Charging"))
                HStack(spacing: 10) {
                    MonthTile(label: String(localized: "This month"), totals: months.this, settings: settings, accent: Theme.good)
                    MonthTile(label: String(localized: "Last month"), totals: months.last, settings: settings, accent: Theme.violet)
                }
            }

            let list = Array(history.filter { filter == nil || $0.kind == filter }.reversed().prefix(200))
            SectionTitle(list.isEmpty ? String(localized: "Nothing yet") : String(localized: "Recent"))
            if list.isEmpty {
                Text("Drives and charging sessions appear here once the app has been connected through them.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
            }
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(Array(list.enumerated()), id: \.element.id) { index, e in
                    let day = Self.dayFormat.string(from: Format.date(e.start))
                    if index == 0 || Self.dayFormat.string(from: Format.date(list[index - 1].start)) != day {
                        Text(day).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6).padding(.leading, 4)
                    }
                    EntryRow(entry: e, settings: settings) { car.deleteHistory(e) }
                }
            }
            .animation(.easeInOut, value: list)

            if !history.isEmpty {
                VStack(spacing: 10) {
                    GradientButton(title: String(localized: "Export CSV")) { exporting = true }
                    GhostButton(title: String(localized: "Clear history"), color: Theme.bad) { confirmClear = true }
                }
                .padding(.top, 20)
            }
        }
        .fileExporter(isPresented: $exporting, document: CsvDocument(text: HistoryStore.csv(car.history, settings: car.settings)),
                      contentType: .commaSeparatedText, defaultFilename: "ocean-live-history") { _ in }
        .alert("Clear all history?", isPresented: $confirmClear) {
            Button("Clear", role: .destructive) { car.clearHistory() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes every saved drive and charge, including the data used to measure battery capacity. It can't be undone.")
        }
    }

    /// "14 % of energy used"
    static func ofEnergyUsed(_ percent: Double) -> String {
        let share = "\(Int(percent.rounded())) %"
        return String(localized: "\(share) of energy used")
    }

    static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEEMMMd")
        return f
    }()
}

private struct Chip: View {
    let text: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { withAnimation(.easeInOut(duration: 0.2)) { action() } }) {
            Text(text)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? Theme.aqua : Theme.dim)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(selected ? Theme.aqua.opacity(0.18) : Theme.card, in: Capsule())
                .overlay(Capsule().stroke(selected ? Theme.aqua : Theme.edge, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
    }
}

/// Charging cost (or energy, when no price is set) for one calendar month.
private struct MonthTile: View {
    let label: String
    let totals: ChargeTotals
    let settings: Settings
    let accent: Color

    var body: some View {
        let kwh = Format.n(totals.kwh, 1) + " kWh"
        if let cost = Format.money(totals.cost, settings) {
            Tile(label: label, value: cost, caption: kwh, accent: accent)
        } else {
            Tile(label: label, value: kwh, caption: String(localized: "\(totals.count) charges"), accent: accent)
        }
    }
}

private struct EntryRow: View {
    let entry: HistoryEntry
    let settings: Settings
    let onDelete: () -> Void
    @State private var open = false

    var body: some View {
        let e = entry
        let color = e.kind == .Charge ? Theme.good : Theme.cyan
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Circle().fill(color).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    Text(subtitle)
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                }
                Spacer()
                Text([e.socStart, e.socEnd].compactMap { $0 }.map { "\(Int($0.rounded()))%" }.joined(separator: " → "))
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(color)
            }
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    if e.kind == .Drive {
                        KeyValue(String(localized: "Energy used"), Format.n(e.kwh, 2) + " kWh")
                        KeyValue(String(localized: "Efficiency"), Format.efficiency(e.whPerKm, settings))
                        if let regen = regenText { KeyValue(String(localized: "Regen"), regen, color: Theme.violet) }
                    } else {
                        let points = ChargeCurve.chart(e.samples ?? [])
                        if points.count >= 2 { ChargeCurveChart(points: points).padding(.bottom, 8) }
                        KeyValue(String(localized: "Peak power"), e.peakKw.map { Format.n($0, 1) + " kW" })
                        KeyValue(String(localized: "Average power"), e.minutes > 0 ? Format.n(e.kwh / (Double(e.minutes) / 60), 1) + " kW" : nil)
                        if let ms = ChargeCurve.time(e.samples ?? []) { KeyValue("10–80 %", Format.duration(ms / 60_000)) }
                        if let temps = tempRange { KeyValue(String(localized: "Battery temp"), temps) }
                        if let cost = Format.money(chargeCost(e, settings), settings) { KeyValue(String(localized: "Cost"), cost, color: Theme.good) }
                        KeyValue(String(localized: "Implied capacity"), e.impliedCapacityKwh.map { Format.n($0, 1) + " kWh" })
                    }
                    Button("Delete this entry", role: .destructive, action: onDelete)
                        .font(.system(size: 13)).foregroundStyle(Theme.bad).padding(.top, 6)
                }
                .padding(.top, 10)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.edge, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { open.toggle() } }
    }

    /// "+1.2 kWh (14 % of energy used)", or nil for entries saved before regen was measured.
    private var regenText: String? {
        guard let regen = entry.regenKwh else { return nil }
        let text = "+" + Format.n(regen, 1) + " kWh"
        guard let pct = entry.regenPercent else { return text }
        return text + " (" + TripsView.ofEnergyUsed(pct) + ")"
    }

    private var tempRange: String? {
        let temps = (entry.samples ?? []).compactMap { $0.temp }
        guard let lo = temps.min(), let hi = temps.max(),
              let a = Format.temp(lo, settings), let b = Format.temp(hi, settings) else { return nil }
        return a == b ? a : a + " – " + b
    }

    private var subtitle: String {
        var parts = [Format.date(entry.start).formatted(date: .omitted, time: .shortened), Format.duration(entry.minutes)]
        if let cost = Format.money(chargeCost(entry, settings), settings) { parts.append(cost) }
        return parts.joined(separator: " · ")
    }

    private var title: String {
        if entry.kind == .Charge {
            return (entry.fast ? String(localized: "DC charge") : String(localized: "Charge")) + " · +" + Format.n(entry.kwh, 1) + " kWh"
        }
        return String(localized: "Drive") + " · " + (Format.distance(entry.distanceKm, settings, decimals: 1) ?? "—")
    }
}

/// Charging power against charge %, drawn in when the row opens.
private struct ChargeCurveChart: View {
    let points: [CurvePoint]
    @State private var shown = false

    var body: some View {
        let peak = ChargeCurve.peak(points)
        let top = Swift.max((peak?.kw ?? 0) * 1.25, 5)
        VStack(alignment: .leading, spacing: 8) {
            Text("Charging curve").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
            Chart {
                ForEach(points) { p in
                    AreaMark(x: .value("Charge", p.soc), y: .value("Power", shown ? p.kw : 0))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(LinearGradient(colors: [Theme.aqua.opacity(0.32), Theme.cyan.opacity(0.10), Theme.violet.opacity(0)],
                                                        startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("Charge", p.soc), y: .value("Power", shown ? p.kw : 0))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(Theme.ocean)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                }
                if let peak {
                    PointMark(x: .value("Charge", peak.soc), y: .value("Power", shown ? peak.kw : 0))
                        .foregroundStyle(Theme.aqua)
                        .symbolSize(60)
                        .annotation(position: .top, alignment: .center, spacing: 4,
                                    overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                            Text(String(localized: "Peak \(Format.n(peak.kw, 0)) kW"))
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.aqua)
                                .opacity(shown ? 1 : 0)
                        }
                }
            }
            .chartXScale(domain: 0.0...100.0)
            .chartYScale(domain: 0.0...top)
            .chartXAxis {
                AxisMarks(values: [0.0, 50.0, 100.0]) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(Theme.edge)
                    AxisValueLabel {
                        Text(verbatim: "\(Int(value.as(Double.self) ?? 0)) %").font(.system(size: 11)).foregroundStyle(Theme.dim)
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(Theme.edge)
                    AxisValueLabel {
                        Text(verbatim: "\(Int(value.as(Double.self) ?? 0)) kW").font(.system(size: 11)).foregroundStyle(Theme.dim)
                    }
                }
            }
            .frame(height: 170)
        }
        .onAppear { withAnimation(.easeOut(duration: 0.9).delay(0.1)) { shown = true } }
    }
}
