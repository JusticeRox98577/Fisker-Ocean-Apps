package com.justice.oceanlive

import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun CloudImportDialog(onDismiss: () -> Unit, onImport: (CloudCredentials) -> Unit) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var capture by remember { mutableStateOf("") }
    var vin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var showCapture by remember { mutableStateOf(false) }

    fun importText(text: String) {
        scope.launch {
            busy = true
            error = null
            val result = withContext(Dispatchers.Default) { runCatching { CloudCredentials.parse(text, vin) } }
            busy = false
            result.onSuccess(onImport).onFailure { error = it.message ?: "Could not read this capture." }
        }
    }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            error = null
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
                        val output = StringBuilder()
                        val buffer = CharArray(8192)
                        while (true) {
                            val count = reader.read(buffer)
                            if (count < 0) break
                            require(output.length + count <= CloudCredentials.MAX_CAPTURE_SIZE) {
                                "Capture is too large. Export only the login and shortstats requests."
                            }
                            output.append(buffer, 0, count)
                        }
                        output.toString()
                    } ?: throw IllegalArgumentException("Could not open the selected file.")
                    CloudCredentials.parse(text, vin)
                }
            }
            busy = false
            result.onSuccess(onImport).onFailure {
                // Do not display parser/IO exception details, which can include capture contents.
                error = if (it is IllegalArgumentException) it.message else "Could not read the file. Try selecting it again."
            }
        }
    }

    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                Modifier.systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Set up online car data", style = MaterialTheme.typography.headlineSmall)
                Text("Capture and import on this phone. No computer is needed. The app cannot read another app's encrypted traffic just by opening it.")
                Text("1. Install PCAPdroid and its mitm addon from the official releases. In PCAPdroid, enable TLS decryption and follow its certificate setup wizard.")
                TextButton(onClick = { uriHandler.openUri("https://github.com/emanuele-f/PCAPdroid/releases") }) { Text("Get PCAPdroid") }
                TextButton(onClick = { uriHandler.openUri("https://github.com/emanuele-f/PCAPdroid-mitm/releases") }) { Text("Get the decryption addon") }
                Text("2. Select the Fisker app as the capture target. Enable Full payload and add a decryption rule for ccc.skipti.com. Start capture, then reopen the Fisker app and refresh your car data.")
                Text("If you see a certificate error or a closed lock, the traffic has not been decrypted. Many Android apps reject user certificates; a rooted phone with the certificate in its system store, or a capture-enabled build of the source app, may be needed. Import alone cannot fix this.")
                TextButton(onClick = { uriHandler.openUri("https://emanuele-f.github.io/PCAPdroid/tls_decryption.html") }) { Text("Certificate setup and troubleshooting") }
                Text("3. In PCAPdroid's HTTP view, select the POST /api/v1/goloopsdk/login and GET /api/v1/fisker/shortstats?vin= requests for your account and car. Save those two as HAR, then stop capture.")
                Text("4. Import that HAR below. It fills SDK bearer, account email, fleet ID, login token and VIN together. Use the login request's bearer, never the shortstats bearer. Captures contain account secrets; delete exported files when finished.")
                OutlinedButton(onClick = { filePicker.launch(arrayOf("*/*")) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Reading capture…" else "Import HAR / credential JSON file")
                }
                Text("Or paste the full login request (URL, headers and JSON body) below. You can also paste a HAR or credential JSON. Screenshots cannot supply a token that is cut off.")
                OutlinedButton(onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (text.isNullOrBlank()) error = "The clipboard has no text to paste."
                    else if (text.length > CloudCredentials.MAX_CAPTURE_SIZE) error = "Capture is too large. Copy only the login request."
                    else { capture = text; error = null }
                }, enabled = !busy) { Text("Paste from clipboard") }
                OutlinedTextField(
                    value = capture, onValueChange = { capture = it; error = null },
                    label = { Text("Login request, HAR or credential JSON") },
                    visualTransformation = if (showCapture) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(),
                    minLines = 3, maxLines = 6, enabled = !busy, modifier = Modifier.fillMaxWidth()
                )
                TextButton(onClick = { showCapture = !showCapture }) { Text(if (showCapture) "Hide capture" else "Show capture") }
                OutlinedTextField(
                    value = vin, onValueChange = { vin = it; error = null },
                    label = { Text("VIN or shortstats URL (if missing from capture)") },
                    singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth()
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(onClick = { importText(capture) }, enabled = !busy && capture.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Import all five fields") }
                Text("Imported values stay in this app's private storage. Signing out of Fisker may invalidate the login token; capture again if login stops working.")
                TextButton(onClick = onDismiss, enabled = !busy) { Text("Close") }
            }
        }
    }
}
