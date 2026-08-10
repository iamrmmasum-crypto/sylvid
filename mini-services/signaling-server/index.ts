import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

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

const peers = new Map<string, PeerInfo>()
const bannedIds = new Set<string>()
const activeCalls = new Map<string, ActiveCall>() // callId -> ActiveCall
const ADMIN_SECRET = 'admin2024'
let callCounter = 0

function generateCallId(): string {
  return `call_${++callCounter}_${Date.now()}`
}

function broadcastPeerList() {
  const list = Array.from(peers.values()).map((p) => ({
    id: p.id,
    username: p.username,
    device: p.device,
    inCall: !!p.inCallWith,
    connectedAt: p.connectedAt,
  }))
  // Non-admins get the normal peer list
  io.emit('peer-list', { peers: list })
  // Admins get the full admin snapshot
  broadcastAdminSnapshot()
}

function broadcastAdminSnapshot() {
  const snapshot = {
    peers: Array.from(peers.values()).map((p) => ({
      id: p.id,
      username: p.username,
      device: p.device,
      isAdmin: p.isAdmin,
      inCallWith: p.inCallWith,
      callStartedAt: p.callStartedAt,
      connectedAt: p.connectedAt,
    })),
    activeCalls: Array.from(activeCalls.values()),
    bannedCount: bannedIds.size,
    totalConnected: peers.size,
  }
  io.emit('admin-snapshot', snapshot)
}

function endCallForPeer(peerId: string) {
  const peer = peers.get(peerId)
  if (!peer || !peer.inCallWith) return
  const otherId = peer.inCallWith
  const other = peers.get(otherId)
  // End call on both sides
  io.to(peerId).emit('call-ended', { fromId: otherId })
  io.to(otherId).emit('call-ended', { fromId: peerId })
  // Clean up
  if (peer) {
    peer.inCallWith = null
    peer.callStartedAt = null
  }
  if (other) {
    other.inCallWith = null
    other.callStartedAt = null
  }
  // Remove from active calls
  for (const [cid, call] of activeCalls) {
    if (
      (call.callerId === peerId && call.calleeId === otherId) ||
      (call.callerId === otherId && call.calleeId === peerId)
    ) {
      activeCalls.delete(cid)
      break
    }
  }
  broadcastAdminSnapshot()
}

io.on('connection', (socket) => {
  // Check ban
  if (bannedIds.has(socket.id)) {
    socket.emit('banned', { reason: 'You have been banned' })
    socket.disconnect(true)
    return
  }

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
    broadcastPeerList()
    console.log(`Admin registered: ${data.username}`)
  })

  socket.on('register', (data: { username: string; device?: string }) => {
    const { username } = data
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
    broadcastPeerList()
    console.log(`${username} (${device}) registered, online: ${peers.size}`)
  })

  // WebRTC signaling
  socket.on('call-offer', (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
    const { targetId, offer } = data
    const caller = peers.get(socket.id)
    const callee = peers.get(targetId)
    if (!callee) return
    console.log(`Call offer: ${caller?.username} -> ${callee.username}`)
    io.to(targetId).emit('incoming-call', {
      fromId: socket.id,
      fromName: caller?.username || 'Unknown',
      offer,
    })
  })

  socket.on('call-answer', (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
    const { targetId, answer } = data
    const caller = peers.get(socket.id)
    const callee = peers.get(targetId)
    if (!callee) return
    console.log(`Call answered: ${callee?.username} -> ${caller?.username}`)
    // Track active call
    const callId = generateCallId()
    const now = Date.now()
    activeCalls.set(callId, {
      id: callId,
      callerId: targetId,
      callerName: callee?.username || 'Unknown',
      calleeId: socket.id,
      calleeName: caller?.username || 'Unknown',
      startedAt: now,
    })
    if (caller) {
      caller.inCallWith = targetId
      caller.callStartedAt = now
    }
    if (callee) {
      callee.inCallWith = socket.id
      callee.callStartedAt = now
    }
    io.to(targetId).emit('call-answered', { fromId: socket.id, answer })
    broadcastAdminSnapshot()
  })

  socket.on('ice-candidate', (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
    const { targetId, candidate } = data
    io.to(targetId).emit('ice-candidate', { fromId: socket.id, candidate })
  })

  socket.on('call-rejected', (data: { targetId: string }) => {
    const { targetId } = data
    io.to(targetId).emit('call-rejected', { fromId: socket.id })
  })

  socket.on('call-ended', (data: { targetId: string }) => {
    const { targetId } = data
    io.to(targetId).emit('call-ended', { fromId: socket.id })
    // Clean call state
    const peer = peers.get(socket.id)
    const other = peers.get(targetId)
    if (peer) {
      peer.inCallWith = null
      peer.callStartedAt = null
    }
    if (other) {
      other.inCallWith = null
      other.callStartedAt = null
    }
    for (const [cid, call] of activeCalls) {
      if (
        (call.callerId === socket.id && call.calleeId === targetId) ||
        (call.callerId === targetId && call.calleeId === socket.id)
      ) {
        activeCalls.delete(cid)
        break
      }
    }
    broadcastAdminSnapshot()
  })

  // ===== ADMIN COMMANDS =====

  socket.on('admin-force-disconnect', (data: { targetId: string }) => {
    const target = peers.get(data.targetId)
    if (!target || target.isAdmin) return
    // End any active call first
    if (target.inCallWith) endCallForPeer(data.targetId)
    // Disconnect
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
    endCallForPeer(data.targetId)
    console.log(`Admin ended call for: ${target.username}`)
  })

  socket.on('admin-ban', (data: { targetId: string }) => {
    const target = peers.get(data.targetId)
    if (!target || target.isAdmin) return
    if (target.inCallWith) endCallForPeer(data.targetId)
    bannedIds.add(data.targetId)
    io.to(data.targetId).emit('banned', { reason: 'Banned by admin' })
    setTimeout(() => {
      const sock = io.sockets.sockets.get(data.targetId)
      if (sock) sock.disconnect(true)
    }, 500)
    broadcastAdminSnapshot()
    console.log(`Admin banned: ${target.username} (${data.targetId})`)
  })

  socket.on('admin-unban', (data: { targetId: string }) => {
    bannedIds.delete(data.targetId)
    broadcastAdminSnapshot()
    console.log(`Admin unbanned: ${data.targetId}`)
  })

  socket.on('disconnect', () => {
    const peer = peers.get(socket.id)
    if (peer) {
      // Clean up any active calls
      if (peer.inCallWith) endCallForPeer(socket.id)
      console.log(`${peer.username} disconnected`)
      peers.delete(socket.id)
      broadcastPeerList()
    }
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
