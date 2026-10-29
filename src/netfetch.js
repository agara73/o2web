'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// netfetch.js - l'UNICO punto della pagina che parla con la rete (tappa 4c). Regole, tutte verificate dai test:
//  - Niente parte da solo: le funzioni si chiamano solo su un'azione dell'utente (pulsante «Scarica»); questo modulo, caricato, non fa nessuna richiesta.
//  - Solo https, solo lettura (GET senza corpo, senza intestazioni, senza cookie, senza referrer): nessun dato dell'utente esce dal browser.
//    L'indirizzo non puo' contenere nome utente o password; un reindirizzamento verso un indirizzo non https si rifiuta.
//  - Il file si legge in memoria con un limite di byte (anche se il sito non dichiara la lunghezza) e un limite di attesa senza dati.
//  - Si puo' annullare in ogni momento. Gli errori di rete e di CORS non si distinguono dal browser: il messaggio lo dice e indica la strada
//    sicura (aprire l'indirizzo in una scheda, scaricare il file a mano e aggiungerlo con «Aggiungi file»).
//  - Nessun altro modulo di src/ usa fetch, XMLHttpRequest, WebSocket o simili (lo controllano test_net.js e tools/build.js).
// La regola di sicurezza della pagina (CSP) e' `connect-src https:` (web/index.template.html e vercel.json): la pagina non puo' contattare
// indirizzi non https; il resto lo garantisce questo modulo.
//   checkUrl(testo)         -> {ok: true, url, host} oppure {ok: false, why}
//   fileNameOf(url)         -> nome del file ricavato dall'ultimo pezzo del percorso
//   download(testo, opts)   -> {bytes, url, host, name, redirected}   (async; lancia NetError)
//   CHARSET_SOURCES         indirizzi dei set di caratteri nel sorgente di O2EM ({vdc, ef}: file, url, page); si scaricano solo col pulsante dell'editor
const LIMITS = {
  url: 2048,                      // lunghezza massima dell'indirizzo
  download: 128 << 20,            // byte letti in tutto per un file (un archivio di giochi e' meno di 1 MB)
  stallMs: 30000,                 // attesa massima senza ricevere dati (primo byte compreso)
};

class NetError extends Error {
  constructor(message, code) { super(message); this.name = 'NetError'; this.code = code || 'net'; }
}

// Nota (provato in un browser vero il 15/10/2026): fetch() verso archive.org/download/... FALLISCE per CORS; per questo la pagina non propone piu' collegamenti
// a raccolte: se serve, l'utente scarica l'archivio .zip con il browser e lo aggiunge con «Aggiungi file».

// Set di caratteri dal sorgente di O2EM (libretro-o2em su GitHub, licenza Artistic 2.0): lo scarico parte solo con il pulsante dell'editor. Verificato il
// 15/10/2026 dal sandbox: il file esiste, contiene `cset[512]` (CRC-32 b46a3f31) e `vpp_cset[2][1280]` (bit invertiti = ROM EF9341 di MAME, CRC 8de85988);
// raw.githubusercontent.com risponde con access-control-allow-origin: *. Da provare in un browser vero con la pagina aperta da disco. Il ramo e' 'master'.
const CHARSET_SOURCES = Object.freeze({
  vdc: Object.freeze({file: 'cset.c', label: 'set del chip video (cset.c)', url: 'https://raw.githubusercontent.com/libretro/libretro-o2em/master/src/cset.c',
    page: 'https://github.com/libretro/libretro-o2em/blob/master/src/cset.c'}),
  ef: Object.freeze({file: 'vpp_cset.c', label: 'ROM dell\u2019EF9341 (vpp_cset.c)', url: 'https://raw.githubusercontent.com/libretro/libretro-o2em/master/src/vpp_cset.c',
    page: 'https://github.com/libretro/libretro-o2em/blob/master/src/vpp_cset.c'}),
});

const FALLBACK_ADVICE = ' Se serve, scarica il file dal sito in una scheda del browser e poi caricalo con «Aggiungi file».';

