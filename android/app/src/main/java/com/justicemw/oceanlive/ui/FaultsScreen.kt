package com.justicemw.oceanlive.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.car.ActionOutcome
import com.justicemw.oceanlive.car.ActionRun
import com.justicemw.oceanlive.car.CarAction
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.FaultHistory
import com.justicemw.oceanlive.car.FaultScan
import com.justicemw.oceanlive.car.SavedScan
import com.justicemw.oceanlive.car.VersionRun
import com.justicemw.oceanlive.obd.Dtc
import com.justicemw.oceanlive.obd.DtcSeverity
import com.justicemw.oceanlive.obd.DtcState
import com.justicemw.oceanlive.obd.Ecu
import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.ModuleVersion
import com.justicemw.oceanlive.obd.UdsResult
import java.text.DateFormat
import java.util.Date

private data class Pending(val action: CarAction, val ecus: List<Ecu>)

private val DangerBrush = Brush.linearGradient(listOf(Bad, Violet))

private fun dateTime(t: Long): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(t))

/** Order of modules in the scan list, so lists keep a steady order. */
private fun moduleOrder(ecu: Ecu): Int = Ecus.scanList.indexOf(ecu).let { if (it < 0) Int.MAX_VALUE else it }

@Composable
fun FaultsScreen(
    state: CarState,
    scan: FaultScan,
    action: ActionRun,
    versions: VersionRun,
    pastScans: List<SavedScan>,
    blockedReason: String?,
    onScan: () -> Unit,
    onShare: () -> Unit,
    onClear: (List<Ecu>) -> Unit,
    onRestart: (Ecu) -> Unit,
    onDismissResults: () -> Unit,
    onReadVersions: () -> Unit,
    importedCount: Int,
    onImport: () -> Unit,
    onClearImported: () -> Unit,
) {
    var confirm by remember { mutableStateOf<Pending?>(null) }

    SectionTitle("Fault codes")
    Card(Modifier.animateContentSize()) {
        Text("Reads stored fault codes from ${Ecus.scanList.size} modules in the car. Reading changes nothing.", color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(14.dp))
        when {
            scan.running -> {
                Text("Checking ${scan.current ?: "…"}", color = Color.White)
                Spacer(Modifier.height(8.dp))
                MeterBar(scan.progress.toFloat() / scan.total)
                Text("${scan.progress} of ${scan.total} · about a minute", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            }
            !state.connected -> Text("Connect to the car first.", color = Warn)
            else -> GradientButton(if (scan.finishedAt == null) "Scan all modules" else "Scan again", onScan, enabled = !action.running && !versions.running)
        }
        scan.error?.let { Text(it, color = Bad, modifier = Modifier.padding(top = 8.dp)) }
    }

    ActionCard(action, onDismissResults)

    if (scan.finishedAt != null || scan.running) {
        Results(scan, versions.versions, blockedReason, onShare) { confirm = it }
    }

    VersionsSection(state, scan, action, versions, onReadVersions)

    PastScans(pastScans.filter { it.time != scan.finishedAt })

    SectionTitle("Code descriptions")
    Card {
        Text(
            "Standard codes and the Ocean codes documented from real cars have built-in descriptions. Other Fisker-specific codes are described " +
                "from the code itself: which module reported it and how it failed. Import a description list (CSV, or JSON with names, causes and repair steps) " +
                    "and it takes priority. You can import several; the more detailed source wins for each code. Lists stay on this phone.",
            color = Dim, fontSize = 13.sp,
        )
        Spacer(Modifier.height(12.dp))
        GhostButton(if (importedCount > 0) "Import more descriptions" else "Import descriptions", onImport)
        if (importedCount > 0) {
            Text("$importedCount imported descriptions loaded.", color = Good, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            TextButton(onClick = onClearImported) { Text("Remove imported descriptions", color = Bad, fontSize = 13.sp) }
        }
    }

    confirm?.let { p -> ConfirmDialog(p, onCancel = { confirm = null }) {
        confirm = null
        when (p.action) {
            CarAction.Clear -> onClear(p.ecus)
            CarAction.Restart -> onRestart(p.ecus.first())
        }
    } }
}

@Composable
private fun Results(
    scan: FaultScan,
    versions: List<ModuleVersion>,
    blockedReason: String?,
    onShare: () -> Unit,
    onConfirm: (Pending) -> Unit,
) {
    var activeFirst by rememberSaveable { mutableStateOf(false) }
    val codes = scan.codes
    val active = codes.count { it.state == DtcState.Active }
    val answered = scan.modules.count { it.value == "ok" || it.value == "incomplete" }
    val canSort = scan.finishedAt != null && !scan.running && active > 0
    val byActive = activeFirst && canSort
    SectionTitle("Results")
    TileRow {
        Tile(
            "Active now", active.toString(), Modifier.weight(1f), accent = if (active > 0) Bad else Good,
            caption = if (!canSort) null else if (byActive) "listed first" else "tap to list",
            captionColor = if (byActive) Bad else Dim,
            selected = byActive, onClick = if (canSort) ({ activeFirst = !activeFirst }) else null,
        )
        Tile("Stored", (codes.size - active).toString(), Modifier.weight(1f), accent = Warn)
        Tile("Modules", "$answered", Modifier.weight(1f), accent = Cyan, caption = "answered")
    }
    scan.finishedAt?.let { Text("Scanned " + dateTime(it), color = Dim, fontSize = 12.sp) }
    val diff = scan.diff
    if (!scan.running) diff.previousTime?.let { prev ->
        val changes = listOfNotNull(
            diff.newKeys.size.takeIf { it > 0 }?.let { "$it new" },
            diff.cleared.size.takeIf { it > 0 }?.let { "$it cleared" },
        )
        Text(
            if (changes.isEmpty()) "No changes since the scan on ${dateTime(prev)}." else "Since the scan on ${dateTime(prev)}: ${changes.joinToString(", ")}.",
            color = if (diff.newKeys.isNotEmpty()) Violet else Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp),
        )
    }
    val incomplete = scan.modules.filterValues { it == "incomplete" }.keys
    if (incomplete.isNotEmpty()) {
        Text("Some lists may be incomplete (${incomplete.joinToString()}). Scanning again usually fills them in.", color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }

    if (codes.isEmpty() && scan.finishedAt != null) {
        Spacer(Modifier.height(12.dp))
        Card(glow = Good) { Text("No fault codes stored in any module that answered.", color = Good) }
    }

    val groups = codes.groupBy { it.ecu }.entries.sortedByDescending { e -> e.value.count { it.state == DtcState.Active } }
    if (groups.isNotEmpty() && !scan.running) {
        Spacer(Modifier.height(14.dp))
        GradientButton(
            "Clear codes in all ${groups.size} modules",
            { onConfirm(Pending(CarAction.Clear, groups.map { it.key })) },
            enabled = blockedReason == null, brush = DangerBrush,
        )
        blockedReason?.let { Text(it, color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
    }
    if (scan.finishedAt != null && !scan.running) {
        TextButton(
            onClick = { onConfirm(Pending(CarAction.Clear, Ecus.scanList)) },
            enabled = blockedReason == null,
            modifier = Modifier.padding(top = if (groups.isEmpty()) 8.dp else 0.dp),
        ) {
            Text("Clear every module (${Ecus.scanList.size}), including ones that showed nothing", color = if (blockedReason == null) Bad else Dim, fontSize = 13.sp)
        }
    }

    AnimatedContent(
        targetState = byActive,
        transitionSpec = { fadeIn(tween(320, delayMillis = 80)) togetherWith fadeOut(tween(180)) using SizeTransform(clip = false) },
        label = "faultSort",
    ) { sorted ->
        Column(Modifier.fillMaxWidth()) {
            if (sorted) {
                val now = codes.filter { it.state == DtcState.Active }.sortedBy { moduleOrder(it.ecu) }
                Text("ACTIVE NOW · ${now.size}", color = Bad, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.2.sp,
                    modifier = Modifier.padding(top = 18.dp, bottom = 6.dp, start = 4.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    now.forEach { CodeRow(it, module = it.ecu.name, isNew = FaultHistory.key(it) in scan.diff.newKeys) }
                }
                val rest = codes.filter { it.state != DtcState.Active }.groupBy { it.ecu }.entries.sortedBy { moduleOrder(it.key) }
                rest.forEach { (ecu, list) -> ModuleGroup(ecu, list, scan, blockedReason, onConfirm) }
            } else {
                groups.forEach { (ecu, list) -> ModuleGroup(ecu, list, scan, blockedReason, onConfirm) }
            }
        }
    }

    if (diff.cleared.isNotEmpty() && !scan.running) {
        SectionTitle("Cleared since last scan")
        Card(glow = Good) {
            Text("These codes were there last time and are gone now.", color = Dim, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            diff.cleared.forEach { c ->
                val info = c.toDtc().info
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(info.title, color = Color.White, fontSize = 14.sp)
                        Row {
                            Text(c.code, color = Aqua, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text("  ·  " + c.ecu.name, color = Dim, fontSize = 11.sp)
                        }
                    }
                    Text("Cleared", color = Good, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    // Restart any module that answered, including ones with no codes (a frozen screen, a stuck telematics box).
    val reachable = Ecus.scanList.filter { it.canRestart && (scan.modules[it.code] == "ok" || scan.modules[it.code] == "incomplete") }
    if (reachable.isNotEmpty() && !scan.running) {
        var open by remember { mutableStateOf(false) }
        SectionTitle("Restart a module")
        Card(Modifier.animateContentSize()) {
            Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
                Text("For a frozen screen or a module that stopped working. A restart is not a repair.", color = Dim, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(if (open) "Hide" else "Show", color = Aqua, fontWeight = FontWeight.SemiBold)
            }
            if (open) {
                Spacer(Modifier.height(8.dp))
                reachable.forEach { ecu ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(ecu.name, color = Color.White)
                            Text(ecu.code + if (ecu.hardRestart) " · full restart" else "", color = Dim, fontSize = 11.sp)
                        }
                        SmallAction("Restart", Cyan, blockedReason == null) { onConfirm(Pending(CarAction.Restart, listOf(ecu))) }
                    }
                }
                blockedReason?.let { Text(it, color = Warn, fontSize = 12.sp) }
            }
        }
    }

    if (!scan.running && (codes.isNotEmpty() || diff.cleared.isNotEmpty() || versions.isNotEmpty())) {
        Spacer(Modifier.height(18.dp))
        GhostButton("Share report", onShare)
    }
}

@Composable
private fun ModuleGroup(ecu: Ecu, list: List<Dtc>, scan: FaultScan, blockedReason: String?, onConfirm: (Pending) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("${ecu.name.uppercase()} · ${list.size}", color = Dim, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.2.sp, modifier = Modifier.weight(1f).padding(start = 4.dp))
        SmallAction("Clear", Bad, blockedReason == null) { onConfirm(Pending(CarAction.Clear, listOf(ecu))) }
        if (ecu.canRestart) {
            Spacer(Modifier.width(6.dp))
            SmallAction("Restart", Cyan, blockedReason == null) { onConfirm(Pending(CarAction.Restart, listOf(ecu))) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        list.sortedBy { it.state.ordinal }.forEach { CodeRow(it, isNew = FaultHistory.key(it) in scan.diff.newKeys) }
    }
}

@Composable
private fun VersionsSection(state: CarState, scan: FaultScan, action: ActionRun, run: VersionRun, onRead: () -> Unit) {
    SectionTitle("Module versions")
    Card(Modifier.animateContentSize()) {
        Text("Reads each module's software version and part number. Reading changes nothing.", color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(14.dp))
        when {
            run.running -> {
                Text("Reading ${run.current ?: "…"}", color = Color.White)
                Spacer(Modifier.height(8.dp))
                MeterBar(if (run.total == 0) 0f else run.progress.toFloat() / run.total)
                Text("${run.progress} of ${run.total}", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            }
            !state.connected -> if (run.versions.isEmpty()) Text("Connect to the car first.", color = Warn)
            scan.running || action.running -> Text("Wait for the scan to finish.", color = Warn, fontSize = 13.sp)
            else -> GhostButton(if (run.finishedAt == null) "Read module versions" else "Read again", onRead)
        }
        if (!run.running && run.finishedAt != null && run.versions.isEmpty()) {
            Text("No module sent its version details.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
        }
        if (run.versions.isNotEmpty()) Spacer(Modifier.height(6.dp))
        run.versions.forEach { v ->
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(v.ecu.name, color = Color.White, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(v.softwareVersion ?: "—", color = Aqua, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                val details = listOfNotNull(v.partNumber?.let { "Part $it" }, v.softwareNumber?.let { "Software no. $it" })
                if (details.isNotEmpty()) Text(details.joinToString("  ·  "), color = Dim, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun PastScans(scans: List<SavedScan>) {
    if (scans.isEmpty()) return
    var showAll by remember { mutableStateOf(false) }
    val newest = scans.sortedByDescending { it.time }
    SectionTitle("Past scans")
    Card(Modifier.animateContentSize()) {
        (if (showAll) newest else newest.take(PAST_SHOWN)).forEach { PastScanRow(it) }
        if (newest.size > PAST_SHOWN) {
            TextButton(onClick = { showAll = !showAll }) {
                Text(if (showAll) "Show fewer" else "Show all ${newest.size}", color = Aqua, fontSize = 13.sp)
            }
        }
    }
}

private const val PAST_SHOWN = 8

@Composable
private fun PastScanRow(s: SavedScan) {
    var open by remember(s.time) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { open = !open }.padding(vertical = 8.dp, horizontal = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(dateTime(s.time), color = Color.White, fontSize = 14.sp)
                Row {
                    Text("${s.active} active", color = if (s.active > 0) Bad else Good, fontSize = 12.sp)
                    Text("  ·  ${s.stored} stored", color = if (s.stored > 0) Warn else Dim, fontSize = 12.sp)
                }
            }
            Text(if (open) "Hide" else "Show", color = Aqua, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        AnimatedVisibility(open, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(Modifier.padding(bottom = 8.dp)) {
                if (s.codes.isEmpty()) {
                    Text("No fault codes in this scan.", color = Good, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp))
                }
                s.codes.map { it.toDtc() }.groupBy { it.ecu }.entries.sortedBy { moduleOrder(it.key) }.forEach { (ecu, list) ->
                    Text("${ecu.name.uppercase()} · ${list.size}", color = Dim, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = 1.2.sp, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp, start = 4.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        list.sortedBy { it.state.ordinal }.forEach { CodeRow(it, inCard = true) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConfirmDialog(p: Pending, onCancel: () -> Unit, onConfirm: () -> Unit) {
    val (title, body, button) = when (p.action) {
        CarAction.Clear -> Triple(
            if (p.ecus.size == 1) "Clear codes in ${p.ecus[0].name}?" else "Clear codes in ${p.ecus.size} modules?",
            (if (p.ecus.size > 15) "This goes through every module one by one and takes a couple of minutes.\n\n" else "") +
                "This erases the stored fault history a workshop would use, so do it after the problem is fixed or after you've shared the report.\n\n" +
                "Codes for faults that are still there will come back straight away.\n\n" +
                "Car on and in Park, foot on the brake, charging cable unplugged.",
            "Clear codes",
        )
        CarAction.Restart -> Triple(
            "Restart ${p.ecus[0].name}?",
            "The module turns off and back on. Its features stop for a few seconds and screens or warning lights may flicker. " +
                "It's a restart, not a repair, and settings normally stay as they are.\n\nOnly while parked: car in Park, foot on the brake.",
            "Restart",
        )
    }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(button, color = if (p.action == CarAction.Clear) Bad else Cyan, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel", color = Dim) } },
        containerColor = CardBg,
    )
}

@Composable
private fun ActionCard(run: ActionRun, onDismiss: () -> Unit) {
    AnimatedVisibility(run.running || run.outcomes.isNotEmpty(), enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        Column {
            SectionTitle(if (run.action == CarAction.Restart) "Restart" else "Clearing codes")
            Card(Modifier.animateContentSize(), glow = if (run.running) Cyan else null) {
                if (run.running) {
                    Text("${run.action?.label ?: "Working"}: ${run.current ?: "…"}", color = Color.White)
                    Spacer(Modifier.height(8.dp))
                    MeterBar(if (run.total == 0) 0f else run.done.toFloat() / run.total)
                    Text("Keep the car parked until this finishes.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                }
                run.outcomes.forEach { OutcomeRow(it) }
                if (!run.running) {
                    if (run.outcomes.size < run.total) {
                        Text("Stopped early because the car started moving or charging.", color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                    TextButton(onClick = onDismiss) { Text("Done", color = Aqua) }
                }
            }
        }
    }
}

@Composable
private fun OutcomeRow(o: ActionOutcome) {
    val (text, color) = when (val r = o.result) {
        UdsResult.Done -> when {
            o.action == CarAction.Restart -> "Restarted" + (o.remaining?.let { if (it > 0) " · $it codes stored" else "" } ?: "") to Good
            o.remaining == null -> "Cleared · scan again to confirm" to Good
            o.remaining == 0 -> "Cleared" to Good
            else -> "Cleared, ${o.remaining} came back (fault still present)" to Warn
        }
        is UdsResult.Refused -> (if (r.needsSecurity) "Needs a security key Ocean Live doesn't have" else r.reason.replaceFirstChar { it.uppercase() }) to Bad
        UdsResult.NoAnswer -> "No answer" to Bad
        UdsResult.Unclear -> "Unclear reply · scan again to check" to Warn
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(o.ecu.name, color = Color.White, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun SmallAction(text: String, color: Color, enabled: Boolean, onClick: () -> Unit) {
    val c = if (enabled) color else Dim
    Box(
        Modifier.clip(RoundedCornerShape(50)).border(1.dp, c.copy(alpha = 0.5f), RoundedCornerShape(50))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 5.dp),
    ) { Text(text, color = c, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
}


/** One fault code. [module] adds the module name (for lists that mix modules); [isNew] marks codes that weren't there last scan. */
@Composable
private fun CodeRow(d: Dtc, module: String? = null, isNew: Boolean = false, inCard: Boolean = false) {
    val color = when (d.state) {
        DtcState.Active -> Bad
        DtcState.Pending -> Warn
        DtcState.Lamp -> Warn
        else -> Dim
    }
    val info = d.info
    var open by remember(d.code) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (inCard) InsetBg else CardBg)
            .then(if (info.hasDetails) Modifier.clickable { open = !open } else Modifier)
            .animateContentSize().padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(info.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(d.code, color = Aqua, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text("  ·  " + (module ?: info.sourceLabel), color = Dim, fontSize = 11.sp)
                    info.severity?.takeIf { it != DtcSeverity.Info }?.let {
                        Text("  ·  " + it.label, color = if (it == DtcSeverity.Critical) Bad else Warn, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                info.note?.let { Text(it, color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp)) }
                if (info.hasDetails && !open) Text("Tap for causes and fixes", color = Cyan, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Box(Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                    Text(d.state.label, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
                if (isNew) {
                    Spacer(Modifier.height(4.dp))
                    Box(Modifier.clip(RoundedCornerShape(50)).background(Violet.copy(alpha = 0.18f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                        Text("New", color = Violet, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        AnimatedVisibility(open, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(Modifier.padding(top = 10.dp)) {
                info.impact?.let { DetailBlock("What it affects", listOf(it), numbered = false) }
                if (info.causes.isNotEmpty()) DetailBlock("Possible causes", info.causes, numbered = false)
                if (info.steps.isNotEmpty()) DetailBlock("How it's fixed", info.steps, numbered = info.steps.size > 1)
                Text("Repair steps are for a qualified technician. High-voltage parts are dangerous to work on.", color = Dim, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

/** Background for rows that sit inside a card. */
private val InsetBg = Color(0xFF13233A)

@Composable
private fun DetailBlock(heading: String, items: List<String>, numbered: Boolean) {
    Text(heading, color = Aqua, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 3.dp))
    items.forEachIndexed { i, t ->
        Row(Modifier.padding(bottom = 3.dp)) {
            Text(if (numbered) "${i + 1}." else "•", color = Dim, fontSize = 12.sp, modifier = Modifier.width(18.dp))
            Text(t, color = Color.White.copy(alpha = 0.88f), fontSize = 12.sp)
        }
    }
    Spacer(Modifier.height(6.dp))
}


fun faultReport(state: CarState, scan: FaultScan, versions: List<ModuleVersion> = emptyList()): String = buildString {
    append("Ocean Live fault scan\n")
    state.vin?.let { append("VIN: $it\n") }
    scan.finishedAt?.let { append("Date: ${DateFormat.getDateTimeInstance().format(Date(it))}\n") }
    val diff = scan.diff
    diff.previousTime?.let {
        append("Compared with the scan on ${DateFormat.getDateTimeInstance().format(Date(it))}: ${diff.newKeys.size} new, ${diff.cleared.size} cleared\n")
    }
    append("\n")
    scan.codes.groupBy { it.ecu }.forEach { (ecu, list) ->
        append("${ecu.name} (${ecu.request}):\n")
        list.forEach {
            val info = it.info
            val new = if (FaultHistory.key(it) in diff.newKeys) " [NEW]" else ""
            append("  ${it.code}  ${it.state.label}$new · ${info.title}${info.note?.let { n -> " ($n)" } ?: ""}\n")
            info.impact?.let { t -> append("      Affects: $t\n") }
            if (info.causes.isNotEmpty()) append("      Causes: ${info.causes.joinToString("; ")}\n")
            if (info.steps.isNotEmpty()) append("      Fix: ${info.steps.joinToString("; ")}\n")
        }
    }
    if (diff.cleared.isNotEmpty()) {
        append("\nCleared since last scan:\n")
        diff.cleared.forEach { append("  ${it.code}  ${it.ecu.name} · ${it.toDtc().info.title}\n") }
    }
    val silent = scan.modules.filterValues { it != "ok" }
    if (silent.isNotEmpty()) append("\nNo complete answer from: ${silent.entries.joinToString { "${it.key} (${it.value})" }}\n")
    if (versions.isNotEmpty()) {
        append("\nModule versions:\n")
        versions.forEach { v ->
            val parts = listOfNotNull(
                v.softwareVersion?.let { "software $it" },
                v.softwareNumber?.let { "software no. $it" },
                v.partNumber?.let { "part $it" },
            )
            append("  ${v.ecu.name} (${v.ecu.code}): ${parts.joinToString(" · ")}\n")
        }
    }
}
