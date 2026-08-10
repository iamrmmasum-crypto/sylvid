'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { createSignalSocket, type SignalSocket } from '@/hooks/useSignaling'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PhoneIncoming,
  Users,
  Monitor,
  Smartphone,
  Copy,
  Check,
  Shield,
  LogOut,
  Ban,
  PhoneCall,
  Clock,
  AlertTriangle,
  Wifi,
  WifiOff,
  Trash2,
  UserX,
  RefreshCw,
} from 'lucide-react'

// ============================================================
// TYPES
// ============================================================

interface Peer {
  id: string
  username: string
  device?: string
  inCall?: boolean
  connectedAt?: number
  inCallWith?: string | null
  callStartedAt?: number | null
  isAdmin?: boolean
}

interface ActiveCall {
  id: string
  callerId: string
  callerName: string
  calleeId: string
  calleeName: string
  startedAt: number
}

interface AdminSnapshot {
  peers: (Peer & { isBanned?: boolean })[]
  activeCalls: ActiveCall[]
  bannedUsernames: string[]
  bannedCount: number
  totalConnected: number
}

// ============================================================
// VIDEO PLAYER COMPONENT
// ============================================================

function VideoPlayer({
  stream,
  muted = false,
  label,
  mirrored = false,
  className = '',
  isProtected = false,
}: {
  stream: MediaStream | null
  muted?: boolean
  label: string
  mirrored?: boolean
  className?: string
  isProtected?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [stream])

  return (
    <div
      className={`relative rounded-2xl overflow-hidden bg-neutral-900 ${isProtected ? 'select-none pointer-events-none' : ''} ${className}`}
      onContextMenu={(e) => isProtected && e.preventDefault()}
    >
      {isProtected && <div className="absolute inset-0 z-10" aria-hidden="true" />}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload nofullscreen noremoteplayback"
        className={`w-full h-full object-cover ${mirrored ? 'scale-x-[-1]' : ''}`}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center text-neutral-500">
          <Video className="w-16 h-16 opacity-30" />
        </div>
      )}
      <div className="absolute bottom-3 left-3">
        <Badge variant="secondary" className="bg-black/60 text-white border-0 backdrop-blur-sm text-sm">
          {label}
        </Badge>
      </div>
    </div>
  )
}

// ============================================================
// WEBRTC HOOK (for admin making test calls)
// ============================================================

