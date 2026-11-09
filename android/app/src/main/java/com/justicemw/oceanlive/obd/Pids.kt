package com.justicemw.oceanlive.obd

/**
 * A diagnostic module on the car's CAN bus: the 11-bit ID we send to and the
 * one it answers on (always request + 8 on the Ocean).
 */
data class Ecu(
    val code: String,
    val name: String,
    val request: String,
    val response: String,
    /** False for modules that implement no ECUReset at all (they answer 7F 11 12 to both kinds). */
    val canRestart: Boolean = true,
    /** Telematics boxes expect a hard reset; everything else takes a soft one. */
    val hardRestart: Boolean = false,
)

/**
 * One UDS ReadDataByIdentifier (service 0x22) value.
 *
 * value = raw * scale + offset, then negated if [negate]. Readings outside
 * [min]..[max] are thrown away so a garbled frame never shows up as a number.
 */
data class Did(
    val key: String,
    val ecu: Ecu,
    val did: String,
    val bytes: Int = 2,
    val scale: Double = 1.0,
    val offset: Double = 0.0,
    val negate: Boolean = false,
    val min: Double = Double.NEGATIVE_INFINITY,
    val max: Double = Double.POSITIVE_INFINITY,
    /** Some cars send a wider field (e.g. pack current as 4 bytes). Accept this width too. */
    val wideBytes: Int? = null,
) {
    val command: String get() = "22$did"

    /** Decodes the bytes that follow the "62 HH LL" positive response. */
    fun decode(data: List<Int>): Double? {
        val width = if (wideBytes != null && data.size >= wideBytes) wideBytes else bytes
        if (data.size < width) return null
        var raw = 0L
        for (i in 0 until width) raw = (raw shl 8) or (data[i].toLong() and 0xFF)
        var value = raw * scale + offset
        if (negate) value = -value
        return value.takeIf { it.isFinite() && it >= min && it <= max }
    }
}

/**
 * Module addresses on the Fisker Ocean (Magna BE21 platform). The scan list is
 * every module whose address has been seen answering on a real car; sources
 * are public CAN captures and owner-run UDS scans.
 */
object Ecus {
    val BMS = Ecu("BMS", "HV battery", "7E1", "7E9")
    val BCM = Ecu("BCM", "Body control", "7C1", "7C9")
    val VCU = Ecu("VCU", "Vehicle control", "7C2", "7CA")

    val scanList = listOf(
        BMS, VCU, BCM,
        Ecu("MCU_F", "Front motor", "786", "78E"),
        Ecu("MCU_R", "Rear motor", "7F2", "7FA"),
        Ecu("PDU", "Power distribution", "7F3", "7FB"),
        Ecu("PIU", "Power integration unit", "791", "799"),
        Ecu("WTC", "HV coolant heater (A)", "752", "75A"),
        Ecu("BTC", "HV coolant heater (B)", "7D5", "7DD"),
        Ecu("ECC", "Climate control", "7F0", "7F8"),
        Ecu("RAC", "Rear climate", "787", "78F", canRestart = false),
        Ecu("ESP", "Stability control", "7D0", "7D8"),
        Ecu("IBOOSTER", "Brake booster", "7F4", "7FC"),
        Ecu("EPS", "Power steering", "7E3", "7EB"),
        Ecu("EPS2", "Power steering (backup)", "7F5", "7FD"),
        Ecu("ACU", "Airbags", "7A0", "7A8"),
        Ecu("PKC", "Keys and NFC", "7A2", "7AA"),
        Ecu("ICC", "Cockpit and screens", "7B1", "7B9"),
        Ecu("GW", "Gateway", "7B6", "7BE"),
        Ecu("TBOX_EU", "Telematics (EU)", "7D1", "7D9", hardRestart = true),
        Ecu("TBOX_US", "Telematics (US)", "742", "74A", hardRestart = true),
        Ecu("HYDRA", "Driver assist (ADAS)", "7A6", "7AE"),
        Ecu("FCM", "Front camera", "780", "788"),
        Ecu("MRR", "Front radar", "781", "789"),
        Ecu("CMRR_FL", "Corner radar front left", "794", "79C"),
        Ecu("CMRR_FR", "Corner radar front right", "782", "78A"),
        Ecu("CMRR_RL", "Corner radar rear left", "796", "79E"),
        Ecu("CMRR_RR", "Corner radar rear right", "7A7", "7AF"),
        Ecu("OHC", "Overhead console", "783", "78B"),
        Ecu("CIM", "Steering column", "7D3", "7DB"),
        Ecu("MFSS", "Steering wheel switches", "797", "79F"),
        Ecu("DSMC", "Driver seat", "7A4", "7AC"),
        Ecu("PSM", "Passenger seat", "793", "79B"),
        Ecu("PWC_L", "Wireless phone charger left", "785", "78D"),
        Ecu("PWC_R", "Wireless phone charger right", "792", "79A"),
        Ecu("PLGM", "Power liftgate", "7A3", "7AB"),
        Ecu("TRM", "Trailer module", "7C7", "7CF"),
        Ecu("AMP", "Audio amplifier", "7B5", "7BD"),
        Ecu("VSP", "Pedestrian warning speaker", "7C6", "7CE"),
    )
}

