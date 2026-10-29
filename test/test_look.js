'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_look.js - prove dello strato di aspetto (src/look.js) e della scelta della macchina (src/machines.js).
//  1. impostazioni: validazione, valori di partenza, insiemi pronti
//  2. uscita ESATTA: con tutto spento il risultato e' identico alla conversione di prima (screen.js fbToRgba), anche su un fotogramma vero
//  3. bianco e nero: formula del grigio, canali uguali
//  4. filtri uno per uno su casi costruiti (impulsi, tinte unite): nuclei della sfocatura e dell'alone, decadimento della persistenza,
//     profilo delle righe, schema della maschera, simmetria e angoli della curvatura, guadagno
//  5. CONFRONTO bit per bit con il riferimento indipendente in Python (hw/look_ref.py) sui casi registrati da test/look_record.py
//  6. macchine: scelta dal BIOS / standard / monitor, coerenza con KNOWN_BIOS, disegni SVG (ben formati, senza script ne' rimandi esterni)
// Uso: node test/test_look.js [CARTELLA_CON_look_cases.json] [DUMPS]
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const S = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const Look = require(S('look.js'));
const M = require(S('machines.js'));
const {PALETTE, VIS_W, VIS_H} = require(S('vdc.js'));
const {fbToRgba, paletteRgba32} = require(S('screen.js'));
const {KNOWN_BIOS} = require(S('library.js'));

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL  ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (ottenuto ' + JSON.stringify(a) + ', atteso ' + JSON.stringify(b) + ')');
const throws = (fn, re, msg) => { let m = null; try { fn(); } catch (e) { m = e; } ok(m && re.test(m.message), msg + ' (' + (m ? m.message : 'nessun errore') + ')'); };

function rnd(seed, n, mod) { let s = seed >>> 0; const o = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; o[i] = (s >>> 24) % (mod || 16); } return o; }
const L = (o) => Object.assign({}, Look.LOOK_DEFAULTS, o || {});
const px = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];          // Uint32 little-endian -> R, G, B, A
const flat = (w, h, c) => new Uint8Array(w * h).fill(c);
function pipe(w, h, look) { const p = new Look.LookPipeline(PALETTE, w, h); p.configure(look); return p; }

// ---------------------------------------------------------------- 1. impostazioni
eq(Look.LOOK_DEFAULTS, {mono: false, blur: 0, persist: 0, glow: 0, scan: 0, mask: 0, curve: 0, detail: 3}, 'valori di partenza: tutto spento');
ok(Object.isFrozen(Look.LOOK_DEFAULTS), 'i valori di partenza non si modificano');
eq(Look.normalizeLook(), L(), 'normalizeLook senza argomenti');
eq(Look.normalizeLook({blur: 5}), L({blur: 5}), 'il resto ai valori di partenza');
throws(() => Look.checkLook({blur: 5, volume: 3}), /campo sconosciuto/, 'schema chiuso: chiave sconosciuta rifiutata');
throws(() => Look.checkLook(null), /aspetto non valido/, 'checkLook(null) rifiutato');
eq(Look.checkLook(undefined), {}, 'checkLook(undefined)');
eq(Look.checkLook({scan: 10}), {scan: 10}, 'checkLook ritorna solo le chiavi presenti');
for (const [k, lo, hi] of [['blur', 0, 100], ['persist', 0, 90], ['glow', 0, 100], ['scan', 0, 100], ['mask', 0, 100], ['curve', 0, 100]]) {
  eq(Look.checkLook({[k]: lo}), {[k]: lo}, k + ': minimo ' + lo);
  eq(Look.checkLook({[k]: hi}), {[k]: hi}, k + ': massimo ' + hi);
  throws(() => Look.checkLook({[k]: hi + 1}), /valore non valido/, k + ': oltre il massimo');
  throws(() => Look.checkLook({[k]: lo - 1}), /valore non valido/, k + ': sotto il minimo');
  throws(() => Look.checkLook({[k]: 1.5}), /valore non valido/, k + ': frazionario');
  throws(() => Look.checkLook({[k]: '5'}), /valore non valido/, k + ': testo');
  throws(() => Look.checkLook({[k]: NaN}), /valore non valido/, k + ': NaN');
  throws(() => Look.checkLook({[k]: null}), /valore non valido/, k + ': null');
}
throws(() => Look.checkLook({mono: 1}), /bianco e nero/, 'mono: non booleano');
throws(() => Look.checkLook({detail: 2}), /dettaglio/, 'dettaglio 2');
throws(() => Look.checkLook({detail: 5}), /dettaglio/, 'dettaglio 5');
eq(Look.checkLook({detail: 3}), {detail: 3}, 'dettaglio 3');
eq(Look.checkLook({detail: 4}), {detail: 4}, 'dettaglio 4');
throws(() => Look.checkLook(5), /aspetto non valido/, 'aspetto: numero');
throws(() => Look.checkLook([]), /aspetto non valido/, 'aspetto: array');
throws(() => Look.checkLook('x'), /aspetto non valido/, 'aspetto: testo');
ok(Look.isExact(L()) && !Look.isExact(L({blur: 1})) && !Look.isExact(L({curve: 1})) && Look.isExact(L({mono: true, detail: 4})), 'isExact');
eq([Look.outScale(L()), Look.outScale(L({blur: 9, persist: 9, glow: 9})), Look.outScale(L({scan: 1})), Look.outScale(L({mask: 1, detail: 4})), Look.outScale(L({curve: 1}))], [1, 1, 3, 4, 3], 'outScale');
eq(Look.presetOf(L()), 'esatto', 'insieme: esatto');
eq(Look.presetOf(L({mono: true, detail: 4})), 'esatto', 'insieme: esatto anche in B/N e con altro dettaglio');
eq(Look.presetOf(L(Look.PRESETS.leggero)), 'leggero', 'insieme: leggero');
eq(Look.presetOf(L(Look.PRESETS.anni80)), 'anni80', 'insieme: anni 80');
eq(Look.presetOf(L(Object.assign({}, Look.PRESETS.anni80, {detail: 4}))), 'custom', 'insieme: stesso ma altro dettaglio = personalizzato');
eq(Look.presetOf(L(Object.assign({}, Look.PRESETS.anni80, {scan: 54}))), 'custom', 'insieme: un valore diverso = personalizzato');
eq(Look.presetOf(L({mono: true, scan: 55, blur: 40, persist: 35, glow: 35, mask: 30, curve: 35})), 'anni80', 'insieme: il B/N non conta');
for (const name of Object.keys(Look.PRESETS)) { try { Look.checkLook(Look.PRESETS[name]); passes++; } catch (e) { ok(false, 'insieme valido: ' + name + ' (' + e.message + ')'); } }

