'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_state.js [DUMPS] - salvataggio e ripresa dello stato (snapshot): andata e ritorno di CPU, chip video e console; ripresa
// DETERMINISTICA (stato salvato e ricaricato in un'altra istanza = stesso futuro, istruzione per istruzione e fotogramma per
// fotogramma); rifiuto di stati corrotti, falsificati o di un altro BIOS / un'altra cartuccia / un altro standard, senza toccare
// la console. Con dati sintetici (BIOS e cartuccia casuali: eseguono codice a caso) sempre; con i dump veri se si passa DUMPS
// (cartella con bios/o2rom.bin e blockout.bin).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = (n) => path.join(__dirname, '..', 'src', n);
const {Console, SnapshotError} = require(process.env.O2_CONSOLE_PATH || P('console.js'));
const {CPU8048} = require(process.env.O2_CPU_PATH || P('cpu8048.js'));
const {Vdc} = require(process.env.O2_VDC_PATH || P('vdc.js'));
const charsetOwn = require('../hw/charset_own.js');

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL  ' + msg); } return cond; };
let passes = 0;
const ok = (cond, msg) => { if (check(cond, msg)) passes++; };

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const OWN = () => new Uint8Array(charsetOwn.build());
const json = (x) => JSON.stringify(x);
const cpuVec = (c) => json(c.saveState());
const fbCrc = (con) => zlib.crc32(con.fb);

function synth(seed, cartKb) {
  const r = rng(seed);
  const bios = new Uint8Array(1024), cart = new Uint8Array(cartKb * 1024);
  for (let i = 0; i < bios.length; i++) bios[i] = (r() * 256) | 0;
  for (let i = 0; i < cart.length; i++) cart[i] = (r() * 256) | 0;
  return {bios, cart};
}

function inputs(frames, seed) {
  const r = rng(seed), out = [];
  for (let i = 0; i < frames; i++) {
    const rows = new Uint8Array(8);
    if (r() < 0.3) rows[(r() * 8) | 0] = 1 << ((r() * 8) | 0);
    out.push([rows, [(r() * 32) | 0, (r() * 32) | 0]]);
  }
  return out;
}
const setIn = (con, inp) => { con.keyRows.set(inp[0]); con.joy.set(inp[1]); };

