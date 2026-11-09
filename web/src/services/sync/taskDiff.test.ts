import { describe, expect, it } from 'vitest'
import { newLocalTask } from '../../models/todo'
import { deepEqual, sameTask, sameTaskContent } from './taskDiff'

describe('deepEqual', () => {
  it("doesn't care about key order, at any depth", () => {
    expect(deepEqual({ a: 1, b: { c: [1, { x: 1, y: 2 }] } }, { b: { c: [1, { y: 2, x: 1 }] }, a: 1 })).toBe(true)
  })

  it('sees differences in values, array order and length', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1], [1, 2])).toBe(false)
    expect(deepEqual({ a: null }, { a: 0 })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('treats a missing key like undefined', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })
})

describe('sameTask', () => {
  it('compares tasks field by field, including steps', () => {
    const task = newLocalTask('L1', 'Milk')
    const copy = JSON.parse(JSON.stringify(task)) // same data, fresh objects
    expect(sameTask(task, copy)).toBe(true)
    expect(sameTask(task, { ...copy, title: 'Oat milk' })).toBe(false)
    const step = { id: 'S1', displayName: 'a', isChecked: false, createdDateTime: '', checkedDateTime: null }
    expect(sameTask({ ...task, steps: [step] }, { ...task, steps: [{ ...step, isChecked: true }] })).toBe(false)
  })

  it("can ignore the modification time (our own edit comes back with Graph's time)", () => {
    const task = newLocalTask('L1', 'Milk')
    const echoed = { ...task, lastModifiedDateTime: '2030-01-01T00:00:00Z' }
    expect(sameTask(task, echoed)).toBe(false)
    expect(sameTaskContent(task, echoed)).toBe(true)
    expect(sameTaskContent(task, { ...echoed, title: 'Other' })).toBe(false)
  })
})
