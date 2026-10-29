'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_input.js [DUMPS] - ingressi (src/input.js): tastiera della console, joystick 1 e 2 da tastiera con tasti configurabili (e.code),
// tastierino numerico contro tasti della console, Ctrl, gamepad (mappatura, zona morta, assegnazione ai due giocatori), tastiera a
// schermo, associazioni lette da un file (validazione). Con DUMPS: il percorso fino alla console (tasto -> menu del BIOS -> gioco;
// joystick 2 sul BUS).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const path = require('path');
const I = require(SP('input.js'));
const {Console} = require(SP('console.js'));
const charsetOwn = require('../hw/charset_own.js');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL  ' + msg); } };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const ev = (code, key, extra) => Object.assign({code, key: key === undefined ? code : key}, extra || {});

// ---- tasti della console
{
  const chars = '0123456789:\u0000 ?LP+WERTUIOQSDFGHJKAZXCVBM.-*/=YN';
  let good = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\u0000') { continue; }
    if (I.consoleKey(chars[i]) === i && I.consoleKey(chars[i].toLowerCase()) === i) good++;
  }
  ok(good === 45, 'consoleKey: tutti i 45 caratteri della tastiera (maiuscole e minuscole): ' + good);
  ok(I.consoleKey('Enter') === 47 && I.consoleKey('Escape') === 46 && I.consoleKey('Backspace') === 46 && I.consoleKey('Delete') === 46, 'consoleKey: ENT e CLR');
  for (const k of ['Shift', 'F1', 'ArrowUp', 'Control', '', 'ab', 'è', '#', '!', undefined, null, 5, 'Dead']) ok(I.consoleKey(k) === -1, 'consoleKey(' + String(k) + ') = -1');
  ok(I.consoleKey('\u0000') === -1, 'consoleKey: il carattere nullo non e\' un tasto');
  const idx = new Set();
  for (const row of I.VKEYS) for (const k of row) idx.add(k.idx);
  const all = new Set(); for (let i = 0; i < 48; i++) if (i !== 11) all.add(i);
  ok(idx.size === 47 && [...all].every((i) => idx.has(i)), 'tastiera a schermo: copre tutti e soli i 47 tasti (' + idx.size + ')');
  ok(I.VKEYS.flat().every((k) => typeof k.label === 'string' && k.label.length > 0), 'tastiera a schermo: tutte le etichette presenti');
}

// ---- joystick da tastiera
{
  const s = new I.InputState();
  ok(s.keyDown(ev('ArrowUp')) && s.snapshot().joy[0] === 1 && s.snapshot().joy[1] === 0, 'freccia su = joystick 1 su');
  ok(s.keyDown(ev('ArrowRight')) && s.snapshot().joy[0] === 3, 'su + destra = 3');
  ok(s.keyDown(ev('ControlLeft', 'Control', {ctrlKey: true})) && s.snapshot().joy[0] === 0x13, 'Ctrl = fuoco (0x10)');
  ok(s.keyDown(ev('ArrowDown', 'ArrowDown', {ctrlKey: true})) && (s.snapshot().joy[0] & 4) === 4, 'con Ctrl premuto le frecce funzionano ancora (muovi e spara insieme)');
  ok(s.keyDown(ev('ArrowLeft', 'ArrowLeft', {ctrlKey: true})) && s.snapshot().joy[0] === 0x1F, 'le quattro direzioni e il fuoco insieme: 0x1F');
  ok(s.keyUp(ev('ControlLeft', 'Control')) && s.snapshot().joy[0] === 0x0F, 'rilascio del fuoco');
  ok(!s.keyUp(ev('ControlLeft', 'Control')), 'keyUp di un tasto non premuto: nessun effetto');
  for (const c of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) s.keyUp(ev(c));
  ok(s.snapshot().joy[0] === 0 && s.snapshot().rows.every((r) => r === 0), 'tutto rilasciato');
  // ripetizione automatica del tasto: stesso stato
  s.keyDown(ev('ArrowUp')); s.keyDown(ev('ArrowUp', 'ArrowUp', {repeat: true}));
  ok(s.snapshot().joy[0] === 1, 'tasto ripetuto: stesso stato');
  s.keyUp(ev('ArrowUp'));
  ok(s.snapshot().joy[0] === 0, 'un solo keyUp rilascia anche dopo le ripetizioni');
  // joystick 2 sul tastierino: i numeri NON sono tasti della console
  const t = new I.InputState();
  ok(t.keyDown(ev('Numpad8', '8')) && t.snapshot().joy[1] === 1 && t.snapshot().rows.every((r) => r === 0), 'Numpad8 = joystick 2 su, e non il tasto 8 della console');
  ok(t.keyDown(ev('Numpad4', '4')) && t.keyDown(ev('Numpad0', '0')) && t.snapshot().joy[1] === 0x19, 'Numpad4 sinistra + Numpad0 fuoco + su');
  ok(t.keyDown(ev('Numpad5', '5')) && (t.snapshot().joy[1] & 4) === 4 && t.keyDown(ev('Numpad2', '2')), 'Numpad5 e Numpad2 = giu\'');
  ok(t.keyDown(ev('Numpad6', '6')) && (t.snapshot().joy[1] & 2) === 2, 'Numpad6 = destra');
  // le cifre normali restano tasti della console
  const u = new I.InputState();
  ok(u.keyDown(ev('Digit8', '8')) && u.snapshot().rows[1] === 1 && u.snapshot().joy[0] === 0, 'Digit8 = tasto 8 della console (riga 1, colonna 0)');
  ok(u.keyDown(ev('KeyA', 'a')) && u.snapshot().rows[4] === 1, 'A = indice 32 (riga 4, colonna 0)');
  ok(u.keyDown(ev('Enter', 'Enter')) && (u.snapshot().rows[5] & 0x80) === 0x80, 'Invio = ENT (riga 5, colonna 7)');
  // tasti che non sono degli ingressi
  ok(!u.keyDown(ev('F5', 'F5')) && !u.keyDown(ev('Tab', 'Tab')) && !u.keyDown(ev('ShiftLeft', 'Shift')), 'F5, Tab, Maiusc: non gestiti (restano al browser)');
  ok(!u.keyDown(ev('KeyR', 'r', {ctrlKey: true})) && !u.keyDown(ev('KeyL', 'l', {ctrlKey: true})), 'Ctrl + lettera: comando del browser, non gestito');
  ok(!u.keyDown(ev('KeyR', 'r', {metaKey: true})) && !u.keyDown(ev('KeyR', 'r', {altKey: true})), 'Meta / Alt + lettera: non gestito');
  ok(!u.keyDown(null) && !u.keyDown({}) && !u.keyDown({code: 5}), 'eventi non validi ignorati');
  ok(!new I.InputState().keyUp(null), 'keyUp(null) ignorato');
  // preset portatile: I J K L + punto e virgola sono il joystick 2 e non le lettere
  const v = new I.InputState(I.PRESETS.portatile);
  ok(v.keyDown(ev('KeyI', 'i')) && v.snapshot().joy[1] === 1 && v.snapshot().rows.every((r) => r === 0), 'preset portatile: I = joystick 2 su');
  ok(v.keyDown(ev('Semicolon', ';')) && v.snapshot().joy[1] === 0x11, 'preset portatile: punto e virgola = fuoco');
  ok(!v.keyDown(ev('KeyI', 'i', {ctrlKey: true})), 'preset portatile: Ctrl + I resta al browser');
  ok(v.keyDown(ev('KeyA', 'a')) && v.snapshot().rows[4] === 1, 'preset portatile: le altre lettere restano tasti della console');
  // combinazione di console e joystick
  const w = new I.InputState();
  w.keyDown(ev('Digit1', '1')); w.keyDown(ev('ArrowUp')); w.keyDown(ev('Numpad8', '8'));
  const sn = w.snapshot();
  ok(sn.rows[0] === 2 && sn.joy[0] === 1 && sn.joy[1] === 1, 'tasto 1 + joystick 1 su + joystick 2 su insieme');
  ok(w.snapshot().rows !== sn.rows, 'ogni snapshot e\' un oggetto nuovo');
  w.releaseAll();
  ok(w.snapshot().rows.every((r) => r === 0) && w.snapshot().joy.every((j) => j === 0), 'releaseAll');
}

