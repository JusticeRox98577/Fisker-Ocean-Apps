package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.learnedWhPerKm
import java.util.Locale
import kotlin.math.roundToInt

/** Number formatting with the user's units. */
object Format {
    const val KM_PER_MI = 1.609344
    const val DEFAULT_WH_PER_KM = 210.0

    fun n(value: Double, decimals: Int): String = String.format(Locale.getDefault(), "%.${decimals}f", value)

    fun temp(c: Double?, s: Settings): String? = c?.let {
        if (s.useFahrenheit) "${(it * 9 / 5 + 32).roundToInt()} °F" else "${n(it, 1)} °C"
    }

    fun distance(km: Double?, s: Settings, decimals: Int = 0): String? = km?.let {
        if (s.useMiles) "${n(it / KM_PER_MI, decimals)} mi" else "${n(it, decimals)} km"
    }

    fun efficiency(whPerKm: Double?, s: Settings): String? = whPerKm?.let {
        if (s.useMiles) "${n(1000 / (it * KM_PER_MI), 2)} mi/kWh" else "${it.roundToInt()} Wh/km"
    }

    fun whPerKm(history: List<HistoryEntry>): Double = learnedWhPerKm(history) ?: DEFAULT_WH_PER_KM

    fun rangeKm(soc: Double?, s: Settings, history: List<HistoryEntry>): Double? {
        if (soc == null || s.usableKwh <= 0) return null
        return soc / 100 * s.usableKwh * 1000 / whPerKm(history)
    }

    fun range(soc: Double?, s: Settings, history: List<HistoryEntry>): String? =
        rangeKm(soc, s, history)?.let { "≈ " + distance(it, s) }

    /** Minutes until the charge reaches the alert level at the current power, or null if not charging toward it. */
    fun minutesToTarget(soc: Double?, powerKw: Double?, s: Settings): Long? {
        if (soc == null || powerKw == null || powerKw < 0.5 || soc >= s.alertHigh || s.usableKwh <= 0) return null
        val kwh = (s.alertHigh - soc) / 100 * s.usableKwh
        return (kwh / powerKw * 60).roundToInt().toLong()
    }

    fun duration(minutes: Long): String = when {
        minutes < 60 -> "$minutes min"
        else -> "${minutes / 60} h ${minutes % 60} min"
    }

    /** A rough length of time, e.g. "45 min", "19 h", "3.5 days". */
    fun span(hours: Double, s: Strings): String = when {
        hours < 1 -> "${(hours * 60).roundToInt()} min"
        hours < 48 -> "${hours.roundToInt()} h"
        else -> s.get(R.string.span_days, n(hours / 24, 1))
    }

    fun money(value: Double?, s: Settings): String? = value?.let { s.currency + n(it, 2) }
}
