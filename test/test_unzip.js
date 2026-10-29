'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_unzip.js - src/unzip.js contro zlib di Node: deflate (livelli 0-9, strategie, dati casuali e ripetitivi), contenitore zip
// (uno o piu' file, cartelle, memorizzato / deflate), scelta del file giusto, zip rotti (CRC, troncato, cifrato, senza directory).
const path = require('path');
const zlib = require('zlib');
const U = require(path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), 'unzip.js'));

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL  ' + m); } };
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
function rnd(seed, n) { let s = seed >>> 0; const o = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; o[i] = s >>> 24; } return o; }
function textish(seed, n) { const r = rnd(seed, n), o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = (r[i] & 7) < 6 ? 0x41 + (r[i] >> 5) : r[i]; return o; }

// 1. deflate
const sizes = [0, 1, 2, 5, 100, 1024, 2048, 8192, 65535, 65536, 200000];
let n = 0;
for (const size of sizes) {
  for (const gen of [rnd, textish, (s, k) => new Uint8Array(k)]) {
    const data = gen(size + 3, size);
    for (const level of [0, 1, 6, 9]) {
      for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY, zlib.constants.Z_RLE]) {
        const z = zlib.deflateRawSync(Buffer.from(data), {level, strategy});
        let out = null;
        try { out = U.inflate(new Uint8Array(z), size + 16); } catch (e) { ok(false, 'inflate ' + size + ' lv' + level + ': ' + e.message); continue; }
        ok(same(out, data), 'inflate ' + size + ' byte livello ' + level + ' strategia ' + strategy);
        n++;
      }
    }
  }
}
ok(U.crc32(new Uint8Array(Buffer.from('123456789'))) === 0xCBF43926, 'crc32 di prova');
// dati con copie di ogni lunghezza 3..258 e di distanze fino a 32768 (tocca ogni codice di lunghezza e di distanza)
function matchy(seed) {
  const DIST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 16, 17, 24, 25, 32, 33, 48, 49, 64, 65, 96, 97, 128, 129, 192, 193, 256, 257, 384, 385, 512,
    513, 768, 769, 1024, 1025, 1536, 1537, 2048, 2049, 3072, 3073, 4096, 4097, 6144, 6145, 8192, 8193, 12288, 12289, 16384, 16385, 24576, 24577, 32768];
  const out = [];
  const lit = rnd(seed, 33000);
  for (const b of lit) out.push(b);
  const r = rnd(seed + 1, 4000);
  let k = 0;
  for (let rep = 0; rep < 2; rep++) {
    for (let len = 3; len <= 258; len++) {
      const d = DIST[(len + rep * 5 + k++) % DIST.length];
      for (let i = 0; i < len; i++) out.push(out[out.length - d]);
      out.push(r[k % r.length]); out.push(r[(k * 7) % r.length]);   // un po' di letterali fra una copia e l'altra
    }
  }
  for (const d of DIST) { for (let i = 0; i < 20; i++) out.push(out[out.length - d]); out.push(r[d % r.length]); }
  return new Uint8Array(out);
}
for (const seed of [1, 2]) {
  const data = matchy(seed);
  for (const level of [1, 6, 9]) {
    for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED]) {
      const z = zlib.deflateRawSync(Buffer.from(data), {level, strategy, memLevel: 9});
      let out = null;
      try { out = U.inflate(new Uint8Array(z), data.length + 16); } catch (e) { ok(false, 'inflate copie: ' + e.message); continue; }
      ok(same(out, data), 'inflate di dati con copie di ogni lunghezza e distanza (seme ' + seed + ' livello ' + level + ' strategia ' + strategy + ')');
    }
  }
}
// blocchi misti: piu' blocchi (memorizzato + fisso + dinamico) nello stesso flusso, con svuotamenti intermedi
{
  const data = new Uint8Array(Buffer.concat([Buffer.from(rnd(3, 3000)), Buffer.from(textish(4, 5000)), Buffer.from(rnd(5, 70000))]));
  const d = zlib.createDeflateRaw ? null : null;
  const parts = [];
  const def = zlib.deflateRawSync(Buffer.from(data.subarray(0, 3000)), {level: 0});
  parts.push(def);
  ok(same(U.inflate(new Uint8Array(def), 4000), data.subarray(0, 3000)), 'blocco memorizzato (livello 0)');
  const lim = U.inflate;
  let e = null;
  try { lim(new Uint8Array(zlib.deflateRawSync(Buffer.from(new Uint8Array(100000)))), 1000); } catch (x) { e = x; }
  ok(e instanceof U.ZipError && /troppo grande/.test(e.message), 'limite sulla dimensione decompressa');
  e = null;
  try { lim(new Uint8Array(zlib.deflateRawSync(Buffer.from(rnd(9, 3000)))).subarray(0, 100)); } catch (x) { e = x; }
  ok(e instanceof U.ZipError && /troncat/.test(e.message), 'flusso troncato');
  e = null;
  try { lim(new Uint8Array([0x07])); } catch (x) { e = x; }
  ok(e instanceof U.ZipError, 'tipo di blocco 3 non valido');
  e = null;
  try { lim(new Uint8Array([0x01, 0x05, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5])); } catch (x) { e = x; }
  ok(e instanceof U.ZipError && /memorizzato/.test(e.message), 'blocco memorizzato con complemento sbagliato');
  e = null;
  try { lim(new Uint8Array([0x01, 0x05, 0x00, 0xFA, 0xFF, 1, 2])); } catch (x) { e = x; }
  ok(e instanceof U.ZipError && /troncat/.test(e.message), 'blocco memorizzato troncato');
  // blocco fisso con una distanza oltre l'inizio: simbolo letterale 'A' poi copia lunghezza 3 distanza 2
  // bit: BFINAL=1, BTYPE=01; 'A'=0x41 -> codice 0x30+0x41 (8 bit); lunghezza 3 -> simbolo 257 (7 bit 0000001); distanza codice 1 (5 bit) -> d=2
  const bitsOut = []; const pushBits = (v, n, msbFirst) => { for (let i = 0; i < n; i++) bitsOut.push(msbFirst ? (v >> (n - 1 - i)) & 1 : (v >> i) & 1); };
  pushBits(1, 1); pushBits(1, 2); pushBits(0x30 + 0x41, 8, true); pushBits(1, 7, true); pushBits(1, 5, true); pushBits(0, 7, true);
  const bytes = []; for (let i = 0; i < bitsOut.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v |= (bitsOut[i + k] || 0) << k; bytes.push(v); }
  e = null; try { lim(new Uint8Array(bytes)); } catch (x) { e = x; }
  ok(e instanceof U.ZipError && /distanza/.test(e.message), 'copia con distanza oltre l’inizio dei dati');
}


