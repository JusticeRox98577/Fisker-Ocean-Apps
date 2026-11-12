package com.justicemw.oceanlive.wear

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.core.content.edit
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * The last reading from the phone, kept on the watch so the screen, tile and
 * complication can show it without asking the phone for anything.
 */
object LastReading {
    private const val PREFS = "ocean_watch"
    private const val KEY = "last"

    private val _reading = MutableStateFlow<WatchReading?>(null)
    val reading: StateFlow<WatchReading?> = _reading.asStateFlow()

    fun load(context: Context): WatchReading? {
        _reading.value?.let { return it }
        val saved = try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)?.let { text ->
                val json = JSONObject(text)
                WatchReading.fromMap(json.keys().asSequence().associateWith { json.get(it) })
            }
        } catch (_: Exception) {
            null
        }
        if (saved != null) _reading.value = saved
        return saved
    }

    /** Saves a newer reading and refreshes the tile and complication. Older ones are ignored. */
    fun save(context: Context, r: WatchReading) {
        val current = load(context)
        if (current != null && current.updatedAt > r.updatedAt) return
        _reading.value = r
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit {
            putString(KEY, JSONObject(r.toMap()).toString())
        }
        TileService.getUpdater(context).requestUpdate(OceanTileService::class.java)
        ComplicationDataSourceUpdateRequester
            .create(context, ComponentName(context, OceanComplicationService::class.java))
            .requestUpdateAll()
    }

    fun fromDataItem(item: DataItem): WatchReading? {
        if (item.uri.path != WatchReading.PATH) return null
        val map = DataMapItem.fromDataItem(item).dataMap
        return WatchReading.fromMap(map.keySet().associateWith { map.get<Any>(it) })
    }

    /** Picks up the item the phone last wrote, e.g. one sent while this app wasn't running. */
    suspend fun fetch(context: Context) {
        val uri = Uri.Builder().scheme("wear").path(WatchReading.PATH).build()
        val buffer = Wearable.getDataClient(context).getDataItems(uri).await()
        val newest = try {
            buffer.mapNotNull { fromDataItem(it) }.maxByOrNull { it.updatedAt }
        } finally {
            buffer.release()
        }
        newest?.let { save(context, it) }
    }
}
