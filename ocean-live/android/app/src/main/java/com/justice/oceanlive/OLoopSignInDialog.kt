package com.justice.oceanlive

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun OLoopSignInDialog(onDismiss: () -> Unit, onSignedIn: (CloudCredentials, String?) -> Unit) {
    var email by remember { mutableStateOf(Engine.getPref("fiskerEmail", "")) }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var account by remember { mutableStateOf<OLoopAuth.Account?>(null) }
    var selectedVin by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Sign in to O Loop") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (account == null) {
                    Text("Use the account you use in O Loop. Your password goes directly to ovloop.auth0.com and is not saved. No capture app, proxy or certificate is needed.")
                    Text("Experimental: reconstructed from O Loop 1.3.1; a live account sign-in has not yet been verified.")
                    OutlinedTextField(email, { email = it }, label = { Text("Account email") }, singleLine = true,
                        enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true,
                        enabled = !busy, visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                } else {
                    Text("Account details received. Choose your vehicle to save all five fields.")
                    account!!.vins.forEach { vin ->
                        TextButton(onClick = { selectedVin = vin }, modifier = Modifier.fillMaxWidth()) {
                            Text((if (selectedVin == vin) "✓ " else "") + vin)
                        }
                    }
                    if (account!!.vins.isEmpty()) {
                        Text("The service returned no vehicle VIN. Enter the VIN from your car or registration.")
                        OutlinedTextField(selectedVin, { selectedVin = it.trim().uppercase(java.util.Locale.US) },
                            label = { Text("17-character VIN") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    }
                }
                if (busy) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Signing in and finding your vehicle…") }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && (account != null || (email.isNotBlank() && password.isNotEmpty())), onClick = {
                val current = account
                if (current != null) {
                    try { onSignedIn(current.credentials(selectedVin), current.tokens.refresh) }
                    catch (e: IllegalArgumentException) { error = e.message }
                } else {
                    val enteredEmail = email.trim()
                    val enteredPassword = password
                    password = ""
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            val result = withContext(Dispatchers.IO) {
                                OLoopAuth().use { it.signIn(enteredEmail, enteredPassword) }
                            }
                            account = result
                            selectedVin = result.vins.singleOrNull().orEmpty()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: IllegalArgumentException) {
                            error = e.message
                        } catch (e: Exception) {
                            error = "Could not reach the sign-in service. Check your connection and try again."
                        } finally { busy = false }
                    }
                }
            }) { Text(if (account == null) "Sign in" else "Save vehicle") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } }
    )
}
