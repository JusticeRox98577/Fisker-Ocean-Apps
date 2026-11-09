package com.justicemw.oceanlive

import android.app.Application
import com.justicemw.oceanlive.car.Car

class OceanApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Car.init(this)
    }
}
