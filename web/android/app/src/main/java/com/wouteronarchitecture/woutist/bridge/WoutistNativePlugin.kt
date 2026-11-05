package com.wouteronarchitecture.woutist.bridge

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.reminders.Notifications
import com.wouteronarchitecture.woutist.reminders.ReminderScheduler
import com.wouteronarchitecture.woutist.work.RefreshWorker
import com.wouteronarchitecture.woutist.work.TaskOpWorker

/** JS bridge for reminders, the widget and notification taps; the JS side is `WoutistNative` in `plugins.ts`. */
@CapacitorPlugin(
    name = "WoutistNative",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = WoutistNativePlugin.NOTIFICATIONS)],
)
class WoutistNativePlugin : Plugin() {
    private var launchUrl: String? = null

    private val store get() = SnapshotStore.get(context)

    override fun load() {
        Notifications.ensureChannel(context)
        NativeEvents.onChanged = { notifyListeners("changed", JSObject()) }
        launchUrl = urlFrom(activity.intent)
        // Alarms don't survive a force-stop; re-arm from what the phone last knew.
        Thread { ReminderScheduler.reschedule(context, store, force = true) }.start()
    }

    override fun handleOnNewIntent(intent: Intent) {
        urlFrom(intent)?.let { notifyListeners("navigate", JSObject().put("url", it), true) }
    }

    override fun handleOnDestroy() {
        NativeEvents.onChanged = null
    }

    @PluginMethod
    fun setSnapshot(call: PluginCall) {
        val json = call.getObject("snapshot") ?: return call.reject("snapshot is required")
        val snapshot = try {
            Snapshot.fromJson(json)
        } catch (e: Exception) {
            return call.reject("Invalid snapshot: ${e.message}")
        }
        val wasWaitingForSignIn = store.needsSignIn
        store.replaceBase(snapshot)
        // Work that stopped on "sign in required" can go now, without waiting out its backoff.
        if (wasWaitingForSignIn) store.pending().forEach { TaskOpWorker.enqueue(context, it.id, ExistingWorkPolicy.REPLACE) }
        RefreshWorker.schedule(context)
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        TaskOpWorker.cancelAll(context)
        RefreshWorker.cancel(context)
        store.clear()
        NotificationManagerCompat.from(context).cancelAll()
        call.resolve()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val power = context.getSystemService(PowerManager::class.java)
        call.resolve(
            JSObject()
                .put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
                .put("exactAlarms", ReminderScheduler.canScheduleExact(context))
                .put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(context.packageName)),
        )
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", NotificationManagerCompat.from(context).areNotificationsEnabled()))
        } else {
            requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionResult")
        }
    }

    @PermissionCallback
    private fun notificationPermissionResult(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED))
    }

    @PluginMethod
    fun openSystemSettings(call: PluginCall) {
        val pkg = context.packageName
        val packageUri = Uri.parse("package:$pkg")
        val intent = when (call.getString("target")) {
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "exactAlarms" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri)
            }
            "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri)
            else -> return call.reject("Unknown settings target")
        }
        try {
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w("Woutist", "No settings screen for ${call.getString("target")}", e)
            activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
        }
        call.resolve()
    }

    @PluginMethod
    fun consumeLaunchUrl(call: PluginCall) {
        val url = launchUrl
        launchUrl = null
        call.resolve(JSObject().put("url", url ?: JSObject.NULL))
    }

    private fun urlFrom(intent: Intent?): String? =
        intent?.getStringExtra(Notifications.EXTRA_URL)?.also { intent.removeExtra(Notifications.EXTRA_URL) }

    companion object {
        const val NOTIFICATIONS = "notifications"
    }
}
