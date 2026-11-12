package com.justicemw.oceanlive.car

import android.content.Context
import com.justicemw.oceanlive.obd.Dtc
import com.justicemw.oceanlive.obd.DtcState
import com.justicemw.oceanlive.obd.Dtcs
import com.justicemw.oceanlive.obd.Ecu
import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.MiniJson
import java.io.File

/** One code as it was saved: the module's short code (e.g. "BMS"), the DTC and its status byte. */
data class SavedCode(val module: String, val code: String, val status: Int) {
    val key: String get() = FaultHistory.key(module, code)
    val state: DtcState get() = Dtcs.state(status)
    val ecu: Ecu get() = FaultHistory.ecu(module)
    fun toDtc(): Dtc = Dtc(code, status, ecu)
}

/** A finished fault scan, as kept in the scan history. */
data class SavedScan(
    val time: Long,
    val vin: String?,
    /** Module code to what happened: "ok", "no answer", "incomplete", ... */
    val modules: Map<String, String>,
    val codes: List<SavedCode>,
) {
    val active: Int get() = codes.count { it.state == DtcState.Active }
    val stored: Int get() = codes.size - active

    /** True if this module gave a usable list of codes in this scan. */
    fun answered(module: String): Boolean = modules[module] == "ok" || modules[module] == "incomplete"
}

/** What changed between two scans of the same car. */
data class ScanDiff(
    /** Keys ([FaultHistory.key]) of codes that weren't there last time. */
    val newKeys: Set<String> = emptySet(),
    /** Codes from last time that are gone now. */
    val cleared: List<SavedCode> = emptyList(),
    /** When the scan we compared with was made, or null if there was none. */
    val previousTime: Long? = null,
)

/** Pure logic for the fault scan history: saving, loading and comparing scans. */
object FaultHistory {
    const val MAX = 50

    fun key(module: String, code: String) = "$module:$code"
    fun key(d: Dtc) = key(d.ecu.code, d.code)

    fun ecu(module: String): Ecu = Ecus.scanList.firstOrNull { it.code == module } ?: Ecu(module, module, "", "")

    fun snapshot(time: Long, vin: String?, modules: Map<String, String>, codes: List<Dtc>) =
        SavedScan(time, vin, modules, codes.map { SavedCode(it.ecu.code, it.code, it.status) })

    /** The scan to compare [current] with: the latest earlier one of the same car (or any car if a VIN is missing). */
    fun previous(history: List<SavedScan>, current: SavedScan): SavedScan? =
        history.lastOrNull { it.time < current.time && (it.vin == null || current.vin == null || it.vin == current.vin) }

    /**
     * Compares two scans. Only modules that answered both times are compared, so a module
     * that stayed silent never makes its codes look new or cleared.
     */
    fun diff(previous: SavedScan?, current: SavedScan): ScanDiff {
        if (previous == null) return ScanDiff()
        val before = previous.codes.associateBy { it.key }
        val now = current.codes.associateBy { it.key }
        val newKeys = current.codes
            .filter { it.key !in before && previous.answered(it.module) }
            .map { it.key }.toSet()
        // An incomplete list now can't prove a code is gone.
        val cleared = previous.codes.filter { it.key !in now && current.modules[it.module] == "ok" }
        return ScanDiff(newKeys, cleared, previous.time)
    }

    /** Adds a scan and keeps only the latest [MAX]. */
    fun append(history: List<SavedScan>, scan: SavedScan): List<SavedScan> =
        (history + scan).sortedBy { it.time }.takeLast(MAX)

    fun toJson(scans: List<SavedScan>): String = MiniJson.write(scans.map { s ->
        linkedMapOf(
            "time" to s.time,
            "vin" to s.vin,
            "modules" to s.modules,
            "codes" to s.codes.map { linkedMapOf("module" to it.module, "code" to it.code, "status" to it.status) },
        )
    })

    fun fromJson(text: String): List<SavedScan> {
        val array = MiniJson.parse(text) as? List<*> ?: return emptyList()
        return array.mapNotNull { item ->
            val o = item as? Map<*, *> ?: return@mapNotNull null
            val time = (o["time"] as? Number)?.toLong() ?: return@mapNotNull null
            val modules = (o["modules"] as? Map<*, *>)?.entries
                ?.mapNotNull { (k, v) -> if (k is String && v is String) k to v else null }?.toMap() ?: emptyMap()
            val codes = (o["codes"] as? List<*>)?.mapNotNull { c ->
                val m = c as? Map<*, *> ?: return@mapNotNull null
                val module = m["module"] as? String ?: return@mapNotNull null
                val code = m["code"] as? String ?: return@mapNotNull null
                val status = (m["status"] as? Number)?.toInt() ?: return@mapNotNull null
                SavedCode(module, code, status)
            } ?: emptyList()
            SavedScan(time, o["vin"] as? String, modules, codes)
        }.sortedBy { it.time }.takeLast(MAX)
    }
}

/** Finished fault scans, kept in a JSON file in the app's private storage. */
class FaultHistoryStore(context: Context) {
    private val file = File(context.filesDir, "fault-scans.json")

    fun load(): List<SavedScan> = try {
        if (file.exists()) FaultHistory.fromJson(file.readText()) else emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    fun save(scans: List<SavedScan>) {
        val tmp = File(file.parentFile, "fault-scans.json.tmp")
        tmp.writeText(FaultHistory.toJson(scans.takeLast(FaultHistory.MAX)))
        tmp.renameTo(file)
    }
}
