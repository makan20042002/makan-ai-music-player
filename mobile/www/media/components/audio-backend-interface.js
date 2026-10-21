/*
 * media/components/audio-backend-interface.js - Pluggable Audio Backend Architecture for MAKAN v1.8.0.
 *
 * Provides:
 * - BaseAudioBackend (interface definition)
 * - ExistingWebAudioBackend (wraps existing Web Audio & PotPlayer DSP graph)
 * - NativePureAudioBackend (communicates with out-of-process makan-audio-helper.exe)
 */
(function () {
  'use strict';

  /**
   * Base Audio Backend Interface
   */
  function BaseAudioBackend() {
    this.name = 'BaseAudioBackend';
    this.onEnded = null;
    this.onError = null;
    this.onTrackLoaded = null;
    this.onPosition = null;
    this.onDuration = null;
    this.onAudioPathChanged = null;
    this.onDeviceLost = null;
    this.onDeviceChanged = null;
  }

  BaseAudioBackend.prototype.initialize = function () { return Promise.resolve(true); };
  BaseAudioBackend.prototype.loadTrack = function (track, options) { return Promise.resolve(false); };
  BaseAudioBackend.prototype.play = function () { return Promise.resolve(); };
  BaseAudioBackend.prototype.pause = function () { return Promise.resolve(); };
  BaseAudioBackend.prototype.stop = function () { return Promise.resolve(); };
  BaseAudioBackend.prototype.seek = function (positionSeconds) { return Promise.resolve(); };
  BaseAudioBackend.prototype.getPosition = function () { return 0; };
  BaseAudioBackend.prototype.getDuration = function () { return 0; };
  BaseAudioBackend.prototype.setVolume = function (vol) {};
  BaseAudioBackend.prototype.setMute = function (muted) {};
  BaseAudioBackend.prototype.preloadNext = function (track) { return Promise.resolve(false); };
  BaseAudioBackend.prototype.selectDevice = function (deviceId) { return Promise.resolve(false); };
  BaseAudioBackend.prototype.setOutputMode = function (mode) { return Promise.resolve(false); };
  BaseAudioBackend.prototype.getAudioPath = function () { return null; };
  BaseAudioBackend.prototype.getVisualizerData = function () { return null; };
  BaseAudioBackend.prototype.enumerateDevices = function () { return Promise.resolve([]); };
  BaseAudioBackend.prototype.shutdown = function () { return Promise.resolve(); };

  /**
   * ExistingWebAudioBackend
   * Adapts the existing HTML5 / Web Audio graph and PotPlayer DSP.
   */
  function ExistingWebAudioBackend(engine) {
    BaseAudioBackend.call(this);
    this.name = 'WebAudio';
    this.engine = engine;
  }
  ExistingWebAudioBackend.prototype = Object.create(BaseAudioBackend.prototype);
  ExistingWebAudioBackend.prototype.constructor = ExistingWebAudioBackend;

  ExistingWebAudioBackend.prototype.initialize = function () {
    return Promise.resolve(true);
  };

  ExistingWebAudioBackend.prototype.loadTrack = function (track, options) {
    if (!track) return Promise.resolve(false);
    var opts = options || {};
    var startPos = opts.startPosition || 0;
    var autoPlay = !!opts.autoplay;

    this.engine.loadTrack(track, autoPlay);
    if (startPos > 0) {
      this.engine.seek(startPos);
    }
    return Promise.resolve(true);
  };

  ExistingWebAudioBackend.prototype.play = function () {
    return this.engine.play();
  };

  ExistingWebAudioBackend.prototype.pause = function () {
    this.engine.pause();
    return Promise.resolve();
  };

  ExistingWebAudioBackend.prototype.stop = function () {
    this.engine.stop();
    return Promise.resolve();
  };

  ExistingWebAudioBackend.prototype.seek = function (positionSeconds) {
    this.engine.seek(positionSeconds);
    return Promise.resolve();
  };

  ExistingWebAudioBackend.prototype.getPosition = function () {
    return this.engine.activeAudio ? (this.engine.activeAudio.currentTime || 0) : 0;
  };

  ExistingWebAudioBackend.prototype.getDuration = function () {
    return this.engine.activeAudio ? (this.engine.activeAudio.duration || 0) : 0;
  };

  ExistingWebAudioBackend.prototype.setVolume = function (vol) {
    this.engine.setVolume(vol);
  };

  ExistingWebAudioBackend.prototype.setMute = function (muted) {
    this.engine.setMuted(muted);
  };

  ExistingWebAudioBackend.prototype.preloadNext = function (track) {
    this.engine.preloadNext(track);
    return Promise.resolve(true);
  };

  ExistingWebAudioBackend.prototype.selectDevice = function (deviceId) {
    if (this.engine.activeAudio && typeof this.engine.activeAudio.setSinkId === 'function') {
      return this.engine.activeAudio.setSinkId(deviceId || '').then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  };

  ExistingWebAudioBackend.prototype.setOutputMode = function (mode) {
    return Promise.resolve(true);
  };

  ExistingWebAudioBackend.prototype.getAudioPath = function () {
    var s = this.engine.state;
    var curTrack = (s && s.queue && s.queue[s.currentIndex]) || null;
    var sr = this.engine.audioCtx ? this.engine.audioCtx.sampleRate : 44100;
    var vol = s ? (s.volume || 100) : 100;
    var isMuted = s ? !!s.isMuted : false;
    var isEnhanced = s ? (!!s.potPlayerMode || !!s.eqEnabled || !!s.loudnessNormalizer) : false;

    var format = 'Audio';
    if (curTrack && curTrack.path) {
      var ext = curTrack.path.split('.').pop().toUpperCase();
      if (ext) format = ext;
    }

    var descSource = curTrack ? (format + ' · ' + sr + ' Hz · Stereo') : 'Idle';
    var descProc = isEnhanced ? 'Web Audio Decode → PotPlayer DSP / Equalizer → Gain ' + (isMuted ? '0.00' : (vol / 100).toFixed(2)) : 'Web Audio Decode → No DSP → Gain ' + (isMuted ? '0.00' : (vol / 100).toFixed(2));
    var descOut = 'Web Audio Destination → Default Audio Endpoint · ' + sr + ' Hz · 32-bit float PCM';

    return {
      decoder: 'Web Audio / HTML5 Audio Element',
      sourceFormat: format,
      sourceSampleRate: sr,
      sourceChannels: 2,
      sourceBitRate: curTrack ? (curTrack.bitrate || 0) : 0,
      sourceBitDepth: 16,
      dspEnabled: isEnhanced,
      replayGainEnabled: s ? (s.replayGainMode !== 'off') : false,
      softwareVolumeActive: vol < 100 || isMuted,
      gain: isMuted ? 0.0 : (vol / 100),
      resamplingActive: false,
      resamplingRatio: 'None',
      outputSampleRate: sr,
      outputChannels: 2,
      outputFormat: 'float32',
      outputMode: 'Web Audio Shared',
      selectedDevice: 'Default System Audio',
      fallbackOccurred: false,
      fallbackReason: '',
      descriptionSource: descSource,
      descriptionProcessing: descProc,
      descriptionOutput: descOut
    };
  };

  ExistingWebAudioBackend.prototype.getVisualizerData = function () {
    return this.engine.getAudioData();
  };

  ExistingWebAudioBackend.prototype.enumerateDevices = function () {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      return navigator.mediaDevices.enumerateDevices().then(function (devices) {
        return devices.filter(function (d) { return d.kind === 'audiooutput'; }).map(function (d, i) {
          return {
            id: d.deviceId || ('dev_' + i),
            name: d.label || ('Audio Output ' + (i + 1)),
            isDefault: d.deviceId === 'default',
            formats: ['Default System Format']
          };
        });
      }).catch(function () { return []; });
    }
    return Promise.resolve([{ id: 'default', name: 'Default Audio Output', isDefault: true, formats: [] }]);
  };

  ExistingWebAudioBackend.prototype.shutdown = function () {
    return Promise.resolve();
  };

  /**
   * NativePureAudioBackend
   * Direct out-of-process helper communication with bit-transparent Pure Audio rules.
   */
  function NativePureAudioBackend(options) {
    BaseAudioBackend.call(this);
    this.name = 'NativePureAudio';
    this.options = options || {};
    this.state = options.state || null;
    this.client = (window.MakanDesktop && window.MakanDesktop.nativeAudio) ? window.MakanDesktop.nativeAudio : null;
    this.cleanupListener = null;

    this.currentPosition = 0;
    this.currentDuration = 0;
    this.isPlaying = false;
    this.cachedAudioPath = null;
    this.latestMeterData = {
      peakL: 0,
      peakR: 0,
      rmsL: 0,
      rmsR: 0,
      bins: new Array(32).fill(0),
      clipping: false
    };

    this._bindEvents();
  }
  NativePureAudioBackend.prototype = Object.create(BaseAudioBackend.prototype);
  NativePureAudioBackend.prototype.constructor = NativePureAudioBackend;

  NativePureAudioBackend.prototype._bindEvents = function () {
    if (!this.client || typeof this.client.onEvent !== 'function') return;
    var self = this;
    this.cleanupListener = this.client.onEvent(function (evt) {
      if (!evt) return;
      var type = evt.event;

      if (type === 'trackLoaded') {
        self.currentDuration = evt.duration || 0;
        if (typeof self.onTrackLoaded === 'function') self.onTrackLoaded(evt);
        if (typeof self.onDuration === 'function') self.onDuration(self.currentDuration);
      } else if (type === 'duration') {
        self.currentDuration = evt.duration || 0;
        if (typeof self.onDuration === 'function') self.onDuration(self.currentDuration);
      } else if (type === 'position') {
        self.currentPosition = evt.position || 0;
        if (evt.duration) self.currentDuration = evt.duration;
        if (typeof self.onPosition === 'function') self.onPosition(self.currentPosition, self.currentDuration);
      } else if (type === 'playing') {
        self.isPlaying = true;
      } else if (type === 'paused' || type === 'stopped') {
        self.isPlaying = false;
      } else if (type === 'ended') {
        self.isPlaying = false;
        self.currentPosition = 0;
        if (typeof self.onEnded === 'function') self.onEnded();
      } else if (type === 'error') {
        if (typeof self.onError === 'function') self.onError(evt);
      } else if (type === 'audioPathChanged') {
        self.cachedAudioPath = evt.audioPath || evt;
        if (typeof self.onAudioPathChanged === 'function') self.onAudioPathChanged(self.cachedAudioPath);
      } else if (type === 'meterData') {
        self.latestMeterData = evt;
      } else if (type === 'deviceLost') {
        if (typeof self.onDeviceLost === 'function') self.onDeviceLost(evt);
      } else if (type === 'deviceChanged') {
        if (typeof self.onDeviceChanged === 'function') self.onDeviceChanged(evt);
      }
    });
  };

  NativePureAudioBackend.prototype.isSupported = function () {
    return !!(window.MakanDesktop && window.MakanDesktop.nativeAudio);
  };

  NativePureAudioBackend.prototype.initialize = function () {
    if (!this.isSupported()) return Promise.reject(new Error('Native audio helper is not available.'));
    var s = this.state || {};
    return this.client.sendCommand('initialize', {
      outputMode: s.outputMode || 'shared',
      bufferMode: s.bufferMode || 'default',
      deviceId: s.outputDevice || 'default'
    }).then(function (res) {
      return res && res.ok;
    });
  };

  NativePureAudioBackend.prototype.loadTrack = function (track, options) {
    if (!track) return Promise.resolve(false);
    var self = this;
    var opts = options || {};
    var filePath = track.path || track.filePath || '';

    // If filePath is relative or missing, handle gracefully
    if (!filePath && track.id && window.MakanDesktop && typeof window.MakanDesktop.pathOf === 'function') {
      filePath = window.MakanDesktop.pathOf(track);
    }
    if (!filePath) {
      return Promise.reject(new Error('Native engine requires local file path for: ' + (track.title || 'Unknown')));
    }

    var startPos = opts.startPosition || 0;
    var autoPlay = !!opts.autoplay;

    return this.client.sendCommand('load', {
      filePath: filePath,
      autoplay: autoPlay,
      startPosition: startPos
    }).then(function (res) {
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Failed to load track in native audio engine');
      }
      self.isPlaying = autoPlay;
      self.currentPosition = startPos;
      if (res.data && res.data.duration) {
        self.currentDuration = res.data.duration;
      }
      return true;
    });
  };

  NativePureAudioBackend.prototype.play = function () {
    var self = this;
    return this.client.sendCommand('play').then(function (res) {
      if (res && res.ok) self.isPlaying = true;
      return res;
    });
  };

  NativePureAudioBackend.prototype.pause = function () {
    var self = this;
    return this.client.sendCommand('pause').then(function (res) {
      if (res && res.ok) self.isPlaying = false;
      return res;
    });
  };

  NativePureAudioBackend.prototype.stop = function () {
    var self = this;
    return this.client.sendCommand('stop').then(function (res) {
      if (res && res.ok) {
        self.isPlaying = false;
        self.currentPosition = 0;
      }
      return res;
    });
  };

  NativePureAudioBackend.prototype.seek = function (positionSeconds) {
    var self = this;
    var pos = Math.max(0, positionSeconds || 0);
    this.currentPosition = pos;
    return this.client.sendCommand('seek', { position: pos });
  };

  NativePureAudioBackend.prototype.getPosition = function () {
    return this.currentPosition;
  };

  NativePureAudioBackend.prototype.getDuration = function () {
    return this.currentDuration;
  };

  NativePureAudioBackend.prototype.setVolume = function (vol) {
    if (typeof vol !== 'number' || isNaN(vol) || vol < 0.0 || vol > 1.0) {
      return Promise.reject(new Error('Volume must be a normalized float between 0.0 and 1.0'));
    }
    return this.client.sendCommand('setVolume', { volume: vol });
  };

  NativePureAudioBackend.prototype.setMute = function (muted) {
    return this.client.sendCommand('setMute', { muted: !!muted });
  };

  NativePureAudioBackend.prototype.preloadNext = function (track) {
    if (!track) return Promise.resolve(false);
    var filePath = track.path || track.filePath || '';
    if (!filePath) return Promise.resolve(false);
    return this.client.sendCommand('preloadNext', { filePath: filePath }).then(function (res) {
      return !!(res && res.ok);
    }).catch(function () {
      return false;
    });
  };

  NativePureAudioBackend.prototype.selectDevice = function (deviceId) {
    return this.client.sendCommand('selectDevice', { deviceId: deviceId || 'default' }).then(function (res) {
      return !!(res && res.ok);
    });
  };

  NativePureAudioBackend.prototype.setOutputMode = function (mode) {
    return this.client.sendCommand('setOutputMode', { outputMode: mode || 'shared' }).then(function (res) {
      return !!(res && res.ok);
    });
  };

  NativePureAudioBackend.prototype.getAudioPath = function () {
    if (this.cachedAudioPath) return this.cachedAudioPath;
    var self = this;
    this.client.sendCommand('getAudioPath').then(function (res) {
      if (res && res.ok && res.data) {
        self.cachedAudioPath = res.data;
      }
    }).catch(function () {});
    return this.cachedAudioPath;
  };

  NativePureAudioBackend.prototype.getVisualizerData = function () {
    var m = this.latestMeterData;
    var isPlaying = this.isPlaying;

    if (!isPlaying) {
      return {
        freq: null,
        time: null,
        bass: 0,
        mid: 0,
        treble: 0,
        rms: 0,
        isPlaying: false,
        peakL: 0,
        peakR: 0,
        clipping: false
      };
    }

    // Map 32 spectrum bins from helper (0.0 - 1.0) to byte frequencies (0 - 255)
    var freq = new Uint8Array(64);
    var bins = m.bins || [];
    for (var i = 0; i < 64; i++) {
      var binIdx = Math.min(bins.length - 1, Math.floor(i / 2));
      freq[i] = Math.round((bins[binIdx] || 0) * 255);
    }

    // Synthesize time domain data from RMS and peak for oscilloscope
    var time = new Uint8Array(64);
    var rms = (m.rmsL + m.rmsR) * 0.5;
    for (var j = 0; j < 64; j++) {
      time[j] = Math.round(128 + Math.sin(j * 0.25) * (rms * 120));
    }

    var bass = (bins[0] || 0) * 0.5 + (bins[1] || 0) * 0.5;
    var mid = (bins[10] || 0) * 0.5 + (bins[15] || 0) * 0.5;
    var treble = (bins[25] || 0) * 0.5 + (bins[30] || 0) * 0.5;

    return {
      freq: freq,
      time: time,
      bass: bass,
      mid: mid,
      treble: treble,
      rms: rms,
      isPlaying: isPlaying,
      peakL: m.peakL,
      peakR: m.peakR,
      clipping: m.clipping
    };
  };

  NativePureAudioBackend.prototype.enumerateDevices = function () {
    return this.client.sendCommand('enumerateDevices').then(function (res) {
      if (res && res.ok && res.data && res.data.devices) {
        return res.data.devices;
      }
      return [];
    }).catch(function () {
      return [];
    });
  };

  NativePureAudioBackend.prototype.shutdown = function () {
    if (this.cleanupListener) {
      try { this.cleanupListener(); } catch (e) {}
      this.cleanupListener = null;
    }
    return this.client.sendCommand('shutdown').catch(function () {});
  };

  window.BaseAudioBackend = BaseAudioBackend;
  window.ExistingWebAudioBackend = ExistingWebAudioBackend;
  window.NativePureAudioBackend = NativePureAudioBackend;
})();
