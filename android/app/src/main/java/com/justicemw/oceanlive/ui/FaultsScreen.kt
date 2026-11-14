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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.Strings
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
import com.justicemw.oceanlive.obd.displayName
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

    SectionTitle(stringResource(R.string.faults_title))
    Card(Modifier.animateContentSize()) {
        Text(pluralStringResource(R.plurals.faults_intro, Ecus.scanList.size, Ecus.scanList.size), color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(14.dp))
        when {
            scan.running -> {
                Text(stringResource(R.string.faults_checking, scan.current ?: "…"), color = Color.White)
                Spacer(Modifier.height(8.dp))
                MeterBar(scan.progress.toFloat() / scan.total)
                Text(stringResource(R.string.faults_progress, scan.progress, scan.total), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            }
            !state.connected -> Text(stringResource(R.string.blocked_not_connected), color = Warn)
            else -> GradientButton(stringResource(if (scan.finishedAt == null) R.string.faults_scan_all else R.string.faults_scan_again), onScan, enabled = !action.running && !versions.running)
        }
        scan.error?.let { Text(it, color = Bad, modifier = Modifier.padding(top = 8.dp)) }
    }

    ActionCard(action, onDismissResults)

    if (scan.finishedAt != null || scan.running) {
        Results(scan, versions.versions, blockedReason, onShare) { confirm = it }
    }

    VersionsSection(state, scan, action, versions, onReadVersions)

    PastScans(pastScans.filter { it.time != scan.finishedAt })

    SectionTitle(stringResource(R.string.faults_descriptions))
    Card {
        Text(stringResource(R.string.faults_descriptions_explain), color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        GhostButton(stringResource(if (importedCount > 0) R.string.faults_import_more else R.string.faults_import), onImport)
        if (importedCount > 0) {
            Text(pluralStringResource(R.plurals.faults_imported_loaded, importedCount, importedCount), color = Good, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            TextButton(onClick = onClearImported) { Text(stringResource(R.string.faults_remove_imported), color = Bad, fontSize = 13.sp) }
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
    SectionTitle(stringResource(R.string.faults_results))
    TileRow {
        Tile(
            stringResource(R.string.dtc_active), active.toString(), Modifier.weight(1f), accent = if (active > 0) Bad else Good,
            caption = if (!canSort) null else stringResource(if (byActive) R.string.faults_listed_first else R.string.faults_tap_to_list),
            captionColor = if (byActive) Bad else Dim,
            selected = byActive, onClick = if (canSort) ({ activeFirst = !activeFirst }) else null,
        )
        Tile(stringResource(R.string.faults_stored), (codes.size - active).toString(), Modifier.weight(1f), accent = Warn)
        Tile(stringResource(R.string.faults_modules), "$answered", Modifier.weight(1f), accent = Cyan, caption = stringResource(R.string.faults_answered))
    }
    scan.finishedAt?.let { Text(stringResource(R.string.faults_scanned_at, dateTime(it)), color = Dim, fontSize = 12.sp) }
    val diff = scan.diff
    if (!scan.running) diff.previousTime?.let { prev ->
        val changes = listOfNotNull(
            diff.newKeys.size.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.faults_n_new, it, it) },
            diff.cleared.size.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.faults_n_cleared, it, it) },
        )
        Text(
            if (changes.isEmpty()) stringResource(R.string.faults_no_changes, dateTime(prev))
            else stringResource(R.string.faults_changes, dateTime(prev), changes.joinToString(", ")),
            color = if (diff.newKeys.isNotEmpty()) Violet else Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp),
        )
    }
    val incomplete = scan.modules.filterValues { it == "incomplete" }.keys
    if (incomplete.isNotEmpty()) {
        Text(stringResource(R.string.faults_incomplete, incomplete.joinToString()), color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }

    if (codes.isEmpty() && scan.finishedAt != null) {
        Spacer(Modifier.height(12.dp))
        Card(glow = Good) { Text(stringResource(R.string.faults_none), color = Good) }
    }

    val groups = codes.groupBy { it.ecu }.entries.sortedByDescending { e -> e.value.count { it.state == DtcState.Active } }
    if (groups.isNotEmpty() && !scan.running) {
        Spacer(Modifier.height(14.dp))
        GradientButton(
            pluralStringResource(R.plurals.faults_clear_all_groups, groups.size, groups.size),
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
            Text(stringResource(R.string.faults_clear_every, Ecus.scanList.size), color = if (blockedReason == null) Bad else Dim, fontSize = 13.sp)
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
                Text(stringResource(R.string.dtc_active).uppercase() + " · ${now.size}", color = Bad, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.2.sp,
                    modifier = Modifier.padding(top = 18.dp, bottom = 6.dp, start = 4.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    now.forEach { CodeRow(it, module = it.ecu.displayName(), isNew = FaultHistory.key(it) in scan.diff.newKeys) }
                }
                val rest = codes.filter { it.state != DtcState.Active }.groupBy { it.ecu }.entries.sortedBy { moduleOrder(it.key) }
                rest.forEach { (ecu, list) -> ModuleGroup(ecu, list, scan, blockedReason, onConfirm) }
            } else {
                groups.forEach { (ecu, list) -> ModuleGroup(ecu, list, scan, blockedReason, onConfirm) }
            }
        }
    }

    if (diff.cleared.isNotEmpty() && !scan.running) {
        SectionTitle(stringResource(R.string.faults_cleared_since))
        Card(glow = Good) {
            Text(stringResource(R.string.faults_cleared_explain), color = Dim, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            diff.cleared.forEach { c ->
                val info = c.toDtc().info
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(info.title, color = Color.White, fontSize = 14.sp)
                        Row {
                            Text(c.code, color = Aqua, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text("  ·  " + c.ecu.displayName(), color = Dim, fontSize = 11.sp)
                        }
                    }
                    Text(stringResource(R.string.faults_cleared), color = Good, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    // Restart any module that answered, including ones with no codes (a frozen screen, a stuck telematics box).
    val reachable = Ecus.scanList.filter { it.offersRestart && (scan.modules[it.code] == "ok" || scan.modules[it.code] == "incomplete") }
    if (reachable.isNotEmpty() && !scan.running) {
        var open by remember { mutableStateOf(false) }
        SectionTitle(stringResource(R.string.faults_restart_title))
        Card(Modifier.animateContentSize()) {
            Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.faults_restart_explain), color = Dim, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(stringResource(if (open) R.string.hide else R.string.show), color = Aqua, fontWeight = FontWeight.SemiBold)
            }
            if (open) {
                Spacer(Modifier.height(8.dp))
                reachable.forEach { ecu ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(ecu.displayName(), color = Color.White)
                            Text(ecu.code + if (ecu.hardRestart) " · " + stringResource(R.string.faults_full_restart) else "", color = Dim, fontSize = 11.sp)
                        }
                        SmallAction(stringResource(R.string.restart), Cyan, blockedReason == null) { onConfirm(Pending(CarAction.Restart, listOf(ecu))) }
                    }
                }
                blockedReason?.let { Text(it, color = Warn, fontSize = 12.sp) }
            }
        }
    }

    if (!scan.running && (codes.isNotEmpty() || diff.cleared.isNotEmpty() || versions.isNotEmpty())) {
        Spacer(Modifier.height(18.dp))
        GhostButton(stringResource(R.string.faults_share_report), onShare)
    }
}

@Composable
private fun ModuleGroup(ecu: Ecu, list: List<Dtc>, scan: FaultScan, blockedReason: String?, onConfirm: (Pending) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("${ecu.displayName().uppercase()} · ${list.size}", color = Dim, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.2.sp, modifier = Modifier.weight(1f).padding(start = 4.dp))
        SmallAction(stringResource(R.string.clear), Bad, blockedReason == null) { onConfirm(Pending(CarAction.Clear, listOf(ecu))) }
        if (ecu.offersRestart) {
            Spacer(Modifier.width(6.dp))
            SmallAction(stringResource(R.string.restart), Cyan, blockedReason == null) { onConfirm(Pending(CarAction.Restart, listOf(ecu))) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        list.sortedBy { it.state.ordinal }.forEach { CodeRow(it, isNew = FaultHistory.key(it) in scan.diff.newKeys) }
    }
}

@Composable
private fun VersionsSection(state: CarState, scan: FaultScan, action: ActionRun, run: VersionRun, onRead: () -> Unit) {
    SectionTitle(stringResource(R.string.versions_title))
    Card(Modifier.animateContentSize()) {
        Text(stringResource(R.string.versions_intro), color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(14.dp))
        when {
            run.running -> {
                Text(stringResource(R.string.versions_reading, run.current ?: "…"), color = Color.White)
                Spacer(Modifier.height(8.dp))
                MeterBar(if (run.total == 0) 0f else run.progress.toFloat() / run.total)
                Text(stringResource(R.string.progress_of, run.progress, run.total), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            }
            !state.connected -> if (run.versions.isEmpty()) Text(stringResource(R.string.blocked_not_connected), color = Warn)
            scan.running || action.running -> Text(stringResource(R.string.blocked_scan_running), color = Warn, fontSize = 13.sp)
            else -> GhostButton(stringResource(if (run.finishedAt == null) R.string.versions_read else R.string.versions_read_again), onRead)
        }
        if (!run.running && run.finishedAt != null && run.versions.isEmpty()) {
            Text(stringResource(R.string.versions_none), color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
        }
        if (run.versions.isNotEmpty()) Spacer(Modifier.height(6.dp))
        run.versions.forEach { v ->
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(v.ecu.displayName(), color = Color.White, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(v.softwareVersion ?: "—", color = Aqua, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                val details = listOfNotNull(
                    v.partNumber?.let { stringResource(R.string.versions_part, it) },
                    v.softwareNumber?.let { stringResource(R.string.versions_software_no, it) },
                )
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
    SectionTitle(stringResource(R.string.faults_past_scans))
    Card(Modifier.animateContentSize()) {
        (if (showAll) newest else newest.take(PAST_SHOWN)).forEach { PastScanRow(it) }
        if (newest.size > PAST_SHOWN) {
            TextButton(onClick = { showAll = !showAll }) {
                Text(if (showAll) stringResource(R.string.show_fewer) else stringResource(R.string.show_all, newest.size), color = Aqua, fontSize = 13.sp)
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
                    Text(pluralStringResource(R.plurals.faults_n_active, s.active, s.active), color = if (s.active > 0) Bad else Good, fontSize = 12.sp)
                    Text("  ·  " + pluralStringResource(R.plurals.faults_n_stored, s.stored, s.stored), color = if (s.stored > 0) Warn else Dim, fontSize = 12.sp)
                }
            }
            Text(stringResource(if (open) R.string.hide else R.string.show), color = Aqua, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        AnimatedVisibility(open, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(Modifier.padding(bottom = 8.dp)) {
                if (s.codes.isEmpty()) {
                    Text(stringResource(R.string.faults_none_in_scan), color = Good, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp))
                }
                s.codes.map { it.toDtc() }.groupBy { it.ecu }.entries.sortedBy { moduleOrder(it.key) }.forEach { (ecu, list) ->
                    Text("${ecu.displayName().uppercase()} · ${list.size}", color = Dim, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
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
            if (p.ecus.size == 1) stringResource(R.string.confirm_clear_one, p.ecus[0].displayName())
            else pluralStringResource(R.plurals.confirm_clear_many, p.ecus.size, p.ecus.size),
            (if (p.ecus.size > 15) stringResource(R.string.confirm_clear_slow) + "\n\n" else "") + stringResource(R.string.confirm_clear_body),
            stringResource(R.string.clear_codes),
        )
        CarAction.Restart -> Triple(
            stringResource(R.string.confirm_restart, p.ecus[0].displayName()),
            stringResource(R.string.confirm_restart_body),
            stringResource(R.string.restart),
        )
    }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(button, color = if (p.action == CarAction.Clear) Bad else Cyan, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel), color = Dim) } },
        containerColor = CardBg,
    )
}

@Composable
private fun ActionCard(run: ActionRun, onDismiss: () -> Unit) {
    AnimatedVisibility(run.running || run.outcomes.isNotEmpty() || run.stoppedBy != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        Column {
            SectionTitle(stringResource(if (run.action == CarAction.Restart) R.string.restart else R.string.action_clearing))
            Card(Modifier.animateContentSize(), glow = if (run.running) Cyan else null) {
                if (run.running) {
                    Text(stringResource(run.action?.label ?: R.string.action_working) + ": " + (run.current ?: "…"), color = Color.White)
                    Spacer(Modifier.height(8.dp))
                    MeterBar(if (run.total == 0) 0f else run.done.toFloat() / run.total)
                    Text(stringResource(R.string.action_keep_parked), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                }
                run.outcomes.forEach { OutcomeRow(it) }
                if (!run.running) {
                    if (run.outcomes.size < run.total) {
                        Text(pluralStringResource(R.plurals.action_stopped_early, run.total, run.outcomes.size, run.total), color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                        run.stoppedBy?.let { Text(stringResource(it.text), color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp)) }
                    }
                    TextButton(onClick = onDismiss) { Text(stringResource(R.string.done), color = Aqua) }
                }
            }
        }
    }
}

@Composable
private fun OutcomeRow(o: ActionOutcome) {
    val (text, color) = when (val r = o.result) {
        UdsResult.Done -> when {
            o.action == CarAction.Restart -> stringResource(R.string.outcome_restarted) +
                (o.remaining?.let { if (it > 0) " · " + pluralStringResource(R.plurals.outcome_codes_stored, it, it) else "" } ?: "") to Good
            o.remaining == null -> stringResource(R.string.outcome_cleared_check) to Good
            o.remaining == 0 -> stringResource(R.string.faults_cleared) to Good
            else -> pluralStringResource(R.plurals.outcome_came_back, o.remaining, o.remaining) to Warn
        }
        is UdsResult.Refused -> (if (r.needsSecurity) stringResource(R.string.outcome_needs_key) else refusedText(r)) to Bad
        UdsResult.NoAnswer -> stringResource(R.string.outcome_no_answer) to Bad
        UdsResult.Unclear -> stringResource(R.string.outcome_unclear) to Warn
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(o.ecu.displayName(), color = Color.White, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

/** A module's refusal in plain words; an unknown code is shown in hex. */
@Composable
private fun refusedText(r: UdsResult.Refused): String =
    if (r.reason == R.string.nrc_other) stringResource(R.string.nrc_other, "0x%02X".format(r.nrc)) else stringResource(r.reason)

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
                    Text("  ·  " + (module ?: stringResource(info.sourceLabel)), color = Dim, fontSize = 11.sp)
                    info.severity?.takeIf { it != DtcSeverity.Info }?.let {
                        Text("  ·  " + stringResource(it.label), color = if (it == DtcSeverity.Critical) Bad else Warn, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                info.note?.let { Text(it, color = Warn, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp)) }
                if (info.hasDetails && !open) Text(stringResource(R.string.code_tap_details), color = Cyan, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Box(Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                    Text(stringResource(d.state.label), color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
                if (isNew) {
                    Spacer(Modifier.height(4.dp))
                    Box(Modifier.clip(RoundedCornerShape(50)).background(Violet.copy(alpha = 0.18f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                        Text(stringResource(R.string.code_new), color = Violet, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        AnimatedVisibility(open, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(Modifier.padding(top = 10.dp)) {
                info.impact?.let { DetailBlock(stringResource(R.string.code_affects), listOf(it), numbered = false) }
                if (info.causes.isNotEmpty()) DetailBlock(stringResource(R.string.code_causes), info.causes, numbered = false)
                if (info.steps.isNotEmpty()) DetailBlock(stringResource(R.string.code_fixed), info.steps, numbered = info.steps.size > 1)
                Text(stringResource(R.string.code_technician), color = Dim, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
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


fun faultReport(s: Strings, state: CarState, scan: FaultScan, versions: List<ModuleVersion> = emptyList()): String = buildString {
    val fmt = DateFormat.getDateTimeInstance()
    append(s.get(R.string.report_fault_title)).append("\n")
    state.vin?.let { append(s.get(R.string.report_vin, it)).append("\n") }
    scan.finishedAt?.let { append(s.get(R.string.report_date, fmt.format(Date(it)))).append("\n") }
    val diff = scan.diff
    diff.previousTime?.let {
        val changes = s.plural(R.plurals.faults_n_new, diff.newKeys.size, diff.newKeys.size) + ", " +
            s.plural(R.plurals.faults_n_cleared, diff.cleared.size, diff.cleared.size)
        append(s.get(R.string.report_compared, fmt.format(Date(it)), changes)).append("\n")
    }
    append("\n")
    scan.codes.groupBy { it.ecu }.forEach { (ecu, list) ->
        append("${ecu.displayName(s)} (${ecu.request}):\n")
        list.forEach {
            val info = it.info
            val new = if (FaultHistory.key(it) in diff.newKeys) " [" + s.get(R.string.code_new).uppercase() + "]" else ""
            append("  ${it.code}  ${s.get(it.state.label)}$new · ${info.title}${info.note?.let { n -> " ($n)" } ?: ""}\n")
            info.impact?.let { t -> append("      ").append(s.get(R.string.report_affects, t)).append("\n") }
            if (info.causes.isNotEmpty()) append("      ").append(s.get(R.string.report_causes, info.causes.joinToString("; "))).append("\n")
            if (info.steps.isNotEmpty()) append("      ").append(s.get(R.string.report_fix, info.steps.joinToString("; "))).append("\n")
        }
    }
    if (diff.cleared.isNotEmpty()) {
        append("\n").append(s.get(R.string.faults_cleared_since)).append(":\n")
        diff.cleared.forEach { append("  ${it.code}  ${it.ecu.displayName(s)} · ${it.toDtc().info.title}\n") }
    }
    val silent = scan.modules.filterValues { it != "ok" }
    if (silent.isNotEmpty()) {
        val list = silent.entries.joinToString { "${it.key} (${moduleStatusLabel(it.value)?.let { id -> s.get(id) } ?: it.value})" }
        append("\n").append(s.get(R.string.report_no_answer_from, list)).append("\n")
    }
    if (versions.isNotEmpty()) {
        append("\n").append(s.get(R.string.versions_title)).append(":\n")
        versions.forEach { v ->
            val parts = listOfNotNull(
                v.softwareVersion?.let { s.get(R.string.report_software, it) },
                v.softwareNumber?.let { s.get(R.string.versions_software_no, it) },
                v.partNumber?.let { s.get(R.string.versions_part, it) },
            )
            append("  ${v.ecu.displayName(s)} (${v.ecu.code}): ${parts.joinToString(" · ")}\n")
        }
    }
}

/** What a module did during the scan ("no answer", "incomplete", ...), as stored in [FaultScan.modules]. */
private fun moduleStatusLabel(status: String): Int? = when (status) {
    "incomplete" -> R.string.module_incomplete
    "no answer" -> R.string.module_no_answer
    "refused" -> R.string.module_refused
    "unreadable" -> R.string.module_unreadable
    else -> null
}
