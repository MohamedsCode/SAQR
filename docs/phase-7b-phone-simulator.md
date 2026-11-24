# Phase 7b — iPhone-style phone call simulator for the live demo

Built after Phase 7, not before.

**Goal.** A page at `/demo/phone`, opened on a real iPhone. When a teammate presses a button on the laptop
dashboard, the phone shows a realistic incoming call, plays the scam call, receives a scam SMS, and SAQR blocks
the link. No real phone call is made; everything runs locally.

## Look and feel

iOS-style, but every visual is built from scratch: no Apple logo, and no copied Apple wallpapers or icon files.

- **Font:** the system font stack (`-apple-system, "SF Pro Display", system-ui`), so it renders in the iPhone's
  native font.
- **iPhone fullscreen:** `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style:
  black-translucent`, `viewport-fit=cover`, safe-area insets, and a web app manifest with `display: standalone`,
  so it looks like a native app when added to the home screen from Safari.
- **Motion:** smooth spring-like CSS transitions; `navigator.vibrate` on Android (ignored on iPhone).
- **Label:** a tiny "Demo simulation" label in the top corner, 9px, low opacity.

## Flow

1. **Arm overlay.** On first open, a one-time "Tap to arm demo" overlay, because browsers block audio until the
   user taps.
2. **Lock screen.**
   - A large thin clock near the top, with the date above it.
   - A status bar: the time on the left; signal, Wi-Fi and battery icons drawn in SVG on the right.
   - A black Dynamic Island-style pill at the top centre.
   - Flashlight and camera circle buttons in the bottom corners, and the home indicator bar.
   - A soft gradient wallpaper made in CSS.
3. **Trigger.**
   - The dashboard gets a "Trigger scam call" button.
   - A WebSocket or Server-Sent Events channel from the FastAPI backend makes the phone react within 1 second.
   - The phone and laptop share a Wi-Fi network or hotspot, so the dev servers listen on `0.0.0.0`, and the
     README explains opening `http://<laptop-LAN-IP>:5173/demo/phone`.
4. **Incoming call screen.**
   - A full-screen blurred background.
   - "Unknown" in large text, with a random "+971 5X XXX XXXX" and "mobile" underneath. Never a real police or
     government number.
   - A "Remind Me" and "Message" row, plus a red Decline and a green Accept circle button.
   - The Dynamic Island expands slightly with a green phone icon.
   - The ringtone loops (`data/demo/ringtone.mp3`).
5. **In-call screen.**
   - Accept plays `data/demo/saqr_scam_call.mp3` on the loudspeaker.
   - The caller name and a running timer at the top.
   - A 3×2 grid of round translucent buttons (mute, keypad, speaker shown as active, add call, video,
     contacts) and a red End button.
   - When the audio finishes, the call ends automatically.
6. **SMS.**
   - Two seconds after the call ends, an iOS-style notification banner slides down with a ping
     (`data/demo/sms.mp3`). It is rounded and frosted, with "Messages · now", the sender number and a preview.
   - The text, in Arabic and English: "Abu Dhabi Police: unpaid fine AED 3,000. Pay now to avoid impound:
     <demo scam URL>".
   - Tapping it opens an iOS-style Messages thread: a header with the number, a grey incoming bubble and a
     blue tappable link.
7. **Block.**
   - Tapping the link shows the SAQR protection screen instead of the scam page.
   - The screen shows a red shield, "SAQR blocked this page" in English and Arabic, the impersonated brand, the
     score, and the top 3 reasons from the real ScanResult (`/api/scan` on the demo URL).
   - It has a "Go back to safety" button and a small "View details" link, and plays `data/demo/blocked.mp3`.
8. **Dashboard sync.** At the same moment, an event tells the dashboard to open that case and highlight
   "First seen X hours before this call", using the real `first_seen` timestamp.
9. **Reset.** A "Reset" button on the dashboard returns the phone to the lock screen.

If any audio file in `data/demo/` is missing, the page falls back silently and the flow keeps working. Nothing is
sent outside the laptop.
