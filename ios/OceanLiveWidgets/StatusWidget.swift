import SwiftUI
import WidgetKit

struct StatusEntry: TimelineEntry {
    let date: Date
    let data: WidgetData?
}

/// Reads the latest reading the app saved to the App Group.
struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry {
        StatusEntry(date: Date(), data: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(StatusEntry(date: Date(), data: WidgetData.load() ?? (context.isPreview ? .sample : nil)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        let entry = StatusEntry(date: Date(), data: WidgetData.load())
        // The app asks for a reload whenever it has new readings; this is only a fallback.
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

extension WidgetData {
    static let sample = WidgetData(soc: 76, rangeText: "≈ 230 mi", aux12v: 12.6, status: "Parked",
                                   charging: false, live: true, updatedAt: Date())
}

struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: OceanShared.widgetKind, provider: StatusProvider()) { entry in
            StatusWidgetView(data: entry.data)
                .containerBackground(for: .widget) { OceanPalette.background }
        }
        .configurationDisplayName("Ocean Live")
        .description("Charge, range and 12V battery from your last reading.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

struct StatusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let data: WidgetData?

    var body: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .systemMedium: medium
        default: small
        }
    }

    // MARK: Home screen

    private var small: some View {
        VStack(spacing: 6) {
            if let data {
                GlanceRing(soc: data.soc, charging: data.charging, lineWidth: 9) {
                    VStack(spacing: 0) {
                        Text(OceanShared.percent(data.soc))
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .minimumScaleFactor(0.6)
                        Text(data.rangeText ?? "range unknown")
                            .font(.system(size: 10))
                            .foregroundStyle(OceanPalette.dim)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .padding(.horizontal, 14)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                HStack(spacing: 4) {
                    statusDot(data)
                    Text(data.status).font(.system(size: 11, weight: .semibold)).foregroundStyle(statusColor(data))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(OceanShared.volts(data.aux12v)).font(.system(size: 11)).foregroundStyle(OceanPalette.dim)
                }
                updated(data)
            } else {
                empty
            }
        }
    }

    private var medium: some View {
        HStack(spacing: 16) {
            if let data {
                GlanceRing(soc: data.soc, charging: data.charging, lineWidth: 11) {
                    Text(OceanShared.percent(data.soc))
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.6)
                }
                .frame(width: 118, height: 118)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        statusDot(data)
                        Text(data.status).font(.system(size: 13, weight: .semibold)).foregroundStyle(statusColor(data))
                    }
                    row("Range", data.rangeText ?? "—", OceanPalette.cyan)
                    row("12V battery", OceanShared.volts(data.aux12v), OceanPalette.good)
                    Spacer(minLength: 0)
                    updated(data)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                empty
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 6) {
            GlanceRing(soc: nil, charging: false, lineWidth: 8)
                .frame(width: 56, height: 56)
            Text("Open Ocean Live and connect to see your car here.")
                .font(.system(size: 12))
                .foregroundStyle(OceanPalette.dim)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func row(_ label: String, _ value: String, _ accent: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(accent).frame(width: 6, height: 6)
            Text(label).font(.system(size: 12)).foregroundStyle(OceanPalette.dim)
            Spacer(minLength: 4)
            Text(value).font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }

    private func updated(_ data: WidgetData) -> some View {
        Text("Updated \(data.updatedAt.formatted(date: .omitted, time: .shortened))")
            .font(.system(size: 10))
            .foregroundStyle(OceanPalette.dim)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statusDot(_ data: WidgetData) -> some View {
        Circle().fill(statusColor(data)).frame(width: 7, height: 7)
    }

    private func statusColor(_ data: WidgetData) -> Color {
        if data.charging { return OceanPalette.good }
        if data.live { return OceanPalette.aqua }
        return OceanPalette.dim
    }

    // MARK: Lock screen

    private var circular: some View {
        Gauge(value: Swift.min(Swift.max(data?.soc ?? 0, 0), 100), in: 0...100) {
            Image(systemName: data?.charging == true ? "bolt.fill" : "car.fill")
        } currentValueLabel: {
            Text(data?.soc.map { "\(Int($0.rounded()))" } ?? "—")
        }
        .gaugeStyle(.accessoryCircular)
        .widgetAccentable()
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(OceanShared.percent(data?.soc)).font(.headline).widgetAccentable()
                Spacer(minLength: 4)
                Text(data?.rangeText ?? "").font(.caption).lineLimit(1)
            }
            Gauge(value: Swift.min(Swift.max(data?.soc ?? 0, 0), 100), in: 0...100) {
                Text("Charge")
            }
            .gaugeStyle(.accessoryLinearCapacity)
            .widgetAccentable()
            Text(data.map { "\($0.status) · \($0.updatedAt.formatted(date: .omitted, time: .shortened))" } ?? "Open Ocean Live")
                .font(.caption2)
                .lineLimit(1)
        }
    }
}
