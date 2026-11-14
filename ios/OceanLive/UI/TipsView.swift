import StoreKit
import SwiftUI

/// "Support Ocean Live": three tips through Apple In-App Purchase. A tip unlocks nothing.
struct TipsView: View {
    @StateObject private var tips = Tips.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Text("Done").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 4)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Support Ocean Live")
                        .font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
                        .accessibilityAddTraits(.isHeader)
                    Text("Ocean Live is made by one owner in spare time. Tips help pay for the AI questions and keep the app going. A tip unlocks nothing; everything stays free.")
                        .font(.system(size: 15)).foregroundStyle(Theme.dim)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)

                    if tips.thanked {
                        ThanksCard { dismiss() }
                            .padding(.top, 24)
                            .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    } else {
                        choices.padding(.top, 24)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
                .readableColumn()
                .animation(.easeInOut(duration: 0.3), value: tips.thanked)
                .animation(.easeInOut(duration: 0.25), value: tips.load)
            }
            .scrollIndicators(.hidden)
        }
        .background(Theme.background.ignoresSafeArea())
        .task { await tips.loadProducts(retry: true) }
        .sensoryFeedback(.success, trigger: tips.thanked) { _, now in now }
        .onChange(of: tips.error) { _, e in
            if let e { UIAccessibility.post(notification: .announcement, argument: e) }
        }
        // Each visit starts at the choices again, even if a late tip finished while the screen was closed.
        .onAppear {
            tips.thanked = false
            tips.error = nil
        }
        .onDisappear {
            tips.thanked = false
            tips.error = nil
        }
    }

    @ViewBuilder private var choices: some View {
        switch tips.load {
        case .idle, .loading:
            VStack(spacing: 10) {
                ForEach(TipSize.allCases) { _ in PlaceholderRow() }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Loading tips…"))
        case .failed:
            Problem(text: String(localized: "Couldn't load the tips. Check your connection and try again.")) {
                Task { await tips.loadProducts(retry: true) }
            }
        case .unavailable:
            Problem(text: String(localized: "Tips aren't available right now."), retry: nil)
        case .loaded:
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(tips.products.enumerated()), id: \.element.id) { index, product in
                    TipRow(product: product,
                           name: tips.name(product),
                           symbol: TipSize.forProduct(product.id)?.symbol ?? "heart",
                           featured: index == tips.products.count / 2 && tips.products.count == 3,
                           busy: tips.purchasing == product.id,
                           enabled: tips.purchasing == nil && tips.canPay) {
                        Task { await tips.buy(product) }
                    }
                }
                if !tips.canPay {
                    Message(text: String(localized: "Purchases are turned off on this iPhone. You can allow them in Screen Time settings."),
                            color: Theme.warn, symbol: "lock")
                }
                if tips.pending {
                    Message(text: String(localized: "Waiting for approval. Once it's approved, the tip goes through on its own."),
                            color: Theme.warn, symbol: "hourglass")
                }
                if let e = tips.error {
                    Message(text: e, color: Theme.bad, symbol: "exclamationmark.circle")
                }
                Text("Prices are set by the App Store in your currency. Payment goes through Apple.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
        }
    }
}

private struct TipRow: View {
    let product: Product
    let name: String
    let symbol: String
    /// The middle tip carries the filled price: one clear primary choice.
    let featured: Bool
    let busy: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Theme.aqua)
                    .frame(width: 40, height: 40)
                    .background(Theme.aqua.opacity(0.12), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    if !product.description.isEmpty {
                        Text(verbatim: product.description).font(.system(size: 13)).foregroundStyle(Theme.dim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                price
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(featured ? Theme.aqua.opacity(0.45) : Theme.edge, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
        .opacity(enabled || busy ? 1 : 0.55)
        .animation(.easeInOut(duration: 0.2), value: enabled)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(name), \(product.displayPrice)"))
        .accessibilityValue(busy ? Text("Processing…") : Text(verbatim: ""))
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var price: some View {
        ZStack {
            // Keeps the width of the price while the spinner shows, so nothing jumps.
            Text(verbatim: product.displayPrice).opacity(busy ? 0 : 1)
            if busy { ProgressView().tint(featured ? Theme.ink : Theme.aqua) }
        }
        .font(.system(size: 15, weight: .bold, design: .rounded))
        .foregroundStyle(featured ? Theme.ink : Theme.aqua)
        .padding(.horizontal, 14)
        .frame(minHeight: 36)
        .background {
            if featured {
                Capsule().fill(Theme.ocean)
            } else {
                Capsule().stroke(Theme.aqua.opacity(0.5), lineWidth: 1)
            }
        }
    }
}

/// Space held for a tip while the App Store answers.
private struct PlaceholderRow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        HStack(spacing: 14) {
            Circle().fill(Theme.track).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(Theme.track).frame(width: 110, height: 12)
                Capsule().fill(Theme.track).frame(width: 170, height: 10)
            }
            Spacer()
            Capsule().fill(Theme.track).frame(width: 72, height: 36)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge, lineWidth: 1))
        .opacity(dim ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
        }
    }
}

