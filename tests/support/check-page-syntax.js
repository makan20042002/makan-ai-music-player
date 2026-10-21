const fs = require('fs');
const path = require('path');

const scripts = [
  'media/media-i18n.js',
  'media/media-file.js',
  'media/media-decode.js',
  'media/media-asr.js',
  'media/media-cues.js',
  'media/media-export.js',
  'media/media-preview.js',
  'media/media-ui.js',
  'media/components/icons.js',
  'media/components/state.js',
  'media/components/lyrics-parser.js',
  'media/components/playback-controller.js',
  'media/components/audio-engine.js',
  'media/components/track-table.js',
  'media/components/tag-fixer.js',
  'media/components/ai-playlist.js',
  'media/components/waveform.js',
  'media/components/sound-analysis.js',
  'media/components/top-bar.js',
  'media/components/library-sidebar.js',
  'media/components/audio-visualizer.js',
  'media/components/player-stage.js',
  'media/components/lyrics-words.js',
  'media/components/lyrics-theatre.js',
  'media/components/transport-dock.js',
  'media/components/automix.js',
  'media/components/sleep-timer.js',
  'media/components/study-words.js',
  'media/components/drawers.js',
  'media/components/app-shell.js'
];

for (const s of scripts) {
  try {
    const full = path.resolve(__dirname, '..', '..', s);
    const code = fs.readFileSync(full, 'utf8');
    new Function(code);
    console.log('OK:', s);
  } catch (e) {
    console.error('SYNTAX ERROR IN:', s, e.message);
  }
}
