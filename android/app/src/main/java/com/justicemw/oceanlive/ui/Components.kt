package com.justicemw.oceanlive.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// ── Palette: deep ocean, with teal → cyan → violet accents ────────
val Bg = Color(0xFF060B12)
val BgTop = Color(0xFF0B1A2A)
val CardBg = Color(0xFF0F1B28)
val CardEdge = Color(0x1A7FE7FF)
val Dim = Color(0xFF7E92A6)
val Aqua = Color(0xFF2EE6C9)
val Cyan = Color(0xFF38BDF8)
val Violet = Color(0xFF8B7CF6)
val Good = Color(0xFF4ADE80)
val Warn = Color(0xFFFBBF24)
val Bad = Color(0xFFFB7185)

val OceanBrush = Brush.linearGradient(listOf(Aqua, Cyan, Violet))
val ChargeBrush = Brush.linearGradient(listOf(Good, Aqua))

/** Screen background: a faint vertical glow from the top. */
val BackgroundBrush = Brush.verticalGradient(listOf(BgTop, Bg, Bg))

@Composable
fun Card(modifier: Modifier = Modifier, glow: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    val edge by animateColorAsState(glow?.copy(alpha = 0.45f) ?: CardEdge, tween(600), label = "edge")
    Column(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(CardBg)
            .border(1.dp, edge, RoundedCornerShape(20.dp))
            .padding(16.dp),
        content = content,
    )
}

@Composable
fun SectionTitle(text: String) {
    Text(
        text.uppercase(), color = Dim, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.4.sp,
        modifier = Modifier.padding(top = 22.dp, bottom = 10.dp, start = 4.dp),
    )
}

/** Text that slides up/down when its value changes. */
@Composable
fun RollingText(text: String, color: Color = Color.White, size: TextUnit = 20.sp, weight: FontWeight = FontWeight.SemiBold) {
    AnimatedContent(
        targetState = text,
        transitionSpec = {
            (slideInVertically(tween(260)) { it / 2 } + fadeIn(tween(260))) togetherWith
                (slideOutVertically(tween(200)) { -it / 2 } + fadeOut(tween(200)))
        },
        label = "rolling",
    ) { Text(it, color = color, fontSize = size, fontWeight = weight) }
}

@Composable
fun Tile(label: String, value: String?, modifier: Modifier, caption: String? = null, accent: Color = Aqua, captionColor: Color = Dim) {
    Column(
        modifier.clip(RoundedCornerShape(18.dp))
            .background(CardBg)
            .border(1.dp, CardEdge, RoundedCornerShape(18.dp))
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(accent))
            Spacer(Modifier.width(6.dp))
            Text(label, color = Dim, fontSize = 12.sp)
        }
        Spacer(Modifier.height(6.dp))
        RollingText(value ?: "—")
        if (caption != null) Text(caption, color = captionColor, fontSize = 12.sp)
    }
}

@Composable
fun TileRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
}

@Composable
fun KeyValue(key: String, value: String?, valueColor: Color = Color.White) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(key, color = Dim, fontSize = 14.sp, modifier = Modifier.weight(1f))
        RollingText(value ?: "—", valueColor, 14.sp, FontWeight.Medium)
    }
}

/** A small rounded pill, e.g. "Charging · DC". */
@Composable
fun Pill(text: String, color: Color, pulse: Boolean = false) {
    val alpha = if (pulse) {
        val t = rememberInfiniteTransition(label = "pill")
        t.animateFloat(0.45f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pillAlpha").value
    } else 1f
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).alpha(alpha).clip(CircleShape).background(color))
        Spacer(Modifier.width(7.dp))
        Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * The charge ring: a gradient arc that eases to the new value, with a soft
 * glow, a rotating shimmer while charging and a gentle breathing while driving.
 */
@Composable
fun SocRing(soc: Double?, charging: Boolean, live: Boolean, size: Dp = 230.dp, center: @Composable () -> Unit) {
    val target = ((soc ?: 0.0) / 100).coerceIn(0.0, 1.0).toFloat()
    val sweep by animateFloatAsState(target, tween(1200, easing = FastOutSlowInEasing), label = "sweep")
    val inf = rememberInfiniteTransition(label = "ring")
    val spin by inf.animateFloat(0f, 360f, infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "spin")
    val breathe by inf.animateFloat(0.55f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "breathe")
    val low = soc != null && soc < 20
    val colors = when {
        charging -> listOf(Good, Aqua, Good)
        low -> listOf(Bad, Warn, Bad)
        else -> listOf(Aqua, Cyan, Violet, Aqua)
    }

    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 18.dp.toPx()
            val inset = stroke / 2 + 8.dp.toPx()
            val arc = Size(this.size.width - inset * 2, this.size.height - inset * 2)
            val topLeft = Offset(inset, inset)
            // Track.
            drawArc(Color(0xFF13233A), 135f, 270f, false, topLeft, arc, style = Stroke(stroke, cap = StrokeCap.Round))
            if (soc == null) return@Canvas
            val brush = Brush.sweepGradient(colors)
            val glowAlpha = if (live) breathe * 0.35f else 0.15f
            rotate(if (charging) spin else 0f) {
                // Soft glow under the arc.
                drawArc(brush, 135f - (if (charging) spin else 0f), 270f * sweep, false, topLeft, arc,
                    alpha = glowAlpha, style = Stroke(stroke * 2.2f, cap = StrokeCap.Round))
            }
            drawArc(brush, 135f, 270f * sweep, false, topLeft, arc, style = Stroke(stroke, cap = StrokeCap.Round))
            if (charging) {
                // A bright dot travels along the filled part while charging.
                val angle = Math.toRadians((135.0 + 270.0 * sweep * (spin / 360f)))
                val r = arc.width / 2
                val c = Offset(this.size.width / 2, this.size.height / 2)
                drawCircle(Color.White.copy(alpha = 0.85f), stroke * 0.28f,
                    Offset(c.x + r * Math.cos(angle).toFloat(), c.y + r * Math.sin(angle).toFloat()))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) { center() }
    }
}

/** Animated horizontal bar. */
@Composable
fun MeterBar(fraction: Float, brush: Brush = OceanBrush) {
    val f by animateFloatAsState(fraction.coerceIn(0.02f, 1f), tween(900, easing = FastOutSlowInEasing), label = "bar")
    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFF13233A))) {
        Box(Modifier.fillMaxWidth(f).height(8.dp).clip(RoundedCornerShape(4.dp)).background(brush))
    }
}

/** Gradient-filled primary button. */
@Composable
fun GradientButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, brush: Brush = OceanBrush) {
    Box(
        modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(16.dp))
            .background(if (enabled) brush else Brush.linearGradient(listOf(CardBg, CardBg)))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (enabled) Color(0xFF04121C) else Dim, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Aqua) {
    Box(
        modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(16.dp))
            .border(1.dp, color.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = color, fontWeight = FontWeight.SemiBold) }
}
