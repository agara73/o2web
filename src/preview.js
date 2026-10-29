'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// preview.js - l'ANTEPRIMA di un gioco (tappa 7): una miniatura di una schermata vera, ottenuta facendo girare la cartuccia per qualche
// secondo di emulazione senza audio ne' schermo, con un copione fisso di tasti. Funzioni pure sul buffer dei pixel (360 x 243, indici
// colore 0..15 del chip video), senza DOM: la pagina disegna poi il risultato in un <canvas>. La miniatura nasce dal dump dell'utente
// e resta SOLO in memoria della pagina: non entra mai nella sessione, negli stati, ne' in nessun file.
//
// Copione (deterministico): 270 fotogrammi; i tasti (tutte le righe della tastiera, bit 0) sono premuti dal fotogramma 150 al 155, per
// passare la schermata di scelta del gioco; dal 170 ogni 10 fotogrammi si valuta il quadro e si tiene il piu' ricco.
//   Punteggio del quadro = (pixel diversi dal colore piu' frequente) * min(colori con almeno lo 0,5% dei pixel, 4)   [aritmetica intera]
//   Quadro «vuoto» = meno del 2% dei pixel diversi dal colore piu' frequente: al suo posto la pagina mostra un segnaposto
//   Si ferma in anticipo quando un quadro ha almeno il 25% di pixel diversi e almeno 3 colori.
//   Miniatura: media a scatole, in aritmetica intera con arrotondamento per eccesso a meta' (riferimento indipendente: hw/preview_ref.py)
//   frameStats(fb)          -> {n, max, colors}
//   frameScore(st)          -> intero
//   isBlankStats(st)        -> boolean
//   downscale(fb, pal, w, h, ow, oh) -> Uint8ClampedArray RGBA (ow*oh*4)
//   PreviewRun              esecuzione a passi: new PreviewRun(con).step(nFotogrammi) -> true quando e' finita; result()
const {PALETTE, VIS_W, VIS_H} = require('./vdc.js');

// Prima fase (270 fotogrammi): una pressione dei tasti 0, 8, 16... (colonna 0) ai fotogrammi 150-155, campioni dal 170 ogni 10; si ferma prima se il quadro e' ricco.
// Seconda fase, solo se alla fine della prima il quadro migliore ha meno del 2% di punti diversi dal fondo (il gioco aspetta un tasto): si premono uno alla
// volta i tasti di KEYS (5 fotogrammi premuto, 35 rilasciato), con un campione ogni 10 fotogrammi, e ci si ferma al primo campione con almeno il 2%.
const KEYS = (() => {
  const first = [1, 0, 47, 2, 3, 4, 5, 6, 7, 8, 9, 44, 45, 12, 13, 46];             // 1, 0, ENT, le altre cifre, Y, N, spazio, ?, CLR
  const rest = [];
  for (let i = 0; i < 48; i++) if (!first.includes(i) && i !== 11) rest.push(i);    // il tasto 11 non esiste
  return first.concat(rest);
})();
const SCRIPT = {total: 270, pressFrom: 150, pressTo: 156, sampleFrom: 170, sampleEvery: 10, keys: KEYS, perKey: 40, keyPress: 5, keySampleEvery: 10, keySampleAt: 9};
const PV_W = 80, PV_H = 54;

function frameStats(fb) {
  const h = new Uint32Array(16);
  for (let i = 0; i < fb.length; i++) h[fb[i] & 15]++;
  let max = 0, colors = 0;
  for (let c = 0; c < 16; c++) { if (h[c] > max) max = h[c]; if (h[c] * 200 >= fb.length) colors++; }
  return {n: fb.length, max, colors};
}
const frameScore = (st) => (st.n - st.max) * Math.min(st.colors, 4);
const isPoorStats = (st) => (st.n - st.max) * 50 < st.n;       // meno del 2% di punti diversi dal fondo: il gioco forse aspetta un tasto
const isBlankStats = (st) => (st.n - st.max) * 500 < st.n;      // meno dello 0,2%: vuoto davvero (una riga di testo e' piu' del 2%/10)
const isRichStats = (st) => (st.n - st.max) * 4 >= st.n && st.colors >= 3;

