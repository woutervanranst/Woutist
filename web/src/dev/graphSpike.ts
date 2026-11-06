// Dev-only Graph spike: verifies assumptions of the sync design against the live API.
// Run from the console after signing in: await __woutist.spike()
// Creates a temporary list and deletes it again at the end.
import { getGraphToken } from '../auth/tokens'

const BASE = 'https://graph.microsoft.com/v1.0'
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const token = await getGraphToken()
  const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

const prefer = { Prefer: `outlook.timezone="${TZ}"` }

export async function runGraphSpike() {
  const report: Record<string, unknown> = { timeZone: TZ }
  const lists = await call('GET', '/me/todo/lists')
  report.wellknownListNames = lists.json?.value?.map((l: any) => `${l.displayName}:${l.wellknownListName}`)

  const list = await call('POST', '/me/todo/lists', { displayName: `Woutist spike ${new Date().toISOString()}` })
  const listId = list.json.id
  const L = `/me/todo/lists/${encodeURIComponent(listId)}`
  try {
    // 1. Due date / reminder written with an IANA zone.
    const due = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
    const created = await call('POST', `${L}/tasks`, {
      title: 'spike task',
      dueDateTime: { dateTime: `${due}T00:00:00`, timeZone: TZ },
      reminderDateTime: { dateTime: `${due}T09:00:00`, timeZone: TZ },
      isReminderOn: true,
    })
    report.createWithIanaZone = { status: created.status, due: created.json?.dueDateTime, reminder: created.json?.reminderDateTime }
    const taskId = created.json?.id
    const T = `${L}/tasks/${encodeURIComponent(taskId)}`
    const readUtc = await call('GET', T)
    const readPrefer = await call('GET', T, undefined, prefer)
    report.readBackDefault = { due: readUtc.json?.dueDateTime, reminder: readUtc.json?.reminderDateTime }
    report.readBackPreferTz = { due: readPrefer.json?.dueDateTime, reminder: readPrefer.json?.reminderDateTime }

    // 2. $expand on the task collection.
    const expanded = await call('GET', `${L}/tasks?$expand=checklistItems,linkedResources`)
    report.expandOnList = { status: expanded.status, hasChecklistKey: 'checklistItems' in (expanded.json?.value?.[0] ?? {}) }

    // 3. Delta: initial round, $expand support, and whether step changes show up.
    const delta0 = await call('GET', `${L}/tasks/delta`)
    let deltaLink = delta0.json?.['@odata.deltaLink']
    let next = delta0.json?.['@odata.nextLink']
    while (!deltaLink && next) {
      const page = await call('GET', next)
      deltaLink = page.json?.['@odata.deltaLink']
      next = page.json?.['@odata.nextLink']
    }
    report.deltaInitial = { status: delta0.status, items: delta0.json?.value?.length, hasDeltaLink: Boolean(deltaLink) }
    const deltaExpand = await call('GET', `${L}/tasks/delta?$expand=checklistItems`)
    report.deltaWithExpand = { status: deltaExpand.status, error: deltaExpand.json?.error?.code, firstHasSteps: 'checklistItems' in (deltaExpand.json?.value?.[0] ?? {}) }

    const step = await call('POST', `${T}/checklistItems`, { displayName: 'spike step' })
    const afterStepAdd = await call('GET', deltaLink)
    report.deltaAfterStepAdd = { status: afterStepAdd.status, changedIds: afterStepAdd.json?.value?.map((t: any) => t.id === taskId ? 'spike-task' : t.id) }
    deltaLink = afterStepAdd.json?.['@odata.deltaLink'] ?? deltaLink
    await call('PATCH', `${T}/checklistItems/${encodeURIComponent(step.json?.id)}`, { isChecked: true })
    const afterStepCheck = await call('GET', deltaLink)
    report.deltaAfterStepCheck = { changedIds: afterStepCheck.json?.value?.map((t: any) => t.id === taskId ? 'spike-task' : t.id) }
    deltaLink = afterStepCheck.json?.['@odata.deltaLink'] ?? deltaLink

    // 4. Recurrence + completion: does Graph create the next occurrence?
    const rec = await call('PATCH', T, {
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: [new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase()] }, range: { type: 'noEnd', startDate: due } },
    })
    report.setRecurrence = { status: rec.status, error: rec.json?.error?.message, recurrence: rec.json?.recurrence }
    const done = await call('PATCH', T, { status: 'completed' }, prefer)
    report.completeRecurring = { status: done.status, completedDateTime: done.json?.completedDateTime }
    const afterComplete = await call('GET', `${L}/tasks`, undefined, prefer)
    report.tasksAfterCompletingRecurring = afterComplete.json?.value?.map((t: any) => ({ title: t.title, status: t.status, due: t.dueDateTime?.dateTime, sameId: t.id === taskId }))
    const deltaAfterComplete = await call('GET', deltaLink)
    report.deltaAfterComplete = deltaAfterComplete.json?.value?.length

    // 5. Attachments.
    const att = await call('POST', `${T}/attachments`, {
      '@odata.type': '#microsoft.graph.taskFileAttachment',
      name: 'spike.txt',
      contentType: 'text/plain',
      contentBytes: btoa('hello from woutist'),
    })
    const atts = await call('GET', `${T}/attachments?$select=id,name,contentType,size,lastModifiedDateTime`)
    report.attachments = { createStatus: att.status, list: atts.json?.value }

    // 6. Categories and profile photo.
    const cats = await call('GET', '/me/outlook/masterCategories')
    report.masterCategories = { status: cats.status, count: cats.json?.value?.length, error: cats.json?.error?.code }
    // 6b. Category writes (needs MailboxSettings.ReadWrite): is displayName really read-only? Does To Do cascade a rename?
    const catName = `Woutist spike ${Date.now()}`
    const catCreate = await call('POST', '/me/outlook/masterCategories', { displayName: catName, color: 'preset7' })
    const catId = catCreate.json?.id
    if (catId) {
      const C = `/me/outlook/masterCategories/${encodeURIComponent(catId)}`
      const taggedTask = await call('POST', `${L}/tasks`, { title: 'category spike', categories: [catName] })
      const recolor = await call('PATCH', C, { color: 'preset4' })
      const rename = await call('PATCH', C, { displayName: `${catName} renamed` })
      const afterRename = await call('GET', `${L}/tasks/${encodeURIComponent(taggedTask.json?.id)}`)
      const duplicate = await call('POST', '/me/outlook/masterCategories', { displayName: catName.toUpperCase(), color: 'preset7' })
      const remove = await call('DELETE', C)
      const afterDelete = await call('GET', `${L}/tasks/${encodeURIComponent(taggedTask.json?.id)}`)
      report.categoryWrites = {
        create: catCreate.status,
        recolor: recolor.status,
        renameStatus: rename.status,
        renameError: rename.json?.error?.code,
        renameReturnedName: rename.json?.displayName,
        nameAfterRename: (await call('GET', C)).json?.displayName,
        taskCategoriesAfterRename: afterRename.json?.categories,
        duplicateStatus: duplicate.status,
        deleteStatus: remove.status,
        taskCategoriesAfterDelete: afterDelete.json?.categories,
      }
    } else {
      report.categoryWrites = { create: catCreate.status, error: catCreate.json?.error?.code }
    }
    const photo = await fetch(`${BASE}/me/photo/$value`, { headers: { Authorization: `Bearer ${await getGraphToken()}` } })
    report.photoStatus = photo.status

    // 7. Lists delta.
    const listsDelta = await call('GET', '/me/todo/lists/delta')
    report.listsDelta = { status: listsDelta.status, hasDeltaLink: Boolean(listsDelta.json?.['@odata.deltaLink'] || listsDelta.json?.['@odata.nextLink']) }

    // 8. Open extension on a list (how Woutist saves settings): create, read by name, update, conflict.
    const extName = 'com.wouteronarchitecture.woutist.spike'
    const extBody = { '@odata.type': 'microsoft.graph.openTypeExtension', extensionName: extName }
    const extCreate = await call('POST', `${L}/extensions`, { ...extBody, updatedAt: 'a', settings: '{"x":1}' })
    const extGet = await call('GET', `${L}/extensions/${encodeURIComponent(extName)}`)
    const extPatch = await call('PATCH', `${L}/extensions/${encodeURIComponent(extName)}`, { ...extBody, updatedAt: 'b', settings: '{"x":2}' })
    const extAgain = await call('GET', `${L}/extensions/${encodeURIComponent(extName)}`)
    const extDuplicate = await call('POST', `${L}/extensions`, { ...extBody, updatedAt: 'c', settings: '{}' })
    const extMissing = await call('GET', `${L}/extensions/${encodeURIComponent(`${extName}.missing`)}`)
    report.listExtension = {
      create: { status: extCreate.status, id: extCreate.json?.id, error: extCreate.json?.error?.code },
      getByName: { status: extGet.status, settings: extGet.json?.settings, updatedAt: extGet.json?.updatedAt },
      patch: { status: extPatch.status, error: extPatch.json?.error?.code },
      afterPatch: { settings: extAgain.json?.settings, updatedAt: extAgain.json?.updatedAt },
      duplicateCreate: { status: extDuplicate.status, error: extDuplicate.json?.error?.code },
      missing: extMissing.status,
    }
  } catch (error) {
    report.error = String(error)
  } finally {
    const del = await call('DELETE', L)
    report.cleanup = del.status
  }
  console.log('[spike]', JSON.stringify(report, null, 2))
  return report
}
