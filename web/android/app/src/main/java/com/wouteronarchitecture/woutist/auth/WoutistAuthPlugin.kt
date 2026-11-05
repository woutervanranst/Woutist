package com.wouteronarchitecture.woutist.auth

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** JS bridge to [AuthManager]; the JS side is `web/src/native/plugins.ts` (`WoutistAuth`). */
@CapacitorPlugin(name = "WoutistAuth")
class WoutistAuthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun load() {
        AuthManager.init(context)
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }

    @PluginMethod
    fun getAccount(call: PluginCall) = run(call) {
        JSObject().put("account", AuthManager.account()?.toJs())
    }

    @PluginMethod
    fun signIn(call: PluginCall) = run(call) {
        AuthManager.signIn(activity, GRAPH_SCOPES).toJs()
    }

    @PluginMethod
    fun signOut(call: PluginCall) = run(call) {
        AuthManager.signOut()
        JSObject()
    }

    @PluginMethod
    fun acquireToken(call: PluginCall) = run(call) {
        val scopes = call.getArray("scopes")?.toList<String>() ?: GRAPH_SCOPES
        val token = if (call.getBoolean("interactive", false) == true) {
            AuthManager.tokenInteractive(activity, scopes)
        } else {
            AuthManager.tokenSilent(scopes)
        }
        JSObject().put("accessToken", token)
    }

    private fun run(call: PluginCall, block: suspend () -> JSObject) {
        scope.launch {
            try {
                call.resolve(block())
            } catch (e: SignInRequired) {
                call.reject(e.message, "sign_in_required")
            } catch (e: SignInCancelled) {
                call.reject(e.message, "cancelled")
            } catch (e: Exception) {
                Log.w("Woutist", "WoutistAuth.${call.methodName} failed", e)
                call.reject(e.message ?: e.javaClass.simpleName, "error", e)
            }
        }
    }

    private fun NativeAccount.toJs() = JSObject().put("key", key).put("name", name).put("username", username)
}
