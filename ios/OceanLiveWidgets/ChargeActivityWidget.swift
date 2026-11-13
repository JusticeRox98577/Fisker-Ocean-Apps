import ActivityKit
import SwiftUI
import WidgetKit

/// The charging Live Activity: lock screen and banner, Dynamic Island. Used on iOS 17.
/// The bundle picks `ChargeActivityWidgetWithSmall` on iOS 18 and later instead.
struct ChargeActivityWidget: Widget {
    var body: some WidgetConfiguration {
        Self.activity()
    }

    static func activity() -> some WidgetConfiguration {
        ActivityConfiguration(for: ChargeActivityAttributes.self) { context in
            ChargeActivityView(state: context.state)
                .activityBackgroundTint(OceanPalette.card)
                .activitySystemActionForegroundColor(OceanPalette.aqua)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        GlanceRing(soc: s.soc, charging: s.charging, lineWidth: 5) {
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(s.charging ? OceanPalette.good : OceanPalette.dim)
                        }
                        .frame(width: 40, height: 40)
                        Text(OceanShared.percent(s.soc))
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(OceanShared.power(s.powerKw))
                            .font(.system(size: 20, weight: .semibold, design: .rounded))
                            .foregroundStyle(OceanPalette.good)
                        Text(s.title).font(.system(size: 11)).foregroundStyle(OceanPalette.dim)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Label(s.toTargetLabel, systemImage: "flag.checkered")
                            .foregroundStyle(OceanPalette.dim)
                        Text(s.toTargetText).foregroundStyle(OceanPalette.aqua)
                        Spacer()
                        Text(s.rangeText ?? "").foregroundStyle(OceanPalette.cyan)
                    }
                    .font(.system(size: 13, weight: .medium))
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                GlanceRing(soc: s.soc, charging: s.charging, lineWidth: 3)
                    .frame(width: 22, height: 22)
            } compactTrailing: {
                Text(OceanShared.percent(s.soc))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(s.charging ? OceanPalette.good : .white)
            } minimal: {
                GlanceRing(soc: s.soc, charging: s.charging, lineWidth: 3)
                    .frame(width: 22, height: 22)
            }
            .keylineTint(OceanPalette.aqua)
        }
    }
}

/// The same Live Activity, also offering the small layout for Apple Watch and CarPlay (iOS 18 and later).
/// A separate widget because an opaque return type can't differ by OS version.
@available(iOS 18.0, *)
struct ChargeActivityWidgetWithSmall: Widget {
    var body: some WidgetConfiguration {
        ChargeActivityWidget.activity().supplementalActivityFamilies([.small])
    }
}

/// Picks the small card on Apple Watch and CarPlay, and the full banner everywhere else.
struct ChargeActivityView: View {
    let state: ChargeActivityAttributes.ContentState

    var body: some View {
        if #available(iOS 18.0, *) {
            FamilyChargeView(state: state)
        } else {
            ChargeBanner(state: state)
        }
    }
}

@available(iOS 18.0, *)
private struct FamilyChargeView: View {
    @Environment(\.activityFamily) private var family
    let state: ChargeActivityAttributes.ContentState

    var body: some View {
        if family == .small {
            ChargeSmallCard(state: state)
        } else {
            ChargeBanner(state: state)
        }
    }
}

/// Lock screen and banner.
private struct ChargeBanner: View {
    let state: ChargeActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 16) {
            GlanceRing(soc: state.soc, charging: state.charging, lineWidth: 8) {
                Text(OceanShared.percent(state.soc))
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: 78, height: 78)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    HStack(spacing: 6) {
                        Circle().fill(state.charging ? OceanPalette.good : OceanPalette.dim).frame(width: 7, height: 7)
                        Text(state.title).font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(state.charging ? OceanPalette.good : OceanPalette.dim)
                    }
                    Spacer()
                    Text(OceanShared.power(state.powerKw))
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }
                HStack(spacing: 10) {
                    fact(state.toTargetLabel, state.toTargetText, OceanPalette.aqua)
                    fact(String(localized: "Range"), state.rangeText ?? "—", OceanPalette.cyan)
                }
            }
        }
        .padding(16)
    }

    private func fact(_ label: String, _ value: String, _ accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle().fill(accent).frame(width: 5, height: 5)
                Text(label).font(.system(size: 11)).foregroundStyle(OceanPalette.dim)
            }
            Text(value).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Apple Watch and CarPlay: basic live data at a glance.
private struct ChargeSmallCard: View {
    let state: ChargeActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 10) {
            GlanceRing(soc: state.soc, charging: state.charging, lineWidth: 5) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(state.charging ? OceanPalette.good : OceanPalette.dim)
            }
            .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 1) {
                Text(OceanShared.percent(state.soc))
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(OceanShared.power(state.powerKw))
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(OceanPalette.good)
                Text(state.rangeText ?? "—")
                    .font(.system(size: 12))
                    .foregroundStyle(OceanPalette.cyan)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
        .padding(10)
    }
}
