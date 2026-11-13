package com.justicemw.oceanlive.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchReadingTest {
    private val t0 = 1_700_000_000_000L
    private val min = 60_000L

    private val charging = WatchReading(
        soc = 64.4, rangeKm = 320.0, powerKw = 48.2, charging = true, fast = true,
        minutesToTarget = 25, targetPercent = 80, aux12v = 13.6, status = "DC fast charging",
        live = true, miles = false, updatedAt = t0,
    )

    @Test fun roundTripsThroughMap() {
        assertEquals(charging, WatchReading.fromMap(charging.toMap()))
        val empty = WatchReading(updatedAt = t0)
        assertEquals(empty, WatchReading.fromMap(empty.toMap()))
    }

    @Test fun acceptsAnyNumberType() {
        // A saved copy read back from JSON can turn longs into ints and doubles into ints.
        val r = WatchReading.fromMap(mapOf("updatedAt" to t0, "soc" to 80, "minutesToTarget" to 12, "targetPercent" to 90L))!!
        assertEquals(80.0, r.soc!!, 1e-9)
        assertEquals(12L, r.minutesToTarget)
        assertEquals(90, r.targetPercent)
        assertNull(WatchReading.fromMap(mapOf("soc" to 50.0))) // no time: not a reading
    }

    @Test fun goesStaleWhenThePhoneStopsSending() {
        assertTrue(charging.liveAt(t0 + 2 * min))
        assertFalse(charging.liveAt(t0 + 4 * min))
        assertEquals("DC fast charging", WatchFormat.status(charging, t0 + min))
        assertEquals("Not connected", WatchFormat.status(charging, t0 + 10 * min))
        assertNull(WatchFormat.toTarget(EnStrings, charging, t0 + 10 * min))
    }

    @Test fun formatsValues() {
        assertEquals("64%", WatchFormat.soc(charging))
        assertEquals("—", WatchFormat.soc(null))
        assertEquals("≈ 320 km", WatchFormat.range(charging))
        assertEquals("≈ 199 mi", WatchFormat.range(charging.copy(miles = true)))
        assertEquals("To 80% ≈ 25 min", WatchFormat.toTarget(EnStrings, charging, t0))
        assertEquals("To 80% ≈ 1 h 30 min", WatchFormat.toTarget(EnStrings, charging.copy(minutesToTarget = 90), t0))
        assertTrue(WatchFormat.aux(EnStrings, 13.6)!!.endsWith("Charging"))
        assertTrue(WatchFormat.aux(EnStrings, 11.8)!!.endsWith("Very low"))
    }

    @Test fun powerDirection() {
        assertEquals("into the battery", EnStrings.get(WatchFormat.powerLabel(charging)))
        assertEquals("regenerating", EnStrings.get(WatchFormat.powerLabel(charging.copy(charging = false))))
        assertEquals("from the battery", EnStrings.get(WatchFormat.powerLabel(charging.copy(powerKw = -12.0))))
        assertEquals("idle", EnStrings.get(WatchFormat.powerLabel(charging.copy(powerKw = 0.1))))
        assertEquals("power", EnStrings.get(WatchFormat.powerLabel(charging.copy(powerKw = null))))
    }

    @Test fun updatedAgo() {
        assertEquals("Updated just now", WatchFormat.ago(EnStrings, t0, t0 + 30_000))
        assertEquals("Updated 5 min ago", WatchFormat.ago(EnStrings, t0, t0 + 5 * min))
        assertEquals("Updated 3 h ago", WatchFormat.ago(EnStrings, t0, t0 + 190 * min))
        assertEquals("Updated 3 days ago", WatchFormat.ago(EnStrings, t0, t0 + 72 * 60 * min))
        assertEquals("No reading yet", WatchFormat.ago(EnStrings, 0, t0))
    }

    @Test fun phoneStatusInTheWatchLanguage() {
        assertEquals("DC fast charging", WatchFormat.statusText(EnStrings, charging, t0))
        assertEquals("Not connected", WatchFormat.statusText(EnStrings, charging, t0 + 10 * min))
        // Every status the phone sends has a translation; anything else is shown as sent.
        for (s in listOf("DC fast charging", "Charging", "Driving", "Parked", "Reconnecting", "Not connected")) {
            assertEquals(s, EnStrings.get(WatchFormat.statusRes(s)!!))
        }
        assertEquals("Something new", WatchFormat.statusText(EnStrings, charging.copy(status = "Something new"), t0))
    }
}
