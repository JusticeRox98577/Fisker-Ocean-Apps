package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.ChangeBlock
import com.justicemw.oceanlive.car.ChangeEvidence
import com.justicemw.oceanlive.car.ChangeGuard
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.V12Watch
import com.justicemw.oceanlive.obd.Ecus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChangeGuardTest {
    private val t0 = 1_700_000_000_000L

    /** Two equal odometer readings 10 s apart and a quiet battery, the newest at [t0]. */
    private fun good(powerKw: Double = 0.3) = ChangeEvidence().apply {
        odometer(12_345.67, t0 - 10_000)
        odometer(12_345.67, t0)
        power(powerKw, t0)
    }

    @Test fun freshGoodEvidenceAllowsIt() {
        assertNull(good().check(connected = true, mode = Mode.Parked, now = t0 + 2_000))
        assertNull(good(-0.9).check(true, Mode.Parked, t0 + 2_000))
    }

    @Test fun notConnectedDrivingOrChargingBlocks() {
        assertEquals(ChangeBlock.NotConnected, good().check(false, Mode.Parked, t0))
        assertEquals(ChangeBlock.Driving, good().check(true, Mode.Driving, t0))
        assertEquals(ChangeBlock.Charging, good().check(true, Mode.Charging, t0))
    }

    @Test fun nothingYetOrASingleOdometerReadingWaits() {
        val e = ChangeEvidence()
        e.power(0.2, t0)
        assertEquals(ChangeBlock.WaitingOdometer, e.check(true, Mode.Parked, t0))
        e.odometer(100.0, t0)
        assertEquals(ChangeBlock.WaitingOdometer, e.check(true, Mode.Parked, t0))
        e.odometer(100.0, t0 + 10_000)
        e.power(0.2, t0 + 10_000)
        assertNull(e.check(true, Mode.Parked, t0 + 10_000))
    }

    @Test fun staleOdometerBlocks() {
        val e = good()
        e.power(0.2, t0 + 26_000)
        assertNull(e.check(true, Mode.Parked, t0 + ChangeGuard.MAX_ODOMETER_AGE_MS))
        assertEquals(ChangeBlock.StaleOdometer, e.check(true, Mode.Parked, t0 + 26_000))
    }

    @Test fun movedOdometerBlocks() {
        val e = ChangeEvidence()
        e.odometer(100.00, t0 - 10_000)
        e.odometer(100.01, t0)
        e.power(0.1, t0)
        assertEquals(ChangeBlock.Moved, e.check(true, Mode.Parked, t0))
        // Standing still again: the latest two readings agree.
        e.odometer(100.01, t0 + 10_000)
        e.power(0.1, t0 + 10_000)
        assertNull(e.check(true, Mode.Parked, t0 + 10_000))
    }

    @Test fun missingOrOldPowerWaits() {
        val e = ChangeEvidence()
        e.odometer(5.0, t0 - 10_000)
        e.odometer(5.0, t0)
        assertEquals(ChangeBlock.WaitingPower, e.check(true, Mode.Parked, t0))
        e.power(0.1, t0)
        assertEquals(ChangeBlock.WaitingPower, e.check(true, Mode.Parked, t0 + 7_000))
    }

    @Test fun highPowerEitherWayBlocks() {
        assertEquals(ChangeBlock.PowerFlowing, good(1.0).check(true, Mode.Parked, t0))
        assertEquals(ChangeBlock.PowerFlowing, good(-1.0).check(true, Mode.Parked, t0))
        assertEquals(ChangeBlock.PowerFlowing, good(7.2).check(true, Mode.Parked, t0))
        assertEquals(ChangeBlock.PowerFlowing, good(-3.5).check(true, Mode.Parked, t0))
    }

    @Test fun resetOnReconnectNeedsFreshEvidence() {
        val e = good()
        val session = e.session
        e.reset()
        assertNotEquals(session, e.session)
        assertNull(e.latestOdometer)
        assertEquals(ChangeBlock.WaitingOdometer, e.check(true, Mode.Parked, t0))
        // One reading from the new connection isn't enough, even if it matches the old ones.
        e.odometer(12_345.67, t0 + 1_000)
        e.power(0.2, t0 + 1_000)
        assertEquals(ChangeBlock.WaitingOdometer, e.check(true, Mode.Parked, t0 + 1_000))
    }

    @Test fun checkBetweenModules() {
        assertNull(ChangeGuard.midAction(100.0, 100.0, 0.4))
        assertNull(ChangeGuard.midAction(100.0, 100.0, -0.4))
        assertEquals(ChangeBlock.Moved, ChangeGuard.midAction(100.0, 100.02, 0.4))
        assertEquals(ChangeBlock.PowerFlowing, ChangeGuard.midAction(100.0, 100.0, 1.5))
        assertEquals(ChangeBlock.PowerFlowing, ChangeGuard.midAction(100.0, 100.0, -1.5))
        assertEquals(ChangeBlock.NoAnswer, ChangeGuard.midAction(100.0, null, 0.1))
        assertEquals(ChangeBlock.NoAnswer, ChangeGuard.midAction(100.0, 100.0, null))
    }

    @Test fun restartNeverOfferedForSafetyCriticalModules() {
        val critical = setOf("ESP", "IBOOSTER", "EPS", "EPS2", "ACU", "VCU", "MCU_F", "MCU_R", "GW", "BMS")
        val byCode = Ecus.scanList.associateBy { it.code }
        for (code in critical) {
            val ecu = byCode.getValue(code)
            assertTrue(code, ecu.safetyCritical)
            assertFalse(code, ecu.offersRestart)
        }
        // Everything else that implements a reset is still offered one.
        assertTrue(byCode.getValue("ICC").offersRestart)
        assertTrue(byCode.getValue("TBOX_EU").offersRestart)
        assertFalse(byCode.getValue("RAC").offersRestart)
    }

    @Test fun watchAutoResumesAtMostEveryTwoHours() {
        assertTrue(V12Watch.mayAutoResume(null, t0))
        assertFalse(V12Watch.mayAutoResume(t0, t0 + 60 * 60_000L))
        assertFalse(V12Watch.mayAutoResume(t0, t0 + V12Watch.AUTO_RESUME_MIN_MS - 1))
        assertTrue(V12Watch.mayAutoResume(t0, t0 + V12Watch.AUTO_RESUME_MIN_MS))
    }
}
