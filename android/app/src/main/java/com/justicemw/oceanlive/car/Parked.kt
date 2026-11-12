package com.justicemw.oceanlive.car

import java.util.Locale

/** The last reading before the app lost the car: where the battery was and when. */
data class ParkedMark(
    val time: Long,
    val soc: Double,
    val odometerKm: Double? = null,
    val charging: Boolean = false,
)

/** How much the battery dropped while the app wasn't connected and the car sat parked. */
data class ParkedDrain(
    val start: Long,
    val end: Long,
    val socStart: Double,
    val socEnd: Double,
) {
    val hours: Double get() = (end - start) / 3_600_000.0
    /** Percent of the battery lost. Never negative. */
    val drop: Double get() = (socStart - socEnd).coerceAtLeast(0.0)
    val perDay: Double get() = if (hours > 0) drop / hours * 24 else 0.0
    fun kwh(usableKwh: Double): Double = drop / 100 * usableKwh
}

/**
 * Parked drain: compares the first reading after a gap with the last reading
 * before it. Pure logic so it can be unit tested.
 */
object ParkedDrains {
    const val MIN_GAP_MS = 30 * 60_000L
    const val MAX_GAP_MS = 60L * 24 * 3_600_000
    const val MAX_KEEP = 30
    private const val MAX_DROP = 30.0
    private const val MAX_PER_DAY = 20.0

    /**
     * The drop between [mark] and a new reading, or null when it doesn't count:
     * too short a gap, the car was charging, it was driven, or the battery went up.
     */
    fun measure(mark: ParkedMark?, soc: Double?, odometerKm: Double?, now: Long, chargingNow: Boolean): ParkedDrain? {
        if (mark == null || soc == null) return null
        val gap = now - mark.time
        if (gap <= MIN_GAP_MS || gap > MAX_GAP_MS) return null
        if (mark.charging || chargingNow) return null
        if (soc !in 0.0..100.0 || mark.soc !in 0.0..100.0) return null
        // Driven while the app was away: that's not parked drain.
        if (mark.odometerKm != null && odometerKm != null && odometerKm - mark.odometerKm > 0.5) return null
        // A rise means it was charged while away.
        if (soc > mark.soc + 0.05) return null
        val drain = ParkedDrain(mark.time, now, mark.soc, soc)
        if (drain.drop > MAX_DROP) return null
        if (drain.hours >= 6 && drain.perDay > MAX_PER_DAY) return null
        return drain
    }

    fun add(list: List<ParkedDrain>, drain: ParkedDrain): List<ParkedDrain> = (list + drain).takeLast(MAX_KEEP)

    /** Average percent lost per day, weighted by time parked. Null until there's about a day of data. */
    fun averagePerDay(list: List<ParkedDrain>): Double? {
        val hours = list.sumOf { it.hours }
        if (list.isEmpty() || hours < 12) return null
        return list.sumOf { it.drop } / hours * 24
    }

    fun encodeMark(m: ParkedMark): String =
        listOf(m.time.toString(), num(m.soc), m.odometerKm?.let { num(it) } ?: "", if (m.charging) "1" else "0").joinToString(",")

    fun decodeMark(text: String?): ParkedMark? {
        val p = text?.split(",") ?: return null
        if (p.size != 4) return null
        val time = p[0].toLongOrNull() ?: return null
        val soc = p[1].toDoubleOrNull() ?: return null
        return ParkedMark(time, soc, p[2].toDoubleOrNull(), p[3] == "1")
    }

    fun encode(list: List<ParkedDrain>): String =
        list.joinToString(";") { "${it.start},${it.end},${num(it.socStart)},${num(it.socEnd)}" }

    fun decode(text: String?): List<ParkedDrain> {
        if (text.isNullOrBlank()) return emptyList()
        return text.split(";").mapNotNull { row ->
            val p = row.split(",")
            if (p.size != 4) return@mapNotNull null
            val start = p[0].toLongOrNull() ?: return@mapNotNull null
            val end = p[1].toLongOrNull() ?: return@mapNotNull null
            val a = p[2].toDoubleOrNull() ?: return@mapNotNull null
            val b = p[3].toDoubleOrNull() ?: return@mapNotNull null
            ParkedDrain(start, end, a, b)
        }.takeLast(MAX_KEEP)
    }

    private fun num(v: Double) = String.format(Locale.US, "%.2f", v)
}
