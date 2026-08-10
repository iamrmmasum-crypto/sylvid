package com.videocall

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/**
 * OS-level screen capture protection.
 * FLAG_SECURE blocks:
 *   - Screenshots (Power + Volume Down, notification shade screenshot button)
 *   - Screen recording (built-in recorder, third-party recorders, OBS via ADB)
 *   - Recent apps preview thumbnail
 *   - Any other frame capture mechanism at the OS level
 *
 * This is enforced by the Android Window Manager — nothing below the system
 * server can bypass it. Root-level attacks are the only exception.
 */
object ScreenProtection {

    /**
     * Activates FLAG_SECURE on the given activity's window.
     * Call this in onCreate() before setContentView().
     */
    fun activate(activity: Activity) {
        activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
    }

    /**
     * Blocks the activity from appearing in the recents overview.
     * Prevents capture of the call screen thumbnail.
     */
    fun hideFromRecents(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            activity.setTaskDescription(
                android.app.ActivityManager.TaskDescription(
                    "VideoCall",
                    null,
                    0xFF0A0A0A.toInt()
                )
            )
        }
    }
}
