# MAKAN AI Music Player

A fast, dependable **Windows** music player for big libraries (thousands of songs), built with Electron and plain JavaScript.
Made by Makan — https://makanlab.tech/ — contact: makan20042002@gmail.com

**Version 1** (internal version 1.0.0)

## Features
- Library of 3,000–12,000+ tracks: SQLite database, folder watching, fast search and sorting
- MP3, FLAC, WAV, AAC, M4A, OGG Vorbis, Opus
- 10-band equalizer, ReplayGain, gapless playback, crossfade
- True shuffle (every song once per cycle), queue, playlists, mini player, tray, media keys
- Sleep timer with a slow fade-out
- Windows integration: right-click → Open with, "Play with MAKAN AI Music Player" on folders,
  select thousands of files in Explorer and press Enter to open them all (like Windows Media Player),
  taskbar Previous / Play / Next buttons
- Synced lyrics (LRC / SRT / VTT / ASS)

## Download
Get the installer (`MAKAN-Music-Player-v1-setup.exe`) or the portable file (`MAKAN-Music-Player-v1-portable.exe`)
from the **Releases** page. The portable file has no Explorer (right-click) integration.

## Build from source
Needs Node.js 22+ on Windows.
```
npm install
node scripts/build-native-helper.js
npm run dist:all
```
The FFmpeg runtime DLLs (`avcodec`, `avformat`, `avutil`, `swresample` in `desktop/bin/`) are not stored in this repository
because of their size. Copy them from a Release build into `desktop/bin/` before building.

## Tests
```
npm run test:unit      # quick
npm test               # everything (20–30 minutes)
```

## More
- `docs/WINDOWS_INTEGRATION.md` — how the Explorer integration works
- `HANDOFF.md` — architecture notes
- `THIRD_PARTY_LICENSES.md` — open-source components (FFmpeg is LGPL)
- The Android app in `mobile/` is an experiment and not part of v1.