// ---- il pulsante «Filtri CRT» sotto lo schermo passa da un insieme pronto al successivo: nessun filtro -> leggero -> anni '80 -> (il personalizzato
// messo da parte, se c'e') -> nessun filtro. nextPreset(look, custom) ritorna {name, look}: look = solo i filtri e il dettaglio (il B/N non si tocca).
{
  const N = Look.nextPreset;
  const flt = (o) => { const r = {}; for (const k of Look.FILTER_KEYS.concat(['detail'])) r[k] = o[k]; return r; };
  eq(N(L()).name, 'leggero', 'ciclo: esatto -> leggero');
  eq(N(L(Look.PRESETS.leggero)).name, 'anni80', 'ciclo: leggero -> anni 80');
  eq(N(L(Look.PRESETS.anni80)).name, 'esatto', 'ciclo: anni 80 -> esatto (senza personalizzato)');
  eq(N(L(Look.PRESETS.anni80), null).name, 'esatto', 'ciclo: anni 80 -> esatto (personalizzato null)');
  eq(N(L(Look.PRESETS.leggero)).look, flt(Look.PRESETS.anni80), 'ciclo: i valori sono quelli dell\'insieme');
  eq(N(L()).look, flt(Look.PRESETS.leggero), 'ciclo: i valori di leggero');
  eq(N(L(Look.PRESETS.anni80)).look, flt(Look.PRESETS.esatto), 'ciclo: i valori di esatto');
  const cus = flt(L({blur: 10, scan: 80, detail: 4}));
  eq(Look.presetOf(cus), 'custom', 'prova: il personalizzato di prova e\' davvero personalizzato');
  eq(N(L(Look.PRESETS.anni80), cus), {name: 'custom', look: cus}, 'ciclo: anni 80 -> personalizzato messo da parte');
  eq(N(L(cus), cus), {name: 'esatto', look: flt(Look.PRESETS.esatto)}, 'ciclo: dal personalizzato -> esatto');
  eq(N(L({blur: 3}), cus).name, 'esatto', 'ciclo: un altro personalizzato -> esatto');
  eq(N(L(), cus).name, 'leggero', 'ciclo: esatto -> leggero anche con un personalizzato messo da parte');
  eq(N(L(Look.PRESETS.leggero), cus).name, 'anni80', 'ciclo: leggero -> anni 80 anche con un personalizzato messo da parte');
  // il B/N non conta ne' si porta via
  eq(N(L({mono: true})).name, 'leggero', 'ciclo: in B/N si cicla uguale');
  ok(!('mono' in N(L({mono: true})).look), 'ciclo: il risultato non contiene il B/N');
  // un personalizzato non valido, uguale a un insieme pronto o con altre chiavi si ignora
  eq(N(L(Look.PRESETS.anni80), flt(Look.PRESETS.leggero)).name, 'esatto', 'ciclo: il «personalizzato» uguale a un insieme pronto si ignora');
  eq(N(L(Look.PRESETS.anni80), flt(Look.PRESETS.esatto)).name, 'esatto', 'ciclo: il «personalizzato» spento si ignora');
  eq(N(L(Look.PRESETS.anni80), {blur: 999}).name, 'esatto', 'ciclo: un personalizzato con valori fuori scala si ignora');
  eq(N(L(Look.PRESETS.anni80), {blur: 10, scan: 80, detail: 9}).name, 'esatto', 'ciclo: un personalizzato col dettaglio sbagliato si ignora');
  eq(N(L(Look.PRESETS.anni80), 'x').name, 'esatto', 'ciclo: un personalizzato che non e\' un oggetto si ignora');
  eq(N(L(Look.PRESETS.anni80), [1]).name, 'esatto', 'ciclo: un personalizzato array si ignora');
  eq(N(L(Look.PRESETS.anni80), Object.assign({sconosciuto: 1}, cus)).name, 'esatto', 'ciclo: un personalizzato con chiavi sconosciute si ignora');
  // il risultato e' una copia: cambiarla non sporca gli insiemi pronti
  const r = N(L());
  r.look.blur = 99;
  eq(Look.PRESETS.leggero.blur, 20, 'ciclo: il risultato e\' una copia (gli insiemi pronti non cambiano)');
  const r2 = N(L(Look.PRESETS.anni80), cus);
  r2.look.blur = 77;
  eq(cus.blur, 10, 'ciclo: anche il personalizzato viene copiato');
  // dopo un giro intero si torna al punto di partenza
  let cur = L(), seen = [];
  for (let i = 0; i < 3; i++) { const n = N(cur); seen.push(n.name); cur = L(n.look); }
  eq(seen, ['leggero', 'anni80', 'esatto'], 'ciclo: tre passi = giro intero');
  eq(Look.presetOf(cur), 'esatto', 'ciclo: ricaduto su esatto');
  // ogni risultato e' una impostazione valida per checkLook
  for (const start of [L(), L(Look.PRESETS.leggero), L(Look.PRESETS.anni80), L(cus)]) { try { Look.checkLook(N(start, cus).look); passes++; } catch (e) { ok(false, 'ciclo: risultato non valido (' + e.message + ')'); } }
  // il nome del passo e' quello che presetOf riconosce sul risultato
  for (const start of [L(), L(Look.PRESETS.leggero), L(Look.PRESETS.anni80)]) { const n = N(start, cus); eq(Look.presetOf(L(n.look)), n.name, 'ciclo: nome coerente con presetOf (' + n.name + ')'); }
}

// ---------------------------------------------------------------- 2. uscita esatta
{
  const fb = rnd(1, VIS_W * VIS_H);
  const p = pipe(VIS_W, VIS_H, L());
  eq([p.k, p.outW, p.outH], [1, 360, 243], 'esatto: 360 x 243');
  const out = p.process(fb);
  const ref = new Uint32Array(VIS_W * VIS_H);
  fbToRgba(fb, paletteRgba32(PALETTE), ref);
  ok(out.length === ref.length && out.every((v, i) => v === ref[i]), 'esatto: identico a fbToRgba (fotogramma casuale)');
  const out2 = new Uint32Array(VIS_W * VIS_H);
  ok(p.process(fb, out2) === out2 && out2.every((v, i) => v === ref[i]), 'esatto: scrive nel buffer dato');
  for (let i = 0; i < 16; i++) { const f1 = flat(VIS_W, VIS_H, i); ok(p.process(f1)[100] === paletteRgba32(PALETTE)[i], 'esatto: colore ' + i); }
  const f16 = new Uint8Array(VIS_W * VIS_H).fill(0xF3);
  ok(p.process(f16)[0] === paletteRgba32(PALETTE)[3], 'esatto: indice & 15');
  // senza argomenti: palette e dimensioni di partenza
  const pd = new Look.LookPipeline();
  ok(pd.w === 360 && pd.h === 243 && pd.process(fb).every((v, i) => v === ref[i]), 'pipeline di partenza: palette del chip, 360 x 243');
  // con altre impostazioni a zero il risultato non cambia (persistenza accesa e poi spenta: memoria azzerata)
  p.configure(L({persist: 50})); p.process(fb); p.configure(L());
  ok(p.process(fb).every((v, i) => v === ref[i]), 'esatto dopo aver spento la persistenza');
  // un fotogramma vero della console (se ci sono i dump)
  const dumps = process.argv[3] || process.env.O2_DUMPS;
  if (dumps && fs.existsSync(path.join(dumps, 'bios/o2rom.bin')) && fs.existsSync(path.join(dumps, 'killerbees.bin'))) {
    const {Console} = require(S('console.js'));
    const charsetOwn = require('../hw/charset_own.js');
    const con = new Console({bios: new Uint8Array(fs.readFileSync(path.join(dumps, 'bios/o2rom.bin'))), cart: new Uint8Array(fs.readFileSync(path.join(dumps, 'killerbees.bin'))),
      charset: new Uint8Array(charsetOwn.build()), standard: 'PAL'});
    for (let i = 0; i < 60; i++) con.runFrame();
    const r2 = new Uint32Array(VIS_W * VIS_H);
    fbToRgba(con.fb, paletteRgba32(PALETTE), r2);
    ok(p.process(con.fb).every((v, i) => v === r2[i]), 'esatto: fotogramma vero della console identico a prima');
    const distinct = new Set(r2).size;
    ok(distinct > 2, 'il fotogramma vero ha piu\' colori (' + distinct + ')');
    // gli stessi filtri sullo stesso fotogramma non lanciano e producono qualcosa di diverso
    const pf = pipe(VIS_W, VIS_H, L(Look.PRESETS.anni80));
    const o3 = pf.process(con.fb);
    ok(o3.length === 1080 * 729 && o3.some((v, i) => v !== 0xFF000000), 'fotogramma vero con il filtro anni 80: 1080 x 729, non nero');
  } else console.log('  (fotogramma vero della console: saltato, servono i dump)');
}