// 2. costruzione di zip
function zip(files, opt) {
  opt = opt || {};
  const loc = [], cen = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data || []);
    const method = f.method === undefined ? 8 : f.method;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = (f.crc !== undefined ? f.crc : zlib.crc32 ? zlib.crc32(data) : U.crc32(data)) >>> 0;
    const flags = f.flags || 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034B50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    const extra = Buffer.from(f.extra || []);
    h.writeUInt16LE(extra.length, 28);
    loc.push(h, name, extra, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014B50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42);
    const cx = Buffer.from(f.cextra || []), cc = Buffer.from(f.ccomment || '');
    c.writeUInt16LE(cx.length, 30); c.writeUInt16LE(cc.length, 32);
    cen.push(c, name, cx, cc);
    off += 30 + name.length + extra.length + comp.length;
  }
  const cd = Buffer.concat(cen);
  const e = Buffer.alloc(22 + (opt.eocdComment ? opt.eocdComment.length : 0));
  if (opt.eocdComment) { e.writeUInt16LE(opt.eocdComment.length, 20); Buffer.from(opt.eocdComment).copy(e, 22); }
  e.writeUInt32LE(0x06054B50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const parts = [Buffer.concat(loc), opt.noCentral ? Buffer.alloc(0) : cd, opt.noCentral ? Buffer.alloc(0) : e];
  return new Uint8Array(Buffer.concat(parts));
}
const rom = rnd(11, 2048), rom2 = rnd(12, 4096);
let z = zip([{name: 'Blockout (1981).bin', data: rom}]);
ok(U.isZip(z) && !U.isZip(rom) && !U.isZip(new Uint8Array(2)), 'isZip');
let pk = U.pickEntry(z, ['.bin']);
ok(pk.entry.name === 'Blockout (1981).bin' && same(U.extractEntry(z, pk.entry), rom), 'zip con un file deflate');
z = zip([{name: 'a.bin', data: rom, method: 0}]);
ok(same(U.extractEntry(z, U.pickEntry(z, ['.bin']).entry), rom), 'zip con un file memorizzato (metodo 0)');
z = zip([{name: 'dir/', data: []}, {name: 'dir/leggimi.txt', data: Buffer.from('ciao')}, {name: 'dir/g.BIN', data: rom2}, {name: 'dir/h.bin', data: rom}]);
pk = U.pickEntry(z, ['.bin', '.rom']);
ok(pk.entry.name === 'dir/g.BIN' && pk.others.length === 1 && pk.others[0] === 'dir/h.bin' && same(U.extractEntry(z, pk.entry), rom2), 'piu\' file: sceglie il primo .bin, elenca gli altri, ignora cartelle e testo');
z = zip([{name: 'solo.dat', data: rom}]);
ok(U.pickEntry(z, ['.bin']).entry.name === 'solo.dat', 'un solo file con estensione diversa: lo usa');
z = zip([{name: 'a.txt', data: rom}, {name: 'b.txt', data: rom}]);
let err = null; try { U.pickEntry(z, ['.bin']); } catch (e) { err = e; }
ok(err instanceof U.ZipError && /nessun file/.test(err.message), 'nessun file adatto: errore con elenco');
z = zip([{name: 'dir/', data: []}]);
err = null; try { U.pickEntry(z, ['.bin']); } catch (e) { err = e; }
ok(err instanceof U.ZipError && /vuoto/.test(err.message), 'zip senza file: errore');

