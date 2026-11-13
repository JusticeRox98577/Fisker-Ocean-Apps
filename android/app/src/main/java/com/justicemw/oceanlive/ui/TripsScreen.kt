package com.justicemw.oceanlive.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.car.ChargeCurve
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.MonthTotals
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.chargeCost
import com.justicemw.oceanlive.car.monthTotals
import com.justicemw.oceanlive.car.regenPercent
import com.justicemw.oceanlive.car.regenTotals
import java.util.Calendar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

@Composable
fun TripsScreen(history: List<HistoryEntry>, settings: Settings, onExport: () -> Unit, onClear: () -> Unit, onDelete: (HistoryEntry) -> Unit) {
    var filter by remember { mutableStateOf<EntryKind?>(null) }
    var confirmClear by remember { mutableStateOf(false) }

    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(stringResource(R.string.trips_all), filter == null) { filter = null }
        FilterChip(stringResource(R.string.trips_drives), filter == EntryKind.Drive) { filter = EntryKind.Drive }
        FilterChip(stringResource(R.string.trips_charges), filter == EntryKind.Charge) { filter = EntryKind.Charge }
    }

    val drives = history.filter { it.kind == EntryKind.Drive }
    if (drives.isNotEmpty()) {
        SectionTitle(stringResource(R.string.trips_totals))
        TileRow {
            Tile(stringResource(R.string.distance), Format.distance(drives.sumOf { it.distanceKm ?: 0.0 }, settings), Modifier.weight(1f), accent = Cyan)
            Tile(stringResource(R.string.average), Format.efficiency(Format.whPerKm(history), settings), Modifier.weight(1f), accent = Aqua)
        }
        regenTotals(history)?.let { (regen, used) ->
            val share = regenPercent(regen, used)?.roundToInt()
            TileRow {
                Tile(stringResource(R.string.regen), "+" + Format.n(regen, 1) + " kWh", Modifier.weight(1f), caption = share?.let { stringResource(R.string.regen_share, it) }, accent = Good)
            }
        }
    }

    if (history.any { it.kind == EntryKind.Charge }) {
        val now = System.currentTimeMillis()
        val lastMonth = Calendar.getInstance().apply { timeInMillis = now; set(Calendar.DAY_OF_MONTH, 1); add(Calendar.MONTH, -1) }
        SectionTitle(stringResource(R.string.trips_charging))
        TileRow {
            MonthTile(stringResource(R.string.trips_this_month), monthTotals(history, settings, now, 0), settings, Modifier.weight(1f), Good)
            val month = SimpleDateFormat("LLLL", Locale.getDefault()).format(lastMonth.time).replaceFirstChar { it.titlecase(Locale.getDefault()) }
            MonthTile(month, monthTotals(history, settings, now, 1), settings, Modifier.weight(1f), Violet)
        }
        if (settings.homePrice <= 0 && settings.dcPrice <= 0) {
            Text(stringResource(R.string.trips_add_price), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
        }
    }

    val list = history.filter { filter == null || it.kind == filter }.asReversed()
    SectionTitle(stringResource(if (list.isEmpty()) R.string.trips_nothing_yet else R.string.trips_recent))
    if (list.isEmpty()) {
        Text(stringResource(R.string.trips_empty), color = Dim, fontSize = 13.sp)
    }
    var lastDay = ""
    val dayFmt = SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEEMMMd"), Locale.getDefault())
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        list.take(200).forEach { e ->
            val day = dayFmt.format(Date(e.start))
            if (day != lastDay) {
                lastDay = day
                Text(day, color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp, start = 4.dp))
            }
            EntryRow(e, settings, onDelete)
        }
    }

    if (history.isNotEmpty()) {
        Spacer(Modifier.height(20.dp))
        GradientButton(stringResource(R.string.trips_export), onExport)
        Spacer(Modifier.height(10.dp))
        GhostButton(stringResource(R.string.trips_clear), { confirmClear = true }, color = Bad)
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text(stringResource(R.string.trips_clear_title)) },
            text = { Text(stringResource(R.string.trips_clear_body)) },
            confirmButton = { TextButton(onClick = { confirmClear = false; onClear() }) { Text(stringResource(R.string.clear), color = Bad) } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text(stringResource(R.string.cancel)) } },
            containerColor = CardBg,
        )
    }
}

