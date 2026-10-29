'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// unzip.js - lettura di un file .zip (metodi "memorizzato" e "deflate") interamente nel browser, senza librerie e senza rete.
// Serve perche' i dump si trovano spesso in uno zip: se l'utente sceglie lo zip al posto del .bin, la pagina estrae il file giusto
// invece di avviare la console con un contenuto senza senso (schermo nero). Codice originale, scritto dalla specifica del formato
// (PKWARE APPNOTE, RFC 1951 per il deflate); non gestisce zip cifrati, zip64 ne' archivi divisi: in quei casi dice perche'.
//   isZip(bytes)            -> true se i primi byte sono la firma di un file zip
//   listZip(bytes)          -> [{name, size, csize, method, crc, offset, dir}]
//   extractEntry(bytes, e)  -> Uint8Array (con controllo CRC-32 e della dimensione)
//   pickEntry(bytes, exts)  -> {entry, others} sceglie il file piu' adatto fra quelli con le estensioni date (o l'unico file)
//   inflate(bytes)          -> Uint8Array (deflate grezzo)

class ZipError extends Error {}

function isZip(b) { return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6)); }

let CRC_T = null;
function crc32(b) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---- deflate (RFC 1951)
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// tabella di decodifica da lunghezze di codice: {count[len], symbol[]} (decodifica canonica bit per bit)
function huff(lengths) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return {count, symbol};
}

let FIXED = null;
function fixedTables() {
  if (!FIXED) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED = {lit: huff(l), dist: huff(new Uint8Array(30).fill(5))};
  }
  return FIXED;
}

// maxOut: limite di sicurezza sulla dimensione decompressa
function inflate(src, maxOut) {
  const limit = maxOut || (64 << 20);
  let pos = 0, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.min(Math.max(src.length * 4, 1024), limit)), op = 0;
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new ZipError('dati compressi troncati');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first += c;
      first <<= 1;
      code <<= 1;
    }
    throw new ZipError('codice di Huffman non valido');
  };
  const put = (v) => {
    if (op >= out.length) {
      if (out.length >= limit) throw new ZipError('file decompresso troppo grande');
      const n = new Uint8Array(Math.min(out.length * 2, limit));
      n.set(out);
      out = n;
    }
    out[op++] = v;
  };
  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) throw new ZipError('dati compressi troncati');
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if ((len ^ 0xFFFF) !== nlen) throw new ZipError('blocco memorizzato non valido');
      if (pos + len > src.length) throw new ZipError('dati compressi troncati');
      for (let i = 0; i < len; i++) put(src[pos++]);
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) {
        const t = fixedTables();
        lit = t.lit; dist = t.dist;
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new ZipError('tabelle di Huffman non valide');
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
        const clh = huff(cl);
        const lens = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const s = decode(clh);
          if (s < 16) lens[i++] = s;
          else {
            let prev = 0, rep;
            if (s === 16) {
              if (i === 0) throw new ZipError('tabelle di Huffman non valide');
              prev = lens[i - 1];
              rep = 3 + bits(2);
            } else if (s === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) throw new ZipError('tabelle di Huffman non valide');
            while (rep--) lens[i++] = prev;
          }
        }
        lit = huff(lens.subarray(0, nlen));
        dist = huff(lens.subarray(nlen));
      }
      for (;;) {
        const s = decode(lit);
        if (s < 256) put(s);
        else if (s === 256) break;
        else {
          const li = s - 257;
          if (li >= 29) throw new ZipError('simbolo di lunghezza non valido');
          const len = LBASE[li] + bits(LEXT[li]);
          const ds = decode(dist);
          if (ds >= 30) throw new ZipError('simbolo di distanza non valido');
          const d = DBASE[ds] + bits(DEXT[ds]);
          if (d > op) throw new ZipError('distanza oltre l’inizio dei dati');
          for (let i = 0; i < len; i++) put(out[op - d]);
        }
      }
    } else throw new ZipError('blocco compresso non valido');
  } while (!last);
  return out.slice(0, op);
}

// ---- contenitore zip
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const utf8 = (b) => { try { return new TextDecoder('utf-8').decode(b); } catch (e) { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; } };

function listZip(b) {
  if (!isZip(b)) throw new ZipError('non e’ un file zip');
  // fine della directory centrale: firma 0x06054B50 negli ultimi 22 + 65535 byte
  let e = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65535; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 5 && b[i + 3] === 6) { e = i; break; }
  }
  if (e < 0) throw new ZipError('zip danneggiato o incompleto (manca la directory centrale)');
  const total = u16(b, e + 10), cdSize = u32(b, e + 12), cdOff = u32(b, e + 16);
  if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new ZipError('zip64 non supportato');
  if (u16(b, e + 4) !== 0 || u16(b, e + 6) !== 0) throw new ZipError('archivio zip diviso in piu’ parti: non supportato');
  const list = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014B50) throw new ZipError('directory centrale dello zip non valida');
    const flags = u16(b, p + 8), method = u16(b, p + 10), crc = u32(b, p + 16), csize = u32(b, p + 20), size = u32(b, p + 24);
    const nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42);
    const name = utf8(b.subarray(p + 46, p + 46 + nl));
    list.push({name, size, csize, method, crc, offset: off, flags, dir: name.endsWith('/')});
    p += 46 + nl + el + cl;
  }
  return list;
}

function extractEntry(b, e) {
  if (e.flags & 1) throw new ZipError('zip cifrato: non supportato');
  if (e.method !== 0 && e.method !== 8) throw new ZipError('metodo di compressione ' + e.method + ' non supportato');
  const p = e.offset;
  if (p + 30 > b.length || u32(b, p) !== 0x04034B50) throw new ZipError('voce dello zip non valida');
  const start = p + 30 + u16(b, p + 26) + u16(b, p + 28);
  if (start + e.csize > b.length) throw new ZipError('zip troncato');
  const raw = b.subarray(start, start + e.csize);
  const data = e.method === 0 ? raw.slice() : inflate(raw, Math.max(e.size, 1) + 16);
  if (data.length !== e.size) throw new ZipError('dimensione del file estratto diversa da quella dichiarata');
  if (crc32(data) !== e.crc) throw new ZipError('controllo CRC-32 fallito: zip danneggiato');
  return data;
}

// exts: elenco di estensioni minuscole con il punto, es. ['.bin', '.rom']. Prima i file con quelle estensioni (nell'ordine dello zip);
// se non ce ne sono ma c'e' un solo file, quello.
function pickEntry(b, exts) {
  const files = listZip(b).filter((e) => !e.dir);
  if (!files.length) throw new ZipError('lo zip e’ vuoto');
  const good = files.filter((e) => exts.some((x) => e.name.toLowerCase().endsWith(x)));
  const use = good.length ? good : files.length === 1 ? files : [];
  if (!use.length) throw new ZipError('nello zip non c’e’ nessun file ' + exts.join(' / ') + ' (ci sono: ' + files.map((e) => e.name).join(', ') + ')');
  return {entry: use[0], others: use.slice(1).map((e) => e.name)};
}

module.exports = {isZip, listZip, extractEntry, pickEntry, inflate, crc32, ZipError};
