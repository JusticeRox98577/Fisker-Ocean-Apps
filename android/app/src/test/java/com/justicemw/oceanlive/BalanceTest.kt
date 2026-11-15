package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.AccountInfo
import com.justicemw.oceanlive.car.Ask
import com.justicemw.oceanlive.car.Balance
import com.justicemw.oceanlive.car.Tips
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class BalanceTest {
    private val reward = listOf(Balance.REWARD_PRODUCT)

    @Test fun centsAsDollarsInEnglish() {
        assertEquals("$0.00", Balance.format(0, Locale.US))
        assertEquals("$0.01", Balance.format(1, Locale.US))
        assertEquals("$4.98", Balance.format(498, Locale.US))
        assertEquals("$5.00", Balance.format(Balance.REWARD_CENTS, Locale.US))
        assertEquals("$1,234.56", Balance.format(123_456, Locale.US))
    }

    @Test fun centsAsDollarsInTheOtherLanguages() {
        for (locale in listOf(Locale.GERMANY, Locale.FRANCE, Locale.forLanguageTag("es-ES"), Locale.forLanguageTag("nl-NL"))) {
            val text = Balance.format(498, locale)
            assertTrue("$locale: $text", text.contains("4,98"))
            assertTrue("$locale names dollars: $text", text.contains("$"))
        }
        assertTrue(Balance.format(2, Locale.GERMANY).contains("0,02"))
    }

    @Test fun rewardIsNeverATip() {
        assertFalse(Tips.isTip(reward))
        assertFalse(Tips.isTip(listOf("tip_small", Balance.REWARD_PRODUCT)))
        assertFalse(Tips.isTip(emptyList()))
        assertTrue(Tips.isTip(listOf("tip_medium")))
    }

    @Test fun rewardIsAcknowledgedRightAwayEvenBeforeSigningIn() {
        assertEquals(Balance.Plan(acknowledge = true, claim = false), Balance.plan(reward, purchased = true, acknowledged = false, signedIn = false, finished = false))
        assertEquals(Balance.Plan(acknowledge = true, claim = true), Balance.plan(reward, purchased = true, acknowledged = false, signedIn = true, finished = false))
        assertEquals(Balance.Plan(acknowledge = false, claim = true), Balance.plan(reward, purchased = true, acknowledged = true, signedIn = true, finished = false))
    }

    @Test fun rewardIsSentOnlyUntilTheServerAnswered() {
        assertEquals(Balance.Plan(acknowledge = false, claim = false), Balance.plan(reward, purchased = true, acknowledged = true, signedIn = true, finished = true))
    }

    @Test fun otherPurchasesAndPendingOnesAreLeftAlone() {
        assertNull(Balance.plan(listOf("tip_small"), purchased = true, acknowledged = false, signedIn = true, finished = false))
        assertNull(Balance.plan(listOf(Balance.REWARD_PRODUCT, "tip_small"), purchased = true, acknowledged = false, signedIn = true, finished = false))
        assertNull(Balance.plan(reward, purchased = false, acknowledged = false, signedIn = true, finished = false))
    }

    @Test fun claimRepliesFromTheServer() {
        val added = Balance.claimResult(200, JSONObject("""{"ok":true,"balanceCents":500,"badges":["early_supporter"]}"""))
        assertEquals(Balance.Claim.Added(500, listOf("early_supporter"), alreadyClaimed = false), added)
        val again = Balance.claimResult(200, JSONObject("""{"ok":true,"balanceCents":480,"badges":["early_supporter"],"alreadyClaimed":true}"""))
        assertEquals(Balance.Claim.Added(480, listOf("early_supporter"), alreadyClaimed = true), again)
        assertEquals(Balance.Claim.Refused(R.string.reward_error_other_account), Balance.claimResult(409, JSONObject("""{"error":"already_claimed_other_account"}""")))
        assertEquals(Balance.Claim.Refused(R.string.reward_error_closed), Balance.claimResult(403, JSONObject("""{"error":"claim_closed"}""")))
    }

    @Test fun claimIsTriedAgainWhenTheServerCantSayYet() {
        assertEquals(Balance.Claim.Later, Balance.claimResult(null, null))
        assertEquals(Balance.Claim.Later, Balance.claimResult(503, JSONObject("""{"error":"not_configured"}""")))
        assertEquals(Balance.Claim.Later, Balance.claimResult(400, JSONObject("""{"error":"invalid_purchase"}""")))
        assertEquals(Balance.Claim.Later, Balance.claimResult(500, JSONObject()))
    }

    @Test fun accountReadsBalanceAndBadges() {
        val a = AccountInfo.from(JSONObject("""{"id":"a1","email":null,"name":null,"providers":["google"],"balanceCents":498,"badges":["early_supporter"]}"""))
        assertEquals(498, a.balanceCents)
        assertEquals(listOf(Balance.EARLY_SUPPORTER), a.badges)
        assertEquals(a, AccountInfo.from(JSONObject(a.toJson())))
        val older = AccountInfo.from(JSONObject("""{"id":"a1","providers":[]}"""))
        assertNull(older.balanceCents)
        assertEquals(emptyList<String>(), older.badges)
        assertEquals(older, AccountInfo.from(JSONObject(older.toJson())))
    }

    @Test fun paidAnswerFromTheProxy() {
        val r = Ask.reply(200, JSONObject("""{"answer":"Fine.","remainingToday":0,"paid":true,"chargedCents":2,"balanceCents":498}"""))
        assertEquals(Ask.Reply.Answer("Fine.", paid = true, chargedCents = 2, balanceCents = 498, freeLeft = 0), r)
        val free = Ask.reply(200, JSONObject("""{"answer":"Fine.","remainingToday":3}"""))
        assertEquals(Ask.Reply.Answer("Fine.", paid = false, chargedCents = null, balanceCents = null, freeLeft = 3), free)
    }

    @Test fun limitRepliesExplainTheBalance() {
        assertEquals(Ask.Reply.Failed(R.string.ask_error_free_used, 0), Ask.reply(429, JSONObject("""{"error":"rate_limited","balanceCents":0}""")))
        // A server from before the balance: no reason, no balance.
        assertEquals(Ask.Reply.Failed(R.string.ask_error_limit, null), Ask.reply(429, JSONObject("""{"error":"rate_limited"}""")))
        assertEquals(Ask.Reply.Failed(R.string.ask_error_low_balance, 2), Ask.reply(429, JSONObject("""{"error":"rate_limited","balanceCents":2}""")))
        // Money left but the paid daily limit (or the network's) is reached.
        assertEquals(Ask.Reply.Failed(R.string.ask_error_limit, 300), Ask.reply(429, JSONObject("""{"error":"rate_limited","balanceCents":300}""")))
        assertEquals(Ask.Reply.Failed(R.string.ask_error_budget, null), Ask.reply(503, JSONObject("""{"error":"budget"}""")))
    }

    @Test fun limitRepliesFollowTheServersReason() {
        fun r(body: String) = Ask.reply(429, JSONObject(body))
        assertEquals(Ask.Reply.Failed(R.string.ask_error_free_used, 0), r("""{"error":"rate_limited","reason":"free_used","balanceCents":0}"""))
        assertEquals(Ask.Reply.Failed(R.string.ask_error_low_balance, 2), r("""{"error":"rate_limited","reason":"low_balance","balanceCents":2}"""))
        assertEquals(Ask.Reply.Failed(R.string.ask_error_limit, 497), r("""{"error":"rate_limited","reason":"paid_limit","balanceCents":497}"""))
        // The shared per-network limit: free questions may be left, so never "you've used them".
        assertEquals(Ask.Reply.Failed(R.string.ask_error_limit, 0), r("""{"error":"rate_limited","reason":"network","balanceCents":0}"""))
        assertEquals(Ask.Reply.Failed(R.string.ask_error_limit, 2), r("""{"error":"rate_limited","reason":"network","balanceCents":2}"""))
    }

    @Test fun askNoticeAfterFreeQuestionsAreUsedUp() {
        val today = "2026-11-15"
        assertNull(Balance.askNotice(freeLeft = 2, paid = false, day = today, today = today, balanceCents = 500))
        assertNull(Balance.askNotice(freeLeft = null, paid = false, day = null, today = today, balanceCents = 500))
        assertEquals(Balance.AskNotice.UsesBalance(500), Balance.askNotice(0, paid = false, day = today, today = today, balanceCents = 500))
        assertEquals(Balance.AskNotice.UsesBalance(498), Balance.askNotice(0, paid = true, day = today, today = today, balanceCents = 498))
        assertEquals(Balance.AskNotice.FreeUsedUp, Balance.askNotice(0, paid = false, day = today, today = today, balanceCents = 0))
        assertEquals(Balance.AskNotice.FreeUsedUp, Balance.askNotice(0, paid = true, day = today, today = today, balanceCents = 1))
        assertEquals(Balance.AskNotice.FreeUsedUp, Balance.askNotice(0, paid = false, day = today, today = today, balanceCents = null))
        // A new UTC day: free questions are back.
        assertNull(Balance.askNotice(0, paid = true, day = "2026-11-14", today = today, balanceCents = 498))
    }

    @Test fun utcDayMatchesTheProxy() {
        assertEquals("2026-11-15", Ask.utcDay(1_794_700_800_000L)) // 2026-11-15T00:00Z
        assertEquals("2026-11-14", Ask.utcDay(1_794_700_799_999L))
    }

    @Test fun englishWording() {
        assertEquals("Paid from your balance: $0.02 · $4.98 left", EnStrings.get(R.string.ask_paid_left, Balance.format(2, Locale.US), Balance.format(498, Locale.US)))
        assertEquals("Further questions today use your balance ($4.98).", EnStrings.get(R.string.ask_uses_balance, Balance.format(498, Locale.US)))
        assertEquals("You've used today's free questions. They reset at midnight UTC.", EnStrings.get(R.string.ask_error_free_used))
        assertEquals("Balance: $5.00", EnStrings.get(R.string.balance_label, Balance.format(500, Locale.US)))
        assertEquals("Early supporter", EnStrings.get(R.string.badge_early_supporter))
    }
}
