const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'native', 'src');
const includeDir = path.join(rootDir, 'native', 'include');
const libDir = path.join(rootDir, 'native', 'lib');
const binDir = path.join(rootDir, 'desktop', 'bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

const outputFile = path.join(binDir, 'makan-audio-helper.exe');
const sourceFile = path.join(srcDir, 'makan-audio-helper.c');
const cjsonSource = path.join(srcDir, 'cJSON.c');

console.log('Building makan-audio-helper.exe...');
console.log(`Source: ${sourceFile}`);
console.log(`Output: ${outputFile}`);

const cmd = [
  'gcc',
  '-O2',
  '-Wall',
  '-Wno-unused-function',
  `-I"${srcDir}"`,
  `-I"${includeDir}"`,
  `-L"${libDir}"`,
  `"${sourceFile}"`,
  `"${cjsonSource}"`,
  '-lavformat',
  '-lavcodec',
  '-lavutil',
  '-lswresample',
  '-lole32',
  '-lpthread',
  '-lm',
  `-o "${outputFile}"`
].join(' ');

console.log(`Running: ${cmd}`);
try {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
  console.log('Build successful!');
  const stats = fs.statSync(outputFile);
  console.log(`Output file size: ${stats.size} bytes`);
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}

// ---- makan-open.dll: gives the whole Explorer selection (even thousands of files) to the app
const openSource = path.join(srcDir, 'makan-open.c');
const openOutput = path.join(binDir, 'makan-open.dll');
console.log('Building makan-open.dll...');
const openCmd = ['gcc', '-shared', '-O2', '-Wall', `"${openSource}"`, '-lole32', '-lshell32', '-luuid', '-Wl,--kill-at', `-o "${openOutput}"`].join(' ');
console.log(`Running: ${openCmd}`);
try {
  execSync(openCmd, { stdio: 'inherit', cwd: rootDir });
  console.log('Build successful! ' + fs.statSync(openOutput).size + ' bytes');
} catch (err) {
  console.error('Build of makan-open.dll failed:', err);
  process.exit(1);
}
