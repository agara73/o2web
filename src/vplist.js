'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// vplist.js - il CATALOGO delle cartucce Videopac / Odyssey2 (lista di Maurice Simon, dati in vplist_data.js) e l'abbinamento di una ROM
// a una voce del catalogo. Funzioni pure, senza DOM. Nessun byte di ROM: solo editori, cataloghi, numeri e titoli.
//
// Un «gioco» del catalogo e' il numero Videopac (43 = Pick Axe Pete, con le voci di tutti i paesi e lingue); il «+» (43+) e' la versione Plus
// (ROM vp_43pl). I giochi senza numero (Imagic, Parker, Jopac nuovi, prototipi, amatoriali) si riconoscono dal titolo.
// Due strade per l'abbinamento, nell'ordine:
//   1. la SIGLA della ROM (decodifica dei nomi di MAME): vp_43 / vp_43pl = numero 43 (con o senza Plus); br_58 = numero Videopac del Brasile;
//      o2_47 = catalogo Magnavox AC9447 (il numero Videopac lo da' la voce: 52); o3_47 = la versione Plus di quella; vp_a / vp_v = lettere
//      (Newscaster, Verkehr); csv_1; vp_c7010 = Chess; vp_c7420 = Home Computer Module.
//   2. il TITOLO (nomi TOSEC, descrizione di MAME, nomi del file, elenchi dell'utente): confronto senza maiuscole, accenti, punteggiatura,
//      spazi, regioni tra parentesi; i titoli doppi («A / B») si confrontano anche a pezzi; i titoli abbreviati dalla lista («...») per prefisso.
//   normTitle(s), isPlusTitle(s), matchGame(info), describeMatch(m), byNumber(n), ROWS, CREDIT
// info = {sigla, siglas: [], titles: [], plusHint}  ->  null | {how, number, letter, plus, plusOnly, ambiguous, rows, family, title, key}
const {ROWS, CREDIT} = require('./vplist_data.js');

const REGION_ORDER = ['EU', 'UK', 'US', 'FR', 'BE', 'DE', 'BR', 'JO', 'PT', 'NC', 'TE'];
const regionRank = (rg) => { const i = REGION_ORDER.indexOf(rg); return i < 0 ? REGION_ORDER.length : i; };
const LOOSE = new Set(['PT', 'NC', 'TE']);                    // prototipi, amatoriali, collaudo: contano meno

function normTitle(s) {
  let t = String(s || '');
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  t = t.normalize ? t.normalize('NFD').replace(/[̀-ͯ]/g, '') : t;
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
// come normTitle, ma il carattere perso nel file originale (U+FFFD) resta come «*» (un carattere qualunque)
function normWild(s) {
  let t = String(s || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  t = t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t;
  return t.toLowerCase().replace(/\ufffd/g, '*').replace(/[^a-z0-9*]+/g, '');
}
function isPlusTitle(s) {
  const t = String(s || '');
  return /\+\s*(\([^)]*\)\s*)*$/.test(t.replace(/!/g, '')) || /\([^)]*\bplus\b[^)]*\)/i.test(t);
}

// ---- indici
const NUM_GROUPS = new Map();            // numero -> [voci]
const LET_GROUPS = new Map();            // 'A' / 'V' -> [voci]
const TITLE_GROUPS = new Map();          // chiave titolo -> [voci] (giochi senza numero)
const BY_TITLE = new Map();              // titolo normalizzato -> Map(voce.id -> 0 titolo intero | 1 pezzo di un titolo doppio)
const PREFIXES = [];                     // [{key, id}] per i titoli abbreviati
const WILD = [];                         // titoli con un carattere perso: {re, id}
const MAGNAVOX = new Map();              // «94NN» -> [voci Magnavox USA]

