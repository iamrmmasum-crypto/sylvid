'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
  Camera,
  XCircle,
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

interface CameraErrorInfo {
  title: string
  message: string
  steps: string[]
 isDeviceInUse: boolean
  isPermissionDenied: boolean
  isNotFound: boolean
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

const METERED_API_KEY = '' // unused — proxy at /api/turn handles auth
const TURN_PROXY_URL = '/api/turn'

function useWebRTC() {
  const socketRef = useRef<SignalSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const remotePeerIdRef = useRef<string | null>(null)
  const remotePeerNameRef = useRef<string | null>(null)
  const turnServersRef = useRef<RTCIceServer[]>([])

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
  const [callError, setCallError] = useState('')
  const [cameraError, setCameraError] = useState<CameraErrorInfo | null>(null)
  const [ringTarget, setRingTarget] = useState<{ id: string; name: string } | null>(null)
  const [backend, setBackend] = useState('unknown')
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const calleeRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disconnectGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bufferedIceCandidates = useRef<RTCIceCandidateInit[]>([])
  const iceRestartAttemptedRef = useRef(false)

  const myIdRef = useRef<string | null>(null)

  const clearRingTimer = useCallback(() => {
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null }
  }, [])

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) { clearTimeout(connectTimerRef.current); connectTimerRef.current = null }
  }, [])

  const clearCalleeRingTimer = useCallback(() => {
    if (calleeRingTimerRef.current) { clearTimeout(calleeRingTimerRef.current); calleeRingTimerRef.current = null }
  }, [])

  const clearDisconnectGraceTimer = useCallback(() => {
    if (disconnectGraceTimerRef.current) { clearTimeout(disconnectGraceTimerRef.current); disconnectGraceTimerRef.current = null }
  }, [])

  const cleanupCall = useCallback(() => {
    clearRingTimer()
    clearConnectTimer()
    clearCalleeRingTimer()
    clearDisconnectGraceTimer()
    bufferedIceCandidates.current = []
    iceRestartAttemptedRef.current = false
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null }
    remoteStreamRef.current = null
    remotePeerIdRef.current = null
    remotePeerNameRef.current = null
    setRemoteStream(null); setLocalStream(null); setIsInCall(false)
    setIsMuted(false); setIsCameraOff(false); setIncomingCall(null)
    setRingTarget(null); setCallError('')
  }, [clearRingTimer, clearConnectTimer, clearCalleeRingTimer, clearDisconnectGraceTimer])

  const startConnectTimer = useCallback(() => {
    clearConnectTimer()
    // Android WebView is slower — give it 30s instead of 15s
    const timeout = isWebView ? 30000 : 15000
    connectTimerRef.current = setTimeout(() => {
      console.error(`[Sylvid] Connection timeout — WebRTC failed to establish after ${timeout/1000}s`)
      setCallError('Connection failed — could not reach the other user. Try again.')
      cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 3000)
    }, timeout)
  }, [clearConnectTimer, cleanupCall])

  useEffect(() => {
    const socket = createSignalSocket()
    socketRef.current = socket

    // Use the socket's internal userId for self-filtering — available immediately,
    // unlike myIdRef which is only set after the 'registered' event arrives
    const selfId = socket.userId

    // Poll for backend detection every second until known
    const backendCheck = setInterval(() => {
      const b = socket.backend
      if (b !== 'unknown') { setBackend(b); clearInterval(backendCheck) }
    }, 1000)

    socket.on('registered', (data: { id: string; username: string }) => {
      myIdRef.current = data.id
      setMyId(data.id); setMyUsername(data.username); setIsRegistered(true)
    })

    socket.on('peer-list', (data: { peers: Peer[] }) => {
      setPeers(data.peers.filter((p) => p.id !== selfId && !p.isAdmin))
    })

    socket.on('incoming-call', (data) => {
      setIncomingCall(data)
      // Don't change callStatus — callee stays in lobby so the accept/reject Dialog is visible
      // Auto-reject if callee doesn't respond within 35 seconds
      clearCalleeRingTimer()
      calleeRingTimerRef.current = setTimeout(() => {
        console.log('[Sylvid] Callee ring timeout (35s) — auto-rejecting incoming call')
        if (socketRef.current && data?.fromId) {
          socketRef.current.emit('call-rejected', { targetId: data.fromId })
        }
        setIncomingCall(null)
      }, 35000)
    })

    socket.on('call-answered', async (data) => {
      clearRingTimer()
      const pc = pcRef.current
      if (pc) {
        console.log('[Sylvid] Received answer, setting remote description')
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
        // Add any ICE candidates that arrived before the answer (caller had PC but no remote desc)
        for (const c of bufferedIceCandidates.current) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch (e) { /* ignore */ }
        }
        bufferedIceCandidates.current = []
        console.log('[Sylvid] Answer set, transitioning to connecting')
        setCallStatus('connecting'); startConnectTimer()
      }
    })

    socket.on('ice-candidate', async (data) => {
      if (!data.candidate) return
      const pc = pcRef.current
      // Only add directly if PC exists AND remote description is set
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)) } catch (e) { /* ignore */ }
      } else {
        // No PC or no remote description yet — buffer for later
        bufferedIceCandidates.current.push(data.candidate)
        console.log('[Sylvid] Buffered ICE candidate (no remote desc):', data.candidate.candidate?.slice(0, 50))
      }
    })

    socket.on('call-rejected', () => { cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000) })
    socket.on('call-ended', () => { clearRingTimer(); cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000) })
    socket.on('force-disconnected', () => { cleanupCall(); setCallStatus('ended'); setIsRegistered(false) })

    return () => { clearInterval(backendCheck); socket.disconnect() }
  }, [])

  const isMobileDevice = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const isWebView = typeof navigator !== 'undefined' && /wv|WebView/i.test(navigator.userAgent)

  const getLocalStream = useCallback(async () => {
    try {
      // Use lower constraints for Android WebView — it struggles with high-res
      const videoConstraints = isWebView
        ? { width: { ideal: 320, max: 640 }, height: { ideal: 240, max: 480 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' as const }
        : { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 15, max: 30 }, facingMode: 'user' as const }
      // Wrap getUserMedia with a 15s timeout so it doesn't hang forever on Android WebView
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          }
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Camera access timed out after 15 seconds. Please check permissions and try again.')), 15000)
        ),
      ])
      localStreamRef.current = stream; setLocalStream(stream); return stream
    } catch (err: any) {
      console.error('[Sylvid] getLocalStream error:', err?.name, err?.message)
      const errName = err?.name || ''
      const errMsg = err?.message || ''

      // Device in use — another app has the camera open
      if (errName === 'NotReadableError' || errMsg.includes('Device in use') || errMsg.includes('Could not start video source')) {
        const mobileSteps = isMobileDevice
          ? [
              'Close all other apps that might be using the camera (WhatsApp, Instagram, etc.)',
              'Go to your phone Settings → Apps → Browser → Permissions → Camera → Allow',
              'Go to Settings → Apps → Browser → Permissions → Microphone → Allow',
              'Close ALL browser tabs and reopen this page',
              'If still stuck, restart your phone and try again',
            ]
          : [
              'Close other apps that might be using the camera (Zoom, Teams, etc.)',
              'Check your browser address bar — click the camera icon and select "Allow"',
              'Close other browser tabs that might have camera access',
              'Try a different browser (Chrome, Edge, or Firefox)',
            ]
        setCameraError({
          title: 'Camera is busy',
          message: 'Another app or tab is using your camera right now.',
          steps: mobileSteps,
          isDeviceInUse: true,
          isPermissionDenied: false,
          isNotFound: false,
        })
        throw new Error('Camera is in use by another app. Please close other apps and try again.')
      }

      // Permission denied — user blocked camera/mic
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        const mobileSteps = isMobileDevice
          ? [
              'When prompted, tap "Allow" for camera and microphone',
              'If you accidentally blocked it: go to phone Settings → Apps → Browser → Permissions',
              'Set Camera to "Allow" and Microphone to "Allow"',
              'Come back to this page and refresh',
              'On iPhone: Settings → Safari → Camera → Allow',
            ]
          : [
              'Click the camera/mic icon in the browser address bar',
              'Select "Allow" for both camera and microphone',
              'Refresh the page and try again',
              'Check: chrome://settings/content/camera (Chrome) or edge://settings/content/camera (Edge)',
            ]
        setCameraError({
          title: 'Camera/mic permission blocked',
          message: 'You need to allow camera and microphone access in your browser.',
          steps: mobileSteps,
          isDeviceInUse: false,
          isPermissionDenied: true,
          isNotFound: false,
        })
        throw new Error('Camera/microphone permission denied. Please allow access in your browser settings.')
      }

      // No camera found
      if (errName === 'NotFoundError' || errMsg.includes('Requested device not found')) {
        setCameraError({
          title: 'No camera found',
          message: 'Your device does not have a camera or it is not connected.',
          steps: isMobileDevice
            ? ['Make sure your phone has a working camera', 'Try restarting your phone']
            : ['Check if your webcam is plugged in', 'Try a different USB port', 'Check Device Manager to confirm camera is detected'],
          isDeviceInUse: false,
          isPermissionDenied: false,
          isNotFound: true,
        })
        throw new Error('No camera found on this device.')
      }

      // Generic error
      setCameraError({
        title: 'Camera error',
        message: `Could not access camera: ${errMsg}`,
        steps: isMobileDevice
          ? ['Close other apps using the camera', 'Grant camera permission in phone Settings', 'Restart the browser and try again']
          : ['Check browser camera permissions', 'Close other apps using the camera', 'Try a different browser'],
        isDeviceInUse: false,
        isPermissionDenied: false,
        isNotFound: false,
      })
      throw err
    }
  }, [])

  // Fetch TURN credentials via server proxy (avoids CORS, keeps API key server-side)
  const fetchTurnServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const res = await fetch(TURN_PROXY_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const servers = await res.json()
      console.log('[Sylvid] TURN servers fetched:', servers?.length || 0)
      turnServersRef.current = servers
      return servers
    } catch (e) {
      console.warn('[Sylvid] Failed to fetch TURN servers, using STUN only:', e)
      return []
    }
  }, [])

  const createPeerConnection = useCallback(async (remotePeerId: string, localStream?: MediaStream, remotePeerName?: string) => {
    // Fetch fresh TURN credentials for each call
    const turnServers = await fetchTurnServers()
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        ...turnServers,
      ],
      // Android WebView compatibility:
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    })
    pcRef.current = pc; remotePeerIdRef.current = remotePeerId; remotePeerNameRef.current = remotePeerName || null
    // Add local tracks if we have a stream (may be undefined if camera failed)
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream))
    } else {
      // No camera — add a silent audio track so the connection has a media component
      // This is needed because the offer has audio/video, and without at least one track
      // the peer connection may not establish properly
      console.log('[Sylvid] No local stream — adding recvonly silent track')
      const silentAudio = new AudioContext().createMediaStreamDestination()
      const osc = silentAudio.context.createOscillator()
      osc.frequency.value = 0 // silence
      const gain = silentAudio.context.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(silentAudio)
      osc.start()
      silentAudio.stream.getAudioTracks().forEach((t) => {
        t.enabled = false
        pc.addTrack(t, silentAudio.stream)
      })
    }
    const remoteMediaStream = new MediaStream()
    remoteStreamRef.current = remoteMediaStream
    pc.ontrack = (e) => {
      console.log('[Sylvid] Remote track received:', e.track.kind, e.streams.length, 'stream(s)')
      e.streams[0].getTracks().forEach((t) => remoteMediaStream.addTrack(t))
      setRemoteStream(new MediaStream(remoteMediaStream.getTracks()))
    }
    let candidateCount = 0
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        candidateCount++
        console.log(`[Sylvid] ICE candidate #${candidateCount}: ${e.candidate.type}`, e.candidate.candidate?.slice(0, 80))
        // Report candidate type to server for diagnostics
        if (socketRef.current) socketRef.current.emit('debug', { msg: `ice-candidate: #${candidateCount} type=${e.candidate.type} ${e.candidate.protocol || ''} ${e.candidate.address || ''}` })
        if (socketRef.current) socketRef.current.emit('ice-candidate', {
          targetId: remotePeerId,
          targetUsername: remotePeerNameRef.current || undefined,
          candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex }
        })
      } else {
        console.log(`[Sylvid] ICE gathering complete — ${candidateCount} candidates gathered`)
        if (socketRef.current) socketRef.current.emit('debug', { msg: `ice-gathering-complete: ${candidateCount} candidates` })
      }
    }
    pc.oniceconnectionstatechange = () => {
      console.log('[Sylvid] ICE connection state:', pc.iceConnectionState)
      if (socketRef.current) socketRef.current.emit('debug', { msg: `ice-state: ${pc.iceConnectionState}` })
      // Android WebView sometimes doesn't fire connectionstatechange — use ICE state as fallback
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        clearDisconnectGraceTimer()
        clearConnectTimer(); setCallStatus('connected'); setIsInCall(true)
      }
      else if (pc.iceConnectionState === 'failed') {
        console.error('[Sylvid] WebRTC ICE FAILED — attempting ICE restart before giving up')
        if (!iceRestartAttemptedRef.current && pcRef.current) {
          iceRestartAttemptedRef.current = true
          try {
            pc.restartIce()
            console.log('[Sylvid] ICE restart triggered — waiting for reconnection...')
            // If ICE restart doesn't recover within 10s, give up
            disconnectGraceTimerRef.current = setTimeout(() => {
              console.error('[Sylvid] ICE restart did not recover after 10s — ending call')
              setCallError('Connection failed. Both users should be on WiFi for best results.')
              cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 4000)
            }, 10000)
            return
          } catch (e) {
            console.warn('[Sylvid] ICE restart failed:', e)
          }
        }
        setCallError('Connection failed. Both users should be on WiFi for best results.')
        cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 4000)
      }
      else if (pc.iceConnectionState === 'disconnected') {
        // Don't kill immediately — WebRTC 'disconnected' is often transient.
        // Wait 8 seconds to allow auto-recovery before tearing down.
        console.warn('[Sylvid] ICE disconnected — waiting 8s for auto-recovery...')
        if (!disconnectGraceTimerRef.current) {
          disconnectGraceTimerRef.current = setTimeout(() => {
            // Re-check state — if it recovered, do nothing
            if (pcRef.current && (pcRef.current.iceConnectionState === 'disconnected' || pcRef.current.iceConnectionState === 'failed')) {
              console.error('[Sylvid] ICE still disconnected after 8s grace — ending call')
              cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000)
            }
          }, 8000)
        }
      }
    }
    pc.onconnectionstatechange = () => {
      console.log('[Sylvid] Connection state:', pc.connectionState)
      if (socketRef.current) socketRef.current.emit('debug', { msg: `connection-state: ${pc.connectionState}` })
      if (pc.connectionState === 'connected') {
        clearDisconnectGraceTimer()
        clearConnectTimer(); setCallStatus('connected'); setIsInCall(true)
      }
      else if (pc.connectionState === 'failed') {
        // Already handled by oniceconnectionstatechange (which has ICE restart logic)
        // Only act if ICE handler didn't already handle it
        if (pc.iceConnectionState !== 'failed') {
          console.error('[Sylvid] Connection FAILED (non-ICE)')
          setCallError('Connection failed. Both users should be on WiFi for best results.')
          cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 4000)
        }
      }
      else if (pc.connectionState === 'disconnected') {
        // ICE handler manages the grace period — don't duplicate teardown here
        console.warn('[Sylvid] Connection state disconnected (ICE handler manages recovery)')
      }
      else if (pc.connectionState === 'closed') {
        cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000)
      }
    }
    return pc
  }, [cleanupCall, clearConnectTimer, getLocalStream])

  const register = useCallback((username: string) => { socketRef.current?.emit('register', { username, device: 'web-admin' }) }, [])

  const callPeer = useCallback(async (targetId: string, targetName?: string) => {
    setCallError(''); setCameraError(null)
    bufferedIceCandidates.current = []
    console.log('[Sylvid] Calling:', targetId, targetName)
    let localStream: MediaStream | undefined
    try {
      localStream = await getLocalStream()
      localStreamRef.current = localStream; setLocalStream(localStream)
    } catch (camErr: any) {
      console.warn('[Sylvid] Camera failed on call — continuing without local video:', camErr?.message)
      setCameraError(null)
      // Don't show warning for caller — the ringing screen is shown instead
    }
    try {
      await createPeerConnection(targetId, localStream, targetName)
      const pc = pcRef.current; if (!pc) { setCallError('Failed to create peer connection'); return }
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
      // Send offer IMMEDIATELY — trickle ICE candidates via signaling
      const desc = pc.localDescription!
      console.log('[Sylvid] Sending offer (trickle ICE), SDP:', desc.sdp?.length, 'chars', localStream ? '' : '[NO LOCAL VIDEO]')
      if (socketRef.current) {
        socketRef.current.emit('call-offer', { targetId, targetUsername: targetName, offer: { type: desc.type, sdp: desc.sdp } })
        setRingTarget({ id: targetId, name: targetName || 'User' })
        setCallStatus('ringing')
        // Auto-cancel if no answer within 30 seconds
        clearRingTimer()
        ringTimerRef.current = setTimeout(() => {
          console.log('[Sylvid] Ring timeout — no answer')
          if (socketRef.current) socketRef.current.emit('call-ended', { targetId })
          cleanupCall()
          setCallStatus('ended')
          setTimeout(() => setCallStatus('idle'), 2000)
        }, 30000)
      } else {
        setCallError('Not connected to server')
      }
    } catch (err: any) {
      console.error('[Sylvid] callPeer error:', err)
      setCallError(err?.message || 'Call failed')
    }
  }, [createPeerConnection, clearRingTimer, cleanupCall])

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return
    setCallError(''); setCameraError(null)
    const callInfo = incomingCall // capture before clearing
    console.log('[Sylvid] Accepting call from', callInfo.fromName)
    let localStream: MediaStream | undefined
    try {
      localStream = await getLocalStream()
      localStreamRef.current = localStream; setLocalStream(localStream)
    } catch (camErr: any) {
      console.warn('[Sylvid] Camera failed on accept — continuing without local video:', camErr?.message)
      // Clear the blocking dialog — show non-blocking warning instead
      setCameraError(null)
      setCallError('Camera not available — you can see the other person but they can\'t see you')
      // Don't throw — we MUST send the answer so the caller doesn't time out
    }
    try {
      await createPeerConnection(callInfo.fromId, localStream, callInfo.fromName)
      const pc = pcRef.current; if (!pc) return

      await pc.setRemoteDescription(new RTCSessionDescription(callInfo.offer))

      // Add buffered candidates from caller (arrived while callee hadn't accepted yet)
      console.log('[Sylvid] Adding', bufferedIceCandidates.current.length, 'buffered caller candidates')
      for (const c of bufferedIceCandidates.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch (e) { /* ignore */ }
      }
      bufferedIceCandidates.current = []

      // Send answer IMMEDIATELY — trickle ICE candidates via signaling
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer)
      const desc = pc.localDescription!
      console.log('[Sylvid] Sending answer (trickle ICE), SDP:', desc.sdp?.length, 'chars', localStream ? '' : '[NO LOCAL VIDEO]')
      socketRef.current?.emit('call-answer', { targetId: callInfo.fromId, answer: { type: desc.type, sdp: desc.sdp } })
      clearCalleeRingTimer()
      setIncomingCall(null); setCallStatus('connecting'); startConnectTimer()
    } catch (err: any) {
      clearCalleeRingTimer()
      console.error('[Sylvid] acceptCall error:', err)
      setCallError(err?.message || 'Accept failed')
    }
  }, [incomingCall, createPeerConnection, startConnectTimer, clearCalleeRingTimer])

  const rejectCall = useCallback(() => {
    clearCalleeRingTimer()
    if (incomingCall && socketRef.current) socketRef.current.emit('call-rejected', { targetId: incomingCall.fromId })
    setIncomingCall(null); setCallStatus('idle')
  }, [incomingCall, clearCalleeRingTimer])

  const endCall = useCallback(() => {
    if (socketRef.current && remotePeerIdRef.current) socketRef.current.emit('call-ended', { targetId: remotePeerIdRef.current })
    cleanupCall(); setCallStatus('ended'); setTimeout(() => setCallStatus('idle'), 2000)
  }, [cleanupCall])

  const toggleMute = useCallback(() => { localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled }); setIsMuted((p) => !p) }, [])
  const toggleCamera = useCallback(() => { localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled }); setIsCameraOff((p) => !p) }, [])

  return { peers, myId, myUsername, isRegistered, register, callPeer, incomingCall, acceptCall, rejectCall, isInCall, remoteStream, localStream, endCall, isMuted, isCameraOff, toggleMute, toggleCamera, callStatus, callError, setCallError, cameraError, setCameraError, ringTarget, backend, socketRef }
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

