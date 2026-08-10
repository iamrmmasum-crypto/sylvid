import { NextRequest, NextResponse } from 'next/server'

// ============================================================
// TYPES
// ============================================================

interface PeerInfo {
  id: string
  username: string
  device: string
  isAdmin: boolean
  connectedAt: number
  inCallWith: string | null
  callStartedAt: number | null
}

interface ActiveCall {
  id: string
  callerId: string
  callerName: string
  calleeId: string
  calleeName: string
  startedAt: number
}

interface QueuedEvent {
  type: string
  data: any
  ts: number
}

// ============================================================
// DUAL BACKEND: Vercel KV (Redis) when available, globalThis otherwise
// ============================================================

// --- In-memory fallback (works on Railway, local dev) ---

type InMemoryStore = {
  peers: Map<string, PeerInfo>
  events: Map<string, QueuedEvent[]>
  bannedUsernames: Set<string>
  activeCalls: Map<string, ActiveCall>
  callCounter: number
  lastSeen: Map<string, number>
}

const globalForStore = globalThis as unknown as { __sylvidStore?: InMemoryStore }
if (!globalForStore.__sylvidStore) {
  globalForStore.__sylvidStore = {
    peers: new Map(),
    events: new Map(),
    bannedUsernames: new Set(),
    activeCalls: new Map(),
    callCounter: 0,
    lastSeen: new Map(),
  }
}
const mem = globalForStore.__sylvidStore

// --- Detect if Vercel KV is available ---

let kv: any = null
let useKV = false

try {
  if (process.env.KV_REST_API_URL || process.env.KV_URL || process.env.KVC_REST_API_URL) {
    // Dynamic import to avoid crash when @vercel/kv isn't linked
    const mod = require('@vercel/kv')
    kv = mod.kv
    useKV = true
    console.log('[Sylvid] Using Vercel KV (Redis) for signaling state')
  } else {
    console.log('[Sylvid] KV not detected, using in-memory state (works on Railway/persistent servers)')
  }
} catch {
  console.log('[Sylvid] @vercel/kv not available, using in-memory state')
}

const ADMIN_SECRET = 'admin2024'
const PEER_TTL = 30
const EVENT_TTL = 300
const P = 'sylvid'

// ============================================================
// ABSTRACTION LAYER — same API for both backends
// ============================================================

function pk(id: string) { return `${P}:peer:${id}` }
function ek(id: string) { return `${P}:events:${id}` }
function sk(id: string) { return `${P}:seen:${id}` }

// --- pushEvent ---
async function pushEvent(userId: string, type: string, data: any) {
  const ev: QueuedEvent = { type, data, ts: Date.now() }
  if (useKV) {
    const pipe = kv.pipeline()
    pipe.rpush(ek(userId), JSON.stringify(ev))
    pipe.expire(ek(userId), EVENT_TTL)
    await pipe.exec()
  } else {
    if (!mem.events.has(userId)) mem.events.set(userId, [])
    mem.events.get(userId)!.push(ev)
  }
}

// --- getEvents ---
async function getEvents(userId: string, since: number): Promise<QueuedEvent[]> {
  if (useKV) {
    const raw = (await kv.lrange(ek(userId), 0, -1)) as string[] | null
    if (!raw || raw.length === 0) return []
    return raw.map((s) => JSON.parse(s)).filter((e: QueuedEvent) => e.ts > since)
  } else {
    const queue = mem.events.get(userId) || []
    const newEvents = queue.filter((e) => e.ts > since)
    // Remove all delivered events (both old and new) to prevent memory leak
    mem.events.set(userId, [])
    return newEvents
  }
}

// --- setPeer ---
async function setPeer(id: string, peer: PeerInfo) {
  if (useKV) {
    const pipe = kv.pipeline()
    pipe.set(pk(id), JSON.stringify(peer))
    pipe.sadd(`${P}:peers`, id)
    pipe.set(sk(id), Date.now(), { ex: PEER_TTL })
    await pipe.exec()
  } else {
    mem.peers.set(id, peer)
    mem.lastSeen.set(id, Date.now())
  }
}

// --- getPeer ---
async function getPeer(id: string): Promise<PeerInfo | null> {
  if (useKV) {
    const raw = await kv.get(pk(id))
    return raw ? (JSON.parse(raw as string) as PeerInfo) : null
  } else {
    return mem.peers.get(id) || null
  }
}

