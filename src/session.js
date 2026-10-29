'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// session.js - il FILE DI SESSIONE (formato «o2web-session», versione 1). E' un file PERSONALE dell'utente: contiene i SUOI dump
// (BIOS, cartucce, eventualmente il set di caratteri), lo stato di ogni gioco, il gioco in uso e le impostazioni, cosi' basta aprire
// un solo file per ritrovare tutto. Lo crea la pagina nel browser dell'utente; il progetto non lo produce ne' lo distribuisce, e il
// file NON va condiviso (contiene i dump). Lo stato di una singola partita (.o2state) resta invece solo stato + impronte.
//
// Contenitore: zip SENZA compressione (zipstore.js), apribile con qualunque programma di zip:
//   LEGGIMI.txt         avviso: il file contiene dump, non va condiviso
//   sessione.json       {format, version, created, standard, activeGame, activeBios, bios[], games[], charset, settings, avviso}
//   bios/0001.bin ...   un BIOS per voce (ordine dell'elenco)
//   carte/0001.bin ...  una cartuccia per voce
//   stati/0001.json ... lo stato (snapshot della console) del gioco di pari indice, se c'e'
//   charset.bin         set di caratteri del chip (512 byte), se l'utente ne ha portato uno
//   efcharset.bin       (versione 2, tappa 5) set di caratteri dell'EF9341 del G7400 (2560 byte), se l'utente ne ha portato uno
//   z80rom.bin          (versione 3, tappa 6a) ROM da 8 KB dello Z80 del modulo scacchi C7010 (CRC-32 45080245), se l'utente l'ha portata
// La lettura (parseSession) e' una funzione PURA e SEVERA: lavora su copie, controlla ogni voce (nome, dimensione, SHA-256, CRC dello
// zip), rifiuta voci mancanti, in piu', duplicate o incoerenti, e non tocca nulla finche' non ha validato tutto; solo dopo la pagina
// sostituisce l'elenco e la partita in corso.
//   buildSession(opts)   -> Uint8Array
//   parseSession(bytes)  -> {standard, activeGame, activeBios, bios[], games[], charset, settings, created}   (indici, non id)
//   restoreLibrary(p)    -> {lib, activeGameId, activeBiosId, states: Map(idGioco -> stato)}
const {sha256} = require('./sha256.js');
const {isZip, listZip, extractEntry, ZipError} = require('./unzip.js');
const {zipStore} = require('./zipstore.js');
const {Library, LIMITS, makeGame, makeBios, isChessZ80} = require('./library.js');
const {validateBindings} = require('./input.js');
const {checkLook, LookError} = require('./look.js');
const {KINDS} = require('./machines.js');

const FORMAT = 'o2web-session';
const VERSION = 3;                                       // 2: aggiunge efcharset.bin e l'impostazione pinB; 3 (tappa 6a): aggiunge z80rom.bin (ROM dello Z80 del modulo scacchi C7010). Si scrive la versione piu' bassa che basta: una sessione senza set EF ne' ROM Z80 e' ancora la 1
const LIMIT = {json: 16 << 20, state: 16 << 20, total: 1024 << 20, leaf: 32768};
const WARNING = 'ATTENZIONE: questo file contiene i dump (BIOS e cartucce) che hai caricato. E’ un file personale: non condividerlo e non pubblicarlo.';
const README = [
  'File di sessione di o2web (formato ' + FORMAT + ' v' + VERSION + ').',
  '',
  WARNING,
  '',
  'Si apre con la pagina dell’emulatore (si aggiunge con «Aggiungi file» o si trascina sulla pagina). Dentro ci sono:',
  '  sessione.json   elenco, gioco in uso, impostazioni',
  '  bios/, carte/   i dump (tuoi)',
  '  stati/          uno stato di gioco per cartuccia (se salvato)',
  '',
  '(c) 2026 by Agara73',
  '',
].join('\n');

class SessionError extends Error {}

const HEX64 = /^[0-9a-f]{64}$/;
const isStr = (v, max) => typeof v === 'string' && v.length <= (max || 300);

