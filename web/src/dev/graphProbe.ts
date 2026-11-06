// Dev-only helper for exploring Graph from the browser console:
//   await __woutist.graph('/me/todo/lists')
//   await __woutist.graph('/me/todo/lists/{id}/tasks', { method: 'POST', body: { title: 'x' } })
import { getGraphToken } from '../auth/tokens'
import { runGraphSpike } from './graphSpike'
import { runWebhookSpike } from './webhookSpike'

interface ProbeInit {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

async function graph(path: string, init: ProbeInit = {}) {
  const token = await getGraphToken()
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let json: unknown = text
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // keep text
  }
  return { status: res.status, body: json }
}

declare global {
  interface Window {
    __woutist?: { graph: typeof graph; spike: typeof runGraphSpike; spikeWebhooks: typeof runWebhookSpike }
  }
}

window.__woutist = { graph, spike: runGraphSpike, spikeWebhooks: runWebhookSpike }
