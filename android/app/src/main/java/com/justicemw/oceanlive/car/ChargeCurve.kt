package com.justicemw.oceanlive.car

import kotlin.math.floor

/** One reading during a charge: time, state of charge, power into the pack and battery temperature. */
data class ChargeSample(val time: Long, val soc: Double?, val kw: Double, val tempC: Double?)

/**
 * Collects charge samples about every [ChargeCurve.SAMPLE_MS], from readings the app takes anyway.
 * Once it holds [ChargeCurve.MAX_SAMPLES] it drops every other one and samples half as often,
 * so a long charge still covers the whole session in a small list.
 */
class ChargeSamples {
    private val items = mutableListOf<ChargeSample>()
    private var interval = ChargeCurve.SAMPLE_MS

    fun add(s: ChargeSample) {
        val last = items.lastOrNull()
        // A little slack so a 2 s poll still lands on every 10 s.
        if (last != null && s.time - last.time < interval - 1_000) return
        items.add(s)
        if (items.size >= ChargeCurve.MAX_SAMPLES) {
            val kept = items.filterIndexed { i, _ -> i % 2 == 0 }
            items.clear()
            items.addAll(kept)
            interval *= 2
        }
    }

    fun list(): List<ChargeSample> = items.toList()

    fun clear() {
        items.clear()
        interval = ChargeCurve.SAMPLE_MS
    }
}

/** Pure helpers for the charging curve graph and its stats. */
object ChargeCurve {
    const val SAMPLE_MS = 10_000L
    const val MAX_SAMPLES = 400
    /** Charges that keep their samples. Older ones keep their summary only. */
    const val KEEP_CHARGES = 50

    /**
     * Points for the graph: charge % (x) and kW (y), one per whole percent, averaged,
     * in order of charge %. Samples without a charge % or with no power are left out.
     */
    fun points(samples: List<ChargeSample>): List<Pair<Double, Double>> =
        samples.filter { it.soc != null && it.kw > 0 }
            .groupBy { floor(it.soc!!).toInt() }
            .toSortedMap()
            .map { (_, g) -> g.sumOf { it.soc!! } / g.size to g.sumOf { it.kw } / g.size }

    /** Highest sample: (charge %, kW). */
    fun peak(samples: List<ChargeSample>): Pair<Double, Double>? =
        samples.filter { it.soc != null }.maxByOrNull { it.kw }?.takeIf { it.kw > 0 }?.let { it.soc!! to it.kw }

    /** Time-weighted average kW over the samples. */
    fun averageKw(samples: List<ChargeSample>): Double? {
        if (samples.size < 2) return null
        var energy = 0.0
        for (i in 1 until samples.size) {
            val a = samples[i - 1]
            val b = samples[i]
            energy += (a.kw + b.kw) / 2 * (b.time - a.time)
        }
        val span = samples.last().time - samples.first().time
        return if (span > 0) energy / span else null
    }

    /** Minutes from [from] % to [to] %, or null if the samples don't cover both. Interpolated between samples. */
    fun minutesBetween(samples: List<ChargeSample>, from: Double = 10.0, to: Double = 80.0): Double? {
        val a = crossing(samples, from) ?: return null
        val b = crossing(samples, to) ?: return null
        return if (b > a) (b - a) / 60_000.0 else null
    }

    /** When the charge % first reached [level], or null if the charge started above it or never got there. */
    private fun crossing(samples: List<ChargeSample>, level: Double): Double? {
        val s = samples.filter { it.soc != null }
        if (s.isEmpty() || s.first().soc!! > level) return null
        for (i in 1 until s.size) {
            val p = s[i - 1]
            val q = s[i]
            if (q.soc!! >= level && p.soc!! < level) {
                val f = (level - p.soc) / (q.soc - p.soc)
                return p.time + f * (q.time - p.time)
            }
        }
        return if (s.first().soc == level) s.first().time.toDouble() else null
    }

    /** A rounded top for the kW axis. */
    fun axisMax(peakKw: Double): Double {
        val steps = listOf(5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 150.0, 200.0, 250.0, 300.0)
        return steps.firstOrNull { it >= peakKw * 1.05 } ?: (Math.ceil(peakKw / 50) * 50)
    }

    /** Drops the samples from all but the latest [keep] charges, to keep the history file small. */
    fun trim(entries: List<HistoryEntry>, keep: Int = KEEP_CHARGES): List<HistoryEntry> {
        var charges = 0
        val out = ArrayList<HistoryEntry>(entries.size)
        for (e in entries.asReversed()) {
            val old = e.kind == EntryKind.Charge && charges++ >= keep
            out.add(if (old && e.samples != null) e.copy(samples = null) else e)
        }
        out.reverse()
        return out
    }
}
