package com.justice.oceanlive

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                App()
            }
        }
    }
}

private val CardColor = Color.White.copy(alpha = 0.07f)
private val Blue = Color(0xFF1A8CF2)
private val Cyan = Color(0xFF4CC3E6)
private val Muted = Color(0xFF9AA8B8)

private fun requiredPermissions(): Array<String> {
    val l = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= 31) {
        l.add(Manifest.permission.BLUETOOTH_SCAN)
        l.add(Manifest.permission.BLUETOOTH_CONNECT)
    }
    l.add(Manifest.permission.ACCESS_FINE_LOCATION)
    l.add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= 33) l.add(Manifest.permission.POST_NOTIFICATIONS)
    return l.toTypedArray()
}

private fun f(v: Double?, digits: Int): String =
    if (v == null) "--" else String.format(Locale.US, "%.${digits}f", v)

// Reply address and best scan range for the modules we know about
private fun scanDefaults(header: String): List<String>? = when (header) {
    "7E1" -> listOf("7E9", "2000", "21FF")
    "7F0" -> listOf("7F8", "0000", "0FFF")
    "752" -> listOf("75A", "0000", "0FFF")
    "7D5" -> listOf("7DD", "0000", "0FFF")
    "7A2" -> listOf("7AA", "F100", "FFFF")
    else -> null
}

/** Maps the plain English status Engine produces to the person's language. */
@Composable
private fun statusText(raw: String): String = when {
    raw == "Not connected" -> stringResource(R.string.st_not_connected)
    raw == "Turn on Bluetooth" -> stringResource(R.string.st_turn_on_bt)
    raw == "Looking for your adapter" -> stringResource(R.string.st_looking)
    raw == "Allow Bluetooth in Settings" -> stringResource(R.string.st_allow_bt)
    raw == "Connecting" -> stringResource(R.string.st_connecting)
    raw == "Could not connect" -> stringResource(R.string.st_could_not_connect)
    raw == "Setting up" -> stringResource(R.string.st_setting_up)
    raw == "Reconnecting" -> stringResource(R.string.st_reconnecting)
    raw == "Disconnected" -> stringResource(R.string.st_disconnected)
    raw == "Adapter not supported" -> stringResource(R.string.st_not_supported)
    raw == "Sending data" -> stringResource(R.string.st_sending)
    raw == "Match to car screen to set charge" -> stringResource(R.string.st_match_hint)
    raw == "Allow Bluetooth and Location in Settings" -> stringResource(R.string.st_allow_perms)
    raw.startsWith("Connected to ") -> stringResource(R.string.st_connected_to, raw.removePrefix("Connected to "))
    else -> raw
}

@Composable
private fun abrpText(raw: String): String = when {
    raw == "Waiting" -> stringResource(R.string.ab_waiting)
    raw == "ABRP is off. Add the API key and token in Settings to send" -> stringResource(R.string.ab_off)
    raw == "Sending to ABRP" -> stringResource(R.string.ab_sending)
    raw == "No internet" -> stringResource(R.string.ab_no_internet)
    raw.startsWith("ABRP error ") -> stringResource(R.string.ab_error, raw.removePrefix("ABRP error "))
    else -> raw
}

