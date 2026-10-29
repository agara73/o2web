'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// look.js - lo STRATO DI ASPETTO. Lavora solo sull'uscita, DOPO il fotogramma del chip video (360 x 243 indici di colore 0..15): il
// nucleo, la console, il video e i loro test dei pixel non lo conoscono. Con tutto spento (schermo a colori, nessun filtro) l'uscita
// e' ESATTAMENTE quella di prima: la tabella dei colori applicata a ogni indice. Filtri e bianco e nero sono facoltativi, spenti di default.
//
// Specifica (tutta l'aritmetica dei pixel e' intera; i soli numeri in virgola mobile sono le posizioni della curvatura e i pesi di
// maschera e righe, calcolati con le stesse operazioni, nello stesso ordine, in hw/look_ref.py: stessi risultati al bit).
//
//  0. Colori. Schermo a colori: la palette del chip. «Monitor in bianco e nero» (Videopac G7200): a ogni colore corrisponde un grigio
//     Y = (77 R + 150 G + 29 B + 128) >> 8 (luminanza standard, pesi 0,299 / 0,587 / 0,114 a 8 bit). DA VERIFICARE: i livelli di
//     grigio veri di quel monitor (qui si usa la luminanza standard).
//  1. Sfocatura del segnale (blur 0..100, orizzontale): lato = floor(blur * 64 / 100), centro = 256 - 2 lato;
//     out = (lato (sx + dx) + centro c + 128) >> 8, per canale, con il pixel di bordo ripetuto.
//  2. Persistenza del fosforo (persist 0..90 = % di luce che resta dopo un fotogramma): out = max(in, floor(prima * persist / 100)),
//     dove «prima» e' l'uscita di questo passo al fotogramma precedente (memoria per canale). persist = 0 azzera la memoria.
//  3. Alone (glow 0..100): G = media (arrotondata) su un quadrato 7 x 7 del risultato del passo 2 (bordo ripetuto);
//     out = min(255, in + floor((G glow 3 + 200) / 400)). La memoria della persistenza NON contiene l'alone.
//  4. Righe, maschera e curvatura (scan, mask, curve 0..100): se almeno una e' accesa l'uscita ha k x k pixel per punto (k = dettaglio,
//     3 o 4); per ogni pixel di uscita (X, Y), con u = (X + 0,5) / (w k) * 2 - 1 e v = (Y + 0,5) / (h k) * 2 - 1:
//       curvatura: ks = (curve / 100) * 0,25; su = u (1 + ks v v), sv = v (1 + ks u u); fuori da [-1, 1] = nero (angoli smussati);
//       senza curvatura su = u, sv = v. Posizione nel fotogramma: sx = (su + 1) 0,5 w, sy = (sv + 1) 0,5 h; punto (ix, iy) = parte intera
//       (al piu' w-1, h-1) e fy = sy - iy (campionamento «al piu' vicino»).
//       righe: d = |2 fy - 1|, peso = 1 - (scan / 100) d d  (la riga di scansione e' quella del fotogramma: con la curvatura si piega).
//       maschera: sottocolonna s = X mod k; il canale c (0 R, 1 G, 2 B) e' acceso se s = c, altrimenti vale off = (256 - floor(mask 140 / 100)) / 256
//       (con k = 4 la quarta sottocolonna e' un vuoto: tutti i canali a off).
//       compensazione: guadagno = min(1,5, 1 / (mediaRighe mediaMaschera)) con mediaRighe = 1 - (scan / 100) / 3 e
//       mediaMaschera = (1 + (k - 1) off) / k (1 se spente), cosi' la luminosita' media resta circa quella di prima.
//       peso del canale = floor(guadagno peso fattore 256 + 0,5) (intero a 8 bit di frazione); out = min(255, (c peso + 128) >> 8).
//  Tutti i filtri sono funzioni pure sul fotogramma (la persistenza ha la sua memoria): si provano contro un'implementazione
//  indipendente in Python (hw/look_ref.py, test/look_record.py + test/test_look.js).
//
// API:
//   checkLook(o) / normalizeLook(o) / presetOf(look) / isExact(look) / outScale(look)   impostazioni: validazione e confronti
//   nextPreset(look, custom)                                                             il passo successivo del pulsante «Filtri CRT»
//   grayOf(r, g, b), monoPalette(palette)                                                B/N
//   buildPlan(w, h, k, scan, mask, curve)                                                tabelle del passo 4 (puro)
//   class LookPipeline(palette, w, h): configure(look), reset(), process(fb, out) -> Uint32Array RGBA (little-endian), outW, outH, k
const {PALETTE, VIS_W, VIS_H} = require('./vdc.js');