const baseTitle = (ti) => ti.replace(/\s+O3$/, '').replace(/\s*\(\s*AKA[^)]*\)/i, '').replace(/\(Imagic title[^)]*\)/, '').trim();
function titleKeys(row) {
  const out = new Map();
  const ti = row.ti;
  const add = (x) => { const k = normTitle(x); if (k.length >= 3 && !out.has(k)) out.set(k, 0); };
  add(baseTitle(ti));
  const aka = /\(\s*AKA\s+([^)]*)\)/i.exec(ti);
  if (aka) for (const p of aka[1].split('/')) add(p);
  if (/\.\.\.?\+?$/.test(ti)) return {keys: out, prefix: normTitle(ti.replace(/\.+\+?$/, ''))};
  const pieces = baseTitle(ti).split(/\s*\/\s*/);
  if (pieces.length > 1) for (const p of pieces) { const k = normTitle(p); if (k.length >= 5 && !out.has(k)) out.set(k, 1); }       // 1 = solo un pezzo del titolo doppio
  return {keys: out, prefix: ''};
}
function groupKey(row) {
  if (row.vp) return 'n:' + row.vp;
  if (row.vl) return 'l:' + row.vl;
  return 't:' + normTitle(baseTitle(row.ti));
}
const GROUPS = new Map();                // chiave gruppo -> [voci]
for (const r of ROWS) {
  const gk = groupKey(r);
  if (!GROUPS.has(gk)) GROUPS.set(gk, []);
  GROUPS.get(gk).push(r);
  if (r.vp) { if (!NUM_GROUPS.has(r.vp)) NUM_GROUPS.set(r.vp, []); NUM_GROUPS.get(r.vp).push(r); }
  if (r.ti.includes('\ufffd')) {
    const w = normWild(baseTitle(r.ti));
    if (w.includes('*')) WILD.push({re: new RegExp('^' + w.replace(/\*/g, '[a-z0-9]') + '$'), id: r.id});
  }
  const tk = titleKeys(r);
  for (const [k, kind] of tk.keys) { if (!BY_TITLE.has(k)) BY_TITLE.set(k, new Map()); const mm = BY_TITLE.get(k); if (!mm.has(r.id) || mm.get(r.id) > kind) mm.set(r.id, kind); }
  if (tk.prefix.length >= 8) PREFIXES.push({key: tk.prefix, id: r.id});
  if (r.rg === 'US' && /^[A-Z]{2}94\d\d$/.test(r.ct)) { const k = r.ct.slice(4); if (!MAGNAVOX.has(k)) MAGNAVOX.set(k, []); MAGNAVOX.get(k).push(r); }
}
const byNumber = (n) => (NUM_GROUPS.get(n) || []).slice();

// ---- risultato per un gruppo
function pickTitle(family) {
  const ok = (r) => !r.lg || r.lg === 'English' || r.lg === 'British';
  const ranked = family.slice().sort((a, b) => (Number(!ok(a)) - Number(!ok(b))) || (regionRank(a.rg) - regionRank(b.rg)) || (a.id - b.id));
  const r = ranked[0];
  return r.ti.replace(/\s+O3$/, '').replace(/\s*[!+]+$/, '').replace(/\s*[!+]+$/, '').trim();
}
function buildResult(how, gk, wantPlus, focus, extra) {
  const family = (GROUPS.get(gk) || []).slice();
  if (!family.length) return null;
  const plusRows = family.filter((r) => r.pl), plainRows = family.filter((r) => !r.pl);
  let plus = !!wantPlus;
  if (plus && !plusRows.length) plus = false;
  if (!plus && !plainRows.length) plus = true;
  let rows = plus ? plusRows : plainRows;
  if (extra && extra.only) rows = rows.filter(extra.only);
  if (!rows.length) rows = plus ? plusRows : plainRows;
  const rk = (r) => (focus === r.rg ? -1 : regionRank(r.rg));
  rows = rows.slice().sort((a, b) => (rk(a) - rk(b)) || (a.id - b.id));
  const first = family[0];
  return {how, key: gk, number: first.vp || 0, letter: first.vl || '', plus, plusOnly: rows.some((r) => r.po === 1), ambiguous: false,
    rows, family: family.slice().sort((a, b) => (regionRank(a.rg) - regionRank(b.rg)) || (a.id - b.id)), title: pickTitle(family)};
}

