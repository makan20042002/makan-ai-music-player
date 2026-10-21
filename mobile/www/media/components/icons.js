/*
 * media/components/icons.js - Unified SVG line icon family for MAKAN Music Player.
 * Strictly no decorative emojis in primary controls.
 * Clean, consistent stroke width (1.8-2px), 24x24 viewBox.
 */
(function () {
  'use strict';
  window.MakanIcons = {
    logo: function () {
      return '<svg class="mk-ico mk-logo-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
        '  <linearGradient id="mk-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">' +
        '    <stop offset="0%" stop-color="#00f0ff"/>' +
        '    <stop offset="50%" stop-color="#38bdf8"/>' +
        '    <stop offset="100%" stop-color="#818cf8"/>' +
        '  </linearGradient>' +
        '</defs>' +
        '<path d="M4 26V6L12 16L16 11L20 16L28 6V26H23V15.5L16 23.5L9 15.5V26H4Z" fill="url(#mk-logo-grad)"/>' +
        '</svg>';
    },
    search: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>' +
        '</svg>';
    },
    visualizer: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/>' +
        '</svg>';
    },
    gear: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
        '</svg>';
    },
    minimize: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<line x1="5" y1="12" x2="19" y2="12"/>' +
        '</svg>';
    },
    maximize: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<rect x="4" y="4" width="16" height="16" rx="2"/>' +
        '</svg>';
    },
    close: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>' +
        '</svg>';
    },
    // Sidebar nav icons
    library: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' +
        '</svg>';
    },
    playlists: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' +
        '</svg>';
    },
    queue: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="11" y2="18"/><circle cx="18" cy="15" r="3"/><path d="M21 15V9"/>' +
        '</svg>';
    },
    recent: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>' +
        '</svg>';
    },
    artists: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' +
        '</svg>';
    },
    albums: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>' +
        '</svg>';
    },
    genres: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>' +
        '</svg>';
    },
    folders: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' +
        '</svg>';
    },
    // Player controls
    heart: function (filled) {
      if (filled) {
        return '<svg class="mk-ico mk-heart filled" viewBox="0 0 24 24" fill="#00e5ff" stroke="#00e5ff" stroke-width="1.8">' +
          '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
          '</svg>';
      }
      return '<svg class="mk-ico mk-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
        '</svg>';
    },
    more: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>' +
        '</svg>';
    },
    shuffle: function (mode) {
      // mode can be boolean or 'off' | 'tracks' | 'albums'
      var isAlbums = mode === 'albums';
      var active = (mode === true || mode === 'tracks' || mode === 'albums');
      var cls = active ? (isAlbums ? 'mk-ico active mk-ico-albums' : 'mk-ico active') : 'mk-ico';
      var albumBadge = isAlbums ? '<circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="#090e1a"/>' : '';
      return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>' +
        albumBadge +
        '</svg>';
    },
    prev: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="currentColor">' +
        '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
        '</svg>';
    },
    play: function () {
      return '<svg class="mk-ico play-icon" viewBox="0 0 24 24" fill="currentColor">' +
        '<polygon points="6 3 20 12 6 21 6 3"/>' +
        '</svg>';
    },
    pause: function () {
      return '<svg class="mk-ico pause-icon" viewBox="0 0 24 24" fill="currentColor">' +
        '<rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/>' +
        '</svg>';
    },
    next: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="currentColor">' +
        '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
        '</svg>';
    },
    repeat: function (mode) {
      // mode: 'off' | 'all' | 'one'
      var cls = (mode === 'all' || mode === 'one') ? 'mk-ico active' : 'mk-ico';
      var badge = mode === 'one' ? '<text x="12" y="14" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle">1</text>' : '';
      return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' +
        badge +
        '</svg>';
    },
    volume: function (level) {
      // level: 0 (mute), 1 (low), 2 (high)
      if (level === 0) {
        return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>' +
          '</svg>';
      } else if (level === 1) {
        return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
          '</svg>';
      }
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
        '</svg>';
    },
    equalizer: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/>' +
        '</svg>';
    },
    lyricsTheatre: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M7 10h10M7 14h6"/>' +
        '</svg>';
    },
    playingBars: function () {
      return '<span class="mk-playing-bars-anim" aria-hidden="true">' +
        '<span class="mk-bar mk-bar-1"></span>' +
        '<span class="mk-bar mk-bar-2"></span>' +
        '<span class="mk-bar mk-bar-3"></span>' +
        '</span>';
    },
    textStyle: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="4 20 12 4 20 20"/><line x1="7" y1="14" x2="17" y2="14"/>' +
        '</svg>';
    },
    palette: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z"/>' +
        '</svg>';
    },
    chip: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>' +
        '</svg>';
    },
    chevronDown: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    },
    sparkle: function () {
      return '<svg class="mk-ico mk-sparkle" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M12 2L14.2 8.8L21 11L14.2 13.2L12 20L9.8 13.2L3 11L9.8 8.8L12 2Z"/>' +
        '</svg>';
    },
    plus: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' +
        '</svg>';
    },
    minus: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<line x1="5" y1="12" x2="19" y2="12"/>' +
        '</svg>';
    },
    pin: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-2-7V4H7v6l-2 7z"/>' +
        '</svg>';
    },
    expand: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>' +
        '</svg>';
    },
    sun: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>' +
        '<line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/></svg>';
    },
    moon: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    },
    compress: function () {
      return '<svg class="mk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>' +
        '</svg>';
    }
  };
})();
