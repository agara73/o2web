'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_gamenames.js [DUMPS] - nomi dei giochi (src/gamenames.js): sigle numerate nei nomi dei file, elenchi di nomi (Gamelist777.txt e simili), tabella
// incorporata (src/gamedb_data.js, da MAME CC0) e scelta del nome. Con la cartella dei dump (in locale) controlla anche che la tabella dica il vero:
// le impronte SHA-1 dei dump TOSEC dell'utente devono ritrovare titoli compatibili (il fatto «da verificare» della tabella).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const path = require('path');
const G = require(SP('gamenames.js'));
const {ROMS} = require(SP('gamedb_data.js'));
const {Library, makeGame} = require(SP('library.js'));
const {sha1} = require(SP('sha1.js'));
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 25) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));
const enc = (s) => new TextEncoder().encode(s);

// ---- sigle nei nomi dei file
const S = (f) => { const r = G.siglaFromFileName(f); return r ? r.sigla : null; };
for (const [f, want] of [
  ['vp_13.bin', 'vp_13'], ['VP_13.BIN', 'vp_13'], ['vp13.bin', 'vp_13'], ['Vp01_F.bin', 'vp_01_f'], ['Vp11+_F.bin', 'vp_11pl_f'], ['vp01+_F.bin', 'vp_01pl_f'],
  ['vp_01hack.bin', 'vp_01hack'], ['vp_11alt', 'vp_11alt'], ['vp_33_alt.bin', 'vp_33_alt'], ['vp_55_12.bin', 'vp_55_12'], ['vp_55_12fix.bin', 'vp_55_12fix'], ['vp_59_16.bin', 'vp_59_16'],
  ['vp_a.bin', 'vp_a'], ['vp_v.bin', 'vp_v'], ['vp_C7010.bin', 'vp_c7010'], ['vp_c7420.bin', 'vp_c7420'], ['o2_45.bin', 'o2_45'], ['o2_48alt.bin', 'o2_48alt'], ['o2_48_alt.bin', 'o2_48_alt'],
  ['o3_45.bin', 'o3_45'], ['br_58.bin', 'br_58'], ['Air battle (br_58).bin', 'br_58'], ['ntsc_57.bin', 'ntsc_57'], ['mod_35pl_fix.bin', 'mod_35pl_fix'], ['mod_05_g7400.bin', 'mod_05_g7400'],
  ['csv1.bin', 'csv1'], ['csv2.bin', 'csv2'], ['dir/sub\\vp_20pl.bin', 'vp_20pl'], ['vp_13.rom', 'vp_13'], ['vp_13', 'vp_13'],
  // non sono sigle numerate
  ['jo_syracuse.bin', null], ['pr_red-baron.bin', null], ['new_amok.bin', null], ['im_atlantis.bin', null], ['vp_killer_bees.bin', null], ['o2_4_in_1_row_1982_philips_eu.bin', null],
  ['Killer Bees (198x)(Philips)(EU).bin', null], ['mod_vp31_examples.bin', null], ['mod_br21_fix.bin', null], ['vp_1.bin', null], ['vp_123.bin', null], ['vp_13x.bin', null],
  ['my vp_13.bin', null], ['vp_13 copy.bin', null], ['xvp_13.bin', null], ['vp_', null], ['', null], ['.bin', null], ['o2_', null], ['csv12.bin', null], ['vp_c70.bin', null], ['(vp_13).bin', 'vp_13'],
  ['Foo (1980)(vp_13)(EU).bin', 'vp_13'], ['Foo (a b)(vp_13).bin', 'vp_13'],
]) eq(S(f), want, 'sigla in «' + f + '»');
eq(G.siglaFromFileName('Vp11+_F.bin').key, 'vp11plf', 'chiave di confronto');
eq([G.sigKey('vp_11pl_f'), G.sigKey('Vp11+_F'), G.sigKey('VP-11 PL F')], ['vp11plf', 'vp11plf', 'vp11plf'], 'sigKey uguale per le scritture diverse');
ok(G.isNumbered('vp_13') && G.isNumbered('Vp01_F') && G.isNumbered('csv1') && !G.isNumbered('jo_syracuse') && !G.isNumbered('') && !G.isNumbered('pr_airbattle'), 'isNumbered');
eq([G.stemOf('a/b/vp_13.bin'), G.stemOf('X (1).BIN'), G.stemOf('noext'), G.stemOf('a.txt')], ['vp_13', 'X (1)', 'noext', 'a.txt'], 'stemOf');

