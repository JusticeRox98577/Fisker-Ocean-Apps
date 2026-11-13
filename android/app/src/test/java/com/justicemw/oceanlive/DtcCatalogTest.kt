package com.justicemw.oceanlive

import com.justicemw.oceanlive.obd.DescriptionSource
import com.justicemw.oceanlive.obd.DtcCatalog
import com.justicemw.oceanlive.obd.DtcReadResult
import com.justicemw.oceanlive.obd.DtcSeverity
import com.justicemw.oceanlive.obd.Dtcs
import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.MiniJson
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DtcCatalogTest {
    private val bcm = Ecus.BCM

    @After fun reset() = DtcCatalog.setImported(emptyMap())

    @Test fun oceanCode() {
        val i = DtcCatalog.describe("U199702", null)
        assertEquals(DescriptionSource.Ocean, i.source)
        assertTrue(i.title.contains("coolant heater"))
    }

    @Test fun saeCodeWithFailureType() {
        val i = DtcCatalog.describe("P0AA600", null)
        assertEquals(DescriptionSource.Sae, i.source)
        assertEquals("High-voltage isolation fault", i.title)
        assertEquals("Lost communication with ABS module (message missing)", DtcCatalog.describe("U012187", null).title)
    }

    @Test fun derivedLostComms() {
        val i = DtcCatalog.describe("U178B87", bcm)
        assertEquals(DescriptionSource.Derived, i.source)
        assertEquals("Body control is missing messages from another module (lost communication)", i.title)
    }

    @Test fun derivedBody() = assertEquals("Body fault in Body control: short to ground", DtcCatalog.describe("B123411", bcm).title)

    @Test fun importedWins() {
        DtcCatalog.setImported(DtcCatalog.parseImport("code,description\nU178B87,TBOX lost CAN\n"))
        val i = DtcCatalog.describe("U178B87", bcm)
        assertEquals(DescriptionSource.Imported, i.source)
        assertEquals("TBOX lost CAN", i.title)
    }

    private val community = """
        {"_meta":{"count":3},"dtcLabels":{
          "U178B11":{"name":"4G/5G Cellular Antenna-1 short to ground","ecu":"TBOX","severity":"warning","source":"community-fisker-dtc",
            "repairSteps":["Replace external antenna or/and antenna cable"],"rootCauses":["Degradation in cellular signal strength"]},
          "P100216":{"name":"DTC_SYS_VOLTAGE_LOW","ecu":"VCU","severity":"info","source":"community-fisker-dtc",
            "repairSteps":["Check the connector Replace ECU"]},
          "P036015":{"name":"Not_supported","ecu":"FCM","severity":"warning","source":"community-fisker-dtc",
            "repairSteps":["Production mode has to be disabled_0"],"rootCauses":["ECU shall not have secured access"]},
          "U000109":{"name":"DTC_CAN_INTERNAL_ERR","ecu":"MCU_F","source":"community-fisker-dtc",
            "repairSteps":["nan Note: Ensure the customer has not installed any unauthorized accessories (e.g., Speakers)."]},
          "U013183":{"name":"EPS_[command] CRC Fault","ecu":"ACU","source":"community-fisker-dtc"}
        }}
    """.trimIndent()

    private val service = """
        {"dtcLabels":{
          "U178B11":{"name":"Cellular antenna 1 circuit short to ground","ecu":"TBOX","severity":"critical","source":"fisker-service-tsg",
            "impact":"No mobile data","repairSteps":["nan"],"rootCauses":["Reference Connector End View Information"]},
          "8000111":{"name":"Driver airbag stage 1 short to ground","source":"fisker-service-tsg"},
          "UT4BE00":{"name":"Invalid signal from PKC","source":"fisker-service-tsg"},
          "13221E01":{"name":"junk key","source":"fisker-service-tsg"}
        }}
    """.trimIndent()

    @Test fun readsDtcLabelsWithDetails() {
        val m = DtcCatalog.parseImport(community)
        val d = m.getValue("U178B11")
        assertEquals("4G/5G Cellular Antenna-1 short to ground", d.title)
        assertEquals(listOf("Replace external antenna or/and antenna cable"), d.steps)
        assertEquals(DtcSeverity.Warning, d.severity)
        assertEquals("Sys voltage low", m.getValue("P100216").title)
        assertEquals("CAN internal error", m.getValue("U000109").title)
        assertTrue(m.getValue("U000109").steps.isEmpty())
        assertEquals("EPS CRC Fault", m.getValue("U013183").title)
        // "Not_supported" isn't a name, but the cause and fix are kept without the spreadsheet numbering.
        val ns = m.getValue("P036015")
        assertNull(ns.title)
        assertEquals(listOf("Production mode has to be disabled"), ns.steps)
    }

    @Test fun repairsOcrCodes() {
        val m = DtcCatalog.parseImport(service)
        assertTrue("B000111" in m)
        assertTrue("U14BE00" in m)
        assertFalse(m.keys.any { it.length == 8 })
        assertNull(m.getValue("U178B11").steps.firstOrNull())
        assertTrue(m.getValue("U178B11").causes.isEmpty())
    }

    @Test fun serviceGuideBeatsCommunityButKeepsItsSteps() {
        val merged = DtcCatalog.mergeAll(DtcCatalog.parseImport(community), DtcCatalog.parseImport(service))
        DtcCatalog.setImported(DtcCatalog.parseImport(DtcCatalog.toJson(merged))) // through the saved form
        val i = DtcCatalog.describe("U178B11", Ecus.BCM)
        assertEquals("Cellular antenna 1 circuit short to ground", i.title)
        assertEquals("Fisker service guide", EnStrings.get(i.sourceLabel))
        assertEquals(DtcSeverity.Critical, i.severity)
        assertEquals("No mobile data", i.impact)
        assertEquals(listOf("Replace external antenna or/and antenna cable"), i.steps)
        assertEquals(listOf("Degradation in cellular signal strength"), i.causes)
        // Order of import doesn't matter.
        val other = DtcCatalog.mergeAll(DtcCatalog.parseImport(service), DtcCatalog.parseImport(community))
        assertEquals(merged.getValue("U178B11"), other.getValue("U178B11"))
    }

    @Test fun untitledEntryKeepsBuiltInTitle() {
        DtcCatalog.setImported(DtcCatalog.parseImport(community))
        val i = DtcCatalog.describe("P036015", null)
        assertEquals(DescriptionSource.Derived, i.source)
        assertTrue(i.hasDetails)
    }

    @Test fun jsonRoundTrip() {
        val v = MiniJson.parse("""{"a":[1,"x\"yé",true,null],"b":{"c":-2.5e1}}""")
        assertEquals(v, MiniJson.parse(MiniJson.write(v)))
    }

    @Test fun placeholdersDropped() {
        // U3FFFFF placeholder (FF FF FF is padding anyway) and U17A100 sentinel; one real code.
        val r = Dtcs.parse("5902FFD7A10008D78B1109", bcm) as DtcReadResult.Ok
        assertEquals(listOf("U178B11"), r.codes.map { it.code })
    }
}
