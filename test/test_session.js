'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_session.js - file di sessione: andata e ritorno, determinismo, controllo con Python, rifiuto di sessioni false o corrotte
// (voci mancanti, in piu', duplicate, impronte e dimensioni sbagliate, stati di altre cartucce...), prove di rovinamento casuale.
// Le prove usano byte casuali (nessun dump). Con la cartella dei dump (O2_DUMPS o argomento) prova anche una sessione vera:
// raccolta TOSEC + BIOS + stato di gioco, e la ripresa deterministica dopo aver riaperto la sessione (in locale: non si consegna).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const S = require(SP('session.js'));
const L = require(SP('library.js'));
const {zipStore} = require(SP('zipstore.js'));
const {listZip, extractEntry} = require(SP('unzip.js'));
const {sha256} = require(SP('sha256.js'));
const {defaultBindings} = require(SP('input.js'));

let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function rejects(bytes, re, m) {
  checks++;
  try { S.parseSession(bytes); fails++; console.log('FAIL (non ha rifiutato) ' + m); } catch (e) {
    if (!(e instanceof S.SessionError)) { fails++; console.log('FAIL (eccezione sbagliata ' + e.constructor.name + ': ' + e.message + ') ' + m); } else if (re && !re.test(e.message)) {
      fails++; console.log('FAIL (messaggio «' + e.message + '» non corrisponde a ' + re + ') ' + m);
    }
  }
}
let seed = 5;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const bytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b; };
const enc = new TextEncoder(), dec = new TextDecoder();