// ---- impostazioni salvate nella sessione: schema chiuso (le chiavi sconosciute si ignorano, i valori sbagliati si rifiutano)
function checkSettings(s) {
  if (s === undefined || s === null) return {};
  if (typeof s !== 'object' || Array.isArray(s)) throw new SessionError('impostazioni non valide');
  const o = {};
  if ('scale' in s) {
    if (!Number.isInteger(s.scale) || s.scale < 0 || s.scale > 8) throw new SessionError('impostazione non valida: ingrandimento');
    o.scale = s.scale;                                   // 0 = adatta alla finestra
  }
  if ('aspect' in s) {
    if (s.aspect !== 'square' && s.aspect !== 'tv') throw new SessionError('impostazione non valida: proporzioni');
    o.aspect = s.aspect;
  }
  if ('integer' in s) {
    if (typeof s.integer !== 'boolean') throw new SessionError('impostazione non valida: multipli interi');
    o.integer = s.integer;
  }
  if ('volume' in s) {
    if (typeof s.volume !== 'number' || !(s.volume >= 0 && s.volume <= 1)) throw new SessionError('impostazione non valida: volume');
    o.volume = s.volume;
  }
  if ('muted' in s) {
    if (typeof s.muted !== 'boolean') throw new SessionError('impostazione non valida: audio disattivato');
    o.muted = s.muted;
  }
  if ('look' in s) {
    try { o.look = checkLook(s.look); } catch (e) {
      if (e instanceof LookError) throw new SessionError('impostazione non valida: aspetto (' + e.message + ')');
      throw e;
    }
  }
  if ('pinB' in s) {
    if (s.pinB !== 'auto' && s.pinB !== 'low' && s.pinB !== 'high') throw new SessionError('impostazione non valida: pin B della cartuccia');
    o.pinB = s.pinB;
  }
  if ('swapPads' in s) {
    if (typeof s.swapPads !== 'boolean') throw new SessionError('impostazione non valida: scambio dei comandi dei giocatori');
    o.swapPads = s.swapPads;
  }
  if ('machine' in s) {
    if (s.machine !== 'auto' && !KINDS.includes(s.machine)) throw new SessionError('impostazione non valida: macchina');
    o.machine = s.machine;
  }
  if ('bindings' in s) {
    try { o.bindings = validateBindings(s.bindings); } catch (e) { throw new SessionError('impostazione non valida: ' + e.message); }
  }
  return o;
}

const pad4 = (n) => String(n + 1).padStart(4, '0');

