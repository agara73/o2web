'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_charedit.js - editor dei set di caratteri (src/charedit.js): bit dei glifi contro un modello a matrice di pixel scritto a parte,
// trasformazioni (ribalta, trasla, inverti) contro la definizione per coordinate, andata e ritorno ASCII, lettura di tabelle C e di
// elenchi esadecimali, riconoscimento dei set noti (CRC-32 contro zlib di Node), e proprieta' dei due set GPL di ripiego (disposizione
// del datasheet: mosaici uniti / separati, cifre e lettere tutte diverse).
const path = require('path');
const zlib = require('zlib');
const S = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const C = require(S('charedit.js'));
const own = require('../hw/charset_own.js');
const efOwn = require('../hw/charset9341_own.js');
const {zipStore} = require(S('zipstore.js'));

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL  ' + m); } };
const throws = (f, m) => { let e = null; try { f(); } catch (x) { e = x; } ok(!!e, m + (e ? '' : ' (non ha lanciato)')); };
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const R = rng(12345);
const rndBytes = (n) => Uint8Array.from({length: n}, () => (R() * 256) | 0);

// ---- modello indipendente: matrice di pixel [y][x] booleani a partire dai byte
function matrix(kind, data, g) {
  const h = kind === 'vdc' ? 8 : 10, m = [];
  for (let y = 0; y < h; y++) {
    const b = data[g * h + y], row = [];
    for (let x = 0; x < 8; x++) row.push(kind === 'vdc' ? ((b >> (7 - x)) & 1) === 1 : ((b >> x) & 1) === 1);
    m.push(row);
  }
  return m;
}
const asText = (m) => m.map((r) => r.map((v) => (v ? '#' : '.')).join(''));

