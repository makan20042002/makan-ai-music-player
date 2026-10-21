'use strict';
/*
 * media/components/playback-controller.js - Dedicated Playback, Queue & Shuffle Controller.
 * True Shuffle 2.0 & Professional Queue implementation.
 * Operates independently of UI components.
 * Implements:
 * - Playback Contexts (Library, Search Results, Playlist, Artist, Album, Genre, Folder, Selection)
 * - True Shuffle 2.0: Persistent shuffle-bag system using stable track IDs
 * - Three Shuffle Modes: 'off' (Sequential), 'tracks' (True Shuffle), 'albums' (Shuffle Albums)
 * - Strict 5-tier playback priority (Repeat One -> Explicit Queue -> Forward History -> Shuffle Bag -> Sequential)
 * - Forward & Backward playback history navigation (Previous with 3s rule, Next forward history)
 * - Priority Explicit Queue (Play Now, Play Next, Add to Queue, Drag Reorder, Multi-Select Remove, Clear)
 * - Non-resetting shuffle cycle upon manual selection of played tracks
 * - Dynamic library changes handling (random insertion of new tracks, safe removal of deleted tracks)
 * - Fast O(1) track index and object lookups for 50,000+ tracks
 * - Versioned durable persistence across restarts with safe recovery
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
    module.exports.MakanPlaybackController = mod.MakanPlaybackController;
    module.exports.createPrng = mod.createPrng;
    module.exports.fisherYates = mod.fisherYates;
  }
  var target = typeof window !== 'undefined' ? window : root;
  if (target) {
    target.MakanPlaybackController = mod.MakanPlaybackController;
    target.MakanPlaybackUtils = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // Seedable Pseudo-Random Number Generator (Mulberry32) for deterministic tests
  function createPrng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Unbiased Fisher-Yates shuffle
  function fisherYates(array, rng) {
    var r = rng || Math.random;
    var a = array.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var temp = a[i];
      a[i] = a[j];
      a[j] = temp;
    }
    return a;
  }

  function MakanPlaybackController(state, engine, options) {
    this.state = state;
    this.engine = engine;
    this.options = options || {};

    this.rng = this.options.rng || Math.random;

    // Active Playback Context (the ordered set of tracks active from Library, Search, Playlist, etc.)
    this.context = {
      type: 'library', // 'library' | 'search' | 'playlist' | 'artist' | 'album' | 'genre' | 'folder' | 'selection'
      name: 'All Tracks',
      tracks: []
    };
    this.contextIndex = -1;

    // Fast O(1) track lookup maps for 50,000+ track scalability
    this._trackIndexMap = new Map();
    this._trackMap = new Map();

    // Priority Explicit Queue (user added tracks take priority before resuming context)
    this.explicitQueue = [];

    // Navigation stacks
    this.history = [];         // Tracks played in the past (backward navigation)
    this.forwardHistory = [];  // Tracks popped during Previous (forward navigation)

    // True Shuffle Bag: contains unplayed track IDs from the active playback context
    this.shuffledBag = [];
    this.cycleId = null;       // Shuffle cycle identifier

    // Shuffle mode: 'off' | 'tracks' | 'albums'
    this.shuffleMode = (this.state && this.state.shuffleMode) || (this.state && this.state.shuffle ? 'tracks' : 'off');
    if (this.state) {
      this.state.shuffleMode = this.shuffleMode;
      this.state.shuffle = (this.shuffleMode !== 'off');
    }

    this.activeExplicitTrack = null;

    // Properties for backwards compatibility
    this.queue = [];
    this.queueIndex = -1;

    this.playbackRate = 1.0;
    this.loopA = null;
    this.loopB = null;

    this.persistenceAdapter = this.options.persistenceAdapter || null;
    this._debounceSaveMs = (typeof this.options.debounceSaveMs === 'number') ? this.options.debounceSaveMs : 250;
    this._saveTimer = null;
    this._lastSnapshot = null;

    if (this.engine && typeof this.engine.setController === 'function') {
      this.engine.setController(this);
    }

    this._bindEngineEvents();
  }

  MakanPlaybackController.prototype._bindEngineEvents = function () {
    var self = this;
    if (!this.engine || !this.engine.audio) return;

    var audio = this.engine.audio;

    audio.addEventListener('ended', function () {
      self.onTrackEnded();
    });

    audio.addEventListener('timeupdate', function () {
      if (self.loopA !== null && self.loopB !== null && self.loopB > self.loopA) {
        if (audio.currentTime >= self.loopB) {
          audio.currentTime = self.loopA;
        }
      }
    });
  };

  MakanPlaybackController.prototype.onTrackEnded = function () {
    if (this.state.repeatMode === 'one') {
      this.engine.seek(0);
      this.engine.play();
    } else {
      this.next(false);
    }
  };

  MakanPlaybackController.prototype.setRng = function (rngFn) {
    if (typeof rngFn === 'function') {
      this.rng = rngFn;
    }
  };

  MakanPlaybackController.prototype._rebuildIndexMap = function () {
    this._trackIndexMap.clear();
    this._trackMap.clear();
    var trks = this.context.tracks;
    for (var i = 0; i < trks.length; i++) {
      var t = trks[i];
      if (t && t.id) {
        this._trackIndexMap.set(t.id, i);
        this._trackMap.set(t.id, t);
      }
    }
  };

  MakanPlaybackController.prototype._findTrackIndexInContext = function (trackId) {
    if (!trackId) return -1;
    if (this._trackIndexMap.has(trackId)) {
      return this._trackIndexMap.get(trackId);
    }
    // Fallback if map not yet initialized
    for (var i = 0; i < this.context.tracks.length; i++) {
      if (this.context.tracks[i].id === trackId) return i;
    }
    return -1;
  };

  /* ---------------- Playback Context ---------------- */

  MakanPlaybackController.prototype.setContext = function (tracks, startIndex, contextInfo, autoPlay) {
    var list = (tracks || []).slice();
    var idx = (startIndex >= 0 && startIndex < list.length) ? startIndex : (list.length ? 0 : -1);

    this.context = {
      type: (contextInfo && contextInfo.type) || 'library',
      name: (contextInfo && contextInfo.name) || 'Library',
      tracks: list
    };
    this.contextIndex = idx;
    this.queue = list;
    this.queueIndex = idx;

    this._rebuildIndexMap();

    // Clear forward history on intentional context change
    this.forwardHistory = [];
    this.activeExplicitTrack = null;

    var curTrack = (idx >= 0 && idx < list.length) ? list[idx] : null;

    // Rebuild shuffle bag for new context if shuffle is active
    if (this.shuffleMode !== 'off') {
      this.reshuffleBag(curTrack ? curTrack.id : null, false);
    } else {
      this.shuffledBag = [];
      this.cycleId = null;
    }

    if (curTrack) {
      this._activateTrack(curTrack, !!autoPlay);
    }

    this.state.emit('contextChanged', { context: this.context, index: this.contextIndex });
    this.state.emit('queueChanged', { queue: this.queue, index: this.queueIndex });
    this.saveState();
  };

  // Backwards compatibility alias
  MakanPlaybackController.prototype.setQueue = function (tracks, startIndex, autoPlay) {
    this.setContext(tracks, startIndex, { type: 'library', name: 'Library' }, autoPlay);
  };

  MakanPlaybackController.prototype.getCurrentTrack = function () {
    if (this.activeExplicitTrack) {
      return this.activeExplicitTrack;
    }
    if (this.contextIndex >= 0 && this.contextIndex < this.context.tracks.length) {
      return this.context.tracks[this.contextIndex];
    }
    if (this.state && this.state.currentTrack) {
      return this.state.currentTrack;
    }
    return null;
  };

  /**
   * O(1) removal of an unplayed track from the reverse shuffle bag via swap-and-pop.
   * Avoids destructive O(N) array shifts in JavaScript engine.
   */
  MakanPlaybackController.prototype._removeTrackFromBag = function (trackId) {
    if (!trackId || !this.shuffledBag || !this.shuffledBag.length) return false;
    var idx = this.shuffledBag.lastIndexOf(trackId);
    if (idx !== -1) {
      var lastIdx = this.shuffledBag.length - 1;
      if (idx !== lastIdx) {
        this.shuffledBag[idx] = this.shuffledBag[lastIdx];
      }
      this.shuffledBag.pop();
      return true;
    }
    return false;
  };

  /* ---------------- Manual Track Selection ---------------- */

  MakanPlaybackController.prototype.selectTrack = function (track, tracksIfNewContext, contextInfo) {
    if (!track) return;

    var idx = this._findTrackIndexInContext(track.id);
    var isSameContext = idx !== -1 && (!contextInfo || contextInfo.name === this.context.name || !this.context.tracks.length);

    if (isSameContext) {
      var cur = this.getCurrentTrack();
      if (cur) this.history.push(cur);
      this.forwardHistory = [];
      this.activeExplicitTrack = null;
      this.contextIndex = idx;
      this.queueIndex = idx;

      if (this.shuffleMode !== 'off') {
        if (this._removeTrackFromBag(track.id)) {
          this.state.emit('shuffleBagChanged', {
            remaining: this.shuffledBag.length,
            cycleId: this.cycleId,
            shuffleMode: this.shuffleMode
          });
        }
        // If already played, DO NOT reset the shuffle cycle. Remaining bag and cycleId stay intact.
      }

      this._activateTrack(track, true);
      this.saveState();
    } else {
      // New context activation
      var list = tracksIfNewContext || [track];
      var startIdx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === track.id) { startIdx = i; break; }
      }
      this.setContext(list, startIdx !== -1 ? startIdx : 0, contextInfo || { type: 'library', name: 'Library' }, true);
    }
  };

  MakanPlaybackController.prototype.playIndex = function (index) {
    if (index >= 0 && index < this.context.tracks.length) {
      this.selectTrack(this.context.tracks[index]);
    }
  };

  /* ---------------- True Shuffle 2.0 ---------------- */

  MakanPlaybackController.prototype._generateCycleId = function () {
    return 'cycle_' + Date.now() + '_' + Math.floor(this.rng() * 1000000).toString(36);
  };

  MakanPlaybackController.prototype._buildAlbumShuffledBag = function (excludeTrackId, isRefill) {
    var tracks = this.context.tracks;
    if (!tracks || !tracks.length) return [];

    // Group tracks by album
    var albumMap = new Map();
    var albumOrder = [];

    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var albumKey = (t.album && t.album.trim()) ? t.album.trim().toLowerCase() : ('__no_album_' + t.id);
      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, {
          key: albumKey,
          tracks: []
        });
        albumOrder.push(albumKey);
      }
      albumMap.get(albumKey).tracks.push(t);
    }

    // Sort tracks within each album by disc_num, track_num, or context order
    albumMap.forEach(function (group) {
      group.tracks.sort(function (a, b) {
        var da = a.disc_num != null ? a.disc_num : 1;
        var db = b.disc_num != null ? b.disc_num : 1;
        if (da !== db) return da - db;
        var ta = a.track_num != null ? a.track_num : 0;
        var tb = b.track_num != null ? b.track_num : 0;
        if (ta !== tb) return ta - tb;
        return 0;
      });
    });

    var shuffledAlbums;
    var currentAlbumKey = null;
    if (excludeTrackId) {
      var lastTrack = this._trackMap.get(excludeTrackId);
      if (lastTrack) {
        currentAlbumKey = (lastTrack.album && lastTrack.album.trim()) ? lastTrack.album.trim().toLowerCase() : ('__no_album_' + lastTrack.id);
      }
    }

    if (!isRefill && currentAlbumKey && albumMap.has(currentAlbumKey)) {
      // User activated Shuffle Albums during an active track in currentAlbumKey:
      // Keep currentAlbumKey at the head so the remainder of this album plays contiguously
      // without splitting or interleaving the album.
      var otherAlbums = [];
      for (var o = 0; o < albumOrder.length; o++) {
        if (albumOrder[o] !== currentAlbumKey) {
          otherAlbums.push(albumOrder[o]);
        }
      }
      shuffledAlbums = [currentAlbumKey].concat(fisherYates(otherAlbums, this.rng));
    } else {
      // Randomize all albums using Fisher-Yates
      shuffledAlbums = fisherYates(albumOrder, this.rng);

      // If refill and an excludeTrackId is given, ensure the first album of new cycle isn't the album that just finished
      if (isRefill && currentAlbumKey && shuffledAlbums.length > 1) {
        if (shuffledAlbums[0] === currentAlbumKey) {
          var swapIdx = 1 + Math.floor(this.rng() * (shuffledAlbums.length - 1));
          var tmp = shuffledAlbums[0];
          shuffledAlbums[0] = shuffledAlbums[swapIdx];
          shuffledAlbums[swapIdx] = tmp;
        }
      }
    }

    // Flatten into sequence of track IDs
    var bag = [];
    for (var a = 0; a < shuffledAlbums.length; a++) {
      var grp = albumMap.get(shuffledAlbums[a]);
      if (grp && grp.tracks) {
        for (var tr = 0; tr < grp.tracks.length; tr++) {
          var trkId = grp.tracks[tr].id;
          if (!isRefill && excludeTrackId && trkId === excludeTrackId) {
            continue;
          }
          bag.push(trkId);
        }
      }
    }

    return bag;
  };

  MakanPlaybackController.prototype.reshuffleBag = function (excludeId, isRefill) {
    var tracks = this.context.tracks;
    if (!tracks.length) {
      this.shuffledBag = [];
      this.cycleId = null;
      this.state.emit('shuffleBagChanged', { remaining: 0, cycleId: null, shuffleMode: this.shuffleMode });
      return;
    }

    this.cycleId = this._generateCycleId();

    if (tracks.length === 1) {
      this.shuffledBag = [tracks[0].id];
      this.state.emit('shuffleBagChanged', { remaining: 1, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
      return;
    }

    if (this.shuffleMode === 'albums') {
      var albumBag = this._buildAlbumShuffledBag(excludeId, isRefill);
      // Reverse array so next track is popped from top of stack in O(1)
      this.shuffledBag = albumBag.reverse();
    } else {
      // 'tracks' - True Shuffle (unbiased Fisher-Yates reverse stack)
      if (isRefill) {
        var allIds = [];
        for (var t = 0; t < tracks.length; t++) {
          allIds.push(tracks[t].id);
        }
        var shuffled = fisherYates(allIds, this.rng);
        // Reverse so pop() draws tracks in sequence in O(1)
        this.shuffledBag = shuffled.reverse();

        // Boundary collision prevention: Ensure the next track to be popped (top of stack)
        // is never the track that just finished at the cycle boundary
        var topIdx = this.shuffledBag.length - 1;
        if (excludeId && topIdx > 0 && this.shuffledBag[topIdx] === excludeId) {
          var swapIdx = Math.floor(this.rng() * topIdx);
          var tmp = this.shuffledBag[topIdx];
          this.shuffledBag[topIdx] = this.shuffledBag[swapIdx];
          this.shuffledBag[swapIdx] = tmp;
        }
      } else {
        // Fresh activation: all eligible tracks from context except current
        var remaining = [];
        for (var i = 0; i < tracks.length; i++) {
          var id = tracks[i].id;
          if (!excludeId || id !== excludeId) {
            remaining.push(id);
          }
        }
        if (remaining.length === 0 && tracks.length > 0) {
          remaining = [tracks[0].id];
        }
        this.shuffledBag = fisherYates(remaining, this.rng).reverse();
      }
    }

    this.state.emit('shuffleBagChanged', {
      remaining: this.shuffledBag.length,
      cycleId: this.cycleId,
      shuffleMode: this.shuffleMode
    });
  };

  MakanPlaybackController.prototype.setShuffleMode = function (mode) {
    var valid = (mode === 'tracks' || mode === 'albums') ? mode : 'off';
    if (this.shuffleMode === valid && this.shuffledBag.length > 0) {
      return;
    }

    this.shuffleMode = valid;
    this.state.shuffleMode = valid;
    this.state.shuffle = (valid !== 'off');

    if (valid !== 'off') {
      var cur = this.getCurrentTrack();
      this.reshuffleBag(cur ? cur.id : null, false);
    } else {
      this.shuffledBag = [];
      this.cycleId = null;
      this.state.emit('shuffleBagChanged', { remaining: 0, cycleId: null, shuffleMode: 'off' });
    }

    this.state.emit('shuffleChanged', { shuffle: this.state.shuffle, shuffleMode: this.shuffleMode });
    this.saveState();
  };

  MakanPlaybackController.prototype.cycleShuffleMode = function () {
    var next = this.shuffleMode === 'off' ? 'tracks' : (this.shuffleMode === 'tracks' ? 'albums' : 'off');
    this.setShuffleMode(next);
    return next;
  };

  // Backwards compatibility alias
  MakanPlaybackController.prototype.setShuffle = function (enabled) {
    if (typeof enabled === 'string') {
      this.setShuffleMode(enabled);
    } else {
      this.setShuffleMode(enabled ? 'tracks' : 'off');
    }
  };

  Object.defineProperty(MakanPlaybackController.prototype, 'shuffle', {
    get: function () {
      return this.shuffleMode !== 'off';
    },
    set: function (val) {
      this.setShuffle(val);
    },
    enumerable: true,
    configurable: true
  });

  MakanPlaybackController.prototype.reshuffleRemaining = function () {
    if (this.shuffledBag.length > 1) {
      this.shuffledBag = fisherYates(this.shuffledBag, this.rng);
      this.state.emit('shuffleBagChanged', {
        remaining: this.shuffledBag.length,
        cycleId: this.cycleId,
        shuffleMode: this.shuffleMode
      });
      this.saveState();
    }
  };

  /* ---------------- Priority Explicit Queue ---------------- */

  MakanPlaybackController.prototype.playNow = function (track) {
    if (!track) return;
    var cur = this.getCurrentTrack();
    if (cur) this.history.push(cur);
    this.forwardHistory = [];

    // Remove from explicit queue if present
    var expIdx = -1;
    for (var i = 0; i < this.explicitQueue.length; i++) {
      if (this.explicitQueue[i].id === track.id) { expIdx = i; break; }
    }
    if (expIdx !== -1) {
      this.explicitQueue.splice(expIdx, 1);
      this.state.queueCount = this.explicitQueue.length;
      this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
    }

    var idx = this._findTrackIndexInContext(track.id);
    if (idx !== -1) {
      this.contextIndex = idx;
      this.queueIndex = idx;
      this.activeExplicitTrack = null;
      if (this.shuffleMode !== 'off') {
        if (this._removeTrackFromBag(track.id)) {
          this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
        }
      }
      this._activateTrack(track, true);
    } else {
      this.activeExplicitTrack = track;
      this._activateTrack(track, true);
    }
    this.saveState();
  };

  MakanPlaybackController.prototype.playNext = function (tracks) {
    var items = Array.isArray(tracks) ? tracks : [tracks];
    if (!items.length) return;

    for (var i = items.length - 1; i >= 0; i--) {
      this.explicitQueue.unshift(items[i]);
    }
    this.state.queueCount = this.explicitQueue.length;

    this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
    this.saveState();
  };

  MakanPlaybackController.prototype.addToQueue = function (tracks) {
    var items = Array.isArray(tracks) ? tracks : [tracks];
    if (!items.length) return;

    for (var i = 0; i < items.length; i++) {
      this.explicitQueue.push(items[i]);
    }
    this.state.queueCount = this.explicitQueue.length;

    this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
    this.saveState();
  };

  MakanPlaybackController.prototype.removeFromQueue = function (index) {
    if (this.explicitQueue.length > 0 && index >= 0 && index < this.explicitQueue.length) {
      this.explicitQueue.splice(index, 1);
      this.state.queueCount = this.explicitQueue.length;
      this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
      this.saveState();
      return;
    }

    // Context item removal
    if (index < 0 || index >= this.context.tracks.length) return;
    var removed = this.context.tracks.splice(index, 1)[0];
    this.queue = this.context.tracks;
    this._rebuildIndexMap();

    if (removed) {
      this._removeTrackFromBag(removed.id);
      this.history = this.history.filter(function (t) { return t.id !== removed.id; });
      this.forwardHistory = this.forwardHistory.filter(function (t) { return t.id !== removed.id; });
    }

    if (index === this.contextIndex) {
      if (this.context.tracks.length === 0) {
        this.contextIndex = -1;
        this.queueIndex = -1;
        this.engine.pause();
        this.state.currentTrack = null;
        this.state.setPlayState(false);
      } else {
        if (this.contextIndex >= this.context.tracks.length) {
          this.contextIndex = 0;
        }
        this.queueIndex = this.contextIndex;
        this._activateTrack(this.context.tracks[this.contextIndex], true);
      }
    } else if (index < this.contextIndex) {
      this.contextIndex--;
      this.queueIndex = this.contextIndex;
    }

    this.state.emit('queueChanged', { queue: this.context.tracks, index: this.contextIndex });
    this.saveState();
  };

  MakanPlaybackController.prototype.removeSelectedFromQueue = function (indices) {
    if (!Array.isArray(indices) || !indices.length) return;
    var sorted = indices.slice().sort(function (a, b) { return b - a; });
    for (var i = 0; i < sorted.length; i++) {
      var idx = sorted[i];
      if (idx >= 0 && idx < this.explicitQueue.length) {
        this.explicitQueue.splice(idx, 1);
      }
    }
    this.state.queueCount = this.explicitQueue.length;
    this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
    this.saveState();
  };

  MakanPlaybackController.prototype.removeTrackById = function (trackId) {
    var self = this;
    this.explicitQueue = this.explicitQueue.filter(function (t) { return t.id !== trackId; });
    this.history = this.history.filter(function (t) { return t.id !== trackId; });
    this.forwardHistory = this.forwardHistory.filter(function (t) { return t.id !== trackId; });
    this._removeTrackFromBag(trackId);

    var ctxIdx = this._findTrackIndexInContext(trackId);
    if (ctxIdx !== -1) {
      this.removeFromQueue(ctxIdx);
    } else {
      this.state.queueCount = this.explicitQueue.length;
      this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
      this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
      this.saveState();
    }
  };

  MakanPlaybackController.prototype.removeTracksByIds = function (trackIds) {
    if (!Array.isArray(trackIds) || !trackIds.length) return;
    var set = new Set(trackIds);

    this.explicitQueue = this.explicitQueue.filter(function (t) { return !set.has(t.id); });
    this.history = this.history.filter(function (t) { return !set.has(t.id); });
    this.forwardHistory = this.forwardHistory.filter(function (t) { return !set.has(t.id); });
    this.shuffledBag = this.shuffledBag.filter(function (id) { return !set.has(id); });

    var cur = this.getCurrentTrack();
    var curRemoved = cur && set.has(cur.id);

    this.context.tracks = this.context.tracks.filter(function (t) { return !set.has(t.id); });
    this.queue = this.context.tracks;
    this._rebuildIndexMap();

    if (curRemoved) {
      if (this.context.tracks.length > 0) {
        this.next(false);
      } else {
        this.contextIndex = -1;
        this.queueIndex = -1;
        this.engine.pause();
        this.state.currentTrack = null;
        this.state.setPlayState(false);
      }
    } else if (cur) {
      this.contextIndex = this._findTrackIndexInContext(cur.id);
      this.queueIndex = this.contextIndex;
    }

    this.state.queueCount = this.explicitQueue.length;
    this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length, queue: this.queue });
    this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
    this.saveState();
  };

  MakanPlaybackController.prototype.clearQueue = function () {
    this.explicitQueue = [];
    this.state.queueCount = 0;
    this.state.emit('queueChanged', { explicitQueue: [], count: 0 });
    this.saveState();
  };

  MakanPlaybackController.prototype.reorderQueue = function (fromIdx, toIdx) {
    if (this.explicitQueue.length > 0) {
      if (fromIdx < 0 || fromIdx >= this.explicitQueue.length || toIdx < 0 || toIdx >= this.explicitQueue.length) return;
      var item = this.explicitQueue.splice(fromIdx, 1)[0];
      this.explicitQueue.splice(toIdx, 0, item);
      this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
      this.saveState();
      return;
    }

    // Reorder context tracks
    if (fromIdx < 0 || fromIdx >= this.context.tracks.length || toIdx < 0 || toIdx >= this.context.tracks.length) return;
    var ctxItem = this.context.tracks.splice(fromIdx, 1)[0];
    this.context.tracks.splice(toIdx, 0, ctxItem);
    this._rebuildIndexMap();

    if (this.contextIndex === fromIdx) {
      this.contextIndex = toIdx;
    } else if (fromIdx < this.contextIndex && toIdx >= this.contextIndex) {
      this.contextIndex--;
    } else if (fromIdx > this.contextIndex && toIdx <= this.contextIndex) {
      this.contextIndex++;
    }
    this.queue = this.context.tracks;
    this.queueIndex = this.contextIndex;

    this.state.emit('queueChanged', { queue: this.queue, index: this.contextIndex });
    this.saveState();
  };

  /* ---------------- Dynamic Library Changes During Shuffle ---------------- */

  MakanPlaybackController.prototype.addTracksToContext = function (tracks) {
    var items = Array.isArray(tracks) ? tracks : [tracks];
    if (!items.length) return;

    for (var i = 0; i < items.length; i++) {
      var t = items[i];
      if (!t || !t.id) continue;
      // Prevent duplicate paths / duplicate IDs in context
      if (this._trackMap.has(t.id)) continue;

      this.context.tracks.push(t);
      this._trackIndexMap.set(t.id, this.context.tracks.length - 1);
      this._trackMap.set(t.id, t);

      if (this.shuffleMode !== 'off') {
        // Insert at random position into unplayed shuffle bag
        var insertPos = Math.floor(this.rng() * (this.shuffledBag.length + 1));
        this.shuffledBag.splice(insertPos, 0, t.id);
      }
    }

    this.queue = this.context.tracks;
    this.state.emit('queueChanged', { queue: this.queue, index: this.contextIndex });
    this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
    this.saveState();
  };

  MakanPlaybackController.prototype.reconcileLibrary = function (newTracks) {
    if (!Array.isArray(newTracks)) return;

    var newMap = new Map();
    for (var n = 0; n < newTracks.length; n++) {
      newMap.set(newTracks[n].id, newTracks[n]);
    }

    var existingIds = new Set();
    var retainedContextTracks = [];

    for (var i = 0; i < this.context.tracks.length; i++) {
      var curTrk = this.context.tracks[i];
      if (newMap.has(curTrk.id)) {
        existingIds.add(curTrk.id);
        retainedContextTracks.push(newMap.get(curTrk.id)); // Use refreshed metadata
      }
    }

    // Identify newly added tracks
    var addedTracks = [];
    for (var j = 0; j < newTracks.length; j++) {
      var cand = newTracks[j];
      if (!existingIds.has(cand.id)) {
        addedTracks.push(cand);
        retainedContextTracks.push(cand);
      }
    }

    this.context.tracks = retainedContextTracks;
    this.queue = this.context.tracks;
    this._rebuildIndexMap();

    // Remove deleted tracks from bag, queue, history
    this.shuffledBag = this.shuffledBag.filter(function (id) { return newMap.has(id); });
    this.explicitQueue = this.explicitQueue.filter(function (t) { return newMap.has(t.id); });
    this.history = this.history.filter(function (t) { return newMap.has(t.id); });
    this.forwardHistory = this.forwardHistory.filter(function (t) { return newMap.has(t.id); });

    // Insert newly discovered tracks at random positions in remaining shuffle bag
    if (this.shuffleMode !== 'off' && addedTracks.length > 0) {
      for (var a = 0; a < addedTracks.length; a++) {
        var pos = Math.floor(this.rng() * (this.shuffledBag.length + 1));
        this.shuffledBag.splice(pos, 0, addedTracks[a].id);
      }
    }

    var cur = this.getCurrentTrack();
    if (cur) {
      this.contextIndex = this._findTrackIndexInContext(cur.id);
      this.queueIndex = this.contextIndex;
    }

    this.state.emit('queueChanged', { queue: this.queue, index: this.contextIndex });
    this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
    this.saveState();
  };

  /* ---------------- Gapless & Preload Navigation ---------------- */

  MakanPlaybackController.prototype.peekNext = function () {
    if (this.state.repeatMode === 'one') {
      return this.getCurrentTrack();
    }
    if (this.explicitQueue.length > 0) {
      return this.explicitQueue[0];
    }
    if (this.forwardHistory.length > 0) {
      return this.forwardHistory[this.forwardHistory.length - 1];
    }
    if (this.shuffleMode !== 'off') {
      if (this.shuffledBag.length > 0) {
        var nxtId = this.shuffledBag[this.shuffledBag.length - 1];
        var nxtTrk = this._trackMap.get(nxtId);
        if (nxtTrk) return nxtTrk;
      }
      return null;
    }
    // Sequential
    var nextIdx = this.contextIndex + 1;
    if (nextIdx < this.context.tracks.length) {
      return this.context.tracks[nextIdx];
    }
    if (this.state.repeatMode === 'all' && this.context.tracks.length > 0) {
      return this.context.tracks[0];
    }
    return null;
  };

  MakanPlaybackController.prototype.advanceToPreloadedNext = function (track) {
    if (!track) return;
    var cur = this.getCurrentTrack();
    if (cur) this.history.push(cur);

    if (this.explicitQueue.length > 0 && this.explicitQueue[0].id === track.id) {
      this.explicitQueue.shift();
      this.activeExplicitTrack = track;
      this.state.queueCount = this.explicitQueue.length;
      this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
    } else if (this.forwardHistory.length > 0 && this.forwardHistory[this.forwardHistory.length - 1].id === track.id) {
      this.forwardHistory.pop();
      this.activeExplicitTrack = null;
      var fIdx = this._findTrackIndexInContext(track.id);
      if (fIdx !== -1) {
        this.contextIndex = fIdx;
        this.queueIndex = fIdx;
      }
    } else {
      this.activeExplicitTrack = null;
      if (this.shuffleMode !== 'off' && this.shuffledBag.length > 0 && this.shuffledBag[this.shuffledBag.length - 1] === track.id) {
        this.shuffledBag.pop();
        this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
      }
      var idx = this._findTrackIndexInContext(track.id);
      if (idx !== -1) {
        this.contextIndex = idx;
        this.queueIndex = idx;
      }
    }

    this.state.currentTrack = track;
    this.state.duration = track.duration || 0;
    this.state.currentTime = 0;
    this.state.currentLyricIndex = 0;
    this.state.syncOffset = track.sync_offset || 0.0;
    this.state.emit('trackChanged', { track: track, index: this.contextIndex, context: this.context });
    this.saveState();
  };

  /* ---------------- Navigation ---------------- */

  MakanPlaybackController.prototype.next = function (userInitiated) {
    var cur = this.getCurrentTrack();

    // Priority 1: Repeat One when automatic progression
    if (!userInitiated && this.state.repeatMode === 'one' && cur) {
      this.engine.seek(0);
      this.engine.play();
      return;
    }

    // Priority 2: Priority Explicit Queue
    if (this.explicitQueue.length > 0) {
      if (cur) this.history.push(cur);
      var qTrack = this.explicitQueue.shift();
      this.activeExplicitTrack = qTrack;
      this.state.queueCount = this.explicitQueue.length;
      this.state.emit('queueChanged', { explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
      this._activateTrack(qTrack, true);
      this.saveState();
      return;
    }

    // Priority 3: Forward history (when user previously navigated backward)
    if (this.forwardHistory.length > 0) {
      if (cur) this.history.push(cur);
      this.activeExplicitTrack = null;
      var fwdTrack = this.forwardHistory.pop();
      var fwdIdx = this._findTrackIndexInContext(fwdTrack.id);
      if (fwdIdx !== -1) {
        this.contextIndex = fwdIdx;
        this.queueIndex = fwdIdx;
      }
      this._activateTrack(fwdTrack, true);
      this.saveState();
      return;
    }

    // Priority 4 & 5: Playback Context Progression
    this.activeExplicitTrack = null;
    if (!this.context.tracks.length) return;

    // Priority 4: True Shuffle Bag (tracks or albums)
    if (this.shuffleMode !== 'off') {
      if (!this.shuffledBag.length) {
        if (this.state.repeatMode === 'all') {
          this.reshuffleBag(cur ? cur.id : null, true);
        } else if (this.state.repeatMode === 'off') {
          // Clean stop when complete shuffle cycle finishes with Repeat Off
          this.engine.pause();
          this.engine.seek(0);
          this.state.setPlayState(false);
          this.state.emit('playbackEnded');
          this.saveState();
          return;
        }
      }

      if (this.shuffledBag.length > 0) {
        if (cur) this.history.push(cur);
        var nextId = this.shuffledBag.pop();
        this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });

        var nextTrk = this._trackMap.get(nextId);
        var nextIdx = this._findTrackIndexInContext(nextId);
        if (nextIdx !== -1 && nextTrk) {
          this.contextIndex = nextIdx;
          this.queueIndex = nextIdx;
          this._activateTrack(nextTrk, true);
          this.saveState();
          return;
        }
      }
    }

    // Priority 5: Normal sequential playlist order when shuffle is disabled
    if (cur) this.history.push(cur);

    var seqIdx = this.contextIndex + 1;
    if (seqIdx >= this.context.tracks.length) {
      if (this.state.repeatMode === 'all') {
        seqIdx = 0;
      } else {
        // Stopped cleanly at end of list
        this.engine.pause();
        this.engine.seek(0);
        this.state.setPlayState(false);
        this.state.emit('playbackEnded');
        this.saveState();
        return;
      }
    }

    this.contextIndex = seqIdx;
    this.queueIndex = seqIdx;
    this._activateTrack(this.context.tracks[this.contextIndex], true);
    this.saveState();
  };

  MakanPlaybackController.prototype.previous = function () {
    if (!this.context.tracks.length && !this.explicitQueue.length && !this.history.length) return;

    // If played more than 3 seconds, restart current track cleanly
    var currentPos = (this.engine && this.engine.audio) ? (this.engine.audio.currentTime || 0) : (this.state.currentTime || 0);
    if (currentPos > 3.0) {
      this.engine.seek(0);
      return;
    }

    this.activeExplicitTrack = null;
    var cur = this.getCurrentTrack();

    // Navigate actual played history
    if (this.history.length > 0) {
      var prevTrack = this.history.pop();
      if (cur) this.forwardHistory.push(cur);

      var idx = this._findTrackIndexInContext(prevTrack.id);
      if (idx !== -1) {
        this.contextIndex = idx;
        this.queueIndex = idx;
      }
      this._activateTrack(prevTrack, true);
      this.saveState();
      return;
    }

    // Fallback: previous item in context
    var prevIdx = this.contextIndex - 1;
    if (prevIdx < 0) {
      prevIdx = this.state.repeatMode === 'all' ? (this.context.tracks.length - 1) : 0;
    }
    if (cur) this.forwardHistory.push(cur);
    this.contextIndex = prevIdx;
    this.queueIndex = prevIdx;
    this._activateTrack(this.context.tracks[this.contextIndex], true);
    this.saveState();
  };

  MakanPlaybackController.prototype.clearHistory = function () {
    this.history = [];
    this.forwardHistory = [];
    this.saveState();
  };

  MakanPlaybackController.prototype.setRepeatMode = function (mode) {
    if (mode === 'off' || mode === 'all' || mode === 'one') {
      this.state.repeatMode = mode;
      this.state.emit('repeatChanged', { repeatMode: mode });
      this.saveState();
    }
  };

  MakanPlaybackController.prototype.setPlaybackRate = function (rate) {
    this.playbackRate = Math.max(0.25, Math.min(3.0, parseFloat(rate) || 1.0));
    if (this.engine && this.engine.audio) {
      this.engine.audio.playbackRate = this.playbackRate;
    }
    this.state.emit('playbackRateChanged', { rate: this.playbackRate });
  };

  MakanPlaybackController.prototype.setLoopA = function (seconds) {
    this.loopA = Math.max(0, parseFloat(seconds) || 0);
    this.state.emit('loopChanged', { loopA: this.loopA, loopB: this.loopB });
  };

  MakanPlaybackController.prototype.setLoopB = function (seconds) {
    this.loopB = Math.max(0, parseFloat(seconds) || 0);
    this.state.emit('loopChanged', { loopA: this.loopA, loopB: this.loopB });
  };

  MakanPlaybackController.prototype.clearLoop = function () {
    this.loopA = null;
    this.loopB = null;
    this.state.emit('loopChanged', { loopA: null, loopB: null });
  };

  /* ---------------- Internal Track Activation ---------------- */

  MakanPlaybackController.prototype._activateTrack = function (track, autoPlay) {
    var prevTrack = this.state.currentTrack;
    var prevPos = (this.engine && this.engine.audio) ? (this.engine.audio.currentTime || 0) : (this.state.currentTime || 0);
    if (prevTrack && prevTrack.id && prevTrack.id !== (track ? track.id : null) && prevPos > 0) {
      if (typeof window !== 'undefined' && window.MakanDesktop && window.MakanDesktop.setLastPosition) {
        window.MakanDesktop.setLastPosition(prevTrack.id, prevPos, true);
      }
    }

    this.state.currentTrack = track;
    this.state.duration = track.duration || 0;
    this.state.currentTime = 0;
    this.state.currentLyricIndex = 0;
    this.state.syncOffset = track.sync_offset || 0.0;

    // ReplayGain support
    if (track.replay_gain && this.engine.gainNode) {
      var gainDb = parseFloat(track.replay_gain) || 0;
      var mult = Math.pow(10, gainDb / 20);
      this.engine.gainNode.gain.value = this.state.volume * mult;
    }

    if (this.engine.audio) {
      this.engine.audio.playbackRate = this.playbackRate;
    }

    // Set streaming URL
    var streamUrl = '';
    if (track.id && !track.blobUrl && !track.src) {
      streamUrl = '/api/stream?id=' + encodeURIComponent(track.id);
      track.src = streamUrl;
    }

    this.engine.loadTrack(track, autoPlay);

    // Resume policy for long tracks and podcasts
    var resumeLong = (this.state.resumeLongTracks !== undefined) ? this.state.resumeLongTracks : true;
    var threshold = (this.state.resumeThreshold !== undefined) ? this.state.resumeThreshold : 900;
    var isLong = (track.duration && track.duration >= threshold) ||
      (track.genre && /podcast|audiobook|talk|speech/i.test(track.genre));

    if (resumeLong && isLong && track.last_position && track.last_position > 5 && (track.duration ? track.last_position < (track.duration - 10) : true)) {
      this.engine.seek(track.last_position);
    }

    this.state.emit('trackChanged', { track: track, index: this.contextIndex, context: this.context });
  };

  MakanPlaybackController.prototype.isResumeEligible = function (track) {
    if (!track) return false;
    var resumeLong = (this.state.resumeLongTracks !== undefined) ? this.state.resumeLongTracks : true;
    if (!resumeLong) return false;
    var threshold = (this.state.resumeThreshold !== undefined) ? this.state.resumeThreshold : 900;
    var isLong = (track.duration && track.duration >= threshold) ||
      (track.genre && /podcast|audiobook|talk|speech/i.test(track.genre));
    return !!(isLong && track.last_position && track.last_position > 5 && (track.duration ? track.last_position < (track.duration - 10) : true));
  };

  /* ---------------- Durable Persistence & Recovery ---------------- */

  MakanPlaybackController.prototype.saveState = function (immediate) {
    var cur = this.getCurrentTrack();
    var audioPos = (this.engine && this.engine.audio && typeof this.engine.audio.currentTime === 'number') ? this.engine.audio.currentTime : 0;
    var statePos = (this.state && typeof this.state.currentTime === 'number') ? this.state.currentTime : 0;
    var curPos = audioPos > 0 ? audioPos : statePos;

    var snapshot = {
      version: 2,
      shuffleMode: this.shuffleMode,
      shuffle: this.shuffleMode !== 'off',
      cycleId: this.cycleId,
      repeatMode: this.state.repeatMode,
      contextType: this.context.type,
      contextName: this.context.name,
      // For whole-library context, omit the 50,000 IDs array to prevent disk bloat;
      // restoreState automatically restores the context from allTracks
      contextIds: (this.context.type === 'library') ? null : this.context.tracks.map(function (t) { return t.id; }),
      contextIndex: this.contextIndex,
      currentTrackId: cur ? cur.id : null,
      currentTime: curPos,
      explicitQueueIds: this.explicitQueue.map(function (t) { return t.id; }),
      historyIds: this.history.map(function (t) { return t.id; }).slice(-100),
      forwardHistoryIds: this.forwardHistory.map(function (t) { return t.id; }).slice(-100),
      shuffledBag: this.shuffledBag.slice(),
      volume: this.state.volume,
      muted: this.state.muted
    };

    this._lastSnapshot = snapshot;

    if (!this.persistenceAdapter) {
      return snapshot;
    }

    var self = this;
    var doPersist = function () {
      if (self._saveTimer) {
        clearTimeout(self._saveTimer);
        self._saveTimer = null;
      }
      try {
        self.persistenceAdapter.savePlaybackState(self._lastSnapshot || snapshot);
      } catch (e) {}
    };

    // For smaller contexts (<= 500 tracks) or when immediate is requested (e.g. shutdown flush), persist synchronously.
    // For large libraries (> 500 tracks), debounce by _debounceSaveMs to prevent
    // serializing 650KB JSON hundreds of times per second during rapid navigation or benchmarks.
    var isLargeContext = this.context.tracks.length > 500;
    if (immediate || !isLargeContext || this._debounceSaveMs <= 0) {
      doPersist();
    } else {
      if (!this._saveTimer) {
        this._saveTimer = setTimeout(function () {
          doPersist();
        }, this._debounceSaveMs);
      }
    }

    return snapshot;
  };

  MakanPlaybackController.prototype.flushSaveState = function () {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this.persistenceAdapter && this._lastSnapshot) {
      try {
        this.persistenceAdapter.savePlaybackState(this._lastSnapshot);
      } catch (e) {}
    }
  };

  MakanPlaybackController.prototype.restoreState = function (saved, allTracks) {
    if (!saved || !allTracks || !allTracks.length) return false;

    var trackMap = new Map();
    for (var i = 0; i < allTracks.length; i++) {
      trackMap.set(allTracks[i].id, allTracks[i]);
    }

    if (saved.volume !== undefined) {
      this.state.volume = saved.volume;
      this.state.muted = !!saved.muted;
      if (this.engine && typeof this.engine.setVolume === 'function') {
        this.engine.setVolume(this.state.muted ? 0 : this.state.volume);
      }
    }
    if (saved.repeatMode) {
      this.setRepeatMode(saved.repeatMode);
    }

    // Restore shuffleMode (version 2: 'off'|'tracks'|'albums', version 1: boolean)
    if (saved.shuffleMode) {
      this.shuffleMode = saved.shuffleMode;
    } else if (saved.shuffle !== undefined) {
      this.shuffleMode = saved.shuffle ? 'tracks' : 'off';
    }
    this.state.shuffleMode = this.shuffleMode;
    this.state.shuffle = (this.shuffleMode !== 'off');
    this.cycleId = saved.cycleId || (this.shuffleMode !== 'off' ? this._generateCycleId() : null);

    // Restore context tracks safely
    var contextTracks = [];
    if (saved.contextIds && saved.contextIds.length) {
      for (var c = 0; c < saved.contextIds.length; c++) {
        var tr = trackMap.get(saved.contextIds[c]);
        if (tr) contextTracks.push(tr);
      }
    }
    if (!contextTracks.length && allTracks.length) {
      contextTracks = allTracks.slice();
    }

    this.context = {
      type: saved.contextType || 'library',
      name: saved.contextName || 'All Tracks',
      tracks: contextTracks
    };
    var idx = (saved.contextIndex >= 0 && saved.contextIndex < contextTracks.length) ? saved.contextIndex : 0;
    this.contextIndex = idx;
    this.queue = contextTracks;
    this.queueIndex = idx;
    this._rebuildIndexMap();

    // Restore explicit queue safely (dropping any stale deleted track IDs)
    this.explicitQueue = [];
    if (saved.explicitQueueIds && saved.explicitQueueIds.length) {
      for (var q = 0; q < saved.explicitQueueIds.length; q++) {
        var qTr = trackMap.get(saved.explicitQueueIds[q]);
        if (qTr) this.explicitQueue.push(qTr);
      }
    }
    this.state.queueCount = this.explicitQueue.length;

    // Restore history safely
    this.history = [];
    if (saved.historyIds && saved.historyIds.length) {
      for (var h = 0; h < saved.historyIds.length; h++) {
        var hTr = trackMap.get(saved.historyIds[h]);
        if (hTr) this.history.push(hTr);
      }
    }

    // Restore forwardHistory safely
    this.forwardHistory = [];
    if (saved.forwardHistoryIds && saved.forwardHistoryIds.length) {
      for (var fh = 0; fh < saved.forwardHistoryIds.length; fh++) {
        var fhTr = trackMap.get(saved.forwardHistoryIds[fh]);
        if (fhTr) this.forwardHistory.push(fhTr);
      }
    }

    // Restore shuffledBag safely (filtering out any stale / removed track IDs)
    if (saved.shuffledBag && Array.isArray(saved.shuffledBag)) {
      this.shuffledBag = saved.shuffledBag.filter(function (id) {
        return trackMap.has(id);
      });
    } else if (this.shuffleMode !== 'off') {
      this.reshuffleBag(saved.currentTrackId, false);
    }

    // Restore current active track without autoplay
    var targetTrack = null;
    if (saved.currentTrackId && trackMap.has(saved.currentTrackId)) {
      targetTrack = trackMap.get(saved.currentTrackId);
    } else if (this.context.tracks.length && this.contextIndex >= 0) {
      targetTrack = this.context.tracks[this.contextIndex];
    }

    if (targetTrack) {
      var targetIdx = this._findTrackIndexInContext(targetTrack.id);
      if (targetIdx !== -1) {
        this.contextIndex = targetIdx;
        this.queueIndex = targetIdx;
      }
      this._activateTrack(targetTrack, false);
      var resumePos = (saved.currentTime > 0) ? saved.currentTime : (targetTrack.last_position || 0);
      if (resumePos > 0) {
        this.engine.seek(resumePos);
      }
    }

    this.state.emit('shuffleChanged', { shuffle: this.state.shuffle, shuffleMode: this.shuffleMode });
    this.state.emit('shuffleBagChanged', { remaining: this.shuffledBag.length, cycleId: this.cycleId, shuffleMode: this.shuffleMode });
    this.state.emit('contextChanged', { context: this.context, index: this.contextIndex });
    this.state.emit('queueChanged', { queue: this.queue, index: this.queueIndex, explicitQueue: this.explicitQueue, count: this.explicitQueue.length });
    return true;
  };

  return {
    MakanPlaybackController: MakanPlaybackController,
    createPrng: createPrng,
    fisherYates: fisherYates
  };
});
