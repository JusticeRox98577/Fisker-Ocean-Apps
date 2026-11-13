import SwiftUI

struct LiveView: View {
    @EnvironmentObject var car: Car
    @Environment(\.isLandscape) private var landscape
    /// Held here, above both layouts, so the 12V screen stays open when the phone is turned.
    @State private var showV12 = false

    var body: some View {
        Group {
            if landscape {
                LandscapeLive(showV12: $showV12)
            } else {
                portrait
            }
        }
        .sheet(isPresented: $showV12) { V12View().environmentObject(car) }
    }

    private var portrait: some View {
        Page {
            let state = car.state
            let snap = state.snapshot
            let showDash = state.status == .live || state.status == .reconnecting || snap.soc != nil
            switch state.status {
            case .scanning:
                ScanList()
            case .connecting:
                Connecting(name: state.adapterName)
            default:
                if !showDash || state.status == .error || state.stopped != nil { StartCard() }
                if showDash { Dashboard(showV12: $showV12) }
            }
        }
    }
}

private struct Dashboard: View {
    @EnvironmentObject var car: Car
    @Binding var showV12: Bool

    var body: some View {
        let state = car.state
        let settings = car.settings
        let snap = state.snapshot
        let charging = state.mode == .charging
        let power = snap.powerKw

        VStack(spacing: 0) {
            pill(state).padding(.top, 8)
            SocRing(soc: snap.soc, charging: charging, live: state.status == .live) {
                RollingText(text: snap.soc.map { Format.n($0, 1) + "%" } ?? "—", size: 46, weight: .bold)
                Text(Format.range(snap.soc, settings, car.history) ?? String(localized: "range unknown"))
                    .font(.system(size: 14)).foregroundStyle(Theme.dim)
            }
            .padding(.vertical, 6)
            RollingText(text: power.map { Format.n(abs($0), 1) + " kW" } ?? "— kW", color: powerColor(power), size: 22)
            Text(powerLabel(power, charging: charging)).font(.system(size: 12)).foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity)

        if charging, let c = state.currentCharge {
            ChargeCard(charge: c).transition(.opacity.combined(with: .move(edge: .top)))
        }

        if state.mode == .driving, let d = state.currentDrive {
            DriveCard(drive: d).transition(.opacity.combined(with: .move(edge: .top)))
        }

        if state.mode == .parked, let d = car.drains.last, nowMs() - d.end < parkedShowMs {
            ParkedCard(drain: d).transition(.opacity.combined(with: .move(edge: .top)))
        }

        SectionTitle(String(localized: "Battery"))
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Tile(label: String(localized: "Pack voltage"), value: snap.packV.map { Format.n($0, 1) + " V" }, accent: Theme.violet)
                Tile(label: String(localized: "Current"), value: snap.packA.map { Format.n($0, 1) + " A" }, accent: Theme.cyan)
            }
            HStack(spacing: 10) {
                Tile(label: String(localized: "Battery temp"), value: Format.temp(snap.tempAvg, settings),
                     caption: snap.tempMax.flatMap { Format.temp($0, settings) }.map { String(localized: "max \($0)") }, accent: Theme.warn)
                Tile(label: String(localized: "Cell spread"), value: snap.cellSpread.map { "\(Int($0.rounded())) mV" },
                     caption: snap.cellSpread.map(balanceLabel), accent: Theme.aqua,
                     captionColor: snap.cellSpread.map(Theme.balanceColor) ?? Theme.dim)
            }
            HStack(spacing: 10) {
                Button { showV12 = true } label: {
                    Tile(label: String(localized: "12V battery"), value: snap.aux12v.map { Format.n($0, 2) + " V" },
                         caption: snap.aux12v.map { auxStatus($0) + (snap.aux12vSource.map { " · " + V12Source.label($0) } ?? "") },
                         accent: state.watching ? Theme.violet : Theme.good, captionColor: auxColor(snap.aux12v))
                }
                .buttonStyle(PressStyle())
                Tile(label: String(localized: "Odometer"), value: Format.distance(snap.odometerKm, settings),
                     caption: Format.efficiency(Format.whPerKm(car.history), settings).map { String(localized: "avg \($0)") }, accent: Theme.violet)
            }
        }

        if let abrp = state.abrpStatus {
            Text("ABRP: " + abrp).font(.system(size: 12))
                .foregroundStyle(abrp == Abrp.sentMessage ? Theme.dim : Theme.warn)
                .padding(.top, 8)
        }
        if state.status == .live || state.status == .reconnecting {
            GhostButton(title: state.status == .reconnecting ? String(localized: "Stop reconnecting") : String(localized: "Disconnect"), color: Theme.dim) { car.disconnect() }
                .padding(.top, 16)
        }
    }
}

