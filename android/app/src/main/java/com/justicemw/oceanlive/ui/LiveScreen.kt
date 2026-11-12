package com.justicemw.oceanlive.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.ParkedDrain
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.obd.FoundAdapter
import java.text.DateFormat
import java.util.Date
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
fun LiveScreen(
    state: CarState,
    settings: Settings,
    history: List<HistoryEntry>,
    parked: List<ParkedDrain>,
    found: List<FoundAdapter>,
    bluetoothOn: Boolean,
    onScan: () -> Unit,
    onCancelScan: () -> Unit,
    onConnect: (FoundAdapter) -> Unit,
    onConnectSaved: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val snap = state.snapshot
    val showDash = state.status == Status.Live || state.status == Status.Reconnecting || snap.soc != null

    when (state.status) {
        Status.Scanning -> { ScanList(found, onConnect, onCancelScan); return }
        Status.Connecting -> { Connecting(state.adapterName); return }
        Status.Idle, Status.Error -> if (!showDash || state.status == Status.Error) {
            StartCard(state, settings, bluetoothOn, onScan, onConnectSaved)
            if (!showDash) return
        }
        else -> Unit
    }

    val charging = state.mode == Mode.Charging
    val power = snap.powerKw
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(8.dp))
        val pill = when {
            state.status == Status.Reconnecting -> Triple("Reconnecting", Warn, true)
            state.status != Status.Live -> Triple(state.lastUpdate?.let { "Last seen " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)) } ?: "Offline", Dim, false)
            charging -> Triple(if (state.currentCharge?.fast == true) "DC fast charging" else "Charging", Good, true)
            state.mode == Mode.Driving -> Triple("Driving", Cyan, true)
            else -> Triple("Parked · live", Aqua, false)
        }
        Pill(pill.first, pill.second, pill.third)
        Spacer(Modifier.height(10.dp))
        SocRing(snap.soc, charging, state.status == Status.Live) {
            RollingText(snap.soc?.let { Format.n(it, 1) + "%" } ?: "—", Color.White, 46.sp, FontWeight.Bold)
            Text(Format.range(snap.soc, settings, history) ?: "range unknown", color = Dim, fontSize = 14.sp)
        }
        // Power, with a direction-coloured label.
        val powerColor = when {
            power == null -> Dim
            power > 0.3 -> Good
            power < -0.3 -> Cyan
            else -> Dim
        }
        RollingText(power?.let { Format.n(abs(it), 1) + " kW" } ?: "— kW", powerColor, 22.sp, FontWeight.SemiBold)
        Text(
            when {
                power == null -> "power"
                power > 0.3 -> if (charging) "into the battery" else "regenerating"
                power < -0.3 -> "from the battery"
                else -> "idle"
            },
            color = Dim, fontSize = 12.sp,
        )
    }

    AnimatedVisibility(charging && state.currentCharge != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        val c = state.currentCharge
        if (c != null) Column {
            SectionTitle("This charge")
            Card(glow = Good) {
                KeyValue("Energy added", Format.n(c.kwh, 1) + " kWh", Good)
                KeyValue("Charging for", Format.duration(c.minutes))
                c.socStart?.let { KeyValue("Started at", "${it.roundToInt()}%") }
                KeyValue("Peak power", c.peakKw?.let { Format.n(it, 1) + " kW" })
                timeToTarget(snap.soc, power, settings)?.let { KeyValue("To ${settings.alertHigh}%", it, Aqua) }
            }
        }
    }

    AnimatedVisibility(state.mode == Mode.Driving && state.currentDrive != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        val d = state.currentDrive
        if (d != null) Column {
            SectionTitle("This drive")
            Card(glow = Cyan) {
                KeyValue("Distance", Format.distance(d.distanceKm, settings, 1))
                KeyValue("Energy used", Format.n(d.kwh, 1) + " kWh")
                KeyValue("Efficiency", Format.efficiency(d.whPerKm, settings), Cyan)
                KeyValue("Time", Format.duration(d.minutes))
            }
        }
    }

    val drain = parked.lastOrNull()?.takeIf { System.currentTimeMillis() - it.end < PARKED_SHOW_MS }
    AnimatedVisibility(drain != null && state.mode == Mode.Parked, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        if (drain != null) ParkedCard(drain, settings)
    }

    SectionTitle("Battery")
    TileRow {
        Tile("Pack voltage", snap.packV?.let { Format.n(it, 1) + " V" }, Modifier.weight(1f), accent = Violet)
        Tile("Current", snap.packA?.let { Format.n(it, 1) + " A" }, Modifier.weight(1f), accent = Cyan)
    }
    TileRow {
        Tile("Battery temp", Format.temp(snap.tempAvg, settings), Modifier.weight(1f), accent = Warn,
            caption = snap.tempMax?.let { "max " + Format.temp(it, settings) })
        val spread = snap.cellSpread
        Tile("Cell spread", spread?.let { "${it.roundToInt()} mV" }, Modifier.weight(1f), accent = Aqua,
            caption = spread?.let { balanceLabel(it) }, captionColor = spread?.let { balanceColor(it) } ?: Dim)
    }
    TileRow {
        val v12 = snap.aux12v
        Tile("12V battery", v12?.let { Format.n(it, 2) + " V" }, Modifier.weight(1f), accent = Good,
            caption = v12?.let { auxStatus(it) + (snap.aux12vSource?.let { s -> " · $s" } ?: "") },
            captionColor = v12?.let { if (it < 12.0) Bad else if (it < 12.4) Warn else Dim } ?: Dim)
        Tile("Odometer", Format.distance(snap.odometerKm, settings), Modifier.weight(1f), accent = Violet,
            caption = Format.efficiency(Format.whPerKm(history), settings)?.let { "avg $it" })
    }

    state.abrpStatus?.let {
        Spacer(Modifier.height(4.dp))
        Text("ABRP: $it", color = if (it.startsWith("Sent")) Dim else Warn, fontSize = 12.sp)
    }
    Spacer(Modifier.height(16.dp))
    if (state.status == Status.Live || state.status == Status.Reconnecting) {
        GhostButton(if (state.status == Status.Reconnecting) "Stop reconnecting" else "Disconnect", onDisconnect, color = Dim)
    }
}

