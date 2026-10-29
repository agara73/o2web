'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// gamenames.js - i NOMI dei giochi (funzioni pure, senza DOM). Serve a due cose:
//   1. la SIGLA numerata della cartuccia (vp_13 = Videopac n. 13, o2_45 = Odyssey2 AJ9445, br_58 = Brasile NTSC, ...), che nelle raccolte
//      pubbliche sta nel nome del file (vp_13.bin, Vp01_F.bin, «Air battle (br_58).bin»), e per i dump che non la portano (nomi TOSEC
//      e simili) si ricava dall'impronta SHA-1 con la tabella in gamedb_data.js (lista software di MAME, CC0);
//   2. il NOME della cartuccia: da un elenco di nomi dell'utente (parseNameList: righe «file.bin   descrizione», come Gamelist777.txt)
//      se c'e', altrimenti dalla tabella incorporata, altrimenti dai nomi trovati nei file.
// Nessun byte di ROM qui dentro: solo impronte, sigle e nomi. La tabella e' un fatto "da verificare" (test/test_gamenames.js la confronta coi dump).
//   siglaFromFileName(name)   -> {sigla, key} | null     sigla numerata in un nome di file (sigla in forma canonica: vp_13, vp_01_f, vp_11pl, ...)
//   sigKey(s)                 -> chiave di confronto (minuscole, senza «_» e «-», «+» = «pl»)
//   lookupSha1(hex40)         -> {sigla, name, alt} | null   dalla tabella incorporata
//   lookupSigla(sigla)        -> {sigla, name, alt} | null
//   decodeText(bytes)         -> stringa (UTF-8 se valido, altrimenti Latin-1: mai sostituzioni)
//   parseNameList(text)       -> Map(chiave -> descrizione)   (vuota se non e' un elenco di nomi)
//   describeGame(g, names)    -> {sigla, siglaKey, title, rank, notes: [], altNames: [], extraSiglas: [], conflict: null | {name, content}}
//     conflict: il nome del file porta la sigla di UN ALTRO gioco di quello che dice l'impronta SHA-1 (vp_47.bin che contiene Killer Bees): vale l'impronta
//     (richiesta dell'utente, 18/10/2026); {name: sigla del file, content: sigla dell'impronta}. Stesso gioco con altra versione (vp_52 / vp_52pl) non e' discordanza.
const {sha1} = require('./sha1.js');
const {ROMS} = require('./gamedb_data.js');
const {matchGame} = require('./vplist.js');

const NUM_SIGLA = /^(vp|o2|o3|br|ntsc|mod)_?(\d{2})((?:_?(?:pl|alt|hack|fix|f|12|16|g7400|g7000))*)$/;
const LETTER_SIGLA = /^vp_?(a|v|c7\d{3})$/;
const CSV_SIGLA = /^csv_?\d$/;
const EXT_RE = /\.(bin|rom|o2|vp)$/i;
const TITLE_PREFIXES = /^(vp|o2|br|csv)/;           // per queste sigle la descrizione dell'elenco e' un TITOLO; per le altre (mod_, pr_, new_...) e' una nota

function sigKey(s) { return String(s || '').toLowerCase().replace(/\+/g, 'pl').replace(/[_\-\s]/g, ''); }

// forma canonica di una sigla gia' riconosciuta: minuscole, «+» -> «pl», «_» tra prefisso e numero
function canonSigla(s) {
  let t = String(s).toLowerCase().replace(/\+/g, 'pl');
  t = t.replace(/^(vp|br|ntsc|mod)(\d)/, '$1_$2').replace(/^(o[23])(\d{2})/, '$1_$2');
  return t;
}
function isNumbered(sigla) {
  const t = canonSigla(sigla);
  return NUM_SIGLA.test(t) || LETTER_SIGLA.test(t) || CSV_SIGLA.test(t);
}

function stemOf(fileName) {
  let b = String(fileName);
  const i = Math.max(b.lastIndexOf('/'), b.lastIndexOf('\\'));
  if (i >= 0) b = b.slice(i + 1);
  return b.replace(EXT_RE, '').trim();
}

function siglaFromFileName(fileName) {
  const stem = stemOf(fileName);
  const cands = [stem];
  const re = /\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(stem))) cands.push(m[1].trim());
  for (const c of cands) {
    if (/\s/.test(c)) continue;
    const t = canonSigla(c);
    if (NUM_SIGLA.test(t) || LETTER_SIGLA.test(t) || CSV_SIGLA.test(t)) return {sigla: t, key: sigKey(t)};
  }
  return null;
}

// ---- tabella incorporata (da tools/make_gamedb.py)
const BY_SHA1 = new Map(), BY_KEY = new Map();
for (const r of ROMS) {
  const e = {sigla: r[0], name: r[2], alt: r[3] || ''};
  BY_SHA1.set(r[1], e);
  if (!BY_KEY.has(sigKey(r[0]))) BY_KEY.set(sigKey(r[0]), e);
}
function lookupSha1(hex) { return BY_SHA1.get(String(hex).toLowerCase()) || null; }
function lookupSigla(s) { return BY_KEY.get(sigKey(s)) || null; }