// Shared by the portrait and landscape Live screens.

fileprivate func pill(_ state: CarState) -> Pill {
    if state.watching { return Pill(text: state.watchStatus, color: Theme.violet, pulse: true) }
    if state.status == .reconnecting { return Pill(text: String(localized: "Reconnecting"), color: Theme.warn, pulse: true) }
    if state.status != .live {
        let last = state.lastUpdate.map { String(localized: "Last seen \(Format.date($0).formatted(date: .omitted, time: .shortened))") } ?? String(localized: "Offline")
        return Pill(text: last, color: Theme.dim)
    }
    if state.mode == .charging {
        return Pill(text: state.currentCharge?.fast == true ? String(localized: "DC fast charging") : String(localized: "Charging"), color: Theme.good, pulse: true)
    }
    if state.mode == .driving { return Pill(text: String(localized: "Driving"), color: Theme.cyan, pulse: true) }
    return Pill(text: String(localized: "Parked · live"), color: Theme.aqua)
}

fileprivate func powerColor(_ p: Double?) -> Color {
    guard let p else { return Theme.dim }
    return p > 0.3 ? Theme.good : p < -0.3 ? Theme.cyan : Theme.dim
}

fileprivate func powerLabel(_ p: Double?, charging: Bool) -> String {
    guard let p else { return String(localized: "power") }
    if p > 0.3 { return charging ? String(localized: "into the battery") : String(localized: "regenerating") }
    if p < -0.3 { return String(localized: "from the battery") }
    return String(localized: "idle")
}

fileprivate func auxColor(_ v: Double?) -> Color {
    guard let v else { return Theme.dim }
    return v < 12.0 ? Theme.bad : v < 12.4 ? Theme.warn : Theme.dim
}

fileprivate func timeToTarget(_ soc: Double?, _ powerKw: Double?, _ s: Settings) -> String? {
    guard let soc, let powerKw, powerKw >= 0.5, soc < Double(s.alertHigh), s.usableKwh > 0 else { return nil }
    let kwh = (Double(s.alertHigh) - soc) / 100 * s.usableKwh
    return "≈ " + Format.duration(Int64((kwh / powerKw * 60).rounded()))
}

/// How long after reconnecting the "While parked" card stays on the Live screen.
private let parkedShowMs: Int64 = 12 * 3_600_000

private struct StartCard: View {
    @EnvironmentObject var car: Car
    var topPadding: CGFloat = 24

    var body: some View {
        CardBox {
            Text("Connect to your Ocean").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
            if let stopped = car.state.stopped {
                // Stopped on purpose so the car can sleep: not an error.
                Label(stopped, systemImage: "moon.zzz")
                    .foregroundStyle(Theme.dim).padding(.top, 6)
            } else {
                Text("Plug a Bluetooth LE OBD adapter into the car, turn the car on, then connect.")
                    .foregroundStyle(Theme.dim).padding(.top, 6)
            }
            if car.state.watching {
                Text(watchNote).font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.top, 6)
            }
            if let m = car.state.message {
                Text(m).foregroundStyle(Theme.bad).padding(.top, 10)
            }
            VStack(spacing: 10) {
                if car.settings.adapterId != nil {
                    GradientButton(title: String(localized: "Connect to \(car.settings.adapterName ?? String(localized: "adapter"))")) { car.connectSaved() }
                    GhostButton(title: String(localized: "Choose a different adapter")) { car.scan() }
                } else {
                    GradientButton(title: String(localized: "Find adapter")) { car.scan() }
                }
                if car.state.watching {
                    GhostButton(title: String(localized: "Stop watching 12V"), color: Theme.dim) { car.disconnect() }
                }
            }
            .padding(.top, 18)
        }
        .padding(.top, topPadding)
    }
}

