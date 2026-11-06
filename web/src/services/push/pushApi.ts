import type {
  ApiErrorBody,
  GraphHookResponse,
  PushSubscriptionDto,
  RealtimeResponse,
  PutRemindersResponse,
  ReminderDto,
} from '@woutist/contracts'

export class PushApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'PushApiError'
  }
}

/** Client for the Woutist API (Azure Functions): reminder push and sync signals. */
export class PushApi {
  private readonly baseUrl: string
  private readonly getToken: () => Promise<string>

  constructor(baseUrl: string, getToken: () => Promise<string>) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.getToken = getToken
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      let message = res.statusText
      try {
        message = ((await res.json()) as ApiErrorBody).message ?? message
      } catch {
        // not JSON
      }
      throw new PushApiError(res.status, message)
    }
    if (res.status === 204) return undefined
    return (await res.json()) as T
  }

  async putSubscription(subscription: PushSubscriptionDto): Promise<void> {
    await this.call('PUT', '/subscription', { subscription })
  }

  async deleteSubscription(endpoint: string): Promise<void> {
    await this.call('DELETE', '/subscription', { endpoint })
  }

  async putReminders(reminders: ReminderDto[]): Promise<PutRemindersResponse | undefined> {
    return this.call<PutRemindersResponse>('PUT', '/reminders', { reminders })
  }

  /** Where Graph subscriptions for this user must point, and their clientState. */
  async getGraphHook(): Promise<GraphHookResponse> {
    return (await this.call<GraphHookResponse>('GET', '/graph-hook'))!
  }

  /** A WebSocket URL that receives sync signals for this user. */
  async getRealtimeUrl(): Promise<string> {
    return (await this.call<RealtimeResponse>('GET', '/realtime'))!.url
  }

  /** Registers this Android device's FCM token for sync signals. */
  async putDevice(token: string): Promise<void> {
    await this.call('PUT', '/devices', { token })
  }

  async deleteDevice(token: string): Promise<void> {
    await this.call('DELETE', '/devices', { token })
  }

  async deleteMe(): Promise<void> {
    await this.call('DELETE', '/me')
  }
}
