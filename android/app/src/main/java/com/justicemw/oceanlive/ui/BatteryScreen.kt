package com.justicemw.oceanlive.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.rememberStrings
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.ParkedDrain
import com.justicemw.oceanlive.car.ParkedDrains
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Sample
import com.justicemw.oceanlive.car.measuredCapacityKwh
import kotlin.math.roundToInt

@Composable
fun BatteryScreen(
    state: CarState,
    settings: Settings,
    history: List<HistoryEntry>,
    parked: List<ParkedDrain>,
    v12: List<V12Sample>,
    onOpen12v: () -> Unit,
    onShareReport: () -> Unit,
) {
    val s = state.snapshot
    val strings = rememberStrings()

    SectionTitle(stringResource(R.string.battery_health))
    Card(glow = Violet) {
        val measured = measuredCapacityKwh(history)
        val rated = settings.usableKwh
        val samples = history.count { it.impliedCapacityKwh != null }
        if (measured != null && rated > 0) {
            val pct = measured / rated * 100
            Row(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.battery_measured_capacity), color = Dim, modifier = Modifier.weight(1f))
                Text("${pct.roundToInt()}%", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(8.dp))
            MeterBar((pct / 100).toFloat(), Brush.linearGradient(listOf(Violet, Cyan, Aqua)))
            Spacer(Modifier.height(10.dp))
            KeyValue(stringResource(R.string.battery_usable_now), Format.n(measured, 1) + " kWh")
            KeyValue(stringResource(R.string.rated_usable), Format.n(rated, 1) + " kWh")
            Text(pluralStringResource(R.plurals.battery_from_sessions, samples, samples) + " " + stringResource(R.string.battery_measure_note, 20),
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        } else {
            Text(stringResource(R.string.not_measured_title), color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.battery_health_explain, 20), color = Dim, fontSize = 13.sp)
        }
    }

    SectionTitle(stringResource(R.string.parked_drain))
    Card {
        val perDay = ParkedDrains.averagePerDay(parked)
        if (perDay != null) {
            Row(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.average_per_day), color = Dim, modifier = Modifier.weight(1f))
                Text("${Format.n(perDay, 1)}%", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            }
            if (settings.usableKwh > 0) KeyValue(stringResource(R.string.battery_energy_per_day), stringResource(R.string.about_kwh, Format.n(perDay / 100 * settings.usableKwh, 1)))
            KeyValue(stringResource(R.string.time_measured), Format.span(parked.sumOf { it.hours }, strings))
            Text(pluralStringResource(R.plurals.battery_from_parked, parked.size, parked.size),
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        } else {
            Text(stringResource(R.string.not_measured_title), color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.battery_drain_explain),
                color = Dim, fontSize = 13.sp)
        }
    }

    SectionTitle(stringResource(R.string.v12_battery))
    Card(Modifier.clickable(onClick = onOpen12v), glow = if (state.status == Status.Watching) Violet else null) {
        val volts = s.aux12v ?: v12.lastOrNull()?.volts
        Row(Modifier.fillMaxWidth()) {
            Text(stringResource(if (s.aux12v != null) R.string.battery_now else R.string.last_reading), color = Dim, modifier = Modifier.weight(1f))
            Text(volts?.let { Format.n(it, 2) + " V" } ?: "—", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        s.aux12vSource?.let { Text(stringResource(v12SourceLabel(it)), color = Dim, fontSize = 12.sp) }
        val rest = v12.lastOrNull { it.atRest }
        KeyValue(stringResource(R.string.v12_latest_resting), rest?.let { Format.n(it.volts, 2) + " V · " + stringResource(V12Log.restLabel(it.volts)) }, rest?.let { V12Chart.restColor(it.volts) } ?: Color.White)
        if (state.status == Status.Watching) Text(stringResource(state.watchStatus), color = Violet, fontSize = 12.sp)
        Text(stringResource(R.string.battery_see_12v), color = Aqua, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
    }

    SectionTitle(stringResource(R.string.cells))
    Card {
        KeyValue(stringResource(R.string.highest), s.cellMax?.let { "${it.roundToInt()} mV" })
        KeyValue(stringResource(R.string.average), s.cellAvg?.let { "${it.roundToInt()} mV" })
        KeyValue(stringResource(R.string.lowest), s.cellMin?.let { "${it.roundToInt()} mV" })
        val spread = s.cellSpread
        if (spread != null) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.spread), color = Dim, modifier = Modifier.weight(1f))
                Text("${spread.roundToInt()} mV · ${stringResource(balanceLabel(spread))}", color = balanceColor(spread), fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            MeterBar((spread / 150).toFloat(), Brush.linearGradient(listOf(Good, Warn, Bad)))
            Text(stringResource(R.string.battery_spread_note), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }

    SectionTitle(stringResource(R.string.temperatures))
    Card {
        KeyValue(stringResource(R.string.battery_highest), Format.temp(s.tempMax, settings))
        KeyValue(stringResource(R.string.battery_average), Format.temp(s.tempAvg, settings))
        KeyValue(stringResource(R.string.battery_lowest), Format.temp(s.tempMin, settings))
        KeyValue(stringResource(R.string.coolant_in), Format.temp(s.coolantIn, settings))
        KeyValue(stringResource(R.string.coolant_out), Format.temp(s.coolantOut, settings))
        s.tempAvg?.let {
            Spacer(Modifier.height(8.dp))
            Text(stringResource(tempAdvice(it)), color = Dim, fontSize = 12.sp)
        }
    }

    SectionTitle(stringResource(R.string.high_voltage))
    Card {
        KeyValue(stringResource(R.string.pack_voltage), s.packV?.let { Format.n(it, 1) + " V" })
        KeyValue(stringResource(R.string.pack_current), s.packA?.let { Format.n(it, 1) + " A" })
        KeyValue(stringResource(R.string.power), s.powerKw?.let { Format.n(it, 2) + " kW" })
        KeyValue(stringResource(R.string.isolation_resistance), s.isolation?.let { "${it.roundToInt()} kΩ" })
        state.vin?.let { KeyValue(stringResource(R.string.vin), it) }
    }

    val charges = history.filter { it.kind == EntryKind.Charge }
    if (charges.isNotEmpty()) {
        SectionTitle(stringResource(R.string.charging_totals))
        Card {
            KeyValue(stringResource(R.string.sessions), charges.size.toString())
            KeyValue(stringResource(R.string.energy_added), Format.n(charges.sumOf { it.kwh }, 0) + " kWh")
            KeyValue(stringResource(R.string.dc_fast_sessions), charges.count { it.fast }.toString())
        }
    }

    SectionTitle(stringResource(R.string.battery_report_section))
    Card {
        Text(stringResource(R.string.battery_report_explain), color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        GhostButton(stringResource(R.string.battery_share_report), onShareReport)
    }
}

private fun tempAdvice(c: Double) = when {
    c < 5 -> R.string.temp_cold
    c < 15 -> R.string.temp_cool
    c <= 40 -> R.string.temp_ok
    else -> R.string.temp_warm
}
