import type { Task } from '../../models/todo'

/** Deep equality that doesn't care about key order and treats a missing key like `undefined`. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!deepEqual(left[key], right[key])) return false
  }
  return true
}

/** Whether two copies of a task hold the same data. */
export function sameTask(a: Task, b: Task): boolean {
  return deepEqual(a, b)
}

/** Same data apart from the modification time (an edit made here is echoed back by Graph with its own time). */
export function sameTaskContent(a: Task, b: Task): boolean {
  return sameTask({ ...a, lastModifiedDateTime: '' }, { ...b, lastModifiedDateTime: '' })
}
