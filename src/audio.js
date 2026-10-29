'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// audio.js - dal livello di uscita del suono del chip video (vdc.js: sndHook(ciclo, livello 0..15)) ai campioni PCM mono.
// Il campionamento dipende SOLO dal tempo emulato (cicli macchina dell'8048), mai dall'orologio del browser: lo stesso stato e gli
// stessi ingressi danno gli stessi campioni, anche dopo salvaStato / caricaStato (prova di ripresa deterministica in test/test_audio.js).
//
// Modello: l'uscita e' un'onda a gradini (livello costante fra un cambio e l'altro). Ogni campione e' la MEDIA del livello
// sull'intervallo di tempo che gli corrisponde (filtro a scatola: nessun aliasing dovuto al campionamento di un'onda quadra, a costo
// di una leggera attenuazione degli acuti). Livello 0..15 -> ampiezza lineare da 0 a AMP (DA VERIFICARE: la macchina vera ha un'uscita
// a un bit con volume; qui il volume e' lineare). Nessun filtro passa-alto: la componente continua e' il livello stesso.
//
// Uso:
//   const a = new Audio(vdc, cyclesPerSecond, sampleRate);   // aggancia vdc.sndHook
//   ... console.runFrame(); a.advance(console.cpu.now); const pcm = a.take();   // Float32Array dei campioni nuovi
//   a.saveState() / a.loadState(s)    stato dell'integrazione (posizione nel tempo, livello, parte di campione in corso)
//   a.restart(ciclo)                  riparte dal ciclo dato (dopo un reset della console o il caricamento di uno stato di gioco)

const AMP = 0.5;
const K = AMP / 15;

function chk(v, lo, hi, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error('stato non valido: ' + name);
  return v;
}

class Audio {
  // vdc: oggetto con level() e sndHook; cyclesPerSecond: cicli macchina al secondo (PAL ~ 394099, NTSC ~ 357954); rate: campioni/s
  constructor(vdc, cyclesPerSecond, rate) {
    if (!(rate >= 8000 && rate <= 192000)) throw new Error('frequenza di campionamento non valida: ' + rate);
    if (!(cyclesPerSecond > 1000)) throw new Error('cicli al secondo non validi');
    this.vdc = vdc;
    this.rate = rate;
    this.cps = cyclesPerSecond;
    this.spc = rate / cyclesPerSecond;          // campioni per ciclo macchina
    this.buf = new Float32Array(4096);
    this.len = 0;
    this.pos = 0;                               // ciclo fino al quale si e' integrato
    this.level = vdc.level();                   // livello corrente (0..15)
    this.frac = 0;                              // parte del campione in corso gia' trascorsa (0 <= frac < 1)
    this.sum = 0;                               // integrale (livello x parte) del campione in corso
    this.hook = (cyc, lvl) => { this.advance(cyc); this.level = lvl; };
    vdc.sndHook = this.hook;
  }

  detach() {
    if (this.vdc.sndHook === this.hook) this.vdc.sndHook = null;
  }

  push(v) {
    if (this.len >= this.buf.length) {
      const n = new Float32Array(this.buf.length * 2);
      n.set(this.buf);
      this.buf = n;
    }
    this.buf[this.len++] = v;
  }

  // integra il livello corrente dal ciclo 'pos' al ciclo 'to' (se to <= pos non fa niente)
  advance(to) {
    if (!(to > this.pos)) return;
    const L = this.level * K;
    let rem = (to - this.pos) * this.spc;      // campioni (in generale con parte frazionaria) coperti dall'intervallo
    this.pos = to;
    if (this.frac + rem < 1) {
      this.sum += L * rem;
      this.frac += rem;
      return;
    }
    const first = 1 - this.frac;
    this.push(this.sum + L * first);
    rem -= first;
    const n = Math.floor(rem);
    for (let i = 0; i < n; i++) this.push(L);
    this.frac = rem - n;
    this.sum = L * this.frac;
  }

  // campioni prodotti dall'ultima chiamata (copia); svuota la coda
  take() {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }

  restart(cyc) {
    this.pos = cyc;
    this.level = this.vdc.level();
    this.frac = 0;
    this.sum = 0;
    this.len = 0;
  }

  saveState() {
    return {rate: this.rate, pos: this.pos, level: this.level, frac: this.frac, sum: this.sum};
  }

  loadState(s) {
    if (!s || typeof s !== 'object') throw new Error('stato non valido: audio');
    const n = {rate: chk(s.rate, 8000, 192000, 'frequenza audio'), pos: chk(s.pos, 0, Number.MAX_SAFE_INTEGER, 'posizione audio'),
      level: chk(s.level, 0, 15, 'livello audio'), frac: chk(s.frac, 0, 1, 'audio: frazione'), sum: chk(s.sum, 0, 1, 'audio: somma')};
    if (!Number.isInteger(n.level) || !Number.isInteger(n.pos)) throw new Error('stato non valido: audio');
    if (n.frac >= 1) throw new Error('stato non valido: audio: frazione');
    if (n.rate !== this.rate) throw new Error('stato audio con un’altra frequenza di campionamento');
    this.pos = n.pos; this.level = n.level; this.frac = n.frac; this.sum = n.sum;
    this.len = 0;
  }
}

// Passo di temporizzazione quando l'audio guida il tempo: quanti fotogrammi emulare adesso perche' la coda audio resti vicina a
// 'lead' secondi (funzione pura). queued: secondi di audio gia' in coda; period: durata di un fotogramma in secondi; maxFrames: tetto.
function framesToRun(queued, lead, period, maxFrames) {
  if (!(period > 0)) return 0;
  const n = Math.ceil((lead - queued) / period - 1e-9);
  return Math.max(0, Math.min(maxFrames, n));
}

module.exports = {Audio, framesToRun, AMP};
