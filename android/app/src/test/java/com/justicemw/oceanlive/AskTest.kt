package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.Ask
import com.justicemw.oceanlive.car.AskTurn
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.FaultScan
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Snapshot
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.obd.Dtc
import com.justicemw.oceanlive.obd.Ecus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AskTest {
    private val now = 1_800_000_000_000L

    @Test fun carSummaryHasReadingsAndCodesButNoVin() {
        val state = CarState(
            status = Status.Live, vin = "VCF1ZBU20PG000123", mode = Mode.Charging,
            snapshot = Snapshot(soc = 78.5, packV = 402.1, packA = 25.0, cellMax = 3912.0, cellMin = 3901.0, cellAvg = 3906.0, aux12v = 12.61, time = now - 5 * 60_000),
        )
        val faults = FaultScan(codes = listOf(Dtc("U199701", 0x09, Ecus.BMS), Dtc("B2AAAAA", 0x08, Ecus.BCM)), finishedAt = now - 3 * 3_600_000)
        val text = Ask.carSummary(state, faults, Settings(), now)

        assertFalse("never the VIN", text.contains("VCF1ZBU20PG000123"))
        assertTrue(text.contains("State of charge: 78.5 %"))
        assertTrue(text.contains("Readings taken: 5 min ago (connected now)"))
        assertTrue(text.contains("Car state: charging"))
        assertTrue(text.contains("spread 11 mV"))
        assertTrue(text.contains("12 V battery: 12.61 V"))
        assertTrue(text.contains("Last fault scan: 3 h ago, 1 code(s):"))
        assertTrue(text.contains("- U199701 from BMS (HV battery)"))
        assertFalse("placeholder codes are left out", text.contains("B2AAAAA"))
        assertTrue(text.contains("Owner's units: miles, °F"))
    }

    @Test fun carSummaryWithNothingYet() {
        val text = Ask.carSummary(CarState(), FaultScan(), Settings(useMiles = false, useFahrenheit = false), now)
        assertTrue(text.contains("No readings yet"))
        assertTrue(text.contains("No fault scan in this session."))
        assertTrue(text.contains("Owner's units: km, °C"))
    }

    @Test fun requestBodyMatchesTheProxy() {
        val body = Ask.requestBody("abc-12345", listOf(AskTurn(true, "Hi"), AskTurn(false, "Hello"), AskTurn(true, "B208896?")), "SOC 80 %")
        assertEquals("abc-12345", body.getString("device"))
        val m = body.getJSONArray("messages")
        assertEquals(3, m.length())
        assertEquals("user", m.getJSONObject(0).getString("role"))
        assertEquals("assistant", m.getJSONObject(1).getString("role"))
        assertEquals("B208896?", m.getJSONObject(2).getString("text"))
        assertEquals("SOC 80 %", body.getString("car"))
        assertFalse(Ask.requestBody("abc-12345", listOf(AskTurn(true, "Hi")), null).has("car"))
    }

    @Test fun proxyErrorsBecomeMessages() {
        assertEquals(R.string.ask_error_limit, Ask.errorMessage(429, "rate_limited"))
        assertEquals(R.string.ask_error_budget, Ask.errorMessage(503, "budget"))
        assertEquals(R.string.ask_error_no_answer, Ask.errorMessage(422, "no_answer"))
        assertEquals(R.string.ask_error_server, Ask.errorMessage(502, "upstream"))
        assertEquals(R.string.ask_error_server, Ask.errorMessage(500, null))
    }
}
