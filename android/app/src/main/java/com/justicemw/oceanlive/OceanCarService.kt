package com.justicemw.oceanlive

import android.content.Intent
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
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = object : Session() {
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

        if (state.status != Status.Live && snap.soc == null) {
            pane.addRow(row("Not connected", "Open Ocean Live on your phone to connect to the adapter."))
        } else {
            val range = Format.range(snap.soc, settings, Car.history.value)
            pane.addRow(row("Charge " + (snap.soc?.let { "${Format.n(it, 1)}%" } ?: "—"), range?.let { "Range $it" } ?: ""))
            val power = snap.powerKw
            val doing = when (state.mode) {
                Mode.Charging -> "Charging" + (state.currentCharge?.let { " · %.1f kWh added".format(it.kwh) } ?: "")
                Mode.Driving -> "Driving"
                Mode.Parked -> "Parked"
            }
            pane.addRow(row("Power " + (power?.let { "${Format.n(it, 1)} kW" } ?: "—"), doing))
            pane.addRow(row(
                "Battery " + (Format.temp(snap.tempAvg, settings) ?: "—"),
                snap.cellSpread?.let { "Cell spread ${it.roundToInt()} mV" } ?: "",
            ))
            pane.addRow(row(
                "12V " + (snap.aux12v?.let { "${Format.n(it, 2)} V" } ?: "—"),
                if (state.status == Status.Live) "Live" else "Last reading",
            ))
        }
        return PaneTemplate.Builder(pane.build()).setTitle("Ocean Live").build()
    }

    private fun row(title: String, text: String): Row {
        val b = Row.Builder().setTitle(title)
        if (text.isNotBlank()) b.addText(text)
        return b.build()
    }
}