// ---------------------------------------------------------------- 3. bianco e nero
{
  eq([Look.grayOf(0, 0, 0), Look.grayOf(255, 255, 255), Look.grayOf(255, 0, 0), Look.grayOf(0, 255, 0), Look.grayOf(0, 0, 255)], [0, 255, 77, 149, 29], 'grayOf: estremi e primari (150 * 255 + 128 >> 8 = 149)');
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
    ok(Look.grayOf(r, g, b) === Math.floor((77 * r + 150 * g + 29 * b + 128) / 256), 'grayOf formula ' + r + ',' + g + ',' + b);
  }
  const mp = Look.monoPalette(PALETTE);
  ok(mp.length === 16 && mp.every((c) => c[0] === c[1] && c[1] === c[2]), 'monoPalette: canali uguali');
  eq(mp.map((c) => c[0]), [0, 55, 107, 161, 21, 75, 127, 182, 73, 128, 180, 234, 94, 148, 200, 255], 'monoPalette: i sedici grigi (calcolati a mano con la formula)');
  eq(mp[0][0] + ',' + mp[15][0], '0,255', 'nero resta nero, bianco resta bianco');
  const p = pipe(4, 4, L({mono: true}));
  const out = p.process(rnd(3, 16));
  ok(out.every((v) => { const q = px(v); return q[0] === q[1] && q[1] === q[2] && q[3] === 255; }), 'uscita in B/N: R = G = B, opaca');
  const f = new Uint8Array(16); for (let i = 0; i < 16; i++) f[i] = i;
  const o2 = p.process(f);
  for (let i = 0; i < 16; i++) ok(px(o2[i])[0] === mp[i][0], 'B/N: colore ' + i + ' = ' + mp[i][0]);
  // il colore torna se si spegne il B/N
  p.configure(L());
  ok(px(p.process(f)[1])[0] === PALETTE[1][0] && px(p.process(f)[1])[1] === 0, 'spento il B/N tornano i colori');
  // B/N con i filtri: i canali restano uguali dove non c'e' maschera
  const pm = pipe(8, 8, L({mono: true, blur: 50, persist: 30, glow: 40}));
  ok(pm.process(rnd(5, 64)).every((v) => { const q = px(v); return q[0] === q[1] && q[1] === q[2]; }), 'B/N con sfocatura, persistenza e alone: canali uguali');
  const pk = pipe(8, 8, L({mono: true, scan: 50, curve: 30}));
  ok(pk.process(rnd(5, 64)).every((v) => { const q = px(v); return q[0] === q[1] && q[1] === q[2]; }), 'B/N con righe e curvatura: canali uguali');
}

