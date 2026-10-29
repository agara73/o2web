'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_automachine.js DUMPS - cambio di macchina automatico per i giochi «solo Videopac+» della lista delle cartucce (richiesta dell'utente, 18/10/2026):
// avviando una cartuccia segnata «solo Videopac+» (Norseman, Helicopter Rescue...) si passa al Videopac+ G7400 se c'e' il suo BIOS; con un gioco normale
// si torna alla macchina di prima; la scelta a mano della macchina o del BIOS vince; l'interruttore si spegne. Usa i dump veri (in locale).
const fs = require('fs');
const path = require('path');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {App} = require(SP('app.js'));
const charsetOwn = require('../hw/charset_own.js');
const efOwn = require('../hw/charset9341_own.js');
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 25) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));
const dumps = process.argv[2] || process.env.O2_DUMPS;

function findFile(dir, re) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, re); if (r) return r; } else if (re.test(e.name)) return p;
  }
  return null;
}

(async () => {
  if (!dumps || !fs.existsSync(path.join(dumps, 'bios', 'g7400.bin'))) { console.log('  (serve la cartella dei dump con bios/g7400.bin)'); process.exit(0); }
  const rd = (p) => new Uint8Array(fs.readFileSync(p));
  const norse = findFile(path.join(dumps, '_tosec_vp'), /^Norseman/);
  if (!norse) { console.log('  (manca Norseman nei dump TOSEC: prova saltata)'); process.exit(0); }
  const files = [{name: 'o2rom.bin', bytes: rd(path.join(dumps, 'bios/o2rom.bin'))}, {name: 'g7400.bin', bytes: rd(path.join(dumps, 'bios/g7400.bin'))},
    {name: 'Norseman (198x)(Philips)(EU).zip', bytes: rd(norse)}, {name: 'killerbees.bin', bytes: rd(path.join(dumps, 'killerbees.bin'))}];
  const logs = [];
  const mk = () => new App({fallbackCharset: new Uint8Array(charsetOwn.build()), fallbackEfCharset: new Uint8Array(efOwn.build()), onMessage: (t, k) => logs.push((k || '-') + ': ' + t)});
  const idOf = (app, re) => app.lib.games.find((g) => re.test(g.name)).id;
  const entryOf = (app, re) => app.listEntries('', null).find((e) => e.games.some((g) => re.test(g.name)));

  // ---- il gioco e' segnato «solo Videopac+» nella lista
  {
    const app = mk();
    await app.addFiles(files);
    const eN = entryOf(app, /Norseman/), eK = entryOf(app, /killerbees/);
    ok(eN && eN.match && eN.match.plusOnly, 'Norseman e\' segnato solo Videopac+');
    ok(eK && eK.match && !eK.match.plusOnly, 'Killer Bees (file normale) non e\' solo Videopac+');
    eq(app.autoMachine, true, 'acceso all\'apertura');
    ok(app.machineKey === 'g7000' || app.machineKey === 'odyssey2', 'prima: macchina G7000 / Odyssey 2 (' + app.machineKey + ')');
    const before = app.machineKey, beforeStd = app.settings.standard;
    // avvio di un gioco solo Plus: passa al G7400
    ok(app.startEntry(eN) && app.running !== false, 'Norseman parte');
    eq([app.machineKey, app.isG7400, !!app.con.g7400], ['g7400', true, true], 'Norseman: macchina Videopac+ G7400');
    ok(logs.some((l) => /solo Videopac\+/i.test(l) && /G7400/.test(l)), 'messaggio del cambio di macchina');
    // un gioco normale: si torna alla macchina di prima, con lo standard di prima
    ok(app.startEntry(eK), 'Killer Bees parte');
    eq([app.machineKey, app.isG7400, app.settings.standard], [before, false, beforeStd], 'Killer Bees: si torna alla macchina di prima');
    ok(!!app.con && !app.con.g7400, 'la console non e\' piu\' G7400');
    // un secondo gioco normale non cambia niente
    logs.length = 0;
    ok(app.startEntry(eK) && app.machineKey === before && !logs.some((l) => /Videopac\+ G7400/.test(l)), 'gioco normale dopo gioco normale: nessun cambio');
    // ripresa: lo stato di Norseman e' del G7400; riprenderlo passa al G7400
    ok(app.startEntry(eN), 'Norseman di nuovo');
    for (let i = 0; i < 40; i++) app.con.runFrame();
    ok(app.memorize(false), "memorizzazione esplicita");
    ok(app.startEntry(eK), 'Killer Bees, Norseman resta memorizzato');
    ok(app.entryStateId(eN) !== null, 'stato di Norseman memorizzato');
    ok(app.resumeEntry(eN) && app.machineKey === 'g7400' && app.con.g7400, 'riprendere Norseman: macchina G7400 senza dover scegliere il BIOS');
  }
  // ---- _plusBios: solo per i giochi segnati, solo con l'interruttore acceso e senza scelta a mano
  {
    const app = mk();
    await app.addFiles(files);
    const gN = app.lib.games.find((g) => /Norseman/.test(g.name)), gK = app.lib.games.find((g) => /killerbees/.test(g.name));
    ok(app._plusBios(gN) && app._plusBios(gN).known.system === 'g7400', '_plusBios: Norseman -> BIOS G7400');
    eq(app._plusBios(gK), null, '_plusBios: gioco normale -> nessun BIOS diverso');
    app.setAutoMachine(false);
    eq(app._plusBios(gN), null, '_plusBios: interruttore spento -> nessuno');
    app.setAutoMachine(true);
    app.selectMachine('g7000');
    eq(app._plusBios(gN), null, '_plusBios: scelta a mano -> nessuno');
  }
  // ---- il ricordo della macchina di prima: spegnere e riaccendere l'interruttore non lo perde; una scelta a mano lo cancella
  {
    const app = mk();
    await app.addFiles(files);
    const before = app.machineKey;
    app.startEntry(entryOf(app, /Norseman/));
    ok(app.machineKey === 'g7400', 'passato al G7400');
    app.setAutoMachine(false); app.setAutoMachine(true);
    app.startEntry(entryOf(app, /killerbees/));
    eq(app.machineKey, before, 'spento e riacceso: si torna comunque alla macchina di prima');
    app.startEntry(entryOf(app, /Norseman/));
    ok(app.machineKey === 'g7400', 'di nuovo al G7400');
    app.selectMachine('g7400');                                   // scelta a mano della stessa macchina: il ritorno automatico non c'e' piu'
    app.setAutoMachine(false); app.setAutoMachine(true);
    app.startEntry(entryOf(app, /killerbees/));
    eq(app.machineKey, 'g7400', 'scelta a mano del G7400, poi interruttore spento e riacceso: il gioco normale resta sul G7400');
  }
  // ---- schermo in bianco e nero (G7200): andata al G7400 a colori e ritorno
  {
    const app = mk();
    await app.addFiles(files);
    ok(app.setLook({mono: true}) !== false && app.machineKey === 'g7200' && app.look.mono === true, 'prima: Videopac G7200 (schermo in bianco e nero)');
    app.startEntry(entryOf(app, /Norseman/));
    eq([app.machineKey, app.look.mono], ['g7400', false], 'Norseman: G7400 a colori');
    app.startEntry(entryOf(app, /killerbees/));
    eq([app.machineKey, app.look.mono], ['g7200', true], 'Killer Bees: di nuovo G7200 in bianco e nero');
  }
  // ---- interruttore spento
  {
    const app = mk();
    await app.addFiles(files);
    ok(app.setAutoMachine(false) === false && app.autoMachine === false, 'setAutoMachine(false)');
    const before = app.machineKey;
    logs.length = 0;
    ok(app.startEntry(entryOf(app, /Norseman/)) && app.machineKey === before && !app.con.g7400, 'interruttore spento: Norseman resta sulla macchina in uso');
    ok(logs.some((l) => /solo Videopac\+/i.test(l)), 'avvertimento: il gioco e\' solo Videopac+');
    ok(app.setAutoMachine(true) === true, 'setAutoMachine(true)');
    ok(app.startEntry(entryOf(app, /Norseman/)) && app.machineKey === 'g7400', 'riacceso: passa al G7400');
  }
  // ---- la scelta a mano vince
  {
    const app = mk();
    await app.addFiles(files);
    ok(app.selectMachine('g7000'), 'scelta a mano: Videopac G7000');
    eq(app.machineManual, true, 'scelta a mano segnata');
    logs.length = 0;
    ok(app.startEntry(entryOf(app, /Norseman/)) && app.machineKey === 'g7000' && !app.con.g7400, 'scelta a mano: Norseman resta sul G7000');
    ok(logs.some((l) => /solo Videopac\+/i.test(l)), 'avvertimento anche con la scelta a mano');
    app.setAutoMachine(false); app.setAutoMachine(true);                       // riaccendere l'interruttore restituisce il comando alla pagina
    eq(app.machineManual, false, 'riaccendere l\'interruttore toglie la scelta a mano');
    ok(app.startEntry(entryOf(app, /Norseman/)) && app.machineKey === 'g7400', 'dopo: passa al G7400');
    // scegliere a mano un'altra macchina mentre si e' passati in automatico: poi nessun ritorno automatico
    ok(app.selectMachine('g7400'), 'scelta a mano del G7400');
    ok(app.startEntry(entryOf(app, /killerbees/)) && app.machineKey === 'g7400', 'scelta a mano del G7400: Killer Bees ci resta');
  }
  // ---- scelta a mano del BIOS
  {
    const app = mk();
    await app.addFiles(files);
    const g = app.lib.bios.find((b) => b.known && b.known.system === 'g7400');
    ok(g && app.selectBios(g.id), 'scelta a mano del BIOS G7400');
    ok(app.startEntry(entryOf(app, /killerbees/)) && app.isG7400, 'BIOS scelto a mano: il gioco normale non lo cambia');
  }
  // ---- senza il BIOS G7400
  {
    const app = mk();
    await app.addFiles([files[0], files[2], files[3]]);
    logs.length = 0;
    ok(app.startEntry(entryOf(app, /Norseman/)) && !app.con.g7400, 'senza BIOS G7400: parte sul G7000');
    ok(logs.some((l) => /BIOS/.test(l) && /Videopac\+/.test(l)), 'avvertimento: serve il BIOS Videopac+ G7400');
  }
  // ---- anteprime: un gioco solo Videopac+ si prova col G7400 (col G7000 resterebbe vuoto)
  {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitIdle = async (app) => { const t = Date.now(); while (app.previews.stats().pending > 0 && Date.now() - t < 60000) await sleep(20); };
    const app = mk();
    await app.addFiles(files);
    const eN = entryOf(app, /Norseman/);
    app.requestPreviews([eN]);
    await waitIdle(app);
    const on = app.previewFor(eN);
    ok(on && on.state === 'ready', 'anteprima di Norseman col cambio automatico: disegnata (' + (on && on.state) + ')');
    eq(app.machineKey === 'g7400', false, 'l\'anteprima non cambia la macchina in uso');
    app.setAutoMachine(false);
    app.requestPreviews([eN]);
    await waitIdle(app);
    const off = app.previewFor(eN);
    ok(off && off.state !== 'ready', 'anteprima di Norseman senza cambio automatico (col G7000): vuota (' + (off && off.state) + ')');
    app.setAutoMachine(true);
    app.requestPreviews([eN]);
    await waitIdle(app);
    ok(app.previewFor(eN).state === 'ready', 'riacceso il cambio automatico l\'anteprima torna a essere disegnata');
  }
  console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
  process.exit(bad ? 1 : 0);
})();