ok(C.KINDS.vdc.size === 512 && C.KINDS.vdc.glyphs === 64 && C.KINDS.vdc.w === 8 && C.KINDS.vdc.h === 8 && C.KINDS.vdc.msbLeft === true, 'KINDS.vdc: 512 byte, 64 caratteri 8x8, bit 7 a sinistra');
ok(C.KINDS.ef.size === 2560 && C.KINDS.ef.glyphs === 256 && C.KINDS.ef.w === 8 && C.KINDS.ef.h === 10 && C.KINDS.ef.msbLeft === false, 'KINDS.ef: 2560 byte, 256 caratteri 8x10, bit 0 a sinistra');
for (const kind of ['vdc', 'ef']) {
  const k = C.KINDS[kind], h = k.h;
  const data = rndBytes(k.size);
  // lettura: getGlyph / getPixel contro la matrice
  let okRead = true;
  for (let g = 0; g < k.glyphs; g++) {
    const m = matrix(kind, data, g);
    if (JSON.stringify(C.getGlyph(kind, data, g)) !== JSON.stringify(asText(m))) okRead = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) if (C.getPixel(kind, data, g, x, y) !== m[y][x]) okRead = false;
  }
  ok(okRead, kind + ': lettura dei glifi e dei pixel contro la matrice');
  // scrittura di un pixel: cambia solo quello
  let okSet = true;
  for (let t = 0; t < 400; t++) {
    const g = (R() * k.glyphs) | 0, x = (R() * 8) | 0, y = (R() * h) | 0, on = R() < 0.5;
    const before = Uint8Array.from(data), m0 = matrix(kind, before, g);
    C.setPixel(kind, data, g, x, y, on);
    m0[y][x] = on;
    if (JSON.stringify(asText(matrix(kind, data, g))) !== JSON.stringify(asText(m0))) okSet = false;
    for (let i = 0; i < data.length; i++) if (Math.floor(i / h) !== g && data[i] !== before[i]) okSet = false;
  }
  ok(okSet, kind + ': setPixel cambia solo il pixel scelto');
  // setGlyph / getGlyph andata e ritorno e ordine dei bit
  const rows = Array.from({length: h}, (_, y) => '#.'.repeat(4).slice(y % 2));
  const rows8 = rows.map((r) => (r + '........').slice(0, 8));
  const d2 = new Uint8Array(k.size);
  C.setGlyph(kind, d2, 3, rows8);
  ok(JSON.stringify(C.getGlyph(kind, d2, 3)) === JSON.stringify(rows8), kind + ': setGlyph / getGlyph andata e ritorno');
  const one = new Uint8Array(k.size); C.setPixel(kind, one, 0, 0, 0, true);
  ok(one[0] === (k.msbLeft ? 0x80 : 0x01), kind + ': il pixel di sinistra e\' il bit ' + (k.msbLeft ? '7' : '0'));
  C.setPixel(kind, one, 0, 7, 0, true);
  ok(one[0] === 0x81, kind + ': il pixel di destra e\' l\'altro estremo');
  // clear / invert
  const d3 = rndBytes(k.size), d3b = Uint8Array.from(d3);
  C.invertGlyph(kind, d3, 5);
  let okInv = true;
  for (let i = 0; i < d3.length; i++) okInv = okInv && (Math.floor(i / h) === 5 ? d3[i] === (d3b[i] ^ 0xFF) : d3[i] === d3b[i]);
  ok(okInv, kind + ': invertGlyph');
  C.clearGlyph(kind, d3, 5);
  ok(d3.slice(5 * h, 6 * h).every((v) => v === 0) && d3[4 * h] === d3b[4 * h] && d3[6 * h] === d3b[6 * h], kind + ': clearGlyph');
  // trasformazioni contro la definizione per coordinate
  let okTr = true;
  for (let t = 0; t < 200; t++) {
    const g = (R() * k.glyphs) | 0, rowsG = C.getGlyph(kind, data, g), m = matrix(kind, data, g);
    const dx = ((R() * 15) | 0) - 7, dy = ((R() * (2 * h + 1)) | 0) - h, wrap = R() < 0.5;
    const sh = C.shiftGlyph(rowsG, dx, dy, wrap);
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) {
      let sx = x - dx, sy = y - dy, v;
      if (wrap) { sx = ((sx % 8) + 8) % 8; sy = ((sy % h) + h) % h; v = m[sy][sx]; }
      else v = sx >= 0 && sx < 8 && sy >= 0 && sy < h ? m[sy][sx] : false;
      if ((sh[y][x] === '#') !== v) okTr = false;
    }
    if (sh.length !== h || sh.some((r) => r.length !== 8)) okTr = false;
    const fh = C.flipH(rowsG), fv = C.flipV(rowsG);
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) {
      if ((fh[y][x] === '#') !== m[y][7 - x]) okTr = false;
      if ((fv[y][x] === '#') !== m[h - 1 - y][x]) okTr = false;
    }
  }
  ok(okTr, kind + ': trasla (con e senza rotazione), ribalta H e V');
  // ASCII
  const g7 = C.getGlyph(kind, data, 7);
  ok(JSON.stringify(C.glyphFromAscii(C.glyphToAscii(g7), h)) === JSON.stringify(g7), kind + ': andata e ritorno ASCII');
  ok(JSON.stringify(C.glyphFromAscii('#..\n' + '\n'.repeat(h - 1).replace(/\n/g, '.\n').slice(0, -1) , h).slice(0, 1)) === JSON.stringify(['#.......']), kind + ': righe corte completate con spazi spenti');
  throws(() => C.glyphFromAscii('##', h), kind + ': ASCII con troppe poche righe rifiutato');
  throws(() => C.glyphFromAscii(Array(h).fill('#x#').join('\n'), h), kind + ': ASCII con caratteri non validi rifiutato');
  // ASCII: righe finali vuote, spazi a fine riga, riga vuota iniziale
  const okA = Array(h).fill('#.#.....');
  ok(JSON.stringify(C.glyphFromAscii(okA.join('\n') + '\n', h)) === JSON.stringify(okA), kind + ': ASCII con a-capo finale accettato');
  ok(JSON.stringify(C.glyphFromAscii(okA.join('\n') + '\r\n', h)) === JSON.stringify(okA), kind + ': ASCII con CR LF finale accettato');
  ok(JSON.stringify(C.glyphFromAscii(okA.map((r) => r.slice(0, 3) + '   ').join('\n'), h)) === JSON.stringify(okA), kind + ': spazi a fine riga ignorati');
  throws(() => C.glyphFromAscii('\n' + okA.join('\n'), h), kind + ': riga vuota iniziale rifiutata (servono ' + h + ' righe di 1-8 caratteri)');
  throws(() => C.glyphFromAscii(okA.join('\n') + '\n\n\n#', h), kind + ': righe in piu\' rifiutate');
  throws(() => C.glyphFromAscii(Array(h).fill('#########').join('\n'), h), kind + ': riga di 9 pixel rifiutata');
  throws(() => C.glyphFromAscii(okA.slice(1).concat(['']).join('\n') + '\n.', h), kind + ': riga vuota in mezzo rifiutata');
  // argomenti non validi
  throws(() => C.getGlyph(kind, new Uint8Array(k.size - 1), 0), kind + ': dimensione errata rifiutata');
  throws(() => C.getGlyph(kind, data, k.glyphs), kind + ': carattere oltre l\'ultimo rifiutato');
  throws(() => C.getGlyph(kind, data, -1), kind + ': carattere negativo rifiutato');
  throws(() => C.getPixel(kind, data, 0, 8, 0), kind + ': pixel x fuori campo rifiutato');
  throws(() => C.getPixel(kind, data, 0, 0, h), kind + ': getPixel y fuori campo rifiutato');
  throws(() => C.getPixel(kind, data, 0, -1, 0), kind + ': getPixel x negativo rifiutato');
  throws(() => C.getPixel(kind, data, 0, 0, -1), kind + ': getPixel y negativo rifiutato');
  throws(() => C.getPixel(kind, data, 0, 1.5, 0), kind + ': getPixel x non intero rifiutato');
  throws(() => C.setPixel(kind, data, 0, 8, 0, true), kind + ': setPixel x fuori campo rifiutato');
  throws(() => C.setPixel(kind, data, 0, -1, 0, true), kind + ': setPixel x negativo rifiutato');
  throws(() => C.setPixel(kind, data, 0, 0, -1, true), kind + ': setPixel y negativo rifiutato');
  throws(() => C.setPixel(kind, data, 0, 0, 0.5, true), kind + ': setPixel y non intero rifiutato');
  throws(() => C.setGlyph(kind, data, 0, 'x'), kind + ': setGlyph con non-array rifiutato');
  throws(() => C.getGlyph(kind, [1, 2, 3], 0), kind + ': dati non Uint8Array rifiutati');
  throws(() => C.setPixel(kind, data, 0, 0, h, true), kind + ': pixel y fuori campo rifiutato');
  throws(() => C.setGlyph(kind, data, 0, rows8.slice(1)), kind + ': glifo con troppe poche righe rifiutato');
  throws(() => C.setGlyph(kind, data, 0, rows8.map(() => '#######')), kind + ': riga di 7 pixel rifiutata');
}
throws(() => C.glyphCount('xx'), 'tipo di set sconosciuto rifiutato');
ok(C.glyphCount('vdc') === 64 && C.glyphCount('ef') === 256, 'numero di caratteri: 64 e 256');
ok(!C.setsEqual(Uint8Array.of(1, 2), Uint8Array.of(0, 2)) && C.setsEqual(Uint8Array.of(), Uint8Array.of()) && C.setsEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2)) && !C.setsEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3)) && !C.setsEqual(Uint8Array.of(1), Uint8Array.of(1, 2)), 'setsEqual');

