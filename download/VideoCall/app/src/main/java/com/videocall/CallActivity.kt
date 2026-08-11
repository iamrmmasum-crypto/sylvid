package com.videocall

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.videocall.databinding.ActivityCallBinding
import org.webrtc.*

/**
 * Full-screen call activity with OS-level screen protection.
 * FLAG_SECURE prevents ALL forms of screen capture at the OS level.
 */
class CallActivity : AppCompatActivity(), SignalingClient.SignalingListener,
    WebRTCClient.WebRTCListener {

    companion object {
        private const val TAG = "CallActivity"
        const val EXTRA_TARGET_ID = "target_id"
        const val EXTRA_TARGET_NAME = "target_name"
        const val EXTRA_IS_INCOMING = "is_incoming"
        const val EXTRA_INCOMING_OFFER = "incoming_offer"
        private const val PERMISSION_REQUEST = 100
    }

    private lateinit var binding: ActivityCallBinding
    private var signalingClient: SignalingClient? = null
    private var webRTCClient: WebRTCClient? = null
    private var remotePeerId: String? = null
    private var isIncomingCall = false
    private var incomingOffer: org.json.JSONObject? = null
    private var isMuted = false
    private var isCameraOff = false
    private val localVideoSink = ProxyVideoSink()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // === OS-LEVEL SCREEN PROTECTION ===
        // Blocks: screenshots (Power+VolDown), screen recording (all apps),
        // recent apps thumbnail, and any OS-level frame capture.
        // Only a rooted device with custom ROM can bypass this.
        ScreenProtection.activate(this)

        // Keep screen on during call
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        binding = ActivityCallBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Block back button — force user to use End Call
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { /* no-op */ }
        })

        // Extract call parameters
        remotePeerId = intent.getStringExtra(EXTRA_TARGET_ID)
        val targetName = intent.getStringExtra(EXTRA_TARGET_NAME) ?: "Unknown"
        isIncomingCall = intent.getBooleanExtra(EXTRA_IS_INCOMING, false)
        val offerStr = intent.getStringExtra(EXTRA_INCOMING_OFFER)
        if (offerStr != null) {
            try { incomingOffer = org.json.JSONObject(offerStr) } catch (_: Exception) {}
        }

        binding.remoteName.text = targetName
        binding.statusText.text = "Connecting..."

        // Request permissions or initialize directly
        if (hasPermissions()) {
            setupCall()
        } else {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO),
                PERMISSION_REQUEST
            )
        }

        // Mute toggle
        binding.btnMute.setOnClickListener {
            isMuted = !isMuted
            webRTCClient?.toggleAudio(isMuted)
            binding.btnMute.setImageResource(
                if (isMuted) R.drawable.ic_mic_off else R.drawable.ic_mic_on
            )
            binding.btnMute.setBackgroundResource(
                if (isMuted) R.drawable.bg_btn_danger else R.drawable.bg_btn_control
            )
        }

        // Camera toggle
        binding.btnCamera.setOnClickListener {
            isCameraOff = !isCameraOff
            webRTCClient?.toggleVideo(isCameraOff)
            binding.btnCamera.setImageResource(
                if (isCameraOff) R.drawable.ic_cam_off else R.drawable.ic_cam_on
            )
            binding.btnCamera.setBackgroundResource(
                if (isCameraOff) R.drawable.bg_btn_danger else R.drawable.bg_btn_control
            )
        }

        // End call
        binding.btnEndCall.setOnClickListener { endCall() }

        // Incoming call UI
        if (isIncomingCall) {
            binding.statusText.text = "Incoming call..."
            binding.btnAcceptGroup.visibility = View.VISIBLE
            binding.btnAccept.setOnClickListener {
                binding.btnAcceptGroup.visibility = View.GONE
                setupCall()
            }
            binding.btnRejectIncoming.setOnClickListener {
                signalingClient?.rejectCall(remotePeerId!!)
                finish()
            }
        } else {
            binding.btnAcceptGroup.visibility = View.GONE
        }
    }

    private fun hasPermissions(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST) {
            if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                setupCall()
            } else {
                Toast.makeText(this, "Camera and microphone permissions required", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    private fun setupCall() {
        binding.statusText.text = "Connecting..."

        webRTCClient = WebRTCClient(this, this)
        webRTCClient?.initialize()

        val prefs = getSharedPreferences("videocall", MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "http://10.0.2.2:3003")!!
        signalingClient = SignalingClient(serverUrl, this)
        signalingClient?.connect()
    }

    // ===== SignalingListener =====

    override fun onRegistered(myId: String) {
        Log.d(TAG, "Registered: $myId")
        val targetId = remotePeerId ?: return

        if (!isIncomingCall) {
            // Outgoing call
            binding.statusText.text = "Calling..."
            webRTCClient?.createPeerConnection(targetId)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                val offer = webRTCClient?.getLocalDescription()
                if (offer != null) {
                    signalingClient?.sendOffer(targetId, offer)
                    binding.statusText.text = "Ringing..."
                }
            }, 1500)
        } else {
            // Incoming call — accept
            val offer = incomingOffer ?: return
            webRTCClient?.createPeerConnection(targetId)
            webRTCClient?.setRemoteDescription(offer)
            webRTCClient?.createAnswer()
        }
    }

    override fun onPeerList(peers: List<SignalingClient.Peer>) {}

    override fun onIncomingCall(fromId: String, fromName: String, offer: org.json.JSONObject) {
        signalingClient?.rejectCall(fromId)
    }

    override fun onCallAnswered(answer: org.json.JSONObject) {
        Log.d(TAG, "Call answered")
        binding.statusText.text = "Connecting..."
        webRTCClient?.setRemoteDescription(answer)
    }

    override fun onIceCandidate(candidate: org.json.JSONObject) {
        val targetId = remotePeerId ?: return
        signalingClient?.sendIceCandidate(targetId, candidate)
    }

    override fun onCallRejected() {
        runOnUiThread {
            Toast.makeText(this, "Call rejected", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onCallEnded() {
        runOnUiThread {
            Toast.makeText(this, "Call ended", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onConnected() {}
    override fun onDisconnected() {
        runOnUiThread { endCall() }
    }

    // ===== WebRTCListener =====

    override fun onLocalStream(stream: MediaStream) {
        runOnUiThread {
            localVideoSink.target = binding.localVideoView
            webRTCClient?.setLocalVideoSink(localVideoSink)
            binding.localVideoView.setMirror(true)
        }
    }

    override fun onRemoteStream(stream: MediaStream) {
        runOnUiThread {
            binding.remoteVideoView.visibility = View.VISIBLE
            binding.statusText.visibility = View.GONE
            stream.videoTracks.firstOrNull()?.addSink(binding.remoteVideoView)
        }
    }

    override fun onIceCandidate(candidate: IceCandidate) {
        val json = org.json.JSONObject().apply {
            put("sdpMid", candidate.sdpMid)
            put("sdpMLineIndex", candidate.sdpMLineIndex)
            put("candidate", candidate.sdp)
        }
        remotePeerId?.let { signalingClient?.sendIceCandidate(it, json) }
    }

    override fun onAnswerCreated(answer: org.json.JSONObject) {
        remotePeerId?.let { signalingClient?.sendAnswer(it, answer) }
    }

    override fun onConnectionStateChange(state: PeerConnection.IceConnectionState) {
        runOnUiThread {
            when (state) {
                PeerConnection.IceConnectionState.CONNECTED -> {
                    binding.statusText.visibility = View.GONE
                }
                PeerConnection.IceConnectionState.FAILED -> {
                    Toast.makeText(this, "Connection failed", Toast.LENGTH_SHORT).show()
                    endCall()
                }
                else -> {}
            }
        }
    }

    override fun onCallDisconnected() {
        runOnUiThread { finish() }
    }

    private fun endCall() {
        remotePeerId?.let { signalingClient?.endCall(it) }
        webRTCClient?.cleanup()
        signalingClient?.disconnect()
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        webRTCClient?.cleanup()
        signalingClient?.disconnect()
    }
}
