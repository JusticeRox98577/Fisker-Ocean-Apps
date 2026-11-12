package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Snapshot
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.car.WatchSync
import com.justicemw.oceanlive.car.WatchThrottle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchSyncTest {
    private val t0 = 1_700_000_000_000L
    private val settings = Settings(useMiles = false, alertHigh = 80)

    private fun live(soc: Double = 50.0, time: Long = t0, mode: Mode = Mode.Parked, packA: Double = -2.0) = CarState(
        status = Status.Live,
        snapshot = Snapshot(soc = soc, packV = 400.0, packA = packA, aux12v = 12.6, time = time),
        mode = mode,
        lastUpdate = time,
    )

    private fun reading(state: CarState) = WatchSync.reading(state, settings, emptyList())

    @Test fun liveParkedReading() {
        val r = reading(live())
        assertTrue(r.live)
        assertEquals("Parked", r.status)
        assertFalse(r.charging)
        assertEquals(-0.8, r.powerKw!!, 1e-9)
        // 50% of 106.5 kWh at the default 210 Wh/km.
        assertEquals(253.6, r.rangeKm!!, 0.1)
        assertNull(r.minutesToTarget)
        assertEquals(80, r.targetPercent)
        assertEquals(t0, r.updatedAt)
    }

    @Test fun chargingHasTimeToTarget() {
        val charge = HistoryEntry(EntryKind.Charge, t0, t0, 50.0, 50.0, 0.0, fast = true)
        // 400 V x 100 A = 40 kW into the pack; 30% of 106.5 kWh = 31.95 kWh -> 48 min.
        val r = reading(live(packA = 100.0, mode = Mode.Charging).copy(currentCharge = charge))
        assertTrue(r.charging)
        assertTrue(r.fast)
        assertEquals("DC fast charging", r.status)
        assertEquals(48L, r.minutesToTarget)
    }

    @Test fun stoppedReadingIsNotConnected() {
        val r = reading(live().copy(status = Status.Idle, resting = true))
        assertFalse(r.live)
        assertEquals("Not connected", r.status)
        assertNull(r.powerKw)
        assertEquals(50.0, r.soc!!, 1e-9) // last known charge stays, with its time
        assertEquals(t0, r.updatedAt)
        assertEquals("Reconnecting", reading(live().copy(status = Status.Reconnecting)).status)
    }

    @Test fun mapLeavesOutUnknownValues() {
        val m = reading(CarState()).toMap()
        assertFalse("soc" in m)
        assertFalse("powerKw" in m)
        assertEquals("Not connected", m["status"])
        assertEquals(false, m["live"])
    }

    @Test fun throttleWaitsForAFreshReading() {
        val th = WatchThrottle()
        assertFalse(th.shouldSend(reading(CarState()), t0))
        assertTrue(th.shouldSend(reading(live()), t0))
    }

    @Test fun throttleSendsChangesAtMostEvery15s() {
        val th = WatchThrottle()
        assertTrue(th.shouldSend(reading(live(50.0)), t0))
        assertFalse(th.shouldSend(reading(live(50.0, t0 + 2_000)), t0 + 2_000)) // nothing changed
        assertFalse(th.shouldSend(reading(live(50.5, t0 + 4_000)), t0 + 4_000)) // changed, too soon
        assertTrue(th.shouldSend(reading(live(50.5, t0 + 16_000)), t0 + 16_000))
        // Unchanged values still go out once a minute so the watch knows they're current.
        assertFalse(th.shouldSend(reading(live(50.5, t0 + 60_000)), t0 + 60_000))
        assertTrue(th.shouldSend(reading(live(50.5, t0 + 77_000)), t0 + 77_000))
    }

    @Test fun throttleSendsOneFinalStateWhenReadingStops() {
        val th = WatchThrottle()
        assertTrue(th.shouldSend(reading(live()), t0))
        val stopped = reading(live().copy(status = Status.Idle))
        assertTrue(th.shouldSend(stopped, t0 + 1_000)) // straight away, not throttled
        assertFalse(th.shouldSend(stopped, t0 + 100_000)) // and only once
        assertFalse(th.shouldSend(reading(live(40.0).copy(status = Status.Error)).copy(status = "Not connected"), t0 + 200_000))
    }

    @Test fun statusChangeGoesOutImmediately() {
        val th = WatchThrottle()
        assertTrue(th.shouldSend(reading(live()), t0))
        assertTrue(th.shouldSend(reading(live(mode = Mode.Driving)), t0 + 2_000))
    }

    @Test fun minutesToTarget() {
        assertNull(Format.minutesToTarget(85.0, 7.0, settings))
        assertNull(Format.minutesToTarget(50.0, 0.2, settings))
        assertEquals(274L, Format.minutesToTarget(50.0, 7.0, settings))
    }
}
