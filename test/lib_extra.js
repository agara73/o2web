'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// lib_extra.js - controlli di confine per library.js (nomi, classificazione, limiti, ordinamento, doppioni). Usato da test_library.js.
// Nessun dump: byte casuali o sintetici.
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const L = require(SP('library.js'));
const {zipStore} = require(SP('zipstore.js'));
const {analyzeCart, layoutCart} = require(SP('cartmap.js'));

module.exports = async function libExtra(ok, eqj, bytes) {
  const enc = (s) => new TextEncoder().encode(s);
  const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  const w32 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255; };
  // dichiara nella directory centrale dimensioni diverse da quelle vere (per provare i limiti senza grandi buffer)
  const forge = (z, sizes) => {
    const b = z.slice();
    const e = b.length - 22;
    let p = u32(b, e + 16);
    for (let i = 0; i < sizes.length; i++) {
      w32(b, p + 24, sizes[i]);
      p += 46 + (b[p + 28] | (b[p + 29] << 8)) + (b[p + 30] | (b[p + 31] << 8)) + (b[p + 32] | (b[p + 33] << 8));
    }
    return b;
  };

  // ---- anni, paesi, estensioni, articoli, gruppi
  const P = L.parseTosecName;
  for (const y of ['1983', '198x', '19xx', 'xxxx', '1x8x', '1983-05', '1983-05-12', '2000-12-31'])
    eqj([P('T (' + y + ')(Pub)(EU).bin').year, P('T (' + y + ')(Pub)(EU).bin').publisher], [y, 'Pub'], 'anno valido ' + y);
  for (const y of ['12345', '198', '19', '1983-5', '1983-05-1', '1983-05-123', '19831', 'a1983', '1983a', '1983-05-12-01', '1983-ab', 'abcd'])
    eqj([P('T (' + y + ')(Pub)(EU).bin').year, P('T (' + y + ')(Pub)(EU).bin').publisher], ['', y], 'anno non valido ' + y);
  for (const c of ['EU', 'EU-US', 'DE-FR-IT'])
    ok(P('T (1983)(P)(' + c + ')').country === c, 'paese ' + c);
  for (const c of ['eu', 'EUR', 'E', 'Eu', 'EU-', 'EU-us', '-EU', 'EU US', 'en'])
    eqj([P('T (1983)(P)(' + c + ')').country, P('T (1983)(P)(' + c + ')').extra], ['', [c]], 'paese non valido ' + c);
  eqj(P('Foo (1983)').publisher, '', 'solo anno: editore vuoto');
  eqj([P('Foo (1983)').year, P('Foo (1983)').country, P('Foo (1983)').extra], ['1983', '', []], 'solo anno');
  eqj([P('Foo (Bar)').year, P('Foo (Bar)').publisher], ['', 'Bar'], 'solo editore');
  eqj([P('Foo (Bar)(EU)').publisher, P('Foo (Bar)(EU)').country], ['Bar', 'EU'], 'editore e paese senza anno');
  eqj([P('Foo (1983)(Bar)').country, P('Foo (1983)(Bar)').extra], ['', []], 'senza paese');
  eqj([P('Foo (1983)(Bar)(EU)(en)(x y)').extra], [['en', 'x y']], 'gruppi extra');
  eqj([P('Foo').publisher, P('Foo').year, P('Foo').country, P('Foo').extra], ['', '', '', []], 'nessun gruppo');
  eqj(P('Foo (1983)(-)(EU)').publisher, '', 'editore trattino');
  eqj(P('Foo (1983)(--)(EU)').publisher, '--', 'editore due trattini');
  for (const [ext, nm] of [['bin', 'a'], ['BIN', 'a'], ['rom', 'a'], ['ROM', 'a'], ['o2', 'a'], ['vp', 'a'], ['VP', 'a'], ['zip', 'a'], ['Zip', 'a']])
    ok(P(nm + '.' + ext).title === nm, 'estensione ' + ext + ' tolta');
  ok(P('a.txt').title === 'a.txt', 'estensione txt resta');
  ok(P('a.bin.bak').title === 'a.bin.bak', 'estensione bak resta');
  ok(P('a.binx').title === 'a.binx', 'binx resta');
  ok(P('a.zip.bin').title === 'a.zip', 'solo l\'ultima estensione');
  ok(P('/x/y/Gioco (1981).bin').title === 'Gioco' && P('/x (1981).bin').title === 'x' && P('x\\y\\Z (1981).bin').title === 'Z', 'percorso tolto');
  ok(P('\\W (1981).bin').title === 'W', 'barra inversa iniziale');
  for (const a of ['The', 'A', 'An', 'Le', 'La', 'Les', 'Der', 'Die', 'Das', 'El', 'Il'])
    ok(P('Foo, ' + a + ' (1983)').display === a + ' Foo' && P('Foo, ' + a + ' (1983)').title === 'Foo, ' + a, 'articolo ' + a);
  ok(P('Foo, Xx (1983)').display === 'Foo, Xx', 'articolo falso');
  ok(P('Foo, the (1983)').display === 'Foo, the', 'articolo minuscolo non toccato');
  ok(P('Foo,The (1983)').display === 'Foo,The', 'senza spazio non toccato');
  ok(P('Foo, The Bar (1983)').display === 'Foo, The Bar', 'articolo nel mezzo non toccato');
  ok(P('Foo, The, The (1983)').display === 'The Foo, The', 'articolo finale');
  ok(P('  Foo  (1983)').title === 'Foo', 'spazi tolti');
  ok(P('Foo[b]').title === 'Foo' && P('Foo[b]').flags[0] === 'b', 'flag subito dopo il titolo');
  ok(P('Foo [b]').title === 'Foo', 'titolo prima del flag');
  // flag
  eqj(P('Foo (1983)(P)(EU)[b]').warn, ['dump difettoso: potrebbe non funzionare'], 'avviso del flag b');
  eqj(P('Foo (1983)(P)(EU)[b1]').warn, ['dump difettoso: potrebbe non funzionare'], 'avviso del flag b1');
  eqj(P('Foo (1983)(P)(EU)[a][!]').warn, [], 'nessun avviso per a e !');
  eqj(P('Foo (1983)(P)(EU)[!]').flags, ['!'], 'flag !');
  eqj(P('Foo (1983)(P)(EU)[B]').warn, [], 'flag maiuscolo senza avviso');
  eqj(P('Foo [ b ]').flags, ['b'], 'flag con spazi');
  eqj(P('Foo ( 1983 )( P )').year, '1983', 'gruppi con spazi');
  const F = L.flagLabel;
  eqj([F('!'), F('a'), F('a2'), F('b'), F('h Foo'), F('cr'), F('t'), F('o'), F('f'), F('m'), F('p'), F('u'), F('v'), F('v1.1'), F('zz'), F('zz3'), F(''), F('1'), F('!2')],
    ['dump verificato', 'variante', 'variante 2', 'dump difettoso', 'modificata (hack)', 'con crack', 'con trucchi', 'dump con byte in più', 'corretta', 'modificata', 'pirata', 'sconosciuta',
      'versione', 'versione 1', 'zz', 'zz3', '', '1', 'dump verificato 2'], 'flagLabel');
  // cartelle, ricerca, piattaforma
  const CF = L.cleanFolder;
  eqj([CF('Magnavox Odyssey2 - Games (TOSEC-v2012-04-23_CM)'), CF('A [TOSEC] B'), CF('  a   b  '), CF(''), CF(null), CF(undefined), CF('x (tosec-v1) y')],
    ['Magnavox Odyssey2 - Games', 'A B', 'a b', '', '', '', 'x y'], 'cleanFolder');
  eqj([L.searchKey('Zürich Éàü'), L.searchKey('ABC'), L.searchKey('ß'), L.searchKey(null), L.searchKey('́'), L.searchKey('é'), L.searchKey('a-z')],
    ['zurich eau', 'abc', 'ß', '', '', 'e', 'a-z'], 'searchKey');
  eqj([L.platformOf('Magnavox Odyssey2 - Games (TOSEC-v1)'), L.platformOf('Solo'), L.platformOf(''), L.platformOf('A - B - C')], ['Magnavox Odyssey2', '', '', 'A'], 'platformOf');

  // ---- classificazione
  const C = (name, folder, n, fill) => {
    const b = fill === undefined ? bytes(n) : new Uint8Array(n).fill(fill);
    return L.classify(name, folder, b);
  };
  eqj(C('a.bin', '', 0), {kind: 'skip', why: 'file vuoto'}, 'vuoto');
  eqj(C('a.bin', '', 32769).why, 'troppo grande per un dump di questa console (32769 byte)', 'oltre 32768');
  ok(C('a.bin', '', 32768).kind === 'cart', '32768 e\' ancora una cartuccia');
  ok(C('a.bin', '', 32767).kind === 'cart', '32767');
  eqj(C('a.bin', 'BIOS', 32769).kind, 'skip', 'troppo grande anche con il suggerimento');
  eqj(C('a.bin', '', 1023).why, 'troppo piccolo (1023 byte)', '1023');
  eqj(C('a.bin', '', 1).why, 'troppo piccolo (1 byte)', '1 byte');
  eqj(C('a.bin', 'BIOS', 1023).kind, 'skip', '1023 con suggerimento');
  ok(C('a.bin', '', 1024).kind === 'bios', '1024 e\' un BIOS');
  ok(C('a.bin', '', 1024).known === null, '1024 non noto');
  ok(C('a.bin', 'x', 1025).kind === 'cart', '1025 senza suggerimento: cartuccia');
  ok(C('a.bin', 'x', 2047).kind === 'cart', '2047 senza suggerimento: cartuccia');
  ok(C('a.bin', 'x', 2048).kind === 'cart', '2048 senza suggerimento: cartuccia');
  ok(C('a.bin', 'x', 4096).kind === 'cart', '4096');
  for (const h of ['bios', 'BIOS', 'firmware', 'Firmware', 'jopac', 'JOPAC', 'c52', 'C52']) {
    ok(C(h + '.bin', 'x', 1025).kind === 'bios', 'suggerimento nel nome: ' + h + ' a 1025');
    ok(C('a.bin', 'dir ' + h, 2048).kind === 'bios', 'suggerimento nella cartella: ' + h + ' a 2048');
    ok(C('a.bin', 'x ' + h + ' y', 2049).kind === 'cart', 'suggerimento ma 2049: cartuccia (' + h + ')');
    ok(C(h + '.bin', 'x', 2048).known === null, 'BIOS suggerito non noto');
  }
  ok(C('abcd.bin', 'x', 1500).kind === 'cart', 'nessun suggerimento: cartuccia');
  ok(C('b1os.bin', 'x', 1500).kind === 'cart', 'parola simile: cartuccia');
  ok(C('a.bin', 'x', 1500).sha.length === 64, 'impronta');
  // set di caratteri del chip video: esattamente 512 byte (estensioni da dump); non entra nell'elenco, lo prende app.js
  ok(C('a.bin', '', 512).kind === 'charset' && C('a.bin', '', 512).sha.length === 64, '512 byte: set di caratteri');
  for (const e of ['.bin', '.rom', '.o2', '.vp', '', '.BIN']) ok(C('cs' + e, '', 512).kind === 'charset', '512 byte, estensione "' + e + '"');
  ok(C('cs.txt', '', 512).kind === 'skip' && /tipo di file/.test(C('cs.txt', '', 512).why), '512 byte .txt: non e\' un dump');
  ok(C('bios.bin', 'BIOS', 512).kind === 'charset', '512 byte con suggerimento BIOS: resta un set di caratteri');
  eqj([C('a.bin', '', 511).why, C('a.bin', '', 513).why], ['troppo piccolo (511 byte)', 'troppo piccolo (513 byte)'], '511 e 513 byte: non sono un set di caratteri');
  for (const e of ['.bin', '.BIN', '.rom', '.o2', '.vp', '.Vp']) ok(C('a' + e, 'x', 1500).kind === 'cart', 'estensione ' + e);
  eqj(C('a.txt', 'x', 1500), {kind: 'skip', why: 'tipo di file non riconosciuto (.txt)'}, 'estensione txt');
  eqj(C('a.TXT', 'x', 1500).why, 'tipo di file non riconosciuto (.txt)', 'estensione TXT');
  eqj(C('a.mp3', 'x', 1500).why, 'tipo di file non riconosciuto (.mp3)', 'estensione mp3');
  eqj(C('a.7z', 'x', 1500).why, 'tipo di file non riconosciuto (.7z)', 'estensione 7z');
  eqj(C('a.Z9', 'x', 1500).why, 'tipo di file non riconosciuto (.z9)', 'estensione Z9');
  eqj(C('a.a', 'x', 1500).why, 'tipo di file non riconosciuto (.a)', 'estensione di una lettera');
  eqj(C('a.abcd', 'x', 1500).why, 'tipo di file non riconosciuto (.abcd)', 'estensione di 4 lettere');
  ok(C('a.abcde', 'x', 1500).kind === 'cart', 'estensione di 5 lettere = nessuna estensione');
  ok(C('a', 'x', 1500).kind === 'cart', 'senza estensione');
  ok(C('dir.txt/a.bin', 'x', 1500).kind === 'cart', 'estensione solo nel nome del file');
  ok(C('dir\\a.txt', 'x', 1500).kind === 'skip', 'percorso con barra inversa');
  // BIOS noto: anche con estensione strana? (l'estensione conta prima dell'impronta)
  const knownSha = Object.keys(L.KNOWN_BIOS)[0];
  eqj(Object.keys(L.KNOWN_BIOS).length, 4, '4 BIOS noti');
  ok(L.KNOWN_BIOS[knownSha].supported === true, 'G7000 supportato');

  // ---- makeGame / makeBios
  {
    const raw = bytes(3000);
    const g = L.makeGame('cartelle/Foo, The (1983)(Pub)(EU)[b].bin', 'Plat - Games (TOSEC-v1)', undefined, raw);
    eqj([g.id, g.name, g.folder, g.platform, g.origin, g.size, g.title, g.display, g.year, g.publisher, g.country, g.flags, g.warn.length],
      [0, 'Foo, The (1983)(Pub)(EU)[b].bin', 'Plat - Games', 'Plat', '', 3000, 'Foo, The', 'The Foo', '1983', 'Pub', 'EU', ['b'], 1], 'makeGame campi');
    ok(g.sha.length === 64 && g.data === raw, 'makeGame impronta e dati');
    const pad = new Uint8Array(4096).fill(0xFF); pad.set(raw);
    const m = analyzeCart(pad);
    eqj(g.map, {kind: m.kind, banks: m.banks, ok: m.ok, reason: m.reason}, 'makeGame mappa');
    const g2 = L.makeGame('a.bin', '', 'zip: x', raw, 'abc');
    eqj([g2.origin, g2.sha, g2.folder, g2.platform], ['zip: x', 'abc', '', ''], 'makeGame origine e impronta date');
    for (const n of [1024, 1500, 2047, 2048, 2049, 4000, 4096, 4097, 8192, 8193, 12288, 16384]) {
      const r = bytes(n);
      const gg = L.makeGame('a.bin', '', '', r);
      const pd = new Uint8Array(Math.ceil(n / 0x800) * 0x800).fill(0xFF); pd.set(r);
      const mm = analyzeCart(layoutCart(pd));
      eqj(gg.map, {kind: mm.kind, banks: mm.banks, ok: mm.ok, reason: mm.reason}, 'makeGame mappa a ' + n);
    }
    // dati con coda 0xFF: mappa uguale se la coda e' virtuale o vera
    const r2 = new Uint8Array(3000); r2.set(bytes(2048)); // seconda meta' a zero
    const gz = L.makeGame('a.bin', '', '', r2);
    const pz = new Uint8Array(4096).fill(0xFF); pz.set(r2);
    const mz = analyzeCart(pz);
    eqj(gz.map, {kind: mz.kind, banks: mz.banks, ok: mz.ok, reason: mz.reason}, 'makeGame mappa con zeri');

    const b = bytes(1024);
    const bk = L.makeBios('dir/bios (1979)(Philips).bin', 'F (TOSEC-v1)', undefined, b);
    eqj([bk.id, bk.name, bk.folder, bk.origin, bk.size, bk.supported, bk.reason, bk.known, bk.display], [0, 'bios (1979)(Philips).bin', 'F', '', 1024, true, '', null, 'bios'], 'makeBios campi');
    const bk2 = L.makeBios('b.bin', '', 'file', b, knownSha);
    ok(bk2.known && bk2.known.system === 'g7000' && bk2.display === L.KNOWN_BIOS[knownSha].label && bk2.supported, 'makeBios con impronta nota passata');
    const bk3 = L.makeBios('b.bin', '', 'file', b, knownSha, null);
    ok(bk3.known === null && bk3.display === 'b', 'makeBios con known = null esplicito');
    const fake = {label: 'Mio', system: 'g7000', supported: true};
    const bk4 = L.makeBios('b.bin', '', 'file', b, 'zzz', fake);
    ok(bk4.display === 'Mio' && bk4.known.label === 'Mio' && bk4.sha === 'zzz', 'makeBios con known dato');
    const unsup = {label: 'U', system: 'g7400', supported: false, reason: 'perche\''};
    const bk5 = L.makeBios('b.bin', '', 'file', b, 'zzz', unsup);
    eqj([bk5.supported, bk5.reason], [false, 'perche\''], 'makeBios non supportato con motivo');
    const bk6 = L.makeBios('b.bin', '', 'file', b, 'zzz', {label: 'U', system: 'x', supported: false});
    eqj([bk6.supported, bk6.reason], [false, 'non supportato'], 'makeBios non supportato senza motivo');
    const b2 = bytes(2048);
    const bk7 = L.makeBios('b.bin', 'bios', 'file', b2, undefined, null);
    eqj([bk7.supported, bk7.reason, bk7.size], [false, 'BIOS da 2048 byte: formato non supportato (solo 1024 byte)', 2048], 'makeBios da 2 KB');
    const bk8 = L.makeBios('b.bin', 'bios', 'file', b2, 'zzz', {label: 'U', system: 'x', supported: true});
    eqj([bk8.supported], [false], 'makeBios da 2 KB anche se noto come supportato');
    const bk9 = L.makeBios('b.bin', '', 'file', b, knownSha, undefined);
    ok(bk9.known && bk9.known.label === L.KNOWN_BIOS[knownSha].label, 'makeBios con known undefined cerca per impronta');
  }

  // ---- elenco: id, doppioni, clear, ricerche, limiti
  {
    const lib = new L.Library();
    const g1 = lib.addGame({folder: 'F', name: 'a', sha: 's1', display: 'a'});
    ok(g1.id === 1, 'primo id = 1');
    const g2 = lib.addGame({folder: 'F', name: 'b', sha: 's1', display: 'b'});
    ok(g2 && g2.id === 2, 'stesso contenuto, nome diverso: gioco diverso');
    ok(lib.addGame({folder: 'F', name: 'a', sha: 's1'}) === null, 'stesso nome, cartella e contenuto: doppione');
    ok(lib.addGame({folder: 'G', name: 'a', sha: 's1'}) !== null, 'cartella diversa: non e\' doppione');
    ok(lib.addGame({folder: 'F', name: 'a', sha: 's2'}) !== null, 'contenuto diverso: non e\' doppione');
    const b1 = lib.addBios({folder: 'F', name: 'x', sha: 'b1'});
    ok(lib.addBios({folder: 'G', name: 'y', sha: 'b1'}) === null, 'BIOS con lo stesso contenuto: doppione qualunque il nome');
    ok(lib.addBios({folder: 'G', name: 'y', sha: 'b2'}) !== null, 'BIOS con altro contenuto');
    ok(lib.addGame({folder: 'F', name: 'x', sha: 'b1'}) !== null, 'un gioco non confligge con un BIOS');
    ok(lib.findBiosBySha('b1') === b1 && lib.findBiosBySha('nope') === null && lib.findBiosBySha('s1') === null, 'findBiosBySha');
    ok(lib.findGameBySha('s1') === g1 && lib.findGameBySha('nope') === null && lib.findGameBySha('b2') === null, 'findGameBySha');
    ok(lib.getGame(g2.id) === g2 && lib.getGame(9999) === null && lib.getBios(b1.id) === b1 && lib.getBios(g1.id) === null && lib.getBios(9999) === null, 'getGame / getBios');
    ok(lib.remove('games', g2.id) === true && lib.getGame(g2.id) === null && lib.remove('games', g2.id) === false, 'remove gioco');
    ok(lib.addGame({folder: 'F', name: 'b', sha: 's1'}) !== null, 'dopo remove il gioco si puo\' riaggiungere');
    ok(lib.remove('bios', b1.id) === true && lib.getBios(b1.id) === null && lib.remove('bios', b1.id) === false, 'remove BIOS');
    ok(lib.addBios({folder: 'F', name: 'x', sha: 'b1'}) !== null, 'dopo remove il BIOS si puo\' riaggiungere');
    ok(lib.remove('games', b1.id) === false, 'remove con l\'elenco sbagliato non tocca');
    lib.clear();
    eqj([lib.games.length, lib.bios.length, lib.keys.size], [0, 0, 0], 'clear');
    ok(lib.addGame({folder: 'F', name: 'a', sha: 's1'}) !== null && lib.addBios({folder: 'F', name: 'x', sha: 'b1'}) !== null, 'dopo clear nessun doppione residuo');
    // limiti
    const big = new L.Library();
    for (let i = 0; i < L.LIMITS.games; i++) big.addGame({folder: '', name: 'g' + i, sha: 's' + i});
    let msg = '';
    try { big.addGame({folder: '', name: 'x', sha: 'x'}); } catch (e) { msg = e.message; }
    ok(msg === 'elenco pieno (5000 giochi)', 'limite giochi 5000: ' + msg);
    ok(big.addGame({folder: '', name: 'g0', sha: 's0'}) === null, 'a elenco pieno un doppione non e\' un errore');
    for (let i = 0; i < L.LIMITS.bios; i++) big.addBios({folder: '', name: 'b' + i, sha: 'z' + i});
    msg = '';
    try { big.addBios({folder: '', name: 'x', sha: 'x'}); } catch (e) { msg = e.message; }
    ok(msg === 'elenco pieno (200 BIOS)', 'limite BIOS 200: ' + msg);
    const rep = await big.addFile('b.bin', bytes(1024));
    ok(rep.bios === 0 && rep.errors.length === 1 && /^b\.bin: elenco pieno/.test(rep.errors[0]), 'addFile a elenco pieno: errore nel rapporto (' + rep.errors + ')');
    const rep2 = await big.addFile('c.bin', bytes(3000));
    ok(rep2.games === 0 && rep2.errors.length === 1 && /^c\.bin: elenco pieno \(5000 giochi\)/.test(rep2.errors[0]), 'addFile a elenco pieno (giochi)');
  }

  // ---- addFile: limiti e rapporti
  {
    const lib = new L.Library();
    // profondita': cartuccia dentro 2 zip annidati ok, dentro 3 saltata
    const cart = bytes(2048);
    const z1 = zipStore([{name: 'g.bin', data: cart}]);
    const z2 = zipStore([{name: 'in1.zip', data: z1}]);
    const z3 = zipStore([{name: 'in2.zip', data: z2}]);
    const z4 = zipStore([{name: 'in3.zip', data: z3}]);
    let r = await lib.addFile('top.zip', z3);
    eqj([r.games, r.skipped.length, r.errors.length], [1, 0, 0], 'zip in zip in zip: la cartuccia si trova');
    const lib2 = new L.Library();
    r = await lib2.addFile('top.zip', z4);
    eqj([r.games, r.skipped.length, r.errors.length], [0, 1, 0], 'un livello in piu\': saltato');
    ok(r.skipped[0].why === 'zip annidati troppo in profondità', 'motivo: profondita\'');
    eqj(r.visited, 4, 'voci visitate (4 zip annidati)');
    // il nome nel rapporto per un file saltato e' quello dell'elemento, con il percorso intero
    // voci visitate e avanzamento
    const lib3 = new L.Library();
    const many = zipStore(Array.from({length: 40}, (_, i) => ({name: 'e' + i + '.txt', data: enc('x')})));
    const prog = [];
    r = await lib3.addFile('many.zip', many, {onProgress: (n) => prog.push(n)});
    eqj([r.visited, r.skipped.length, prog], [41, 40, [16, 32]], 'avanzamento ogni 16 voci');
    r = await lib3.addFile('many.zip', many);
    eqj(r.visited, 41, 'senza onProgress');
    // limite delle voci: 20000 (contando anche lo zip)
    const mk = (n) => zipStore(Array.from({length: n}, (_, i) => ({name: 'e' + i, data: new Uint8Array(0)})));
    r = await new L.Library().addFile('m.zip', mk(19999));
    eqj([r.errors.length, r.visited], [0, 20000], '20000 voci in tutto: ok');
    r = await new L.Library().addFile('m.zip', mk(20000));
    eqj(r.errors, ['m.zip: troppe voci (oltre 20000)'], 'oltre 20000 voci: errore');
    // zip rotto dentro uno zip: l'errore porta il nome interno, il resto continua
    const bad = zipStore([{name: 'x.bin', data: bytes(1500)}]);
    bad[bad.length - 22 + 16] ^= 0xFF; // directory centrale fuori posto
    const outer = zipStore([{name: 'sub/bad.zip', data: bad}, {name: 'sub/good.bin', data: bytes(2048)}]);
    const lib4 = new L.Library();
    r = await lib4.addFile('outer.zip', outer);
    eqj([r.games, r.errors.length], [1, 1], 'zip interno rotto: il resto continua');
    ok(/^bad\.zip: /.test(r.errors[0]), 'errore con nome interno: ' + r.errors[0]);
    // voce con CRC sbagliato
    const crcbad = zipStore([{name: 'a.bin', data: bytes(1500)}, {name: 'b.bin', data: bytes(2048)}]);
    crcbad[30 + 5 + 3] ^= 0xFF; // un byte dei dati della prima voce
    const lib5 = new L.Library();
    r = await lib5.addFile('c.zip', crcbad);
    eqj([r.games, r.errors.length], [1, 1], 'voce con CRC sbagliato: il resto continua');
    ok(/^a\.bin: controllo CRC/.test(r.errors[0]), 'errore voce: ' + r.errors[0]);
    // file non zip e zip vuoto dichiarato
    r = await new L.Library().addFile('x.zip', enc('PK\x03\x04 non e\' uno zip'));
    ok(r.errors.length === 1 && /^x\.zip: /.test(r.errors[0]), 'zip rotto al livello superiore: ' + r.errors[0]);
    // dimensioni dichiarate: foglia oltre il limite saltata, esattamente al limite no
    const fz = forge(zipStore([{name: 'a.bin', data: bytes(1500)}, {name: 'b.bin', data: bytes(1500)}, {name: 'c.zip', data: bytes(1500)}]),
      [32769, 32768, (64 << 20) + 1]);
    r = await new L.Library().addFile('f.zip', fz);
    eqj(r.skipped.map((s) => s.name + ': ' + s.why), ['a.bin: troppo grande per un dump di questa console (32769 byte)', 'c.zip: zip troppo grande'], 'dimensioni dichiarate oltre i limiti');
    eqj(r.errors.length, 1, 'quella al limite viene letta (e fallisce: dimensione dichiarata falsa)');
    ok(/^b\.bin: dimensione/.test(r.errors[0]), 'errore: ' + r.errors[0]);
    const fz2 = forge(zipStore([{name: 'c.zip', data: bytes(1500)}]), [64 << 20]);
    r = await new L.Library().addFile('f.zip', fz2);
    eqj([r.skipped.length, r.errors.length], [0, 1], 'zip interno di 64 MB esatti: non saltato');
    // byte estratti in tutto: 8 voci da 64 MB = 512 MB esatti (ok), la nona supera
    const eight = forge(zipStore(Array.from({length: 8}, (_, i) => ({name: 'z' + i + '.zip', data: bytes(1500)}))), Array(8).fill(64 << 20));
    r = await new L.Library().addFile('e.zip', eight);
    eqj([r.skipped.length, r.errors.length, r.errors.filter((e) => /limite/.test(e)).length], [0, 8, 0], '512 MB in tutto: ancora ok');
    const nine = forge(zipStore(Array.from({length: 9}, (_, i) => ({name: 'z' + i + '.zip', data: bytes(1500)}))), Array(9).fill(64 << 20));
    r = await new L.Library().addFile('n.zip', nine);
    ok(r.errors.some((e) => e === 'n.zip: limite di byte estratti superato (512 MB)'), 'oltre 512 MB: limite (' + r.errors.slice(-1) + ')');
    // cartella: file singolo in zip multiplo prende il nome dello zip; zip con un solo file no; la cartella interna vince
    const lib6 = new L.Library();
    await lib6.addFile('Raccolta.zip', zipStore([{name: 'a.bin', data: bytes(2048)}, {name: 'b.bin', data: bytes(2048)}]));
    await lib6.addFile('Uno.zip', zipStore([{name: 'c.bin', data: bytes(2048)}]));
    await lib6.addFile('Altro.zip', zipStore([{name: 'x/y/d.bin', data: bytes(2048)}, {name: 'e.bin', data: bytes(2048)}]));
    await lib6.addFile('f.bin', bytes(2048));
    eqj(lib6.games.map((g) => g.name + '@' + g.folder + '@' + g.origin), ['a.bin@Raccolta@zip: Raccolta.zip', 'b.bin@Raccolta@zip: Raccolta.zip', 'c.bin@@zip: Uno.zip',
      'd.bin@y@zip: Altro.zip', 'e.bin@Altro@zip: Altro.zip', 'f.bin@@file'], 'cartelle e origini');
    // percorsi particolari nello zip
    const lib7 = new L.Library();
    await lib7.addFile('P.zip', zipStore([{name: '/lead/g.bin', data: bytes(2048)}, {name: 'w\\in\\h.bin', data: bytes(2048)}, {name: 'dir/', data: new Uint8Array(0)}, {name: 'a/b/c/k.bin', data: bytes(2048)}]));
    eqj(lib7.games.map((g) => g.name + '@' + g.folder), ['g.bin@lead', 'h.bin@in', 'k.bin@c'], 'cartella = ultima directory del percorso');
    // un solo BIOS con piu' nomi
    const lib8 = new L.Library();
    const bb = bytes(1024);
    await lib8.addFile('one.bin', bb);
    r = await lib8.addFile('two.bin', bb);
    eqj([lib8.bios.length, r.dups, r.bios], [1, 1, 0], 'BIOS doppio: una voce sola');
    r = await lib8.addFile('three.bin', bytes(1024));
    eqj([lib8.bios.length, r.dups, r.bios, r.addedBios.length], [2, 0, 1, 1], 'BIOS diverso: due voci');
    const cc = bytes(2048);
    r = await lib8.addFile('c.bin', cc);
    const r2 = await lib8.addFile('c.bin', cc);
    eqj([r.games, r.dups, r2.games, r2.dups, r.addedGames.length, r2.addedGames.length], [1, 0, 0, 1, 1, 0], 'cartuccia doppia');
  }

  // ---- ordinamento, filtro, cartelle
  {
    const mkG = (id, display, year, name, folder, extra) => Object.assign({id, display, title: display, year, name, folder: folder || '', platform: '', publisher: '', country: '', extra: [], flags: []}, extra || {});
    const list = [mkG(5, 'beta', '1982', 'z'), mkG(4, 'Alpha', '1983', 'a'), mkG(3, 'alpha', '1982', 'b'), mkG(2, 'alpha', '1982', 'a'), mkG(1, 'alpha', '1982', 'a'),
      mkG(6, 'Éclair', '1981', 'e'), mkG(7, 'Zed', '1981', 'q')];
    const ord = (l) => L.sortGames(l).map((g) => g.id);
    eqj(ord(list), [1, 2, 3, 4, 5, 6, 7], 'ordine: titolo (senza maiuscole e accenti), anno, nome, id');
    eqj(ord(list.slice().reverse()), [1, 2, 3, 4, 5, 6, 7], 'ordine indipendente da quello di partenza');
    eqj(ord([mkG(1, 'x', '1990', 'n'), mkG(2, 'x', '1980', 'n')]), [2, 1], 'ordine per anno');
    eqj(ord([mkG(1, 'x', '1980', 'b'), mkG(2, 'x', '1980', 'a')]), [2, 1], 'ordine per nome');
    eqj(ord([mkG(2, 'x', '1980', 'a'), mkG(1, 'x', '1980', 'a')]), [1, 2], 'ordine per id');
    eqj(ord([mkG(1, 'b', '1', 'n'), mkG(2, 'a', '1', 'n')]), [2, 1], 'ordine per titolo');
    const orig = list.slice();
    L.sortGames(list);
    eqj(list.map((g) => g.id), orig.map((g) => g.id), 'sortGames non modifica l\'elenco');
    // filtro
    const g = [mkG(1, 'Killer Bees', '1981', 'k', 'A', {publisher: 'Philips', country: 'EU'}), mkG(2, 'Pickaxe Pete', '1982', 'p', 'B', {publisher: 'Magnavox', extra: ['rev']}),
      mkG(3, 'Zoom', '1983', 'z', '', {flags: ['a2']})];
    eqj(L.filterGames(g).map((x) => x.id), [1, 2, 3], 'filtro senza opzioni');
    eqj(L.filterGames(g, null).map((x) => x.id), [1, 2, 3], 'filtro con null');
    eqj(L.filterGames(g, {}).map((x) => x.id), [1, 2, 3], 'filtro con {}');
    eqj(L.filterGames(g, {query: ''}).map((x) => x.id), [1, 2, 3], 'ricerca vuota');
    eqj(L.filterGames(g, {query: '   '}).map((x) => x.id), [1, 2, 3], 'ricerca di soli spazi');
    eqj(L.filterGames(g, {query: 'killer'}).map((x) => x.id), [1], 'ricerca titolo');
    eqj(L.filterGames(g, {query: 'KILLER bees'}).map((x) => x.id), [1], 'ricerca due parole, maiuscole');
    eqj(L.filterGames(g, {query: 'bees killer'}).map((x) => x.id), [1], 'ricerca parole in altro ordine');
    eqj(L.filterGames(g, {query: 'killer pickaxe'}).map((x) => x.id), [], 'ricerca: tutte le parole');
    eqj(L.filterGames(g, {query: 'philips'}).map((x) => x.id), [1], 'ricerca editore');
    eqj(L.filterGames(g, {query: 'eu'}).map((x) => x.id), [1], 'ricerca paese');
    eqj(L.filterGames(g, {query: '1982'}).map((x) => x.id), [2], 'ricerca anno');
    eqj(L.filterGames(g, {query: 'rev'}).map((x) => x.id), [2], 'ricerca extra');
    eqj(L.filterGames(g, {query: 'a2'}).map((x) => x.id), [3], 'ricerca flag');
    eqj(L.filterGames(g, {query: 'pete', folder: 'B'}).map((x) => x.id), [2], 'testo + cartella');
    eqj(L.filterGames(g, {query: 'pete', folder: 'A'}).map((x) => x.id), [], 'testo + altra cartella');
    eqj(L.filterGames(g, {folder: 'A'}).map((x) => x.id), [1], 'cartella A');
    eqj(L.filterGames(g, {folder: ''}).map((x) => x.id), [3], 'cartella vuota = file singoli');
    eqj(L.filterGames(g, {folder: null}).map((x) => x.id), [1, 2, 3], 'cartella null = tutte');
    eqj(L.filterGames(g, {folder: undefined}).map((x) => x.id), [1, 2, 3], 'cartella undefined = tutte');
    eqj(L.filterGames(g, {folder: 'Z'}).map((x) => x.id), [], 'cartella inesistente');
    eqj(L.filterGames(g, {query: 'KILLER'}).length, 1, 'maiuscole');
    // cartelle
    const fl = L.folderList([mkG(1, 'a', '', 'a', ''), mkG(2, 'b', '', 'b', 'Zeta'), mkG(3, 'c', '', 'c', 'Alfa'), mkG(4, 'd', '', 'd', 'Zeta'), mkG(5, 'e', '', 'e', ''),
      mkG(6, 'f', '', 'f', 'Mid'), mkG(7, 'g', '', 'g', 'Alfa'), mkG(8, 'h', '', 'h', 'Zeta')]);
    eqj(fl, [{folder: 'Alfa', count: 2}, {folder: 'Mid', count: 1}, {folder: 'Zeta', count: 3}, {folder: '', count: 2}], 'elenco cartelle: ordine alfabetico, vuota per ultima');
    eqj(L.folderList([mkG(1, 'a', '', 'a', 'B'), mkG(2, 'a', '', 'a', 'A')]).map((x) => x.folder), ['A', 'B'], 'due cartelle');
    eqj(L.folderList([mkG(1, 'a', '', 'a', 'A'), mkG(2, 'a', '', 'a', 'B')]).map((x) => x.folder), ['A', 'B'], 'due cartelle (altro ordine)');
    eqj(L.folderList([mkG(1, 'a', '', 'a', ''), mkG(2, 'a', '', 'a', 'A')]).map((x) => x.folder), ['A', ''], 'vuota dopo');
    eqj(L.folderList([mkG(1, 'a', '', 'a', 'A'), mkG(2, 'a', '', 'a', '')]).map((x) => x.folder), ['A', ''], 'vuota dopo (altro ordine)');
    eqj(L.folderList([]), [], 'nessuna cartella');
  }

  // ---- set di caratteri nei file e negli zip: non entra in giochi / BIOS, finisce in rep.charsets (un elemento per file trovato)
  {
    const {sha256} = require(SP('sha256.js'));
    const lib = new L.Library();
    const cs = bytes(512);
    let r = await lib.addFile('cs.bin', cs);
    eqj([r.games, r.bios, r.dups, r.skipped.length, r.charsets.length], [0, 0, 0, 0, 1], 'file da 512 byte: set di caratteri');
    ok(r.charsets[0].name === 'cs.bin' && r.charsets[0].data.length === 512 && r.charsets[0].sha === sha256(cs), 'set di caratteri: nome, dati, impronta');
    eqj([lib.games.length, lib.bios.length], [0, 0], 'il set di caratteri non entra nell\'elenco');
    r = await lib.addFile('z.zip', zipStore([{name: 'sub/charset.bin', data: cs}, {name: 'game.bin', data: bytes(2048)}, {name: 'leggimi.txt', data: bytes(512)}]));
    eqj([r.games, r.charsets.map((c) => c.name), r.skipped.length], [1, ['charset.bin'], 1], 'zip con set di caratteri, gioco e un .txt da 512 byte');
    r = await lib.addFile('c2.bin', cs);
    eqj(r.charsets.length, 1, 'stesso contenuto: ogni file trovato e\' nel rapporto (il filtro per impronta lo fa app.js)');
    r = await new L.Library().addFile('n.bin', bytes(2048));
    eqj(r.charsets, [], 'senza set di caratteri: elenco vuoto');
  }
};
