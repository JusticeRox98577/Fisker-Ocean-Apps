package com.justicemw.oceanlive.obd

/** Outcome of a UDS request that changes something (clear codes, restart a module). */
sealed interface UdsResult {
    data object Done : UdsResult
    data class Refused(val nrc: Int) : UdsResult {
        val reason: String get() = Uds.nrcText(nrc)
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

    fun nrcText(nrc: Int): String = when (nrc) {
        0x10 -> "the module rejected the request"
        0x11 -> "the module doesn't support this"
        0x12 -> "the module doesn't support this kind of request"
        0x13 -> "the request was malformed"
        0x14 -> "the reply was too long"
        0x21 -> "the module is busy, try again"
        0x22 -> "conditions not right (car must be on, in Park, not charging)"
        0x24 -> "request out of sequence"
        0x31 -> "value out of range"
        0x33 -> "security access required"
        0x35, 0x36, 0x37 -> "security access was refused"
        0x72 -> "the module failed to write its memory"
        0x7E, 0x7F -> "not allowed in the current diagnostic session"
        else -> "refused (code 0x%02X)".format(nrc)
    }
}