// ---- lettura di tabelle C ed elenchi esadecimali
function cTable(vals, fmt) { return vals.map(fmt).join(', '); }
{
  const v512 = Array.from(rndBytes(512)), v2560 = Array.from(rndBytes(2560));
  const hex = (v) => '0x' + (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
  let r = C.parseSource('/* font */\nconst unsigned char cset[512] = {\n' + cTable(v512, hex) + '\n};\n');
  ok(r && r.kind === 'vdc' && C.setsEqual(r.data, Uint8Array.from(v512)), 'parseSource: tabella C esadecimale da 512 valori');
  r = C.parseSource('// 2560\nunsigned char ef[2560]={' + cTable(v2560, (v) => String(v)) + '};');
  ok(r && r.kind === 'ef' && C.setsEqual(r.data, Uint8Array.from(v2560)), 'parseSource: tabella C decimale da 2560 valori');
  r = C.parseSource('x = {' + cTable(v512, (v) => '$' + (v < 16 ? '0' : '') + v.toString(16)) + ',};');
  ok(r && r.kind === 'vdc' && C.setsEqual(r.data, Uint8Array.from(v512)), 'parseSource: valori $XX e virgola finale');
  const withComments = '{' + v512.map((v, i) => hex(v) + (i % 8 === 7 ? ', /* riga ' + (i >> 3) + ' 0xFF 0xEE */' : ',')).join('\n') + '}';
  r = C.parseSource(withComments.replace(/,\}$/, '}'));
  ok(r && r.kind === 'vdc' && C.setsEqual(r.data, Uint8Array.from(v512)), 'parseSource: i commenti non contano');
  r = C.parseSource('altro = {1, 2, 3};\ncset = {' + cTable(v512, hex) + '};');
  ok(r && r.kind === 'vdc', 'parseSource: salta le tabelle di altra lunghezza');
  ok(C.parseSource('{' + cTable(v512.slice(1), hex) + '}') === null, 'parseSource: 511 valori: nessun set');
  ok(C.parseSource('{' + cTable(v512.concat([0]), hex) + '}') === null, 'parseSource: 513 valori: nessun set');
  ok(C.parseSource('{' + cTable(v512.map((v, i) => (i === 7 ? '256' : hex(v))), (x) => x) + '}') === null, 'parseSource: 256 non e\' un byte: nessun set');
  ok(C.parseSource('{' + cTable(v512.map((v, i) => (i === 9 ? 'zz' : hex(v))), (x) => x) + '}') === null, 'parseSource: un valore non numerico: nessun set');
  r = C.parseSource(v512.map((v) => (v < 16 ? '0' : '') + v.toString(16)).join(' '));
  ok(r && r.kind === 'vdc' && C.setsEqual(r.data, Uint8Array.from(v512)), 'parseSource: elenco di byte esadecimali separati da spazi');
  r = C.parseSource(v2560.map((v) => (v < 16 ? '0' : '') + v.toString(16)).join('\n'));
  ok(r && r.kind === 'ef', 'parseSource: elenco esadecimale da 2560 byte');
  // valori numerici ai bordi
  const tbl = (first) => '{' + [first].concat(Array(511).fill('0')).join(',') + '}';
  for (const [txt, expect, why] of [['0xF', 15, '0xF a una cifra'], ['0xff', 255, '0xff minuscolo'], ['$F', 15, '$F a una cifra'], ['255', 255, '255'], ['7', 7, '7'], ['0', 0, '0'],
    ['0x100', null, '0x100 e\' piu\' di un byte'], ['$100', null, '$100 e\' piu\' di un byte'], ['256', null, '256'], ['1000', null, '1000'], ['-1', null, '-1'], ['0x', null, '0x senza cifre'],
    ['1e2', null, '1e2'], ['0xG1', null, '0xG1']]) {
    const rr = C.parseSource(tbl(txt));
    ok(expect === null ? rr === null : rr && rr.data[0] === expect && rr.data[1] === 0 && rr.data.length === 512, 'parseSource: valore ' + why);
  }
  // elenco esadecimale: parole estranee o byte attaccati
  const hexs = Array.from(rndBytes(512)).map((v) => (v < 16 ? '0' : '') + v.toString(16));
  ok(C.parseSource(hexs.join(' ') + ' zz') === null, 'parseSource: elenco con una parola estranea in fondo: nessun set');
  ok(C.parseSource('byte: ' + hexs.join(' ')) === null, 'parseSource: elenco preceduto da testo: nessun set');
  ok(C.parseSource(hexs.slice(0, 511).join(' ') + ' fff') === null, 'parseSource: un byte a tre cifre: nessun set');
  ok(C.parseSource(hexs.join('-')) === null, 'parseSource: byte separati da trattino: non e\' un elenco riconosciuto');
  ok(C.parseSource(hexs.join(',').replace(/,/g, ';')) !== null, 'parseSource: byte separati da punto e virgola');
  ok(C.parseSource(hexs.map((x) => '0x' + x).join(' ')) !== null, 'parseSource: elenco di 0xNN separati da spazi');
  ok(C.parseSource('') === null && C.parseSource('ciao') === null && C.parseSource(null) === null && C.parseSource(5) === null, 'parseSource: testo vuoto, parole, null, numero');
}

