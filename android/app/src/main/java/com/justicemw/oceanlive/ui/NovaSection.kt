package com.justicemw.oceanlive.ui

import android.content.Intent
import android.net.Uri
import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.car.Car
import com.justicemw.oceanlive.car.NovaCommands
import com.justicemw.oceanlive.car.NovaPhone
import com.justicemw.oceanlive.car.V12Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

/**
 * The Nova page. Before pairing: the code from the car screen. After: a dashboard of the car's last
 * check-in (state, 12 V, signal, where it is) with the remote controls and what was sent lately.
 * Same layout as the iPhone app's NovaView.
 */
@Composable
fun NovaSection() {
    val context = LocalContext.current
    val phone = remember { NovaPhone(context) }
    val scope = rememberCoroutineScope()
    var paired by remember { mutableStateOf(phone.paired) }
    var code by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<NovaPhone.Status?>(null) }
    var waiting by remember { mutableStateOf(phone.pendingCode != null) } // also after leaving the page or the app
    var sending by remember { mutableStateOf<Int?>(null) }
    val sentText = stringResource(R.string.nova_sent)
    val waitingText = stringResource(R.string.nova_waiting)
    val refusedText = stringResource(R.string.nova_refused)
    val expiredText = stringResource(R.string.nova_expired)
    val errorText = stringResource(R.string.nova_error)

    suspend fun <T> io(block: () -> T): T? = try {
        withContext(Dispatchers.IO) { block() }
    } catch (e: Exception) {
        message = errorText.format(e.message ?: "?")
        null
    }

    LaunchedEffect(waiting) {
        while (waiting) {
            when (io { phone.pairingStatus() }) {
                "paired" -> { waiting = false; paired = true; message = null }
                "refused" -> { waiting = false; message = refusedText }
                "expired" -> { waiting = false; message = expiredText }
                else -> if (phone.pendingCode == null) waiting = false
            }
            if (waiting) delay(2000)
        }
    }
    // while paired and on screen: the car's state every 15 seconds
    LaunchedEffect(paired) {
        while (paired) {
            io { phone.status() }?.let { status = it }
            delay(15_000)
        }
    }

    if (!paired) {
        SectionTitle(stringResource(R.string.nova_title))
        Card {
            Text(stringResource(R.string.nova_intro), fontSize = 14.sp)
            OutlinedTextField(
                code, { code = it.uppercase().take(9) }, label = { Text(stringResource(R.string.nova_code)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            if (!waiting) {
                GradientButton(stringResource(R.string.nova_pair), enabled = code.replace(" ", "").length == 8, onClick = {
                    scope.launch {
                        if (io { phone.requestPairing(code) } != null) { waiting = true; message = null }
                    }
                }, modifier = Modifier.padding(top = 8.dp))
            } else {
                Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Aqua, strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(waitingText, fontSize = 14.sp)
                }
                GhostButton(stringResource(R.string.cancel), onClick = { phone.cancelPairing(); waiting = false; message = null },
                    modifier = Modifier.padding(top = 8.dp), color = Dim)
            }
            message?.let { Text(it, fontSize = 13.sp, color = Dim, modifier = Modifier.padding(top = 8.dp)) }
        }
        return
    }

    val s = status
    val send = { action: Int ->
        sending = action
        scope.launch {
            if (io { phone.send(action) } != null) {
                message = sentText
                io { phone.status() }?.let { status = it }
            }
            sending = null
        }
        Unit
    }

    Spacer(Modifier.padding(top = 12.dp))
    Hero(s)
    message?.let { Text(it, fontSize = 13.sp, color = Dim, modifier = Modifier.padding(top = 8.dp, start = 4.dp)) }

    val light = s?.isLight == true
    if (light) {
        Spacer(Modifier.padding(top = 6.dp))
        Card { Text(stringResource(R.string.nova_light_listens), fontSize = 14.sp) }
    } else {
        SectionTitle(stringResource(R.string.nova_controls))
        TileGrid(2, listOf<@Composable (Modifier) -> Unit>(
            { m -> Control(m, "🔒", stringResource(R.string.nova_lock), sending, NovaCommands.LOCK, send) },
            { m -> Control(m, "🔓", stringResource(R.string.nova_unlock), sending, NovaCommands.UNLOCK, send) },
            { m -> Control(m, "❄", stringResource(R.string.nova_climate_on), sending, NovaCommands.CLIMATE_ON, send) },
            { m -> Control(m, "⏻", stringResource(R.string.nova_climate_off), sending, NovaCommands.CLIMATE_OFF, send) },
        ))
        Control(Modifier.fillMaxWidth().padding(top = 10.dp), "💡", stringResource(R.string.nova_flash_lights), sending, NovaCommands.LIGHTS, send, wide = true)
        Text(stringResource(R.string.nova_acts_note), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp, start = 4.dp))
    }

    SectionTitle(stringResource(R.string.nova_section_car))
    val settings by Car.settings.collectAsState()
    val seen = s != null && s.lastSeen > 0
    val volts = s?.v12mV?.takeIf { it > 0 }?.div(1000.0)
    val voltsColor = volts?.let { if (it >= V12Log.LOW_VOLTS) Good else if (it >= V12Log.VERY_LOW_VOLTS) Warn else Bad } ?: Dim
    val rsrp = s?.rsrp ?: 0
    val bars = if (rsrp == 0) 0 else if (rsrp >= -90) 4 else if (rsrp >= -100) 3 else if (rsrp >= -110) 2 else 1
    val signalWords = listOf(R.string.nova_signal_none, R.string.nova_signal_weak, R.string.nova_signal_fair, R.string.nova_signal_good, R.string.nova_signal_excellent)
    val v12Title = stringResource(R.string.nova_v12_title)
    val v12Caption = volts?.let {
        stringResource(if (s.lightAlert) R.string.nova_v12_low else if (it >= V12Log.LOW_VOLTS) R.string.nova_v12_healthy
            else if (it >= V12Log.VERY_LOW_VOLTS) R.string.nova_v12_low else R.string.nova_v12_very_low)
    }
    val signalTitle = stringResource(R.string.nova_signal)
    val signalValue = if (seen) stringResource(signalWords[bars]) else null
    val speedTitle = stringResource(R.string.nova_speed)
    val speedValue = s?.takeIf { seen }?.let {
        if (settings.useMiles) "${(it.speedKmh / 1.609344).roundToInt()} mph" else "${it.speedKmh.roundToInt()} km/h"
    }
    val gearCaption = s?.let { stringResource(gearText(it.gear)) }
    val phonesTitle = stringResource(R.string.nova_phones)
    val slotCaption = stringResource(R.string.nova_slot, phone.slot + 1)
    val dataTitle = stringResource(R.string.nova_data_month)
    val dataCaption = stringResource(R.string.nova_data_of)
    val v12Tile: @Composable (Modifier) -> Unit =
        { m -> Tile(v12Title, volts?.let { "%.1f V".format(it) }, m, caption = v12Caption, accent = voltsColor, captionColor = voltsColor) }
    val signalTile: @Composable (Modifier) -> Unit =
        { m -> Tile(signalTitle, signalValue, m, caption = if (rsrp == 0) null else "$rsrp dBm", accent = if (bars >= 3) Good else if (bars == 2) Warn else Dim) }
    TileGrid(2, if (light) listOf(
        v12Tile, signalTile,
        { m -> Tile(dataTitle, s?.takeIf { seen }?.let { "${it.dataKb} kB" }, m, caption = dataCaption, accent = Cyan) },
    ) else listOf(
        v12Tile, signalTile,
        { m -> Tile(speedTitle, speedValue, m, caption = gearCaption, accent = Violet) },
        { m -> Tile(phonesTitle, s?.takeIf { seen }?.let { "${it.phones} / 4" }, m, caption = slotCaption, accent = Cyan) },
    ))
    Spacer(Modifier.padding(top = 10.dp))
    Location(s)

    if (!light) RecentCommands(s)

    SectionTitle(stringResource(R.string.nova_this_nova))
    Card {
        KeyValue(stringResource(R.string.nova_device_id), phone.uid?.takeLast(8)?.uppercase())
        KeyValue(stringResource(R.string.nova_firmware), s?.firmware?.takeIf { it > 0 }?.toString())
        GhostButton(stringResource(R.string.nova_forget), onClick = { phone.forget(); paired = false; status = null; message = null },
            modifier = Modifier.padding(top = 8.dp), color = Dim)
    }
}

