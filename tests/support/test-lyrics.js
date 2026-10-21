const {
  isRTL,
  parseLrc,
  parseSrt,
  parseVtt,
  parseAss,
  parse,
  exportLrc,
  exportSrt,
  exportVtt,
  exportAss,
  updateCue
} = require('../../media/components/lyrics-parser');

function testLyricsParser() {
  console.log('Testing Lyrics Parser...');

  // 1. RTL test
  if (!isRTL('سلام این یک آزمایش است') || !isRTL('در تاریکی پنهان نشو') || isRTL('Hello World')) {
    throw new Error('RTL detection failed');
  }
  console.log('RTL detection passed');

  // 2. Enhanced LRC test with words and bilingual delimiter
  const lrcText = `
[ti:Midnight Echoes]
[ar:Aria Sol]
[al:Midnight Echoes EP]
[02:34.00] Don't hide in the dark // در تاریکی پنهان نشو
[02:41.00] <02:41.00> You're <02:43.00> lost <02:45.00> in <02:47.00> the <02:48.00> dark // تو در تاریکی گم شده‌ای
[02:47.00][02:55.00] Chorus line repeated // خط تکراری
  `;
  const parsedLrc = parseLrc(lrcText);
  console.log('Parsed LRC cues count:', parsedLrc.cues.length);
  if (parsedLrc.cues.length !== 4) {
    throw new Error('Expected 4 cues from LRC (including multi-timestamp split)');
  }
  if (!parsedLrc.cues[0].t.includes('تاریکی')) {
    throw new Error('LRC translation split failed');
  }
  if (!parsedLrc.cues[1].words || parsedLrc.cues[1].words.length < 4) {
    throw new Error('Enhanced LRC word timing parsing failed');
  }
  console.log('LRC parsing passed with words:', parsedLrc.cues[1].words);

  // 3. SRT test
  const srtText = `
1
00:01:20,000 --> 00:01:23,500
Walking through the neon rain
قدم زدن در باران نئونی

2
00:01:24,000 --> 00:01:28,000
Shadows fade and break the chain
سایه‌ها محو می‌شوند
  `;
  const parsedSrt = parseSrt(srtText);
  if (parsedSrt.cues.length !== 2) throw new Error('SRT parse count mismatch');
  if (parsedSrt.cues[0].s !== 80 || parsedSrt.cues[0].e !== 83.5) throw new Error('SRT timestamp mismatch');
  if (!parsedSrt.cues[0].t.includes('باران')) throw new Error('SRT translation mismatch');
  console.log('SRT parsing passed');

  // 4. VTT test
  const vttText = `WEBVTT

00:01.000 --> 00:04.000
Line one // ترجمه یک

00:04.500 --> 00:08.000
Line two // ترجمه دو
`;
  const parsedVtt = parseVtt(vttText);
  if (parsedVtt.cues.length !== 2) throw new Error('VTT parse count mismatch');
  console.log('VTT parsing passed');

  // 5. ASS test
  const assText = `[Script Info]
Title: Test ASS

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:10.00,0:01:15.00,Default,,0,0,0,,{\\k50}First line\\Nترجمه خط اول
Dialogue: 0,0:01:16.00,0:01:20.00,Default,,0,0,0,,Second line
`;
  const parsedAss = parseAss(assText);
  if (parsedAss.cues.length !== 2) throw new Error('ASS parse count mismatch');
  if (parsedAss.cues[0].o !== 'First line' || parsedAss.cues[0].t !== 'ترجمه خط اول') {
    throw new Error('ASS style override strip or newline split failed');
  }
  console.log('ASS parsing passed');

  // 6. In-place edit test
  updateCue(parsedAss.cues, 0, { o: 'Edited line', s: 71.5, e: 76.2 });
  if (parsedAss.cues[0].o !== 'Edited line' || parsedAss.cues[0].s !== 71.5) {
    throw new Error('updateCue failed');
  }
  console.log('updateCue passed');

  // 7. Exporter test
  const exportedLrc = exportLrc(parsedLrc.cues, { title: 'Test' });
  if (!exportedLrc.includes('[02:34.00]') || !exportedLrc.includes('[ti:Test]')) {
    throw new Error('exportLrc failed');
  }
  const exportedSrt = exportSrt(parsedLrc.cues);
  if (!exportedSrt.includes('-->')) {
    throw new Error('exportSrt failed');
  }
  console.log('Exporting passed');

  console.log('ALL LYRICS PARSER TESTS PASSED!');
}

try {
  testLyricsParser();
} catch (e) {
  console.error('Test error:', e);
  process.exit(1);
}
