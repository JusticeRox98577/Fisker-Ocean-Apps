import Foundation
import StoreKit

/// When the small "Support it with a tip" card may show on the Live screen. Pure, so it is unit tested.
/// Never in CarPlay, widgets or on the watch: only the phone's Live screen asks, and only in portrait
/// (a landscape phone is often mounted as the car's screen). Android follows the same rule.
enum TipBanner {
    static let day: TimeInterval = 86_400
    /// Not in the first days after the app was first opened.
    static let quietDays = 3.0
    /// Hidden this long after the close button.
    static let dismissDays = 90.0
    /// Hidden this long after any tip that went through.
    static let afterTipDays = 180.0

    /// True once enough time has passed since first launch, a dismiss and the last tip. Doesn't need the store.
    static func timeAllows(now: Date, firstLaunch: Date?, dismissedAt: Date?, lastTipAt: Date?) -> Bool {
        // Unknown first launch: it is being recorded now, so this counts as the first day.
        guard let firstLaunch, now >= firstLaunch.addingTimeInterval(quietDays * day) else { return false }
        if let dismissedAt, now < dismissedAt.addingTimeInterval(dismissDays * day) { return false }
        if let lastTipAt, now < lastTipAt.addingTimeInterval(afterTipDays * day) { return false }
        return true
    }

    /// The whole rule: the time rule, never while driving or charging, and only when the tips could be loaded
    /// (no App Store products, for example before they're set up, means no card).
    static func shouldShow(now: Date, firstLaunch: Date?, dismissedAt: Date?, lastTipAt: Date?,
                           mode: Mode, available: Bool) -> Bool {
        guard available, mode == .parked else { return false }
        return timeAllows(now: now, firstLaunch: firstLaunch, dismissedAt: dismissedAt, lastTipAt: lastTipAt)
    }
}

/// The three tips. Consumables in App Store Connect: they unlock nothing and can be bought again.
enum TipSize: String, CaseIterable, Identifiable {
    case small, medium, large

    var id: String { rawValue }
    var productId: String { "com.justice.OceanABRP.tip.\(rawValue)" }

    /// Used when the App Store's name for the product is empty.
    var fallbackName: String {
        switch self {
        case .small: return String(localized: "Small tip")
        case .medium: return String(localized: "Medium tip")
        case .large: return String(localized: "Large tip")
        }
    }

    var symbol: String {
        switch self {
        case .small: return "cup.and.saucer"
        case .medium: return "mug"
        case .large: return "gift"
        }
    }

    static func forProduct(_ id: String) -> TipSize? { allCases.first { $0.productId == id } }
}

/// Tips through Apple In-App Purchase (StoreKit 2). Prices and names come from the App Store.
/// No analytics: nothing about tips leaves the phone apart from the purchase Apple handles.
@MainActor
final class Tips: ObservableObject {
    static let shared = Tips()

    enum Load: Equatable { case idle, loading, loaded, unavailable, failed }

    /// The tip products, cheapest first.
    @Published private(set) var products: [Product] = []
    @Published private(set) var load: Load = .idle
    /// The product being bought, while the App Store sheet is up.
    @Published private(set) var purchasing: String?
    /// Set when a tip went through; the Support screen shows its thank-you.
    @Published var thanked = false
    /// Ask to Buy: waiting for a parent to approve.
    @Published var pending = false
    /// What went wrong with the last purchase, in words for the user.
    @Published var error: String?
    @Published private(set) var dismissedAt: Date?
    @Published private(set) var lastTipAt: Date?
    let firstLaunch: Date?

    private static let firstLaunchKey = "tips_first_launch"
    private static let dismissedKey = "tips_banner_dismissed"
    private static let lastTipKey = "tips_last_tip"

    private var updates: Task<Void, Never>?
    private var leftovers: Task<Void, Never>?

