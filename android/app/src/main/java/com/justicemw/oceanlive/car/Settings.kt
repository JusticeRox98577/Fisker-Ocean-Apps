package com.justicemw.oceanlive.car

import android.content.Context
import android.content.SharedPreferences
import androidx.annotation.StringRes
import androidx.core.content.edit
import com.justicemw.oceanlive.R

enum class CarModel(@StringRes val label: Int, val usableKwh: Double) {
    Big(R.string.model_big, 106.5),
    Sport(R.string.model_sport, 75.0),
    Custom(R.string.model_custom, 0.0),
}

/** Everything the user can change, stored in SharedPreferences. */
data class Settings(
    val adapterAddress: String? = null,
    val adapterName: String? = null,
    val autoStart: Boolean = true,
    val keepScreenOn: Boolean = true,
    val useMiles: Boolean = true,
    val useFahrenheit: Boolean = true,
    val model: CarModel = CarModel.Big,
    val customKwh: Double = 106.5,
    val alertsOn: Boolean = false,
    val alertHigh: Int = 80,
    val alertLow: Int = 20,
    val alertStop: Boolean = true,
    val healthAlerts: Boolean = true,
    val abrpToken: String = "",
    val abrpKey: String = "",
    val abrpEverySec: Int = 10,
    val abrpLocation: Boolean = false,
    val flipCurrent: Boolean = false,
    val currency: String = "$",
    /** Home (AC) charging price per kWh. 0 means not set. */
    val homePrice: Double = 0.0,
    /** DC fast charging price per kWh. 0 means not set. */
    val dcPrice: Double = 0.0,
    /** Check the 12V while the car sleeps by asking the adapter (only it); see [watchKeepConnected]. */
    val watch12v: Boolean = false,
    /** Minutes between 12V checks while the car sleeps: 5, 10 or 30. */
    val watchEveryMin: Int = V12Watch.DEFAULT_INTERVAL,
    /**
     * Keep the adapter connected (and awake) between 12V checks instead of connecting
     * briefly for each one. Only for adapters that can't be woken over Bluetooth.
     */
    val watchKeepConnected: Boolean = false,
) {
    val usableKwh: Double get() = if (model == CarModel.Custom) customKwh else model.usableKwh
    val abrpEnabled: Boolean get() = abrpToken.isNotBlank() && abrpKey.isNotBlank()

    companion object {
        fun load(p: SharedPreferences) = Settings(
            adapterAddress = p.getString("adapter_address", null),
            adapterName = p.getString("adapter_name", null),
            autoStart = p.getBoolean("auto_start", true),
            keepScreenOn = p.getBoolean("keep_screen_on", true),
            useMiles = p.getBoolean("use_miles", true),
            useFahrenheit = p.getBoolean("use_f", true),
            model = runCatching { CarModel.valueOf(p.getString("model", "Big")!!) }.getOrDefault(CarModel.Big),
            customKwh = p.getFloat("custom_kwh", 106.5f).toDouble(),
            alertsOn = p.getBoolean("alerts_on", false),
            alertHigh = p.getInt("alert_high", 80),
            alertLow = p.getInt("alert_low", 20),
            alertStop = p.getBoolean("alert_stop", true),
            healthAlerts = p.getBoolean("health_alerts", true),
            abrpToken = p.getString("abrp_token", "")!!,
            abrpKey = p.getString("abrp_key", "")!!,
            abrpEverySec = p.getInt("abrp_every", 10),
            abrpLocation = p.getBoolean("abrp_location", false),
            flipCurrent = p.getBoolean("flip_current", false),
            currency = p.getString("currency", "$")!!,
            homePrice = p.getFloat("home_price", 0f).toString().toDouble(), // via String so 0.15 stays 0.15
            dcPrice = p.getFloat("dc_price", 0f).toString().toDouble(),
            watch12v = p.getBoolean("watch_12v", false),
            watchEveryMin = p.getInt("watch_every", V12Watch.DEFAULT_INTERVAL).takeIf { it in V12Watch.INTERVALS } ?: V12Watch.DEFAULT_INTERVAL,
            watchKeepConnected = p.getBoolean("watch_keep_connected", false),
        )

        fun prefs(context: Context): SharedPreferences =
            context.getSharedPreferences("ocean_live", Context.MODE_PRIVATE)
    }

    fun save(p: SharedPreferences) = p.edit {
        putString("adapter_address", adapterAddress)
        putString("adapter_name", adapterName)
        putBoolean("auto_start", autoStart)
        putBoolean("keep_screen_on", keepScreenOn)
        putBoolean("use_miles", useMiles)
        putBoolean("use_f", useFahrenheit)
        putString("model", model.name)
        putFloat("custom_kwh", customKwh.toFloat())
        putBoolean("alerts_on", alertsOn)
        putInt("alert_high", alertHigh)
        putInt("alert_low", alertLow)
        putBoolean("alert_stop", alertStop)
        putBoolean("health_alerts", healthAlerts)
        putString("abrp_token", abrpToken)
        putString("abrp_key", abrpKey)
        putInt("abrp_every", abrpEverySec)
        putBoolean("abrp_location", abrpLocation)
        putBoolean("flip_current", flipCurrent)
        putString("currency", currency)
        putFloat("home_price", homePrice.toFloat())
        putFloat("dc_price", dcPrice.toFloat())
        putBoolean("watch_12v", watch12v)
        putInt("watch_every", watchEveryMin)
        putBoolean("watch_keep_connected", watchKeepConnected)
    }
}
