'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_machine.js [DUMPS] - tappa 5c: si sceglie la MACCHINA, non il BIOS. Funzioni di machines.js (fitsBios, defaultStandard, isMono, NEEDS) e regista
// (machineChoices, machineCandidates, selectMachine, setStandard che fissa la macchina, selectBios, clearLibrary, sessioni nuove e vecchie).
// Senza dump: BIOS sconosciuti (byte casuali) e cartucce casuali. Con DUMPS (cartella locale: bios/o2rom.bin, c52.bin, g7400.bin, jopac.bin) anche i quattro
// BIOS veri, riconosciuti dall'impronta SHA-256.
const fs = require('fs');
const path = require('path');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {App} = require(SP('app.js'));
const M = require(SP('machines.js'));
const S = require(SP('session.js'));
const charsetOwn = require('../hw/charset_own.js');
const efOwn = require('../hw/charset9341_own.js');
const OWN = () => new Uint8Array(charsetOwn.build());
const EFROM = () => new Uint8Array(efOwn.build());

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { checks++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) { fails++; console.log('FAIL ' + m + '\n   ottenuto: ' + x + '\n   atteso:   ' + y); } };
const throws = (f, re, m) => { let e = null; try { f(); } catch (x) { e = x; } ok(!!e && re.test(e.message), m + (e ? ' (' + e.message + ')' : ' (non ha lanciato)')); };

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rb = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b; };
const F = (name, bytes) => ({name, bytes});
const runN = (app, n) => { let t = 10000, done = 0; while (done < n) { t += 20.2; done += app.step(t); } };

// ------------------------------------------------------------------------------------------------ 1. machines.js
{
  const K = M.KINDS;
  eq(K, ['odyssey2', 'g7000', 'g7200', 'c52', 'jopac', 'g7400'], 'le sei macchine, in questo ordine');
  eq(Object.keys(M.FAMILY).sort(), K.slice().sort(), 'ogni macchina ha una famiglia di BIOS');
  eq(Object.keys(M.NEEDS).sort(), K.slice().sort(), 'ogni macchina dice che cosa manca senza BIOS');
  for (const k of ['odyssey2', 'g7000', 'g7200']) ok(/G7000/.test(M.NEEDS[k]) && /1024 byte/.test(M.NEEDS[k]), 'NEEDS ' + k + ': BIOS G7000 da 1024 byte');
  ok(/C52/.test(M.NEEDS.c52) && /Jopac/.test(M.NEEDS.jopac) && /G7400/.test(M.NEEDS.g7400), 'NEEDS: C52, Jopac, G7400');
  eq(K.map((k) => M.defaultStandard(k)), ['NTSC', 'PAL', 'PAL', 'PAL', 'PAL', 'PAL'], 'standard di ogni macchina: solo l\'Odyssey 2 e\' NTSC');
  eq(K.map((k) => M.isMono(k)), [false, false, true, false, false, false], 'schermo in bianco e nero: solo il G7200');
  const sha = {};
  for (const [h, kind] of Object.entries(M.BIOS_MACHINE)) sha[kind] = h;
  const unk = 'f'.repeat(64);
  // famiglia G7000: BIOS G7000 e sconosciuti, mai C52 / Jopac / G7400
  for (const k of ['odyssey2', 'g7000', 'g7200']) {
    ok(M.fitsBios(k, sha.g7000) && M.fitsBios(k, unk), k + ': va col BIOS G7000 e con uno sconosciuto');
    ok(!M.fitsBios(k, sha.c52) && !M.fitsBios(k, sha.g7400) && !M.fitsBios(k, sha.jopac), k + ': non va con C52, G7400, Jopac');
  }
  for (const k of ['c52', 'jopac', 'g7400']) {
    ok(M.fitsBios(k, sha[k]), k + ': va col suo BIOS');
    ok(!M.fitsBios(k, unk) && !M.fitsBios(k, sha.g7000), k + ': non va con un BIOS sconosciuto ne\' col G7000');
    for (const o of ['c52', 'jopac', 'g7400']) if (o !== k) ok(!M.fitsBios(k, sha[o]), k + ': non va col BIOS ' + o);
  }
  for (const f of [M.fitsBios, M.defaultStandard, M.isMono]) throws(() => f('zx81', unk), /macchina sconosciuta: zx81/, 'macchina sconosciuta: errore');
  throws(() => M.fitsBios('toString', unk), /macchina sconosciuta/, 'nomi ereditati da Object non sono macchine');
}