// ---- findSetInFile: binari, zip (anche annidati), sorgenti C, file estranei
{
  const enc = (t) => new TextEncoder().encode(t);
  const v512 = rndBytes(512), v2560 = rndBytes(2560);
  const hex = (v) => '0x' + (v < 16 ? '0' : '') + v.toString(16);
  const csrc = (v) => enc('/* cset */\nconst unsigned char cset[' + v.length + '] = {\n' + Array.from(v).map(hex).join(', ') + '\n};\n');
  let r = C.findSetInFile(v512);
  ok(r && r.kind === 'vdc' && C.setsEqual(r.data, v512) && r.data !== v512 && r.from === '', 'findSetInFile: .bin da 512 byte (copia)');
  r = C.findSetInFile(v2560);
  ok(r && r.kind === 'ef' && C.setsEqual(r.data, v2560), 'findSetInFile: .bin da 2560 byte');
  r = C.findSetInFile(csrc(v512));
  ok(r && r.kind === 'vdc' && C.setsEqual(r.data, v512) && /tabella C/.test(r.note), 'findSetInFile: sorgente C con tabella da 512');
  r = C.findSetInFile(zipStore([{name: 'LEGGIMI.txt', data: enc('niente')}, {name: 'src/cset.c', data: csrc(v512)}]));
  ok(r && r.kind === 'vdc' && r.from === 'src/cset.c' && C.setsEqual(r.data, v512), 'findSetInFile: zip con sorgente C (salta i file senza set)');
  r = C.findSetInFile(zipStore([{name: 'a/charset.bin', data: v512}]));
  ok(r && r.from === 'a/charset.bin' && C.setsEqual(r.data, v512), 'findSetInFile: zip con .bin');
  const inner = zipStore([{name: 'rom.bin', data: v2560}]);
  r = C.findSetInFile(zipStore([{name: 'in.zip', data: inner}]));
  ok(r && r.kind === 'ef' && r.from === 'in.zip > rom.bin', 'findSetInFile: zip dentro zip (percorso con >)');
  const z3 = zipStore([{name: 'b.zip', data: zipStore([{name: 'c.zip', data: inner}])}]);
  ok(C.findSetInFile(z3) === null, 'findSetInFile: tre livelli di zip: non si scende');
  const both = zipStore([{name: 'one.bin', data: v512}, {name: 'two.rom', data: v2560}]);
  ok(C.findSetInFile(both, 'ef').kind === 'ef' && C.findSetInFile(both, 'vdc').kind === 'vdc' && C.findSetInFile(both).kind === 'vdc', 'findSetInFile: con due set nello zip sceglie il tipo voluto (altrimenti il primo)');
  r = C.findSetInFile(zipStore([{name: 'one.bin', data: v512}]), 'ef');
  ok(r && r.kind === 'vdc', 'findSetInFile: se manca il tipo voluto ritorna l\'altro');
  ok(C.findSetInFile(zipStore([{name: 'x.txt', data: enc('niente di utile')}])) === null, 'findSetInFile: zip senza set: null');
  ok(C.findSetInFile(zipStore([])) === null, 'findSetInFile: zip vuoto: null');
  const broken = Uint8Array.from(zipStore([{name: 'one.bin', data: v512}])); broken[40] ^= 0xFF;
  ok(C.findSetInFile(broken) === null, 'findSetInFile: zip con byte rovinato (CRC): null, senza eccezioni');
  ok(C.findSetInFile(rndBytes(1000)) === null && C.findSetInFile(new Uint8Array(0)) === null && C.findSetInFile('x') === null && C.findSetInFile(null) === null, 'findSetInFile: file estranei: null');
  const bin1000 = Uint8Array.from({length: 1000}, (_, i) => (i % 7 === 0 ? 0 : 0x41)); 
  ok(C.findSetInFile(bin1000) === null, 'findSetInFile: binario con zeri non e\' testo');
  ok(C.findSetInFile(enc('ciao come stai')) === null, 'findSetInFile: testo senza tabella: null');
}

