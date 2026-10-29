'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// machines.js - quale MACCHINA mostrare (dal BIOS in uso, dallo standard video e dalla scelta del monitor) e il suo DISEGNO.
// I disegni sono ORIGINALI, fatti da zero con forme e colori inventati (una cuneo con tastiera a membrana, cartuccia, due joystick,
// per il G7200 un monitor incorporato): nessuna fotografia, nessun logo o scritta dei produttori, nessun file immagine. Sono
// stilizzazioni generiche per riconoscere a colpo d'occhio la macchina, NON riproduzioni fedeli: i colori e le proporzioni di
// ciascun modello vero sono DA VERIFICARE. Il disegno e' una stringa SVG senza script, senza collegamenti esterni, senza id.
//   KINDS, LABELS                        le sei macchine
//   biosMachine(sha)                     'g7000' (famiglia G7000 / Odyssey 2) | 'c52' | 'jopac' | 'g7400' | null se il BIOS non e' noto
//   pickMachine({sha, standard, mono, override}) -> {kind, auto, why} oppure null (nessun BIOS)
//   machineSvg(kind) -> stringa SVG
//   fitsBios(kind, sha)                  vero se quel BIOS puo' far girare quella macchina (famiglia G7000: G7000 / Odyssey 2 / G7200 e BIOS sconosciuti)
//   defaultStandard(kind), isMono(kind), NEEDS   standard video e schermo B/N di ogni macchina, e che cosa manca se non c'e' il BIOS
//
// Come si sceglie (scelta della tappa 4b, da confermare): lo stesso BIOS e' dell'Odyssey 2 (USA) e del Videopac G7000 (Europa), quindi
// a parita' di BIOS decide lo standard video (NTSC = Odyssey 2, PAL = Videopac G7000); con «Monitor in bianco e nero» la famiglia
// G7000 diventa il G7200 (monitor B/N incorporato). C52, Jopac e G7400 si riconoscono dall'impronta del BIOS. Un BIOS sconosciuto si
// tratta come G7000 (e' cosi' che lo prova l'emulatore). La scelta a mano (override) vince su tutto.
const KINDS = ['odyssey2', 'g7000', 'g7200', 'c52', 'jopac', 'g7400'];
const LABELS = {
  odyssey2: 'Magnavox Odyssey² (USA)',
  g7000: 'Philips Videopac G7000 (Europa)',
  g7200: 'Philips Videopac G7200 (monitor in bianco e nero)',
  c52: 'Philips C52 (Francia)',
  jopac: 'Brandt Jopac (Francia)',
  g7400: 'Philips Videopac+ G7400 (Europa)',
};

// impronte SHA-256 dei BIOS noti (le stesse di library.js KNOWN_BIOS: un test controlla che coincidano)
const BIOS_MACHINE = {
  'cb0c5d9ed64f7c1d8870333451832638885b9aa3d7013f0c05fd2a20a5e5bfef': 'g7000',
  '2ab1b2c7f4b28a74d0ecf3e073088fac19ce40866404420c70576e1862bb5502': 'c52',
  '8e0413c324a748ca2e493652b8089aa1db129e1ba115b5f58a99e32cebe063e1': 'g7400',
  'dd48b75c56dbe1524dee18defa448a74f648653eb209ccba93066a7a0fe6a074': 'jopac',
};

function biosMachine(sha) { return Object.prototype.hasOwnProperty.call(BIOS_MACHINE, sha) ? BIOS_MACHINE[sha] : null; }

function pickMachine(o) {
  o = o || {};
  if (o.override && o.override !== 'auto') {
    if (!KINDS.includes(o.override)) throw new Error('macchina sconosciuta: ' + o.override);
    return {kind: o.override, auto: false, why: 'scelta a mano'};
  }
  if (typeof o.sha !== 'string' || !o.sha) return null;
  const base = biosMachine(o.sha);
  if (base === 'c52' || base === 'jopac' || base === 'g7400') return {kind: base, auto: true, why: 'dal BIOS'};
  const known = base === 'g7000';
  const ntsc = o.standard === 'NTSC';
  if (o.mono) return {kind: 'g7200', auto: true, why: 'monitor in bianco e nero' + (known ? '' : ' (BIOS sconosciuto, provato come G7000)')};
  return {kind: ntsc ? 'odyssey2' : 'g7000', auto: true,
    why: (known ? 'dal BIOS' : 'BIOS sconosciuto, provato come G7000') + ' e dallo standard ' + (ntsc ? 'NTSC' : 'PAL')};
}

