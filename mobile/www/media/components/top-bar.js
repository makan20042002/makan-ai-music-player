/*
 * media/components/top-bar.js - Top bar component for MAKAN Music Player.
 * Features:
 * - MAKAN MUSIC brand wordmark with vibrant glowing logo
 * - Global search pill with 'Ctrl + K' shortcut badge
 * - Visualizer status/theme toggle icon
 * - Settings drawer launcher
 * - Windows titlebar controls (Minimize, Maximize, Close)
 */
(function () {
  'use strict';

  function MakanTopBar(container, state, engine) {
    this.container = container;
    this.state = state;
    this.engine = engine;
    this.el = null;
    this.searchInput = null;

    this.render();
    this.bindEvents();
  }

  MakanTopBar.prototype.render = function () {
    var icons = window.MakanIcons;
    var html = '' +
      '<header class="mk-topbar" id="mk-topbar">' +
      '  <div class="mk-topbar-left">' +
      '    <div class="mk-brand" aria-label="MAKAN AI MUSIC">' +
      '      <img class="mk-brand-logo" id="mk-brand-logo" src="media/assets/logo.png" alt="Makan AI Music Player" draggable="false">' +
      '      <span class="mk-brand-text mk-sr-only"><strong class="mk-brand-bold">MAKAN</strong> <span class="mk-brand-music">AI MUSIC</span></span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="mk-topbar-center">' +
      '    <div class="mk-global-search">' +
      '      <span class="mk-search-ico">' + icons.search() + '</span>' +
      '      <input type="text" class="mk-search-input" id="mk-global-search-input" placeholder="Search songs, artists, albums..." title="Tip: words inside lyrics are found too. Use artist:name, album:name, lyrics:word, -word to exclude" spellcheck="false" autocomplete="off">' +
      '      <kbd class="mk-kbd">Ctrl + K</kbd>' +
      '    </div>' +
      '  </div>' +
      '  <div class="mk-topbar-right">' +
      '    <button type="button" class="mk-top-btn mk-theme-btn" id="mk-top-theme-btn" title="Switch dark / light theme"></button>' +
      '    <button type="button" class="mk-top-btn mk-vis-btn" id="mk-top-vis-btn" title="Toggle Visualizer Theme">' +
      '      ' + icons.visualizer() +
      '    </button>' +
      '    <button type="button" class="mk-top-btn mk-settings-btn" id="mk-top-settings-btn" title="Settings">' +
      '      ' + icons.gear() +
      '    </button>' +
      '    <div class="mk-win-controls">' +
      '      <button type="button" class="mk-win-btn mk-win-min" id="mk-win-min" title="Minimize">' +
      '        ' + icons.minimize() +
      '      </button>' +
      '      <button type="button" class="mk-win-btn mk-win-max" id="mk-win-max" title="Maximize">' +
      '        ' + icons.maximize() +
      '      </button>' +
      '      <button type="button" class="mk-win-btn mk-win-close" id="mk-win-close" title="Close">' +
      '        ' + icons.close() +
      '      </button>' +
      '    </div>' +
      '  </div>' +
      '</header>';

    this.container.innerHTML = html;
    this.el = this.container.firstElementChild;
    this.searchInput = this.el.querySelector('#mk-global-search-input');
  };

  MakanTopBar.prototype.bindEvents = function () {
    var self = this;

    // Search input
    if (this.searchInput) {
      var searchDebounceTimer = null;
      this.searchInput.addEventListener('input', function (e) {
        clearTimeout(searchDebounceTimer);
        var q = e.target.value.trim();
        searchDebounceTimer = setTimeout(function () {
          self.state.globalSearchQuery = q;
          self.state.emit('globalSearch', { query: q });
        }, 80);
      });

      this.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          clearTimeout(searchDebounceTimer);
          self.searchInput.value = '';
          self.state.globalSearchQuery = '';
          self.state.emit('globalSearch', { query: '' });
          self.searchInput.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          self.state.emit('searchPlayResult');
        }
      });
    }

    // Dark / light theme button (Platinum Blue light theme)
    var themeBtn = this.el.querySelector('#mk-top-theme-btn');
    if (themeBtn && window.MakanTheme) {
      var paintBtn = function () {
        var light = window.MakanTheme.current() === 'light';
        themeBtn.innerHTML = light ? window.MakanIcons.moon() : window.MakanIcons.sun();
        themeBtn.title = light ? 'Switch to dark theme' : 'Switch to light theme (Platinum Blue)';
      };
      paintBtn();
      window.MakanTheme.onChange(paintBtn);
      themeBtn.addEventListener('click', function () {
        window.MakanTheme.toggle();
        var m = window.MakanTheme.getMode();
        self.state.appTheme = m;
        if (window.MakanDesktop && window.MakanDesktop.setSettings) window.MakanDesktop.setSettings({ appTheme: m });
        var sel = document.querySelector('#mk-set-app-theme');
        if (sel) sel.value = m;
      });
    }

    // Visualizer Theme button
    var visBtn = this.el.querySelector('#mk-top-vis-btn');
    if (visBtn) {
      visBtn.addEventListener('click', function () {
        var themes = ['cyan', 'aurora', 'rainbow', 'custom', 'sunset', 'ocean', 'gold', 'violet', 'candy'];
        var curIdx = themes.indexOf(self.state.visualizerTheme);
        var nextTheme = themes[(curIdx + 1) % themes.length];
        self.state.setVisualizerTheme(nextTheme);
      });
    }

    // Settings button
    var settingsBtn = this.el.querySelector('#mk-top-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        self.state.toggleDrawer('settings');
      });
    }


    // Window controls
    var minBtn = this.el.querySelector('#mk-win-min');
    var maxBtn = this.el.querySelector('#mk-win-max');
    var closeBtn = this.el.querySelector('#mk-win-close');

    if (minBtn) {
      minBtn.addEventListener('click', function () {
        if (window.MakanDesktop && window.MakanDesktop.minimize) {
          window.MakanDesktop.minimize();
        }
      });
    }

    if (maxBtn) {
      maxBtn.addEventListener('click', function () {
        if (window.MakanDesktop && window.MakanDesktop.maximize) {
          window.MakanDesktop.maximize();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (window.MakanDesktop && window.MakanDesktop.close) {
          window.MakanDesktop.close();
        } else {
          window.close();
        }
      });
    }

    // Global hotkey Ctrl+K for search
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (self.searchInput) {
          self.searchInput.focus();
          self.searchInput.select();
        }
      }
    });
  };

  window.MakanTopBar = MakanTopBar;
})();
