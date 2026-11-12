import SwiftUI

struct LiveView: View {
    @EnvironmentObject var car: Car

    var body: some View {
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
                if !showDash || state.status == .error { StartCard() }
                if showDash { Dashboard() }
            }
        }
    }
}

private struct Dashboard: View {
    @EnvironmentObject var car: Car

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
                Text(Format.range(snap.soc, settings, car.history) ?? "range unknown")
                    .font(.system(size: 14)).foregroundStyle(Theme.dim)
            }
            .padding(.vertical, 6)
            RollingText(text: power.map { Format.n(abs($0), 1) + " kW" } ?? "— kW", color: powerColor(power), size: 22)
            Text(powerLabel(power, charging: charging)).font(.system(size: 12)).foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity)

        if charging, let c = state.currentCharge {
            VStack(spacing: 0) {
                SectionTitle("This charge")
                CardBox(glow: Theme.good) {
                    KeyValue("Energy added", Format.n(c.kwh, 1) + " kWh", color: Theme.good)
                    KeyValue("Charging for", Format.duration(c.minutes))
                    if let s = c.socStart { KeyValue("Started at", "\(Int(s.rounded()))%") }
                    KeyValue("Peak power", c.peakKw.map { Format.n($0, 1) + " kW" })
                    if let t = timeToTarget(snap.soc, power, settings) { KeyValue("To \(settings.alertHigh)%", t, color: Theme.aqua) }
                }
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }

        if state.mode == .driving, let d = state.currentDrive {
            VStack(spacing: 0) {
                SectionTitle("This drive")
                CardBox(glow: Theme.cyan) {
                    KeyValue("Distance", Format.distance(d.distanceKm, settings, decimals: 1))
                    KeyValue("Energy used", Format.n(d.kwh, 1) + " kWh")
                    KeyValue("Efficiency", Format.efficiency(d.whPerKm, settings), color: Theme.cyan)
                    KeyValue("Time", Format.duration(d.minutes))
                }
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }

        SectionTitle("Battery")
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Tile(label: "Pack voltage", value: snap.packV.map { Format.n($0, 1) + " V" }, accent: Theme.violet)
                Tile(label: "Current", value: snap.packA.map { Format.n($0, 1) + " A" }, accent: Theme.cyan)
            }
            HStack(spacing: 10) {
                Tile(label: "Battery temp", value: Format.temp(snap.tempAvg, settings),
                     caption: snap.tempMax.flatMap { Format.temp($0, settings) }.map { "max " + $0 }, accent: Theme.warn)
                Tile(label: "Cell spread", value: snap.cellSpread.map { "\(Int($0.rounded())) mV" },
                     caption: snap.cellSpread.map(balanceLabel), accent: Theme.aqua,
                     captionColor: snap.cellSpread.map(Theme.balanceColor) ?? Theme.dim)
            }
            HStack(spacing: 10) {
                Tile(label: "12V battery", value: snap.aux12v.map { Format.n($0, 2) + " V" },
                     caption: snap.aux12v.map { auxStatus($0) + (snap.aux12vSource.map { " · " + $0 } ?? "") },
                     accent: Theme.good, captionColor: auxColor(snap.aux12v))
                Tile(label: "Odometer", value: Format.distance(snap.odometerKm, settings),
                     caption: Format.efficiency(Format.whPerKm(car.history), settings).map { "avg " + $0 }, accent: Theme.violet)
            }
        }

        if let abrp = state.abrpStatus {
            Text("ABRP: " + abrp).font(.system(size: 12))
                .foregroundStyle(abrp.hasPrefix("Sent") ? Theme.dim : Theme.warn)
                .padding(.top, 8)
        }
        if state.status == .live || state.status == .reconnecting {
            GhostButton(title: state.status == .reconnecting ? "Stop reconnecting" : "Disconnect", color: Theme.dim) { car.disconnect() }
                .padding(.top, 16)
        }
    }

    private func pill(_ state: CarState) -> Pill {
        if state.status == .reconnecting { return Pill(text: "Reconnecting", color: Theme.warn, pulse: true) }
        if state.status != .live {
            let last = state.lastUpdate.map { "Last seen " + Format.date($0).formatted(date: .omitted, time: .shortened) } ?? "Offline"
            return Pill(text: last, color: Theme.dim)
        }
        if state.mode == .charging {
            return Pill(text: state.currentCharge?.fast == true ? "DC fast charging" : "Charging", color: Theme.good, pulse: true)
        }
        if state.mode == .driving { return Pill(text: "Driving", color: Theme.cyan, pulse: true) }
        return Pill(text: "Parked · live", color: Theme.aqua)
    }

    private func powerColor(_ p: Double?) -> Color {
        guard let p else { return Theme.dim }
        return p > 0.3 ? Theme.good : p < -0.3 ? Theme.cyan : Theme.dim
    }

    private func powerLabel(_ p: Double?, charging: Bool) -> String {
        guard let p else { return "power" }
        if p > 0.3 { return charging ? "into the battery" : "regenerating" }
        if p < -0.3 { return "from the battery" }
        return "idle"
    }

    private func auxColor(_ v: Double?) -> Color {
        guard let v else { return Theme.dim }
        return v < 12.0 ? Theme.bad : v < 12.4 ? Theme.warn : Theme.dim
    }

    private func timeToTarget(_ soc: Double?, _ powerKw: Double?, _ s: Settings) -> String? {
        guard let soc, let powerKw, powerKw >= 0.5, soc < Double(s.alertHigh), s.usableKwh > 0 else { return nil }
        let kwh = (Double(s.alertHigh) - soc) / 100 * s.usableKwh
        return "≈ " + Format.duration(Int64((kwh / powerKw * 60).rounded()))
    }
}

private struct StartCard: View {
    @EnvironmentObject var car: Car

    var body: some View {
        CardBox {
            Text("Connect to your Ocean").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
            Text("Plug a Bluetooth LE OBD adapter into the car, turn the car on, then connect.")
                .foregroundStyle(Theme.dim).padding(.top, 6)
            if let m = car.state.message {
                Text(m).foregroundStyle(Theme.bad).padding(.top, 10)
            }
            VStack(spacing: 10) {
                if car.settings.adapterId != nil {
                    GradientButton(title: "Connect to \(car.settings.adapterName ?? "adapter")") { car.connectSaved() }
                    GhostButton(title: "Choose a different adapter") { car.scan() }
                } else {
                    GradientButton(title: "Find adapter") { car.scan() }
                }
            }
            .padding(.top, 18)
        }
        .padding(.top, 24)
    }
}

private struct Connecting: View {
    let name: String?

    var body: some View {
        VStack(spacing: 8) {
            ProgressView().controlSize(.large).tint(Theme.aqua)
            Text("Connecting to \(name ?? "adapter")").font(.system(size: 17)).foregroundStyle(.white).padding(.top, 8)
            Text("Setting up the adapter and waking the car's modules")
                .font(.system(size: 13)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 90)
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