@Composable
fun App() {
    val ctx = LocalContext.current
    val ui by Engine.ui.collectAsState()

    var apiKey by remember { mutableStateOf(Engine.getPref("apiKey", "")) }
    var token by remember { mutableStateOf(Engine.getPref("token", "")) }
    var fBearer by remember { mutableStateOf(Engine.getPref("fiskerBearer", "")) }
    var fEmail by remember { mutableStateOf(Engine.getPref("fiskerEmail", "")) }
    var fFleet by remember { mutableStateOf(Engine.getPref("fiskerFleet", "5")) }
    var fToken by remember { mutableStateOf(Engine.getPref("fiskerToken", "")) }
    var fVin by remember { mutableStateOf(Engine.getPref("fiskerVin", "")) }
    var interval by remember { mutableStateOf(Engine.getPref("interval", "5").toIntOrNull() ?: 5) }
    var model by remember { mutableStateOf(Engine.getPref("model", "big")) }
    var useKm by remember { mutableStateOf(Engine.getPref("useKm", "0") == "1") }
    var useF by remember { mutableStateOf(Engine.getPref("useF", "0") == "1") }
    var keepOn by remember { mutableStateOf(Engine.getPref("keepOn", "0") == "1") }
    var autoStart by remember { mutableStateOf(Engine.getPref("autoStart", "0") == "1") }
    var alertsOn by remember { mutableStateOf(Engine.getPref("alertsOn", "0") == "1") }
    var alertHighOn by remember { mutableStateOf(Engine.getPref("alertHighOn", "0") == "1") }
    var alertHighPct by remember { mutableStateOf(Engine.getPref("alertHighPct", "90").toIntOrNull() ?: 90) }
    var alertLowOn by remember { mutableStateOf(Engine.getPref("alertLowOn", "0") == "1") }
    var alertLowPct by remember { mutableStateOf(Engine.getPref("alertLowPct", "20").toIntOrNull() ?: 20) }
    var alertStopOn by remember { mutableStateOf(Engine.getPref("alertStopOn", "0") == "1") }
    var capText by remember { mutableStateOf(Engine.getPref("capacityKWh", "106.5")) }
    var testHeader by remember { mutableStateOf(Engine.getPref("testHeader", "")) }
    var testRx by remember { mutableStateOf(Engine.getPref("testRx", "")) }
    var testCmd by remember { mutableStateOf(Engine.getPref("testCmd", "")) }
    var testSession by remember { mutableStateOf(Engine.getPref("testSession", "0") == "1") }
    var scanHeader by remember { mutableStateOf("7E1") }
    var scanRx by remember { mutableStateOf("7E9") }
    var scanFrom by remember { mutableStateOf("2000") }
    var scanTo by remember { mutableStateOf("21FF") }
    var confirmTest by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showCloudImport by remember { mutableStateOf(false) }
    var cloudImportStatus by remember { mutableStateOf("") }
    var showSync by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var historyList by remember { mutableStateOf(listOf<HistoryEntry>()) }
    var pendingCsv by remember { mutableStateOf("") }
    var socText by remember { mutableStateOf("") }
    var startAfterSync by remember { mutableStateOf(false) }
    var afterPerms by remember { mutableStateOf<(() -> Unit)?>(null) }
    var autoStartTried by remember { mutableStateOf(false) }

    val capacity: Double = when (model) {
        "sport" -> 75.0
        "custom" -> capText.toDoubleOrNull() ?: 106.5
        else -> 106.5
    }
    val usable = ui.learnedCap ?: capacity
    val whPerMile: Double? = run {
        val miles = ui.tripMeters / 1609.34
        if (miles >= 0.5) ui.tripKWh * 1000 / miles else null
    }
    val rangeMiles: Double? = run {
        val w = whPerMile
        val s = ui.estSoc
        if (w != null && w > 50 && s != null) s / 100 * usable * 1000 / w else null
    }
    val tempC = ui.live["batt_temp"]
    val tempShown = if (useF) tempC?.let { it * 9 / 5 + 32 } else tempC

    fun startNow() {
        Engine.begin(apiKey, token, interval.toDouble(), capacity)
    }

    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        val ok = requiredPermissions().filter {
            it != Manifest.permission.POST_NOTIFICATIONS
        }.all { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
        if (ok) {
            afterPerms?.invoke()
        } else {
            Engine.notice("Allow Bluetooth and Location in Settings")
        }
        afterPerms = null
    }

    fun ensurePerms(then: () -> Unit) {
        val missing = requiredPermissions().filter {
            ContextCompat.checkSelfPermission(ctx, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            then()
        } else {
            afterPerms = then
            permLauncher.launch(requiredPermissions())
        }
    }

    fun toggle() {
        if (ui.active) {
            Engine.halt()
            return
        }
        // ABRP is optional. With no keys the app just shows the car's charge and data.
        ensurePerms {
            startNow()
        }
    }

    // Keep the screen on while this setting is turned on.
    val view = LocalView.current
    LaunchedEffect(keepOn) {
        view.keepScreenOn = keepOn
    }

    // Start on its own the first time the screen opens, if the person turned that on
    // and there is a saved adapter to connect to.
    LaunchedEffect(ui.hasSavedAdapter) {
        if (!autoStartTried && autoStart && ui.hasSavedAdapter && !ui.active) {
            autoStartTried = true
            ensurePerms { startNow() }
        }
    }

    val csvLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) {
            try {
                ctx.contentResolver.openOutputStream(uri)?.use { it.write(pendingCsv.toByteArray()) }
            } catch (e: Exception) {
            }
        }
    }

    val cfg = androidx.compose.ui.platform.LocalConfiguration.current
    val wide = cfg.screenWidthDp > cfg.screenHeightDp
    val ringSize = if (wide) 170.dp else 250.dp
    val ringBlock: @Composable () -> Unit = {
            // Charge ring
            val soc = ui.estSoc ?: 0.0
            val sweep by animateFloatAsState(targetValue = (soc / 100.0).toFloat(), label = "soc")
            val ringColor = if (soc < 15) Color(0xFFFF453A) else if (soc < 30) Color(0xFFFF9F0A) else Color(0xFF33D99A)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(ringSize), contentAlignment = Alignment.Center) {
                    Canvas(Modifier.size(ringSize)) {
                        val stroke = 20.dp.toPx()
                        val inset = stroke / 2
                        val sz = Size(size.width - stroke, size.height - stroke)
                        drawArc(
                            color = Color.White.copy(alpha = 0.08f), startAngle = 0f, sweepAngle = 360f,
                            useCenter = false, topLeft = Offset(inset, inset), size = sz, style = Stroke(stroke)
                        )
                        drawArc(
                            color = ringColor, startAngle = -90f, sweepAngle = sweep * 360f,
                            useCenter = false, topLeft = Offset(inset, inset), size = sz,
                            style = Stroke(stroke, cap = StrokeCap.Round)
                        )
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            if (ui.estSoc == null) "--" else f(soc, 0) + "%",
                            fontSize = if (wide) 44.sp else 64.sp, fontWeight = FontWeight.Bold, color = Color.White
                        )
                        Text(
                            if (ui.estSoc == null) stringResource(R.string.waiting_car)
                            else if (ui.charging) stringResource(R.string.charging)
                            else if (ui.socFromCar) stringResource(R.string.charge_from_car)
                            else stringResource(R.string.estimated_charge),
                            fontSize = 13.sp, color = if (ui.charging) Color(0xFFFFD60A) else Muted
                        )
                    }
                }
                if (!ui.socFromCar) {
                    TextButton(onClick = { showSync = true }) {
                        Text(stringResource(R.string.match_to_car), color = Cyan)
                    }
                }
            }

    }
    val adapterBlock: @Composable () -> Unit = {
            // Adapter picker
            if (ui.found.isNotEmpty() && !ui.connected) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.choose_adapter), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    ui.found.forEach { d ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(CardColor)
                                .clickable { Engine.connect(d.address) }
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(d.name, color = Color.White, modifier = Modifier.weight(1f))
                            Text(">", color = Muted)
                        }
                    }
                }
            }

    }
    val tilesBlock: @Composable () -> Unit = {
            // Stat tiles
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Tile(stringResource(R.string.power), f(ui.live["power"], 1), "kW", Modifier.weight(1f))
                    Tile(stringResource(R.string.battery_temp), f(tempShown, 0), if (useF) stringResource(R.string.unit_f) else stringResource(R.string.unit_c), Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Tile(stringResource(R.string.voltage), f(ui.live["voltage"], 0), "V", Modifier.weight(1f))
                    Tile(stringResource(R.string.current), f(ui.live["current"], 0), "A", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Tile(
                        stringResource(R.string.efficiency),
                        f(if (useKm) whPerMile?.div(1.609344) else whPerMile, 0),
                        if (useKm) stringResource(R.string.unit_wh_km) else stringResource(R.string.unit_wh_mi),
                        Modifier.weight(1f)
                    )
                    Tile(
                        stringResource(R.string.range_left),
                        f(if (useKm) rangeMiles?.times(1.609344) else rangeMiles, 0),
                        if (useKm) stringResource(R.string.unit_km) else stringResource(R.string.unit_mi),
                        Modifier.weight(1f)
                    )
                }
            }

    }
    val abrpBlock: @Composable () -> Unit = {
            // ABRP card
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(CardColor)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.sec_abrp), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    Text(abrpText(ui.abrpStatus), fontSize = 13.sp, color = Muted)
                }
                if (ui.lastSent > 0) {
                    Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ui.lastSent)), fontSize = 13.sp, color = Muted)
                }
            }

    }
    val startBlock: @Composable () -> Unit = {
            // Start and stop
            Button(
                onClick = { toggle() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (ui.active) Color(0xFFD9372E) else Blue,
                    contentColor = Color.White
                )
            ) {
                Text(if (ui.active) stringResource(R.string.stop) else stringResource(R.string.start), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF08172E), Color(0xFF050A17))))
            .systemBarsPadding()
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(if (wide) 12.dp else 20.dp)
        ) {
            // Header
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Ocean Live", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(
                                    if (ui.running) Color(0xFF34C759)
                                    else if (ui.connected) Color(0xFFFFD60A) else Color.Gray
                                )
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(statusText(ui.status), fontSize = 13.sp, color = Muted)
                    }
                }
                if (wide) {
                    Button(
                        onClick = { toggle() },
                        modifier = Modifier.height(44.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (ui.active) Color(0xFFD9372E) else Blue,
                            contentColor = Color.White
                        )
                    ) {
                        Text(if (ui.active) stringResource(R.string.stop) else stringResource(R.string.start), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                TextButton(onClick = { showSettings = true }) {
                    Text(stringResource(R.string.settings), color = Cyan)
                }
            }

            if (wide) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column(Modifier.weight(0.8f), verticalArrangement = Arrangement.spacedBy(12.dp)) { ringBlock() }
                    Column(Modifier.weight(1.2f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        adapterBlock()
                        tilesBlock()
                        abrpBlock()
                    }
                }
            } else {
                ringBlock()
                adapterBlock()
                tilesBlock()
                abrpBlock()
                startBlock()
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    // Match charge dialog
    if (showSync) {
        AlertDialog(
            onDismissRequest = {
                startAfterSync = false
                showSync = false
            },
            title = { Text(stringResource(R.string.match_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = socText,
                        onValueChange = { socText = it },
                        label = { Text(stringResource(R.string.match_label)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                    )
                    Text(
                        stringResource(R.string.match_body),
                        fontSize = 13.sp, color = Muted
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val v = socText.toDoubleOrNull()
                    if (v != null) {
                        Engine.sync(v)
                        showSync = false
                        if (startAfterSync) {
                            startAfterSync = false
                            startNow()
                        }
                    }
                }) { Text(stringResource(R.string.apply)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    startAfterSync = false
                    showSync = false
                }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }

    if (confirmTest) {
        AlertDialog(
            onDismissRequest = { confirmTest = false },
            title = { Text("Send this to your car?") },
            text = { Text("Header " + testHeader + ", command " + testCmd + (if (testSession) ", after opening an extended session" else "") + ". Make sure the car is parked and awake.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmTest = false
                    Engine.runTestCommand(testHeader, testRx, testCmd, testSession)
                }) { Text("Send", color = Color(0xFFFF6B6B)) }
            },
            dismissButton = { TextButton(onClick = { confirmTest = false }) { Text("Cancel") } }
        )
    }

    // Trips and charging history
    if (showHistory) {
        Dialog(
            onDismissRequest = { showHistory = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Surface(Modifier.fillMaxSize(), color = Color(0xFF0B1424)) {
                Column(
                    Modifier
                        .systemBarsPadding()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.history_title), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.weight(1f))
                        TextButton(onClick = { showHistory = false }) { Text(stringResource(R.string.done), color = Cyan) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = {
                            pendingCsv = History.toCsv(historyList)
                            csvLauncher.launch("ocean_live_history.csv")
                        }) { Text(stringResource(R.string.history_export)) }
                        OutlinedButton(onClick = {
                            History.clear()
                            historyList = emptyList()
                        }) { Text(stringResource(R.string.history_clear)) }
                    }
                    if (historyList.isEmpty()) {
                        Text(stringResource(R.string.history_empty), fontSize = 13.sp, color = Muted)
                    } else {
                        val fmt = remember { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT) }
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            historyList.forEach { e ->
                                val miles = e.distanceMeters / 1609.34
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(CardColor)
                                        .padding(12.dp)
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            (if (e.kind == "charge") stringResource(R.string.history_charge) else stringResource(R.string.history_drive)) +
                                                "  " + fmt.format(Date(e.startTime)),
                                            color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold
                                        )
                                        val detail = if (e.kind == "charge") {
                                            f(e.startSoc, 0) + "% → " + f(e.endSoc, 0) + "%, " + f(e.kWh, 1) + " kWh"
                                        } else {
                                            f(e.startSoc, 0) + "% → " + f(e.endSoc, 0) + "%, " + f(miles, 1) + " mi, " + f(e.kWh, 1) + " kWh"
                                        }
                                        Text(detail, color = Muted, fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCloudImport) {
        CloudImportDialog(onDismiss = { showCloudImport = false }) { credentials ->
            Engine.saveCloudCredentials(credentials)
            fBearer = credentials.bearer
            fEmail = credentials.email
            fFleet = credentials.fleet
            fToken = credentials.token
            fVin = credentials.vin
            cloudImportStatus = "All five fields imported and saved."
            showCloudImport = false
        }
    }

    // Settings
    if (showSettings && !showCloudImport) {
        Dialog(
            onDismissRequest = { showSettings = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Surface(Modifier.fillMaxSize(), color = Color(0xFF0B1424)) {
                Column(
                    Modifier
                        .systemBarsPadding()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.settings), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.weight(1f))
                        TextButton(onClick = { showSettings = false }) { Text(stringResource(R.string.done), color = Cyan) }
                    }

                    SectionTitle(stringResource(R.string.sec_abrp))
                    OutlinedTextField(
                        value = apiKey,
                        onValueChange = { apiKey = it; Engine.setPref("apiKey", it) },
                        label = { Text(stringResource(R.string.api_key)) },
                        isError = apiKey.isBlank() && token.isNotBlank(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = token,
                        onValueChange = { token = it; Engine.setPref("token", it) },
                        label = { Text(stringResource(R.string.generic_token)) },
                        isError = token.isBlank() && apiKey.isNotBlank(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.send_every, interval), color = Color.White, modifier = Modifier.weight(1f))
                        OutlinedButton(onClick = {
                            interval = (interval - 1).coerceAtLeast(1)
                            Engine.setPref("interval", interval.toString())
                        }) { Text("-") }
                        Spacer(Modifier.width(8.dp))
                        OutlinedButton(onClick = {
                            interval = (interval + 1).coerceAtMost(60)
                            Engine.setPref("interval", interval.toString())
                        }) { Text("+") }
                    }
                    if (apiKey.isBlank() != token.isBlank()) {
                        Text(
                            stringResource(R.string.abrp_both_needed),
                            fontSize = 13.sp, color = Color(0xFFFF6B6B)
                        )
                    }
                    Text(
                        stringResource(R.string.abrp_help),
                        fontSize = 13.sp, color = Muted
                    )

                    SectionTitle("Car data online")
                    OutlinedButton(onClick = { showCloudImport = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("Phone capture setup / import credentials")
                    }
                    if (cloudImportStatus.isNotBlank()) Text(cloudImportStatus, color = Cyan)
                    OutlinedTextField(
                        value = fBearer,
                        onValueChange = { fBearer = it; Engine.setPref("fiskerBearer", it) },
                        label = { Text("SDK bearer") },
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = fEmail,
                        onValueChange = { fEmail = it; Engine.setPref("fiskerEmail", it) },
                        label = { Text("Account email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = fFleet,
                        onValueChange = { fFleet = it; Engine.setPref("fiskerFleet", it) },
                        label = { Text("Fleet ID") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = fToken,
                        onValueChange = { fToken = it; Engine.setPref("fiskerToken", it) },
                        label = { Text("Login token") },
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = fVin,
                        onValueChange = { fVin = it.uppercase(); Engine.setPref("fiskerVin", fVin) },
                        label = { Text("VIN") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(
                        "When the adapter is not connected, pressing Start reads your charge and location from the online car service instead. Fill in all five fields to turn it on. It checks about every 15 seconds. The adapter takes over by itself once it connects.",
                        fontSize = 13.sp, color = Muted
                    )

                    SectionTitle(stringResource(R.string.sec_car))
                    ModelRow(stringResource(R.string.model_big), model == "big") {
                        model = "big"; Engine.setPref("model", "big")
                    }
                    ModelRow(stringResource(R.string.model_sport), model == "sport") {
                        model = "sport"; Engine.setPref("model", "sport")
                    }
                    ModelRow(stringResource(R.string.model_custom), model == "custom") {
                        model = "custom"; Engine.setPref("model", "custom")
                    }
                    if (model == "custom") {
                        OutlinedTextField(
                            value = capText,
                            onValueChange = { capText = it; Engine.setPref("capacityKWh", it) },
                            label = { Text(stringResource(R.string.usable_kwh_label)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.fillMaxWidth()
                        )
                    } else {
                        Text(stringResource(R.string.usable_battery, f(capacity, 1)), color = Color.White)
                    }
                    Text(
                        stringResource(R.string.battery_note),
                        fontSize = 13.sp, color = Muted
                    )
                    if (ui.learnedCap != null) {
                        Text(stringResource(R.string.learned_battery, f(ui.learnedCap, 1)), color = Color.White)
                        OutlinedButton(onClick = { Engine.resetLearning() }) { Text(stringResource(R.string.reset_learning)) }
                    }

                    SectionTitle(stringResource(R.string.sec_units))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.use_km), color = Color.White, modifier = Modifier.weight(1f))
                        Switch(checked = useKm, onCheckedChange = { useKm = it; Engine.setPref("useKm", if (it) "1" else "0") })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.use_f), color = Color.White, modifier = Modifier.weight(1f))
                        Switch(checked = useF, onCheckedChange = { useF = it; Engine.setPref("useF", if (it) "1" else "0") })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.keep_screen_on), color = Color.White, modifier = Modifier.weight(1f))
                        Switch(checked = keepOn, onCheckedChange = { keepOn = it; Engine.setPref("keepOn", if (it) "1" else "0") })
                    }

                    SectionTitle(stringResource(R.string.sec_alerts))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.alerts_on), color = Color.White, modifier = Modifier.weight(1f))
                        Switch(checked = alertsOn, onCheckedChange = { alertsOn = it; Engine.setPref("alertsOn", if (it) "1" else "0") })
                    }
                    if (alertsOn) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.alert_high_label, alertHighPct), color = Color.White, modifier = Modifier.weight(1f))
                            Switch(checked = alertHighOn, onCheckedChange = { alertHighOn = it; Engine.setPref("alertHighOn", if (it) "1" else "0") })
                        }
                        if (alertHighOn) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { alertHighPct = (alertHighPct - 5).coerceAtLeast(10); Engine.setPref("alertHighPct", alertHighPct.toString()) }) { Text("-") }
                                OutlinedButton(onClick = { alertHighPct = (alertHighPct + 5).coerceAtMost(100); Engine.setPref("alertHighPct", alertHighPct.toString()) }) { Text("+") }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.alert_low_label, alertLowPct), color = Color.White, modifier = Modifier.weight(1f))
                            Switch(checked = alertLowOn, onCheckedChange = { alertLowOn = it; Engine.setPref("alertLowOn", if (it) "1" else "0") })
                        }
                        if (alertLowOn) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { alertLowPct = (alertLowPct - 5).coerceAtLeast(0); Engine.setPref("alertLowPct", alertLowPct.toString()) }) { Text("-") }
                                OutlinedButton(onClick = { alertLowPct = (alertLowPct + 5).coerceAtMost(90); Engine.setPref("alertLowPct", alertLowPct.toString()) }) { Text("+") }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.alert_stop_label), color = Color.White, modifier = Modifier.weight(1f))
                            Switch(checked = alertStopOn, onCheckedChange = { alertStopOn = it; Engine.setPref("alertStopOn", if (it) "1" else "0") })
                        }
                        Text(stringResource(R.string.alerts_note), fontSize = 13.sp, color = Muted)
                    }

                    SectionTitle(stringResource(R.string.sec_auto))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.auto_start), color = Color.White, modifier = Modifier.weight(1f))
                        Switch(checked = autoStart, onCheckedChange = { autoStart = it; Engine.setPref("autoStart", if (it) "1" else "0") })
                    }
                    Text(stringResource(R.string.auto_note), fontSize = 13.sp, color = Muted)

                    SectionTitle(stringResource(R.string.sec_history))
                    OutlinedButton(onClick = {
                        historyList = History.all()
                        showHistory = true
                    }) { Text(stringResource(R.string.history_open)) }

                    SectionTitle(stringResource(R.string.sec_adapter))
                    Text(statusText(ui.status), color = Color.White)
                    if (ui.hasSavedAdapter) {
                        OutlinedButton(onClick = { Engine.forgetAdapter() }) { Text(stringResource(R.string.forget_adapter)) }
                    } else {
                        OutlinedButton(onClick = { ensurePerms { Engine.connectAdapter() } }) { Text(stringResource(R.string.look_adapters)) }
                    }

                    if (BuildConfig.DEBUG) {
                    SectionTitle("Read only scan")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { scanHeader = "7E1"; scanRx = "7E9"; scanFrom = "2000"; scanTo = "21FF" }) { Text("Battery") }
                        OutlinedButton(onClick = { scanHeader = "7F0"; scanRx = "7F8"; scanFrom = "0000"; scanTo = "0FFF" }) { Text("Climate") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { scanHeader = "752"; scanRx = "75A"; scanFrom = "0000"; scanTo = "0FFF" }) { Text("Heater 752") }
                        OutlinedButton(onClick = { scanHeader = "7A2"; scanRx = "7AA"; scanFrom = "F100"; scanTo = "FFFF" }) { Text("Key") }
                        OutlinedButton(onClick = { scanHeader = "7D5"; scanRx = "7DD"; scanFrom = "0000"; scanTo = "0FFF" }) { Text("Heater 7D5") }
                    }
                    OutlinedTextField(value = scanHeader, onValueChange = { scanHeader = it.uppercase(); scanDefaults(scanHeader)?.let { d -> scanRx = d[0]; scanFrom = d[1]; scanTo = d[2] } }, label = { Text("Header") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = scanRx, onValueChange = { scanRx = it.uppercase() }, label = { Text("Reply address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = scanFrom, onValueChange = { scanFrom = it.uppercase() }, label = { Text("First identifier") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = scanTo, onValueChange = { scanTo = it.uppercase() }, label = { Text("Last identifier") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (ui.scanning) {
                        OutlinedButton(onClick = { Engine.stopDidScan() }) { Text("Stop scan") }
                    } else {
                        OutlinedButton(onClick = { Engine.startDidScan(scanHeader, scanRx, scanFrom, scanTo) }) { Text("Start scan") }
                        OutlinedButton(onClick = { Engine.startAutoProbe(scanHeader, scanRx) }) { Text("Auto probe 1000 to 4FFF") }
                        OutlinedButton(onClick = { Engine.startControlProbe(scanHeader, scanRx, scanFrom, scanTo, testSession) }) { Text("Find controls (safe)") }
                    }
                    if (ui.scanning || ui.scanTotal > 0) {
                        val frac = if (ui.scanTotal > 0) ui.scanDone.toFloat() / ui.scanTotal else 0f
                        LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                        val left = ((ui.scanTotal - ui.scanDone) * 0.28).toInt()
                        Text(
                            "${ui.scanDone} of ${ui.scanTotal} checked, ${(frac * 100).toInt()} percent, ${ui.scanFound} found" +
                                (if (ui.scanning) ", about ${left / 60} min ${left % 60} s left" else ""),
                            fontSize = 13.sp, color = Color.White
                        )
                    }
                    if (ui.scanText.isNotEmpty()) {
                        Text(ui.scanText.lines().takeLast(40).joinToString("\n"), fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color.White)
                        OutlinedButton(onClick = {
                            val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            cm.setPrimaryClip(android.content.ClipData.newPlainText("scan", ui.scanText))
                        }) { Text("Copy results") }
                    }
                    Text(
                        "Asks a module for each identifier in a range and lists the ones that answer. It only reads and never writes. Sending to ABRP pauses while it runs. Do it with the car parked and awake.",
                        fontSize = 13.sp, color = Muted
                    )

                    SectionTitle("Preheat test")
                    OutlinedTextField(
                        value = testHeader,
                        onValueChange = { testHeader = it.uppercase(); Engine.setPref("testHeader", testHeader) },
                        label = { Text("Header, like 7E1") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = testRx,
                        onValueChange = { testRx = it.uppercase(); Engine.setPref("testRx", testRx) },
                        label = { Text("Reply address, like 7E9") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = testCmd,
                        onValueChange = { testCmd = it.uppercase(); Engine.setPref("testCmd", testCmd) },
                        label = { Text("Command in hex") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Open extended session first", color = Color.White, modifier = Modifier.weight(1f))
                        Switch(checked = testSession, onCheckedChange = { testSession = it; Engine.setPref("testSession", if (it) "1" else "0") })
                    }
                    OutlinedButton(onClick = { confirmTest = true }) { Text("Send test command") }
                    if (ui.testResult.isNotEmpty()) {
                        Text(ui.testResult, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color.White)
                    }
                    Text(
                        "Experimental. Sends one command you type in to your own car. Only services 31 and 2F are allowed. It will not send while the car is moving or charging, and it needs the adapter connected. Use at your own risk, and only with a command you have a trusted source for.",
                        fontSize = 13.sp, color = Muted
                    )
                    }

                    SectionTitle(stringResource(R.string.sec_activity))
                    ui.log.takeLast(12).forEach {
                        Text(it, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Muted)
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(t: String) {
    Text(t, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Cyan)
}

@Composable
private fun ModelRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, color = Color.White)
    }
}

@Composable
private fun Tile(title: String, value: String, unit: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(CardColor)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(title, fontSize = 13.sp, color = Muted)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
            Spacer(Modifier.width(4.dp))
            Text(unit, fontSize = 13.sp, color = Muted, modifier = Modifier.padding(bottom = 5.dp))
        }
    }
}