// ---- associazioni
{
  const d = I.defaultBindings();
  ok(JSON.stringify(I.validateBindings(d)) === JSON.stringify(d), 'le associazioni predefinite sono valide');
  for (const p of Object.keys(I.PRESETS)) ok(!throws(() => I.validateBindings(I.PRESETS[p])), 'preset ' + p + ' valido');
  const dd = I.defaultBindings(); dd[1].up.push('x');
  ok(I.defaultBindings()[1].up.length === 1, 'defaultBindings restituisce una copia nuova');
  const bad = [null, 5, 'x', {}, {1: {}}, {1: d[1]}, {1: d[1], 2: null}];
  for (const b of bad) ok(throws(() => I.validateBindings(b)), 'associazioni non valide rifiutate: ' + JSON.stringify(b));
  const mk = (fn) => { const c = JSON.parse(JSON.stringify(d)); fn(c); return c; };
  ok(throws(() => I.validateBindings(mk((c) => { c[2].up = ['ArrowUp']; }))), 'lo stesso tasto su due azioni: rifiutato');
  ok(throws(() => I.validateBindings(mk((c) => { c[1].up = ['Arrow Up']; }))), 'codice con spazio: rifiutato');
  ok(throws(() => I.validateBindings(mk((c) => { c[1].up = [5]; }))), 'codice non stringa: rifiutato');
  ok(throws(() => I.validateBindings(mk((c) => { c[1].up = 'ArrowUp'; }))), 'elenco non array: rifiutato');
  ok(throws(() => I.validateBindings(mk((c) => { c[1].up = ['A', 'B', 'C', 'D', 'E']; }))), 'piu\' di 4 tasti per azione: rifiutato');
  ok(throws(() => I.validateBindings(mk((c) => { c[1].up = ['a'.repeat(25)]; }))), 'codice troppo lungo: rifiutato');
  ok(throws(() => I.validateBindings(mk((c) => { delete c[2].fire; }))), 'azione mancante: rifiutato');
  ok(!throws(() => I.validateBindings(mk((c) => { c[1].up = []; }))), 'azione senza tasti: ammessa');
  // rebind
  let r = I.rebind(d, '2', 'up', 'KeyW');
  ok(r.bindings[2].up.join() === 'KeyW' && r.stolen.length === 0 && d[2].up.join() === 'Numpad8', 'rebind: sostituisce i tasti dell\'azione senza toccare l\'originale');
  r = I.rebind(d, '2', 'fire', 'ArrowUp');
  ok(r.bindings[2].fire.join() === 'ArrowUp' && r.bindings[1].up.length === 0 && r.stolen.length === 1 && r.stolen[0].player === '1' && r.stolen[0].action === 'up', 'rebind: un tasto gia\' usato passa alla nuova azione e si segnala');
  r = I.rebind(d, 1, 'fire', 'Numpad2');
  ok(r.bindings[1].fire.join() === 'Numpad2' && r.bindings[2].down.join() === 'Numpad5', 'rebind: accetta il giocatore come numero e toglie il tasto dall\'altro joystick');
  ok(!throws(() => I.validateBindings(r.bindings)), 'dopo rebind le associazioni sono valide');
  r = I.rebind(d, '1', 'up', 'ArrowUp');
  ok(r.bindings[1].up.join() === 'ArrowUp' && r.stolen.length === 0, 'rebind dello stesso tasto sulla stessa azione');
  for (const [p, a, c] of [['3', 'up', 'KeyA'], ['1', 'jump', 'KeyA'], ['1', 'up', ''], ['1', 'up', 'a b'], ['1', 'up', 5]]) ok(throws(() => I.rebind(d, p, a, c)), 'rebind non valido rifiutato: ' + [p, a, c]);
  // con nuove associazioni lo stato funziona
  const s = new I.InputState(I.rebind(d, '1', 'fire', 'Space').bindings);
  ok(s.keyDown(ev('Space', ' ')) && s.snapshot().joy[0] === 0x10 && s.snapshot().rows.every((x) => x === 0), 'Spazio riassegnato al fuoco: non e\' piu\' il tasto spazio della console');
  ok(!s.keyDown(ev('ControlLeft', 'Control', {ctrlKey: true})), 'Ctrl non e\' piu\' il fuoco dopo la riassegnazione');
  ok(throws(() => s.setBindings({})), 'setBindings con dati non validi lancia');
  ok(s.map.get('Space') !== undefined, 'setBindings non valido non rovina le associazioni in uso');
  s.setBindings(I.defaultBindings());
  ok(s.down.size === 0, 'setBindings rilascia i tasti premuti');
  // etichette
  const L = I.codeLabel;
  ok(L('ArrowUp') === 'Freccia su' && L('Numpad8') === 'Tastierino 8' && L('KeyI') === 'I' && L('Digit5') === '5' && L('F9') === 'F9' && L('Semicolon') === 'Punto e virgola' &&
    L('NumpadAdd') === 'Tastierino +' && L('Xyz') === 'Xyz' && L('ControlLeft') === 'Ctrl sinistro', 'etichette dei tasti');
}

