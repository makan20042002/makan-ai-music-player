/*
 * media/components/transport-dock.js - Bottom Transport Dock for MAKAN Music Player.
 * Features:
 * - Fixed 72px persistent bar
 * - Left: 44x44 thumbnail, Title, Artist, Favorite, More
 * - Center: Shuffle, Prev, Large Cyan circular Play/Pause button with glow, Next, Repeat
 * - Long seekbar with elapsed and total time (never NaN:NaN)
 * - Right: Volume slider with mute toggle, Queue drawer, EQ drawer, Lyrics expand
 */
(function () {
  'use strict';

  function MakanTransportDock(container, state, engine, playbackController) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.controller = playbackController || null;
    this.el = null;

    this.isDraggingSeek = false;
    this._wave = { id: null, peaks: null };
    this._waveLoader = null;

    this.render();
    this.bindEvents();
    this.updateTrackInfo();
    this.updatePlaybackState();
    this.updateTimeDisplay();
    this.loadWave();
  }

  MakanTransportDock.prototype.render = function () {
    var icons = window.MakanIcons;
    var state = this.state;
    var track = state.currentTrack;

    var curTimeStr = state.formatTime(state.currentTime);
    var durTimeStr = state.formatTime(state.duration);
    var progressPct = state.duration > 0 ? ((state.currentTime / state.duration) * 100) : 0;

    var html = '' +
      '<footer class="mk-transport-dock" id="mk-transport-dock">' +
      '  <!-- Left: Mini Track Info -->' +
      '  <div class="mk-dock-left">' +
      '    <img class="mk-dock-art" id="mk-dock-art" src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'44\' height=\'44\' fill=\'%230b1220\'><rect fill-opacity=\'0\' width=\'44\' height=\'44\'/><circle cx=\'22\' cy=\'22\' r=\'12\' fill=\'%233b82f6\' fill-opacity=\'.22\'/></svg>" alt="Artwork">' +
      '    <div class="mk-dock-meta">' +
      '      <div class="mk-dock-title" id="mk-dock-title">MAKAN Music Player</div>' +
      '      <div class="mk-dock-artist" id="mk-dock-artist">No Track Selected</div>' +
      '      <div class="mk-dock-badges" style="display:flex;align-items:center;gap:6px;margin-top:3px;">' +
      '        <span class="mk-badge-playmode" id="mk-dock-playmode-badge" style="font-size:9.5px;padding:1px 5px;border-radius:3px;background:rgba(var(--mk-fg-rgb),0.04);color:var(--mk-text-dim);border:1px solid rgba(var(--mk-fg-rgb),0.08);" title="Playback Mode">Sequential</span>' +
      '        <span class="mk-badge-rg" id="mk-dock-rg-badge" style="font-size:9.5px;padding:1px 5px;border-radius:3px;background:rgba(var(--mk-fg-rgb),0.04);color:var(--mk-text-dim);border:1px solid rgba(var(--mk-fg-rgb),0.08);cursor:pointer;" title="ReplayGain Status">RG: Track</span>' +
      '      </div>' +
      '    </div>' +
      '    <button type="button" class="mk-icon-btn mk-dock-heart" id="mk-dock-heart" title="Favorite">' +
      '      ' + icons.heart(false) +
      '    </button>' +
      '    <button type="button" class="mk-icon-btn mk-dock-more" id="mk-dock-more" title="More Options">' +
      '      ' + icons.more() +
      '    </button>' +
      '  </div>' +
      '' +
      '  <!-- Center: Controls & Scrubber -->' +
      '  <div class="mk-dock-center">' +
      '    <!-- Button Row -->' +
      '    <div class="mk-controls-row">' +
      '      <button type="button" class="mk-ctrl-btn mk-shuffle-btn' + (state.shuffle ? ' mk-active' : '') + (state.shuffleMode === 'albums' ? ' mk-shuffle-albums' : '') + '" id="mk-shuffle-btn" title="' + this._getShuffleTooltip(state.shuffleMode || (state.shuffle ? 'tracks' : 'off')) + '">' +
      '        ' + icons.shuffle(state.shuffleMode || state.shuffle) +
      '      </button>' +
      '      <button type="button" class="mk-ctrl-btn mk-prev-btn" id="mk-prev-btn" title="Previous Track">' +
      '        ' + icons.prev() +
      '      </button>' +
      '      <button type="button" class="mk-play-circle-btn" id="mk-play-btn" title="Play / Pause">' +
      '        ' + (state.isPlaying ? icons.pause() : icons.play()) +
      '      </button>' +
      '      <button type="button" class="mk-ctrl-btn mk-next-btn" id="mk-next-btn" title="Next Track">' +
      '        ' + icons.next() +
      '      </button>' +
      '      <button type="button" class="mk-ctrl-btn mk-repeat-btn' + (state.repeatMode !== 'off' ? ' mk-active' : '') + '" id="mk-repeat-btn" title="Repeat Mode">' +
      '        ' + icons.repeat(state.repeatMode) +
      '      </button>' +
      '    </div>' +
      '' +
      '    <!-- Long Scrubber Seekbar -->' +
      '    <div class="mk-seekbar-row">' +
      '      <span class="mk-time-label" id="mk-time-cur">' + curTimeStr + '</span>' +
      '      <div class="mk-seek-track-wrapper" id="mk-seek-wrapper">' +
      '        <canvas class="mk-seek-wave" id="mk-seek-wave"></canvas>' +
      '        <div class="mk-seek-bg"></div>' +
      '        <div class="mk-seek-fill" id="mk-seek-fill" style="width:' + progressPct + '%"></div>' +
      '        <div class="mk-seek-thumb" id="mk-seek-thumb" style="left:' + progressPct + '%"></div>' +
      '        <input type="range" class="mk-seek-input" id="mk-seek-input" min="0" max="' + (state.duration || 100) + '" value="' + state.currentTime + '" step="0.1">' +
      '      </div>' +
      '      <span class="mk-time-label" id="mk-time-dur">' + durTimeStr + '</span>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- Right: Volume & Drawer Buttons -->' +
      '  <div class="mk-dock-right">' +
      '    <div class="mk-volume-box">' +
      '      <button type="button" class="mk-icon-btn mk-vol-btn" id="mk-vol-btn" title="Mute / Unmute">' +
      '        ' + icons.volume(state.muted ? 0 : (state.volume > 0.5 ? 2 : 1)) +
      '      </button>' +
      '      <div class="mk-vol-slider-wrap">' +
      '        <div class="mk-vol-fill" id="mk-vol-fill" style="width:' + ((state.muted ? 0 : state.volume) * 100) + '%"></div>' +
      '        <input type="range" class="mk-vol-input" id="mk-vol-input" min="0" max="1" step="0.01" value="' + (state.muted ? 0 : state.volume) + '" title="Volume">' +
      '      </div>' +
      '    </div>' +
      '    <button type="button" class="mk-potplayer-dock-btn' + (state.potPlayerMode ? ' mk-potplayer-active' : '') + '" id="mk-dock-potplayer-btn" title="MAKAN Sound: click to switch Off / Natural / Clear / Power">' +
      '      <span class="mk-potplayer-icon">⚡</span>' +
      '      <span class="mk-potplayer-text" id="mk-dock-potplayer-text">' + (state.potPlayerMode ? 'Sound: ' + ({ natural: 'Natural', clear: 'Clear', power: 'Power' }[state.soundMode] || 'Power') : 'Sound: Off') + '</span>' +
      '    </button>' +
      '    <button type="button" class="mk-icon-btn mk-drawer-btn" id="mk-dock-queue-btn" title="Queue">' +
      '      ' + icons.queue() +
      '    </button>' +
      '    <button type="button" class="mk-icon-btn mk-drawer-btn" id="mk-dock-eq-btn" title="Equalizer">' +
      '      ' + icons.equalizer() +
      '    </button>' +
      '    <button type="button" class="mk-icon-btn mk-drawer-btn" id="mk-dock-theatre-btn" title="Lyrics Theatre">' +
      '      ' + icons.lyricsTheatre() +
      '    </button>' +
      '  </div>' +
      '</footer>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;
  };

  MakanTransportDock.prototype.updateTrackInfo = function () {
    var track = this.state.currentTrack;
    var artEl = this.el.querySelector('#mk-dock-art');
    var titleEl = this.el.querySelector('#mk-dock-title');
    var artistEl = this.el.querySelector('#mk-dock-artist');
    var heartEl = this.el.querySelector('#mk-dock-heart');

    if (!track) {
      if (titleEl) titleEl.textContent = 'MAKAN Music Player';
      if (artistEl) artistEl.textContent = 'No Track Selected';
      if (artEl) artEl.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='%230b1220'><rect fill-opacity='0' width='44' height='44'/><circle cx='22' cy='22' r='12' fill='%233b82f6' fill-opacity='.22'/></svg>";
      if (heartEl) heartEl.innerHTML = window.MakanIcons.heart(false);
      this.updateTimeDisplay();
      return;
    }

    if (artEl) {
      if (track.art) {
        artEl.src = track.art;
      } else if (track.artwork_path) {
        artEl.src = '/api/artwork?id=' + encodeURIComponent(track.id);
      } else {
        artEl.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='%230b1220'><rect fill-opacity='0' width='44' height='44'/><circle cx='22' cy='22' r='12' fill='%233b82f6' fill-opacity='.22'/></svg>";
      }
    }
    if (titleEl) titleEl.textContent = track.title || track.filename || 'Untitled';
    if (artistEl) artistEl.textContent = track.artist || 'Unknown Artist';
    if (heartEl) heartEl.innerHTML = window.MakanIcons.heart(!!track.rating || !!track.favorite);

    this.updateTimeDisplay();
  };

  MakanTransportDock.prototype.updatePlaybackState = function () {
    var playBtn = this.el.querySelector('#mk-play-btn');
    if (playBtn) {
      playBtn.innerHTML = this.state.isPlaying ? window.MakanIcons.pause() : window.MakanIcons.play();
      if (this.state.isPlaying) {
        playBtn.classList.add('playing');
      } else {
        playBtn.classList.remove('playing');
      }
    }
  };

  /* the song's shape behind the seek bar (falls back to the plain bar when it cannot be made) */
  MakanTransportDock.prototype.drawWave = function (pct) {
    var W = window.MakanWaveform;
    var wrap = this.el && this.el.querySelector('#mk-seek-wrapper');
    var cv = this.el && this.el.querySelector('#mk-seek-wave');
    if (!W || !wrap || !cv) return;
    if (!this._wave.peaks) { wrap.classList.remove('mk-has-wave'); return; }
    wrap.classList.add('mk-has-wave');
    var cs = window.getComputedStyle(document.documentElement);
    var rgb = (cs.getPropertyValue('--mk-fg-rgb') || '255,255,255').trim();
    var played = (cs.getPropertyValue('--mk-accent-cyan') || '#22d3ee').trim();
    W.draw(cv, this._wave.peaks, pct, { played: played, rest: 'rgba(' + rgb + ',0.28)' });
  };

  MakanTransportDock.prototype.loadWave = function () {
    var self = this;
    var W = window.MakanWaveform;
    var track = this.state.currentTrack;
    if (!W) return;
    if (!track || !track.id) { this._wave = { id: null, peaks: null }; this.drawWave(0); return; }
    if (this._wave.id === track.id) return;
    this._wave = { id: track.id, peaks: null };
    this.drawWave(0);
    if (!this._waveLoader) {
      this._waveLoader = W.createLoader({
        api: window.MakanDesktop,
        onDecoded: function (tr, buf) {
          var S = window.MakanSound;
          if (!S) return;
          if (!self._sound) self._sound = S.createAnalyser({ api: window.MakanDesktop });
          self._sound.learn(tr, buf);
        }
      });
    }
    var id = track.id;
    // let the song start first, then draw its shape
    setTimeout(function () {
      if (self.state.currentTrack && self.state.currentTrack.id !== id) return;
      self._waveLoader.load(track).then(function (peaks) {
        if (!peaks || !self.state.currentTrack || self.state.currentTrack.id !== id) return;
        self._wave = { id: id, peaks: peaks };
        var dur = self.state.duration || 0;
        self.drawWave(dur > 0 ? (self.state.currentTime / dur) * 100 : 0);
      });
    }, 600);
  };

  MakanTransportDock.prototype.updateTimeDisplay = function () {
    if (this.isDraggingSeek) return;

    var cur = this.state.currentTime || 0;
    var dur = this.state.duration || 0;

    var curEl = this.el.querySelector('#mk-time-cur');
    var durEl = this.el.querySelector('#mk-time-dur');
    var fillEl = this.el.querySelector('#mk-seek-fill');
    var thumbEl = this.el.querySelector('#mk-seek-thumb');
    var inputEl = this.el.querySelector('#mk-seek-input');

    if (curEl) curEl.textContent = this.state.formatTime(cur);
    if (durEl) durEl.textContent = this.state.formatTime(dur);

    var pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    if (fillEl) fillEl.style.width = pct + '%';
    if (thumbEl) thumbEl.style.left = pct + '%';
    this.drawWave(pct);
    if (inputEl) {
      inputEl.max = dur > 0 ? dur : 100;
      inputEl.value = cur;
    }
  };

  MakanTransportDock.prototype.updateVolumeDisplay = function () {
    var vol = this.state.muted ? 0 : this.state.volume;
    var fillEl = this.el.querySelector('#mk-vol-fill');
    var inputEl = this.el.querySelector('#mk-vol-input');
    var btnEl = this.el.querySelector('#mk-vol-btn');

    if (fillEl) fillEl.style.width = (vol * 100) + '%';
    if (inputEl) inputEl.value = vol;
    if (btnEl) {
      var level = this.state.muted ? 0 : (vol > 0.5 ? 2 : 1);
      btnEl.innerHTML = window.MakanIcons.volume(level);
    }
  };

  MakanTransportDock.prototype._getShuffleTooltip = function (mode) {
    if (mode === 'albums') {
      return 'Shuffle: Shuffle Albums (Randomize albums, preserve track order)';
    }
    if (mode === 'tracks' || mode === true) {
      return 'Shuffle: True Shuffle (Unbiased, no repeats during cycle)';
    }
    return 'Shuffle: Off (Sequential Playback)';
  };

  MakanTransportDock.prototype.updateShuffleButton = function (mode) {
    var sBtn = this.el ? this.el.querySelector('#mk-shuffle-btn') : null;
    if (!sBtn) return;
    var currentMode = mode || this.state.shuffleMode || (this.state.shuffle ? 'tracks' : 'off');
    sBtn.innerHTML = window.MakanIcons.shuffle(currentMode);
    sBtn.title = this._getShuffleTooltip(currentMode);
    if (currentMode === 'albums') {
      sBtn.classList.add('mk-active', 'mk-shuffle-albums');
    } else if (currentMode === 'tracks') {
      sBtn.classList.add('mk-active');
      sBtn.classList.remove('mk-shuffle-albums');
    } else {
      sBtn.classList.remove('mk-active', 'mk-shuffle-albums');
    }
  };

  MakanTransportDock.prototype.updateModeBadges = function (rgData) {
    var rgBadge = this.el.querySelector('#mk-dock-rg-badge');
    var playmodeBadge = this.el.querySelector('#mk-dock-playmode-badge');

    if (playmodeBadge) {
      if (this.state.repeatMode === 'one') {
        playmodeBadge.textContent = 'Repeat 1';
        playmodeBadge.style.color = 'var(--mk-accent-cyan, #06b6d4)';
        playmodeBadge.style.borderColor = 'rgba(6,182,212,0.3)';
      } else if (this.state.shuffleMode === 'albums') {
        playmodeBadge.textContent = 'Shuffle Albums';
        playmodeBadge.style.color = 'var(--mk-alt-accent, #38bdf8)';
        playmodeBadge.style.borderColor = 'rgba(var(--mk-alt-accent-rgb), 0.3)';
      } else if (this.state.shuffleMode === 'tracks' || this.state.shuffle) {
        if (this.state.repeatMode === 'all') {
          playmodeBadge.textContent = 'True Shuffle & All';
        } else {
          playmodeBadge.textContent = 'True Shuffle';
        }
        playmodeBadge.style.color = '#a855f7';
        playmodeBadge.style.borderColor = 'rgba(168,85,247,0.3)';
      } else if (this.state.repeatMode === 'all') {
        playmodeBadge.textContent = 'Repeat All';
        playmodeBadge.style.color = 'var(--mk-accent-cyan, #06b6d4)';
        playmodeBadge.style.borderColor = 'rgba(6,182,212,0.3)';
      } else {
        playmodeBadge.textContent = 'Sequential';
        playmodeBadge.style.color = 'var(--mk-text-dim, #94a3b8)';
        playmodeBadge.style.borderColor = 'rgba(var(--mk-fg-rgb),0.08)';
      }
    }

    if (rgBadge) {
      var mode = (rgData && rgData.mode) || this.state.replayGainMode || 'track';
      var track = this.state.currentTrack;
      var hasTags = rgData ? !!rgData.hasTags : !!(track && (track.replaygain_track_gain || track.replaygain_album_gain));

      if (mode === 'off') {
        rgBadge.textContent = 'RG: Off';
        rgBadge.style.color = 'var(--mk-text-dim, #94a3b8)';
        rgBadge.style.borderColor = 'rgba(var(--mk-fg-rgb),0.08)';
        rgBadge.title = 'ReplayGain: Off';
      } else if (mode === 'prevent_clipping') {
        rgBadge.textContent = 'RG: Limiter';
        rgBadge.style.color = 'var(--mk-alt-accent, #0284c7)';
        rgBadge.style.borderColor = 'rgba(2,132,199,0.3)';
        rgBadge.title = 'ReplayGain: Prevent Clipping Limiter';
      } else if (mode === 'album') {
        if (hasTags) {
          var gStr = (rgData && rgData.gainDb !== undefined) ? ((rgData.gainDb >= 0 ? '+' : '') + rgData.gainDb.toFixed(1) + ' dB') : 'Tagged';
          rgBadge.textContent = 'RG: Album (' + gStr + ')';
          rgBadge.style.color = '#10b981';
          rgBadge.style.borderColor = 'rgba(16,185,129,0.3)';
          rgBadge.title = 'ReplayGain: Album Gain active (' + gStr + ')';
        } else {
          rgBadge.textContent = 'RG: Album (Fallback)';
          rgBadge.style.color = '#f59e0b';
          rgBadge.style.borderColor = 'rgba(245,158,11,0.3)';
          rgBadge.title = 'ReplayGain: Untagged track, using fallback preamp';
        }
      } else {
        if (hasTags) {
          var gStr = (rgData && rgData.gainDb !== undefined) ? ((rgData.gainDb >= 0 ? '+' : '') + rgData.gainDb.toFixed(1) + ' dB') : 'Tagged';
          rgBadge.textContent = 'RG: Track (' + gStr + ')';
          rgBadge.style.color = '#10b981';
          rgBadge.style.borderColor = 'rgba(16,185,129,0.3)';
          rgBadge.title = 'ReplayGain: Track Gain active (' + gStr + ')';
        } else {
          rgBadge.textContent = 'RG: Track (Fallback)';
          rgBadge.style.color = '#f59e0b';
          rgBadge.style.borderColor = 'rgba(245,158,11,0.3)';
          rgBadge.title = 'ReplayGain: Untagged track, using fallback preamp';
        }
      }
    }
  };

  MakanTransportDock.prototype.updatePotPlayerState = function (enabled, mode) {
    var btn = this.el ? this.el.querySelector('#mk-dock-potplayer-btn') : null;
    var textEl = this.el ? this.el.querySelector('#mk-dock-potplayer-text') : null;
    var isActive = !!enabled;
    if (btn) {
      if (isActive) {
        btn.classList.add('mk-potplayer-active');
        btn.title = '⚡ MAKAN Sound is ON. Click to switch Off / Natural / Clear / Power.';
      } else {
        btn.classList.remove('mk-potplayer-active');
        btn.title = '⚡ MAKAN Sound is OFF (pure). Click to try Natural / Clear / Power.';
      }
    }
    if (textEl) {
      var mm = mode || (this.engine && this.engine.getSoundMode ? this.engine.getSoundMode() : 'power');
      textEl.textContent = isActive ? 'Sound: ' + ({ natural: 'Natural', clear: 'Clear', power: 'Power' }[mm] || 'Power') : 'Sound: Off';
    }
  };

  MakanTransportDock.prototype.bindEvents = function () {
    var self = this;

    // Play/Pause
    var playBtn = this.el.querySelector('#mk-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        self.engine.togglePlay();
      });
    }

    // Prev / Next
    var prevBtn = this.el.querySelector('#mk-prev-btn');
    var nextBtn = this.el.querySelector('#mk-next-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (self.controller) {
          self.controller.previous();
        } else {
          self.state.prevTrack();
          self.engine.loadTrack(self.state.currentTrack, true);
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (self.controller) {
          self.controller.next(true);
        } else {
          self.state.nextTrack();
          self.engine.loadTrack(self.state.currentTrack, true);
        }
      });
    }

    // Shuffle / Repeat
    var shuffleBtn = this.el.querySelector('#mk-shuffle-btn');
    var repeatBtn = this.el.querySelector('#mk-repeat-btn');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', function () {
        var nextMode;
        if (self.controller && typeof self.controller.cycleShuffleMode === 'function') {
          nextMode = self.controller.cycleShuffleMode();
        } else if (typeof self.state.cycleShuffleMode === 'function') {
          nextMode = self.state.cycleShuffleMode();
        } else {
          self.state.toggleShuffle();
          nextMode = self.state.shuffle ? 'tracks' : 'off';
        }
        self.updateShuffleButton(nextMode);
        self.updateModeBadges();
      });
    }
    if (repeatBtn) {
      repeatBtn.addEventListener('click', function () {
        var nextMode = self.state.repeatMode === 'off' ? 'all' : (self.state.repeatMode === 'all' ? 'one' : 'off');
        if (self.controller) {
          self.controller.setRepeatMode(nextMode);
        } else {
          self.state.repeatMode = nextMode;
          self.state.emit('repeatChanged', { repeatMode: nextMode });
        }
        this.innerHTML = window.MakanIcons.repeat(self.state.repeatMode);
        if (self.state.repeatMode !== 'off') this.classList.add('mk-active');
        else this.classList.remove('mk-active');
      });
    }

    // Seek input
    var seekInput = this.el.querySelector('#mk-seek-input');
    if (seekInput) {
      seekInput.addEventListener('mousedown', function () {
        self.isDraggingSeek = true;
      });
      seekInput.addEventListener('input', function (e) {
        var val = parseFloat(e.target.value);
        var dur = self.state.duration || 1;
        var pct = (val / dur) * 100;
        var fillEl = self.el.querySelector('#mk-seek-fill');
        var thumbEl = self.el.querySelector('#mk-seek-thumb');
        var curEl = self.el.querySelector('#mk-time-cur');
        if (fillEl) fillEl.style.width = pct + '%';
        if (thumbEl) thumbEl.style.left = pct + '%';
        self.drawWave(pct);
        if (curEl) curEl.textContent = self.state.formatTime(val);
      });
      seekInput.addEventListener('change', function (e) {
        self.isDraggingSeek = false;
        var val = parseFloat(e.target.value);
        self.engine.seek(val);
      });
    }

    // Volume input & mute button
    var volInput = this.el.querySelector('#mk-vol-input');
    var volBtn = this.el.querySelector('#mk-vol-btn');
    if (volInput) {
      volInput.addEventListener('input', function (e) {
        self.engine.setVolume(parseFloat(e.target.value));
        self.updateVolumeDisplay();
      });
    }
    if (volBtn) {
      volBtn.addEventListener('click', function () {
        self.state.toggleMute();
        self.engine.setVolume(self.state.volume);
        self.updateVolumeDisplay();
      });
    }

    // Heart button
    var heartBtn = this.el.querySelector('#mk-dock-heart');
    if (heartBtn) {
      heartBtn.addEventListener('click', function () {
        self.state.toggleFavorite();
      });
    }

    // Drawer buttons
    var qBtn = this.el.querySelector('#mk-dock-queue-btn');
    var eqBtn = this.el.querySelector('#mk-dock-eq-btn');
    var thBtn = this.el.querySelector('#mk-dock-theatre-btn');

    if (qBtn) {
      qBtn.addEventListener('click', function () {
        self.state.toggleDrawer('queue');
      });
    }
    if (eqBtn) {
      eqBtn.addEventListener('click', function () {
        self.state.toggleDrawer('equalizer');
      });
    }
    if (thBtn) {
      thBtn.addEventListener('click', function () {
        self.state.toggleDrawer('lyricsStyle');
      });
    }

    // State events
    this.state.on('trackMetaEdited', function () { if (typeof self.updateTrackInfo === 'function') self.updateTrackInfo(); });
    this.state.on('trackChanged', function () {
      self.updateTrackInfo();
      self.loadWave();
      self.updateModeBadges();
    });

    this.state.on('playStateChanged', function () {
      self.updatePlaybackState();
    });

    this.state.on('timeUpdated', function () {
      self.updateTimeDisplay();
    });

    this.state.on('durationUpdated', function () {
      self.updateTimeDisplay();
    });

    this.state.on('volumeChanged', function () {
      self.updateVolumeDisplay();
    });

    this.state.on('shuffleChanged', function (data) {
      var mode = data.shuffleMode || (data.shuffle ? 'tracks' : 'off');
      self.updateShuffleButton(mode);
      self.updateModeBadges();
    });

    this.state.on('repeatChanged', function (data) {
      var rBtn = self.el.querySelector('#mk-repeat-btn');
      if (rBtn) {
        rBtn.innerHTML = window.MakanIcons.repeat(data.repeatMode);
        if (data.repeatMode !== 'off') rBtn.classList.add('mk-active');
        else rBtn.classList.remove('mk-active');
      }
      self.updateModeBadges();
    });

    this.state.on('replayGainChanged', function (data) {
      self.updateModeBadges(data);
    });

    var rgBadge = this.el.querySelector('#mk-dock-rg-badge');
    if (rgBadge) {
      rgBadge.addEventListener('click', function () {
        self.state.toggleDrawer('settings');
        var audioTabBtn = document.querySelector('button[data-set-tab="audio"]');
        if (audioTabBtn) audioTabBtn.click();
      });
    }

    this.updateModeBadges();

    this.state.on('favoriteChanged', function (data) {
      if (self.state.currentTrack && self.state.currentTrack.id === data.trackId) {
        var hEl = self.el.querySelector('#mk-dock-heart');
        if (hEl) hEl.innerHTML = window.MakanIcons.heart(data.favorite);
      }
    });

    // PotPlayer HQ Button Toggle & Sync
    var potPlayerBtn = this.el.querySelector('#mk-dock-potplayer-btn');
    if (potPlayerBtn) {
      potPlayerBtn.addEventListener('click', function () {
        var next = self.engine.cycleSoundMode();
        if (window.desktopBridge && window.desktopBridge.saveSettings) {
          window.desktopBridge.saveSettings({ potPlayerMode: next !== 'off', soundMode: next });
        }
      });
    }

    this.state.on('potPlayerModeChanged', function (data) {
      self.updatePotPlayerState(data.enabled, data.mode);
    });

    this.updatePotPlayerState(this.state.potPlayerMode);
  };

  window.MakanTransportDock = MakanTransportDock;
})();