private extension StartCard {
    var watchNote: String {
        let note = car.settings.v12WatchKeepConnected
            ? String(localized: "The adapter stays connected and only its own 12V reading is asked for, so the car stays asleep.")
            : String(localized: "Between checks Ocean Live disconnects so the adapter can sleep. Only the adapter's own 12V reading is asked for, so the car stays asleep.")
        guard let next = car.state.nextWatch else { return note }
        return note + " " + String(localized: "Next check about \(Format.date(next).formatted(date: .omitted, time: .shortened)).")
    }
}

private struct Connecting: View {
    let name: String?
    var topPadding: CGFloat = 90

    var body: some View {
        VStack(spacing: 8) {
            ProgressView().controlSize(.large).tint(Theme.aqua)
            Text("Connecting to \(name ?? String(localized: "adapter"))").font(.system(size: 17)).foregroundStyle(.white).padding(.top, 8)
            Text("Setting up the adapter and waking the car's modules")
                .font(.system(size: 13)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, topPadding)
    }
}

private struct ScanList: View {
    @EnvironmentObject var car: Car

    var body: some View {
        HStack {
            ProgressView().tint(Theme.aqua)
            Text("Looking for adapters…").foregroundStyle(Theme.dim)
            Spacer()
            Button("Cancel") { car.cancelScan() }.foregroundStyle(Theme.aqua)
        }
        .padding(.top, 8)
        if car.found.isEmpty {
            Text("Make sure the adapter is plugged in and the car is on.")
                .font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.top, 10)
        }
        VStack(spacing: 8) {
            ForEach(car.found) { adapter in
                Button { car.connect(adapter) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(adapter.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                            Text(String(adapter.id.uuidString.prefix(8)) + "…").font(.system(size: 12)).foregroundStyle(Theme.dim)
                        }
                        Spacer()
                        SignalBars(rssi: adapter.rssi)
                    }
                    .padding(14)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.edge, lineWidth: 1))
                }
                .buttonStyle(PressStyle())
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(.top, 10)
        .animation(.easeInOut, value: car.found)
    }
}

private struct SignalBars: View {
    let rssi: Int

    var body: some View {
        let bars = rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(1...4, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(i <= bars ? Theme.aqua : Theme.edge)
                    .frame(width: 4, height: CGFloat(4 + i * 4))
            }
        }
    }
}

// MARK: Cards shared by portrait and landscape

private struct ChargeCard: View {
    @EnvironmentObject var car: Car
    let charge: HistoryEntry

    var body: some View {
        let c = charge
        let settings = car.settings
        let snap = car.state.snapshot
        VStack(spacing: 0) {
            SectionTitle(String(localized: "This charge"))
            CardBox(glow: Theme.good) {
                KeyValue(String(localized: "Energy added"), Format.n(c.kwh, 1) + " kWh", color: Theme.good)
                KeyValue(String(localized: "Charging for"), Format.duration(c.minutes))
                if let s = c.socStart { KeyValue(String(localized: "Started at"), "\(Int(s.rounded()))%") }
                KeyValue(String(localized: "Peak power"), c.peakKw.map { Format.n($0, 1) + " kW" })
                if let t = timeToTarget(snap.soc, snap.powerKw, settings) { KeyValue(OceanShared.toTarget(settings.alertHigh), t, color: Theme.aqua) }
            }
        }
    }
}

private struct DriveCard: View {
    @EnvironmentObject var car: Car
    let drive: HistoryEntry

    var body: some View {
        let d = drive
        let settings = car.settings
        VStack(spacing: 0) {
            SectionTitle(String(localized: "This drive"))
            CardBox(glow: Theme.cyan) {
                KeyValue(String(localized: "Distance"), Format.distance(d.distanceKm, settings, decimals: 1))
                KeyValue(String(localized: "Energy used"), Format.n(d.kwh, 1) + " kWh")
                KeyValue(String(localized: "Efficiency"), Format.efficiency(d.whPerKm, settings), color: Theme.cyan)
                KeyValue(String(localized: "Time"), Format.duration(d.minutes))
            }
        }
    }
}

private struct ParkedCard: View {
    @EnvironmentObject var car: Car
    let drain: ParkedDrain