class LookError extends Error {}

// saturazione a 255 per i valori 0..511 (il peso massimo e' 1,5: (255 * 384 + 128) >> 8 = 382)
const SAT = new Uint8Array(512);
for (let i = 0; i < 512; i++) SAT[i] = i > 255 ? 255 : i;

const LOOK_DEFAULTS = Object.freeze({mono: false, blur: 0, persist: 0, glow: 0, scan: 0, mask: 0, curve: 0, detail: 3});
const RANGES = {blur: [0, 100], persist: [0, 90], glow: [0, 100], scan: [0, 100], mask: [0, 100], curve: [0, 100]};
const DETAILS = [3, 4];
const NAMES = {mono: 'bianco e nero', blur: 'sfocatura del segnale', persist: 'persistenza del fosforo', glow: 'alone', scan: 'righe di scansione',
  mask: 'maschera', curve: 'curvatura', detail: 'dettaglio'};
const FILTER_KEYS = ['blur', 'persist', 'glow', 'scan', 'mask', 'curve'];

// Insiemi di valori pronti (solo i filtri: il bianco e nero e' una scelta a parte). 'esatto' = nessun filtro.
const PRESETS = {
  esatto: {blur: 0, persist: 0, glow: 0, scan: 0, mask: 0, curve: 0, detail: 3},
  leggero: {blur: 20, persist: 15, glow: 15, scan: 35, mask: 15, curve: 0, detail: 3},
  anni80: {blur: 40, persist: 35, glow: 35, scan: 55, mask: 30, curve: 35, detail: 3},
};

// controlla le impostazioni dell'aspetto: ritorna SOLO le chiavi presenti, convalidate (le chiavi sconosciute si ignorano)
function checkLook(o) {
  if (o === undefined) return {};
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new LookError('aspetto non valido');
  for (const k of Object.keys(o)) if (k !== 'mono' && k !== 'detail' && !FILTER_KEYS.includes(k)) throw new LookError('campo sconosciuto «' + k + '»');   // schema chiuso
  const r = {};
  if ('mono' in o) {
    if (typeof o.mono !== 'boolean') throw new LookError(NAMES.mono + ': valore non valido');
    r.mono = o.mono;
  }
  for (const k of FILTER_KEYS) {
    if (!(k in o)) continue;
    const v = o[k], rg = RANGES[k];
    if (!Number.isInteger(v) || v < rg[0] || v > rg[1]) throw new LookError(NAMES[k] + ': valore non valido');
    r[k] = v;
  }
  if ('detail' in o) {
    if (!DETAILS.includes(o.detail)) throw new LookError(NAMES.detail + ': valore non valido');
    r.detail = o.detail;
  }
  return r;
}
function normalizeLook(o) { return Object.assign({}, LOOK_DEFAULTS, checkLook(o)); }

function isExact(look) { return FILTER_KEYS.every((k) => !look[k]); }
// pixel di uscita per punto del fotogramma: 1 se il passo 4 e' spento, altrimenti il dettaglio
function outScale(look) { return look.scan || look.mask || look.curve ? look.detail : 1; }
// nome dell'insieme di valori pronto che corrisponde, oppure 'custom'
function presetOf(look) {
  if (isExact(look)) return 'esatto';
  for (const name of Object.keys(PRESETS)) {
    const p = PRESETS[name];
    if (FILTER_KEYS.every((k) => look[k] === p[k]) && look.detail === p.detail) return name;
  }
  return 'custom';
}

