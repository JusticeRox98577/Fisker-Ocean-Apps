package com.justicemw.oceanlive.wear

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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import kotlinx.coroutines.delay
import kotlin.math.cos
import kotlin.math.sin

// Same deep-ocean palette as the phone app.
private val Bg = Color(0xFF060B12)
private val CardBg = Color(0xFF0F1B28)
private val Track = Color(Palette.TRACK)
private val Dim = Color(Palette.DIM)
private val Aqua = Color(Palette.AQUA)
private val Cyan = Color(Palette.CYAN)
private val Violet = Color(Palette.VIOLET)
private val Good = Color(Palette.GOOD)
private val Warn = Color(Palette.WARN)
private val Bad = Color(Palette.BAD)

@Composable
fun WatchScreen() {
    val reading by LastReading.reading.collectAsState()
    // A clock for "updated x min ago". Only redraws the screen; sends nothing.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(20_000)
        }
    }
    val listState = rememberScalingLazyListState()
    MaterialTheme {
        Scaffold(
            modifier = Modifier.background(Bg),
            timeText = { TimeText() },
            positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
        ) {
            val r = reading
            ScalingLazyColumn(
                modifier = Modifier.fillMaxSize().background(Bg),
                state = listState,
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (r == null) {
                    item { Ring(null, charging = false, live = false) { Big("—") } }
                    item {
                        Text(
                            "Open Ocean Live on your phone and connect to the car.",
                            color = Dim, fontSize = 13.sp, textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                    return@ScalingLazyColumn
                }
                val live = r.liveAt(now)
                val charging = r.charging && live
                item {
                    Ring(r.soc, charging, live) {
                        Big(WatchFormat.soc(r))
                        Text(WatchFormat.range(r) ?: "range unknown", color = Dim, fontSize = 12.sp)
                    }
                }
                if (live) item {
                    val p = r.powerKw
                    val color = when {
                        p == null -> Dim
                        p > 0.3 -> Good
                        p < -0.3 -> Cyan
                        else -> Dim
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Rolling(WatchFormat.power(p), color, 20.sp)
                        Text(WatchFormat.powerLabel(r), color = Dim, fontSize = 11.sp)
                    }
                }
                item {
                    val status = WatchFormat.status(r, now)
                    val color = when {
                        !live -> if (status == "Reconnecting") Warn else Dim
                        charging -> Good
                        status == "Driving" -> Cyan
                        else -> Aqua
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Pill(status, color, pulse = live)
                        WatchFormat.toTarget(r, now)?.let {
                            Spacer(Modifier.size(4.dp))
                            Text(it, color = Aqua, fontSize = 12.sp)
                        }
                    }
                }
                WatchFormat.aux(r.aux12v)?.let { aux ->
                    item {
                        val v = r.aux12v ?: 0.0
                        Text(
                            aux, color = if (v < 12.0) Bad else if (v < 12.4) Warn else Color.White, fontSize = 12.sp,
                            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(CardBg)
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
                item { Text(WatchFormat.ago(r.updatedAt, now), color = Dim, fontSize = 11.sp) }
            }
        }
    }
}

@Composable
private fun Big(text: String) = Rolling(text, Color.White, 30.sp, FontWeight.Bold)

/** Text that slides when it changes, like the phone's rolling numbers. */
@Composable
private fun Rolling(text: String, color: Color, size: TextUnit, weight: FontWeight = FontWeight.SemiBold) {
    AnimatedContent(
        targetState = text,
        transitionSpec = {
            (slideInVertically(tween(350)) { it / 2 } + fadeIn(tween(350))) togetherWith
                (slideOutVertically(tween(350)) { -it / 2 } + fadeOut(tween(250)))
        },
        label = "rolling",
    ) { Text(it, color = color, fontSize = size, fontWeight = weight) }
}

@Composable
private fun Pill(text: String, color: Color, pulse: Boolean) {
    val inf = rememberInfiniteTransition(label = "pill")
    val alpha by inf.animateFloat(0.35f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "dot")
    val tint by animateColorAsState(color, tween(600), label = "pill")
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(tint.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).alpha(if (pulse) alpha else 1f).clip(CircleShape).background(tint))
        Spacer(Modifier.width(6.dp))
        Text(text, color = tint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** The charge ring from the phone app: a gradient arc that eases to the value, shimmering while charging. */
@Composable
private fun Ring(soc: Double?, charging: Boolean, live: Boolean, size: Dp = 128.dp, center: @Composable () -> Unit) {
    val target = ((soc ?: 0.0) / 100).coerceIn(0.0, 1.0).toFloat()
    val sweep by animateFloatAsState(target, tween(1200, easing = FastOutSlowInEasing), label = "sweep")
    val inf = rememberInfiniteTransition(label = "ring")
    val spin by inf.animateFloat(0f, 360f, infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "spin")
    val breathe by inf.animateFloat(0.55f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "breathe")
    val colors = when {
        charging -> listOf(Good, Aqua, Good)
        soc != null && soc < 20 -> listOf(Bad, Warn, Bad)
        else -> listOf(Aqua, Cyan, Violet, Aqua)
    }
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 11.dp.toPx()
            val inset = stroke / 2 + 5.dp.toPx()
            val arc = Size(this.size.width - inset * 2, this.size.height - inset * 2)
            val topLeft = Offset(inset, inset)
            drawArc(Track, 135f, 270f, false, topLeft, arc, style = Stroke(stroke, cap = StrokeCap.Round))
            if (soc == null) return@Canvas
            val brush = Brush.sweepGradient(colors)
            val glowAlpha = if (live) breathe * 0.35f else 0.15f
            rotate(if (charging) spin else 0f) {
                drawArc(brush, 135f - (if (charging) spin else 0f), 270f * sweep, false, topLeft, arc,
                    alpha = glowAlpha, style = Stroke(stroke * 2.2f, cap = StrokeCap.Round))
            }
            drawArc(brush, 135f, 270f * sweep, false, topLeft, arc, style = Stroke(stroke, cap = StrokeCap.Round))
            if (charging) {
                val angle = Math.toRadians(135.0 + 270.0 * sweep * (spin / 360f))
                val radius = arc.width / 2
                val c = Offset(this.size.width / 2, this.size.height / 2)
                drawCircle(Color.White.copy(alpha = 0.85f), stroke * 0.28f,
                    Offset(c.x + radius * cos(angle).toFloat(), c.y + radius * sin(angle).toFloat()))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) { center() }
    }
}
