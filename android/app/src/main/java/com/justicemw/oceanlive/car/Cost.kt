package com.justicemw.oceanlive.car

import java.util.Calendar
import java.util.TimeZone

/** Price per kWh for this charge, or null if that price isn't set. DC fast charges use the DC price. */
fun Settings.pricePerKwh(e: HistoryEntry): Double? =
    (if (e.fast) dcPrice else homePrice).takeIf { it > 0 }

/** What a charge cost at today's prices, or null for drives and when no price is set. */
fun Settings.chargeCost(e: HistoryEntry): Double? {
    if (e.kind != EntryKind.Charge) return null
    return pricePerKwh(e)?.let { e.kwh * it }
}

data class MonthTotals(
    val charges: Int,
    val kwh: Double,
    /** Null when none of the month's charges has a price set. */
    val cost: Double?,
)

/**
 * Charging totals for a calendar month: [monthsAgo] = 0 is the month containing [now],
 * 1 is the month before, and so on.
 */
fun monthTotals(
    history: List<HistoryEntry>,
    settings: Settings,
    now: Long,
    monthsAgo: Int = 0,
    zone: TimeZone = TimeZone.getDefault(),
): MonthTotals {
    val cal = Calendar.getInstance(zone).apply {
        timeInMillis = now
        set(Calendar.DAY_OF_MONTH, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
        add(Calendar.MONTH, -monthsAgo)
    }
    val from = cal.timeInMillis
    cal.add(Calendar.MONTH, 1)
    val until = cal.timeInMillis
    val charges = history.filter { it.kind == EntryKind.Charge && it.start in from until until }
    val costs = charges.mapNotNull { settings.chargeCost(it) }
    return MonthTotals(charges.size, charges.sumOf { it.kwh }, if (costs.isEmpty()) null else costs.sum())
}
