package com.justicemw.oceanlive.car

import com.justicemw.oceanlive.Format
import kotlin.math.roundToInt

/**
 * What the watch shows: a copy of the latest reading the phone already has.
 * The watch never asks the phone for anything, so it can't wake the car.
 */
data class WatchReading(
    val soc: Double?,
    val rangeKm: Double?,
    val powerKw: Double?,
    val charging: Boolean,
    val fast: Boolean,
    val minutesToTarget: Long?,
    val targetPercent: Int,
    val aux12v: Double?,
    /** In English: a fixed value the watch app turns into its own language. */
    val status: String,
    /** The phone is reading the car right now. */
    val live: Boolean,
    val miles: Boolean,
    /** Time of the reading, not of sending. */
    val updatedAt: Long,
) {
    /** The values a person would notice changing, rounded so noise doesn't count. */
    val key: List<Any?>
        get() = listOf(
            soc?.let { (it * 10).roundToInt() }, rangeKm?.roundToInt(), powerKw?.let { (it * 10).roundToInt() },
            charging, fast, minutesToTarget, targetPercent, aux12v?.let { (it * 10).roundToInt() }, status, live, miles,
        )

    /** As stored in the Data Layer item. Unknown values are left out. Keys match the watch app. */
    fun toMap(): Map<String, Any> = buildMap {
        soc?.let { put("soc", it) }
        rangeKm?.let { put("rangeKm", it) }
        powerKw?.let { put("powerKw", it) }
        put("charging", charging)
        put("fast", fast)
        minutesToTarget?.let { put("minutesToTarget", it) }
        put("targetPercent", targetPercent)
        aux12v?.let { put("aux12v", it) }
        put("status", status)
        put("live", live)
        put("miles", miles)
        put("updatedAt", updatedAt)
    }
}

object WatchSync {
    const val PATH = "/ocean/live"
    /** Values that change while reading go out at most this often. */
    const val MIN_GAP_MS = 15_000L
    /** While live with nothing changing, send now and then so the watch knows the reading is current. */
    const val REFRESH_MS = 60_000L

    fun reading(state: CarState, settings: Settings, history: List<HistoryEntry>): WatchReading {
        val snap = state.snapshot
        val live = state.status == Status.Live && state.lastUpdate != null
        val charging = live && state.mode == Mode.Charging
        val fast = charging && state.currentCharge?.fast == true
        return WatchReading(
            soc = snap.soc,
            rangeKm = Format.rangeKm(snap.soc, settings, history),
            powerKw = if (live) snap.powerKw else null,
            charging = charging,
            fast = fast,
            minutesToTarget = if (charging) Format.minutesToTarget(snap.soc, snap.powerKw, settings) else null,
            targetPercent = settings.alertHigh,
            aux12v = snap.aux12v,
            status = when {
                charging -> if (fast) "DC fast charging" else "Charging"
                live && state.mode == Mode.Driving -> "Driving"
                live -> "Parked"
                state.status == Status.Reconnecting -> "Reconnecting"
                else -> "Not connected"
            },
            live = live,
            miles = settings.useMiles,
            updatedAt = state.lastUpdate ?: 0L,
        )
    }
}

/**
 * Decides when to send a reading to the watch. Pure so it can be unit tested.
 * Only sends after a real reading, then once more when reading stops.
 */
class WatchThrottle {
    private var lastKey: List<Any?>? = null
    private var lastStatus: String? = null
    private var lastLive = false
    private var lastAt = 0L

    fun shouldSend(next: WatchReading, now: Long): Boolean {
        val send = when {
            // Nothing sent yet: wait for a fresh reading, don't announce "not connected" at app start.
            lastKey == null -> next.live
            // The phone started or stopped reading, or the status changed: tell the watch now.
            next.live != lastLive || next.status != lastStatus -> true
            next.key == lastKey -> next.live && now - lastAt >= WatchSync.REFRESH_MS
            else -> next.live && now - lastAt >= WatchSync.MIN_GAP_MS
        }
        if (send) {
            lastKey = next.key
            lastStatus = next.status
            lastLive = next.live
            lastAt = now
        }
        return send
    }
}
