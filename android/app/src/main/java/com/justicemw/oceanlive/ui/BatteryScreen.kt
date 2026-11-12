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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.ParkedDrain
import com.justicemw.oceanlive.car.ParkedDrains
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Sample
import com.justicemw.oceanlive.car.V12Watch
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

    SectionTitle("Battery health")
    Card(glow = Violet) {
        val measured = measuredCapacityKwh(history)
        val rated = settings.usableKwh
        val samples = history.count { it.impliedCapacityKwh != null }
        if (measured != null && rated > 0) {
            val pct = measured / rated * 100
            Row(Modifier.fillMaxWidth()) {
                Text("Measured capacity", color = Dim, modifier = Modifier.weight(1f))
                Text("${pct.roundToInt()}%", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(8.dp))
            MeterBar((pct / 100).toFloat(), Brush.linearGradient(listOf(Violet, Cyan, Aqua)))
            Spacer(Modifier.height(10.dp))
            KeyValue("Usable now", Format.n(measured, 1) + " kWh")
            KeyValue("Rated usable", Format.n(rated, 1) + " kWh")
            Text("From $samples charging session${if (samples == 1) "" else "s"}. Each charge that adds 20% or more is measured at the battery.",
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        } else {
            Text("Not measured yet", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text("The car doesn't report battery health directly. Ocean Live works it out from your charging: " +
                "keep the app connected through a charge that adds at least 20%.", color = Dim, fontSize = 13.sp)
        }
    }

    SectionTitle("Parked drain")
    Card {
        val perDay = ParkedDrains.averagePerDay(parked)
        if (perDay != null) {
            Row(Modifier.fillMaxWidth()) {
                Text("Average per day", color = Dim, modifier = Modifier.weight(1f))
                Text("${Format.n(perDay, 1)}%", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            }
            if (settings.usableKwh > 0) KeyValue("Energy per day", "about " + Format.n(perDay / 100 * settings.usableKwh, 1) + " kWh")
            KeyValue("Time measured", Format.span(parked.sumOf { it.hours }))
            Text("From ${parked.size} parked period${if (parked.size == 1) "" else "s"} while the app wasn't connected. Charging and drives are left out.",
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        } else {
            Text("Not measured yet", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text("Each time you reconnect after the car has sat parked, Ocean Live checks how much charge it lost while you were away.",
                color = Dim, fontSize = 13.sp)
        }
    }

    SectionTitle("12V battery")
    Card(Modifier.clickable(onClick = onOpen12v), glow = if (state.status == Status.Watching) Violet else null) {
        val volts = s.aux12v ?: v12.lastOrNull()?.volts
        Row(Modifier.fillMaxWidth()) {
            Text(if (s.aux12v != null) "Now" else "Last reading", color = Dim, modifier = Modifier.weight(1f))
            Text(volts?.let { Format.n(it, 2) + " V" } ?: "—", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        s.aux12vSource?.let { Text(it, color = Dim, fontSize = 12.sp) }
        val rest = v12.lastOrNull { it.atRest }
        KeyValue("Latest resting", rest?.let { Format.n(it.volts, 2) + " V · " + V12Log.restLabel(it.volts) }, rest?.let { V12Chart.restColor(it.volts) } ?: Color.White)
        if (state.status == Status.Watching) Text(V12Watch.STATUS, color = Violet, fontSize = 12.sp)
        Text("See the 12V history ›", color = Aqua, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
    }

    SectionTitle("Cells")
    Card {
        KeyValue("Highest", s.cellMax?.let { "${it.roundToInt()} mV" })
        KeyValue("Average", s.cellAvg?.let { "${it.roundToInt()} mV" })
        KeyValue("Lowest", s.cellMin?.let { "${it.roundToInt()} mV" })
        val spread = s.cellSpread
        if (spread != null) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth()) {
                Text("Spread", color = Dim, modifier = Modifier.weight(1f))
                Text("${spread.roundToInt()} mV · ${balanceLabel(spread)}", color = balanceColor(spread), fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            MeterBar((spread / 150).toFloat(), Brush.linearGradient(listOf(Good, Warn, Bad)))
            Text("Under 60 mV is normal. A spread that keeps growing over weeks is worth a dealer check.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }

    SectionTitle("Temperatures")
    Card {
        KeyValue("Battery highest", Format.temp(s.tempMax, settings))
        KeyValue("Battery average", Format.temp(s.tempAvg, settings))
        KeyValue("Battery lowest", Format.temp(s.tempMin, settings))
        KeyValue("Coolant in", Format.temp(s.coolantIn, settings))
        KeyValue("Coolant out", Format.temp(s.coolantOut, settings))
        s.tempAvg?.let {
            Spacer(Modifier.height(8.dp))
            Text(tempAdvice(it), color = Dim, fontSize = 12.sp)
        }
    }

    SectionTitle("High voltage")
    Card {
        KeyValue("Pack voltage", s.packV?.let { Format.n(it, 1) + " V" })
        KeyValue("Pack current", s.packA?.let { Format.n(it, 1) + " A" })
        KeyValue("Power", s.powerKw?.let { Format.n(it, 2) + " kW" })
        KeyValue("Isolation resistance", s.isolation?.let { "${it.roundToInt()} kΩ" })
        state.vin?.let { KeyValue("VIN", it) }
    }

    val charges = history.filter { it.kind == EntryKind.Charge }
    if (charges.isNotEmpty()) {
        SectionTitle("Charging totals")
        Card {
            KeyValue("Sessions", charges.size.toString())
            KeyValue("Energy added", Format.n(charges.sumOf { it.kwh }, 0) + " kWh")
            KeyValue("DC fast sessions", charges.count { it.fast }.toString())
        }
    }

    SectionTitle("Report")
    Card {
        Text("A one-page PDF of everything above plus your latest fault scan, to keep or send to a buyer or shop. " +
            "It uses what the app already has and doesn't read from the car.", color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        GhostButton("Share battery report", onShareReport)
    }
}

private fun tempAdvice(c: Double) = when {
    c < 5 -> "Cold battery: charging and regen are limited until it warms up."
    c < 15 -> "Cool battery: DC fast charging will be slower than its best."
    c <= 40 -> "Comfortable temperature for driving and charging."
    else -> "Warm battery: the car may limit fast-charging power to cool it."
}
