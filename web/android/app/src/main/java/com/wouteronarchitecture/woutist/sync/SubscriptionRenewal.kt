package com.wouteronarchitecture.woutist.sync

import android.util.Log
import com.wouteronarchitecture.woutist.data.GraphSubscription
import java.time.Duration
import java.time.Instant

/**
 * Keeps this account's Graph change-notification subscriptions alive from the background, so near-instant
 * sync keeps working while only the phone is used. The app creates them (and removes stale ones); this
 * only extends those for the app's notification URL, with the same rules as `graphSubscriptions.ts`.
 */
object SubscriptionRenewal {
    /** Graph allows at most 4230 minutes for todoTask subscriptions; stay a little under for clock skew. */
    private val LIFETIME: Duration = Duration.ofMinutes(4200)
    private val RENEW_WITHIN: Duration = Duration.ofHours(36)

    fun expiration(now: Instant): Instant = now.plus(LIFETIME)

    fun due(subscriptions: List<GraphSubscription>, notificationUrl: String, now: Instant): List<String> =
        subscriptions
            .filter { it.notificationUrl == notificationUrl && it.expiresAt.isAfter(now) && it.expiresAt.isBefore(now.plus(RENEW_WITHIN)) }
            .map { it.id }

    /** Renews what's due; returns how many were renewed. A failed renewal doesn't stop the others. */
    suspend fun run(
        notificationUrl: String?,
        now: Instant,
        list: suspend () -> List<GraphSubscription>,
        renew: suspend (id: String, expiresAt: Instant) -> Unit,
    ): Int {
        if (notificationUrl == null) return 0
        var renewed = 0
        for (id in due(list(), notificationUrl, now)) {
            try {
                renew(id, expiration(now))
                renewed++
            } catch (e: Exception) {
                Log.w("Woutist", "Renewing Graph subscription $id failed", e)
            }
        }
        return renewed
    }
}