/** How long after reconnecting the "While parked" card stays on the Live screen. */
private const val PARKED_SHOW_MS = 12 * 3_600_000L

@Composable
private fun ParkedCard(d: ParkedDrain, settings: Settings) {
    Column {
        SectionTitle("While parked")
        Card {
            val kwh = d.kwh(settings.usableKwh)
            val main = if (d.drop < 0.05) "No drop over ${Format.span(d.hours)}"
            else "−${Format.n(d.drop, 1)}% over ${Format.span(d.hours)}" + (if (kwh > 0) " · about ${Format.n(kwh, 1)} kWh" else "")
            Text(main, color = Color.White, fontWeight = FontWeight.SemiBold)
            val perDay = if (d.hours >= 2 && d.drop >= 0.05) "About ${Format.n(d.perDay, 1)}% a day. " else ""
            Text(perDay + "Since the app last saw the car.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun StartCard(state: CarState, settings: Settings, bluetoothOn: Boolean, onScan: () -> Unit, onConnectSaved: () -> Unit) {
    Spacer(Modifier.height(24.dp))
    Card {
        Text("Connect to your Ocean", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text("Plug a Bluetooth LE OBD adapter into the car, turn the car on, then connect.", color = Dim)
        if (!bluetoothOn) {
            Spacer(Modifier.height(10.dp))
            Text("Bluetooth is off. Turn it on in your phone's settings.", color = Warn)
        }
        state.message?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = Bad)
        }
        Spacer(Modifier.height(18.dp))
        if (settings.adapterAddress != null) {
            GradientButton("Connect to ${settings.adapterName ?: "adapter"}", onConnectSaved)
            Spacer(Modifier.height(10.dp))
            GhostButton("Choose a different adapter", onScan)
        } else {
            GradientButton("Find adapter", onScan)
        }
    }
}

@Composable
private fun Connecting(name: String?) {
    Column(Modifier.fillMaxWidth().padding(top = 90.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = Aqua, strokeWidth = 3.dp, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(16.dp))
        Text("Connecting to ${name ?: "adapter"}", color = Color.White, fontSize = 17.sp)
        Text("Setting up the adapter and waking the car's modules", color = Dim, fontSize = 13.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ScanList(found: List<FoundAdapter>, onConnect: (FoundAdapter) -> Unit, onCancel: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(color = Aqua, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text("Looking for adapters…", color = Dim, modifier = Modifier.weight(1f))
        TextButton(onClick = onCancel) { Text("Cancel", color = Aqua) }
    }
    Spacer(Modifier.height(10.dp))
    if (found.isEmpty()) Text("Make sure the adapter is plugged in and the car is on.", color = Dim, fontSize = 13.sp)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        found.forEach { adapter ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(CardBg)
                    .border(1.dp, CardEdge, RoundedCornerShape(16.dp))
                    .clickable { onConnect(adapter) }.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(adapter.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                    Text(adapter.address, color = Dim, fontSize = 12.sp)
                }
                SignalBars(adapter.rssi)
            }
        }
    }
}

@Composable
private fun SignalBars(rssi: Int) {
    val bars = when {
        rssi > -60 -> 4
        rssi > -70 -> 3
        rssi > -80 -> 2
        else -> 1
    }
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (i in 1..4) {
            Box(Modifier.width(4.dp).height((4 + i * 4).dp).clip(RoundedCornerShape(1.dp)).background(if (i <= bars) Aqua else CardEdge))
        }
    }
}

private fun timeToTarget(soc: Double?, powerKw: Double?, s: Settings): String? {
    if (soc == null || powerKw == null || powerKw < 0.5 || soc >= s.alertHigh || s.usableKwh <= 0) return null
    val kwh = (s.alertHigh - soc) / 100 * s.usableKwh
    return "≈ " + Format.duration((kwh / powerKw * 60).roundToInt().toLong())
}

fun balanceLabel(mv: Double) = when {
    mv <= 30 -> "Well balanced"
    mv <= 60 -> "Normal"
    mv <= 100 -> "Uneven"
    else -> "Very uneven"
}

fun balanceColor(mv: Double) = when {
    mv <= 60 -> Good
    mv <= 100 -> Warn
    else -> Bad
}

/** Rough reading of a 12V voltage. Above ~13.2 V the car's DC-DC converter is charging it. */
fun auxStatus(volts: Double): String = when {
    volts >= 13.2 -> "Charging"
    volts >= 12.4 -> "Good"
    volts >= 12.0 -> "Low"
    else -> "Very low"
}
