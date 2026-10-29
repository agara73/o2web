'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_preview.js VETTORI.json - le funzioni pure delle anteprime (src/preview.js) contro i vettori calcolati dal riferimento Python indipendente
// (hw/preview_ref.py, test/preview_vectors.py), piu' prove puntuali del copione con una console finta.
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const P = require(SP('preview.js'));
const {PALETTE} = require(SP('vdc.js'));
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 20) console.log('FALLITO: ' + m); } };

const file = process.argv[2];
if (file) {
  const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const c of cases) {
    const fb = Uint8Array.from(c.fb);
    const st = P.frameStats(fb);
    ok(st.n === c.n && st.max === c.max && st.colors === c.colors, c.label + ': statistiche ' + JSON.stringify(st));
    ok(P.frameScore(st) === c.score, c.label + ': punteggio');
    ok(P.isBlankStats(st) === c.blank, c.label + ': vuoto');
    ok(P.isPoorStats(st) === c.poor, c.label + ': quasi vuoto (meno del 2%)');
    ok(P.isRichStats(st) === c.rich, c.label + ': ricco');
    const px = P.downscale(fb, PALETTE, c.w, c.h, c.ow, c.oh);
    let diff = 0;
    for (let i = 0; i < px.length; i++) if (px[i] !== c.rgba[i]) diff++;
    ok(px.length === c.rgba.length && diff === 0, c.label + ': miniatura, ' + diff + ' byte diversi');
  }
  console.log('vettori: ' + cases.length + ' casi');
} else console.log('(nessun file di vettori: solo prove puntuali)');

