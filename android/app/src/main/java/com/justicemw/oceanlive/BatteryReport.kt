package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.ParkedDrain
import com.justicemw.oceanlive.car.ParkedDrains
import com.justicemw.oceanlive.car.SavedCode
import com.justicemw.oceanlive.car.SavedScan
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Snapshot
import com.justicemw.oceanlive.car.measuredCapacityKwh
import com.justicemw.oceanlive.obd.DtcState
import com.justicemw.oceanlive.ui.auxStatus
import com.justicemw.oceanlive.ui.balanceLabel
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt

/** How a value should be coloured in the report. */
enum class ReportTone { Normal, Good, Warn, Bad, Missing }

data class ReportRow(val label: String, val value: String, val tone: ReportTone = ReportTone.Normal)

/** A headline number at the top of the report. */
data class ReportTile(val label: String, val value: String, val caption: String, val tone: ReportTone)

/** An active fault code with its plain-English description. */
data class ReportCode(val module: String, val code: String, val description: String)

data class ReportSection(
    val title: String,
    val rows: List<ReportRow>,
    val note: String? = null,
    val codes: List<ReportCode> = emptyList(),
)

/** Everything on the one-page battery report, as plain text. Drawn by [BatteryReportPdf]. */
data class BatteryReport(
    val title: String,
    val date: String,
    val carLine: String,
    val tiles: List<ReportTile>,
    val sections: List<ReportSection>,
    val faults: ReportSection,
    val footer: String,
)

/**
 * Builds the battery report from data the app already has in memory and history.
 * It never talks to the car. Pure logic so it can be unit tested.
 */
object BatteryReports {
    const val TITLE = "Ocean Live battery report"
    const val NOT_MEASURED = "not measured yet"
    const val FOOTER = "Read from the car by Ocean Live (unofficial). Values are measured, not a dealer diagnosis."

    fun build(
        now: Long,
        vin: String?,
        snapshot: Snapshot,
        settings: Settings,
        history: List<HistoryEntry>,
        parked: List<ParkedDrain>,
        scans: List<SavedScan>,
        dateText: (Long) -> String = ::defaultDate,
        describe: (SavedCode) -> String = { it.toDtc().info.title },
    ): BatteryReport {
        val s = snapshot
        val rated = settings.usableKwh
        val measured = measuredCapacityKwh(history)
        val pct = if (measured != null && rated > 0) measured / rated * 100 else null
        val samples = history.count { it.impliedCapacityKwh != null }
        val spread = s.cellSpread
        val aux = s.aux12v

        val tiles = listOf(
            ReportTile(
                "Capacity", pct?.let { "${it.roundToInt()}%" } ?: "—",
                measured?.let { "${Format.n(it, 1)} kWh usable" } ?: NOT_MEASURED,
                when {
                    pct == null -> ReportTone.Missing
                    pct >= 85 -> ReportTone.Good
                    pct >= 70 -> ReportTone.Warn
                    else -> ReportTone.Bad
                },
            ),
            ReportTile(
                "Cell spread", spread?.let { "${it.roundToInt()} mV" } ?: "—",
                spread?.let { balanceLabel(it) } ?: NOT_MEASURED, spread?.let { balanceTone(it) } ?: ReportTone.Missing,
            ),
            ReportTile(
                "12V battery", aux?.let { Format.n(it, 2) + " V" } ?: "—",
                aux?.let { auxStatus(it) } ?: NOT_MEASURED, aux?.let { auxTone(it) } ?: ReportTone.Missing,
            ),
        )

        val car = ReportSection(
            "Car",
            listOf(
                row("VIN", vin),
                row("Model", settings.model.label),
                row("Rated usable", rated.takeIf { it > 0 }?.let { Format.n(it, 1) + " kWh" }),
                row("Live readings from", s.time.takeIf { it > 0 }?.let(dateText)),
            ),
        )

        val health = ReportSection(
            "Battery health",
            listOf(
                row("Measured usable", measured?.let { Format.n(it, 1) + " kWh" }),
                row("Share of rated", pct?.let { "${it.roundToInt()}%" }, tiles[0].tone),
                row("Samples", if (samples > 0) "$samples charging session${plural(samples)}" else null),
            ),
            note = "Each charge that adds 20% or more is measured at the battery.",
        )

        val cells = ReportSection(
            "Cells",
            listOf(
                row("Highest", s.cellMax?.let { "${it.roundToInt()} mV" }),
                row("Average", s.cellAvg?.let { "${it.roundToInt()} mV" }),
                row("Lowest", s.cellMin?.let { "${it.roundToInt()} mV" }),
                row("Spread", spread?.let { "${it.roundToInt()} mV · ${balanceLabel(it)}" }, spread?.let { balanceTone(it) }),
            ),
            note = "Under 60 mV is normal.",
        )

        val temps = ReportSection(
            "Temperatures",
            listOf(
                row("Battery highest", Format.temp(s.tempMax, settings)),
                row("Battery average", Format.temp(s.tempAvg, settings)),
                row("Battery lowest", Format.temp(s.tempMin, settings)),
                row("Coolant in", Format.temp(s.coolantIn, settings)),
                row("Coolant out", Format.temp(s.coolantOut, settings)),
            ),
        )

        val electrical = ReportSection(
            "Insulation and 12V",
            listOf(
                row("Insulation resistance", s.isolation?.let { "${it.roundToInt()} kΩ" }),
                row("12V battery", aux?.let { Format.n(it, 2) + " V" + (s.aux12vSource?.let { src -> " ($src)" } ?: "") }),
                row("12V status", aux?.let { auxStatus(it) }, aux?.let { auxTone(it) }),
            ),
        )

        val perDay = ParkedDrains.averagePerDay(parked)
        val drain = ReportSection(
            "Parked drain",
            listOf(
                row("Average per day", perDay?.let {
                    "${Format.n(it, 1)}%" + (if (rated > 0) " (about ${Format.n(it / 100 * rated, 1)} kWh)" else "")
                }),
                row("Time measured", if (perDay != null) Format.span(parked.sumOf { it.hours }) else null),
            ),
        )

        val charges = history.filter { it.kind == EntryKind.Charge }
        val charging = ReportSection(
            "Charging totals",
            listOf(
                row("Sessions", charges.size.takeIf { it > 0 }?.toString()),
                row("Energy added", charges.takeIf { it.isNotEmpty() }?.let { c -> Format.n(c.sumOf { it.kwh }, 0) + " kWh" }),
                row("DC fast sessions", charges.takeIf { it.isNotEmpty() }?.let { c -> c.count { it.fast }.toString() }),
            ),
        )

        return BatteryReport(
            title = TITLE,
            date = dateText(now),
            carLine = listOfNotNull(
                "Fisker " + settings.model.label,
                rated.takeIf { it > 0 }?.let { Format.n(it, 1) + " kWh rated" },
                vin?.let { "VIN $it" },
            ).joinToString(" · "),
            tiles = tiles,
            sections = listOf(car, health, cells, temps, electrical, drain, charging),
            faults = faultSection(scans.maxByOrNull { it.time }, dateText, describe),
            footer = FOOTER,
        )
    }

