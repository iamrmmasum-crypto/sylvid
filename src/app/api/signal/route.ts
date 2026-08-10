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
// GLOBAL STATE (persists across requests on same instance)
// ============================================================

const globalForStore = globalThis as unknown as {
  peers?: Map<string, PeerInfo>
  events?: Map<string, QueuedEvent[]>
  bannedUsernames?: Set<string>
  activeCalls?: Map<string, ActiveCall>
  callCounter?: number
}

if (!globalForStore.peers) {
  globalForStore.peers = new Map()
  globalForStore.events = new Map()
  globalForStore.bannedUsernames = new Set()
  globalForStore.activeCalls = new Map()
  globalForStore.callCounter = 0
}

const peers = globalForStore.peers
const events = globalForStore.events
const bannedUsernames = globalForStore.bannedUsernames
const activeCalls = globalForStore.activeCalls
const ADMIN_SECRET = 'admin2024'

function pushEvent(userId: string, type: string, data: any) {
  if (!events.has(userId)) events.set(userId, [])
  events.get(userId)!.push({ type, data, ts: Date.now() })
}

function broadcastEvent(type: string, data: any, excludeId?: string) {
  for (const [id] of peers) {
    if (id !== excludeId) pushEvent(id, type, data)
  }
}

function broadcastPeerList() {
  const list = Array.from(peers.values()).map((p) => ({
    id: p.id, username: p.username, device: p.device,
    inCall: !!p.inCallWith, connectedAt: p.connectedAt,
  }))
  broadcastEvent('peer-list', { peers: list })
  broadcastAdminSnapshot()
}

function broadcastAdminSnapshot() {
  const snapshot = {
    peers: Array.from(peers.values()).map((p) => ({
      id: p.id, username: p.username, device: p.device,
      isAdmin: p.isAdmin, inCallWith: p.inCallWith,
      callStartedAt: p.callStartedAt, connectedAt: p.connectedAt,
      isBanned: bannedUsernames.has(p.username.replace(/^ADMIN: /, '')),
    })),
    activeCalls: Array.from(activeCalls.values()),
    bannedUsernames: Array.from(bannedUsernames),
    bannedCount: bannedUsernames.size,
    totalConnected: peers.size,
  }
  broadcastEvent('admin-snapshot', snapshot)
}

function endCallForPeer(peerId: string) {
  const peer = peers.get(peerId)
  if (!peer || !peer.inCallWith) return
  const otherId = peer.inCallWith
  const other = peers.get(otherId)
  pushEvent(peerId, 'call-ended', { fromId: otherId })
  if (other) pushEvent(otherId, 'call-ended', { fromId: peerId })
  if (peer) { peer.inCallWith = null; peer.callStartedAt = null }
  if (other) { other.inCallWith = null; other.callStartedAt = null }
  for (const [cid, call] of activeCalls) {
    if (
      (call.callerId === peerId && call.calleeId === otherId) ||
      (call.callerId === otherId && call.calleeId === peerId)
    ) { activeCalls.delete(cid); break }
  }
  broadcastAdminSnapshot()
}

function generateCallId(): string {
  return `call_${++globalForStore.callCounter!}_${Date.now()}`
}

const lastSeen = new Map<string, number>()

function cleanStale() {
  const now = Date.now()
  for (const [id, ts] of lastSeen) {
    if (now - ts > 15000) {
      const peer = peers.get(id)
      if (peer) {
        if (peer.inCallWith) endCallForPeer(id)
        peers.delete(id)
        events.delete(id)
        lastSeen.delete(id)
      }
    }
  }
}

