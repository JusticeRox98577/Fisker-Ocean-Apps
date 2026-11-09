package com.justicemw.oceanlive

import com.justicemw.oceanlive.obd.Uds
import com.justicemw.oceanlive.obd.UdsResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UdsTest {
    @Test fun clearOk() = assertEquals(UdsResult.Done, Uds.result("54\r\r>", 0x14))
    @Test fun clearAfterBusy() = assertEquals(UdsResult.Done, Uds.result("7F1478\r54\r", 0x14))
    @Test fun clearNeedsSecurity() {
        val r = Uds.result("7F1433", 0x14) as UdsResult.Refused
        assertTrue(r.needsSecurity)
    }
    @Test fun clearConditions() = assertEquals(UdsResult.Refused(0x22), Uds.result("7F1422", 0x14))
    @Test fun clearSilent() = assertEquals(UdsResult.NoAnswer, Uds.result("NO DATA", 0x14))
    @Test fun clearTimeout() = assertEquals(UdsResult.NoAnswer, Uds.result(null, 0x14))
    @Test fun onlyBusyIsPending() {
        assertTrue(Uds.pending("7F1478", 0x14))
        assertFalse(Uds.pending("7F1478\r54", 0x14))
        assertEquals(UdsResult.Unclear, Uds.result("7F1478", 0x14))
    }
    @Test fun softResetOk() = assertEquals(UdsResult.Done, Uds.result("5103", 0x11))
    @Test fun resetNotSupported() {
        val r = Uds.result("7F1112", 0x11) as UdsResult.Refused
        assertFalse(r.needsSecurity)
    }
    // A data byte that happens to equal 0x54 must not count as success.
    @Test fun strayByteNotSuccess() = assertEquals(UdsResult.Unclear, Uds.result("625400", 0x14))
}
