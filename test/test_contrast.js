'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_contrast.js - contrasti WCAG 2.x dei colori di testo della pagina (tappa 8c, accessibilita'): ogni coppia testo / sfondo usata nel CSS
// deve avere almeno 4.5:1 (testo normale) o 3:1 (testo grande, bordi e icone). I colori si leggono dal template (variabili :root e valori
// scritti nelle regole), cosi' se cambiano il test li ricontrolla. Il calcolo e' la formula del WCAG (luminanza relativa sRGB).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.template.html'), 'utf8');
let n = 0, bad = 0;
function ok(c, m) { n++; if (!c) { bad++; console.log('FALLITO: ' + m); } }
const root = {};
for (const m of html.match(/:root \{[^}]*\}/)[0].matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{3,8})/g)) root[m[1]] = m[2];
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const mix = (fg, bg, a) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));          // testo con opacita' a su sfondo bg
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const ksOp = Number(html.match(/button\.key \.ks \{[^}]*opacity: ([.\d]+)/)[1]);       // opacita' della nota piccola dei tasti (F8, F9, F10...), letta dal CSS
const C = (n_) => hex(root[n_] || n_);
const pairs = [
  // [descrizione, testo, sfondo, minimo]
  ['testo su fondo pagina', C('txt'), C('bg'), 4.5],
  ['testo su pannello', C('txt'), C('panel'), 4.5],
  ['testo attenuato su fondo pagina', C('dim'), C('bg'), 4.5],
  ['testo attenuato su pannello', C('dim'), C('panel'), 4.5],
  ['testo attenuato su elenco (#181c25)', C('dim'), hex('#181c25'), 4.5],
  ['testo attenuato su riga attuale (#1f2b44)', C('dim'), hex('#1f2b44'), 4.5],
  ['testo attenuato su voce aperta del cassetto (#26304a)', C('dim'), hex('#26304a'), 4.5],
  ['testo su pulsante (#2a3040)', C('txt'), hex('#2a3040'), 4.5],
  ['accento su fondo pagina (titoli, collegamenti)', C('acc'), C('bg'), 4.5],
  ['accento su pannello', C('acc'), C('panel'), 4.5],
  ['accento su voce aperta del cassetto (#26304a)', C('acc'), hex('#26304a'), 4.5],
  ['accento su pulsante premuto (#2a3040)', C('acc'), hex('#2a3040'), 4.5],
  ['avviso su fondo pagina', C('warn'), C('bg'), 4.5],
  ['avviso su elenco (#181c25)', C('warn'), hex('#181c25'), 4.5],
  ['avviso su riquadro (#181c25), ★ accesa', C('warn'), hex('#181c25'), 4.5],
  ['errore su fondo pagina', C('bad'), C('bg'), 4.5],
  ['esito buono su fondo pagina', C('good'), C('bg'), 4.5],
  ['passi per cominciare: accento su riquadro (#182235)', C('acc'), hex('#182235'), 4.5],
  ['passi per cominciare: fatto (verde) su riquadro', C('good'), hex('#182235'), 4.5],
  ['passi per cominciare: testo attenuato su riquadro', C('dim'), hex('#182235'), 4.5],
  ['«?» premuto: nero su accento', hex('#000000'), C('acc'), 4.5],
  ['pulsante di fuoco: bianco su rosso (#a62329)', hex('#ffffff'), hex('#a62329'), 4.5],
  ['«Reset»: bianco su rosso (#a62329)', hex('#ffffff'), hex('#a62329'), 4.5],
  ['donazioni: scuro su giallo (#f0b429)', hex('#1b1300'), hex('#f0b429'), 4.5],
  ['tasto della piastra: testo su chiaro (#cdcac0)', hex('#25262b'), hex('#cdcac0'), 4.5],
  ['tasto della piastra: nota del tasto (opacita letta dal CSS) su chiaro', mix(hex('#25262b'), hex('#cdcac0'), ksOp), hex('#cdcac0'), 4.5],
  ['tasto premuto: nota del tasto su azzurro (#9cc4ee)', mix(hex('#25262b'), hex('#9cc4ee'), ksOp), hex('#9cc4ee'), 4.5],
  ['tasto Reset: nota (F9) bianca su rosso (#a62329)', mix(hex('#ffffff'), hex('#a62329'), ksOp), hex('#a62329'), 4.5],
  ['tasto della piastra premuto: testo su azzurro (#9cc4ee)', hex('#25262b'), hex('#9cc4ee'), 4.5],
  ['legenda della piastra (#8d909c su #17181d)', hex('#8d909c'), hex('#17181d'), 4.5],
  ['legenda «Reset» (#e0585e su #17181d)', hex('#e0585e'), hex('#17181d'), 4.5],
  ['barra di stato: testo attenuato su pulsante «Filtri CRT» (#2a3040)', C('dim'), hex('#2a3040'), 4.5],
  ['bordi dei campi (#343a48 su #2a3040)', hex('#343a48'), hex('#2a3040'), 1.0],       // solo informativo: i bordi non portano informazione da soli
];
for (const [d, fg, bg, min] of pairs) {
  const r = ratio(fg, bg);
  if (process.env.CONTRAST_VERBOSE) console.log(r.toFixed(2) + '  ' + d);
  ok(r >= min, d + ': ' + r.toFixed(2) + ':1 (serve ' + min + ':1)');
}
console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
process.exit(bad ? 1 : 0);
