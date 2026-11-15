import XCTest
@testable import OceanLive

/// The account balance, the pre-order reward reply and paid "Any questions?" answers. Pure logic only.
final class BalanceTests: XCTestCase {
    // MARK: Money

    func testFormatsUSDollarsInEnglish() {
        let us = Locale(identifier: "en_US")
        XCTAssertEqual(Money.format(cents: 500, locale: us), "$5.00")
        XCTAssertEqual(Money.format(cents: 2, locale: us), "$0.02")
        XCTAssertEqual(Money.format(cents: 498, locale: us), "$4.98")
        XCTAssertEqual(Money.format(cents: 0, locale: us), "$0.00")
    }

    func testFormatsWithTheLocalesDecimalSeparator() {
        // German, French, Spanish and Dutch write a comma; the exact spacing and symbol placement is the system's.
        for id in ["de_DE", "fr_FR", "es_ES", "nl_NL"] {
            let s = Money.format(cents: 498, locale: Locale(identifier: id))
            XCTAssertTrue(s.contains("4,98"), "\(id): \(s)")
            XCTAssertTrue(s.contains("$") || s.contains("US"), "\(id): \(s)")
        }
    }

    func testCentsFromJson() {
        let json = try! JSONSerialization.jsonObject(with: Data(#"{"a":500,"b":0,"c":true,"d":"5","e":1.5}"#.utf8)) as! [String: Any]
        XCTAssertEqual(Money.cents(json["a"]), 500)
        XCTAssertEqual(Money.cents(json["b"]), 0)
        XCTAssertNil(Money.cents(json["c"]))
        XCTAssertNil(Money.cents(json["d"]))
        XCTAssertNil(Money.cents(json["e"]))
        XCTAssertNil(Money.cents(nil))
    }

    // MARK: Account

    private func object(_ s: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(s.utf8)) as! [String: Any]
    }

    func testAccountReadsBalanceAndBadges() {
        let a = AccountInfo(json: object(#"{"id":"u1","email":"a@b.co","providers":["apple"],"balanceCents":500,"badges":["early_supporter"]}"#))
        XCTAssertEqual(a?.balanceCents, 500)
        XCTAssertEqual(a?.earlySupporter, true)
    }

    func testAccountWithoutBalanceFromAnOlderServer() {
        let a = AccountInfo(json: object(#"{"id":"u1","providers":[]}"#))
        XCTAssertNil(a?.balanceCents)
        XCTAssertEqual(a?.earlySupporter, false)
    }

    func testAccountSavedByAnOlderVersionStillDecodes() throws {
        let old = Data(#"{"id":"u1","email":null,"name":"Sam","providers":["email"]}"#.utf8)
        let a = try JSONDecoder().decode(AccountInfo.self, from: old)
        XCTAssertEqual(a.name, "Sam")
        XCTAssertNil(a.balanceCents)
        XCTAssertNil(a.badges)
    }

    func testReplyWithoutBalanceKeepsTheKnownOne() {
        let known = AccountInfo(id: "u1", email: nil, name: "Sam", providers: ["email"], balanceCents: 480, badges: ["early_supporter"])
        let renamed = AccountInfo(id: "u1", email: nil, name: "Alex", providers: ["email"])
        let merged = renamed.keeping(known)
        XCTAssertEqual(merged.name, "Alex")
        XCTAssertEqual(merged.balanceCents, 480)
        XCTAssertTrue(merged.earlySupporter)
        // Another account never inherits it.
        let other = AccountInfo(id: "u2", email: nil, name: nil, providers: []).keeping(known)
        XCTAssertNil(other.balanceCents)
        XCTAssertFalse(other.earlySupporter)
        // A newer balance wins.
        let newer = AccountInfo(id: "u1", email: nil, name: nil, providers: [], balanceCents: 300).keeping(known)
        XCTAssertEqual(newer.balanceCents, 300)
    }

    func testBalanceUpdateNeverGoesNegative() {
        let a = AccountInfo(id: "u1", email: nil, name: nil, providers: [], balanceCents: 10)
        XCTAssertEqual(a.with(balanceCents: -5).balanceCents, 0)
        XCTAssertEqual(a.with(balanceCents: nil).balanceCents, 10)
    }

    // MARK: Reward reply

    func testRewardCredited() {
        let r = RewardReply.parse(status: 200, json: object(#"{"ok":true,"balanceCents":500,"badges":["early_supporter"]}"#))
        XCTAssertEqual(r, .credited(balanceCents: 500, badges: ["early_supporter"], alreadyClaimed: false))
        XCTAssertTrue(r.settled)
    }

    func testRewardAlreadyClaimedByThisAccount() {
        let r = RewardReply.parse(status: 200, json: object(#"{"ok":true,"balanceCents":420,"badges":["early_supporter"],"alreadyClaimed":true}"#))
        XCTAssertEqual(r, .credited(balanceCents: 420, badges: ["early_supporter"], alreadyClaimed: true))
        XCTAssertTrue(r.settled)
    }

    func testRewardRefusalsAreSettled() {
        for code in ["already_claimed_other_account", "claim_closed"] {
            let r = RewardReply.parse(status: 400, json: ["error": code])
            XCTAssertEqual(r, .refused(code))
            XCTAssertTrue(r.settled, code)
        }
    }

    func testRewardTriesAgainLater() {
        XCTAssertEqual(RewardReply.parse(status: nil, json: [:]), .later)
        XCTAssertEqual(RewardReply.parse(status: 503, json: ["error": "not_configured"]), .later)
        XCTAssertEqual(RewardReply.parse(status: 500, json: [:]), .later)
        XCTAssertEqual(RewardReply.parse(status: 200, json: [:]), .later)
        // Same as Android: a purchase the server couldn't verify is tried again at the next launch.
        XCTAssertEqual(RewardReply.parse(status: 400, json: ["error": "invalid_purchase"]), .later)
        XCTAssertFalse(RewardReply.later.settled)
    }

    // MARK: Any questions?

    func testFreeAnswer() {
        guard case .success(let a) = Ask.reply(status: 200, json: object(#"{"answer":" Hi "}"#)) else { return XCTFail() }
        XCTAssertEqual(a, AskAnswer(text: "Hi"))
        XCTAssertFalse(a.paid)
    }

    func testPaidAnswer() {
        let r = Ask.reply(status: 200, json: object(#"{"answer":"Hi","paid":true,"chargedCents":2,"balanceCents":498}"#))
        guard case .success(let a) = r else { return XCTFail() }
        XCTAssertTrue(a.paid)
        XCTAssertEqual(a.chargedCents, 2)
        XCTAssertEqual(a.balanceCents, 498)
    }

    func testRateLimitedCarriesTheBalance() {
        guard case .failure(let f) = Ask.reply(status: 429, json: object(#"{"error":"rate_limited","balanceCents":0}"#)) else { return XCTFail() }
        XCTAssertEqual(f.balanceCents, 0)
        XCTAssertFalse(f.signedOut)
        XCTAssertEqual(f.text, Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 0))
    }

    func testUsedUpMessageOnlyWithoutBalance() {
        let empty = Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 0)
        let older = Ask.errorMessage(status: 429, error: "rate_limited")
        let paidLimit = Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 300)
        XCTAssertNotEqual(empty, older)
        XCTAssertEqual(older, paidLimit)
    }

    func testRemainingTodayIsRead() {
        guard case .success(let a) = Ask.reply(status: 200, json: object(#"{"answer":"Hi","remainingToday":0,"balanceCents":500}"#)) else { return XCTFail() }
        XCTAssertEqual(a.remainingToday, 0)
        XCTAssertFalse(a.paid)
    }

    func testLimitMessagesFollowTheServersReason() {
        let freeUsed = Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 0, reason: "free_used")
        let lowBalance = Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 2, reason: "low_balance")
        let limit = Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 497, reason: "paid_limit")
        XCTAssertEqual(Set([freeUsed, lowBalance, limit]).count, 3)
        // The shared per-network limit: free questions may be left, so never "you've used them".
        XCTAssertEqual(Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 0, reason: "network"), limit)
        XCTAssertEqual(Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 2, reason: "network"), limit)
        guard case .failure(let f) = Ask.reply(status: 429, json: object(#"{"error":"rate_limited","reason":"network","balanceCents":0}"#)) else { return XCTFail() }
        XCTAssertEqual(f.text, limit)
        // Without a reason (an older server) the balance decides.
        XCTAssertEqual(Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 2), lowBalance)
        XCTAssertEqual(Ask.errorMessage(status: 429, error: "rate_limited", balanceCents: 0), freeUsed)
    }

    func testNoticeBeforeTheFirstPaidQuestion() {
        let today = "2026-11-15"
        XCTAssertNil(Ask.notice(freeLeft: 2, paid: false, day: today, today: today, balanceCents: 500))
        XCTAssertNil(Ask.notice(freeLeft: nil, paid: false, day: nil, today: today, balanceCents: 500))
        // The last free answer (remainingToday 0): warn before anything is charged.
        XCTAssertEqual(Ask.notice(freeLeft: 0, paid: false, day: today, today: today, balanceCents: 500), .usesBalance(500))
        XCTAssertEqual(Ask.notice(freeLeft: 0, paid: true, day: today, today: today, balanceCents: 498), .usesBalance(498))
        XCTAssertEqual(Ask.notice(freeLeft: 0, paid: false, day: today, today: today, balanceCents: 0), .freeUsedUp)
        // 1 or 2 cents can't pay for a question (3-cent minimum).
        XCTAssertEqual(Ask.notice(freeLeft: 0, paid: true, day: today, today: today, balanceCents: 2), .freeUsedUp)
        XCTAssertEqual(Ask.notice(freeLeft: 0, paid: false, day: today, today: today, balanceCents: nil), .freeUsedUp)
        // A new UTC day: free questions are back.
        XCTAssertNil(Ask.notice(freeLeft: 0, paid: true, day: "2026-11-14", today: today, balanceCents: 498))
        XCTAssertTrue(Ask.noticeText(.usesBalance(250)).contains(Money.format(cents: 250)))
    }

    func testUtcDay() {
        XCTAssertEqual(Ask.utcDay(Date(timeIntervalSince1970: 1_794_700_800)), "2026-11-15")
        XCTAssertEqual(Ask.utcDay(Date(timeIntervalSince1970: 1_794_700_799)), "2026-11-14")
    }

    func testPaidNote() {
        let note = Ask.paidNote(charged: 2, left: 498)
        XCTAssertTrue(note.contains(Money.format(cents: 2)), note)
        XCTAssertTrue(note.contains(Money.format(cents: 498)), note)
        XCTAssertTrue(Ask.paidNote(charged: 3, left: nil).contains(Money.format(cents: 3)))
    }
}
