import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface PeerInfo {
  id: string
  username: string
}

const peers = new Map<string, PeerInfo>()

io.on('connection', (socket) => {
  console.log(`Peer connected: ${socket.id}`)

  socket.on('register', (data: { username: string }) => {
    const { username } = data
    peers.set(socket.id, { id: socket.id, username })

    // Send back the peer's own ID
    socket.emit('registered', { id: socket.id, username })

    // Broadcast updated peer list to everyone
    broadcastPeerList()
    console.log(`${username} registered, online peers: ${peers.size}`)
  })

  // WebRTC signaling: relay offers, answers, and ICE candidates
  socket.on('call-offer', (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
    const { targetId, offer } = data
    console.log(`Call offer from ${socket.id} to ${targetId}`)
    io.to(targetId).emit('incoming-call', {
      fromId: socket.id,
      fromName: peers.get(socket.id)?.username || 'Unknown',
      offer
    })
  })

  socket.on('call-answer', (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
    const { targetId, answer } = data
    console.log(`Call answer from ${socket.id} to ${targetId}`)
    io.to(targetId).emit('call-answered', {
      fromId: socket.id,
      answer
    })
  })

  socket.on('ice-candidate', (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
    const { targetId, candidate } = data
    io.to(targetId).emit('ice-candidate', {
      fromId: socket.id,
      candidate
    })
  })

  socket.on('call-rejected', (data: { targetId: string }) => {
    const { targetId } = data
    io.to(targetId).emit('call-rejected', { fromId: socket.id })
  })

  socket.on('call-ended', (data: { targetId: string }) => {
    const { targetId } = data
    io.to(targetId).emit('call-ended', { fromId: socket.id })
  })

  socket.on('disconnect', () => {
    const peer = peers.get(socket.id)
    if (peer) {
      console.log(`${peer.username} disconnected`)
      peers.delete(socket.id)
      broadcastPeerList()
    }
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

function broadcastPeerList() {
  const list = Array.from(peers.values())
  io.emit('peer-list', { peers: list })
}

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
