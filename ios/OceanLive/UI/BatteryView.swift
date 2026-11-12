import SwiftUI

struct BatteryView: View {
    @EnvironmentObject var car: Car
    @State private var showV12 = false

    var body: some View {
        Page {
            let s = car.state.snapshot
            let settings = car.settings
            let history = car.history

            SectionTitle("Battery health")
            CardBox {
                let measured = measuredCapacityKwh(history)
                let rated = settings.usableKwh
                let samples = history.filter { $0.impliedCapacityKwh != nil }.count
                if let measured, rated > 0 {
                    let pct = measured / rated * 100
                    HStack {
                        Text("Measured capacity").foregroundStyle(Theme.dim)
                        Spacer()
                        RollingText(text: "\(Int(pct.rounded()))%", size: 22, weight: .bold)
                    }
                    MeterBar(fraction: pct / 100, gradient: LinearGradient(colors: [Theme.violet, Theme.cyan, Theme.aqua], startPoint: .leading, endPoint: .trailing))
                        .padding(.vertical, 8)
                    KeyValue("Usable now", Format.n(measured, 1) + " kWh")
                    KeyValue("Rated usable", Format.n(rated, 1) + " kWh")
                    Text("From \(samples) charging session\(samples == 1 ? "" : "s"). Each charge that adds 20% or more is measured at the battery.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
                } else {
                    Text("Not measured yet").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    Text("The car doesn't report battery health directly. Ocean Live works it out from your charging: keep the app connected through a charge that adds at least 20%.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.top, 4)
                }
            }

            let drains = car.drains
            if let avg = averageDrainPerDay(drains), let last = drains.last {
                SectionTitle("Parked drain")
                CardBox {
                    HStack {
                        Text("Average per day").foregroundStyle(Theme.dim)
                        Spacer()
                        RollingText(text: Format.n(avg, 1) + "%", size: 22, weight: .bold)
                    }
                    KeyValue("Energy per day", settings.usableKwh > 0 ? Format.n(avg / 100 * settings.usableKwh, 1) + " kWh" : nil,
                             color: Theme.violet)
                        .padding(.top, 6)
                    KeyValue("Last time", Format.drain(last, settings))
                    Text("From \(drains.count) time\(drains.count == 1 ? "" : "s") the car sat parked for 30 minutes or more while the app wasn't connected. Longer waits give steadier numbers.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
                }
            }

            Group {
                SectionTitle("12V battery")
                Button { showV12 = true } label: { V12Card() }
                    .buttonStyle(PressStyle())
            }

            SectionTitle("Cells")
            CardBox {
                KeyValue("Highest", s.cellMax.map { "\(Int($0.rounded())) mV" })
                KeyValue("Average", s.cellAvg.map { "\(Int($0.rounded())) mV" })
                KeyValue("Lowest", s.cellMin.map { "\(Int($0.rounded())) mV" })
                if let spread = s.cellSpread {
                    HStack {
                        Text("Spread").foregroundStyle(Theme.dim)
                        Spacer()
                        Text("\(Int(spread.rounded())) mV · \(balanceLabel(spread))")
                            .fontWeight(.semibold).foregroundStyle(Theme.balanceColor(spread))
                    }
                    .padding(.top, 8)
                    MeterBar(fraction: spread / 150, gradient: LinearGradient(colors: [Theme.good, Theme.warn, Theme.bad], startPoint: .leading, endPoint: .trailing))
                        .padding(.top, 8)
                    Text("Under 60 mV is normal. A spread that keeps growing over weeks is worth a dealer check.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 8)
                }
            }

            SectionTitle("Temperatures")
            CardBox {
                KeyValue("Battery highest", Format.temp(s.tempMax, settings))
                KeyValue("Battery average", Format.temp(s.tempAvg, settings))
                KeyValue("Battery lowest", Format.temp(s.tempMin, settings))
                KeyValue("Coolant in", Format.temp(s.coolantIn, settings))
                KeyValue("Coolant out", Format.temp(s.coolantOut, settings))
                if let t = s.tempAvg {
                    Text(tempAdvice(t)).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 8)
                }
            }

            SectionTitle("High voltage")
            CardBox {
                KeyValue("Pack voltage", s.packV.map { Format.n($0, 1) + " V" })
                KeyValue("Pack current", s.packA.map { Format.n($0, 1) + " A" })
                KeyValue("Power", s.powerKw.map { Format.n($0, 2) + " kW" })
                KeyValue("Isolation resistance", s.isolation.map { "\(Int($0.rounded())) kΩ" })
                Button { showV12 = true } label: {
                    KeyValue("12V battery", s.aux12v.map { Format.n($0, 2) + " V" + (s.aux12vSource.map { " (\($0))" } ?? "") })
                }
                .buttonStyle(PressStyle())
                if let vin = car.state.vin { KeyValue("VIN", vin) }
            }

            let charges = history.filter { $0.kind == .Charge }
            // Grouped so the page stays within the view builder's child limit.
            Group {
                if !charges.isEmpty {
                    SectionTitle("Charging totals")
                    CardBox {
                        KeyValue("Sessions", "\(charges.count)")
                        KeyValue("Energy added", Format.n(charges.reduce(0) { $0 + $1.kwh }, 0) + " kWh")
                        KeyValue("DC fast sessions", "\(charges.filter { $0.fast }.count)")
                    }
                }

                SectionTitle("Report")
                CardBox {
                    Text("A one-page PDF of everything above plus your latest fault scan, to keep or send to a buyer or shop. It uses what the app already has and doesn't read from the car.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim)
                    // Built from what the app already has. Sharing never asks the car for anything.
                    let report = BatteryReport.make(now: Int64(Date().timeIntervalSince1970 * 1000), vin: car.state.vin,
                                                    snapshot: s, settings: settings, history: history, drains: drains,
                                                    scans: car.pastScans)
                    ShareLink(item: report, preview: SharePreview(report.title, image: Image(systemName: "doc.richtext"))) {
                        Text("Share battery report")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.aqua.opacity(0.4), lineWidth: 1))
                    }
                    .buttonStyle(PressStyle())
                    .padding(.top, 12)
                }
            }
        }
        .sheet(isPresented: $showV12) { V12View().environmentObject(car) }
    }
}

/// The 12V card on the Battery screen: latest and resting voltage. Tapping it opens the 12V screen.
private struct V12Card: View {
    @EnvironmentObject var car: Car

    var body: some View {
        let s = car.state.snapshot
        let resting = car.v12.last { $0.resting }
        CardBox(glow: car.state.watching ? Theme.violet : nil) {
            HStack {
                Text("Now").foregroundStyle(Theme.dim)
                Spacer()
                RollingText(text: s.aux12v.map { Format.n($0, 2) + " V" } ?? "—",
                            color: s.aux12v.map(v12StatusColor) ?? .white, size: 22, weight: .bold)
            }
            KeyValue("Resting", resting.map { Format.n($0.volts, 2) + " V · " + V12Log.status($0.volts) },
                     color: resting.map { v12StatusColor($0.volts) } ?? .white)
            if car.state.watching {
                Text(V12Watch.statusText).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.violet)
            }
            HStack {
                Text(car.v12.isEmpty ? "No saved readings yet" : "Graph, nights and sharing")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.aqua)
            }
            .padding(.top, 6)
        }
    }
}
