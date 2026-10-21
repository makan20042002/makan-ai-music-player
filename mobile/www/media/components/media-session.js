'use strict';
/*
 * media/components/media-session.js
 * MAKAN Music Player - Windows Media Session integration.
 * Provides synchronized title, artist, album, track-ID artwork, playing/paused state,
 * and throttled setPositionState() tracking with seeking and bounds guards.
 */
(function () {
  function MakanMediaSession(options) {
    options = options || {};
    this.state = options.state;
    this.getDesktopApi = typeof options.desktopApi === 'function'
      ? options.desktopApi
      : function () { return options.desktopApi || (typeof window !== 'undefined' ? window.MakanDesktop : null); };
    this.engine = options.engine;
    this.controller = options.controller;
    this.mediaSession = options.mediaSession || (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null);
    this.MediaMetadata = options.MediaMetadata || (typeof window !== 'undefined' ? window.MediaMetadata : (typeof MediaMetadata !== 'undefined' ? MediaMetadata : null));

    this.lastMediaSessionPosTime = 0;
  }

  MakanMediaSession.prototype.getArtworkUrl = function (track) {
    if (track && track.id && track.artwork_path) {
      return '/api/artwork?id=' + encodeURIComponent(track.id);
    }
    return '';
  };

  MakanMediaSession.prototype.updateMetadata = function () {
    if (!this.mediaSession || !this.MediaMetadata) return;
    var track = this.state ? this.state.currentTrack : null;
    if (!track) {
      this.mediaSession.metadata = null;
      var desktopApi = this.getDesktopApi();
      if (desktopApi && desktopApi.updateNowPlaying) {
        desktopApi.updateNowPlaying(null);
      }
      return;
    }

    var artworkUrl = this.getArtworkUrl(track);
    try {
      this.mediaSession.metadata = new this.MediaMetadata({
        title: track.title || track.filename || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        album: track.album || 'Unknown Album',
        artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }] : []
      });
    } catch (e) {}

    var desktopApi = this.getDesktopApi();
    if (desktopApi && desktopApi.updateNowPlaying) {
      desktopApi.updateNowPlaying({
        title: track.title || track.filename,
        artist: track.artist,
        album: track.album,
        isPlaying: this.state ? !!this.state.isPlaying : false,
        duration: this.state ? this.state.duration : 0,
        currentTime: this.state ? this.state.currentTime : 0,
        artworkPath: track.artwork_path
      });
    }
  };

  MakanMediaSession.prototype.updatePositionState = function (force) {
    if (!this.mediaSession || !this.mediaSession.setPositionState) return;
    var now = Date.now();
    if (!force && (now - this.lastMediaSessionPosTime < 500)) return;
    var dur = (this.state && this.state.duration) || 0;
    var cur = (this.state && this.state.currentTime) || 0;
    if (dur > 0 && cur >= 0 && cur <= dur) {
      try {
        this.mediaSession.setPositionState({
          duration: dur,
          playbackRate: (this.controller && this.controller.playbackRate) || 1.0,
          position: Math.min(cur, dur)
        });
        this.lastMediaSessionPosTime = now;
      } catch (e) {}
    }
  };

  MakanMediaSession.prototype.init = function () {
    var self = this;
    if (!this.mediaSession || !this.state) return;

    this.state.on('trackChanged', function () { self.updateMetadata(); self.updatePositionState(true); });
    this.state.on('trackLoaded', function () { self.updateMetadata(); self.updatePositionState(true); });
    this.state.on('timeUpdated', function () { self.updatePositionState(false); });
    this.state.on('durationUpdated', function () { self.updatePositionState(true); });
    this.state.on('seeked', function (data) {
      if (data && data.currentTime !== undefined && self.state) {
        self.state.currentTime = data.currentTime;
      }
      self.updatePositionState(true);
    });

    this.state.on('playStateChanged', function (data) {
      var isPlaying = !!(data && data.isPlaying);
      if ('playbackState' in self.mediaSession) {
        self.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      }
      self.updateMetadata();
      self.updatePositionState(true);
    });

    if (this.mediaSession.setActionHandler) {
      try {
        this.mediaSession.setActionHandler('play', function () { if (self.engine) self.engine.play(); });
        this.mediaSession.setActionHandler('pause', function () { if (self.engine) self.engine.pause(); });
        this.mediaSession.setActionHandler('previoustrack', function () { if (self.controller) self.controller.previous(); });
        this.mediaSession.setActionHandler('nexttrack', function () { if (self.controller) self.controller.next(true); });
        this.mediaSession.setActionHandler('seekto', function (details) {
          if (details && details.seekTime !== undefined) {
            if (self.engine) self.engine.seek(details.seekTime);
            self.updatePositionState(true);
          }
        });
        this.mediaSession.setActionHandler('stop', function () {
          if (self.engine) {
            self.engine.pause();
            self.engine.seek(0);
          }
          self.updatePositionState(true);
        });
      } catch (e) {}
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MakanMediaSession;
  }
  if (typeof window !== 'undefined') {
    window.MakanMediaSession = MakanMediaSession;
  }
})();
