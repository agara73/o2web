'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// zipstore.js - scrittura di un file .zip SENZA compressione (metodo 0, "memorizzato"): nessun deflate da scrivere, apribile con
// qualunque programma di zip. Serve al file di sessione (session.js). Nomi in UTF-8 (bit 11 delle flag), nessuno zip64: sopra 4 GB o
// 65535 voci si rifiuta. Si legge con unzip.js (listZip / extractEntry).
//   zipStore(entries, date?) -> Uint8Array     entries: [{name: string, data: Uint8Array}]
const {crc32} = require('./unzip.js');

// data e ora DOS fisse (2026-01-01 00:00:00) se non se ne passa una: lo stesso contenuto da' sempre gli stessi byte
function dosDateTime(d) {
  if (!d) return {time: 0, date: ((2026 - 1980) << 9) | (1 << 5) | 1};
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()};
}

function zipStore(entries, date) {
  if (!Array.isArray(entries) || entries.length > 65535) throw new Error('troppe voci per uno zip');
  const enc = new TextEncoder();
  const {time, date: ddate} = dosDateTime(date);
  const seen = new Set();
  let total = 22;
  const prepared = entries.map((e) => {
    if (!e || typeof e.name !== 'string' || !e.name || !(e.data instanceof Uint8Array)) throw new Error('voce dello zip non valida');
    if (seen.has(e.name)) throw new Error('nome duplicato nello zip: ' + e.name);
    seen.add(e.name);
    const name = enc.encode(e.name);
    if (name.length > 65535) throw new Error('nome troppo lungo');
    total += 30 + name.length + e.data.length + 46 + name.length;
    return {name, data: e.data};
  });
  if (total > 0xFFFFFFFF) throw new Error('zip troppo grande (oltre 4 GB)');
  for (const e of prepared) e.crc = crc32(e.data);        // dopo i controlli: un elenco non valido non costa il calcolo dei CRC
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offs = [];
  for (const e of prepared) {
    offs.push(p);
    dv.setUint32(p, 0x04034B50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 0x0800, true); dv.setUint16(p + 8, 0, true);
    dv.setUint16(p + 10, time, true); dv.setUint16(p + 12, ddate, true); dv.setUint32(p + 14, e.crc, true);
    dv.setUint32(p + 18, e.data.length, true); dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, e.name.length, true); dv.setUint16(p + 28, 0, true);
    p += 30;
    out.set(e.name, p); p += e.name.length;
    out.set(e.data, p); p += e.data.length;
  }
  const cdStart = p;
  prepared.forEach((e, i) => {
    dv.setUint32(p, 0x02014B50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 20, true); dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, time, true); dv.setUint16(p + 14, ddate, true); dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true); dv.setUint32(p + 24, e.data.length, true); dv.setUint16(p + 28, e.name.length, true);
    dv.setUint16(p + 30, 0, true); dv.setUint16(p + 32, 0, true); dv.setUint16(p + 34, 0, true); dv.setUint16(p + 36, 0, true);
    dv.setUint32(p + 38, 0, true); dv.setUint32(p + 42, offs[i], true);
    p += 46;
    out.set(e.name, p); p += e.name.length;
  });
  const cdSize = p - cdStart;
  dv.setUint32(p, 0x06054B50, true); dv.setUint16(p + 4, 0, true); dv.setUint16(p + 6, 0, true);
  dv.setUint16(p + 8, prepared.length, true); dv.setUint16(p + 10, prepared.length, true);
  dv.setUint32(p + 12, cdSize, true); dv.setUint32(p + 16, cdStart, true); dv.setUint16(p + 20, 0, true);
  p += 22;
  if (p !== total) throw new Error('errore interno nella scrittura dello zip');
  return out;
}

module.exports = {zipStore};
