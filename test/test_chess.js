'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_chess.js - modulo scacchi C7010: bus dei due lati, latch, reset, rapporto dei tempi, console con BIOS e ROM Z80 di PROVA
// originali (test/chess_testrom.js), salvataggio / ripristino dello stato. Variabile O2_SRC_DIR = cartella src alternativa
// (prove di mutazione): ora O2_SRC_DIR.
const path = require('path');
const {buildZ80Rom, buildBios8048, RESULTS, EXPECTED, TABLE} = require('./chess_testrom.js');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');      // O2_SRC_DIR: copia guastata dalla prova di mutazione
const {ChessModule, SPEED} = require(path.join(SRC, 'chessmod.js'));
const {Console} = require(path.join(SRC, 'console.js'));

let fails = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails++; };
const throws = (fn, re) => { try { fn(); } catch (e) { return re.test(e.message); } return false; };

const Z80ROM = buildZ80Rom();
const BIOS = buildBios8048();
const CHARSET = new Uint8Array(512);

// ---------------------------------------------------------------- 1. bus dello Z80 (indirizzi, specchi, porta)
{
  const m = new ChessModule(Z80ROM, 'PAL');
  check(m.read(0) === 0xF3 && m.read(0x100) === 0x5A && m.read(0x1FFF) === 0xFF, 'ROM: 0x0000-0x1FFF letta cosi\' com\'e\'');
  m.write(0x0100, 0x11); m.write(0x1000, 0x22);
  check(m.read(0x100) === 0x5A && m.read(0x1000) === 0xFF, 'scritture in ROM ignorate');
  check(m.read(0x2000) === 0xFF && m.read(0x8000) === 0xFF && m.read(0xDFFF) === 0xFF, 'zona non mappata: 0xFF');
  m.write(0x2000, 0x33); m.write(0xDFFF, 0x44);
  check(m.read(0x2000) === 0xFF && m.read(0xDFFF) === 0xFF, 'scritture nella zona non mappata ignorate');
  m.write(0xE000, 0xA5);
  check([0xE000, 0xE800, 0xF000, 0xF800].every((a) => m.read(a) === 0xA5), 'RAM da 2 KB specchiata quattro volte');
  m.write(0xFFFF, 0x3C);
  check(m.read(0xE7FF) === 0x3C && m.ram[0x7FF] === 0x3C, 'ultimo byte della RAM e il suo specchio');
  m.write(0xE123, 1); m.write(0xE124, 2);
  check(m.read(0xE123) === 1 && m.read(0xE124) === 2 && m.read(0xE125) === 0, 'celle vicine indipendenti');
  m.latch1 = 0x9B;
  check([0, 1, 0x37, 0xFF, 0x1234, 0xFFFF].every((p) => m.in(p) === 0x9B), 'IN legge il latch 1 con qualunque indirizzo di porta');
  m.out(0x00, 0x12); m.out(0xABCD, 0x34);
  check(m.latch0 === 0x34 && m.latch1 === 0x9B, 'OUT scrive solo il latch 0');
  m.out(1, 0x1FF);
  check(m.latch0 === 0xFF, 'OUT tiene 8 bit');
}

