package com.justicemw.oceanlive.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.Format
import com.justicemw.oceanlive.car.ChargeCurve
import com.justicemw.oceanlive.car.ChargeSample
import kotlin.math.roundToInt

private val GraphHeight = 140.dp
private val GridLine = Color(0x1A7FE7FF)

/**
 * Charging curve: kW against charge %, a smooth Ocean-gradient line with a soft fill
 * that draws itself in from the left, with the peak marked.
 */
@Composable
fun ChargeCurveGraph(samples: List<ChargeSample>) {
    val points = remember(samples) { ChargeCurve.points(samples) }
    val peakKw = remember(samples) { ChargeCurve.peak(samples)?.second }
    if (points.size < 2 || peakKw == null) {
        Text("Not enough readings to draw the curve.", color = Dim, fontSize = 12.sp)
        return
    }
    val top = ChargeCurve.axisMax(peakKw)
    val progress = remember(samples) { Animatable(0f) }
    LaunchedEffect(samples) { progress.animateTo(1f, tween(1200, easing = FastOutSlowInEasing)) }
    val measurer = rememberTextMeasurer()
    val labelStyle = TextStyle(color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    val peakLabel = "Peak " + Format.n(peakKw, if (peakKw < 20) 1 else 0) + " kW"
    // The marker sits on the drawn line, at its highest point.
    val peakPoint = points.maxBy { it.second }

    Row {
        Column(
            Modifier.height(GraphHeight).padding(end = 6.dp),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.End,
        ) {
            AxisText("${top.roundToInt()} kW")
            AxisText("${(top / 2).roundToInt()}")
            AxisText("0")
        }
        Column(Modifier.weight(1f)) {
            Canvas(Modifier.fillMaxWidth().height(GraphHeight)) {
                val w = size.width
                val h = size.height
                fun x(soc: Double) = (soc / 100 * w).toFloat().coerceIn(0f, w)
                fun y(kw: Double) = (h - kw / top * h).toFloat().coerceIn(0f, h)

                // Grid: 0, half and top of the kW scale, and 50 %.
                for (f in listOf(0f, 0.5f, 1f)) drawLine(GridLine, Offset(0f, h * f), Offset(w, h * f), 1.dp.toPx())
                drawLine(GridLine, Offset(w / 2, 0f), Offset(w / 2, h), 1.dp.toPx())

                val pts = points.map { Offset(x(it.first), y(it.second)) }
                val line = Path().apply {
                    moveTo(pts[0].x, pts[0].y)
                    for (i in 1 until pts.size) {
                        val a = pts[i - 1]
                        val b = pts[i]
                        val mid = (a.x + b.x) / 2
                        cubicTo(mid, a.y, mid, b.y, b.x, b.y)
                    }
                }
                val fill = Path().apply {
                    addPath(line)
                    lineTo(pts.last().x, h)
                    lineTo(pts.first().x, h)
                    close()
                }
                val shown = pts.first().x + (pts.last().x - pts.first().x) * progress.value
                clipRect(right = shown + 2.dp.toPx()) {
                    drawPath(fill, Brush.verticalGradient(listOf(Aqua.copy(alpha = 0.30f), Cyan.copy(alpha = 0.08f), Color.Transparent)))
                    drawPath(
                        line, Brush.horizontalGradient(listOf(Aqua, Cyan, Violet), startX = 0f, endX = w),
                        style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
                    )
                }

                // Peak marker fades in once the line reaches it.
                val p = Offset(x(peakPoint.first), y(peakPoint.second))
                val reach = if (shown >= p.x) ((shown - p.x) / (12.dp.toPx())).coerceIn(0f, 1f) else 0f
                if (reach > 0f) {
                    drawCircle(Aqua.copy(alpha = 0.3f * reach), 9.dp.toPx(), p)
                    drawCircle(Color.White.copy(alpha = reach), 3.5.dp.toPx(), p)
                    val text = measurer.measure(peakLabel, labelStyle)
                    val tx = (p.x - text.size.width / 2f).coerceIn(0f, w - text.size.width)
                    val above = p.y - text.size.height - 8.dp.toPx()
                    val ty = if (above >= 0f) above else p.y + 10.dp.toPx()
                    drawText(text, topLeft = Offset(tx, ty), alpha = reach)
                }
            }
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth()) {
                AxisText("0%")
                Spacer(Modifier.weight(1f))
                AxisText("50%")
                Spacer(Modifier.weight(1f))
                AxisText("100%")
            }
        }
    }
}

@Composable
private fun AxisText(text: String) = Text(text, color = Dim, fontSize = 10.sp)
