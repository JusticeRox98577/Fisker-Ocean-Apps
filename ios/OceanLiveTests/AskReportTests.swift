import XCTest
@testable import OceanLive

/// "Report this answer" in Any questions?: the question id from /ask, the POST /ask/report request and
/// the reply. Pure logic only; nothing here talks to the server.
final class AskReportTests: XCTestCase {
    private func object(_ s: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(s.utf8)) as! [String: Any]
    }

    // MARK: Question id

    func testQuestionIdIsAnOpaqueString() {
        let json = object(#"{"a":"q_7f3a","b":12345,"c":" 42 ","d":"","e":true,"f":1.5,"g":null,"h":0}"#)
        XCTAssertEqual(AskReport.questionId(json["a"]), "q_7f3a")
        XCTAssertEqual(AskReport.questionId(json["b"]), "12345")
        XCTAssertEqual(AskReport.questionId(json["c"]), "42")
        XCTAssertNil(AskReport.questionId(json["d"]))
        XCTAssertNil(AskReport.questionId(json["e"]))
        XCTAssertNil(AskReport.questionId(json["f"]))
        XCTAssertNil(AskReport.questionId(json["g"]))
        XCTAssertEqual(AskReport.questionId(json["h"]), "0")
        XCTAssertNil(AskReport.questionId(nil))
        XCTAssertNil(AskReport.questionId(String(repeating: "x", count: 201)))
    }

    func testAnswerCarriesItsQuestionId() {
        guard case .success(let a) = Ask.reply(status: 200, json: object(#"{"answer":"Hi","questionId":981}"#)) else { return XCTFail() }
        XCTAssertEqual(a.questionId, "981")
        guard case .success(let b) = Ask.reply(status: 200, json: object(#"{"answer":"Hi","questionId":"abc"}"#)) else { return XCTFail() }
        XCTAssertEqual(b.questionId, "abc")
    }

    func testAnswerFromAnOlderServerHasNoQuestionId() {
        guard case .success(let a) = Ask.reply(status: 200, json: object(#"{"answer":"Hi"}"#)) else { return XCTFail() }
        XCTAssertNil(a.questionId)
    }

    // MARK: Request

    func testReportAddressIsNextToAsk() {
        XCTAssertEqual(AskReport.url(ask: URL(string: "https://api.oceanlive.org/ask"))?.absoluteString, "https://api.oceanlive.org/ask/report")
        XCTAssertEqual(AskReport.url(ask: URL(string: "https://api.oceanlive.org/ask/"))?.absoluteString, "https://api.oceanlive.org/ask/report")
        XCTAssertEqual(AskReport.url(ask: URL(string: "https://x.workers.dev"))?.absoluteString, "https://x.workers.dev/ask/report")
        XCTAssertNil(AskReport.url(ask: nil))
    }

    func testBodyHasIdReasonAndDevice() {
        let body = AskReport.body(questionId: "981", reason: .offensive, note: "", device: "abc-12345")
        XCTAssertEqual(body["questionId"] as? String, "981")
        XCTAssertEqual(body["reason"] as? String, "offensive")
        XCTAssertEqual(body["device"] as? String, "abc-12345")
        XCTAssertNil(body["note"])
    }

    func testReasonsMatchTheServer() {
        XCTAssertEqual(ReportReason.allCases.map(\.rawValue), ["offensive", "harmful", "wrong", "other"])
        for r in ReportReason.allCases { XCTAssertFalse(r.label.isEmpty) }
    }

    func testNoteIsTrimmedAndCut() {
        XCTAssertEqual(AskReport.body(questionId: "1", reason: .wrong, note: "  The range is off \n", device: "d")["note"] as? String,
                       "The range is off")
        XCTAssertNil(AskReport.body(questionId: "1", reason: .other, note: " \n ", device: "d")["note"])
        let long = String(repeating: "a", count: 800)
        XCTAssertEqual((AskReport.body(questionId: "1", reason: .harmful, note: long, device: "d")["note"] as? String)?.count, AskReport.maxNote)
    }

    func testNoteLimitCountsLikeTheServer() {
        // The proxy counts UTF-16 units (JavaScript's length): an emoji is two, and is never cut in half.
        let emoji = String(repeating: "😀", count: 300)
        let note = AskReport.body(questionId: "1", reason: .other, note: emoji, device: "d")["note"] as? String
        XCTAssertEqual(note?.utf16.count, 500)
        XCTAssertEqual(note?.count, 250)
        XCTAssertEqual(AskReport.cut("a😀", utf16: 2), "a")
        XCTAssertEqual(AskReport.cut("short", utf16: 500), "short")
    }

    func testRequestIsJsonPostWithBearerWhenSignedIn() throws {
        let url = URL(string: "https://api.oceanlive.org/ask/report")!
        let body = AskReport.body(questionId: "7", reason: .wrong, note: "x", device: "d")
        let signedIn = AskReport.request(url: url, body: body, token: "tok")
        XCTAssertEqual(signedIn.httpMethod, "POST")
        XCTAssertEqual(signedIn.url, url)
        XCTAssertEqual(signedIn.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(signedIn.value(forHTTPHeaderField: "Content-Type"), "application/json; charset=utf-8")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(signedIn.httpBody)) as? [String: Any])
        XCTAssertEqual(sent["questionId"] as? String, "7")
        XCTAssertEqual(sent["reason"] as? String, "wrong")
        XCTAssertEqual(sent["note"] as? String, "x")
        XCTAssertEqual(sent["device"] as? String, "d")

        let anonymous = AskReport.request(url: url, body: body, token: nil)
        XCTAssertNil(anonymous.value(forHTTPHeaderField: "Authorization"))
    }

    // MARK: Reply

    func testOkIsSent() {
        XCTAssertEqual(AskReport.parse(status: 200, json: object(#"{"ok":true}"#)), .sent)
    }

    func testOkFalseOrNoJsonIsAFailure() {
        XCTAssertNotEqual(AskReport.parse(status: 200, json: object(#"{"ok":false}"#)), .sent)
        XCTAssertNotEqual(AskReport.parse(status: 200, json: nil), .sent)
    }

    func testErrorsHaveDistinctMessages() {
        guard case .failed(let gone, let s1) = AskReport.parse(status: 404, json: object(#"{"error":"not_found"}"#)),
              case .failed(let limit, let s2) = AskReport.parse(status: 429, json: object(#"{"error":"rate_limited"}"#)),
              case .failed(let bad, let s3) = AskReport.parse(status: 400, json: object(#"{"error":"bad_request"}"#)),
              case .failed(let server, let s4) = AskReport.parse(status: 500, json: nil)
        else { return XCTFail() }
        XCTAssertEqual(Set([gone, limit, bad]).count, 3)
        XCTAssertEqual(bad, server)
        XCTAssertFalse(s1 || s2 || s3 || s4)
    }

    func testUnauthorizedSignsOut() {
        guard case .failed(let text, let signedOut) = AskReport.parse(status: 401, json: object(#"{"error":"signin_required"}"#)) else { return XCTFail() }
        XCTAssertTrue(signedOut)
        XCTAssertFalse(text.isEmpty)
    }

    func testErrorCodeWinsOverStatus() {
        XCTAssertEqual(AskReport.parse(status: 400, json: object(#"{"error":"rate_limited"}"#)),
                       AskReport.parse(status: 429, json: nil))
        XCTAssertEqual(AskReport.parse(status: 400, json: object(#"{"error":"not_found"}"#)),
                       AskReport.parse(status: 404, json: nil))
    }
}
