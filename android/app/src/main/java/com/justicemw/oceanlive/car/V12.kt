package com.justicemw.oceanlive.car

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/** What the car was doing when a 12V reading was taken. */
enum class V12Mode(val code: Char, val csv: String) {
    Parked('p', "parked"), Driving('d', "driving"), Charging('c', "charging"), Asleep('a', "asleep");

    companion object {
        fun of(mode: Mode) = when (mode) {
            Mode.Parked -> Parked
            Mode.Driving -> Driving
            Mode.Charging -> Charging
        }

        fun fromCode(c: Char) = entries.firstOrNull { it.code == c }
    }
}

/** How a reading was taken while the car slept. */
enum class V12Method(val code: Char, val csv: String) {
    /** Connected briefly for the reading, then let go so the adapter could sleep. */
    Quick('q', "quick"),
    /** The adapter stayed connected (and awake) between readings. */
    KeptOpen('k', "kept open");

    companion object {
        fun fromCode(c: Char) = entries.firstOrNull { it.code == c }
    }
}

/**
 * One 12V reading. [source] is "BMS", "OBD port" or "OBD port while asleep".
 * [resting] marks the first reading after the car slept for 2 hours or more,
 * the best sign of the 12V battery's health. [method] says how an asleep
 * reading was taken; see [watchMethod].
 */
data class V12Sample(
    val time: Long,
    val volts: Double,
    val source: String,
    val mode: V12Mode,
    val resting: Boolean = false,
    val method: V12Method? = null,
) {
    /** A reading taken with the car at rest: flagged resting, or asleep with the DC-DC off. */
    val atRest: Boolean get() = resting || (mode == V12Mode.Asleep && volts < V12Log.CHARGING_VOLTS - 0.2)

    /** How an asleep reading was taken. Readings stored before this was recorded were all kept open. */
    val watchMethod: V12Method? get() = if (mode == V12Mode.Asleep) method ?: V12Method.KeptOpen else null
}

/** Storing and thinning 12V readings. Pure logic so it can be unit tested. */
object V12Log {
    const val THIN_MS = 60_000L
    const val MIN_CHANGE = 0.05
    const val KEEP_MS = 90L * 24 * 3_600_000
    /** A gap this long between awake readings means the car slept. */
    const val REST_GAP_MS = 2 * 3_600_000L
    /** At or above this the car's DC-DC converter is charging the 12V battery. */
    const val CHARGING_VOLTS = 13.2
    const val LOW_VOLTS = 12.4
    const val VERY_LOW_VOLTS = 12.0

    const val SOURCE_BMS = "BMS"
    const val SOURCE_PORT = "OBD port"
    const val SOURCE_ASLEEP = "OBD port while asleep"

    /** Whether [next] is worth storing after [last]: about once a minute, plus every change of 0.05 V or more. */
    fun shouldKeep(last: V12Sample?, next: V12Sample): Boolean {
        if (last == null) return true
        if (next.resting || next.mode == V12Mode.Asleep || next.mode != last.mode) return true
        if (next.time - last.time >= THIN_MS) return true
        return abs(next.volts - last.volts) >= MIN_CHANGE - 1e-9
    }

    /** True when the stored readings hold some more than a day past the 90 days, worth rewriting the file. */
    fun needsCompaction(samples: List<V12Sample>, now: Long): Boolean =
        samples.firstOrNull()?.let { it.time < now - KEEP_MS - 24 * 3_600_000L } ?: false

    /** Drops readings older than 90 days. */
    fun trim(samples: List<V12Sample>, now: Long): List<V12Sample> {
        val cutoff = now - KEEP_MS
        return if (samples.none { it.time < cutoff }) samples else samples.filter { it.time >= cutoff }
    }

    /** Health label for a resting voltage. */
    @StringRes
    fun restLabel(volts: Double): Int = when {
        volts >= LOW_VOLTS -> R.string.aux_good
        volts >= VERY_LOW_VOLTS -> R.string.aux_low
        else -> R.string.aux_very_low
    }

