'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_g7400.js [DUMPS] - tappa 5, Videopac+ G7400: decodifica del MOVX verso l'EF9341 (P1 bit 5), mappe delle cartucce da 12 / 16 KB
// ('rally': latch del banco con MOVX), mixer e CX nella console, stato di versione 3 (andata e ritorno, ripresa deterministica, rifiuto
// di stati falsi o di un'altra macchina), regista (BIOS G7400, set EF9341 come ingresso, pin B, sessione). Le prime parti usano dati
// sintetici; la parte del regista usa i dump veri (in locale) se si passa DUMPS (bios/g7400.bin e carts/vp_killer_bees.bin).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {Console, SnapshotError} = require(process.env.O2_CONSOLE_PATH || SP('console.js'));
const {analyzeCart, cartOffset, layoutCart} = require(SP('cartmap.js'));
const {App} = require(SP('app.js'));
const {EfPair} = require(process.env.O2_EF_PATH || SP('ef934x.js'));
const S = require(SP('session.js'));
const {classify, EF_CHARSET_SIZE} = require(SP('library.js'));
const {zipStore} = require(SP('zipstore.js'));
const charsetOwn = require('../hw/charset_own.js');
const efOwn = require('../hw/charset9341_own.js');
const OWN = () => new Uint8Array(charsetOwn.build());
const EFROM = () => new Uint8Array(efOwn.build());

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };
const throws = (f, re, m) => { let e = null; try { f(); } catch (x) { e = x; } ok(!!e && (!re || (typeof re === 'function' ? re(e) : re.test(e.message))), m + (e ? ' (' + e.message + ')' : ' (non ha lanciato)')); };
const json = (x) => JSON.stringify(x);

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function synth(seed, cartKb) {
  const r = rng(seed), bios = new Uint8Array(1024), cart = new Uint8Array(cartKb * 1024);
  for (let i = 0; i < bios.length; i++) bios[i] = (r() * 256) | 0;
  for (let i = 0; i < cart.length; i++) cart[i] = (r() * 256) | 0;
  return {bios, cart};
}
const mk = (o) => new Console(Object.assign({bios: synth(1, 2).bios, cart: null, charset: OWN(), standard: 'PAL'}, o));
const g74 = (o) => mk(Object.assign({g7400: true, efRom: EFROM()}, o || {}));

// ------------------------------------------------------------------------------------------------ 1. costruzione e decodifica MOVX
{
  throws(() => mk({g7400: true}), /EF9341/, 'G7400 senza set EF9341: rifiutato');
  throws(() => mk({g7400: true, efRom: new Uint8Array(2559)}), /EF9341/, 'G7400 con set EF9341 di 2559 byte: rifiutato');
  const g = mk();
  ok(g.g7400 === false && g.ef === null, 'G7000: niente EF');
  g.cpu.p1 = 0xDF; g.movxWrite(2, 0x49); g.movxWrite(3, 0xA0);              // su un G7000 l'accesso con P1 bit 5 = 0 non fa niente
  ok(g.saveState().g7400 === undefined, 'G7000: lo stato non porta campi G7400');
  const c = g74();
  c.cpu.p1 = 0xDF;                                                       // solo l'EF9341 selezionato (RAM, video, tastiera spenti)
  c.movxWrite(2, 0x49); c.movxWrite(3, 0xA0);
  ok(c.ef.r === 0x49, 'MOVX 2/3 con P1 bit 5 = 0: R caricato (0x49)');
  c.cpu.p1 = 0xFF;
  c.movxWrite(2, 0x00); c.movxWrite(3, 0xA0);
  ok(c.ef.r === 0x49, 'MOVX con P1 bit 5 = 1: l\'EF9341 non risponde');
  c.cpu.p1 = 0xDF;
  c.movxWrite(0, 0x07); c.movxWrite(1, 0x41);                              // dato: TA, TB (modo M = 0: scrive e incrementa)
  ok(c.ef.ramA[0] === 0x07 && c.ef.ramB[0] === 0x41 && c.ef.x === 1, 'dato in cella 0 e cursore avanti');
  c.movxWrite(2, 0x00); c.movxWrite(3, 0x00);                              // inizio riga: X = 0, Y = TA
  ok(c.movxRead(0x06) === 0x00, 'stato (lettura comando TA, P1 bit 5 = 0): occupato = 0');
  c.movxWrite(2, 0x00); c.movxWrite(3, 0x00);                              // inizio riga di nuovo
  c.movxWrite(2, 0x20); c.movxWrite(3, 0x80);                              // M = 0x20 (leggi e incrementa)
  const x1 = c.movxRead(5);                                               // TB: ritorna il TB precedente (0x80 del comando), poi carica la cella
  const ta = c.movxRead(4), tb = c.movxRead(5);
  ok(ta === 0x07 && x1 === 0x80 && tb === 0x41, 'lettura di cella: TA = attributo, TB (letto dopo) = codice (' + [ta, x1, tb] + ')');
  // la RAM esterna e il chip video leggono 0xFF quando non sono selezionati: l'EF9341 non sporca gli altri accessi
  c.cpu.p1 = 0xFF;
  ok(c.movxRead(5) === 0xFF, 'con P1 = 0xFF nessun chip risponde: 0xFF');
}

