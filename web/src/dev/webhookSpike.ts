// Dev-only spike: do Graph change notifications work for To Do tasks on this account, and how fast?
//
// 1. node scripts/graph-webhook-receiver.mjs
// 2. cloudflared tunnel --url http://localhost:7072        → https://<name>.trycloudflare.com
// 3. In the console after signing in: await __woutist.spikeWebhooks('https://<name>.trycloudflare.com')
//    Pass { manualSeconds: 90 } to also time an edit you make on to-do.office.com (or the phone app).
//
// Creates a temporary list with a subscription and deletes both at the end.
import { call } from './graphSpike'

/** Graph's documented maximum lifetime for todoTask subscriptions. */
const MAX_MINUTES = 4230

interface ReceivedEvent {
  receivedAt: string
  subscriptionId?: string
  changeType?: string
  resource?: string
  clientState?: string
  lifecycleEvent?: string
}

async function events(receiverUrl: string): Promise<ReceivedEvent[]> {
  const res = await fetch(`${receiverUrl}/events`)
  return (await res.json()) as ReceivedEvent[]
}

/** Waits until the receiver has a notification for `subscriptionId` newer than `since`; returns ms from `since`. */
async function waitFor(receiverUrl: string, subscriptionId: string, since: number, timeoutMs: number) {
  const deadline = since + timeoutMs
  while (Date.now() < deadline) {
    const hit = (await events(receiverUrl)).find(
      (e) => e.subscriptionId === subscriptionId && Date.parse(e.receivedAt) >= since,
    )
    if (hit) return { latencyMs: Date.parse(hit.receivedAt) - since, changeType: hit.changeType, resource: hit.resource, clientStateEchoed: Boolean(hit.clientState) }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return { latencyMs: null, timedOut: true }
}

export async function runWebhookSpike(receiverUrl: string, options: { manualSeconds?: number } = {}) {
  const base = receiverUrl.replace(/\/$/, '')
  const report: Record<string, unknown> = { receiverUrl: base }
  const clientState = crypto.randomUUID()

  const existing = await call('GET', '/subscriptions')
  report.existingSubscriptions = { status: existing.status, count: existing.json?.value?.length, error: existing.json?.error }

  const list = await call('POST', '/me/todo/lists', { displayName: `Woutist webhook spike ${new Date().toISOString()}` })
  const listId = list.json.id as string
  const L = `/me/todo/lists/${encodeURIComponent(listId)}`
  let subscriptionId: string | undefined
  try {
    // 1. Too long an expiry is refused? (Documents the real maximum.)
    const tooLong = await call('POST', '/subscriptions', {
      changeType: 'created,updated,deleted',
      notificationUrl: base,
      resource: `${L}/tasks`,
      expirationDateTime: new Date(Date.now() + (MAX_MINUTES + 120) * 60_000).toISOString(),
      clientState,
    })
    report.createBeyondMax = { status: tooLong.status, error: tooLong.json?.error?.message, expiration: tooLong.json?.expirationDateTime }
    if (tooLong.status === 201) await call('DELETE', `/subscriptions/${tooLong.json.id}`)

    // 2. Create at the documented maximum.
    const sub = await call('POST', '/subscriptions', {
      changeType: 'created,updated,deleted',
      notificationUrl: base,
      resource: `${L}/tasks`,
      expirationDateTime: new Date(Date.now() + (MAX_MINUTES - 5) * 60_000).toISOString(),
      clientState,
    })
    report.create = { status: sub.status, error: sub.json?.error, resource: sub.json?.resource, expiration: sub.json?.expirationDateTime }
    if (sub.status !== 201) return report
    subscriptionId = sub.json.id as string

    const listed = await call('GET', '/subscriptions')
    report.listedAfterCreate = listed.json?.value?.some((s: { id: string }) => s.id === subscriptionId)

    // 3. Latency of changes made through Graph.
    let t = Date.now()
    const task = await call('POST', `${L}/tasks`, { title: 'webhook spike task' })
    report.notifyOnCreate = await waitFor(base, subscriptionId, t, 60_000)
    const T = `${L}/tasks/${encodeURIComponent(task.json.id)}`

    t = Date.now()
    await call('PATCH', T, { title: 'webhook spike task (renamed)' })
    report.notifyOnUpdate = await waitFor(base, subscriptionId, t, 60_000)

    t = Date.now()
    await call('POST', `${T}/checklistItems`, { displayName: 'step' })
    report.notifyOnStepAdd = await waitFor(base, subscriptionId, t, 60_000)

    t = Date.now()
    await call('PATCH', T, { status: 'completed' })
    report.notifyOnComplete = await waitFor(base, subscriptionId, t, 60_000)

    // 4. Optional: an edit made in Microsoft's own apps.
    if (options.manualSeconds) {
      console.log(`[webhook spike] Within ${options.manualSeconds}s, edit "webhook spike task (renamed)" in the list "${list.json.displayName}" on to-do.office.com or the phone app.`)
      t = Date.now()
      report.notifyOnManualEdit = await waitFor(base, subscriptionId, t, options.manualSeconds * 1000)
    }

    // 5. Renewal.
    const renew = await call('PATCH', `/subscriptions/${subscriptionId}`, {
      expirationDateTime: new Date(Date.now() + (MAX_MINUTES - 5) * 60_000).toISOString(),
    })
    report.renew = { status: renew.status, error: renew.json?.error?.message, expiration: renew.json?.expirationDateTime }

    t = Date.now()
    await call('DELETE', T)
    report.notifyOnDelete = await waitFor(base, subscriptionId, t, 60_000)
  } catch (error) {
    report.error = String(error)
  } finally {
    // 6. What happens to the subscription when its list is deleted?
    report.deleteList = (await call('DELETE', L)).status
    if (subscriptionId) {
      await new Promise((r) => setTimeout(r, 5000))
      const after = await call('GET', `/subscriptions/${subscriptionId}`)
      report.subscriptionAfterListDelete = { status: after.status, error: after.json?.error?.code }
      report.cleanup = (await call('DELETE', `/subscriptions/${subscriptionId}`)).status
      report.lifecycleEvents = (await events(base)).filter((e) => e.subscriptionId === subscriptionId && e.lifecycleEvent)
    }
  }
  console.log('[webhook spike]', JSON.stringify(report, null, 2))
  return report
}