// ---------------------------------------------------------------- 2. bus dell'8048: condizioni di accesso
{
  const m = new ChessModule(Z80ROM, 'PAL');
  m.latch0 = 0x6D;
  const okP1 = [0x08, 0x0A, 0x2E, 0xEE, 0xEA, 0xAE];     // P1 bit 0 = 0, bit 3 = 1, bit 4 = 0 (gli altri bit non contano)
  const noP1 = [0x00, 0x02, 0xE6, 0xE0, 0x09, 0x18, 0x19, 0xFF, 0xFD, 0xEF, 0x01, 0x10];
  check(okP1.every((p) => m.read8048(0xA0, p) === 0x6D), 'lettura del latch 0 con P1 bit 0 = 0, bit 3 = 1 e bit 4 = 0');
  check(noP1.every((p) => m.read8048(0xA0, p) === 0xFF), 'bus a 0xFF se P1 bit 0 o bit 4 valgono 1, o se il chip video e\' selezionato (bit 3 = 0)');
  const addrYes = [0xA0, 0xA1, 0xBF, 0xE5, 0xFF, 0xAA], addrNo = [0x00, 0x20, 0x80, 0x9F, 0x5F, 0xDF, 0x7F];
  check(addrYes.every((a) => m.read8048(a, 0x08) === 0x6D), 'lettura: risponde con (indirizzo & 0xA0) == 0xA0');
  check(addrNo.every((a) => m.read8048(a, 0x08) === 0xFF), 'lettura: altrimenti 0xFF');
  m.write8048(0x80, 0x5E, 0x08);
  check(m.latch1 === 0x5E, 'scrittura con A7 = 1: latch 1');
  m.write8048(0x7F, 0x11, 0x08); m.write8048(0x00, 0x11, 0x08);
  check(m.latch1 === 0x5E, 'scrittura con A7 = 0: ignorata');
  for (const p of [0x09, 0x18, 0x19, 0x00, 0xE6]) m.write8048(0xFF, 0x22, p);
  check(m.latch1 === 0x5E, 'scrittura con P1 bit 0 o bit 4 a 1, o con il chip video selezionato (P1 = 0xE6 come nell\'interrupt della cartuccia): ignorata');
  m.write8048(0xC3, 0x1AB, 0x2E);
  check(m.latch1 === 0xAB && m.latch0 === 0x6D, 'scrittura: 8 bit, il latch 0 non cambia');
}

// ---------------------------------------------------------------- 3. tempo: rapporto dei T dello Z80 per ciclo dell'8048
{
  for (const [std, num, den] of [['PAL', 45, 8], ['NTSC', 17734475, 2863636]]) {
    const m = new ChessModule(Z80ROM, std);
    m.advance(0, 0x02);                                   // rilascia il reset
    check(m.running === 1 && m.target === 0, std + ': reset rilasciato al tempo 0');
    let now = 0;
    for (let i = 0; i < 4000; i++) { now += 1 + (i % 3); m.advance(now, 0x02); }
    const exact = Math.floor(now * num / den);
    check(m.target === exact, std + ': bersaglio = cicli * ' + num + '/' + den + ' (' + m.target + ' = ' + exact + ')');
    check(m.cpu.t >= m.target && m.cpu.t - m.target < 30, std + ': lo Z80 supera il bersaglio di meno di un\'istruzione (' + (m.cpu.t - m.target) + ')');
    // lunghi tratti in una volta: stesso risultato dei passi piccoli
    const m2 = new ChessModule(Z80ROM, std);
    m2.advance(0, 0x02); m2.advance(now, 0x02);
    check(m2.target === m.target && m2.frac === m.frac, std + ': un salto unico dà lo stesso bersaglio e lo stesso resto');
  }
  const m = new ChessModule(Z80ROM, 'PAL');
  m.advance(1000, 0x00);
  check(m.running === 0 && m.cpu.t === m.target && m.cpu.pc === 0 && m.target === 5625, 'in reset lo Z80 non esegue: il tempo scorre, il PC resta a 0');
  m.advance(1004, 0x02);
  check(m.running === 1 && m.cpu.pc === 0, 'fronte 0 -> 1: lo Z80 riparte dal vettore 0');
  m.advance(1100, 0x02);
  check(m.cpu.pc !== 0 && m.ram[0x10F] !== undefined, 'dopo il rilascio lo Z80 esegue');
}

// ---------------------------------------------------------------- 4. console con BIOS e ROM Z80 di prova
function makeConsole(std, withChess = true) {
  return new Console({bios: BIOS, cart: null, charset: CHARSET, standard: std, chessRom: withChess ? Z80ROM : undefined});
}
function results(c) { return Array.from(c.xram.subarray(0, EXPECTED.length)); }
const CYCLES_TOTAL = 400000;                              // circa un secondo di console: abbondante

