package com.wouteronarchitecture.woutist.quickadd

/** Turns text shared from another app into a task title and notes. */
object SharedText {
    private const val MAX_TITLE = 255
    private val URL = Regex("""https?://\S+""", RegexOption.IGNORE_CASE)
    private val URL_ONLY = Regex("""^https?://\S+$""", RegexOption.IGNORE_CASE)

    fun parse(subject: String?, text: String?): Pair<String, String?> {
        val sub = subject?.trim().orEmpty()
        val body = text?.trim().orEmpty()
        val (title, notes) = when {
            body.isEmpty() -> sub to null
            // Browsers share a page as its title (subject) plus its address (text).
            sub.isNotEmpty() && URL.containsMatchIn(body) -> sub to body
            body.lines().count { it.isNotBlank() } > 1 -> body.lines().first { it.isNotBlank() }.trim() to body
            URL_ONLY.matches(body) -> body to body
            else -> body to null
        }
        return title.take(MAX_TITLE) to notes
    }
}
