'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKeyStore } = require('../../desktop/key-store');

console.log('--- Testing remembered API keys (step 18) ---');

// a fake "Windows encryption": reversible, but the stored text never contains the key
const fake = {
  ok: true,
  isEncryptionAvailable() { return this.ok; },
  encryptString(s) { return Buffer.from(Buffer.from(s, 'utf8').toString('hex').split('').reverse().join(''), 'utf8'); },
  decryptString(b) { return Buffer.from(b.toString('utf8').split('').reverse().join(''), 'hex').toString('utf8'); }
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-keys-'));
const file = path.join(dir, 'secure-keys.json');
const KEY = 'AIzaSy-SECRET-KEY-12345';
const store = createKeyStore({ safeStorage: fake, file });

assert.deepStrictEqual(store.getAll(), {});
assert.deepStrictEqual(store.save('gemini', '  ' + KEY + ' '), { ok: true });
assert.ok(!fs.readFileSync(file, 'utf8').includes(KEY), 'the key is not stored as plain text');
assert.deepStrictEqual(store.getAll(), { gemini: KEY });
assert.strictEqual(store.save('nonsense', 'x').ok, false);
assert.strictEqual(store.save('gemini', '   ').ok, false);
assert.strictEqual(store.save('cloud', 'x'.repeat(501)).ok, false);
assert.deepStrictEqual(createKeyStore({ safeStorage: fake, file }).getAll(), { gemini: KEY }, 'survives a restart');
console.log('PASS: key is saved encrypted and comes back after a restart');

store.save('cloud', 'CLOUD-KEY');
assert.deepStrictEqual(Object.keys(store.getAll()).sort(), ['cloud', 'gemini']);
store.forget('gemini');
assert.deepStrictEqual(store.getAll(), { cloud: 'CLOUD-KEY' });
assert.ok(!fs.readFileSync(file, 'utf8').includes('gemini'));
console.log('PASS: forget removes the saved key');

fake.ok = false;
assert.strictEqual(store.save('gemini', KEY).ok, false);
assert.deepStrictEqual(store.getAll(), {});
fake.ok = true;
fs.writeFileSync(file, '{not json');
assert.deepStrictEqual(store.getAll(), {});
console.log('PASS: no encryption or a damaged file never crashes and never saves plain text');

// wiring: never in settings, never logged, only trusted windows
const root = path.join(__dirname, '..', '..');
const main = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
assert.ok(/ipcMain\.handle\('makan:keys-get', \(e\) => \{ if \(!trusted\(e\)\)/.test(main));
assert.ok(/ipcMain\.handle\('makan:keys-save', \(e, id, value\) => \{ if \(!trusted\(e\)\)/.test(main));
assert.ok(!/logStartup\([^)]*[Kk]ey/.test(main));
const pre = fs.readFileSync(path.join(root, 'desktop/preload.js'), 'utf8');
['getSavedKeys', 'saveKey', 'forgetSavedKey'].forEach(n => assert.ok(pre.includes(n), n));
const src = fs.readFileSync(path.join(root, 'media/components/lyrics-translate.js'), 'utf8');
assert.ok(!/localStorage[^;]*_keys|_keys[^;]*localStorage/.test(src), 'keys never go to browser storage');
console.log('PASS: only trusted windows can use the key store; keys never go to browser storage');
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
console.log('All key store tests passed.');