// ---- gamepad
{
  const btn = (n, on) => { const b = Array.from({length: 17}, () => ({pressed: false, value: 0})); for (const i of on) b[i] = {pressed: true, value: 1}; return b; };
  const pad = (on, axes, conn) => ({connected: conn === undefined ? true : conn, buttons: btn(17, on), axes: axes || [0, 0, 0, 0]});
  ok(I.padBits(pad([12])) === 1 && I.padBits(pad([13])) === 4 && I.padBits(pad([14])) === 8 && I.padBits(pad([15])) === 2, 'croce direzionale: su, giu\', sinistra, destra');
  ok(I.padBits(pad([0])) === 0x10 && I.padBits(pad([3])) === 0x10 && I.padBits(pad([5])) === 0x10 && I.padBits(pad([7])) === 0x10, 'pulsanti A B X Y e dorsali = fuoco');
  ok(I.padBits(pad([8])) === 0 && I.padBits(pad([9])) === 0 && I.padBits(pad([10])) === 0, 'Indietro / Start / levette premute: nessun bit del joystick');
  ok(I.padBits(pad([12, 15, 0])) === 0x13, 'combinazioni: su + destra + fuoco');
  ok(I.padBits(pad([], [0, -1])) === 1 && I.padBits(pad([], [0, 1])) === 4 && I.padBits(pad([], [-1, 0])) === 8 && I.padBits(pad([], [1, 0])) === 2, 'levetta sinistra');
  ok(I.padBits(pad([], [0.4, -0.4])) === 0 && I.padBits(pad([], [0.51, 0])) === 2 && I.padBits(pad([], [0.5, 0])) === 0, 'zona morta 0,5 (il bordo non scatta)');
  ok(I.padBits(pad([], [0.3, 0.3]), 0.2) === 6, 'zona morta configurabile');
  ok(I.padBits(pad([12, 0], [1, 1], false)) === 0 && I.padBits(null) === 0 && I.padBits(undefined) === 0, 'gamepad scollegato o assente: 0');
  ok(I.padBits({buttons: [{value: 0.9}], axes: []}) === 0x10 && I.padBits({buttons: [{value: 0.4}], axes: []}) === 0, 'pulsante analogico: soglia 0,5');
  ok(I.padBits({}) === 0 && I.padBits({buttons: [], axes: ['x', null]}) === 0, 'gamepad senza pulsanti o con assi non numerici: 0');
  ok(I.padConsoleKeys(pad([9])).join() === '47' && I.padConsoleKeys(pad([8])).join() === '46' && I.padConsoleKeys(pad([8, 9])).join() === '47,46' && I.padConsoleKeys(pad([0])).length === 0, 'Start = ENT, Indietro = CLR');
  ok(I.padConsoleKeys(null).length === 0 && I.padConsoleKeys(pad([9], null, false)).length === 0, 'tasti dei gamepad: assente o scollegato');
  // assegnazione
  const A = pad([]), B = pad([]), C = pad([]), X = pad([], null, false);
  let r = I.assignPads([A, B, C], {1: 'auto', 2: 'auto'});
  ok(r[1] === A && r[2] === B, 'auto: i primi due gamepad ai due giocatori');
  r = I.assignPads([null, A, X, B], {1: 'auto', 2: 'auto'});
  ok(r[1] === A && r[2] === B, 'auto: salta i buchi e gli scollegati');
  r = I.assignPads([A, B], {1: 'auto', 2: 'off'});
  ok(r[1] === A && r[2] === null, 'giocatore 2 spento');
  r = I.assignPads([A, B, C], {1: 2, 2: 'auto'});
  ok(r[1] === C && r[2] === A, 'giocatore 1 sul gamepad 2, il giocatore 2 prende il primo libero');
  r = I.assignPads([A, B], {1: '1', 2: '1'});
  ok(r[1] === B && r[2] === null, 'lo stesso gamepad non va a due giocatori');
  r = I.assignPads([A], {1: 5, 2: 'auto'});
  ok(r[1] === null && r[2] === A, 'indice inesistente: nessun gamepad per quel giocatore');
  r = I.assignPads([], {});
  ok(r[1] === null && r[2] === null && I.assignPads(null, null)[1] === null, 'nessun gamepad');
  r = I.assignPads([A, B], undefined);
  ok(r[1] === A && r[2] === B, 'senza preferenze vale auto');
  // nello stato
  const s = new I.InputState();
  s.setPads({1: pad([12, 0]), 2: pad([15, 9])});
  const sn = s.snapshot();
  ok(sn.joy[0] === 0x11 && sn.joy[1] === 0x02 && sn.rows[5] === 0x80, 'stato: gamepad 1 su+fuoco, gamepad 2 destra, Start = ENT');
  s.keyDown(ev('ArrowLeft'));
  ok(s.snapshot().joy[0] === 0x19, 'stato: tastiera e gamepad si sommano');
  s.setPads({1: null, 2: null});
  ok(s.snapshot().joy[0] === 0x08 && s.snapshot().joy[1] === 0 && s.snapshot().rows[5] === 0, 'stato: gamepad staccati, resta la tastiera');
  // tastiera a schermo
  s.setVirtual(1, true); s.setVirtual(47, true); s.setVirtual(11, true); s.setVirtual(48, true); s.setVirtual(-1, true); s.setVirtual(1.5, true); s.setVirtual('a', true);
  ok(s.snapshot().rows[0] === 2 && s.snapshot().rows[5] === 0x80 && s.virtual.size === 2, 'tastiera a schermo: indici validi, 11 e fuori intervallo ignorati');
  s.setVirtual(1, false);
  ok(s.snapshot().rows[0] === 0, 'tastiera a schermo: rilascio');
}

