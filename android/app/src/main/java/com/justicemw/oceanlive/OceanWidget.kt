package com.justicemw.oceanlive

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import com.justicemw.oceanlive.car.Car
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Status
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt

/** Home-screen widget with the charge, the range and what the car is doing. */
class OceanWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        Car.init(context)
        ids.forEach { manager.updateAppWidget(it, views(context)) }
    }

    companion object {
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, OceanWidget::class.java))
            if (ids.isNotEmpty()) ids.forEach { manager.updateAppWidget(it, views(context)) }
        }

        private fun views(context: Context): RemoteViews {
            val state = Car.state.value
            val settings = Car.settings.value
            val snap = state.snapshot
            val v = RemoteViews(context.packageName, R.layout.widget_ocean)
            v.setTextViewText(R.id.widget_soc, snap.soc?.let { "${it.roundToInt()}%" } ?: "—")
            val range = Format.range(snap.soc, settings, Car.history.value)
            v.setTextViewText(R.id.widget_range, range ?: "")
            val status = when {
                state.status == Status.Live && state.mode == Mode.Charging ->
                    "Charging" + (snap.powerKw?.let { " · %.1f kW".format(it) } ?: "")
                state.status == Status.Live && state.mode == Mode.Driving -> "Driving"
                state.status == Status.Live -> "Live"
                state.lastUpdate != null -> "As of " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(state.lastUpdate))
                else -> "Tap to connect"
            }
            v.setTextViewText(R.id.widget_status, status)
            v.setOnClickPendingIntent(R.id.widget_root, com.justicemw.oceanlive.car.Alerts.openApp(context))
            return v
        }
    }
}
