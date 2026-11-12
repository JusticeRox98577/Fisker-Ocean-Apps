package com.justicemw.oceanlive.obd

/** Standard UDS identification values (service 0x22, read-only). */
object Ident {
    /** ECU software version. */
    const val SOFTWARE_VERSION = "F189"
    /** ECU software number. */
    const val SOFTWARE_NUMBER = "F188"
    /** Spare part number. */
    const val PART_NUMBER = "F187"

    /**
     * Turns an identification value into text: printable ASCII with padding trimmed,
     * or the bytes as hex when the module sends something that isn't text. Null if empty.
     */
    fun text(data: List<Int>): String? {
        val pad = setOf(0x00, 0xFF, 0x20)
        var start = 0
        var end = data.size
        while (start < end && data[start] in pad) start++
        while (end > start && data[end - 1] in pad) end--
        if (start >= end) return null
        val body = data.subList(start, end)
        if (body.all { it in 0x20..0x7E }) return body.map { it.toChar() }.joinToString("").trim().ifEmpty { null }
        return body.joinToString(" ") { "%02X".format(it) }
    }

    /** The value from a 22 [did] reply, or null if the module refused or sent nothing usable. */
    fun read(response: String?, did: String): String? =
        response?.let { Elm.didData(it, did) }?.let { text(it) }
}

/** Identification read from one module. Any field can be missing; not every module supports every value. */
data class ModuleVersion(
    val ecu: Ecu,
    val softwareVersion: String?,
    val softwareNumber: String?,
    val partNumber: String?,
) {
    val isEmpty: Boolean get() = softwareVersion == null && softwareNumber == null && partNumber == null
}
