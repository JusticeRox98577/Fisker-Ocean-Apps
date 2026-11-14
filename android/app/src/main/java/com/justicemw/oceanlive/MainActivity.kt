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
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.justicemw.oceanlive.car.Accounts
import com.justicemw.oceanlive.car.Ask
import com.justicemw.oceanlive.car.Car
import com.justicemw.oceanlive.car.HistoryStore
import com.justicemw.oceanlive.car.Status
import com.justicemw.oceanlive.ui.Aqua
import com.justicemw.oceanlive.ui.AskScreen
import com.justicemw.oceanlive.ui.BackgroundBrush
import com.justicemw.oceanlive.ui.BatteryScreen
import com.justicemw.oceanlive.ui.Bg
import com.justicemw.oceanlive.ui.CardBg
import com.justicemw.oceanlive.ui.CardEdge
import com.justicemw.oceanlive.ui.Dim
import com.justicemw.oceanlive.ui.FaultsScreen
import com.justicemw.oceanlive.ui.LiveScreen
import com.justicemw.oceanlive.ui.LocalLandscape
import com.justicemw.oceanlive.ui.OceanBrush
import com.justicemw.oceanlive.ui.SettingsScreen
import com.justicemw.oceanlive.ui.SignInScreen
import com.justicemw.oceanlive.ui.TripsScreen
import com.justicemw.oceanlive.ui.V12Screen
import com.justicemw.oceanlive.ui.V12Share
import com.justicemw.oceanlive.ui.faultReport

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Car.init(this)
        Accounts.init(this)
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
    val v12Misses by Car.v12Misses.collectAsState()
    val importedCount by Car.importedDescriptions.collectAsState()
    val v12 by Car.v12.collectAsState()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    // The 12V battery screen, opened from the Battery tab or the Live 12V tile.
    var show12v by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = show12v && tab == Tab.Battery.ordinal) { show12v = false }
    // "Any questions?" covers the tabs until closed; the tabs keep their place underneath.
    var showAsk by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = showAsk) { showAsk = false }
    val askChat by Ask.chat.collectAsState()
    val accountState by Accounts.state.collectAsState()
    val onAsk: (() -> Unit)? = if (Ask.enabled) ({ showAsk = true }) else null

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

    // Landscape comes from the window itself, not the device: a phone turned sideways, a tablet,
    // or the app in split screen under another app on the car's display all count.
    // The tab content stays at the same place in the tree either way, so turning the phone
    // keeps its state and never restarts anything.
    BoxWithConstraints(Modifier.fillMaxSize().background(Bg).background(BackgroundBrush)) {
        // An Ocean Live account is needed once; after that the app works offline.
        if (Accounts.required && !accountState.signedIn) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))) {
                SignInScreen()
            }
            return@BoxWithConstraints
        }
        if (showAsk) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))) {
                AskScreen(
                    chat = askChat,
                    shareCar = settings.askShareCar,
                    // Only what the app already has in memory: asking never talks to the car.
                    carSummary = { Ask.carSummary(state, faults, settings, System.currentTimeMillis()) },
                    onShareCar = { on -> Car.updateSettings { it.copy(askShareCar = on) } },
                    onSend = { q, car -> Ask.send(context, q, car) },
                    onClear = { Ask.clear() },
                    onBack = { showAsk = false },
                )
            }
            return@BoxWithConstraints
        }
        val wide = maxWidth > maxHeight
        val railLabels = maxHeight >= 320.dp
        CompositionLocalProvider(LocalLandscape provides wide) {
            Row(Modifier.fillMaxSize().then(if (wide) Modifier.windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout)) else Modifier.statusBarsPadding())) {
                if (wide) NavRail(tab, railLabels) {
                    if (it == tab) show12v = false
                    tab = it
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Header(
                        state.status, state.adapterName, state.watchStatus, compact = wide, onAsk = onAsk,
                        action = if (wide) headerAction(
                            state.status, settings.adapterAddress != null,
                            onScan = { withBluetooth { Car.scan() } },
                            onCancelScan = { Car.cancelScan() },
                            onConnectSaved = { withBluetooth { Car.connectSaved() } },
                            onDisconnect = { Car.disconnect() },
                        ) else null,
                    )
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
                        // In landscape the Live tab lays out its own panes; the other tabs stay one readable column.
                        val livePanes = wide && Tab.entries[current] == Tab.Live
                        val scroll = rememberScrollState()
                        Column(
                            Modifier.fillMaxSize().then(if (livePanes) Modifier else Modifier.verticalScroll(scroll)),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Column(
                                Modifier.then(if (wide && !livePanes) Modifier.widthIn(max = 720.dp) else Modifier)
                                    .fillMaxWidth()
                                    .padding(horizontal = if (wide) 12.dp else 18.dp)
                                    .padding(bottom = if (livePanes) 4.dp else 24.dp),
                            ) {
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
                                                    state, v12, v12Misses,
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
                    }
                    if (!wide) NavBar(tab) {
                        if (it == tab) show12v = false
                        tab = it
                    }
                }
            }
        }
    }
}

