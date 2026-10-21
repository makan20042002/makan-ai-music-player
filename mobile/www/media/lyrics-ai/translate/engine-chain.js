/*
 * shell/engine-chain.js - STANDALONE ONLY. Ordered fallback chain of translation engines.
 * Needs shell/tr-core.js (and optionally engine-adapter.js for finishText). Adds window.MakanTr.engineChain.
 *
 *   create(cfg) -> { translateCues, lastRun }      translateCues has the SAME contract as host.translateCues:
 *       translateCues(cues, { src, tgt, onProgress, signal, onInfo }) -> Promise<cues>
 *   The cues keep their count and their timing (s, e) and original text (o); only t is filled.
 *
 * An engine is  { id, name, kind:'offline'|'online', model?, licence?, budgetId?,
 *                 translate(lines[], { src, tgt, signal, onInfo, onProgress }) -> Promise<string[]> }
 *   It must return one string per input line. Errors may carry .reason (rate | blocked | server | timeout |
 *   network | html | count | empty | failed), .retryAfterMs, or an engine-adapter .code.
 *
 * What the chain does:
 *   - protects tags / notes / dashes / line breaks (tr-core) and answers repeated lines from the memory;
 *   - sends the rest in batches to the first engine in the user's order that is not "cooling down";
 *   - when an engine fails (429/403/5xx, HTML reply, wrong count, empty answer, timeout, network) it rests
 *     (30 s, 2 min, 10 min) and the SAME batch goes to the next engine. Nothing is lost, nothing restarts;
 *   - an engine that can never work for this job (no key, wrong key, language not supported, model not
 *     downloaded) is skipped for the rest of the job;
 *   - when every engine rests, it waits for the first one to be ready again (Cancel works at any time);
 *   - tells which engine translated what, and why it switched (onInfo: switched, used, waitingMs).
 * Config: getEngines() -> engines, getOrder() -> ids to use (in order), memory, cooldown, sleep, random,
 *   budgetFor(id) (tests), finishText, wrapLines.
 */
