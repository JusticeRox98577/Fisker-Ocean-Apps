package com.justicemw.oceanlive.wear

import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The last reading the phone sent. The phone app writes it to the Data Layer at
 * [PATH]; the keys match WatchReading.toMap() in the phone app.
 */
data class WatchReading(
    val soc: Double? = null,
    val rangeKm: Double? = null,
    val powerKw: Double? = null,
    val charging: Boolean = false,
    val fast: Boolean = false,
    val minutesToTarget: Long? = null,
    val targetPercent: Int? = null,
    val aux12v: Double? = null,
    val status: String = "Not connected",
    val live: Boolean = false,
    val miles: Boolean = true,
    val updatedAt: Long = 0,
) {
    /** The phone said it was reading, and the reading is recent enough to believe it. */
    fun liveAt(now: Long): Boolean = live && now - updatedAt < STALE_MS

    fun toMap(): Map<String, Any> = buildMap {
        soc?.let { put("soc", it) }
        rangeKm?.let { put("rangeKm", it) }
        powerKw?.let { put("powerKw", it) }
        put("charging", charging)
        put("fast", fast)
        minutesToTarget?.let { put("minutesToTarget", it) }
        targetPercent?.let { put("targetPercent", it) }
        aux12v?.let { put("aux12v", it) }
        put("status", status)
        put("live", live)
        put("miles", miles)
        put("updatedAt", updatedAt)
    }

    companion object {
        const val PATH = "/ocean/live"
        /** The phone refreshes at least once a minute while reading; older than this means it stopped. */
        const val STALE_MS = 3 * 60_000L

        /** Reads a Data Layer map (or the saved copy). Numbers may come back as any type. */
        fun fromMap(m: Map<String, Any?>): WatchReading? {
            val updatedAt = (m["updatedAt"] as? Number)?.toLong() ?: return null
            return WatchReading(
                soc = (m["soc"] as? Number)?.toDouble(),
                rangeKm = (m["rangeKm"] as? Number)?.toDouble(),
                powerKw = (m["powerKw"] as? Number)?.toDouble(),
                charging = m["charging"] as? Boolean ?: false,
                fast = m["fast"] as? Boolean ?: false,
                minutesToTarget = (m["minutesToTarget"] as? Number)?.toLong(),
                targetPercent = (m["targetPercent"] as? Number)?.toInt(),
                aux12v = (m["aux12v"] as? Number)?.toDouble(),
                status = m["status"] as? String ?: "Not connected",
                live = m["live"] as? Boolean ?: false,
                miles = m["miles"] as? Boolean ?: true,
                updatedAt = updatedAt,
            )
        }
    }
}

/** Text for the watch screen, tile and complication. Same wording as the phone app. */
object WatchFormat {
    const val KM_PER_MI = 1.609344

    private fun n(value: Double, decimals: Int) = String.format(Locale.getDefault(), "%.${decimals}f", value)

    fun soc(r: WatchReading?): String = r?.soc?.let { "${it.roundToInt()}%" } ?: "—"

    fun range(r: WatchReading): String? = r.rangeKm?.let {
        if (r.miles) "≈ ${(it / KM_PER_MI).roundToInt()} mi" else "≈ ${it.roundToInt()} km"
    }

    fun power(kw: Double?): String = kw?.let { n(abs(it), 1) + " kW" } ?: "— kW"

    /** Which way the energy flows, as on the phone's Live screen. */
    fun powerLabel(r: WatchReading): String {
        val p = r.powerKw
        return when {
            p == null -> "power"
            p > 0.3 -> if (r.charging) "into the battery" else "regenerating"
            p < -0.3 -> "from the battery"
            else -> "idle"
        }
    }

    /** The phone's status, or "Not connected" if it went quiet without saying so. */
    fun status(r: WatchReading, now: Long): String = if (r.live && !r.liveAt(now)) "Not connected" else r.status

    fun duration(minutes: Long): String = when {
        minutes < 60 -> "$minutes min"
        else -> "${minutes / 60} h ${minutes % 60} min"
    }

    fun toTarget(r: WatchReading, now: Long): String? {
        if (!r.charging || !r.liveAt(now)) return null
        val m = r.minutesToTarget ?: return null
        val target = r.targetPercent ?: return null
        return "To $target% ≈ ${duration(m)}"
    }

    fun aux(volts: Double?): String? = volts?.let {
        val state = when {
            it >= 13.2 -> "Charging"
            it >= 12.4 -> "Good"
            it >= 12.0 -> "Low"
            else -> "Very low"
        }
        "12V " + n(it, 1) + " V · " + state
    }

    fun ago(updatedAt: Long, now: Long): String {
        if (updatedAt <= 0) return "No reading yet"
        val min = (now - updatedAt).coerceAtLeast(0) / 60_000
        return when {
            min < 1 -> "Updated just now"
            min < 60 -> "Updated $min min ago"
            min < 48 * 60 -> "Updated ${min / 60} h ago"
            else -> "Updated ${min / (24 * 60)} days ago"
        }
    }
}