private struct Problem: View {
    let text: String
    let retry: (() -> Void)?

    var body: some View {
        CardBox {
            Label {
                Text(verbatim: text).font(.system(size: 15)).foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.warn)
            }
            if let retry {
                GhostButton(title: String(localized: "Try again"), action: retry).padding(.top, 14)
            }
        }
    }
}

private struct Message: View {
    let text: String
    let color: Color
    let symbol: String

    var body: some View {
        Label {
            Text(verbatim: text).font(.system(size: 13)).foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(color)
        }
        .padding(.top, 4)
    }
}

/// Shown once a tip went through: a heart with a short burst of sparks (a still heart with Reduce Motion).
private struct ThanksCard: View {
    let done: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var burst = false

    var body: some View {
        CardBox(glow: Theme.aqua) {
            VStack(spacing: 10) {
                ZStack {
                    if !reduceMotion {
                        ForEach(0..<8, id: \.self) { i in
                            let angle = Double(i) / 8 * 2 * Double.pi
                            let reach: CGFloat = burst ? 46 : 0
                            Circle()
                                .fill(i.isMultiple(of: 2) ? Theme.aqua : Theme.violet)
                                .frame(width: 7, height: 7)
                                .offset(x: CGFloat(cos(angle)) * reach, y: CGFloat(sin(angle)) * reach)
                                .opacity(burst ? 0 : 1)
                        }
                    }
                    Image(systemName: "heart.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Theme.ocean)
                        .scaleEffect(burst || reduceMotion ? 1 : 0.5)
                }
                .frame(height: 100)
                .accessibilityHidden(true)
                Text("Thank you!").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                Text("Your tip helps keep Ocean Live going.")
                    .font(.system(size: 15)).foregroundStyle(Theme.dim)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                GradientButton(title: String(localized: "Done"), action: done).padding(.top, 8)
            }
            .frame(maxWidth: .infinity)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.55)) { burst = true }
        }
    }
}

/// The small card on the Live screen, portrait only (see `TipBanner`). It decides on its own whether to show.
struct TipBannerCard: View {
    @EnvironmentObject var car: Car
    @StateObject private var tips = Tips.shared
    @State private var showTips = false
    var topPadding: CGFloat = 18

    /// Explicit, because the private state above makes the synthesized memberwise init private.
    init(topPadding: CGFloat = 18) {
        self.topPadding = topPadding
    }

    var body: some View {
        // A VStack rather than a Group, so the task and sheet stay attached while the card is hidden.
        VStack(spacing: 0) {
            if tips.bannerVisible(mode: car.state.mode) {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: "heart")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Theme.aqua)
                        .frame(width: 36, height: 36)
                        .background(Theme.aqua.opacity(0.12), in: Circle())
                        .accessibilityHidden(true)
                    Text("Enjoying Ocean Live? Support it with a tip")
                        .font(.system(size: 14, weight: .medium)).foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Button { showTips = true } label: {
                        Text("Support")
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 36)
                            .background(Theme.ocean, in: Capsule())
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                    Button {
                        withAnimation(.easeInOut(duration: 0.25)) { tips.dismissBanner() }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.dim)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text("Hide tip suggestion"))
                }
                .padding(.leading, 12).padding(.vertical, 4).padding(.trailing, 2)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge, lineWidth: 1))
                .padding(.top, topPadding)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        // Asks the App Store only once the card could show at all, and only once per run.
        .task { if tips.bannerTimeAllows() { await tips.loadProducts() } }
        .sheet(isPresented: $showTips) { TipsView() }
    }
}

/// The Settings entry that opens "Support Ocean Live".
struct SupportSection: View {
    @State private var showTips = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(String(localized: "Support"))
            Button { showTips = true } label: {
                CardBox {
                    HStack(spacing: 12) {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(Theme.ink)
                            .frame(width: 44, height: 44)
                            .background(Theme.ocean, in: Circle())
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Support Ocean Live").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                            Text("Leave a tip. It unlocks nothing; everything stays free.")
                                .font(.system(size: 12)).foregroundStyle(Theme.dim)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
                            .accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
        }
        .sheet(isPresented: $showTips) { TipsView() }
    }
}