// --- deletePeer ---
async function deletePeer(id: string) {
  if (useKV) {
    const pipe = kv.pipeline()
    pipe.del(pk(id), ek(id), sk(id))
    pipe.srem(`${P}:peers`, id)
    await pipe.exec()
  } else {
    mem.peers.delete(id)
    mem.events.delete(id)
    mem.lastSeen.delete(id)
  }
}

// --- getAllPeers ---
async function getAllPeers(): Promise<PeerInfo[]> {
  if (useKV) {
    const ids = (await kv.smembers(`${P}:peers`)) as string[] | null
    if (!ids || ids.length === 0) return []
    const pipe = kv.pipeline()
    for (const id of ids) pipe.get(pk(id))
    const results = (await pipe.exec()) as (string | null)[]
    const peers: PeerInfo[] = []
    const stale: string[] = []
    for (let i = 0; i < ids.length; i++) {
      if (results[i]) peers.push(JSON.parse(results[i] as string))
      else stale.push(ids[i])
    }
    if (stale.length > 0) await kv.srem(`${P}:peers`, ...stale)
    return peers
  } else {
    return Array.from(mem.peers.values())
  }
}

// --- touchPeer ---
async function touchPeer(id: string) {
  if (useKV) {
    await kv.set(sk(id), Date.now(), { ex: PEER_TTL })
  } else {
    mem.lastSeen.set(id, Date.now())
  }
}

// --- cleanStalePeers ---
let lastCleanTime = 0
async function cleanStalePeers(): Promise<boolean> {
  const now = Date.now()
  if (now - lastCleanTime < 3000) return false
  lastCleanTime = now

  let changed = false
  if (useKV) {
    const ids = (await kv.smembers(`${P}:peers`)) as string[] | null
    if (!ids || ids.length === 0) return false
    for (const id of ids) {
      const seen = await kv.get(sk(id))
      if (!seen) {
        const peer = await getPeer(id)
        if (peer) {
          if (peer.inCallWith) await endCallForPeer(id)
          changed = true
        }
        await deletePeer(id)
      }
    }
  } else {
    for (const [id, ts] of mem.lastSeen) {
      if (now - ts > 15000) {
        const peer = mem.peers.get(id)
        if (peer) {
          if (peer.inCallWith) await endCallForPeer(id)
          mem.peers.delete(id)
          changed = true
        }
        mem.events.delete(id)
        mem.lastSeen.delete(id)
      }
    }
  }
  return changed
}

// --- Ban ---
async function addBan(username: string) {
  if (useKV) await kv.sadd(`${P}:banned`, username.toLowerCase())
  else mem.bannedUsernames.add(username.toLowerCase())
}
async function removeBan(username: string) {
  if (useKV) await kv.srem(`${P}:banned`, username.toLowerCase())
  else mem.bannedUsernames.delete(username.toLowerCase())
}
async function isBanned(username: string): Promise<boolean> {
  if (useKV) return (await kv.sismember(`${P}:banned`, username.toLowerCase())) === 1
  return mem.bannedUsernames.has(username.toLowerCase())
}
async function getAllBanned(): Promise<string[]> {
  if (useKV) return ((await kv.smembers(`${P}:banned`)) as string[] | null) || []
  return Array.from(mem.bannedUsernames)
}

// --- Active Calls ---
async function addActiveCall(call: ActiveCall) {
  if (useKV) {
    const pipe = kv.pipeline()
    pipe.sadd(`${P}:calls`, call.id)
    pipe.set(`${P}:call:${call.id}`, JSON.stringify(call))
    await pipe.exec()
  } else {
    mem.activeCalls.set(call.id, call)
  }
}
async function removeActiveCall(callId: string) {
  if (useKV) {
    const pipe = kv.pipeline()
    pipe.del(`${P}:call:${callId}`)
    pipe.srem(`${P}:calls`, callId)
    await pipe.exec()
  } else {
    mem.activeCalls.delete(callId)
  }
}
async function getAllActiveCalls(): Promise<ActiveCall[]> {
  if (useKV) {
    const ids = ((await kv.smembers(`${P}:calls`)) as string[] | null) || []
    if (ids.length === 0) return []
    const pipe = kv.pipeline()
    for (const id of ids) pipe.get(`${P}:call:${id}`)
    const results = (await pipe.exec()) as (string | null)[]
    const calls: ActiveCall[] = []
    const stale: string[] = []
    for (let i = 0; i < ids.length; i++) {
      if (results[i]) calls.push(JSON.parse(results[i] as string))
      else stale.push(ids[i])
    }
    if (stale.length > 0) await kv.srem(`${P}:calls`, ...stale)
    return calls
  } else {
    return Array.from(mem.activeCalls.values())
  }
}
async function generateCallId(): Promise<string> {
  if (useKV) {
    const c = await kv.incr(`${P}:cc`)
    return `call_${c}_${Date.now()}`
  }
  return `call_${++mem.callCounter}_${Date.now()}`
}

