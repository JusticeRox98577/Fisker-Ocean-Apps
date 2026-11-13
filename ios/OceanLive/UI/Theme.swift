import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

/// Deep ocean palette with teal → cyan → violet accents, same as the Android app.
enum Theme {
    static let bg = Color(hex: 0x060B12)
    static let bgTop = Color(hex: 0x0B1A2A)
    static let card = Color(hex: 0x0F1B28)
    static let edge = Color(hex: 0x7FE7FF, opacity: 0.10)
    static let track = Color(hex: 0x13233A)
    static let dim = Color(hex: 0x7E92A6)
    static let aqua = Color(hex: 0x2EE6C9)
    static let cyan = Color(hex: 0x38BDF8)
    static let violet = Color(hex: 0x8B7CF6)
    static let good = Color(hex: 0x4ADE80)
    static let warn = Color(hex: 0xFBBF24)
    static let bad = Color(hex: 0xFB7185)
    static let ink = Color(hex: 0x04121C)

    static let ocean = LinearGradient(colors: [aqua, cyan, violet], startPoint: .leading, endPoint: .trailing)
    static let danger = LinearGradient(colors: [bad, violet], startPoint: .leading, endPoint: .trailing)
    static let background = LinearGradient(colors: [bgTop, bg, bg], startPoint: .top, endPoint: .bottom)

    static func balanceColor(_ mv: Double) -> Color { mv <= 60 ? good : mv <= 100 ? warn : bad }
}

struct CardBox<Content: View>: View {
    var glow: Color? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(glow?.opacity(0.45) ?? Theme.edge, lineWidth: 1)
                    .animation(.easeInOut(duration: 0.6), value: glow)
            )
    }
}

struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased(with: Locale.current))
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(Theme.dim)
            .padding(.top, 22).padding(.bottom, 10).padding(.leading, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Text whose digits roll when the value changes.
struct RollingText: View {
    let text: String
    var color: Color = .white
    var size: CGFloat = 20
    var weight: Font.Weight = .semibold

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: weight, design: .rounded))
            .foregroundStyle(color)
            .contentTransition(.numericText())
            .animation(.snappy, value: text)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

struct Tile: View {
    let label: String
    let value: String?
    var caption: String? = nil
    var accent: Color = Theme.aqua
    var captionColor: Color = Theme.dim
    /// Smaller paddings and text, for the landscape Live screen in a short window.
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 3 : 6) {
            HStack(spacing: 6) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(label).font(.system(size: compact ? 11 : 12)).foregroundStyle(Theme.dim).lineLimit(compact ? 1 : nil)
            }
            RollingText(text: value ?? "—", size: compact ? 17 : 20)
            if let caption {
                Text(caption).font(.system(size: compact ? 11 : 12)).foregroundStyle(captionColor).lineLimit(compact ? 1 : nil)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(compact ? 10 : 14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge, lineWidth: 1))
    }
}

struct KeyValue: View {
    let key: String
    let value: String?
    var color: Color = .white

    init(_ key: String, _ value: String?, color: Color = .white) {
        self.key = key
        self.value = value
        self.color = color
    }

    var body: some View {
        HStack {
            Text(key).font(.system(size: 14)).foregroundStyle(Theme.dim)
            Spacer()
            RollingText(text: value ?? "—", color: color, size: 14, weight: .medium)
        }
        .padding(.vertical, 6)
    }
}

/// A small rounded pill, e.g. "Charging · DC".
struct Pill: View {
    let text: String
    let color: Color
    var pulse = false

    var body: some View {
        HStack(spacing: 7) {
            // Clock-driven, so the dot pulses whenever `pulse` is on, however the pill appeared.
            TimelineView(.animation(paused: !pulse)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                let wave = (sin(t * .pi / 0.9) + 1) / 2
                Circle().fill(color).frame(width: 7, height: 7).opacity(pulse ? 0.45 + 0.55 * wave : 1)
            }
            Text(text).font(.system(size: 12, weight: .semibold)).foregroundStyle(color)
        }
        .padding(.horizontal, 12).padding(.vertical, 5)
        .background(color.opacity(0.14), in: Capsule())
    }
}

/// The charge ring: a gradient arc that eases to the new value, with a soft glow,
/// a sweeping shine while charging and a gentle breathing while live.
struct SocRing<Center: View>: View {
    let soc: Double?
    let charging: Bool
    let live: Bool
    var size: CGFloat = 230
    @ViewBuilder let center: () -> Center

    @State private var breathe = false

    private var colors: [Color] {
        if charging { return [Theme.good, Theme.aqua, Theme.good] }
        if let soc, soc < 20 { return [Theme.bad, Theme.warn, Theme.bad] }
        return [Theme.aqua, Theme.cyan, Theme.violet, Theme.aqua]
    }

