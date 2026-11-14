package com.justicemw.oceanlive

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.annotation.StringRes
import androidx.core.content.edit
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.Tips
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Tips through Google Play Billing: three one-time consumable products that unlock nothing.
 * Prices and names come from Google Play. Each tip is consumed after it's bought so the same
 * tip can be given again. Nothing here talks to the car, and nothing is sent anywhere else.
 */
@SuppressLint("StaticFieldLeak") // holds the application context only
object TipJar {
    enum class Availability {
        /** Connecting to Google Play and loading the tips. */
        Checking,
        Ready,
        /**
         * Not installed from Google Play ([State.fromPlay] false), or Google Play has no tips for this app,
         * billing isn't available or the app isn't set up for it: no tips.
         */
        Unavailable,
        /** Google Play didn't answer (no connection, service busy): can be tried again. */
        Failed,
    }

    /** A tip as Google Play shows it. [name] and [description] can be missing; the screen then uses its own text. */
    data class Offer(val id: String, val name: String?, val description: String?, val price: String)

    data class State(
        val availability: Availability = Availability.Checking,
        val offers: List<Offer> = emptyList(),
        /** The tip whose purchase sheet is open or being finished. */
        val buying: String? = null,
        /** A tip waits for the payment to clear (e.g. cash at a shop). */
        val pending: Boolean = false,
        /** A tip just went through: show the thank-you. */
        val thanks: Boolean = false,
        @StringRes val error: Int? = null,
        val dates: Tips.Dates = Tips.Dates(),
        /** False for copies not installed from Google Play (sideloaded APKs): they can never offer tips. */
        val fromPlay: Boolean = true,
    )

    private const val PLAY_STORE = "com.android.vending"
    private const val FIRST_LAUNCH = "tip_first_launch"
    private const val DISMISSED_AT = "tip_dismissed_at"
    private const val LAST_TIP_AT = "tip_last_at"

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var app: Context? = null
    private var prefs: SharedPreferences? = null
    private var fromPlay = false
    private var client: BillingClient? = null
    private var connecting = false
    private var details: Map<String, ProductDetails> = emptyMap()
    private val consuming = mutableSetOf<String>()

    /** Called when the app opens: remembers the first launch, then loads the tips and finishes any left over. */
    fun init(context: Context) {
        if (app == null) {
            val ctx = context.applicationContext
            app = ctx
            val p = Settings.prefs(ctx)
            prefs = p
            if (p.getLong(FIRST_LAUNCH, 0L) <= 0L) p.edit { putLong(FIRST_LAUNCH, System.currentTimeMillis()) }
            _state.update { it.copy(dates = readDates(p)) }
            fromPlay = installedFromPlay(ctx)
            _state.update { it.copy(fromPlay = fromPlay) }
        }
        load()
    }

    /** Connects to Google Play if needed, then loads the tips and finishes earlier tips. Also the "Try again". */
    fun load() {
        val ctx = app ?: return
        // Sideloaded copies have no Google Play billing: don't even connect.
        if (!fromPlay) {
            _state.update { it.copy(availability = Availability.Unavailable) }
            return
        }
        val c = client ?: BillingClient.newBuilder(ctx)
            .setListener { result, purchases -> onPurchasesUpdated(result, purchases) }
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build()
            .also { client = it }
        if (c.isReady) {
            // "Try again" after a failed query: show the loading state so the tap visibly does something.
            _state.update { if (it.availability == Availability.Ready) it else it.copy(availability = Availability.Checking, error = null) }
            queryProducts(c)
            finishEarlier(c)
            return
        }
        if (connecting) return
        connecting = true
        _state.update { if (it.availability == Availability.Ready) it else it.copy(availability = Availability.Checking, error = null) }
        c.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connecting = false
                if (result.responseCode == BillingResponseCode.OK) {
                    queryProducts(c)
                    finishEarlier(c)
                } else {
                    _state.update { it.copy(availability = failure(result.responseCode)) }
                }
            }

