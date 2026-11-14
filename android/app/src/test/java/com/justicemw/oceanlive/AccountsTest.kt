package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.AccountInfo
import com.justicemw.oceanlive.car.Ask
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AccountsTest {
    @Test fun accountReadsTheServerReply() {
        val a = AccountInfo.from(JSONObject("""{"id":"8baae128","email":"owner@example.com","name":null,"created":"2026-11-14T04:34:49Z","providers":["email","google"]}"""))
        assertEquals("8baae128", a.id)
        assertEquals("owner@example.com", a.email)
        assertNull(a.name)
        assertEquals(listOf("email", "google"), a.providers)
    }

    @Test fun savedCopyRoundTrips() {
        val a = AccountInfo("id-1", null, "Justice", listOf("apple"))
        assertEquals(a, AccountInfo.from(JSONObject(a.toJson())))
    }

    @Test fun expiredSessionAsksToSignInAgain() {
        assertEquals(R.string.ask_error_signin, Ask.errorMessage(401, "signin_required"))
    }
}
