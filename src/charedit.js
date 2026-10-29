'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// charedit.js - logica PURA dell'editor dei set di caratteri (provata in Node, test/test_charedit.js): niente DOM. Due set:
//   'vdc' : 512 byte = 64 caratteri 8 x 8 del chip video 8244/8245; un byte per riga, bit 7 = pixel di sinistra.
//   'ef'  : 2560 byte = 256 voci 8 x 10 dell'EF9341 (G7400); un byte per fetta (riga), bit 0 = pixel di sinistra.
// Un glifo si maneggia come array di righe, ogni riga una stringa di '#' (acceso) e '.' (spento) lunga 8, da sinistra a destra: e' anche il
// formato di scambio (glyphToAscii / glyphFromAscii). Le operazioni cambiano il set sul posto.
//   KINDS, glyphCount(kind), getGlyph(kind, data, g) -> righe, setGlyph(kind, data, g, righe), getPixel, setPixel, clearGlyph, invertGlyph,
//   shiftGlyph(rows, dx, dy, wrap) -> righe, flipH(rows), flipV(rows), glyphToAscii, glyphFromAscii, parseSource(text) -> {kind, data, note},
//   findSetInFile(bytes[, tipo]) -> {kind, data, note, from} | null, identify(data[, elenco]) -> {kind, label, crc} | null, setsEqual
const {crc32, isZip, listZip, extractEntry} = require('./unzip.js');

const KINDS = {
  vdc: {size: 512, glyphs: 64, w: 8, h: 8, msbLeft: true, name: 'chip video 8244/8245'},
  ef: {size: 2560, glyphs: 256, w: 8, h: 10, msbLeft: false, name: 'EF9341 (Videopac+ G7400)'},
};

// impronte note (CRC-32): dichiarate nel sorgente di MAME (src/devices/video/i8244.cpp e ef9340_1.cpp); NON sono state verificate su una
// copia dei file (DA VERIFICARE). Servono solo a dire all'utente «e' un set conosciuto»: non decidono nulla.
const KNOWN = [
  {kind: 'vdc', crc: 0xB46A3F31, label: 'charset_i8244.bin (set del chip video, come in MAME)'},
  {kind: 'ef', crc: 0x8DE85988, label: 'charset_ef9340_1.rom (ROM EF9341 di MAME, ricavata dal datasheet)'},
];

function kindOf(kind) {
  const k = KINDS[kind];
  if (!k) throw new Error('tipo di set di caratteri sconosciuto: ' + kind);
  return k;
}
function glyphCount(kind) { return kindOf(kind).glyphs; }

function checkArgs(kind, data, g) {
  const k = kindOf(kind);
  if (!(data instanceof Uint8Array) || data.length !== k.size) throw new Error('il set ' + kind + ' deve essere di ' + k.size + ' byte');
  if (!Number.isInteger(g) || g < 0 || g >= k.glyphs) throw new Error('carattere fuori campo: ' + g);
  return k;
}

function byteToRow(k, b) {
  let s = '';
  for (let x = 0; x < 8; x++) s += ((k.msbLeft ? (b >> (7 - x)) : (b >> x)) & 1) ? '#' : '.';
  return s;
}
function rowToByte(k, s) {
  let b = 0;
  for (let x = 0; x < 8; x++) if (s[x] === '#') b |= k.msbLeft ? 0x80 >> x : 1 << x;
  return b;
}

function getGlyph(kind, data, g) {
  const k = checkArgs(kind, data, g);
  const rows = [];
  for (let y = 0; y < k.h; y++) rows.push(byteToRow(k, data[g * k.h + y]));
  return rows;
}

function validRows(k, rows) {
  if (!Array.isArray(rows) || rows.length !== k.h) throw new Error('il carattere deve avere ' + k.h + ' righe');
  for (const r of rows) if (typeof r !== 'string' || !/^[#.]{8}$/.test(r)) throw new Error('riga non valida (servono 8 caratteri # e .)');
}

function setGlyph(kind, data, g, rows) {
  const k = checkArgs(kind, data, g);
  validRows(k, rows);
  for (let y = 0; y < k.h; y++) data[g * k.h + y] = rowToByte(k, rows[y]);
}

function getPixel(kind, data, g, x, y) {
  const k = checkArgs(kind, data, g);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 8 || y < 0 || y >= k.h) throw new Error('pixel fuori campo');
  return byteToRow(k, data[g * k.h + y])[x] === '#';
}

function setPixel(kind, data, g, x, y, on) {
  const k = checkArgs(kind, data, g);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 8 || y < 0 || y >= k.h) throw new Error('pixel fuori campo');
  const bit = k.msbLeft ? 0x80 >> x : 1 << x;
  const i = g * k.h + y;
  data[i] = on ? data[i] | bit : data[i] & ~bit & 0xFF;
}