@Composable
private fun MonthTile(label: String, t: MonthTotals, s: Settings, modifier: Modifier, accent: Color) {
    val kwh = Format.n(t.kwh, 0) + " kWh"
    if (t.cost != null) Tile(label, Format.money(t.cost, s), modifier, caption = kwh, accent = accent)
    else Tile(label, kwh, modifier, caption = pluralStringResource(R.plurals.trips_charges_count, t.charges, t.charges), accent = accent)
}


@Composable
private fun EntryRow(e: HistoryEntry, s: Settings, onDelete: (HistoryEntry) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val color = if (e.kind == EntryKind.Charge) Good else Cyan
    val time = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(CardBg)
            .border(1.dp, CardEdge, RoundedCornerShape(16.dp))
            .clickable { open = !open }.padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(color))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                val title = if (e.kind == EntryKind.Charge) {
                    stringResource(if (e.fast) R.string.trips_dc_charge else R.string.trips_charge) + " · +" + Format.n(e.kwh, 1) + " kWh"
                } else {
                    stringResource(R.string.trips_drive) + " · " + (Format.distance(e.distanceKm, s, 1) ?: "—")
                }
                Text(title, color = Color.White, fontWeight = FontWeight.SemiBold)
                val cost = Format.money(s.chargeCost(e), s)?.let { " · $it" } ?: ""
                Text(time.format(Date(e.start)) + " · " + Format.duration(e.minutes) + cost, color = Dim, fontSize = 12.sp)
            }
            Text(
                listOfNotNull(e.socStart?.roundToInt(), e.socEnd?.roundToInt()).joinToString(" → ") { "$it%" },
                color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium,
            )
        }
        AnimatedVisibility(open, enter = fadeIn() + expandVertically()) {
            Column(Modifier.padding(top = 10.dp)) {
                if (e.kind == EntryKind.Drive) {
                    KeyValue(stringResource(R.string.energy_used), Format.n(e.kwh, 2) + " kWh")
                    KeyValue(stringResource(R.string.efficiency), Format.efficiency(e.whPerKm, s))
                    e.regenKwh?.let { regen ->
                        val share = regenPercent(regen, e.kwh)?.roundToInt()
                        val pct = share?.let { " (" + stringResource(R.string.regen_share, it) + ")" } ?: ""
                        KeyValue(stringResource(R.string.regen), "+" + Format.n(regen, 1) + " kWh" + pct, Good)
                    }
                } else {
                    e.samples?.let { samples ->
                        Text(stringResource(R.string.trips_charging_curve), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
                        ChargeCurveGraph(samples)
                        Spacer(Modifier.height(8.dp))
                    }
                    KeyValue(stringResource(R.string.peak_power), e.peakKw?.let { Format.n(it, 1) + " kW" })
                    val average = e.samples?.let { ChargeCurve.averageKw(it) }
                        ?: if (e.minutes > 0) e.kwh / (e.minutes / 60.0) else null
                    KeyValue(stringResource(R.string.trips_average_power), average?.let { Format.n(it, 1) + " kW" })
                    e.samples?.let { ChargeCurve.minutesBetween(it) }?.let { KeyValue("10–80 %", Format.duration(it.roundToLong())) }
                    KeyValue(stringResource(R.string.trips_implied_capacity), e.impliedCapacityKwh?.let { Format.n(it, 1) + " kWh" })
                    s.chargeCost(e)?.let { KeyValue(stringResource(R.string.trips_cost), Format.money(it, s), Good) }
                }
                TextButton(onClick = { onDelete(e) }) { Text(stringResource(R.string.trips_delete_entry), color = Bad, fontSize = 13.sp) }
            }
        }
    }
}
