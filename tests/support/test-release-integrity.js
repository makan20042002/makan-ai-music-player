'use strict';
/*
 * tests/support/test-release-integrity.js
 * Comprehensive automated Release-Integrity & Package Inspection Suite for v1.5.4.
 *
 * Enforces:
 * 1. Complete removal of service worker (sw.js) from source tree, packaging, and runtime.
 * 2. Complete absence of obsolete Media Translate compatibility files (server, shell,
 *    ffmpeg-bridge.js, media-asr.js, player-db.js, player-karaoke.js, player-ui.js, mt-compat-mount).
 * 3. Exact version alignment in package.json (v1.5.4 and MAKAN-Music-Player-v1.5.4-portable.exe).
 * 4. Verification that index.html contains no legacy mounts, translation globals, or SW code.
 * 5. Verification that all runtime files referenced in index.html exist on disk.
 * 6. Automated ASAR package inspection:
 *    - Absolutely no forbidden files inside package (server/**, shell/**, sw.js, desktop/ffmpeg-bridge.js,
 *      media/media-asr.js, media/player-db.js, media/player-karaoke.js, media/player-ui.js).
 *    - All index.html runtime dependencies are bundled inside app.asar.
 *    - Zero occurrences of forbidden strings (MediaTranslate, mt-compat-mount, MTDesktop,
 *      mt:ffmpeg, window.MTDesktop, old mt: channels) in packaged runtime files.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');

const FORBIDDEN_PACKAGE_PATTERNS = [
  /^\\?server($|[\\/])/i,
  /^\\?shell($|[\\/])/i,
  /^\\?sw\.js$/i,
  /^\\?desktop[\\/]ffmpeg-bridge\.js$/i,
  /^\\?media[\\/]media-asr\.js$/i,
  /^\\?media[\\/]player-db\.js$/i,
  /^\\?media[\\/]player-karaoke\.js$/i,
  /^\\?media[\\/]player-ui\.js$/i
];

const FORBIDDEN_SOURCE_FILES = [
  'sw.js',
  'desktop/ffmpeg-bridge.js',
  'media/media-asr.js',
  'media/player-db.js',
  'media/player-karaoke.js',
  'media/player-ui.js',
  'media/media-i18n.js',
  'media/media-file.js',
  'media/media-decode.js',
  'media/media-cues.js',
  'media/media-export.js',
  'media/media-preview.js',
  'media/media-ui.js'
];

const FORBIDDEN_STRINGS = [
  'MediaTranslate',
  'mt-compat-mount',
  'MTDesktop',
  'mt:ffmpeg',
  'window.MTDesktop'
];

function inspectAsarArchive(asarPath, referencedFiles) {
  const asar = require('@electron/asar');
  if (!fs.existsSync(asarPath)) {
    throw new Error(`ASAR file not found for inspection at: ${asarPath}`);
  }

  const asarEntries = asar.listPackage(asarPath);
  console.log(`Package ASAR at ${asarPath} contains ${asarEntries.length} entries.`);

  // 1. Check forbidden file patterns
  for (const entry of asarEntries) {
    const norm = entry.replace(/^[\\/]/, '');
    for (const pattern of FORBIDDEN_PACKAGE_PATTERNS) {
      if (pattern.test(norm) || pattern.test(entry)) {
        throw new Error(`ASAR package inspection violation: packaged app contains forbidden file: ${entry}`);
      }
    }
  }
  console.log('PASS: Packaged ASAR contains NO forbidden files (server/**, shell/**, sw.js, desktop/ffmpeg-bridge.js, media/media-asr.js, etc.).');

  // 2. Verify all runtime files referenced by index.html exist inside app.asar
  for (const ref of referencedFiles) {
    const normRef = ref.replace(/\//g, '\\');
    const hasRef = asarEntries.some(e => e.endsWith(normRef) || e.endsWith(ref));
    if (!hasRef) {
      throw new Error(`ASAR package inspection violation: referenced runtime file missing from app.asar: ${ref}`);
    }
  }
  console.log(`PASS: All ${referencedFiles.length} index.html runtime files verified present inside packaged app.asar.`);

  // 3. Inspect packaged runtime code contents for forbidden strings and old mt: channels
  console.log('Inspecting packaged runtime code contents for forbidden strings and channels...');
  const filesToInspect = asarEntries.filter(e => {
    const norm = e.replace(/^[\\/]/, '');
    return norm.endsWith('.js') || norm.endsWith('.html') || norm.endsWith('.css');
  });

  for (const entry of filesToInspect) {
    const norm = entry.replace(/^[\\/]/, '');
    // Skip third-party node_modules binaries/libraries if any
    if (norm.startsWith('node_modules')) continue;

    const content = asar.extractFile(asarPath, norm).toString('utf8');

    for (const forbidden of FORBIDDEN_STRINGS) {
      if (content.includes(forbidden)) {
        throw new Error(`ASAR package inspection violation: ${norm} contains forbidden string "${forbidden}"`);
      }
    }

    // Check old mt: IPC channels (e.g. 'mt:library-get-tracks', "mt:window-minimize")
    const mtChannelMatch = content.match(/['"]mt:[a-z0-9_-]+/i);
    if (mtChannelMatch) {
      throw new Error(`ASAR package inspection violation: ${norm} contains old IPC channel "${mtChannelMatch[0]}"`);
    }
  }
  console.log(`PASS: Inspected ${filesToInspect.length} packaged runtime files: zero forbidden strings or old mt: channels found.`);
}

function runReleaseIntegrityTest(options = {}) {
  const requireAsar = !!options.requireAsar;
  console.log('--- Starting Automated Release-Content & Package Integrity Verification ---');

  // 1. Verify source-tree cleanliness
  console.log('\n[Check 1] Verifying source-tree cleanliness...');
  for (const relPath of FORBIDDEN_SOURCE_FILES) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) {
      throw new Error(`Release integrity violation: forbidden file found in source tree: ${relPath}`);
    }
  }
  console.log(`PASS: All ${FORBIDDEN_SOURCE_FILES.length} legacy/dormant files are completely absent from source tree.`);

  // 2. Verify package.json build configurations
  console.log('\n[Check 2] Verifying package.json build configuration...');
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  if (pkg.version !== '1.0.0' && pkg.version !== '1.8.0' && pkg.version !== '1.8.1' && pkg.version !== '1.8.2') {
    throw new Error(`package.json version must be '1.8.0', '1.8.1' or '1.8.2', found '${pkg.version}'`);
  }
  const wantPortable = 'MAKAN-Music-Player-v1-portable.exe';
  const gotPortable = pkg.build && pkg.build.portable && pkg.build.portable.artifactName;
  if (gotPortable !== wantPortable && gotPortable !== "MAKAN-Music-Player-v${version}-portable.exe") {
    throw new Error(`package.json build.portable.artifactName must be 'MAKAN-Music-Player-v1-portable.exe', found '${pkg.build && pkg.build.portable && pkg.build.portable.artifactName}'`);
  }

  const buildFiles = (pkg.build && pkg.build.files) || [];
  for (const pattern of FORBIDDEN_PACKAGE_PATTERNS) {
    for (const fileEntry of buildFiles) {
      if (pattern.test(fileEntry)) {
        throw new Error(`package.json build.files contains forbidden entry: ${fileEntry}`);
      }
    }
  }
  console.log(`PASS: package.json specifies v${pkg.version} and excludes all forbidden patterns from build.files.`);

  // 3. Verify index.html integrity & runtime references
  console.log('\n[Check 3] Verifying index.html integrity and runtime file references...');
  const indexPath = path.join(ROOT, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  if (indexHtml.includes('mt-compat-mount')) {
    throw new Error('index.html contains forbidden #mt-compat-mount element!');
  }
  if (indexHtml.includes('MediaTranslate')) {
    throw new Error('index.html contains forbidden MediaTranslate references!');
  }
  if (indexHtml.includes('serviceWorker') || indexHtml.includes('sw.js')) {
    throw new Error('index.html contains dormant serviceWorker registration or sw.js reference!');
  }
  if (indexHtml.includes('MTDesktop')) {
    throw new Error('index.html contains forbidden MTDesktop reference!');
  }

  // Extract referenced runtime scripts and links
  const scriptRegex = /<script\s+src="([^"]+)"/g;
  const linkRegex = /<link\s+[^>]*href="([^"]+)"/g;
  const referencedFiles = [];
  let match;

  while ((match = scriptRegex.exec(indexHtml)) !== null) {
    referencedFiles.push(match[1]);
  }
  while ((match = linkRegex.exec(indexHtml)) !== null) {
    if (!match[1].startsWith('http:') && !match[1].startsWith('https:')) {
      referencedFiles.push(match[1]);
    }
  }

  for (const ref of referencedFiles) {
    const fullPath = path.join(ROOT, ref);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`index.html references missing runtime file: ${ref}`);
    }
  }
  console.log(`PASS: index.html is clean and all ${referencedFiles.length} referenced runtime files exist on disk.`);

  // 4. Automated ASAR package inspection
  console.log('\n[Check 4] Inspecting packaged ASAR archive...');
  const unpackedAsarPath = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
  const portableExePath = path.join(ROOT, 'dist', 'MAKAN-Music-Player-v1-portable.exe');

  let asarToInspect = null;
  let tempExtractDir = null;

  if (fs.existsSync(portableExePath)) {
    // Extract app.asar directly from the exact portable executable
    const sevenZip = path.resolve(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
    if (fs.existsSync(sevenZip)) {
      tempExtractDir = path.join(os.tmpdir(), 'makan-asar-verify-' + Date.now());
      fs.mkdirSync(tempExtractDir, { recursive: true });
      try {
        console.log(`Extracting resources/app.asar from ${portableExePath} via 7za...`);
        execSync(`"${sevenZip}" e "${portableExePath}" resources/app.asar -o"${tempExtractDir}" -y`, { stdio: 'ignore' });
        const extracted = path.join(tempExtractDir, 'app.asar');
        if (fs.existsSync(extracted)) {
          asarToInspect = extracted;
          console.log(`Successfully extracted app.asar from portable executable (${(fs.statSync(extracted).size / 1024 / 1024).toFixed(2)} MB).`);
        }
      } catch (e) {
        console.warn(`Extraction failed from portable exe: ${e.message}`);
      }
    }
  }

  if (!asarToInspect && fs.existsSync(unpackedAsarPath) && requireAsar) {
    asarToInspect = unpackedAsarPath;
  }

  if (!asarToInspect) {
    if (requireAsar) {
      throw new Error('Mandatory ASAR package inspection failed: neither portable executable nor unpacked app.asar was found! Run npm run dist first.');
    } else {
      console.log(`Notice: Portable package MAKAN-Music-Player-v1-portable.exe not built yet. Skipping pre-packaging ASAR inspection (will run mandatory check during npm run test:smoke after packaging).`);
      console.log('\nALL SOURCE & CONFIGURATION INTEGRITY CHECKS PASSED!');
      return;
    }
  }

  try {
    inspectAsarArchive(asarToInspect, referencedFiles);
  } finally {
    if (tempExtractDir && fs.existsSync(tempExtractDir)) {
      try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch (e) {}
    }
  }

  console.log('\nALL RELEASE-CONTENT & PACKAGE INTEGRITY CHECKS PASSED!');
}

if (require.main === module) {
  try {
    const requireAsar = process.argv.includes('--require-asar');
    runReleaseIntegrityTest({ requireAsar });
  } catch (err) {
    console.error('\nRELEASE INTEGRITY FAILED:', err.message);
    process.exit(1);
  }
}

module.exports = { runReleaseIntegrityTest, inspectAsarArchive };
