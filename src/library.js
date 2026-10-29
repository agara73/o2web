'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// library.js - l'ELENCO UNICO dei giochi e dei BIOS dell'utente (nessun dump e' nel codice: li porta l'utente, per uso personale).
// L'elenco si alimenta con file singoli (.bin) e con archivi .zip, anche annidati: le raccolte TOSEC sono uno zip di cartelle che
// contengono uno zip per gioco. Tutto avviene in memoria, nel browser: nessun file lascia il computer dell'utente.
//   parseTosecName(nome)        -> {title, display, year, publisher, country, extra[], flags[], warn[]}  dal nome di file TOSEC
//   cleanFolder(testo)          -> nome della cartella senza il suffisso «(TOSEC-v...)»
//   classify(nome, folder, bytes) -> {kind: 'bios' | 'cart' | 'charset' | 'chessz80' | 'skip', ...}   cartuccia, BIOS, set di caratteri o ROM dello Z80 del modulo scacchi? (impronta nota, dimensione, nome)
//   KNOWN_BIOS                  impronte SHA-256 dei BIOS noti (solo impronte: nessun contenuto)
//   class Library               giochi e BIOS: addFile (async, zip annidati), addGame/addBios (usati dalla sessione), filtri
//   filterGames(list, {query, folder}), folderList(list), searchKey(testo)
// Regole sui file ricevuti: si legge solo il contenuto; i nomi dentro uno zip non toccano mai il disco; limiti su profondita',
// numero di voci e byte estratti (contro zip-bomba); le voci illeggibili si segnalano e si salta il resto, senza fermare l'import.
const {sha256} = require('./sha256.js');
const {isZip, listZip, extractEntry, ZipError, crc32} = require('./unzip.js');
const {analyzeCart, layoutCart} = require('./cartmap.js');
const {parseNameList, decodeText, MIN_LIST} = require('./gamenames.js');

const LIMITS = {
  depth: 3,                       // zip dentro zip dentro zip
  entries: 20000,                 // voci visitate in tutto
  leaf: 32768,                    // un BIOS o una cartuccia: oltre, non e' un dump di questa console
  list: 131072,                   // (tappa 7) un elenco di nomi in testo (Gamelist777.txt e simili)
  inner: 64 << 20,                // uno zip annidato
  budget: 512 << 20,              // byte estratti in tutto per una chiamata
  games: 5000, bios: 200,         // elementi dell'elenco
};
const CART_EXTS = ['.bin', '.rom', '.o2', '.vp'];
const CHARSET_SIZE = 512;         // il set di caratteri del chip video: nessun BIOS ne' cartuccia e' cosi' piccolo
// Modulo scacchi Philips C7010 (tappa 6a): la cartuccia da 2 KB vista dall'8048 e la ROM da 8 KB dello Z80 si riconoscono per dimensione + CRC-32
// (mai dal nome del file). Solo queste impronte: un altro file da 2 KB e' una cartuccia normale, un altro da 8 KB una cartuccia da 8 KB.
const CHESS = {cartSize: 2048, cartCrc: 0x77066338, z80Size: 8192, z80Crc: 0x45080245};
const isChessCart = (bytes) => bytes.length === CHESS.cartSize && crc32(bytes) === CHESS.cartCrc;
const isChessZ80 = (bytes) => bytes.length === CHESS.z80Size && crc32(bytes) === CHESS.z80Crc;
const EF_CHARSET_SIZE = 2560;     // (tappa 5) la ROM dei caratteri dell'EF9341 del G7400: 256 voci da 10 byte; nessuna cartuccia ha questa dimensione (non e' un multiplo di 2 KB)

// ---- BIOS noti: SHA-256 -> {label, system, supported, reason}. DA VERIFICARE le etichette (MD5 dalla lista O2EM/libretro, o2web-stato.md)
const KNOWN_BIOS = {
  'cb0c5d9ed64f7c1d8870333451832638885b9aa3d7013f0c05fd2a20a5e5bfef': {label: 'Odyssey 2 / Videopac G7000 (Europa-USA)', system: 'g7000', supported: true},
  '2ab1b2c7f4b28a74d0ecf3e073088fac19ce40866404420c70576e1862bb5502': {label: 'Philips C52 (Francia)', system: 'g7000', supported: true},
  '8e0413c324a748ca2e493652b8089aa1db129e1ba115b5f58a99e32cebe063e1': {label: 'Videopac+ G7400 (Europa)', system: 'g7400', supported: true},
  'dd48b75c56dbe1524dee18defa448a74f648653eb209ccba93066a7a0fe6a074': {label: 'Brandt Jopac (Francia)', system: 'g7400', supported: true},
};

