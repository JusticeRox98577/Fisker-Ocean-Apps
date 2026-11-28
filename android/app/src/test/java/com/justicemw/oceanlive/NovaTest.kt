package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.NovaCommands
import com.justicemw.oceanlive.car.NovaPhone
import org.bouncycastle.math.ec.rfc8032.Ed25519
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test

class NovaTest {
    private val seed = NovaCommands.unhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")

    @Test fun publicKeyIsStandardEd25519() {
        // RFC 8032 test 1: the same key the car's novacmd tests use
        assertEquals("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", NovaCommands.hex(NovaCommands.publicKey(seed)))
    }

    @Test fun commandLayoutMatchesTheCar() {
        val uid = ByteArray(12) { (it + 1).toByte() }
        val c = NovaCommands.build(seed, uid, 2, NovaCommands.UNLOCK, 380_000_123L, 1_795_000_000L)
        assertEquals(104, c.size)
        assertEquals("4e56434d", NovaCommands.hex(c.copyOfRange(0, 4))) // "NVCM"
        assertEquals(1, c[4].toInt())
        assertEquals(NovaCommands.UNLOCK, c[5].toInt())
        assertArrayEquals(uid, c.copyOfRange(8, 20))
        fun u32(o: Int) = (0..3).sumOf { ((c[o + it].toLong() and 0xFF) shl (8 * it)) }
        assertEquals(380_000_123L, u32(20))
        assertEquals(1_795_000_000L, u32(24))
        assertEquals(1_795_000_000L + NovaCommands.LIFE_S, u32(28))
        assertEquals(2, c[32].toInt())
        assertTrue(Ed25519.verify(c, 40, NovaCommands.publicKey(seed), 0, c, 0, 40))
    }

    @Test fun countersOnlyGoUp() {
        val a = NovaCommands.counter(1_795_000_000L, 0)
        assertEquals((1_795_000_000L - 1_700_000_000L) * 4, a)
        assertEquals(a + 1, NovaCommands.counter(1_795_000_000L, a))
        assertTrue(NovaCommands.counter(1_795_000_100L, a + 1) > a + 1)
    }

    @Test fun statusReadsTheCarsCheckIn() {
        val s = NovaPhone.Status.parse(JSONObject("""
            {"box":{"uid":"0102030405060708090a0b0c","last_seen":1795000000000,"fw":3,"lat":45.5,"lon":-73.6,"fix":1,
              "rsrp":-97,"gear":1,"speed":0,"ignition":0,"v12":12610,"phones":2},
             "commands":[{"action":1,"counter":40,"created_at":1795000100000,"result":null},
                         {"action":3,"counter":39,"created_at":1795000000000,"result":1}]}
        """))
        assertEquals(12610, s.v12mV)
        assertEquals(1, s.gear)
        assertEquals(45.5, s.lat!!, 0.0)
        assertEquals(2, s.phones)
        assertEquals(2, s.commands.size)
        assertNull(s.lastResult) // the newest isn't acted on yet
        assertEquals(1, s.commands[1].result)
        assertTrue(s.online(1_795_000_060_000L))
        assertFalse(s.online(1_795_000_300_000L))
    }

    @Test fun statusBeforeTheFirstCheckIn() {
        val s = NovaPhone.Status.parse(JSONObject("""{"box":null,"commands":[]}"""))
        assertEquals(0L, s.lastSeen)
        assertNull(s.lat)
        assertFalse(s.online())
    }

    @Test fun statusKnowsANovaLight() {
        val s = NovaPhone.Status.parse(JSONObject("""
            {"box":{"kind":"light","last_seen":1795000000000,"v12":12100,"state":3,"budget_kb":41,"alerts":1,"gear":0,"speed":0},
             "commands":[]}
        """))
        assertTrue(s.isLight)
        assertEquals(3, s.lightState)
        assertEquals(41, s.dataKb)
        assertTrue(s.lightAlert)
        assertFalse(NovaPhone.Status.parse(JSONObject("""{"box":{"kind":"supernova"},"commands":[]}""")).isLight)
    }

    @Test fun demoIsAParkedNovaLight() {
        val s = NovaPhone.Status.demoLight(1_795_000_000_000L)
        assertTrue(s.isLight)
        assertTrue(s.online(1_795_000_000_000L))
        assertEquals(1, s.lightState)
        assertNull(s.lat)
        assertTrue(s.commands.isEmpty())
    }
}
