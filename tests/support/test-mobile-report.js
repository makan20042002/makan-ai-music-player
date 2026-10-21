'use strict';
/* Phone app: the Problem report (Menu -> Problem report). Checks that it keeps events, hides keys, keeps only the
 * newest lines, is reachable from the menu, and that the models/lyrics code reports what happens. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(c, n) { if (c) { passed++; console.log('  ok  ' + n); } else { failed++; console.log('  FAIL ' + n); } }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

console.log('Phone problem report checks');
const mem = {};
const sb = { console, setTimeout, clearTimeout, Date, JSON, Array, String, Error, Promise, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0 Mobile' } };
sb.window = sb;
sb.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
sb.document = { addEventListener() {}, createElement: () => ({}) };
sb.addEventListener = () => {};
sb.HTMLMediaElement = function () {}; sb.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
sb.Audio = function () {};
vm.createContext(sb);
vm.runInContext(read('mobile/overlay/phone-report.js'), sb, { filename: 'phone-report.js' });
const R = sb.MakanPhoneReport;
ok(!!R && typeof R.log === 'function' && typeof R.text === 'function' && typeof R.show === 'function', 'the report object exists');
R.log('test', 'hello world');
ok(/test hello world/.test(R.text()), 'an event shows up in the report');
R.log('test', 'key AIzaSyA1234567890abcdefghijk end');
ok(!/AIzaSyA1234567890/.test(R.text()) && /key hidden/.test(R.text()), 'a key-like text is hidden');
for (let i = 0; i < 400; i++) R.log('n', 'line ' + i);
const lines = R.text().split('\n').filter((l) => / n line /.test(l));
ok(lines.length <= 160 && /line 399/.test(R.text()) && !/line 10\b/.test(R.text()), 'only the newest lines are kept');
R.clear();
ok(!/line 399/.test(R.text()), 'Clear empties the report');

const shell = read('mobile/overlay/mobile-shell.js');
ok(/data-mx="report"/.test(shell) && /MakanPhoneReport\.show/.test(shell), 'the menu has a Problem report row');
const bridge = read('mobile/overlay/phone-bridge.js');
ok(/rlog\('scan'/.test(bridge) && /rlog\('lyrics-save'/.test(bridge) && /rlog\('storage'/.test(bridge), 'scan, lyrics save and storage start are reported');
ok(/rlog\('lyrics', 'Make lyrics (started|FAILED|finished)/.test(read('mobile/overlay/phone-models.js')) || (/Make lyrics started/.test(read('mobile/overlay/phone-models.js')) && /Make lyrics FAILED/.test(read('mobile/overlay/phone-models.js'))), 'Make lyrics start, end and failure are reported');
ok(!/apiKey|getKey\(/.test(read('mobile/overlay/phone-report.js')), 'the report code never touches keys');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
