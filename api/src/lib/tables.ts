// Azure Table Storage behind a tiny repository interface (tests use ./memoryStore).
import { odata, RestError, TableClient } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'

export interface BaseEntity {
  partitionKey: string
  rowKey: string
}

/** PK = userKey, RK = sha256(endpoint) hex. */
export interface SubscriptionEntity extends BaseEntity {
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
  updatedAt: string
}

/** PK = userKey, RK = base64url(taskId). */
export interface ReminderEntity extends BaseEntity {
  taskId: string
  listId: string
  /** Normalised ISO-8601 UTC instant. */
  fireAt: string
  /** PartitionKey of the matching `schedule` row. */
  bucket: string
}

/** PK = minute bucket `yyyyMMddHHmm`, RK = `${userKey}|${base64url(taskId)}`. */
export interface ScheduleEntity extends BaseEntity {
  userKey: string
  taskId: string
  listId: string
  fireAt: string
}

/** PK = userKey, RK = sha256(FCM token) hex. An Android device that receives sync signals. */
export interface DeviceEntity extends BaseEntity {
  token: string
  createdAt: string
  updatedAt: string
}

/** PK = `timer`, RK = `cursor`. */
export interface StateEntity extends BaseEntity {
  lastProcessedBucket: string
}

export interface EntityTable<T extends BaseEntity> {
  get(partitionKey: string, rowKey: string): Promise<T | undefined>
  listPartition(partitionKey: string): Promise<T[]>
  /** All rows whose PartitionKey is within [from, to] (inclusive), ordered by PartitionKey then RowKey. */
  listPartitionRange(fromPartitionKey: string, toPartitionKey: string): Promise<T[]>
  /** Insert or replace. */
  upsert(entity: T): Promise<void>
  /** Deletes the row; a missing row is not an error. */
  delete(partitionKey: string, rowKey: string): Promise<void>
}

export interface Store {
  subscriptions: EntityTable<SubscriptionEntity>
  reminders: EntityTable<ReminderEntity>
  schedule: EntityTable<ScheduleEntity>
  state: EntityTable<StateEntity>
  devices: EntityTable<DeviceEntity>
}

export const TABLE_NAMES = {
  subscriptions: 'subscriptions',
  reminders: 'reminders',
  schedule: 'schedule',
  state: 'state',
  devices: 'devices',
} as const

function statusOf(err: unknown): number | undefined {
  if (err instanceof RestError) return err.statusCode
  const status = (err as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' ? status : undefined
}

/** Drops the service-added `etag`/`timestamp` (and OData metadata) so rows can be re-upserted as-is. */
function clean<T extends BaseEntity>(entity: Record<string, unknown>): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entity)) {
    if (key === 'etag' || key === 'timestamp' || key.startsWith('odata.')) continue
    result[key] = value
  }
  return result as T
}

class AzureEntityTable<T extends BaseEntity> implements EntityTable<T> {
  readonly #client: TableClient
  #ready: Promise<void> | undefined

  constructor(client: TableClient) {
    this.#client = client
  }

  /** Creates the table on first use; an existing table (409) is fine. */
  #ensure(): Promise<void> {
    this.#ready ??= this.#client.createTable().catch((err: unknown) => {
      if (statusOf(err) === 409) return
      this.#ready = undefined
      throw err
    })
    return this.#ready
  }

  async get(partitionKey: string, rowKey: string): Promise<T | undefined> {
    await this.#ensure()
    try {
      const entity = await this.#client.getEntity<Record<string, unknown>>(partitionKey, rowKey)
      return clean<T>(entity)
    } catch (err) {
      if (statusOf(err) === 404) return undefined
      throw err
    }
  }

  async listPartition(partitionKey: string): Promise<T[]> {
    return this.#query(odata`PartitionKey eq ${partitionKey}`)
  }

  async listPartitionRange(fromPartitionKey: string, toPartitionKey: string): Promise<T[]> {
    return this.#query(odata`PartitionKey ge ${fromPartitionKey} and PartitionKey le ${toPartitionKey}`)
  }

  async #query(filter: string): Promise<T[]> {
    await this.#ensure()
    const rows: T[] = []
    for await (const entity of this.#client.listEntities<Record<string, unknown>>({ queryOptions: { filter } })) {
      rows.push(clean<T>(entity))
    }
    return rows
  }

  async upsert(entity: T): Promise<void> {
    await this.#ensure()
    await this.#client.upsertEntity(entity, 'Replace')
  }

  async delete(partitionKey: string, rowKey: string): Promise<void> {
    await this.#ensure()
    try {
      await this.#client.deleteEntity(partitionKey, rowKey)
    } catch (err) {
      if (statusOf(err) !== 404) throw err
    }
  }
}

export interface TableSettings {
  /** Local development (Azurite), e.g. `UseDevelopmentStorage=true`. Takes precedence. */
  connectionString?: string | undefined
  /** `https://<account>.table.core.windows.net`, accessed with the Function App's managed identity. */
  endpoint?: string | undefined
}

export function createAzureStore(settings: TableSettings): Store {
  const connectionString = settings.connectionString?.trim()
  const endpoint = settings.endpoint?.trim()
  let makeClient: (table: string) => TableClient
  if (connectionString) {
    makeClient = (table) => TableClient.fromConnectionString(connectionString, table, { allowInsecureConnection: true })
  } else if (endpoint) {
    const credential = new DefaultAzureCredential()
    makeClient = (table) => new TableClient(endpoint, table, credential)
  } else {
    throw new Error('Neither TABLES_CONNECTION_STRING nor TABLES_ENDPOINT is configured.')
  }
  return {
    subscriptions: new AzureEntityTable<SubscriptionEntity>(makeClient(TABLE_NAMES.subscriptions)),
    reminders: new AzureEntityTable<ReminderEntity>(makeClient(TABLE_NAMES.reminders)),
    schedule: new AzureEntityTable<ScheduleEntity>(makeClient(TABLE_NAMES.schedule)),
    state: new AzureEntityTable<StateEntity>(makeClient(TABLE_NAMES.state)),
    devices: new AzureEntityTable<DeviceEntity>(makeClient(TABLE_NAMES.devices)),
  }
}
