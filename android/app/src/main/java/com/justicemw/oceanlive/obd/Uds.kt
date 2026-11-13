package com.justicemw.oceanlive.obd

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R

/** Outcome of a UDS request that changes something (clear codes, restart a module). */
sealed interface UdsResult {
    data object Done : UdsResult
    data class Refused(val nrc: Int) : UdsResult {
        /** Why the module said no, as a string resource with the code as its argument. */
        @get:StringRes
        val reason: Int get() = Uds.nrcText(nrc)
        val needsSecurity: Boolean get() = nrc == 0x33 || nrc == 0x35 || nrc == 0x36 || nrc == 0x37
    }
    data object NoAnswer : UdsResult
    data object Unclear : UdsResult
}

object Uds {
    const val EXTENDED_SESSION = "1003"
    const val DEFAULT_SESSION = "1001"
    const val CLEAR_ALL = "14FFFFFF"
    /** ControlDTCSetting: stop logging new codes while clearing, then start again. Also undone by leaving the extended session. */
    const val DTC_SETTING_OFF = "8502"
    const val DTC_SETTING_ON = "8501"
    const val HARD_RESET = "1101"
    const val SOFT_RESET = "1103"

    /** Reads a reply to [service] (0x14, 0x11, ...): positive is service + 0x40, negative is 7F service NRC. */
    fun result(response: String?, service: Int): UdsResult {
        if (response == null) return UdsResult.NoAnswer
        val reply = Elm.parse(response)
        val b = reply.bytes
        if (b.isEmpty()) return if (reply.noData) UdsResult.NoAnswer else UdsResult.Unclear
        // A module can answer 7F xx 78 ("busy, wait") and then the real answer in the same reply.
        if (positiveAt(b, service)) return UdsResult.Done
        for (i in 0 until b.size - 2) {
            if (b[i] == 0x7F && b[i + 1] == service && b[i + 2] != 0x78) return UdsResult.Refused(b[i + 2])
        }
        return UdsResult.Unclear
    }

    /** True when the reply is only "busy, still working" (7F xx 78). */
    fun pending(response: String?, service: Int): Boolean {
        val b = Elm.parse(response ?: return false).bytes
        return (0 until b.size - 2).any { b[it] == 0x7F && b[it + 1] == service && b[it + 2] == 0x78 } && !positiveAt(b, service)
    }

    /** Positive reply byte at the start of the reply or right after a "busy" frame. */
    private fun positiveAt(b: List<Int>, service: Int): Boolean =
        b.indices.any { i -> b[i] == service + 0x40 && (i == 0 || (i >= 3 && b[i - 3] == 0x7F && b[i - 1] == 0x78)) }

    /** A negative response code in plain words. [R.string.nrc_other] takes the code as hex text. */
    @StringRes
    fun nrcText(nrc: Int): Int = when (nrc) {
        0x10 -> R.string.nrc_rejected
        0x11 -> R.string.nrc_not_supported
        0x12 -> R.string.nrc_not_supported_kind
        0x13 -> R.string.nrc_malformed
        0x14 -> R.string.nrc_too_long
        0x21 -> R.string.nrc_busy
        0x22 -> R.string.nrc_conditions
        0x24 -> R.string.nrc_sequence
        0x31 -> R.string.nrc_out_of_range
        0x33 -> R.string.nrc_security_required
        0x35, 0x36, 0x37 -> R.string.nrc_security_refused
        0x72 -> R.string.nrc_write_failed
        0x7E, 0x7F -> R.string.nrc_session
        else -> R.string.nrc_other
    }
}
