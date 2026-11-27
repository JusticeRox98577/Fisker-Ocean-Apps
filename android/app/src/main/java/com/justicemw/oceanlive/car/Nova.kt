package com.justicemw.oceanlive.car

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.bouncycastle.math.ec.rfc8032.Ed25519
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * SuperNova remote commands from this phone (Oceanlive-nova docs/nrf.md).
 *
 * The phone has its own Ed25519 key. Pairing: the car screen shows a code; this phone sends its public
 * key with that code to hardware.oceanlive.org; the owner approves in the car; the car's nRF9151 keeps
 * the key. A command is signed here, carried by the server, and checked again by the car (this car, a
 * paired phone, never used before, at most 5 minutes old). The private key never leaves the phone.
 */
object NovaCommands {
    const val LOCK = 1
    const val UNLOCK = 2
    const val CLIMATE_ON = 3
    const val CLIMATE_OFF = 4
    const val LIGHTS = 5
    const val LIFE_S = 120L

    /** Counters only go up, across phones too: 4 per second since 2023-11-14 (fits until 2057). */
    fun counter(nowS: Long, last: Long): Long = maxOf(last + 1, (nowS - 1_700_000_000L) * 4)

    /** The 104-byte command (fw/lib/novacmd layout): body 40 bytes + Ed25519 signature. */
    fun build(seed: ByteArray, uid: ByteArray, slot: Int, action: Int, counter: Long, nowS: Long, arg: Int = 0): ByteArray {
        require(seed.size == 32 && uid.size == 12)
        val b = ByteArray(40)
        fun put32(o: Int, v: Long) { for (k in 0..3) b[o + k] = (v ushr (8 * k)).toByte() }
        put32(0, 0x4D43564EL)
        b[4] = 1
        b[5] = action.toByte()
        b[6] = arg.toByte(); b[7] = (arg ushr 8).toByte()
        uid.copyInto(b, 8)
        put32(20, counter)
        put32(24, nowS)
        put32(28, nowS + LIFE_S)
        b[32] = slot.toByte()
        val sig = ByteArray(64)
        Ed25519.sign(seed, 0, b, 0, b.size, sig, 0)
        return b + sig
    }

    fun publicKey(seed: ByteArray): ByteArray = ByteArray(32).also { Ed25519.generatePublicKey(seed, 0, it, 0) }

    /** Signature for GET /api/box/status: Ed25519 over "nova-status:<uid>:<t>". */
    fun statusSig(seed: ByteArray, uidHex: String, t: Long): ByteArray {
        val m = "nova-status:$uidHex:$t".toByteArray()
        return ByteArray(64).also { Ed25519.sign(seed, 0, m, 0, m.size, it, 0) }
    }

    fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    fun unhex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}

/** This phone's SuperNova pairing: the key (encrypted with an Android Keystore key), the car, the slot. */
class NovaPhone(private val context: Context) {
    private val prefs = context.getSharedPreferences("nova", Context.MODE_PRIVATE)

    val uid: String? get() = prefs.getString("uid", null)
    val slot: Int get() = prefs.getInt("slot", -1)
    val paired get() = uid != null && slot >= 0
    /** The code this phone sent and is waiting on (kept across launches, so a wait is never lost). */
    val pendingCode: String? get() = prefs.getString("pendingCode", null)

    /** An answer from the server that isn't 2xx. */
    class ServerError(val code: Int, message: String) : Exception(message)

    private fun aes(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return g.generateKey()
    }

