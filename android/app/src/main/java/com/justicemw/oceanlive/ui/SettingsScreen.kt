package com.justicemw.oceanlive.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.car.CarModel
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.V12Watch
import kotlin.math.roundToInt

@Composable
fun SettingsScreen(
    s: Settings,
    update: ((Settings) -> Settings) -> Unit,
    onForget: () -> Unit,
    onNeedNotifications: () -> Unit,
    onNeedLocation: () -> Unit,
    onSupport: () -> Unit,
) {
    if (com.justicemw.oceanlive.car.Accounts.required) AccountSection()
    SupportRow(onSupport)
    SectionTitle(stringResource(R.string.settings_car))
    Card {
        CarModel.entries.forEach { m ->
            Choice(stringResource(m.label) + if (m.usableKwh > 0) " · ${m.usableKwh} kWh" else "", s.model == m) { update { it.copy(model = m) } }
        }
        if (s.model == CarModel.Custom) {
            var text by remember { mutableStateOf(s.customKwh.toString()) }
            Field(stringResource(R.string.settings_usable_kwh), text, KeyboardType.Decimal) {
                text = it
                it.toDoubleOrNull()?.takeIf { v -> v in 20.0..200.0 }?.let { v -> update { st -> st.copy(customKwh = v) } }
            }
        }
        Text(stringResource(R.string.settings_car_note),
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }

    SectionTitle(stringResource(R.string.settings_charging_cost))
    Card {
        var currency by remember { mutableStateOf(s.currency) }
        Field(stringResource(R.string.settings_currency), currency) {
            currency = it
            if (it.length <= 4) update { st -> st.copy(currency = it.trim()) }
        }
        PriceField(stringResource(R.string.settings_home_price), s.homePrice) { v -> update { it.copy(homePrice = v) } }
        PriceField(stringResource(R.string.settings_dc_price), s.dcPrice) { v -> update { it.copy(dcPrice = v) } }
        Text(stringResource(R.string.settings_cost_note),
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }

    SectionTitle(stringResource(R.string.settings_units))
    Card {
        Toggle(stringResource(R.string.settings_miles), s.useMiles) { v -> update { it.copy(useMiles = v) } }
        Toggle(stringResource(R.string.settings_fahrenheit), s.useFahrenheit) { v -> update { it.copy(useFahrenheit = v) } }
        Toggle(stringResource(R.string.settings_screen_on), s.keepScreenOn) { v -> update { it.copy(keepScreenOn = v) } }
    }

    SectionTitle(stringResource(R.string.settings_adapter))
    Card {
        Toggle(stringResource(R.string.settings_auto_connect), s.autoStart) { v -> update { it.copy(autoStart = v) } }
        Text(s.adapterName?.let { stringResource(R.string.settings_saved_adapter, it) } ?: stringResource(R.string.settings_no_adapter), color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        if (s.adapterAddress != null) TextButton(onClick = onForget) { Text(stringResource(R.string.settings_forget_adapter), color = Bad) }
    }

    SectionTitle(stringResource(R.string.v12_battery))
    Card {
        Toggle(stringResource(R.string.settings_watch_12v), s.watch12v) { v ->
            if (v) onNeedNotifications()
            update { it.copy(watch12v = v) }
        }
        Text(stringResource(R.string.settings_watch_quick_note), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        if (s.watch12v) {
            Text(stringResource(R.string.settings_check_every), color = Color.White, fontSize = 15.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
            Chips(V12Watch.INTERVALS.map { "$it min" }, V12Watch.INTERVALS.indexOf(s.watchEveryMin).coerceAtLeast(0)) { i ->
                update { it.copy(watchEveryMin = V12Watch.INTERVALS[i]) }
            }
            Text(stringResource(R.string.settings_check_note), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            Text(stringResource(R.string.settings_watch_warn_note),
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            Toggle(stringResource(R.string.settings_watch_keep), s.watchKeepConnected) { v -> update { it.copy(watchKeepConnected = v) } }
            Text(stringResource(R.string.settings_watch_keep_note), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }

    SectionTitle(stringResource(R.string.settings_alerts))
    Card {
        Toggle(stringResource(R.string.settings_charge_alerts), s.alertsOn) { v ->
            if (v) onNeedNotifications()
            update { it.copy(alertsOn = v) }
        }
        if (s.alertsOn) {
            Percent(stringResource(R.string.settings_notify_high), s.alertHigh, 50..100) { v -> update { it.copy(alertHigh = v) } }
            Percent(stringResource(R.string.settings_notify_low), s.alertLow, 5..50) { v -> update { it.copy(alertLow = v) } }
            Toggle(stringResource(R.string.settings_notify_stop), s.alertStop) { v -> update { it.copy(alertStop = v) } }
        }
        Toggle(stringResource(R.string.settings_battery_warnings), s.healthAlerts) { v ->
            if (v) onNeedNotifications()
            update { it.copy(healthAlerts = v) }
        }
        Text(stringResource(R.string.settings_alerts_note), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }

    SectionTitle(stringResource(R.string.abrp))
    Card {
        Field(stringResource(R.string.settings_abrp_token), s.abrpToken, secret = true) { v -> update { it.copy(abrpToken = v) } }
        Field(stringResource(R.string.settings_abrp_key), s.abrpKey, secret = true) { v -> update { it.copy(abrpKey = v) } }
        if (s.abrpToken.isNotBlank() != s.abrpKey.isNotBlank()) {
            Text(stringResource(R.string.settings_abrp_both), color = Warn, fontSize = 12.sp)
        }
        Percent(stringResource(R.string.settings_abrp_every), s.abrpEverySec, 5..60, suffix = " " + stringResource(R.string.unit_seconds)) { v -> update { it.copy(abrpEverySec = v) } }
        Toggle(stringResource(R.string.settings_abrp_location), s.abrpLocation) { v ->
            if (v) onNeedLocation()
            update { it.copy(abrpLocation = v) }
        }
        Text(stringResource(R.string.settings_abrp_note),
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }

    SectionTitle(stringResource(R.string.settings_advanced))
    Card {
        Toggle(stringResource(R.string.settings_flip_current), s.flipCurrent) { v -> update { it.copy(flipCurrent = v) } }
        Text(stringResource(R.string.settings_flip_note), color = Dim, fontSize = 12.sp)
    }

    Spacer(Modifier.height(18.dp))
    Text(stringResource(R.string.settings_about, "3.4"), color = Dim, fontSize = 12.sp)
}

@Composable
private fun PriceField(label: String, value: Double, onChange: (Double) -> Unit) {
    var text by remember { mutableStateOf(if (value > 0) value.toString() else "") }
    Field(label, text, KeyboardType.Decimal) {
        text = it
        val v = if (it.isBlank()) 0.0 else it.replace(',', '.').toDoubleOrNull()
        v?.takeIf { p -> p in 0.0..100.0 }?.let(onChange)
    }
}

@Composable
private fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!value) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Color.White, modifier = Modifier.weight(1f), fontSize = 15.sp)
        Switch(
            checked = value, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = Aqua, checkedThumbColor = Color(0xFF04121C), uncheckedTrackColor = Bg, uncheckedBorderColor = CardEdge),
        )
    }
}

@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(12.dp))
            .background(if (selected) Aqua.copy(alpha = 0.12f) else Color.Transparent)
            .border(1.dp, if (selected) Aqua.copy(alpha = 0.6f) else CardEdge, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick).padding(12.dp),
    ) { Text(label, color = if (selected) Aqua else Color.White, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal) }
}

@Composable
private fun Percent(label: String, value: Int, range: IntRange, suffix: String = "%", onChange: (Int) -> Unit) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Row {
            Text(label, color = Color.White, modifier = Modifier.weight(1f), fontSize = 15.sp)
            Text("$value$suffix", color = Aqua, fontWeight = FontWeight.SemiBold)
        }
        Slider(
            value = value.toFloat(), onValueChange = { onChange(it.roundToInt()) },
            valueRange = range.first.toFloat()..range.last.toFloat(),
            colors = SliderDefaults.colors(thumbColor = Aqua, activeTrackColor = Aqua, inactiveTrackColor = Bg),
        )
    }
}

@Composable
private fun Field(label: String, value: String, keyboard: KeyboardType = KeyboardType.Text, secret: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Aqua, unfocusedBorderColor = CardEdge, focusedLabelColor = Aqua, unfocusedLabelColor = Dim,
            focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Aqua,
        ),
    )
}
