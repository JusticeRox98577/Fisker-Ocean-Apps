package com.justicemw.oceanlive.obd

/** An ELM327 reply turned into bytes. [declaredLength] is the ISO-TP length line of a multi-frame reply. */
data class ElmReply(val bytes: List<Int>, val declaredLength: Int?, val noData: Boolean)

/** Pure parsing of ELM327 text output (headers off, CAN auto-formatting on). */
object Elm {
    /** AT commands sent once after connecting. */
    val initCommands = listOf("ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATCAF1", "ATSP6", "ATAT1", "ATST20")

    private val hexLine = Regex("^[0-9A-F]+$")
    private val framePrefix = Regex("^[0-9A-F]:")

    fun parse(response: String): ElmReply {
        val text = response.replace(">", "").uppercase()
        val noData = listOf("NO DATA", "UNABLE", "CAN ERROR", "STOPPED", "BUS ERROR").any { it in text }
        var declared: Int? = null
        val bytes = mutableListOf<Int>()
        for (rawLine in text.split('\r', '\n')) {
            var line = rawLine.replace(" ", "").trim()
            if (line.isEmpty()) continue
            if (framePrefix.containsMatchIn(line)) {
                line = line.substring(2)
            } else if (line.length == 3 && hexLine.matches(line)) {
                declared = line.toInt(16)
                continue
            }
            if (!hexLine.matches(line) || line.length % 2 != 0) continue
            var i = 0
            while (i + 1 < line.length) {
                bytes.add(line.substring(i, i + 2).toInt(16))
                i += 2
            }
        }
        return ElmReply(bytes, declared, noData)
    }

    /**
     * True when the reply carries bytes from a module on the bus (a value or a refusal).
     * "NO DATA", "CAN ERROR" and the like come from the adapter alone, so the car didn't answer.
     */
    fun carAnswered(response: String?): Boolean = response != null && parse(response).bytes.isNotEmpty()

    /** Data bytes after "62 HH LL" for [did], or null if the reply has no positive answer for it. */
    fun didData(response: String, did: String): List<Int>? {
        val reply = parse(response)
        val bytes = reply.bytes
        val hi = did.substring(0, 2).toInt(16)
        val lo = did.substring(2, 4).toInt(16)
        for (i in 0..bytes.size - 3) {
            if (bytes[i] == 0x62 && bytes[i + 1] == hi && bytes[i + 2] == lo) {
                // Multi-frame replies are padded out to whole CAN frames; the length line says where the data ends.
                val end = reply.declaredLength?.let { minOf(bytes.size, i + it) } ?: bytes.size
                return bytes.subList(i + 3, maxOf(i + 3, end))
            }
        }
        return null
    }

    fun read(response: String, did: Did): Double? = didData(response, did.did)?.let { did.decode(it) }

    /** Parses an ATRV reply such as "12.6V". */
    fun adapterVoltage(response: String): Double? {
        val match = Regex("""(\d{1,2}(?:\.\d+)?)\s*V?""", RegexOption.IGNORE_CASE)
            .find(response.replace(">", "").trim()) ?: return null
        return match.groupValues[1].toDoubleOrNull()?.takeIf { it in 5.0..20.0 }
    }

    /** VIN from a 22 F190 reply, if it is a well-formed 17-character VIN. */
    fun vin(response: String): String? {
        val data = didData(response, "F190") ?: return null
        val text = data.filter { it in 0x20..0x7E }.map { it.toChar() }.joinToString("").trim()
        return text.takeIf { Regex("^[A-HJ-NPR-Z0-9]{17}$").matches(it) }
    }
}