function useWebRTC() {
  const socketRef = useRef<SignalSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const remotePeerIdRef = useRef<string | null>(null)

  const [peers, setPeers] = useState<Peer[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [myUsername, setMyUsername] = useState('')
  const [isRegistered, setIsRegistered] = useState(false)
  const [incomingCall, setIncomingCall] = useState<{ fromId: string; fromName: string; offer: RTCSessionDescriptionInit } | null>(null)
  const [isInCall, setIsInCall] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [callStatus, setCallStatus] = useState<'idle' | 'ringing' | 'connecting' | 'connected' | 'ended'>('idle')

  const myIdRef = useRef<string | null>(null)

  const cleanupCall = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null }
    remoteStreamRef.current = null
    remotePeerIdRef.current = null
    setRemoteStream(null); setLocalStream(null); setIsInCall(false)
    setIsMuted(false); setIsCameraOff(false); setIncomingCall(null)
  }, [])

  useEffect(() => {
    const socket = createSignalSocket()
    socketRef.current = socket

    socket.on('registered', (data: { id: string; username: string }) => {
      myIdRef.current = data.id
      setMyId(data.id); setMyUsername(data.username); setIsRegistered(true)
    })

    socket.on('peer-list', (data: { peers: Peer[] }) => {
      setPeers(data.peers.filter((p) => p.id !== myIdRef.current && !p.isAdmin))
    })

    socket.on('incoming-call', (data) => {
      setIncomingCall(data); setCallStatus('ringing')
    })

    socket.on('call-answered', async (data) => {
 const pc = pcRef.current
      if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(data.answer)); setCallStatus('connecting') }
    })

    socket.on('ice-candidate', async (data) => {
      const pc = pcRef.current
      if (pc && data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)) } catch (e) { /* ignore */ }
      }
    })

    socket.on('call-rejected', () => { cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000) })
    socket.on('call-ended', () => { cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000) })
    socket.on('force-disconnected', () => { cleanupCall(); setCallStatus('ended'); setIsRegistered(false) })

    return () => { socket.disconnect() }
  }, [])

  const getLocalStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: true })
    localStreamRef.current = stream; setLocalStream(stream); return stream
  }, [])

  const createPeerConnection = useCallback((stream: MediaStream, remotePeerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
    })
    pcRef.current = pc; remotePeerIdRef.current = remotePeerId
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    const remoteMediaStream = new MediaStream()
    remoteStreamRef.current = remoteMediaStream
    pc.ontrack = (e) => { e.streams[0].getTracks().forEach((t) => remoteMediaStream.addTrack(t)); setRemoteStream(new MediaStream(remoteMediaStream.getTracks())) }
    pc.onicecandidate = (e) => { if (e.candidate && socketRef.current) socketRef.current.emit('ice-candidate', { targetId: remotePeerId, candidate: e.candidate.toJSON() }) }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { setCallStatus('connected'); setIsInCall(true) }
      else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) { cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000) }
    }
    return pc
  }, [cleanupCall, getLocalStream])

  const register = useCallback((username: string) => { socketRef.current?.emit('register', { username, device: 'web-admin' }) }, [])

  const callPeer = useCallback(async (targetId: string) => {
    const stream = await getLocalStream()
    createPeerConnection(stream, targetId)
    const pc = pcRef.current; if (!pc) return
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
    socketRef.current?.emit('call-offer', { targetId, offer: offer.toJSON() }); setCallStatus('connecting')
  }, [getLocalStream, createPeerConnection])

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return
    const stream = await getLocalStream()
    createPeerConnection(stream, incomingCall.fromId)
    const pc = pcRef.current; if (!pc) return
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer))
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer)
    socketRef.current?.emit('call-answer', { targetId: incomingCall.fromId, answer: answer.toJSON() })
    setIncomingCall(null); setCallStatus('connecting')
  }, [incomingCall, getLocalStream, createPeerConnection])

  const rejectCall = useCallback(() => {
    if (incomingCall && socketRef.current) socketRef.current.emit('call-rejected', { targetId: incomingCall.fromId })
    setIncomingCall(null); setCallStatus('idle')
  }, [incomingCall])

  const endCall = useCallback(() => {
    if (socketRef.current && remotePeerIdRef.current) socketRef.current.emit('call-ended', { targetId: remotePeerIdRef.current })
    cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000)
  }, [cleanupCall])

  const toggleMute = useCallback(() => { localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled }); setIsMuted((p) => !p) }, [])
  const toggleCamera = useCallback(() => { localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled }); setIsCameraOff((p) => !p) }, [])

  return { peers, myId, myUsername, isRegistered, register, callPeer, incomingCall, acceptCall, rejectCall, isInCall, remoteStream, localStream, endCall, isMuted, isCameraOff, toggleMute, toggleCamera, callStatus, socketRef }
}

