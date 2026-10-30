'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// pacer.js - quanti fotogrammi emulare a ogni chiamata del browser (tappa 8). Il ritmo lo da' l'OROLOGIO DELLA PAGINA (l'ora passata da
// requestAnimationFrame): il tempo di gioco non si perde mai, anche se l'audio va a vuoto (si sente un piccolo buco, il gioco non
// rallenta). L'audio da' solo una piccola correzione (al massimo CORR_MAX, impercettibile) per seguire la differenza fra l'orologio
// della pagina e quello dell'audio, cosi' la coda del suono non cresce e non si svuota col tempo.
// L'anticipo dell'audio (lead) si adatta al browser: si misura di quanto salta l'orologio dell'audio fra una chiamata e l'altra (alcuni
// telefoni lo fanno avanzare a blocchi di 85 ms e piu') e si tiene in coda JUMP_MARGIN volte quel salto piu' JUMP_EXTRA, fra LEAD_MIN e
// LEAD_MAX; il salto misurato cala piano (JUMP_DECAY a ogni chiamata) se il browser poi avanza a passi piu' piccoli.
// Solo logica pura (nessun DOM, nessun orologio proprio): si prova in Node (test/test_pacer.js) contro un riferimento scritto a parte
// in Python (hw/pacer_ref.py). Prima della tappa 8 il passo era guidato dalla coda dell'audio: su un telefono con l'orologio audio a
// blocchi di 85 ms il gioco andava a circa 35 fotogrammi al secondo invece di 50 (misura in o2web-stato.md).

const MAX_DT = 0.1;         // s: un intervallo piu' lungo fra due chiamate (scheda in secondo piano, pausa del browser) conta come 0,1 s
const MAX_FRAMES = 3;       // fotogrammi al massimo per chiamata (il resto resta in conto)
const MAX_OWED = 0.1;       // s di emulazione in arretrato al massimo: oltre si lascia perdere (non si "corre" per recuperare)
const LEAD_MIN = 0.06;      // s di audio in coda: minimo (come prima della tappa 8)
const LEAD_MAX = 0.5;       // s: massimo
const JUMP_MARGIN = 1.5;
const JUMP_EXTRA = 0.02;
const JUMP_CLAMP = 0.4;     // s: un salto dell'orologio audio piu' grande (audio fermo e ripartito) conta come 0,4 s
const JUMP_DECAY = 0.999;   // a ogni chiamata (a 60 al secondo: dimezza in circa 12 s)
const QAVG_K = 0.02;        // media mobile della coda dell'audio
const CORR_MAX = 0.005;     // correzione di velocita' massima: +-0,5%

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

class Pacer {
  constructor() { this.reset(); }

  // da chiamare all'avvio di un gioco, in pausa e dopo un reset: si riparte senza debiti; il salto misurato dell'audio resta
  // (e' una proprieta' del browser, non del gioco)
  reset() {
    this.last = null;
    this.acc = 0;
    this.dt = 0;
    this.audioT = null;
    this.qAvg = null;
    this.rate = 1;
    if (this.jump === undefined) this.jump = 0;
  }

  get lead() { return clamp(JUMP_MARGIN * this.jump + JUMP_EXTRA, LEAD_MIN, LEAD_MAX); }

  // ts: ora della chiamata in ms; period: secondi di un fotogramma; audio: null (niente audio attivo) oppure
  // {time: ora dell'orologio dell'audio in s, queued: s di audio in coda}. Ritorna i fotogrammi da emulare.
  step(ts, period, audio) {
    if (!Number.isFinite(ts) || !(period > 0)) return 0;
    this.dt = this.last === null ? 0 : clamp((ts - this.last) / 1000, 0, MAX_DT);
    this.last = ts;
    if (audio && Number.isFinite(audio.time) && Number.isFinite(audio.queued)) {
      let inc = 0;
      if (this.audioT !== null && audio.time > this.audioT) inc = Math.min(audio.time - this.audioT, JUMP_CLAMP);
      this.jump = Math.max(this.jump * JUMP_DECAY, inc);
      this.audioT = audio.time;
      this.qAvg = this.qAvg === null ? audio.queued : this.qAvg + QAVG_K * (audio.queued - this.qAvg);
      const lead = this.lead;
      this.rate = 1 + CORR_MAX * clamp((lead - this.qAvg) / lead, -1, 1);   // coda corta: un po' piu' veloce; lunga: un po' piu' lento
    } else {
      this.audioT = null;
      this.qAvg = null;
      this.rate = 1;
    }
    this.acc += this.dt * this.rate;
    let n = 0;
    while (this.acc >= period && n < MAX_FRAMES) { this.acc -= period; n++; }
    if (this.acc > MAX_OWED) this.acc = MAX_OWED;
    return n;
  }
}

module.exports = {Pacer, MAX_DT, MAX_FRAMES, MAX_OWED, LEAD_MIN, LEAD_MAX, JUMP_MARGIN, JUMP_EXTRA, JUMP_CLAMP, JUMP_DECAY, QAVG_K, CORR_MAX};
