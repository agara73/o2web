'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// screen.js - dal fotogramma del chip video (indici di colore 0..15, 360 x 243) ai pixel RGBA di un canvas. La conversione
// (fbToRgba) e' una funzione pura, provata in Node (test/test_misc.js); la classe Screen passa dallo strato di aspetto (look.js): con
// tutto spento (colori, nessun filtro) l'uscita e' identica a fbToRgba, e il canvas resta 360 x 243.
const {PALETTE, VIS_W, VIS_H} = require('./vdc.js');
const {LookPipeline, LOOK_DEFAULTS} = require('./look.js');

// tabella indice -> pixel RGBA a 32 bit (ordine di byte R, G, B, A in memoria, quindi little-endian: A<<24 | B<<16 | G<<8 | R)
function paletteRgba32(palette) {
  const t = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    const c = palette[i];
    t[i] = (0xFF000000 | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
  }
  return t;
}

function fbToRgba(fb, pal32, out32) {
  for (let i = 0, n = fb.length; i < n; i++) out32[i] = pal32[fb[i] & 15];
}

class Screen {
  constructor(canvas, palette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', {alpha: false});
    this.pipe = new LookPipeline(palette || PALETTE, VIS_W, VIS_H);
    this.pipe.configure(LOOK_DEFAULTS);
    this.last = null;                       // ultimo fotogramma (per ridisegnare quando cambia l'aspetto, anche in pausa)
    this.img = null;
    this.px = null;
    this._size();
  }
  // il canvas ha la dimensione dell'uscita (k x k pixel per punto con righe, maschera o curvatura); la dimensione sullo schermo la decide il CSS
  _size() {
    const w = this.pipe.outW, h = this.pipe.outH;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (!this.img || this.img.width !== w || this.img.height !== h) {
      this.img = this.ctx.createImageData(w, h);
      this.px = new Uint32Array(this.img.data.buffer);
    }
    if (this.canvas.classList) this.canvas.classList.toggle('smooth', this.pipe.k > 1);     // con i filtri a piu' pixel per punto si ingrandisce in modo morbido
  }
  setLook(look) {
    this.pipe.configure(look);
    this._size();
    if (this.last) this.paint(this.last);
  }
  resetLook() { this.pipe.reset(); }
  paint(fb) {
    this.last = fb;
    this.pipe.process(fb, this.px);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

module.exports = {Screen, fbToRgba, paletteRgba32};
