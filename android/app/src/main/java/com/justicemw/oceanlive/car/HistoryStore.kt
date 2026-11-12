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
        if (!file.exists()) emptyList() else decode(file.readText())
    } catch (_: Exception) {
        emptyList()
    }

    fun save(entries: List<HistoryEntry>) {
        val tmp = File(file.parentFile, "history.json.tmp")
        tmp.writeText(encode(entries))
        tmp.renameTo(file)
    }

    companion object {
        const val MAX = 1000

        /** The latest [MAX] entries as JSON. Only the latest charges keep their samples. */
        fun encode(entries: List<HistoryEntry>): String {
            val array = JSONArray()
            ChargeCurve.trim(entries.takeLast(MAX)).forEach { array.put(toJson(it)) }
            return array.toString()
        }

        /** Entries from JSON. Files from older versions, without regen or samples, load too. */
        fun decode(text: String): List<HistoryEntry> {
            val array = JSONArray(text)
            return (0 until array.length()).mapNotNull { fromJson(array.getJSONObject(it)) }
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
            e.regenKwh?.let { put("regenKwh", it) }
            e.samples?.let { put("samples", encodeSamples(e.start, it)) }
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
                regenKwh = o.optDoubleOrNull("regenKwh"),
                samples = o.optJSONArray("samples")?.let { decodeSamples(o.getLong("start"), it) },
            )
        } catch (_: Exception) {
            null
        }

        private fun JSONObject.optDoubleOrNull(key: String): Double? = if (has(key) && !isNull(key)) getDouble(key) else null

        /**
         * Samples as compact rows: [seconds from start, charge %, kW, battery °C].
         * A missing charge % or temperature is written as null.
         */
        private fun encodeSamples(start: Long, samples: List<ChargeSample>): JSONArray {
            fun r(v: Double, scale: Double) = Math.round(v * scale) / scale
            val array = JSONArray()
            for (s in samples) {
                array.put(JSONArray().apply {
                    put((s.time - start) / 1000)
                    put(s.soc?.let { r(it, 10.0) } ?: JSONObject.NULL)
                    put(r(s.kw, 100.0))
                    put(s.tempC?.let { r(it, 10.0) } ?: JSONObject.NULL)
                })
            }
            return array
        }

        /** Unreadable samples are dropped; the charge itself still loads. */
        private fun decodeSamples(start: Long, array: JSONArray): List<ChargeSample>? = try {
            (0 until array.length()).map { i ->
                val row = array.getJSONArray(i)
                ChargeSample(
                    time = start + row.getLong(0) * 1000,
                    soc = if (row.isNull(1)) null else row.getDouble(1),
                    kw = row.getDouble(2),
                    tempC = if (row.length() < 4 || row.isNull(3)) null else row.getDouble(3),
                )
            }.takeIf { it.size >= 2 }
        } catch (_: Exception) {
            null
        }

        /** CSV of [entries]. The cost column uses today's prices from [settings]. */
        fun csv(entries: List<HistoryEntry>, settings: Settings = Settings()): String {
            val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
            fun n(v: Double?, d: Int = 1) = v?.let { String.format(Locale.US, "%.${d}f", it) } ?: ""
            return buildString {
                append("type,start,end,minutes,soc_start,soc_end,kwh,distance_km,wh_per_km,peak_kw,dc_fast,cost\n")
                for (e in entries) {
                    append(listOf(
                        e.kind.name.lowercase(), fmt.format(Date(e.start)), fmt.format(Date(e.end)), e.minutes.toString(),
                        n(e.socStart), n(e.socEnd), n(e.kwh, 2), n(e.distanceKm, 2), n(e.whPerKm, 0), n(e.peakKw),
                        if (e.kind == EntryKind.Charge) e.fast.toString() else "",
                        n(settings.chargeCost(e), 2),
                    ).joinToString(","))
                    append('\n')
                }
            }
        }
    }
}
