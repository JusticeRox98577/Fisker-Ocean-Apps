package com.justicemw.oceanlive.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
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
import com.justicemw.oceanlive.car.FaultScan
import com.justicemw.oceanlive.obd.Dtc
import com.justicemw.oceanlive.obd.DtcSeverity
import com.justicemw.oceanlive.obd.DtcState
import com.justicemw.oceanlive.obd.Ecu
import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.UdsResult
import java.text.DateFormat
import java.util.Date

private data class Pending(val action: CarAction, val ecus: List<Ecu>)

private val DangerBrush = Brush.linearGradient(listOf(Bad, Violet))

@Composable
fun FaultsScreen(
    state: CarState,
    scan: FaultScan,
    action: ActionRun,
    blockedReason: String?,
    onScan: () -> Unit,
    onShare: () -> Unit,
    onClear: (List<Ecu>) -> Unit,
    onRestart: (Ecu) -> Unit,
    onDismissResults: () -> Unit,
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
            else -> GradientButton(if (scan.finishedAt == null) "Scan all modules" else "Scan again", onScan, enabled = !action.running)
        }
        scan.error?.let { Text(it, color = Bad, modifier = Modifier.padding(top = 8.dp)) }
    }

    ActionCard(action, onDismissResults)

    if (scan.finishedAt == null && !scan.running) return

    val codes = scan.codes
    val active = codes.count { it.state == DtcState.Active }
    val answered = scan.modules.count { it.value == "ok" || it.value == "incomplete" }
    SectionTitle("Results")
    TileRow {
        Tile("Active now", active.toString(), Modifier.weight(1f), accent = if (active > 0) Bad else Good)
        Tile("Stored", (codes.size - active).toString(), Modifier.weight(1f), accent = Warn)
        Tile("Modules", "$answered", Modifier.weight(1f), accent = Cyan, caption = "answered")
    }
    scan.finishedAt?.let {
        Text("Scanned " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)), color = Dim, fontSize = 12.sp)
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
            { confirm = Pending(CarAction.Clear, groups.map { it.key }) },
            enabled = blockedReason == null, brush = DangerBrush,
        )
        blockedReason?.let { Text(it, color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
    }
    if (scan.finishedAt != null && !scan.running) {
        TextButton(
            onClick = { confirm = Pending(CarAction.Clear, Ecus.scanList) },
            enabled = blockedReason == null,
            modifier = Modifier.padding(top = if (groups.isEmpty()) 8.dp else 0.dp),
        ) {
            Text("Clear every module (${Ecus.scanList.size}), including ones that showed nothing", color = if (blockedReason == null) Bad else Dim, fontSize = 13.sp)
        }
    }

    groups.forEach { (ecu, list) ->
        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${ecu.name.uppercase()} · ${list.size}", color = Dim, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.2.sp, modifier = Modifier.weight(1f).padding(start = 4.dp))
            SmallAction("Clear", Bad, blockedReason == null) { confirm = Pending(CarAction.Clear, listOf(ecu)) }
            if (ecu.canRestart) {
                Spacer(Modifier.width(6.dp))
                SmallAction("Restart", Cyan, blockedReason == null) { confirm = Pending(CarAction.Restart, listOf(ecu)) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            list.sortedBy { it.state.ordinal }.forEach { CodeRow(it) }
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
                        SmallAction("Restart", Cyan, blockedReason == null) { confirm = Pending(CarAction.Restart, listOf(ecu)) }
                    }
                }
                blockedReason?.let { Text(it, color = Warn, fontSize = 12.sp) }
            }
        }
    }

    if (codes.isNotEmpty()) {
        Spacer(Modifier.height(18.dp))
        GhostButton("Share report", onShare)
    }

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

@Composable
private fun CodeRow(d: Dtc) {
    val color = when (d.state) {
        DtcState.Active -> Bad
        DtcState.Pending -> Warn
        DtcState.Lamp -> Warn
        else -> Dim
    }
    val info = d.info
    var open by remember(d.code) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(CardBg)
            .then(if (info.hasDetails) Modifier.clickable { open = !open } else Modifier)
            .animateContentSize().padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(info.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(d.code, color = Aqua, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text("  ·  " + info.sourceLabel, color = Dim, fontSize = 11.sp)
                    info.severity?.takeIf { it != DtcSeverity.Info }?.let {
                        Text("  ·  " + it.label, color = if (it == DtcSeverity.Critical) Bad else Warn, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                info.note?.let { Text(it, color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp)) }
                if (info.hasDetails && !open) Text("Tap for causes and fixes", color = Cyan, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.width(8.dp))
            Box(Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                Text(d.state.label, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
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

fun faultReport(state: CarState, scan: FaultScan): String = buildString {
    append("Ocean Live fault scan\n")
    state.vin?.let { append("VIN: $it\n") }
    scan.finishedAt?.let { append("Date: ${DateFormat.getDateTimeInstance().format(Date(it))}\n") }
    append("\n")
    scan.codes.groupBy { it.ecu }.forEach { (ecu, list) ->
        append("${ecu.name} (${ecu.request}):\n")
        list.forEach {
            val info = it.info
            append("  ${it.code}  ${it.state.label} · ${info.title}${info.note?.let { n -> " ($n)" } ?: ""}\n")
            info.impact?.let { t -> append("      Affects: $t\n") }
            if (info.causes.isNotEmpty()) append("      Causes: ${info.causes.joinToString("; ")}\n")
            if (info.steps.isNotEmpty()) append("      Fix: ${info.steps.joinToString("; ")}\n")
        }
    }
    val silent = scan.modules.filterValues { it != "ok" }
    if (silent.isNotEmpty()) append("\nNo complete answer from: ${silent.entries.joinToString { "${it.key} (${it.value})" }}\n")
}