// ---- elenco di nomi
{
  const text = ['bios = internal ROM', 'vp   = Videopac', '', 'bios_c52.bin                 french version of G7000\r',
    'vp_01.bin        Race/Spin-out/Cryptogram', 'vp_01hack.bin    Race/Spin-out/Cryptogram  (color hack)', 'vp_13.bin\tPlayschool Maths', 'Vp11+_F.bin   Cosmos +',
    'br_clay-pigeon.bin', 'pr_pinball.bin\t\t\twritten by Ralph Bear', 'solo testo senza file', 'x.bin senza due spazi? no: uno spazio basta', 'new.bin  \u0001ctrl\u0002  ok  '].join('\n');
  const m = G.parseNameList(text);
  eq(m.get('vp_01'), 'Race/Spin-out/Cryptogram', 'elenco: voce semplice');
  eq(m.get('vp_01hack'), 'Race/Spin-out/Cryptogram (color hack)', 'elenco: spazi interni ridotti');
  eq(m.get('vp_13'), 'Playschool Maths', 'elenco: tabulazione');
  eq(m.get('vp11+_f'), 'Cosmos +', 'elenco: chiave in minuscole, senza estensione');
  eq(m.get('pr_pinball'), 'written by Ralph Bear', 'elenco: piu\' tabulazioni');
  ok(!m.has('br_clay-pigeon'), 'elenco: riga senza descrizione ignorata');
  ok(!m.has('bios'), 'elenco: la legenda non e\' una voce');
  eq(m.get('new'), 'ctrl ok', 'elenco: caratteri di controllo tolti');
  ok(m.get('bios_c52') === 'french version of G7000', 'elenco: CRLF');
  ok(G.looksLikeNameList(text) && !G.looksLikeNameList('a.bin  x\nb.bin  y') && !G.looksLikeNameList('') && !G.looksLikeNameList('niente di tutto questo'), 'looksLikeNameList (almeno ' + G.MIN_LIST + ' voci)');
  ok(G.parseNameList('x.bin  ' + 'a'.repeat(500) + '\ny.bin  ok').size === 1, 'elenco: righe troppo lunghe ignorate');
  ok(G.parseNameList(new Array(20001).fill('a.bin  b').join('\n')).size === 0, 'elenco: oltre 20000 righe rifiutato');
  // decodifica: UTF-8 valido, Latin-1 (byte isolati > 127), mai sostituzioni
  eq(G.decodeText(enc('caffè ÷')), 'caffè ÷', 'decodeText UTF-8');
  eq(G.decodeText(Uint8Array.from([0x61, 0xf7, 0xe9, 0x62])), 'a÷éb', 'decodeText Latin-1');
  ok(!G.decodeText(Uint8Array.from([0xe9, 0xf7])).includes('�'), 'decodeText: nessun carattere di sostituzione');
  eq(G.decodeText(new Uint8Array(0)), '', 'decodeText vuoto');
  const big = new Uint8Array(20000).fill(0x41);
  eq(G.decodeText(big).length, 20000, 'decodeText lungo');
}

// ---- tabella incorporata
{
  const seen = new Set(), codes = new Set();
  let good = true;
  for (const r of ROMS) {
    if (!(r.length === 4 && /^[0-9a-f]{40}$/.test(r[1]) && r[0] && r[2] && typeof r[3] === 'string')) good = false;
    if (seen.has(r[1])) good = false;
    seen.add(r[1]);
    codes.add(r[0]);
  }
  ok(good, 'tabella: 4 campi, SHA-1 di 40 cifre, nessuna impronta doppia');
  ok(ROMS.length > 150 && codes.size === ROMS.length, 'tabella: ' + ROMS.length + ' voci, sigle tutte diverse');
  ok(!ROMS.some((r) => /^z80_|^sp0256|^spr128/.test(r[0])), 'tabella: nessuna ROM di supporto (Z80, voce)');
  const v = G.lookupSha1('498cb0882d8a692042889e83775a83cf267a1837');
  ok(v && v.sigla === 'vp_13' && /Playschool/.test(v.name) && /Got Your Number/.test(v.alt), 'tabella: vp_13');
  ok(G.lookupSha1('498CB0882D8A692042889E83775A83CF267A1837') === v, 'tabella: maiuscole');
  ok(G.lookupSha1('0'.repeat(40)) === null, 'tabella: impronta ignota');
  ok(G.lookupSigla('VP_13') === v && G.lookupSigla('vp13') === v && G.lookupSigla('vp_99') === null, 'tabella: per sigla');
  ok(G.lookupSigla('vp_01pl_f') && G.lookupSigla('Vp01+_F') === G.lookupSigla('vp_01pl_f'), 'tabella: sigla con «+»');
  // ogni sigla numerata della tabella si riconosce anche nel nome di file corrispondente
  let miss = 0;
  for (const r of ROMS) if (G.isNumbered(r[0]) && !G.siglaFromFileName(r[0] + '.bin')) miss++;
  eq(miss, 0, 'tabella: le sigle numerate si riconoscono come nomi di file');
}