for (const std of ['PAL', 'NTSC']) {
  const c = makeConsole(std);
  c.runCycles(CYCLES_TOTAL);
  const r = results(c);
  const bad = [];
  for (let i = 0; i < EXPECTED.length; i++) if (r[i] !== EXPECTED[i]) bad.push(i + ':' + r[i].toString(16) + '!=' + EXPECTED[i].toString(16));
  check(bad.length === 0, std + ': il programma di prova ottiene tutti i ' + EXPECTED.length + ' risultati attesi' + (bad.length ? ' (' + bad.join(' ') + ')' : ''));
  check(c.chess.ram[0x10F] === 2, std + ': la RAM del modulo resta dopo il reset (contatore avvii = 2)');
  check(c.chess.running === 1, std + ': a fine prova il modulo e\' libero');
}

// senza il modulo l'8048 non vede nulla: tutte le letture del latch danno 0xFF
{
  const c = makeConsole('PAL', false);
  c.runCycles(CYCLES_TOTAL);
  const r = results(c);
  check(c.chess === null && r[RESULTS.echo01] === 0xFF && r[RESULTS.table] === 0xFF && r[RESULTS.boots] === 0xFF, 'senza modulo il bus resta a 0xFF');
}

// il modulo e' per G7000/G7200 (non per il G7400)
check(throws(() => new Console({bios: BIOS, cart: null, charset: CHARSET, standard: 'PAL', g7400: true, efRom: new Uint8Array(2560), chessRom: Z80ROM}), /G7400/),
  'modulo scacchi + G7400: rifiutato');
check(throws(() => new ChessModule(new Uint8Array(100), 'PAL'), /8192/), 'ROM Z80 di misura sbagliata: rifiutata');

// il tempo del modulo segue quello dell'8048 senza deriva
{
  const c = makeConsole('PAL');
  c.runCycles(123456);
  const now = c.cpu.now;
  const exact = Math.floor(c.chess.lastNow * 45 / 8);
  check(c.chess.lastNow <= now && now - c.chess.lastNow < 16 && c.chess.target === exact, 'dopo 123456 cicli il bersaglio dello Z80 e\' esatto (' + c.chess.target + ')');
}

// ---------------------------------------------------------------- 5. stato: salvataggio e ripresa
{
  const a = makeConsole('PAL');
  a.runCycles(70001);                                      // in mezzo al protocollo
  const snap = JSON.parse(JSON.stringify(a.saveState()));
  check(snap.version === 4 && snap.chess && snap.hashes.chess && snap.hashes.chess.length > 8, 'lo stato contiene il modulo e l\'impronta della sua ROM');
  a.runCycles(CYCLES_TOTAL);
  const ra = results(a), sa = JSON.stringify(a.saveState());
  const b = makeConsole('PAL');
  b.loadState(snap);
  b.runCycles(CYCLES_TOTAL);
  check(JSON.stringify(results(b)) === JSON.stringify(ra) && JSON.stringify(b.saveState()) === sa, 'ripresa da uno stato salvato: stesso risultato e stesso stato finale (deterministica)');
  check(JSON.stringify(ra) === JSON.stringify(EXPECTED), 'e la prova continua a riuscire dopo il ripristino');

  // stato salvato con altra ROM Z80 / senza modulo / con modulo su console senza
  const other = Z80ROM.slice(); other[0x1FFF] ^= 0x55;
  const c2 = new Console({bios: BIOS, cart: null, charset: CHARSET, standard: 'PAL', chessRom: other});
  check(throws(() => c2.loadState(snap), /altra ROM del modulo/), 'stato di un\'altra ROM del modulo: rifiutato');
  const plain = makeConsole('PAL', false);
  check(throws(() => plain.loadState(snap), /con il modulo scacchi/), 'stato con modulo su console senza: rifiutato');
  plain.runCycles(5000);
  const sp = JSON.parse(JSON.stringify(plain.saveState()));
  check(sp.chess === undefined && throws(() => makeConsole('PAL').loadState(sp), /senza il modulo scacchi/), 'stato senza modulo su console con: rifiutato');

  // stati manomessi: rifiutati SENZA toccare la macchina
  const mk = () => { const m = makeConsole('PAL'); m.runCycles(70001); return m; };
  const mutations = {
    'RAM corta': (s) => { s.chess.ram.pop(); },
    'byte di RAM fuori campo': (s) => { s.chess.ram[5] = 256; },
    'latch non intero': (s) => { s.chess.latch0 = 1.5; },
    'latch1 fuori campo': (s) => { s.chess.latch1 = -1; },
    'resto del tempo fuori campo': (s) => { s.chess.frac = 8; },
    'bersaglio negativo': (s) => { s.chess.target = -5; },
    'reset non 0/1': (s) => { s.chess.running = 2; },
    'tempo dell\'8048 incoerente': (s) => { s.chess.lastNow += 100; },
    'tempo dello Z80 incoerente': (s) => { s.chess.target += 1000; },
    'stato della CPU Z80 mancante': (s) => { delete s.chess.cpu; },
    'modulo non oggetto': (s) => { s.chess = 5; },
  };
  for (const name of Object.keys(mutations)) {
    const s = JSON.parse(JSON.stringify(snap));
    mutations[name](s);
    const m = mk();
    const before = JSON.stringify(m.saveState());
    let rej = false;
    try { m.loadState(s); } catch (e) { rej = true; }
    check(rej && JSON.stringify(m.saveState()) === before, 'stato manomesso (' + name + '): rifiutato e macchina intatta');
  }
}

