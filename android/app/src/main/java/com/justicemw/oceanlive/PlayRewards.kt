package com.justicemw.oceanlive

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.widget.Toast
import androidx.annotation.StringRes
import androidx.core.content.edit
import com.android.billingclient.api.Purchase
import com.justicemw.oceanlive.car.Accounts
import com.justicemw.oceanlive.car.Balance
import com.justicemw.oceanlive.car.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The Google Play pre-registration reward: US$5 of balance and the Early supporter badge.
 * Google Play delivers it as a purchase of [Balance.REWARD_PRODUCT] made outside the app, which
 * [TipJar] finds with its purchase query and hands over here (tips never touch it).
 *
 * The reward is acknowledged as soon as it's seen, so Google Play never refunds it, even before the
 * owner signs in. Its purchase token is kept on the phone until the server has answered for it,
 * then sent once (POST /rewards/play) and not again on later starts.
 */
@SuppressLint("StaticFieldLeak") // holds the application context only
object PlayRewards {
    data class State(
        /** A reward was found on this phone and hasn't reached an account yet. */
        val waiting: Boolean = false,
        /** The reward was just added to the account. */
        val added: Boolean = false,
        /** The server refused it for good (another account has it, or the offer ended). */
        @StringRes val error: Int? = null,
    )

    private const val PENDING = "reward_play_pending"
    private const val DONE = "reward_play_done"

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var app: Context? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val claiming = mutableSetOf<String>()

    fun init(context: Context) {
        if (app != null) return
        val ctx = context.applicationContext
        app = ctx
        _state.update { it.copy(waiting = pending(ctx).isNotEmpty()) }
    }

    private fun pending(ctx: Context): Set<String> = Settings.prefs(ctx).getStringSet(PENDING, null).orEmpty()
    private fun done(ctx: Context): Set<String> = Settings.prefs(ctx).getStringSet(DONE, null).orEmpty()

    /** Every purchase Google Play reports; acts on the reward only. [acknowledge] is TipJar's. */
    fun onPurchases(purchases: List<Purchase>, acknowledge: (String, (Boolean) -> Unit) -> Unit) {
        val ctx = app ?: return
        var claim = false
        for (p in purchases) {
            if (p.packageName != ctx.packageName) continue
            val token = p.purchaseToken
            val finished = token in done(ctx)
            val plan = Balance.plan(
                products = p.products,
                purchased = p.purchaseState == Purchase.PurchaseState.PURCHASED,
                acknowledged = p.isAcknowledged,
                signedIn = Accounts.token != null,
                finished = finished,
            ) ?: continue
            if (plan.acknowledge) {
                // Not acknowledged yet: the next start tries again, well within Google Play's 3 days.
                acknowledge(token) { ok -> if (!ok) Log.w("PlayRewards", "Couldn't acknowledge the reward yet") }
            }
            if (!finished && token !in pending(ctx)) {
                Settings.prefs(ctx).edit { putStringSet(PENDING, pending(ctx) + token) }
            }
            claim = claim || plan.claim
        }
        _state.update { it.copy(waiting = pending(ctx).isNotEmpty()) }
        if (claim) claimSaved(ctx)
    }

    /** Sends rewards found earlier to the server. Called on start, after a reward is found and after signing in. */
    fun claimSaved(context: Context) {
        val ctx = app ?: context.applicationContext
        if (Accounts.token == null) return
        // A copy that isn't from Google Play never has a reward; nothing saved means nothing to send.
        for (token in pending(ctx)) {
            val fresh = synchronized(claiming) { claiming.add(token) }
            if (!fresh) continue
            scope.launch {
                val result = Accounts.claimPlayReward(ctx, Balance.REWARD_PRODUCT, token)
                synchronized(claiming) { claiming.remove(token) }
                when (result) {
                    is Balance.Claim.Added -> {
                        finish(ctx, token)
                        if (!result.alreadyClaimed) {
                            _state.update { it.copy(added = true, error = null) }
                            Toast.makeText(ctx, ctx.getString(R.string.reward_added, Balance.format(Balance.REWARD_CENTS)), Toast.LENGTH_LONG).show()
                        }
                    }
                    is Balance.Claim.Refused -> {
                        finish(ctx, token)
                        _state.update { it.copy(error = result.message) }
                    }
                    // Offline or the server isn't ready: stays saved for the next start.
                    Balance.Claim.Later -> Unit
                }
            }
        }
    }

    private fun finish(ctx: Context, token: String) {
        Settings.prefs(ctx).edit {
            putStringSet(DONE, done(ctx) + token)
            putStringSet(PENDING, pending(ctx) - token)
        }
        _state.update { it.copy(waiting = pending(ctx).isNotEmpty()) }
    }
}
