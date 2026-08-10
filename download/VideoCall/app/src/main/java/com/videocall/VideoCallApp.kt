package com.videocall

import android.app.Application

class VideoCallApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize WebRTC (must happen before any activity)
        org.webrtc.PeerConnectionFactory.initialize(
            org.webrtc.PeerConnectionFactory.InitializationOptions
                .builder(this)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
    }
}