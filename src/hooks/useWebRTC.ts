'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'

export interface Peer {
  id: string
  username: string
}

interface UseWebRTCReturn {
  peers: Peer[]
  myId: string | null
  myUsername: string
  setMyUsername: (name: string) => void
  isRegistered: boolean
  register: (username: string) => void
  callPeer: (targetId: string) => Promise<void>
  incomingCall: { fromId: string; fromName: string; offer: RTCSessionDescriptionInit } | null
  acceptCall: () => Promise<void>
  rejectCall: () => void
  isInCall: boolean
  remoteStream: MediaStream | null
  localStream: MediaStream | null
  endCall: () => void
  isMuted: boolean
  isCameraOff: boolean
  toggleMute: () => void
  toggleCamera: () => void
  callStatus: 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended'
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
}

export function useWebRTC(): UseWebRTCReturn {
  const socketRef = useRef<Socket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const pendingOfferRef = useRef<{ fromId: string; fromName: string; offer: RTCSessionDescriptionInit } | null>(null)
  const remotePeerIdRef = useRef<string | null>(null)

  const [peers, setPeers] = useState<Peer[]>([])
  const myIdRef = useRef<string | null>(null)
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

  const cleanupCall = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    remoteStreamRef.current = null
    pendingOfferRef.current = null
    remotePeerIdRef.current = null
    setRemoteStream(null)
    setLocalStream(null)
    setIsInCall(false)
    setIsMuted(false)
    setIsCameraOff(false)
    setIncomingCall(null)
  }, [])

  useEffect(() => {
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Connected to signaling server')
    })

    socket.on('registered', (data: { id: string; username: string }) => {
      myIdRef.current = data.id
      setMyId(data.id)
      setMyUsername(data.username)
      setIsRegistered(true)
    })

    socket.on('peer-list', (data: { peers: Peer[] }) => {
      setPeers(data.peers.filter((p) => p.id !== myIdRef.current))
    })

    socket.on('incoming-call', (data: { fromId: string; fromName: string; offer: RTCSessionDescriptionInit }) => {
      pendingOfferRef.current = data
      setIncomingCall(data)
      setCallStatus('ringing')
    })

    socket.on('call-answered', async (data: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
        setCallStatus('connecting')
      }
    })

    socket.on('ice-candidate', async (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current
      if (pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
        } catch (e) {
          console.error('Error adding ICE candidate:', e)
        }
      }
    })

    socket.on('call-rejected', () => {
      cleanupCall()
      setCallStatus('ended')
      setTimeout(() => setCallStatus('idle'), 2000)
    })

    socket.on('call-ended', () => {
      cleanupCall()
      setCallStatus('ended')
      setTimeout(() => setCallStatus('idle'), 2000)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

// myId filtering handled via ref in peer-list handler

  const getLocalStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: true,
    })
    localStreamRef.current = stream
    setLocalStream(stream)
    return stream
  }, [])

  const createPeerConnection = useCallback((stream: MediaStream, remotePeerId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    pcRef.current = pc
    remotePeerIdRef.current = remotePeerId

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream)
    })

    const remoteMediaStream = new MediaStream()
    remoteStreamRef.current = remoteMediaStream

    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteMediaStream.addTrack(track)
      })
      setRemoteStream(new MediaStream(remoteMediaStream.getTracks()))
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          targetId: remotePeerId,
          candidate: event.candidate.toJSON(),
        })
      }
    }

    pc.onconnectionstatechange = () => {
 if (pc.connectionState === 'connected') {
        setCallStatus('connected')
        setIsInCall(true)
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        cleanupCall()
        setCallStatus('ended')
        setTimeout(() => setCallStatus('idle'), 2000)
      }
    }

    return { pc, remoteMediaStream }
  }, [cleanupCall])

  const register = useCallback((username: string) => {
    if (socketRef.current) {
      socketRef.current.emit('register', { username })
    }
  }, [])

  const callPeer = useCallback(async (targetId: string) => {
    const stream = await getLocalStream()
    createPeerConnection(stream, targetId)

    const pc = pcRef.current
    if (!pc) return

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    socketRef.current?.emit('call-offer', { targetId, offer: offer.toJSON() })
    setCallStatus('connecting')
  }, [getLocalStream, createPeerConnection])

  const acceptCall = useCallback(async () => {
    if (!pendingOfferRef.current) return

    const stream = await getLocalStream()
    const { fromId, offer } = pendingOfferRef.current
    createPeerConnection(stream, fromId)

    const pc = pcRef.current
    if (!pc) return

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    socketRef.current?.emit('call-answer', { targetId: fromId, answer: answer.toJSON() })
    setIncomingCall(null)
    setCallStatus('connecting')
  }, [getLocalStream, createPeerConnection])

  const rejectCall = useCallback(() => {
    if (pendingOfferRef.current && socketRef.current) {
      socketRef.current.emit('call-rejected', { targetId: pendingOfferRef.current.fromId })
    }
    setIncomingCall(null)
    pendingOfferRef.current = null
    setCallStatus('idle')
  }, [])

  const endCall = useCallback(() => {
    if (socketRef.current && remotePeerIdRef.current) {
      socketRef.current.emit('call-ended', { targetId: remotePeerIdRef.current })
    }
    cleanupCall()
    setCallStatus('ended')
    setTimeout(() => setCallStatus('idle'), 2000)
  }, [cleanupCall])

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled
      })
      setIsMuted((prev) => !prev)
    }
  }, [])

  const toggleCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = !t.enabled
      })
      setIsCameraOff((prev) => !prev)
    }
  }, [])

  return {
    peers,
    myId,
    myUsername,
    setMyUsername,
    isRegistered,
    register,
    callPeer,
    incomingCall,
    acceptCall,
    rejectCall,
    isInCall,
    remoteStream,
    localStream,
    endCall,
    isMuted,
    isCameraOff,
    toggleMute,
    toggleCamera,
    callStatus,
  }
}
