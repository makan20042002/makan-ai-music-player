/* MAKAN Music Player - Lyrics models place (Settings -> Lyrics).
 * Download / delete / test the speech models used by "Make lyrics". */
(function () {
  'use strict';
  var H = window.MakanLyricsAIHelpers;
  var AI = window.MakanLyricsAI;
  if (!H || !AI) return;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mb(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB'; }

  function mount(host, state) {
    if (!host || host.__mkModels) return;
    host.__mkModels = true;
    var ai = AI.getShared();
    var busyKey = null;
    var ctrl = null;

    var html = '<div class="mk-lm-title">Lyrics models</div>' +
      '<div class="mk-lm-note">Models are downloaded once from the internet, then work offline. Pick one, press Download, then Test it on the song that is playing.</div>';
    H.MODELS.forEach(function (m) {
      html += '<div class="mk-lm-row" data-key="' + m.key + '">' +
        '<div class="mk-lm-head"><b>' + esc(m.label) + '</b><span class="mk-lm-size">' + mb(H.expectedBytes(m, false)) + '</span><span class="mk-lm-badge" data-role="badge">Checking…</span></div>' +
        '<div class="mk-lm-bar" data-role="bar" hidden><div class="mk-lm-fill" data-role="fill"></div></div>' +
        '<div class="mk-lm-msg" data-role="msg"></div>' +
        '<div class="mk-lm-btns">' +
        '<button type="button" class="mk-btn mk-btn-secondary" data-act="dl">Download</button>' +
        '<button type="button" class="mk-btn mk-btn-secondary" data-act="test">Test on current song</button>' +
        '<button type="button" class="mk-btn mk-btn-secondary" data-act="rm">Delete</button>' +
        '</div><div class="mk-lm-result" data-role="result" hidden></div></div>';
    });
    host.innerHTML = html;

    function row(key) { return host.querySelector('.mk-lm-row[data-key="' + key + '"]'); }
    function q(r, role) { return r.querySelector('[data-role="' + role + '"]'); }

    function refresh(key) {
      return ai.modelStatus(key).then(function (st) {
        var r = row(key); if (!r) return;
        var b = q(r, 'badge');
        if (!st.available) { b.textContent = 'Cannot check'; b.className = 'mk-lm-badge'; }
        else if (st.ready) { b.textContent = 'Downloaded'; b.className = 'mk-lm-badge mk-lm-ok'; }
        else { b.textContent = 'Not downloaded'; b.className = 'mk-lm-badge'; }
        r.querySelector('[data-act="rm"]').disabled = !st.ready || !!busyKey;
      });
    }
    function refreshAll() { H.MODELS.forEach(function (m) { refresh(m.key); }); }

    function setBusy(key, on, label) {
      busyKey = on ? key : null;
      host.querySelectorAll('.mk-lm-row').forEach(function (r) {
        var mine = r.getAttribute('data-key') === key;
        r.querySelectorAll('button').forEach(function (b) {
          if (on && mine && b.getAttribute('data-act') === label) { b.textContent = 'Cancel'; b.disabled = false; }
          else b.disabled = on;
        });
        if (!on) {
          r.querySelector('[data-act="dl"]').textContent = 'Download';
          r.querySelector('[data-act="test"]').textContent = 'Test on current song';
        }
      });
      if (!on) refreshAll();
    }
    function msg(key, text, bad) { var m = q(row(key), 'msg'); m.textContent = text || ''; m.className = 'mk-lm-msg' + (bad ? ' mk-lm-bad' : ''); }
    function bar(key, f) {
      var r = row(key), b = q(r, 'bar');
      b.hidden = f == null; if (f != null) q(r, 'fill').style.width = Math.round(f * 100) + '%';
    }
    function errText(e) {
      var m = (e && e.message) ? e.message : 'Something went wrong.';
      if (/aborted\(|out of memory|memory/i.test(m)) m += ' (This model may be too big for this PC\'s memory or graphics card. Try the Turbo model.)';
      return m;
    }

    function download(key) {
      ctrl = new AbortController();
      setBusy(key, true, 'dl');
      msg(key, 'Starting download…'); bar(key, 0);
      ai.downloadModel(key, { signal: ctrl.signal, onProgress: function (f, m) {
        bar(key, f); msg(key, 'Downloading… ' + Math.round(f * 100) + '% (' + Math.round(m) + ' MB)');
      } }).then(function (r) {
        msg(key, 'Done. Ready to use' + (r && r.device ? ' (' + (r.device === 'gpu' ? 'graphics card' : 'CPU') + ').' : '.'));
      }).catch(function (e) {
        msg(key, e && e.code === 'aborted' ? 'Cancelled.' : 'Download failed: ' + errText(e), !(e && e.code === 'aborted'));
      }).then(function () { ctrl = null; bar(key, null); setBusy(key, false); });
    }

    function test(key) {
      var track = state && state.currentTrack;
      var r = row(key), res = q(r, 'result');
      if (!track) { res.hidden = false; res.textContent = 'Play or select a song first.'; return; }
      ctrl = new AbortController();
      setBusy(key, true, 'test');
      res.hidden = true; msg(key, 'Reading the song…');
      ai.testModel(track, key, { signal: ctrl.signal, lang: ai.getPrefs().lang || null, onProgress: function (p) {
        msg(key, p.stage === 'load' ? 'Loading the model (downloads it if needed)…' : p.stage === 'listen' ? 'Listening…' : 'Reading the song…');
      } }).then(function (o) {
        msg(key, '');
        res.hidden = false;
        res.textContent = o.text ? ('Heard (' + Math.round(o.clipSeconds) + ' s clip, ' + o.seconds.toFixed(1) + ' s on ' + (o.device === 'gpu' ? 'graphics card' : 'CPU') + '): ' + o.text)
          : 'No words were heard in this part of the song.';
      }).catch(function (e) {
        msg(key, e && e.code === 'aborted' ? 'Cancelled.' : 'Test failed: ' + errText(e), !(e && e.code === 'aborted'));
      }).then(function () { ctrl = null; setBusy(key, false); });
    }

    host.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button[data-act]');
      if (!b) return;
      var key = b.closest('.mk-lm-row').getAttribute('data-key');
      var act = b.getAttribute('data-act');
      if (busyKey === key && ctrl && (act === 'dl' || act === 'test')) { ctrl.abort(); return; }
      if (busyKey) return;
      if (act === 'dl') download(key);
      else if (act === 'test') test(key);
      else if (act === 'rm') {
        ai.removeModel(key).then(function (n) { msg(key, n ? 'Deleted.' : 'Nothing to delete.'); q(row(key), 'result').hidden = true; refresh(key); })
          .catch(function (e) { msg(key, 'Delete failed: ' + errText(e), true); });
      }
    });
    refreshAll();
  }

  window.MakanLyricsModels = { mount: mount };
})();