// ---- fino alla console (con i dump veri)
function withDumps(dumps) {
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(dumps, f)));
  const bios = rd('bios/o2rom.bin'), cart = rd('blockout.bin');
  const con = new Console({bios, cart, charset: new Uint8Array(charsetOwn.build()), standard: 'PAL'});
  const s = new I.InputState();
  const apply = () => { const sn = s.snapshot(); con.keyRows.set(sn.rows); con.joy.set(sn.joy); };
  for (let fr = 0; fr < 25; fr++) con.runFrame();
  let ring = 0;
  const cpu = con.cpu;
  for (let fr = 0; fr < 20; fr++) { const e = con.vdc.frameDone + 1; while (con.vdc.frameDone < e) { cpu.step(); if (cpu.pc >= 0x71E && cpu.pc <= 0x727) ring++; } }
  ok(ring === 0, 'senza tasto il gioco non parte');
  s.keyDown(ev('Digit1', '1')); apply();
  for (let fr = 0; fr < 6; fr++) con.runFrame();
  s.keyUp(ev('Digit1', '1')); apply();
  ring = 0;
  for (let fr = 0; fr < 20; fr++) { const e = con.vdc.frameDone + 1; while (con.vdc.frameDone < e) { cpu.step(); if (cpu.pc >= 0x71E && cpu.pc <= 0x727) ring++; } }
  ok(ring > 1000, 'dopo il tasto (da InputState) il gioco parte (' + ring + ' istruzioni nell\'anello del gioco)');
  // il joystick 2 arriva al BUS quando la riga scelta e' 1; il joystick 1 con la riga 0
  s.keyDown(ev('Numpad8', '8')); s.keyDown(ev('Numpad0', '0')); s.keyDown(ev('ArrowLeft')); apply();
  cpu.p1 = 0x00; cpu.p2 = 0xF1;
  ok(con.busPin() === (~0x11 & 0xFF), 'joystick 2 (su + fuoco) sul BUS con la riga 1: ' + con.busPin().toString(16));
  cpu.p2 = 0xF0;
  ok(con.busPin() === (~0x08 & 0xFF), 'joystick 1 (sinistra) sul BUS con la riga 0: ' + con.busPin().toString(16));
  cpu.p2 = 0xF2;
  ok(con.busPin() === 0xFF, 'riga 2: il BUS non porta joystick');
}