function clearGlyph(kind, data, g) { const k = checkArgs(kind, data, g); data.fill(0, g * k.h, (g + 1) * k.h); }
function invertGlyph(kind, data, g) { const k = checkArgs(kind, data, g); for (let y = 0; y < k.h; y++) data[g * k.h + y] ^= 0xFF; }

function flipH(rows) { return rows.map((r) => r.split('').reverse().join('')); }
function flipV(rows) { return rows.slice().reverse(); }

// sposta di dx colonne (positivo = a destra) e dy righe (positivo = in basso); wrap = true: ruota, false: i pixel che escono si perdono
function shiftGlyph(rows, dx, dy, wrap) {
  const h = rows.length, out = [];
  for (let y = 0; y < h; y++) {
    let sy = y - dy;
    if (wrap) sy = ((sy % h) + h) % h;
    if (sy < 0 || sy >= h) { out.push('........'); continue; }
    let s = '';
    for (let x = 0; x < 8; x++) {
      let sx = x - dx;
      if (wrap) sx = ((sx % 8) + 8) % 8;
      s += sx < 0 || sx >= 8 ? '.' : rows[sy][sx];
    }
    out.push(s);
  }
  return out;
}

function glyphToAscii(rows) { return rows.join('\n'); }
function glyphFromAscii(text, height) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => !(l === '' && (i === a.length - 1)));
  if (lines.length !== height) throw new Error('servono ' + height + ' righe (ce ne sono ' + lines.length + ')');
  return lines.map((l) => {
    if (!/^[#.]{1,8}$/.test(l)) throw new Error('riga non valida: usa solo # e . (al massimo 8 caratteri)');
    return (l + '........').slice(0, 8);
  });
}

function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// riconosce un set di dimensione giusta dal CRC-32 (solo informativo)
function identify(data, known) {
  if (!(data instanceof Uint8Array)) return null;
  const kind = data.length === 512 ? 'vdc' : data.length === 2560 ? 'ef' : null;
  if (!kind) return null;
  const crc = crc32(data);
  const k = (known || KNOWN).find((x) => x.kind === kind && x.crc === crc);
  return k ? {kind, label: k.label, crc} : {kind, label: null, crc};
}

// valori di una tabella con graffe annidate: la prima graffa esterna che contiene `want` numeri in tutto (decimali / 0x.. / $..), tutti validi; altrimenti null
function flattenNested(clean, want) {
  let depth = 0, start = -1, maxDepth = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '{') { if (depth === 0) { start = i; maxDepth = 0; } depth++; if (depth > maxDepth) maxDepth = depth; }
    else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && maxDepth >= 2) {
        const parts = clean.slice(start + 1, i).replace(/[{}]/g, ',').split(',').map((x) => x.trim()).filter((x) => x.length);
        if (parts.length !== want) continue;
        const vals = [];
        for (const p of parts) {
          let t, v = null;
          if ((t = /^0[xX]([0-9A-Fa-f]{1,2})$/.exec(p))) v = parseInt(t[1], 16);
          else if ((t = /^\$([0-9A-Fa-f]{1,2})$/.exec(p))) v = parseInt(t[1], 16);
          else if ((t = /^(\d{1,3})$/.exec(p)) && +t[1] <= 255) v = +t[1];
          if (v === null) { vals.length = 0; break; }
          vals.push(v);
        }
        if (vals.length === want) return Uint8Array.from(vals);
      }
    }
  }
  return null;
}

