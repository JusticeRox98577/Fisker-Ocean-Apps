package com.justicemw.oceanlive.car

import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.Strings
import android.location.Location
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException

/**
 * Sends live data to A Better Route Planner's generic telemetry API. Only runs
 * when the user has entered both their ABRP token and a telemetry API key.
 */
object Abrp {
    private const val ENDPOINT = "https://api.iternio.com/1/tlm/send"

    fun telemetry(s: Snapshot, mode: Mode, fast: Boolean, settings: Settings, location: Location?): JSONObject {
        val tlm = JSONObject()
        tlm.put("utc", s.time / 1000)
        s.soc?.let { tlm.put("soc", round(it, 1)) }
        // ABRP wants power and current positive while using energy.
        s.powerKw?.let { tlm.put("power", round(-it, 2)) }
        s.packA?.let { tlm.put("current", round(-it, 1)) }
        s.packV?.let { tlm.put("voltage", round(it, 1)) }
        s.tempAvg?.let { tlm.put("batt_temp", round(it, 1)) }
        s.odometerKm?.let { tlm.put("odometer", round(it, 1)) }
        tlm.put("is_charging", if (mode == Mode.Charging) 1 else 0)
        if (mode == Mode.Charging) tlm.put("is_dcfc", if (fast) 1 else 0)
        tlm.put("is_parked", if (mode == Mode.Driving) 0 else 1)
        if (settings.usableKwh > 0) tlm.put("capacity", settings.usableKwh)
        if (location != null && System.currentTimeMillis() - location.time < 120_000) {
            tlm.put("lat", location.latitude)
            tlm.put("lon", location.longitude)
            if (location.hasAltitude()) tlm.put("elevation", round(location.altitude, 0))
            if (location.hasSpeed()) tlm.put("speed", round(location.speed * 3.6, 1))
        }
        return tlm
    }

    /** Returns null on success or a short message for the UI. */
    suspend fun send(tlm: JSONObject, settings: Settings, s: Strings): String? = withContext(Dispatchers.IO) {
        val query = "token=" + enc(settings.abrpToken.trim()) + "&api_key=" + enc(settings.abrpKey.trim())
        val body = "tlm=" + enc(tlm.toString())
        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$ENDPOINT?$query").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8_000
                readTimeout = 8_000
                doOutput = true
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            when {
                code == 401 || code == 403 -> s.get(R.string.abrp_rejected)
                code !in 200..299 -> s.get(R.string.abrp_error, code)
                text.contains("\"status\": \"ok\"") || text.contains("\"status\":\"ok\"") -> null
                else -> JSONObject(text).optString("error").ifBlank { s.get(R.string.abrp_not_accepted) }
            }
        } catch (_: UnknownHostException) {
            s.get(R.string.abrp_no_internet)
        } catch (e: Exception) {
            e.message ?: s.get(R.string.abrp_unreachable)
        } finally {
            conn?.disconnect()
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun round(v: Double, d: Int): Double {
        var f = 1.0
        repeat(d) { f *= 10 }
        return Math.round(v * f) / f
    }
}
