package com.justicemw.oceanlive.ui

import androidx.annotation.StringRes
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
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.rememberStrings
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
    onOpen12v: () -> Unit,
) {
    if (LocalLandscape.current) {
        LiveLandscape(state, settings, history, parked, found, bluetoothOn, onScan, onCancelScan, onConnect, onConnectSaved, onDisconnect, onOpen12v)
        return
    }
    val snap = state.snapshot
    val showDash = state.status == Status.Live || state.status == Status.Reconnecting || snap.soc != null

    when (state.status) {
        Status.Scanning -> { ScanList(found, onConnect, onCancelScan); return }
        Status.Connecting -> { Connecting(state.adapterName); return }
        Status.Idle, Status.Error -> if (!showDash || state.status == Status.Error || state.resting) {
            StartCard(state, settings, bluetoothOn, onScan, onConnectSaved)
            if (!showDash) return
        }
        else -> Unit
    }

    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(8.dp))
        RingBlock(state, settings, history)
    }

    SessionCards(state, settings)

    val drain = parked.lastOrNull()?.takeIf { System.currentTimeMillis() - it.end < PARKED_SHOW_MS }
    AnimatedVisibility(drain != null && state.mode == Mode.Parked, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        if (drain != null) ParkedCard(drain, settings)
    }

    SectionTitle(stringResource(R.string.live_battery))
    TileRow {
        Tile(stringResource(R.string.pack_voltage), snap.packV?.let { Format.n(it, 1) + " V" }, Modifier.weight(1f), accent = Violet)
        Tile(stringResource(R.string.live_current), snap.packA?.let { Format.n(it, 1) + " A" }, Modifier.weight(1f), accent = Cyan)
    }
    TileRow {
        val maxTemp = Format.temp(snap.tempMax, settings)
        Tile(stringResource(R.string.live_battery_temp), Format.temp(snap.tempAvg, settings), Modifier.weight(1f), accent = Warn,
            caption = maxTemp?.let { stringResource(R.string.live_max, it) })
        val spread = snap.cellSpread
        Tile(stringResource(R.string.cell_spread), spread?.let { "${it.roundToInt()} mV" }, Modifier.weight(1f), accent = Aqua,
            caption = spread?.let { stringResource(balanceLabel(it)) }, captionColor = spread?.let { balanceColor(it) } ?: Dim)
    }
    TileRow {
        val v12 = snap.aux12v
        val source = snap.aux12vSource?.let { stringResource(v12SourceLabel(it)) }
        Tile(stringResource(R.string.v12_battery), v12?.let { Format.n(it, 2) + " V" }, Modifier.weight(1f), accent = Good,
            caption = v12?.let { stringResource(auxStatus(it)) + (source?.let { s -> " · $s" } ?: "") },
            captionColor = v12?.let { if (it < 12.0) Bad else if (it < 12.4) Warn else Dim } ?: Dim, onClick = onOpen12v)
        val average = Format.efficiency(Format.whPerKm(history), settings)
        Tile(stringResource(R.string.live_odometer), Format.distance(snap.odometerKm, settings), Modifier.weight(1f), accent = Violet,
            caption = average?.let { stringResource(R.string.live_avg, it) })
    }

    state.abrpStatus?.let {
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.live_abrp, it), color = if (it == stringResource(R.string.abrp_sent)) Dim else Warn, fontSize = 12.sp)
    }
    Spacer(Modifier.height(16.dp))
    if (state.status == Status.Live || state.status == Status.Reconnecting || state.status == Status.Watching) {
        GhostButton(stringResource(if (state.status == Status.Reconnecting) R.string.stop_reconnecting else R.string.disconnect), onDisconnect, color = Dim)
    }
}