// ============================================================
// BROADCAST HELPERS
// ============================================================

async function broadcastEvent(type: string, data: any, excludeId?: string) {
  const peers = await getAllPeers()
  if (peers.length === 0) return
  if (useKV) {
    const pipe = kv.pipeline()
    const now = Date.now()
    for (const peer of peers) {
      if (peer.id !== excludeId) {
        pipe.rpush(ek(peer.id), JSON.stringify({ type, data, ts: now }))
        pipe.expire(ek(peer.id), EVENT_TTL)
      }
    }
    await pipe.exec()
  } else {
    for (const peer of peers) {
      if (peer.id !== excludeId) await pushEvent(peer.id, type, data)
    }
  }
}

async function broadcastPeerList() {
  const peers = await getAllPeers()
  const list = peers.map((p) => ({
    id: p.id, username: p.username, device: p.device,
    inCall: !!p.inCallWith, connectedAt: p.connectedAt,
  }))
  await broadcastEvent('peer-list', { peers: list })
  await broadcastAdminSnapshot()
}

async function broadcastAdminSnapshot() {
  const peers = await getAllPeers()
  const activeCalls = await getAllActiveCalls()
  const bannedUsernames = await getAllBanned()
  const snapshot = {
    peers: peers.map((p) => ({
      id: p.id, username: p.username, device: p.device,
      isAdmin: p.isAdmin, inCallWith: p.inCallWith,
      callStartedAt: p.callStartedAt, connectedAt: p.connectedAt,
      isBanned: bannedUsernames.includes(p.username.replace(/^ADMIN: /, '').toLowerCase()),
    })),
    activeCalls,
    bannedUsernames,
    bannedCount: bannedUsernames.length,
    totalConnected: peers.length,
  }
  await broadcastEvent('admin-snapshot', snapshot)
}

async function endCallForPeer(peerId: string) {
  const peer = await getPeer(peerId)
  if (!peer || !peer.inCallWith) return
  const otherId = peer.inCallWith
  const other = await getPeer(otherId)
  await pushEvent(peerId, 'call-ended', { fromId: otherId })
  if (other) await pushEvent(otherId, 'call-ended', { fromId: peerId })
  if (peer) { peer.inCallWith = null; peer.callStartedAt = null; await setPeer(peerId, peer) }
  if (other) { other.inCallWith = null; other.callStartedAt = null; await setPeer(otherId, other) }
  const calls = await getAllActiveCalls()
  for (const call of calls) {
    if (
      (call.callerId === peerId && call.calleeId === otherId) ||
      (call.callerId === otherId && call.calleeId === peerId)
    ) { await removeActiveCall(call.id); break }
  }
  await broadcastAdminSnapshot()
}

