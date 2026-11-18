import SwiftUI

/// "Any questions?": a simple chat with Claude about the Fisker Ocean and the app.
struct AskView: View {
    @EnvironmentObject var car: Car
    @StateObject private var ask = Ask.shared
    @StateObject private var accounts = Accounts.shared
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""
    @State private var showSent = false
    /// The answer being reported, shown in the report sheet.
    @State private var reporting: AskTurn?
    @FocusState private var focused: Bool

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
                        ForEach(ask.turns) { turn in
                            VStack(alignment: .leading, spacing: 4) {
                                Bubble(text: turn.text, mine: turn.fromOwner)
                                if turn.chargedCents != nil || (!turn.fromOwner && turn.questionId != nil) {
                                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                                        if let charged = turn.chargedCents {
                                            Text(Ask.paidNote(charged: charged, left: turn.balanceCents))
                                                .font(.system(size: 12)).foregroundStyle(Theme.dim)
                                        }
                                        Spacer(minLength: 0)
                                        if !turn.fromOwner, let qid = turn.questionId {
                                            reportAction(turn, questionId: qid)
                                        }
                                    }
                                    .padding(.horizontal, 4)
                                }
                            }
                            .id(turn.id)
                        }
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
                        if !ask.waiting, ask.error == nil,
                           let notice = Ask.notice(freeLeft: ask.freeLeft, paid: ask.paidLast, day: ask.day,
                                                   today: Ask.utcDay(Date()), balanceCents: accounts.account?.balanceCents) {
                            Text(verbatim: Ask.noticeText(notice))
                                .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(4)
                        }
                        Text("AI answers can be wrong. Check anything important with a qualified EV shop. Questions, answers and the readings sent with them go to Ocean Live's server and to Anthropic, and Ocean Live keeps them for 90 days for research. For web searches, words from your question can be sent through Anthropic to a search provider.")
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
        .sheet(item: $reporting) { turn in
            ReportSheet(questionId: turn.questionId ?? "", answer: turn.text)
        }
    }

    /// "Report answer" under an AI answer, or "Reported" once a report for it was sent in this session.
    @ViewBuilder
    private func reportAction(_ turn: AskTurn, questionId: String) -> some View {
        if ask.reported.contains(questionId) {
            Label("Reported", systemImage: "flag.fill")
                .font(.system(size: 12)).foregroundStyle(Theme.dim)
                .labelStyle(.titleAndIcon)
        } else {
            Button { reporting = turn } label: {
                Label("Report answer", systemImage: "flag")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    .labelStyle(.titleAndIcon)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            // The spoken name is the visible "Report answer" (label in name); "Report" also works with Voice Control.
            .accessibilityInputLabels([Text("Report answer"), Text("Report")])
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Any questions?").font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
            Text("Ask about your Fisker Ocean or Ocean Live. Answers come from Claude, an AI by Anthropic, using an Ocean guide, a fault code table, web search and Ocean Live's GitHub.")
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

/// "Report this answer": a reason (offensive, harmful, wrong or something else) and an optional note,
/// sent to the Ocean Live server, which keeps the report with the logged question. Never talks to the car.
private struct ReportSheet: View {
    let questionId: String
    let answer: String
    @Environment(\.dismiss) private var dismiss
    @State private var reason: ReportReason?
    @State private var note = ""
    @State private var sending = false
    @State private var error: String?
    @State private var sent = false
    @FocusState private var noteFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Text(sent ? LocalizedStringKey("Done") : LocalizedStringKey("Cancel"))
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                    }
                    .disabled(sending)
                }
                .padding(.top, 10)
                if sent { thanks } else { form }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
            .readableColumn()
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.bg)
        .interactiveDismissDisabled(sending)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Report this answer").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
            Text(answer)
                .font(.system(size: 13)).foregroundStyle(Theme.dim)
                .lineLimit(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Text("What's wrong with this answer?").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                .padding(.top, 4)
            CardBox {
                ForEach(ReportReason.allCases) { r in
                    Button { reason = r } label: {
                        HStack(spacing: 12) {
                            Image(systemName: reason == r ? "largecircle.fill.circle" : "circle")
                                .font(.system(size: 18)).foregroundStyle(reason == r ? Theme.aqua : Theme.dim)
                            Text(verbatim: r.label).font(.system(size: 15)).foregroundStyle(.white)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .disabled(sending)
                    .accessibilityAddTraits(reason == r ? .isSelected : [])
                }
            }
            TextField(String(localized: "Add a note (optional)"), text: $note, axis: .vertical)
                .lineLimit(2...5)
                .focused($noteFocused)
                .foregroundStyle(.white)
                .padding(12)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(noteFocused ? Theme.aqua : Theme.edge, lineWidth: 1))
                .disabled(sending)
                .onChange(of: note) { _, v in if v.utf16.count > AskReport.maxNote { note = AskReport.cut(v, utf16: AskReport.maxNote) } }
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(Theme.bad)
            }
            let canSend = reason != nil && !sending
            Button { send() } label: {
                ZStack {
                    if sending {
                        ProgressView().tint(Theme.ink)
                    } else {
                        Text("Send").font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(canSend ? Theme.ink : Theme.dim)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
                .background {
                    if canSend || sending {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.ocean)
                    } else {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.card)
                    }
                }
            }
            .disabled(!canSend)
            .accessibilityLabel(Text("Send"))
            Text("Your report is kept with this question and answer and deleted with them.")
                .font(.system(size: 11)).foregroundStyle(Theme.dim)
        }
    }

    private var thanks: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 34)).foregroundStyle(Theme.aqua)
                .accessibilityHidden(true)
            Text("Thanks. We'll look at it.").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
        }
        .padding(.top, 20)
    }

    private func send() {
        guard let reason, !sending else { return }
        noteFocused = false
        sending = true
        error = nil
        let token = Accounts.shared.token
        let note = self.note
        let id = questionId
        Task {
            let reply = await AskReport.send(questionId: id, reason: reason, note: note, token: token)
            sending = false
            switch reply {
            case .sent:
                Ask.shared.markReported(id)
                withAnimation { sent = true }
            case .failed(let text, let signedOut):
                error = text
                // The server no longer knows this session: back to the sign-in screen.
                if signedOut { Accounts.shared.unauthorized(token: token) }
            }
        }
    }
}
