import SwiftUI
import WidgetKit

@main
struct OceanLiveWidgetBundle: WidgetBundle {
    var body: some Widget {
        // The extension requires iOS 18 (see project.yml), so the Live Activity always includes the
        // small layout for Apple Watch and CarPlay, with no OS checks in the bundle (Swift can't compile them here).
        StatusWidget()
        ChargeActivityWidgetWithSmall()
    }
}

/// The app's charge ring, drawn still: a 270° gradient arc over a dark track.
struct GlanceRing<Center: View>: View {
    let soc: Double?
    let charging: Bool
    var lineWidth: CGFloat = 10
    @ViewBuilder let center: () -> Center

    var body: some View {
        let fraction = Swift.min(Swift.max((soc ?? 0) / 100, 0), 1)
        let style = StrokeStyle(lineWidth: lineWidth, lineCap: .round)
        ZStack {
            Circle().trim(from: 0, to: 0.75).stroke(OceanPalette.track, style: style).rotationEffect(.degrees(135))
            if soc != nil && fraction > 0 {
                Circle()
                    .trim(from: 0, to: 0.75 * fraction)
                    .stroke(AngularGradient(colors: OceanPalette.ringColors(soc: soc, charging: charging), center: .center,
                                            startAngle: .degrees(0), endAngle: .degrees(270)), style: style)
                    .rotationEffect(.degrees(135))
            }
            center()
        }
        .padding(lineWidth / 2)
    }
}

extension GlanceRing where Center == EmptyView {
    init(soc: Double?, charging: Bool, lineWidth: CGFloat = 10) {
        self.init(soc: soc, charging: charging, lineWidth: lineWidth) { EmptyView() }
    }
}
