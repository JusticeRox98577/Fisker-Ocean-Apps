package com.justicemw.oceanlive

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.annotation.StringRes
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.justicemw.oceanlive.car.Car
import com.justicemw.oceanlive.car.HistoryStore
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.ui.Aqua
import com.justicemw.oceanlive.ui.BackgroundBrush
import com.justicemw.oceanlive.ui.BatteryScreen
import com.justicemw.oceanlive.ui.Bg
import com.justicemw.oceanlive.ui.CardBg
import com.justicemw.oceanlive.ui.CardEdge
import com.justicemw.oceanlive.ui.Dim
import com.justicemw.oceanlive.ui.FaultsScreen
import com.justicemw.oceanlive.ui.LiveScreen
import com.justicemw.oceanlive.ui.OceanBrush
import com.justicemw.oceanlive.ui.SettingsScreen
import com.justicemw.oceanlive.ui.TripsScreen
import com.justicemw.oceanlive.ui.V12Screen
import com.justicemw.oceanlive.ui.V12Share
import com.justicemw.oceanlive.ui.faultReport

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Car.init(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Aqua, background = Bg, surface = CardBg)) {
                App(::keepScreenOn)
            }
        }
    }

    private fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}

fun bluetoothPermissions(): Array<String> = buildList {
    if (Build.VERSION.SDK_INT >= 31) {
        add(Manifest.permission.BLUETOOTH_SCAN)
        add(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

private enum class Tab(@StringRes val label: Int, val glyph: String) {
    Live(R.string.tab_live, "◉"), Battery(R.string.tab_battery, "▮"), Trips(R.string.tab_trips, "≋"),
    Faults(R.string.tab_faults, "⚠"), Settings(R.string.tab_settings, "⚙"),
}

@Composable
private fun App(keepScreenOn: (Boolean) -> Unit) {
    val context = LocalContext.current
    val state by Car.state.collectAsState()
    val settings by Car.settings.collectAsState()
    val history by Car.history.collectAsState()
    val parked by Car.parked.collectAsState()
    val found by Car.found.collectAsState()
    val faults by Car.faults.collectAsState()
    val action by Car.action.collectAsState()
    val versions by Car.versions.collectAsState()
    val pastScans by Car.pastScans.collectAsState()
    val importedCount by Car.importedDescriptions.collectAsState()
    val v12 by Car.v12.collectAsState()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    // The 12V battery screen, opened from the Battery tab or the Live 12V tile.
    var show12v by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = show12v && tab == Tab.Battery.ordinal) { show12v = false }

    fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
    val pending = remember { arrayOfNulls<() -> Unit>(1) }
    val btLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        // Notifications are optional; Bluetooth is not.
        val needed = result.filterKeys { it != Manifest.permission.POST_NOTIFICATIONS }
        if (needed.values.all { it }) pending[0]?.invoke()
        pending[0] = null
    }
    val simpleLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    fun withBluetooth(action: () -> Unit) {
        val missing = bluetoothPermissions().filterNot { granted(it) }
        if (missing.none { it != Manifest.permission.POST_NOTIFICATIONS }) {
            if (missing.isNotEmpty()) simpleLauncher.launch(missing.toTypedArray())
            action()
        } else {
            pending[0] = action
            btLauncher.launch(missing.toTypedArray())
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) context.contentResolver.openOutputStream(uri)?.use { it.write(HistoryStore.csv(history, settings).toByteArray()) }
    }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val text = try {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (_: Exception) { null }
        val n = text?.let { Car.importDescriptions(it) }
        android.widget.Toast.makeText(
            context,
            if (n == null) context.getString(R.string.import_none) else context.resources.getQuantityString(R.plurals.import_done, n, n),
            android.widget.Toast.LENGTH_LONG,
        ).show()
    }

    // Auto-connect happens in Car when the app comes to the front (Car.autoConnect).
    val live = state.status == Status.Live
    LaunchedEffect(live, settings.keepScreenOn) { keepScreenOn(live && settings.keepScreenOn) }

    Box(Modifier.fillMaxSize().background(Bg).background(BackgroundBrush)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Header(state.status, state.adapterName)
            AnimatedContent(
                targetState = tab,
                transitionSpec = {
                    val dir = if (targetState > initialState) 1 else -1
                    (slideInHorizontally(tween(280)) { it / 6 * dir } + fadeIn(tween(280))) togetherWith
                        (slideOutHorizontally(tween(200)) { -it / 6 * dir } + fadeOut(tween(200)))
                },
                modifier = Modifier.weight(1f),
                label = "tabs",
            ) { current ->
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
                    when (Tab.entries[current]) {
                        Tab.Live -> LiveScreen(
                            state, settings, history, parked, found, Car.bluetoothOn,
                            onScan = { withBluetooth { Car.scan() } },
                            onCancelScan = { Car.cancelScan() },
                            onConnect = { a -> withBluetooth { Car.connect(a.address, a.name) } },
                            onConnectSaved = { withBluetooth { Car.connectSaved() } },
                            onDisconnect = { Car.disconnect() },
                            onOpen12v = { show12v = true; tab = Tab.Battery.ordinal },
                        )
                        Tab.Battery -> AnimatedContent(
                            targetState = show12v,
                            transitionSpec = {
                                val dir = if (targetState) 1 else -1
                                (slideInHorizontally(tween(280)) { it / 6 * dir } + fadeIn(tween(280))) togetherWith
                                    (slideOutHorizontally(tween(200)) { -it / 6 * dir } + fadeOut(tween(200)))
                            },
                            label = "battery12v",
                        ) { open ->
                            Column {
                                if (open) {
                                    V12Screen(
                                        state, v12,
                                        onBack = { show12v = false },
                                        onShare = { range, kind ->
                                            try {
                                                V12Share.share(context, v12, range, kind)
                                            } catch (_: Exception) {
                                                android.widget.Toast.makeText(context, R.string.share_failed, android.widget.Toast.LENGTH_LONG).show()
                                            }
                                        },
                                    )
                                } else {
                                    BatteryScreen(
                                        state, settings, history, parked, v12,
                                        onOpen12v = { show12v = true },
                                        onShareReport = {
                                            // Built from memory and saved history only: no car requests.
                                            val now = System.currentTimeMillis()
                                            val report = BatteryReports.build(context.strings(), now, state.vin, state.snapshot, settings, history, parked, pastScans)
                                            try {
                                                BatteryReportPdf.share(context, report, now)
                                            } catch (_: Exception) {
                                                android.widget.Toast.makeText(context, R.string.report_failed, android.widget.Toast.LENGTH_LONG).show()
                                            }
                                        },
                                    )
                                }
                            }
                        }
                        Tab.Trips -> TripsScreen(
                            history, settings,
                            onExport = { exportLauncher.launch("ocean-live-history.csv") },
                            onClear = { Car.clearHistory() },
                            onDelete = { Car.deleteHistory(it) },
                        )
                        Tab.Faults -> FaultsScreen(
                            state, faults, action, versions, pastScans,
                            // Reads state, faults and action above, so it recomputes whenever they change.
                            blockedReason = Car.changeBlockedReason(),
                            onScan = { Car.scanFaults() },
                            onShare = {
                                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, faultReport(context.strings(), state, faults, versions.versions))
                                context.startActivity(Intent.createChooser(send, context.getString(R.string.faults_share_title)))
                            },
                            onClear = { Car.clearCodes(it) },
                            onRestart = { Car.restartModule(it) },
                            onDismissResults = { Car.dismissActionResults() },
                            onReadVersions = { Car.readVersions() },
                            importedCount = importedCount,
                            onImport = { importLauncher.launch(arrayOf("text/*", "application/json", "application/octet-stream")) },
                            onClearImported = { Car.clearImportedDescriptions() },
                        )
                        Tab.Settings -> SettingsScreen(
                            settings, Car::updateSettings,
                            onForget = { Car.forgetAdapter() },
                            onNeedNotifications = {
                                if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
                                    simpleLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                                }
                            },
                            onNeedLocation = {
                                if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
                                    simpleLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                                }
                            },
                        )
                    }
                }
            }
            NavBar(tab) {
                if (it == tab) show12v = false
                tab = it
            }
        }
    }
}

