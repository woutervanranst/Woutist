import { describe, expect, it } from 'vitest'
import { backAction } from './androidBack'

describe('backAction', () => {
  it('closes an open dialog first', () =>
    expect(backAction({ hasOpenDialog: true, hasTaskParam: true, canGoBack: true })).toBe('closeDialog'))
  it('then closes the task detail', () =>
    expect(backAction({ hasOpenDialog: false, hasTaskParam: true, canGoBack: true })).toBe('closeTask'))
  it('then goes back in history', () =>
    expect(backAction({ hasOpenDialog: false, hasTaskParam: false, canGoBack: true })).toBe('back'))
  it('leaves the app at the root', () =>
    expect(backAction({ hasOpenDialog: false, hasTaskParam: false, canGoBack: false })).toBe('exit'))
})
