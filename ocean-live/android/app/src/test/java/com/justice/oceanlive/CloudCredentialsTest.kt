package com.justice.oceanlive

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CloudCredentialsTest {
    private val sdk = "eyJ0ZXN0.cGF5bG9hZA.c2lnbmF0dXJl"
    private val session = "eyJzZXNzaW9u.cGF5bG9hZA.c2lnbmF0dXJl"
    private val vin = "VCF1ZBU20PG000001"
    private val body = """{"extUserId":"owner@example.com","fleetId":5,"token":"00000000-0000-4000-8000-000000000001"}"""
    private fun request(path: String, method: String = "GET", bearer: String = session) = buildJsonObject {
        put("method", method)
        put("url", "https://ccc.skipti.com/api/v1/$path")
        putJsonArray("headers") { add(buildJsonObject { put("name", "Authorization"); put("value", "Bearer $bearer") }) }
        if (method == "POST") putJsonObject("postData") { put("text", body) }
    }
    private fun har(vararg requests: JsonObject) = buildJsonObject {
        putJsonObject("log") { putJsonArray("entries") { requests.forEach { req -> add(buildJsonObject { put("request", req) }) } } }
    }.toString()
    private fun rejected(capture: String, fallback: String = "") {
        assertThrows(IllegalArgumentException::class.java) { CloudCredentials.parse(capture, fallback) }
    }

    @Test fun importsHarUsingLoginBearerEvenWhenStatsComesFirst() {
        val result = CloudCredentials.parse(har(request("fisker/shortstats?vin=$vin"), request("goloopsdk/login", "POST", sdk)))
        assertEquals(sdk, result.bearer)
        assertEquals("owner@example.com", result.email)
        assertEquals("5", result.fleet)
        assertEquals("00000000-0000-4000-8000-000000000001", result.token)
        assertEquals(vin, result.vin)
    }
    @Test fun importsRawRequestWithManualVin() {
        val result = CloudCredentials.parse("POST /api/v1/goloopsdk/login HTTP/2\nauthorization: Bearer $sdk\n\n$body", vin.lowercase())
        assertEquals(sdk, result.bearer)
        assertEquals(vin, result.vin)
    }
    @Test fun importsCredentialBundle() {
        val bundle = Json.parseToJsonElement(body).jsonObject.toMutableMap().apply {
            put("sdkBearer", JsonPrimitive(sdk)); put("vin", JsonPrimitive(vin))
        }
        assertEquals(vin, CloudCredentials.parse(JsonObject(bundle).toString()).vin)
    }
    @Test fun ignoresStatsHeaderBeforeRawLogin() {
        val raw = "GET /api/v1/fisker/shortstats?vin=$vin HTTP/2\nauthorization: Bearer $session\n\nPOST /api/v1/goloopsdk/login HTTP/2\nauthorization: Bearer $sdk\n\n$body"
        assertEquals(sdk, CloudCredentials.parse(raw, vin).bearer)
    }
    @Test fun refusesStatsBearerAsLogin() { rejected(har(request("fisker/shortstats?vin=$vin"))) }
    @Test fun refusesMissingAndTruncatedValues() {
        rejected("POST /api/v1/goloopsdk/login\nauthorization: Bearer eyJcutoff\n$body", vin)
        rejected(har(request("goloopsdk/login", "POST", sdk)))
        rejected("not a request", vin)
        rejected("POST /api/v1/goloopsdk/login\nauthorization: Bearer $sdk\n${body.replace("00000000-0000-4000-8000-000000000001", "incomplete")}", vin)
    }
    @Test fun ignoresUnrelatedHosts() {
        val other = JsonObject(request("goloopsdk/login", "POST", sdk).toMutableMap().apply { put("url", JsonPrimitive("https://example.com/api/v1/goloopsdk/login")) })
        rejected(har(other), vin)
    }
    @Test fun rejectsMixedCarsAndAccounts() {
        rejected(har(request("goloopsdk/login", "POST", sdk), request("fisker/shortstats?vin=$vin"), request("fisker/shortstats?vin=VCF1ZBU20PG000002")))
        val other = JsonObject(request("goloopsdk/login", "POST", sdk).toMutableMap().apply {
            put("postData", buildJsonObject { put("text", body.replace("owner@", "other@")) })
        })
        rejected(har(request("goloopsdk/login", "POST", sdk), other), vin)
    }
    @Test fun rejectsOversizedInput() { rejected("x".repeat(CloudCredentials.MAX_CAPTURE_SIZE + 1)) }
}