// ------------------------------------------------------------------------------------------------ 2. mappe delle cartucce
{
  const mkCart = (kb) => { const c = new Uint8Array(kb * 1024); for (let i = 0; i < c.length; i++) c[i] = ((i >> 11) * 16 + ((i >> 3) & 15) + (i & 7)) & 0xFF; return c; };
  const info = (n) => { const b = new Uint8Array(n * 0x800).fill(0xFF); return analyzeCart(layoutCart(b)); };
  ok(info(1).kind === 'std' && info(2).kind === 'std' && info(4).kind === 'std', 'cartmap: 2, 4, 8 KB restano std');
  ok(info(8).kind === 'rally' && info(8).ok && info(6).kind === 'rally' && info(6).ok, 'cartmap: 16 KB e 12 KB sono rally');
  ok(!info(5).ok && !info(7).ok && !info(9).ok && !info(10).ok && info(5).kind === 'big', 'cartmap: 10, 14, 18, 20 KB non supportate');
  ok(layoutCart(new Uint8Array(0x3000).fill(1)).length === 0x4000 && layoutCart(new Uint8Array(0x2000)).length === 0x2000, 'layoutCart: solo i 12 KB si allargano a 16 KB');
  const f16 = mkCart(16);
  const c16 = g74({cart: f16});
  ok(c16.cartInfo.kind === 'rally' && c16.cart.length === 0x4000, 'console: 16 KB = rally');
  const rd = (p1, a) => { c16.cpu.p1 = p1; return c16.readProg(a); };
  ok(rd(0xFF, 0x400) === f16[7 * 0x800] && rd(0xFF, 0xBFF) === f16[7 * 0x800 + 0x7FF], 'rally: P1 bit 0 = 1 -> ultimo banco (7)');
  ok(rd(0xFE, 0x400) === f16[0] && rd(0xFE, 0x800) === f16[0x400], 'rally: P1 bit 0 = 0, latch a 0 -> banco 0 (all\'inizio)');
  ok(rd(0xFE, 0xC00) === f16[0x400] && rd(0xFE, 0xFFF) === f16[0x7FF], 'rally: 0xC00-0xFFF specchio di 0x800-0xBFF');
  c16.cpu.p1 = 0xEE;                                                      // bit 4 = 0 (RAM abilitata), bit 3 = 1, bit 0 = 0
  c16.movxWrite(0x80, 3);
  ok(c16.cartBank === 3 && rd(0xEE, 0x400) === f16[3 * 0x800], 'rally: MOVX con A7 = 1 e P1 bit 4 = 0 carica il latch (banco 3)');
  c16.movxWrite(0x7F, 5);                                                 // A7 = 0: e' la RAM, non il latch
  ok(c16.cartBank === 3, 'rally: A7 = 0 non tocca il latch');
  c16.cpu.p1 = 0xFE;                                                      // bit 4 = 1: RAM disabilitata
  c16.movxWrite(0x80, 6);
  ok(c16.cartBank === 3, 'rally: P1 bit 4 = 1 non tocca il latch');
  c16.cpu.p1 = 0xEE; c16.movxWrite(0x90, 0x0D);
  ok(c16.cartBank === 5 && rd(0xEE, 0x400) === f16[5 * 0x800], 'rally: il dato si limita a 3 bit (0x0D -> 5)');
  c16.cpu.p1 = 0xE4; c16.movxWrite(0xA0, 8);                              // P1 bit 4 = 0 e bit 3 = 0: scrittura del registro 0xA0 del chip video (Neutron Star), NON un cambio di banco
  ok(c16.cartBank === 5, 'rally: P1 bit 3 = 0 (chip video selezionato) non tocca il latch');
  c16.reset();
  ok(c16.cartBank === 0, 'reset: latch a 0');
  const f12 = mkCart(12);
  const c12 = g74({cart: f12});
  ok(c12.cartInfo.kind === 'rally' && c12.cart.length === 0x4000, 'console: 12 KB = rally (parte alta di 16 KB)');
  const r12 = (p1, a) => { c12.cpu.p1 = p1; return c12.readProg(a); };
  ok(r12(0xFF, 0x400) === f12[0x2800] && r12(0xFF, 0xBFF) === f12[0x2FFF], 'rally 12 KB: l\'ultimo banco e\' l\'ultimo 2 KB del file');
  ok(r12(0xFE, 0x400) === 0xFF && r12(0xFE, 0xBFF) === 0xFF, 'rally 12 KB: banchi 0 e 1 vuoti (0xFF)');
  c12.cpu.p1 = 0xEE; c12.movxWrite(0x80, 2);
  ok(r12(0xEE, 0x400) === f12[0] && r12(0xEE, 0x7FF) === f12[0x3FF], 'rally 12 KB: banco 2 = inizio del file');
  ok(g74({cart: mkCart(8)}).cartInfo.kind === 'std' && g74({cart: mkCart(10)}).cartInfo.ok === false, 'console: 8 KB std, 10 KB non supportata');
}

