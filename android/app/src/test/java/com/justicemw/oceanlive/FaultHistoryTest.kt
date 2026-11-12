package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.FaultHistory
import com.justicemw.oceanlive.car.SavedCode
import com.justicemw.oceanlive.car.SavedScan
import com.justicemw.oceanlive.obd.Ident
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FaultHistoryTest {
    private fun scan(time: Long, vin: String?, modules: Map<String, String>, vararg codes: SavedCode) =
        SavedScan(time, vin, modules, codes.toList())

    private val ok = mapOf("BMS" to "ok", "VCU" to "ok", "BCM" to "ok")

    @Test fun firstScanHasNothingNew() {
        val d = FaultHistory.diff(null, scan(1, null, ok, SavedCode("BMS", "P0A0D00", 0x09)))
        assertTrue(d.newKeys.isEmpty())
        assertTrue(d.cleared.isEmpty())
        assertNull(d.previousTime)
    }

    @Test fun newAndCleared() {
        val before = scan(1, "V", ok, SavedCode("BMS", "P0A0D00", 0x09), SavedCode("VCU", "U007300", 0x08))
        val now = scan(2, "V", ok, SavedCode("BMS", "P0A0D00", 0x08), SavedCode("BCM", "B100013", 0x09))
        val d = FaultHistory.diff(before, now)
        assertEquals(setOf("BCM:B100013"), d.newKeys)
        assertEquals(listOf("U007300"), d.cleared.map { it.code })
        assertEquals(1L, d.previousTime)
    }

    @Test fun silentModulesDontCount() {
        // VCU didn't answer now, so its old code isn't "cleared"; BCM didn't answer before, so its code isn't "new".
        val before = scan(1, null, mapOf("BMS" to "ok", "VCU" to "ok", "BCM" to "no answer"), SavedCode("VCU", "U007300", 0x08))
        val now = scan(2, null, mapOf("BMS" to "ok", "VCU" to "no answer", "BCM" to "ok"), SavedCode("BCM", "B100013", 0x09))
        val d = FaultHistory.diff(before, now)
        assertTrue(d.newKeys.isEmpty())
        assertTrue(d.cleared.isEmpty())
    }

    @Test fun incompleteListCantProveCleared() {
        val before = scan(1, null, ok, SavedCode("BMS", "P0A0D00", 0x09))
        val now = scan(2, null, ok + ("BMS" to "incomplete"))
        assertTrue(FaultHistory.diff(before, now).cleared.isEmpty())
    }

    @Test fun previousPicksSameCar() {
        val a = scan(1, "AAA", ok)
        val b = scan(2, "BBB", ok)
        val now = scan(3, "AAA", ok)
        assertEquals(a, FaultHistory.previous(listOf(a, b), now))
        assertEquals(b, FaultHistory.previous(listOf(a, b), now.copy(vin = null)))
    }

    @Test fun keepsLatestFifty() {
        var list = emptyList<SavedScan>()
        for (t in 1L..60L) list = FaultHistory.append(list, scan(t, null, ok))
        assertEquals(50, list.size)
        assertEquals(11L, list.first().time)
        assertEquals(60L, list.last().time)
    }

    @Test fun jsonRoundTrip() {
        val scans = listOf(
            scan(1_700_000_000_123L, "VCF1ZBU27PG000001", ok, SavedCode("BMS", "P0A0D00", 0x09), SavedCode("VCU", "U007300", 0xAF)),
            scan(1_700_000_100_000L, null, mapOf("BMS" to "no answer")),
        )
        assertEquals(scans, FaultHistory.fromJson(FaultHistory.toJson(scans)))
    }

    @Test fun badJsonIsSkipped() {
        assertTrue(FaultHistory.fromJson("[]").isEmpty())
        assertEquals(1, FaultHistory.fromJson("""[{"time":5,"codes":[{"module":"BMS"}]},{"vin":"x"}]""").size)
    }

    @Test fun identAsText() {
        // 62 F1 89 "1.2.3" padded with spaces and zeros.
        assertEquals("1.2.3", Ident.read("62F189312E322E33200000", Ident.SOFTWARE_VERSION))
    }

    @Test fun identMultiFrame() {
        val reply = "00E\r0:62F187464B31\r1:3233342D41424300\r2:00000000000000"
        assertEquals("FK1234-ABC", Ident.read(reply, Ident.PART_NUMBER))
    }

    @Test fun identFallsBackToHex() = assertEquals("01 02 A0", Ident.read("62F1880102A0", Ident.SOFTWARE_NUMBER))

    @Test fun identRefusedOrEmpty() {
        assertNull(Ident.read("7F2231", Ident.SOFTWARE_VERSION))
        assertNull(Ident.read("NO DATA", Ident.SOFTWARE_VERSION))
        assertNull(Ident.read(null, Ident.SOFTWARE_VERSION))
        assertNull(Ident.read("62F189FFFFFF", Ident.SOFTWARE_VERSION))
    }
}
