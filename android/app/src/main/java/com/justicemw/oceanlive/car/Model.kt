package com.justicemw.oceanlive.car

enum class Status {
    Idle, Scanning, Connecting, Live, Reconnecting, Error,
    /** The car is asleep; the adapter stays connected and is asked only for the 12V now and then. */
    Watching,
}

enum class Mode { Parked, Driving, Charging }

/** Latest readings. Pack current and power are positive when energy flows into the pack. */
data class Snapshot(
    val soc: Double? = null,
    val packV: Double? = null,
    val packA: Double? = null,
    val tempAvg: Double? = null,
    val tempMax: Double? = null,
    val tempMin: Double? = null,
    val coolantIn: Double? = null,
    val coolantOut: Double? = null,
    val cellMax: Double? = null,
    val cellMin: Double? = null,
    val cellAvg: Double? = null,
    val isolation: Double? = null,
    val aux12v: Double? = null,
    val aux12vSource: String? = null,
    val odometerKm: Double? = null,
    val time: Long = 0,
) {
    val powerKw: Double? get() = if (packV != null && packA != null) packV * packA / 1000 else null
    val cellSpread: Double? get() = if (cellMax != null && cellMin != null) cellMax - cellMin else null

    fun withValue(key: String, value: Double?): Snapshot = when (key) {
        "soc" -> copy(soc = value)
        "packV" -> copy(packV = value)
        "packA" -> copy(packA = value)
        "tempAvg" -> copy(tempAvg = value)
        "tempMax" -> copy(tempMax = value)
        "tempMin" -> copy(tempMin = value)
        "coolantIn" -> copy(coolantIn = value)
        "coolantOut" -> copy(coolantOut = value)
        "cellMax" -> copy(cellMax = value)
        "cellMin" -> copy(cellMin = value)
        "cellAvg" -> copy(cellAvg = value)
        "isolation" -> copy(isolation = value)
        "aux12v" -> copy(aux12v = value)
        "odometer" -> copy(odometerKm = value)
        else -> this
    }
}

enum class EntryKind { Drive, Charge }

/** A finished drive or charging session. Energy is measured at the battery. */
data class HistoryEntry(
    val kind: EntryKind,
    val start: Long,
    val end: Long,
    val socStart: Double?,
    val socEnd: Double?,
    /** Drive: net kWh taken from the pack. Charge: kWh put into the pack. */
    val kwh: Double,
    val distanceKm: Double? = null,
    val peakKw: Double? = null,
    val fast: Boolean = false,
    /** Drive: kWh put back into the pack by regen. Null for drives saved before 3.3. */
    val regenKwh: Double? = null,
    /** Charge: readings taken about every 10 s, for the charging curve. Only the latest charges keep them. */
    val samples: List<ChargeSample>? = null,
) {
    val minutes: Long get() = (end - start) / 60_000
    val whPerKm: Double? get() = distanceKm?.takeIf { it >= 0.5 }?.let { kwh * 1000 / it }

    /** Usable capacity implied by this charge: kWh in / fraction of the battery added. */
    val impliedCapacityKwh: Double?
        get() {
            if (kind != EntryKind.Charge || socStart == null || socEnd == null) return null
            val delta = socEnd - socStart
            return if (delta >= 20) kwh / (delta / 100) else null
        }
}

/**
 * Works out from the readings whether the car is parked, driving or charging,
 * and builds up drive and charge sessions. Pure logic so it can be unit tested.
 *
 * - Driving: the odometer moved in the last few minutes.
 * - Charging: steady power into the pack for a few readings while not moving.
 *   Regen alone never lasts long enough, and the odometer moves during it.
 */
class Tracker {
    var mode = Mode.Parked
        private set
    var currentDrive: HistoryEntry? = null
        private set
    var currentCharge: HistoryEntry? = null
        private set

    private var lastTime: Long? = null
    private var lastOdo: Double? = null
    private var lastMoveAt: Long? = null
    private var driveStartOdo: Double? = null
    private var chargeEvidence = 0
    private var stopEvidence = 0
    private val samples = ChargeSamples()

