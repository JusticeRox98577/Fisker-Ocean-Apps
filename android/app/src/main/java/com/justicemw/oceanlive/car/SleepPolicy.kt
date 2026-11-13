package com.justicemw.oceanlive.car

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R

/**
 * When Ocean Live should stop talking to the car so it can go to sleep.
 * Every request on the OBD bus keeps the car's modules awake and drains the
 * 12V battery, so the app stops as soon as it isn't needed. Pure logic so it
 * can be unit tested.
 */
object SleepPolicy {
    /** Polls in a row with no answer from the car before it counts as asleep. */
    const val MISSES_BEFORE_ASLEEP = 3

    /** Parked with the app in the background and no car screen for this long: stop reading. */
    const val PARKED_IDLE_MS = 10 * 60_000L

    /** Waits before each reconnect after the adapter drops while the car is still answering. */
    private val RECONNECT_DELAYS_MS = longArrayOf(2_000L, 5_000L, 15_000L)

    val maxReconnects: Int get() = RECONNECT_DELAYS_MS.size

    /** Why reading stopped, as string resources. */
    @StringRes val ASLEEP_MESSAGE = R.string.sleep_asleep
    @StringRes val PARKED_MESSAGE = R.string.sleep_parked
    @StringRes val GAVE_UP_MESSAGE = R.string.sleep_gave_up

    /** True once the car has missed enough polls in a row to count as asleep or off. */
    fun carAsleep(misses: Int): Boolean = misses >= MISSES_BEFORE_ASLEEP

    /** How long to wait before reconnect [attempt] (1, 2, ...), or null to give up. */
    fun reconnectDelay(attempt: Int): Long? = RECONNECT_DELAYS_MS.getOrNull(attempt - 1)

    /**
     * Whether nothing needs live data right now: the car is parked (not driving or
     * charging), no app screen is showing and no Android Auto screen is connected.
     */
    fun idle(mode: Mode, inForeground: Boolean, carScreen: Boolean): Boolean =
        mode == Mode.Parked && !inForeground && !carScreen
}

/**
 * Times how long the app has been continuously idle (see [SleepPolicy.idle]).
 * Driving, charging, opening the app or a car screen resets the clock, so the
 * 10 minutes start again when charging ends or the app goes to the background.
 */
class IdleTimer(private val limitMs: Long = SleepPolicy.PARKED_IDLE_MS) {
    private var since: Long? = null

    /** Called after each reading. Returns true when the app should stop reading. */
    fun shouldStop(mode: Mode, inForeground: Boolean, carScreen: Boolean, now: Long): Boolean {
        if (!SleepPolicy.idle(mode, inForeground, carScreen)) {
            since = null
            return false
        }
        val start = since ?: now.also { since = it }
        return now - start >= limitMs
    }

    fun reset() {
        since = null
    }
}