// ---------------------------------------------------------------- 4. filtri su casi costruiti
{
  const W = 9, H = 7, at = (x, y) => y * W + x;
  const imp = (x, y, c) => { const f = new Uint8Array(W * H); f[at(x, y)] = c === undefined ? 15 : c; return f; };
  const rr = (out, x, y, wd) => px(out[y * (wd || W) + x])[0];
  // sfocatura: nucleo [lato, centro, lato] su una riga, nessun effetto in verticale
  for (const b of [1, 25, 50, 100]) {
    const out = pipe(W, H, L({blur: b})).process(imp(4, 3));
    const side = Math.floor(b * 64 / 100), center = 256 - 2 * side;
    eq([rr(out, 3, 3), rr(out, 4, 3), rr(out, 5, 3)].map((v) => v), [(side * 255 + 128) >> 8, (center * 255 + 128) >> 8, (side * 255 + 128) >> 8], 'sfocatura ' + b + ': nucleo');
    ok(rr(out, 2, 3) === 0 && rr(out, 6, 3) === 0 && rr(out, 4, 2) === 0 && rr(out, 4, 4) === 0, 'sfocatura ' + b + ': solo orizzontale e solo ai lati');
  }
  eq(Array.from(pipe(W, H, L({blur: 100})).process(flat(W, H, 15))).every((v) => v === 0xFFFFFFFF), true, 'sfocatura: una tinta unita resta com\'e\'');
  { // bordo: il pixel fuori e' il pixel di bordo
    const out = pipe(W, H, L({blur: 100})).process(imp(0, 0));
    eq([rr(out, 0, 0), rr(out, 1, 0)], [191, 64], 'sfocatura al bordo: il pixel di bordo si ripete (64 * 255 + 128 * 255 + 128 >> 8 = 191)');
  }
  // persistenza: decadimento geometrico a ogni fotogramma, mai sotto la nuova immagine
  for (const per of [1, 50, 90]) {
    const p = pipe(W, H, L({persist: per}));
    let v = 255; const seq = [p.process(imp(4, 3))];
    for (let i = 0; i < 8; i++) seq.push(p.process(new Uint8Array(W * H)));
    const got = seq.map((o) => rr(o, 4, 3));
    const want = [255]; for (let i = 0; i < 8; i++) { v = Math.floor(v * per / 100); want.push(v); }
    eq(got, want, 'persistenza ' + per + ': decadimento');
  }
  { const p = pipe(W, H, L({persist: 90})); p.process(imp(4, 3)); p.reset(); ok(rr(p.process(new Uint8Array(W * H)), 4, 3) === 0, 'persistenza: reset() azzera la memoria'); }
  { const p = pipe(W, H, L({persist: 90})); p.process(imp(4, 3)); p.configure(L({persist: 0})); p.configure(L({persist: 90}));
    ok(rr(p.process(new Uint8Array(W * H)), 4, 3) === 0, 'persistenza: spenta e riaccesa, memoria azzerata'); }
  { const p = pipe(W, H, L({persist: 50})); p.process(imp(4, 3, 7)); const o = p.process(imp(4, 3, 15)); ok(rr(o, 4, 3) === 255, 'persistenza: non scende sotto la nuova immagine'); }
  { // la memoria non contiene l'alone
    const p = pipe(W, H, L({persist: 50, glow: 100})); p.process(imp(4, 3)); const o = p.process(new Uint8Array(W * H));
    const pp = pipe(W, H, L({persist: 50})); pp.process(imp(4, 3)); const o2 = pp.process(new Uint8Array(W * H));
    ok(rr(o2, 4, 3) === 127, 'persistenza senza alone: 127'); ok(rr(o, 4, 3) >= 127 && rr(o, 4, 3) > rr(o2, 4, 3), 'con l\'alone si vede di piu\'');
    ok(rr(o2, 5, 3) === 0, 'persistenza senza alone: i vicini restano neri');
  }
  // alone: 7 x 7 attorno al punto; fuori resta nero
  for (const g of [1, 50, 100]) {
    const out = pipe(W, H, L({glow: g})).process(imp(4, 3));
    const G = Math.floor((255 + 24) / 49), add = Math.floor((G * g * 3 + 200) / 400);
    ok(rr(out, 4, 3) === Math.min(255, 255 + add), 'alone ' + g + ': il punto non supera 255');
    ok(rr(out, 1, 0) === add && rr(out, 7, 6) === add && rr(out, 1, 6) === add && rr(out, 7, 0) === add, 'alone ' + g + ': angoli del quadrato 7 x 7 (' + add + ')');
    const wide = pipe(15, 15, L({glow: g})).process((() => { const f = new Uint8Array(225); f[7 * 15 + 7] = 15; return f; })());
    ok(rr(wide, 4, 4, 15) === add && rr(wide, 10, 10, 15) === add && rr(wide, 3, 7, 15) === 0 && rr(wide, 7, 11, 15) === 0 && rr(wide, 11, 7, 15) === 0, 'alone ' + g + ': oltre 3 pixel non arriva');
  }
  ok(pipe(W, H, L({glow: 100})).process(flat(W, H, 15)).every((v) => v === 0xFFFFFFFF), 'alone: bianco su bianco resta 255');
  eq(Array.from(pipe(W, H, L({glow: 100})).process(new Uint8Array(W * H))).every((v) => v === 0xFF000000), true, 'alone: il nero resta nero');

  // righe (k = 3): profilo del peso lungo la riga e periodicita'
  for (const k of [3, 4]) {
    const w = 4, h = 4;
    const g = pipe(w, h, L({scan: 100, detail: k}));
    const out = g.process(flat(w, h, 8));          // grigio scuro 0x49 = 73
    const base = 0x49;
    const col = (y) => rr(out, 1, y, w * k);
    const gain = Math.min(1.5, 1 / (1 - (100 / 100) / 3));
    const want = (Y) => { const fy = (Y + 0.5) / k - Math.floor((Y + 0.5) / k); const d = Math.abs(2 * fy - 1); const ws = 1 - d * d; return Math.min(255, (base * Math.floor(gain * ws * 256 + 0.5) + 128) >> 8); };
    for (let Y = 0; Y < h * k; Y++) ok(col(Y) === want(Y), 'righe k' + k + ': riga di uscita ' + Y);
    ok(col(0) === col(k) && col(1) === col(k + 1) && col(k - 1) === col(2 * k - 1), 'righe k' + k + ': periodo ' + k);
    if (k === 3) ok(col(1) > col(0) && col(0) === col(2), 'righe k3: il centro e\' piu\' chiaro dei bordi, simmetrico');
    const off0 = pipe(w, h, L({scan: 0, mask: 1, detail: k})).process(flat(w, h, 15));
    ok(off0.length === w * k * h * k, 'dimensione di uscita ' + k);
  }
  { // righe: con scan 1 il peso e' vicino a 1 (niente sparisce)
    const o = pipe(4, 4, L({scan: 1})).process(flat(4, 4, 15));
    ok(o.every((v) => px(v)[0] >= 250), 'righe 1: quasi nessun effetto');
  }
  // maschera: schema R G B (k = 3) e vuoto (k = 4)
  for (const k of [3, 4]) {
    const out = pipe(4, 4, L({mask: 100, detail: k})).process(flat(4, 4, 15));
    const off = (256 - Math.floor(100 * 140 / 100)) / 256;
    const mean = (1 + (k - 1) * off) / k;
    const gain = Math.min(1.5, 1 / mean);
    const wOn = Math.floor(gain * 256 + 0.5), wOff = Math.floor(gain * off * 256 + 0.5);
    for (let s = 0; s < k; s++) {
      const p = px(out[5 * (4 * k) + s]);        // riga 5, colonna s del primo punto
      const w3 = [0, 1, 2].map((c) => (s === c ? wOn : wOff));
      const exp = w3.map((wv) => Math.min(255, (255 * wv + 128) >> 8));
      eq(p.slice(0, 3), exp, 'maschera k' + k + ': sottocolonna ' + s);
    }
    if (k === 3) { const p0 = px(out[0]), p1 = px(out[1]), p2 = px(out[2]); ok(p0[0] > p0[1] && p0[0] > p0[2] && p1[1] > p1[0] && p2[2] > p2[0], 'maschera k3: R poi G poi B'); }
    else { const p3 = px(out[3]); ok(p3[0] === p3[1] && p3[1] === p3[2] && p3[0] < px(out[0])[0], 'maschera k4: la quarta sottocolonna e\' un vuoto'); }
  }
  { // nero resta nero con righe e maschera; peso massimo 1,5 (384 su 256)
    const o = pipe(4, 4, L({scan: 100, mask: 100})).process(new Uint8Array(16));
    ok(o.every((v) => v === 0xFF000000), 'nero resta nero con righe e maschera');
    const plan = Look.buildPlan(4, 4, 3, 100, 100, 0);
    ok(plan.wt.every((v) => v <= 384), 'pesi al massimo 1,5 (384/256)');
  }
  // luminosita' media: con scan 50 il guadagno compensa (grigio medio quasi invariato)
  { const w = 6, h = 6, k = 3; const out = pipe(w, h, L({scan: 50, detail: k})).process(flat(w, h, 7)); // 0xB6 = 182
    let sum = 0; for (const v of out) sum += px(v)[0]; const mean = sum / out.length;
    ok(Math.abs(mean - 182) < 8, 'righe 50: luminosita\' media circa invariata (' + mean.toFixed(1) + ' contro 182)'); }
  // curvatura: simmetrica, angoli neri, nessun angolo nero senza curvatura
  for (const k of [3, 4]) {
    const w = 12, h = 9, Wk = w * k, Hk = h * k;
    const sym = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sym[y * w + x] = (Math.min(x, w - 1 - x) + Math.min(y, h - 1 - y)) % 16;
    const out = pipe(w, h, L({curve: 100, detail: k})).process(sym);
    let sx = true, sy = true;
    for (let Y = 0; Y < Hk; Y++) for (let X = 0; X < Wk; X++) {
      if (out[Y * Wk + X] !== out[Y * Wk + (Wk - 1 - X)]) sx = false;
      if (out[Y * Wk + X] !== out[(Hk - 1 - Y) * Wk + X]) sy = false;
    }
    // la maschera e' a sottocolonne: la simmetria vale con curvatura senza maschera
    ok(sx && sy, 'curvatura k' + k + ': simmetrica in orizzontale e verticale');
    ok(out[0] === 0xFF000000 && out[Wk - 1] === 0xFF000000 && out[(Hk - 1) * Wk] === 0xFF000000 && out[Hk * Wk - 1] === 0xFF000000, 'curvatura k' + k + ': i quattro angoli sono neri');
    ok(out[(Hk >> 1) * Wk + (Wk >> 1)] !== 0xFF000000 || sym[(h >> 1) * w + (w >> 1)] === 0, 'curvatura k' + k + ': il centro c\'e\'');
    const none = pipe(w, h, L({scan: 1, detail: k})).process(flat(w, h, 15));
    ok(none.every((v) => v !== 0xFF000000), 'senza curvatura nessun pixel nero (k' + k + ')');
    const weak = pipe(w, h, L({curve: 1, detail: k})).process(flat(w, h, 15));
    ok(weak.every((v) => v !== 0xFF000000) || weak[0] === 0xFF000000, 'curvatura 1: effetto minimo');
    // piu' curvatura, piu' angoli neri
    const count = (c) => { const o = pipe(w, h, L({curve: c, detail: k})).process(flat(w, h, 15)); let n = 0; for (const v of o) if (v === 0xFF000000) n++; return n; };
    ok(count(20) <= count(60) && count(60) <= count(100) && count(100) > 0, 'curvatura k' + k + ': piu\' curvatura, piu\' pixel neri (' + [count(20), count(60), count(100)] + ')');
  }
  // tabelle: dimensioni, indici dentro il fotogramma
  { const pl = Look.buildPlan(10, 6, 4, 40, 40, 60);
    ok(pl.w === 40 && pl.h === 24 && pl.srcIdx.length === 960 && pl.wt.length === 2880, 'buildPlan: dimensioni');
    ok(pl.srcIdx.every((i) => i === -1 || (i >= 0 && i < 60)), 'buildPlan: indici sorgente dentro il fotogramma');
    const flatPlan = Look.buildPlan(10, 6, 3, 0, 0, 0);
    ok(flatPlan.srcIdx.every((s, o) => s === Math.floor((o / 30 | 0) / 3) * 10 + Math.floor((o % 30) / 3)), 'buildPlan senza curvatura: ogni punto diventa k x k pixel');
    ok(flatPlan.wt.every((v) => v === 256), 'buildPlan tutto spento: peso 1');
  }
  // configure parziale / cambiare le impostazioni a meta'
  { const p = new Look.LookPipeline(PALETTE, 6, 4); p.configure({scan: 40});
    eq([p.k, p.outW, p.outH], [3, 18, 12], 'configure: righe -> 3 x');
    p.configure({scan: 40, detail: 4}); eq([p.k, p.outW, p.outH], [4, 24, 16], 'configure: dettaglio 4');
    p.configure({blur: 30}); eq([p.k, p.outW, p.outH], [1, 6, 4], 'configure: tornano i valori di partenza per le chiavi mancanti');
    throws(() => p.configure({blur: 101}), /sfocatura/, 'configure: valore sbagliato rifiutato');
    eq([p.look.blur, p.k], [30, 1], 'configure: dopo l\'errore resta quello di prima');
    throws(() => p.process(new Uint8Array(5)), /dimensione/, 'process: fotogramma di dimensione sbagliata');
    throws(() => p.process([1, 2, 3]), /dimensione/, 'process: non e\' un Uint8Array');
    throws(() => p.process(new Uint8Array(24), new Uint32Array(5)), /uscita/, 'process: uscita di dimensione sbagliata');
    throws(() => new Look.LookPipeline([[0, 0, 0]]), /16 colori/, 'palette sbagliata');
  }
  // lo stesso fotogramma due volte con persistenza 0 da' lo stesso risultato (nessuno stato nascosto)
  { const w = 10, h = 8, fb = rnd(21, w * h); const p = pipe(w, h, L({blur: 40, glow: 30, scan: 50, mask: 30, curve: 20}));
    const a = Uint32Array.from(p.process(fb)), b = Uint32Array.from(p.process(fb));
    ok(a.every((v, i) => v === b[i]), 'senza persistenza: nessuna memoria tra un fotogramma e l\'altro'); }
  // ordine dei passi: sfocatura, poi persistenza, poi alone, poi righe/maschera/curvatura
  { const w = 9, h = 7; const p = pipe(w, h, L({blur: 100, persist: 50}));
    p.process((() => { const f = new Uint8Array(w * h); f[3 * w + 4] = 15; return f; })());
    const o = p.process(new Uint8Array(w * h));
    const side = 64, center = 128;
    const first = [(side * 255 + 128) >> 8, (center * 255 + 128) >> 8];
    eq([rr(o, 3, 3, w), rr(o, 4, 3, w)], [Math.floor(first[0] * 50 / 100), Math.floor(first[1] * 50 / 100)], 'ordine: la persistenza ricorda l\'immagine GIA\' sfocata'); }
}

