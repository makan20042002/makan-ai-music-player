/* MAKAN Music Player (Android) - phone layout.
 * Adds a bottom bar (Songs / Playing / Lyrics / Menu) and shows one screen at a time.
 * Only loaded by the Android app. The Windows app does not use this file. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('mk-mobile');

  var app, nav, scrim;
  var VIEWS = ['library', 'player', 'lyrics'];

  function icon(name) {
    var I = window.MakanIcons;
    return I && I[name] ? I[name]() : '';
  }

  function setView(v) {
    if (VIEWS.indexOf(v) < 0 || !app) return;
    app.setAttribute('data-mview', v);
    closeSheet();
    var btns = nav.querySelectorAll('[data-mv]');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-mv') === v);
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
  }

  /* two extra rows at the end of the menu: look for new songs, import lyrics files */
  function ensureExtras() {
    var list = app && app.querySelector('.mk-nav-list');
    if (!list || list.querySelector('#mk-mextra')) return;
    var d = document.createElement('div');
    d.id = 'mk-mextra';
    d.innerHTML =
      '<div class="mk-mx-head">PHONE</div>' +
      '<button type="button" class="mk-mx" data-mx="scan">Look for new songs</button>' +
      '<button type="button" class="mk-mx" data-mx="lyrics">Import lyrics files (.lrc, .txt)</button>' +
      '<button type="button" class="mk-mx" data-mx="report">Problem report (copy it to the helper)</button>' +
      '<input type="file" id="mk-mx-file" accept=".lrc,.txt,text/plain" multiple hidden>';
    list.appendChild(d);
  }
  function toast(msg, kind) {
    var a = window.makanApp;
    if (a && a.showToast) a.showToast(msg, kind || 'info');
  }
  function extrasClick(e) {
    var b = e.target.closest('[data-mx]');
    if (!b) return;
    var what = b.getAttribute('data-mx');
    if (what === 'scan') {
      closeSheet();
      if (window.makanApp && window.makanApp.scanPaths) window.makanApp.scanPaths(['__phone__']);
    } else if (what === 'report') {
      closeSheet();
      if (window.MakanPhoneReport) window.MakanPhoneReport.show();
    } else if (what === 'lyrics') {
      var f = document.getElementById('mk-mx-file');
      if (f) f.click();
    }
  }
  function extrasPicked(e) {
    var f = e.target;
    if (!f || f.id !== 'mk-mx-file' || !f.files || !f.files.length) return;
    var P = window.MakanPhone;
    if (!P || !P.importLyricsFiles) { toast('Lyrics import is not ready yet.', 'error'); return; }
    var list = Array.prototype.slice.call(f.files);
    f.value = '';
    closeSheet();
    P.importLyricsFiles(list).then(function (r) {
      toast(r.done + ' lyrics imported' + (r.skipped ? ', ' + r.skipped + ' did not match a song name' : '') + '.', r.done ? 'info' : 'error');
    }).catch(function () { toast('Could not import the lyrics.', 'error'); });
  }

  function openSheet() {
    ensureExtras();
    setView('library');
    app.classList.add('mk-sheet');
    var b = nav.querySelector('[data-mv="menu"]');
    if (b) b.classList.add('on');
    var l = nav.querySelector('[data-mv="library"]');
    if (l) l.classList.remove('on');
  }

  function closeSheet() {
    if (!app || !app.classList.contains('mk-sheet')) return;
    app.classList.remove('mk-sheet');
    var b = nav.querySelector('[data-mv="menu"]');
    if (b) b.classList.remove('on');
    var cur = app.getAttribute('data-mview');
    var c = nav.querySelector('[data-mv="' + cur + '"]');
    if (c) c.classList.add('on');
  }

  /* for the Android back button: true when it did something */
  function back() {
    if (!app) return false;
    var st = window.makanApp && window.makanApp.state;
    if (st && st.drawers) {
      for (var k in st.drawers) { if (st.drawers[k]) { st.closeDrawers(); return true; } }
    }
    if (app.classList.contains('mk-sheet')) { closeSheet(); return true; }
    if (app.getAttribute('data-mview') !== 'library') { setView('library'); return true; }
    return false;
  }

  function build() {
    app = document.getElementById('mk-app-root');
    if (!app) return false;
    nav = document.createElement('nav');
    nav.id = 'mk-mnav';
    nav.innerHTML =
      '<button type="button" data-mv="library"><span class="mk-mn-ico">' + icon('library') + '</span><span>Songs</span></button>' +
      '<button type="button" data-mv="player"><span class="mk-mn-ico">' + icon('playingBars') + '</span><span>Playing</span></button>' +
      '<button type="button" data-mv="lyrics"><span class="mk-mn-ico">' + icon('lyricsTheatre') + '</span><span>Lyrics</span></button>' +
      '<button type="button" data-mv="menu"><span class="mk-mn-ico">' + icon('more') + '</span><span>Menu</span></button>';
    app.appendChild(nav);
    scrim = document.createElement('div');
    scrim.id = 'mk-msheet-scrim';
    // the scrim must sit inside the player panel: the menu lives there, and anything outside would cover it
    (app.querySelector('.mk-full-player') || app).appendChild(scrim);

    nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mv]');
      if (!b) return;
      var v = b.getAttribute('data-mv');
      if (v === 'menu') { if (app.classList.contains('mk-sheet')) closeSheet(); else openSheet(); }
      else setView(v);
    });
    scrim.addEventListener('click', closeSheet);
    app.addEventListener('click', extrasClick);
    app.addEventListener('change', extrasPicked);
    new MutationObserver(function () { if (app.classList.contains('mk-sheet')) ensureExtras(); }).observe(app, { childList: true, subtree: true });

    // choosing something in the menu closes it
    app.addEventListener('click', function (e) {
      if (app.classList.contains('mk-sheet') && e.target.closest('.mk-nav-list') && !e.target.closest('#mk-mextra, .mk-nav-more-btn')) {
        setTimeout(function () { closeSheet(); }, 0);
      }
      // the small player bar opens the full player
      if (app.getAttribute('data-mview') === 'library' && e.target.closest('.mk-dock-left') && !e.target.closest('button')) setView('player');
    });

    // one tap on a song plays it (the Windows app uses a double click)
    app.addEventListener('click', function (e) {
      var row = e.target.closest('.mk-vtable-row:not(.mk-vtable-header-row)');
      if (!row || e.target.closest('.mk-vth')) return;
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    });

    setView('library');
    return true;
  }

  /* the song list draws itself when told the library changed; the first load needs one nudge */
  function refreshList() {
    var st = window.makanApp && window.makanApp.state;
    if (st && st.tracks && st.tracks.length) st.emit('libraryUpdated');
  }

  /* words that only make sense on a PC */
  function phoneText() {
    var d = document.querySelector('.mk-empty-desc');
    if (d && d.getAttribute('data-ph') !== '1') { d.textContent = 'Allow access to the music on this phone and the player will list all your songs.'; d.setAttribute('data-ph', '1'); }
    phoneSettings();
    var b = document.querySelector('#mk-empty-add-folder-btn span');
    if (b && b.textContent !== 'Find music on this phone') b.textContent = 'Find music on this phone';
  }
  /* Settings on a phone: wording about the PC, Windows and Ollama is changed here; the PC-only parts are hidden by mobile.css */
  function say(el, text) { if (el && el.textContent !== text) el.textContent = text; }
  function phoneSettings() {
    var d = document.getElementById('mk-settings-drawer');
    if (!d) return;
    var mode = d.querySelector('#mk-set-tr-mode');
    if (mode) {
      ['ollama', 'cloud'].forEach(function (v) { var o = mode.querySelector('option[value="' + v + '"]'); if (o) o.parentNode.removeChild(o); });
      say(mode.querySelector('option[value="auto"]'), 'Automatic (free web translators, then your Gemini key)');
    }
    var notes = d.querySelectorAll('.mk-tr-card .mk-lm-note');
    say(notes[0], 'Translation uses free web translators (no key needed; they may be limited or stop one day). For better translations add your own Gemini key.');
    say(notes[1], 'Your key stays in memory and is gone when you close the app. Your lyrics text is sent to the service you choose.');
    say(d.querySelector('#mk-set-app-theme option[value="auto"]'), 'Automatic (follow the phone)');
    var rs = d.querySelector('#mk-setting-rescan-btn');
    if (rs) { say(rs.querySelector('strong'), 'Look for new songs'); say(rs.querySelector('span'), 'Check this phone for songs that were added or removed'); }
    say(d.querySelector('#mk-set-pane-library h4'), 'Library');
  }
  /* a song without a cover picture: show the same plain picture the player uses before a song is chosen */
  var PLACE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='%230b1220'><rect fill-opacity='0' width='44' height='44'/><circle cx='22' cy='22' r='12' fill='%233b82f6' fill-opacity='.22'/></svg>";
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && /\/api\/artwork\?/.test(t.getAttribute('src') || '')) t.setAttribute('src', PLACE);
  }, true);

  /* after every library load the song list must be told to draw itself (the Windows app does this another way) */
  function patchLoad() {
    var a = window.makanApp;
    if (!a || !a.loadLibrary) return false;
    if (a.__mkPatched) return true;
    var orig = a.loadLibrary;
    a.loadLibrary = function (f, cb, keep) {
      return orig.call(a, f, function (tracks) {
        try { a.state.emit('libraryUpdated'); } catch (e) { /* ignore */ }
        if (typeof cb === 'function') cb(tracks);
      }, keep);
    };
    a.__mkPatched = true;
    return true;
  }

  function start() {
    var pt = 0, pi = setInterval(function () { if (patchLoad() || ++pt > 60) clearInterval(pi); }, 50);
    setTimeout(refreshList, 500);
    setTimeout(refreshList, 1500);
    setInterval(phoneText, 1000);
    if (build()) return;
    var tries = 0;
    var t = setInterval(function () { if (build() || ++tries > 40) clearInterval(t); }, 100);
  }

  window.MakanMobile = { refreshList: refreshList, setView: setView, openSheet: openSheet, closeSheet: closeSheet, back: back };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  else setTimeout(start, 0);
})();
