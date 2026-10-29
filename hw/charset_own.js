// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per ZX Spectrum: set di caratteri ORIGINALE di ripiego (512 byte)
// Glifi disegnati da zero (cifre, lettere, qualche simbolo e forme geometriche); non derivano da nessun set esistente.
// Serve quando l'utente non porta il suo `charset_i8244.bin`: il testo e' leggibile ma non identico a quello della macchina vera.
// Ordine delle 64 celle da 8 byte (bit 7 = pixel a sinistra), come nelle fonti di O2EM (da verificare sulla macchina vera):
//   0-9 cifre, 10 ':', 11 omino, 12 spazio, 13 '?', 14 L, 15 P, 16 '+', 17 W, 18 E, 19 R, 20 T, 21 U, 22 I, 23 O,
//   24 Q, 25 S, 26 D, 27 F, 28 G, 29 H, 30 J, 31 K, 32 A, 33 Z, 34 X, 35 C, 36 V, 37 B, 38 M, 39 '.', 40 '-', 41 '*',
//   42 '%'-like (divisione), 43 '=', 44 Y, 45 N, 46 '/', 47 blocco pieno, 48-63 forme geometriche.
// Uso:  node charset_own.js [OUT.bin]   oppure   require('./charset_own.js').build()  -> Uint8Array di 512 byte
'use strict';
const G = {
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.', '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####', '3': '.###. #...# ....# ..##. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.', '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.', '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.', '9': '.###. #...# #...# .#### ....# ...#. .##..',
  A: '.###. #...# #...# ##### #...# #...# #...#', B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.', D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####', F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .###.', H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.', J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#', L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#', N: '#...# ##..# #.#.# #..## #...# #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.', P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#', R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.', T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.', V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...#', X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..', Z: '##### ....# ...#. ..#.. .#... #.... #####',
  ':': '..... ..#.. ..#.. ..... ..#.. ..#.. .....', '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....', '-': '..... ..... ..... ##### ..... ..... .....',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....', '%': '..#.. ..... ##### ..... ##### ..... ..#..',
  '=': '..... ..... ##### ..... ##### ..... .....', '/': '....# ...#. ...#. ..#.. .#... .#... #....',
  '.': '..... ..... ..... ..... ..... .##.. .##..', ' ': '..... ..... ..... ..... ..... ..... .....',
  '#': '##### ##### ##### ##### ##### ##### #####',
  '@': '.##.. .##.. .##.. ####. .##.. .#.#. #...#',            // omino
};
const ORDER = '0123456789:@ ?LP+WERTUIOQSDFGHJKAZXCVBM.-*%=YN/#';   // celle 0-47

function shape(i, y, x) {                                       // forme geometriche 8x8 (celle 48-63), x e y da 0 a 7
  const dx = x - 3.5, dy = y - 3.5, d = Math.hypot(dx, dy);
  switch (i) {
    case 0: return y === 0 || y === 7 || x === 0 || x === 7;      // riquadro
    case 1: return d <= 3.6;                                      // disco
    case 2: return Math.abs(dx) + Math.abs(dy) <= 3.6;            // rombo
    case 3: return Math.abs(dx) <= y * 0.5;                       // triangolo in su
    case 4: return Math.abs(dx) <= (7 - y) * 0.5;                 // triangolo in giu'
    case 5: return Math.abs(dy) <= x * 0.5;                       // triangolo a sinistra
    case 6: return Math.abs(dy) <= (7 - x) * 0.5;                 // triangolo a destra
    case 7: return (x + y) % 2 === 0;                             // scacchi
    case 8: return y % 2 === 0;                                   // righe orizzontali
    case 9: return x % 2 === 0;                                   // righe verticali
    case 10: return y < 4;
    case 11: return y >= 4;
    case 12: return x < 4;
    case 13: return x >= 4;
    case 14: return x === 3 || x === 4 || y === 3 || y === 4;     // croce
    default: return x >= 3 && x <= 4 && y >= 3 && y <= 4;         // punto centrale
  }
}

function build() {
  const out = new Uint8Array(512);
  for (let c = 0; c < 48; c++) {
    const rows = G[ORDER[c]].split(' ');
    for (let y = 0; y < 7; y++) {
      let b = 0;
      for (let x = 0; x < 5; x++) if (rows[y][x] === '#') b |= 0x80 >> (x + 1);   // 5 pixel, con un pixel di margine a sinistra
      out[c * 8 + y] = b;
    }
  }
  for (let c = 48; c < 64; c++) {
    for (let y = 0; y < 8; y++) {
      let b = 0;
      for (let x = 0; x < 8; x++) if (shape(c - 48, y, x)) b |= 0x80 >> x;
      out[c * 8 + y] = b;
    }
  }
  return out;
}

module.exports = {build, glyphs: G};
if (typeof require !== 'undefined' && require.main === module) {
  const f = process.argv[2] || 'charset_own.bin';
  require('fs').writeFileSync(f, build());
  console.log('scritto ' + f + ' (512 byte)');
}
