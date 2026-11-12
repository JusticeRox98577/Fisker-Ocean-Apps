package com.justicemw.oceanlive.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Night
import com.justicemw.oceanlive.car.V12Sample
import com.justicemw.oceanlive.car.V12Stats
import com.justicemw.oceanlive.car.thinForGraph
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt

enum class V12Range(val label: String, val ms: Long, val words: String) {
    Day("24 h", 24 * 3_600_000L, "last 24 hours"),
    Week("7 d", 7 * 24 * 3_600_000L, "last 7 days"),
    Month("30 d", 30 * 24 * 3_600_000L, "last 30 days"),
    Quarter("90 d", 90 * 24 * 3_600_000L, "last 90 days"),
}

/** One line of the 12V stats, shared by the screen and the shared picture. */
data class StatLine(val key: String, val value: String?, val color: Color = Color.White)

private fun ago(time: Long, now: Long) = Format.span(((now - time).coerceAtLeast(0)) / 3_600_000.0) + " ago"

private fun v(volts: Double) = Format.n(volts, 2) + " V"

fun v12StatLines(stats: V12Stats, now: Long): List<StatLine> = buildList {
    add(StatLine("Latest", stats.latest?.let { v(it.volts) + " · " + ago(it.time, now) }))
    val rest = stats.latestRest
    add(StatLine("Latest resting", rest?.let { v(it.volts) + " · " + V12Log.restLabel(it.volts) }, rest?.let { V12Chart.restColor(it.volts) } ?: Color.White))
    add(StatLine("Lowest resting", stats.lowestRest?.let { v(it) }, stats.lowestRest?.let { V12Chart.restColor(it) } ?: Color.White))
    add(StatLine("Average resting", stats.averageRest?.let { v(it) }))
    add(StatLine("Charged by the car", stats.chargedShare?.let { "${(it * 100).roundToInt()}% of awake time" }))
    add(StatLine("Car last charged the 12V", stats.lastCharged?.let { ago(it, now) }))
    add(StatLine("Overnight drop", stats.averageNightDrop?.let {
        "−" + Format.n(it.coerceAtLeast(0.0), 2) + " V a night" + if (stats.nights.size > 1) " (${stats.nights.size} nights)" else ""
    }))
}

fun nightLine(n: V12Night): String {
    val day = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(n.start))
    return "$day: ${Format.n(n.startVolts, 2)} → ${Format.n(n.endVolts, 2)} V over ${Format.span(n.hours)}"
}

const val V12_NOTE = "Resting voltage is read after the car has slept, before it starts charging the 12V. " +
    "12.4 V or more is healthy. Resting under 12.4 V means the 12V battery is weak or the car is drawing power while parked. " +
    "Under 12.0 V the car may not wake up. Over 13.2 V the car's DC-DC converter is charging the 12V."

@Composable
fun V12Screen(
    state: CarState,
    samples: List<V12Sample>,
    onBack: () -> Unit,
    onShare: (V12Range, V12ShareKind) -> Unit,
) {
    var range by rememberSaveable { mutableStateOf(V12Range.Week) }
    var sharing by remember { mutableStateOf(false) }
    val now = remember(samples, range) { System.currentTimeMillis() }
    val from = now - range.ms
    val stats = remember(samples, range) { V12Stats.of(samples, from) }
    val points = remember(samples, range) { thinForGraph(samples, from, now) }

    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp).clip(CircleShape).clickable(onClick = onBack).padding(vertical = 8.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("‹  Battery", color = Aqua, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
    Text("12V battery", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp))
    if (state.status == Status.Watching) {
        Spacer(Modifier.height(8.dp))
        Pill(com.justicemw.oceanlive.car.V12Watch.STATUS, Violet, pulse = true)
    }

    Spacer(Modifier.height(14.dp))
    Chips(V12Range.entries.map { it.label }, range.ordinal) { range = V12Range.entries[it] }
    Spacer(Modifier.height(10.dp))
    Card(glow = Good) {
        if (points.isEmpty()) {
            Text("No 12V readings in the ${range.words} yet", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text("Ocean Live keeps the 12V readings it takes while connected. Nothing extra is asked of the car.",
                color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        } else {
            val reveal = remember { Animatable(0f) }
            LaunchedEffect(range) {
                reveal.snapTo(0f)
                reveal.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
            }
            Canvas(Modifier.fillMaxWidth().height(220.dp)) {
                drawIntoCanvas { V12Chart.draw(it.nativeCanvas, size.width, size.height, density, points, from, now, reveal.value) }
            }
            Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                val fmt = if (range == V12Range.Day) DateFormat.getTimeInstance(DateFormat.SHORT) else DateFormat.getDateInstance(DateFormat.SHORT)
                Text(fmt.format(Date(from)), color = Dim, fontSize = 11.sp, modifier = Modifier.weight(1f))
                Text("Now", color = Dim, fontSize = 11.sp)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Legend("Awake", Aqua)
                Legend("Asleep", Violet)
                Legend("Resting", Good)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 4.dp)) {
                Legend("Driving", Cyan.copy(alpha = 0.5f))
                Legend("Charging", Good.copy(alpha = 0.5f))
            }
        }
    }

    SectionTitle("Stats · ${range.words}")
    Card {
        v12StatLines(stats, now).forEach { KeyValue(it.key, it.value, it.color) }
    }

    if (stats.nights.isNotEmpty()) {
        SectionTitle("Overnight")
        Card {
            stats.nights.takeLast(7).reversed().forEach { n ->
                Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(nightLine(n), color = Color.White, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    Text("−" + Format.n(n.drop.coerceAtLeast(0.0), 2) + " V", color = if (n.drop > 0.15) Warn else Dim, fontSize = 13.sp)
                }
            }
            Text("Resting voltage when the car went to sleep against the morning reading. A healthy car loses only a few hundredths of a volt a night.",
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }

    SectionTitle("What the numbers mean")
    Card {
        Text(V12_NOTE, color = Dim, fontSize = 13.sp)
    }

    Spacer(Modifier.height(16.dp))
    GradientButton("Share 12V data", { sharing = true }, enabled = stats.latest != null)

    if (sharing) {
        AlertDialog(
            onDismissRequest = { sharing = false },
            containerColor = CardBg,
            title = { Text("Share 12V data", color = Color.White) },
            text = {
                androidx.compose.foundation.layout.Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Readings from the ${range.words}.", color = Dim, fontSize = 13.sp)
                    V12ShareKind.entries.forEach { kind ->
                        GhostButton(kind.label, { sharing = false; onShare(range, kind) })
                    }
                }
            },
            confirmButton = { TextButton(onClick = { sharing = false }) { Text("Cancel", color = Dim) } },
        )
    }
}

@Composable
private fun Legend(text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(5.dp))
        Text(text, color = Dim, fontSize = 11.sp)
    }
}
