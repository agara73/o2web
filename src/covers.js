'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// covers.js - le COPERTINE dei giochi (tappa 4c). Nessuna copertina e' nel codice, nei sorgenti, nella pagina consegnata o nella sessione: le porta l'utente
// (immagini, cartelle o zip dal suo disco, oppure scaricate da un indirizzo che sceglie lui) e restano in memoria nel browser, finche' la pagina e' aperta.
//   sniffImage(bytes)          -> 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null   (dal contenuto, non dall'estensione)
//   imageInfo(bytes)           -> {mime, w, h} | null   (legge le dimensioni dall'intestazione: si rifiutano immagini enormi, che il browser dovrebbe decomprimere)
//   isCoverArchive(bytes)      -> uno zip con immagini e senza dump (.bin, .rom, .o2, .vp) ne' zip annidati?
//   parseCoverName(percorso)   -> {tkey, year, countries, publisher, norm, role}    dal nome del file (TOSEC «Titolo (1981)(Philips)(EU)» o, per esempio, «Titolo (Europe)»)
//   gameDesc(gioco)            -> lo stesso, per un gioco dell'elenco
//   class Covers               addFile (async, zip annidati), forGame / matchFor, remove, clear, filtri per ruolo (copertina o schermata)
// Abbinamento (DA VERIFICARE con le copertine vere dell'utente): conta il titolo (senza maiuscole, accenti, punteggiatura, articolo iniziale o finale ", The",
// «&» / «and»); poi, a parita' di titolo, l'anno, il paese e l'editore scelgono la copertina piu' vicina; un nome identico a quello TOSEC vince su tutto.
// Limiti (contro file malevoli): una sola immagine al massimo 8 MB e 8192 x 8192 punti (40 milioni in tutto), zip annidati fino a profondita' 2, 20000 voci,
// 512 MB estratti, 256 MB di copertine in memoria, 5000 copertine.
const {isZip, listZip, extractEntry, crc32, ZipError} = require('./unzip.js');
const {searchKey} = require('./library.js');

const LIMITS = {
  depth: 2, entries: 20000, image: 8 << 20, inner: 256 << 20, budget: 512 << 20,
  total: 256 << 20, covers: 5000, side: 8192, pixels: 40000000,
};
const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const DUMP_EXTS = ['.bin', '.rom', '.o2', '.vp'];

// ---- riconoscimento delle immagini
function sniffImage(b) {
  const n = b.length;
  if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
  if (n >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (n >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  if (n >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

function jpegSize(b) {
  let i = 2, guard = 0;
  while (i + 4 <= b.length && guard++ < 4096) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xFF) { i++; continue; }
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD9)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      if (i + 9 > b.length) return null;
      return {w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6]};
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  const f = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (f === 'VP8 ' && b.length >= 30 && b[23] === 0x9D && b[24] === 0x01 && b[25] === 0x2A) return {w: le16(b, 26) & 0x3FFF, h: le16(b, 28) & 0x3FFF};
  if (f === 'VP8L' && b.length >= 25 && b[20] === 0x2F) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return {w: (bits & 0x3FFF) + 1, h: ((bits >>> 14) & 0x3FFF) + 1};
  }
  if (f === 'VP8X' && b.length >= 30) return {w: le24(b, 24) + 1, h: le24(b, 27) + 1};
  return null;
}

function imageInfo(b) {
  const mime = sniffImage(b);
  if (!mime) return null;
  let d = null;
  if (mime === 'image/png') { if (b.length >= 24 && be32(b, 8) === 13 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) d = {w: be32(b, 16), h: be32(b, 20)}; }
  else if (mime === 'image/gif') { if (b.length >= 10) d = {w: le16(b, 6), h: le16(b, 8)}; }
  else if (mime === 'image/jpeg') d = jpegSize(b);
  else d = webpSize(b);
  if (!d) return null;
  return {mime, w: d.w, h: d.h};
}

