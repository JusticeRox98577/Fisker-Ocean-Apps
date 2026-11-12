package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.IdleTimer
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.SleepPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SleepPolicyTest {
    private val min = 60_000L
    private val t0 = 1_700_000_000_000L

    @Test fun asleepAfterThreeMissedPolls() {
        assertFalse(SleepPolicy.carAsleep(0))
        assertFalse(SleepPolicy.carAsleep(2))
        assertTrue(SleepPolicy.carAsleep(3))
        assertTrue(SleepPolicy.carAsleep(4))
    }

    @Test fun reconnectsAreFewAndBackOff() {
        val delays = (1..SleepPolicy.maxReconnects).map { SleepPolicy.reconnectDelay(it)!! }
        assertEquals(3, delays.size)
        assertTrue(delays.zipWithNext().all { (a, b) -> b > a })
        assertNull(SleepPolicy.reconnectDelay(SleepPolicy.maxReconnects + 1))
        assertNull(SleepPolicy.reconnectDelay(0))
    }

    @Test fun idleOnlyWhenParkedInBackgroundWithoutCarScreen() {
        assertTrue(SleepPolicy.idle(Mode.Parked, inForeground = false, carScreen = false))
        assertFalse(SleepPolicy.idle(Mode.Parked, inForeground = true, carScreen = false))
        assertFalse(SleepPolicy.idle(Mode.Parked, inForeground = false, carScreen = true))
        assertFalse(SleepPolicy.idle(Mode.Charging, inForeground = false, carScreen = false))
        assertFalse(SleepPolicy.idle(Mode.Driving, inForeground = false, carScreen = false))
    }

    @Test fun stopsAfterTenMinutesParkedInBackground() {
        val timer = IdleTimer()
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0))
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0 + 9 * min))
        assertTrue(timer.shouldStop(Mode.Parked, false, false, t0 + 10 * min))
    }

    @Test fun foregroundKeepsPolling() {
        val timer = IdleTimer()
        for (i in 0..60) assertFalse(timer.shouldStop(Mode.Parked, true, false, t0 + i * min))
    }

    @Test fun carScreenKeepsPolling() {
        val timer = IdleTimer()
        for (i in 0..60) assertFalse(timer.shouldStop(Mode.Parked, false, true, t0 + i * min))
    }

    @Test fun drivingKeepsPolling() {
        val timer = IdleTimer()
        for (i in 0..60) assertFalse(timer.shouldStop(Mode.Driving, false, false, t0 + i * min))
    }

    @Test fun timerStartsWhenChargingEnds() {
        val timer = IdleTimer()
        for (i in 0..120) assertFalse(timer.shouldStop(Mode.Charging, false, false, t0 + i * min))
        val end = t0 + 121 * min
        assertFalse(timer.shouldStop(Mode.Parked, false, false, end))
        assertFalse(timer.shouldStop(Mode.Parked, false, false, end + 9 * min))
        assertTrue(timer.shouldStop(Mode.Parked, false, false, end + 10 * min))
    }

    @Test fun openingTheAppRestartsTheClock() {
        val timer = IdleTimer()
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0))
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0 + 8 * min))
        assertFalse(timer.shouldStop(Mode.Parked, true, false, t0 + 9 * min)) // app opened
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0 + 10 * min)) // back in background: starts again
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0 + 19 * min))
        assertTrue(timer.shouldStop(Mode.Parked, false, false, t0 + 20 * min))
    }

    @Test fun resetClearsTheClock() {
        val timer = IdleTimer()
        timer.shouldStop(Mode.Parked, false, false, t0)
        timer.reset()
        assertFalse(timer.shouldStop(Mode.Parked, false, false, t0 + 10 * min))
        assertTrue(timer.shouldStop(Mode.Parked, false, false, t0 + 20 * min))
    }
}
