package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.CarModel
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.ParkedDrain
import com.justicemw.oceanlive.car.SavedCode
import com.justicemw.oceanlive.car.SavedScan
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class BatteryReportTest {
    private val hour = 3_600_000L
    private val t0 = 1_700_000_000_000L
    private val settings = Settings(useFahrenheit = false, model = CarModel.Big)
    private fun date(t: Long) = "D$t"
    private val notMeasured = EnStrings.get(BatteryReports.NOT_MEASURED)

    private fun charge(start: Long, socStart: Double, socEnd: Double, kwh: Double, fast: Boolean = false) =
        HistoryEntry(EntryKind.Charge, start, start + hour, socStart, socEnd, kwh, fast = fast)

    private fun build(
        snapshot: Snapshot = Snapshot(),
        history: List<HistoryEntry> = emptyList(),
        parked: List<ParkedDrain> = emptyList(),
        scans: List<SavedScan> = emptyList(),
        vin: String? = null,
    ) = BatteryReports.build(EnStrings, t0, vin, snapshot, settings, history, parked, scans, ::date) { "Desc ${it.code}" }

    private fun BatteryReport.value(section: String, label: String) =
        (sections + faults).first { it.title == section }.rows.first { it.label == label }.value

    @Test fun emptyAppSaysNotMeasuredYet() {
        Locale.setDefault(Locale.US)
        val r = build()
        assertEquals("Ocean Live battery report", r.title)
        assertEquals("D$t0", r.date)
        assertEquals(notMeasured, r.value("Car", "VIN"))
        assertEquals("106.5 kWh", r.value("Car", "Rated usable"))
        assertEquals(notMeasured, r.value("Battery health", "Measured usable"))
        assertEquals(notMeasured, r.value("Cells", "Spread"))
        assertEquals(notMeasured, r.value("Temperatures", "Coolant in"))
        assertEquals(notMeasured, r.value("Insulation and 12V", "12V battery"))
        assertEquals(notMeasured, r.value("Parked drain", "Average per day"))
        assertEquals(notMeasured, r.value("Charging totals", "Sessions"))
        assertEquals("not run yet", r.value("Latest fault scan", "Last scan"))
        assertTrue(r.tiles.all { it.tone == ReportTone.Missing })
        assertEquals(EnStrings.raw("report_footer"), r.footer)
    }

    @Test fun fullReport() {
        Locale.setDefault(Locale.US)
        val snap = Snapshot(
            cellMax = 3812.0, cellMin = 3778.0, cellAvg = 3795.0, tempMax = 24.0, tempAvg = 22.5, tempMin = 21.0,
            coolantIn = 20.0, coolantOut = 23.0, isolation = 4200.0, aux12v = 12.61, aux12vSource = "BMS", time = t0 - hour,
        )
        // 50 kWh for 50% → 100 kWh usable, twice; one DC charge too small to count.
        val history = listOf(charge(t0 - 50 * hour, 20.0, 70.0, 50.0), charge(t0 - 30 * hour, 30.0, 80.0, 50.0), charge(t0 - 10 * hour, 60.0, 70.0, 10.0, fast = true))
        val parked = listOf(ParkedDrain(t0 - 40 * hour, t0 - 16 * hour, 80.0, 78.0))
        val scans = listOf(
            SavedScan(t0 - 100 * hour, "VIN1", mapOf("BMS" to "ok"), emptyList()),
            SavedScan(t0 - 2 * hour, "VIN1", mapOf("BMS" to "ok", "VCU" to "ok"), listOf(SavedCode("BMS", "P0A7F00", 0x09), SavedCode("VCU", "U007300", 0x08))),
        )
        val r = build(snap, history, parked, scans, vin = "VIN1")

        assertEquals("VIN1", r.value("Car", "VIN"))
        assertEquals("D${t0 - hour}", r.value("Car", "Live readings from"))
        assertTrue(r.carLine.contains("VIN VIN1"))
        assertEquals("100.0 kWh", r.value("Battery health", "Measured usable"))
        assertEquals("94%", r.value("Battery health", "Share of rated"))
        assertEquals("2 charging sessions", r.value("Battery health", "Samples"))
        assertEquals("34 mV · Normal", r.value("Cells", "Spread"))
        assertEquals("3795 mV", r.value("Cells", "Average"))
        assertEquals("22.5 °C", r.value("Temperatures", "Battery average"))
        assertEquals("4200 kΩ", r.value("Insulation and 12V", "Insulation resistance"))
        assertEquals("12.61 V (BMS)", r.value("Insulation and 12V", "12V battery"))
        assertEquals("Good", r.value("Insulation and 12V", "12V status"))
        assertEquals("2.0% (about 2.1 kWh)", r.value("Parked drain", "Average per day"))
        assertEquals("3", r.value("Charging totals", "Sessions"))
        assertEquals("110 kWh", r.value("Charging totals", "Energy added"))
        assertEquals("1", r.value("Charging totals", "DC fast sessions"))

        // Latest scan only; only active codes are listed.
        assertEquals("D${t0 - 2 * hour}", r.value("Latest fault scan", "Scanned"))
        assertEquals("1", r.value("Latest fault scan", "Active codes"))
        assertEquals("1", r.value("Latest fault scan", "Stored codes"))
        assertEquals(listOf(ReportCode("BMS", "P0A7F00", "Desc P0A7F00")), r.faults.codes)

        assertEquals(listOf("94%", "34 mV", "12.61 V"), r.tiles.map { it.value })
        assertEquals(listOf(ReportTone.Good, ReportTone.Good, ReportTone.Good), r.tiles.map { it.tone })
    }

    @Test fun tones() {
        assertEquals(ReportTone.Warn, BatteryReports.balanceTone(80.0))
        assertEquals(ReportTone.Bad, BatteryReports.balanceTone(120.0))
        assertEquals(ReportTone.Warn, BatteryReports.auxTone(12.1))
        assertEquals(ReportTone.Bad, BatteryReports.auxTone(11.5))
    }

    @Test fun fileNameUsesTheDate() {
        val name = BatteryReports.fileName(t0)
        assertTrue(name, name.matches(Regex("ocean-live-battery-report-\\d{4}-\\d{2}-\\d{2}\\.pdf")))
    }

    @Test fun columnsKeepOrderAndBalance() {
        assertEquals(2, BatteryReports.splitColumns(listOf(90f, 90f, 100f, 100f)))
        assertEquals(1, BatteryReports.splitColumns(listOf(300f, 50f, 50f)))
        assertEquals(1, BatteryReports.splitColumns(listOf(10f)))
    }

    @Test fun codesThatFit() {
        assertEquals(3, BatteryReports.itemsThatFit(listOf(10f, 10f, 10f), 30f, 10f))
        // Four don't fit in 30: keep room for the "+ N more" line.
        assertEquals(2, BatteryReports.itemsThatFit(listOf(10f, 10f, 10f, 10f), 30f, 10f))
        assertEquals(0, BatteryReports.itemsThatFit(listOf(20f), 5f, 10f))
    }
}
