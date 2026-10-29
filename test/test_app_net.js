'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_app_net.js - il regista (app.js) con la rete su richiesta e le copertine: fetchUrl con un fetch FINTO (nessuna richiesta vera), smistamento dei file
// scaricati (giochi / copertine), rifiuto di sessioni e stati dalla rete, scarico unico alla volta, annullamento, messaggi esatti, copertine aggiunte dal disco
// e abbinate ai giochi, copertine mai nella sessione. Senza dump: le cartucce sono byte casuali, le immagini sintetiche.
const fs = require('fs');
const path = require('path');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');
const SP = (n) => path.join(SRC, n);
const {App, isImageFile} = require(SP('app.js'));
const {zipStore} = require(SP('zipstore.js'));
const charsetOwn = require('../hw/charset_own.js');
const FALLBACK = new Uint8Array(charsetOwn.build());

let fails = 0, checks = 0, finished = false;
process.on('exit', (c) => { if (!finished && c === 0) { console.log('FALLITO: il test si e\' interrotto senza finire (promessa mai risolta)'); process.exitCode = 1; } });
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));

let seed = 99;
const rb = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; b[i] = seed >>> 24; } return b; };
function png(w, h, pad) {
  const b = new Uint8Array(33 + (pad || 0));
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, w >> 8, w & 255, 0, 0, h >> 8, h & 255]);
  for (let i = 24; i < b.length; i++) b[i] = (i * 5 + w + (pad || 0)) & 255;
  return b;
}
const zip = (entries) => zipStore(entries.map(([name, data]) => ({name, data})));
const F = (name, bytes) => ({name, bytes});

function resp(o) {
  const chunks = (o.chunks || []).slice();
  return {ok: o.status === undefined || o.status < 400, status: o.status === undefined ? 200 : o.status, url: o.url || '',
    headers: {get: (k) => (o.headers && o.headers[k.toLowerCase()] !== undefined ? o.headers[k.toLowerCase()] : null)},
    body: {getReader: () => ({
      read: () => new Promise((res, rej) => {
        if (chunks.length) { const c = chunks.shift(); setTimeout(() => res({done: false, value: c}), 0); return; }
        if (o.stall) { if (o.signal.aborted) { rej(Object.assign(new Error('aborted'), {name: 'AbortError'})); return; } o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), {name: 'AbortError'})), {once: true}); return; }
        setTimeout(() => res({done: true}), 0);
      }),
      cancel: () => {},
    })}};
}
const serve = (bytes, extra) => {
  const f = async (url, init) => { f.calls.push({url, init}); return resp(Object.assign({chunks: [bytes.slice(0, Math.ceil(bytes.length / 2)), bytes.slice(Math.ceil(bytes.length / 2))]}, extra || {})); };
  f.calls = [];
  return f;
};

function mk(fetchImpl) {
  const msgs = [], nets = [];
  const app = new App({onMessage: (t, k) => msgs.push([k, t]), sink: null, fallbackCharset: FALLBACK, fetch: fetchImpl, onNet: (n) => nets.push({busy: n.busy, received: n.received, total: n.total, host: n.host})});
  return {app, msgs, nets, kinds: () => msgs.map((m) => m[0]), texts: () => msgs.map((m) => m[1]), last: () => msgs[msgs.length - 1] || [null, null], clear: () => { msgs.length = 0; nets.length = 0; }};
}

