import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// Node 22+ defines its own global localStorage (unusable without --localstorage-file) that can shadow
// jsdom's. Give tests a working in-memory one when that happens.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}