// ---- nomi
const ARTICLES = ['the', 'a', 'an', 'le', 'la', 'les', 'der', 'die', 'das', 'el', 'il'];
const REGIONS = {
  europe: ['EU'], usa: ['US'], 'united states': ['US'], world: ['EU', 'US'], japan: ['JP'], france: ['FR'], germany: ['DE'], brazil: ['BR'], spain: ['ES'],
  italy: ['IT'], uk: ['GB'], 'united kingdom': ['GB'], netherlands: ['NL'], sweden: ['SE'], australia: ['AU'], canada: ['CA'], korea: ['KR'],
};

function titleWords(title) {
  let t = String(title).trim();
  const m = new RegExp('^(.*),\\s*(' + ARTICLES.join('|') + ')$', 'i').exec(t);
  if (m) t = m[1];
  let w = searchKey(t).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  if (!m && w.length > 1 && ARTICLES.includes(w[0])) w = w.slice(1);
  return w.filter((x) => x !== 'and');
}

function normName(base) { return searchKey(base).replace(/[^a-z0-9]+/g, ''); }

function nameParts(base) {
  const m = /^(.*?)(?=\s*[([]|$)/.exec(base);
  const title = (m ? m[1] : base).trim() || base.trim();
  const groups = [];
  const re = /\(([^()]*)\)/g;
  let g;
  while ((g = re.exec(base.slice(m ? m[0].length : 0)))) groups.push(g[1].trim());
  return {title, groups};
}

function countriesOf(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (/^[A-Z]{2}(?:-[A-Z]{2})*$/.test(t)) return t.split('-');
  const out = [];
  for (const part of t.split(',')) {
    const r = REGIONS[part.trim().toLowerCase()];
    if (!r) return null;                     // non e' un elenco di paesi (probabilmente l'editore)
    for (const c of r) if (!out.includes(c)) out.push(c);
  }
  return out;
}

function descOf(title, groups, base) {
  const d = {tkey: titleWords(title).join(''), year: '', countries: [], publisher: [], norm: normName(base), role: ''};
  let pubDone = false;
  for (const g of groups) {
    if (!d.year && /^(?:\d{4}|\d{3}x|\d{2}xx)(?:-\d{2}(?:-\d{2})?)?$/i.test(g)) { d.year = g.slice(0, 4).toLowerCase(); continue; }
    const c = countriesOf(g);
    if (c && c.length) { for (const x of c) if (!d.countries.includes(x)) d.countries.push(x); continue; }
    if (!pubDone && g !== '-') { d.publisher = searchKey(g).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean); pubDone = true; }
  }
  return d;
}

function folderOf(path) {
  const p = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i < 0) return '';
  const d = p.slice(0, i), j = d.lastIndexOf('/');
  return j >= 0 ? d.slice(j + 1) : d;
}
function roleOf(folder) {
  if (/snap|screen|title|ingame|gameplay|schermat/i.test(folder)) return 'shot';
  if (/box|cover|front|artwork|copertin|jaquette|cartridge/i.test(folder)) return 'box';
  return '';
}

function parseCoverName(path) {
  const p = String(path).replace(/\\/g, '/');
  const base = p.slice(p.lastIndexOf('/') + 1).replace(/\.(png|jpe?g|webp|gif)$/i, '');
  const {title, groups} = nameParts(base);
  const d = descOf(title, groups, base);
  d.role = roleOf(folderOf(p));
  return d;
}

// descrizione di un gioco dell'elenco (library.js: title, year, country, publisher, name)
function gameDesc(g) {
  const base = String(g.name || '').replace(/\.(bin|rom|o2|vp|zip)$/i, '');
  const d = descOf(g.title || nameParts(base).title, [g.year || '', g.country || '', g.publisher || ''].filter(Boolean), base);
  return d;
}

