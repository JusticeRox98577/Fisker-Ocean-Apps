import Charts
import SwiftUI
import UniformTypeIdentifiers

/// How much of the 12V log the screen shows.
enum V12Range: String, CaseIterable, Identifiable {
    case day = "24 h", week = "7 d", month = "30 d", quarter = "90 d"

    var id: String { rawValue }

    /// Short label in the user's language, e.g. "7 d" or "7 T".
    var label: String {
        switch self {
        case .day: return String(localized: "24 h")
        case .week: return String(localized: "7 d")
        case .month: return String(localized: "30 d")
        case .quarter: return String(localized: "90 d")
        }
    }

    var ms: Int64 {
        switch self {
        case .day: return 86_400_000
        case .week: return 7 * 86_400_000
        case .month: return 30 * 86_400_000
        case .quarter: return V12Log.keepMs
        }
    }

    var fileName: String {
        switch self {
        case .day: return "24h"
        case .week: return "7d"
        case .month: return "30d"
        case .quarter: return "90d"
        }
    }
}

func v12StatusColor(_ volts: Double) -> Color {
    volts >= V12Log.low ? Theme.good : volts >= V12Log.veryLow ? Theme.warn : Theme.bad
}

/// Everything the graph and the stats need for one range. Also what gets shared as a PDF.
struct V12Report {
    let samples: [V12Sample]
    let stats: V12Stats
    let from: Int64
    let to: Int64
    let range: V12Range

    init(all: [V12Sample], range: V12Range, now: Int64) {
        from = now - range.ms
        to = now
        self.range = range
        samples = all.filter { $0.time >= now - range.ms }
        stats = V12Log.stats(all, from: now - range.ms)
    }
}

/// The 12V battery screen: graph, stats and sharing. Shows saved readings only; nothing here talks to the car.
struct V12View: View {
    @EnvironmentObject var car: Car
    @Environment(\.dismiss) private var dismiss
    @State private var range: V12Range = .week

