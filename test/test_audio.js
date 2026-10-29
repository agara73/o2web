'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_audio.js REFDIR [DUMPS] - suono (src/audio.js + src/vdc.js):
//  1. campioni PCM contro il riferimento esatto in Python (hw/o2audio.py, preparato da test/audio_ref.py in REFDIR): log di livello
//     sintetici casuali e log REALI registrati dal modello per riga (stesso log -> stessi campioni);
//  2. prove puntuali di Audio (valori noti, argomenti non validi, stato salvato rifiutato se corrotto, ripartenza, distacco), del passo
//     di temporizzazione (framesToRun) e del tasto RESET della console (resetButton);
//  3. con i dump veri (DUMPS: bios/o2rom.bin, blockout.bin, pickaxepete.bin, carts/o2_popeye...): il suono arriva davvero ai campioni e
//     RIPRESA DETERMINISTICA: N fotogrammi, salva console + audio, M fotogrammi; ricarica in un'altra istanza e rigioca M: campioni
//     identici bit per bit, anche quando il salvataggio avviene a meta' di un fotogramma.
const fs = require('fs');
const path = require('path');
const P = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);   // O2_SRC_DIR: solo per la prova di mutazione
const {Audio, framesToRun} = require(process.env.O2_AUDIO_PATH || P('audio.js'));
const {Console} = require(process.env.O2_CONSOLE_PATH || P('console.js'));
const charsetOwn = require('../hw/charset_own.js');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL  ' + msg); } };
const CPS = {PAL: 17734475 / 45, NTSC: 3579545 / 10};

function fakeVdc(level0) {
  return {lvl: level0, sndHook: null, level() { return this.lvl; }};
}

// ---------------------------------------------------------------------------------------------------------- 1. riferimento Python
function refCases(refDir) {
  const desc = JSON.parse(fs.readFileSync(path.join(refDir, 'audio.json'), 'utf8'));
  let nsamp = 0, worst = 0, real = 0;
  for (const c of desc) {
    const b = fs.readFileSync(path.join(refDir, c.name + '.f64'));
    const ref = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const v = fakeVdc(c.level0);
    const a = new Audio(v, CPS[c.std], c.rate);
    for (const [cyc, lvl] of c.log) { v.sndHook(cyc, lvl); v.lvl = lvl; }
    a.advance(c.total);
    const pcm = a.take();
    // il numero di campioni completi puo' differire di 1 sul bordo (aritmetica in virgola mobile contro interi)
    const n = Math.min(pcm.length, ref.length);
    ok(Math.abs(pcm.length - ref.length) <= 1, c.name + ': ' + pcm.length + ' campioni contro ' + ref.length + ' del riferimento');
    let bad = -1, w = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(pcm[i] - ref[i]);
      if (d > w) w = d;
      if (d > 1e-6 && bad < 0) bad = i;
    }
    ok(bad < 0, c.name + ': campione ' + bad + ' diverso dal riferimento (' + (bad >= 0 ? pcm[bad] + ' contro ' + ref[bad] : '') + ')');
    worst = Math.max(worst, w);
    nsamp += n;
    if (c.name.startsWith('real_')) real++;
  }
  console.log('riferimento: ' + desc.length + ' casi (' + real + ' con log reali), ' + nsamp + ' campioni, scarto massimo ' + worst.toExponential(2));
}