// Il pulsante «Filtri CRT» sotto lo schermo: passa all'insieme pronto successivo (nessun filtro -> leggero -> anni '80 -> il personalizzato messo da parte,
// se c'e' -> nessun filtro). Dal personalizzato si va a «nessun filtro». 'custom' = i filtri personalizzati di prima (oggetto con le chiavi dei filtri e il
// dettaglio): vale solo se e' valido e non coincide con un insieme pronto. Ritorna {name, look}: look = SOLO filtri e dettaglio, copiati (il B/N non si tocca).
// solo i filtri e il dettaglio di un aspetto (copia): quello che un insieme pronto o un personalizzato mette da parte
function pickFilters(o) { const r = {}; for (const k of FILTER_KEYS.concat(['detail'])) r[k] = o[k]; return r; }
function nextPreset(look, custom) {
  const pick = pickFilters;
  let memo = null;
  if (custom) {
    try { const c = normalizeLook(custom); if (presetOf(c) === 'custom') memo = pick(c); } catch (e) { if (!(e instanceof LookError)) throw e; }
  }
  const cur = presetOf(look);
  let name = 'esatto';
  if (cur === 'esatto') name = 'leggero';
  else if (cur === 'leggero') name = 'anni80';
  else if (cur === 'anni80' && memo) name = 'custom';
  return {name, look: name === 'custom' ? memo : pick(PRESETS[name])};
}

// ---- passo 0: grigi
function grayOf(r, g, b) { return (77 * r + 150 * g + 29 * b + 128) >> 8; }
function monoPalette(palette) {
  return palette.map((c) => { const y = grayOf(c[0], c[1], c[2]); return [y, y, y]; });
}

// ---- passo 4: tabelle (una volta per combinazione di parametri; per pixel di uscita: punto di partenza e tre pesi)
function buildPlan(w, h, k, scan, mask, curve) {
  const W = w * k, H = h * k, n = W * H;
  const srcIdx = new Int32Array(n);
  const wt = new Uint16Array(n * 3);
  const ks = (curve / 100) * 0.25;
  const sc = scan / 100;
  const off = (256 - Math.floor(mask * 140 / 100)) / 256;
  const meanScan = scan > 0 ? 1 - sc / 3 : 1;
  const meanMask = mask > 0 ? (1 + (k - 1) * off) / k : 1;
  let gain = 1 / (meanScan * meanMask);
  if (gain > 1.5) gain = 1.5;
  let o = 0;
  for (let Y = 0; Y < H; Y++) {
    const v = (Y + 0.5) / H * 2 - 1;
    for (let X = 0; X < W; X++, o++) {
      const u = (X + 0.5) / W * 2 - 1;
      let su = u, sv = v;
      if (curve > 0) { su = u * (1 + ks * v * v); sv = v * (1 + ks * u * u); }
      if (su > 1 || su < -1 || sv > 1 || sv < -1) { srcIdx[o] = -1; continue; }
      const sx = (su + 1) * 0.5 * w, sy = (sv + 1) * 0.5 * h;
      let ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix > w - 1) ix = w - 1;
      if (iy > h - 1) iy = h - 1;
      const d = Math.abs(2 * (sy - iy) - 1);
      const ws = 1 - sc * d * d;
      const s = X % k;
      srcIdx[o] = iy * w + ix;
      for (let c = 0; c < 3; c++) {
        const mf = mask > 0 && s !== c ? off : 1;
        wt[o * 3 + c] = Math.floor(gain * ws * mf * 256 + 0.5);
      }
    }
  }
  let maxW = 0;
  for (let i = 0; i < wt.length; i++) if (wt[i] > maxW) maxW = wt[i];
  return {srcIdx, wt, w: W, h: H, maxW};
}