    var body: some View {
        let fraction = Swift.min(Swift.max((soc ?? 0) / 100, 0), 1)
        let style = StrokeStyle(lineWidth: 18, lineCap: .round)
        ZStack {
            Circle().trim(from: 0, to: 0.75).stroke(Theme.track, style: style).rotationEffect(.degrees(135))
            if soc != nil {
                Circle()
                    .trim(from: 0, to: 0.75 * fraction)
                    .stroke(AngularGradient(colors: colors, center: .center, startAngle: .degrees(0), endAngle: .degrees(270)), style: style)
                    .rotationEffect(.degrees(135))
                    .shadow(color: colors[0].opacity(live ? (breathe ? 0.55 : 0.2) : 0.12), radius: 16)
                    .animation(.easeInOut(duration: 1.2), value: fraction)
                if charging && fraction > 0.02 {
                    ChargeSweep(fraction: fraction)
                }
            }
            VStack(spacing: 2) { center() }
        }
        .padding(16)
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) { breathe = true }
        }
    }
}

/// While charging, a bright streak runs from the start of the arc to the current charge, then starts again.
/// It is driven by the clock rather than a one-off animation, so it always moves, however the ring
/// appeared, and it stays inside the filled part as the charge rises.
private struct ChargeSweep: View {
    let fraction: Double
    private let period = 2.4
    private let length = 0.06

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
            let end = 0.75 * fraction
            let head = end * t
            let tail = Swift.max(head - length, 0)
            // Fade in at the start and out at the end so the jump back to the start isn't visible.
            let fade = Swift.min(t / 0.15, (1 - t) / 0.15, 1)
            Circle()
                .trim(from: tail, to: Swift.max(head, tail + 0.0005))
                .stroke(Color.white.opacity(0.85 * fade), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(135))
                .blur(radius: 0.6)
        }
        .allowsHitTesting(false)
    }
}

/// Animated horizontal bar.
struct MeterBar: View {
    let fraction: Double
    var gradient = Theme.ocean

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.track)
                Capsule().fill(gradient)
                    .frame(width: geo.size.width * Swift.min(Swift.max(fraction, 0.02), 1))
                    .animation(.easeInOut(duration: 0.9), value: fraction)
            }
        }
        .frame(height: 8)
    }
}

struct GradientButton: View {
    let title: String
    var enabled = true
    var gradient = Theme.ocean
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(enabled ? Theme.ink : Theme.dim)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background {
                    if enabled {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(gradient)
                    } else {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.card)
                    }
                }
        }
        .disabled(!enabled)
        .buttonStyle(PressStyle())
    }
}

struct GhostButton: View {
    let title: String
    var color: Color = Theme.aqua
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(color)
                .frame(maxWidth: .infinity, minHeight: 48)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(color.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(PressStyle())
    }
}

/// Slight shrink while pressed.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Widest a single-column page gets, so a landscape screen reads like a column instead of stretching edge to edge.
let readableWidth: CGFloat = 720

/// True when the window is wider than it is tall: every iPhone in landscape has a compact height.
extension EnvironmentValues {
    var isLandscape: Bool { verticalSizeClass == .compact }
}

extension View {
    /// Centres the content in a column no wider than `readableWidth`. On a phone in portrait it changes nothing.
    func readableColumn() -> some View {
        frame(maxWidth: readableWidth).frame(maxWidth: .infinity)
    }
}

/// Scrolling page with the app header.
struct Page<Content: View>: View {
    @EnvironmentObject var car: Car
    @Environment(\.isLandscape) private var landscape
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Header(status: car.state.status, adapter: car.state.adapterName, watching: car.state.watching,
                       watchStatus: car.state.watchStatus, compact: landscape)
                content()
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
            .readableColumn()
        }
        .scrollIndicators(.hidden)
        .background(Theme.background.ignoresSafeArea())
    }
}

struct Header: View {
    let status: Status
    let adapter: String?
    var watching = false
    var watchStatus = V12Watch.statusText
    /// One short line (title, status dot, connection text) to save height in landscape.
    var compact = false

    var body: some View {
        if compact {
            HStack(spacing: 10) {
                Text("Ocean Live").font(.system(size: 18, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                statusDot
                Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.dim).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
        } else {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ocean Live").font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.dim)
                }
                Spacer()
                statusDot
            }
            .padding(.vertical, 12)
        }
    }

    private var statusDot: some View {
        Circle().fill(dot).frame(width: 10, height: 10)
            .shadow(color: dot.opacity(0.6), radius: status == .live ? 6 : 0)
            .animation(.easeInOut(duration: 0.5), value: status)
            .animation(.easeInOut(duration: 0.5), value: watching)
    }

    private var subtitle: String {
        switch status {
        case .live: return String(localized: "Connected to \(adapter ?? String(localized: "adapter"))")
        case .connecting: return String(localized: "Connecting")
        case .reconnecting: return String(localized: "Reconnecting")
        case .scanning: return String(localized: "Looking for adapters")
        case .idle, .error: return watching ? watchStatus : String(localized: "Not connected")
        }
    }

    private var dot: Color {
        switch status {
        case .live: return Theme.aqua
        case .connecting, .reconnecting, .scanning: return Theme.warn
        default: return watching ? Theme.violet : Theme.dim
        }
    }
}
