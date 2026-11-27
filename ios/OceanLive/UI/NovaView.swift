import MapKit
import SwiftUI
import UIKit

/// What the app opens on: the OBD dashboard, or Nova. Same as the Android app's StartScreen.
struct StartView: View {
    let onObd: () -> Void
    let onNova: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(verbatim: "Ocean Live")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                choice("bolt.circle", String(localized: "OBD"),
                       String(localized: "Live data, battery, trips and fault codes through your OBD adapter."), onObd)
                choice("sparkles", String(localized: "Nova"),
                       String(localized: "Your Nova: lock, unlock and climate from your phone, and your car's status."), onNova)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 24)
            .frame(maxWidth: 720)
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func choice(_ symbol: String, _ title: String, _ text: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            CardBox {
                HStack(spacing: 16) {
                    Image(systemName: symbol).font(.system(size: 30)).foregroundStyle(Theme.aqua)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
                        Text(text).font(.system(size: 14)).foregroundStyle(Theme.dim).multilineTextAlignment(.leading)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(Theme.aqua)
                }
            }
        }
        .buttonStyle(PressStyle())
    }
}
/// The Nova page. Before pairing: the code from the car screen. After: a dashboard of the car's last
/// check-in (state, 12 V, signal, where it is) with the remote controls and what was sent lately.
struct NovaView: View {
    let onBack: () -> Void
    @EnvironmentObject var car: Car
    @StateObject private var phone = NovaPhone.shared
    @State private var code = ""
    @State private var message: String?
    @State private var sending: Int?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").foregroundStyle(Theme.aqua)
                }
                .frame(minHeight: 44)
                Text("Nova").font(.system(size: 24, weight: .bold)).foregroundStyle(.white).accessibilityAddTraits(.isHeader)
                if phone.paired {
                    dashboard
                } else {
                    SectionTitle(String(localized: "SuperNova"))
                    CardBox {
                        VStack(alignment: .leading, spacing: 10) {
                            pairing
                            if let message { Text(message).font(.system(size: 13)).foregroundStyle(Theme.dim) }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
            .frame(maxWidth: readableWidth)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background.ignoresSafeArea())
        .refreshable { if phone.paired { await run { try await phone.refresh() } } }
        // while paired and on screen: the car's state every 15 seconds
        .task(id: phone.paired) {
            while phone.paired && !Task.isCancelled {
                await run { try await phone.refresh() }
                try? await Task.sleep(for: .seconds(15))
            }
        }
        // while a code is pending (also after leaving the page or the app), ask every 2 seconds
        .task(id: phone.pendingCode) {
            while phone.pendingCode != nil && !Task.isCancelled {
                switch (try? await phone.pairingStatus()) ?? "" {
                case "paired": message = nil
                case "refused": message = String(localized: "Pairing was refused in the car.")
                case "expired": message = String(localized: "That code has expired. Start again on the car screen.")
                default: break
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    // MARK: pairing

    private var pairing: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lock, unlock and run the climate from this phone. First pair it in the car: on the car screen, Settings → This Nova → Pair a phone shows a code.")
                .font(.system(size: 14)).foregroundStyle(.white)
            TextField(String(localized: "Code from the car screen"), text: $code)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.system(size: 20, design: .monospaced))
                .padding(12)
                .background(Theme.track, in: RoundedRectangle(cornerRadius: 12))
            if phone.pendingCode == nil {
                GradientButton(title: String(localized: "Pair this phone"),
                               enabled: code.filter { $0.isLetter || $0.isNumber }.count == 8) {
                    Task {
                        if await run({ try await phone.requestPairing(code: code) }) { message = nil }
                    }
                }
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.aqua)
                    Text("Waiting for approval on the car screen…").font(.system(size: 14)).foregroundStyle(.white)
                }
                GhostButton(title: String(localized: "Cancel"), color: Theme.dim) { phone.cancelPairing() }
            }
        }
    }

    // MARK: dashboard

    @ViewBuilder private var dashboard: some View {
        let s = phone.status
        hero(s)
        if let message {
            Text(message).font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.horizontal, 4)
        }
        SectionTitle(String(localized: "Controls"))
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            control(NovaCommands.lock, "lock.fill", String(localized: "Lock"))
            control(NovaCommands.unlock, "lock.open.fill", String(localized: "Unlock"))
            control(NovaCommands.climateOn, "fan.fill", String(localized: "Climate on"))
            control(NovaCommands.climateOff, "power", String(localized: "Climate off"))
        }
        control(NovaCommands.lights, "light.beacon.max.fill", String(localized: "Flash the lights"), wide: true)
        Text("The car acts on a command at its next check-in, usually within a minute. It only acts while parked, with a healthy 12 V battery.")
            .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.horizontal, 4)

        SectionTitle(String(localized: "Car"))
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            v12Tile(s)
            signalTile(s)
            Tile(label: String(localized: "Speed"), value: s.flatMap { $0.lastSeen == nil ? nil : speed($0.speedKmh) },
                 caption: s.map { gearText($0.gear) }, accent: Theme.violet)
            Tile(label: String(localized: "Phones paired"), value: s.flatMap { $0.lastSeen == nil ? nil : "\($0.phones) / 4" },
                 caption: String(localized: "This one is slot \(phone.slot + 1)"), accent: Theme.cyan)
        }
        locationCard(s)
        activityCard(s)

        SectionTitle(String(localized: "This Nova"))
        CardBox {
            KeyValue(String(localized: "Device ID"), phone.uid.map { String($0.suffix(8)).uppercased() })
            KeyValue(String(localized: "Firmware"), s.flatMap { $0.firmware > 0 ? "\($0.firmware)" : nil })
            GhostButton(title: String(localized: "Forget this car"), color: Theme.dim) { phone.forget() }
                .padding(.top, 8)
        }
    }

    /// Where the car is in words, with a pill for whether it's reachable right now.
    private func hero(_ s: NovaPhone.Status?) -> some View {
        let online = s?.online() ?? false
        let seen = s?.lastSeen
        return CardBox(glow: online ? Theme.aqua : nil) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your Ocean").font(.system(size: 13)).foregroundStyle(Theme.dim)
                    Text(headline(s)).font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    if let seen {
                        Text(online ? String(localized: "Checked in \(seen.formatted(.relative(presentation: .named)))")
                                    : String(localized: "Seen \(seen.formatted(.relative(presentation: .named)))"))
                            .font(.system(size: 13)).foregroundStyle(Theme.dim)
                    } else if s != nil {
                        Text("The Nova hasn't checked in yet. It does once it's in the car with signal.")
                            .font(.system(size: 13)).foregroundStyle(Theme.dim)
                    }
                }
                Spacer(minLength: 8)
                if s == nil {
                    ProgressView().tint(Theme.aqua)
                } else {
                    Pill(text: online ? String(localized: "Online") : String(localized: "Offline"),
                         color: online ? Theme.good : Theme.dim, pulse: online)
                }
            }
            Image(systemName: "car.side.fill")
                .font(.system(size: 54))
                .foregroundStyle(Theme.ocean)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.top, 4)
                .accessibilityHidden(true)
        }
    }

    private func headline(_ s: NovaPhone.Status?) -> String {
        guard let s else { return String(localized: "Checking…") }
        guard s.lastSeen != nil else { return String(localized: "Not connected yet") }
        if s.gear == 4 || s.gear == 2 || s.speedKmh > 1 { return String(localized: "Driving") }
        if s.gear == 1 { return s.ignition ? String(localized: "Parked, on") : String(localized: "Parked") }
        return s.ignition ? String(localized: "On") : String(localized: "Off")
    }

    private func gearText(_ g: Int) -> String {
        switch g {
        case 1: return String(localized: "In Park")
        case 2: return String(localized: "In Reverse")
        case 3: return String(localized: "In Neutral")
        case 4: return String(localized: "In Drive")
        default: return String(localized: "Gear unknown")
        }
    }

    private func speed(_ kmh: Double) -> String {
        car.settings.useMiles ? "\(Int((kmh / Format.kmPerMi).rounded())) mph" : "\(Int(kmh.rounded())) km/h"
    }

    private func v12Tile(_ s: NovaPhone.Status?) -> some View {
        let v = s.flatMap { $0.v12mV > 0 ? Double($0.v12mV) / 1000 : nil }
        let caption: String? = v.map { $0 >= V12Log.low ? String(localized: "Healthy") : $0 >= V12Log.veryLow ? String(localized: "Low") : String(localized: "Very low") }
        return Tile(label: String(localized: "12 V battery"), value: v.map { String(format: "%.1f V", $0) },
                    caption: caption, accent: v.map(v12StatusColor) ?? Theme.dim, captionColor: v.map(v12StatusColor) ?? Theme.dim)
    }

    private func signalTile(_ s: NovaPhone.Status?) -> some View {
        let r = s?.rsrp ?? 0
        let bars = r == 0 ? 0 : r >= -90 ? 4 : r >= -100 ? 3 : r >= -110 ? 2 : 1
        let words = [String(localized: "No signal"), String(localized: "Weak"), String(localized: "Fair"), String(localized: "Good"), String(localized: "Excellent")]
        return Tile(label: String(localized: "LTE signal"), value: s?.lastSeen == nil ? nil : words[bars],
                    caption: r == 0 ? nil : "\(r) dBm", accent: bars >= 3 ? Theme.good : bars == 2 ? Theme.warn : Theme.dim)
    }

    private func locationCard(_ s: NovaPhone.Status?) -> some View {
        CardBox {
            HStack {
                Text("Location").font(.system(size: 12)).foregroundStyle(Theme.dim)
                Spacer()
                if let l = s?.location {
                    Button {
                        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: l.lat, longitude: l.lon)))
                        item.name = String(localized: "Your Ocean")
                        item.openInMaps()
                    } label: {
                        Label("Open in Maps", systemImage: "arrow.up.right.square").font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(Theme.aqua)
                }
            }
            .padding(.bottom, 10)
            if let l = s?.location {
                let c = CLLocationCoordinate2D(latitude: l.lat, longitude: l.lon)
                Map(initialPosition: .region(MKCoordinateRegion(center: c, latitudinalMeters: 800, longitudinalMeters: 800)),
                    interactionModes: []) {
                    Marker(String(localized: "Your Ocean"), systemImage: "car.fill", coordinate: c).tint(Theme.aqua)
                }
                .id("\(l.lat),\(l.lon)")
                .frame(height: 190)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                Text("No GPS position yet. The Nova sends one when it has a fix.")
                    .font(.system(size: 14)).foregroundStyle(.white)
            }
        }
    }

    private func activityCard(_ s: NovaPhone.Status?) -> some View {
        let cmds = Array((s?.commands ?? []).prefix(5))
        return Group {
            SectionTitle(String(localized: "Recent commands"))
            CardBox {
                if cmds.isEmpty {
                    Text("Nothing sent yet.").font(.system(size: 14)).foregroundStyle(Theme.dim)
                }
                ForEach(Array(cmds.enumerated()), id: \.element.id) { i, c in
                    HStack(spacing: 12) {
                        Image(systemName: symbol(c.action)).frame(width: 24).foregroundStyle(Theme.aqua)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(actionName(c.action)).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                            Text(c.sent.formatted(.relative(presentation: .named))).font(.system(size: 12)).foregroundStyle(Theme.dim)
                        }
                        Spacer()
                        resultPill(c)
                    }
                    .padding(.vertical, 8)
                    if i < cmds.count - 1 { Divider().overlay(Theme.edge) }
                }
            }
        }
    }

    @ViewBuilder private func resultPill(_ c: NovaPhone.Status.Command) -> some View {
        switch c.result {
        case nil:
            if Date().timeIntervalSince(c.sent) > TimeInterval(NovaCommands.lifeSeconds) {
                Pill(text: String(localized: "Expired"), color: Theme.dim)
            } else {
                Pill(text: String(localized: "Waiting"), color: Theme.warn, pulse: true)
            }
        case 0?: Pill(text: String(localized: "Done"), color: Theme.good)
        case let r?: Pill(text: refusedWhy(r), color: Theme.bad)
        }
    }

    private func refusedWhy(_ r: Int) -> String {
        switch r {
        case 1: return String(localized: "Not in Park")
        case 2: return String(localized: "12 V too low")
        case 3: return String(localized: "Not set up yet")
        default: return String(localized: "Refused")
        }
    }

    private func actionName(_ a: Int) -> String {
        switch a {
        case NovaCommands.lock: return String(localized: "Lock")
        case NovaCommands.unlock: return String(localized: "Unlock")
        case NovaCommands.climateOn: return String(localized: "Climate on")
        case NovaCommands.climateOff: return String(localized: "Climate off")
        case NovaCommands.lights: return String(localized: "Flash the lights")
        default: return String(localized: "Command")
        }
    }

    private func symbol(_ a: Int) -> String {
        switch a {
        case NovaCommands.lock: return "lock.fill"
        case NovaCommands.unlock: return "lock.open.fill"
        case NovaCommands.climateOn: return "fan.fill"
        case NovaCommands.climateOff: return "power"
        case NovaCommands.lights: return "light.beacon.max.fill"
        default: return "paperplane.fill"
        }
    }

    /// A big square button for one remote command.
    private func control(_ action: Int, _ icon: String, _ title: String, wide: Bool = false) -> some View {
        Button {
            send(action)
        } label: {
            Group {
                if wide {
                    HStack(spacing: 12) {
                        Image(systemName: icon).font(.system(size: 22))
                        Text(title).font(.system(size: 15, weight: .semibold))
                        Spacer()
                        if sending == action { ProgressView().tint(Theme.aqua) }
                    }
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, minHeight: 56)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: icon).font(.system(size: 26))
                            Spacer()
                            if sending == action { ProgressView().tint(Theme.aqua) }
                        }
                        Text(title).font(.system(size: 15, weight: .semibold))
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
                }
            }
            .foregroundStyle(.white)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
        .disabled(sending != nil)
        .accessibilityLabel(title)
    }

    private func send(_ action: Int) {
        sending = action
        Task {
            if await run({ try await phone.send(action) }) {
                message = String(localized: "Sent. The car acts on it at its next check-in.")
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                await run { try await phone.refresh() }
            }
            sending = nil
        }
    }

    /// Runs a server call; shows its error and returns false if it fails.
    @discardableResult
    private func run(_ work: () async throws -> Void) async -> Bool {
        do {
            try await work()
            return true
        } catch {
            message = String(localized: "Couldn't reach the server: \(error.localizedDescription)")
            return false
        }
    }
}