function ext(name) {
  const m = /(\.[A-Za-z0-9]{1,4})$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

// ---- uno zip di sole immagini (e file di contorno)? Serve a smistare i file scelti nel solo pulsante «Aggiungi file»
function isCoverArchive(bytes) {
  if (!isZip(bytes)) return false;
  let list;
  try { list = listZip(bytes); } catch (e) { return false; }
  let imgs = 0;
  for (const e of list) {
    if (e.dir) continue;
    const x = ext(e.name);
    if (DUMP_EXTS.includes(x) || x === '.zip') return false;
    if (IMG_EXTS.includes(x)) imgs++;
  }
  return imgs > 0;
}

// punteggio di un'immagine rispetto a un gioco (stesso titolo richiesto dal chiamante)
function score(gd, c) {
  if (gd.norm === c.norm) return 100 + (c.role === 'box' ? 0.5 : c.role === 'shot' ? -0.5 : 0);
  let s = 10;
  if (/^\d{4}$/.test(gd.year) && /^\d{4}$/.test(c.year)) s += gd.year === c.year ? 4 : -1;
  if (gd.countries.length && c.countries.length) s += gd.countries.some((x) => c.countries.includes(x)) ? 2 : -1;
  if (gd.publisher.length && c.publisher.length && gd.publisher.some((w) => c.publisher.includes(w))) s += 1;
  if (c.role === 'box') s += 0.5; else if (c.role === 'shot') s -= 0.5;
  return s;
}

class LimitError extends Error {}

class Covers {
  constructor() {
    this.nextId = 1;                // gli id non si riusano mai (nemmeno dopo clear): la pagina li usa per le miniature in cache
    this.rev = 0;                   // sale a ogni aggiunta, rimozione o svuotamento
    this._empty();
  }
  _empty() {
    this.list = [];
    this.by = new Map();
    this.keys = new Set();
    this.bytes = 0;
  }
  clear() { this._empty(); this.rev++; }
  get count() { return this.list.length; }
  get(id) { return this.list.find((c) => c.id === id) || null; }

  _index(c) {
    const a = this.by.get(c.tkey);
    if (a) a.push(c); else this.by.set(c.tkey, [c]);
  }
  remove(id) {
    const i = this.list.findIndex((c) => c.id === id);
    if (i < 0) return false;
    const c = this.list[i];
    this.list.splice(i, 1);
    this.keys.delete(c.key);
    this.bytes -= c.size;
    const a = this.by.get(c.tkey).filter((x) => x !== c);
    if (a.length) this.by.set(c.tkey, a); else this.by.delete(c.tkey);
    this.rev++;
    return true;
  }

  // la copertina piu' vicina al gioco (o null) con il suo punteggio; a parita' di punteggio vince il nome (ordine alfabetico), poi l'ordine di arrivo
  matchFor(g) {
    const gd = gameDesc(g);
    if (!gd.tkey) return null;
    const cands = this.by.get(gd.tkey);
    if (!cands || !cands.length) return null;
    let best = null, bs = -Infinity;
    for (const c of cands) {
      const s = score(gd, c);
      if (s > bs || (s === bs && (c.name < best.name || (c.name === best.name && c.id < best.id)))) { best = c; bs = s; }
    }
    return {cover: best, score: bs, exact: bs >= 100};
  }
  forGame(g) { const m = this.matchFor(g); return m ? m.cover : null; }
  matchedCount(games) { let n = 0; for (const g of games) if (this.matchFor(g)) n++; return n; }

  // Importa un file dell'utente (byte gia' letti): un'immagine, uno zip di immagini o un zip di zip. name puo' essere un percorso («cartella/Titolo.png»).
  // Ritorna {added, dups, skipped: [{name, why}], errors: [testo], visited, addedIds}
  async addFile(name, bytes, opts) {
    const rep = {added: 0, dups: 0, skipped: [], errors: [], visited: 0, addedIds: []};
    const ctx = {rep, budget: LIMITS.budget, count: 0, onProgress: (opts && opts.onProgress) || null};
    try {
      await this._ingest(String(name), bytes, 0, ctx);
    } catch (e) {
      if (e instanceof LimitError || e instanceof ZipError) rep.errors.push(name + ': ' + e.message);
      else throw e;
    }
    rep.visited = ctx.count;
    if (rep.added) this.rev++;
    return rep;
  }

  async _ingest(name, bytes, depth, ctx) {
    const rep = ctx.rep;
    if (++ctx.count > LIMITS.entries) throw new LimitError('troppe voci (oltre ' + LIMITS.entries + ')');
    if (ctx.count % 16 === 0) { if (ctx.onProgress) ctx.onProgress(ctx.count); await new Promise((r) => setTimeout(r, 0)); }
    const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
    if (isZip(bytes)) {
      if (depth >= LIMITS.depth) { rep.skipped.push({name: base, why: 'zip annidati troppo in profondità'}); return; }
      let list;
      try { list = listZip(bytes); } catch (e) {
        if (!(e instanceof ZipError)) throw e;
        rep.errors.push(base + ': ' + e.message);
        return;
      }
      const prefix = name.replace(/\\/g, '/').replace(/[^/]*$/, '');       // la cartella dello zip: i nomi delle voci ne ereditano il percorso
      for (const e of list) {
        if (e.dir) continue;
        const p = (prefix + e.name).replace(/\\/g, '/');
        const isz = /\.zip$/i.test(p);
        if (e.size > (isz ? LIMITS.inner : LIMITS.image)) {
          rep.skipped.push({name: p.slice(p.lastIndexOf('/') + 1), why: isz ? 'zip troppo grande' : 'immagine troppo grande (' + e.size + ' byte)'});
          continue;
        }
        if (!isz && !IMG_EXTS.includes(ext(p))) { rep.skipped.push({name: p.slice(p.lastIndexOf('/') + 1), why: 'non è un’immagine (' + (ext(p) || 'senza estensione') + ')'}); continue; }
        ctx.budget -= e.size;
        if (ctx.budget < 0) throw new LimitError('limite di byte estratti superato (' + (LIMITS.budget >> 20) + ' MB)');
        let data;
        try { data = extractEntry(bytes, e); } catch (err) {
          if (!(err instanceof ZipError)) throw err;
          rep.errors.push(p.slice(p.lastIndexOf('/') + 1) + ': ' + err.message);
          continue;
        }
        await this._ingest(p, data, depth + 1, ctx);
      }
      return;
    }
    if (!IMG_EXTS.includes(ext(base))) { rep.skipped.push({name: base, why: 'non è un’immagine (' + (ext(base) || 'senza estensione') + ')'}); return; }
    if (bytes.length === 0) { rep.skipped.push({name: base, why: 'file vuoto'}); return; }
    if (bytes.length > LIMITS.image) { rep.skipped.push({name: base, why: 'immagine troppo grande (' + bytes.length + ' byte)'}); return; }
    const info = imageInfo(bytes);
    if (!info) { rep.skipped.push({name: base, why: sniffImage(bytes) ? 'intestazione dell’immagine non leggibile' : 'il contenuto non è un’immagine PNG, JPEG, WebP o GIF'}); return; }
    if (!(info.w > 0 && info.h > 0) || info.w > LIMITS.side || info.h > LIMITS.side || info.w * info.h > LIMITS.pixels) {
      rep.skipped.push({name: base, why: 'dimensioni non ammesse (' + info.w + ' x ' + info.h + ' punti)'});
      return;
    }
    const d = parseCoverName(name);
    if (!d.tkey) { rep.skipped.push({name: base, why: 'nome senza titolo'}); return; }
    const key = d.norm + '|' + d.role + '|' + bytes.length + '|' + crc32(bytes);
    if (this.keys.has(key)) { rep.dups++; return; }
    if (this.list.length >= LIMITS.covers) throw new LimitError('troppe copertine (oltre ' + LIMITS.covers + ')');
    if (this.bytes + bytes.length > LIMITS.total) throw new LimitError('copertine oltre il limite di memoria (' + (LIMITS.total >> 20) + ' MB)');
    const c = {id: this.nextId++, name: base, folder: folderOf(name), mime: info.mime, size: bytes.length, w: info.w, h: info.h, data: bytes, key,
      tkey: d.tkey, year: d.year, countries: d.countries, publisher: d.publisher, norm: d.norm, role: d.role};
    this.keys.add(key);
    this.bytes += bytes.length;
    this.list.push(c);
    this._index(c);
    rep.added++;
    rep.addedIds.push(c.id);
  }
}

module.exports = {Covers, LimitError, LIMITS, IMG_EXTS, ext, sniffImage, imageInfo, isCoverArchive, parseCoverName, gameDesc, titleWords, normName, countriesOf, roleOf, score};
