package com.sylvid.app;

import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.PermissionRequest;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configure WebView for WebRTC support
        getWindow().getDecorView().post(() -> {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                // Enable WebRTC-specific settings
                webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
                webView.getSettings().setDomStorageEnabled(true);
                webView.getSettings().setJavaScriptEnabled(true);
                webView.getSettings().setAllowFileAccess(true);

                // Handle WebRTC permission requests (camera, mic)
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        // Auto-grant WebRTC permissions for camera and mic
                        // The Android permissions are already declared in manifest
                        runOnUiThread(() -> request.grant(request.getResources()));
                    }
                });
            }
        });
    }
}
