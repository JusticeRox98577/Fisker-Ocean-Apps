package com.justicemw.oceanlive.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.car.Ask
import com.justicemw.oceanlive.car.AskChat
import com.justicemw.oceanlive.car.AskTurn
import com.justicemw.oceanlive.car.Balance
import com.justicemw.oceanlive.car.ReportReason
import kotlinx.coroutines.launch

/**
 * "Any questions?": a simple chat with Claude about the Fisker Ocean and the app.
 * [carSummary] is what would be sent with a question when [shareCar] is on. [balanceCents] is the
 * account's balance, which pays for questions once the free ones for the day are used up.
 * [onReport] sends a report about an AI answer (offensive, harmful, wrong or something else).
 */
@Composable
fun AskScreen(
    chat: AskChat,
    shareCar: Boolean,
    carSummary: () -> String,
    onShareCar: (Boolean) -> Unit,
    onSend: suspend (question: String, car: String?) -> Unit,
    onClear: () -> Unit,
    onBack: () -> Unit,
    balanceCents: Int? = null,
    onReport: (suspend (questionId: String, reason: ReportReason, note: String?) -> Ask.ReportResult)? = null,
) {
    val scope = rememberCoroutineScope()
    var input by rememberSaveable { mutableStateOf("") }
    var showSent by rememberSaveable { mutableStateOf(false) }
    // The answer being reported (its question id), while the report dialog is open.
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val examples = listOf(R.string.ask_example_1, R.string.ask_example_2, R.string.ask_example_3).map { stringResource(it) }

    fun send(text: String) {
        val q = text.trim()
        if (q.isEmpty() || chat.waiting) return
        input = ""
        scope.launch { onSend(q, if (shareCar) carSummary() else null) }
    }

    // A failed question goes back into the field so it can be sent again.
    LaunchedEffect(chat.retry) { chat.retry?.let { if (input.isBlank()) input = it } }
    LaunchedEffect(chat.turns.size, chat.waiting) {
        val last = chat.turns.size + (if (chat.waiting) 1 else 0)
        if (last > 0) list.animateScrollToItem(last)
    }

    Column(Modifier.fillMaxSize().navigationBarsPadding().imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().weight(1f).padding(horizontal = 18.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "‹ " + stringResource(R.string.ask_back), color = Aqua, fontSize = 15.sp,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onBack).padding(vertical = 6.dp, horizontal = 4.dp),
                )
                Spacer(Modifier.weight(1f))
                if (chat.turns.isNotEmpty() && !chat.waiting) {
                    Text(
                        stringResource(R.string.ask_new_chat), color = Dim, fontSize = 14.sp,
                        modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onClear).padding(vertical = 6.dp, horizontal = 4.dp),
                    )
                }
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Column {
                        Text(stringResource(R.string.ask_title), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(6.dp))
                        Text(stringResource(R.string.ask_intro), color = Dim, fontSize = 13.sp)
                        Spacer(Modifier.height(10.dp))
                        Card {
                            Row(Modifier.fillMaxWidth().clickable { onShareCar(!shareCar) }, verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.ask_share_car), color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f))
                                Switch(
                                    checked = shareCar, onCheckedChange = onShareCar,
                                    colors = SwitchDefaults.colors(checkedTrackColor = Aqua, checkedThumbColor = Color(0xFF04121C), uncheckedTrackColor = Bg, uncheckedBorderColor = CardEdge),
                                )
                            }
                            Text(
                                stringResource(if (shareCar) R.string.ask_share_car_on else R.string.ask_share_car_off),
                                color = Dim, fontSize = 12.sp,
                            )
                            Text(
                                stringResource(if (showSent) R.string.ask_hide_sent else R.string.ask_show_sent), color = Aqua, fontSize = 13.sp,
                                modifier = Modifier.padding(top = 6.dp).clickable { showSent = !showSent },
                            )
                            AnimatedVisibility(showSent) {
                                SelectionContainer {
                                    Column {
                                        if (shareCar) {
                                            Text(
                                                carSummary(), color = Color.White, fontSize = 12.sp, fontFamily = FontFamily.Monospace,
                                                modifier = Modifier.padding(top = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Bg).padding(10.dp),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        if (chat.turns.isEmpty()) {
                            Spacer(Modifier.height(12.dp))
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                examples.forEach { q ->
                                    Text(
                                        q, color = Aqua, fontSize = 13.sp,
                                        modifier = Modifier.clip(RoundedCornerShape(14.dp)).border(1.dp, Aqua.copy(alpha = 0.4f), RoundedCornerShape(14.dp))
                                            .clickable(enabled = !chat.waiting) { send(q) }.padding(horizontal = 12.dp, vertical = 8.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                items(chat.turns) { t -> Bubble(t, onReport = if (onReport != null) ({ id -> reporting = id }) else null) }
                if (chat.waiting) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
                            CircularProgressIndicator(color = Aqua, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(10.dp))
                            Text(stringResource(R.string.ask_thinking), color = Dim, fontSize = 13.sp)
                        }
                    }
                }
                chat.error?.let { e -> item { Text(stringResource(e), color = Bad, fontSize = 13.sp, modifier = Modifier.padding(4.dp)) } }
                val notice = if (chat.error != null || chat.waiting) null
                else Balance.askNotice(chat.freeLeft, chat.paidLast, chat.day, Ask.utcDay(System.currentTimeMillis()), balanceCents)
                notice?.let { n ->
                    item {
                        val text = when (n) {
                            is Balance.AskNotice.UsesBalance -> stringResource(R.string.ask_uses_balance, money(n.balanceCents))
                            Balance.AskNotice.FreeUsedUp -> stringResource(R.string.ask_error_free_used)
                        }
                        Text(text, color = Dim, fontSize = 13.sp, modifier = Modifier.padding(4.dp))
                    }
                }
                item { Text(stringResource(R.string.ask_disclaimer), color = Dim, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp)) }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = input, onValueChange = { input = it.take(2000) },
                    placeholder = { Text(stringResource(R.string.ask_placeholder), color = Dim) },
                    maxLines = 5,
                    modifier = Modifier.weight(1f),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Aqua, unfocusedBorderColor = CardEdge,
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Aqua,
                    ),
                )
                Spacer(Modifier.width(8.dp))
                val canSend = input.isNotBlank() && !chat.waiting
                val sendLabel = stringResource(R.string.ask_send)
                Box(
                    Modifier.size(48.dp).clip(CircleShape)
                        .background(if (canSend) OceanBrush else androidx.compose.ui.graphics.SolidColor(CardBg))
                        .clickable(enabled = canSend) { send(input) }
                        .semantics { contentDescription = sendLabel },
                    contentAlignment = Alignment.Center,
                ) { Text("↑", color = if (canSend) Color(0xFF04121C) else Dim, fontSize = 22.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }

    val reportId = reporting
    if (reportId != null && onReport != null) {
        ReportDialog(onSend = { reason, note -> onReport(reportId, reason, note) }, onClose = { reporting = null })
    }
}

@Composable
private fun Bubble(turn: AskTurn, onReport: ((questionId: String) -> Unit)?) {
    val mine = turn.fromOwner
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        SelectionContainer {
            Text(
                turn.text, color = if (mine) Color(0xFF04121C) else Color.White, fontSize = 15.sp,
                modifier = Modifier.widthIn(max = 560.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .then(if (mine) Modifier.background(OceanBrush) else Modifier.background(CardBg).border(1.dp, CardEdge, RoundedCornerShape(16.dp)))
                    .padding(12.dp),
            )
        }
        val paid = turn.paidCents
        if (!mine && paid != null) {
            val left = turn.balanceCents
            Text(
                if (left != null) stringResource(R.string.ask_paid_left, money(paid), money(left)) else stringResource(R.string.ask_paid, money(paid)),
                color = Dim, fontSize = 12.sp, modifier = Modifier.padding(start = 6.dp, top = 4.dp),
            )
        }
        val id = turn.questionId
        if (!mine && id != null && onReport != null) {
            if (turn.reported) {
                Text(stringResource(R.string.ask_report_done), color = Dim, fontSize = 12.sp, modifier = Modifier.padding(start = 6.dp, top = 4.dp))
            } else {
                val label = stringResource(R.string.ask_report_label)
                Text(
                    stringResource(R.string.ask_report), color = Dim, fontSize = 12.sp,
                    // At least 48dp to tap: a plain clickable Text doesn't get Material's minimum.
                    modifier = Modifier.minimumInteractiveComponentSize().clip(RoundedCornerShape(8.dp))
                        .clickable(role = Role.Button) { onReport(id) }
                        .semantics { contentDescription = label }
                        .padding(horizontal = 6.dp, vertical = 8.dp),
                )
            }
        }
    }
}

/**
 * Report an AI answer: a reason, an optional note, Send. Shows thanks once sent, or what went
 * wrong (the dialog stays open to try again).
 */
@Composable
private fun ReportDialog(onSend: suspend (ReportReason, String?) -> Ask.ReportResult, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var reason by rememberSaveable { mutableStateOf<ReportReason?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var sent by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }

    if (sent) {
        AlertDialog(
            onDismissRequest = onClose,
            title = { Text(stringResource(R.string.ask_report_title)) },
            text = { Text(stringResource(R.string.ask_report_thanks)) },
            confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.done), color = Aqua) } },
            containerColor = CardBg, titleContentColor = Color.White, textContentColor = Dim,
        )
        return
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text(stringResource(R.string.ask_report_title)) },
        text = {
            Column {
                Text(stringResource(R.string.ask_report_why), color = Dim, fontSize = 14.sp)
                Spacer(Modifier.height(6.dp))
                Column(Modifier.selectableGroup()) {
                    ReportReason.entries.forEach { r ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                                .selectable(selected = reason == r, enabled = !busy, role = Role.RadioButton) { reason = r; error = null }
                                .padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = reason == r, onClick = null, enabled = !busy,
                                colors = RadioButtonDefaults.colors(selectedColor = Aqua, unselectedColor = Dim),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(r.label), color = Color.White, fontSize = 15.sp)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = note, onValueChange = { note = it.take(Ask.MAX_NOTE) },
                    label = { Text(stringResource(R.string.ask_report_note)) },
                    enabled = !busy,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Aqua, unfocusedBorderColor = CardEdge, focusedLabelColor = Aqua, unfocusedLabelColor = Dim,
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Aqua,
                    ),
                )
                error?.let { Text(stringResource(it), color = Bad, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = {
            val r = reason
            TextButton(
                onClick = {
                    if (r == null || busy) return@TextButton
                    busy = true
                    error = null
                    scope.launch {
                        when (val result = onSend(r, note.takeIf { it.isNotBlank() })) {
                            Ask.ReportResult.Sent -> sent = true
                            is Ask.ReportResult.Failed -> error = result.message
                        }
                        busy = false
                    }
                },
                enabled = r != null && !busy,
            ) {
                if (busy) CircularProgressIndicator(color = Aqua, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                else Text(stringResource(R.string.ask_send), color = if (r != null) Aqua else Dim, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text(stringResource(R.string.cancel), color = Dim) } },
        containerColor = CardBg, titleContentColor = Color.White, textContentColor = Dim,
    )
}
