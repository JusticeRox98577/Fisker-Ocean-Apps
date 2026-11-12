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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.MonthTotals
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.chargeCost
import com.justicemw.oceanlive.car.monthTotals
import java.util.Calendar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun TripsScreen(history: List<HistoryEntry>, settings: Settings, onExport: () -> Unit, onClear: () -> Unit, onDelete: (HistoryEntry) -> Unit) {
    var filter by remember { mutableStateOf<EntryKind?>(null) }
    var confirmClear by remember { mutableStateOf(false) }

    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip("All", filter == null) { filter = null }
        FilterChip("Drives", filter == EntryKind.Drive) { filter = EntryKind.Drive }
        FilterChip("Charges", filter == EntryKind.Charge) { filter = EntryKind.Charge }
    }

    val drives = history.filter { it.kind == EntryKind.Drive }
    if (drives.isNotEmpty()) {
        SectionTitle("Totals")
        TileRow {
            Tile("Distance", Format.distance(drives.sumOf { it.distanceKm ?: 0.0 }, settings), Modifier.weight(1f), accent = Cyan)
            Tile("Average", Format.efficiency(Format.whPerKm(history), settings), Modifier.weight(1f), accent = Aqua)
        }
    }

    if (history.any { it.kind == EntryKind.Charge }) {
        val now = System.currentTimeMillis()
        val lastMonth = Calendar.getInstance().apply { timeInMillis = now; set(Calendar.DAY_OF_MONTH, 1); add(Calendar.MONTH, -1) }
        SectionTitle("Charging")
        TileRow {
            MonthTile("This month", monthTotals(history, settings, now, 0), settings, Modifier.weight(1f), Good)
            MonthTile(SimpleDateFormat("MMMM", Locale.getDefault()).format(lastMonth.time), monthTotals(history, settings, now, 1), settings, Modifier.weight(1f), Violet)
        }
        if (settings.homePrice <= 0 && settings.dcPrice <= 0) {
            Text("Add your price per kWh in Settings to see what charging costs.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
        }
    }

    val list = history.filter { filter == null || it.kind == filter }.asReversed()
    SectionTitle(if (list.isEmpty()) "Nothing yet" else "Recent")
    if (list.isEmpty()) {
        Text("Drives and charging sessions appear here once the app has been connected through them.", color = Dim, fontSize = 13.sp)
    }
    var lastDay = ""
    val dayFmt = SimpleDateFormat("EEEE, MMM d", Locale.getDefault())
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
        GradientButton("Export CSV", onExport)
        Spacer(Modifier.height(10.dp))
        GhostButton("Clear history", { confirmClear = true }, color = Bad)
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear all history?") },
            text = { Text("This deletes every saved drive and charge, including the data used to measure battery capacity. It can't be undone.") },
            confirmButton = { TextButton(onClick = { confirmClear = false; onClear() }) { Text("Clear", color = Bad) } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
            containerColor = CardBg,
        )
    }
}

@Composable
private fun MonthTile(label: String, t: MonthTotals, s: Settings, modifier: Modifier, accent: Color) {
    val kwh = Format.n(t.kwh, 0) + " kWh"
    if (t.cost != null) Tile(label, Format.money(t.cost, s), modifier, caption = kwh, accent = accent)
    else Tile(label, kwh, modifier, caption = "${t.charges} charge${if (t.charges == 1) "" else "s"}", accent = accent)
}

@Composable
private fun FilterChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(50))
            .background(if (selected) Aqua.copy(alpha = 0.18f) else CardBg)
            .border(1.dp, if (selected) Aqua else CardEdge, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) { Text(text, color = if (selected) Aqua else Dim, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun EntryRow(e: HistoryEntry, s: Settings, onDelete: (HistoryEntry) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val color = if (e.kind == EntryKind.Charge) Good else Cyan
    val time = SimpleDateFormat("h:mm a", Locale.getDefault())
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
                    (if (e.fast) "DC charge" else "Charge") + " · +" + Format.n(e.kwh, 1) + " kWh"
                } else {
                    "Drive · " + (Format.distance(e.distanceKm, s, 1) ?: "—")
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
                    KeyValue("Energy used", Format.n(e.kwh, 2) + " kWh")
                    KeyValue("Efficiency", Format.efficiency(e.whPerKm, s))
                } else {
                    KeyValue("Peak power", e.peakKw?.let { Format.n(it, 1) + " kW" })
                    KeyValue("Average power", if (e.minutes > 0) Format.n(e.kwh / (e.minutes / 60.0), 1) + " kW" else null)
                    KeyValue("Implied capacity", e.impliedCapacityKwh?.let { Format.n(it, 1) + " kWh" })
                    s.chargeCost(e)?.let { KeyValue("Cost", Format.money(it, s), Good) }
                }
                TextButton(onClick = { onDelete(e) }) { Text("Delete this entry", color = Bad, fontSize = 13.sp) }
            }
        }
    }
}
