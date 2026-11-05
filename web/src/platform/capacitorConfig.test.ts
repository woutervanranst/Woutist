import { describe, expect, it } from 'vitest'
import config from '../../capacitor.config'

describe('capacitor.config', () => {
  // The bridge logs every plugin result in debug builds, which would put Graph access tokens
  // (WoutistAuth.acquireToken) into logcat.
  it('turns off bridge logging so access tokens never reach logcat', () => {
    expect(config.loggingBehavior).toBe('none')
  })
})
