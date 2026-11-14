import SwiftUI

/// "Any questions?": a simple chat with Claude about the Fisker Ocean and the app.
struct AskView: View {
    @EnvironmentObject var car: Car
    @StateObject private var ask = Ask.shared
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""
    @State private var showSent = false
    @FocusState private var focused: Bool
    private let installId = Ask.installId()

    private let examples: [String] = [
        String(localized: "What does my 12V voltage mean?"),
        String(localized: "Is my cell spread normal?"),
        String(localized: "Which fault codes should worry me?"),
    ]

    /// Only what the app already has in memory: asking never talks to the car.
    private var carSummary: String {
        Ask.carSummary(state: car.state, faults: car.faults, settings: car.settings, now: nowMs())
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { dismiss() } label: {
                    Text("Done").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                }
                Spacer()
                if !ask.turns.isEmpty && !ask.waiting {
                    Button { ask.clear() } label: {
                        Text("New chat").font(.system(size: 14)).foregroundStyle(Theme.dim)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        intro
                        ForEach(ask.turns) { Bubble(text: $0.text, mine: $0.fromOwner).id($0.id) }
                        if ask.waiting {
                            HStack(spacing: 10) {
                                ProgressView().tint(Theme.aqua)
                                Text("Thinking…").font(.system(size: 13)).foregroundStyle(Theme.dim)
                            }
                            .padding(4)
                        }
                        if let e = ask.error {
                            Text(e).font(.system(size: 13)).foregroundStyle(Theme.bad).padding(4)
                        }
                        Text("AI answers can be wrong. Check anything important with a qualified EV shop. Questions, answers and the readings sent with them go to Ocean Live's server and to Anthropic, and Ocean Live keeps them for 90 days for research.")
                            .font(.system(size: 11)).foregroundStyle(Theme.dim)
                            .padding(.top, 4)
                            .id("bottom")
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 8)
                    .readableColumn()
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: ask.turns.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                .onChange(of: ask.waiting) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField(String(localized: "Ask a question"), text: $input, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(focused ? Theme.aqua : Theme.edge, lineWidth: 1))
                    .onChange(of: input) { _, v in if v.count > 2000 { input = String(v.prefix(2000)) } }
                let canSend = !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !ask.waiting
                Button { send(input) } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(canSend ? Theme.ink : Theme.dim)
                        .frame(width: 46, height: 46)
                        .background {
                            if canSend { Circle().fill(Theme.ocean) } else { Circle().fill(Theme.card) }
                        }
                }
                .disabled(!canSend)
                .accessibilityLabel(Text("Send"))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .readableColumn()
        }
        .background(Theme.background.ignoresSafeArea())
        // A failed question goes back into the field so it can be sent again.
        .onChange(of: ask.retry) { _, q in if let q, input.isEmpty { input = q } }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Any questions?").font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
            Text("Ask about your Fisker Ocean or Ocean Live. Answers come from Claude, an AI by Anthropic, using an Ocean guide and a fault code table.")
                .font(.system(size: 13)).foregroundStyle(Theme.dim)
            CardBox {
                Toggle(isOn: Binding(get: { car.settings.askShareCar }, set: { v in car.updateSettings { $0.askShareCar = v } })) {
                    Text("Include my car's readings").font(.system(size: 15)).foregroundStyle(.white)
                }
                .tint(Theme.aqua)
                Text(car.settings.askShareCar
                     ? LocalizedStringKey("Your latest readings and fault codes go with each question, never your VIN or location. Asking never wakes the car.")
                     : LocalizedStringKey("Only your question is sent."))
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    .padding(.top, 4)
                Button { withAnimation { showSent.toggle() } } label: {
                    Text(showSent ? LocalizedStringKey("Hide") : LocalizedStringKey("Show what's sent")).font(.system(size: 13)).foregroundStyle(Theme.aqua)
                }
                .padding(.top, 6)
                if showSent {
                    if car.settings.askShareCar {
                        Text(carSummary)
                            .font(.system(size: 12, design: .monospaced)).foregroundStyle(.white)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .padding(.top, 6)
                    }
                    Text("Install ID, for deletion requests: \(installId)")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                        .textSelection(.enabled)
                        .padding(.top, 6)
                }
            }
            if ask.turns.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(examples, id: \.self) { q in
                            Button { send(q) } label: {
                                Text(q).font(.system(size: 13)).foregroundStyle(Theme.aqua)
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.aqua.opacity(0.4), lineWidth: 1))
                            }
                            .disabled(ask.waiting)
                        }
                    }
                }
            }
        }
    }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !ask.waiting else { return }
        input = ""
        let readings = car.settings.askShareCar ? carSummary : nil
        Task { await ask.send(q, car: readings) }
    }
}

private struct Bubble: View {
    let text: String
    let mine: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(mine ? Theme.ink : .white)
                .textSelection(.enabled)
                .padding(12)
                .background {
                    if mine {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.ocean)
                    } else {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.card)
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.edge, lineWidth: 1))
                    }
                }
            if !mine { Spacer(minLength: 0) }
        }
    }
}
