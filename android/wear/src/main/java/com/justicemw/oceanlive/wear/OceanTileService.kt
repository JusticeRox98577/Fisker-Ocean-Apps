package com.justicemw.oceanlive.wear

import android.content.Context
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.CircularProgressIndicator
import androidx.wear.protolayout.material.ProgressIndicatorColors
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.EdgeContentLayout
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture

/** A tile with the charge ring, %, range and status. Shows the last reading; asks nothing of the phone. */
class OceanTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES)
            // Redraws "updated x min ago" now and then. Only re-reads the saved reading.
            .setFreshnessIntervalMillis(5 * 60_000L)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(
                    layout(this, LastReading.load(this), System.currentTimeMillis(), requestParams.deviceConfiguration),
                ),
            )
            .build()
        return done(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        done(ResourceBuilders.Resources.Builder().setVersion(RESOURCES).build())

    private fun <T> done(value: T): ListenableFuture<T> = CallbackToFutureAdapter.getFuture { completer ->
        completer.set(value)
        "ocean tile"
    }

    private fun layout(context: Context, r: WatchReading?, now: Long, device: DeviceParameters): LayoutElementBuilders.LayoutElement {
        val live = r?.liveAt(now) == true
        val ring = when {
            r?.charging == true && live -> Palette.GOOD
            (r?.soc ?: 100.0) < 20 -> Palette.BAD
            else -> Palette.AQUA
        }
        val status = when {
            r == null -> "Open Ocean Live"
            else -> WatchFormat.status(r, now)
        }
        val detail = when {
            r == null -> "on your phone"
            live -> listOfNotNull(WatchFormat.range(r), WatchFormat.power(r.powerKw)).joinToString(" · ")
            else -> WatchFormat.range(r) ?: WatchFormat.ago(r.updatedAt, now)
        }
        val content = EdgeContentLayout.Builder(device)
            .setResponsiveContentInsetEnabled(true)
            .setEdgeContent(
                CircularProgressIndicator.Builder()
                    .setProgress(((r?.soc ?: 0.0) / 100).toFloat().coerceIn(0f, 1f))
                    .setCircularProgressIndicatorColors(ProgressIndicatorColors(ring, Palette.TRACK))
                    .build(),
            )
            .setPrimaryLabelTextContent(
                Text.Builder(context, status)
                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                    .setColor(argb(if (live) ring else Palette.DIM))
                    .build(),
            )
            .setContent(
                Text.Builder(context, WatchFormat.soc(r))
                    .setTypography(Typography.TYPOGRAPHY_DISPLAY1)
                    .setColor(argb(Palette.WHITE))
                    .build(),
            )
            .setSecondaryLabelTextContent(
                Text.Builder(context, detail)
                    .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                    .setColor(argb(Palette.DIM))
                    .build(),
            )
            .build()
        val open = ModifiersBuilders.Clickable.Builder()
            .setId("open")
            .setOnClick(
                ActionBuilders.LaunchAction.Builder()
                    .setAndroidActivity(
                        ActionBuilders.AndroidActivity.Builder()
                            .setPackageName(context.packageName)
                            .setClassName(MainActivity::class.java.name)
                            .build(),
                    )
                    .build(),
            )
            .build()
        return LayoutElementBuilders.Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).build())
            .addContent(content)
            .build()
    }

    private companion object {
        const val RESOURCES = "1"
    }
}

/** The Ocean Live colours as ARGB ints, for the tile. */
object Palette {
    const val AQUA = 0xFF2EE6C9.toInt()
    const val CYAN = 0xFF38BDF8.toInt()
    const val VIOLET = 0xFF8B7CF6.toInt()
    const val GOOD = 0xFF4ADE80.toInt()
    const val WARN = 0xFFFBBF24.toInt()
    const val BAD = 0xFFFB7185.toInt()
    const val DIM = 0xFF7E92A6.toInt()
    const val TRACK = 0xFF13233A.toInt()
    const val WHITE = 0xFFFFFFFF.toInt()
}
