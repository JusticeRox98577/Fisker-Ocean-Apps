package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.NovaCommands
import org.bouncycastle.math.ec.rfc8032.Ed25519
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
}