// ---------------------------------------------------------------------------------------------------------- 2. prove puntuali
function unit() {
  // livello costante per un secondo: 'rate' campioni tutti uguali
  {
    const v = fakeVdc(15), a = new Audio(v, CPS.PAL, 48000);
    a.advance(Math.round(CPS.PAL));
    const p = a.take();
    ok(Math.abs(p.length - 48000) <= 1, 'un secondo di tempo emulato = ' + p.length + ' campioni (attesi 48000)');
    ok(p.every((x) => Math.abs(x - 0.5) < 1e-6), 'livello 15 costante: ampiezza 0,5');
    ok(a.take().length === 0, 'take() svuota la coda');
  }
  {
    const v = fakeVdc(0), a = new Audio(v, CPS.NTSC, 44100);
    a.advance(100000);
    const p = a.take();
    ok(p.length > 0 && p.every((x) => x === 0), 'livello 0: silenzio esatto');
  }
  // onda quadra con un cambio a meta' di un campione: il campione vale la media
  {
    const v = fakeVdc(0), a = new Audio(v, 48000 * 4, 48000);          // 4 cicli per campione
    v.sndHook(2, 15);                                                  // il livello sale dopo 2 cicli del primo campione
    a.advance(8);
    const p = a.take();
    ok(p.length === 2 && Math.abs(p[0] - 0.25) < 1e-7 && Math.abs(p[1] - 0.5) < 1e-7, 'media su mezzo campione: ' + Array.from(p));
  }
  // piu' cambi dentro lo stesso campione
  {
    const v = fakeVdc(0), a = new Audio(v, 48000 * 8, 48000);          // 8 cicli per campione
    v.sndHook(1, 15); v.sndHook(3, 0); v.sndHook(4, 7); v.sndHook(6, 0);
    a.advance(8);
    const p = a.take();
    const exp = (15 * 2 + 7 * 2) / 8 / 15 * 0.5;
    ok(p.length === 1 && Math.abs(p[0] - exp) < 1e-7, 'piu\' cambi in un campione: ' + p[0] + ' attesi ' + exp);
  }
  // tempo che non avanza o va indietro
  {
    const v = fakeVdc(3), a = new Audio(v, CPS.PAL, 48000);
    a.advance(5000);
    const n = a.len;
    a.advance(5000); a.advance(10);
    ok(a.len === n && a.pos === 5000, 'advance a un istante gia\' passato non cambia nulla');
  }
  // argomenti non validi
  for (const [cps, rate] of [[CPS.PAL, 100], [CPS.PAL, 1e9], [CPS.PAL, NaN], [10, 48000], [NaN, 48000], [undefined, 48000]]) {
    let threw = false;
    try { new Audio(fakeVdc(0), cps, rate); } catch (e) { threw = true; }
    ok(threw, 'Audio(' + cps + ', ' + rate + ') va rifiutato');
  }
  // stato salvato: andata e ritorno, e rifiuto dei campi corrotti senza modificare l'oggetto
  {
    const v = fakeVdc(9), a = new Audio(v, CPS.PAL, 48000);
    a.advance(12345);
    v.sndHook(12400, 4);
    a.advance(23456);
    const s = JSON.parse(JSON.stringify(a.saveState()));
    const b = new Audio(fakeVdc(0), CPS.PAL, 48000);
    b.loadState(s);
    ok(JSON.stringify(b.saveState()) === JSON.stringify(s), 'audio: andata e ritorno dello stato');
    const before = JSON.stringify(b.saveState());
    const bad = [['rate', 44100], ['rate', 'x'], ['pos', -1], ['pos', 1.5], ['pos', NaN], ['level', 16], ['level', -1], ['level', 2.5], ['frac', 1],
      ['frac', -0.1], ['frac', 'x'], ['sum', 2], ['sum', -1], ['sum', Infinity]];
    let rej = 0;
    for (const [k, val] of bad) {
      const t = JSON.parse(JSON.stringify(s)); t[k] = val;
      let threw = false;
      try { b.loadState(t); } catch (e) { threw = true; }
      if (threw) rej++; else ok(false, 'audio: ' + k + ' = ' + val + ' non rifiutato');
      ok(JSON.stringify(b.saveState()) === before, 'audio: stato cambiato dopo un rifiuto (' + k + ')');
    }
    ok(rej === bad.length, 'audio: ' + rej + ' stati corrotti rifiutati su ' + bad.length);
    for (const junk of [null, undefined, 5, 'x']) {
      let threw = false;
      try { b.loadState(junk); } catch (e) { threw = true; }
      ok(threw, 'audio: loadState(' + junk + ') va rifiutato');
    }
  }
  // restart e detach
  {
    const v = fakeVdc(7), a = new Audio(v, CPS.PAL, 48000);
    a.advance(9999);
    v.lvl = 2;
    a.restart(500);
    ok(a.pos === 500 && a.level === 2 && a.len === 0 && a.frac === 0 && a.sum === 0, 'restart: riparte dal ciclo dato con il livello del chip');
    ok(v.sndHook === a.hook, 'l\'audio aggancia il chip video');
    a.detach();
    ok(v.sndHook === null, 'detach stacca l\'audio dal chip video');
    const w = fakeVdc(0), a1 = new Audio(w, CPS.PAL, 48000), hook1 = w.sndHook;
    const a2 = new Audio(w, CPS.PAL, 48000);
    a1.detach();
    ok(w.sndHook !== null && w.sndHook !== hook1, 'detach di un\'altra istanza non stacca quella attiva');
    a2.detach();
  }
  // passo di temporizzazione
  const T = [[0, 0.08, 0.02, 3, 3], [0.08, 0.08, 0.02, 3, 0], [0.07, 0.08, 0.02, 3, 1], [0.05, 0.08, 0.02, 3, 2], [0, 0.5, 0.02, 3, 3], [-1, 0.08, 0.02, 3, 3],
    [0.01, 0.08, 0.02, 3, 3], [0.06, 0.08, 0.02, 3, 1], [0.0601, 0.08, 0.02, 3, 1], [0.1, 0.08, 0.02, 3, 0], [0, 0.08, 0, 3, 0], [0, 0.08, -1, 3, 0]];
  for (const [q, lead, per, mx, exp] of T) {
    const r = framesToRun(q, lead, per, mx);
    ok(r === exp, 'framesToRun(' + [q, lead, per, mx] + ') = ' + r + ' (atteso ' + exp + ')');
  }
}

