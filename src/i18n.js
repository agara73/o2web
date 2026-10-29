'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// i18n.js - lingue della pagina (inglese e italiano).
//
// Lingua dei sorgenti: l'ITALIANO. Ogni testo che l'utente puo' leggere passa da t('testo in italiano con {segnaposti}', {valori}):
//  - con la lingua 'it' (quella di partenza di questo modulo, usata dai test dei moduli) il risultato e' il testo italiano con i segnaposti sostituiti;
//  - con la lingua 'en' il testo italiano e' la CHIAVE della tabella inglese (src/lang_en.js); se manca, si vede l'italiano e la voce si annota in
//    I18n.missing (i test controllano che non manchi niente). Un testo GIA' formattato (i moduli di base scrivono i loro messaggi in italiano) si
//    traduce confrontandolo con i modelli della tabella: cosi' il nucleo e i suoi test restano com'erano.
// La PAGINA parte in inglese (lo decide ui.js: lingua predefinita 'en', oppure «?lang=it» / «?lang=en» in fondo all'indirizzo; niente localStorage).
// I testi fissi del file HTML restano in italiano nel template e si traducono con translateDom(): per ogni blocco di testo (un elemento con testo e al
// piu' marcatura in linea: b, code, a...) la chiave e' il contenuto HTML a spazi normalizzati, il valore e' in src/lang_en_dom.js. Cio' che si e' tradotto
// si ricorda (testo originale + testo scritto) e si ripristina tornando all'italiano, ma solo se il contenuto non e' cambiato nel frattempo
// (i testi che scrive ui.js durante l'uso passano da t() e non si toccano; le zone scritte da ui.js portano data-dyn (data-dyn-attr: solo gli attributi) e il percorso le salta).
//   t(testo, valori)              testo nella lingua corrente (modello con {segnaposti} + valori, oppure testo gia' formattato dei moduli di base)
//   setLang(l) / getLang()        'en' | 'it'
//   translateDom(radice)          traduce / ripristina il DOM statico della pagina
//   untranslated(radice)          blocchi di testo e attributi del DOM senza voce inglese (per i test)
const EN = require('./lang_en.js');
const DOM = require('./lang_en_dom.js');

const LANGS = Object.freeze(['en', 'it']);
let lang = 'it';
const missing = new Set();

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// {segnaposto}: valore; {n|uno|altri}: «uno» se il valore e' 1, altrimenti «altri» (serve alle voci inglesi: l'italiano usa chiavi separate)
function fmt(s, p) {
  if (!p) return s;
  return String(s)
    .replace(/\{([A-Za-z0-9_]+)\|([^|{}]*)\|([^|{}]*)\}/g, (m, k, one, many) => (has(p, k) && p[k] !== undefined && p[k] !== null ? (Number(p[k]) === 1 ? one : many) : m)).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (has(p, k) && p[k] !== undefined && p[k] !== null ? String(p[k]) : m));
}

// Modelli con segnaposti compilati in espressioni regolari: servono a tradurre un testo GIA' formattato (per esempio un messaggio dei moduli di
// base, che restano in italiano) trovando il modello da cui viene. Il piu' lungo (per lettere fisse) vince; le parti variabili si traducono a loro
// volta se sono a loro volta testi noti (altrimenti restano come sono: nomi di file, di giochi, numeri).
let compiled = null;
function compile() {
  compiled = [];
  for (const k of Object.keys(EN)) {
    if (!/\{[A-Za-z0-9_]+\}/.test(k)) continue;
    const parts = k.split(/\{([A-Za-z0-9_]+)\}/), names = [];
    let src = '^';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) src += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      else { names.push(parts[i]); src += '([\\s\\S]+?)'; }
    }
    compiled.push({k, re: new RegExp(src + '$'), names, lit: k.replace(/\{[^}]+\}/g, '').length});
  }
  compiled.sort((a, b) => b.lit - a.lit);
}
function viaPattern(text) {
  if (!compiled) compile();
  for (const c of compiled) {
    const m = c.re.exec(text);
    if (!m) continue;
    const vals = {};
    c.names.forEach((n, i) => { if (!has(vals, n)) vals[n] = t(m[i + 1]); });
    return fmt(EN[c.k], vals);
  }
  return null;
}
const ITALIAN = /(?<![A-Za-zÀ-ÿ])(non(?=\s)|nel|nella|nello|della|dello|delle|degli|dei|del|sono|puo'|può|troppo|manca|nessun[ao]?|gioc[oh]i?|elenco|aggiung\w+|scegli|errore|impossibile|salvat[oa]|riparte|caricat[oa]|valid[oa]|file mancante|gia'|già)(?![A-Za-zÀ-ÿ])/i;