    /** The phone's Ed25519 seed, made on first use. */
    @Synchronized
    fun seed(): ByteArray {
        prefs.getString("key", null)?.let { stored ->
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, aes(), GCMParameterSpec(128, raw, 0, 12))
            return c.doFinal(raw, 12, raw.size - 12)
        }
        val seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, aes())
        prefs.edit().putString("key", Base64.encodeToString(c.iv + c.doFinal(seed), Base64.NO_WRAP)).apply()
        return seed
    }

    /* ---- the server (blocking: call off the main thread) ---- */

    private fun call(path: String, body: JSONObject? = null): JSONObject {
        val c = URL(BASE + path).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000
        c.readTimeout = 15_000
        if (body != null) {
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val ok = c.responseCode in 200..299
        val j = JSONObject((if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "{}")
        if (!ok) throw ServerError(c.responseCode, j.optString("error", "HTTP ${c.responseCode}"))
        return j
    }

    /** Stop waiting on the code (the car screen can start a new one). */
    fun cancelPairing() = prefs.edit().remove("pendingCode").apply()

    /** Send this phone's key for the code on the car screen. */
    fun requestPairing(code: String) {
        val name = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(40)
        call("/api/box/pair/request", JSONObject().put("code", code.trim().uppercase().replace(" ", ""))
            .put("phonePub", NovaCommands.hex(NovaCommands.publicKey(seed()))).put("phoneName", name))
        prefs.edit().putString("pendingCode", code.trim().uppercase().replace(" ", "")).apply()
    }

    /** "waiting", "requested", "paired", "refused", "expired" or "none"; on "paired" the car and slot are kept. */
    fun pairingStatus(): String {
        val code = pendingCode ?: return if (paired) "paired" else "none"
        val j = try {
            call("/api/box/pair/status?code=$code")
        } catch (e: ServerError) {
            if (e.code != 404) throw e
            cancelPairing()
            return "expired"
        }
        val st = j.getString("status")
        if (st == "paired") {
            prefs.edit().putString("uid", j.getString("uid")).putInt("slot", j.getInt("slot")).remove("pendingCode").apply()
        } else if (st == "refused") {
            prefs.edit().remove("pendingCode").apply()
        }
        return st
    }

    fun send(action: Int) {
        val u = uid ?: throw IllegalStateException("not paired")
        val now = System.currentTimeMillis() / 1000
        val counter = NovaCommands.counter(now, prefs.getLong("counter", 0))
        prefs.edit().putLong("counter", counter).apply()
        val cmd = NovaCommands.build(seed(), NovaCommands.unhex(u), slot, action, counter, now)
        call("/api/box/command", JSONObject().put("uid", u).put("cmd", NovaCommands.hex(cmd)))
    }

    /** The car's last check-in (GET /api/box/status) and the latest commands from any paired phone. */
    data class Status(
        val lastSeen: Long, val v12mV: Int, val ignition: Boolean,
        /** enum nova_gear: 0 unknown, 1 P, 2 R, 3 N, 4 D. */
        val gear: Int, val speedKmh: Double, val lat: Double?, val lon: Double?,
        val rsrp: Int, val phones: Int, val firmware: Int, val commands: List<Command>,
    ) {
        /** [result] is null while the car hasn't acted on it yet; 0 done; otherwise why it refused. */
        data class Command(val action: Int, val counter: Long, val sent: Long, val result: Int?)

        val lastResult get() = commands.firstOrNull()?.result
        /** Checked in within the last 3 minutes (it checks in every minute or so while it has signal). */
        fun online(now: Long = System.currentTimeMillis()) = lastSeen > 0 && now - lastSeen < 180_000

        companion object {
            fun parse(j: JSONObject): Status {
                val b = j.optJSONObject("box")
                fun int(k: String) = b?.optInt(k) ?: 0
                fun dbl(k: String) = b?.takeIf { !it.isNull(k) && it.has(k) }?.optDouble(k)
                val cmds = j.optJSONArray("commands")
                val commands = (0 until (cmds?.length() ?: 0)).mapNotNull { i ->
                    val c = cmds!!.optJSONObject(i) ?: return@mapNotNull null
                    Command(c.optInt("action"), c.optLong("counter"), c.optLong("created_at"),
                        if (c.isNull("result") || !c.has("result")) null else c.optInt("result"))
                }
                val lat = dbl("lat")
                val lon = dbl("lon")
                val located = lat != null && lon != null && (lat != 0.0 || lon != 0.0)
                return Status(
                    b?.optLong("last_seen") ?: 0, int("v12"), int("ignition") != 0, int("gear"), int("speed") / 100.0,
                    if (located) lat else null, if (located) lon else null,
                    int("rsrp"), int("phones"), int("fw"), commands,
                )
            }
        }
    }

    fun status(): Status {
        val u = uid ?: throw IllegalStateException("not paired")
        val t = System.currentTimeMillis() / 1000
        val sig = NovaCommands.hex(NovaCommands.statusSig(seed(), u, t))
        return Status.parse(call("/api/box/status?uid=$u&slot=$slot&t=$t&sig=$sig"))
    }

    fun forget() = prefs.edit().remove("uid").remove("slot").remove("pendingCode").apply()

    companion object {
        const val BASE = "https://hardware.oceanlive.org"
        private const val ALIAS = "nova_phone_key"
    }
}
