package com.justicemw.oceanlive

/**
 * What Ocean Live reads from the car. Every value comes from the Bluetooth OBD
 * adapter; nothing here touches the network.
 *
 * The pack readings are UDS ReadDataByIdentifier (service 22) requests to the
 * battery ECU at 7E1/7E9, the same ones Ocean Live has always used.
 */
data class Pid(
    val key: String,
    val command: String,
    val formula: String,
    val min: Double = Double.NEGATIVE_INFINITY,
    val max: Double = Double.POSITIVE_INFINITY,
)

object Obd {
    /** AT commands sent once after connecting (ELM327 reset + quiet output). */
    val initCommands = listOf("ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP6", "ATST20")

    /** Address the battery management ECU. */
    val headerCommands = listOf("ATSH7E1", "ATCRA7E9")

    val packPids = listOf(
        Pid("voltage", "222003", "(A*256+B)/10", 60.0, 600.0),
        Pid("current", "222016", "T/10"),
        Pid("batt_temp", "222038", "(A*256+B)/2-50", -40.0, 100.0),
        Pid("soc", "222050", "(A*256+B)/10", 0.0, 100.5),
        Pid("cell_max", "222137", "A*256+B", 1000.0, 5000.0),
        Pid("cell_min", "222138", "A*256+B", 1000.0, 5000.0),
        // 12V battery (KL30 B+ terminal as seen by the BMS), millivolts. From the
        // Ocean ODX (KL30CVoltage); not yet confirmed on a car, so the app falls
        // back to ATRV below if it doesn't answer or reads out of range.
        Pid("aux_bms", "222130", "(A*256+B)/1000", 8.0, 18.0),
    )

    /**
     * 12V fallback: ATRV makes the adapter report its own supply voltage. The
     * adapter is powered from OBD pin 16, the car's 12V system, so this is the
     * 12V battery voltage give or take ~0.2 V of adapter error.
     */
    const val AUX_VOLTAGE_COMMAND = "ATRV"

    /** Parses an ATRV reply such as "12.6V" or "12.6". */
    fun parseAdapterVoltage(response: String): Double? {
        val match = Regex("""(\d{1,2}(?:\.\d+)?)\s*V?""", RegexOption.IGNORE_CASE)
            .find(response.replace(">", "").trim()) ?: return null
        val value = match.groupValues[1].toDoubleOrNull() ?: return null
        return if (value in 5.0..20.0) value else null
    }

    /**
     * Finds the positive response to [command] in an ELM327 reply and returns
     * the data bytes after it. For "222003" the expected prefix is "622003".
     * Handles ISO-TP multi-frame output ("0:", "1:" line prefixes and the
     * 3-digit length line).
     */
    fun parseResponse(response: String, command: String): List<Int>? {
        if (command.length < 2) return null
        val service = command.substring(0, 2).toIntOrNull(16) ?: return null
        val prefix = ("%02x".format(service + 0x40) + command.substring(2)).uppercase()
        val hex = response
            .replace(">", "")
            .split('\r', '\n')
            .map { it.trim() }
            .filterNot { Regex("^[0-9A-Fa-f]{3}$").matches(it) }
            .map { it.replaceFirst(Regex("^[0-9A-Fa-f]:"), "") }
            .joinToString("")
            .replace(" ", "")
            .uppercase()
        val start = hex.indexOf(prefix)
        if (start < 0) return null
        val tail = hex.substring(start + prefix.length)
        val bytes = mutableListOf<Int>()
        var i = 0
        while (i + 1 < tail.length) {
            tail.substring(i, i + 2).toIntOrNull(16)?.let { bytes.add(it) }
            i += 2
        }
        return bytes
    }

    /** A..H are the data bytes; S, T, U are signed 16-bit words at bytes 0, 2, 4. */
    fun byteVariables(bytes: List<Int>): Map<Char, Double> {
        fun signed(offset: Int): Double {
            if (offset + 1 >= bytes.size) return 0.0
            val value = bytes[offset] * 256 + bytes[offset + 1]
            return (if (value >= 32768) value - 65536 else value).toDouble()
        }
        val vars = mutableMapOf<Char, Double>()
        for (i in 0 until minOf(bytes.size, 8)) vars['A' + i] = bytes[i].toDouble()
        vars['S'] = signed(0)
        vars['T'] = signed(2)
        vars['U'] = signed(4)
        return vars
    }
}

/** Tiny arithmetic evaluator: + - * / parentheses, numbers and single-letter variables. */
class Formula(text: String, private val variables: Map<Char, Double>) {
    private val text = text.filterNot { it.isWhitespace() }
    private var index = 0

    fun evaluate(): Double? = try {
        val result = expression()
        if (index == text.length && result.isFinite()) result else null
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun take(c: Char): Boolean {
        if (index < text.length && text[index] == c) {
            index++
            return true
        }
        return false
    }

    private fun expression(): Double {
        var value = term()
        while (index < text.length) {
            value = when {
                take('+') -> value + term()
                take('-') -> value - term()
                else -> return value
            }
        }
        return value
    }

    private fun term(): Double {
        var value = factor()
        while (index < text.length) {
            value = when {
                take('*') -> value * factor()
                take('/') -> factor().let { if (it == 0.0) 0.0 else value / it }
                else -> return value
            }
        }
        return value
    }

    private fun factor(): Double {
        if (take('-')) return -factor()
        if (take('(')) {
            val value = expression()
            require(take(')'))
            return value
        }
        require(index < text.length)
        variables[text[index]]?.let {
            index++
            return it
        }
        val start = index
        while (index < text.length && (text[index].isDigit() || text[index] == '.')) index++
        return text.substring(start, index).toDoubleOrNull() ?: throw IllegalArgumentException()
    }
}