// aritmetica dell'alone: floor(x / 49) = (x * 21400) >> 20 per ogni somma possibile (al piu' 49 * 255 + 24) e tabella del contributo
{
  let bad = 0;
  for (let x = 0; x <= 49 * 255 + 24; x++) if (((x * 21400) >> 20) !== Math.floor(x / 49)) bad++;
  ok(bad === 0, 'divisione per 49 con moltiplicazione e scorrimento: esatta per tutte le somme possibili (' + bad + ' errori)');
  // tabella del contributo: per ogni media G e ogni valore di alone, quanto si somma
  const p = pipe(3, 3, L({glow: 100}));
  const imp = new Uint8Array(9); imp[4] = 15;
  ok(p.process(imp).length === 9, 'alone su 3 x 3');
  for (const g of [1, 17, 50, 99, 100]) {
    const q = new Look.LookPipeline(PALETTE, 7, 7); q.configure(L({glow: g}));
    const f = new Uint8Array(49); f.fill(8);          // grigio 0x49 = 73 ovunque
    const o = q.process(f);
    const G = 73, add = Math.floor((Math.floor((49 * 73 + 24) / 49) * g * 3 + 200) / 400);
    ok(o.every((v) => px(v)[0] === Math.min(255, G + add)), 'alone ' + g + ' su tinta unita: ' + G + ' + ' + add);
  }
}