    var body: some View {
        let report = V12Report(all: car.v12, range: range, now: nowMs())
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if car.state.watching { watchCard }
                rangeChips.padding(.top, 14)
                CardBox {
                    if report.samples.isEmpty {
                        Text("No 12V readings in this range")
                            .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                        Text("Ocean Live saves the 12V every time it reads the car. Nothing extra is asked of the car for it.")
                            .font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.top, 4)
                    } else {
                        V12Chart(report: report, animated: true).frame(height: 230)
                        V12Legend(report: report).padding(.top, 10)
                    }
                }
                .padding(.top, 12)
                V12StatsCard(report: report)
                if let line = overnightLine {
                    Text(line).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !report.stats.nights.isEmpty { V12NightsCard(nights: report.stats.nights) }
                shareMenu.padding(.top, 18)
                SectionTitle(String(localized: "What the numbers mean"))
                CardBox {
                    Text(V12Text.meaning).font(.system(size: 13)).foregroundStyle(Theme.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.bg)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("12V battery").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                Text("\(car.v12.count) saved readings · last 90 days")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 24)).foregroundStyle(Theme.dim)
            }
        }
        .padding(.top, 20)
    }

    /// How the overnight readings are taken, from the latest asleep reading, and how many quick checks
    /// couldn't reach the adapter during the latest night.
    private var overnightLine: String? {
        var parts: [String] = []
        switch V12Watch.overnightMethod(car.v12) {
        case .quick?: parts.append(String(localized: "Overnight checks: quick (adapter sleeps between)"))
        case .keptOpen?: parts.append(String(localized: "Overnight checks: kept connected"))
        case nil: break
        }
        let missed = car.v12Missed
        if missed > 0 {
            parts.append(String(localized: "Checks that couldn't reach the adapter on the latest night: \(missed)"))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var watchCard: some View {
        HStack {
            Pill(text: car.state.watchStatus, color: Theme.violet, pulse: true)
            Spacer()
            if let next = car.state.nextWatch {
                Text("Next check \(Format.date(next).formatted(date: .omitted, time: .shortened))")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
        }
        .padding(.top, 12)
        .transition(.opacity)
    }

    private var rangeChips: some View {
        HStack(spacing: 8) {
            ForEach(V12Range.allCases) { r in
                let selected = r == range
                Button {
                    withAnimation(.snappy) { range = r }
                } label: {
                    Text(r.label)
                        .font(.system(size: 13, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? Theme.aqua : .white)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(selected ? Theme.aqua.opacity(0.12) : Theme.card, in: Capsule())
                        .overlay(Capsule().stroke(selected ? Theme.aqua.opacity(0.6) : Theme.edge, lineWidth: 1))
                }
                .buttonStyle(PressStyle())
            }
        }
    }

    private var shareMenu: some View {
        let report = V12Report(all: car.v12, range: range, now: nowMs())
        return Menu {
            ShareLink(item: V12CsvExport(samples: report.samples, name: "ocean-live-12v-" + range.fileName),
                      preview: SharePreview("Ocean Live 12V data (CSV)")) {
                Label("Data as CSV", systemImage: "tablecells")
            }
            ShareLink(item: V12PdfExport(report: report, name: "ocean-live-12v-" + range.fileName),
                      preview: SharePreview("Ocean Live 12V graph (PDF)")) {
                Label("Graph and stats as PDF", systemImage: "doc.richtext")
            }
        } label: {
            Text("Share 12V data")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                .frame(maxWidth: .infinity, minHeight: 48)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.aqua.opacity(0.4), lineWidth: 1))
        }
        .disabled(report.samples.isEmpty)
        .opacity(report.samples.isEmpty ? 0.5 : 1)
    }
}

enum V12Text {
    static var meaning: String { String(localized: "Resting voltage is the first reading after the car has slept for 2 hours or more, before the car starts charging the 12V. It is the best sign of the 12V battery's health. 12.4 V or more is good. Resting under 12.4 V means the 12V battery is weak or the car is drawing power while parked. Under 12.0 V the car may not wake up. 13.2 V or more means the car's DC-DC converter is charging the 12V, which it does while driving, charging and now and then while parked.\n\nReadings come from the BMS or the OBD port while the app reads the car, and from the adapter alone while the car sleeps if Watch 12V while the car sleeps is on in Settings.") }
}

/// One point on the graph.
private struct V12Point: Identifiable {
    let id: Int
    let date: Date
    let volts: Double
    let asleep: Bool
    let resting: Bool
    let part: Int
}

/// Voltage over time with the reference lines, shaded charging and driving, resting dots and asleep readings in violet.
struct V12Chart: View {
    let report: V12Report
    var animated = true
    @State private var reveal: CGFloat = 0

    var body: some View {
        let shown = V12Log.forChart(report.samples)
        let parts = V12Log.segments(shown)
        let points: [V12Point] = shown.enumerated().map { i, s in
            V12Point(id: i, date: Format.date(s.time), volts: s.volts, asleep: s.asleep, resting: s.resting, part: parts[i])
        }
        let lo = Swift.min(11.6, (shown.map(\.volts).min() ?? 12) - 0.1)
        let hi = Swift.max(14.6, (shown.map(\.volts).max() ?? 14) + 0.1)
        let bands = V12Log.bands(report.samples)
        let partSizes = Dictionary(grouping: points, by: { $0.part }).mapValues { $0.count }
        let resting = points.filter { $0.resting }
        let lone = points.filter { !$0.resting && partSizes[$0.part] == 1 }
        let start = Format.date(report.from)
        let end = Format.date(report.to)

        Chart {
            ForEach(bands) { b in
                RectangleMark(xStart: .value("From", Format.date(Swift.max(b.start, report.from))),
                              xEnd: .value("To", Format.date(Swift.min(b.end, report.to))),
                              yStart: .value("Low", lo), yEnd: .value("High", hi))
                    .foregroundStyle((b.mode == .charging ? Theme.good : Theme.cyan).opacity(0.12))
            }
            RuleMark(y: .value("Very low", V12Log.veryLow))
                .foregroundStyle(Theme.bad.opacity(0.45))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            RuleMark(y: .value("Low", V12Log.low))
                .foregroundStyle(Theme.warn.opacity(0.45))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            RuleMark(y: .value("Charging", V12Log.charging))
                .foregroundStyle(Theme.good.opacity(0.45))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            ForEach(points) { p in
                LineMark(x: .value("Time", p.date), y: .value("Volts", p.volts), series: .value("Part", p.part))
                    .foregroundStyle(p.asleep ? Theme.violet : Theme.aqua)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
            ForEach(resting) { p in
                PointMark(x: .value("Time", p.date), y: .value("Volts", p.volts))
                    .foregroundStyle(Color.white)
                    .symbolSize(30)
            }
            // A lone reading has no line, so it gets a small dot.
            ForEach(lone) { p in
                PointMark(x: .value("Time", p.date), y: .value("Volts", p.volts))
                    .foregroundStyle(p.asleep ? Theme.violet : Theme.aqua)
                    .symbolSize(14)
            }
        }
        .chartXScale(domain: start...end)
        .chartYScale(domain: lo...hi)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine().foregroundStyle(Theme.edge)
                AxisValueLabel().foregroundStyle(Theme.dim)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: [12.0, 12.4, 13.2, 14.0]) { value in
                AxisGridLine().foregroundStyle(Color.clear)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(Format.n(v, 1)).font(.system(size: 10)).foregroundStyle(Theme.dim)
                    }
                }
            }
        }
        .mask(alignment: .leading) {
            GeometryReader { g in
                Rectangle().frame(width: g.size.width * (animated ? reveal : 1))
            }
        }
        .onAppear { draw() }
        .onChange(of: report.range) { _, _ in draw() }
    }

    /// Draws the line in from the left.
    private func draw() {
        guard animated else { return }
        reveal = 0
        withAnimation(.easeOut(duration: 0.9)) { reveal = 1 }
    }
}

