package com.justicemw.oceanlive.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.car.NovaCommands
import com.justicemw.oceanlive.car.NovaPhone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

/** SuperNova remote commands: pair this phone with the code from the car screen, then lock, unlock, climate. */
@Composable
fun NovaSection() {
    val context = LocalContext.current
    val phone = remember { NovaPhone(context) }
    val scope = rememberCoroutineScope()
    var paired by remember { mutableStateOf(phone.paired) }
    var code by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<NovaPhone.Status?>(null) }
    var waiting by remember { mutableStateOf(phone.pendingCode != null) } // also after leaving the page or the app
    val sentText = stringResource(R.string.nova_sent)
    val waitingText = stringResource(R.string.nova_waiting)
    val refusedText = stringResource(R.string.nova_refused)
    val expiredText = stringResource(R.string.nova_expired)
    val errorText = stringResource(R.string.nova_error)

    suspend fun <T> io(block: () -> T): T? = try {
        withContext(Dispatchers.IO) { block() }
    } catch (e: Exception) {
        message = errorText.format(e.message ?: "?")
        null
    }

    LaunchedEffect(waiting) {
        while (waiting) {
            when (io { phone.pairingStatus() }) {
                "paired" -> { waiting = false; paired = true; message = null }
                "refused" -> { waiting = false; message = refusedText }
                "expired" -> { waiting = false; message = expiredText }
                else -> if (phone.pendingCode == null) waiting = false
            }
            if (waiting) delay(2000)
        }
    }
    LaunchedEffect(paired) { if (paired) status = io { phone.status() } }

    SectionTitle(stringResource(R.string.nova_title))
    Card {
        if (!paired) {
            Text(stringResource(R.string.nova_intro), fontSize = 14.sp)
            OutlinedTextField(
                code, { code = it.uppercase().take(9) }, label = { Text(stringResource(R.string.nova_code)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            if (!waiting) {
                GradientButton(stringResource(R.string.nova_pair), enabled = code.replace(" ", "").length == 8, onClick = {
                    scope.launch {
                        if (io { phone.requestPairing(code) } != null) { waiting = true; message = null }
                    }
                }, modifier = Modifier.padding(top = 8.dp))
            } else {
                Text(waitingText, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                GhostButton(stringResource(R.string.cancel), onClick = { phone.cancelPairing(); waiting = false; message = null },
                    modifier = Modifier.padding(top = 8.dp))
            }
        } else {
            val s = status
            if (s != null && s.lastSeen > 0) {
                Text(stringResource(R.string.nova_last_seen, DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(s.lastSeen))), fontSize = 14.sp)
                if (s.v12mV > 0) Text(stringResource(R.string.nova_v12, "%.1f V".format(s.v12mV / 1000.0)), fontSize = 14.sp)
                s.lastResult?.let { r ->
                    Text(
                        if (r == 0) stringResource(R.string.nova_result_ok) else stringResource(R.string.nova_result_refused, stringResource(
                            when (r) { 1 -> R.string.nova_why_parked; 2 -> R.string.nova_why_battery; 3 -> R.string.nova_why_setup; else -> R.string.nova_why_car },
                        )),
                        fontSize = 14.sp,
                    )
                }
            }
            val send = { action: Int -> scope.launch { if (io { phone.send(action) } != null) message = sentText } }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GradientButton(stringResource(R.string.nova_lock), onClick = { send(NovaCommands.LOCK) })
                GhostButton(stringResource(R.string.nova_unlock), onClick = { send(NovaCommands.UNLOCK) })
            }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton(stringResource(R.string.nova_climate_on), onClick = { send(NovaCommands.CLIMATE_ON) })
                GhostButton(stringResource(R.string.nova_climate_off), onClick = { send(NovaCommands.CLIMATE_OFF) })
            }
            GhostButton(stringResource(R.string.nova_forget), onClick = { phone.forget(); paired = false; status = null },
                modifier = Modifier.padding(top = 8.dp))
        }
        message?.let { Text(it, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
    }
}
