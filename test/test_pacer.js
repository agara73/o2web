'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_pacer.js VEC.json - passo dell'emulazione (src/pacer.js, tappa 8): ogni chiamata di ogni scenario (computer, telefoni con
// l'orologio dell'audio a blocchi, deriva, pause, schede in secondo piano, tratti senza audio) contro il riferimento indipendente
// hw/pacer_ref.py (vettori di test/pacer_vectors.py): fotogrammi, anticipo e velocita' uguali. Poi i risultati che contano (velocita'
// giusta e nessun vuoto sui telefoni) e prove puntuali (valori non validi, limiti, azzeramento).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const P = require(SP('pacer.js'));

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL  ' + msg); } };

const vecFile = process.argv[2];
if (!vecFile) { console.log('uso: node test/test_pacer.js VEC.json (da test/pacer_vectors.py)'); process.exit(2); }
const vec = JSON.parse(fs.readFileSync(vecFile, 'utf8'));

// ---- costanti uguali a quelle del riferimento
for (const [k, v] of Object.entries(vec.consts)) ok(P[k] === v, 'costante ' + k + ' = ' + v + ' (pacer.js: ' + P[k] + ')');

// ---- ogni chiamata contro il riferimento
{
  let calls = 0;
  for (const s of vec.scenarios) {
    const p = new P.Pacer();
    let bad = '';
    for (let i = 0; i < s.calls.length; i++) {
      const c = s.calls[i];
      if (c.reset) p.reset();
      const n = p.step(c.ts, c.period, c.audio ? {time: c.audio[0], queued: c.audio[1]} : null);
      calls++;
      if (n !== c.n || Math.abs(p.lead - c.lead) > 1e-12 || Math.abs(p.rate - c.rate) > 1e-12) {
        bad = 'chiamata ' + i + ': fotogrammi ' + n + '/' + c.n + ', anticipo ' + p.lead + '/' + c.lead + ', velocita\' ' + p.rate + '/' + c.rate;
        break;
      }
    }
    ok(!bad, 'scenario «' + s.name + '» uguale al riferimento (' + s.calls.length + ' chiamate) ' + bad);
  }
  ok(calls > 15000, 'chiamate confrontate: ' + calls);
}

// ---- i risultati che contano (dal riferimento, quindi anche da pacer.js che coincide)
{
  const by = (name) => vec.scenarios.find((s) => s.name === name);
  for (const s of vec.scenarios.filter((x) => !x.events.length)) {
    const want = 1 / s.period;
    ok(Math.abs(s.fps - want) / want < 0.01, '«' + s.name + '»: ' + s.fps.toFixed(1) + ' fotogrammi/s, atteso ' + want.toFixed(1) + ' (entro l\'1%)');
  }
  for (const name of ['telefono-85ms', 'telefono-128ms', 'telefono-171ms', 'telefono-256ms-30hz', 'telefono-ntsc-85ms', 'telefono-21ms', 'computer', 'computer-ntsc']) {
    ok(by(name).under_s === 0, '«' + name + '»: l\'audio non va mai a vuoto dopo i primi 3 secondi (' + by(name).under_s + '/s)');
  }
  ok(by('deriva-forte').under_s < 0.2, 'deriva forte (0,3%): vuoti rari (' + by('deriva-forte').under_s.toFixed(2) + '/s)');
  ok(by('computer').max_q < 0.12 && by('computer-ntsc').max_q < 0.12, 'sul computer la coda resta corta come prima (' + Math.round(by('computer').max_q * 1000) + ' ms)');
  ok(by('telefono-256ms-30hz').max_q < P.LEAD_MAX + 0.256 + 0.01, 'la coda non supera anticipo massimo + un blocco (' + Math.round(by('telefono-256ms-30hz').max_q * 1000) + ' ms)');
  const ph = by('telefono-85ms').calls;
  const leadEnd = ph[ph.length - 1].lead;
  ok(leadEnd > 0.13 && leadEnd < 0.16, 'telefono a blocchi di 85 ms: anticipo circa 1,5 x 85 + 20 ms (' + Math.round(leadEnd * 1000) + ' ms)');
  ok(by('computer').calls[by('computer').calls.length - 1].lead === P.LEAD_MIN, 'computer: anticipo minimo (' + P.LEAD_MIN * 1000 + ' ms)');
  const rates = vec.scenarios.flatMap((s) => s.calls.map((c) => c.rate));
  ok(Math.min(...rates) >= 1 - P.CORR_MAX && Math.max(...rates) <= 1 + P.CORR_MAX, 'la correzione resta entro +-0,5%');
}

// ---- prove puntuali
{
  const p = new P.Pacer();
  ok(p.step(0, 0.02, null) === 0 && p.dt === 0, 'prima chiamata: nessun fotogramma (dt 0)');
  ok(p.step(20, 0.02, null) === 1 && p.step(40, 0.02, null) === 1, 'una chiamata ogni 20 ms con fotogrammi da 20 ms: 1 per volta');
  // con durate non esatte in binario (0,02) il conto puo' dare un fotogramma in meno e tenerlo in conto: il tempo si conserva sempre
  const a0 = p.acc, n1 = p.step(100, 0.02, null);
  ok(n1 >= 2 && n1 <= 3 && Math.abs(a0 + 0.06 - n1 * 0.02 - p.acc) < 1e-12 && p.acc < 0.02 + 1e-12, '60 ms: ' + n1 + ' fotogrammi + resto = 60 ms (il tempo si conserva)');
  const a1 = p.acc, n2 = p.step(200, 0.02, null);
  ok(n2 === 3 && Math.abs(a1 + 0.1 - 3 * 0.02 - p.acc) < 1e-12, '100 ms: 3 fotogrammi (il massimo), il resto (' + p.acc.toFixed(3) + ' s) resta in conto');
  const e = new P.Pacer(), per = 1 / 64;          // durata esatta in binario: i conti tornano senza arrotondamenti
  e.step(0, per, null);
  ok(e.step(1000 * 3 * per, per, null) === 3 && e.acc === 0, 'tre fotogrammi esatti (1/64 s): 3 e resto 0');
  ok(p.step(30200, 0.02, null) === 3 && Math.abs(p.acc - 0.1) < 1e-12 && p.dt === P.MAX_DT, '30 s dopo (scheda in secondo piano): conta 0,1 s, 3 fotogrammi, in arretrato al massimo 0,1 s');
  ok(p.step(30100, 0.02, null) === 3 && p.dt === 0, 'ora che torna indietro: dt 0 (e si smaltisce l\'arretrato)');
  for (const [ts, per, what] of [[NaN, 0.02, 'ora NaN'], [Infinity, 0.02, 'ora infinita'], [30200, 0, 'fotogramma di durata 0'], [30200, -1, 'durata negativa'], [30200, NaN, 'durata NaN']]) {
    ok(new P.Pacer().step(ts, per, null) === 0, 'valore non valido (' + what + '): nessun fotogramma');
  }
  const q = new P.Pacer();
  q.step(0, 0.02, {time: 0, queued: 0});
  q.step(20, 0.02, {time: 0.25, queued: 0.1});
  ok(Math.abs(q.jump - 0.25) < 1e-12 && Math.abs(q.lead - 0.395) < 1e-12, 'salto dell\'orologio audio di 250 ms: anticipo 1,5 x 250 + 20 = 395 ms');
  q.step(40, 0.02, {time: 5, queued: 0.1});
  ok(Math.abs(q.jump - P.JUMP_CLAMP) < 1e-12 && q.lead === P.LEAD_MAX, 'salto enorme (audio fermo e ripartito): conta 0,4 s, anticipo massimo 0,5 s');
  q.step(60, 0.02, {time: 4, queued: 0.1});
  ok(Math.abs(q.jump - P.JUMP_CLAMP * P.JUMP_DECAY) < 1e-12, 'orologio audio che torna indietro: nessun salto, quello di prima cala');
  q.step(80, 0.02, {time: NaN, queued: 0.1});
  ok(q.audioT === null && q.qAvg === null && q.rate === 1, 'ora dell\'audio non valida: come senza audio');
  const j = q.jump;
  q.reset();
  ok(q.jump === j && q.last === null && q.acc === 0 && q.qAvg === null && q.audioT === null && q.rate === 1, 'reset: si riparte senza debiti, il salto misurato resta (e\' del browser)');
  const r = new P.Pacer();
  r.step(0, 0.02, {time: 0, queued: 0});
  ok(Math.abs(r.rate - (1 + P.CORR_MAX)) < 1e-12, 'coda vuota: un po\' piu\' veloce (+0,5%)');
  r.step(17, 0.02, {time: 0.017, queued: 5});
  ok(r.rate < 1 && r.rate >= 1 - P.CORR_MAX, 'coda molto lunga: un po\' piu\' lento (' + r.rate + ')');
  // reset partendo da valori "sporchi": dt, ora dell'audio, coda media e velocita' tornano ai valori iniziali
  const z = new P.Pacer();
  z.step(0, 0.02, {time: 0, queued: 0});
  z.step(30, 0.02, {time: 0.03, queued: 0});
  ok(z.dt > 0 && z.audioT !== null && z.rate !== 1, 'prima del reset: valori in uso');
  const zj = z.jump;
  z.reset();
  ok(z.dt === 0 && z.audioT === null && z.rate === 1 && z.qAvg === null && z.last === null && z.acc === 0 && z.jump === zj, 'reset: dt, ora dell\'audio, velocita\', coda media e conto azzerati; il salto resta');
  z.step(1000, 0.02, {time: 50, queued: 0.06});
  ok(Math.abs(z.jump - zj * P.JUMP_DECAY) < 1e-15, 'dopo il reset l\'ora dell\'audio di prima non conta: nessun salto finto');
  // limiti della correzione
  const lo = new P.Pacer();
  lo.step(0, 0.02, {time: 0, queued: 1});
  ok(lo.rate === 1 - P.CORR_MAX, 'coda di 1 s con anticipo 60 ms: correzione al limite (-0,5%)');
  const hi = new P.Pacer();
  hi.step(0, 0.02, {time: 0, queued: -1});
  ok(hi.rate === 1 + P.CORR_MAX, 'coda negativa (fuori contratto): correzione al limite (+0,5%)');
  const s = new P.Pacer();
  s.step(0, 0.02, {time: 0, queued: 0.06});
  ok(s.rate === 1 && s.qAvg === 0.06, 'coda uguale all\'anticipo: velocita\' esatta');
  s.step(10, 0.02, {time: 0, queued: 0.16});
  ok(Math.abs(s.qAvg - (0.06 + P.QAVG_K * 0.1)) < 1e-15, 'coda media: media mobile con peso ' + P.QAVG_K);
}

if (fails) { console.log('FALLITI ' + fails + ' controlli (' + passes + ' ok)'); process.exit(1); }
console.log('OK: ' + passes + ' controlli sul passo dell\'emulazione');