private struct V12Legend: View {
    let report: V12Report

    var body: some View {
        let hasAsleep = report.samples.contains { $0.asleep }
        let hasCharging = report.samples.contains { $0.mode == .charging }
        let hasDriving = report.samples.contains { $0.mode == .driving }
        let hasResting = report.samples.contains { $0.resting }
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                item(Theme.aqua, String(localized: "Awake"), line: true)
                if hasAsleep { item(Theme.violet, String(localized: "Asleep"), line: true) }
                if hasResting { item(.white, String(localized: "Resting"), line: false) }
            }
            if hasCharging || hasDriving {
                HStack(spacing: 14) {
                    if hasCharging { band(Theme.good, String(localized: "Charging")) }
                    if hasDriving { band(Theme.cyan, String(localized: "Driving")) }
                }
            }
        }
    }

    private func item(_ color: Color, _ text: String, line: Bool) -> some View {
        HStack(spacing: 6) {
            if line {
                Capsule().fill(color).frame(width: 14, height: 3)
            } else {
                Circle().fill(color).frame(width: 7, height: 7)
            }
            Text(text).font(.system(size: 11)).foregroundStyle(Theme.dim)
        }
    }

    private func band(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(color.opacity(0.25)).frame(width: 14, height: 10)
            Text(text).font(.system(size: 11)).foregroundStyle(Theme.dim)
        }
    }
}

struct V12StatsCard: View {
    let report: V12Report