// ------------------------------------------------------------------------------------------------ 3. mixer
{
  const c = g74();
  const e = c.cpu.exp;
  const row = (v) => new Uint8Array(360 * 243).fill(v);
  const cm = new Uint16Array(360);
  // EF spento (R = 0): nessun pixel EF; mix8245 = 0xFF: vince sempre l'8245 (senza LUM: P1 bit 7 = 1)
  e.set([15, 15, 15, 15]); c.cpu.p1 = 0xFF;
  let fb = row(3);
  let r = c.mixRow(10, fb, cm);
  ok(fb[10 * 360 + 5] === 3 && r === 0, 'mixer: mix8245 = 0xFF, EF spento: l\'8245 resta com\'e\'');
  c.cpu.p1 = 0x7F;                                                       // LUM (P1 bit 7 = 0)
  fb = row(3); c.mixRow(10, fb, cm);
  ok(fb[10 * 360 + 5] === 11, 'mixer: P1 bit 7 = 0 aggiunge la luminosita\' (3 -> 11)');
  e.set([0, 0, 0, 0]); c.cpu.p1 = 0xFF;                                  // niente 8245; mixEF = 0: CX attivo ovunque (i2 = 1)
  fb = row(3); r = c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 8, 'mixer: mix8245 = 0, EF spento, mixEF = 0 -> uscita 8 (colore 0, i2 = 1)');
  e.set([15, 15, 0, 0]);
  fb = row(3); c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 0, 'mixer: mixEF = 0xFF -> i2 = 0: uscita 0');
  // ordine dei nibble (asimmetrico: i valori scritti dal gioco Trans American Rally, P4 = 8, P5 = 5, P6 = 15, P7 = 7):
  //   mix8245 = P7 | P6 << 4 = 0xF7 (solo il colore 3, il giallo, non vince), mixEF = P5 | P4 << 4 = 0x85 (colori 0, 2, 7 senza luminosita')
  e.set([0, 0, 15, 7]);
  fb = row(3); c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 8, 'mixer: mix8245 = P7 | P6 << 4 = 0xF7: il colore 3 dell\'8245 non vince (esce l\'EF: colore 0 con i2 = 1)');
  fb = row(7); c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 7, 'mixer: mix8245 = 0xF7: il colore 7 dell\'8245 vince');
  fb = row(0); c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 0, 'mixer: mix8245 = 0xF7: il colore 0 dell\'8245 vince');
  e.set([8, 5, 0, 0]);
  fb = row(3); c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 0, 'mixer: mixEF = P5 | P4 << 4 = 0x85: il colore EF 0 ha il bit acceso, i2 = 0, uscita 0');
  e.set([5, 8, 0, 0]);
  fb = row(3); c.mixRow(20, fb, cm);
  ok(fb[20 * 360 + 5] === 8, 'mixer: mixEF = 0x58 (nibble scambiati): il colore EF 0 ha il bit spento, i2 = 1, uscita 8');
  // CX: con i2 = 1 e un oggetto nella mappa delle collisioni, il bit 6 si accende se la maschera 0xA2 lo permette
  e.set([0, 0, 0, 0]);
  const cmap = new Uint16Array(360); cmap[40] = 0x02;
  c.vdc.reg[0xA2] = 0x40;
  fb = row(3); r = c.mixRow(30, fb, cmap);
  ok((r & 0x100) !== 0 && (r & 0x40) !== 0 && (r & 0x02) !== 0, 'CX: contatto con un oggetto: bit 6 e bit dell\'oggetto, richiesta di interrupt');
  c.vdc.reg[0xA2] = 0x00;
  fb = row(3); r = c.mixRow(30, fb, cmap);
  ok(r === 0, 'CX: maschera 0xA2 bit 6 spento: niente collisione');
  // frameTick a riga 0, linea EF a riga >= 5
  const c2 = g74();
  c2.ef.r = 0x49 | 0x80; c2.ef.ramA[0] = 0; c2.ef.ramB[0] = 0x41;
  const ph = c2.ef.flPrescaler;
  c2.mixRow(0, row(0), cm);
  ok(c2.ef.flPrescaler === ph + 1, 'frameTick a ogni riga 0');
}

