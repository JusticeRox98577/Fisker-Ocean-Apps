package com.justicemw.oceanlive.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

/** Woken by Wear OS when the phone writes a new reading. Only listens; sends nothing back. */
class DataListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        events.filter { it.type == DataEvent.TYPE_CHANGED }
            .mapNotNull { LastReading.fromDataItem(it.dataItem) }
            .maxByOrNull { it.updatedAt }
            ?.let { LastReading.save(this, it) }
    }
}
