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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.annotation.StringRes
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.Strings
import com.justicemw.oceanlive.rememberStrings
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Method
import com.justicemw.oceanlive.car.V12Watch
import com.justicemw.oceanlive.car.V12Night
import com.justicemw.oceanlive.car.V12Sample
import com.justicemw.oceanlive.car.V12Stats
import com.justicemw.oceanlive.car.thinForGraph
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt

enum class V12Range(@StringRes val label: Int, val ms: Long, @StringRes val words: Int) {
    Day(R.string.range_24h, 24 * 3_600_000L, R.string.range_24h_words),
    Week(R.string.range_7d, 7 * 24 * 3_600_000L, R.string.range_7d_words),
    Month(R.string.range_30d, 30 * 24 * 3_600_000L, R.string.range_30d_words),
    Quarter(R.string.range_90d, 90 * 24 * 3_600_000L, R.string.range_90d_words),
}

/** One line of the 12V stats, shared by the screen and the shared picture. */
data class StatLine(val key: String, val value: String?, val color: Color = Color.White)

private fun ago(s: Strings, time: Long, now: Long) = s.get(R.string.time_ago, Format.span(((now - time).coerceAtLeast(0)) / 3_600_000.0, s))

private fun v(volts: Double) = Format.n(volts, 2) + " V"

fun v12StatLines(s: Strings, stats: V12Stats, now: Long): List<StatLine> = buildList {
    add(StatLine(s.get(R.string.v12_latest), stats.latest?.let { v(it.volts) + " · " + ago(s, it.time, now) }))
    val rest = stats.latestRest
    add(StatLine(s.get(R.string.v12_latest_resting), rest?.let { v(it.volts) + " · " + s.get(V12Log.restLabel(it.volts)) }, rest?.let { V12Chart.restColor(it.volts) } ?: Color.White))
    add(StatLine(s.get(R.string.v12_lowest_resting), stats.lowestRest?.let { v(it) }, stats.lowestRest?.let { V12Chart.restColor(it) } ?: Color.White))
    add(StatLine(s.get(R.string.v12_average_resting), stats.averageRest?.let { v(it) }))
    add(StatLine(s.get(R.string.v12_charged_by_car), stats.chargedShare?.let { s.get(R.string.v12_awake_share, (it * 100).roundToInt()) }))
    add(StatLine(s.get(R.string.v12_last_charged), stats.lastCharged?.let { ago(s, it, now) }))
    add(StatLine(s.get(R.string.v12_overnight_drop), stats.averageNightDrop?.let {
        val drop = Format.n(it.coerceAtLeast(0.0), 2)
        val n = stats.nights.size
        if (n > 1) s.plural(R.plurals.v12_night_drop_nights, n, drop, n) else s.get(R.string.v12_night_drop, drop)
    }))
}

fun nightLine(s: Strings, n: V12Night): String {
    val day = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(n.start))
    return s.get(R.string.v12_night_line, day, Format.n(n.startVolts, 2), Format.n(n.endVolts, 2), Format.span(n.hours, s))
}

@Composable
fun V12Screen(
    state: CarState,
    samples: List<V12Sample>,
    misses: List<Long>,
    onBack: () -> Unit,
    onShare: (V12Range, V12ShareKind) -> Unit,
) {
    val strings = rememberStrings()
    var range by rememberSaveable { mutableStateOf(V12Range.Week) }
    var sharing by remember { mutableStateOf(false) }
    val now = remember(samples, range) { System.currentTimeMillis() }
    val from = now - range.ms
    val stats = remember(samples, range) { V12Stats.of(samples, from) }
    val points = remember(samples, range) { thinForGraph(samples, from, now) }
    val night = remember(samples, misses) { V12Watch.latestNight(samples, misses) }

    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp).clip(CircleShape).clickable(onClick = onBack).padding(vertical = 8.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("‹  " + stringResource(R.string.tab_battery), color = Aqua, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
    Text(stringResource(R.string.v12_battery), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp))
    if (state.status == Status.Watching) {
        Spacer(Modifier.height(8.dp))
        Pill(stringResource(state.watchStatus), Violet, pulse = true)
    }

    Spacer(Modifier.height(14.dp))
    Chips(V12Range.entries.map { stringResource(it.label) }, range.ordinal) { range = V12Range.entries[it] }
    Spacer(Modifier.height(10.dp))
    Card(glow = Good) {
        if (points.isEmpty()) {
            Text(stringResource(R.string.v12_no_readings, stringResource(range.words)), color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.v12_no_readings_hint),
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
                Text(stringResource(R.string.battery_now), color = Dim, fontSize = 11.sp)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Legend(stringResource(R.string.v12_awake), Aqua)
                Legend(stringResource(R.string.v12_asleep), Violet)
                Legend(stringResource(R.string.v12_resting), Good)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 4.dp)) {
                Legend(stringResource(R.string.status_driving), Cyan.copy(alpha = 0.5f))
                Legend(stringResource(R.string.status_charging), Good.copy(alpha = 0.5f))
            }
        }
    }

    SectionTitle(stringResource(R.string.v12_stats) + " · " + stringResource(range.words))
    Card {
        v12StatLines(strings, stats, now).forEach { KeyValue(it.key, it.value, it.color) }
        night?.method?.let { m ->
            val text = if (m == V12Method.Quick) R.string.v12_checks_quick else R.string.v12_checks_kept
            Text(stringResource(text), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        }
        night?.unreachable?.takeIf { it > 0 }?.let { n ->
            Text(pluralStringResource(R.plurals.v12_checks_unreachable, n, n), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }

    if (stats.nights.isNotEmpty()) {
        SectionTitle(stringResource(R.string.v12_overnight))
        Card {
            stats.nights.takeLast(7).reversed().forEach { n ->
                Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(nightLine(strings, n), color = Color.White, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    Text("−" + Format.n(n.drop.coerceAtLeast(0.0), 2) + " V", color = if (n.drop > 0.15) Warn else Dim, fontSize = 13.sp)
                }
            }
            Text(stringResource(R.string.v12_overnight_note),
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }

    SectionTitle(stringResource(R.string.v12_meaning))
    Card {
        Text(stringResource(R.string.v12_note), color = Dim, fontSize = 13.sp)
    }

    Spacer(Modifier.height(16.dp))
    GradientButton(stringResource(R.string.v12_share), { sharing = true }, enabled = stats.latest != null)

    if (sharing) {
        AlertDialog(
            onDismissRequest = { sharing = false },
            containerColor = CardBg,
            title = { Text(stringResource(R.string.v12_share), color = Color.White) },
            text = {
                androidx.compose.foundation.layout.Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.v12_share_from, stringResource(range.words)), color = Dim, fontSize = 13.sp)
                    V12ShareKind.entries.forEach { kind ->
                        GhostButton(stringResource(kind.label), { sharing = false; onShare(range, kind) })
                    }
                }
            },
            confirmButton = { TextButton(onClick = { sharing = false }) { Text(stringResource(R.string.cancel), color = Dim) } },
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
