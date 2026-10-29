'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_i18n.js - lingue: logica di src/i18n.js e tabella inglese src/lang_en.js (il DOM si prova in test/browser_i18n.py).
//  1. t(): italiano = testo con segnaposti; inglese = tabella; modelli per i testi gia' formattati; frammenti; plurali; voci mancanti annotate.
//  2. tabella: segnaposti uguali nella chiave e nel valore, nessuna voce vuota o doppia, nessuna parola italiana nei valori, niente emoji.
//  3. ogni testo passato a T('...') in ui.js, app.js e charui.js ha la voce inglese.
//  4. ogni pezzo di messaggio dei moduli di base (errori, motivi, note) si traduce senza lasciare italiano.
//  5. i moduli di base restano in italiano (nessun modulo cambia lingua da solo).
const fs = require('fs');
const path = require('path');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');      // O2_SRC_DIR: copia guastata dalla prova di mutazione
const I = require(path.join(SRC, 'i18n.js'));

let n = 0, bad = 0;
const has = (k) => Object.prototype.hasOwnProperty.call(I.EN, k);
function ok(c, m) { n++; if (!c) { bad++; console.log('FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (' + JSON.stringify(a) + ' !== ' + JSON.stringify(b) + ')'); }

// ---- 1. logica
eq(I.getLang(), 'it', 'lingua di partenza del modulo: italiano');
eq(I.t('Ciao {x}, {y}', {x: 'a', y: 2}), 'Ciao a, 2', 'italiano: segnaposti');
eq(I.t('Ciao {x}', {}), 'Ciao {x}', 'italiano: segnaposto senza valore resta com\'e\'');
eq(I.t('Solo testo'), 'Solo testo', 'italiano: testo senza valori');
let thrown = false;
try { I.setLang('fr'); } catch (e) { thrown = true; }
ok(thrown && I.getLang() === 'it', 'lingua non supportata: errore, lingua invariata');
I.setLang('en');
eq(I.getLang(), 'en', 'setLang en');
eq(I.t('Nessun gioco'), 'No games', 'inglese: voce esatta');
eq(I.t('Aggiunti all’elenco: {list}', {list: 'x'}), 'Added to the list: x', 'inglese: modello con valori');
eq(I.t('Aggiunti all’elenco: 2 giochi'), 'Added to the list: 2 games', 'inglese: testo gia\' formattato -> modello (la parte variabile si traduce a sua volta)');
eq(I.t('{n} file saltati: {list}', {n: 1, list: 'a'}), '1 file skipped: a', 'plurale: uno');
eq(I.t('{n} file saltati: {list}', {n: 3, list: 'a'}), '3 files skipped: a', 'plurale: molti');
eq(I.t('3 file saltati: a.bin: file vuoto'), '3 files skipped: a.bin: empty file', 'testo formattato con pezzo noto dentro');
eq(I.t('Errore: zip troncato'), 'Error: zip truncated', 'frammenti');
eq(I.t('Tastierino +'), 'Keypad +', 'modello con un solo segnaposto');
I.missing.clear();
eq(I.t('Questo testo non esiste nella tabella'), 'Questo testo non esiste nella tabella', 'testo ignoto: resta com\'e\'');
ok(I.missing.has('Questo testo non esiste nella tabella'), 'testo ignoto italiano: annotato in missing');
I.missing.clear();
I.t('Hello world {x}', {x: 1});
ok(I.missing.size === 0, 'testo inglese ignoto: non annotato');
I.t('Fine, non-https address');
ok(I.missing.size === 0, '«non-https» non e\' preso per italiano');
I.setLang('it');
eq(I.t('Nessun gioco'), 'Nessun gioco', 'ritorno all\'italiano');

// ---- 2. tabella
const src = fs.readFileSync(path.join(SRC, 'lang_en.js'), 'utf8');
const keys = Object.keys(I.EN);
const lines = src.split('\n').filter((l) => /^  "/.test(l));
eq(lines.length, keys.length, 'tabella: nessuna chiave doppia (' + lines.length + ' righe, ' + keys.length + ' voci)');
const ph = (s) => (s.match(/\{([A-Za-z0-9_]+)(?=[}|])/g) || []).map((x) => x.slice(1)).filter((v, i, a) => a.indexOf(v) === i).sort().join(',');
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const ITALIAN_VALUE = /\b(non|nel|nella|della|dello|delle|degli|dei|del|sono|puo'|troppo|manca|nessun[ao]?|gioc[oh]i?|elenco|aggiung\w+|scegli|errore|impossibile|salvat[oa]|riparte|caricat[oa]|gia')\b/i;
for (const k of keys) {
  const v = I.EN[k];
  ok(typeof v === 'string' && v.trim() !== '', 'voce vuota: ' + k);
  if (k.charAt(0) === '~') {
    ok(!/\{[A-Za-z0-9_]+\}/.test(k), 'frammento con segnaposto: ' + k);
    continue;
  }
  ok(ph(k) === ph(v), 'segnaposti diversi: ' + k + ' -> ' + v);
  ok(!EMOJI.test(k) && !EMOJI.test(v), 'emoji nella voce: ' + k);
  ok(!ITALIAN_VALUE.test(v), 'parola italiana nel valore: ' + v);
}
for (const k of Object.keys(I.DOM)) ok(I.DOM[k].trim() !== '' && !EMOJI.test(I.DOM[k]), 'voce DOM vuota o con emoji: ' + k.slice(0, 50));
ok(Object.keys(I.DOM).some((k) => k.startsWith('doc:title:')) && Object.keys(I.DOM).some((k) => k.startsWith('doc:meta:')), 'tabella DOM: titolo e descrizione della pagina');

// ogni modello con segnaposti: il testo italiano formattato si ritraduce nel modello inglese con gli stessi valori (nessun modello ne oscura un altro)
I.setLang('en');
let rt = 0;
for (const k of keys) {
  if (k.charAt(0) === '~' || !/\{[A-Za-z0-9_]+\}/.test(k)) continue;
  const vals = {};
  for (const m of k.matchAll(/\{([A-Za-z0-9_]+)\}/g)) vals[m[1]] = 'Zq' + m[1];
  const it = k.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) => vals[name]);
  const want = I.t(k, vals);
  rt++;
  eq(I.t(it), want, 'andata e ritorno del modello «' + k.slice(0, 50) + '»');
}
ok(rt > 100, 'modelli con segnaposti provati (' + rt + ')');
// ogni frammento
let fr = 0;
for (const k of keys) {
  if (k.charAt(0) !== '~') continue;
  fr++;
  const it = k.slice(1);
  ok(I.t(it).indexOf(I.EN[k]) >= 0 || has(it) || I.t(it) !== it, 'frammento che non si applica: «' + it + '»');
}
ok(fr > 100, 'frammenti provati (' + fr + ')');
// plurali e nomi di segnaposto con maiuscole, cifre e trattino basso
eq(I.fmt('{aB_9|uno|altri}', {aB_9: 1}), 'uno', 'plurale: nome con maiuscole, cifre e trattino basso, uno');
eq(I.fmt('{aB_9|uno|altri}', {aB_9: 2}), 'altri', 'plurale: nome con maiuscole, cifre e trattino basso, altri');
eq(I.fmt('{x|uno|altri}', {}), '{x|uno|altri}', 'plurale senza valore: resta com\'e\'');
eq(I.fmt('{x|uno|altri} e {y}', {x: 1, y: 'k'}), 'uno e k', 'plurale e segnaposto insieme');
eq(I.fmt('{x|a|b} {x|a|b}', {x: 0}), 'b b', 'plurale: due volte, zero = altri');
eq(I.t('{A_1} (x)+[y]', {A_1: 'q'}), 'q (x)+[y]', 'inglese: chiave ignota con segnaposto maiuscolo: resta com\'e\'');
// ogni parola del riconoscimento dell'italiano
for (const w of ['non x', 'nel', 'nella', 'nello', 'della', 'dello', 'delle', 'degli', 'dei', 'del', 'sono', 'puo\'', 'può', 'troppo', 'manca', 'nessun', 'nessuna', 'nessuno', 'gioco', 'giochi', 'giochi', 'elenco', 'aggiungi', 'scegli', 'errore', 'impossibile', 'salvato', 'salvata', 'riparte', 'caricato', 'caricata', 'valido', 'valida', 'file mancante', 'gia\'', 'già']) {
  ok(I.ITALIAN.test('xx ' + w + ' yy') && !I.ITALIAN.test('xx' + w + 'yy'), 'riconosciuto come italiano (parola intera): «' + w + '»');
}
for (const w of ['non', 'nel', 'della', 'gioco', 'manca', 'già', 'puo\'']) {
  ok(!I.ITALIAN.test('X' + w + ' ') && !I.ITALIAN.test('\u00E9' + w + ' ') && !I.ITALIAN.test(' ' + w + 'X') && !I.ITALIAN.test(' ' + w + '\u00E9') && !I.ITALIAN.test('_' + w + '_'.repeat(0) + 'z') , 'parola intera, non pezzo di un\'altra: «' + w + '»');
}
const ALLCH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
eq(I.fmt('{' + ALLCH + '|uno|altri}', {[ALLCH]: 1}), 'uno', 'plurale: nome con tutti i caratteri ammessi');
eq(I.fmt('<{' + ALLCH + '}>', {[ALLCH]: 'v'}), '<v>', 'segnaposto con tutti i caratteri ammessi');
I.missing.clear();
I.t('xx non-https yy');
I.t('the game file');
ok(I.missing.size === 0, 'parole inglesi non scambiate per italiano');
I.setLang('it');
let em = '';
try { I.setLang('fr'); } catch (e) { em = e.message; }
eq(em, 'lingua non supportata: fr', 'messaggio della lingua non supportata');