@Composable
private fun Header(status: Status, adapter: String?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.app_name), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            val text = when (status) {
                Status.Live -> stringResource(R.string.header_connected_to, adapter ?: stringResource(R.string.adapter_generic))
                Status.Connecting -> stringResource(R.string.header_connecting)
                Status.Reconnecting -> stringResource(R.string.status_reconnecting)
                Status.Scanning -> stringResource(R.string.header_scanning)
                Status.Error -> stringResource(R.string.status_not_connected)
                Status.Idle -> stringResource(R.string.status_not_connected)
                Status.Watching -> stringResource(R.string.v12_watch_status)
            }
            Text(text, color = Dim, fontSize = 13.sp)
        }
        val dot by animateColorAsState(
            when (status) {
                Status.Live -> Aqua
                Status.Watching -> com.justicemw.oceanlive.ui.Violet
                Status.Connecting, Status.Reconnecting, Status.Scanning -> com.justicemw.oceanlive.ui.Warn
                else -> Dim
            }, tween(500), label = "dot",
        )
        Box(Modifier.size(10.dp).clip(CircleShape).background(dot))
    }
}

@Composable
private fun NavBar(selected: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Bg).navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceAround,
    ) {
        Tab.entries.forEachIndexed { i, t ->
            val on = i == selected
            val color by animateColorAsState(if (on) Aqua else Dim, tween(250), label = "nav")
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(14.dp))
                    .clickable(remember { MutableInteractionSource() }, null) { onSelect(i) }
                    .padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(t.glyph, color = color, fontSize = 18.sp)
                Text(stringResource(t.label), color = color, fontSize = 11.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
                Spacer(Modifier.height(4.dp))
                Box(
                    Modifier.width(if (on) 18.dp else 0.dp).height(3.dp).clip(RoundedCornerShape(2.dp))
                        .background(if (on) OceanBrush else androidx.compose.ui.graphics.SolidColor(CardEdge)),
                )
            }
        }
    }
}
