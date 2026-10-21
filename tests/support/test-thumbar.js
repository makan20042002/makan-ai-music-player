'use strict';
/* tests/support/test-thumbar.js - Previous / Play-Pause / Next buttons on the taskbar thumbnail (desktop/thumbar.js). */
const assert = require('assert');
const { createThumbar, ICONS } = require('../../desktop/thumbar');
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); } }

const nativeImage = { createFromDataURL: (u) => ({ url: u }) };
function rig(extra) {
  const r = { sets: [], sent: [], destroyed: false };
  r.win = Object.assign({ isDestroyed: () => r.destroyed, setThumbarButtons: (b) => { r.sets.push(b); } }, extra || {});
  r.t = createThumbar({ win: r.win, nativeImage, send: (k) => r.sent.push(k) });
  return r;
}

test('four small PNG icons are built in', () => {
  ['prev', 'play', 'pause', 'next'].forEach((k) => {
    const b = Buffer.from(ICONS[k], 'base64');
    assert.strictEqual(b.slice(1, 4).toString(), 'PNG', k);
    assert.strictEqual(b.readUInt32BE(16), 16); assert.strictEqual(b.readUInt32BE(20), 16);
  });
});
test('three buttons: Previous, Play, Next; clicks send the same messages as the media keys', () => {
  const r = rig();
  assert.ok(r.t.update(false));
  const b = r.sets[0];
  assert.deepStrictEqual(b.map((x) => x.tooltip), ['Previous', 'Play', 'Next']);
  b[0].click(); b[1].click(); b[2].click();
  assert.deepStrictEqual(r.sent, ['prev', 'play-pause', 'next']);
});
test('the middle button turns into Pause while playing', () => {
  const r = rig();
  r.t.update(false); r.t.update(true);
  assert.strictEqual(r.sets[1][1].tooltip, 'Pause');
  assert.notStrictEqual(r.sets[1][1].icon.url, r.sets[0][1].icon.url);
});
test('the same state is not set twice, but refresh() makes the next update set it again', () => {
  const r = rig();
  r.t.update(true); r.t.update(true); r.t.update(1);
  assert.strictEqual(r.sets.length, 1);
  r.t.refresh(); r.t.update(true);
  assert.strictEqual(r.sets.length, 2);
});
test('a closed window or a system without taskbar buttons is ignored without an error', () => {
  const r = rig(); r.destroyed = true;
  assert.strictEqual(r.t.update(true), false);
  const none = createThumbar({ win: {}, nativeImage, send() {} });
  assert.strictEqual(none.update(true), false);
  const boom = rig({ setThumbarButtons: () => { throw new Error('not supported'); } });
  assert.strictEqual(boom.t.update(true), false);
});
console.log(failures ? failures + ' FAILED' : 'All taskbar button tests passed');
process.exit(failures ? 1 : 0);
