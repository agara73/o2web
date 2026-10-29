'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_net.js - rete su richiesta (src/netfetch.js): controllo dell'indirizzo, scarico con un fetch FINTO (nessuna richiesta vera: nel sandbox archive.org non si
// raggiunge e i test non devono dipendere dalla rete), limiti di byte, attesa, annullamento, reindirizzamenti, errori; piu' i controlli statici: nessun altro
// modulo usa API di rete, la regola di sicurezza della pagina (CSP) e' quella prevista e uguale in vercel.json, il modulo caricato non fa richieste.
const fs = require('fs');
const path = require('path');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');
const SP = (n) => path.join(SRC, n);
const ROOT = path.join(__dirname, '..');
const N = require(SP('netfetch.js'));
const B = require(process.env.O2_BUILD_JS || path.join(ROOT, 'tools', 'build.js'));

let fails = 0, checks = 0, finished = false;
// se una promessa non si risolve, Node esce in silenzio con codice 0: qui diventa un fallimento
process.on('exit', (c) => { if (!finished && c === 0) { console.log('FALLITO: il test si e\' interrotto senza finire (promessa mai risolta)'); process.exitCode = 1; } });
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const eqj = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));

// ---- fetch finto
const u8 = (...a) => new Uint8Array(a);
function abortErr() { const e = new Error('The operation was aborted'); e.name = 'AbortError'; return e; }
// risposta con corpo a pezzi; stall: dopo i pezzi il lettore resta in attesa finche' non scatta l'abort
function makeResp(o) {
  const r = {ok: o.status === undefined || (o.status >= 200 && o.status < 300), status: o.status === undefined ? 200 : o.status, url: o.url === undefined ? '' : o.url,
    headers: {get: (k) => (o.headers && o.headers[String(k).toLowerCase()] !== undefined ? o.headers[String(k).toLowerCase()] : null)}};
  r.cancelled = 0;
  if (o.noBody) {
    if (o.arrayBuffer) r.arrayBuffer = async () => o.arrayBuffer;
    return r;
  }
  const chunks = (o.chunks || []).slice();
  r.body = {getReader: () => ({
    read: () => new Promise((res, rej) => {
      if (chunks.length) { const c = chunks.shift(); setTimeout(() => res({done: false, value: c}), 0); return; }
      if (o.stall) { if (o.signal) { if (o.signal.aborted) rej(abortErr()); else o.signal.addEventListener('abort', () => rej(abortErr()), {once: true}); } return; }
      setTimeout(() => res({done: true}), 0);
    }),
    cancel: () => { r.cancelled++; },
  })};
  return r;
}
function fakeFetch(make) {
  const f = async (url, init) => {
    f.calls.push({url, init});
    return make(url, init, f.calls.length);
  };
  f.calls = [];
  return f;
}
// timer finti: i callback scattano a mano
function fakeTimers() {
  const t = {list: [], nextId: 1, set(fn, ms) { const id = t.nextId++; t.list.push({id, fn, ms}); return id; }, clear(id) { t.list = t.list.filter((x) => x.id !== id); },
    fire() { const x = t.list.shift(); if (x) x.fn(); return !!x; }};
  return t;
}
async function fails2(p) { try { await p; return null; } catch (e) { return e; } }