// ---- scelta del nome (record sintetici: nessun dump)
const mk = (name, folder, bytes) => makeGame(name, folder || '', 'file', bytes || new Uint8Array(1024).fill(7), undefined);
{
  const names = G.parseNameList('vp_13.bin   Playschool Maths\nmod_14fix.bin   Voice won\'t hum anymore\nvp_01.bin  Race/Spin-out/Cryptogram\npr_pinball.bin    written by Ralph Bear\nbr_16.bin   Depth Charge/Marksman\nVp11+_F.bin  Cosmos +');
  let d = G.describeGame(mk('vp_13.bin'), names);
  eq([d.sigla, d.title, d.rank], ['vp_13', 'Playschool Maths', 0], 'nome da elenco per sigla titolata');
  d = G.describeGame(mk('vp_77.bin'), null);
  eq([d.sigla, d.rank, d.title], ['vp_77', 3, 'vp_77'], 'senza elenco ne\' tabella ne\' impronta: sigla e nome del file');
  d = G.describeGame(mk('mod_14fix.bin'), names);
  eq([d.sigla, d.rank, d.notes], ['mod_14fix', 3, ["Voice won't hum anymore"]], 'mod_: la descrizione e\' una nota, non il titolo');
  d = G.describeGame(mk('pr_pinball.bin'), names);
  eq([d.sigla, d.notes], ['', ['written by Ralph Bear']], 'pr_: nota, nessuna sigla numerata');
  d = G.describeGame(mk('Vp11+_F.bin'), names);
  eq([d.sigla, d.title], ['vp_11pl_f', 'Cosmos +'], 'chiave dell\'elenco scritta in modo diverso dal file');
  d = G.describeGame(mk('Killer Bees (198x)(Philips)(EU).bin'), names);
  eq([d.sigla, d.rank, d.title], ['', 2, 'Killer Bees'], 'nome TOSEC: rango 2');
  d = G.describeGame(mk('boh.bin'), names);
  eq([d.sigla, d.rank, d.title], ['', 3, 'boh'], 'nome qualunque: rango 3');
  // la descrizione della tabella per sigla (senza impronta) e il titolo alternativo
  d = G.describeGame(mk('vp_40.bin'), null);
  ok(d.sigla === 'vp_40' && d.rank === 1 && /4 in 1 Row/.test(d.title), 'tabella per sigla del file: ' + d.title);
  d = G.describeGame(mk('vp_13.bin'), new Map());
  ok(d.rank === 1 && /Playschool Maths/.test(d.title) && d.altNames.some((a) => /Got Your Number/.test(a)), 'tabella: titolo alternativo tra gli altri nomi');
  // elenco e tabella insieme: vale l'elenco, la tabella va tra gli altri nomi
  d = G.describeGame(mk('vp_13.bin'), names);
  ok(d.rank === 0 && d.title === 'Playschool Maths' && d.altNames.some((a) => /Playschool Maths \(Europe, USA\)/.test(a)), 'elenco prima della tabella: ' + JSON.stringify(d.altNames));
  // un record senza dati (sessione parziale) non rompe
  d = G.describeGame({name: 'vp_13.bin', display: 'vp_13', title: 'vp_13', year: '', publisher: '', country: ''}, null);
  ok(d.sigla === 'vp_13', 'record senza dati');
}