// ---------------------------------------------------------------- 6. compatibilita' con gli stati vecchi (versioni 1-3, senza modulo)
{
  const c = makeConsole('PAL', false);
  c.runCycles(20000);
  const s = JSON.parse(JSON.stringify(c.saveState()));
  s.version = 3;
  const d = makeConsole('PAL', false);
  d.loadState(s);
  check(d.cpu.now === c.cpu.now, 'uno stato di versione 3 (senza modulo) si carica ancora');
}

// ---------------------------------------------------------------- 7. valori dopo l'accensione, costanti, bit del reset
{
  const m = new ChessModule(Z80ROM, 'PAL');
  check(m.ram.length === 2048 && m.ram.every((v) => v === 0), 'RAM di 2 KB azzerata all\'accensione');
  check(m.latch0 === 0 && m.latch1 === 0 && m.running === 0 && m.target === 0 && m.frac === 0 && m.lastNow === 0, 'latch, reset e tempi a 0 all\'accensione');
  m.ram[5] = 9; m.latch0 = 7; m.latch1 = 8; m.advance(100, 0x02);
  m.reset();
  check(m.ram[5] === 0 && m.latch0 === 0 && m.latch1 === 0 && m.running === 0 && m.target === 0 && m.lastNow === 0 && m.cpu.pc === 0 && m.cpu.t === 0, 'reset(): tutto torna all\'accensione');
  check(JSON.stringify(SPEED) === JSON.stringify({PAL: [45, 8], NTSC: [17734475, 2863636]}), 'costanti di velocita\'');
  // rapporto esatto su tempi lunghi (in reset: lo Z80 non esegue, quindi si puo' saltare molto lontano)
  for (const [std, num, den] of [['PAL', 45n, 8n], ['NTSC', 17734475n, 2863636n]]) {
    const q = new ChessModule(Z80ROM, std);
    q.advance(100000000, 0x00);
    check(BigInt(q.target) === (100000000n * num) / den && q.cpu.t === q.target && BigInt(q.frac) === (100000000n * num) % den, std + ': 10^8 cicli = ' + q.target + ' T (esatto, con il resto)');
  }
  // il reset e' il bit 1 di P1 e nessun altro
  const r = new ChessModule(Z80ROM, 'PAL');
  for (const p1 of [0x00, 0x01, 0x04, 0xFD, 0x10, 0xE5]) { r.advance(r.lastNow + 3, p1); check(r.running === 0, 'P1 = 0x' + p1.toString(16) + ': bit 1 a zero -> in reset'); }
  for (const p1 of [0x02, 0x03, 0xFF, 0x06, 0xAE]) { r.advance(r.lastNow + 3, p1); check(r.running === 1, 'P1 = 0x' + p1.toString(16) + ': bit 1 a uno -> libero'); r.advance(r.lastNow + 3, 0); }
  // il fronte di salita riparte da 0: stato della CPU azzerato, il tempo no
  const f = new ChessModule(Z80ROM, 'PAL');
  f.advance(10, 0x02); f.advance(2000, 0x02);
  check(f.cpu.pc !== 0, 'lo Z80 corre mentre e\' libero');
  f.advance(2004, 0x00);
  check(f.running === 0 && f.cpu.pc === 0 && f.cpu.t === f.target, 'fronte di discesa: Z80 fermo al vettore 0, tempo allineato');
  f.ram[3] = 0x44; f.latch0 = 0x33;
  f.advance(2010, 0x02);
  check(f.running === 1 && f.cpu.pc === 0 && f.ram[3] === 0x44 && f.latch0 === 0x33, 'fronte di salita: la RAM e i latch sopravvivono al reset');
  // dt = 0 non cambia niente, dt negativo nemmeno (il tempo non torna indietro)
  const t0 = f.target, l0 = f.lastNow;
  f.advance(l0, 0x02); f.advance(l0 - 5, 0x02);
  check(f.target === t0 && f.lastNow === l0, 'stesso istante o istante passato: nessun cambiamento');
}

