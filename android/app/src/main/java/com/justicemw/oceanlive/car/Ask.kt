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

/**
 * One message in the "Any questions?" chat. An answer paid from the balance has [paidCents]
 * (what it cost) and [balanceCents] (what's left after it). [questionId] is the server's id for an
 * answer (opaque), used to report it; [reported] is true once a report for it was sent.
 */
data class AskTurn(
    val fromOwner: Boolean,
    val text: String,
    val paidCents: Int? = null,
    val balanceCents: Int? = null,
    val questionId: String? = null,
    val reported: Boolean = false,
)

/** Why an AI answer is reported; [wire] is what POST /ask/report expects. */
enum class ReportReason(val wire: String, @StringRes val label: Int) {
    Offensive("offensive", R.string.ask_report_offensive),
    Harmful("harmful", R.string.ask_report_harmful),
    Wrong("wrong", R.string.ask_report_wrong),
    Other("other", R.string.ask_report_other),
}

data class AskChat(
    val turns: List<AskTurn> = emptyList(),
    val waiting: Boolean = false,
    @StringRes val error: Int? = null,
    /** The question that failed, to put back into the text field. */
    val retry: String? = null,
    /** Free questions left today, from the last answer (remainingToday). */
    val freeLeft: Int? = null,
    /** The last answer was paid from the balance: today's free questions are used up. */
    val paidLast: Boolean = false,
    /** The UTC day [freeLeft] and [paidLast] are for; free questions reset at midnight UTC. */
    val day: String? = null,
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

    /** A new chat; what's known about today's free questions stays. */
    fun clear() = _chat.update { if (it.waiting) it else AskChat(freeLeft = it.freeLeft, paidLast = it.paidLast, day = it.day) }

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
        if (result is Reply.Answer && result.balanceCents != null) Accounts.updateBalance(context, result.balanceCents)
        if (result is Reply.Failed && result.balanceCents != null) Accounts.updateBalance(context, result.balanceCents)
        _chat.update {
            when (result) {
                is Reply.Answer -> it.copy(
                    turns = it.turns + AskTurn(false, result.text, result.chargedCents.takeIf { result.paid }, result.balanceCents.takeIf { result.paid }, result.questionId),
                    waiting = false,
                    freeLeft = result.freeLeft,
                    paidLast = result.paid,
                    day = utcDay(System.currentTimeMillis()),
                )
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
        data class Answer(
            val text: String,
            val paid: Boolean = false,
            val chargedCents: Int? = null,
            val balanceCents: Int? = null,
            val freeLeft: Int? = null,
            val questionId: String? = null,
        ) : Reply

        data class Failed(@StringRes val message: Int, val balanceCents: Int? = null) : Reply
    }

    /** The proxy's reply, as the chat needs it. */
    fun reply(code: Int, json: JSONObject?): Reply {
        val answer = json?.optString("answer").orEmpty().trim()
        if (code in 200..299 && answer.isNotEmpty()) {
            return Reply.Answer(
                text = answer,
                paid = json?.optBoolean("paid") == true,
                chargedCents = json?.takeIf { it.has("chargedCents") }?.optInt("chargedCents"),
                balanceCents = Balance.centsIn(json),
                freeLeft = json?.takeIf { it.has("remainingToday") }?.optInt("remainingToday"),
                questionId = questionIdIn(json),
            )
        }
        val error = json?.optString("error")
        val balance = Balance.centsIn(json)
        val message = if (error == "rate_limited" || (code == 429 && error.isNullOrEmpty())) Balance.limitMessage(json?.optString("reason")?.takeIf { it.isNotEmpty() }, balance) else errorMessage(code, error)
        return Reply.Failed(message, balance)
    }

    /**
     * The answer's question id in a proxy reply, as an opaque string: the server may send a string
     * or a number (sent back as written, without a decimal point). Null when there is none.
     */
    fun questionIdIn(json: JSONObject?): String? {
        if (json == null || !json.has("questionId") || json.isNull("questionId")) return null
        val id = when (val v = json.opt("questionId")) {
            is String -> v.trim()
            is Int, is Long -> v.toString()
            is Number -> v.toDouble().let { d -> if (d == Math.floor(d) && !d.isInfinite()) java.math.BigDecimal(d).toPlainString() else v.toString() }
            else -> ""
        }
        return id.takeIf { it.isNotEmpty() && it.length <= 200 }
    }

    /** POST /ask/report: next to /ask on the same server. */
    fun reportUrl(askUrl: String): String = askUrl.trim().removeSuffix("/") + "/report"

    /** The body of POST /ask/report. The note is optional and at most [MAX_NOTE] characters. */
    fun reportBody(device: String, questionId: String, reason: ReportReason, note: String?): JSONObject = JSONObject().apply {
        put("device", device)
        put("questionId", questionId)
        put("reason", reason.wire)
        note?.trim()?.take(MAX_NOTE)?.takeIf { it.isNotEmpty() }?.let { put("note", it) }
    }

    const val MAX_NOTE = 500

    /** The answer to a report. */
    sealed interface ReportResult {
        data object Sent : ReportResult
        data class Failed(@StringRes val message: Int) : ReportResult
    }

    /** The proxy's reply to POST /ask/report. */
    fun reportResult(code: Int, json: JSONObject?): ReportResult {
        if (code in 200..299 && json?.optBoolean("ok") == true) return ReportResult.Sent
        return ReportResult.Failed(
            when {
                json?.optString("error") == "not_found" || code == 404 -> R.string.ask_report_error_gone
                json?.optString("error") == "rate_limited" || code == 429 -> R.string.ask_report_error_limit
                code == 401 -> R.string.ask_error_signin
                else -> R.string.ask_report_error
            },
        )
    }

    /**
     * Reports an AI answer as offensive, harmful, wrong or something else. Sent with the same
     * identity as the question (account and install id), so only the asker can report it.
     */
    suspend fun report(context: Context, questionId: String, reason: ReportReason, note: String?): ReportResult {
        val result = withContext(Dispatchers.IO) {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL(reportUrl(url)).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 20_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept-Language", Locale.getDefault().toLanguageTag())
                    Accounts.token?.let { setRequestProperty("Authorization", "Bearer $it") }
                }
                val body = reportBody(installId(context), questionId, reason, note)
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                if (code == 401) Accounts.sessionEnded(context)
                reportResult(code, runCatching { JSONObject(text) }.getOrNull())
            } catch (_: UnknownHostException) {
                ReportResult.Failed(R.string.ask_error_offline)
            } catch (_: Exception) {
                ReportResult.Failed(R.string.ask_report_error)
            } finally {
                conn?.disconnect()
            }
        }
        if (result is ReportResult.Sent) {
            _chat.update { c -> c.copy(turns = c.turns.map { t -> if (!t.fromOwner && t.questionId == questionId) t.copy(reported = true) else t }) }
        }
        return result
    }

    /** The UTC date of [millis], like the proxy's daily count (yyyy-MM-dd). */
    fun utcDay(millis: Long): String = java.time.Instant.ofEpochMilli(millis).toString().take(10)

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
            // The server no longer knows this session: back to the sign-in screen.
            if (code == 401) Accounts.sessionEnded(context)
            reply(code, json)
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
