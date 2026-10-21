/*
 * media/components/drawers.js - Slide-over Drawers & Dialogs for MAKAN Music Player v1.6.0.
 * Modules:
 * - FoldersDrawer (Watched folders, status badges, track counts, rescan, relink, cancel, scan summary)
 * - EqualizerDrawer (10-Band EQ, Preamp, Bypass, 8 Presets, Stereo Pan)
 * - LyricsStyleDrawer (Typography, Sizes, Reactive Color & Intensity)
 * - QueueDrawer (Priority explicit queue, reorder, remove, clear, save as playlist)
 * - PlaylistsDrawer (List, Duration & Track count, Reorder, Temporary sort, Restore manual order, Import/Export M3U)
 * - SettingsDrawer (7 structured sections: Playback, Library, Appearance, Lyrics, Windows, Shortcuts reference, About, Reset)
 * - AI Dialog
 */
(function () {
  'use strict';

  var EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rock: [4.5, 3.0, 1.5, 0.0, -1.0, -1.0, 1.0, 2.5, 3.5, 4.0],
    pop: [-1.5, -0.5, 1.5, 3.0, 4.0, 3.5, 1.5, 0.0, -1.0, -1.5],
    classical: [4.0, 3.0, 2.5, 2.0, -1.5, -1.5, 0.0, 2.0, 3.0, 3.5],
    electronic: [4.5, 4.0, 1.5, 0.0, -2.0, 1.5, 0.5, 1.5, 4.0, 4.5],
    vocal: [-1.5, -3.0, -1.5, 1.5, 3.5, 3.5, 2.0, 0.5, -1.0, -2.0],
    bass_boost: [6.0, 5.0, 3.5, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    treble_boost: [0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 3.5, 5.0, 6.0],
    potplayer: [1.5, 1.0, 0.5, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 0.5],
    crystal: [1.0, 0.5, 0.0, 0.0, 0.0, 0.5, 1.0, 1.5, 2.0, 2.0],
    clear: [0.5, 0.5, 0.0, -0.5, 0.0, 0.5, 1.0, 1.0, 0.5, 0.5],
    custom: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  function MakanDrawers(container, state, engine, playbackController) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.controller = playbackController || null;
    this.el = null;

    this.playlists = [];
    this.smartPlaylists = [];
    this.folders = [];
    this.activeSettingsTab = 'playback';
    try { this.state.autoMix = window.localStorage.getItem('makan.autoMix') === '1'; } catch (e) { this.state.autoMix = false; }
    this.isScanning = false;
    this.selectedQueueIndices = new Set();
    this.lastSelectedQueueIndex = null;

    this.render();
    this.bindEvents();
    var drawersSelf = this;
    this.state.on('openSongLookup', function () { drawersSelf.openSongLookup(); });
    if (window.MakanSound && window.MakanSound.loadAll) window.MakanSound.loadAll(window.MakanDesktop);
    // keys the person chose to remember on this PC (encrypted by Windows) come back at start
    (function () {
      var api = window.MakanDesktop;
      var TT = window.MakanLyricsTranslate && window.MakanLyricsTranslate.getShared ? window.MakanLyricsTranslate.getShared() : null;
      if (!(api && api.getSavedKeys && TT)) return;
      api.getSavedKeys().then(function (k) {
        TT._saved = TT._saved || {};
        Object.keys(k || {}).forEach(function (id) { if (TT.setKey(id, k[id])) TT._saved[id] = true; });
      }).catch(function () {});
    })();
    this.state.on('openBrowse', function (d) { drawersSelf.openBrowse(d && d.kind); });
    this.state.on('openStats', function () { drawersSelf.openStats(); });
    this.state.on('openStudy', function () { drawersSelf.openStudy(); });
    this.state.on('openPlaylist', function (d) { if (d && d.id) drawersSelf.openPlaylistView(d.id, d.name); });
  }

  MakanDrawers.prototype.render = function () {
    var icons = window.MakanIcons;
    var state = this.state;

    var html = '' +
      '<div class="mk-drawers-container" id="mk-drawers-container">' +
      '  <!-- Scrim Background -->' +
      '  <div class="mk-drawer-scrim" id="mk-drawer-scrim" hidden></div>' +
      '' +
      '  <!-- 1. Folders Drawer -->' +
      '  <div class="mk-drawer mk-folders-drawer" id="mk-folders-drawer" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">Watched Music Folders</h3>' +
      '      <div style="display:flex;align-items:center;gap:6px;">' +
      '        <button type="button" class="mk-btn mk-btn-primary" id="mk-folders-add-btn" style="padding:2px 8px;font-size:11px;">+ Add Folder</button>' +
      '        <button type="button" class="mk-btn mk-btn-secondary" id="mk-folders-rescan-all-btn" style="padding:2px 8px;font-size:11px;">Rescan All</button>' +
      '        <button type="button" class="mk-btn mk-btn-danger" id="mk-folders-cancel-scan-btn" style="padding:2px 8px;font-size:11px;" hidden>Cancel Scan</button>' +
      '        <button type="button" class="mk-icon-btn mk-drawer-close" data-close="folders">' + icons.close() + '</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="mk-drawer-body">' +
      '      <div id="mk-scan-status-banner" style="display:none;padding:8px 12px;background:rgba(0,240,255,0.08);border:1px solid rgba(0,240,255,0.2);border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--mk-accent-cyan);">' +
      '        <span id="mk-scan-status-text">Scanning in progress...</span>' +
      '      </div>' +
      '      <div class="mk-folders-list" id="mk-folders-list">' +
      this._renderFoldersList() +
      '      </div>' +
      '      <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '        <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mk-text);cursor:pointer;">' +
      '          <input type="checkbox" id="mk-setting-folder-watch-chk"' + (state.folderWatching !== false ? ' checked' : '') + '> ' +
      '          <span>Enable automatic debounced folder watching (monitors additions, deletions &amp; sidecar lyrics)</span>' +
      '        </label>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 2. Equalizer Drawer -->' +
      '  <div class="mk-drawer mk-eq-drawer" id="mk-eq-drawer" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">10-Band Graphic Equalizer</h3>' +
      '      <button type="button" class="mk-icon-btn mk-drawer-close" data-close="equalizer">' + icons.close() + '</button>' +
      '    </div>' +
      '    <div class="mk-drawer-body">' +
      '      <div class="mk-eq-top-row">' +
      '        <label class="mk-eq-preset-label">' +
      '          <span>Preset:</span>' +
      '          <select class="mk-select" id="mk-eq-preset-sel">' +
      '            <option value="flat">Flat</option>' +
      '            <option value="rock">Rock</option>' +
      '            <option value="pop">Pop</option>' +
      '            <option value="jazz">Jazz</option>' +
      '            <option value="classical">Classical</option>' +
      '            <option value="electronic">Electronic</option>' +
      '            <option value="vocal">Vocal</option>' +
      '            <option value="bass_boost">Bass Boost</option>' +
      '            <option value="treble_boost">Treble Boost</option>' +
      '            <option value="potplayer">MAKAN Power (fuller &amp; clearer)</option>' +
      '            <option value="clear">MAKAN Clear (clearer voice)</option>' +
      '            <option value="crystal">Crystalizer Sparkle</option>' +
      '            <option value="custom">Custom</option>' +
      '          </select>' +
      '        </label>' +
      '        <label class="mk-checkbox-label">' +
      '          <input type="checkbox" id="mk-eq-bypass-chk"' + (state.eqBypass ? ' checked' : '') + '> Bypass EQ' +
      '        </label>' +
      '        <button type="button" class="mk-btn mk-btn-secondary" id="mk-eq-reset-btn" style="padding:2px 8px;font-size:11px;">Reset</button>' +
      '      </div>' +
      '      <div class="mk-eq-preamp-row" style="display:flex;align-items:center;gap:12px;margin:12px 0;padding:8px 12px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.05);border-radius:6px;">' +
      '        <span style="font-size:12px;font-weight:600;min-width:60px;">Preamp:</span>' +
      '        <input type="range" class="mk-range" id="mk-eq-preamp" min="-12" max="12" step="0.5" value="' + (state.eqPreamp || 0) + '" style="flex:1;">' +
      '        <span id="mk-eq-preamp-val" style="font-size:12px;min-width:48px;text-align:right;">' + ((state.eqPreamp || 0) >= 0 ? '+' : '') + (state.eqPreamp || 0).toFixed(1) + ' dB</span>' +
      '      </div>' +
      '      <div class="mk-eq-sliders-row" id="mk-eq-sliders-row">' +
      this._renderEqSliders() +
      '      </div>' +
      '      <div class="mk-pan-row">' +
      '        <span class="mk-pan-label">Stereo Balance (Pan L &lt;---&gt; R):</span>' +
      '        <input type="range" class="mk-range-pan" id="mk-stereo-pan" min="-1" max="1" step="0.05" value="' + (state.pan || 0) + '">' +
      '      </div>' +
      '      <div class="mk-dsp-section" style="margin-top:10px;padding:10px 12px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;display:flex;flex-direction:column;gap:8px;">' +
      '        <div style="font-size:11px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;letter-spacing:0.5px;">MAKAN Sound Engine</div>' +
      '        <div class="mk-pan-row" style="margin:0;display:flex;align-items:center;gap:10px;">' +
      '          <span class="mk-pan-label" style="min-width:140px;font-size:11.5px;">Sound mode:</span>' +
      '          <select id="mk-eq-sound-mode-sel" style="flex:1;">' +
      '            <option value="off"' + ((state.soundMode || 'off') === 'off' ? ' selected' : '') + '>Off (pure, untouched)</option>' +
      '            <option value="natural"' + (state.soundMode === 'natural' ? ' selected' : '') + '>Natural (even volume, true tone)</option>' +
      '            <option value="clear"' + (state.soundMode === 'clear' ? ' selected' : '') + '>Clear (even volume + clearer voice)</option>' +
      '            <option value="power"' + (state.soundMode === 'power' ? ' selected' : '') + '>Power (louder, fuller)</option>' +
      '          </select>' +
      '        </div>' +
      '        <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">' +
      '          <input type="checkbox" id="mk-eq-normalizer-chk"' + (state.loudnessNormalizer ? ' checked' : '') + '> Loudness Normalizer (quiet songs up, loud songs down)' +
      '        </label>' +
      '        <div class="mk-pan-row" style="margin:0;display:flex;align-items:center;gap:10px;">' +
      '          <span class="mk-pan-label" style="min-width:140px;font-size:11.5px;">Normalizer strength:</span>' +
      '          <select id="mk-eq-strength-sel" style="flex:1;">' +
      '            <option value="gentle"' + (state.normalizerStrength === 'gentle' ? ' selected' : '') + '>Gentle (natural)</option>' +
      '            <option value="normal"' + (state.normalizerStrength === 'normal' ? ' selected' : '') + '>Normal</option>' +
      '            <option value="strong"' + ((state.normalizerStrength || 'strong') === 'strong' ? ' selected' : '') + '>Strong (loud &amp; full)</option>' +
      '          </select>' +
      '        </div>' +
      '        <div class="mk-pan-row" style="margin:0;display:flex;align-items:center;gap:10px;">' +
      '          <span class="mk-pan-label" style="min-width:140px;font-size:11.5px;">Stereo Width (3D Expander):</span>' +
      '          <input type="range" class="mk-range-pan" id="mk-eq-stereo-width" min="0.5" max="2.0" step="0.05" value="' + (state.stereoWidth !== undefined ? state.stereoWidth : 1.0) + '" style="flex:1;">' +
      '          <span id="mk-eq-stereo-width-val" style="font-size:11.5px;min-width:38px;text-align:right;">' + (state.stereoWidth !== undefined ? Number(state.stereoWidth).toFixed(2) : '1.00') + 'x</span>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 3. Lyrics Style Drawer -->' +
      '  <div class="mk-drawer mk-style-drawer" id="mk-style-drawer" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">Lyrics Styling &amp; Reactive Theme</h3>' +
      '      <button type="button" class="mk-icon-btn mk-drawer-close" data-close="lyricsStyle">' + icons.close() + '</button>' +
      '    </div>' +
      '    <div class="mk-drawer-body">' +
      '      <label class="mk-style-field">' +
      '        <span>Visualizer Theme:</span>' +
      '        <select class="mk-select" id="mk-vis-theme-sel">' +
      '          <option value="cyan"' + (state.visualizerTheme === 'cyan' ? ' selected' : '') + '>Cyan (Vibrant Electric Cyan &amp; Magenta)</option>' +
      '          <option value="aurora"' + (state.visualizerTheme === 'aurora' ? ' selected' : '') + '>Aurora Borealis (Emerald &amp; Lime)</option>' +
      '          <option value="rainbow"' + (state.visualizerTheme === 'rainbow' ? ' selected' : '') + '>Rainbow Chromatic (Reactive Spectrum)</option>' +
      '          <option value="custom"' + (state.visualizerTheme === 'custom' ? ' selected' : '') + '>Custom Violet Glow</option>' +
      '          <option value="sunset"' + (state.visualizerTheme === 'sunset' ? ' selected' : '') + '>Sunset (Orange &amp; Pink)</option>' +
      '          <option value="ocean"' + (state.visualizerTheme === 'ocean' ? ' selected' : '') + '>Ocean (Blue &amp; Teal)</option>' +
      '          <option value="gold"' + (state.visualizerTheme === 'gold' ? ' selected' : '') + '>Gold (Champagne)</option>' +
      '          <option value="violet"' + (state.visualizerTheme === 'violet' ? ' selected' : '') + '>Violet Night</option>' +
      '          <option value="candy"' + (state.visualizerTheme === 'candy' ? ' selected' : '') + '>Candy (Pastel)</option>' +
      '        </select>' +
      '      </label>' +
      '      <label class="mk-checkbox-label">' +
      '        <input type="checkbox" id="mk-reactive-lyrics-chk"' + (state.soundReactiveLyrics ? ' checked' : '') + '> Sound-Reactive Lyric Colouring' +
      '      </label>' +
      '      <label class="mk-style-field">' +
      '        <span style="display:flex;justify-content:space-between;"><span>Reactive Intensity:</span><span id="mk-reactive-intensity-val">' + (state.reactiveIntensity !== undefined ? Number(state.reactiveIntensity).toFixed(1) : '1.0') + 'x</span></span>' +
      '        <input type="range" class="mk-range" id="mk-reactive-intensity" min="0.2" max="2.0" step="0.1" value="' + (state.reactiveIntensity !== undefined ? state.reactiveIntensity : 1.0) + '">' +
      '      </label>' +
      '      <label class="mk-style-field">' +
      '        <span>Subtitle / Lyric Font:</span>' +
      '        <select class="mk-select" id="mk-font-sel">' + this._lyricFontOptions(state.lyricsFontFamily, 'en') + '</select>' +
      '      </label>' +
      '      <label class="mk-style-field">' +
      '        <span>Translation Font (Persian friendly):</span>' +
      '        <select class="mk-select" id="mk-trans-font-sel">' + this._lyricFontOptions(state.lyricsTranslationFont, 'fa') + '</select>' +
      '      </label>' +
      '      <label class="mk-style-field">' +
      '        <span style="display:flex;justify-content:space-between;"><span>Original Lyric Size:</span><span id="mk-lyrics-orig-size-val">' + (state.lyricsOriginalSize || 22) + 'px</span></span>' +
      '        <input type="range" class="mk-range" id="mk-lyrics-orig-size" min="14" max="48" step="1" value="' + (state.lyricsOriginalSize || 22) + '">' +
      '      </label>' +
      '      <label class="mk-style-field">' +
      '        <span style="display:flex;justify-content:space-between;"><span>Translation Lyric Size:</span><span id="mk-lyrics-trans-size-val">' + (state.lyricsTranslationSize || 16) + 'px</span></span>' +
      '        <input type="range" class="mk-range" id="mk-lyrics-trans-size" min="12" max="36" step="1" value="' + (state.lyricsTranslationSize || 16) + '">' +
      '      </label>' +
      '      <label class="mk-style-field">' +
      '        <span>Active Line Color Style:</span>' +
      '        <select class="mk-select" id="mk-lyrics-colorstyle-sel">' + this._lyricColorStyleOptions(state.lyricsColorStyle) + '</select>' +
      '      </label>' +
      '      <label class="mk-style-field" id="mk-lyrics-colorspeed-row">' +
      '        <span style="display:flex;justify-content:space-between;"><span>Color Movement Speed:</span><span id="mk-lyrics-colorspeed-val">' + (state.lyricsColorSpeed || 8) + 's</span></span>' +
      '        <input type="range" class="mk-range" id="mk-lyrics-colorspeed" min="2" max="30" step="1" value="' + (state.lyricsColorSpeed || 8) + '">' +
      '      </label>' +
      '      <div class="mk-style-field" id="mk-lyrics-swatch-row">' +
      '        <span>Quick Colors:</span>' +
      '        <div class="mk-swatches" id="mk-lyrics-swatches">' + this._lyricSwatches() + '</div>' +
      '      </div>' +
      '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;">' +
      '        <label class="mk-style-field">' +
      '          <span>Active Line Color:</span>' +
      '          <input type="color" class="mk-color-input" id="mk-lyrics-active-color" value="' + (state.lyricsActiveColor || '#38ef7d') + '">' +
      '        </label>' +
      '        <label class="mk-style-field">' +
      '          <span>Inactive Line Color:</span>' +
      '          <input type="color" class="mk-color-input" id="mk-lyrics-inactive-color" value="' + (state.lyricsInactiveColor || '#8a94a6') + '">' +
      '        </label>' +
      '      </div>' +
      '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;">' +
      '        <label class="mk-style-field">' +
      '          <span>Translation Color:</span>' +
      '          <input type="color" class="mk-color-input" id="mk-lyrics-trans-color" value="' + (state.lyricsTranslationColor || '#4facfe') + '">' +
      '        </label>' +
      '        <label class="mk-style-field">' +
      '          <span>Background Style:</span>' +
      '          <select class="mk-select" id="mk-lyrics-bg-sel">' +
      '            <option value="glass"' + (state.lyricsBackground === 'glass' ? ' selected' : '') + '>Frosted Glass</option>' +
      '            <option value="dark"' + (state.lyricsBackground === 'dark' ? ' selected' : '') + '>Deep Dark</option>' +
      '            <option value="transparent"' + (state.lyricsBackground === 'transparent' ? ' selected' : '') + '>Transparent</option>' +
      '            <option value="gradient"' + (state.lyricsBackground === 'gradient' ? ' selected' : '') + '>Ambient Gradient</option>' +
      '            <option value="aurora"' + (state.lyricsBackground === 'aurora' ? ' selected' : '') + '>Aurora</option>' +
      '            <option value="sunset"' + (state.lyricsBackground === 'sunset' ? ' selected' : '') + '>Sunset</option>' +
      '            <option value="ocean"' + (state.lyricsBackground === 'ocean' ? ' selected' : '') + '>Ocean</option>' +
      '            <option value="violet"' + (state.lyricsBackground === 'violet' ? ' selected' : '') + '>Violet Night</option>' +
      '          </select>' +
      '        </label>' +
      '        <label class="mk-style-field">' +
      '          <span>Lyric Effect (rainbow is in Color Style):</span>' +
      '          <select class="mk-select" id="mk-lyrics-effect-sel">' +
      '            <option value="none"' + (state.lyricsEffect === 'none' ? ' selected' : '') + '>None</option>' +
      '            <option value="glow"' + (state.lyricsEffect === 'glow' ? ' selected' : '') + '>Glow</option>' +
      '            <option value="wave"' + (state.lyricsEffect === 'wave' ? ' selected' : '') + '>Wave</option>' +
      '            <option value="particle"' + (state.lyricsEffect === 'particle' ? ' selected' : '') + '>Particles</option>' +
      '          </select>' +
      '        </label>' +
      '      </div>' +
      '      <label class="mk-style-field">' +
      '        <span style="display:flex;justify-content:space-between;"><span>Glow &amp; Shadow Intensity:</span><span id="mk-lyrics-glow-val">' + (state.lyricsGlowIntensity !== undefined ? Number(state.lyricsGlowIntensity).toFixed(1) : '1.0') + 'x</span></span>' +
      '        <input type="range" class="mk-range" id="mk-lyrics-glow-intensity" min="0" max="3" step="0.1" value="' + (state.lyricsGlowIntensity !== undefined ? state.lyricsGlowIntensity : 1.0) + '">' +
      '      </label>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 4. Queue Drawer -->' +
      '  <div class="mk-drawer mk-queue-drawer" id="mk-queue-drawer" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">Playback Queue <span id="mk-queue-summary" style="font-size:11.5px;font-weight:400;color:var(--mk-text-dim);margin-left:8px;"></span></h3>' +
      '      <div style="display:flex;align-items:center;gap:6px;">' +
      '        <button type="button" class="mk-btn mk-btn-secondary" id="mk-queue-save-playlist-btn" style="padding:2px 8px;font-size:11px;">Save as Playlist</button>' +
      '        <button type="button" class="mk-btn mk-btn-secondary" id="mk-queue-clear-btn" style="padding:2px 8px;font-size:11px;">Clear</button>' +
      '        <button type="button" class="mk-icon-btn mk-drawer-close" data-close="queue">' + icons.close() + '</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="mk-drawer-body">' +
      '      <div class="mk-queue-list" id="mk-queue-list">' +
      this._renderQueueList() +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 5. Playlists Drawer -->' +
      '  <div class="mk-drawer mk-playlists-drawer" id="mk-playlists-drawer" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">Playlists</h3>' +
      '      <div style="display:flex;align-items:center;gap:6px;">' +
      '        <button type="button" class="mk-btn mk-btn-primary" id="mk-playlist-new-btn" style="padding:2px 8px;font-size:11px;">+ New</button>' +
      '        <button type="button" class="mk-btn mk-btn-secondary" id="mk-playlist-import-m3u-btn" style="padding:2px 8px;font-size:11px;">Import M3U</button>' +
      '        <button type="button" class="mk-icon-btn mk-drawer-close" data-close="playlists">' + icons.close() + '</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="mk-drawer-body">' +
      '      <div class="mk-smart-section" id="mk-smart-section">' + this._renderSmartList() + '</div>' +
      '      <div class="mk-smart-title">My playlists</div>' +
      '      <div class="mk-playlists-list" id="mk-playlists-list">' +
      this._renderPlaylistsList() +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 6. Settings Drawer (7 Structured Sections) -->' +
      '  <div class="mk-drawer mk-settings-drawer" id="mk-settings-drawer" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">Settings &amp; Preferences</h3>' +
      '      <button type="button" class="mk-icon-btn mk-drawer-close" data-close="settings">' + icons.close() + '</button>' +
      '    </div>' +
      '    <div class="mk-drawer-body" style="display:flex;flex-direction:column;gap:12px;">' +
      '      <!-- Settings Tabs Navigation -->' +
      '      <div class="mk-settings-nav" id="mk-settings-nav" style="display:flex;gap:4px;border-bottom:1px solid rgba(var(--mk-fg-rgb),0.08);padding-bottom:8px;overflow-x:auto;">' +
      '        <button type="button" class="mk-btn mk-btn-tab mk-tab-active" data-set-tab="library">Library</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="playback">Playback</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="audio">Audio</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="lyrics">Lyrics</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="appearance">Appearance</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="windows">Windows</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="shortcuts">Shortcuts</button>' +
      '        <button type="button" class="mk-btn mk-btn-tab" data-set-tab="advanced">Advanced</button>' +
      '      </div>' +
      '      <!-- Settings Tab Content Panes -->' +
      '      <div class="mk-settings-tab-panes" id="mk-settings-tab-panes">' +
      this._renderSettingsPanes() +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 7. AI Dialog -->' +
      '  <div class="mk-dialog mk-ai-dialog" id="mk-ai-dialog" hidden>' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title">' + icons.sparkle() + ' AI Features</h3>' +
      '      <button type="button" class="mk-icon-btn mk-drawer-close" data-close="aiDialog">' + icons.close() + '</button>' +
      '    </div>' +
      '    <div class="mk-dialog-body">' +
      '      <div style="padding:16px;background:rgba(2,132,199,0.08);border:1px solid rgba(2,132,199,0.25);border-radius:8px;">' +
      '        <strong style="color:var(--mk-accent-cyan);display:block;margin-bottom:6px;">Make lyrics is available</strong>' +
      '        <p style="font-size:12.5px;color:var(--mk-text-muted);line-height:1.5;margin:0;">' +
      '          Open the lyrics screen and press Make lyrics: Whisper listens to the song and saves an .lrc file next to it. AI translation, Qwen, Canary and vocal separation (Demucs) are planned for later.' +
      '        </p>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- 8. Audio Path Dialog (v1.8.0) -->' +
      '  <div class="mk-dialog mk-audio-path-dialog" id="mk-audio-path-dialog" hidden style="max-width:540px;width:95%;">' +
      '    <div class="mk-drawer-header">' +
      '      <h3 class="mk-drawer-title" style="display:flex;align-items:center;gap:6px;">' +
      '        <span style="color:var(--mk-accent-cyan);">●</span> Audio Signal Path (Real-time Negotiated)' +
      '      </h3>' +
      '      <button type="button" class="mk-icon-btn mk-drawer-close" data-close="audioPathDialog">&times;</button>' +
      '    </div>' +
      '    <div class="mk-dialog-body" style="padding:14px;">' +
      '      <div id="mk-audio-path-content" class="mk-audio-path-card">' +
      '        <!-- Dynamically rendered -->' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;
  };

  /* ---------------- Folders Section ---------------- */

  MakanDrawers.prototype.loadFolders = function () {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.getFolders) {
      window.MakanDesktop.getFolders().then(function (folders) {
        self.folders = folders || [];
        var fListEl = self.el.querySelector('#mk-folders-list');
        if (fListEl) {
          fListEl.innerHTML = self._renderFoldersList();
          self.bindFolderEvents();
        }
      });
    }
  };

  MakanDrawers.prototype._renderFoldersList = function () {
    if (!this.folders || !this.folders.length) {
      return '<div style="padding:24px 16px;text-align:center;color:var(--mk-text-dim);font-size:12.5px;">No folders added yet.<br>Click "+ Add Folder" to watch music directories.</div>';
    }

    var html = '';
    for (var i = 0; i < this.folders.length; i++) {
      var f = this.folders[i];
      var statusBadge = '';
      if (f.status === 'missing') {
        statusBadge = '<span class="mk-badge" style="background:rgba(239,68,68,0.2);color:#ef4444;border:1px solid rgba(239,68,68,0.3);padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">Missing</span>';
      } else if (f.status === 'offline') {
        statusBadge = '<span class="mk-badge" style="background:rgba(245,158,11,0.2);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">Offline</span>';
      } else {
        statusBadge = '<span class="mk-badge" style="background:rgba(16,185,129,0.2);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">Available</span>';
      }

      var lastScanStr = f.last_scan_at ? new Date(f.last_scan_at).toLocaleString() : 'Never scanned';
      var trackCount = f.track_count || 0;
      var missingCount = f.missing_count || 0;

      html += '' +
        '<div class="mk-folder-card" data-folder-id="' + f.id + '" style="background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;padding:12px;margin-bottom:8px;">' +
        '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
        '    <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">' +
        '      <span style="font-size:14px;color:var(--mk-accent-cyan);">' + window.MakanIcons.folders() + '</span>' +
        '      <span style="font-size:13px;font-weight:600;color:var(--mk-text);word-break:break-all;">' + this._escapeHtml(f.path) + '</span>' +
        '    </div>' +
        '    <div style="margin-left:8px;">' + statusBadge + '</div>' +
        '  </div>' +
        '  <div style="font-size:11.5px;color:var(--mk-text-dim);margin-bottom:10px;display:flex;gap:16px;">' +
        '    <span>' + trackCount + ' tracks' + (missingCount > 0 ? (' (' + missingCount + ' missing)') : '') + '</span>' +
        '    <span>Last scan: ' + lastScanStr + '</span>' +
        '  </div>' +
        '  <div style="display:flex;align-items:center;gap:6px;">' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-folder-rescan-btn" data-folder-id="' + f.id + '" data-folder-path="' + this._escapeAttr(f.path) + '" style="padding:2px 8px;font-size:11px;">Rescan</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-folder-relink-btn" data-folder-id="' + f.id + '" data-folder-path="' + this._escapeAttr(f.path) + '" style="padding:2px 8px;font-size:11px;">Relocate...</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-folder-remove-btn" data-folder-id="' + f.id + '" data-folder-path="' + this._escapeAttr(f.path) + '" style="padding:2px 8px;font-size:11px;color:var(--mk-danger);">Remove from Library</button>' +
        '  </div>' +
        '</div>';
    }
    return html;
  };

  MakanDrawers.prototype.bindFolderEvents = function () {
    var self = this;

    var rescanBtns = this.el.querySelectorAll('.mk-folder-rescan-btn');
    for (var r = 0; r < rescanBtns.length; r++) {
      rescanBtns[r].addEventListener('click', function (e) {
        e.stopPropagation();
        var fPath = this.getAttribute('data-folder-path') || this.getAttribute('data-folder-id');
        self.rescanFolder(fPath);
      });
    }

    var relinkBtns = this.el.querySelectorAll('.mk-folder-relink-btn');
    for (var l = 0; l < relinkBtns.length; l++) {
      relinkBtns[l].addEventListener('click', function (e) {
        e.stopPropagation();
        var fId = this.getAttribute('data-folder-id');
        var oldPath = this.getAttribute('data-folder-path');
        self.relinkFolder(fId, oldPath);
      });
    }

    var removeBtns = this.el.querySelectorAll('.mk-folder-remove-btn');
    for (var m = 0; m < removeBtns.length; m++) {
      removeBtns[m].addEventListener('click', function (e) {
        e.stopPropagation();
        var fId = this.getAttribute('data-folder-id');
        var fPath = this.getAttribute('data-folder-path');
        self.removeFolder(fId, fPath);
      });
    }
  };

  MakanDrawers.prototype.rescanFolder = function (folderPathOrId) {
    var self = this;
    var banner = this.el.querySelector('#mk-scan-status-banner');
    var bannerText = this.el.querySelector('#mk-scan-status-text');
    var cancelBtn = this.el.querySelector('#mk-folders-cancel-scan-btn');

    if (banner) banner.style.display = 'block';
    if (bannerText) bannerText.textContent = 'Scanning folder...';
    if (cancelBtn) cancelBtn.hidden = false;
    this.isScanning = true;

    if (window.MakanDesktop && window.MakanDesktop.rescanFolder) {
      window.MakanDesktop.rescanFolder(folderPathOrId, function (prog) {
        if (bannerText && prog) {
          bannerText.textContent = 'Scanning: ' + (prog.scanned || 0) + '/' + (prog.total || 0) + (prog.currentFile ? ' — ' + prog.currentFile : '');
        }
      }).then(function (summary) {
        self.isScanning = false;
        if (banner) banner.style.display = 'none';
        if (cancelBtn) cancelBtn.hidden = true;
        self.loadFolders();
        self.state.emit('libraryUpdated');
        self.showScanSummary(summary);
      }).catch(function (err) {
        self.isScanning = false;
        if (banner) banner.style.display = 'none';
        if (cancelBtn) cancelBtn.hidden = true;
        alert('Scan error: ' + (err.message || err));
      });
    }
  };

  MakanDrawers.prototype.rescanAllFolders = function () {
    var self = this;
    var banner = this.el.querySelector('#mk-scan-status-banner');
    var bannerText = this.el.querySelector('#mk-scan-status-text');
    var cancelBtn = this.el.querySelector('#mk-folders-cancel-scan-btn');

    if (banner) banner.style.display = 'block';
    if (bannerText) bannerText.textContent = 'Scanning all folders...';
    if (cancelBtn) cancelBtn.hidden = false;
    this.isScanning = true;

    if (window.MakanDesktop && window.MakanDesktop.rescanAllFolders) {
      window.MakanDesktop.rescanAllFolders(function (prog) {
        if (bannerText && prog) {
          bannerText.textContent = 'Scanning: ' + (prog.scanned || 0) + '/' + (prog.total || 0) + (prog.currentFile ? ' — ' + prog.currentFile : '');
        }
      }).then(function (summary) {
        self.isScanning = false;
        if (banner) banner.style.display = 'none';
        if (cancelBtn) cancelBtn.hidden = true;
        self.loadFolders();
        self.state.emit('libraryUpdated');
        self.showScanSummary(summary);
      }).catch(function (err) {
        self.isScanning = false;
        if (banner) banner.style.display = 'none';
        if (cancelBtn) cancelBtn.hidden = true;
        alert('Scan error: ' + (err.message || err));
      });
    } else {
      self.state.emit('requestRescan');
    }
  };

  MakanDrawers.prototype.relinkFolder = function (folderId, oldPath) {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.chooseFolders) {
      window.MakanDesktop.chooseFolders().then(function (paths) {
        if (paths && paths.length) {
          var newPath = paths[0];
          if (window.MakanDesktop.relinkFolder) {
            window.MakanDesktop.relinkFolder(folderId, newPath).then(function () {
              self.loadFolders();
              self.state.emit('libraryUpdated');
              alert('Folder relocated to:\n' + newPath);
            });
          }
        }
      });
    }
  };

  MakanDrawers.prototype.removeFolder = function (folderId, folderPath) {
    var self = this;
    var msg = 'Remove folder from library?\n\n' + folderPath + '\n\nNOTE: Audio files on your disk will NOT be deleted.';
    if (window.confirm(msg)) {
      if (window.MakanDesktop && window.MakanDesktop.removeFolder) {
        window.MakanDesktop.removeFolder(folderId).then(function () {
          self.loadFolders();
          self.state.emit('libraryUpdated');
        });
      }
    }
  };

  MakanDrawers.prototype.showScanSummary = function (summary) {
    if (!summary) return;
    var msg = 'Scan Summary:\n\n' +
      '• Added tracks: ' + (summary.added || 0) + '\n' +
      '• Updated tracks: ' + (summary.updated || 0) + '\n' +
      '• Missing tracks: ' + (summary.missing || 0) + '\n' +
      '• Corrupted files: ' + (summary.corrupt || 0) + '\n' +
      '• Unsupported files: ' + (summary.unsupported || 0);
    alert(msg);
  };

  /* ---------------- Equalizer & Preamp ---------------- */

  MakanDrawers.prototype._renderEqSliders = function () {
    var state = this.state;
    var bands = state.eqBands;
    var gains = state.eqGains;
    var html = '';

    for (var i = 0; i < bands.length; i++) {
      var freqLabel = bands[i] >= 1000 ? (bands[i] / 1000) + 'k' : bands[i];
      var g = (gains && gains[i] !== undefined) ? gains[i] : 0;
      html += '' +
        '<div class="mk-eq-col">' +
        '  <span class="mk-eq-val" id="mk-eq-val-' + i + '">' + (g >= 0 ? '+' : '') + g.toFixed(1) + '</span>' +
        '  <div class="mk-eq-slider-box">' +
        '    <input type="range" class="mk-eq-range" data-band="' + i + '" min="-12" max="12" step="0.5" value="' + g + '" orient="vertical">' +
        '  </div>' +
        '  <span class="mk-eq-freq">' + freqLabel + '</span>' +
        '</div>';
    }
    return html;
  };

  /* ---------------- Queue Drawer ---------------- */

  MakanDrawers.prototype._renderQueueList = function () {
    var explicit = this.controller ? this.controller.explicitQueue : [];
    var contextTracks = (this.controller && this.controller.context) ? this.controller.context.tracks : (this.state.tracks || []);
    var curTrack = this.state.currentTrack;
    var history = (this.controller && this.controller.history) ? this.controller.history.slice().reverse() : [];
    var shuffledBag = this.controller ? this.controller.shuffledBag : [];
    var isShuffle = this.controller && this.controller.shuffleMode !== 'off';
    var shuffleMode = this.controller ? this.controller.shuffleMode : 'off';

    // Total duration calculation
    var totalSec = 0;
    var totalCount = (explicit ? explicit.length : 0);
    if (explicit) {
      for (var a = 0; a < explicit.length; a++) totalSec += (explicit[a].duration || 0);
    }
    if (isShuffle) {
      totalCount += shuffledBag.length;
      for (var b = 0; b < shuffledBag.length; b++) {
        var trk = this.controller._trackMap ? this.controller._trackMap.get(shuffledBag[b]) : null;
        if (trk) totalSec += (trk.duration || 0);
      }
    } else {
      var nextIndex = this.controller ? (this.controller.contextIndex + 1) : 0;
      var remainingCtx = (nextIndex < contextTracks.length) ? (contextTracks.length - nextIndex) : 0;
      totalCount += remainingCtx;
      for (var c = nextIndex; c < contextTracks.length; c++) {
        totalSec += (contextTracks[c].duration || 0);
      }
    }

    var summaryEl = this.el ? this.el.querySelector('#mk-queue-summary') : null;
    if (summaryEl) {
      var summaryParts = [];
      if (explicit.length > 0) summaryParts.push(explicit.length + ' queued');
      if (isShuffle) summaryParts.push(shuffledBag.length + ' in cycle');
      summaryParts.push(this.state.formatTime(totalSec) + ' total');
      summaryEl.textContent = '• ' + summaryParts.join(' • ');
    }

    var html = '';

    // Section 1: Now Playing
    html += '<div class="mk-queue-section">';
    html += '  <div class="mk-queue-section-header cyan">Now Playing</div>';
    if (curTrack) {
      var artSrc = curTrack.art || (curTrack.artwork_path ? ('/api/artwork?id=' + encodeURIComponent(curTrack.id)) : "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' fill='%230b1220'><rect width='36' height='36'/><circle cx='18' cy='18' r='10' fill='%23142238'/></svg>");
      html += '' +
        '<div class="mk-queue-item mk-queue-active" style="padding:8px 12px;background:rgba(0,240,255,0.06);border:1px solid rgba(0,240,255,0.2);">' +
        '  <img class="mk-queue-art" src="' + artSrc + '" alt="Artwork">' +
        '  <div class="mk-queue-info">' +
        '    <span class="mk-queue-title" style="font-weight:600;color:var(--mk-accent-cyan);">' + this._escapeHtml(curTrack.title || curTrack.filename || 'Untitled') + '</span>' +
        '    <span class="mk-queue-artist">' + this._escapeHtml(curTrack.artist || 'Unknown Artist') + '</span>' +
        '  </div>' +
        '  <span class="mk-queue-time">' + this.state.formatTime(curTrack.duration || 0) + '</span>' +
        '</div>';
    } else {
      html += '<div style="padding:12px;font-size:12px;color:var(--mk-text-dim);text-align:center;">No track currently playing</div>';
    }
    html += '</div>';

    // Section 2: Up Next (Priority Explicit Queue)
    html += '<div class="mk-queue-section">';
    html += '  <div class="mk-queue-section-header cyan">' +
      '    <span>Up Next (Manual Queue — ' + explicit.length + ')</span>' +
      (explicit.length > 0 ? ('<span style="font-size:10px;font-weight:400;color:var(--mk-text-dim);text-transform:none;">Drag handle ⋮⋮ to reorder • Del to remove</span>') : '') +
      '  </div>';

    if (explicit && explicit.length > 0) {
      var maxVisibleExplicit = 100;
      var renderExplicitCount = Math.min(explicit.length, maxVisibleExplicit);
      for (var e = 0; e < renderExplicitCount; e++) {
        var eqTrack = explicit[e];
        var isSelected = this.selectedQueueIndices.has(e);
        html += '' +
          '<div class="mk-queue-item mk-queue-explicit' + (isSelected ? ' mk-selected' : '') + '" data-explicit-idx="' + e + '" draggable="true" tabindex="0">' +
          '  <span class="mk-queue-drag-handle" title="Drag to reorder">⋮⋮</span>' +
          '  <span class="mk-queue-num">Q' + (e + 1) + '</span>' +
          '  <div class="mk-queue-info">' +
          '    <span class="mk-queue-title">' + this._escapeHtml(eqTrack.title || eqTrack.filename || 'Untitled') + '</span>' +
          '    <span class="mk-queue-artist">' + this._escapeHtml(eqTrack.artist || 'Unknown Artist') + '</span>' +
          '  </div>' +
          '  <span class="mk-queue-time">' + this.state.formatTime(eqTrack.duration || 0) + '</span>' +
          '  <button type="button" class="mk-icon-btn mk-queue-remove" data-remove-explicit-idx="' + e + '" title="Remove from queue">&times;</button>' +
          '</div>';
      }
      if (explicit.length > maxVisibleExplicit) {
        html += '<div style="padding:6px 12px;font-size:11px;color:var(--mk-text-dim);text-align:center;">+ ' + (explicit.length - maxVisibleExplicit) + ' more queued tracks (Ctrl+A &amp; Del or Save Playlist manages all ' + explicit.length + ')</div>';
      }
    } else {
      html += '<div style="padding:12px 14px;font-size:12px;color:var(--mk-text-dim);font-style:italic;">No tracks explicitly queued. Right-click library tracks to "Play Next" or "Add to Queue".</div>';
    }
    html += '</div>';

    // Section 3: Upcoming in Shuffle Cycle / Context Scope
    html += '<div class="mk-queue-section">';
    if (isShuffle) {
      var modeTitle = shuffleMode === 'albums' ? 'Shuffle Albums' : 'True Shuffle';
      html += '  <div class="mk-queue-section-header">' +
        '    <span>Upcoming in ' + modeTitle + '</span>' +
        '    <span class="mk-queue-cycle-badge">' + shuffledBag.length + ' remaining in cycle</span>' +
        '  </div>';

      if (shuffledBag.length > 0) {
        var previewLimit = Math.min(25, shuffledBag.length);
        for (var s = 0; s < previewLimit; s++) {
          var sId = shuffledBag[shuffledBag.length - 1 - s];
          var sTrk = this.controller && this.controller._trackMap ? this.controller._trackMap.get(sId) : null;
          if (sTrk) {
            html += '' +
              '<div class="mk-queue-item mk-queue-upcoming" data-upcoming-id="' + this._escapeAttr(sTrk.id) + '" title="Click to play now without resetting cycle">' +
              '  <span class="mk-queue-num">' + (s + 1) + '</span>' +
              '  <div class="mk-queue-info">' +
              '    <span class="mk-queue-title">' + this._escapeHtml(sTrk.title || sTrk.filename || 'Untitled') + '</span>' +
              '    <span class="mk-queue-artist">' + this._escapeHtml(sTrk.artist || 'Unknown Artist') + '</span>' +
              '  </div>' +
              '  <span class="mk-queue-time">' + this.state.formatTime(sTrk.duration || 0) + '</span>' +
              '</div>';
          }
        }
        if (shuffledBag.length > previewLimit) {
          html += '<div style="padding:6px 12px;font-size:11px;color:var(--mk-text-dim);text-align:center;">+ ' + (shuffledBag.length - previewLimit) + ' more tracks in this shuffle cycle</div>';
        }
      } else {
        html += '<div style="padding:12px;font-size:12px;color:var(--mk-text-dim);text-align:center;">End of shuffle cycle reached.</div>';
      }
    } else {
      var contextName = (this.controller && this.controller.context && this.controller.context.name) ? this.controller.context.name : 'Context';
      var startIdx = this.controller ? (this.controller.contextIndex + 1) : 0;
      var remainingTracks = (contextTracks && startIdx < contextTracks.length) ? contextTracks.slice(startIdx) : [];
      html += '  <div class="mk-queue-section-header">' +
        '    <span>Upcoming in ' + contextName + '</span>' +
        '    <span style="font-size:10.5px;color:var(--mk-text-dim);">' + remainingTracks.length + ' tracks</span>' +
        '  </div>';

      if (remainingTracks.length > 0) {
        var pLimit = Math.min(25, remainingTracks.length);
        for (var r = 0; r < pLimit; r++) {
          var rTrk = remainingTracks[r];
          html += '' +
            '<div class="mk-queue-item mk-queue-upcoming" data-upcoming-id="' + this._escapeAttr(rTrk.id) + '" title="Click to jump to track">' +
            '  <span class="mk-queue-num">' + (startIdx + r + 1) + '</span>' +
            '  <div class="mk-queue-info">' +
            '    <span class="mk-queue-title">' + this._escapeHtml(rTrk.title || rTrk.filename || 'Untitled') + '</span>' +
            '    <span class="mk-queue-artist">' + this._escapeHtml(rTrk.artist || 'Unknown Artist') + '</span>' +
            '  </div>' +
            '  <span class="mk-queue-time">' + this.state.formatTime(rTrk.duration || 0) + '</span>' +
            '</div>';
        }
        if (remainingTracks.length > pLimit) {
          html += '<div style="padding:6px 12px;font-size:11px;color:var(--mk-text-dim);text-align:center;">+ ' + (remainingTracks.length - pLimit) + ' more tracks</div>';
        }
      } else {
        html += '<div style="padding:12px;font-size:12px;color:var(--mk-text-dim);text-align:center;">End of playlist reached.</div>';
      }
    }
    html += '</div>';

    // Section 4: Previously Played History
    if (history && history.length > 0) {
      html += '<div class="mk-queue-section">';
      html += '  <div class="mk-queue-section-header">' +
        '    <span>Previously Played (' + history.length + ')</span>' +
        '    <button type="button" class="mk-btn mk-btn-secondary" id="mk-queue-clear-history-btn" style="padding:1px 6px;font-size:10px;">Clear History</button>' +
        '  </div>';

      var histLimit = Math.min(20, history.length);
      for (var h = 0; h < histLimit; h++) {
        var hTrk = history[h];
        html += '' +
          '<div class="mk-queue-item mk-queue-history" data-history-id="' + this._escapeAttr(hTrk.id) + '" title="Click to replay">' +
          '  <span class="mk-queue-num" style="opacity:0.6;">-' + (h + 1) + '</span>' +
          '  <div class="mk-queue-info">' +
          '    <span class="mk-queue-title" style="color:var(--mk-text-muted);">' + this._escapeHtml(hTrk.title || hTrk.filename || 'Untitled') + '</span>' +
          '    <span class="mk-queue-artist">' + this._escapeHtml(hTrk.artist || 'Unknown Artist') + '</span>' +
          '  </div>' +
          '  <span class="mk-queue-time">' + this.state.formatTime(hTrk.duration || 0) + '</span>' +
          '</div>';
      }
      html += '</div>';
    }

    return html;
  };

  MakanDrawers.prototype.updateQueueList = function () {
    var qListEl = this.el.querySelector('#mk-queue-list');
    if (qListEl) {
      qListEl.innerHTML = this._renderQueueList();
      this.bindQueueItemEvents();
    }
  };

  MakanDrawers.prototype._updateQueueSelectionVisuals = function () {
    var expItems = this.el.querySelectorAll('.mk-queue-explicit');
    for (var i = 0; i < expItems.length; i++) {
      var idx = parseInt(expItems[i].getAttribute('data-explicit-idx'), 10);
      if (this.selectedQueueIndices.has(idx)) {
        expItems[i].classList.add('mk-selected');
      } else {
        expItems[i].classList.remove('mk-selected');
      }
    }
  };

  MakanDrawers.prototype.bindQueueItemEvents = function () {
    var self = this;

    // Top action buttons: Clear Queue & Save as Playlist
    var clearQueueBtn = this.el.querySelector('#mk-queue-clear-btn');
    if (clearQueueBtn) {
      clearQueueBtn.onclick = function (e) {
        e.stopPropagation();
        if (self.controller) self.controller.clearQueue();
        self.selectedQueueIndices.clear();
        self.lastSelectedQueueIndex = null;
        self.updateQueueList();
      };
    }

    var clearHistBtn = this.el.querySelector('#mk-queue-clear-history-btn');
    if (clearHistBtn) {
      clearHistBtn.onclick = function (e) {
        e.stopPropagation();
        if (self.controller) self.controller.clearHistory();
        self.updateQueueList();
      };
    }

    var savePlBtn = this.el.querySelector('#mk-queue-save-playlist-btn');
    if (savePlBtn) {
      savePlBtn.onclick = function (e) {
        e.stopPropagation();
        var tracksToSave = (self.controller && self.controller.explicitQueue && self.controller.explicitQueue.length)
          ? self.controller.explicitQueue
          : (self.controller && self.controller.context ? self.controller.context.tracks : []);
        if (!tracksToSave.length) {
          alert('Queue is empty. Add songs to the queue first.');
          return;
        }
        self._askName('Save Queue as Playlist:', 'Queue ' + new Date().toLocaleDateString(), function (name) {
        if (name && name.trim() && window.MakanDesktop && window.MakanDesktop.createPlaylist) {
          var tIds = tracksToSave.map(function (t) { return t.id; });
          window.MakanDesktop.createPlaylist(name.trim()).then(function (res) {
            var plId = res && res.id ? res.id : (typeof res === 'string' ? res : null);
            if (plId && window.MakanDesktop.addTracksToPlaylist) {
              window.MakanDesktop.addTracksToPlaylist(plId, tIds, true).then(function () {
                self.loadPlaylists();
                if (self.state) self.state.emit('countsUpdated');
              });
            }
          });
        }
        });
      };
    }

    // Explicit queue item removal buttons
    var removeBtns = this.el.querySelectorAll('.mk-queue-remove');
    for (var r = 0; r < removeBtns.length; r++) {
      removeBtns[r].addEventListener('click', function (e) {
        e.stopPropagation();
        var expIdx = this.getAttribute('data-remove-explicit-idx');
        if (expIdx != null) {
          var i = parseInt(expIdx, 10);
          if (self.controller) self.controller.removeFromQueue(i);
          self.selectedQueueIndices.delete(i);
          self.updateQueueList();
        }
      });
    }

    // Explicit queue items: selection, keyboard, reorder, dblclick
    var explicitEls = this.el.querySelectorAll('.mk-queue-explicit');
    for (var j = 0; j < explicitEls.length; j++) {
      explicitEls[j].addEventListener('click', function (e) {
        if (e.target.closest('.mk-queue-remove')) return;
        var idx = parseInt(this.getAttribute('data-explicit-idx'), 10);
        if (isNaN(idx)) return;

        if (e.ctrlKey || e.metaKey) {
          if (self.selectedQueueIndices.has(idx)) {
            self.selectedQueueIndices.delete(idx);
          } else {
            self.selectedQueueIndices.add(idx);
            self.lastSelectedQueueIndex = idx;
          }
        } else if (e.shiftKey && self.lastSelectedQueueIndex !== null) {
          self.selectedQueueIndices.clear();
          var start = Math.min(self.lastSelectedQueueIndex, idx);
          var end = Math.max(self.lastSelectedQueueIndex, idx);
          for (var k = start; k <= end; k++) {
            self.selectedQueueIndices.add(k);
          }
        } else {
          self.selectedQueueIndices.clear();
          self.selectedQueueIndices.add(idx);
          self.lastSelectedQueueIndex = idx;
        }
        self._updateQueueSelectionVisuals();
      });

      explicitEls[j].addEventListener('dblclick', function (e) {
        if (e.target.closest('.mk-queue-remove')) return;
        var idx = parseInt(this.getAttribute('data-explicit-idx'), 10);
        if (self.controller && self.controller.explicitQueue && self.controller.explicitQueue[idx]) {
          self.controller.playNow(self.controller.explicitQueue[idx]);
        }
      });
    }

    // Drag-and-drop reordering for explicit queue items
    var draggedExplicitIdx = null;
    for (var k = 0; k < explicitEls.length; k++) {
      explicitEls[k].addEventListener('dragstart', function (e) {
        draggedExplicitIdx = parseInt(this.getAttribute('data-explicit-idx'), 10);
        this.classList.add('mk-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', String(draggedExplicitIdx));
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      explicitEls[k].addEventListener('dragend', function () {
        this.classList.remove('mk-dragging');
        var all = self.el.querySelectorAll('.mk-queue-explicit');
        for (var a = 0; a < all.length; a++) all[a].classList.remove('mk-drag-over');
      });
      explicitEls[k].addEventListener('dragover', function (e) {
        e.preventDefault();
        this.classList.add('mk-drag-over');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      explicitEls[k].addEventListener('dragleave', function () {
        this.classList.remove('mk-drag-over');
      });
      explicitEls[k].addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('mk-drag-over');
        var targetIdx = parseInt(this.getAttribute('data-explicit-idx'), 10);
        if (draggedExplicitIdx !== null && !isNaN(targetIdx) && draggedExplicitIdx !== targetIdx) {
          if (self.controller && typeof self.controller.reorderQueue === 'function') {
            self.controller.reorderQueue(draggedExplicitIdx, targetIdx);
            self.selectedQueueIndices.clear();
            self.selectedQueueIndices.add(targetIdx);
            self.lastSelectedQueueIndex = targetIdx;
            self.updateQueueList();
          }
        }
        draggedExplicitIdx = null;
      });
    }

    // Upcoming item click: play without resetting cycle
    var upItems = this.el.querySelectorAll('.mk-queue-upcoming');
    for (var u = 0; u < upItems.length; u++) {
      upItems[u].addEventListener('click', function () {
        var trkId = this.getAttribute('data-upcoming-id');
        if (self.controller && trkId && self.controller._trackMap) {
          var trk = self.controller._trackMap.get(trkId);
          if (trk) self.controller.selectTrack(trk);
        }
      });
    }

    // History item click: replay without resetting cycle
    var histItems = this.el.querySelectorAll('.mk-queue-history');
    for (var h = 0; h < histItems.length; h++) {
      histItems[h].addEventListener('click', function () {
        var trkId = this.getAttribute('data-history-id');
        if (self.controller && trkId && self.controller._trackMap) {
          var trk = self.controller._trackMap.get(trkId);
          if (trk) self.controller.selectTrack(trk);
        }
      });
    }

    // Keyboard listener on Queue Drawer: Ctrl+A & Delete
    var qDrawer = this.el.querySelector('#mk-queue-drawer');
    if (qDrawer && !qDrawer._kbdBound) {
      qDrawer._kbdBound = true;
      qDrawer.addEventListener('keydown', function (e) {
        // Ctrl+A: Select all explicit queue items
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          self.selectedQueueIndices.clear();
          var count = (self.controller && self.controller.explicitQueue) ? self.controller.explicitQueue.length : 0;
          for (var i = 0; i < count; i++) {
            self.selectedQueueIndices.add(i);
          }
          self._updateQueueSelectionVisuals();
          return;
        }
        // Delete: Remove selected explicit queue entries
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (self.selectedQueueIndices.size > 0 && self.controller) {
            e.preventDefault();
            self.controller.removeSelectedFromQueue(Array.from(self.selectedQueueIndices));
            self.selectedQueueIndices.clear();
            self.lastSelectedQueueIndex = null;
            self.updateQueueList();
          }
        }
      });
    }
  };

  /* ---------------- Playlists Drawer ---------------- */

  MakanDrawers.prototype.loadPlaylists = function () {
    var self = this;
    this.loadSmartPlaylists();
    if (window.MakanDesktop && window.MakanDesktop.getPlaylists) {
      window.MakanDesktop.getPlaylists().then(function (pls) {
        self.playlists = pls || [];
        self.state.playlistsCount = self.playlists.length;
        self.state.emit('countsUpdated');
        self.state.emit('playlistsChanged');
        var plListEl = self.el.querySelector('#mk-playlists-list');
        if (plListEl) {
          plListEl.innerHTML = self._renderPlaylistsList();
          self.bindPlaylistEvents();
        }
      });
    }
  };

  /* ---------------- Name box (Electron has no window.prompt) ---------------- */

  MakanDrawers.prototype._askName = function (title, defaultValue, done) {
    var self = this;
    var back = document.createElement('div');
    back.className = 'mk-modal-back';
    back.innerHTML = '<div class="mk-modal-box" role="dialog" aria-modal="true">' +
      '<div class="mk-modal-title">' + self._escapeHtml(String(title || 'Name')) + '</div>' +
      '<input type="text" class="mk-modal-input" maxlength="80" spellcheck="false" autocomplete="off">' +
      '<div class="mk-modal-actions"><button type="button" class="mk-btn mk-btn-secondary" data-act="cancel">Cancel</button>' +
      '<button type="button" class="mk-btn mk-btn-primary" data-act="ok">OK</button></div></div>';
    document.body.appendChild(back);
    var input = back.querySelector('.mk-modal-input');
    input.value = defaultValue || '';
    var closed = false;
    function finish(val) {
      if (closed) return;
      closed = true;
      if (back.parentNode) back.parentNode.removeChild(back);
      if (typeof done === 'function') done(val);
    }
    back.addEventListener('click', function (e) {
      if (e.target === back) finish(null);
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (act) finish(act.getAttribute('data-act') === 'ok' ? input.value : null);
    });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    setTimeout(function () { input.focus(); input.select(); }, 30);
  };

  /* ---------------- Smart playlists (saved searches) ---------------- */

  var BUILTIN_SMART = [
    { id: 'b-lyrics', name: 'Songs with lyrics', query: 'has:lyrics' },
    { id: 'b-nolyrics', name: 'Songs without lyrics', query: '-has:lyrics' },
    { id: 'b-never', name: 'Never played', query: 'plays:0' },
    { id: 'b-often', name: 'Played often (5+ times)', query: 'plays:>4' },
    { id: 'b-noartist', name: 'Missing artist', query: 'missing:artist' },
    { id: 'b-noalbum', name: 'Missing album', query: 'missing:album' },
    { id: 'b-dupes', name: 'Possible duplicates', query: 'is:duplicate' },
    { id: 'b-fast', name: 'Fast and energetic (needs sound analysis)', query: 'bpm:>=125 energy:high' },
    { id: 'b-calm', name: 'Calm songs (needs sound analysis)', query: 'energy:low' },
    { id: 'b-slow', name: 'Slow songs, under 90 BPM (needs sound analysis)', query: 'bpm:<90' }
  ];

  MakanDrawers.prototype._renderSmartList = function () {
    var self = this;
    function card(p, canDelete) {
      return '<div class="mk-smart-card" data-smart-query="' + self._escapeAttr(p.query) + '" title="Show these songs">' +
        '<div class="mk-smart-info"><div class="mk-smart-name">' + self._escapeHtml(p.name) + '</div>' +
        '<div class="mk-smart-query">' + self._escapeHtml(p.query) + '</div></div>' +
        (canDelete ? '<button type="button" class="mk-btn mk-btn-secondary mk-smart-del" data-smart-del="' + self._escapeAttr(p.id) + '" title="Delete this smart playlist">Delete</button>' : '') +
        '</div>';
    }
    var html = '<div class="mk-smart-title">Smart playlists <span class="mk-smart-hint">(they update by themselves)</span></div>';
    html += '<div class="mk-smart-ai">' +
      '<button type="button" class="mk-btn mk-btn-primary" id="mk-ai-open-btn" title="Describe the playlist you want. The AI writes searches; the songs always come from your own library.">Make a playlist with AI...</button> ' +
      '<button type="button" class="mk-btn mk-btn-secondary" id="mk-similar-btn" title="Shows songs from your library with the same artist, album, genre or years as the song that is playing. No AI.">Songs like the playing song</button> ' +
      '<button type="button" class="mk-btn mk-btn-secondary" id="mk-mix-btn" title="Puts up to 30 songs in your Queue, each one close in tempo and energy to the song before it. Needs Sound analysis. No AI.">Mix from the playing song</button></div>';
    html += '<div class="mk-sound-box" id="mk-sound-box"></div>';
    BUILTIN_SMART.forEach(function (p) { html += card(p, false); });
    (this.smartPlaylists || []).forEach(function (p) { html += card(p, true); });
    html += '<button type="button" class="mk-btn mk-btn-secondary mk-smart-save" id="mk-tagfix-open-btn" title="Suggest artist and title from file names. You see a preview first; music files are never changed.">Fix missing tags...</button> ';
    html += '<button type="button" class="mk-btn mk-btn-secondary mk-smart-save" id="mk-smart-save-btn" title="First type a search, for example: lyrics:love artist:queen">+ Save current search as smart playlist</button>';
    return html;
  };

  MakanDrawers.prototype.loadSmartPlaylists = function () {
    var self = this;
    function paint() {
      var box = self.el && self.el.querySelector('#mk-smart-section');
      if (!box) return;
      box.innerHTML = self._renderSmartList();
      self.bindSmartEvents();
      self.updateSoundBox();
    }
    if (window.MakanDesktop && window.MakanDesktop.getSmartPlaylists) {
      window.MakanDesktop.getSmartPlaylists().then(function (list) { self.smartPlaylists = list || []; paint(); }).catch(paint);
    } else {
      paint();
    }
  };

  /* ---------------- Fix missing tags (Preview -> Apply -> Undo) ---------------- */

  MakanDrawers.prototype.openTagFixer = function () {
    var self = this;
    var api = window.MakanDesktop;
    var Fixer = window.MakanTagFixer;
    var Ai = window.MakanTagAi;
    if (!Fixer) return;
    var COLS = ['artist', 'title', 'album', 'year', 'genre'];

    function show(allTracks) {
      var byId = {};
      (allTracks || []).forEach(function (t) { byId[t.id] = t; });
      // rows: id, filename, current{...}, proposed{...}, source ('name' | 'gemini'), confidence
      var rowsData = Fixer.suggestFixes(allTracks || [], 500).map(function (s) {
        var cur = byId[s.id] || {};
        return { id: s.id, filename: s.filename, current: cur, proposed: s.proposed, source: 'name' };
      });
      var back = document.createElement('div');
      back.className = 'mk-modal-back';
      back.innerHTML = '<div class="mk-modal-box mk-modal-wide" role="dialog" aria-modal="true">' +
        '<div class="mk-modal-title">Fix missing tags</div>' +
        '<div class="mk-tf-note">Preview only until you press Apply. Fixes are saved in the MAKAN library; your music files are never changed. You can undo the last Apply.</div>' +
        '<div class="mk-tf-ai"><button type="button" class="mk-btn mk-btn-secondary" data-tf="ai" id="mk-tf-ai-btn" title="Sends file names and existing tags (no audio, no files) to Google Gemini with your own key. Only empty tags are filled.">Ask Gemini to complete (next 60 songs)</button>' +
        '<span class="mk-tf-status" id="mk-tf-status"></span></div>' +
        '<div id="mk-tf-body"></div>' +
        '<div class="mk-modal-actions"><span class="mk-tf-count" id="mk-tf-count"></span>' +
        '<button type="button" class="mk-btn mk-btn-secondary" data-tf="undo" id="mk-tf-undo" disabled>Undo last apply</button>' +
        '<button type="button" class="mk-btn mk-btn-secondary" data-tf="close">Close</button>' +
        '<button type="button" class="mk-btn mk-btn-primary" data-tf="apply" id="mk-tf-apply">Apply selected</button></div></div>';
      document.body.appendChild(back);
      var bodyEl = back.querySelector('#mk-tf-body');
      var countEl = back.querySelector('#mk-tf-count');
      var statusEl = back.querySelector('#mk-tf-status');
      var applyBtn = back.querySelector('#mk-tf-apply');
      var aiBtn = back.querySelector('#mk-tf-ai-btn');
      var aiAsked = {};   // songs already sent to Gemini this time
      var aiCtrl = null;

      function value(row, f) {
        var p = row.proposed[f];
        if (p !== undefined && p !== null && p !== '') return p;
        var c = row.current[f];
        return (c === undefined || c === null || c === 0) ? '' : c;
      }

      function render() {
        if (!rowsData.length) {
          bodyEl.innerHTML = '<div class="mk-tf-empty">Nothing to fix from file names. Try "Ask Gemini to complete" for album, year and genre.</div>';
        } else {
          var h = '<div class="mk-tf-scroll"><table class="mk-tf-table"><thead><tr><th></th><th>File name</th><th>Artist</th><th>Title</th><th>Album</th><th>Year</th><th>Genre</th><th></th></tr></thead><tbody>';
          rowsData.forEach(function (r, i) {
            h += '<tr data-i="' + i + '"><td><input type="checkbox" class="mk-tf-chk"' + (r.confidence === 'low' ? '' : ' checked') + '></td>' +
              '<td class="mk-tf-file" title="' + self._escapeAttr(r.filename) + '">' + self._escapeHtml(r.filename) + '</td>';
            COLS.forEach(function (f) {
              var isNew = r.proposed[f] !== undefined && r.proposed[f] !== null && r.proposed[f] !== '';
              h += '<td><input type="text" class="mk-tf-in' + (isNew ? ' mk-tf-new' : '') + '" data-f="' + f + '" value="' + self._escapeAttr(value(r, f)) + '" placeholder="' + f + '"' + (f === 'year' ? ' size="4"' : '') + '></td>';
            });
            h += '<td class="mk-tf-src">' + (r.source === 'gemini' ? (r.confidence === 'low' ? 'Gemini (unsure)' : 'Gemini') : 'file name') + '</td></tr>';
          });
          bodyEl.innerHTML = h + '</tbody></table></div>';
        }
        applyBtn.disabled = !rowsData.length;
        updateCount();
      }
      function updateCount() {
        var n = back.querySelectorAll('.mk-tf-chk:checked').length;
        countEl.textContent = rowsData.length ? (n + ' of ' + rowsData.length + ' selected') : '';
      }
      render();
      if (api && api.hasTagFixUndo) api.hasTagFixUndo().then(function (has) { var u = back.querySelector('#mk-tf-undo'); if (u) u.disabled = !has; });
      function close() { if (aiCtrl) aiCtrl.abort(); if (back.parentNode) back.parentNode.removeChild(back); }
      function reload() { self.state.emit('navChanged', { navItem: 'library' }); }

      function geminiKey() {
        var T = window.MakanLyricsTranslate && window.MakanLyricsTranslate.getShared ? window.MakanLyricsTranslate.getShared() : null;
        return T && T._keys ? T._keys.gemini : '';
      }

      function askGemini() {
        if (!Ai) return;
        var key = geminiKey();
        if (!key) { statusEl.textContent = 'No Gemini key yet. Open Settings -> Lyrics, paste your Gemini API key there, then try again.'; return; }
        var pool = Fixer.candidatesForAi(allTracks, 100000).filter(function (t) { return !aiAsked[t.id]; }).slice(0, 60);
        if (!pool.length) { statusEl.textContent = 'No more songs with missing tags.'; return; }
        pool.forEach(function (t) { aiAsked[t.id] = true; });
        aiCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        aiBtn.disabled = true;
        statusEl.textContent = 'Asking Gemini... 0 / ' + pool.length;
        Ai.suggest(pool, {
          key: key, signal: aiCtrl ? aiCtrl.signal : undefined,
          onProgress: function (done, total) { statusEl.textContent = 'Asking Gemini... ' + done + ' / ' + total; }
        }).then(function (res) {
          var added = 0;
          pool.forEach(function (t) {
            var p = res[t.id];
            if (!p) return;
            var row = null;
            for (var i = 0; i < rowsData.length; i++) if (rowsData[i].id === t.id) { row = rowsData[i]; break; }
            var prop = {}; ['artist', 'title', 'album', 'year', 'genre'].forEach(function (f) { if (p[f] !== undefined) prop[f] = p[f]; });
            if (row) { row.proposed = Object.assign({}, row.proposed, prop); row.source = 'gemini'; row.confidence = p.confidence; }
            else rowsData.push({ id: t.id, filename: t.filename, current: t, proposed: prop, source: 'gemini', confidence: p.confidence });
            added++;
          });
          statusEl.textContent = 'Gemini suggested tags for ' + added + ' of ' + pool.length + ' songs. Unsure ones are not ticked. Check them, then Apply.';
          aiBtn.disabled = false;
          aiBtn.textContent = 'Ask Gemini for the next 60 songs';
          render();
        }).catch(function (err) {
          pool.forEach(function (t) { delete aiAsked[t.id]; });
          aiBtn.disabled = false;
          if (err && err.code === 'aborted') return;
          statusEl.textContent = (err && err.message) ? err.message : 'Gemini did not answer.';
        });
      }

      back.addEventListener('change', updateCount);
      back.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') close(); });
      back.addEventListener('click', function (e) {
        if (e.target === back) { close(); return; }
        var b = e.target.closest ? e.target.closest('[data-tf]') : null;
        if (!b || b.disabled) return;
        var act = b.getAttribute('data-tf');
        if (act === 'close') close();
        else if (act === 'ai') askGemini();
        else if (act === 'apply') {
          var changes = [];
          back.querySelectorAll('tbody tr').forEach(function (tr) {
            if (!tr.querySelector('.mk-tf-chk').checked) return;
            var r = rowsData[parseInt(tr.getAttribute('data-i'), 10)];
            var c = { id: r.id };
            COLS.forEach(function (f) {
              var v = tr.querySelector('[data-f="' + f + '"]').value.trim();
              var cur = r.current[f] == null ? '' : String(r.current[f]);
              if (v && v !== cur && !(f === 'year' && cur === '0')) c[f] = v;
            });
            if (Object.keys(c).length > 1) changes.push(c);
          });
          if (!changes.length) { alert('Nothing selected to apply.'); return; }
          if (!(api && api.applyTagFixes)) return;
          api.applyTagFixes(changes).then(function (r) {
            close();
            reload();
            alert('Saved ' + ((r && r.applied) || 0) + ' fixes in the library. Music files were not changed. Open "Fix missing tags..." again to undo.');
          });
        } else if (act === 'undo') {
          if (!(api && api.undoTagFixes)) return;
          if (!window.confirm('Undo the last batch of tag fixes?')) return;
          api.undoTagFixes().then(function (r) { close(); reload(); alert('Restored ' + ((r && r.restored) || 0) + ' songs.'); });
        }
      });
    }
    if (api && api.getTracks) api.getTracks({}).then(show).catch(function () { show(self.state.tracks || []); });
    else show(self.state.tracks || []);
  };

  /* ---------------- Find song info (web catalogues, optional Gemini) ---------------- */

  MakanDrawers.prototype.openSongLookup = function () {
    var self = this;
    var api = window.MakanDesktop;
    var track = this.state.currentTrack;
    if (!track || !track.id) { alert('Play or select a song first, then press this button.'); return; }
    if (!(api && api.songLookupSearch)) { alert('Find song info works in the MAKAN desktop app.'); return; }
    var esc = function (v) { return self._escapeHtml(String(v == null ? '' : v)); };
    var escA = function (v) { return self._escapeAttr(String(v == null ? '' : v)); };
    var back = document.createElement('div');
    back.className = 'mk-modal-back';
    back.innerHTML = '<div class="mk-modal-box mk-modal-wide" role="dialog" aria-modal="true">' +
      '<div class="mk-modal-title">Find song info</div>' +
      '<div class="mk-tf-note">Song: <strong>' + esc(track.filename || track.title) + '</strong><br>Searches Apple Music and Deezer (free, no AI tokens). Only the words below are sent. Nothing changes until you press Apply, and your music file is never changed.</div>' +
      '<div class="mk-sl-search"><input type="text" class="mk-modal-input" id="mk-sl-query" maxlength="200" spellcheck="false" placeholder="Song name and singer">' +
      '<button type="button" class="mk-btn mk-btn-primary" data-sl="search">Search</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-sl="gemini" title="Asks Gemini about this one song with your own key (a few tokens). Only used when you press it.">Ask Gemini</button></div>' +
      '<div class="mk-tf-status" id="mk-sl-status">Searching...</div>' +
      '<div class="mk-sl-cols"><div class="mk-sl-list" id="mk-sl-list"></div><div class="mk-sl-detail" id="mk-sl-detail"></div></div>' +
      '<div class="mk-modal-actions"><button type="button" class="mk-btn mk-btn-secondary" data-sl="undo" id="mk-sl-undo" disabled>Undo last apply</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-sl="close">Close</button>' +
      '<button type="button" class="mk-btn mk-btn-primary" data-sl="apply" id="mk-sl-apply" disabled>Apply selected</button></div></div>';
    document.body.appendChild(back);
    var statusEl = back.querySelector('#mk-sl-status');
    var listEl = back.querySelector('#mk-sl-list');
    var detailEl = back.querySelector('#mk-sl-detail');
    var applyBtn = back.querySelector('#mk-sl-apply');
    var queryEl = back.querySelector('#mk-sl-query');
    var cands = [];
    var picked = -1;
    var closed = false;
    function close() { closed = true; if (back.parentNode) back.parentNode.removeChild(back); }
    if (api.hasTagFixUndo) api.hasTagFixUndo().then(function (has) { var u = back.querySelector('#mk-sl-undo'); if (u) u.disabled = !has; });

    function cur(f) { var v = track[f]; return (v === undefined || v === null || v === 0) ? '' : String(v); }

    function renderList() {
      if (!cands.length) { listEl.innerHTML = ''; detailEl.innerHTML = ''; applyBtn.disabled = true; return; }
      var h = '';
      cands.forEach(function (c, i) {
        h += '<div class="mk-sl-card' + (i === picked ? ' mk-on' : '') + '" data-i="' + i + '">' +
          (c.thumbUrl ? '<img class="mk-sl-thumb" src="' + escA(c.thumbUrl) + '" alt="" referrerpolicy="no-referrer">' : '<div class="mk-sl-thumb mk-sl-nothumb"></div>') +
          '<div class="mk-sl-info"><div class="mk-sl-name">' + esc(c.artist) + ' - ' + esc(c.title) + '</div>' +
          '<div class="mk-sl-sub">' + esc([c.album, c.year || '', c.genre].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="mk-sl-sub">' + esc(c.source) + (c.durationDiff !== undefined && c.durationDiff <= 3 ? ' · same length as your file' : '') + (c.confidence === 'low' ? ' · Gemini unsure' : '') + '</div></div></div>';
      });
      listEl.innerHTML = h;
    }

    function renderDetail() {
      var c = cands[picked];
      if (!c) { detailEl.innerHTML = ''; applyBtn.disabled = true; return; }
      var rows = [['artist', 'Artist', c.artist], ['title', 'Title', c.title], ['album', 'Album', c.album], ['year', 'Year', c.year || ''], ['genre', 'Genre', c.genre]];
      var h = '<table class="mk-tf-table"><thead><tr><th></th><th></th><th>Now</th><th>New</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var now = cur(r[0]), nw = String(r[2] == null ? '' : r[2]);
        if (!nw) return;
        var tick = now !== nw && (r[0] !== 'title' || !now || now === String(track.filename || '').replace(/\.[a-z0-9]{2,5}$/i, ''));
        h += '<tr><td><input type="checkbox" class="mk-sl-chk" data-f="' + r[0] + '"' + (tick ? ' checked' : '') + '></td><td>' + r[1] + '</td><td class="mk-tf-file">' + esc(now) + '</td><td><input type="text" class="mk-tf-in mk-sl-val" data-f="' + r[0] + '" value="' + escA(nw) + '"></td></tr>';
      });
      if (c.coverUrl) {
        h += '<tr><td><input type="checkbox" class="mk-sl-chk" data-f="cover"' + (track.artwork_path ? '' : ' checked') + '></td><td>Cover</td><td class="mk-tf-file">' + (track.artwork_path ? 'has a picture' : 'none') + '</td><td><img class="mk-sl-cover" src="' + escA(c.thumbUrl || c.coverUrl) + '" alt="" referrerpolicy="no-referrer"></td></tr>';
      }
      detailEl.innerHTML = h + '</tbody></table>';
      applyBtn.disabled = false;
    }

    function doSearch() {
      var q = queryEl.value.trim();
      statusEl.textContent = 'Searching...';
      api.songLookupSearch({ trackId: track.id, query: q }).then(function (r) {
        if (closed) return;
        if (!r || !r.ok) { statusEl.textContent = (r && r.error) || 'Search failed.'; return; }
        if (!queryEl.value.trim()) queryEl.value = r.query || '';
        cands = r.candidates || [];
        picked = cands.length ? 0 : -1;
        statusEl.textContent = cands.length ? (cands.length + ' matches. Pick the right one, tick what to copy, then Apply.') : 'Nothing found. Change the words above (try the singer\'s name too) or press Ask Gemini.';
        renderList(); renderDetail();
      }).catch(function () { if (!closed) statusEl.textContent = 'Search failed.'; });
    }

    function askGemini() {
      var Ai = window.MakanTagAi;
      var T = window.MakanLyricsTranslate && window.MakanLyricsTranslate.getShared ? window.MakanLyricsTranslate.getShared() : null;
      var key = T && T._keys ? T._keys.gemini : '';
      if (!Ai) return;
      if (!key) { statusEl.textContent = 'No Gemini key yet. Open Settings -> Lyrics, paste your Gemini API key, then try again.'; return; }
      statusEl.textContent = 'Asking Gemini...';
      var probe = Object.assign({}, track, { artist: '', album: '', genre: '', year: 0, title: queryEl.value.trim() || track.title });
      Ai.suggest([probe], { key: key }).then(function (res) {
        if (closed) return;
        var p = res[probe.id];
        if (!p) { statusEl.textContent = 'Gemini does not know this song. Try other words above.'; return; }
        cands.unshift({ source: 'Gemini', artist: p.artist || '', title: p.title || '', album: p.album || '', year: p.year || 0, genre: p.genre || '', coverUrl: '', thumbUrl: '', confidence: p.confidence });
        picked = 0;
        statusEl.textContent = 'Gemini answered. It can be wrong: check before Apply. (Gemini does not give a cover picture.)';
        renderList(); renderDetail();
      }).catch(function (err) { if (!closed) statusEl.textContent = (err && err.message) || 'Gemini did not answer.'; });
    }

    function apply() {
      var c = cands[picked];
      if (!c) return;
      var fields = {}, wantCover = false;
      detailEl.querySelectorAll('.mk-sl-chk').forEach(function (chk) {
        if (!chk.checked) return;
        var f = chk.getAttribute('data-f');
        if (f === 'cover') { wantCover = true; return; }
        var inp = detailEl.querySelector('.mk-sl-val[data-f="' + f + '"]');
        if (inp && inp.value.trim()) fields[f] = inp.value.trim();
      });
      if (!Object.keys(fields).length && !wantCover) { alert('Tick at least one thing to copy.'); return; }
      applyBtn.disabled = true;
      statusEl.textContent = 'Saving...';
      api.songLookupApply({ trackId: track.id, fields: fields, coverUrl: wantCover ? c.coverUrl : '' }).then(function (r) {
        if (!r || !r.ok) { applyBtn.disabled = false; statusEl.textContent = (r && r.error) || 'Could not save.'; return; }
        var nt = r.track;
        if (nt) {
          // update the song in memory so the screen changes at once and playback is not touched
          var targets = [track];
          (self.state.tracks || []).forEach(function (t) { if (t.id === nt.id && targets.indexOf(t) === -1) targets.push(t); });
          targets.forEach(function (t) {
            ['artist', 'title', 'album', 'genre', 'year'].forEach(function (k) { if (nt[k] !== undefined && nt[k] !== null) t[k] = nt[k]; });
            if (nt.artwork_path) { t.artwork_path = nt.artwork_path; t.art = '/api/artwork?id=' + encodeURIComponent(t.id) + '&v=' + Date.now(); }
          });
          self.state.emit('trackMetaEdited', { id: nt.id });
          self.state.emit('libraryUpdated');
        }
        close();
        alert(r.applied ? 'Saved in the library. Your music file was not changed. Use Find song info -> Undo last apply to go back.' : 'Nothing was different, so nothing changed.');
      }).catch(function () { applyBtn.disabled = false; statusEl.textContent = 'Could not save.'; });
    }

    back.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && e.target === queryEl) { e.preventDefault(); doSearch(); }
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      var card = e.target.closest ? e.target.closest('.mk-sl-card') : null;
      if (card) { picked = parseInt(card.getAttribute('data-i'), 10); renderList(); renderDetail(); return; }
      var b = e.target.closest ? e.target.closest('[data-sl]') : null;
      if (!b || b.disabled) return;
      var act = b.getAttribute('data-sl');
      if (act === 'close') close();
      else if (act === 'search') doSearch();
      else if (act === 'gemini') askGemini();
      else if (act === 'apply') apply();
      else if (act === 'undo') {
        if (!api.undoTagFixes || !window.confirm('Undo the last batch of tag fixes (including a cover picture)?')) return;
        api.undoTagFixes().then(function (r) {
          // refresh from the library so the screen shows the restored values (playback is not touched)
          api.getTracks({}).then(function (all) {
            var byId = {}; (all || []).forEach(function (t) { byId[t.id] = t; });
            var targets = [track].concat((self.state.tracks || []).filter(function (t) { return t !== track; }));
            targets.forEach(function (t) {
              var n = byId[t.id]; if (!n) return;
              ['artist', 'title', 'album', 'genre', 'year', 'artwork_path'].forEach(function (k) { t[k] = n[k]; });
              t.art = n.artwork_path ? '/api/artwork?id=' + encodeURIComponent(t.id) + '&v=' + Date.now() : undefined;
            });
            self.state.emit('trackMetaEdited', {}); self.state.emit('libraryUpdated');
          });
          close();
          alert('Restored ' + ((r && r.restored) || 0) + ' song(s).');
        });
      }
    });
    queryEl.focus();
    doSearch();
  };

  /* ---------------- Showing and playing lists of songs ---------------- */

  /* show these songs in the main list (like opening a playlist), without starting playback */
  MakanDrawers.prototype._showTracks = function (tracks) {
    var st = this.state;
    var input = document.getElementById('mk-global-search-input');
    if (input) input.value = '';
    var lib = document.getElementById('mk-lib-search-input');
    if (lib) lib.value = '';
    st.globalSearchQuery = '';
    st.emit('globalSearch', { query: '' });
    st.tracks = tracks;
    st.totalTracksDisplay = tracks.length;
    st.emit('libraryUpdated');
    st.closeDrawers();
  };

  MakanDrawers.prototype._playTracks = function (tracks, name) {
    this._showTracks(tracks);
    if (this.controller && tracks.length) this.controller.setContext(tracks, 0, { type: 'playlist', name: name || 'Playlist' }, true);
  };

  MakanDrawers.prototype._allTracks = function () {
    var self = this;
    var api = window.MakanDesktop;
    if (api && api.getTracks) return api.getTracks({}).then(function (a) { return a || []; }).catch(function () { return self.state.tracks || []; });
    return Promise.resolve(self.state.tracks || []);
  };

  MakanDrawers.prototype.openPlaylistView = function (id, name) {
    var self = this;
    var api = window.MakanDesktop;
    if (!(api && api.getTracks)) return;
    api.getTracks({ playlistId: id }).then(function (tracks) {
      if (!tracks || !tracks.length) { alert('This playlist has no songs yet.'); return; }
      self._showTracks(tracks);
    });
  };

  /* ---------------- Songs like the playing song (no AI) ---------------- */

  MakanDrawers.prototype.showSimilar = function () {
    var self = this;
    var P = window.MakanAiPlaylist;
    var cur = this.state.currentTrack;
    if (!P) return;
    if (!cur || !cur.id) { alert('Play a song first, then press this button.'); return; }
    this._allTracks().then(function (all) {
      var map = P.similarMap(cur, all, 150, window.MakanSound && window.MakanSound.map);
      var list = all.filter(function (t) { return map[t.id]; }).sort(function (a, b) { return map[a.id].rank - map[b.id].rank; });
      if (!list.length) { alert('No similar songs found. Songs need the same artist, album, genre or nearby years as the playing song.'); return; }
      var full = all.filter(function (t) { return t.id === cur.id; }).concat(list);
      self._showTracks(full);
    });
  };

  /* a smooth-flowing queue that starts from the playing song (the playing song keeps playing) */
  MakanDrawers.prototype.showMix = function () {
    var self = this;
    var AM = window.MakanAutoMix;
    var cur = this.state.currentTrack;
    var map = window.MakanSound && window.MakanSound.map;
    if (!AM) return;
    if (!cur || !cur.id) { alert('Play a song first, then press this button.'); return; }
    if (!map || !map[cur.id]) { alert('The playing song has not been analysed yet. Press "Analyse my library" first (or let it play for a few seconds).'); return; }
    this._allTracks().then(function (all) {
      var list = AM.flowOrder(cur, all, map, 30);
      if (list.length < 2) { alert('Not enough analysed songs yet. Press "Analyse my library" first.'); return; }
      var ctrl = self.controller;
      if (!ctrl) return;
      if (ctrl.explicitQueue && ctrl.explicitQueue.length && !window.confirm('Replace the songs now in your Queue with this mix?')) return;
      ctrl.clearQueue();
      ctrl.playNext(list.slice(1));
      self.state.closeDrawers();
      self.state.toggleDrawer('queue');
    });
  };

  /* ---------------- AI playlist (Gemini or local Ollama) ---------------- */

  MakanDrawers.prototype.openAiPlaylist = function () {
    var self = this;
    var P = window.MakanAiPlaylist;
    var api = window.MakanDesktop;
    if (!P) return;
    var esc = function (v) { return self._escapeHtml(String(v == null ? '' : v)); };
    var back = document.createElement('div');
    back.className = 'mk-modal-back';
    back.innerHTML = '<div class="mk-modal-box mk-modal-wide" role="dialog" aria-modal="true">' +
      '<div class="mk-modal-title">Make a playlist with AI</div>' +
      '<div class="mk-tf-note">Write what you want, for example <em>calm songs for studying</em> or <em>rock from the 90s</em>. The AI only writes searches. <strong>Every song comes from your own library</strong>, and you see a preview before anything is saved. Only your sentence and a short list of your genres and artists are sent. No file names or audio.</div>' +
      '<div class="mk-sl-search"><input type="text" class="mk-modal-input" id="mk-ai-req" maxlength="300" spellcheck="false" placeholder="What kind of playlist do you want?"></div>' +
      '<div class="mk-ai-engine">' +
      '<label>Use <select id="mk-ai-engine" class="mk-modal-input"><option value="gemini">Gemini (your key, online)</option><option value="ollama">Ollama (on this PC, free)</option></select></label> ' +
      '<label id="mk-ai-gmodel-wrap">Model <select id="mk-ai-gmodel" class="mk-modal-input"><option value="">Automatic</option></select></label> ' +
      '<label id="mk-ai-model-wrap" hidden>Model <select id="mk-ai-model" class="mk-modal-input"></select></label> ' +
      '<button type="button" class="mk-btn mk-btn-primary" data-ai="make" id="mk-ai-make">Make playlist</button></div>' +
      '<div class="mk-tf-status" id="mk-ai-status"></div>' +
      '<div class="mk-ai-plan" id="mk-ai-plan"></div>' +
      '<div class="mk-ai-list" id="mk-ai-list"></div>' +
      '<div class="mk-modal-actions"><span class="mk-tf-count" id="mk-ai-count"></span>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-ai="close">Close</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-ai="save" id="mk-ai-save" disabled>Save as playlist</button>' +
      '<button type="button" class="mk-btn mk-btn-primary" data-ai="play" id="mk-ai-play" disabled>Play now</button></div></div>';
    document.body.appendChild(back);
    var $ = function (id) { return back.querySelector('#' + id); };
    var reqEl = $('mk-ai-req'), engEl = $('mk-ai-engine'), modEl = $('mk-ai-model'), modWrap = $('mk-ai-model-wrap');
    var gmEl = $('mk-ai-gmodel'), gmWrap = $('mk-ai-gmodel-wrap'), gmLoaded = false;
    var statusEl = $('mk-ai-status'), planEl = $('mk-ai-plan'), listEl = $('mk-ai-list'), countEl = $('mk-ai-count');
    var makeBtn = $('mk-ai-make'), saveBtn = $('mk-ai-save'), playBtn = $('mk-ai-play');
    var ctrl = null, result = [], plan = null, models = null;
    try { var saved = window.localStorage.getItem('mk-ai-engine'); if (saved === 'ollama' || saved === 'gemini') engEl.value = saved; } catch (e) {}

    function close() { if (ctrl) ctrl.abort(); if (back.parentNode) back.parentNode.removeChild(back); }
    function geminiKey() {
      var T = window.MakanLyricsTranslate && window.MakanLyricsTranslate.getShared ? window.MakanLyricsTranslate.getShared() : null;
      return T && T._keys ? T._keys.gemini : '';
    }
    function setBusy(b) { makeBtn.disabled = b; reqEl.disabled = b; engEl.disabled = b; modEl.disabled = b; gmEl.disabled = b; }
    function loadGeminiModels() {
      var key = geminiKey();
      if (!key || gmLoaded) return;
      gmLoaded = true;
      P.listGeminiModels(key).then(function (ids) {
        var want = '';
        try { want = window.localStorage.getItem('mk-ai-gemini-model') || ''; } catch (e) {}
        gmEl.innerHTML = '<option value="">Automatic (recommended)</option>' + ids.map(function (n) { return '<option value="' + self._escapeAttr(n) + '"' + (n === want ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
      }).catch(function () { gmLoaded = false; });
    }
    gmEl.addEventListener('change', function () { try { window.localStorage.setItem('mk-ai-gemini-model', gmEl.value); } catch (e) {} });
    function enableResult() { var on = result.length > 0; saveBtn.disabled = !on; playBtn.disabled = !on; }

    function loadModels() {
      statusEl.textContent = 'Looking for Ollama models...';
      P.listOllamaModels({}).then(function (names) {
        models = names;
        if (!names.length) { statusEl.textContent = 'Ollama is running but has no models yet. Install one, for example: ollama pull qwen2.5:7b'; return; }
        var pick = P.pickOllamaModel(names, '');
        try { var m = window.localStorage.getItem('mk-ai-ollama-model'); if (m && names.indexOf(m) >= 0) pick = m; } catch (e) {}
        modEl.innerHTML = names.map(function (n) { return '<option value="' + self._escapeAttr(n) + '"' + (n === pick ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
        statusEl.textContent = '';
      }).catch(function (err) { models = []; statusEl.textContent = (err && err.message) || 'Ollama does not answer.'; });
    }
    function syncEngine() {
      var ol = engEl.value === 'ollama';
      modWrap.hidden = !ol;
      gmWrap.hidden = ol;
      try { window.localStorage.setItem('mk-ai-engine', engEl.value); } catch (e) {}
      if (ol && models === null) loadModels();
      else if (!ol) { statusEl.textContent = geminiKey() ? '' : 'No Gemini key yet. Open Settings -> Lyrics, paste your Gemini API key there (tick "Remember my keys" so you do not need to paste it again), then try again.'; loadGeminiModels(); }
    }
    engEl.addEventListener('change', syncEngine);
    modEl.addEventListener('change', function () { try { window.localStorage.setItem('mk-ai-ollama-model', modEl.value); } catch (e) {} });

    function renderResult() {
      if (!plan) { planEl.innerHTML = ''; listEl.innerHTML = ''; countEl.textContent = ''; enableResult(); return; }
      planEl.innerHTML = '<div class="mk-ai-plan-name">' + esc(plan.name) + '</div>' +
        (plan.why ? '<div class="mk-tf-status">' + esc(plan.why) + '</div>' : '') +
        '<div class="mk-tf-status">Searches used: ' + plan.queries.map(function (q) { return '<code>' + esc(q) + '</code>'; }).join(' + ') + '</div>';
      if (!result.length) {
        listEl.innerHTML = '<div class="mk-tf-empty">No songs in your library matched. Try different words, or add songs first.</div>';
        countEl.textContent = '';
      } else {
        listEl.innerHTML = result.slice(0, 200).map(function (t) {
          return '<div class="mk-ai-row"><span class="mk-ai-t">' + esc(t.title || t.filename) + '</span><span class="mk-ai-a">' + esc(t.artist || '') + '</span></div>';
        }).join('');
        countEl.textContent = result.length + ' songs' + (result.length > 200 ? ' (first 200 shown)' : '');
      }
      enableResult();
    }

    function make() {
      var text = reqEl.value.trim();
      if (!text) { statusEl.textContent = 'Write what kind of playlist you want first.'; reqEl.focus(); return; }
      var engine = engEl.value;
      if (engine === 'gemini' && !geminiKey()) { statusEl.textContent = 'No Gemini key yet. Open Settings -> Lyrics, paste your Gemini API key there, then try again.'; return; }
      if (engine === 'ollama' && !modEl.value) { statusEl.textContent = 'Pick an Ollama model first (is Ollama running?).'; return; }
      setBusy(true); plan = null; result = []; renderResult();
      statusEl.textContent = engine === 'ollama' ? 'Asking ' + modEl.value + '... (the first time can take a minute)' : 'Asking Gemini...';
      ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      self._allTracks().then(function (all) {
        var ctx = P.buildContext(all, window.MakanSound && window.MakanSound.map);
        var ask = engine === 'ollama'
          ? P.askOllama({ request: text, context: ctx, model: modEl.value, signal: ctrl && ctrl.signal })
          : P.askGemini({ request: text, context: ctx, key: geminiKey(), model: gmEl.value || undefined, signal: ctrl && ctrl.signal });
        return ask.then(function (pl) {
          plan = pl;
          var terms = P.lyricTerms(pl, window.MakanTrackTable.parseSearchQuery);
          var getHits = (terms.length && api && api.searchLyrics) ? api.searchLyrics(terms).catch(function () { return {}; }) : Promise.resolve({});
          return getHits.then(function (res) {
            var hits = {};
            Object.keys(res || {}).forEach(function (k) { hits[k] = new Set(res[k] || []); });
            hits.__feat = (window.MakanSound && window.MakanSound.map) || {};
            result = P.runPlan(pl, all, window.MakanTrackTable.parseSearchQuery, window.MakanTrackTable.filterTrack, hits, 100);
          });
        });
      }).then(function () {
        statusEl.textContent = '';
        renderResult();
      }).catch(function (err) {
        if (err && err.code === 'aborted') return;
        statusEl.textContent = (err && err.message) || 'Something went wrong.';
        renderResult();
      }).then(function () { setBusy(false); });
    }

    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      var b = e.target.closest('[data-ai]');
      if (!b) return;
      var act = b.getAttribute('data-ai');
      if (act === 'close') close();
      else if (act === 'make') make();
      else if (act === 'play') { var r = result.slice(); var nm = plan ? plan.name : 'AI playlist'; close(); self._playTracks(r, nm); }
      else if (act === 'save') {
        var ids = result.map(function (t) { return t.id; });
        self._askName('Name for this playlist', plan ? plan.name : 'AI playlist', function (name) {
          if (!(name && name.trim() && api && api.createPlaylist)) return;
          api.createPlaylist(name.trim()).then(function (res) {
            var plId = res && res.id ? res.id : (typeof res === 'string' ? res : null);
            if (!plId || !api.addTracksToPlaylist) { statusEl.textContent = 'Could not create the playlist.'; return; }
            return api.addTracksToPlaylist(plId, ids, true).then(function () {
              self.loadPlaylists();
              statusEl.textContent = 'Saved "' + name.trim() + '" with ' + ids.length + ' songs. It is in the Playlists list.';
              saveBtn.disabled = true;
            });
          });
        });
      }
    });
    reqEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); make(); } });
    syncEngine();
    reqEl.focus();
  };

  /* ---------------- Artists / Albums / Genres pages ---------------- */

  MakanDrawers.prototype.openBrowse = function (kind) {
    var self = this;
    if (kind !== 'artists' && kind !== 'albums' && kind !== 'genres') return;
    var esc = function (v) { return self._escapeHtml(String(v == null ? '' : v)); };
    var title = kind === 'artists' ? 'Artists' : kind === 'albums' ? 'Albums' : 'Genres';
    var back = document.createElement('div');
    back.className = 'mk-modal-back';
    back.innerHTML = '<div class="mk-modal-box mk-modal-wide" role="dialog" aria-modal="true">' +
      '<div class="mk-modal-title">' + title + '</div>' +
      '<div class="mk-sl-search"><input type="text" class="mk-modal-input" id="mk-br-q" maxlength="100" spellcheck="false" placeholder="Type to find..."></div>' +
      '<div class="mk-br-list" id="mk-br-list"><div class="mk-tf-status">Loading...</div></div>' +
      '<div class="mk-modal-actions"><span class="mk-tf-count" id="mk-br-count"></span><button type="button" class="mk-btn mk-btn-secondary" data-br="close">Close</button></div></div>';
    document.body.appendChild(back);
    var listEl = back.querySelector('#mk-br-list'), qEl = back.querySelector('#mk-br-q'), countEl = back.querySelector('#mk-br-count');
    var groups = [];
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }

    function build(all) {
      var map = {};
      all.forEach(function (t) {
        var name = String(kind === 'artists' ? t.artist : kind === 'albums' ? t.album : t.genre || '').trim();
        if (kind === 'artists') name = String(t.artist || '').trim();
        if (kind === 'albums') name = String(t.album || '').trim();
        if (kind === 'genres') name = String(t.genre || '').trim();
        var sub = kind === 'albums' ? String(t.album_artist || t.artist || '').trim() : '';
        var key = (name || '').toLowerCase() + '|' + sub.toLowerCase();
        var g = map[key];
        if (!g) g = map[key] = { name: name || 'Unknown', sub: sub, unknown: !name, tracks: [] };
        g.tracks.push(t);
      });
      groups = Object.keys(map).map(function (k) { return map[k]; });
      groups.sort(function (a, b) {
        if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      });
    }

    function paint() {
      var q = qEl.value.trim().toLowerCase();
      var shown = groups.filter(function (g) { return !q || (g.name + ' ' + g.sub).toLowerCase().indexOf(q) !== -1; });
      countEl.textContent = shown.length + ' of ' + groups.length;
      if (!shown.length) { listEl.innerHTML = '<div class="mk-tf-empty">Nothing found.</div>'; return; }
      listEl.innerHTML = shown.slice(0, 600).map(function (g) {
        var i = groups.indexOf(g);
        return '<div class="mk-br-row" data-i="' + i + '" title="Show these songs"><div class="mk-br-info"><div class="mk-br-name">' + esc(g.name) + '</div>' +
          '<div class="mk-br-sub">' + esc((g.sub ? g.sub + ' · ' : '') + g.tracks.length + (g.tracks.length === 1 ? ' song' : ' songs')) + '</div></div>' +
          '<button type="button" class="mk-btn mk-btn-secondary" data-br-play="' + i + '" title="Play all of these">Play</button></div>';
      }).join('');
    }

    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      if (e.target.closest('[data-br="close"]')) { close(); return; }
      var pb = e.target.closest('[data-br-play]');
      if (pb) { var g = groups[parseInt(pb.getAttribute('data-br-play'), 10)]; if (g) { close(); self._playTracks(g.tracks.slice(), g.name); } return; }
      var row = e.target.closest('.mk-br-row');
      if (row) { var g2 = groups[parseInt(row.getAttribute('data-i'), 10)]; if (g2) { close(); self._showTracks(g2.tracks.slice()); } }
    });
    qEl.addEventListener('input', paint);
    this._allTracks().then(function (all) { build(all); paint(); });
    qEl.focus();
  };

  /* ---------------- Sound analysis of the library (BPM, energy) ---------------- */

  MakanDrawers.prototype.updateSoundBox = function () {
    var self = this;
    var S = window.MakanSound;
    var box = this.el && this.el.querySelector('#mk-sound-box');
    if (!S || !box) return;
    var esc = function (v) { return self._escapeHtml(String(v == null ? '' : v)); };
    if (this._soundRun) {
      var r = this._soundRun;
      box.innerHTML = '<span class="mk-sound-msg">' + esc(r.msg || 'Starting...') + '</span> <button type="button" class="mk-btn mk-btn-secondary" id="mk-sound-btn">Stop</button>';
      return;
    }
    this._allTracks().then(function (all) {
      if (self._soundRun || !box.isConnected) return;
      var failed = self._soundFailed || {};
      var ok = all.filter(function (t) { return S.canAnalyse(t) && !failed[t.id]; });
      var done = ok.filter(function (t) { return S.map[t.id]; }).length;
      var left = ok.length - done;
      var msg = !ok.length ? 'Sound analysis: no songs to analyse yet.' :
        left === 0 ? 'Sound analysis: all ' + ok.length + ' songs are done' + (Object.keys(failed).length ? ' (' + Object.keys(failed).length + ' could not be read)' : '') + '. Search with bpm:120-130 or energy:high.' :
        done === 0 ? 'Sound analysis (BPM and energy) has not run yet. It works on this PC, about a second per song, and lets you search bpm:120-130 or energy:high and gives better similar songs.' :
        'Sound analysis: ' + done + ' of ' + ok.length + ' songs done.';
      box.innerHTML = '<span class="mk-sound-msg">' + esc(msg) + '</span>' + (left > 0 ? ' <button type="button" class="mk-btn mk-btn-secondary" id="mk-sound-btn">' + (done ? 'Analyse the rest' : 'Analyse my library') + '</button>' : '');
    });
  };

  MakanDrawers.prototype.toggleSoundAnalysis = function () {
    var self = this;
    var S = window.MakanSound;
    if (!S) return;
    if (this._soundRun) { this._soundRun.stop = true; this._soundRun.msg = 'Stopping...'; this.updateSoundBox(); return; }
    var run = this._soundRun = { stop: false, msg: 'Starting...' };
    this._soundFailed = this._soundFailed || {};
    this.updateSoundBox();
    this._allTracks().then(async function (all) {
      var todo = all.filter(function (t) { return S.canAnalyse(t) && !S.map[t.id] && !self._soundFailed[t.id]; });
      var an = S.createAnalyser({ api: window.MakanDesktop, waveform: window.MakanWaveform });
      var t0 = Date.now();
      for (var i = 0; i < todo.length && !run.stop; i++) {
        var f = await an.analyse(todo[i]);
        if (!f) self._soundFailed[todo[i].id] = true;
        var mins = Math.max(1, Math.round(((Date.now() - t0) / (i + 1)) * (todo.length - i - 1) / 60000));
        run.msg = 'Analysing ' + (i + 1) + ' of ' + todo.length + ' (about ' + mins + ' min left). You can keep using the player.';
        var m = self.el && self.el.querySelector('#mk-sound-box .mk-sound-msg');
        if (m) m.textContent = run.msg;
      }
    }).catch(function () {}).then(function () { self._soundRun = null; self.updateSoundBox(); });
  };

  /* ---------------- Study words (saved from the lyrics panel) ---------------- */
  MakanDrawers.prototype.openStudy = function () {
    var self = this;
    var api = window.MakanDesktop;
    var SW = window.MakanStudyWords;
    var esc = function (v) { return self._escapeHtml(String(v == null ? '' : v)); };
    var back = document.createElement('div');
    back.className = 'mk-modal-back';
    back.innerHTML = '<div class="mk-modal-box mk-modal-wide" role="dialog" aria-modal="true">' +
      '<div class="mk-modal-title">Study words</div>' +
      '<div class="mk-sw-bar"><input type="text" class="mk-modal-input mk-sw-q" id="mk-sw-q" placeholder="Search your words" autocomplete="off">' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-sw="practice">Practice</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-sw="copy">Copy as CSV</button></div>' +
      '<div class="mk-st-body" id="mk-sw-body"><div class="mk-tf-status">Loading...</div></div>' +
      '<div class="mk-modal-actions"><button type="button" class="mk-btn mk-btn-secondary" data-sw="close">Close</button></div></div>';
    document.body.appendChild(back);
    var body = back.querySelector('#mk-sw-body');
    var qEl = back.querySelector('#mk-sw-q');
    var rows = [];
    var deck = null, di = 0, shown = false;
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    function visible() { return SW ? SW.filterWords(rows, qEl.value) : rows; }

    function paintList() {
      deck = null;
      if (!rows.length) { body.innerHTML = '<div class="mk-tf-empty">No words yet. In the lyrics panel, tap a word and press "Save word". It will be kept here with its song line.</div>'; return; }
      var list = visible();
      if (!list.length) { body.innerHTML = '<div class="mk-tf-empty">No saved word matches this search.</div>'; return; }
      body.innerHTML = list.map(function (r) {
        return '<div class="mk-sw-row" data-id="' + r.id + '"><div class="mk-sw-main"><b>' + esc(r.word) + '</b> <span>' + esc(r.translation) + '</span></div>' +
          (r.line ? '<div class="mk-sw-line">' + esc(r.line) + '</div>' : '') +
          '<div class="mk-sw-song">' + esc([r.title, r.artist].filter(Boolean).join(' · ')) + '</div>' +
          '<button type="button" class="mk-sw-del" data-sw-del="' + r.id + '" title="Remove this word">×</button></div>';
      }).join('');
    }

    function paintCard() {
      if (!deck || !deck.length) { paintList(); return; }
      if (di >= deck.length) {
        body.innerHTML = '<div class="mk-tf-empty">Finished: ' + deck.length + (deck.length === 1 ? ' word.' : ' words.') + '</div><div class="mk-sw-actions"><button type="button" class="mk-btn mk-btn-secondary" data-sw="practice">Practice again</button><button type="button" class="mk-btn mk-btn-secondary" data-sw="list">Back to the list</button></div>';
        return;
      }
      var c = deck[di];
      body.innerHTML = '<div class="mk-sw-card"><div class="mk-sw-count">' + (di + 1) + ' of ' + deck.length + '</div>' +
        '<div class="mk-sw-big">' + esc(c.word) + '</div>' +
        (c.line ? '<div class="mk-sw-line">' + esc(c.line) + '</div>' : '') +
        '<div class="mk-sw-answer">' + (shown ? esc(c.translation || 'No translation saved') : '') + '</div>' +
        '<div class="mk-sw-actions">' + (shown ? '<button type="button" class="mk-btn mk-btn-secondary" data-sw="next">Next</button>' : '<button type="button" class="mk-btn mk-btn-secondary" data-sw="show">Show answer</button>') +
        '<button type="button" class="mk-btn mk-btn-secondary" data-sw="list">Back to the list</button></div></div>';
    }

    function load() {
      if (!(api && api.getStudyWords)) { body.innerHTML = '<div class="mk-tf-empty">Study words work in the MAKAN desktop app.</div>'; return; }
      api.getStudyWords().then(function (r) { rows = Array.isArray(r) ? r : []; paintList(); }).catch(function () { body.innerHTML = '<div class="mk-tf-empty">Could not read the saved words.</div>'; });
    }

    qEl.addEventListener('input', function () { if (!deck) paintList(); });
    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      var del = e.target.closest('[data-sw-del]');
      if (del) {
        var id = Number(del.getAttribute('data-sw-del'));
        api.removeStudyWord(id).then(function (ok) { if (ok) { rows = rows.filter(function (r) { return r.id !== id; }); paintList(); } });
        return;
      }
      var a = e.target.closest('[data-sw]');
      if (!a) return;
      var act = a.getAttribute('data-sw');
      if (act === 'close') close();
      else if (act === 'practice') {
        var list = visible();
        if (!list.length) return;
        deck = SW ? SW.shuffle(list) : list; di = 0; shown = false; paintCard();
      } else if (act === 'show') { shown = true; paintCard(); }
      else if (act === 'next') { di++; shown = false; paintCard(); }
      else if (act === 'list') paintList();
      else if (act === 'copy') {
        var csv = SW ? SW.toCsv(visible()) : '';
        var done = function (ok) { a.textContent = ok ? 'Copied' : 'Could not copy'; setTimeout(function () { a.textContent = 'Copy as CSV'; }, 1800); };
        try { navigator.clipboard.writeText(csv).then(function () { done(true); }, function () { done(false); }); } catch (er) { done(false); }
      }
    });
    load();
  };

  /* ---------------- Listening stats ---------------- */

  MakanDrawers.prototype.openStats = function () {
    var self = this;
    var api = window.MakanDesktop;
    var esc = function (v) { return self._escapeHtml(String(v == null ? '' : v)); };
    var back = document.createElement('div');
    back.className = 'mk-modal-back';
    back.innerHTML = '<div class="mk-modal-box mk-modal-wide" role="dialog" aria-modal="true">' +
      '<div class="mk-modal-title">Listening stats</div>' +
      '<div class="mk-st-tabs" id="mk-st-tabs">' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-range="week">7 days</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-range="month">30 days</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-range="year">This year</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-range="all">All time</button></div>' +
      '<div class="mk-st-body" id="mk-st-body"><div class="mk-tf-status">Loading...</div></div>' +
      '<div class="mk-modal-actions"><button type="button" class="mk-btn mk-btn-secondary" data-st="close">Close</button></div></div>';
    document.body.appendChild(back);
    var body = back.querySelector('#mk-st-body');
    var range = 'month';
    try { var r0 = window.localStorage.getItem('mk-stats-range'); if (r0 === 'week' || r0 === 'month' || r0 === 'year' || r0 === 'all') range = r0; } catch (e) {}
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }

    function bars(list, labelOf, clickKey) {
      var max = 1;
      list.forEach(function (x) { if (x.count > max) max = x.count; });
      return list.map(function (x, i) {
        return '<div class="mk-st-row"' + (clickKey ? ' data-st-artist="' + self._escapeAttr(x.name) + '" title="Show these songs"' : '') + '>' +
          '<span class="mk-st-rank">' + (i + 1) + '</span>' +
          '<span class="mk-st-name">' + labelOf(x) + '</span>' +
          '<span class="mk-st-bar"><i style="width:' + Math.max(4, Math.round(100 * x.count / max)) + '%"></i></span>' +
          '<span class="mk-st-num">' + x.count + '</span></div>';
      }).join('');
    }
    function chart(vals, labels) {
      var max = 1;
      vals.forEach(function (v) { if (v > max) max = v; });
      return '<div class="mk-st-chart">' + vals.map(function (v, i) {
        return '<div class="mk-st-col" title="' + esc(labels[i]) + ': ' + v + ' plays"><i style="height:' + Math.round(100 * v / max) + '%"></i><b>' + esc(labels[i]) + '</b></div>';
      }).join('') + '</div>';
    }

    function paint(st) {
      Array.prototype.forEach.call(back.querySelectorAll('[data-range]'), function (b) { b.classList.toggle('mk-on', b.getAttribute('data-range') === range); });
      if (!st) { body.innerHTML = '<div class="mk-tf-empty">Could not read the play history.</div>'; return; }
      var lib = st.library || {};
      var h = '';
      if (!st.plays) {
        h += '<div class="mk-tf-empty">No plays recorded in this period yet. Every song you play is counted, so this page fills up as you listen.</div>';
      } else {
        h += '<div class="mk-st-tiles">' +
          '<div class="mk-st-tile"><b>' + st.plays + '</b><span>plays</span></div>' +
          '<div class="mk-st-tile"><b>' + st.hours + '</b><span>hours (estimate)</span></div>' +
          '<div class="mk-st-tile"><b>' + st.songs + '</b><span>different songs</span></div>' +
          '<div class="mk-st-tile"><b>' + st.artists + '</b><span>artists</span></div></div>';
        h += '<div class="mk-st-cols"><div><div class="mk-st-h">Top songs</div>' +
          bars(st.topTracks, function (t) { return esc(t.title) + (t.artist ? ' <small>' + esc(t.artist) + '</small>' : ''); }) + '</div>' +
          '<div><div class="mk-st-h">Top artists <small>(click to show songs)</small></div>' +
          (st.topArtists.length ? bars(st.topArtists, function (a) { return esc(a.name) + ' <small>' + a.songs + (a.songs === 1 ? ' song' : ' songs') + '</small>'; }, true) : '<div class="mk-tf-empty">No artist names on these songs.</div>') + '</div></div>';
        if (st.topGenres.length) h += '<div class="mk-st-h">Top genres</div>' + bars(st.topGenres, function (g) { return esc(g.name); });
        var hourLabels = []; for (var i = 0; i < 24; i++) hourLabels.push(String(i));
        h += '<div class="mk-st-h">When you listen</div>' + chart(st.byHour, hourLabels);
        var wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var wv = [st.byWeekday[1], st.byWeekday[2], st.byWeekday[3], st.byWeekday[4], st.byWeekday[5], st.byWeekday[6], st.byWeekday[0]];
        h += '<div class="mk-st-h">By weekday</div>' + chart(wv, wd);
      }
      h += '<div class="mk-st-h">Your library</div><div class="mk-st-lib">' + (lib.songs || 0) + ' songs · ' + (lib.hours || 0) + ' hours · ' + (lib.neverPlayed || 0) + ' never played</div>';
      if (lib.forgotten && lib.forgotten.length) {
        h += '<div class="mk-st-h">Forgotten favourites <small>(played 3+ times, not in 90 days)</small></div>' +
          lib.forgotten.map(function (t) { return '<div class="mk-st-lib">' + esc(t.title) + (t.artist ? ' <small>' + esc(t.artist) + '</small>' : '') + ' · ' + t.play_count + ' plays</div>'; }).join('');
      }
      body.innerHTML = h;
    }

    function load() {
      body.innerHTML = '<div class="mk-tf-status">Loading...</div>';
      if (!(api && api.getStats)) { body.innerHTML = '<div class="mk-tf-empty">Listening stats work in the MAKAN desktop app.</div>'; return; }
      api.getStats(range).then(function (res) { paint(res && res.ok ? res.stats : null); }).catch(function () { paint(null); });
    }

    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-st="close"]')) { close(); return; }
      var rb = e.target.closest('[data-range]');
      if (rb) { range = rb.getAttribute('data-range'); try { window.localStorage.setItem('mk-stats-range', range); } catch (er) {} load(); return; }
      var ar = e.target.closest('[data-st-artist]');
      if (ar) {
        var name = ar.getAttribute('data-st-artist').toLowerCase();
        close();
        self._allTracks().then(function (all) {
          var list = all.filter(function (t) { return String(t.artist || '').trim().toLowerCase() === name; });
          if (list.length) self._showTracks(list);
        });
      }
    });
    load();
  };

  MakanDrawers.prototype.applySmartQuery = function (query) {
    var st = this.state;
    st.activeNavItem = 'library';
    st.emit('navChanged', { navItem: 'library' }); // make sure the whole library is showing, not one playlist
    var input = document.getElementById('mk-global-search-input');
    if (input) input.value = query;
    var lib = document.getElementById('mk-lib-search-input');
    if (lib) lib.value = '';
    st.globalSearchQuery = query;
    st.emit('globalSearch', { query: query });
    st.closeDrawers();
  };

  MakanDrawers.prototype.bindSmartEvents = function () {
    var self = this;
    var box = this.el.querySelector('#mk-smart-section');
    if (!box || box._mkBound) return; // the box itself stays; only its content is redrawn
    box._mkBound = true;
    box.addEventListener('click', function (e) {
      var del = e.target.closest('[data-smart-del]');
      if (del) {
        e.stopPropagation();
        var id = del.getAttribute('data-smart-del');
        if (window.confirm('Delete this smart playlist?\n\n(Only the saved search is deleted. Your songs are not touched.)') && window.MakanDesktop && window.MakanDesktop.deleteSmartPlaylist) {
          window.MakanDesktop.deleteSmartPlaylist(id).then(function () { self.loadSmartPlaylists(); });
        }
        return;
      }
      if (e.target.closest('#mk-tagfix-open-btn')) { self.openTagFixer(); return; }
      if (e.target.closest('#mk-ai-open-btn')) { self.openAiPlaylist(); return; }
      if (e.target.closest('#mk-sound-btn')) { self.toggleSoundAnalysis(); return; }
      if (e.target.closest('#mk-similar-btn')) { self.showSimilar(); return; }
      if (e.target.closest('#mk-mix-btn')) { self.showMix(); return; }
      if (e.target.closest('#mk-smart-save-btn')) {
        var q = (self.state.activeSearchQuery || self.state.globalSearchQuery || '').trim();
        if (!q) { alert('Type a search in the search box first (for example: lyrics:love artist:queen), then save it here.'); return; }
        self._askName('Name for this smart playlist', q.slice(0, 40), function (name) {
          if (name && name.trim() && window.MakanDesktop && window.MakanDesktop.createSmartPlaylist) {
            window.MakanDesktop.createSmartPlaylist(name.trim(), q).then(function () { self.loadSmartPlaylists(); });
          }
        });
        return;
      }
      var card = e.target.closest('[data-smart-query]');
      if (card) self.applySmartQuery(card.getAttribute('data-smart-query'));
    });
  };

  MakanDrawers.prototype._renderPlaylistsList = function () {
    if (!this.playlists || !this.playlists.length) {
      return '<div style="padding:24px 16px;text-align:center;color:var(--mk-text-dim);font-size:12.5px;">No playlists created yet.<br>Click "+ New" above or "Save as Playlist" in the queue.</div>';
    }
    var html = '';
    for (var i = 0; i < this.playlists.length; i++) {
      var pl = this.playlists[i];
      var durStr = this.state.formatTime(pl.total_duration || 0);

      html += '' +
        '<div class="mk-playlist-card" data-pl-id="' + pl.id + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;margin-bottom:8px;cursor:pointer;">' +
        '  <div class="mk-pl-info" style="flex:1;min-width:0;margin-right:10px;">' +
        '    <div class="mk-pl-name" style="font-size:13px;font-weight:600;color:var(--mk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._escapeHtml(pl.name) + '</div>' +
        '    <div class="mk-pl-count" style="font-size:11px;color:var(--mk-text-dim);margin-top:2px;">' + (pl.track_count || 0) + ' tracks &bull; ' + durStr + '</div>' +
        '  </div>' +
        '  <div class="mk-pl-actions" style="display:flex;align-items:center;gap:4px;">' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-pl-action-play" data-pl-action="play" data-pl-id="' + pl.id + '" data-pl-name="' + this._escapeAttr(pl.name) + '" title="Play Playlist" style="padding:3px 8px;font-size:11px;">Play</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-pl-action-export" data-pl-action="export" data-pl-id="' + pl.id + '" title="Export to M3U" style="padding:3px 8px;font-size:11px;">Export</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-pl-action-dup" data-pl-action="duplicate" data-pl-id="' + pl.id + '" title="Duplicate" style="padding:3px 8px;font-size:11px;">Copy</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-pl-action-rename" data-pl-action="rename" data-pl-id="' + pl.id + '" data-pl-name="' + this._escapeAttr(pl.name) + '" title="Rename" style="padding:3px 8px;font-size:11px;">Rename</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary mk-pl-action-del" data-pl-action="delete" data-pl-id="' + pl.id + '" title="Delete Playlist" style="padding:3px 8px;font-size:11px;color:var(--mk-danger);">&times;</button>' +
        '  </div>' +
        '</div>';
    }
    return html;
  };

  MakanDrawers.prototype.bindPlaylistEvents = function () {
    var self = this;
    var cards = this.el.querySelectorAll('.mk-playlist-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function (e) {
        var actionBtn = e.target.closest('[data-pl-action]');
        var plId = this.getAttribute('data-pl-id');
        var plObj = self.playlists.find(function (p) { return p.id === plId; });
        var plName = plObj ? plObj.name : 'Playlist';

        if (actionBtn) {
          e.stopPropagation();
          var action = actionBtn.getAttribute('data-pl-action');
          if (action === 'play') {
            self.playPlaylist(plId, plName);
          } else if (action === 'export') {
            var useRel = window.confirm('Export M3U with relative file paths?\n\nClick OK for Relative paths, or Cancel for Absolute paths.');
            if (window.MakanDesktop && window.MakanDesktop.exportPlaylistM3U) {
              window.MakanDesktop.exportPlaylistM3U(plId, useRel);
            }
          } else if (action === 'duplicate') {
            if (window.MakanDesktop && window.MakanDesktop.duplicatePlaylist) {
              window.MakanDesktop.duplicatePlaylist(plId).then(function () {
                self.loadPlaylists();
              });
            }
          } else if (action === 'rename') {
            var oldName = actionBtn.getAttribute('data-pl-name') || '';
            self._askName('Rename Playlist:', oldName, function (newName) {
            if (newName && newName.trim() && window.MakanDesktop && window.MakanDesktop.renamePlaylist) {
              window.MakanDesktop.renamePlaylist(plId, newName.trim()).then(function () {
                self.loadPlaylists();
              });
            }
            });
          } else if (action === 'delete') {
            if (window.confirm('Delete playlist "' + plName + '"?\n\n(Original audio files on disk will NOT be deleted).')) {
              if (window.MakanDesktop && window.MakanDesktop.deletePlaylist) {
                window.MakanDesktop.deletePlaylist(plId).then(function () {
                  self.loadPlaylists();
                });
              }
            }
          }
        } else {
          self.viewPlaylist(plId, plName);
        }
      });
    }
  };

  MakanDrawers.prototype.viewPlaylist = function (playlistId, playlistName) {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.getTracks) {
      window.MakanDesktop.getTracks({ playlistId: playlistId }).then(function (tracks) {
        self.state.tracks = tracks || [];
        self.state.totalTracksDisplay = self.state.tracks.length;
        self.state.activeNavItem = 'playlist:' + playlistId;
        self.state.emit('libraryUpdated');
        self.state.closeDrawers();
      });
    }
  };

  MakanDrawers.prototype.playPlaylist = function (playlistId, playlistName) {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.getTracks) {
      window.MakanDesktop.getTracks({ playlistId: playlistId }).then(function (tracks) {
        if (!tracks || !tracks.length) {
          alert('This playlist has no tracks.');
          return;
        }
        self.state.tracks = tracks;
        self.state.totalTracksDisplay = tracks.length;
        self.state.emit('libraryUpdated');
        if (self.controller) {
          self.controller.setContext(tracks, 0, { type: 'playlist', name: playlistName }, true);
        }
        self.state.closeDrawers();
      });
    }
  };

  /* ---------------- Settings Drawer (7 Sections) ---------------- */

  MakanDrawers.prototype._renderSettingsPanes = function () {
    var state = this.state;
    var html = '';

    // Pane 1: Library
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-library">' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Library &amp; Folders</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-set-folder-watching"' + (state.folderWatching !== false ? ' checked' : '') + '> Automatic folder watching (Auto-detect filesystem updates)' +
      '    </label>' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-set-allow-duplicates"' + (state.allowDuplicatesInPlaylists ? ' checked' : '') + '> Allow duplicate entries in playlists' +
      '    </label>' +
      '    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-setting-rescan-btn" style="text-align:left;padding:8px 12px;justify-content:flex-start;">' +
      '        <strong>Rescan Library Folders</strong>' +
      '        <span style="font-size:11px;color:var(--mk-text-dim);display:block;">Check all watched folders for newly added or modified tracks</span>' +
      '      </button>' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-setting-missing-btn" style="text-align:left;padding:8px 12px;justify-content:flex-start;">' +
      '        <strong>Locate Missing Files</strong>' +
      '        <span style="font-size:11px;color:var(--mk-text-dim);display:block;">Mark moved or unplugged external drive tracks</span>' +
      '      </button>' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-setting-open-folders-btn" style="text-align:left;padding:8px 12px;justify-content:flex-start;">' +
      '        <strong>Manage Watched Folders</strong>' +
      '        <span style="font-size:11px;color:var(--mk-text-dim);display:block;">View, add, relink or remove folders</span>' +
      '      </button>' +
      '    </div>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <button type="button" class="mk-btn mk-btn-secondary mk-btn-reset-section" data-reset-section="library" style="font-size:11.5px;padding:4px 10px;">Restore Library Defaults</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Pane 2: Playback
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-playback" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Playback Engine</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-set-gapless"' + (state.gapless !== false ? ' checked' : '') + '> Gapless Playback (Preloaded Low-Gap Dual-Engine Transition)' +
      '    </label>' +
      '    <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '      <span>Crossfade Duration:</span>' +
      '      <select class="mk-select" id="mk-set-crossfade">' +
      '        <option value="0"' + (state.crossfade === 0 ? ' selected' : '') + '>Off (0s - Low-Gap Preloaded)</option>' +
      '        <option value="1"' + (state.crossfade === 1 ? ' selected' : '') + '>1 Second</option>' +
      '        <option value="2"' + (state.crossfade === 2 ? ' selected' : '') + '>2 Seconds</option>' +
      '        <option value="3"' + (state.crossfade === 3 ? ' selected' : '') + '>3 Seconds</option>' +
      '        <option value="5"' + (state.crossfade === 5 ? ' selected' : '') + '>5 Seconds</option>' +
      '        <option value="8"' + (state.crossfade === 8 ? ' selected' : '') + '>8 Seconds</option>' +
      '        <option value="10"' + (state.crossfade === 10 ? ' selected' : '') + '>10 Seconds</option>' +
      '      </select>' +
      '    </label>' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;" title="Needs Sound analysis (Playlists, Analyse my library). Songs that are not analysed get a normal 5 second fade. It matches tempo only, not single beats.">' +
      '      <input type="checkbox" id="mk-set-automix"' + (state.autoMix ? ' checked' : '') + '> Auto-mix: choose each fade by tempo and energy (replaces the crossfade above)' +
      '    </label>' +
      '    <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '      <span>Sleep timer (stops the music with a slow fade-out):</span>' +
      '      <select class="mk-select" id="mk-set-sleep">' +
      '        <option value="0">Off</option><option value="15">After 15 minutes</option><option value="30">After 30 minutes</option>' +
      '        <option value="45">After 45 minutes</option><option value="60">After 1 hour</option><option value="90">After 1.5 hours</option>' +
      '        <option value="120">After 2 hours</option><option value="song">At the end of this song</option>' +
      '      </select>' +
      '      <span id="mk-set-sleep-status" style="font-size:11px;color:var(--mk-text-dim);"></span>' +
      '    </label>' +
      '    <div style="margin-top:6px;padding-top:8px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '        <input type="checkbox" id="mk-set-resume-long"' + (state.resumeLongTracks !== false ? ' checked' : '') + '> Resume long tracks &amp; podcasts where you left off' +
      '      </label>' +
      '      <div style="display:flex;align-items:center;gap:12px;margin-top:6px;margin-left:24px;">' +
      '        <span style="font-size:12px;min-width:130px;">Resume Threshold:</span>' +
      '        <input type="range" class="mk-range" id="mk-set-resume-threshold" min="60" max="3600" step="60" value="' + (state.resumeThreshold || 900) + '" style="flex:1;">' +
      '        <span id="mk-set-resume-threshold-val" style="font-size:11.5px;min-width:55px;text-align:right;">' + Math.round((state.resumeThreshold || 900) / 60) + ' min</span>' +
      '      </div>' +
      '      <span style="font-size:11px;color:var(--mk-text-dim);display:block;margin-left:24px;margin-top:2px;">Ordinary songs start from the beginning unless longer than the threshold.</span>' +
      '    </div>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <button type="button" class="mk-btn mk-btn-secondary mk-btn-reset-section" data-reset-section="playback" style="font-size:11.5px;padding:4px 10px;">Restore Playback Defaults</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Pane 3: Audio
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-audio" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Audio Output &amp; Signal Processing</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <!-- v1.8.0 Audio Output & Native Pure Audio -->' +
      '    <div style="padding:10px 12px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;display:flex;flex-direction:column;gap:8px;">' +
      '      <span style="font-size:11.5px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;letter-spacing:0.5px;">Audio Output &amp; Hardware Engine</span>' +
      '      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '        <span>Audio Playback Backend:</span>' +
      '        <select class="mk-select" id="mk-set-audio-backend">' +
      '          <option value="webaudio"' + (state.audioBackend === 'webaudio' ? ' selected' : '') + '>Web Audio (Default · Built-in · Equalizer &amp; PotPlayer DSP)</option>' +
      '          <option value="native"' + (state.audioBackend === 'native' ? ' selected' : '') + '>Native Pure Audio (Beta · Out-of-process FFmpeg + miniaudio WASAPI)</option>' +
      '        </select>' +
      '      </label>' +
      '      <div id="mk-native-audio-options" style="display:flex;flex-direction:column;gap:8px;padding-top:4px;">' +
      '        <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '          <span>WASAPI Output Mode:</span>' +
      '          <select class="mk-select" id="mk-set-output-mode">' +
      '            <option value="shared"' + (state.outputMode === 'shared' ? ' selected' : '') + '>WASAPI Shared (Safe · Mixes with Windows system sounds)</option>' +
      '            <option value="exclusive"' + (state.outputMode === 'exclusive' ? ' selected' : '') + '>WASAPI Exclusive (Optional · Direct hardware stream · Bypass mixer)</option>' +
      '          </select>' +
      '        </label>' +
      '        <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '          <span>Output Device:</span>' +
      '          <select class="mk-select" id="mk-set-output-device">' +
      '            <option value="default">Default Windows Audio Endpoint</option>' +
      '          </select>' +
      '        </label>' +
      '        <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '          <span>Buffer Profile:</span>' +
      '          <select class="mk-select" id="mk-set-buffer-mode">' +
      '            <option value="default"' + (state.bufferMode === 'default' ? ' selected' : '') + '>Safe / Conservative (Default · Glitch-free)</option>' +
      '            <option value="lowLatency"' + (state.bufferMode === 'lowLatency' ? ' selected' : '') + '>Low Latency (Advanced · Minimal buffer)</option>' +
      '          </select>' +
      '        </label>' +
      '      </div>' +
      '      <div style="display:flex;gap:8px;margin-top:6px;">' +
      '        <button type="button" class="mk-btn mk-btn-primary" id="mk-btn-show-audio-path" style="padding:6px 12px;font-size:12px;">Show Audio Path</button>' +
      '        <button type="button" class="mk-btn mk-btn-secondary" id="mk-btn-test-output" style="padding:6px 12px;font-size:12px;">Test Output</button>' +
      '      </div>' +
      '    </div>' +
      '    <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;margin-top:4px;">' +
      '      <span>ReplayGain Loudness Mode:</span>' +
      '      <select class="mk-select" id="mk-set-replaygain-mode">' +
      '        <option value="track"' + (state.replayGainMode === 'track' ? ' selected' : '') + '>Track Gain (Equalize each song to 89 dB SPL)</option>' +
      '        <option value="album"' + (state.replayGainMode === 'album' ? ' selected' : '') + '>Album Gain (Preserve album mastering dynamics)</option>' +
      '        <option value="prevent_clipping"' + (state.replayGainMode === 'prevent_clipping' ? ' selected' : '') + '>Prevent Clipping (Smart limiter / ceiling)</option>' +
      '        <option value="off"' + (state.replayGainMode === 'off' ? ' selected' : '') + '>Off (Disable gain adjustments)</option>' +
      '      </select>' +
      '    </label>' +
      '    <div style="display:flex;align-items:center;gap:12px;margin-top:4px;">' +
      '      <span style="font-size:12px;min-width:130px;">ReplayGain Preamp:</span>' +
      '      <input type="range" class="mk-range" id="mk-set-rg-preamp" min="-6" max="6" step="0.5" value="' + (state.replayGainPreamp || 0) + '" style="flex:1;">' +
      '      <span id="mk-set-rg-preamp-val" style="font-size:11.5px;min-width:40px;text-align:right;">' + ((state.replayGainPreamp || 0) >= 0 ? '+' : '') + (state.replayGainPreamp || 0).toFixed(1) + ' dB</span>' +
      '    </div>' +
      '    <div style="display:flex;align-items:center;gap:12px;">' +
      '      <span style="font-size:12px;min-width:130px;">Fallback (Untagged):</span>' +
      '      <input type="range" class="mk-range" id="mk-set-rg-fallback" min="-6" max="6" step="0.5" value="' + (state.replayGainPreampFallback || 0) + '" style="flex:1;">' +
      '      <span id="mk-set-rg-fallback-val" style="font-size:11.5px;min-width:40px;text-align:right;">' + ((state.replayGainPreampFallback || 0) >= 0 ? '+' : '') + (state.replayGainPreampFallback || 0).toFixed(1) + ' dB</span>' +
      '    </div>' +
      '    <div style="margin-top:8px;padding:10px 12px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;display:flex;flex-direction:column;gap:8px;">' +
      '      <span style="font-size:11.5px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;letter-spacing:0.5px;">MAKAN Sound Engine</span>' +
      '      <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '        <input type="checkbox" id="mk-set-loudness-normalizer"' + (state.loudnessNormalizer ? ' checked' : '') + '> Loudness Normalizer (even volume + peak protection)' +
      '      </label>' +
      '      <div style="display:flex;align-items:center;gap:12px;">' +
      '        <span style="font-size:12px;min-width:130px;">Stereo Width (3D):</span>' +
      '        <input type="range" class="mk-range" id="mk-set-stereo-width" min="0.5" max="2.0" step="0.05" value="' + (state.stereoWidth !== undefined ? state.stereoWidth : 1.0) + '" style="flex:1;">' +
      '        <span id="mk-set-stereo-width-val" style="font-size:11.5px;min-width:40px;text-align:right;">' + (state.stereoWidth !== undefined ? Number(state.stereoWidth).toFixed(2) : '1.00') + 'x</span>' +
      '      </div>' +
      '    </div>' +
      '    <div style="margin-top:10px;">' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-audio-open-eq-btn" style="padding:7px 12px;font-size:12px;">Open 10-Band Equalizer</button>' +
      '    </div>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <button type="button" class="mk-btn mk-btn-secondary mk-btn-reset-section" data-reset-section="audio" style="font-size:11.5px;padding:4px 10px;">Restore Audio Defaults</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Pane 4: Lyrics
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-lyrics" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Lyrics &amp; Subtitles</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-set-sound-reactive-lyrics"' + (state.soundReactiveLyrics ? ' checked' : '') + '> Sound-reactive energy glow on active lyric line' +
      '    </label>' +
      '    <span style="font-size:11px;color:var(--mk-text-dim);">MAKAN automatically discovers local sidecar lyrics (.lrc, .srt, .vtt, .ass, .txt) safely matched by file name without modifying original files.</span>' +
      '    <div style="margin-top:8px;">' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-set-open-lyrics-style-btn" style="padding:7px 12px;font-size:12px;">Open Lyrics Style Customizer</button>' +
      '    </div>' +
      '    <div class="mk-lm mk-tr-card">' +
      '      <div class="mk-lm-title">Lyrics translation</div>' +
      '      <div class="mk-lm-note">Online uses free web translators (no key; they may be limited or stop one day). Ollama runs on this PC, offline: install it from ollama.com, then open a terminal and run: ollama pull translategemma:4b</div>' +
      '      <label class="mk-style-field"><span>Translator:</span><select class="mk-select" id="mk-set-tr-mode">' + this._trModeOptions() + '</select></label>' +
      '      <label class="mk-style-field"><span>Ollama model:</span><select class="mk-select" id="mk-set-tr-model">' + this._trModelOptions([], '') + '</select></label>' +
      '      <div class="mk-lm-btns"><button type="button" class="mk-btn mk-btn-secondary" id="mk-set-tr-check">Check Ollama</button></div>' +
      '      <div class="mk-lm-msg" id="mk-set-tr-msg"></div>' +
      '      <div class="mk-lm-note">Your own API keys stay in memory and are gone when you close the app, unless you tick the box below. Your lyrics text is sent to the service you choose.</div>' +
      '      <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin:4px 0;"><input type="checkbox" id="mk-set-tr-remember"> Remember my keys on this PC (encrypted by Windows; only this Windows account can read them)</label>' +
      this._trKeyRow('gemini', 'Gemini API key') +
      this._trKeyRow('cloud', 'Google Cloud Translation API key') +
      '    </div>' +
      '    <div class="mk-lm" id="mk-set-lyrics-models"></div>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <button type="button" class="mk-btn mk-btn-secondary mk-btn-reset-section" data-reset-section="lyrics" style="font-size:11.5px;padding:4px 10px;">Restore Lyrics Defaults</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Pane 5: Appearance
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-appearance" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Visual Theme &amp; Motion</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '      <span>Color Theme:</span>' +
      '      <select class="mk-select" id="mk-set-app-theme">' +
      '        <option value="dark"' + (state.appTheme === 'dark' ? ' selected' : '') + '>Dark</option>' +
      '        <option value="light"' + (state.appTheme === 'light' ? ' selected' : '') + '>Light (Platinum Blue)</option>' +
      '        <option value="auto"' + (state.appTheme === 'auto' ? ' selected' : '') + '>Automatic (follow Windows)</option>' +
      '      </select>' +
      '    </label>' +
      '    <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">' +
      '      <span>Visualizer Theme:</span>' +
      '      <select class="mk-select" id="mk-set-vis-theme">' +
      '        <option value="cyan"' + (state.visualizerTheme === 'cyan' ? ' selected' : '') + '>Cyan &amp; Magenta Glow</option>' +
      '        <option value="aurora"' + (state.visualizerTheme === 'aurora' ? ' selected' : '') + '>Aurora Borealis (Emerald / Lime)</option>' +
      '        <option value="rainbow"' + (state.visualizerTheme === 'rainbow' ? ' selected' : '') + '>Rainbow Chromatic</option>' +
      '        <option value="custom"' + (state.visualizerTheme === 'custom' ? ' selected' : '') + '>Custom Violet Glow</option>' +
      '        <option value="sunset"' + (state.visualizerTheme === 'sunset' ? ' selected' : '') + '>Sunset (Orange &amp; Pink)</option>' +
      '        <option value="ocean"' + (state.visualizerTheme === 'ocean' ? ' selected' : '') + '>Ocean (Blue &amp; Teal)</option>' +
      '        <option value="gold"' + (state.visualizerTheme === 'gold' ? ' selected' : '') + '>Gold (Champagne)</option>' +
      '        <option value="violet"' + (state.visualizerTheme === 'violet' ? ' selected' : '') + '>Violet Night</option>' +
      '        <option value="candy"' + (state.visualizerTheme === 'candy' ? ' selected' : '') + '>Candy (Pastel)</option>' +
      '      </select>' +
      '    </label>' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-top:6px;">' +
      '      <input type="checkbox" id="mk-set-reduced-motion"' + (state.reducedMotion ? ' checked' : '') + '> Reduced Motion (Disable fluid canvas animations for accessibility)' +
      '    </label>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <button type="button" class="mk-btn mk-btn-secondary mk-btn-reset-section" data-reset-section="appearance" style="font-size:11.5px;padding:4px 10px;">Restore Appearance Defaults</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Pane 6: Windows Integration
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-windows" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Windows Integration</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-setting-always-on-top"' + (state.alwaysOnTop ? ' checked' : '') + '> Always on Top' +
      '    </label>' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-set-minimize-tray"' + (state.minimizeToTray ? ' checked' : '') + '> Minimize to Windows system tray' +
      '    </label>' +
      '    <label class="mk-checkbox-label" style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">' +
      '      <input type="checkbox" id="mk-set-close-tray"' + (state.closeToTray ? ' checked' : '') + '> Close to Windows system tray (Keeps playing in background)' +
      '    </label>' +
      '    <span style="font-size:11px;color:var(--mk-text-dim);">Close to tray is disabled by default so the application closes cleanly when clicking the X button.</span>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);">' +
      '      <button type="button" class="mk-btn mk-btn-secondary mk-btn-reset-section" data-reset-section="windows" style="font-size:11.5px;padding:4px 10px;">Restore Windows Defaults</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Pane 7: Shortcuts Reference
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-shortcuts" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Keyboard Shortcuts Reference</h4>' +
      '  <table class="mk-shortcuts-table" style="width:100%;font-size:11.5px;border-collapse:collapse;">' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Space</kbd></td><td style="color:var(--mk-text-dim);">Play / Pause</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + O</kbd></td><td style="color:var(--mk-text-dim);">Add Audio Files</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + Shift + O</kbd></td><td style="color:var(--mk-text-dim);">Add Music Folder</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + K</kbd></td><td style="color:var(--mk-text-dim);">Focus Search Filter</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + A</kbd></td><td style="color:var(--mk-text-dim);">Select All Visible Tracks</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Escape</kbd></td><td style="color:var(--mk-text-dim);">Clear Search Filter / Track Selection</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Enter</kbd></td><td style="color:var(--mk-text-dim);">Play Selected Track</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Delete</kbd></td><td style="color:var(--mk-text-dim);">Remove Selected Track (With Confirmation)</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">[</kbd> / <kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">]</kbd></td><td style="color:var(--mk-text-dim);">Lyrics Sync Offset &plusmn;0.1s</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + &rarr;</kbd> / <kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">&larr;</kbd></td><td style="color:var(--mk-text-dim);">Next / Previous Track</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">&rarr;</kbd> / <kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">&larr;</kbd></td><td style="color:var(--mk-text-dim);">Seek &plusmn;5 Seconds</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + &uarr;</kbd> / <kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">&darr;</kbd></td><td style="color:var(--mk-text-dim);">Volume Up / Down &plusmn;5%</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + M</kbd></td><td style="color:var(--mk-text-dim);">Mute / Unmute</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + L</kbd></td><td style="color:var(--mk-text-dim);">Focus Music Library</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + J</kbd></td><td style="color:var(--mk-text-dim);">Open Playback Queue</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">Ctrl + P</kbd></td><td style="color:var(--mk-text-dim);">Open Playlists Drawer</td></tr>' +
      '    <tr style="border-bottom:1px solid rgba(var(--mk-fg-rgb),0.06);"><td style="padding:4px 0;font-weight:600;color:var(--mk-text);"><kbd style="background:rgba(var(--mk-fg-rgb),0.08);padding:2px 6px;border-radius:3px;">F11</kbd></td><td style="color:var(--mk-text-dim);">Toggle Full Screen</td></tr>' +
      '  </table>' +
      '</div>';

    // Pane 8: Advanced
    html += '' +
      '<div class="mk-settings-pane" id="mk-set-pane-advanced" hidden>' +
      '  <h4 style="font-size:12px;font-weight:700;color:var(--mk-accent-cyan);text-transform:uppercase;margin-bottom:12px;">Advanced &amp; Maintenance</h4>' +
      '  <div style="display:flex;flex-direction:column;gap:12px;">' +
      '    <div style="padding:10px 12px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;font-size:11.5px;line-height:1.5;">' +
      '      <strong style="color:var(--mk-text);display:block;margin-bottom:4px;">Safety Guarantee: Destructive vs Non-Destructive Actions</strong>' +
      '      <span style="color:var(--mk-text-dim);display:block;margin-bottom:4px;">&bull; <strong style="color:#10b981;">Non-destructive:</strong> Restoring defaults and clearing playback history reset local preferences without touching your files, playlists, or database index.</span>' +
      '      <span style="color:var(--mk-text-dim);display:block;">&bull; <strong style="color:#f59e0b;">Index reset:</strong> Clearing the library resets the SQLite catalog, playlists, and folder cache within MAKAN. It <strong style="color:var(--mk-text);">NEVER deletes, renames, alters, or moves</strong> any music files on your storage drives.</span>' +
      '    </div>' +
      '    <div style="display:flex;flex-direction:column;gap:8px;">' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-adv-clear-history-btn" style="text-align:left;padding:8px 12px;justify-content:flex-start;">' +
      '        <strong>Clear Playback History</strong>' +
      '        <span style="font-size:11px;color:var(--mk-text-dim);display:block;">Wipe recently played tracks and forward queue history</span>' +
      '      </button>' +
      '      <button type="button" class="mk-btn mk-btn-secondary" id="mk-adv-clear-library-btn" style="text-align:left;padding:8px 12px;justify-content:flex-start;border-color:rgba(239,68,68,0.3);">' +
      '        <strong style="color:#ef4444;">Clear Library Index</strong>' +
      '        <span style="font-size:11px;color:var(--mk-text-dim);display:block;">Clear database catalog and playlists (does NOT delete any music files on disk)</span>' +
      '      </button>' +
      '      <button type="button" class="mk-btn mk-btn-danger" id="mk-setting-reset-defaults-btn" style="text-align:left;padding:8px 12px;justify-content:flex-start;">' +
      '        <strong>Restore All Settings to Defaults</strong>' +
      '        <span style="font-size:11px;opacity:0.85;display:block;">Reset all preferences across all sections to factory configuration</span>' +
      '      </button>' +
      '    </div>' +
      '    <div style="padding:12px;background:rgba(var(--mk-fg-rgb),0.02);border:1px solid rgba(var(--mk-fg-rgb),0.06);border-radius:6px;font-size:12px;color:var(--mk-text-dim);line-height:1.6;margin-top:4px;">' +
      '      <strong style="color:var(--mk-text);font-size:13px;display:block;margin-bottom:4px;">MAKAN AI Music Player v1 — Daily Player</strong>' +
      '      <span>Engineered for everyday dependable listening with 3,000–10,000 track libraries.</span>' +
      '      <div style="margin-top:8px;font-size:11px;">' +
      '        <strong>Verified Formats:</strong> MP3, FLAC, WAV, AAC, M4A, OGG Vorbis, Opus.<br>' +
      '        <strong>Database:</strong> SQLite with indexed metadata, folder watching, and atomic transactions.<br>' +
      '        <strong>Audio:</strong> Web Audio pipeline with 10-band EQ, honest ReplayGain, and gapless transitions.' +
      '      </div>' +
      '      <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(var(--mk-fg-rgb),0.08);font-size:11px;">' +
      '        <strong>Made by Makan</strong><br>' +
      '        <strong>Website:</strong> <a href="https://makanlab.tech/" target="_blank" rel="noopener" style="color:inherit;">https://makanlab.tech/</a><br>' +
      '        <strong>Contact:</strong> <a href="mailto:makan20042002@gmail.com" target="_blank" rel="noopener" style="color:inherit;">makan20042002@gmail.com</a>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    return html;
  };

  MakanDrawers.prototype.updateSettingsUi = function (explicitSettings) {
    var self = this;
    function applyToInputs(s) {
      if (!s) return;
      var gaplessChk = self.el.querySelector('#mk-set-gapless');
      if (gaplessChk) gaplessChk.checked = s.gapless !== false;

      var crossfadeSel = self.el.querySelector('#mk-set-crossfade');
      if (crossfadeSel) crossfadeSel.value = s.crossfade !== undefined ? s.crossfade : 0;

      var rgModeSel = self.el.querySelector('#mk-set-replaygain-mode');
      if (rgModeSel) rgModeSel.value = s.replayGainMode || 'track';

      var rgPreamp = self.el.querySelector('#mk-set-rg-preamp');
      if (rgPreamp) rgPreamp.value = s.replayGainPreamp !== undefined ? s.replayGainPreamp : 0;
      var rgPreampVal = self.el.querySelector('#mk-set-rg-preamp-val');
      if (rgPreampVal) rgPreampVal.textContent = ((s.replayGainPreamp || 0) >= 0 ? '+' : '') + (s.replayGainPreamp || 0).toFixed(1) + ' dB';

      var rgFallback = self.el.querySelector('#mk-set-rg-fallback');
      if (rgFallback) rgFallback.value = s.replayGainPreampFallback !== undefined ? s.replayGainPreampFallback : 0;
      var rgFallbackVal = self.el.querySelector('#mk-set-rg-fallback-val');
      if (rgFallbackVal) rgFallbackVal.textContent = ((s.replayGainPreampFallback || 0) >= 0 ? '+' : '') + (s.replayGainPreampFallback || 0).toFixed(1) + ' dB';

      var resumeLongChk = self.el.querySelector('#mk-set-resume-long');
      if (resumeLongChk) resumeLongChk.checked = s.resumeLongTracks !== false;

      var resumeThresh = self.el.querySelector('#mk-set-resume-threshold');
      if (resumeThresh) resumeThresh.value = s.resumeThreshold || 900;
      var resumeThreshVal = self.el.querySelector('#mk-set-resume-threshold-val');
      if (resumeThreshVal) resumeThreshVal.textContent = Math.round((s.resumeThreshold || 900) / 60) + ' min';

      var fwChk = self.el.querySelector('#mk-set-folder-watching');
      if (fwChk) fwChk.checked = s.folderWatching !== false;
      var fwHeaderChk = self.el.querySelector('#mk-setting-folder-watch-chk');
      if (fwHeaderChk) fwHeaderChk.checked = s.folderWatching !== false;

      var dupChk = self.el.querySelector('#mk-set-allow-duplicates');
      if (dupChk) dupChk.checked = !!s.allowDuplicatesInPlaylists;

      var aotChk = self.el.querySelector('#mk-setting-always-on-top');
      if (aotChk) aotChk.checked = !!s.alwaysOnTop;

      var miniAotChk = self.el.querySelector('#mk-set-mini-always-on-top');
      if (miniAotChk) miniAotChk.checked = !!s.miniPlayerAlwaysOnTop;

      var minTrayChk = self.el.querySelector('#mk-set-minimize-tray');
      if (minTrayChk) minTrayChk.checked = !!s.minimizeToTray;

      var closeTrayChk = self.el.querySelector('#mk-set-close-tray');
      if (closeTrayChk) closeTrayChk.checked = !!s.closeToTray;

      var visTheme1 = self.el.querySelector('#mk-set-vis-theme');
      var appThemeSel = self.el.querySelector('#mk-set-app-theme');
      if (appThemeSel) appThemeSel.value = s.appTheme || 'dark';
      if (visTheme1) visTheme1.value = s.visualizerTheme || 'cyan';
      var visTheme2 = self.el.querySelector('#mk-vis-theme-sel');
      if (visTheme2) visTheme2.value = s.visualizerTheme || 'cyan';

      var reducedMotionChk = self.el.querySelector('#mk-set-reduced-motion');
      if (reducedMotionChk) reducedMotionChk.checked = !!s.reducedMotion;

      var soundReact1 = self.el.querySelector('#mk-set-sound-reactive-lyrics');
      if (soundReact1) soundReact1.checked = s.soundReactiveLyrics !== false;
      var soundReact2 = self.el.querySelector('#mk-reactive-lyrics-chk');
      if (soundReact2) soundReact2.checked = s.soundReactiveLyrics !== false;

      var reactInt = self.el.querySelector('#mk-reactive-intensity');
      if (reactInt) reactInt.value = s.reactiveIntensity !== undefined ? s.reactiveIntensity : 1.0;
      var reactIntVal = self.el.querySelector('#mk-reactive-intensity-val');
      if (reactIntVal) reactIntVal.textContent = (s.reactiveIntensity !== undefined ? s.reactiveIntensity.toFixed(1) : '1.0') + 'x';

      var fontSel = self.el.querySelector('#mk-font-sel');
      if (fontSel && s.lyricsFontFamily) fontSel.value = s.lyricsFontFamily;

      var origSize = self.el.querySelector('#mk-lyrics-orig-size');
      if (origSize) origSize.value = s.lyricsOriginalSize || 20;
      var origSizeVal = self.el.querySelector('#mk-lyrics-orig-size-val');
      if (origSizeVal) origSizeVal.textContent = (s.lyricsOriginalSize || 20) + 'px';

      var transSize = self.el.querySelector('#mk-lyrics-trans-size');
      if (transSize) transSize.value = s.lyricsTranslationSize || 16;
      var transSizeVal = self.el.querySelector('#mk-lyrics-trans-size-val');
      if (transSizeVal) transSizeVal.textContent = (s.lyricsTranslationSize || 16) + 'px';

      var actCol = self.el.querySelector('#mk-lyrics-active-color');
      if (actCol && s.lyricsActiveColor && s.lyricsActiveColor.startsWith('#')) actCol.value = s.lyricsActiveColor;

      var inactCol = self.el.querySelector('#mk-lyrics-inactive-color');
      if (inactCol && s.lyricsInactiveColor && s.lyricsInactiveColor.startsWith('#')) inactCol.value = s.lyricsInactiveColor;

      var transCol = self.el.querySelector('#mk-lyrics-trans-color');
      if (transCol && s.lyricsTranslationColor && s.lyricsTranslationColor.startsWith('#')) transCol.value = s.lyricsTranslationColor;

      var bgSel = self.el.querySelector('#mk-lyrics-bg-sel');
      if (bgSel && s.lyricsBackground) bgSel.value = s.lyricsBackground;
      var fxSel = self.el.querySelector('#mk-lyrics-effect-sel');
      if (fxSel) fxSel.value = s.lyricsEffect || 'none';

      var csSel = self.el.querySelector('#mk-lyrics-colorstyle-sel');
      if (csSel) csSel.value = s.lyricsColorStyle || 'solid';
      var csp = self.el.querySelector('#mk-lyrics-colorspeed');
      if (csp) csp.value = s.lyricsColorSpeed || 8;
      var cspVal = self.el.querySelector('#mk-lyrics-colorspeed-val');
      if (cspVal) cspVal.textContent = (s.lyricsColorSpeed || 8) + 's';
      var tfSel = self.el.querySelector('#mk-trans-font-sel');
      if (tfSel && s.lyricsTranslationFont) tfSel.value = s.lyricsTranslationFont;
      self._syncColorStyleRows();

      var glowInp = self.el.querySelector('#mk-lyrics-glow-intensity');
      if (glowInp) glowInp.value = s.lyricsGlowIntensity !== undefined ? s.lyricsGlowIntensity : 1.0;
      var glowVal = self.el.querySelector('#mk-lyrics-glow-val');
      if (glowVal) glowVal.textContent = (s.lyricsGlowIntensity !== undefined ? s.lyricsGlowIntensity.toFixed(1) : '1.0') + 'x';

      // Equalizer controls
      var eqPresetSel = self.el.querySelector('#mk-eq-preset-sel');
      if (eqPresetSel) eqPresetSel.value = s.eqPreset || 'flat';

      var eqPreampInp = self.el.querySelector('#mk-eq-preamp');
      if (eqPreampInp) eqPreampInp.value = s.eqPreamp !== undefined ? s.eqPreamp : 0;
      var eqPreampVal = self.el.querySelector('#mk-eq-preamp-val');
      if (eqPreampVal) eqPreampVal.textContent = ((s.eqPreamp || 0) >= 0 ? '+' : '') + (s.eqPreamp || 0).toFixed(1) + ' dB';

      var eqBypassChk = self.el.querySelector('#mk-eq-bypass-chk');
      if (eqBypassChk) eqBypassChk.checked = !s.eqEnabled;

      if (Array.isArray(s.eqGains)) {
        for (var b = 0; b < s.eqGains.length; b++) {
          var valEl = self.el.querySelector('#mk-eq-val-' + b);
          if (valEl) valEl.textContent = (s.eqGains[b] >= 0 ? '+' : '') + s.eqGains[b].toFixed(1);
          var rangeInput = self.el.querySelector('.mk-eq-range[data-band="' + b + '"]');
          if (rangeInput) rangeInput.value = s.eqGains[b];
        }
      }

      var norm1 = self.el.querySelector('#mk-set-loudness-normalizer');
      if (norm1) norm1.checked = !!s.loudnessNormalizer;
      var norm2 = self.el.querySelector('#mk-eq-normalizer-chk');
      if (norm2) norm2.checked = !!s.loudnessNormalizer;

      var sw1 = self.el.querySelector('#mk-set-stereo-width');
      if (sw1) sw1.value = s.stereoWidth !== undefined ? s.stereoWidth : 1.0;
      var swVal1 = self.el.querySelector('#mk-set-stereo-width-val');
      if (swVal1) swVal1.textContent = (s.stereoWidth !== undefined ? Number(s.stereoWidth).toFixed(2) : '1.00') + 'x';

      var sw2 = self.el.querySelector('#mk-eq-stereo-width');
      if (sw2) sw2.value = s.stereoWidth !== undefined ? s.stereoWidth : 1.0;
      var swVal2 = self.el.querySelector('#mk-eq-stereo-width-val');
      if (swVal2) swVal2.textContent = (s.stereoWidth !== undefined ? Number(s.stereoWidth).toFixed(2) : '1.00') + 'x';

      // v1.8.0 Audio Output & Hardware Engine
      var backendSel = self.el.querySelector('#mk-set-audio-backend');
      if (backendSel) backendSel.value = s.audioBackend || 'webaudio';

      var outModeSel = self.el.querySelector('#mk-set-output-mode');
      if (outModeSel) outModeSel.value = s.outputMode || 'shared';

      var devSel = self.el.querySelector('#mk-set-output-device');
      if (devSel && s.outputDevice) devSel.value = s.outputDevice;

      var bufSel = self.el.querySelector('#mk-set-buffer-mode');
      if (bufSel) bufSel.value = s.bufferMode || 'default';

      var nativeOptionsDiv = self.el.querySelector('#mk-native-audio-options');
      if (nativeOptionsDiv) {
        nativeOptionsDiv.style.display = (s.audioBackend === 'native') ? 'flex' : 'none';
      }

      self.loadAudioDevices();
    }

    if (explicitSettings) {
      applyToInputs(explicitSettings);
    } else if (window.MakanDesktop && window.MakanDesktop.getSettings) {
      window.MakanDesktop.getSettings().then(applyToInputs);
    }
  };

  MakanDrawers.prototype.applySettingsToStateAndUi = function (settings) {
    if (!settings) return;
    var s = settings;

    // 1. Update State
    this.state.gapless = s.gapless !== false;
    this.state.crossfade = s.crossfade || 0;
    this.state.replayGainMode = s.replayGainMode || 'track';
    this.state.replayGainPreamp = s.replayGainPreamp !== undefined ? s.replayGainPreamp : 0;
    this.state.replayGainPreampFallback = s.replayGainPreampFallback !== undefined ? s.replayGainPreampFallback : 0;
    this.state.resumeLongTracks = s.resumeLongTracks !== false;
    this.state.resumeThreshold = s.resumeThreshold || 900;
    this.state.folderWatching = s.folderWatching !== false;
    this.state.allowDuplicatesInPlaylists = !!s.allowDuplicatesInPlaylists;
    this.state.alwaysOnTop = !!s.alwaysOnTop;
    this.state.miniPlayerAlwaysOnTop = !!s.miniPlayerAlwaysOnTop;
    this.state.minimizeToTray = !!s.minimizeToTray;
    this.state.closeToTray = !!s.closeToTray;
    this.state.appTheme = s.appTheme || 'dark';
    if (window.MakanTheme) window.MakanTheme.apply(this.state.appTheme);
    this.state.visualizerTheme = s.visualizerTheme || 'cyan';
    this.state.visualizerStyle = s.visualizerStyle || 'bars';
    this.state.reducedMotion = !!s.reducedMotion;

    if (s.audioBackend) this.state.audioBackend = s.audioBackend;
    if (s.outputMode) this.state.outputMode = s.outputMode;
    if (s.outputDevice) this.state.outputDevice = s.outputDevice;
    if (s.bufferMode) this.state.bufferMode = s.bufferMode;

    if (s.eqGains) this.state.eqGains = s.eqGains.slice();
    if (s.eqPreamp !== undefined) this.state.eqPreamp = s.eqPreamp;
    if (s.eqEnabled !== undefined) this.state.eqBypass = !s.eqEnabled;
    if (s.eqPreset) this.state.eqPreset = s.eqPreset;
    if (s.loudnessNormalizer !== undefined) this.state.loudnessNormalizer = !!s.loudnessNormalizer;
    if (s.stereoWidth !== undefined) this.state.stereoWidth = s.stereoWidth;

    if (s.lyricMode) this.state.lyricMode = s.lyricMode;
    if (s.soundReactiveLyrics !== undefined) this.state.soundReactiveLyrics = !!s.soundReactiveLyrics;
    if (s.reactiveIntensity !== undefined) this.state.reactiveIntensity = s.reactiveIntensity;
    if (s.lyricsFontFamily) this.state.lyricsFontFamily = s.lyricsFontFamily;
    if (s.lyricsOriginalSize !== undefined) this.state.lyricsOriginalSize = s.lyricsOriginalSize;
    if (s.lyricsTranslationSize !== undefined) this.state.lyricsTranslationSize = s.lyricsTranslationSize;
    if (s.lyricsInactiveColor) this.state.lyricsInactiveColor = s.lyricsInactiveColor;
    if (s.lyricsActiveColor) this.state.lyricsActiveColor = s.lyricsActiveColor;
    if (s.lyricsTranslationColor) this.state.lyricsTranslationColor = s.lyricsTranslationColor;
    if (s.lyricsBackground) this.state.lyricsBackground = s.lyricsBackground;
    if (s.lyricsEffect) this.state.lyricsEffect = s.lyricsEffect;
    if (s.lyricsGlowIntensity !== undefined) this.state.lyricsGlowIntensity = s.lyricsGlowIntensity;
    if (s.lyricsColorStyle) this.state.lyricsColorStyle = s.lyricsColorStyle;
    if (s.lyricsColorSpeed !== undefined) this.state.lyricsColorSpeed = s.lyricsColorSpeed;
    if (s.lyricsTranslationFont) this.state.lyricsTranslationFont = s.lyricsTranslationFont;

    // 2. Reconfigure Audio Engine Immediately
    if (this.engine) {
      if (s.audioBackend && typeof this.engine.setBackend === 'function') {
        this.engine.setBackend(s.audioBackend);
      }
      if (s.outputMode && typeof this.engine.setOutputMode === 'function') {
        this.engine.setOutputMode(s.outputMode);
      }
      if (s.outputDevice && typeof this.engine.selectDevice === 'function') {
        this.engine.selectDevice(s.outputDevice);
      }
      if (s.eqGains) this.engine.eqGains = s.eqGains.slice();
      if (s.eqPreamp !== undefined) this.engine.eqPreamp = s.eqPreamp;
      if (s.eqEnabled !== undefined) this.engine.eqBypass = !s.eqEnabled;
      if (s.eqPreset) this.engine.eqPreset = s.eqPreset;
      if (s.loudnessNormalizer !== undefined && typeof this.engine.setLoudnessNormalizer === 'function') {
        this.engine.setLoudnessNormalizer(!!s.loudnessNormalizer);
      }
      if (s.stereoWidth !== undefined && typeof this.engine.setStereoWidth === 'function') {
        this.engine.setStereoWidth(s.stereoWidth);
      }
      this.engine.applyEq();
      this.engine.applyReplayGain(this.state.currentTrack);
    }

    // 3. Update UI Controls Immediately
    this.updateSettingsUi(settings);

    // 4. Notify Listeners
    this.state.emit('settingsLoaded', settings);
    this.state.emit('lyricModeChanged', { lyricMode: this.state.lyricMode });
    this.state.emit('visualizerThemeChanged', { theme: this.state.visualizerTheme });
    this.state.emit('lyricStyleChanged', settings);
  };

  MakanDrawers.prototype._trModeOptions = function () {
    var H = window.MakanLyricsTranslateHelpers;
    var T = window.MakanLyricsTranslate;
    if (!H || !T) return '';
    var cur = T.getShared().getPrefs().mode;
    return H.MODES.map(function (m) { return '<option value="' + m.key + '"' + (m.key === cur ? ' selected' : '') + '>' + m.label + '</option>'; }).join('');
  };

  MakanDrawers.prototype._trKeyRow = function (id, label) {
    return '<div class="mk-tr-keyrow" data-key-id="' + id + '">' +
      '<span class="mk-tr-keylabel">' + label + '</span>' +
      '<input type="password" class="mk-select mk-tr-keyinput" autocomplete="off" spellcheck="false" placeholder="Paste key">' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-key-act="use">Use key</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" data-key-act="forget">Forget</button>' +
      '<span class="mk-lm-msg mk-tr-keystate">No key</span></div>';
  };

  MakanDrawers.prototype._trModelOptions = function (list, current) {
    var out = '<option value="">' + (list.length ? 'Automatic (translator model first)' : 'Automatic (press Check Ollama to list models)') + '</option>';
    var seen = false;
    list.forEach(function (m) {
      if (m.name === current) seen = true;
      out += '<option value="' + String(m.name).replace(/"/g, '&quot;') + '"' + (m.name === current ? ' selected' : '') + '>' + String(m.name).replace(/[<>&]/g, '') + '</option>';
    });
    if (current && !seen) out += '<option value="' + String(current).replace(/"/g, '&quot;') + '" selected>' + String(current).replace(/[<>&]/g, '') + ' (not checked)</option>';
    return out;
  };

  MakanDrawers.prototype._bindTranslateCard = function () {
    var self = this;
    var T = window.MakanLyricsTranslate;
    if (!T || !this.el) return;
    var tr = T.getShared();
    var modeSel = this.el.querySelector('#mk-set-tr-mode');
    var modelSel = this.el.querySelector('#mk-set-tr-model');
    var chk = this.el.querySelector('#mk-set-tr-check');
    var msg = this.el.querySelector('#mk-set-tr-msg');
    if (!modeSel || !modelSel || !chk) return;
    modelSel.innerHTML = this._trModelOptions([], tr.getPrefs().ollamaModel);
    modeSel.addEventListener('change', function () { tr.setPrefs({ mode: modeSel.value }); });
    modelSel.addEventListener('change', function () { tr.setPrefs({ ollamaModel: modelSel.value }); });
    var rows = this.el.querySelectorAll('.mk-tr-keyrow');
    Array.prototype.forEach.call(rows, function (row) {
      var id = row.getAttribute('data-key-id');
      var input = row.querySelector('.mk-tr-keyinput');
      var state = row.querySelector('.mk-tr-keystate');
      var api = window.MakanDesktop;
      var remember = self.el.querySelector('#mk-set-tr-remember');
      tr._saved = tr._saved || {};
      function show() { state.textContent = !tr.hasKey(id) ? 'No key' : (tr._saved[id] ? 'Key is saved on this PC' : 'Key is in memory'); if (remember) remember.checked = Object.keys(tr._saved).some(function (k) { return tr._saved[k]; }) || remember.checked; }
      row.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-key-act]');
        if (!b) return;
        if (b.getAttribute('data-key-act') === 'use') {
          var typed = input.value;
          var ok = tr.setKey(id, typed); input.value = '';
          if (ok && remember && remember.checked && api && api.saveKey) {
            api.saveKey(id, typed).then(function (r) { tr._saved[id] = !!(r && r.ok); if (!(r && r.ok)) state.textContent = (r && r.error) || 'Could not save the key'; else show(); });
          }
        } else {
          tr.forgetKey(id); input.value = ''; delete tr._saved[id];
          if (api && api.forgetSavedKey) api.forgetSavedKey(id);
        }
        show();
      });
      show();
    });
    var rem = this.el.querySelector('#mk-set-tr-remember');
    if (rem) {
      rem.checked = Object.keys(tr._saved || {}).length > 0;
      rem.addEventListener('change', function () {
        var api = window.MakanDesktop;
        if (!rem.checked && api && api.forgetSavedKey) {
          Object.keys(tr._saved || {}).forEach(function (id) { api.forgetSavedKey(id); });
          tr._saved = {};
          Array.prototype.forEach.call(self.el.querySelectorAll('.mk-tr-keyrow'), function (row) { var st = row.querySelector('.mk-tr-keystate'); if (st && tr.hasKey(row.getAttribute('data-key-id'))) st.textContent = 'Key is in memory'; });
        } else if (rem.checked && api && api.saveKey) {
          ['gemini', 'cloud'].forEach(function (id) {
            if (tr.hasKey(id)) api.saveKey(id, tr._keys[id]).then(function (r) { if (r && r.ok) { tr._saved[id] = true; var row = self.el.querySelector('.mk-tr-keyrow[data-key-id="' + id + '"] .mk-tr-keystate'); if (row) row.textContent = 'Key is saved on this PC'; } });
          });
        }
      });
    }
    chk.addEventListener('click', function () {
      chk.disabled = true;
      msg.className = 'mk-lm-msg';
      msg.textContent = 'Looking for Ollama…';
      tr.listOllamaModels().then(function (list) {
        var cur = tr.getPrefs().ollamaModel;
        modelSel.innerHTML = self._trModelOptions(list, cur);
        msg.textContent = list.length ? 'Ollama is running. ' + list.length + ' model(s) found.' : 'Ollama is running but has no models. Run: ollama pull translategemma:4b';
      }).catch(function (e) {
        msg.className = 'mk-lm-msg mk-lm-bad';
        msg.textContent = (e && e.message) || 'Ollama did not answer.';
      }).then(function () { chk.disabled = false; });
    });
  };

  MakanDrawers.prototype._lyricFontOptions = function (current, firstGroup) {
    var S = window.MakanLyricsStyle;
    if (!S) return '';
    var groups = S.fontGroups();
    var names = { en: 'English fonts', fa: 'Persian fonts' };
    var order = firstGroup === 'fa' ? ['fa', 'en'] : ['en', 'fa'];
    var out = '';
    var matched = false;
    order.forEach(function (g) {
      out += '<optgroup label="' + names[g] + '">';
      groups[g].forEach(function (f) {
        var sel = !matched && f.css === current;
        if (sel) matched = true;
        out += '<option value="' + f.css.replace(/"/g, '&quot;') + '"' + (sel ? ' selected' : '') + '>' + f.label + '</option>';
      });
      out += '</optgroup>';
    });
    if (!matched && current) out = '<option value="' + String(current).replace(/"/g, '&quot;') + '" selected>Custom (' + String(current).split(',')[0].replace(/[<>&"]/g, '') + ')</option>' + out;
    return out;
  };

  /* speed only matters for moving styles; swatches only for solid */
  MakanDrawers.prototype._syncColorStyleRows = function () {
    if (!this.el) return;
    var solid = (this.state.lyricsColorStyle || 'solid') === 'solid';
    var sp = this.el.querySelector('#mk-lyrics-colorspeed-row');
    var sw = this.el.querySelector('#mk-lyrics-swatch-row');
    if (sp) sp.hidden = solid;
    if (sw) sw.hidden = !solid;
  };

  MakanDrawers.prototype._lyricColorStyleOptions = function (current) {
    var S = window.MakanLyricsStyle;
    if (!S) return '';
    return S.COLOR_STYLES.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === (current || 'solid') ? ' selected' : '') + '>' + c.label + '</option>';
    }).join('');
  };

  MakanDrawers.prototype._lyricSwatches = function () {
    var S = window.MakanLyricsStyle;
    if (!S) return '';
    return S.SWATCHES.map(function (c) {
      return '<button type="button" class="mk-swatch" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>';
    }).join('');
  };

  MakanDrawers.prototype.resetSection = function (sec) {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.resetSettings) {
      return window.MakanDesktop.resetSettings(sec).then(function (res) {
        if (res && res.settings) {
          self.applySettingsToStateAndUi(res.settings);
        } else {
          self.updateSettingsUi();
        }
        return res;
      });
    }
    return Promise.resolve(null);
  };

  MakanDrawers.prototype.resetAllSettings = function () {
    var self = this;
    if (window.MakanDesktop && window.MakanDesktop.resetSettings) {
      return window.MakanDesktop.resetSettings().then(function (res) {
        if (res && res.settings) {
          self.applySettingsToStateAndUi(res.settings);
        } else {
          self.updateSettingsUi();
        }
        return res;
      });
    }
    return Promise.resolve(null);
  };

  MakanDrawers.prototype._escapeHtml = function (str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  MakanDrawers.prototype._escapeAttr = function (str) {
    return String(str || '').replace(/"/g, '&quot;');
  };

  MakanDrawers.prototype.bindEvents = function () {
    var self = this;

    var scrim = this.el.querySelector('#mk-drawer-scrim');
    if (scrim) {
      scrim.addEventListener('click', function () {
        self.state.closeDrawers();
      });
    }

    if (this.state && typeof this.state.on === 'function') {
      this.state.on('settingsLoaded', function (s) {
        self.updateSettingsUi(s);
      });
    }

    var closeBtns = this.el.querySelectorAll('.mk-drawer-close');
    for (var c = 0; c < closeBtns.length; c++) {
      closeBtns[c].addEventListener('click', function () {
        self.state.closeDrawers();
      });
    }

    // Folders Drawer buttons
    var fAddBtn = this.el.querySelector('#mk-folders-add-btn');
    if (fAddBtn) {
      fAddBtn.addEventListener('click', function () {
        self.state.emit('requestAddFolder');
      });
    }

    var fRescanAllBtn = this.el.querySelector('#mk-folders-rescan-all-btn');
    if (fRescanAllBtn) {
      fRescanAllBtn.addEventListener('click', function () {
        self.rescanAllFolders();
      });
    }

    var fCancelBtn = this.el.querySelector('#mk-folders-cancel-scan-btn');
    if (fCancelBtn) {
      fCancelBtn.addEventListener('click', function () {
        if (window.MakanDesktop && window.MakanDesktop.cancelScan) {
          window.MakanDesktop.cancelScan().then(function () {
            self.isScanning = false;
            var banner = self.el.querySelector('#mk-scan-status-banner');
            var cancelBtn = self.el.querySelector('#mk-folders-cancel-scan-btn');
            if (banner) banner.style.display = 'none';
            if (cancelBtn) cancelBtn.hidden = true;
          });
        }
      });
    }

    var fwChk = this.el.querySelector('#mk-setting-folder-watch-chk');
    if (fwChk) {
      fwChk.addEventListener('change', function (e) {
        self.state.folderWatching = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ folderWatching: e.target.checked });
        }
      });
    }

    // Queue buttons
    var clearQBtn = this.el.querySelector('#mk-queue-clear-btn');
    if (clearQBtn) {
      clearQBtn.addEventListener('click', function () {
        if (self.controller) self.controller.clearQueue();
      });
    }

    var saveQPlBtn = this.el.querySelector('#mk-queue-save-playlist-btn');
    if (saveQPlBtn) {
      saveQPlBtn.addEventListener('click', function () {
        var explicit = (self.controller && Array.isArray(self.controller.explicitQueue)) ? self.controller.explicitQueue : [];
        if (!explicit.length) {
          alert('Queue is empty');
          return;
        }
        var tracks = explicit.slice();
        self._askName('Playlist Name:', 'Queue - ' + new Date().toLocaleDateString(), function (name) {
        if (name && name.trim() && window.MakanDesktop && window.MakanDesktop.createPlaylist) {
          window.MakanDesktop.createPlaylist(name.trim()).then(function (newPl) {
            if (newPl && newPl.id) {
              var trackIds = tracks.map(function (t) { return t.id; });
              window.MakanDesktop.addTracksToPlaylist(newPl.id, trackIds, self.state.allowDuplicatesInPlaylists).then(function () {
                self.loadPlaylists();
                alert('Saved ' + trackIds.length + ' tracks to playlist "' + newPl.name + '".');
              });
            }
          });
        }
        });
      });
    }

    // Playlists drawer buttons
    var newPlBtn = this.el.querySelector('#mk-playlist-new-btn');
    if (newPlBtn) {
      newPlBtn.addEventListener('click', function () {
        self._askName('New Playlist Name:', 'My Playlist', function (name) {
        if (name && name.trim() && window.MakanDesktop && window.MakanDesktop.createPlaylist) {
          window.MakanDesktop.createPlaylist(name.trim()).then(function () {
            self.loadPlaylists();
          });
        }
        });
      });
    }

    var importM3uBtn = this.el.querySelector('#mk-playlist-import-m3u-btn');
    if (importM3uBtn) {
      importM3uBtn.addEventListener('click', function () {
        if (window.MakanDesktop && window.MakanDesktop.importPlaylistM3U) {
          window.MakanDesktop.importPlaylistM3U().then(function (res) {
            if (res && res.ok) {
              self.loadPlaylists();
              alert('Successfully imported playlist with ' + (res.addedCount || 0) + ' tracks.');
            }
          });
        }
      });
    }

    // Settings Navigation Tabs
    var tabBtns = this.el.querySelectorAll('.mk-btn-tab');
    for (var tb = 0; tb < tabBtns.length; tb++) {
      tabBtns[tb].addEventListener('click', function () {
        var targetTab = this.getAttribute('data-set-tab');
        self.activeSettingsTab = targetTab;
        for (var k = 0; k < tabBtns.length; k++) {
          tabBtns[k].classList.remove('mk-tab-active');
        }
        this.classList.add('mk-tab-active');

        var panes = self.el.querySelectorAll('.mk-settings-pane');
        for (var p = 0; p < panes.length; p++) {
          panes[p].hidden = (panes[p].id !== ('mk-set-pane-' + targetTab));
        }
      });
    }

    // Settings inputs & controls
    // v1.8.0 Audio Output & Native Pure Audio settings
    var audioBackendSel = this.el.querySelector('#mk-set-audio-backend');
    if (audioBackendSel) {
      audioBackendSel.addEventListener('change', function (e) {
        var backendType = e.target.value;
        self.state.audioBackend = backendType;
        var nativeDiv = self.el.querySelector('#mk-native-audio-options');
        if (nativeDiv) nativeDiv.style.display = (backendType === 'native') ? 'flex' : 'none';
        if (self.engine && typeof self.engine.setBackend === 'function') {
          self.engine.setBackend(backendType).catch(function (err) {
            console.error('[Drawers] Error switching backend:', err);
          });
        }
        if (backendType === 'native') {
          self.loadAudioDevices();
        }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ audioBackend: backendType });
        }
      });
    }

    var outputModeSel = this.el.querySelector('#mk-set-output-mode');
    if (outputModeSel) {
      outputModeSel.addEventListener('change', function (e) {
        var mode = e.target.value;
        self.state.outputMode = mode;
        if (self.engine && typeof self.engine.setOutputMode === 'function') {
          self.engine.setOutputMode(mode);
        }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ outputMode: mode });
        }
      });
    }

    var outputDeviceSel = this.el.querySelector('#mk-set-output-device');
    if (outputDeviceSel) {
      outputDeviceSel.addEventListener('change', function (e) {
        var devId = e.target.value;
        self.state.outputDevice = devId;
        if (self.engine && typeof self.engine.selectDevice === 'function') {
          self.engine.selectDevice(devId);
        }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ outputDevice: devId });
        }
      });
    }

    var bufferModeSel = this.el.querySelector('#mk-set-buffer-mode');
    if (bufferModeSel) {
      bufferModeSel.addEventListener('change', function (e) {
        var bMode = e.target.value;
        self.state.bufferMode = bMode;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ bufferMode: bMode });
        }
      });
    }

    var btnShowAudioPath = this.el.querySelector('#mk-btn-show-audio-path');
    if (btnShowAudioPath) {
      btnShowAudioPath.addEventListener('click', function () {
        self.state.toggleDrawer('audioPathDialog');
        self.updateAudioPathUi();
      });
    }

    var btnTestOutput = this.el.querySelector('#mk-btn-test-output');
    if (btnTestOutput) {
      btnTestOutput.addEventListener('click', function () {
        if (self.engine && typeof self.engine.playTestChime === 'function') {
          self.engine.playTestChime();
        }
      });
    }

    if (this.state && typeof this.state.on === 'function') {
      this.state.on('audioPathChanged', function (pathData) {
        self.updateAudioPathUi(pathData);
      });
    }

    var gaplessInp = this.el.querySelector('#mk-set-gapless');
    if (gaplessInp) {
      gaplessInp.addEventListener('change', function (e) {
        self.state.gapless = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ gapless: e.target.checked });
        }
      });
    }

    var sleepSel = this.el.querySelector('#mk-set-sleep');
    var sleepStatus = this.el.querySelector('#mk-set-sleep-status');
    function showSleep(st) {
      if (!sleepSel || !st) return;
      var T = window.MakanSleepTimer;
      if (st.mode === 'off') { sleepSel.value = '0'; if (sleepStatus) sleepStatus.textContent = ''; }
      else if (st.mode === 'song') { sleepSel.value = 'song'; if (sleepStatus) sleepStatus.textContent = 'The music stops when this song ends.'; }
      else if (sleepStatus) sleepStatus.textContent = 'Stops in ' + (T ? T.formatRemaining(st.remainingSec) : st.remainingSec + ' s');
    }
    if (sleepSel) {
      sleepSel.addEventListener('change', function () {
        var tm = self.state.sleepTimer;
        if (!tm) return;
        if (sleepSel.value === 'song') tm.endOfSong();
        else if (sleepSel.value === '0') tm.cancel();
        else tm.start(parseInt(sleepSel.value, 10));
      });
      self.state.on('sleepTimerChanged', showSleep);
      if (self.state.sleepTimer) showSleep(self.state.sleepTimer.status());
    }

    var mixChk = this.el.querySelector('#mk-set-automix');
    if (mixChk) {
      mixChk.addEventListener('change', function () {
        self.state.autoMix = !!mixChk.checked;
        try { window.localStorage.setItem('makan.autoMix', self.state.autoMix ? '1' : '0'); } catch (e) { /* not saved */ }
      });
    }

    var crossfadeSel = this.el.querySelector('#mk-set-crossfade');
    if (crossfadeSel) {
      crossfadeSel.addEventListener('change', function (e) {
        var sec = parseInt(e.target.value, 10) || 0;
        self.state.crossfade = sec;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ crossfade: sec });
        }
      });
    }

    var rgModeSel = this.el.querySelector('#mk-set-replaygain-mode');
    if (rgModeSel) {
      rgModeSel.addEventListener('change', function (e) {
        var mode = e.target.value;
        self.state.replayGainMode = mode;
        if (self.engine) self.engine.applyReplayGain(self.state.currentTrack);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ replayGainMode: mode });
        }
      });
    }

    var rgPreampInp = this.el.querySelector('#mk-set-rg-preamp');
    if (rgPreampInp) {
      rgPreampInp.addEventListener('input', function (e) {
        var val = parseFloat(e.target.value) || 0;
        self.state.replayGainPreamp = val;
        var lbl = self.el.querySelector('#mk-set-rg-preamp-val');
        if (lbl) lbl.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
        if (self.engine) self.engine.applyReplayGain(self.state.currentTrack);
      });
      rgPreampInp.addEventListener('change', function (e) {
        var val = parseFloat(e.target.value) || 0;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ replayGainPreamp: val });
        }
      });
    }

    var rgFallbackInp = this.el.querySelector('#mk-set-rg-fallback');
    if (rgFallbackInp) {
      rgFallbackInp.addEventListener('input', function (e) {
        var val = parseFloat(e.target.value) || 0;
        self.state.replayGainPreampFallback = val;
        var lbl = self.el.querySelector('#mk-set-rg-fallback-val');
        if (lbl) lbl.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
        if (self.engine) self.engine.applyReplayGain(self.state.currentTrack);
      });
      rgFallbackInp.addEventListener('change', function (e) {
        var val = parseFloat(e.target.value) || 0;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ replayGainPreampFallback: val });
        }
      });
    }

    var resumeLongInp = this.el.querySelector('#mk-set-resume-long');
    if (resumeLongInp) {
      resumeLongInp.addEventListener('change', function (e) {
        self.state.resumeLongTracks = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ resumeLongTracks: e.target.checked });
        }
      });
    }

    var resumeThreshInp = this.el.querySelector('#mk-set-resume-threshold');
    if (resumeThreshInp) {
      resumeThreshInp.addEventListener('input', function (e) {
        var sec = parseInt(e.target.value, 10) || 900;
        self.state.resumeThreshold = sec;
        var lbl = self.el.querySelector('#mk-set-resume-threshold-val');
        if (lbl) lbl.textContent = Math.round(sec / 60) + ' min';
      });
      resumeThreshInp.addEventListener('change', function (e) {
        var sec = parseInt(e.target.value, 10) || 900;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ resumeThreshold: sec });
        }
      });
    }

    var setFwInp = this.el.querySelector('#mk-set-folder-watching');
    if (setFwInp) {
      setFwInp.addEventListener('change', function (e) {
        self.state.folderWatching = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ folderWatching: e.target.checked });
        }
      });
    }

    var setAllowDupInp = this.el.querySelector('#mk-set-allow-duplicates');
    if (setAllowDupInp) {
      setAllowDupInp.addEventListener('change', function (e) {
        self.state.allowDuplicatesInPlaylists = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ allowDuplicatesInPlaylists: e.target.checked });
        }
      });
    }

    var aotChk = this.el.querySelector('#mk-setting-always-on-top');
    if (aotChk) {
      aotChk.addEventListener('change', function (e) {
        self.state.alwaysOnTop = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setAlwaysOnTop) {
          window.MakanDesktop.setAlwaysOnTop(e.target.checked);
        }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ alwaysOnTop: e.target.checked });
        }
      });
    }

    var miniAotChk = this.el.querySelector('#mk-set-mini-always-on-top');
    if (miniAotChk) {
      miniAotChk.addEventListener('change', function (e) {
        self.state.miniPlayerAlwaysOnTop = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ miniPlayerAlwaysOnTop: e.target.checked });
        }
      });
    }

    var minTrayChk = this.el.querySelector('#mk-set-minimize-tray');
    if (minTrayChk) {
      minTrayChk.addEventListener('change', function (e) {
        self.state.minimizeToTray = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ minimizeToTray: e.target.checked });
        }
      });
    }

    var closeTrayChk = this.el.querySelector('#mk-set-close-tray');
    if (closeTrayChk) {
      closeTrayChk.addEventListener('change', function (e) {
        self.state.closeToTray = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ closeToTray: e.target.checked });
        }
      });
    }

    var reducedMotionInp = this.el.querySelector('#mk-set-reduced-motion');
    if (reducedMotionInp) {
      reducedMotionInp.addEventListener('change', function (e) {
        self.state.reducedMotion = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ reducedMotion: e.target.checked });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    var rescanBtn = this.el.querySelector('#mk-setting-rescan-btn');
    if (rescanBtn) {
      rescanBtn.addEventListener('click', function () {
        self.state.emit('requestRescan');
      });
    }

    var missingBtn = this.el.querySelector('#mk-setting-missing-btn');
    if (missingBtn) {
      missingBtn.addEventListener('click', function () {
        if (window.MakanDesktop && window.MakanDesktop.locateMissing) {
          window.MakanDesktop.locateMissing().then(function (cnt) {
            alert('Missing file check completed. Flagged ' + cnt + ' missing track(s).');
            self.state.emit('libraryUpdated');
          });
        }
      });
    }

    var openFoldersBtn = this.el.querySelector('#mk-setting-open-folders-btn');
    if (openFoldersBtn) {
      openFoldersBtn.addEventListener('click', function () {
        self.state.toggleDrawer('folders');
      });
    }

    var resetDefaultsBtn = this.el.querySelector('#mk-setting-reset-defaults-btn');
    if (resetDefaultsBtn) {
      resetDefaultsBtn.addEventListener('click', function () {
        var confirmed = (typeof window.confirm !== 'function') || window.confirm('Reset all settings to factory defaults?');
        if (confirmed) {
          self.resetAllSettings().then(function () {
            if (typeof alert === 'function') alert('All settings restored to defaults.');
          });
        }
      });
    }

    var sectionResetBtns = this.el.querySelectorAll('.mk-btn-reset-section');
    for (var srb = 0; srb < sectionResetBtns.length; srb++) {
      sectionResetBtns[srb].addEventListener('click', function () {
        var sec = this.getAttribute('data-reset-section');
        var confirmed = (typeof window.confirm !== 'function') || window.confirm('Restore ' + sec.toUpperCase() + ' settings to defaults?');
        if (confirmed) {
          self.resetSection(sec).then(function () {
            if (typeof alert === 'function') alert(sec.toUpperCase() + ' settings restored to defaults.');
          });
        }
      });
    }

    var openEqBtn = this.el.querySelector('#mk-audio-open-eq-btn');
    if (openEqBtn) {
      openEqBtn.addEventListener('click', function () {
        self.state.toggleDrawer('equalizer');
      });
    }

    this._bindTranslateCard();
    var lmHost = this.el.querySelector('#mk-set-lyrics-models');
    if (lmHost && window.MakanLyricsModels) window.MakanLyricsModels.mount(lmHost, this.state);

    var openStyleBtn = this.el.querySelector('#mk-set-open-lyrics-style-btn');
    if (openStyleBtn) {
      openStyleBtn.addEventListener('click', function () {
        self.state.toggleDrawer('lyricsStyle');
      });
    }

    var clearHistBtn = this.el.querySelector('#mk-adv-clear-history-btn');
    if (clearHistBtn) {
      clearHistBtn.addEventListener('click', function () {
        if (self.controller && typeof self.controller.clearHistory === 'function') {
          self.controller.clearHistory();
        }
        if (window.MakanDesktop && window.MakanDesktop.clearHistory) {
          window.MakanDesktop.clearHistory().then(function () {
            self.state.emit('libraryUpdated');
            self.state.emit('countsUpdated');
            alert('Playback history cleared.');
          });
        } else {
          self.state.emit('libraryUpdated');
          self.state.emit('countsUpdated');
          alert('Playback history cleared.');
        }
      });
    }

    var clearLibBtn = this.el.querySelector('#mk-adv-clear-library-btn');
    if (clearLibBtn) {
      clearLibBtn.addEventListener('click', function () {
        if (window.confirm('Clear all indexed tracks, playlists, and folders from MAKAN library?\n\n(Safety Note: Your original music files on storage are completely safe and will NEVER be deleted, moved, or altered)')) {
          if (self.engine) {
            self.engine.stop();
          }
          if (self.controller) {
            self.controller.clearQueue();
            self.controller.history = [];
            self.controller.forwardHistory = [];
            self.controller.context = { type: 'library', name: 'All Tracks', tracks: [] };
            self.controller.shuffledBag = [];
            self.controller.contextIndex = -1;
            self.controller.queueIndex = -1;
          }
          self.state.currentTrack = null;
          self.state.activeTrackIndex = -1;
          self.state.currentTime = 0;
          self.state.duration = 0;
          self.state.setPlayState(false);
          self.state.tracks = [];
          self.state.totalTracksDisplay = 0;
          self.state.playlistsCount = 0;
          self.state.queueCount = 0;

          if (window.MakanDesktop && window.MakanDesktop.clearLibrary) {
            window.MakanDesktop.clearLibrary().then(function () {
              self.state.emit('trackChanged', { track: null, index: -1 });
              self.state.emit('libraryUpdated');
              self.state.emit('countsUpdated');
              self.state.emit('playlistsUpdated');
              self.loadPlaylists();
              self.loadFolders();
              alert('Library, playlists, folders, and history have been cleared.');
            });
          }
        }
      });
    }

    // EQ Preset selection
    var presetSel = this.el.querySelector('#mk-eq-preset-sel');
    if (presetSel) {
      presetSel.value = this.state.eqPreset || 'flat';
      presetSel.addEventListener('change', function (e) {
        var key = e.target.value;
        self.engine.setEqPreset(key);

        var eqNormalizerChk = self.el.querySelector('#mk-eq-normalizer-chk');
        if (eqNormalizerChk) eqNormalizerChk.checked = !!self.state.loudnessNormalizer;
        var setNormChk = self.el.querySelector('#mk-set-loudness-normalizer');
        if (setNormChk) setNormChk.checked = !!self.state.loudnessNormalizer;

        var eqWidthInp = self.el.querySelector('#mk-eq-stereo-width');
        if (eqWidthInp) eqWidthInp.value = self.state.stereoWidth !== undefined ? self.state.stereoWidth : 1.0;
        var eqWidthVal = self.el.querySelector('#mk-eq-stereo-width-val');
        if (eqWidthVal) eqWidthVal.textContent = (self.state.stereoWidth !== undefined ? Number(self.state.stereoWidth).toFixed(2) : '1.00') + 'x';
        var setWidthInp = self.el.querySelector('#mk-set-stereo-width');
        if (setWidthInp) setWidthInp.value = self.state.stereoWidth !== undefined ? self.state.stereoWidth : 1.0;
        var setWidthVal = self.el.querySelector('#mk-set-stereo-width-val');
        if (setWidthVal) setWidthVal.textContent = (self.state.stereoWidth !== undefined ? Number(self.state.stereoWidth).toFixed(2) : '1.00') + 'x';

        for (var b = 0; b < self.state.eqGains.length; b++) {
          var valEl = self.el.querySelector('#mk-eq-val-' + b);
          if (valEl) valEl.textContent = (self.state.eqGains[b] >= 0 ? '+' : '') + self.state.eqGains[b].toFixed(1);
          var rangeInput = self.el.querySelector('.mk-eq-range[data-band="' + b + '"]');
          if (rangeInput) rangeInput.value = self.state.eqGains[b];
        }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({
            eqPreset: key,
            eqGains: self.state.eqGains.slice(),
            loudnessNormalizer: self.state.loudnessNormalizer,
            stereoWidth: self.state.stereoWidth
          });
        }
      });
    }

    if (this.state && typeof this.state.on === 'function') {
      this.state.on('potPlayerModeChanged', function () {
        if (presetSel) presetSel.value = self.state.eqPreset || 'flat';
        var modeSelEl = self.el.querySelector('#mk-eq-sound-mode-sel');
        if (modeSelEl) modeSelEl.value = self.state.soundMode || 'off';
        var strSelEl = self.el.querySelector('#mk-eq-strength-sel');
        if (strSelEl) strSelEl.value = self.state.normalizerStrength || 'strong';
        var eqNormalizerChk = self.el.querySelector('#mk-eq-normalizer-chk');
        if (eqNormalizerChk) eqNormalizerChk.checked = !!self.state.loudnessNormalizer;
        var setNormChk = self.el.querySelector('#mk-set-loudness-normalizer');
        if (setNormChk) setNormChk.checked = !!self.state.loudnessNormalizer;

        var eqWidthInp = self.el.querySelector('#mk-eq-stereo-width');
        if (eqWidthInp) eqWidthInp.value = self.state.stereoWidth !== undefined ? self.state.stereoWidth : 1.0;
        var eqWidthVal = self.el.querySelector('#mk-eq-stereo-width-val');
        if (eqWidthVal) eqWidthVal.textContent = (self.state.stereoWidth !== undefined ? Number(self.state.stereoWidth).toFixed(2) : '1.00') + 'x';
        var setWidthInp = self.el.querySelector('#mk-set-stereo-width');
        if (setWidthInp) setWidthInp.value = self.state.stereoWidth !== undefined ? self.state.stereoWidth : 1.0;
        var setWidthVal = self.el.querySelector('#mk-set-stereo-width-val');
        if (setWidthVal) setWidthVal.textContent = (self.state.stereoWidth !== undefined ? Number(self.state.stereoWidth).toFixed(2) : '1.00') + 'x';

        for (var b = 0; b < (self.state.eqGains || []).length; b++) {
          var valEl = self.el.querySelector('#mk-eq-val-' + b);
          if (valEl) valEl.textContent = (self.state.eqGains[b] >= 0 ? '+' : '') + self.state.eqGains[b].toFixed(1);
          var rangeInput = self.el.querySelector('.mk-eq-range[data-band="' + b + '"]');
          if (rangeInput) rangeInput.value = self.state.eqGains[b];
        }
      });
    }

    // EQ Preamp
    var eqPreampInp = this.el.querySelector('#mk-eq-preamp');
    if (eqPreampInp) {
      eqPreampInp.addEventListener('input', function (e) {
        var val = parseFloat(e.target.value) || 0;
        self.engine.setEqPreamp(val);
        var lbl = self.el.querySelector('#mk-eq-preamp-val');
        if (lbl) lbl.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
      });
      eqPreampInp.addEventListener('change', function (e) {
        var val = parseFloat(e.target.value) || 0;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ eqPreamp: val });
        }
      });
    }

    // EQ Bypass
    var eqBypassChk = this.el.querySelector('#mk-eq-bypass-chk');
    if (eqBypassChk) {
      eqBypassChk.addEventListener('change', function (e) {
        self.engine.setEqBypass(e.target.checked);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ eqEnabled: !e.target.checked });
        }
      });
    }

    // EQ Reset
    var eqResetBtn = this.el.querySelector('#mk-eq-reset-btn');
    if (eqResetBtn) {
      eqResetBtn.addEventListener('click', function () {
        self.engine.resetEq();
        if (presetSel) presetSel.value = 'flat';
        if (eqBypassChk) eqBypassChk.checked = false;
        if (eqPreampInp) eqPreampInp.value = 0;
        var pLbl = self.el.querySelector('#mk-eq-preamp-val');
        if (pLbl) pLbl.textContent = '+0.0 dB';
        for (var b = 0; b < 10; b++) {
          var valEl = self.el.querySelector('#mk-eq-val-' + b);
          if (valEl) valEl.textContent = '+0.0';
          var rangeInput = self.el.querySelector('.mk-eq-range[data-band="' + b + '"]');
          if (rangeInput) rangeInput.value = 0;
        }

        var eqNormalizerChk = self.el.querySelector('#mk-eq-normalizer-chk');
        if (eqNormalizerChk) eqNormalizerChk.checked = false;
        var setNormChk = self.el.querySelector('#mk-set-loudness-normalizer');
        if (setNormChk) setNormChk.checked = false;

        var eqWidthInp = self.el.querySelector('#mk-eq-stereo-width');
        if (eqWidthInp) eqWidthInp.value = 1.0;
        var eqWidthVal = self.el.querySelector('#mk-eq-stereo-width-val');
        if (eqWidthVal) eqWidthVal.textContent = '1.00x';
        var setWidthInp = self.el.querySelector('#mk-set-stereo-width');
        if (setWidthInp) setWidthInp.value = 1.0;
        var setWidthVal = self.el.querySelector('#mk-set-stereo-width-val');
        if (setWidthVal) setWidthVal.textContent = '1.00x';

        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({
            eqPreset: 'flat',
            eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            eqPreamp: 0.0,
            eqEnabled: true,
            loudnessNormalizer: false,
            stereoWidth: 1.0
          });
        }
      });
    }

    // EQ Sliders input & persistence on change
    var eqRanges = this.el.querySelectorAll('.mk-eq-range');
    for (var r = 0; r < eqRanges.length; r++) {
      eqRanges[r].addEventListener('input', function () {
        var bandIdx = parseInt(this.getAttribute('data-band'), 10);
        var val = parseFloat(this.value);
        self.engine.setEqBandGain(bandIdx, val);
        var valEl = self.el.querySelector('#mk-eq-val-' + bandIdx);
        if (valEl) valEl.textContent = (val >= 0 ? '+' : '') + val.toFixed(1);
        if (presetSel) presetSel.value = 'custom';
      });
      eqRanges[r].addEventListener('change', function () {
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({
            eqPreset: 'custom',
            eqGains: self.state.eqGains.slice()
          });
        }
      });
    }

    // Stereo Pan
    var panInput = this.el.querySelector('#mk-stereo-pan');
    if (panInput) {
      panInput.addEventListener('input', function (e) {
        var p = parseFloat(e.target.value);
        self.engine.setStereoPan(p);
      });
    }

    // PotPlayer DSP: Loudness Normalizer
    function handleNormalizerChange(enabled) {
      self.state.loudnessNormalizer = enabled;
      if (self.engine && typeof self.engine.setLoudnessNormalizer === 'function') {
        self.engine.setLoudnessNormalizer(enabled);
      }
      var eqChk = self.el.querySelector('#mk-eq-normalizer-chk');
      var setChk = self.el.querySelector('#mk-set-loudness-normalizer');
      if (eqChk) eqChk.checked = enabled;
      if (setChk) setChk.checked = enabled;
      if (window.MakanDesktop && window.MakanDesktop.setSettings) {
        window.MakanDesktop.setSettings({ loudnessNormalizer: enabled });
      }
    }

    var eqModeSel = this.el.querySelector('#mk-eq-sound-mode-sel');
    if (eqModeSel) {
      eqModeSel.addEventListener('change', function (e) {
        var v = e.target.value;
        if (self.engine && typeof self.engine.setSoundMode === 'function') self.engine.setSoundMode(v);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ soundMode: v, potPlayerMode: v !== 'off', normalizerStrength: self.state.normalizerStrength });
      });
    }

    var eqStrengthSel = this.el.querySelector('#mk-eq-strength-sel');
    if (eqStrengthSel) {
      eqStrengthSel.addEventListener('change', function (e) {
        var v = e.target.value;
        self.state.normalizerStrength = v;
        if (self.engine && typeof self.engine.setNormalizerStrength === 'function') self.engine.setNormalizerStrength(v);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ normalizerStrength: v });
      });
    }

    var eqNormChk = this.el.querySelector('#mk-eq-normalizer-chk');
    if (eqNormChk) {
      eqNormChk.addEventListener('change', function (e) {
        handleNormalizerChange(e.target.checked);
      });
    }

    var setNormChk = this.el.querySelector('#mk-set-loudness-normalizer');
    if (setNormChk) {
      setNormChk.addEventListener('change', function (e) {
        handleNormalizerChange(e.target.checked);
      });
    }

    // PotPlayer DSP: Stereo Width
    function handleStereoWidthInput(w) {
      self.state.stereoWidth = w;
      if (self.engine && typeof self.engine.setStereoWidth === 'function') {
        self.engine.setStereoWidth(w);
      }
      var eqInp = self.el.querySelector('#mk-eq-stereo-width');
      var eqVal = self.el.querySelector('#mk-eq-stereo-width-val');
      var setInp = self.el.querySelector('#mk-set-stereo-width');
      var setVal = self.el.querySelector('#mk-set-stereo-width-val');
      if (eqInp) eqInp.value = w;
      if (eqVal) eqVal.textContent = w.toFixed(2) + 'x';
      if (setInp) setInp.value = w;
      if (setVal) setVal.textContent = w.toFixed(2) + 'x';
    }

    function handleStereoWidthChange(w) {
      handleStereoWidthInput(w);
      if (window.MakanDesktop && window.MakanDesktop.setSettings) {
        window.MakanDesktop.setSettings({ stereoWidth: w });
      }
    }

    var eqWidthInp = this.el.querySelector('#mk-eq-stereo-width');
    if (eqWidthInp) {
      eqWidthInp.addEventListener('input', function (e) {
        var w = parseFloat(e.target.value) || 1.0;
        handleStereoWidthInput(w);
      });
      eqWidthInp.addEventListener('change', function (e) {
        var w = parseFloat(e.target.value) || 1.0;
        handleStereoWidthChange(w);
      });
    }

    var setWidthInp = this.el.querySelector('#mk-set-stereo-width');
    if (setWidthInp) {
      setWidthInp.addEventListener('input', function (e) {
        var w = parseFloat(e.target.value) || 1.0;
        handleStereoWidthInput(w);
      });
      setWidthInp.addEventListener('change', function (e) {
        var w = parseFloat(e.target.value) || 1.0;
        handleStereoWidthChange(w);
      });
    }

    // Visualizer Theme dropdowns
    var visThemeSel = this.el.querySelector('#mk-vis-theme-sel');
    if (visThemeSel) {
      visThemeSel.value = this.state.visualizerTheme;
      visThemeSel.addEventListener('change', function (e) {
        self.state.setVisualizerTheme(e.target.value);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ visualizerTheme: e.target.value });
        }
      });
    }

    var visThemeSelPane = this.el.querySelector('#mk-set-vis-theme');
    if (visThemeSelPane) {
      visThemeSelPane.addEventListener('change', function (e) {
        self.state.setVisualizerTheme(e.target.value);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ visualizerTheme: e.target.value });
        }
      });
    }

    // Reactive lyric checkbox & intensity slider
    var reactiveChk = this.el.querySelector('#mk-reactive-lyrics-chk');
    if (reactiveChk) {
      reactiveChk.addEventListener('change', function (e) {
        self.state.soundReactiveLyrics = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ soundReactiveLyrics: e.target.checked });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    var setSoundReactive = this.el.querySelector('#mk-set-sound-reactive-lyrics');
    if (setSoundReactive) {
      setSoundReactive.addEventListener('change', function (e) {
        self.state.soundReactiveLyrics = e.target.checked;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ soundReactiveLyrics: e.target.checked });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    var reactiveIntensity = this.el.querySelector('#mk-reactive-intensity');
    if (reactiveIntensity) {
      reactiveIntensity.addEventListener('input', function (e) {
        var val = parseFloat(e.target.value);
        self.state.reactiveIntensity = val;
        var lbl = self.el.querySelector('#mk-reactive-intensity-val');
        if (lbl) lbl.textContent = val.toFixed(1) + 'x';
      });
      reactiveIntensity.addEventListener('change', function (e) {
        var val = parseFloat(e.target.value);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ reactiveIntensity: val });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Font selection
    var fontSel = this.el.querySelector('#mk-font-sel');
    if (fontSel) {
      if (this.state.lyricsFontFamily) fontSel.value = this.state.lyricsFontFamily;
      fontSel.addEventListener('change', function (e) {
        self.state.lyricsFontFamily = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsFontFamily: e.target.value });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Original lyric size
    var origSizeInp = this.el.querySelector('#mk-lyrics-orig-size');
    if (origSizeInp) {
      origSizeInp.addEventListener('input', function (e) {
        var sz = parseInt(e.target.value, 10);
        self.state.lyricsOriginalSize = sz;
        var lbl = self.el.querySelector('#mk-lyrics-orig-size-val');
        if (lbl) lbl.textContent = sz + 'px';
      });
      origSizeInp.addEventListener('change', function (e) {
        var sz = parseInt(e.target.value, 10);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsOriginalSize: sz });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Translation lyric size
    var transSizeInp = this.el.querySelector('#mk-lyrics-trans-size');
    if (transSizeInp) {
      transSizeInp.addEventListener('input', function (e) {
        var sz = parseInt(e.target.value, 10);
        self.state.lyricsTranslationSize = sz;
        var lbl = self.el.querySelector('#mk-lyrics-trans-size-val');
        if (lbl) lbl.textContent = sz + 'px';
      });
      transSizeInp.addEventListener('change', function (e) {
        var sz = parseInt(e.target.value, 10);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsTranslationSize: sz });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Active color
    var actColorInp = this.el.querySelector('#mk-lyrics-active-color');
    if (actColorInp) {
      actColorInp.addEventListener('input', function (e) {
        self.state.lyricsActiveColor = e.target.value;
      });
      actColorInp.addEventListener('change', function (e) {
        self.state.lyricsActiveColor = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsActiveColor: e.target.value });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Inactive color
    var inactColorInp = this.el.querySelector('#mk-lyrics-inactive-color');
    if (inactColorInp) {
      inactColorInp.addEventListener('input', function (e) {
        self.state.lyricsInactiveColor = e.target.value;
      });
      inactColorInp.addEventListener('change', function (e) {
        self.state.lyricsInactiveColor = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsInactiveColor: e.target.value });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Translation color
    var transColorInp = this.el.querySelector('#mk-lyrics-trans-color');
    if (transColorInp) {
      transColorInp.addEventListener('input', function (e) {
        self.state.lyricsTranslationColor = e.target.value;
      });
      transColorInp.addEventListener('change', function (e) {
        self.state.lyricsTranslationColor = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsTranslationColor: e.target.value });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Background style
    var bgSel = this.el.querySelector('#mk-lyrics-bg-sel');
    if (bgSel) {
      if (this.state.lyricsBackground) bgSel.value = this.state.lyricsBackground;
      bgSel.addEventListener('change', function (e) {
        self.state.lyricsBackground = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsBackground: e.target.value });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // Colour theme (dark / light Platinum Blue / automatic)
    var appThemeSel2 = this.el.querySelector('#mk-set-app-theme');
    if (appThemeSel2) {
      if (window.MakanTheme) appThemeSel2.value = window.MakanTheme.getMode();
      appThemeSel2.addEventListener('change', function (e) {
        self.state.appTheme = e.target.value;
        if (window.MakanTheme) window.MakanTheme.apply(e.target.value);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ appTheme: e.target.value });
      });
    }

    // Color style (solid / rainbow / patterns)
    var fxSel2 = this.el.querySelector('#mk-lyrics-effect-sel');
    if (fxSel2) {
      fxSel2.addEventListener('change', function (e) {
        self.state.lyricsEffect = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ lyricsEffect: e.target.value });
        self.state.emit('lyricStyleChanged');
      });
    }

    var csSel2 = this.el.querySelector('#mk-lyrics-colorstyle-sel');
    if (csSel2) {
      csSel2.addEventListener('change', function (e) {
        self.state.lyricsColorStyle = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ lyricsColorStyle: e.target.value });
        self._syncColorStyleRows();
        self.state.emit('lyricStyleChanged');
      });
    }
    var cspInp = this.el.querySelector('#mk-lyrics-colorspeed');
    if (cspInp) {
      cspInp.addEventListener('input', function (e) {
        var v = parseInt(e.target.value, 10);
        self.state.lyricsColorSpeed = v;
        var lbl = self.el.querySelector('#mk-lyrics-colorspeed-val');
        if (lbl) lbl.textContent = v + 's';
        self.state.emit('lyricStyleChanged');
      });
      cspInp.addEventListener('change', function (e) {
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ lyricsColorSpeed: parseInt(e.target.value, 10) });
      });
    }
    var swBox = this.el.querySelector('#mk-lyrics-swatches');
    if (swBox) {
      swBox.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.mk-swatch');
        if (!b) return;
        var c = b.getAttribute('data-color');
        self.state.lyricsActiveColor = c;
        self.state.lyricsColorStyle = 'solid';
        var picker = self.el.querySelector('#mk-lyrics-active-color');
        if (picker) picker.value = c;
        var sel = self.el.querySelector('#mk-lyrics-colorstyle-sel');
        if (sel) sel.value = 'solid';
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ lyricsActiveColor: c, lyricsColorStyle: 'solid' });
        self._syncColorStyleRows();
        self.state.emit('lyricStyleChanged');
      });
    }
    var tfSel2 = this.el.querySelector('#mk-trans-font-sel');
    if (tfSel2) {
      tfSel2.addEventListener('change', function (e) {
        self.state.lyricsTranslationFont = e.target.value;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ lyricsTranslationFont: e.target.value });
        self.state.emit('lyricStyleChanged');
      });
    }
    this._syncColorStyleRows();

    // Glow intensity
    var glowInp = this.el.querySelector('#mk-lyrics-glow-intensity');
    if (glowInp) {
      glowInp.addEventListener('input', function (e) {
        var val = parseFloat(e.target.value);
        self.state.lyricsGlowIntensity = val;
        var lbl = self.el.querySelector('#mk-lyrics-glow-val');
        if (lbl) lbl.textContent = val.toFixed(1) + 'x';
      });
      glowInp.addEventListener('change', function (e) {
        var val = parseFloat(e.target.value);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricsGlowIntensity: val });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    this.bindQueueItemEvents();
    this.bindPlaylistEvents();
    this.bindFolderEvents();

    this.state.on('queueChanged', function () {
      self.updateQueueList();
    });

    this.state.on('trackChanged', function () {
      self.updateQueueList();
    });

    this.state.on('drawersChanged', function (data) {
      var drawers = data.drawers;
      var hasAny = false;

      var fEl = self.el.querySelector('#mk-folders-drawer');
      var eqEl = self.el.querySelector('#mk-eq-drawer');
      var styleEl = self.el.querySelector('#mk-style-drawer');
      var queueEl = self.el.querySelector('#mk-queue-drawer');
      var plEl = self.el.querySelector('#mk-playlists-drawer');
      var setEl = self.el.querySelector('#mk-settings-drawer');
      var aiEl = self.el.querySelector('#mk-ai-dialog');

      if (fEl) {
        fEl.hidden = !drawers.folders;
        if (drawers.folders) {
          hasAny = true;
          self.loadFolders();
        }
      }
      if (eqEl) {
        eqEl.hidden = !drawers.equalizer;
        if (drawers.equalizer) hasAny = true;
      }
      if (styleEl) {
        styleEl.hidden = !drawers.lyricsStyle;
        if (drawers.lyricsStyle) hasAny = true;
      }
      if (queueEl) {
        queueEl.hidden = !drawers.queue;
        if (drawers.queue) {
          hasAny = true;
          self.updateQueueList();
        }
      }
      if (plEl) {
        plEl.hidden = !drawers.playlists;
        if (drawers.playlists) {
          hasAny = true;
          self.loadPlaylists();
        }
      }
      if (setEl) {
        setEl.hidden = !drawers.settings;
        if (drawers.settings) {
          hasAny = true;
          self.updateSettingsUi();
        }
      }
      if (aiEl) {
        aiEl.hidden = !drawers.aiDialog;
        if (drawers.aiDialog) hasAny = true;
      }
      var audioPathEl = self.el.querySelector('#mk-audio-path-dialog');
      if (audioPathEl) {
        audioPathEl.hidden = !drawers.audioPathDialog;
        if (drawers.audioPathDialog) {
          hasAny = true;
          self.updateAudioPathUi();
        }
      }

      if (scrim) {
        scrim.hidden = !hasAny;
      }
    });
  };

  MakanDrawers.prototype.loadAudioDevices = function () {
    var self = this;
    var devSel = this.el.querySelector('#mk-set-output-device');
    if (!devSel) return;
    if (this.engine && this.engine.backend && typeof this.engine.backend.enumerateDevices === 'function') {
      this.engine.backend.enumerateDevices().then(function (devices) {
        if (!devices || !devices.length) return;
        var current = (self.state && self.state.outputDevice) || devSel.value || 'default';
        var html = '<option value="default">Default Windows Audio Endpoint</option>';
        for (var i = 0; i < devices.length; i++) {
          var d = devices[i];
          var isDef = d.isDefault ? ' (Default)' : '';
          var sel = (d.id === current || (current === 'default' && d.isDefault)) ? ' selected' : '';
          html += '<option value="' + self._escapeAttr(d.id) + '"' + sel + '>' + self._escapeHtml(d.name + isDef) + '</option>';
        }
        devSel.innerHTML = html;
      }).catch(function (err) {
        console.warn('[MakanDrawers] enumerateDevices failed:', err);
      });
    }
  };

  MakanDrawers.prototype.updateAudioPathUi = function (pathData) {
    var self = this;
    var contentEl = this.el.querySelector('#mk-audio-path-content');
    if (!contentEl) return;

    var data = pathData || (this.engine && this.engine.getAudioPath ? this.engine.getAudioPath() : null);
    if (!data) {
      contentEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--mk-text-dim);font-size:12.5px;">Audio engine idle or no active track loaded.</div>';
      return;
    }

    var isNative = (data.outputMode && (data.outputMode.indexOf('WASAPI') !== -1 || data.outputMode === 'exclusive' || data.outputMode === 'shared'));
    var isExclusive = (data.outputMode === 'WASAPI Exclusive' || data.outputMode === 'exclusive');
    var isFallback = !!data.fallbackOccurred;
    var isResampled = !!data.resamplingActive;
    var isVolScaled = !!data.softwareVolumeActive;
    var hasDsp = !!data.dspEnabled;

    var html = '';

    // If Exclusive fallback occurred, show prominent alert
    if (isFallback) {
      html += '' +
        '<div class="mk-path-fallback-warning">' +
        '  <strong style="display:flex;align-items:center;gap:6px;">' +
        '    <span>⚠️</span> WASAPI Exclusive Fallback Occurred' +
        '  </strong>' +
        '  <span>' + self._escapeHtml(data.fallbackReason || 'Hardware rejected the requested sample rate/format.') + '</span>' +
        '  <span style="font-size:11px;color:rgba(var(--mk-fg-rgb),0.7);">MAKAN safely fell back to WASAPI Shared so playback continues uninterrupted.</span>' +
        '  <div style="display:flex;gap:6px;margin-top:4px;">' +
        '    <button type="button" class="mk-btn mk-btn-secondary" id="mk-path-retry-exclusive-btn" style="padding:2px 8px;font-size:11px;">Retry Exclusive</button>' +
        '    <button type="button" class="mk-btn mk-btn-secondary" id="mk-path-stay-shared-btn" style="padding:2px 8px;font-size:11px;">Use WASAPI Shared</button>' +
        '  </div>' +
        '</div>';
    }

    // Stage 1: Source
    var sourceBadges = '';
    if (data.sourceFormat && data.sourceFormat !== 'None') {
      sourceBadges += '<span class="mk-path-badge mk-path-badge-info">' + self._escapeHtml(data.sourceFormat) + '</span>';
    }
    if (data.decoder && data.decoder !== 'None') {
      sourceBadges += '<span class="mk-path-badge mk-path-badge-info">' + self._escapeHtml(data.decoder) + '</span>';
    }

    html += '' +
      '<div class="mk-path-step">' +
      '  <div class="mk-path-header">' +
      '    <span class="mk-path-title">1. Source Format &amp; Demux</span>' +
      '    <div class="mk-path-badges">' + sourceBadges + '</div>' +
      '  </div>' +
      '  <div class="mk-path-summary">' + self._escapeHtml(data.descriptionSource || (data.sourceFormat + ' · ' + (data.sourceSampleRate || 0) + ' Hz · ' + (data.sourceChannels === 2 ? 'Stereo' : 'Mono'))) + '</div>' +
      '  <div class="mk-path-specs">' +
      '    <span>Decoder: <strong>' + self._escapeHtml(data.decoder || 'FFmpeg') + '</strong></span> · ' +
      '    <span>Channels: <strong>' + (data.sourceChannels || 2) + '</strong></span> · ' +
      '    <span>Sample Rate: <strong>' + (data.sourceSampleRate || 0) + ' Hz</strong></span>' +
      (data.sourceBitRate ? (' · <span>Bitrate: <strong>' + Math.round(data.sourceBitRate / 1000) + ' kbps</strong></span>') : '') +
      (data.sourceBitDepth ? (' · <span>Bit Depth: <strong>' + data.sourceBitDepth + '-bit</strong></span>') : '') +
      '  </div>' +
      '</div>';

    // Arrow 1 -> 2
    html += '<div class="mk-path-arrow">▼</div>';

    // Stage 2: Processing & Signal Rules
    var procBadges = '';
    if (hasDsp) {
      procBadges += '<span class="mk-path-badge mk-path-badge-warn">DSP Active (MAKAN Sound / EQ)</span>';
    } else {
      procBadges += '<span class="mk-path-badge mk-path-badge-good">No DSP (Pure Audio)</span>';
    }

    if (isResampled) {
      procBadges += '<span class="mk-path-badge mk-path-badge-warn">Resampled</span>';
    } else {
      procBadges += '<span class="mk-path-badge mk-path-badge-good">No Resampling (Bit Transparent)</span>';
    }

    if (isVolScaled) {
      var pct = Math.round((data.gain !== undefined ? data.gain : 1.0) * 100);
      procBadges += '<span class="mk-path-badge mk-path-badge-warn">Software Volume (' + pct + '%)</span>';
    } else {
      procBadges += '<span class="mk-path-badge mk-path-badge-good">Unity Gain (1.0)</span>';
    }

    html += '' +
      '<div class="mk-path-step">' +
      '  <div class="mk-path-header">' +
      '    <span class="mk-path-title">2. Signal Processing &amp; Gain</span>' +
      '    <div class="mk-path-badges">' + procBadges + '</div>' +
      '  </div>' +
      '  <div class="mk-path-summary">' + self._escapeHtml(data.descriptionProcessing || 'Pure Direct Signal') + '</div>' +
      '  <div class="mk-path-specs">' +
      '    <span>DSP Nodes: <strong>' + (hasDsp ? 'Active (Web Audio)' : 'None (Bypassed)') + '</strong></span> · ' +
      '    <span>ReplayGain: <strong>' + (data.replayGainEnabled ? 'Active' : 'Disabled') + '</strong></span> · ' +
      '    <span>Volume: <strong>' + (isVolScaled ? ('Scaled (' + (data.gain !== undefined ? data.gain.toFixed(2) : '1.00') + ')') : 'Direct Unmodified (1.0)') + '</strong></span> · ' +
      '    <span>Resampling: <strong>' + (isResampled ? self._escapeHtml(data.resamplingRatio || 'Active') : 'Bypassed (1:1 Native)') + '</strong></span>' +
      '  </div>' +
      '</div>';

    // Arrow 2 -> 3
    html += '<div class="mk-path-arrow">▼</div>';

    // Stage 3: Hardware Output
    var outBadges = '';
    if (isExclusive && !isFallback) {
      outBadges += '<span class="mk-path-badge mk-path-badge-good">WASAPI Exclusive</span>';
    } else if (isFallback) {
      outBadges += '<span class="mk-path-badge mk-path-badge-warn">WASAPI Shared (Fallback)</span>';
    } else if (isNative) {
      outBadges += '<span class="mk-path-badge mk-path-badge-info">WASAPI Shared</span>';
    } else {
      outBadges += '<span class="mk-path-badge mk-path-badge-info">Web Audio Shared</span>';
    }

    html += '' +
      '<div class="mk-path-step">' +
      '  <div class="mk-path-header">' +
      '    <span class="mk-path-title">3. Hardware Endpoint Delivery</span>' +
      '    <div class="mk-path-badges">' + outBadges + '</div>' +
      '  </div>' +
      '  <div class="mk-path-summary">' + self._escapeHtml(data.descriptionOutput || 'Audio Endpoint') + '</div>' +
      '  <div class="mk-path-specs">' +
      '    <span>Endpoint: <strong>' + self._escapeHtml(data.selectedDevice || 'Default Endpoint') + '</strong></span> · ' +
      '    <span>Hardware Rate: <strong>' + (data.outputSampleRate || 0) + ' Hz</strong></span> · ' +
      '    <span>Format: <strong>' + self._escapeHtml(data.outputFormat || 'float32') + '</strong></span> · ' +
      '    <span>Mode: <strong>' + self._escapeHtml(data.outputMode || 'Shared') + '</strong></span>' +
      '  </div>' +
      (data.requestedMode ? (
        '  <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(var(--mk-fg-rgb),0.06);font-size:11px;color:var(--mk-text-dim);display:flex;flex-direction:column;gap:3px;">' +
        '    <div>Requested: <strong style="color:var(--mk-text);">' + self._escapeHtml(data.requestedMode) + '</strong> (' + (data.requestedSampleRate || 0) + ' Hz / ' + self._escapeHtml(data.requestedFormat || 'float32') + ' / ' + (data.requestedChannels || 2) + ' ch)</div>' +
        '    <div>Accepted: <strong style="color:var(--mk-accent-cyan);">' + self._escapeHtml(data.acceptedMode || data.outputMode || 'shared') + '</strong> (' + (data.acceptedSampleRate || data.outputSampleRate || 0) + ' Hz / ' + self._escapeHtml(data.acceptedFormat || 'float32') + ' / ' + self._escapeHtml(data.channelLayout || 'Stereo') + ')</div>' +
        '    <div>Negotiation Result: <strong>' + self._escapeHtml(data.miniaudioResultName || 'MA_SUCCESS') + '</strong> · HRESULT: <code>' + self._escapeHtml(data.windowsHresultHex || '0x00000000 (S_OK)') + '</code></div>' +
        '    <div>Buffer: <strong>' + (data.ringCapacityFrames || 65536) + ' frames</strong> · Underruns: <strong style="color:' + ((data.audioUnderruns && data.audioUnderruns > 0) ? '#ef4444' : '#10b981') + ';">' + (data.audioUnderruns || 0) + '</strong> · Dropouts: <strong>' + (data.audioDropouts || 0) + '</strong></div>' +
        '  </div>'
      ) : '') +
      '</div>';

    contentEl.innerHTML = html;

    // Bind retry / stay buttons if present
    var retryBtn = contentEl.querySelector('#mk-path-retry-exclusive-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        if (self.engine && self.engine.setOutputMode) {
          self.engine.setOutputMode('exclusive').then(function () {
            self.updateAudioPathUi();
          });
        }
      });
    }

    var stayBtn = contentEl.querySelector('#mk-path-stay-shared-btn');
    if (stayBtn) {
      stayBtn.addEventListener('click', function () {
        self.state.outputMode = 'shared';
        if (self.engine && self.engine.setOutputMode) {
          self.engine.setOutputMode('shared').then(function () {
            self.updateAudioPathUi();
          });
        }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ outputMode: 'shared' });
        }
      });
    }
  };

  window.MakanDrawers = MakanDrawers;
})();
