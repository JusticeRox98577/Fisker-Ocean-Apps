import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

/// The signed-in Ocean Live account, as the server last described it.
struct AccountInfo: Codable, Equatable, Sendable {
    let id: String
    let email: String?
    let name: String?
    let providers: [String]

    init(id: String, email: String?, name: String?, providers: [String]) {
        self.id = id
        self.email = email
        self.name = name
        self.providers = providers
    }

    /// From the server's JSON (`{id, email, name, created, providers}`), or nil without an id.
    init?(json: [String: Any]) {
        guard let id = json["id"] as? String, !id.isEmpty else { return nil }
        self.id = id
        email = (json["email"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        name = (json["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        providers = json["providers"] as? [String] ?? []
    }
}

/// Sign-in methods the server is set up for (GET /auth/config).
struct AuthConfig: Equatable, Sendable {
    var apple = false
    var google = false
    var email = false
    var googleIosClientId: String?

    init(apple: Bool = false, google: Bool = false, email: Bool = false, googleIosClientId: String? = nil) {
        self.apple = apple
        self.google = google
        self.email = email
        self.googleIosClientId = googleIosClientId
    }

    init(json: [String: Any]) {
        apple = json["apple"] as? Bool ?? false
        google = json["google"] as? Bool ?? false
        email = json["email"] as? Bool ?? false
        googleIosClientId = (json["googleIosClientId"] as? String)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .flatMap { $0.isEmpty ? nil : $0 }
    }

    /// Google needs the server's iOS client ID as well as being switched on.
    var showsGoogle: Bool { google && googleIosClientId != nil }
    var anyMethod: Bool { apple || showsGoogle || email }
}

/// Why signing in (or an account change) didn't work. `cancelled` is shown as nothing at all.
enum AuthProblem: Error, Equatable {
    case cancelled, network, failed, wrongCode, codeExpired, badEmail, rateLimited, unavailable

    /// What the server's error codes (ask-proxy/src/auth.ts) mean for the owner.
    static func from(status: Int, error: String?) -> AuthProblem {
        switch error ?? "" {
        case "wrong_code": return .wrongCode
        case "code_expired": return .codeExpired
        case "bad_email": return .badEmail
        case "rate_limited": return .rateLimited
        case "method_unavailable", "accounts_unavailable": return .unavailable
        // Apple's or Google's key server couldn't be reached; trying again later may work.
        case "provider_unavailable": return .network
        default: return status == 429 ? .rateLimited : .failed
        }
    }

    var message: String? {
        switch self {
        case .cancelled: return nil
        case .network: return String(localized: "Can't reach the Ocean Live server. Signing in needs internet once.")
        case .failed: return String(localized: "Couldn't sign in. Try again.")
        case .wrongCode: return String(localized: "That code isn't right.")
        case .codeExpired: return String(localized: "That code has expired. Send a new one.")
        case .badEmail: return String(localized: "Enter a valid email address.")
        case .rateLimited: return String(localized: "Too many codes. Wait an hour and try again.")
        case .unavailable: return String(localized: "This sign-in method isn't available right now. Try another one.")
        }
    }
}

/// Small pure helpers for the sign-in flows, kept apart so they can be unit tested.
enum AuthCrypto {
    /// `bytes` random bytes (from the system's secure generator) as base64url without padding.
    static func randomURLSafe(bytes: Int = 32) -> String {
        base64url(Data((0..<bytes).map { _ in UInt8.random(in: 0...255) }))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Lowercase hex SHA-256, as Apple expects for the nonce in a Sign in with Apple request.
    static func sha256Hex(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// PKCE S256 code challenge for a code verifier (RFC 7636).
    static func pkceChallenge(_ verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// The name Apple shares on the first sign-in only, or nil.
    static func displayName(_ components: PersonNameComponents?) -> String? {
        guard let components else { return nil }
        let s = PersonNameComponentsFormatter.localizedString(from: components, style: .default, options: [])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : String(s.prefix(60))
    }

    /// Same check as the server's, so an obvious typo doesn't use up one of the hourly codes.
    static func validEmail(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.range(of: #"^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$"#, options: .regularExpression) != nil
    }
}

/// Sign in with Google without Google's SDK: OAuth 2.0 authorization code with PKCE in an
/// ASWebAuthenticationSession, using the server's Google "iOS" client ID (no client secret).
enum GoogleOAuth {
    static let authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
    static let tokenEndpoint = "https://oauth2.googleapis.com/token"

    /// "123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc", Google's URL scheme for an iOS client.
    static func reversedClientId(_ clientId: String) -> String {
        clientId.split(separator: ".").reversed().joined(separator: ".")
    }

    static func redirectURI(clientId: String) -> String {
        reversedClientId(clientId) + ":/oauth2redirect"
    }

    /// Google's sign-in page. `nonce` comes back inside the ID token, and the server checks it there.
    static func authURL(clientId: String, challenge: String, state: String, nonce: String) -> URL? {
        var c = URLComponents(string: authEndpoint)
        c?.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI(clientId: clientId)),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
        ]
        return c?.url
    }

    /// The authorization code from Google's redirect, once the state matches the one that was sent.
    static func code(from callback: URL, expectedState: String) -> Result<String, AuthProblem> {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard !expectedState.isEmpty, value("state") == expectedState else { return .failure(.failed) }
        if let error = value("error") { return .failure(error == "access_denied" ? .cancelled : .failed) }
        guard let code = value("code"), !code.isEmpty else { return .failure(.failed) }
        return .success(code)
    }

    static func formEncode(_ fields: [(String, String)]) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s }
        return fields.map { "\(enc($0.0))=\(enc($0.1))" }.joined(separator: "&")
    }

    static func tokenRequestBody(code: String, clientId: String, verifier: String) -> String {
        formEncode([
            ("code", code),
            ("client_id", clientId),
            ("redirect_uri", redirectURI(clientId: clientId)),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
    }

    /// Swaps the authorization code for Google's ID token.
    static func exchange(code: String, clientId: String, verifier: String) async -> Result<String, AuthProblem> {
        guard let url = URL(string: tokenEndpoint) else { return .failure(.failed) }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(tokenRequestBody(code: code, clientId: clientId, verifier: verifier).utf8)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            guard status == 200, let idToken = json?["id_token"] as? String, !idToken.isEmpty else { return .failure(.failed) }
            return .success(idToken)
        } catch {
            return .failure(.network)
        }
    }
}

/// Hands ASWebAuthenticationSession the window to show Google's page over. The window is looked up
/// on the main actor beforehand, so this callback touches nothing but its own stored property.
private final class AnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    let anchor: ASPresentationAnchor
    init(anchor: ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
}

/// Resumes a continuation exactly once, whichever of the session's callback or a failed start comes first.
private final class ResumeOnce<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Never>?
    private var early: T?

    func set(_ c: CheckedContinuation<T, Never>) {
        lock.lock()
        if let value = early {
            early = nil
            lock.unlock()
            c.resume(returning: value)
            return
        }
        continuation = c
        lock.unlock()
    }

    func resume(_ value: T) {
        lock.lock()
        guard let c = continuation else {
            if early == nil { early = value }
            lock.unlock()
            return
        }
        continuation = nil
        lock.unlock()
        c.resume(returning: value)
    }
}

/// A reply from the Ocean Live server.
struct AuthReply: Sendable {
    let status: Int
    let data: Data
    var json: [String: Any] { ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:] }
    var error: String? { json["error"] as? String }
}

/// Ocean Live accounts. Owners sign in once (Apple, Google or an email code); the server returns a
/// session token that is kept in the Keychain, so the app keeps working offline afterwards. Car data
/// never goes to the account, and signing in never talks to the car.
///
/// Accounts live on the same server as "Any questions?" (`Ask.url`); builds without it need no account.
@MainActor
final class Accounts: ObservableObject {
    static let shared = Accounts()

    /// True when this build talks to the Ocean Live server, so signing in is required (same rule as Android).
    nonisolated static var required: Bool { Ask.enabled }

    /// The server root: the "Any questions?" address without its "/ask".
    nonisolated static let base: URL? = baseURL(ask: Ask.url)

    nonisolated static func baseURL(ask: URL?) -> URL? {
        guard var s = ask?.absoluteString, !s.isEmpty else { return nil }
        while s.hasSuffix("/") { s.removeLast() }
        if s.hasSuffix("/ask") { s.removeLast(4) }
        return URL(string: s)
    }

    @Published private(set) var token: String?
    @Published private(set) var account: AccountInfo?
    /// The Keychain couldn't be read yet (before the first unlock since the iPhone started).
    @Published private(set) var keychainLocked = false

    /// Unknown while the Keychain is locked counts as signed in, so the sign-in screen never flashes up.
    var signedIn: Bool { token != nil || keychainLocked }

    private static let accountKey = "account_json"
    /// Set in UserDefaults once the session has been read on this install. UserDefaults goes with an
    /// uninstall but the Keychain doesn't, so a session found without it is left over from before.
    private static let installMarkerKey = "account_install_marker"
    private var webSession: ASWebAuthenticationSession?
    private var anchorProvider: AnchorProvider?

    private init() { load() }

    private func load() {
        let (value, status) = SecretStore.read(SecretStore.sessionAccount)
        guard let saved = value else {
            // Only "not unlocked since the iPhone started" is worth waiting for. Any other Keychain
            // failure won't fix itself, so it counts as signed out rather than skipping sign-in for good.
            keychainLocked = status == errSecInteractionNotAllowed
            token = nil
            account = nil
            return
        }
        keychainLocked = false
        if !UserDefaults.standard.bool(forKey: Self.installMarkerKey) {
            // First read on this install: a session here survived an uninstall, without its account
            // details. Start signed out instead of showing an empty Account card.
            if !saved.isEmpty { SecretStore.set("", for: SecretStore.sessionAccount) }
            UserDefaults.standard.set(true, forKey: Self.installMarkerKey)
            token = nil
            account = nil
            return
        }
        token = saved.isEmpty ? nil : saved
        account = token == nil ? nil : UserDefaults.standard.data(forKey: Self.accountKey)
            .flatMap { try? JSONDecoder().decode(AccountInfo.self, from: $0) }
    }

    /// On screen means unlocked: reads the session again if the Keychain was locked at launch.
    func retryKeychain() {
        if keychainLocked { load() }
    }

    private func save(token: String, account: AccountInfo) {
        SecretStore.set(token, for: SecretStore.sessionAccount)
        UserDefaults.standard.set(try? JSONEncoder().encode(account), forKey: Self.accountKey)
        UserDefaults.standard.set(true, forKey: Self.installMarkerKey)
        keychainLocked = false
        self.token = token
        self.account = account
    }

    /// The server no longer knows this session (signed out, signed out elsewhere, or the account was deleted).
    func sessionEnded() {
        SecretStore.set("", for: SecretStore.sessionAccount)
        UserDefaults.standard.removeObject(forKey: Self.accountKey)
        keychainLocked = false
        token = nil
        account = nil
    }

    // MARK: Signing in

    /// Which sign-in methods are on, or nil when the server can't be reached.
    func config() async -> AuthConfig? {
        guard let r = await Self.call("GET", "/auth/config"), r.status == 200 else { return nil }
        return AuthConfig(json: r.json)
    }

    /// Signs in with the credential from Sign in with Apple. The server checks the identity token
    /// against Apple's keys, and that the token carries the SHA-256 of `nonce` (the raw value whose
    /// hash went into the Apple request), so a token can't be replayed from another sign-in.
    func signInWithApple(_ credential: ASAuthorizationAppleIDCredential, nonce: String) async -> AuthProblem? {
        guard let data = credential.identityToken, let identityToken = String(data: data, encoding: .utf8) else { return .failed }
        var body = ["identityToken": identityToken, "device": Ask.installId(), "nonce": nonce]
        // Apple shares the name only the first time; the server keeps it and never overwrites a chosen name.
        if let name = AuthCrypto.displayName(credential.fullName) { body["name"] = name }
        return finish(await Self.call("POST", "/auth/apple", body: body))
    }

    /// Shows Google's sign-in page, then signs in with the ID token it returns.
    func signInWithGoogle(clientId: String) async -> AuthProblem? {
        guard webSession == nil else { return .cancelled }
        let verifier = AuthCrypto.randomURLSafe()
        let state = AuthCrypto.randomURLSafe(bytes: 16)
        let nonce = AuthCrypto.randomURLSafe(bytes: 24)
        guard let url = GoogleOAuth.authURL(clientId: clientId, challenge: AuthCrypto.pkceChallenge(verifier), state: state, nonce: nonce),
              let anchor = Self.presentationAnchor() else { return .failed }

        let once = ResumeOnce<Result<URL, AuthProblem>>()
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: GoogleOAuth.reversedClientId(clientId)) { callback, error in
            if let callback {
                once.resume(.success(callback))
            } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                once.resume(.failure(.cancelled))
            } else {
                once.resume(.failure(.failed))
            }
        }
        let provider = AnchorProvider(anchor: anchor)
        session.presentationContextProvider = provider
        // Shares Safari's Google sign-in, so an owner already signed in to Google just picks the account.
        session.prefersEphemeralWebBrowserSession = false
        webSession = session
        anchorProvider = provider
        let started = session.start()
        if !started { once.resume(.failure(.failed)) }
        let result = await withCheckedContinuation { (c: CheckedContinuation<Result<URL, AuthProblem>, Never>) in
            once.set(c)
        }
        webSession = nil
        anchorProvider = nil

        let code: String
        switch result {
        case .failure(let p): return p
        case .success(let callback):
            switch GoogleOAuth.code(from: callback, expectedState: state) {
            case .failure(let p): return p
            case .success(let c): code = c
            }
        }
        let idToken: String
        switch await GoogleOAuth.exchange(code: code, clientId: clientId, verifier: verifier) {
        case .failure(let p): return p
        case .success(let t): idToken = t
        }
        return finish(await Self.call("POST", "/auth/google", body: ["idToken": idToken, "nonce": nonce, "device": Ask.installId()]))
    }

    /// Emails a 6-digit code.
    func emailStart(_ email: String) async -> AuthProblem? {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard AuthCrypto.validEmail(address) else { return .badEmail }
        guard let r = await Self.call("POST", "/auth/email/start", body: ["email": address]) else { return .network }
        return r.status == 200 ? nil : AuthProblem.from(status: r.status, error: r.error)
    }

    func emailVerify(_ email: String, code: String) async -> AuthProblem? {
        let body = ["email": email.trimmingCharacters(in: .whitespacesAndNewlines), "code": code, "device": Ask.installId()]
        return finish(await Self.call("POST", "/auth/email/verify", body: body))
    }

    private func finish(_ r: AuthReply?) -> AuthProblem? {
        guard let r else { return .network }
        let json = r.json
        if r.status == 200, let token = json["token"] as? String, !token.isEmpty,
           let accountJson = json["account"] as? [String: Any], let account = AccountInfo(json: accountJson) {
            save(token: token, account: account)
            return nil
        }
        return AuthProblem.from(status: r.status, error: r.error)
    }

    // MARK: The account

    /// Fetches the account again. Offline, the saved copy stays.
    func refresh() async {
        guard let token else { return }
        guard let r = await Self.call("GET", "/account", token: token) else { return }
        if r.status == 401 { ended(token) }
        else if r.status == 200, let account = AccountInfo(json: r.json), self.token == token { save(token: token, account: account) }
    }

    func rename(_ name: String) async -> AuthProblem? {
        guard let token else { return .failed }
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        guard let r = await Self.call("PATCH", "/account", body: ["name": trimmed], token: token) else { return .network }
        if r.status == 401 { ended(token); return .failed }
        guard r.status == 200, let account = AccountInfo(json: r.json), self.token == token else { return .failed }
        save(token: token, account: account)
        return nil
    }

    /// Signs out here straight away and tells the server to forget the session.
    func signOut() {
        guard let token else { return sessionEnded() }
        sessionEnded()
        Task.detached { _ = await Accounts.call("POST", "/auth/signout", body: [:], token: token) }
    }

    /// Deletes the account on the server; signs out here only once the server confirms.
    func delete() async -> AuthProblem? {
        guard let token else { return .failed }
        guard let r = await Self.call("DELETE", "/account", token: token) else { return .network }
        guard r.status == 200 || r.status == 401 else { return .failed }
        ended(token)
        return nil
    }

    /// A 401 for `token`: signed out, unless another sign-in replaced it meanwhile.
    private func ended(_ token: String) {
        if self.token == token { sessionEnded() }
    }

    /// For "Any questions?": its 401 means the same as one here.
    func unauthorized(token: String?) {
        if let token { ended(token) }
    }

    // MARK: Network

    /// Nil when the server can't be reached.
    nonisolated static func call(_ method: String, _ path: String, body: [String: String]? = nil, token: String? = nil) async -> AuthReply? {
        guard let base, let url = URL(string: base.absoluteString + path) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue(Locale.preferredLanguages.first ?? "en", forHTTPHeaderField: "Accept-Language")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            return AuthReply(status: (response as? HTTPURLResponse)?.statusCode ?? 0, data: data)
        } catch {
            return nil
        }
    }

    /// The phone window on screen (not CarPlay), to show Google's page over.
    private static func presentationAnchor() -> ASPresentationAnchor? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    }
}
