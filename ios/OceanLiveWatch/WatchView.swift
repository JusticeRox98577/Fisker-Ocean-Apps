import SwiftUI

/// The one screen: charge ring, power, charging and the 12V battery, from the phone's last reading.
struct WatchView: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        // Redrawn every 30 s so "updated" and the out-of-date check keep up.
        TimelineView(.periodic(from: .now, by: 30)) { timeline in
            ScrollView {
                if let summary = store.summary {
                    content(summary, now: timeline.date)
                } else {
                    empty
                }
            }
        }
        .background { OceanPalette.background.ignoresSafeArea() }
    }

    private func content(_ s: WatchSummary, now: Date) -> some View {
        let charging = s.chargingNow(now: now)
        let fresh = s.isFresh(now: now)
        return VStack(spacing: 8) {
            HStack(spacing: 5) {
                Circle().fill(statusColor(s, now: now)).frame(width: 7, height: 7)
                Text(s.statusText(now: now))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(statusColor(s, now: now))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .animation(.easeInOut(duration: 0.4), value: s.statusText(now: now))

            ChargeRing(soc: s.soc, charging: charging) {
                VStack(spacing: 0) {
                    Text(OceanShared.percent(s.soc))
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .contentTransition(.numericText())
                        .animation(.snappy, value: s.soc)
                        .minimumScaleFactor(0.6)
                    Text(s.rangeText ?? String(localized: "range unknown"))
                        .font(.system(size: 11))
                        .foregroundStyle(OceanPalette.dim)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(.horizontal, 16)
            }
            .frame(width: 128, height: 128)

            if fresh {
                VStack(spacing: 0) {
                    Text(OceanShared.power(s.powerKw))
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .foregroundStyle(powerColor(s.powerKw))
                        .contentTransition(.numericText())
                        .animation(.snappy, value: s.powerKw)
                    Text(s.powerLabel).font(.system(size: 11)).foregroundStyle(OceanPalette.dim)
                }
                .transition(.opacity)
            }

            VStack(spacing: 6) {
                if charging {
                    row(s.toTargetLabel, s.toTargetText, OceanPalette.good)
                }
                row(String(localized: "12V battery"), OceanShared.volts(s.aux12v), auxColor(s.aux12v))
            }
            .padding(10)
            .background(OceanPalette.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            Text(s.updatedText(now: now))
                .font(.system(size: 11))
                .foregroundStyle(OceanPalette.dim)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .animation(.easeInOut(duration: 0.5), value: charging)
        .animation(.easeInOut(duration: 0.5), value: fresh)
    }

    private var empty: some View {
        VStack(spacing: 10) {
            ChargeRing(soc: nil, charging: false, lineWidth: 8)
                .frame(width: 64, height: 64)
            Text("Open Ocean Live on your iPhone and connect to see your car here.")
                .font(.system(size: 13))
                .foregroundStyle(OceanPalette.dim)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private func row(_ label: String, _ value: String, _ accent: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(accent).frame(width: 6, height: 6)
            Text(label).font(.system(size: 12)).foregroundStyle(OceanPalette.dim).lineLimit(1)
            Spacer(minLength: 4)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func statusColor(_ s: WatchSummary, now: Date) -> Color {
        if s.chargingNow(now: now) { return OceanPalette.good }
        if s.isFresh(now: now) { return OceanPalette.aqua }
        return OceanPalette.dim
    }

    /// Same colours as the app's Live screen.
    private func powerColor(_ p: Double?) -> Color {
        guard let p else { return OceanPalette.dim }
        return p > 0.3 ? OceanPalette.good : p < -0.3 ? OceanPalette.cyan : OceanPalette.dim
    }

    private func auxColor(_ v: Double?) -> Color {
        guard let v else { return OceanPalette.dim }
        return v < 12.0 ? OceanPalette.bad : v < 12.4 ? OceanPalette.warn : OceanPalette.good
    }
}

/// The app's charge ring: a 270° arc with the ocean gradient, green while charging, red when low.
struct ChargeRing<Center: View>: View {
    let soc: Double?
    let charging: Bool
    var lineWidth: CGFloat = 11
    @ViewBuilder let center: () -> Center

    var body: some View {
        let fraction = Swift.min(Swift.max((soc ?? 0) / 100, 0), 1)
        let style = StrokeStyle(lineWidth: lineWidth, lineCap: .round)
        ZStack {
            Circle().trim(from: 0, to: 0.75).stroke(OceanPalette.track, style: style).rotationEffect(.degrees(135))
            Circle()
                .trim(from: 0, to: soc == nil ? 0 : 0.75 * fraction)
                .stroke(AngularGradient(colors: OceanPalette.ringColors(soc: soc, charging: charging), center: .center,
                                        startAngle: .degrees(0), endAngle: .degrees(270)), style: style)
                .rotationEffect(.degrees(135))
                .opacity(soc == nil || fraction == 0 ? 0 : 1)
                .animation(.smooth(duration: 0.8), value: fraction)
                .animation(.easeInOut(duration: 0.6), value: charging)
            center()
        }
        .padding(lineWidth / 2)
    }
}

extension ChargeRing where Center == EmptyView {
    init(soc: Double?, charging: Bool, lineWidth: CGFloat = 11) {
        self.init(soc: soc, charging: charging, lineWidth: lineWidth) { EmptyView() }
    }
}