    // ── File format: one compact line per reading ──────────────

    private fun sourceCode(source: String) = when (source) {
        SOURCE_BMS -> 'B'
        SOURCE_ASLEEP -> 'S'
        else -> 'O'
    }

    private fun sourceOf(code: String) = when (code) {
        "B" -> SOURCE_BMS
        "S" -> SOURCE_ASLEEP
        else -> SOURCE_PORT
    }

    fun encode(s: V12Sample): String =
        "${s.time},${String.format(Locale.US, "%.2f", s.volts)},${sourceCode(s.source)},${s.mode.code},${if (s.resting) 1 else 0}" +
            (s.method?.let { ",${it.code}" } ?: "")

    fun decode(line: String): V12Sample? {
        val p = line.trim().split(',')
        if (p.size < 5) return null
        val time = p[0].toLongOrNull() ?: return null
        val volts = p[1].toDoubleOrNull() ?: return null
        val mode = p[3].singleOrNull()?.let { V12Mode.fromCode(it) } ?: return null
        val method = p.getOrNull(5)?.singleOrNull()?.let { V12Method.fromCode(it) }
        return V12Sample(time, volts, sourceOf(p[2]), mode, p[4] == "1", method)
    }

    fun decodeAll(text: String): List<V12Sample> = text.lineSequence().mapNotNull { decode(it) }.sortedBy { it.time }.toList()

    /** CSV for sharing: time (ISO-8601), volts, source, mode, resting, method (asleep readings only). */
    fun csv(samples: List<V12Sample>, zone: TimeZone = TimeZone.getDefault()): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).apply { timeZone = zone }
        return buildString {
            append("time,volts,source,mode,resting,method\n")
            for (s in samples) {
                append(fmt.format(Date(s.time))).append(',')
                append(String.format(Locale.US, "%.2f", s.volts)).append(',')
                append(s.source).append(',')
                append(s.mode.csv).append(',')
                append(s.resting).append(',')
                append(s.watchMethod?.csv ?: "").append('\n')
            }
        }
    }
}

/**
 * Turns the 12V readings the app already takes into stored samples: thins them
 * and flags the resting ones. Never asks the car for anything itself.
 */
class V12Recorder {
    private var last: V12Sample? = null
    private var lastAwake: Long? = null
    private var firstOfSession = true

    /** Picks up where the stored samples left off. */
    fun load(samples: List<V12Sample>) {
        last = samples.lastOrNull()
        lastAwake = samples.lastOrNull { it.mode != V12Mode.Asleep }?.time
    }

    /** A new connection to the awake car started; its first reading may be a resting one. */
    fun startSession() {
        firstOfSession = true
    }

    /** Returns the sample to store, or null if it is too close to the last one. */
    fun add(time: Long, volts: Double, source: String, mode: V12Mode, method: V12Method? = null): V12Sample? {
        val asleep = mode == V12Mode.Asleep
        var resting = false
        if (!asleep) {
            val gap = lastAwake?.let { time - it }
            // The first reading after the car slept, before the DC-DC has started charging the 12V.
            resting = firstOfSession && gap != null && gap >= V12Log.REST_GAP_MS && volts < V12Log.CHARGING_VOLTS - 0.2
            firstOfSession = false
            lastAwake = time
        }
        val sample = V12Sample(time, volts, source, mode, resting, if (asleep) method else null)
        if (!V12Log.shouldKeep(last, sample)) return null
        last = sample
        return sample
    }
}

/** One night (or longer sleep): the resting voltage when the car went to sleep and in the morning. */
data class V12Night(val start: Long, val end: Long, val startVolts: Double, val endVolts: Double) {
    val drop: Double get() = startVolts - endVolts
    val hours: Double get() = (end - start) / 3_600_000.0
}

