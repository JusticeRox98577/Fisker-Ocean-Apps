import XCTest
@testable import OceanLive

/// The "Support it with a tip" card on the Live screen. Same cases as the Android unit tests.
final class TipBannerTests: XCTestCase {
    private let day: TimeInterval = 86_400
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    private func show(after days: Double, dismissed: Double? = nil, tipped: Double? = nil,
                      mode: Mode = .parked, available: Bool = true, firstLaunch: Date?? = .none) -> Bool {
        let first: Date? = firstLaunch ?? start
        return TipBanner.shouldShow(now: start.addingTimeInterval(days * day),
                                    firstLaunch: first,
                                    dismissedAt: dismissed.map { start.addingTimeInterval($0 * day) },
                                    lastTipAt: tipped.map { start.addingTimeInterval($0 * day) },
                                    mode: mode, available: available)
    }

    func testHiddenInFirstThreeDays() {
        XCTAssertFalse(show(after: 0))
        XCTAssertFalse(show(after: 2.99))
        XCTAssertTrue(show(after: 3))
        XCTAssertTrue(show(after: 40))
    }

    func testHiddenWithoutFirstLaunch() {
        XCTAssertFalse(show(after: 40, firstLaunch: .some(nil)))
    }

    func testHiddenNinetyDaysAfterDismiss() {
        XCTAssertFalse(show(after: 10, dismissed: 5))
        XCTAssertFalse(show(after: 94.9, dismissed: 5))
        XCTAssertTrue(show(after: 95, dismissed: 5))
    }

    func testHiddenHundredEightyDaysAfterTip() {
        XCTAssertFalse(show(after: 10, tipped: 1))
        XCTAssertFalse(show(after: 180.9, tipped: 1))
        XCTAssertTrue(show(after: 181, tipped: 1))
        // A tip right at install also covers the quiet days.
        XCTAssertFalse(show(after: 4, tipped: 0))
    }

    func testDismissAndTipBothCount() {
        XCTAssertFalse(show(after: 100, dismissed: 5, tipped: 50))
        XCTAssertFalse(show(after: 100, dismissed: 50, tipped: -100))
        XCTAssertTrue(show(after: 200, dismissed: 50, tipped: 10))
    }

    func testNeverWhileDrivingOrCharging() {
        XCTAssertFalse(show(after: 30, mode: .driving))
        XCTAssertFalse(show(after: 30, mode: .charging))
        XCTAssertTrue(show(after: 30, mode: .parked))
    }

    func testHiddenWhenTipsUnavailable() {
        XCTAssertFalse(show(after: 30, available: false))
    }

    func testTimeRuleIgnoresMode() {
        XCTAssertTrue(TipBanner.timeAllows(now: start.addingTimeInterval(5 * day), firstLaunch: start, dismissedAt: nil, lastTipAt: nil))
        XCTAssertFalse(TipBanner.timeAllows(now: start.addingTimeInterval(5 * day), firstLaunch: start,
                                            dismissedAt: start.addingTimeInterval(4 * day), lastTipAt: nil))
    }

    func testProductIds() {
        XCTAssertEqual(TipSize.allCases.map(\.productId),
                       ["com.justice.OceanABRP.tip.small", "com.justice.OceanABRP.tip.medium", "com.justice.OceanABRP.tip.large"])
        XCTAssertEqual(TipSize.forProduct("com.justice.OceanABRP.tip.medium"), .medium)
        XCTAssertNil(TipSize.forProduct("tip_medium"))
    }
}