// Frammenti: le voci della tabella che iniziano con «~» sono pezzi di testo (senza segnaposti) da sostituire dentro un messaggio composto dai moduli
// di base per concatenazione («il file ... e' troppo grande»): si usano solo se nessun modello intero corrisponde. Il pezzo piu' lungo vince.
let frags = null;
function viaFragments(text) {
  if (!frags) frags = Object.keys(EN).filter((k) => k.charAt(0) === '~').map((k) => [k.slice(1), EN[k]]).sort((x, y) => y[0].length - x[0].length);
  let out = text, n = 0;
  const hold = [];
  for (const [it, en] of frags) {
    if (out.indexOf(it) < 0) continue;
    out = out.split(it).join('\uE000' + (hold.push(en) - 1) + '\uE001');
    n++;
  }
  if (!n) return null;
  return out.replace(/\uE000(\d+)\uE001/g, (m, i) => hold[+i]);
}

// t(testo): se e' un modello dell'elenco inglese (anche con segnaposti, si passano in valori) o un testo gia' formattato che ne discende, lo traduce.
function t(key, p) {
  if (lang !== 'en') return fmt(key, p);
  if (has(EN, key)) return fmt(EN[key], p);
  if (!p) {
    const r = viaPattern(key);
    if (r !== null) return r;
    const f = viaFragments(key);
    if (f !== null) { if (ITALIAN.test(f)) missing.add(key); return f; }
  }
  if (ITALIAN.test(key)) missing.add(key);
  return fmt(key, p);
}

function setLang(l) {
  if (!LANGS.includes(l)) throw new Error('lingua non supportata: ' + l);
  lang = l;
  return lang;
}
function getLang() { return lang; }

// ---------------------------------------------------------------- DOM statico
const INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'CODE', 'KBD', 'A', 'SPAN', 'SUP', 'SUB', 'BR', 'SMALL', 'U', 'ABBR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'SVG', 'CANVAS', 'NOSCRIPT', 'HEAD']);
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const hasLetters = (s) => /[A-Za-zÀ-ÿ]{2}/.test(s);

const docRec = {};
const recs = new WeakMap();      // elemento o nodo di testo -> {orig, set}
const arecs = new WeakMap();     // elemento -> {attributo: {orig, set}}  (separato: un elemento puo' avere sia attributi sia testo tradotti)

function onlyInline(el) {
  for (const c of el.querySelectorAll('*')) { if (!INLINE.has(c.tagName.toUpperCase()) || c.hasAttribute('id')) return false; }
  return true;
}
function directText(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  return false;
}

// percorre i blocchi di testo e gli attributi: cb(tipo, elemento o nodo, chiave) ; tipo 'html' | 'text' | 'attr'
function walk(el, cb) {
  if (el.nodeType !== 1 || el.hasAttribute('data-dyn')) return;
  if (!el.hasAttribute('data-dyn-attr')) for (const a of ATTRS) if (el.hasAttribute(a)) cb('attr', el, el.getAttribute(a), a);      // data-dyn-attr: gli attributi li scrive ui.js
  if (SKIP.has(el.tagName.toUpperCase())) return;
  const dt = directText(el);
  if (dt && onlyInline(el)) { cb('html', el, el.innerHTML); return; }
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) { if (dt && n.nodeValue.trim()) cb('text', n, n.nodeValue); }
    else if (n.nodeType === 1) walk(n, cb);
  }
}

