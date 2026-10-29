'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// survey_sound.js - rilevamento dell'uso del suono nelle cartucce dell'utente: ogni .bin si esegue nella console JavaScript con
// ingressi a copione e si contano le scritture ai registri 0xA0 (bit 2 = interrupt del suono), 0xA7-0xA9 (registro a scorrimento a
// 24 bit) e 0xAA (controllo: bit 7 uscita, bit 5 frequenza, bit 4 rumore, bit 0-3 volume). Serve a sapere quali bit dei registri
// i giochi usano davvero (scelta delle prove del suono e dell'interrupt del suono). Non copia nessun dump.
// Uso: node tools/survey_sound.js BIOS CARTELLA [--frames N] [--filter testo] [--std PAL|NTSC] [--json OUT.json]
const fs = require('fs');
const path = require('path');
const {Console} = require('../src/console.js');
const {Vdc} = require('../src/vdc.js');
const charsetOwn = require('../hw/charset_own.js');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.toLowerCase().endsWith('.bin')) yield p;
  }
}

// ingressi a copione: un tasto ogni tanto, poi joystick e tasti a caso (stesso schema di survey_carts.js)
function inputs(frames, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  let rows = new Uint8Array(8), joy = [0, 0];
  for (let fr = 0; fr < frames; fr++) {
    const k = fr % 40;
    if (fr >= 30 && fr < 130 && k >= 30 && k < 34) rows = new Uint8Array(8).fill(1);
    else if (fr < 140) rows = new Uint8Array(8);
    if (fr >= 140 && rnd() < 0.15) {
      joy = [rnd() < 0.7 ? Math.floor(rnd() * 32) : 0, rnd() < 0.7 ? Math.floor(rnd() * 32) : 0];
      rows = new Uint8Array(8);
      if (rnd() < 0.3) rows[Math.floor(rnd() * 8)] = 1 << Math.floor(rnd() * 8);
    }
    out.push([rows, joy]);
  }
  return out;
}

function survey(bios, cart, frames, std) {
  const con = new Console({bios, cart, charset: new Uint8Array(charsetOwn.build()), standard: std});
  const st = {a0irq: 0, shiftWrites: 0, ctlWrites: 0, ctlValues: new Set(), shiftValues: new Set(), outOn: 0, rate: new Set(), noise: 0, vols: new Set(), reads: 0};
  const origW = con.vdc.write.bind(con.vdc), origR = con.vdc.read.bind(con.vdc);
  con.vdc.write = (off, data, cyc) => {
    const o = Vdc.mirror(off);
    if (o === 0xA0 && (data & 0x04)) st.a0irq++;
    if (o >= 0xA7 && o <= 0xA9) { st.shiftWrites++; st.shiftValues.add(o.toString(16) + ':' + (data & 0xFF).toString(16)); }
    if (o === 0xAA) {
      st.ctlWrites++; st.ctlValues.add(data & 0xFF);
      if (data & 0x80) st.outOn++;
      st.rate.add((data >> 5) & 1);
      if (data & 0x10) st.noise++;
      st.vols.add(data & 15);
    }
    return origW(off, data, cyc);
  };
  con.vdc.read = (off, cyc) => {
    const o = Vdc.mirror(off);
    if (o >= 0xA7 && o <= 0xAA) st.reads++;
    return origR(off, cyc);
  };
  const inp = inputs(frames, 12345);
  for (let fr = 0; fr < frames; fr++) {
    con.keyRows.set(inp[fr][0]);
    con.joy.set(inp[fr][1]);
    con.runFrame();
  }
  return st;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.log('uso: node tools/survey_sound.js BIOS CARTELLA [--frames N] [--filter testo] [--std PAL|NTSC] [--json OUT]'); process.exit(2); }
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const frames = +opt('--frames', 600), filter = opt('--filter', ''), std = opt('--std', 'PAL'), jsonOut = opt('--json', '');
  const bios = new Uint8Array(fs.readFileSync(args[0]));
  const rows = [];
  let tot = {files: 0, withSound: 0, a0irq: 0, noise: 0, rate1: 0, rate0: 0};
  for (const f of walk(args[1])) {
    if (filter && !path.basename(f).includes(filter)) continue;
    const cart = new Uint8Array(fs.readFileSync(f));
    if (cart.length < 2048 || cart.length > 8192) continue;
    let st;
    try { st = survey(bios, cart, frames, std); } catch (e) { console.log(path.basename(f) + ': ERRORE ' + e.message); continue; }
    const row = {file: path.basename(f), a0irq: st.a0irq, shiftWrites: st.shiftWrites, ctlWrites: st.ctlWrites, outOn: st.outOn,
      ctl: [...st.ctlValues].sort((a, b) => a - b).map((v) => v.toString(16)), rate: [...st.rate].sort(), noise: st.noise,
      vols: [...st.vols].sort((a, b) => a - b), reads: st.reads, shifts: st.shiftValues.size};
    rows.push(row);
    tot.files++;
    if (st.ctlWrites || st.shiftWrites) tot.withSound++;
    if (st.a0irq) tot.a0irq++;
    if (st.noise) tot.noise++;
    if (st.rate.has(1)) tot.rate1++;
    if (st.rate.has(0) && st.ctlWrites) tot.rate0++;
    console.log(row.file.slice(0, 52).padEnd(52) + ' a0irq=' + String(row.a0irq).padStart(4) + ' shw=' + String(row.shiftWrites).padStart(5) +
      ' ctlw=' + String(row.ctlWrites).padStart(4) + ' on=' + String(row.outOn).padStart(4) + ' noise=' + row.noise + ' rate=' + row.rate.join('') +
      ' ctl=' + row.ctl.slice(0, 6).join(',') + ' rd=' + row.reads);
  }
  console.log('TOTALE ' + JSON.stringify(tot));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({totals: tot, rows}, null, 1));
}
main();
