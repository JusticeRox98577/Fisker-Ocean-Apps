import Accessibility
import AuthenticationServices
import os
import SwiftUI

private let privacyURL = URL(string: "https://oceanlive.org/privacy")!
private let appleSignInLog = Logger(subsystem: "com.justice.OceanABRP", category: "SignInWithApple")

/// Shown instead of the app until the owner signs in. Signing in needs internet once; after that the
/// app works offline. Nothing here talks to the car.
@MainActor
struct SignInView: View {
    @StateObject private var accounts = Accounts.shared
    @State private var config: AuthConfig?
    @State private var loaded = false
    @State private var reload = 0
    @State private var busy: Action?
    @State private var problem: AuthProblem?
    @State private var email = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var resendAt = Date.distantPast
    @State private var appleNonce = ""
    /// Apple's error code from the last failed Sign in with Apple, shown small under the message so the owner
    /// can report it (there's no other way to see it without a Mac).
    @State private var appleErrorCode: Int?
    @FocusState private var focus: Field?

    private enum Action { case apple, google, send, verify }
    private enum Field: Hashable { case email, code }
    private static let resendSeconds: TimeInterval = 30

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    hero
                    methods.padding(.top, 28)
                    if let message = problem?.message {
                        Label(message, systemImage: "exclamationmark.circle.fill")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.bad)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 14)
                            .transition(.opacity)
                        if let appleErrorCode {
                            Text(verbatim: "Apple error \(appleErrorCode)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Theme.dim)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 4)
                                .textSelection(.enabled)
                        }
                    }
                    Spacer(minLength: 24)
                    footer
                }
                .frame(maxWidth: 460)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
        }
        .background(Theme.background.ignoresSafeArea())
        .animation(.easeInOut(duration: 0.25), value: codeSent)
        .animation(.easeInOut(duration: 0.2), value: problem)
        .onChange(of: problem) { _, new in
            if new != .failed { appleErrorCode = nil }
            announce(new?.message)
        }
        .task(id: reload) {
            loaded = false
            config = await accounts.config()
            loaded = true
        }
    }

    private var hero: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle().fill(Theme.ocean).frame(width: 76, height: 76)
                    .shadow(color: Theme.aqua.opacity(0.45), radius: 22)
                Image(systemName: "bolt.car.fill")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(Theme.ink)
            }
            .accessibilityHidden(true)
            .padding(.bottom, 8)
            Text(verbatim: "Ocean Live")
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Text("Sign in to continue")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.aqua)
            Text("An account keeps your AI questions, and later any AI balance, secure and tied to you, and lets you keep them when you change phones. Your car data stays on your phone. You only need internet to sign in; after that the app works offline.")
                .font(.subheadline)
                .foregroundStyle(Theme.dim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
    }

    @ViewBuilder private var methods: some View {
        if !loaded {
            ProgressView().tint(Theme.aqua).controlSize(.large).frame(minHeight: 120)
        } else if let c = config, c.anyMethod {
            VStack(spacing: 12) {
                if !codeSent {
                    if c.apple { appleButton }
                    if c.showsGoogle, let clientId = c.googleIosClientId { googleButton(clientId) }
                    if c.email && (c.apple || c.showsGoogle) { orDivider }
                }
                if c.email { emailForm }
            }
        } else {
            VStack(spacing: 14) {
                Label(config == nil ? AuthProblem.network.message ?? "" : String(localized: "Sign-in isn't available right now. Try again later."),
                      systemImage: config == nil ? "wifi.exclamationmark" : "clock")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                GhostButton(title: String(localized: "Try again")) { reload += 1 }
            }
        }
    }

    // MARK: Apple and Google

    private var appleButton: some View {
        SignInWithAppleButton(.signIn) { request in
            let nonce = AuthCrypto.randomURLSafe()
            appleNonce = nonce
            request.requestedScopes = [.fullName, .email]
            request.nonce = AuthCrypto.sha256Hex(nonce)
        } onCompletion: { result in
            appleErrorCode = nil
            switch result {
            case .success(let authorization):
                guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                    problem = .failed
                    return
                }
                let nonce = appleNonce
                run(.apple) { await accounts.signInWithApple(credential, nonce: nonce) }
            case .failure(let error):
                // Closing Apple's sheet is not an error.
                let code = (error as? ASAuthorizationError)?.code
                if code == .canceled { return }
                // Apple's own "Sign In Not Completed" sheet comes from here, before the server is called.
                // 1000 (unknown) usually means the App ID or provisioning profile lacks Sign in with Apple;
                // 1004 (failed) is Apple's side or the device's Apple ID. Logged so the cause shows in Console.
                appleSignInLog.error("Sign in with Apple failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code, privacy: .public)")
                appleErrorCode = (error as NSError).code
                problem = .failed
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .disabled(busy != nil)
        .opacity(busy != nil && busy != .apple ? 0.5 : 1)
        .overlay {
            if busy == .apple {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white)
                ProgressView().tint(.black)
            }
        }
    }

    /// Google's dark-theme button: #131314 fill, #8E918F border, #E3E3E3 text and the four-colour "G".
    private func googleButton(_ clientId: String) -> some View {
        Button {
            run(.google) { await accounts.signInWithGoogle(clientId: clientId) }
        } label: {
            HStack(spacing: 10) {
                if busy == .google {
                    ProgressView().tint(Color(hex: 0xE3E3E3)).frame(width: 20, height: 20)
                } else {
                    GoogleG().frame(width: 20, height: 20).accessibilityHidden(true)
                }
                Text("Sign in with Google")
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .foregroundStyle(Color(hex: 0xE3E3E3))
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Color(hex: 0x131314), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(hex: 0x8E918F), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .disabled(busy != nil)
        .opacity(busy != nil && busy != .google ? 0.5 : 1)
    }

    private var orDivider: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Theme.dim.opacity(0.3)).frame(height: 1)
            Text("or").font(.footnote.weight(.medium)).foregroundStyle(Theme.dim)
            Rectangle().fill(Theme.dim.opacity(0.3)).frame(height: 1)
        }
        .padding(.vertical, 6)
        .accessibilityHidden(true)
    }

    // MARK: Email code

    @ViewBuilder private var emailForm: some View {
        if !codeSent {
            VStack(alignment: .leading, spacing: 8) {
                Text("Email").font(.footnote.weight(.medium)).foregroundStyle(Theme.dim).accessibilityHidden(true)
                TextField("Email", text: $email, prompt: Text(verbatim: "name@example.com").foregroundStyle(Theme.dim.opacity(0.7)))
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .focused($focus, equals: .email)
                    .onSubmit(sendCode)
                    .onChange(of: email) { _, v in
                        if v.count > 254 { email = String(v.prefix(254)) }
                        if problem == .badEmail { problem = nil }
                    }
                    .authField(focused: focus == .email, invalid: problem == .badEmail)
                ActionButton(title: String(localized: "Email me a code"), busy: busy == .send,
                             enabled: busy == nil && !email.trimmingCharacters(in: .whitespaces).isEmpty,
                             primary: !(config?.apple ?? false) && !(config?.showsGoogle ?? false),
                             action: sendCode)
                    .padding(.top, 4)
            }
            .transition(.opacity)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("We sent a 6-digit code to \(email.trimmingCharacters(in: .whitespacesAndNewlines)). It works for 10 minutes.")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 4)
                Text("Code").font(.footnote.weight(.medium)).foregroundStyle(Theme.dim).accessibilityHidden(true)
                TextField("Code", text: $code, prompt: Text(verbatim: "123456").foregroundStyle(Theme.dim.opacity(0.5)))
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.system(.title2, design: .monospaced).weight(.semibold))
                    .focused($focus, equals: .code)
                    .onChange(of: code) { _, v in
                        let digits = String(v.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
                        if digits != v { code = digits; return }
                        if problem == .wrongCode { problem = nil }
                        // A pasted or autofilled code signs in straight away.
                        if digits.count == 6 { verify() }
                    }
                    .authField(focused: focus == .code, invalid: problem == .wrongCode || problem == .codeExpired)
                ActionButton(title: String(localized: "Sign in"), busy: busy == .verify,
                             enabled: busy == nil && code.count == 6, primary: true, action: verify)
                    .padding(.top, 4)
                HStack {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let left = Int(resendAt.timeIntervalSince(context.date).rounded(.up))
                        Button {
                            resend()
                        } label: {
                            Group {
                                if left > 0 { Text("Send a new code in \(left) s") } else { Text("Send a new code") }
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(left > 0 ? Theme.dim : Theme.aqua)
                            .frame(minHeight: 44)
                        }
                        .disabled(left > 0 || busy != nil)
                    }
                    Spacer(minLength: 12)
                    Button {
                        codeSent = false
                        code = ""
                        problem = nil
                        focus = .email
                    } label: {
                        Text("Use a different email").font(.subheadline).foregroundStyle(Theme.dim).frame(minHeight: 44)
                    }
                    .disabled(busy != nil)
                }
            }
            .transition(.opacity)
        }
    }

    private var footer: some View {
        VStack(spacing: 6) {
            Text("No password needed. The privacy policy explains what an account stores.")
                .font(.caption)
                .foregroundStyle(Theme.dim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Link(destination: privacyURL) {
                Text("Privacy policy").font(.footnote.weight(.semibold)).foregroundStyle(Theme.aqua)
                    .frame(minHeight: 44)
            }
        }
        .padding(.top, 8)
    }

    // MARK: Actions

    private func sendCode() {
        guard busy == nil else { return }
        guard AuthCrypto.validEmail(email) else {
            problem = .badEmail
            focus = .email
            return
        }
        run(.send, { await accounts.emailStart(email) }) {
            codeSent = true
            code = ""
            resendAt = Date().addingTimeInterval(Self.resendSeconds)
            focus = .code
        }
    }

    private func resend() {
        run(.send, { await accounts.emailStart(email) }) {
            code = ""
            resendAt = Date().addingTimeInterval(Self.resendSeconds)
            focus = .code
        }
    }

    private func verify() {
        guard code.count == 6 else { return }
        let entered = code
        run(.verify, { await accounts.emailVerify(email, code: entered) }) {}
        // On a wrong code, the field is cleared for the next try.
    }

    /// Runs one sign-in step at a time. Success needs no handling beyond `onOk`: a saved session
    /// swaps this screen for the app.
    private func run(_ action: Action, _ work: @escaping @MainActor () async -> AuthProblem?, onOk: @escaping @MainActor () -> Void = {}) {
        guard busy == nil else { return }
        busy = action
        problem = nil
        Task { @MainActor in
            let result = await work()
            busy = nil
            if let result {
                if result != .cancelled { problem = result }
                if action == .verify && result == .wrongCode { code = ""; focus = .code }
            } else {
                onOk()
            }
        }
    }
}