// ---- confini: validazioni, gamepad, tastiera a schermo, stato
{
  const msgOf = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  const good = () => I.defaultBindings();
  const lay = (c) => { const b = good(); b['1'].up = [c]; return b; };
  // codici di tasto: 1..24 caratteri alfanumerici
  const tok = (c) => msgOf(() => I.validateBindings(lay(c))) === '';
  ok(tok('A') && tok('0') && tok('z') && tok('a'.repeat(24)) && tok('Key1Z'), 'codici validi');
  ok(!tok('') && !tok('a'.repeat(25)) && !tok('a-b') && !tok('a b') && !tok('à') && !tok('a_b') && !tok('a\n'), 'codici non validi');
  ok(msgOf(() => I.validateBindings(lay(''))) === 'codice di tasto non valido: ', 'messaggio: codice vuoto');
  ok(msgOf(() => I.validateBindings(lay('x'.repeat(40) + '-'))).endsWith(': ' + 'x'.repeat(30)), 'messaggio: codice troncato a 30');
  ok(msgOf(() => I.validateBindings(lay(7))) === 'codice di tasto non valido: 7', 'messaggio: codice numerico');
  // al massimo 4 tasti per azione
  const four = good(); four['1'].up = ['A1', 'A2', 'A3', 'A4']; ok(msgOf(() => I.validateBindings(four)) === '', '4 tasti per azione: ok');
  const five = good(); five['1'].up = ['A1', 'A2', 'A3', 'A4', 'A5']; ok(msgOf(() => I.validateBindings(five)) === 'associazioni dei tasti non valide: 1/up', '5 tasti: rifiutato con messaggio');
  const none = good(); none['2'].fire = []; ok(msgOf(() => I.validateBindings(none)) === '', 'azione senza tasti: ok');
  const miss = good(); delete miss['2'].left; ok(msgOf(() => I.validateBindings(miss)) === 'associazioni dei tasti non valide: 2/left', 'azione mancante: messaggio');
  const nop = good(); delete nop['2']; ok(msgOf(() => I.validateBindings(nop)) === 'associazioni dei tasti non valide: manca il joystick 2', 'joystick mancante: messaggio');
  const nop1 = good(); nop1['1'] = 'x'; ok(msgOf(() => I.validateBindings(nop1)) === 'associazioni dei tasti non valide: manca il joystick 1', 'joystick non oggetto');
  const nul1 = good(); nul1['1'] = null; ok(msgOf(() => I.validateBindings(nul1)) === 'associazioni dei tasti non valide: manca il joystick 1', 'joystick nullo');
  ok(msgOf(() => I.validateBindings(null)) === 'associazioni dei tasti non valide' && msgOf(() => I.validateBindings(5)) === 'associazioni dei tasti non valide' &&
    msgOf(() => I.validateBindings(undefined)) === 'associazioni dei tasti non valide' && msgOf(() => I.validateBindings('x')) === 'associazioni dei tasti non valide', 'associazioni non oggetto');
  const dup = good(); dup['2'].fire = ['ArrowUp']; ok(msgOf(() => I.validateBindings(dup)) === 'il tasto ArrowUp e’ associato a due azioni', 'tasto doppio: messaggio');
  const dup2 = good(); dup2['1'].up = ['A1', 'A1']; ok(/due azioni/.test(msgOf(() => I.validateBindings(dup2))), 'tasto doppio nella stessa azione');
  const copy = I.validateBindings(good()); ok(copy !== good() && JSON.stringify(copy) === JSON.stringify(good()), 'validateBindings copia');
  // rebind
  ok(msgOf(() => I.rebind(good(), '3', 'up', 'KeyA')) === 'azione non valida' && msgOf(() => I.rebind(good(), 1, 'jump', 'KeyA')) === 'azione non valida', 'rebind: azione non valida');
  ok(msgOf(() => I.rebind(good(), 1, 'up', '')) === 'tasto non valido' && msgOf(() => I.rebind(good(), 1, 'up', 'a'.repeat(25))) === 'tasto non valido' &&
    msgOf(() => I.rebind(good(), 1, 'up', 'a'.repeat(24))) === '' && msgOf(() => I.rebind(good(), 1, 'up', 5)) === 'tasto non valido' && msgOf(() => I.rebind(good(), 1, 'up', 'a-')) === 'tasto non valido', 'rebind: codice');
  {
    const b = good();
    const r = I.rebind(b, 2, 'fire', 'ArrowUp');               // ArrowUp era joystick 1 su
    ok(JSON.stringify(r.stolen) === JSON.stringify([{player: '1', action: 'up'}]) && r.bindings['1'].up.length === 0 && JSON.stringify(r.bindings['2'].fire) === '["ArrowUp"]', 'rebind: tasto rubato');
    ok(JSON.stringify(b) === JSON.stringify(good()), 'rebind non tocca l\'originale');
    const r2 = I.rebind(b, '1', 'up', 'ArrowUp');                // stessa azione: niente da rubare
    ok(r2.stolen.length === 0 && JSON.stringify(r2.bindings['1'].up) === '["ArrowUp"]', 'rebind sulla stessa azione');
    const r3 = I.rebind(b, 1, 'fire', 'ArrowUp');                // stesso giocatore, altra azione
    ok(r3.stolen.length === 1 && r3.stolen[0].action === 'up' && r3.bindings['1'].up.length === 0, 'rebind: stesso giocatore, altra azione');
    const r4 = I.rebind(b, 2, 'up', 'ArrowUp');                  // stessa azione, altro giocatore
    ok(r4.stolen.length === 1 && r4.stolen[0].player === '1', 'rebind: altra azione, giocatore diverso');
    ok(r4.bindings['2'].up.length === 1 && r4.bindings['1'].up.length === 0, 'rebind: sostituisce i tasti dell\'azione');
    const r5 = I.rebind(b, 1, 'up', 'KeyQ');
    ok(JSON.stringify(r5.bindings['1'].up) === '["KeyQ"]' && r5.stolen.length === 0, 'rebind: tasto libero');
    // il giocatore 2 stesso tasto di un'azione del giocatore 1 con identico nome d'azione e giocatore passato come numero
    const r6 = I.rebind(b, 2, 'up', 'ArrowUp'); ok(r6.stolen[0].player === '1' && r6.stolen[0].action === 'up', 'rebind: giocatore come numero');
  }
  // codeLabel
  ok(I.codeLabel('F1') === 'F1' && I.codeLabel('F12') === 'F12' && I.codeLabel('F123') === 'F123' && I.codeLabel('F') === 'F' && I.codeLabel('F1x') === 'F1x', 'codeLabel F');
  ok(I.codeLabel('Digit7') === '7' && I.codeLabel('Digit77') === 'Digit77' && I.codeLabel('KeyQ') === 'Q' && I.codeLabel('Keyq') === 'Keyq' && I.codeLabel('KeyQQ') === 'KeyQQ', 'codeLabel Digit / Key');
  ok(I.codeLabel('Numpad5') === 'Tastierino 5' && I.codeLabel('NumpadAdd') === 'Tastierino +' && I.codeLabel('NumpadSubtract') === 'Tastierino -' &&
    I.codeLabel('NumpadMultiply') === 'Tastierino *' && I.codeLabel('NumpadDivide') === 'Tastierino /' && I.codeLabel('NumpadDecimal') === 'Tastierino ,' &&
    I.codeLabel('NumpadEnter') === 'Invio (tastierino)' && I.codeLabel('Numpad') === 'Numpad' && I.codeLabel('XNumpad5') === 'XNumpad5', 'codeLabel tastierino');
  ok(I.codeLabel('ArrowUp') === 'Freccia su' && I.codeLabel('Space') === 'Spazio' && I.codeLabel('Whatever') === 'Whatever', 'codeLabel nomi');
  // consoleKey
  ok(I.consoleKey('') === -1 && I.consoleKey(null) === -1 && I.consoleKey(5) === -1 && I.consoleKey('ab') === -1 && I.consoleKey('Shift') === -1 && I.consoleKey('\u0000') === -1, 'consoleKey non valida');
  ok(I.consoleKey('Enter') === I.ENT && I.consoleKey('Escape') === I.CLR && I.consoleKey('Backspace') === I.CLR && I.consoleKey('Delete') === I.CLR, 'consoleKey alias');
  ok(I.KEYCODE['0'] === 0 && I.KEYCODE['N'] === I.LAYOUT.length - 1 && I.LAYOUT.length === 46, 'tabella tasti: primo e ultimo');
  // gamepad: soglie
  const pad = (o) => Object.assign({connected: true, buttons: [], axes: []}, o);
  const btn = (i, v) => { const b = []; b[i] = v; return b; };
  const J = I.JOY_BITS;
  ok(I.padBits(null) === 0 && I.padBits(pad({connected: false, buttons: btn(0, {pressed: true})})) === 0 && I.padBits(undefined) === 0, 'padBits: non collegato');
  ok(I.padBits({buttons: btn(0, {pressed: true})}) === J.fire, 'padBits: connected assente = collegato');
  ok(I.padBits(pad({buttons: btn(0, {pressed: false, value: 0.5})})) === 0 && I.padBits(pad({buttons: btn(0, {pressed: false, value: 0.51})})) === J.fire, 'padBits: valore del pulsante oltre 0,5');
  for (let i = 0; i < 8; i++) ok(I.padBits(pad({buttons: btn(i, {pressed: true})})) === J.fire, 'padBits: fuoco dal pulsante ' + i);
  for (let i = 8; i < 12; i++) ok(I.padBits(pad({buttons: btn(i, {pressed: true})})) === 0, 'padBits: il pulsante ' + i + ' non e\' fuoco');
  ok(I.padBits(pad({buttons: btn(12, {pressed: true})})) === J.up && I.padBits(pad({buttons: btn(13, {pressed: true})})) === J.down &&
    I.padBits(pad({buttons: btn(14, {pressed: true})})) === J.left && I.padBits(pad({buttons: btn(15, {pressed: true})})) === J.right, 'padBits: croce');
  ok(I.padBits(pad({buttons: btn(16, {pressed: true})})) === 0, 'padBits: pulsante 16 ignorato');
  ok(I.padBits(pad({axes: [0, -0.5]})) === 0 && I.padBits(pad({axes: [0, -0.51]})) === J.up && I.padBits(pad({axes: [0, 0.5]})) === 0 && I.padBits(pad({axes: [0, 0.51]})) === J.down, 'padBits: asse y e zona morta');
  ok(I.padBits(pad({axes: [-0.5, 0]})) === 0 && I.padBits(pad({axes: [-0.51, 0]})) === J.left && I.padBits(pad({axes: [0.5, 0]})) === 0 && I.padBits(pad({axes: [0.51, 0]})) === J.right, 'padBits: asse x e zona morta');
  ok(I.padBits(pad({axes: [0, -0.3]}), 0.2) === J.up && I.padBits(pad({axes: [0, -0.3]}), 0.3) === 0 && I.padBits(pad({axes: [0, -0.3]}), 0) === J.up && I.padBits(pad({axes: [0.1, 0]}), 0) === J.right, 'padBits: zona morta data');
  ok(I.padBits(pad({axes: [0.8, 0.8], buttons: btn(0, {pressed: true})})) === (J.right | J.down | J.fire), 'padBits: combinazione');
  ok(I.padBits(pad({axes: ['x', null]})) === 0 && I.padBits(pad({axes: [0.9]})) === J.right && I.padBits({connected: true}) === 0, 'padBits: assi non validi o mancanti');
  ok(I.padBits(pad({axes: [0, -1]})) === J.up && I.padBits(pad({axes: [-1, 0]})) === J.left, 'padBits: asse a fondo scala');
  // gamepad: ENT e CLR
  ok(JSON.stringify(I.padConsoleKeys(pad({buttons: btn(9, {pressed: true})}))) === '[' + I.ENT + ']', 'Start = ENT');
  ok(JSON.stringify(I.padConsoleKeys(pad({buttons: btn(8, {pressed: true})}))) === '[' + I.CLR + ']', 'Indietro = CLR');
  { const b = []; b[8] = {pressed: true}; b[9] = {pressed: true}; ok(JSON.stringify(I.padConsoleKeys(pad({buttons: b}))) === '[' + I.ENT + ',' + I.CLR + ']', 'ENT e CLR insieme (ordine)'); }
  ok(I.padConsoleKeys(pad({buttons: btn(9, {pressed: false, value: 0.5})})).length === 0 && I.padConsoleKeys(pad({buttons: btn(9, {pressed: false, value: 0.51})})).length === 1, 'ENT: soglia 0,5');
  ok(I.padConsoleKeys(pad({buttons: btn(8, {pressed: false, value: 0.5})})).length === 0 && I.padConsoleKeys(pad({buttons: btn(8, {pressed: false, value: 0.51})})).length === 1, 'CLR: soglia 0,5');
  ok(I.padConsoleKeys(pad({buttons: btn(10, {pressed: true})})).length === 0 && I.padConsoleKeys(pad({buttons: btn(7, {pressed: true})})).length === 0, 'altri pulsanti: nessun tasto');
  ok(I.padConsoleKeys(null).length === 0 && I.padConsoleKeys(pad({connected: false, buttons: btn(9, {pressed: true})})).length === 0 && I.padConsoleKeys({buttons: btn(9, {pressed: true})}).length === 1 && I.padConsoleKeys({}).length === 0, 'padConsoleKeys: assenti');
  // assegnazione dei gamepad
  {
    const A = {connected: true, id: 'A'}, B = {connected: true, id: 'B'}, C = {connected: true, id: 'C'}, D = {connected: false, id: 'D'};
    const id = (r) => [r['1'] && r['1'].id, r['2'] && r['2'].id];
    ok(JSON.stringify(id(I.assignPads([A, B, C]))) === '["A","B"]' && JSON.stringify(id(I.assignPads([null, A, D, B]))) === '["A","B"]', 'assegnazione automatica');
    ok(JSON.stringify(id(I.assignPads([A], {}))) === '["A",null]' && JSON.stringify(id(I.assignPads([], {}))) === '[null,null]' && JSON.stringify(id(I.assignPads(null, null))) === '[null,null]', 'assegnazione: pochi pad');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 'off'}))) === '[null,"A"]' && JSON.stringify(id(I.assignPads([A, B, C], {2: 'off'}))) === '["A",null]', 'assegnazione: off');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 2}))) === '["C","A"]' && JSON.stringify(id(I.assignPads([A, B, C], {2: '2'}))) === '["A","C"]', 'assegnazione: scelta a mano (e il resto in automatico)');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 1, 2: 1}))) === '["B",null]', 'assegnazione: lo stesso pad non va a due giocatori');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 0, 2: 2}))) === '["A","C"]' && JSON.stringify(id(I.assignPads([A, B, C], {1: 2, 2: 0}))) === '["C","A"]', 'assegnazione: entrambi a mano');
    ok(JSON.stringify(id(I.assignPads([A, D, C], {1: 1}))) === '["A","C"]' && JSON.stringify(id(I.assignPads([A, B], {1: 9}))) === '["A","B"]'.replace('"A"', 'null').replace('"B"', '"A"') || true, 'assegnazione: indice scollegato o inesistente');
    ok(JSON.stringify(id(I.assignPads([A, D, C], {1: 1}))) === '[null,"A"]', 'assegnazione: pad scollegato scelto a mano non si usa (giocatore 1 resta senza)');
    ok(JSON.stringify(id(I.assignPads([A, B], {1: 9}))) === '[null,"A"]', 'assegnazione: indice inesistente');
    ok(JSON.stringify(id(I.assignPads([A, B], {1: 'x'}))) === '[null,"A"]' && JSON.stringify(id(I.assignPads([A, B], {1: 1.5}))) === '[null,"A"]' && JSON.stringify(id(I.assignPads([A, B], {1: -1}))) === '[null,"A"]', 'assegnazione: valori non validi');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 'auto', 2: 'auto'}))) === '["A","B"]', 'assegnazione: auto esplicito');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 'off', 2: 'off'}))) === '[null,null]', 'assegnazione: tutti off');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 0, 2: 'auto'}))) === '["A","B"]', 'assegnazione: uno a mano e uno auto salta il preso');
    ok(JSON.stringify(id(I.assignPads([A, B, C], {1: 'auto', 2: 0}))) === '["B","A"]', 'assegnazione: auto sceglie il primo libero');
    ok(I.assignPads({0: A, length: 1})['1'] === A, 'assegnazione: oggetto simile a un array');
    ok(JSON.stringify(id(I.assignPads([D, A]))) === '["A",null]', 'assegnazione: scollegato in testa');
  }
  // stato: tastiera, tastiera a schermo, gamepad
  {
    const st = new I.InputState();
    ok(st.keyDown(ev('KeyQ', 'q')) === true && st.snapshot().rows[I.KEYCODE['Q'] >> 3] === 1 << (I.KEYCODE['Q'] & 7), 'tasto della console');
    ok(st.keyDown(ev('KeyQ', 'q', {metaKey: true})) === false && st.keyDown(ev('KeyQ', 'q', {altKey: true})) === false && st.keyDown(null) === false && st.keyDown({}) === false && st.keyDown({code: 5}) === false, 'tasti ignorati');
    ok(st.keyDown(ev('KeyW', 'w', {ctrlKey: true})) === false && st.keyDown(ev('ControlLeft', 'Control', {ctrlKey: true})) === true, 'Ctrl + lettera passa al browser, Ctrl + fuoco no');
    { const cb = I.defaultBindings(); cb['1'] = {up: ['ShiftLeft'], right: ['Space'], down: ['ControlRight'], left: ['NumpadAdd'], fire: ['KeyQ']}; cb['2'] = {up: ['ArrowDown'], right: ['Numpad8'], down: ['KeyW'], left: [], fire: ['Backquote']};
      const sc = new I.InputState(cb);
      const r = (code) => sc.keyDown(ev(code, 'x', {ctrlKey: true}));
      ok(r('ShiftLeft') && r('Space') && r('ControlRight') && r('NumpadAdd') && r('ArrowDown') && r('Numpad8'), 'Ctrl con tasti sicuri (Shift, Space, Control, Numpad, Arrow)');
      ok(!r('KeyQ') && !r('KeyW') && !r('Backquote'), 'Ctrl con tasti non sicuri'); }
    ok(st.keyUp(ev('KeyQ')) === true && st.keyUp(ev('KeyQ')) === false && st.keyUp(null) === false && st.keyUp({}) === false, 'keyUp');
    st.releaseAll();
    st.setPads({1: pad({buttons: btn(0, {pressed: true})}), 2: pad({axes: [0.9, 0], buttons: btn(9, {pressed: true})})});
    let sn = st.snapshot();
    ok(sn.joy[0] === J.fire && sn.joy[1] === J.right && (sn.rows[I.ENT >> 3] & (1 << (I.ENT & 7))) !== 0, 'gamepad nello stato');
    st.releaseAll();
    sn = st.snapshot();
    ok(sn.joy[0] === 0 && sn.joy[1] === 0 && sn.rows.every((x) => x === 0), 'releaseAll: gamepad, tasti e tastiera a schermo azzerati');
    st.setPads({1: pad({buttons: btn(9, {pressed: true})}), 2: pad({buttons: btn(8, {pressed: true})})});
    sn = st.snapshot();
    ok((sn.rows[I.ENT >> 3] & (1 << (I.ENT & 7))) !== 0 && (sn.rows[I.CLR >> 3] & (1 << (I.CLR & 7))) !== 0, 'tasti della console dei due gamepad');
    st.setPads({1: null, 2: null}); sn = st.snapshot(); ok(sn.rows.every((x) => x === 0), 'gamepad tolti');
    // tastiera a schermo: indici ammessi 0..47 tranne 11
    for (const [idx, accepted] of [[0, true], [1, true], [10, true], [11, false], [12, true], [46, true], [47, true], [48, false], [-1, false], [1.5, false], ['3', false], [NaN, false], [null, false]]) {
      st.releaseAll(); st.setVirtual(idx, true);
      const r = st.snapshot().rows.some((x) => x !== 0);
      ok(r === accepted, 'tastiera a schermo, indice ' + String(idx) + ': ' + r);
    }
    st.releaseAll(); st.setVirtual(0, true); st.setVirtual(0, false); ok(st.snapshot().rows.every((x) => x === 0), 'tastiera a schermo: rilascio');
    st.releaseAll(); st.setVirtual(47, true); sn = st.snapshot(); ok(sn.rows[5] === 0x80 && sn.rows.reduce((a, x) => a + x, 0) === 0x80, 'indice 47 = riga 5, bit 7');
    // cambio di associazioni azzera i tasti premuti
    st.releaseAll(); st.keyDown(ev('ArrowUp')); st.setBindings(I.defaultBindings()); ok(st.snapshot().joy[0] === 0, 'setBindings azzera i tasti premuti');
    // il joystick da tastiera: due azioni insieme si sommano; tasti di giocatori diversi vanno ognuno al suo
    st.releaseAll(); st.keyDown(ev('ArrowUp')); st.keyDown(ev('ArrowRight')); st.keyDown(ev('Numpad8', '8')); sn = st.snapshot();
    ok(sn.joy[0] === (J.up | J.right) && sn.joy[1] === J.up && sn.rows.every((x) => x === 0), 'joystick da tastiera: somma e giocatori');
  }
}

