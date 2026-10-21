# MAKAN Music Player - Android (Capacitor)

This folder is the Android app. It lives inside the player project folder, next to `index.html` and `media/`,
and shows the same web screens in a phone layout. It never changes the Windows app.
The phone app is STANDALONE: it plays the music stored on the phone. It does not need the PC.

## Needed on your PC (one time)
- Node.js (the same one you use for the player)
- Android Studio (latest). It brings its own Java, so you do not install Java yourself.
- A phone with "USB debugging" turned on (Settings -> Developer options), or an emulator made in Android Studio.

## Steps
1. Open PowerShell in this `mobile` folder.
2. `npm install`
3. `npm run sync`   (copies the player's web files into the Android app; run it again after every change to the player)
4. `npm run open`   (opens the Android project in Android Studio; wait for "Gradle sync" to finish)
5. In Android Studio press the green Run button, with your phone chosen at the top.

If something fails, copy the red error text and send it to me. `npx cap doctor` prints what is missing.

## What is in the app
- Phone layout: Songs / Playing / Lyrics / Menu bar, small player bar, full-screen player.
- Library: reads the music Android already knows about (MediaStore). First start: tap "Find music on this phone"
  and allow access to music. New songs: Menu -> "Look for new songs" (the app also looks once at every start).
- The library, playlists, play counts, study words, settings and lyrics are saved in the app's private folder
  (the same database code as the Windows app).
- Playing: the page plays the songs; the app answers /api/stream and /api/artwork itself (with seeking).
- Background: a notification player with Previous / Play-Pause / Next and the lock-screen player; music keeps
  playing with the screen off. The Back button goes back one step, and at the song list it moves the app to the background.
- Lyrics: shown and saved inside the app. Menu -> "Import lyrics files" takes .lrc / .txt files and matches them to
  songs by file name. Translating lyrics uses the same engines as Windows (free web, or your own Gemini key).
- Study words, listening stats, sound analysis, auto-mix: same code as Windows.
- Browser test: opening mobile/www/index.html through any local web server (not from the phone) shows 4 invented
  demo songs so the screens can be looked at without Android.

## Not done / not on the phone
- Playing songs from the PC over Wi-Fi (this app is standalone on purpose).
- Searching the web for song info, M3U import/export, writing tags back into the song files.
- Offline translation (ML Kit) and Whisper on the phone: "Make lyrics" runs the same in-page code as Windows and
  may be too heavy for a phone. Make lyrics on the PC and import the .lrc files.
- Reading .lrc files that lie next to the songs (Android does not allow it without the "all files" permission,
  which this app does not ask for). Use the import instead.

## Checked only on a PC (not on a phone)
`npm run test:mobile` in the project folder checks the phone database, library scan logic, lyrics, saving and the
build. The Android plugin, background playback, notification and real music files have NOT been run on a phone yet.