// ---------------------------------------------------------------------------------------------------------- 1. CPU e chip video
{
  const {bios, cart} = synth(5, 4);
  const con = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  for (let i = 0; i < 50000; i++) con.cpu.step();
  const st = con.cpu.saveState();
  const copy = JSON.parse(json(st));
  const con2 = new Console({bios, cart, charset: OWN(), standard: 'PAL'});
  con2.cpu.loadState(copy);
  ok(cpuVec(con2.cpu) === cpuVec(con.cpu), 'CPU: andata e ritorno identici');
  ok(json(con.cpu.saveState()) === json(st), 'CPU: saveState non modifica lo stato');
  // campi corrotti: ognuno deve essere rifiutato e la CPU non deve cambiare
  const bad = [-1, 1.5, 'x', null, NaN, 1e300, undefined];
  let rejected = 0, total = 0;
  const before = cpuVec(con2.cpu);
  for (const k of Object.keys(st)) {
    const vals = Array.isArray(st[k]) ? [] : bad;
    for (const v of vals) {
      const s = JSON.parse(json(st)); s[k] = v; if (v === undefined) delete s[k];
      total++;
      let threw = false;
      try { con2.cpu.loadState(s); } catch (e) { threw = true; }
      if (threw) rejected++; else check(false, 'CPU: campo ' + k + ' = ' + String(v) + ' non rifiutato');
      check(cpuVec(con2.cpu) === before, 'CPU: stato cambiato dopo un rifiuto (' + k + ')');
    }
  }
  for (const [k, n] of [['ram', 64], ['exp', 4]]) {
    for (const mut of [(a) => a.slice(1), (a) => a.concat([0]), (a) => { const b = a.slice(); b[0] = k === 'ram' ? 256 : 16; return b; },
      (a) => { const b = a.slice(); b[1] = 'x'; return b; }]) {
      const s = JSON.parse(json(st)); s[k] = mut(s[k]); total++;
      let threw = false;
      try { con2.cpu.loadState(s); } catch (e) { threw = true; }
      if (threw) rejected++; else check(false, 'CPU: ' + k + ' alterata non rifiutata');
      check(cpuVec(con2.cpu) === before, 'CPU: stato cambiato dopo un rifiuto (' + k + ')');
    }
  }
  for (const a11 of [5, 0x400, 1]) {
    const s = JSON.parse(json(st)); s.a11 = a11; total++;
    let threw = false;
    try { con2.cpu.loadState(s); } catch (e) { threw = true; }
    if (threw) rejected++; else check(false, 'CPU: banco ' + a11 + ' non rifiutato');
  }
  ok(rejected === total, 'CPU: ' + total + ' stati corrotti rifiutati (' + rejected + ')');
  check(con2.cpu.loadState(JSON.parse(json(st))) === undefined, 'CPU: lo stato valido si carica ancora');
  // limiti di ogni campo: il massimo e lo zero si accettano, uno in piu' o uno in meno no (e il messaggio nomina il campo)
  {
    const lim = {a: 255, pc: 0xFFF, psw: 255, f1: 1, timer: 255, prescaler: 31, timerEn: 1, counterEn: 1, tf: 1, tirqEn: 1, xirqEn: 1,
      inProgress: 1, timerPend: 1, p1: 255, p2: 255, bus: 255, t1Prev: 1, lastOp: 255, now: Number.MAX_SAFE_INTEGER};
    let bad2 = 0, n2 = 0;
    const tryLoad = (s) => { try { con2.cpu.loadState(s); return ''; } catch (e) { return e.message; } };
    for (const [k, mx] of Object.entries(lim)) {
      for (const [val, want] of [[0, true], [mx, true], [mx + 1, false], [-1, false]]) {
        const s = JSON.parse(json(st)); s[k] = val; n2++;
        const m = tryLoad(s);
        if ((m === '') !== want) { bad2++; check(false, 'CPU: ' + k + ' = ' + val + (want ? ' rifiutato' : ' accettato')); }
        else if (!want && !m.includes('stato non valido')) { bad2++; check(false, 'CPU: messaggio senza prefisso per ' + k + ': ' + m); }
      }
    }
    for (const [val, want] of [[0, true], [0x800, true], [1, false], [0x801, false], [-1, false]]) {
      const s = JSON.parse(json(st)); s.a11 = val; n2++;
      if ((tryLoad(s) === '') !== want) { bad2++; check(false, 'CPU: banco ' + val); }
    }
    for (const [k, mx] of [['ram', 255], ['exp', 15]]) {
      for (const [val, want] of [[0, true], [mx, true], [mx + 1, false], [-1, false]]) {
        const s = JSON.parse(json(st)); s[k][s[k].length - 1] = val; n2++;
        if ((tryLoad(s) === '') !== want) { bad2++; check(false, 'CPU: ' + k + ' = ' + val); }
      }
    }
    ok(bad2 === 0, 'CPU: limiti di tutti i campi (' + n2 + ' prove)');
    ok(tryLoad({}).includes('RAM o espansore'), 'CPU: stato senza RAM -> messaggio sulla RAM');
    ok(tryLoad(null).includes('RAM o espansore'), 'CPU: stato nullo -> messaggio');
    ok(tryLoad(Object.assign(JSON.parse(json(st)), {pc: 5000})).includes('PC'), 'CPU: il messaggio nomina il PC');
    con2.cpu.loadState(JSON.parse(json(st)));
  }

  // chip video
  const v = new Vdc(OWN(), 'PAL'), r = rng(9);
  for (let i = 0; i < 300; i++) v.write((r() * 256) | 0, (r() * 256) | 0, i * 3);
  v.write(0xA0, 0x28, 1000);
  v.advanceTo(89999);
  v.read(0xA1, 90001);
  const vs = JSON.parse(json(v.saveState()));
  const v2 = new Vdc(OWN(), 'PAL');
  v2.loadState(vs);
  ok(json(v2.saveState()) === json(vs), 'VDC: andata e ritorno identici');
  let vrej = 0, vtot = 0;
  const vb = json(v2.saveState());
  for (const k of Object.keys(vs)) {
    for (const val of (Array.isArray(vs[k]) ? [] : [-1, 1.5, 'x', null, NaN, 1e300, undefined])) {
      if (k === 'snd' && val === undefined) continue;              // senza il campo del suono e' uno stato di versione 1: si accetta (vedi test_audio.js)
      const s = JSON.parse(json(vs)); s[k] = val; if (val === undefined) delete s[k]; vtot++;
      try { v2.loadState(s); check(false, 'VDC: campo ' + k + ' = ' + String(val) + ' non rifiutato'); } catch (e) { vrej++; }
      check(json(v2.saveState()) === vb, 'VDC: stato cambiato dopo un rifiuto (' + k + ')');
    }
  }
  for (const mut of [(a) => a.slice(1), (a) => a.concat([0]), (a) => { const b = a.slice(); b[7] = 256; return b; }]) {
    const s = JSON.parse(json(vs)); s.reg = mut(s.reg); vtot++;
    try { v2.loadState(s); check(false, 'VDC: registri alterati non rifiutati'); } catch (e) { vrej++; }
    check(json(v2.saveState()) === vb, 'VDC: stato cambiato dopo un rifiuto (reg)');
  }
  // valori appena fuori intervallo, messaggio con il nome del campo, schermo azzerato dopo il caricamento, stato iniziale accettato
  for (const [k, val] of [['ctlStatus', 256], ['colStatus', 256], ['xbeam', 256], ['ybeam', 256], ['irq', 2], ['ev', -1], ['t1i', -1]]) {
    const s = JSON.parse(json(vs)); s[k] = val; vtot++;
    try { v2.loadState(s); check(false, 'VDC: ' + k + ' = ' + val + ' non rifiutato'); } catch (e) { vrej++; }
    check(json(v2.saveState()) === vb, 'VDC: stato cambiato dopo un rifiuto (' + k + ')');
  }
  // stato del suono (tappa 3): ogni campo fuori intervallo o di tipo sbagliato viene rifiutato senza toccare il chip
  for (const k of ['sn', 'prescaler', 'pending', 'written', 'count', 'output']) {
    for (const val of [-1, 1.5, 'x', null, NaN, 1e300, 256, 2, 24, undefined]) {
      const lim = {sn: [0, Number.MAX_SAFE_INTEGER], prescaler: [0, 255], pending: [0, 1], written: [0, 1], count: [0, 23], output: [0, 1]}[k];
      const valid = Number.isInteger(val) && val >= lim[0] && val <= lim[1];
      const s = JSON.parse(json(vs)); s.snd[k] = val; if (val === undefined) delete s.snd[k];
      let threw = false;
      try { v2.loadState(s); } catch (e) { threw = true; }
      if (valid) { ok(!threw, 'VDC: suono ' + k + ' = ' + val + ' valido, accettato'); v2.loadState(vs); } else {
        vtot++;
        if (threw) vrej++; else check(false, 'VDC: suono ' + k + ' = ' + String(val) + ' non rifiutato');
        check(json(v2.saveState()) === vb, 'VDC: stato cambiato dopo un rifiuto (suono ' + k + ')');
      }
    }
  }
  ok(vrej === vtot, 'VDC: ' + vtot + ' stati corrotti rifiutati (' + vrej + ')');
  { const s = JSON.parse(json(vs)); s.xbeam = 300; let m = ''; try { v2.loadState(s); } catch (e) { m = e.message; }
    ok(m.includes('xbeam') && m.includes('stato non valido'), 'VDC: il messaggio nomina il campo (' + m + ')'); }
  { let m = ''; try { v2.loadState(null); } catch (e) { m = e.message; }
    ok(m.includes('registri'), 'VDC: stato nullo rifiutato con un messaggio (' + m + ')'); }
  { const f = new Vdc(OWN(), 'PAL'); const z = JSON.parse(json(f.saveState()));
    f.fb.fill(5); f.loadState(z);
    ok(json(f.saveState()) === json(z) && f.fb.every((b) => b === 0), 'VDC: lo stato iniziale (ev = 0, t1i = 0) si carica e lo schermo si azzera'); }
  { const f = new Vdc(OWN(), 'PAL'); f.fb.fill(5); f.loadState(vs); ok(f.fb.every((b) => b === 0), 'VDC: dopo il caricamento lo schermo e\' vuoto (si ridisegna riga per riga)'); }
  { const f = new Vdc(OWN(), 'PAL'); f.loadState(vs); ok(f.nextEv === v.nextEv && f.nextT1 === v.nextT1, 'VDC: dopo il caricamento i prossimi eventi sono quelli dell\'originale'); }
}

