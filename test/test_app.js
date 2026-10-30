'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_app.js - il regista (app.js) senza DOM: elenco, cambio di gioco con stato memorizzato, BIOS e standard, reset, stato su file,
// sessione (andata e ritorno e ripresa deterministica), sessioni false (la partita in corso non si tocca), passo guidato dall'audio con
// un AudioContext finto, passo a tempo senza audio, ingressi, dimensioni dello schermo. Serve la cartella dei dump (in locale).
// Uso: node test/test_app.js [DUMPS]
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const path = require('path');
const {App, layoutSize, sniffSession, sniffState} = require(SP('app.js'));
const {AudioOutput} = require(SP('webaudio.js'));
const {zipStore} = require(SP('zipstore.js'));
const charsetOwn = require('../hw/charset_own.js');
const FALLBACK = new Uint8Array(charsetOwn.build());

let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const dumps = process.argv[2] || process.env.O2_DUMPS;

// ---- parti senza dump
{
  const L = layoutSize;
  ok(L(1100, 800, 0, 'square', true).factor === 3 && L(1100, 800, 0, 'square', true).w === 1080 && L(1100, 800, 0, 'square', true).h === 729, 'layout: intero piu\' grande (quadrati)');
  ok(L(1100, 800, 0, 'tv', true).factor === 2 && L(1100, 800, 0, 'tv', true).h === 540, 'layout: tv 360x270, limite dell\'altezza');
  ok(Math.abs(L(1100, 800, 0, 'tv', false).factor - 2.963) < 0.001 && L(1100, 800, 0, 'tv', false).h === 800, 'layout: adatta (frazionaria)');
  ok(L(300, 200, 0, 'square', true).factor < 1 && L(300, 200, 0, 'square', true).w <= 300 && L(300, 200, 0, 'square', true).h <= 200, 'layout: area piccola -> riduzione');
  ok(L(1100, 800, 4, 'square').w === 1440, 'layout: scala fissa');
  ok(L(0, 0, 0, 'tv').factor === 1 && L(NaN, 5, 3, 'tv').factor === 3, 'layout: misure assenti');
  ok(L(1920, 1080, 0, 'tv', true).factor === 4 && L(1920, 1080, 0, 'tv', true).h === 1080, 'layout: schermo intero 1080p');
  ok(sniffSession(zipStore([{name: 'sessione.json', data: new Uint8Array(2)}])) && !sniffSession(new Uint8Array(10)) && !sniffSession(zipStore([{name: 'a', data: new Uint8Array(1)}])), 'sniff sessione');
  ok(sniffState(new TextEncoder().encode(' \n{"a":1}')) && !sniffState(new Uint8Array([1, 2, 3])) && !sniffState(new Uint8Array(0)), 'sniff stato');
}
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));

const rd = (p) => ({name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(path.join(dumps, p)))});

class FakeCtx {
  constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {}; this.n = 0; this.samples = 0; }
  resume() { return Promise.resolve(); }
  createGain() { return {gain: {value: 1, setTargetAtTime() {}}, connect() {}}; }
  createBiquadFilter() { return {frequency: {}, connect() {}}; }
  createBuffer(c, n) { this.samples += n; return {getChannelData: () => new Float32Array(n), copyToChannel() {}}; }
  createBufferSource() { return {connect() {}, disconnect() {}, start() { this.n++; }, stop() {}}; }
}

