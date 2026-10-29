'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// cartmap.js - riconoscimento dello schema di mappa di una cartuccia (solo dal CONTENUTO del file, nessun elenco di titoli) e
// calcolo dell'indirizzo nel file per un indirizzo di programma 0x400-0xFFF. Tutti gli schemi sono IPOTESI ricavate dai dump
// dell'utente (tools/survey_carts.js) e restano "da verificare" (o2web-stato.md). hw/o2line.py ha la stessa logica in Python
// (l'oracolo): i due devono restare identici (lo controlla test/line_run.js sulle stesse cartucce).
//
// Schemi:
//   'std'     file = sequenza di banchi da 2 KB; banco = P1 & (banchi-1) per 1, 2, 4 banchi (2, 4, 8 KB). La finestra della CPU
//             0x400-0xBFF mostra il banco; 0xC00-0xFFF e' uno specchio di 0x800-0xBFF (A10 della ROM <- A11 della CPU).
//             Al reset P1 = 0xFF: parte l'ultimo banco.
//   'linear'  cartuccia da 4 KB senza cambio di banco: indirizzo della CPU a (0x400-0xFFF) -> file[a]. Riconosciuta perche'
//             i due vettori di avvio JMP sono a offset 0x400 del file e non a 0x800.
//   'rally'   16 KB (8 banchi da 2 KB), tappa 5 (giochi Videopac+ come Trans American Rally e Helicopter Rescue): il banco si scrive in un
//             latch con un MOVX con A7 = 1, P1 bit 4 = 0 e P1 bit 3 = 1 (chip video non selezionato: Neutron Star scrive il registro 0xA0 del chip video con P1 bit 4 = 0 e bit 3 = 0, che non e' un cambio di banco; il dato e' il numero del banco); con P1 bit 0 = 1 il banco e' sempre l'ultimo (7),
//             con P1 bit 0 = 0 e' il latch (all'inizio 0). Finestra come 'std' (0xC00-0xFFF specchio di 0x800-0xBFF). I file da 12 KB
//             (Air Battle, Neutron Star: nessun'altra ipotesi regge i loro dump) si leggono come la parte ALTA di una finestra da 16 KB
//             (4 KB di 0xFF davanti: il banco di avvio, l'ultimo, e' quello con i vettori). Fonte: documentazione di MAME (rally.cpp,
//             riscritto da zero) e i dump: DA VERIFICARE su cartucce vere (il 12 KB soprattutto).
//   'big'     altre dimensioni oltre 8 KB (10, 14, oltre 16 KB): schema non noto, NON SUPPORTATE. Si caricano comunque come 'std' sui
//             primi 4 banchi, ma console.cartInfo.ok = false.

// il vettore di avvio e' una coppia di JMP (opcode con i 5 bit bassi = 00100) nei primi byte
function isJmpVec(b, off) {
  return off + 2 < b.length && (b[off] & 0x1F) === 0x04 && (b[off + 2] & 0x1F) === 0x04;
}

// cart: Uint8Array gia' arrotondato a multipli di 2 KB (o null)
// ritorna {kind, banks, mask, ok, reason}
function analyzeCart(cart) {
  if (!cart || !cart.length) return {kind: 'none', banks: 0, mask: 0, ok: true, reason: ''};
  const n = Math.ceil(cart.length / 0x800);
  if (n === 8) return {kind: 'rally', banks: 8, mask: 7, ok: true, reason: ''};
  if (n > 4) {
    return {kind: 'big', banks: n, mask: 3, ok: false,
      reason: 'cartuccia da ' + (n * 2) + ' KB: schema di cambio banco non noto (probabile gioco Videopac+ G7400)'};
  }
  if (n === 2 && isJmpVec(cart, 0x400) && !isJmpVec(cart, 0x800)) return {kind: 'linear', banks: 2, mask: 0, ok: true, reason: ''};
  return {kind: 'std', banks: n, mask: n <= 1 ? 0 : n === 2 ? 1 : 3, ok: true, reason: ''};
}

// una cartuccia da 12 KB si legge come la parte alta di una finestra da 16 KB (vedi 'rally'): ritorna l'immagine da usare (cart gia'
// arrotondato a multipli di 2 KB) senza modificare quella data
function layoutCart(cart) {
  if (cart && cart.length === 0x3000) {
    const out = new Uint8Array(0x4000).fill(0xFF);
    out.set(cart, 0x1000);
    return out;
  }
  return cart;
}

// indirizzo nel file per l'indirizzo di programma a (0x400-0xFFF), con P1 corrente e, per 'rally', il latch del banco
function cartOffset(info, p1, a, latch) {
  if (info.kind === 'linear') return a;
  if (info.kind === 'rally') return ((((p1 & 1) ? 0xFF : latch) << 11) | ((a & 0x800) >> 1) | (a & 0x3FF)) & 0x3FFF;
  return ((p1 & info.mask) << 11) | ((a & 0x800) >> 1) | (a & 0x3FF);
}

module.exports = {analyzeCart, cartOffset, isJmpVec, layoutCart};
