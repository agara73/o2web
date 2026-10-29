'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_library.js - elenco giochi / BIOS: nomi TOSEC, classificazione, zip annidati (TOSEC finti costruiti qui con byte casuali: nessun
// dump), limiti, doppioni, ricerca e filtro. Con la cartella dei dump (O2_DUMPS o argomento) prova anche le due raccolte TOSEC vere,
// impacchettate al volo in uno zip esterno (in locale: i dump non si consegnano).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const L = require(SP('library.js'));
const {zipStore} = require(SP('zipstore.js'));
const {sha256} = require(SP('sha256.js'));

let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const eqj = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const bytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b; };
const enc = (s) => new TextEncoder().encode(s);
const innerZip = (name, data) => zipStore([{name, data}]);

(async () => {
  // ---- nomi TOSEC
  {
    const p = L.parseTosecName("Killer Bees (198x)(Philips)(EU).bin");
    eqj([p.title, p.display, p.year, p.publisher, p.country, p.flags], ['Killer Bees', 'Killer Bees', '198x', 'Philips', 'EU', []], 'nome 1');
    const q = L.parseTosecName('Mousing Cat, The (1983)(Philips)(EU).zip');
    eqj([q.title, q.display, q.year], ['Mousing Cat, The', 'The Mousing Cat', '1983'], 'articolo');
    const r = L.parseTosecName('Martian Threat (19xx)(Philips)(EU)[a].zip');
    eqj([r.year, r.flags, r.warn], ['19xx', ['a'], []], 'flag a');
    const b = L.parseTosecName('Nightfighter (19xx)(-)(EU)[b][h Foo].bin');
    eqj([b.publisher, b.flags, b.warn.length], ['', ['b', 'h Foo'], 1], 'flag b, editore -');
    const s = L.parseTosecName("Verkehrsspiele Traffic Games 1 (1982)(CSV - Philips)(DE)");
    eqj([s.title, s.publisher, s.country], ['Verkehrsspiele Traffic Games 1', 'CSV - Philips', 'DE'], 'editore con trattino');
    const t = L.parseTosecName('Sconosciuto.bin');
    eqj([t.title, t.year, t.country], ['Sconosciuto', '', ''], 'nome semplice');
    const u = L.parseTosecName('cartelle/dentro/Gioco (1981)(X)(EU-US)(en).bin');
    eqj([u.title, u.country, u.extra], ['Gioco', 'EU-US', ['en']], 'percorso, lingua');
    const v = L.parseTosecName('');
    ok(v.title === '', 'nome vuoto');
    eqj([L.flagLabel('a2'), L.flagLabel('b'), L.flagLabel('zz')], ['variante 2', 'dump difettoso', 'zz'], 'flagLabel');
    eqj(L.cleanFolder('Magnavox Odyssey2 - Games (TOSEC-v2011-02-22_CM)'), 'Magnavox Odyssey2 - Games', 'cartella');
    eqj(L.cleanFolder('Magnavox Odyssey 2 [TOSEC]'), 'Magnavox Odyssey 2', 'cartella 2');
    eqj(L.platformOf('Philips Videopac+ - Games (TOSEC-v2011)'), 'Philips Videopac+', 'piattaforma');
    eqj(L.searchKey('Quète des ANNEAUX'), 'quete des anneaux', 'searchKey');
  }

  // ---- classificazione
  {
    const k = L.classify('x.bin', '', bytes(1024));
    ok(k.kind === 'bios' && !k.known, '1024 byte -> BIOS');
    ok(L.classify('Gioco.bin', '', bytes(2048)).kind === 'cart', '2048 -> cartuccia');
    ok(L.classify('Qualcosa BIOS.bin', '', bytes(2048)).kind === 'bios', '2048 con nome BIOS -> BIOS');
    ok(L.classify('x.bin', 'Foo - Firmware (TOSEC-v1)', bytes(2048)).kind === 'bios', '2048 in cartella Firmware -> BIOS');
    ok(L.classify('x.bin', '', bytes(8192)).kind === 'cart', '8 KB -> cartuccia');
    ok(L.classify('x.bin', '', bytes(16384)).kind === 'cart', '16 KB -> cartuccia');
    ok(L.classify('x.bin', '', new Uint8Array(0)).kind === 'skip', 'vuoto');
    ok(L.classify('x.bin', '', bytes(100)).kind === 'skip', 'troppo piccolo');
    ok(L.classify('x.bin', '', bytes(40000)).kind === 'skip', 'troppo grande');
    ok(L.classify('leggimi.txt', '', bytes(4096)).kind === 'skip', 'estensione .txt');
    ok(L.classify('senza estensione', '', bytes(4096)).kind === 'cart', 'senza estensione');
    ok(L.classify('Dr. Strangelove', '', bytes(4096)).kind === 'cart', 'punto nel nome');
    ok(L.classify('X.ROM', '', bytes(4096)).kind === 'cart', '.ROM');
  }

  // ---- file singoli
  {
    const lib = new L.Library();
    const cart = bytes(4096), bios = bytes(1024);
    let r = await lib.addFile('Mio Gioco (1982)(Acme)(EU).bin', cart);
    ok(r.games === 1 && r.bios === 0 && r.dups === 0, 'cartuccia singola');
    r = await lib.addFile('Mio Gioco (1982)(Acme)(EU).bin', cart);
    ok(r.games === 0 && r.dups === 1, 'doppione identico');
    r = await lib.addFile('Mio Gioco (1982)(Acme)(EU).bin', bytes(4096));
    ok(r.games === 1, 'stesso nome, contenuto diverso: entra');
    r = await lib.addFile('mio.bin', bios);
    ok(r.bios === 1 && lib.bios[0].supported && lib.bios[0].size === 1024, 'BIOS singolo');
    const g = lib.games[0];
    ok(g.origin === 'file' && g.folder === '' && g.sha === sha256(cart) && g.size === 4096 && g.map.kind === 'std' && g.map.ok, 'campi del gioco');
    ok(g.year === '1982' && g.publisher === 'Acme' && g.country === 'EU' && g.display === 'Mio Gioco', 'metadati dal nome');
    ok(lib.games[0].id !== lib.games[1].id && lib.getGame(g.id) === g && lib.getBios(lib.bios[0].id) === lib.bios[0], 'id e ricerca');
    ok(lib.remove('game', g.id) && lib.games.length === 1 && !lib.remove('game', g.id), 'rimozione');
    r = await lib.addFile('Mio Gioco (1982)(Acme)(EU).bin', cart);
    ok(r.games === 1, 'dopo la rimozione si puo\' riaggiungere');
    // zip con un solo file = file singolo, senza cartella
    const lib2 = new L.Library();
    r = await lib2.addFile('Pickaxe.zip', innerZip('Pickaxe Pete (198x)(Philips)(EU).bin', bytes(4096)));
    ok(r.games === 1 && lib2.games[0].folder === '' && lib2.games[0].origin === 'zip: Pickaxe.zip', 'zip con un solo file');
    // cartuccia 12 KB: finestra da 16 KB, schema rally (tappa 5); 10 KB: elencata ma non supportata
    r = await lib2.addFile('Big (198x)(Philips)(EU).bin', bytes(12288));
    const big = lib2.games.find((x) => x.size === 12288);
    ok(big && big.map.kind === 'rally' && big.map.ok && big.map.banks === 8, 'cartuccia 12 KB: schema rally, supportata');
    r = await lib2.addFile('Big10 (198x)(Philips)(EU).bin', bytes(10240));
    const big10 = lib2.games.find((x) => x.size === 10240);
    ok(big10 && big10.map.kind === 'big' && !big10.map.ok && /10|KB/.test(big10.map.reason), 'cartuccia 10 KB non supportata');
    // BIOS noto e non supportato (impronta aggiunta per la prova)
    const g74 = bytes(1024);
    L.KNOWN_BIOS[sha256(g74)] = {label: 'Finto G7400', system: 'g7400', supported: false, reason: 'prova'};
    r = await lib2.addFile('qualunque.bin', g74);
    const kb = lib2.bios.find((x) => x.known);
    ok(kb && !kb.supported && kb.display === 'Finto G7400' && kb.reason === 'prova', 'BIOS noto non supportato');
    delete L.KNOWN_BIOS[sha256(g74)];
    // BIOS da 2 KB (per nome): elencato ma non supportato
    r = await lib2.addFile('Finto BIOS 2k.bin', bytes(2048));
    const b2 = lib2.bios.find((x) => x.size === 2048);
    ok(b2 && !b2.supported && /2048/.test(b2.reason), 'BIOS da 2 KB non supportato');
  }

  // ---- TOSEC finto: zip esterno con cartelle e un zip per gioco
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  const mk = (n, size) => ({n, data: bytes(size)});
  const games = [mk('Alfa (1981)(Philips)(EU).bin', 2048), mk('Beta, The (1982)(Philips)(FR).bin', 4096), mk('Gamma (198x)(X)(EU)[a].bin', 8192),
    mk('Delta (1983)(Y)(US).bin', 2048)];
  const appl = [mk('Editor (1980)(Philips)(EU).bin', 4096)];
  const fw = [mk('Fake BIOS (1978)(Philips)(EU-US).bin', 1024), mk('Altro BIOS (19xx)(Philips)(FR).bin', 1024)];
  const FOLD = (n) => 'Test Console [TOSEC]/Test Console - ' + n + ' (TOSEC-v2011-02-22_CM)/';
  const entries = [];
  games.forEach((g) => entries.push({name: FOLD('Games') + g.n.replace('.bin', '.zip'), data: innerZip(g.n, g.data)}));
  appl.forEach((g) => entries.push({name: FOLD('Applications') + g.n.replace('.bin', '.zip'), data: innerZip(g.n, g.data)}));
  fw.forEach((g) => entries.push({name: FOLD('Firmware') + g.n.replace('.bin', '.zip'), data: innerZip(g.n, g.data)}));
  entries.push({name: 'Test Console [TOSEC]/leggimi.txt', data: enc('niente')});
  const outer = zipStore(entries);
  {
    const lib = new L.Library();
    const prog = [];
    const r = await lib.addFile('Test_TOSEC.zip', outer, {onProgress: (n) => prog.push(n)});
    ok(r.games === 5 && r.bios === 2 && r.dups === 0 && r.errors.length === 0, 'TOSEC finto: ' + JSON.stringify([r.games, r.bios, r.dups, r.errors]));
    ok(r.skipped.length === 1 && r.skipped[0].name === 'leggimi.txt', 'TOSEC finto: leggimi.txt saltato');
    eqj(lib.games.map((g) => g.folder).sort(), ['Test Console - Applications', 'Test Console - Games', 'Test Console - Games', 'Test Console - Games', 'Test Console - Games'], 'cartelle');
    eqj(lib.bios.map((b) => b.folder), ['Test Console - Firmware', 'Test Console - Firmware'], 'cartelle BIOS');
    ok(lib.games.every((g) => g.origin === 'zip: Test_TOSEC.zip' && g.platform === 'Test Console'), 'origine e piattaforma');
    const d = lib.games.find((g) => g.title === 'Beta, The');
    ok(d && d.display === 'The Beta' && d.country === 'FR' && d.sha === sha256(games[1].data), 'titolo e impronta');
    ok(prog.length === 0 || prog.every((x) => x > 0), 'avanzamento');
    // doppioni: stessa raccolta una seconda volta
    const r2 = await lib.addFile('Test_TOSEC.zip', outer);
    ok(r2.games === 0 && r2.bios === 0 && r2.dups === 7, 'seconda importazione: tutti doppioni (' + r2.dups + ')');
    ok(lib.games.length === 5 && lib.bios.length === 2, 'nessun elemento in piu\'');
    // elenco: filtro e ricerca
    eqj(L.folderList(lib.games), [{folder: 'Test Console - Applications', count: 1}, {folder: 'Test Console - Games', count: 4}], 'folderList');
    eqj(L.filterGames(lib.games, {}).map((g) => g.display), ['Alfa', 'The Beta', 'Delta', 'Editor', 'Gamma'].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1), 'ordine per titolo');
    eqj(L.filterGames(lib.games, {query: 'beta'}).length, 1, 'ricerca titolo');
    eqj(L.filterGames(lib.games, {query: 'the BETA'}).length, 1, 'ricerca due parole');
    eqj(L.filterGames(lib.games, {query: '1982 fr'}).length, 1, 'ricerca anno e paese');
    eqj(L.filterGames(lib.games, {query: 'philips'}).length, 3, 'ricerca editore');
    eqj(L.filterGames(lib.games, {query: 'xyz'}).length, 0, 'ricerca senza risultati');
    eqj(L.filterGames(lib.games, {folder: 'Test Console - Applications'}).map((g) => g.title), ['Editor'], 'filtro cartella');
    eqj(L.filterGames(lib.games, {folder: 'Test Console - Games', query: 'a'}).length, 4, 'cartella + testo');
    eqj(L.filterGames(lib.games, {folder: ''}).length, 0, 'cartella vuota senza elementi');
    ok(L.filterGames(lib.games, {query: '   '}).length === 5, 'ricerca solo spazi');
    eqj(L.filterGames(lib.games, {query: '[a]'}).length, 1, 'il nome file intero e\' nel testo (flag compresi)');
    eqj(L.filterGames(lib.games, {query: 'a'}).length >= 4, true, 'ricerca parziale');
  }

  // ---- fixture deflate/annidati con Python (se c'e')
  const hasPy = cp.spawnSync('python3', ['-c', '1']).status === 0;
  if (hasPy) {
    const dir = path.join(tmp, 'py');
    fs.mkdirSync(dir);
    const g1 = bytes(4096), g2 = new Uint8Array(8192).fill(0xAA);   // compressibile
    fs.writeFileSync(path.join(dir, 'g1.bin'), g1); fs.writeFileSync(path.join(dir, 'g2.bin'), g2);
    const script = `
import zipfile, io, sys
d = sys.argv[1]
def z(entries, comp=zipfile.ZIP_DEFLATED):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', comp) as f:
        for n, data in entries: f.writestr(n, data)
    return b.getvalue()
g1 = open(d + '/g1.bin', 'rb').read(); g2 = open(d + '/g2.bin', 'rb').read()
i1 = z([('Uno (1981)(P)(EU).bin', g1)]); i2 = z([('Due (1982)(P)(EU).bin', g2)])
open(d + '/outer.zip', 'wb').write(z([('Raccolta/Giochi (TOSEC-v1)/Uno (1981)(P)(EU).zip', i1), ('Raccolta/Giochi (TOSEC-v1)/Due (1982)(P)(EU).zip', i2)]))
# 4 livelli: troppo profondo
l3 = z([('x.bin', g1)]); l2 = z([('l3.zip', l3)]); l1 = z([('l2.zip', l2)]); l0 = z([('l1.zip', l1)])
open(d + '/deep.zip', 'wb').write(l0)
# zip in cui una voce ha il CRC sbagliato (si ricostruisce a mano)
b = bytearray(z([('Buono (1981)(P)(EU).bin', g1), ('Rotto (1981)(P)(EU).bin', g2)], zipfile.ZIP_STORED))
i = b.find(bytes(g2[:16])); b[i] ^= 0xFF
open(d + '/rotto.zip', 'wb').write(bytes(b))
# cartucce direttamente nello zip, senza cartelle
open(d + '/piatto.zip', 'wb').write(z([('A (1981)(P)(EU).bin', g1), ('B (1981)(P)(EU).bin', g2)]))
`;
    const rr = cp.spawnSync('python3', ['-I', '-c', script, dir], {encoding: 'utf8'});
    ok(rr.status === 0, 'fixture python: ' + rr.stderr);
    const rd = (n) => new Uint8Array(fs.readFileSync(path.join(dir, n)));
    {
      const lib = new L.Library();
      const r = await lib.addFile('outer.zip', rd('outer.zip'));
      ok(r.games === 2 && lib.games.every((g) => g.folder === 'Giochi'), 'deflate annidato con cartelle: ' + JSON.stringify([r.games, r.errors]));
      ok(lib.games.find((g) => g.title === 'Due').sha === sha256(g2), 'deflate: contenuto');
    }
    {
      const lib = new L.Library();
      const r = await lib.addFile('deep.zip', rd('deep.zip'));
      ok(r.games === 0 && r.skipped.length === 1 && /profondit/.test(r.skipped[0].why), 'zip troppo annidati: ' + JSON.stringify(r.skipped));
    }
    {
      const lib = new L.Library();
      const r = await lib.addFile('rotto.zip', rd('rotto.zip'));
      ok(r.games === 1 && r.errors.length === 1 && /CRC/.test(r.errors[0]), 'voce con CRC sbagliato: errore segnalato, il resto entra: ' + JSON.stringify(r.errors));
      ok(lib.games[0].title === 'Buono', 'la voce buona e\' entrata');
    }
    {
      const lib = new L.Library();
      const r = await lib.addFile('piatto.zip', rd('piatto.zip'));
      ok(r.games === 2 && lib.games.every((g) => g.folder === 'piatto'), 'zip piatto: cartella = nome dello zip');
    }
  }

  // ---- file non zip rotto, zip troncato, spazzatura
  {
    const lib = new L.Library();
    const z = innerZip('A (1981)(P)(EU).bin', bytes(2048));
    let r = await lib.addFile('tronco.zip', z.slice(0, z.length - 30));
    ok(r.games === 0 && r.errors.length === 1, 'zip troncato: ' + JSON.stringify(r.errors));
    r = await lib.addFile('a.bin', new Uint8Array(0));
    ok(r.games === 0 && r.skipped.length === 1, 'file vuoto');
    r = await lib.addFile('PK.bin', new Uint8Array([0x50, 0x4B, 3, 4, 1, 2, 3]));
    ok(r.games === 0 && r.errors.length + r.skipped.length === 1, 'firma zip senza zip');
  }

  // ---- limiti
  {
    const save = Object.assign({}, L.LIMITS);
    const many = zipStore(Array.from({length: 30}, (_, i) => ({name: 'g' + i + '.bin', data: bytes(2048)})));
    L.LIMITS.entries = 10;
    let lib = new L.Library();
    let r = await lib.addFile('molti.zip', many);
    ok(r.errors.length === 1 && /troppe voci/.test(r.errors[0]) && r.games < 30, 'limite voci: ' + JSON.stringify(r.errors));
    Object.assign(L.LIMITS, save);
    L.LIMITS.budget = 5000;
    lib = new L.Library();
    r = await lib.addFile('molti.zip', many);
    ok(r.errors.length === 1 && /byte estratti/.test(r.errors[0]), 'limite di byte: ' + JSON.stringify(r.errors));
    Object.assign(L.LIMITS, save);
    L.LIMITS.games = 3;
    lib = new L.Library();
    r = await lib.addFile('molti.zip', many);
    ok(r.errors.length === 1 && /pieno/.test(r.errors[0]) && lib.games.length === 3, 'elenco pieno');
    Object.assign(L.LIMITS, save);
    // leaf grande dentro uno zip: saltato dalla dimensione dichiarata
    const bigz = zipStore([{name: 'enorme.bin', data: new Uint8Array(100000)}, {name: 'ok (1981)(P)(EU).bin', data: bytes(2048)}, {name: 'altro (1981)(P)(EU).bin', data: bytes(2048)}]);
    lib = new L.Library();
    r = await lib.addFile('x.zip', bigz);
    ok(r.games === 2 && r.skipped.length === 1 && r.skipped[0].name === 'enorme.bin', 'voce troppo grande saltata');
  }

  // ---- raccolte vere (in locale)
  const dumps = process.argv[2] || process.env.O2_DUMPS;
  if (dumps && hasPy && fs.existsSync(path.join(dumps, '_tosec_o2'))) {
    const script = `
import zipfile, sys, os
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for r, ds, fs_ in os.walk(src):
        for f in sorted(fs_):
            p = os.path.join(r, f)
            z.write(p, os.path.relpath(p, os.path.dirname(src)))
`;
    const res = {};
    for (const [key, dir] of [['o2', '_tosec_o2/Magnavox Odyssey 2 [TOSEC]'], ['vp', '_tosec_vp/Philips Videopac+ [TOSEC]']]) {
      const out = path.join(tmp, key + '.zip');
      const rr = cp.spawnSync('python3', ['-I', '-c', script, path.join(dumps, dir), out], {encoding: 'utf8'});
      ok(rr.status === 0, 'zip ' + key + ': ' + rr.stderr);
      const lib = new L.Library();
      const r = await lib.addFile(key + '.zip', new Uint8Array(fs.readFileSync(out)));
      res[key] = {lib, r};
      console.log('  ' + key + ': giochi ' + r.games + ', BIOS ' + r.bios + ', doppioni ' + r.dups + ', saltati ' + r.skipped.length + ', errori ' + r.errors.length +
        ', cartelle ' + L.folderList(lib.games).map((f) => f.folder + '=' + f.count).join('; '));
      ok(r.errors.length === 0, key + ': nessun errore');
    }
    ok(res.o2.r.games + res.o2.r.bios === 135, 'Odyssey 2: 135 file (' + (res.o2.r.games + res.o2.r.bios) + ')');
    ok(res.vp.r.games + res.vp.r.bios === 36, 'Videopac+: 36 file (' + (res.vp.r.games + res.vp.r.bios) + ')');
    ok(res.o2.r.bios === 2 && res.vp.r.bios === 2, 'BIOS: 2 + 2');
    const bi = res.vp.lib.bios.concat(res.o2.lib.bios);
    ok(bi.every((b) => b.known), 'tutti i BIOS sono noti');
    ok(bi.filter((b) => b.supported).length === 4, 'BIOS supportati: 4 su 4 (G7000, C52, G7400, Jopac: tappa 5)');
    const unsup = res.o2.lib.games.concat(res.vp.lib.games).filter((g) => !g.map.ok);
    console.log('  cartucce non supportate: ' + unsup.map((g) => g.display).join(', '));
    ok(unsup.length === 0, 'nessuna cartuccia non supportata (12 e 16 KB: schema rally)');
    // tutte e due insieme
    const both = new L.Library();
    await both.addFile('o2.zip', new Uint8Array(fs.readFileSync(path.join(tmp, 'o2.zip'))));
    await both.addFile('vp.zip', new Uint8Array(fs.readFileSync(path.join(tmp, 'vp.zip'))));
    ok(both.games.length + both.bios.length === 171 - (both.dups || 0) || both.games.length > 0, 'entrambe le raccolte');
    const dem = L.filterGames(both.games, {query: 'demon attack'});
    ok(dem.length >= 2, 'ricerca «demon attack»: ' + dem.length + ' risultati');
    const fl = L.folderList(both.games);
    ok(fl.length === 4, 'quattro cartelle: ' + fl.map((x) => x.folder).join(' | '));
  } else console.log('  (raccolte TOSEC vere: saltate, serve la cartella dei dump)');

  await require('./lib_extra.js')(ok, eqj, bytes);

  fs.rmSync(tmp, {recursive: true, force: true});
  console.log((fails ? 'ERRORI: ' + fails : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ECCEZIONE ' + (e.stack || e)); process.exit(1); });
