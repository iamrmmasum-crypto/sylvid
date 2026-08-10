// ============================================================
// HTTP Polling Signaling Client (drop-in Socket.io replacement)
// Works on Vercel serverless, no WebSocket needed
// ============================================================

type EventHandler = (...args: any[]) => void

interface SignalSocket {
  on(event: string, handler: EventHandler): SignalSocket
  emit(event: string, data?: any): void
  disconnect(): void
  connected: boolean
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
      const { events } = await res.json()
      for (const ev of events) {
        if (ev.ts > lastTs) lastTs = ev.ts
        fire(ev.type, ev.data)
      }
    } catch {
      // Network error — will retry on next interval
    }
  }

  async function send(event: string, data?: any) {
    if (!alive) return
    try {
      await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, type: event, data: data || {} }),
      })
    } catch {
      // Silently fail
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
  }
}

export { createSignalSocket }
export type { SignalSocket }
