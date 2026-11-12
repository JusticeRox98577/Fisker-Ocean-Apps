package com.justicemw.oceanlive.car

import android.content.Context
import java.io.File

/** 12V readings, one compact line each, in the app's private storage. Kept for 90 days. */
class V12Store(context: Context) {
    private val file = File(context.filesDir, "v12.log")

    /** Loads the readings and drops any older than 90 days. */
    fun load(now: Long = System.currentTimeMillis()): List<V12Sample> = try {
        if (!file.exists()) emptyList() else {
            val all = V12Log.decodeAll(file.readText())
            val kept = V12Log.trim(all, now)
            if (kept.size != all.size) save(kept)
            kept
        }
    } catch (_: Exception) {
        emptyList()
    }

    fun append(sample: V12Sample) {
        try {
            file.appendText(V12Log.encode(sample) + "\n")
        } catch (_: Exception) {
        }
    }

    fun save(samples: List<V12Sample>) {
        val tmp = File(file.parentFile, "v12.log.tmp")
        tmp.writeText(samples.joinToString("") { V12Log.encode(it) + "\n" })
        tmp.renameTo(file)
    }
}
