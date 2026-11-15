package com.justicemw.oceanlive.car

import androidx.annotation.StringRes
import com.justicemw.oceanlive.R
import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * The account balance (US dollars, kept on the server in cents) and the Google Play
 * pre-registration reward. Pure logic so it can be unit tested; Google Play is in [PlayRewards]
 * and the server calls are in [Accounts] and [Ask].
 *
 * The balance pays for AI questions beyond the free daily ones (and later, add-ons).
 */
object Balance {
    /** The Google Play pre-registration reward product (a one-time product, never a tip). */
    const val REWARD_PRODUCT = "prereg_credit_5"

    /** What the reward adds to the balance. */
    const val REWARD_CENTS = 500

    const val EARLY_SUPPORTER = "early_supporter"

    /** The server's default PAID_MIN_BALANCE_CENTS: below this a paid question isn't started. */
    const val MIN_PAID_BALANCE_CENTS = 3

    /** [cents] as US dollars in the phone's language, e.g. "$4.98" or "4,98 $". */
    fun format(cents: Int, locale: Locale = Locale.getDefault()): String {
        val f = NumberFormat.getCurrencyInstance(locale)
        f.currency = Currency.getInstance("USD")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.format(BigDecimal.valueOf(cents.toLong(), 2))
    }

    /** The balance in a server reply, or null when the reply has none. */
    fun centsIn(o: JSONObject?): Int? =
        if (o != null && o.has("balanceCents") && !o.isNull("balanceCents")) o.optInt("balanceCents", 0).coerceAtLeast(0) else null

    fun badgesIn(o: JSONObject?): List<String>? =
        o?.optJSONArray("badges")?.let { a -> List(a.length()) { a.optString(it) }.filter { it.isNotEmpty() } }

    /** What to do with one Google Play purchase found on the phone. */
    data class Plan(
        /** Acknowledge it now, so Google Play never refunds it (it does after 3 days otherwise). */
        val acknowledge: Boolean,
        /** Send it to the server to add the reward to the account. */
        val claim: Boolean,
    )

    /**
     * Null when the purchase isn't the reward or isn't finished (pending): leave it alone.
     * The reward is acknowledged as soon as it's seen, signed in or not, and claimed once signed
     * in, until the server has answered for it ([finished]).
     */
    fun plan(products: List<String>, purchased: Boolean, acknowledged: Boolean, signedIn: Boolean, finished: Boolean): Plan? {
        if (products != listOf(REWARD_PRODUCT) || !purchased) return null
        return Plan(acknowledge = !acknowledged, claim = signedIn && !finished)
    }

    /** The server's answer to POST /rewards/play. */
    sealed interface Claim {
        /** Added now, or [alreadyClaimed] earlier by this account. */
        data class Added(val balanceCents: Int?, val badges: List<String>?, val alreadyClaimed: Boolean) : Claim

        /** The server said no for good: don't send this purchase again. [message] explains why. */
        data class Refused(@StringRes val message: Int) : Claim

        /** Not now (offline, server not set up yet, session ended): try again on a later start. */
        data object Later : Claim
    }

    fun claimResult(code: Int?, json: JSONObject?): Claim {
        if (code == null) return Claim.Later
        if (code in 200..299 && json?.optBoolean("ok") == true) {
            return Claim.Added(centsIn(json), badgesIn(json), json.optBoolean("alreadyClaimed"))
        }
        return when (json?.optString("error")) {
            "already_claimed_other_account" -> Claim.Refused(R.string.reward_error_other_account)
            "claim_closed" -> Claim.Refused(R.string.reward_error_closed)
            // invalid_purchase can be Google's API failing for a moment, and not_configured is a
            // server not set up yet: both try again later, once per app start.
            else -> Claim.Later
        }
    }

    /** What "Any questions?" says about free questions and the balance, from the last reply. */
    sealed interface AskNotice {
        /** Free questions are used up; the next ones are paid from [balanceCents]. */
        data class UsesBalance(val balanceCents: Int) : AskNotice

        /** Free questions are used up and there's no balance to pay with. */
        data object FreeUsedUp : AskNotice
    }

    /**
     * [freeLeft] is the server's remainingToday from the last answer of [day] (a UTC date; free
     * questions reset at midnight UTC), [paid] true when that answer was paid from the balance.
     */
    fun askNotice(freeLeft: Int?, paid: Boolean, day: String?, today: String, balanceCents: Int?): AskNotice? {
        if (day != today) return null
        if (!paid && (freeLeft == null || freeLeft > 0)) return null
        val balance = balanceCents ?: 0
        return if (balance >= MIN_PAID_BALANCE_CENTS) AskNotice.UsesBalance(balance) else AskNotice.FreeUsedUp
    }

    /**
     * The message for a 429 from /ask, from the server's [reason]: free questions used up (free_used),
     * balance too low (low_balance), or a daily limit reached (paid_limit, or network: the shared
     * per-network limit, even with free questions left). Without a reason (a server from before the
     * balance) it goes by [balanceCents], and with neither it is the plain daily-limit message.
     */
    @StringRes
    fun limitMessage(reason: String?, balanceCents: Int?): Int = when (reason) {
        "free_used" -> R.string.ask_error_free_used
        "low_balance" -> R.string.ask_error_low_balance
        "paid_limit", "network" -> R.string.ask_error_limit
        else -> when {
            balanceCents == null -> R.string.ask_error_limit
            balanceCents <= 0 -> R.string.ask_error_free_used
            balanceCents < MIN_PAID_BALANCE_CENTS -> R.string.ask_error_low_balance
            else -> R.string.ask_error_limit
        }
    }
}
