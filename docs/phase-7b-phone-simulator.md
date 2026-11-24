# Phase 7b — Phone call simulator for the live demo

Built after Phase 7. A mobile-first page at `/demo/phone` in the web app that mimics a real smartphone, so the
live demo can show a scam call, the follow-up SMS, and SAQR blocking the link.

1. **Idle screen.** A realistic lock screen with time, date and wallpaper, full-screen with no browser-chrome feel
   (a web app manifest with `display: standalone`, so it can be added to the home screen). A one-time
   "Tap to arm demo" overlay comes first, because browsers block audio until the user taps.
2. **Trigger.** The dashboard has a "Trigger scam call" button. A WebSocket or Server-Sent Events channel from the
   FastAPI backend makes the phone page react within 1 second. The phone and laptop share a Wi-Fi network or
   hotspot, so the dev server listens on `0.0.0.0`, and the README explains opening
   `http://<laptop-LAN-IP>:5173/demo/phone`.
3. **Incoming call screen.** Caller "Unknown" with a random +971 number (never a real police or government
   number). A looping ringtone (`data/demo/ringtone.mp3`), Answer and Decline buttons, and a slide animation.
4. **In-call screen.** Answer plays `data/demo/saqr_scam_call.mp3` on the loudspeaker, with a running call timer,
   mute and speaker icons, and End call. The call ends automatically when the audio finishes.
5. **SMS.** Two seconds later an SMS notification banner slides down from the top with a ping
   (`data/demo/sms.mp3`). Sender: a random number. Text in Arabic and English: "Abu Dhabi Police: unpaid fine
   AED 3,000. Pay now to avoid impound: <demo scam URL>". Tapping it opens an SMS thread view with a tappable link.
6. **Protection interstitial.** Tapping the link shows the SAQR interstitial instead of the scam page: a red
   shield, "SAQR blocked this page" in English and Arabic, the impersonated brand, the score, the top 3 reasons
   from the real ScanResult (`/api/scan` on the demo URL), "Go back to safety", and a small "View details" link.
   It plays `data/demo/blocked.mp3`.
7. **Dashboard link-up.** At the same moment, an event tells the dashboard to open that case and highlight
   "First seen X hours before this call", using the real `first_seen` timestamp.
8. **Reset.** A "Reset" button on the dashboard returns the phone to the idle screen.

A small "Demo simulation" label sits in a corner of the phone page. Everything stays local; nothing is sent
outside the laptop. If any audio file in `data/demo/` is missing, the page falls back silently and the flow keeps
working.