function translateDom(root) {
  const en = lang === 'en';
  root = root || document;
  const top = root.documentElement || root;
  walk(top.querySelector ? (top.querySelector('body') || top) : top, (kind, node, value, attr) => {
    if (kind === 'attr') {
      let r = arecs.get(node);
      if (!r) { r = {}; arecs.set(node, r); }
      const rr = r[attr];
      if (!en) { if (rr && value === rr.set) { node.setAttribute(attr, rr.orig); delete r[attr]; } return; }
      if (rr && value === rr.set) return;
      if (has(DOM, norm(value))) { const v = DOM[norm(value)]; r[attr] = {orig: value, set: v}; node.setAttribute(attr, v); }
      return;
    }
    const rr = recs.get(node);
    const cur = kind === 'html' ? node.innerHTML : node.nodeValue;
    if (!en) {
      if (rr && cur === rr.set) { if (kind === 'html') node.innerHTML = rr.orig; else node.nodeValue = rr.orig; recs.delete(node); }
      return;
    }
    if (rr && cur === rr.set) return;
    const k = norm(cur);
    if (!has(DOM, k)) return;
    if (kind === 'html') {
      node.innerHTML = DOM[k];
      recs.set(node, {orig: cur, set: node.innerHTML});
    } else {
      const lead = /^\s*/.exec(cur)[0], tail = /\s*$/.exec(cur)[0];
      node.nodeValue = lead + DOM[k] + tail;
      recs.set(node, {orig: cur, set: node.nodeValue});
    }
  });
  // titolo e descrizione della pagina (voci «doc:title:...» e «doc:meta:...» della tabella)
  if (typeof document !== 'undefined' && root === document) {
    const mt = document.querySelector('meta[name="description"]');
    const items = [['title', document.title, (v) => { document.title = v; }]];
    if (mt) items.push(['meta', mt.getAttribute('content'), (v) => mt.setAttribute('content', v)]);
    for (const [id, cur, set] of items) {
      const rr = docRec[id];
      if (!en) { if (rr && cur === rr.set) { set(rr.orig); delete docRec[id]; } continue; }
      if (rr && cur === rr.set) continue;
      const key = 'doc:' + id + ':' + norm(cur);
      if (has(DOM, key)) { docRec[id] = {orig: cur, set: DOM[key]}; set(DOM[key]); }
    }
  }
}

// blocchi di testo e attributi (con lettere) senza voce nella tabella: per i test del DOM
function untranslated(root) {
  const out = [];
  root = root || document;
  walk(root.querySelector('body') || root, (kind, node, value, attr) => {
    const v = norm(value);
    if (!v || !hasLetters(v)) return;
    const rr = kind === 'attr' ? arecs.get(node) : recs.get(node);
    if (kind === 'attr') { if (rr && rr[attr] && value === rr[attr].set) return; } else if (rr && value === rr.set) return;
    if (!has(DOM, v)) out.push((kind === 'attr' ? '[' + attr + '] ' : '') + v);
  });
  return out;
}

// tutte le unita' di testo del DOM statico (per generare la tabella: tools/dom_units.py)
function units(root) {
  const out = [];
  root = root || document;
  walk(root.querySelector('body') || root, (kind, node, value, attr) => {
    const v = norm(value);
    if (v && hasLetters(v)) out.push((kind === 'attr' ? '[' + attr + '] ' : '') + v);
  });
  return out;
}

module.exports = {t, fmt, setLang, getLang, LANGS, translateDom, untranslated, units, missing, EN, DOM, norm, ITALIAN};
