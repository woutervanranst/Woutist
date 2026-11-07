export interface TextPart {
  text: string
  /** Set when the part is a web address; the URL to open. */
  href?: string
}

// Addresses with a scheme or "www.", or a bare domain on a well-known TLD ("afbraakwerken.be"). Bare
// domains are limited to these TLDs so file names and abbreviations ("notes.txt", "e.g.") stay text.
const TLDS = 'com|net|org|be|nl|eu|io|dev|app|co|uk|de|fr|info|biz|me|tv|ai|edu|gov|us|ca|es|it|ch|at|lu|se|no|dk'
const URL_PATTERN = new RegExp(
  `(?:https?://|www\\.)[^\\s<>"]+|(?<![@\\w./-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\\.(?:${TLDS})\\b(?:/[^\\s<>"]*)?`,
  'gi',
)
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/** Split text into plain and web-address parts, so a title can show its links as clickable. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    if (!url) continue
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: url, href: /^https?:\/\//i.test(url) ? url : `https://${url}` })
    last = match.index + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

export function hasLink(text: string): boolean {
  return splitLinks(text).some((p) => p.href)
}
