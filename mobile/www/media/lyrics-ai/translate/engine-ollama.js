/*
 * shell/engine-ollama.js - STANDALONE ONLY. The Ollama engine for the fallback chain.
 * Needs tr-core.js and tr-llm.js. Adds only window.MakanTr.engineOllama.
 *
 *   create({ fetchFn, getModel, hosts?, port? }) -> { engine, listModels(signal), isTranslateGemma(name), lastBase() }
 *
 * Ollama is a program on the same computer (default port 11434). The page tries 127.0.0.1 first, then
 * localhost, and remembers the one that answered. Nothing here leaves the computer. Addresses are built
 * from parts on purpose: this app keeps its web addresses in its config files only, and this one is local.
 *
 *  - listModels      GET /api/tags -> [{ name, size }]   (the model picker)
 *  - a model whose name contains "translategemma" is a dedicated translator: POST /api/generate with the
 *    official prompt, plain-text answer, several cues per request split by <<<n>>>, one by one if that fails.
 *  - any other model: POST /api/chat, asks for a JSON array with exactly N strings, retries once, then
 *    one cue at a time.
 *  Both keep the model loaded for 30 minutes (keep_alive).
 * Errors have .code:  notrunning (Ollama does not answer) | nomodel (the model is not installed) |
 *   unsupported (language not in the table) | aborted | failed, and .reason (server | http | empty) when known.
 */
(function () {
  'use strict';
  var S = (window.MakanTr = window.MakanTr || {});

  var KEEP_ALIVE = '30m';
  var DEFAULT_HOSTS = ['127.0.0.1', 'localhost'];
  var DEFAULT_PORT = 11434;

  function coded(code, message, reason) {
    var e = new Error(message || code);
    e.name = code === 'aborted' ? 'AbortError' : 'TranslateError';
    e.code = code;
    if (reason) e.reason = reason;
    return e;
  }

  function create(cfg) {
    cfg = cfg || {};
    var C = S.trCore;
    var L = S.trLlm;
    if (!C || !L) throw new Error('tr-core.js and tr-llm.js must be loaded before engine-ollama.js');
    var fetchFn = cfg.fetchFn || function (u, i) { return window.fetch(u, i); };
    var port = cfg.port || DEFAULT_PORT;
    var bases = (cfg.hosts || DEFAULT_HOSTS).map(function (h) { return 'http' + ':' + '//' + h + ':' + port; });
    var good = null;

    function order() {
      return good ? [good].concat(bases.filter(function (b) { return b !== good; })) : bases.slice();
    }

    async function request(method, path, body, signal) {
      var list = order();
      for (var i = 0; i < list.length; i++) {
        if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
        try {
          var init = { method: method, signal: signal };
          if (body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
          var res = await fetchFn(list[i] + path, init);
          good = list[i];
          return res;
        } catch (e) {
          if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
          // not reachable on this address: try the next one
        }
      }
      throw coded('notrunning', 'Ollama is not running');
    }

    async function readJson(res) {
      if (!res.ok) {
        var msg = '';
        try { msg = String((JSON.parse(await res.text()) || {}).error || ''); } catch (e) { msg = ''; }
        if (res.status === 404 || /not found/i.test(msg)) throw coded('nomodel', msg || 'model not found');
        throw coded('failed', 'Ollama: HTTP ' + res.status, res.status >= 500 ? 'server' : 'http');
      }
      var j;
      try { j = await res.json(); } catch (e) { throw coded('failed', 'Ollama sent an unreadable answer', 'empty'); }
      if (j && j.error) {
        if (/not found/i.test(String(j.error))) throw coded('nomodel', String(j.error));
        throw coded('failed', String(j.error), 'http');
      }
      return j || {};
    }

    async function listModels(signal) {
      var j = await readJson(await request('GET', '/api/tags', null, signal));
      var list = Array.isArray(j.models) ? j.models : [];
      return list
        .map(function (m) { return { name: String((m && (m.name || m.model)) || ''), size: m && typeof m.size === 'number' ? m.size : 0 }; })
        .filter(function (m) { return m.name; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function makeAsk(model, mode) {
      return async function ask(o) {
        var path;
        var body;
        if (mode === 'generate') {
          path = '/api/generate';
          body = { model: model, prompt: o.prompt, stream: false, keep_alive: KEEP_ALIVE, options: { temperature: 0.1 } };
        } else {
          path = '/api/chat';
          body = {
            model: model,
            messages: [{ role: 'system', content: o.system || '' }, { role: 'user', content: o.prompt }],
            stream: false, keep_alive: KEEP_ALIVE, options: { temperature: 0.2 }
          };
        }
        var j = await readJson(await request('POST', path, body, o.signal));
        var text = mode === 'generate' ? j.response : j.message && j.message.content;
        if (typeof text !== 'string') throw coded('failed', 'Ollama sent no text', 'empty');
        return text;
      };
    }

    var engine = {
      id: 'ollama',
      kind: 'offline',
      get name() { return 'Ollama'; },
      get model() { return cfg.getModel() || ''; },
      get budgetId() { return L.isTranslateGemma(cfg.getModel()) ? 'translategemma' : 'ollama'; },
      translate: async function (lines, o) {
        o = o || {};
        var model = cfg.getModel();
        if (!model) throw coded('nomodel', 'no Ollama model is chosen');
        var tgt = C.langInfo(o.tgt);
        if (!tgt) throw coded('unsupported', 'language not in the table: ' + o.tgt);
        var src = o.src ? C.langInfo(o.src) : null;
        if (L.isTranslateGemma(model)) {
          if (!src) throw coded('unsupported', 'TranslateGemma needs the original language');
          return L.translateGemma(makeAsk(model, 'generate'), lines,
            { srcName: src.name, srcCode: src.code, tgtName: tgt.name, tgtCode: tgt.code }, o.signal);
        }
        return L.translateJson(makeAsk(model, 'chat'), lines,
          { srcName: src ? src.name : 'the original language (detect it)', tgtName: tgt.name }, o.signal);
      }
    };

    return {
      engine: engine,
      listModels: listModels,
      isTranslateGemma: L.isTranslateGemma,
      lastBase: function () { return good; }
    };
  }

  S.engineOllama = Object.freeze({ create: create, KEEP_ALIVE: KEEP_ALIVE, DEFAULT_HOSTS: DEFAULT_HOSTS.slice(), DEFAULT_PORT: DEFAULT_PORT });
})();
