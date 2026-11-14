package com.justicemw.oceanlive.car

import android.content.Context
import androidx.annotation.StringRes
import androidx.core.content.edit
import com.justicemw.oceanlive.BuildConfig
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.obd.DtcCatalog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.UnknownHostException
import java.util.Locale
import java.util.UUID

/** One message in the "Any questions?" chat. */
data class AskTurn(val fromOwner: Boolean, val text: String)

data class AskChat(
    val turns: List<AskTurn> = emptyList(),
    val waiting: Boolean = false,
    @StringRes val error: Int? = null,
    /** The question that failed, to put back into the text field. */
    val retry: String? = null,
)

/**
 * "Any questions?": sends the owner's question to the Ocean Live proxy (ask-proxy/), which asks
 * Claude with a Fisker Ocean knowledge guide. The proxy holds the API key; the app never has one.
 *
 * Car readings come only from what the app already has in memory. Asking never talks to the car.
 * The chat lives in memory only and is gone when the app closes.
 */
object Ask {
    /** The proxy address from the build (OCEAN_ASK_URL); empty hides the feature. */
    val url: String = BuildConfig.ASK_URL.trim()
    val enabled: Boolean get() = url.startsWith("https://")

    private const val MAX_TURNS = 12

    private val _chat = MutableStateFlow(AskChat())
    val chat: StateFlow<AskChat> = _chat.asStateFlow()

    fun clear() = _chat.update { if (it.waiting) it else AskChat() }

    /**
     * Sends [question] with the conversation so far. [car] is the readings text from [carSummary],
     * or null when the owner turned sharing off.
     */
    suspend fun send(context: Context, question: String, car: String?) {
        val q = question.trim().take(2000)
        if (q.isEmpty() || _chat.value.waiting) return
        _chat.update { it.copy(turns = it.turns + AskTurn(true, q), waiting = true, error = null, retry = null) }
        val turns = _chat.value.turns.takeLast(MAX_TURNS).dropWhile { !it.fromOwner }
        val result = post(context, requestBody(installId(context), turns, car))
        _chat.update {
            when (result) {
                is Reply.Answer -> it.copy(turns = it.turns + AskTurn(false, result.text), waiting = false)
                // Take the question back out so the owner can try again; the text field gets it back.
                is Reply.Failed -> it.copy(turns = it.turns.dropLast(1), waiting = false, error = result.message, retry = q)
            }
        }
    }

    fun requestBody(device: String, turns: List<AskTurn>, car: String?): JSONObject = JSONObject().apply {
        put("device", device)
        put("messages", JSONArray().apply {
            turns.forEach { t -> put(JSONObject().put("role", if (t.fromOwner) "user" else "assistant").put("text", t.text)) }
        })
        if (!car.isNullOrBlank()) put("car", car)
    }

    sealed interface Reply {
        data class Answer(val text: String) : Reply
        data class Failed(@StringRes val message: Int) : Reply
    }

    /** What the proxy's error codes mean for the owner. */
    @StringRes
    fun errorMessage(code: Int, error: String?): Int = when {
        error == "signin_required" || code == 401 -> R.string.ask_error_signin
        error == "rate_limited" || code == 429 -> R.string.ask_error_limit
        error == "budget" -> R.string.ask_error_budget
        error == "no_answer" -> R.string.ask_error_no_answer
        else -> R.string.ask_error_server
    }

