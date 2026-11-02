package com.justice.oceanlive

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.*
import java.security.KeyPairGenerator
import java.util.Base64

// Recovered from the installed O Loop 1.3.1 client. This is a public OAuth client ID,
// not a client secret. Passwords are sent only to the original authentication host.
internal class OLoopAuth(private val http: HttpClient = HttpClient(OkHttp) {
    install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 15_000 }
}) : AutoCloseable {
    companion object {
        const val CLIENT_ID = "0o56La53yZHn39sDjpRJEE6XOT3ZSdEM"
        private const val AUTH = "https://ovloop.auth0.com/oauth/token"
        private const val CLOUD = "https://ccc.skipti.com/api/v1"
        private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.content?.trim().orEmpty()
    }

    class Tokens(val access: String, val refresh: String?)
    class Account(val tokens: Tokens, val email: String, val fleet: Int, val loginToken: String, val vins: List<String>) {
        fun credentials(vin: String): CloudCredentials = CloudCredentials.parse(buildJsonObject {
            put("sdkBearer", tokens.access); put("extUserId", email); put("fleetId", fleet)
            put("token", loginToken); put("vin", vin)
        }.toString())
    }

    private suspend fun post(url: String, body: JsonObject, bearer: String? = null): JsonObject {
        val response = http.post(url) {
            contentType(ContentType.Application.Json)
            header("Accept", "*/*")
            if (bearer != null) header("Authorization", "Bearer $bearer")
            setBody(body.toString())
        }
        if (response.status.value !in 200..299) {
            // Do not surface response bodies: authentication errors can echo supplied input.
            val stage = if (url == AUTH) "O Loop sign-in" else "Vehicle account lookup"
            val detail = when (response.status.value) {
                400, 401, 403 -> if (url == AUTH) "Check your email and password. The service may also require verification or block this login method." else "The service did not authorize this account."
                429 -> "Too many attempts. Wait before trying again."
                else -> "Try again later."
            }
            throw IllegalArgumentException("$stage failed (HTTP ${response.status.value}). $detail")
        }
        val raw: String = response.body()
        return runCatching { Json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            ?: throw IllegalArgumentException("The service returned an unexpected response.")
    }

    private fun tokens(json: JsonObject, previousRefresh: String? = null): Tokens {
        val access = json.text("access_token")
        require(access.isNotBlank()) { "Sign-in returned no access token." }
        return Tokens(access, json.text("refresh_token").ifBlank { previousRefresh })
    }

    suspend fun refresh(refreshToken: String): Tokens = tokens(post(AUTH, buildJsonObject {
        put("grant_type", "refresh_token"); put("client_id", CLIENT_ID); put("refresh_token", refreshToken)
    }), refreshToken)

    suspend fun signIn(email: String, password: String): Account {
        require(email.isNotBlank() && password.isNotEmpty()) { "Enter your account email and password." }
        val tokens = tokens(post(AUTH, buildJsonObject {
            put("username", email.trim()); put("password", password); put("grant_type", "password")
            put("scope", "openid profile email offline_access"); put("client_id", CLIENT_ID)
        }))
        val profileResponse = post("$CLOUD/user/profile", buildJsonObject {
            put("email", email.trim()); put("menuVersion", 2)
        }, tokens.access)
        val profile = profileResponse["data"] as? JsonObject ?: profileResponse
        val accountEmail = profile.text("email").ifBlank { email.trim() }
        val fleet = profile.text("goLoopFleetId").toIntOrNull()
            ?: throw IllegalArgumentException("The account profile has no vehicle fleet ID.")
        val loginToken = profile.text("phoneAsKeyId")
        require(loginToken.isNotBlank()) { "The account profile has no phone-as-key login ID." }
        val publicKey = Base64.getEncoder().encodeToString(
            KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair().public.encoded
        )
        val loginResponse = post("$CLOUD/goloopsdk/login", buildJsonObject {
            put("extUserId", accountEmail); put("fleetId", fleet); put("token", loginToken)
            put("cryptoVersion", "1.0"); put("b64PublicKey", publicKey)
        }, tokens.access)
        val login = loginResponse["data"] as? JsonObject ?: loginResponse
        require((login["success"] as? JsonPrimitive)?.booleanOrNull != false) { "The vehicle service did not accept the account login." }
        val vins = (login["reservations"] as? JsonArray).orEmpty().mapNotNull {
            (it as? JsonObject)?.text("vin")?.uppercase(java.util.Locale.US)?.takeIf { vin -> Regex("[A-HJ-NPR-Z0-9]{17}").matches(vin) }
        }.distinct()
        return Account(tokens, accountEmail, fleet, loginToken, vins)
    }

    override fun close() = http.close()
}
