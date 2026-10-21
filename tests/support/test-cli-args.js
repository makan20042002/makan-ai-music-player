'use strict';
/*
 * tests/support/test-cli-args.js
 * Comprehensive unit tests for production CLI argument filtering (desktop/cli-args.js).
 * Explicitly tests all 10 required scenarios:
 * 1. Supported audio paths
 * 2. Unsupported extensions
 * 3. Uppercase extensions
 * 4. Quoted paths
 * 5. Paths containing spaces
 * 6. Duplicate paths
 * 7. Electron switches
 * 8. Non-file arguments
 * 9. Missing files
 * 10. Multiple valid tracks
 */
const path = require('path');
const { filterAudioArgs, SUPPORTED_EXTS } = require('../../desktop/cli-args');

console.log('--- Testing Production CLI Argument Filtering ---');

// Mock filesystem setup
const existingFiles = new Set([
  path.resolve('C:\\Music\\Track 01.mp3'),
  path.resolve('C:\\Music\\Track 02.FLAC'),
  path.resolve('C:\\Music\\Track 03.WAV'),
  path.resolve('C:\\Music\\Track 04.aac'),
  path.resolve('C:\\Music\\Track 05.m4a'),
  path.resolve('C:\\Music\\Track 06.ogg'),
  path.resolve('C:\\Music\\Track 07.opus'),
  path.resolve('C:\\Music\\Favorites.m3u'),
  path.resolve('C:\\Music\\Workout Mix.m3u8'),
  path.resolve('C:\\Music\\document.txt'),
  path.resolve('C:\\Music\\app.exe'),
  path.resolve('C:\\Music\\song.wma'),
  path.resolve('C:\\Music\\Quoted Track.mp3'),
  path.resolve('C:\\My Library\\Artist Name\\01 - Beautiful Song (Remix 2026).mp3')
]);

const mockDeps = {
  fs: {
    existsSync: (p) => existingFiles.has(path.resolve(p))
  },
  path: path
};

// 1. Supported audio paths
const supportedArgs = [
  'MAKAN Music Player.exe',
  'C:\\Music\\Track 01.mp3',
  'C:\\Music\\Track 04.aac',
  'C:\\Music\\Track 05.m4a',
  'C:\\Music\\Track 06.ogg',
  'C:\\Music\\Track 07.opus'
];
const supportedResults = filterAudioArgs(supportedArgs, mockDeps);
if (supportedResults.length !== 5) {
  throw new Error(`Expected 5 supported audio files, got ${supportedResults.length}`);
}
console.log('PASS: Supported audio paths correctly filtered.');

// 2. Unsupported extensions
const unsupportedArgs = [
  'node.exe',
  'C:\\Music\\document.txt',
  'C:\\Music\\app.exe',
  'C:\\Music\\song.wma'
];
const unsupportedResults = filterAudioArgs(unsupportedArgs, mockDeps);
if (unsupportedResults.length !== 0) {
  throw new Error(`Expected 0 unsupported files, got ${unsupportedResults.length}`);
}
console.log('PASS: Unsupported extensions (.txt, .exe, .wma) correctly rejected.');

// 3. Uppercase extensions
const uppercaseArgs = [
  'electron.exe',
  'C:\\Music\\Track 02.FLAC',
  'C:\\Music\\Track 03.WAV'
];
const uppercaseResults = filterAudioArgs(uppercaseArgs, mockDeps);
if (uppercaseResults.length !== 2) {
  throw new Error(`Expected 2 uppercase extension files, got ${uppercaseResults.length}`);
}
console.log('PASS: Uppercase extensions (.FLAC, .WAV) correctly recognized and filtered.');

// 4. Quoted paths
const quotedArgs = [
  'MAKAN Music Player.exe',
  '"C:\\Music\\Quoted Track.mp3"',
  '\'C:\\Music\\Track 01.mp3\''
];
const quotedResults = filterAudioArgs(quotedArgs, mockDeps);
if (quotedResults.length !== 2) {
  throw new Error(`Expected 2 quoted paths to be resolved, got ${quotedResults.length}: ${JSON.stringify(quotedResults)}`);
}
console.log('PASS: Quoted paths (double and single quotes) correctly unquoted and resolved.');

