'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_previews.js - coda e memoria delle anteprime (src/previews.js) con console finte, orologio finto e pianificatore a mano: stati, doppioni,
// cambio di contesto (BIOS, set, standard), sostituzione della richiesta, interruttore, fette di tempo, errori.
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const {PreviewCache} = require(SP('previews.js'));
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 25) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));

// console finta: disegna un quadro ricco dal fotogramma 170 (come un gioco vero), oppure resta vuota, oppure lancia un errore
function fake(kind, counter) {
  const con = {fb: new Uint8Array(360 * 243), keyRows: new Uint8Array(8), frames: 0, runFrame() {
    counter.frames++;
    if (kind === 'throw' && this.frames === 3) throw new Error('boom');
    if (kind === 'rich' && this.frames >= 160) for (let i = 0; i < 40000; i++) this.fb[i] = 1 + (i % 3);
    this.frames++;
  }};
  return con;
}
function setup(opts) {
  const st = {ctx: 'A', time: 0, queue: [], changes: [], counter: {frames: 0, builds: 0}, kinds: new Map(), budget: 10};
  const g = (sha, kinds) => ({sha, name: sha + '.bin', map: {ok: kinds !== 'unsupported'}, kind: kinds || 'rich'});
  st.g = g;
  st.cache = new PreviewCache({
    build: (x) => { st.counter.builds++; if (x.kind === 'nobios') return null; if (x.kind === 'buildthrows') throw new Error('x'); return fake(x.kind, st.counter); },
    context: () => st.ctx,
    schedule: (fn) => { const h = {fn, id: st.queue.length}; st.queue.push(h); return h; },
    unschedule: (h) => { const i = st.queue.indexOf(h); if (i >= 0) st.queue.splice(i, 1); },
    now: () => { st.time += (opts && opts.msPerCall) || 0; return st.time; },
    budget: () => st.budget,
    onChange: (x, r) => st.changes.push([x.sha, r.state]),
  });
  st.runAll = (max) => { let k = 0; while (st.queue.length && k++ < (max || 100000)) st.queue.shift().fn(); return k; };
  return st;
}

