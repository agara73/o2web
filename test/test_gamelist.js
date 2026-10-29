'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_gamelist.js - la vista dell'elenco (src/gamelist.js) e l'importazione degli elenchi di nomi (library.js): fusione dei dump identici, sigla e nome,
// altri nomi, ricerca, filtro per cartella, ordine, e proprieta' casuali (ogni gioco in una sola voce; si fondono SOLO contenuti uguali byte per byte).
// Byte sintetici: nessun dump.
const fs = require('fs');
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const {Library, LIMITS, makeGame, gameText} = require(SP('library.js'));
const {buildEntries, filterEntries} = require(SP('gamelist.js'));
const {parseNameList} = require(SP('gamenames.js'));
const {zipStore} = require(SP('zipstore.js'));
const {sha256} = require(SP('sha256.js'));
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 25) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));
const enc = (s) => new TextEncoder().encode(s);
let seed = 99;
const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % k; };
const cart = (tag, size) => { const b = new Uint8Array(size || 2048); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + tag * 17 + (i >> 5) * tag) & 255; b[0] = tag & 255; b[1] = (tag >> 8) & 255; return b; };

(async () => {
  const lib = new Library();
  const C = {a: cart(1), b: cart(2), c: cart(3), d: cart(4), e: cart(5, 4096)};
  const add = async (name, bytes) => lib.addFile(name, bytes);
  // il gioco A: tre nomi diversi in tre cartelle (stesso contenuto); B: sigla nel nome; C: due dump uguali con lo stesso nome in due cartelle; D e E: soli
  await add('Alpha Game (1980)(Philips)(EU).bin', C.a);
  const z = zipStore([{name: 'Coll2/alpha_game.bin', data: C.a}, {name: 'Coll2/vp_88.bin', data: C.b}, {name: 'Coll3/vp_88.bin', data: C.b}, {name: 'Coll3/vp_88_f.bin', data: C.c}, {name: 'Coll3/beta.bin', data: C.d}]);
  await add('raccolta.zip', z);
  await add('Gamma Game (1982)(Imagic)(US).bin', C.e);
  eq(lib.games.length, 7, 'giochi in elenco');
  const v0 = lib.version;
  const entriesM = buildEntries(lib.games, lib.names, {merge: true});
  const entriesN = buildEntries(lib.games, lib.names, {merge: false});
  eq([entriesM.length, entriesN.length], [5, 7], 'voci con e senza fusione');
  const partition = (es) => { const all = es.flatMap((e) => e.ids).sort((x, y) => x - y); return JSON.stringify(all) === JSON.stringify(lib.games.map((g) => g.id).sort((x, y) => x - y)); };
  ok(partition(entriesM) && partition(entriesN), 'ogni gioco compare in una sola voce');
  ok(entriesM.every((e) => e.games.every((g) => g.sha === e.games[0].sha)), 'si fondono solo contenuti uguali');
  const eA = entriesM.find((e) => e.games.some((g) => g.sha === sha256(C.a)));
  eq([eA.count, eA.ids.length, eA.games.length, eA.folders.length], [2, 2, 2, 2], 'voce A: 2 file');
  ok(eA.metaGame.year === '1980' && eA.metaGame.publisher === 'Philips', 'voce A: anno ed editore dal nome descrittivo');
  eq(eA.title, 'Alpha Game', 'voce A: titolo');
  ok(eA.others.length === 1 && /Alpha Game \(1980\)\(Philips\)\(EU\)\.bin/.test(eA.others[0]), 'voce A: il nome del file TOSEC e\' tra gli altri nomi (alpha_game.bin coincide col titolo)' + JSON.stringify(eA.others));
  const eB = entriesM.find((e) => e.sigla === 'vp_88');
  eq([eB.count, eB.siglas, eB.label], [2, ['vp_88'], 'vp_88 — vp_88'], 'voce B: due dump uguali, stessa sigla');
  const eC = entriesM.find((e) => e.sigla === 'vp_88_f');
  eq(eC.count, 1, 'voce C (versione francese, contenuto diverso): separata');
  ok(entriesN.filter((e) => e.sigla === 'vp_88').length === 2, 'senza fusione: due voci vp_88');
  ok(entriesN.every((e) => e.count === 1 && e.ids.length === 1 && e.rep.id === e.ids[0]), 'senza fusione: una voce per gioco, rep = il gioco');
  // chiavi uniche e stabili
  ok(new Set(entriesM.map((e) => e.key)).size === entriesM.length && new Set(entriesN.map((e) => e.key)).size === entriesN.length, 'chiavi uniche');
  eq(buildEntries(lib.games, lib.names, {merge: true}).map((e) => e.key), entriesM.map((e) => e.key), 'ricostruzione: stesse chiavi');
  eq(buildEntries(lib.games, lib.names, {}).length, 7, 'senza opzioni: nessuna fusione');

  // ---- elenco di nomi: dopo i dump, prima dei dump, dentro uno zip
  const list = 'vp_88.bin   Beta Quest\nvp_88_f.bin   Beta Quete\nmod_01.bin   una nota\nx.bin   y\n';
  const r1 = await add('Gamelist.txt', enc(list));
  eq([r1.lists, r1.listNames, r1.games, r1.skipped.length], [1, 4, 0, 0], 'importazione dell\'elenco di nomi');
  ok(lib.version > v0 && lib.nameLists.length === 1 && lib.nameLists[0].name === 'Gamelist.txt' && lib.nameLists[0].count === 4, 'versione e registro degli elenchi');
  let es = buildEntries(lib.games, lib.names, {merge: true});
  const eB2 = es.find((e) => e.sigla === 'vp_88');
  eq([eB2.title, eB2.label, eB2.rep.rank], ['Beta Quest', 'vp_88 — Beta Quest', undefined], 'titolo dall\'elenco');
  const lib2 = new Library();
  await lib2.addFile('Coll3.zip', zipStore([{name: 'Gamelist.txt', data: enc(list)}, {name: 'vp_88.bin', data: C.b}]));
  eq(buildEntries(lib2.games, lib2.names, {merge: true})[0].title, 'Beta Quest', 'elenco dentro uno zip, accanto al gioco');
  const lib3 = new Library();
  await lib3.addFile('vp_88.bin', C.b);
  const before = buildEntries(lib3.games, lib3.names, {merge: true})[0].title;
  await lib3.addFile('Gamelist.txt', enc(list));
  const after = buildEntries(lib3.games, lib3.names, {merge: true})[0].title;
  ok(before !== after && after === 'Beta Quest', 'l\'elenco aggiunto dopo i dump vale lo stesso: "' + before + '" -> "' + after + '"');
  // una seconda lista piu' recente sostituisce le voci uguali
  await lib3.addFile('Altra.txt', enc('vp_88.bin  Beta Nuovo\na.bin  b\nc.bin  d'));
  eq(buildEntries(lib3.games, lib3.names, {merge: true})[0].title, 'Beta Nuovo', 'l\'elenco piu\' recente vale di piu\'');
  // clear svuota anche i nomi
  lib3.clear();
  eq([lib3.names.size, lib3.nameLists.length, lib3.games.length], [0, 0, 0], 'clear: via anche i nomi');
  // .txt che non e' un elenco, vuoto, troppo grande
  const r2 = await add('note.txt', enc('questo non e un elenco\naltra riga'));
  eq([r2.lists, r2.skipped.length], [0, 1], '.txt qualunque: saltato come prima');
  ok(/\.txt/.test(r2.skipped[0].why), '.txt: motivo ' + r2.skipped[0].why);
  const r3 = await add('vuoto.txt', new Uint8Array(0));
  eq([r3.lists, r3.skipped.length], [0, 1], '.txt vuoto');
  const big = enc(new Array(Math.ceil(LIMITS.list / 10) + 100).fill('a.bin  bbbb').join('\n'));
  ok(big.length > LIMITS.list, 'prova: elenco oltre il limite');
  const r4 = await add('grande.txt', big);
  eq([r4.lists, r4.skipped.length], [0, 1], '.txt troppo grande: saltato');
  const r5 = await add('x/Gamelist.TXT', enc(list + 'q.bin  w'));
  eq(r5.lists, 1, 'estensione in maiuscole');

  // ---- sigla senza elenco: dalla tabella incorporata; nome per sigla
  const libT = new Library();
  await libT.addFile('vp_13.bin', cart(9));
  const eT = buildEntries(libT.games, libT.names, {merge: true})[0];
  ok(eT.sigla === 'vp_13' && /Playschool Maths/.test(eT.title) && eT.others.some((o) => /Got Your Number/.test(o)), 'sigla e nome dalla tabella: ' + eT.label + ' | ' + eT.others);

  // ---- ricerca e cartelle
  es = buildEntries(lib.games, lib.names, {merge: true});
  const find = (q, folder) => filterEntries(es, {query: q, folder}).map((e) => e.label);
  eq(find('alpha').length, 1, 'ricerca per titolo');
  eq(find('alpha_game').length, 1, 'ricerca per un altro nome della voce');
  eq(find('vp_88').length, 2, 'ricerca per sigla (vp_88 e vp_88_f)');
  eq(find('quete').length, 1, 'ricerca per nome dell\'elenco');
  eq(find('ALPHA 1980 philips').length, 1, 'ricerca: tutte le parole, senza maiuscole');
  eq(find('alpha gamma').length, 0, 'ricerca: parole di voci diverse non si mescolano');
  eq(find('coll3', undefined).length, 3, 'ricerca per cartella (testo): beta, vp_88, vp_88_f');
  eq(filterEntries(es, {folder: 'Coll2'}).length, 2, 'filtro cartella Coll2: alpha e vp_88 (voci unite)');
  ok(filterEntries(es, {folder: 'Coll3'}).some((e) => e.sigla === 'vp_88'), 'la voce unita sta in tutte le sue cartelle');
  eq(filterEntries(es, {folder: 'Inesistente'}).length, 0, 'cartella inesistente');
  eq(filterEntries(es, {}).length, es.length, 'senza filtri: tutto');
  const sorted = filterEntries(es, {}).map((e) => e.title.toLowerCase());
  eq(sorted, sorted.slice().sort(), 'ordine per titolo');

  // ---- proprieta' casuali: pool di contenuti con nomi casuali
  for (let round = 0; round < 40; round++) {
    const L = new Library();
    const pool = [];
    for (let i = 0; i < 6; i++) pool.push(cart(100 + round * 10 + i, rnd(2) ? 2048 : 4096));
    const names = ['vp_%02d.bin', 'o2_%02d.bin', 'Title %d (1980)(Philips)(EU).bin', 'name_%d.bin', 'br_%02d.bin'];
    const files = [];
    for (let i = 0; i < 25; i++) {
      const k = rnd(pool.length), tpl = names[rnd(names.length)], num = 10 + rnd(40);
      files.push({name: 'F' + rnd(3) + '/' + tpl.replace(/%0?\dd|%d/, String(num)), data: pool[k], k});
    }
    for (const f of files) await L.addFile(f.name, f.data);
    for (const merge of [true, false]) {
      const E = buildEntries(L.games, L.names, {merge});
      const ids = E.flatMap((e) => e.ids).sort((x, y) => x - y);
      ok(JSON.stringify(ids) === JSON.stringify(L.games.map((g) => g.id).sort((x, y) => x - y)), 'casuale: partizione (' + round + ')');
      ok(E.every((e) => e.games.length === e.ids.length && e.count === e.games.length && e.ids.includes(e.rep.id) && e.games.includes(e.metaGame)), 'casuale: coerenza della voce');
      ok(E.every((e) => new Set(e.games.map((g) => g.sha)).size === 1 || !merge), 'casuale: voce con un solo contenuto');
      if (merge) ok(E.length === new Set(L.games.map((g) => g.sha)).size, 'casuale: voci = contenuti distinti (' + E.length + ')');
      else ok(E.length === L.games.length, 'casuale: senza fusione una voce per gioco');
      ok(E.every((e) => e.title && e.label.includes(e.title) && (!e.sigla || e.label.startsWith(e.sigla))), 'casuale: etichette');
      ok(E.every((e) => new Set(e.others.map((o) => o.toLowerCase().replace(/[^a-z0-9]+/g, ''))).size === e.others.length), 'casuale: altri nomi senza ripetizioni');
      // la ricerca per il nome di ciascun file trova la voce che lo contiene
      for (const g of L.games.slice(0, 5)) {
        const hit = filterEntries(E, {query: g.name.replace(/\.bin$/i, '')});
        ok(hit.some((e) => e.ids.includes(g.id)), 'casuale: ricerca per nome di file ' + g.name);
      }
    }
  }
  {
    // ---- ordine delle sigle, scelta del file che da' titolo e metadati, ordine dell'elenco (casi costruiti a mano)
    const { sortEntries } = require(SP('gamelist.js'));
    const A = cart(7);
    const L = new Library();
    await L.addFile('c.zip', zipStore([{name: 'X/mod_zeta.bin', data: A}, {name: 'Y/br_07.bin', data: A}, {name: 'Z/vp_20.bin', data: A}, {name: 'W/vp_13.bin', data: A},
      {name: 'V/o2_05.bin', data: A}, {name: 'U/csv1.bin', data: A}]));
    const [e1] = buildEntries(L.games, L.names, {merge: true});
    eq(e1.count, 6, 'sei file con lo stesso contenuto: una voce');
    eq(e1.siglas, ['vp_13', 'vp_20', 'o2_05', 'br_07', 'csv1'], 'ordine delle sigle: per famiglia (vp, o2, br, csv), poi alfabetico');
    eq(e1.sigla, 'vp_13', 'la sigla della voce e\' la prima');
    ok(e1.label.startsWith('vp_13 \u2014 '), 'etichetta: sigla, trattino, nome');
    for (const x of ['vp_20', 'o2_05', 'br_07', 'csv1', 'mod_zeta']) ok(e1.others.includes(x), 'altri nomi: ' + x);
    ok(!e1.others.includes('vp_13'), 'la sigla principale non e\' tra gli altri nomi');
    eq(e1.folders, ['X', 'Y', 'Z', 'W', 'V', 'U'], 'cartelle nell\'ordine della libreria');
    // stessa voce con i file in un altro ordine: stesse sigle
    const L2 = new Library();
    await L2.addFile('c.zip', zipStore([{name: 'U/csv1.bin', data: A}, {name: 'V/o2_05.bin', data: A}, {name: 'W/vp_13.bin', data: A}, {name: 'Z/vp_20.bin', data: A}, {name: 'Y/br_07.bin', data: A}]));
    eq(buildEntries(L2.games, L2.names, {merge: true})[0].siglas, ['vp_13', 'vp_20', 'o2_05', 'br_07', 'csv1'], 'ordine delle sigle indipendente dall\'ordine dei file');

    // ordine delle famiglie di sigle: vp, o2, o3, br, csv, ntsc, mod (qualunque sia l'ordine dei file)
    {
      const fam = ['mod_05', 'ntsc_57', 'csv1', 'br_07', 'o3_45', 'o2_05', 'vp_13'];
      for (const names of [fam, fam.slice().reverse()]) {
        const Lf = new Library();
        await Lf.addFile('f.zip', zipStore(names.map((nm) => ({name: nm + '.bin', data: A}))));
        eq(buildEntries(Lf.games, Lf.names, {merge: true})[0].siglas, ['vp_13', 'o2_05', 'o3_45', 'br_07', 'csv1', 'ntsc_57', 'mod_05'], 'famiglie di sigle in ordine');
      }
      // le sigle di una stessa famiglia in ordine alfabetico, e una sigla fuori famiglia (lettera) dopo tutte
      const Lg = new Library();
      await Lg.addFile('g.zip', zipStore(['vp_20', 'vp_a', 'vp_13', 'o2_05'].map((nm) => ({name: nm + '.bin', data: A}))));
      eq(buildEntries(Lg.games, Lg.names, {merge: true})[0].siglas, ['vp_13', 'vp_20', 'vp_a', 'o2_05'], 'stessa famiglia: alfabetico');
      // tutte le permutazioni di quattro sigle della stessa famiglia
      const perms = (a) => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
      for (const pm of perms(['vp_13', 'vp_20', 'vp_21', 'vp_a'])) {
        const Lp4 = new Library();
        await Lp4.addFile('p.zip', zipStore(pm.map((nm) => ({name: nm + '.bin', data: A}))));
        eq(buildEntries(Lp4.games, Lp4.names, {merge: true})[0].siglas, ['vp_13', 'vp_20', 'vp_21', 'vp_a'], 'permutazione ' + pm.join(','));
      }
    }
    const mkLib0 = async (names) => { const Lx = new Library(); await Lx.addFile('x.zip', zipStore(names.map((nm) => ({name: nm, data: A})))); return Lx; };
    // a pari rango (stessa sigla, titolo dalla tabella) passa avanti il file con anno o editore, qualunque sia l'ordine; metaGame viene dal primo che li ha
    for (const [meta, field] of [['Zed (1981)(vp_13).bin', 'year'], ['Zed (Philips)(vp_13).bin', 'publisher']]) {
      for (const names of [['vp_13.bin', meta], [meta, 'vp_13.bin'], ['vp_13.bin', 'Q/vp_13.bin', meta]]) {
        const Lq = await mkLib0(names);
        const [eq0] = buildEntries(Lq.games, Lq.names, {merge: true});
        const mg = Lq.games.find((g) => g[field]);
        ok(mg && Lq.games.some((g) => !g[field]), 'prova ben posta: ' + names.join(' + '));
        eq([eq0.rep.id, eq0.metaGame.id], [mg.id, mg.id], 'rango uguale: vince il file con ' + field + ' (' + names.join(' + ') + ')');
      }
    }
    // i metadati vengono dal file che li ha anche se il titolo viene da un altro (rango migliore)
    for (const meta of [['Zy Game (1983).bin', 'year', '1983'], ['Zy Game (Philips)(EU).bin', 'publisher', 'Philips']]) {
      const Lw = await mkLib0(['vp_13.bin', meta[0]]);
      const [ew] = buildEntries(Lw.games, Lw.names, {merge: true});
      eq(ew.rep.name, 'vp_13.bin', 'il titolo viene dalla tabella (rango migliore)');
      eq(ew.metaGame[meta[1]], meta[2], 'metadati dal file descrittivo: ' + meta[1]);
    }
    // a pari rango (nomi descrittivi) passa avanti il file con anno o editore, qualunque sia l'ordine di arrivo; poi vince l'identificativo piu' basso
    const mkLib = async (names) => { const Lx = new Library(); await Lx.addFile('x.zip', zipStore(names.map((nm) => ({name: nm, data: A})))); return Lx; };
    for (const names of [['Zz Game (-)(-)(US).bin', 'Zz Game (1983)(Imagic)(US).bin'], ['Zz Game (1983)(Imagic)(US).bin', 'Zz Game (-)(-)(US).bin']]) {
      const Lx = await mkLib(names);
      const [ex] = buildEntries(Lx.games, Lx.names, {merge: true});
      const withMeta = Lx.games.find((g) => g.year);
      ok(withMeta && Lx.games.find((g) => !g.year && !g.publisher), 'prova ben posta: un file con metadati e uno senza');
      eq([ex.rep.id, ex.metaGame.id], [withMeta.id, withMeta.id], 'a pari rango vince il file con metadati: ' + names[0]);
      eq(ex.title, 'Zz Game', 'titolo: ' + names[0]);
    }
    {
      const Lp = await mkLib(['Zz Game (-)(-)(US).bin', 'Zz Game (Philips)(US).bin']);
      const [ep] = buildEntries(Lp.games, Lp.names, {merge: true});
      eq([ep.metaGame.publisher, ep.rep.publisher], ['Philips', 'Philips'], 'solo editore: metadati e file scelto');
      const Ly = await mkLib(['Zz Game (-)(-)(US).bin', 'Zz Game (1983).bin']);
      const [ey] = buildEntries(Ly.games, Ly.names, {merge: true});
      eq([ey.metaGame.year, ey.rep.year], ['1983', '1983'], 'solo anno: metadati e file scelto');
      const Ln = await mkLib(['P/Zz Game (-)(-)(US).bin', 'Q/Zz Game (-)(-)(US).bin']);
      const [en] = buildEntries(Ln.games, Ln.names, {merge: true});
      eq([en.rep.id, en.metaGame.id], [Ln.games[0].id, Ln.games[0].id], 'senza metadati: il primo file');
      // il file con nome descrittivo (rango 2) da' il titolo anche se arriva per ultimo; il nome grezzo diventa un altro nome
      for (const names of [['zz.bin', 'Zz Game (1983)(Imagic)(US).bin'], ['Zz Game (1983)(Imagic)(US).bin', 'zz.bin']]) {
        const [er] = buildEntries((await mkLib(names)).games, new Map(), {merge: true});
        eq(er.title, 'Zz Game', 'titolo dal file descrittivo: ' + names[0]);
        ok(er.others.includes('zz'), 'il nome grezzo e\' tra gli altri nomi: ' + names[0]);
      }
    }
    // ordine dell'elenco: titolo, poi sigla, poi identificativo; filterEntries senza opzioni
    const mk = (title, sigla, id) => ({title, sigla, rep: {id}});
    const srt = (l) => sortEntries(l).map((e) => e.title + '|' + e.sigla + '|' + e.rep.id);
    eq(srt([mk('B', '', 1), mk('A', '', 2)]), ['A||2', 'B||1'], 'ordine per titolo');
    eq(srt([mk('A', 'vp_20', 1), mk('A', 'vp_13', 2)]), ['A|vp_13|2', 'A|vp_20|1'], 'a pari titolo, per sigla');
    eq(srt([mk('A', 'vp_13', 5), mk('A', 'vp_13', 2)]), ['A|vp_13|2', 'A|vp_13|5'], 'a pari titolo e sigla, per identificativo');
    eq(srt([mk('a', 'x', 1), mk('A', 'y', 2), mk('\u00c1', 'z', 3)]), ['a|x|1', 'A|y|2', '\u00c1|z|3'], 'maiuscole e accenti non contano nel titolo');
    eq(srt([mk('B', 'vp_01', 1), mk('A', 'vp_02', 2), mk('B', '', 3)]), ['A|vp_02|2', 'B||3', 'B|vp_01|1'], 'sigla vuota prima delle altre');
    eq(filterEntries(entriesM).length, entriesM.length, 'filterEntries senza opzioni: tutto');
    eq(filterEntries(entriesM, null).length, entriesM.length, 'filterEntries con opzioni nulle: tutto');
    eq(filterEntries(entriesM, {query: ''}).length, entriesM.length, 'ricerca vuota: tutto');
    eq(filterEntries(entriesM, {query: '   '}).length, entriesM.length, 'ricerca di soli spazi: tutto');
    eq(filterEntries(entriesM, {folder: null}).length, entriesM.length, 'cartella nulla: tutto');
    // le sigle ricavate dall'impronta (tabella): una sola volta anche con tanti file (richiede un dump vero)
    const dumps = process.argv[2] || process.env.O2_DUMPS;
    const kbPath = dumps && require('path').join(dumps, 'killerbees.bin');
    if (kbPath && fs.existsSync(kbPath)) {
      const kb = new Uint8Array(fs.readFileSync(kbPath));
      const Lk = new Library();
      await Lk.addFile('k.zip', zipStore([{name: 'P/vp_52.bin', data: kb}, {name: 'Q/Vp52.bin', data: kb}, {name: 'R/vp_52.bin', data: kb}]));
      const [ek] = buildEntries(Lk.games, Lk.names, {merge: true});
      eq(ek.siglas, ['vp_52', 'vp_52pl'], 'sigla di rincalzo dall\'impronta: una volta sola, dopo quella del nome');
      eq(ek.others.filter((x) => x === 'vp_52pl').length, 1, 'la sigla di rincalzo e\' tra gli altri nomi una volta');
      // l'impronta prevale sul nome: Killer Bees chiamato vp_47 (The Mousing Cat) e' il Videopac 52+, con la nota della discordanza
      const Lc = new Library();
      await Lc.addFile('c.zip', zipStore([{name: 'P/vp_47.bin', data: kb}, {name: 'Q/Killer Bees (198x)(Philips)(EU).bin', data: kb}]));
      const [ec] = buildEntries(Lc.games, Lc.names, {merge: true});
      eq([ec.sigla, ec.conflict, ec.match.number, ec.match.plus, ec.count], ['vp_52pl', {name: 'vp_47', content: 'vp_52pl'}, 52, true, 2], 'discordanza nome/impronta: la voce e\' il Videopac 52+');
      ok(/Killer Bees/.test(ec.cat.line) && !/Mousing/.test(ec.text), 'la voce non porta il titolo del gioco sbagliato');
      const [ec2] = buildEntries(Lc.games.slice(0, 1), Lc.names, {merge: false});
      eq(ec2.conflict, {name: 'vp_47', content: 'vp_52pl'}, 'la discordanza si vede anche senza la fusione');
      const [en] = buildEntries(Lk.games.slice(0, 1), Lk.names, {merge: false});
      eq(en.conflict, null, 'senza discordanza: conflict = null');
    }
  }
  // ---- abbinamento al catalogo delle cartucce (vplist.js): la sigla, il titolo, la ricerca per cataloghi e titoli di altri paesi
  {
    const {plusInName, gameInfo} = require(SP('gamelist.js'));
    const L = new Library();
    await L.addFile('cat.zip', zipStore([
      {name: 'X/vp_43.bin', data: cart(41, 4096)},                                  // sigla -> 43
      {name: 'X/Frogger (198x)(Parker Brothers)(EU).bin', data: cart(42, 4096)},     // titolo -> Parker, senza numero
      {name: 'X/vp_56pl.bin', data: cart(43, 8192)},                                // Norseman, solo Plus
      {name: 'X/Programma Inventato (2010)(Nessuno).bin', data: cart(44, 2048)},     // niente nel catalogo
      {name: 'X/o2_37.bin', data: cart(45, 4096)}]));                               // Magnavox AC9437 = 43
    const E = buildEntries(L.games, L.names, {merge: true});
    const by = (f) => E.find(f);
    const e43 = by((e) => e.sigla === 'vp_43'), eFr = by((e) => /Frogger/.test(e.title)), eNo = by((e) => e.sigla === 'vp_56pl'), eNone = by((e) => /Inventato/.test(e.title)), eO2 = by((e) => e.sigla === 'o2_37');
    ok(e43 && e43.match && e43.match.how === 'sigla' && e43.match.number === 43 && e43.cat.catalogs.includes('G7143') && e43.cat.catalogs.includes('AC9437'), 'catalogo: vp_43');
    ok(eFr && eFr.match && eFr.match.how === 'titolo' && eFr.match.number === 0 && eFr.cat.catalogs.includes('981502'), 'catalogo: Frogger dal titolo');
    ok(eNo && eNo.match && eNo.match.plusOnly && eNo.cat.flags.includes('Plus-only') && /Norseman/.test(eNo.cat.line), 'catalogo: Norseman solo Plus');
    ok(eNone && eNone.match === null && eNone.cat === null, 'catalogo: un programma che non c\'e\' resta senza abbinamento');
    ok(eO2 && eO2.match && eO2.match.how === 'catalogo' && eO2.match.number === 43, 'catalogo: o2_37 = AC9437 = 43');
    const find = (q) => filterEntries(E, {query: q}).map((e) => e.sigla || e.title);
    ok(find('G7143').includes('vp_43'), 'ricerca per catalogo G7143: ' + find('G7143'));
    ok(find('Pioche').includes('vp_43'), 'ricerca per il titolo francese (Peter Tete de Pioche)');
    ok(find('Videopac 43').includes('vp_43') && find('Videopac 43').includes('o2_37'), 'ricerca «Videopac 43»: entrambe le voci');
    ok(find('Inventato').length === 1 && find('Norseman').includes('vp_56pl'), 'ricerca: le altre voci restano raggiungibili');
    // l'indizio Plus nel nome del file
    ok(plusInName('Pick Axe Pete+') && plusInName('Killer Bees (Plus)') && plusInName('killer_bees_plus') && plusInName('vp_43+'), 'plusInName: si');
    ok(!plusInName('Bowling + Basketball') && !plusInName('Plusfour Game') && !plusInName('Splus'), 'plusInName: no');
    // gameInfo: la sigla vince, i titoli senza doppioni
    const gi = gameInfo([L.games[0]], {sigla: 'vp_43', extraSiglas: ['vp_43pl'], title: 'X', altNames: ['X', 'Y']});
    eq([gi.sigla, gi.siglas, gi.titles.slice(0, 2), gi.plusHint], ['vp_43', ['vp_43pl'], ['X', 'Y'], true], 'gameInfo');
  }
  // ---- ordinamento per dispositivo e numero di cassetta (blocchi: Odyssey2, Videopac, Videopac+, poi un blocco per editore) o per nome
  {
    const {groupEntries, sortEntries} = require(SP('gamelist.js'));
    const FILES = [
      {name: 'A/vp_43.bin', data: cart(61, 4096)}, {name: 'A/vp_05.bin', data: cart(62, 2048)}, {name: 'A/vp_a.bin', data: cart(63, 2048)}, {name: 'A/vp_v.bin', data: cart(73, 2048)},
      {name: 'A/o2_37.bin', data: cart(64, 4096)}, {name: 'A/vp_43pl.bin', data: cart(65, 8192)}, {name: 'A/vp_56pl.bin', data: cart(66, 8192)},
      {name: 'A/vp_43_f.bin', data: cart(67, 4096)},
      {name: 'A/Killer Bees! (1982)(Magnavox)(US).bin', data: cart(74, 4096)},               // senza sigla: solo il titolo americano -> Odyssey2
      {name: 'A/Pick Axe Pete (198x)(Philips)(EU).bin', data: cart(75, 4096)},               // senza sigla: titolo europeo -> Videopac
      {name: 'A/Frogger (198x)(Parker Brothers)(EU).bin', data: cart(68, 4096)}, {name: 'A/Demon Attack (1983)(Imagic)(EU).bin', data: cart(69, 4096)},
      {name: 'A/Programma Inventato (2010)(Nessuno).bin', data: cart(70, 2048)}, {name: 'A/Altro Inventato (2011)(nessuno).bin', data: cart(71, 2048)},
      {name: 'A/boh.bin', data: cart(72, 2048)}];
    const mkLib = async (files) => { const Lx = new Library(); await Lx.addFile('ord.zip', zipStore(files)); return Lx; };
    const L = await mkLib(FILES);
    const E = buildEntries(L.games, L.names, {merge: true});
    const label = (e) => e.sigla || e.title.replace(/ \(.*$/, '');
    const dev = filterEntries(E, {order: 'device'});
    const WANT = ['o2_37', 'Killer Bees!', 'vp_05', 'Pick Axe Pete', 'vp_43', 'vp_43_f', 'vp_a', 'vp_v', 'vp_43pl', 'vp_56pl', 'Demon Attack', 'Altro Inventato', 'Programma Inventato', 'Frogger', 'boh'];
    eq(dev.map(label), WANT, 'ordine per dispositivo: Odyssey2, Videopac (numeri, poi lettere A e V), Videopac+, editori in ordine alfabetico, sconosciuto per ultimo');
    // lo stesso risultato qualunque sia l'ordine di arrivo dei file
    for (const files of [FILES.slice().reverse(), FILES.slice(5).concat(FILES.slice(0, 5)), FILES.slice().sort((a, b) => (a.name < b.name ? -1 : 1))]) {
      const Ly = await mkLib(files);
      eq(filterEntries(buildEntries(Ly.games, Ly.names, {merge: true}), {order: 'device'}).map(label), WANT, 'ordine per dispositivo indipendente dall\'ordine di arrivo');
    }
    const gr = groupEntries(dev, 'device');
    eq(gr.map((g) => [g.kind, g.label, g.entries.length]), [['odyssey', 'Odyssey² (Magnavox)', 2], ['videopac', 'Videopac (Philips G7000)', 6], ['plus', 'Videopac+ (Philips G7400)', 2],
      ['maker', 'Imagic', 1], ['maker', 'Nessuno', 2], ['maker', 'Parker Brothers', 1], ['unknown', 'Editore sconosciuto', 1]], 'blocchi con intestazione');
    eq(filterEntries(E, {order: 'name'}).map((e) => e.key), sortEntries(E).map((e) => e.key), 'ordine per nome = ordine alfabetico di prima');
    eq(filterEntries(E, {}).map((e) => e.key), sortEntries(E).map((e) => e.key), 'senza ordine indicato: per nome');
    eq(groupEntries(filterEntries(E, {order: 'name'}), 'name').map((g) => [g.kind, g.entries.length]), [['all', E.length]], 'per nome: un blocco solo, senza intestazione');
    eq(groupEntries([], 'device'), [], 'elenco vuoto: nessun blocco');
    eq(filterEntries(E, {order: 'device', query: 'inventato'}).map(label), ['Altro Inventato', 'Programma Inventato'], 'ordine e ricerca insieme');
    const byLab = (l) => E.find((e) => label(e) === l);
    eq([byLab('o2_37').device, byLab('Killer Bees!').device, byLab('Pick Axe Pete').device, byLab('vp_43').device, byLab('vp_43pl').device, byLab('Frogger').device, byLab('boh').device], ['odyssey', 'odyssey', 'videopac', 'videopac', 'plus', 'maker', 'unknown'], 'dispositivo di ogni voce');
    eq([byLab('Demon Attack').maker, byLab('Frogger').maker, byLab('Programma Inventato').maker, byLab('boh').maker], ['Imagic', 'Parker Brothers', 'Nessuno', ''], 'editore di ogni voce');
    eq(byLab('vp_a').num < Infinity && byLab('vp_a').num > byLab('vp_56pl').num && byLab('vp_v').num > byLab('vp_a').num, true, 'le lettere (Videopac A, poi V) vengono dopo i numeri');
    // il dispositivo non cambia l'insieme delle voci
    eq(dev.length, E.length, 'nessuna voce persa o duplicata');
    eq(new Set(dev.map((e) => e.key)).size, E.length, 'ogni voce una volta sola');
  }
  console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
  process.exit(bad ? 1 : 0);
})();
