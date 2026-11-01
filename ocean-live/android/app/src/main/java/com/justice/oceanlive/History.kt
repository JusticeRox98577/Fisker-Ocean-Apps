package com.justice.oceanlive

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

data class HistoryEntry(
    val kind: String, // "drive" or "charge"
    val startTime: Long,
    val endTime: Long,
    val startSoc: Double,
    val endSoc: Double,
    val distanceMeters: Double,
    val kWh: Double
)

/** Saves finished trips and charging sessions so the person can look back at them later. */
object History {
    private const val KEY = "historyEntries"
    private const val MAX_ENTRIES = 500

    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("ocean_history", Context.MODE_PRIVATE)
    }

    fun all(): List<HistoryEntry> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                HistoryEntry(
                    kind = o.optString("kind", "drive"),
                    startTime = o.optLong("startTime"),
                    endTime = o.optLong("endTime"),
                    startSoc = o.optDouble("startSoc", 0.0),
                    endSoc = o.optDouble("endSoc", 0.0),
                    distanceMeters = o.optDouble("distanceMeters", 0.0),
                    kWh = o.optDouble("kWh", 0.0)
                )
            }.sortedByDescending { it.startTime }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun add(entry: HistoryEntry) {
        if (entry.startTime <= 0 || entry.endTime <= entry.startTime) return
        val list = all().toMutableList()
        list.add(0, entry)
        val trimmed = if (list.size > MAX_ENTRIES) list.take(MAX_ENTRIES) else list
        save(trimmed)
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    private fun save(list: List<HistoryEntry>) {
        val arr = JSONArray()
        for (e in list) {
            val o = JSONObject()
            o.put("kind", e.kind)
            o.put("startTime", e.startTime)
            o.put("endTime", e.endTime)
            o.put("startSoc", e.startSoc)
            o.put("endSoc", e.endSoc)
            o.put("distanceMeters", e.distanceMeters)
            o.put("kWh", e.kWh)
            arr.put(o)
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun toCsv(entries: List<HistoryEntry>): String {
        val sb = StringBuilder()
        sb.append("type,start,end,start_percent,end_percent,miles,kwh\n")
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.US)
        for (e in entries) {
            val miles = e.distanceMeters / 1609.34
            sb.append(e.kind).append(',')
            sb.append(fmt.format(java.util.Date(e.startTime))).append(',')
            sb.append(fmt.format(java.util.Date(e.endTime))).append(',')
            sb.append(String.format(java.util.Locale.US, "%.1f", e.startSoc)).append(',')
            sb.append(String.format(java.util.Locale.US, "%.1f", e.endSoc)).append(',')
            sb.append(String.format(java.util.Locale.US, "%.1f", miles)).append(',')
            sb.append(String.format(java.util.Locale.US, "%.2f", e.kWh)).append('\n')
        }
        return sb.toString()
    }
}