/// The Account card at the top of Settings: who is signed in, the name, sign out and delete.
@MainActor
struct AccountSection: View {
    @StateObject private var accounts = Accounts.shared
    @State private var name = ""
    @State private var busy = false
    /// What went wrong with the last rename or delete, in words for that action (not for signing in).
    @State private var problem: String?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @FocusState private var nameFocused: Bool

    private var savedName: String { accounts.account?.name ?? "" }
    private var nameChanged: Bool { name.trimmingCharacters(in: .whitespacesAndNewlines) != savedName }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(String(localized: "Account"))
            CardBox {
                HStack(spacing: 12) {
                    Text(initial)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 44, height: 44)
                        .background(Theme.ocean, in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        if let email = accounts.account?.email {
                            Text(verbatim: email).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                                .lineLimit(1).truncationMode(.middle)
                        }
                        if let providers = providerNames {
                            Text("Signed in with \(providers)").font(.footnote).foregroundStyle(Theme.dim)
                        }
                    }
                }
                .padding(.bottom, 12)

                Text("Name").font(.footnote.weight(.medium)).foregroundStyle(Theme.dim).padding(.bottom, 6).accessibilityHidden(true)
                TextField("Name", text: $name)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .onSubmit(saveName)
                    .onChange(of: name) { _, v in
                        if v.count > 60 { name = String(v.prefix(60)) }
                    }
                    .authField(focused: nameFocused, invalid: false)
                if nameChanged {
                    ActionButton(title: String(localized: "Save name"), busy: busy, enabled: !busy, primary: false, action: saveName)
                        .padding(.top, 8)
                        .transition(.opacity)
                }
                if let id = accounts.account?.id {
                    Text("Account ID: \(id)")
                        .font(.caption2)
                        .foregroundStyle(Theme.dim)
                        .textSelection(.enabled)
                        .padding(.top, 10)
                }
                if let message = problem {
                    Label(message, systemImage: "exclamationmark.circle.fill")
                        .font(.footnote).foregroundStyle(Theme.bad)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }

                Rectangle().fill(Theme.edge).frame(height: 1).padding(.vertical, 14)
                GhostButton(title: String(localized: "Sign out"), color: .white) { confirmSignOut = true }
                    .disabled(busy)
                // Kept apart from everything else, in red, and always behind a confirmation.
                Button {
                    confirmDelete = true
                } label: {
                    Text("Delete account")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.bad)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(busy)
                .padding(.top, 8)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: nameChanged)
        .onChange(of: problem) { _, new in announce(new) }
        .task {
            name = savedName
            await accounts.refresh()
        }
        .onChange(of: accounts.account?.name) { _, new in
            if !nameFocused { name = new ?? "" }
        }
        .alert("Sign out?", isPresented: $confirmSignOut) {
            Button("Sign out", role: .destructive) { accounts.signOut() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to use Ocean Live. Your car data on this phone stays.")
        }
        .alert("Delete your account?", isPresented: $confirmDelete) {
            Button("Delete account", role: .destructive) { deleteAccount() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes your account, your sign-in details and your logged AI questions. It can't be undone. Car data on this phone isn't affected.")
        }
    }

    private var initial: String {
        let source = accounts.account?.name ?? accounts.account?.email ?? "?"
        return source.first.map { String($0).uppercased() } ?? "?"
    }

    private var providerNames: String? {
        guard let providers = accounts.account?.providers, !providers.isEmpty else { return nil }
        return providers.map { p -> String in
            switch p {
            case "apple": return "Apple"
            case "google": return "Google"
            default: return String(localized: "email code")
            }
        }
        .joined(separator: ", ")
    }

    private func saveName() {
        guard nameChanged, !busy else { return }
        busy = true
        problem = nil
        nameFocused = false
        Task { @MainActor in
            let result = await accounts.rename(name)
            busy = false
            if result == nil {
                name = savedName
            } else if result != .cancelled {
                problem = String(localized: "Couldn't save the name. Check your connection and try again.")
            }
        }
    }

    private func deleteAccount() {
        busy = true
        problem = nil
        Task { @MainActor in
            let result = await accounts.delete()
            busy = false
            if result != nil && result != .cancelled {
                problem = String(localized: "Couldn't delete the account. Check your connection and try again.")
            }
        }
    }
}

