package com.justicemw.oceanlive.obd

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R

enum class DescriptionSource(@StringRes val label: Int) {
    Imported(R.string.source_yours),
    Ocean(R.string.source_ocean),
    Sae(R.string.source_sae),
    Derived(R.string.source_derived),
}

enum class DtcSeverity(@StringRes val label: Int) { Info(R.string.severity_minor), Warning(R.string.severity_warning), Critical(R.string.severity_critical) }

/**
 * What a fault code means, in plain words. [note] is extra context such as "usually harmless".
 * Imported lists can add [impact], possible [causes] and repair [steps].
 */
data class DtcInfo(
    val title: String,
    val source: DescriptionSource,
    val note: String? = null,
    @StringRes val from: Int? = null,
    val severity: DtcSeverity? = null,
    val module: String? = null,
    val impact: String? = null,
    val causes: List<String> = emptyList(),
    val steps: List<String> = emptyList(),
) {
    /** Where the description came from, as a string resource. */
    @get:StringRes
    val sourceLabel: Int get() = from ?: source.label
    val hasDetails: Boolean get() = impact != null || causes.isNotEmpty() || steps.isNotEmpty()
}

/**
 * One imported description. [rank] decides which list wins when two describe the same code:
 * 4 your own list, 3 Fisker service guide, 2 Fisker ODX data, 1 community table.
 */
data class DtcDetail(
    val title: String? = null,
    val module: String? = null,
    val severity: DtcSeverity? = null,
    val impact: String? = null,
    val causes: List<String> = emptyList(),
    val steps: List<String> = emptyList(),
    val rank: Int = RANK_USER,
) {
    val isEmpty: Boolean get() = title == null && impact == null && causes.isEmpty() && steps.isEmpty()

    companion object {
        const val RANK_USER = 4
        @StringRes
        fun rankLabel(rank: Int): Int = when (rank) {
            3 -> R.string.source_service_guide
            2 -> R.string.source_diagnostic_data
            1 -> R.string.source_community
            else -> R.string.source_yours
        }
    }
}

/**
 * Turns fault codes into descriptions. Lookup order:
 * 1. a description list the user imported,
 * 2. Ocean-specific codes documented from real cars,
 * 3. SAE J2012 standard codes (the first five characters),
 * 4. a description built from the code's structure: system, reporting module and failure type.
 */
object DtcCatalog {
    @Volatile private var imported: Map<String, DtcDetail> = emptyMap()

    val importedCount: Int get() = imported.size

    fun setImported(map: Map<String, DtcDetail>) {
        imported = map.mapKeys { it.key.trim().uppercase() }.filterValues { !it.isEmpty }
    }

    fun describe(code: String, ecu: Ecu?): DtcInfo {
        val c = code.uppercase()
        val base = builtIn(c, ecu)
        imported[c]?.let { return withDetail(base, it, it.title) }
        imported[c.take(5)]?.let { return withDetail(base, it, it.title?.let { t -> withType(t, c) }) }
        return base
    }

    private fun builtIn(c: String, ecu: Ecu?): DtcInfo {
        OCEAN[c]?.let { return it }
        SAE[c.take(5)]?.let { return DtcInfo(withType(it, c), DescriptionSource.Sae) }
        return DtcInfo(derive(c, ecu), DescriptionSource.Derived)
    }

    private fun withDetail(base: DtcInfo, d: DtcDetail, title: String?): DtcInfo = base.copy(
        title = title ?: base.title,
        source = if (title != null) DescriptionSource.Imported else base.source,
        from = if (title != null) DtcDetail.rankLabel(d.rank) else null,
        severity = d.severity,
        module = d.module,
        impact = d.impact,
        causes = d.causes,
        steps = d.steps,
    )

    /** Codes some modules send in place of "no fault". Never real. */
    val placeholders = setOf("B2AAAAA", "U3FFFFF", "U17A100")

    private fun withType(text: String, code: String): String {
        val type = Dtcs.failureType(code) ?: return text
        return "$text ($type)"
    }

