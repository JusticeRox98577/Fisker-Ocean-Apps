package com.justicemw.oceanlive.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.justicemw.oceanlive.R

/** What the app opens on: the OBD dashboard, or Nova. */
@Composable
fun StartScreen(onObd: () -> Unit, onNova: () -> Unit) {
    Column(Modifier.fillMaxSize().navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                stringResource(R.string.home_title), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            Choice("◉", stringResource(R.string.home_obd_title), stringResource(R.string.home_obd_body), onObd)
            Choice("✦", stringResource(R.string.home_nova_title), stringResource(R.string.home_nova_body), onNova)
        }
    }
}

@Composable
private fun Choice(glyph: String, title: String, body: String, onClick: () -> Unit) {
    Card(Modifier.clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button, onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(glyph, color = Aqua, fontSize = 34.sp, modifier = Modifier.padding(end = 16.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(body, color = Dim, fontSize = 14.sp, lineHeight = 20.sp)
            }
            Text("›", color = Aqua, fontSize = 28.sp, modifier = Modifier.padding(start = 8.dp))
        }
    }
}

/** The Nova section, on its own page. */
@Composable
fun NovaScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 24.dp),
        ) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "‹ " + stringResource(R.string.ask_back), color = Aqua, fontSize = 15.sp,
                    modifier = Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp))
                        .clickable(role = Role.Button, onClick = onBack).padding(vertical = 12.dp, horizontal = 4.dp),
                )
            }
            Text(
                stringResource(R.string.home_nova_title), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            NovaSection()
        }
    }
}
