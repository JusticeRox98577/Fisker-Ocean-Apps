package com.justicemw.oceanlive

import android.Manifest
import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.justicemw.oceanlive.car.Alerts
import com.justicemw.oceanlive.car.Car
import com.justicemw.oceanlive.car.CarState
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Status
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Keeps the Bluetooth connection alive while the screen is off or another app
 * (maps, Android Auto) is in front, and shows the live charge in the notification.
 */
class OceanService : Service() {
    private val scope = MainScope()
    private var locationListener: LocationListener? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Car.init(this)
        startInForeground(Car.state.value)
        scope.launch {
            Car.state.map { notificationText(it) }.distinctUntilChanged().collect {
                if (hasNotificationPermission()) {
                    try {
                        NotificationManagerCompat.from(this@OceanService).notify(ID, build(it))
                    } catch (_: SecurityException) {
                    }
                }
            }
        }
        scope.launch {
            Car.settings.combine(Car.state) { s, st -> s.abrpEnabled && s.abrpLocation && st.status == Status.Live }
                .distinctUntilChanged()
                .collect { want -> if (want) startLocation() else stopLocation() }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    override fun onDestroy() {
        stopLocation()
        scope.cancel()
        super.onDestroy()
    }

    private fun startInForeground(state: CarState) {
        var type = 0
        if (Build.VERSION.SDK_INT >= 29) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            if (hasLocationPermission() && Car.settings.value.abrpLocation) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        }
        try {
            ServiceCompat.startForeground(this, ID, build(notificationText(state)), type)
        } catch (_: Exception) {
            // Android refused (e.g. started from the background on 12+). Without it the app still works while open.
            stopSelf()
        }
    }

    private fun build(text: Pair<String, String>) = NotificationCompat.Builder(this, Alerts.CHANNEL_SERVICE)
        .setSmallIcon(R.drawable.ic_stat_ocean)
        .setContentTitle(text.first)
        .setContentText(text.second)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(Alerts.openApp(this))
        .addAction(0, getString(R.string.disconnect), android.app.PendingIntent.getBroadcast(
            this, 1, Intent(this, StopReceiver::class.java),
            android.app.PendingIntent.FLAG_IMMUTABLE,
        ))
        .build()

    private fun notificationText(s: CarState): Pair<String, String> {
        val soc = s.snapshot.soc?.let { "${it.roundToInt()}%" }
        val appName = getString(R.string.app_name)
        val adapter = s.adapterName ?: getString(R.string.adapter_generic)
        return when (s.status) {
            Status.Live -> {
                val power = s.snapshot.powerKw
                val what = when (s.mode) {
                    Mode.Charging -> power?.let { getString(R.string.notif_charging_at, Format.n(it, 1)) } ?: getString(R.string.status_charging)
                    Mode.Driving -> getString(R.string.status_driving)
                    Mode.Parked -> getString(R.string.notif_connected)
                }
                (soc?.let { getString(R.string.notif_ocean_soc, it) } ?: appName) to what
            }
            Status.Watching -> (s.snapshot.aux12v?.let { getString(R.string.notif_12v, Format.n(it, 2)) } ?: appName) to getString(R.string.notif_watching)
            Status.Reconnecting -> appName to getString(R.string.notif_reconnecting_to, adapter)
            else -> appName to getString(R.string.connecting_to, adapter)
        }
    }

    @SuppressLint("MissingPermission")
    private fun startLocation() {
        if (locationListener != null || !hasLocationPermission()) return
        val lm = getSystemService(LocationManager::class.java) ?: return
        val listener = LocationListener { Car.location = it }
        locationListener = listener
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            try {
                if (lm.isProviderEnabled(provider)) lm.requestLocationUpdates(provider, 5_000L, 10f, listener, Looper.getMainLooper())
            } catch (_: Exception) {
            }
        }
    }

    private fun stopLocation() {
        val listener = locationListener ?: return
        locationListener = null
        getSystemService(LocationManager::class.java)?.removeUpdates(listener)
        Car.location = null
    }

    private fun hasLocationPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasNotificationPermission() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val ID = 100

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, OceanService::class.java))
            } catch (_: Exception) {
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, OceanService::class.java))
        }
    }
}

/** The notification's Disconnect button. */
class StopReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Car.init(context)
        Car.disconnect()
    }
}
