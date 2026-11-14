package com.justicemw.oceanlive.car

import android.app.Activity
import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.annotation.StringRes
import androidx.core.content.edit
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.justicemw.oceanlive.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.UnknownHostException
import java.security.SecureRandom
import java.util.Locale

/** The signed-in Ocean Live account, as the server last described it. */
data class AccountInfo(
    val id: String,
    val email: String?,
    val name: String?,
    val providers: List<String>,
) {
    fun toJson(): String = JSONObject().put("id", id).put("email", email ?: JSONObject.NULL).put("name", name ?: JSONObject.NULL)
        .put("providers", org.json.JSONArray(providers)).toString()

    companion object {
        fun from(o: JSONObject): AccountInfo = AccountInfo(
            id = o.getString("id"),
            email = o.optString("email").takeIf { it.isNotEmpty() && !o.isNull("email") },
            name = o.optString("name").takeIf { it.isNotEmpty() && !o.isNull("name") },
            providers = o.optJSONArray("providers")?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty(),
        )
    }
}

data class AccountState(val token: String? = null, val account: AccountInfo? = null) {
    val signedIn: Boolean get() = token != null
}

/** Sign-in methods the server is set up for (GET /auth/config). */
data class AuthConfig(val google: Boolean, val email: Boolean, val googleWebClientId: String?)

/**
 * Ocean Live accounts. Owners sign in once (Google or an email code); the server returns a session
 * token that is kept on the phone, so the app keeps working offline afterwards. Car data never goes
 * to the account.
 *
 * Accounts live on the same server as "Any questions?" ([Ask.url]); builds without it need no account.
 */
object Accounts {
    private val base: String = Ask.url.removeSuffix("/").removeSuffix("/ask")

    /** True when this build talks to the Ocean Live server, so signing in is required. */
    val required: Boolean get() = Ask.enabled

    private val _state = MutableStateFlow(AccountState())
    val state: StateFlow<AccountState> = _state.asStateFlow()

    val token: String? get() = _state.value.token

    fun init(context: Context) {
        val p = Settings.prefs(context)
        val token = p.getString("account_token", null) ?: return
        val account = p.getString("account_json", null)?.let { runCatching { AccountInfo.from(JSONObject(it)) }.getOrNull() }
        _state.value = AccountState(token, account)
    }

    private fun save(context: Context, state: AccountState) {
        _state.value = state
        Settings.prefs(context).edit {
            putString("account_token", state.token)
            putString("account_json", state.account?.toJson())
        }
    }

    /** The server no longer knows this session (signed out elsewhere, or the account was deleted). */
    fun sessionEnded(context: Context) = save(context, AccountState())

    sealed interface Result {
        data object Ok : Result
        data class Failed(@StringRes val message: Int) : Result
    }

    suspend fun config(): AuthConfig? {
        val r = call("GET", "/auth/config", null, null) ?: return null
        if (r.code != 200) return null
        // Android signs in with the web client ID; a server with only the iOS ID set has no Google for us.
        val webId = r.json.optString("googleWebClientId").takeIf { it.isNotEmpty() && !r.json.isNull("googleWebClientId") }
        return AuthConfig(
            google = r.json.optBoolean("google") && webId != null,
            email = r.json.optBoolean("email"),
            googleWebClientId = webId,
        )
    }

