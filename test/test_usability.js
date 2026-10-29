'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_usability.js [DUMPS] - due comandi in piu' sotto lo schermo (richiesta dell'utente, 18/10/2026):
//  1. «Scambia comandi 1-2»: i comandi del giocatore 1 muovono il joystick 2 e viceversa (giochi a turni giocati da soli). Il regista
//     (app.js) tiene l'impostazione, la porta agli ingressi, la salva nella sessione e la rifiuta se non e' vera/falsa.
//  2. «Filtri CRT» (copia del selettore del pannello «Aspetto»): app.cycleLook() passa da un insieme pronto al successivo e si ricorda
//     il personalizzato; l'emulazione (la console) non cambia, cambia solo l'aspetto.
// Senza DUMPS: tutto tranne il percorso fino alla console.
const fs = require('fs');
const path = require('path');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {App} = require(SP('app.js'));
const Look = require(SP('look.js'));
const S = require(SP('session.js'));
const I = require(SP('input.js'));
const charsetOwn = require('../hw/charset_own.js');
const FALLBACK = new Uint8Array(charsetOwn.build());
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 30) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));
const dumps = process.argv[2] || process.env.O2_DUMPS;
const J = I.JOY_BITS;
const ev = (code, key) => ({code, key: key === undefined ? code : key});
const flt = (o) => { const r = {}; for (const k of Look.FILTER_KEYS.concat(['detail'])) r[k] = o[k]; return r; };

