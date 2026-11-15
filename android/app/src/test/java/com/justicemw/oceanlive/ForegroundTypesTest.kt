package com.justicemw.oceanlive

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundTypesTest {
    private val both = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION

    @Test fun constantsMatchAndroid() {
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, ForegroundTypes.CONNECTED_DEVICE)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION, ForegroundTypes.LOCATION)
    }

    @Test fun locationFallsBackToConnectedDeviceOnly() {
        assertEquals(listOf(both, ForegroundTypes.CONNECTED_DEVICE), ForegroundTypes.attempts(34, wantLocation = true))
        assertEquals(listOf(ForegroundTypes.CONNECTED_DEVICE), ForegroundTypes.attempts(34, wantLocation = false))
        assertEquals(listOf(0), ForegroundTypes.attempts(28, wantLocation = true))
    }

    @Test fun locationRefusedOnlyAfterTheFallback() {
        val wanted = ForegroundTypes.attempts(34, true)
        assertFalse(ForegroundTypes.locationRefused(wanted, both))
        assertTrue(ForegroundTypes.locationRefused(wanted, ForegroundTypes.CONNECTED_DEVICE))
        val notWanted = ForegroundTypes.attempts(34, false)
        assertFalse(ForegroundTypes.locationRefused(notWanted, ForegroundTypes.CONNECTED_DEVICE))
        assertFalse(ForegroundTypes.locationRefused(ForegroundTypes.attempts(26, true), 0))
    }
}