    private fun faultSection(scan: SavedScan?, dateText: (Long) -> String, describe: (SavedCode) -> String): ReportSection {
        if (scan == null) return ReportSection("Latest fault scan", listOf(ReportRow("Last scan", "not run yet", ReportTone.Missing)))
        val active = scan.codes.filter { it.state == DtcState.Active }
        return ReportSection(
            "Latest fault scan",
            listOf(
                ReportRow("Scanned", dateText(scan.time)),
                ReportRow("Active codes", scan.active.toString(), if (scan.active > 0) ReportTone.Bad else ReportTone.Good),
                ReportRow("Stored codes", scan.stored.toString(), if (scan.stored > 0) ReportTone.Warn else ReportTone.Normal),
            ),
            codes = active.map { ReportCode(it.module, it.code, describe(it)) },
        )
    }

    private fun row(label: String, value: String?, tone: ReportTone? = null) =
        if (value == null) ReportRow(label, NOT_MEASURED, ReportTone.Missing) else ReportRow(label, value, tone ?: ReportTone.Normal)

    private fun plural(n: Int) = if (n == 1) "" else "s"

    fun balanceTone(mv: Double) = when {
        mv <= 60 -> ReportTone.Good
        mv <= 100 -> ReportTone.Warn
        else -> ReportTone.Bad
    }

    fun auxTone(volts: Double) = when {
        volts >= 12.4 -> ReportTone.Good
        volts >= 12.0 -> ReportTone.Warn
        else -> ReportTone.Bad
    }

    private fun defaultDate(time: Long): String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(time))

    /** A file name such as "ocean-live-battery-report-2026-11-12.pdf". */
    fun fileName(now: Long): String {
        val c = java.util.Calendar.getInstance().apply { timeInMillis = now }
        return String.format(
            java.util.Locale.US, "ocean-live-battery-report-%04d-%02d-%02d.pdf",
            c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH),
        )
    }

    /**
     * Splits sections of these [heights] into two columns without changing their order,
     * so the taller column is as short as possible. Returns how many go in the left column.
     */
    fun splitColumns(heights: List<Float>): Int {
        if (heights.size < 2) return heights.size
        val total = heights.sum()
        var best = 1
        var bestMax = Float.MAX_VALUE
        var left = 0f
        for (i in 1 until heights.size) {
            left += heights[i - 1]
            val m = maxOf(left, total - left)
            if (m < bestMax) { bestMax = m; best = i }
        }
        return best
    }

    /**
     * How many items of these [heights] fit in [space]. When some are left out, room is
     * kept for a "+ N more" line of [moreHeight].
     */
    fun itemsThatFit(heights: List<Float>, space: Float, moreHeight: Float): Int {
        if (heights.sum() <= space) return heights.size
        var used = moreHeight
        var n = 0
        for (h in heights) {
            if (used + h > space) break
            used += h
            n++
        }
        return n
    }
}