(async () => {
  await require('./app_extra.js')(ok, eq);
  if (!dumps) { console.log('  (prove con i dump saltate: serve la cartella dei dump)'); console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)'); process.exit(fails ? 1 : 0); }
  const msgs = [];
  const mk = (sink) => new App({onMessage: (t, k) => msgs.push([k, t]), sink, fallbackCharset: FALLBACK});
  const last = () => (msgs.length ? msgs[msgs.length - 1][1] : '');
  const runFrames = (app, n, t0) => { let t = t0 || 1000, done = 0; while (done < n) { t += 20.1; done += app.step(t); } return t; };

  const app = mk(null);
  // ---- elenco da file singoli
  await app.openFiles([rd('bios/g7400.bin'), rd('bios/o2rom.bin'), rd('bios/c52.bin'), rd('killerbees.bin'), rd('pickaxepete.bin'), rd('blockout.bin'), rd('demonattack.bin')]);
  ok(app.lib.bios.length === 3 && app.lib.games.length === 4, 'elenco: 3 BIOS, 4 giochi');
  ok(app.bios && app.bios.supported && app.bios.known.system === 'g7000', 'BIOS scelto in automatico: il primo utilizzabile (' + (app.bios && app.bios.display) + ')');
  const kb = app.lib.games.find((g) => /killer/i.test(g.title)), pp = app.lib.games.find((g) => /pickaxe/i.test(g.title)), bo = app.lib.games.find((g) => /blockout/i.test(g.title));
  const o2 = app.lib.bios.find((b) => b.known && /Odyssey/.test(b.known.label)), c52 = app.lib.bios.find((b) => /C52/.test(b.display)), g74 = app.lib.bios.find((b) => b.known && b.known.system === 'g7400');
  ok(o2 && c52 && g74 && g74.supported, 'BIOS: il G7400 e\' utilizzabile (tappa 5)');
  ok(app.listGames('killer').length === 1 && app.listGames('').length === 4, 'ricerca nell\'elenco');

  // ---- avvio e gioco
  ok(!app.running, 'fermo prima dell\'avvio');
  ok(app.selectBios(g74.id) !== false && app.bios.id === g74.id && app.isG7400, 'BIOS G7400 scelto');
  ok(app.selectBios(o2.id) !== false && app.bios.id === o2.id && !app.isG7400, 'ritorno al BIOS G7000');
  ok(app.start(kb.id) && app.running && app.gameId === kb.id, 'avvio di Killer Bees');
  let t = runFrames(app, 120);
  let fbSum = 0; for (const v of app.con.fb) fbSum += v;
  ok(app.framesRun >= 120 && fbSum > 0, 'la console gira e disegna');
  ok(app.step(t + 20) >= 0, 'passo');

  // ---- cambio di gioco: stato memorizzato in automatico
  msgs.length = 0;
  ok(app.start(pp.id) && app.gameId === pp.id, 'cambio gioco');
  ok(app.hasState(kb.id) && /memorizzato/.test(msgs.map((m) => m[1]).join(' ')), 'stato di Killer Bees memorizzato in automatico');
  ok(!app.hasState(pp.id), 'il gioco nuovo non ha stato');
  t = runFrames(app, 10, t);
  ok(app.start(bo.id) && !app.hasState(pp.id), 'una partita appena iniziata (<30 fotogrammi) non memorizza');
  t = runFrames(app, 60, t);
  // ---- riprendi
  const memKb = JSON.stringify(app.states.get(kb.id));
  ok(app.resume(kb.id) && app.gameId === kb.id && app.hasState(bo.id), 'riprendi Killer Bees; Blockout memorizzato uscendo');
  ok(JSON.stringify(app.con.saveState()) === memKb, 'lo stato ripreso e\' identico a quello memorizzato');
  // la ripresa continua come l'originale (determinismo): console di confronto costruita a parte
  {
    const { Console } = require(SP('console.js'));
    const ref = new Console({bios: o2.data, cart: kb.data, charset: app.activeCharset, standard: 'PAL'});
    ref.loadState(JSON.parse(memKb));
    for (let i = 0; i < 40; i++) { app.con.runFrame(); ref.runFrame(); }
    ok(JSON.stringify(app.con.saveState()) === JSON.stringify(ref.saveState()), 'ripresa deterministica');
  }
  // ---- reset console
  app.con.cpu.pc = 0x123;
  ok(app.resetConsole() && app.con.cpu.pc === 0 && app.gameId === kb.id, 'reset console: PC a 0, stesso gioco');
  // ---- BIOS: cambio = riavvio a freddo; lo stato resta legato al BIOS di prima
  t = runFrames(app, 40, t);
  ok(app.selectBios(c52.id) && app.biosId === c52.id && app.gameId === kb.id && app.framesRun < 5, 'cambio BIOS: riavvio a freddo del gioco in uso');
  ok(app.hasState(kb.id), 'lo stato di Killer Bees e\' rimasto (anche se si e\' rimemorizzato il gioco in uso)');
  msgs.length = 0;
  ok(app.resume(kb.id) === false && /altro BIOS/.test(last()), 'stato con un altro BIOS: non si riprende (messaggio)');
  ok(app.hasState(kb.id) && app.stateInfo(kb.id).sameBios === false, 'lo stato resta memorizzato');
  ok(app.selectBios(o2.id) && app.resume(kb.id), 'tornando al BIOS giusto si riprende');
  // ---- standard
  ok(app.hasState(kb.id), 'stato presente');
  app.setStandard('NTSC');
  ok(app.settings.standard === 'NTSC' && app.con.std === 'NTSC' && app.running, 'NTSC: la console riparte');
  msgs.length = 0;
  ok(app.resume(kb.id) === false && /PAL/.test(last()), 'stato PAL non si riprende in NTSC');
  app.setStandard('PAL');
  ok(app.resume(kb.id), 'tornando a PAL si riprende');
  let thrown = false; try { app.setStandard('SECAM'); } catch (e) { thrown = true; }
  ok(thrown, 'standard non valido');

  // ---- ingressi
  app.input.keyDown({code: 'ArrowLeft', key: 'ArrowLeft'}); app.input.keyDown({code: 'Numpad4', key: '4'}); app.input.keyDown({code: 'Digit1', key: '1'});
  t += 30; app.step(t);
  ok(app.con.joy[0] === 8 && app.con.joy[1] === 8 && (app.con.keyRows[0] & 2), 'ingressi: joystick 1, joystick 2 e tasto 1 arrivano alla console');
  app.input.releaseAll(); t += 30; app.step(t);
  ok(app.con.joy[0] === 0 && app.con.joy[1] === 0 && app.con.keyRows[0] === 0, 'rilasciati');
  app.pollPads([{connected: true, buttons: Array.from({length: 17}, (_, i) => ({pressed: i === 15, value: i === 15 ? 1 : 0})), axes: [0, 0]}]);
  t += 30; app.step(t);
  ok(app.con.joy[0] === 2, 'gamepad -> joystick 1 (destra)');
  app.pollPads([]); t += 30; app.step(t);

  // ---- stato su file
  {
    const f = app.saveStateFile();
    ok(f && /\.o2state$/.test(f.name) && f.bytes.length > 100, 'stato su file: ' + f.name);
    const text = new TextDecoder().decode(f.bytes);
    ok(!/"data"/.test(text) && f.bytes.length < 400000, 'lo stato e\' solo stato');
    const a2 = mk(null);
    await a2.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    msgs.length = 0;
    ok(await a2.openFiles([{name: f.name, bytes: f.bytes}]) === null && a2.running && /killer/i.test(a2.game.title), 'stato su file: si apre da solo, cerca BIOS e gioco per impronta');
    ok(JSON.stringify(a2.con.saveState()) === JSON.stringify(app.con.saveState()), 'stato su file: identico');
    const a3 = mk(null);
    await a3.openFiles([rd('bios/o2rom.bin')]);
    msgs.length = 0;
    ok(a3.loadStateFile(f.bytes, 'x.o2state') === false && /cartuccia/.test(last()) && !a3.running, 'stato su file: cartuccia mancante, messaggio');
    const a4 = mk(null);
    ok(a4.loadStateFile(f.bytes, 'x.o2state') === false && /BIOS/.test(last()), 'stato su file: BIOS mancante, messaggio');
    ok(a4.loadStateFile(new TextEncoder().encode('{"a":1}'), 'y') === false && a4.loadStateFile(new Uint8Array([1, 2, 3]), 'z') === false, 'stati falsi rifiutati');
    // stato di un'altra cartuccia con il gioco gia' in corso: non si tocca niente
    const conBefore = a2.con;
    const bad = JSON.parse(new TextDecoder().decode(f.bytes)); bad.cpu.pc = 'x';
    ok(a2.loadStateFile(new TextEncoder().encode(JSON.stringify(bad)), 'bad') === false && a2.con === conBefore, 'stato corrotto: la partita in corso resta');
  }

  // ---- sessione
  {
    app.setPaused(false);
    app.input.setBindings(require(SP('input.js')).PRESETS.portatile);
    app.settings.scale = 3; app.settings.aspect = 'square'; app.settings.integer = true; app.settings.volume = 0.4; app.settings.muted = true;
    app.setCharset('c.bin', new Uint8Array(app.fallbackCharset));
    const bytesBefore = JSON.stringify(app.con.saveState());
    const ses = app.saveSession('2026-10-12T12:00:00.000Z');
    ok(ses.length > 0 && JSON.stringify(app.con.saveState()) === bytesBefore, 'sessione scritta, la partita non cambia');
    const a2 = mk(null);
    msgs.length = 0;
    ok(await a2.openFiles([{name: 's.o2session', bytes: ses}]) === null && a2.running, 'sessione: aperta dal selettore dei file');
    ok(a2.lib.games.length === 4 && a2.lib.bios.length === 3 && /killer/i.test(a2.game.title) && a2.bios.sha === o2.sha, 'sessione: elenco, gioco e BIOS in uso');
    ok(a2.settings.scale === 3 && a2.settings.aspect === 'square' && a2.settings.integer === true && a2.settings.volume === 0.4 && a2.settings.muted && a2.settings.standard === 'PAL', 'sessione: impostazioni');
    ok(a2.input.bindings['2'].up[0] === 'KeyI' && a2.charset && a2.charset.length === 512, 'sessione: tasti e set di caratteri');
    ok(a2.states.size === app.states.size + 0 || a2.states.size >= 2, 'sessione: stati memorizzati (' + a2.states.size + ')');
    ok(JSON.stringify(a2.con.saveState()) === bytesBefore, 'sessione: la partita riprende dallo stato esatto');
    for (let i = 0; i < 50; i++) { app.con.runFrame(); a2.con.runFrame(); }
    ok(JSON.stringify(app.con.saveState()) === JSON.stringify(a2.con.saveState()), 'sessione: ripresa deterministica');
    // sessione falsa: niente cambia
    const conBefore = a2.con, libBefore = a2.lib, nGames = a2.lib.games.length;
    const broken = ses.slice(); broken[ses.length >> 1] ^= 0xFF;
    msgs.length = 0;
    ok(await a2.loadSession(broken, 'rotta') === false && a2.con === conBefore && a2.lib === libBefore && a2.lib.games.length === nGames && /non e’ stata toccata/.test(last()), 'sessione rotta: rifiutata, niente cambia');
    ok(await a2.loadSession(new Uint8Array(100), 'vuota') === false && a2.con === conBefore, 'file qualunque: rifiutato');
    // sessione senza gioco in uso, con BIOS diverso dallo stato
    const a5 = mk(null);
    await a5.openFiles([rd('bios/o2rom.bin'), rd('bios/c52.bin'), rd('killerbees.bin')]);
    a5.selectBios(a5.lib.bios.find((b) => /C52/.test(b.display)).id);
    ok(a5.start(a5.lib.games[0].id)); runFrames(a5, 50);
    const s5 = a5.saveSession('x');
    const a6 = mk(null);
    ok(await a6.openFiles([{name: 'q', bytes: s5}]) === null && a6.running && a6.bios.display.includes('C52'), 'sessione con BIOS C52');
    // sessione vuota
    const s0 = mk(null).saveSession('');
    const a7 = mk(null);
    ok(await a7.loadSession(s0, 'v') && !a7.running && a7.lib.games.length === 0, 'sessione vuota si apre');
  }

  // ---- togliere dall'elenco
  {
    msgs.length = 0;
    ok(app.removeGame(app.gameId) === false && /in uso/.test(last()), 'il gioco in uso non si toglie');
    ok(app.removeGame(pp.id) && app.lib.games.length === 3, 'si toglie un altro gioco');
    ok(app.removeBios(app.biosId) === false && app.removeBios(c52.id), 'BIOS: idem');
    app.clearLibrary();
    ok(app.lib.games.length === 0 && !app.running && app.states.size === 0 && app.biosId === null, 'elenco svuotato');
    ok(app.start(null) === false, 'senza BIOS non si avvia');
  }

  // ---- passo a tempo (senza audio): 50 Hz circa con rAF a 60 Hz
  {
    const a = mk(null);
    await a.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    a.start(a.lib.games[0].id);
    let tt = 0, frames = 0;
    for (let i = 0; i < 600; i++) { tt += 1000 / 60; frames += a.step(tt); }
    const secs = 600 / 60;
    ok(Math.abs(frames / secs - 49.7) < 1.5, 'passo a tempo: ' + (frames / secs).toFixed(1) + ' fotogrammi/s (PAL ~49,7)');
    a.setPaused(true);
    const f0 = a.framesRun;
    for (let i = 0; i < 30; i++) { tt += 17; a.step(tt); }
    ok(a.framesRun === f0, 'in pausa non gira');
    a.setPaused(false);
    // un salto lungo (scheda in secondo piano) non fa recuperare troppo
    tt += 30000; const n = a.step(tt); tt += 17; const n2 = a.step(tt);
    ok(n <= 3 && n2 <= 3, 'dopo una lunga pausa del browser non si recupera tutto (' + n + ', ' + n2 + ')');
    const stt = a.takeStats();
    ok(stt && stt.n > 100 && stt.avg > 0, 'statistiche: ' + stt.avg.toFixed(2) + ' ms/fotogramma');
  }

  // ---- passo guidato dall'audio (AudioContext finto)
  {
    const sink = new AudioOutput({Ctx: FakeCtx});
    const a = mk(sink);
    await a.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    a.start(a.lib.games[0].id);
    ok(!a.audio && !a.audioPaced, 'senza gesto dell\'utente: niente audio');
    ok(a.enableAudio() && a.audio && a.audioPaced, 'dopo il gesto: audio attivo');
    const ctx = sink.ctx;
    let frames = 0, minQ = 9, maxQ = 0;
    const dtms = 1000 / 60;
    let tt = 0;
    for (let i = 0; i < 900; i++) {
      tt += dtms; ctx.currentTime += dtms / 1000;
      frames += a.step(tt);
      if (i > 20) { minQ = Math.min(minQ, sink.queued()); maxQ = Math.max(maxQ, sink.queued()); }
    }
    const secs = 900 / 60;
    ok(Math.abs(frames / secs - 49.7) < 1.5, 'guidato dall\'audio: ' + (frames / secs).toFixed(1) + ' fotogrammi/s');
    ok(sink.underruns <= 1, 'nessun vuoto nella coda (vuoti: ' + sink.underruns + ')');
    ok(minQ > 0.02 && maxQ < 0.2, 'coda fra ' + minQ.toFixed(3) + ' e ' + maxQ.toFixed(3) + ' s');
    ok(Math.abs(ctx.samples / 44100 - frames * a.con.frameCycles / a.con.cyclesPerSecond) < 0.01, 'campioni prodotti = tempo emulato (' + (ctx.samples / 44100).toFixed(3) + ' s)');
    // pausa svuota la coda; cambio gioco ricrea l'audio
    a.setPaused(true);
    ok(sink.queued() === 0, 'pausa: coda svuotata');
    a.setPaused(false);
    const au = a.audio;
    a.start(a.lib.games[0].id);
    ok(a.audio && a.audio !== au && a.audioPaced, 'riavvio: audio nuovo');
    a.setVolume(0.3); a.setMuted(true);
    ok(sink.volume === 0.3 && sink.muted, 'volume e silenzio arrivano all\'uscita');
    a.resetConsole();
    ok(sink.queued() === 0, 'reset: coda svuotata');
  }

  // ---- telefono (tappa 8): orologio dell'audio che avanza a blocchi di 4096 campioni a 48 kHz (85 ms), chiamate del browser a 66 Hz.
  // Prima della tappa 8 (passo guidato dalla coda dell'audio) qui si emulavano circa 35 fotogrammi al secondo con 11,7 vuoti al secondo.
  {
    class JumpyCtx extends FakeCtx { constructor() { super(); this.sampleRate = 48000; } }
    const sink = new AudioOutput({Ctx: JumpyCtx});
    const a = mk(sink);
    await a.openFiles([rd('bios/o2rom.bin'), rd('killerbees.bin')]);
    a.start(a.lib.games[0].id);
    a.enableAudio();
    const ctx = sink.ctx, blk = 4096 / 48000;
    let tt = 0, frames = 0, u0 = 0, maxQ = 0;
    for (let i = 0; i < 66 * 20; i++) {
      tt += 1000 / 66;
      ctx.currentTime = Math.floor(tt / 1000 / blk) * blk;
      const n = a.step(tt);
      if (i === 66 * 3) { frames = 0; u0 = sink.underruns; }
      if (i > 66 * 3) { frames += n; maxQ = Math.max(maxQ, sink.queued()); }
    }
    const fps = frames / 17;
    ok(Math.abs(fps - 49.7) < 0.7, 'telefono con l\'audio a blocchi di 85 ms: ' + fps.toFixed(1) + ' fotogrammi/s (atteso ~49,7)');
    ok(sink.underruns - u0 === 0, 'telefono: l\'audio non va mai a vuoto dopo i primi 3 secondi (' + (sink.underruns - u0) + ')');
    ok(sink.lead > 0.13 && sink.lead < 0.16 && a.pacer.lead === sink.lead, 'telefono: anticipo adattato (' + Math.round(sink.lead * 1000) + ' ms) e passato all\'uscita audio');
    ok(maxQ < 0.3, 'telefono: coda al massimo ' + Math.round(maxQ * 1000) + ' ms');
    // coda cresciuta oltre misura (audio fermo): si svuota
    sink.next = ctx.currentTime + 2;
    a.step(tt += 15);
    ok(sink.queued() < 1, 'coda oltre ' + 1 + ' s: svuotata (' + sink.queued().toFixed(2) + ' s)');
  }

  console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ECCEZIONE ' + (e.stack || e)); process.exit(1); });
