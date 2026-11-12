package com.justicemw.oceanlive

import android.content.Context
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.justicemw.oceanlive.car.WatchReading
import com.justicemw.oceanlive.car.WatchSync
import com.justicemw.oceanlive.car.WatchThrottle

/**
 * Sends the latest reading to a paired Wear OS watch through the Data Layer.
 * One way only: nothing the watch does reaches the car.
 */
class WatchLink(context: Context) {
    private val app = context.applicationContext
    private val throttle = WatchThrottle()
    /** Off for the rest of the run once we learn this phone has no Wear OS support. */
    private var unavailable = false

    fun update(reading: WatchReading) {
        if (unavailable || !throttle.shouldSend(reading, System.currentTimeMillis())) return
        try {
            val request = PutDataMapRequest.create(WatchSync.PATH).apply {
                val map = dataMap
                reading.toMap().forEach { (key, value) ->
                    when (value) {
                        is Double -> map.putDouble(key, value)
                        is Long -> map.putLong(key, value)
                        is Int -> map.putInt(key, value)
                        is Boolean -> map.putBoolean(key, value)
                        is String -> map.putString(key, value)
                    }
                }
            }.asPutDataRequest().setUrgent()
            Wearable.getDataClient(app).putDataItem(request).addOnFailureListener { e ->
                if (e is ApiException && e.statusCode == CommonStatusCodes.API_NOT_CONNECTED) unavailable = true
            }
        } catch (_: Exception) {
            unavailable = true
        }
    }
}
