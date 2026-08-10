# VideoCall ProGuard rules
-keepattributes *Annotation*
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-keep class com.videocall.** { *; }
-keepclassmembers class com.videocall.** { *; }
