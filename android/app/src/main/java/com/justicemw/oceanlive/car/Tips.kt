package com.justicemw.oceanlive.car

/**
 * Tips ("Support Ocean Live"): the product IDs and when the small banner on the Live tab may show.
 * A tip unlocks nothing. Pure logic so it can be unit tested; the Google Play side is in TipJar.
 * The banner shows on the phone's Live tab in portrait only (a landscape phone is often mounted as the
 * car's screen), never in Android Auto or widgets. iOS follows the same rule.
 */
object Tips {
    /** One-time consumable products in Google Play, smallest first. */
    val PRODUCT_IDS = listOf("tip_small", "tip_medium", "tip_large")

    const val DAY_MS = 86_400_000L

    /** No banner in the first days after the app is first opened. */
    const val QUIET_START_DAYS = 3

    /** Hidden this long after the banner is closed. */
    const val AFTER_DISMISS_DAYS = 90

    /** Hidden this long after any tip. */
    const val AFTER_TIP_DAYS = 180

    /** Saved times in epoch milliseconds; 0 means never. */
    data class Dates(val firstLaunch: Long = 0L, val dismissedAt: Long = 0L, val lastTipAt: Long = 0L)

    /**
     * True when the banner may show. Never while driving or charging, and only when the
     * tips could be loaded from the store ([available]); otherwise there is nothing to offer.
     * A clock set back before a saved date keeps the banner hidden rather than showing it early.
     */
    fun showBanner(now: Long, dates: Dates, mode: Mode, available: Boolean): Boolean {
        if (!available) return false
        if (mode == Mode.Driving || mode == Mode.Charging) return false
        if (dates.firstLaunch <= 0L || now - dates.firstLaunch < QUIET_START_DAYS * DAY_MS) return false
        if (dates.dismissedAt > 0L && now - dates.dismissedAt < AFTER_DISMISS_DAYS * DAY_MS) return false
        if (dates.lastTipAt > 0L && now - dates.lastTipAt < AFTER_TIP_DAYS * DAY_MS) return false
        return true
    }
}