/// Reads a message that just appeared out loud for VoiceOver users, who wouldn't otherwise notice it.
@MainActor
private func announce(_ message: String?) {
    guard let message, !message.isEmpty else { return }
    AccessibilityNotification.Announcement(message).post()
}

/// A full-width button that shows a spinner while its action runs.
private struct ActionButton: View {
    let title: String
    var busy = false
    var enabled = true
    var primary = true
    let action: () -> Void

    var body: some View {
        let lit = enabled || busy
        Button(action: action) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(primary ? Theme.ink : Theme.aqua) }
            }
            .font(.callout.weight(.bold))
            .foregroundStyle(primary ? (lit ? Theme.ink : Theme.dim) : (lit ? Theme.aqua : Theme.dim))
            .frame(maxWidth: .infinity, minHeight: 52)
            .background {
                if primary && lit {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.ocean)
                } else if primary {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.card)
                }
            }
            .overlay {
                if !primary {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).stroke((lit ? Theme.aqua : Theme.dim).opacity(0.45), lineWidth: 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled || busy)
    }
}

/// Google's four-colour "G": the vector from Google's Sign-In branding kit (Assets: GoogleG), not a redrawing.
private struct GoogleG: View {
    var body: some View {
        Image("GoogleG").resizable().renderingMode(.original).scaledToFit()
    }
}

private extension View {
    /// The text field look on the sign-in screen and in the Account card.
    func authField(focused: Bool, invalid: Bool) -> some View {
        let edge = invalid ? Theme.bad : focused ? Theme.aqua : Theme.dim.opacity(0.35)
        return self
            .foregroundStyle(.white)
            .tint(Theme.aqua)
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(edge, lineWidth: focused || invalid ? 1.5 : 1))
            .animation(.easeOut(duration: 0.15), value: focused)
    }
}
