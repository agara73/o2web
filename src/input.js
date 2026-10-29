'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// input.js - ingressi della console: tastiera del computer, joystick 1 e 2 (tasti configurabili), gamepad (Gamepad API), tastiera a
// schermo. Solo logica pura (nessun DOM): la pagina (ui.js) gli passa eventi gia' ridotti a oggetti semplici ({code, key, ctrlKey...}),
// cosi' tutto si prova in Node (test/test_input.js).
//
// Console: tastiera a matrice (riga r, colonna c) con codice 8r + c, che e' anche l'indice del carattere nel set del chip video (DA
// VERIFICARE su altri BIOS; vedi o2web-stato.md); joystick = 5 bit (su 1, destra 2, giu' 4, sinistra 8, fuoco 16) sul BUS.
//
// Joystick da tastiera: i tasti si riconoscono con e.code (il tasto FISICO, uguale in ogni disposizione di tastiera) e prevalgono sui
// tasti della console (che si riconoscono con e.key, cioe' dal carattere). Cosi' i numeri del tastierino numerico (code 'Numpad8'...)
// fanno da joystick 2 senza essere scambiati per i tasti 0-9 della console. Un portatile senza tastierino usa il preset 'portatile' o
// si configura i tasti a mano (nessuna memoria fra le sessioni: le impostazioni stanno nel file di sessione).

const ACTIONS = ['up', 'right', 'down', 'left', 'fire'];
const JOY_BITS = {up: 0x01, right: 0x02, down: 0x04, left: 0x08, fire: 0x10};

// ---- tastiera della console
const LAYOUT = '0123456789:\u0000 ?LP+WERTUIOQSDFGHJKAZXCVBM.-*/=YN';
const KEYCODE = {};
for (let i = 0; i < LAYOUT.length; i++) if (LAYOUT[i] !== '\u0000') KEYCODE[LAYOUT[i]] = i;
const CLR = 46, ENT = 47;
const KEY_ALIASES = {Enter: ENT, Escape: CLR, Backspace: CLR, Delete: CLR};

// indice del tasto della console per e.key (carattere o nome del tasto), -1 se non c'e'
function consoleKey(key) {
  if (typeof key !== 'string' || !key) return -1;
  if (KEY_ALIASES[key] !== undefined) return KEY_ALIASES[key];
  if (key.length !== 1) return -1;
  const k = key.toUpperCase();
  return KEYCODE[k] !== undefined ? KEYCODE[k] : -1;
}

// tastiera a schermo: righe di tasti (indice del tasto della console e etichetta)
const VKEYS = (function () {
  const row = (s) => Array.from(s).map((ch) => ({idx: KEYCODE[ch], label: ch}));
  return [row('1234567890'), row('QWERTYUIOP'), row('ASDFGHJKL'), row('ZXCVBNM'), row('+-*/=.?:'),
    [{idx: KEYCODE[' '], label: 'Spazio'}, {idx: CLR, label: 'CLR'}, {idx: ENT, label: 'ENT'}]];
})();

// ---- associazioni dei joystick
function cloneBindings(b) {
  const o = {};
  for (const p of ['1', '2']) {
    o[p] = {};
    for (const a of ACTIONS) o[p][a] = b[p][a].slice();
  }
  return o;
}

const PRESETS = {
  // joystick 1 con le frecce e Ctrl; joystick 2 con il tastierino numerico (8 su, 4 sinistra, 5 o 2 giu', 6 destra, 0 fuoco)
  tastierino: {
    1: {up: ['ArrowUp'], right: ['ArrowRight'], down: ['ArrowDown'], left: ['ArrowLeft'], fire: ['ControlLeft', 'ControlRight']},
    2: {up: ['Numpad8'], right: ['Numpad6'], down: ['Numpad5', 'Numpad2'], left: ['Numpad4'], fire: ['Numpad0']},
  },
  // per i portatili senza tastierino: joystick 2 sui tasti fisici I J K L e (fuoco) il tasto del punto e virgola; toglie quelle lettere
  // dalla tastiera della console
  portatile: {
    1: {up: ['ArrowUp'], right: ['ArrowRight'], down: ['ArrowDown'], left: ['ArrowLeft'], fire: ['ControlLeft', 'ControlRight']},
    2: {up: ['KeyI'], right: ['KeyL'], down: ['KeyK'], left: ['KeyJ'], fire: ['Semicolon']},
  },
};
function defaultBindings() { return cloneBindings(PRESETS.tastierino); }