    private suspend fun post(context: Context, body: JSONObject): Reply = withContext(Dispatchers.IO) {
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 90_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept-Language", Locale.getDefault().toLanguageTag())
                Accounts.token?.let { setRequestProperty("Authorization", "Bearer $it") }
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = runCatching { JSONObject(text) }.getOrNull()
            val answer = json?.optString("answer").orEmpty().trim()
            // The server no longer knows this session: back to the sign-in screen.
            if (code == 401) Accounts.sessionEnded(context)
            if (code in 200..299 && answer.isNotEmpty()) Reply.Answer(answer)
            else Reply.Failed(errorMessage(code, json?.optString("error")))
        } catch (_: UnknownHostException) {
            Reply.Failed(R.string.ask_error_offline)
        } catch (_: Exception) {
            Reply.Failed(R.string.ask_error_server)
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * A random id for this install. The proxy counts questions per day by it and saves it with
     * each question in the research log; the owner quotes it to have their questions deleted.
     */
    fun installId(context: Context): String {
        val p = Settings.prefs(context)
        p.getString("ask_device", null)?.let { return it }
        val id = UUID.randomUUID().toString()
        p.edit { putString("ask_device", id) }
        return id
    }

    /**
     * The car's latest readings and fault codes as plain text for Claude, in metric units with the
     * owner's units noted. Leaves out the VIN and anything else that identifies the car or owner.
     */
    fun carSummary(state: CarState, faults: FaultScan, settings: Settings, now: Long): String {
        val s = state.snapshot
        val lines = mutableListOf<String>()
        fun n(v: Double, d: Int) = String.format(Locale.US, "%.${d}f", v)
        fun ago(t: Long): String {
            val min = ((now - t) / 60_000).coerceAtLeast(0)
            return when {
                min < 1 -> "just now"
                min < 120 -> "$min min ago"
                min < 48 * 60 -> "${min / 60} h ago"
                else -> "${min / 1440} days ago"
            }
        }
        val model = when (settings.model) {
            CarModel.Big -> "Ultra / Extreme / One (about 106.5 kWh usable)"
            CarModel.Sport -> "Sport (about 75 kWh usable)"
            CarModel.Custom -> "custom, ${n(settings.customKwh, 1)} kWh usable"
        }
        lines += "Car model set in the app: $model"
        lines += "Owner's units: " + (if (settings.useMiles) "miles" else "km") + ", " + (if (settings.useFahrenheit) "°F" else "°C")
        if (s.time > 0) {
            lines += "Readings taken: ${ago(s.time)}" + if (state.connected) " (connected now)" else " (not connected now)"
            lines += "Car state: " + state.mode.name.lowercase()
            s.soc?.let { lines += "State of charge: ${n(it, 1)} %" }
            if (s.packV != null || s.packA != null) {
                lines += "Pack: " + listOfNotNull(s.packV?.let { "${n(it, 1)} V" }, s.packA?.let { "${n(it, 1)} A" }, s.powerKw?.let { "${n(it, 1)} kW" })
                    .joinToString(", ") + " (current and power are positive into the pack)"
            }
            if (s.tempAvg != null || s.tempMin != null || s.tempMax != null) {
                lines += "Battery temperature: " + listOfNotNull(s.tempAvg?.let { "avg ${n(it, 1)}" }, s.tempMin?.let { "min ${n(it, 1)}" }, s.tempMax?.let { "max ${n(it, 1)}" })
                    .joinToString(", ") + " °C"
            }
            if (s.coolantIn != null || s.coolantOut != null) {
                lines += "Coolant: " + listOfNotNull(s.coolantIn?.let { "in ${n(it, 1)}" }, s.coolantOut?.let { "out ${n(it, 1)}" }).joinToString(", ") + " °C"
            }
            if (s.cellAvg != null || s.cellMin != null || s.cellMax != null) {
                lines += "Cell voltage: " + listOfNotNull(
                    s.cellAvg?.let { "avg ${n(it, 0)}" }, s.cellMin?.let { "min ${n(it, 0)}" }, s.cellMax?.let { "max ${n(it, 0)}" }, s.cellSpread?.let { "spread ${n(it, 0)}" },
                ).joinToString(", ") + " mV"
            }
            s.isolation?.let { lines += "Insulation resistance: ${n(it, 0)} kΩ" }
            s.aux12v?.let { lines += "12 V battery: ${n(it, 2)} V" + (s.aux12vSource?.let { src -> " ($src)" } ?: "") }
            s.odometerKm?.let { lines += "Odometer: ${n(it, 0)} km" }
        } else {
            lines += "No readings yet (the app has not been connected to the car)."
        }
        val finished = faults.finishedAt
        if (finished != null) {
            val codes = faults.codes.filter { it.code !in DtcCatalog.placeholders }
            lines += "Last fault scan: ${ago(finished)}, ${codes.size} code(s)" + if (codes.isEmpty()) "" else ":"
            codes.take(40).forEach { d ->
                lines += "- ${d.code} from ${d.ecu.code} (${d.ecu.name}), ${d.state.name.lowercase()}: ${d.info.title}"
            }
        } else {
            lines += "No fault scan in this session."
        }
        return lines.joinToString("\n")
    }
}
