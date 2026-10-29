'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_misc.js - prove puntuali dei pezzi della console che i confronti con il modello coprono solo di riflesso: SHA-256 contro
// Node crypto, riconoscimento e mappa delle cartucce (cartmap.js), lettura del programma, regole di selezione di MOVX
// (RAM / chip video / ROM dati della cartuccia 'linear'), tastiera e joystick.
const path = require('path');
const crypto = require('crypto');
const S = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {sha256} = require(S('sha256.js'));
const {analyzeCart, cartOffset, isJmpVec, layoutCart} = require(S('cartmap.js'));
const {Console, keyCode} = require(S('console.js'));
const charsetOwn = require('../hw/charset_own.js');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL  ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (ottenuto ' + JSON.stringify(a) + ', atteso ' + JSON.stringify(b) + ')');
const OWN = () => new Uint8Array(charsetOwn.build());
function rnd(seed, n) { let s = seed >>> 0; const o = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; o[i] = s >>> 24; } return o; }

// 1. SHA-256
for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 1024, 4096, 16384]) {
  const b = rnd(n + 7, n);
  eq(sha256(b), crypto.createHash('sha256').update(b).digest('hex'), 'sha256 di ' + n + ' byte');
}
eq(sha256(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256 del vuoto');

// 2. riconoscimento delle cartucce
const pad = (n, fill) => new Uint8Array(n).fill(fill === undefined ? 0xFF : fill);
const withVec = (n, off) => { const b = pad(n, 0x00); b[off] = 0x04; b[off + 2] = 0x44; return b; };      // 04 xx 44: due JMP
eq(analyzeCart(null), {kind: 'none', banks: 0, mask: 0, ok: true, reason: ''}, 'nessuna cartuccia');
eq(analyzeCart(new Uint8Array(0)), {kind: 'none', banks: 0, mask: 0, ok: true, reason: ''}, 'cartuccia vuota');
eq(analyzeCart(pad(2048)), {kind: 'std', banks: 1, mask: 0, ok: true, reason: ''}, '2 KB');
eq(analyzeCart(pad(4096)), {kind: 'std', banks: 2, mask: 1, ok: true, reason: ''}, '4 KB');
eq(analyzeCart(pad(6144)), {kind: 'std', banks: 3, mask: 3, ok: true, reason: ''}, '6 KB (3 banchi)');
eq(analyzeCart(pad(8192)), {kind: 'std', banks: 4, mask: 3, ok: true, reason: ''}, '8 KB');
eq(analyzeCart(withVec(4096, 0x400)), {kind: 'linear', banks: 2, mask: 0, ok: true, reason: ''}, '4 KB con i vettori a 0x400: lineare');
eq(analyzeCart(pad(2049)).banks, 2, '2049 byte = 2 banchi');
eq(analyzeCart(pad(4097)), {kind: 'std', banks: 3, mask: 3, ok: true, reason: ''}, '4097 byte = 3 banchi');
eq(analyzeCart(pad(8193)).kind, 'big', '8193 byte = 5 banchi: non supportata');
eq(analyzeCart(withVec(4096, 0x800)).kind, 'std', '4 KB con i vettori a 0x800: a banchi');
{ const b = withVec(4096, 0x400); b[0x800] = 0x04; b[0x802] = 0x44; eq(analyzeCart(b).kind, 'std', '4 KB con i vettori in entrambi i punti: a banchi'); }
{ const b = withVec(4096, 0x400); b[0x400] = 0x05; eq(analyzeCart(b).kind, 'std', '4 KB con un solo JMP nel vettore: a banchi'); }
{ const b = withVec(4096, 0x400); b[0x402] = 0x05; eq(analyzeCart(b).kind, 'std', '4 KB con il secondo JMP sbagliato: a banchi'); }
{ const b = withVec(8192, 0x400); eq(analyzeCart(b).kind, 'std', '8 KB non e\' mai lineare'); }
for (const n of [10240, 12288, 14336, 18432, 32768]) {          // 12 KB senza layoutCart (6 banchi) e' ancora 'big'; la console lo dispone prima
  const a = analyzeCart(pad(n));
  ok(a.kind === 'big' && a.ok === false && a.mask === 3 && a.banks === Math.ceil(n / 2048) && a.reason.includes('da ' + (n / 1024) + ' KB'), n + ' byte: non supportata, con motivo');
}
eq(analyzeCart(pad(16384)), {kind: 'rally', banks: 8, mask: 7, ok: true, reason: ''}, '16 KB: schema rally (tappa 5)');
eq(analyzeCart(layoutCart(pad(12288))), {kind: 'rally', banks: 8, mask: 7, ok: true, reason: ''}, '12 KB disposto in una finestra da 16 KB: rally');
ok(isJmpVec(new Uint8Array([0x24, 0, 0xE4]), 0) && !isJmpVec(new Uint8Array([0x24, 0, 0xE5]), 0) && !isJmpVec(new Uint8Array([0x24, 0]), 0), 'isJmpVec');

// 3. indirizzi nel file
const std2 = analyzeCart(pad(4096)), std4 = analyzeCart(pad(8192)), std1 = analyzeCart(pad(2048));
const lin = analyzeCart(withVec(4096, 0x400));
eq(cartOffset(std1, 0xFF, 0x400), 0, '2 KB: 0x400 -> 0');
eq(cartOffset(std1, 0x00, 0x7FF), 0x3FF, '2 KB: 0x7FF');
eq(cartOffset(std1, 0x00, 0x800), 0x400, '2 KB: 0x800');
eq(cartOffset(std1, 0x00, 0xBFF), 0x7FF, '2 KB: 0xBFF');
eq(cartOffset(std1, 0x00, 0xC00), 0x400, '2 KB: 0xC00 specchio di 0x800');
eq(cartOffset(std1, 0x00, 0xFFF), 0x7FF, '2 KB: 0xFFF specchio di 0xBFF');
eq(cartOffset(std1, 0xFF, 0x7FF), 0x3FF, '2 KB: P1 ininfluente');
eq(cartOffset(std2, 0xFF, 0x400), 0x800, '4 KB: banco 1 a P1 = 0xFF');
eq(cartOffset(std2, 0xFE, 0x400), 0, '4 KB: banco 0 a P1 = 0xFE');
eq(cartOffset(std2, 0x02, 0x401), 1, '4 KB: solo il bit 0 di P1 sceglie');
eq(cartOffset(std4, 0xFF, 0x400), 0x1800, '8 KB: banco 3');
eq(cartOffset(std4, 0xFE, 0x400), 0x1000, '8 KB: banco 2');
eq(cartOffset(std4, 0xFD, 0xC00), 0x800 + 0x400, '8 KB: banco 1, specchio 0xC00');
eq(cartOffset(std4, 0x04, 0x400), 0, '8 KB: solo i bit 0-1 di P1');
eq(cartOffset(lin, 0xFF, 0x400), 0x400, 'lineare: 0x400');
eq(cartOffset(lin, 0x00, 0xFFF), 0xFFF, 'lineare: 0xFFF');
eq(cartOffset(lin, 0x00, 0xC00), 0xC00, 'lineare: 0xC00 non e\' uno specchio');

// 4. readProg della console
{
  const bios = rnd(1, 1024), cart = rnd(2, 4096);
  const con = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  ok(con.readProg(0) === bios[0] && con.readProg(0x3FF) === bios[0x3FF] && con.readProg(0x1000 + 5) === bios[5], 'BIOS nei primi 1 KB (indirizzo a 12 bit)');
  con.cpu.p1 = 0xFF; ok(con.readProg(0x400) === cart[0x800] && con.readProg(0xBFF) === cart[0xFFF], 'banco 1');
  con.cpu.p1 = 0xFE; ok(con.readProg(0x400) === cart[0] && con.readProg(0xC00) === cart[0x400] && con.readProg(0xFFF) === cart[0x7FF], 'banco 0 e specchio');
  const short = new Console({bios: bios.subarray(0, 100), cart: rnd(3, 3000), charset: OWN(), standard: 'PAL'});
  ok(short.readProg(100) === 0xFF && short.readProg(0x3FF) === 0xFF, 'BIOS corto: riempito con 0xFF');
  short.cpu.p1 = 0xFF;
  ok(short.readProg(0x400 + 1000) === 0xFF && short.readProg(0x400) === short.cart[0x800], 'cartuccia non multipla di 2 KB: riempita con 0xFF');
  const none = new Console({bios, cart: null, charset: OWN(), standard: 'PAL'});
  ok(none.readProg(0x400) === 0xFF && none.readProg(0xFFF) === 0xFF && none.readProg(0x10) === bios[0x10], 'senza cartuccia: 0xFF');
  ok(none.cartInfo.kind === 'none' && none.cartInfo.ok, 'cartInfo senza cartuccia');
  const big = new Console({bios, cart: rnd(4, 12288), charset: OWN(), standard: 'PAL'});
  ok(big.cartInfo.ok === true && big.cartInfo.kind === 'rally' && big.cart.length === 0x4000 && big.cart[0] === 0xFF && big.cart[0x1000] === big.cart[0x1000], 'cartuccia da 12 KB: finestra da 16 KB, schema rally');
  const big10 = new Console({bios, cart: rnd(4, 10240), charset: OWN(), standard: 'PAL'});
  ok(big10.cartInfo.ok === false && big10.cartInfo.kind === 'big', 'cartuccia da 10 KB segnalata non supportata');
  let thr = false; try { new Console({bios: new Uint8Array(0), cart: null, charset: OWN()}); } catch (e) { thr = true; }
  ok(thr, 'senza BIOS la console non si crea');
  thr = false; try { new Console({bios, cart: null, charset: new Uint8Array(100)}); } catch (e) { thr = true; }
  ok(thr, 'set di caratteri di dimensione sbagliata rifiutato');
}

// 5. MOVX
{
  const bios = rnd(5, 1024), cart = withVec(4096, 0x400);
  for (let i = 0x500; i < 0x600; i++) cart[i] = (i * 7) & 0xFF;
  for (let i = 0x000; i < 0x100; i++) cart[i] = (i * 5 + 3) & 0xFF;
  const con = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  const c = con.cpu;
  // RAM: P1 bit 4 = 0, A7 = 0
  c.p1 = 0xAF; con.movxWrite(0x10, 0x5A); ok(con.xram[0x10] === 0x5A, 'RAM: scrittura con P1 bit 4 = 0');
  c.p1 = 0xAF; c.p2 = 0x00; eq(con.movxRead(0x10), 0x5A, 'RAM: lettura (con la RAM selezionata la ROM dati non risponde)');
  con.movxWrite(0x90, 0x33); ok(con.xram[0x10] === 0x5A && con.xram.every((v, i) => i === 0x10 || v === 0), 'RAM: A7 = 1 non scrive (128 byte)');
  c.p1 = 0xAF | 0x40; con.movxWrite(0x11, 0x77); ok(con.xram[0x11] === 0, 'RAM: P1 bit 6 = 1 blocca la scrittura');
  eq(con.movxRead(0x10), 0x5A, 'RAM: la lettura funziona anche con P1 bit 6 = 1 (blocca solo la scrittura)');
  c.p1 = 0xFF; con.movxWrite(0x12, 0x99); ok(con.xram[0x12] === 0, 'RAM: P1 bit 4 = 1 non scrive');
  // chip video: P1 bit 3 = 0
  c.p1 = 0xB7; con.movxWrite(0xA3, 0x5A); ok(con.vdc.reg[0xA3] === 0x5A, 'video: scrittura con P1 bit 3 = 0');
  c.p1 = 0xB7 | 0x40; con.movxWrite(0xA3, 0x11); ok(con.vdc.reg[0xA3] === 0x11, 'video: la scrittura non e\' bloccata da P1 bit 6');
  c.p1 = 0xFF; con.movxWrite(0xA3, 0x22); ok(con.vdc.reg[0xA3] === 0x11, 'video: P1 bit 3 = 1 non scrive');
  c.p1 = 0xB7; con.movxWrite(0xC0, 0x44);
  eq(con.movxRead(0xC0), 0x44, 'video: lettura con P1 bit 3 = 0 e bit 6 = 0');
  c.p1 = 0xB7 | 0x40; eq(con.movxRead(0xC0), cart[0xC0], 'video: P1 bit 6 = 1 -> il video non risponde (resta la ROM dati)');
  // ROM dati della cartuccia lineare: P2 bit 0-3 alto, MOVX 8 bit basso
  c.p1 = 0xFF; c.p2 = 0x05; eq(con.movxRead(0x20), cart[0x520], 'ROM dati: P2 = 5, indirizzo 0x20');
  c.p2 = 0xF5; eq(con.movxRead(0x20), cart[0x520], 'ROM dati: i bit alti di P2 non contano');
  c.p2 = 0x00; eq(con.movxRead(0xFF), cart[0xFF], 'ROM dati: P2 = 0');
  c.p1 = 0xEF; c.p2 = 0x05; eq(con.movxRead(0x20), con.xram[0x20] & cart[0x520], 'ROM dati in AND con la RAM selezionata');
  c.p1 = 0xEF; c.p2 = 0x05; eq(con.movxRead(0x80 + 0x20), cart[0x5A0], 'ROM dati: A7 = 1, la RAM non risponde');
  // cartuccia non lineare: nessuna ROM dati
  const con2 = new Console({bios, cart: rnd(9, 4096), charset: OWN(), standard: 'PAL'});
  con2.cpu.p1 = 0xFF; con2.cpu.p2 = 0x05; eq(con2.movxRead(0x20), 0xFF, 'cartuccia a banchi: nessuna ROM dati (bus a 0xFF)');
  const con3 = new Console({bios, cart: null, charset: OWN(), standard: 'PAL'});
  con3.cpu.p1 = 0xFF; eq(con3.movxRead(0x20), 0xFF, 'senza cartuccia: bus a 0xFF');
}

// 6. tastiera e joystick
eq([keyCode(0), keyCode(0x80), keyCode(0x40), keyCode(0x01), keyCode(0x81), keyCode(0x10)], [0xFF, 0x0F, 0x2F, 0xEF, 0x0F, 0x6F], 'codifica 74148 della tastiera');
{
  const con = new Console({bios: rnd(6, 1024), cart: null, charset: OWN(), standard: 'PAL'});
  const c = con.cpu;
  c.p1 = 0xFB; c.p2 = 0xFF;                         // tastiera abilitata (P1 bit 2 = 0), riga 7
  con.keyRows[7] = 0x01; eq(con.p2Pin(), 0xEF, 'tastiera: riga 7, colonna 0');
  con.keyRows[7] = 0; eq(con.p2Pin(), 0xFF, 'tastiera: nessun tasto');
  c.p2 = 0xFA; con.keyRows[2] = 0x20; eq(con.p2Pin(), 0xFF & keyCode(0x20), 'tastiera: riga scelta da P2 bit 0-2');
  c.p1 = 0xFF; eq(con.p2Pin(), 0xFF, 'tastiera disabilitata con P1 bit 2 = 1');
  c.p1 = 0xFB; c.p2 = 0xF8; con.joy[0] = 0x05; con.joy[1] = 0x12;
  eq(con.busPin(), 0xFF & ~0x05 & 0xFF, 'joystick 0 sul BUS con la riga 0');
  c.p2 = 0xF9; eq(con.busPin(), 0xFF & ~0x12 & 0xFF, 'joystick 1 sul BUS con la riga 1');
  c.p2 = 0xFA; eq(con.busPin(), 0xFF, 'nessun joystick con la riga 2');
  c.p1 = 0xFF; c.p2 = 0xF8; eq(con.busPin(), 0xFF, 'joystick non letto con la tastiera disabilitata');
  eq([con.t0(), con.p1Pin()], [0, 0xFF], 'T0 = 0 e P1 aperto');
}

// 7. costruzione, scorrere il tempo, interrupt
{
  const bios = rnd(8, 1024);
  const c1 = new Console({bios: new Uint8Array([0x23]), cart: null, charset: OWN(), standard: 'PAL'});
  ok(c1.bios.length === 1024 && c1.bios[0] === 0x23 && c1.bios[1] === 0xFF && c1.readProg(0) === 0x23, 'BIOS di 1 byte accettato e riempito a 1 KB');
  const c2 = new Console({bios: rnd(8, 2048), cart: rnd(9, 2048), charset: OWN(), standard: 'PAL'});
  ok(c2.bios.length === 1024 && c2.readProg(0x3FF) === c2.bios[0x3FF], 'BIOS lungo: si usano solo i primi 1024 byte');
  ok(c2.readProg(0x400) === c2.cart[0], 'BIOS lungo: la cartuccia comincia a 0x400');
  const c3 = new Console({bios, cart: rnd(10, 2049), charset: OWN(), standard: 'PAL'});
  ok(c3.cart.length === 4096 && c3.cartInfo.banks === 2 && c3.bankMask === 1 && c3.cart[2049] === 0xFF, 'cartuccia di 2049 byte: 2 banchi, il resto a 0xFF');
  eq([c3.keyRows.length, c3.joy.length, c3.xram.length], [8, 2, 128], 'dimensioni di tastiera, joystick e RAM esterna');
  ok(new Console({bios, cart: rnd(10, 2048), charset: OWN(), standard: 'PAL'}).bankMask === 0, 'bankMask = 0 per 2 KB');
  ok(c3.bankMask === c3.cartInfo.mask, 'bankMask segue cartInfo');
  // runFrame: un fotogramma alla volta
  for (const std of ['PAL', 'NTSC']) {
    const con = new Console({bios, cart: rnd(11, 4096), charset: OWN(), standard: std});
    const fc = con.frameCycles;
    ok(fc > 5900 && fc < 8000, std + ': cicli per fotogramma ' + fc);
    let prev = con.vdc.frameDone, good = true;
    for (let i = 0; i < 6; i++) {
      const r = con.runFrame();
      if (r !== prev + 1 || con.vdc.frameDone !== prev + 1) good = false;
      prev = r;
    }
    ok(good, std + ': runFrame avanza di un solo fotogramma e ritorna il suo numero');
    const t0 = con.cpu.now;
    ok(Math.abs(t0 - 6 * con.t.frame / con.t.dpc) < 2 * fc / 1, std + ': sei fotogrammi = circa sei volte la durata del fotogramma (' + t0 + ')');
    con.runCycles(1000);
    ok(con.cpu.now >= t0 + 1000 && con.cpu.now < t0 + 1030, std + ': runCycles(1000) avanza di circa 1000 cicli (' + (con.cpu.now - t0) + ')');
    const cps = con.cyclesPerSecond;
    ok(Math.abs(cps - (std === 'PAL' ? 394099 : 357954)) < 5, std + ': cicli al secondo ' + cps);
    const hz = con.t.frame / con.t.dpc * 0 + cps / (con.t.frame / con.t.dpc);
    ok(std === 'PAL' ? (hz > 49.5 && hz < 49.9) : (hz > 59.7 && hz < 60.0), std + ': frequenza di quadro ' + hz.toFixed(3) + ' Hz');
  }
  const ci = new Console({bios, cart: null, charset: OWN(), standard: 'PAL'});
  eq(ci.intActive(), 0, 'nessun interrupt dopo il reset');
  ci.cpu.now = ci.vdc.nextEv + 0;
  while (ci.vdc.ev % 244 !== 243) { ci.cpu.now = ci.vdc.nextEv; ci.sync(ci.cpu); }
  ci.cpu.now = ci.vdc.nextEv; ci.sync(ci.cpu);
  eq(ci.intActive(), 1, 'interrupt al vblank: intActive vale esattamente 1');
  eq(ci.movxRead(0xA1) !== undefined, true, 'lettura di 0xA1 senza selezione');
  ci.cpu.p1 = 0xB7; ci.movxRead(0xA1);
  eq(ci.intActive(), 0, 'la lettura di 0xA1 azzera l\'interrupt');
  // indirizzi MOVX a 8 bit
  const cm = new Console({bios, cart: null, charset: OWN(), standard: 'PAL'});
  cm.cpu.p1 = 0xAF; cm.movxWrite(0x110, 0x5A);
  ok(cm.xram[0x10] === 0x5A, 'movxWrite maschera l\'indirizzo a 8 bit');
  eq(cm.movxRead(0x210), 0x5A, 'movxRead maschera l\'indirizzo a 8 bit');
}

// 8. conversione dei colori per il canvas
{
  const {paletteRgba32, fbToRgba} = require(S('screen.js'));
  const {PALETTE} = require(S('vdc.js'));
  const t = paletteRgba32(PALETTE);
  const le = new Uint8Array(t.buffer);
  let good = true;
  for (let i = 0; i < 16; i++) if (le[4 * i] !== PALETTE[i][0] || le[4 * i + 1] !== PALETTE[i][1] || le[4 * i + 2] !== PALETTE[i][2] || le[4 * i + 3] !== 255) good = false;
  ok(good, 'tabella dei colori: byte R, G, B, A in memoria');
  const fb = Uint8Array.from([0, 1, 15, 16 + 7, 255]);
  const out = new Uint32Array(5);
  fbToRgba(fb, t, out);
  ok(out[0] === t[0] && out[1] === t[1] && out[2] === t[15] && out[3] === t[7] && out[4] === t[15], 'fbToRgba: indice & 15');
  ok(PALETTE.length === 16 && PALETTE.every((c) => c.length === 3 && c.every((v) => v >= 0 && v <= 255)), 'palette: 16 colori RGB');
  // la palette coincide con quella del modello di riferimento (hw/o2hw.py: lista di tuple, si legge il testo del sorgente Python)
  const py = require('fs').readFileSync(path.join(__dirname, '..', 'hw', 'o2hw.py'), 'utf8');
  const m = /^PALETTE = (\[[^\]]*\])/m.exec(py);
  const ref = m ? new Function('return ' + m[1].replace(/\(/g, '[').replace(/\)/g, ']'))() : null;
  eq(PALETTE, ref, 'palette identica a quella del modello di riferimento');
}

// 9. chip video: tabella dei cambi di T1, ganci di prova, reset
{
  const {Vdc, EV_PER_FRAME} = require(S('vdc.js'));
  for (const std of ['PAL', 'NTSC']) {
    const v = new Vdc(OWN(), std);
    const w = new Vdc(OWN(), std);
    const per = v.t1Period;
    let lvl = w.t1At(per - 1), good = true, alt = true, pops = 0;
    for (let c = 0; c < 2 * per && good; c++) {
      while (w.nextT1 <= c) { const n = w.t1Pop(); if (n === lvl) alt = false; lvl = n; pops++; }
      if (lvl !== w.t1At(c % per)) good = false;
    }
    ok(good, std + ': i cambi di T1 della tabella riproducono t1At() in due periodi');
    ok(alt, std + ': i livelli di T1 si alternano (nessun cambio doppio)');
    ok(pops === 2 * v.t1Cycles.length, std + ': ' + pops + ' cambi in due periodi (' + v.t1Cycles.length + ' per periodo)');
    ok(v.t1Period === (std === 'PAL' ? 23788 : 4 * v.t.frame / v.t.dpc), std + ': periodo di T1 ' + v.t1Period);
    // ganci: un fotogramma = 243 righe + vblank
    const log = [];
    v.lineHook = (k, j, st) => log.push([k, j, st, v.frameDone]);
    while (v.ev < EV_PER_FRAME) v.event();
    ok(log.length === 244 && log.every((e, i) => e[0] === i), std + ': 244 eventi con indice consecutivo');
    ok(log.slice(0, 243).every((e, i) => e[1] === i) && log[243][1] === -1, std + ': righe 0..242 poi vblank (-1)');
    ok(log[241][3] === 0 && log[242][3] === 1 && log[243][3] === 1, std + ': il fotogramma e\' finito dopo la riga 242');
    ok(log[243][2] === (0x08 | 0x100) && v.irq === true && (v.ctlStatus & 0x08) !== 0, std + ': il vblank alza /INT e il bit 3 dello stato');
    // tempo degli eventi: la riga j al dot j * htotal, il vblank al dot irqDot
    const v2 = new Vdc(OWN(), std);
    const t = v2.t;
    let tm = true;
    for (let k = 0; k < 2 * EV_PER_FRAME; k++) {
      const f = Math.floor(k / EV_PER_FRAME), j = k % EV_PER_FRAME;
      const d = f * t.frame + (j < 243 ? j * t.htotal : t.irqDot);
      if (v2.nextEv !== Math.ceil(d / t.dpc)) tm = false;
      v2.event();
    }
    ok(tm, std + ': istante di ogni evento = ceil(dot / dot per ciclo)');
    // reset = oggetto nuovo
    const u = new Vdc(OWN(), std);
    for (let i = 0; i < 200; i++) u.write(i & 0xFF, (i * 37) & 0xFF, i);
    u.write(0xA0, 0x28, 300);
    while (u.nextEv < 40000) u.event();
    u.read(0xA2, 40001);
    u.t1Pop(); u.t1Pop();
    ok(u.frameDone > 0 && u.ev > 0, std + ': prima del reset il chip ha lavorato');
    u.reset();
    const fresh = new Vdc(OWN(), std);
    eq(u.saveState(), fresh.saveState(), std + ': reset = chip nuovo (stato)');
    ok(u.fb.every((b) => b === 0) && u.frameDone === 0 && u.nextEv === fresh.nextEv && u.nextT1 === fresh.nextT1 && u.irq === false, std + ': reset: schermo, fotogrammi, prossimi eventi, /INT');
  }
  // reset della console = console nuova
  const bios = rnd(21, 1024), cart = rnd(22, 4096);
  const a = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  for (let i = 0; i < 5; i++) a.runFrame();
  a.xram[5] = 77;
  a.reset();
  const b = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  eq(a.saveState(), b.saveState(), 'reset della console = console nuova');
  // a fine fotogramma e' stata disegnata anche l'ultima riga (242): il prossimo evento e' il vblank
  const c = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  let endOk = true;
  for (let i = 0; i < 4; i++) { c.runFrame(); if (c.vdc.ev % EV_PER_FRAME !== 243) endOk = false; }
  ok(endOk, 'runFrame si ferma subito dopo la riga 242');
}


// 10. suono del chip video: reset, andata e ritorno dello stato, allineamento degli stati di versione 1 (mutazione di vdc.js, tappa 3)
{
  const {Vdc} = require(S('vdc.js'));
  const script = (v, k, seed, keep) => {                    // k passi di una sequenza deterministica di scritture ed eventi di suono
    const r = rnd(seed, 600);
    v.write(0xA0, 0x04, 0);
    v.write(0xAA, 0xB0 | (seed & 0x0F) | ((seed & 0x10) ? 0x20 : 0), 0);          // uscita abilitata, rumore, frequenza e volume variabili
    for (let i = 0; i < k; i++) {
      if ((r[i] < 6 && seed % 5 !== 0) || (keep === 1 && i === k - 1)) v.write(0xA7 + (r[i] % 3), r[i + 1], v.nextSnd);                // scrittura del registro a scorrimento: shWritten
      if (r[i] > 220) v.write(0xAA, (r[i + 2] & 0xBF) | 0x80, v.nextSnd);
      if (!(keep === 1 && i === k - 1)) v.sndEvent();
    }
    if (keep === 2) {                                  // scrittura proprio nell'evento in cui scatta il prescaler: resta 'pending'
      while (((v.shPrescaler + 1) & ((v.reg[0xAA] & 0x20) ? 3 : 15)) !== 0) v.sndEvent();
      v.write(0xA9, 0x5A, v.nextSnd);
      v.sndEvent();
    }
  };
  for (const std of ['PAL', 'NTSC']) {
    let sawPending = false, sawWritten = false, sawCount = false, sawOut = false, sawIrq = false;
    for (let seed = 1; seed <= 30; seed++) {
      const k = seed * 9;
      const u = new Vdc(OWN(), std);
      script(u, k, seed, seed % 3);
      const st = u.saveState();
      if (st.snd.pending) sawPending = true;
      if (st.snd.written) sawWritten = true;
      if (st.snd.count) sawCount = true;
      if (st.snd.output) sawOut = true;
      if (u.irq) sawIrq = true;
      // andata e ritorno: stato identico e futuro identico (stessi cambi di livello, stessi registri)
      const w = new Vdc(OWN(), std);
      w.legacySound = true;
      w.loadState(JSON.parse(JSON.stringify(st)));
      ok(w.legacySound === false, std + ' #' + seed + ': loadState con suono azzera legacySound');
      eq(w.saveState(), st, std + ' #' + seed + ': andata e ritorno dello stato del suono');
      const la = [], lb = [];
      u.sndHook = (c, l) => la.push([c, l]); w.sndHook = (c, l) => lb.push([c, l]);
      for (let i = 0; i < 120; i++) { u.sndEvent(); w.sndEvent(); }
      eq(lb, la, std + ' #' + seed + ': futuro del suono dopo la ripresa');
      eq(w.saveState(), u.saveState(), std + ' #' + seed + ': stato dopo 120 eventi');
      // reset = chip nuovo, anche con suono in corso
      const x = new Vdc(OWN(), std);
      script(x, k, seed, seed % 3);
      x.legacySound = true;
      x.reset();
      const fresh = new Vdc(OWN(), std);
      eq(x.saveState(), fresh.saveState(), std + ' #' + seed + ': reset con suono in corso = chip nuovo');
      ok(x.legacySound === false && x.shPending === false && x.shWritten === false && x.nextSnd === fresh.nextSnd, std + ' #' + seed + ': reset del suono (campi)');
    }
    ok(sawPending && sawWritten && sawCount && sawOut && sawIrq, std + ': le sequenze coprono pending, written, contatore, uscita e IRQ ' + [sawPending, sawWritten, sawCount, sawOut, sawIrq]);
    // stato senza suono (versione 1) e allineamento
    const t = new Vdc(OWN(), std);
    const base = t.saveState();
    const old = JSON.parse(JSON.stringify(base)); delete old.snd;
    const lv = new Vdc(OWN(), std);
    lv.loadState(old);
    ok(lv.legacySound === true, std + ': stato v1 = legacySound');
    const cycles = [0, 1, 2, 17, 18, 19, 1000, 5000, 8228, 8229, 8230, 123456, 999999];
    for (let n = 0; n < 6; n++) cycles.push(t.sndCycle(n), t.sndCycle(n) + 1, t.sndCycle(n) - 1, t.sndCycle(n + 1000), t.sndCycle(n + 1000) + 1);
    for (const cyc of cycles) {
      if (cyc < 0) continue;
      const v = new Vdc(OWN(), std);
      script(v, 50, 7);                                   // stato del suono diverso da zero prima dell'allineamento
      v.shPending = true; v.shWritten = true; v.shCount = 5; v.shOutput = 1; v.shPrescaler = 9;
      v.alignSound(cyc);
      let want = 0;
      while (t.sndCycle(want) < cyc) want++;
      ok(v.sn === want, std + ': alignSound(' + cyc + '): primo evento utile ' + v.sn + ' invece di ' + want);
      ok(v.nextSnd === t.sndCycle(want) && v.nextSnd >= cyc && (v.sn === 0 || t.sndCycle(v.sn - 1) < cyc), std + ': alignSound(' + cyc + '): ciclo');
      ok(v.shPrescaler === 0 && v.shPending === false && v.shWritten === false && v.shCount === 0 && v.shOutput === 0, std + ': alignSound(' + cyc + '): azzera il registro a scorrimento');
    }
    // stato con suono non valido
    const mk = (snd) => { const q = JSON.parse(JSON.stringify(base)); q.snd = snd; return q; };
    for (const bad of [null, 5, 'x', true]) {
      let msg = '';
      try { new Vdc(OWN(), std).loadState(mk(bad)); } catch (e) { msg = e.message; }
      ok(msg === 'stato non valido: suono', std + ': snd = ' + JSON.stringify(bad) + ' rifiutato con messaggio chiaro (' + msg + ')');
    }
  }
}


// 11. console: frequenza dei cicli e soglia di coerenza dei tempi nella ripresa di uno stato (mutazione di console.js, tappa 3)
{
  const {Vdc} = require(S('vdc.js'));
  for (const std of ['PAL', 'NTSC']) {
    const bios = rnd(31, 1024), cart = rnd(32, 2048);
    const mk = () => new Console({bios, cart, charset: OWN(), standard: std});
    const c = mk();
    ok(c.cyclesPerSecond === (std === 'PAL' ? 17734475 / 45 : 3579545 / 10), std + ': cicli al secondo');
    for (let i = 0; i < 3; i++) c.runFrame();
    const base = JSON.parse(JSON.stringify(c.saveState()));
    const lim = 3 * c.frameCycles;
    const attempt = (mod) => {
      const st = JSON.parse(JSON.stringify(base));
      mod(st);
      try { mk().loadState(st); return ''; } catch (e) { return e.message; }
    };
    const probe = new Vdc(OWN(), std);
    const nxt = {
      ev: (i) => { probe.ev = i; probe.updateNext(); return probe.nextEv; },
      t1i: (i) => { probe.t1i = i; probe.updateNext(); return probe.nextT1; },
      sn: (i) => { probe.sn = i; probe.updateSnd(); return probe.nextSnd; },
    };
    const near = (kind, target) => { let i = 0; while (nxt[kind](i) < target) i++; return i; };       // primo indice con ciclo >= target
    const start = {ev: 1500, t1i: 4000, sn: 2000};
    for (const kind of ['ev', 't1i', 'sn']) {
      for (const sign of [-1, 1]) {
        for (const extra of [0, 1]) {
          const i0 = start[kind], n = nxt[kind](i0);
          const T = n + sign * (lim + extra);                           // tempo della CPU: sign > 0 = CPU avanti, < 0 = CPU indietro
          const st = JSON.parse(JSON.stringify(base));
          st.cpu.now = T;
          for (const k of ['ev', 't1i', 'sn']) {
            const idx = k === kind ? i0 : near(k, T);
            if (k === 'sn') st.vdc.snd.sn = idx; else st.vdc[k] = idx;
          }
          let msg = '';
          try { mk().loadState(st); } catch (e) { msg = e.message; }
          const what = std + ': ' + kind + ' a distanza lim' + (extra ? '+1' : '') + ' (CPU ' + (sign > 0 ? 'avanti' : 'indietro') + ')';
          if (extra === 0) ok(msg === '', what + ' accettato (' + msg + ')');
          else ok(/incoerenti/.test(msg), what + ' rifiutato (' + msg + ')');
        }
      }
    }
  }
}

console.log(fails ? 'FALLITI ' + fails + ' controlli (' + passes + ' riusciti)' : 'OK: ' + passes + ' controlli puntuali');
process.exit(fails ? 1 : 0);
