'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_webaudio.js - l'uscita Web Audio con un AudioContext finto: programmazione senza buchi ne' sovrapposizioni, coda, esaurimento,
// flush, volume e silenzio, errori. (Il suono vero lo prova il browser; qui si controlla la logica.)
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const {AudioOutput} = require(SP('webaudio.js'));

let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));

class FakeCtx {
  constructor(o) {
    this.opt = o; this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = {name: 'dest'};
    this.sources = []; this.closed = false; this.nodes = [];
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
  createGain() { const g = {gain: {value: 1, calls: [], setTargetAtTime(v, t, c) { this.calls.push([v, t, c]); }}, connect(n) { this.to = n; }}; this.nodes.push(g); return g; }
  createBiquadFilter() { const f = {type: '', frequency: {value: 0}, connect(n) { this.to = n; }}; this.nodes.push(f); return f; }
  createBuffer(ch, n, r) { const d = new Float32Array(n); return {length: n, sampleRate: r, getChannelData: () => d, copyToChannel(a) { d.set(a); }, data: d}; }
  createBufferSource() {
    const s = {buffer: null, started: null, stopped: false, connect(n) { this.to = n; }, disconnect() { this.disc = true; }, start(t) { this.started = t; }, stop() { this.stopped = true; }};
    this.sources.push(s);
    return s;
  }
}

const out = new AudioOutput({Ctx: FakeCtx});
ok(out.available && out.rate === 0 && out.queued() === 0 && !out.running, 'stato iniziale');
const rate = out.start();
ok(rate === 48000 && out.rate === 48000 && out.running, 'avvio');
const ctx = out.ctx;
ok(ctx.nodes[0].to === ctx.nodes[1] && ctx.nodes[1].type === 'highpass' && ctx.nodes[1].frequency.value === 20 && ctx.nodes[1].to === ctx.destination, 'catena guadagno -> passa-alto -> uscita');
out.start();
ok(out.ctx === ctx, 'secondo avvio: stesso contesto');

// primo blocco: parte con l'anticipo
const blk = (n, v) => new Float32Array(n).fill(v);
out.push(blk(960, 0.1));
ok(near(ctx.sources[0].started, 0.03), 'primo blocco con anticipo: ' + ctx.sources[0].started);
out.push(blk(960, 0.2));
out.push(blk(480, 0.3));
ok(near(ctx.sources[1].started, 0.03 + 0.02) && near(ctx.sources[2].started, 0.03 + 0.04), 'blocchi consecutivi senza buchi');
ok(near(out.queued(), 0.08), 'coda (con l\'anticipo): ' + out.queued());
ok(ctx.sources[0].buffer.data[0] === Math.fround(0.1) && ctx.sources[2].buffer.length === 480 && out.underruns === 0, 'contenuto e conteggio');
ctx.currentTime = 0.03;
ok(near(out.queued(), 0.05), 'coda dopo 30 ms: ' + out.queued());
// esaurimento
ctx.currentTime = 1;
ok(out.queued() === 0, 'coda vuota');
out.push(blk(480, 0.5));
ok(near(ctx.sources[3].started, 1.03) && out.underruns === 1, 'dopo l\'esaurimento si riparte: ' + ctx.sources[3].started + ', underruns ' + out.underruns);
// blocco vuoto: ignorato
out.push(new Float32Array(0));
ok(ctx.sources.length === 4, 'blocco vuoto ignorato');
// flush
out.push(blk(480, 0.5));
out.flush();
ok(ctx.sources[3].stopped && ctx.sources[4].stopped && out.sources.size === 0 && out.queued() === 0, 'flush');
out.push(blk(480, 0.5));
ok(near(ctx.sources[5].started, 1.03) && out.underruns === 1, 'dopo il flush riparte senza contare un esaurimento (' + ctx.sources[5].started + ')');
// fine di una sorgente: esce dall'insieme
const s5 = ctx.sources[5];
ok(out.sources.has(s5), 'sorgente in coda');
s5.onended();
ok(!out.sources.has(s5), 'sorgente finita tolta');
// volume e silenzio
out.setVolume(0.5);
ok(ctx.nodes[0].gain.calls.at(-1)[0] === 0.5, 'volume');
out.setMuted(true);
ok(ctx.nodes[0].gain.calls.at(-1)[0] === 0, 'silenzio');
out.setMuted(false);
ok(ctx.nodes[0].gain.calls.at(-1)[0] === 0.5, 'fine silenzio');
let t = false;
try { out.setVolume(2); } catch (e) { t = true; }
ok(t, 'volume fuori limite rifiutato');
t = false;
try { out.setVolume(NaN); } catch (e) { t = true; }
ok(t, 'volume NaN rifiutato');
// sospensione
out.suspend(); ok(ctx.state === 'suspended', 'sospeso');
out.resume(); ok(ctx.state === 'running', 'ripreso');
// chiusura
out.close();
ok(ctx.closed && out.ctx === null && out.queued() === 0, 'chiusura');
out.push(blk(10, 0));   // dopo la chiusura non fa niente
ok(true, 'push dopo la chiusura ignorato');
// senza audio nel browser
const none = new AudioOutput({});
ok(!none.available, 'non disponibile');
t = false;
try { none.start(); } catch (e) { t = /non e/.test(e.message); }
ok(t, 'start senza AudioContext: errore chiaro');
none.push(blk(10, 0)); none.flush(); none.setVolume(0.2); none.setMuted(true);
ok(none.queued() === 0, 'senza contesto non fa niente');


(async () => {
  // ---- valori iniziali
  const f = new AudioOutput({Ctx: FakeCtx});
  ok(f.ctx === null && f.gain === null && f.next === 0 && f.volume === 1 && f.muted === false && f.underruns === 0 && f.pushed === 0 && f.error === '' && f.fresh === true && f.sources.size === 0,
    'valori iniziali');
  ok(f.lead === 0.03 && new AudioOutput({Ctx: FakeCtx, lead: 0.1}).lead === 0.1 && new AudioOutput({Ctx: FakeCtx, lead: 0}).lead === 0, 'anticipo: default e dato');
  ok(new AudioOutput().available === false && new AudioOutput(null).available === false, 'senza opzioni');
  ok(f.volume === 1, 'volume pieno');
  f.start();
  ok(f.ctx.nodes[0].gain.calls.at(-1)[0] === 1 && f.ctx.nodes[0].gain.calls.at(-1)[2] === 0.01 && f.ctx.nodes[0].gain.calls.at(-1)[1] === 0, 'guadagno iniziale: pieno, costante 0,01 s');
  f.ctx.currentTime = 2.5; f.setVolume(0.25);
  ok(f.ctx.nodes[0].gain.calls.at(-1)[1] === 2.5 && f.ctx.nodes[0].gain.calls.at(-1)[0] === 0.25, 'il guadagno si programma all\'istante del contesto');
  ok(f.ctx.opt.latencyHint === 'interactive', 'latenza interattiva');
  // contesto gia' in esecuzione: nessun resume
  let resumes = 0;
  class RunCtx extends FakeCtx { constructor(o) { super(o); this.state = 'running'; } resume() { resumes++; return super.resume(); } }
  const r = new AudioOutput({Ctx: RunCtx}); r.start(); r.start();
  ok(resumes === 0, 'contesto gia\' in esecuzione: nessun resume');
  const s = new AudioOutput({Ctx: FakeCtx}); s.start(); s.start();
  // volume ai limiti
  for (const v of [0, 1, 0.5, 1e-9, 0.999999]) { let e = false; try { s.setVolume(v); } catch (x) { e = true; } ok(!e && s.volume === v, 'volume ' + v + ' accettato'); }
  for (const v of [-0.0001, 1.0001, -1, 2, NaN, Infinity, -Infinity, '0.5', null, undefined, {}, true]) {
    let e = null; const before = s.volume; try { s.setVolume(v); } catch (x) { e = x.message; }
    ok(e === 'volume non valido' && s.volume === before, 'volume ' + String(v) + ' rifiutato');
  }
  ok(s.volume === 1 || s.volume === 0.999999, 'volume invariato dopo i rifiuti');
  // contesto senza setTargetAtTime: valore diretto
  class NoTarget extends FakeCtx { createGain() { const g = {gain: {value: 1}, connect(n) { this.to = n; }}; this.nodes.push(g); return g; } }
  const nt = new AudioOutput({Ctx: NoTarget}); nt.start();
  ok(nt.ctx.nodes[0].gain.value === 1, 'guadagno diretto: pieno'); nt.setVolume(0.4); ok(nt.ctx.nodes[0].gain.value === 0.4, 'guadagno diretto: volume');
  nt.setMuted(true); ok(nt.ctx.nodes[0].gain.value === 0, 'guadagno diretto: silenzio'); nt.setMuted(0); ok(nt.ctx.nodes[0].gain.value === 0.4 && nt.muted === false, 'guadagno diretto: fine silenzio');
  nt.setMuted('x'); ok(nt.muted === true, 'muted forzato a booleano');
  // contesto senza filtro passa-alto
  class NoBiquad extends FakeCtx { constructor(o) { super(o); this.createBiquadFilter = undefined; } }
  const nb = new AudioOutput({Ctx: NoBiquad}); nb.start();
  ok(nb.ctx.nodes.length === 1 && nb.ctx.nodes[0].to === nb.ctx.destination, 'senza filtro: guadagno -> uscita');
  // contesto senza copyToChannel
  class NoCopy extends FakeCtx { createBuffer(ch, n, rt) { const d = new Float32Array(n); return {length: n, getChannelData: (c) => { if (c !== 0) throw new Error('canale'); return d; }, data: d}; } }
  const nc = new AudioOutput({Ctx: NoCopy}); nc.start(); nc.push(blk(8, 0.25));
  ok(nc.ctx.sources[0].buffer.data[0] === 0.25 && nc.ctx.sources[0].buffer.data[7] === 0.25, 'senza copyToChannel: getChannelData(0)');
  // buffer mono, con la frequenza del contesto, canale 0
  const calls = [];
  class Spy extends FakeCtx { createBuffer(ch, n, rt) { calls.push([ch, n, rt]); const d = new Float32Array(n); return {length: n, getChannelData: () => d, copyToChannel(a, c) { calls.push(['copy', c]); d.set(a); }, data: d}; } }
  const sp = new AudioOutput({Ctx: Spy}); sp.start(); sp.push(blk(100, 0.5));
  eq(calls, [[1, 100, 48000], ['copy', 0]], 'buffer mono con la frequenza del contesto e copia sul canale 0');
  // la sorgente e' collegata al guadagno
  ok(sp.ctx.sources[0].to === sp.gain && sp.ctx.sources[0].buffer.length === 100, 'sorgente collegata al guadagno');
  // coda: confini dell'esaurimento (lead 0,5 -> soglia 0,25 s; valori esatti in binario)
  const q = new AudioOutput({Ctx: FakeCtx, lead: 0.5}); q.start(); q.ctx.currentTime = 10;
  q.push(blk(48000, 0.1));                                // primo blocco: parte a 10,5 e finisce a 11,5
  ok(q.ctx.sources[0].started === 10.5 && q.underruns === 0 && q.pushed === 48000 && q.next === 11.5, 'primo blocco');
  q.ctx.currentTime = 11.25;                              // next == now + soglia: NON e' esaurita
  q.push(blk(48000, 0.1));
  ok(q.ctx.sources[1].started === 11.5 && q.underruns === 0 && q.next === 12.5, 'a soglia esatta la coda non e\' esaurita (' + q.ctx.sources[1].started + ')');
  q.ctx.currentTime = 12.25 - 1 / 64;                     // appena prima della soglia: non esaurita
  q.push(blk(48000, 0.1));
  ok(q.ctx.sources[2].started === 12.5 && q.underruns === 0 && q.next === 13.5, 'appena prima della soglia non e\' esaurita (' + q.ctx.sources[2].started + ')');
  q.ctx.currentTime = 13.5 - 0.25 + 1 / 64;               // next < now + soglia: esaurita
  const cur = q.ctx.currentTime;
  q.push(blk(48000, 0.1));
  ok(q.underruns === 1 && q.ctx.sources[3].started === cur + 0.5, 'appena oltre la soglia: esaurita (' + q.ctx.sources[3].started + ')');
  ok(q.pushed === 192000, 'campioni programmati: ' + q.pushed);
  // primo blocco dopo l'avvio non e' un esaurimento, il secondo esaurito si'
  const u = new AudioOutput({Ctx: FakeCtx}); u.start(); u.push(blk(48, 0.1)); u.ctx.currentTime = 5; u.push(blk(48, 0.1));
  ok(u.underruns === 1, 'un esaurimento contato');
  u.flush(); u.ctx.currentTime = 9; u.push(blk(48, 0.1)); ok(u.underruns === 1 && u.fresh === false, 'dopo flush: nessun esaurimento e fresh = false');
  // flush: anche senza contesto, e con sorgenti che lanciano
  const fl = new AudioOutput({Ctx: FakeCtx}); fl.start(); fl.push(blk(48, 0.1)); fl.ctx.currentTime = 3;
  const bad = {stop() { throw new Error('gia\' finita'); }, disconnect() { throw new Error('x'); }, onended() {}};
  fl.sources.add(bad);
  fl.flush();
  ok(fl.sources.size === 0 && bad.onended === null && fl.next === 3 && fl.fresh === true, 'flush con sorgenti che lanciano');
  ok(fl.ctx.sources[0].stopped && fl.ctx.sources[0].disc === true && fl.ctx.sources[0].onended === null, 'flush: ferma, scollega, toglie il gestore');
  const nf = new AudioOutput({Ctx: FakeCtx}); nf.next = 5; nf.fresh = false; nf.flush(); ok(nf.next === 0 && nf.fresh === true, 'flush senza contesto');
  // errore di ripresa
  class Rej extends FakeCtx { resume() { return Promise.reject(new Error('negato')); } }
  const rj = new AudioOutput({Ctx: Rej}); rj.start();
  await new Promise((r2) => setTimeout(r2, 5));
  ok(rj.error === 'negato', 'errore di ripresa registrato: ' + rj.error);
  class RejStr extends FakeCtx { resume() { return Promise.reject('testo'); } }
  const rs = new AudioOutput({Ctx: RejStr}); rs.start(); await new Promise((r2) => setTimeout(r2, 5));
  ok(rs.error === 'testo', 'errore di ripresa non-Error: ' + rs.error);
  // resume/suspend/close con contesti senza le funzioni, o che non ritornano una promessa
  class Bare { constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; }
    createGain() { return {gain: {value: 1}, connect() {}}; } }
  const bare = new AudioOutput({Ctx: Bare}); bare.start();
  bare.suspend(); bare.resume(); bare.close();
  ok(bare.ctx === null, 'contesto senza suspend / resume / close: nessun errore');
  class Sync extends Bare { resume() { this.state = 'running'; } suspend() { this.state = 'suspended'; } close() { this.closed = true; } }
  const sy = new AudioOutput({Ctx: Sync}); sy.start(); ok(sy.ctx.state === 'running', 'resume senza promessa'); sy.suspend(); ok(sy.ctx.state === 'suspended', 'suspend senza promessa');
  sy.resume(); ok(sy.ctx.state === 'running', 'resume'); const sc = sy.ctx; sy.close(); ok(sc.closed === true && sy.ctx === null && sy.gain === null, 'close senza promessa');
  // suspend / resume / close senza contesto
  const nn = new AudioOutput({Ctx: FakeCtx}); nn.suspend(); nn.resume(); nn.close(); ok(nn.ctx === null, 'senza contesto non fa niente');
  // close azzera ctx e gain e svuota la coda
  const cl = new AudioOutput({Ctx: FakeCtx}); cl.start(); cl.push(blk(48, 0.1)); const cs = cl.ctx.sources[0]; cl.close();
  ok(cl.gain === null && cl.ctx === null && cs.stopped && cl.sources.size === 0, 'close: gain nullo, coda svuotata');
  // rifiuti nelle promesse di suspend/resume/close non sollevano eccezioni non gestite
  class RejAll extends FakeCtx { suspend() { return Promise.reject(new Error('s')); } close() { return Promise.reject(new Error('c')); } }
  const ra = new AudioOutput({Ctx: RejAll}); ra.start(); ra.suspend(); ra.resume(); ra.close(); await new Promise((r2) => setTimeout(r2, 5));
  ok(true, 'rifiuti ignorati');
  // rate e running
  const rr = new AudioOutput({Ctx: FakeCtx}); ok(rr.rate === 0 && rr.running === false, 'rate / running senza contesto');
  rr.start(); ok(rr.rate === 48000 && rr.running === true, 'rate / running con contesto'); rr.ctx.state = 'closed'; ok(rr.running === false, 'running solo se «running»');
  // push: argomento non valido e contesto assente
  const pn = new AudioOutput({Ctx: FakeCtx}); pn.push(blk(10, 0)); ok(pn.pushed === 0, 'push senza contesto');

  console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})();
