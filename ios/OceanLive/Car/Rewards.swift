import Foundation
import StoreKit

/// Amounts on the Ocean Live account balance. The server keeps them as whole US cents.
enum Money {
    /// A whole number from the server's JSON (NSNumber), never a JSON true/false.
    static func cents(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d.isFinite, d.rounded() == d, abs(d) < 1e12 else { return nil }
        return n.intValue
    }

    /// `cents` as US dollars in the owner's language, e.g. "$4.98" (English) or "4,98 $" (German).
    static func format(cents: Int, locale: Locale = .current) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = locale
        f.currencyCode = "USD"
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        let amount = NSDecimalNumber(decimal: Decimal(cents) / 100)
        return f.string(from: amount) ?? String(format: "$%.2f", Double(cents) / 100)
    }
}

/// What the server said about a reward claim (POST /rewards/apple). Pure, so it is unit tested.
enum RewardReply: Equatable {
    /// Credited now, or already credited to this account before (`alreadyClaimed`).
    case credited(balanceCents: Int?, badges: [String]?, alreadyClaimed: Bool)
    /// Won't change by asking again: claimed by another account, or the claim window closed.
    case refused(String)
    /// Worth trying again later: offline, server busy, rewards not set up yet, signed out, or a purchase
    /// the server couldn't verify (as on Android: the app only claims a real pre-order, so that is most
    /// likely a server-side problem a later fix can solve).
    case later

    static func parse(status: Int?, json: [String: Any]) -> RewardReply {
        guard let status else { return .later }
        if status == 200, json["ok"] as? Bool == true {
            return .credited(balanceCents: Money.cents(json["balanceCents"]), badges: json["badges"] as? [String],
                             alreadyClaimed: json["alreadyClaimed"] as? Bool ?? false)
        }
        switch json["error"] as? String {
        case "already_claimed_other_account", "claim_closed":
            return .refused(json["error"] as? String ?? "")
        default:
            // invalid_purchase, not_configured, rate limits, 401, 5xx and anything unknown.
            return .later
        }
    }

    /// Whether to remember the claim as done on this iPhone, so it isn't sent again at every launch.
    var settled: Bool {
        switch self {
        case .credited, .refused: return true
        case .later: return false
        }
    }
}

/// The US$5 credit and "Early supporter" badge for owners who pre-ordered Ocean Live on the App Store.
/// StoreKit's app transaction says whether this Apple Account pre-ordered; the signed copy goes to the
/// server, which checks Apple's signature and credits the signed-in account once. Never talks to the car.
@MainActor
final class Rewards {
    static let shared = Rewards()

    /// Set once the server credited the reward or said it never will, for this Apple Account on this install.
    private static let doneKey = "reward_apple_done"
    private var running = false

    private init() {}

    /// At launch and after signing in. Does nothing without a pre-order, without a session or once settled.
    func claimIfDue() async {
        guard !running, !UserDefaults.standard.bool(forKey: Self.doneKey) else { return }
        guard let token = Accounts.shared.token else { return }
        running = true
        defer { running = false }

        // AppTransaction and its preorderDate need iOS 16; the app's minimum is iOS 17.
        let result: VerificationResult<AppTransaction>
        do {
            result = try await AppTransaction.shared
        } catch {
            return
        }
        // Only an app transaction StoreKit verified on this iPhone, and only for a pre-order.
        guard case .verified(let transaction) = result, transaction.preorderDate != nil else { return }

        let reply = await Accounts.call("POST", "/rewards/apple", body: ["appTransaction": result.jwsRepresentation], token: token)
        if reply?.status == 401 {
            Accounts.shared.unauthorized(token: token)
            return
        }
        let outcome = RewardReply.parse(status: reply?.status, json: reply?.json ?? [:])
        if case .credited(let cents, let badges, _) = outcome {
            Accounts.shared.updateBalance(cents: cents, badges: badges, token: token)
        }
        if outcome.settled { UserDefaults.standard.set(true, forKey: Self.doneKey) }
    }
}
