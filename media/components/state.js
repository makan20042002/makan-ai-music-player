/*
 * media/components/state.js - Central reactive state manager for MAKAN Music Player.
 * Keeps playback state completely separate from presentation state.
 */
(function () {
  'use strict';

  function MakanPlayerState() {
    this._listeners = {};

    this.tracks = [];
    this.totalTracksDisplay = 0;
    this.playlistsCount = 0;
    this.queueCount = 0;

    this.activeTrackIndex = -1;
    this.currentTrack = null;

    // Playback state
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 0.85;
    this.muted = false;
    this.shuffle = false;
    this.shuffleMode = 'off'; // 'off' | 'tracks' | 'albums'
    this.repeatMode = 'all'; // 'off' | 'all' | 'one'
    this.pan = 0;

    // Lyrics state
    this.lyricMode = 'bilingual'; // 'original' | 'translation' | 'bilingual'
    this.syncOffset = 0.0;
    this.soundReactiveLyrics = true;
    this.reactiveIntensity = 1.0;
    this.reactiveSpeed = 1.0;
    this.currentLyricIndex = -1;

    // Sound reactive energy computed by audio analyser
    this.audioEnergy = {
      bass: 0,
      mid: 0,
      treble: 0,
      rms: 0
    };

    // Visualizer state
    this.visualizerTheme = 'cyan'; // 'cyan' | 'aurora' | 'rainbow' | 'custom' | 'sunset' | 'ocean' | 'gold' | 'violet' | 'candy'
    this.visualizerStyle = 'bars'; // 'bars' | 'mirror' | 'area'

    // UI Navigation & Search
    this.activeNavItem = 'library'; // 'library', 'playlists', 'queue', 'recent', 'artists', 'albums', 'genres', 'folders'
    this.globalSearchQuery = '';
    this.librarySearchQuery = '';

    // Drawers
    this.drawers = {
      queue: false,
      playlists: false,
      folders: false,
      equalizer: false,
      lyricsStyle: false,
      aiDialog: false,
      audioPathDialog: false,
      settings: false
    };

    // Equalizer state: 10 bands & Preamp
    this.eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.eqGains = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    this.eqPreamp = 0.0;
    this.eqBypass = false;
    this.eqPreset = 'flat';

    // v1.8.0 Canonical Settings Defaults
    var defs = (typeof window !== 'undefined' && window.MakanSettingsSchema)
      ? window.MakanSettingsSchema.CANONICAL_DEFAULTS
      : {};

    this.audioBackend = defs.audioBackend || 'webaudio';
    this.outputMode = defs.outputMode || 'shared';
    this.outputDevice = defs.outputDevice || 'default';
    this.bufferMode = defs.bufferMode || 'default';

    this.gapless = defs.gapless !== undefined ? defs.gapless : true;
    this.crossfade = defs.crossfade !== undefined ? defs.crossfade : 0;
    this.replayGainMode = defs.replayGainMode || 'track';
    this.replayGainPreamp = defs.replayGainPreamp !== undefined ? defs.replayGainPreamp : 0.0;
    this.replayGainPreampFallback = defs.replayGainPreampFallback !== undefined ? defs.replayGainPreampFallback : 0.0;
    this.replayGainPreventClipping = true;
    this.resumeLongTracks = defs.resumeLongTracks !== undefined ? defs.resumeLongTracks : true;
    this.resumeThreshold = defs.resumeThreshold !== undefined ? defs.resumeThreshold : 900;
    this.folderWatching = defs.folderWatching !== undefined ? defs.folderWatching : true;
    this.minimizeToTray = !!defs.minimizeToTray;
    this.closeToTray = !!defs.closeToTray;
    this.alwaysOnTop = !!defs.alwaysOnTop;
    this.miniPlayerAlwaysOnTop = !!defs.miniPlayerAlwaysOnTop;
    this.allowDuplicatesInPlaylists = !!defs.allowDuplicatesInPlaylists;
    this.reducedMotion = !!defs.reducedMotion;
    this.loudnessNormalizer = defs.loudnessNormalizer !== undefined ? defs.loudnessNormalizer : false;
    this.stereoWidth = defs.stereoWidth !== undefined ? defs.stereoWidth : 1.0;
    this.normalizerStrength = defs.normalizerStrength !== undefined ? defs.normalizerStrength : 'strong';
    this.potPlayerMode = defs.potPlayerMode !== undefined ? defs.potPlayerMode : false;
    this.soundMode = defs.soundMode !== undefined ? defs.soundMode : (this.potPlayerMode ? 'power' : 'off');

    // Lyrics Styling & Appearance
    this.lyricsFontFamily = defs.lyricsFontFamily || 'Vazirmatn, Segoe UI, sans-serif';
    this.lyricsOriginalSize = defs.lyricsOriginalSize || 20;
    this.lyricsTranslationSize = defs.lyricsTranslationSize || 16;
    this.lyricsInactiveColor = defs.lyricsInactiveColor || 'rgba(255, 255, 255, 0.42)';
    this.lyricsActiveColor = defs.lyricsActiveColor || '#ffffff';
    this.lyricsTranslationColor = defs.lyricsTranslationColor || '#cbd5e1';
    this.lyricsBackground = defs.lyricsBackground || 'glass';
    this.lyricsEffect = defs.lyricsEffect || 'none';
    this.lyricsGlowIntensity = defs.lyricsGlowIntensity !== undefined ? defs.lyricsGlowIntensity : 1.0;
    this.appTheme = defs.appTheme || ((typeof window !== 'undefined' && window.MakanTheme) ? window.MakanTheme.getMode() : 'dark');
    this.lyricsColorStyle = defs.lyricsColorStyle || 'solid';
    this.lyricsColorSpeed = defs.lyricsColorSpeed !== undefined ? defs.lyricsColorSpeed : 8;
    this.lyricsTranslationFont = defs.lyricsTranslationFont || 'Vazirmatn, Segoe UI, sans-serif';
  }

  MakanPlayerState.prototype.setPotPlayerMode = function (enabled) {
    var val = !!enabled;
    if (this.potPlayerMode === val) return;
    this.potPlayerMode = val;
    this.emit('potPlayerModeChanged', { enabled: this.potPlayerMode });
  };

  MakanPlayerState.prototype.on = function (event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    return this;
  };

  MakanPlayerState.prototype.off = function (event, handler) {
    if (!this._listeners[event]) return this;
    this._listeners[event] = this._listeners[event].filter(function (h) { return h !== handler; });
    return this;
  };

  MakanPlayerState.prototype.emit = function (event, data) {
    var handlers = this._listeners[event];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try {
          handlers[i](data, this);
        } catch (e) {
          console.error('[MakanState] Error in handler for ' + event, e);
        }
      }
    }
    return this;
  };

  MakanPlayerState.prototype.setPlayState = function (isPlaying) {
    if (this.isPlaying !== isPlaying) {
      this.isPlaying = isPlaying;
      this.emit('playStateChanged', { isPlaying: isPlaying });
    }
  };

  MakanPlayerState.prototype.setCurrentTime = function (time) {
    this.currentTime = Math.max(0, Number(time) || 0);
    this.updateActiveLyricIndex();
    this.emit('timeUpdated', { currentTime: this.currentTime, duration: this.duration });
  };

  MakanPlayerState.prototype.setDuration = function (dur) {
    this.duration = Math.max(0, Number(dur) || 0);
    this.emit('durationUpdated', { duration: this.duration });
  };

  MakanPlayerState.prototype.selectTrack = function (index) {
    if (index >= 0 && index < this.tracks.length) {
      this.activeTrackIndex = index;
      this.currentTrack = this.tracks[index];
      this.currentTime = 0;
      this.duration = this.currentTrack.duration || 0;
      this.currentLyricIndex = 0;
      this.emit('trackChanged', { track: this.currentTrack, index: index });
    }
  };

  MakanPlayerState.prototype.nextTrack = function () {
    if (!this.tracks.length) return;
    var nextIdx = (this.activeTrackIndex + 1) % this.tracks.length;
    this.selectTrack(nextIdx);
  };

  MakanPlayerState.prototype.prevTrack = function () {
    if (!this.tracks.length) return;
    var prevIdx = (this.activeTrackIndex - 1 + this.tracks.length) % this.tracks.length;
    this.selectTrack(prevIdx);
  };

  MakanPlayerState.prototype.setShuffleMode = function (mode) {
    var valid = (mode === 'tracks' || mode === 'albums') ? mode : 'off';
    this.shuffleMode = valid;
    this.shuffle = (valid !== 'off');
    this.emit('shuffleChanged', { shuffle: this.shuffle, shuffleMode: this.shuffleMode });
  };

  MakanPlayerState.prototype.cycleShuffleMode = function () {
    var next = this.shuffleMode === 'off' ? 'tracks' : (this.shuffleMode === 'tracks' ? 'albums' : 'off');
    this.setShuffleMode(next);
    return next;
  };

  MakanPlayerState.prototype.toggleShuffle = function () {
    var next = (this.shuffleMode === 'off') ? 'tracks' : 'off';
    this.setShuffleMode(next);
  };

  MakanPlayerState.prototype.cycleRepeat = function () {
    if (this.repeatMode === 'off') this.repeatMode = 'all';
    else if (this.repeatMode === 'all') this.repeatMode = 'one';
    else this.repeatMode = 'off';
    this.emit('repeatChanged', { repeatMode: this.repeatMode });
  };

  MakanPlayerState.prototype.setVolume = function (vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol)));
    this.muted = this.volume === 0;
    this.emit('volumeChanged', { volume: this.volume, muted: this.muted });
  };

  MakanPlayerState.prototype.toggleMute = function () {
    this.muted = !this.muted;
    this.emit('volumeChanged', { volume: this.volume, muted: this.muted });
  };

  MakanPlayerState.prototype.toggleFavorite = function (trackId) {
    var id = trackId || (this.currentTrack ? this.currentTrack.id : null);
    if (!id) return;
    for (var i = 0; i < this.tracks.length; i++) {
      if (this.tracks[i].id === id) {
        this.tracks[i].favorite = !this.tracks[i].favorite;
        this.emit('favoriteChanged', { trackId: id, favorite: this.tracks[i].favorite });
        break;
      }
    }
  };

  MakanPlayerState.prototype.setLyricMode = function (mode) {
    this.lyricMode = mode;
    this.emit('lyricModeChanged', { lyricMode: mode });
  };

  MakanPlayerState.prototype.adjustSyncOffset = function (delta) {
    this.syncOffset = Math.round((this.syncOffset + delta) * 10) / 10;
    this.updateActiveLyricIndex();
    this.emit('syncOffsetChanged', { syncOffset: this.syncOffset });
  };

  MakanPlayerState.prototype.updateActiveLyricIndex = function () {
    var track = this.currentTrack;
    if (!track || !track.cues || !track.cues.length) {
      this.currentLyricIndex = -1;
      return;
    }
    var adjustedTime = this.currentTime - this.syncOffset;
    var found = -1;
    for (var i = 0; i < track.cues.length; i++) {
      var c = track.cues[i];
      if (adjustedTime >= c.s && adjustedTime < c.e) {
        found = i;
        break;
      }
      if (adjustedTime >= c.s) {
        found = i;
      }
    }
    if (found === -1 && track.cues.length) found = 0;
    if (this.currentLyricIndex !== found) {
      this.currentLyricIndex = found;
      this.emit('activeLyricChanged', { index: found, cue: track.cues[found] });
    }
  };

  MakanPlayerState.prototype.toggleDrawer = function (name) {
    for (var k in this.drawers) {
      if (k === name) {
        this.drawers[k] = !this.drawers[k];
      } else {
        this.drawers[k] = false;
      }
    }
    this.emit('drawersChanged', { drawers: this.drawers, active: name });
  };

  MakanPlayerState.prototype.closeDrawers = function () {
    for (var k in this.drawers) {
      this.drawers[k] = false;
    }
    this.emit('drawersChanged', { drawers: this.drawers, active: null });
  };

  MakanPlayerState.prototype.setVisualizerStyle = function (style) {
    this.visualizerStyle = style;
    this.emit('visualizerThemeChanged', { style: style });
  };

  MakanPlayerState.prototype.setVisualizerTheme = function (theme) {
    this.visualizerTheme = theme;
    this.emit('visualizerThemeChanged', { theme: theme });
  };

  MakanPlayerState.prototype.formatTime = function (sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MakanPlayerState;
  }
  if (typeof window !== 'undefined') {
    window.MakanPlayerState = MakanPlayerState;
  }
})();