// opts: {lib, activeGameId, activeBiosId, standard, states: Map(idGioco -> stato) | {}, charset: Uint8Array|null, efCharset: Uint8Array|null, chessRom: Uint8Array|null, settings, created}
function buildSession(opts) {
  const lib = opts.lib;
  const std = opts.standard === 'NTSC' ? 'NTSC' : 'PAL';
  const states = opts.states instanceof Map ? opts.states : new Map(Object.entries(opts.states || {}).map(([k, v]) => [+k, v]));
  const settings = checkSettings(opts.settings);
  const entries = [];
  const meta = {format: FORMAT, version: VERSION, created: String(opts.created || ''), avviso: WARNING, standard: std, activeGame: -1, activeBios: -1,
    bios: [], games: [], charset: null, settings};
  meta.version = opts.chessRom ? 3 : opts.efCharset ? 2 : 1;
  lib.bios.forEach((b, i) => {
    const file = 'bios/' + pad4(i) + '.bin';
    meta.bios.push({file, name: b.name, folder: b.folder, origin: b.origin, size: b.data.length, sha: sha256(b.data)});
    entries.push({name: file, data: b.data});
    if (b.id === opts.activeBiosId) meta.activeBios = i;
  });
  const enc = new TextEncoder();
  lib.games.forEach((g, i) => {
    const file = 'carte/' + pad4(i) + '.bin';
    const rec = {file, name: g.name, folder: g.folder, origin: g.origin, size: g.data.length, sha: sha256(g.data), state: null, stateBios: null};
    const st = states.get(g.id);
    if (st) {
      if (!st.hashes || st.hashes.cart !== rec.sha) throw new SessionError('lo stato di «' + g.name + '» non e’ di questa cartuccia');
      rec.state = 'stati/' + pad4(i) + '.json';
      rec.stateBios = st.hashes.bios;
      entries.push({name: rec.state, data: enc.encode(JSON.stringify(st))});
    }
    meta.games.push(rec);
    entries.push({name: file, data: g.data});
    if (g.id === opts.activeGameId) meta.activeGame = i;
  });
  if (opts.charset) {
    if (!(opts.charset instanceof Uint8Array) || opts.charset.length !== 512) throw new SessionError('set di caratteri non valido');
    meta.charset = {file: 'charset.bin', size: 512, sha: sha256(opts.charset)};
    entries.push({name: 'charset.bin', data: opts.charset});
  }
  if (opts.efCharset) {
    if (!(opts.efCharset instanceof Uint8Array) || opts.efCharset.length !== 2560) throw new SessionError('set di caratteri dell’EF9341 non valido');
    meta.efCharset = {file: 'efcharset.bin', size: 2560, sha: sha256(opts.efCharset)};
    entries.push({name: 'efcharset.bin', data: opts.efCharset});
  }
  if (opts.chessRom) {
    if (!(opts.chessRom instanceof Uint8Array) || !isChessZ80(opts.chessRom)) throw new SessionError('ROM dello Z80 del modulo scacchi non valida');
    meta.chessRom = {file: 'z80rom.bin', size: 8192, sha: sha256(opts.chessRom)};
    entries.push({name: 'z80rom.bin', data: opts.chessRom});
  }
  const json = enc.encode(JSON.stringify(meta, null, 1));
  return zipStore([{name: 'LEGGIMI.txt', data: enc.encode(README)}, {name: 'sessione.json', data: json}].concat(entries));
}

function strictBytes(data, rec, what, minSize, maxSize) {
  if (data.length !== rec.size) throw new SessionError(what + ': dimensione diversa da quella dichiarata');
  if (data.length < minSize || data.length > maxSize) throw new SessionError(what + ': dimensione non valida (' + data.length + ' byte)');
  if (sha256(data) !== rec.sha) throw new SessionError(what + ': impronta SHA-256 diversa da quella dichiarata (file danneggiato)');
}

function checkRec(r, what, extra) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new SessionError(what + ': voce non valida');
  if (!isStr(r.file, 40) || !isStr(r.name, 300) || !r.name || !isStr(r.folder, 300) || !isStr(r.origin, 300)) throw new SessionError(what + ': campi non validi');
  if (!Number.isInteger(r.size) || r.size < 1 || r.size > LIMIT.leaf) throw new SessionError(what + ': dimensione non valida');
  if (typeof r.sha !== 'string' || !HEX64.test(r.sha)) throw new SessionError(what + ': impronta non valida');
  if (extra) extra(r);
}