(function () {
  'use strict';
  var NS = (window.MakanTr = window.MakanTr || {});

  var PERSISTENT = { nokey: 1, badkey: 1, unsupported: 1, notdownloaded: 1, nomodel: 1, notrunning: 1 };

  function makeError(code, message, partial) {
    var e = new Error(message || code);
    e.name = code === 'aborted' ? 'AbortError' : 'TranslateError';
    e.code = code;
    if (partial) e.partial = partial;
    return e;
  }

  // Why an engine error counts as a failure (a short code the page can explain).
  function reasonOf(err) {
    if (err && typeof err.reason === 'string') return err.reason;
    var c = err && err.code;
    if (c === 'rate') return 'rate';
    if (c === 'network') return 'network';
    if (c === 'timeout') return 'timeout';
    if (c === 'badreply') return 'count';
    if (c === 'blocked') return 'blocked';
    if (c === 'nokey' || c === 'badkey' || c === 'unsupported' || c === 'notdownloaded' || c === 'nomodel' || c === 'notrunning') return c;
    return 'failed';
  }

  // ---------- pure order helpers (the settings list uses them) ----------
  // stored: { order:[ids], off:[ids] } or anything. Unknown ids are dropped, new ids are added at the end.
  function normalizeOrder(stored, knownIds) {
    var order = [];
    var off = [];
    if (stored && Array.isArray(stored.order)) {
      stored.order.forEach(function (id) {
        if (knownIds.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id);
      });
    }
    knownIds.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    if (stored && Array.isArray(stored.off)) {
      stored.off.forEach(function (id) { if (order.indexOf(id) >= 0 && off.indexOf(id) < 0) off.push(id); });
    }
    return { order: order, off: off };
  }
  function moveItem(list, from, to) {
    var out = list.slice();
    if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
    var item = out.splice(from, 1)[0];
    out.splice(to, 0, item);
    return out;
  }
  function activeIds(state) {
    return state.order.filter(function (id) { return state.off.indexOf(id) < 0; });
  }

  // ---------- the chain ----------
  function create(cfg) {
    cfg = cfg || {};
    var C = NS.trCore;
    if (!C) throw new Error('tr-core.js must be loaded before engine-chain.js');
    var memory = cfg.memory || C.createMemory();
    var cooldown = cfg.cooldown || C.createCooldown();
    var random = cfg.random || Math.random;
    var setTimer = cfg.setTimer || function (fn, ms) { return window.setTimeout(fn, ms); };
    var clearTimer = cfg.clearTimer || function (h) { window.clearTimeout(h); };
    var budgetFor = cfg.budgetFor || C.budgetFor;
    var finishText = cfg.finishText || (NS.engineAdapter && NS.engineAdapter.finishText) || function (orig, tr) { return String(tr == null ? '' : tr).trim(); };
    var last = null;

    function sleep(ms, signal) {
      if (cfg.sleep) return cfg.sleep(ms, signal);
      return new Promise(function (resolve, reject) {
        if (signal && signal.aborted) { reject(makeError('aborted', 'Cancelled')); return; }
        var h = setTimer(function () { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        function onAbort() { clearTimer(h); reject(makeError('aborted', 'Cancelled')); }
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    async function translateCues(cues, o) {
      o = o || {};
      if (!Array.isArray(cues)) throw makeError('failed', 'cues must be an array');
      if (!o.tgt) throw makeError('failed', 'no target language');
      var signal = o.signal;
      var out = cues.map(function (c) { return { s: c.s, e: c.e, o: String(c.o == null ? '' : c.o), t: '' }; });
      var src = o.src || null;
      var srcKey = src || 'auto';

      var work = [];
      out.forEach(function (c, i) { if (c.o.trim()) work.push(i); });
      var total = work.length;
      var prots = work.map(function (i) { return C.protectCue(out[i].o); });
      var results = {}; // unique index -> translated core
      var uniqueOf = []; // work position -> unique index (-1: only tags, copied)
      var copied = {};  // work position -> true (only tags / notes: the original is the translation)
      var done = 0;
      var usage = {};   // engine id -> cues translated
      var info = null;
      var currentId = null;

      function snapshot() {
        assemble();
        return out.map(function (c) { return { s: c.s, e: c.e, o: c.o, t: c.t }; });
      }
      function assemble() {
        work.forEach(function (i, w) {
          if (copied[w]) { out[i].t = out[i].o; return; }
          var u = uniqueOf[w];
          if (u !== undefined && u >= 0 && results[u] !== undefined) {
            out[i].t = C.restoreCue(finishText(prots[w].core, results[u], cfg.wrapLines), prots[w]);
          }
        });
      }
      function publish(extra) {
        if (!info) return;
        info = Object.assign({}, info, extra || {});
        info.used = Object.keys(usage).map(function (id) { return { id: id, name: nameOf[id] || id, count: usage[id] }; });
        if (typeof o.onInfo === 'function') {
          try { o.onInfo(JSON.parse(JSON.stringify(info))); } catch (e) { /* the host's problem */ }
        }
      }
      function report(stage, fraction) {
        if (typeof o.onProgress === 'function') {
          o.onProgress({ stage: stage, fraction: fraction, done: done, total: total, engine: currentId });
        }
      }
      function aborted() { return !!(signal && signal.aborted); }
      function abortErr() { return makeError('aborted', 'Cancelled', snapshot()); }

      var nameOf = {};
      if (aborted()) throw abortErr();
      if (total === 0) { report('translate', 1); return out; }
      if (src && src === o.tgt) {
        info = { id: 'copy', kind: 'none', name: '' };
        publish();
        work.forEach(function (i) { out[i].t = out[i].o; });
        done = total;
        report('translate', 1);
        return out;
      }

      // tags-only cues are copied; the others are de-duplicated by their words
      uniqueOf = [];
      var cores = [];
      var withText = [];
      work.forEach(function (i, w) {
        if (!C.hasText(prots[w])) { copied[w] = true; done += 1; uniqueOf[w] = -1; return; }
        withText.push(w);
      });
      var d = C.dedupe(withText.map(function (w) { return prots[w].core; }));
      withText.forEach(function (w, k) { uniqueOf[w] = d.indexOf[k]; });
      var perUnique = d.unique.map(function () { return 0; });
      withText.forEach(function (w) { perUnique[uniqueOf[w]] += 1; });
      cores = d.unique;

      // the memory answers what it already knows (this is also how a stopped job resumes)
      var pending = [];
      cores.forEach(function (core, u) {
        var hit = memory.get(srcKey, o.tgt, core);
        if (hit !== null) { results[u] = hit; done += perUnique[u]; } else { pending.push(u); }
      });
      report('translate', done / total);

      var engines = (typeof cfg.getEngines === 'function' ? cfg.getEngines() : []) || [];
      var byId = {};
      engines.forEach(function (e) { byId[e.id] = e; nameOf[e.id] = e.name; });
      var order = (typeof cfg.getOrder === 'function' ? cfg.getOrder() : engines.map(function (e) { return e.id; }))
        .filter(function (id) { return !!byId[id]; });
      if (pending.length > 0 && order.length === 0) throw makeError('failed', 'no engine is switched on', snapshot());

      var excluded = {};
      var made = {}; // requests per engine in this job (pacing)
      var lastFail = null;
      var lastPersistent = null;

      while (pending.length > 0) {
        if (aborted()) throw abortErr();
        var chosen = null;
        for (var a = 0; a < order.length && !chosen; a++) {
          var id0 = order[a];
          if (!excluded[id0] && !cooldown.isCooling(id0)) chosen = byId[id0];
        }
        if (!chosen) {
          var left = order.filter(function (id) { return !excluded[id]; });
          if (left.length === 0) {
            memory.save();
            throw makeError(lastPersistent || 'failed', 'no engine could translate this', snapshot());
          }
          var wait = Math.min.apply(null, left.map(function (id) { return cooldown.remainingMs(id); }));
          publish({ waitingMs: wait });
          try { await sleep(Math.max(1, wait), signal); } catch (e) { throw abortErr(); }
          publish({ waitingMs: 0 });
          continue;
        }

        if (currentId !== chosen.id) {
          var sw = lastFail && lastFail.id !== chosen.id ? { from: nameOf[lastFail.id] || lastFail.id, reason: lastFail.reason } : null;
          currentId = chosen.id;
          info = { id: chosen.id, kind: chosen.kind || 'offline', name: chosen.name, model: chosen.model || '', licence: chosen.licence || '', waitingMs: 0 };
          publish(sw ? { switched: sw } : null);
        }
        lastFail = null;

        var budget = budgetFor(chosen.budgetId || chosen.id) || { maxChars: 1500, maxItems: 10, timeoutMs: 0 };
        var texts = pending.map(function (u) { return cores[u]; });
        var idx = C.batchByBudget(texts, budget)[0];
        var batchUnique = idx.map(function (p) { return pending[p]; });
        var batchTexts = batchUnique.map(function (u) { return cores[u]; });

        if (made[chosen.id]) {
          try { await sleep(C.pacingDelay(chosen.budgetId || chosen.id, random), signal); } catch (e) { throw abortErr(); }
          if (aborted()) throw abortErr();
        }
        made[chosen.id] = (made[chosen.id] || 0) + 1;

        // one request, with its own time limit; Cancel and the time limit both stop it
        var rc = new AbortController();
        var timedOut = false;
        var timer = null;
        function onOuterAbort() { rc.abort(); }
        if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });
        try {
          var req = chosen.translate(batchTexts, {
            src: src, tgt: o.tgt, signal: rc.signal,
            onInfo: function (extra) { if (extra && info && currentId === chosen.id) publish({ device: extra.device, model: extra.model || info.model }); },
            onProgress: function (p) { if (p && p.stage === 'load') report('load', typeof p.fraction === 'number' ? p.fraction : null); }
          });
          var racers = [Promise.resolve(req)];
          if (budget.timeoutMs) {
            racers.push(new Promise(function (resolve, reject) {
              timer = setTimer(function () {
                timedOut = true;
                rc.abort();
                var te = new Error('timeout');
                te.reason = 'timeout';
                reject(te);
              }, budget.timeoutMs);
            }));
          }
          var outputs = await Promise.race(racers);
          var bad = C.checkReply(batchTexts, outputs);
          if (bad) { var be = new Error('bad reply: ' + bad); be.reason = bad; throw be; }
          batchUnique.forEach(function (u, k) {
            results[u] = String(outputs[k]);
            memory.set(srcKey, o.tgt, cores[u], String(outputs[k]));
            done += perUnique[u];
            usage[chosen.id] = (usage[chosen.id] || 0) + perUnique[u];
          });
          pending = pending.filter(function (u) { return batchUnique.indexOf(u) < 0; });
          cooldown.success(chosen.id);
          memory.save();
          publish();
          report('translate', done / total);
          if (typeof o.onBatch === 'function') {
            try { o.onBatch({ engine: chosen.id, name: chosen.name, count: batchUnique.length, done: done, total: total }); } catch (e) { /* the host's problem */ }
          }
        } catch (err) {
          if (aborted()) { memory.save(); throw abortErr(); }
          var code = err && err.code;
          var reason = timedOut ? 'timeout' : reasonOf(err);
          if (code && PERSISTENT[code]) {
            excluded[chosen.id] = true;
            lastPersistent = code;
          } else {
            cooldown.fail(chosen.id, { retryAfterMs: (err && err.retryAfterMs) || 0 });
          }
          lastFail = { id: chosen.id, reason: reason };
          currentId = null; // the next batch announces a switch (or the same engine again)
        } finally {
          if (timer !== null) clearTimer(timer);
          if (signal) signal.removeEventListener('abort', onOuterAbort);
        }
      }

      memory.save();
      assemble();
      publish();
      last = { usage: Object.assign({}, usage) };
      report('translate', 1);
      return out;
    }

    return {
      translateCues: translateCues,
      lastRun: function () { return last ? { usage: Object.assign({}, last.usage) } : null; }
    };
  }

  // Makes an engine-adapter based choice (offline model, Gemini) usable as a chain member.
  // selectId(id) tells the adapter which engine the next call is for.
  function wrapAdapter(adapter, selectId, def) {
    return {
      id: def.id, name: def.name, kind: def.kind, model: def.model || '', licence: def.licence || '',
      budgetId: def.budgetId || def.id,
      translate: async function (lines, o) {
        selectId(def.id);
        var cues = lines.map(function (l) { return { s: 0, e: 1, o: l, t: '' }; });
        var res = await adapter.translateCues(cues, {
          src: o.src, tgt: o.tgt, signal: o.signal,
          onInfo: o.onInfo, onProgress: o.onProgress
        });
        return res.map(function (c) { return c.t; });
      }
    };
  }

  NS.engineChain = {
    create: create, wrapAdapter: wrapAdapter,
    normalizeOrder: normalizeOrder, moveItem: moveItem, activeIds: activeIds, reasonOf: reasonOf,
    PERSISTENT: PERSISTENT
  };
})();
