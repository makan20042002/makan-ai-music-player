/*
 * media/components/player-stage.js - Centre stage component for MAKAN Music Player.
 * Features:
 * - Album artwork with subtle glow / rounded corners
 * - Honest Song title, Artist name, Favorite button
 * - Honest Technical metadata badges (Format, Bitrate, Sample Rate)
 * - Mounts dual AudioVisualizer (Spectrum + Waveform) directly below
 * - Never invents missing metadata or shows fake tags
 */
(function () {
  'use strict';

  function MakanPlayerStage(container, state, engine) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.el = null;
    this.visualizer = null;

    this.render();
    this.bindEvents();
    this.updateTrackInfo();
    this.updatePotPlayerBadge(this.state.potPlayerMode);
  }

  MakanPlayerStage.prototype.render = function () {
    var icons = window.MakanIcons;

    var html = '' +
      '<div class="mk-player-stage" id="mk-player-stage">' +
      '  <!-- Scene behind everything: the song cover, blurred (a gradient scene when there is no cover) -->' +
      '  <div class="mk-stage-scene" id="mk-stage-scene" aria-hidden="true">' +
      '    <div class="mk-stage-scene-fallback"></div>' +
      '    <div class="mk-stage-bgwash" id="mk-stage-bgwash"></div>' +
      '    <div class="mk-stage-scene-img" id="mk-stage-scene-img"></div>' +
      '    <div class="mk-stage-scene-shade"></div>' +
      '  </div>' +
      '  <!-- Large Square Artwork -->' +
      '  <div class="mk-art-container">' +
      '    <img class="mk-art-img" id="mk-stage-art" src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'250\' height=\'250\' fill=\'%230b1220\'><rect fill-opacity=\'0\' width=\'250\' height=\'250\'/><circle cx=\'125\' cy=\'125\' r=\'50\' fill=\'%233b82f6\' fill-opacity=\'.22\'/></svg>" alt="Album Artwork">' +
      '    <div class="mk-art-reflection"></div>' +
      '  </div>' +
      '' +
      '  <!-- Track Metadata Header -->' +
      '  <div class="mk-stage-meta">' +
      '    <div class="mk-stage-title-row">' +
      '      <h2 class="mk-stage-title" id="mk-stage-title">No Track Loaded</h2>' +
      '      <div class="mk-stage-actions">' +
      '        <button type="button" class="mk-icon-btn mk-stage-find" id="mk-stage-find" title="Find song info: singer, album, year, genre and cover picture from the web">' +
      '          ' + icons.search() +
      '        </button>' +
      '        <button type="button" class="mk-icon-btn mk-stage-heart" id="mk-stage-heart" title="Add to Favorites">' +
      '          ' + icons.heart(false) +
      '        </button>' +
      '        <button type="button" class="mk-icon-btn mk-stage-more" id="mk-stage-more" title="Track Options">' +
      '          ' + icons.more() +
      '        </button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="mk-stage-artist" id="mk-stage-artist">Open a folder or add music files</div>' +
      '' +
      '    <!-- Tech Badges -->' +
      '    <div class="mk-stage-badges">' +
      '      <span class="mk-badge" id="mk-badge-format">—</span>' +
      '      <span class="mk-badge" id="mk-badge-bitrate">—</span>' +
      '      <span class="mk-badge" id="mk-badge-samplerate">—</span>' +
      '      <span class="mk-badge mk-badge-lyrics" id="mk-badge-lyrics" hidden>Lyrics</span>' +
      '      <button type="button" class="mk-badge mk-badge-potplayer" id="mk-stage-potplayer-badge" title="MAKAN Sound: click to switch Off / Natural / Clear / Power">⚡ Sound: Off</button>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- Lyrics mount: the lyric lines are placed here by the app shell -->' +
      '  <div class="mk-stage-lyrics-mount" id="mk-stage-lyrics-mount"></div>' +
      '' +
      '  <!-- Visualizer Mount (Spectrum Bars + Waveform) -->' +
      '  <div class="mk-stage-vis-mount" id="mk-stage-vis-mount"></div>' +
      '</div>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;

    var visMount = this.el.querySelector('#mk-stage-vis-mount');
    this.visualizer = new window.MakanAudioVisualizer(visMount, this.state, this.engine);
  };

  /* Sets the blurred cover scene and the "Lyrics" chip for the current song */
  MakanPlayerStage.prototype.updateScene = function () {
    var track = this.state.currentTrack;
    var img = this.el.querySelector('#mk-stage-scene-img');
    var chip = this.el.querySelector('#mk-badge-lyrics');
    if (img) {
      var url = '';
      if (track && track.art) url = track.art;
      else if (track && track.artwork_path) url = '/api/artwork?id=' + encodeURIComponent(track.id);
      img.style.backgroundImage = url ? 'url("' + String(url).replace(/"/g, '%22') + '")' : '';
      img.classList.toggle('mk-has-cover', !!url);
    }
    if (chip) chip.hidden = !(track && track.cues && track.cues.length);
  };

  MakanPlayerStage.prototype.updateTrackInfo = function () {
    var track = this.state.currentTrack;
    var artEl = this.el.querySelector('#mk-stage-art');
    var titleEl = this.el.querySelector('#mk-stage-title');
    var artistEl = this.el.querySelector('#mk-stage-artist');
    var formatEl = this.el.querySelector('#mk-badge-format');
    var bitrateEl = this.el.querySelector('#mk-badge-bitrate');
    var samplerateEl = this.el.querySelector('#mk-badge-samplerate');
    var heartEl = this.el.querySelector('#mk-stage-heart');

    if (!track) {
      if (titleEl) titleEl.textContent = 'No Track Loaded';
      if (artistEl) artistEl.textContent = 'Open a folder or add music files';
      if (formatEl) formatEl.textContent = '—';
      if (bitrateEl) bitrateEl.textContent = '—';
      if (samplerateEl) samplerateEl.textContent = '—';
      if (artEl) artEl.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='250' height='250' fill='%230b1220'><rect fill-opacity='0' width='250' height='250'/><circle cx='125' cy='125' r='50' fill='%233b82f6' fill-opacity='.22'/></svg>";
      if (heartEl) heartEl.innerHTML = window.MakanIcons.heart(false);
      this.updateScene();
      return;
    }

    if (artEl) {
      if (track.art) {
        artEl.src = track.art;
      } else if (track.artwork_path) {
        artEl.src = '/api/artwork?id=' + encodeURIComponent(track.id);
      } else {
        artEl.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='250' height='250' fill='%230b1220'><rect fill-opacity='0' width='250' height='250'/><circle cx='125' cy='125' r='50' fill='%233b82f6' fill-opacity='.22'/></svg>";
      }
    }
    if (titleEl) titleEl.textContent = track.title || track.filename || 'Untitled';
    if (artistEl) artistEl.textContent = track.artist || 'Unknown Artist';

    if (formatEl) formatEl.textContent = (track.codec || track.format || 'AUDIO').toUpperCase();
    if (bitrateEl) {
      var br = track.bitrate || track.bitRate;
      bitrateEl.textContent = br ? (typeof br === 'number' ? Math.round(br / 1000) + ' kbps' : br) : '—';
    }
    if (samplerateEl) {
      var sr = track.sample_rate || track.sampleRate;
      samplerateEl.textContent = sr ? (typeof sr === 'number' ? (sr / 1000).toFixed(1) + ' kHz' : sr) : '—';
    }

    if (heartEl) {
      heartEl.innerHTML = window.MakanIcons.heart(!!track.rating || !!track.favorite);
    }
    this.updateScene();
  };

  MakanPlayerStage.prototype.bindEvents = function () {
    var self = this;

    var heartBtn = this.el.querySelector('#mk-stage-heart');
    if (heartBtn) {
      heartBtn.addEventListener('click', function () {
        self.state.toggleFavorite();
      });
    }

    var moreBtn = this.el.querySelector('#mk-stage-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        self.state.toggleDrawer('lyricsStyle');
      });
    }

    var findBtn = this.el.querySelector('#mk-stage-find');
    if (findBtn) {
      findBtn.addEventListener('click', function () { self.state.emit('openSongLookup', {}); });
    }

    this.state.on('trackChanged', function () {
      self.updateTrackInfo();
    });

    // tags or cover changed by "Find song info" (the song keeps playing)
    this.state.on('trackMetaEdited', function () {
      self.updateTrackInfo();
      self.updateScene();
    });

    this.state.on('activeLyricChanged', function () {
      self.updateScene();
    });

    this.state.on('favoriteChanged', function (data) {
      if (self.state.currentTrack && self.state.currentTrack.id === data.trackId) {
        var heartEl = self.el.querySelector('#mk-stage-heart');
        if (heartEl) {
          heartEl.innerHTML = window.MakanIcons.heart(data.favorite);
        }
      }
    });

    var potPlayerBadge = this.el.querySelector('#mk-stage-potplayer-badge');
    if (potPlayerBadge) {
      potPlayerBadge.addEventListener('click', function () {
        var next = self.engine.cycleSoundMode();
        if (window.desktopBridge && window.desktopBridge.saveSettings) {
          window.desktopBridge.saveSettings({ potPlayerMode: next !== 'off', soundMode: next });
        }
      });
    }

    this.state.on('potPlayerModeChanged', function (data) {
      self.updatePotPlayerBadge(data.enabled, data.mode);
    });
  };

  MakanPlayerStage.prototype.updatePotPlayerBadge = function (enabled, mode) {
    var badge = this.el ? this.el.querySelector('#mk-stage-potplayer-badge') : null;
    if (!badge) return;
    var isActive = !!enabled;
    if (isActive) {
      badge.classList.add('mk-potplayer-active');
      var mm = mode || (this.engine && this.engine.getSoundMode ? this.engine.getSoundMode() : 'power');
      badge.textContent = '⚡ Sound: ' + ({ natural: 'Natural', clear: 'Clear', power: 'Power' }[mm] || 'Power');
      badge.title = '⚡ MAKAN Sound is ON. Click to switch Off / Natural / Clear / Power.';
    } else {
      badge.classList.remove('mk-potplayer-active');
      badge.textContent = '⚡ Sound: Off';
      badge.title = '⚡ MAKAN Sound is OFF (pure). Click to try Natural / Clear / Power.';
    }
  };

  window.MakanPlayerStage = MakanPlayerStage;
})();
