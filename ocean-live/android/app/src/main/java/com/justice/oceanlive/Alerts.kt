package com.justice.oceanlive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Fires one notification each time the charge crosses a threshold the person picked. */
object Alerts {
    private const val CHANNEL_ID = "ocean_alerts"
    private const val NOTIF_HIGH = 101
    private const val NOTIF_LOW = 102
    private const val NOTIF_STOP = 103

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = nm.getNotificationChannel(CHANNEL_ID)
        if (existing == null) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                ctx.getString(R.string.nt_channel_alerts),
                NotificationManager.IMPORTANCE_HIGH
            )
            nm.createNotificationChannel(ch)
        }
    }

    private fun send(ctx: Context, id: Int, title: String, body: String) {
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notif)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (e: SecurityException) {
            // Notifications were not allowed. Nothing to do but skip it.
        }
    }

    fun chargeReachedHigh(ctx: Context, percent: Int) {
        send(
            ctx, NOTIF_HIGH,
            ctx.getString(R.string.nt_high_title, percent),
            ctx.getString(R.string.nt_high_body)
        )
    }

    fun chargeLow(ctx: Context, percent: Int) {
        send(
            ctx, NOTIF_LOW,
            ctx.getString(R.string.nt_low_title),
            ctx.getString(R.string.nt_low_body, percent)
        )
    }

    fun chargingStopped(ctx: Context, percent: Int) {
        send(
            ctx, NOTIF_STOP,
            ctx.getString(R.string.nt_stop_title),
            ctx.getString(R.string.nt_stop_body, percent)
        )
    }
}
