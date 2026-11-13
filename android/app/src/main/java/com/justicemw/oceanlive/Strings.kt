package com.justicemw.oceanlive

import android.content.Context
import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

/**
 * Looks up text in the phone's language. Code outside Compose gets one from a
 * Context; unit tests use the English strings.xml, so pure logic stays testable.
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

/** The same inside Compose, refreshed when the language changes. */
@Composable
fun rememberStrings(): Strings {
    val context = LocalContext.current
    val config = LocalConfiguration.current
    return remember(context, config) { ResStrings(context.resources) }
}
