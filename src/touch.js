'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// touch.js - joystick a tocco per telefoni e tablet (tappa 8): dalla posizione delle dita ai bit del joystick della console (su 1,
// destra 2, giu' 4, sinistra 8, fuoco 16, come in input.js). Solo logica pura (nessun DOM): la pagina (ui.js) gli passa numeri gia'
// ridotti (identificativo del dito, coordinate in pixel con la y verso il basso), cosi' tutto si prova in Node (test/test_touch.js)
// contro un riferimento scritto a parte in Python (hw/touch_ref.py, con un metodo diverso: l'angolo invece delle pendenze).
//
// Due modi: 'cross' (croce fissa: il centro e' quello del disegno, dato con setGeometry) e 'float' (segue il dito: il centro e' dove il
// dito si appoggia). Otto settori da 45 gradi centrati sugli assi (sul confine esatto fra un asse e una diagonale vale l'asse);
// dentro la zona morta (una frazione del raggio, bordo compreso) nessuna direzione;
// oltre il raggio la direzione resta (il dito puo' uscire dal disegno senza perdere il comando). Un solo dito guida la direzione (gli
// altri appoggiati sulla zona della direzione si ignorano); il fuoco e' premuto finche' almeno un dito sta sul tasto.

const UP = 0x01, RIGHT = 0x02, DOWN = 0x04, LEFT = 0x08, FIRE = 0x10;
const DEADZONE = 0.25;
const TAN_22_5 = Math.SQRT2 - 1;       // tan(22,5 gradi): confine fra un asse e una diagonale
const MODES = ['cross', 'float'];

// bit della direzione per lo spostamento (dx, dy) dal centro (y verso il basso), con raggio e zona morta (frazione del raggio)
function dirBits(dx, dy, radius, deadzone) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(radius > 0) || !Number.isFinite(radius)) return 0;
  const dz = deadzone === undefined ? DEADZONE : deadzone;
  if (!(dz >= 0) || !Number.isFinite(dz)) return 0;
  const lim = dz * radius;
  if (dx * dx + dy * dy <= lim * lim) return 0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let bits = 0;
  if (ay > ax * TAN_22_5) bits |= dy < 0 ? UP : DOWN;          // oltre 22,5 gradi dall'orizzontale conta la componente verticale
  if (ax > ay * TAN_22_5) bits |= dx < 0 ? LEFT : RIGHT;       // oltre 22,5 gradi dalla verticale conta quella orizzontale
  return bits;
}

class TouchPad {
  constructor(mode) {
    this.mode = MODES.includes(mode) ? mode : 'cross';
    this.cx = 0; this.cy = 0; this.radius = 1;
    this.dir = null;                   // dito della direzione: {id, cx, cy, x, y} (centro fissato quando il dito si appoggia)
    this.fires = new Set();            // dita sul tasto di fuoco
  }

  setMode(mode) {
    this.mode = MODES.includes(mode) ? mode : 'cross';
    this.reset();
  }

  // centro e raggio della croce in pixel (per 'float' conta solo il raggio)
  setGeometry(cx, cy, radius) {
    if (Number.isFinite(cx)) this.cx = cx;
    if (Number.isFinite(cy)) this.cy = cy;
    if (radius > 0 && Number.isFinite(radius)) this.radius = radius;
  }

  isDown(id) { return (this.dir !== null && this.dir.id === id) || this.fires.has(id); }

  dirDown(id, x, y) {
    if (this.dir !== null || this.isDown(id) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const cx = this.mode === 'float' ? x : this.cx;
    const cy = this.mode === 'float' ? y : this.cy;
    this.dir = {id, cx, cy, x, y};
  }

  fireDown(id) {
    if (this.isDown(id)) return;
    this.fires.add(id);
  }

  move(id, x, y) {
    if (this.dir === null || this.dir.id !== id || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.dir.x = x;
    this.dir.y = y;
  }

  up(id) {
    if (this.dir !== null && this.dir.id === id) this.dir = null;
    this.fires.delete(id);
  }

  reset() {
    this.dir = null;
    this.fires.clear();
  }

  bits() {
    let b = this.fires.size ? FIRE : 0;
    if (this.dir !== null) b |= dirBits(this.dir.x - this.dir.cx, this.dir.y - this.dir.cy, this.radius);
    return b;
  }
}

module.exports = {UP, RIGHT, DOWN, LEFT, FIRE, DEADZONE, MODES, dirBits, TouchPad};