class LookPipeline {
  // palette: 16 colori [r, g, b]; w, h: dimensioni del fotogramma (360 x 243 se omesse)
  constructor(palette, w, h) {
    this.w = w || VIS_W;
    this.h = h || VIS_H;
    this.n = this.w * this.h;
    const pal = palette || PALETTE;
    if (!Array.isArray(pal) || pal.length !== 16) throw new Error('la palette deve avere 16 colori');
    this.palette = pal.map((c) => [c[0] & 255, c[1] & 255, c[2] & 255]);
    this.cur = new Uint8Array(this.n * 3);
    this.tmp = new Uint8Array(this.n * 3);
    this.prev = new Uint8Array(this.n * 3);
    this.sums = new Int32Array(this.n * 3);
    this.colSum = new Int32Array(this.w * 3);
    this.decay = new Uint8Array(256);
    this.glowAdd = new Uint8Array(256);
    this.plan = null;
    this.planKey = '';
    this.look = Object.assign({}, LOOK_DEFAULTS);
    this._palette();
  }

  _palette() {
    const pal = this.look.mono ? monoPalette(this.palette) : this.palette;
    this.pal = pal;
    this.pal32 = new Uint32Array(16);
    for (let i = 0; i < 16; i++) this.pal32[i] = (0xFF000000 | (pal[i][2] << 16) | (pal[i][1] << 8) | pal[i][0]) >>> 0;
  }

  // l'insieme dei valori si passa intero o parziale (le chiavi mancanti valgono i valori di partenza); i valori sbagliati lanciano LookError
  configure(look) {
    const l = normalizeLook(look);
    const monoChanged = l.mono !== this.look.mono;
    this.look = l;
    if (monoChanged) this._palette();
    if (!l.persist) this.prev.fill(0);
    for (let v = 0; v < 256; v++) {
      this.decay[v] = Math.floor(v * l.persist / 100);                                     // passo 2: quanto resta di una luce v
      this.glowAdd[v] = Math.floor((v * l.glow * 3 + 200) / 400);                          // passo 3: quanto si somma per una media v
    }
    if (outScale(l) > 1) {
      const key = [this.w, this.h, l.detail, l.scan, l.mask, l.curve].join(',');
      if (key !== this.planKey) { this.plan = buildPlan(this.w, this.h, l.detail, l.scan, l.mask, l.curve); this.planKey = key; }
    } else { this.plan = null; this.planKey = ''; }
    return l;
  }

  get k() { return outScale(this.look); }
  get outW() { return this.w * this.k; }
  get outH() { return this.h * this.k; }
  reset() { this.prev.fill(0); }