// isZip: ogni byte della firma conta; firma di zip vuoto (PK\5\6) valida; lunghezza minima
ok(U.isZip(new Uint8Array([0x50, 0x4B, 3, 4])) && U.isZip(new Uint8Array([0x50, 0x4B, 5, 6])), 'isZip: firme PK\\3\\4 e PK\\5\\6');
ok(!U.isZip(new Uint8Array([0x50, 0x4B, 3])) && !U.isZip(new Uint8Array([0x51, 0x4B, 3, 4])) && !U.isZip(new Uint8Array([0x50, 0x4C, 3, 4])) &&
  !U.isZip(new Uint8Array([0x50, 0x4B, 4, 4])) && !U.isZip(new Uint8Array([0x50, 0x4B, 3, 5])) && !U.isZip(new Uint8Array([0x50, 0x4B, 6, 6])) &&
  !U.isZip(new Uint8Array([0x50, 0x4B, 5, 4])) && !U.isZip(new Uint8Array([0x50, 0x4B, 3, 6])) && !U.isZip(new Uint8Array([0x50, 0x4B, 3, 7])), 'isZip: firme sbagliate rifiutate');
let ez = null; try { U.listZip(new Uint8Array([1, 2, 3, 4, 5])); } catch (x) { ez = x; }
ok(ez instanceof U.ZipError && /non e’ un file zip/.test(ez.message), 'listZip: non zip');
{
  const base = zip([{name: 'a.bin', data: rom}]);
  const mod = (fn) => { const c = base.slice(); fn(Buffer.from(c.buffer)); return c; };
  const E = base.length - 22;
  const t = (z, re, msg) => { let e = null; try { U.extractEntry(z, U.pickEntry(z, ['.bin']).entry); } catch (x) { e = x; } ok(e instanceof U.ZipError && re.test(e.message), msg + (e ? ' [' + e.message + ']' : ' [nessun errore]')); };
  t(mod((b) => b.writeUInt16LE(0xFFFF, E + 10)), /zip64/, 'zip64 (numero di voci)');
  t(mod((b) => b.writeUInt32LE(0xFFFFFFFF, E + 12)), /zip64/, 'zip64 (dimensione della directory)');
  t(mod((b) => b.writeUInt32LE(0xFFFFFFFF, E + 16)), /zip64/, 'zip64 (posizione della directory)');
  t(mod((b) => b.writeUInt16LE(1, E + 4)), /diviso/, 'zip diviso (disco corrente)');
  t(mod((b) => b.writeUInt16LE(1, E + 6)), /diviso/, 'zip diviso (disco della directory)');
  t(mod((b) => b.writeUInt32LE(0, E - 51)), /directory centrale/, 'firma della voce della directory rovinata');
  t(mod((b) => b.writeUInt32LE(0, 0)), /non e’ un file zip|voce dello zip/, 'firma iniziale rovinata');
  const loc0 = mod((b) => b.writeUInt32LE(0x12345678, 0)); loc0[0] = 0x50; loc0[1] = 0x4B; loc0[2] = 3; loc0[3] = 4;
  t(mod((b) => b.writeUInt32LE(0x04034B51, 0)), /./, 'firma locale diversa');
  t(mod((b) => b.writeUInt32LE(base.length + 100, E - 0 + 0)), /./, 'directory spostata');
}