function parseSession(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new SessionError('file non valido');
  if (!isZip(bytes)) throw new SessionError('non e’ un file di sessione (non e’ uno zip)');
  let list;
  try { list = listZip(bytes); } catch (e) {
    if (e instanceof ZipError) throw new SessionError('file di sessione danneggiato: ' + e.message);
    throw e;
  }
  const files = new Map();
  let total = 0;
  for (const e of list) {
    if (e.dir) continue;
    if (files.has(e.name)) throw new SessionError('file di sessione non valido: voce duplicata «' + e.name + '»');
    if (!/^(LEGGIMI\.txt|sessione\.json|charset\.bin|efcharset\.bin|z80rom\.bin|bios\/\d{4}\.bin|carte\/\d{4}\.bin|stati\/\d{4}\.json)$/.test(e.name)) {
      throw new SessionError('file di sessione non valido: voce inattesa «' + String(e.name).slice(0, 60) + '»');
    }
    total += e.size;
    if (total > LIMIT.total) throw new SessionError('file di sessione troppo grande');
    files.set(e.name, e);
  }
  const get = (name, max) => {
    const e = files.get(name);
    if (!e) throw new SessionError('file di sessione incompleto: manca «' + name + '»');
    if (e.size > max) throw new SessionError('«' + name + '» troppo grande');
    try { return extractEntry(bytes, e); } catch (err) {
      if (err instanceof ZipError) throw new SessionError('«' + name + '»: ' + err.message);
      throw err;
    }
  };
  const dec = new TextDecoder('utf-8', {fatal: true});
  const parseJson = (data, what) => {
    try { return JSON.parse(dec.decode(data)); } catch (e) { throw new SessionError(what + ': JSON non valido'); }
  };
  const meta = parseJson(get('sessione.json', LIMIT.json), 'sessione.json');
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.format !== FORMAT) throw new SessionError('non e’ un file di sessione di o2web');
  if (!Number.isInteger(meta.version) || meta.version < 1) throw new SessionError('versione della sessione non valida');
  if (meta.version > VERSION) throw new SessionError('sessione di una versione piu’ recente (' + meta.version + '): aggiorna la pagina');
  if (meta.standard !== 'PAL' && meta.standard !== 'NTSC') throw new SessionError('standard video non valido');
  if (!Array.isArray(meta.bios) || !Array.isArray(meta.games)) throw new SessionError('sessione.json non valido: mancano gli elenchi');
  if (meta.bios.length > LIMITS.bios || meta.games.length > LIMITS.games) throw new SessionError('troppe voci nella sessione');
  if (!Number.isInteger(meta.activeGame) || meta.activeGame < -1 || meta.activeGame >= meta.games.length) throw new SessionError('gioco in uso non valido');
  if (!Number.isInteger(meta.activeBios) || meta.activeBios < -1 || meta.activeBios >= meta.bios.length) throw new SessionError('BIOS in uso non valido');
  const settings = checkSettings(meta.settings);

  const used = new Set(['sessione.json']);
  if (files.has('LEGGIMI.txt')) used.add('LEGGIMI.txt');
  const seen = new Set();
  const out = {standard: meta.standard, activeGame: meta.activeGame, activeBios: meta.activeBios, bios: [], games: [], charset: null, efCharset: null, chessRom: null, settings,
    created: isStr(meta.created, 60) ? meta.created : ''};
  const claim = (file, what) => {
    if (used.has(file)) throw new SessionError(what + ': file «' + file + '» usato due volte');
    used.add(file);
  };
  meta.bios.forEach((r, i) => {
    const what = 'BIOS ' + (i + 1);
    checkRec(r, what);
    if (r.file !== 'bios/' + pad4(i) + '.bin') throw new SessionError(what + ': nome del file inatteso');
    claim(r.file, what);
    const key = 'b|' + r.sha;
    if (seen.has(key)) throw new SessionError(what + ': voce duplicata («' + r.name + '»)');
    seen.add(key);
    const data = get(r.file, LIMIT.leaf);
    strictBytes(data, r, what, 1, LIMIT.leaf);
    out.bios.push({name: r.name, folder: r.folder, origin: r.origin, sha: r.sha, data});
  });
  meta.games.forEach((r, i) => {
    const what = 'gioco ' + (i + 1) + (r && typeof r === 'object' && typeof r.name === 'string' ? ' («' + r.name.slice(0, 60) + '»)' : '');
    checkRec(r, what, (x) => {
      if (x.state !== null && !isStr(x.state, 40)) throw new SessionError(what + ': stato non valido');
      if (x.state === null && x.stateBios !== null) throw new SessionError(what + ': impronta del BIOS senza stato');
      if (x.state !== null && (typeof x.stateBios !== 'string' || !HEX64.test(x.stateBios))) throw new SessionError(what + ': impronta del BIOS dello stato non valida');
    });
    if (r.file !== 'carte/' + pad4(i) + '.bin') throw new SessionError(what + ': nome del file inatteso');
    claim(r.file, what);
    const key = 'g|' + r.folder + '|' + r.name + '|' + r.sha;
    if (seen.has(key)) throw new SessionError(what + ': voce duplicata');
    seen.add(key);
    const data = get(r.file, LIMIT.leaf);
    strictBytes(data, r, what, 1, LIMIT.leaf);
    let state = null;
    if (r.state !== null) {
      if (r.state !== 'stati/' + pad4(i) + '.json') throw new SessionError(what + ': nome dello stato inatteso');
      claim(r.state, what);
      state = parseJson(get(r.state, LIMIT.state), what + ': stato');
      if (!state || typeof state !== 'object' || Array.isArray(state) || state.format !== 'o2web-snapshot' || !state.hashes || typeof state.hashes !== 'object') {
        throw new SessionError(what + ': lo stato non e’ uno stato di gioco');
      }
      if (state.hashes.cart !== r.sha) throw new SessionError(what + ': lo stato e’ di un’altra cartuccia');
      if (state.hashes.bios !== r.stateBios) throw new SessionError(what + ': impronta del BIOS dello stato incoerente');
    }
    out.games.push({name: r.name, folder: r.folder, origin: r.origin, sha: r.sha, data, state});
  });
  if (meta.charset !== null && meta.charset !== undefined) {
    const c = meta.charset;
    if (!c || typeof c !== 'object' || c.file !== 'charset.bin' || c.size !== 512 || typeof c.sha !== 'string' || !HEX64.test(c.sha)) {
      throw new SessionError('set di caratteri: voce non valida');
    }
    claim('charset.bin', 'set di caratteri');
    const data = get('charset.bin', 512);
    strictBytes(data, c, 'set di caratteri', 512, 512);
    out.charset = data;
  }
  if (meta.efCharset !== null && meta.efCharset !== undefined) {
    const c = meta.efCharset;
    if (meta.version < 2) throw new SessionError('set di caratteri dell’EF9341 in una sessione di versione 1');
    if (!c || typeof c !== 'object' || c.file !== 'efcharset.bin' || c.size !== 2560 || typeof c.sha !== 'string' || !HEX64.test(c.sha)) {
      throw new SessionError('set di caratteri dell’EF9341: voce non valida');
    }
    claim('efcharset.bin', 'set di caratteri dell’EF9341');
    const data = get('efcharset.bin', 2560);
    strictBytes(data, c, 'set di caratteri dell’EF9341', 2560, 2560);
    out.efCharset = data;
  }
  if (meta.chessRom !== null && meta.chessRom !== undefined) {
    const c = meta.chessRom;
    if (meta.version < 3) throw new SessionError('ROM del modulo scacchi in una sessione di versione ' + meta.version);
    if (!c || typeof c !== 'object' || c.file !== 'z80rom.bin' || c.size !== 8192 || typeof c.sha !== 'string' || !HEX64.test(c.sha)) {
      throw new SessionError('ROM del modulo scacchi: voce non valida');
    }
    claim('z80rom.bin', 'ROM del modulo scacchi');
    const data = get('z80rom.bin', 8192);
    strictBytes(data, c, 'ROM del modulo scacchi', 8192, 8192);
    if (!isChessZ80(data)) throw new SessionError('ROM del modulo scacchi: non e’ la ROM dello Z80 del C7010');
    out.chessRom = data;
  }
  for (const name of files.keys()) if (!used.has(name)) throw new SessionError('file di sessione non valido: voce non dichiarata «' + name + '»');
  return out;
}

// dal risultato di parseSession a un elenco nuovo; non tocca niente di esistente. Gli id si riassegnano in ordine.
function restoreLibrary(p) {
  const lib = new Library();
  const states = new Map();
  let activeBiosId = null, activeGameId = null;
  p.bios.forEach((b, i) => {
    const rec = lib.addBios(makeBios(b.name, b.folder, b.origin, b.data, b.sha));
    if (!rec) throw new SessionError('BIOS duplicato nella sessione');
    if (i === p.activeBios) activeBiosId = rec.id;
  });
  p.games.forEach((g, i) => {
    const rec = lib.addGame(makeGame(g.name, g.folder, g.origin, g.data, g.sha));
    if (!rec) throw new SessionError('gioco duplicato nella sessione');
    if (g.state) states.set(rec.id, g.state);
    if (i === p.activeGame) activeGameId = rec.id;
  });
  return {lib, activeGameId, activeBiosId, states};
}

module.exports = {buildSession, parseSession, restoreLibrary, checkSettings, SessionError, WARNING, FORMAT, VERSION, README};