// ---------------------------------------------------------------- 4b. tabelle e arrotondamenti su TUTTI i valori (tavolozza fatta apposta)
{
  const grey = (v) => { const pal = []; for (let i = 0; i < 16; i++) pal.push([v, v, v]); return pal; };
  // grigio B/N: formula su una griglia di colori
  let badGray = 0;
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (let b = 0; b < 256; b += 5) if (Look.grayOf(r, g, b) !== Math.floor((77 * r + 150 * g + 29 * b + 128) / 256)) badGray++;
  ok(badGray === 0, 'grigio: formula (' + badGray + ' diversi)');
  eq([Look.grayOf(0, 0, 0), Look.grayOf(255, 255, 255), Look.grayOf(255, 0, 0), Look.grayOf(0, 0, 255), Look.grayOf(1, 1, 1), Look.grayOf(3, 0, 0)], [0, 255, 77, 29, 1, 1], 'grigio: valori noti');
  // alone: ogni (valore, intensita') su una tinta unita 7 x 7 (la media e' il valore stesso)
  let badGlow = 0;
  for (let g = 1; g <= 100; g++) {
    const q = new Look.LookPipeline(grey(0), 1, 1);
    for (let v = 0; v < 256; v += (g % 3 === 0 ? 1 : 3)) {
      const pal = grey(v); const qq = new Look.LookPipeline(pal, 1, 1); qq.configure({glow: g});
      const got = px(qq.process(new Uint8Array(1))[0])[0], want = Math.min(255, v + Math.floor((v * g * 3 + 200) / 400));
      if (got !== want) badGlow++;
    }
    void q;
  }
  ok(badGlow === 0, 'alone: tabella su tutte le intensita\' (' + badGlow + ' diversi)');
  // persistenza: dopo una luce v e un fotogramma nero resta floor(v * p / 100)
  let badDecay = 0;
  for (let pp = 1; pp <= 90; pp++) for (let v = 0; v < 256; v += 1) {
    if (pp % 7 && v % 5) continue;
    const pal = grey(0); pal[1] = [v, v, v]; const qq = new Look.LookPipeline(pal, 1, 1); qq.configure({persist: pp});
    qq.process(Uint8Array.of(1)); const got = px(qq.process(Uint8Array.of(0))[0])[0];
    if (got !== Math.floor(v * pp / 100)) badDecay++;
  }
  ok(badDecay === 0, 'persistenza: decadimento su tutte le intensita\' (' + badDecay + ' diversi)');
  // sfocatura: ogni terna (sinistra, centro, destra) di un campione, con la formula dei coefficienti
  let badBlur = 0, st = 12345;
  for (const bl of [1, 2, 3, 17, 50, 51, 99, 100]) {
    const side = Math.floor(bl * 64 / 100), center = 256 - 2 * side;
    for (let t = 0; t < 600; t++) {
      st = (Math.imul(st, 1664525) + 1013904223) >>> 0; const a = st >>> 24; st = (Math.imul(st, 1664525) + 1013904223) >>> 0; const b = st >>> 24; st = (Math.imul(st, 1664525) + 1013904223) >>> 0; const c = st >>> 24;
      const pal = grey(0); pal[1] = [a, a, a]; pal[2] = [b, b, b]; pal[3] = [c, c, c];
      const qq = new Look.LookPipeline(pal, 3, 1); qq.configure({blur: bl});
      const got = px(qq.process(Uint8Array.of(1, 2, 3))[1])[0];
      if (got !== ((side * (a + c) + center * b + 128) >> 8)) badBlur++;
    }
  }
  ok(badBlur === 0, 'sfocatura: arrotondamento su terne casuali (' + badBlur + ' diversi)');
  // i valori pronti sono quelli dichiarati
  eq(Look.PRESETS, {esatto: {blur: 0, persist: 0, glow: 0, scan: 0, mask: 0, curve: 0, detail: 3}, leggero: {blur: 20, persist: 15, glow: 15, scan: 35, mask: 15, curve: 0, detail: 3},
    anni80: Look.PRESETS.anni80}, 'insiemi pronti: esatto e leggero');
  for (const k of Object.keys(Look.PRESETS)) eq(Look.presetOf(Object.assign({mono: false}, Look.PRESETS[k])), k, 'presetOf riconosce ' + k);
  // dopo aver spento la persistenza la memoria e' vuota: riaccesa non resta nessun fantasma
  { const pal = grey(0); pal[1] = [200, 200, 200]; const qq = new Look.LookPipeline(pal, 2, 1);
    qq.configure({persist: 60}); qq.process(Uint8Array.of(1, 1));
    qq.configure({persist: 0}); qq.process(Uint8Array.of(0, 0));
    qq.configure({persist: 60}); const o = qq.process(Uint8Array.of(0, 0));
    ok(px(o[0])[0] === 0 && px(o[1])[0] === 0, 'persistenza spenta e riaccesa: nessun fantasma');
    qq.process(Uint8Array.of(1, 1)); qq.reset(); const o2 = qq.process(Uint8Array.of(0, 0));
    ok(px(o2[0])[0] === 0, 'reset(): la memoria si svuota'); }
  // cambiare l'intensita' della persistenza (cursore) NON svuota la memoria
  { const pal = grey(0); pal[1] = [200, 200, 200]; const qq = new Look.LookPipeline(pal, 1, 1);
    qq.configure({persist: 60}); qq.process(Uint8Array.of(1));
    qq.configure({persist: 50}); ok(px(qq.process(Uint8Array.of(0))[0])[0] === 100, 'persistenza: spostare il cursore conserva la memoria'); }
  // il piano di maschera/righe/curvatura si riusa se i parametri non cambiano e si rifa se cambiano
  { const qq = new Look.LookPipeline(PALETTE, 6, 4); qq.configure({scan: 40}); const p1 = qq.plan;
    qq.configure({scan: 40, blur: 10}); ok(qq.plan === p1, 'piano riusato se i parametri del passo 4 non cambiano');
    qq.configure({scan: 41}); ok(qq.plan !== p1, 'piano rifatto se cambia un parametro');
    qq.configure({}); ok(qq.plan === null, 'passo 4 spento: nessun piano'); }
}