(async () => {
  // ---------------------------------------------------------------- checkUrl
  {
    const g = N.checkUrl('https://archive.org/download/Item/File%20One.zip');
    eqj([g.ok, g.url, g.host], [true, 'https://archive.org/download/Item/File%20One.zip', 'archive.org'], 'indirizzo valido');
    eqj(N.checkUrl('  https://archive.org/x.zip \n').url, 'https://archive.org/x.zip', 'spazi attorno tolti');
    eqj(N.checkUrl('archive.org/download/x.zip').url, 'https://archive.org/download/x.zip', 'senza schema: si aggiunge https://');
    eqj(N.checkUrl('HTTPS://Archive.ORG/x.zip').url, 'https://archive.org/x.zip', 'schema maiuscolo, sito in minuscolo');
    eqj(N.checkUrl('https://a.org/x.zip#pezzo').url, 'https://a.org/x.zip', 'il frammento si toglie');
    eqj(N.checkUrl('https://a.org/x.zip?a=1&b=2').url, 'https://a.org/x.zip?a=1&b=2', 'la query resta');
    eqj([N.checkUrl('https://a.org:8443/x').ok, N.checkUrl('https://a.org:8443/x').host], [true, 'a.org:8443'], 'porta');
    const bad = [
      ['web+x://a.org/x', /non «web\+x»/], ['a-b.c://a.org/x', /non «a-b\.c»/], ['h9://a.org/x', /non «h9»/], ['h0123456789://a.org/x', /non «h0123456789»/], ['x+y-z.9://a.org/x', /non «x\+y-z\.9»/],
      [undefined, /Scrivi/], [null, /Scrivi/], ['', /Scrivi/], ['   ', /Scrivi/],
      ['http://example.com/a.zip', /serve https, non http/], ['HTTP://example.com/a.zip', /serve https, non http/],
      ['ftp://x.org/a.zip', /solo indirizzi https \(non «ftp»\)/], ['file:///etc/passwd', /solo indirizzi https \(non «file»\)/], ['blob:https://x.org/abc', /non valido|solo indirizzi/],
      ['javascript:alert(1)', /non valido/], ['data:text/html,hi', /non valido/], ['mailto:a@b.c', /nome utente o password/],
      ['https://user:pw@host.org/x', /nome utente o password/], ['https://user@host.org/x', /nome utente o password/], ['https://:pw@host.org/x', /nome utente o password/],
      ['https://', /non valido/], ['https:///x', /non valido/], ['https://exa mple.org/x', /spazi/], ['https://a.org/x\ny', /spazi/], ['https://a.org/\u0001x', /spazi/],
      ['https://a.org/' + 'x'.repeat(2048), /troppo lungo/], ['https://a b', /spazi/], ['//a.org/x', /non valido/], ['https://[::1/x', /non valido/],
    ];
    for (const [t, re] of bad) { const r = N.checkUrl(t); ok(r.ok === false && re.test(r.why), 'indirizzo rifiutato: ' + JSON.stringify(t) + ' -> ' + JSON.stringify(r)); }
    { const ne = new N.NetError('m', 'c'); ok(ne instanceof Error && ne.name === 'NetError' && ne.code === 'c' && ne.message === 'm' && new N.NetError('m').code === 'net', 'NetError: nome, codice, codice predefinito'); }
    ok(N.checkUrl('https://a.org/' + 'x'.repeat(2048 - 14)).ok, 'indirizzo lungo 2048 ammesso');
    ok(!N.checkUrl('https://a.org/' + 'x'.repeat(2048 - 13)).ok, 'indirizzo lungo 2049 rifiutato');
    ok(!('url' in N.checkUrl('ftp://x/y')), 'un indirizzo rifiutato non porta un url');
  }

  // ---------------------------------------------------------------- fileNameOf
  {
    eqj(N.fileNameOf('https://a.org/dir/Name%20One.zip'), 'Name One.zip', 'nome con %20');
    eqj(N.fileNameOf('https://a.org/dir/'), 'scaricato', 'percorso che finisce con /');
    eqj(N.fileNameOf('https://a.org'), 'scaricato', 'nessun percorso');
    eqj(N.fileNameOf('https://a.org/x/a%5Cb.zip'), 'ab.zip', 'barra rovesciata tolta');
    eqj(N.fileNameOf('https://a.org/x/a%2Fb.zip'), 'ab.zip', 'barra tolta');
    eqj(N.fileNameOf('https://a.org/x/%E0%A4%A.zip'), '%E0%A4%A.zip', 'percentuali non valide: testo grezzo');
    eqj(N.fileNameOf('https://a.org/x/a%00b%1Fc.zip'), 'abc.zip', 'caratteri di controllo tolti');
    eqj(N.fileNameOf('https://a.org/x/a%01b%0Ac%7Fd%1Ee.zip'), 'abcde.zip', 'altri caratteri di controllo e DEL tolti');
    eqj(N.fileNameOf('https://a.org/x/a+b-c.zip'), 'a+b-c.zip', '+ e - restano nel nome');
    eqj(N.fileNameOf('https://a.org/x/y.zip?z=1#q'), 'y.zip', 'query e frammento ignorati');
    eqj(N.fileNameOf('https://a.org/x/' + 'n'.repeat(300) + '.zip').length, 120, 'nome lungo tagliato a 120');
    eqj(N.fileNameOf('non un indirizzo'), 'scaricato', 'indirizzo non valido');
    eqj(N.fileNameOf('https://a.org/x/%20%20'), 'scaricato', 'solo spazi');
  }

  // ---------------------------------------------------------------- formati e messaggi
  {
    eqj([N.fmtBytes(0), N.fmtBytes(1023), N.fmtBytes(1024), N.fmtBytes(1536), N.fmtBytes(10240), N.fmtBytes(1 << 20), N.fmtBytes(3 << 19), N.fmtBytes(10 << 20), N.fmtBytes(128 << 20), N.fmtBytes(1048575), N.fmtBytes(10239), N.fmtBytes(2048)],
      ['0 byte', '1023 byte', '1.0 KB', '1.5 KB', '10 KB', '1.0 MB', '1.5 MB', '10 MB', '128 MB', '1024 KB', '10.0 KB', '2.0 KB'], 'fmtBytes');
    ok(/non esiste/.test(N.httpMessage(404, 'h.org')) && /non esiste/.test(N.httpMessage(410, 'h.org')), '404 / 410');
    ok(/negato/.test(N.httpMessage(401, 'h.org')) && /negato/.test(N.httpMessage(403, 'h.org')), '401 / 403');
    ok(/429/.test(N.httpMessage(429, 'h.org')) && /rallentare/.test(N.httpMessage(429, 'h.org')), '429');
    ok(/Errore del server/.test(N.httpMessage(500, 'h.org')) && /Errore del server/.test(N.httpMessage(503, 'h.org')), '5xx');
    ok(/errore 418/.test(N.httpMessage(418, 'h.org')) && !/non esiste/.test(N.httpMessage(418, 'h.org')), 'altro codice');
    ok(N.httpMessage(404, 'miosito.org').includes('miosito.org'), 'il messaggio nomina il sito');
  }

  // ---------------------------------------------------------------- scarico riuscito
  {
    const URL1 = 'https://archive.org/download/Item/Raccolta.zip';
    const f = fakeFetch(() => makeResp({chunks: [u8(1, 2, 3), u8(4, 5), u8(6)], headers: {'content-length': '6'}}));
    const prog = [];
    const r = await N.download(URL1, {fetch: f, onProgress: (g, t) => prog.push([g, t])});
    eqj(Array.from(r.bytes), [1, 2, 3, 4, 5, 6], 'byte uniti nell\'ordine');
    ok(r.bytes instanceof Uint8Array && r.bytes.length === 6, 'risultato Uint8Array esatto');
    eqj([r.name, r.host, r.url, r.redirected], ['Raccolta.zip', 'archive.org', URL1, false], 'nome, sito, indirizzo');
    eqj(prog, [[0, 6], [3, 6], [5, 6], [6, 6]], 'avanzamento con il totale dichiarato');
    ok(f.calls.length === 1, 'una sola richiesta');
    const c = f.calls[0];
    ok(c.url === URL1, 'indirizzo passato a fetch uguale a quello normalizzato');
    const init = c.init;
    eqj(Object.keys(init).sort(), ['cache', 'credentials', 'method', 'mode', 'redirect', 'referrerPolicy', 'signal'], 'opzioni di fetch: nessun corpo, nessuna intestazione');
    eqj([init.method, init.mode, init.credentials, init.cache, init.redirect, init.referrerPolicy], ['GET', 'cors', 'omit', 'no-store', 'follow', 'no-referrer'], 'GET anonimo, senza cookie ne\' referrer');
    ok(init.signal && typeof init.signal.aborted === 'boolean', 'fetch riceve un segnale di annullamento');
    // senza Content-Length: totale null
    const prog2 = [];
    await N.download(URL1, {fetch: fakeFetch(() => makeResp({chunks: [u8(9)]})), onProgress: (g, t) => prog2.push([g, t])});
    eqj(prog2, [[0, null], [1, null]], 'senza Content-Length il totale e\' null');
    const prog3 = [];
    await N.download(URL1, {fetch: fakeFetch(() => makeResp({chunks: [u8(9)], headers: {'content-length': 'abc'}})), onProgress: (g, t) => prog3.push(t === null)});
    eqj(prog3, [true, true], 'Content-Length non numerico ignorato (totale null)');
    for (const cl of ['12abc', '-5', '1e3', '', ' ']) {
      const pr = [];
      await N.download(URL1, {fetch: fakeFetch(() => makeResp({chunks: [u8(9)], headers: {'content-length': cl}})), onProgress: (g, t) => pr.push(t === null)});
      eqj(pr, [true, true], 'Content-Length ' + JSON.stringify(cl) + ' ignorato');
    }
    const pr2 = [];
    await N.download(URL1, {fetch: fakeFetch(() => makeResp({chunks: [u8(9)], headers: {'content-length': ' 1 '}})), onProgress: (g, t) => pr2.push(t)});
    eqj(pr2, [1, 1], 'Content-Length con spazi attorno letto');
    // risposta senza intestazioni, o con intestazioni senza get
    for (const h of [undefined, null, {}, {get: 5}]) {
      const r0 = makeResp({chunks: [u8(1, 2)]});
      r0.headers = h;
      const pr = [];
      const rr = await N.download(URL1, {fetch: async () => r0, onProgress: (g, t) => pr.push(t === null)});
      ok(rr.bytes.length === 2 && pr.every(Boolean), 'risposta senza intestazioni utilizzabili: ' + JSON.stringify(h));
    }
    // reindirizzamento: il nome e il sito vengono dall'indirizzo finale
    const rd = await N.download(URL1, {fetch: fakeFetch(() => makeResp({url: 'https://ia80.us.archive.org/9/items/Item/Raccolta%20Finale.zip?cnt=0#x', chunks: [u8(1)]}))});
    eqj([rd.redirected, rd.host, rd.name, rd.url], [true, 'ia80.us.archive.org', 'Raccolta Finale.zip', 'https://ia80.us.archive.org/9/items/Item/Raccolta%20Finale.zip?cnt=0'], 'dopo un reindirizzamento');
    const same = await N.download(URL1, {fetch: fakeFetch(() => makeResp({url: URL1, chunks: [u8(1)]}))});
    ok(same.redirected === false, 'url uguale: nessun reindirizzamento');
    // un indirizzo senza schema si normalizza prima della richiesta
    const f2 = fakeFetch(() => makeResp({chunks: [u8(1)]}));
    await N.download('archive.org/x.zip#a', {fetch: f2});
    ok(f2.calls[0].url === 'https://archive.org/x.zip', 'indirizzo normalizzato prima di fetch');
    // senza AbortController e senza segnale esterno
    const sav = globalThis.AbortController;
    globalThis.AbortController = undefined;
    const f3 = fakeFetch(() => makeResp({chunks: [u8(1)]}));
    const r3 = await N.download(URL1, {fetch: f3});
    globalThis.AbortController = sav;
    ok(r3.bytes.length === 1 && f3.calls[0].init.signal === undefined, 'senza AbortController si scarica lo stesso');
  }

  // ---------------------------------------------------------------- indirizzo rifiutato: nessuna richiesta
  {
    const f = fakeFetch(() => makeResp({chunks: [u8(1)]}));
    for (const t of ['http://a.org/x', 'ftp://a.org/x', '', 'https://u:p@a.org/x', 'javascript:alert(1)']) {
      const e = await fails2(N.download(t, {fetch: f}));
      ok(e instanceof N.NetError && e.code === 'url', 'download rifiuta ' + JSON.stringify(t));
    }
    ok(f.calls.length === 0, 'nessuna richiesta per indirizzi rifiutati');
  }

  // ---------------------------------------------------------------- reindirizzamenti pericolosi
  {
    const U = 'https://a.org/x.zip';
    for (const [url, re, m] of [['http://evil.org/x.zip', /non https/, 'http'], ['https://u:p@evil.org/x.zip', /nome utente o password/, 'credenziali'], ['non un indirizzo', /non valido/, 'non valido'], ['ftp://x.org/a', /non https/, 'ftp'], ['https://u@evil.org/x.zip', /nome utente o password/, 'solo utente'], ['https://:p@evil.org/x.zip', /nome utente o password/, 'solo password']]) {
      const e = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({url, chunks: [u8(1)]}))}));
      ok(e instanceof N.NetError && e.code === 'redirect' && re.test(e.message), 'reindirizzamento rifiutato: ' + m + ' (' + (e && e.message) + ')');
    }
  }

  // ---------------------------------------------------------------- errori HTTP
  {
    const U = 'https://a.org/x.zip';
    for (const [st, re] of [[404, /non esiste/], [403, /negato/], [429, /rallentare/], [500, /Errore del server/], [418, /errore 418/]]) {
      let sig = null;
      const e = await fails2(N.download(U, {fetch: fakeFetch((u, init) => { sig = init.signal; return makeResp({status: st, chunks: [u8(1)]}); })}));
      ok(e instanceof N.NetError && e.code === 'http' && re.test(e.message), 'HTTP ' + st + ': ' + (e && e.message));
      ok(sig.aborted, 'HTTP ' + st + ': la richiesta si chiude (abort)');
    }
  }

  // ---------------------------------------------------------------- errori di rete / CORS
  {
    const U = 'https://a.org/x.zip';
    const e = await fails2(N.download(U, {fetch: async () => { throw new TypeError('Failed to fetch'); }}));
    ok(e instanceof N.NetError && e.code === 'network', 'TypeError -> errore di rete');
    ok(/CORS/.test(e.message) && /connessione/.test(e.message) && /Aggiungi file/.test(e.message) && e.message.includes('a.org'), 'il messaggio dice CORS, connessione, la strada a mano e il sito');
    const e2 = await fails2(N.download(U, {fetch: async () => null}));
    ok(e2.code === 'network' && /non valida/.test(e2.message), 'risposta nulla');
    const e3 = await fails2(N.download(U, {fetch: async () => 5}));
    ok(e3.code === 'network', 'risposta non oggetto');
    const e4 = await fails2(N.download(U, {fetch: async () => { throw new Error('boom'); }}));
    ok(e4.code === 'network', 'errore qualsiasi di fetch -> rete');
    const e5 = await fails2(N.download(U, {fetch: async () => { throw abortErr(); }}));
    ok(e5.code === 'abort' && /annullato/.test(e5.message), 'AbortError senza richiesta dell\'utente -> annullato');
    const e6 = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({noBody: true}))}));
    ok(e6.code === 'network' && /non leggibile/.test(e6.message), 'risposta senza corpo');
    const e7 = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({chunks: ['testo']}))}));
    ok(e7.code === 'network' && /non validi/.test(e7.message), 'pezzo che non e\' Uint8Array');
    const rd = {read: async () => { throw new TypeError('network error'); }};
    const e8 = await fails2(N.download(U, {fetch: async () => ({ok: true, status: 200, url: '', headers: {get: () => null}, body: {getReader: () => rd}})}));
    ok(e8.code === 'network', 'errore durante la lettura del corpo -> rete');
  }

  // ---------------------------------------------------------------- vuoto
  {
    const U = 'https://a.org/x.zip';
    const e = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({chunks: []}))}));
    ok(e.code === 'empty' && e.message === 'Il file scaricato da a.org è vuoto.', 'corpo vuoto: ' + e.message);
    const e2 = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({chunks: [new Uint8Array(0)]}))}));
    ok(e2.code === 'empty', 'solo pezzi vuoti');
    const e3 = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({noBody: true, arrayBuffer: new ArrayBuffer(0)}))}));
    ok(e3.code === 'empty', 'arrayBuffer vuoto');
  }

  // ---------------------------------------------------------------- limiti di byte
  {
    const U = 'https://a.org/x.zip';
    let sig = null;
    const e = await fails2(N.download(U, {maxBytes: 100, fetch: fakeFetch((u, init) => { sig = init.signal; return makeResp({chunks: [u8(1)], headers: {'content-length': '101'}}); })}));
    ok(e.code === 'size' && /troppo grande/.test(e.message) && /101 byte/.test(e.message) && /100 byte/.test(e.message), 'Content-Length oltre il limite: ' + (e && e.message));
    ok(sig.aborted, 'Content-Length oltre il limite: si chiude la richiesta');
    const ok100 = await N.download(U, {maxBytes: 100, fetch: fakeFetch(() => makeResp({chunks: [new Uint8Array(100)], headers: {'content-length': '100'}}))});
    ok(ok100.bytes.length === 100, 'esattamente al limite: ammesso');
    let resp = null;
    const e2 = await fails2(N.download(U, {maxBytes: 100, fetch: fakeFetch(() => (resp = makeResp({chunks: [new Uint8Array(60), new Uint8Array(41), new Uint8Array(5)]})))}));
    ok(e2.code === 'size' && e2.message === 'Il file è troppo grande (oltre 100 byte).', 'flusso oltre il limite senza Content-Length (101 byte): ' + e2.message);
    ok(resp.cancelled === 1, 'il lettore si annulla al superamento del limite');
    const e3 = await fails2(N.download(U, {maxBytes: 100, fetch: fakeFetch(() => makeResp({noBody: true, arrayBuffer: new ArrayBuffer(101)}))}));
    ok(e3.code === 'size' && e3.message === 'Il file è troppo grande (oltre 100 byte).', 'arrayBuffer oltre il limite: ' + e3.message);
    // maxBytes 0 o assente: limite predefinito; maxBytes 1: davvero un byte
    ok((await N.download(U, {maxBytes: 0, fetch: fakeFetch(() => makeResp({chunks: [new Uint8Array(500)]}))})).bytes.length === 500, 'maxBytes 0: si usa il limite predefinito');
    const e5 = await fails2(N.download(U, {maxBytes: 1, fetch: fakeFetch(() => makeResp({chunks: [u8(1, 2)]}))}));
    ok(e5 && e5.code === 'size' && e5.message === 'Il file è troppo grande (oltre 1 byte).', 'maxBytes 1 rispettato: ' + (e5 && e5.message));
    ok((await N.download(U, {maxBytes: 1, fetch: fakeFetch(() => makeResp({chunks: [u8(1)]}))})).bytes.length === 1, 'maxBytes 1: un byte passa');
    const eh = await fails2(N.download(U, {maxBytes: 100, fetch: fakeFetch(() => makeResp({chunks: [u8(1)], headers: {'content-length': '5000'}}))}));
    ok(eh.message === 'Il file è troppo grande (4.9 KB; massimo 100 byte).', 'messaggio con Content-Length: ' + eh.message);
    const ok3 = await N.download(U, {maxBytes: 100, fetch: fakeFetch(() => makeResp({noBody: true, arrayBuffer: new Uint8Array(100).buffer}))});
    ok(ok3.bytes.length === 100, 'arrayBuffer al limite');
    ok(N.LIMITS.download === 128 << 20, 'limite predefinito 128 MB');
    const e4 = await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({chunks: [u8(1)], headers: {'content-length': String((128 << 20) + 1)}}))}));
    ok(e4.code === 'size' && /128 MB/.test(e4.message), 'limite predefinito applicato: ' + (e4 && e4.message));
    const prog = [];
    await N.download(U, {fetch: fakeFetch(() => makeResp({noBody: true, arrayBuffer: u8(1, 2).buffer})), onProgress: (g, t) => prog.push([g, t])});
    eqj(prog, [[0, null], [2, null]], 'avanzamento con arrayBuffer');
  }

  // ---------------------------------------------------------------- annullamento
  {
    const U = 'https://a.org/x.zip';
    const mkSig = () => { const l = []; return {aborted: false, added: 0, removed: 0, addEventListener(t, fn) { this.added++; l.push(fn); }, removeEventListener(t, fn) { this.removed++; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }, fire() { this.aborted = true; for (const fn of l.slice()) fn(); }}; };
    // gia' annullato: nessuna richiesta
    const f0 = fakeFetch(() => makeResp({chunks: [u8(1)]}));
    const s0 = mkSig(); s0.aborted = true;
    const e0 = await fails2(N.download(U, {fetch: f0, signal: s0}));
    ok(e0.code === 'abort' && f0.calls.length === 0, 'segnale gia\' scattato: nessuna richiesta');
    // durante l'attesa della risposta
    const s1 = mkSig();
    const f1 = async (url, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => rej(abortErr()), {once: true}); setTimeout(() => s1.fire(), 5); });
    const e1 = await fails2(N.download(U, {fetch: f1, signal: s1}));
    ok(e1.code === 'abort' && /annullato/.test(e1.message), 'annullato durante la richiesta');
    ok(s1.added === 1 && s1.removed === 1, 'l\'ascoltatore del segnale si toglie sempre');
    // durante la lettura
    const s2 = mkSig();
    let n2 = 0;
    const f2 = fakeFetch((u, init) => makeResp({chunks: [u8(1), u8(2), u8(3)], stall: true, signal: init.signal}));
    const e2 = await fails2(N.download(U, {fetch: f2, signal: s2, onProgress: (g) => { n2++; if (g === 3) s2.fire(); }}));
    ok(e2.code === 'abort', 'annullato durante la lettura (' + (e2 && e2.message) + ')');
    ok(s2.added === 1 && s2.removed === 1, 'ascoltatore tolto anche dopo l\'annullamento in lettura');
    // fetch che ignora il segnale: si ferma lo stesso al primo pezzo
    const s3 = mkSig();
    let resp3 = null;
    const f3 = fakeFetch(() => (resp3 = makeResp({chunks: [u8(1), u8(2), u8(3)]})));
    const e3 = await fails2(N.download(U, {fetch: f3, signal: s3, onProgress: (g) => { if (g === 1) s3.fire(); }}));
    ok(e3.code === 'abort', 'fetch che ignora il segnale: scarico fermato lo stesso');
    ok(resp3.cancelled === 1, 'lettore annullato');
    // segnale mai scattato: l'ascoltatore si toglie a fine scarico
    const s4 = mkSig();
    await N.download(U, {fetch: fakeFetch(() => makeResp({chunks: [u8(1)]})), signal: s4});
    ok(s4.added === 1 && s4.removed === 1, 'ascoltatore tolto a scarico finito');
    // errore HTTP con segnale: ascoltatore tolto
    const s5 = mkSig();
    await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({status: 404})), signal: s5}));
    ok(s5.removed === 1, 'ascoltatore tolto dopo un errore');
  }

  // ---------------------------------------------------------------- attesa senza dati
  {
    const U = 'https://a.org/x.zip';
    // nessuna risposta
    let t = fakeTimers();
    const f = async (url, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => rej(abortErr()), {once: true}); });
    const p = N.download(U, {fetch: f, timers: t, stallMs: 5000});
    await new Promise((r) => setTimeout(r, 5));
    eqj(t.list.map((x) => x.ms), [5000], 'un timer da stallMs mentre si aspetta la risposta');
    t.fire();
    const e = await fails2(p);
    ok(e.code === 'stalled' && /per 5 secondi: scarico interrotto/.test(e.message) && /Aggiungi file/.test(e.message) && e.message.includes('a.org'), 'attesa scaduta: ' + (e && e.message));
    eqj(t.list.length, 0, 'nessun timer rimasto');
    // 1500 ms -> «2 secondi» (arrotondato); stallMs 0 -> attesa predefinita; stallMs 1 -> 1 ms
    {
      const t2 = fakeTimers();
      const p0 = N.download(U, {fetch: f, timers: t2, stallMs: 1500});
      await new Promise((r) => setTimeout(r, 5)); t2.fire();
      const e0 = await fails2(p0);
      ok(e0.code === 'stalled' && /per 2 secondi/.test(e0.message), 'secondi arrotondati: ' + e0.message);
      const t3 = fakeTimers();
      const p3 = N.download(U, {fetch: f, timers: t3, stallMs: 0});
      await new Promise((r) => setTimeout(r, 5));
      eqj(t3.list.map((x) => x.ms), [30000], 'stallMs 0: attesa predefinita (30 secondi)');
      t3.fire(); await fails2(p3);
      const t4 = fakeTimers();
      const p4 = N.download(U, {fetch: f, timers: t4, stallMs: 1});
      await new Promise((r) => setTimeout(r, 5));
      eqj(t4.list.map((x) => x.ms), [1], 'stallMs 1: un millisecondo');
      t4.fire(); await fails2(p4);
      eqj(N.LIMITS, {url: 2048, download: 128 << 20, stallMs: 30000}, 'limiti predefiniti');
    }
    // stall nel corpo: il timer riparte a ogni pezzo
    t = fakeTimers();
    let sets = 0;
    const set0 = t.set;
    t.set = (fn, ms) => { sets++; return set0(fn, ms); };
    const f2 = fakeFetch((u, init) => makeResp({chunks: [u8(1), u8(2)], stall: true, signal: init.signal}));
    const p2 = N.download(U, {fetch: f2, timers: t, onProgress: () => {}});
    await new Promise((r) => setTimeout(r, 20));
    ok(sets >= 4, 'il timer riparte a ogni pezzo (' + sets + ' avvii)');
    eqj(t.list.length, 1, 'un solo timer attivo');
    eqj(t.list[0].ms, N.LIMITS.stallMs, 'attesa predefinita');
    t.fire();
    const e2 = await fails2(p2);
    ok(e2.code === 'stalled', 'stallo nel corpo');
    eqj(t.list.length, 0, 'nessun timer rimasto dopo lo stallo nel corpo');
    // successo: nessun timer rimasto, e ogni timer avviato e' chiuso una volta sola
    t = fakeTimers();
    let clears = 0, setN = 0;
    const tt = {set: (fn, ms) => { setN++; return t.set(fn, ms); }, clear: (id) => { clears++; t.clear(id); }};
    await N.download(U, {fetch: fakeFetch(() => makeResp({chunks: [u8(1)]})), timers: tt});
    eqj(t.list.length, 0, 'nessun timer rimasto dopo un successo');
    ok(clears === setN, 'ogni timer si cancella una volta sola (' + setN + ' avviati, ' + clears + ' cancellati)');
    // errore HTTP: nessun timer rimasto
    t = fakeTimers();
    await fails2(N.download(U, {fetch: fakeFetch(() => makeResp({status: 500})), timers: t}));
    eqj(t.list.length, 0, 'nessun timer rimasto dopo un errore');
    // fetch che ignora il segnale e il lettore: timer scattato, il primo ritorno lo vede
    t = fakeTimers();
    const f3 = fakeFetch(() => makeResp({chunks: [u8(1)]}));
    const e3 = await fails2(N.download(U, {fetch: f3, timers: t, onProgress: (g) => { if (g === 0) t.fire(); }}));
    ok(e3.code === 'stalled', 'timer scattato mentre il lettore risponde: scarico fermato');
  }

  // ---------------------------------------------------------------- fetch della pagina
  {
    const U = 'https://a.org/x.zip';
    const saved = globalThis.fetch;
    let seen = null;
    globalThis.fetch = function (url, init) { seen = {self: this, url, init}; return Promise.resolve(makeResp({chunks: [u8(7)]})); };
    const r = await N.download(U);
    ok(r.bytes[0] === 7 && seen.url === U && seen.init.credentials === 'omit', 'senza opts.fetch si usa globalThis.fetch');
    ok(seen.self === undefined || seen.self === globalThis, 'fetch della pagina chiamato senza «this» sbagliato');
    globalThis.fetch = undefined;
    const e = await fails2(N.download(U));
    ok(e.code === 'unsupported' && /Aggiungi file/.test(e.message), 'browser senza fetch');
    globalThis.fetch = saved;
  }

  // ---------------------------------------------------------------- suggerimenti
  {
    ok(N.SUGGESTED_SOURCES === undefined, 'nessun elenco di raccolte nel modulo (collegamenti rimossi)');
    // il modulo, caricato, non fa richieste
    const saved = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => { calls++; return Promise.reject(new Error('no')); };
    delete require.cache[require.resolve(SP('netfetch.js'))];
    require(SP('netfetch.js'));
    delete require.cache[require.resolve(SP('app.js'))];
    require(SP('app.js'));
    globalThis.fetch = saved;
    ok(calls === 0, 'caricare i moduli non fa nessuna richiesta di rete');
  }

  // ---------------------------------------------------------------- controllo statico: la rete sta solo in netfetch.js
  {
    const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
    ok(files.length >= 20 && files.includes('netfetch.js') && files.includes('covers.js'), 'moduli trovati (' + files.length + ')');
    for (const f of files) {
      const found = B.scanNetApis(fs.readFileSync(path.join(SRC, f), 'utf8'));
      if (f === 'netfetch.js') ok(found.includes('window.fetch') || found.includes('fetch(') || found.length > 0 || true, 'netfetch.js puo\' usare la rete');
      else ok(found.length === 0, f + ' non usa API di rete: ' + found.join(', '));
    }
    const nf = B.scanNetApis(fs.readFileSync(path.join(SRC, 'netfetch.js'), 'utf8'));
    ok(nf.length > 0, 'il controllo riconosce fetch dentro netfetch.js (e quindi funziona)');
    const uiSrc = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
    ok(!/localStorage|sessionStorage|\balert\(|\bconfirm\(/.test(uiSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')), 'ui.js: niente localStorage, alert, confirm');
    const code = (s) => B.scanNetApis(s);
    eqj(code('const r = fetch("x");'), ['fetch('], 'fetch( trovato');
    eqj(code('x = await fetch (u)'), ['fetch('], 'fetch ( trovato');
    eqj(code('window.fetch(u)'), ['window.fetch'], 'window.fetch trovato');
    ok(code("globalThis['fetch'](u)").includes('window.fetch'), "globalThis['fetch'] trovato");
    eqj(code('self.fetch(u)'), ['window.fetch'], 'self.fetch trovato');
    eqj(code('const f = fetch;'), ['fetch (riferimento)'], 'riferimento a fetch trovato');
    eqj(code('const x = new XMLHttpRequest();'), ['XMLHttpRequest'], 'XMLHttpRequest');
    eqj(code('new WebSocket("wss://x")'), ['WebSocket'], 'WebSocket');
    eqj(code('new EventSource(u)'), ['EventSource'], 'EventSource');
    eqj(code('navigator.sendBeacon(u, d)'), ['sendBeacon'], 'sendBeacon');
    eqj(code('importScripts("x")'), ['importScripts'], 'importScripts');
    eqj(code('new Worker("w.js")'), ['Worker'], 'Worker');
    eqj(code('navigator.serviceWorker.register(x)'), ['serviceWorker'], 'serviceWorker');
    eqj(code('new RTCPeerConnection()'), ['RTCPeerConnection'], 'RTCPeerConnection');
    eqj(code('const m = await import("x")'), ['import('], 'import(');
    eqj(code('eval("1")'), ['eval('], 'eval(');
    eqj(code('new Function("return 1")'), ['new Function'], 'new Function');
    eqj(code('// fetch("x") in un commento'), [], 'commento ignorato');
    eqj(code('  fetch() {\n    return 1;\n  }\n  g() { return this.fetch(); }'), [], 'metodo fetch() del nucleo e this.fetch( ammessi');
    eqj(code('const o = opts.fetch || null; run({fetch: o});'), [], 'opts.fetch e {fetch: x} ammessi');
    eqj(code('this.fetchImpl = a; async fetchUrl(u) {}'), [], 'fetchImpl e fetchUrl ammessi');
    eqj(code('fetch("x")'), ['fetch('], 'fetch( a inizio testo');
    eqj(code('import("x")'), ['import('], 'import( a inizio testo');
    eqj(code('x = (fetch(u))'), ['fetch('], '(fetch( trovato');
    eqj(code('f(a,fetch (u))'), ['fetch('], ',fetch ( trovato');
    eqj(code('const f = fetch'), ['fetch (riferimento)'], 'riferimento a fine testo');
    eqj(code('run(fetch);'), ['fetch (riferimento)'], 'fetch passato come argomento');
    for (const n of ['prefetch(u)', 'a_fetch(u)', 'a$fetch(u)', '9fetch(u)', 'Zfetch(u)', 'zfetch(u)', 'obj.fetch(u)', 'a.b.fetch(u)']) eqj(code(n), [], n + ' non e\' la fetch della pagina');
    for (const n of ['myimport(x)', 'x.import(x)', 'a_import(x)', 'Import2(x)', 'a9import(x)', 'a$import(x)']) eqj(code(n), [], n + ' non e\' import(');
    for (const ch of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$.') {
      eqj(code(ch + 'fetch(u)'), [], 'carattere «' + ch + '» davanti a fetch( : un altro nome');
      eqj(code(ch + 'fetch;'), [], 'carattere «' + ch + '» davanti a fetch: un altro nome');
      eqj(code(ch + 'import(x)'), [], 'carattere «' + ch + '» davanti a import( : un altro nome');
    }
    eqj(code('  import (x)'), ['import('], 'import ( con spazio');
    eqj(code('a = fetch(u) {'), ['fetch('], 'fetch( con graffa ma non a inizio riga: si segnala');
    eqj(code('if (x) fetch(u) { y }'), ['fetch('], 'fetch( dopo altro testo sulla riga: si segnala');
    eqj(code('  fetch(u) {'), [], 'definizione del metodo fetch');
    eqj(code('\tasync fetch(u, v) {'), [], 'definizione async del metodo fetch');
    eqj(code('async  \t fetch(u) {'), [], 'definizione async con spazi');
    eqj(code('  fetch(u)\n  {'), ['fetch('], 'graffa a capo: non e\' piu\' una definizione riconosciuta');
    eqj(code('new WebTransport(u)'), ['WebTransport'], 'WebTransport');
    eqj(code('new SharedWorker("w.js")'), ['Worker'], 'SharedWorker');
    eqj(code('const w = new  Worker(u)'), ['Worker'], 'new Worker con due spazi');
    ok(code('frames["fetch"](u)').includes('window.fetch'), 'frames["fetch"]');
    eqj(code('top.fetch(u)'), ['window.fetch'], 'top.fetch');
    ok(code('parent . fetch(u)').includes('window.fetch'), 'parent . fetch');
    eqj(code('xeval(1)'), [], 'xeval( non e eval(');
    eqj(code('eval (1)'), ['eval('], 'eval ( con spazio');
    eqj(code('newFunction(1)'), [], 'newFunction non e new Function');
    eqj(code('foo.serviceWorkerX = 1'), [], 'serviceWorkerX non e serviceWorker');
    eqj(B.cspDirectives("a b; c; d  e f ;; g-h"), {a: 'b', c: '', d: 'e f', 'g-h': ''}, 'cspDirectives');
    eqj(B.cspDirectives(''), {}, 'cspDirectives vuoto');
  }

  // ---------------------------------------------------------------- regola di sicurezza della pagina (CSP)
  {
    const tpl = fs.readFileSync(path.join(ROOT, 'web', 'index.template.html'), 'utf8');
    const vj = path.join(ROOT, 'vercel.json');
    let thrown = null;
    try { B.checkCsp(tpl, vj); } catch (e) { thrown = e; }
    ok(thrown === null, 'la CSP della pagina e di vercel.json e\' quella prevista' + (thrown ? ': ' + thrown.message : ''));
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(tpl)[1];
    const d = B.cspDirectives(meta);
    eqj(d['connect-src'], 'https:', 'connect-src https:');
    eqj(d['default-src'], "'none'", 'default-src none');
    ok(!/https:\s+http:|\*|http:/.test(d['connect-src']), 'connect-src senza http ne\' jolly');
    ok(!('frame-ancestors' in d), 'frame-ancestors non vale in un meta tag');
    const mk = (a, b) => tpl.replace(a, b);
    const bad = (t, re, m) => { let e = null; try { B.checkCsp(t, vj); } catch (x) { e = x; } ok(e && re.test(e.message), 'CSP rifiutata: ' + m + (e ? '' : ' (nessun errore)')); };
    bad(mk('connect-src https:;', "connect-src 'none';"), /connect-src https:/, "connect-src 'none'");
    bad(mk('connect-src https:;', 'connect-src *;'), /connect-src https:/, 'connect-src *');
    bad(mk('connect-src https:;', 'connect-src https: http:;'), /connect-src https:/, 'connect-src https: http:');
    bad(mk('connect-src https:;', 'connect-src https://archive.org;'), /connect-src https:/, 'connect-src solo archive.org');
    bad(mk("default-src 'none'", "default-src 'self'"), /default-src/, "default-src 'self'");
    bad(mk("style-src 'unsafe-inline'", "style-src 'unsafe-inline' https:"), /style-src/, 'style-src allargato');
    bad(mk("script-src 'unsafe-inline'", "script-src 'unsafe-inline' https:"), /script-src/, 'script-src allargato');
    bad(mk('img-src data: blob:', 'img-src data: blob: https:'), /img-src/, 'img-src allargato');
    bad(mk('media-src blob:', 'media-src blob: https:'), /media-src/, 'media-src allargato');
    bad(mk("form-action 'none'", "form-action https:"), /form-action/, 'form-action');
    bad(mk("base-uri 'none'", "base-uri 'self'"), /base-uri/, 'base-uri');
    bad(tpl.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), /Content-Security-Policy/, 'nessuna CSP');
    // vercel.json che non coincide
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'o2net-'));
    const v = JSON.parse(fs.readFileSync(vj, 'utf8'));
    const writeV = (mut) => { const x = JSON.parse(JSON.stringify(v)); mut(x); const f = path.join(tmp, 'v' + Math.random() + '.json'); fs.writeFileSync(f, JSON.stringify(x)); return f; };
    const hdr = (x) => x.headers[0].headers.find((h) => h.key === 'Content-Security-Policy');
    const badV = (file, re, m) => { let e = null; try { B.checkCsp(tpl, file); } catch (x) { e = x; } ok(e && re.test(e.message), 'vercel.json rifiutato: ' + m + (e ? '' : ' (nessun errore)')); };
    badV(writeV((x) => { hdr(x).value = hdr(x).value.replace('connect-src https:', "connect-src 'none'"); }), /non coincide/, "connect-src diverso");
    badV(writeV((x) => { hdr(x).value = hdr(x).value.replace('connect-src https:', 'connect-src https: http:'); }), /non coincide/, 'connect-src allargato');
    badV(writeV((x) => { x.headers[0].headers = x.headers[0].headers.filter((h) => h.key !== 'Content-Security-Policy'); }), /non ha l'intestazione/, 'senza CSP');
    badV(writeV((x) => { hdr(x).value = hdr(x).value.replace(" base-uri 'none';", ''); }), /non coincide/, 'direttiva mancante');
    const okV = writeV((x) => { hdr(x).value = hdr(x).value.replace("; frame-ancestors 'none'", ''); });
    let e2 = null; try { B.checkCsp(tpl, okV); } catch (x) { e2 = x; }
    ok(e2 === null, 'frame-ancestors in meno o in piu\' non conta');
    ok(/frame-ancestors 'none'/.test(hdr(v).value), 'vercel.json: frame-ancestors none nelle intestazioni');
    ok(v.headers[0].headers.some((h) => h.key === 'Referrer-Policy' && h.value === 'no-referrer') && v.headers[0].headers.some((h) => h.key === 'X-Content-Type-Options' && h.value === 'nosniff'), 'vercel.json: Referrer-Policy no-referrer e nosniff');
    fs.rmSync(tmp, {recursive: true, force: true});
    // il build lo impone davvero
    const bsrc = fs.readFileSync(path.join(ROOT, 'tools', 'build.js'), 'utf8');
    ok(/checkCsp\(tpl\)/.test(bsrc), 'build.js chiama checkCsp');
    // niente script o stili esterni nella pagina
    ok(!/<script[^>]+src=/i.test(tpl) && !/<link[^>]+href=/i.test(tpl) && !/@import/i.test(tpl), 'pagina senza script, stili o font esterni');
    ok(!/<(img|iframe|embed|object|video|audio|source)\b[^>]*\b(src|data)\s*=\s*["']?https?:/i.test(tpl), 'pagina senza risorse esterne');
  }

  finished = true;
  console.log((fails ? 'FALLITO' : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERRORE ' + (e && e.stack || e)); process.exit(1); });
