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
                Chip(text: "All", selected: filter == nil) { filter = nil }
                Chip(text: "Drives", selected: filter == .Drive) { filter = .Drive }
                Chip(text: "Charges", selected: filter == .Charge) { filter = .Charge }
            }
            .padding(.top, 8)

            let drives = history.filter { $0.kind == .Drive }
            if !drives.isEmpty {
                SectionTitle("Totals")
                HStack(spacing: 10) {
                    Tile(label: "Distance", value: Format.distance(drives.reduce(0) { $0 + ($1.distanceKm ?? 0) }, settings), accent: Theme.cyan)
                    Tile(label: "Average", value: Format.efficiency(Format.whPerKm(history), settings), accent: Theme.aqua)
                }
            }

            if history.contains(where: { $0.kind == .Charge }) {
                let months = monthlyCharging(history, settings)
                SectionTitle("Charging")
                HStack(spacing: 10) {
                    MonthTile(label: "This month", totals: months.this, settings: settings, accent: Theme.good)
                    MonthTile(label: "Last month", totals: months.last, settings: settings, accent: Theme.violet)
                }
            }

            let list = Array(history.filter { filter == nil || $0.kind == filter }.reversed().prefix(200))
            SectionTitle(list.isEmpty ? "Nothing yet" : "Recent")
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
                    GradientButton(title: "Export CSV") { exporting = true }
                    GhostButton(title: "Clear history", color: Theme.bad) { confirmClear = true }
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
            Tile(label: label, value: kwh, caption: "\(totals.count) charge\(totals.count == 1 ? "" : "s")", accent: accent)
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
                        KeyValue("Energy used", Format.n(e.kwh, 2) + " kWh")
                        KeyValue("Efficiency", Format.efficiency(e.whPerKm, settings))
                    } else {
                        KeyValue("Peak power", e.peakKw.map { Format.n($0, 1) + " kW" })
                        KeyValue("Average power", e.minutes > 0 ? Format.n(e.kwh / (Double(e.minutes) / 60), 1) + " kW" : nil)
                        if let cost = Format.money(chargeCost(e, settings), settings) { KeyValue("Cost", cost, color: Theme.good) }
                        KeyValue("Implied capacity", e.impliedCapacityKwh.map { Format.n($0, 1) + " kWh" })
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

    private var subtitle: String {
        var parts = [Format.date(entry.start).formatted(date: .omitted, time: .shortened), Format.duration(entry.minutes)]
        if let cost = Format.money(chargeCost(entry, settings), settings) { parts.append(cost) }
        return parts.joined(separator: " · ")
    }

    private var title: String {
        if entry.kind == .Charge {
            return (entry.fast ? "DC charge" : "Charge") + " · +" + Format.n(entry.kwh, 1) + " kWh"
        }
        return "Drive · " + (Format.distance(entry.distanceKm, settings, decimals: 1) ?? "—")
    }
}