// ---------------------------------------------------------------- 4c. Screen (colla tra la pipeline e il canvas) con un canvas finto
{
  const {Screen} = require(S('screen.js'));
  function fakeCanvas() {
    const cls = new Set(), puts = [];
    const ctx = {createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}), putImageData: (img, x, y) => puts.push({img, x, y, copy: Uint8ClampedArray.from(img.data)})};
    return {width: 0, height: 0, classList: {toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); }, has: (c) => cls.has(c)}, getContext: (t, o) => { puts.opts = o; return ctx; }, puts, cls};
  }
  const cv = fakeCanvas(), sc = new Screen(cv);
  eq([cv.width, cv.height, cv.cls.has('smooth')], [VIS_W, VIS_H, false], 'Screen: canvas 360 x 243, senza «smooth», a filtri spenti');
  ok(cv.puts.opts && cv.puts.opts.alpha === false, 'Screen: contesto senza canale alfa');
  const fb = rnd(77, VIS_W * VIS_H, 16);
  sc.paint(fb);
  ok(cv.puts.length === 1 && cv.puts[0].x === 0 && cv.puts[0].y === 0, 'Screen: putImageData in (0, 0)');
  const ref = new Uint32Array(VIS_W * VIS_H); fbToRgba(fb, paletteRgba32(PALETTE), ref);
  ok(Buffer.compare(Buffer.from(cv.puts[0].copy.buffer), Buffer.from(ref.buffer)) === 0, 'Screen: uscita identica a fbToRgba con tutto spento');
  ok(sc.last === fb, 'Screen: ricorda l\'ultimo fotogramma');
  sc.setLook({scan: 50}); // k = 3
  eq([cv.width, cv.height, cv.cls.has('smooth'), sc.img.width, sc.img.height], [VIS_W * 3, VIS_H * 3, true, VIS_W * 3, VIS_H * 3], 'Screen: righe -> canvas 3 x e «smooth»');
  ok(cv.puts.length === 2 && cv.puts[1].copy.length === VIS_W * 3 * VIS_H * 3 * 4, 'Screen: setLook ridisegna l\'ultimo fotogramma (anche in pausa)');
  sc.setLook({scan: 50, detail: 4});
  eq([cv.width, cv.height, cv.puts.length], [VIS_W * 4, VIS_H * 4, 3], 'Screen: dettaglio 4 -> canvas 4 x');
  sc.setLook({}); // tutto spento
  eq([cv.width, cv.height, cv.cls.has('smooth'), cv.puts.length], [VIS_W, VIS_H, false, 4], 'Screen: di nuovo esatto, «smooth» tolto');
  ok(Buffer.compare(Buffer.from(cv.puts[3].copy.buffer), Buffer.from(ref.buffer)) === 0, 'Screen: ritorno all\'uscita esatta');
  const cv2 = fakeCanvas(), s2 = new Screen(cv2); s2.setLook({blur: 10}); ok(cv2.puts.length === 0, 'Screen: senza fotogramma, setLook non disegna');
  // persistenza: resetLook svuota
  const pal = []; for (let i = 0; i < 16; i++) pal.push(i === 1 ? [200, 200, 200] : [0, 0, 0]);
  const cv3 = fakeCanvas(), s3 = new Screen(cv3, pal);
  s3.setLook({persist: 60});
  s3.paint(new Uint8Array(VIS_W * VIS_H).fill(1)); s3.resetLook(); s3.paint(new Uint8Array(VIS_W * VIS_H));
  ok(cv3.puts[1].copy[0] === 0, 'Screen: resetLook toglie la scia');
  const cv4 = fakeCanvas(), s4 = new Screen(cv4, pal); s4.setLook({persist: 60});
  s4.paint(new Uint8Array(VIS_W * VIS_H).fill(1)); s4.paint(new Uint8Array(VIS_W * VIS_H));
  ok(cv4.puts[1].copy[0] === 120, 'Screen: senza reset la scia resta (120 = 200 x 60%)');
  // palette passata: usata al posto di quella vera
  const cv5 = fakeCanvas(), s5 = new Screen(cv5, pal); s5.paint(new Uint8Array(VIS_W * VIS_H).fill(1));
  eq([cv5.puts[0].copy[0], cv5.puts[0].copy[3]], [200, 255], 'Screen: usa la palette data');
}

// ---------------------------------------------------------------- 5. confronto con il riferimento Python
{
  const dir = process.argv[2];
  const file = dir && path.join(dir, 'look_cases.json');
  if (file && fs.existsSync(file)) {
    const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
    let pixels = 0, frames = 0, fullFrames = 0;
    for (const c of cases) {
      const p = new Look.LookPipeline(c.palette || PALETTE, c.w, c.h);
      p.configure(c.look);
      c.frames.forEach((fr, i) => {
        const out = p.process(Uint8Array.from(fr));
        const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        const ex = c.expect[i];
        const W = p.outW;
        let got;
        if (ex.rows) {
          const parts = ex.rows.map((Y) => bytes.subarray(Y * W * 4, (Y + 1) * W * 4));
          got = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
          let o = 0; for (const x of parts) { got.set(x, o); o += x.length; }
        } else got = bytes;
        if (ex.sha) {
          const h = crypto.createHash('sha256').update(got).digest('hex');
          ok(h === ex.sha, c.name + ' (fotogramma ' + i + '): impronta diversa dal riferimento');
          fullFrames++;
        } else {
          const want = Buffer.from(ex.b64, 'base64');
          let bad = -1;
          if (want.length !== got.length) ok(false, c.name + ' (fotogramma ' + i + '): lunghezza ' + got.length + ' contro ' + want.length);
          else {
            for (let j = 0; j < got.length; j++) if (got[j] !== want[j]) { bad = j; break; }
            if (bad >= 0) {
              const pxIdx = bad >> 2, row = ex.rows ? ex.rows[Math.floor(pxIdx / W)] : Math.floor(pxIdx / W), col = pxIdx % W;
              ok(false, c.name + ' (fotogramma ' + i + '): pixel (' + col + ', ' + row + ') canale ' + (bad & 3) + ': ' + got[bad] + ' contro ' + want[bad] + ' del riferimento');
            } else passes++;
          }
        }
        pixels += got.length >> 2; frames++;
      });
    }
    console.log('  riferimento Python: ' + cases.length + ' casi, ' + frames + ' fotogrammi (' + fullFrames + ' interi a piena risoluzione con impronta), ' + pixels + ' pixel confrontati');
    ok(cases.length >= 40 && frames >= 80, 'confronto con il riferimento: numero di casi e di fotogrammi (' + cases.length + ' / ' + frames + ')');
  } else console.log('  (confronto con il riferimento Python: saltato, serve la cartella preparata da test/look_record.py)');
}