    private fun derive(code: String, ecu: Ecu?): String {
        val module = ecu?.name ?: "A module"
        val type = Dtcs.failureType(code)
        val system = when (code.firstOrNull()) {
            'P' -> "Powertrain"
            'C' -> "Chassis"
            'B' -> "Body"
            else -> "Network"
        }
        if (code.startsWith("U")) {
            val ftb = code.drop(5)
            return when (ftb) {
                "87" -> "$module is missing messages from another module (lost communication)"
                "88" -> "$module reports the data bus went offline (bus off)"
                "81", "86" -> "$module received invalid data from another module"
                "82", "83", "62", "F1" -> "$module received a message that failed its integrity check"
                else -> "Communication fault in $module" + (type?.let { ": $it" } ?: "")
            }
        }
        return "$system fault in $module" + (type?.let { ": $it" } ?: "")
    }

    // ── Importing ───────────────────────────────────────────────

    private val CODE = Regex("^[PCBU][0-3][0-9A-F]{3}([0-9A-F]{2})?$")

    /**
     * Fixes codes damaged by OCR in scanned manuals: a leading 8 for B, and O, I or T for 0, 1, 1
     * after the first character. Returns null when the result still isn't a valid code.
     */
    fun normalizeCode(raw: String): String? {
        val k = raw.trim().uppercase()
        if (k.length != 5 && k.length != 7) return null
        val first = if (k[0] == '8') 'B' else k[0]
        val rest = k.substring(1).map {
            when (it) {
                'O' -> '0'
                'I', 'T', 'L' -> '1'
                else -> it
            }
        }.joinToString("")
        val code = first + rest
        return code.takeIf { CODE.matches(it) }
    }

    /**
     * Reads an imported list. Accepts:
     * - JSON {"CODE": "text"} or {"CODE": {"name": ..., "repairSteps": [...], ...}},
     *   optionally wrapped as {"dtcLabels": {...}} (the format Fisker DTC tables are shared in),
     * - CSV lines "CODE,text".
     */
    fun parseImport(text: String): Map<String, DtcDetail> {
        val trimmed = text.trim().trimStart(0xFEFF.toChar()) // byte-order mark some editors add
        return if (trimmed.startsWith("{")) parseJson(trimmed) else parseCsv(trimmed)
    }

    private fun parseCsv(text: String): Map<String, DtcDetail> {
        val out = linkedMapOf<String, DtcDetail>()
        for (line in text.lines()) {
            val parts = line.split(',', ';', '\t', limit = 2)
            if (parts.size < 2) continue
            val code = normalizeCode(parts[0].trim().trim('"')) ?: continue
            val title = cleanTitle(parts[1].trim().trim('"'), code) ?: continue
            out[code] = DtcDetail(title = title)
        }
        return out
    }

    private fun parseJson(text: String): Map<String, DtcDetail> {
        val root = MiniJson.parse(text) as? Map<*, *> ?: return emptyMap()
        val table = (root["dtcLabels"] ?: root["codes"]) as? Map<*, *> ?: root
        val out = linkedMapOf<String, DtcDetail>()
        val repaired = mutableListOf<Pair<String, DtcDetail>>()
        for ((key, v) in table) {
            val raw = key.toString()
            val code = normalizeCode(raw) ?: continue
            val detail = when (v) {
                is String -> cleanTitle(v, code)?.let { DtcDetail(title = it) }
                is Map<*, *> -> detailFrom(v, code)
                else -> null
            } ?: continue
            // A clean key beats one repaired from OCR damage.
            if (code == raw.trim().uppercase()) out[code] = merge(out[code], detail) else repaired += code to detail
        }
        for ((code, d) in repaired) if (code !in out) out[code] = d
        return out
    }

