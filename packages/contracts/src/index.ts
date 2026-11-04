/**
 * Shared contract between the Woutist SPA (web/) and the reminder push API (api/).
 *
 * The API never sees task content: only opaque Graph ids and the time a reminder fires.
 */

/** Delegated scope exposed by the Woutist app registration (`api://<clientId>/<scope>`). */
export const API_SCOPE_NAME = 'Reminders.ReadWrite';

export const LIMITS = {
  /** Browsers/devices a single user may register for push. */
  maxSubscriptionsPerUser: 10,
  /** Pending reminders kept per user; extra ones (furthest in the future) are skipped. */
  maxRemindersPerUser: 1000,
  /** Reminders further out than this are not scheduled (the client re-reconciles later). */
  reminderHorizonDays: 90,
  /** How far back the timer catches up after downtime. */
  catchUpHours: 24,
} as const;

/** Shape of `PushSubscription.toJSON()` that the API needs. */
export interface PushSubscriptionDto {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PutSubscriptionRequest {
  subscription: PushSubscriptionDto;
}

export interface DeleteSubscriptionRequest {
  endpoint: string;
}

export interface ReminderDto {
  /** Graph todoTask id. */
  taskId: string;
  /** Graph todoTaskList id. */
  listId: string;
  /** ISO-8601 instant in UTC, e.g. `2026-11-05T08:00:00.000Z`. */
  fireAt: string;
}

/** Full desired set of the user's upcoming reminders; the server reconciles to exactly this set. */
export interface PutRemindersRequest {
  reminders: ReminderDto[];
}

export interface PutRemindersResponse {
  scheduled: number;
  removed: number;
  skipped: number;
}

/** Payload of a Web Push message. The service worker resolves the title from its local cache. */
export interface ReminderPushPayload {
  type: 'reminder';
  taskId: string;
  listId: string;
  fireAt: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