// ---------------------------------------------------------------- la macchina come scelta unica (tappa 5c)
// Nella pagina si sceglie la MACCHINA, non il BIOS: ogni macchina fissa BIOS, standard video e schermo.
//   Odyssey 2 = BIOS G7000 + NTSC; Videopac G7000 = BIOS G7000 + PAL; Videopac G7200 = BIOS G7000 + PAL + schermo in bianco e nero;
//   C52, Jopac e G7400 = il loro BIOS (PAL). I BIOS sconosciuti (1024 byte) servono alla famiglia G7000, come prima.
const FAMILY = {odyssey2: 'g7000', g7000: 'g7000', g7200: 'g7000', c52: 'c52', jopac: 'jopac', g7400: 'g7400'};
const NEEDS = {
  odyssey2: 'manca il BIOS Odyssey\u00B2 / Videopac G7000 (1024 byte)',
  g7000: 'manca il BIOS Odyssey\u00B2 / Videopac G7000 (1024 byte)',
  g7200: 'manca il BIOS Odyssey\u00B2 / Videopac G7000 (1024 byte)',
  c52: 'manca il BIOS C52',
  jopac: 'manca il BIOS Jopac',
  g7400: 'manca il BIOS Videopac+ G7400',
};
function fitsBios(kind, sha) {
  if (!Object.prototype.hasOwnProperty.call(FAMILY, kind)) throw new Error('macchina sconosciuta: ' + kind);
  const base = biosMachine(sha);
  return FAMILY[kind] === 'g7000' ? (base === 'g7000' || base === null) : base === FAMILY[kind];
}
function defaultStandard(kind) {
  if (!Object.prototype.hasOwnProperty.call(FAMILY, kind)) throw new Error('macchina sconosciuta: ' + kind);
  return kind === 'odyssey2' ? 'NTSC' : 'PAL';
}
function isMono(kind) {
  if (!Object.prototype.hasOwnProperty.call(FAMILY, kind)) throw new Error('macchina sconosciuta: ' + kind);
  return kind === 'g7200';
}

// ---------------------------------------------------------------- disegno
// geometria in un riquadro 320 x 200 (vista leggermente dall'alto)
function lerp(a, b, t) { return a + (b - a) * t; }
function f(n) { return String(Math.round(n * 10) / 10); }
function poly(pts, fill, extra) {
  return '<path d="M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L') + ' Z" fill="' + fill + '"' + (extra || '') + '/>';
}

// stile di ogni macchina: colori e forme inventati
const STYLE = {
  odyssey2: {body: '#2b2c33', deck: '#3b3c45', keys: '#d9dbe0', key2: '#9aa0ab', accent: '#d2622a', cart: '#4a4c57', cols: 10, rows: 4, depth: 24, monitor: false, stripe: true, cord: '#1d1e23'},
  g7000: {body: '#4a3f38', deck: '#5a4d44', keys: '#efe7d3', key2: '#c7a24b', accent: '#e0a526', cart: '#3a322d', cols: 10, rows: 4, depth: 24, monitor: false, stripe: false, cord: '#26201c'},
  g7200: {body: '#c9c6bd', deck: '#b3b0a6', keys: '#f1efe8', key2: '#8b8f98', accent: '#5b6370', cart: '#8d8a82', cols: 10, rows: 3, depth: 20, monitor: true, stripe: false, cord: '#3a3a3a'},
  c52: {body: '#e6dfcc', deck: '#d3caae', keys: '#fffaf0', key2: '#b24a3a', accent: '#b24a3a', cart: '#9c9275', cols: 10, rows: 4, depth: 24, monitor: false, stripe: true, cord: '#4d4638'},
  jopac: {body: '#22262e', deck: '#2f3540', keys: '#e8eaee', key2: '#e8761e', accent: '#e8761e', cart: '#3c424f', cols: 8, rows: 4, depth: 26, monitor: false, stripe: true, cord: '#15181d'},
  g7400: {body: '#aeb4bf', deck: '#8f96a3', keys: '#f3f5f8', key2: '#4b5565', accent: '#2f6fb3', cart: '#5a6372', cols: 12, rows: 4, depth: 16, monitor: false, stripe: true, cord: '#2a2f38'},
};

function keyboard(s, top) {
  // quadrilatero della tastiera dentro il piano superiore: tl, tr, br, bl
  const tl = [lerp(top.bl[0], top.br[0], 0.1) + 8, lerp(top.bl[1], top.br[1], 0.1) + 12];
  const tr = [lerp(top.br[0], top.bl[0], 0.1) - 8, tl[1]];
  const bl = [top.fl[0] + 20, top.fl[1] - 6];
  const br = [top.fr[0] - 20, top.fr[1] - 6];
  const P = (u, v) => [lerp(lerp(tl[0], tr[0], u), lerp(bl[0], br[0], u), v), lerp(lerp(tl[1], tr[1], u), lerp(bl[1], br[1], u), v)];
  let out = '';
  const gap = 0.16;
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const u0 = (c + gap / 2) / s.cols, u1 = (c + 1 - gap / 2) / s.cols, v0 = (r + gap) / s.rows, v1 = (r + 1 - gap) / s.rows;
      const special = r === s.rows - 1 && (c === 0 || c === s.cols - 1);
      out += poly([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], special ? s.key2 : s.keys);
    }
  }
  return out;
}