    fun update(s: Snapshot): List<HistoryEntry> {
        val now = s.time
        val finished = mutableListOf<HistoryEntry>()
        val dtMs = lastTime?.let { now - it }?.takeIf { it in 1..60_000 } ?: 0L
        lastTime = now

        val odo = s.odometerKm
        if (odo != null) {
            val prev = lastOdo
            if (prev != null && odo > prev + 0.005 && odo - prev < 50) lastMoveAt = now
            lastOdo = odo
        }
        val movingRecently = lastMoveAt?.let { now - it < DRIVE_IDLE_MS } ?: false
        val movedLastMinute = lastMoveAt?.let { now - it < 60_000 } ?: false
        val power = s.powerKw

        // Charging start / stop.
        if (mode != Mode.Charging) {
            chargeEvidence = if (power != null && power > CHARGE_START_KW && !movedLastMinute) chargeEvidence + 1 else 0
            if (chargeEvidence >= 3) {
                currentDrive?.let { finished.add(finishDrive(it, now, s)) }
                currentDrive = null
                mode = Mode.Charging
                stopEvidence = 0
                currentCharge = HistoryEntry(EntryKind.Charge, now, now, s.soc, s.soc, 0.0, peakKw = power)
                samples.clear()
            }
        } else {
            stopEvidence = if (power == null || power < CHARGE_STOP_KW) stopEvidence + 1 else 0
            if (stopEvidence >= 3 || movedLastMinute) {
                currentCharge?.let { finished.add(finishCharge(it).copy(end = now, socEnd = s.soc ?: it.socEnd)) }
                currentCharge = null
                mode = Mode.Parked
                chargeEvidence = 0
            }
        }

        // Driving start / stop.
        if (mode != Mode.Charging) {
            if (movingRecently && currentDrive == null) {
                currentDrive = HistoryEntry(EntryKind.Drive, now, now, s.soc, s.soc, 0.0, distanceKm = 0.0, regenKwh = 0.0)
                driveStartOdo = odo
                mode = Mode.Driving
            } else if (!movingRecently && currentDrive != null) {
                finished.add(finishDrive(currentDrive!!, now, s))
                currentDrive = null
                mode = Mode.Parked
            }
        }

        // Energy.
        val hours = dtMs / 3_600_000.0
        if (power != null && hours > 0) {
            currentCharge?.let { c ->
                currentCharge = c.copy(
                    end = now,
                    socEnd = s.soc ?: c.socEnd,
                    kwh = c.kwh + maxOf(power, 0.0) * hours,
                    peakKw = maxOf(c.peakKw ?: 0.0, power),
                    fast = c.fast || power > DC_FAST_KW,
                )
            }
            if (currentCharge != null) samples.add(ChargeSample(now, s.soc, power, s.tempAvg))
            currentDrive?.let { d ->
                currentDrive = d.copy(
                    end = now,
                    socEnd = s.soc ?: d.socEnd,
                    kwh = d.kwh - power * hours,
                    regenKwh = (d.regenKwh ?: 0.0) + maxOf(power, 0.0) * hours,
                    distanceKm = driveDistance(odo) ?: d.distanceKm,
                )
            }
        }
        return finished
    }

    /** Ends any open session, e.g. when the adapter disconnects. */
    fun flush(now: Long): List<HistoryEntry> {
        val out = mutableListOf<HistoryEntry>()
        currentCharge?.let { out.add(finishCharge(it).copy(end = now)) }
        currentDrive?.let { out.add(it.copy(end = now)) }
        currentCharge = null
        currentDrive = null
        mode = Mode.Parked
        chargeEvidence = 0
        stopEvidence = 0
        lastTime = null
        return out.filter { it.end - it.start >= 60_000 }
    }

    private fun driveDistance(odo: Double?): Double? {
        val start = driveStartOdo ?: return null
        return odo?.let { (it - start).coerceAtLeast(0.0) }
    }

    private fun finishCharge(c: HistoryEntry): HistoryEntry {
        val list = samples.list()
        samples.clear()
        return c.copy(samples = list.takeIf { it.size >= 2 })
    }

    private fun finishDrive(d: HistoryEntry, now: Long, s: Snapshot) =
        d.copy(end = now, socEnd = s.soc ?: d.socEnd, distanceKm = driveDistance(s.odometerKm) ?: d.distanceKm)

    companion object {
        const val CHARGE_START_KW = 0.8
        const val CHARGE_STOP_KW = 0.3
        const val DC_FAST_KW = 11.5
        const val DRIVE_IDLE_MS = 180_000L
    }
}

/** Distance-weighted average consumption of recent drives, Wh per km. */
fun learnedWhPerKm(history: List<HistoryEntry>): Double? {
    val drives = history.filter { it.kind == EntryKind.Drive && (it.distanceKm ?: 0.0) >= 3 && it.kwh > 0 }.takeLast(10)
    val km = drives.sumOf { it.distanceKm!! }
    if (km < 10) return null
    return (drives.sumOf { it.kwh } * 1000 / km).takeIf { it in 80.0..600.0 }
}

/** Regen as a percentage of the net energy a drive used, or null when there's nothing to compare. */
fun regenPercent(regenKwh: Double, usedKwh: Double): Double? = if (usedKwh >= 0.05) regenKwh / usedKwh * 100 else null

/** Regen kWh and net energy used, summed over drives that recorded regen. Null if none did. */
fun regenTotals(history: List<HistoryEntry>): Pair<Double, Double>? {
    val drives = history.filter { it.kind == EntryKind.Drive && it.regenKwh != null }
    if (drives.isEmpty()) return null
    return drives.sumOf { it.regenKwh!! } to drives.sumOf { it.kwh }
}

/** Median usable capacity implied by charges that added at least 20%. */
fun measuredCapacityKwh(history: List<HistoryEntry>): Double? {
    val values = history.mapNotNull { it.impliedCapacityKwh }.filter { it in 40.0..140.0 }.sorted()
    if (values.isEmpty()) return null
    return values[values.size / 2]
}
