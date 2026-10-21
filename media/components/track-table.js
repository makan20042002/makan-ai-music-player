'use strict';
/*
 * media/components/track-table.js - Real Row-Virtualized Track Table for MAKAN Music Player v1.6.0.
 * Features:
 * - Real row virtualization: DOM contains ONLY visible rows plus overscan (~25-35 rows)
 * - 15 Sortable, resizable, and reorderable columns with saved column layout:
 *   status, title, artist, album, album_artist, genre, year, duration,
 *   added_date, last_played_date, play_count, rating, codec (format), bitrate, folder
 * - Natural sorting (Song 2 before Song 10) via Intl.Collator
 * - Unknown/empty values consistently sorted at the bottom regardless of asc/desc
 * - Shift-click for secondary column sorting
 * - Advanced Search: quotes (artist:"Pink Floyd"), prefixes (artist:, album:, genre:, year:, folder:, format:, rating:),
 *   exclusions (-genre:live), and diacritic-tolerance
 * - Multi-selection: Single click, Ctrl-click toggle, Shift-click range, Ctrl+A, Escape to clear
 * - Selection counter display
 * - Windows-style context menu with bulk actions: Play, Play Next, Add to Queue, Add to Playlist,
 *   Rescan Metadata, Locate File, Show in Explorer, Remove from Library (without deleting files)
 * - Column chooser with "Restore Default Columns"
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
    module.exports.MakanTrackTable = mod;
    module.exports.parseSearchQuery = mod.parseSearchQuery;
    module.exports.filterTrack = mod.filterTrack;
    module.exports.naturalCompare = mod.naturalCompare;
  }
  if (typeof window !== 'undefined') {
    window.MakanTrackTable = mod;
  } else if (root) {
    root.MakanTrackTable = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROW_HEIGHT = 28;
  var OVERSCAN = 10;

  var DEFAULT_COLUMNS = [
    { id: 'status', label: '#', width: 44, minWidth: 32, sortable: true, hidden: false },
    { id: 'title', label: 'Title', width: 210, minWidth: 80, sortable: true, hidden: false },
    { id: 'artist', label: 'Artist', width: 140, minWidth: 60, sortable: true, hidden: false },
    { id: 'album', label: 'Album', width: 140, minWidth: 60, sortable: true, hidden: false },
    { id: 'album_artist', label: 'Album Artist', width: 130, minWidth: 60, sortable: true, hidden: true },
    { id: 'disc_num', label: 'Disc #', width: 45, minWidth: 35, sortable: true, hidden: true },
    { id: 'genre', label: 'Genre', width: 85, minWidth: 50, sortable: true, hidden: false },
    { id: 'year', label: 'Year', width: 50, minWidth: 40, sortable: true, hidden: false },
    { id: 'duration', label: 'Time', width: 56, minWidth: 44, sortable: true, hidden: false },
    { id: 'bpm', label: 'BPM', width: 50, minWidth: 40, sortable: true, hidden: true },
    { id: 'energy', label: 'Energy', width: 58, minWidth: 44, sortable: true, hidden: true },
    { id: 'added_date', label: 'Date Added', width: 90, minWidth: 60, sortable: true, hidden: true },
    { id: 'last_played_date', label: 'Last Played', width: 90, minWidth: 60, sortable: true, hidden: true },
    { id: 'play_count', label: 'Plays', width: 50, minWidth: 40, sortable: true, hidden: true },
    { id: 'rating', label: 'Rating', width: 55, minWidth: 40, sortable: true, hidden: true },
    { id: 'codec', label: 'Format', width: 60, minWidth: 44, sortable: true, hidden: false },
    { id: 'bitrate', label: 'Bitrate', width: 68, minWidth: 50, sortable: true, hidden: true },
    { id: 'sample_rate', label: 'Sample Rate', width: 75, minWidth: 50, sortable: true, hidden: true },
    { id: 'folder', label: 'Folder', width: 150, minWidth: 70, sortable: true, hidden: true },
    { id: 'is_missing', label: 'Status', width: 65, minWidth: 45, sortable: true, hidden: true }
  ];

  var collator = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    : {
        compare: function (a, b) {
          return String(a).localeCompare(String(b), undefined, { numeric: true });
        }
      };

  function normalizeStr(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function parseSearchQuery(query) {
    var raw = (query || '').trim();
    if (!raw) return [];

    var regex = /(-?(?:artist|album|title|genre|year|folder|format|rating|lyrics|has|missing|plays|is|bpm|energy):"(?:[^"]+)"|-?(?:artist|album|title|genre|year|folder|format|rating|lyrics|has|missing|plays|is|bpm|energy):[^\s]+|"(?:[^"]+)"|-[^\s]+|[^\s]+)/gi;
    var matches = raw.match(regex) || [];
    var tokens = [];

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var isNeg = false;
      if (m.indexOf('-') === 0 && m.length > 1) {
        isNeg = true;
        m = m.slice(1);
      }

      var field = null;
      var val = m;

      var colonIdx = m.indexOf(':');
      if (colonIdx > 0) {
        var prefix = m.substring(0, colonIdx).toLowerCase();
        if (['artist', 'album', 'title', 'genre', 'year', 'folder', 'format', 'rating', 'lyrics', 'has', 'missing', 'plays', 'is', 'bpm', 'energy'].indexOf(prefix) !== -1) {
          field = prefix;
          val = m.substring(colonIdx + 1);
        }
      }

      // Remove surrounding quotes
      if (val.indexOf('"') === 0 && val.lastIndexOf('"') === val.length - 1 && val.length > 1) {
        val = val.substring(1, val.length - 1);
      }

      val = normalizeStr(val).trim();
      if (val) {
        tokens.push({
          field: field,
          val: val,
          neg: isNeg
        });
      }
    }
    return tokens;
  }

  /* lyricsHits (optional): { word: Set of track ids whose lyrics contain the word } from the main process */
  function filterTrack(track, tokens, lyricsHits) {
    if (!tokens || !tokens.length) return true;
    var hitSet = function (val) { return lyricsHits && lyricsHits[val]; };
    var inLyrics = function (val) { var h = hitSet(val); return !!(h && h.has(track.id)); };

    var titleNorm = normalizeStr(track.title || track.filename || '');
    var artistNorm = normalizeStr(track.artist || '');
    var albumNorm = normalizeStr(track.album || '');
    var genreNorm = normalizeStr(track.genre || '');
    var folderNorm = normalizeStr(track.folder_path || '');
    var formatNorm = normalizeStr(track.codec || '');
    var yearNorm = normalizeStr(track.year || '');
    var ratingNorm = normalizeStr(track.rating || '');

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var match = false;

      if (t.field === 'artist') {
        match = artistNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'album') {
        match = albumNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'title') {
        match = titleNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'genre') {
        match = genreNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'year') {
        var yr = Number(track.year || 0), ym;
        if ((ym = /^(\d{4})-(\d{4})$/.exec(t.val))) match = yr >= Math.min(+ym[1], +ym[2]) && yr <= Math.max(+ym[1], +ym[2]);
        else if ((ym = /^([<>]=?)(\d{4})$/.exec(t.val))) {
          var yv = parseInt(ym[2], 10);
          match = yr > 0 && (ym[1] === '>' ? yr > yv : ym[1] === '>=' ? yr >= yv : ym[1] === '<' ? yr < yv : yr <= yv);
        } else match = yearNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'folder') {
        match = folderNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'format') {
        match = formatNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'rating') {
        match = ratingNorm.indexOf(t.val) !== -1;
      } else if (t.field === 'lyrics') {
        match = inLyrics(t.val);
      } else if (t.field === 'is') {
        // is:duplicate -> songs that look like the same recording more than once
        match = t.val === 'duplicate' && !!(lyricsHits && lyricsHits.__dup && lyricsHits.__dup[track.id]);
      } else if (t.field === 'bpm' || t.field === 'energy') {
        // bpm:120-130  bpm:>140  energy:low|medium|high  (songs that are not analysed yet never match)
        var SA = (typeof window !== 'undefined' && window.MakanSound) || (typeof require === 'function' ? require('./sound-analysis') : null);
        match = !!(SA && lyricsHits && lyricsHits.__feat && SA.soundMatches(t.field, t.val, lyricsHits.__feat[track.id]));
      } else if (t.field === 'has') {
        // has:lyrics  has:art  has:rating
        if (t.val === 'lyrics') match = !!track.lyrics_path;
        else if (t.val === 'art' || t.val === 'artwork' || t.val === 'cover') match = !!track.artwork_path;
        else if (t.val === 'rating') match = (track.rating || 0) > 0;
        else match = false;
      } else if (t.field === 'missing') {
        // missing:artist  missing:album  missing:title  missing:genre  missing:year
        var mf = t.val === 'title' ? (track.title || '') : t.val === 'artist' ? (track.artist || '') : t.val === 'album' ? (track.album || '') : t.val === 'genre' ? (track.genre || '') : t.val === 'year' ? (track.year || '') : 'x';
        var mfs = String(mf).trim().toLowerCase();
        match = mfs === '' || mfs === '0' || mfs === 'unknown' || mfs === 'unknown artist' || mfs === 'unknown album';
      } else if (t.field === 'plays') {
        // plays:0   plays:>4   plays:<3
        var pn = Number(track.play_count || 0), pm = /^([<>]=?)?(\d+)$/.exec(t.val);
        if (!pm) match = false;
        else {
          var pv = parseInt(pm[2], 10), po = pm[1] || '=';
          match = po === '>' ? pn > pv : po === '>=' ? pn >= pv : po === '<' ? pn < pv : po === '<=' ? pn <= pv : pn === pv;
        }
      } else {
        // Full-text match across any field
        match = titleNorm.indexOf(t.val) !== -1 ||
                artistNorm.indexOf(t.val) !== -1 ||
                albumNorm.indexOf(t.val) !== -1 ||
                genreNorm.indexOf(t.val) !== -1 ||
                folderNorm.indexOf(t.val) !== -1 ||
                formatNorm.indexOf(t.val) !== -1 ||
                yearNorm.indexOf(t.val) !== -1;
        // a plain word also finds songs that have it inside their lyrics (not for -word)
        if (!match && !t.neg) match = inLyrics(t.val);
      }

      if (t.neg) {
        if (match) return false;
      } else {
        if (!match) return false;
      }
    }
    return true;
  }

  /* tempo and energy measured by Sound analysis (empty until the song has been analysed) */
  function soundOf(track) {
    var S = (typeof window !== 'undefined') ? window.MakanSound : null;
    return S && S.map && track ? S.map[track.id] : null;
  }

  function getSortValue(track, colId) {
    if (!track) return null;
    if (colId === 'status') return track.track_num != null ? track.track_num : null;
    if (colId === 'title') return track.title || track.filename || null;
    if (colId === 'artist') return track.artist || null;
    if (colId === 'album') return track.album || null;
    if (colId === 'album_artist') return track.album_artist || null;
    if (colId === 'genre') return track.genre || null;
    if (colId === 'year') return track.year ? Number(track.year) : null;
    if (colId === 'duration') return track.duration ? Number(track.duration) : null;
    if (colId === 'bpm' || colId === 'energy') { var sf = soundOf(track); return sf && sf[colId] > 0 ? Number(sf[colId]) : null; }
    if (colId === 'added_date') return track.added_date ? Number(track.added_date) : null;
    if (colId === 'last_played_date') return track.last_played_date ? Number(track.last_played_date) : null;
    if (colId === 'play_count') return track.play_count != null ? Number(track.play_count) : null;
    if (colId === 'rating') return track.rating != null ? Number(track.rating) : null;
    if (colId === 'disc_num') return track.disc_num != null ? Number(track.disc_num) : null;
    if (colId === 'codec') return track.codec || null;
    if (colId === 'bitrate') return track.bitrate ? Number(track.bitrate) : null;
    if (colId === 'sample_rate') return track.sample_rate ? Number(track.sample_rate) : null;
    if (colId === 'folder') return track.folder_path || null;
    if (colId === 'is_missing') return track.is_missing ? 1 : 0;
    return track[colId] || null;
  }

  function isUnknownValue(val) {
    return val === null || val === undefined || val === '' || val === '—' || val === 'Unknown';
  }

  function naturalCompare(colId, asc, a, b) {
    var va = getSortValue(a, colId);
    var vb = getSortValue(b, colId);

    var aUnknown = isUnknownValue(va);
    var bUnknown = isUnknownValue(vb);

    // Unknown values are consistently sorted at the bottom regardless of asc/desc
    if (aUnknown && bUnknown) return 0;
    if (aUnknown) return 1;
    if (bUnknown) return -1;

    var res = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      res = va < vb ? -1 : (va > vb ? 1 : 0);
    } else {
      res = collator.compare(String(va), String(vb));
    }
    return asc ? res : -res;
  }

  function MakanTrackTable(container, state, engine, playbackController) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.controller = playbackController || null;

    this.columns = this._loadSavedColumns();
    this.sortCol = 'title';
    this.sortAsc = true;
    this.secondarySortCol = null;
    this.secondarySortAsc = true;
    this.filterQuery = '';

    this.selectedIds = new Set();
    this.lastSelectedId = null;
    this.activeRowIndex = 0;

    this.filteredTracks = [];
    this.scrollEl = null;
    this.spacerEl = null;
    this.contentEl = null;
    this.headerEl = null;
    this.contextMenuEl = null;

    this.render();
    this.bindEvents();
    this.refresh();
  }

  MakanTrackTable.prototype._loadSavedColumns = function () {
    try {
      var saved = localStorage.getItem('makan_table_columns_v160');
      if (saved) {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 10) {
          // columns added in later versions (hidden at first) join a layout saved before them
          DEFAULT_COLUMNS.forEach(function (d) {
            if (!parsed.some(function (c) { return c && c.id === d.id; })) parsed.push(JSON.parse(JSON.stringify(d)));
          });
          return parsed;
        }
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
  };

  MakanTrackTable.prototype._saveColumns = function () {
    try {
      localStorage.setItem('makan_table_columns_v160', JSON.stringify(this.columns));
    } catch (e) {}
  };

  MakanTrackTable.prototype.restoreDefaultColumns = function () {
    this.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    this.sortCol = 'title';
    this.sortAsc = true;
    this.secondarySortCol = null;
    this._saveColumns();
    this.renderHeader();
    this.refresh();
  };

  MakanTrackTable.prototype.render = function () {
    var html = '' +
      '<div class="mk-virtual-table-root" id="mk-virtual-table-root" tabindex="0">' +
      '  <!-- Context Menu -->' +
      '  <div class="mk-context-menu" id="mk-table-context-menu" hidden></div>' +
      '' +
      '  <!-- Table Header -->' +
      '  <div class="mk-vtable-header" id="mk-vtable-header"></div>' +
      '' +
      '  <!-- Scroll Area -->' +
      '  <div class="mk-vtable-scroll" id="mk-vtable-scroll">' +
      '    <div class="mk-vtable-spacer" id="mk-vtable-spacer">' +
      '      <div class="mk-vtable-content" id="mk-vtable-content"></div>' +
      '    </div>' +
      '    <div class="mk-empty-library" id="mk-empty-library" hidden>' +
      '      <div class="mk-empty-card">' +
      '        <div class="mk-empty-icon">' + window.MakanIcons.library() + '</div>' +
      '        <h2 class="mk-empty-title">Your Music Library is Empty</h2>' +
      '        <p class="mk-empty-desc">Add folders or audio files from your Windows PC to begin enjoying your collection.</p>' +
      '        <div class="mk-empty-actions">' +
      '          <button type="button" class="mk-btn mk-btn-primary" id="mk-empty-add-folder-btn">' + window.MakanIcons.folders() + ' <span>Add Music Folder</span></button>' +
      '          <button type="button" class="mk-btn mk-btn-secondary" id="mk-empty-add-files-btn">' + window.MakanIcons.plus() + ' <span>Add Files</span></button>' +
      '        </div>' +
      '        <div class="mk-empty-hint">' +
      '          <span>Tip: You can also drag &amp; drop audio files or folders directly here.</span>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <!-- Table Footer / Selection Status Bar -->' +
      '  <div class="mk-vtable-footer" id="mk-vtable-footer" style="padding:4px 10px;font-size:11px;color:var(--mk-text-dim);border-top:1px solid rgba(var(--mk-fg-rgb),0.06);display:flex;justify-content:space-between;align-items:center;">' +
      '    <span id="mk-vtable-count-label">0 tracks</span>' +
      '    <span id="mk-vtable-selection-label" style="color:var(--mk-accent-cyan);"></span>' +
      '  </div>' +
      '</div>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;
    this.headerEl = this.el.querySelector('#mk-vtable-header');
    this.scrollEl = this.el.querySelector('#mk-vtable-scroll');
    this.spacerEl = this.el.querySelector('#mk-vtable-spacer');
    this.contentEl = this.el.querySelector('#mk-vtable-content');
    this.emptyEl = this.el.querySelector('#mk-empty-library');
    this.contextMenuEl = this.el.querySelector('#mk-table-context-menu');
    this.countLabelEl = this.el.querySelector('#mk-vtable-count-label');
    this.selectionLabelEl = this.el.querySelector('#mk-vtable-selection-label');

    this.renderHeader();
  };

  MakanTrackTable.prototype.renderHeader = function () {
    var html = '<div class="mk-vtable-row mk-vtable-header-row">';
    for (var i = 0; i < this.columns.length; i++) {
      var col = this.columns[i];
      if (col.hidden) continue;
      var sortIndicator = '';
      if (this.sortCol === col.id) {
        sortIndicator = this.sortAsc ? ' ▲' : ' ▼';
      } else if (this.secondarySortCol === col.id) {
        sortIndicator = this.secondarySortAsc ? ' ▵' : ' ▿';
      }
      html += '' +
        '<div class="mk-vth" data-col="' + col.id + '" style="width:' + col.width + 'px;" draggable="true" title="Click to sort, Shift-click for secondary sort">' +
        '  <span class="mk-vth-label">' + col.label + sortIndicator + '</span>' +
        '  <span class="mk-vth-resizer" data-resizer="' + col.id + '"></span>' +
        '</div>';
    }
    html += '</div>';
    this.headerEl.innerHTML = html;
  };

  MakanTrackTable.prototype.setFilter = function (query) {
    this.filterQuery = (query || '').trim();
    this.state.activeSearchQuery = this.filterQuery;
    this.refresh();
    this._requestLyricsHits();
  };

  /* Ask the main process which songs have the typed words inside their lyrics (desktop app only). */
  MakanTrackTable.prototype._requestLyricsHits = function () {
    var self = this;
    var api = typeof window !== 'undefined' ? window.MakanDesktop : null;
    if (!api || typeof api.searchLyrics !== 'function') return;
    var terms = [];
    parseSearchQuery(this.filterQuery).forEach(function (t) {
      if (t.field === 'lyrics' || (!t.field && !t.neg)) { if (terms.indexOf(t.val) === -1) terms.push(t.val); }
    });
    if (this._lyricsTimer) clearTimeout(this._lyricsTimer);
    if (!terms.length) return;
    var asked = this.filterQuery;
    this._lyricsTimer = setTimeout(function () {
      api.searchLyrics(terms).then(function (res) {
        if (!res || self.filterQuery !== asked) return;
        var hits = self._lyricsHits || {};
        if (Object.keys(hits).length > 40) hits = {};
        Object.keys(res).forEach(function (k) { hits[k] = new Set(res[k] || []); });
        self._lyricsHits = hits;
        self.refresh();
      }).catch(function () {});
    }, 120);
  };

  MakanTrackTable.prototype.refresh = function () {
    var self = this;
    var all = this.state.tracks || [];
    var tokens = parseSearchQuery(this.filterQuery);
    var hits = this._lyricsHits || {};
    var dupMap = null;
    if (tokens.some(function (t) { return t.field === 'is' && t.val === 'duplicate'; }) && typeof window !== 'undefined' && window.MakanTagFixer) {
      dupMap = window.MakanTagFixer.duplicateMap(all);
      hits = Object.assign({}, hits, { __dup: dupMap });
    }

    if (tokens.some(function (t) { return t.field === 'bpm' || t.field === 'energy'; }) && typeof window !== 'undefined' && window.MakanSound) {
      hits = Object.assign({}, hits, { __feat: window.MakanSound.map });
    }

    if (!tokens.length) {
      this.filteredTracks = all.slice();
    } else {
      this.filteredTracks = all.filter(function (t) {
        return filterTrack(t, tokens, hits);
      });
    }

    // Update count labels
    var countStr = '';
    if (this.filterQuery) {
      countStr = this.filteredTracks.length.toLocaleString() + ' / ' + all.length.toLocaleString() + ' tracks';
    } else {
      countStr = all.length.toLocaleString() + ' tracks';
    }
    if (this.countLabelEl) this.countLabelEl.textContent = countStr;
    var libCountEl = typeof document !== 'undefined' ? document.getElementById('mk-lib-count') : null;
    if (libCountEl) libCountEl.textContent = countStr;

    this.updateSelectionVisuals();

    // Natural Sorting
    this.filteredTracks.sort(function (a, b) {
      var r = naturalCompare(self.sortCol, self.sortAsc, a, b);
      if (r === 0 && self.secondarySortCol) {
        r = naturalCompare(self.secondarySortCol, self.secondarySortAsc, a, b);
      }
      return r;
    });

    if (dupMap) { // keep the copies of one song next to each other
      this.filteredTracks.sort(function (a, b) { return (dupMap[a.id] || 0) - (dupMap[b.id] || 0); });
    }

    var count = this.filteredTracks.length;
    var totalHeight = count * ROW_HEIGHT;
    this.spacerEl.style.height = totalHeight + 'px';

    if (all.length === 0) {
      this.emptyEl.hidden = false;
      this.spacerEl.hidden = true;
    } else {
      this.emptyEl.hidden = true;
      this.spacerEl.hidden = false;
    }

    this.renderVirtualRows();
  };

  MakanTrackTable.prototype.renderVirtualRows = function () {
    var count = this.filteredTracks.length;
    if (count === 0) {
      this.contentEl.innerHTML = '';
      return;
    }

    var scrollTop = this.scrollEl.scrollTop;
    var viewportHeight = Math.min(800, this.scrollEl.clientHeight || 500);
    if (viewportHeight <= 0) viewportHeight = 500;

    var startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    var endIdx = Math.min(count, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

    var translateY = startIdx * ROW_HEIGHT;
    this.contentEl.style.transform = 'translateY(' + translateY + 'px)';

    var curTrack = this.state.currentTrack;
    var isPlaying = this.state.isPlaying;

    var html = '';
    for (var i = startIdx; i < endIdx; i++) {
      var t = this.filteredTracks[i];
      var isCur = curTrack && (curTrack.id === t.id);
      var isSel = this.selectedIds.has(t.id);
      var rowCls = 'mk-vtable-row mk-track-row' +
                   (isCur ? ' mk-row-active' : '') +
                   (isSel ? ' mk-row-selected' : '') +
                   (t.is_missing ? ' mk-row-missing' : '');

      html += '<div class="' + rowCls + '" data-id="' + t.id + '" data-index="' + i + '" style="height:' + ROW_HEIGHT + 'px;" draggable="true">';

      for (var c = 0; c < this.columns.length; c++) {
        var col = this.columns[c];
        if (col.hidden) continue;
        var cellVal = this._getCellValue(t, col.id, i, isCur, isPlaying);
        html += '<div class="mk-vtd mk-col-' + col.id + '" style="width:' + col.width + 'px;" title="' + this._escapeAttr(t[col.id] || '') + '">' + cellVal + '</div>';
      }

      html += '</div>';
    }

    this.contentEl.innerHTML = html;
  };

  MakanTrackTable.prototype.updateSelectionVisuals = function () {
    if (this.selectionLabelEl) {
      var selCount = this.selectedIds.size;
      this.selectionLabelEl.textContent = selCount > 0 ? (selCount + ' selected') : '';
    }
    if (!this.contentEl || !this.contentEl.children) return;
    var rows = this.contentEl.children;
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute('data-id');
      if (this.selectedIds.has(id)) {
        rows[i].classList.add('mk-row-selected');
      } else {
        rows[i].classList.remove('mk-row-selected');
      }
    }
  };

  MakanTrackTable.prototype._getCellValue = function (track, colId, index, isCurrent, isPlaying) {
    var icons = window.MakanIcons;

    if (colId === 'status') {
      if (isCurrent) {
        return '<span class="mk-playing-indicator">' + icons.playingBars() + '</span>';
      }
      return '<span class="mk-row-num">' + (track.track_num != null ? track.track_num : (index + 1)) + '</span>';
    }
    if (colId === 'title') {
      var titleText = track.title || track.filename || 'Untitled';
      if (track.is_missing) titleText += ' [Missing]';
      return '<span class="mk-cell-text">' + this._highlightText(titleText) + '</span>';
    }
    if (colId === 'artist') {
      return '<span class="mk-cell-text">' + this._highlightText(track.artist || '—') + '</span>';
    }
    if (colId === 'album') {
      return '<span class="mk-cell-text">' + this._highlightText(track.album || '—') + '</span>';
    }
    if (colId === 'album_artist') {
      return '<span class="mk-cell-text">' + this._highlightText(track.album_artist || '—') + '</span>';
    }
    if (colId === 'genre') {
      return '<span class="mk-cell-text">' + this._highlightText(track.genre || '—') + '</span>';
    }
    if (colId === 'year') {
      return track.year || '—';
    }
    if (colId === 'duration') {
      return this.state.formatTime(track.duration || 0);
    }
    if (colId === 'bpm' || colId === 'energy') {
      var sf = soundOf(track);
      return sf && sf[colId] > 0 ? String(sf[colId]) : '—';
    }
    if (colId === 'added_date') {
      return track.added_date ? new Date(track.added_date).toLocaleDateString() : '—';
    }
    if (colId === 'last_played_date') {
      return track.last_played_date ? new Date(track.last_played_date).toLocaleDateString() : '—';
    }
    if (colId === 'play_count') {
      return (track.play_count != null) ? track.play_count : '0';
    }
    if (colId === 'rating') {
      return track.rating ? '★ ' + track.rating : '—';
    }
    if (colId === 'disc_num') {
      return track.disc_num != null ? track.disc_num : '—';
    }
    if (colId === 'codec') {
      return (track.codec || 'MP3').toUpperCase();
    }
    if (colId === 'bitrate') {
      return track.bitrate ? Math.round(track.bitrate / 1000) + ' kbps' : '—';
    }
    if (colId === 'sample_rate') {
      return track.sample_rate ? (track.sample_rate >= 1000 ? (track.sample_rate / 1000).toFixed(1) + ' kHz' : track.sample_rate + ' Hz') : '—';
    }
    if (colId === 'folder') {
      return '<span class="mk-cell-text" title="' + this._escapeAttr(track.folder_path || '') + '">' + this._highlightText(track.folder_path || '—') + '</span>';
    }
    if (colId === 'is_missing') {
      return track.is_missing ? '<span style="color:var(--mk-danger);font-weight:600;">Missing</span>' : '<span style="color:var(--mk-accent-emerald);">Available</span>';
    }
    return '';
  };

  MakanTrackTable.prototype._highlightText = function (str) {
    var raw = String(str || '');
    if (!this.filterQuery) return this._escapeHtml(raw);

    var tokens = parseSearchQuery(this.filterQuery);
    var terms = [];
    for (var i = 0; i < tokens.length; i++) {
      if (!tokens[i].neg && tokens[i].val) {
        terms.push(tokens[i].val);
      }
    }
    if (!terms.length) return this._escapeHtml(raw);

    var escapedTerms = terms.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    var regex = new RegExp('(' + escapedTerms.join('|') + ')', 'gi');

    var pieces = raw.split(regex);
    var self = this;
    var out = '';
    for (var j = 0; j < pieces.length; j++) {
      var piece = pieces[j];
      if (!piece) continue;
      if (regex.test(piece)) {
        out += '<mark class="mk-highlight">' + self._escapeHtml(piece) + '</mark>';
      } else {
        out += self._escapeHtml(piece);
      }
    }
    return out;
  };

  MakanTrackTable.prototype._escapeHtml = function (str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  MakanTrackTable.prototype._escapeAttr = function (str) {
    return String(str || '').replace(/"/g, '&quot;');
  };

  MakanTrackTable.prototype.bindEvents = function () {
    var self = this;

    this.scrollEl.addEventListener('scroll', function () {
      self.renderVirtualRows();
    });

    // Header column sorting (with Shift-click for secondary sort)
    this.headerEl.addEventListener('click', function (e) {
      var th = e.target.closest('.mk-vth');
      if (!th || e.target.classList.contains('mk-vth-resizer')) return;
      var colId = th.getAttribute('data-col');

      if (e.shiftKey) {
        if (self.secondarySortCol === colId) {
          self.secondarySortAsc = !self.secondarySortAsc;
        } else {
          self.secondarySortCol = colId;
          self.secondarySortAsc = true;
        }
      } else {
        if (self.sortCol === colId) {
          self.sortAsc = !self.sortAsc;
        } else {
          self.sortCol = colId;
          self.sortAsc = true;
          self.secondarySortCol = null;
        }
      }
      self.renderHeader();
      self.refresh();
    });

    // Column resizing drag
    this.headerEl.addEventListener('mousedown', function (e) {
      if (!e.target.classList.contains('mk-vth-resizer')) return;
      e.preventDefault();
      var colId = e.target.getAttribute('data-resizer');
      var startX = e.clientX;
      var colObj = self.columns.find(function (c) { return c.id === colId; });
      if (!colObj) return;
      var startWidth = colObj.width;

      function onMouseMove(moveEvt) {
        var delta = moveEvt.clientX - startX;
        colObj.width = Math.max(colObj.minWidth || 32, startWidth + delta);
        self.renderHeader();
        self.renderVirtualRows();
      }

      function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        self._saveColumns();
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Column drag and drop reordering
    var draggedColId = null;
    this.headerEl.addEventListener('dragstart', function (e) {
      var th = e.target.closest('.mk-vth');
      if (th) {
        draggedColId = th.getAttribute('data-col');
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', draggedColId);
      }
    });
    this.headerEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    this.headerEl.addEventListener('drop', function (e) {
      e.preventDefault();
      var targetTh = e.target.closest('.mk-vth');
      if (!targetTh || !draggedColId) return;
      var targetColId = targetTh.getAttribute('data-col');
      if (targetColId === draggedColId) return;

      var fromIdx = self.columns.findIndex(function (c) { return c.id === draggedColId; });
      var toIdx = self.columns.findIndex(function (c) { return c.id === targetColId; });
      if (fromIdx !== -1 && toIdx !== -1) {
        var colObj = self.columns.splice(fromIdx, 1)[0];
        self.columns.splice(toIdx, 0, colObj);
        self._saveColumns();
        self.renderHeader();
        self.renderVirtualRows();
      }
      draggedColId = null;
    });

    // Header context menu for column chooser
    this.headerEl.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      self.showColumnPickerMenu(e.clientX, e.clientY);
    });

    // Selection & Playback row clicks
    this.contentEl.addEventListener('click', function (e) {
      var row = e.target.closest('.mk-track-row');
      if (!row) return;
      var trackId = row.getAttribute('data-id');
      var rowIdx = parseInt(row.getAttribute('data-index'), 10);

      if (e.ctrlKey || e.metaKey) {
        if (self.selectedIds.has(trackId)) {
          self.selectedIds.delete(trackId);
        } else {
          self.selectedIds.add(trackId);
          self.lastSelectedId = trackId;
        }
      } else if (e.shiftKey && self.lastSelectedId) {
        var lastIdx = self.filteredTracks.findIndex(function (t) { return t.id === self.lastSelectedId; });
        if (lastIdx !== -1) {
          var start = Math.min(lastIdx, rowIdx);
          var end = Math.max(lastIdx, rowIdx);
          self.selectedIds.clear();
          for (var i = start; i <= end; i++) {
            self.selectedIds.add(self.filteredTracks[i].id);
          }
        }
      } else {
        self.selectedIds.clear();
        self.selectedIds.add(trackId);
        self.lastSelectedId = trackId;
      }
      self.activeRowIndex = rowIdx;
      self.updateSelectionVisuals();
    });

    // Double click to play
    var onDblClick = function (e) {
      var row = e.target.closest('.mk-track-row');
      if (!row) return;
      var trackId = row.getAttribute('data-id');
      var rowIdx = parseInt(row.getAttribute('data-index'), 10);
      if (isNaN(rowIdx)) {
        rowIdx = self.filteredTracks.findIndex(function (t) { return t.id === trackId; });
      }
      if (rowIdx !== -1) {
        self.playTrackAtIndex(rowIdx);
      }
    };
    this.contentEl.addEventListener('dblclick', onDblClick);
    this.scrollEl.addEventListener('dblclick', onDblClick);

    // Row Context Menu
    this.contentEl.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.mk-track-row');
      if (!row) return;
      e.preventDefault();
      var trackId = row.getAttribute('data-id');
      if (!self.selectedIds.has(trackId)) {
        self.selectedIds.clear();
        self.selectedIds.add(trackId);
        self.updateSelectionVisuals();
      }
      self.showContextMenu(e.clientX, e.clientY);
    });

    window.addEventListener('click', function (e) {
      if (self.contextMenuEl && !self.contextMenuEl.contains(e.target)) {
        self.contextMenuEl.hidden = true;
      }
    });

    // Keyboard shortcuts in table
    this.el.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl+A: Select all visible
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        self.selectedIds.clear();
        for (var i = 0; i < self.filteredTracks.length; i++) {
          self.selectedIds.add(self.filteredTracks[i].id);
        }
        self.updateSelectionVisuals();
        return;
      }

      // Escape: Clear search before clearing selection
      if (e.key === 'Escape') {
        e.preventDefault();
        if (self.filterQuery) {
          self.setFilter('');
          self.state.globalSearchQuery = '';
          self.state.emit('globalSearch', { query: '' });
          var searchInp = document.getElementById('mk-global-search-input');
          if (searchInp) searchInp.value = '';
          return;
        }
        self.selectedIds.clear();
        self.updateSelectionVisuals();
        return;
      }

      // Enter: Play selected
      if (e.key === 'Enter') {
        e.preventDefault();
        if (self.selectedIds.size > 0) {
          var selTracks = self.filteredTracks.filter(function (t) { return self.selectedIds.has(t.id); });
          if (selTracks.length > 1 && self.controller) {
            self.controller.setContext(selTracks, 0, { type: 'selection', name: 'Selected (' + selTracks.length + ')' }, true);
          } else if (selTracks.length === 1) {
            var idx = self.filteredTracks.findIndex(function (t) { return t.id === selTracks[0].id; });
            if (idx !== -1) self.playTrackAtIndex(idx);
          }
        }
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        self.confirmRemoveSelected();
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        if (self.filteredTracks.length > 0) {
          self.activeRowIndex = 0;
          var firstTrk = self.filteredTracks[0];
          if (!e.shiftKey) self.selectedIds.clear();
          self.selectedIds.add(firstTrk.id);
          self.lastSelectedId = firstTrk.id;
          self.updateSelectionVisuals();
          self.scrollRowIntoView(0);
        }
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        var lastIdx = self.filteredTracks.length - 1;
        if (lastIdx >= 0) {
          self.activeRowIndex = lastIdx;
          var lastTrk = self.filteredTracks[lastIdx];
          if (!e.shiftKey) self.selectedIds.clear();
          self.selectedIds.add(lastTrk.id);
          self.lastSelectedId = lastTrk.id;
          self.updateSelectionVisuals();
          self.scrollRowIntoView(lastIdx);
        }
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        var delta = 1;
        if (e.key === 'ArrowUp') delta = -1;
        if (e.key === 'PageDown') delta = 15;
        if (e.key === 'PageUp') delta = -15;

        var newIdx = Math.max(0, Math.min(self.filteredTracks.length - 1, self.activeRowIndex + delta));
        self.activeRowIndex = newIdx;
        var track = self.filteredTracks[newIdx];
        if (track) {
          if (!e.shiftKey) self.selectedIds.clear();
          self.selectedIds.add(track.id);
          self.lastSelectedId = track.id;
          self.updateSelectionVisuals();
          self.scrollRowIntoView(newIdx);
        }
      }
    });

    var emptyAddFolder = this.el.querySelector('#mk-empty-add-folder-btn');
    if (emptyAddFolder) {
      emptyAddFolder.addEventListener('click', function () {
        self.state.emit('requestAddFolder');
      });
    }

    var emptyAddFiles = this.el.querySelector('#mk-empty-add-files-btn');
    if (emptyAddFiles) {
      emptyAddFiles.addEventListener('click', function () {
        self.state.emit('requestAddFiles');
      });
    }

    this.state.on('trackChanged', function () { self.renderVirtualRows(); });
    this.state.on('playStateChanged', function () { self.renderVirtualRows(); });
    this.state.on('globalSearch', function (data) { self.setFilter(data.query); });
    this.state.on('libraryUpdated', function () { self.refresh(); });
    this.state.on('searchPlayResult', function () {
      if (!self.filteredTracks.length) return;
      var playIdx = 0;
      if (self.selectedIds.size > 0) {
        var firstId = Array.from(self.selectedIds)[0];
        var foundIdx = self.filteredTracks.findIndex(function (t) { return t.id === firstId; });
        if (foundIdx !== -1) playIdx = foundIdx;
      }
      self.playTrackAtIndex(playIdx);
    });
  };

  MakanTrackTable.prototype.selectAll = function () {
    this.selectedIds.clear();
    for (var i = 0; i < this.filteredTracks.length; i++) {
      this.selectedIds.add(this.filteredTracks[i].id);
    }
    this.updateSelectionVisuals();
  };

  MakanTrackTable.prototype.clearSelection = function () {
    this.selectedIds.clear();
    this.lastSelectedId = null;
    this.updateSelectionVisuals();
  };

  MakanTrackTable.prototype.showColumnPickerMenu = function (x, y) {
    var self = this;
    var html = '<div style="padding:6px 12px;font-size:11px;font-weight:700;color:var(--mk-accent-cyan);border-bottom:1px solid rgba(var(--mk-fg-rgb),0.08);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Columns</div>';
    for (var i = 0; i < this.columns.length; i++) {
      var col = this.columns[i];
      var checked = !col.hidden ? ' checked' : '';
      html += '<label class="mk-menu-item" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:5px 12px;">' +
        '<input type="checkbox" data-col-toggle="' + col.id + '"' + checked + '> ' +
        '<span>' + col.label + '</span>' +
      '</label>';
    }
    html += '<div class="mk-menu-sep"></div>' +
      '<div class="mk-menu-item" id="mk-col-restore-defaults" style="color:var(--mk-accent-cyan);font-weight:600;">Restore Default Columns</div>';

    this.contextMenuEl.innerHTML = html;
    this.contextMenuEl.style.left = Math.min(window.innerWidth - 180, x) + 'px';
    this.contextMenuEl.style.top = Math.min(window.innerHeight - 340, y) + 'px';
    this.contextMenuEl.hidden = false;

    var toggles = this.contextMenuEl.querySelectorAll('input[data-col-toggle]');
    for (var t = 0; t < toggles.length; t++) {
      toggles[t].addEventListener('change', function () {
        var colId = this.getAttribute('data-col-toggle');
        var colObj = self.columns.find(function (c) { return c.id === colId; });
        if (colObj) {
          colObj.hidden = !this.checked;
          self._saveColumns();
          self.renderHeader();
          self.renderVirtualRows();
        }
      });
    }

    var restoreBtn = this.contextMenuEl.querySelector('#mk-col-restore-defaults');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', function () {
        self.contextMenuEl.hidden = true;
        self.restoreDefaultColumns();
      });
    }
  };

  MakanTrackTable.prototype.scrollRowIntoView = function (index) {
    var rowTop = index * ROW_HEIGHT;
    var rowBottom = rowTop + ROW_HEIGHT;
    var viewTop = this.scrollEl.scrollTop;
    var viewBottom = viewTop + this.scrollEl.clientHeight;

    if (rowTop < viewTop) {
      this.scrollEl.scrollTop = rowTop;
    } else if (rowBottom > viewBottom) {
      this.scrollEl.scrollTop = rowBottom - this.scrollEl.clientHeight;
    }
  };

  MakanTrackTable.prototype.playTrackAtIndex = function (index) {
    if (index < 0 || index >= this.filteredTracks.length) return;
    var track = this.filteredTracks[index];

    if (this.controller) {
      var contextType = this.filterQuery ? 'search' : 'library';
      var contextName = this.filterQuery ? ('Search: ' + this.filterQuery) : 'All Tracks';
      this.controller.selectTrack(track, this.filteredTracks, { type: contextType, name: contextName });
    } else {
      this.state.currentTrack = track;
      this.engine.loadTrack(track, true);
    }
  };

  MakanTrackTable.prototype.showContextMenu = function (x, y) {
    var self = this;
    var selectedCount = this.selectedIds.size;
    var singleTrack = selectedCount === 1 ? this.state.tracks.find(function (t) { return self.selectedIds.has(t.id); }) : null;

    var countLabel = selectedCount > 1 ? (' (' + selectedCount + ')') : '';

    var html = '' +
      '<div class="mk-menu-item" data-action="play">' + window.MakanIcons.play() + ' <span>Play Selected' + countLabel + '</span></div>' +
      '<div class="mk-menu-item" data-action="play-next"><span>Play Next' + countLabel + '</span></div>' +
      '<div class="mk-menu-item" data-action="add-queue"><span>Add to Queue' + countLabel + '</span></div>' +
      '<div class="mk-menu-item" data-action="add-playlist"><span>Add to Playlist...' + countLabel + '</span></div>' +
      '<div class="mk-menu-sep"></div>' +
      '<div class="mk-menu-item" data-action="rescan-metadata"><span>Rescan Metadata' + countLabel + '</span></div>' +
      '<div class="mk-menu-item" data-action="locate-file"><span>Locate File</span></div>' +
      '<div class="mk-menu-item" data-action="show-folder"><span>Show in File Explorer</span></div>' +
      '<div class="mk-menu-sep"></div>' +
      '<div class="mk-menu-item mk-menu-danger" data-action="remove-library"><span>Remove from Library (No files deleted)</span></div>';

    this.contextMenuEl.innerHTML = html;
    this.contextMenuEl.style.left = Math.min(window.innerWidth - 220, x) + 'px';
    this.contextMenuEl.style.top = Math.min(window.innerHeight - 300, y) + 'px';
    this.contextMenuEl.hidden = false;

    var items = this.contextMenuEl.querySelectorAll('.mk-menu-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function () {
        var action = this.getAttribute('data-action');
        self.contextMenuEl.hidden = true;
        self.handleMenuAction(action, singleTrack);
      });
    }
  };

  MakanTrackTable.prototype.handleMenuAction = function (action, singleTrack) {
    var self = this;
    var selTracks = this.filteredTracks.filter(function (t) { return self.selectedIds.has(t.id); });
    if (!selTracks.length && singleTrack) selTracks = [singleTrack];

    if (action === 'play') {
      if (selTracks.length > 1 && this.controller) {
        this.controller.setContext(selTracks, 0, { type: 'selection', name: 'Selected (' + selTracks.length + ')' }, true);
      } else if (selTracks.length === 1) {
        var idx = this.filteredTracks.indexOf(selTracks[0]);
        this.playTrackAtIndex(idx);
      }
    } else if (action === 'play-next') {
      if (this.controller) this.controller.playNext(selTracks);
    } else if (action === 'add-queue') {
      if (this.controller) this.controller.addToQueue(selTracks);
    } else if (action === 'add-playlist') {
      var trackIds = selTracks.map(function (t) { return t.id; });
      this.state.emit('requestAddToPlaylist', { trackIds: trackIds });
    } else if (action === 'rescan-metadata') {
      var ids = selTracks.map(function (t) { return t.id; });
      if (window.MakanDesktop && window.MakanDesktop.rescanMetadata) {
        window.MakanDesktop.rescanMetadata(ids).then(function () {
          self.state.emit('requestRescan');
        });
      }
    } else if (action === 'locate-file') {
      var trk = singleTrack || selTracks[0];
      if (trk && window.MakanDesktop && window.MakanDesktop.chooseFiles) {
        window.MakanDesktop.chooseFiles().then(function (chosen) {
          if (chosen && chosen.length && window.MakanDesktop.relinkFolder) {
            // Relink file
            self.state.emit('requestRescan');
          }
        });
      }
    } else if (action === 'show-folder') {
      var tr = singleTrack || selTracks[0];
      if (tr && window.MakanDesktop && window.MakanDesktop.showInFolder) {
        window.MakanDesktop.showInFolder(tr.path);
      }
    } else if (action === 'remove-library') {
      this.confirmRemoveSelected();
    }
  };

  MakanTrackTable.prototype.confirmRemoveSelected = function () {
    var count = this.selectedIds.size;
    if (count === 0) return;
    var msg = 'Remove ' + count + ' selected ' + (count === 1 ? 'track' : 'tracks') + ' from your library?\n\nNOTE: Original audio files on your hard drive will NOT be deleted or moved.';
    if (window.confirm(msg)) {
      var idsToRemove = Array.from(this.selectedIds);
      this.state.emit('requestRemoveTracks', { trackIds: idsToRemove });
      this.selectedIds.clear();
      this.updateSelectionVisuals();
    }
  };

  MakanTrackTable.naturalCompare = naturalCompare;
  MakanTrackTable.parseSearchQuery = parseSearchQuery;
  MakanTrackTable.filterTrack = filterTrack;

  return MakanTrackTable;
});
