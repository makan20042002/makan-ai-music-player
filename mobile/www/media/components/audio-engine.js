/*
 * media/components/audio-engine.js - Real Web Audio processing engine for MAKAN Music Player v1.6.1.
 * Connects:
 * - Dual HTML5 Audio elements for Preloaded Low-Gap Transitions & Crossfading
 * - 10-Band Graphic EQ with Preamp & Bypass
 * - Real ReplayGain processing (Track, Album, Prevent-Clipping, Preamp)
 * - Stereo Panning
 * - Master Gain
 * - AnalyserNode for Real Frequency Spectrum & RMS Waveform Data
 * - Unplayable/Corrupted file recovery with circuit breaker
 */
(function () {
  'use strict';

  var EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  var EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rock: [4.5, 3.0, 1.5, 0.0, -1.0, -1.0, 1.0, 2.5, 3.5, 4.0],
    pop: [-1.5, -0.5, 1.5, 3.0, 4.0, 3.5, 1.5, 0.0, -1.0, -1.5],
    jazz: [3.5, 2.5, 1.0, 1.5, -1.5, -1.5, 0.0, 1.5, 2.5, 3.0],
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

  function MakanAudioEngine(state) {
    this.state = state;

    // Dual audio elements for gapless and crossfade
    this.audioA = (typeof Audio !== 'undefined') ? new Audio() : this._createMockAudio();
    this.audioB = (typeof Audio !== 'undefined') ? new Audio() : this._createMockAudio();
    this.audioA.crossOrigin = 'anonymous';
    this.audioB.crossOrigin = 'anonymous';
    this.audioA.preload = 'metadata';
    this.audioB.preload = 'metadata';

    this.activeAudio = this.audioA;
    this.nextAudio = this.audioB;
    this.audio = this.activeAudio; // Backwards compatibility alias

    this.audioCtx = null;
    this.sourceA = null;
    this.sourceB = null;
    this.fadeGainA = null;
    this.fadeGainB = null;
    this.eqPreampNode = null;
    this.eqFilters = [];
    this.compressorNode = null;
    this.normalizerMakeupGain = null;
    this.dspIn = null;
    this.dspOut = null;
    this.dspNode = null;
    this.dspReady = false;
    this.dspMeter = null;
    this.splitterNode = null;
    this.mergerNode = null;
    this.gainLL = null;
    this.gainRR = null;
    this.gainLR = null;
    this.gainRL = null;
    this.replayGainNode = null;
    this.panNode = null;
    this.gainNode = null;
    this.analyser = null;

    this.freqData = null;
    this.timeData = null;

    this.lastError = null;
    this.consecutiveFailures = 0;

    // Gapless & Crossfade state
    this.preloadedNext = null;
    this.isCrossfading = false;
    this.crossfadeTimer = null;
    this.controller = null;

    // ReplayGain metrics
    this.lastReplayGainApplied = { mult: 1.0, gainDb: 0, mode: 'track' };

    this._initAudioEvents(this.audioA, 'A');
    this._initAudioEvents(this.audioB, 'B');

    // Pluggable Audio Backends (v1.8.0)
    var self = this;
    this.webAudioBackend = (typeof window !== 'undefined' && window.ExistingWebAudioBackend) ? new window.ExistingWebAudioBackend(this) : null;
    this.nativeAudioBackend = (typeof window !== 'undefined' && window.NativePureAudioBackend && window.MakanDesktop && window.MakanDesktop.nativeAudio)
      ? new window.NativePureAudioBackend({ state: this.state })
      : null;

    var requestedBackend = (this.state && this.state.audioBackend) || 'webaudio';
    this.backendType = (requestedBackend === 'native' && this.nativeAudioBackend) ? 'native' : 'webaudio';
    this.backend = (this.backendType === 'native') ? this.nativeAudioBackend : this.webAudioBackend;

    if (this.nativeAudioBackend) {
      this.nativeAudioBackend.onEnded = function () {
        self.state.setPlayState(false);
        if (self.controller) {
          self.controller.next(false);
        } else {
          self.state.emit('playbackEnded');
        }
      };
      this.nativeAudioBackend.onPosition = function (pos, dur) {
        self.state.setCurrentTime(pos);
        if (dur) self.state.setDuration(dur);
      };
      this.nativeAudioBackend.onError = function (err) {
        console.error('[NativeAudio] Error event:', err);
        self.handleNativeErrorFallback(err);
      };
      this.nativeAudioBackend.onAudioPathChanged = function (pathData) {
        self.state.emit('audioPathChanged', pathData);
      };
      this.nativeAudioBackend.onDeviceLost = function (evt) {
        if (self.state && self.state.emit) {
          self.state.emit('toast', { message: 'Audio output device disconnected. Playback paused.', type: 'warning' });
        }
      };
    }
  }

  MakanAudioEngine.prototype._createMockAudio = function () {
    var listeners = {};
    return {
      src: '',
      currentTime: 0,
      duration: 0,
      volume: 1,
      playbackRate: 1,
      paused: true,
      crossOrigin: 'anonymous',
      preload: 'metadata',
      addEventListener: function (evt, fn) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
      },
      removeEventListener: function (evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function (f) { return f !== fn; });
      },
      play: function () {
        this.paused = false;
        var handlers = listeners['play'] || [];
        for (var i = 0; i < handlers.length; i++) handlers[i]();
        return Promise.resolve();
      },
      pause: function () {
        this.paused = true;
        var handlers = listeners['pause'] || [];
        for (var i = 0; i < handlers.length; i++) handlers[i]();
      },
      dispatchEvent: function (event) {
        var type = (typeof event === 'string') ? event : (event && event.type ? event.type : 'error');
        var handlers = listeners[type] || [];
        for (var i = 0; i < handlers.length; i++) handlers[i](event);
      },
      load: function () {},
      removeAttribute: function (attr) {
        if (attr === 'src') this.src = '';
      }
    };
  };

  MakanAudioEngine.prototype.setController = function (ctrl) {
    this.controller = ctrl;
  };

  MakanAudioEngine.prototype._initAudioEvents = function (audioElem, label) {
    var self = this;

    audioElem.addEventListener('timeupdate', function () {
      if (self.activeAudio !== audioElem) return;
      var cur = audioElem.currentTime;
      var dur = audioElem.duration || 0;
      self.state.setCurrentTime(cur);

      if (cur > 1.0 && self.consecutiveFailures > 0) {
        self.consecutiveFailures = 0;
      }

      // Check for gapless preload / crossfade transition
      self._checkTransitions(cur, dur);
    });

    audioElem.addEventListener('durationchange', function () {
      if (self.activeAudio !== audioElem) return;
      if (audioElem.duration && !isNaN(audioElem.duration) && isFinite(audioElem.duration)) {
        self.state.setDuration(audioElem.duration);
      }
    });

    audioElem.addEventListener('play', function () {
      if (self.activeAudio !== audioElem) return;
      self.lastError = null;
      self.state.setPlayState(true);
    });

    audioElem.addEventListener('pause', function () {
      if (self.activeAudio !== audioElem) return;
      if (!self.isCrossfading) {
        self.state.setPlayState(false);
      }
    });

    audioElem.addEventListener('ended', function () {
      if (self.activeAudio !== audioElem) return;
      self.handleTrackEnded();
    });

    audioElem.addEventListener('error', function () {
      if (self.activeAudio !== audioElem) {
        if (self.nextAudio === audioElem) {
          console.warn('[MakanAudio] Preloaded track error:', audioElem.src);
          self.preloadedNext = null;
          self.isCrossfading = false;
        }
        return;
      }
      var err = audioElem.error;
      var msg = 'Audio playback error';
      if (err) {
        if (err.code === 1) msg = 'Playback aborted by user';
        else if (err.code === 2) msg = 'Network error downloading audio';
        else if (err.code === 3) msg = 'Audio decoding failed (corrupt or unsupported format)';
        else if (err.code === 4) msg = 'Audio format not supported by system';
      }
      self.lastError = msg;
      self.consecutiveFailures++;

      var failedTrack = self.state.currentTrack;
      if (failedTrack) {
        failedTrack.is_missing = 1;
        if (typeof window !== 'undefined' && window.MakanDesktop && window.MakanDesktop.removeTracks) {
          // Track is marked missing in DB
        }
      }

      self.state.emit('playbackError', {
        message: msg,
        track: failedTrack,
        consecutiveFailures: self.consecutiveFailures,
        src: audioElem.src
      });

      console.warn('[MakanAudio] Honest error on track:', msg, audioElem.src, 'Consecutive:', self.consecutiveFailures);

      // Circuit breaker: max 5 consecutive unplayable tracks
      if (self.consecutiveFailures >= 5) {
        self.pause();
        self.state.setPlayState(false);
        self.state.emit('circuitBreakerTripped', {
          message: 'Playback stopped: 5 consecutive tracks failed to play.'
        });
        return;
      }

      // Recover by advancing to the next playable track without breaking queue/shuffle
      if (self.controller && self.state && self.state.isPlaying) {
        setTimeout(function () {
          if (self.state && self.state.isPlaying) {
            self.controller.next(false);
          }
        }, 150);
      }
    });
  };

  MakanAudioEngine.prototype.ensureContext = function () {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(function () {});
      }
      return;
    }

    var AudioContextClass = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AudioContextClass) return;

    try {
      this.audioCtx = new AudioContextClass({ latencyHint: 'playback' });
    } catch (eCtx) {
      this.audioCtx = new AudioContextClass();
    }
    var ctx = this.audioCtx;

    // Fade Gain Nodes for Dual-Audio
    this.fadeGainA = ctx.createGain();
    this.fadeGainB = ctx.createGain();
    this.fadeGainA.gain.value = 1.0;
    this.fadeGainB.gain.value = 0.0;

    // EQ Preamp Node (-12 dB to +12 dB)
    this.eqPreampNode = ctx.createGain();
    var isBypassed = !!this.state.eqBypass || (this.state.eqEnabled === false);
    var eqPreampDb = (this.state.eqPreamp !== undefined) ? (parseFloat(this.state.eqPreamp) || 0) : 0;
    var actualPreampDb = isBypassed ? 0 : eqPreampDb;
    this.eqPreampNode.gain.value = Math.pow(10, actualPreampDb / 20);

    // 10 EQ BiquadFilters
    this.eqFilters = [];
    for (var i = 0; i < EQ_FREQS.length; i++) {
      var f = ctx.createBiquadFilter();
      if (i === 0) f.type = 'lowshelf';
      else if (i === EQ_FREQS.length - 1) f.type = 'highshelf';
      else f.type = 'peaking';
      f.frequency.value = EQ_FREQS[i];
      f.Q.value = 1.4;
      var targetGain = (this.state.eqGains && this.state.eqGains[i] !== undefined) ? (parseFloat(this.state.eqGains[i]) || 0) : 0;
      f.gain.value = isBypassed ? 0 : targetGain;
      this.eqFilters.push(f);
    }

    // Connect filters in series
    for (var j = 0; j < this.eqFilters.length - 1; j++) {
      this.eqFilters[j].connect(this.eqFilters[j + 1]);
    }

    // Stereo Spatial Widener (PotPlayer Crystal 3D Soundstage)
    var stereoWidth = (this.state.stereoWidth !== undefined) ? this.state.stereoWidth : 1.0;
    if (ctx.createChannelSplitter && ctx.createChannelMerger && ctx.createGain) {
      try {
        this.splitterNode = ctx.createChannelSplitter(2);
        this.mergerNode = ctx.createChannelMerger(2);
        this.gainLL = ctx.createGain();
        this.gainRR = ctx.createGain();
        this.gainLR = ctx.createGain();
        this.gainRL = ctx.createGain();

        var w = Math.max(0.5, Math.min(2.0, parseFloat(stereoWidth) || 1.0));
        var direct = 1.0 + 0.5 * (w - 1.0);
        var cross = -0.5 * (w - 1.0);

        this.gainLL.gain.value = direct;
        this.gainRR.gain.value = direct;
        this.gainLR.gain.value = cross;
        this.gainRL.gain.value = cross;

        this.splitterNode.connect(this.gainLL, 0);
        this.gainLL.connect(this.mergerNode, 0, 0);

        this.splitterNode.connect(this.gainLR, 0);
        this.gainLR.connect(this.mergerNode, 0, 1);

        this.splitterNode.connect(this.gainRL, 1);
        this.gainRL.connect(this.mergerNode, 0, 0);

        this.splitterNode.connect(this.gainRR, 1);
        this.gainRR.connect(this.mergerNode, 0, 1);
      } catch (eWidener) {
        this.splitterNode = null;
        this.mergerNode = null;
      }
    }

    // ReplayGain Node
    this.replayGainNode = ctx.createGain();
    this.replayGainNode.gain.value = 1.0;

    // Stereo Panner
    if (ctx.createStereoPanner) {
      this.panNode = ctx.createStereoPanner();
      this.panNode.pan.value = this.state.pan || 0;
    }

    // Master Gain
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this.state.muted ? 0 : (this.state.volume !== undefined ? this.state.volume : 0.85);

    // Analyser Node for Real Frequency & Waveform Data
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    // Wire Graph:
    // [fadeGainA, fadeGainB] -> eqPreampNode -> eqFilters[0..9]
    // -> [widener] -> replayGainNode -> dspIn -> [makan-dsp worklet: normalizer + limiter] -> dspOut -> panNode -> gainNode -> analyser -> destination
    this.fadeGainA.connect(this.eqPreampNode);
    this.fadeGainB.connect(this.eqPreampNode);
    this.eqPreampNode.connect(this.eqFilters[0]);

    var lastEq = this.eqFilters[this.eqFilters.length - 1];
    var currentOutput = lastEq;

    if (this.splitterNode && this.mergerNode) {
      currentOutput.connect(this.splitterNode);
      currentOutput = this.mergerNode;
    }

    currentOutput.connect(this.replayGainNode);

    // v1.9 sound engine: replayGain -> dspIn -> (worklet | direct wire) -> dspOut -> pan -> volume
    this.dspIn = ctx.createGain();
    this.dspOut = ctx.createGain();
    this.replayGainNode.connect(this.dspIn);
    this.dspIn.connect(this.dspOut);

    if (this.panNode) {
      this.dspOut.connect(this.panNode);
      this.panNode.connect(this.gainNode);
    } else {
      this.dspOut.connect(this.gainNode);
    }
    this.gainNode.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Connect MediaElementSource nodes
    try {
      this.sourceA = ctx.createMediaElementSource(this.audioA);
      this.sourceA.connect(this.fadeGainA);
    } catch (e) {
      console.warn('[MakanAudio] sourceA creation notice:', e);
    }

    try {
      this.sourceB = ctx.createMediaElementSource(this.audioB);
      this.sourceB.connect(this.fadeGainB);
    } catch (e2) {
      console.warn('[MakanAudio] sourceB creation notice:', e2);
    }

    this._loadDsp();
  };

  /* ---------------- v1.9 sound engine: loudness normalizer + look-ahead limiter ---------------- */

  MakanAudioEngine.prototype._dspUrl = function () {
    try { return new URL('media/components/dsp-worklet.js', document.baseURI).href; } catch (e) { return 'media/components/dsp-worklet.js'; }
  };

  MakanAudioEngine.prototype._loadDsp = function () {
    var self = this;
    var ctx = this.audioCtx;
    if (!ctx || this.dspReady || this._dspLoading) return;
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') { this._syncDsp(); return; }
    this._dspLoading = true;
    ctx.audioWorklet.addModule(this._dspUrl()).then(function () {
      self._dspLoading = false;
      if (self.audioCtx !== ctx || !self.dspIn) return;
      try {
        var node = new AudioWorkletNode(ctx, 'makan-dsp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
        node.port.onmessage = function (e) { if (e.data && e.data.type === 'meter') self.dspMeter = e.data.meter; };
        self.dspNode = node;
        self.dspIn.disconnect();
        self.dspIn.connect(node);
        node.connect(self.dspOut);
        self.dspReady = true;
        self._syncDsp(true);
      } catch (e2) {
        console.warn('[MakanAudio] DSP worklet node failed, using direct path:', e2);
        self.dspNode = null; self.dspReady = false;
        try { self.dspIn.connect(self.dspOut); } catch (e3) {}
      }
    }).catch(function (err) {
      self._dspLoading = false;
      console.warn('[MakanAudio] DSP worklet unavailable, using direct path:', err);
    });
  };

  /* Limiter policy: on whenever the normalizer is on, the EQ is not flat, width is not 1, or ReplayGain boosts. */
  MakanAudioEngine.prototype._dspConfig = function () {
    var st = this.state || {};
    var bypass = !!st.eqBypass || (st.eqEnabled === false);
    var gains = st.eqGains || [];
    var eqActive = false;
    for (var i = 0; i < gains.length; i++) { if (!bypass && Math.abs(parseFloat(gains[i]) || 0) > 0.01) eqActive = true; }
    if (!bypass && Math.abs(parseFloat(st.eqPreamp) || 0) > 0.01) eqActive = true;
    var wide = Math.abs((st.stereoWidth !== undefined ? st.stereoWidth : 1) - 1) > 0.001;
    var rg = (this.lastReplayGainApplied && this.lastReplayGainApplied.mult > 1.001);
    var strength = st.normalizerStrength;
    if (strength !== 'gentle' && strength !== 'normal' && strength !== 'strong') strength = 'strong';
    return { normOn: !!st.loudnessNormalizer, strength: strength, limiterOn: !!(st.loudnessNormalizer || eqActive || wide || rg), ceilingDb: -1 };
  };

  MakanAudioEngine.prototype._syncDsp = function () {
    var cfg = this._dspConfig();
    this.dspConfig = cfg;
    if (this.dspNode && this.dspNode.port) {
      try { this.dspNode.port.postMessage({ type: 'config', config: cfg }); } catch (e) {}
    }
  };

  MakanAudioEngine.prototype.setNormalizerStrength = function (name) {
    var n = (name === 'gentle' || name === 'normal' || name === 'strong') ? name : 'strong';
    this.state.normalizerStrength = n;
    this._syncDsp();
  };


  /* ---------------- Gapless Preloading & Crossfade ---------------- */

  MakanAudioEngine.prototype._checkTransitions = function (curTime, duration) {
    if (!duration || duration <= 0) return;
    if (this.state.repeatMode === 'one') return;

    var remaining = duration - curTime;
    var gaplessEnabled = this.state.gapless !== false;
    var crossfadeSec = parseInt(this.state.crossfade || 0, 10);
    // Auto-mix picks the fade length for each pair of songs (the fixed crossfade setting is not used then)
    var mixOn = this._autoMixOn();
    if (mixOn) crossfadeSec = 10;

    // 1. Preload window: start preloading next track ~5s before end (or crossfadeSec + 3s)
    var preloadWindow = Math.max(5.0, crossfadeSec + 3.0);
    if (gaplessEnabled && remaining <= preloadWindow && !this.preloadedNext && !this.isCrossfading) {
      if (this.controller && typeof this.controller.peekNext === 'function') {
        var nxt = this.controller.peekNext();
        if (nxt && nxt.id !== (this.state.currentTrack ? this.state.currentTrack.id : null)) {
          this._preloadNext(nxt);
        }
      }
    }

    // 2. Crossfade trigger
    var fadeSec = crossfadeSec, mix = null;
    if (mixOn && this.preloadedNext) { mix = this._mixPlan(this.preloadedNext); fadeSec = mix.fade; }
    if (fadeSec > 0 && remaining <= fadeSec && this.preloadedNext && !this.isCrossfading) {
      this._startCrossfade(remaining, mix);
    }
  };

  /* ---- Auto-mix: fade length and tempo nudge chosen from the measured tempo and energy of both songs ---- */
  MakanAudioEngine.prototype._autoMixOn = function () {
    return this.state.autoMix === true && typeof window !== 'undefined' && !!window.MakanAutoMix;
  };

  MakanAudioEngine.prototype._mixPlan = function (next) {
    var AM = window.MakanAutoMix;
    var cur = (this.controller && this.controller.getCurrentTrack && this.controller.getCurrentTrack()) || this.state.currentTrack;
    if (!AM || !cur || !next) return { fade: 5, rate: 1, mode: 'plain' };
    var key = cur.id + '>' + next.id;
    if (this._mixKey === key && this._mixCached) return this._mixCached;
    var map = (window.MakanSound && window.MakanSound.map) || {};
    var userRate = (this.controller && this.controller.playbackRate) || 1;
    this._mixKey = key;
    this._mixCached = AM.plan(map[cur.id], map[next.id], { userRate: userRate });
    return this._mixCached;
  };

  /* after the fade the new song goes back to normal speed in small steps (about 3 seconds) */
  MakanAudioEngine.prototype._rampRateBack = function () {
    var self = this, a = this.activeAudio;
    var target = (this.controller && this.controller.playbackRate) || 1;
    if (!a || a.playbackRate === target) return;
    var from = a.playbackRate, i = 0;
    if (this._rateTimer) clearInterval(this._rateTimer);
    this._rateTimer = setInterval(function () {
      i++;
      if (self.activeAudio !== a || i >= 12) {
        if (self.activeAudio === a) a.playbackRate = target;
        clearInterval(self._rateTimer);
        self._rateTimer = null;
        return;
      }
      a.playbackRate = from + (target - from) * i / 12;
    }, 250);
    if (this._rateTimer && this._rateTimer.unref) this._rateTimer.unref();
  };

  MakanAudioEngine.prototype._preloadNext = function (track) {
    if (!track) return;
    this.preloadedNext = track;

    var src = track.blobUrl || track.src || '';
    if (!src && track.id) {
      src = '/api/stream?id=' + encodeURIComponent(track.id);
      track.src = src;
    }

    if (src) {
      this.nextAudio.src = src;
      this.nextAudio.preload = 'auto';
      this.nextAudio.currentTime = 0;
      try { this.nextAudio.playbackRate = (this.controller && this.controller.playbackRate) || 1; } catch (e) { /* mock */ }
      if (this.fadeGainB && this.audioCtx) {
        var nextGain = (this.activeAudio === this.audioA) ? this.fadeGainB : this.fadeGainA;
        nextGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      }
      this.nextAudio.load();
    }
  };

  MakanAudioEngine.prototype._startCrossfade = function (fadeDuration, plan) {
    this.ensureContext();
    this.isCrossfading = true;
    var dur = Math.max(0.5, Math.min(10.0, fadeDuration));
    var ctx = this.audioCtx;

    var curFadeGain = (this.activeAudio === this.audioA) ? this.fadeGainA : this.fadeGainB;
    var nextFadeGain = (this.activeAudio === this.audioA) ? this.fadeGainB : this.fadeGainA;

    if (ctx && curFadeGain && nextFadeGain) {
      var now = ctx.currentTime;
      curFadeGain.gain.cancelScheduledValues(now);
      nextFadeGain.gain.cancelScheduledValues(now);
      curFadeGain.gain.setValueAtTime(curFadeGain.gain.value, now);
      nextFadeGain.gain.setValueAtTime(0.001, now);
      curFadeGain.gain.linearRampToValueAtTime(0.001, now + dur);
      nextFadeGain.gain.linearRampToValueAtTime(1.0, now + dur);
    }

    if (plan && plan.rate && plan.rate !== 1) {
      try { this.nextAudio.playbackRate = plan.rate; } catch (e) { /* keep normal speed */ }
    }
    var self = this;
    var nextTrack = this.preloadedNext;
    this.nextAudio.play().then(function () {
      if (!self.isCrossfading) {
        self.nextAudio.pause();
        return;
      }
      self.crossfadeTimer = setTimeout(function () {
        self._completeCrossfade(nextTrack);
      }, dur * 1000);
    }).catch(function (e) {
      console.warn('[MakanAudio] Crossfade start rejected:', e);
      self.isCrossfading = false;
    });
  };

  MakanAudioEngine.prototype._completeCrossfade = function (newTrack) {
    this.isCrossfading = false;
    this.activeAudio.pause();
    this.activeAudio.currentTime = 0;

    // Swap active and next audio
    var prevActive = this.activeAudio;
    this.activeAudio = this.nextAudio;
    this.nextAudio = prevActive;
    this.audio = this.activeAudio;

    this.preloadedNext = null;
    this._rampRateBack();

    if (this.controller && newTrack) {
      this.controller.advanceToPreloadedNext(newTrack);
    }
    this.applyReplayGain(newTrack);
  };

  MakanAudioEngine.prototype._switchPreloadedTrack = function () {
    var newTrack = this.preloadedNext;
    if (!newTrack) return;

    this.ensureContext();
    var curFadeGain = (this.activeAudio === this.audioA) ? this.fadeGainA : this.fadeGainB;
    var nextFadeGain = (this.activeAudio === this.audioA) ? this.fadeGainB : this.fadeGainA;

    if (this.audioCtx && curFadeGain && nextFadeGain) {
      var now = this.audioCtx.currentTime;
      curFadeGain.gain.setValueAtTime(0, now);
      nextFadeGain.gain.setValueAtTime(1.0, now);
    }

    this.activeAudio.pause();
    this.activeAudio.currentTime = 0;

    var prevActive = this.activeAudio;
    this.activeAudio = this.nextAudio;
    this.nextAudio = prevActive;
    this.audio = this.activeAudio;

    this.preloadedNext = null;

    if (this.controller) {
      this.controller.advanceToPreloadedNext(newTrack);
    }
    this.applyReplayGain(newTrack);

    var self = this;
    this.activeAudio.play().catch(function (err) {
      console.warn('[MakanAudio] Preloaded track play error:', err);
      if (self.controller) self.controller.onTrackEnded();
    });
  };

  MakanAudioEngine.prototype.handleTrackEnded = function () {
    if (this._stopped) {
      return;
    }

    if (this.state.repeatMode === 'one') {
      this.activeAudio.currentTime = 0;
      this.activeAudio.play().catch(function () {});
      return;
    }

    if (this.preloadedNext && !this.isCrossfading) {
      this._switchPreloadedTrack();
    } else if (this.controller && !this.isCrossfading) {
      this.controller.onTrackEnded();
    }
  };

  /* ---------------- Real ReplayGain Engine ---------------- */

  MakanAudioEngine.prototype.applyReplayGain = function (track) {
    this.ensureContext();
    if (!this.replayGainNode || !this.audioCtx) return;

    var t = track || this.state.currentTrack;
    if (!t) {
      this.replayGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
      this.lastReplayGainApplied = { mult: 1.0, gainDb: 0, mode: 'off' };
      return;
    }

    var mode = this.state.replayGainMode || 'track'; // 'off' | 'track' | 'album' | 'prevent_clipping'
    if (mode === 'off') {
      this.replayGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
      this.lastReplayGainApplied = { mult: 1.0, gainDb: 0, mode: 'off' };
      return;
    }

    var preamp = parseFloat(this.state.replayGainPreamp) || 0.0;
    var preampFallback = parseFloat(this.state.replayGainPreampFallback) || 0.0;

    var trackGain = (t.replaygain_track_gain !== undefined && t.replaygain_track_gain !== null) ? parseFloat(t.replaygain_track_gain) : null;
    var albumGain = (t.replaygain_album_gain !== undefined && t.replaygain_album_gain !== null) ? parseFloat(t.replaygain_album_gain) : null;
    var trackPeak = (t.replaygain_track_peak !== undefined && t.replaygain_track_peak !== null) ? parseFloat(t.replaygain_track_peak) : 1.0;
    var albumPeak = (t.replaygain_album_peak !== undefined && t.replaygain_album_peak !== null) ? parseFloat(t.replaygain_album_peak) : 1.0;

    var targetGainDb;
    var targetPeak;

    if (mode === 'album') {
      targetGainDb = (albumGain !== null) ? albumGain : ((trackGain !== null) ? trackGain : null);
      targetPeak = (albumPeak > 0) ? albumPeak : trackPeak;
    } else {
      targetGainDb = (trackGain !== null) ? trackGain : null;
      targetPeak = trackPeak;
    }

    var totalGainDb;
    if (targetGainDb === null || isNaN(targetGainDb)) {
      totalGainDb = preampFallback;
    } else {
      totalGainDb = targetGainDb + preamp;
    }

    var mult = Math.pow(10, totalGainDb / 20);

    // Prevent clipping if requested or in prevent_clipping mode
    if (mode === 'prevent_clipping' || this.state.replayGainPreventClipping) {
      if (targetPeak && targetPeak > 0) {
        if (mult * targetPeak > 1.0) {
          mult = 1.0 / targetPeak;
        }
      }
    }

    // Safety clamp (never amplify uncontrollably)
    mult = Math.max(0.01, Math.min(3.98, mult)); // -40dB to +12dB

    this.replayGainNode.gain.setValueAtTime(mult, this.audioCtx.currentTime);
    this.lastReplayGainApplied = {
      mult: mult,
      gainDb: totalGainDb,
      mode: mode,
      peak: targetPeak
    };
    this._syncDsp();
  };

  /* ---------------- Real 10-Band Equalizer & Preamp ---------------- */

  MakanAudioEngine.prototype.setEqBandGain = function (bandIndex, gainVal) {
    if (bandIndex < 0 || bandIndex >= EQ_FREQS.length) return;
    var g = Math.max(-12, Math.min(12, parseFloat(gainVal) || 0));
    if (g !== 0 && this.backendType === 'native') {
      if (this.state && typeof this.state.emit === 'function') {
        this.state.emit('toast', {
          message: 'Switching to Web Audio backend for Equalizer processing.',
          type: 'info'
        });
      }
      this.setBackend('webaudio');
    }
    if (!this.state.eqGains) this.state.eqGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.state.eqGains[bandIndex] = g;

    this.ensureContext();
    if (this.eqFilters && this.eqFilters[bandIndex] && this.audioCtx) {
      var isBypassed = !!this.state.eqBypass || (this.state.eqEnabled === false);
      var actualGain = isBypassed ? 0 : g;
      try {
        this.eqFilters[bandIndex].gain.cancelScheduledValues(this.audioCtx.currentTime);
        this.eqFilters[bandIndex].gain.setValueAtTime(actualGain, this.audioCtx.currentTime);
      } catch (e) {}
      this.eqFilters[bandIndex].gain.value = actualGain;
    }
    this._syncDsp();
  };

  MakanAudioEngine.prototype.setEqPreamp = function (gainDb) {
    var p = Math.max(-12, Math.min(12, parseFloat(gainDb) || 0));
    this.state.eqPreamp = p;
    this.ensureContext();
    if (this.eqPreampNode && this.audioCtx) {
      var isBypassed = !!this.state.eqBypass || (this.state.eqEnabled === false);
      var actualPreamp = isBypassed ? 0 : p;
      var mult = Math.pow(10, actualPreamp / 20);
      try {
        this.eqPreampNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
        this.eqPreampNode.gain.setValueAtTime(mult, this.audioCtx.currentTime);
      } catch (e) {}
      this.eqPreampNode.gain.value = mult;
    }
  };

  MakanAudioEngine.prototype.setEqBypass = function (isBypassed) {
    this.state.eqBypass = !!isBypassed;
    if (this.state.eqEnabled !== undefined) {
      this.state.eqEnabled = !this.state.eqBypass;
    }
    this.ensureContext();
    if (!this.audioCtx) return;

    var now = this.audioCtx.currentTime;
    // Update filters
    for (var i = 0; i < this.eqFilters.length; i++) {
      var g = this.state.eqBypass ? 0 : (this.state.eqGains[i] || 0);
      try {
        this.eqFilters[i].gain.cancelScheduledValues(now);
        this.eqFilters[i].gain.setValueAtTime(g, now);
      } catch (e) {}
      this.eqFilters[i].gain.value = g;
    }
    // Update preamp
    if (this.eqPreampNode) {
      var p = this.state.eqBypass ? 0 : (this.state.eqPreamp || 0);
      var mult = Math.pow(10, p / 20);
      try {
        this.eqPreampNode.gain.cancelScheduledValues(now);
        this.eqPreampNode.gain.setValueAtTime(mult, now);
      } catch (e) {}
      this.eqPreampNode.gain.value = mult;
    }
  };

  MakanAudioEngine.prototype.setEqPreset = function (presetName) {
    var gains = EQ_PRESETS[presetName] || EQ_PRESETS.flat;
    this.state.eqPreset = presetName;
    this.ensureContext();
    for (var i = 0; i < gains.length; i++) {
      this.setEqBandGain(i, gains[i]);
    }
    if (presetName === 'potplayer' || presetName === 'crystal' || presetName === 'clear') {
      this.setLoudnessNormalizer(true);
      this.setStereoWidth(1.0);
    }
    this._syncDsp();
  };

  MakanAudioEngine.prototype.setLoudnessNormalizer = function (enabled) {
    if (enabled && this.backendType === 'native') {
      if (this.state && typeof this.state.emit === 'function') {
        this.state.emit('toast', {
          message: 'Switching to Web Audio backend for Loudness Normalizer processing.',
          type: 'info'
        });
      }
      this.setBackend('webaudio');
    }
    this.state.loudnessNormalizer = !!enabled;
    this.ensureContext();
    this._syncDsp();
  };

  MakanAudioEngine.prototype.setStereoWidth = function (widthVal) {
    var w = Math.max(0.5, Math.min(2.0, parseFloat(widthVal) || 1.0));
    this.state.stereoWidth = w;
    this.ensureContext();
    if (this.gainLL && this.gainRR && this.gainLR && this.gainRL && this.audioCtx) {
      var direct = 1.0 + 0.5 * (w - 1.0);
      var cross = -0.5 * (w - 1.0);
      if (Math.abs(cross) < 1e-9) cross = 0.0;
      var now = this.audioCtx.currentTime;
      try {
        this.gainLL.gain.cancelScheduledValues(now);
        this.gainLL.gain.setValueAtTime(direct, now);
        this.gainRR.gain.cancelScheduledValues(now);
        this.gainRR.gain.setValueAtTime(direct, now);
        this.gainLR.gain.cancelScheduledValues(now);
        this.gainLR.gain.setValueAtTime(cross, now);
        this.gainRL.gain.cancelScheduledValues(now);
        this.gainRL.gain.setValueAtTime(cross, now);
      } catch (e) {}
      this.gainLL.gain.value = direct;
      this.gainRR.gain.value = direct;
      this.gainLR.gain.value = cross;
      this.gainRL.gain.value = cross;
    }
    this._syncDsp();
  };

  /* MAKAN Sound: off | natural | clear | power  (v1.9) */
  var SOUND_MODES = ['off', 'natural', 'clear', 'power'];

  MakanAudioEngine.prototype.getSoundMode = function () {
    var m = this.state.soundMode;
    if (SOUND_MODES.indexOf(m) >= 0 && (m === 'off') === !this.state.potPlayerMode) return m;
    return this.state.potPlayerMode ? 'power' : 'off';
  };

  MakanAudioEngine.prototype.cycleSoundMode = function () {
    var cur = this.getSoundMode();
    var next = SOUND_MODES[(SOUND_MODES.indexOf(cur) + 1) % SOUND_MODES.length];
    this.setSoundMode(next);
    return next;
  };

  MakanAudioEngine.prototype.setSoundMode = function (mode) {
    var m = SOUND_MODES.indexOf(mode) >= 0 ? mode : 'off';
    var on = m !== 'off';
    if (on && this.backendType === 'native') {
      if (this.state && typeof this.state.emit === 'function') {
        this.state.emit('toast', { message: 'Switching to Web Audio backend for MAKAN Sound processing.', type: 'info' });
      }
      this.setBackend('webaudio');
    }
    this.state.soundMode = m;
    this.state.potPlayerMode = on;
    this.ensureContext();
    if (m === 'off') {
      this.setEqPreset('flat');
      this.setLoudnessNormalizer(false);
      this.setStereoWidth(1.0);
    } else if (m === 'natural') {
      this.setEqPreset('flat');
      this.setNormalizerStrength('gentle');
      this.setLoudnessNormalizer(true);
      this.setStereoWidth(1.0);
    } else if (m === 'clear') {
      this.setEqPreset('clear');
      this.setNormalizerStrength('normal');
      this.setStereoWidth(1.0);
    } else {
      this.setEqPreset('potplayer');
      this.setNormalizerStrength('strong');
      this.setStereoWidth(1.0);
    }
    this._syncDsp();
    if (this.state && typeof this.state.emit === 'function') {
      this.state.emit('potPlayerModeChanged', { enabled: on, mode: m });
    }
  };

  MakanAudioEngine.prototype.setPotPlayerMode = function (enabled) {
    this.setSoundMode(enabled ? 'power' : 'off');
  };

  MakanAudioEngine.prototype.isPotPlayerMode = function () {
    return !!(this.state.potPlayerMode || (this.state.loudnessNormalizer && (this.state.eqPreset === 'potplayer' || this.state.eqPreset === 'crystal')));
  };

  MakanAudioEngine.prototype.resetEq = function () {
    this.setEqPreset('flat');
    this.setEqPreamp(0);
    this.setEqBypass(false);
    this.setLoudnessNormalizer(false);
    this.setStereoWidth(1.0);
    this.state.potPlayerMode = false;
    this.state.soundMode = 'off';
    if (this.state && typeof this.state.emit === 'function') {
      this.state.emit('potPlayerModeChanged', { enabled: false, mode: 'off' });
    }
  };

  MakanAudioEngine.prototype.getEqFilterGains = function () {
    return this.eqFilters.map(function (f) { return f.gain.value; });
  };

  MakanAudioEngine.prototype.getEqFrequencies = function () {
    return EQ_FREQS.slice();
  };

  MakanAudioEngine.prototype.getEqPreampGain = function () {
    return this.eqPreampNode ? this.eqPreampNode.gain.value : 1.0;
  };

  MakanAudioEngine.prototype.applyEq = function () {
    if (!this.state) return;

    // 1. Authoritative ten-band values
    if (!Array.isArray(this.state.eqGains) || this.state.eqGains.length !== 10) {
      if (Array.isArray(this.eqGains) && this.eqGains.length === 10) {
        this.state.eqGains = this.eqGains.slice();
      } else {
        this.state.eqGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      }
    }
    this.eqGains = this.state.eqGains;

    // 2. Honor state.eqBypass / canonical eqEnabled
    var isBypassed = !!this.state.eqBypass || (this.state.eqEnabled === false);
    this.state.eqBypass = isBypassed;
    if (this.state.eqEnabled !== undefined) {
      this.state.eqEnabled = !isBypassed;
    }
    this.eqBypass = isBypassed;

    // 3. Preserve state.eqPreset
    if (this.state.eqPreset) {
      this.eqPreset = this.state.eqPreset;
    } else if (this.eqPreset) {
      this.state.eqPreset = this.eqPreset;
    }

    // 4. Apply state.eqPreamp to the real preamp gain node
    var preampDb = (this.state.eqPreamp !== undefined) ? (parseFloat(this.state.eqPreamp) || 0) : 0;
    preampDb = Math.max(-12, Math.min(12, preampDb));
    this.state.eqPreamp = preampDb;
    this.eqPreamp = preampDb;

    var actualPreampDb = isBypassed ? 0 : preampDb;
    var preampMult = Math.pow(10, actualPreampDb / 20);

    if (this.eqPreampNode && this.audioCtx) {
      try {
        this.eqPreampNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
        this.eqPreampNode.gain.setValueAtTime(preampMult, this.audioCtx.currentTime);
      } catch (ePreamp) {
        this.eqPreampNode.gain.value = preampMult;
      }
    }

    // 5. Apply all ten gains to their real BiquadFilterNodes
    for (var i = 0; i < 10; i++) {
      var rawGain = parseFloat(this.state.eqGains[i]);
      if (isNaN(rawGain)) rawGain = 0;
      rawGain = Math.max(-12, Math.min(12, rawGain));
      this.state.eqGains[i] = rawGain;

      if (this.eqFilters && this.eqFilters[i] && this.audioCtx) {
        var actualGain = isBypassed ? 0 : rawGain;
        try {
          this.eqFilters[i].gain.cancelScheduledValues(this.audioCtx.currentTime);
          this.eqFilters[i].gain.setValueAtTime(actualGain, this.audioCtx.currentTime);
        } catch (eFilter) {
          this.eqFilters[i].gain.value = actualGain;
        }
      }
    }

    // 6. Apply loudness normalizer and stereo width
    if (this.state.loudnessNormalizer !== undefined) {
      this.setLoudnessNormalizer(this.state.loudnessNormalizer);
    }
    if (this.state.stereoWidth !== undefined) {
      this.setStereoWidth(this.state.stereoWidth);
    }
  };

  /* ---------------- Playback Controls ---------------- */

  MakanAudioEngine.prototype.play = function () {
    this._stopped = false;
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      this.state.setPlayState(true);
      return this.nativeAudioBackend.play();
    }
    this.ensureContext();
    var self = this;
    var a = this.activeAudio;

    if (!a.src) {
      var track = this.state.currentTrack;
      if (track && (track.src || track.blobUrl)) {
        a.src = track.blobUrl || track.src;
      } else {
        self.state.setPlayState(false);
        return;
      }
    }

    // Ensure active fade gain is 1.0
    if (this.audioCtx && this.fadeGainA && this.fadeGainB) {
      var activeGain = (this.activeAudio === this.audioA) ? this.fadeGainA : this.fadeGainB;
      activeGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
    }

    var playPromise = a.play();
    if (playPromise !== undefined) {
      playPromise.then(function () {
        self.state.setPlayState(true);
      }).catch(function (err) {
        console.warn('[MakanAudio] Playback call rejected:', err.message);
        self.state.setPlayState(false);
      });
    }
  };

  MakanAudioEngine.prototype.pause = function () {
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      this.state.setPlayState(false);
      return this.nativeAudioBackend.pause();
    }
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    this.isCrossfading = false;
    this.activeAudio.pause();
    this.nextAudio.pause();
    if (this.audioCtx && this.fadeGainA && this.fadeGainB) {
      var activeGain = (this.activeAudio === this.audioA) ? this.fadeGainA : this.fadeGainB;
      var inactiveGain = (this.activeAudio === this.audioA) ? this.fadeGainB : this.fadeGainA;
      activeGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
      inactiveGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
    }
    this.state.setPlayState(false);
  };

  MakanAudioEngine.prototype.stop = function (clearSources) {
    this._stopped = true;
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      if (this.state) {
        this.state.currentTime = 0;
        this.state.setPlayState(false);
      }
      return this.nativeAudioBackend.stop();
    }
    // 1. Cancel any crossfade timer
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }

    // 2. Cancel the crossfade state
    this.isCrossfading = false;

    // 3. Pause both audio elements
    if (this.activeAudio) {
      try { this.activeAudio.pause(); } catch (ePauseA) {}
    }
    if (this.nextAudio) {
      try { this.nextAudio.pause(); } catch (ePauseB) {}
    }

    // 4. Reset both current times safely
    try {
      if (this.activeAudio && !isNaN(this.activeAudio.currentTime)) {
        this.activeAudio.currentTime = 0;
      }
    } catch (eTimeA) {}
    try {
      if (this.nextAudio && !isNaN(this.nextAudio.currentTime)) {
        this.nextAudio.currentTime = 0;
      }
    } catch (eTimeB) {}

    // 5. Clear preloadedNext
    this.preloadedNext = null;

    // 6. Restore active/inactive fade gains
    if (this.audioCtx && this.fadeGainA && this.fadeGainB) {
      try {
        var activeGain = (this.activeAudio === this.audioA) ? this.fadeGainA : this.fadeGainB;
        var inactiveGain = (this.activeAudio === this.audioA) ? this.fadeGainB : this.fadeGainA;
        var now = this.audioCtx.currentTime;
        activeGain.gain.cancelScheduledValues(now);
        inactiveGain.gain.cancelScheduledValues(now);
        activeGain.gain.setValueAtTime(1.0, now);
        inactiveGain.gain.setValueAtTime(0.0, now);
      } catch (eGain) {}
    }

    // 7. Clear both audio sources when appropriate
    if (clearSources === true || !this.state || !this.state.currentTrack) {
      if (this.activeAudio) {
        try {
          if (typeof this.activeAudio.removeAttribute === 'function') {
            this.activeAudio.removeAttribute('src');
          }
        } catch (eAttrA) {}
        try {
          this.activeAudio.src = '';
        } catch (eSrcA) {}
      }
      if (this.nextAudio) {
        try {
          if (typeof this.nextAudio.removeAttribute === 'function') {
            this.nextAudio.removeAttribute('src');
          }
        } catch (eAttrB) {}
        try {
          this.nextAudio.src = '';
        } catch (eSrcB) {}
      }
    }

    // 8. Set playback state to stopped
    if (this.state) {
      this.state.currentTime = 0;
      if (typeof this.state.setPlayState === 'function') {
        this.state.setPlayState(false);
      } else {
        this.state.isPlaying = false;
      }
    }
  };

  MakanAudioEngine.prototype.togglePlay = function () {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  };

  MakanAudioEngine.prototype.seek = function (seconds) {
    var dur = this.state.duration || this.activeAudio.duration || 0;
    var s = Math.max(0, dur ? Math.min(dur, seconds) : seconds);

    if (this.backendType === 'native' && this.nativeAudioBackend) {
      this.state.setCurrentTime(s);
      this.state.emit('seeked', { currentTime: s, duration: dur });
      return this.nativeAudioBackend.seek(s);
    }

    // Cancel in-flight crossfade if seeking
    if (this.isCrossfading) {
      if (this.crossfadeTimer) {
        clearTimeout(this.crossfadeTimer);
        this.crossfadeTimer = null;
      }
      this.isCrossfading = false;
      this.nextAudio.pause();
      if (this.audioCtx && this.fadeGainA && this.fadeGainB) {
        var activeGain = (this.activeAudio === this.audioA) ? this.fadeGainA : this.fadeGainB;
        var inactiveGain = (this.activeAudio === this.audioA) ? this.fadeGainB : this.fadeGainA;
        activeGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
        inactiveGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
      }
    }
    this.preloadedNext = null;

    this.activeAudio.currentTime = s;
    this.state.setCurrentTime(s);
    this.state.emit('seeked', { currentTime: s, duration: dur });
  };

  MakanAudioEngine.prototype.setVolume = function (vol) {
    this.state.setVolume(vol);
    this.activeAudio.volume = this.state.volume;
    this.nextAudio.volume = this.state.volume;
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this.state.muted ? 0 : this.state.volume, this.audioCtx.currentTime);
    }
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      this.nativeAudioBackend.setVolume(this.state.volume);
    }
  };

  MakanAudioEngine.prototype.setMuted = function (muted) {
    this.state.muted = !!muted;
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this.state.muted ? 0 : this.state.volume, this.audioCtx.currentTime);
    }
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      this.nativeAudioBackend.setMute(this.state.muted);
    }
  };

  MakanAudioEngine.prototype.setStereoPan = function (panVal) {
    this.state.pan = panVal;
    if (this.panNode) {
      this.panNode.pan.value = panVal;
    }
  };

  MakanAudioEngine.prototype.loadTrack = function (track, autoPlay) {
    this.preloadedNext = null;
    if (this.isCrossfading) {
      if (this.crossfadeTimer) {
        clearTimeout(this.crossfadeTimer);
        this.crossfadeTimer = null;
      }
      this.isCrossfading = false;
      this.nextAudio.pause();
    }

    if (this.backendType === 'native' && this.nativeAudioBackend) {
      var self = this;
      if (!track) {
        this.state.setPlayState(false);
        return this.nativeAudioBackend.stop();
      }
      return this.nativeAudioBackend.loadTrack(track, { autoplay: !!autoPlay, startPosition: 0 }).catch(function (err) {
        console.warn('[AudioEngine] Native load failed, falling back to Web Audio:', err);
        self.handleNativeErrorFallback(err);
      });
    }

    if (!track) {
      this.activeAudio.src = '';
      this.nextAudio.src = '';
      this.state.setPlayState(false);
      return;
    }

    var src = track.blobUrl || track.src || '';
    if (!src && track.id) {
      src = '/api/stream?id=' + encodeURIComponent(track.id);
      track.src = src;
    }

    this.activeAudio.src = src;

    // Apply ReplayGain
    this.applyReplayGain(track);

    if (autoPlay) {
      this.play();
    }
  };

  MakanAudioEngine.prototype.preloadNext = function (track) {
    return this._preloadNext(track);
  };

  /* ---------------- Backend Management (v1.8.0) ---------------- */

  MakanAudioEngine.prototype.setBackend = function (type) {
    var target = (type === 'native' && this.nativeAudioBackend) ? 'native' : 'webaudio';
    if (this.backendType === target) return Promise.resolve(true);

    var curTrack = this.state.currentTrack;
    var wasPlaying = this.state.isPlaying;
    var curPos = (this.backendType === 'native' && this.nativeAudioBackend)
      ? this.nativeAudioBackend.getPosition()
      : (this.activeAudio ? (this.activeAudio.currentTime || 0) : (this.state.currentTime || 0));

    // Pause outgoing backend
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      this.nativeAudioBackend.pause();
    } else {
      this.activeAudio.pause();
    }

    this.backendType = target;
    this.backend = (target === 'native') ? this.nativeAudioBackend : this.webAudioBackend;
    this.state.audioBackend = target;

    if (window.MakanDesktop && window.MakanDesktop.setSettings) {
      window.MakanDesktop.setSettings({ audioBackend: target });
    }

    var self = this;
    var initPromise = (target === 'native' && this.nativeAudioBackend)
      ? this.nativeAudioBackend.initialize()
      : Promise.resolve(true);

    return initPromise.then(function () {
      if (curTrack) {
        if (target === 'native') {
          return self.nativeAudioBackend.loadTrack(curTrack, { autoplay: wasPlaying, startPosition: curPos });
        } else {
          self.loadTrack(curTrack, wasPlaying);
          if (curPos > 0) self.seek(curPos);
        }
      }
      self.state.emit('backendChanged', { backend: target });
      return true;
    }).catch(function (err) {
      console.error('[AudioEngine] Backend switch failed:', err);
      self.handleNativeErrorFallback(err);
      return false;
    });
  };

  MakanAudioEngine.prototype.handleNativeErrorFallback = function (err) {
    var curTrack = this.state.currentTrack;
    var curPos = (this.nativeAudioBackend ? this.nativeAudioBackend.getPosition() : this.state.currentTime) || 0;
    var wasPlaying = this.state.isPlaying;

    console.warn('[NativeAudio] Initiating safe fallback to Web Audio backend. Reason:', err && (err.message || err.code));
    if (this.state && typeof this.state.emit === 'function') {
      this.state.emit('toast', {
        message: 'Native audio encountered an issue (' + ((err && err.message) || 'Device error') + '). Switched safely to Web Audio.',
        type: 'warning'
      });
    }

    this.backendType = 'webaudio';
    this.backend = this.webAudioBackend;
    this.state.audioBackend = 'webaudio';

    if (window.MakanDesktop && window.MakanDesktop.setSettings) {
      window.MakanDesktop.setSettings({ audioBackend: 'webaudio' });
    }

    if (curTrack) {
      this.loadTrack(curTrack, wasPlaying);
      if (curPos > 0) {
        this.seek(curPos);
      }
    }
    this.state.emit('backendChanged', { backend: 'webaudio', fallback: true, reason: err && err.message });
  };

  MakanAudioEngine.prototype.getAudioPath = function () {
    if (this.backendType === 'native' && this.nativeAudioBackend) {
      return this.nativeAudioBackend.getAudioPath();
    }
    return this.webAudioBackend ? this.webAudioBackend.getAudioPath() : null;
  };

  MakanAudioEngine.prototype.playTestChime = function () {
    this.ensureContext();
    if (this.audioCtx) {
      var now = this.audioCtx.currentTime;
      var osc = this.audioCtx.createOscillator();
      var gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.15); // A5
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.65);
    }
  };

  /* ---------------- Real Audio Analyser Data ---------------- */

  MakanAudioEngine.prototype.getAudioData = function () {
    var isPlaying = this.state.isPlaying;

    if (this.backendType === 'native' && this.nativeAudioBackend) {
      return this.nativeAudioBackend.getVisualizerData();
    }

    if (!this.analyser || !isPlaying) {
      return {
        freq: null,
        time: null,
        bass: 0,
        mid: 0,
        treble: 0,
        rms: 0,
        isPlaying: false
      };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    var binCount = this.analyser.frequencyBinCount;
    var bassEnd = Math.floor(binCount * 0.12);
    var midEnd = Math.floor(binCount * 0.50);

    var bassSum = 0;
    var bassCnt = 0;
    for (var b = 0; b < bassEnd; b++) {
      bassSum += this.freqData[b];
      bassCnt++;
    }
    var bassVal = bassCnt ? (bassSum / bassCnt) / 255 : 0;

    var midSum = 0;
    var midCnt = 0;
    for (var m = bassEnd; m < midEnd; m++) {
      midSum += this.freqData[m];
      midCnt++;
    }
    var midVal = midCnt ? (midSum / midCnt) / 255 : 0;

    var trebSum = 0;
    var trebCnt = 0;
    for (var t = midEnd; t < binCount; t++) {
      trebSum += this.freqData[t];
      trebCnt++;
    }
    var trebleVal = trebCnt ? (trebSum / trebCnt) / 255 : 0;

    var rmsSum = 0;
    for (var s = 0; s < this.timeData.length; s++) {
      var sample = (this.timeData[s] - 128) / 128;
      rmsSum += sample * sample;
    }
    var rmsVal = Math.sqrt(rmsSum / this.timeData.length);

    this.state.audioEnergy.bass = bassVal;
    this.state.audioEnergy.mid = midVal;
    this.state.audioEnergy.treble = trebleVal;
    this.state.audioEnergy.rms = rmsVal;

    return {
      freq: this.freqData,
      time: this.timeData,
      bass: bassVal,
      mid: midVal,
      treble: trebleVal,
      rms: rmsVal,
      isPlaying: true
    };
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MakanAudioEngine;
    module.exports.MakanAudioEngine = MakanAudioEngine;
    module.exports.EQ_FREQS = EQ_FREQS;
    module.exports.EQ_PRESETS = EQ_PRESETS;
  }
  if (typeof window !== 'undefined') {
    window.MakanAudioEngine = MakanAudioEngine;
  }
})();
