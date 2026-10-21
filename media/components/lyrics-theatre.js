/*
 * media/components/lyrics-theatre.js - Right Lyrics Theatre component for MAKAN Music Player.
 * Features:
 * - Tabs: Original, Translation, Bilingual
 * - Multi-format Non-AI parser (LRC, enhanced LRC, SRT, VTT, ASS)
 * - Click-to-seek on any lyric line
 * - Persian/Arabic RTL detection and proper bidirectional layout
 * - Real sound-reactive lyric coloring
 * - Live sync adjust ([-] / [+]) with per-track persistence
 * - Lyrics import and export (LRC, SRT, VTT, ASS)
 * - "Make lyrics" button: Whisper makes timed lyrics from the audio (v1.9)
 * - Never populates demonstration lyrics
 */
(function () {
  'use strict';

  function MakanLyricsTheatre(container, state, engine) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.el = null;
    this.scrollEl = null;

    this.render();
    this.applyStyles();
    this.bindEvents();
    this.bindAi();
    this.bindTr();
    this.updateLyrics();
    this.startReactiveLoop();
  }

  MakanLyricsTheatre.prototype.applyStyles = function () {
    if (!this.el) return;
    var st = this.state;
    var targets = [this.el];
    if (this.view) targets.push(this.view);
    function setVar(name, value) { targets.forEach(function (t) { t.style.setProperty(name, value); }); }
    function clearVar(name) { targets.forEach(function (t) { t.style.removeProperty(name); }); }
    // State classes (colour mode, effect) live on the element that holds the lyric lines, once only
    var lineHolder = this.view || this.el;
    function toggleCls(name, on) { lineHolder.classList.toggle(name, !!on); if (lineHolder !== targets[0]) targets[0].classList.remove(name); }
    var listEl = this.scrollEl ? this.scrollEl.querySelector('#mk-lyrics-list') : null;

    // 1. Font Family
    var font = st.lyricsFontFamily || 'Vazirmatn, Segoe UI, sans-serif';
    setVar('--mk-lyrics-font', font);
    if (listEl) listEl.style.fontFamily = font;

    // 2. Font sizes
    setVar('--mk-lyrics-orig-size', (st.lyricsOriginalSize || 20) + 'px');
    setVar('--mk-lyrics-trans-size', (st.lyricsTranslationSize || 16) + 'px');

    // 3. Colors
    // The default colours follow the colour theme (dark or light); only a colour the person picked is forced.
    function setOrClear(name, value, def) { if (!value || value === def) clearVar(name); else setVar(name, value); }
    setOrClear('--mk-lyrics-inactive-color', st.lyricsInactiveColor, 'rgba(255, 255, 255, 0.42)');
    setOrClear('--mk-lyrics-active-color', st.lyricsActiveColor, '#ffffff');
    setOrClear('--mk-lyrics-trans-color', st.lyricsTranslationColor, '#cbd5e1');

    // 3b. Moving colour styles (rainbow and patterns) for the active line, translation font
    var S = window.MakanLyricsStyle;
    var grad = S ? S.gradientCss(st.lyricsColorStyle || 'solid') : null;
    toggleCls('mk-lyrics-gradmode', !!grad);
    if (grad) {
      setVar('--mk-lyrics-grad', grad);
      setVar('--mk-lyrics-flow-speed', (st.lyricsColorSpeed || 8) + 's');
      setVar('--mk-lyrics-tile', S.TILE_PX + 'px');
    }
    setVar('--mk-lyrics-trans-font', st.lyricsTranslationFont || 'Vazirmatn, Segoe UI, sans-serif');

    // 4. Background styling
    var bg = st.lyricsBackground || 'glass';
    var wash = this.view ? this.view.closest('.mk-player-stage') : null;
    wash = wash ? wash.querySelector('#mk-stage-bgwash') : null;
    var bgTarget = wash || this.view || this.el; // the background colours the whole middle panel, not a box around the text
    var BG_CLASSES = ['mk-lyric-bg-glass', 'mk-lyric-bg-dark', 'mk-lyric-bg-transparent', 'mk-lyric-bg-gradient', 'mk-lyric-bg-card', 'mk-lyric-bg-aurora', 'mk-lyric-bg-sunset', 'mk-lyric-bg-ocean', 'mk-lyric-bg-violet'];
    if (this.view) { this.el.classList.remove.apply(this.el.classList, BG_CLASSES); this.view.classList.remove.apply(this.view.classList, BG_CLASSES); }
    bgTarget.classList.remove.apply(bgTarget.classList, BG_CLASSES);
    bgTarget.classList.add('mk-lyric-bg-' + bg);

    // 5. Lyric effect (CSS only; off when the system asks for reduced motion)
    var fx = st.lyricsEffect || 'none';
    ['none', 'glow', 'wave', 'particle'].forEach(function (n) { toggleCls('mk-fx-' + n, n === fx); });

    // 5. Glow intensity
    setVar('--mk-lyrics-glow-factor', st.lyricsGlowIntensity !== undefined ? st.lyricsGlowIntensity : 1.0);

    // Update active tab button + the "show both languages" switch
    var mode = st.lyricMode || 'bilingual';
    var tabBtns = this.el.querySelectorAll('.mk-tab-btn');
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].classList.toggle('mk-tab-active', tabBtns[i].getAttribute('data-mode') === mode);
    }
    var both = this.el.querySelector('#mk-sw-both');
    if (both) { var onB = (mode === 'bilingual' || mode === 'split'); both.classList.toggle('mk-on', onB); both.setAttribute('aria-checked', onB ? 'true' : 'false'); }
  };

  /* Put the lyric lines in the middle panel (under the cover and title) instead of the right panel */
  MakanLyricsTheatre.prototype.mountLyricsInto = function (mount) {
    if (!mount || !this.scrollEl) return;
    var view = document.createElement('div');
    view.className = 'mk-lyrics-stage-view';
    view.id = 'mk-lyrics-stage-view';
    view.appendChild(this.scrollEl);
    mount.appendChild(view);
    this.view = view;
    this.applyStyles();
  };

  MakanLyricsTheatre.prototype.render = function () {
    var icons = window.MakanIcons;
    var state = this.state;

    var html = '' +
      '<section class="mk-lyrics-theatre mk-ptab-lyrics" id="mk-lyrics-theatre">' +
      '  <!-- Hidden lyrics file picker -->' +
      '  <input type="file" id="mk-lyric-file-picker" accept=".lrc,.srt,.vtt,.ass,.ssa,.txt" hidden>' +
      '' +
      '  <!-- Top Controls: Mode Tabs + Style Buttons -->' +
      '  <div class="mk-lyrics-header">' +
      '    <div class="mk-panel-tabs" role="tablist" aria-label="Lyrics panel">' +
      '      <button type="button" class="mk-ptab mk-ptab-active" data-panel="lyrics" role="tab">Lyrics</button>' +
      '      <button type="button" class="mk-ptab" data-panel="translation" role="tab">Translation</button>' +
      '      <button type="button" class="mk-ptab" data-panel="ai" role="tab">AI</button>' +
      '      <button type="button" class="mk-ptab" data-panel="theme" role="tab">Theme</button>' +
      '    </div>' +
      '    <div class="mk-lyrics-tools">' +
      '      <button type="button" class="mk-icon-btn mk-lyric-tool-btn" id="mk-lyric-import-btn" title="Import Lyrics File (.lrc, .srt, .vtt, .ass)">' +
      '        ' + icons.plus() +
      '      </button>' +
      '      <button type="button" class="mk-icon-btn mk-lyric-tool-btn" id="mk-lyric-font-btn" title="Subtitle Typography">' +
      '        ' + icons.textStyle() +
      '      </button>' +
      '      <button type="button" class="mk-icon-btn mk-lyric-tool-btn" id="mk-lyric-theme-btn" title="Sound-Reactive Theme">' +
      '        ' + icons.palette() +
      '      </button>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- Scrollable Lyrics Container -->' +
      '  <div class="mk-lyrics-scroll" id="mk-lyrics-scroll" role="region" aria-label="Lyrics Display">' +
      '    <div class="mk-lyrics-list" id="mk-lyrics-list"></div>' +
      '  </div>' +
      '' +
      '  <!-- Right panel body: AI, Translation, Effects, Color, Background (tabs show one part or all) -->' +
      '  <div class="mk-rp-body" id="mk-rp-body">' +
      '    <div class="mk-sec" data-sec="ai">' +
      '      <div class="mk-panel-h">AI Model (Transcribe)</div>' +
      '      <select class="mk-ai-sel mk-rp-sel" id="mk-ai-model-sel" title="Speech model (bigger = better but slower; downloaded once)">' + this._aiModelOptions() + '</select>' +
      '      <select class="mk-ai-sel mk-rp-sel mk-rp-sel-small" id="mk-ai-lang-sel" title="Language sung in the song">' + this._aiLangOptions() + '</select>' +
      '      <button type="button" class="mk-ai-btn mk-rp-main" id="mk-ai-transcribe-btn" title="Make lyrics for this song with AI (Whisper) and save them next to the song">' +
      '        ' + icons.sparkle() +
      '        <span id="mk-ai-btn-text">Make lyrics</span>' +
      '      </button>' +
      '      <button type="button" class="mk-panel-btn" data-go="models">Download or manage AI models</button>' +
      '    </div>' +
      '    <div class="mk-sec" data-sec="translation">' +
      '      <div class="mk-panel-h">Translation Language</div>' +
      '      <select class="mk-ai-sel mk-rp-sel" id="mk-tr-lang-sel" title="Translate the lyrics into this language">' + this._trLangOptions() + '</select>' +
      '      <button type="button" class="mk-ai-btn mk-rp-main mk-rp-second" id="mk-tr-btn" title="Translate the lyrics (settings: Settings, Lyrics)">' +
      '        <span id="mk-tr-btn-text">Translate</span>' +
      '      </button>' +
      '      <div class="mk-rp-toggle"><span>Show both languages</span><button type="button" class="mk-switch" id="mk-sw-both" role="switch" aria-checked="false"></button></div>' +
      '      <div class="mk-rp-toggle"><span>Auto translate</span><button type="button" class="mk-switch" id="mk-sw-auto" role="switch" aria-checked="false" title="Translate automatically when a song has lyrics but no translation"></button></div>' +
      '      <div class="mk-rp-toggle"><span>Word highlight and tap a word</span><button type="button" class="mk-switch" id="mk-sw-words" role="switch" aria-checked="true" title="Colour the words as they are sung (estimated) and tap a word to translate it"></button></div>' +
      '      <div class="mk-panel-h mk-rp-modehead">Show lyrics as</div>' +
      '    <div class="mk-lyrics-tabs mk-mode-seg">' +
      '      <button type="button" class="mk-tab-btn' + (state.lyricMode === 'original' ? ' mk-tab-active' : '') + '" data-mode="original">Original</button>' +
      '      <button type="button" class="mk-tab-btn' + (state.lyricMode === 'translation' ? ' mk-tab-active' : '') + '" data-mode="translation">Translation</button>' +
      '      <button type="button" class="mk-tab-btn' + (state.lyricMode === 'bilingual' ? ' mk-tab-active' : '') + '" data-mode="bilingual">Bilingual</button>' +
      '      <button type="button" class="mk-tab-btn' + (state.lyricMode === 'split' ? ' mk-tab-active' : '') + '" data-mode="split" title="Original and translation side by side">Split</button>' +
      '    </div>' +
      '      <button type="button" class="mk-panel-btn" data-go="tr-settings">Translator settings</button>' +
      '    </div>' +
      '    <div class="mk-sec" data-sec="theme">' +
      '      <div class="mk-panel-h">Lyrics Effects</div>' +
      '      <div class="mk-fx-grid" id="mk-theme-effects"></div>' +
      '      <div class="mk-panel-h">Color</div>' +
      '      <div class="mk-dot-row" id="mk-theme-colors"></div>' +
      '      <div class="mk-panel-h">Background</div>' +
      '      <div class="mk-bg-row" id="mk-theme-bgs"></div>' +
      '      <div class="mk-panel-h">Spectrum bars (moving colours at the bottom)</div>' +
      '      <div class="mk-vis-styles" id="mk-theme-vis-style"></div>' +
      '      <div class="mk-dot-row" id="mk-theme-vis-colors"></div>' +
      '      <button type="button" class="mk-panel-btn" data-go="style">Fonts, sizes and more style options</button>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <!-- Sync adjustment -->' +
      '  <div class="mk-lyrics-footer">' +
      '    <div class="mk-sync-box">' +
      '      <span class="mk-sync-lbl">Sync Adjust:</span>' +
      '      <button type="button" class="mk-sync-btn" id="mk-sync-minus" title="Shift subtitles earlier (-0.1s)">' +
      '        ' + icons.minus() +
      '      </button>' +
      '      <span class="mk-sync-val" id="mk-sync-val">' + (state.syncOffset >= 0 ? '+' : '') + state.syncOffset.toFixed(1) + 's</span>' +
      '      <button type="button" class="mk-sync-btn" id="mk-sync-plus" title="Shift subtitles later (+0.1s)">' +
      '        ' + icons.plus() +
      '      </button>' +
      '    </div>' +
      '  </div>' +
      '</section>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;
    this.scrollEl = this.el.querySelector('#mk-lyrics-scroll');
  };

  /* ---------------- AI: make lyrics from the audio (v1.9) ---------------- */

  MakanLyricsTheatre.prototype._aiModelOptions = function () {
    var H = window.MakanLyricsAIHelpers;
    var ai = window.MakanLyricsAI ? (this.ai = this.ai || window.MakanLyricsAI.getShared()) : null;
    var cur = ai ? ai.getPrefs().model : 'small';
    var out = '';
    var list = H ? H.MODELS : [];
    for (var i = 0; i < list.length; i++) out += '<option value="' + list[i].key + '" title="' + list[i].note + '"' + (list[i].key === cur ? ' selected' : '') + '>' + list[i].label + '</option>';
    return out;
  };

  MakanLyricsTheatre.prototype._aiLangOptions = function () {
    var H = window.MakanLyricsAIHelpers;
    var ai = window.MakanLyricsAI ? (this.ai = this.ai || window.MakanLyricsAI.getShared()) : null;
    var cur = ai ? ai.getPrefs().lang : '';
    var out = '';
    var list = H ? H.LANGS : [];
    for (var i = 0; i < list.length; i++) out += '<option value="' + list[i].code + '"' + (list[i].code === cur ? ' selected' : '') + '>' + list[i].label + '</option>';
    return out;
  };

  /* ---------------- translate lyrics ---------------- */

  MakanLyricsTheatre.prototype._trLangOptions = function () {
    var H = window.MakanLyricsTranslateHelpers;
    var tr = window.MakanLyricsTranslate ? window.MakanLyricsTranslate.getShared() : null;
    var cur = tr ? tr.getPrefs().tgt : 'fa';
    var out = '';
    var list = H ? H.TARGETS : [];
    for (var i = 0; i < list.length; i++) out += '<option value="' + list[i] + '"' + (list[i] === cur ? ' selected' : '') + '>To ' + H.targetName(list[i]) + '</option>';
    return out;
  };

  MakanLyricsTheatre.prototype._trSetBusy = function (text, busy) {
    var btn = this.el ? this.el.querySelector('#mk-tr-btn') : null;
    var txt = this.el ? this.el.querySelector('#mk-tr-btn-text') : null;
    var sel = this.el ? this.el.querySelector('#mk-tr-lang-sel') : null;
    if (txt) txt.textContent = text;
    if (btn) { btn.classList.toggle('mk-ai-busy', !!busy); btn.title = busy ? 'Click to cancel' : 'Translate the lyrics (settings: Settings, Lyrics)'; }
    if (sel) sel.disabled = !!busy;
  };

  MakanLyricsTheatre.prototype._trErrorText = function (err) {
    var code = err && err.code;
    if (code === 'nolyrics') return 'This song has no lyrics yet. Load a lyrics file or press Make lyrics first.';
    if (code === 'engine') return 'The translation engine files are missing.';
    return (err && err.message) ? err.message : 'Translation failed.';
  };

  MakanLyricsTheatre.prototype.bindTr = function () {
    var self = this;
    if (!window.MakanLyricsTranslate) return;
    var tr = window.MakanLyricsTranslate.getShared();
    var btn = this.el.querySelector('#mk-tr-btn');
    var sel = this.el.querySelector('#mk-tr-lang-sel');
    if (sel) sel.addEventListener('change', function () { tr.setPrefs({ tgt: sel.value }); });
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (tr.isBusy()) { tr.cancel(); return; }
      var track = self.state.currentTrack;
      if (!track || !track.id) { self._aiToast('Select a song first.', 'error'); return; }
      if (!track.cues || !track.cues.length) { self._aiToast(self._trErrorText({ code: 'nolyrics' }), 'error'); return; }
      var prefs = tr.getPrefs();
      self._trSetBusy('Starting…', true);
      tr.translate(track.cues, {
        tgt: prefs.tgt,
        onProgress: function (p) { self._trSetBusy('Translating… ' + (typeof p.fraction === 'number' ? Math.round(p.fraction * 100) + '%' : ''), true); },
        onInfo: function (info) { if (info && info.waitingMs > 0) self._trSetBusy('Waiting for translator…', true); }
      }).then(function (r) {
        self._trSetBusy('Translate', false);
        track.cues = r.cues;
        var H = window.MakanLyricsTranslateHelpers;
        if (self.state.lyricMode === 'original') self.state.setLyricMode('bilingual');
        if (self.state.currentTrack && self.state.currentTrack.id === track.id) self.updateLyrics();
        var used = Object.keys(r.engines || {}).map(function (k) { return k === 'google' ? 'Google Translate' : k === 'mymemory' ? 'MyMemory' : k === 'ollama' ? 'Ollama' : k; }).join(', ');
        self._aiToast('Translated to ' + H.targetName(r.tgt) + (used ? ' (' + used + ')' : '') + '.', 'info');
        // Only songs the player knows the file of can be saved next to the song (not drag and drop songs).
        var lrcOk = !!track.path && !track.blobUrl && (!track.lyrics_path || /\.lrc$/i.test(track.lyrics_path));
        if (!track.path || track.blobUrl) {
          if (!self._trSaveHinted) { self._trSaveHinted = true; self._aiToast('To keep translations next to the song, add it with Open Folder instead of drag and drop.', 'info'); }
        } else if (lrcOk && window.confirm('Save the translation into this song\'s lyrics file (.lrc)? The original lines are kept.')) {
          tr.saveTranslation(track, r.cues).then(function () {
            self._aiToast('Translation saved in the lyrics file.', 'info');
          }).catch(function (e) {
            self._aiToast('The translation is shown but could not be saved: ' + ((e && e.message) || 'unknown reason') + '.', 'error');
          });
        }
      }).catch(function (err) {
        self._trSetBusy('Translate', false);
        if (err && err.code === 'aborted') { self._aiToast('Cancelled.', 'info'); return; }
        self._aiToast(self._trErrorText(err), 'error');
      });
    });
  };

  MakanLyricsTheatre.prototype._aiToast = function (message, type) {
    if (this.state && typeof this.state.emit === 'function') this.state.emit('toast', { message: message, type: type || 'info' });
  };

  MakanLyricsTheatre.prototype._aiSetBusy = function (text, busy) {
    var btn = this.el ? this.el.querySelector('#mk-ai-transcribe-btn') : null;
    var txt = this.el ? this.el.querySelector('#mk-ai-btn-text') : null;
    if (txt) txt.textContent = text;
    if (btn) {
      btn.classList.toggle('mk-ai-busy', !!busy);
      btn.title = busy ? 'Click to cancel' : 'Make lyrics for this song with AI (Whisper) and save them next to the song';
    }
    var sels = this.el ? this.el.querySelectorAll('.mk-ai-sel') : [];
    for (var i = 0; i < sels.length; i++) sels[i].disabled = !!busy;
  };

  MakanLyricsTheatre.prototype._aiProgressText = function (p) {
    var pct = (typeof p.fraction === 'number') ? Math.round(p.fraction * 100) + '%' : '';
    if (p.stage === 'read' || p.stage === 'decode') return 'Reading song… ' + pct;
    if (p.stage === 'load') return pct ? 'Loading model… ' + pct : 'Loading model…';
    if (p.stage === 'listen') return 'Listening… ' + pct;
    if (p.stage === 'save') return 'Saving…';
    return 'Working…';
  };

  MakanLyricsTheatre.prototype._aiErrorText = function (err) {
    var code = err && err.code;
    if (code === 'engine') return 'The speech engine could not start. The first time it needs internet to download. Check your connection and try again.';
    if (code === 'memory') return 'The speech engine stopped while working. This is usually the engine or graphics card, not your PC memory. Try another model, or restart the app and try again. Details: ' + String((err && err.message) || 'none').slice(0, 220);
    if (code === 'decode') return 'Could not read this song file: ' + ((err && err.message) || 'unknown reason') + '.';
    if (code === 'nospeech') return 'No words were found in this song (it may be instrumental).';
    if (code === 'exists') return 'A lyrics file for this song already exists.';
    if (code === 'save') return 'The lyrics were made but could not be saved next to the song: ' + ((err && err.message) || 'unknown reason') + '.';
    if (code === 'busy') return 'Lyrics are already being made for another song.';
    return 'Making lyrics failed. ' + ((err && err.message) ? err.message : '');
  };

  MakanLyricsTheatre.prototype.bindAi = function () {
    var self = this;
    if (!window.MakanLyricsAI) return;
    var ai = this.ai = this.ai || window.MakanLyricsAI.getShared();
    var btn = this.el.querySelector('#mk-ai-transcribe-btn');
    var modelSel = this.el.querySelector('#mk-ai-model-sel');
    var langSel = this.el.querySelector('#mk-ai-lang-sel');
    if (modelSel) modelSel.addEventListener('change', function () { ai.setPrefs({ model: modelSel.value }); });
    if (langSel) langSel.addEventListener('change', function () { ai.setPrefs({ lang: langSel.value }); });
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (ai.isBusy()) { ai.cancel(); return; }
      var track = self.state.currentTrack;
      if (!track || !track.id) { self._aiToast('Select a song first.', 'error'); return; }
      var hasLyrics = !!((track.cues && track.cues.length) || track.lyrics_path);
      if (hasLyrics && !window.confirm('This song already has lyrics. Replace them with AI lyrics?')) return;
      var prefs = ai.getPrefs();
      self._aiSetBusy('Starting…', true);
      ai.generate(track, {
        model: prefs.model, lang: prefs.lang, overwrite: hasLyrics,
        onProgress: function (p) { self._aiSetBusy(self._aiProgressText(p), true); }
      }).then(function (r) {
        track.lyrics_path = r.path || track.lyrics_path;
        var parsed = window.MakanLyricsParser ? window.MakanLyricsParser.parse(r.lrc, 'lyrics.lrc') : { cues: r.cues };
        track.cues = parsed.cues || r.cues;
        track.cuesLoaded = true;
        self._aiSetBusy('Make lyrics', false);
        if (self.state.currentTrack && self.state.currentTrack.id === track.id) self.updateLyrics();
        self._aiToast('Lyrics ready: ' + track.cues.length + ' lines saved next to the song' + (r.lang ? ', language: ' + r.lang : '') + (r.device ? ' (' + (r.device === 'webgpu' ? 'graphics card' : 'CPU') + ')' : '') + '.', 'info');
      }).catch(function (err) {
        self._aiSetBusy('Make lyrics', false);
        if (err && err.code === 'aborted') { self._aiToast('Cancelled.', 'info'); return; }
        if (err && err.code === 'save' && err.result) {
          /* the work is not lost: show the lyrics now and give the .lrc as a normal download */
          track.cues = err.result.cues; track.cuesLoaded = true;
          if (self.state.currentTrack && self.state.currentTrack.id === track.id) self.updateLyrics();
          try {
            var url = URL.createObjectURL(new Blob(['\uFEFF' + err.result.lrc], { type: 'text/plain;charset=utf-8' }));
            var a = document.createElement('a');
            a.href = url; a.download = err.result.name || 'lyrics.lrc';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
          } catch (e) { /* download is only a bonus */ }
          self._aiToast(self._aiErrorText(err) + ' The lyrics are shown now and a copy was downloaded.', 'error');
          return;
        }
        self._aiToast(self._aiErrorText(err), 'error');
      });
    });
  };

  MakanLyricsTheatre.prototype.loadSidecarLyrics = function (track) {
    if (!track || track.cuesLoaded) return;
    track.cuesLoaded = true;

    var self = this;
    if (track.cues && track.cues.length > 0) {
      self.updateLyrics();
      return;
    }

    if (track.id) {
      fetch('/api/lyrics?id=' + encodeURIComponent(track.id))
        .then(function (res) {
          if (!res.ok) return null;
          return res.text();
        })
        .then(function (text) {
          if (text && window.MakanLyricsParser) {
            var parsed = window.MakanLyricsParser.parse(text, track.lyrics_path || 'lyrics.lrc');
            track.cues = parsed.cues || [];
            self.updateLyrics();
          }
        })
        .catch(function () {});
    }
  };

  MakanLyricsTheatre.prototype.updateLyrics = function () {
    var track = this.state.currentTrack;
    var listEl = this.scrollEl ? this.scrollEl.querySelector('#mk-lyrics-list') : null;
    if (!listEl) return;

    if (!track) {
      listEl.innerHTML = '<div class="mk-lyric-empty"><p>No track selected.</p></div>';
      return;
    }

    if (!track.cues || !track.cues.length) {
      this.loadSidecarLyrics(track);
      listEl.innerHTML = '' +
        '<div class="mk-lyric-empty">' +
        '  <p>No synchronized lyrics available.</p>' +
        '  <p class="mk-lyric-hint">Place an .lrc, .srt, or .vtt file beside your music file, or click + above to import.</p>' +
        '</div>';
      return;
    }

    var activeIdx = this.state.currentLyricIndex;
    var mode = this.state.lyricMode;
    var cues = track.cues;
    // No translation yet? Show the original lines instead of empty boxes.
    var hasTrans = false;
    for (var q = 0; q < cues.length; q++) { if (cues[q].t) { hasTrans = true; break; } }
    if (!hasTrans && mode !== 'split') mode = 'original';
    var transOnly = (mode === 'translation');
    // Auto translate: once per song, only when the lyrics exist and have no translation yet
    if (!hasTrans && this._autoTranslateOn && this._autoTranslateOn() && this._autoTrFor !== track.id) {
      this._autoTrFor = track.id;
      var self2 = this;
      setTimeout(function () {
        var tb = self2.el && self2.el.querySelector('#mk-tr-btn');
        if (tb && !tb.classList.contains('mk-ai-busy') && self2.state.currentTrack && self2.state.currentTrack.id === track.id) tb.click();
      }, 400);
    }

    var html = '';
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      var isActive = (i === activeIdx);
      var itemCls = 'mk-lyric-item' + (isActive ? ' mk-lyric-active' : '');

      var isSplit = (mode === 'split');
      if (isSplit) itemCls += ' mk-lyric-split';
      html += '<div class="' + itemCls + '" style="--mk-li:' + (i % 8) + '" data-cue-index="' + i + '" data-start="' + c.s + '" data-end="' + c.e + '">';

      if (mode === 'original' || mode === 'bilingual' || isSplit || (transOnly && !c.t)) {
        html += '<div class="mk-lyric-orig">' + this._origHtml(c.o || '') + '</div>';
      }

      if ((mode === 'translation' || mode === 'bilingual' || isSplit) && (c.t || isSplit)) {
        var isRtl = c.isRtl || (window.MakanLyricsParser && window.MakanLyricsParser.isRTL(c.t));
        var rtlAttr = isRtl ? ' dir="rtl"' : ' dir="ltr"';
        var rtlCls = isRtl ? ' mk-rtl-text' : ' mk-ltr-text';
        html += '<div class="mk-lyric-trans' + rtlCls + '"' + rtlAttr + '>' + this._escapeHtml(c.t || '') + '</div>';
      }

      html += '</div>';
    }

    listEl.innerHTML = html;
    this.scrollToActive();
  };

  /* ---------------- word highlight and tap a word ---------------- */
  MakanLyricsTheatre.prototype._wordsOn = function () {
    try { return window.localStorage.getItem('makan.lyricWords') !== '0'; } catch (e) { return true; }
  };

  MakanLyricsTheatre.prototype._origHtml = function (text) {
    var WD = window.MakanLyricsWords;
    if (WD && this._wordsOn()) return WD.wordsHtml(text);
    return this._escapeHtml(text);
  };

  /* colours the words of the playing line (estimated from the line's timing) */
  MakanLyricsTheatre.prototype._paintWords = function () {
    var WD = window.MakanLyricsWords;
    if (!WD || !this.scrollEl || !this._wordsOn()) return;
    var item = this.scrollEl.querySelector('.mk-lyric-active');
    if (!item) return;
    var spans = item.querySelectorAll('.mk-lyric-orig .mk-w');
    if (!spans.length) return;
    if (!item._wt) {
      var words = [];
      for (var i = 0; i < spans.length; i++) words.push(spans[i].textContent);
      item._wt = WD.timeline(words, parseFloat(item.getAttribute('data-start')), parseFloat(item.getAttribute('data-end')));
    }
    var idx = WD.activeIndex(item._wt, this.state.currentTime - (this.state.syncOffset || 0));
    if (item._wi === idx) return;
    item._wi = idx;
    for (var k = 0; k < spans.length; k++) {
      spans[k].classList.toggle('mk-w-done', k <= idx);
      spans[k].classList.toggle('mk-w-now', k === idx);
    }
  };

  MakanLyricsTheatre.prototype._closeWordPop = function () {
    var p = document.getElementById('mk-word-pop');
    if (p) p.parentNode.removeChild(p);
  };

  /* tap a word: small box with its translation (and the line's), "Play from here" keeps the old click-to-seek */
  MakanLyricsTheatre.prototype._openWordPop = function (span) {
    var self = this;
    var WD = window.MakanLyricsWords;
    var item = span.closest('.mk-lyric-item');
    if (!WD || !item || !this.el) return;
    var word = WD.cleanWord(span.textContent);
    if (!word) return;
    var track = this.state.currentTrack;
    var cue = track && track.cues ? track.cues[parseInt(item.getAttribute('data-cue-index'), 10)] : null;
    var start = parseFloat(item.getAttribute('data-start'));
    this._closeWordPop();
    var pop = document.createElement('div');
    pop.id = 'mk-word-pop';
    pop.className = 'mk-word-pop';
    pop.innerHTML = '<div class="mk-wp-word">' + WD.escapeHtml(word) + '</div>' +
      '<div class="mk-wp-tr" id="mk-wp-tr">Translating…</div>' +
      '<div class="mk-wp-line" id="mk-wp-line"></div>' +
      '<div class="mk-wp-row"><button type="button" class="mk-btn mk-btn-secondary" id="mk-wp-play">Play from here</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" id="mk-wp-save" title="Keep this word in Study Words">Save word</button>' +
      '<button type="button" class="mk-btn mk-btn-secondary" id="mk-wp-close">Close</button></div>';
    document.body.appendChild(pop);
    var r = span.getBoundingClientRect();
    var w = pop.offsetWidth || 260;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    if (r.bottom + 190 > window.innerHeight) { pop.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px'; }
    else { pop.style.top = (r.bottom + 8) + 'px'; }
    pop.querySelector('#mk-wp-close').addEventListener('click', function () { self._closeWordPop(); });
    pop.querySelector('#mk-wp-play').addEventListener('click', function () {
      if (!isNaN(start)) { self.engine.seek(start + (self.state.syncOffset || 0)); self.engine.play(); }
      self._closeWordPop();
    });
    var trEl = pop.querySelector('#mk-wp-tr');
    var lineEl = pop.querySelector('#mk-wp-line');
    pop.querySelector('#mk-wp-save').addEventListener('click', function () {
      var b = this, api = window.MakanDesktop, SW = window.MakanStudyWords;
      if (!(api && api.addStudyWord && SW)) { b.textContent = 'Desktop app only'; return; }
      var lang = '';
      try { lang = window.MakanLyricsTranslate.getShared().getPrefs().tgt || ''; } catch (e) { lang = ''; }
      var entry = SW.cleanEntry({ word: word, lang: lang, translation: pop._tr || '', line: cue ? cue.o : '', title: track ? track.title : '', artist: track ? track.artist : '' });
      b.disabled = true;
      api.addStudyWord(entry).then(function (ok) { b.textContent = ok ? 'Saved' : 'Not saved'; b.disabled = !!ok; if (!ok) b.disabled = false; }).catch(function () { b.textContent = 'Not saved'; b.disabled = false; });
    });
    if (cue && cue.t) lineEl.textContent = cue.t;
    if (!window.MakanLyricsTranslate) { trEl.textContent = 'The translator is not available.'; return; }
    var tr = window.MakanLyricsTranslate.getShared();
    var tgt = tr.getPrefs().tgt;
    this._wordCache = this._wordCache || {};
    var key = tgt + '|' + word.toLowerCase();
    if (this._wordCache[key]) { pop._tr = this._wordCache[key]; trEl.textContent = pop._tr; return; }
    if (tr.isBusy()) { trEl.textContent = 'A translation is running. Tap the word again in a moment.'; return; }
    tr.translate([{ s: 0, e: 1, o: word, t: '' }], { tgt: tgt }).then(function (res) {
      var out = res && res.cues && res.cues[0] && res.cues[0].t ? String(res.cues[0].t) : '';
      if (out) { self._wordCache[key] = out; pop._tr = out; }
      if (document.body.contains(trEl)) trEl.textContent = out || 'No translation found.';
    }).catch(function (err) {
      if (document.body.contains(trEl)) trEl.textContent = self._trErrorText(err);
    });
  };

  MakanLyricsTheatre.prototype._escapeHtml = function (str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  MakanLyricsTheatre.prototype.scrollToActive = function () {
    if (!this.scrollEl) return;
    var activeEl = this.scrollEl.querySelector('.mk-lyric-active');
    if (!activeEl) return;

    var targetScroll = activeEl.offsetTop - (this.scrollEl.clientHeight / 2) + (activeEl.clientHeight / 2);
    this.scrollEl.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: this.state.reducedMotion ? 'auto' : 'smooth'
    });
  };

  MakanLyricsTheatre.prototype.startReactiveLoop = function () {
    var self = this;
    var baseHue = 0;
    function loop() {
      if (self.state.soundReactiveLyrics && self.state.isPlaying && !self.state.reducedMotion) {
        var energy = self.state.audioEnergy || { bass: 0, mid: 0, treble: 0, rms: 0 };
        var activeOrig = self.el ? self.el.querySelector('.mk-lyric-active .mk-lyric-orig') : null;
        var activeTrans = self.el ? self.el.querySelector('.mk-lyric-active .mk-lyric-trans') : null;
        var glowIntensity = (self.state.lyricsGlowIntensity !== undefined ? self.state.lyricsGlowIntensity : 1.0) * (self.state.reactiveIntensity || 1.0);
        var theme = self.state.visualizerTheme || 'cyan';

        if (activeOrig) {
          var glow = (energy.rms * 16 * glowIntensity).toFixed(1);
          if (theme === 'rainbow') {
            baseHue = (baseHue + 1.2 + (energy.bass * 3.5)) % 360;
            var currentHue = Math.round(baseHue);
            var color1 = 'hsl(' + currentHue + ', 100%, ' + (55 + (energy.bass * 25)).toFixed(0) + '%)';
            var color2 = 'hsl(' + ((currentHue + 60) % 360) + ', 100%, 55%)';
            activeOrig.style.color = color1;
            activeOrig.style.textShadow = '0 0 ' + glow + 'px ' + color1 + ', 0 0 ' + (glow * 2) + 'px ' + color2;
            if (activeTrans) {
              activeTrans.style.color = color2;
              activeTrans.style.textShadow = '0 0 ' + (glow * 0.7) + 'px ' + color2;
            }
          } else if (theme === 'aurora') {
            var auroraLight = 50 + (energy.bass * 30);
            activeOrig.style.color = 'hsl(145, 100%, ' + auroraLight + '%)';
            activeOrig.style.textShadow = '0 0 ' + glow + 'px rgba(16, 185, 129, 0.8), 0 0 ' + (glow * 2) + 'px rgba(52, 211, 153, 0.4)';
            if (activeTrans) {
              activeTrans.style.color = '#a7f3d0';
              activeTrans.style.textShadow = '0 0 ' + (glow * 0.6) + 'px rgba(16, 185, 129, 0.4)';
            }
          } else if (theme === 'custom') {
            var violetLight = 55 + (energy.mid * 25);
            activeOrig.style.color = 'hsl(275, 100%, ' + violetLight + '%)';
            activeOrig.style.textShadow = '0 0 ' + glow + 'px rgba(168, 85, 247, 0.8), 0 0 ' + (glow * 2) + 'px rgba(192, 132, 252, 0.4)';
            if (activeTrans) {
              activeTrans.style.color = '#e9d5ff';
              activeTrans.style.textShadow = '0 0 ' + (glow * 0.6) + 'px rgba(168, 85, 247, 0.4)';
            }
          } else { // cyan
            var cyanLight = 50 + (energy.bass * 25);
            activeOrig.style.color = 'hsl(184, 100%, ' + cyanLight + '%)';
            activeOrig.style.textShadow = '0 0 ' + glow + 'px rgba(0, 240, 255, 0.75), 0 0 ' + (glow * 2) + 'px rgba(2, 132, 199, 0.4)';
            if (activeTrans) {
              activeTrans.style.color = '#bae6fd';
              activeTrans.style.textShadow = '0 0 ' + (glow * 0.6) + 'px rgba(0, 240, 255, 0.4)';
            }
          }
        }
      } else if (self.state.reducedMotion) {
        var activeOrigRM = self.el ? self.el.querySelector('.mk-lyric-active .mk-lyric-orig') : null;
        var activeTransRM = self.el ? self.el.querySelector('.mk-lyric-active .mk-lyric-trans') : null;
        if (activeOrigRM) {
          activeOrigRM.style.color = (self.state.lyricsActiveColor && self.state.lyricsActiveColor !== '#ffffff') ? self.state.lyricsActiveColor : '';
          activeOrigRM.style.textShadow = 'none';
        }
        if (activeTransRM) {
          activeTransRM.style.color = self.state.lyricsTranslationColor || '#cbd5e1';
          activeTransRM.style.textShadow = 'none';
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  };

  /* ---- Panel tabs: Lyrics / Translation / AI / Theme ---- */
  var FX_TILES = [
    { id: 'none', label: 'None', ico: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>' },
    { id: 'rainbow', label: 'Rainbow', ico: '<path d="M3 17a9 9 0 0 1 18 0"/><path d="M6.5 17a5.5 5.5 0 0 1 11 0"/><path d="M10 17a2 2 0 0 1 4 0"/>' },
    { id: 'glow', label: 'Glow', ico: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' },
    { id: 'wave', label: 'Wave', ico: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>' },
    { id: 'particle', label: 'Particles', ico: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><circle cx="19" cy="17" r="1.2"/><circle cx="5" cy="18" r="1"/>' },
    { id: 'karaoke', label: 'Karaoke · soon', ico: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>', soon: true }
  ];
  var THEME_DOTS = ['#ffffff', '#fff1b8', '#fde047', '#fdba74', '#ff8a65', '#f87171', '#f9a8d4', '#ec4899', '#c084fc', '#818cf8', '#7dd3fc', '#22d3ee', '#5eead4', '#4ade80', '#d9c28f'];
  var THEME_BGS = [
    { id: 'glass', label: 'Frosted glass', css: 'linear-gradient(160deg, rgba(255,255,255,0.35), rgba(120,120,160,0.25))' },
    { id: 'dark', label: 'Deep dark', css: 'linear-gradient(160deg, #1b1d3a, #05060f)' },
    { id: 'aurora', label: 'Aurora', css: 'linear-gradient(160deg, #10b981, #6366f1)' },
    { id: 'sunset', label: 'Sunset', css: 'linear-gradient(160deg, #fb7185, #fbbf24)' },
    { id: 'ocean', label: 'Ocean', css: 'linear-gradient(160deg, #0ea5e9, #1e3a8a)' },
    { id: 'violet', label: 'Violet night', css: 'linear-gradient(160deg, #7c3aed, #ec4899)' },
    { id: 'gradient', label: 'Ambient gradient', css: 'radial-gradient(circle at 50% 40%, #64748b, #0f172a)' },
    { id: 'transparent', label: 'Transparent', css: 'repeating-conic-gradient(#8884 0 25%, #fff2 0 50%) 0 0 / 12px 12px' }
  ];

  MakanLyricsTheatre.prototype.setPanel = function (name) {
    var names = ['lyrics', 'translation', 'ai', 'theme'];
    if (names.indexOf(name) < 0) name = 'lyrics';
    this.panel = name;
    names.forEach(function (n) { this.el.classList.toggle('mk-ptab-' + n, n === name); }, this);
    var tabs = this.el.querySelectorAll('.mk-ptab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-panel') === name;
      tabs[i].classList.toggle('mk-ptab-active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    ['translation', 'ai', 'theme'].forEach(function (n) {
      var el = this.el.querySelector('#mk-panel-' + n);
      if (el) el.hidden = (n !== name);
    }, this);
    if (name === 'theme') this.refreshThemePanel();
  };

  MakanLyricsTheatre.prototype._saveStyle = function (obj) {
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) this.state[k] = obj[k]; }
    if (window.MakanDesktop && window.MakanDesktop.setSettings) {
      try { window.MakanDesktop.setSettings(obj); } catch (e) { /* settings are best effort */ }
    }
    this.state.emit('lyricStyleChanged');
  };

  MakanLyricsTheatre.prototype.buildThemePanel = function () {
    var self = this;
    var fx = this.el.querySelector('#mk-theme-effects');
    var colors = this.el.querySelector('#mk-theme-colors');
    var bgs = this.el.querySelector('#mk-theme-bgs');
    if (!fx || !colors || !bgs) return;
    fx.innerHTML = FX_TILES.map(function (t) {
      return '<button type="button" class="mk-fx-tile' + (t.soon ? ' mk-fx-soon' : '') + '" data-fx="' + t.id + '"' + (t.soon ? ' disabled title="Needs word-by-word timing - coming later"' : '') + '>' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + t.ico + '</svg><span>' + t.label + '</span></button>';
    }).join('');
    var SG = window.MakanLyricsStyle;
    var gradDots = SG ? SG.COLOR_STYLES.filter(function (c) { return c.stops; }) : [];
    colors.innerHTML = THEME_DOTS.map(function (c) {
      return '<button type="button" class="mk-dot" data-color="' + c + '" style="background:' + c + '" title="' + c + '" aria-label="Lyric color ' + c + '"></button>';
    }).join('') + '<span class="mk-dot-sep" aria-hidden="true"></span>' + gradDots.map(function (g) {
      return '<button type="button" class="mk-dot mk-dot-grad" data-style="' + g.id + '" style="background:linear-gradient(135deg,' + g.stops.join(',') + ')" title="' + g.label + '" aria-label="Moving colours ' + g.label + '"></button>';
    }).join('') + '<label class="mk-dot mk-dot-custom" title="Pick any colour"><input type="color" id="mk-theme-color-input" value="#ffffff" aria-label="Custom lyric colour"></label>';
    bgs.innerHTML = THEME_BGS.map(function (b) {
      return '<button type="button" class="mk-bg-thumb" data-bg="' + b.id + '" title="' + b.label + '" aria-label="Background ' + b.label + '" style="background:' + b.css + '"></button>';
    }).join('');
    fx.addEventListener('click', function (e) {
      var b = e.target.closest('.mk-fx-tile'); if (!b || b.disabled) return;
      var id = b.getAttribute('data-fx');
      if (id === 'none') self._saveStyle({ lyricsEffect: 'none', lyricsColorStyle: 'solid' });
      else if (id === 'rainbow') self._saveStyle({ lyricsColorStyle: self.state.lyricsColorStyle === 'rainbow' ? 'solid' : 'rainbow' });
      else self._saveStyle({ lyricsEffect: id });
    });
    colors.addEventListener('click', function (e) {
      var b = e.target.closest('.mk-dot'); if (!b || b.classList.contains('mk-dot-custom')) return;
      var g = b.getAttribute('data-style');
      if (g) { self._saveStyle({ lyricsColorStyle: g }); return; }
      self._saveStyle({ lyricsActiveColor: b.getAttribute('data-color'), lyricsColorStyle: 'solid' });
    });
    var picker = colors.querySelector('#mk-theme-color-input');
    if (picker) picker.addEventListener('input', function () { self._saveStyle({ lyricsActiveColor: picker.value, lyricsColorStyle: 'solid' }); });
    bgs.addEventListener('click', function (e) {
      var b = e.target.closest('.mk-bg-thumb'); if (!b) return;
      self._saveStyle({ lyricsBackground: b.getAttribute('data-bg') });
    });
    // Visualizer: style tiles + colour themes
    var vs = this.el.querySelector('#mk-theme-vis-style');
    var vc = this.el.querySelector('#mk-theme-vis-colors');
    var AV = window.MakanAudioVisualizer;
    if (vs && vc && AV && AV.THEMES) {
      var VIS_STYLES = [
        { id: 'bars', label: 'Bars', ico: '<path d="M5 20V12M10 20V6M15 20V10M20 20V4"/>' },
        { id: 'mirror', label: 'Mirror', ico: '<path d="M5 9v6M9 6v12M13 4v16M17 7v10M21 10v4"/>' },
        { id: 'area', label: 'Wave', ico: '<path d="M2 20c3-1 4-9 8-9s4 6 7 6 3-9 5-9v12z"/>' }
      ];
      var VIS_NAMES = { cyan: 'Neon', aurora: 'Aurora', rainbow: 'Rainbow', sunset: 'Sunset', ocean: 'Ocean', gold: 'Gold', violet: 'Violet', candy: 'Candy' };
      vs.innerHTML = VIS_STYLES.map(function (t) {
        return '<button type="button" class="mk-fx-tile" data-vstyle="' + t.id + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + t.ico + '</svg><span>' + t.label + '</span></button>';
      }).join('');
      vc.innerHTML = Object.keys(VIS_NAMES).map(function (k) {
        var st = AV.THEMES[k].spectrumStops;
        return '<button type="button" class="mk-dot mk-dot-grad" data-vtheme="' + k + '" style="background:linear-gradient(135deg,' + st.join(',') + ')" title="' + VIS_NAMES[k] + '" aria-label="Bars colours ' + VIS_NAMES[k] + '"></button>';
      }).join('');
      function saveVis(obj) {
        for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) self.state[k] = obj[k]; }
        if (window.MakanDesktop && window.MakanDesktop.setSettings) { try { window.MakanDesktop.setSettings(obj); } catch (e) { /* best effort */ } }
        self.state.emit('visualizerThemeChanged', obj);
        self.refreshThemePanel();
      }
      vs.addEventListener('click', function (e) { var b = e.target.closest('[data-vstyle]'); if (b) saveVis({ visualizerStyle: b.getAttribute('data-vstyle') }); });
      vc.addEventListener('click', function (e) { var b = e.target.closest('[data-vtheme]'); if (b) saveVis({ visualizerTheme: b.getAttribute('data-vtheme') }); });
    }
  };

  MakanLyricsTheatre.prototype.refreshThemePanel = function () {
    var st = this.state;
    var eff = st.lyricsEffect || 'none', cs = st.lyricsColorStyle || 'solid', bg = st.lyricsBackground || 'glass';
    var tiles = this.el.querySelectorAll('.mk-fx-tile');
    for (var i = 0; i < tiles.length; i++) {
      var id = tiles[i].getAttribute('data-fx');
      var on = id === 'none' ? (eff === 'none' && cs === 'solid') : id === 'rainbow' ? cs === 'rainbow' : id === eff;
      tiles[i].classList.toggle('mk-on', on);
      tiles[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var dots = this.el.querySelectorAll('.mk-dot');
    for (var j = 0; j < dots.length; j++) {
      var dc = dots[j].getAttribute('data-color'), ds = dots[j].getAttribute('data-style');
      var on2 = ds ? cs === ds : (dc ? (cs === 'solid' && String(st.lyricsActiveColor || '').toLowerCase() === dc) : false);
      dots[j].classList.toggle('mk-on', on2);
    }
    var vts = this.el.querySelectorAll('[data-vstyle]');
    for (var q = 0; q < vts.length; q++) vts[q].classList.toggle('mk-on', vts[q].getAttribute('data-vstyle') === (st.visualizerStyle || 'bars'));
    var vcs = this.el.querySelectorAll('[data-vtheme]');
    for (var r = 0; r < vcs.length; r++) vcs[r].classList.toggle('mk-on', vcs[r].getAttribute('data-vtheme') === (st.visualizerTheme || 'cyan'));
    var thumbs = this.el.querySelectorAll('.mk-bg-thumb');
    for (var k = 0; k < thumbs.length; k++) thumbs[k].classList.toggle('mk-on', thumbs[k].getAttribute('data-bg') === bg);
  };

  MakanLyricsTheatre.prototype.bindPanels = function () {
    var self = this;
    var tabs = this.el.querySelectorAll('.mk-ptab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { self.setPanel(this.getAttribute('data-panel')); });
    }
    this.buildThemePanel();
    // Show both languages / Auto translate switches
    var swBoth = this.el.querySelector('#mk-sw-both');
    var swAuto = this.el.querySelector('#mk-sw-auto');
    if (swBoth) swBoth.addEventListener('click', function () {
      var m = self.state.lyricMode;
      self.state.setLyricMode((m === 'bilingual' || m === 'split') ? 'original' : 'split');
    });
    function autoOn() { try { return window.localStorage.getItem('makan.autoTranslate') === '1'; } catch (e) { return false; } }
    function paintAuto() { if (swAuto) { var o = autoOn(); swAuto.classList.toggle('mk-on', o); swAuto.setAttribute('aria-checked', o ? 'true' : 'false'); } }
    if (swAuto) swAuto.addEventListener('click', function () {
      try { window.localStorage.setItem('makan.autoTranslate', autoOn() ? '0' : '1'); } catch (e) { /* not saved */ }
      paintAuto();
      self.updateLyrics();
    });
    this._autoTranslateOn = autoOn;
    paintAuto();
    var swWords = this.el.querySelector('#mk-sw-words');
    function paintWords() { if (swWords) { var o = self._wordsOn(); swWords.classList.toggle('mk-on', o); swWords.setAttribute('aria-checked', o ? 'true' : 'false'); } }
    if (swWords) swWords.addEventListener('click', function () {
      try { window.localStorage.setItem('makan.lyricWords', self._wordsOn() ? '0' : '1'); } catch (e) { /* not saved */ }
      paintWords();
      self._closeWordPop();
      self.updateLyrics();
    });
    paintWords();
    this.el.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-go]');
      if (!g) return;
      var act = g.getAttribute('data-go');
      var s = self.state;
      function openSettings(tab) {
        if (!s.drawers.settings) s.toggleDrawer('settings');
        setTimeout(function () { var t = document.querySelector('[data-set-tab="' + tab + '"]'); if (t) t.click(); }, 60);
      }
      if (act === 'make') { self.setPanel('lyrics'); var mk = self.el.querySelector('#mk-ai-transcribe-btn'); if (mk) mk.click(); }
      else if (act === 'models' || act === 'tr-settings') openSettings('lyrics');
      else if (act === 'style') { if (!s.drawers.lyricsStyle) s.toggleDrawer('lyricsStyle'); }
    });
    this.setPanel('lyrics');
  };

  MakanLyricsTheatre.prototype.bindEvents = function () {
    var self = this;

    this.bindPanels();

    // Mode tabs
    var tabBtns = this.el.querySelectorAll('.mk-tab-btn');
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener('click', function () {
        for (var j = 0; j < tabBtns.length; j++) tabBtns[j].classList.remove('mk-tab-active');
        this.classList.add('mk-tab-active');
        var mode = this.getAttribute('data-mode');
        self.state.setLyricMode(mode);
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ lyricMode: mode });
        }
        self.updateLyrics();
      });
    }

    // Click lyric line to seek
    this.scrollEl.addEventListener('click', function (e) {
      var wspan = e.target.closest ? e.target.closest('.mk-w') : null;
      if (wspan && self._wordsOn()) { e.stopPropagation(); self._openWordPop(wspan); return; }
      var item = e.target.closest('.mk-lyric-item');
      if (!item) return;
      var start = parseFloat(item.getAttribute('data-start'));
      if (!isNaN(start)) {
        self.engine.seek(start + (self.state.syncOffset || 0));
        self.engine.play();
      }
    });

    // Sync adjust buttons
    var minusBtn = this.el.querySelector('#mk-sync-minus');
    var plusBtn = this.el.querySelector('#mk-sync-plus');
    var valEl = this.el.querySelector('#mk-sync-val');

    if (minusBtn) {
      minusBtn.addEventListener('click', function () {
        self.state.adjustSyncOffset(-0.1);
        if (valEl) valEl.textContent = (self.state.syncOffset >= 0 ? '+' : '') + self.state.syncOffset.toFixed(1) + 's';
        self.persistSyncOffset();
      });
    }

    if (plusBtn) {
      plusBtn.addEventListener('click', function () {
        self.state.adjustSyncOffset(0.1);
        if (valEl) valEl.textContent = (self.state.syncOffset >= 0 ? '+' : '') + self.state.syncOffset.toFixed(1) + 's';
        self.persistSyncOffset();
      });
    }

    // Lyrics File Import Picker
    var filePicker = this.el.querySelector('#mk-lyric-file-picker');
    var importBtn = this.el.querySelector('#mk-lyric-import-btn');
    if (importBtn && filePicker) {
      importBtn.addEventListener('click', function () {
        filePicker.click();
      });
      filePicker.addEventListener('change', function (e) {
        if (!e.target.files || !e.target.files.length) return;
        var file = e.target.files[0];
        var reader = new FileReader();
        reader.onload = function (readEvt) {
          var text = readEvt.target.result;
          if (window.MakanLyricsParser) {
            var parsed = window.MakanLyricsParser.parse(text, file.name);
            if (self.state.currentTrack) {
              self.state.currentTrack.cues = parsed.cues || [];
              self.updateLyrics();
            }
          }
        };
        reader.readAsText(file);
      });
    }

    // Style button
    var fontBtn = this.el.querySelector('#mk-lyric-font-btn');
    if (fontBtn) {
      fontBtn.addEventListener('click', function () {
        self.state.toggleDrawer('lyricsStyle');
      });
    }

    var themeBtn = this.el.querySelector('#mk-lyric-theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        self.state.soundReactiveLyrics = !self.state.soundReactiveLyrics;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) {
          window.MakanDesktop.setSettings({ soundReactiveLyrics: self.state.soundReactiveLyrics });
        }
        self.state.emit('lyricStyleChanged');
      });
    }

    // State events
    this.state.on('timeUpdated', function () { self._paintWords(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self._closeWordPop(); });
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && !e.target.closest('#mk-word-pop') && !e.target.closest('.mk-w')) self._closeWordPop();
    });
    this.state.on('activeLyricChanged', function () {
      self.highlightActiveLyric();
    });

    this.state.on('trackChanged', function () {
      if (valEl) valEl.textContent = (self.state.syncOffset >= 0 ? '+' : '') + self.state.syncOffset.toFixed(1) + 's';
      self.updateLyrics();
    });

    this.state.on('syncOffsetChanged', function (data) {
      if (valEl) valEl.textContent = (data.syncOffset >= 0 ? '+' : '') + data.syncOffset.toFixed(1) + 's';
    });

    this.state.on('lyricStyleChanged', function () {
      self.applyStyles();
      self.updateLyrics();
      self.refreshThemePanel();
    });

    this.state.on('lyricModeChanged', function () {
      self.applyStyles();
      self.updateLyrics();
    });

    this.state.on('visualizerThemeChanged', function () {
      self.applyStyles();
    });

    this.state.on('settingsLoaded', function () {
      self.applyStyles();
      self.updateLyrics();
    });
  };

  MakanLyricsTheatre.prototype.highlightActiveLyric = function () {
    var items = this.scrollEl ? this.scrollEl.querySelectorAll('.mk-lyric-item') : [];
    var activeIdx = this.state.currentLyricIndex;

    for (var i = 0; i < items.length; i++) {
      var itemIdx = parseInt(items[i].getAttribute('data-cue-index'), 10);
      if (itemIdx === activeIdx) {
        items[i].classList.add('mk-lyric-active');
      } else {
        items[i].classList.remove('mk-lyric-active');
      }
    }
    var doneEls = this.scrollEl ? this.scrollEl.querySelectorAll('.mk-w-done') : [];
    for (var d = 0; d < doneEls.length; d++) doneEls[d].classList.remove('mk-w-done', 'mk-w-now');
    this._closeWordPop();
    this._paintWords();
    this.scrollToActive();
  };

  MakanLyricsTheatre.prototype.persistSyncOffset = function () {
    var track = this.state.currentTrack;
    if (track && track.id && window.MakanDesktop && window.MakanDesktop.setSyncOffset) {
      window.MakanDesktop.setSyncOffset(track.id, this.state.syncOffset);
    }
  };

  window.MakanLyricsTheatre = MakanLyricsTheatre;
})();
