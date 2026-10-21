'use strict';
/*
 * desktop/key-store.js - remembers the person's own API keys on this PC, only if they ask for it.
 * Keys are encrypted with Windows (Electron safeStorage: only this Windows account can read them).
 * Never logged, never put in settings.json, never sent anywhere except by the page that uses the key.
 */
const fs = require('fs');
const path = require('path');

const IDS = ['gemini', 'cloud'];

function createKeyStore({ safeStorage, file }) {
  function available() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()); } catch (e) { return false; }
  }
  function readAll() {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return (j && typeof j === 'object') ? j : {}; } catch (e) { return {}; }
  }
  function writeAll(obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  return {
    available,
    /* { gemini: 'key', ... } for the keys that can be decrypted */
    getAll() {
      if (!available()) return {};
      const all = readAll(), out = {};
      for (const id of IDS) {
        if (typeof all[id] !== 'string') continue;
        try { const v = safeStorage.decryptString(Buffer.from(all[id], 'base64')); if (v) out[id] = v; } catch (e) { /* unreadable: ignored */ }
      }
      return out;
    },
    save(id, value) {
      if (!IDS.includes(id)) return { ok: false, error: 'Unknown key.' };
      const v = String(value == null ? '' : value).trim();
      if (!v || v.length > 500) return { ok: false, error: 'Empty key.' };
      if (!available()) return { ok: false, error: 'Windows could not encrypt the key on this PC.' };
      const all = readAll();
      all[id] = safeStorage.encryptString(v).toString('base64');
      writeAll(all);
      return { ok: true };
    },
    forget(id) {
      if (!IDS.includes(id)) return { ok: false };
      const all = readAll();
      if (id in all) { delete all[id]; writeAll(all); }
      return { ok: true };
    }
  };
}

module.exports = { createKeyStore, IDS };
