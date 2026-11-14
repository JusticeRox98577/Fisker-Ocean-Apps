package com.justicemw.oceanlive.car

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R
import kotlin.math.abs

/** Why clearing codes or restarting a module can't go ahead (or why a run stopped part way). */
enum class ChangeBlock(@StringRes val text: Int) {
    NotConnected(R.string.blocked_not_connected),
    Driving(R.string.blocked_driving),
    Charging(R.string.blocked_charging),
    /** Fewer than two odometer readings on this connection. */
    WaitingOdometer(R.string.blocked_wait_odometer),
    /** The newest odometer reading is too old. */
    StaleOdometer(R.string.blocked_odometer_stale),
    Moved(R.string.blocked_moved),
    /** No battery power reading, or only an old one. */
    WaitingPower(R.string.blocked_wait_power),
    /** Power flows in or out of the pack: charging, climate on, or driving. */
    PowerFlowing(R.string.blocked_power),
    /** A fresh check part way through an action got no answer. */
    NoAnswer(R.string.blocked_no_answer),
}

/**
 * Fresh evidence from the current connection that the car is standing still and nothing
 * is drawing or putting in power, before codes are cleared or a module is restarted.
 * The inferred [Mode] alone isn't enough: it starts as Parked on every connection.
 * Pure logic so it can be unit tested; [reset] whenever the connection ends or starts again.
 */
class ChangeEvidence {
    private var prevOdo: Double? = null
    private var lastOdo: Double? = null
    private var lastOdoAt = 0L
    private var power: Double? = null
    private var powerAt = 0L

    /** Bumped by every [reset], so a run can tell the connection changed under it. */
    var session = 0
        private set

    /** The newest odometer reading on this connection, km. */
    val latestOdometer: Double? get() = lastOdo

    fun odometer(km: Double, time: Long) {
        prevOdo = lastOdo
        lastOdo = km
        lastOdoAt = time
    }

    /** Battery power in kW; the sign doesn't matter. */
    fun power(kw: Double, time: Long) {
        power = kw
        powerAt = time
    }

    fun reset() {
        prevOdo = null
        lastOdo = null
        lastOdoAt = 0L
        power = null
        powerAt = 0L
        session++
    }

    /** Why a clear or restart can't run now, or null when the evidence says it's safe. */
    fun check(connected: Boolean, mode: Mode, now: Long): ChangeBlock? {
        val last = lastOdo
        val prev = prevOdo
        val kw = power
        return when {
            !connected -> ChangeBlock.NotConnected
            mode == Mode.Driving -> ChangeBlock.Driving
            mode == Mode.Charging -> ChangeBlock.Charging
            last == null || prev == null -> ChangeBlock.WaitingOdometer
            now - lastOdoAt > ChangeGuard.MAX_ODOMETER_AGE_MS -> ChangeBlock.StaleOdometer
            ChangeGuard.moved(prev, last) -> ChangeBlock.Moved
            kw == null || now - powerAt > ChangeGuard.MAX_POWER_AGE_MS -> ChangeBlock.WaitingPower
            !ChangeGuard.powerQuiet(kw) -> ChangeBlock.PowerFlowing
            else -> null
        }
    }
}

object ChangeGuard {
    /** The newest odometer reading may be at most this old (it is read every 10 s). */
    const val MAX_ODOMETER_AGE_MS = 25_000L
    /** The battery power reading may be at most this old (it is read every 2 s). */
    const val MAX_POWER_AGE_MS = 6_000L
    /** Power in either direction must stay under this. */
    const val MAX_POWER_KW = 1.0

    /** The odometer counts in steps of 0.01 km; any step at all counts as moving. */
    fun moved(fromKm: Double, toKm: Double): Boolean = abs(toKm - fromKm) >= 0.005

    /** Under [MAX_POWER_KW] whichever way it flows, so the flip-current setting can't defeat it. */
    fun powerQuiet(kw: Double): Boolean = abs(kw) < MAX_POWER_KW

    /**
     * The check between modules of a run, from readings taken just now: [startKm] is the
     * odometer when the run started. Null when it can carry on.
     */
    fun midAction(startKm: Double, odometerKm: Double?, powerKw: Double?): ChangeBlock? = when {
        odometerKm == null || powerKw == null -> ChangeBlock.NoAnswer
        moved(startKm, odometerKm) -> ChangeBlock.Moved
        !powerQuiet(powerKw) -> ChangeBlock.PowerFlowing
        else -> null
    }
}