  // fb: indici di colore (w x h). out: Uint32Array outW x outH facoltativo (altrimenti se ne crea uno). Ritorna out.
  process(fb, out) {
    const k = this.k, look = this.look, n = this.n, w = this.w, h = this.h;
    if (!(fb instanceof Uint8Array) || fb.length !== n) throw new Error('fotogramma di dimensione sbagliata');
    const need = this.outW * this.outH;
    if (!out) out = new Uint32Array(need);
    else if (out.length !== need) throw new Error('uscita di dimensione sbagliata');
    // schermo a colori o B/N senza filtri: solo la tabella dei colori (uscita esatta)
    if (isExact(look)) {
      const p32 = this.pal32;
      for (let i = 0; i < n; i++) out[i] = p32[fb[i] & 15];
      return out;
    }
    let cur = this.cur, tmp = this.tmp;
    const pal = this.pal;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const c = pal[fb[i] & 15];
      cur[j] = c[0]; cur[j + 1] = c[1]; cur[j + 2] = c[2];
    }
    const rowLen = w * 3;
    // 1. sfocatura orizzontale
    if (look.blur > 0) {
      const side = Math.floor(look.blur * 64 / 100), center = 256 - 2 * side;
      for (let y = 0; y < h; y++) {
        const row = y * rowLen;
        for (let x = 0, j = row; x < w; x++, j += 3) {
          const l = x > 0 ? j - 3 : j, r = x < w - 1 ? j + 3 : j;
          tmp[j] = (side * (cur[l] + cur[r]) + center * cur[j] + 128) >> 8;
          tmp[j + 1] = (side * (cur[l + 1] + cur[r + 1]) + center * cur[j + 1] + 128) >> 8;
          tmp[j + 2] = (side * (cur[l + 2] + cur[r + 2]) + center * cur[j + 2] + 128) >> 8;
        }
      }
      const t = cur; cur = tmp; tmp = t;
    }
    // 2. persistenza
    if (look.persist > 0) {
      const prev = this.prev, decay = this.decay;
      for (let i = 0, m = n * 3; i < m; i++) {
        const d = decay[prev[i]];
        const v = cur[i] > d ? cur[i] : d;
        cur[i] = v;
        prev[i] = v;
      }
    }
    // 3. alone: media 7 x 7 con il bordo ripetuto, a somme scorrevoli (stesse somme intere di una media diretta: finestra x-3..x+3 con gli indici
    //    portati dentro il fotogramma, che entra e esce un indice alla volta); poi somma al risultato del passo 2
    if (look.glow > 0) {
      const hs = this.sums, col = this.colSum, glowAdd = this.glowAdd;
      for (let y = 0; y < h; y++) {
        const row = y * rowLen;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let d = -3; d <= 3; d++) sum += cur[row + (d < 0 ? 0 : d > w - 1 ? w - 1 : d) * 3 + c];
          for (let x = 0; x < w; x++) {
            hs[row + x * 3 + c] = sum;
            const add = x + 4 > w - 1 ? w - 1 : x + 4, sub = x - 3 < 0 ? 0 : x - 3;
            sum += cur[row + add * 3 + c] - cur[row + sub * 3 + c];
          }
        }
      }
      col.fill(0);
      for (let d = -3; d <= 3; d++) {
        const row = (d < 0 ? 0 : d > h - 1 ? h - 1 : d) * rowLen;
        for (let i = 0; i < rowLen; i++) col[i] += hs[row + i];
      }
      for (let y = 0; y < h; y++) {
        const row = y * rowLen;
        for (let i = 0; i < rowLen; i++) {
          const v = cur[row + i] + glowAdd[(((col[i] + 24) * 21400) >> 20)];
          tmp[row + i] = v > 255 ? 255 : v;
        }
        const add = (y + 4 > h - 1 ? h - 1 : y + 4) * rowLen, sub = (y - 3 < 0 ? 0 : y - 3) * rowLen;
        for (let i = 0; i < rowLen; i++) col[i] += hs[add + i] - hs[sub + i];
      }
      const t = cur; cur = tmp; tmp = t;
    }
    // 4. uscita
    if (k === 1) {
      for (let i = 0, j = 0; i < n; i++, j += 3) out[i] = (0xFF000000 | (cur[j + 2] << 16) | (cur[j + 1] << 8) | cur[j]) >>> 0;
      return out;
    }
    const plan = this.plan, si = plan.srcIdx, wt = plan.wt;
    if (plan.maxW <= 256) {                              // nessun guadagno: il risultato non supera mai il valore di partenza, niente saturazione
      for (let o = 0, q = 0; o < need; o++, q += 3) {
        const s = si[o];
        if (s < 0) { out[o] = 0xFF000000; continue; }
        const b = s * 3;
        out[o] = (0xFF000000 | ((((cur[b + 2] * wt[q + 2] + 128) >> 8) << 16) | (((cur[b + 1] * wt[q + 1] + 128) >> 8) << 8) | ((cur[b] * wt[q] + 128) >> 8))) >>> 0;
      }
      return out;
    }
    const sat = SAT;                                     // con il guadagno il valore puo' arrivare a 382: tabella di saturazione (senza salti)
    for (let o = 0, q = 0; o < need; o++, q += 3) {
      const s = si[o];
      if (s < 0) { out[o] = 0xFF000000; continue; }
      const b = s * 3;
      out[o] = (0xFF000000 | (sat[(cur[b + 2] * wt[q + 2] + 128) >> 8] << 16) | (sat[(cur[b + 1] * wt[q + 1] + 128) >> 8] << 8) | sat[(cur[b] * wt[q] + 128) >> 8]) >>> 0;
    }
    return out;
  }
}

module.exports = {LookPipeline, LookError, LOOK_DEFAULTS, PRESETS, RANGES, DETAILS, FILTER_KEYS, checkLook, normalizeLook, presetOf, nextPreset, pickFilters, isExact, outScale,
  grayOf, monoPalette, buildPlan};