// ============================================================
// POST: client sends a signaling message
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, type, data } = body
    if (!userId || !type) return NextResponse.json({ error: 'Missing userId or type' }, { status: 400 })

    lastSeen.set(userId, Date.now())
    cleanStale()

    switch (type) {
      case 'admin-register': {
        if (data.secret !== ADMIN_SECRET) {
          pushEvent(userId, 'admin-rejected', { reason: 'Invalid admin secret' })
          break
        }
        peers.set(userId, {
          id: userId, username: `ADMIN: ${data.username}`, device: 'web',
          isAdmin: true, connectedAt: Date.now(), inCallWith: null, callStartedAt: null,
        })
        pushEvent(userId, 'admin-registered', { id: userId, username: `ADMIN: ${data.username}` })
        broadcastPeerList()
        break
      }

      case 'register': {
        const { username } = data
        if (bannedUsernames.has(username.toLowerCase())) {
          pushEvent(userId, 'banned', { reason: 'You have been banned' })
          break
        }
        peers.set(userId, {
          id: userId, username, device: data.device || 'web',
          isAdmin: false, connectedAt: Date.now(), inCallWith: null, callStartedAt: null,
        })
        pushEvent(userId, 'registered', { id: userId, username })
        broadcastPeerList()
        break
      }

      case 'call-offer': {
        const caller = peers.get(userId)
        const callee = peers.get(data.targetId)
        if (!callee) break
        pushEvent(data.targetId, 'incoming-call', {
          fromId: userId, fromName: caller?.username || 'Unknown', offer: data.offer,
        })
        break
      }

      case 'call-answer': {
        const caller = peers.get(userId)
        const callee = peers.get(data.targetId)
        if (!callee) break
        const callId = generateCallId()
        const now = Date.now()
        activeCalls.set(callId, {
          id: callId, callerId: data.targetId, callerName: callee?.username || 'Unknown',
          calleeId: userId, calleeName: caller?.username || 'Unknown', startedAt: now,
        })
        if (caller) { caller.inCallWith = data.targetId; caller.callStartedAt = now }
        if (callee) { callee.inCallWith = userId; callee.callStartedAt = now }
        pushEvent(data.targetId, 'call-answered', { fromId: userId, answer: data.answer })
        broadcastAdminSnapshot()
        break
      }

      case 'ice-candidate': {
        pushEvent(data.targetId, 'ice-candidate', { fromId: userId, candidate: data.candidate })
        break
      }

      case 'call-rejected': {
        pushEvent(data.targetId, 'call-rejected', { fromId: userId })
        break
      }

      case 'call-ended': {
        pushEvent(data.targetId, 'call-ended', { fromId: userId })
        const peer = peers.get(userId)
        const other = peers.get(data.targetId)
        if (peer) { peer.inCallWith = null; peer.callStartedAt = null }
        if (other) { other.inCallWith = null; other.callStartedAt = null }
        for (const [cid, call] of activeCalls) {
          if (
            (call.callerId === userId && call.calleeId === data.targetId) ||
            (call.callerId === data.targetId && call.calleeId === userId)
          ) { activeCalls.delete(cid); break }
        }
        broadcastAdminSnapshot()
        break
      }

      case 'admin-force-disconnect': {
        const target = peers.get(data.targetId)
        if (!target || target.isAdmin) break
        if (target.inCallWith) endCallForPeer(data.targetId)
        pushEvent(data.targetId, 'force-disconnected', { reason: 'Disconnected by admin' })
        peers.delete(data.targetId)
        events.delete(data.targetId)
        lastSeen.delete(data.targetId)
        broadcastPeerList()
        break
      }

      case 'admin-end-call': {
        endCallForPeer(data.targetId)
        break
      }

      case 'admin-ban': {
        const target = peers.get(data.targetId)
        if (!target || target.isAdmin) break
        if (target.inCallWith) endCallForPeer(data.targetId)
        const cleanName = target.username.replace(/^ADMIN: /, '')
        bannedUsernames.add(cleanName.toLowerCase())
        pushEvent(data.targetId, 'banned', { reason: 'Banned by admin' })
        peers.delete(data.targetId)
        events.delete(data.targetId)
        lastSeen.delete(data.targetId)
        broadcastPeerList()
        break
      }

      case 'admin-unban': {
        bannedUsernames.delete(data.username.toLowerCase())
        broadcastAdminSnapshot()
        break
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

// ============================================================
// GET: client polls for new events
// ============================================================

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('u')
  const since = parseInt(req.nextUrl.searchParams.get('s') || '0')

  if (!userId) return NextResponse.json({ events: [] })

  lastSeen.set(userId, Date.now())
  cleanStale()

  const queue = events.get(userId) || []
  const newEvents = queue.filter((e) => e.ts > since)
  events.set(userId, queue.filter((e) => e.ts <= since))

  return NextResponse.json({ events: newEvents })
}