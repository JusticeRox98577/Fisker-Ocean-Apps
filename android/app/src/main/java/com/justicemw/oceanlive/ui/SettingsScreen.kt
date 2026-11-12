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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
) {
    SectionTitle("Car")
    Card {
        CarModel.entries.forEach { m ->
            Choice(m.label + if (m.usableKwh > 0) " · ${m.usableKwh} kWh" else "", s.model == m) { update { it.copy(model = m) } }
        }
        if (s.model == CarModel.Custom) {
            var text by remember { mutableStateOf(s.customKwh.toString()) }
            Field("Usable battery in kWh", text, KeyboardType.Decimal) {
                text = it
                it.toDoubleOrNull()?.takeIf { v -> v in 20.0..200.0 }?.let { v -> update { st -> st.copy(customKwh = v) } }
            }
        }
        Text("Published usable capacity: 106.5 kWh for One, Extreme and Ultra, about 75 kWh for the Sport. Used for range and charge-time estimates.",
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }

    SectionTitle("Charging cost")
    Card {
        var currency by remember { mutableStateOf(s.currency) }
        Field("Currency symbol", currency) {
            currency = it
            if (it.length <= 4) update { st -> st.copy(currency = it.trim()) }
        }
        PriceField("Home price per kWh", s.homePrice) { v -> update { it.copy(homePrice = v) } }
        PriceField("DC fast price per kWh", s.dcPrice) { v -> update { it.copy(dcPrice = v) } }
        Text("Used to show what each charge costs in Trips. Leave a price empty to skip it.",
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }

    SectionTitle("Units and screen")
    Card {
        Toggle("Use miles", s.useMiles) { v -> update { it.copy(useMiles = v) } }
        Toggle("Use Fahrenheit", s.useFahrenheit) { v -> update { it.copy(useFahrenheit = v) } }
        Toggle("Keep the screen on while connected", s.keepScreenOn) { v -> update { it.copy(keepScreenOn = v) } }
    }

    SectionTitle("Adapter")
    Card {
        Toggle("Connect automatically when the app opens", s.autoStart) { v -> update { it.copy(autoStart = v) } }
        Text(s.adapterName?.let { "Saved adapter: $it" } ?: "No saved adapter yet.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        if (s.adapterAddress != null) TextButton(onClick = onForget) { Text("Forget saved adapter", color = Bad) }
    }

    SectionTitle("12V battery")
    Card {
        Toggle("Watch 12V while the car sleeps", s.watch12v) { v ->
            if (v) onNeedNotifications()
            update { it.copy(watch12v = v) }
        }
        Text(V12Watch.settingNote(s.watchEveryMin), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        if (s.watch12v) {
            Text("Check every", color = Color.White, fontSize = 15.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
            Chips(V12Watch.INTERVALS.map { "$it min" }, V12Watch.INTERVALS.indexOf(s.watchEveryMin).coerceAtLeast(0)) { i ->
                update { it.copy(watchEveryMin = V12Watch.INTERVALS[i]) }
            }
            Text("Shorter means more readings, but the adapter stays busier.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            Text("With Battery warnings on, you're told when the 12V drops under 12.2 V and again under 11.8 V.",
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }

    SectionTitle("Alerts")
    Card {
        Toggle("Charge alerts", s.alertsOn) { v ->
            if (v) onNeedNotifications()
            update { it.copy(alertsOn = v) }
        }
        if (s.alertsOn) {
            Percent("Notify when charging reaches", s.alertHigh, 50..100) { v -> update { it.copy(alertHigh = v) } }
            Percent("Notify when charge drops to", s.alertLow, 5..50) { v -> update { it.copy(alertLow = v) } }
            Toggle("Notify when charging stops", s.alertStop) { v -> update { it.copy(alertStop = v) } }
        }
        Toggle("Battery warnings (12V low, uneven cells, hot pack)", s.healthAlerts) { v ->
            if (v) onNeedNotifications()
            update { it.copy(healthAlerts = v) }
        }
        Text("Alerts work while the app is connected, including in the background.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }

    SectionTitle("ABRP")
    Card {
        Field("ABRP generic token", s.abrpToken, secret = true) { v -> update { it.copy(abrpToken = v) } }
        Field("Telemetry API key", s.abrpKey, secret = true) { v -> update { it.copy(abrpKey = v) } }
        if (s.abrpToken.isNotBlank() != s.abrpKey.isNotBlank()) {
            Text("Both the token and the API key are needed to send to ABRP.", color = Warn, fontSize = 12.sp)
        }
        Percent("Send every", s.abrpEverySec, 5..60, suffix = " sec") { v -> update { it.copy(abrpEverySec = v) } }
        Toggle("Include phone location", s.abrpLocation) { v ->
            if (v) onNeedLocation()
            update { it.copy(abrpLocation = v) }
        }
        Text("Leave both empty to keep everything on your phone. In ABRP open your car, choose Live data, then Generic to get the token. " +
            "The API key is a free telemetry key from abetterrouteplanner.com/resources/api. This is the only thing Ocean Live ever sends over the internet.",
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }

    SectionTitle("Advanced")
    Card {
        Toggle("Flip current sign", s.flipCurrent) { v -> update { it.copy(flipCurrent = v) } }
        Text("Turn on only if charging shows as using power on your car.", color = Dim, fontSize = 12.sp)
    }

    Spacer(Modifier.height(18.dp))
    Text("Ocean Live 3.2 · unofficial community app. It only reads from the car, except when you clear fault codes or restart a module from the Faults tab.", color = Dim, fontSize = 12.sp)
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