// ---------------------------------------------------------------- 8. convalida dello stato, bordo per bordo (ChessModule.loadState diretto)
{
  const mkRun = () => { const m = new ChessModule(Z80ROM, 'PAL'); m.advance(0, 0x02); m.advance(1000, 0x02); m.ram[10] = 0; m.ram[11] = 255; m.latch0 = 255; m.latch1 = 0; return m; };
  const src = mkRun(), base = JSON.parse(JSON.stringify(src.saveState())), now = src.lastNow;
  const mkStopped = () => { const m = new ChessModule(Z80ROM, 'PAL'); m.advance(1000, 0x00); return m; };
  const stopped = JSON.parse(JSON.stringify(mkStopped().saveState()));
  const tryLoad = (state, cpuNow, std) => {
    const m = new ChessModule(Z80ROM, std || 'PAL');
    const snap = JSON.stringify(m.saveState());
    try { m.loadState(state, cpuNow); return {ok: true, m}; } catch (e) { return {ok: false, msg: e.message, same: JSON.stringify(m.saveState()) === snap}; }
  };
  const acc = (mut, msg, cpuNow, from) => {
    const s = JSON.parse(JSON.stringify(from || base)); mut(s);
    const r = tryLoad(s, cpuNow === undefined ? now : cpuNow);
    check(r.ok, 'stato accettato: ' + msg + (r.ok ? '' : ' (' + r.msg + ')'));
    return r;
  };
  const rej = (mut, msg, cpuNow, from) => {
    const s = JSON.parse(JSON.stringify(from || base)); mut(s);
    const r = tryLoad(s, cpuNow === undefined ? now : cpuNow);
    check(!r.ok && /stato non valido/.test(r.msg) && r.same, 'stato rifiutato e macchina intatta: ' + msg + (r.ok ? ' (accettato!)' : r.same ? '' : ' (macchina toccata)'));
  };
  acc(() => {}, 'lo stato salvato com\'e\'');
  const ld = tryLoad(base, now); check(ld.ok && ld.m.ram[11] === 255 && ld.m.latch0 === 255 && ld.m.lastNow === now && ld.m.running === 1, 'il caricamento riporta RAM, latch, tempi e reset');
  // RAM
  rej((s) => { s.ram = null; }, 'RAM nulla'); rej((s) => { s.ram = s.ram.slice(0, 2047); }, 'RAM di 2047 byte'); rej((s) => { s.ram.push(0); }, 'RAM di 2049 byte');
  rej((s) => { s.ram[0] = 256; }, 'byte di RAM 256'); rej((s) => { s.ram[2047] = -1; }, 'byte di RAM -1'); rej((s) => { s.ram[7] = 0.5; }, 'byte di RAM 0.5'); rej((s) => { s.ram[7] = '5'; }, 'byte di RAM testo');
  acc((s) => { s.ram.fill(0); }, 'RAM tutta a 0'); acc((s) => { s.ram.fill(255); }, 'RAM tutta a 255');
  { const m = new ChessModule(Z80ROM, 'PAL'); let msg = ''; try { m.loadState(null, 0); } catch (e) { msg = e.message; } check(/stato non valido/.test(msg), 'stato nullo: messaggio ' + msg); }
  // latch
  acc((s) => { s.latch0 = 0; s.latch1 = 0; }, 'latch a 0'); acc((s) => { s.latch0 = 255; s.latch1 = 255; }, 'latch a 255');
  rej((s) => { s.latch0 = 256; }, 'latch 0 = 256'); rej((s) => { s.latch0 = -1; }, 'latch 0 = -1'); rej((s) => { s.latch1 = 256; }, 'latch 1 = 256'); rej((s) => { s.latch1 = -1; }, 'latch 1 = -1');
  // resto dell'accumulatore: 0 .. den - 1 (den = 8 in PAL)
  acc((s) => { s.frac = 0; }, 'resto 0'); acc((s) => { s.frac = 7; }, 'resto 7 (= den - 1)'); rej((s) => { s.frac = 8; }, 'resto 8 (= den)'); rej((s) => { s.frac = -1; }, 'resto -1');
  { const ntsc = new ChessModule(Z80ROM, 'NTSC'); const s = JSON.parse(JSON.stringify(base)); s.frac = 1431817;
    let ok1 = true; try { ntsc.loadState(s, now); } catch (e) { ok1 = false; } check(ok1, 'NTSC: resto = den - 1 accettato (il limite viene dallo standard)');
    s.frac = 2863636; let ok2 = false; try { ntsc.loadState(s, now); } catch (e) { ok2 = true; } check(ok2, 'NTSC: resto = den rifiutato'); }
  // tempi
  acc((s) => { s.target = 0; s.lastNow = 0; s.cpu.t = 0; }, 'tempi a 0', 0);
  rej((s) => { s.target = -1; }, 'bersaglio -1'); rej((s) => { s.lastNow = -1; }, 'ultimo istante -1', 0);
  rej((s) => { s.target = 1.5; }, 'bersaglio non intero'); rej((s) => { s.lastNow = 2.5; }, 'ultimo istante non intero', 3);
  acc(() => {}, 'tempo della console = ultimo istante', now); acc(() => {}, 'tempo della console 16 cicli oltre', now + 16);
  rej(() => {}, 'tempo della console 17 cicli oltre', now + 17); rej(() => {}, 'tempo della console prima dell\'ultimo istante', now - 1);
  acc(() => {}, 'tempo della console non dato (nessuna verifica)', undefined);
  { const m = new ChessModule(Z80ROM, 'PAL'); let o = true; try { m.loadState(JSON.parse(JSON.stringify(base)), NaN); } catch (e) { o = false; } check(o, 'tempo della console non intero: nessuna verifica di coerenza'); }
  // reset e tempo dello Z80
  acc((s) => { s.running = 0; s.cpu.t = s.target; }, 'in reset con lo Z80 al bersaglio'); rej((s) => { s.running = 2; }, 'running = 2'); rej((s) => { s.running = -1; }, 'running = -1');
  rej((s) => { s.running = 0; s.cpu.t = s.target + 1; }, 'in reset con lo Z80 un T oltre il bersaglio'); rej((s) => { s.running = 0; s.cpu.t = s.target - 1; }, 'in reset con lo Z80 un T prima');
  acc((s) => { s.cpu.t = s.target + 64; }, 'in corsa: Z80 64 T oltre il bersaglio'); acc((s) => { s.cpu.t = s.target - 64; }, 'in corsa: Z80 64 T prima');
  rej((s) => { s.cpu.t = s.target + 65; }, 'in corsa: Z80 65 T oltre'); rej((s) => { s.cpu.t = s.target - 65; }, 'in corsa: Z80 65 T prima');
  acc(() => {}, 'fermo, com\'e\'', now, stopped);
  rej((s) => { s.cpu = null; }, 'stato dello Z80 nullo'); rej((s) => { s.cpu.pc = 70000; }, 'PC dello Z80 fuori campo');
}

console.log(fails ? '\n' + fails + ' PROVE FALLITE' : '\nTUTTO OK');
process.exit(fails ? 1 : 0);