(async () => {
  const BIOS = rb(1024), CART_A = rb(2048), CART_B = rb(2048);

  // ---------------------------------------------------------------- indirizzo non valido: nessuna richiesta
  {
    const f = serve(rb(10));
    const h = mk(f);
    for (const [u, re] of [['', /Scrivi/], ['http://a.org/x.zip', /serve https, non http/], ['ftp://a.org/x', /solo indirizzi https/], ['https://u:p@a.org/x', /nome utente/]]) {
      h.clear();
      const r = await h.app.fetchUrl(u, 'games');
      ok(r === null && h.last()[0] === 'bad' && re.test(h.last()[1]), 'indirizzo rifiutato: ' + JSON.stringify(u) + ' -> ' + h.last()[1]);
    }
    ok(f.calls.length === 0, 'nessuna richiesta per indirizzi rifiutati');
    ok(h.app.net.busy === false, 'stato rete a riposo');
    ok(h.nets.length === 0, 'onNet non scatta se l\'indirizzo e\' rifiutato');
  }

  // ---------------------------------------------------------------- giochi da uno zip
  {
    const z = zip([['bios/BIOS uno.bin', BIOS], ['Alfa (1981)(X)(EU).bin', CART_A], ['Beta, The (1982)(Y)(US).bin', CART_B]]);
    const f = serve(z, {headers: {'content-length': String(z.length)}, url: 'https://ia80.us.archive.org/Item/Raccolta.zip'});
    const h = mk(f);
    const rev0 = h.app.rev;
    const r = await h.app.fetchUrl('https://archive.org/download/Item/Raccolta.zip', 'games');
    ok(r && r.kind === 'games' && r.name === 'Raccolta.zip' && r.size === z.length, 'scarico di giochi: risultato');
    ok(h.app.lib.games.length === 2 && h.app.lib.bios.length === 1, 'giochi e BIOS entrati nell\'elenco (' + h.app.lib.games.length + ', ' + h.app.lib.bios.length + ')');
    ok(f.calls.length === 1 && f.calls[0].init.method === 'GET' && f.calls[0].init.credentials === 'omit' && f.calls[0].init.referrerPolicy === 'no-referrer', 'una richiesta GET anonima senza referrer');
    ok(h.texts()[0] === 'Scarico da archive.org (solo lettura: non invio nessun tuo dato)…', 'primo messaggio: ' + h.texts()[0]);
    ok(h.texts().some((t) => t === 'Scaricato «Raccolta.zip» (' + (z.length / 1024 >= 10 ? Math.round(z.length / 1024) : (z.length / 1024).toFixed(1)) + ' KB) da ia80.us.archive.org (dopo un reindirizzamento).'), 'messaggio di fine scarico: ' + JSON.stringify(h.texts()));
    ok(h.texts().some((t) => /^Aggiunti all’elenco: 2 giochi e 1 BIOS\.$/.test(t)), 'messaggio di aggiunta');
    ok(h.app.rev > rev0, 'rev sale');
    ok(h.nets.length >= 3 && h.nets[0].busy === true && h.nets[0].host === 'archive.org' && h.nets[h.nets.length - 1].busy === false, 'onNet: parte occupato, finisce a riposo (' + h.nets.length + ' chiamate)');
    ok(h.nets.some((n) => n.received > 0 && n.total === z.length), 'onNet: avanzamento con il totale');
    eq(h.app.net, {busy: false, ctl: null, received: 0, total: null, host: ''}, 'stato rete azzerato');
  }

  // ---------------------------------------------------------------- immagini: sempre copertine
  {
    const p = png(100, 150, 50);
    const h = mk(serve(p));
    await h.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A), F('Beta, The (1982)(Y)(US).bin', CART_B)]);
    h.clear();
    const r = await h.app.fetchUrl('https://a.org/cover/Alfa%20(1981)(X)(EU).png', 'games');
    ok(r && r.kind === 'covers' && r.report.added === 1, 'una PNG scaricata va alle copertine anche se si attendevano giochi');
    ok(h.app.covers.count === 1 && h.app.lib.games.length === 2, 'copertina in memoria, elenco giochi invariato');
    ok(h.texts().some((t) => t === 'Aggiunte 1 copertina. Abbinate a 1 giochi su 2.'), 'messaggio: ' + JSON.stringify(h.texts()));
    const g = h.app.lib.games.find((x) => /Alfa/.test(x.title));
    ok(h.app.coverFor(g.id) && h.app.coverFor(g.id).w === 100, 'coverFor del gioco abbinato');
    ok(h.app.coverFor(h.app.lib.games.find((x) => /Beta/.test(x.title)).id) === null && h.app.coverFor(99999) === null, 'coverFor: nessuna / gioco inesistente');
    eq(h.app.coverStats(), {covers: 1, games: 2, matched: 1}, 'coverStats');
    // lo stesso file ancora: nulla di nuovo
    h.clear();
    await h.app.fetchUrl('https://a.org/cover/Alfa%20(1981)(X)(EU).png', 'covers');
    ok(h.texts().some((t) => /^Niente di nuovo: 1 copertine erano già presenti\.$/.test(t)), 'doppione: ' + JSON.stringify(h.texts()));
  }

  // ---------------------------------------------------------------- zip di copertine, kind 'covers'
  {
    const zc = zip([['Box/Alfa (1981)(X)(EU).png', png(10, 10, 1)], ['Box/Beta, The (1982)(Y)(US).png', png(10, 10, 2)], ['Box/Gamma.png', png(10, 10, 3)]]);
    const h = mk(serve(zc));
    await h.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A), F('Beta, The (1982)(Y)(US).bin', CART_B)]);
    h.clear();
    const r = await h.app.fetchUrl('https://a.org/c.zip', 'covers');
    ok(r && r.kind === 'covers' && r.report.added === 3, 'zip di copertine: 3 aggiunte');
    ok(h.texts().some((t) => t === 'Aggiunte 3 copertine. Abbinate a 2 giochi su 2.'), 'messaggio: ' + JSON.stringify(h.texts()));
    ok(h.app.lib.games.length === 2, 'nessun gioco in piu\'');
  }

  // ---------------------------------------------------------------- kind 'covers' ma il contenuto sono giochi
  {
    const z = zip([['Alfa (1981)(X)(EU).bin', CART_A]]);
    const h = mk(serve(z));
    const r = await h.app.fetchUrl('https://a.org/g.zip', 'covers');
    ok(r === null && h.app.lib.games.length === 0, 'archivio di giochi scelto come copertine: non si aggiunge nulla');
    ok(h.texts().some((t) => /non contiene immagini: non è un archivio di copertine/.test(t)) && h.kinds().includes('warn'), 'avviso: ' + JSON.stringify(h.texts()));
  }

  // ---------------------------------------------------------------- sessioni e stati non si aprono dalla rete
  {
    const sess = zip([['sessione.json', new TextEncoder().encode('{"x":1}')]]);
    let h = mk(serve(sess));
    await h.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A), F('BIOS uno.bin', BIOS)]);
    const before = JSON.stringify([h.app.biosId, h.app.gameId, h.app.lib.games.length]);
    h.clear();
    let r = await h.app.fetchUrl('https://a.org/sessione.zip', 'games');
    ok(r === null && /è una sessione o uno stato di gioco: per sicurezza non si apre da un indirizzo/.test(h.texts().join('|')) && h.kinds().includes('warn'), 'sessione da rete rifiutata: ' + JSON.stringify(h.texts()));
    ok(JSON.stringify([h.app.biosId, h.app.gameId, h.app.lib.games.length]) === before, 'la partita non cambia');
    h = mk(serve(new TextEncoder().encode(' \n{"a":1}')));
    r = await h.app.fetchUrl('https://a.org/stato.json', 'games');
    ok(r === null && /sessione o uno stato di gioco/.test(h.texts().join('|')), 'stato da rete rifiutato');
    ok(!h.texts().some((t) => /^Scaricato/.test(t)), 'non si dice «Scaricato» di un file rifiutato');
  }

  // ---------------------------------------------------------------- errori
  {
    let h = mk(serve(rb(10), {status: 404}));
    let r = await h.app.fetchUrl('https://a.org/x.zip', 'games');
    ok(r === null && h.last()[0] === 'bad' && /Il file non esiste su a\.org \(errore 404\)/.test(h.last()[1]), '404: ' + h.last()[1]);
    ok(h.app.net.busy === false && h.nets[h.nets.length - 1].busy === false, '404: stato rete a riposo');
    h = mk(async () => { throw new TypeError('Failed to fetch'); });
    r = await h.app.fetchUrl('https://a.org/x.zip', 'games');
    ok(r === null && h.last()[0] === 'bad' && /CORS/.test(h.last()[1]) && /Aggiungi file/.test(h.last()[1]), 'rete/CORS: ' + h.last()[1]);
    h = mk(serve(new Uint8Array(0)));
    r = await h.app.fetchUrl('https://a.org/x.zip', 'games');
    ok(r === null && /vuoto/.test(h.last()[1]), 'file vuoto: ' + h.last()[1]);
    // contenuto che non e' ne' gioco ne' BIOS
    h = mk(serve(text('niente di utile')));
    r = await h.app.fetchUrl('https://a.org/x.txt', 'games');
    ok(r && r.kind === 'games' && h.app.lib.games.length === 0 && h.kinds().includes('warn'), 'contenuto inutile: nulla entra, avviso (' + JSON.stringify(h.texts()) + ')');
    // un errore di programma (non di rete) non si inghiotte
    h = mk(serve(rb(10)));
    h.app.addFiles = async () => { throw new RangeError('guasto'); };
    let thrown = null;
    try { await h.app.fetchUrl('https://a.org/x.bin', 'games'); } catch (e) { thrown = e; }
    ok(thrown instanceof RangeError && h.app.net.busy === false, 'un guasto dopo lo scarico si vede e la rete torna a riposo');
  }

  // ---------------------------------------------------------------- uno scarico alla volta, annullamento
  {
    let signal = null, release = null;
    const gate = new Promise((r) => { release = r; });
    const f = async (url, init) => { f.calls.push(url); signal = init.signal; await gate; return resp({chunks: [rb(100)]}); };
    f.calls = [];
    const h = mk(f);
    const p1 = h.app.fetchUrl('https://a.org/uno.zip', 'games');
    await new Promise((r) => setTimeout(r, 5));
    ok(h.app.net.busy === true && h.app.net.host === 'a.org', 'scarico in corso');
    h.clear();
    const r2 = await h.app.fetchUrl('https://a.org/due.zip', 'games');
    ok(r2 === null && h.last()[0] === 'warn' && /già in corso/.test(h.last()[1]) && f.calls.length === 1, 'il secondo scarico e\' rifiutato (una sola richiesta)');
    ok(h.app.cancelFetch() === true && signal.aborted, 'cancelFetch annulla');
    release();
    const r1 = await p1;
    ok(r1 === null, 'scarico annullato: null');
    ok(h.texts().some((t) => /annullato/.test(t)) && h.kinds()[h.kinds().length - 1] === 'warn' || h.texts().some((t) => /annullato/.test(t)), 'messaggio di annullamento');
    ok(h.app.net.busy === false && h.app.net.ctl === null, 'rete a riposo dopo l\'annullamento');
    ok(h.app.cancelFetch() === false, 'cancelFetch a riposo: nulla da annullare');
    // dopo l'annullamento si puo' scaricare di nuovo
    const f2 = serve(png(10, 10, 5));
    h.app.fetchImpl = f2;
    const r3 = await h.app.fetchUrl('https://a.org/c.png', 'covers');
    ok(r3 && r3.report.added === 1, 'dopo l\'annullamento si scarica di nuovo');
    // annullamento durante la lettura
    const h2 = mk(async (u, init) => resp({chunks: [rb(10)], stall: true, signal: init.signal}));
    const p = h2.app.fetchUrl('https://a.org/lento.zip', 'games');
    await new Promise((r) => setTimeout(r, 20));
    h2.app.cancelFetch();
    ok(await p === null && h2.texts().some((t) => /annullato/.test(t)), 'annullamento durante la lettura');
  }

  // ---------------------------------------------------------------- copertine dal disco
  {
    const h = mk(null);
    await h.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A), F('Beta, The (1982)(Y)(US).bin', CART_B), F('BIOS uno.bin', BIOS)]);
    h.clear();
    ok(isImageFile(F('a.png', png(5, 5))) && !isImageFile(F('a.png', rb(40))) && !isImageFile(F('a.txt', png(5, 5))) && !isImageFile(F('a.bin', png(5, 5))), 'isImageFile: estensione e contenuto');
    await h.app.openFiles([F('Alfa (1981)(X)(EU).png', png(10, 10, 1))]);
    ok(h.app.covers.count === 1 && h.app.lib.games.length === 2, 'una PNG scelta con «Aggiungi file» va alle copertine, non all\'elenco');
    ok(h.texts().some((t) => t === 'Aggiunte 1 copertina. Abbinate a 1 giochi su 2.'), 'messaggio: ' + JSON.stringify(h.texts()));
    h.clear();
    await h.app.openFiles([F('Altro.zip', zip([['Delta.png', png(10, 10, 2)], ['Epsilon.jpg', Uint8Array.from([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 8, 0, 5, 0, 5, 3, 1, 0x22, 0, 0xFF, 0xD9])]]))]);
    ok(h.app.covers.count === 3, 'uno zip di sole immagini va alle copertine');
    ok(h.texts().some((t) => /^Aggiunte 2 copertine\. Abbinate a 1 giochi su 2\.$/.test(t)) || h.texts().some((t) => /^Aggiunte 2 copertine/.test(t)), 'messaggio zip: ' + JSON.stringify(h.texts()));
    // nessuna corrispondenza con i giochi
    const h2 = mk(null);
    await h2.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A)]);
    h2.clear();
    await h2.app.addCovers([F('Zeta.png', png(10, 10, 4))]);
    ok(h2.texts().some((t) => /Nessuna copertina corrisponde ai giochi dell’elenco/.test(t)) && h2.kinds().includes('warn'), 'avviso di nessuna corrispondenza: ' + JSON.stringify(h2.texts()));
    // prima le copertine, poi i giochi: si abbinano comunque
    const h3 = mk(null);
    await h3.app.openFiles([F('Alfa (1981)(X)(EU).png', png(10, 10, 1))]);
    ok(h3.texts().some((t) => /Si abbinano ai giochi per titolo, appena li aggiungi\./.test(t)), 'copertine senza giochi: messaggio');
    await h3.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A)]);
    eq(h3.app.coverStats(), {covers: 1, games: 1, matched: 1}, 'giochi aggiunti dopo le copertine: abbinati');
    // nessuna immagine tra i file
    h3.clear();
    await h3.app.addCovers([F('niente.txt', new TextEncoder().encode('x'))]);
    ok(h3.texts().some((t) => /^Nessuna copertina trovata nei file scelti/.test(t)) && h3.texts().some((t) => /1 file saltati: niente\.txt: non è un’immagine/.test(t)), 'nessuna copertina trovata: ' + JSON.stringify(h3.texts()));
    // errori in zip
    h3.clear();
    await h3.app.addCovers([F('rotto.zip', Uint8Array.from([0x50, 0x4B, 3, 4, 1, 2, 3]))]);
    ok(h3.kinds().includes('bad'), 'zip rotto: messaggio di errore');
    // svuota
    const rev = h3.app.rev;
    h3.app.clearCovers();
    ok(h3.app.covers.count === 0 && h3.app.rev > rev && h3.app.coverStats().matched === 0, 'clearCovers');
  }

  // ---------------------------------------------------------------- messaggi esatti di addCovers
  {
    const txt = (s) => new TextEncoder().encode(s);
    const h = mk(null);
    await h.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A)]);
    h.clear();
    let r = await h.app.addCovers([F('Alfa (1981)(X)(EU).png', png(10, 10, 1)), F('Alfa (1981)(X)(EU).png', png(10, 10, 1)), F('Alfa (1981)(X)(EU).png', png(10, 10, 2))]);
    eq([r.added, r.dups, r.files], [2, 1, 3], 'addCovers: totali (aggiunte, doppioni, file)');
    eq(h.texts(), ['Aggiunte 2 copertine (1 doppioni ignorati). Abbinate a 1 giochi su 1.'], 'messaggio con doppioni');
    h.clear();
    r = await h.app.addCovers([F('Alfa (1981)(X)(EU).png', png(10, 10, 1))]);
    eq(h.texts(), ['Niente di nuovo: 1 copertine erano già presenti.'], 'messaggio: tutti doppioni');
    // saltati: 3 elencati, dal quarto in poi «; ...»
    const sk = (n) => Array.from({length: n}, (_, i) => F('s' + i + '.txt', txt('x')));
    h.clear();
    await h.app.addCovers(sk(3));
    eq(h.texts().slice(1), ['3 file saltati: s0.txt: non è un’immagine (.txt); s1.txt: non è un’immagine (.txt); s2.txt: non è un’immagine (.txt)'], 'tre saltati: tutti elencati');
    h.clear();
    await h.app.addCovers(sk(4));
    eq(h.texts().slice(1), ['4 file saltati: s0.txt: non è un’immagine (.txt); s1.txt: non è un’immagine (.txt); s2.txt: non è un’immagine (.txt); ...'], 'quattro saltati: tre elencati e «; ...»');
    h.clear();
    await h.app.addCovers(sk(1));
    eq(h.texts().slice(1), ['1 file saltati: s0.txt: non è un’immagine (.txt)'], 'un saltato');
    h.clear();
    await h.app.addCovers([]);
    eq(h.texts(), ['Nessuna copertina trovata nei file scelti (servono immagini PNG, JPEG, WebP o GIF, anche dentro uno zip).'], 'nessun file: solo l\'avviso');
    // errori: i primi 4, poi «...e altri N errori.»
    const bad = (n) => Array.from({length: n}, (_, i) => F('z' + i + '.zip', Uint8Array.from([0x50, 0x4B, 3, 4, 1, 2, 3])));
    h.clear();
    await h.app.addCovers(bad(4));
    eq([h.texts().filter((t) => /^z\d\.zip: /.test(t)).length, h.texts().some((t) => /altri/.test(t))], [4, false], 'quattro errori: tutti elencati, nessun «altri»');
    h.clear();
    await h.app.addCovers(bad(5));
    eq([h.texts().filter((t) => /^z\d\.zip: /.test(t)).length, h.texts().filter((t) => /altri/.test(t))], [4, ['...e altri 1 errori.']], 'cinque errori: quattro elencati e «...e altri 1 errori.»');
    h.clear();
    await h.app.addCovers(bad(9));
    eq(h.texts().filter((t) => /altri/.test(t)), ['...e altri 5 errori.'], 'nove errori: «...e altri 5 errori.»');
    ok(h.kinds().filter((k) => k === 'bad').length === 5, 'gli errori sono messaggi «bad»');
    // senza giochi: nessun avviso di «nessuna corrispondenza»
    const h0 = mk(null);
    await h0.app.addCovers([F('Zeta.png', png(10, 10, 4))]);
    eq(h0.texts(), ['Aggiunte 1 copertina. Si abbinano ai giochi per titolo, appena li aggiungi.'], 'senza giochi: nessun avviso di corrispondenza');
    // con giochi ma nessuna corrispondenza: avviso
    const h1 = mk(null);
    await h1.app.openFiles([F('Alfa (1981)(X)(EU).bin', CART_A)]);
    h1.clear();
    await h1.app.addCovers([F('Zeta.png', png(10, 10, 4))]);
    eq(h1.texts(), ['Aggiunte 1 copertina. Abbinate a 0 giochi su 1.', 'Nessuna copertina corrisponde ai giochi dell’elenco: l’abbinamento è per titolo (per esempio «Killer Bees.png» o il nome del file del gioco).'], 'con giochi e nessuna corrispondenza');
    // con una corrispondenza: nessun avviso
    h1.clear();
    await h1.app.addCovers([F('Alfa.png', png(10, 10, 5))]);
    eq(h1.texts(), ['Aggiunte 1 copertina. Abbinate a 1 giochi su 1.'], 'con una corrispondenza: nessun avviso');
    // singolare e plurale
    const h2 = mk(null);
    await h2.app.addCovers([F('A.png', png(10, 10, 1)), F('B.png', png(10, 10, 2))]);
    ok(/^Aggiunte 2 copertine\./.test(h2.texts()[0]), 'plurale');
    const h3 = mk(null);
    await h3.app.addCovers([F('A.png', png(10, 10, 1))]);
    ok(/^Aggiunte 1 copertina\./.test(h3.texts()[0]), 'singolare');
    // annullamento fuori da uno scarico
    const h4 = mk(null);
    h4.app.net = {busy: true, ctl: null, received: 0, total: null, host: 'x'};
    ok(h4.app.cancelFetch() === false, 'cancelFetch: occupato ma senza controllo di annullamento -> false, senza errori');
    h4.app.net = {busy: false, ctl: new AbortController(), received: 0, total: null, host: ''};
    ok(h4.app.cancelFetch() === false && !h4.app.net.ctl.signal.aborted, 'cancelFetch: a riposo -> false e il controllo non scatta');
    // messaggi esatti dello scarico rifiutato
    const hs = mk(serve(zip([['sessione.json', txt('{"x":1}')]])));
    await hs.app.fetchUrl('https://a.org/s.zip', 'games');
    eq(hs.texts().slice(1), ['«s.zip» è una sessione o uno stato di gioco: per sicurezza non si apre da un indirizzo. Salvalo sul disco e aprilo con «Aggiungi file».'], 'messaggio esatto: sessione dalla rete');
    const hg = mk(serve(zip([['Alfa (1981)(X)(EU).bin', CART_A]])));
    await hg.app.fetchUrl('https://a.org/g.zip', 'covers');
    ok(hg.texts()[hg.texts().length - 1] === '«g.zip» non contiene immagini: non è un archivio di copertine. Se sono giochi o BIOS, scegli «Giochi e BIOS».', 'messaggio esatto: giochi scelti come copertine (' + hg.texts()[hg.texts().length - 1] + ')');
    // l'avanzamento parte da zero
    const hp = mk(serve(png(10, 10, 5)));
    await hp.app.fetchUrl('https://a.org/p.png', 'covers');
    ok(hp.nets[0].received === 0 && hp.nets[0].total === null && hp.nets[0].busy === true, 'onNet: primo stato con 0 byte ricevuti');
  }

  // ---------------------------------------------------------------- le copertine non stanno nella sessione
  {
    const sess = fs.readFileSync(SP('session.js'), 'utf8');
    ok(!/cover/i.test(sess), 'session.js non nomina le copertine');
    const zs = fs.readFileSync(SP('zipstore.js'), 'utf8');
    ok(!/cover/i.test(zs), 'zipstore.js non nomina le copertine');
  }

  // ---------------------------------------------------------------- set di caratteri dal sorgente di O2EM (fetch FINTO, tabelle inventate)
  {
    const Net = require(SP('netfetch.js'));
    const E = require(SP('charedit.js'));
    const zlib = require('zlib');
    const hex = (v) => '0x' + (v < 16 ? '0' : '') + v.toString(16);
    const vdc = rb(512), efRom = rb(2560);
    const csrc = text('/* inventato */\nuint8_t cset[512]= {\n' + Array.from(vdc).map(hex).join(',') + '\n};\n');
    const rev = (b) => { let r = 0; for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i; return r; };
    const vpp = text('uint8_t vpp_cset[2][1280] = {\n{' + Array.from(efRom.slice(0, 1280)).map((b) => hex(rev(b))).join(',') + '},\n{' + Array.from(efRom.slice(1280)).map((b) => hex(rev(b))).join(',') + '}\n};\n');
    ok(Net.CHARSET_SOURCES.vdc.url === 'https://raw.githubusercontent.com/libretro/libretro-o2em/master/src/cset.c' && Net.CHARSET_SOURCES.ef.url.endsWith('/src/vpp_cset.c') && Object.isFrozen(Net.CHARSET_SOURCES) && Object.isFrozen(Net.CHARSET_SOURCES.vdc), 'indirizzi dei set di caratteri: raw.githubusercontent.com, libretro-o2em, congelati');
    ok(Net.checkUrl(Net.CHARSET_SOURCES.vdc.url).ok && Net.checkUrl(Net.CHARSET_SOURCES.ef.url).ok && Net.CHARSET_SOURCES.vdc.page.startsWith('https://github.com/libretro/libretro-o2em/blob/master/src/'), 'indirizzi dei set: https validi');
    // set del chip video
    {
      const f = serve(csrc);
      const h = mk(f);
      const r = await h.app.fetchCharset('vdc');
      ok(r && r.kind === 'vdc' && r.name === 'cset.c (O2EM)' && r.known === false, 'fetchCharset vdc: risultato (impronta di prova non nota)');
      ok(f.calls.length === 1 && f.calls[0].url === Net.CHARSET_SOURCES.vdc.url, 'fetchCharset vdc: una sola richiesta, all\'indirizzo previsto');
      ok(h.app.charset && E.setsEqual(h.app.charset, vdc) && h.app.charsetName === 'cset.c (O2EM)', 'fetchCharset vdc: il set e\' in uso');
      ok(/Set del chip video letto da cset/.test(h.texts().join('|')), 'fetchCharset vdc: il messaggio parla del chip video');
      ok(h.kinds().includes('good') && /letto da cset\.c \(tabella C di 512 valori\)/.test(h.texts().join('|')) && /impronta non nota/.test(h.texts().join('|')), 'fetchCharset vdc: messaggio: ' + h.texts().join(' | ').slice(-160));
      ok(h.app.net.busy === false, 'fetchCharset vdc: stato rete a riposo');
      ok(f.calls[0].init && f.calls[0].init.credentials === 'omit', 'fetchCharset vdc: la richiesta non porta credenziali');
    }
    // impronta nota: «riconosciuto»
    {
      E.KNOWN.push({kind: 'vdc', crc: zlib.crc32(vdc), label: 'set di prova'});
      try {
        const h = mk(serve(csrc));
        const r = await h.app.fetchCharset('vdc');
        ok(r && r.known === true && /riconosciuto, set di prova/.test(h.texts().join('|')), 'fetchCharset vdc: impronta nota: riconosciuto');
      } finally { E.KNOWN.pop(); }
    }
    // ROM EF9341: tabella a due dimensioni con i bit invertiti, accettata solo con impronta nota
    {
      const h = mk(serve(vpp));
      const r = await h.app.fetchCharset('ef');
      ok(r === null && h.app.efCharset === null && h.last()[0] === 'bad' && /non contiene il set dell’EF9341/.test(h.last()[1]), 'fetchCharset ef: tabella 2D con impronta sconosciuta: rifiutata con messaggio (' + h.last()[1].slice(0, 60) + ')');
      E.KNOWN.push({kind: 'ef', crc: zlib.crc32(efRom), label: 'ROM di prova'});
      try {
        const h2 = mk(serve(vpp));
        const r2 = await h2.app.fetchCharset('ef');
        ok(r2 && r2.kind === 'ef' && r2.name === 'vpp_cset.c (O2EM)' && r2.known && h2.app.efCharset && E.setsEqual(h2.app.efCharset, efRom), 'fetchCharset ef: con impronta nota la ROM e\' rimessa in ordine (bit) e messa in uso');
        ok(/Set dell’EF9341 letto da vpp_cset\.c/.test(h2.texts().join('|')), 'fetchCharset ef: il messaggio parla dell\u2019EF9341');
        ok(/bit invertiti/.test(h2.texts().join('|')) && /riconosciuto, ROM di prova/.test(h2.texts().join('|')), 'fetchCharset ef: messaggio');
      } finally { E.KNOWN.pop(); }
    }
    // file che non contiene il set (il sito e' cambiato), errore di rete, 404, tipo sbagliato, scarico gia' in corso
    {
      const h = mk(serve(text('niente di utile qui')));
      ok(await h.app.fetchCharset('vdc') === null && h.app.charset === null && /non contiene il set del chip video/.test(h.last()[1]) && h.last()[0] === 'bad', 'fetchCharset: file senza tabella: messaggio, nessun set cambiato');
      const h2 = mk(async () => resp({status: 404}));
      ok(await h2.app.fetchCharset('vdc') === null && h2.last()[0] === 'bad' && h2.app.charset === null, 'fetchCharset: 404: messaggio, nessun set cambiato (' + h2.last()[1].slice(0, 50) + ')');
      const h3 = mk(async () => { throw new TypeError('Failed to fetch'); });
      ok(await h3.app.fetchCharset('ef') === null && h3.last()[0] === 'bad' && h3.app.efCharset === null, 'fetchCharset: rete assente: messaggio');
      let threw = null;
      try { await mk(serve(csrc)).app.fetchCharset('zzz'); } catch (e) { threw = e; }
      ok(threw && /sconosciuto/.test(threw.message), 'fetchCharset: tipo sconosciuto: errore');
      const h4 = mk(serve(csrc));
      h4.app.net = {busy: true, ctl: null, received: 0, total: null, host: 'x'};
      ok(await h4.app.fetchCharset('vdc') === null && /già in corso/.test(h4.last()[1]) && h4.app.charset === null, 'fetchCharset: scarico gia\' in corso: rifiutato');
    }
    // punto unico di caricamento (openFiles): un sorgente C con la tabella e' un set di caratteri, messo in uso subito; un testo senza tabella e' un file qualunque
    {
      const h = mk(serve(csrc));
      await h.app.openFiles([{name: 'cset.c', bytes: csrc}]);
      ok(h.app.charset && E.setsEqual(h.app.charset, vdc) && h.app.charsetName === 'cset.c', 'openFiles: cset.c e\' il set del chip video, in uso');
      ok(/Set del chip video letto da «cset\.c» \(tabella C di 512 valori\)/.test(h.texts().join('|')) && /senza riavviare/.test(h.texts().join('|')), 'openFiles: messaggio del sorgente C: ' + h.texts().join(' | ').slice(-140));
      ok(h.app.lib.games.length === 0 && h.app.lib.bios.length === 0, 'openFiles: il sorgente C non entra nell\'elenco di giochi e BIOS');
      const h2 = mk(serve(csrc));
      await h2.app.openFiles([{name: 'note.txt', bytes: text('niente di utile qui')}]);
      ok(h2.app.charset === null && /Nessun gioco o BIOS/.test(h2.texts().join('|')), 'openFiles: un testo senza tabella e\' un file qualunque (nessun set cambiato)');
      E.KNOWN.push({kind: 'ef', crc: zlib.crc32(efRom), label: 'ROM di prova'});
      try {
        const h3 = mk(serve(csrc));
        await h3.app.openFiles([{name: 'vpp_cset.c', bytes: vpp}]);
        ok(h3.app.efCharset && E.setsEqual(h3.app.efCharset, efRom) && /Set dell’EF9341 letto da «vpp_cset\.c»/.test(h3.texts().join('|')), 'openFiles: vpp_cset.c con impronta nota: ROM dell\'EF9341 in uso');
      } finally { E.KNOWN.pop(); }
      const h4 = mk(serve(csrc));
      await h4.app.openFiles([{name: 'cset.bin', bytes: vdc}]);
      ok(h4.app.charset && E.setsEqual(h4.app.charset, vdc), 'openFiles: un .bin di 512 byte resta un set di caratteri (percorso binario)');
    }
    // caricamento automatico all'apertura (autoLoadCharsets): legge i due sorgenti, mai sopra un set dell'utente, errori di rete = un solo avviso e il GPL resta
    {
      E.KNOWN.push({kind: 'ef', crc: zlib.crc32(efRom), label: 'ROM di prova'});
      try {
        const byUrl = (map) => { const f = async (url, init) => { f.calls.push({url, init}); const b = map[url]; return b ? resp({chunks: [b]}) : resp({status: 404}); }; f.calls = []; return f; };
        const U = Net.CHARSET_SOURCES;
        const fullMap = {[U.vdc.url]: csrc, [U.ef.url]: vpp};
        // il costruttore non scarica niente
        { const f = byUrl(fullMap); mk(f); ok(f.calls.length === 0, 'autoLoad: costruire l\'app non fa nessuna richiesta'); }
        // tutto bene: due richieste, due set in uso, un solo messaggio
        {
          const f = byUrl(fullMap), h = mk(f);
          const r = await h.app.autoLoadCharsets();
          ok(r.vdc === 'ok' && r.ef === 'ok', 'autoLoad: esito ok / ok');
          ok(f.calls.length === 2 && f.calls[0].url === U.vdc.url && f.calls[1].url === U.ef.url, 'autoLoad: una richiesta per set, agli indirizzi previsti, nell\'ordine chip video / EF9341');
          ok(f.calls.every((c) => c.init && c.init.credentials === 'omit' && c.init.method === 'GET'), 'autoLoad: GET anonimi, senza credenziali');
          ok(h.app.charset && E.setsEqual(h.app.charset, vdc) && h.app.charsetName === 'cset.c (O2EM)' && h.app.efCharset && E.setsEqual(h.app.efCharset, efRom) && h.app.efCharsetName === 'vpp_cset.c (O2EM)', 'autoLoad: i due set sono in uso');
          ok(h.msgs.length === 1 && h.last()[0] === 'good' && /chip video e EF9341/.test(h.last()[1]), 'autoLoad: un solo messaggio, positivo: ' + h.texts().join(' | '));
          ok(h.app.net.busy === false, 'autoLoad: stato di rete a riposo');
        }
        // c'era gia' un set dell'utente (file, sessione): niente richiesta per quello, il suo set resta
        {
          const f = byUrl(fullMap), h = mk(f);
          const mine = rb(512);
          h.app.charset = mine; h.app.charsetName = 'mio.bin';
          const r = await h.app.autoLoadCharsets();
          ok(r.vdc === 'skip' && r.ef === 'ok' && f.calls.length === 1 && f.calls[0].url === U.ef.url && h.app.charset === mine && h.app.charsetName === 'mio.bin', 'autoLoad: un set dell\'utente non si tocca e non si scarica');
          const f2 = byUrl(fullMap), h2 = mk(f2);
          h2.app.charset = rb(512); h2.app.charsetName = 'a.bin'; h2.app.efCharset = rb(2560); h2.app.efCharsetName = 'b.bin';
          const r2 = await h2.app.autoLoadCharsets();
          ok(r2.vdc === 'skip' && r2.ef === 'skip' && f2.calls.length === 0 && h2.msgs.length === 0, 'autoLoad: con tutti e due i set dell\'utente non fa nessuna richiesta ne\' messaggio');
        }
        // l'utente mette il suo set mentre lo scarico e' in corso: vince il suo
        {
          const h = mk(null);
          let release;
          const gate = new Promise((r) => { release = r; });
          h.app.fetchImpl = async (url) => { await gate; return resp({chunks: [url === U.vdc.url ? csrc : vpp]}); };
          const p = h.app.autoLoadCharsets();
          await new Promise((r) => setTimeout(r, 5));
          const mine = rb(512);
          h.app.charset = mine; h.app.charsetName = 'arrivato.bin';
          release();
          const r = await p;
          ok(r.vdc === 'skip' && h.app.charset === mine && h.app.charsetName === 'arrivato.bin', 'autoLoad: il set messo dall\'utente durante lo scarico non viene sostituito');
        }
        // senza rete: la prima richiesta fallisce, la seconda non si tenta, un solo avviso, il GPL resta
        {
          const calls = [];
          const h = mk(async (url) => { calls.push(url); throw new TypeError('Failed to fetch'); });
          const r = await h.app.autoLoadCharsets();
          ok(r.vdc === 'fail' && r.ef === 'fail' && calls.length === 1, 'autoLoad: rete assente: una sola richiesta (' + calls.length + ')');
          ok(h.app.charset === null && h.app.efCharset === null, 'autoLoad: rete assente: restano i set GPL');
          ok(h.msgs.length === 1 && h.last()[0] === 'warn' && /uso il set GPL incluso/.test(h.last()[1]) && /Aggiungi file/.test(h.last()[1]) && /chip video e EF9341/.test(h.last()[1]), 'autoLoad: rete assente: un solo avviso: ' + h.texts().join(' | '));
        }
        // il sito risponde ma il file non e' quello (404 su uno, tabella sbagliata sull'altro)
        {
          const h = mk(byUrl({[U.ef.url]: vpp}));
          const r = await h.app.autoLoadCharsets();
          ok(r.vdc === 'fail' && r.ef === 'ok' && h.app.efCharset && h.app.charset === null, 'autoLoad: 404 sul chip video: il secondo set si carica lo stesso');
          ok(h.msgs.length === 2 && h.msgs[0][0] === 'good' && /EF9341\./.test(h.msgs[0][1]) && h.msgs[1][0] === 'warn' && /il set di caratteri \(chip video\)/.test(h.msgs[1][1]), 'autoLoad: messaggi: ' + h.texts().join(' | '));
          const h2 = mk(byUrl({[U.vdc.url]: text('niente di utile'), [U.ef.url]: text('niente')}));
          const r2 = await h2.app.autoLoadCharsets();
          ok(r2.vdc === 'fail' && r2.ef === 'fail' && h2.app.charset === null && h2.app.efCharset === null && h2.last()[0] === 'warn', 'autoLoad: file senza tabella: GPL, un avviso');
        }
        // scarico gia' in corso: nessun messaggio per l'automatico, niente cambia
        {
          const f = byUrl(fullMap), h = mk(f);
          h.app.net = {busy: true, ctl: null, received: 0, total: null, host: 'x'};
          const r = await h.app.autoLoadCharsets();
          ok(f.calls.length === 0 && r.vdc === 'fail' && h.app.charset === null, 'autoLoad: con uno scarico in corso non parte (nessuna richiesta)');
        }
      } finally { E.KNOWN.pop(); }
    }
    // con una console in corso il set cambia a caldo (stessa console)
    {
      const h = mk(serve(csrc));
      await h.app.openFiles([F('bios.bin', BIOS), F('Alfa (1981)(X)(EU).bin', CART_A)]);
      h.app.start(h.app.lib.games[0].id);
      const con = h.app.con;
      ok(await h.app.fetchCharset('vdc') !== null && h.app.con === con && E.setsEqual(con.vdc.charset, vdc), 'fetchCharset: con la partita in corso la console non riparte e usa il set scaricato');
    }
    // fetchUrl e il resto restano come prima (lo scarico dei giochi passa dalle stesse funzioni)
    {
      const h = mk(serve(zip([['Alfa (1981)(X)(EU).bin', CART_A]])));
      const r = await h.app.fetchUrl('https://example.org/x.zip', 'games');
      ok(r && r.kind === 'games' && h.app.lib.games.length === 1, 'fetchUrl dopo il refactoring: giochi da zip');
    }
  }

  finished = true;
  console.log((fails ? 'FALLITO' : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERRORE ' + (e && e.stack || e)); process.exit(1); });

function text(s) { return new TextEncoder().encode(s); }
