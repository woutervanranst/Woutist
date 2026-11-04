import type {
  ApiErrorBody,
  PushSubscriptionDto,
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

/** Client for the Woutist reminder API (Azure Functions). */
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

  async deleteMe(): Promise<void> {
    await this.call('DELETE', '/me')
  }
}
