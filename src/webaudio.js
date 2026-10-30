'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// webaudio.js - uscita sonora nel browser (Web Audio): i campioni PCM mono prodotti da audio.js si programmano uno dopo l'altro come
// tanti AudioBuffer, senza buchi e senza sovrapposizioni. Nessun worklet: bastano le sorgenti a buffer. L'oggetto e' separato dal
// campionamento (audio.js, deterministico) proprio perche' qui entra l'orologio del browser: serve solo a sapere quanto audio e'
// in coda (queued()) per far correre l'emulazione al passo dell'audio (framesToRun in audio.js).
//   new AudioOutput({Ctx, lead})   Ctx: costruttore AudioContext (iniettabile nelle prove); lead: anticipo minimo in secondi
//   start()      crea/riprende il contesto (da chiamare in un gesto dell'utente: criteri di riproduzione automatica); ritorna la frequenza
//   push(pcm)    programma un blocco di campioni (Float32Array) subito dopo quello precedente
//   queued()     secondi di audio programmati e non ancora suonati
//   flush()      annulla l'audio in coda (cambio di gioco, reset, carico di uno stato)
//   setVolume(v) 0..1;  setMuted(b);  suspend() / resume();  close()
// Filtro passa-alto a 20 Hz in uscita (solo nella riproduzione, non nel campionamento): toglie la componente continua del livello,
// come l'accoppiamento in alternata dell'altoparlante della macchina vera (DA VERIFICARE: l'uscita reale non e' misurata).

class AudioOutput {
  constructor(opts) {
    opts = opts || {};
    this.Ctx = opts.Ctx || null;
    this.lead = opts.lead === undefined ? 0.03 : opts.lead;
    this.ctx = null;
    this.gain = null;
    this.next = 0;                        // istante (del contesto) in cui finisce l'audio gia' programmato
    this.sources = new Set();
    this.volume = 1;
    this.muted = false;
    this.underruns = 0;
    this.pushed = 0;
    this.error = '';
    this.fresh = true;
  }

  get available() { return !!this.Ctx; }
  get rate() { return this.ctx ? this.ctx.sampleRate : 0; }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  start() {
    if (!this.Ctx) throw new Error('l’audio del browser non e’ disponibile');
    if (!this.ctx) {
      this.ctx = new this.Ctx({latencyHint: 'interactive'});
      this.gain = this.ctx.createGain();
      let tail = this.gain;
      if (this.ctx.createBiquadFilter) {
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 20;
        this.gain.connect(hp);
        tail = hp;
      }
      tail.connect(this.ctx.destination);
      this._applyGain();
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch((e) => { this.error = String(e && e.message || e); });
    }
    return this.ctx.sampleRate;
  }

  _applyGain() {
    if (!this.gain) return;
    const v = this.muted ? 0 : this.volume;
    if (this.gain.gain.setTargetAtTime) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    else this.gain.gain.value = v;
  }
  setVolume(v) {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new Error('volume non valido');
    this.volume = v;
    this._applyGain();
  }
  setMuted(b) { this.muted = !!b; this._applyGain(); }

  queued() {
    if (!this.ctx) return 0;
    return Math.max(0, this.next - this.ctx.currentTime);
  }

  push(pcm) {
    if (!this.ctx || !pcm.length) return;
    const now = this.ctx.currentTime;
    if (this.next < now + this.lead * 0.5) {          // coda esaurita (o primo blocco): si riparte con un piccolo anticipo
      if (this.pushed > 0 && !this.fresh) this.underruns++;
      this.next = now + this.lead;
    }
    this.fresh = false;
    const buf = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
    if (buf.copyToChannel) buf.copyToChannel(pcm, 0); else buf.getChannelData(0).set(pcm);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const set = this.sources;
    src.onended = () => { set.delete(src); };
    set.add(src);
    src.start(this.next);
    this.next += pcm.length / this.ctx.sampleRate;
    this.pushed += pcm.length;
  }

  flush() {
    for (const s of this.sources) {
      try { s.onended = null; s.stop(); } catch (e) { /* gia' finita */ }
      try { s.disconnect(); } catch (e) { /* niente */ }
    }
    this.sources.clear();
    this.next = this.ctx ? this.ctx.currentTime : 0;
    this.fresh = true;                     // dopo un flush la ripartenza non e' un'esaurimento della coda
  }

  suspend() { if (this.ctx && this.ctx.suspend) { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } }
  resume() { if (this.ctx && this.ctx.resume) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } }
  close() {
    this.flush();
    if (this.ctx && this.ctx.close) { const p = this.ctx.close(); if (p && p.catch) p.catch(() => {}); }
    this.ctx = null; this.gain = null;
  }
}

module.exports = {AudioOutput};