@Composable
private fun RecentCommands(s: NovaPhone.Status?) {
    SectionTitle(stringResource(R.string.nova_recent))
    Card {
        val cmds = s?.commands.orEmpty().take(5)
        if (cmds.isEmpty()) Text(stringResource(R.string.nova_nothing_sent), color = Dim, fontSize = 14.sp)
        cmds.forEachIndexed { i, c ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(symbol(c.action), fontSize = 18.sp, modifier = Modifier.width(32.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(actionName(c.action)), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text(relative(c.sent), color = Dim, fontSize = 12.sp)
                }
                ResultPill(c)
            }
            if (i < cmds.size - 1) HorizontalDivider(color = CardEdge)
        }
    }
}

/** Where the car is in words, with a pill for whether it's reachable right now. */
@Composable
private fun Hero(s: NovaPhone.Status?) {
    val online = s?.online() ?: false
    Card(glow = if (online) Aqua else null) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.nova_your_ocean), color = Dim, fontSize = 13.sp)
                Text(stringResource(headline(s)), color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(vertical = 4.dp))
                when {
                    s == null -> Unit
                    s.lastSeen > 0 -> Text(
                        stringResource(if (online) R.string.nova_checked_in else R.string.nova_seen, relative(s.lastSeen)),
                        color = Dim, fontSize = 13.sp,
                    )
                    else -> Text(stringResource(R.string.nova_not_checked_in), color = Dim, fontSize = 13.sp)
                }
            }
            if (s == null) CircularProgressIndicator(Modifier.size(20.dp), color = Aqua, strokeWidth = 2.dp)
            else Pill(stringResource(if (online) R.string.nova_online else R.string.nova_offline), if (online) Good else Dim, pulse = online)
        }
        Text("🚙", fontSize = 48.sp, modifier = Modifier.align(Alignment.End))
    }
}