// ============================================================
// POST: client sends a signaling message
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, type, data } = body
    if (!userId || !type) return NextResponse.json({ error: 'Missing userId or type' }, { status: 400 })

    await touchPeer(userId)
    const stale = await cleanStalePeers()

    switch (type) {
      case 'admin-register': {
        if (data.secret !== ADMIN_SECRET) {
          await pushEvent(userId, 'admin-rejected', { reason: 'Invalid admin secret' })
          break
        }
        await setPeer(userId, {
          id: userId, username: `ADMIN: ${data.username}`, device: 'web',
          isAdmin: true, connectedAt: Date.now(), inCallWith: null, callStartedAt: null,
        })
        await pushEvent(userId, 'admin-registered', { id: userId, username: `ADMIN: ${data.username}` })
        await broadcastPeerList()
        break
      }

      case 'register': {
        const { username } = data
        console.log(`[Sylvid] register: ${username} (${userId.slice(0,8)})`)
        if (await isBanned(username)) {
          await pushEvent(userId, 'banned', { reason: 'You have been banned' })
          break
        }
        await setPeer(userId, {
          id: userId, username, device: data.device || 'web',
          isAdmin: false, connectedAt: Date.now(), inCallWith: null, callStartedAt: null,
        })
        await pushEvent(userId, 'registered', { id: userId, username })
        await broadcastPeerList()
        break
      }

      case 'call-offer': {
        const caller = await getPeer(userId)
        const callee = await getPeer(data.targetId)
        console.log(`[Sylvid] call-offer from ${caller?.username}(${userId.slice(0,8)}) → target ${data.targetId.slice(0,8)}, callee found: ${!!callee}`)
        if (!callee) { console.log(`[Sylvid] callee NOT FOUND for ${data.targetId}`); break }
        await pushEvent(data.targetId, 'incoming-call', {
          fromId: userId, fromName: caller?.username || 'Unknown', offer: data.offer,
        })
        break
      }

      case 'call-answer': {
        const caller = await getPeer(userId)
        const callee = await getPeer(data.targetId)
        if (!callee) break
        const callId = await generateCallId()
        const now = Date.now()
        await addActiveCall({
          id: callId, callerId: data.targetId, callerName: callee?.username || 'Unknown',
          calleeId: userId, calleeName: caller?.username || 'Unknown', startedAt: now,
        })
        if (caller) { caller.inCallWith = data.targetId; caller.callStartedAt = now; await setPeer(userId, caller) }
        if (callee) { callee.inCallWith = userId; callee.callStartedAt = now; await setPeer(data.targetId, callee) }
        await pushEvent(data.targetId, 'call-answered', { fromId: userId, answer: data.answer })
        await broadcastAdminSnapshot()
        break
      }

      case 'ice-candidate': {
        await pushEvent(data.targetId, 'ice-candidate', { fromId: userId, candidate: data.candidate })
        break
      }

      case 'call-rejected': {
        await pushEvent(data.targetId, 'call-rejected', { fromId: userId })
        break
      }

      case 'call-ended': {
        await pushEvent(data.targetId, 'call-ended', { fromId: userId })
        const peer = await getPeer(userId)
        const other = await getPeer(data.targetId)
        if (peer) { peer.inCallWith = null; peer.callStartedAt = null; await setPeer(userId, peer) }
        if (other) { other.inCallWith = null; other.callStartedAt = null; await setPeer(data.targetId, other) }
        const calls = await getAllActiveCalls()
        for (const call of calls) {
          if (
            (call.callerId === userId && call.calleeId === data.targetId) ||
            (call.callerId === data.targetId && call.calleeId === userId)
          ) { await removeActiveCall(call.id); break }
        }
        await broadcastAdminSnapshot()
        break
      }

      case 'admin-force-disconnect': {
        const target = await getPeer(data.targetId)
        if (!target || target.isAdmin) break
        if (target.inCallWith) await endCallForPeer(data.targetId)
        await pushEvent(data.targetId, 'force-disconnected', { reason: 'Disconnected by admin' })
        await deletePeer(data.targetId)
        await broadcastPeerList()
        break
      }

      case 'admin-end-call': {
        await endCallForPeer(data.targetId)
        break
      }

      case 'admin-ban': {
        const target = await getPeer(data.targetId)
        if (!target || target.isAdmin) break
        if (target.inCallWith) await endCallForPeer(data.targetId)
        const cleanName = target.username.replace(/^ADMIN: /, '')
        await addBan(cleanName)
        await pushEvent(data.targetId, 'banned', { reason: 'Banned by admin' })
        await deletePeer(data.targetId)
        await broadcastPeerList()
        break
      }

      case 'admin-unban': {
        await removeBan(data.username)
        await broadcastAdminSnapshot()
        break
      }
    }

    if (stale && type !== 'register' && type !== 'admin-register') {
      await broadcastPeerList()
    }

    return NextResponse.json({ ok: true, backend: useKV ? 'kv' : 'memory' })
  } catch (error: any) {
    console.error('Signal POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ============================================================
// GET: client polls for new events
// ============================================================

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('u')
  const since = parseInt(req.nextUrl.searchParams.get('s') || '0')
  if (!userId) return NextResponse.json({ events: [] })

  try {
    await touchPeer(userId)
    await cleanStalePeers()
    const newEvents = await getEvents(userId, since)
    // Always include the current peer list so the client stays in sync
    // even if peer-list events are missed (serverless, network hiccups)
    const allPeers = await getAllPeers()
    const peerList = allPeers.map((p) => ({
      id: p.id, username: p.username, device: p.device,
      inCall: !!p.inCallWith, connectedAt: p.connectedAt,
    }))
    return NextResponse.json({
      events: newEvents,
      peers: peerList,
      backend: useKV ? 'kv' : 'memory',
    })
  } catch {
    return NextResponse.json({ events: [], peers: [] })
  }
}
