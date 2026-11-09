package com.justicemw.oceanlive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ObdTest {
    private fun read(command: String, reply: String): Double? {
        val pid = Obd.packPids.first { it.command == command }
        val bytes = Obd.parseResponse(reply, command) ?: return null
        return Formula(pid.formula, Obd.byteVariables(bytes)).evaluate()
    }

    @Test fun packVoltage() = assertEquals(380.0, read("222003", "622003 0ED8\r\r>")!!, 0.01)
    @Test fun socMultiFrameNoise() = assertEquals(76.5, read("222050", "005\r0:622050\r1:02FD\r")!!, 0.01)
    @Test fun negativeCurrent() = assertEquals(-12.3, read("222016", "6220160000FF85")!!, 0.01)
    @Test fun batteryTemp() = assertEquals(25.0, read("222038", "6220380096")!!, 0.01)
    @Test fun twelveVoltMillivolts() = assertEquals(12.6, read("222130", "6221303138")!!, 0.001)
    @Test fun noData() = assertNull(Obd.parseResponse("NO DATA", "222003"))
    @Test fun atrv() = assertEquals(12.6, Obd.parseAdapterVoltage("12.6V")!!, 0.001)
    @Test fun atrvGarbage() = assertNull(Obd.parseAdapterVoltage("?"))
    @Test fun formulaPrecedence() = assertEquals(7.0, Formula("1+2*3", emptyMap()).evaluate()!!, 0.0)
    @Test fun formulaBad() = assertNull(Formula("(1+2", emptyMap()).evaluate())
}
