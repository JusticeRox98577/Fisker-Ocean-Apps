package com.justicemw.oceanlive.obd

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R

enum class DtcState(@StringRes val label: Int) {
    Active(R.string.dtc_active),
    Pending(R.string.dtc_pending),
    Stored(R.string.dtc_stored),
    Lamp(R.string.dtc_lamp),
    Other(R.string.dtc_other),
}

/** One fault code from a UDS ReadDTCInformation (19 02) reply. */
data class Dtc(val code: String, val status: Int, val ecu: Ecu) {
    val state: DtcState get() = Dtcs.state(status)
    val failureType: String? get() = Dtcs.failureType(code)
    val info: DtcInfo get() = DtcCatalog.describe(code, ecu)
}

sealed interface DtcReadResult {
    /** [complete] is false when the ECU announced more records than arrived. */
    data class Ok(val codes: List<Dtc>, val complete: Boolean) : DtcReadResult
    data object NoAnswer : DtcReadResult
    data class Refused(val nrc: Int) : DtcReadResult
    data object Garbled : DtcReadResult
}

object Dtcs {
    /** Ask for every stored code, whatever its status. */
    const val READ_ALL = "1902FF"

    fun parse(response: String, ecu: Ecu): DtcReadResult {
        val reply = Elm.parse(response)
        if (reply.noData || reply.bytes.isEmpty()) return DtcReadResult.NoAnswer
        val b = reply.bytes
        val start = (0 until b.size - 2).firstOrNull { b[it] == 0x59 && b[it + 1] == 0x02 }
        if (start == null) {
            val neg = (0 until b.size - 2).firstOrNull { b[it] == 0x7F && b[it + 1] == 0x19 }
            return if (neg != null) DtcReadResult.Refused(b[neg + 2]) else DtcReadResult.Garbled
        }
        // Records start after "59 02 <availability mask>". Each is 3 code bytes + 1 status byte.
        val end = reply.declaredLength?.let { minOf(b.size, start + it) } ?: b.size
        val first = start + 3
        val codes = mutableListOf<Dtc>()
        var i = first
        while (i + 3 < end) {
            val b0 = b[i]; val b1 = b[i + 1]; val b2 = b[i + 2]; val st = b[i + 3]
            i += 4
            if (b0 == b1 && b1 == b2 && b0 in setOf(0x00, 0xAA, 0xCC, 0xFF)) continue // frame padding
            val c = code(b0, b1, b2)
            if (c in DtcCatalog.placeholders) continue // "no fault" placeholders, never real
            codes.add(Dtc(c, st, ecu))
        }
        val expected = reply.declaredLength?.let { (it - 3) / 4 }
        val got = (end - first).coerceAtLeast(0) / 4
        return DtcReadResult.Ok(codes, expected == null || got >= expected)
    }

    /** Three DTC bytes to the 7-character form, e.g. 0xD7 0x8B 0x11 -> "U178B11". */
    fun code(b0: Int, b1: Int, b2: Int): String {
        val letter = "PCBU"[(b0 shr 6) and 3]
        return buildString {
            append(letter)
            append((b0 shr 4) and 3)
            append(hex(b0 and 0xF)); append(hex(b1 shr 4)); append(hex(b1 and 0xF))
            append(hex(b2 shr 4)); append(hex(b2 and 0xF))
        }
    }

    private fun hex(n: Int) = "0123456789ABCDEF"[n and 0xF]

    /** ISO 14229 status byte to a plain state. Only bit 0 means "failing right now". */
    fun state(status: Int): DtcState = when {
        status and 0x01 != 0 -> DtcState.Active
        status and 0x08 != 0 -> DtcState.Stored
        status and 0x04 != 0 -> DtcState.Pending
        status and 0x22 != 0 -> DtcState.Stored
        status == 0x80 -> DtcState.Lamp
        else -> DtcState.Other
    }

    /** SAE J2012 failure type: the last two characters of a 7-character code. */
    fun failureType(code: String): String? {
        if (code.length != 7) return null
        val ftb = code.substring(5)
        if (ftb == "F1") return "end-to-end message check failed"
        if (ftb[0] == 'F') return "manufacturer-specific failure"
        return FAILURE_TYPES[ftb]
    }

    private val FAILURE_TYPES = mapOf(
        "00" to null,
        "01" to "general electrical failure",
        "02" to "general signal failure",
        "03" to "frequency or PWM failure",
        "04" to "internal system failure",
        "05" to "programming failure",
        "06" to "algorithm failure",
        "07" to "mechanical failure",
        "08" to "bus signal or message failure",
        "09" to "component failure",
        "11" to "short to ground",
        "12" to "short to battery",
        "13" to "open circuit",
        "14" to "short to ground or open",
        "15" to "short to battery or open",
        "16" to "voltage below threshold",
        "17" to "voltage above threshold",
        "18" to "current below threshold",
        "19" to "current above threshold",
        "1C" to "voltage out of range",
        "1D" to "current out of range",
        "1E" to "resistance out of range",
        "21" to "signal too low",
        "22" to "signal too high",
        "29" to "signal invalid",
        "31" to "no signal",
        "41" to "checksum failure",
        "42" to "memory failure",
        "44" to "data memory failure",
        "45" to "program memory failure",
        "46" to "calibration memory failure",
        "47" to "watchdog failure",
        "49" to "internal electronic failure",
        "4B" to "over temperature",
        "51" to "not programmed",
        "54" to "not coded / missing calibration",
        "55" to "not configured",
        "62" to "communication verification failure",
        "64" to "signal plausibility failure",
        "68" to "event information",
        "71" to "actuator stuck",
        "72" to "actuator stuck open",
        "73" to "actuator stuck closed",
        "81" to "invalid data received",
        "82" to "message counter wrong",
        "83" to "message checksum wrong",
        "84" to "signal below allowed range",
        "85" to "signal above allowed range",
        "86" to "signal invalid",
        "87" to "message missing",
        "88" to "bus off",
        "92" to "performance or incorrect operation",
        "93" to "no operation",
        "94" to "unexpected operation",
        "95" to "incorrect assembly",
        "96" to "component internal failure",
        "97" to "operation obstructed or blocked",
        "98" to "over temperature",
    )
}
