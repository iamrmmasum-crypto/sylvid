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
  /** Backend type: 'memory' (single server) or 'kv' (Vercel KV) */
  backend: string
}

function createSignalSocket(): SignalSocket {
  const userId = crypto.randomUUID()
  const handlers = new Map<string, EventHandler[]>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let lastTs = 0
  let alive = true
  let started = false
  let backend = 'unknown'

  // Reconnection backoff state
  let consecutiveFailures = 0
  let currentPollInterval = 800
  const BASE_POLL_INTERVAL = 800
  const MAX_POLL_INTERVAL = 8000
  const MAX_CONSECUTIVE_FAILURES = 5

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
        handlePollFailure()
        return
      }
      const data = await res.json()
      // Check if KV is not configured
      if (data.kvError) {
        console.error('[Sylvid] Vercel KV not linked! See: Vercel Dashboard → Storage → Create KV Store')
        fire('kv-error', data)
        return
      }
      // Track backend type from server response
      if (data.backend) backend = data.backend

      // Successful poll — reset failure counter and adjust interval back down
      handlePollSuccess()

      // Fire peer-list from the poll response (freshest data from the server at GET time)
      // This always takes priority over any queued peer-list events
      if (data.peers && Array.isArray(data.peers)) {
        fire('peer-list', { peers: data.peers })
      }
      // Process queued events, but SKIP stale peer-list events — the poll
      // response above already has the latest peer list. A queued peer-list
      // from an earlier broadcast would overwrite the fresh data.
      const events: Array<{ type: string; data: any; ts: number }> = data.events || []
      for (const ev of events) {
        if (ev.ts > lastTs) lastTs = ev.ts
        if (ev.type !== 'peer-list') {
          fire(ev.type, ev.data)
        }
      }
    } catch (e) {
      console.warn('[Sylvid] Poll network error:', e)
      handlePollFailure()
    }
  }

  /** On poll success: reset failure counter, gradually reduce interval back to base */
  function handlePollSuccess() {
    if (consecutiveFailures > 0) {
      consecutiveFailures = 0
      // Gradually reduce interval back to base (don't jump immediately)
      currentPollInterval = Math.max(BASE_POLL_INTERVAL, currentPollInterval * 0.5)
      restartPollTimer()
    }
  }

  /** On poll failure: increase interval with exponential backoff */
  function handlePollFailure() {
    consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(`[Sylvid] ${MAX_CONSECUTIVE_FAILURES} consecutive poll failures — firing reconnect event`)
      fire('reconnecting', { attempts: consecutiveFailures })
    }
    // Exponential backoff: 800ms → 1.6s → 3.2s → 6.4s → 8s (capped)
    currentPollInterval = Math.min(MAX_POLL_INTERVAL, currentPollInterval * 2)
    console.log(`[Sylvid] Poll failure #${consecutiveFailures} — backing off to ${currentPollInterval}ms`)
    restartPollTimer()
  }

  /** Stop and restart the poll timer with current interval */
  function restartPollTimer() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (alive && started) {
      pollTimer = setInterval(poll, currentPollInterval)
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
    pollTimer = setInterval(poll, currentPollInterval)
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
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      fire('disconnect')
    },
    get connected() { return alive },
    get userId() { return userId },
    get backend() { return backend },
  }
}

export { createSignalSocket }
export type { SignalSocket }