private fun headline(s: NovaPhone.Status?): Int = when {
    s == null -> R.string.nova_checking
    s.lastSeen <= 0 -> R.string.nova_not_connected
    // the Light knows awake or asleep from the 12 V, not the gear
    s.isLight -> when (s.lightState) { 2 -> R.string.nova_on; 3 -> R.string.nova_saving_12v; else -> R.string.nova_off }
    s.gear == 4 || s.gear == 2 || s.speedKmh > 1 -> R.string.nova_driving
    s.gear == 1 -> if (s.ignition) R.string.nova_parked_on else R.string.nova_parked
    else -> if (s.ignition) R.string.nova_on else R.string.nova_off
}

private fun gearText(g: Int): Int = when (g) {
    1 -> R.string.nova_gear_p
    2 -> R.string.nova_gear_r
    3 -> R.string.nova_gear_n
    4 -> R.string.nova_gear_d
    else -> R.string.nova_gear_unknown
}

private fun actionName(a: Int): Int = when (a) {
    NovaCommands.LOCK -> R.string.nova_lock
    NovaCommands.UNLOCK -> R.string.nova_unlock
    NovaCommands.CLIMATE_ON -> R.string.nova_climate_on
    NovaCommands.CLIMATE_OFF -> R.string.nova_climate_off
    NovaCommands.LIGHTS -> R.string.nova_flash_lights
    else -> R.string.nova_cmd_other
}

private fun symbol(a: Int): String = when (a) {
    NovaCommands.LOCK -> "🔒"
    NovaCommands.UNLOCK -> "🔓"
    NovaCommands.CLIMATE_ON -> "❄"
    NovaCommands.CLIMATE_OFF -> "⏻"
    NovaCommands.LIGHTS -> "💡"
    else -> "➤"
}

private fun relative(ms: Long): String =
    DateUtils.getRelativeTimeSpanString(ms, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()

@Composable
private fun ResultPill(c: NovaPhone.Status.Command) {
    when (val r = c.result) {
        null -> if (System.currentTimeMillis() - c.sent > NovaCommands.LIFE_S * 1000) {
            Pill(stringResource(R.string.nova_cmd_expired), Dim)
        } else {
            Pill(stringResource(R.string.nova_cmd_waiting), Warn, pulse = true)
        }
        0 -> Pill(stringResource(R.string.nova_cmd_done), Good)
        else -> Pill(stringResource(when (r) {
            1 -> R.string.nova_cmd_not_parked
            2 -> R.string.nova_cmd_v12
            3 -> R.string.nova_cmd_setup
            else -> R.string.nova_cmd_refused
        }), Bad)
    }
}

@Composable
private fun Location(s: NovaPhone.Status?) {
    val context = LocalContext.current
    val title = stringResource(R.string.nova_your_ocean)
    Card {
        Text(stringResource(R.string.nova_location), color = Dim, fontSize = 12.sp)
        val lat = s?.lat
        val lon = s?.lon
        if (lat != null && lon != null) {
            Text("%.5f, %.5f".format(lat, lon), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 6.dp))
            GhostButton(stringResource(R.string.nova_open_maps), onClick = {
                val uri = Uri.parse("geo:$lat,$lon?q=$lat,$lon(${Uri.encode(title)})")
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            }, modifier = Modifier.padding(top = 10.dp))
        } else {
            Text(stringResource(if (s?.isLight == true) R.string.nova_light_no_gps else R.string.nova_no_gps), color = Color.White, fontSize = 14.sp,
                modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** A big button for one remote command. */
@Composable
private fun Control(
    modifier: Modifier, icon: String, title: String, sending: Int?, action: Int, onSend: (Int) -> Unit, wide: Boolean = false,
) {
    val shape = RoundedCornerShape(18.dp)
    val base = modifier.clip(shape).background(CardBg).border(1.dp, CardEdge, shape)
        .clickable(enabled = sending == null, role = Role.Button) { onSend(action) }
    if (wide) {
        Row(base.heightIn(min = 56.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(icon, fontSize = 20.sp)
            Spacer(Modifier.width(12.dp))
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (sending == action) CircularProgressIndicator(Modifier.size(18.dp), color = Aqua, strokeWidth = 2.dp)
        }
    } else {
        Column(base.heightIn(min = 96.dp).padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(icon, fontSize = 24.sp, modifier = Modifier.weight(1f))
                if (sending == action) CircularProgressIndicator(Modifier.size(18.dp), color = Aqua, strokeWidth = 2.dp)
            }
            Box(Modifier.padding(top = 10.dp)) {
                Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
