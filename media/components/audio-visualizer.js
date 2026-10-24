/*
 * media/components/audio-visualizer.js - Dual real-time audio visualizer for MAKAN Music Player.
 * Features:
 * - Real audio-reactive Spectrum Bars on top (Cyan -> Magenta -> Violet)
 * - Real audio-reactive Waveform / Oscilloscope directly below
 * - Foobar2000 Peak hold gravity drop
 * - Themes: Cyan (Mockup reference), Aurora, Rainbow, Custom
 * - HiDPI Retina canvas scaling (sharp at 100%, 125%, 150% Windows scaling)
 */
(function () {
  'use strict';

  var THEMES = {
    cyan: {
      type: 'gradient',
      spectrumStops: ['#00f0ff', '#0ea5e9', '#6366f1', '#ec4899', '#f472b6'],
      waveStops: ['#00f0ff', '#818cf8', '#e879f9', '#f43f5e'],
      glow: 'rgba(0, 240, 255, 0.45)'
    },
    aurora: {
      type: 'gradient',
      spectrumStops: ['#06d6a0', '#0a9396', '#38bdf8', '#70e000', '#ccff33'],
      waveStops: ['#005f73', '#06d6a0', '#70e000', '#ccff33'],
      glow: 'rgba(6, 214, 160, 0.45)'
    },
    rainbow: {
      type: 'rainbow',
      spectrumStops: ['#ff0055', '#ff7700', '#ffea00', '#00ff88', '#00d0ff', '#7000ff'],
      waveStops: ['#ff0055', '#ff7700', '#ffea00', '#00ff88', '#00d0ff', '#7000ff'],
      glow: 'rgba(0, 229, 255, 0.45)'
    },
    custom: {
      type: 'gradient',
      spectrumStops: ['#38bdf8', '#818cf8', '#c084fc', '#f472b6'],
      waveStops: ['#38bdf8', '#818cf8', '#f472b6'],
      glow: 'rgba(129, 140, 248, 0.45)'
    },
    sunset: {
      type: 'gradient',
      spectrumStops: ['#ff512f', '#f09819', '#ffd200', '#ff6a88', '#c471ed'],
      waveStops: ['#ff512f', '#f09819', '#ff6a88', '#c471ed'],
      glow: 'rgba(255, 106, 136, 0.45)'
    },
    ocean: {
      type: 'gradient',
      spectrumStops: ['#00c6ff', '#0072ff', '#00e5c3', '#4facfe', '#a18cd1'],
      waveStops: ['#00c6ff', '#0072ff', '#00e5c3'],
      glow: 'rgba(0, 198, 255, 0.45)'
    },
    gold: {
      type: 'gradient',
      spectrumStops: ['#f6d365', '#fda085', '#ffe29f', '#fff1b8', '#d9c28f'],
      waveStops: ['#f6d365', '#fda085', '#ffe29f'],
      glow: 'rgba(246, 211, 101, 0.4)'
    },
    violet: {
      type: 'gradient',
      spectrumStops: ['#8e2de2', '#4a00e0', '#c471ed', '#f64f59', '#ff9a9e'],
      waveStops: ['#8e2de2', '#c471ed', '#f64f59'],
      glow: 'rgba(142, 45, 226, 0.45)'
    },
    candy: {
      type: 'gradient',
      spectrumStops: ['#ff9a9e', '#fbc2eb', '#a1c4fd', '#c2e9fb', '#84fab0'],
      waveStops: ['#ff9a9e', '#a1c4fd', '#84fab0'],
      glow: 'rgba(251, 194, 235, 0.4)'
    }
  };
  var STYLES = ['bars', 'mirror', 'area'];

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // colour along a list of stops, t from 0 to 1
  function colorAt(stops, t) {
    if (t <= 0) return hexToRgb(stops[0]);
    if (t >= 1) return hexToRgb(stops[stops.length - 1]);
    var f = t * (stops.length - 1), i = Math.floor(f), k = f - i;
    var a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
    return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
  }

  // Bright caps on dark, deep blue caps on the light theme (white would vanish there).
  function capColor() {
    try { return document.documentElement.getAttribute('data-theme') === 'light' ? '#0c4fae' : '#ffffff'; } catch (e) { return '#ffffff'; }
  }

  function MakanAudioVisualizer(container, state, engine) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.canvas = null;
    this.ctx = null;
    this.animId = null;

    this.barCount = 64;
    this.peakBars = new Float32Array(128);
    this.peakDrops = new Float32Array(128);
    this.smooth = new Float32Array(128);
    this.gain = 120;
    this.bandPeak = new Float32Array(128).fill(60); // follows the loudest band so quiet high notes still move the bars

    this.render();
    this.setupCanvas();
    this.startLoop();
  }

  MakanAudioVisualizer.prototype.render = function () {
    var html = '' +
      '<div class="mk-visualizer-card" id="mk-visualizer-card">' +
      '  <canvas class="mk-visualizer-canvas" id="mk-visualizer-canvas"></canvas>' +
      '</div>';
    this.container.innerHTML = html;
    this.canvas = this.container.querySelector('#mk-visualizer-canvas');
    this.ctx = this.canvas.getContext('2d');
  };

  MakanAudioVisualizer.prototype.setupCanvas = function () {
    var self = this;
    function resize() {
      if (!self.canvas) return;
      var rect = self.canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      self.canvas.width = Math.max(300, Math.floor(rect.width * dpr));
      self.canvas.height = Math.max(80, Math.floor(rect.height * dpr));
    }
    window.addEventListener('resize', resize);
    setTimeout(resize, 50);
  };

  MakanAudioVisualizer.prototype.startLoop = function () {
    var self = this;

    // Draw only while the window is visible and music is playing (plus ~1 s to let the bars fall), at most ~30 times a second.
    var lastDraw = 0, idle = 0;
    function frame(now) {
      self.animId = requestAnimationFrame(frame);
      if (typeof document !== 'undefined' && document.hidden) return;
      var playing = !!(self.state && self.state.isPlaying);
      idle = playing ? 0 : idle + 1;
      if (idle > 60) return;
      if (now - lastDraw < 32) return;
      lastDraw = now;
      self.draw();
    }
    this.animId = requestAnimationFrame(frame);
  };

  /* one value (0..255) per bar: log-spaced bands across the whole width, balanced so highs move too */
  MakanAudioVisualizer.prototype._bands = function (count, freqData, isPlaying, now) {
    var out = this.bandBuf && this.bandBuf.length >= count ? this.bandBuf : (this.bandBuf = new Float32Array(128));
    var i;
    if (isPlaying && freqData && freqData.length) {
      var ctxRate = (this.engine && this.engine.audioContext && this.engine.audioContext.sampleRate) || 44100;
      var nyq = ctxRate / 2, binHz = nyq / freqData.length;
      var minF = 45, maxF = Math.min(16000, nyq * 0.95), frameMax = 1;
      for (i = 0; i < count; i++) {
        var f0 = minF * Math.pow(maxF / minF, i / count), f1 = minF * Math.pow(maxF / minF, (i + 1) / count);
        var b0 = Math.floor(f0 / binHz), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz)), sum = 0, peak = 0, n = 0;
        for (var b = b0; b < b1 && b < freqData.length; b++) { sum += freqData[b]; if (freqData[b] > peak) peak = freqData[b]; n++; }
        var avg = n ? sum / n : 0;
        var v = avg * 0.55 + peak * 0.45;
        v *= 1 + 1.25 * (i / count); // treble tilt: music has far less energy up there
        // each band also learns its own loudness, so every bar (left to right) moves
        this.bandPeak[i] = Math.max(40, v, this.bandPeak[i] * 0.995);
        out[i] = v * 0.5 + (v / this.bandPeak[i]) * 255 * 0.5;
        if (out[i] > frameMax) frameMax = out[i];
      }
      this.gain = Math.max(110, frameMax, this.gain * 0.994); // auto gain
      var scale = 235 / this.gain;
      for (i = 0; i < count; i++) out[i] = Math.min(255, out[i] * scale);
    } else {
      for (i = 0; i < count; i++) {
        var pos = i / count, bell = Math.sin(pos * Math.PI);
        var idle = this.state.reducedMotion ? 0.5 : (Math.sin(now * 0.003 + pos * 5.0) * 0.35 + 0.65);
        out[i] = Math.round(bell * idle * 120 + 15);
      }
    }
    // smooth: quick rise, soft fall
    for (i = 0; i < count; i++) {
      var prev = this.smooth[i], cur = out[i];
      this.smooth[i] = cur > prev ? prev + (cur - prev) * 0.65 : prev - (prev - cur) * 0.2;
      out[i] = this.smooth[i];
    }
    return out;
  };

  MakanAudioVisualizer.prototype.draw = function () {
    var ctx = this.ctx;
    var canvas = this.canvas;
    if (!ctx || !canvas || canvas.width === 0) return;

    var w = canvas.width;
    var h = canvas.height;
    var dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, w, h);

    var audioData = this.engine.getAudioData();
    var isPlaying = audioData.isPlaying;
    var freqData = audioData.freq;
    var timeData = audioData.time;

    var themeKey = this.state.visualizerTheme || 'cyan';
    var theme = THEMES[themeKey] || THEMES.cyan;
    var style = STYLES.indexOf(this.state.visualizerStyle) >= 0 ? this.state.visualizerStyle : 'bars';
    var now = performance.now();
    var reduced = !!this.state.reducedMotion;
    var rainbowShift = (theme.type === 'rainbow' && !reduced) ? (now * 0.00006) % 1 : 0;

    var showWave = style !== 'mirror';
    var specH = showWave ? Math.floor(h * 0.70) : h;
    var waveH = h - specH;
    var waveBaselineY = specH + Math.floor(waveH * 0.5);

    // colour of a position (0..1) across the width
    function posColor(pos) {
      if (theme.type === 'rainbow') return hslToRgb(((pos + rainbowShift) % 1) * 360, 90, 58);
      return colorAt(theme.spectrumStops, pos);
    }

    var gap = 2.4 * dpr;
    var count = Math.max(28, Math.min(120, Math.floor(w / (8.5 * dpr))));
    this.barCount = count;
    var barWidth = Math.max(2.5 * dpr, (w - gap * (count + 1)) / count);
    var vals = this._bands(count, freqData, isPlaying, now);
    var i, x, y, barH, c, pos;
    var radius = Math.min(barWidth / 2, 3 * dpr);
    ctx.shadowBlur = 0;

    function roundBar(x0, yTop, bw, yBottom, r) {
      ctx.beginPath();
      ctx.moveTo(x0, yBottom);
      ctx.lineTo(x0, yTop + r);
      ctx.quadraticCurveTo(x0, yTop, x0 + r, yTop);
      ctx.lineTo(x0 + bw - r, yTop);
      ctx.quadraticCurveTo(x0 + bw, yTop, x0 + bw, yTop + r);
      ctx.lineTo(x0 + bw, yBottom);
      ctx.closePath();
    }

    if (style === 'bars') {
      for (i = 0; i < count; i++) {
        pos = i / (count - 1);
        c = posColor(pos);
        barH = Math.max(3 * dpr, (vals[i] / 255) * (specH - 8 * dpr));
        x = i * (barWidth + gap) + gap;
        y = specH - barH;
        if (barH >= this.peakBars[i]) { this.peakBars[i] = barH; this.peakDrops[i] = 0; }
        else { this.peakDrops[i] += 0.3 * dpr; this.peakBars[i] = Math.max(0, this.peakBars[i] - this.peakDrops[i]); }
        var g = ctx.createLinearGradient(0, specH, 0, y);
        g.addColorStop(0, rgba(c, 0.30));
        g.addColorStop(1, rgba(c, 1));
        ctx.fillStyle = g;
        roundBar(x, y, barWidth, specH, radius);
        ctx.fill();
        if (this.peakBars[i] > 5 * dpr) {
          ctx.fillStyle = rgba(c, 0.95);
          ctx.fillRect(x, specH - this.peakBars[i] - 3 * dpr, barWidth, 2 * dpr);
        }
      }
    } else if (style === 'mirror') {
      var mid = Math.floor(h / 2), half = mid - 3 * dpr;
      for (i = 0; i < count; i++) {
        pos = i / (count - 1);
        c = posColor(pos);
        var hh = Math.max(2 * dpr, (vals[i] / 255) * half);
        x = i * (barWidth + gap) + gap;
        var gU = ctx.createLinearGradient(0, mid, 0, mid - hh);
        gU.addColorStop(0, rgba(c, 0.55)); gU.addColorStop(1, rgba(c, 1));
        ctx.fillStyle = gU;
        roundBar(x, mid - hh, barWidth, mid - 1 * dpr, radius);
        ctx.fill();
        var gD = ctx.createLinearGradient(0, mid, 0, mid + hh);
        gD.addColorStop(0, rgba(c, 0.45)); gD.addColorStop(1, rgba(c, 0.12));
        ctx.fillStyle = gD;
        ctx.beginPath();
        ctx.moveTo(x, mid + 1 * dpr);
        ctx.lineTo(x + barWidth, mid + 1 * dpr);
        ctx.lineTo(x + barWidth, mid + hh - radius);
        ctx.quadraticCurveTo(x + barWidth, mid + hh, x + barWidth - radius, mid + hh);
        ctx.lineTo(x + radius, mid + hh);
        ctx.quadraticCurveTo(x, mid + hh, x, mid + hh - radius);
        ctx.closePath();
        ctx.fill();
      }
    } else { // 'area': a smooth filled mountain of sound
      var pts2 = [];
      for (i = 0; i < count; i++) {
        var px2 = (i / (count - 1)) * w;
        pts2.push({ x: px2, y: specH - Math.max(3 * dpr, (vals[i] / 255) * (specH - 10 * dpr)) });
      }
      var fillG = ctx.createLinearGradient(0, 0, w, 0), lineG = ctx.createLinearGradient(0, 0, w, 0), s2;
      for (s2 = 0; s2 <= 10; s2++) { var cc = posColor(s2 / 10); fillG.addColorStop(s2 / 10, rgba(cc, 0.55)); lineG.addColorStop(s2 / 10, rgba(cc, 1)); }
      ctx.beginPath();
      ctx.moveTo(0, specH);
      ctx.lineTo(pts2[0].x, pts2[0].y);
      for (i = 0; i < pts2.length - 1; i++) {
        var mx2 = (pts2[i].x + pts2[i + 1].x) / 2, my2 = (pts2[i].y + pts2[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts2[i].x, pts2[i].y, mx2, my2);
      }
      ctx.lineTo(w, pts2[pts2.length - 1].y);
      ctx.lineTo(w, specH);
      ctx.closePath();
      ctx.fillStyle = fillG;
      ctx.fill();
      ctx.strokeStyle = lineG;
      ctx.lineWidth = 2.4 * dpr;
      ctx.beginPath();
      ctx.moveTo(pts2[0].x, pts2[0].y);
      for (i = 0; i < pts2.length - 1; i++) {
        var lx = (pts2[i].x + pts2[i + 1].x) / 2, ly = (pts2[i].y + pts2[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts2[i].x, pts2[i].y, lx, ly);
      }
      ctx.lineTo(w, pts2[pts2.length - 1].y);
      ctx.stroke();
    }

    // ==========================================
    // Oscilloscope line under the bars (not in mirror style)
    // ==========================================
    if (!showWave) return;
    var sampleCount = 130;
    var pts = [];
    for (var j = 0; j < sampleCount; j++) {
      var dev = 0;
      var jRatio = j / (sampleCount - 1);
      if (isPlaying && timeData && timeData.length) {
        var step = Math.floor(timeData.length / sampleCount);
        dev = (timeData[j * step] - 128.0) / 128.0;
      } else {
        var env = Math.sin(jRatio * Math.PI);
        dev = reduced ? 0 : (Math.sin(now * 0.0035 + jRatio * 16.0) * 0.28 * env);
      }
      pts.push({ x: jRatio * w, y: waveBaselineY + dev * (waveH * 0.44) });
    }
    var waveGrad = ctx.createLinearGradient(0, 0, w, 0);
    for (var sw = 0; sw <= 10; sw++) {
      var wc = posColor(sw / 10);
      waveGrad.addColorStop(sw / 10, rgba(wc, 0.95));
    }
    ctx.save();
    ctx.strokeStyle = waveGrad;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var l = 0; l < pts.length - 1; l++) {
      var lmx = (pts[l].x + pts[l + 1].x) / 2;
      var lmy = (pts[l].y + pts[l + 1].y) / 2;
      ctx.quadraticCurveTo(pts[l].x, pts[l].y, lmx, lmy);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.restore();
  };

  MakanAudioVisualizer.prototype.destroy = function () {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  };

  MakanAudioVisualizer.THEMES = THEMES;
  MakanAudioVisualizer.STYLES = STYLES;
  window.MakanAudioVisualizer = MakanAudioVisualizer;
})();
