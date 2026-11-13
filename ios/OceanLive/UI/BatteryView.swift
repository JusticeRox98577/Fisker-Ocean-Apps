import SwiftUI

struct BatteryView: View {
    @EnvironmentObject var car: Car
    @State private var showV12 = false

    var body: some View {
        Page {
            let s = car.state.snapshot
            let settings = car.settings
            let history = car.history

            SectionTitle(String(localized: "Battery health"))
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
                    KeyValue(String(localized: "Usable now"), Format.n(measured, 1) + " kWh")
                    KeyValue(String(localized: "Rated usable"), Format.n(rated, 1) + " kWh")
                    Text(String(localized: "From \(samples) charging sessions.") + " " + BatteryReport.measuredNote)
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
                } else {
                    Text("Not measured yet").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    Text("The car doesn't report battery health directly. Ocean Live works it out from your charging: keep the app connected through a charge that adds at least \("20%").")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.top, 4)
                }
            }

            let drains = car.drains
            if let avg = averageDrainPerDay(drains), let last = drains.last {
                SectionTitle(String(localized: "Parked drain"))
                CardBox {
                    HStack {
                        Text("Average per day").foregroundStyle(Theme.dim)
                        Spacer()
                        RollingText(text: Format.n(avg, 1) + "%", size: 22, weight: .bold)
                    }
                    KeyValue(String(localized: "Energy per day"), settings.usableKwh > 0 ? Format.n(avg / 100 * settings.usableKwh, 1) + " kWh" : nil,
                             color: Theme.violet)
                        .padding(.top, 6)
                    KeyValue(String(localized: "Last time"), Format.drain(last, settings))
                    Text("From \(drains.count) times the car sat parked for 30 minutes or more while the app wasn't connected. Longer waits give steadier numbers.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
                }
            }

            Group {
                SectionTitle(String(localized: "12V battery"))
                Button { showV12 = true } label: { V12Card() }
                    .buttonStyle(PressStyle())
            }

            SectionTitle(String(localized: "Cells"))
            CardBox {
                KeyValue(String(localized: "Highest"), s.cellMax.map { "\(Int($0.rounded())) mV" })
                KeyValue(String(localized: "Average"), s.cellAvg.map { "\(Int($0.rounded())) mV" })
                KeyValue(String(localized: "Lowest"), s.cellMin.map { "\(Int($0.rounded())) mV" })
                if let spread = s.cellSpread {
                    HStack {
                        Text("Spread").foregroundStyle(Theme.dim)
                        Spacer()
                        Text(verbatim: "\(Int(spread.rounded())) mV · \(balanceLabel(spread))")
                            .fontWeight(.semibold).foregroundStyle(Theme.balanceColor(spread))
                    }
                    .padding(.top, 8)
                    MeterBar(fraction: spread / 150, gradient: LinearGradient(colors: [Theme.good, Theme.warn, Theme.bad], startPoint: .leading, endPoint: .trailing))
                        .padding(.top, 8)
                    Text("Under 60 mV is normal. A spread that keeps growing over weeks is worth a dealer check.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 8)
                }
            }

            SectionTitle(String(localized: "Temperatures"))
            CardBox {
                KeyValue(String(localized: "Battery highest"), Format.temp(s.tempMax, settings))
                KeyValue(String(localized: "Battery average"), Format.temp(s.tempAvg, settings))
                KeyValue(String(localized: "Battery lowest"), Format.temp(s.tempMin, settings))
                KeyValue(String(localized: "Coolant in"), Format.temp(s.coolantIn, settings))
                KeyValue(String(localized: "Coolant out"), Format.temp(s.coolantOut, settings))
                if let t = s.tempAvg {
                    Text(tempAdvice(t)).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 8)
                }
            }

            SectionTitle(String(localized: "High voltage"))
            CardBox {
                KeyValue(String(localized: "Pack voltage"), s.packV.map { Format.n($0, 1) + " V" })
                KeyValue(String(localized: "Pack current"), s.packA.map { Format.n($0, 1) + " A" })
                KeyValue(String(localized: "Power"), s.powerKw.map { Format.n($0, 2) + " kW" })
                KeyValue(String(localized: "Isolation resistance"), s.isolation.map { "\(Int($0.rounded())) kΩ" })
                Button { showV12 = true } label: {
                    KeyValue(String(localized: "12V battery"), s.aux12v.map { Format.n($0, 2) + " V" + (s.aux12vSource.map { " (\(V12Source.label($0)))" } ?? "") })
                }
                .buttonStyle(PressStyle())
                if let vin = car.state.vin { KeyValue(String(localized: "VIN"), vin) }
            }

            let charges = history.filter { $0.kind == .Charge }
            // Grouped so the page stays within the view builder's child limit.
            Group {
                if !charges.isEmpty {
                    SectionTitle(String(localized: "Charging totals"))
                    CardBox {
                        KeyValue(String(localized: "Sessions"), "\(charges.count)")
                        KeyValue(String(localized: "Energy added"), Format.n(charges.reduce(0) { $0 + $1.kwh }, 0) + " kWh")
                        KeyValue(String(localized: "DC fast sessions"), "\(charges.filter { $0.fast }.count)")
                    }
                }

                SectionTitle(String(localized: "Report"))
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
            KeyValue(String(localized: "Resting"), resting.map { Format.n($0.volts, 2) + " V · " + V12Log.status($0.volts) },
                     color: resting.map { v12StatusColor($0.volts) } ?? .white)
            if car.state.watching {
                Text(car.state.watchStatus).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.violet)
            }
            HStack {
                Text(car.v12.isEmpty ? String(localized: "No saved readings yet") : String(localized: "Graph, nights and sharing"))
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.aqua)
            }
            .padding(.top, 6)
        }
    }
}
