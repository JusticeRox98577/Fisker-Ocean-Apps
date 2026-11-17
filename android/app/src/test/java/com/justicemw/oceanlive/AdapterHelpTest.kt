package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.AdapterHelp
import com.justicemw.oceanlive.car.ConnectFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AdapterHelpTest {
    private val fallback = "Adapter"
    private val saved = "vLinker MC-IOS"
    private val savedAddress = "AA:BB:CC:DD:EE:01"

    // ── What a failed first connect means ─────────────────────

    @Test fun linkNeverUpIsUnreachable() {
        assertEquals(ConnectFailure.Unreachable, AdapterHelp.failure(linkUp = false, notObd = false, bluetoothOn = true))
    }

    @Test fun linkUpWithoutAnswerIsNoAnswer() {
        assertEquals(ConnectFailure.NoAnswer, AdapterHelp.failure(linkUp = true, notObd = false, bluetoothOn = true))
    }

    @Test fun notObdAndBluetoothOffKeepTheirOwnMessage() {
        assertNull(AdapterHelp.failure(linkUp = false, notObd = true, bluetoothOn = true))
        assertNull(AdapterHelp.failure(linkUp = false, notObd = false, bluetoothOn = false))
        assertNull(AdapterHelp.failure(linkUp = true, notObd = false, bluetoothOn = false))
    }

    @Test fun messagesInEnglish() {
        val unreachable = "Can't reach the adapter. It may be asleep or connected to another app. " +
            "Close other OBD apps, press the adapter's button or replug it, then tap Connect."
        val noAnswer = "The adapter connected but didn't answer. Unplug it for a few seconds, plug it back in, then tap Connect."
        val firmware = "vLinker adapters need firmware 2.2.82 or newer to wake up on their own in an electric car."
        assertEquals(unreachable, AdapterHelp.message(ConnectFailure.Unreachable, "OBDLink CX", EnStrings))
        assertEquals(noAnswer, AdapterHelp.message(ConnectFailure.NoAnswer, null, EnStrings))
        assertEquals("$unreachable\n$firmware", AdapterHelp.message(ConnectFailure.Unreachable, "vLinker MC+", EnStrings))
        assertEquals("$noAnswer\n$firmware", AdapterHelp.message(ConnectFailure.NoAnswer, "VLINKER FS", EnStrings))
    }

    @Test fun vlinkerNoteOnlyForVlinkers() {
        assertTrue(AdapterHelp.isVlinker("vLinker MC+"))
        assertTrue(AdapterHelp.isVlinker("ios-VLINKER"))
        assertFalse(AdapterHelp.isVlinker("vLink"))
        assertFalse(AdapterHelp.isVlinker("OBDLink CX"))
        assertFalse(AdapterHelp.isVlinker(null))
    }

    // ── The saved adapter at a new Bluetooth address ──────────

    @Test fun sameNameAtNewAddressMatches() {
        assertTrue(AdapterHelp.isMoved(saved, savedAddress, fallback, saved, "AA:BB:CC:DD:EE:02"))
        // Trimmed on both sides.
        assertTrue(AdapterHelp.isMoved(" $saved ", savedAddress, fallback, "$saved  ", "AA:BB:CC:DD:EE:02"))
    }

    @Test fun nameMustMatchExactly() {
        assertFalse(AdapterHelp.isMoved(saved, savedAddress, fallback, saved.lowercase(), "AA:BB:CC:DD:EE:02"))
        assertFalse(AdapterHelp.isMoved(saved, savedAddress, fallback, "vLinker MC", "AA:BB:CC:DD:EE:02"))
        assertFalse(AdapterHelp.isMoved(saved, savedAddress, fallback, null, "AA:BB:CC:DD:EE:02"))
    }

    @Test fun savedAddressIsNotAMove() {
        assertFalse(AdapterHelp.isMoved(saved, savedAddress, fallback, saved, savedAddress))
        assertFalse(AdapterHelp.isMoved(saved, savedAddress, fallback, saved, savedAddress.lowercase()))
    }

    @Test fun blankOrFallbackSavedNameNeverMatches() {
        assertFalse(AdapterHelp.canLookForMoved(null, fallback))
        assertFalse(AdapterHelp.canLookForMoved("  ", fallback))
        assertFalse(AdapterHelp.canLookForMoved("Adapter", fallback))
        assertTrue(AdapterHelp.canLookForMoved(saved, fallback))
        assertFalse(AdapterHelp.isMoved("Adapter", savedAddress, fallback, "Adapter", "AA:BB:CC:DD:EE:02"))
        assertFalse(AdapterHelp.isMoved("", savedAddress, fallback, "", "AA:BB:CC:DD:EE:02"))
        assertFalse(AdapterHelp.isMoved(null, savedAddress, fallback, null, "AA:BB:CC:DD:EE:02"))
    }

    @Test fun searchIsShort() {
        assertEquals(8_000L, AdapterHelp.MOVED_SEARCH_MS)
    }

    @Test fun promptAndSearchTextsInEnglish() {
        assertEquals(
            "Found vLinker MC+ nearby at a new Bluetooth address. Use it only if it's the adapter in your car.",
            EnStrings.get(R.string.moved_adapter_found, "vLinker MC+"),
        )
        assertEquals("Use it", EnStrings.get(R.string.moved_adapter_use))
        assertEquals("Not now", EnStrings.get(R.string.not_now))
        assertEquals(
            "If it's asleep, press its button or replug it, and close other apps that use it.",
            EnStrings.get(R.string.scan_hint_asleep),
        )
        assertEquals(
            "Couldn't search for adapters (error 2). Turn Bluetooth off and on, then try again.",
            EnStrings.get(R.string.scan_failed, 2),
        )
        assertEquals(
            "Turn on Location to search for adapters. Android 11 and older need it for Bluetooth searches.",
            EnStrings.get(R.string.scan_location_off),
        )
    }
}