data class V12Stats(
    val latest: V12Sample?,
    val latestRest: V12Sample?,
    val lowestRest: Double?,
    val averageRest: Double?,
    /** Share of the connected time (car awake) the DC-DC was charging the 12V, 0..1. */
    val chargedShare: Double?,
    /** Last time a reading showed the car charging the 12V (13.2 V or more). */
    val lastCharged: Long?,
    val nights: List<V12Night>,
) {
    val averageNightDrop: Double? get() = nights.takeIf { it.isNotEmpty() }?.let { n -> n.sumOf { it.drop } / n.size }

    companion object {
        /** Gaps longer than this aren't counted as connected time. */
        private const val MAX_STEP_MS = 5 * 60_000L
        const val MIN_NIGHT_MS = 3 * 3_600_000L

        /** Stats for readings from [from] onwards. [all] must be sorted by time. */
        fun of(all: List<V12Sample>, from: Long): V12Stats {
            val range = all.filter { it.time >= from }
            val rest = range.filter { it.atRest }
            var charged = 0L
            var total = 0L
            for (i in 0 until range.size - 1) {
                val a = range[i]
                if (a.mode == V12Mode.Asleep) continue
                val step = (range[i + 1].time - a.time).coerceAtMost(MAX_STEP_MS)
                total += step
                if (a.volts >= V12Log.CHARGING_VOLTS) charged += step
            }
            return V12Stats(
                latest = range.lastOrNull(),
                latestRest = all.lastOrNull { it.atRest },
                lowestRest = rest.minOfOrNull { it.volts },
                averageRest = rest.takeIf { it.isNotEmpty() }?.let { r -> r.sumOf { it.volts } / r.size },
                chargedShare = if (total >= 60_000) charged.toDouble() / total else null,
                lastCharged = all.lastOrNull { it.volts >= V12Log.CHARGING_VOLTS }?.time,
                nights = nights(all).filter { it.end >= from },
            )
        }

        /**
         * Sleeps of 3 hours or more. With the 12V watched while asleep: the first and last
         * asleep readings (or the resting reading right after). Without it: the last
         * parked reading before a gap and the resting reading after it.
         */
        fun nights(all: List<V12Sample>): List<V12Night> {
            val out = mutableListOf<V12Night>()
            var i = 0
            while (i < all.size) {
                val s = all[i]
                if (s.mode == V12Mode.Asleep) {
                    var j = i
                    while (j + 1 < all.size && all[j + 1].mode == V12Mode.Asleep) j++
                    val run = all.subList(i, j + 1).filter { it.volts < V12Log.CHARGING_VOLTS - 0.2 }
                    val after = all.getOrNull(j + 1)?.takeIf { it.resting && it.time - all[j].time <= 3_600_000L }
                    val first = run.firstOrNull()
                    val last = after ?: run.lastOrNull()
                    if (first != null && last != null && last.time - first.time >= MIN_NIGHT_MS) {
                        out.add(V12Night(first.time, last.time, first.volts, last.volts))
                    }
                    i = j + 1
                    continue
                }
                val next = all.getOrNull(i + 1)
                if (next != null && next.resting && next.time - s.time >= MIN_NIGHT_MS &&
                    s.mode == V12Mode.Parked && s.volts < V12Log.CHARGING_VOLTS - 0.2
                ) {
                    out.add(V12Night(s.time, next.time, s.volts, next.volts))
                }
                i++
            }
            return out
        }
    }
}