// ---- tabelle a due dimensioni (O2EM vpp_cset): bit invertiti, accettate solo con impronta nota
{
  const hex = (v) => '0x' + (v < 16 ? '0' : '') + v.toString(16);
  const rev = (b) => { let r = 0; for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i; return r; };
  const R = rndBytes(2560), known = [{kind: 'ef', crc: zlib.crc32(R), label: 'ROM di prova'}];
  const half = (a, b) => Array.from(R.slice(a, b)).map((v) => hex(rev(v))).join(',');
  const nest = (c) => 'const unsigned char t[2][1280] = {\n{' + half(0, 1280) + '},\n{' + half(1280, 2560) + '}\n};' + (c || '');
  let r = C.parseSource(nest(), known);
  ok(r && r.kind === 'ef' && C.setsEqual(r.data, R) && /due dimensioni/.test(r.note), 'parseSource: tabella 2 x 1280 con bit invertiti e impronta nota: ROM rimessa in ordine');
  ok(C.parseSource(nest()) === null, 'parseSource: la stessa tabella con impronta sconosciuta (elenco predefinito): scartata, nessuna scommessa sui bit');
  ok(C.parseSource(nest(), [{kind: 'vdc', crc: zlib.crc32(R), label: 'x'}]) === null, 'parseSource: impronta nota ma per un altro tipo: scartata');
  const oneBit = nest().replace(/0x[0-9a-f]{2}/, '0x01');
  ok(C.parseSource(oneBit, known) === null, 'parseSource: un solo valore cambiato: impronta diversa, scartata');
  ok(C.parseSource(nest().replace('},\n{', ',0x00},\n{'), known) === null, 'parseSource: 2561 valori: scartata');
  ok(C.parseSource(nest().replace(/0x[0-9a-f]{2}/, 'zz'), known) === null, 'parseSource: valore non numerico: scartata');
  ok(C.parseSource(nest().replace('const unsigned char t[2][1280] = {', '/*{') + '*/', known) === null, 'parseSource: tabella dentro un commento: ignorata');
  const flat = '{' + Array.from(R).map(hex).join(',') + '}';
  r = C.parseSource(flat, known);
  ok(r && r.kind === 'ef' && C.setsEqual(r.data, R) && /tabella C di 2560/.test(r.note), 'parseSource: la tabella piatta da 2560 passa come prima (senza inversione)');
  r = C.findSetInFile(new TextEncoder().encode(nest()), 'ef', 0, known);
  ok(r && r.kind === 'ef' && C.setsEqual(r.data, R), 'findSetInFile: sorgente con tabella 2D e impronta nota');
  r = C.findSetInFile(zipStore([{name: 'src/vpp.c', data: new TextEncoder().encode(nest())}]), 'ef', 0, known);
  ok(r && r.kind === 'ef' && r.from === 'src/vpp.c' && C.setsEqual(r.data, R), 'findSetInFile: zip con tabella 2D e impronta nota (la lista nota passa dentro lo zip)');
  ok(C.findSetInFile(new TextEncoder().encode(nest())) === null, 'findSetInFile: senza impronta nota: null');
}

