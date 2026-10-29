'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// line_run.js DIR DUMPS [nome,nome]  - console JavaScript (src/console.js + vdc.js + cpu8048.js) contro il modello per riga
// (hw/o2line.py) registrato da line_record.py. Confronta: lo stato della CPU dopo OGNI istruzione (hash), ogni evento video
// (indice, stato delle collisioni / dello stato video, crc32 della riga disegnata) e alla fine lo schermo e i registri del video.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {Console} = require(process.env.O2_CONSOLE_PATH || path.join(__dirname, '..', 'src', 'console.js'));
const {checksum, hashVec} = require('./lib_case.js');
const charsetOwn = require('../hw/charset_own.js');

function cpuVec(c, op, cyc) {
  return [op, cyc, c.pc, c.a, c.psw, c.f1, c.a11 ? 1 : 0, c.timer, c.prescaler, c.tf, c.tirqEn, c.xirqEn, c.inProgress,
    c.timerPend, c.timerEn, c.counterEn, c.p1, c.p2, c.bus, c.exp[0], c.exp[1], c.exp[2], c.exp[3], c.now, c.t1Prev,
    checksum(c.ram)];
}
const u32 = (file) => { const b = fs.readFileSync(file); return new Uint32Array(b.buffer, b.byteOffset, b.length >> 2); };
const hex = (a) => Array.from(a, (v) => v.toString(16).padStart(2, '0')).join('');

function runScenario(dir, dumps, meta) {
  const bios = new Uint8Array(fs.readFileSync(path.join(dumps, meta.bios)));
  const cart = meta.cart ? new Uint8Array(fs.readFileSync(path.join(dumps, meta.cart))) : null;
  const opts = {bios, cart, charset: new Uint8Array(charsetOwn.build()), standard: meta.std};
  if (meta.g7400) {                                  // tappa 5: Videopac+ G7400 con la ROM di prova dell'EF9341 registrata dal modello
    opts.g7400 = true;
    opts.efRom = new Uint8Array(fs.readFileSync(path.join(dir, meta.name + '.efrom')));
    opts.cartBHigh = !!meta.pinB;
  }
  const con = new Console(opts);
  const dig = u32(path.join(dir, meta.name + '.dig')), lines = u32(path.join(dir, meta.name + '.lines'));
  const sndRef = fs.existsSync(path.join(dir, meta.name + '.snd')) ? u32(path.join(dir, meta.name + '.snd')) : null;
  const snd = [];
  con.vdc.sndHook = (cyc, lvl) => snd.push(cyc >>> 0, lvl);
  let li = 0, err = null, step = 0;
  con.vdc.lineHook = (k, j, st) => {
    if (err) return;
    const b = li * 3;
    if (b + 2 >= lines.length) { err = 'evento video in piu\' (#' + li + ')'; return; }
    const crc = j >= 0 ? zlib.crc32(con.fb.subarray(j * 360, (j + 1) * 360)) : 0;
    if (lines[b] !== k || lines[b + 1] !== (st >>> 0) || lines[b + 2] !== crc) {
      err = 'evento video #' + li + ' diverso: riferimento [k,stato,crc]=' + [lines[b], lines[b + 1], lines[b + 2]] + ' JS=' + [k, st >>> 0, crc] +
        ' (riga ' + j + ', istruzione #' + step + ', now ' + con.cpu.now + ')';
    }
    li++;
  };
  const cpu = con.cpu;
  const fc = con.frameCycles;
  for (let fr = 0; fr < meta.frames && !err; fr++) {
    con.keyRows.set(meta.inputs[fr][0]);
    con.joy.set(meta.inputs[fr][1]);
    const end = cpu.now + fc;
    while (cpu.now < end) {
      const cyc = cpu.step();
      if (step >= dig.length) { err = 'istruzioni in piu\' del riferimento'; break; }
      if (hashVec(cpuVec(cpu, cpu.lastOp, cyc)) !== dig[step]) {
        err = 'stato CPU diverso dopo l\'istruzione #' + step + ' (opcode ' + cpu.lastOp.toString(16) + ', PC ' + cpu.pc.toString(16) + ', now ' + cpu.now + ', fotogramma ' + fr + ')';
        break;
      }
      step++;
      if (err) break;
    }
  }
  if (!err && step !== meta.steps) err = 'istruzioni ' + step + ' contro ' + meta.steps;
  if (!err && li * 3 !== lines.length) err = 'eventi video ' + li + ' contro ' + lines.length / 3;
  if (!err && sndRef) {
    let i = 0;
    while (i < snd.length && i < sndRef.length && snd[i] === sndRef[i]) i++;
    if (i !== snd.length || i !== sndRef.length) err = 'log del suono diverso (cambio #' + (i >> 1) + ': riferimento ' + (sndRef.length >> 1) + ' cambi, JS ' + (snd.length >> 1) + ')';
    else if (meta.snd_state) {
      const q = con.vdc.saveState().snd, js = [q.sn, q.prescaler, q.pending, q.written, q.count, q.output, con.vdc.irq ? 1 : 0, con.vdc.ctlStatus];
      if (JSON.stringify(js) !== JSON.stringify(meta.snd_state)) err = 'stato finale del suono: riferimento ' + JSON.stringify(meta.snd_state) + ' JS ' + JSON.stringify(js);
    }
  }
  if (!err) {
    const fbcrc = zlib.crc32(con.fb);
    if (fbcrc !== meta.final_fb_crc) err = 'schermo finale diverso';
    else if (hex(con.vdc.reg) !== meta.final_regs) err = 'registri finali del chip video diversi';
    else if (cpu.p1 !== meta.final_p1) err = 'P1 finale diverso';
    else if (meta.final_ef) {
      const e = con.ef, g = {ta: e.ta, tb: e.tb, x: e.x, y: e.y, y0: e.y0, m: e.m, r: e.r, parity: e.parity, pre: e.flPrescaler, ph: e.flPhase,
        crcA: zlib.crc32(e.ramA), crcB: zlib.crc32(e.ramB), crcX: zlib.crc32(e.exram)};
      for (const k of Object.keys(meta.final_ef)) if (meta.final_ef[k] !== g[k]) { err = 'EF9341 finale: ' + k + ' riferimento ' + meta.final_ef[k] + ' JS ' + g[k]; break; }
    }
  }
  return {err, step, events: li, snd: snd.length >> 1};
}

function main() {
  const [, , dir, dumps, only] = process.argv;
  const sel = only ? new Set(only.split(',')) : null;
  let fails = 0, n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (sel && !sel.has(meta.name)) continue;
    n++;
    const r = runScenario(dir, dumps, meta);
    if (r.err) fails++;
    console.log(meta.name.padEnd(24) + String(r.step).padStart(8) + ' istruzioni, ' + String(r.events).padStart(6) + ' eventi video, ' + String(r.snd).padStart(5) + ' cambi di suono: ' + (r.err ? 'FALLITO: ' + r.err : 'OK'));
  }
  console.log(fails ? 'FALLITO: ' + fails + ' scenari su ' + n : 'OK: ' + n + ' scenari coincidono col modello per riga');
  process.exit(fails ? 1 : 0);
}
main();
