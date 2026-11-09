package com.justicemw.oceanlive

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import java.util.Locale

private val Aqua = Color(0xFF4FD1C5)
private val Card = Color(0xFF14202B)
private val Dim = Color(0xFF8A9BA8)

class MainActivity : ComponentActivity() {
    private lateinit var monitor: Monitor

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        monitor = Monitor(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Aqua, background = Color(0xFF0B1218))) {
                Screen(monitor, ::hasPermissions, ::keepScreenOn)
            }
        }
    }

    override fun onDestroy() {
        monitor.close()
        super.onDestroy()
    }

    private fun hasPermissions(): Boolean = requiredPermissions().all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}

fun requiredPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= 31) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

@Composable
private fun Screen(monitor: Monitor, hasPermissions: () -> Boolean, keepScreenOn: (Boolean) -> Unit) {
    val pending = remember { arrayOfNulls<() -> Unit>(1) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.all { it }) pending[0]?.invoke()
    }
    fun withPermissions(action: () -> Unit) {
        if (hasPermissions()) action() else {
            pending[0] = action
            launcher.launch(requiredPermissions())
        }
    }

    val live = monitor.status == Status.Live
    DisposableEffect(live) {
        keepScreenOn(live)
        onDispose { }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .padding(20.dp),
    ) {
        Text("Ocean Live", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Text("Bluetooth only · no account · v3.0", color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(20.dp))

        when (monitor.status) {
            Status.Live -> LiveView(monitor)
            Status.Connecting -> Centered {
                CircularProgressIndicator(color = Aqua)
                Spacer(Modifier.height(12.dp))
                Text("Connecting to adapter…", color = Dim)
            }
            Status.Scanning -> ScanView(monitor) { address, name -> withPermissions { monitor.connect(address, name) } }
            Status.Idle, Status.Error -> StartView(
                monitor,
                onScan = { withPermissions { monitor.scan() } },
                onReconnect = { withPermissions { monitor.connect(monitor.savedAddress!!, monitor.savedName ?: "Adapter") } },
            )
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

@Composable
private fun StartView(monitor: Monitor, onScan: () -> Unit, onReconnect: () -> Unit) {
    Text(
        "Plug a Bluetooth LE OBD adapter into the car, turn the car on, then connect.",
        color = Dim,
    )
    if (!monitor.bluetoothOn) {
        Spacer(Modifier.height(12.dp))
        Text("Bluetooth is off. Turn it on in your phone's settings.", color = Color(0xFFFFB74D))
    }
    monitor.message?.let {
        Spacer(Modifier.height(12.dp))
        Text(it, color = Color(0xFFFF8A80))
    }
    Spacer(Modifier.height(20.dp))
    val saved = monitor.savedAddress
    if (saved != null) {
        Button(onClick = onReconnect, modifier = Modifier.fillMaxWidth()) {
            Text("Connect to ${monitor.savedName ?: saved}")
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("Choose a different adapter") }
        TextButton(onClick = { monitor.forgetAdapter() }) { Text("Forget saved adapter", color = Dim) }
    } else {
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("Find adapter") }
    }
}

@Composable
private fun ScanView(monitor: Monitor, onPick: (String, String) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(color = Aqua, modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.padding(start = 10.dp))
        Text("Looking for adapters…", color = Dim, modifier = Modifier.weight(1f))
        TextButton(onClick = { monitor.disconnect() }) { Text("Cancel") }
    }
    Spacer(Modifier.height(12.dp))
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(monitor.found, key = { it.address }) { adapter ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Card, RoundedCornerShape(12.dp))
                    .clickable { onPick(adapter.address, adapter.name) }
                    .padding(14.dp),
            ) {
                Text(adapter.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                Text("${adapter.address} · ${adapter.rssi} dBm", color = Dim, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun LiveView(monitor: Monitor) {
    val v = monitor.values
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("State of charge", color = Dim)
        Text(
            v["soc"]?.let { fmt(it, 1) + "%" } ?: "—",
            color = Aqua,
            fontSize = 56.sp,
            fontWeight = FontWeight.Bold,
        )
    }
    Spacer(Modifier.height(16.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile("Pack voltage", v["voltage"]?.let { fmt(it, 1) + " V" }, Modifier.weight(1f))
        Tile("Current", v["current"]?.let { fmt(it, 1) + " A" }, Modifier.weight(1f))
    }
    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile("Power", v["power"]?.let { fmt(it, 1) + " kW" }, Modifier.weight(1f))
        Tile(
            "Battery temp",
            v["batt_temp"]?.let { fmt(it, 0) + " °C / " + fmt(it * 9 / 5 + 32, 0) + " °F" },
            Modifier.weight(1f),
        )
    }
    Spacer(Modifier.height(10.dp))
    val cellMax = v["cell_max"]
    val cellMin = v["cell_min"]
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile(
            "Cells min / max",
            if (cellMin != null && cellMax != null) "${fmt(cellMin, 0)} / ${fmt(cellMax, 0)} mV" else null,
            Modifier.weight(1f),
            caption = if (cellMin != null && cellMax != null) "Spread ${fmt(cellMax - cellMin, 0)} mV" else null,
        )
        Tile(
            "12V battery",
            v["aux_voltage"]?.let { fmt(it, 2) + " V" },
            Modifier.weight(1f),
            caption = v["aux_voltage"]?.let { auxStatus(it) + (monitor.auxSource?.let { s -> " · $s" } ?: "") },
        )
    }
    Spacer(Modifier.height(16.dp))
    Text(
        monitor.lastUpdate?.let { "Updated " + java.text.DateFormat.getTimeInstance().format(it) } ?: "Waiting for data…",
        color = Dim,
        fontSize = 12.sp,
    )
    Spacer(Modifier.height(16.dp))
    OutlinedButton(onClick = { monitor.disconnect() }, modifier = Modifier.fillMaxWidth()) { Text("Disconnect") }
}

/** Rough reading of a 12V voltage. Above ~13.2 V the car's DC-DC converter is charging it. */
private fun auxStatus(volts: Double): String = when {
    volts >= 13.2 -> "Charging"
    volts >= 12.4 -> "Good"
    volts >= 12.0 -> "Low"
    else -> "Very low, charge soon"
}

@Composable
private fun Tile(label: String, value: String?, modifier: Modifier, caption: String? = null) {
    Column(modifier.background(Card, RoundedCornerShape(14.dp)).padding(14.dp)) {
        Text(label, color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(4.dp))
        Text(value ?: "—", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        if (caption != null) Text(caption, color = Dim, fontSize = 12.sp)
    }
}

private fun fmt(value: Double, decimals: Int) = String.format(Locale.US, "%.${decimals}f", value)