    /**
     * Shows Google's sign-in sheet ("Sign in with Google": every Google account on the phone, not only
     * ones that used Ocean Live before), then signs in with the ID token it returns. The token's
     * audience is the server's web client ID; the random nonce ties the token to this attempt.
     */
    suspend fun signInWithGoogle(activity: Activity, webClientId: String): Result {
        val nonce = newNonce()
        val idToken = try {
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce).build())
                .build()
            val credential = CredentialManager.create(activity).getCredential(activity, request).credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleIdTokenCredential.createFrom(credential.data).idToken
            } else {
                return Result.Failed(R.string.account_error_failed)
            }
        } catch (_: GetCredentialCancellationException) {
            return Result.Failed(R.string.account_cancelled)
        } catch (_: NoCredentialException) {
            return Result.Failed(R.string.account_error_no_google)
        } catch (e: GetCredentialException) {
            // A wrong SHA-1 or client ID in Google Cloud shows up here (type and message say which).
            Log.w("Accounts", "Google sign-in failed: ${e.type}: ${e.message}")
            return Result.Failed(R.string.account_error_failed)
        } catch (e: Exception) {
            // A malformed credential from Play services: GoogleIdTokenCredential parsing failed.
            Log.w("Accounts", "Google sign-in returned an unusable credential", e)
            return Result.Failed(R.string.account_error_failed)
        }
        return finish(
            activity,
            call("POST", "/auth/google", JSONObject().put("idToken", idToken).put("nonce", nonce).put("device", Ask.installId(activity)), null),
        )
    }

    private fun newNonce(): String {
        val bytes = ByteArray(24).also { SecureRandom().nextBytes(it) }
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    suspend fun emailStart(email: String): Result {
        val r = call("POST", "/auth/email/start", JSONObject().put("email", email.trim()), null)
            ?: return Result.Failed(R.string.account_error_network)
        return when {
            r.code == 200 -> Result.Ok
            r.error == "bad_email" -> Result.Failed(R.string.account_error_email)
            r.error == "rate_limited" -> Result.Failed(R.string.account_error_limit)
            else -> Result.Failed(R.string.account_error_failed)
        }
    }

    suspend fun emailVerify(context: Context, email: String, code: String): Result =
        finish(context, call("POST", "/auth/email/verify", JSONObject().put("email", email.trim()).put("code", code).put("device", Ask.installId(context)), null))

    private fun finish(context: Context, r: Response?): Result {
        if (r == null) return Result.Failed(R.string.account_error_network)
        if (r.code == 200 && r.json.has("token")) {
            save(context, AccountState(r.json.getString("token"), AccountInfo.from(r.json.getJSONObject("account"))))
            return Result.Ok
        }
        return Result.Failed(
            when (r.error) {
                "wrong_code" -> R.string.account_error_code
                "code_expired" -> R.string.account_error_expired
                "provider_unavailable" -> R.string.account_error_network
                else -> R.string.account_error_failed
            },
        )
    }

    /** Fetches the account again. Offline, the saved copy stays. */
    suspend fun refresh(context: Context) {
        val token = token ?: return
        val r = call("GET", "/account", null, token) ?: return
        if (r.code == 401) sessionEnded(context)
        else if (r.code == 200) save(context, AccountState(token, AccountInfo.from(r.json)))
    }

    suspend fun rename(context: Context, name: String): Result {
        val token = token ?: return Result.Failed(R.string.account_error_failed)
        val r = call("PATCH", "/account", JSONObject().put("name", name.trim()), token) ?: return Result.Failed(R.string.account_error_network)
        if (r.code == 401) { sessionEnded(context); return Result.Failed(R.string.account_error_failed) }
        if (r.code != 200) return Result.Failed(R.string.account_error_failed)
        save(context, AccountState(token, AccountInfo.from(r.json)))
        return Result.Ok
    }

    suspend fun signOut(context: Context) {
        token?.let { call("POST", "/auth/signout", JSONObject(), it) }
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
        sessionEnded(context)
    }

    /** Deletes the account on the server; signs out here only once the server confirms. */
    suspend fun delete(context: Context): Result {
        val token = token ?: return Result.Failed(R.string.account_error_failed)
        val r = call("DELETE", "/account", null, token) ?: return Result.Failed(R.string.account_error_network)
        if (r.code != 200 && r.code != 401) return Result.Failed(R.string.account_error_failed)
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
        sessionEnded(context)
        return Result.Ok
    }

    private class Response(val code: Int, val json: JSONObject) {
        val error: String? get() = json.optString("error").takeIf { it.isNotEmpty() }
    }

    /** Null when the server can't be reached. */
    private suspend fun call(method: String, path: String, body: JSONObject?, token: String?): Response? = withContext(Dispatchers.IO) {
        if (base.isEmpty()) return@withContext null
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(base + path).openConnection() as HttpURLConnection).apply {
                // HttpURLConnection has no PATCH; the server accepts the override header.
                requestMethod = if (method == "PATCH") "POST" else method
                if (method == "PATCH") setRequestProperty("X-HTTP-Method-Override", "PATCH")
                connectTimeout = 10_000
                readTimeout = 20_000
                setRequestProperty("Accept-Language", Locale.getDefault().toLanguageTag())
                token?.let { setRequestProperty("Authorization", "Bearer $it") }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            body?.let { b -> conn.outputStream.use { it.write(b.toString().toByteArray()) } }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            Response(code, runCatching { JSONObject(text) }.getOrDefault(JSONObject()))
        } catch (_: UnknownHostException) {
            null
        } catch (_: java.io.IOException) {
            null
        } finally {
            conn?.disconnect()
        }
    }
}
