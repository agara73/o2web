'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// ef_run.js FILE.json - rigioca su src/ef934x.js le sequenze casuali registrate da ef_record.py (riferimento hw/ef934x_ref.py) e
// confronta ogni lettura, ogni linea resa (crc32), ogni mixer / CX e lo stato finale; poi prova salva / ricarica dello stato.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {EfPair, mixLine, cxCollisions} = require(process.env.O2_EF_PATH || path.join(__dirname, '..', 'src', 'ef934x.js'));

const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0, nops = 0;
cases.forEach((c, ci) => {
  const m = new EfPair(hex(c.rom), {offsetX: c.ox, offsetY: c.oy});
  const line = new Uint8Array(320);
  let err = null, lastEf = null, oi = 0;
  for (const op of c.ops) {
    nops++;
    oi++;
    const k = op[0];
    if (k === 'a') {
      const r = m.access(op[1], op[2], !!op[3]);
      if (r !== op[4]) err = 'accesso #' + oi + ' addr ' + op[1] + ': modello ' + op[4] + ' JS ' + r;
    } else if (k === 'f') m.frameTick();
    else if (k === 'z') m.reset();
    else if (k === 'l') {
      m.renderLine(op[1], line);
      lastEf = Uint8Array.from(line);
      const crc = zlib.crc32(line);
      if (crc !== op[2]) err = 'linea tl=' + op[1] + ' (op #' + oi + ') diversa';
    } else if (k === 'x') {
      const row = hex(op[1]), ef = op[2] === null ? null : hex(op[2]), cx = new Uint8Array(360);
      mixLine(row, ef, op[7], op[3], op[4], !!op[5], !!op[6], cx);
      if (zlib.crc32(row) !== op[10]) err = 'mixer #' + oi + ': uscita diversa';
      else if (zlib.crc32(cx) !== op[11]) err = 'mixer #' + oi + ': CX diverso';
      else {
        const r = cxCollisions(hex(op[8]), cx, op[9]);
        if ((r & 0xFF) !== op[12] || ((r >> 8) & 1) !== op[13]) err = 'CX collisioni #' + oi + ': modello ' + op[12] + '/' + op[13] + ' JS ' + (r & 0xFF) + '/' + (r >> 8);
      }
    }
    if (err) break;
  }
  if (!err) {
    const f = c.final, g = {ta: m.ta, tb: m.tb, x: m.x, y: m.y, y0: m.y0, m: m.m, r: m.r, parity: m.parity, pre: m.flPrescaler, ph: m.flPhase,
      crcA: zlib.crc32(m.ramA), crcB: zlib.crc32(m.ramB), crcX: zlib.crc32(m.exram)};
    for (const key of Object.keys(f)) if (f[key] !== g[key]) { err = 'stato finale: ' + key + ' modello ' + f[key] + ' JS ' + g[key]; break; }
  }
  if (!err) {                                    // andata e ritorno dello stato (e continuazione identica)
    const s = JSON.parse(JSON.stringify(m.saveState()));
    const m2 = new EfPair(hex(c.rom), {offsetX: c.ox, offsetY: c.oy});
    m2.loadState(s);
    if (JSON.stringify(m2.saveState()) !== JSON.stringify(s)) err = 'stato ricaricato: saveState diverso subito dopo loadState';
    const a = new Uint8Array(320), b = new Uint8Array(320);
    for (let tl = 0; tl < 262 && !err; tl++) {
      m.renderLine(tl, a); m2.renderLine(tl, b);
      if (Buffer.compare(Buffer.from(a), Buffer.from(b))) err = 'stato ricaricato: linea ' + tl + ' diversa';
    }
    m.frameTick(); m2.frameTick();
    if (!err && JSON.stringify(m.saveState()) !== JSON.stringify(m2.saveState())) err = 'stato ricaricato: stato diverso dopo un quadro';
  }
  if (err) { bad++; console.log('CASO ' + ci + ' FALLITO: ' + err); }
});
// stati falsi o corrotti: rifiutati e senza toccare lo stato (caricamento atomico)
{
  const m = new EfPair(new Uint8Array(2560)), good = JSON.parse(JSON.stringify(m.saveState()));
  m.access(0, 7, true); m.access(1, 0x41, true);
  const before = JSON.stringify(m.saveState());
  const bads = [null, 5, 'x', [], {}];
  const mut = (k, v) => Object.assign({}, good, {[k]: v});
  for (const k of ['ta', 'tb', 'x', 'y', 'y0', 'm', 'r', 'parity', 'flPrescaler', 'flPhase']) bads.push(mut(k, -1), mut(k, 1000), mut(k, 1.5), mut(k, '1'), mut(k, undefined));
  bads.push(mut('x', 64), mut('y', 32), mut('y0', 64), mut('parity', 2), mut('flPhase', 2), mut('flPrescaler', 60), mut('ta', 256), mut('m', 256), mut('r', 256));
  for (const k of ['ramA', 'ramB', 'exram']) {
    const len = good[k].length;
    bads.push(mut(k, good[k].slice(2)), mut(k, good[k] + '00'), mut(k, 'g'.repeat(len)), mut(k, good[k].toUpperCase().replace(/0/g, 'G')), mut(k, 7), mut(k, null));
  }
  bads.push(Object.assign({}, good, {r: 255, ramA: good.ramA.slice(2)}));    // una parte valida e una no: nulla deve cambiare
  bads.forEach((b, i) => {
    let threw = false;
    try { m.loadState(b); } catch (e) { threw = true; }
    if (!threw) { bad++; console.log('stato falso #' + i + ' ACCETTATO: ' + JSON.stringify(b).slice(0, 80)); }
    else if (JSON.stringify(m.saveState()) !== before) { bad++; console.log('stato falso #' + i + ' ha modificato lo stato'); }
  });
  const ex = ['ROM corta', () => new EfPair(new Uint8Array(2559))], ex2 = ['ROM lunga', () => new EfPair(new Uint8Array(2561))], ex3 = ['ROM nulla', () => new EfPair(null)];
  for (const [n, f] of [ex, ex2, ex3]) { let t = false; try { f(); } catch (e) { t = true; } if (!t) { bad++; console.log(n + ' ACCETTATA'); } }
  const d = new EfPair(new Uint8Array(2560));
  const z = d.saveState();
  for (const k of ['ta', 'tb', 'x', 'y', 'y0', 'm', 'r', 'parity', 'flPrescaler', 'flPhase']) if (z[k] !== 0) { bad++; console.log('stato a riposo: ' + k + ' = ' + z[k]); }
  if (d.offsetX !== 15 || d.offsetY !== 5) { bad++; console.log('spostamenti predefiniti diversi da 15 e 5'); }
  const rs = new EfPair(new Uint8Array(2560));
  rs.access(2, 0x49, true); rs.access(3, 0xA0, true);
  const st = rs.saveState();
  if (st.r !== 0x49) { bad++; console.log('caricamento di R (TA=0x49, TB=0xA0 ai MOVX 2 e 3) fallito: ' + st.r); }
}
if (bad) { console.log('ef_run: ' + bad + ' casi su ' + cases.length + ' DIVERSI'); process.exit(1); }
console.log('ef_run: ' + cases.length + ' casi, ' + nops + ' operazioni IDENTICHE al riferimento');
