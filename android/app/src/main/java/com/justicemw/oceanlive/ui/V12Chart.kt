package com.justicemw.oceanlive.ui

import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Mode
import com.justicemw.oceanlive.car.V12Sample

/**
 * Draws the 12V graph on a plain Android canvas, so the screen and the shared
 * picture/PDF are the same drawing. [reveal] (0..1) wipes the line in from the left.
 */
object V12Chart {
    /** Readings further apart than this aren't joined by a line. */
    private const val AWAKE_GAP_MS = 15 * 60_000L
    private const val ASLEEP_GAP_MS = 70 * 60_000L
    /** How long one driving or charging reading shades the background at most. */
    private const val BAND_MS = 10 * 60_000L

    fun restColor(volts: Double): Color = when {
        volts >= V12Log.LOW_VOLTS -> Good
        volts >= V12Log.VERY_LOW_VOLTS -> Warn
        else -> Bad
    }

    fun draw(c: Canvas, w: Float, h: Float, density: Float, samples: List<V12Sample>, from: Long, to: Long, reveal: Float = 1f) {
        val dp = density
        val labelW = 34 * dp
        val top = 8 * dp
        val bottom = h - 8 * dp
        val left = 2 * dp
        val right = w - labelW
        if (right <= left || bottom <= top || to <= from) return

        val volts = samples.map { it.volts }
        val lo = minOf(11.8, (volts.minOrNull() ?: 12.0) - 0.1).coerceAtLeast(9.0)
        val hi = maxOf(13.6, (volts.maxOrNull() ?: 13.0) + 0.1).coerceAtMost(16.0)
        fun x(t: Long) = left + (right - left) * ((t - from).toFloat() / (to - from))
        fun y(v: Double) = (bottom - (bottom - top) * ((v - lo) / (hi - lo))).toFloat()

        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

        // Shaded bands while driving or charging.
        for ((i, s) in samples.withIndex()) {
            if (s.mode != V12Mode.Driving && s.mode != V12Mode.Charging) continue
            val end = minOf(samples.getOrNull(i + 1)?.time ?: (s.time + 60_000), s.time + BAND_MS)
            fill.color = (if (s.mode == V12Mode.Charging) Good else Cyan).copy(alpha = 0.10f).toArgb()
            c.drawRect(RectF(x(s.time), top, maxOf(x(end), x(s.time) + 1 * dp), bottom), fill)
        }

        // Reference lines: 12.0 very low, 12.4 low, 13.2 charging by the DC-DC.
        val ref = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1 * dp
            pathEffect = DashPathEffect(floatArrayOf(4 * dp, 4 * dp), 0f)
        }
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 10 * dp }
        for ((v, color) in listOf(V12Log.VERY_LOW_VOLTS to Bad, V12Log.LOW_VOLTS to Warn, V12Log.CHARGING_VOLTS to Good)) {
            ref.color = color.copy(alpha = 0.35f).toArgb()
            c.drawLine(left, y(v), right, y(v), ref)
            label.color = color.copy(alpha = 0.8f).toArgb()
            c.drawText(String.format(java.util.Locale.US, "%.1f", v), right + 6 * dp, y(v) + 3.5f * dp, label)
        }

        if (samples.isEmpty()) return
        c.save()
        c.clipRect(0f, 0f, left + (right - left) * reveal.coerceIn(0f, 1f) + 4 * dp, h)

        // The line: aqua while awake, violet while the car sleeps.
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2 * dp
            strokeCap = Paint.Cap.ROUND
        }
        for (i in 1 until samples.size) {
            val a = samples[i - 1]
            val b = samples[i]
            val asleep = a.mode == V12Mode.Asleep && b.mode == V12Mode.Asleep
            if (b.time - a.time > if (asleep) ASLEEP_GAP_MS else AWAKE_GAP_MS) continue
            line.color = (if (asleep) Violet else Aqua).toArgb()
            c.drawLine(x(a.time), y(a.volts), x(b.time), y(b.volts), line)
        }

        // Readings while asleep as small violet dots; resting readings as larger dots coloured by health.
        val asleep = samples.filter { it.mode == V12Mode.Asleep }
        if (asleep.size <= 400) {
            fill.color = Violet.toArgb()
            asleep.forEach { c.drawCircle(x(it.time), y(it.volts), 2 * dp, fill) }
        }
        val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.5f * dp; color = CardBg.toArgb() }
        samples.filter { it.resting }.forEach {
            fill.color = restColor(it.volts).toArgb()
            c.drawCircle(x(it.time), y(it.volts), 4.5f * dp, fill)
            c.drawCircle(x(it.time), y(it.volts), 4.5f * dp, ring)
        }
        c.restore()
    }
}
