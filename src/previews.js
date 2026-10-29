'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// previews.js - la CODA e la MEMORIA delle anteprime (tappa 7), senza DOM. Le miniature (preview.js) si calcolano solo per le righe che servono
// (quelle visibili), a fette di pochi millisecondi sul thread principale, e si tengono in memoria finche' non cambia qualcosa che le renderebbe
// diverse (BIOS, set di caratteri, standard, pin B). Un dump con lo stesso contenuto si calcola una volta sola. Mai sulla rete, mai nei file.
//   new PreviewCache({build(game) -> console | null, context() -> stringa, schedule(fn) -> handle, unschedule(handle), now(), onChange()})
//   cache.enabled        interruttore (spento: niente calcoli, get() ritorna null)
//   cache.get(game)      -> {state: 'ready' | 'blank' | 'error' | 'none', rgba, w, h} | null  (null = non ancora calcolata)
//   cache.request(games) -> mette in coda le anteprime che mancano, nell'ordine dato (sostituisce la coda precedente)
//   cache.stats()        -> {ready, blank, error, none, pending}
const {PreviewRun} = require('./preview.js');

const BUDGET_MS = 10;                // tempo massimo per fetta
const SLICE_FRAMES = 10;             // fotogrammi tra un controllo dell'orologio e l'altro
const MAX_ENTRIES = 2000;

class PreviewCache {
  constructor(opts) {
    this.build = opts.build;
    this.context = opts.context;
    this.schedule = opts.schedule;
    this.unschedule = opts.unschedule || (() => {});
    this.now = opts.now || (() => Date.now());
    this.budget = opts.budget || (() => BUDGET_MS);        // millisecondi per fetta (la pagina li riduce mentre si gioca)
    this.onChange = opts.onChange || (() => {});
    this.enabled = true;
    this.map = new Map();            // chiave (sha | contesto) -> risultato
    this.ctx = this.context();
    this.queue = [];                 // giochi da fare, in ordine
    this.cur = null;                 // {game, key, run}
    this.timer = null;
  }

  _key(g) { return g.sha + '|' + this.ctx; }
  _sync() {                          // il contesto e' cambiato: le miniature vecchie non valgono piu'
    const c = this.context();
    if (c === this.ctx) return;
    this.ctx = c;
    this.map.clear();
    this.cur = null;
    this.queue = [];
    if (this.timer !== null) { this.unschedule(this.timer); this.timer = null; }
  }

  get(g) {
    if (!this.enabled) return null;
    this._sync();
    return this.map.get(this._key(g)) || null;
  }

  request(games) {
    this._sync();
    if (!this.enabled) { this.cancel(); return; }
    const seen = new Set(), q = [];
    for (const g of games) {
      const k = this._key(g);
      if (seen.has(k) || this.map.has(k)) continue;
      seen.add(k);
      if (this.cur && this.cur.key === k) continue;                  // e' quella in corso
      q.push(g);
    }
    this.queue = q;
    if (this.cur && !seen.has(this.cur.key)) this.cur = null;     // la riga non serve piu': si lascia perdere
    if ((this.queue.length || this.cur) && this.timer === null) this.timer = this.schedule(() => this._tick());
  }

  cancel() {
    this.queue = [];
    this.cur = null;
    if (this.timer !== null) { this.unschedule(this.timer); this.timer = null; }
  }

  _finish(g, key, res) {
    if (this.map.size >= MAX_ENTRIES) this.map.delete(this.map.keys().next().value);
    this.map.set(key, res);
    this.onChange(g, res);
  }

  _next() {
    while (this.queue.length) {
      const g = this.queue.shift();
      const key = this._key(g);
      if (this.map.has(key)) continue;
      if (!g.map || !g.map.ok) { this._finish(g, key, {state: 'none'}); continue; }
      let con = null;
      try { con = this.build(g); } catch (e) { con = null; }
      if (!con) { this._finish(g, key, {state: 'none'}); continue; }
      this.cur = {game: g, key, run: new PreviewRun(con)};
      return true;
    }
    return false;
  }

  _tick() {
    this.timer = null;
    this._sync();
    const t0 = this.now();
    const budget = this.budget();
    while (this.now() - t0 < budget) {
      if (!this.cur && !this._next()) break;
      const c = this.cur;
      try {
        if (c.run.step(SLICE_FRAMES)) {
          const r = c.run.result();
          this.cur = null;
          this._finish(c.game, c.key, {state: r.blank ? 'blank' : 'ready', rgba: r.rgba, w: r.w, h: r.h});
        }
      } catch (e) {
        this.cur = null;
        this._finish(c.game, c.key, {state: 'error'});
      }
    }
    if ((this.cur || this.queue.length) && this.timer === null) this.timer = this.schedule(() => this._tick());
  }

  stats() {
    this._sync();
    const s = {ready: 0, blank: 0, error: 0, none: 0, pending: this.queue.length + (this.cur ? 1 : 0)};
    for (const r of this.map.values()) s[r.state]++;
    return s;
  }
}

module.exports = {PreviewCache, BUDGET_MS, SLICE_FRAMES};
