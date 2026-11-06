package com.wouteronarchitecture.woutist.sync

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.wouteronarchitecture.woutist.bridge.NativeEvents
import com.wouteronarchitecture.woutist.work.RefreshWorker
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Receives sync signals: the Woutist API heard from Graph that the account changed (in Woutist elsewhere,
 * the official app or Outlook). Refreshes the phone's copy right away, so the widget and reminder alarms
 * follow within seconds, and tells the app to sync if it's running.
 */
class WoutistMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["type"] != "changed") return
        RefreshWorker.refreshNow(applicationContext)
        NativeEvents.changed()
    }

    override fun onNewToken(token: String) {
        // The app registers the current token with the API when it starts; tell it now if it's running.
        NativeEvents.changed()
    }

    companion object {
        /** This device's FCM token, or null when the build has no Firebase configuration (google-services.json). */
        suspend fun token(context: Context): String? {
            if (FirebaseApp.getApps(context).isEmpty()) return null
            return suspendCancellableCoroutine { cont ->
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (!task.isSuccessful) Log.w("Woutist", "No FCM token", task.exception)
                    cont.resume(if (task.isSuccessful) task.result else null)
                }
            }
        }
    }
}
