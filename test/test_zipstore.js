'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_zipstore.js - scrittura di zip "memorizzati": andata e ritorno con unzip.js, controllo con gli strumenti del sistema (Python
// zipfile, unzip -t) se ci sono, determinismo, rifiuto di voci non valide. Nessun dump.
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const {zipStore} = require(SP('zipstore.js'));
const {listZip, extractEntry, crc32, isZip} = require(SP('unzip.js'));

let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
function throws(f, m) { checks++; try { f(); fails++; console.log('FAIL (non ha rifiutato) ' + m); } catch (e) { /* ok */ } }
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

let s = 7;
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const bytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b; };

const sets = [
  [],
  [{name: 'a.txt', data: new Uint8Array(0)}],
  [{name: 'uno.bin', data: bytes(1)}, {name: 'cartelle/due/tre.bin', data: bytes(2048)}, {name: 'è/ünïcode/à.bin', data: bytes(300)}],
  Array.from({length: 40}, (_, i) => ({name: 'f' + i + '.dat', data: bytes(Math.floor(rnd() * 5000))})),
  [{name: 'grande.bin', data: bytes(3 * 1024 * 1024)}],
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-'));
const hasPy = cp.spawnSync('python3', ['-c', '1']).status === 0;
const hasUnzip = cp.spawnSync('unzip', ['-v']).status === 0;
sets.forEach((set, k) => {
  const z = zipStore(set);
  ok(isZip(z) || set.length === 0, 'firma ' + k);
  const z2 = zipStore(set);
  ok(eq(z, z2), 'determinismo ' + k);
  const l = set.length ? listZip(z) : listZip(z);
  ok(l.length === set.length, 'numero voci ' + k);
  l.forEach((e, i) => {
    ok(e.name === set[i].name && e.method === 0 && e.size === set[i].data.length, 'voce ' + k + '.' + i);
    ok(eq(extractEntry(z, e), set[i].data), 'contenuto ' + k + '.' + i);
  });
  const f = path.join(tmp, 's' + k + '.zip');
  fs.writeFileSync(f, z);
  if (hasPy) {
    const r = cp.spawnSync('python3', ['-I', '-X', 'utf8', '-c',
      'import zipfile,sys,zlib\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nfor i in z.infolist():\n print(i.filename, i.file_size, i.compress_type, zlib.crc32(z.read(i))&0xffffffff, i.flag_bits)\n', f], {encoding: 'utf8'});
    ok(r.status === 0, 'python zipfile ' + k + ' ' + r.stderr);
    const lines = r.stdout.trim().split(/\r?\n/).filter(Boolean);   // \r\n su Windows
    ok(lines.length === set.length, 'python: numero voci ' + k);
    lines.forEach((ln, i) => {
      if (i >= set.length) return;
      const m = ln.match(/^(.*) (\d+) (\d+) (\d+) (\d+)$/);
      ok(m && m[1] === set[i].name && +m[2] === set[i].data.length && +m[3] === 0 && +m[4] === crc32(set[i].data), 'python: voce ' + k + '.' + i);
    });
  }
  if (hasUnzip && set.length) {
    const r = cp.spawnSync('unzip', ['-tq', f], {encoding: 'utf8'});
    ok(r.status === 0, 'unzip -t ' + k + ' ' + r.stdout + r.stderr);
  }
});
// data personalizzata
{
  const z = zipStore([{name: 'x', data: bytes(3)}], new Date(2030, 5, 15, 13, 45, 30));
  ok(z.length > 0 && listZip(z).length === 1, 'data personalizzata');
}

// ---- controllo byte per byte con un lettore indipendente di intestazioni (ogni campo, senza passare da unzip.js)
function rawCheck(z, set, when, label) {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const e = z.length - 22;
  ok(dv.getUint32(e, true) === 0x06054B50 && dv.getUint16(e + 4, true) === 0 && dv.getUint16(e + 6, true) === 0 && dv.getUint16(e + 8, true) === set.length &&
     dv.getUint16(e + 10, true) === set.length && dv.getUint16(e + 20, true) === 0, label + ': fine della directory centrale');
  const cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  const enc = new TextEncoder();
  let p = cdOff, lp = 0, namesLen = 0, dataLen = 0;
  ok(cdOff + cdSize === e, label + ': directory centrale subito prima della fine');
  const dosDate = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  set.forEach((en, i) => {
    const nm = enc.encode(en.name), crc = crc32(en.data);
    // intestazione locale
    ok(dv.getUint32(lp, true) === 0x04034B50 && dv.getUint16(lp + 4, true) === 20 && dv.getUint16(lp + 6, true) === 0x0800 && dv.getUint16(lp + 8, true) === 0 &&
       dv.getUint16(lp + 10, true) === dosTime && dv.getUint16(lp + 12, true) === dosDate && dv.getUint32(lp + 14, true) === crc &&
       dv.getUint32(lp + 18, true) === en.data.length && dv.getUint32(lp + 22, true) === en.data.length && dv.getUint16(lp + 26, true) === nm.length &&
       dv.getUint16(lp + 28, true) === 0, label + ': intestazione locale ' + i);
    ok(eq(z.subarray(lp + 30, lp + 30 + nm.length), nm) && eq(z.subarray(lp + 30 + nm.length, lp + 30 + nm.length + en.data.length), en.data), label + ': nome e dati ' + i);
    // voce della directory centrale
    ok(dv.getUint32(p, true) === 0x02014B50 && dv.getUint16(p + 4, true) === 20 && dv.getUint16(p + 6, true) === 20 && dv.getUint16(p + 8, true) === 0x0800 &&
       dv.getUint16(p + 10, true) === 0 && dv.getUint16(p + 12, true) === dosTime && dv.getUint16(p + 14, true) === dosDate && dv.getUint32(p + 16, true) === crc &&
       dv.getUint32(p + 20, true) === en.data.length && dv.getUint32(p + 24, true) === en.data.length && dv.getUint16(p + 28, true) === nm.length &&
       dv.getUint16(p + 30, true) === 0 && dv.getUint16(p + 32, true) === 0 && dv.getUint16(p + 34, true) === 0 && dv.getUint16(p + 36, true) === 0 &&
       dv.getUint32(p + 38, true) === 0 && dv.getUint32(p + 42, true) === lp, label + ': voce centrale ' + i);
    ok(eq(z.subarray(p + 46, p + 46 + nm.length), nm), label + ': nome nella directory centrale ' + i);
    p += 46 + nm.length;
    lp += 30 + nm.length + en.data.length;
  });
  ok(lp === cdOff && p === e, label + ': nessun buco fra le parti');
}
{
  const set = [{name: 'uno.bin', data: bytes(10)}, {name: 'dir/è.bin', data: new Uint8Array(0)}, {name: 'tre', data: bytes(1000)}];
  rawCheck(zipStore(set), set, new Date(2026, 0, 1, 0, 0, 0), 'data fissa');
  for (const d of [new Date(2030, 5, 15, 13, 45, 30), new Date(2031, 11, 31, 23, 59, 59), new Date(1999, 1, 28, 1, 2, 3), new Date(2026, 9, 12, 12, 0, 1)]) {
    rawCheck(zipStore(set, d), set, d, 'data ' + d.toISOString());
  }
  // anni fuori dal formato DOS: si porta all'intervallo 1980-2107
  const lo = zipStore(set, new Date(1970, 0, 1, 0, 0, 0)), hi = zipStore(set, new Date(2200, 0, 1, 0, 0, 0));
  rawCheck(lo, set, new Date(1980, 0, 1, 0, 0, 0), 'anno 1970 -> 1980');
  rawCheck(hi, set, new Date(2107, 0, 1, 0, 0, 0), 'anno 2200 -> 2107');
  rawCheck(zipStore(set, new Date(1980, 0, 1, 0, 0, 0)), set, new Date(1980, 0, 1, 0, 0, 0), 'anno 1980');
  rawCheck(zipStore(set, new Date(2107, 11, 31, 23, 59, 58)), set, new Date(2107, 11, 31, 23, 59, 58), 'anno 2107');
  if (hasPy) {
    const f = path.join(tmp, 'dt.zip');
    fs.writeFileSync(f, zipStore(set, new Date(2030, 5, 15, 13, 45, 30)));
    const r = cp.spawnSync('python3', ['-I', '-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.infolist()[0].date_time)', f], {encoding: 'utf8'});
    ok(r.stdout.trim() === '(2030, 6, 15, 13, 45, 30)', 'Python legge la data: ' + r.stdout.trim());
    fs.writeFileSync(f, zipStore(set));
    const r2 = cp.spawnSync('python3', ['-I', '-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.infolist()[0].date_time)', f], {encoding: 'utf8'});
    ok(r2.stdout.trim() === '(2026, 1, 1, 0, 0, 0)', 'Python legge la data fissa: ' + r2.stdout.trim());
  }
}
// ---- limiti: 65535 voci si scrivono (la fine della directory dice 65535), 65536 no; nome di 65535 byte si', di 65536 no
{
  const many = Array.from({length: 65535}, (_, i) => ({name: String(i), data: new Uint8Array(0)}));
  const z = zipStore(many);
  const e = z.length - 22;
  ok(new DataView(z.buffer).getUint16(e + 8, true) === 65535 && new DataView(z.buffer).getUint16(e + 10, true) === 65535, '65535 voci');
  many.push({name: 'x', data: new Uint8Array(0)});
  throws(() => zipStore(many), '65536 voci');
  const longOk = zipStore([{name: 'a'.repeat(65535), data: new Uint8Array(1)}]);
  ok(new DataView(longOk.buffer).getUint16(26, true) === 65535, 'nome di 65535 byte');
  throws(() => zipStore([{name: 'a'.repeat(65536), data: new Uint8Array(1)}]), 'nome di 65536 byte');
  throws(() => zipStore([{name: 'è'.repeat(32768), data: new Uint8Array(1)}]), 'nome di 65536 byte in UTF-8 (32768 caratteri)');
  // oltre 4 GB: dato finto con lunghezza enorme (non si alloca niente: si rifiuta prima dei CRC)
  const fake = Object.create(Uint8Array.prototype);
  Object.defineProperty(fake, 'length', {value: 0xFFFFFFFF});
  let msg = '';
  try { zipStore([{name: 'x', data: fake}]); } catch (err) { msg = err.message; }
  ok(/4 GB/.test(msg), 'oltre 4 GB rifiutato: ' + msg);
}
// ---- voci non valide, una per una
throws(() => zipStore([{name: 'a'}]), 'voce senza dati');
throws(() => zipStore([{data: new Uint8Array(1)}]), 'voce senza nome');
throws(() => zipStore([{name: 5, data: new Uint8Array(1)}]), 'nome non testo');
throws(() => zipStore([{name: 'a', data: null}]), 'dati nulli');
throws(() => zipStore([{name: 'a', data: 'testo'}]), 'dati testo');
throws(() => zipStore(null), 'elenco nullo');
{
  let msg = '';
  try { zipStore([{name: 'doppio.bin', data: new Uint8Array(1)}, {name: 'doppio.bin', data: new Uint8Array(1)}]); } catch (err) { msg = err.message; }
  ok(msg === 'nome duplicato nello zip: doppio.bin', 'messaggio del nome duplicato: ' + msg);
}
throws(() => zipStore([{name: 'a', data: new Uint8Array(1)}, {name: 'a', data: new Uint8Array(1)}]), 'nome duplicato');
throws(() => zipStore([{name: '', data: new Uint8Array(1)}]), 'nome vuoto');
throws(() => zipStore([{name: 'a', data: [1, 2]}]), 'dati non Uint8Array');
throws(() => zipStore([null]), 'voce nulla');
throws(() => zipStore('x'), 'non e un array');
throws(() => zipStore([{name: 'a'.repeat(70000), data: new Uint8Array(1)}]), 'nome troppo lungo');
fs.rmSync(tmp, {recursive: true, force: true});
console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)');
process.exit(fails ? 1 : 0);
