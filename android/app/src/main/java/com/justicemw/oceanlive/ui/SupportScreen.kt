package com.justicemw.oceanlive.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.TipJar
import com.justicemw.oceanlive.TipJar.Availability
import kotlin.math.cos
import kotlin.math.sin

/** Local names for the tips, used when Google Play doesn't give one. Same order as Tips.PRODUCT_IDS. */
private val FALLBACK_NAMES = mapOf(
    "tip_small" to R.string.tips_small,
    "tip_medium" to R.string.tips_medium,
    "tip_large" to R.string.tips_large,
)

/**
 * "Support Ocean Live": an honest note and three tips with their Google Play prices.
 * A tip unlocks nothing. Covers the tabs like "Any questions?" until closed.
 */
@Composable
fun SupportScreen(state: TipJar.State, onBuy: (Activity, String) -> Unit, onRetry: () -> Unit, onBack: () -> Unit) {
    val activity = LocalContext.current.findActivity()
    // Finish any tip left over (e.g. a pending payment that cleared) and refresh prices on open.
    LaunchedEffect(Unit) { onRetry() }

    Column(Modifier.fillMaxSize().navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 24.dp),
        ) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "‹ " + stringResource(R.string.ask_back), color = Aqua, fontSize = 15.sp,
                    modifier = Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp))
                        .clickable(role = Role.Button, onClick = onBack).padding(vertical = 12.dp, horizontal = 4.dp),
                )
            }
            Text(
                stringResource(R.string.tips_title), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.tips_body), color = Dim, fontSize = 15.sp, lineHeight = 22.sp)
            Spacer(Modifier.height(18.dp))

            AnimatedContent(
                targetState = state.thanks,
                transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(200)) },
                label = "tipsThanks",
            ) { thanks ->
                if (thanks) ThankYou(onBack) else TipOptions(state, onBuy = { id -> activity?.let { onBuy(it, id) } }, onRetry = onRetry)
            }

            Spacer(Modifier.height(14.dp))
            Text(stringResource(R.string.tips_store_note), color = Dim, fontSize = 12.sp)
        }
    }
}

@Composable
private fun TipOptions(state: TipJar.State, onBuy: (String) -> Unit, onRetry: () -> Unit) {
    Card {
        when (state.availability) {
            Availability.Checking -> {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(color = Aqua, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.tips_loading), color = Dim, fontSize = 14.sp)
                }
            }
            Availability.Unavailable -> Text(
                // Sideloaded copies are pointed at the Play version; Play installs get a neutral note.
                stringResource(if (state.fromPlay) R.string.tips_unavailable_now else R.string.tips_unavailable),
                color = Dim, fontSize = 14.sp,
            )
            Availability.Failed -> {
                Text(stringResource(R.string.tips_load_failed), color = Warn, fontSize = 14.sp)
                Spacer(Modifier.height(12.dp))
                GhostButton(stringResource(R.string.tips_retry), onRetry)
            }
            Availability.Ready -> {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    state.offers.forEachIndexed { index, offer ->
                        // Only the middle tip gets the filled price (one primary choice), as on iOS.
                        val featured = state.offers.size == 3 && index == 1
                        TipRow(offer, featured, buying = state.buying == offer.id, enabled = state.buying == null) { onBuy(offer.id) }
                    }
                }
            }
        }
        AnimatedVisibility(state.pending) {
            Text(
                stringResource(R.string.tips_pending), color = Warn, fontSize = 13.sp,
                modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        AnimatedVisibility(state.error != null) {
            state.error?.let {
                Text(
                    stringResource(it), color = Bad, fontSize = 13.sp,
                    modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

/** One tip: its name and the Google Play price. Shows a spinner while its purchase is open. */
@Composable
private fun TipRow(offer: TipJar.Offer, featured: Boolean, buying: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val name = offer.name ?: stringResource(FALLBACK_NAMES[offer.id] ?: R.string.tips_small)
    val label = "$name, ${offer.price}"
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(14.dp))
            .background(if (buying) Aqua.copy(alpha = 0.12f) else Color.Transparent)
            .border(1.dp, if (buying) Aqua.copy(alpha = 0.6f) else CardEdge, RoundedCornerShape(14.dp))
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = label }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, color = if (enabled || buying) Color.White else Dim, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            offer.description?.let { Text(it, color = Dim, fontSize = 12.sp) }
        }
        Spacer(Modifier.width(12.dp))
        Box(Modifier.widthIn(min = 72.dp), contentAlignment = Alignment.CenterEnd) {
            if (buying) {
                CircularProgressIndicator(color = Aqua, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                val pill = RoundedCornerShape(50)
                Text(
                    offer.price,
                    color = when {
                        !enabled -> Dim
                        featured -> Color(0xFF04121C)
                        else -> Aqua
                    },
                    fontSize = 15.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(pill)
                        .then(
                            if (featured && enabled) Modifier.background(OceanBrush)
                            else Modifier.border(1.dp, if (enabled) Aqua.copy(alpha = 0.5f) else CardEdge, pill)
                        )
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                )
            }
        }
    }
}

@Composable
private fun ThankYou(onDone: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(Unit) { haptics.performHapticFeedback(HapticFeedbackType.LongPress) }
    Card(glow = Aqua) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            HeartBurst(Modifier.size(120.dp))
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.tips_thanks_title), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.tips_thanks_body), color = Dim, fontSize = 15.sp)
            Spacer(Modifier.height(18.dp))
            GhostButton(stringResource(R.string.tips_done), onDone)
        }
    }
}