// controlla che un oggetto sia un insieme di associazioni valido (lo si legge da un file di sessione: non ci si fida) e lo copia
function validateBindings(b) {
  if (!b || typeof b !== 'object') throw new Error('associazioni dei tasti non valide');
  const o = {}, seen = new Map();
  for (const p of ['1', '2']) {
    if (!b[p] || typeof b[p] !== 'object') throw new Error('associazioni dei tasti non valide: manca il joystick ' + p);
    o[p] = {};
    for (const a of ACTIONS) {
      const list = b[p][a];
      if (!Array.isArray(list) || list.length > 4) throw new Error('associazioni dei tasti non valide: ' + p + '/' + a);
      o[p][a] = list.map((c) => {
        if (typeof c !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(c)) throw new Error('codice di tasto non valido: ' + String(c).slice(0, 30));
        if (seen.has(c)) throw new Error('il tasto ' + c + ' e’ associato a due azioni');
        seen.set(c, 1);
        return c;
      });
    }
  }
  return o;
}

// associa il tasto fisico 'code' all'azione (player '1' o '2'): sostituisce i tasti di quell'azione e toglie 'code' da ogni altra.
// Ritorna {bindings, stolen: [{player, action}]} (nessuna modifica all'originale).
function rebind(bindings, player, action, code) {
  if (!['1', '2'].includes(String(player)) || !ACTIONS.includes(action)) throw new Error('azione non valida');
  if (typeof code !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(code)) throw new Error('tasto non valido');
  const b = cloneBindings(bindings), stolen = [];
  for (const p of ['1', '2']) {
    for (const a of ACTIONS) {
      if (p === String(player) && a === action) continue;
      const i = b[p][a].indexOf(code);
      if (i >= 0) { b[p][a].splice(i, 1); stolen.push({player: p, action: a}); }
    }
  }
  b[String(player)][action] = [code];
  return {bindings: b, stolen};
}

// nomi leggibili dei tasti fisici (italiano)
const CODE_NAMES = {ArrowUp: 'Freccia su', ArrowDown: 'Freccia giù', ArrowLeft: 'Freccia sinistra', ArrowRight: 'Freccia destra',
  ControlLeft: 'Ctrl sinistro', ControlRight: 'Ctrl destro', ShiftLeft: 'Maiusc sinistro', ShiftRight: 'Maiusc destro', Space: 'Spazio',
  Enter: 'Invio', NumpadEnter: 'Invio (tastierino)', Semicolon: 'Punto e virgola', Comma: 'Virgola', Period: 'Punto', Slash: 'Barra',
  Backslash: 'Barra inversa', Quote: 'Apice', BracketLeft: 'Parentesi quadra sinistra', BracketRight: 'Parentesi quadra destra', Minus: 'Meno',
  Equal: 'Uguale', Tab: 'Tab', Backquote: 'Apice inverso', IntlBackslash: '<'};
function codeLabel(code) {
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  let m = /^Numpad(\w+)$/.exec(code);
  if (m) {
    const ops = {Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: ',', Enter: 'Invio'};
    return 'Tastierino ' + (ops[m[1]] || m[1]);
  }
  m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(code);
  if (m) return 'F' + m[1];
  return code;
}

// ---- gamepad
const PAD_DEADZONE = 0.5;
// bit del joystick da un gamepad (oggetto della Gamepad API: {connected, buttons: [{pressed, value}], axes: [..]}).
// Mappatura "standard": croce direzionale (pulsanti 12-15) e levetta sinistra (assi 0-1); fuoco = pulsanti 0-3 (A B X Y) e dorsali 4-7.
function padBits(pad, deadzone) {
  if (!pad || pad.connected === false) return 0;
  const dz = deadzone === undefined ? PAD_DEADZONE : deadzone;
  const b = pad.buttons || [], a = pad.axes || [];
  const on = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
  const x = typeof a[0] === 'number' ? a[0] : 0, y = typeof a[1] === 'number' ? a[1] : 0;
  let bits = 0;
  if (on(12) || y < -dz) bits |= JOY_BITS.up;
  if (on(13) || y > dz) bits |= JOY_BITS.down;
  if (on(14) || x < -dz) bits |= JOY_BITS.left;
  if (on(15) || x > dz) bits |= JOY_BITS.right;
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) if (on(i)) { bits |= JOY_BITS.fire; break; }
  return bits;
}
// tasti della console da un gamepad: Start (9) = ENT, Indietro (8) = CLR (basta un tasto per uscire dal menu del BIOS)
function padConsoleKeys(pad) {
  if (!pad || pad.connected === false) return [];
  const b = pad.buttons || [], out = [];
  if (b[9] && (b[9].pressed || b[9].value > 0.5)) out.push(ENT);
  if (b[8] && (b[8].pressed || b[8].value > 0.5)) out.push(CLR);
  return out;
}
// quale gamepad fa da joystick 1 e 2. pads: elenco (anche con buchi o null) come navigator.getGamepads(); prefs: {1, 2} = 'auto' |
// 'off' | indice (stringa o numero) del gamepad. In 'auto' si usano, nell'ordine, i gamepad collegati non scelti a mano.
function assignPads(pads, prefs) {
  const list = Array.from(pads || []);
  const conn = (p) => p && p.connected !== false;
  const taken = new Set(), res = {1: null, 2: null};
  for (const pl of ['1', '2']) {
    const pref = prefs && prefs[pl] !== undefined ? String(prefs[pl]) : 'auto';
    if (pref === 'off' || pref === 'auto') continue;
    const i = Number(pref);
    if (Number.isInteger(i) && conn(list[i]) && !taken.has(i)) { res[pl] = list[i]; taken.add(i); }
  }
  for (const pl of ['1', '2']) {
    const pref = prefs && prefs[pl] !== undefined ? String(prefs[pl]) : 'auto';
    if (pref !== 'auto') continue;
    for (let i = 0; i < list.length; i++) {
      if (conn(list[i]) && !taken.has(i)) { res[pl] = list[i]; taken.add(i); break; }
    }
  }
  return res;
}