// ---- 3. testi passati a T()
function literalsOfT(code) {
  const out = [];
  const re = /\bT\(/g;
  let m;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length, depth = 1, first = true, end = -1;
    for (let j = i; j < code.length && depth > 0; j++) {
      const c = code[j];
      if (c === '\'' || c === '"') {                                    // stringa: la leggo intera
        let k = j + 1, s = '';
        while (k < code.length && code[k] !== c) { if (code[k] === '\\') { s += code.slice(k, k + 2); k += 2; } else s += code[k++]; }
        if (first && depth === 1) out.push(s);
        else if (first && depth > 1 && /^[^()]*$/.test(code.slice(i, j))) out.push(s);
        j = k;
      } else if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) end = j; }
      else if (c === ',' && depth === 1) first = false;
    }
  }
  return out;
}
function unesc(s) { return s.replace(/\\u([0-9A-Fa-f]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\'/g, '\'').replace(/\\"/g, '"'); }
let tcount = 0;
const NOT_TEXT = ['vdc', 'ef', 'auto', 'high', 'low', 'partita '];      // confronti e prefissi dentro T(...), non testi: «partita » si completa con voci intere
for (const f of ['ui.js', 'app.js', 'charui.js']) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const lit of literalsOfT(code)) {
    const k = unesc(lit);
    if (!/[A-Za-zÀ-ÿ]{2}/.test(k)) continue;
    tcount++;
    if (NOT_TEXT.includes(k)) continue;
    ok(has(k) || has('~' + k), f + ': manca la voce inglese per T(\'' + k.slice(0, 70) + '\')');
  }
}
ok(tcount > 150, 'T(): trovate molte chiamate (' + tcount + ')');

// ---- 4. pezzi di messaggio dei moduli di base
const CORE = ['library', 'session', 'unzip', 'zipstore', 'covers', 'netfetch', 'console', 'vdc', 'audio', 'cpu8048', 'ef934x', 'webaudio', 'look', 'input', 'machines', 'charedit', 'cartmap', 'z80', 'chessmod']      // (photos: errori del solo build, non della pagina);
const CTX = /(Error\(|Error\s*\(|why:|reason\s*[:=]|reason =|note:|SnapshotError\(|NetError\(|PhotoError\(|SessionError\(|ZipError\(|LimitError\(|LookError\()/;
I.setLang('en');
let corePieces = 0;
const ITALIAN_ANY = /\b(non|nel|nella|della|dello|delle|degli|dei|del|sono|troppo|manca|nessun[ao]?|gioc[oh]i?|elenco|scegli|errore|impossibile|salvat[oa]|riparte|file|stato|dimensione|valid[oa]|zip|voce|cartuccia|set|byte)\b/i;
const NEED_TR = /(non (e’|è|e'|valid|suppo|ammess|presente|rico|legg|trovat)|manca|troppo|vuot|valore non|diverso|sconosciut|danneggiat|inatteso|duplicat|incoerent|impossibile|non puo)/i;
for (const mod of CORE) {
  const lines = fs.readFileSync(path.join(SRC, mod + '.js'), 'utf8').split('\n');
  for (const line of lines) {
    if (/^\s*\/\//.test(line) || !CTX.test(line)) continue;
    const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
    let m;
    while ((m = re.exec(line))) {
      const lit = unesc(m[1] !== undefined ? m[1] : m[2]);
      if (!NEED_TR.test(lit) || !/[a-zà-ù]{3}/i.test(lit)) continue;
      if (/^[A-Z_]+$/.test(lit) || /^[a-z0-9_.\/-]+$/.test(lit)) continue;
      corePieces++;
      I.missing.clear();
      const r = I.t(lit);
      ok(r !== lit && !I.missing.has(lit), mod + ': pezzo non tradotto: «' + lit + '»' + (r !== lit ? ' -> ' + r : ''));
    }
  }
}
ok(corePieces > 120, 'moduli di base: controllati molti pezzi (' + corePieces + ')');
I.setLang('it');

// ---- 5. i moduli di base restano in italiano
const {Console} = require(path.join(SRC, 'console.js'));
let msg = '';
try { new Console({}); } catch (e) { msg = e.message; }
ok(/manca|BIOS|bios/i.test(msg), 'console senza BIOS: messaggio in italiano (' + msg + ')');
I.setLang('en');
try { new Console({}); } catch (e) { eq(e.message, msg, 'il nucleo non traduce da solo'); }
I.setLang('it');

console.log((bad ? 'FALLITO: ' + bad + ' su ' : 'OK: ') + n + ' controlli sulle lingue (' + keys.length + ' voci di messaggi, ' + Object.keys(I.DOM).length + ' del DOM)');
process.exit(bad ? 1 : 0);
