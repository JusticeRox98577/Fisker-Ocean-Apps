package com.justicemw.oceanlive

import androidx.annotation.StringRes

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
import com.justicemw.oceanlive.ui.v12SourceLabel
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
    /** Shown for any value the app hasn't measured. */
    val NOT_MEASURED = R.string.report_not_measured

    fun build(
        s: Strings,
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
        val snap = snapshot
        val notMeasured = s.get(NOT_MEASURED)
        fun row(@StringRes label: Int, value: String?, tone: ReportTone? = null) =
            if (value == null) ReportRow(s.get(label), notMeasured, ReportTone.Missing) else ReportRow(s.get(label), value, tone ?: ReportTone.Normal)

        val rated = settings.usableKwh
        val measured = measuredCapacityKwh(history)
        val pct = if (measured != null && rated > 0) measured / rated * 100 else null
        val samples = history.count { it.impliedCapacityKwh != null }
        val spread = snap.cellSpread
        val aux = snap.aux12v

        val tiles = listOf(
            ReportTile(
                s.get(R.string.report_capacity), pct?.let { "${it.roundToInt()}%" } ?: "—",
                measured?.let { s.get(R.string.report_kwh_usable, Format.n(it, 1)) } ?: notMeasured,
                when {
                    pct == null -> ReportTone.Missing
                    pct >= 85 -> ReportTone.Good
                    pct >= 70 -> ReportTone.Warn
                    else -> ReportTone.Bad
                },
            ),
            ReportTile(
                s.get(R.string.cell_spread), spread?.let { "${it.roundToInt()} mV" } ?: "—",
                spread?.let { s.get(balanceLabel(it)) } ?: notMeasured, spread?.let { balanceTone(it) } ?: ReportTone.Missing,
            ),
            ReportTile(
                s.get(R.string.v12_battery), aux?.let { Format.n(it, 2) + " V" } ?: "—",
                aux?.let { s.get(auxStatus(it)) } ?: notMeasured, aux?.let { auxTone(it) } ?: ReportTone.Missing,
            ),
        )

        val car = ReportSection(
            s.get(R.string.settings_car),
            listOf(
                row(R.string.vin, vin),
                row(R.string.report_model, s.get(settings.model.label)),
                row(R.string.rated_usable, rated.takeIf { it > 0 }?.let { Format.n(it, 1) + " kWh" }),
                row(R.string.report_live_from, snap.time.takeIf { it > 0 }?.let(dateText)),
            ),
        )

        val health = ReportSection(
            s.get(R.string.battery_health),
            listOf(
                row(R.string.report_measured_usable, measured?.let { Format.n(it, 1) + " kWh" }),
                row(R.string.report_share_of_rated, pct?.let { "${it.roundToInt()}%" }, tiles[0].tone),
                row(R.string.report_samples, if (samples > 0) s.plural(R.plurals.report_sessions, samples, samples) else null),
            ),
            note = s.get(R.string.battery_measure_note, 20),
        )

        val cells = ReportSection(
            s.get(R.string.cells),
            listOf(
                row(R.string.highest, snap.cellMax?.let { "${it.roundToInt()} mV" }),
                row(R.string.average, snap.cellAvg?.let { "${it.roundToInt()} mV" }),
                row(R.string.lowest, snap.cellMin?.let { "${it.roundToInt()} mV" }),
                row(R.string.spread, spread?.let { "${it.roundToInt()} mV · ${s.get(balanceLabel(it))}" }, spread?.let { balanceTone(it) }),
            ),
            note = s.get(R.string.report_spread_note),
        )

        val temps = ReportSection(
            s.get(R.string.temperatures),
            listOf(
                row(R.string.battery_highest, Format.temp(snap.tempMax, settings)),
                row(R.string.battery_average, Format.temp(snap.tempAvg, settings)),
                row(R.string.battery_lowest, Format.temp(snap.tempMin, settings)),
                row(R.string.coolant_in, Format.temp(snap.coolantIn, settings)),
                row(R.string.coolant_out, Format.temp(snap.coolantOut, settings)),
            ),
        )

        val electrical = ReportSection(
            s.get(R.string.report_insulation_12v),
            listOf(
                row(R.string.report_insulation_resistance, snap.isolation?.let { "${it.roundToInt()} kΩ" }),
                row(R.string.v12_battery, aux?.let { Format.n(it, 2) + " V" + (snap.aux12vSource?.let { src -> " (${s.get(v12SourceLabel(src))})" } ?: "") }),
                row(R.string.report_12v_status, aux?.let { s.get(auxStatus(it)) }, aux?.let { auxTone(it) }),
            ),
        )

        val perDay = ParkedDrains.averagePerDay(parked)
        val drain = ReportSection(
            s.get(R.string.parked_drain),
            listOf(
                row(R.string.average_per_day, perDay?.let {
                    if (rated > 0) s.get(R.string.report_drain_kwh, Format.n(it, 1), Format.n(it / 100 * rated, 1))
                    else "${Format.n(it, 1)}%"
                }),
                row(R.string.time_measured, if (perDay != null) Format.span(parked.sumOf { it.hours }, s) else null),
            ),
        )

        val charges = history.filter { it.kind == EntryKind.Charge }
        val charging = ReportSection(
            s.get(R.string.charging_totals),
            listOf(
                row(R.string.sessions, charges.size.takeIf { it > 0 }?.toString()),
                row(R.string.energy_added, charges.takeIf { it.isNotEmpty() }?.let { c -> Format.n(c.sumOf { it.kwh }, 0) + " kWh" }),
                row(R.string.dc_fast_sessions, charges.takeIf { it.isNotEmpty() }?.let { c -> c.count { it.fast }.toString() }),
            ),
        )

        return BatteryReport(
            title = s.get(R.string.report_title),
            date = dateText(now),
            carLine = listOfNotNull(
                "Fisker " + s.get(settings.model.label),
                rated.takeIf { it > 0 }?.let { s.get(R.string.report_kwh_rated, Format.n(it, 1)) },
                vin?.let { s.get(R.string.report_vin_short, it) },
            ).joinToString(" · "),
            tiles = tiles,
            sections = listOf(car, health, cells, temps, electrical, drain, charging),
            faults = faultSection(s, scans.maxByOrNull { it.time }, dateText, describe),
            footer = s.get(R.string.report_footer),
        )
    }

    private fun faultSection(s: Strings, scan: SavedScan?, dateText: (Long) -> String, describe: (SavedCode) -> String): ReportSection {
        val title = s.get(R.string.report_latest_scan)
        if (scan == null) return ReportSection(title, listOf(ReportRow(s.get(R.string.report_last_scan), s.get(R.string.report_not_run), ReportTone.Missing)))
        val active = scan.codes.filter { it.state == DtcState.Active }
        return ReportSection(
            title,
            listOf(
                ReportRow(s.get(R.string.report_scanned), dateText(scan.time)),
                ReportRow(s.get(R.string.report_active_codes), scan.active.toString(), if (scan.active > 0) ReportTone.Bad else ReportTone.Good),
                ReportRow(s.get(R.string.report_stored_codes), scan.stored.toString(), if (scan.stored > 0) ReportTone.Warn else ReportTone.Normal),
            ),
            codes = active.map { ReportCode(it.module, it.code, describe(it)) },
        )
    }

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