// ---------------------------------------------------------------------------------------------------------- 2. ripresa deterministica
function resumeTests(label, mk, startFrames, moreFrames, seed) {
  const inp = inputs(startFrames + moreFrames + 5, seed);
  // (a) salvataggio al confine di fotogramma
  {
    const A = mk();
    for (let f = 0; f < startFrames; f++) { setIn(A, inp[f]); A.runFrame(); }
    const bytes = Console.encodeState(A.saveState());
    const B = mk();
    const w = B.loadState(Console.decodeState(bytes));
    ok(Array.isArray(w) && w.length === 0, label + ': nessun avviso con gli stessi file');
    ok(cpuVec(A.cpu) === cpuVec(B.cpu), label + ': CPU uguale subito dopo il caricamento');
    ok(json(A.saveState()) === json(B.saveState()), label + ': save -> load -> save identico');
    let same = true, firstBad = -1;
    for (let f = startFrames; f < startFrames + moreFrames && same; f++) {
      setIn(A, inp[f]); setIn(B, inp[f]);
      A.runFrame(); B.runFrame();
      if (cpuVec(A.cpu) !== cpuVec(B.cpu) || fbCrc(A) !== fbCrc(B) || json(A.vdc.saveState()) !== json(B.vdc.saveState()) ||
        Buffer.compare(Buffer.from(A.xram), Buffer.from(B.xram)) !== 0) { same = false; firstBad = f; }
    }
    ok(same, label + ': ' + moreFrames + ' fotogrammi dopo la ripresa identici (CPU, schermo, video, RAM)' + (same ? '' : ' - primo diverso: ' + firstBad));
  }
  // (b) salvataggio in un punto qualunque (fra due istruzioni, a meta' fotogramma)
  {
    const A = mk();
    for (let f = 0; f < startFrames; f++) { setIn(A, inp[f]); A.runFrame(); }
    setIn(A, inp[startFrames]);
    const r = rng(seed + 1);
    for (let i = 0; i < 1000 + ((r() * 60000) | 0); i++) A.cpu.step();
    const st = JSON.parse(json(A.saveState()));
    const B = mk();
    B.loadState(st);
    setIn(B, inp[startFrames]);
    let same = true;
    for (let i = 0; i < 40000 && same; i++) {
      A.cpu.step(); B.cpu.step();
      if (i % 50 === 0 && cpuVec(A.cpu) !== cpuVec(B.cpu)) same = false;
    }
    ok(same, label + ': a meta\' fotogramma, 40000 istruzioni dopo la ripresa identiche');
    // lo schermo e' completo dal secondo fotogramma dopo il caricamento
    for (let f = startFrames + 1; f < startFrames + 4; f++) { setIn(A, inp[f]); setIn(B, inp[f]); A.runFrame(); B.runFrame(); }
    setIn(A, inp[startFrames + 4]); setIn(B, inp[startFrames + 4]);
    A.runFrame(); B.runFrame();
    ok(fbCrc(A) === fbCrc(B) && cpuVec(A.cpu) === cpuVec(B.cpu), label + ': schermo e CPU uguali dopo alcuni fotogrammi');
  }
}

