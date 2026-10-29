// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser: set di caratteri ORIGINALE (GPL) dell'EF9341 (2560 byte)
// 256 voci da 10 byte (fetta 0..9), bit 0 = pixel di sinistra (come nel disegno del datasheet Thomson e nel modello di O2web).
// Disegnato da zero: nessun glifo e' copiato dal datasheet, da MAME o da altri set. Dal datasheet (EF9340/EF9341, tabelle di pagina 26 e 27)
// si prende solo la DISPOSIZIONE FUNZIONALE, cioe' quale carattere sta a quale codice:
//   voci 0-127 (alfanumerico): 0x00-0x1F lettere accentate, frecce, frazioni e simboli; 0x20-0x7E come l'ASCII (cifre, maiuscole, minuscole,
//   punteggiatura); 0x60 linea orizzontale; 0x7B-0x7D barre verticali, 0x7E barra in alto, 0x7F riquadro pieno (le barre sono DA VERIFICARE:
//   il datasheet le mostra, qui sono interpretate);
//   voci 128-255 (semigrafico, voce = 128 + codice): i 6 bit bassi scelgono i blocchi 2 x 3 (bit 0 alto-sinistra, 1 alto-destra, 2 centro-
//   sinistra, 3 centro-destra, 4 basso-sinistra, 5 basso-destra; ricavato dalla tabella di pagina 27); i codici 0x40-0x7F sono mosaici
//   UNITI, i codici 0x00-0x3F mosaici SEPARATI (con un filo di spazio fra i blocchi).
// Il set vero dell'EF9341 (ANTIOPE) non e' nel progetto: questo e' un set libero, compatibile nella disposizione, da usare e da modificare
// con l'editor della pagina. Uso:  node charset9341_own.js [OUT.bin]   oppure   require('./charset9341_own.js').build() -> Uint8Array(2560)
'use strict';
const G = require('./charset_own.js').glyphs;

// glifi 5 x 7 (righe 1-7 della cella) senza modello in charset_own.js
const EXTRA = {
  ',': '..... ..... ..... ..... .##.. ..#.. .#...', ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..', '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
  "'": '..#.. ..#.. ..... ..... ..... ..... .....', '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...', '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...', '[': '.###. .#... .#... .#... .#... .#... .###.',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.', '_': '..... ..... ..... ..... ..... ..... #####',
  '&': '.##.. #..#. .##.. #.#.# #..#. #..#. .##.#', '$': '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '^': '..#.. .#.#. #...# ..... ..... ..... .....', '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  '\\': '#.... .#... .#... ..#.. ...#. ...#. ....#', '~': '..... .#... #.#.# ...#. ..... ..... .....',
  '`': '.#... ..#.. ..... ..... ..... ..... .....', '{': '..##. .#... .#... #.... .#... .#... ..##.',
  '}': '.##.. ...#. ...#. ....# ...#. ...#. .##..', '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  '#': '.#.#. ##### .#.#. .#.#. .#.#. ##### .#.#.',
};