// ============================================================
// ADMIN DASHBOARD
// ============================================================

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null)
  const [connecting, setConnecting] = useState(true)
  const [now, setNow] = useState(Date.now())
  const socketRef = useRef<SignalSocket | null>(null)

  // Live ticker — updates every second for call duration timers
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const socket = createSignalSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      setConnecting(false)
      socket.emit('admin-register', { secret: 'admin2024', username: 'Admin' })
    })

    socket.on('admin-registered', () => {
      console.log('Admin registered')
    })

    socket.on('admin-snapshot', (data: AdminSnapshot) => {
      setSnapshot(data)
    })

    socket.on('admin-rejected', (data) => {
      console.error('Admin rejected:', data.reason)
      setConnecting(false)
    })

    socket.on('disconnect', () => { setConnecting(true) })

    return () => { socket.disconnect() }
  }, [])

  const forceDisconnect = (targetId: string) => {
    socketRef.current?.emit('admin-force-disconnect', { targetId })
  }

  const endCall = (targetId: string) => {
    socketRef.current?.emit('admin-end-call', { targetId })
  }

  const banUser = (targetId: string) => {
    socketRef.current?.emit('admin-ban', { targetId })
  }

  const unbanUser = (username: string) => {
    socketRef.current?.emit('admin-unban', { username })
  }

  const formatUptime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  const activeCallDuration = (startedAt: number) => {
    const diff = now - startedAt
    const m = Math.floor(diff / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const activeCallers = new Set(snapshot?.activeCalls.flatMap((c) => [c.callerId, c.calleeId]) ?? [])
  const regularPeers = snapshot?.peers.filter((p) => !p.isAdmin) ?? []

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Admin Dashboard</h1>
              <p className="text-xs text-neutral-500">Sylvid control center</p>
            </div>
          </div>
          <Button variant="ghost" onClick={onLogout} className="text-neutral-400 hover:text-red-400 gap-2">
            <LogOut className="w-4 h-4" />
            <span className="text-sm">Logout</span>
          </Button>
        </header>

        {connecting && !snapshot && (
          <Card className="bg-neutral-900/60 border-neutral-800">
            <CardContent className="p-12 text-center">
              <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-neutral-400">Connecting to server...</p>
            </CardContent>
          </Card>
        )}

        {snapshot && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<Users className="w-4 h-4" />} label="Online Users" value={snapshot.totalConnected} color="emerald" />
              <StatCard icon={<PhoneCall className="w-4 h-4" />} label="Active Calls" value={snapshot.activeCalls.length} color="blue" />
              <StatCard icon={<Smartphone className="w-4 h-4" />} label="Android" value={regularPeers.filter((p) => p.device?.includes('android')).length} color="violet" />
              <StatCard icon={<Ban className="w-4 h-4" />} label="Banned" value={snapshot.bannedCount} color="red" />
            </div>

            {/* Active Calls */}
            {snapshot.activeCalls.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-neutral-400 mb-3 flex items-center gap-2">
                  <PhoneCall className="w-4 h-4" />
                  Active Calls ({snapshot.activeCalls.length})
                </h2>
                <div className="grid gap-3">
                  {snapshot.activeCalls.map((call) => (
                    <Card key={call.id} className="bg-neutral-900/60 border-emerald-500/20">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center gap-1">
                              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold">
                                {call.callerName.charAt(0).toUpperCase()}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-white text-sm font-medium">{call.callerName}</span>
                              <div className="w-6 h-px bg-emerald-500" />
                              <span className="text-white text-sm font-medium">{call.calleeName}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono">
                              <Clock className="w-3 h-3" />
                              {activeCallDuration(call.startedAt)}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => endCall(call.callerId)}
                              className="h-8 px-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs"
                            >
                              <PhoneOff className="w-3.5 h-3.5 mr-1" />
                              End Call
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Users list */}
            <div>
              <h2 className="text-sm font-medium text-neutral-400 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4" />
                All Users ({regularPeers.length})
              </h2>
              {regularPeers.length === 0 ? (
                <Card className="bg-neutral-900/40 border-neutral-800/50">
                  <CardContent className="p-8 text-center">
                    <p className="text-neutral-500 text-sm">No users connected</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-2">
                  {regularPeers.map((peer) => (
                    <Card key={peer.id} className={`bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 transition-colors ${activeCallers.has(peer.id) ? 'border-emerald-500/30' : ''}`}>
                      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${activeCallers.has(peer.id) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-violet-500/20 text-violet-400'}`}>
                            {peer.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-white text-sm font-medium truncate">{peer.username}</p>
                              {activeCallers.has(peer.id) && (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-[10px] px-1.5 py-0">IN CALL</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {peer.device?.includes('android') ? (
                                <Smartphone className="w-3 h-3 text-neutral-500" />
                              ) : (
                                <Monitor className="w-3 h-3 text-neutral-500" />
                              )}
                              <span className="text-neutral-500 text-[11px] font-mono truncate">{peer.id.slice(0, 16)}...</span>
                              <span className="text-neutral-600 text-[11px]">{formatUptime(Date.now() - (peer.connectedAt || Date.now()))}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {activeCallers.has(peer.id) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => endCall(peer.id)}
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              title="End call"
                            >
                              <PhoneOff className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => forceDisconnect(peer.id)}
                            className="h-8 w-8 p-0 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
                            title="Force disconnect"
                          >
                            <WifiOff className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => banUser(peer.id)}
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            title="Ban user"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Banned Users Panel */}
            {snapshot.bannedUsernames && snapshot.bannedUsernames.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-neutral-400 mb-3 flex items-center gap-2">
                  <UserX className="w-4 h-4" />
                  Banned Users ({snapshot.bannedUsernames.length})
                </h2>
                <div className="grid gap-2">
                  {snapshot.bannedUsernames.map((name) => (
                    <Card key={name} className="bg-red-500/5 border-red-500/20">
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                            <Ban className="w-4 h-4 text-red-400" />
                          </div>
                          <div>
                            <p className="text-white text-sm font-medium">{name}</p>
                            <p className="text-neutral-500 text-[11px]">Cannot reconnect</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => unbanUser(name)}
                          className="h-8 px-3 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-xs gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Unban
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-center pb-4">
              <div className="flex items-center gap-2 text-neutral-600 text-xs">
                <Shield className="w-3.5 h-3.5" />
                <span>Admin access. Server port 3003</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
  }
  return (
    <Card className={`${colors[color] || colors.emerald} border`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1 opacity-70">{icon}</div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs opacity-60 mt-0.5">{label}</p>
      </CardContent>
    </Card>
  )
}

// ============================================================
// MAIN PAGE — LOGIN -> ADMIN DASHBOARD / VIDEO CALL
// ============================================================

type AppMode = 'login' | 'admin' | 'call'

const AUTH_KEY = 'sylvid_auth'

export default function VideoCallPage() {
  const [mode, setMode] = useState<AppMode>('login')
  const [usernameInput, setUsernameInput] = useState('')
  const [passInput, setPassInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [copied, setCopied] = useState(false)
  const [loginScreenDone, setLoginScreenDone] = useState(false)

  const webrtc = useWebRTC()

  // Restore login from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(AUTH_KEY)
      if (saved) {
        const { mode: savedMode, username } = JSON.parse(saved)
        if (savedMode === 'admin') {
          setMode('admin')
        } else if (savedMode === 'call' && username) {
          setUsernameInput(username)
          setMode('call')
          // Delay register slightly to ensure socket is ready
          setTimeout(() => webrtc.register(username), 150)
        }
      }
    } catch { /* ignore */ }
  }, [])

  const saveAuth = (m: AppMode, username?: string) => {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: m, username: username || '' }))
    } catch { /* ignore */ }
  }

  const clearAuth = () => {
    try { localStorage.removeItem(AUTH_KEY) } catch { /* ignore */ }
  }

  const handleAdminLogin = () => {
    if (passInput === 'admin2024') {
      setMode('admin')
      setLoginError('')
      saveAuth('admin')
    } else {
      setLoginError('Wrong password')
    }
  }

  const handleUserRegister = () => {
    const name = usernameInput.trim()
    if (name) {
      setMode('call')
      saveAuth('call', name)
      webrtc.register(name)
    }
  }

  const handleLogout = () => {
    clearAuth()
    webrtc.socketRef.current?.disconnect()
    setMode('login')
    setUsernameInput('')
    setPassInput('')
  }

  // ===== LOGIN SCREEN =====
  if (mode === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-4">
        <Card className="w-full max-w-md bg-neutral-900/80 border-neutral-800 backdrop-blur-xl">
          <CardContent className="p-8 space-y-6">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <Video className="w-8 h-8 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Sylvid</h1>
              <p className="text-neutral-400 text-sm text-center">Military-grade encrypted video calls</p>
            </div>

            {/* Admin login */}
            <div className="space-y-3">
              <Input
                placeholder="Admin password"
                type="password"
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                className="bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500 h-12 rounded-xl"
              />
              <Button
                onClick={handleAdminLogin}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium gap-2"
              >
                <Shield className="w-4 h-4" />
                Admin Dashboard
              </Button>
              {loginError && (
                <p className="text-red-400 text-xs text-center flex items-center justify-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {loginError}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-neutral-800" />
              <span className="text-neutral-500 text-xs">OR</span>
              <div className="flex-1 h-px bg-neutral-800" />
            </div>

            {/* User login */}
            <div className="space-y-3">
              <Input
                placeholder="Your name"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUserRegister()}
                className="bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500 h-12 rounded-xl"
                maxLength={20}
              />
              <Button
                onClick={handleUserRegister}
                disabled={!usernameInput.trim()}
                variant="outline"
                className="w-full h-12 border-neutral-700 text-white rounded-xl font-medium hover:bg-neutral-800"
              >
                <Video className="w-4 h-4 mr-2" />
                Join as User
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ===== ADMIN DASHBOARD =====
  // ===== CALL MODE (user) =====
  const { peers, myId, myUsername, isRegistered, callPeer, incomingCall, acceptCall, rejectCall, isInCall, remoteStream, localStream, endCall, isMuted, isCameraOff, toggleMute, toggleCamera, callStatus } = webrtc
  const isMobile = /Android|iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
  const inCall = isInCall || callStatus === 'connecting' || callStatus === 'connected'

  if (mode === 'admin') {
    return <AdminDashboard onLogout={handleLogout} />
  }

  const handleCopyId = () => {
    if (myId) { navigator.clipboard.writeText(myId); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  if (!isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
        <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Active call
  if (inCall) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col">
        <div className="flex-1 relative">
          <div className="absolute inset-0">
            <VideoPlayer stream={remoteStream} label={callStatus === 'connecting' ? 'Connecting...' : 'Remote'} className="w-full h-full" isProtected />
          </div>
          <div className="absolute top-4 right-4 w-32 h-44 sm:w-40 sm:h-56 md:w-48 md:h-64 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 z-10">
            <VideoPlayer stream={localStream} muted label="You" mirrored className="w-full h-full" isProtected />
          </div>
          {callStatus === 'connecting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-white font-medium">Connecting...</p>
              </div>
            </div>
          )}
        </div>
        <div className="bg-black/80 backdrop-blur-xl px-6 py-5 flex items-center justify-center gap-4">
          <Button onClick={toggleMute} variant="ghost" size="icon" className={`w-14 h-14 rounded-full ${isMuted ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </Button>
          <Button onClick={toggleCamera} variant="ghost" size="icon" className={`w-14 h-14 rounded-full ${isCameraOff ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
            {isCameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
          </Button>
          <Button onClick={endCall} variant="ghost" size="icon" className="w-16 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white">
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </div>
    )
  }

  // Lobby
  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Video className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Sylvid</h1>
              <p className="text-xs text-neutral-500">P2P encrypted calls</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse" />
              Online
            </Badge>
            <Button variant="ghost" onClick={handleLogout} className="text-neutral-400 hover:text-red-400 gap-1.5" size="sm">
              <LogOut className="w-4 h-4" />
              <span className="text-xs hidden sm:inline">Logout</span>
            </Button>
          </div>
        </header>

        <Card className="bg-neutral-900/60 border-neutral-800 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-white font-bold text-lg">
                  {myUsername.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-medium">{myUsername}</p>
                  <p className="text-neutral-500 text-xs font-mono">ID: {myId?.slice(0, 8)}...</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCopyId} className="text-neutral-400 hover:text-white">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-neutral-500" />
            <h2 className="text-sm font-medium text-neutral-400">Online ({peers.length})</h2>
          </div>
          {peers.length === 0 ? (
            <Card className="bg-neutral-900/40 border-neutral-800/50">
              <CardContent className="p-8 text-center">
                <Monitor className="w-10 h-10 text-neutral-700 mx-auto mb-2" />
                <p className="text-neutral-500 text-sm">No other users online</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {peers.map((peer) => (
                <Card key={peer.id} className="bg-neutral-900/60 border-neutral-800 backdrop-blur-sm hover:border-neutral-700 transition-colors">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white font-bold text-sm">
                        {peer.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{peer.username}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {peer.device?.includes('android') ? <Smartphone className="w-3 h-3 text-neutral-500" /> : <Monitor className="w-3 h-3 text-neutral-500" />}
                          <p className="text-neutral-500 text-xs font-mono">{peer.id.slice(0, 12)}...</p>
                        </div>
                      </div>
                    </div>
                    <Button onClick={() => callPeer(peer.id)} className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl h-10 px-4">
                      <Phone className="w-4 h-4 mr-2" />
                      Call
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-center pt-2 pb-4">
          <div className="flex items-center gap-2 text-neutral-600 text-xs">
            {isMobile ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            <span>{isMobile ? 'Mobile — install as app for full screen' : 'Desktop mode'}</span>
          </div>
        </div>
      </div>

      <Dialog open={!!incomingCall}>
        <DialogContent className="bg-neutral-900 border-neutral-800 text-white sm:max-w-md">
          <DialogHeader className="text-center items-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">
              {incomingCall?.fromName?.charAt(0).toUpperCase()}
            </div>
            <DialogTitle className="text-xl">{incomingCall?.fromName}</DialogTitle>
            <DialogDescription className="text-neutral-400">Incoming video call</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-4 pt-4">
            <Button onClick={rejectCall} variant="ghost" size="lg" className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white">
              <PhoneOff className="w-6 h-6" />
            </Button>
            <Button onClick={acceptCall} variant="ghost" size="lg" className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white">
              <PhoneIncoming className="w-6 h-6" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {callStatus === 'ended' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="bg-neutral-900 border-neutral-800 p-8 text-center">
            <PhoneOff className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <p className="text-white font-medium">Call ended</p>
          </Card>
        </div>
      )}
    </div>
  )
}