/** For the graph: at most about [maxPoints] readings, keeping each bucket's lowest and highest. */
fun thinForGraph(samples: List<V12Sample>, from: Long, to: Long, maxPoints: Int = 600): List<V12Sample> {
    val range = samples.filter { it.time in from..to }
    if (range.size <= maxPoints) return range
    val buckets = (maxPoints / 2).coerceAtLeast(1)
    val width = ((to - from) / buckets).coerceAtLeast(1)
    val out = mutableListOf<V12Sample>()
    range.groupBy { (it.time - from) / width }.toSortedMap().values.forEach { group ->
        val lo = group.minBy { it.volts }
        val hi = group.maxBy { it.volts }
        if (lo === hi) out.add(lo) else out.addAll(listOf(lo, hi).sortedBy { it.time })
        group.filter { it.resting && it !== lo && it !== hi }.let { out.addAll(it) }
    }
    return out.sortedBy { it.time }
}

/**
 * Watching the 12V while the car sleeps: the adapter is asked only for its own
 * supply voltage (ATRV), which puts nothing on the car's network. Pure logic so
 * it can be unit tested.
 */
object V12Watch {
    /** Check-interval choices in minutes. */
    val INTERVALS = listOf(5, 10, 30)
    const val DEFAULT_INTERVAL = 30
    /** Never try to reconnect the Bluetooth link more often than this. */
    const val RECONNECT_MS = 10 * 60_000L
    /** After one reading that looks awake, check again this soon to confirm. */
    const val CONFIRM_MS = 60_000L
    const val WAKE_VOLTS = 13.0
    const val WAKE_READINGS = 2
    /** Readings asked for by opening the app are skipped if the last one is this recent. */
    const val MIN_SPACING_MS = 60_000L
    /** A quick check (connect, read, disconnect) gives up after this long. */
    const val QUICK_TIMEOUT_MS = 15_000L
    /** Quick checks in a row that can't reach the adapter before the status says so. */
    const val UNREACHABLE_AFTER = 2
    /** Unreachable checks are remembered this long. */
    const val MISSES_KEEP_MS = 14L * 24 * 3_600_000
    private const val MISSES_MAX = 2_000

    /** Watch mode goes back to full reading on its own (the car woke up) at most this often. */
    const val AUTO_RESUME_MIN_MS = 2 * 3_600_000L

    /** Whether a wake-up seen while watching may start full reading again, given when that last happened. */
    fun mayAutoResume(lastResume: Long?, now: Long): Boolean = lastResume == null || now - lastResume >= AUTO_RESUME_MIN_MS

    /** Whether the app should watch the 12V instead of letting go of the adapter when it stops reading. */
    fun shouldWatch(settingOn: Boolean, userStopped: Boolean): Boolean = settingOn && !userStopped

    fun intervalMs(minutes: Int): Long = (if (minutes in INTERVALS) minutes else DEFAULT_INTERVAL) * 60_000L

    /**
     * How a reading is taken: a quick check (connect, ATRV, disconnect, so the adapter
     * sleeps between readings) unless the user chose to keep the adapter connected.
     */
    fun method(keepConnected: Boolean): V12Method = if (keepConnected) V12Method.KeptOpen else V12Method.Quick

    /** How long to wait before the next step of watch mode with the adapter kept connected. */
    fun nextDelay(intervalMin: Int, connected: Boolean, confirmingWake: Boolean): Long = when {
        !connected -> maxOf(intervalMs(intervalMin), RECONNECT_MS)
        confirmingWake -> CONFIRM_MS
        else -> intervalMs(intervalMin)
    }

    /**
     * How long to wait after a quick check. Unreachable checks are retried at the chosen
     * interval too (only a Bluetooth connect is tried, never anything on the car).
     */
    fun quickDelay(intervalMin: Int, confirmingWake: Boolean): Long =
        if (confirmingWake) CONFIRM_MS else intervalMs(intervalMin)

    /** When the next quick check is due after the interval changes: the new interval from the last check. */
    fun quickDue(lastCheck: Long, intervalMin: Int): Long = lastCheck + intervalMs(intervalMin)

    /** Whole minutes (at least 1) until a check due at [due], for "next check in N min". */
    fun minutesUntil(due: Long, now: Long): Int = ((due - now + 59_999) / 60_000).coerceAtLeast(1).toInt()

