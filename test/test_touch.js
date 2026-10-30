'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_touch.js VEC.json - joystick a tocco (src/touch.js, tappa 8): direzioni e sequenze di eventi delle dita contro il riferimento
// indipendente hw/touch_ref.py (vettori di test/touch_vectors.py), piu' prove puntuali (valori non validi, modi, secondo dito sulla
// direzione, piu' dita sul fuoco, bit uguali a quelli di input.js).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const T = require(SP('touch.js'));
const I = require(SP('input.js'));

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL  ' + msg); } };

// ---- contro il riferimento Python
const vecFile = process.argv[2];
if (!vecFile) { console.log('uso: node test/test_touch.js VEC.json (da test/touch_vectors.py)'); process.exit(2); }
const vec = JSON.parse(fs.readFileSync(vecFile, 'utf8'));
ok(vec.deadzone === T.DEADZONE, 'zona morta predefinita uguale al riferimento (' + vec.deadzone + ')');
ok(vec.dirs.length > 3000 && vec.seqs.length === 200, 'vettori presenti: ' + vec.dirs.length + ' direzioni, ' + vec.seqs.length + ' sequenze');
{
  let bad = 0, first = '';
  const labels = new Set();
  for (const d of vec.dirs) {
    labels.add(d.label.replace(/[-+0-9.]+$/, ''));
    const got = T.dirBits(d.dx, d.dy, d.r, d.dz);
    if (got !== d.bits) { bad++; if (!first) first = d.label + ' (' + d.dx + ', ' + d.dy + ', r ' + d.r + ', zm ' + d.dz + '): ' + got + ' invece di ' + d.bits; }
  }
  ok(bad === 0, 'dirBits uguale al riferimento su ' + vec.dirs.length + ' casi (' + bad + ' diversi) ' + first);
  ok(['caso', 'confine', 'asse', 'zona', 'centro', 'intero'].every((l) => labels.has(l)), 'vettori: ci sono tutte le famiglie di casi (' + [...labels].join(', ') + ')');
  const seen = new Set(vec.dirs.map((d) => d.bits));
  ok([0, 1, 2, 4, 8, 3, 6, 12, 9].every((b) => seen.has(b)) && seen.size === 9, 'vettori: compaiono il centro, le quattro direzioni e le quattro diagonali, e nient\'altro');
}
{
  let bad = 0, first = '';
  const modes = new Set();
  let withFire = 0, withDir = 0;
  for (let s = 0; s < vec.seqs.length; s++) {
    const q = vec.seqs[s];
    modes.add(q.mode);
    const p = new T.TouchPad(q.mode);
    p.setGeometry(q.geom[0], q.geom[1], q.geom[2]);
    for (let i = 0; i < q.events.length; i++) {
      const [op, id, x, y] = q.events[i];
      if (op === 'dir') p.dirDown(id, x, y);
      else if (op === 'fire') p.fireDown(id);
      else if (op === 'move') p.move(id, x, y);
      else if (op === 'up') p.up(id);
      else if (op === 'reset') p.reset();
      const got = p.bits();
      if (got & T.FIRE) withFire++;
      if (got & 0x0F) withDir++;
      if (got !== q.bits[i]) { bad++; if (!first) first = 'sequenza ' + s + ' (' + q.mode + '), evento ' + i + ' ' + op + ' ' + id + ': ' + got + ' invece di ' + q.bits[i]; break; }
    }
  }
  ok(bad === 0, 'TouchPad uguale al riferimento su ' + vec.seqs.length + ' sequenze di eventi (' + bad + ' diverse) ' + first);
  ok(modes.has('cross') && modes.has('float'), 'sequenze in tutti e due i modi');
  ok(withFire > 100 && withDir > 100, 'sequenze con fuoco (' + withFire + ') e con direzione (' + withDir + ')');
}