// ---- sigle
function parseSigla(s) {
  const t = String(s || '').toLowerCase().replace(/\+/g, 'pl');
  let m = /^(vp|br|ntsc)_?(\d{2})((?:_?[a-z0-9]+)*)$/.exec(t);
  if (m) return {kind: 'num', n: parseInt(m[2], 10), plus: /pl/.test(m[3]), french: /(^|_)f$/.test(m[3]) || /^f/.test(m[3]) && m[3].length === 1, br: m[1] === 'br'};
  m = /^o([23])_?(\d{2})((?:_?[a-z0-9]+)*)$/.exec(t);
  if (m) return {kind: 'cat', k: m[2], plus: m[1] === '3' || /pl/.test(m[3])};
  m = /^vp_?(a|v)$/.exec(t);
  if (m) return {kind: 'let', l: m[1].toUpperCase()};
  m = /^vp_?(c7\d{3})$/.exec(t);
  if (m) return {kind: 'ct', c: m[1].toUpperCase()};
  m = /^csv_?(\d)$/.exec(t);
  if (m) return {kind: 'csv', n: m[1]};
  return null;
}
function fromSigla(sig) {
  const p = parseSigla(sig);
  if (!p) return null;
  if (p.kind === 'num') {
    const r = buildResult('sigla', 'n:' + p.n, p.plus, p.french ? 'FR' : p.br ? 'BR' : '');
    return r;
  }
  if (p.kind === 'cat') {
    const rs = MAGNAVOX.get(p.k);
    if (!rs || !rs.length) return null;
    const r0 = rs[0];
    const r = buildResult('catalogo', groupKey(r0), p.plus, 'US');
    return r;
  }
  if (p.kind === 'let') return buildResult('sigla', 'l:' + p.l, false, '');
  if (p.kind === 'ct') {
    const rows = ROWS.filter((r) => r.ct.startsWith(p.c));
    if (!rows.length) return null;
    const out = buildResult('sigla', groupKey(rows[0]), false, '');
    if (out) out.rows = rows.slice();
    return out;
  }
  if (p.kind === 'csv') {
    const rows = ROWS.filter((r) => r.mk === 'CSV' && new RegExp('Verkehrsspiele ' + p.n + '\\b').test(r.ti));
    if (!rows.length) return null;
    const out = buildResult('sigla', groupKey(rows[0]), false, '');
    return out;
  }
  return null;
}

// ---- titoli
function candidatesForTitle(raw) {
  const k = normTitle(raw);
  if (k.length < 3) return [];
  const hit = new Map(BY_TITLE.get(k) || []);
  if (!hit.size) for (const w of WILD) if (w.re.test(k)) hit.set(w.id, 0);
  if (!hit.size && k.length >= 12) for (const p of PREFIXES) if (k.startsWith(p.key)) hit.set(p.id, 0);
  // il titolo intero batte il pezzo di un titolo doppio (Helicopter Rescue+ contro «Out of This World / Helicopter Rescue»)
  const full = [...hit].filter((x) => x[1] === 0).map((x) => x[0]);
  const ids = full.length ? full : [...hit.keys()];
  return ids.map((id) => ROWS[id]);
}
function fromTitles(titles, plusHint) {
  for (const raw of titles) {
    if (!raw) continue;
    const cands = candidatesForTitle(raw);
    if (!cands.length) continue;
    // gruppi: i prototipi e gli amatoriali contano solo se non c'e' niente di meglio
    const groups = new Map();
    for (const r of cands) { const gk = groupKey(r); if (!groups.has(gk)) groups.set(gk, []); groups.get(gk).push(r); }
    let keys = [...groups.keys()];
    const released = keys.filter((g) => groups.get(g).some((r) => !LOOSE.has(r.rg)));
    if (released.length) keys = released;
    keys.sort((a, b) => (groups.get(b).length - groups.get(a).length) || (a < b ? -1 : a > b ? 1 : 0));
    // se le voci che hanno il titolo sono tutte Plus (Air Battle+), la ROM e' la versione Plus; se ce ne sono anche senza «+», vale l'indizio
    const mine = groups.get(keys[0]);
    const want = !!plusHint || isPlusTitle(raw) || mine.every((r) => r.pl === 1);
    const res = buildResult('titolo', keys[0], want, mine.slice().sort((a, b) => regionRank(a.rg) - regionRank(b.rg))[0].rg);
    if (res) { res.ambiguous = keys.length > 1; return res; }
  }
  return null;
}

