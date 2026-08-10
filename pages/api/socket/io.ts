import type { NextApiRequest, NextApiResponse } from 'next'
import { Server as NetServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'

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

// ============================================================
// IN-MEMORY STATE (persists while function is warm)
// ============================================================

const peers = new Map<string, PeerInfo>()
const bannedUsernames = new Set<string>()
const activeCalls = new Map<string, ActiveCall>()
const ADMIN_SECRET = 'admin2024'
let callCounter = 0

function generateCallId(): string {
  return `call_${++callCounter}_${Date.now()}`
}

function broadcastPeerList(io: SocketIOServer) {
  const list = Array.from(peers.values()).map((p) => ({
    id: p.id,
    username: p.username,
    device: p.device,
    inCall: !!p.inCallWith,
    connectedAt: p.connectedAt,
  }))
  io.emit('peer-list', { peers: list })
  broadcastAdminSnapshot(io)
}

function broadcastAdminSnapshot(io: SocketIOServer) {
  const snapshot = {
    peers: Array.from(peers.values()).map((p) => ({
      id: p.id,
      username: p.username,
      device: p.device,
      isAdmin: p.isAdmin,
      inCallWith: p.inCallWith,
      callStartedAt: p.callStartedAt,
      connectedAt: p.connectedAt,
      isBanned: bannedUsernames.has(p.username.replace(/^ADMIN: /, '')),
    })),
    activeCalls: Array.from(activeCalls.values()),
    bannedUsernames: Array.from(bannedUsernames),
    bannedCount: bannedUsernames.size,
    totalConnected: peers.size,
  }
  io.emit('admin-snapshot', snapshot)
}

function endCallForPeer(io: SocketIOServer, peerId: string) {
  const peer = peers.get(peerId)
  if (!peer || !peer.inCallWith) return
  const otherId = peer.inCallWith
  const other = peers.get(otherId)
  io.to(peerId).emit('call-ended', { fromId: otherId })
  io.to(otherId).emit('call-ended', { fromId: peerId })
  if (peer) { peer.inCallWith = null; peer.callStartedAt = null }
  if (other) { other.inCallWith = null; other.callStartedAt = null }
  for (const [cid, call] of activeCalls) {
    if (
      (call.callerId === peerId && call.calleeId === otherId) ||
      (call.callerId === otherId && call.calleeId === peerId)
    ) {
      activeCalls.delete(cid)
      break
    }
  }
  broadcastAdminSnapshot(io)
}

// ============================================================
// SOCKET HANDLER SETUP (runs once per cold start)
// ============================================================

function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket) => {
    console.log(`Peer connected: ${socket.id}`)

    // Admin registration
    socket.on('admin-register', (data: { secret: string; username: string }) => {
      if (data.secret !== ADMIN_SECRET) {
        socket.emit('admin-rejected', { reason: 'Invalid admin secret' })
        return
      }
      peers.set(socket.id, {
        id: socket.id,
        username: `ADMIN: ${data.username}`,
        device: 'web',
        isAdmin: true,
        connectedAt: Date.now(),
        inCallWith: null,
        callStartedAt: null,
      })
      socket.emit('admin-registered', { id: socket.id, username: `ADMIN: ${data.username}` })
      broadcastPeerList(io)
      console.log(`Admin registered: ${data.username}`)
    })

    // User registration
    socket.on('register', (data: { username: string; device?: string }) => {
      const { username } = data
      if (bannedUsernames.has(username.toLowerCase())) {
        socket.emit('banned', { reason: 'You have been banned from this server' })
        setTimeout(() => socket.disconnect(true), 500)
        return
      }
      const device = data.device || 'web'
      peers.set(socket.id, {
        id: socket.id,
        username,
        device,
        isAdmin: false,
        connectedAt: Date.now(),
        inCallWith: null,
        callStartedAt: null,
      })
      socket.emit('registered', { id: socket.id, username })
      broadcastPeerList(io)
      console.log(`${username} (${device}) registered, online: ${peers.size}`)
    })

    // WebRTC signaling
    socket.on('call-offer', (data: { targetId: string; offer: any }) => {
      const caller = peers.get(socket.id)
      const callee = peers.get(data.targetId)
      if (!callee) return
      console.log(`Call offer: ${caller?.username} -> ${callee.username}`)
      io.to(data.targetId).emit('incoming-call', {
        fromId: socket.id,
        fromName: caller?.username || 'Unknown',
        offer: data.offer,
      })
    })

    socket.on('call-answer', (data: { targetId: string; answer: any }) => {
      const caller = peers.get(socket.id)
      const callee = peers.get(data.targetId)
      if (!callee) return
      const callId = generateCallId()
      const now = Date.now()
      activeCalls.set(callId, {
        id: callId,
        callerId: data.targetId,
        callerName: callee?.username || 'Unknown',
        calleeId: socket.id,
        calleeName: caller?.username || 'Unknown',
        startedAt: now,
      })
      if (caller) { caller.inCallWith = data.targetId; caller.callStartedAt = now }
      if (callee) { callee.inCallWith = socket.id; callee.callStartedAt = now }
      io.to(data.targetId).emit('call-answered', { fromId: socket.id, answer: data.answer })
      broadcastAdminSnapshot(io)
    })

    socket.on('ice-candidate', (data: { targetId: string; candidate: any }) => {
      io.to(data.targetId).emit('ice-candidate', { fromId: socket.id, candidate: data.candidate })
    })

    socket.on('call-rejected', (data: { targetId: string }) => {
      io.to(data.targetId).emit('call-rejected', { fromId: socket.id })
    })

    socket.on('call-ended', (data: { targetId: string }) => {
      io.to(data.targetId).emit('call-ended', { fromId: socket.id })
      const peer = peers.get(socket.id)
      const other = peers.get(data.targetId)
      if (peer) { peer.inCallWith = null; peer.callStartedAt = null }
      if (other) { other.inCallWith = null; other.callStartedAt = null }
      for (const [cid, call] of activeCalls) {
        if (
          (call.callerId === socket.id && call.calleeId === data.targetId) ||
          (call.callerId === data.targetId && call.calleeId === socket.id)
        ) {
          activeCalls.delete(cid)
          break
        }
      }
      broadcastAdminSnapshot(io)
    })

    // ===== ADMIN COMMANDS =====

    socket.on('admin-force-disconnect', (data: { targetId: string }) => {
      const target = peers.get(data.targetId)
      if (!target || target.isAdmin) return
      if (target.inCallWith) endCallForPeer(io, data.targetId)
      io.to(data.targetId).emit('force-disconnected', { reason: 'Disconnected by admin' })
      setTimeout(() => {
        const sock = io.sockets.sockets.get(data.targetId)
        if (sock) sock.disconnect(true)
      }, 500)
      console.log(`Admin force-disconnected: ${target.username}`)
    })

    socket.on('admin-end-call', (data: { targetId: string }) => {
      const target = peers.get(data.targetId)
      if (!target) return
      endCallForPeer(io, data.targetId)
      console.log(`Admin ended call for: ${target.username}`)
    })

    socket.on('admin-ban', (data: { targetId: string }) => {
      const target = peers.get(data.targetId)
      if (!target || target.isAdmin) return
      if (target.inCallWith) endCallForPeer(io, data.targetId)
      const cleanName = target.username.replace(/^ADMIN: /, '')
      bannedUsernames.add(cleanName.toLowerCase())
      io.to(data.targetId).emit('banned', { reason: 'Banned by admin' })
      setTimeout(() => {
        const sock = io.sockets.sockets.get(data.targetId)
        if (sock) sock.disconnect(true)
      }, 500)
      broadcastAdminSnapshot(io)
      console.log(`Admin banned username: ${cleanName}`)
    })

    socket.on('admin-unban', (data: { username: string }) => {
      bannedUsernames.delete(data.username.toLowerCase())
      broadcastAdminSnapshot(io)
      console.log(`Admin unbanned username: ${data.username}`)
    })

    // Disconnect
    socket.on('disconnect', () => {
      const peer = peers.get(socket.id)
      if (peer) {
        if (peer.inCallWith) endCallForPeer(io, socket.id)
        console.log(`${peer.username} disconnected`)
        peers.delete(socket.id)
        broadcastPeerList(io)
      }
    })
  })
}

// ============================================================
// VERCEL SERVERLESS HANDLER
// ============================================================

export const config = {
  api: {
    bodyParser: false,
  },
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...')
    const httpServer: NetServer = res.socket.server as any
    const io = new SocketIOServer(httpServer, {
      path: '/api/socket/io',
      addTrailingSlash: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    res.socket.server.io = io
    setupSocketIO(io)
  }
  res.end()
}