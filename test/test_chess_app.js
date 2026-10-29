'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_chess_app.js - modulo scacchi C7010 dalla parte dell'utente: riconoscimento delle due ROM per dimensione + CRC-32 (con file NOSTRI
// costruiti per avere quelle impronte: i dump veri non servono e non stanno nel pacchetto), abbinamento, avviso se manca la ROM da 8 KB,
// riavvio a freddo quando si aggiunge o si toglie, stato, sessione (versione 3) e rifiuto delle sessioni false.
// Uso: node test/test_chess_app.js   (O2_SRC_DIR = copia guastata dalla prova di mutazione)
const path = require('path');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {buildBios8048, forgedZ80Rom, forgedChessCart, EXPECTED} = require('./chess_testrom.js');
const {App} = require(SP('app.js'));
const L = require(SP('library.js'));
const S = require(SP('session.js'));
const {zipStore} = require(SP('zipstore.js'));
const {listZip, extractEntry, crc32} = require(SP('unzip.js'));
const {sha256} = require(SP('sha256.js'));
const charsetOwn = require('../hw/charset_own.js');
const FALLBACK = new Uint8Array(charsetOwn.build());

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
const throws = (fn, re) => { try { fn(); } catch (e) { return re.test(e.message); } return false; };

const Z80 = forgedZ80Rom(), CART = forgedChessCart(), BIOS = buildBios8048();
const f = (name, bytes) => ({name, bytes});

(async () => {
  // ---- 1. i file forgiati hanno le impronte dichiarate; classify per dimensione + CRC-32
  ok(crc32(Z80) === 0x45080245 && Z80.length === 8192 && crc32(CART) === 0x77066338 && CART.length === 2048, 'file di prova: dimensione e CRC-32 delle ROM vere');
  ok(L.CHESS.z80Crc === 0x45080245 && L.CHESS.cartCrc === 0x77066338 && L.CHESS.z80Size === 8192 && L.CHESS.cartSize === 2048, 'costanti di riconoscimento');
  eq(L.classify('z80_c7010.bin', '', Z80).kind, 'chessz80', 'ROM Z80 riconosciuta');
  eq(L.classify('qualunque_nome.rom', '', Z80).kind, 'chessz80', 'ROM Z80: il nome non conta');
  const other8k = Z80.slice(); other8k[100] ^= 1;
  eq(L.classify('z80_c7010.bin', '', other8k).kind, 'cart', 'un file da 8 KB con altro CRC-32 e\' una cartuccia normale (anche se si chiama come la ROM)');
  eq(L.classify('x.bin', '', Z80.subarray(0, 4096)).kind, 'cart', 'una meta\' della ROM non e\' la ROM');
  const g = L.makeGame('Chess Module C7010.bin', 'Philips Videopac', 'file', CART, undefined);
  ok(g.chess === true && g.size === 2048, 'la cartuccia da 2 KB con l\'impronta nota e\' del modulo scacchi');
  const other2k = CART.slice(); other2k[7] ^= 1;
  ok(L.makeGame('altro.bin', '', 'file', other2k).chess === false, 'un altro file da 2 KB e\' un gioco normale');
  ok(L.makeGame('un_gioco.bin', '', 'file', new Uint8Array(4096).fill(0x42)).chess === false, 'un gioco da 4 KB non e\' del modulo');
  ok(L.isChessCart(CART) && !L.isChessCart(other2k) && L.isChessZ80(Z80) && !L.isChessZ80(other8k) && !L.isChessZ80(new Uint8Array(0)), 'isChessCart / isChessZ80');

  // ---- 2. libreria: file singoli e zip (anche annidato) con i due file
  {
    const lib = new L.Library();
    const r = await lib.addFile('chess.zip', zipStore([{name: 'vp_c7010.bin', data: CART}, {name: 'z80_c7010.bin', data: Z80}]));
    ok(r.games === 1 && r.chessRoms.length === 1 && r.chessRoms[0].data.length === 8192 && r.bios === 0, 'zip con i due file: 1 cartuccia + 1 ROM Z80 (' + JSON.stringify([r.games, r.chessRoms.length, r.bios]) + ')');
    ok(lib.games[0].chess === true, 'e la cartuccia e\' segnata come modulo scacchi');
    const nested = zipStore([{name: 'raccolta/chess.zip', data: zipStore([{name: 'a/z80_c7010.bin', data: Z80}, {name: 'a/vp_c7010.bin', data: CART}])}]);
    const r2 = await new L.Library().addFile('tutto.zip', nested);
    ok(r2.games === 1 && r2.chessRoms.length === 1, 'zip dentro zip: stessi risultati');
    const r3 = await new L.Library().addFile('z80.bin', Z80);
    ok(r3.games === 0 && r3.chessRoms.length === 1, 'file singolo: la ROM Z80 non entra nell\'elenco dei giochi');
    const r4 = await new L.Library().addFile('finta.bin', other8k);
    ok(r4.games === 1 && r4.chessRoms.length === 0, 'file da 8 KB con altro CRC: un gioco');
  }

  // ---- 3. app: avviso se manca la ROM, riavvio a freddo, stato
  const msgs = [];
  const mk = () => new App({onMessage: (t, k) => msgs.push([k, t]), sink: null, fallbackCharset: FALLBACK});
  const runFrames = (app, n) => { let t = 1000, done = 0; while (done < n) { t += 20.1; done += app.step(t); } };
  const results = (app) => Array.from(app.con.xram.subarray(0, EXPECTED.length));
  const app = mk();
  await app.openFiles([f('bios_prova.bin', BIOS), f('chess.zip', zipStore([{name: 'vp_c7010.bin', data: CART}]))]);
  ok(app.lib.bios.length === 1 && app.lib.games.length === 1 && app.lib.games[0].chess, 'BIOS di prova e cartuccia del modulo nell\'elenco');
  ok(app.chessRom === null, 'senza la ROM da 8 KB: nessuna ROM Z80');
  const game = app.lib.games[0];
  msgs.length = 0;
  ok(app.start(game.id) && app.con && app.con.chess === null, 'la cartuccia parte anche senza la ROM Z80, senza modulo');
  ok(msgs.some(([, t]) => /ROM da 8 KB dello Z80/.test(t)), 'avviso chiaro: serve la ROM da 8 KB (' + msgs.map((m) => m[1]).join(' | ') + ')');
  runFrames(app, 30);
  eq(results(app).slice(0, 3), [0xFF, 0xFF, 0xFF], 'senza modulo il bus dei latch resta a 0xFF');

  // aggiungo la ROM mentre gira: riavvio a freddo con il modulo, stesso gioco
  msgs.length = 0;
  await app.openFiles([f('z80_c7010.bin', Z80)]);
  ok(app.chessRom && app.chessRom.length === 8192 && app.chessRomName === 'z80_c7010.bin', 'ROM Z80 messa in uso');
  ok(app.con && app.con.chess && app.gameId === game.id, 'la console e\' ripartita con il modulo e con lo stesso gioco');
  ok(msgs.some(([, t]) => /riparte con il modulo/.test(t)), 'messaggio di riavvio');
  runFrames(app, 70);
  eq(results(app), EXPECTED, 'con il modulo il programma di prova ottiene i risultati attesi');
  // stessa ROM ancora: nessun riavvio
  const con1 = app.con;
  await app.openFiles([f('altra_copia.bin', Z80)]);
  ok(app.con === con1, 'la stessa ROM aggiunta di nuovo non riavvia la console');

  // stato: memorizzo e riprendo (modulo compreso)
  ok(app.memorize(false), 'stato memorizzato');
  const snap = app.states.get(game.id);
  ok(snap.chess && snap.hashes.chess === sha256(Z80), 'lo stato porta il modulo e l\'impronta della sua ROM');
  ok(app.resume(game.id) && app.con.chess, 'ripresa dello stato con il modulo');
  runFrames(app, 5);
  eq(results(app), EXPECTED, 'dopo la ripresa i risultati restano');

  // tolgo la ROM: riparte senza modulo; lo stato col modulo non si riprende
  msgs.length = 0;
  app.clearChessRom();
  ok(app.chessRom === null && app.con && app.con.chess === null, 'ROM tolta: la console riparte senza modulo');
  msgs.length = 0;
  ok(app.resume(game.id) === false && msgs.some(([k, t]) => k === 'bad' && /modulo scacchi/.test(t)), 'lo stato con il modulo non si riprende senza ROM (' + (msgs.length ? msgs[msgs.length - 1][1] : '') + ')');

  // ROM sbagliata: rifiutata senza toccare niente
  msgs.length = 0;
  ok(app.setChessRom('finta.bin', other8k) === false && app.chessRom === null && msgs.some(([k]) => k === 'bad'), 'ROM Z80 con altro CRC-32: rifiutata');

  // ---- 4. sessione (versione 3)
  await app.openFiles([f('z80_c7010.bin', Z80)]);
  app.start(game.id);
  runFrames(app, 40);
  const bytes = app.saveSession('2026-10-17T00:00:00Z');
  const entries = listZip(bytes).map((e) => e.name);
  ok(entries.includes('z80rom.bin'), 'la sessione contiene z80rom.bin');
  const parsed = S.parseSession(bytes);
  ok(parsed.chessRom && sha256(parsed.chessRom) === sha256(Z80), 'parseSession ritrova la ROM Z80');
  const meta = JSON.parse(new TextDecoder().decode(extractEntry(bytes, listZip(bytes).find((e) => e.name === 'sessione.json'))));
  ok(meta.version === 3 && meta.chessRom.size === 8192, 'versione 3 con la voce chessRom');
  const app2 = mk();
  ok(await app2.loadSession(bytes, 's.o2session') && app2.chessRom && app2.con && app2.con.chess, 'sessione aperta: ROM Z80 e modulo ripristinati');
  runFrames(app2, 3);
  eq(results(app2), EXPECTED, 'sessione: la prova continua a riuscire');
  ok(JSON.parse(JSON.stringify(app2.con.saveState())).chess.ram.length === 2048, 'lo stato della sessione ha la RAM del modulo');

  // una sessione senza ROM Z80 resta alla versione 1
  const app3 = mk();
  await app3.openFiles([f('bios_prova.bin', BIOS), f('chess.zip', zipStore([{name: 'vp_c7010.bin', data: CART}]))]);
  const b1 = app3.saveSession('x');
  ok(JSON.parse(new TextDecoder().decode(extractEntry(b1, listZip(b1).find((e) => e.name === 'sessione.json')))).version === 1 && !listZip(b1).some((e) => e.name === 'z80rom.bin'), 'senza ROM Z80 la sessione e\' ancora di versione 1');

  // ---- 5. sessioni false: nessuna ROM del modulo non valida entra
  const rebuild = (mutate) => {
    const list = listZip(bytes);
    const items = list.map((e) => ({name: e.name, data: extractEntry(bytes, e)}));
    const m = JSON.parse(new TextDecoder().decode(items.find((x) => x.name === 'sessione.json').data));
    const out = mutate(items, m) || items;
    out.find((x) => x.name === 'sessione.json').data = new TextEncoder().encode(JSON.stringify(m));
    return zipStore(out);
  };
  const bad = (name, mutate, re) => ok(throws(() => S.parseSession(rebuild(mutate)), re || /./), 'sessione falsa rifiutata: ' + name);
  bad('versione 2 con ROM Z80', (it, m) => { m.version = 2; }, /versione 2/);
  bad('impronta diversa', (it, m) => { m.chessRom.sha = '0'.repeat(64); }, /SHA-256/);
  bad('dimensione diversa', (it, m) => { m.chessRom.size = 4096; }, /voce non valida/);
  bad('file con altro nome', (it, m) => { m.chessRom.file = 'x.bin'; }, /voce non valida/);
  bad('contenuto con altro CRC-32 (impronta coerente)', (it, m) => {
    const d = other8k;
    it.find((x) => x.name === 'z80rom.bin').data = d; m.chessRom.sha = sha256(d);
  }, /non e’ la ROM dello Z80/);
  bad('voce dichiarata ma assente', (it, m) => it.filter((x) => x.name !== 'z80rom.bin'), /manca|incompleto/);
  bad('voce non dichiarata', (it, m) => { delete m.chessRom; }, /non dichiarata/);
  ok(throws(() => S.buildSession({lib: app.lib, activeGameId: null, activeBiosId: null, standard: 'PAL', states: new Map(), charset: null, efCharset: null, chessRom: other8k, settings: {}, created: 'x'}), /ROM dello Z80/), 'buildSession rifiuta una ROM Z80 con altro CRC-32');
  // la partita in corso non si tocca
  const conNow = app.con;
  ok((await app.loadSession(rebuild((it, m) => { m.chessRom.sha = '0'.repeat(64); }), 'falsa.o2session')) === false && app.con === conNow && app.chessRom, 'sessione falsa: la partita in corso e la ROM restano');

  // ---- 6. modulo e G7400: solo G7000 / G7200 (la console lo rifiuta; l'app non lo passa)
  {
    const a = mk();
    await a.openFiles([f('bios_prova.bin', BIOS), f('chess.zip', zipStore([{name: 'vp_c7010.bin', data: CART}, {name: 'z80_c7010.bin', data: Z80}]))]);
    ok(a.chessRom && a.lib.games[0].chess, 'zip unico con i due file: abbinati');
    ok(a.start(a.lib.games[0].id) && a.con.chess, 'si avvia col modulo');
    msgs.length = 0;
    a.setStandard('NTSC');
    ok(a.con && a.con.chess && msgs.some(([, t]) => /solo in Europa/.test(t)), 'in NTSC il modulo c\'e\' e c\'e\' l\'avviso (PAL)');
  }

  console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ECCEZIONE', e && e.stack || e); process.exit(1); });
