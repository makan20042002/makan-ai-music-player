/*
 * tr-llm.js - pure helpers for engines that are language models (Ollama, TranslateGemma, and any
 * OpenAI-compatible server later). No network, no DOM, no storage. Adds only window.MakanTr.trLlm.
 *
 *  - gemmaPrompt(...)       the exact TranslateGemma prompt (plain-text answer, one text per request)
 *  - joinNumbered / parseNumbered     several short cues in one request, split by lines "<<<n>>>"
 *  - cleanReply(text, orig)           takes off quotes and labels such as "Translation:"
 *  - jsonSystem / parseJsonArray      other models: ask for a JSON array with exactly N strings
 *  - translateGemma(ask, lines, lang) / translateJson(ask, lines, lang)    the two ways to run a batch
 *
 * `ask({ system?, prompt, signal })` is the engine's one web request; it returns the model's text.
 * Both runners return one string per input line, or throw. A batch whose answer does not match is retried
 * one line at a time, so a wrong count never reaches the subtitles.
 */
(function () {
  'use strict';
  var S = (window.MakanTr = window.MakanTr || {});

  function isTranslateGemma(modelName) {
    return /translategemma/i.test(String(modelName || ''));
  }

  // The official prompt, word for word. text = what to translate.
  function gemmaPrompt(srcName, srcCode, tgtName, tgtCode, text) {
    return 'You are a professional ' + srcName + ' (' + srcCode + ') to ' + tgtName + ' (' + tgtCode + ') translator. ' +
      'Your goal is to accurately convey the meaning and nuances of the original ' + srcName + ' text while adhering to ' +
      tgtName + ' grammar, vocabulary, and cultural sensitivities. ' +
      'Produce only the ' + tgtName + ' translation, without any additional explanations or commentary. ' +
      'Please translate the following ' + srcName + ' text into ' + tgtName + ':\n\n' + text;
  }

  // ---------- several cues in one request ----------
  function joinNumbered(lines) {
    return lines.map(function (l, i) { return '<<<' + (i + 1) + '>>>\n' + l; }).join('\n');
  }
  // -> array of n strings, or null when the answer does not have exactly the markers 1..n in order
  function parseNumbered(reply, n) {
    var text = stripThink(reply).replace(/\r\n?/g, '\n');
    var re = /^[ \t]*<<<\s*(\d+)\s*>>>[ \t]*$/gm;
    var marks = [];
    var m;
    while ((m = re.exec(text))) marks.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length });
    if (marks.length !== n) return null;
    var out = [];
    for (var i = 0; i < n; i++) {
      if (marks[i].n !== i + 1) return null;
      var to = i + 1 < n ? marks[i + 1].start : text.length;
      out.push(text.slice(marks[i].end, to).replace(/^\n/, '').replace(/\s+$/, ''));
    }
    return out;
  }

  // Models that think aloud put it between <think> tags; that is never part of the translation.
  function stripThink(s) { return String(s == null ? '' : s).replace(/<think>[\s\S]*?<\/think>/gi, ''); }

  // ---------- cleaning ----------
  var LABEL_RE = /^\s*(?:here is the translation|here's the translation|translation|translated text|translated|output|answer)\s*[:：]\s*/i;
  var QUOTE_PAIRS = [['"', '"'], ['“', '”'], ['«', '»'], ["'", "'"], ['‘', '’']];
  function wrappedBy(s, pair) {
    if (s.length < 2 || s.charAt(0) !== pair[0] || s.charAt(s.length - 1) !== pair[1]) return false;
    var inner = s.slice(1, -1);
    return inner.indexOf(pair[0]) < 0 && inner.indexOf(pair[1]) < 0;
  }
  // orig = the text that was translated. Quotes are kept when the original itself was in quotes.
  function cleanReply(text, orig) {
    var s = stripThink(text).trim();
    var fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(s);
    if (fence) s = fence[1].trim();
    s = s.replace(LABEL_RE, '').trim();
    var o = String(orig == null ? '' : orig).trim();
    for (var i = 0; i < QUOTE_PAIRS.length; i++) {
      if (wrappedBy(s, QUOTE_PAIRS[i]) && !wrappedBy(o, QUOTE_PAIRS[i])) { s = s.slice(1, -1).trim(); break; }
    }
    return s;
  }

  // ---------- JSON array for models that are not TranslateGemma ----------
  function jsonSystem(srcName, tgtName) {
    return 'You translate subtitles from ' + srcName + ' to ' + tgtName + '. ' +
      'The user message is a JSON array of strings, one string per subtitle. ' +
      'Reply with ONLY a JSON array of strings: exactly the same number of items, in the same order, ' +
      'item i being the translation of item i. Keep every line break (\\n) of an item inside that item, ' +
      'in the matching place. Never merge, split, drop or add items. Do not explain anything.';
  }
  // -> array of n strings, or null
  function parseJsonArray(text, n) {
    var s = stripThink(text).trim();
    var fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(s);
    if (fence) s = fence[1].trim();
    function tryParse(str) { try { return JSON.parse(str); } catch (e) { return undefined; } }
    var v = tryParse(s);
    if (v === undefined) {
      var a = s.indexOf('[');
      var b = s.lastIndexOf(']');
      if (a >= 0 && b > a) v = tryParse(s.slice(a, b + 1));
    }
    if (v && !Array.isArray(v) && typeof v === 'object') {
      var k = ['translations', 'translation', 'result', 'results', 'items'].filter(function (x) { return Array.isArray(v[x]); })[0];
      if (k) v = v[k];
    }
    if (!Array.isArray(v) || v.length !== n) return null;
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var x = v[i];
      if (x && typeof x === 'object') x = 'text' in x ? x.text : 't' in x ? x.t : null;
      if (typeof x !== 'string') return null;
      out.push(x);
    }
    return out;
  }

  // ---------- runners ----------
  function abortedError() {
    var e = new Error('Cancelled');
    e.name = 'AbortError';
    e.code = 'aborted';
    return e;
  }
  function check(signal) { if (signal && signal.aborted) throw abortedError(); }

  // lang = { srcName, srcCode, tgtName, tgtCode }
  async function translateGemma(ask, lines, lang, signal) {
    function one(text) {
      return ask({ prompt: gemmaPrompt(lang.srcName, lang.srcCode, lang.tgtName, lang.tgtCode, text), signal: signal })
        .then(function (r) { return cleanReply(r, text); });
    }
    if (lines.length > 1) {
      check(signal);
      var reply = await ask({ prompt: gemmaPrompt(lang.srcName, lang.srcCode, lang.tgtName, lang.tgtCode, joinNumbered(lines)), signal: signal });
      var parsed = parseNumbered(reply, lines.length);
      if (parsed) return parsed.map(function (p, i) { return cleanReply(p, lines[i]); });
    }
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      check(signal);
      out.push(await one(lines[i]));
    }
    return out;
  }

  // lang = { srcName, tgtName }
  async function translateJson(ask, lines, lang, signal) {
    var system = jsonSystem(lang.srcName, lang.tgtName);
    for (var attempt = 0; attempt < 2 && lines.length > 1; attempt++) {
      check(signal);
      var reply = await ask({ system: system, prompt: JSON.stringify(lines), signal: signal });
      var arr = parseJsonArray(reply, lines.length);
      if (arr) return arr;
    }
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      check(signal);
      var r = await ask({ system: system, prompt: JSON.stringify([lines[i]]), signal: signal });
      var one = parseJsonArray(r, 1);
      out.push(one ? one[0] : cleanReply(r, lines[i]));
    }
    return out;
  }

  S.trLlm = Object.freeze({
    isTranslateGemma: isTranslateGemma, gemmaPrompt: gemmaPrompt,
    joinNumbered: joinNumbered, parseNumbered: parseNumbered, cleanReply: cleanReply,
    jsonSystem: jsonSystem, parseJsonArray: parseJsonArray,
    translateGemma: translateGemma, translateJson: translateJson
  });
})();