// ---- stato degli ingressi
const CTRL_SAFE = /^(Arrow|Numpad|Control|Space|Shift)/;

class InputState {
  constructor(bindings) {
    this.setBindings(bindings || defaultBindings());
    this.down = new Map();            // tasto fisico (code) -> {kb, joy: [bit giocatore 1, bit giocatore 2]}
    this.virtual = new Set();         // indici dei tasti premuti sulla tastiera a schermo
    this.pad = [0, 0];                // bit dei due gamepad
    this.padKeys = new Set();         // tasti della console premuti dai gamepad
    this.swap = false;                // scambio dei comandi: i tasti e il gamepad del giocatore 1 muovono il joystick 2 e viceversa (giochi a turni giocati da soli)
  }

  setBindings(b) {
    this.bindings = validateBindings(b);
    this.map = new Map();             // code -> [giocatore (0|1), bit]
    for (let p = 0; p < 2; p++) {
      for (const a of ACTIONS) for (const c of this.bindings[String(p + 1)][a]) this.map.set(c, [p, JOY_BITS[a]]);
    }
    if (this.down) this.down.clear();
  }

  // ritorna true se la pagina deve chiamare preventDefault (il tasto e' degli ingressi della console)
  keyDown(e) {
    if (!e || typeof e.code !== 'string') return false;
    if (e.metaKey || e.altKey) return false;
    const j = this.map.get(e.code);
    let info = null;
    if (j) {
      if (e.ctrlKey && !CTRL_SAFE.test(e.code)) return false;       // Ctrl + lettera: e' un comando del browser
      const joy = [0, 0];
      joy[j[0]] = j[1];
      info = {kb: -1, joy};
    } else {
      if (e.ctrlKey) return false;
      const kb = consoleKey(e.key);
      if (kb < 0) return false;
      info = {kb, joy: [0, 0]};
    }
    this.down.set(e.code, info);
    return true;
  }

  keyUp(e) {
    if (!e || !this.down.has(e.code)) return false;
    this.down.delete(e.code);
    return true;
  }

  // acceso: tutto cio' che e' del giocatore 1 (tasti, gamepad) va al joystick 2 e viceversa; vale subito, anche per i tasti gia' premuti. La tastiera della console non cambia.
  setSwap(on) { this.swap = !!on; }

  releaseAll() { this.down.clear(); this.virtual.clear(); this.pad = [0, 0]; this.padKeys.clear(); }

  setVirtual(idx, isDown) {
    if (!Number.isInteger(idx) || idx < 0 || idx > 47 || idx === 11) return;
    if (isDown) this.virtual.add(idx); else this.virtual.delete(idx);
  }

  // pads: {1: pad|null, 2: pad|null} (assignPads)
  setPads(pads) {
    this.pad = [padBits(pads[1]), padBits(pads[2])];
    this.padKeys = new Set([...padConsoleKeys(pads[1]), ...padConsoleKeys(pads[2])]);
  }

  // ingressi da dare alla console: {rows: Uint8Array(8) (tastiera a matrice), joy: [bit joystick 1, bit joystick 2]}
  snapshot() {
    const rows = new Uint8Array(8);
    const joy = [this.pad[0], this.pad[1]];
    const add = (kb) => { rows[kb >> 3] |= 1 << (kb & 7); };
    for (const v of this.down.values()) {
      if (v.kb >= 0) add(v.kb);
      joy[0] |= v.joy[0];
      joy[1] |= v.joy[1];
    }
    for (const k of this.virtual) add(k);
    for (const k of this.padKeys) add(k);
    if (this.swap) joy.reverse();
    return {rows, joy};
  }
}

module.exports = {ACTIONS, JOY_BITS, LAYOUT, KEYCODE, CLR, ENT, consoleKey, VKEYS, PRESETS, defaultBindings, validateBindings, rebind, cloneBindings,
  codeLabel, padBits, padConsoleKeys, assignPads, InputState, PAD_DEADZONE};