// ---- prove di confine (nate dalla prova di mutazione)
{
  // estensioni riconosciute e non (il nome senza estensione non cambia)
  for (const e of ['bin', 'rom', 'o2', 'vp', 'BIN', 'Rom']) eq(G.stemOf('a/b\\game.' + e), 'game', 'stemOf .' + e);
  eq(G.stemOf('/game.bin'), 'game', 'stemOf: barra iniziale');
  eq(G.stemOf('\\game.bin'), 'game', 'stemOf: barra rovesciata iniziale');
  eq(G.stemOf('game.txt'), 'game.txt', 'stemOf: altra estensione resta');
  eq(G.stemOf('game.bin.bak'), 'game.bin.bak', 'stemOf: estensione solo in fondo');
  eq(G.stemOf('  game .bin '), 'game .bin', 'stemOf: spazi finali tolti dopo (l\'estensione deve stare in fondo)');
  // prefissi con descrizione-titolo e non
  for (const x of ['vp_01', 'o2_05', 'br_07', 'csv1']) ok(G.TITLE_PREFIXES.test(x), 'titolo per ' + x);
  for (const x of ['mod_05', 'ntsc_57', 'pr_x', 'new_x', 'o3_45']) ok(!G.TITLE_PREFIXES.test(x), 'nota (non titolo) per ' + x);
  // forme canoniche di ogni famiglia
  for (const [a, b] of [['VP01', 'vp_01'], ['br58', 'br_58'], ['NTSC57', 'ntsc_57'], ['mod35', 'mod_35'], ['o245', 'o2_45'], ['O345', 'o3_45'], ['vp11+_f', 'vp_11pl_f'], ['o2_45', 'o2_45'], ['csv1', 'csv1'], ['o2_48alt', 'o2_48alt'], ['o399', 'o3_99'], ['o2', 'o2']]) eq(G.canonSigla(a), b, 'canonSigla ' + a);
  // le sigle con un solo numero di cifre sbagliato non sono sigle
  for (const x of ['o2_5', 'vp_1', 'vp_123', 'o4_45', 'csv', 'csv12', 'vp_ab', 'xx_45']) ok(!G.isNumbered(x), 'non numerata: ' + x);
  for (const x of ['o2_45', 'o3_45', 'vp_a', 'vp_v', 'vp_c7010', 'csv1', 'mod_05', 'ntsc_57', 'br_58']) ok(G.isNumbered(x), 'numerata: ' + x);
  // elenchi di nomi: estensioni, lunghezze, minimo
  const L = (t) => G.parseNameList(t);
  for (const e of ['bin', 'rom', 'o2', 'vp', 'BIN']) eq([...L('xx.' + e + '   Nome').entries()], [['xx', 'Nome']], 'riga con .' + e);
  eq(L('xx.txt   Nome').size, 0, 'riga con altra estensione: scartata');
  eq(L('xx.bin').size, 0, 'riga senza descrizione: scartata');
  eq(L('xx.bin   ').size, 0, 'riga con descrizione vuota: scartata');
  eq(L('.bin   Nome').size, 0, 'riga senza nome: scartata');
  eq(L('xx.bin Nome').size, 1, 'un solo spazio basta');
  eq(L('xx.bin\tNome').size, 1, 'tabulazione');
  eq(L('xx.bin  Nome   con   spazi \u0001 e controllo').get('xx'), 'Nome con spazi e controllo', 'spazi e caratteri di controllo ripuliti');
  const long400 = 'xx.bin ' + 'a'.repeat(400 - 'xx.bin '.length), long401 = long400 + 'a';
  eq([long400.length, long401.length], [400, 401], 'prova ben posta');
  eq(L(long400).size, 1, 'riga di 400 caratteri: accettata');
  eq(L(long401).size, 0, 'riga di 401 caratteri: scartata');
  const many = (k) => new Array(k).fill('xx.bin Nome').join('\n');
  eq(L(many(20000)).size, 1, '20000 righe: lette');
  eq(L(many(20001)).size, 0, '20001 righe: elenco scartato');
  eq([G.looksLikeNameList(many(1) + '\nb.bin B'), G.looksLikeNameList('a.bin A\nb.bin B\nc.bin C')], [false, true], 'servono almeno ' + G.MIN_LIST + ' voci');
  eq(G.MIN_LIST, 3, 'MIN_LIST');
  // decodifica: UTF-8 valida, altrimenti Latin-1; testi lunghi (a blocchi)
  eq(G.decodeText(enc('Caf\u00e9 \u2014 ok')), 'Caf\u00e9 \u2014 ok', 'UTF-8');
  eq(G.decodeText(Uint8Array.from([0x43, 0x61, 0x66, 0xe9])), 'Caf\u00e9', 'Latin-1 (byte non valido in UTF-8)');
  const big = new Uint8Array(10000).fill(0xe9);
  const dec = G.decodeText(big);
  ok(dec.length === 10000 && dec[0] === '\u00e9' && dec[4095] === '\u00e9' && dec[4096] === '\u00e9' && dec[9999] === '\u00e9', 'Latin-1 lungo: tutti i byte decodificati');
  eq(G.decodeText(new Uint8Array(0)), '', 'testo vuoto');
  // scelta del nome con record senza dati (sessione parziale)
  const rec = (o) => Object.assign({name: 'x.bin', display: '', title: '', year: '', publisher: '', country: ''}, o);
  let d = G.describeGame(rec({display: 'Disp', title: 'Tit'}), null);
  eq([d.title, d.rank], ['Disp', 3], 'titolo: display');
  d = G.describeGame(rec({title: 'Tit'}), null);
  eq(d.title, 'Tit', 'titolo: title se manca display');
  d = G.describeGame(rec({}), null);
  eq(d.title, 'x.bin', 'titolo: nome del file se manca tutto');
  for (const k of ['year', 'publisher', 'country']) eq(G.describeGame(rec({[k]: 'v', display: 'D'}), null).rank, 2, 'rango 2 con solo ' + k);
  eq(G.describeGame(rec({display: 'D'}), null).rank, 3, 'rango 3 senza metadati');
  // descrizione dell'elenco per un file senza sigla: e\' una nota; per chiave diversa dal nome: si trova lo stesso
  const nm = G.parseNameList('foo.bin  Foo desc\nVp11+_F.bin  Cosmos plus\nvp_13.bin Uno');
  d = G.describeGame(rec({name: 'foo.bin', display: 'foo'}), nm);
  eq([d.title, d.notes], ['foo', ['Foo desc']], 'file senza sigla: la descrizione e\' una nota');
  d = G.describeGame(rec({name: 'vp_11pl_f.bin', display: 'vp_11pl_f'}), nm);
  eq([d.sigla, d.title], ['vp_11pl_f', 'Cosmos plus'], 'chiave scritta in modo diverso: trovata');
  d = G.describeGame(rec({name: 'zzz.bin', display: 'zzz'}), nm);
  eq([d.title, d.notes], ['zzz', []], 'nessuna voce nell\'elenco: niente note');
  // due voci dell\'elenco con la stessa chiave: vale la prima
  const dup = new Map([['vp11', 'Prima'], ['vp-11', 'Seconda']]);
  eq(G.describeGame(rec({name: 'vp_11.bin', display: 'v'}), dup).title, 'Prima', 'a parita\' di chiave vale la prima voce dell\'elenco');
  eq(G.describeGame(rec({name: 'vp11.bin', display: 'v'}), dup).title, 'Prima', 'nome esatto');
  eq(G.describeGame(rec({name: 'vp-11.bin', display: 'v'}), dup).title, 'v', 'sigla non riconosciuta (trattino): nessuna chiave');
}

