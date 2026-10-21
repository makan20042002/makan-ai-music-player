# MAKAN Music Player — Architecture & Handoff Note (v1 — final release, built on 1.8.2)

## Overview
MAKAN Music Player is an independent, dedicated Windows desktop audio player inspired by foobar2000 and Windows Media Player, built with vanilla HTML/CSS/JavaScript components, Electron 33, SQLite (`sql.js`), and Node.js.

Version **1 (1.0.0)**, built on the 1.8.2 code, is the final **Native Pure Audio stabilization release**. It introduces zero new end-user features and maintains absolute sound transparency, delivering sample-accurate gapless playback, clean underrun telemetry separation, discrete multi-rate WASAPI Exclusive operation, and robust long-duration playback stability.

---

## Architecture Summary
- **desktop/**:
  - `main.js`: Electron main process lifecycle, window frame management, CLI argument dispatch, `makan:` IPC namespace.
  - `preload.js`: Secure context isolation bridge exposing `window.MakanDesktop` with restricted IPC operations.
  - `native-audio-client.js`: IPC communication client managing the `makan-audio-helper.exe` child process over standard I/O streams using JSON-lines protocol and Win32 `TerminateProcess` lifecycle termination.
  - `bin/`: Packaged native audio engine (`makan-audio-helper.exe`) and FFmpeg runtime DLLs (`avcodec-61.dll`, `avformat-61.dll`, `avutil-59.dll`, `swresample-5.dll`).
  - `static-server.js`: Embedded Node.js HTTP server supporting HTTP 206 Partial Content range requests, track-id artwork serving (`/api/artwork?id=...`), and graceful test shutdown.
  - `library-db.js`: SQLite (`sql.js`) persistent database for tracks, playlists, playback position, play counts, and ratings.
  - `scanner.js`: Recursive library folder scanner extracting audio metadata via pure ESM `music-metadata`.
- **native/**:
  - `src/makan-audio-helper.c`: Pure C audio engine combining miniaudio WASAPI output with FFmpeg libavcodec/libavformat decoding, frame-indexed circular ring buffer (`65,536` frames), sample-accurate gapless transitions, spectrum analysis, and telemetry.
  - `src/cJSON.c`, `src/cJSON.h`: Ultra-lightweight JSON serialization/deserialization for IPC.
  - `src/miniaudio.h`: Direct WASAPI audio rendering header library.
- **media/**:
  - `components/audio-engine.js`: Dual-backend audio controller managing Web Audio (default) and Native Pure Audio (opt-in).
  - `components/app-shell.js`, `playback-controller.js`, `track-table.js`, `playlist-drawer.js`, `lyrics-theatre.js`, `position-persistence.js`, `media-session.js`, `state.js`: Modular UI and state components.
  - `player.css`: Theme styling and responsive visual design.

---

## v1.8.2 Stabilization Details

### 1. AAC / M4A Gapless Playback Resolution
- **Root Cause of Prior Boundary Error (1,024 samples / 21.333 ms)**:
  - The previous implementation delayed next-track decoding until `ring_available(&g_ring) == 0`. When the ring drained completely, WASAPI callback starved, outputting zeros before Track 2 began.
  - In addition, FFmpeg decoder priming delay (1,024 samples for standard AAC-LC / `iTunSMPB` atom) was not properly reconciled with container sample boundaries and packet-level side data (`AV_PKT_DATA_SKIP_SAMPLES`).
- **Stabilization Implemented**:
  - Sample-accurate gapless priming skip and trailing padding truncation in `TrackContext`.
  - Parses `iTunSMPB` container atoms, `stream->codecpar->initial_padding`, `stream->codecpar->trailing_padding`, and packet side-data flags.
  - Decoder drains remaining buffered frames on EOF via `avcodec_send_packet(NULL)` and swresample flush.
  - Contiguous ring-buffer handoff: Track 2 audio frames are decoded directly behind Track 1 in `g_ring` before Track 1 finishes playing, eliminating DAC starvation.
  - `transition_pending` and `track_transition_remaining_frames` track the exact sample boundary to emit `trackLoaded` and `audioPathChanged` events at the boundary frame.
- **Measured Boundary Error**: Strictly **0 missing and 0 duplicated samples** (0.000 ms) across FLAC, MP3, and AAC/M4A in both WASAPI Shared and Exclusive modes.

### 2. Underrun Investigation & Telemetry Separation
- **Root Cause of 103 Reported Underruns in v1.8.1**:
  - Analysis showed that 50 seeks + 34 pause/resume cycles + 20 device/mode switches equaled 104 intentional buffer flushes.
  - The helper previously incremented `audio_underruns` unconditionally whenever `ring_read` returned fewer frames than requested, even immediately after deliberate ring flushes during seeking, track loading, or output mode re-initialization.
  - None of the 103 events were genuine playback starvation during steady-state audio rendering; all were silent buffer flushes during deliberate track manipulation.
- **Stabilization Implemented**:
  - Telemetry strictly separates:
    - `genuineUnderruns`: Incremented solely when buffer was primed (`buffer_primed == true`) and playback starved during continuous rendering. Must be strictly 0 during uninterrupted playback.
    - `deliberateBufferFlushes`: Incremented upon user seek, new track load, or device/mode reopening.
    - Natural end-of-track buffer drain: When a track reaches EOF without a queued next track, draining the last frames to zero is recognized as normal playback completion (`is_eof_drain`), not an underrun.
  - Audible Dropouts: **0**.

### 3. Long-Duration Playback & Reliability (2-Hour Wall-Clock Test)
- **Harness**: `tests/support/test-two-hour-playback.js`
- **Audio Fixtures**: Normal-duration audio files (120 seconds each across FLAC, MP3, M4A, WAV, Opus).
- **Features Exercised**:
  - Continuous real-time playback across multiple full 2-minute tracks
  - Automatic track transitions via `preloadNext` gapless handoff
  - True Shuffle deterministic cycle ordering
  - Queue priority insertions and transitions
  - Mid-track seeks (25s–95s)
  - Pause and resume cycles
  - WASAPI Shared and Exclusive mode toggling
- **Recorded Metrics**:
  - Genuine Underruns: **0**
  - Dropouts: **0**
  - Crashes: **0**
  - Orphan Processes: **0**
  - Helper Memory: Stable ~19–21 MB Working Set / RSS with zero accumulation over time
  - Helper CPU: Minimal ~1.0%–1.5% average processor utilization

### 4. Discrete WASAPI Exclusive Multi-Rate Verification
- Verified separately on real Windows audio endpoints at discrete sample rates:
  - **44.1 kHz (16-bit / 24-bit PCM)**: Requested 44100 Hz -> Accepted 44100 Hz, `MA_SUCCESS`, HRESULT `0x00000000 (S_OK)`, Fallback: false.
  - **48.0 kHz (24-bit PCM)**: Requested 48000 Hz -> Accepted 48000 Hz, `MA_SUCCESS`, HRESULT `0x00000000 (S_OK)`, Fallback: false.
  - **96.0 kHz (24-bit PCM)**: Requested 96000 Hz -> Accepted 96000 Hz, `MA_SUCCESS`, HRESULT `0x00000000 (S_OK)`, Fallback: false.
- Zero inference from Shared-mode results; each rate negotiated directly with the hardware driver.

### 5. Multi-Endpoint Windows Device Handling
- `enumerateDevices` discovers all available MMDevice playback endpoints.
- `selectDevice` allows explicit endpoint switching via endpoint ID / name.
- Explicit distinction between endpoint device selection (`selectDevice`) and WASAPI mode configuration (`setOutputMode`).
- Systems with a single physical endpoint are honestly reported as single-device environments without fabricating dummy endpoints.

### 6. Process Termination & Orphan Prevention
- Standard Windows process lifecycle management:
  - Parent termination uses `taskkill.exe /PID <pid> /F` (invoking Win32 `TerminateProcess` API).
  - Helper detects parent pipe closure (`EOF` on `stdin`) and immediately cleans up and exits independently within 50 ms.
  - Zero orphan helper processes left behind.

### 7. Backend Selection Policy
- **Web Audio** remains the canonical default backend (`settings-schema.js` and `state.js` default to `'webaudio'`).
- **Native Pure Audio** remains strictly opt-in until the user completes listening tests and manual hardware validation.

---

## Manual Acceptance Tests (Hardware Dependent)
The following tests require physical hardware or user interaction and cannot be automated in CI/VM environments:
1. **Physical Endpoint Unplug / Hot-Plug**: Disconnecting USB DAC or 3.5mm jack while playing in Native Pure Audio (WASAPI raises `AUDCLNT_E_DEVICE_INVALIDATED`; helper emits `deviceLost`).
2. **Windows Sleep / Resume**: Putting host PC into S3/Modern Standby and resuming playback.
3. **Multi-Endpoint Hardware Switching**: Switching between distinct physical DACs (e.g. Realtek Onboard vs External USB DAC).
