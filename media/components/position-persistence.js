'use strict';
/*
 * media/components/position-persistence.js
 * MAKAN Music Player - Immediate position persistence logic.
 * Immediately saves track position on pause, stop, track transition, window close,
 * and debounces periodic updates during active playback.
 */
(function () {
  function MakanPositionPersistence(options) {
    options = options || {};
    this.state = options.state;
    this.getDesktopApi = typeof options.desktopApi === 'function'
      ? options.desktopApi
      : function () { return options.desktopApi || (typeof window !== 'undefined' ? window.MakanDesktop : null); };
    this.windowObj = options.windowObj || (typeof window !== 'undefined' ? window : null);

    this.lastSavedPosTime = 0;
    this.currentPlayingTrackId = null;
    this.currentPlayingPos = 0;
    this._boundBeforeUnload = null;
  }

  MakanPositionPersistence.prototype.flushCurrentPosition = function () {
    var desktopApi = this.getDesktopApi();
    if (this.currentPlayingTrackId && desktopApi && desktopApi.setLastPosition) {
      desktopApi.setLastPosition(this.currentPlayingTrackId, this.currentPlayingPos, true);
    }
  };

  MakanPositionPersistence.prototype.init = function () {
    var self = this;
    if (!this.state) return;

    this.state.on('timeUpdated', function (data) {
      if (self.state.currentTrack && self.state.currentTrack.id) {
        self.currentPlayingTrackId = self.state.currentTrack.id;
        self.currentPlayingPos = (data && data.currentTime !== undefined) ? data.currentTime : 0;
      }
      var now = Date.now();
      if (now - self.lastSavedPosTime > 4000) {
        self.lastSavedPosTime = now;
        var desktopApi = self.getDesktopApi();
        if (self.state.currentTrack && self.state.currentTrack.id && desktopApi && desktopApi.setLastPosition) {
          desktopApi.setLastPosition(self.state.currentTrack.id, self.currentPlayingPos, false);
        }
      }
    });

    this.state.on('trackChanged', function (data) {
      if (self.currentPlayingTrackId && (!data || !data.track || data.track.id !== self.currentPlayingTrackId)) {
        self.flushCurrentPosition();
      }
      if (data && data.track && data.track.id) {
        self.currentPlayingTrackId = data.track.id;
        self.currentPlayingPos = data.track.last_position || 0;
      }
    });

    this.state.on('playStateChanged', function (data) {
      if (!data || !data.isPlaying) {
        self.flushCurrentPosition();
      }
    });

    if (this.windowObj && this.windowObj.addEventListener) {
      this._boundBeforeUnload = function () {
        self.flushCurrentPosition();
      };
      this.windowObj.addEventListener('beforeunload', this._boundBeforeUnload);
    }
  };

  MakanPositionPersistence.prototype.destroy = function () {
    if (this.windowObj && this.windowObj.removeEventListener && this._boundBeforeUnload) {
      this.windowObj.removeEventListener('beforeunload', this._boundBeforeUnload);
      this._boundBeforeUnload = null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MakanPositionPersistence;
  }
  if (typeof window !== 'undefined') {
    window.MakanPositionPersistence = MakanPositionPersistence;
  }
})();