// ------------------------------------------------------------------------------------------------ 3b. punti confermati dal datasheet Thomson
{
  const mkEf = () => new EfPair(EFROM());
  const cmd = (e, op, ta) => { e.access(2, ta, true); e.access(3, op << 5, true); };
  const put = (e, a, b) => { e.access(0, a, true); e.access(1, b, true); };
  // fetta scritta: il dato e' TA (bus A), non TB; la cella e' quella del cursore; la fetta avanza (mod 10), il cursore resta
  const e = mkEf();
  cmd(e, 4, 0x00); put(e, 0x07, 0xA5);                                   // cella 0: attributo 7, codice 0xA5 (memoria estesa)
  cmd(e, 1, 0); cmd(e, 2, 0);                                            // cursore sulla cella 0
  cmd(e, 4, 0x80 | 9);                                                   // scrivi fetta 9
  put(e, 0x3C, 0xEE);
  ok(e.exram[require(SP('ef934x.js')).exIndex(0x07, 0xA5, 9)] === 0x3C, 'datasheet: la fetta scritta e\' il contenuto di TA');
  ok((e.m & 0x0F) === 0 && e.x === 0 && e.y === 0, 'datasheet: dopo la fetta 9 NT torna a 0 e il cursore non si muove');
  // fetta letta: va in TA
  cmd(e, 4, 0xA0 | 9); e.access(5, 0, false);
  ok(e.ta === 0x3C, 'datasheet: la fetta letta finisce in TA');
  // Y0: solo i bit 0-4 sono la riga, il bit 5 e' lo zoom (20 linee per riga, fetta = linea/2)
  const CA = require(SP('ef934x.js')).cellAddr;
  const fill = (ef, rr, code) => { for (let x = 0; x < 40; x++) { ef.ramA[CA(x, rr)] = 7; ef.ramB[CA(x, rr)] = code; } };
  const e2 = mkEf(); e2.r = 0x49; cmd(e2, 6, 0x20 | 3); fill(e2, 3, 0x41); fill(e2, 4, 0x42);
  const e3 = mkEf(); e3.r = 0x49; cmd(e3, 6, 3); fill(e3, 3, 0x41); fill(e3, 4, 0x42);
  let zoomOk = true, distinct = new Set();
  for (let sl = 0; sl < 10; sl++) {
    const z0 = new Uint8Array(320), z1 = new Uint8Array(320), n = new Uint8Array(320);
    e2.renderLine(10 + 2 * sl, z0); e2.renderLine(11 + 2 * sl, z1); e3.renderLine(10 + sl, n);
    if (!z0.every((v, i) => v === z1[i] && v === n[i])) zoomOk = false;
    distinct.add(n.join());
  }
  ok(zoomOk && distinct.size > 3, 'datasheet: zoom, ogni fetta della riga 3 occupa 2 linee (e Y0 bit 5 non sposta la riga)');
  const n1 = new Uint8Array(320), n2 = new Uint8Array(320);
  e3.renderLine(20, n1); e2.renderLine(30, n2);
  ok(n1.every((v, i) => v === n2[i]), 'datasheet: la riga 4 inizia alla linea 20 senza zoom e alla linea 30 con lo zoom');
  // riga di servizio sempre semplice anche con lo zoom
  const sv = new Uint8Array(320); e2.r = 0x49 | 8; e2.renderLine(5, sv);
  ok(sv.every((v) => v === 8), 'datasheet: riga di servizio (vuota) semplice anche con lo zoom');
  // boxing: R bit 1 = 1, finestre fuori zona trasparenti (0), dentro la zona normali; I (bit 3) = 1 solo in zona
  const e4 = mkEf(); e4.r = 0x4B;
  for (let x = 0; x < 40; x++) { e4.ramA[CA(x, 0)] = 0x07; e4.ramB[CA(x, 0)] = 0x20; }
  e4.ramB[CA(5, 0)] = 0x82; e4.ramA[CA(5, 0)] = 0x07;                   // delimitatore che apre la zona (bit 1)
  e4.ramB[CA(9, 0)] = 0x80; e4.ramA[CA(9, 0)] = 0x07;                   // delimitatore che la chiude
  const o4 = new Uint8Array(320); e4.renderLine(10, o4);
  ok(o4.slice(0, 40).every((v) => v === 0), 'datasheet: boxing, finestre prima della zona trasparenti (I = 0, nero)');
  ok(o4.slice(40, 44).every((v) => v === 0) && o4.slice(44, 48).every((v) => (v & 8) !== 0), 'datasheet: delimitatore di apertura, meta\' sinistra trasparente');
  ok(o4.slice(48, 72).every((v) => (v & 8) !== 0), 'datasheet: finestre in zona con I = 1');
  ok(o4.slice(72, 76).every((v) => (v & 8) !== 0) && o4.slice(76, 80).every((v) => v === 0) && o4.slice(80).every((v) => v === 0), 'datasheet: chiusura della zona, poi di nuovo trasparente');
  // senza boxing (R bit 1 = 0) tutto resta visibile con I = 1
  e4.r = 0x49; e4.renderLine(10, o4);
  ok(o4.every((v) => (v & 8) !== 0), 'datasheet: con R bit 1 = 0 I resta alto in tutta la linea attiva');
}