// ---- elenco di nomi dell'utente
function decodeText(bytes) {
  if (typeof TextDecoder === 'function') {
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch (e) { /* non e' UTF-8: Latin-1 */ }
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 4096)));
  return s;
}
const LIST_LINE = /^\s*(\S+\.(?:bin|rom|o2|vp))[ \t]+(\S.*?)\s*$/i;
// Righe «nome.bin   descrizione»; la chiave e' il nome senza estensione, in minuscole (e anche la chiave di confronto delle sigle)
function parseNameList(text) {
  const map = new Map();
  const lines = String(text).split(/\r?\n/);
  if (lines.length > 20000) return map;
  for (const line of lines) {
    if (line.length > 400) continue;
    const m = LIST_LINE.exec(line);
    if (!m) continue;
    const stem = stemOf(m[1]).toLowerCase();
    const desc = m[2].replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stem || !desc) continue;
    map.set(stem, desc);
  }
  return map;
}
const MIN_LIST = 3;
const looksLikeNameList = (text) => parseNameList(text).size >= MIN_LIST;

// ---- sigla e nome di un gioco (il record di library.makeGame); names: Map di parseNameList (anche vuota o assente)
const SHA1_CACHE = new WeakMap();
function sha1Of(g) {
  let h = SHA1_CACHE.get(g);
  if (!h) { h = sha1(g.data); SHA1_CACHE.set(g, h); }
  return h;
}

function descriptive(g) { return !!(g.year || g.publisher || g.country); }

// rank: 0 = descrizione dell'elenco di una sigla titolata, 1 = tabella incorporata, 2 = nome del file descrittivo (TOSEC), 3 = altro nome del file
// il gioco del catalogo (vplist.js) a cui porta una sigla del nome, o il contenuto di una riga della tabella: chiave del gruppo, o null
function gameKeyOfSigla(sigla) { const m = matchGame({sigla}); return m ? m.key : null; }
function gameKeyOfHit(hit) {
  const m = matchGame({sigla: hit.sigla}) || matchGame({titles: [hit.name, hit.alt].filter(Boolean)});
  return m ? m.key : null;
}
function describeGame(g, names) {
  let fromFile = siglaFromFileName(g.name);
  const hit = g.data ? lookupSha1(sha1Of(g)) : null;
  let conflict = null;
  if (fromFile && hit && sigKey(fromFile.sigla) !== sigKey(hit.sigla)) {
    const ka = gameKeyOfSigla(fromFile.sigla);
    if (ka !== null && ka !== gameKeyOfHit(hit)) { conflict = {name: fromFile.sigla, content: canonSigla(hit.sigla)}; fromFile = null; }
  }
  let sigla = '';
  if (fromFile) sigla = fromFile.sigla;
  else if (hit && isNumbered(hit.sigla)) sigla = canonSigla(hit.sigla);
  const key = sigla ? sigKey(sigla) : '';
  const stem = stemOf(g.name).toLowerCase();
  const notes = [], altNames = [];
  let title = '', rank = 3;
  const listDesc = names && names.size && !conflict ? (names.get(stem) || (key && findByKey(names, key)) || '') : '';
  if (listDesc) {
    if (sigla && TITLE_PREFIXES.test(sigla)) { title = listDesc; rank = 0; }
    else notes.push(listDesc);
  }
  const db = hit || (key ? lookupSigla(sigla) : null);
  // la sigla dell'impronta puo' scriversi in modo diverso da quella del nome del file (vp_58_12 / vp_58pl): si tiene anche quella
  const extraSiglas = [];
  if (hit && isNumbered(hit.sigla) && sigKey(hit.sigla) !== key) extraSiglas.push(canonSigla(hit.sigla));
  if (db) {
    if (!title) { title = db.name; rank = 1; } else if (db.name !== title) altNames.push(db.name);
    if (db.alt) altNames.push(db.alt);
  }
  if (!title) {
    title = g.display || g.title || g.name;
    rank = !fromFile && descriptive(g) ? 2 : 3;
  }
  return {sigla, siglaKey: key, title, rank, notes, altNames, extraSiglas, conflict};
}
// la chiave dell'elenco puo' essere scritta in modo un po' diverso dal file (Vp11+_F / vp_11pl_f)
const NAMES_KEYS = new WeakMap();
function findByKey(names, key) {
  let m = NAMES_KEYS.get(names);
  if (!m) { m = new Map(); for (const [k, v] of names) if (!m.has(sigKey(k))) m.set(sigKey(k), v); NAMES_KEYS.set(names, m); }
  return m.get(key) || '';
}

module.exports = {siglaFromFileName, sigKey, canonSigla, isNumbered, stemOf, lookupSha1, lookupSigla, decodeText, parseNameList, looksLikeNameList, describeGame, sha1Of, TITLE_PREFIXES, MIN_LIST};