// 5. Paths containing spaces
const spaceArgs = [
  'C:\\App\\player.exe',
  'C:\\My Library\\Artist Name\\01 - Beautiful Song (Remix 2026).mp3'
];
const spaceResults = filterAudioArgs(spaceArgs, mockDeps);
if (spaceResults.length !== 1 || !spaceResults[0].includes('Beautiful Song (Remix 2026)')) {
  throw new Error(`Space/parentheses path failed! Got: ${JSON.stringify(spaceResults)}`);
}
console.log('PASS: Paths containing spaces and special characters correctly resolved.');

// 6. Duplicate paths
const duplicateArgs = [
  'MAKAN.exe',
  'C:\\Music\\Track 01.mp3',
  'C:\\Music\\Track 01.mp3',
  '"C:\\Music\\Track 01.mp3"'
];
const duplicateResults = filterAudioArgs(duplicateArgs, mockDeps);
if (duplicateResults.length !== 1) {
  throw new Error(`Expected duplicate paths to be deduplicated to 1, got ${duplicateResults.length}`);
}
console.log('PASS: Duplicate paths correctly deduplicated.');

// 7. Electron switches
const switchArgs = [
  'MAKAN Music Player.exe',
  '--inspect',
  '--no-sandbox',
  '-d',
  '--user-data-dir=C:\\Temp',
  '--enable-features=AudioService',
  'C:\\Music\\Track 01.mp3'
];
const switchResults = filterAudioArgs(switchArgs, mockDeps);
if (switchResults.length !== 1 || !switchResults[0].endsWith('Track 01.mp3')) {
  throw new Error(`Electron switches failed to filter! Got: ${JSON.stringify(switchResults)}`);
}
console.log('PASS: Electron switches correctly ignored.');

// 8. Non-file arguments
const nonFileArgs = [
  'electron.exe',
  null,
  undefined,
  12345,
  '',
  '   ',
  '.',
  'desktop/main.js',
  'C:\\Music\\Track 01.mp3'
];
const nonFileResults = filterAudioArgs(nonFileArgs, mockDeps);
if (nonFileResults.length !== 1 || !nonFileResults[0].endsWith('Track 01.mp3')) {
  throw new Error(`Non-file arguments failed to filter! Got: ${JSON.stringify(nonFileResults)}`);
}
console.log('PASS: Non-file arguments safely handled and filtered.');

// 9. Missing files
const missingArgs = [
  'electron.exe',
  'C:\\Music\\NonExistentSong.mp3',
  'C:\\Music\\FakePlaylist.m3u'
];
const missingResults = filterAudioArgs(missingArgs, mockDeps);
if (missingResults.length !== 0) {
  throw new Error(`Missing files were not filtered out! Got: ${JSON.stringify(missingResults)}`);
}
console.log('PASS: Missing files correctly rejected.');

// 10. Multiple valid tracks
const multipleValidArgs = [
  'node.exe',
  path.resolve(__dirname, '..', 'fixtures', 'fixture.mp3'),
  path.resolve(__dirname, '..', 'fixtures', 'fixture.flac'),
  path.resolve(__dirname, '..', 'fixtures', 'fixture.wav'),
  path.resolve(__dirname, '..', 'fixtures', 'fixture.aac')
];
const multipleValidResults = filterAudioArgs(multipleValidArgs);
if (multipleValidResults.length !== 4) {
  throw new Error(`Multiple valid tracks filtering failed! Expected 4, got ${multipleValidResults.length}`);
}
console.log('PASS: Multiple valid tracks successfully verified against real disk fixtures.');

console.log('ALL 10 CLI ARGUMENT FILTERING TESTS PASSED!');
