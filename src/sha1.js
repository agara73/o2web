'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// sha1.js - SHA-1 in JavaScript puro e sincrono. NON serve alla sicurezza: serve solo a riconoscere un dump con le impronte
// SHA-1 delle liste pubbliche di cartucce (gamedb.js), che usano questa impronta. Codice originale, scritto dalla specifica FIPS 180-4.

// bytes: Uint8Array -> stringa esadecimale di 40 caratteri
function sha1(bytes) {
  const n = bytes.length;
  const total = ((n + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[n] = 0x80;
  const bits = n * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000), false);
  dv.setUint32(total - 4, bits >>> 0, false);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + 4 * i, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  let out = '';
  for (const h of [h0, h1, h2, h3, h4]) out += (h >>> 0).toString(16).padStart(8, '0');
  return out;
}

module.exports = {sha1};