function rejectTests(label, mk, mkOther) {
  const A = mk();
  const inp = inputs(20, 3);
  for (let f = 0; f < 12; f++) { setIn(A, inp[f]); A.runFrame(); }
  const good = JSON.parse(json(A.saveState()));
  const B = mk();
  const snap = () => json(B.saveState());
  const base = snap();
  const expectReject = (s, why) => {
    let err = null;
    try { B.loadState(s); } catch (e) { err = e; }
    ok(err instanceof SnapshotError, label + ': rifiutato ' + why + (err && !(err instanceof SnapshotError) ? ' (ma con ' + err.name + ': ' + err.message + ')' : ''));
    ok(snap() === base, label + ': la console non cambia dopo un rifiuto (' + why + ')');
  };
  const mod = (f) => { const s = JSON.parse(json(good)); f(s); return s; };
  expectReject(null, 'stato nullo');
  expectReject(5, 'stato non oggetto');
  expectReject(mod((s) => { s.format = 'altro'; }), 'formato diverso');
  expectReject(mod((s) => { s.version = 99; }), 'versione futura');
  expectReject(mod((s) => { delete s.hashes; }), 'impronte mancanti');
  expectReject(mod((s) => { s.hashes.bios = '0'.repeat(64); }), 'BIOS diverso');
  expectReject(mod((s) => { s.hashes.cart = '1'.repeat(64); }), 'cartuccia diversa');
  expectReject(mod((s) => { s.standard = 'NTSC'; }), 'standard diverso');
  expectReject(mod((s) => { s.xram = s.xram.slice(1); }), 'RAM esterna corta');
  for (const bad of [300, 256, -1, 1.5, 'x', null]) expectReject(mod((s) => { s.xram[3] = bad; }), 'RAM esterna con il valore ' + String(bad));
  // contratto del formato: un file salvato oggi deve restare leggibile domani (cambiare questi valori vuol dire rompere i file)
  ok(good.format === 'o2web-snapshot' && good.version === 4, label + ': formato o2web-snapshot, versione 4 (modulo scacchi C7010; 3: G7400: EF9340/41 e pin B)');
  ok(Object.keys(good).sort().join() === 'cpu,format,hashes,standard,vdc,version,xram', label + ': campi dello stato: ' + Object.keys(good).sort().join());
  ok(Object.keys(good.hashes).sort().join() === 'bios,cart,charset', label + ': impronte: bios, cart, charset');
  // messaggi: dicono che cosa non va
  const msgOf = (s) => { try { B.loadState(s); } catch (e) { return e.message; } return ''; };
  ok(msgOf(mod((s) => { s.version = 99; })).includes('99'), label + ': il messaggio sulla versione dice quale');
  ok(msgOf(mod((s) => { s.standard = 'NTSC'; })).includes('NTSC'), label + ': il messaggio sullo standard dice quale');
  ok(/Stato non valido \(.+\)/.test(msgOf(mod((s) => { s.cpu.pc = 0x2000; }))), label + ': il messaggio sulla CPU riporta il dettaglio');
  // coerenza dei tempi: lo stato e' accettato fino a 3 fotogrammi di distanza fra eventi e tempo della CPU
  {
    const frameEv = 244;
    const evShift = (k) => mod((s) => { s.vdc.ev += k; });
    const accept = (k) => { const T = mk(); try { T.loadState(evShift(k)); return true; } catch (e) { return false; } };
    ok(accept(Math.round(frameEv * 2.5)) && accept(-Math.round(frameEv * 2.5)), label + ': 2,5 fotogrammi di scarto accettati');
    ok(!accept(Math.round(frameEv * 3.5)) && !accept(-Math.round(frameEv * 3.5)), label + ': 3,5 fotogrammi di scarto rifiutati');
    ok(msgOf(evShift(frameEv * 4)).includes('incoerenti'), label + ': il messaggio dice che i tempi sono incoerenti');
    const tShift = (k) => mod((s) => { s.vdc.t1i += k; });
    const acceptT = (k) => { const T = mk(); try { T.loadState(tShift(k)); return true; } catch (e) { return false; } };
    const perFrame = good.vdc.t1i > 0 ? Math.round(good.vdc.t1i / Math.max(1, good.cpu.now / A.frameCycles)) : 486;
    ok(acceptT(Math.round(perFrame * 2.5)) && !acceptT(Math.round(perFrame * 3.6)), label + ': T1: 2,5 fotogrammi accettati, 3,6 rifiutati');
  }
  expectReject(mod((s) => { s.cpu.pc = 0x2000; }), 'PC fuori intervallo');
  expectReject(mod((s) => { delete s.cpu; }), 'CPU mancante');
  expectReject(mod((s) => { s.vdc.reg = s.vdc.reg.slice(2); }), 'registri video corti');
  expectReject(mod((s) => { s.vdc.ev += 4000000; }), 'indice eventi video lontano dal tempo (bloccherebbe sync)');
  expectReject(mod((s) => { s.vdc.t1i += 4000000; }), 'indice T1 lontano dal tempo (bloccherebbe sync)');
  expectReject(mod((s) => { s.cpu.now += 50000000; }), 'tempo della CPU lontano dagli eventi');
  // file illeggibili
  for (const bytes of [new Uint8Array([0xFF, 0xFE, 0x00]), new TextEncoder().encode('{"format":'), new TextEncoder().encode('non json'),
    new Uint8Array(0)]) {
    let err = null;
    try { Console.decodeState(bytes); } catch (e) { err = e; }
    ok(err instanceof SnapshotError, label + ': file illeggibile rifiutato (' + bytes.length + ' byte)');
  }
  // un altro BIOS / un'altra cartuccia (veri): le impronte devono rifiutare
  const O = mkOther();
  for (const [name, o] of Object.entries(O)) {
    let err = null;
    try { o.loadState(good); } catch (e) { err = e; }
    ok(err instanceof SnapshotError, label + ': console con ' + name + ' rifiuta lo stato');
  }
  // il set di caratteri diverso e' solo un avviso
  const cs2 = OWN(); cs2[5] ^= 0xFF;
  const C = mk({charset: cs2});
  let warn = null;
  try { warn = C.loadState(good); } catch (e) { warn = e; }
  ok(Array.isArray(warn) && warn.length === 1, label + ': set di caratteri diverso -> un avviso, stato caricato');
  // lo stato valido si carica sempre, anche dopo i rifiuti
  ok(Array.isArray(B.loadState(good)), label + ': lo stato valido si carica dopo i rifiuti');
}

