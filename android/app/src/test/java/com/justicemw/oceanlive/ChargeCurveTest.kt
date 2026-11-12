package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.ChargeCurve
import com.justicemw.oceanlive.car.ChargeSample
import com.justicemw.oceanlive.car.ChargeSamples
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.HistoryStore
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Snapshot
import com.justicemw.oceanlive.car.Tracker
import com.justicemw.oceanlive.car.regenPercent
import com.justicemw.oceanlive.car.regenTotals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChargeCurveTest {
    private fun snap(t: Long, soc: Double, amps: Double, odo: Double?, temp: Double? = 25.0) =
        Snapshot(soc = soc, packV = 400.0, packA = amps, odometerKm = odo, tempAvg = temp, time = t)

    @Test fun samplesAboutEveryTenSeconds() {
        val tr = Tracker()
        var t = 0L
        // 10 kW for 10 minutes with a 2 s poll.
        repeat(301) { tr.update(snap(t, 50.0 + it * 0.01, 25.0, 1000.0)); t += 2_000 }
        assertEquals(Mode.Charging, tr.mode)
        val done = (0..3).flatMap { tr.update(snap(t + it * 2_000L, 53.0, 0.0, 1000.0)) }
        val samples = done.single().samples!!
        assertTrue(samples.size in 55..65)
        assertEquals(10.0, samples[1].kw, 0.01)
        assertEquals(25.0, samples[1].tempC!!, 0.01)
        assertTrue(samples.zipWithNext().all { (a, b) -> b.time - a.time >= 9_000 })
    }

    @Test fun flushKeepsSamples() {
        val tr = Tracker()
        var t = 0L
        repeat(100) { tr.update(snap(t, 50.0, 25.0, 1000.0)); t += 2_000 }
        val out = tr.flush(t)
        assertEquals(1, out.size)
        assertNotNull(out[0].samples)
    }

    @Test fun longChargeStaysUnderCap() {
        val b = ChargeSamples()
        // 10 hours at 10 s.
        for (i in 0 until 3_600) b.add(ChargeSample(i * 10_000L, i / 36.0, 7.0, null))
        val list = b.list()
        assertTrue(list.size < ChargeCurve.MAX_SAMPLES)
        assertTrue(list.size > ChargeCurve.MAX_SAMPLES / 4)
        // Still covers the whole session.
        assertEquals(0L, list.first().time)
        assertTrue(list.last().time > 9 * 3_600_000L)
    }

    @Test fun pointsAreBinnedBySoc() {
        val s = listOf(
            ChargeSample(0, 10.2, 100.0, null), ChargeSample(10_000, 10.8, 120.0, null),
            ChargeSample(20_000, 12.0, 150.0, null), ChargeSample(30_000, null, 90.0, null),
            ChargeSample(40_000, 11.5, 140.0, null),
        )
        val p = ChargeCurve.points(s)
        assertEquals(3, p.size)
        assertEquals(10.5, p[0].first, 0.001)
        assertEquals(110.0, p[0].second, 0.001)
        assertEquals(11.5, p[1].first, 0.001)
        assertEquals(150.0, ChargeCurve.peak(s)!!.second, 0.001)
    }

    @Test fun tenToEightyOnlyWhenCovered() {
        // 1 % a minute from 5 % to 90 %.
        val s = (0..85).map { ChargeSample(it * 60_000L, 5.0 + it, 50.0, null) }
        assertEquals(70.0, ChargeCurve.minutesBetween(s)!!, 0.01)
        assertNull(ChargeCurve.minutesBetween(s.filter { it.soc!! >= 20 }))
        assertNull(ChargeCurve.minutesBetween(s.filter { it.soc!! <= 70 }))
        assertEquals(50.0, ChargeCurve.averageKw(s)!!, 0.001)
    }

    @Test fun axisMaxIsRounded() {
        assertEquals(10.0, ChargeCurve.axisMax(7.2), 0.0)
        assertEquals(200.0, ChargeCurve.axisMax(173.0), 0.0)
        assertEquals(350.0, ChargeCurve.axisMax(320.0), 0.0)
    }

    @Test fun onlyLatestChargesKeepSamples() {
        val samples = listOf(ChargeSample(0, 10.0, 5.0, null), ChargeSample(10_000, 11.0, 5.0, null))
        val list = (0 until 60).flatMap {
            listOf(
                HistoryEntry(EntryKind.Charge, it * 10L, it * 10L + 1, 10.0, 11.0, 1.0, samples = samples),
                HistoryEntry(EntryKind.Drive, it * 10L + 2, it * 10L + 3, 11.0, 10.0, 1.0),
            )
        }
        val trimmed = ChargeCurve.trim(list)
        val charges = trimmed.filter { it.kind == EntryKind.Charge }
        assertEquals(60, charges.size)
        assertEquals(10, charges.count { it.samples == null })
        assertTrue(charges.takeLast(50).all { it.samples != null })
    }

    @Test fun historyRoundTripsAndOldFilesLoad() {
        val samples = listOf(ChargeSample(1_000_000, 20.0, 50.25, 21.5), ChargeSample(1_010_000, null, 49.0, null))
        val entries = listOf(
            HistoryEntry(EntryKind.Charge, 1_000_000, 2_000_000, 20.0, 60.0, 30.0, peakKw = 50.25, fast = true, samples = samples),
            HistoryEntry(EntryKind.Drive, 3_000_000, 4_000_000, 60.0, 50.0, 8.0, distanceKm = 40.0, regenKwh = 1.2),
        )
        assertEquals(entries, HistoryStore.decode(HistoryStore.encode(entries)))

        val old = """[{"kind":"Drive","start":1,"end":2,"socStart":80,"socEnd":70,"kwh":10,"km":50,"fast":false},
            {"kind":"Charge","start":3,"end":4,"kwh":20,"peakKw":11,"fast":false}]"""
        val loaded = HistoryStore.decode(old)
        assertEquals(2, loaded.size)
        assertNull(loaded[0].regenKwh)
        assertNull(loaded[1].samples)
    }

    @Test fun regenIsCountedSeparately() {
        val tr = Tracker()
        var t = 0L
        var odo = 1000.0
        // 10 minutes at 60 km/h taking 20 kW, then 5 minutes giving back 10 kW.
        repeat(300) { odo += 60.0 / 3600 * 2; tr.update(snap(t, 80.0, -50.0, odo)); t += 2_000 }
        repeat(150) { odo += 60.0 / 3600 * 2; tr.update(snap(t, 78.0, 25.0, odo)); t += 2_000 }
        val d = tr.currentDrive!!
        assertEquals(0.83, d.regenKwh!!, 0.05)
        assertEquals(3.33 - 0.83, d.kwh, 0.05)
        assertEquals(33.0, regenPercent(d.regenKwh!!, d.kwh)!!, 2.0)
    }

    @Test fun regenTotalsSkipOldDrives() {
        val list = listOf(
            HistoryEntry(EntryKind.Drive, 0, 1, 80.0, 70.0, 10.0),
            HistoryEntry(EntryKind.Drive, 2, 3, 70.0, 60.0, 8.0, regenKwh = 1.0),
            HistoryEntry(EntryKind.Drive, 4, 5, 60.0, 50.0, 12.0, regenKwh = 3.0),
        )
        assertEquals(4.0 to 20.0, regenTotals(list))
        assertNull(regenTotals(list.take(1)))
        assertNull(regenPercent(0.1, 0.0))
    }
}
