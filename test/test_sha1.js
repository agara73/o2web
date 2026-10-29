'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_sha1.js - SHA-1 contro il riferimento indipendente (node:crypto): lunghezze di confine, contenuti casuali, vettori noti.
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const crypto = require('crypto');
const {sha1} = require(SP('sha1.js'));
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FALLITO: ' + m); } };
ok(sha1(new Uint8Array(0)) === 'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'vuoto');
ok(sha1(Uint8Array.from(Buffer.from('abc'))) === 'a9993e364706816aba3e25717850c26c9cd0d89d', 'abc');
ok(sha1(Uint8Array.from(Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))) === '84983e441c3bd26ebaae4aa1f95129e5e54670f1', 'vettore a due blocchi');
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 8;
for (let len = 0; len <= 200; len++) {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = rnd() & 255;
  ok(sha1(b) === crypto.createHash('sha1').update(b).digest('hex'), 'lunghezza ' + len);
}
for (const len of [2048, 4096, 8192, 12288, 16384, 32768]) {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = rnd() & 255;
  ok(sha1(b) === crypto.createHash('sha1').update(b).digest('hex'), 'dump da ' + len);
}
console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
process.exit(bad ? 1 : 0);