function matchGame(info) {
  info = info || {};
  const sigs = [];
  if (info.sigla) sigs.push(info.sigla);
  if (Array.isArray(info.siglas)) for (const s of info.siglas) if (s && !sigs.includes(s)) sigs.push(s);
  for (const s of sigs) { const r = fromSigla(s); if (r) return r; }
  const titles = Array.isArray(info.titles) ? info.titles : [];
  return titles.length ? fromTitles(titles, !!info.plusHint) : null;
}

// ---- testo da mostrare
const FLAG_NAMES = {po: 'Plus-only', no: 'Original-only', m: 'Master-Strategy', v: 'Voice', '!': 'Not-on-US-Odyssey2', '*': 'Different-in-US'};
// titolo da mostrare: note tra parentesi tolte, «!» e «+» finali tolti, il carattere perso della lista (U+FFFD) come «?»
const tidyTitle = (t) => String(t).replace(/\s*\([^)]*\)/g, '').replace(/\s*[!+]+$/, '').replace(/\ufffd/g, '?').trim();
function describeMatch(m) {
  if (!m) return null;
  const catalogs = [];
  for (const r of m.rows) if (r.ct && !catalogs.includes(r.ct)) catalogs.push(r.ct);
  const flags = [];
  if (m.rows.some((r) => r.po === 1)) flags.push(FLAG_NAMES.po);
  if (m.rows.some((r) => r.no === 1)) flags.push(FLAG_NAMES.no);
  for (const c of ['m', 'v', '!', '*']) if (m.rows.some((r) => r.fl.includes(c))) flags.push(FLAG_NAMES[c]);
  // titoli da mostrare: senza le note tra parentesi («Demon Attack+ (Imagic title, + ver)»), con il nome «AKA» come titolo a parte e senza i titoli
  // a cui la lista ha perso un carattere (U+FFFD: restano buoni per la ricerca, ma non da mostrare)
  const shown = tidyTitle(m.title);
  const titles = [];
  const addTitle = (raw) => { const t = tidyTitle(raw); if (t && !/\ufffd/.test(raw) && !titles.includes(t) && t !== shown) titles.push(t); };
  for (const r of m.family) {
    const aka = /\(\s*AKA\s+([^)]*)\)/i.exec(r.ti);
    addTitle(r.ti);
    if (aka) addTitle(aka[1]);
  }
  const num = m.number ? 'Videopac ' + m.number + (m.plus ? '+' : '') : m.letter ? 'Videopac ' + m.letter : '';
  const best = m.rows.find((r) => !LOOSE.has(r.rg)) || m.rows[0];
  return {line: (num ? num + ' · ' : '') + shown, number: num, catalogs, flags, titles, rarity: best ? best.ra : '', makers: [...new Set(m.rows.map((r) => r.mk))]};
}

module.exports = {ROWS, CREDIT, normTitle, isPlusTitle, matchGame, describeMatch, byNumber, parseSigla};