(async () => {
  // ---- elenco finto
  const lib = new L.Library();
  await lib.addFile('bios uno.bin', bytes(1024));
  await lib.addFile('bios due.bin', bytes(1024));
  const names = ['Alfa (1981)(Philips)(EU).bin', 'Beta, The (1982)(Philips)(FR).bin', 'Gamma (198x)(X)(EU)[a].bin'];
  for (let i = 0; i < names.length; i++) await lib.addFile(names[i], bytes(2048 * (i + 1)));
  await lib.addFile('Giochi.zip', zipStore([{name: 'Cartella uno/Delta (1983)(Y)(US).bin', data: bytes(2048)}, {name: 'Cartella due/Epsilon (1984)(Z)(US).bin', data: bytes(4096)}]));
  ok(lib.games.length === 5 && lib.bios.length === 2, 'elenco di partenza');
  const fakeState = (g, biosSha) => ({format: 'o2web-snapshot', version: 2, standard: 'PAL', hashes: {bios: biosSha, cart: g.sha, charset: 'c'.repeat(64)}, cpu: {a: 1}, vdc: {}, xram: [1, 2, 3]});
  const states = new Map([[lib.games[0].id, fakeState(lib.games[0], lib.bios[0].sha)], [lib.games[3].id, fakeState(lib.games[3], lib.bios[1].sha)]]);
  const charset = bytes(512);
  const settings = {scale: 3, aspect: 'tv', integer: true, volume: 0.7, muted: true, bindings: defaultBindings()};
  const opts = {lib, activeGameId: lib.games[2].id, activeBiosId: lib.bios[1].id, standard: 'NTSC', states, charset, settings, created: '2026-10-12T10:00:00.000Z'};
  const file = S.buildSession(opts);
  ok(file.length > 0 && file[0] === 0x50, 'sessione scritta');
  ok(same(file, S.buildSession(opts)), 'determinismo');

  // ---- andata e ritorno
  const p = S.parseSession(file);
  ok(p.standard === 'NTSC' && p.activeGame === 2 && p.activeBios === 1 && p.created === opts.created, 'campi generali');
  ok(p.games.length === 5 && p.bios.length === 2, 'numero di voci');
  p.games.forEach((g, i) => ok(g.name === lib.games[i].name && g.folder === lib.games[i].folder && g.sha === lib.games[i].sha && same(g.data, lib.games[i].data), 'gioco ' + i));
  p.bios.forEach((b, i) => ok(b.name === lib.bios[i].name && same(b.data, lib.bios[i].data), 'bios ' + i));
  ok(p.games[0].state && p.games[1].state === null && p.games[3].state && JSON.stringify(p.games[0].state) === JSON.stringify(states.get(lib.games[0].id)), 'stati');
  ok(same(p.charset, charset), 'set di caratteri');
  ok(JSON.stringify(p.settings) === JSON.stringify(settings), 'impostazioni');
  const r = S.restoreLibrary(p);
  ok(r.lib.games.length === 5 && r.lib.getGame(r.activeGameId).name === lib.games[2].name && r.lib.getBios(r.activeBiosId).name === lib.bios[1].name, 'elenco ricostruito');
  ok(r.states.size === 2 && r.states.has(r.lib.games[0].id) && r.states.has(r.lib.games[3].id), 'stati ricostruiti per id');
  ok(r.lib.games.every((g, i) => g.display === lib.games[i].display && g.map.kind === lib.games[i].map.kind && g.year === lib.games[i].year), 'metadati ricostruiti');
  // senza stati, senza set di caratteri, senza gioco in uso
  {
    const f2 = S.buildSession({lib, standard: 'PAL', created: ''});
    const q = S.parseSession(f2);
    ok(q.activeGame === -1 && q.activeBios === -1 && q.charset === null && q.games.every((g) => g.state === null) && Object.keys(q.settings).length === 0, 'sessione minima');
    const f3 = S.buildSession({lib: new L.Library(), standard: 'PAL'});
    const q3 = S.parseSession(f3);
    ok(q3.games.length === 0 && q3.bios.length === 0, 'sessione vuota');
  }
  // il file contiene l'avviso
  {
    const list = listZip(file);
    const readme = dec.decode(extractEntry(file, list.find((e) => e.name === 'LEGGIMI.txt')));
    const meta = JSON.parse(dec.decode(extractEntry(file, list.find((e) => e.name === 'sessione.json'))));
    ok(/non condividerlo/.test(readme) && /non condividerlo/.test(meta.avviso) && S.WARNING === meta.avviso, 'avviso nel file');
    ok(list.every((e) => e.method === 0), 'zip senza compressione');
  }
  // controllo con strumenti esterni
  if (cp.spawnSync('python3', ['-c', '1']).status === 0) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-'));
    const f = path.join(tmp, 's.zip');
    fs.writeFileSync(f, file);
    const rr = cp.spawnSync('python3', ['-I', '-c', 'import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nm=json.loads(z.read("sessione.json"))\nassert m["format"]=="o2web-session"\nprint(len(z.namelist()), len(m["games"]), len(m["bios"]))', f], {encoding: 'utf8'});
    ok(rr.status === 0 && rr.stdout.trim() === '12 5 2', 'python zipfile: ' + rr.stdout + rr.stderr);
    fs.rmSync(tmp, {recursive: true, force: true});
  }

  // ---- rifiuto: si rifa' lo zip con voci modificate (CRC validi) e si controlla che la sessione sia rifiutata
  const ents = listZip(file).map((e) => ({name: e.name, data: extractEntry(file, e)}));
  const metaOf = () => JSON.parse(dec.decode(ents.find((e) => e.name === 'sessione.json').data));
  // fn modifica le voci e/o il JSON (meta), che poi si riscrive con CRC validi
  function mut(fn, re, m) {
    const es = ents.map((e) => ({name: e.name, data: e.data.slice()}));
    const idx = es.findIndex((e) => e.name === 'sessione.json');
    const meta = JSON.parse(dec.decode(es[idx].data));
    const res = fn(es, meta);
    const out = res || es;
    out[out.findIndex((e) => e.name === 'sessione.json')].data = enc.encode(JSON.stringify(meta));
    rejects(zipStore(out), re, m);
  }
  const without = (es, n) => es.filter((e) => e.name !== n);
  // la modifica nulla deve restare valida (controllo dell'helper)
  {
    const es = ents.map((e) => ({name: e.name, data: e.data.slice()}));
    let good = true;
    try { S.parseSession(zipStore(es)); } catch (e) { good = false; }
    ok(good, 'helper: lo zip rifatto senza modifiche e\' valido');
  }

  mut((es, m) => without(es, 'bios/0001.bin'), /manca/, 'manca un BIOS');
  mut((es, m) => without(es, 'carte/0003.bin'), /manca/, 'manca una cartuccia');
  mut((es, m) => without(es, 'stati/0001.json'), /manca/, 'manca uno stato');
  mut((es, m) => without(es, 'charset.bin'), /manca/, 'manca il set di caratteri');
  mut((es, m) => es.concat([{name: 'carte/0099.bin', data: bytes(2048)}]), /inattesa|non dichiarata/, 'cartuccia in piu\' non dichiarata');
  mut((es, m) => es.concat([{name: 'stati/0002.json', data: enc.encode('{}')}]), /non dichiarata/, 'stato in piu\'');
  mut((es, m) => es.concat([{name: 'virus.exe', data: bytes(10)}]), /inattesa/, 'voce con nome inatteso');
  mut((es, m) => es.concat([{name: '../evil.bin', data: bytes(10)}]), /inattesa/, 'percorso con ..');
  mut((es, m) => es.concat([{name: 'bios/0001.bin ', data: bytes(10)}]), /inattesa/, 'nome quasi giusto');
  mut((es, m) => { m.games[0].sha = m.games[1].sha; }, /impronta/, 'impronta sbagliata');
  mut((es, m) => { m.games[0].sha = 'zz'; }, /impronta non valida/, 'impronta non esadecimale');
  mut((es, m) => { m.games[0].sha = m.games[0].sha.toUpperCase(); }, /impronta non valida/, 'impronta in maiuscolo');
  mut((es, m) => { m.games[0].size += 1; }, /dimensione/, 'dimensione sbagliata');
  mut((es, m) => { m.games[0].size = 0; }, /dimensione/, 'dimensione zero');
  mut((es, m) => { m.games[0].size = 1e9; }, /dimensione/, 'dimensione enorme');
  mut((es, m) => { m.games[0].size = '2048'; }, /dimensione/, 'dimensione testo');
  mut((es, m) => { es.find((e) => e.name === 'carte/0001.bin').data[5] ^= 1; }, /impronta/, 'byte di una cartuccia cambiato (CRC rifatto)');
  mut((es, m) => { es.find((e) => e.name === 'bios/0002.bin').data[5] ^= 1; }, /impronta/, 'byte di un BIOS cambiato');
  mut((es, m) => { es.find((e) => e.name === 'charset.bin').data[5] ^= 1; }, /impronta/, 'byte del set di caratteri cambiato');
  mut((es, m) => { m.games[1] = Object.assign({}, m.games[0], {file: 'carte/0002.bin'}); }, /dimensione|impronta|duplicata/, 'voce che copia un\'altra');
  mut((es, m) => { m.games[1].file = m.games[0].file; }, /nome del file inatteso/, 'due voci con lo stesso file');
  mut((es, m) => { m.games[0].file = 'carte/0009.bin'; }, /nome del file inatteso/, 'file rinominato');
  mut((es, m) => { m.games.push(Object.assign({}, m.games[0], {file: 'carte/0006.bin'})); es.push({name: 'carte/0006.bin', data: es.find((e) => e.name === 'carte/0001.bin').data.slice()}); }, /duplicata/, 'cartuccia duplicata (stessa voce)');
  mut((es, m) => { m.bios.push(Object.assign({}, m.bios[0], {file: 'bios/0003.bin'})); es.push({name: 'bios/0003.bin', data: es.find((e) => e.name === 'bios/0001.bin').data.slice()}); }, /duplicat/, 'BIOS duplicato');
  mut((es, m) => { m.games.pop(); }, /non dichiarata/, 'voce tolta dall\'elenco ma file presente');
  mut((es, m) => { m.format = 'altro'; }, /non e. un file di sessione/, 'formato sbagliato');
  mut((es, m) => { m.version = 4; }, /piu. recente/, 'versione futura');
  mut((es, m) => { m.version = 0; }, /versione/, 'versione zero');
  mut((es, m) => { m.version = '1'; }, /versione/, 'versione testo');
  mut((es, m) => { m.standard = 'SECAM'; }, /standard/, 'standard sbagliato');
  mut((es, m) => { m.activeGame = 5; }, /gioco in uso/, 'gioco in uso fuori elenco');
  mut((es, m) => { m.activeGame = -2; }, /gioco in uso/, 'gioco in uso negativo');
  mut((es, m) => { m.activeGame = 1.5; }, /gioco in uso/, 'gioco in uso frazionario');
  mut((es, m) => { m.activeBios = 2; }, /BIOS in uso/, 'BIOS in uso fuori elenco');
  mut((es, m) => { m.games = {}; }, /elenchi/, 'elenco giochi non e\' un array');
  mut((es, m) => { m.bios = null; }, /elenchi/, 'elenco BIOS nullo');
  mut((es, m) => { m.games[0] = null; }, /voce non valida/, 'voce nulla');
  mut((es, m) => { m.games[0].name = ''; }, /campi/, 'nome vuoto');
  mut((es, m) => { m.games[0].name = 7; }, /campi/, 'nome non testo');
  mut((es, m) => { m.games[0].folder = undefined; }, /campi/, 'cartella mancante');
  mut((es, m) => { m.games[0].state = 'stati/0001.json'; m.games[0].stateBios = null; }, /impronta del BIOS/, 'stato senza impronta del BIOS');
  mut((es, m) => { m.games[1].stateBios = 'a'.repeat(64); }, /senza stato/, 'impronta del BIOS senza stato');
  mut((es, m) => { m.games[0].stateBios = 'a'.repeat(64); }, /incoerente/, 'impronta del BIOS dello stato incoerente');
  mut((es, m) => { m.games[0].state = 'stati/0002.json'; }, /inatteso/, 'nome dello stato sbagliato');
  mut((es, m) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('{"x":1'); }, /JSON/, 'stato non e\' JSON');
  mut((es, m) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('[1,2]'); }, /non e. uno stato/, 'stato non e\' un oggetto');
  mut((es, m) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('{"format":"altro","hashes":{}}'); }, /non e. uno stato/, 'stato di un altro formato');
  mut((es, m) => { const e = es.find((x) => x.name === 'stati/0001.json'); const s = JSON.parse(dec.decode(e.data)); s.hashes.cart = 'b'.repeat(64); e.data = enc.encode(JSON.stringify(s)); }, /altra cartuccia/, 'stato di un\'altra cartuccia');
  mut((es, m) => { const e = es.find((x) => x.name === 'stati/0001.json'); const s = JSON.parse(dec.decode(e.data)); s.hashes.bios = 'b'.repeat(64); e.data = enc.encode(JSON.stringify(s)); }, /incoerente/, 'impronta del BIOS dello stato cambiata');
  mut((es, m) => { m.charset = {file: 'charset.bin', size: 511, sha: m.charset.sha}; }, /set di caratteri/, 'set di caratteri: dimensione');
  mut((es, m) => { m.charset = 5; }, /set di caratteri/, 'set di caratteri: tipo');
  mut((es, m) => { m.charset = null; }, /non dichiarata/, 'set di caratteri presente ma non dichiarato');
  mut((es, m) => { m.settings = 5; }, /impostazioni/, 'impostazioni: tipo');
  mut((es, m) => { m.settings.scale = 99; }, /ingrandimento/, 'impostazioni: scala');
  mut((es, m) => { m.settings.scale = 1.5; }, /ingrandimento/, 'impostazioni: scala frazionaria');
  mut((es, m) => { m.settings.aspect = 'x'; }, /proporzioni/, 'impostazioni: proporzioni');
  mut((es, m) => { m.settings.integer = 'si'; }, /multipli interi/, 'impostazioni: interi');
  mut((es, m) => { m.settings.volume = 2; }, /volume/, 'impostazioni: volume');
  mut((es, m) => { m.settings.volume = NaN; }, /volume/, 'impostazioni: volume NaN');
  mut((es, m) => { m.settings.muted = 1; }, /audio/, 'impostazioni: muto');
  mut((es, m) => { m.settings.bindings['1'].up = ['ArrowUp', 'ArrowUp']; }, /due azioni/, 'impostazioni: tasto doppio');
  mut((es, m) => { m.settings.bindings['2'] = null; }, /associazioni/, 'impostazioni: manca il joystick 2');
  mut((es, m) => { m.settings.bindings['1'].up = ['<script>']; }, /codice di tasto/, 'impostazioni: codice di tasto');
  // ---- messaggi esatti e confini
  {
    const msgOf = (bytes) => { try { S.parseSession(bytes); return null; } catch (e) { return e instanceof S.SessionError ? e.message : 'ECCEZIONE ' + e.constructor.name + ': ' + e.message; } };
    function exact(fn, msg, label) {
      checks++;
      const es = ents.map((e) => ({name: e.name, data: e.data.slice()}));
      const meta = JSON.parse(dec.decode(es.find((e) => e.name === 'sessione.json').data));
      const res = fn(es, meta) || es;
      res[res.findIndex((e) => e.name === 'sessione.json')].data = enc.encode(JSON.stringify(meta));
      const got = msgOf(zipStore(res));
      if (got !== msg) { fails++; console.log('FAIL (messaggio) ' + label + ': «' + got + '» != «' + msg + '»'); }
    }
    const okParse = (fn, label) => {
      checks++;
      const es = ents.map((e) => ({name: e.name, data: e.data.slice()}));
      const meta = JSON.parse(dec.decode(es.find((e) => e.name === 'sessione.json').data));
      const res = fn(es, meta) || es;
      res[res.findIndex((e) => e.name === 'sessione.json')].data = enc.encode(JSON.stringify(meta));
      const got = msgOf(zipStore(res));
      if (got !== null) { fails++; console.log('FAIL (doveva passare) ' + label + ': ' + got); }
    };
    const GN = lib.games[0].name, G1 = 'gioco 1 («' + GN + '»)';
    // dichiarazioni nella directory centrale diverse dal vero (per i limiti senza grandi buffer)
    const u32 = (b, q) => (b[q] | (b[q + 1] << 8) | (b[q + 2] << 16) | (b[q + 3] << 24)) >>> 0;
    const w32 = (b, q, v) => { b[q] = v & 255; b[q + 1] = (v >>> 8) & 255; b[q + 2] = (v >>> 16) & 255; b[q + 3] = (v >>> 24) & 255; };
    const forged = (sizes) => {                                   // sizes: {nomeVoce: dimensioneDichiarata}
      const meta = JSON.parse(dec.decode(ents.find((e) => e.name === 'sessione.json').data));
      const z = zipStore(ents.map((e) => ({name: e.name, data: e.data.slice()})));
      const b = z.slice();
      let q = u32(b, b.length - 22 + 16);
      for (let i = 0; i < ents.length; i++) {
        const nl = b[q + 28] | (b[q + 29] << 8);
        const nm = dec.decode(b.subarray(q + 46, q + 46 + nl));
        if (sizes[nm] !== undefined) w32(b, q + 24, sizes[nm]);
        q += 46 + nl + (b[q + 30] | (b[q + 31] << 8)) + (b[q + 32] | (b[q + 33] << 8));
      }
      return b;
    };
    const sizeOf = (n) => ents.find((e) => e.name === n).data.length;
    const sumOthers = ents.reduce((a, e) => a + e.data.length, 0) - sizeOf('LEGGIMI.txt');
    const TOT = 1024 << 20;
    ok(msgOf(forged({'LEGGIMI.txt': TOT - sumOthers})) === null, 'totale esatto a 1024 MB: ammesso');
    ok(msgOf(forged({'LEGGIMI.txt': TOT - sumOthers + 1})) === 'file di sessione troppo grande', 'totale oltre 1024 MB: rifiutato');
    ok(msgOf(forged({'LEGGIMI.txt': TOT - sumOthers - 1})) === null, 'totale appena sotto: ammesso');
    ok(msgOf(forged({'sessione.json': (16 << 20) + 1})) === '«sessione.json» troppo grande', 'sessione.json oltre 16 MB');
    ok(/^«sessione\.json»: /.test(msgOf(forged({'sessione.json': 16 << 20})) || ''), 'sessione.json di 16 MB esatti: si prova a leggerlo');
    ok(msgOf(forged({'stati/0001.json': (16 << 20) + 1})) === '«stati/0001.json» troppo grande', 'stato oltre 16 MB');
    ok(/^«stati\/0001\.json»: /.test(msgOf(forged({'stati/0001.json': 16 << 20})) || ''), 'stato di 16 MB esatti: si prova a leggerlo');
    ok(msgOf(forged({'carte/0001.bin': 32769})) === '«carte/0001.bin» troppo grande', 'cartuccia oltre 32768 (dichiarata)');
    ok(/^«carte\/0001\.bin»: /.test(msgOf(forged({'carte/0001.bin': 32768})) || ''), 'cartuccia di 32768 dichiarata: si prova a leggerla');
    ok(msgOf(forged({'bios/0001.bin': 32769})) === '«bios/0001.bin» troppo grande', 'BIOS oltre 32768 (dichiarato)');
    ok(msgOf(forged({'charset.bin': 513})) === '«charset.bin» troppo grande', 'set di caratteri oltre 512');
    ok(/^«charset\.bin»: /.test(msgOf(forged({'charset.bin': 511})) || ''), 'set di caratteri 511 dichiarato: si prova a leggerlo');
    // voci duplicate e inattese (messaggi)
    {
      const es = ents.map((e) => ({name: e.name, data: e.data.slice()}));
      let dupMsg = null;
      try { dupMsg = msgOf(zipStore(es.concat([{name: 'carte/0001.bin', data: bytes(10)}]))); } catch (e) { dupMsg = 'zipStore: ' + e.message; }
      ok(dupMsg === 'file di sessione non valido: voce duplicata «carte/0001.bin»' || /^zipStore/.test(dupMsg), 'voce duplicata: ' + dupMsg);
      const long = 'bios/' + 'x'.repeat(70) + '.bin';
      ok(msgOf(zipStore(es.concat([{name: long, data: bytes(10)}]))) === 'file di sessione non valido: voce inattesa «' + long.slice(0, 60) + '»', 'voce inattesa: nome troncato a 60');
      ok(msgOf(zipStore(es.concat([{name: 'x.txt', data: bytes(10)}]))) === 'file di sessione non valido: voce inattesa «x.txt»', 'voce inattesa: messaggio');
      ok(msgOf(zipStore(es.concat([{name: 'carte/0099.bin', data: bytes(10)}]))) === 'file di sessione non valido: voce non dichiarata «carte/0099.bin»', 'voce non dichiarata: messaggio');
      ok(msgOf(zipStore(es.filter((e) => e.name !== 'carte/0001.bin'))) === 'file di sessione incompleto: manca «carte/0001.bin»', 'voce mancante: messaggio');
      ok(msgOf(zipStore(es.filter((e) => e.name !== 'sessione.json'))) === 'file di sessione incompleto: manca «sessione.json»', 'sessione.json mancante: messaggio');
    }
    // dati rovinati: messaggi
    exact((es) => { es.find((e) => e.name === 'carte/0001.bin').data[5] ^= 1; }, G1 + ': impronta SHA-256 diversa da quella dichiarata (file danneggiato)', 'impronta cartuccia');
    exact((es) => { es.find((e) => e.name === 'bios/0002.bin').data[5] ^= 1; }, 'BIOS 2: impronta SHA-256 diversa da quella dichiarata (file danneggiato)', 'impronta BIOS');
    exact((es) => { es.find((e) => e.name === 'charset.bin').data[5] ^= 1; }, 'set di caratteri: impronta SHA-256 diversa da quella dichiarata (file danneggiato)', 'impronta set di caratteri');
    exact((es, m) => { m.games[0].size += 1; }, G1 + ': dimensione diversa da quella dichiarata', 'dimensione diversa');
    exact((es, m) => { m.games[0].size = 0; }, G1 + ': dimensione non valida', 'dimensione zero');
    exact((es, m) => { m.games[0].size = 32769; }, G1 + ': dimensione non valida', 'dimensione 32769');
    exact((es, m) => { m.bios[0].size = 0; }, 'BIOS 1: dimensione non valida', 'dimensione BIOS zero');
    exact((es, m) => { m.games[0].sha = 'zz'; }, G1 + ': impronta non valida', 'impronta non valida');
    exact((es, m) => { m.games[0] = null; }, 'gioco 1: voce non valida', 'voce nulla');
    exact((es, m) => { m.games[0] = [1]; }, 'gioco 1: voce non valida', 'voce array');
    exact((es, m) => { m.games[0].name = 7; }, 'gioco 1: campi non validi', 'nome non testo');
    exact((es, m) => { m.bios[0] = 5; }, 'BIOS 1: voce non valida', 'voce BIOS non oggetto');
    exact((es, m) => { m.games[1] = 'x'; }, 'gioco 2: voce non valida', 'voce gioco 2 non oggetto');
    exact((es, m) => { m.games[0].name = 'n'.repeat(100); m.games[0].sha = 'zz'; }, 'gioco 1 («' + 'n'.repeat(60) + '»): impronta non valida', 'nome troncato a 60 nei messaggi');
    exact((es, m) => { m.games[0].name = ''; }, 'gioco 1 («»): campi non validi', 'nome vuoto');
    exact((es, m) => { m.games[0].file = 'carte/0009.bin'; }, G1 + ': nome del file inatteso', 'file rinominato');
    exact((es, m) => { m.bios[1].file = 'bios/0009.bin'; }, 'BIOS 2: nome del file inatteso', 'BIOS rinominato');
    exact((es, m) => { m.games[1].file = m.games[0].file; }, 'gioco 2 («' + lib.games[1].name + '»): nome del file inatteso', 'due voci con lo stesso file');
    exact((es, m) => { m.games[0].state = 'stati/0002.json'; }, G1 + ': nome dello stato inatteso', 'stato rinominato');
    exact((es, m) => { m.games[0].state = 5; }, G1 + ': stato non valido', 'stato non testo');
    exact((es, m) => { m.games[0].state = 'x'.repeat(41); }, G1 + ': stato non valido', 'stato con nome di 41 caratteri');
    exact((es, m) => { m.games[1].stateBios = 'a'.repeat(64); }, 'gioco 2 («' + lib.games[1].name + '»): impronta del BIOS senza stato', 'impronta senza stato');
    exact((es, m) => { m.games[0].stateBios = null; }, G1 + ': impronta del BIOS dello stato non valida', 'stato senza impronta');
    exact((es, m) => { m.games[0].stateBios = 'A'.repeat(64); }, G1 + ': impronta del BIOS dello stato non valida', 'impronta del BIOS in maiuscolo');
    exact((es, m) => { m.games[0].stateBios = 'a'.repeat(64); }, G1 + ': impronta del BIOS dello stato incoerente', 'impronta del BIOS incoerente');
    exact((es) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('{"x":1'); }, G1 + ': stato: JSON non valido', 'stato non JSON');
    exact((es) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('[1]'); }, G1 + ': lo stato non e’ uno stato di gioco', 'stato array');
    exact((es) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('{"format":"o2web-snapshot"}'); }, G1 + ': lo stato non e’ uno stato di gioco', 'stato senza hashes');
    exact((es) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('{"format":"o2web-snapshot","hashes":5}'); }, G1 + ': lo stato non e’ uno stato di gioco', 'stato con hashes non oggetto');
    exact((es) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('{"format":"x","hashes":{}}'); }, G1 + ': lo stato non e’ uno stato di gioco', 'stato di altro formato');
    exact((es) => { es.find((e) => e.name === 'stati/0001.json').data = enc.encode('null'); }, G1 + ': lo stato non e’ uno stato di gioco', 'stato nullo');
    exact((es, m) => { m.games[0].state = 'stati/0001.json'; const e = es.find((x) => x.name === 'stati/0001.json'); const st = JSON.parse(dec.decode(e.data)); st.hashes.cart = 'b'.repeat(64); e.data = enc.encode(JSON.stringify(st)); },
      G1 + ': lo stato e’ di un’altra cartuccia', 'stato di un\'altra cartuccia');
    exact((es, m) => { m.bios.push(Object.assign({}, m.bios[0], {file: 'bios/0003.bin'})); es.push({name: 'bios/0003.bin', data: es.find((e) => e.name === 'bios/0001.bin').data.slice()}); },
      'BIOS 3: voce duplicata («' + lib.bios[0].name + '»)', 'BIOS duplicato');
    exact((es, m) => { m.games.push(Object.assign({}, m.games[0], {file: 'carte/0006.bin', state: null, stateBios: null})); es.push({name: 'carte/0006.bin', data: es.find((e) => e.name === 'carte/0001.bin').data.slice()}); },
      'gioco 6 («' + GN + '»): voce duplicata', 'gioco duplicato');
    // stessi dati ma cartella o nome diverso: non e' un doppione
    okParse((es, m) => { m.games.push(Object.assign({}, m.games[0], {file: 'carte/0006.bin', state: null, stateBios: null, folder: 'altra'})); es.push({name: 'carte/0006.bin', data: es.find((e) => e.name === 'carte/0001.bin').data.slice()}); }, 'stesso gioco in un\'altra cartella');
    okParse((es, m) => { m.games.push(Object.assign({}, m.games[0], {file: 'carte/0006.bin', state: null, stateBios: null, name: 'altro.bin'})); es.push({name: 'carte/0006.bin', data: es.find((e) => e.name === 'carte/0001.bin').data.slice()}); }, 'stesso gioco con un altro nome');
    // un gioco e un BIOS con lo stesso contenuto non sono doppioni
    okParse((es, m) => { m.games.push(Object.assign({}, m.bios[0], {file: 'carte/0006.bin', state: null, stateBios: null})); es.push({name: 'carte/0006.bin', data: es.find((e) => e.name === 'bios/0001.bin').data.slice()}); }, 'un BIOS e un gioco con lo stesso contenuto');
    // set di caratteri
    exact((es, m) => { m.charset = {file: 'charset.bin', size: 511, sha: m.charset.sha}; }, 'set di caratteri: voce non valida', 'set di caratteri: dimensione');
    exact((es, m) => { m.charset = {file: 'altro.bin', size: 512, sha: m.charset.sha}; }, 'set di caratteri: voce non valida', 'set di caratteri: file');
    exact((es, m) => { m.charset = {file: 'charset.bin', size: 512, sha: 5}; }, 'set di caratteri: voce non valida', 'set di caratteri: impronta numerica');
    exact((es, m) => { m.charset = {file: 'charset.bin', size: 512, sha: 'z'.repeat(64)}; }, 'set di caratteri: voce non valida', 'set di caratteri: impronta non esadecimale');
    exact((es, m) => { m.charset = {file: 'charset.bin', size: 512, sha: m.charset.sha.slice(1)}; }, 'set di caratteri: voce non valida', 'set di caratteri: impronta corta');
    exact((es, m) => { m.charset = null; }, 'file di sessione non valido: voce non dichiarata «charset.bin»', 'set di caratteri non dichiarato');
    exact((es, m) => { m.charset = [1]; }, 'set di caratteri: voce non valida', 'set di caratteri: array');
    okParse((es, m) => { delete m.charset; es.splice(es.findIndex((e) => e.name === 'charset.bin'), 1); }, 'sessione senza set di caratteri');
    // sessione.json e campi generali
    exact((es, m) => { m.format = 'x'; }, 'non e’ un file di sessione di o2web', 'formato');
    exact((es, m) => { m.version = 1.5; }, 'versione della sessione non valida', 'versione frazionaria');
    exact((es, m) => { m.version = 0; }, 'versione della sessione non valida', 'versione 0');
    exact((es, m) => { m.version = 4; }, 'sessione di una versione piu’ recente (4): aggiorna la pagina', 'versione futura');
    exact((es, m) => { m.standard = 'pal'; }, 'standard video non valido', 'standard in minuscolo');
    exact((es, m) => { m.games = 5; }, 'sessione.json non valido: mancano gli elenchi', 'elenchi');
    exact((es, m) => { m.bios = Array(201).fill({}); }, 'troppe voci nella sessione', 'oltre 200 BIOS');
    exact((es, m) => { m.bios = Array(200).fill(null); m.activeBios = -1; }, 'BIOS 1: voce non valida', '200 BIOS: al limite');
    exact((es, m) => { m.games = Array(5001).fill({}); m.activeGame = -1; }, 'troppe voci nella sessione', 'oltre 5000 giochi');
    exact((es, m) => { m.games = Array(5000).fill(null); m.activeGame = -1; }, 'gioco 1: voce non valida', '5000 giochi: al limite');
    exact((es, m) => { m.activeGame = 5; }, 'gioco in uso non valido', 'gioco in uso = lunghezza');
    exact((es, m) => { m.activeGame = -2; }, 'gioco in uso non valido', 'gioco in uso -2');
    exact((es, m) => { m.activeGame = '1'; }, 'gioco in uso non valido', 'gioco in uso testo');
    exact((es, m) => { m.activeBios = 2; }, 'BIOS in uso non valido', 'BIOS in uso = lunghezza');
    exact((es, m) => { m.activeBios = -2; }, 'BIOS in uso non valido', 'BIOS in uso -2');
    exact((es, m) => { m.activeBios = 0.5; }, 'BIOS in uso non valido', 'BIOS in uso frazionario');
    okParse((es, m) => { m.activeGame = -1; m.activeBios = -1; }, 'nessun gioco ne’ BIOS in uso');
    okParse((es, m) => { m.activeGame = 4; m.activeBios = 1; }, 'ultimi indici in uso');
    exact((es, m) => { m.settings = []; }, 'impostazioni non valide', 'impostazioni array');
    // lunghezze dei testi
    okParse((es, m) => { m.games[0].name = 'n'.repeat(300); m.games[0].folder = 'f'.repeat(300); m.games[0].origin = 'o'.repeat(300); }, 'testi di 300 caratteri');
    exact((es, m) => { m.games[0].name = 'n'.repeat(301); }, 'gioco 1 («' + 'n'.repeat(60) + '»): campi non validi', 'nome di 301 caratteri');
    exact((es, m) => { m.games[0].folder = 'f'.repeat(301); }, G1 + ': campi non validi', 'cartella di 301 caratteri');
    exact((es, m) => { m.games[0].origin = 'o'.repeat(301); }, G1 + ': campi non validi', 'origine di 301 caratteri');
    exact((es, m) => { m.games[0].origin = 5; }, G1 + ': campi non validi', 'origine non testo');
    exact((es, m) => { m.games[0].file = 'f'.repeat(41); }, G1 + ': campi non validi', 'file di 41 caratteri');
    ok(S.parseSession(zipStore(ents.map((e) => ({name: e.name, data: e.name === 'sessione.json' ? enc.encode(JSON.stringify(Object.assign(metaOf(), {created: 'c'.repeat(60)}))) : e.data})))).created === 'c'.repeat(60), 'created di 60 caratteri conservato');
    ok(S.parseSession(zipStore(ents.map((e) => ({name: e.name, data: e.name === 'sessione.json' ? enc.encode(JSON.stringify(Object.assign(metaOf(), {created: 'c'.repeat(61)}))) : e.data})))).created === '', 'created di 61 caratteri scartato');
    ok(S.parseSession(zipStore(ents.map((e) => ({name: e.name, data: e.name === 'sessione.json' ? enc.encode(JSON.stringify(Object.assign(metaOf(), {created: 5}))) : e.data})))).created === '', 'created non testo scartato');
    // dati di 1 byte e di 32768 byte (confini)
    for (const n of [1, 32768]) {
      okParse((es, m) => {
        const d = bytes(n);
        es.find((e) => e.name === 'carte/0001.bin').data = d; m.games[0].size = n; m.games[0].sha = sha256(d); m.games[0].state = null; m.games[0].stateBios = null;
        es.splice(es.findIndex((e) => e.name === 'stati/0001.json'), 1);
      }, 'cartuccia di ' + n + ' byte');
      okParse((es, m) => {
        const d = bytes(n);
        es.find((e) => e.name === 'bios/0001.bin').data = d; m.bios[0].size = n; m.bios[0].sha = sha256(d);
        // lo stato del gioco 1 e' legato all'impronta del BIOS vecchio: lo si scollega
        m.games[0].state = null; m.games[0].stateBios = null; es.splice(es.findIndex((e) => e.name === 'stati/0001.json'), 1);
      }, 'BIOS di ' + n + ' byte');
    }
    // il dato di 32769 byte con dimensione coerente e' rifiutato
    exact((es, m) => {
      const d = bytes(32769);
      es.find((e) => e.name === 'carte/0001.bin').data = d; m.games[0].size = 32769; m.games[0].sha = sha256(d); m.games[0].state = null; m.games[0].stateBios = null;
      es.splice(es.findIndex((e) => e.name === 'stati/0001.json'), 1);
    }, G1 + ': dimensione non valida', 'cartuccia di 32769 byte');
    // impostazioni: confini
    const cs = S.checkSettings;
    ok(cs(undefined) && JSON.stringify(cs(undefined)) === '{}' && JSON.stringify(cs(null)) === '{}' && JSON.stringify(cs({})) === '{}' && JSON.stringify(cs({ignota: 1})) === '{}', 'impostazioni vuote o sconosciute');
    const thr = (fn) => { try { fn(); return ''; } catch (e) { return e instanceof S.SessionError ? e.message : 'ECCEZIONE'; } };
    ok(cs({scale: 0}).scale === 0 && cs({scale: 8}).scale === 8 && cs({scale: 1}).scale === 1, 'ingrandimento: 0, 1 e 8 validi');
    ok(thr(() => cs({scale: 9})) === 'impostazione non valida: ingrandimento' && thr(() => cs({scale: -1})) === 'impostazione non valida: ingrandimento' && thr(() => cs({scale: '2'})) === 'impostazione non valida: ingrandimento' &&
      thr(() => cs({scale: 2.5})) === 'impostazione non valida: ingrandimento', 'ingrandimento: non validi');
    ok(cs({volume: 0}).volume === 0 && cs({volume: 1}).volume === 1 && cs({volume: 0.25}).volume === 0.25, 'volume: 0, 1 e 0,25 validi');
    ok(thr(() => cs({volume: -0.001})) === 'impostazione non valida: volume' && thr(() => cs({volume: 1.001})) === 'impostazione non valida: volume' && thr(() => cs({volume: '1'})) === 'impostazione non valida: volume' &&
      thr(() => cs({volume: NaN})) === 'impostazione non valida: volume', 'volume: non validi');
    ok(cs({aspect: 'tv'}).aspect === 'tv' && cs({aspect: 'square'}).aspect === 'square' && thr(() => cs({aspect: 'TV'})) === 'impostazione non valida: proporzioni', 'proporzioni');
    ok(cs({integer: false}).integer === false && thr(() => cs({integer: 0})) === 'impostazione non valida: multipli interi', 'multipli interi');
    ok(cs({muted: true}).muted === true && thr(() => cs({muted: 'si'})) === 'impostazione non valida: audio disattivato', 'muto');
    ok(thr(() => cs(5)) === 'impostazioni non valide' && thr(() => cs('x')) === 'impostazioni non valide' && thr(() => cs([])) === 'impostazioni non valide', 'impostazioni: tipo');
    ok(thr(() => cs({bindings: 5})) !== '', 'impostazioni: associazioni non valide');
    // aspetto e macchina (tappa 4b)
    const lk = {mono: true, blur: 10, persist: 20, glow: 30, scan: 40, mask: 50, curve: 60, detail: 4};
    ok(JSON.stringify(cs({look: lk}).look) === JSON.stringify(lk), 'aspetto: valido, passa intero');
    ok(cs({look: {blur: 5}}).look.blur === 5, 'aspetto: valori parziali ammessi');
    for (const bad of [{blur: 101}, {blur: -1}, {blur: 1.5}, {blur: '3'}, {persist: 91}, {glow: 101}, {scan: 101}, {mask: 101}, {curve: 101}, {detail: 5}, {detail: 2}, {mono: 1}, {ignoto: 1}]) {
      ok(/^impostazione non valida: aspetto \(/.test(thr(() => cs({look: bad}))), 'aspetto non valido: ' + JSON.stringify(bad));
    }
    ok(thr(() => cs({look: 5})) !== '' && thr(() => cs({look: null})) !== '', 'aspetto: tipo');
    for (const k of ['auto', 'odyssey2', 'g7000', 'g7200', 'c52', 'jopac', 'g7400']) ok(cs({machine: k}).machine === k, 'macchina valida: ' + k);
    for (const bad of ['', 'G7000', 'g7600', 5, null, undefined, ['g7000']]) ok(thr(() => cs({machine: bad})) === 'impostazione non valida: macchina', 'macchina non valida: ' + String(bad));
  }

  // JSON rotto davvero (mut riscrive il json: si costruisce a mano)
  {
    const es = ents.map((e) => ({name: e.name, data: e.name === 'sessione.json' ? enc.encode('{"format":') : e.data}));
    rejects(zipStore(es), /JSON/, 'sessione.json non e\' JSON');
    rejects(zipStore(ents.map((e) => ({name: e.name, data: e.name === 'sessione.json' ? new Uint8Array([0xFF, 0xFE, 0x7B]) : e.data}))), /JSON/, 'sessione.json non e\' UTF-8');
    rejects(zipStore(ents.filter((e) => e.name !== 'sessione.json')), /manca/, 'manca sessione.json');
  }
  // non e' una sessione
  rejects(new Uint8Array(0), /zip/, 'file vuoto');
  rejects(enc.encode('ciao mondo'), /zip/, 'testo');
  rejects(zipStore([{name: 'sessione.json', data: enc.encode('{}')}]), /non e. un file di sessione/, 'zip con JSON vuoto');
  rejects(zipStore([{name: 'qualunque.txt', data: enc.encode('x')}]), /inattesa/, 'zip qualunque');
  rejects('abc', /file non valido/, 'non e\' un Uint8Array');
  // troncamenti
  for (const cut of [1, 10, 22, 100, 1000, file.length >> 1, file.length - 23, file.length - 1]) rejects(file.slice(0, file.length - cut), null, 'troncato di ' + cut);

  // ---- rovinamento casuale: nessuna eccezione che non sia SessionError; se passa, il risultato deve essere uguale all'originale
  {
    let accepted = 0, refused = 0;
    for (let k = 0; k < 600; k++) {
      const b = file.slice();
      const n = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) b[Math.floor(rnd() * b.length)] ^= 1 << Math.floor(rnd() * 8);
      try {
        const q = S.parseSession(b);
        accepted++;
        // accettata: deve dare lo stesso contenuto (la modifica era in un campo che non conta: data, nome del file nell'intestazione locale...)
        const ok1 = q.games.length === 5 && q.games.every((g, i) => g.sha === p.games[i].sha && same(g.data, p.games[i].data)) && q.bios.every((x, i) => same(x.data, p.bios[i].data));
        if (!ok1) { fails++; console.log('FAIL rovinamento ' + k + ': accettata con contenuto diverso'); }
        checks++;
      } catch (e) {
        refused++;
        checks++;
        if (!(e instanceof S.SessionError)) { fails++; console.log('FAIL rovinamento ' + k + ': eccezione ' + e.constructor.name + ': ' + e.message); }
      }
    }
    console.log('  rovinamento casuale: ' + refused + ' rifiutate, ' + accepted + ' accettate (campi senza effetto)');
    ok(refused > 400, 'la maggior parte dei rovinamenti e\' rifiutata');
  }

  // ---- errori in costruzione
  {
    let t = false;
    try { S.buildSession({lib, standard: 'PAL', states: new Map([[lib.games[1].id, fakeState(lib.games[0], lib.bios[0].sha)]])}); } catch (e) { t = e instanceof S.SessionError; }
    ok(t, 'costruzione: stato di un\'altra cartuccia rifiutato');
    t = false;
    try { S.buildSession({lib, standard: 'PAL', charset: new Uint8Array(10)}); } catch (e) { t = e instanceof S.SessionError; }
    ok(t, 'costruzione: set di caratteri sbagliato');
    t = false;
    try { S.buildSession({lib, standard: 'PAL', settings: {scale: 100}}); } catch (e) { t = e instanceof S.SessionError; }
    ok(t, 'costruzione: impostazioni sbagliate');
  }

  // ---- sessione vera (in locale)
  const dumps = process.argv[2] || process.env.O2_DUMPS;
  if (dumps && fs.existsSync(path.join(dumps, '_tosec_o2'))) {
    const {Console} = require(SP('console.js'));
    const charsetOwn = require('../hw/charset_own.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-'));
    const script = 'import zipfile,sys,os\nsrc,out=sys.argv[1],sys.argv[2]\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n for r,ds,fs_ in os.walk(src):\n  for f in sorted(fs_):\n   p=os.path.join(r,f)\n   z.write(p,os.path.relpath(p,os.path.dirname(src)))\n';
    const real = new L.Library();
    for (const d of ['_tosec_o2/Magnavox Odyssey 2 [TOSEC]', '_tosec_vp/Philips Videopac+ [TOSEC]']) {
      const out = path.join(tmp, 'x' + real.nextId + '.zip');
      cp.spawnSync('python3', ['-I', '-c', script, path.join(dumps, d), out]);
      await real.addFile(path.basename(d) + '.zip', new Uint8Array(fs.readFileSync(out)));
    }
    ok(real.games.length === 167 && real.bios.length === 4, 'elenco vero: 167 cartucce, 4 BIOS (' + real.games.length + ', ' + real.bios.length + ')');
    const bios = real.bios.find((b) => b.supported && b.known && b.known.system === 'g7000');
    const g1 = real.games.find((g) => /^Killer Bees/.test(g.title)), g2 = real.games.find((g) => /^Pickaxe Pete/.test(g.title));
    ok(bios && g1 && g2, 'BIOS e giochi trovati');
    const charsetBytes = new Uint8Array(charsetOwn.build());
    const mk = (g) => new Console({bios: bios.data, cart: g.data, charset: charsetBytes, standard: 'PAL'});
    const c1 = mk(g1), c2 = mk(g2);
    for (let i = 0; i < 120; i++) { c1.runFrame(); c2.runFrame(); }
    const st1 = c1.saveState(), st2 = c2.saveState();
    const sess = S.buildSession({lib: real, activeGameId: g1.id, activeBiosId: bios.id, standard: 'PAL', states: new Map([[g1.id, st1], [g2.id, st2]]),
      charset: null, settings: {scale: 2}, created: '2026-10-12T00:00:00.000Z'});
    console.log('  sessione vera: ' + sess.length + ' byte, ' + real.games.length + ' cartucce, ' + real.bios.length + ' BIOS, 2 stati');
    const t0 = Date.now();
    const rp = S.parseSession(sess);
    const rr = S.restoreLibrary(rp);
    console.log('  lettura e validazione: ' + (Date.now() - t0) + ' ms');
    ok(rr.lib.games.length === 167 && rr.lib.bios.length === 4 && rr.states.size === 2, 'sessione vera riletta');
    const ng1 = rr.lib.getGame(rr.activeGameId), nb = rr.lib.getBios(rr.activeBiosId);
    ok(ng1.name === g1.name && nb.sha === bios.sha, 'gioco e BIOS in uso');
    // ripresa deterministica: console originale avanti di 60 fotogrammi contro console nuova dai dati della sessione + stato ripristinato
    const nc = new Console({bios: nb.data, cart: ng1.data, charset: charsetBytes, standard: rp.standard});
    nc.loadState(rr.states.get(ng1.id));
    for (let i = 0; i < 60; i++) { c1.runFrame(); nc.runFrame(); }
    ok(JSON.stringify(c1.saveState()) === JSON.stringify(nc.saveState()), 'ripresa deterministica dopo la riapertura della sessione');
    ok(c1.cpu.now === nc.cpu.now && same(c1.vdc.fb || [], nc.vdc.fb || []), 'orologio e fotogramma uguali');
    // lo stato di un gioco con un altro BIOS NON si ricarica: il BIOS diverso lo rifiuta
    const other = real.bios.find((b) => b.known && b.known.system === 'g7000' && b.sha !== bios.sha);
    if (other) {
      let refused = false;
      try { new Console({bios: other.data, cart: g1.data, charset: charsetBytes, standard: 'PAL'}).loadState(rr.states.get(ng1.id)); } catch (e) { refused = /BIOS/.test(e.message); }
      ok(refused, 'stato con un altro BIOS rifiutato dalla console');
    }
    fs.rmSync(tmp, {recursive: true, force: true});
  } else console.log('  (sessione vera: saltata, serve la cartella dei dump)');

  console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ECCEZIONE ' + (e.stack || e)); process.exit(1); });
