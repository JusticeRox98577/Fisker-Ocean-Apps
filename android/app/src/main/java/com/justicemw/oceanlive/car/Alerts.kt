package com.justicemw.oceanlive.car

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.justicemw.oceanlive.MainActivity
import com.justicemw.oceanlive.R
import kotlin.math.roundToInt

/** Charge and battery-health notifications. Decides when to fire; never repeats itself. */
class Alerts(private val context: Context) {
    private var highSent = false
    private var lowSent = false
    private val healthSent = mutableSetOf<String>()

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ALERTS, "Charge and battery alerts", NotificationManager.IMPORTANCE_HIGH))
            nm.createNotificationChannel(NotificationChannel(CHANNEL_SERVICE, "Connection", NotificationManager.IMPORTANCE_LOW))
        }
    }

    fun check(s: Snapshot, mode: Mode, settings: Settings) {
        val soc = s.soc
        if (settings.alertsOn && soc != null) {
            if (mode == Mode.Charging && soc >= settings.alertHigh && !highSent) {
                highSent = true
                notify(1, "Charged to ${settings.alertHigh}%", "Your Ocean reached the level you set.")
            }
            if (mode != Mode.Charging) highSent = false
            if (soc <= settings.alertLow && !lowSent && mode != Mode.Charging) {
                lowSent = true
                notify(2, "Charge is low", "The battery is at ${soc.roundToInt()}%.")
            }
            if (soc > settings.alertLow + 3) lowSent = false
        }
        if (settings.healthAlerts) {
            s.aux12v?.let { if (it < 11.8 && mode != Mode.Driving) health("12v", "12V battery is low", "It reads %.2f V. A weak 12V battery can stop the Ocean from waking up.".format(it)) }
            s.cellSpread?.let { if (it > 80) health("cells", "Cell voltages are uneven", "Highest and lowest cells differ by ${it.roundToInt()} mV.") }
            s.tempMax?.let { if (it > 55) health("temp", "Battery is hot", "Hottest battery sensor reads ${it.roundToInt()} °C.") }
        }
    }

    /** Low 12V seen while the car sleeps (see [LowVoltAlarm]); uses the Battery warnings switch. */
    fun low12v(level: LowVoltAlarm.Level, volts: Double, settings: Settings) {
        if (!settings.healthAlerts) return
        val v = "%.2f V".format(volts)
        when (level) {
            LowVoltAlarm.Level.Low -> notify(20, "12V battery is getting low",
                "It reads $v while the car sleeps. Something may be drawing power, or the 12V battery is weak.")
            LowVoltAlarm.Level.VeryLow -> notify(21, "12V battery is very low",
                "It reads $v while the car sleeps. The Ocean may not wake up. Drive it or charge the 12V soon.")
        }
    }

    fun chargingStopped(entry: HistoryEntry, settings: Settings) {
        if (!settings.alertsOn || !settings.alertStop) return
        val soc = entry.socEnd?.roundToInt()
        notify(3, "Charging stopped", (if (soc != null) "Charge is at $soc%. " else "") + "Added %.1f kWh.".format(entry.kwh))
    }

    /** Called on each new connection so health warnings can fire again for a new day. */
    fun resetHealth() = healthSent.clear()

    private fun health(key: String, title: String, body: String) {
        if (healthSent.add(key)) notify(10 + healthSent.size, title, body)
    }

    private fun notify(id: Int, title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val n = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_ocean)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (_: SecurityException) {
        }
    }

    companion object {
        const val CHANNEL_ALERTS = "alerts"
        const val CHANNEL_SERVICE = "service"

        fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
