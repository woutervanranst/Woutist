// Dev-only demo mode (http://localhost:5173/?demo): no sign-in, Graph answered by an in-memory fake.
// Never included in production builds (only imported behind import.meta.env.DEV).
import { Client, type Context, type Middleware } from '@microsoft/microsoft-graph-client'
import { getResponse } from 'msw'
import type { AuthAdapter } from '../auth/AuthContext'
import { addDays, instantToZonedWall, todayLocal, userTimeZone, zonedWallToInstant } from '../models/time'
import { FakeGraph } from '../test/fakeGraph'

const DEMO_FLAG = 'woutist:demo'

export function isDemoRequested(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.has('demo')) sessionStorage.setItem(DEMO_FLAG, '1')
  if (params.has('nodemo')) sessionStorage.removeItem(DEMO_FLAG)
  return sessionStorage.getItem(DEMO_FLAG) === '1'
}

function seed(fake: FakeGraph) {
  const tz = userTimeZone()
  const today = todayLocal()
  const due = (days: number) => ({ dateTime: `${addDays(today, days)}T00:00:00`, timeZone: tz })
  const at = (days: number, hhmm: string) => ({
    dateTime: instantToZonedWall(zonedWallToInstant(`${addDays(today, days)}T${hhmm}:00`, tz), tz),
    timeZone: tz,
  })

  const tasks = fake.addList('Tasks', { wellknownListName: 'defaultList' })
  fake.addList('Flagged email', { wellknownListName: 'flaggedEmails' })
  const groceries = fake.addList('🛒 Groceries', { isShared: true })
  const work = fake.addList('💼 Work')
  fake.addList('Reading list')

  fake.addTask(tasks, { title: 'Renew passport', importance: 'high', dueDateTime: due(-2) })
  fake.addTask(tasks, {
    title: 'https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0&tabs=http#long-unbreakable-url',
    dueDateTime: due(1),
  })
  fake.addTask(tasks, {
    title: 'Call the plumber',
    dueDateTime: due(0),
    reminderDateTime: at(0, '17:00'),
    isReminderOn: true,
    body: { content: 'Kitchen sink is leaking again.', contentType: 'text' },
  })
  fake.addTask(tasks, {
    title: 'Water the plants',
    dueDateTime: due(1),
    recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['thursday'] }, range: { type: 'noEnd', startDate: addDays(today, 1) } },
  })
  fake.addTask(tasks, { title: 'Book dentist appointment', status: 'completed', completedDateTime: due(-1) })
  fake.addTask(groceries, {
    title: 'Milk',
    checklistItems: [
      { displayName: 'Oat milk', isChecked: true },
      { displayName: 'Whole milk', isChecked: false },
    ],
  })
  fake.addTask(groceries, { title: 'Bread', categories: ['Red category'] })
  fake.addTask(work, {
    title: 'Prepare quarterly review',
    importance: 'high',
    dueDateTime: due(4),
    checklistItems: [
      { displayName: 'Collect numbers', isChecked: true },
      { displayName: 'Draft slides', isChecked: false },
      { displayName: 'Dry run', isChecked: false },
    ],
  })
  fake.addTask(work, { title: 'Reply to Anna', reminderDateTime: at(1, '09:00'), isReminderOn: true })
}

/** Graph middleware that answers every request from the fake (no network). */
class FakeGraphMiddleware implements Middleware {
  private readonly handlers: ReturnType<FakeGraph['handlers']>
  constructor(fake: FakeGraph) {
    this.handlers = fake.handlers()
  }
  async execute(context: Context): Promise<void> {
    const url = typeof context.request === 'string' ? context.request : context.request.url
    const request = new Request(url, context.options as RequestInit)
    await new Promise((r) => setTimeout(r, 80)) // feel a little like a network
    context.response =
      (await getResponse(this.handlers, request)) ??
      new Response(JSON.stringify({ error: { code: 'NotFound', message: 'Not in demo' } }), { status: 404 })
  }
}

export function createDemoAuth(): AuthAdapter {
  const fake = new FakeGraph()
  seed(fake)
  const middleware = new FakeGraphMiddleware(fake)
  return {
    account: { key: 'demo', name: 'Demo User', username: 'demo@example.com' },
    busy: false,
    getApiToken: async () => 'demo-api-token',
    signIn: async () => {},
    signOut: async () => {
      sessionStorage.removeItem(DEMO_FLAG)
      window.location.assign('/?nodemo')
    },
    createGraphClient: () => Client.initWithMiddleware({ middleware }),
  }
}