// ------------------------------------------------------------------------------------------------ 4. stato (versione 3)
{
  const {bios, cart} = synth(7, 8);
  const mkc = (o) => new Console(Object.assign({bios, cart, charset: OWN(), standard: 'PAL', g7400: true, efRom: EFROM(), cartBHigh: true}, o));
  const c = mkc();
  for (let i = 0; i < 20; i++) c.runFrame();
  // metto qualcosa di sicuro nell'EF
  c.cpu.p1 = 0xDF; c.movxWrite(2, 0x49); c.movxWrite(3, 0xA0); c.movxWrite(0, 0x07); c.movxWrite(1, 0x41);
  const st = JSON.parse(json(c.saveState()));
  ok(st.version === 4 && st.g7400 === true && st.pinB === 1 && !!st.ef && !!st.hashes.efrom, 'stato: versione 4 con g7400, pinB, ef e impronta del set EF');
  ok(json(c.saveState()) === json(st), 'stato: saveState non modifica niente');
  const d = mkc();
  const w = d.loadState(st);
  ok(w.length === 0 && json(d.saveState()) === json(st), 'stato: andata e ritorno identici');
  for (let i = 0; i < 12; i++) { c.runFrame(); d.runFrame(); }
  ok(zlib.crc32(c.fb) === zlib.crc32(d.fb) && json(c.saveState()) === json(d.saveState()), 'stato: ripresa deterministica (12 fotogrammi)');
  const diff = mkc({efRom: new Uint8Array(2560).fill(1), cartBHigh: false});
  const w2 = diff.loadState(st);
  ok(w2.length === 2 && /EF9341/.test(w2[0]) && /pin B/.test(w2[1]), 'stato: avvisa se cambiano set EF e pin B (' + w2.length + ')');
  // pin B basso: lo stato lo ricorda (0), ricaricarlo con il pin basso non avvisa, con il pin alto si
  const lo = mkc({cartBHigh: false});
  for (let i = 0; i < 3; i++) lo.runFrame();
  const stLo = JSON.parse(json(lo.saveState()));
  ok(stLo.pinB === 0, 'stato: pin B basso salvato come 0');
  ok(mkc({cartBHigh: false}).loadState(stLo).length === 0, 'stato con pin B basso in una console con pin basso: nessun avviso');
  const wLo = mkc({cartBHigh: true}).loadState(stLo);
  ok(wLo.length === 1 && /pin B/.test(wLo[0]), 'stato con pin B basso in una console con pin alto: avviso');
  // un G7000 rifiuta uno stato G7400 e viceversa
  const g0 = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  throws(() => g0.loadState(st), (e) => true, 'stato G7400 in un G7000: rifiutato');
  try { g0.loadState(st); } catch (e) { ok(e instanceof SnapshotError && /G7400/.test(e.message), 'stato G7400 in un G7000: messaggio chiaro'); }
  const st0 = g0.saveState();
  try { mkc().loadState(st0); ok(false, 'stato G7000 in un G7400: rifiutato'); } catch (e) { ok(e instanceof SnapshotError && /non di un G7400/.test(e.message), 'stato G7000 in un G7400: rifiutato'); }
  for (const v of [1, 0, null, 'no', {}]) {
    const bs = JSON.parse(json(st0)); bs.g7400 = v;
    let t = false; try { g0.loadState(bs); } catch (e) { t = e instanceof SnapshotError && /tipo di macchina/.test(e.message); }
    ok(t, 'stato di un G7000 con g7400 = ' + json(v) + ': rifiutato (tipo di macchina)');
  }
  { const bs = JSON.parse(json(st0)); bs.g7400 = false; ok(g0.loadState(bs).length === 0, 'stato di un G7000 con g7400 = false: si carica'); }
  // stato di versione 2 (senza campi G7400) in un G7000: si carica ancora
  const old = JSON.parse(json(st0)); old.version = 2;
  ok(g0.loadState(old).length === 0, 'stato di versione 2 in un G7000: si carica');
  // stati falsi o corrotti: rifiutati senza toccare la console
  const before = json(d.saveState());
  const mut = (f) => { const s = JSON.parse(json(st)); f(s); return s; };
  const bad = [
    ['ef mancante', mut((s) => { delete s.ef; })], ['ef non oggetto', mut((s) => { s.ef = 5; })], ['ramA corta', mut((s) => { s.ef.ramA = s.ef.ramA.slice(2); })],
    ['R fuori campo', mut((s) => { s.ef.r = 256; })], ['X fuori campo', mut((s) => { s.ef.x = 64; })], ['pinB non valido', mut((s) => { s.pinB = 5; })],
    ['g7400 stringa', mut((s) => { s.g7400 = 'si'; })], ['g7400 numero', mut((s) => { s.g7400 = 1; })], ['g7400 nullo', mut((s) => { s.g7400 = null; })], ['versione 9', mut((s) => { s.version = 9; })], ['exram non esadecimale', mut((s) => { s.ef.exram = 'zz' + s.ef.exram.slice(2); })],
  ];
  for (const [n, s] of bad) {
    let t = false; try { d.loadState(s); } catch (e) { t = e instanceof SnapshotError; }
    ok(t, 'stato falso rifiutato: ' + n);
    ok(json(d.saveState()) === before, 'stato falso (' + n + '): la console non e\' stata toccata');
  }
}

