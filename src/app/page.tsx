'use client'

import { useRef, useState } from 'react'
import { useWebRTC } from '@/hooks/useWebRTC'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

function VideoPlayer({
  stream,
  muted = false,
  label,
  mirrored = false,
  className = '',
}: {
  stream: MediaStream | null
  muted?: boolean
  label: string
  mirrored?: boolean
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [stream])

  return (
    <div className={`relative rounded-2xl overflow-hidden bg-neutral-900 ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
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

export default function VideoCallPage() {
  const {
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
  } = useWebRTC()

  const [usernameInput, setUsernameInput] = useState('')
  const [copied, setCopied] = useState(false)
  const isMobile = /Android|iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')

  const handleRegister = () => {
    const name = usernameInput.trim()
    if (name) {
      setMyUsername(name)
      register(name)
    }
  }

  const handleCopyId = () => {
    if (myId) {
      navigator.clipboard.writeText(myId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Registration screen
  if (!isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-4">
        <Card className="w-full max-w-md bg-neutral-900/80 border-neutral-800 backdrop-blur-xl">
          <CardContent className="p-8 space-y-6">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <Video className="w-8 h-8 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">VideoCall</h1>
              <p className="text-neutral-400 text-sm text-center">
                {isMobile ? 'Install as app for the best experience' : 'Real-time video calling from your browser'}
              </p>
            </div>

            <div className="space-y-3">
              <Input
                placeholder="Enter your name"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                className="bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500 h-12 rounded-xl"
                maxLength={20}
              />
              <Button
                onClick={handleRegister}
                disabled={!usernameInput.trim()}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium text-base"
              >
                Join
              </Button>
            </div>

            {isMobile && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <Smartphone className="w-5 h-5 text-blue-400 shrink-0" />
                <p className="text-blue-300 text-xs">
                  Tap &quot;Add to Home Screen&quot; in your browser menu to install as an app
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // Active call view
  if (isInCall || callStatus === 'connecting' || callStatus === 'connected') {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col">
        {/* Main video area */}
        <div className="flex-1 relative">
          {/* Remote video (full screen) */}
          <div className="absolute inset-0">
            <VideoPlayer
              stream={remoteStream}
              label={callStatus === 'connecting' ? 'Connecting...' : 'Remote'}
              className="w-full h-full"
            />
          </div>

          {/* Local video (picture-in-picture) */}
          <div className="absolute top-4 right-4 w-32 h-44 sm:w-40 sm:h-56 md:w-48 md:h-64 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 z-10">
            <VideoPlayer
              stream={localStream}
              muted
              label="You"
              mirrored
              className="w-full h-full"
            />
          </div>

          {/* Call status overlay */}
          {callStatus === 'connecting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-white font-medium">Connecting...</p>
              </div>
            </div>
          )}
        </div>

        {/* Call controls */}
        <div className="bg-black/80 backdrop-blur-xl px-6 py-5 flex items-center justify-center gap-4 safe-area-bottom">
          <Button
            onClick={toggleMute}
            variant="ghost"
            size="icon"
            className={`w-14 h-14 rounded-full ${isMuted ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </Button>

          <Button
            onClick={toggleCamera}
            variant="ghost"
            size="icon"
            className={`w-14 h-14 rounded-full ${isCameraOff ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
          >
            {isCameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
          </Button>

          <Button
            onClick={endCall}
            variant="ghost"
            size="icon"
            className="w-16 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </div>
    )
  }

  // Lobby view
  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Video className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">VideoCall</h1>
              <p className="text-xs text-neutral-500">P2P encrypted calls</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse" />
              Online
            </Badge>
          </div>
        </header>

        {/* My ID card */}
        <Card className="bg-neutral-900/60 border-neutral-800 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-white font-bold text-lg">
                  {myUsername.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-medium">{myUsername}</p>
                  <p className="text-neutral-500 text-xs font-mono">
                    ID: {myId?.slice(0, 8)}...
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyId}
                className="text-neutral-400 hover:text-white"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Online peers */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-neutral-500" />
            <h2 className="text-sm font-medium text-neutral-400">
              Online ({peers.length})
            </h2>
          </div>

          {peers.length === 0 ? (
            <Card className="bg-neutral-900/40 border-neutral-800/50">
              <CardContent className="p-8 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Monitor className="w-10 h-10 text-neutral-700" />
                  <p className="text-neutral-500 text-sm">No other users online</p>
                  <p className="text-neutral-600 text-xs">Share this link with a friend to start a call</p>
                </div>
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
                        <p className="text-neutral-500 text-xs font-mono">{peer.id.slice(0, 12)}...</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => callPeer(peer.id)}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl h-10 px-4"
                    >
                      <Phone className="w-4 h-4 mr-2" />
                      Call
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Device indicator */}
        <div className="flex justify-center pt-2 pb-4">
          <div className="flex items-center gap-2 text-neutral-600 text-xs">
            {isMobile ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            <span>{isMobile ? 'Mobile — install as app for full screen' : 'Desktop mode'}</span>
          </div>
        </div>
      </div>

      {/* Incoming call dialog */}
      <Dialog open={!!incomingCall}>
        <DialogContent className="bg-neutral-900 border-neutral-800 text-white sm:max-w-md">
          <DialogHeader className="text-center items-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">
              {incomingCall?.fromName?.charAt(0).toUpperCase()}
            </div>
            <DialogTitle className="text-xl">{incomingCall?.fromName}</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Incoming video call
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-4 pt-4">
            <Button
              onClick={rejectCall}
              variant="ghost"
              size="lg"
              className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white"
            >
              <PhoneOff className="w-6 h-6" />
            </Button>
            <Button
              onClick={acceptCall}
              variant="ghost"
              size="lg"
              className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <PhoneIncoming className="w-6 h-6" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Call ended overlay */}
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