// ------------------------------------------------------------------------------------------------ 2. regista con BIOS sconosciuti (nessun dump)
const BIOS_A = rb(1024), BIOS_B = rb(1024);
const mkApp = (o) => {
  const logs = [];
  const app = new App(Object.assign({fallbackCharset: OWN(), fallbackEfCharset: EFROM(), onMessage: (t, k) => logs.push([k || '', t])}, o || {}));
  return {app, logs, last: () => logs[logs.length - 1]};
};
const GAME = (n) => F('Gioco ' + n + ' (1981)(X)(EU).bin', rb(2048));

async function sintetico() {
  // senza BIOS
  {
    const h = mkApp(), a = h.app;
    const ch = a.machineChoices();
    eq(ch.map((c) => c.kind), M.KINDS, 'machineChoices: le sei macchine');
    ok(ch.every((c) => !c.available && c.bios === 0 && c.reason === M.NEEDS[c.kind] && c.label === M.LABELS[c.kind]), 'senza BIOS: nessuna macchina disponibile, con il motivo');
    ok(a.machine === null && a.machineKey === null, 'senza BIOS: nessuna macchina mostrata');
    const r0 = a.rev;
    ok(a.selectMachine('g7000') === false && h.last()[0] === 'warn' && h.last()[1] === M.LABELS.g7000 + ': ' + M.NEEDS.g7000 + '. Aggiungilo con «Aggiungi file».' && a.rev === r0 + 1, 'senza BIOS: scelta rifiutata con messaggio e ridisegno');
    ok(a.machinePref === 'auto' && a.biosId === null, 'senza BIOS: niente cambia');
    ok(a.selectMachine('zx81') === false && h.last()[0] === 'bad' && h.last()[1] === 'Macchina sconosciuta.', 'macchina sconosciuta');
    ok(a.selectMachine('toString') === false && a.selectMachine('') === false && a.selectMachine(undefined) === false && a.selectMachine(7) === false, 'valori strani rifiutati');
    ok(a.machineCandidates('c52').length === 0, 'machineCandidates senza BIOS: vuoto');
  }
  // un BIOS sconosciuto = famiglia G7000
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('mio.bin', BIOS_A), GAME(1), GAME(2)]);
    eq(a.machineChoices().map((c) => c.available), [true, true, true, false, false, false], 'BIOS sconosciuto: disponibili Odyssey 2, G7000 e G7200');
    eq([a.machinePref, a.machine.kind, a.machine.auto, a.machineKey, a.settings.standard, a.look.mono], ['auto', 'g7000', true, 'g7000', 'PAL', false], 'dopo l\'aggiunta: G7000 ricavato (PAL, a colori)');
    // senza console in uso: si fissano i valori, niente riavvio
    const r0 = a.lookRev, rev0 = a.rev;
    ok(a.selectMachine('odyssey2') === true, 'scelta: Odyssey 2');
    eq([a.machinePref, a.machine.kind, a.machine.auto, a.settings.standard, a.look.mono, a.biosId === a.lib.bios[0].id], ['odyssey2', 'odyssey2', false, 'NTSC', false, true], 'Odyssey 2 = NTSC, a colori');
    ok(a.lookRev === r0 + 1 && a.rev === rev0 + 1 && !a.running, 'la pagina si ridisegna e non parte niente');
    ok(a.selectMachine('g7200') === true, 'scelta: G7200');
    eq([a.machinePref, a.settings.standard, a.look.mono], ['g7200', 'PAL', true], 'G7200 = PAL e bianco e nero');
    ok(a.selectMachine('g7000') === true && a.look.mono === false && a.settings.standard === 'PAL' && a.machinePref === 'g7000', 'G7000 = PAL a colori');
    ok(a.selectMachine('c52') === false && a.machinePref === 'g7000', 'C52 senza il suo BIOS: rifiutata, niente cambia');
    // i filtri non cambiano con la macchina
    a.setLook({blur: 30, scan: 40}); a.selectMachine('g7200');
    ok(a.look.blur === 30 && a.look.scan === 40 && a.look.mono === true, 'i filtri restano quando cambia la macchina');
  }
  // console in uso: G7000 <-> G7200 non riavvia; cambiare standard si'
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('mio.bin', BIOS_A), GAME(1), GAME(2)]);
    const g1 = a.lib.games[0].id;
    ok(a.start(g1), 'avvio');
    runN(a, 40);
    h.logs.length = 0;
    const con0 = a.con, fr0 = a.framesRun;
    ok(a.selectMachine('g7200') === true, 'G7200 a console accesa');
    ok(a.con === con0 && a.framesRun === fr0 && a.gameId === g1 && a.look.mono === true && h.logs.length === 0, 'G7000 -> G7200: stessa console, nessun riavvio, nessun messaggio');
    ok(a.selectMachine('g7200') === true && a.con === con0, 'stessa macchina: niente');
    ok(!a.hasState(g1), 'nessuna partita memorizzata finora');
    ok(a.selectMachine('odyssey2') === true, 'Odyssey 2 a console accesa');
    ok(a.con !== con0 && a.running && a.gameId === g1 && a.settings.standard === 'NTSC' && a.look.mono === false && a.con.std === 'NTSC', 'G7200 -> Odyssey 2: la console riparte in NTSC e a colori');
    ok(a.hasState(g1), 'la partita si memorizza prima di ripartire');
    eq(h.logs.map((l) => l[1]).filter((t) => /riparte/.test(t)), [M.LABELS.odyssey2 + ': la console riparte (avvio a freddo del gioco in uso).'], 'messaggio di riavvio');
    ok(a.framesRun === 0, 'dopo il riavvio i fotogrammi ripartono da zero');
    const con1 = a.con; runN(a, 40);
    ok(a.selectMachine('g7000') === true && a.con !== con1 && a.settings.standard === 'PAL' && a.con.std === 'PAL', 'Odyssey 2 -> G7000: riparte in PAL');
    // lo stato memorizzato in NTSC non si riprende in PAL (e' legato allo standard)
    ok(a.resume(g1) === false && /salvato in NTSC/.test(h.logs[h.logs.length - 1][1]), 'resume: lo stato memorizzato in NTSC non si riprende in PAL');
  }
  // due BIOS della famiglia: si tiene quello in uso se va bene
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('uno.bin', BIOS_A), F('due.bin', BIOS_B), GAME(1)]);
    const [b1, b2] = a.lib.bios;
    ok(a.machineCandidates('g7200').length === 2 && a.machineChoices()[2].bios === 2, 'due BIOS adatti alla famiglia G7000');
    ok(a.selectBios(b2.id) && a.biosId === b2.id, 'BIOS due in uso');
    ok(a.selectMachine('g7200') && a.biosId === b2.id, 'la macchina tiene il BIOS in uso (anche se non e\' il primo)');
    ok(a.selectBios(b1.id) && a.biosId === b1.id && a.machinePref === 'g7200', 'cambiare BIOS dentro la famiglia non cambia la macchina');
  }
  // selectBios con un BIOS che non va alla macchina scelta: la macchina torna automatica
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('uno.bin', BIOS_A), GAME(1)]);
    a.selectMachine('g7200');
    ok(a.machinePref === 'g7200', 'prima: G7200');
    a._pinMachine(); ok(a.machinePref === 'g7200', '_pinMachine non tocca una macchina scelta');
  }
  // setStandard fissa la macchina ricavata
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('uno.bin', BIOS_A), GAME(1)]);
    ok(a.machinePref === 'auto' && a.machine.kind === 'g7000', 'automatica: G7000');
    a.setStandard('NTSC');
    ok(a.machinePref === 'g7000' && a.machine.kind === 'g7000' && a.machine.auto === false && a.settings.standard === 'NTSC', 'setStandard NTSC: la macchina resta G7000 (non diventa Odyssey 2)');
    a.setStandard('PAL');
    ok(a.machine.kind === 'g7000' && a.settings.standard === 'PAL', 'di nuovo PAL: G7000');
    const r = a.lookRev; a.setStandard('PAL'); ok(a.lookRev === r, 'stesso standard: niente');
    // senza BIOS: setStandard non inventa una macchina
    const h2 = mkApp(); h2.app.setStandard('NTSC'); ok(h2.app.machinePref === 'auto' && h2.app.machine === null, 'setStandard senza BIOS: nessuna macchina');
  }
  // clearLibrary: macchina automatica e schermo a colori
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('uno.bin', BIOS_A), GAME(1)]);
    a.selectMachine('g7200'); a.setLook({blur: 20});
    a.clearLibrary();
    ok(a.machinePref === 'auto' && a.look.mono === false && a.look.blur === 20 && a.machine === null, 'clearLibrary: macchina automatica, schermo a colori, i filtri restano');
  }
  // sessioni: andata e ritorno
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('uno.bin', BIOS_A), GAME(1)]);
    a.selectMachine('g7200');
    const sess = a.saveSession('2026-10-15T20:00:00.000Z');
    const p = S.parseSession(sess);
    ok(p.settings.machine === 'g7200' && p.settings.look.mono === true, 'sessione: macchina e B/N nel file');
    const h2 = mkApp(), b = h2.app;
    ok(await b.loadSession(sess, 's.zip') === true, 'sessione aperta');
    eq([b.machinePref, b.look.mono, b.machine.kind], ['g7200', true, 'g7200'], 'sessione: G7200 e schermo B/N ripristinati');
    // sessione di prima della tappa 5c: «macchina mostrata» scelta a mano ma BIOS diverso, B/N a parte
    const lib = a.lib;
    const mk = (settings, standard) => S.buildSession({lib, activeGameId: null, activeBiosId: a.biosId, standard: standard || 'PAL', states: new Map(), settings, created: '2026-10-12T00:00:00.000Z'});
    const t1 = mkApp(); await t1.app.loadSession(mk({machine: 'c52', look: {mono: false}}));
    eq([t1.app.machinePref, t1.app.look.mono], ['g7000', false], 'sessione vecchia: C52 con un BIOS G7000 non e\' coerente: si ricava G7000');
    const t2 = mkApp(); await t2.app.loadSession(mk({machine: 'auto', look: {mono: true}}));
    eq([t2.app.machinePref, t2.app.look.mono], ['g7200', true], 'sessione vecchia: automatica + B/N = G7200');
    const t3 = mkApp(); await t3.app.loadSession(mk({machine: 'auto', look: {mono: false}}, 'NTSC'));
    eq([t3.app.machinePref, t3.app.look.mono, t3.app.settings.standard], ['odyssey2', false, 'NTSC'], 'sessione vecchia: automatica + NTSC = Odyssey 2');
    const t4 = mkApp(); await t4.app.loadSession(mk({machine: 'g7200', look: {mono: false}}));
    eq([t4.app.machinePref, t4.app.look.mono], ['g7200', true], 'sessione vecchia: G7200 scelto a mano: lo schermo diventa B/N');
    const t5 = mkApp(); await t5.app.loadSession(mk({machine: 'odyssey2', look: {mono: true}}));
    eq([t5.app.machinePref, t5.app.look.mono], ['odyssey2', false], 'sessione vecchia: B/N spento se la macchina non e\' il G7200');
    const t6 = mkApp(); await t6.app.loadSession(mk({}));
    eq([t6.app.machinePref, t6.app.look.mono], ['g7000', false], 'sessione senza macchina: G7000 (PAL)');
    // sessione senza BIOS: restano i valori attuali
    const noBios = S.buildSession({lib: new (require(SP('library.js')).Library)(), standard: 'PAL', settings: {machine: 'g7200', look: {mono: true}}, created: ''});
    const t7 = mkApp(); await t7.app.loadSession(noBios);
    eq([t7.app.machinePref, t7.app.look.mono, t7.app.machine], ['g7200', true, null], 'sessione senza BIOS: valori della sessione, nessuna macchina mostrata');
  }
}

