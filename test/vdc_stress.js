'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// vdc_stress.js FILE.json - rigioca sul chip video JS (src/vdc.js) le sequenze casuali registrate da vdc_stress.py e confronta
// ogni evento video (indice, collisioni, crc32 della riga), ogni lettura, i registri finali e lo schermo, e (tappa 3) il log del suono
// (ciclo, livello di uscita a ogni cambio) e lo stato finale del suono (indice, prescaler, scorrimento pendente / scritto, contatore,
// uscita, /INT, stato).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {Vdc} = require(process.env.O2_VDC_PATH || path.join(__dirname, '..', 'src', 'vdc.js'));

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0, nev = 0, nops = 0, nsnd = 0;
cases.forEach((c, ci) => {
  const cs = Uint8Array.from(Buffer.from(c.charset, 'hex'));
  const v = new Vdc(cs, c.std);
  let li = 0, err = null;
  v.lineHook = (k, j, st) => {
    if (err) return;
    const e = c.events[li];
    const crc = j >= 0 ? zlib.crc32(v.fb.subarray(j * 360, (j + 1) * 360)) : 0;
    if (!e || e[0] !== k || e[1] !== (st >>> 0) || e[2] !== crc) {
      err = 'evento #' + li + ' diverso: modello ' + JSON.stringify(e) + ' JS ' + JSON.stringify([k, st >>> 0, crc]) + ' (riga ' + j + ')';
    }
    li++;
  };
  const snd = [];
  v.sndHook = (cyc, lvl) => snd.push([cyc, lvl]);
  const adv = (cyc) => { if (!err) v.advanceTo(cyc); };
  for (const op of c.ops) {
    if (err) break;
    const [kind, cyc, off, val] = op;
    adv(cyc);
    nops++;
    if (kind === 'w') v.write(off, val, cyc);
    else {
      const r = v.read(off, cyc);
      if (r !== val) err = 'lettura 0x' + off.toString(16) + ' al ciclo ' + cyc + ': modello ' + val + ' JS ' + r;
    }
  }
  adv(c.total);
  if (!err && li !== c.events.length) err = 'eventi: modello ' + c.events.length + ' JS ' + li;
  if (!err && Buffer.from(v.reg).toString('hex') !== c.regs) err = 'registri finali diversi';
  if (!err && v.frameDone !== c.frame_done) err = 'frameDone ' + v.frameDone + ' invece di ' + c.frame_done;
  if (!err && zlib.crc32(v.fb) !== c.fb_crc) err = 'schermo finale diverso';
  if (!err && JSON.stringify(snd) !== JSON.stringify(c.snd)) {
    let i = 0;
    while (i < snd.length && i < c.snd.length && snd[i][0] === c.snd[i][0] && snd[i][1] === c.snd[i][1]) i++;
    err = 'log del suono diverso al cambio #' + i + ': modello ' + JSON.stringify(c.snd[i]) + ' JS ' + JSON.stringify(snd[i]) + ' (' + c.snd.length + ' contro ' + snd.length + ')';
  }
  if (!err) {
    const q = v.saveState().snd, js = [q.sn, q.prescaler, q.pending, q.written, q.count, q.output, v.irq ? 1 : 0, v.ctlStatus];
    if (JSON.stringify(js) !== JSON.stringify(c.snd_state)) err = 'stato finale del suono: modello ' + JSON.stringify(c.snd_state) + ' JS ' + JSON.stringify(js);
  }
  nev += li;
  nsnd += snd.length;
  if (err) { bad++; console.log('caso ' + ci + ' (' + c.std + '): ' + err); }
});
if (bad) { console.log('FALLITI ' + bad + ' casi su ' + cases.length); process.exit(1); }
console.log('OK: ' + cases.length + ' casi, ' + nev + ' eventi video, ' + nsnd + ' cambi del livello del suono, ' + nops + ' operazioni coincidono col modello');