/** The status pill, the charge ring with % and range inside, and the power under it. */
@Composable
private fun RingBlock(state: CarState, settings: Settings, history: List<HistoryEntry>, ringSize: Dp = 230.dp, compact: Boolean = false) {
    val snap = state.snapshot
    val charging = state.mode == Mode.Charging
    val power = snap.powerKw
    val pill = when {
        state.status == Status.Reconnecting -> Triple(stringResource(R.string.status_reconnecting), Warn, true)
        state.status == Status.Watching -> Triple(stringResource(state.watchStatus), Violet, true)
        state.status != Status.Live -> Triple(
            state.lastUpdate?.let { stringResource(R.string.live_last_seen, DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it))) }
                ?: stringResource(R.string.live_offline),
            Dim, false,
        )
        charging -> Triple(stringResource(if (state.currentCharge?.fast == true) R.string.status_dc_fast else R.string.status_charging), Good, true)
        state.mode == Mode.Driving -> Triple(stringResource(R.string.status_driving), Cyan, true)
        else -> Triple(stringResource(R.string.live_parked_live), Aqua, false)
    }
    Pill(pill.first, pill.second, pill.third)
    Spacer(Modifier.height(if (compact) 4.dp else 10.dp))
    // The numbers inside shrink with the ring, so they still fit in a small window.
    val scale = (ringSize / 230.dp).coerceIn(0.5f, 1f)
    SocRing(snap.soc, charging, state.status == Status.Live, ringSize) {
        RollingText(snap.soc?.let { Format.n(it, 1) + "%" } ?: "—", Color.White, (46 * scale).sp, FontWeight.Bold)
        Text(Format.range(snap.soc, settings, history) ?: stringResource(R.string.range_unknown), color = Dim, fontSize = (14 * scale).coerceAtLeast(11f).sp)
    }
    RollingText(power?.let { Format.n(abs(it), 1) + " kW" } ?: "— kW", powerColor(power), if (compact) 18.sp else 22.sp, FontWeight.SemiBold)
    Text(stringResource(powerLabel(power, charging)), color = Dim, fontSize = if (compact) 11.sp else 12.sp)
}

/** Power colour by direction: into the battery, out of it, or idle. */
private fun powerColor(power: Double?) = when {
    power == null -> Dim
    power > 0.3 -> Good
    power < -0.3 -> Cyan
    else -> Dim
}

@StringRes
private fun powerLabel(power: Double?, charging: Boolean) = when {
    power == null -> R.string.power_label
    power > 0.3 -> if (charging) R.string.power_into_battery else R.string.power_regenerating
    power < -0.3 -> R.string.power_from_battery
    else -> R.string.power_idle
}

/** The "This charge" or "This drive" card while one is under way. */
@Composable
private fun SessionCards(state: CarState, settings: Settings, compact: Boolean = false) {
    val snap = state.snapshot
    val charging = state.mode == Mode.Charging
    val power = snap.powerKw
    AnimatedVisibility(charging && state.currentCharge != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        val c = state.currentCharge
        if (c != null) Column {
            SectionTitle(stringResource(R.string.live_this_charge), compact)
            Card(glow = Good) {
                KeyValue(stringResource(R.string.energy_added), Format.n(c.kwh, 1) + " kWh", Good)
                KeyValue(stringResource(R.string.live_charging_for), Format.duration(c.minutes))
                c.socStart?.let { KeyValue(stringResource(R.string.live_started_at), "${it.roundToInt()}%") }
                KeyValue(stringResource(R.string.peak_power), c.peakKw?.let { Format.n(it, 1) + " kW" })
                timeToTarget(snap.soc, power, settings)?.let { KeyValue(stringResource(R.string.to_target, settings.alertHigh), it, Aqua) }
            }
        }
    }

    AnimatedVisibility(state.mode == Mode.Driving && state.currentDrive != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        val d = state.currentDrive
        if (d != null) Column {
            SectionTitle(stringResource(R.string.live_this_drive), compact)
            Card(glow = Cyan) {
                KeyValue(stringResource(R.string.distance), Format.distance(d.distanceKm, settings, 1))
                KeyValue(stringResource(R.string.energy_used), Format.n(d.kwh, 1) + " kWh")
                KeyValue(stringResource(R.string.efficiency), Format.efficiency(d.whPerKm, settings), Cyan)
                KeyValue(stringResource(R.string.live_time), Format.duration(d.minutes))
            }
        }
    }
}

