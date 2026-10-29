'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// app_extra.js - regista (app.js): messaggi esatti, campi di stato dopo ogni operazione, passo a tempo, confini. Senza dump: BIOS e
// cartucce sono byte casuali (la console li esegue come qualunque altro programma). Usato da test_app.js.
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const {App, layoutSize, sniffSession, sniffState, MIN_RESUME_FRAMES} = require(SP('app.js'));
const S = require(SP('session.js'));
const {Console} = require(SP('console.js'));
const {zipStore} = require(SP('zipstore.js'));
const {sha256} = require(SP('sha256.js'));
const charsetOwn = require('../hw/charset_own.js');
const FALLBACK = new Uint8Array(charsetOwn.build());
const MANCA = 'Si usa il set di caratteri GPL incluso nella pagina (512 byte, disegnato da zero): va bene per il menu, ma i simboli speciali di alcuni giochi non coincidono e certi giochi possono risultare ingiocabili. Puoi correggerlo nell’«Editor dei caratteri» o aggiungere l’originale in «Macchina e giochi».';

module.exports = async function appExtra(ok, eq) {
  let seed = 321;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rb = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b; };
  const BIOS_A = rb(1024), BIOS_B = rb(1024);
  const CART = {a: rb(2048), b: rb(2048), c: rb(4096), big: rb(10240)};
  const F = (name, bytes) => ({name, bytes});
  const mkApp = (sink) => {
    const msgs = [];
    const app = new App({onMessage: (t, k) => msgs.push([k, t]), sink, fallbackCharset: FALLBACK});
    return {app, msgs, last: () => msgs[msgs.length - 1], texts: () => msgs.map((m) => m[1]), clear: () => { msgs.length = 0; }};
  };
  const loaded = async (sink) => {
    const h = mkApp(sink);
    await h.app.openFiles([F('bios uno.bin', BIOS_A), F('Alfa (1981)(X)(EU).bin', CART.a), F('Beta, The (1982)(Y)(US).bin', CART.b)]);
    h.clear();
    return h;
  };
  const step = (app, ts) => app.step(ts);
  const runN = (app, n) => { let t = 10000, done = 0; while (done < n) { t += 20.2; done += app.step(t); } };
  const throwsMsg = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

  // ---- costruttore e valori iniziali
  {
    ok(throwsMsg(() => new App({})) === 'manca il set di caratteri di ripiego' && throwsMsg(() => new App()) === 'manca il set di caratteri di ripiego' &&
      throwsMsg(() => new App({fallbackCharset: new Uint8Array(511)})) === 'manca il set di caratteri di ripiego' &&
      throwsMsg(() => new App({fallbackCharset: new Uint8Array(513)})) === 'manca il set di caratteri di ripiego' &&
      throwsMsg(() => new App({fallbackCharset: new Array(512).fill(0)})) === 'manca il set di caratteri di ripiego', 'costruttore: set di ripiego obbligatorio');
    const a = new App({fallbackCharset: FALLBACK});
    eq(a.settings, {standard: 'PAL', scale: 0, aspect: 'tv', integer: false, volume: 0.8, muted: false, pinB: 'auto', swapPads: false}, 'impostazioni iniziali');
    eq(a.padPrefs, {1: 'auto', 2: 'auto'}, 'gamepad iniziali');
    ok(a.charset === null && a.charsetName === '' && a.biosId === null && a.gameId === null && a.con === null && a.audio === null && a.paused === false && a.acc === 0 &&
      a.last === null && a.runMs === 0 && a.blackWarned === false && a.framesRun === 0 && a.rev === 0 && Array.isArray(a.msPerFrame) && a.msPerFrame.length === 0 && a.states.size === 0 &&
      a.sink === null && a.bios === null && a.game === null && a.running === false && a.activeCharset === FALLBACK && a.audioPaced === false, 'campi iniziali');
    a.msg('x');   // senza onMessage: niente
    const got = []; const b = new App({onMessage: (t, k) => got.push([t, k]), fallbackCharset: FALLBACK});
    b.msg('ciao'); b.msg('ciao', 'good'); b.msg('ciao', 0);
    eq(got, [['ciao', ''], ['ciao', 'good'], ['ciao', '']], 'msg: tipo di default');
    const r0 = a.rev; a.changed(); ok(a.rev === r0 + 1, 'changed sale di 1');
    ok(a.takeStats() === null && a.step(5) === 0 && a.resetConsole() === false && a.saveStateFile() === null, 'senza console: niente');
  }

  // ---- layout e riconoscimento dei file
  {
    const L = layoutSize;
    ok(L(1100, 800, 1, 'square', true).factor === 1 && L(1100, 800, 2, 'tv', false).factor === 2 && L(0, 0, 1, 'tv').w === 360, 'layout: scala fissa 1 e 2');
    ok(L(0, 800, 0, 'tv', true).factor === 1 && L(1100, 0, 0, 'tv', true).factor === 1 && L(-5, 800, 0, 'tv').factor === 1 && L(1100, -1, 0, 'tv').factor === 1, 'layout: area nulla o negativa');
    ok(L(400, 300, 0, 'square', true).factor === 1 && Math.abs(L(400, 300, 0, 'square', false).factor - 400 / 360) < 1e-9, 'layout: tra 1 e 2 con interi = 1');
    ok(L(360, 243, 0, 'square', true).factor === 1 && L(719, 486, 0, 'square', true).factor === 1 && L(720, 486, 0, 'square', true).factor === 2, 'layout: confini degli interi');
    ok(L(1, 1, 0, 'square', true).factor < 0.01 && L(200, 1000, 0, 'tv').factor === 200 / 360, 'layout: riduzione e larghezza limite');
    const sp = (n) => new Uint8Array(n).fill(0x20), enc = (s) => new TextEncoder().encode(s);
    const j = (pre, s) => { const b = new Uint8Array(pre.length + s.length); b.set(pre); b.set(enc(s), pre.length); return b; };
    ok(sniffState(j(sp(0), '{}')) && sniffState(j(sp(63), '{}')) && sniffState(j(sp(64), '{}')) && !sniffState(j(sp(65), '{}')), 'sniffState: fino a 64 spazi');
    for (const c of [0x20, 0x0A, 0x0D, 0x09]) ok(sniffState(j(new Uint8Array([c]), '{')), 'sniffState: spazio ' + c);
    for (const c of [0x0B, 0x0C, 0x00, 0x21, 0x0E, 0x08, 0x1F, 0x21, 0xFF, 0x5B]) ok(!sniffState(j(new Uint8Array([c]), '{')), 'sniffState: byte ' + c + ' non e\' uno spazio');
    ok(!sniffState(sp(70)) && !sniffState(new Uint8Array(0)) && !sniffState(enc('[1]')) && sniffState(enc('{')), 'sniffState: altri');
    ok(sniffSession(zipStore([{name: 'sessione.json', data: new Uint8Array(1)}, {name: 'x', data: new Uint8Array(1)}])) && !sniffSession(new Uint8Array([0x50, 0x4B, 3, 4, 1, 2])), 'sniffSession');
  }

  // ---- aggiunta di file: messaggi
  {
    const h = mkApp(null), a = h.app;
    let r = await a.addFiles([F('b.bin', BIOS_A), F('Alfa.bin', CART.a)]);
    eq(h.msgs, [['good', 'Aggiunti all’elenco: 1 gioco e 1 BIOS.']], 'aggiunta: un gioco e un BIOS');
    ok(r.games === 1 && r.bios === 1 && r.dups === 0 && r.files === 2 && r.skipped.length === 0 && r.errors.length === 0, 'aggiunta: rapporto');
    ok(a.biosId === a.lib.bios[0].id && a.rev > 0, 'aggiunta: BIOS scelto in automatico');
    h.clear();
    await a.addFiles([F('Beta.bin', CART.b), F('Gamma.bin', CART.c)]);
    eq(h.msgs, [['good', 'Aggiunti all’elenco: 2 giochi.']], 'aggiunta: due giochi');
    h.clear();
    await a.addFiles([F('Delta.bin', CART.big), F('Alfa.bin', CART.a)]);
    eq(h.msgs, [['good', 'Aggiunti all’elenco: 1 gioco (1 doppioni ignorati).']], 'aggiunta: con un doppione');
    h.clear();
    await a.addFiles([F('Alfa.bin', CART.a), F('b.bin', BIOS_A)]);
    eq(h.msgs, [['warn', 'Niente di nuovo: 2 file erano gia’ nell’elenco.']], 'aggiunta: solo doppioni');
    h.clear();
    await a.addFiles([F('vuoto.bin', new Uint8Array(0))]);
    eq(h.msgs, [['warn', 'Nessun gioco o BIOS trovato nei file scelti.'], ['warn', '1 file saltati: vuoto.bin: file vuoto']], 'aggiunta: niente di utilizzabile');
    h.clear();
    await a.addFiles([F('v1.bin', new Uint8Array(0)), F('v2.bin', new Uint8Array(0)), F('v3.bin', new Uint8Array(0))]);
    eq(h.msgs[1], ['warn', '3 file saltati: v1.bin: file vuoto; v2.bin: file vuoto; v3.bin: file vuoto'], 'aggiunta: tre saltati, nessun «...»');
    h.clear();
    await a.addFiles([F('v1.bin', new Uint8Array(0)), F('v2.bin', new Uint8Array(0)), F('v3.bin', new Uint8Array(0)), F('v4.bin', new Uint8Array(0))]);
    eq(h.msgs[1], ['warn', '4 file saltati: v1.bin: file vuoto; v2.bin: file vuoto; v3.bin: file vuoto; ...'], 'aggiunta: quattro saltati');
    h.clear();
    const bad = (n) => F('rotto' + n + '.zip', new Uint8Array([0x50, 0x4B, 3, 4, 0, 0, 0, 0]));
    await a.addFiles([bad(1), bad(2), bad(3), bad(4)]);
    ok(h.msgs.length === 1 + 4 && h.msgs.slice(1).every((m) => m[0] === 'bad' && /^rotto\d\.zip: /.test(m[1])), 'aggiunta: quattro errori, uno per messaggio (' + h.msgs.length + ')');
    h.clear();
    await a.addFiles([bad(1), bad(2), bad(3), bad(4), bad(5), bad(6)]);
    ok(h.msgs.length === 1 + 4 + 1 && h.last()[0] === 'bad' && h.last()[1] === '...e altri 2 errori.', 'aggiunta: oltre quattro errori: ' + h.last()[1]);
    h.clear();
    await a.addFiles([bad(1), bad(2), bad(3), bad(4), bad(5)]);
    ok(h.last()[1] === '...e altri 1 errori.', 'aggiunta: cinque errori');
    // nessun BIOS utilizzabile
    const h2 = mkApp(null);
    await h2.app.addFiles([F('bios due.bin', rb(2048))]);
    eq(h2.msgs.map((m) => m[1]), ['Aggiunti all’elenco: 1 BIOS.', 'I BIOS caricati non sono utilizzabili: BIOS da 2048 byte: formato non supportato (solo 1024 byte).'], 'BIOS da 2 KB: segnalato');
    ok(h2.app.biosId === null && h2.app.autoBios() === false, 'BIOS da 2 KB: nessuno scelto');
    h2.clear();
    ok(h2.app.autoBios() === false && h2.msgs.length === 1, 'autoBios: stesso messaggio');
    // il BIOS scelto resta se se ne aggiunge un altro
    const first = a.biosId; await a.addFiles([F('altro.bin', BIOS_B)]); ok(a.biosId === first && a.lib.bios.length === 2, 'un altro BIOS non cambia la scelta');
  }

  // ---- set di caratteri
  {
    const h = mkApp(null), a = h.app;
    ok(a.setCharset('cs.bin', rb(512)) === true && a.charsetName === 'cs.bin' && a.charset.length === 512 && a.activeCharset === a.charset, 'charset: 512 byte');
    eq(h.last(), ['good', 'Set di caratteri dell’utente: cs.bin. Vale dal prossimo avvio.'], 'charset: messaggio');
    const r = a.rev;
    a.clearCharset(); ok(a.charset === null && a.charsetName === '' && a.rev === r + 1 && a.activeCharset === FALLBACK, 'clearCharset');
    ok(a.setCharset('cs.bin', rb(100)) === false && a.charset === null, 'charset: 100 byte rifiutato');
    eq(h.last(), ['bad', 'Il set di caratteri deve essere di 512 byte (questo ne ha 100).'], 'charset: messaggio di dimensione');
    ok(a.setCharset('cs.bin', rb(513)) === false && /ne ha 513/.test(h.last()[1]), 'charset: 513 byte');
    ok(a.setCharset('z.zip', zipStore([{name: 'in/dentro.bin', data: rb(512)}])) === true && a.charsetName === 'in/dentro.bin', 'charset: da uno zip (nome della voce)');
    ok(a.setCharset('z.zip', zipStore([{name: 'dentro.rom', data: rb(512)}])) === true && a.charsetName === 'dentro.rom', 'charset: .rom in uno zip');
    ok(a.setCharset('z.zip', zipStore([{name: 'x.txt', data: rb(512)}, {name: 'y.txt', data: rb(512)}])) === false && h.last()[0] === 'bad' && /^z\.zip: nello zip non c.e. nessun file/.test(h.last()[1]) && /\.$/.test(h.last()[1]), 'charset: zip senza .bin');
    ok(a.setCharset('z.zip', new Uint8Array([0x50, 0x4B, 3, 4, 1, 2, 3])) === false && /^z\.zip: /.test(h.last()[1]), 'charset: zip rotto');
  }

  // ---- set di caratteri come ingresso (tappa 4): si riconosce dalla dimensione, anche in uno zip; se cambia mentre gira, riavvio a freddo
  {
    const CS1 = rb(512), CS2 = rb(512);
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    // in mezzo a BIOS e giochi
    const h = mkApp(null), a = h.app;
    await a.openFiles([F('b.bin', BIOS_A), F('Alfa (1981)(X)(EU).bin', CART.a), F('chars.bin', CS1)]);
    ok(a.charset && a.charsetName === 'chars.bin' && same(a.charset, CS1) && a.lib.games.length === 1 && a.lib.bios.length === 1, 'set di caratteri tra i file: riconosciuto e non e\' un gioco');
    eq(h.texts(), ['Aggiunti all’elenco: 1 gioco e 1 BIOS.', 'Set di caratteri dell’utente: chars.bin. Vale dal prossimo avvio.'], 'messaggi: prima l\'elenco, poi il set di caratteri');
    ok(a.charsetSha === sha256(CS1), 'charsetSha');
    // da solo: un solo messaggio (niente «Nessun gioco o BIOS»)
    const h2 = mkApp(null);
    await h2.app.openFiles([F('chars.bin', CS1)]);
    eq(h2.msgs, [['good', 'Set di caratteri dell’utente: chars.bin. Vale dal prossimo avvio.']], 'solo il set di caratteri: un solo messaggio');
    ok(h2.app.lib.games.length === 0 && h2.app.lib.bios.length === 0, 'solo il set di caratteri: elenco vuoto');
    // dentro uno zip, accanto a un gioco
    const h3 = mkApp(null);
    await h3.app.openFiles([F('raccolta.zip', zipStore([{name: 'Firmware/charset.bin', data: CS1}, {name: 'Games/G (1981)(X)(EU).bin', data: CART.a}]))]);
    ok(h3.app.charsetName === 'charset.bin' && h3.app.lib.games.length === 1 && same(h3.app.charset, CS1), 'set di caratteri in uno zip con un gioco');
    // due diversi: nessuno applicato; due uguali: il primo; molti: nomi troncati
    const h4 = mkApp(null);
    await h4.app.openFiles([F('uno.bin', CS1), F('due.bin', CS2)]);
    ok(h4.app.charset === null, 'due set diversi: nessuno applicato');
    eq(h4.msgs, [['warn', 'Trovati 2 file diversi da 512 byte (uno.bin, due.bin): non so quale sia il set di caratteri. Aggiungi solo quello giusto con «Aggiungi file».']], 'due set diversi: avviso');
    const h5 = mkApp(null);
    await h5.app.openFiles([F('uno.bin', CS1), F('copia.bin', CS1)]);
    ok(h5.app.charsetName === 'uno.bin' && h5.msgs.length === 1, 'due copie dello stesso set: si usa il primo');
    const h6 = mkApp(null);
    await h6.app.openFiles([F('a.bin', rb(512)), F('b.bin', rb(512)), F('c.bin', rb(512)), F('d.bin', rb(512))]);
    eq(h6.last(), ['warn', 'Trovati 4 file diversi da 512 byte (a.bin, b.bin, c.bin, ...): non so quale sia il set di caratteri. Aggiungi solo quello giusto con «Aggiungi file».'], 'quattro set: nomi troncati');
    // lo stesso set gia' in uso mentre gira: nessun riavvio
    const hh = await loaded(null), ap = hh.app;
    ap.setCharset('u.bin', CS1);
    ap.start(ap.lib.games[0].id); runN(ap, 40); hh.clear();
    const con0 = ap.con, gid = ap.gameId;
    ok(ap.setCharset('u2.bin', CS1) === true && ap.con === con0 && ap.framesRun >= 40, 'stesso set mentre gira: nessun riavvio');
    eq(hh.msgs, [['good', 'Set di caratteri dell’utente: u2.bin (e’ gia’ quello in uso).']], 'stesso set: messaggio');
    // set diverso mentre gira: la partita si memorizza e la console riparte a freddo, stesso gioco, nuovo set
    hh.clear();
    ok(ap.setCharset('nuovo.bin', CS2) === true, 'set diverso mentre gira');
    ok(ap.con !== con0 && ap.running && ap.gameId === gid && ap.framesRun === 0 && ap.hasState(gid) && ap.con.hashes.charset === sha256(CS2), 'riavvio a freddo: stesso gioco, partita memorizzata, console col set nuovo');
    eq(hh.msgs, [['good', 'Set di caratteri dell’utente: nuovo.bin: la console riparte (avvio a freddo del gioco in uso; la partita precedente resta memorizzata).']], 'set diverso: un solo messaggio');
    // ripiego mentre gira: riavvio a freddo (e la nota del set mancante); se era gia' il ripiego, niente
    runN(ap, 40); hh.clear();
    const con1 = ap.con;
    ap.clearCharset();
    ok(ap.con !== con1 && ap.charset === null && ap.activeCharset === FALLBACK && ap.framesRun === 0 && ap.gameId === gid, 'ripiego mentre gira: riavvio a freddo');
    eq(hh.msgs, [['', 'Set di caratteri di ripiego: la console riparte (avvio a freddo del gioco in uso; la partita precedente resta memorizzata).'], ['warn', MANCA]], 'ripiego: messaggi');
    const con2 = ap.con; hh.clear();
    ap.clearCharset();
    ok(ap.con === con2 && hh.msgs.length === 0, 'ripiego gia\' in uso: niente');
    // senza cartuccia: riparte senza cartuccia
    const h7 = await loaded(null), a7 = h7.app;
    a7.start(null); runN(a7, 40); h7.clear();
    a7.setCharset('c.bin', CS1);
    ok(a7.running && a7.gameId === null && a7.framesRun === 0 && /^Set di caratteri dell’utente: c\.bin: la console riparte/.test(h7.texts()[0]), 'senza cartuccia: riparte senza cartuccia');
  }

  // ---- avvio
  {
    const h = mkApp(null), a = h.app;
    ok(a.start(null) === false, 'avvio senza BIOS');
    eq(h.last(), ['warn', 'Scegli prima un BIOS utilizzabile (1024 byte, G7000 / Odyssey 2).'], 'avvio senza BIOS: messaggio');
    await a.openFiles([F('b.bin', BIOS_A), F('Alfa (1981)(X)(EU).bin', CART.a), F('Beta, The (1982)(Y)(US).bin', CART.b), F('Big.bin', CART.big)]);
    const ga = a.lib.games.find((g) => /Alfa/.test(g.name)), gb = a.lib.games.find((g) => /Beta/.test(g.name)), gbig = a.lib.games.find((g) => /Big/.test(g.name));
    h.clear();
    ok(a.start(9999) === false, 'avvio di un gioco inesistente');
    eq(h.last(), ['bad', 'Gioco non trovato nell’elenco.'], 'avvio: gioco non trovato');
    ok(a.con === null, 'avvio fallito: nessuna console');
    // campi sporchi, poi avvio: tutto azzerato
    a.acc = 5; a.last = 3; a.runMs = 9; a.blackWarned = true; a.framesRun = 7; a.msPerFrame = [1]; a.paused = true;
    h.clear();
    ok(a.start(ga.id) === true && a.running && a.gameId === ga.id && a.game === ga, 'avvio di Alfa');
    ok(a.acc === 0 && a.last === null && a.runMs === 0 && a.blackWarned === false && a.framesRun === 0 && a.msPerFrame.length === 0 && a.paused === false, 'avvio: orologio e contatori azzerati');
    eq(h.msgs, [['warn', MANCA]], 'avvio: nota sul set di caratteri mancante');
    a.setCharset('cs.bin', rb(512)); h.clear();
    a.start(ga.id); eq(h.msgs, [], 'avvio con set di caratteri dell’utente: nessuna nota');
    h.clear();
    a.start(null);
    eq(h.msgs, [['warn', 'Nessuna cartuccia: senza cartuccia il BIOS puo’ lasciare lo schermo nero. Scegli un gioco dall’elenco.']], 'avvio senza cartuccia: nota');
    ok(a.gameId === null && a.running, 'avvio senza cartuccia: console in funzione');
    a.start(undefined); ok(a.gameId === null && a.running, 'avvio con undefined = nessuna cartuccia');
    h.clear();
    a.start(gbig.id);
    ok(h.msgs.length === 1 && h.msgs[0][0] === 'warn' && /^Cartuccia non supportata: .+\.$/.test(h.msgs[0][1]), 'avvio: cartuccia 10 KB non supportata (' + h.msgs.map((m) => m[1]) + ')');
    // memorizzazione automatica al cambio gioco
    a.start(ga.id); a.framesRun = MIN_RESUME_FRAMES - 1; h.clear();
    a.start(gb.id);
    ok(!a.hasState(ga.id) && h.msgs.every((m) => !/memorizzato/.test(m[1])), 'cambio gioco con 29 fotogrammi: niente da memorizzare');
    a.start(ga.id); a.framesRun = MIN_RESUME_FRAMES; h.clear();
    a.start(gb.id);
    ok(a.hasState(ga.id) && h.msgs[0][0] === '' && h.msgs[0][1] === 'Stato di «Alfa» memorizzato.', 'cambio gioco con 30 fotogrammi: memorizzato (' + h.texts() + ')');
    // restart dello stesso gioco: non memorizza
    a.forgetState(ga.id); a.start(ga.id); a.framesRun = 500; h.clear();
    a.restart(); ok(!a.hasState(ga.id) && h.msgs.every((m) => !/memorizzato/.test(m[1])) && a.framesRun === 0, 'restart: non memorizza, riparte da zero');
    // dal gioco alla console senza cartuccia: memorizza
    a.framesRun = 100; a.start(null); ok(a.hasState(ga.id), 'dal gioco a nessuna cartuccia: memorizzato');
    // BIOS non utilizzabile in uso
    const h3 = mkApp(null);
    await h3.app.openFiles([F('bios due.bin', rb(2048)), F('b.bin', BIOS_A)]);
    const u = h3.app.lib.bios.find((b) => !b.supported); h3.app.biosId = u.id; h3.clear();
    ok(h3.app.start(null) === false, 'avvio con BIOS non utilizzabile');
    eq(h3.last(), ['warn', 'Il BIOS scelto non e’ utilizzabile: BIOS da 2048 byte: formato non supportato (solo 1024 byte).'], 'avvio: messaggio BIOS non utilizzabile');
    // console che non si costruisce
    const h4 = await loaded(null); const g4 = h4.app.lib.games[0]; h4.app._buildConsole = () => { throw new Error('guasto finto'); };
    ok(h4.app.start(g4.id) === false && h4.last()[1] === 'Avvio impossibile: guasto finto' && h4.last()[0] === 'bad' && !h4.app.running, 'avvio: console non costruibile');
    // standard NTSC all'avvio
    const h5 = await loaded(null); h5.app.settings.standard = 'NTSC'; h5.app.start(null);
    ok(h5.app.con.standard === 'NTSC' || h5.app.con.t.ntsc === true, 'avvio in NTSC');
  }

  // ---- riprendi
  {
    const h = await loaded(null), a = h.app;
    const [ga, gb] = a.lib.games;
    ok(a.resume(ga.id) === false && h.last()[0] === 'warn' && h.last()[1] === 'Nessuno stato memorizzato per questo gioco.', 'riprendi senza stato');
    ok(a.resume(9999) === false, 'riprendi un gioco inesistente');
    a.start(ga.id); runN(a, 40); a.start(gb.id);
    ok(a.hasState(ga.id), 'stato di Alfa memorizzato');
    runN(a, 40); h.clear();
    const bstate = a.states.get(ga.id);
    ok(a.resume(ga.id) === true && a.gameId === ga.id && a.framesRun === MIN_RESUME_FRAMES, 'riprendi Alfa');
    eq(h.msgs, [['good', 'Ripresa la partita di «Alfa».']], 'riprendi: messaggio (nessuna nota sul set perche’ gli avvisi sono solo se ci sono)');
    ok(a.hasState(gb.id), 'riprendi: la partita lasciata (Beta, 40 fotogrammi) e’ memorizzata');
    a.framesRun = 0; a.resume(ga.id); ok(a.hasState(gb.id), 'riprendi lo stesso gioco: niente di sbagliato');
    // un altro BIOS
    await a.addFiles([F('b2.bin', BIOS_B)]); h.clear();
    const b2 = a.lib.bios.find((b) => b.sha !== a.bios.sha);
    a.selectBios(b2.id); h.clear();
    ok(a.resume(ga.id) === false, 'riprendi con un altro BIOS: rifiutato');
    eq(h.last(), ['warn', 'Lo stato di «Alfa» e’ stato salvato con un altro BIOS («' + a.lib.bios[0].display + '»): scegli quel BIOS per riprenderlo. Lo stato resta memorizzato.'], 'riprendi: messaggio dell’altro BIOS');
    ok(a.hasState(ga.id), 'riprendi rifiutato: stato intatto');
    a.states.get(ga.id).hashes.bios = 'f'.repeat(64);
    a.resume(ga.id);
    eq(h.last(), ['warn', 'Lo stato di «Alfa» e’ stato salvato con un altro BIOS (non e’ nell’elenco): scegli quel BIOS per riprenderlo. Lo stato resta memorizzato.'], 'riprendi: BIOS non nell’elenco');
    // standard diverso
    const h2 = await loaded(null), a2 = h2.app, g2 = a2.lib.games[0];
    a2.start(g2.id); a2.framesRun = 100; a2.memorize(false);
    a2.settings.standard = 'NTSC'; h2.clear();
    ok(a2.resume(g2.id) === false, 'riprendi con un altro standard: rifiutato');
    eq(h2.last(), ['warn', 'Lo stato di «Alfa» e’ stato salvato in PAL: scegli lo standard PAL per riprenderlo. Lo stato resta memorizzato.'], 'riprendi: messaggio dello standard');
    // nessun BIOS utilizzabile
    a2.settings.standard = 'PAL'; a2.biosId = null; h2.clear();
    ok(a2.resume(g2.id) === false && h2.last()[0] === 'warn' && h2.last()[1] === 'Scegli prima un BIOS utilizzabile.', 'riprendi senza BIOS');
    // stato rovinato
    const h3 = await loaded(null), a3 = h3.app, g3 = a3.lib.games[0];
    a3.start(g3.id); a3.framesRun = 100; a3.memorize(false); a3.states.get(g3.id).cpu = null; h3.clear();
    ok(a3.resume(g3.id) === false && h3.last()[0] === 'bad' && h3.last()[1].length > 5 && !/NaN/.test(h3.last()[1]), 'riprendi con uno stato rovinato: ' + h3.last()[1]);
    a3.states.get(g3.id).cpu = 5; h3.clear(); a3.resume(g3.id);
    ok(h3.last()[0] === 'bad', 'riprendi con CPU non valida');
    // stateInfo
    const si = a.stateInfo(ga.id);
    ok(si && si.standard === 'PAL' && si.bios === 'f'.repeat(64) && si.biosName === '' && si.sameBios === false && a.stateInfo(9999) === null, 'stateInfo: BIOS sconosciuto');
    const si2 = a2.stateInfo(g2.id);
    ok(si2.biosName === a2.lib.bios[0].display && si2.bios === a2.lib.bios[0].sha && si2.sameBios === false, 'stateInfo: nessun BIOS in uso -> sameBios falso');
    a2.biosId = a2.lib.bios[0].id; ok(a2.stateInfo(g2.id).sameBios === true, 'stateInfo: stesso BIOS');
    ok(a2.forgetState(g2.id) === true && a2.forgetState(g2.id) === false && !a2.hasState(g2.id), 'forgetState');
    const rv = a2.rev; a2.forgetState(1); ok(a2.rev === rv + 1, 'forgetState cambia la pagina');
  }

  // ---- reset, BIOS, standard, pausa, scarico
  {
    const h = await loaded(null), a = h.app, [ga, gb] = a.lib.games;
    a.start(ga.id); a.blackWarned = true; a.runMs = 77; runN(a, 3);
    a.input.setVirtual(0, true);
    h.clear();
    ok(a.resetConsole() === true && a.blackWarned === false && a.runMs === 0, 'reset: contatori');
    eq(h.msgs, [['', 'Reset della console.']], 'reset: messaggio');
    ok(a.input.snapshot().rows.every((x) => x === 0), 'reset: tasti rilasciati');
    // BIOS
    await a.addFiles([F('b2.bin', BIOS_B), F('bios due.bin', rb(2048))]); h.clear();
    const b1 = a.bios, b2 = a.lib.bios.find((b) => b.sha !== b1.sha && b.supported), bu = a.lib.bios.find((b) => !b.supported);
    ok(a.selectBios(9999) === false && a.selectBios(b1.id) === true, 'selectBios: sconosciuto / stesso');
    ok(h.msgs.length === 0, 'selectBios: nessun messaggio');
    ok(a.selectBios(bu.id) === false && a.biosId === b1.id, 'selectBios: non utilizzabile');
    eq(h.last(), ['warn', 'BIOS «' + bu.display + '» non utilizzabile: BIOS da 2048 byte: formato non supportato (solo 1024 byte).'], 'selectBios: messaggio');
    a.start(ga.id); a.framesRun = 50; h.clear();
    ok(a.selectBios(b2.id) === true && a.biosId === b2.id && a.gameId === ga.id && a.running && a.framesRun === 0, 'selectBios con partita: riparte a freddo');
    ok(h.msgs[0][0] === '' && h.msgs[0][1] === 'BIOS «' + b2.display + '»: la console riparte (avvio a freddo del gioco in uso).', 'selectBios: messaggio (' + h.texts() + ')');
    ok(a.hasState(ga.id) && a.states.get(ga.id).hashes.bios === b1.sha, 'selectBios: stato memorizzato con il BIOS di allora');
    // BIOS che non si costruisce: niente cambia
    const bz = a.lib.bios.find((b) => b.sha === b1.sha); const keepBuild = a._buildConsole; a._buildConsole = () => { throw new Error('guasto finto'); }; h.clear();
    ok(a.selectBios(bz.id) === false && a.biosId === b2.id && a.gameId === ga.id, 'selectBios: BIOS non costruibile, niente cambia');
    eq(h.last(), ['bad', 'BIOS non utilizzabile: guasto finto'], 'selectBios: messaggio di errore'); a._buildConsole = keepBuild;
    // senza console
    const hn = await loaded(null); await hn.app.addFiles([F('b2.bin', BIOS_B)]);
    const second = hn.app.lib.bios[1]; hn.clear();
    ok(hn.app.selectBios(second.id) === true && hn.app.biosId === second.id && !hn.app.running && hn.msgs.length === 0, 'selectBios senza console: solo la scelta');
    // start fallisce dopo selectBios: il gioco resta
    // standard
    ok(throwsMsg(() => a.setStandard('SECAM')) === 'standard non valido' && throwsMsg(() => a.setStandard('pal')) === 'standard non valido' && throwsMsg(() => a.setStandard(undefined)) === 'standard non valido', 'setStandard: valori non validi');
    h.clear(); a.setStandard('PAL'); ok(h.msgs.length === 0, 'setStandard: lo stesso, niente');
    a.framesRun = 60; const gid = a.gameId; h.clear();
    a.setStandard('NTSC');
    ok(a.settings.standard === 'NTSC' && a.gameId === gid && a.running && a.hasState(gid) && a.states.get(gid).standard === 'PAL', 'setStandard: riparte e memorizza');
    eq(h.msgs[0], ['', 'Standard NTSC: la console riparte (avvio a freddo del gioco in uso).'], 'setStandard: messaggio');
    const hs = mkApp(null); hs.app.setStandard('NTSC'); ok(hs.app.settings.standard === 'NTSC' && hs.msgs.length === 0, 'setStandard senza console');
    // pausa
    a.acc = 3; a.last = 5; const rp = a.rev; a.setPaused(1);
    ok(a.paused === true && a.acc === 0 && a.last === null && a.rev === rp + 1, 'setPaused');
    const now0 = a.con.cpu.now; ok(a.step(100) === 0 && a.step(200) === 0 && a.con.cpu.now === now0, 'in pausa non si emula (e restituisce 0)');
    a.setPaused(0); ok(a.paused === false, 'fine pausa');
    // scarico
    const rq = a.rev; a.unload();
    ok(a.con === null && a.audio === null && a.gameId === null && !a.running && a.rev === rq + 1, 'unload');
    // elenco: togliere
    const hr = await loaded(null), ar = hr.app, [r1, r2] = ar.lib.games; ar.start(r1.id); ar.framesRun = 100; ar.memorize(false); ar.states.set(r2.id, ar.states.get(r1.id)); hr.clear();
    ok(ar.removeGame(r1.id) === false && hr.last()[0] === 'warn' && hr.last()[1] === 'Il gioco in uso non si puo’ togliere dall’elenco.', 'removeGame: in uso');
    const rr = ar.rev;
    ok(ar.removeGame(r2.id) === true && !ar.lib.getGame(r2.id) && !ar.hasState(r2.id) && ar.rev === rr + 1 && ar.removeGame(r2.id) === false, 'removeGame: toglie anche lo stato');
    ok(ar.removeBios(ar.biosId) === false && hr.last()[1] === 'Il BIOS in uso non si puo’ togliere dall’elenco.' && hr.last()[0] === 'warn', 'removeBios: in uso');
    await ar.addFiles([F('b2.bin', BIOS_B)]); const other = ar.lib.bios.find((b) => b.id !== ar.biosId);
    ok(ar.removeBios(other.id) === true && !ar.lib.getBios(other.id) && ar.removeBios(other.id) === false, 'removeBios: un altro BIOS');
    ar.clearLibrary();
    ok(ar.con === null && ar.gameId === null && ar.biosId === null && ar.lib.games.length === 0 && ar.lib.bios.length === 0 && ar.states.size === 0, 'clearLibrary');
  }

  // ---- uscita audio: volume, silenzio, abilitazione
  {
    const calls = [];
    const mkSink = (ctx, available, startErr) => ({ctx, available, rate: 44100, running: !!ctx, volume: null, muted: null, flushes: 0,
      start() { if (startErr) throw new Error(startErr); this.ctx = {}; this.running = true; return 44100; }, setVolume(v) { calls.push(['v', v]); this.volume = v; },
      setMuted(m) { calls.push(['m', m]); this.muted = m; }, flush() { this.flushes++; }, queued() { return 0; }, push() {}});
    const s1 = mkSink(null, true), a1 = new App({sink: s1, fallbackCharset: FALLBACK});
    a1.setVolume(0.3); a1.setMuted(1); ok(a1.settings.volume === 0.3 && a1.settings.muted === true && calls.length === 0, 'volume / silenzio senza contesto audio: solo le impostazioni');
    const s2 = mkSink({}, true), a2 = new App({sink: s2, fallbackCharset: FALLBACK});
    a2.setVolume(0.4); a2.setMuted(true); a2.setMuted(0);
    ok(s2.volume === 0.4 && s2.muted === false && calls.slice(-3).map((c) => c[0] + c[1]).join() === 'v0.4,mtrue,mfalse', 'volume / silenzio con contesto audio: arrivano all’uscita');
    const a0 = new App({fallbackCharset: FALLBACK}); a0.setVolume(0.2); a0.setMuted(true); ok(a0.settings.volume === 0.2 && a0.settings.muted, 'volume senza uscita');
    ok(a0.enableAudio() === false, 'enableAudio senza uscita');
    const s3 = mkSink(null, false), a3 = new App({sink: s3, fallbackCharset: FALLBACK}); ok(a3.enableAudio() === false && s3.ctx === null, 'enableAudio con uscita non disponibile');
    const msgs = [], s4 = mkSink(null, true, 'bloccato'), a4 = new App({sink: s4, onMessage: (t, k) => msgs.push([k, t]), fallbackCharset: FALLBACK});
    ok(a4.enableAudio() === false, 'enableAudio con errore');
    eq(msgs, [['warn', 'Audio non disponibile: bloccato']], 'enableAudio: messaggio');
    const s5 = mkSink(null, true), a5 = new App({sink: s5, fallbackCharset: FALLBACK}); a5.settings.volume = 0.55; a5.settings.muted = true;
    ok(a5.enableAudio() === true && s5.volume === 0.55 && s5.muted === true, 'enableAudio: applica volume e silenzio');
    // attachAudio: serve console, uscita con contesto, nessun audio gia' presente
    const h = await loaded(s5), a = h.app; a.start(a.lib.games[0].id);
    ok(a.audio && a.sink === s5, 'start con contesto audio: audio creato');
    const au = a.audio; a.attachAudio(); ok(a.audio === au, 'attachAudio: non ne crea un altro');
    a.unload(); ok(a.audio === null && s5.flushes > 0, 'unload: audio tolto, coda svuotata');
    a.attachAudio(); ok(a.audio === null, 'attachAudio senza console');
    const h6 = await loaded(mkSink(null, true)); h6.app.start(h6.app.lib.games[0].id); ok(h6.app.audio === null, 'start senza contesto audio: nessun audio'); h6.app.attachAudio(); ok(h6.app.audio === null, 'attachAudio senza contesto');
    h6.app.sink.start(); h6.app.attachAudio(); ok(h6.app.audio !== null && h6.app.audioPaced === true, 'attachAudio dopo l’abilitazione');
    h6.app.sink.running = false; ok(h6.app.audioPaced === false, 'audioPaced: uscita ferma');
    const h7 = await loaded(null); h7.app.start(h7.app.lib.games[0].id); ok(h7.app.audioPaced === false, 'audioPaced senza uscita');
    // pausa: svuota la coda, fine pausa no
    const fl = s5.flushes; a.start(a.lib.games[0].id); const fl2 = s5.flushes; a.setPaused(true); ok(s5.flushes === fl2 + 1, 'pausa: coda svuotata'); a.setPaused(false); ok(s5.flushes === fl2 + 1, 'fine pausa: nessun altro svuotamento');
  }

  // ---- passo a tempo, schermo nero, statistiche
  {
    const h = await loaded(null), a = h.app; a.start(a.lib.games[0].id);
    const period = a.con.frameCycles / a.con.cyclesPerSecond;
    ok(a.step(1000) === 0 && a.last === 1000 && a.runMs === 0 && a.framesRun === 0, 'primo passo: nessun intervallo');
    const n1 = a.step(1000 + 20.2);
    ok(n1 === 1 && a.framesRun === 1 && Math.abs(a.acc - (0.0202 - period)) < 1e-12 && Math.abs(a.runMs - 20.2) < 1e-9, 'un fotogramma per 20,2 ms (acc ' + a.acc + ')');
    a.acc = 0; a.last = 0;
    a.last = 0; a.acc = 0; const rm = a.runMs;
    const n3 = a.step(5000);
    ok(n3 === 3 && Math.abs(a.runMs - rm - 100) < 1e-9 && Math.abs(a.acc - (0.1 - 3 * period)) < 1e-12, 'dt limitato a 100 ms: 3 fotogrammi, acc ' + a.acc);
    a.last = 0; a.acc = 0; const rm2 = a.runMs; a.step(100.5);
    ok(Math.abs(a.runMs - rm2 - 100) < 1e-9, 'dt = 100,5 ms limitato a 100');
    a.last = 0; a.acc = 0; a.step(100); ok(a.acc >= 0 && a.framesRun > 0, 'dt = 100 ms');
    // statistiche
    a.msPerFrame = []; a.last = null; a.step(1); a.step(1 + 20.2); a.step(1 + 40.4 + 0.1);
    const st = a.takeStats(); ok(st && st.n >= 2 && st.avg >= 0 && st.avg < 1000 && a.takeStats() === null && a.msPerFrame.length === 0, 'takeStats: media, conteggio e azzeramento');
    // orologio finto per i tempi per fotogramma
    const realPerf = global.performance; let tick = 5000;
    Object.defineProperty(global, 'performance', {value: {now: () => tick++}, configurable: true, writable: true});
    a.msPerFrame = []; a.last = null; a.step(1); a.step(1 + 20.2);
    const st2 = a.takeStats(); ok(st2 && st2.n === 1 && st2.avg === 1, 'tempo per fotogramma = differenza degli orologi (' + (st2 && st2.avg) + ')');
    Object.defineProperty(global, 'performance', {value: undefined, configurable: true, writable: true});
    a.msPerFrame = []; a.last = null; a.step(1); a.step(1 + 20.2);
    const st3 = a.takeStats(); ok(st3 && st3.n === 1 && st3.avg >= 0 && st3.avg < 1000, 'senza performance: usa Date.now');
    Object.defineProperty(global, 'performance', {value: realPerf, configurable: true, writable: true});
    // schermo nero: runFrame finto, fb a zero
    const hb = await loaded(null), ab = hb.app; ab.start(ab.lib.games[0].id);
    ab.con.runFrame = function () {}; ab.con.fb.fill(0); hb.clear();
    let t = 0; ab.step(t);
    for (let i = 0; i < 30; i++) { t += 100; ab.step(t); }
    ok(ab.runMs === 3000 && !ab.blackWarned && hb.msgs.length === 0, 'a 3000 ms esatti non avvisa');
    t += 100; ab.step(t);
    ok(ab.blackWarned && hb.msgs.length === 1 && hb.msgs[0][0] === 'warn' && hb.msgs[0][1].startsWith('Lo schermo e’ ancora nero dopo 3 secondi.'), 'dopo 3 secondi di nero: avviso');
    t += 100; ab.step(t); ok(hb.msgs.length === 1, 'avviso una volta sola');
    // reset: puo' avvisare di nuovo
    ab.resetConsole(); ok(ab.blackWarned === false && ab.runMs === 0, 'reset riarma l’avviso');
    for (const idx of [0, 1, 50000]) {
      const hc = await loaded(null), ac = hc.app; ac.start(ac.lib.games[0].id); ac.con.runFrame = function () {}; ac.con.fb.fill(0); ac.con.fb[idx] = 3; hc.clear();
      let tt = 0; ac.step(tt); for (let i = 0; i < 40; i++) { tt += 100; ac.step(tt); }
      ok(ac.blackWarned && hc.msgs.length === 0, 'schermo non nero (pixel ' + idx + '): nessun avviso');
    }
    { const hc = await loaded(null), ac = hc.app; ac.start(ac.lib.games[0].id); ac.con.runFrame = function () {}; ac.con.fb.fill(0); ac.con.fb[ac.con.fb.length - 1] = 2; hc.clear();
      let tt = 0; ac.step(tt); for (let i = 0; i < 40; i++) { tt += 100; ac.step(tt); }
      ok(ac.blackWarned && hc.msgs.length === 0, 'schermo non nero (ultimo pixel): nessun avviso'); }
  }

  // ---- nome del file di stato
  {
    const RealDate = Date;
    global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [2026, 1, 3, 4, 5, 6])); } };
    try {
      const h = await loaded(null), a = h.app;
      a.start(a.lib.games[0].id);
      ok(a.saveStateFile().name === 'Alfa-20260203-040506.o2state', 'nome del file di stato: ' + a.saveStateFile().name);
      a.game.display = 'Gioco  Strano (1981)! a+b, 2049 x.y_z-w'; ok(a.saveStateFile().name === 'Gioco_Strano_1981_ab_2049_x.y_z-w-20260203-040506.o2state', 'nome ripulito: ' + a.saveStateFile().name);
      a.game.display = 'X'.repeat(50); ok(a.saveStateFile().name === 'X'.repeat(40) + '-20260203-040506.o2state', 'nome limitato a 40 caratteri');
      a.game.display = 'X'.repeat(40); ok(a.saveStateFile().name === 'X'.repeat(40) + '-20260203-040506.o2state', 'nome di 40 caratteri');
      a.game.display = '!!!'; ok(a.saveStateFile().name === 'o2web-20260203-040506.o2state', 'nome tutto ripulito -> o2web');
      a.game.display = 'abcàè'; ok(a.saveStateFile().name === 'abc-20260203-040506.o2state', 'lettere accentate tolte');
      a.game.display = '  ab  '; ok(a.saveStateFile().name === 'ab-20260203-040506.o2state', 'spazi ai bordi tolti');
      a.start(null); ok(a.saveStateFile().name === 'o2web-20260203-040506.o2state', 'senza gioco: o2web');
      ok(a.saveStateFile().bytes instanceof Uint8Array && a.saveStateFile().bytes.length > 100, 'contenuto');
    } finally { global.Date = RealDate; }
  }

  // ---- stato su file
  {
    const h = await loaded(null), a = h.app, [ga, gb] = a.lib.games;
    a.start(ga.id); runN(a, 40);
    const file = a.saveStateFile();
    ok(a.loadStateFile(new TextEncoder().encode('{"x":'), 'rotto.o2state') === false && h.last()[0] === 'bad' && h.last()[1].startsWith('rotto.o2state: '), 'stato: file rovinato con nome');
    a.loadStateFile(new TextEncoder().encode('{"x":'), ''); ok(h.last()[1].startsWith('File: '), 'stato: file rovinato senza nome');
    a.loadStateFile(new TextEncoder().encode('{"x":'), undefined); ok(h.last()[1].startsWith('File: '), 'stato: file rovinato senza nome (undefined)');
    const valid = JSON.parse(new TextDecoder().decode(file.bytes));
    const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
    const bad1 = Object.assign({}, valid); delete bad1.hashes;
    h.clear(); a.loadStateFile(enc(bad1), 'x.o2state');
    ok(h.msgs.length === 1 && h.last()[0] === 'bad', 'stato senza impronte: rifiutato (' + h.last()[1] + ')');
    // impronte di BIOS e cartuccia mancanti nell'elenco
    const other = JSON.parse(JSON.stringify(valid)); other.hashes.bios = 'a'.repeat(64);
    h.clear(); ok(a.loadStateFile(enc(other), 'x.o2state') === false, 'stato di un BIOS sconosciuto');
    eq(h.last(), ['bad', 'x.o2state: e’ di un BIOS che non e’ nell’elenco: aggiungilo e riprova.'], 'stato: BIOS sconosciuto, messaggio');
    a.loadStateFile(enc(other), ''); ok(h.last()[1].startsWith('Stato: e’ di un BIOS'), 'stato: BIOS sconosciuto senza nome');
    const other2 = JSON.parse(JSON.stringify(valid)); other2.hashes.cart = 'b'.repeat(64);
    ok(a.loadStateFile(enc(other2), 'y.o2state') === false, 'stato di una cartuccia sconosciuta');
    eq(h.last(), ['bad', 'y.o2state: e’ di una cartuccia che non e’ nell’elenco: aggiungila e riprova.'], 'stato: cartuccia sconosciuta, messaggio');
    a.loadStateFile(enc(other2), ''); ok(h.last()[1].startsWith('Stato: e’ di una cartuccia'), 'stato: cartuccia sconosciuta senza nome');
    // senza cartuccia (impronta vuota)
    const nocart = JSON.parse(JSON.stringify(valid)); nocart.hashes.cart = '';
    // stato rovinato ma con impronte buone
    const broken = JSON.parse(JSON.stringify(valid)); broken.cpu = null;
    h.clear(); ok(a.loadStateFile(enc(broken), 'z.o2state') === false && h.last()[0] === 'bad' && h.last()[1].length > 5 && !/NaN/.test(h.last()[1]), 'stato con CPU nulla: ' + h.last()[1]);
    const broken2 = JSON.parse(JSON.stringify(valid)); broken2.cpu = {a: 1};
    ok(a.loadStateFile(enc(broken2), 'z.o2state') === false, 'stato con CPU incompleta');
    // caricamento riuscito: altro gioco in uso -> si memorizza quello lasciato
    a.start(gb.id); a.framesRun = 50; a.forgetState(gb.id); h.clear();
    ok(a.loadStateFile(file.bytes, 'ok.o2state') === true && a.gameId === ga.id && a.framesRun === MIN_RESUME_FRAMES && a.hasState(gb.id), 'stato caricato: la partita lasciata si memorizza');
    eq(h.last(), ['good', 'Stato caricato: ok.o2state.'], 'stato: messaggio');
    a.loadStateFile(file.bytes, ''); eq(h.last(), ['good', 'Stato caricato.'], 'stato: messaggio senza nome');
    a.loadStateFile(file.bytes); eq(h.last(), ['good', 'Stato caricato.'], 'stato: messaggio senza nome (assente)');
    // stesso gioco in uso: non si memorizza di nuovo
    a.forgetState(ga.id); a.framesRun = 90; a.loadStateFile(file.bytes, 'ok.o2state'); ok(!a.hasState(ga.id), 'stato dello stesso gioco: niente memorizzazione');
    // da console senza cartuccia: si memorizza? (nessun gioco in uso = niente da memorizzare)
    a.start(null); const ns = a.states.size; a.loadStateFile(file.bytes, 'ok.o2state'); ok(a.states.size === ns, 'da console senza gioco: nulla da memorizzare');
    // il BIOS in uso diventa quello dello stato; lo standard anche
    await a.addFiles([F('b2.bin', BIOS_B)]);
    const bb = a.lib.bios.find((b) => b.sha !== a.bios.sha); a.biosId = bb.id; a.settings.standard = 'NTSC';
    ok(a.loadStateFile(file.bytes, 'ok.o2state') === true && a.bios.sha === valid.hashes.bios && a.settings.standard === 'PAL', 'stato: BIOS e standard dello stato messi in uso');
    // stato NTSC
    a.settings.standard = 'NTSC'; a.start(ga.id); runN(a, 5); const ntsc = a.saveStateFile(); a.settings.standard = 'PAL'; a.start(ga.id);
    ok(a.loadStateFile(ntsc.bytes, 'n.o2state') === true && a.settings.standard === 'NTSC', 'stato NTSC: standard messo in uso');
    // stato di una console senza cartuccia
    a.start(null); runN(a, 5); const nc = a.saveStateFile(); a.start(ga.id);
    ok(a.loadStateFile(nc.bytes, 'nc.o2state') === true && a.gameId === null, 'stato senza cartuccia');
    // BIOS non utilizzabile nello stato (BIOS da 2 KB nell'elenco con la stessa impronta: impossibile) -> si salta
  }

  // ---- sessione
  {
    const h = await loaded(null), a = h.app, [ga, gb] = a.lib.games;
    a.start(ga.id); runN(a, 40); a.start(gb.id); runN(a, 10);
    a.setCharset('cs.bin', rb(512)); a.setVolume(0.35); a.setMuted(true); a.settings.scale = 3; a.settings.aspect = 'square'; a.settings.integer = true;
    const sess = a.saveSession('2026-10-12T10:00:00.000Z');
    ok(a.hasState(gb.id), 'saveSession memorizza la partita in corso (anche con pochi fotogrammi)');
    const parsed = S.parseSession(sess); ok(parsed.created === '2026-10-12T10:00:00.000Z', 'saveSession: data data');
    const s2 = new RealDateWrap().run(() => a.saveSession()); ok(/^2026-02-03T/.test(S.parseSession(s2).created), 'saveSession: data di oggi se manca');
    function RealDateWrap() { this.run = (fn) => { const D = Date; global.Date = class extends D { constructor(...x) { super(...(x.length ? x : [Date.UTC(2026, 1, 3, 4, 5, 6)])); } }; try { return fn(); } finally { global.Date = D; } }; }
    // apertura: nuova app
    const h2 = mkApp(null), b = h2.app;
    ok(await b.loadSession(sess, 'mia.o2session') === true, 'sessione aperta');
    eq(h2.last(), ['good', 'Sessione aperta: mia.o2session (2 giochi, 1 BIOS, 2 stati memorizzati); partita ripresa dallo stato memorizzato.'], 'sessione: messaggio');
    ok(b.running && b.gameId === b.lib.games.find((g) => g.name === gb.name).id && b.framesRun === MIN_RESUME_FRAMES && b.charsetName === 'dalla sessione' && b.charset.length === 512, 'sessione: partita, set di caratteri');
    eq([b.settings.scale, b.settings.aspect, b.settings.integer, b.settings.volume, b.settings.muted, b.settings.standard], [3, 'square', true, 0.35, true, 'PAL'], 'sessione: impostazioni');
    ok(b.paused === false && b.acc === 0 && b.last === null && b.runMs === 0 && b.msPerFrame.length === 0, 'sessione: orologio azzerato');
    // aspetto e macchina nella sessione
    {
      const ha = await loaded(null), x = ha.app;
      eq([x.look.mono, x.look.blur, x.look.detail, x.machinePref, x.lookRev], [false, 0, 3, 'auto', 0], 'aspetto iniziale: esatto, macchina automatica');
      const r0 = x.lookRev;
      ok(x.setLook({blur: 30, mono: true}) === true && x.look.blur === 30 && x.look.mono === true && x.look.glow === 0 && x.lookRev === r0 + 1, 'setLook: unisce ai valori attuali');
      const before = JSON.stringify(x.look), rb0 = x.lookRev;
      ok(x.setLook({blur: 101}) === false && JSON.stringify(x.look) === before && x.lookRev === rb0, 'setLook: valore fuori scala rifiutato, nulla cambia');
      ok(/^Aspetto non cambiato: /.test(ha.last()[1]) && ha.last()[0] === 'bad', 'setLook: messaggio');
      ok(x.setLook({nope: 1}) === false && JSON.stringify(x.look) === before, 'setLook: campo sconosciuto rifiutato');
      ok(x.selectMachine('g7200') === true && x.machinePref === 'g7200' && x.machine.kind === 'g7200' && x.machine.auto === false && x.look.mono === true && x.settings.standard === 'PAL', 'selectMachine: G7200 = schermo B/N');
      ok(x.selectMachine('xx') === false && x.machinePref === 'g7200' && ha.last()[1] === 'Macchina sconosciuta.', 'selectMachine: sconosciuta rifiutata');
      const sess2 = x.saveSession('2026-10-12T10:00:00.000Z');
      const hb = mkApp(null), y = hb.app;
      ok(await y.loadSession(sess2, 'a.o2session') === true, 'sessione con aspetto aperta');
      eq([y.look.mono, y.look.blur, y.machinePref], [true, 30, 'g7200'], 'sessione: aspetto e macchina ripristinati');
      ok(y.lookRev > 0, 'sessione: lookRev avanzato per far ridisegnare');
      // sessione vecchia (senza look): i valori attuali restano
      const old = S.parseSession(sess2); void old;
      const hc = await loaded(null), z = hc.app; z.setLook({glow: 7}); ok(z.selectMachine('odyssey2') === true, 'selectMachine: Odyssey 2 con un BIOS sconosciuto (famiglia G7000)');
      const noLook = S.buildSession({lib: x.lib, activeGameId: null, activeBiosId: x.biosId, standard: 'PAL', states: new Map(), charset: null, settings: {scale: 2}, created: '2026-10-12T00:00:00.000Z'});
      ok(await z.loadSession(noLook) === true && z.look.glow === 7 && z.machinePref === 'odyssey2', 'sessione senza aspetto: restano i valori attuali');
    }
    // senza nome
    const h3 = mkApp(null); await h3.app.loadSession(sess); ok(/^Sessione aperta \(2 giochi/.test(h3.last()[1]), 'sessione: messaggio senza nome');
    // stesso con partita iniziata a freddo (nessuno stato per il gioco in uso)
    const noState = S.buildSession({lib: a.lib, activeGameId: ga.id, activeBiosId: a.biosId, standard: 'PAL', states: new Map(), charset: null, settings: {}, created: ''});
    const h4 = mkApp(null); await h4.app.loadSession(noState, 'f.o2session');
    eq(h4.last(), ['good', 'Sessione aperta: f.o2session (2 giochi, 1 BIOS, 0 stati memorizzati); partita avviata a freddo.'], 'sessione: partita a freddo');
    ok(h4.app.framesRun === 0 && h4.app.charsetName === '' && h4.app.charset === null, 'sessione: a freddo, senza set di caratteri');
    // senza gioco in uso
    const noGame = S.buildSession({lib: a.lib, standard: 'NTSC', created: ''});
    const h5 = mkApp(null); await h5.app.loadSession(noGame, 'g.o2session');
    eq(h5.last(), ['good', 'Sessione aperta: g.o2session (2 giochi, 1 BIOS, 0 stati memorizzati).'], 'sessione: senza gioco in uso');
    ok(!h5.app.running && h5.app.settings.standard === 'NTSC' && h5.app.biosId === h5.app.lib.bios[0].id && h5.app.gameId === null, 'sessione: BIOS scelto in automatico, standard');
    // stato di un altro BIOS
    const lib2 = a.lib; const st = new Map([[ga.id, JSON.parse(JSON.stringify(a.states.get(gb.id)))]]); st.get(ga.id).hashes.cart = ga.sha; st.get(ga.id).hashes.bios = 'c'.repeat(64);
    const otherBios = S.buildSession({lib: lib2, activeGameId: ga.id, activeBiosId: a.biosId, standard: 'PAL', states: st, created: ''});
    const h6 = mkApp(null); await h6.app.loadSession(otherBios, 'h.o2session');
    ok(h6.msgs[0][0] === 'warn' && h6.msgs[0][1] === 'Lo stato memorizzato del gioco in uso e’ di un altro BIOS o standard: avvio a freddo (lo stato resta memorizzato).' && /partita avviata a freddo\.$/.test(h6.last()[1]) && h6.app.hasState(h6.app.gameId), 'sessione: stato di un altro BIOS');
    const stN = new Map([[ga.id, JSON.parse(JSON.stringify(a.states.get(ga.id)))]]);
    const stdMis = S.buildSession({lib: lib2, activeGameId: ga.id, activeBiosId: a.biosId, standard: 'NTSC', states: stN, created: ''});
    const h7 = mkApp(null); await h7.app.loadSession(stdMis, 'i.o2session');
    ok(h7.msgs[0][1].startsWith('Lo stato memorizzato del gioco in uso e’ di un altro BIOS o standard') && /avviata a freddo/.test(h7.last()[1]), 'sessione: stato di un altro standard');
    // stato rovinato (CPU nulla) con impronte giuste
    const stB = new Map([[ga.id, JSON.parse(JSON.stringify(a.states.get(ga.id)))]]); stB.get(ga.id).cpu = null;
    const broken = S.buildSession({lib: lib2, activeGameId: ga.id, activeBiosId: a.biosId, standard: 'PAL', states: stB, created: ''});
    const h8 = mkApp(null); await h8.app.loadSession(broken, 'j.o2session');
    ok(h8.msgs[0][0] === 'warn' && /^Lo stato memorizzato del gioco in uso non si e’ potuto riprendere \(.+\): avvio a freddo\.$/.test(h8.msgs[0][1]) && /avviata a freddo\.$/.test(h8.last()[1]) && h8.app.running, 'sessione: stato che non si riprende (' + h8.msgs[0][1] + ')');
    // standard dello stato assente: va bene lo stesso standard
    const stM = new Map([[ga.id, JSON.parse(JSON.stringify(a.states.get(ga.id)))]]); delete stM.get(ga.id).standard;
    const noStd = S.buildSession({lib: lib2, activeGameId: ga.id, activeBiosId: a.biosId, standard: 'PAL', states: stM, created: ''});
    const h9 = mkApp(null); await h9.app.loadSession(noStd, 'k.o2session'); ok(/^Lo stato memorizzato del gioco in uso non si e\u2019 potuto riprendere/.test(h9.msgs[0][1]) && /avviata a freddo/.test(h9.last()[1]), 'sessione: stato senza standard (' + h9.msgs[0][1] + ')');
    // sessione rifiutata: niente cambia
    const hr = await loaded(null), ar = hr.app; ar.start(ar.lib.games[0].id); runN(ar, 5); const keepCon = ar.con; hr.clear();
    ok(await ar.loadSession(new Uint8Array([1, 2, 3]), 'brutta.o2session') === false && ar.con === keepCon, 'sessione falsa: partita intatta');
    ok(hr.last()[0] === 'bad' && hr.last()[1].startsWith('brutta.o2session: ') && hr.last()[1].endsWith(' La partita in corso non e’ stata toccata.'), 'sessione falsa: messaggio (' + hr.last()[1] + ')');
    await ar.loadSession(new Uint8Array([1, 2, 3])); ok(hr.last()[1].startsWith('Sessione: '), 'sessione falsa senza nome');
    // BIOS della sessione non utilizzabile: si apre ferma
    const lib3 = new (require(SP('library.js')).Library)(); await lib3.addFile('bios due.bin', rb(2048)); await lib3.addFile('a.bin', CART.a);
    const noBios = S.buildSession({lib: lib3, activeGameId: lib3.games[0].id, activeBiosId: lib3.bios[0].id, standard: 'PAL', created: ''});
    const hn = mkApp(null); await hn.app.loadSession(noBios, 'l.o2session'); ok(!hn.app.running && hn.app.gameId === null && /^Sessione aperta: l\.o2session \(1 giochi, 1 BIOS, 0 stati memorizzati\)\.$/.test(hn.last()[1]), 'sessione: BIOS non utilizzabile -> ferma (' + hn.last()[1] + ')');
    // con l'uscita audio: volume e silenzio dalla sessione
    const calls = []; const sink = {ctx: {}, running: true, rate: 44100, setVolume: (v) => calls.push(['v', v]), setMuted: (m) => calls.push(['m', m]), flush() { calls.push(['f']); }, queued() { return 0; }, push() {}, available: true};
    const hs = mkApp(sink); await hs.app.loadSession(sess, 'm.o2session');
    ok(calls.some((c) => c[0] === 'v' && c[1] === 0.35) && calls.some((c) => c[0] === 'm' && c[1] === true), 'sessione: volume e silenzio all’uscita');
    const calls0 = calls.length; sink.ctx = null; await hs.app.loadSession(noGame, 'n.o2session'); ok(calls.slice(calls0).some((c) => c[0] === 'f'), 'sessione senza partita: coda svuotata');
    ok(!calls.slice(calls0).some((c) => c[0] === 'v' || c[0] === 'm'), 'sessione senza contesto audio: volume non applicato');
    // le associazioni dei tasti arrivano dalla sessione
    const bnd = JSON.parse(JSON.stringify(a.input.bindings)); bnd['1'].up = ['KeyQ'];
    a.setBindings(bnd); const sB = a.saveSession('');
    const hbd = mkApp(null); await hbd.app.loadSession(sB, ''); ok(JSON.stringify(hbd.app.input.bindings['1'].up) === '["KeyQ"]', 'sessione: associazioni dei tasti');
    // openFiles smista
    const ho = mkApp(null); await ho.app.openFiles([F('s.o2session', sess)]); ok(ho.app.running && ho.app.lib.games.length === 2, 'openFiles: sessione');
    await ho.app.openFiles([F('s.o2state', a.saveStateFile().bytes)]); ok(/^Stato caricato: s\.o2state\.$/.test(ho.last()[1]), 'openFiles: stato');
    const hz = mkApp(null); await hz.app.openFiles([F('z.zip', zipStore([{name: 'a.bin', data: CART.a}]))]); ok(hz.app.lib.games.length === 1, 'openFiles: zip di dump');
  }

  // ---- ingressi applicati alla console
  {
    const h = await loaded(null), a = h.app; a.start(a.lib.games[0].id);
    a.input.setVirtual(0, true); a.input.keyDown({code: 'ArrowUp', key: 'ArrowUp'}); a.input.keyDown({code: 'Numpad4', key: '4'});
    a.step(1000);
    ok(a.con.keyRows[0] === 1 && a.con.joy[0] === 1 && a.con.joy[1] === 8, 'applyInputs: tastiera e joystick');
    a.input.releaseAll(); a.step(1020);
    ok(a.con.keyRows[0] === 0 && a.con.joy[0] === 0 && a.con.joy[1] === 0, 'applyInputs: rilascio');
    a.pollPads([{connected: true, buttons: [{pressed: true}], axes: [0, 0]}]); a.step(1040); ok(a.con.joy[0] === 16, 'pollPads: fuoco del gamepad 1');
    a.padPrefs = {1: 'off', 2: 'auto'}; a.pollPads([{connected: true, buttons: [{pressed: true}], axes: [0, 0]}]); a.step(1060); ok(a.con.joy[0] === 0 && a.con.joy[1] === 16, 'pollPads: giocatore 1 spento');
    a.setBindings(JSON.parse(JSON.stringify(a.input.bindings))); ok(a.rev > 0, 'setBindings');
  }
};
