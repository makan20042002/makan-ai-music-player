'use strict';
/* tests/support/test-sleep-timer.js - the sleep timer (media/components/sleep-timer.js), with a fake clock. */
const assert = require('assert');
const path = require('path');
const ST = require(path.join(__dirname, '..', '..', 'media', 'components', 'sleep-timer.js'));
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); } }

function rig(opts) {
  const r = { t: 0, vol: 0.8, paused: 0, tick: null, changes: [] };
  r.timer = ST.create(Object.assign({
    now: () => r.t,
    getVolume: () => r.vol,
    setVolume: (v) => { r.vol = v; },
    pause: () => { r.paused++; },
    setInterval: (f) => { r.tick = f; return 1; },
    clearInterval: () => { r.tick = null; },
    onChange: (s) => r.changes.push(s)
  }, opts || {}));
  r.advance = (sec) => { for (let i = 0; i < sec; i++) { r.t += 1000; if (r.tick) r.tick(); } };
  return r;
}

test('stops after the chosen time and puts the volume back', () => {
  const r = rig();
  r.timer.start(30);
  r.advance(30 * 60 - 20);
  assert.strictEqual(r.paused, 0);
  assert.strictEqual(r.vol, 0.8, 'no fade yet');
  r.advance(20);
  assert.strictEqual(r.paused, 1);
  assert.strictEqual(r.vol, 0.8, 'volume restored after the stop');
  assert.strictEqual(r.timer.status().mode, 'off');
  assert.strictEqual(r.tick, null, 'the clock is stopped');
});

test('fades out in the last 15 seconds', () => {
  const r = rig();
  r.timer.start(1);
  r.advance(45);
  assert.strictEqual(r.vol, 0.8, 'still full at 15 s left');
  r.advance(7);
  assert.ok(r.vol < 0.8 && r.vol > 0.3, 'about half at 8 s left: ' + r.vol);
  r.advance(7);
  assert.ok(r.vol < 0.1, 'nearly silent just before the end: ' + r.vol);
});

test('cancel during the fade brings the volume back and does not pause', () => {
  const r = rig();
  r.timer.start(1);
  r.advance(55);
  assert.ok(r.vol < 0.8);
  r.timer.cancel();
  assert.strictEqual(r.vol, 0.8);
  r.advance(30);
  assert.strictEqual(r.paused, 0);
  assert.strictEqual(r.timer.status().mode, 'off');
});

test('"end of this song" waits for the next song to start, then pauses', () => {
  const r = rig();
  r.timer.endOfSong();
  assert.strictEqual(r.timer.status().mode, 'song');
  r.advance(600);
  assert.strictEqual(r.paused, 0, 'time does not matter in this mode');
  r.timer.onTrackChanged();
  assert.strictEqual(r.paused, 1);
  assert.strictEqual(r.timer.status().mode, 'off');
});

test('a song change does nothing when a time timer is running', () => {
  const r = rig();
  r.timer.start(10);
  r.timer.onTrackChanged();
  assert.strictEqual(r.paused, 0);
  assert.strictEqual(r.timer.status().mode, 'time');
});

test('starting again replaces the old timer; 0 or nothing turns it off', () => {
  const r = rig();
  r.timer.start(5);
  r.advance(60);
  r.timer.start(10);
  assert.strictEqual(r.timer.status().remainingSec, 600);
  r.timer.start(0);
  assert.strictEqual(r.timer.status().mode, 'off');
  r.timer.start('abc');
  assert.strictEqual(r.timer.status().mode, 'off');
});

test('a timer shorter than the fade starts fading at once', () => {
  const r = rig({ fadeSeconds: 15 });
  r.timer.start(0.1); // 6 seconds
  r.advance(1);
  assert.ok(r.vol < 0.8, 'already fading: ' + r.vol);
  r.advance(6);
  assert.strictEqual(r.paused, 1);
  assert.strictEqual(r.vol, 0.8);
});

test('remaining time is reported to the screen and counts down', () => {
  const r = rig();
  r.timer.start(15);
  r.advance(65);
  const last = r.changes[r.changes.length - 1];
  assert.strictEqual(last.mode, 'time');
  assert.strictEqual(last.remainingSec, 15 * 60 - 65);
});

test('starting a timer does not send a false "off" message to the screen first', () => {
  const r = rig();
  r.timer.start(5);
  r.changes.length = 0;
  r.timer.start(10);
  assert.ok(r.changes.length >= 1 && r.changes.every((c) => c.mode === 'time'), JSON.stringify(r.changes));
  r.changes.length = 0;
  r.timer.endOfSong();
  assert.ok(r.changes.every((c) => c.mode === 'song'), JSON.stringify(r.changes));
});

test('a screen that fails does not stop the timer', () => {
  const r = rig({ onChange: () => { throw new Error('screen gone'); } });
  r.timer.start(1);
  r.advance(61);
  assert.strictEqual(r.paused, 1);
});

test('time is written as m:ss or h:mm:ss', () => {
  assert.strictEqual(ST.formatRemaining(65), '1:05');
  assert.strictEqual(ST.formatRemaining(3725), '1:02:05');
  assert.strictEqual(ST.formatRemaining(-3), '0:00');
  assert.deepStrictEqual(ST.CHOICES, [15, 30, 45, 60, 90, 120]);
});

console.log(failures ? failures + ' FAILED' : 'All sleep timer tests passed');
process.exit(failures ? 1 : 0);