// ---- riconoscimento (CRC-32 contro zlib)
{
  const a = rndBytes(512), b = rndBytes(2560);
  const ia = C.identify(a), ib = C.identify(b);
  ok(ia && ia.kind === 'vdc' && ia.label === null && ia.crc === zlib.crc32(a), 'identify: set da 512 byte sconosciuto, CRC come zlib');
  ok(ib && ib.kind === 'ef' && ib.label === null && ib.crc === zlib.crc32(b), 'identify: set da 2560 byte sconosciuto, CRC come zlib');
  const fake = [{kind: 'vdc', crc: zlib.crc32(a), label: 'finto'}];
  ok(C.identify(a, fake).label === 'finto' && C.identify(a, fake).kind === 'vdc', 'identify: riconosce un set dall\'elenco');
  ok(C.identify(b, fake).label === null, 'identify: l\'elenco vale solo per il tipo giusto');
  ok(C.identify(b, [{kind: 'vdc', crc: zlib.crc32(b), label: 'x'}]).label === null, 'identify: stesso CRC ma tipo diverso: sconosciuto');
  ok(C.identify(rndBytes(512), fake).label === null, 'identify: CRC diverso: sconosciuto');
  ok(C.identify(new Uint8Array(100)) === null && C.identify([1]) === null, 'identify: altre dimensioni o tipi: null');
  ok(C.KNOWN.length === 2 && C.KNOWN[0].crc === 0xB46A3F31 && C.KNOWN[1].crc === 0x8DE85988, 'identify: elenco dei set noti (CRC dichiarati da MAME)');
}

