const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

console.log('Generating real, legal 2-second audio fixtures in:', fixturesDir);

const configs = [
  {
    name: 'fixture.mp3',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -c:a libmp3lame -b:a 192k -metadata title="Test MP3" -metadata artist="MAKAN Test Artist" -metadata album="Format Verification" -metadata genre="Acoustic" -metadata date="2026"'
  },
  {
    name: 'fixture.flac',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=523:duration=2" -c:a flac -metadata title="Test FLAC" -metadata artist="MAKAN Test Artist" -metadata album="Format Verification" -metadata genre="Classical" -metadata date="2026"'
  },
  {
    name: 'fixture.wav',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=330:duration=2" -c:a pcm_s16le -metadata title="Test WAV" -metadata artist="MAKAN Test Artist" -metadata album="Format Verification"'
  },
  {
    name: 'fixture.aac',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=659:duration=2" -c:a aac -b:a 192k'
  },
  {
    name: 'fixture.m4a',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=784:duration=2" -c:a aac -b:a 192k -metadata title="Test M4A" -metadata artist="MAKAN Test Artist" -metadata album="Format Verification" -metadata genre="Jazz"'
  },
  {
    name: 'fixture.ogg',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=587:duration=2" -c:a libvorbis -q:a 5 -metadata title="Test OGG" -metadata artist="MAKAN Test Artist" -metadata album="Format Verification" -metadata genre="Electronic"'
  },
  {
    name: 'fixture.opus',
    cmd: 'ffmpeg -y -f lavfi -i "sine=frequency=880:duration=2" -c:a libopus -b:a 128k -metadata title="Test Opus" -metadata artist="MAKAN Test Artist" -metadata album="Format Verification" -metadata genre="Ambient"'
  }
];

for (const cfg of configs) {
  const target = path.join(fixturesDir, cfg.name);
  const fullCmd = `${cfg.cmd} "${target}"`;
  console.log(`Generating ${cfg.name}...`);
  execSync(fullCmd, { stdio: 'ignore' });
  const stat = fs.statSync(target);
  console.log(`  -> Created ${cfg.name} (${stat.size} bytes)`);
}

// Corrupt & unsupported fixtures
fs.writeFileSync(path.join(fixturesDir, 'corrupt-empty.mp3'), Buffer.alloc(0));
fs.writeFileSync(path.join(fixturesDir, 'corrupt-truncated.flac'), Buffer.from('fLaC\x00\x00\x00\x22\x10\x00'));
fs.writeFileSync(path.join(fixturesDir, 'corrupt-garbage.ogg'), Buffer.from('OggS\x00\x02THIS_IS_NOT_REAL_AUDIO_JUST_CORRUPTED_BYTES_FOR_RESILIENCE_TESTING'));
fs.writeFileSync(path.join(fixturesDir, 'unsupported-dummy.wma'), Buffer.from('DUMMY_UNSUPPORTED_WMA_CONTENT'));

console.log('All audio fixtures successfully generated!');