    var body: some View {
        let s = report.stats
        let now = report.to
        VStack(spacing: 0) {
            SectionTitle(String(localized: "Stats") + " · " + report.range.label)
            CardBox {
                if let latest = s.latest {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Latest").foregroundStyle(Theme.dim)
                        Spacer()
                        RollingText(text: Format.n(latest.volts, 2) + " V", color: v12StatusColor(latest.volts), size: 22, weight: .bold)
                    }
                    Text(V12Source.label(latest.source) + " · " + ago(latest.time, now: now))
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.bottom, 6)
                }
                KeyValue(String(localized: "Latest resting"), s.latestResting.map { Format.n($0.volts, 2) + " V · " + V12Log.status($0.volts) },
                         color: s.latestResting.map { v12StatusColor($0.volts) } ?? .white)
                if let r = s.latestResting {
                    Text(ago(r.time, now: now)).font(.system(size: 12)).foregroundStyle(Theme.dim)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                KeyValue(String(localized: "Lowest resting"), s.lowestResting.map { Format.n($0, 2) + " V" },
                         color: s.lowestResting.map(v12StatusColor) ?? .white)
                KeyValue(String(localized: "Average resting"), s.averageResting.map { Format.n($0, 2) + " V" })
                KeyValue(String(localized: "Charged by the car"), s.chargedShare.map { share -> String in
                    let pct = "\(Int((share * 100).rounded()))%"
                    return String(localized: "\(pct) of connected time")
                })
                KeyValue(String(localized: "Last charged by the car"), s.lastCharged.map { ago($0, now: now) }, color: Theme.good)
                KeyValue(String(localized: "Overnight drop"), s.averageDrop.map {
                    String(localized: "\(Format.n($0, 2)) V a night") + " (" + String(localized: "\(s.nights.count) nights") + ")"
                }, color: Theme.violet)
            }
        }
    }

    private func ago(_ time: Int64, now: Int64) -> String {
        let hours = Double(Swift.max(now - time, 0)) / 3_600_000
        return hours < 1 / 60 ? String(localized: "just now") : String(localized: "\(Format.span(hours)) ago")
    }
}

private struct V12NightsCard: View {
    let nights: [V12Night]

    var body: some View {
        SectionTitle(String(localized: "Nights"))
        CardBox {
            ForEach(Array(nights.suffix(7).reversed())) { n in
                HStack {
                    Text(Format.date(n.start).formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                        .font(.system(size: 14)).foregroundStyle(Theme.dim)
                    Spacer()
                    Text(verbatim: Format.n(n.from, 2) + " → " + Format.n(n.to, 2) + " V")
                        .font(.system(size: 14, weight: .medium, design: .rounded)).foregroundStyle(.white)
                    Text((n.drop >= 0 ? "−" : "+") + Format.n(abs(n.drop), 2))
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(n.drop > 0.15 ? Theme.warn : Theme.violet)
                        .frame(width: 52, alignment: .trailing)
                }
                .padding(.vertical, 5)
            }
            Text("Resting voltage when the car went to sleep against the reading in the morning. Only nights the 12V was watched.")
                .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
        }
    }
}

// MARK: Sharing

/// The readings of the range as a CSV file, written only when the user shares it.
struct V12CsvExport: Transferable {
    let samples: [V12Sample]
    let name: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { item in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(item.name + ".csv")
            try Data(V12Log.csv(item.samples).utf8).write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

/// The graph and the stats as a one-page PDF, drawn only when the user shares it.
struct V12PdfExport: Transferable {
    let report: V12Report
    let name: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { item in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(item.name + ".pdf")
            try await MainActor.run { try V12Pdf.write(item.report, to: url) }
            return SentTransferredFile(url)
        }
    }
}

@MainActor
enum V12Pdf {
    static func write(_ report: V12Report, to url: URL) throws {
        let renderer = ImageRenderer(content: V12PdfPage(report: report))
        renderer.proposedSize = ProposedViewSize(width: 612, height: nil)
        var written = false
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let pdf = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
            pdf.beginPDFPage(nil)
            draw(pdf)
            pdf.endPDFPage()
            pdf.closePDF()
            written = true
        }
        if !written { throw CocoaError(.fileWriteUnknown) }
    }
}

private struct V12PdfPage: View {
    let report: V12Report

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Ocean Live · 12V battery").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
            Text("\(Format.date(report.from).formatted(date: .abbreviated, time: .shortened)) to \(Format.date(report.to).formatted(date: .abbreviated, time: .shortened))")
                .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 2)
            CardBox {
                V12Chart(report: report, animated: false).frame(height: 230)
                V12Legend(report: report).padding(.top, 10)
            }
            .padding(.top, 14)
            V12StatsCard(report: report)
            if !report.stats.nights.isEmpty { V12NightsCard(nights: report.stats.nights) }
            Text(V12Text.meaning).font(.system(size: 10)).foregroundStyle(Theme.dim).padding(.top, 14)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(28)
        .frame(width: 612)
        .background(Theme.bg)
        .environment(\.colorScheme, .dark)
    }
}
