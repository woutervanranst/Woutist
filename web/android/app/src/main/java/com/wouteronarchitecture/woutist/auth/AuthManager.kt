package com.wouteronarchitecture.woutist.auth

import android.app.Activity
import android.content.Context
import com.microsoft.identity.client.AcquireTokenParameters
import com.microsoft.identity.client.AcquireTokenSilentParameters
import com.microsoft.identity.client.AuthenticationCallback
import com.microsoft.identity.client.IAccount
import com.microsoft.identity.client.IAuthenticationResult
import com.microsoft.identity.client.IPublicClientApplication
import com.microsoft.identity.client.ISingleAccountPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SignInParameters
import com.microsoft.identity.client.SilentAuthenticationCallback
import com.microsoft.identity.client.exception.MsalClientException
import com.microsoft.identity.client.exception.MsalException
import com.microsoft.identity.client.exception.MsalUiRequiredException
import com.wouteronarchitecture.woutist.R
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** Delegated Microsoft Graph scopes; same as `web/src/auth/scopes.ts`. */
val GRAPH_SCOPES = listOf("User.Read", "Tasks.ReadWrite", "MailboxSettings.ReadWrite")

/** The signed-in account. `key` matches the web app's per-account partition key format. */
data class NativeAccount(val key: String, val name: String, val username: String)

/** Silent token acquisition isn't possible: the user has to sign in (again) interactively. */
class SignInRequired(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The one MSAL Android instance of the app (single-account mode), shared by the WebView (through
 * WoutistAuthPlugin), notification actions, the widget and background workers.
 */
object AuthManager {
    private lateinit var appContext: Context
    private var app: ISingleAccountPublicClientApplication? = null
    private val creating = Mutex()

    fun init(context: Context) {
        if (!::appContext.isInitialized) appContext = context.applicationContext
    }

    private suspend fun client(): ISingleAccountPublicClientApplication {
        app?.let { return it }
        return creating.withLock {
            app ?: suspendCancellableCoroutine<ISingleAccountPublicClientApplication> { cont ->
                PublicClientApplication.createSingleAccountPublicClientApplication(
                    appContext,
                    R.raw.msal_config,
                    object : IPublicClientApplication.ISingleAccountApplicationCreatedListener {
                        override fun onCreated(application: ISingleAccountPublicClientApplication) = cont.resume(application)
                        override fun onError(exception: MsalException) = cont.resumeWithException(exception)
                    },
                )
            }.also { app = it }
        }
    }

    private suspend fun currentAccount(): IAccount? {
        val client = client()
        return suspendCancellableCoroutine { cont ->
            client.getCurrentAccountAsync(object : ISingleAccountPublicClientApplication.CurrentAccountCallback {
                override fun onAccountLoaded(activeAccount: IAccount?) = cont.resume(activeAccount)
                override fun onAccountChanged(priorAccount: IAccount?, currentAccount: IAccount?) {}
                override fun onError(exception: MsalException) = cont.resumeWithException(exception)
            })
        }
    }

    suspend fun account(): NativeAccount? = currentAccount()?.toNative()

    suspend fun signIn(activity: Activity, scopes: List<String>): NativeAccount {
        val client = client()
        // Single-account mode refuses a second sign-in: reuse the account that is already there.
        currentAccount()?.let { return it.toNative() }
        val result = suspendCancellableCoroutine<IAuthenticationResult> { cont ->
            client.signIn(
                SignInParameters.builder()
                    .withActivity(activity)
                    .withScopes(scopes)
                    .withCallback(cont.asCallback())
                    .build(),
            )
        }
        return result.account.toNative()
    }

    suspend fun signOut() {
        val client = client()
        if (currentAccount() == null) return
        suspendCancellableCoroutine { cont ->
            client.signOut(object : ISingleAccountPublicClientApplication.SignOutCallback {
                override fun onSignOut() = cont.resume(Unit)
                override fun onError(exception: MsalException) = cont.resumeWithException(exception)
            })
        }
    }

    /** Access token without UI. Throws [SignInRequired] when the user must sign in again. */
    suspend fun tokenSilent(scopes: List<String>): String {
        val client = client()
        val account = currentAccount() ?: throw SignInRequired("Not signed in")
        return try {
            suspendCancellableCoroutine<IAuthenticationResult> { cont ->
                client.acquireTokenSilentAsync(
                    AcquireTokenSilentParameters.Builder()
                        .forAccount(account)
                        .fromAuthority(account.authority)
                        .withScopes(scopes)
                        .withCallback(object : SilentAuthenticationCallback {
                            override fun onSuccess(authenticationResult: IAuthenticationResult) = cont.resume(authenticationResult)
                            override fun onError(exception: MsalException) = cont.resumeWithException(exception)
                        })
                        .build(),
                )
            }.accessToken
        } catch (e: MsalUiRequiredException) {
            throw SignInRequired("Sign-in required", e)
        } catch (e: MsalClientException) {
            if (e.errorCode == MsalClientException.NO_CURRENT_ACCOUNT) throw SignInRequired("Not signed in", e)
            throw e
        }
    }

    /** Access token, showing the sign-in UI (browser or Authenticator) when needed. */
    suspend fun tokenInteractive(activity: Activity, scopes: List<String>): String {
        val client = client()
        val account = currentAccount()
        val result = suspendCancellableCoroutine<IAuthenticationResult> { cont ->
            val builder = AcquireTokenParameters.Builder()
                .startAuthorizationFromActivity(activity)
                .withScopes(scopes)
                .withCallback(cont.asCallback())
            if (account != null) builder.forAccount(account)
            client.acquireToken(builder.build())
        }
        return result.accessToken
    }

    private fun kotlinx.coroutines.CancellableContinuation<IAuthenticationResult>.asCallback() =
        object : AuthenticationCallback {
            override fun onSuccess(authenticationResult: IAuthenticationResult) = resume(authenticationResult)
            override fun onError(exception: MsalException) = resumeWithException(exception)
            override fun onCancel() = resumeWithException(SignInCancelled())
        }

    private fun IAccount.toNative(): NativeAccount {
        val name = (claims?.get("name") as? String).orEmpty()
        return NativeAccount(key = "$id.$tenantId", name = name.ifEmpty { username }, username = username)
    }
}

/** The user closed the sign-in UI. */
class SignInCancelled : Exception("Sign-in was cancelled")
