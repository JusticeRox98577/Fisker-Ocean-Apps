package com.justice.obdsim

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    private var sim: Simulator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Screen() }
    }

    override fun onDestroy() {
        sim?.stop()
        super.onDestroy()
    }

    @androidx.compose.runtime.Composable
    private fun Screen() {
        var st by remember { mutableStateOf(SimState()) }
        val simulator = remember { Simulator(applicationContext) { st = it }.also { sim = it } }
        val perms = if (Build.VERSION.SDK_INT >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN)
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
            if (r.values.all { it }) simulator.start()
        }
        val cyan = Color(0xFF4CC3E6)
        Column(
            Modifier
                .fillMaxSize()
                .background(Color(0xFF08162E))
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("OBD Adapter Simulator", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text(st.status, color = if (st.connected) Color(0xFF34C759) else Color(0xFF93A6B5))
            Button(
                onClick = { if (st.advertising) simulator.stop() else launcher.launch(perms) },
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (st.advertising) "Stop" else "Start as vLinker FD") }

            Text("Car state", color = cyan, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Mode.values().forEach { m ->
                    if (m == st.mode) Button(onClick = { simulator.setMode(m) }) { Text(m.label) }
                    else OutlinedButton(onClick = { simulator.setMode(m) }) { Text(m.label) }
                }
            }
            Text("Charge " + String.format("%.1f", st.soc) + "%", color = Color.White)
            Slider(value = st.soc.toFloat(), onValueChange = { simulator.setSoc(it.toDouble()) }, valueRange = 0f..100f)
            Text("Battery temp " + String.format("%.0f", st.tempC) + " C", color = Color.White)
            Slider(value = st.tempC.toFloat(), onValueChange = { simulator.setTemp(it.toDouble()) }, valueRange = -10f..45f)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Charge drifts while driving or charging", color = Color.White, modifier = Modifier.weight(1f))
                Switch(checked = st.drift, onCheckedChange = { simulator.setDrift(it) })
            }
            Text("Recent commands", color = cyan, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            st.log.forEach { Text(it, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color(0xFF93A6B5)) }
            Text(
                "Open Ocean Live on the iPhone and tap Look for adapters. Pick vLinker FD, then Start. Everything shown is made up.",
                fontSize = 13.sp, color = Color(0xFF93A6B5)
            )
        }
    }
}
