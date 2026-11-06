#!/usr/bin/env node
// Dev-only receiver for Graph change notifications, used by `await __woutist.spikeWebhooks(url)`.
//
//   node scripts/graph-webhook-receiver.mjs            # listens on :7072
//   cloudflared tunnel --url http://localhost:7072     # prints a public https://….trycloudflare.com URL
//
// POST /       Graph validation (echoes ?validationToken) and notifications (kept in memory).
// GET  /events Every notification received so far, with the time it arrived (CORS open, for the spike).
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 7072)
const events = []

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(events))
  }

  if (req.method === 'POST') {
    const validationToken = url.searchParams.get('validationToken')
    if (validationToken !== null) {
      console.log(new Date().toISOString(), 'validation request answered')
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end(validationToken)
    }
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const receivedAt = new Date().toISOString()
      let parsed = null
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = body
      }
      for (const item of parsed?.value ?? [parsed]) {
        events.push({ receivedAt, path: url.pathname, ...item })
        console.log(receivedAt, item?.changeType ?? item?.lifecycleEvent ?? '?', item?.resource ?? '')
      }
      res.writeHead(202).end()
    })
    return
  }

  res.writeHead(404).end()
})

server.listen(port, () => console.log(`Graph webhook receiver on http://localhost:${port}`))
