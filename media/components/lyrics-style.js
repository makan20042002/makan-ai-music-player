/* MAKAN Music Player - lyrics look: fonts, colour swatches and moving colour patterns.
 * Only fonts that ship with Windows are listed (nothing is downloaded); a font that is not installed
 * falls back to the next one in its stack. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (target) target.MakanLyricsStyle = mod;
})(this, function () {
  'use strict';

  // The first five css values are the ones older versions saved, so saved settings still match.
  var FONTS = [
    { group: 'en', label: 'Segoe UI', css: 'Segoe UI, Tahoma, sans-serif' },
    { group: 'en', label: 'Bahnschrift (modern)', css: "Bahnschrift, 'Segoe UI', sans-serif" },
    { group: 'en', label: 'Calibri', css: "Calibri, 'Segoe UI', sans-serif" },
    { group: 'en', label: 'Candara', css: "Candara, 'Segoe UI', sans-serif" },
    { group: 'en', label: 'Corbel', css: "Corbel, 'Segoe UI', sans-serif" },
    { group: 'en', label: 'Franklin Gothic', css: "'Franklin Gothic Medium', Arial, sans-serif" },
    { group: 'en', label: 'Trebuchet MS', css: "'Trebuchet MS', Arial, sans-serif" },
    { group: 'en', label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
    { group: 'en', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { group: 'en', label: 'Georgia (serif)', css: 'Georgia, serif' },
    { group: 'en', label: 'Constantia (serif)', css: "Constantia, Georgia, serif" },
    { group: 'en', label: 'Palatino (serif)', css: "'Palatino Linotype', Georgia, serif" },
    { group: 'en', label: 'Segoe Script (handwriting)', css: "'Segoe Script', 'Segoe UI', cursive" },
    { group: 'en', label: 'System default', css: 'system-ui, -apple-system, sans-serif' },
    { group: 'fa', label: 'Vazirmatn', css: 'Vazirmatn, Segoe UI, sans-serif' },
    { group: 'fa', label: 'Tahoma', css: 'Tahoma, sans-serif' },
    { group: 'fa', label: 'Segoe UI', css: "'Segoe UI', Tahoma, sans-serif" },
    { group: 'fa', label: 'Arial', css: 'Arial, Tahoma, sans-serif' },
    { group: 'fa', label: 'B Nazanin', css: "'B Nazanin', 'Sakkal Majalla', 'Times New Roman', serif" },
    { group: 'fa', label: 'Sakkal Majalla', css: "'Sakkal Majalla', 'Traditional Arabic', 'Times New Roman', serif" },
    { group: 'fa', label: 'Times New Roman', css: "'Times New Roman', 'Traditional Arabic', serif" }
  ];

  var DEFAULT_TRANSLATION_FONT = 'Vazirmatn, Segoe UI, sans-serif';

  // Colour styles for the active line. 'solid' uses the colour picker; the others move.
  var COLOR_STYLES = [
    { id: 'solid', label: 'Solid colour', stops: null },
    { id: 'rainbow', label: 'Rainbow', stops: ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff2d92'] },
    { id: 'sunset', label: 'Sunset', stops: ['#ff512f', '#f09819', '#ffd200', '#ff6a88', '#c471ed'] },
    { id: 'ocean', label: 'Ocean', stops: ['#00c6ff', '#0072ff', '#00e5c3', '#4facfe'] },
    { id: 'neon', label: 'Neon', stops: ['#00f0ff', '#c084fc', '#ec4899', '#a3ff12'] },
    { id: 'fire', label: 'Fire', stops: ['#ff0844', '#ff5e00', '#ffb199', '#ffd200'] },
    { id: 'aurora', label: 'Aurora', stops: ['#38ef7d', '#11998e', '#4facfe', '#a18cd1'] },
    { id: 'candy', label: 'Candy', stops: ['#ff9a9e', '#fad0c4', '#a1c4fd', '#c2e9fb', '#fbc2eb'] },
    { id: 'gold', label: 'Gold', stops: ['#f6d365', '#fda085', '#ffe29f', '#fff1b8'] },
    { id: 'ice', label: 'Ice', stops: ['#e0f7ff', '#8fd3f4', '#ffffff', '#84fab0'] },
    { id: 'rose', label: 'Rose', stops: ['#ff9a9e', '#fecfef', '#f78fb3', '#ff6b9d'] },
    { id: 'emerald', label: 'Emerald', stops: ['#11998e', '#38ef7d', '#a8ff78', '#00b09b'] },
    { id: 'violet', label: 'Violet', stops: ['#8e2de2', '#4a00e0', '#c471ed', '#f64f59'] },
    { id: 'lava', label: 'Lava', stops: ['#f12711', '#f5af19', '#ff512f', '#dd2476'] },
    { id: 'lagoon', label: 'Lagoon', stops: ['#43cea2', '#185a9d', '#00d2ff', '#3a7bd5'] },
    { id: 'cotton', label: 'Cotton candy', stops: ['#ffc3a0', '#ffafbd', '#c9ffbf', '#a1ffce'] },
    { id: 'royal', label: 'Royal', stops: ['#141e30', '#6a82fb', '#fc5c7d', '#ffd700'] },
    { id: 'citrus', label: 'Citrus', stops: ['#f7971e', '#ffd200', '#c6ff00', '#76ff03'] },
    { id: 'midnight', label: 'Midnight', stops: ['#4776e6', '#8e54e9', '#00c6ff', '#d4a5ff'] },
    { id: 'champagne', label: 'Champagne', stops: ['#f6e3b4', '#e8c98a', '#ffffff', '#d9b26f'] }
  ];

  var SWATCHES = [
    '#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af', '#6b7280', '#111827',
    '#fff1b8', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#f44336',
    '#ff80ab', '#f06292', '#e91e63', '#d81b60', '#c2185b', '#880e4f',
    '#e1bee7', '#c084fc', '#ab47bc', '#9c27b0', '#7e57c2', '#673ab7',
    '#c5cae9', '#7986cb', '#3f51b5', '#2196f3', '#4facfe', '#1e88e5',
    '#b3e5fc', '#4dd0e1', '#03a9f4', '#00bcd4', '#00f0ff', '#009688',
    '#b2dfdb', '#80cbc4', '#38ef7d', '#4caf50', '#8bc34a', '#cddc39',
    '#d9c28f', '#f6e3b4', '#e8c98a', '#bcaaa4', '#a1887f', '#ff8a65'
  ];

  var TILE_PX = 420; // width of one repeat of the moving pattern

  function ids() { return COLOR_STYLES.map(function (s) { return s.id; }); }
  function byId(id) { for (var i = 0; i < COLOR_STYLES.length; i++) if (COLOR_STYLES[i].id === id) return COLOR_STYLES[i]; return COLOR_STYLES[0]; }

  /* css gradient that repeats seamlessly (the first colour is added again at the end), or null for solid */
  function gradientCss(id) {
    var st = byId(id);
    if (!st.stops) return null;
    return 'linear-gradient(90deg, ' + st.stops.concat([st.stops[0]]).join(', ') + ')';
  }

  function fontGroups() {
    return { en: FONTS.filter(function (f) { return f.group === 'en'; }), fa: FONTS.filter(function (f) { return f.group === 'fa'; }) };
  }

  return { FONTS: FONTS, DEFAULT_TRANSLATION_FONT: DEFAULT_TRANSLATION_FONT, COLOR_STYLES: COLOR_STYLES, SWATCHES: SWATCHES, TILE_PX: TILE_PX, ids: ids, byId: byId, gradientCss: gradientCss, fontGroups: fontGroups };
});
