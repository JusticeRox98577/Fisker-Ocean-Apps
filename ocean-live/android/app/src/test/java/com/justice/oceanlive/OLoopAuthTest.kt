package com.justice.oceanlive

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class OLoopAuthTest {
    private val bearer = "eyJ0ZXN0.cGF5bG9hZA.c2lnbmF0dXJl"
    private val uuid = "00000000-0000-4000-8000-000000000001"
    private val vin = "VCF1ZBU20PG000001"
    private val headers = headersOf(HttpHeaders.ContentType, "application/json")

    @Test fun reconstructsAccountWithoutSendingPasswordToVehicleService() = runBlocking {
        var calls = 0
        val client = HttpClient(MockEngine { req ->
            val body = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
            calls++
            when (calls) {
                1 -> {
                    assertEquals("https://ovloop.auth0.com/oauth/token", req.url.toString())
                    assertEquals("private-password", body["password"]!!.jsonPrimitive.content)
                    assertEquals("password", body["grant_type"]!!.jsonPrimitive.content)
                    assertEquals(OLoopAuth.CLIENT_ID, body["client_id"]!!.jsonPrimitive.content)
                    respond("""{"access_token":"$bearer","refresh_token":"refresh-one"}""", headers = headers)
                }
                2 -> {
                    assertEquals("https://ccc.skipti.com/api/v1/user/profile", req.url.toString())
                    assertEquals("Bearer $bearer", req.headers["Authorization"])
                    assertEquals("owner@example.com", body["email"]!!.jsonPrimitive.content)
                    assertEquals(2, body["menuVersion"]!!.jsonPrimitive.int)
                    assertFalse(body.containsKey("password"))
                    respond("""{"email":"owner@example.com","phoneAsKeyId":"$uuid","goLoopFleetId":5}""", headers = headers)
                }
                else -> {
                    assertEquals("https://ccc.skipti.com/api/v1/goloopsdk/login", req.url.toString())
                    assertEquals("Bearer $bearer", req.headers["Authorization"])
                    assertEquals(uuid, body["token"]!!.jsonPrimitive.content)
                    assertEquals("owner@example.com", body["extUserId"]!!.jsonPrimitive.content)
                    assertTrue(body["b64PublicKey"]!!.jsonPrimitive.content.length > 100)
                    assertFalse(body.containsKey("password"))
                    respond("""{"success":true,"reservations":[{"vin":"$vin"},{"vin":"$vin"}]}""", headers = headers)
                }
            }
        })
        try {
            val account = OLoopAuth(client).signIn(" owner@example.com ", "private-password")
            assertEquals(3, calls)
            assertEquals(listOf(vin), account.vins)
            val credentials = account.credentials(vin)
            assertEquals(bearer, credentials.bearer)
            assertEquals(uuid, credentials.token)
            assertEquals("5", credentials.fleet)
            assertEquals("refresh-one", account.tokens.refresh)
        } finally { client.close() }
    }

    @Test fun refreshPreservesExistingRefreshTokenWhenServerDoesNotRotateIt() = runBlocking {
        val client = HttpClient(MockEngine { req ->
            val body = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
            assertEquals("refresh_token", body["grant_type"]!!.jsonPrimitive.content)
            assertEquals("refresh-one", body["refresh_token"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("password"))
            respond("""{"access_token":"$bearer"}""", headers = headers)
        })
        try { assertEquals("refresh-one", OLoopAuth(client).refresh("refresh-one").refresh) }
        finally { client.close() }
    }

    @Test fun doesNotExposeAuthenticationResponseSecretsInErrors() = runBlocking {
        val client = HttpClient(MockEngine {
            respond("""{"error_description":"private-password $bearer"}""", HttpStatusCode.Unauthorized, headers)
        })
        try {
            try { OLoopAuth(client).signIn("owner@example.com", "private-password"); fail("Expected sign-in failure") }
            catch (e: IllegalArgumentException) {
                assertTrue(e.message!!.contains("401"))
                assertFalse(e.message!!.contains("private-password"))
                assertFalse(e.message!!.contains(bearer))
            }
        } finally { client.close() }
    }

    @Test fun missingProfileFieldsDoNotCreateCredentials() = runBlocking {
        var calls = 0
        val client = HttpClient(MockEngine {
            respond(if (++calls == 1) """{"access_token":"$bearer"}""" else "{}", headers = headers)
        })
        try {
            try { OLoopAuth(client).signIn("owner@example.com", "password"); fail("Expected missing profile failure") }
            catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("fleet ID")) }
            assertEquals(2, calls)
        } finally { client.close() }
    }
}
