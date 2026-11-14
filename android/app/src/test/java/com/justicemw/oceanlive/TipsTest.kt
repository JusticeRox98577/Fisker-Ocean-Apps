package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Tips
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TipsTest {
    private val day = Tips.DAY_MS
    private val t0 = 1_700_000_000_000L
    private val settled = Tips.Dates(firstLaunch = t0)
    private val later = t0 + 10 * day

    private fun show(now: Long, dates: Tips.Dates = settled, mode: Mode = Mode.Parked, available: Boolean = true) =
        Tips.showBanner(now, dates, mode, available)

    @Test fun productIdsMatchGooglePlay() {
        assertEquals(listOf("tip_small", "tip_medium", "tip_large"), Tips.PRODUCT_IDS)
    }

    @Test fun hiddenInTheFirstThreeDays() {
        assertFalse(show(t0))
        assertFalse(show(t0 + 3 * day - 1))
        assertTrue(show(t0 + 3 * day))
    }

    @Test fun hiddenWithoutAFirstLaunchOrWithTheClockSetBack() {
        assertFalse(show(later, Tips.Dates()))
        assertFalse(show(t0 - day))
    }

    @Test fun hiddenWhileDrivingOrCharging() {
        assertTrue(show(later, mode = Mode.Parked))
        assertFalse(show(later, mode = Mode.Driving))
        assertFalse(show(later, mode = Mode.Charging))
    }

    @Test fun hiddenWhenTipsCantBeLoaded() {
        assertFalse(show(later, available = false))
    }

    @Test fun closingHidesItFor90Days() {
        val dates = settled.copy(dismissedAt = later)
        assertFalse(show(later, dates))
        assertFalse(show(later + 90 * day - 1, dates))
        assertTrue(show(later + 90 * day, dates))
    }

    @Test fun aTipHidesItFor180Days() {
        val dates = settled.copy(lastTipAt = later)
        assertFalse(show(later + 90 * day, dates))
        assertFalse(show(later + 180 * day - 1, dates))
        assertTrue(show(later + 180 * day, dates))
    }

    @Test fun theLongerPauseWins() {
        // Closed long ago but tipped recently: still hidden.
        val dates = settled.copy(dismissedAt = later, lastTipAt = later + 100 * day)
        assertFalse(show(later + 200 * day, dates))
        assertTrue(show(later + 280 * day, dates))
    }

    @Test fun bannerStringsExistInEnglish() {
        assertEquals("Enjoying Ocean Live? Support it with a tip", EnStrings.get(R.string.tips_banner_text))
        assertTrue(EnStrings.get(R.string.tips_body).contains("A tip unlocks nothing"))
    }
}
