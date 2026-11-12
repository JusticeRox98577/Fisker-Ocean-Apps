package com.justicemw.oceanlive.wear

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

/** Battery % for a watch face, as short text or a ring. Updated when the phone sends a reading. */
class OceanComplicationService : SuspendingComplicationDataSourceService() {
    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        data(this, type, WatchReading(soc = 72.0, updatedAt = 1))

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? =
        data(this, request.complicationType, LastReading.load(this))

    companion object {
        fun data(context: Context, type: ComplicationType, r: WatchReading?): ComplicationData? {
            val soc = r?.soc ?: return NoDataComplicationData()
            val text = PlainComplicationText.Builder(WatchFormat.soc(r)).build()
            val title = PlainComplicationText.Builder(if (r.charging) "Charging" else "Ocean").build()
            val description = PlainComplicationText.Builder("Ocean battery ${WatchFormat.soc(r)}").build()
            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            return when (type) {
                ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text, description)
                    .setTitle(title)
                    .setTapAction(open)
                    .build()
                ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(
                    value = soc.toFloat().coerceIn(0f, 100f), min = 0f, max = 100f, contentDescription = description,
                )
                    .setText(text)
                    .setTitle(title)
                    .setTapAction(open)
                    .build()
                else -> null
            }
        }
    }
}