    var body: some View {
        let d = drain
        let settings = car.settings
        VStack(spacing: 0) {
            SectionTitle(String(localized: "While parked"))
            CardBox(glow: Theme.violet) {
                Text(Format.drain(d, settings))
                    .font(.system(size: 17, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                KeyValue(String(localized: "Per day"), Format.perDay(d.perDay, settings), color: Theme.violet)
                    .padding(.top, 6)
                KeyValue(String(localized: "Parked since"), Format.date(d.start).formatted(date: .abbreviated, time: .shortened))
                Text("Charge the car used while you were away and the app wasn't connected.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 4)
            }
        }
    }
}

// MARK: Landscape

/// The Live screen when the window is wider than it is tall: one compact header line with the connect button
/// at the top right, the charge ring on the left and everything else on the right, so the essentials fit
/// without scrolling (as version 1.9 had it). Only the layout differs from portrait: nothing here talks to the car
/// on its own, so rotating never connects, scans or asks the car for anything.
private struct LandscapeLive: View {
    @EnvironmentObject var car: Car
    @Binding var showV12: Bool

    var body: some View {
        let state = car.state
        let showDash = state.status == .live || state.status == .reconnecting || state.snapshot.soc != nil
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Header(status: state.status, adapter: state.adapterName, watching: state.watching,
                       watchStatus: state.watchStatus, compact: true)
                // The button keeps its full width; a long status line gives way first.
                HeaderAction().layoutPriority(1)
            }
            GeometryReader { geo in
                let gap: CGFloat = 16
                let leftWidth = (geo.size.width - gap) * 0.4
                let rightWidth = geo.size.width - gap - leftWidth
                HStack(alignment: .top, spacing: gap) {
                    RingPane(width: leftWidth, height: geo.size.height)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            switch state.status {
                            case .scanning:
                                ScanList()
                            case .connecting:
                                Connecting(name: state.adapterName, topPadding: 24)
                            default:
                                // The connect buttons sit at the top of this pane, never below the fold.
                                if !showDash || state.status == .error || state.stopped != nil { StartCard(topPadding: 4) }
                                if showDash {
                                    LandscapeDashboard(width: rightWidth, compact: geo.size.height < 420, showV12: $showV12)
                                }
                            }
                        }
                        .padding(.bottom, 16)
                    }
                    .scrollIndicators(.hidden)
                    .frame(width: rightWidth)
                }
            }
        }
        .padding(.horizontal, 18)
        .background(Theme.background.ignoresSafeArea())
    }
}

/// Connect, Disconnect or Cancel at the top right of the landscape header.
private struct HeaderAction: View {
    @EnvironmentObject var car: Car

    var body: some View {
        let state = car.state
        switch state.status {
        case .live, .reconnecting:
            SmallButton(title: state.status == .reconnecting ? String(localized: "Stop") : String(localized: "Disconnect"),
                        color: Theme.bad) { car.disconnect() }
        case .scanning:
            SmallButton(title: String(localized: "Cancel")) { car.cancelScan() }
        case .connecting:
            ProgressView().tint(Theme.aqua)
        case .idle, .error:
            if car.settings.adapterId != nil {
                SmallButton(title: String(localized: "Connect"), filled: true) { car.connectSaved() }
            } else {
                SmallButton(title: String(localized: "Find adapter"), filled: true) { car.scan() }
            }
        }
    }
}

