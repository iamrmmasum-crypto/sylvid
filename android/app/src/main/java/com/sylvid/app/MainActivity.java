package com.sylvid.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERM_REQ = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestPermissions();
        wrapWebChromeClientForWebRTC();
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] perms = {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            };
            boolean need = false;
            for (String p : perms) {
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                    need = true;
                    break;
                }
            }
            if (need) ActivityCompat.requestPermissions(this, perms, PERM_REQ);
        }
    }

    /**
     * Wraps Capacitor's WebChromeClient to auto-grant WebRTC permissions
     * (camera, microphone) requested by JavaScript inside the WebView.
     * We delegate every method to the original client so Capacitor's bridge
     * (onJsPrompt) and plugins keep working.
     */
    private void wrapWebChromeClientForWebRTC() {
        getWindow().getDecorView().post(() -> {
            WebView wv = getBridge().getWebView();
            if (wv == null) return;
            final WebChromeClient orig = wv.getWebChromeClient();
            if (orig == null) return;

            wv.setWebChromeClient(new WebChromeClient() {
                // ---- WebRTC: auto-grant all permission requests ----
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }

                // ---- Delegate to Capacitor's original client ----
                @Override public boolean onJsPrompt(WebView v, String u, String m, String d, JsPromptResult r) { return orig.onJsPrompt(v, u, m, d, r); }
                @Override public boolean onJsAlert(WebView v, String u, String m, JsResult r) { return orig.onJsAlert(v, u, m, r); }
                @Override public boolean onJsConfirm(WebView v, String u, String m, JsResult r) { return orig.onJsConfirm(v, u, m, r); }
                @Override public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> cb, FileChooserParams p) { return orig.onShowFileChooser(v, cb, p); }
                @Override public void onProgressChanged(WebView v, int p) { orig.onProgressChanged(v, p); }
                @Override public void onReceivedTitle(WebView v, String t) { orig.onReceivedTitle(v, t); }
                @Override public void onReceivedIcon(WebView v, android.graphics.Bitmap icon) { orig.onReceivedIcon(v, icon); }
            });
        });
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        if (req == PERM_REQ && getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().reload();
        }
    }
}