// ---- proprieta' dei set GPL
{
  const v = new Uint8Array(own.build());
  ok(v.length === 512, 'set GPL del chip video: 512 byte');
  // le prime 40 celle (cifre e lettere) sono tutte diverse e non vuote (tranne lo spazio, cella 12)
  const seen = new Set();
  let distinct = true, nonEmpty = true;
  for (let c = 0; c < 48; c++) {
    const key = Array.from(v.slice(c * 8, c * 8 + 8)).join(',');
    if (seen.has(key)) distinct = false;
    seen.add(key);
    if (c !== 12 && v.slice(c * 8, c * 8 + 8).every((x) => x === 0)) nonEmpty = false;
  }
  ok(distinct && nonEmpty, 'set GPL del chip video: celle 0-47 tutte diverse e (tranne lo spazio) non vuote');
  const e = new Uint8Array(efOwn.build());
  ok(e.length === 2560, 'set GPL EF9341: 2560 byte');
  const px = (code, x, y, gamma) => ((e[((gamma ? 128 : 0) + code) * 10 + y] >> x) & 1) === 1;
  // mosaici: per ogni codice, i sei blocchi (centro di ogni blocco) corrispondono ai sei bit bassi; uniti (0x40-0x7F) e separati (0x00-0x3F)
  let okMos = true, okGap = true;
  const centers = [[1, 1], [5, 1], [1, 4], [5, 4], [1, 8], [5, 8]];                     // x, y di un pixel interno a ogni blocco
  for (let code = 0; code < 128; code++) {
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = centers[i];
      if (px(code, cx, cy, true) !== (((code >> i) & 1) === 1)) okMos = false;
    }
    if (code < 0x40) {                                                                  // separati: l'ultima riga di ogni banda e la colonna 7 sono vuote
      for (const y of [2, 6, 9]) for (let x = 0; x < 8; x++) if (px(code, x, y, true)) okGap = false;
      for (let y = 0; y < 10; y++) if (px(code, 3, y, true) && false) okGap = false;
      for (let y = 0; y < 10; y++) if (px(code, 7, y, true)) okGap = false;
    } else if (code === 0x7F) {                                                         // uniti: tutto acceso
      for (let y = 0; y < 10; y++) for (let x = 0; x < 8; x++) if (!px(code, x, y, true)) okGap = false;
    }
  }
  ok(okMos, 'set GPL EF9341: i 6 bit bassi dei codici semigrafici accendono i 6 blocchi (alto-sinistra, alto-destra, ... basso-destra)');
  ok(okGap, 'set GPL EF9341: mosaici separati con i fili di spazio, mosaico unito pieno 0x7F tutto acceso');
  // alfanumerico: cifre, maiuscole e minuscole tutte diverse fra loro
  const keys = new Map();
  let distinctA = true;
  for (let c = 0x21; c < 0x7F; c++) {
    if (c === 0x60) continue;
    const key = Array.from(e.slice(c * 10, c * 10 + 10)).join(',');
    if (keys.has(key)) { distinctA = false; console.log('  uguali: ' + String.fromCharCode(keys.get(key)) + ' e ' + String.fromCharCode(c)); }
    keys.set(key, c);
  }
  ok(distinctA, 'set GPL EF9341: i caratteri ASCII 0x21-0x7E (meno 0x60) hanno tutti glifi diversi (minuscole vere)');
  ok(e.slice(0x20 * 10, 0x21 * 10).every((x) => x === 0), 'set GPL EF9341: lo spazio e\' vuoto');
  ok(e.slice(0x7F * 10, 0x80 * 10).every((x) => x === 0xFF), 'set GPL EF9341: 0x7F e\' il riquadro pieno');
  // i discendenti (g j p q y) usano le righe 8-9, le altre minuscole no
  const desc = 'gjpqy';
  let okDesc = true;
  for (let c = 0x61; c <= 0x7A; c++) {
    const low = e[c * 10 + 8] | e[c * 10 + 9];
    if (desc.includes(String.fromCharCode(c)) !== (low !== 0)) okDesc = false;
  }
  ok(okDesc, 'set GPL EF9341: discendenti solo in g, j, p, q, y');
  // lettere accentate: la lettera di base e' nel glifo (stessa riga centrale) e c'e' un segno sopra
  ok(e[0x12 * 10 + 1] !== 0 && e[0x12 * 10 + 5] === e['e'.charCodeAt(0) * 10 + 5], 'set GPL EF9341: 0x12 (e acuta) = e con segno sopra');
}

console.log(fails ? 'FALLITO: ' + fails + ' controlli su ' + (passes + fails) : 'OK: ' + passes + ' controlli (editor dei caratteri e set GPL)');
process.exit(fails ? 1 : 0);
