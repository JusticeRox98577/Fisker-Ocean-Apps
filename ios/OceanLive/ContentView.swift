import SwiftUI

private let aqua = Color(red: 0x4F / 255, green: 0xD1 / 255, blue: 0xC5 / 255)
private let card = Color(red: 0x14 / 255, green: 0x20 / 255, blue: 0x2B / 255)
private let dim = Color(red: 0x8A / 255, green: 0x9B / 255, blue: 0xA8 / 255)
private let background = Color(red: 0x0B / 255, green: 0x12 / 255, blue: 0x18 / 255)

struct ContentView: View {
    @StateObject private var monitor = Monitor()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Ocean Live").font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
                Text("Bluetooth only · no account · v3.0").font(.footnote).foregroundStyle(dim)
                Spacer().frame(height: 20)

                switch monitor.status {
                case .live: LiveView(monitor: monitor)
                case .connecting:
                    VStack(spacing: 12) {
                        ProgressView().tint(aqua)
                        Text("Connecting to adapter…").foregroundStyle(dim)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                case .scanning: ScanView(monitor: monitor)
                case .idle, .error: StartView(monitor: monitor)
                }
            }
            .padding(20)
        }
        .background(background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .tint(aqua)
    }
}

private struct StartView: View {
    @ObservedObject var monitor: Monitor

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Plug a Bluetooth LE OBD adapter into the car, turn the car on, then connect.")
                .foregroundStyle(dim)
            if let message = monitor.message {
                Text(message).foregroundStyle(Color(red: 1, green: 0.54, blue: 0.5))
            }
            Spacer().frame(height: 8)
            if let id = monitor.savedID {
                Button {
                    monitor.connect(id: id, name: monitor.savedName ?? "Adapter")
                } label: {
                    Text("Connect to \(monitor.savedName ?? "saved adapter")").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                Button { monitor.scan() } label: {
                    Text("Choose a different adapter").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                Button("Forget saved adapter") { monitor.forgetAdapter() }
                    .foregroundStyle(dim)
            } else {
                Button { monitor.scan() } label: {
                    Text("Find adapter").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
    }
}

private struct ScanView: View {
    @ObservedObject var monitor: Monitor

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                ProgressView().tint(aqua)
                Text("Looking for adapters…").foregroundStyle(dim)
                Spacer()
                Button("Cancel") { monitor.disconnect() }
            }
            ForEach(monitor.found) { adapter in
                Button {
                    monitor.connect(id: adapter.id, name: adapter.name)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(adapter.name).fontWeight(.semibold).foregroundStyle(.white)
                        Text("\(adapter.rssi) dBm").font(.caption).foregroundStyle(dim)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(card, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }
}

private struct LiveView: View {
    @ObservedObject var monitor: Monitor

    var body: some View {
        let v = monitor.values
        VStack(spacing: 10) {
            VStack(spacing: 0) {
                Text("State of charge").foregroundStyle(dim)
                Text(v["soc"].map { fmt($0, 1) + "%" } ?? "—")
                    .font(.system(size: 56, weight: .bold))
                    .foregroundStyle(aqua)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 6)

            HStack(spacing: 10) {
                Tile(label: "Pack voltage", value: v["voltage"].map { fmt($0, 1) + " V" })
                Tile(label: "Current", value: v["current"].map { fmt($0, 1) + " A" })
            }
            HStack(spacing: 10) {
                Tile(label: "Power", value: v["power"].map { fmt($0, 1) + " kW" })
                Tile(label: "Battery temp", value: v["batt_temp"].map { fmt($0, 0) + " °C / " + fmt($0 * 9 / 5 + 32, 0) + " °F" })
            }
            HStack(spacing: 10) {
                if let lo = v["cell_min"], let hi = v["cell_max"] {
                    Tile(label: "Cells min / max", value: "\(fmt(lo, 0)) / \(fmt(hi, 0)) mV", caption: "Spread \(fmt(hi - lo, 0)) mV")
                } else {
                    Tile(label: "Cells min / max", value: nil)
                }
                Tile(
                    label: "12V battery",
                    value: v["aux_voltage"].map { fmt($0, 2) + " V" },
                    caption: v["aux_voltage"].map { auxStatus($0) + (monitor.auxSource.map { " · \($0)" } ?? "") }
                )
            }

            Text(monitor.lastUpdate.map { "Updated \($0.formatted(date: .omitted, time: .standard))" } ?? "Waiting for data…")
                .font(.caption)
                .foregroundStyle(dim)
                .padding(.top, 6)

            Button { monitor.disconnect() } label: {
                Text("Disconnect").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .padding(.top, 6)
        }
    }
}

private struct Tile: View {
    let label: String
    let value: String?
    var caption: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.footnote).foregroundStyle(dim)
            Text(value ?? "—").font(.system(size: 22, weight: .semibold)).foregroundStyle(.white)
                .minimumScaleFactor(0.6).lineLimit(1)
            if let caption { Text(caption).font(.caption).foregroundStyle(dim) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(card, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Rough reading of a 12V voltage. Above about 13.2 V the car's DC-DC converter is charging it.
private func auxStatus(_ volts: Double) -> String {
    switch volts {
    case 13.2...: return "Charging"
    case 12.4...: return "Good"
    case 12.0...: return "Low"
    default: return "Very low, charge soon"
    }
}

private func fmt(_ value: Double, _ decimals: Int) -> String {
    String(format: "%.\(decimals)f", locale: Locale(identifier: "en_US"), value)
}