/**
 * A heart that pops in with a ring of dots flying out, once. With animations turned off
 * in the system settings it's just the heart.
 */
@Composable
private fun HeartBurst(modifier: Modifier) {
    val reduced = rememberReducedMotion()
    val pop = remember { Animatable(if (reduced) 1f else 0.4f) }
    val burst = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
    }
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        burst.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
    }
    val colors = listOf(Aqua, Cyan, Violet, Good)
    Canvas(modifier) {
        val c = Offset(size.width / 2, size.height / 2)
        if (!reduced && burst.value < 1f) {
            val t = burst.value
            val alpha = 1f - t
            for (i in 0 until 12) {
                val angle = Math.toRadians(i * 30.0 - 90.0)
                val r = size.minDimension * (0.22f + 0.28f * t)
                drawCircle(
                    colors[i % colors.size].copy(alpha = alpha), radius = size.minDimension * 0.03f * (1f - t * 0.5f),
                    center = Offset(c.x + r * cos(angle).toFloat(), c.y + r * sin(angle).toFloat()),
                )
            }
        }
        val s = size.minDimension * 0.46f * pop.value
        translate(c.x - s / 2, c.y - s / 2) {
            drawPath(heartPath(Size(s, s)), Brush.linearGradient(listOf(Aqua, Cyan, Violet), Offset.Zero, Offset(s, s)))
        }
    }
}

private fun heartPath(size: Size): Path {
    val w = size.width
    val h = size.height
    return Path().apply {
        moveTo(w * 0.5f, h * 0.92f)
        cubicTo(w * 0.12f, h * 0.66f, -w * 0.04f, h * 0.36f, w * 0.14f, h * 0.16f)
        cubicTo(w * 0.28f, h * 0.02f, w * 0.46f, h * 0.06f, w * 0.5f, h * 0.24f)
        cubicTo(w * 0.54f, h * 0.06f, w * 0.72f, h * 0.02f, w * 0.86f, h * 0.16f)
        cubicTo(w * 1.04f, h * 0.36f, w * 0.88f, h * 0.66f, w * 0.5f, h * 0.92f)
        close()
    }
}

/** True when the phone's animations are turned off (Accessibility > Remove animations). */
@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

/** The small "Enjoying Ocean Live?" card on the Live tab, with "Support" and a close button. */
@Composable
fun TipBanner(onSupport: () -> Unit, onClose: () -> Unit) {
    val closeLabel = stringResource(R.string.tips_banner_close)
    Row(
        Modifier.fillMaxWidth().padding(top = 14.dp).clip(RoundedCornerShape(18.dp)).background(CardBg)
            .border(1.dp, CardEdge, RoundedCornerShape(18.dp)).padding(start = 14.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.tips_banner_text), color = Color.White, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(
            stringResource(R.string.tips_banner_support), color = Aqua, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                .clickable(role = Role.Button, onClick = onSupport).padding(horizontal = 10.dp, vertical = 14.dp),
        )
        Box(
            Modifier.size(48.dp).clip(CircleShape)
                .clickable(role = Role.Button, onClickLabel = closeLabel, onClick = onClose)
                .semantics { contentDescription = closeLabel },
            contentAlignment = Alignment.Center,
        ) { Text("✕", color = Dim, fontSize = 16.sp) }
    }
}

/** The "Support Ocean Live" row near the top of Settings. */
@Composable
fun SupportRow(onClick: () -> Unit) {
    SectionTitle(stringResource(R.string.tips_section))
    Card(Modifier.clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button, onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.tips_title), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.tips_settings_note), color = Dim, fontSize = 12.sp)
            }
            Text("›", color = Aqua, fontSize = 22.sp)
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
