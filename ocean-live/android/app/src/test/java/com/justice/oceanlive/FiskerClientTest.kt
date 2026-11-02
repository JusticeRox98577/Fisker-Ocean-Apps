package com.justice.oceanlive

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.*
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class FiskerClientTest {
    private val headers = headersOf(HttpHeaders.ContentType, "application/json")
    private fun client(handler: MockRequestHandler) = HttpClient(MockEngine(handler)) {
        expectSuccess = true
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }

    @Test fun statsUsesOriginalBearerRatherThanReservationToken() = runBlocking {
        var calls = 0
        val http = client { req ->
            assertEquals("Bearer original-access", req.headers["Authorization"])
            if (++calls == 1) respond("""{"success":true,"reservations":[{"token":"reservation-uuid"}]}""", headers = headers)
            else {
                assertEquals("/api/v1/fisker/shortstats", req.url.encodedPath)
                respond("""{"data":{"battery":{"percent":76}}}""", headers = headers)
            }
        }
        try {
            val cloud = FiskerClient("original-access", "owner@example.com", 5, "phone-id", http)
            assertEquals(76, cloud.shortStats("VCF1ZBU20PG000001").battery.percent)
            assertEquals(2, calls)
        } finally { http.close() }
    }

    @Test fun expiredBearerRefreshesOnceThenRetriesLoginAndStats() = runBlocking {
        var calls = 0
        var refreshes = 0
        val http = client { req ->
            calls++
            assertEquals("Bearer " + if (calls <= 2) "old-access" else "new-access", req.headers["Authorization"])
            when (calls) {
                1, 3 -> respond("""{"success":true,"reservations":[]}""", headers = headers)
                2 -> respond("{}", HttpStatusCode.Unauthorized, headers)
                else -> respond("""{"data":{"battery":{"percent":80}}}""", headers = headers)
            }
        }
        try {
            val cloud = FiskerClient("old-access", "owner@example.com", 5, "phone-id", http) { refreshes++; "new-access" }
            assertEquals(80, cloud.shortStats("VCF1ZBU20PG000001").battery.percent)
            assertEquals(1, refreshes)
            assertEquals(4, calls)
        } finally { http.close() }
    }
}
