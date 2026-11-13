package com.justicemw.oceanlive.wear

import android.content.Context
import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes

/**
 * Looks up text in the watch's language. Unit tests use the English
 * strings.xml, so the formatting stays testable without a watch.
 */
interface Strings {
    fun get(@StringRes id: Int, vararg args: Any): String
    fun plural(@PluralsRes id: Int, count: Int, vararg args: Any): String
}

private class ResStrings(private val res: Resources) : Strings {
    override fun get(id: Int, vararg args: Any): String =
        if (args.isEmpty()) res.getString(id) else res.getString(id, *args)

    override fun plural(id: Int, count: Int, vararg args: Any): String =
        if (args.isEmpty()) res.getQuantityString(id, count) else res.getQuantityString(id, count, *args)
}

/** Text from this context's resources (context.getString underneath). */
fun Context.strings(): Strings = ResStrings(resources)
