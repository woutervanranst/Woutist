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
  /** Android devices (FCM tokens) a single user may register for sync signals. */
  maxDevicesPerUser: 10,
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

// ---------- Near-instant sync ----------
// Graph sends change notifications for each list to the API, which tells the user's devices to sync.
// The API still never sees task content: only list ids.

/** `GET /api/graph-hook`: what a device puts in the Graph subscriptions it creates for the user's lists. */
export interface GraphHookResponse {
  /** `notificationUrl` of every Graph subscription for this user. */
  notificationUrl: string;
  /** `clientState` of every Graph subscription for this user; the API checks it on each notification. */
  clientState: string;
}

/** `GET /api/realtime`: a WebSocket URL that receives {@link SyncSignal}s for the caller while it is open. */
export interface RealtimeResponse {
  url: string;
}

/** `PUT` / `DELETE /api/devices`: an Android device's FCM registration token. */
export interface DeviceRequest {
  token: string;
}

/**
 * "Something changed in these lists: sync them." Sent over the realtime channel as JSON, and to Android
 * as FCM data (`type`, and `listIds` as a JSON string, because FCM data values must be strings).
 */
export interface SyncSignal {
  type: 'changed';
  listIds: string[];
}
