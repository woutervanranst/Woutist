// Dev-only demo mode (http://localhost:5173/?demo): no sign-in, Graph answered by an in-memory fake.
// Never included in production builds (only imported behind import.meta.env.DEV).
import { Client, type Context, type Middleware } from '@microsoft/microsoft-graph-client'
import { getResponse } from 'msw'
import type { AuthAdapter } from '../auth/AuthContext'
import { addDays, instantToZonedWall, todayLocal, userTimeZone, zonedWallToInstant } from '../models/time'
import { FakeGraph } from '../test/fakeGraph'

const DEMO_FLAG = 'woutist:demo'
const MANY_FLAG = 'woutist:demo-many'

export function isDemoRequested(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.has('demo')) {
    sessionStorage.setItem(DEMO_FLAG, '1')
    // ?demo&many=8000 adds a long history of completed tasks (and ~400 open ones), to try performance.
    const many = Number(params.get('many'))
    if (many > 0) sessionStorage.setItem(MANY_FLAG, String(Math.floor(many)))
    else sessionStorage.removeItem(MANY_FLAG)
  }
  if (params.has('nodemo')) {
    sessionStorage.removeItem(DEMO_FLAG)
    sessionStorage.removeItem(MANY_FLAG)
  }
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

const WORDS = (
  'call email buy book plan fix clean order check pay renew review send write read prepare cancel schedule ' +
  'plumber dentist passport groceries invoice report slides garden car bike insurance taxes school birthday ' +
  'present recipe flight hotel meeting budget contract newsletter backup laptop printer café crème Zoë'
).split(' ')

/** Many tasks for trying performance: `completed` done ones over the past years, ~400 open ones. */
function seedMany(fake: FakeGraph, completed: number) {
  const tz = userTimeZone()
  const today = todayLocal()
  const day = (days: number) => ({ dateTime: `${addDays(today, days)}T00:00:00`, timeZone: tz })
  let seed = 42
  const random = () => {
    // mulberry32: the same tasks on every load
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ')
  const sentence = (n: number) => {
    const s = words(n)
    return s[0].toUpperCase() + s.slice(1)
  }

  const lists = [
    fake.addList('🏠 Home'),
    fake.addList('📚 Archive'),
    fake.addList('✈️ Travel'),
    ...[...fake.lists.values()].filter((l) => l.list.wellknownListName !== 'flaggedEmails').map((l) => l.list.id!),
  ]
  const extras = () => ({
    ...(random() < 0.3 ? { body: { content: `${sentence(8)}. ${sentence(12)}.`, contentType: 'text' as const } } : {}),
    ...(random() < 0.15
      ? { checklistItems: Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({ displayName: sentence(3), isChecked: random() < 0.5 })) }
      : {}),
    ...(random() < 0.05 ? { categories: ['Red category'] } : {}),
  })

  for (let i = 0; i < completed; i++) {
    const ago = Math.floor(random() * 1000)
    fake.addTask(pick(lists), {
      title: sentence(2 + Math.floor(random() * 4)),
      status: 'completed',
      completedDateTime: day(-ago),
      createdDateTime: new Date(Date.now() - (ago + 7) * 86_400_000).toISOString(),
      ...extras(),
    })
  }
  for (let i = 0; i < 400; i++) {
    fake.addTask(pick(lists), {
      title: sentence(2 + Math.floor(random() * 4)),
      importance: random() < 0.1 ? 'high' : 'normal',
      ...(random() < 0.3 ? { dueDateTime: day(Math.floor(random() * 60) - 10) } : {}),
      createdDateTime: new Date(Date.now() - Math.floor(random() * 300) * 86_400_000).toISOString(),
      ...extras(),
    })
  }
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
  const many = Number(sessionStorage.getItem(MANY_FLAG) ?? 0)
  if (many) seedMany(fake, many)
  const middleware = new FakeGraphMiddleware(fake)
  return {
    // Its own database, so the small and the large demo don't mix.
    account: { key: many ? `demo-many-${many}` : 'demo', name: 'Demo User', username: 'demo@example.com' },
    busy: false,
    getApiToken: async () => 'demo-api-token',
    signIn: async () => {},
    signOut: async () => {
      sessionStorage.removeItem(DEMO_FLAG)
      sessionStorage.removeItem(MANY_FLAG)
      window.location.assign('/?nodemo')
    },
    createGraphClient: () => Client.initWithMiddleware({ middleware }),
  }
}