{
  const s = setup();
  const a = s.g('a'), b = s.g('b', 'blank'), c = s.g('c', 'unsupported'), d = s.g('d', 'nobios'), e = s.g('e', 'throw'), f = s.g('f', 'buildthrows');
  ok(s.cache.get(a) === null, 'prima di chiedere: nessuna anteprima');
  s.cache.request([a, b, c, d, e, f, a, b]);
  ok(s.queue.length === 1, 'una sola pianificazione');
  s.runAll();
  eq(s.cache.get(a).state, 'ready', 'a: pronta');
  ok(s.cache.get(a).rgba.length === 80 * 54 * 4 && s.cache.get(a).w === 80 && s.cache.get(a).h === 54, 'a: miniatura 80x54 RGBA');
  eq(s.cache.get(b).state, 'blank', 'b: vuota');
  eq(s.cache.get(c).state, 'none', 'c: cartuccia non supportata');
  eq(s.cache.get(d).state, 'none', 'd: console non costruibile (nessun BIOS)');
  eq(s.cache.get(e).state, 'error', 'e: errore durante l\'esecuzione');
  eq(s.cache.get(f).state, 'none', 'f: errore nella costruzione');
  eq(s.cache.stats(), {ready: 1, blank: 1, error: 1, none: 3, pending: 0}, 'statistiche');
  eq(s.changes.length, 6, 'una notifica per voce (nessun doppione): ' + JSON.stringify(s.changes));
  // un contenuto gia' fatto non si rifa'
  const before = s.counter.builds;
  s.cache.request([a, b]);
  ok(s.queue.length === 0 && s.counter.builds === before, 'gia\' in memoria: nessun lavoro');
  // stesso contenuto con un altro nome = stessa miniatura
  const a2 = {sha: 'a', name: 'altro.bin', map: {ok: true}, kind: 'rich'};
  ok(s.cache.get(a2) === s.cache.get(a), 'stesso SHA-256: stessa anteprima');
  // contesto cambiato: la memoria si svuota e si rifa'
  s.ctx = 'B';
  ok(s.cache.get(a) === null && s.cache.stats().ready === 0, 'contesto cambiato: memoria svuotata');
  s.cache.request([a]);
  s.runAll();
  eq(s.cache.get(a).state, 'ready', 'rifatta nel nuovo contesto');
}
{
  // fette di tempo: con 1 ms a chiamata e budget 3 ms ogni passo fa poco, ma alla fine tutto e' fatto
  const s = setup({msPerCall: 1});
  s.budget = 3;
  const gs = ['a', 'b', 'c', 'd'].map((x) => s.g(x));
  s.cache.request(gs);
  const steps = s.runAll();
  ok(steps > 4, 'a fette: piu\' di un passo (' + steps + ')');
  eq(s.cache.stats().ready, 4, 'a fette: tutte pronte');
  // quadro ricco: si ferma al primo campione ricco (fotogramma 170: 171 fotogrammi), non a 270
  ok(s.counter.frames <= 4 * 175 && s.counter.frames >= 4 * 171, 'uscita anticipata sui quadri ricchi (' + s.counter.frames + ' fotogrammi per 4 anteprime)');
}
{
  // la richiesta nuova sostituisce la vecchia; quella in corso che non serve piu' si lascia
  const s = setup();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => s.g(x));
  s.cache.request([a, b, c]);
  s.queue.shift().fn();                                    // un passo: parte, ma con budget 10 e ms=0 fa tutto... forziamo un budget piccolo
  s.cache.cancel();
  ok(s.queue.length === 0, 'cancel: nessuna pianificazione');
  const s2 = setup({msPerCall: 5});
  s2.budget = 6;
  const gs = ['a', 'b', 'c', 'd', 'e'].map((x) => s2.g(x));
  s2.cache.request(gs);
  s2.queue.shift().fn();
  ok(s2.cache.stats().pending > 0, 'dopo un passo corto resta lavoro');
  s2.cache.request([gs[4]]);                                // ora serve solo la quinta
  s2.runAll();
  const done = new Set(s2.changes.map((x) => x[0]));
  ok(done.has('e') && s2.cache.get(gs[4]).state === 'ready', 'la richiesta nuova viene fatta');
  ok(!done.has('d') && !done.has('c'), 'le righe non piu\' richieste non vengono calcolate (' + [...done] + ')');
  // richiedere di nuovo la stessa in corso non la mette due volte in coda
  const s3 = setup({msPerCall: 5});
  s3.budget = 6;
  const g3 = ['a', 'b'].map((x) => s3.g(x));
  s3.cache.request(g3);
  s3.queue.shift().fn();
  s3.cache.request(g3);
  s3.runAll();
  eq(s3.changes.length, 2, 'nessun doppione di notifiche');
}
{
  // il contesto cambia mentre un'anteprima e' in corso (tra una fetta e l'altra): il lavoro vecchio si butta e non finisce in memoria
  const s = setup({msPerCall: 5});
  s.budget = 6;
  const gs = ['a', 'b'].map((x) => s.g(x));
  s.cache.request(gs);
  s.queue.shift().fn();                                    // una fetta corta: a e' in corso
  ok(s.cache.stats().pending > 0, 'in corso');
  s.ctx = 'Z';
  s.runAll();
  ok(s.changes.length === 0 && [...s.cache.map.keys()].every((k) => k.endsWith('|Z')), 'contesto cambiato a meta\': niente risultati vecchi (' + JSON.stringify(s.changes) + ')');
  s.cache.request(gs);
  s.runAll();
  eq(s.cache.stats().ready, 2, 'rifatte nel contesto nuovo');
}
{
  // interruttore
  const s = setup();
  const a = s.g('a');
  s.cache.enabled = false;
  s.cache.request([a]);
  ok(s.queue.length === 0 && s.cache.get(a) === null, 'spento: niente calcoli e get() = null');
  s.cache.enabled = true;
  s.cache.request([a]);
  s.runAll();
  eq(s.cache.get(a).state, 'ready', 'riacceso: si calcola');
  s.cache.enabled = false;
  ok(s.cache.get(a) === null, 'spento: get() = null anche se in memoria');
  s.cache.enabled = true;
  ok(s.cache.get(a).state === 'ready', 'riacceso: la memoria c\'e\' ancora');
}
{
  // memoria limitata
  const s = setup();
  const gs = [];
  for (let i = 0; i < 2100; i++) gs.push({sha: 'x' + i, name: 'x', map: {ok: false}, kind: 'unsupported'});
  s.cache.request(gs);
  s.runAll();
  ok(s.cache.map.size <= 2000, 'memoria limitata (' + s.cache.map.size + ')');
  ok(s.cache.get(gs[2099]) && s.cache.get(gs[2099]).state === 'none', 'le piu\' recenti restano');
}
{
  // valori predefiniti: budget 10 ms e fette da 10 fotogrammi. Con 1 ms a ogni lettura dell'orologio una fetta fa esattamente 9 passi da 10 fotogrammi
  // (la lettura iniziale vale 1; si continua finche' l'orologio - 1 < 10, cioe' per le letture 2..10)
  const st = {ctx: 'A', time: 0, queue: [], frames: 0, unsched: 0};
  const cache = new PreviewCache({
    build: () => ({fb: new Uint8Array(360 * 243), keyRows: new Uint8Array(8), runFrame() { st.frames++; }}),
    context: () => st.ctx,
    schedule: (fn) => { const h = {fn}; st.queue.push(h); return h; },
    unschedule: (h) => { st.unsched++; const i = st.queue.indexOf(h); if (i >= 0) st.queue.splice(i, 1); },
    now: () => ++st.time,
  });
  eq(cache.stats(), {ready: 0, blank: 0, error: 0, none: 0, pending: 0}, 'memoria nuova: statistiche a zero');
  cache.cancel();
  ok(st.queue.length === 0 && st.unsched === 0, 'cancel() su una memoria nuova: niente da annullare');
  const g1 = {sha: 'p1', map: {ok: true}}, g2 = {sha: 'p2', map: {ok: true}};
  cache.request([g1, g2]);
  ok(st.queue.length === 1, 'una pianificazione');
  eq(cache.stats().pending, 2, 'in coda: due');
  st.queue.shift().fn();
  eq(st.frames, 90, 'budget e fetta predefiniti: 90 fotogrammi in un passo');
  eq(cache.stats().pending, 2, 'una in corso e una in coda: due da fare');
  ok(st.queue.length === 1, 'si e\' ripianificato');
  // annullare toglie la pianificazione e permette di pianificare di nuovo
  cache.cancel();
  ok(st.queue.length === 0 && st.unsched === 1, 'cancel(): pianificazione annullata davvero');
  eq(cache.stats().pending, 0, 'dopo cancel(): niente in coda');
  cache.request([g1]);
  ok(st.queue.length === 1, 'dopo cancel() si pianifica di nuovo');
  // cambio di contesto: annulla la pianificazione
  st.ctx = 'B';
  cache.get(g1);
  ok(st.queue.length === 0 && st.unsched === 2, 'contesto cambiato: pianificazione annullata');
  cache.request([g1]);
  ok(st.queue.length === 1, 'dopo il cambio di contesto si pianifica di nuovo');
}
console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
process.exit(bad ? 1 : 0);
