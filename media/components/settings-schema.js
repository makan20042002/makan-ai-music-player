'use strict';
/**
 * media/components/settings-schema.js
 *
 * Single Canonical Settings Schema for MAKAN Music Player v1.6.1.
 * Unifies main-process defaults, settings loading, renderer state, controls,
 * folder watching, audio engine, playlists, and section resets.
 *
 * Provides safe migration & normalization for settings created by v1.5.x and v1.6.0.
 */

(function () {
  const CANONICAL_DEFAULTS = {
    // 1. Library & Folders
    folderWatching: true,
    allowDuplicatesInPlaylists: false,

    // 2. Playback
    gapless: true,
    crossfade: 0, // 0 to 15s (0 = Off / low-gap preloaded transition)
    resumeLongTracks: true,
    resumeThreshold: 900, // 60 to 7200s (default 15 minutes)

    // 3. Audio & Equalizer & ReplayGain & Native Pure Audio
    audioBackend: 'webaudio', // 'webaudio' | 'native'
    outputMode: 'shared', // 'shared' | 'exclusive'
    outputDevice: 'default', // 'default' or device ID
    bufferMode: 'default', // 'default' | 'lowLatency'
    replayGainMode: 'track', // 'off' | 'track' | 'album' | 'prevent_clipping'
    replayGainPreamp: 0.0, // clamped -15.0 to +15.0 dB
    replayGainPreampFallback: 0.0, // clamped -15.0 to +15.0 dB
    eqEnabled: true,
    eqPreset: 'flat', // 'flat' | 'rock' | 'pop' | 'jazz' | 'classical' | 'electronic' | 'vocal' | 'bass_boost' | 'treble_boost' | 'potplayer' | 'crystal' | 'custom'
    eqGains: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], // 10 bands clamped -12.0 to +12.0 dB
    eqPreamp: 0.0, // clamped -12.0 to +12.0 dB
    loudnessNormalizer: false, // PotPlayer-style dynamic range compressor & peak normalizer
    stereoWidth: 1.0, // 0.5 to 2.0 (1.0 = standard stereo; PotPlayer mode keeps 1.0 since v1.9)
    normalizerStrength: 'strong', // gentle | normal | strong (v1.9 loudness normalizer)
    soundMode: 'off', // MAKAN Sound: off | natural | clear | power
    potPlayerMode: false, // 1-click PotPlayer High-Fidelity Audio Engine mode

    // 4. Appearance & Lyrics
    appTheme: 'dark', // 'dark' | 'light' (Platinum Blue) | 'auto' (follow Windows)
    visualizerTheme: 'cyan', // 'cyan' | 'aurora' | 'rainbow' | 'custom' | 'sunset' | 'ocean' | 'gold' | 'violet' | 'candy'
    visualizerStyle: 'bars', // 'bars' | 'mirror' | 'area'
    reducedMotion: false,
    lyricMode: 'bilingual', // 'original' | 'translation' | 'bilingual' | 'split'
    soundReactiveLyrics: true,
    reactiveIntensity: 1.0, // clamped 0.1 to 3.0
    lyricsFontFamily: 'Vazirmatn, Segoe UI, sans-serif',
    lyricsOriginalSize: 20, // clamped 12 to 36 px
    lyricsTranslationSize: 16, // clamped 10 to 28 px
    lyricsInactiveColor: 'rgba(255, 255, 255, 0.42)',
    lyricsActiveColor: '#ffffff',
    lyricsTranslationColor: '#cbd5e1',
    lyricsEffect: 'none', // 'none' | 'glow' | 'wave' | 'particle'
    lyricsBackground: 'glass', // 'glass' | 'dark' | 'transparent' | 'gradient'
    lyricsGlowIntensity: 1.0, // clamped 0.0 to 3.0
    lyricsColorStyle: 'solid', // 'solid' | 'rainbow' | 'sunset' | 'ocean' | 'neon' | 'fire' | 'aurora' | 'candy' | 'gold' | 'ice'
    lyricsColorSpeed: 8, // seconds for one colour cycle, clamped 2 to 30
    lyricsTranslationFont: 'Vazirmatn, Segoe UI, sans-serif',

    // 5. Windows & Tray
    alwaysOnTop: false,
    miniPlayerAlwaysOnTop: false,
    minimizeToTray: false,
    closeToTray: false
  };

  const SECTION_KEYS = {
    library: ['folderWatching', 'allowDuplicatesInPlaylists'],
    playback: ['gapless', 'crossfade', 'resumeLongTracks', 'resumeThreshold'],
    audio: ['audioBackend', 'outputMode', 'outputDevice', 'bufferMode', 'replayGainMode', 'replayGainPreamp', 'replayGainPreampFallback', 'eqEnabled', 'eqPreset', 'eqGains', 'eqPreamp', 'loudnessNormalizer', 'normalizerStrength', 'stereoWidth', 'potPlayerMode', 'soundMode'],
    appearance: ['appTheme', 'visualizerTheme', 'visualizerStyle', 'reducedMotion'],
    lyrics: [
      'lyricMode', 'soundReactiveLyrics', 'reactiveIntensity', 'lyricsFontFamily',
      'lyricsOriginalSize', 'lyricsTranslationSize', 'lyricsInactiveColor',
      'lyricsActiveColor', 'lyricsTranslationColor', 'lyricsBackground', 'lyricsEffect',
      'lyricsGlowIntensity', 'lyricsColorStyle', 'lyricsColorSpeed', 'lyricsTranslationFont'
    ],
    windows: ['alwaysOnTop', 'miniPlayerAlwaysOnTop', 'minimizeToTray', 'closeToTray']
  };

  function clampNumber(val, min, max, fallback) {
    const n = Number(val);
    if (isNaN(n) || !isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Safely migrate legacy v1.5.x / v1.6.0 setting keys and normalize types/ranges.
   * Never discards existing user preferences. Clamps numeric values to valid ranges.
   */
  function normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object') raw = {};
    const res = Object.assign({}, CANONICAL_DEFAULTS);

    // --- 1. Library & Folders ---
    const fw = (raw.folderWatching !== undefined) ? raw.folderWatching : raw.watchFolders;
    if (fw !== undefined) res.folderWatching = !!fw;

    const dup = (raw.allowDuplicatesInPlaylists !== undefined) ? raw.allowDuplicatesInPlaylists : raw.allowPlaylistDuplicates;
    if (dup !== undefined) res.allowDuplicatesInPlaylists = !!dup;

    // --- 2. Playback ---
    if (raw.gapless !== undefined) res.gapless = !!raw.gapless;

    const xf = (raw.crossfade !== undefined) ? raw.crossfade : raw.crossfadeDuration;
    if (xf !== undefined) res.crossfade = Math.round(clampNumber(xf, 0, 10, CANONICAL_DEFAULTS.crossfade));

    if (raw.resumeLongTracks !== undefined) res.resumeLongTracks = !!raw.resumeLongTracks;

    const rt = (raw.resumeThreshold !== undefined) ? raw.resumeThreshold : raw.resumeThresholdSeconds;
    if (rt !== undefined) res.resumeThreshold = Math.round(clampNumber(rt, 60, 7200, CANONICAL_DEFAULTS.resumeThreshold));

    // --- 3. Audio & Equalizer & ReplayGain & Native Pure Audio ---
    const validBackends = ['webaudio', 'native'];
    if (raw.audioBackend && validBackends.includes(raw.audioBackend)) {
      res.audioBackend = raw.audioBackend;
    }

    const validOutputModes = ['shared', 'exclusive'];
    if (raw.outputMode && validOutputModes.includes(raw.outputMode)) {
      res.outputMode = raw.outputMode;
    }

    if (typeof raw.outputDevice === 'string' && raw.outputDevice.trim()) {
      res.outputDevice = raw.outputDevice.trim();
    }

    const validBufferModes = ['default', 'lowLatency'];
    if (raw.bufferMode && validBufferModes.includes(raw.bufferMode)) {
      res.bufferMode = raw.bufferMode;
    }

    const validRgModes = ['off', 'track', 'album', 'prevent_clipping'];
    if (raw.replayGainMode && validRgModes.includes(raw.replayGainMode)) {
      res.replayGainMode = raw.replayGainMode;
    }

    const rgPreamp = (raw.replayGainPreamp !== undefined) ? raw.replayGainPreamp : raw.preampWithRg;
    if (rgPreamp !== undefined) res.replayGainPreamp = clampNumber(rgPreamp, -12.0, 12.0, CANONICAL_DEFAULTS.replayGainPreamp);

    const rgFallback = (raw.replayGainPreampFallback !== undefined) ? raw.replayGainPreampFallback : raw.preampWithoutRg;
    if (rgFallback !== undefined) res.replayGainPreampFallback = clampNumber(rgFallback, -12.0, 12.0, CANONICAL_DEFAULTS.replayGainPreampFallback);

    let eqEn = raw.eqEnabled;
    if (eqEn === undefined && raw.equalizerEnabled !== undefined) eqEn = raw.equalizerEnabled;
    if (eqEn === undefined && raw.eqBypass !== undefined) eqEn = !raw.eqBypass;
    if (eqEn !== undefined) res.eqEnabled = !!eqEn;

    const validPresets = ['flat', 'rock', 'pop', 'jazz', 'classical', 'electronic', 'vocal', 'bass_boost', 'treble_boost', 'potplayer', 'crystal', 'clear', 'custom'];
    let eqPres = (raw.eqPreset !== undefined) ? raw.eqPreset : raw.equalizerPreset;
    if (eqPres === 'bass') eqPres = 'bass_boost';
    if (eqPres && validPresets.includes(eqPres)) {
      res.eqPreset = eqPres;
    }

    if (Array.isArray(raw.eqGains) && raw.eqGains.length === 10) {
      res.eqGains = raw.eqGains.map((g, idx) => clampNumber(g, -12.0, 12.0, CANONICAL_DEFAULTS.eqGains[idx]));
    }
    if (raw.eqPreamp !== undefined) {
      res.eqPreamp = clampNumber(raw.eqPreamp, -12.0, 12.0, CANONICAL_DEFAULTS.eqPreamp);
    }
    if (raw.loudnessNormalizer !== undefined) {
      res.loudnessNormalizer = !!raw.loudnessNormalizer;
    }
    if (raw.normalizerStrength !== undefined) {
      res.normalizerStrength = (raw.normalizerStrength === 'gentle' || raw.normalizerStrength === 'normal' || raw.normalizerStrength === 'strong') ? raw.normalizerStrength : CANONICAL_DEFAULTS.normalizerStrength;
    }
    if (raw.stereoWidth !== undefined) {
      res.stereoWidth = clampNumber(raw.stereoWidth, 0.5, 2.0, CANONICAL_DEFAULTS.stereoWidth);
    }
    if (raw.soundMode !== undefined) {
      res.soundMode = ['off', 'natural', 'clear', 'power'].indexOf(raw.soundMode) >= 0 ? raw.soundMode : 'off';
    }
    if (raw.potPlayerMode !== undefined) {
      res.potPlayerMode = !!raw.potPlayerMode;
    }

    // --- 4. Appearance & Lyrics Style ---
    const validThemes = ['cyan', 'aurora', 'rainbow', 'custom', 'sunset', 'ocean', 'gold', 'violet', 'candy'];
    if (raw.visualizerTheme && validThemes.includes(raw.visualizerTheme)) {
      res.visualizerTheme = raw.visualizerTheme;
    }
    if (raw.visualizerStyle && ['bars', 'mirror', 'area'].includes(raw.visualizerStyle)) res.visualizerStyle = raw.visualizerStyle;
    if (raw.reducedMotion !== undefined) res.reducedMotion = !!raw.reducedMotion;
    if (['dark', 'light', 'auto', 'violet', 'gold', 'ocean', 'mint', 'peach', 'sky'].includes(raw.appTheme)) res.appTheme = raw.appTheme;

    const validLyricModes = ['original', 'translation', 'bilingual', 'split'];
    if (raw.lyricMode && validLyricModes.includes(raw.lyricMode)) {
      res.lyricMode = raw.lyricMode;
    }
    if (raw.soundReactiveLyrics !== undefined) res.soundReactiveLyrics = !!raw.soundReactiveLyrics;
    if (raw.reactiveIntensity !== undefined) res.reactiveIntensity = clampNumber(raw.reactiveIntensity, 0.2, 2.0, CANONICAL_DEFAULTS.reactiveIntensity);

    if (typeof raw.lyricsFontFamily === 'string' && raw.lyricsFontFamily.trim()) {
      res.lyricsFontFamily = raw.lyricsFontFamily.trim();
    }
    if (raw.lyricsOriginalSize !== undefined) res.lyricsOriginalSize = Math.round(clampNumber(raw.lyricsOriginalSize, 14, 48, CANONICAL_DEFAULTS.lyricsOriginalSize));
    if (raw.lyricsTranslationSize !== undefined) res.lyricsTranslationSize = Math.round(clampNumber(raw.lyricsTranslationSize, 12, 36, CANONICAL_DEFAULTS.lyricsTranslationSize));

    if (typeof raw.lyricsInactiveColor === 'string' && raw.lyricsInactiveColor.trim()) {
      res.lyricsInactiveColor = raw.lyricsInactiveColor.trim();
    }
    if (typeof raw.lyricsActiveColor === 'string' && raw.lyricsActiveColor.trim()) {
      res.lyricsActiveColor = raw.lyricsActiveColor.trim();
    }
    if (typeof raw.lyricsTranslationColor === 'string' && raw.lyricsTranslationColor.trim()) {
      res.lyricsTranslationColor = raw.lyricsTranslationColor.trim();
    }

    const validBgs = ['glass', 'dark', 'transparent', 'gradient', 'aurora', 'sunset', 'ocean', 'violet'];
    if (raw.lyricsBackground && validBgs.includes(raw.lyricsBackground)) {
      res.lyricsBackground = raw.lyricsBackground;
    }
    if (raw.lyricsEffect && ['none', 'glow', 'wave', 'particle'].includes(raw.lyricsEffect)) res.lyricsEffect = raw.lyricsEffect;
    if (raw.lyricsGlowIntensity !== undefined) res.lyricsGlowIntensity = clampNumber(raw.lyricsGlowIntensity, 0.0, 3.0, CANONICAL_DEFAULTS.lyricsGlowIntensity);

    const validColorStyles = ['solid', 'rainbow', 'sunset', 'ocean', 'neon', 'fire', 'aurora', 'candy', 'gold', 'ice', 'rose', 'emerald', 'violet', 'lava', 'lagoon', 'cotton', 'royal', 'citrus', 'midnight', 'champagne'];
    if (raw.lyricsColorStyle && validColorStyles.includes(raw.lyricsColorStyle)) {
      res.lyricsColorStyle = raw.lyricsColorStyle;
    }
    if (raw.lyricsColorSpeed !== undefined) res.lyricsColorSpeed = Math.round(clampNumber(raw.lyricsColorSpeed, 2, 30, CANONICAL_DEFAULTS.lyricsColorSpeed));
    if (typeof raw.lyricsTranslationFont === 'string' && raw.lyricsTranslationFont.trim() && raw.lyricsTranslationFont.length <= 200 && !/[;{}<>]/.test(raw.lyricsTranslationFont)) {
      res.lyricsTranslationFont = raw.lyricsTranslationFont.trim();
    }

    // --- 5. Windows & Tray ---
    if (raw.alwaysOnTop !== undefined) res.alwaysOnTop = !!raw.alwaysOnTop;
    if (raw.miniPlayerAlwaysOnTop !== undefined) res.miniPlayerAlwaysOnTop = !!raw.miniPlayerAlwaysOnTop;
    if (raw.minimizeToTray !== undefined) res.minimizeToTray = !!raw.minimizeToTray;
    if (raw.closeToTray !== undefined) res.closeToTray = !!raw.closeToTray;

    // Window State preservation
    if (raw.windowState && typeof raw.windowState === 'object') {
      res.windowState = raw.windowState;
    }

    return res;
  }

  const exportObj = {
    CANONICAL_DEFAULTS,
    SECTION_KEYS,
    clampNumber,
    normalizeSettings
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }
  if (typeof window !== 'undefined') {
    window.MakanSettingsSchema = exportObj;
  }
})();
