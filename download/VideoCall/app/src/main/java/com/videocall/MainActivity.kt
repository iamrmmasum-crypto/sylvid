package com.videocall

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.videocall.databinding.ActivityMainBinding

/**
 * Lobby screen. Shows online peers and lets the user initiate calls.
 */
class MainActivity : AppCompatActivity(), SignalingClient.SignalingListener {

    private lateinit var binding: ActivityMainBinding
    private lateinit var peerAdapter: PeerAdapter
    private val peers = mutableListOf<SignalingClient.Peer>()
    private var signalingClient: SignalingClient? = null
    private var myId: String? = null
    private var isRegistered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Protect lobby from screenshots too
        ScreenProtection.activate(this)

        // Peer list
        peerAdapter = PeerAdapter(peers) { peer ->
            startCall(peer.id, peer.username, false, null)
        }
        binding.peerList.apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = peerAdapter
        }

        // Server URL config
        val prefs = getSharedPreferences("videocall", MODE_PRIVATE)
        val savedUrl = prefs.getString("server_url", "http://10.0.2.2:3003")
        binding.serverUrlInput.setText(savedUrl)

        // Join button
        binding.btnJoin.setOnClickListener { attemptJoin() }
        binding.nameInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) attemptJoin()
            true
        }

        // Save server URL
        binding.serverUrlInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                saveServerUrl()
                return@setOnEditorActionListener true
            }
            false
        }
    }

    private fun saveServerUrl() {
        val url = binding.serverUrlInput.text.toString().trim()
        if (url.isNotBlank()) {
            getSharedPreferences("videocall", MODE_PRIVATE).edit()
                .putString("server_url", url)
                .apply()
            Toast.makeText(this, "Server URL saved", Toast.LENGTH_SHORT).show()
        }
    }

    private fun attemptJoin() {
        val name = binding.nameInput.text.toString().trim()
        if (name.isBlank()) {
            Toast.makeText(this, "Enter your name", Toast.LENGTH_SHORT).show()
            return
        }

        saveServerUrl()
        val serverUrl = binding.serverUrlInput.text.toString().trim()
        if (serverUrl.isBlank()) {
            Toast.makeText(this, "Enter server URL", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnJoin.isEnabled = false
        binding.btnJoin.text = "Joining..."

        signalingClient = SignalingClient(serverUrl, this)
        signalingClient?.connect()

        // Register after a short delay to ensure connection
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            signalingClient?.register(name)
        }, 500)
    }

    private fun startCall(
        targetId: String,
        targetName: String,
        isIncoming: Boolean,
        offerJson: String?
    ) {
        val intent = Intent(this, CallActivity::class.java).apply {
            putExtra(CallActivity.EXTRA_TARGET_ID, targetId)
            putExtra(CallActivity.EXTRA_TARGET_NAME, targetName)
            putExtra(CallActivity.EXTRA_IS_INCOMING, isIncoming)
            if (offerJson != null) putExtra(CallActivity.EXTRA_INCOMING_OFFER, offerJson)
        }
        startActivity(intent)
    }

    // ===== SignalingListener =====

    override fun onRegistered(id: String) {
        myId = id
        isRegistered = true
        runOnUiThread {
            binding.lobbyGroup.visibility = View.GONE
            binding.onlineGroup.visibility = View.VISIBLE
            binding.myIdText.text = "ID: ${id.take(12)}..."
        }
    }

    override fun onPeerList(newPeers: List<SignalingClient.Peer>) {
        runOnUiThread {
            peers.clear()
            peers.addAll(newPeers)
            peerAdapter.notifyDataSetChanged()
            binding.peerCount.text = "${peers.size} online"
            binding.emptyState.visibility = if (peers.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    override fun onIncomingCall(fromId: String, fromName: String, offer: org.json.JSONObject) {
        runOnUiThread {
            startCall(fromId, fromName, true, offer.toString())
        }
    }

    override fun onCallAnswered(answer: org.json.JSONObject) {}
    override fun onIceCandidate(candidate: org.json.JSONObject) {}
    override fun onCallRejected() {}
    override fun onCallEnded() {}
    override fun onConnected() {}
    override fun onDisconnected() {
        runOnUiThread {
            Toast.makeText(this, "Disconnected from server", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        signalingClient?.disconnect()
    }
}