function joystick(x, y, s, flip) {
  const sx = flip ? -1 : 1;
  const bx = x, by = y;
  let out = '';
  out += '<path d="M' + f(bx - sx * 18) + ' ' + f(by - 10) + ' C ' + f(bx - sx * 40) + ' ' + f(by - 40) + ' ' + f(bx - sx * 12) + ' ' + f(by - 34) + ' ' + f(bx - sx * 30) + ' ' + f(by - 38) +
    '" fill="none" stroke="' + s.cord + '" stroke-width="2.2" stroke-linecap="round"/>';
  out += '<rect x="' + f(bx - 17) + '" y="' + f(by - 6) + '" width="34" height="14" rx="5" fill="' + s.deck + '" stroke="' + s.cord + '" stroke-width="1"/>';
  out += '<rect x="' + f(bx - 2) + '" y="' + f(by - 22) + '" width="4" height="17" rx="2" fill="' + s.cord + '"/>';
  out += '<ellipse cx="' + f(bx) + '" cy="' + f(by - 24) + '" rx="6.5" ry="5" fill="' + s.accent + '"/>';
  out += '<circle cx="' + f(bx + sx * 9) + '" cy="' + f(by + 1) + '" r="2.6" fill="' + s.key2 + '"/>';
  return out;
}

function monitorBlock(s) {
  let out = '';
  out += '<rect x="64" y="8" width="192" height="92" rx="12" fill="' + s.body + '" stroke="#00000033" stroke-width="1.2"/>';
  out += '<rect x="76" y="18" width="168" height="64" rx="8" fill="#15171b"/>';
  // schermo in bianco e nero: sei barre di grigio (come una mira) e un riquadro luminoso
  const greys = ['#f4f4f4', '#cfcfcf', '#a9a9a9', '#7f7f7f', '#575757', '#333333'];
  for (let i = 0; i < greys.length; i++) out += '<rect x="' + f(86 + i * 25) + '" y="26" width="25" height="30" fill="' + greys[i] + '"/>';
  out += '<rect x="86" y="58" width="150" height="16" fill="#1e2024"/>';
  out += '<rect x="96" y="62" width="30" height="8" fill="#d8d8d8"/><rect x="190" y="62" width="30" height="8" fill="#8c8c8c"/>';
  out += '<rect x="76" y="18" width="168" height="64" rx="8" fill="none" stroke="#ffffff22" stroke-width="2"/>';
  out += '<circle cx="232" cy="92" r="2.6" fill="' + s.accent + '"/><rect x="92" y="90" width="60" height="3" rx="1.5" fill="#00000033"/>';
  return out;
}

function machineSvg(kind) {
  const s = STYLE[kind];
  if (!s) throw new Error('macchina sconosciuta: ' + kind);
  const dy = s.monitor ? 28 : 0;                     // il G7200 e' piu' alto: monitor sopra, tastiera sotto
  const top = {bl: [62, 92 + dy], br: [258, 92 + dy], fr: [292, 142 + dy], fl: [28, 142 + dy]};
  let g = '';
  g += '<ellipse cx="160" cy="' + f(182 + dy / 2) + '" rx="150" ry="9" fill="#00000026"/>';
  if (s.monitor) g += monitorBlock(s);
  else {
    // vano della cartuccia dietro la tastiera, con la cartuccia inserita
    g += poly([[98, 62], [222, 62], [232, 92], [88, 92]], s.cart);
    g += '<rect x="112" y="34" width="96" height="34" rx="5" fill="' + s.cart + '" stroke="#00000040" stroke-width="1"/>';
    g += '<rect x="122" y="42" width="76" height="12" rx="2" fill="' + s.accent + '"/>';
    g += '<rect x="130" y="58" width="60" height="4" rx="2" fill="#00000040"/>';
  }
  // corpo: piano superiore e fronte
  g += poly([top.bl, top.br, top.fr, top.fl], s.deck, ' stroke="#00000033" stroke-width="1.2"');
  g += poly([top.fl, top.fr, [top.fr[0] - 4, top.fr[1] + s.depth], [top.fl[0] + 4, top.fl[1] + s.depth]], s.body, ' stroke="#00000033" stroke-width="1.2"');
  if (s.stripe) g += poly([[top.fl[0] + 2, top.fl[1] + 5], [top.fr[0] - 2, top.fr[1] + 5], [top.fr[0] - 3, top.fr[1] + 9], [top.fl[0] + 3, top.fl[1] + 9]], s.accent);
  g += keyboard(s, top);
  // due joystick davanti
  const jy = 176 + dy;
  g += joystick(46, jy, s, false) + joystick(274, jy, s, true);
  const h = 200 + dy;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 ' + h + '" role="img" aria-label="' + LABELS[kind] + ' (disegno stilizzato)"><title>' + LABELS[kind] + '</title>' + g + '</svg>';
}

module.exports = {KINDS, LABELS, BIOS_MACHINE, STYLE, FAMILY, NEEDS, biosMachine, pickMachine, fitsBios, defaultStandard, isMono, machineSvg};
