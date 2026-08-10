package com.videocall

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

/**
 * Socket.io signaling client.
 * Handles peer discovery, call offer/answer exchange, and ICE candidate relay.
 *
 * The signaling server does NOT see or touch media — it only routes
 * session descriptions and ICE candidates. All media flows P2P
 * through DTLS-SRTP (enforced by WebRTC, cannot be disabled).
 */
class SignalingClient(
    private val serverUrl: String,
    private val listener: SignalingListener
) {
    interface SignalingListener {
        fun onRegistered(myId: String)
        fun onPeerList(peers: List<Peer>)
        fun onIncomingCall(fromId: String, fromName: String, offer: JSONObject)
        fun onCallAnswered(answer: JSONObject)
        fun onIceCandidate(candidate: JSONObject)
        fun onCallRejected()
        fun onCallEnded()
        fun onConnected()
        fun onDisconnected()
    }

    data class Peer(val id: String, val username: String)

    private var socket: Socket? = null

    fun connect() {
        try {
            val options = IO.Options().apply {
                transports = arrayOf("websocket")
                reconnection = true
                reconnectionAttempts = Int.MAX_VALUE
                reconnectionDelay = 1000
                timeout = 30000
            }
            socket = IO.socket(serverUrl, options)
        } catch (e: URISyntaxException) {
            Log.e(TAG, "Invalid server URL: $serverUrl", e)
            return
        }

        socket?.let { s ->
            s.on(Socket.EVENT_CONNECT) {
                Log.d(TAG, "Connected to signaling server")
                listener.onConnected()
            }

            s.on("registered") { args ->
                val data = args[0] as JSONObject
                val id = data.getString("id")
                Log.d(TAG, "Registered with ID: $id")
                listener.onRegistered(id)
            }

            s.on("peer-list") { args ->
                val data = args[0] as JSONObject
                val peersArray = data.getJSONArray("peers")
                val peers = mutableListOf<Peer>()
                for (i in 0 until peersArray.length()) {
                    val p = peersArray.getJSONObject(i)
                    peers.add(Peer(p.getString("id"), p.getString("username")))
                }
                listener.onPeerList(peers)
            }

            s.on("incoming-call") { args ->
                val data = args[0] as JSONObject
                listener.onIncomingCall(
                    data.getString("fromId"),
                    data.getString("fromName"),
                    data.getJSONObject("offer")
                )
            }

            s.on("call-answered") { args ->
                val data = args[0] as JSONObject
                listener.onCallAnswered(data.getJSONObject("answer"))
            }

            s.on("ice-candidate") { args ->
                val data = args[0] as JSONObject
                listener.onIceCandidate(data.getJSONObject("candidate"))
            }

            s.on("call-rejected") {
                Log.d(TAG, "Call rejected")
                listener.onCallRejected()
            }

            s.on("call-ended") {
                Log.d(TAG, "Call ended by remote")
                listener.onCallEnded()
            }

            s.on(Socket.EVENT_DISCONNECT) {
                Log.d(TAG, "Disconnected from signaling server")
                listener.onDisconnected()
            }

            s.connect()
        }
    }

    fun register(username: String) {
        socket?.emit("register", JSONObject().put("username", username))
    }

    fun sendOffer(targetId: String, offer: JSONObject) {
        socket?.emit("call-offer", JSONObject().apply {
            put("targetId", targetId)
            put("offer", offer)
        })
    }

    fun sendAnswer(targetId: String, answer: JSONObject) {
        socket?.emit("call-answer", JSONObject().apply {
            put("targetId", targetId)
            put("answer", answer)
        })
    }

    fun sendIceCandidate(targetId: String, candidate: JSONObject) {
        socket?.emit("ice-candidate", JSONObject().apply {
            put("targetId", targetId)
            put("candidate", candidate)
        })
    }

    fun rejectCall(targetId: String) {
        socket?.emit("call-rejected", JSONObject().put("targetId", targetId))
    }

    fun endCall(targetId: String) {
        socket?.emit("call-ended", JSONObject().put("targetId", targetId))
    }

    fun disconnect() {
        socket?.disconnect()
        socket = null
    }

    companion object {
        private const val TAG = "SignalingClient"
    }
}