            override fun onBillingServiceDisconnected() {
                // Auto reconnection takes care of the next call; nothing to do here.
                connecting = false
            }
        })
    }

    /** Opens the Google Play purchase sheet for one tip. */
    fun buy(activity: Activity, id: String) {
        val c = client
        val product = details[id]
        if (_state.value.buying != null) return
        if (c == null || !c.isReady || product == null) {
            _state.update { it.copy(error = R.string.tips_error_purchase) }
            load()
            return
        }
        _state.update { it.copy(buying = id, error = null, thanks = false) }
        val params = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)
            .apply { product.oneTimePurchaseOfferDetails?.offerToken?.let { setOfferToken(it) } }
            .build()
        val result = c.launchBillingFlow(activity, BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(params)).build())
        if (result.responseCode != BillingResponseCode.OK) onPurchasesUpdated(result, null)
    }

    /** The banner's close button: hidden for 90 days. */
    fun dismissBanner() {
        val now = System.currentTimeMillis()
        prefs?.edit { putLong(DISMISSED_AT, now) }
        _state.update { it.copy(dates = it.dates.copy(dismissedAt = now)) }
    }

    /** Leaving the Support screen: the thank-you and any error are done. */
    fun clearMessages() {
        _state.update { it.copy(thanks = false, error = null) }
    }

    private fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        when (result.responseCode) {
            BillingResponseCode.OK -> {
                val ours = purchases.orEmpty().filter(::isOurTip)
                if (ours.isEmpty()) _state.update { it.copy(buying = null) }
                ours.forEach { handle(it, celebrate = true) }
            }
            BillingResponseCode.USER_CANCELED -> _state.update { it.copy(buying = null) }
            BillingResponseCode.ITEM_ALREADY_OWNED -> {
                // An earlier tip of the same size wasn't finished: finish it so it can be given again.
                _state.update { it.copy(buying = null, error = R.string.tips_error_owned) }
                client?.takeIf { it.isReady }?.let(::finishEarlier)
            }
            else -> _state.update {
                val gone = result.responseCode == BillingResponseCode.BILLING_UNAVAILABLE
                it.copy(
                    buying = null,
                    error = R.string.tips_error_purchase,
                    availability = if (gone) Availability.Unavailable else it.availability,
                )
            }
        }
    }

    /** Checks a purchase is one of this app's tips, then consumes it (which also acknowledges it). */
    private fun handle(purchase: Purchase, celebrate: Boolean) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PENDING -> _state.update { it.copy(buying = null, pending = true) }
            Purchase.PurchaseState.PURCHASED -> consume(purchase, celebrate)
            else -> _state.update { it.copy(buying = null) }
        }
    }

    private fun consume(purchase: Purchase, celebrate: Boolean) {
        val c = client ?: return
        val token = purchase.purchaseToken
        synchronized(consuming) { if (!consuming.add(token)) return }
        c.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build()) { result, _ ->
            synchronized(consuming) { consuming.remove(token) }
            when (result.responseCode) {
                // ITEM_NOT_OWNED: already consumed, e.g. finished a moment ago.
                BillingResponseCode.OK, BillingResponseCode.ITEM_NOT_OWNED -> {
                    val now = System.currentTimeMillis()
                    prefs?.edit { putLong(LAST_TIP_AT, now) }
                    _state.update {
                        it.copy(
                            buying = null,
                            thanks = it.thanks || celebrate || it.pending,
                            pending = false,
                            error = null,
                            dates = it.dates.copy(lastTipAt = now),
                        )
                    }
                }
                // Stays unconsumed; it's finished on the next load, before Google Play would refund it.
                else -> _state.update { it.copy(buying = null, error = R.string.tips_error_finish) }
            }
        }
    }

    private fun queryProducts(c: BillingClient) {
        val products = Tips.PRODUCT_IDS.map {
            QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(BillingClient.ProductType.INAPP).build()
        }
        c.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(products).build()) { result, found ->
            if (result.responseCode != BillingResponseCode.OK) {
                _state.update { it.copy(availability = failure(result.responseCode)) }
                return@queryProductDetailsAsync
            }
            val byId = found.productDetailsList.filter { it.oneTimePurchaseOfferDetails != null }.associateBy { it.productId }
            details = byId
            val offers = Tips.PRODUCT_IDS.mapNotNull { id ->
                val d = byId[id] ?: return@mapNotNull null
                Offer(id, d.name.takeIf { it.isNotBlank() }, d.description.takeIf { it.isNotBlank() }, d.oneTimePurchaseOfferDetails!!.formattedPrice)
            }
            // No tips set up in Google Play yet counts as unavailable, so the banner stays hidden.
            _state.update {
                it.copy(offers = offers, availability = if (offers.isEmpty()) Availability.Unavailable else Availability.Ready)
            }
        }
    }

    /** Tips bought earlier but not finished (app closed, pending payment cleared): consume them now. */
    private fun finishEarlier(c: BillingClient) {
        c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result, purchases ->
            if (result.responseCode != BillingResponseCode.OK) return@queryPurchasesAsync
            val ours = purchases.filter(::isOurTip)
            if (ours.none { it.purchaseState == Purchase.PurchaseState.PENDING }) _state.update { it.copy(pending = false) }
            ours.forEach { handle(it, celebrate = false) }
        }
    }

    private fun isOurTip(p: Purchase): Boolean =
        p.packageName == app?.packageName && p.products.isNotEmpty() && p.products.all { it in Tips.PRODUCT_IDS }

    private fun failure(code: Int): Availability = when (code) {
        BillingResponseCode.BILLING_UNAVAILABLE,
        BillingResponseCode.ITEM_UNAVAILABLE,
        BillingResponseCode.FEATURE_NOT_SUPPORTED,
        // A setup problem on Google Play's side, not the connection: trying again won't help.
        BillingResponseCode.DEVELOPER_ERROR -> Availability.Unavailable
        else -> Availability.Failed
    }

    private fun readDates(p: SharedPreferences) = Tips.Dates(
        firstLaunch = p.getLong(FIRST_LAUNCH, 0L),
        dismissedAt = p.getLong(DISMISSED_AT, 0L),
        lastTipAt = p.getLong(LAST_TIP_AT, 0L),
    )

    private fun installedFromPlay(context: Context): Boolean = try {
        val pm = context.packageManager
        val installer = if (Build.VERSION.SDK_INT >= 30) {
            pm.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            pm.getInstallerPackageName(context.packageName)
        }
        installer == PLAY_STORE
    } catch (_: Exception) {
        false
    }
}