// ---- prove puntuali
{
  const J = I.JOY_BITS;
  ok(T.UP === J.up && T.RIGHT === J.right && T.DOWN === J.down && T.LEFT === J.left && T.FIRE === J.fire, 'bit uguali a quelli di input.js');
  ok(T.dirBits(0, -50, 64) === T.UP && T.dirBits(50, 0, 64) === T.RIGHT && T.dirBits(0, 50, 64) === T.DOWN && T.dirBits(-50, 0, 64) === T.LEFT, 'quattro assi (y verso il basso: dy negativo = su)');
  ok(T.dirBits(40, -40, 64) === (T.UP | T.RIGHT) && T.dirBits(-40, 40, 64) === (T.DOWN | T.LEFT), 'diagonali');
  ok(T.dirBits(10, 10, 64) === 0 && T.dirBits(16, 0, 64) === 0 && T.dirBits(16.01, 0, 64) === T.RIGHT, 'zona morta del 25%: 16 pixel su 64 ancora fermi, appena oltre si muove');
  ok(T.dirBits(500, 1, 64) === T.RIGHT, 'oltre il raggio la direzione resta');
  ok(T.dirBits(16, 0, 64, 0.5) === 0 && T.dirBits(33, 0, 64, 0.5) === T.RIGHT && T.dirBits(1, 0, 64, 0) === T.RIGHT, 'zona morta indicata a mano (0,5 e 0)');
  ok(T.dirBits(0, 0, 64, 0) === 0, 'centro esatto senza zona morta: fermo');
  // confine esatto fra asse e diagonale (tan 22,5 = radice di 2 - 1): vale l'asse
  const t = Math.SQRT2 - 1;
  ok(T.dirBits(1, -t, 1) === T.RIGHT && T.dirBits(-1, t, 1) === T.LEFT, 'confine esatto vicino all\'orizzontale: vale l\'asse orizzontale');
  ok(T.dirBits(t, -1, 1) === T.UP && T.dirBits(-t, 1, 1) === T.DOWN, 'confine esatto vicino alla verticale: vale l\'asse verticale');
  ok(T.dirBits(16, 0, 64, 0.25) === 0, 'bordo esatto della zona morta: ancora fermo');
  ok(T.dirBits(40, 0, 64, -0.1) === 0 && T.dirBits(40, 0, 64, Infinity) === 0, 'zona morta poco negativa o infinita: nessuna direzione');
  for (const [a, b, r, dz, what] of [[NaN, 0, 64, undefined, 'dx NaN'], [0, Infinity, 64, undefined, 'dy infinito'], [10, 10, 0, undefined, 'raggio 0'],
    [10, 10, -5, undefined, 'raggio negativo'], [10, 10, NaN, undefined, 'raggio NaN'], [10, 10, Infinity, undefined, 'raggio infinito'],
    [40, 0, 64, -1, 'zona morta negativa'], [40, 0, 64, NaN, 'zona morta NaN'], ['40', 0, 64, undefined, 'stringa']]) {
    ok(T.dirBits(a, b, r, dz) === 0, 'valore non valido (' + what + '): nessuna direzione');
  }
  ok(T.MODES.length === 2 && new T.TouchPad().mode === 'cross' && new T.TouchPad('float').mode === 'float' && new T.TouchPad('boh').mode === 'cross', 'modo predefinito croce; valori strani -> croce');
}
{
  // croce: centro fisso, secondo dito ignorato, rilascio
  const p = new T.TouchPad('cross');
  p.setGeometry(100, 200, 64);
  ok(p.bits() === 0, 'all\'inizio nessun bit');
  p.dirDown(1, 100, 150);
  ok(p.bits() === T.UP, 'croce: dito sopra il centro = su');
  p.dirDown(2, 160, 200);
  ok(p.bits() === T.UP, 'croce: un secondo dito sulla direzione si ignora');
  p.move(2, 160, 260);
  ok(p.bits() === T.UP, 'croce: lo spostamento del dito ignorato non conta');
  p.move(1, 150, 250);
  ok(p.bits() === (T.DOWN | T.RIGHT), 'croce: il dito scivola sulla diagonale giu\'-destra');
  p.fireDown(3);
  ok(p.bits() === (T.DOWN | T.RIGHT | T.FIRE), 'direzione e fuoco insieme');
  p.up(1);
  ok(p.bits() === T.FIRE, 'rilascio della direzione: resta il fuoco');
  p.dirDown(2, 40, 200);
  ok(p.bits() === (T.LEFT | T.FIRE), 'dopo il rilascio un altro dito puo\' guidare la direzione');
  p.up(3);
  ok(p.bits() === T.LEFT, 'rilascio del fuoco');
  p.up(99);
  ok(p.bits() === T.LEFT, 'rilascio di un dito sconosciuto: niente cambia');
  p.setGeometry(40, 200, 64);
  ok(p.bits() === T.LEFT, 'il centro si fissa all\'appoggio: spostare la croce non cambia il dito gia\' giu\'');
  p.reset();
  ok(p.bits() === 0 && p.dir === null && p.fires.size === 0, 'reset: tutto rilasciato');
  p.setGeometry(NaN, undefined, -3);
  ok(p.cx === 40 && p.cy === 200 && p.radius === 64, 'setGeometry: valori non validi ignorati');
  p.setGeometry(40, 200, 0);
  ok(p.radius === 64, 'setGeometry: raggio 0 ignorato');
  p.setGeometry(40, 200, 0.5);
  ok(p.radius === 0.5, 'setGeometry: raggio fra 0 e 1 accettato');
  p.setGeometry(40, 200, Infinity);
  ok(p.radius === 0.5, 'setGeometry: raggio infinito ignorato');
  p.dirDown(5, NaN, 10);
  ok(p.dir === null, 'dirDown con coordinate non valide: ignorato');
  let threw = false;
  try { p.move(5, 10, 10); } catch (e) { threw = true; }
  ok(!threw && p.dir === null, 'move senza nessun dito sulla direzione: ignorato, nessun errore');
  p.setGeometry(40, 200, 64);
  p.dirDown(6, 40, 150);
  p.move(6, NaN, 260); ok(p.dir.x === 40 && p.dir.y === 150 && p.bits() === T.UP, 'move con x non valida: ignorato');
  p.move(6, 40, NaN); ok(p.dir.x === 40 && p.dir.y === 150 && p.bits() === T.UP, 'move con y non valida: ignorato');
  p.move(9, 40, 260); ok(p.bits() === T.UP, 'move di un altro dito: ignorato');
}
{
  // valori iniziali, senza setGeometry: centro (0, 0) e raggio 1
  const p = new T.TouchPad('cross');
  ok(p.cx === 0 && p.cy === 0 && p.radius === 1, 'valori iniziali: centro (0, 0), raggio 1');
  p.dirDown(1, 0, -0.3);
  ok(p.bits() === T.UP, 'valori iniziali: 0,3 sopra il centro con raggio 1 (zona morta 0,25) = su');
  p.up(1); p.dirDown(2, 0.3, 0);
  ok(p.bits() === T.RIGHT, 'valori iniziali: 0,3 a destra del centro = destra');
}
{
  // piu' dita sul fuoco; lo stesso dito non si appoggia due volte
  const p = new T.TouchPad();
  p.fireDown(1); p.fireDown(2);
  ok(p.bits() === T.FIRE, 'due dita sul fuoco');
  p.up(1);
  ok(p.bits() === T.FIRE, 'una alzata: il fuoco resta premuto');
  p.up(2);
  ok(p.bits() === 0, 'tutte alzate: fuoco rilasciato');
  p.setGeometry(0, 0, 64);
  p.fireDown(7); p.dirDown(7, 0, -50);
  ok(p.bits() === T.FIRE && p.dir === null, 'un dito gia\' sul fuoco non diventa anche direzione');
  p.up(7); p.dirDown(8, 0, -50); p.fireDown(8);
  ok(p.bits() === T.UP && p.fires.size === 0, 'un dito gia\' sulla direzione non diventa anche fuoco');
}
{
  // segue il dito: il centro e' il punto d'appoggio; cambio di modo = tutto rilasciato
  const p = new T.TouchPad('float');
  p.setGeometry(0, 0, 50);
  p.dirDown(1, 300, 400);
  ok(p.bits() === 0, 'segue il dito: appena appoggiato e\' al centro (fermo)');
  p.move(1, 300, 330);
  ok(p.bits() === T.UP, 'segue il dito: trascinato in su');
  p.move(1, 230, 400);
  ok(p.bits() === T.LEFT, 'segue il dito: trascinato a sinistra');
  p.setMode('cross');
  ok(p.mode === 'cross' && p.bits() === 0 && p.dir === null, 'setMode: cambia modo e rilascia tutto');
  p.setMode('xyz');
  ok(p.mode === 'cross', 'setMode con un valore strano: croce');
}

if (fails) { console.log('FALLITI ' + fails + ' controlli (' + passes + ' ok)'); process.exit(1); }
console.log('OK: ' + passes + ' controlli sul joystick a tocco');
