'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_charlive.js - sostituzione del set di caratteri «a caldo» (editor): Console.replaceCharset / replaceEfRom e App.replace*Live / revert*Live.
// Oracolo: una console costruita da zero col set nuovo, e la stessa console con set vecchio -> sostituzione -> stessi quadri. Serve la cartella dei dump.
// Uso: node test/test_charlive.js [DUMPS]
const fs = require('fs');
const path = require('path');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const {Console} = require(SP('console.js'));
const {App} = require(SP('app.js'));
const {sha256} = require(SP('sha256.js'));
const own = new Uint8Array(require('../hw/charset_own.js').build());
const ownEf = new Uint8Array(require('../hw/charset9341_own.js').build());

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };
const throws = (f, m) => { let e = null; try { f(); } catch (x) { e = x; } ok(!!e, m); };
const dumps = process.argv[2] || process.env.O2_DUMPS;
if (!dumps) { console.log('serve la cartella dei dump'); process.exit(1); }
const rd = (p) => new Uint8Array(fs.readFileSync(path.join(dumps, p)));

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rb = (n) => Uint8Array.from({length: n}, () => (rnd() * 256) | 0);
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const frames = (con, n) => { for (let i = 0; i < n; i++) con.runFrame(); return Uint8Array.from(con.vdc.fb); };

