package com.justicemw.oceanlive

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.justicemw.oceanlive.car.Car
import com.justicemw.oceanlive.car.Mode
import com.justicemw.oceanlive.car.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Android Auto: a read-only dashboard of the same live data the phone shows. */
class OceanCarService : CarAppService() {
    /**
     * The service is exported, so only Android Auto hosts signed by Google may bind to it.
     * Debug builds accept any host, for the desktop head unit. The allowlist is the one the
     * car-app library ships and Google's documentation uses (lint calls it private).
     */
    @SuppressLint("PrivateResource")
    override fun createHostValidator(): HostValidator =
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(): Session = object : Session() {
        init {
            // While Android Auto shows the app, keep reading even with the phone screen off.
            lifecycle.addObserver(object : DefaultLifecycleObserver {
                override fun onCreate(owner: LifecycleOwner) {
                    Car.init(carContext)
                    Car.setCarScreenConnected(true)
                }

                override fun onDestroy(owner: LifecycleOwner) {
                    Car.setCarScreenConnected(false)
                }
            })
        }

        override fun onCreateScreen(intent: Intent): Screen {
            Car.init(carContext)
            return DashScreen(carContext)
        }
    }
}

class DashScreen(context: CarContext) : Screen(context) {
    private var scope: CoroutineScope? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                val s = MainScope()
                scope = s
                // Templates have a refresh budget, so redraw at a calm pace rather than on every reading.
                s.launch {
                    while (true) {
                        delay(5_000)
                        invalidate()
                    }
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                scope?.cancel()
                scope = null
            }
        })
    }

    override fun onGetTemplate(): Template {
        val state = Car.state.value
        val settings = Car.settings.value
        val snap = state.snapshot
        val pane = Pane.Builder()
        val c = carContext

        if (state.status != Status.Live && snap.soc == null) {
            pane.addRow(row(c.getString(R.string.status_not_connected), c.getString(R.string.auto_open_phone)))
        } else {
            val range = Format.range(snap.soc, settings, Car.history.value)
            pane.addRow(row(c.getString(R.string.auto_charge, snap.soc?.let { "${Format.n(it, 1)}%" } ?: "—"), range?.let { c.getString(R.string.auto_range, it) } ?: ""))
            val power = snap.powerKw
            val doing = when (state.mode) {
                Mode.Charging -> c.getString(R.string.status_charging) +
                    (state.currentCharge?.let { " · " + c.getString(R.string.auto_kwh_added, Format.n(it.kwh, 1)) } ?: "")
                Mode.Driving -> c.getString(R.string.status_driving)
                Mode.Parked -> c.getString(R.string.status_parked)
            }
            pane.addRow(row(c.getString(R.string.auto_power, power?.let { "${Format.n(it, 1)} kW" } ?: "—"), doing))
            pane.addRow(row(
                c.getString(R.string.auto_battery, Format.temp(snap.tempAvg, settings) ?: "—"),
                snap.cellSpread?.let { c.getString(R.string.auto_cell_spread, it.roundToInt()) } ?: "",
            ))
            pane.addRow(row(
                "12V " + (snap.aux12v?.let { "${Format.n(it, 2)} V" } ?: "—"),
                c.getString(if (state.status == Status.Live) R.string.auto_live else R.string.last_reading),
            ))
        }
        return PaneTemplate.Builder(pane.build()).setTitle(c.getString(R.string.app_name)).build()
    }

    private fun row(title: String, text: String): Row {
        val b = Row.Builder().setTitle(title)
        if (text.isNotBlank()) b.addText(text)
        return b.build()
    }
}