// ---------------------------------------------------------------------------------------------------------- 3. con i dump veri
const OWN = () => new Uint8Array(charsetOwn.build());
function inputsFor(frames, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  let rows = new Uint8Array(8), joy = [0, 0];
  for (let fr = 0; fr < frames; fr++) {
    if (fr === 30) rows = new Uint8Array(8).fill(1);
    if (fr === 34) rows = new Uint8Array(8);
    if (fr > 40 && rnd() < 0.2) joy = [Math.floor(rnd() * 32), Math.floor(rnd() * 32)];
    out.push([rows, joy]);
  }
  return out;
}
function peak(p) { let m = 0; for (const x of p) if (x > m) m = x; return m; }
function eq32(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function withDumps(dumps) {
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(dumps, f)));
  const bios = rd('bios/o2rom.bin');
  const games = [['blockout.bin', 'PAL'], ['pickaxepete.bin', 'PAL'], ['blockout.bin', 'NTSC']];
  if (fs.existsSync(path.join(dumps, 'carts/o2_popeye_1983_parker_brothers_br.bin'))) games.push(['carts/o2_popeye_1983_parker_brothers_br.bin', 'PAL']);
  for (const [file, std] of games) {
    const cart = rd(file);
    const mk = () => new Console({bios, cart, charset: OWN(), standard: std});
    const run = (con, au, inp, from, to, pcms) => {
      for (let fr = from; fr < to; fr++) {
        con.keyRows.set(inp[fr][0]); con.joy.set(inp[fr][1]);
        con.runFrame();
        au.advance(con.cpu.now);
        pcms.push(au.take());
      }
    };
    const flat = (list) => { const n = list.reduce((s, x) => s + x.length, 0), o = new Float32Array(n); let k = 0; for (const x of list) { o.set(x, k); k += x.length; } return o; };
    const inp = inputsFor(160, 7);
    // a. il suono arriva ai campioni; il numero di campioni segue il tempo emulato
    const c1 = mk(), a1 = new Audio(c1.vdc, c1.cyclesPerSecond, 48000), all = [];
    run(c1, a1, inp, 0, 100, all);
    const pcm = flat(all);
    const expected = c1.cpu.now * 48000 / c1.cyclesPerSecond;
    ok(Math.abs(pcm.length - expected) <= 2, file + ' ' + std + ': ' + pcm.length + ' campioni dopo ' + c1.cpu.now + ' cicli (attesi ' + expected.toFixed(1) + ')');
    ok(peak(pcm) > 0.01 && peak(pcm) <= 0.5 + 1e-6, file + ' ' + std + ': il suono e\' udibile e nei limiti (picco ' + peak(pcm).toFixed(3) + ')');
    // b. ripresa deterministica (salvataggio a confine di fotogramma)
    const N = 60, M = 60;
    const c2 = mk(), a2 = new Audio(c2.vdc, c2.cyclesPerSecond, 48000), head = [], tail1 = [];
    run(c2, a2, inp, 0, N, head);
    const cs = JSON.parse(JSON.stringify(c2.saveState())), as = JSON.parse(JSON.stringify(a2.saveState()));
    run(c2, a2, inp, N, N + M, tail1);
    const c3 = mk(), a3 = new Audio(c3.vdc, c3.cyclesPerSecond, 48000), tail2 = [];
    c3.loadState(cs);
    a3.loadState(as);
    run(c3, a3, inp, N, N + M, tail2);
    ok(eq32(flat(tail1), flat(tail2)), file + ' ' + std + ': ripresa deterministica: campioni identici bit per bit dopo ' + M + ' fotogrammi');
    ok(JSON.stringify(c2.saveState()) === JSON.stringify(c3.saveState()), file + ' ' + std + ': stato della console identico dopo la ripresa');
    ok(JSON.stringify(a2.saveState()) === JSON.stringify(a3.saveState()), file + ' ' + std + ': stato dell\'audio identico dopo la ripresa');
    // c. ripresa con ripartenza dell'audio (come fa la pagina dopo "Carica stato"): il suono riparte dal ciclo giusto, senza buchi ne' doppioni
    const c4 = mk(), a4 = new Audio(c4.vdc, c4.cyclesPerSecond, 48000), tail3 = [];
    c4.loadState(cs);
    a4.restart(c4.cpu.now);
    run(c4, a4, inp, N, N + M, tail3);
    const n1 = flat(tail1).length, n3 = flat(tail3).length;
    ok(Math.abs(n1 - n3) <= 1, file + ' ' + std + ': dopo restart() i campioni sono ' + n3 + ' contro ' + n1);
    // d. RESET della console: il tempo continua, il suono non si interrompe e riprende dal menu
    const c5 = mk(), a5 = new Audio(c5.vdc, c5.cyclesPerSecond, 48000), p5 = [];
    run(c5, a5, inp, 0, 80, p5);
    const t0 = c5.cpu.now, vs = JSON.stringify(c5.vdc.saveState().reg);
    c5.resetButton();
    ok(c5.cpu.now === t0 && c5.cpu.pc === 0 && c5.cpu.p1 === 0xFF && c5.cpu.p2 === 0xFF, file + ' ' + std + ': RESET: PC = 0, porte a 0xFF, tempo invariato');
    ok(JSON.stringify(c5.vdc.saveState().reg) === vs, file + ' ' + std + ': RESET: i registri del chip video restano');
    let sawMenu = false;
    for (let fr = 80; fr < 130; fr++) {
      c5.keyRows.fill(0); c5.joy.fill(0);
      c5.runFrame(); a5.advance(c5.cpu.now); p5.push(a5.take());
      if (fr >= 90 && c5.cpu.pc >= 0x176 && c5.cpu.pc <= 0x17A) sawMenu = true;
    }
    ok(sawMenu, file + ' ' + std + ': dopo il RESET il BIOS torna all\'attesa del tasto (0x176-0x17A)');
    ok(Math.abs(flat(p5).length - c5.cpu.now * 48000 / c5.cyclesPerSecond) <= 2, file + ' ' + std + ': dopo il RESET i campioni seguono ancora il tempo emulato');
  }
  // e. stato di versione 1 (senza suono): si carica e il suono riparte da un evento utile
  {
    const cart = rd('blockout.bin');
    const c = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
    const inp = inputsFor(80, 3);
    for (let fr = 0; fr < 50; fr++) { c.keyRows.set(inp[fr][0]); c.joy.set(inp[fr][1]); c.runFrame(); }
    const s = JSON.parse(JSON.stringify(c.saveState()));
    ok(s.version === 4 && s.vdc.snd && Number.isInteger(s.vdc.snd.sn), 'stato versione 4 (modulo scacchi) con i dati del suono');
    const old = JSON.parse(JSON.stringify(s)); old.version = 1; delete old.vdc.snd;
    const d = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
    let threw = null;
    try { d.loadState(old); } catch (e) { threw = e; }
    ok(!threw, 'uno stato di versione 1 si carica (' + (threw && threw.message) + ')');
    ok(!d.vdc.legacySound && d.vdc.nextSnd >= d.cpu.now && d.vdc.nextSnd - d.cpu.now <= d.vdc.t.htotal, 'stato versione 1: il tempo del suono e\' allineato (' + (d.vdc.nextSnd - d.cpu.now) + ' cicli al prossimo evento)');
    for (let fr = 50; fr < 70; fr++) { d.keyRows.set(inp[fr][0]); d.joy.set(inp[fr][1]); d.runFrame(); }
    ok(d.vdc.sn > 0, 'dopo lo stato versione 1 la console gira e produce eventi di suono');
    for (const v of [0, 5, 'x', null]) {
      const bad = JSON.parse(JSON.stringify(s)); bad.version = v;
      let t = false;
      try { new Console({bios, cart, charset: OWN(), standard: 'PAL'}).loadState(bad); } catch (e) { t = true; }
      ok(t, 'stato con versione ' + v + ' rifiutato');
    }
    for (const mut of [(x) => { x.vdc.snd.count = 24; }, (x) => { x.vdc.snd.output = 2; }, (x) => { x.vdc.snd.prescaler = 256; }, (x) => { x.vdc.snd.sn = -1; },
      (x) => { x.vdc.snd.pending = 'x'; }, (x) => { x.vdc.snd = null; }, (x) => { x.vdc.snd.sn = 1e15; }]) {
      const bad = JSON.parse(JSON.stringify(s)); mut(bad);
      const e = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
      const before = JSON.stringify(e.saveState());
      let t = false;
      try { e.loadState(bad); } catch (err) { t = true; }
      ok(t && JSON.stringify(e.saveState()) === before, 'stato del suono alterato rifiutato senza toccare la console');
    }
  }
}