// ---------------------------------------------------------------- 6. macchine
{
  const sha = (name) => Object.keys(KNOWN_BIOS).find((k) => KNOWN_BIOS[k].label.indexOf(name) >= 0);
  const shaG7000 = sha('Odyssey 2'), shaC52 = sha('C52'), shaG7400 = sha('G7400'), shaJopac = sha('Jopac');
  ok(shaG7000 && shaC52 && shaG7400 && shaJopac, 'KNOWN_BIOS: quattro BIOS noti');
  eq(Object.keys(M.BIOS_MACHINE).sort(), Object.keys(KNOWN_BIOS).sort(), 'machines.js e library.js conoscono gli stessi BIOS');
  eq([M.biosMachine(shaG7000), M.biosMachine(shaC52), M.biosMachine(shaJopac), M.biosMachine(shaG7400), M.biosMachine('x'), M.biosMachine('toString'), M.biosMachine('__proto__')], ['g7000', 'c52', 'jopac', 'g7400', null, null, null], 'biosMachine');
  eq(M.KINDS, ['odyssey2', 'g7000', 'g7200', 'c52', 'jopac', 'g7400'], 'le sei macchine');
  ok(M.KINDS.every((k) => typeof M.LABELS[k] === 'string' && M.LABELS[k].length > 5) && Object.keys(M.LABELS).length === 6, 'ogni macchina ha un nome');
  const pk = (o) => { const r = M.pickMachine(o); return r && r.kind; };
  eq(pk({sha: shaG7000, standard: 'NTSC'}), 'odyssey2', 'BIOS G7000 + NTSC = Odyssey 2');
  eq(pk({sha: shaG7000, standard: 'PAL'}), 'g7000', 'BIOS G7000 + PAL = Videopac G7000');
  eq(pk({sha: shaG7000, standard: 'PAL', mono: true}), 'g7200', 'BIOS G7000 + PAL + B/N = G7200');
  eq(pk({sha: shaG7000, standard: 'NTSC', mono: true}), 'g7200', 'BIOS G7000 + NTSC + B/N = G7200');
  eq(pk({sha: shaC52, standard: 'PAL'}), 'c52', 'C52');
  eq(pk({sha: shaC52, standard: 'NTSC', mono: true}), 'c52', 'C52 resta C52 anche in B/N');
  eq(pk({sha: shaJopac, standard: 'PAL'}), 'jopac', 'Jopac');
  eq(pk({sha: shaG7400, standard: 'NTSC'}), 'g7400', 'G7400');
  eq(pk({sha: 'f'.repeat(64), standard: 'PAL'}), 'g7000', 'BIOS sconosciuto PAL: provato come G7000');
  eq(pk({sha: 'f'.repeat(64), standard: 'NTSC'}), 'odyssey2', 'BIOS sconosciuto NTSC');
  eq(pk({sha: 'f'.repeat(64), standard: 'PAL', mono: true}), 'g7200', 'BIOS sconosciuto in B/N');
  eq(pk({sha: shaG7000}), 'g7000', 'standard mancante = PAL');
  eq(M.pickMachine({standard: 'PAL'}), null, 'nessun BIOS: nessuna macchina');
  eq(M.pickMachine({sha: '', standard: 'PAL'}), null, 'BIOS vuoto: nessuna macchina');
  eq(M.pickMachine(), null, 'nessun argomento');
  eq(pk({sha: shaG7000, standard: 'PAL', override: 'jopac'}), 'jopac', 'scelta a mano vince');
  eq(pk({override: 'g7400'}), 'g7400', 'scelta a mano anche senza BIOS');
  eq(pk({sha: shaG7000, standard: 'PAL', override: 'auto'}), 'g7000', 'override auto = automatico');
  throws(() => M.pickMachine({sha: shaG7000, override: 'zx81'}), /sconosciuta/, 'macchina sconosciuta rifiutata');
  eq([M.pickMachine({sha: shaG7000, standard: 'NTSC'}).auto, M.pickMachine({override: 'c52'}).auto], [true, false], 'auto vero / falso');
  ok(/dal BIOS e dallo standard NTSC/.test(M.pickMachine({sha: shaG7000, standard: 'NTSC'}).why), 'spiegazione: BIOS e standard');
  ok(/sconosciuto/.test(M.pickMachine({sha: 'a'.repeat(64), standard: 'PAL'}).why), 'spiegazione: BIOS sconosciuto');
  ok(/bianco e nero/.test(M.pickMachine({sha: shaG7000, mono: true}).why), 'spiegazione: monitor in bianco e nero');
  eq(M.pickMachine({override: 'c52'}).why, 'scelta a mano', 'spiegazione: a mano');
  // disegni
  const svgs = {};
  for (const k of M.KINDS) {
    const s = M.machineSvg(k); svgs[k] = s;
    ok(typeof s === 'string' && s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 ') && s.endsWith('</svg>'), 'SVG ' + k + ': radice');
    ok(!/<script|<image|<foreignObject|<style|<text|<a[ >]|href|xlink|url\(|\bid=|on[a-z]+=|javascript:|data:|http:\/\/(?!www\.w3\.org)/i.test(s), 'SVG ' + k + ': niente script, immagini, scritte, rimandi o id');
    ok(s.includes('<title>' + M.LABELS[k] + '</title>') && s.includes('role="img"') && /aria-label="[^"]+"/.test(s), 'SVG ' + k + ': titolo e testo alternativo');
    ok(s.length > 2000 && s.length < 20000, 'SVG ' + k + ': dimensione ragionevole (' + s.length + ')');
    ok(M.machineSvg(k) === s, 'SVG ' + k + ': stesso risultato a ogni chiamata');
  }
  eq(new Set(Object.values(svgs)).size, 6, 'i sei disegni sono tutti diversi');
  ok(svgs.g7200.includes('viewBox="0 0 320 228"') && svgs.g7000.includes('viewBox="0 0 320 200"'), 'il G7200 e\' piu\' alto (monitor)');
  ok(svgs.g7200.includes('#f4f4f4') && !svgs.g7000.includes('#f4f4f4'), 'solo il G7200 ha il monitor con le barre di grigio');
  throws(() => M.machineSvg('zx81'), /sconosciuta/, 'disegno di una macchina sconosciuta: errore');
  // ben formati: li legge un parser XML vero (Python)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'o2svg-'));
  for (const k of M.KINDS) fs.writeFileSync(path.join(tmp, k + '.svg'), svgs[k]);
  const script = 'import sys, glob, xml.etree.ElementTree as ET\n' +
    'bad = 0\n' +
    'for f in sorted(glob.glob(sys.argv[1] + "/*.svg")):\n' +
    '    r = ET.parse(f).getroot()\n' +
    '    tags = {e.tag.split("}")[-1] for e in r.iter()}\n' +
    '    allowed = {"svg", "title", "path", "rect", "ellipse", "circle"}\n' +
    '    if not tags <= allowed: print("tag non ammessi", f, tags - allowed); bad += 1\n' +
    '    if r.get("viewBox") is None: print("manca viewBox", f); bad += 1\n' +
    'sys.exit(1 if bad else 0)\n';
  const r = cp.spawnSync('python3', ['-I', '-c', script, tmp], {encoding: 'utf8'});
  if (r.error) console.log('  (XML dei disegni: saltato, manca python3)');
  else ok(r.status === 0, 'SVG: ben formati e con soli elementi di disegno (' + (r.stdout || '') + (r.stderr || '').slice(0, 200) + ')');
  fs.rmSync(tmp, {recursive: true, force: true});
  // velocita' (solo informativa: nessuna ottimizzazione senza misura)
  const bench = (label, look, n) => {
    const p = pipe(VIS_W, VIS_H, look), fb = rnd(7, VIS_W * VIS_H), out = new Uint32Array(p.outW * p.outH);
    p.process(fb, out);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) p.process(fb, out);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    console.log('  misura: ' + label + ': ' + ms.toFixed(2) + ' ms per fotogramma (' + p.outW + ' x ' + p.outH + ')');
  };
  if (process.env.O2_LOOK_BENCH !== '0') {
    bench('esatto', L(), 20);
    bench('sfocatura + persistenza + alone', L({blur: 40, persist: 35, glow: 35}), 10);
    bench('righe + maschera, k3', L({scan: 55, mask: 30}), 10);
    bench('tutto acceso, k4', L(Object.assign({}, Look.PRESETS.anni80, {detail: 4})), 10);
  }
}

console.log(fails ? 'FALLITI ' + fails + ' controlli (' + passes + ' riusciti)' : 'OK: ' + passes + ' controlli sull\'aspetto e sulle macchine');
process.exit(fails ? 1 : 0);
