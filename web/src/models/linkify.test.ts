import { describe, expect, it } from 'vitest'
import { hasLink, splitLinks } from './linkify'

describe('splitLinks', () => {
  it('links a bare domain, as Microsoft To Do does', () => {
    expect(splitLinks('Dp tuinwerken en afbraakwerken.be')).toEqual([
      { text: 'Dp tuinwerken en ' },
      { text: 'afbraakwerken.be', href: 'https://afbraakwerken.be' },
    ])
  })

  it('keeps a full URL as written and drops trailing punctuation', () => {
    expect(splitLinks('see https://example.com/a?b=1#c, then')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c' },
      { text: ', then' },
    ])
  })

  it('adds a scheme to www addresses', () => {
    expect(splitLinks('www.example.com')).toEqual([{ text: 'www.example.com', href: 'https://www.example.com' }])
  })

  it('leaves file names, abbreviations and e-mail addresses alone', () => {
    for (const text of ['notes.txt', 'e.g. this', 'mail wouter@example.com', 'version 1.2']) {
      expect(hasLink(text)).toBe(false)
    }
  })

  it('returns a single plain part when there is no link', () => {
    expect(splitLinks('Buy milk')).toEqual([{ text: 'Buy milk' }])
    expect(splitLinks('')).toEqual([])
  })
})
