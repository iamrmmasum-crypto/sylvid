import { kv } from '@vercel/kv'
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
// CONSTANTS
// ============================================================

const ADMIN_SECRET = 'admin2024'
const PEER_TTL = 30       // seconds — peer considered stale if no heartbeat
const EVENT_TTL = 300      // 5 min — events auto-expire
const P = 'sylvid'         // Redis key prefix

// ============================================================
// KEY HELPERS
// ============================================================

const pk = (id: string) => `${P}:peer:${id}`
const ek = (id: string) => `${P}:events:${id}`
const sk = (id: string) => `${P}:seen:${id}`

// ============================================================
// REDIS HELPERS
// ============================================================

async function pushEvent(userId: string, type: string, data: any) {
  const ev: QueuedEvent = { type, data, ts: Date.now() }
  const pipe = kv.pipeline()
  pipe.rpush(ek(userId), JSON.stringify(ev))
  pipe.expire(ek(userId), EVENT_TTL)
  await pipe.exec()
}

async function getEvents(userId: string, since: number): Promise<QueuedEvent[]> {
  const raw = (await kv.lrange(ek(userId), 0, -1)) as string[] | null
  if (!raw || raw.length === 0) return []
  const all: QueuedEvent[] = raw.map((s) => JSON.parse(s))
  // Client deduplicates by timestamp, so just return filtered results
  return all.filter((e) => e.ts > since)
}

async function setPeer(id: string, peer: PeerInfo) {
  const pipe = kv.pipeline()
  pipe.set(pk(id), JSON.stringify(peer))
  pipe.sadd(`${P}:peers`, id)
  pipe.set(sk(id), Date.now(), { ex: PEER_TTL })
  await pipe.exec()
}

async function getPeer(id: string): Promise<PeerInfo | null> {
  const raw = await kv.get(pk(id))
  return raw ? (JSON.parse(raw as string) as PeerInfo) : null
}

async function deletePeer(id: string) {
  const pipe = kv.pipeline()
  pipe.del(pk(id), ek(id), sk(id))
  pipe.srem(`${P}:peers`, id)
  await pipe.exec()
}

async function getAllPeers(): Promise<PeerInfo[]> {
  const ids = (await kv.smembers(`${P}:peers`)) as string[] | null
  if (!ids || ids.length === 0) return []

  // Pipeline fetch all peer data in one round-trip
  const pipe = kv.pipeline()
  for (const id of ids) pipe.get(pk(id))
  const results = (await pipe.exec()) as (string | null)[]

  const peers: PeerInfo[] = []
  const stale: string[] = []
  for (let i = 0; i < ids.length; i++) {
    if (results[i]) {
      peers.push(JSON.parse(results[i] as string))
    } else {
      stale.push(ids[i])
    }
  }
  // Clean orphaned index entries
  if (stale.length > 0) await kv.srem(`${P}:peers`, ...stale)
  return peers
}

async function touchPeer(id: string) {
  await kv.set(sk(id), Date.now(), { ex: PEER_TTL })
}

async function cleanStalePeers(): Promise<boolean> {
  const ids = (await kv.smembers(`${P}:peers`)) as string[] | null
  if (!ids || ids.length === 0) return false

  let changed = false
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
  return changed
}

// --- Banned users ---

async function addBan(username: string) {
  await kv.sadd(`${P}:banned`, username.toLowerCase())
}
async function removeBan(username: string) {
  await kv.srem(`${P}:banned`, username.toLowerCase())
}
async function isBanned(username: string): Promise<boolean> {
  return (await kv.sismember(`${P}:banned`, username.toLowerCase())) === 1
}
async function getAllBanned(): Promise<string[]> {
  return ((await kv.smembers(`${P}:banned`)) as string[] | null) || []
}

// --- Active calls ---

async function addActiveCall(call: ActiveCall) {
  const pipe = kv.pipeline()
  pipe.sadd(`${P}:calls`, call.id)
  pipe.set(`${P}:call:${call.id}`, JSON.stringify(call))
  await pipe.exec()
}
async function removeActiveCall(callId: string) {
  const pipe = kv.pipeline()
  pipe.del(`${P}:call:${callId}`)
  pipe.srem(`${P}:calls`, callId)
  await pipe.exec()
}
async function getAllActiveCalls(): Promise<ActiveCall[]> {
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
}
async function generateCallId(): Promise<string> {
  const c = await kv.incr(`${P}:cc`)
  return `call_${c}_${Date.now()}`
}

// ============================================================
// BROADCAST HELPERS
// ============================================================

async function broadcastEvent(type: string, data: any, excludeId?: string) {
  const peers = await getAllPeers()
  if (peers.length === 0) return
  const pipe = kv.pipeline()
  const now = Date.now()
  for (const peer of peers) {
    if (peer.id !== excludeId) {
      pipe.rpush(ek(peer.id), JSON.stringify({ type, data, ts: now }))
      pipe.expire(ek(peer.id), EVENT_TTL)
    }
  }
  await pipe.exec()
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

  if (peer) { peer.inCallWith = null; peer.callStartedAt = null; await kv.set(pk(peerId), JSON.stringify(peer)) }
  if (other) { other.inCallWith = null; other.callStartedAt = null; await kv.set(pk(otherId), JSON.stringify(other)) }

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
// KV HEALTH CHECK
// ============================================================

const kvReady = !!process.env.KV_REST_API_URL || !!process.env.KV_URL || !!process.env.KVC_REST_API_URL

function kvError() {
  return NextResponse.json({
    error: 'Vercel KV not linked. Go to: Vercel Dashboard → Storage → Create KV Store → Link to project → Redeploy.',
    setup: true,
  }, { status: 503 })
}

// ============================================================
// POST: client sends a signaling message
// ============================================================

export async function POST(req: NextRequest) {
  if (!kvReady) return kvError()

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
        if (!callee) break
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
        if (caller) { caller.inCallWith = data.targetId; caller.callStartedAt = now; await kv.set(pk(userId), JSON.stringify(caller)) }
        if (callee) { callee.inCallWith = userId; callee.callStartedAt = now; await kv.set(pk(data.targetId), JSON.stringify(callee)) }
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
        if (peer) { peer.inCallWith = null; peer.callStartedAt = null; await kv.set(pk(userId), JSON.stringify(peer)) }
        if (other) { other.inCallWith = null; other.callStartedAt = null; await kv.set(pk(data.targetId), JSON.stringify(other)) }
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

    // If stale peers were cleaned, rebroadcast
    if (stale && type !== 'register' && type !== 'admin-register') {
      await broadcastPeerList()
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Signal POST error:', error)
    const msg = error?.message || ''
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOENT') || msg.includes('fetch failed')) {
      return NextResponse.json({
        error: 'Cannot connect to Vercel KV. Make sure KV store is linked and redeployed.',
        setup: true,
      }, { status: 503 })
    }
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

  if (!kvReady) {
    return NextResponse.json({ events: [], kvError: true, msg: 'Vercel KV not linked' })
  }

  try {
    await touchPeer(userId)
    await cleanStalePeers()
    const newEvents = await getEvents(userId, since)
    return NextResponse.json({ events: newEvents })
  } catch (error: any) {
    console.error('Signal GET error:', error)
    return NextResponse.json({ events: [] })
  }
}