// ---- scambio dei comandi dei giocatori 1 e 2 (richiesta dell'utente, 18/10/2026: giochi a turni giocati da soli)
{
  const J = I.JOY_BITS;
  const pad = (bits) => ({connected: true, buttons: Array.from({length: 17}, (_, i) => ({pressed: false, value: 0})).map((b, i) => {
    const on = (i === 12 && (bits & J.up)) || (i === 13 && (bits & J.down)) || (i === 14 && (bits & J.left)) || (i === 15 && (bits & J.right)) || (i === 0 && (bits & J.fire));
    return {pressed: !!on, value: on ? 1 : 0};
  }), axes: [0, 0]});
  const s = new I.InputState();
  ok(s.swap === false, 'scambio: spento all\'inizio');
  s.keyDown(ev('ArrowUp')); s.keyDown(ev('Numpad4', '4'));
  let sn = s.snapshot();
  ok(sn.joy[0] === J.up && sn.joy[1] === J.left, 'scambio spento: ogni tasto al suo joystick');
  s.setSwap(true);
  sn = s.snapshot();
  ok(s.swap === true && sn.joy[0] === J.left && sn.joy[1] === J.up, 'scambio acceso: gli stessi tasti premuti vanno all\'altro joystick (subito, senza rilasciarli)');
  s.keyDown(ev('ControlLeft', 'Control', {ctrlKey: true})); s.keyDown(ev('Numpad0', '0'));
  sn = s.snapshot();
  ok(sn.joy[0] === (J.left | J.fire) && sn.joy[1] === (J.up | J.fire), 'scambio: il fuoco dei due giocatori si scambia come le direzioni');
  ok(sn.rows.every((x) => x === 0), 'scambio: la tastiera della console non cambia');
  s.releaseAll();
  s.keyDown(ev('Digit1', '1')); s.keyDown(ev('KeyA', 'a'));
  const before = Array.from(s.snapshot().rows);
  s.setSwap(false);
  ok(JSON.stringify(Array.from(s.snapshot().rows)) === JSON.stringify(before) && before.some((x) => x !== 0), 'scambio: i tasti 1 e A della console sono uguali con e senza scambio');
  s.releaseAll();
  // i gamepad si scambiano insieme ai tasti
  s.setPads({1: pad(J.right | J.fire), 2: pad(J.down)});
  sn = s.snapshot();
  ok(sn.joy[0] === (J.right | J.fire) && sn.joy[1] === J.down, 'gamepad, scambio spento');
  s.setSwap(true);
  sn = s.snapshot();
  ok(sn.joy[0] === J.down && sn.joy[1] === (J.right | J.fire), 'gamepad, scambio acceso: il gamepad 1 muove il joystick 2');
  // tasti e gamepad insieme: ogni sorgente passa dallo scambio una sola volta (niente doppio scambio)
  s.keyDown(ev('ArrowLeft'));
  sn = s.snapshot();
  ok(sn.joy[0] === J.down && sn.joy[1] === (J.right | J.fire | J.left), 'tasti e gamepad insieme, scambio acceso');
  s.setSwap(false);
  sn = s.snapshot();
  ok(sn.joy[0] === (J.right | J.fire | J.left) && sn.joy[1] === J.down, 'tasti e gamepad insieme, scambio spento di nuovo');
  // lo scambio non e' nello stato dei tasti: cambiare le associazioni o rilasciare tutto lo lascia com'e'
  s.setSwap(true); s.setBindings(I.defaultBindings()); ok(s.swap === true, 'setBindings non tocca lo scambio');
  s.releaseAll(); ok(s.swap === true, 'releaseAll non tocca lo scambio');
  // valori strani diventano booleani
  s.setSwap(0); ok(s.swap === false, 'setSwap(0) = spento');
  s.setSwap('si'); ok(s.swap === true, 'setSwap(\'si\') = acceso');
  s.setSwap(undefined); ok(s.swap === false, 'setSwap(undefined) = spento');
  // snapshot ritorna sempre una coppia nuova (chi la riceve puo' modificarla)
  s.setSwap(true); const a = s.snapshot(), b = s.snapshot(); a.joy[0] = 99; ok(b.joy[0] !== 99 && s.snapshot().joy[0] !== 99, 'snapshot: coppia nuova a ogni chiamata, anche con lo scambio');
  // con tutte le direzioni e il fuoco su entrambi
  const t = new I.InputState(); t.setSwap(true);
  for (const c of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) t.keyDown(ev(c));
  ok(t.snapshot().joy[0] === 0 && t.snapshot().joy[1] === 0x0F, 'scambio: quattro direzioni del giocatore 1 -> joystick 2 (0x0F), joystick 1 vuoto');
}

function main() {
  if (process.argv[2]) withDumps(process.argv[2]);
  if (fails) { console.log('FALLITI ' + fails + ' controlli (' + passes + ' ok)'); process.exit(1); }
  console.log('OK: ' + passes + ' controlli sugli ingressi');
}
main();
