package com.wouteronarchitecture.woutist.sync

import com.wouteronarchitecture.woutist.data.GraphSubscription
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.Instant

class SubscriptionRenewalTest {
    private val now = Instant.parse("2026-11-06T10:00:00Z")
    private val hook = "https://api.test/api/graph-notify?u=user"
    private fun sub(id: String, hoursLeft: Long, url: String = hook) = GraphSubscription(id, url, now.plus(Duration.ofHours(hoursLeft)))

    @Test fun renewsOnlyOursThatExpireWithin36Hours() {
        val subs = listOf(sub("soon", 10), sub("fresh", 60), sub("other", 10, "https://prod.example/api/graph-notify?u=user"), sub("gone", -1))
        assertEquals(listOf("soon"), SubscriptionRenewal.due(subs, hook, now))
    }

    @Test fun renewsToTheMaximumLifetime() {
        // 4200 minutes = 70 hours.
        assertEquals(Instant.parse("2026-11-09T08:00:00Z"), SubscriptionRenewal.expiration(now))
    }

    @Test fun runRenewsDueOnesAndKeepsGoingAfterAFailure() = runBlocking {
        val renewed = mutableListOf<Pair<String, Instant>>()
        val count = SubscriptionRenewal.run(hook, now, list = { listOf(sub("a", 1), sub("b", 2), sub("c", 50)) }) { id, at ->
            if (id == "a") throw RuntimeException("boom")
            renewed += id to at
        }
        assertEquals(1, count)
        assertEquals(listOf("b" to SubscriptionRenewal.expiration(now)), renewed)
    }

    @Test fun runDoesNothingWithoutAHook() = runBlocking {
        var listed = false
        val count = SubscriptionRenewal.run(null, now, list = { listed = true; emptyList() }) { _, _ -> }
        assertEquals(0, count)
        assertEquals(false, listed)
    }
}
