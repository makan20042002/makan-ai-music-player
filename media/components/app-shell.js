/*
 * media/components/app-shell.js - Main Application Shell for MAKAN Music Player v1.6.0.
 * Coordinates:
 * - 3-column desktop layout (Library, Player Stage, Lyrics Theatre),
 * - Top Bar, Bottom Transport Dock, Drawers, and dedicated PlaybackController.
 * - Compact Mini-Player Mode (Artwork, title, artist, transport, scrub bar, volume, restore button)
 * - Complete Windows Keyboard Shortcuts (17 shortcuts)
 * - Single-instance audio stream forwarding
 * - Non-blocking status notifications (unplayable track recovery, scan summaries)
 * - Persistent SQLite library via restricted MakanDesktop IPC.
 */
(function () {
  'use strict';

  function MakanAppShell(container, opts) {
    this.container = container;
    this.opts = opts || {};

    this.state = new window.MakanPlayerState();
    this.engine = new window.MakanAudioEngine(this.state);

    var persistenceAdapter = {
      savePlaybackState: function (stateObj) {
        if (window.MakanDesktop && window.MakanDesktop.savePlaybackState) {
          window.MakanDesktop.savePlaybackState(stateObj);
        } else {
          try { localStorage.setItem('makan_playback_state', JSON.stringify(stateObj)); } catch (e) {}
        }
      }
    };

    this.controller = new window.MakanPlaybackController(this.state, this.engine, {
      persistenceAdapter: persistenceAdapter
    });

    // sleep timer: stops the music after a set time (Settings -> Playback)
    var shellSelf = this;
    this.sleepTimer = window.MakanSleepTimer ? window.MakanSleepTimer.create({
      getVolume: function () { return shellSelf.state.volume; },
      setVolume: function (v) { shellSelf.engine.setVolume(v); },
      pause: function () { shellSelf.engine.pause(); },
      onChange: function (st) { shellSelf.state.emit('sleepTimerChanged', st); }
    }) : null;
    this.state.sleepTimer = this.sleepTimer;
    if (this.sleepTimer) this.state.on('trackChanged', function () { shellSelf.sleepTimer.onTrackChanged(); });

    this.topBar = null;
    this.sidebar = null;
    this.stage = null;
    this.theatre = null;
    this.dock = null;
    this.drawers = null;

    this.filePicker = null;
    this.isMini = false;

    this.init();
  }

  MakanAppShell.prototype.init = function () {
    this.render();
    this.bindMiniPlayer();
    this.bindGlobalShortcuts();
    this.bindDragDrop();
    this.bindIpcEvents();
    this.initMediaSession();
    this.loadSettings();
    this.loadLibrary();
  };

  MakanAppShell.prototype.render = function () {
    var icons = window.MakanIcons;

    var html = '' +
      '<div class="mk-app-root" id="mk-app-root">' +
      '  <!-- Non-Blocking Toast Notification Container -->' +
      '  <div class="mk-toast-container" id="mk-toast-container" style="position:fixed;top:54px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>' +
      '' +
      '  <!-- 1. Full Desktop Player -->' +
      '  <div class="mk-full-player" id="mk-full-player" style="display:flex;flex-direction:column;width:100%;height:100%;">' +
      '    <!-- Hidden Audio File Pickers -->' +
      '    <input type="file" id="mk-hidden-file-picker" accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.opus" multiple hidden>' +
      '    <input type="file" id="mk-hidden-folder-picker" webkitdirectory directory multiple hidden>' +
      '' +
      '    <!-- Top Bar -->' +
      '    <div class="mk-topbar-mount" id="mk-topbar-mount"></div>' +
      '' +
      '    <!-- 3-Column Main Stage -->' +
      '    <main class="mk-main-content" id="mk-main-content" role="main">' +
      '      <div class="mk-col-library" id="mk-col-library"></div>' +
      '      <div class="mk-col-stage" id="mk-col-stage"></div>' +
      '      <div class="mk-col-theatre" id="mk-col-theatre"></div>' +
      '    </main>' +
      '' +
      '    <!-- Bottom Transport Dock -->' +
      '    <div class="mk-dock-mount" id="mk-dock-mount"></div>' +
      '' +
      '    <!-- Drawers & Dialogs -->' +
      '    <div class="mk-drawers-mount" id="mk-drawers-mount"></div>' +
      '  </div>' +
      '' +
      '  <!-- 2. Compact Mini Player (Hidden in full mode) -->' +
      '  <div class="mk-mini-player-root" id="mk-mini-player-root" style="display:none;width:100vw;height:100vh;background:linear-gradient(135deg, var(--mk-bg-panel), var(--mk-bg-root));color:var(--mk-text);flex-direction:column;overflow:hidden;border:1px solid rgba(var(--mk-fg-rgb),0.08);">' +
      '    <!-- Mini Header (Draggable) -->' +
      '    <div class="mk-mini-header" style="-webkit-app-region:drag;display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.3);">' +
      '      <span style="font-size:11px;font-weight:700;color:var(--mk-accent-cyan);letter-spacing:0.5px;">MAKAN MINI</span>' +
      '      <div style="-webkit-app-region:no-drag;display:flex;align-items:center;gap:4px;">' +
      '        <button type="button" class="mk-icon-btn" id="mk-mini-aot-btn" title="Toggle Always on Top" style="padding:2px 4px;font-size:11px;">' + icons.pin() + '</button>' +
      '        <button type="button" class="mk-icon-btn" id="mk-mini-restore-btn" title="Restore Full Player (M)" style="padding:2px 4px;font-size:11px;">' + icons.expand() + '</button>' +
      '      </div>' +
      '    </div>' +
      '    <!-- Mini Body -->' +
      '    <div class="mk-mini-content" style="flex:1;display:flex;align-items:center;padding:8px 12px;gap:12px;min-height:0;">' +
      '      <!-- Artwork -->' +
      '      <div class="mk-mini-art-box" id="mk-mini-art-box" style="width:58px;height:58px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);flex-shrink:0;display:flex;align-items:center;justify-content:center;">' +
      '        <img id="mk-mini-art-img" src="" alt="Art" style="width:100%;height:100%;object-fit:cover;display:none;">' +
      '        <span id="mk-mini-art-ph" style="font-size:22px;color:var(--mk-accent-cyan);">♪</span>' +
      '      </div>' +
      '      <!-- Info & Transport -->' +
      '      <div class="mk-mini-info-box" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">' +
      '        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      '          <span class="mk-mini-title" id="mk-mini-title" style="font-size:12.5px;font-weight:700;color:var(--mk-text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">No Track Playing</span>' +
      '          <span class="mk-mini-artist" id="mk-mini-artist" style="font-size:11px;color:var(--mk-text-dim);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</span>' +
      '        </div>' +
      '        <!-- Scrub Progress -->' +
      '        <div class="mk-mini-progress" style="display:flex;align-items:center;gap:6px;">' +
      '          <span id="mk-mini-time-cur" style="font-size:10px;color:var(--mk-text-dim);min-width:30px;">00:00</span>' +
      '          <div class="mk-mini-bar" id="mk-mini-bar" style="flex:1;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;cursor:pointer;position:relative;">' +
      '            <div id="mk-mini-bar-fill" style="width:0%;height:100%;background:var(--mk-accent-cyan);border-radius:2px;"></div>' +
      '          </div>' +
      '          <span id="mk-mini-time-dur" style="font-size:10px;color:var(--mk-text-dim);min-width:30px;text-align:right;">00:00</span>' +
      '        </div>' +
      '        <!-- Controls -->' +
      '        <div class="mk-mini-controls" style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">' +
      '          <div style="display:flex;align-items:center;gap:6px;">' +
      '            <button type="button" class="mk-icon-btn" id="mk-mini-prev-btn" title="Previous (Ctrl+Left)">' + icons.prev() + '</button>' +
      '            <button type="button" class="mk-icon-btn mk-mini-play" id="mk-mini-play-btn" title="Play/Pause (Space)" style="color:var(--mk-accent-cyan);">' + icons.play() + '</button>' +
      '            <button type="button" class="mk-icon-btn" id="mk-mini-next-btn" title="Next (Ctrl+Right)">' + icons.next() + '</button>' +
      '          </div>' +
      '          <div style="display:flex;align-items:center;gap:4px;">' +
      '            <button type="button" class="mk-icon-btn" id="mk-mini-mute-btn" title="Mute (Ctrl+M)">' + icons.volume(2) + '</button>' +
      '            <input type="range" id="mk-mini-vol-range" min="0" max="1" step="0.02" value="0.85" style="width:50px;height:4px;accent-color:var(--mk-accent-cyan);">' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    this.container.innerHTML = html;

    var topMount = this.container.querySelector('#mk-topbar-mount');
    var libMount = this.container.querySelector('#mk-col-library');
    var stageMount = this.container.querySelector('#mk-col-stage');
    var theatreMount = this.container.querySelector('#mk-col-theatre');
    var dockMount = this.container.querySelector('#mk-dock-mount');
    var drawersMount = this.container.querySelector('#mk-drawers-mount');

    this.topBar = new window.MakanTopBar(topMount, this.state, this.engine);
    this.sidebar = new window.MakanLibrarySidebar(libMount, this.state, this.engine, this.controller);
    this.stage = new window.MakanPlayerStage(stageMount, this.state, this.engine);
    this.theatre = new window.MakanLyricsTheatre(theatreMount, this.state, this.engine);
    // Lyrics live in the middle panel (under the cover and title); the right panel keeps the controls
    this.theatre.mountLyricsInto(stageMount.querySelector('#mk-stage-lyrics-mount'));
    this.dock = new window.MakanTransportDock(dockMount, this.state, this.engine, this.controller);
    this.drawers = new window.MakanDrawers(drawersMount, this.state, this.engine, this.controller);

    this.filePicker = this.container.querySelector('#mk-hidden-file-picker');
    var folderPicker = this.container.querySelector('#mk-hidden-folder-picker');

    var self = this;
    if (this.filePicker) {
      this.filePicker.addEventListener('change', function (e) {
        self.importFilesBrowserFallback(e.target.files);
      });
    }
    if (folderPicker) {
      folderPicker.addEventListener('change', function (e) {
        self.importFilesBrowserFallback(e.target.files);
      });
    }
  };

  MakanAppShell.prototype.showToast = function (message, type) {
    var toastContainer = this.container.querySelector('#mk-toast-container');
    if (!toastContainer) return;

    var toast = document.createElement('div');
    toast.className = 'mk-toast';
    var borderColor = type === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(var(--mk-accent-rgb),0.4)';
    var bgColor = type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(var(--mk-accent-rgb),0.15)';
    var textColor = type === 'error' ? '#ef4444' : 'var(--mk-accent-cyan)';

    toast.style.cssText = 'pointer-events:auto;display:flex;align-items:center;gap:8px;padding:8px 14px;background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:6px;font-size:12px;color:' + textColor + ';box-shadow:0 4px 12px rgba(0,0,0,0.5);transition:opacity 0.2s ease;';
    toast.innerHTML = '<span>' + String(message || '') + '</span>';

    toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, 4000);
  };

  MakanAppShell.prototype.bindMiniPlayer = function () {
    var self = this;
    var fullEl = this.container.querySelector('#mk-full-player');
    var miniEl = this.container.querySelector('#mk-mini-player-root');

    var prevBtn = miniEl.querySelector('#mk-mini-prev-btn');
    var playBtn = miniEl.querySelector('#mk-mini-play-btn');
    var nextBtn = miniEl.querySelector('#mk-mini-next-btn');
    var muteBtn = miniEl.querySelector('#mk-mini-mute-btn');
    var volRange = miniEl.querySelector('#mk-mini-vol-range');
    var restoreBtn = miniEl.querySelector('#mk-mini-restore-btn');
    var aotBtn = miniEl.querySelector('#mk-mini-aot-btn');
    var scrubBar = miniEl.querySelector('#mk-mini-bar');

    if (prevBtn) prevBtn.addEventListener('click', function () { self.controller.previous(); });
    if (playBtn) playBtn.addEventListener('click', function () { self.engine.togglePlay(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { self.controller.next(true); });
    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        self.state.toggleMute();
        self.engine.setVolume(self.state.volume);
      });
    }
    if (volRange) {
      volRange.addEventListener('input', function (e) {
        self.engine.setVolume(parseFloat(e.target.value));
      });
    }
    if (restoreBtn) {
      restoreBtn.addEventListener('click', function () {
        self.toggleMiniPlayer(false);
      });
    }
    if (aotBtn) {
      aotBtn.addEventListener('click', function () {
        var newAot = !self.state.alwaysOnTop;
        self.state.alwaysOnTop = newAot;
        if (window.MakanDesktop && window.MakanDesktop.setAlwaysOnTop) {
          window.MakanDesktop.setAlwaysOnTop(newAot);
        }
      });
    }

    if (scrubBar) {
      scrubBar.addEventListener('click', function (e) {
        var rect = scrubBar.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        var targetSec = pct * (self.state.duration || 0);
        self.engine.seek(targetSec);
      });
    }

    // React to track and time changes in mini player
    function updateMiniTrack(t) {
      var track = t || self.state.currentTrack;
      var titleEl = miniEl.querySelector('#mk-mini-title');
      var artistEl = miniEl.querySelector('#mk-mini-artist');
      var imgEl = miniEl.querySelector('#mk-mini-art-img');
      var phEl = miniEl.querySelector('#mk-mini-art-ph');

      if (!track) {
        if (titleEl) titleEl.textContent = 'No Track Playing';
        if (artistEl) artistEl.textContent = '—';
        if (imgEl) imgEl.style.display = 'none';
        if (phEl) phEl.style.display = 'block';
        return;
      }

      if (titleEl) titleEl.textContent = track.title || track.filename || 'Untitled';
      if (artistEl) artistEl.textContent = track.artist || 'Unknown Artist';

      var artUrl = (track.id && track.artwork_path) ? ('/api/artwork?id=' + encodeURIComponent(track.id)) : '';
      if (artUrl && imgEl) {
        imgEl.src = artUrl;
        imgEl.style.display = 'block';
        if (phEl) phEl.style.display = 'none';
      } else {
        if (imgEl) imgEl.style.display = 'none';
        if (phEl) phEl.style.display = 'block';
      }
    }

    function updateMiniProgress(cur, dur) {
      var curEl = miniEl.querySelector('#mk-mini-time-cur');
      var durEl = miniEl.querySelector('#mk-mini-time-dur');
      var fillEl = miniEl.querySelector('#mk-mini-bar-fill');

      if (curEl) curEl.textContent = self.state.formatTime(cur);
      if (durEl) durEl.textContent = self.state.formatTime(dur);
      if (fillEl && dur > 0) {
        var pct = Math.min(100, Math.max(0, (cur / dur) * 100));
        fillEl.style.width = pct + '%';
      }
    }

    this.state.on('trackChanged', function (data) { updateMiniTrack(data.track); });
    this.state.on('playStateChanged', function (data) {
      var isPlaying = !!(data && data.isPlaying);
      if (window.MakanTheme && window.MakanTheme.setStill) window.MakanTheme.setStill(!isPlaying);
      if (playBtn) playBtn.innerHTML = isPlaying ? window.MakanIcons.pause() : window.MakanIcons.play();
    });
    this.state.on('timeUpdated', function (data) {
      updateMiniProgress(data.currentTime || 0, data.duration || 0);
    });
    this.state.on('volumeChanged', function (data) {
      if (volRange) volRange.value = data.muted ? 0 : data.volume;
      if (muteBtn) muteBtn.innerHTML = window.MakanIcons.volume(data.muted ? 0 : 2);
    });
  };

  MakanAppShell.prototype.toggleMiniPlayer = function (forceMini) {
    var willMini = (forceMini !== undefined) ? !!forceMini : !this.isMini;
    this.isMini = willMini;

    var fullEl = this.container.querySelector('#mk-full-player');
    var miniEl = this.container.querySelector('#mk-mini-player-root');

    if (this.isMini) {
      if (fullEl) fullEl.style.display = 'none';
      if (miniEl) miniEl.style.display = 'flex';
      document.body.classList.add('mk-mini-active');
    } else {
      if (fullEl) fullEl.style.display = 'flex';
      if (miniEl) miniEl.style.display = 'none';
      document.body.classList.remove('mk-mini-active');
    }

    if (window.MakanDesktop && window.MakanDesktop.toggleMiniPlayer) {
      window.MakanDesktop.toggleMiniPlayer(this.isMini);
    }
  };

  MakanAppShell.prototype.initMediaSession = function () {
    if (window.MakanMediaSession) {
      this.mediaSessionHelper = new window.MakanMediaSession({
        state: this.state,
        desktopApi: function () { return window.MakanDesktop; },
        engine: this.engine,
        controller: this.controller,
        mediaSession: ('mediaSession' in navigator) ? navigator.mediaSession : null,
        MediaMetadata: window.MediaMetadata
      });
      this.mediaSessionHelper.init();
    }
  };

  MakanAppShell.prototype.loadSettings = function () {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.getSettings) {
      return window.MakanDesktop.getSettings().then(function (s) {
        if (!s) return null;
        self.state.gapless = s.gapless !== false;
        self.state.crossfade = s.crossfade !== undefined ? s.crossfade : 0;
        self.state.replayGainMode = s.replayGainMode || 'track';
        self.state.replayGainPreamp = s.replayGainPreamp !== undefined ? s.replayGainPreamp : 0;
        self.state.replayGainPreampFallback = s.replayGainPreampFallback !== undefined ? s.replayGainPreampFallback : 0;
        self.state.resumeLongTracks = s.resumeLongTracks !== false;
        self.state.resumeThreshold = s.resumeThreshold || 900;
        self.state.folderWatching = s.folderWatching !== false;
        self.state.allowDuplicatesInPlaylists = !!s.allowDuplicatesInPlaylists;
        self.state.alwaysOnTop = !!s.alwaysOnTop;
        self.state.miniPlayerAlwaysOnTop = !!s.miniPlayerAlwaysOnTop;
        self.state.minimizeToTray = !!s.minimizeToTray;
        self.state.closeToTray = !!s.closeToTray;
        self.state.visualizerTheme = s.visualizerTheme || 'cyan';
        self.state.visualizerStyle = s.visualizerStyle || 'bars';
        self.state.reducedMotion = !!s.reducedMotion;

        // Equalizer
        if (s.eqGains) self.state.eqGains = s.eqGains.slice();
        if (s.eqPreamp !== undefined) self.state.eqPreamp = s.eqPreamp;
        if (s.eqEnabled !== undefined) self.state.eqBypass = !s.eqEnabled;
        if (s.eqPreset) self.state.eqPreset = s.eqPreset;
        if (s.loudnessNormalizer !== undefined) self.state.loudnessNormalizer = !!s.loudnessNormalizer;
        if (s.stereoWidth !== undefined) self.state.stereoWidth = s.stereoWidth;
        if (s.normalizerStrength) self.state.normalizerStrength = s.normalizerStrength;
        if (s.potPlayerMode !== undefined) self.state.potPlayerMode = !!s.potPlayerMode;
        if (s.soundMode) self.state.soundMode = s.soundMode;

        // Lyrics Style & Appearance
        if (s.lyricMode) self.state.lyricMode = s.lyricMode;
        if (s.soundReactiveLyrics !== undefined) self.state.soundReactiveLyrics = !!s.soundReactiveLyrics;
        if (s.reactiveIntensity !== undefined) self.state.reactiveIntensity = s.reactiveIntensity;
        if (s.lyricsFontFamily) self.state.lyricsFontFamily = s.lyricsFontFamily;
        if (s.lyricsOriginalSize !== undefined) self.state.lyricsOriginalSize = s.lyricsOriginalSize;
        if (s.lyricsTranslationSize !== undefined) self.state.lyricsTranslationSize = s.lyricsTranslationSize;
        if (s.lyricsInactiveColor) self.state.lyricsInactiveColor = s.lyricsInactiveColor;
        if (s.lyricsActiveColor) self.state.lyricsActiveColor = s.lyricsActiveColor;
        if (s.lyricsTranslationColor) self.state.lyricsTranslationColor = s.lyricsTranslationColor;
        if (s.lyricsBackground) self.state.lyricsBackground = s.lyricsBackground;
        if (s.lyricsEffect) self.state.lyricsEffect = s.lyricsEffect;
        if (s.appTheme) { self.state.appTheme = s.appTheme; if (window.MakanTheme) window.MakanTheme.apply(s.appTheme); }
        if (s.lyricsColorStyle) self.state.lyricsColorStyle = s.lyricsColorStyle;
        if (s.lyricsColorSpeed !== undefined) self.state.lyricsColorSpeed = s.lyricsColorSpeed;
        if (s.lyricsTranslationFont) self.state.lyricsTranslationFont = s.lyricsTranslationFont;
        if (s.lyricsGlowIntensity !== undefined) self.state.lyricsGlowIntensity = s.lyricsGlowIntensity;

        if (self.engine) {
          if (s.eqGains) self.engine.eqGains = s.eqGains.slice();
          if (s.eqPreamp !== undefined) self.engine.eqPreamp = s.eqPreamp;
          if (s.eqEnabled !== undefined) self.engine.eqBypass = !s.eqEnabled;
          if (s.eqPreset) self.engine.eqPreset = s.eqPreset;
          if (s.potPlayerMode !== undefined) {
            self.engine.state.potPlayerMode = !!s.potPlayerMode;
          }
          self.engine.applyEq();
          if (typeof self.engine.applyReplayGain === 'function') {
            self.engine.applyReplayGain(self.state.currentTrack);
          }
        }

        if (self.drawers && typeof self.drawers.updateSettingsUi === 'function') {
          self.drawers.updateSettingsUi(s);
        }

        self.state.emit('settingsLoaded', s);
        self.state.emit('lyricModeChanged', { lyricMode: self.state.lyricMode });
        self.state.emit('visualizerThemeChanged', { theme: self.state.visualizerTheme });
        return s;
      });
    }
    return Promise.resolve(null);
  };

  MakanAppShell.prototype.loadLibrary = function (filterOptions, callback, keepPlayback) {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.getTracks) {
      window.MakanDesktop.getTracks(filterOptions || {}).then(function (tracks) {
        self.state.tracks = tracks || [];
        self.state.totalTracksDisplay = self.state.tracks.length;
        if (self.controller && self.controller.context && self.controller.context.type === 'library' && self.controller.context.tracks.length > 0) {
          self.controller.reconcileLibrary(self.state.tracks);
        }

        // Show the songs at once. (Before, the list only filled in after the separate "counts" answer came back,
        // so a slow or failed counts call left the list empty on first open.)
        try { self.state.emit('libraryUpdated'); } catch (e) { /* the list will refresh on the next change */ }

        if (window.MakanDesktop.getCounts) {
          window.MakanDesktop.getCounts().then(function (counts) {
            if (counts) {
              self.state.totalTracksDisplay = counts.totalTracks;
              self.state.playlistsCount = counts.totalPlaylists;
              self.state.emit('countsUpdated');
            }
          }).catch(function () { /* the list is already shown; the numbers fix themselves later */ });
        }

        // keepPlayback: a folder-watcher refresh must never jump back to the old saved song
        if (window.MakanDesktop.getPlaybackState && !keepPlayback) {
          window.MakanDesktop.getPlaybackState().then(function (saved) {
            if (saved) {
              if (saved.volume !== undefined) self.engine.setVolume(saved.volume);
              self.controller.restoreState(saved, self.state.tracks);
              if (saved.currentTime && self.state.currentTrack) {
                self.engine.seek(saved.currentTime);
              }
            }
            if (typeof callback === 'function') callback(self.state.tracks);
          });
        } else if (typeof callback === 'function') {
          callback(self.state.tracks);
        }
      }).catch(function () {
        // reading the library failed: keep what is on screen and still let the caller carry on
        if (typeof callback === 'function') callback(self.state.tracks);
      });
    } else if (typeof callback === 'function') {
      callback(self.state.tracks);
    }
  };

  MakanAppShell.prototype.bindIpcEvents = function () {
    var self = this;

    // Window beforeunload: save playback controller state and flush DB immediately
    window.addEventListener('beforeunload', function () {
      if (self.controller && typeof self.controller.saveState === 'function') {
        self.controller.saveState();
      }
      if (window.MakanDesktop && typeof window.MakanDesktop.flushDb === 'function') {
        window.MakanDesktop.flushDb();
      }
    });

    // Position persistence with immediate flush on transition / pause / stop / close
    if (window.MakanPositionPersistence) {
      this.positionPersistence = new window.MakanPositionPersistence({
        state: this.state,
        desktopApi: function () { return window.MakanDesktop; },
        windowObj: window
      });
      this.positionPersistence.init();
    }

    // Unplayable track recovery toast notification
    this.state.on('playbackError', function (data) {
      var name = data.track ? (data.track.title || data.track.filename) : 'File';
      self.showToast('Could not play "' + name + '"' + (data.message ? ' (' + data.message + ')' : '') + '. Moving to next track...', 'error');
    });

    this.state.on('circuitBreakerTripped', function (data) {
      self.showToast(data.message || 'Playback halted: 5 unplayable tracks.', 'error');
    });

    // Generic toast event (used by the audio engine and "Make lyrics")
    this.state.on('toast', function (data) {
      if (data && data.message) self.showToast(data.message, data.type || 'info');
    });

    // PotPlayer mode toggle toast notification
    this.state.on('potPlayerModeChanged', function (data) {
      if (data && data.enabled) {
        var names = { natural: 'Natural (even volume, true tone)', clear: 'Clear (even volume + clearer voice)', power: 'Power (louder, fuller, normalized)' };
        self.showToast('⚡ MAKAN Sound: ' + (names[data.mode] || names.power), 'info');
      } else {
        self.showToast('Standard Audio: ACTIVE (Flat Studio Neutral)', 'info');
      }
    });

    // Request Add Folder
    this.state.on('requestAddFolder', function () {
      if (window.MakanDesktop && window.MakanDesktop.chooseFolders) {
        window.MakanDesktop.chooseFolders().then(function (folders) {
          if (folders && folders.length) {
            self.scanPaths(folders);
          }
        });
      } else {
        var fp = self.container.querySelector('#mk-hidden-folder-picker');
        if (fp) fp.click();
      }
    });

    // Request Add Files
    this.state.on('requestAddFiles', function () {
      if (window.MakanDesktop && window.MakanDesktop.chooseFiles) {
        window.MakanDesktop.chooseFiles().then(function (files) {
          if (files && files.length) {
            self.scanPaths(files);
          }
        });
      } else {
        if (self.filePicker) self.filePicker.click();
      }
    });

    // Request Rescan Library
    this.state.on('requestRescan', function () {
      if (window.MakanDesktop && window.MakanDesktop.getFolders) {
        window.MakanDesktop.getFolders().then(function (folders) {
          if (folders && folders.length) {
            var folderPaths = folders.map(function (f) { return f.path; });
            self.scanPaths(folderPaths);
          } else {
            self.loadLibrary();
          }
        });
      } else {
        self.loadLibrary();
      }
    });

    // Request Remove Tracks from library
    this.state.on('requestRemoveTracks', function (data) {
      if (window.MakanDesktop && window.MakanDesktop.removeTracks) {
        window.MakanDesktop.removeTracks(data.trackIds).then(function () {
          self.loadLibrary();
        });
      } else {
        self.state.tracks = self.state.tracks.filter(function (t) {
          return !data.trackIds.includes(t.id);
        });
        self.state.totalTracksDisplay = self.state.tracks.length;
        self.state.emit('libraryUpdated');
      }
    });

    // Navigation Category Selection
    this.state.on('navChanged', function (data) {
      var item = data.navItem;
      if (item === 'library') {
        self.loadLibrary();
      } else if (item === 'recent') {
        self.loadLibrary({ recentOnly: true });
      } else if (item === 'playlists') {
        self.state.toggleDrawer('playlists');
      } else if (item === 'artists' || item === 'albums' || item === 'genres') {
        self.state.emit('openBrowse', { kind: item });
      } else if (item === 'stats') {
        self.state.emit('openStats');
      } else if (item === 'study') {
        self.state.emit('openStudy');
      } else if (item === 'folders') {
        self.state.toggleDrawer('folders');
      }
    });

    // System Media Keys from Electron
    if (window.MakanDesktop && window.MakanDesktop.onMediaKey) {
      window.MakanDesktop.onMediaKey(function (action) {
        if (action === 'play-pause') self.engine.togglePlay();
        else if (action === 'next') self.controller.next(true);
        else if (action === 'prev') self.controller.previous();
        else if (action === 'stop') { self.engine.pause(); self.engine.seek(0); }
      });
    }

    // CLI args / Second-instance forwarded audio files
    if (window.MakanDesktop && window.MakanDesktop.onOpenFiles) {
      window.MakanDesktop.onOpenFiles(function (filePaths) {
        if (filePaths && filePaths.length) {
          self.scanPaths(filePaths, true);
        }
      });
    }

    // Mini Player window change from Electron
    if (window.MakanDesktop && window.MakanDesktop.onMiniPlayerChanged) {
      window.MakanDesktop.onMiniPlayerChanged(function (isMini) {
        self.toggleMiniPlayer(isMini);
      });
    }

    // Debounced folder watcher notification
    if (window.MakanDesktop && window.MakanDesktop.onLibraryChanged) {
      window.MakanDesktop.onLibraryChanged(function (evt) {
        self.loadLibrary(null, null, true);
      });
    }
  };

  /* Files, folders and playlists opened from Explorer / drag and drop: the songs among the library tracks that
   * belong to them. Files keep the order they were given in; a folder gives every song below it (library order). */
  MakanAppShell.AUDIO_FILE = /\.(mp3|flac|wav|aac|m4a|ogg|opus)$/i;
  MakanAppShell.pickOpened = function (tracks, paths) {
    function norm(p) { return String(p || '').replace(/\//g, '\\').toLowerCase(); }
    var byPath = {}, i;
    for (i = 0; i < tracks.length; i++) { if (tracks[i] && tracks[i].path) byPath[norm(tracks[i].path)] = tracks[i]; }
    var out = [], seen = {}, folders = [];
    for (i = 0; i < paths.length; i++) {
      var n = norm(paths[i]);
      if (!n) continue;
      if (MakanAppShell.AUDIO_FILE.test(n)) {
        var t = byPath[n];
        if (t && !seen[t.id]) { seen[t.id] = true; out.push(t); }
      } else {
        folders.push(n.replace(/\\+$/, '') + '\\');
      }
    }
    if (folders.length) {
      for (i = 0; i < tracks.length; i++) {
        var tr = tracks[i];
        if (!tr || !tr.path || seen[tr.id]) continue;
        var np = norm(tr.path);
        for (var f = 0; f < folders.length; f++) {
          if (np.indexOf(folders[f]) === 0) { seen[tr.id] = true; out.push(tr); break; }
        }
      }
    }
    return out;
  };

  /* What to play for the files / folders that were opened: { tracks, index, found }.
   * One song: the whole library as the queue, starting at that song (so Next goes on through the library).
   * Several files, a folder or a playlist: exactly those songs, in the order given.
   * Nothing found: found is false (the player then says so; it never starts some other song). */
  MakanAppShell.planOpen = function (tracks, paths) {
    var list = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    var none = { tracks: [], index: 0, found: false };
    if (!tracks || !tracks.length || !list.length) return none;
    function norm(p) { return String(p || '').replace(/\//g, '\\').toLowerCase(); }
    if (list.length === 1 && MakanAppShell.AUDIO_FILE.test(String(list[0]))) {
      var want = norm(list[0]);
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i] && tracks[i].path && norm(tracks[i].path) === want) return { tracks: tracks, index: i, found: true };
      }
      return none;
    }
    var chosen = MakanAppShell.pickOpened(tracks, list);
    return chosen.length ? { tracks: chosen, index: 0, found: true } : none;
  };

  MakanAppShell.prototype.scanPaths = function (paths, playFirst) {
    var self = this;
    if (!window.MakanDesktop || !window.MakanDesktop.scan) return;

    function afterScan(summary) {
      // keepPlayback = playFirst: when a song is opened from outside, the old saved song must not be put back over it
      self.loadLibrary(null, function (tracks) {
        if (summary && (summary.added || summary.updated || summary.missing)) {
          self.showToast('Scan complete: ' + (summary.added || 0) + ' added, ' + (summary.updated || 0) + ' updated.', 'info');
        }
        if (!playFirst) return;
        var plan = MakanAppShell.planOpen(tracks, paths);
        if (!plan.found) {
          self.showToast('Could not open that file: it is not in the library.', 'error');
          return;
        }
        // stop what is playing, then start the opened song
        try { if (self.engine && typeof self.engine.pause === 'function') self.engine.pause(); } catch (e) { /* the new song replaces it anyway */ }
        self.controller.setQueue(plan.tracks, plan.index, true);
        if (plan.tracks !== tracks && plan.tracks.length > 1) self.showToast('Playing ' + plan.tracks.length + ' songs', 'info');
      }, !!playFirst);
    }

    var scanning;
    try {
      scanning = window.MakanDesktop.scan(paths, function (progress) {
        // Progress reporting
      });
    } catch (e) { scanning = Promise.reject(e); }
    // even if the scan fails or is busy with another scan, the opened song is still looked up and played
    Promise.resolve(scanning).then(afterScan, function () { afterScan(null); });
  };

  MakanAppShell.prototype.importFilesBrowserFallback = function (fileList) {
    if (!fileList || !fileList.length) return;
    var audioFiles = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(f.name)) {
        audioFiles.push(f);
      }
    }
    if (!audioFiles.length) return;

    var newTracks = [];
    var startIndex = this.state.tracks.length;

    for (var j = 0; j < audioFiles.length; j++) {
      var file = audioFiles[j];
      var name = file.name.replace(/\.[^/.]+$/, '');
      var parts = name.split(' - ');
      var artist = parts.length > 1 ? parts[0].trim() : null;
      var title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : name;
      var blobUrl = URL.createObjectURL(file);

      newTracks.push({
        id: 'track-import-' + Date.now() + '-' + j,
        filename: file.name,
        title: title,
        artist: artist,
        album: null,
        duration: 0,
        codec: file.name.split('.').pop().toLowerCase(),
        bitrate: null,
        sample_rate: null,
        artwork_path: null,
        blobUrl: blobUrl,
        file: file,
        rating: 0,
        cues: []
      });
    }

    this.state.tracks = this.state.tracks.concat(newTracks);
    this.state.totalTracksDisplay = this.state.tracks.length;
    this.state.emit('libraryUpdated');

    this.controller.setQueue(this.state.tracks, startIndex, true);
  };

  MakanAppShell.prototype.bindDragDrop = function () {
    var self = this;
    window.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;

      var files = e.dataTransfer.files;
      if (window.MakanDesktop && window.MakanDesktop.pathOf) {
        var diskPaths = [];
        for (var i = 0; i < files.length; i++) {
          var p = window.MakanDesktop.pathOf(files[i]);
          if (p) diskPaths.push(p);
        }
        if (diskPaths.length) {
          self.scanPaths(diskPaths, true);
          return;
        }
      }

      self.importFilesBrowserFallback(files);
    });
  };

  MakanAppShell.prototype.bindGlobalShortcuts = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      var isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

      // Global shortcuts with modifiers allowed inside text inputs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        var searchEl = self.container.querySelector('#mk-global-search-input') || self.container.querySelector('#mk-lib-search-input');
        if (searchEl) {
          searchEl.focus();
          searchEl.select();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        self.state.emit('requestAddFolder');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        self.state.emit('requestAddFiles');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        self.state.toggleMute();
        self.engine.setVolume(self.state.volume);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        var tbl = self.container.querySelector('#mk-virtual-table-root');
        if (tbl) tbl.focus();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        self.state.toggleDrawer('queue');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        self.state.toggleDrawer('playlists');
        return;
      }

      if (e.key === 'F11') {
        e.preventDefault();
        if (window.MakanDesktop && window.MakanDesktop.maximize) {
          window.MakanDesktop.maximize();
        }
        return;
      }

      // Do not process non-modifier shortcuts while typing in an input
      if (isInput) return;

      // Ctrl+A: Select visible tracks
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (self.sidebar && self.sidebar.trackTable) {
          self.sidebar.trackTable.selectAll();
        }
        return;
      }

      // Enter: Play selected track
      if (e.key === 'Enter') {
        if (self.sidebar && self.sidebar.trackTable && self.sidebar.trackTable.selectedIds && self.sidebar.trackTable.selectedIds.size > 0) {
          e.preventDefault();
          var selTracks = self.sidebar.trackTable.filteredTracks.filter(function (t) {
            return self.sidebar.trackTable.selectedIds.has(t.id);
          });
          if (selTracks.length > 0) {
            self.controller.setContext(selTracks, 0, { type: 'selection', name: 'Selected (' + selTracks.length + ')' }, true);
          }
          return;
        }
      }

      // Delete: Remove selected from active queue or playlist after confirmation
      if (e.key === 'Delete') {
        if (self.sidebar && self.sidebar.trackTable && self.sidebar.trackTable.selectedIds && self.sidebar.trackTable.selectedIds.size > 0) {
          e.preventDefault();
          self.sidebar.trackTable.confirmRemoveSelected();
          return;
        }
      }

      // Play / Pause (Space)
      if (e.code === 'Space') {
        e.preventDefault();
        self.engine.togglePlay();
        return;
      }

      // Escape: Close drawers and clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        self.state.closeDrawers();
        if (self.sidebar && self.sidebar.trackTable) {
          self.sidebar.trackTable.clearSelection();
        }
        return;
      }

      // [ and ]: Lyrics Sync Offset adjustment (-0.1s / +0.1s)
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        var delta = (e.key === ']' ? 0.1 : -0.1);
        self.state.adjustSyncOffset(delta);
        if (self.state.currentTrack && self.state.currentTrack.id && window.MakanDesktop && window.MakanDesktop.setSyncOffset) {
          window.MakanDesktop.setSyncOffset(self.state.currentTrack.id, self.state.syncOffset);
        }
        self.showToast('Lyrics Offset: ' + (self.state.syncOffset >= 0 ? '+' : '') + self.state.syncOffset.toFixed(1) + 's', 'info');
        return;
      }

      // Next / Previous
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        e.preventDefault();
        self.controller.next(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        e.preventDefault();
        self.controller.previous();
        return;
      }

      // Seek &plusmn;5s (Plain Arrow Left / Right)
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        self.engine.seek(self.state.currentTime + 5);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        self.engine.seek(self.state.currentTime - 5);
        return;
      }

      // Volume Up / Down (Ctrl + Arrow Up / Down)
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        self.engine.setVolume(Math.min(1, self.state.volume + 0.05));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        self.engine.setVolume(Math.max(0, self.state.volume - 0.05));
        return;
      }

      // Drawers hotkeys
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        self.state.toggleDrawer('equalizer');
        return;
      }
      if (e.key.toLowerCase() === 'l' && !e.ctrlKey) {
        e.preventDefault();
        self.state.toggleDrawer('lyricsStyle');
        return;
      }
    });
  };

  MakanAppShell.prototype.destroy = function () {
    if (this.engine) {
      this.engine.pause();
    }
  };

  window.MakanAppShell = MakanAppShell;
})();