/** The connect / disconnect button at the right of the compact landscape header. */
private class HeaderAction(@StringRes val label: Int, val color: Color, val primary: Boolean, val onClick: () -> Unit)

private fun headerAction(
    status: Status,
    hasAdapter: Boolean,
    onScan: () -> Unit,
    onCancelScan: () -> Unit,
    onConnectSaved: () -> Unit,
    onDisconnect: () -> Unit,
): HeaderAction? = when (status) {
    Status.Live, Status.Watching -> HeaderAction(R.string.disconnect, com.justicemw.oceanlive.ui.Bad, false, onDisconnect)
    Status.Reconnecting -> HeaderAction(R.string.stop_reconnecting, com.justicemw.oceanlive.ui.Bad, false, onDisconnect)
    Status.Scanning -> HeaderAction(R.string.cancel, Dim, false, onCancelScan)
    Status.Connecting -> null
    Status.Idle, Status.Error ->
        if (hasAdapter) HeaderAction(R.string.connect, Aqua, true, onConnectSaved)
        else HeaderAction(R.string.start_find_adapter, Aqua, true, onScan)
}

@Composable
private fun Header(
    status: Status, adapter: String?, @androidx.annotation.StringRes watchStatus: Int,
    compact: Boolean = false, action: HeaderAction? = null, onAsk: (() -> Unit)? = null,
) {
    val text = when (status) {
                Status.Live -> stringResource(R.string.header_connected_to, adapter ?: stringResource(R.string.adapter_generic))
                Status.Connecting -> stringResource(R.string.header_connecting)
                Status.Reconnecting -> stringResource(R.string.status_reconnecting)
                Status.Scanning -> stringResource(R.string.header_scanning)
                Status.Error -> stringResource(R.string.status_not_connected)
                Status.Idle -> stringResource(R.string.status_not_connected)
                Status.Watching -> stringResource(watchStatus)
            }
        val dot by animateColorAsState(
            when (status) {
                Status.Live -> Aqua
                Status.Watching -> com.justicemw.oceanlive.ui.Violet
                Status.Connecting, Status.Reconnecting, Status.Scanning -> com.justicemw.oceanlive.ui.Warn
                else -> Dim
            }, tween(500), label = "dot",
        )
    if (compact) {
        // One line to save height: title, status dot and text, and the connect button at the right.
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 4.dp).height(40.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.app_name), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
            Spacer(Modifier.width(8.dp))
            Text(text, color = Dim, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (onAsk != null) {
                Spacer(Modifier.width(8.dp))
                AskButton(onAsk)
            }
            if (status == Status.Connecting) {
                CircularProgressIndicator(color = Aqua, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            } else if (action != null) {
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier.height(34.dp).clip(RoundedCornerShape(12.dp))
                        .then(
                            if (action.primary) Modifier.background(OceanBrush)
                            else Modifier.border(1.dp, action.color.copy(alpha = 0.5f), RoundedCornerShape(12.dp)),
                        )
                        .clickable(onClick = action.onClick)
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        stringResource(action.label), color = if (action.primary) Color(0xFF04121C) else action.color,
                        fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                    )
                }
            }
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.app_name), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(text, color = Dim, fontSize = 13.sp)
        }
        if (onAsk != null) {
            AskButton(onAsk)
            Spacer(Modifier.width(12.dp))
        }
        Box(Modifier.size(10.dp).clip(CircleShape).background(dot))
    }
}

/** The round "?" button in the header that opens "Any questions?". */
@Composable
private fun AskButton(onClick: () -> Unit) {
    val label = stringResource(R.string.ask_title)
    Box(
        Modifier.size(36.dp).clip(CircleShape).border(1.dp, Aqua.copy(alpha = 0.5f), CircleShape)
            .clickable(onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text("?", color = Aqua, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
}

/** Landscape navigation: the same five tabs in a slim rail on the left, to keep the height for content. */
@Composable
private fun NavRail(selected: Int, showLabels: Boolean, onSelect: (Int) -> Unit) {
    Column(
        Modifier.fillMaxHeight().width(76.dp).verticalScroll(rememberScrollState()).padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(if (showLabels) 6.dp else 2.dp),
    ) {
        Tab.entries.forEachIndexed { i, t ->
            val on = i == selected
            val color by animateColorAsState(if (on) Aqua else Dim, tween(250), label = "rail")
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                    .clickable(remember { MutableInteractionSource() }, null) { onSelect(i) }
                    .padding(vertical = if (showLabels) 6.dp else 5.dp, horizontal = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(t.glyph, color = color, fontSize = 18.sp)
                if (showLabels) {
                    Text(
                        stringResource(t.label), color = color, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
                Spacer(Modifier.height(if (showLabels) 4.dp else 2.dp))
                Box(
                    Modifier.width(if (on) 18.dp else 0.dp).height(3.dp).clip(RoundedCornerShape(2.dp))
                        .background(if (on) OceanBrush else androidx.compose.ui.graphics.SolidColor(CardEdge)),
                )
            }
        }
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
