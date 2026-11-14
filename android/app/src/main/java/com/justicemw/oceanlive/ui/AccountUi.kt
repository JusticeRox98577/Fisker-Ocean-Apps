package com.justicemw.oceanlive.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.car.Accounts
import com.justicemw.oceanlive.car.AuthConfig
import kotlinx.coroutines.launch

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

@Composable
private fun AccountField(label: String, value: String, keyboard: KeyboardType, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Aqua, unfocusedBorderColor = CardEdge, focusedLabelColor = Aqua, unfocusedLabelColor = Dim,
            focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Aqua,
        ),
    )
}

/**
 * Shown instead of the app until the owner signs in. Signing in needs internet once; after that the
 * app works offline.
 */
@Composable
fun SignInScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var config by remember { mutableStateOf<AuthConfig?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }
    var email by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var codeSent by rememberSaveable { mutableStateOf(false) }
    var retry by remember { mutableStateOf(0) }

    LaunchedEffect(retry) {
        loaded = false
        config = Accounts.config()
        loaded = true
    }

    fun run(block: suspend () -> Accounts.Result, onOk: () -> Unit = {}) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            when (val r = block()) {
                Accounts.Result.Ok -> onOk()
                is Accounts.Result.Failed -> error = r.message
            }
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().imePadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Column(Modifier.widthIn(max = 460.dp).fillMaxWidth()) {
            Text(stringResource(R.string.app_name), color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.account_signin_title), color = Aqua, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.account_signin_body), color = Dim, fontSize = 14.sp)
            Spacer(Modifier.height(24.dp))
            val c = config
            when {
                !loaded -> CircularProgressIndicator(color = Aqua, modifier = Modifier.size(28.dp).align(Alignment.CenterHorizontally))
                c == null || (!c.google && !c.email) -> {
                    Text(stringResource(if (c == null) R.string.account_error_network else R.string.account_no_methods), color = Bad, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    GhostButton(stringResource(R.string.account_try_again), { retry++ })
                }
                else -> {
                    val webId = c.googleWebClientId
                    if (c.google && webId != null && !codeSent) {
                        GradientButton(stringResource(R.string.account_continue_google), {
                            val activity = context.activity() ?: return@GradientButton
                            run({ Accounts.signInWithGoogle(activity, webId) })
                        }, enabled = !busy)
                        Spacer(Modifier.height(16.dp))
                    }
                    if (c.email) {
                        if (!codeSent) {
                            AccountField(stringResource(R.string.account_email), email, KeyboardType.Email) { email = it.take(254) }
                            Spacer(Modifier.height(8.dp))
                            GhostButton(stringResource(R.string.account_send_code), {
                                if (!busy) run({ Accounts.emailStart(email) }) { codeSent = true; code = "" }
                            })
                        } else {
                            Text(stringResource(R.string.account_code_sent, email.trim()), color = Color.White, fontSize = 14.sp)
                            Spacer(Modifier.height(8.dp))
                            AccountField(stringResource(R.string.account_code), code, KeyboardType.Number) { v -> code = v.filter { it.isDigit() }.take(6) }
                            Spacer(Modifier.height(8.dp))
                            GradientButton(stringResource(R.string.account_verify), {
                                run({ Accounts.emailVerify(context, email, code) })
                            }, enabled = !busy && code.length == 6)
                            Spacer(Modifier.height(10.dp))
                            Text(
                                stringResource(R.string.account_resend), color = Aqua, fontSize = 14.sp,
                                modifier = Modifier.clickable(enabled = !busy) { run({ Accounts.emailStart(email) }) { code = "" } }.padding(vertical = 6.dp),
                            )
                            Text(
                                stringResource(R.string.account_use_other), color = Dim, fontSize = 14.sp,
                                modifier = Modifier.clickable(enabled = !busy) { codeSent = false; error = null }.padding(vertical = 6.dp),
                            )
                        }
                    }
                }
            }
            if (busy) {
                Spacer(Modifier.height(16.dp))
                CircularProgressIndicator(color = Aqua, strokeWidth = 2.dp, modifier = Modifier.size(22.dp).align(Alignment.CenterHorizontally))
            }
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(stringResource(it), color = Bad, fontSize = 14.sp)
            }
            Spacer(Modifier.height(24.dp))
            Text(stringResource(R.string.account_privacy), color = Dim, fontSize = 12.sp)
        }
    }
}

/** The Account card at the top of Settings: name, email, sign-in method, sign out and delete. */
@Composable
fun AccountSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by Accounts.state.collectAsState()
    val account = state.account
    var name by rememberSaveable(account?.name) { mutableStateOf(account?.name.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { Accounts.refresh(context) }

    SectionTitle(stringResource(R.string.account_section))
    Card {
        account?.email?.let { Text(it, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
        if (account != null && account.providers.isNotEmpty()) {
            val names = account.providers.map {
                when (it) {
                    "apple" -> "Apple"
                    "google" -> "Google"
                    else -> stringResource(R.string.account_provider_email)
                }
            }
            Text(stringResource(R.string.account_signed_in_with, names.joinToString(", ")), color = Dim, fontSize = 13.sp)
        }
        Spacer(Modifier.height(8.dp))
        AccountField(stringResource(R.string.account_name), name, KeyboardType.Text) { name = it.take(60) }
        if (name.trim() != account?.name.orEmpty()) {
            GhostButton(stringResource(R.string.account_save_name), {
                if (!busy) {
                    busy = true
                    scope.launch {
                        (Accounts.rename(context, name) as? Accounts.Result.Failed)?.let { error = it.message }
                        busy = false
                    }
                }
            })
            Spacer(Modifier.height(8.dp))
        }
        account?.id?.let {
            SelectionContainer { Text(stringResource(R.string.account_id, it), color = Dim, fontSize = 12.sp) }
        }
        error?.let { Text(stringResource(it), color = Bad, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }
        Spacer(Modifier.height(12.dp))
        GhostButton(stringResource(R.string.account_sign_out), { confirmSignOut = true }, color = Dim)
        Spacer(Modifier.height(8.dp))
        GhostButton(stringResource(R.string.account_delete), { confirmDelete = true }, color = Bad)
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text(stringResource(R.string.account_sign_out_title)) },
            text = { Text(stringResource(R.string.account_sign_out_body)) },
            confirmButton = {
                TextButton({ confirmSignOut = false; scope.launch { Accounts.signOut(context) } }) { Text(stringResource(R.string.account_sign_out)) }
            },
            dismissButton = { TextButton({ confirmSignOut = false }) { Text(stringResource(R.string.cancel)) } },
            containerColor = CardBg, titleContentColor = Color.White, textContentColor = Dim,
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(stringResource(R.string.account_delete_title)) },
            text = { Text(stringResource(R.string.account_delete_body)) },
            confirmButton = {
                TextButton({
                    confirmDelete = false
                    busy = true
                    scope.launch {
                        (Accounts.delete(context) as? Accounts.Result.Failed)?.let { error = it.message }
                        busy = false
                    }
                }) { Text(stringResource(R.string.account_delete), color = Bad) }
            },
            dismissButton = { TextButton({ confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
            containerColor = CardBg, titleContentColor = Color.White, textContentColor = Dim,
        )
    }
    Spacer(Modifier.height(8.dp))
}
