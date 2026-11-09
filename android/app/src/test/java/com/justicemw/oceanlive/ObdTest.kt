package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Snapshot
import com.justicemw.oceanlive.car.Tracker
import com.justicemw.oceanlive.obd.DtcReadResult
import com.justicemw.oceanlive.obd.DtcState
import com.justicemw.oceanlive.obd.Dtcs
import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.Elm
import com.justicemw.oceanlive.obd.Pids
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ObdTest {
    @Test fun packVoltage() = assertEquals(380.0, Elm.read("622003 0ED8\r\r>", Pids.packV)!!, 0.01)
    @Test fun socMultiFrameNoise() = assertEquals(76.5, Elm.read("005\r0:622050\r1:02FD\r", Pids.soc)!!, 0.01)
    @Test fun socMatchesDash() = assertEquals(71.0, Elm.read("62205002C6", Pids.soc)!!, 0.01)

    // Raw 0x4E20 = 20000 -> 2000.0 - 2000 = 0 A. Raw 0x4DBE = 19902 -> -9.8 -> negated +9.8 A (charging).
    @Test fun currentZero() = assertEquals(0.0, Elm.read("6220044E20", Pids.packA)!!, 0.01)
    @Test fun currentCharging() = assertEquals(9.8, Elm.read("6220044DBE", Pids.packA)!!, 0.01)
    @Test fun currentDriving() = assertEquals(-50.0, Elm.read("6220045014", Pids.packA)!!, 0.01)
    @Test fun currentFourBytes() = assertEquals(9.8, Elm.read("62200400004DBE", Pids.packA)!!, 0.01)

    // Temps are uint16 x0.5 - 50: 0x004B = 75 -> -12.5 C; 0x0096 = 150 -> 25 C.
    @Test fun batteryTemp() = assertEquals(25.0, Elm.read("6220380096", Pids.tempAvg)!!, 0.01)
    @Test fun coldBattery() = assertEquals(-12.5, Elm.read("622038004B", Pids.tempAvg)!!, 0.01)
    @Test fun cellMillivolts() = assertEquals(3937.0, Elm.read("6221370F61", Pids.cellMax)!!, 0.01)
    @Test fun twelveVolt() = assertEquals(12.6, Elm.read("6221303138", Pids.aux12v)!!, 0.001)
    @Test fun odometer() = assertEquals(12345.67, Elm.read("6234090012D687", Pids.odometer)!!, 0.001)
    @Test fun outOfRangeRejected() = assertNull(Elm.read("622050FFFF", Pids.soc))
    @Test fun noData() = assertNull(Elm.read("NO DATA\r\r>", Pids.soc))
    @Test fun wrongDidIgnored() = assertNull(Elm.read("62200302C6", Pids.soc))
    @Test fun atrv() = assertEquals(12.6, Elm.adapterVoltage("12.6V")!!, 0.001)
    @Test fun atrvGarbage() = assertNull(Elm.adapterVoltage("?"))

    @Test fun vinMultiFrame() {
        val reply = "014\r0:62F190564346\r1:315A4245323350\r2:47303037383438\r>"
        assertEquals("VCF1ZBE23PG007848", Elm.vin(reply))
    }

    @Test fun dtcCodeFormat() = assertEquals("U178B11", Dtcs.code(0xD7, 0x8B, 0x11))

    @Test fun dtcParse() {
        // 59 02 FF, then U178B11 status 09 (active+confirmed), P0A90F0 status 08 (stored), padding.
        val reply = "00B\r0:5902FFD78B11\r1:090A90F008AAAA\r"
        val r = Dtcs.parse(reply.replace("0A90", "0A90"), Ecus.BCM) as DtcReadResult.Ok
        assertEquals(2, r.codes.size)
        assertEquals(DtcState.Active, r.codes[0].state)
        assertEquals("P0A90F0", r.codes[1].code)
        assertEquals(DtcState.Stored, r.codes[1].state)
        assertTrue(r.complete)
    }

    @Test fun dtcTruncated() {
        // Declares 0x13 = 19 bytes (4 records) but only 2 arrive.
        val r = Dtcs.parse("013\r0:5902FFD78B11\r1:090A90F008\r", Ecus.BCM) as DtcReadResult.Ok
        assertFalse(r.complete)
    }

    @Test fun dtcNoCodes() {
        val r = Dtcs.parse("5902FF", Ecus.BCM) as DtcReadResult.Ok
        assertEquals(0, r.codes.size)
    }

    @Test fun dtcRefused() = assertEquals(DtcReadResult.Refused(0x11), Dtcs.parse("7F1911", Ecus.RAC_TEST))
    @Test fun dtcSilent() = assertEquals(DtcReadResult.NoAnswer, Dtcs.parse("NO DATA", Ecus.BCM))
    @Test fun failureType() = assertEquals("message missing", Dtcs.failureType("U15AD87"))
}

private val Ecus.RAC_TEST get() = scanList.first { it.code == "RAC" }

class TrackerTest {
    private fun snap(t: Long, soc: Double, amps: Double, odo: Double?) =
        Snapshot(soc = soc, packV = 400.0, packA = amps, odometerKm = odo, time = t)

    @Test fun detectsChargeAndCountsEnergy() {
        val tr = Tracker()
        var t = 0L
        // 400 V * 25 A = 10 kW for 30 minutes.
        repeat(901) { tr.update(snap(t, 50.0 + it * 0.005, 25.0, 1000.0)); t += 2_000 }
        assertEquals(Mode.Charging, tr.mode)
        val done = (0..3).flatMap { tr.update(snap(t + it * 2_000L, 54.5, 0.0, 1000.0)) }
        assertEquals(1, done.size)
        assertEquals(EntryKind.Charge, done[0].kind)
        assertEquals(5.0, done[0].kwh, 0.1)
        assertFalse(done[0].fast)
        assertEquals(Mode.Parked, tr.mode)
    }

    @Test fun detectsDrive() {
        val tr = Tracker()
        var t = 0L
        var odo = 1000.0
        // 15 minutes at 60 km/h, -50 A (20 kW out of the pack).
        repeat(450) { odo += 60.0 / 3600 * 2; tr.update(snap(t, 80.0, -50.0, odo)); t += 2_000 }
        assertEquals(Mode.Driving, tr.mode)
        var finished = emptyList<com.justicemw.oceanlive.car.HistoryEntry>()
        repeat(100) { finished = finished + tr.update(snap(t, 76.0, -1.0, odo)); t += 2_000 }
        assertEquals(1, finished.size)
        assertEquals(15.0, finished[0].distanceKm!!, 0.2)
        assertTrue(finished[0].kwh > 4.5)
    }

    @Test fun regenWhileMovingIsNotCharging() {
        val tr = Tracker()
        var t = 0L
        var odo = 1000.0
        repeat(20) { odo += 0.03; tr.update(snap(t, 80.0, 40.0, odo)); t += 2_000 }
        assertEquals(Mode.Driving, tr.mode)
    }

    @Test fun capacityFromCharge() {
        val e = com.justicemw.oceanlive.car.HistoryEntry(EntryKind.Charge, 0, 1, 20.0, 70.0, 50.0)
        assertEquals(100.0, e.impliedCapacityKwh!!, 0.01)
    }
}