private struct SmallButton: View {
    let title: String
    var filled = false
    var color: Color = Theme.aqua
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(filled ? Theme.ink : color)
                .lineLimit(1)
                .padding(.horizontal, 16)
                .frame(minHeight: 34)
                .background {
                    if filled {
                        Capsule().fill(Theme.ocean)
                    } else {
                        Capsule().stroke(color.opacity(0.5), lineWidth: 1)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
    }
}

/// Left pane: status pill, the charge ring sized to the height it has, and the power under it.
/// Shown even while not connected, with the last known values on a dimmed ring, like portrait.
private struct RingPane: View {
    @EnvironmentObject var car: Car
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        let state = car.state
        let settings = car.settings
        let snap = state.snapshot
        let charging = state.mode == .charging
        let power = snap.powerKw
        // Leaves room for the pill above the ring and the power below it.
        let ring = Swift.max(Swift.min(height - 84, width), 120)
        let scale = ring / 230
        VStack(spacing: 0) {
            pill(state)
            SocRing(soc: snap.soc, charging: charging, live: state.status == .live, size: ring) {
                RollingText(text: snap.soc.map { Format.n($0, 1) + "%" } ?? "—", size: Swift.max(46 * scale, 26), weight: .bold)
                Text(Format.range(snap.soc, settings, car.history) ?? String(localized: "range unknown"))
                    .font(.system(size: Swift.max(14 * scale, 11))).foregroundStyle(Theme.dim)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            RollingText(text: power.map { Format.n(abs($0), 1) + " kW" } ?? "— kW", color: powerColor(power), size: 20)
            Text(powerLabel(power, charging: charging)).font(.system(size: 12)).foregroundStyle(Theme.dim)
        }
        .frame(width: width, height: height, alignment: .top)
    }
}

/// Right pane while there are values to show: six tiles first (2 or 3 across, whichever fits the width), then the
/// current charge or drive, cell spread, 12V and odometer, the parked drain and ABRP.
private struct LandscapeDashboard: View {
    @EnvironmentObject var car: Car
    let width: CGFloat
    /// Smaller tiles when the window is short, so all six fit without scrolling.
    let compact: Bool
    @Binding var showV12: Bool

    var body: some View {
        let state = car.state
        let settings = car.settings
        let snap = state.snapshot
        let charging = state.mode == .charging
        let power = snap.powerKw
        let spacing: CGFloat = compact ? 8 : 10
        // Three across while each tile keeps a readable width, otherwise two (three rows).
        let columns = width >= 3 * 130 + 2 * spacing ? 3 : 2

        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns), spacing: spacing) {
            Tile(label: String(localized: "Power"), value: power.map { Format.n(abs($0), 1) + " kW" },
                 caption: powerLabel(power, charging: charging), accent: Theme.good, compact: compact)
            Tile(label: String(localized: "Battery temp"), value: Format.temp(snap.tempAvg, settings),
                 caption: snap.tempMax.flatMap { Format.temp($0, settings) }.map { String(localized: "max \($0)") },
                 accent: Theme.warn, compact: compact)
            Tile(label: String(localized: "Pack voltage"), value: snap.packV.map { Format.n($0, 1) + " V" }, accent: Theme.violet, compact: compact)
            Tile(label: String(localized: "Current"), value: snap.packA.map { Format.n($0, 1) + " A" }, accent: Theme.cyan, compact: compact)
            Tile(label: String(localized: "Efficiency"), value: Format.efficiency(Format.whPerKm(car.history), settings),
                 accent: Theme.aqua, compact: compact)
            Tile(label: String(localized: "Range"), value: Format.range(snap.soc, settings, car.history), accent: Theme.good, compact: compact)
        }
        .padding(.top, 4)

        if charging, let c = state.currentCharge {
            ChargeCard(charge: c).transition(.opacity.combined(with: .move(edge: .top)))
        }

        if state.mode == .driving, let d = state.currentDrive {
            DriveCard(drive: d).transition(.opacity.combined(with: .move(edge: .top)))
        }

        CardBox {
            KeyValue(String(localized: "Cell spread"), snap.cellSpread.map { "\(Int($0.rounded())) mV · " + balanceLabel($0) },
                     color: snap.cellSpread.map(Theme.balanceColor) ?? .white)
            Button { showV12 = true } label: {
                KeyValue(String(localized: "12V battery"), snap.aux12v.map { Format.n($0, 2) + " V · " + auxStatus($0) },
                         color: snap.aux12v.map { $0 < 12.4 ? auxColor($0) : Color.white } ?? .white)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            KeyValue(String(localized: "Odometer"), Format.distance(snap.odometerKm, settings))
        }
        .padding(.top, spacing)

        if state.mode == .parked, let d = car.drains.last, nowMs() - d.end < parkedShowMs {
            ParkedCard(drain: d).transition(.opacity.combined(with: .move(edge: .top)))
        }

        if let abrp = state.abrpStatus {
            Text("ABRP: " + abrp).font(.system(size: 12))
                .foregroundStyle(abrp == Abrp.sentMessage ? Theme.dim : Theme.warn)
                .padding(.top, 8)
        }
    }
}
