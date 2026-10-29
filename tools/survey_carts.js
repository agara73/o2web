'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// survey_carts.js - classificazione DINAMICA delle cartucce dell'utente: ogni file si esegue nella console JavaScript
// (src/console.js) con ingressi a copione e si riportano misure: banchi eseguiti, bit di P1 che cambiano, opcode illegali
// eseguiti (segnale di una mappa sbagliata), fetch oltre 0xBFF, STRT CNT e fronti contati, accessi ai registri del suono
// (0xA7-0xAA), MOVX senza selezione, schermo vuoto o no. Serve a scegliere un insieme rappresentativo per i test e a controllare
// lo schema di cambio di banco (DA VERIFICARE). I dump restano nella cartella dell'utente: lo script non li copia da nessuna parte.
// Uso: node tools/survey_carts.js BIOS CARTELLA_O2 [--frames N] [--json OUT.json] [--filter testo] [--std PAL|NTSC]
const fs = require('fs');
const path = require('path');
const {Console} = require('../src/console.js');
const {ILLEGAL} = require('../src/cpu8048.js');
const charsetOwn = require('../hw/charset_own.js');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.toLowerCase().endsWith('.bin')) yield p;
  }
}

function inputs(frames, seed) {                      // come test/line_record.py (stesso schema, ma tasto ripetuto)
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  let rows = new Uint8Array(8), joy = [0, 0];
  for (let fr = 0; fr < frames; fr++) {
    const k = fr % 40;
    if (fr >= 30 && fr < 130 && k >= 30 && k < 34) rows = new Uint8Array(8).fill(1);       // un tasto ai fotogrammi 30-33, 70-73, 110-113
    else if (fr < 140) rows = new Uint8Array(8);
    if (fr >= 140 && rnd() < 0.15) {
      joy = [rnd() < 0.7 ? Math.floor(rnd() * 32) : 0, rnd() < 0.7 ? Math.floor(rnd() * 32) : 0];
      rows = new Uint8Array(8);
      const q = rnd();
      if (q < 0.3) rows[Math.floor(rnd() * 8)] = 1 << Math.floor(rnd() * 8);
    }
    out.push([rows, joy]);
  }
  return out;
}

function survey(bios, cart, frames, std) {
  const con = new Console({bios, cart, charset: new Uint8Array(charsetOwn.build()), standard: std});
  const cpu = con.cpu;
  const st = {size: cart.length, banks: con.bankMask + 1, banksRun: new Set(), p1Seen: new Set(), p1Toggle: 0, illegal: 0, hiFetch: 0, strtCnt: 0,
    counterFrames: 0, snd: 0, extsel: 0, bothsel: 0, movxVdc: 0, movxRam: 0, cartFetch: 0, pcs: new Set(), hiRam: 0};
  const origProg = con.readProg.bind(con);
  con.readProg = (a) => {
    a &= 0xFFF;
    if (a >= 0xC00) st.hiFetch++;
    return origProg(a);
  };
  const origR = con.movxRead.bind(con), origW = con.movxWrite.bind(con);
  const acct = (a, wr) => {
    const p1 = cpu.p1;
    const vdc = !(p1 & 0x08), ram = !(p1 & 0x10) && !(a & 0x80);
    if (vdc && ram) st.bothsel++;
    if (!vdc && (p1 & 0x10)) st.extsel++;
    if (vdc) { st.movxVdc++; const o = a & 0xFF; if (o >= 0xA7 && o <= 0xAA) st.snd++; }
    if (ram) st.movxRam++;
  };
  con.movxRead = (a) => { acct(a & 0xFF, false); return origR(a); };
  con.movxWrite = (a, v) => { acct(a & 0xFF, true); return origW(a, v); };
  const inp = inputs(frames, 12345);
  let prevP1 = cpu.p1;
  for (let fr = 0; fr < frames; fr++) {
    con.keyRows.set(inp[fr][0]);
    con.joy.set(inp[fr][1]);
    const target = con.vdc.frameDone + 1;
    while (con.vdc.frameDone < target) {
      const pc0 = cpu.pc;
      cpu.step();
      const op = cpu.lastOp;
      if (fr >= 10) {
        if (ILLEGAL[op]) st.illegal++;
        if (pc0 >= 0x400 && pc0 < 0xC00) { st.cartFetch++; st.banksRun.add(cpu.p1 & con.bankMask); }
        if (op === 0x45) st.strtCnt++;
        st.pcs.add(pc0);
      }
      if (cpu.p1 !== prevP1) { st.p1Toggle |= cpu.p1 ^ prevP1; prevP1 = cpu.p1; }
      st.p1Seen.add(cpu.p1);
    }
    if (cpu.counterEn) st.counterFrames++;
  }
  const fb = con.fb;
  const hist = new Array(16).fill(0);
  for (let i = 0; i < fb.length; i++) hist[fb[i] & 15]++;
  let bgc = 0;
  for (let i = 1; i < 16; i++) if (hist[i] > hist[bgc]) bgc = i;
  st.colors = hist.filter((v) => v > 0).length;
  st.nonBg = 1 - hist[bgc] / fb.length;
  st.finalPc = cpu.pc;
  return st;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.log('uso: node tools/survey_carts.js BIOS CARTELLA [--frames N] [--json OUT] [--filter testo] [--std PAL|NTSC]'); process.exit(2); }
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const frames = +opt('--frames', 400), filter = opt('--filter', ''), std = opt('--std', 'PAL'), jsonOut = opt('--json', '');
  const bios = new Uint8Array(fs.readFileSync(args[0]));
  const rows = [];
  for (const f of walk(args[1])) {
    if (filter && !path.basename(f).includes(filter)) continue;
    const cart = new Uint8Array(fs.readFileSync(f));
    if (cart.length < 2048) continue;
    let st;
    try { st = survey(bios, cart, frames, std); } catch (e) { console.log(path.basename(f) + ': ERRORE ' + e.message); continue; }
    const row = {file: path.basename(f), size: st.size, banks: st.banks, banksRun: [...st.banksRun].sort(), p1Toggle: st.p1Toggle,
      illegal: st.illegal, hiFetch: st.hiFetch, strtCnt: st.strtCnt, counterFrames: st.counterFrames, snd: st.snd, extsel: st.extsel,
      bothsel: st.bothsel, colors: st.colors, nonBg: +st.nonBg.toFixed(3), cartFetch: st.cartFetch, pcs: st.pcs.size, finalPc: st.finalPc};
    rows.push(row);
    console.log(row.file.slice(0, 50).padEnd(50) + String(row.size).padStart(6) + ' bk=' + row.banks + ' run=' + JSON.stringify(row.banksRun).padEnd(9) +
      ' p1tog=' + row.p1Toggle.toString(16).padStart(2, '0') + ' ill=' + String(row.illegal).padStart(5) + ' hi=' + String(row.hiFetch).padStart(4) +
      ' cnt=' + row.strtCnt + '/' + row.counterFrames + ' snd=' + row.snd + ' ext=' + row.extsel + ' both=' + row.bothsel +
      ' col=' + row.colors + ' nb=' + row.nonBg + ' pcs=' + row.pcs);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
}
main();