    private init() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: Self.firstLaunchKey) == nil {
            defaults.set(Date().timeIntervalSince1970, forKey: Self.firstLaunchKey)
        }
        firstLaunch = Self.date(Self.firstLaunchKey)
        dismissedAt = Self.date(Self.dismissedKey)
        lastTipAt = Self.date(Self.lastTipKey)
    }

    /// At launch: finishes tips the App Store delivers outside a purchase on this screen (Ask to Buy approved,
    /// a purchase interrupted by the app closing), so the same tip can always be bought again.
    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            // Also delivers unfinished tips once at launch, and Ask to Buy approvals at any time: only thank
            // when this screen was waiting for an approval, never for a leftover the user didn't just give.
            for await result in Transaction.updates {
                guard let self else { return }
                await self.handle(result, thank: self.pending)
            }
        }
        // Tips bought before the app last closed and never finished.
        leftovers = Task { [weak self] in
            for await result in Transaction.unfinished { await self?.handle(result, thank: false) }
        }
    }

    /// Asks the App Store for the products. `retry` also tries again after a failure (the Support screen);
    /// the Live card only ever loads once per run.
    func loadProducts(retry: Bool = false) async {
        switch load {
        case .loading, .loaded: return
        case .failed, .unavailable: if !retry { return }
        case .idle: break
        }
        load = .loading
        do {
            let found = try await Product.products(for: TipSize.allCases.map(\.productId))
            products = found.filter { $0.type == .consumable }.sorted { $0.price < $1.price }
            load = products.isEmpty ? .unavailable : .loaded
        } catch {
            load = .failed
        }
    }

    /// Products loaded and purchases allowed on this iPhone.
    var available: Bool { load == .loaded && !products.isEmpty && AppStore.canMakePayments }

    var canPay: Bool { AppStore.canMakePayments }

    func bannerVisible(mode: Mode, now: Date = Date()) -> Bool {
        TipBanner.shouldShow(now: now, firstLaunch: firstLaunch, dismissedAt: dismissedAt, lastTipAt: lastTipAt,
                             mode: mode, available: available)
    }

    /// Whether loading the products for the Live card is worth it at all.
    func bannerTimeAllows(now: Date = Date()) -> Bool {
        TipBanner.timeAllows(now: now, firstLaunch: firstLaunch, dismissedAt: dismissedAt, lastTipAt: lastTipAt)
    }

    func dismissBanner() {
        let now = Date()
        dismissedAt = now
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: Self.dismissedKey)
    }

    func name(_ product: Product) -> String {
        let n = product.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? (TipSize.forProduct(product.id)?.fallbackName ?? String(localized: "Tip")) : n
    }

    func buy(_ product: Product) async {
        guard purchasing == nil else { return }
        purchasing = product.id
        error = nil
        pending = false
        defer { purchasing = nil }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    await transaction.finish()
                    recordTip()
                case .unverified(let transaction, _):
                    // Nothing to unlock either way; finish it so it isn't delivered again, but don't thank for it.
                    await transaction.finish()
                    error = String(localized: "The App Store couldn't confirm this tip. Please try again later.")
                }
            case .pending:
                pending = true
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            self.error = Self.message(for: error)
        }
    }

    private func handle(_ result: VerificationResult<Transaction>, thank: Bool) async {
        switch result {
        case .verified(let transaction):
            await transaction.finish()
            if TipSize.forProduct(transaction.productID) != nil && transaction.revocationDate == nil {
                pending = false
                recordTip(thank: thank)
            }
        case .unverified(let transaction, _):
            await transaction.finish()
        }
    }

    /// A late leftover (`thank` false) still hides the Live card, but doesn't pop up a thank-you out of nowhere.
    private func recordTip(thank: Bool = true) {
        let now = Date()
        lastTipAt = now
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: Self.lastTipKey)
        if thank { thanked = true }
    }

    /// Nil when the user cancelled: that needs no message.
    private static func message(for error: Error) -> String? {
        if let e = error as? StoreKitError {
            switch e {
            case .userCancelled: return nil
            case .networkError: return String(localized: "Couldn't reach the App Store. Check your connection and try again.")
            case .notAvailableInStorefront: return String(localized: "Tips aren't available in your App Store country.")
            default: break
            }
        }
        if let e = error as? Product.PurchaseError {
            switch e {
            case .purchaseNotAllowed:
                return String(localized: "Purchases are turned off on this iPhone. You can allow them in Screen Time settings.")
            case .productUnavailable:
                return String(localized: "Tips aren't available right now.")
            default: break
            }
        }
        return String(localized: "The tip didn't go through. Please try again.")
    }

    private static func date(_ key: String) -> Date? {
        guard UserDefaults.standard.object(forKey: key) != nil else { return nil }
        return Date(timeIntervalSince1970: UserDefaults.standard.double(forKey: key))
    }
}
