const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.8.0';
const targetDirName = `makan-music-player-source-v${version}`;
const targetDir = path.join(rootDir, targetDirName);
const distZip = path.join(rootDir, 'dist', `makan-music-player-source-v${version}.zip`);

console.log('Creating versioned source folder:', targetDir);

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

const itemsToCopy = [
  'desktop',
  'docs',
  'media',
  'native',
  'scripts',
  'tests',
  'index.html',
  'package.json',
  'package-lock.json',
  'playwright.config.js',
  'manifest.json',
  'README.md',
  'HANDOFF.md',
  'THIRD_PARTY_LICENSES.md',
  '.gitignore'
];


for (const item of itemsToCopy) {
  const src = path.join(rootDir, item);
  const dest = path.join(targetDir, item);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`Copied ${item}`);
  }
}

// Clean temporary test dump directories from copied source package
const tempDumpsInTarget = [
  path.join(targetDir, 'tests', 'temp-v181-dumps'),
  path.join(targetDir, 'tests', 'fixtures', 'v182_dumps'),
  path.join(targetDir, 'tests', 'test-two-hour-playback.log'),
  path.join(targetDir, 'tests', 'test-two-hour-playback-telemetry.json'),
  path.join(targetDir, 'tests', 'test-playback-stress.log')
];
for (const p of tempDumpsInTarget) {
  if (fs.existsSync(p)) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
  }
}

console.log('Compressing source directory to:', distZip);
if (fs.existsSync(distZip)) {
  fs.unlinkSync(distZip);
}

// Ensure dist folder exists
const distDir = path.dirname(distZip);
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Compress using tar.exe or PowerShell Compress-Archive
try {
  execSync(`tar.exe -a -c -f "${distZip}" "${targetDirName}"`, {
    cwd: rootDir,
    stdio: 'inherit'
  });
} catch (tarErr) {
  console.log('tar.exe failed, falling back to PowerShell Compress-Archive...');
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${targetDirName}' -DestinationPath '${distZip}' -Force"`, {
    cwd: rootDir,
    stdio: 'inherit'
  });
}

const stats = fs.statSync(distZip);
try {
  fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch (e) {}
console.log(`Source package successfully created: ${distZip} (${stats.size} bytes)`);