// ------------------------------------------------------------------------------------------------ 3. con i quattro BIOS veri (in locale)
async function conDump(dumps) {
  const rd = (p) => new Uint8Array(fs.readFileSync(path.join(dumps, p)));
  const bios = {o2: rd('bios/o2rom.bin'), c52: rd('bios/c52.bin'), g7400: rd('bios/g7400.bin'), jopac: rd('bios/jopac.bin')};
  {
    const h = mkApp(), a = h.app;
    await a.openFiles([F('o2rom.bin', bios.o2), GAME(1)]);
    eq(a.machineChoices().map((c) => c.available), [true, true, true, false, false, false], 'BIOS Odyssey 2 / G7000 vero: famiglia G7000');
    eq(a.machineChoices().filter((c) => !c.available).map((c) => c.reason), [M.NEEDS.c52, M.NEEDS.jopac, M.NEEDS.g7400], 'i motivi dei BIOS che mancano');
    await a.openFiles([F('c52.bin', bios.c52), F('g7400.bin', bios.g7400), F('jopac.bin', bios.jopac)]);
    ok(a.lib.bios.length === 4 && a.machineChoices().every((c) => c.available && c.bios === 1), 'con tutti e quattro: sei macchine disponibili, un BIOS ciascuna');
    ok(a.machine.kind === 'g7000' && a.bios.sha === Object.keys(M.BIOS_MACHINE).find((s) => M.BIOS_MACHINE[s] === 'g7000'), 'il BIOS in uso resta quello G7000');
    const g1 = a.lib.games[0].id;
    ok(a.start(g1)); runN(a, 40);
    // C52: cambia BIOS, riparte
    ok(a.selectMachine('c52') === true && a.bios.known && M.biosMachine(a.bios.sha) === 'c52' && a.machine.kind === 'c52' && a.settings.standard === 'PAL' && a.running && a.hasState(g1), 'C52: BIOS C52, riparte, partita memorizzata');
    ok(a.selectMachine('jopac') === true && M.biosMachine(a.bios.sha) === 'jopac' && a.con.g7400 === true, 'Jopac: console G7400 con il BIOS Jopac');
    ok(a.selectMachine('g7400') === true && M.biosMachine(a.bios.sha) === 'g7400' && a.isG7400 && a.look.mono === false, 'G7400: console G7400');
    ok(a.selectMachine('g7200') === true && M.biosMachine(a.bios.sha) === 'g7000' && !a.isG7400 && a.look.mono === true && a.con.g7400 === false, 'G7200: di nuovo il BIOS G7000, schermo B/N');
    ok(a.selectMachine('odyssey2') === true && a.settings.standard === 'NTSC' && a.look.mono === false, 'Odyssey 2: NTSC e colori');
    // selectBios verso un BIOS di un'altra famiglia: la macchina torna automatica
    const c52 = a.lib.bios.find((b) => M.biosMachine(b.sha) === 'c52');
    ok(a.selectBios(c52.id) && a.machinePref === 'auto' && a.machine.kind === 'c52', 'selectBios C52: la macchina si ricava dal BIOS');
    // scelta che fallisce: il G7400 senza il set EF9341 ne' di ripiego
    const h2 = mkApp({fallbackEfCharset: null}), b = h2.app;
    await b.openFiles([F('o2rom.bin', bios.o2), F('g7400.bin', bios.g7400), GAME(1)]);
    ok(b.start(b.lib.games[0].id)); runN(b, 40);
    const before = JSON.stringify([b.biosId, b.settings.standard, b.machinePref, b.look, b.gameId]), con0 = b.con;
    ok(b.selectMachine('g7400') === false && /^Macchina non utilizzabile: .*EF9341/.test(h2.last()[1]) && h2.last()[0] === 'bad', 'G7400 senza set EF9341: rifiutata con il motivo');
    ok(JSON.stringify([b.biosId, b.settings.standard, b.machinePref, b.look, b.gameId]) === before && b.con === con0 && b.running && !b.hasState(b.gameId), 'rifiuto: niente cambia, la partita non si ferma e non si memorizza');
    // sessione con BIOS G7400, macchina e standard
    const sess = a.saveSession('2026-10-15T20:00:00.000Z');
    const h3 = mkApp(), c = h3.app;
    ok(await c.loadSession(sess, 'x.zip') && c.machine.kind === a.machine.kind && c.look.mono === a.look.mono, 'sessione con BIOS veri: macchina ripristinata');
    // sessione vecchia: «macchina mostrata» g7400 con il BIOS G7000 -> si ricava
    const old = S.buildSession({lib: a.lib, activeGameId: null, activeBiosId: a.lib.bios.find((x) => M.biosMachine(x.sha) === 'g7000').id, standard: 'PAL', states: new Map(), settings: {machine: 'g7400'}, created: ''});
    const d = mkApp(); await d.app.loadSession(old);
    ok(d.app.machinePref === 'g7000', 'sessione vecchia: G7400 mostrato con il BIOS G7000 non e\' coerente: si ricava G7000');
  }
}

(async () => {
  await sintetico();
  const dumps = process.argv[2] || process.env.O2_DUMPS;
  if (dumps && ['o2rom', 'c52', 'g7400', 'jopac'].every((n) => fs.existsSync(path.join(dumps, 'bios', n + '.bin')))) await conDump(dumps);
  else console.log('  (BIOS veri: saltati, serve la cartella dei dump)');
  console.log(fails ? 'FALLITO: ' + fails + ' controlli su ' + checks : 'OK (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ECCEZIONE: ' + (e.stack || e)); process.exit(1); });
