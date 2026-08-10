// ============================================================
// HTTP Polling Signaling Client (drop-in Socket.io replacement)
// Works on Vercel serverless with KV-backed state, no WebSocket needed
// ============================================================

type EventHandler = (...args: any[]) => void

interface SignalSocket {
  on(event: string, handler: EventHandler): SignalSocket
  emit(event: string, data?: any): void
  disconnect(): void
  connected: boolean
  /** The internal user ID used for polling and signaling */
  userId: string
}

function createSignalSocket(): SignalSocket {
  const userId = crypto.randomUUID()
  const handlers = new Map<string, EventHandler[]>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let lastTs = 0
  let alive = true
  let started = false

  function fire(event: string, data?: any) {
    const list = handlers.get(event) || []
    list.forEach((h) => {
      try { h(data) } catch (e) { console.error(`Signal handler error [${event}]:`, e) }
    })
  }

  async function poll() {
    if (!alive) return
    try {
      const res = await fetch(`/api/signal?u=${userId}&s=${lastTs}`)
      if (!res.ok) {
        console.warn(`[Sylvid] Poll error: ${res.status}`)
        return
      }
      const data = await res.json()
      // Check if KV is not configured
      if (data.kvError) {
        console.error('[Sylvid] Vercel KV not linked! See: Vercel Dashboard → Storage → Create KV Store')
        fire('kv-error', data)
        return
      }
      // Fire peer-list from the poll response so the client always has fresh peer data
      // even if peer-list events are missed due to serverless routing or network issues
      if (data.peers && Array.isArray(data.peers)) {
        fire('peer-list', { peers: data.peers })
      }
      const events: Array<{ type: string; data: any; ts: number }> = data.events || []
      for (const ev of events) {
        if (ev.ts > lastTs) lastTs = ev.ts
        fire(ev.type, ev.data)
      }
    } catch (e) {
      console.warn('[Sylvid] Poll network error:', e)
    }
  }

  async function send(event: string, data?: any) {
    if (!alive) return
    try {
      const res = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, type: event, data: data || {} }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        if (errData.setup) {
          console.error('[Sylvid] Server error:', errData.error)
          fire('kv-error', errData)
        }
      }
    } catch (e) {
      console.warn('[Sylvid] Send network error:', e)
    }
  }

  // Start polling
  function start() {
    if (started) return
    started = true
    fire('connect')
    poll()
    pollTimer = setInterval(poll, 800)
  }

  // Auto-start immediately
  start()

  return {
    on(event: string, handler: EventHandler): SignalSocket {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event)!.push(handler)
      return this
    },
    emit(event: string, data?: any) {
      send(event, data)
    },
    disconnect() {
      alive = false
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      fire('disconnect')
    },
    get connected() { return alive },
    get userId() { return userId },
  }
}

export { createSignalSocket }
export type { SignalSocket }
