'use strict';
/* Word highlight and tap-a-word: helpers, wiring, privacy. Run: node tests/support/test-lyrics-words.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const W = require('../../media/components/lyrics-words');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('splitWords: spaces, empty, CJK without spaces, one word', () => {
  assert.deepStrictEqual(W.splitWords('  Hello   big world '), ['Hello', 'big', 'world']);
  assert.deepStrictEqual(W.splitWords(''), []);
  assert.deepStrictEqual(W.splitWords(null), []);
  assert.deepStrictEqual(W.splitWords('你好世界'), ['你', '好', '世', '界']);
  assert.deepStrictEqual(W.splitWords('Hello'), ['Hello']);
  assert.deepStrictEqual(W.splitWords('سلام دنیا'), ['سلام', 'دنیا']);
});

t('cleanWord removes marks around a word but keeps letters inside', () => {
  assert.strictEqual(W.cleanWord('world!'), 'world');
  assert.strictEqual(W.cleanWord('"don\'t,"'), 'don\'t');
  assert.strictEqual(W.cleanWord('(سلام)'), 'سلام');
  assert.strictEqual(W.cleanWord('...'), '');
});

t('timeline: starts at the line start, no gaps, shared by letters, capped for long gaps', () => {
  const tl = W.timeline(['aa', 'bbbb'], 10, 14);
  assert.strictEqual(tl.length, 2);
  assert.strictEqual(tl[0].from, 10);
  assert.ok(Math.abs(tl[0].to - tl[1].from) < 1e-9);
  assert.ok((tl[1].to - tl[1].from) > 1.9 * (tl[0].to - tl[0].from));
  assert.ok(tl[1].to <= 14 + 1e-9);
  const slow = W.timeline(['hi', 'you'], 0, 60);
  assert.ok(slow[1].to <= 2, 'a 60 second gap does not stretch two short words');
  const bad = W.timeline(['a'], 5, 5);
  assert.ok(bad[0].to > bad[0].from, 'a missing end still gives a time');
  assert.deepStrictEqual(W.timeline([], 0, 5), []);
});

t('activeIndex: before, during, after', () => {
  const tl = W.timeline(['one', 'two', 'three'], 100, 104);
  assert.strictEqual(W.activeIndex(tl, 99), -1);
  assert.strictEqual(W.activeIndex(tl, 100), 0);
  assert.strictEqual(W.activeIndex(tl, tl[1].from + 0.01), 1);
  assert.strictEqual(W.activeIndex(tl, 200), 2);
});

t('wordsHtml: spans, escaping, spaces, no spaces for CJK', () => {
  assert.strictEqual(W.wordsHtml('a <b>'), '<span class="mk-w" data-wi="0">a</span> <span class="mk-w" data-wi="1">&lt;b&gt;</span>');
  assert.strictEqual(W.wordsHtml('你好'), '<span class="mk-w" data-wi="0">你</span><span class="mk-w" data-wi="1">好</span>');
  assert.strictEqual(W.wordsHtml(''), '');
});

t('wiring: script order, syntax list, test list, theatre uses it, no web addresses', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('lyrics-words.js') > 0 && html.indexOf('lyrics-words.js') < html.indexOf('lyrics-theatre.js'));
  assert.ok(read('tests/support/check-page-syntax.js').indexOf('lyrics-words.js') > 0);
  assert.ok(read('package.json').indexOf('test-lyrics-words.js') > 0);
  const th = read('media/components/lyrics-theatre.js');
  ['MakanLyricsWords', 'makan.lyricWords', 'mk-sw-words', 'mk-word-pop', 'timeUpdated', 'mk-w-done'].forEach(k => assert.ok(th.indexOf(k) > 0, 'theatre has ' + k));
  const css = read('media/player.css');
  ['.mk-w-done', '.mk-w-now', '.mk-word-pop'].forEach(k => assert.ok(css.indexOf(k) > 0, 'css has ' + k));
  const urlRe = /(https?:\/\/|\/\/)(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/i;
  assert.ok(!urlRe.test(read('media/components/lyrics-words.js')), 'helper has no web address');
  assert.ok(!urlRe.test(th), 'theatre has no web address');
});

console.log('\nALL ' + n + ' LYRICS-WORDS TESTS PASSED');
