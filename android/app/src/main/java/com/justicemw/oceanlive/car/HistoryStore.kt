package com.justicemw.oceanlive.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Drives and charging sessions, kept in a JSON file in the app's private storage. */
class HistoryStore(context: Context) {
    private val file = File(context.filesDir, "history.json")

    fun load(): List<HistoryEntry> = try {
        if (!file.exists()) emptyList() else {
            val array = JSONArray(file.readText())
            (0 until array.length()).mapNotNull { fromJson(array.getJSONObject(it)) }
        }
    } catch (_: Exception) {
        emptyList()
    }

    fun save(entries: List<HistoryEntry>) {
        val array = JSONArray()
        entries.takeLast(MAX).forEach { array.put(toJson(it)) }
        val tmp = File(file.parentFile, "history.json.tmp")
        tmp.writeText(array.toString())
        tmp.renameTo(file)
    }

    private fun toJson(e: HistoryEntry) = JSONObject().apply {
        put("kind", e.kind.name)
        put("start", e.start)
        put("end", e.end)
        e.socStart?.let { put("socStart", it) }
        e.socEnd?.let { put("socEnd", it) }
        put("kwh", e.kwh)
        e.distanceKm?.let { put("km", it) }
        e.peakKw?.let { put("peakKw", it) }
        put("fast", e.fast)
    }

    private fun fromJson(o: JSONObject): HistoryEntry? = try {
        HistoryEntry(
            kind = EntryKind.valueOf(o.getString("kind")),
            start = o.getLong("start"),
            end = o.getLong("end"),
            socStart = o.optDoubleOrNull("socStart"),
            socEnd = o.optDoubleOrNull("socEnd"),
            kwh = o.getDouble("kwh"),
            distanceKm = o.optDoubleOrNull("km"),
            peakKw = o.optDoubleOrNull("peakKw"),
            fast = o.optBoolean("fast", false),
        )
    } catch (_: Exception) {
        null
    }

    private fun JSONObject.optDoubleOrNull(key: String): Double? = if (has(key)) getDouble(key) else null

    companion object {
        const val MAX = 1000

        fun csv(entries: List<HistoryEntry>): String {
            val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
            fun n(v: Double?, d: Int = 1) = v?.let { String.format(Locale.US, "%.${d}f", it) } ?: ""
            return buildString {
                append("type,start,end,minutes,soc_start,soc_end,kwh,distance_km,wh_per_km,peak_kw,dc_fast\n")
                for (e in entries) {
                    append(listOf(
                        e.kind.name.lowercase(), fmt.format(Date(e.start)), fmt.format(Date(e.end)), e.minutes.toString(),
                        n(e.socStart), n(e.socEnd), n(e.kwh, 2), n(e.distanceKm, 2), n(e.whPerKm, 0), n(e.peakKw),
                        if (e.kind == EntryKind.Charge) e.fast.toString() else "",
                    ).joinToString(","))
                    append('\n')
                }
            }
        }
    }
}
