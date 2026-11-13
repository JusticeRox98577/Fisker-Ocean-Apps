package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.LowVoltAlarm
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.V12Method
import com.justicemw.oceanlive.obd.Elm
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Mode
import com.justicemw.oceanlive.car.V12Recorder
import com.justicemw.oceanlive.car.V12Sample
import com.justicemw.oceanlive.car.V12Stats
import com.justicemw.oceanlive.car.V12Watch
import com.justicemw.oceanlive.car.WakeDetector
import com.justicemw.oceanlive.car.thinForGraph
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class V12Test {
    private val sec = 1_000L
    private val min = 60_000L
    private val hour = 3_600_000L
    private val day = 24 * hour
    private val t0 = 1_700_000_000_000L
    private val port = V12Log.SOURCE_PORT

    private fun s(t: Long, v: Double, mode: V12Mode = V12Mode.Parked, resting: Boolean = false) = V12Sample(t, v, port, mode, resting)

    // ── Thinning ──────────────────────────────────────────────

    @Test fun keepsAboutOncePerMinute() {
        val last = s(t0, 12.60)
        assertFalse(V12Log.shouldKeep(last, s(t0 + 20 * sec, 12.61)))
        assertFalse(V12Log.shouldKeep(last, s(t0 + 59 * sec, 12.62)))
        assertTrue(V12Log.shouldKeep(last, s(t0 + 60 * sec, 12.60)))
        assertTrue(V12Log.shouldKeep(null, s(t0, 12.6)))
    }

    @Test fun keepsChangesOfFiveHundredthsOrMore() {
        val last = s(t0, 12.60)
        assertTrue(V12Log.shouldKeep(last, s(t0 + 10 * sec, 12.65)))
        assertTrue(V12Log.shouldKeep(last, s(t0 + 10 * sec, 12.55)))
        assertFalse(V12Log.shouldKeep(last, s(t0 + 10 * sec, 12.64)))
    }

    @Test fun keepsModeChangesAndSleepingReadings() {
        val last = s(t0, 13.5, V12Mode.Driving)
        assertTrue(V12Log.shouldKeep(last, s(t0 + 5 * sec, 13.5, V12Mode.Parked)))
        assertTrue(V12Log.shouldKeep(s(t0, 12.5, V12Mode.Asleep), s(t0 + 5 * sec, 12.5, V12Mode.Asleep)))
    }

    @Test fun recorderThinsReadingsTakenEveryFewSeconds() {
        val r = V12Recorder()
        r.startSession()
        // Every 10 s for 10 minutes at a steady voltage: about one a minute is kept.
        val kept = (0 until 60).mapNotNull { r.add(t0 + it * 10 * sec, 13.40, port, V12Mode.Driving) }
        assertEquals(10, kept.size)
        // A sudden change is kept straight away.
        assertNotNull(r.add(t0 + 600 * sec + 5 * sec, 13.80, port, V12Mode.Driving))
    }

    // ── 90-day cap ────────────────────────────────────────────

    @Test fun trimDropsReadingsOlderThan90Days() {
        val now = t0 + 100 * day
        val list = listOf(s(t0, 12.5), s(now - 91 * day, 12.5), s(now - 89 * day, 12.6), s(now - hour, 12.7))
        val kept = V12Log.trim(list, now)
        assertEquals(listOf(now - 89 * day, now - hour), kept.map { it.time })
        // Nothing to drop: the same list comes back.
        assertTrue(V12Log.trim(kept, now) === kept)
    }

    @Test fun compactsTheFileOnlyADayPastTheCap() {
        val now = t0 + 200 * day
        assertFalse(V12Log.needsCompaction(emptyList(), now))
        assertFalse(V12Log.needsCompaction(listOf(s(now - 90 * day - hour, 12.5)), now))
        assertTrue(V12Log.needsCompaction(listOf(s(now - 92 * day, 12.5)), now))
    }

    @Test fun fileLinesRoundTrip() {
        val samples = listOf(
            V12Sample(t0, 12.634, V12Log.SOURCE_BMS, V12Mode.Charging),
            V12Sample(t0 + min, 12.41, V12Log.SOURCE_PORT, V12Mode.Parked, resting = true),
            V12Sample(t0 + 2 * min, 12.2, V12Log.SOURCE_ASLEEP, V12Mode.Asleep),
        )
        val back = V12Log.decodeAll(samples.joinToString("\n") { V12Log.encode(it) } + "\nbroken line\n")
        assertEquals(3, back.size)
        assertEquals(12.63, back[0].volts, 1e-9)
        assertEquals(V12Log.SOURCE_BMS, back[0].source)
        assertEquals(V12Mode.Charging, back[0].mode)
        assertTrue(back[1].resting)
        assertEquals(V12Log.SOURCE_ASLEEP, back[2].source)
        assertEquals(V12Mode.Asleep, back[2].mode)
    }

    @Test fun csvHasIsoTimesAndAllColumns() {
        val csv = V12Log.csv(
            listOf(V12Sample(0L, 12.5, V12Log.SOURCE_ASLEEP, V12Mode.Asleep), V12Sample(60_000L, 12.48, port, V12Mode.Parked, true)),
            TimeZone.getTimeZone("UTC"),
        ).lines()
        assertEquals("time,volts,source,mode,resting,method", csv[0])
        // An asleep reading stored before the method was recorded reads as kept open.
        assertEquals("1970-01-01T00:00:00Z,12.50,OBD port while asleep,asleep,false,kept open", csv[1])
        assertEquals("1970-01-01T00:01:00Z,12.48,OBD port,parked,true,", csv[2])
        val quick = V12Log.csv(
            listOf(V12Sample(0L, 12.5, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, method = V12Method.Quick)),
            TimeZone.getTimeZone("UTC"),
        ).lines()
        assertEquals("1970-01-01T00:00:00Z,12.50,OBD port while asleep,asleep,false,quick", quick[1])
    }

    @Test fun methodIsStoredAndOldLinesReadAsKeptOpen() {
        val quick = V12Sample(t0, 12.5, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, method = V12Method.Quick)
        val kept = V12Sample(t0 + min, 12.5, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, method = V12Method.KeptOpen)
        assertEquals("${t0},12.50,S,a,0,q", V12Log.encode(quick))
        assertEquals(V12Method.Quick, V12Log.decode(V12Log.encode(quick))?.watchMethod)
        assertEquals(V12Method.KeptOpen, V12Log.decode(V12Log.encode(kept))?.watchMethod)
        // A line written by an older version: five fields, no method.
        val old = V12Log.decode("${t0},12.48,S,a,0")
        assertNotNull(old)
        assertNull(old!!.method)
        assertEquals(V12Method.KeptOpen, old.watchMethod)
        // Awake readings have no watch method, and an older version still reads the new lines.
        assertNull(V12Log.decode("${t0},13.50,O,d,0")?.watchMethod)
        assertEquals("${t0},13.50,O,d,0", V12Log.encode(V12Sample(t0, 13.5, port, V12Mode.Driving)))
        // An unknown method code is ignored rather than dropping the reading.
        assertEquals(V12Method.KeptOpen, V12Log.decode("${t0},12.48,S,a,0,x")?.watchMethod)
    }

    @Test fun recorderKeepsTheMethodOnAsleepReadingsOnly() {
        val r = V12Recorder()
        assertEquals(V12Method.Quick, r.add(t0, 12.5, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, V12Method.Quick)?.method)
        assertNull(r.add(t0 + 2 * min, 13.6, port, V12Mode.Driving, V12Method.Quick)?.method)
    }

    // ── Resting detection ─────────────────────────────────────

    @Test fun firstReadingAfterTwoHoursAsleepIsResting() {
        val r = V12Recorder()
        r.startSession()
        assertFalse(r.add(t0, 13.6, port, V12Mode.Driving)!!.resting)
        r.startSession()
        val first = r.add(t0 + 2 * hour, 12.55, port, V12Mode.Parked)!!
        assertTrue(first.resting)
        // Only the first reading of the session.
        val second = r.add(t0 + 2 * hour + 2 * min, 12.50, port, V12Mode.Parked)!!
        assertFalse(second.resting)
    }

    @Test fun shortGapIsNotResting() {
        val r = V12Recorder()
        r.startSession()
        r.add(t0, 12.6, port, V12Mode.Parked)
        r.startSession()
        assertFalse(r.add(t0 + 119 * min, 12.55, port, V12Mode.Parked)!!.resting)
    }

    @Test fun readingAlreadyBeingChargedIsNotResting() {
        val r = V12Recorder()
        r.startSession()
        r.add(t0, 12.6, port, V12Mode.Parked)
        r.startSession()
        assertFalse(r.add(t0 + 5 * hour, 13.4, port, V12Mode.Parked)!!.resting)
    }

    @Test fun restingAfterLoadingStoredReadings() {
        val r = V12Recorder()
        r.load(listOf(s(t0, 12.7), s(t0 + 3 * hour, 12.5, V12Mode.Asleep)))
        r.startSession()
        // Sleeping readings don't count as the car being awake, so the gap is from t0.
        assertTrue(r.add(t0 + 4 * hour, 12.45, port, V12Mode.Parked)!!.resting)
    }

    @Test fun noRestingWithoutAnyEarlierReading() {
        val r = V12Recorder()
        r.startSession()
        assertFalse(r.add(t0, 12.5, port, V12Mode.Parked)!!.resting)
    }

    // ── Stats ─────────────────────────────────────────────────

    @Test fun statsRestingChargedAndLastCharged() {
        val list = listOf(
            s(t0, 12.70, resting = true),
            s(t0 + min, 13.60, V12Mode.Driving),
            s(t0 + 2 * min, 13.60, V12Mode.Driving),
            s(t0 + 3 * min, 12.80, V12Mode.Parked),
            s(t0 + 4 * min, 12.80, V12Mode.Parked),
            s(t0 + 10 * hour, 12.30, resting = true),
        )
        val st = V12Stats.of(list, t0)
        assertEquals(12.30, st.latestRest!!.volts, 1e-9)
        assertEquals(12.30, st.lowestRest!!, 1e-9)
        assertEquals(12.50, st.averageRest!!, 1e-9)
        assertEquals(t0 + 2 * min, st.lastCharged)
        // 2 of the counted minutes were at 13.2 V or more; the long gap counts as 5 min at most.
        assertEquals(2.0 / 9.0, st.chargedShare!!, 1e-9)
        assertEquals("Low", EnStrings.get(V12Log.restLabel(12.30)))
        assertEquals("Good", EnStrings.get(V12Log.restLabel(12.40)))
        assertEquals("Very low", EnStrings.get(V12Log.restLabel(11.9)))
    }

    @Test fun overnightDropFromSleepingReadings() {
        val list = listOf(
            s(t0, 13.5, V12Mode.Parked),
            s(t0 + 10 * min, 13.4, V12Mode.Asleep),
            s(t0 + 30 * min, 12.70, V12Mode.Asleep),
            s(t0 + 4 * hour, 12.65, V12Mode.Asleep),
            s(t0 + 8 * hour, 12.62, V12Mode.Asleep),
            s(t0 + 9 * hour, 13.5, V12Mode.Driving),
        )
        val nights = V12Stats.nights(list)
        assertEquals(1, nights.size)
        assertEquals(12.70, nights[0].startVolts, 1e-9)
        assertEquals(12.62, nights[0].endVolts, 1e-9)
        assertEquals(0.08, nights[0].drop, 1e-9)
    }

    @Test fun overnightDropWithoutWatching() {
        val list = listOf(s(t0, 12.75, V12Mode.Parked), s(t0 + 10 * hour, 12.60, resting = true))
        val nights = V12Stats.nights(list)
        assertEquals(1, nights.size)
        assertEquals(0.15, nights[0].drop, 1e-9)
        assertEquals(0.15, V12Stats.of(list, t0).averageNightDrop!!, 1e-9)
    }

    @Test fun graphThinningKeepsExtremesAndRestingPoints() {
        val list = (0 until 5000).map { s(t0 + it * min, if (it == 2500) 11.9 else 12.5 + (it % 7) * 0.01, resting = it == 1234) }
        val pts = thinForGraph(list, t0, t0 + 5000 * min, maxPoints = 600)
        assertTrue(pts.size <= 700)
        assertTrue(pts.any { it.volts == 11.9 })
        assertTrue(pts.any { it.resting })
        assertEquals(pts.sortedBy { it.time }, pts)
    }

    // ── Watching while the car sleeps ─────────────────────────

    @Test fun watchOnlyWhenTurnedOnAndNotStoppedByTheUser() {
        assertTrue(V12Watch.shouldWatch(settingOn = true, userStopped = false))
        assertFalse(V12Watch.shouldWatch(settingOn = false, userStopped = false))
        assertFalse(V12Watch.shouldWatch(settingOn = true, userStopped = true))
    }

    @Test fun checkIntervals() {
        assertEquals(10 * min, V12Watch.intervalMs(10))
        assertEquals(5 * min, V12Watch.intervalMs(5))
        assertEquals(30 * min, V12Watch.intervalMs(30))
        assertEquals(30 * min, V12Watch.intervalMs(7))
        assertEquals(5 * min, V12Watch.nextDelay(5, connected = true, confirmingWake = false))
        assertEquals(V12Watch.CONFIRM_MS, V12Watch.nextDelay(30, connected = true, confirmingWake = true))
        // The Bluetooth link is never retried more often than every 10 minutes.
        assertEquals(10 * min, V12Watch.nextDelay(5, connected = false, confirmingWake = false))
        assertEquals(30 * min, V12Watch.nextDelay(30, connected = false, confirmingWake = false))
    }

    @Test fun defaultsAreThirtyMinutesAndQuickChecks() {
        assertEquals(30, V12Watch.DEFAULT_INTERVAL)
        assertEquals(listOf(5, 10, 30), V12Watch.INTERVALS)
        assertEquals(30, Settings().watchEveryMin)
        assertFalse(Settings().watchKeepConnected)
        assertFalse(Settings().watch12v)
    }

    @Test fun quickCheckUnlessKeptConnected() {
        assertEquals(V12Method.Quick, V12Watch.method(keepConnected = false))
        assertEquals(V12Method.KeptOpen, V12Watch.method(keepConnected = true))
        // Quick checks follow the chosen interval, even after an unreachable one, and confirm a wake-up after a minute.
        assertEquals(30 * min, V12Watch.quickDelay(30, confirmingWake = false))
        assertEquals(5 * min, V12Watch.quickDelay(5, confirmingWake = false))
        assertEquals(V12Watch.CONFIRM_MS, V12Watch.quickDelay(30, confirmingWake = true))
        // The whole check stays short.
        assertTrue(V12Watch.QUICK_TIMEOUT_MS <= 15_000L)
    }

    @Test fun changingTheIntervalMovesTheNextQuickCheck() {
        // Measured from the last check, not from the change, so changing it never adds a connect.
        assertEquals(t0 + 10 * min, V12Watch.quickDue(t0, 10))
        assertEquals(t0 + 30 * min, V12Watch.quickDue(t0, 30))
        assertEquals(t0 + 30 * min, V12Watch.quickDue(t0, 7))
    }

    @Test fun quickCheckSendsOnlyAdapterCommands() {
        val sent = Elm.quickCheckCommands + Elm.READ_VOLTAGE
        assertEquals(listOf("ATE0", "ATS0", "ATRV"), sent)
        // Nothing that resets the adapter, searches for a protocol or puts a frame on the car's network.
        for (c in sent) {
            assertTrue(c, c.startsWith("AT"))
            assertFalse(c, c in listOf("ATZ", "ATWS", "ATD") || c.startsWith("ATSP") || c.startsWith("ATSH"))
        }
    }

    @Test fun unreachableStatusAfterTwoMissesInARow() {
        assertFalse(V12Watch.unreachable(0))
        assertFalse(V12Watch.unreachable(1))
        assertTrue(V12Watch.unreachable(2))
        assertTrue(V12Watch.unreachable(5))
        assertEquals("Car asleep · adapter not reachable", EnStrings.get(R.string.v12_watch_unreachable))
        assertEquals("Watching 12V · next check in 30 min", EnStrings.get(R.string.notif_watching_next, 30))
        assertTrue(EnStrings.get(R.string.settings_watch_quick_note).startsWith("Every 30 minutes (or your choice)"))
    }

    @Test fun minutesUntilTheNextCheck() {
        assertEquals(30, V12Watch.minutesUntil(t0 + 30 * min, t0))
        assertEquals(1, V12Watch.minutesUntil(t0 + 10 * sec, t0))
        assertEquals(1, V12Watch.minutesUntil(t0 - min, t0))
        assertEquals(2, V12Watch.minutesUntil(t0 + 61 * sec, t0))
    }

    @Test fun missesAreStoredAndTrimmed() {
        assertEquals(emptyList<Long>(), V12Watch.decodeMisses(null))
        assertEquals(emptyList<Long>(), V12Watch.decodeMisses(""))
        val list = V12Watch.addMiss(V12Watch.addMiss(emptyList(), t0 - 20 * day), t0)
        assertEquals(listOf(t0), list)
        val two = V12Watch.addMiss(list, t0 + hour)
        assertEquals(two, V12Watch.decodeMisses(V12Watch.encodeMisses(two)))
    }

    @Test fun latestNightSaysHowItWasWatched() {
        assertNull(V12Watch.latestNight(emptyList(), emptyList()))
        // Last night: quick checks with two that couldn't reach the adapter. The night before had one more.
        val samples = listOf(
            s(t0 - day, 12.6),
            s(t0 - day + hour, 12.55, V12Mode.Asleep),
            s(t0 - 2 * hour, 12.7, V12Mode.Parked),
            V12Sample(t0, 12.6, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, method = V12Method.Quick),
            V12Sample(t0 + 2 * hour, 12.58, V12Log.SOURCE_ASLEEP, V12Mode.Asleep, method = V12Method.Quick),
            s(t0 + 8 * hour, 13.8, V12Mode.Driving),
        )
        val misses = listOf(t0 - day + 2 * hour, t0 + hour, t0 + 3 * hour)
        assertEquals(com.justicemw.oceanlive.car.NightChecks(V12Method.Quick, 2), V12Watch.latestNight(samples, misses))
        // An old file without methods reads as kept connected.
        assertEquals(V12Method.KeptOpen, V12Watch.latestNight(samples.take(2), emptyList())?.method)
        // Tonight nothing has reached the adapter yet: no method, one miss counted.
        val tonight = V12Watch.latestNight(samples, misses + (t0 + 9 * hour))
        assertNull(tonight?.method)
        assertEquals(1, tonight?.unreachable)
    }

    @Test fun wakeNeedsTwoHighReadingsInARow() {
        val w = WakeDetector()
        w.enter()
        assertFalse(w.add(12.6))
        assertFalse(w.add(13.1))
        assertTrue(w.confirming)
        assertTrue(w.add(13.0))
    }

    @Test fun oneHighReadingIsNotAWakeUp() {
        val w = WakeDetector()
        w.enter()
        assertFalse(w.add(12.6))
        assertFalse(w.add(13.4))
        assertFalse(w.add(12.6))
        assertFalse(w.add(13.4))
        assertFalse(w.add(null))
        assertFalse(w.add(13.4))
        assertTrue(w.add(13.4))
    }

    @Test fun carStillAwakeWhenWatchingStartsIsNotAWakeUp() {
        val w = WakeDetector()
        w.enter()
        // Parked and still charging the 12V when the app stopped reading.
        assertFalse(w.add(13.6))
        assertFalse(w.add(13.6))
        assertFalse(w.add(13.5))
        // Asleep, then woken.
        assertFalse(w.add(12.7))
        assertFalse(w.add(13.3))
        assertTrue(w.add(13.4))
        // Entering again starts over.
        w.enter()
        assertFalse(w.add(13.4))
        assertFalse(w.add(13.4))
    }

    // ── Low 12V warning ───────────────────────────────────────

    @Test fun lowWarningFiresOnceThenVeryLowThenReArms() {
        val a = LowVoltAlarm()
        assertNull(a.check(12.5))
        assertEquals(LowVoltAlarm.Level.Low, a.check(12.19))
        assertNull(a.check(12.1))
        assertNull(a.check(12.3))
        assertNull(a.check(12.15))
        assertEquals(LowVoltAlarm.Level.VeryLow, a.check(11.79))
        assertNull(a.check(11.5))
        // Recovering to 12.6 V isn't enough; above it re-arms.
        assertNull(a.check(12.6))
        assertNull(a.check(12.1))
        assertNull(a.check(12.7))
        assertEquals(LowVoltAlarm.Level.Low, a.check(12.1))
    }

    @Test fun straightToVeryLowSendsOneWarning() {
        val a = LowVoltAlarm()
        assertEquals(LowVoltAlarm.Level.VeryLow, a.check(11.7))
        assertNull(a.check(12.0))
    }

    @Test fun watchModeSendsOnlyAdapterCommands() {
        // Echo, linefeeds, spaces and the adapter's own voltage reading: nothing that reaches the car.
        assertEquals(listOf("ATE0", "ATL0", "ATS0"), com.justicemw.oceanlive.obd.Elm.watchInitCommands)
        assertEquals("ATRV", com.justicemw.oceanlive.obd.Elm.READ_VOLTAGE)
    }

    @Test fun modeMapping() {
        assertEquals(V12Mode.Parked, V12Mode.of(Mode.Parked))
        assertEquals(V12Mode.Driving, V12Mode.of(Mode.Driving))
        assertEquals(V12Mode.Charging, V12Mode.of(Mode.Charging))
    }
}