    private fun detailFrom(v: Map<*, *>, code: String): DtcDetail? {
        fun str(k: String) = v[k] as? String
        fun list(k: String) = (v[k] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
        val title = listOf("name", "description", "title", "label").firstNotNullOfOrNull { k -> str(k)?.let { cleanTitle(it, code) } }
        val rank = (v["rank"] as? Number)?.toInt() ?: when (str("source")) {
            "fisker-service-tsg" -> 3
            "odx-fast" -> 2
            "community-fisker-dtc" -> 1
            else -> DtcDetail.RANK_USER
        }
        var steps = cleanSteps(list("repairSteps") + list("steps"))
        if (steps.isEmpty()) steps = cleanSteps(listOfNotNull(str("oneLineFix")))
        val d = DtcDetail(
            title = title,
            module = str("ecu")?.trim()?.takeIf { it.isNotEmpty() && !isJunk(it) },
            severity = when (str("severity")?.lowercase()) {
                "critical" -> DtcSeverity.Critical
                "warning" -> DtcSeverity.Warning
                "info" -> DtcSeverity.Info
                else -> null
            },
            impact = str("impact")?.let { clean(it) },
            causes = cleanList(list("rootCauses") + list("causes")),
            steps = steps,
            rank = rank,
        )
        return d.takeUnless { it.isEmpty }
    }

    /** Combines two descriptions of one code: the higher-ranked list wins each field, the other fills gaps. */
    fun merge(a: DtcDetail?, b: DtcDetail): DtcDetail {
        if (a == null) return b
        val (hi, lo) = if (b.rank >= a.rank) b to a else a to b
        return DtcDetail(
            title = hi.title ?: lo.title,
            module = hi.module ?: lo.module,
            severity = hi.severity ?: lo.severity,
            impact = hi.impact ?: lo.impact,
            causes = hi.causes.ifEmpty { lo.causes },
            steps = hi.steps.ifEmpty { lo.steps },
            rank = hi.rank,
        )
    }

    fun mergeAll(old: Map<String, DtcDetail>, new: Map<String, DtcDetail>): Map<String, DtcDetail> {
        val out = LinkedHashMap(old)
        for ((k, v) in new) out[k] = merge(out[k], v)
        return out
    }

    /** The saved form of an imported list; [parseImport] reads it back. */
    fun toJson(map: Map<String, DtcDetail>): String = MiniJson.write(mapOf("dtcLabels" to map.mapValues { (_, d) ->
        buildMap {
            d.title?.let { put("name", it) }
            d.module?.let { put("ecu", it) }
            d.severity?.let { put("severity", it.name.lowercase()) }
            d.impact?.let { put("impact", it) }
            if (d.causes.isNotEmpty()) put("rootCauses", d.causes)
            if (d.steps.isNotEmpty()) put("repairSteps", d.steps)
            put("rank", d.rank)
        }
    }))

    // ── Cleaning up scraped and OCR'd text ──────────────────────

    private val JUNK = setOf("nan", "ran", "na", "n/a", "tbd", "0", "#name?", "-", "none", "not_supported", "not supported", "case", "and")
    private const val ACCESSORY_NOTE = "Note: Ensure the customer has not installed"
    private val BOILERPLATE = listOf("Reference Connector End View", "Ensure the customer has not installed", "EC-1 Ignition Status")

    private fun isJunk(s: String) = s.trim().lowercase() in JUNK

    /** Tidies one string, or returns null when nothing useful is left. */
    fun clean(raw: String): String? {
        var s = raw
        val note = s.indexOf(ACCESSORY_NOTE, ignoreCase = true)
        if (note >= 0) s = s.substring(0, note)
        s = s.replace(Regex("(?<=[a-z])(\\?{2,3}|\\?€\\?)(?=[a-z])"), "'")
            .replace(Regex("\\?{3}|\\?€\\?|Â|»i"), " ")
            .replace(Regex("_?\\[command]"), "")
            .replace(Regex("_\\d+$"), "") // "…disabled_12" numbering left by a spreadsheet export
            .replace(Regex("\\s+"), " ")
            .trim()
            .trimStart(')', '.', '-', ' ', ',')
            .replace(Regex("^(nan|tbd|ran)\\b\\s*", RegexOption.IGNORE_CASE), "")
            .trim()
        if (s.length < 3 || isJunk(s)) return null
        if (BOILERPLATE.any { s.startsWith(it, ignoreCase = true) || (it.startsWith("EC-1") && s.contains(it)) }) return null
        return s.replaceFirstChar { it.uppercase() }
    }

    private fun cleanList(items: List<String>): List<String> = items.mapNotNull { clean(it) }.distinct()

    private fun cleanSteps(items: List<String>): List<String> = cleanList(items).filter { it.length >= 5 }

    private val ABBREV = mapOf(
        "OOR" to "out of range", "VOLT" to "voltage", "TEMP" to "temperature", "CURR" to "current",
        "DEVN" to "deviation", "FLT" to "fault", "ERR" to "error", "SFTY" to "safety", "COM" to "communication",
        "HW" to "hardware", "SW" to "software", "NOK" to "not OK", "ERATC" to "erratic",
    )

    private val ACRONYMS = setOf(
        "CAN", "LIN", "ECU", "MCU", "VCU", "BMS", "BCM", "ACU", "ESP", "EPS", "ICC", "PDU", "OBC", "DCDC", "HV", "LV", "AC", "DC",
        "PWM", "NVM", "RAM", "ROM", "SRAM", "SBC", "RPS", "BLDC", "ADAS", "SECOC", "CRC", "OS", "MPU", "SMU", "DTS", "TBOX", "GW",
        "AGS", "EWP", "EXV", "CFM", "PTC", "WTC", "IGBT", "PCB", "NTC", "LED", "AEB", "APB", "WSS", "ASIC", "CDD", "PLD", "ED", "PN2", "PN3",
    )

    /** Makes a readable title: drops a repeated code prefix and turns names like DTC_SYS_VOLTAGE_LOW into words. */
    fun cleanTitle(raw: String, code: String): String? {
        var s = raw.trim()
        if (s.startsWith(code, ignoreCase = true)) s = s.substring(code.length)
        s = clean(s) ?: return null
        if (s.contains('_') && !s.contains(' ') || Regex("^DTC_[A-Z0-9_]+$").matches(s)) {
            val words = s.removePrefix("DTC_").split('_').filter { it.isNotEmpty() }
            s = words.joinToString(" ") { w ->
                val u = w.uppercase()
                ABBREV[u] ?: if (u in ACRONYMS || w.any { it.isDigit() }) u else w.lowercase()
            }
            s = s.replaceFirstChar { it.uppercase() }
        }
        return s.takeIf { it.length >= 3 && !isJunk(it) }
    }

    private const val OLOOP_NOTE =
        "Common on cars running the O-Loop / ovloop 2.2.3+ software, where it is usually a side effect of the update rather than a real fault."

    /** Ocean codes whose meaning has been confirmed from the manufacturer's own fault text or real cars. */
    private val OCEAN: Map<String, DtcInfo> = mapOf(
        "U15AD87" to DtcInfo("Lost communication with the power steering module", DescriptionSource.Ocean),
        "U1613F1" to DtcInfo("End-to-end message check failed (a module received a message that failed its integrity check)", DescriptionSource.Ocean),
        "U199701" to DtcInfo("Lost communication with HV coolant heater H", DescriptionSource.Ocean, "Cabin heating may not work."),
        "U199702" to DtcInfo("Lost communication with HV coolant heater B", DescriptionSource.Ocean, "The high-voltage battery heater may not work."),
        "U201162" to DtcInfo("Communication verification failure", DescriptionSource.Ocean),
        "U201262" to DtcInfo("Communication verification failure", DescriptionSource.Ocean),
        "B20FE16" to DtcInfo("Trailer module supply voltage below threshold", DescriptionSource.Ocean, "Trailer lamps may not light up fully."),
        "B208896" to DtcInfo("Overhead console touch controller not responding (component internal failure)", DescriptionSource.Ocean),
        "B178854" to DtcInfo("Module not coded (configuration missing)", DescriptionSource.Ocean),
        "C21A531" to DtcInfo("Front camera: no signal on its Ethernet link (timeout)", DescriptionSource.Ocean),
        "C21A586" to DtcInfo("Front camera: invalid signal on its Ethernet link", DescriptionSource.Ocean),
        "U114281" to DtcInfo("Invalid value received from climate control", DescriptionSource.Ocean, OLOOP_NOTE),
        "U1142F1" to DtcInfo("Climate control signal outdated (ambient / coolant temperature)", DescriptionSource.Ocean, OLOOP_NOTE),
        "U114381" to DtcInfo("Invalid value received from stability control", DescriptionSource.Ocean, OLOOP_NOTE),
        "U1143F1" to DtcInfo("Stability control (ABS) signal outdated", DescriptionSource.Ocean, OLOOP_NOTE),
        "U114581" to DtcInfo("Invalid value received from the cockpit controller", DescriptionSource.Ocean, OLOOP_NOTE),
        "U1145F1" to DtcInfo("Cockpit controller signal outdated", DescriptionSource.Ocean, OLOOP_NOTE),
    )

    /** SAE J2012 standard codes, keyed by the 5-character base code. */
    private val SAE: Map<String, String> = mapOf(
        // System voltage and control modules
        "P0562" to "System voltage low",
        "P0563" to "System voltage high",
        "P0601" to "Control module memory checksum error",
        "P0602" to "Control module programming error",
        "P0603" to "Control module keep-alive memory error",
        "P0604" to "Control module RAM error",
        "P0605" to "Control module ROM error",
        "P0606" to "Control module processor fault",
        "P0607" to "Control module performance",
        "P0500" to "Vehicle speed sensor A",
        "P0504" to "Brake switch A/B correlation",
        "P0571" to "Brake switch A circuit",
        "P0700" to "Transmission control system (warning lamp requested)",
        // High-voltage system
        "P0A0A" to "High-voltage system interlock circuit",
        "P0A0B" to "High-voltage system interlock circuit performance",
        "P0A0C" to "High-voltage system interlock circuit low",
        "P0A0D" to "High-voltage system interlock circuit high",
        "P0A1F" to "Battery energy control module",
        "P0A78" to "Drive motor A inverter performance",
        "P0A79" to "Drive motor B inverter performance",
        "P0A7D" to "High-voltage battery state of charge low",
        "P0A7E" to "High-voltage battery over temperature",
        "P0A7F" to "High-voltage battery deterioration",
        "P0A80" to "Replace high-voltage battery pack",
        "P0A90" to "Drive motor A performance",
        "P0A94" to "DC/DC converter performance",
        "P0A95" to "High-voltage fuse",
        "P0AA0" to "High-voltage battery positive contactor circuit",
        "P0AA1" to "High-voltage battery positive contactor stuck closed",
        "P0AA2" to "High-voltage battery positive contactor stuck open",
        "P0AA6" to "High-voltage isolation fault",
        // Network
        "U0001" to "High-speed CAN bus",
        "U0002" to "High-speed CAN bus performance",
        "U0073" to "Communication bus A off",
        "U0074" to "Communication bus B off",
        "U0100" to "Lost communication with powertrain control module",
        "U0111" to "Lost communication with battery energy control module",
        "U0121" to "Lost communication with ABS module",
        "U0122" to "Lost communication with vehicle dynamics module",
        "U0126" to "Lost communication with steering angle sensor",
        "U0131" to "Lost communication with power steering module",
        "U0140" to "Lost communication with body control module",
        "U0151" to "Lost communication with airbag module",
        "U0155" to "Lost communication with instrument cluster",
        "U0164" to "Lost communication with climate control module",
        "U0184" to "Lost communication with radio",
        "U0293" to "Lost communication with hybrid/EV powertrain control module",
        "U0401" to "Invalid data received from powertrain control module",
        "U0415" to "Invalid data received from ABS module",
        "U0422" to "Invalid data received from body control module",
        "U0428" to "Invalid data received from steering angle sensor",
        // Chassis
        "C0035" to "Left front wheel speed sensor circuit",
        "C0040" to "Right front wheel speed sensor circuit",
        "C0045" to "Left rear wheel speed sensor circuit",
        "C0050" to "Right rear wheel speed sensor circuit",
    )
}