    /** Whether the status should say the adapter can't be reached, after this many unreachable quick checks in a row. */
    fun unreachable(missesInARow: Int): Boolean = missesInARow >= UNREACHABLE_AFTER

    // ── Unreachable quick checks, remembered for the 12V screen ──

    fun encodeMisses(misses: List<Long>): String = misses.joinToString(",")

    fun decodeMisses(text: String?): List<Long> =
        text?.split(',')?.mapNotNull { it.trim().toLongOrNull() }?.sorted() ?: emptyList()

    /** Adds an unreachable check and drops ones older than 14 days. */
    fun addMiss(misses: List<Long>, time: Long): List<Long> =
        (misses.filter { it >= time - MISSES_KEEP_MS } + time).takeLast(MISSES_MAX)

    /**
     * How the latest night was watched, for the 12V screen: the method of the latest
     * asleep reading, and how many quick checks couldn't reach the adapter that night.
     * The night runs from the last awake reading before it to the first awake reading after it.
     */
    fun latestNight(samples: List<V12Sample>, misses: List<Long>): NightChecks? {
        val lastAsleep = samples.lastOrNull { it.mode == V12Mode.Asleep }
        val lastMiss = misses.maxOrNull()
        if (lastAsleep == null && lastMiss == null) return null
        val anchor = maxOf(lastAsleep?.time ?: Long.MIN_VALUE, lastMiss ?: Long.MIN_VALUE)
        val start = samples.lastOrNull { it.mode != V12Mode.Asleep && it.time < anchor }?.time ?: Long.MIN_VALUE
        val end = samples.firstOrNull { it.mode != V12Mode.Asleep && it.time > anchor }?.time ?: Long.MAX_VALUE
        val method = samples.lastOrNull { it.mode == V12Mode.Asleep && it.time > start && it.time < end }?.watchMethod
        val unreachable = misses.count { it > start && it < end }
        return NightChecks(method, unreachable)
    }
}

/** How the latest night's 12V checks went: [method] is null when none of them reached the adapter. */
data class NightChecks(val method: V12Method?, val unreachable: Int)

/**
 * Spots the car waking up by itself: two readings in a row at 13.0 V or more
 * (the DC-DC is charging the 12V). Only armed after a reading under 13.0 V, so
 * a car that was still awake when watching began, or a 12V charger on the
 * battery, never sets it off.
 */
class WakeDetector {
    private var armed = false
    private var highs = 0

    /** Watch mode started: wait for the car to be seen asleep before looking for a wake-up. */
    fun enter() {
        armed = false
        highs = 0
    }

    /** True while one high reading is waiting for a second. */
    val confirming: Boolean get() = armed && highs in 1 until V12Watch.WAKE_READINGS

    /** Adds a reading; true when the car has woken up. A missing reading breaks the run. */
    fun add(volts: Double?): Boolean {
        if (volts == null) {
            highs = 0
            return false
        }
        if (volts < V12Watch.WAKE_VOLTS) {
            armed = true
            highs = 0
            return false
        }
        if (!armed) return false
        highs++
        return highs >= V12Watch.WAKE_READINGS
    }
}

/** Low-12V warning while the car sleeps: once under 12.2 V, again under 11.8 V, re-armed above 12.6 V. */
class LowVoltAlarm {
    private var lowSent = false
    private var veryLowSent = false

    enum class Level { Low, VeryLow }

    fun check(volts: Double): Level? {
        if (volts > REARM) {
            lowSent = false
            veryLowSent = false
            return null
        }
        if (volts < VERY_LOW && !veryLowSent) {
            veryLowSent = true
            lowSent = true
            return Level.VeryLow
        }
        if (volts < LOW && !lowSent) {
            lowSent = true
            return Level.Low
        }
        return null
    }

    companion object {
        const val LOW = 12.2
        const val VERY_LOW = 11.8
        const val REARM = 12.6
    }
}