// ---- indirizzo
function checkUrl(text) {
  const t = String(text === undefined || text === null ? '' : text).trim();
  if (!t) return {ok: false, why: 'Scrivi l’indirizzo (https://…) del file da scaricare.'};
  if (t.length > LIMITS.url) return {ok: false, why: 'Indirizzo troppo lungo (oltre ' + LIMITS.url + ' caratteri).'};
  if (/[\s\u0000-\u001F\u007F]/.test(t)) return {ok: false, why: 'L’indirizzo contiene spazi o caratteri non validi.'};
  const sch = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\//.exec(t);
  if (sch && sch[1].toLowerCase() !== 'https') {
    return {ok: false, why: sch[1].toLowerCase() === 'http' ? 'Indirizzo non ammesso: serve https, non http.' : 'Indirizzo non ammesso: si accettano solo indirizzi https (non «' + sch[1] + '»).'};
  }
  if ((sch ? t.slice(sch[0].length) : t).charAt(0) === '/') return {ok: false, why: 'Indirizzo non valido: manca il nome del sito.'};
  let u;
  try { u = new URL(sch ? t : 'https://' + t); } catch (e) { return {ok: false, why: 'Indirizzo non valido.'}; }
  if (u.protocol !== 'https:') return {ok: false, why: 'Indirizzo non ammesso: serve https.'};
  if (u.username || u.password) return {ok: false, why: 'L’indirizzo contiene nome utente o password: non è ammesso.'};
  if (!u.hostname) return {ok: false, why: 'Indirizzo senza nome del sito.'};
  u.hash = '';
  return {ok: true, url: u.href, host: u.host};
}

function fileNameOf(url) {
  let seg = '';
  try {
    const p = new URL(url).pathname;
    seg = p.slice(p.lastIndexOf('/') + 1);
    try { seg = decodeURIComponent(seg); } catch (e) { /* percentuali non valide: si tiene il testo grezzo */ }
  } catch (e) { seg = ''; }
  seg = seg.replace(/[\u0000-\u001F\u007F\\/]/g, '').trim().slice(0, 120);
  return seg || 'scaricato';
}

function httpMessage(status, host) {
  if (status === 404 || status === 410) return 'Il file non esiste su ' + host + ' (errore ' + status + '): controlla l’indirizzo.';
  if (status === 401 || status === 403) return 'Accesso negato da ' + host + ' (errore ' + status + ').';
  if (status === 429) return host + ' chiede di rallentare (errore 429): riprova tra un po’.';
  if (status >= 500) return 'Errore del server ' + host + ' (errore ' + status + '): riprova più tardi.';
  return host + ' ha risposto con l’errore ' + status + '.';
}

