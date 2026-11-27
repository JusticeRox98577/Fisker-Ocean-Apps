import SwiftUI

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

/// The Nova page: pair this iPhone with the code from the car screen, then lock, unlock and climate.
struct NovaView: View {
    let onBack: () -> Void
    @StateObject private var phone = NovaPhone.shared
    @State private var code = ""
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").foregroundStyle(Theme.aqua)
                }
                .frame(minHeight: 44)
                Text("Nova").font(.system(size: 24, weight: .bold)).foregroundStyle(.white).accessibilityAddTraits(.isHeader)
                SectionTitle(String(localized: "SuperNova"))
                CardBox {
                    VStack(alignment: .leading, spacing: 10) {
                        if !phone.paired { pairing } else { controls }
                        if let message { Text(message).font(.system(size: 13)).foregroundStyle(Theme.dim) }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
            .frame(maxWidth: 720)
        }
        .background(Theme.background.ignoresSafeArea())
        .task(id: phone.paired) { if phone.paired { await run { try await phone.refresh() } } }
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

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let s = phone.status, let seen = s.lastSeen {
                Text("Car last seen \(seen.formatted(date: .abbreviated, time: .shortened))").font(.system(size: 14)).foregroundStyle(.white)
                if s.v12mV > 0 {
                    Text("12 V battery: \(String(format: "%.1f V", Double(s.v12mV) / 1000))").font(.system(size: 14)).foregroundStyle(.white)
                }
                if let r = s.lastResult { Text(resultText(r)).font(.system(size: 14)).foregroundStyle(.white) }
            }
            HStack(spacing: 8) {
                GradientButton(title: String(localized: "Lock")) { send(NovaCommands.lock) }
                GhostButton(title: String(localized: "Unlock")) { send(NovaCommands.unlock) }
            }
            HStack(spacing: 8) {
                GhostButton(title: String(localized: "Climate on")) { send(NovaCommands.climateOn) }
                GhostButton(title: String(localized: "Climate off")) { send(NovaCommands.climateOff) }
            }
            GhostButton(title: String(localized: "Forget this car"), color: Theme.dim) { phone.forget() }
        }
    }

    private func resultText(_ r: Int) -> String {
        if r == 0 { return String(localized: "Last command: done") }
        let why: String
        switch r {
        case 1: why = String(localized: "not in Park")
        case 2: why = String(localized: "12 V battery too low")
        case 3: why = String(localized: "not set up for this car yet")
        default: why = String(localized: "the car refused it")
        }
        return String(localized: "Last command: refused (\(why))")
    }

    private func send(_ action: Int) {
        Task {
            if await run({ try await phone.send(action) }) {
                message = String(localized: "Sent. The car acts on it at its next check-in.")
            }
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