(async () => {
  const msgs = [];
  const mk = () => new App({fallbackCharset: FALLBACK, onMessage: (t, k) => msgs.push([k, t])});

  // ---------------------------------------------------------------- 1. scambio dei comandi, senza console
  {
    const app = mk();
    eq([app.settings.swapPads, app.swapPads, app.input.swap], [false, false, false], 'scambio: spento all\'inizio');
    const r0 = app.rev;
    ok(app.setSwapPads(true) === true, 'setSwapPads(true) ritorna true');
    eq([app.settings.swapPads, app.swapPads, app.input.swap], [true, true, true], 'scambio acceso: impostazione, lettura e ingressi');
    ok(app.rev > r0, 'scambio: la pagina viene avvisata (rev sale)');
    const r1 = app.rev;
    ok(app.setSwapPads(true) === true && app.rev === r1, 'scambio: riaccenderlo quando e\' gia\' acceso non cambia niente');
    app.input.keyDown(ev('ArrowUp'));
    eq(app.input.snapshot().joy, [0, J.up], 'scambio: freccia su = joystick 2 su');
    app.setSwapPads(false);
    eq([app.settings.swapPads, app.swapPads, app.input.swap, app.input.snapshot().joy], [false, false, false, [J.up, 0]], 'scambio spento: tutto torna com\'era');
    ok(app.setSwapPads(1) === true && app.swapPads === true, 'valore non booleano (1) = acceso');
    ok(app.setSwapPads(0) === true && app.swapPads === false, 'valore non booleano (0) = spento');
    ok(app.setSwapPads(undefined) === true && app.swapPads === false, 'undefined = spento');
    // anche dal «Reset» ai dati di partenza: un App nuovo parte spento, e due App non si influenzano
    const a2 = mk(); a2.setSwapPads(true);
    ok(mk().swapPads === false && a2.swapPads === true, 'due App indipendenti');
    // le impostazioni da salvare
    app.setSwapPads(true);
    ok(app.currentSettings().swapPads === true, 'currentSettings contiene lo scambio (acceso)');
    app.setSwapPads(false);
    ok(app.currentSettings().swapPads === false, 'currentSettings contiene lo scambio (spento)');
  }

  // ---------------------------------------------------------------- sessione: andata e ritorno e rifiuti
  {
    const a = mk();
    a.setSwapPads(true);
    const bytes = a.saveSession();
    const b = mk();
    ok(b.swapPads === false, 'sessione: l\'App di arrivo parte spenta');
    ok(await b.loadSession(bytes, 'prova'), 'sessione con lo scambio acceso si apre');
    eq([b.swapPads, b.settings.swapPads, b.input.swap], [true, true, true], 'sessione: lo scambio acceso torna acceso (anche negli ingressi)');
    b.input.keyDown(ev('ArrowUp'));
    eq(b.input.snapshot().joy, [0, J.up], 'sessione: lo scambio funziona dopo l\'apertura');
    // aprire una sessione con lo scambio spento lo spegne
    b.setSwapPads(true);
    const off = mk(); off.setSwapPads(false);
    ok(await b.loadSession(off.saveSession(), 'spenta'), 'sessione con lo scambio spento si apre');
    eq([b.swapPads, b.input.swap], [false, false], 'sessione: lo scambio spento spegne quello acceso');
    // una sessione di prima (senza la chiave) lascia lo scambio com'e'
    const old = mk(); const cs = old.currentSettings(); delete cs.swapPads;
    const oldBytes = S.buildSession({lib: old.lib, activeGameId: null, activeBiosId: null, standard: 'PAL', states: new Map(), charset: null, settings: cs, created: '2026-10-18T00:00:00.000Z'});
    b.setSwapPads(true);
    ok(await b.loadSession(oldBytes, 'vecchia'), 'sessione di prima si apre');
    eq([b.swapPads, b.input.swap], [true, true], 'sessione di prima (senza la chiave): lo scambio resta com\'era');
    // schema: la chiave e' booleana
    eq(S.checkSettings({swapPads: true}), {swapPads: true}, 'checkSettings: vero');
    eq(S.checkSettings({swapPads: false}), {swapPads: false}, 'checkSettings: falso');
    for (const v of [1, 0, 'si', 'true', null, [], {}]) {
      let msg = null; try { S.checkSettings({swapPads: v}); } catch (e) { msg = e.message; }
      ok(msg && /scambio dei comandi/.test(msg), 'checkSettings: ' + JSON.stringify(v) + ' rifiutato (' + msg + ')');
    }
    // una sessione con il valore sbagliato NON si apre e non tocca lo stato
    const bad2 = mk();
    const cs2 = bad2.currentSettings(); cs2.swapPads = 'si';
    let thrown = null; try { S.buildSession({lib: bad2.lib, activeGameId: null, activeBiosId: null, standard: 'PAL', states: new Map(), charset: null, settings: cs2, created: 'x'}); } catch (e) { thrown = e; }
    ok(thrown instanceof S.SessionError, 'buildSession rifiuta lo scambio non booleano');
  }

  // ---------------------------------------------------------------- 2. filtri CRT: ciclo
  {
    const app = mk();
    const names = [];
    const r0 = app.lookRev;
    for (let i = 0; i < 3; i++) { names.push(app.cycleLook()); }
    eq(names, ['leggero', 'anni80', 'esatto'], 'ciclo: nessun filtro -> leggero -> anni 80 -> nessun filtro');
    ok(app.lookRev >= r0 + 3, 'ciclo: ogni passo avvisa la pagina (lookRev sale)');
    eq(Look.presetOf(app.look), 'esatto', 'ciclo: dopo il giro intero i filtri sono spenti');
    eq(flt(app.look), flt(Look.PRESETS.esatto), 'ciclo: valori di esatto');
    app.cycleLook(); eq(flt(app.look), flt(Look.PRESETS.leggero), 'ciclo: valori di leggero');
    app.cycleLook(); eq(flt(app.look), flt(Look.PRESETS.anni80), 'ciclo: valori di anni 80');
    // il personalizzato fatto con i cursori si ricorda
    app.setLook({blur: 10, scan: 80, detail: 4});
    const cus = flt(app.look);
    eq(Look.presetOf(app.look), 'custom', 'cursori: personalizzato');
    eq(app.cycleLook(), 'esatto', 'ciclo: dal personalizzato -> nessun filtro');
    eq(app.cycleLook(), 'leggero', 'ciclo: -> leggero');
    eq(app.cycleLook(), 'anni80', 'ciclo: -> anni 80');
    eq(app.cycleLook(), 'custom', 'ciclo: -> il personalizzato di prima');
    eq(flt(app.look), cus, 'ciclo: il personalizzato torna identico');
    eq(app.cycleLook(), 'esatto', 'ciclo: -> nessun filtro');
    // un secondo personalizzato sostituisce il primo
    app.setLook({blur: 5, mask: 60});
    const cus2 = flt(app.look);
    app.cycleLook(); app.cycleLook(); app.cycleLook();
    eq(app.cycleLook(), 'custom', 'ciclo: dopo anni 80 torna il personalizzato');
    eq(flt(app.look), cus2, 'ciclo: ...ed e\' il secondo, non il primo');
    // il B/N (monitor del G7200) non si tocca
    app.setLook({mono: true});
    app.cycleLook(); app.cycleLook();
    ok(app.look.mono === true, 'ciclo: il B/N resta acceso');
    app.setLook({mono: false});
    ok(app.look.mono === false, 'prova: B/N spento');
    // il cambio di aspetto non tocca l'emulazione ne' le impostazioni di ingresso
    ok(app.swapPads === false, 'ciclo: non c\'entra con lo scambio dei comandi');
    // la sessione porta l'aspetto in uso (il personalizzato messo da parte no)
    const bytes = app.saveSession();
    const c = mk();
    ok(await c.loadSession(bytes, 'look'), 'sessione con l\'aspetto si apre');
    eq(Look.presetOf(c.look), Look.presetOf(app.look), 'sessione: l\'aspetto torna');
  }

  // ---------------------------------------------------------------- percorso fino alla console (dump veri, in locale)
  if (dumps && fs.existsSync(path.join(dumps, 'bios', 'o2rom.bin')) && fs.existsSync(path.join(dumps, 'killerbees.bin'))) {
    const rd = (p) => ({name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(path.join(dumps, p)))});
    const app = mk();
    await app.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    const kb = app.lib.games[0];
    ok(app.start(kb.id) && app.running, 'avvio di Killer Bees');
    let t = 1000;
    const frames = (k) => { let done = 0; while (done < k) { t += 20.1; done += app.step(t); } };
    frames(40);
    // senza scambio: freccia su -> joystick 1, tastierino 8 -> joystick 2
    app.input.keyDown(ev('ArrowUp')); frames(2);
    eq([app.con.joy[0], app.con.joy[1]], [J.up, 0], 'console, scambio spento: freccia su = joystick 1');
    app.setSwapPads(true); frames(2);
    eq([app.con.joy[0], app.con.joy[1]], [0, J.up], 'console, scambio acceso: freccia su = joystick 2 (anche con il tasto gia\' premuto)');
    app.input.keyDown(ev('Numpad4', '4')); app.input.keyDown(ev('Digit1', '1')); frames(2);
    eq([app.con.joy[0], app.con.joy[1]], [J.left, J.up], 'console: tastierino 4 = joystick 1 sinistra');
    ok((app.con.keyRows[0] & 2) !== 0, 'console: il tasto 1 della console non e\' toccato dallo scambio');
    app.input.releaseAll(); frames(2);
    // gamepad
    const pad = {connected: true, buttons: Array.from({length: 17}, (_, i) => ({pressed: i === 15, value: i === 15 ? 1 : 0})), axes: [0, 0]};
    app.pollPads([pad]); frames(2);
    eq([app.con.joy[0], app.con.joy[1]], [0, J.right], 'console: gamepad 1 = joystick 2 con lo scambio');
    app.setSwapPads(false); frames(2);
    eq([app.con.joy[0], app.con.joy[1]], [J.right, 0], 'console: spento lo scambio il gamepad 1 e\' di nuovo il joystick 1');
    app.pollPads([]); frames(2);
    // cambiare gioco non spegne lo scambio (giochi a turni: lo si tiene per tutta la serata)
    app.setSwapPads(true);
    ok(app.start(kb.id) && app.swapPads === true && app.input.swap === true, 'riavvio del gioco: lo scambio resta');
    ok(app.resetConsole() && app.swapPads === true, 'reset della console: lo scambio resta');
    // la sessione con una partita in corso riporta lo scambio
    const bytes = app.saveSession();
    const b = mk(); await b.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    ok(await b.loadSession(bytes, 'con partita') && b.swapPads === true && b.input.swap === true, 'sessione con partita: scambio acceso');
    // cambiare il filtro mentre si gioca non cambia l'emulazione: stessi fotogrammi con e senza
    const x = mk(), y = mk();
    await x.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]); await y.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    x.start(x.lib.games[0].id); y.start(y.lib.games[0].id);
    for (let i = 0; i < 60; i++) { x.con.runFrame(); y.con.runFrame(); if (i === 20) { y.cycleLook(); y.cycleLook(); } }
    ok(Buffer.from(x.con.fb).equals(Buffer.from(y.con.fb)), 'filtri CRT: il fotogramma dell\'emulazione e\' identico con e senza filtri');
  } else console.log('  (prove con la console saltate: servono i dump)');

  console.log(bad ? 'FALLITI ' + bad + ' controlli su ' + n : 'OK: ' + n + ' controlli sui comandi sotto lo schermo');
  process.exit(bad ? 1 : 0);
})();
