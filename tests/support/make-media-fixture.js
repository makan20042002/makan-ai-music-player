// Creates test media files with plain Node (no committed binaries, no ffmpeg).
// Run by Playwright's global setup before every test run; can also be run by hand:
//   node tests/support/make-media-fixture.js
const fs = require('fs');
const path = require('path');

const DEFAULT_SEGMENTS = [['tone', 1], ['silence', 1], ['tone', 1]]; // 3 seconds total

// 16-bit PCM WAV. Tone = sine wave, silence = zeros.
// With channels > 1 the tone goes to the FIRST channel only; the others stay silent
// (so a correct mono mix has half the amplitude).
function makeWav({ sampleRate = 16000, freq = 440, amplitude = 0.3, channels = 1, segments = DEFAULT_SEGMENTS } = {}) {
  const counts = segments.map(([type, seconds]) => [type, Math.round(seconds * sampleRate)]);
  const frames = counts.reduce((sum, [, n]) => sum + n, 0);
  const data = Buffer.alloc(frames * channels * 2);
  let frame = 0;
  for (const [type, n] of counts) {
    for (let k = 0; k < n; k++, frame++) {
      const v = type === 'tone' ? Math.round(Math.sin((2 * Math.PI * freq * k) / sampleRate) * amplitude * 32767) : 0;
      for (let c = 0; c < channels; c++) data.writeInt16LE(c === 0 ? v : 0, (frame * channels + c) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function writeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    toneSilenceWav: path.join(dir, 'tone-silence.wav'), // 16 kHz mono, 3 s: tone, silence, tone
    stereo44kWav: path.join(dir, 'stereo-44k.wav') // 44.1 kHz stereo, 2 s: tone (left only), silence
  };
  fs.writeFileSync(files.toneSilenceWav, makeWav());
  fs.writeFileSync(files.stereo44kWav, makeWav({ sampleRate: 44100, channels: 2, segments: [['tone', 1], ['silence', 1]] }));
  return files;
}

module.exports = { makeWav, writeFixtures };

if (require.main === module) {
  const files = writeFixtures(path.resolve(__dirname, '..', 'fixtures'));
  console.log('Wrote ' + Object.values(files).join(', '));
}