function downscale(fb, pal, w, h, ow, oh) {
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = Math.floor(oy * h / oh);
    const y1 = Math.max(y0 + 1, Math.floor((oy + 1) * h / oh));
    for (let ox = 0; ox < ow; ox++) {
      const x0 = Math.floor(ox * w / ow);
      const x1 = Math.max(x0 + 1, Math.floor((ox + 1) * w / ow));
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = pal[fb[y * w + x] & 15];
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const cnt = (y1 - y0) * (x1 - x0), o = (oy * ow + ox) * 4;
      out[o] = Math.floor((2 * r + cnt) / (2 * cnt));
      out[o + 1] = Math.floor((2 * g + cnt) / (2 * cnt));
      out[o + 2] = Math.floor((2 * b + cnt) / (2 * cnt));
      out[o + 3] = 255;
    }
  }
  return out;
}

// con: una console (runFrame(), fb, keyRows). Non tocca altro. step(n) esegue al piu' n fotogrammi.
class PreviewRun {
  constructor(con, opts) {
    this.con = con;
    this.frame = 0;
    this.done = false;
    this.total = SCRIPT.total;
    this.best = null; this.bestStats = null; this.bestScore = -1; this.bestFrame = -1;
    this.pal = (opts && opts.palette) || PALETTE;
  }
  _sample(fr) {
    const con = this.con;
    const st = frameStats(con.fb), sc = frameScore(st);
    if (sc > this.bestScore) { this.bestScore = sc; this.bestStats = st; this.best = con.fb.slice(); this.bestFrame = fr; }
    return st;
  }
  step(n) {
    const con = this.con;
    for (let i = 0; i < n && !this.done; i++) {
      const fr = this.frame;
      con.keyRows.fill(0);
      if (fr < SCRIPT.total) {
        if (fr >= SCRIPT.pressFrom && fr < SCRIPT.pressTo) con.keyRows.fill(1);
      } else {
        const k = SCRIPT.keys[Math.floor((fr - SCRIPT.total) / SCRIPT.perKey)], s = (fr - SCRIPT.total) % SCRIPT.perKey;
        if (s < SCRIPT.keyPress) con.keyRows[k >> 3] |= 1 << (k & 7);
      }
      con.runFrame();
      this.frame++;
      if (fr < SCRIPT.total) {
        if (fr >= SCRIPT.sampleFrom && (fr - SCRIPT.sampleFrom) % SCRIPT.sampleEvery === 0) {
          if (isRichStats(this._sample(fr))) this.done = true;
        }
        if (!this.done && this.frame >= SCRIPT.total) {
          // fine della prima fase: se lo schermo e' ancora quasi vuoto si provano i tasti, uno alla volta
          if (this.bestStats && !isPoorStats(this.bestStats)) this.done = true;
          else this.total = SCRIPT.total + SCRIPT.keys.length * SCRIPT.perKey;
        }
      } else {
        if ((fr - SCRIPT.total) % SCRIPT.keySampleEvery === SCRIPT.keySampleAt) {
          if (!isPoorStats(this._sample(fr))) this.done = true;
        }
        if (this.frame >= this.total) this.done = true;
      }
    }
    return this.done;
  }
  // {rgba, w, h, blank, score, frame}: da chiamare a esecuzione finita
  result() {
    if (!this.done) throw new Error('anteprima non finita');
    const blank = !this.best || isBlankStats(this.bestStats);
    const fb = this.best || new Uint8Array(VIS_W * VIS_H);
    return {rgba: downscale(fb, this.pal, VIS_W, VIS_H, PV_W, PV_H), w: PV_W, h: PV_H, blank, score: this.bestScore, frame: this.bestFrame};
  }
}

module.exports = {SCRIPT, KEYS, PV_W, PV_H, frameStats, frameScore, isBlankStats, isPoorStats, isRichStats, downscale, PreviewRun};
