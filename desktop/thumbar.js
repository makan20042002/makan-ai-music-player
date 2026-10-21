'use strict';
/*
 * desktop/thumbar.js - Previous / Play-Pause / Next buttons on the Windows taskbar thumbnail.
 * Small white 16x16 icons are built into this file (no image files). Clicks are sent to the player as the
 * same media-key messages the keyboard media keys use.
 */
const ICONS = {
  play: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAL0lEQVR42mNgGFTgPxBQbABFhvxHAxQbQLJB/wkAig0gaBDNDaB/IA5MQmIYcgAAdHX3CbQw2NoAAAAASUVORK5CYII=',
  pause: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR42mNgGFTgPxogJD5qwKgBw9WAAQEAJZd+kFOrxjsAAAAASUVORK5CYII=',
  prev: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPklEQVR42mNgGDTgPxQQq5ZsA3CqI8aA/0iAJAP+YwFEG/AfByBowH8CgPYGUOwFqgUiVaKRagkJb1IeMAAAgEwm6KJGu8EAAAAASUVORK5CYII=',
  next: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVR42mNgGDTgPxAQqw6rWpwSpBpAyBCiDMBnEEkGYFNIsgHoGuhvwMAE4sAlJIqS8oABAJt3JuhMfYIhAAAAAElFTkSuQmCC'
};

function createThumbar(deps) {
  const win = deps.win;
  const nativeImage = deps.nativeImage;
  const send = deps.send;
  const img = {};
  Object.keys(ICONS).forEach((k) => { img[k] = nativeImage.createFromDataURL('data:image/png;base64,' + ICONS[k]); });

  function buttons(isPlaying) {
    return [
      { tooltip: 'Previous', icon: img.prev, click: () => send('prev') },
      { tooltip: isPlaying ? 'Pause' : 'Play', icon: isPlaying ? img.pause : img.play, click: () => send('play-pause') },
      { tooltip: 'Next', icon: img.next, click: () => send('next') }
    ];
  }

  let last = null;
  function update(isPlaying) {
    const playing = !!isPlaying;
    if (last === playing) return false;
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed()) || typeof win.setThumbarButtons !== 'function') return false;
    try { win.setThumbarButtons(buttons(playing)); last = playing; return true; } catch (e) { return false; }
  }
  /* Windows forgets the buttons when the window is shown again after being hidden: set them once more */
  function refresh() { last = null; }
  return { update, refresh, buttons };
}

module.exports = { createThumbar, ICONS };
