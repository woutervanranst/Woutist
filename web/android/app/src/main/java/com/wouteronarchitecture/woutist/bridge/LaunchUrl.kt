package com.wouteronarchitecture.woutist.bridge

/**
 * MainActivity is exported, so any app can start it with a URL extra. Only in-app paths are
 * followed, and never the web-push "complete" shortcut (which would complete a task without asking).
 */
object LaunchUrl {
    private val COMPLETE = Regex("""[?&]complete=""")

    fun sanitize(url: String?): String? = url?.takeIf {
        it.startsWith("/") && !it.startsWith("//") && !COMPLETE.containsMatchIn(it)
    }
}