/**
 * What Ocean Live reads. The BMS values were confirmed against the car's own
 * screen on a real Ocean (BMS at 7E1/7E9); the 12V reading comes from the
 * OEM data (KL30 terminal at the BMS) and falls back to the adapter's ATRV.
 */
object Pids {
    // Read every cycle.
    val soc = Did("soc", Ecus.BMS, "2050", scale = 0.1, min = 0.0, max = 100.5)
    val packV = Did("packV", Ecus.BMS, "2003", scale = 0.1, min = 60.0, max = 600.0)

    /** Pack current. Raw is offset by 2000 A; negated so charging and regen are positive. */
    val packA = Did("packA", Ecus.BMS, "2004", scale = 0.1, offset = -2000.0, negate = true, min = -1500.0, max = 1500.0, wideBytes = 4)
    val tempAvg = Did("tempAvg", Ecus.BMS, "2038", scale = 0.5, offset = -50.0, min = -40.0, max = 100.0)
    val cellMax = Did("cellMax", Ecus.BMS, "2137", min = 1000.0, max = 5000.0)
    val cellMin = Did("cellMin", Ecus.BMS, "2138", min = 1000.0, max = 5000.0)

    // Read every few cycles; these move slowly.
    val cellAvg = Did("cellAvg", Ecus.BMS, "2136", min = 1000.0, max = 5000.0)
    val tempMax = Did("tempMax", Ecus.BMS, "2039", scale = 0.5, offset = -50.0, min = -40.0, max = 100.0)
    val tempMin = Did("tempMin", Ecus.BMS, "2040", scale = 0.5, offset = -50.0, min = -40.0, max = 100.0)
    val coolantIn = Did("coolantIn", Ecus.BMS, "2026", scale = 0.5, offset = -50.0, min = -40.0, max = 100.0)
    val coolantOut = Did("coolantOut", Ecus.BMS, "2027", scale = 0.5, offset = -50.0, min = -40.0, max = 100.0)
    val isolation = Did("isolation", Ecus.BMS, "2069", min = 0.0, max = 65535.0)
    val aux12v = Did("aux12v", Ecus.BMS, "2130", scale = 0.001, min = 8.0, max = 18.0)

    /** Odometer from the body controller, hundredths of a km. */
    val odometer = Did("odometer", Ecus.BCM, "3409", bytes = 4, scale = 0.01, min = 0.0, max = 2_000_000.0)

    val fast = listOf(soc, packV, packA, tempAvg, cellMax, cellMin)
    val slow = listOf(cellAvg, tempMax, tempMin, coolantIn, coolantOut, isolation, aux12v)
}