// ---- impronte SHA-1 con i dump veri (solo in locale)
(async () => {
  const dumps = process.argv[2] || process.env.O2_DUMPS;
  if (dumps && fs.existsSync(path.join(dumps, '_tosec_o2'))) {
    const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const lib = new Library();
    for (const root of ['_tosec_o2', '_tosec_vp']) for (const f of walk(path.join(dumps, root))) await lib.addFile(path.basename(f), new Uint8Array(fs.readFileSync(f)));
    let hit = 0, mism = 0, sigDump = 0;
    for (const g of lib.games) {
      const h = G.lookupSha1(G.sha1Of(g));
      if (!h) continue;
      hit++;
      const t = g.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      const dn = (h.name + ' ' + h.alt).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      if (!t.split(' ').filter((w) => w.length > 2).some((w) => dn.includes(w))) mism++;      // titoli in un'altra lingua: ammessi
      const d = G.describeGame(g, null);
      if (d.sigla) sigDump++;
      ok(G.sha1Of(g) === sha1(g.data), 'sha1Of coerente');
    }
    console.log('  dump TOSEC: ' + lib.games.length + ', riconosciuti dall\'impronta ' + hit + ', titoli senza parole in comune (altra lingua) ' + mism + ', con sigla numerata ' + sigDump);
    ok(hit >= lib.games.length * 0.9, 'la tabella riconosce almeno il 90% dei dump TOSEC (' + hit + ' su ' + lib.games.length + ')');
    ok(mism <= hit * 0.15, 'titoli compatibili con la tabella (' + mism + ' differenti su ' + hit + ')');
    ok(sigDump >= hit * 0.7, 'i dump riconosciuti ricevono quasi tutti una sigla numerata (' + sigDump + ' su ' + hit + ')');
    // ---- l'impronta SHA-1 prevale sul nome del file quando dicono giochi diversi (richiesta dell'utente, 18/10/2026)
    const rd = (f) => new Uint8Array(fs.readFileSync(path.join(dumps, f)));
    const kbd = rd('killerbees.bin'), dad = rd('demonattack.bin'), bod = rd('blockout.bin');
    const dm = (name, data, names) => G.describeGame(makeGame(name, '', 'file', data, undefined), names || null);
    let c = dm('vp_47.bin', kbd);                                                  // Killer Bees (vp_52pl) chiamato come il Videopac 47 (The Mousing Cat)
    eq([c.sigla, c.conflict, c.title], ['vp_52pl', {name: 'vp_47', content: 'vp_52pl'}, 'Killer Bees (Europe, plus)'], 'nome vp_47, contenuto Killer Bees: vale l\'impronta');
    eq(c.extraSiglas, [], 'la sigla sbagliata del nome non resta tra quelle di rincalzo');
    c = dm('vp_52.bin', kbd);
    eq([c.sigla, c.conflict], ['vp_52', null], 'vp_52 / vp_52pl: stesso gioco (cambia solo il Plus), nessuna discordanza');
    c = dm('o2_47.bin', kbd);
    eq([c.sigla, c.conflict], ['o2_47', null], 'o2_47 (Magnavox Killer Bees) e vp_52pl: stesso gioco, nessuna discordanza');
    c = dm('vp_47.bin', dad);                                                      // Demon Attack: la sigla dell'impronta non e' numerata
    eq([c.sigla, c.siglaKey, c.conflict, c.title], ['', '', {name: 'vp_47', content: 'im_demon-attack'}, 'Demon Attack (Europe, USA)'], 'contenuto senza numero Videopac: nessuna sigla, discordanza segnalata');
    c = dm('vp_29.bin', bod);
    eq([c.sigla, c.conflict], ['vp_29', null], 'nome giusto: nessuna discordanza');
    c = dm('vp_47.bin', new Uint8Array(1024).fill(7));
    eq([c.sigla, c.conflict], ['vp_47', null], 'impronta sconosciuta: vale il nome');
    c = dm('Killer Bees (198x)(Philips)(EU).bin', kbd);
    eq([c.sigla, c.conflict], ['vp_52pl', null], 'nome TOSEC senza sigla: nessuna discordanza, sigla dall\'impronta (come prima)');
    c = dm('vp_47.bin', kbd, G.parseNameList('vp_47.bin   The Mousing Cat\nvp_01.bin   Race\nvp_02.bin   Pairs\nvp_03.bin   Football\n'));
    ok(c.rank === 1 && /Killer Bees/.test(c.title) && c.notes.length === 0, 'con discordanza il nome dell\'elenco (che parla del file, non del contenuto) non si usa: ' + c.title);
    // ogni dump riconosciuto, rinominato con la propria sigla di tabella, non e' mai in discordanza
    let own = 0, ownBad = 0;
    for (const r of ROMS) {
      if (!G.isNumbered(r[0])) continue;
      const hitDump = lib.games.find((g) => G.sha1Of(g) === r[1]);
      if (!hitDump) continue;
      own++;
      if (dm(r[0] + '.bin', hitDump.data).conflict) ownBad++;
    }
    ok(own >= 20 && ownBad === 0, 'dump rinominati con la propria sigla: ' + own + ' provati, ' + ownBad + ' in discordanza');
  } else console.log('  (prove con i dump TOSEC saltate: serve la cartella dei dump)');
  console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
  process.exit(bad ? 1 : 0);
})();