// ---- copione con una console finta
function fakeConsole(painter) {
  const con = {fb: new Uint8Array(360 * 243), keyRows: new Uint8Array(8), frames: 0, keyLog: [], runFrame() {
    this.keyLog.push(this.keyRows[0]);
    painter(this.fb, this.frames);
    this.frames++;
  }};
  return con;
}
{
  // quadro vuoto per sempre: 270 fotogrammi di prima fase + 47 tasti x 40 fotogrammi, vuoto; nella prima fase i tasti
  // (tutti insieme) solo ai fotogrammi 150-155, poi un tasto alla volta per 5 fotogrammi
  const con = fakeConsole(() => {});
  const run = new P.PreviewRun(con);
  let steps = 0;
  while (!run.step(7)) steps++;
  ok(con.frames === 270 + 47 * 40, 'vuoto: fotogrammi ' + con.frames);
  const r = run.result();
  ok(r.blank && r.w === P.PV_W && r.h === P.PV_H && r.rgba.length === P.PV_W * P.PV_H * 4, 'vuoto: risultato');
  ok(con.keyLog.slice(0, 270).every((v, i) => v === (i >= 150 && i < 156 ? 1 : 0)), 'tasti solo ai fotogrammi 150-155');
  ok(P.KEYS.length === 47 && new Set(P.KEYS).size === 47 && !P.KEYS.includes(11) && P.KEYS.every((k) => k >= 0 && k < 48), 'elenco dei tasti');
  ok(con.keyLog.length === 2150 && con.keyLog.slice(270).every((v, i) => {
    const k = P.KEYS[Math.floor(i / 40)], s = i % 40;
    return v === (s < 5 && (k >> 3) === 0 ? 1 << (k & 7) : 0);
  }), 'seconda fase: un tasto alla volta per 5 fotogrammi');
  ok(r.frame === 170, 'vuoto: il primo quadro a pari punteggio resta (' + r.frame + ')');
}
{
  // schermata ricca dal fotogramma 190: si ferma al primo campione ricco (190), non va oltre
  const con = fakeConsole((fb, f) => { if (f >= 185) for (let i = 0; i < 30000; i++) fb[i] = 1 + (i % 3); });
  const run = new P.PreviewRun(con);
  while (!run.step(13));
  const r = run.result();
  ok(!r.blank && r.frame === 190 && con.frames === 191, 'ricco: quadro ' + r.frame + ', fotogrammi ' + con.frames);
}
{
  // quadro povero all'inizio e poi migliore: sceglie il migliore (ma non ricco: niente uscita anticipata)
  const con = fakeConsole((fb, f) => { fb.fill(0); const k = f < 200 ? 3000 : f < 230 ? 6000 : 1500; for (let i = 0; i < k; i++) fb[i] = 1; });
  const run = new P.PreviewRun(con);
  while (!run.step(50));
  const r = run.result();
  ok(r.frame === 220 || r.frame === 200, 'migliore: ' + r.frame);   // 6000 pixel da 200 a 229: il primo e' 200
  ok(r.frame === 200, 'migliore: primo con punteggio massimo (' + r.frame + ')');
  ok(con.frames === 270, 'migliore: fino alla fine');
  let thrown = false;
  try { new P.PreviewRun(fakeConsole(() => {})).result(); } catch (e) { thrown = true; }
  ok(thrown, 'result() prima della fine deve fallire');
}
{
  // n = 0 non esegue niente; step oltre la fine non fa niente
  const con = fakeConsole(() => {});
  const run = new P.PreviewRun(con);
  ok(run.step(0) === false && con.frames === 0, 'step(0)');
  while (!run.step(100));
  ok(run.step(100) === true && con.frames === 2150, 'step dopo la fine');
}
{
  // confini esatti delle soglie, con numeri ricavati a mano dalla specifica (n = 360 x 243 = 87480):
  // un colore conta se occupa almeno lo 0,5% (h * 200 >= n, cioe' h >= 438); vuoto se (n - max) * 500 < n (n - max <= 174);
  // quasi vuoto (si provano i tasti) se (n - max) * 50 < n (n - max <= 1749);
  // ricco se (n - max) * 4 >= n (n - max >= 21870) e almeno 3 colori
  const N = 360 * 243;
  const withCounts = (counts) => { const f = new Uint8Array(N); let p = 0; counts.forEach((k, c) => { for (let i = 0; i < k; i++) f[p++] = c; }); return f; };
  ok(P.frameStats(withCounts([N - 437, 437])).colors === 1, 'soglia colori: 437 pixel non contano');
  ok(P.frameStats(withCounts([N - 438, 438])).colors === 2, 'soglia colori: 438 pixel contano');
  ok(P.frameStats(withCounts([N - 438, 438])).max === N - 438, 'max');
  ok(P.frameStats(withCounts([100, 100, 100, N - 300])).max === N - 300, 'max con piu colori');
  ok(P.frameStats(withCounts([N - 30, 30])).max === N - 30 && P.frameStats(withCounts([30, N - 30])).max === N - 30, 'max in qualunque posizione');
  ok(P.frameStats(withCounts(new Array(16).fill(0).map((_, i) => i === 15 ? N - 15 * 500 : 500))).colors === 16, 'tutti i 16 colori contano');
  ok(P.frameStats(withCounts(new Array(16).fill(0).map((_, i) => i === 15 ? N - 15 * 500 : 500))).max === N - 15 * 500, 'max sul colore 15');
  ok(P.isBlankStats({n: N, max: N - 174, colors: 2}) === true, 'vuoto: n - max = 174');
  ok(P.isBlankStats({n: N, max: N - 175, colors: 2}) === false, 'non vuoto: n - max = 175');
  ok(P.isPoorStats({n: N, max: N - 1749, colors: 2}) === true, 'quasi vuoto: n - max = 1749');
  ok(P.isPoorStats({n: N, max: N - 1750, colors: 2}) === false, 'non quasi vuoto: n - max = 1750');
  ok(P.isRichStats({n: N, max: N - 21870, colors: 3}) === true, 'ricco: n - max = 21870 e 3 colori');
  ok(P.isRichStats({n: N, max: N - 21869, colors: 3}) === false, 'non ricco: n - max = 21869');
  ok(P.isRichStats({n: N, max: N - 21870, colors: 2}) === false, 'non ricco: 2 colori');
  ok(P.isRichStats({n: N, max: N - 40000, colors: 4}) === true, 'ricco: 4 colori');
  // step(1) avanza di un fotogramma alla volta
  const con = fakeConsole(() => {});
  const run = new P.PreviewRun(con);
  run.step(1); ok(con.frames === 1, 'step(1) esegue un fotogramma');
  run.step(3); ok(con.frames === 4, 'step(3) ne esegue tre');
  // quadro sempre vuoto: il primo campione (fotogramma 170, punteggio 0) resta il migliore
  while (!run.step(50));
  const r = run.result();
  ok(r.frame === 170 && r.blank === true && r.score === 0, 'quadro vuoto: scelto il primo campione, punteggio 0');
}
{
  // seconda fase: il gioco aspetta il tasto 47 (ENT): disegna solo dopo che e' stato premuto, e ci si ferma subito
  const ENT = 47;
  let seen = false;
  const con = fakeConsole((fb) => { if (con.keyRows[ENT >> 3] & (1 << (ENT & 7))) seen = true; fb.fill(0); if (seen) for (let i = 0; i < 20000; i++) fb[i] = 1 + (i % 3); });
  const run = new P.PreviewRun(con);
  while (!run.step(37));
  const r = run.result();
  const idx = P.KEYS.indexOf(ENT);
  // primo campione dopo la pressione: fotogramma 270 + 40 * idx + 9
  ok(!r.blank && r.frame === 270 + 40 * idx + 9 && con.frames === r.frame + 1, 'seconda fase: tasto ENT, quadro ' + r.frame + ', fotogrammi ' + con.frames);
}
{
  // una riga di testo (1% dei pixel) alla fine della prima fase: non e' vuoto, ma e' povero: si provano i tasti,
  // e se nessuno cambia niente il risultato resta la riga di testo, non piu' "vuoto"
  const con = fakeConsole((fb) => { fb.fill(0); for (let i = 0; i < 900; i++) fb[i] = 2; });
  const run = new P.PreviewRun(con);
  while (!run.step(200));
  const r = run.result();
  ok(con.frames === 2150 && !r.blank && r.frame === 170, 'riga di testo: ' + con.frames + ' fotogrammi, vuoto=' + r.blank);
}
{
  // schermo dello 0,1% dei pixel (88 pixel): vuoto
  const con = fakeConsole((fb) => { fb.fill(0); for (let i = 0; i < 80; i++) fb[i] = 2; });
  const run = new P.PreviewRun(con);
  while (!run.step(200));
  ok(run.result().blank === true, 'meno dello 0,2%: vuoto');
}
{
  // ordine dei tasti della seconda fase (dalla specifica): 1, 0, ENT, 2-9, Y, N, spazio, ?, CLR, poi gli altri in ordine crescente
  const want = [1, 0, 47, 2, 3, 4, 5, 6, 7, 8, 9, 44, 45, 12, 13, 46];
  ok(P.KEYS.slice(0, 16).join() === want.join(), 'ordine dei primi 16 tasti');
  ok(P.KEYS.slice(16).join() === [10].concat(Array.from({length: 30}, (_, i) => 14 + i)).join(), 'ordine degli altri 31 tasti');
}
{
  // il quadro ricco compare solo dal fotogramma 270 (primo della seconda fase): nessun campione a 270, il primo e' a 279
  const con = fakeConsole((fb, f) => { fb.fill(0); if (f >= 270) for (let i = 0; i < 30000; i++) fb[i] = 1 + (i % 3); });
  const run = new P.PreviewRun(con);
  while (!run.step(9));
  const r = run.result();
  ok(!r.blank && r.frame === 279 && con.frames === 280, 'quadro dal 270: primo campione ' + r.frame + ', fotogrammi ' + con.frames);
}
console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
process.exit(bad ? 1 : 0);
