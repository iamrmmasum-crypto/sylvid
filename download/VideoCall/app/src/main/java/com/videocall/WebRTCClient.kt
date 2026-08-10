package com.videocall

import android.content.Context
import android.util.Log
import org.webrtc.*
import org.json.JSONObject

/**
 * WebRTC peer connection with mandatory encryption.
 *
 * ENCRYPTION MODEL:
 *   WebRTC mandates DTLS-SRTP for all media transport.
 *   There is NO option to disable it. Every audio/video packet is:
 *     1. Encrypted with AES-128/256 via DTLS
 *     2. Authenticated via HMAC-SHA1
 *     3. Key exchange via DTLS handshake (ECDHE)
 *     4. Perfect Forward Secrecy — each session uses unique keys
 *
 *   The signaling server only routes SDP/ICE metadata.
 *   It NEVER sees media data or encryption keys.
 */
class WebRTCClient(
    private val context: Context,
    private val listener: WebRTCListener
) {
    interface WebRTCListener {
        fun onLocalStream(stream: MediaStream)
        fun onRemoteStream(stream: MediaStream)
        fun onIceCandidate(candidate: IceCandidate)
        fun onAnswerCreated(answer: JSONObject)
        fun onConnectionStateChange(state: PeerConnection.IceConnectionState)
        fun onCallDisconnected()
    }

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var localAudioTrack: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null
    private var localStream: MediaStream? = null
    private var videoCapturer: VideoCapturer? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var localVideoSink: ProxyVideoSink? = null

    fun initialize() {
        val initOptions = PeerConnectionFactory.InitializationOptions
            .builder(context)
            .setEnableInternalTracer(false)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(initOptions)

        val options = PeerConnectionFactory.Options()
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(options)
            .createPeerConnectionFactory()

        createLocalTracks()
    }

    private fun createLocalTracks() {
        val factory = peerConnectionFactory ?: return

        // Audio
        val audioConstraints = MediaConstraints()
        val audioSource = factory.createAudioSource(audioConstraints)
        localAudioTrack = factory.createAudioTrack("audio0", audioSource)

        // Video — front camera
        videoCapturer = createCameraCapturer() ?: return
        surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", null)
        val videoSource = factory.createVideoSource(videoCapturer!!.isScreencast)
        videoCapturer!!.initialize(surfaceTextureHelper, context, videoSource.capturerObserver)
        videoCapturer!!.startCapture(1280, 720, 30)
        localVideoTrack = factory.createVideoTrack("video0", videoSource)

        localStream = factory.createLocalMediaStream("localStream")
        localAudioTrack?.let { localStream?.addTrack(it) }
        localVideoTrack?.let { localStream?.addTrack(it) }

        listener.onLocalStream(localStream!!)
    }

    private fun createCameraCapturer(): VideoCapturer? {
        val cameraEnumerator = Camera2Enumerator(context)
        val deviceNames = cameraEnumerator.deviceNames
        // Prefer front camera
        for (name in deviceNames) {
            if (cameraEnumerator.isFrontFacing(name)) {
                return cameraEnumerator.createCapturer(name, null)
            }
        }
        // Fallback to any camera
        for (name in deviceNames) {
            if (!cameraEnumerator.isFrontFacing(name)) {
                return cameraEnumerator.createCapturer(name, null)
            }
        }
        return null
    }

    fun createPeerConnection(remotePeerId: String): PeerConnection? {
        val factory = peerConnectionFactory ?: return null
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun2.l.google.com:19302").createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // Security: enforce encryption
            enableDtlsSrtp = true
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peerConnection = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                Log.d(TAG, "Signaling state: $state")
            }

            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "ICE connection state: $state")
                state?.let { listener.onConnectionStateChange(it) }
                if (state == PeerConnection.IceConnectionState.DISCONNECTED ||
                    state == PeerConnection.IceConnectionState.FAILED ||
                    state == PeerConnection.IceConnectionState.CLOSED
                ) {
                    listener.onCallDisconnected()
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                Log.d(TAG, "ICE gathering: $state")
            }

            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate?.let {
                    listener.onIceCandidate(it)
                }
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {
                stream?.let { listener.onRemoteStream(it) }
            }
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(channel: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                // Handle Unified Plan track events
                val remoteStream = MediaStream()
                streams?.forEach { s ->
                    s.videoTracks.forEach { t -> remoteStream.addTrack(t) }
                    s.audioTracks.forEach { t -> remoteStream.addTrack(t) }
                }
                if (remoteStream.videoTracks.isNotEmpty() || remoteStream.audioTracks.isNotEmpty()) {
                    listener.onRemoteStream(remoteStream)
                }
            }
        })

        // Add local tracks to peer connection
        localAudioTrack?.let { peerConnection?.addTrack(it) }
        localVideoTrack?.let { peerConnection?.addTrack(it) }

        return peerConnection
    }

    fun createOffer(): JSONObject? {
        val pc = peerConnection ?: return null
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }
        pc.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {
                sdp?.let {
                    pc.setLocalDescription(SimpleSdpObserver(), it)
                    val offerJson = JSONObject()
                    offerJson.put("type", it.type.canonicalForm())
                    offerJson.put("sdp", it.description)
                    // Post to main thread to notify listener
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        listener.onIceCandidate(IceCandidate("", 0, ""))
                    }
                }
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Create offer failed: $error")
            }
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "Set local description failed: $error")
            }
        }, constraints)
        // Return null here — actual offer delivered via a callback pattern
        // The caller should use getLocalDescription() after setLocalDescription completes
        return null
    }

    /**
     * Get the current local description as JSONObject after createOffer/setLocalDescription.
     */
    fun getLocalDescription(): JSONObject? {
        val sdp = peerConnection?.localDescription ?: return null
        return JSONObject().apply {
            put("type", sdp.type.canonicalForm())
            put("sdp", sdp.description)
        }
    }

    fun setRemoteDescription(sdpJson: JSONObject) {
        val type = when (sdpJson.optString("type")) {
            "offer" -> SessionDescription.Type.OFFER
            "answer" -> SessionDescription.Type.ANSWER
            else -> return
        }
        val sdp = sdpJson.getString("sdp")
        peerConnection?.setRemoteDescription(SimpleSdpObserver(), SessionDescription(type, sdp))
    }

    fun addIceCandidate(candidateJson: JSONObject) {
        val sdpMid = candidateJson.optString("sdpMid", "")
        val sdpMLineIndex = candidateJson.optInt("sdpMLineIndex", 0)
        val sdp = candidateJson.getString("candidate")
        peerConnection?.addIceCandidate(IceCandidate(sdpMid, sdpMLineIndex, sdp))
    }

    fun setLocalVideoSink(sink: ProxyVideoSink?) {
        localVideoSink = sink
        localVideoTrack?.addSink(sink)
    }

    fun toggleAudio(mute: Boolean) {
        localAudioTrack?.enabled = !mute
    }

    fun toggleVideo(off: Boolean) {
        localVideoTrack?.enabled = !off
        if (off) {
            videoCapturer?.stopCapture()
        } else {
            try {
                videoCapturer?.startCapture(1280, 720, 30)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to restart capture", e)
            }
        }
    }

    fun getPeerConnection(): PeerConnection? = peerConnection

    fun createAnswer() {
        val pc = peerConnection ?: return
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }
        pc.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {
                sdp?.let {
                    pc.setLocalDescription(SimpleSdpObserver(), it)
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        val localDesc = pc.localDescription ?: return@postDelayed
                        val answerJson = JSONObject().apply {
                            put("type", localDesc.type.canonicalForm())
                            put("sdp", localDesc.description)
                        }
                        listener.onAnswerCreated(answerJson)
                    }, 1000)
                }
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Create answer failed: $error")
            }
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "Set local desc failed: $error")
            }
        }, constraints)
    }

    fun cleanup() {
        videoCapturer?.stopCapture()
        videoCapturer?.dispose()
        surfaceTextureHelper?.dispose()
        localVideoSink = null
        peerConnection?.close()
        peerConnection = null
        localAudioTrack = null
        localVideoTrack = null
        localStream = null
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
    }

    class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {
            Log.e(TAG, "SDP create failed: $error")
        }
        override fun onSetFailure(error: String?) {
            Log.e(TAG, "SDP set failed: $error")
        }
    }

    companion object {
        private const val TAG = "WebRTCClient"
    }
}

/**
 * Proxy sink for routing video frames to the correct SurfaceViewRenderer.
 */
class ProxyVideoSink : VideoSink {
    var target: VideoSink? = null

    override fun onFrame(frame: VideoFrame) {
        target?.onFrame(frame)
    }
}
