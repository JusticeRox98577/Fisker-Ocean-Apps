package com.justicemw.oceanlive.car

import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.Strings

/** Why the first connect of a session failed, when that says more than the error itself. */
enum class ConnectFailure {
    /** The Bluetooth link never came up: the adapter is asleep, out of range or held by another app. */
    Unreachable,

    /** The link came up but the adapter didn't answer its set-up commands. */
    NoAnswer,
}

/**
 * What to tell the user when the adapter can't be used, and how to spot the saved adapter
 * at a new Bluetooth address (a vLinker MC+ gets a new one each time it is plugged in).
 * Pure logic so it can be unit tested.
 */
object AdapterHelp {
    /** The one search for the saved adapter at a new address stops after this long. */
    const val MOVED_SEARCH_MS = 8_000L

    /**
     * What a failed first connect means. [linkUp]: the Bluetooth link was ready before it failed.
     * Null when the error's own message says it better: not an OBD adapter, or Bluetooth off.
     */
    fun failure(linkUp: Boolean, notObd: Boolean, bluetoothOn: Boolean): ConnectFailure? = when {
        notObd || !bluetoothOn -> null
        linkUp -> ConnectFailure.NoAnswer
        else -> ConnectFailure.Unreachable
    }

    /** vLinkers only wake up by themselves in an electric car with newer firmware. */
    fun isVlinker(adapterName: String?): Boolean = adapterName?.contains("vlinker", ignoreCase = true) == true

    /** The message for [failure], with the vLinker firmware note under it when the saved adapter is one. */
    fun message(failure: ConnectFailure, adapterName: String?, strings: Strings): String {
        val text = strings.get(
            when (failure) {
                ConnectFailure.Unreachable -> R.string.connect_unreachable
                ConnectFailure.NoAnswer -> R.string.connect_no_answer
            },
        )
        return if (isVlinker(adapterName)) text + "\n" + strings.get(R.string.connect_vlinker_firmware) else text
    }

    /** Whether the saved name is specific enough to look for: not blank and not the generic fallback name. */
    fun canLookForMoved(savedName: String?, fallbackName: String): Boolean {
        val saved = savedName?.trim()
        return !saved.isNullOrEmpty() && saved != fallbackName.trim()
    }

    /**
     * Whether an adapter seen in a search looks like the saved one at a new Bluetooth address:
     * the same name (trimmed, exact, case-sensitive) at a different address. Only ever offered
     * to the user, never used by itself: another Ocean's adapter can have the same name.
     */
    fun isMoved(savedName: String?, savedAddress: String, fallbackName: String, name: String?, address: String): Boolean =
        canLookForMoved(savedName, fallbackName) &&
            !address.equals(savedAddress, ignoreCase = true) &&
            name?.trim() == savedName?.trim()
}
