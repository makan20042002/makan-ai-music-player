/*
 * media/components/library-sidebar.js - Left library navigation & track browser component.
 * Features:
 * - Width ~270px
 * - Navigation items: Library, Playlists, Queue, Recently Added, Artists, Albums, Genres, Folders
 * - Real counts badges updated dynamically from SQLite database
 * - In-library search field
 * - Hosts virtualized MakanTrackTable
 */
(function () {
  'use strict';

  function MakanLibrarySidebar(container, state, engine, playbackController) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.controller = playbackController || null;
    this.el = null;
    this.trackTable = null;

    this.render();
    this.bindEvents();
  }

  MakanLibrarySidebar.prototype.render = function () {
    var icons = window.MakanIcons;
    var state = this.state;

    var totalTracks = state.tracks ? state.tracks.length : (state.totalTracksDisplay || 0);
    var totalTracksStr = totalTracks + ' tracks';

    var html = '' +
      '<aside class="mk-library-panel" id="mk-library-panel">' +
      '  <!-- Navigation List -->' +
      '  <nav class="mk-nav-list" role="navigation">' +
      '    <a class="mk-nav-item mk-nav-active" data-nav="library" href="#/library">' +
      '      <span class="mk-nav-icon">' + icons.library() + '</span>' +
      '      <span class="mk-nav-label">Library</span>' +
      '      <span class="mk-nav-count" id="mk-lib-count">' + totalTracksStr + '</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="playlists" href="#/playlists">' +
      '      <span class="mk-nav-icon">' + icons.playlists() + '</span>' +
      '      <span class="mk-nav-label">Playlists</span>' +
      '      <span class="mk-nav-count" id="mk-playlist-count">' + state.playlistsCount + '</span>' +
      '    </a>' +
      '    <div class="mk-nav-pl" id="mk-nav-pl" hidden></div>' +
      '    <a class="mk-nav-item" data-nav="queue" href="#/queue">' +
      '      <span class="mk-nav-icon">' + icons.queue() + '</span>' +
      '      <span class="mk-nav-label">Queue</span>' +
      '      <span class="mk-nav-count" id="mk-queue-count">' + state.queueCount + '</span>' +
      '    </a>' +
      '    <button type="button" class="mk-nav-more-btn" id="mk-nav-more-btn" aria-expanded="false" title="Show or hide Recently Added, Artists, Albums, Genres, Folders">' +
      '      <span class="mk-nav-more-label">More</span><span class="mk-nav-more-chev">' + icons.chevronDown() + '</span>' +
      '    </button>' +
      '    <div class="mk-nav-more" id="mk-nav-more" hidden>' +
      '    <a class="mk-nav-item" data-nav="recent" href="#/recent">' +
      '      <span class="mk-nav-icon">' + icons.recent() + '</span>' +
      '      <span class="mk-nav-label">Recently Added</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="artists" href="#/artists">' +
      '      <span class="mk-nav-icon">' + icons.artists() + '</span>' +
      '      <span class="mk-nav-label">Artists</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="albums" href="#/albums">' +
      '      <span class="mk-nav-icon">' + icons.albums() + '</span>' +
      '      <span class="mk-nav-label">Albums</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="genres" href="#/genres">' +
      '      <span class="mk-nav-icon">' + icons.genres() + '</span>' +
      '      <span class="mk-nav-label">Genres</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="stats" href="#/stats">' +
      '      <span class="mk-nav-icon">' + icons.equalizer() + '</span>' +
      '      <span class="mk-nav-label">Listening Stats</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="study" href="#/study">' +
      '      <span class="mk-nav-icon">' + icons.lyricsTheatre() + '</span>' +
      '      <span class="mk-nav-label">Study Words</span>' +
      '    </a>' +
      '    <a class="mk-nav-item" data-nav="folders" href="#/folders">' +
      '      <span class="mk-nav-icon">' + icons.folders() + '</span>' +
      '      <span class="mk-nav-label">Folders</span>' +
      '    </a>' +
      '    </div>' +
      '    <div class="mk-nav-studio-label">STUDIO</div>' +
      '    <div class="mk-nav-studio-grid">' +
      '    <button type="button" class="mk-nav-action" data-action="ai-lyrics" title="Make lyrics for the current song with AI"><span class="mk-nav-icon">' + icons.sparkle() + '</span><span class="mk-nav-label">AI Lyrics</span></button>' +
      '    <button type="button" class="mk-nav-action" data-action="ai-models" title="Download and manage the AI speech models"><span class="mk-nav-icon">' + icons.chip() + '</span><span class="mk-nav-label">AI Models</span></button>' +
      '    <button type="button" class="mk-nav-action" data-action="equalizer" title="Equalizer"><span class="mk-nav-icon">' + icons.equalizer() + '</span><span class="mk-nav-label">Equalizer</span></button>' +
      '    <button type="button" class="mk-nav-action" data-action="effects" title="Lyric effects, colors and backgrounds"><span class="mk-nav-icon">' + icons.visualizer() + '</span><span class="mk-nav-label">Visual Effects</span></button>' +
      '    <button type="button" class="mk-nav-action" data-action="themes" title="Dark / light theme"><span class="mk-nav-icon">' + icons.palette() + '</span><span class="mk-nav-label">Themes</span></button>' +
      '    <button type="button" class="mk-nav-action" data-action="settings" title="Settings"><span class="mk-nav-icon">' + icons.gear() + '</span><span class="mk-nav-label">Settings</span></button>' +
      '    </div>' +
      '  </nav>' +
      '' +
      '  <!-- Library Filter Search -->' +
      '  <div class="mk-lib-search">' +
      '    <span class="mk-lib-search-ico">' + icons.search() + '</span>' +
      '    <input type="text" class="mk-lib-search-input" id="mk-lib-search-input" placeholder="Search in library..." spellcheck="false" autocomplete="off">' +
      '  </div>' +
      '' +
      '  <!-- Track Table Container -->' +
      '  <div class="mk-table-mount" id="mk-table-mount"></div>' +
      '</aside>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;

    var tableMount = this.el.querySelector('#mk-table-mount');
    this.trackTable = new window.MakanTrackTable(tableMount, this.state, this.engine, this.controller);
  };

  /* the first playlists, shown under the Playlists row */
  MakanLibrarySidebar.prototype.renderPlaylists = function (list) {
    var box = this.el && this.el.querySelector('#mk-nav-pl');
    if (!box) return;
    list = list || [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    var esc = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var html = '';
    list.slice(0, 6).forEach(function (p) {
      html += '<button type="button" class="mk-nav-pl-item" data-pl-id="' + esc(p.id) + '" data-pl-name="' + esc(p.name) + '" title="Show this playlist">' + esc(p.name) + '</button>';
    });
    if (list.length > 6) html += '<button type="button" class="mk-nav-pl-item mk-nav-pl-more" data-pl-all="1" title="Open the playlists window">All ' + list.length + ' playlists...</button>';
    box.innerHTML = html;
    box.hidden = false;
  };

  MakanLibrarySidebar.prototype.loadPlaylistsMenu = function () {
    var self = this;
    var api = window.MakanDesktop;
    if (!(api && api.getPlaylists)) return;
    api.getPlaylists().then(function (pls) { self.renderPlaylists(pls || []); }).catch(function () {});
  };

  MakanLibrarySidebar.prototype.bindPlaylistsMenu = function () {
    var self = this;
    var box = this.el.querySelector('#mk-nav-pl');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.mk-nav-pl-item');
      if (!b) return;
      if (b.getAttribute('data-pl-all')) { self.state.toggleDrawer('playlists'); return; }
      self.state.emit('openPlaylist', { id: b.getAttribute('data-pl-id'), name: b.getAttribute('data-pl-name') });
    });
    var timer = null;
    this.state.on('playlistsChanged', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { self.loadPlaylistsMenu(); }, 150);
    });
    this.loadPlaylistsMenu();
  };

  MakanLibrarySidebar.prototype.updateCounts = function () {
    var totalTracks = this.state.tracks ? this.state.tracks.length : (this.state.totalTracksDisplay || 0);
    var libCountEl = this.el.querySelector('#mk-lib-count');
    if (libCountEl) libCountEl.textContent = totalTracks + ' tracks';

    var plCountEl = this.el.querySelector('#mk-playlist-count');
    if (plCountEl) plCountEl.textContent = this.state.playlistsCount || 0;

    var queueCountEl = this.el.querySelector('#mk-queue-count');
    if (queueCountEl) queueCountEl.textContent = this.state.queueCount || 0;
  };

  MakanLibrarySidebar.prototype.bindEvents = function () {
    var self = this;

    // Nav items click
    var navItems = this.el.querySelectorAll('.mk-nav-item');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener('click', function (e) {
        e.preventDefault();
        for (var j = 0; j < navItems.length; j++) {
          navItems[j].classList.remove('mk-nav-active');
        }
        this.classList.add('mk-nav-active');
        var navKey = this.getAttribute('data-nav');
        self.state.activeNavItem = navKey;
        if (navKey === 'queue') {
          self.state.toggleDrawer('queue');
        } else if (navKey === 'folders') {
          self.state.toggleDrawer('folders');
        } else if (navKey === 'playlists') {
          self.state.toggleDrawer('playlists');
        } else {
          self.state.emit('navChanged', { navItem: navKey });
        }
      });
    }

    this.bindPlaylistsMenu();

    // "More" group (remembered between launches)
    var moreBtn = this.el.querySelector('#mk-nav-more-btn');
    var moreBox = this.el.querySelector('#mk-nav-more');
    function setMore(open) {
      if (!moreBtn || !moreBox) return;
      moreBox.hidden = !open;
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      moreBtn.classList.toggle('mk-open', open);
      try { window.localStorage.setItem('makanNavMore', open ? '1' : '0'); } catch (e) { /* storage may be blocked */ }
    }
    if (moreBtn) {
      var wasOpen = false;
      try { wasOpen = window.localStorage.getItem('makanNavMore') === '1'; } catch (e) { /* ignore */ }
      setMore(wasOpen);
      moreBtn.addEventListener('click', function () { setMore(moreBox.hidden); });
    }

    // Studio shortcuts: each one opens something that already exists
    function openSettings(tab) {
      if (!self.state.drawers.settings) self.state.toggleDrawer('settings');
      if (!tab) return;
      setTimeout(function () {
        var t = document.querySelector('[data-set-tab="' + tab + '"]');
        if (t) t.click();
      }, 60);
    }
    var actions = this.el.querySelectorAll('.mk-nav-action');
    for (var a = 0; a < actions.length; a++) {
      actions[a].addEventListener('click', function () {
        var act = this.getAttribute('data-action');
        if (act === 'ai-lyrics') {
          var mk = document.getElementById('mk-ai-transcribe-btn');
          if (mk) mk.click();
        } else if (act === 'ai-models') openSettings('lyrics');
        else if (act === 'equalizer') { if (!self.state.drawers.equalizer) self.state.toggleDrawer('equalizer'); }
        else if (act === 'effects') { if (!self.state.drawers.lyricsStyle) self.state.toggleDrawer('lyricsStyle'); }
        else if (act === 'themes') openSettings('appearance');
        else if (act === 'settings') openSettings('');
      });
    }

    // Library search input
    var searchInput = this.el.querySelector('#mk-lib-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        var query = e.target.value.trim();
        if (self.trackTable) {
          self.trackTable.setFilter(query);
        }
      });
    }

    this.state.on('countsUpdated', function () {
      self.updateCounts();
    });

    this.state.on('queueChanged', function () {
      self.updateCounts();
    });

    this.state.on('libraryUpdated', function () {
      self.updateCounts();
      if (self.trackTable) self.trackTable.refresh();
    });
  };

  window.MakanLibrarySidebar = MakanLibrarySidebar;
})();