/**
 * The Live tab in a window wider than tall (phone sideways, tablet, or split screen on the car's
 * display): the charge ring on the left, everything else on the right, the essentials without scrolling.
 */
@Composable
private fun LiveLandscape(
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
    onOpen12v: () -> Unit,
) {
    val snap = state.snapshot
    val showDash = state.status == Status.Live || state.status == Status.Reconnecting || snap.soc != null
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 420.dp
        val leftWidth = maxWidth * 0.4f
        // Room for the pill above the ring and the power under it.
        val around = if (compact) 72.dp else 96.dp
        val ring = minOf(maxHeight - around, leftWidth - 8.dp).coerceIn(96.dp, 320.dp)
        Row(Modifier.fillMaxSize()) {
            Column(
                Modifier.width(leftWidth).fillMaxHeight(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                RingBlock(state, settings, history, ring, compact = true)
            }
            Spacer(Modifier.width(12.dp))
            BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
                val paneWidth = maxWidth
                val paneHeight = maxHeight
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 4.dp, bottom = 8.dp)) {
                    when (state.status) {
                        Status.Scanning -> ScanList(found, onConnect, onCancelScan)
                        Status.Connecting -> Connecting(state.adapterName, top = 24.dp)
                        else -> {
                            val idle = state.status == Status.Idle || state.status == Status.Error
                            if (idle && (!showDash || state.status == Status.Error || state.resting)) {
                                StartCard(state, settings, bluetoothOn, onScan, onConnectSaved, buttonsFirst = true)
                                Spacer(Modifier.height(10.dp))
                            }
                            if (showDash) LandscapeDash(state, settings, history, parked, paneWidth, paneHeight, compact, onDisconnect, onOpen12v)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LandscapeDash(
    state: CarState,
    settings: Settings,
    history: List<HistoryEntry>,
    parked: List<ParkedDrain>,
    paneWidth: Dp,
    paneHeight: Dp,
    compact: Boolean,
    onDisconnect: () -> Unit,
    onOpen12v: () -> Unit,
) {
    val snap = state.snapshot
    val charging = state.mode == Mode.Charging
    val power = snap.powerKw
    val gap = if (compact) 8.dp else 10.dp
    // Two columns when the pane is narrow, three when it is wide, or when three rows of two would not fit the height.
    val tileHeight = if (compact) 58.dp else 86.dp
    val columns = when {
        paneWidth >= 440.dp -> 3
        paneWidth < 280.dp -> 2
        tileHeight * 3 + gap * 2 <= paneHeight -> 2
        else -> 3
    }
    val powerText = power?.let { Format.n(abs(it), 1) + " kW" }
    val powerCaption = stringResource(powerLabel(power, charging))
    val tempText = Format.temp(snap.tempAvg, settings)
    val maxTemp = Format.temp(snap.tempMax, settings)?.let { stringResource(R.string.live_max, it) }
    val efficiency = Format.efficiency(Format.whPerKm(history), settings)
    val range = Format.range(snap.soc, settings, history)
    TileGrid(columns, listOf<@Composable (Modifier) -> Unit>(
        { m -> Tile(stringResource(R.string.power), powerText, m, accent = powerColor(power).takeIf { it != Dim } ?: Aqua,
            caption = powerCaption.takeIf { !compact }, compact = compact) },
        { m -> Tile(stringResource(R.string.live_battery_temp), tempText, m, accent = Warn, caption = maxTemp.takeIf { !compact }, compact = compact) },
        { m -> Tile(stringResource(R.string.pack_voltage), snap.packV?.let { Format.n(it, 1) + " V" }, m, accent = Violet, compact = compact) },
        { m -> Tile(stringResource(R.string.live_current), snap.packA?.let { Format.n(it, 1) + " A" }, m, accent = Cyan, compact = compact) },
        { m -> Tile(stringResource(R.string.efficiency), efficiency, m, accent = Aqua, compact = compact) },
        { m -> Tile(stringResource(R.string.live_range), range, m, accent = Good, compact = compact) },
    ), gap)

    SessionCards(state, settings, compact = true)

    SectionTitle(stringResource(R.string.live_battery), compact = true)
    val spread = snap.cellSpread
    val v12 = snap.aux12v
    val source = snap.aux12vSource?.let { stringResource(v12SourceLabel(it)) }
    val spreadCaption = spread?.let { stringResource(balanceLabel(it)) }
    val v12Caption = v12?.let { stringResource(auxStatus(it)) + (source?.let { s -> " · $s" } ?: "") }
    TileGrid(if (paneWidth >= 300.dp) 3 else 2, listOf<@Composable (Modifier) -> Unit>(
        { m -> Tile(stringResource(R.string.cell_spread), spread?.let { "${it.roundToInt()} mV" }, m, accent = Aqua,
            caption = spreadCaption, captionColor = spread?.let { balanceColor(it) } ?: Dim, compact = true) },
        { m -> Tile(stringResource(R.string.v12_battery), v12?.let { Format.n(it, 2) + " V" }, m, accent = Good,
            caption = v12Caption, captionColor = v12?.let { if (it < 12.0) Bad else if (it < 12.4) Warn else Dim } ?: Dim,
            onClick = onOpen12v, compact = true) },
        { m -> Tile(stringResource(R.string.live_odometer), Format.distance(snap.odometerKm, settings), m, accent = Violet, compact = true) },
    ), gap)

    val drain = parked.lastOrNull()?.takeIf { System.currentTimeMillis() - it.end < PARKED_SHOW_MS }
    AnimatedVisibility(drain != null && state.mode == Mode.Parked, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        if (drain != null) ParkedCard(drain, settings, compact = true)
    }

    state.abrpStatus?.let {
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.live_abrp, it), color = if (it == stringResource(R.string.abrp_sent)) Dim else Warn, fontSize = 12.sp)
    }
    if (state.status == Status.Live || state.status == Status.Reconnecting || state.status == Status.Watching) {
        Spacer(Modifier.height(12.dp))
        GhostButton(stringResource(if (state.status == Status.Reconnecting) R.string.stop_reconnecting else R.string.disconnect), onDisconnect, color = Dim)
    }
}

/** How long after reconnecting the "While parked" card stays on the Live screen. */
private const val PARKED_SHOW_MS = 12 * 3_600_000L

@Composable
private fun ParkedCard(d: ParkedDrain, settings: Settings, compact: Boolean = false) {
    val strings = rememberStrings()
    Column {
        SectionTitle(stringResource(R.string.live_while_parked), compact)
        Card {
            val kwh = d.kwh(settings.usableKwh)
            val span = Format.span(d.hours, strings)
            val main = when {
                d.drop < 0.05 -> stringResource(R.string.parked_no_drop, span)
                kwh > 0 -> stringResource(R.string.parked_drop_kwh, Format.n(d.drop, 1), span, Format.n(kwh, 1))
                else -> stringResource(R.string.parked_drop, Format.n(d.drop, 1), span)
            }
            Text(main, color = Color.White, fontWeight = FontWeight.SemiBold)
            val since = stringResource(R.string.parked_since)
            val text = if (d.hours >= 2 && d.drop >= 0.05) stringResource(R.string.parked_per_day, Format.n(d.perDay, 1)) + " " + since else since
            Text(text, color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/**
 * How to connect. With [buttonsFirst] (landscape) the buttons come straight after the title,
 * so a short window never pushes them out of view.
 */
@Composable
private fun StartCard(
    state: CarState, settings: Settings, bluetoothOn: Boolean, onScan: () -> Unit, onConnectSaved: () -> Unit,
    buttonsFirst: Boolean = false,
) {
    if (!buttonsFirst) Spacer(Modifier.height(24.dp))
    Card {
        Text(stringResource(R.string.start_title), color = Color.White, fontSize = if (buttonsFirst) 17.sp else 20.sp, fontWeight = FontWeight.Bold)
        if (buttonsFirst) {
            Spacer(Modifier.height(10.dp))
            StartButtons(settings, onScan, onConnectSaved)
        } else {
            Spacer(Modifier.height(6.dp))
        }
        if (!state.resting) {
            if (buttonsFirst) Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.start_hint), color = Dim, fontSize = if (buttonsFirst) 13.sp else TextUnit.Unspecified)
        }
        if (!bluetoothOn) {
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.start_bluetooth_off), color = Warn)
        }
        state.message?.let {
            Spacer(Modifier.height(10.dp))
            // Stopping so the car can sleep is normal, not an error.
            Text(it, color = if (state.resting) Dim else Bad)
        }
        if (!buttonsFirst) {
            Spacer(Modifier.height(18.dp))
            StartButtons(settings, onScan, onConnectSaved)
        }
    }
}

@Composable
private fun StartButtons(settings: Settings, onScan: () -> Unit, onConnectSaved: () -> Unit) {
    if (settings.adapterAddress != null) {
        GradientButton(stringResource(R.string.connect_to, settings.adapterName ?: stringResource(R.string.adapter_generic)), onConnectSaved)
        Spacer(Modifier.height(10.dp))
        GhostButton(stringResource(R.string.start_choose_other), onScan)
    } else {
        GradientButton(stringResource(R.string.start_find_adapter), onScan)
    }
}

@Composable
private fun Connecting(name: String?, top: Dp = 90.dp) {
    Column(Modifier.fillMaxWidth().padding(top = top), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = Aqua, strokeWidth = 3.dp, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.connecting_to, name ?: stringResource(R.string.adapter_generic)), color = Color.White, fontSize = 17.sp)
        Text(stringResource(R.string.connecting_hint), color = Dim, fontSize = 13.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ScanList(found: List<FoundAdapter>, onConnect: (FoundAdapter) -> Unit, onCancel: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(color = Aqua, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(stringResource(R.string.scan_looking), color = Dim, modifier = Modifier.weight(1f))
        TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel), color = Aqua) }
    }
    Spacer(Modifier.height(10.dp))
    if (found.isEmpty()) Text(stringResource(R.string.scan_hint), color = Dim, fontSize = 13.sp)
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

private fun timeToTarget(soc: Double?, powerKw: Double?, s: Settings): String? =
    Format.minutesToTarget(soc, powerKw, s)?.let { "≈ " + Format.duration(it) }

@StringRes
fun balanceLabel(mv: Double): Int = when {
    mv <= 30 -> R.string.balance_well
    mv <= 60 -> R.string.balance_normal
    mv <= 100 -> R.string.balance_uneven
    else -> R.string.balance_very_uneven
}

fun balanceColor(mv: Double) = when {
    mv <= 60 -> Good
    mv <= 100 -> Warn
    else -> Bad
}

/** Rough reading of a 12V voltage. Above ~13.2 V the car's DC-DC converter is charging it. */
@StringRes
fun auxStatus(volts: Double): Int = when {
    volts >= 13.2 -> R.string.aux_charging
    volts >= 12.4 -> R.string.aux_good
    volts >= 12.0 -> R.string.aux_low
    else -> R.string.aux_very_low
}

/** Where a 12V reading came from, as stored ("BMS", "OBD port", ...), in the phone's language. */
@StringRes
fun v12SourceLabel(source: String): Int = when (source) {
    com.justicemw.oceanlive.car.V12Log.SOURCE_BMS -> R.string.v12_source_bms
    com.justicemw.oceanlive.car.V12Log.SOURCE_ASLEEP -> R.string.v12_source_asleep
    else -> R.string.v12_source_port
}