{
  const {bios, cart} = synth(11, 4);
  const mk = (o) => new Console(Object.assign({bios, cart, charset: OWN(), standard: 'PAL'}, o || {}));
  resumeTests('sintetico PAL', mk, 6, 6, 21);
  const mkN = () => new Console({bios, cart, charset: OWN(), standard: 'NTSC'});
  resumeTests('sintetico NTSC', mkN, 6, 6, 22);
  const s2 = synth(12, 4);
  rejectTests('sintetico', mk, () => ({
    'altro BIOS': new Console({bios: s2.bios, cart, charset: OWN(), standard: 'PAL'}),
    'altra cartuccia': new Console({bios, cart: s2.cart, charset: OWN(), standard: 'PAL'}),
    'nessuna cartuccia': new Console({bios, cart: null, charset: OWN(), standard: 'PAL'}),
    'NTSC': new Console({bios, cart, charset: OWN(), standard: 'NTSC'}),
  }));
}

// ---------------------------------------------------------------------------------------------------------- 3. dump veri (facoltativo)
const dumps = process.argv[2] || process.env.O2_DUMPS;
if (dumps && fs.existsSync(path.join(dumps, 'bios', 'o2rom.bin')) && fs.existsSync(path.join(dumps, 'blockout.bin'))) {
  const bios = new Uint8Array(fs.readFileSync(path.join(dumps, 'bios', 'o2rom.bin')));
  const cart = new Uint8Array(fs.readFileSync(path.join(dumps, 'blockout.bin')));
  const mk = (o) => new Console(Object.assign({bios, cart, charset: OWN(), standard: 'PAL'}, o || {}));
  resumeTests('BIOS+cartuccia veri', mk, 45, 10, 31);
  const other = new Uint8Array(fs.readFileSync(path.join(dumps, 'demonattack.bin')));
  rejectTests('BIOS+cartuccia veri', mk, () => ({'altra cartuccia': new Console({bios, cart: other, charset: OWN(), standard: 'PAL'})}));
} else {
  console.log('INFO  dump veri non indicati: provati solo i dati sintetici');
}

console.log(fails ? 'FALLITI ' + fails + ' controlli (' + passes + ' riusciti)' : 'OK: ' + passes + ' controlli sullo stato');
process.exit(fails ? 1 : 0);