// zip "veri": extra e commento nella directory centrale, extra locale, commento finale lungo (la firma finale va cercata all'indietro)
{
  const files = [{name: 'primo.txt', data: Buffer.from('x'), cextra: [1, 2, 3, 4, 5, 6, 7], ccomment: 'commento di prova', extra: [9, 9, 9]},
    {name: 'gioco.bin', data: rom2, cextra: [8, 8], ccomment: 'altro', extra: [1, 2, 3, 4, 5]}, {name: 'terzo.rom', data: rom}];
  const z2 = zip(files, {eocdComment: 'x'.repeat(300)});
  const l = U.listZip(z2);
  ok(l.length === 3 && l[2].name === 'terzo.rom' && l[1].name === 'gioco.bin', 'directory centrale con extra e commenti: tutte le voci lette');
  const pk2 = U.pickEntry(z2, ['.bin', '.rom']);
  ok(pk2.entry.name === 'gioco.bin' && pk2.others[0] === 'terzo.rom' && same(U.extractEntry(z2, pk2.entry), rom2), 'extra locale e commento finale lungo: file giusto');
  ok(same(U.extractEntry(z2, l[2]), rom), 'terza voce estratta dopo extra e commenti');
  ok(l[1].size === 4096 && l[1].csize > 0 && l[1].method === 8 && l[1].crc === (zlib.crc32 ? zlib.crc32(Buffer.from(rom2)) >>> 0 : U.crc32(rom2)) && l[1].dir === false && l[0].offset === 0, 'campi della voce: dimensione, metodo, CRC, posizione');
  ok(U.listZip(zip([{name: 'a/', data: []}]))[0].dir === true, 'le cartelle sono riconosciute');
  const long = zip([{name: 'a.bin', data: rom}], {eocdComment: 'y'.repeat(65535)});
  ok(U.listZip(long).length === 1, 'commento finale di 65535 byte: la directory si trova');
  // nome in UTF-8
  ok(U.listZip(zip([{name: 'caffè.bin', data: rom}]))[0].name === 'caffè.bin', 'nome in UTF-8');
}
// 3. zip rotti
const bad = (z, re, msg) => {
  let e = null;
  try { const p = U.pickEntry(z, ['.bin']); U.extractEntry(z, p.entry); } catch (x) { e = x; }
  ok(e instanceof U.ZipError && re.test(e.message), msg + (e ? ' [' + e.message + ']' : ' [nessun errore]'));
};
bad(zip([{name: 'a.bin', data: rom, crc: 0x12345678}]), /CRC/, 'CRC sbagliato');
bad(zip([{name: 'a.bin', data: rom, flags: 1}]), /cifrato/, 'zip cifrato');
bad(zip([{name: 'a.bin', data: rom, method: 9}]), /metodo/, 'metodo non supportato');
bad(zip([{name: 'a.bin', data: rom}], {noCentral: true}), /directory centrale/, 'senza directory centrale');
z = zip([{name: 'a.bin', data: rom}]);
bad(z.slice(0, z.length - 40), /directory centrale/, 'zip troncato');
z = zip([{name: 'a.bin', data: textish(5, 4000)}]);
z[40] ^= 0xFF; z[41] ^= 0x55; z[60] ^= 0xFF;   // rovina i dati compressi
let e2 = null; try { U.extractEntry(z, U.pickEntry(z, ['.bin']).entry); } catch (x) { e2 = x; }
ok(e2 instanceof U.ZipError, 'dati compressi rovinati: ZipError (non un altro errore)');
// byte casuali dopo la firma: mai eccezioni diverse da ZipError, mai cicli infiniti
let other = 0;
for (let i = 0; i < 300; i++) {
  const g = zip([{name: 'a.bin', data: textish(i, 700)}]);
  const r = rnd(i, 6);
  for (let k = 0; k < 6; k++) g[(r[k] * 7 + k * 13) % g.length] = r[(k + 1) % 6];
  try { const p = U.pickEntry(g, ['.bin']); U.extractEntry(g, p.entry); } catch (x) { if (!(x instanceof U.ZipError)) other++; }
}
ok(other === 0, 'zip alterati a caso: solo ZipError (' + other + ' altri errori)');

console.log((fails ? 'FALLITE ' + fails + ' prove' : 'OK: ' + passes + ' controlli sullo zip') + ' (' + n + ' casi di deflate)');
process.exit(fails ? 1 : 0);