// minuscole: 9 righe (righe 1-9 della cella): ascendenti in alto, altezza della x nelle righe 3-7, discendenti nelle righe 8-9
const LOW = {
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####', '.....', '.....'],
  b: ['#....', '#....', '#.##.', '##..#', '#...#', '##..#', '#.##.', '.....', '.....'],
  c: ['.....', '.....', '.###.', '#...#', '#....', '#...#', '.###.', '.....', '.....'],
  d: ['....#', '....#', '.##.#', '#..##', '#...#', '#..##', '.##.#', '.....', '.....'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.', '.....', '.....'],
  f: ['..##.', '.#...', '###..', '.#...', '.#...', '.#...', '.#...', '.....', '.....'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#', '.....', '.....'],
  i: ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.', '.....', '.....'],
  j: ['...#.', '.....', '..##.', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '.....', '.....'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.', '.....', '.....'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '.....', '.....'],
  n: ['.....', '.....', '#.##.', '##..#', '#...#', '#...#', '#...#', '.....', '.....'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....', '.....'],
  p: ['.....', '.....', '#.##.', '##..#', '#...#', '##..#', '#.##.', '#....', '#....'],
  q: ['.....', '.....', '.##.#', '#..##', '#...#', '#..##', '.##.#', '....#', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....', '.....', '.....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.', '.....', '.....'],
  t: ['.#...', '.#...', '###..', '.#...', '.#...', '.#..#', '..##.', '.....', '.....'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#', '.....', '.....'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..', '.....', '.....'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.', '.....', '.....'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....', '.....'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####', '.....', '.....'],
};

// segni sopra le lettere (2 righe) e simboli speciali a 9 righe (righe 1-9)
const MARK = {
  acute: ['...#.', '..#..'], grave: ['.#...', '..#..'], circ: ['..#..', '.#.#.'], diaer: ['.#.#.', '.....'],
};
const SPECIAL = {
  '¿': ['.....', '.....', '..#..', '.....', '..#..', '...#.', '..#..', '#...#', '.###.'],
  '£': ['.....', '..##.', '.#..#', '.#...', '####.', '.#...', '.#...', '#####', '.....'],
  '°': ['.##..', '#..#.', '#..#.', '.##..', '.....', '.....', '.....', '.....', '.....'],
  '±': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....', '#####', '.....'],
  '÷': ['.....', '.....', '..#..', '.....', '#####', '.....', '..#..', '.....', '.....'],
  '¼': ['.#...', '##...', '.#..#', '.#.#.', '..#.#', '.#.##', '#.###', '....#', '.....'],
  '½': ['.#...', '##...', '.#..#', '.#.#.', '..#..', '.#.##', '#...#', '...#.', '..###'],
  '¾': ['##...', '..#..', '##..#', '..#.#', '##.#.', '..#.#', '..#.#', '..###', '.....'],
  '<-': ['.....', '.....', '..#..', '.#...', '#####', '.#...', '..#..', '.....', '.....'],
  '^': ['.....', '..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '.....', '.....'],
  '->': ['.....', '.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....', '.....'],
  'v': ['.....', '..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..', '.....', '.....'],
  'Œ': ['.####', '#.#..', '#.#..', '#.###', '#.#..', '#.#..', '.####', '.....', '.....'],
  'œ': ['.....', '.....', '.#.#.', '#.#.#', '#.###', '#.#..', '.#.##', '.....', '.....'],
};

function g7(ch) {                                    // 7 righe di 5 pixel (righe 1-7 della cella) o null
  const g = EXTRA[ch] || G[ch];
  return g ? g.split(' ') : null;
}
function g9(ch) {                                    // 9 righe (righe 1-9 della cella)
  if (SPECIAL[ch]) return SPECIAL[ch];
  if (ch >= 'a' && ch <= 'z') return LOW[ch];
  const s = g7(ch);
  return s ? s.concat(['.....', '.....']) : null;
}
function put(out, code, rows9) {                     // rows9: 9 righe da riga 1 della cella; x = 0..4 -> bit 1..5
  for (let y = 0; y < 9; y++) {
    let b = 0;
    for (let x = 0; x < 5; x++) if (rows9[y][x] === '#') b |= 1 << (x + 1);
    out[code * 10 + 1 + y] = b;
  }
}
// lettera accentata: maiuscole con il segno nella riga 1 (la lettera scende di una riga), minuscole con il segno nelle righe 1-2;
// la cediglia occupa le righe 8-9
function accented(base, mark, cedilla) {
  const m = MARK[mark];
  let rows;
  if (base === base.toLowerCase()) {
    rows = g9(base).slice();
    if (m) { rows[0] = m[0]; rows[1] = m[1]; }
  } else if (m) {
    rows = ['.....'].concat(g9(base).slice(0, 7), ['.....']);
    rows[0] = m[0];
  } else {
    rows = g9(base).slice();
  }
  if (cedilla) { rows[7] = '..#..'; rows[8] = '.##..'; }
  return rows;
}

const ALPHA_LOW = {   // codici 0x00-0x1F: [carattere base, segno, cediglia] oppure un carattere speciale
  0x00: ['¿'], 0x01: ['A', 'grave'], 0x02: ['E', 'acute'], 0x03: ['£'], 0x04: ['$'], 0x05: ['C', null, true], 0x06: ['#'],
  0x07: ['A', 'circ'], 0x08: ['U', 'grave'], 0x09: ['E', 'grave'], 0x0A: ['Œ'], 0x0B: ['E', 'circ'],
  0x0C: ['<-'], 0x0D: ['^'], 0x0E: ['->'], 0x0F: ['v'],
  0x10: ['°'], 0x11: ['±'], 0x12: ['e', 'acute'], 0x13: ['e', 'diaer'], 0x14: ['i', 'diaer'], 0x15: ['c', null, true],
  0x16: ['u', 'grave'], 0x17: ['a', 'diaer'], 0x18: ['÷'], 0x19: ['e', 'grave'], 0x1A: ['œ'], 0x1B: ['e', 'circ'],
  0x1C: ['¼'], 0x1D: ['½'], 0x1E: ['¾'], 0x1F: ['o', 'circ'],
};

function bar(out, code, x0, x1, y0, y1) {            // riquadro pieno di pixel (bit 0 = sinistra)
  for (let y = y0; y <= y1; y++) { let b = 0; for (let x = x0; x <= x1; x++) b |= 1 << x; out[code * 10 + y] = b; }
}

function build() {
  const out = new Uint8Array(2560);
  for (let c = 0x20; c < 0x7F; c++) {
    const ch = String.fromCharCode(c);
    const rows = g9(ch);
    if (rows) put(out, c, rows);
  }
  for (const k of Object.keys(ALPHA_LOW)) {
    const [a, b, cedilla] = ALPHA_LOW[k];
    const code = +k;
    if (SPECIAL[a]) put(out, code, SPECIAL[a]);
    else put(out, code, accented(a, b, cedilla));
  }
  bar(out, 0x60, 0, 7, 4, 4);                         // linea orizzontale
  bar(out, 0x7B, 0, 0, 0, 9);                         // barre verticali: sinistra, centro, destra (DA VERIFICARE)
  bar(out, 0x7C, 3, 4, 0, 9);
  bar(out, 0x7D, 7, 7, 0, 9);
  bar(out, 0x7E, 0, 7, 0, 0);                         // barra in alto
  bar(out, 0x7F, 0, 7, 0, 9);                         // riquadro pieno
  // semigrafico: voce 128 + codice (6 bit bassi = blocchi). Uniti per i codici 0x40-0x7F, separati per 0x00-0x3F
  for (let code = 0; code < 128; code++) {
    const joined = code >= 0x40;
    for (let y = 0; y < 10; y++) {
      const band = y < 3 ? 0 : y < 7 ? 1 : 2;
      const lastRow = (band === 0 && y === 2) || (band === 1 && y === 6) || (band === 2 && y === 9);
      let b = 0;
      if (joined || !lastRow) {
        if ((code >> (2 * band)) & 1) b |= joined ? 0x0F : 0x07;
        if ((code >> (2 * band + 1)) & 1) b |= joined ? 0xF0 : 0x70;
      }
      out[(128 + code) * 10 + y] = b;
    }
  }
  return out;
}

module.exports = {build, glyphs: {low: LOW, special: SPECIAL, extra: EXTRA}};
if (require.main === module) {
  const fs = require('fs');
  const data = build();
  if (process.argv[2]) { fs.writeFileSync(process.argv[2], data); if (fs.statSync(process.argv[2]).size !== 2560) throw new Error('dimensione errata'); }
  else console.log('charset9341_own: ' + data.length + ' byte');
}
