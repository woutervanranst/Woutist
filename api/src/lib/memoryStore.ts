// In-memory implementation of the table repository (tests, local experiments).
import type {
  BaseEntity,
  DeviceEntity,
  EntityTable,
  ReminderEntity,
  ScheduleEntity,
  StateEntity,
  Store,
  SubscriptionEntity,
} from './tables'

export class MemoryEntityTable<T extends BaseEntity> implements EntityTable<T> {
  readonly partitions = new Map<string, Map<string, T>>()

  async get(partitionKey: string, rowKey: string): Promise<T | undefined> {
    const row = this.partitions.get(partitionKey)?.get(rowKey)
    return row ? structuredClone(row) : undefined
  }

  async listPartition(partitionKey: string): Promise<T[]> {
    return this.listPartitionRange(partitionKey, partitionKey)
  }

  async listPartitionRange(fromPartitionKey: string, toPartitionKey: string): Promise<T[]> {
    const result: T[] = []
    const keys = [...this.partitions.keys()].filter((pk) => pk >= fromPartitionKey && pk <= toPartitionKey).sort()
    for (const pk of keys) {
      const rows = this.partitions.get(pk)
      if (!rows) continue
      for (const rk of [...rows.keys()].sort()) {
        const row = rows.get(rk)
        if (row) result.push(structuredClone(row))
      }
    }
    return result
  }

  async upsert(entity: T): Promise<void> {
    let rows = this.partitions.get(entity.partitionKey)
    if (!rows) {
      rows = new Map()
      this.partitions.set(entity.partitionKey, rows)
    }
    rows.set(entity.rowKey, structuredClone(entity))
  }

  async delete(partitionKey: string, rowKey: string): Promise<void> {
    const rows = this.partitions.get(partitionKey)
    if (!rows) return
    rows.delete(rowKey)
    if (rows.size === 0) this.partitions.delete(partitionKey)
  }

  /** Every row, for assertions. */
  all(): T[] {
    return [...this.partitions.values()].flatMap((rows) => [...rows.values()].map((row) => structuredClone(row)))
  }
}

export interface MemoryStore extends Store {
  subscriptions: MemoryEntityTable<SubscriptionEntity>
  reminders: MemoryEntityTable<ReminderEntity>
  schedule: MemoryEntityTable<ScheduleEntity>
  state: MemoryEntityTable<StateEntity>
  devices: MemoryEntityTable<DeviceEntity>
}

export function createMemoryStore(): MemoryStore {
  return {
    subscriptions: new MemoryEntityTable(),
    reminders: new MemoryEntityTable(),
    schedule: new MemoryEntityTable(),
    state: new MemoryEntityTable(),
    devices: new MemoryEntityTable(),
  }
}