// ------------------------------------------------------------------------------------------------ 5. biblioteca e regista con i dump
{
  const efBytes = new Uint8Array(EF_CHARSET_SIZE).fill(7);
  const k = classify('efchar.bin', '', efBytes);
  ok(k.kind === 'charset' && k.chip === 'ef', 'libreria: 2560 byte = set EF9341');
  ok(classify('c.bin', '', new Uint8Array(512).fill(3)).chip === 'vdc', 'libreria: 512 byte = set del chip video');
  const dumps = process.argv[2] || process.env.O2_DUMPS;
  if (dumps && fs.existsSync(path.join(dumps, 'bios', 'g7400.bin'))) {
    const rd = (p) => new Uint8Array(fs.readFileSync(path.join(dumps, p)));
    const logs = [];
    const mkApp = (o) => new App(Object.assign({fallbackCharset: OWN(), fallbackEfCharset: EFROM(), onMessage: (t, k2) => logs.push((k2 || '-') + ': ' + t)}, o || {}));
    (async () => {
      const app = mkApp();
      await app.addFiles([{name: 'g7400.bin', bytes: rd('bios/g7400.bin')}, {name: 'vp_killer_bees.bin', bytes: rd('carts/vp_killer_bees.bin')}]);
      ok(app.bios && app.bios.supported && app.isG7400, 'regista: il BIOS G7400 e\' utilizzabile');
      ok(app.start(app.lib.games[0].id) && app.con.g7400 && app.con.ef !== null, 'regista: parte con la console G7400');
      ok(app.con.cartBHigh === false, 'regista: pin B automatico, gioco senza «Videopac+» nella cartella e da 8 KB: basso');
      app.lib.games[0].platform = 'Philips Videopac+';
      ok(app.pinBFor(app.lib.games[0]) === true, 'regista: pin B automatico, raccolta Videopac+: alto');
      ok(app.setPinB('low') && app.con.cartBHigh === false && logs.some((l) => /Pin B/.test(l)), 'regista: pin B basso: la console riparte');
      ok(app.setPinB('high') && app.con.cartBHigh === true, 'regista: pin B alto');
      ok(!app.setPinB('boh') && app.settings.pinB === 'high', 'regista: pin B non valido rifiutato');
      ok(logs.some((l) => /ROM dei caratteri GPL dell’EF9341/.test(l)), 'regista: avverte che il set EF9341 e\' quello GPL incluso');
      // set EF9341 dell'utente
      ok(!app.setEfCharset('x.bin', new Uint8Array(100)), 'regista: set EF9341 di 100 byte rifiutato');
      const mine = new Uint8Array(2560); for (let i = 0; i < mine.length; i++) mine[i] = (i * 7) & 255;
      ok(app.setEfCharset('mio.bin', mine) && app.efCharsetName === 'mio.bin' && app.con.hashes.efrom === app.efCharsetSha, 'regista: set EF9341 dell\'utente: la console riparte con quello');
      for (let i = 0; i < 30; i++) app.con.runFrame();
      // sessione: andata e ritorno con set EF e pin B
      const sess = app.saveSession('2026-10-15T00:00:00Z');
      const p = S.parseSession(sess);
      ok(p.efCharset && p.efCharset.length === 2560 && p.settings.pinB === 'high', 'sessione: set EF9341 e pin B nel file');
      const app2 = mkApp();
      ok(await app2.loadSession(sess, 's.zip') && app2.efCharsetSha === app.efCharsetSha && app2.settings.pinB === 'high' && app2.con && app2.con.g7400, 'sessione: riaperta (G7400, set EF9341, pin B)');
      // sessione senza set EF: versione 1
      app.clearEfCharset();
      const sess1 = app.saveSession('2026-10-15T00:00:00Z');
      ok(S.parseSession(sess1).efCharset === null, 'sessione: senza set EF niente efcharset.bin');
      // sessione falsa: set EF in una sessione di versione 1
      const forged = (() => {
        const ents = [];
        const {listZip, extractEntry} = require(SP('unzip.js'));
        for (const e of listZip(sess)) { if (e.dir) continue; let data = extractEntry(sess, e); if (e.name === 'sessione.json') { const m = JSON.parse(new TextDecoder().decode(data)); m.version = 1; data = new TextEncoder().encode(JSON.stringify(m)); } ents.push({name: e.name, data}); }
        return zipStore(ents);
      })();
      throws(() => S.parseSession(forged), /versione 1/, 'sessione: set EF in una sessione di versione 1 rifiutato');
      // stato su file e ripresa nel G7400
      app.setEfCharset('mio.bin', mine);
      for (let i = 0; i < 20; i++) app.con.runFrame();
      app.memorize(false);
      ok(app.resume(app.gameId) && app.con.g7400, 'regista: ripresa dello stato G7400');
      // Trans American Rally (16 KB, dump dell'utente): dopo il tasto compare la mappa degli Stati Uniti disegnata dall'EF9341. Con i nibble dei registri
      // di mix nell'ordine sbagliato (P4 basso, P5 alto) l'8245 copriva tutto con il suo giallo di fondo e l'EF non si vedeva (difetto del 15/10/2026)
      if (fs.existsSync(path.join(dumps, 'carts', 'vp_trans_american_rally_16k.bin'))) {
        const ar = mkApp();
        await ar.addFiles([{name: 'g7400.bin', bytes: rd('bios/g7400.bin')}, {name: 'rally.bin', bytes: rd('carts/vp_trans_american_rally_16k.bin')}]);
        ok(ar.start(ar.lib.games[0].id) && ar.con.g7400, 'rally: parte con la console G7400');
        for (let i = 0; i < 400; i++) { if (i === 100) ar.con.keyRows.fill(0x01); if (i === 106) ar.con.keyRows.fill(0); ar.con.runFrame(); }
        const hist = new Array(16).fill(0), fbr = ar.con.fb;
        for (let i = 0; i < fbr.length; i++) hist[fbr[i] & 15]++;
        const used = hist.filter((n) => n > 500).length;
        ok(ar.con.cpu.exp[0] === 1 && ar.con.cpu.exp[1] === 5 && ar.con.cpu.exp[2] === 15 && ar.con.cpu.exp[3] === 7, 'rally: il gioco scrive i latch dell\'8243 P4..P7 = 1, 5, 15, 7 (mix8245 = 0xF7, mixEF = 0x15)');
        ok(hist[3] < 0.05 * fbr.length && used >= 4, 'rally: la mappa dell\'EF9341 si vede: il giallo di fondo dell\'8245 e\' meno del 5% dei punti e i colori in uso sono almeno 4 (' + used + ', giallo ' + (100 * hist[3] / fbr.length).toFixed(1) + '%)');
      }
      // Neutron Star (12 KB): scrive il registro 0xA0 del chip video con P1 bit 4 = 0: se contava come cambio di banco il gioco finiva nel banco 0
      // (vuoto, 0xFF) e lo schermo restava nero (difetto del 15/10/2026)
      if (fs.existsSync(path.join(dumps, 'carts', 'vp_neutron_star_12k.bin'))) {
        const an = mkApp();
        await an.addFiles([{name: 'g7400.bin', bytes: rd('bios/g7400.bin')}, {name: 'ns.bin', bytes: rd('carts/vp_neutron_star_12k.bin')}]);
        ok(an.start(an.lib.games[0].id) && an.con.g7400, 'neutron star: parte con la console G7400');
        for (let i = 0; i < 400; i++) { if (i === 100) an.con.keyRows.fill(0x01); if (i === 106) an.con.keyRows.fill(0); an.con.runFrame(); }
        const hn = new Array(16).fill(0), fbn = an.con.fb;
        for (let i = 0; i < fbn.length; i++) hn[fbn[i] & 15]++;
        const usedn = hn.filter((n) => n > 500).length;
        ok(an.con.cartBank === 5, 'neutron star: il banco finale e\' il 5 (non il 0 per la scrittura 0xA0 del chip video): ' + an.con.cartBank);
        ok(hn[0] < 0.9 * fbn.length && usedn >= 4, 'neutron star: lo schermo non e\' nero: nero ' + (100 * hn[0] / fbn.length).toFixed(1) + '%, colori in uso ' + usedn);
      }
      // senza set di ripiego e senza set dell'utente: avvio impossibile con messaggio chiaro
      const app3 = mkApp({fallbackEfCharset: null});
      await app3.addFiles([{name: 'g7400.bin', bytes: rd('bios/g7400.bin')}, {name: 'vp_killer_bees.bin', bytes: rd('carts/vp_killer_bees.bin')}]);
      logs.length = 0;
      ok(!app3.start(app3.lib.games[0].id) && logs.some((l) => /EF9341/.test(l)), 'regista: senza set EF9341 l\'avvio G7400 dice cosa manca');
      // set EF9341 aggiunto insieme ai file (per dimensione)
      await app3.addFiles([{name: 'ef.bin', bytes: mine}]);
      ok(app3.efCharset && app3.start(app3.lib.games[0].id), 'regista: il set EF9341 si riconosce dalla dimensione e il G7400 parte');
      end();
    })().catch((e) => { console.log('ECCEZIONE: ' + (e.stack || e)); process.exit(1); });
  } else end();
}
function end() {
  console.log(fails ? 'FALLITO: ' + fails + ' controlli su ' + checks : 'OK: ' + checks + ' controlli (G7400: MOVX, mappe 12/16 KB, mixer, stato v3, regista)');
  process.exit(fails ? 1 : 0);
}
