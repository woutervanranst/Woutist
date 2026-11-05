import { describe, expect, it } from 'vitest'
import { explainSubscribeError } from './pushController'

// What Chromium throws from PushManager.subscribe() when its push service (FCM) can't register.
const pushServiceError = () => new DOMException('Registration failed - push service error', 'AbortError')

describe('explainSubscribeError', () => {
  it('tells Brave users which setting blocks push', () => {
    const error = explainSubscribeError(pushServiceError(), true)
    expect(error.message).toContain('Use Google services for push messaging')
    expect(error.message).toContain('brave://settings/privacy')
  })

  it('gives other browsers a generic push-service explanation', () => {
    const error = explainSubscribeError(pushServiceError(), false)
    expect(error.message).not.toContain('brave://')
    expect(error.message).toMatch(/push service/i)
  })

  it('passes other errors through unchanged', () => {
    const original = new DOMException('The provided applicationServerKey is not valid.', 'InvalidAccessError')
    expect(explainSubscribeError(original, true)).toBe(original)
  })
})