const bios = rd('bios/o2rom.bin'), cart = rd('blockout.bin');
const A = rb(512), B = rb(512);
{
  // chip video: A -> B a meta' strada = B dall'inizio (il menu del BIOS non dipende dalle collisioni)
  const c1 = new Console({bios, cart, charset: A, standard: 'PAL'});
  const c2 = new Console({bios, cart, charset: B, standard: 'PAL'});
  const c0 = new Console({bios, cart, charset: A, standard: 'PAL'});
  frames(c1, 60); frames(c2, 60); frames(c0, 60);
  ok(c1.vdc.fb.some((v) => v !== c1.vdc.fb[0]), 'chip video: il menu del BIOS mostra qualcosa (la prova non e\' vuota)');
  const before = Uint8Array.from(c1.vdc.fb);
  ok(sameBytes(before, c0.vdc.fb), 'chip video: due console uguali danno lo stesso quadro (determinismo)');
  c1.replaceCharset(B);
  ok(sameBytes(before, c1.vdc.fb), 'chip video: la sostituzione non cambia il quadro gia\' disegnato');
  const f1 = frames(c1, 3), f2 = frames(c2, 3), f0 = frames(c0, 3);
  ok(sameBytes(f1, f2), 'chip video: dopo la sostituzione i quadri sono quelli di una console nata con il set nuovo');
  ok(!sameBytes(f1, f0), 'chip video: e sono diversi da quelli del set vecchio (la prova non e\' vuota)');
  ok(c1.hashes.charset === sha256(B) && c1.hashes.charset === c2.hashes.charset, 'chip video: l\'impronta del set si aggiorna');
  // lo stato salvato dopo porta l'impronta nuova: caricato in c2 non da' avvisi sul set
  const st = JSON.parse(JSON.stringify(c1.saveState()));
  ok(c2.loadState(st).length === 0, 'chip video: stato salvato dopo la sostituzione, ripreso da una console col set nuovo: nessun avviso');
  ok(c0.loadState(st).some((w) => /set di caratteri/.test(w)), 'chip video: ... e con il set vecchio: avviso sul set');
  // il buffer passato non e' condiviso: modificarlo dopo non cambia la console
  const B2 = Uint8Array.from(B);
  c1.replaceCharset(B2); B2.fill(0);
  ok(sameBytes(c1.vdc.charset, B), 'chip video: la console copia i byte (non tiene il buffer dell\'editor)');
  throws(() => c1.replaceCharset(new Uint8Array(511)), 'chip video: 511 byte rifiutati');
  throws(() => c1.replaceCharset([1, 2, 3]), 'chip video: non-Uint8Array rifiutato');
  throws(() => c1.replaceEfRom(ownEf), 'EF: su una console non G7400 rifiutato');
  ok(sameBytes(c1.vdc.charset, B) && c1.hashes.charset === sha256(B), 'chip video: dopo i rifiuti il set e\' quello di prima');
}
{
  // G7400: ROM dell'EF9341
  const g = rd('bios/g7400.bin');
  const E1 = Uint8Array.from(ownEf), E2 = Uint8Array.from(ownEf);
  for (let i = 0; i < 2560; i += 7) E2[i] ^= 0xFF;
  const mk = (e) => new Console({bios: g, cart, charset: own, standard: 'PAL', g7400: true, efRom: e, cartBHigh: false});
  const c1 = mk(E1), c2 = mk(E2), c0 = mk(E1);
  frames(c1, 80); frames(c2, 80); frames(c0, 80);
  ok(c1.vdc.fb.some((v) => v !== c1.vdc.fb[0]), 'EF9341: il menu del G7400 mostra qualcosa');
  c1.replaceEfRom(E2);
  const f1 = frames(c1, 3), f2 = frames(c2, 3), f0 = frames(c0, 3);
  ok(sameBytes(f1, f2), 'EF9341: dopo la sostituzione i quadri sono quelli di una console nata con la ROM nuova');
  ok(!sameBytes(f1, f0), 'EF9341: e sono diversi da quelli della ROM vecchia');
  ok(c1.hashes.efrom === sha256(E2), 'EF9341: l\'impronta della ROM si aggiorna');
  const E3 = Uint8Array.from(E2); c1.replaceEfRom(E3); E3.fill(1);
  ok(sameBytes(c1.ef.rom, E2), 'EF9341: la console copia i byte');
  throws(() => c1.replaceEfRom(new Uint8Array(2559)), 'EF9341: 2559 byte rifiutati');
}
(async () => {
  // regista
  const msgs = [];
  const app = new App({onMessage: (t, k) => msgs.push([k, t]), sink: null, fallbackCharset: own, fallbackEfCharset: ownEf});
  ok(app.charset === null && app.activeCharset === own, 'regista: all\'inizio vale il set GPL di ripiego');
  app.replaceCharsetLive(B, 'O2web GPL (modificato)');            // senza console: solo memorizzato
  ok(app.charset && sameBytes(app.charset, B) && app.charsetName === 'O2web GPL (modificato)' && app.activeCharset === app.charset, 'regista: set modificato memorizzato senza console');
  {
    const rev0 = app.rev, cr0 = app.charRev;
    app.replaceCharsetLive(rb(512), 'O2web GPL (modificato)');
    ok(app.rev === rev0 && app.charRev === cr0 + 1, 'regista: secondo ritocco con lo stesso nome: charRev sale, rev no (l\'elenco non si rifa)');
    app.replaceCharsetLive(rb(512), 'altro nome');
    ok(app.rev === rev0 + 1 && app.charRev === cr0 + 2, 'regista: cambio di nome: sale anche rev');
    app.replaceCharsetLive(B, 'O2web GPL (modificato)');
    ok(app.rev === rev0 + 2 && app.charRev === cr0 + 3, 'regista: di nuovo il nome di prima: rev sale');
  }
  const C = rb(512); app.replaceCharsetLive(C);
  ok(app.charsetName === 'O2web GPL (modificato)' && sameBytes(app.charset, C), 'regista: senza nome si tiene il precedente');
  C.fill(0);
  ok(!app.charset.every((v) => v === 0), 'regista: il regista copia i byte');
  throws(() => app.replaceCharsetLive(new Uint8Array(100)), 'regista: 100 byte rifiutati');
  throws(() => app.replaceEfCharsetLive(new Uint8Array(512)), 'regista: EF di 512 byte rifiutato');
  const revR = app.rev, crR = app.charRev;
  app.revertCharsetLive();
  ok(app.charset === null && app.charsetName === '' && app.activeCharset === own, 'regista: ritorno al set GPL');
  ok(app.rev === revR + 1 && app.charRev === crR + 1, 'regista: il ritorno al set GPL fa salire rev e charRev');
  {
    const rev0 = app.rev, cr0 = app.charRev;
    app.replaceEfCharsetLive(ownEf, 'ef modificato');
    ok(app.rev === rev0 + 1 && app.charRev === cr0 + 1, 'regista: primo ritocco EF: sale rev e charRev');
    app.replaceEfCharsetLive(ownEf, 'ef modificato');
    ok(app.rev === rev0 + 1 && app.charRev === cr0 + 2, 'regista: secondo ritocco EF con lo stesso nome: solo charRev');
    app.replaceEfCharsetLive(ownEf, 'ef altro');
    ok(app.rev === rev0 + 2 && app.charRev === cr0 + 3, 'regista: EF con un altro nome: sale anche rev');
    app.replaceEfCharsetLive(ownEf, 'ef modificato');
  }
  ok(app.efCharset && app.efCharsetName === 'ef modificato' && app.activeEfCharset === app.efCharset, 'regista: ROM EF modificata memorizzata');
  app.replaceEfCharsetLive(ownEf);
  ok(app.efCharsetName === 'ef modificato', 'regista: EF senza nome si tiene il precedente');
  app.revertEfCharsetLive();
  app.replaceEfCharsetLive(ownEf);
  ok(app.efCharsetName === 'modificato', 'regista: EF senza nome e senza precedente: «modificato»');
  const revE = app.rev, crE = app.charRev;
  app.revertEfCharsetLive();
  ok(app.efCharset === null && app.efCharsetName === '' && app.activeEfCharset === ownEf, 'regista: ritorno alla ROM EF GPL');
  ok(app.rev === revE + 1 && app.charRev === crE + 1, 'regista: il ritorno alla ROM EF GPL fa salire rev e charRev');
  // con una partita in corso: nessun riavvio, la console cambia
  await app.openFiles([{name: 'o2rom.bin', bytes: bios}]);
  app.autoBios();
  const n0 = msgs.length;
  app.start && app.start();
  const con = app.con;
  if (con) {
    const cpuBefore = con.cpu.now;
    app.replaceCharsetLive(B, 'x (modificato)');
    ok(app.con === con && con.cpu.now === cpuBefore, 'regista: la console in uso e il suo orologio non cambiano (nessun riavvio)');
    ok(sameBytes(con.vdc.charset, B) && con.hashes.charset === sha256(B), 'regista: la console in uso ha il set nuovo');
    app.revertCharsetLive();
    ok(sameBytes(con.vdc.charset, own) && con.hashes.charset === sha256(own) && app.con === con, 'regista: ritorno al set GPL a caldo');
    ok(!msgs.some((m) => /riparte|avvio a freddo/.test(m[1]) && msgs.indexOf(m) >= n0 + 2), 'regista: nessun messaggio di riavvio dopo la modifica a caldo');
  } else {
    ok(false, 'regista: nessuna console avviata dal BIOS caricato (app.start)');
  }
  // G7400 in corso: la ROM EF cambia a caldo, il regista non riavvia
  await app.openFiles([{name: 'g7400.bin', bytes: rd('bios/g7400.bin')}]);
  const g74 = app.lib.bios.find((b) => b.known && b.known.system === 'g7400');
  if (g74) {
    app.selectBios(g74.id);
    app.start();
    const cg = app.con;
    ok(cg && cg.g7400, 'regista: console G7400 avviata');
    if (cg && cg.g7400) {
      const E = Uint8Array.from(ownEf); E[100] ^= 0xFF;
      app.replaceEfCharsetLive(E, 'ef x');
      ok(app.con === cg && sameBytes(cg.ef.rom, E) && cg.hashes.efrom === sha256(E), 'regista: la ROM EF della console G7400 in corso cambia a caldo');
      app.revertEfCharsetLive();
      ok(app.con === cg && sameBytes(cg.ef.rom, ownEf) && cg.hashes.efrom === sha256(ownEf), 'regista: ritorno alla ROM EF GPL a caldo');
    }
  } else ok(false, 'regista: BIOS G7400 non riconosciuto');
})().then(() => {
console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli: sostituzione a caldo dei set di caratteri)');
process.exit(fails ? 1 : 0);
});
