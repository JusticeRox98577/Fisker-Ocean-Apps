package com.justice.oceanlive

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Shows the last known charge percent on the home screen. Updated from Engine whenever the charge changes. */
class OceanWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateOne(context, manager, id)
    }

    override fun onEnabled(context: Context) {
        refreshAll(context)
    }

    companion object {
        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, OceanWidget::class.java))
            for (id in ids) updateOne(context, manager, id)
        }

        private fun updateOne(context: Context, manager: AppWidgetManager, id: Int) {
            val prefs = context.getSharedPreferences("ocean", Context.MODE_PRIVATE)
            val soc = prefs.getString("estSOC", null)?.toDoubleOrNull()
            val views = RemoteViews(context.packageName, R.layout.widget_ocean)
            views.setTextViewText(R.id.widget_percent, if (soc == null) "--" else "${soc.toInt()}%")
            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)
            manager.updateAppWidget(id, views)
        }
    }
}
