package com.justicemw.oceanlive.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/** The watch screen. Shows what the phone last sent; nothing here talks to the phone or the car. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LastReading.load(this)
        setContent { WatchScreen() }
    }

    override fun onStart() {
        super.onStart()
        // Reads the Data Layer item already on the watch. Doesn't ask the phone for a new one.
        lifecycleScope.launch {
            try {
                LastReading.fetch(this@MainActivity)
            } catch (_: Exception) {
            }
        }
    }
}
