package com.justice.oceanlive

import java.net.URI
import java.net.URLDecoder
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// No data-class toString: credentials should never appear in logs.
class CloudCredentials(
    val bearer: String, val email: String, val fleet: String, val token: String, val vin: String
) {
    companion object {
        const val MAX_CAPTURE_SIZE = 4 * 1024 * 1024
        private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.content?.trim().orEmpty()

        fun parse(capture: String, vinOrStats: String = ""): CloudCredentials {
            require(capture.length + vinOrStats.length <= MAX_CAPTURE_SIZE) { "Capture is too large. Export only the login and shortstats requests." }
            val json = runCatching { Json.parseToJsonElement(capture.trim()) as? JsonObject }.getOrNull()
            if (json?.get("log") is JsonObject) return fromHar(json, vinOrStats)
            val body = json ?: run {
                val start = capture.indexOf('{')
                val end = capture.lastIndexOf('}')
                require(start >= 0 && end > start) { "Paste the full login request with its JSON body, or import a HAR file." }
                runCatching { Json.parseToJsonElement(capture.substring(start, end + 1)) as? JsonObject }.getOrNull()
                    ?: throw IllegalArgumentException("Login JSON could not be read. Copy the full request body.")
            }
            val bearer = if (body.text("sdkBearer").isNotEmpty()) body.text("sdkBearer") else {
                val loginStart = capture.indexOf("/goloopsdk/login")
                val bodyStart = capture.indexOf('{')
                require(loginStart >= 0 && bodyStart > loginStart) { "Include the goloopsdk/login URL, authorization header and JSON body." }
                // Keep the bearer matched with the login request and its account fields.
                Regex("(?i)authorization\\s*:\\s*Bearer\\s+([A-Za-z0-9_.-]+)")
                    .find(capture.substring(loginStart, bodyStart))?.groupValues?.get(1).orEmpty()
            }
            return validated(bearer, body, body.text("vin").ifBlank { extractVin(vinOrStats) })
        }

        private fun fromHar(har: JsonObject, fallbackVin: String): CloudCredentials {
            val entries = (har["log"] as JsonObject)["entries"] as? JsonArray
                ?: throw IllegalArgumentException("HAR has no requests.")
            val requests = entries.mapNotNull { (it as? JsonObject)?.get("request") as? JsonObject }
            fun matches(request: JsonObject, path: String): Boolean = runCatching {
                val uri = URI(request.text("url"))
                uri.scheme == "https" && uri.host.equals("ccc.skipti.com", true) && uri.path.trimEnd('/') == path
            }.getOrDefault(false)
            val logins = requests.filter { it.text("method") == "POST" && matches(it, "/api/v1/goloopsdk/login") }
            require(logins.isNotEmpty()) { "No goloopsdk/login request found. Reopen the Fisker app while capturing and export again." }
            val parsed = logins.map { request ->
                val headers = request["headers"] as? JsonArray
                val auth = headers?.mapNotNull { it as? JsonObject }?.firstOrNull { it.text("name").equals("authorization", true) }?.text("value").orEmpty()
                val bearer = Regex("(?i)^Bearer\\s+(.+)$").find(auth)?.groupValues?.get(1).orEmpty()
                val postData = request["postData"] as? JsonObject
                val body = runCatching { Json.parseToJsonElement(postData?.text("text").orEmpty()) as? JsonObject }.getOrNull()
                    ?: throw IllegalArgumentException("Login request body is missing. Enable Full payload before capturing.")
                bearer to body
            }
            require(parsed.map { listOf(it.first, it.second.text("extUserId"), it.second.text("fleetId"), it.second.text("token")) }.distinct().size == 1) {
                "Capture contains different logins. Export requests for one account and session only."
            }
            val vins = requests.filter { matches(it, "/api/v1/fisker/shortstats") }
                .map { extractVin(it.text("url")) }.filter { it.isNotBlank() }.distinct()
            require(vins.size <= 1) { "Capture contains multiple VINs. Export requests for one car only." }
            return validated(parsed.last().first, parsed.last().second, vins.singleOrNull() ?: extractVin(fallbackVin))
        }

        private fun extractVin(text: String): String {
            val match = Regex("(?i)[?&]vin=([^&#\\s]+)").find(text)
            return if (match != null) runCatching { URLDecoder.decode(match.groupValues[1], "UTF-8") }.getOrDefault("") else text.trim()
        }

        private fun validated(bearer: String, body: JsonObject, rawVin: String): CloudCredentials {
            require(Regex("eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+").matches(bearer)) {
                "SDK bearer is missing or incomplete. Copy the full authorization header from goloopsdk/login."
            }
            val email = body.text("extUserId")
            require(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+").matches(email)) { "Account email (extUserId) is missing or invalid." }
            val fleet = body.text("fleetId")
            require(fleet.toIntOrNull()?.let { it >= 0 } == true) { "Fleet ID is missing or invalid." }
            val token = body.text("token")
            require(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}").matches(token)) { "Login token must be the complete UUID from the login body." }
            val vin = rawVin.uppercase(Locale.US)
            require(Regex("[A-HJ-NPR-Z0-9]{17}").matches(vin)) { "Enter the 17-character VIN or include the shortstats?vin= request." }
            return CloudCredentials(bearer, email, fleet, token, vin)
        }
    }
}
