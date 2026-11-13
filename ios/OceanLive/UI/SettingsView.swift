import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var car: Car
    @State private var customKwh = ""
    @State private var homePrice = ""
    @State private var dcPrice = ""

    var body: some View {
        Page {
            let s = car.settings

            SectionTitle("Car")
            CardBox {
                VStack(spacing: 8) {
                    ForEach(CarModel.allCases) { m in
                        let selected = s.model == m
                        Button { car.updateSettings { $0.model = m } } label: {
                            Text(m.label + (m.usableKwh > 0 ? " · \(Format.n(m.usableKwh, 1)) kWh" : ""))
                                .font(.system(size: 15, weight: selected ? .semibold : .regular))
                                .foregroundStyle(selected ? Theme.aqua : .white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(selected ? Theme.aqua.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Theme.aqua.opacity(0.6) : Theme.edge, lineWidth: 1))
                        }
                        .buttonStyle(PressStyle())
                    }
                }
                if s.model == .custom {
                    Field(label: "Usable battery in kWh", text: $customKwh, keyboard: .decimalPad)
                        .onAppear { customKwh = Format.n(s.customKwh, 1) }
                        .onChange(of: customKwh) { _, v in
                            if let d = Double(v.replacingOccurrences(of: ",", with: ".")), (20...200).contains(d) {
                                car.updateSettings { $0.customKwh = d }
                            }
                        }
                        .padding(.top, 8)
                }
                Note("Published usable capacity: 106.5 kWh for One, Extreme and Ultra, about 75 kWh for the Sport. Used for range and charge-time estimates.")
            }

            SectionTitle("Charging cost")
            CardBox {
                Field(label: "Currency symbol", text: binding(\.currency))
                Field(label: "Home price per kWh", text: $homePrice, keyboard: .decimalPad)
                    .onAppear { homePrice = s.homePrice > 0 ? String(s.homePrice) : "" }
                    .onChange(of: homePrice) { _, v in
                        if let d = Self.price(v) { car.updateSettings { $0.homePrice = d } }
                    }
                Field(label: "DC fast price per kWh", text: $dcPrice, keyboard: .decimalPad)
                    .onAppear { dcPrice = s.dcPrice > 0 ? String(s.dcPrice) : "" }
                    .onChange(of: dcPrice) { _, v in
                        if let d = Self.price(v) { car.updateSettings { $0.dcPrice = d } }
                    }
                Note("Shows what each charge cost in Trips, using these prices. Leave a price empty to hide costs for that kind of charge.")
            }

            SectionTitle("Units and screen")
            CardBox {
                ToggleRow(label: "Use miles", value: s.useMiles) { v in car.updateSettings { $0.useMiles = v } }
                ToggleRow(label: "Use Fahrenheit", value: s.useFahrenheit) { v in car.updateSettings { $0.useFahrenheit = v } }
                ToggleRow(label: "Keep the screen on while connected", value: s.keepScreenOn) { v in car.updateSettings { $0.keepScreenOn = v } }
            }

            SectionTitle("Adapter")
            CardBox {
                ToggleRow(label: "Connect automatically when the app opens", value: s.autoStart) { v in car.updateSettings { $0.autoStart = v } }
                Note(s.adapterName.map { "Saved adapter: \($0)" } ?? "No saved adapter yet.")
                if s.adapterId != nil {
                    Button("Forget saved adapter") { car.forgetAdapter() }.foregroundStyle(Theme.bad).padding(.top, 8)
                }
            }

            SectionTitle("12V battery")
            CardBox {
                ToggleRow(label: "Watch 12V while the car sleeps", value: s.v12Watch) { v in
                    // The low-12V warning while the car sleeps needs notifications.
                    if v && s.healthAlerts { Alerts.requestPermission() }
                    car.updateSettings { $0.v12Watch = v }
                }
                Note(V12Watch.settingNote)
                Note(V12Watch.iPhoneNote)
                if s.v12Watch {
                    Text("Check every").font(.system(size: 15)).foregroundStyle(.white).padding(.top, 12)
                    HStack(spacing: 8) {
                        ForEach(V12Watch.intervals, id: \.self) { m in
                            let selected = s.v12WatchMinutes == m
                            Button { car.updateSettings { $0.v12WatchMinutes = m } } label: {
                                Text("\(m) min")
                                    .font(.system(size: 14, weight: selected ? .semibold : .regular))
                                    .foregroundStyle(selected ? Theme.aqua : .white)
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .background(selected ? Theme.aqua.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Theme.aqua.opacity(0.6) : Theme.edge, lineWidth: 1))
                            }
                            .buttonStyle(PressStyle())
                        }
                    }
                    .padding(.top, 6)
                    .animation(.snappy, value: s.v12WatchMinutes)
                    Note("Shorter means more readings, but the adapter stays busier.")
                    Note("With Battery warnings on, you get a notification when the 12V drops below 12.2 V while the car sleeps, and again below 11.8 V.")
                }
            }

            SectionTitle("Alerts")
            CardBox {
                ToggleRow(label: "Charge alerts", value: s.alertsOn) { v in
                    if v { Alerts.requestPermission() }
                    car.updateSettings { $0.alertsOn = v }
                }
                if s.alertsOn {
                    SliderRow(label: "Notify when charging reaches", value: s.alertHigh, range: 50...100) { v in car.updateSettings { $0.alertHigh = v } }
                    SliderRow(label: "Notify when charge drops to", value: s.alertLow, range: 5...50) { v in car.updateSettings { $0.alertLow = v } }
                    ToggleRow(label: "Notify when charging stops", value: s.alertStop) { v in car.updateSettings { $0.alertStop = v } }
                }
                ToggleRow(label: "Battery warnings (12V low, uneven cells, hot pack)", value: s.healthAlerts) { v in
                    if v { Alerts.requestPermission() }
                    car.updateSettings { $0.healthAlerts = v }
                }
                Note("Alerts work while the app is open or connected in the background. iPhone may pause the connection when the app has been in the background for a long time.")
            }

            SectionTitle("ABRP")
            CardBox {
                Field(label: "ABRP generic token", text: binding(\.abrpToken), secret: true)
                Field(label: "Telemetry API key", text: binding(\.abrpKey), secret: true)
                if s.abrpToken.isEmpty != s.abrpKey.isEmpty {
                    Text("Both the token and the API key are needed to send to ABRP.").font(.system(size: 12)).foregroundStyle(Theme.warn)
                }
                SliderRow(label: "Send every", value: s.abrpEverySec, range: 5...60, suffix: " sec") { v in car.updateSettings { $0.abrpEverySec = v } }
                ToggleRow(label: "Include phone location", value: s.abrpLocation) { v in car.updateSettings { $0.abrpLocation = v } }
                Note("Leave both empty to keep everything on your phone. In ABRP open your car, choose Live data, then Generic to get the token. The API key is a free telemetry key from abetterrouteplanner.com/resources/api. This is the only thing Ocean Live ever sends over the internet.")
            }

            SectionTitle("Advanced")
            CardBox {
                ToggleRow(label: "Flip current sign", value: s.flipCurrent) { v in car.updateSettings { $0.flipCurrent = v } }
                Note("Turn on only if charging shows as using power on your car.")
            }

            Text("Ocean Live 3.2 · unofficial community app. It only reads from the car, except when you clear fault codes or restart a module from the Faults tab.")
                .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 18)
        }
    }

    /// A typed price, or nil while it isn't a valid number. Empty means not set.
    static func price(_ text: String) -> Double? {
        let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if t.isEmpty { return 0 }
        guard let d = Double(t), (0...100).contains(d) else { return nil }
        return d
    }

    private func binding(_ key: WritableKeyPath<Settings, String>) -> Binding<String> {
        Binding(get: { car.settings[keyPath: key] }, set: { v in car.updateSettings { $0[keyPath: key] = v } })
    }
}

private struct Note: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ToggleRow: View {
    let label: String
    let value: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { value }, set: { onChange($0) })) {
            Text(label).font(.system(size: 15)).foregroundStyle(.white)
        }
        .tint(Theme.aqua)
        .padding(.vertical, 6)
    }
}

private struct SliderRow: View {
    let label: String
    let value: Int
    let range: ClosedRange<Int>
    var suffix = "%"
    let onChange: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label).font(.system(size: 15)).foregroundStyle(.white)
                Spacer()
                RollingText(text: "\(value)\(suffix)", color: Theme.aqua, size: 15)
            }
            Slider(value: Binding(get: { Double(value) }, set: { onChange(Int($0.rounded())) }),
                   in: Double(range.lowerBound)...Double(range.upperBound), step: 1)
                .tint(Theme.aqua)
        }
        .padding(.vertical, 4)
    }
}

private struct Field: View {
    let label: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var secret = false

    var body: some View {
        Group {
            if secret {
                SecureField(label, text: $text)
            } else {
                TextField(label, text: $text).keyboardType(keyboard)
            }
        }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .foregroundStyle(.white)
        .padding(12)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.edge, lineWidth: 1))
        .padding(.vertical, 4)
    }
}