function bounds() {
  const msg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  for (const r of [8000, 192000, 48000, 8000.5]) ok(msg(() => new Audio(fakeVdc(0), CPS.PAL, r)) === '', 'frequenza ' + r + ' ammessa');
  for (const r of [7999.9, 192000.1, 0, -1, NaN, undefined, '48000x']) ok(msg(() => new Audio(fakeVdc(0), CPS.PAL, r)) === 'frequenza di campionamento non valida: ' + r, 'frequenza ' + r + ' rifiutata');
  ok(msg(() => new Audio(fakeVdc(0), 1000.001, 48000)) === '' && msg(() => new Audio(fakeVdc(0), 1000, 48000)) === 'cicli al secondo non validi' && msg(() => new Audio(fakeVdc(0), NaN, 48000)) === 'cicli al secondo non validi', 'cicli al secondo');
  { const a = new Audio(fakeVdc(3), 123456, 48000); ok(a.cps === 123456 && a.rate === 48000 && a.spc === 48000 / 123456 && a.len === 0 && a.pos === 0 && a.frac === 0 && a.sum === 0 && a.level === 3 && a.buf.length >= 4096, 'campi iniziali'); }
  const mk = (rate) => new Audio(fakeVdc(0), CPS.PAL, rate || 48000);
  const st = (o) => Object.assign({rate: 48000, pos: 0, level: 0, frac: 0, sum: 0}, o);
  ok(msg(() => mk().loadState(st())) === '', 'stato minimo');
  ok(msg(() => mk().loadState(st({pos: Number.MAX_SAFE_INTEGER, level: 15, sum: 1, frac: 0.999999}))) === '', 'stato ai massimi');
  const bad = (o, text) => ok(msg(() => mk().loadState(st(o))) === text, 'stato rifiutato: ' + JSON.stringify(o) + ' -> ' + msg(() => mk().loadState(st(o))));
  bad({rate: 7999}, 'stato non valido: frequenza audio');
  bad({rate: 192001}, 'stato non valido: frequenza audio');
  bad({pos: -1}, 'stato non valido: posizione audio');
  bad({pos: Number.MAX_SAFE_INTEGER + 2}, 'stato non valido: posizione audio');
  bad({pos: 1.5}, 'stato non valido: audio');
  bad({level: -1}, 'stato non valido: livello audio');
  bad({level: 16}, 'stato non valido: livello audio');
  bad({level: 2.5}, 'stato non valido: audio');
  bad({frac: -0.1}, 'stato non valido: audio: frazione');
  bad({frac: 1.1}, 'stato non valido: audio: frazione');
  bad({frac: 1}, 'stato non valido: audio: frazione');
  bad({sum: -0.1}, 'stato non valido: audio: somma');
  bad({sum: 1.01}, 'stato non valido: audio: somma');
  bad({sum: NaN}, 'stato non valido: audio: somma');
  bad({level: '3'}, 'stato non valido: livello audio');
  bad({rate: 44100}, 'stato audio con un’altra frequenza di campionamento');
  ok(msg(() => mk().loadState(null)) === 'stato non valido: audio' && msg(() => mk().loadState(5)) === 'stato non valido: audio' && msg(() => mk().loadState(undefined)) === 'stato non valido: audio', 'stato non oggetto');
  ok(msg(() => mk(8000).loadState(st({rate: 8000}))) === '' && msg(() => mk(192000).loadState(st({rate: 192000}))) === '', 'frequenze estreme coerenti');
  { // loadState svuota i campioni gia' prodotti e un rifiuto non tocca niente
    const a = mk(); a.advance(100000); ok(a.len > 0, 'campioni prodotti');
    const before = JSON.stringify(a.saveState());
    try { a.loadState(st({level: 99})); } catch (e) { /* atteso */ }
    ok(JSON.stringify(a.saveState()) === before && a.len > 0, 'rifiuto: niente cambia');
    a.loadState(st({pos: 5, level: 7, frac: 0.5, sum: 0.25}));
    ok(a.len === 0 && a.take().length === 0 && a.pos === 5 && a.level === 7 && a.frac === 0.5 && a.sum === 0.25, 'loadState: campioni svuotati, stato preso');
  }
  // advance: all'indietro o fermo non fa niente
  { const a = mk(); a.advance(1000); const s0 = JSON.stringify(a.saveState()), n0 = a.len; a.advance(1000); a.advance(500); a.advance(NaN); ok(JSON.stringify(a.saveState()) === s0 && a.len === n0, 'advance indietro o fermo: niente'); }
  // framesToRun: confini
  ok(framesToRun(0, 0.06, 0.02, 4) === 3 && framesToRun(0.06, 0.06, 0.02, 4) === 0 && framesToRun(0.05, 0.06, 0.02, 4) === 1 && framesToRun(1, 0.06, 0.02, 4) === 0 &&
    framesToRun(-10, 0.06, 0.02, 4) === 4 && framesToRun(0, 0.06, 0, 4) === 0 && framesToRun(0, 0.06, -1, 4) === 0 && framesToRun(0, 0.06, NaN, 4) === 0 && framesToRun(0.04, 0.06, 0.02, 4) === 1, 'framesToRun');
  ok(framesToRun(0.06 - 0.02 * (1 + 1e-10), 0.06, 0.02, 4) === 1 && framesToRun(0.06 - 0.02 * (1 + 1e-7), 0.06, 0.02, 4) === 2, 'framesToRun: tolleranza 1e-9 (in fotogrammi)');
}

function main() {
  const refDir = process.argv[2], dumps = process.argv[3];
  unit();
  bounds();
  if (refDir && fs.existsSync(path.join(refDir, 'audio.json'))) refCases(refDir);
  else console.log('(riferimento Python non trovato: prova saltata; vedi test/audio_ref.py)');
  if (dumps) withDumps(dumps);
  if (fails) { console.log('FALLITI ' + fails + ' controlli (' + passes + ' ok)'); process.exit(1); }
  console.log('OK: ' + passes + ' controlli');
}
main();
