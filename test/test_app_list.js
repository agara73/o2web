'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_app_list.js DUMPS - tappa 7 nel regista (app.js, senza DOM): elenco a voci con fusione dei dump identici (acceso all'apertura), avvio / ripresa / rimozione
// di una voce unita, elenco di nomi, anteprime con la console vera (contesto: BIOS, set di caratteri, standard), sessione (la fusione non si salva, i dump si).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const path = require('path');
const {App} = require(SP('app.js'));
const {zipStore} = require(SP('zipstore.js'));
const charsetOwn = require('../hw/charset_own.js');
const FALLBACK = new Uint8Array(charsetOwn.build());
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 25) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));
const dumps = process.argv[2] || process.env.O2_DUMPS;
const enc = (s) => new TextEncoder().encode(s);
const rd = (p) => ({name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(path.join(dumps, p)))});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (f, ms) => { const t = Date.now(); while (!f() && Date.now() - t < (ms || 20000)) await sleep(10); return f(); };

(async () => {
  if (!dumps) { console.log('  (serve la cartella dei dump)'); process.exit(0); }
  const msgs = [];
  const app = new App({onMessage: (t, k) => msgs.push([k, t]), sink: null, fallbackCharset: FALLBACK});
  ok(app.mergeDuplicates === true && app.previews.enabled === true, 'all\'apertura: fusione e anteprime accese');
  const kb = rd('killerbees.bin'), bo = rd('blockout.bin'), pp = rd('pickaxepete.bin');
  // lo stesso Killer Bees con tre nomi (uno e' una sigla); Blockout con un nome; un elenco di nomi
  const z = zipStore([{name: 'Raccolta/vp_52.bin', data: kb.bytes}, {name: 'Raccolta/Killer Bees (198x)(Philips)(EU).bin', data: kb.bytes},
    {name: 'Raccolta/Gamelist.txt', data: enc('vp_52.bin   Killer Bees\nvp_01.bin   Race\nvp_02.bin   Pairs\nvp_03.bin   Football\n')}]);
  await app.openFiles([rd('bios/o2rom.bin'), rd('bios/c52.bin'), {name: 'racc.zip', bytes: z}, bo, {name: 'Killer Bees 2.bin', bytes: kb.bytes}, pp]);
  ok(app.lib.games.length === 5 && app.lib.names.size === 4, 'importazione: 5 giochi (tre nomi per Killer Bees + altro nome), elenco di nomi di 4 voci (' + app.lib.games.length + ', ' + app.lib.names.size + ')');
  ok(msgs.some(([, t]) => /un elenco di nomi \(4 voci\)/.test(t)), 'messaggio: un elenco di nomi (4 voci)');
  let es = app.listEntries('', null);
  eq([es.length, app.entryCount()], [3, 3], 'voci con fusione: 3 (Killer Bees x3 file, Blockout, Pick Axe Pete)');
  const eK = es.find((e) => e.count > 1);
  eq([eK.count, eK.sigla, eK.title], [3, 'vp_52', 'Killer Bees'], 'voce Killer Bees unita');
  // catalogo delle cartucce: la sigla vp_52 (il contenuto e' vp_52pl per l'impronta: stesso gioco, nessuna discordanza) porta al Videopac 52; la ricerca per numero e per titolo straniero lo raggiunge
  ok(eK.cat && eK.cat.number === 'Videopac 52' && eK.match.how === 'sigla' && eK.match.number === 52 && eK.conflict === null, 'catalogo: vp_52 = Videopac 52 dalla sigla, nessuna discordanza (' + JSON.stringify(eK.cat && eK.cat.number) + ')');
  ok(es.every((e) => e.cat === null || typeof e.cat.line === 'string'), 'catalogo: ogni voce ha un abbinamento o niente');
  eq(app.listEntries('videopac 52', null).map((e) => e.title), ['Killer Bees'], 'ricerca per numero di catalogo (voce unita)');
  ok(app.setMerge(false) === false && app.mergeDuplicates === false, 'setMerge(false)');
  eq([app.listEntries('', null).length, app.entryCount()], [5, 5], 'senza fusione: una voce per dump');
  ok(app.setMerge(true) === true, 'setMerge(true)');
  eq(app.listEntries('killer', null).length, 1, 'ricerca nella vista unita');
  eq(app.listEntries('', 'Raccolta').length, 1, 'filtro per cartella nella vista unita');
  const rev = app.rev;
  app.setMerge(false); app.setMerge(true);
  ok(app.rev > rev, 'il cambio di vista fa ridisegnare la pagina (rev)');
  // la vista si ricalcola quando la libreria cambia
  const ver = app.lib.version;
  await app.openFiles([{name: 'altro.bin', bytes: (() => { const b = new Uint8Array(2048); for (let i = 0; i < b.length; i++) b[i] = (i * 7 + 3) & 255; return b; })()}]);
  ok(app.lib.version > ver && app.entryCount() === 4, 'vista aggiornata dopo l\'aggiunta di un gioco (' + app.entryCount() + ')');
  // ---- avvio, stato, ripresa, rimozione di una voce unita
  es = app.listEntries('', null);
  const eK2 = es.find((e) => e.count > 1);
  ok(app.startEntry(eK2) && app.gameId === eK2.rep.id, 'startEntry avvia il dump rappresentante');
  ok(app.entryIsCurrent(eK2), 'entryIsCurrent');
  ok(app.removeEntry(eK2) === false && app.lib.games.length === 6, 'la voce del gioco in uso non si toglie');
  for (let i = 0; i < 40; i++) app.con.runFrame();
  app.framesRun = 100;
  const eB = es.find((e) => e.games.some((g) => /blockout/i.test(g.title)));
  ok(app.startEntry(eB), 'avvio di un altro gioco: lo stato del primo si memorizza');
  eq(app.entryStateId(eK2), eK2.rep.id, 'entryStateId: il dump con lo stato');
  ok(app.entryStateId(eB) === null, 'entryStateId: nessuno stato per Blockout');
  ok(app.resumeEntry(eK2) && app.gameId === eK2.rep.id, 'resumeEntry riprende lo stato');
  // lo stato e' di un membro che non e' il rappresentante: la ripresa usa quello
  ok(app.startEntry(eB), 'cambio gioco (memorizza il gioco che si lascia)');
  const other = eK2.games.find((g) => g.id !== eK2.rep.id);
  app.states.set(other.id, app.states.get(eK2.rep.id));
  app.states.delete(eK2.rep.id);
  ok(app.entryStateId(eK2) === other.id, 'stato su un altro membro');
  ok(app.resumeEntry(eK2) && app.gameId === other.id, 'resumeEntry usa il membro che ha lo stato');
  app.startEntry(eB);
  ok(app.removeEntry(eK2) === true && app.lib.games.every((g) => !eK2.ids.includes(g.id)) && app.lib.games.length === 6 - 3, 'removeEntry toglie tutti i dump della voce');
  ok(![...app.states.keys()].some((id) => eK2.ids.includes(id)), 'e i loro stati');
  eq(app.entryCount(), 3, 'voci dopo la rimozione');

  // ---- anteprime con la console vera
  const csPath = path.join(dumps, '..', 'cs', 'charset.bin');   // set vero accanto ai dump, se c'e'
  const csFile = fs.existsSync(csPath) ? fs.readFileSync(csPath) : null;
  const cs = new Uint8Array(csFile && csFile.length ? csFile : FALLBACK);
  const entries = app.listEntries('', null);
  const seen = [];
  app.onPreview = (g, r) => seen.push([g.sha, r.state]);
  app.requestPreviews(entries);
  ok(await waitFor(() => app.previews.stats().pending === 0 && seen.length >= 3), 'anteprime calcolate');
  const pv = app.previewFor(entries.find((e) => e.games.some((g) => /blockout/i.test(g.title))));
  ok(pv && pv.state === 'ready' && pv.rgba.length === 80 * 54 * 4, 'anteprima di Blockout pronta');
  let colors = new Set();
  for (let i = 0; i < pv.rgba.length; i += 4) colors.add(pv.rgba[i] << 16 | pv.rgba[i + 1] << 8 | pv.rgba[i + 2]);
  ok(colors.size >= 3, 'anteprima di Blockout con almeno 3 colori (' + colors.size + ')');
  ok(app.previewRev >= 3, 'previewRev sale');
  // il contesto cambia con BIOS, standard, set di caratteri, pin B e ROM scacchi: la memoria si svuota
  const ready0 = app.previews.stats().ready;
  ok(ready0 >= 1, 'anteprime in memoria');
  app.setStandard('NTSC');
  ok(app.previewFor(entries[0]) === null && app.previews.stats().ready === 0, 'standard cambiato: anteprime svuotate');
  app.requestPreviews(entries);
  ok(await waitFor(() => app.previews.stats().pending === 0 && app.previews.stats().ready >= 1), 'anteprime rifatte in NTSC');
  app.setStandard('PAL');
  ok(app.previews.stats().ready === 0, 'tornando a PAL: di nuovo vuota (contesto diverso)');
  app.requestPreviews(entries);
  await waitFor(() => app.previews.stats().pending === 0 && app.previews.stats().ready >= 1);
  const c52 = app.lib.bios.find((b) => /C52/.test(b.display));
  ok(app.selectBios(c52.id) && app.previews.stats().ready === 0, 'BIOS cambiato: anteprime svuotate');
  app.requestPreviews(entries);
  await waitFor(() => app.previews.stats().pending === 0);
  const rdy = app.previews.stats().ready;
  app.setCharset('x.bin', cs);
  ok(app.previews.stats().ready === 0 && rdy >= 0, 'set di caratteri cambiato: anteprime svuotate');
  // interruttore
  app.requestPreviews(entries);
  app.setPreviews(false);
  ok(app.previews.stats().pending === 0 && app.previewFor(entries[0]) === null && app.previews.enabled === false, 'setPreviews(false): coda annullata');
  app.requestPreviews(entries);
  ok(app.previews.stats().pending === 0, 'spento: niente richieste');
  app.setPreviews(true);
  ok(app.previews.enabled === true, 'riacceso');
  // nessun BIOS utilizzabile: le anteprime sono «none» e non si bloccano
  const empty = new App({onMessage() {}, sink: null, fallbackCharset: FALLBACK});
  await empty.openFiles([bo]);
  const ee = empty.listEntries('', null);
  empty.requestPreviews(ee);
  ok(await waitFor(() => empty.previews.stats().pending === 0), 'senza BIOS: la coda finisce');
  eq(empty.previewFor(ee[0]).state, 'none', 'senza BIOS: anteprima non disponibile');

  // ---- sessione: i dump e gli stati si salvano; la fusione e le anteprime no; i nomi dell'elenco tornano dalla tabella incorporata
  app.setMerge(false);
  const sess = app.saveSession('2026-10-18');
  const a2 = new App({onMessage() {}, sink: null, fallbackCharset: FALLBACK});
  await a2.openFiles([{name: 'sessione.zip', bytes: sess}]);
  ok(a2.lib.games.length === app.lib.games.length && a2.mergeDuplicates === true && a2.previews.enabled === true, 'sessione riaperta: stessi giochi, fusione e anteprime accese (non si ricordano)');
  ok(a2.lib.names.size === 0 && a2.entryCount() >= 1, 'sessione riaperta: l\'elenco di nomi non e\' nella sessione');
  const kbEntry = a2.listEntries('', null);
  ok(kbEntry.every((e) => e.title), 'voci con un titolo');
  console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
  process.exit(bad ? 1 : 0);
})();