function fmtBytes(n) {
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(n >= 10 << 20 ? 0 : 1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(n >= 10240 ? 0 : 1) + ' KB';
  return n + ' byte';
}

// ---- scarico
// opts: {fetch, signal, maxBytes, stallMs, timers: {set, clear}, onProgress(ricevuti, totale|null)}
async function download(urlText, opts) {
  opts = opts || {};
  const chk = checkUrl(urlText);
  if (!chk.ok) throw new NetError(chk.why, 'url');
  const doFetch = opts.fetch || (typeof globalThis.fetch === 'function' ? (...a) => globalThis.fetch(...a) : null);
  if (!doFetch) throw new NetError('Questo browser non permette di scaricare da un indirizzo.' + FALLBACK_ADVICE, 'unsupported');
  const max = opts.maxBytes > 0 ? opts.maxBytes : LIMITS.download;
  const stallMs = opts.stallMs > 0 ? opts.stallMs : LIMITS.stallMs;
  const timers = opts.timers || {set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h)};
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const why = {user: false, stalled: false, big: false};
  const abort = () => { if (ctl) ctl.abort(); };
  let onAbort = null;
  if (opts.signal) {
    if (opts.signal.aborted) throw new NetError('Scarico annullato.', 'abort');
    onAbort = () => { why.user = true; abort(); };
    opts.signal.addEventListener('abort', onAbort, {once: true});
  }
  let timer = null;
  const arm = () => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => { why.stalled = true; abort(); }, stallMs);
  };
  const stop = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const fail = (e) => {
    if (e instanceof NetError) return e;
    if (why.user) return new NetError('Scarico annullato.', 'abort');
    if (why.stalled) return new NetError('Nessun dato ricevuto da ' + chk.host + ' per ' + Math.round(stallMs / 1000) + ' secondi: scarico interrotto.' + FALLBACK_ADVICE, 'stalled');
    if (why.big) return new NetError('Il file è troppo grande (oltre ' + fmtBytes(max) + ').', 'size');
    if (e && e.name === 'AbortError') return new NetError('Scarico annullato.', 'abort');
    return new NetError('Impossibile leggere ' + chk.host + ': manca la connessione, oppure il sito non permette la lettura da questa pagina (regola CORS), oppure l’indirizzo non esiste.' + FALLBACK_ADVICE, 'network');
  };
  try {
    arm();
    let res;
    try {
      res = await doFetch(chk.url, {method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined});
    } catch (e) { throw fail(e); }
    if (!res || typeof res !== 'object') throw new NetError('Risposta non valida da ' + chk.host + '.', 'network');
    arm();                                  // le intestazioni sono arrivate: l'attesa riparte da zero
    let finalUrl = chk.url, redirected = false;
    if (res.url) {
      let fu;
      try { fu = new URL(res.url); } catch (e) { throw new NetError('Il sito ha risposto con un indirizzo non valido.', 'redirect'); }
      if (fu.protocol !== 'https:') throw new NetError('Il sito ha reindirizzato a un indirizzo non https: rifiutato.', 'redirect');
      if (fu.username || fu.password) throw new NetError('Il sito ha reindirizzato a un indirizzo con nome utente o password: rifiutato.', 'redirect');
      fu.hash = '';
      redirected = fu.href !== chk.url;
      finalUrl = fu.href;
    }
    if (!res.ok) { abort(); throw new NetError(httpMessage(res.status, chk.host), 'http'); }
    let total = null;
    const cl = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
    if (cl !== null && cl !== undefined && /^\d+$/.test(String(cl).trim())) total = Number(cl);
    if (total !== null && total > max) { why.big = true; abort(); throw new NetError('Il file è troppo grande (' + fmtBytes(total) + '; massimo ' + fmtBytes(max) + ').', 'size'); }
    const progress = (n) => { if (opts.onProgress) opts.onProgress(n, total); };
    progress(0);
    const chunks = [];
    let got = 0;
    if (res.body && typeof res.body.getReader === 'function') {
      const rd = res.body.getReader();
      for (;;) {
        let r;
        try { r = await rd.read(); } catch (e) { throw fail(e); }
        if (why.user || why.stalled) { try { rd.cancel(); } catch (e) { /* gia' chiuso */ } throw fail(null); }
        if (r.done) break;
        const c = r.value;
        if (!(c instanceof Uint8Array)) { try { rd.cancel(); } catch (e) { /* gia' chiuso */ } throw new NetError('Dati non validi da ' + chk.host + '.', 'network'); }
        got += c.length;
        if (got > max) { why.big = true; try { rd.cancel(); } catch (e) { /* gia' chiuso */ } abort(); throw fail(null); }
        chunks.push(c);
        arm();
        progress(got);
      }
    } else if (typeof res.arrayBuffer === 'function') {
      let ab;
      try { ab = await res.arrayBuffer(); } catch (e) { throw fail(e); }
      got = ab.byteLength;
      if (got > max) { why.big = true; throw fail(null); }
      chunks.push(new Uint8Array(ab));
      progress(got);
    } else throw new NetError('Risposta non leggibile da ' + chk.host + '.', 'network');
    if (got === 0) throw new NetError('Il file scaricato da ' + chk.host + ' è vuoto.', 'empty');
    const bytes = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return {bytes, url: finalUrl, host: new URL(finalUrl).host, name: fileNameOf(finalUrl), redirected};
  } finally {
    stop();
    if (onAbort) opts.signal.removeEventListener('abort', onAbort);
  }
}

module.exports = {NetError, LIMITS, CHARSET_SOURCES, checkUrl, fileNameOf, httpMessage, fmtBytes, download};