// ricava un set da un TESTO (per esempio il sorgente C di un emulatore, che il programma scaricato dall'utente contiene): cerca una
// tabella di numeri (esadecimali 0x.. / $.. o decimali) fra graffe con ESATTAMENTE 512 o 2560 valori; in mancanza, un elenco di byte
// esadecimali da due cifre (un dump di testo). Ritorna {kind, data, note} o null. Ignora i commenti /* */ e //.
function parseSource(text, known) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // 1. tabelle fra graffe
  const re = /\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const vals = [];
    let t, bad = false;
    const body = m[1];
    const parts = body.split(',').map((x) => x.trim()).filter((x) => x.length);
    for (const p of parts) {
      let v = null;
      if ((t = /^0[xX]([0-9A-Fa-f]{1,2})$/.exec(p))) v = parseInt(t[1], 16);
      else if ((t = /^\$([0-9A-Fa-f]{1,2})$/.exec(p))) v = parseInt(t[1], 16);
      else if ((t = /^(\d{1,3})$/.exec(p)) && +t[1] <= 255) v = +t[1];
      if (v === null) { bad = true; break; }
      vals.push(v);
    }
    if (!bad && (vals.length === 512 || vals.length === 2560)) {
      return {kind: vals.length === 512 ? 'vdc' : 'ef', data: Uint8Array.from(vals), note: 'tabella C di ' + vals.length + ' valori'};
    }
  }
  // 1b. tabella a due dimensioni (O2EM: vpp_cset[2][1280], ROM dell'EF9341): O2EM la scrive con il bit 7 a sinistra, la ROM ha il bit 0 a sinistra.
  // Si accetta SOLO se, con i bit invertiti, l'impronta coincide con quella nota (verificato il 15/10/2026: O2EM invertito = ROM di MAME): altrimenti
  // l'ordine dei bit sarebbe una scommessa e la tabella si scarta.
  const nest = flattenNested(clean, 2560);
  if (nest) {
    const rev = Uint8Array.from(nest, (b) => { let r = 0; for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i; return r; });
    if ((known || KNOWN).some((k) => k.kind === 'ef' && k.crc === crc32(rev))) {
      return {kind: 'ef', data: rev, note: 'tabella O2EM a due dimensioni (2 x 1280, bit invertiti: coincide con la ROM nota)'};
    }
  }
  // 2. elenco di byte esadecimali di due cifre
  const flat = clean.replace(/\b0[xX](?=[0-9A-Fa-f]{2}\b)/g, '');
  const hex = flat.match(/\b[0-9A-Fa-f]{2}\b/g);
  if (hex && (hex.length === 512 || hex.length === 2560) && /^[\s0-9A-Fa-f,;:]*$/.test(flat)) {
    return {kind: hex.length === 512 ? 'vdc' : 'ef', data: Uint8Array.from(hex.map((h) => parseInt(h, 16))), note: 'elenco di ' + hex.length + ' byte esadecimali'};
  }
  return null;
}

// cerca un set di caratteri dentro il contenuto di un file scelto dall'utente: un .bin esatto (512 o 2560 byte); uno zip (anche zip di zip,
// al massimo 2 livelli) che contiene un .bin esatto o un sorgente C / testo con la tabella; un sorgente C / testo. wanted ('vdc' | 'ef'):
// preferisce quel tipo se ce n'e' piu' di uno. Ritorna {kind, data, note, from} o null (mai eccezioni per file strani).
const MAX_ENTRY = 8 << 20;
function findSetInFile(bytes, wanted, depth, known) {
  depth = depth || 0;
  if (!(bytes instanceof Uint8Array)) return null;
  if (bytes.length === 512 || bytes.length === 2560) {
    const kind = bytes.length === 512 ? 'vdc' : 'ef';
    return {kind, data: Uint8Array.from(bytes), note: 'file binario di ' + bytes.length + ' byte', from: ''};
  }
  if (isZip(bytes)) {
    if (depth >= 2) return null;
    let list;
    try { list = listZip(bytes).filter((e) => !e.dir && e.size <= MAX_ENTRY); } catch (e) { return null; }
    let other = null;
    for (const e of list) {
      let r = null;
      try { r = findSetInFile(extractEntry(bytes, e), wanted, depth + 1, known); } catch (x) { r = null; }
      if (!r) continue;
      r.from = e.name + (r.from ? ' > ' + r.from : '');
      if (!wanted || r.kind === wanted) return r;
      if (!other) other = r;
    }
    return other;
  }
  if (bytes.length > MAX_ENTRY) return null;
  let nul = 0;
  for (let i = 0; i < Math.min(bytes.length, 4096); i++) if (bytes[i] === 0) nul++;
  if (nul > 0) return null;                                                         // un binario di altra dimensione non e' testo
  const r = parseSource(new TextDecoder('utf-8').decode(bytes), known);
  return r ? Object.assign(r, {from: ''}) : null;
}

module.exports = {KINDS, KNOWN, glyphCount, getGlyph, setGlyph, getPixel, setPixel, clearGlyph, invertGlyph, shiftGlyph, flipH, flipV, glyphToAscii,
  glyphFromAscii, setsEqual, identify, parseSource, findSetInFile};