type AppMode = 'admin' | 'call'

interface HomeClientProps {
  serverUser: { id: string; email: string; nickname: string }
}

export default function HomeClient({ serverUser }: HomeClientProps) {
  const user = serverUser
  const router = useRouter()
  const [mode, setMode] = useState<AppMode>('call')
  const [passInput, setPassInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [copied, setCopied] = useState(false)

  const webrtc = useWebRTC()



  const handleAdminLogin = () => {
    if (passInput === 'admin2024') {
      setMode('admin')
      setLoginError('')
    } else {
      setLoginError('Wrong password')
    }
  }

  const handleLogout = async () => {
    webrtc.socketRef.current?.disconnect()
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('sylvid-token')
    localStorage.removeItem('sylvid-user')
    router.push('/login')
  }

  // Auto-register immediately — server already verified auth
  useEffect(() => {
    if (user?.nickname && !webrtc.isRegistered) {
      webrtc.register(user.nickname)
    }
  }, [user?.nickname, webrtc.isRegistered])

  // Show admin login option (accessible via ?admin query param)
  const isAdminMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('admin')
  if (isAdminMode && mode !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-4">
        <Card className="w-full max-w-sm bg-neutral-900/80 border-neutral-800 backdrop-blur-xl">
          <CardContent className="p-8 space-y-6">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <Shield className="w-7 h-7 text-emerald-400" />
              </div>
              <h1 className="text-xl font-bold text-white">Admin Access</h1>
              <p className="text-neutral-500 text-sm">Enter admin password</p>
            </div>
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
                Enter Dashboard
              </Button>
              {loginError && (
                <p className="text-red-400 text-xs text-center flex items-center justify-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {loginError}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ===== ADMIN DASHBOARD =====
  // ===== CALL MODE (user) =====
  const { peers, myId, myUsername, isRegistered, callPeer, incomingCall, acceptCall, rejectCall, isInCall, remoteStream, localStream, endCall, isMuted, isCameraOff, toggleMute, toggleCamera, callStatus, callError, setCallError, cameraError, setCameraError, ringTarget, backend } = webrtc
  const isMobile = /Android|iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
  const inCall = isInCall || callStatus === 'ringing' || callStatus === 'connecting' || callStatus === 'connected'

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
      <>
        <div className="min-h-screen bg-neutral-950 flex flex-col">
          <div className="flex-1 relative">
            <div className="absolute inset-0">
              <VideoPlayer stream={remoteStream} label={callStatus === 'connecting' ? 'Connecting...' : callStatus === 'ringing' ? 'Ringing...' : 'Remote'} className="w-full h-full" isProtected />
            </div>
            <div className="absolute top-4 right-4 w-32 h-44 sm:w-40 sm:h-56 md:w-48 md:h-64 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 z-10">
              <VideoPlayer stream={localStream} muted label="You" mirrored className="w-full h-full" isProtected />
            </div>
            {callStatus === 'ringing' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-white font-medium">Ringing {ringTarget?.name}...</p>
                  <p className="text-white/60 text-sm">Waiting for answer</p>
                </div>
              </div>
            )}
            {callStatus === 'connecting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-white font-medium">Connecting...</p>
                  {callError && <p className="text-amber-400 text-xs text-center max-w-[250px]">{callError}</p>}
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

        {/* Camera Error Dialog — shows step-by-step fix instructions */}
        <Dialog open={!!cameraError} onOpenChange={(open) => { if (!open) setCameraError(null) }}>
          <DialogContent className="bg-neutral-900 border-neutral-800 text-white sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader className="text-center items-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                {cameraError?.isDeviceInUse ? <Camera className="w-8 h-8 text-red-400" /> : <XCircle className="w-8 h-8 text-red-400" />}
              </div>
              <DialogTitle className="text-xl">{cameraError?.title}</DialogTitle>
              <DialogDescription className="text-neutral-400 mt-1">{cameraError?.message}</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-3">
              <p className="text-neutral-300 text-sm font-medium">How to fix:</p>
              <ol className="space-y-2">
                {cameraError?.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center text-xs font-bold mt-0.5">{i + 1}</span>
                    <span className="text-neutral-300">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-6 flex justify-center">
              <Button
                onClick={() => { setCameraError(null); setCallError('') }}
                className="bg-violet-600 hover:bg-violet-700 text-white px-6"
              >
                Got it, I'll try again
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Incoming call dialog — can arrive even while in another call */}
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
      </>
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
                  <p className="text-neutral-500 text-xs">{user?.email}</p>
                  <p className="text-neutral-600 text-xs font-mono">ID: {myId?.slice(0, 8)}...</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCopyId} className="text-neutral-400 hover:text-white">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {backend === 'memory' && typeof window !== 'undefined' && window.location.hostname.includes('vercel.app') && (
          <Card className="bg-orange-500/10 border-orange-500/30">
            <CardContent className="p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-orange-400 text-sm font-medium">Vercel KV not connected</p>
                <p className="text-orange-400/70 text-xs mt-0.5">Users can't see each other on Vercel without KV storage. Go to Vercel Dashboard → Storage → Create KV Store, then link it to this project. Use Railway deploy for testing without KV.</p>
              </div>
            </CardContent>
          </Card>
        )}

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
                    <Button onClick={() => callPeer(peer.id, peer.username)} className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl h-10 px-4">
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

        {callError && !cameraError && (
          <Card className="bg-red-500/10 border-red-500/30">
            <CardContent className="p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-red-400 text-sm">{callError}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Camera Error Dialog — shows step-by-step fix instructions */}
      <Dialog open={!!cameraError} onOpenChange={(open) => { if (!open) setCameraError(null) }}>
        <DialogContent className="bg-neutral-900 border-neutral-800 text-white sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-center items-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              {cameraError?.isDeviceInUse ? <Camera className="w-8 h-8 text-red-400" /> : <XCircle className="w-8 h-8 text-red-400" />}
            </div>
            <DialogTitle className="text-xl">{cameraError?.title}</DialogTitle>
            <DialogDescription className="text-neutral-400 mt-1">{cameraError?.message}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <p className="text-neutral-300 text-sm font-medium">How to fix:</p>
            <ol className="space-y-2">
              {cameraError?.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center text-xs font-bold mt-0.5">{i + 1}</span>
                  <span className="text-neutral-300">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-6 flex justify-center">
            <Button
              onClick={() => { setCameraError(null); setCallError('') }}
              className="bg-violet-600 hover:bg-violet-700 text-white px-6"
            >
              Got it, I'll try again
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