// ---- nome TOSEC: «Titolo (anno)(editore)(paese)[flag]»
const FLAG_TEXT = {
  a: 'variante', b: 'dump difettoso', h: 'modificata (hack)', o: 'dump con byte in più', t: 'con trucchi', f: 'corretta', cr: 'con crack',
  m: 'modificata', p: 'pirata', u: 'sconosciuta', v: 'versione', '!': 'dump verificato',
};
const FLAG_WARN = {b: 'dump difettoso: potrebbe non funzionare'};
const YEAR_RE = /^(?:\d{4}|\d{3}x|\d{2}xx|[0-9x]{4})(?:-\d{2}(?:-\d{2})?)?$/;
const COUNTRY_RE = /^[A-Z]{2}(?:-[A-Z]{2})*$/;

function parseTosecName(fileName) {
  let base = String(fileName);
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (slash >= 0) base = base.slice(slash + 1);
  base = base.replace(/\.(bin|rom|o2|vp|zip)$/i, '');
  const m = /^(.*?)(?=\s*[([]|$)/.exec(base);
  const title = (m ? m[1] : base).trim() || base.trim();
  const rest = base.slice(m ? m[0].length : 0);
  const groups = [], flags = [];
  const re = /\(([^()]*)\)|\[([^[\]]*)\]/g;
  let g;
  while ((g = re.exec(rest))) {
    if (g[1] !== undefined) groups.push(g[1].trim());
    else flags.push(g[2].trim());
  }
  const r = {title, display: title, year: '', publisher: '', country: '', extra: [], flags: [], warn: []};
  // «Titolo, The» -> «The Titolo»
  const art = /^(.*), (The|A|An|Le|La|Les|Der|Die|Das|El|Il)$/.exec(title);
  if (art) r.display = art[2] + ' ' + art[1];
  let i = 0;
  if (groups.length && YEAR_RE.test(groups[0])) { r.year = groups[0]; i = 1; }
  if (groups.length > i) { r.publisher = groups[i] === '-' ? '' : groups[i]; i++; }
  if (groups.length > i && COUNTRY_RE.test(groups[i])) { r.country = groups[i]; i++; }
  for (; i < groups.length; i++) r.extra.push(groups[i]);
  for (const f of flags) {
    r.flags.push(f);
    const k = /^[a-z!]+/.exec(f);
    if (k && FLAG_WARN[k[0]]) r.warn.push(FLAG_WARN[k[0]]);
  }
  return r;
}

// descrizione leggibile dei flag: «[a2]» -> «variante 2»
function flagLabel(f) {
  const m = /^([a-z]+|!)(\d*)/.exec(f);
  if (!m) return f;
  const t = FLAG_TEXT[m[1]];
  if (!t) return f;
  return m[2] ? t + ' ' + m[2] : t;
}

function cleanFolder(s) {
  return String(s || '').replace(/\s*\(TOSEC[^)]*\)\s*/gi, ' ').replace(/\s*\[TOSEC\]\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

// nome senza accenti e in minuscolo, per la ricerca
function searchKey(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function baseName(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}
function dirOf(path) {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i < 0) return '';
  const d = p.slice(0, i);
  const j = d.lastIndexOf('/');
  return j >= 0 ? d.slice(j + 1) : d;
}
function extOf(name) {
  const m = /(\.[A-Za-z0-9]{1,4})$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}
function platformOf(folder) {
  const f = cleanFolder(folder);
  const i = f.indexOf(' - ');
  return i >= 0 ? f.slice(0, i) : '';
}

// Cartuccia, BIOS o set di caratteri? kind: 'bios' | 'cart' | 'charset' | 'skip' (con il motivo). Nessun elenco di titoli: contano impronta,
// dimensione e nome. Un file di esattamente 512 byte (con una delle estensioni dei dump) e' un set di caratteri: non entra nell'elenco, lo prende app.js.
function classify(name, folder, bytes) {
  const n = bytes.length;
  const base = baseName(name);
  if (n === 0) return {kind: 'skip', why: 'file vuoto'};
  if (n > LIMITS.leaf) return {kind: 'skip', why: 'troppo grande per un dump di questa console (' + n + ' byte)'};
  const ext = extOf(base);
  if (ext && !CART_EXTS.includes(ext)) return {kind: 'skip', why: 'tipo di file non riconosciuto (' + ext + ')'};
  const sha = sha256(bytes);
  const known = KNOWN_BIOS[sha] || null;
  if (n === CHARSET_SIZE) return {kind: 'charset', sha, chip: 'vdc'};
  if (n === EF_CHARSET_SIZE) return {kind: 'charset', sha, chip: 'ef'};
  if (n === CHESS.z80Size && isChessZ80(bytes)) return {kind: 'chessz80', sha};
  const hint = /bios|firmware|jopac|c52/i.test(base + ' ' + folder);
  if (known) return {kind: 'bios', sha, known};
  if (n === 1024) return {kind: 'bios', sha, known: null};           // nessuna cartuccia e' cosi' piccola
  if (n === 2048 && hint) return {kind: 'bios', sha, known: null};
  if (n < 1024) return {kind: 'skip', why: 'troppo piccolo (' + n + ' byte)'};
  if (hint && n <= 2048) return {kind: 'bios', sha, known: null};
  return {kind: 'cart', sha};
}

function makeGame(name, folder, origin, bytes, sha) {
  const base = baseName(name);
  const info = parseTosecName(base);
  const padded = new Uint8Array(Math.ceil(bytes.length / 0x800) * 0x800).fill(0xFF);
  padded.set(bytes);
  const map = analyzeCart(layoutCart(padded));      // 12 KB: parte alta di una finestra da 16 KB (come fa la console)
  const cf = cleanFolder(folder);
  return {
    id: 0, name: base, folder: cf, platform: platformOf(folder), origin: origin || '', size: bytes.length, sha: sha || sha256(bytes), data: bytes,
    title: info.title, display: info.display, year: info.year, publisher: info.publisher, country: info.country, extra: info.extra,
    flags: info.flags, warn: info.warn.slice(), map: {kind: map.kind, banks: map.banks, ok: map.ok, reason: map.reason}, chess: isChessCart(bytes),
  };
}

function makeBios(name, folder, origin, bytes, sha, known) {
  const base = baseName(name);
  const info = parseTosecName(base);
  const k = known === undefined ? (KNOWN_BIOS[sha || sha256(bytes)] || null) : known;
  let supported = bytes.length === 1024, reason = '';
  if (bytes.length !== 1024) reason = 'BIOS da ' + bytes.length + ' byte: formato non supportato (solo 1024 byte)';
  else if (k && !k.supported) { supported = false; reason = k.reason || 'non supportato'; }
  return {
    id: 0, name: base, folder: cleanFolder(folder), platform: platformOf(folder), origin: origin || '', size: bytes.length, sha: sha || sha256(bytes), data: bytes,
    title: info.title, display: k ? k.label : info.display, year: info.year, publisher: info.publisher, country: info.country,
    known: k ? {label: k.label, system: k.system} : null, supported, reason,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

class Library {
  constructor() {
    this.games = [];
    this.bios = [];
    this.nextId = 1;
    this.keys = new Set();
    this.names = new Map();         // (tappa 7) nomi dei giochi letti da elenchi dell'utente (Gamelist777.txt e simili): chiave = nome del file senza estensione, in minuscole
    this.nameLists = [];            // [{name, count}] gli elenchi letti
    this.version = 0;               // cresce a ogni cambiamento di giochi o nomi: serve a chi tiene in memoria una vista dell'elenco
  }

  clear() { this.games = []; this.bios = []; this.keys.clear(); this.names = new Map(); this.nameLists = []; this.version++; }
  // aggiunge un elenco di nomi gia' letto (parseNameList); le voci piu' recenti valgono piu' delle vecchie
  addNames(name, map) {
    for (const [k, v] of map) this.names.set(k, v);
    this.nameLists.push({name, count: map.size});
    this.version++;
  }
  getGame(id) { return this.games.find((g) => g.id === id) || null; }
  getBios(id) { return this.bios.find((b) => b.id === id) || null; }
  findBiosBySha(sha) { return this.bios.find((b) => b.sha === sha) || null; }
  findGameBySha(sha) { return this.games.find((g) => g.sha === sha) || null; }

  // aggiunge un elemento gia' costruito; ritorna l'elemento, oppure null se e' un doppione (stesso nome, cartella e contenuto)
  _add(list, rec, max, what) {
    const key = this._key(what, rec);
    if (this.keys.has(key)) return null;
    if (list.length >= max) throw new Error('elenco pieno (' + max + ' ' + what + ')');
    this.keys.add(key);
    rec.id = this.nextId++;
    list.push(rec);
    this.version++;
    return rec;
  }
  // un BIOS con lo stesso contenuto si elenca una volta sola (qualunque sia il nome del file); un gioco e' lo stesso solo se hanno
  // stesso nome, cartella e contenuto (due titoli diversi possono avere lo stesso dump)
  _key(what, rec) { return what === 'BIOS' ? 'BIOS|' + rec.sha : what + '|' + rec.folder + '|' + rec.name + '|' + rec.sha; }
  addGame(rec) { return this._add(this.games, rec, LIMITS.games, 'giochi'); }
  addBios(rec) { return this._add(this.bios, rec, LIMITS.bios, 'BIOS'); }

  remove(kind, id) {
    const list = kind === 'bios' ? this.bios : this.games;
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const r = list[i];
    this.keys.delete(this._key(kind === 'bios' ? 'BIOS' : 'giochi', r));
    list.splice(i, 1);
    this.version++;
    return true;
  }

  // Importa un file dell'utente (byte gia' letti). name: nome del file scelto. Ritorna il rapporto:
  //   {games, bios, dups, skipped: [{name, why}], errors: [testo], visited, charsets: [{name, data, sha, chip: 'vdc' | 'ef'}], chessRoms: [{name, data, sha}]}  (i set di caratteri da 512 byte (chip video) e da 2560 byte (EF9341) trovati)
  async addFile(name, bytes, opts) {
    const rep = {games: 0, bios: 0, dups: 0, lists: 0, listNames: 0, skipped: [], errors: [], visited: 0, addedGames: [], addedBios: [], charsets: [], chessRoms: []};
    const ctx = {rep, budget: LIMITS.budget, count: 0, onProgress: (opts && opts.onProgress) || null, origin: name};
    try {
      await this._ingest(name, bytes, '', 0, ctx, true);
    } catch (e) {
      if (e instanceof LimitError || e instanceof ZipError) rep.errors.push(name + ': ' + e.message);
      else throw e;
    }
    rep.visited = ctx.count;
    return rep;
  }

  // name: percorso della voce; folder: cartella ereditata; top: file scelto dall'utente (non una voce di uno zip)
  async _ingest(name, bytes, folder, depth, ctx, top) {
    const rep = ctx.rep;
    if (++ctx.count > LIMITS.entries) throw new LimitError('troppe voci (oltre ' + LIMITS.entries + ')');
    if (ctx.count % 16 === 0) { if (ctx.onProgress) ctx.onProgress(ctx.count); await tick(); }
    if (isZip(bytes)) {
      if (depth >= LIMITS.depth) { rep.skipped.push({name, why: 'zip annidati troppo in profondità'}); return; }
      let list;
      try { list = listZip(bytes); } catch (e) {
        if (!(e instanceof ZipError)) throw e;
        rep.errors.push(baseName(name) + ': ' + e.message);
        return;
      }
      const files = list.filter((e) => !e.dir);
      const multi = files.length > 1;
      for (const e of files) {
        const p = e.name.replace(/\\/g, '/');
        const f = dirOf(p) || folder || (multi && depth === 0 ? baseName(name).replace(/\.zip$/i, '') : '');
        const isz = isZipName(p);
        const maxSize = isz ? LIMITS.inner : extOf(baseName(p)) === '.txt' ? LIMITS.list : LIMITS.leaf;
        if (e.size > maxSize) {
          rep.skipped.push({name: baseName(p), why: isz ? 'zip troppo grande' : 'troppo grande per un dump di questa console (' + e.size + ' byte)'});
          continue;
        }
        ctx.budget -= e.size;
        if (ctx.budget < 0) throw new LimitError('limite di byte estratti superato (' + (LIMITS.budget >> 20) + ' MB)');
        let data;
        try { data = extractEntry(bytes, e); } catch (err) {
          if (!(err instanceof ZipError)) throw err;
          rep.errors.push(baseName(p) + ': ' + err.message);
          continue;
        }
        await this._ingest(p, data, f, depth + 1, ctx, false);
      }
      return;
    }
    // un elenco di nomi («file.bin   descrizione» per riga, come Gamelist777.txt) non e' un dump: dà i nomi ai giochi
    if (extOf(baseName(name)) === '.txt' && bytes.length > 0 && bytes.length <= LIMITS.list) {
      const map = parseNameList(decodeText(bytes));
      if (map.size >= MIN_LIST) { this.addNames(baseName(name), map); rep.lists++; rep.listNames += map.size; return; }
    }
    const cls = classify(name, folder, bytes);
    if (cls.kind === 'skip') { rep.skipped.push({name: baseName(name), why: cls.why}); return; }
    if (cls.kind === 'charset') { rep.charsets.push({name: baseName(name), data: bytes, sha: cls.sha, chip: cls.chip}); return; }
    if (cls.kind === 'chessz80') { rep.chessRoms.push({name: baseName(name), data: bytes, sha: cls.sha}); return; }
    const origin = top ? 'file' : 'zip: ' + ctx.origin;
    try {
      if (cls.kind === 'bios') {
        const r = this.addBios(makeBios(name, folder, origin, bytes, cls.sha, cls.known));
        if (r) { rep.bios++; rep.addedBios.push(r.id); } else rep.dups++;
      } else {
        const r = this.addGame(makeGame(name, folder, origin, bytes, cls.sha));
        if (r) { rep.games++; rep.addedGames.push(r.id); } else rep.dups++;
      }
    } catch (e) {
      if (!/elenco pieno/.test(e.message)) throw e;
      throw new LimitError(e.message);
    }
  }
}

class LimitError extends Error {}
function isZipName(p) { return /\.zip$/i.test(p); }

// ---- elenco: ricerca per testo (tutte le parole, senza maiuscole e accenti) e filtro per cartella
function sortGames(list) {
  return list.slice().sort((a, b) => {
    const ka = searchKey(a.display), kb = searchKey(b.display);
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.year !== b.year) return a.year < b.year ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id - b.id;
  });
}

function gameText(g) {
  return searchKey([g.display, g.title, g.name, g.year, g.publisher, g.country, g.folder, g.platform, g.extra.join(' '), g.flags.join(' ')].join(' '));
}

function filterGames(list, opts) {
  const q = opts && opts.query ? searchKey(opts.query).split(/\s+/).filter(Boolean) : [];
  const folder = opts && opts.folder !== undefined && opts.folder !== null ? opts.folder : null;
  const out = list.filter((g) => {
    if (folder !== null && g.folder !== folder) return false;
    if (!q.length) return true;
    const t = gameText(g);
    return q.every((w) => t.includes(w));
  });
  return sortGames(out);
}

// [{folder, count}] in ordine alfabetico; la cartella vuota (file singoli) per ultima
function folderList(list) {
  const m = new Map();
  for (const g of list) m.set(g.folder, (m.get(g.folder) || 0) + 1);
  return [...m.entries()].map(([folder, count]) => ({folder, count})).sort((a, b) => {
    if (!a.folder !== !b.folder) return a.folder ? -1 : 1;
    return a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0;
  });
}

module.exports = {gameText, Library, KNOWN_BIOS, LIMITS, CHARSET_SIZE, EF_CHARSET_SIZE, CHESS, isChessCart, isChessZ80, LimitError, parseTosecName, flagLabel, cleanFolder, classify, makeGame, makeBios, filterGames, folderList,
  searchKey, sortGames, platformOf};
