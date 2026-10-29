'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// test_vplist.js [VETTORI.json] - src/vplist.js: dati della lista delle cartucce e abbinamento di una ROM a una voce.
// Scritto PRIMA del modulo. Le attese sono scritte a mano guardando la lista di Maurice Simon (non calcolate dal codice) e la lista software di MAME
// (nome delle ROM: vp_43.bin = Videopac 43, vp_43pl.bin = la versione Plus, o2_47.bin = Magnavox AC9447 ...). Con un file di vettori (test/vplist_vectors.py)
// confronta il modulo con il riferimento Python indipendente hw/vplist_ref.py.
const fs = require('fs');
const path = require('path');
const SP = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const V = require(SP('vplist.js'));
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; if (bad < 30) console.log('FALLITO: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b));
const has = (res, ct) => !!res && res.rows.some((r) => r.ct === ct);

// ---- i dati
ok(V.ROWS.length === 479, 'voci: ' + V.ROWS.length);
ok(new Set(V.ROWS.map((r) => r.id)).size === V.ROWS.length, 'id unici');
ok(V.ROWS.every((r, i) => r.id === i), 'id = posizione');
ok(V.ROWS.every((r) => typeof r.ti === 'string' && r.ti && typeof r.mk === 'string' && r.mk), 'campi obbligatori');
ok(/Maurice Simon/.test(V.CREDIT) && /renelips|videopac\.info/i.test(V.CREDIT), 'credito all\'autore della lista');
ok(V.byNumber(43).length >= 6, 'numero 43: ' + V.byNumber(43).length + ' voci');
ok(V.byNumber(43).every((r) => r.vp === 43), 'byNumber ha solo il 43');
ok(V.byNumber(0).length === 0 || V.byNumber(0).every((r) => r.vp === 0), 'numero 0');

// ---- sigle di MAME / delle raccolte: vp_NN, vp_NNpl
let m = V.matchGame({sigla: 'vp_43'});
ok(m && m.how === 'sigla' && m.number === 43 && m.plus === false && !m.plusOnly, 'vp_43: ' + JSON.stringify(m && [m.how, m.number, m.plus]));
ok(has(m, 'G7143') && has(m, 'AC9437') && has(m, '06AV9437'), 'vp_43: Philips G7143, Magnavox AC9437, Brasile 06AV9437');
ok(m && m.rows.every((r) => r.vp === 43 && !r.pl), 'vp_43: solo voci del 43 senza Plus');
ok(m && m.family.some((r) => r.ct === '27143'), 'vp_43: la famiglia comprende la versione Plus');
eq(m && m.title, 'Pick Axe Pete', 'vp_43: titolo');
m = V.matchGame({sigla: 'vp_43pl'});
ok(m && m.number === 43 && m.plus === true && has(m, '27143') && !has(m, 'G7143') && !m.plusOnly, 'vp_43pl');
m = V.matchGame({sigla: 'vp_56pl'});
ok(m && m.number === 56 && m.plus && m.plusOnly && has(m, '27156'), 'vp_56pl: Norseman, solo Plus');
eq(m && m.title, 'Norseman', 'Norseman: titolo senza il +');
m = V.matchGame({sigla: 'vp_59pl'});
ok(m && m.number === 59 && m.plusOnly && /Helicopter Rescue/.test(m.title), 'vp_59pl: Helicopter Rescue+ solo Plus');
m = V.matchGame({sigla: 'vp_60pl'});
ok(m && m.plusOnly && /Rally/.test(m.title), 'vp_60pl: Trans-American Rally+');
m = V.matchGame({sigla: 'vp_05'});
ok(m && m.number === 5 && !m.plusOnly && m.rows.some((r) => r.no === 1), 'vp_05: Blackjack, «solo originale» (-)');
m = V.matchGame({sigla: 'vp_43_f'});
ok(m && m.number === 43 && ['FR'].includes(m.rows[0].rg), 'vp_43_f: prima le voci francesi (' + (m && m.rows[0].rg) + ')');
m = V.matchGame({sigla: 'vp_01'});
ok(m && m.number === 1 && has(m, 'G7101') && has(m, 'AJ9400') && has(m, '06AV9400'), 'vp_01: Race / Spinout / Cryptogram, Speedway!, Formula 1');
m = V.matchGame({sigla: 'vp_09'});
ok(m && m.number === 9 && m.rows.filter((r) => r.ct === 'G7109' && r.mk === 'Philips').length === 8, 'vp_09: otto lingue di Computer Programmer');

// ---- o2_NN = Magnavox 94NN; br_NN = numero Videopac del Brasile; o3_NN = versione Plus di o2
m = V.matchGame({sigla: 'o2_47'});
ok(m && m.how === 'catalogo' && m.number === 52 && has(m, 'AC9447') && /Killer Bees/.test(m.title), 'o2_47: AC9447 = Killer Bees (52)');
m = V.matchGame({sigla: 'o2_37'});
ok(m && m.number === 43 && has(m, 'AC9437'), 'o2_37: AC9437 = Pick Axe Pete (43)');
m = V.matchGame({sigla: 'o2_00'});
ok(m && m.number === 1 && has(m, 'AJ9400'), 'o2_00: AJ9400 = Speedway! (1)');
m = V.matchGame({sigla: 'o2_99'});
eq(m, null, 'o2_99: non esiste');
m = V.matchGame({sigla: 'o3_47'});
ok(m && m.number === 52 && m.plus === true, 'o3_47: Killer Bees+ (la versione Plus di AC9447)');
m = V.matchGame({sigla: 'br_58'});
ok(m && m.how === 'sigla' && m.number === 58 && has(m, '06AV9477') && m.family.some((r) => r.ct === '27158'), 'br_58: Barao Vermelho, famiglia con Air Battle+');
// ---- lettere e Germania
m = V.matchGame({sigla: 'vp_a'});
ok(m && m.letter === 'A' && m.number === 0 && /Newscaster/.test(m.title) && has(m, 'G7199'), 'vp_a: Newscaster');
m = V.matchGame({sigla: 'vp_v'});
ok(m && m.letter === 'V' && /Verkehr/.test(m.title), 'vp_v: Kinder im Verkehr');
m = V.matchGame({sigla: 'csv_1'});
ok(m && m.rows.some((r) => /Verkehrsspiele 1/.test(r.ti)), 'csv_1');
m = V.matchGame({sigla: 'vp_c7010'});
ok(m && m.rows.every((r) => r.ti === 'Chess' || /C7010/.test(r.ti)), 'vp_c7010: Chess');

// ---- per titolo (nomi TOSEC, MAME, elenchi dell'utente)
m = V.matchGame({titles: ['Pick Axe Pete']});
ok(m && m.how === 'titolo' && m.number === 43 && m.plus === false && !m.ambiguous, 'titolo: Pick Axe Pete');
m = V.matchGame({titles: ['Pickaxe Pete (Europe, USA)']});
ok(m && m.number === 43, 'titolo: senza spazio e con la regione tra parentesi');
m = V.matchGame({titles: ['Peter Tête de Pioche']});
ok(m && m.number === 43 && m.rows[0].rg === 'FR', 'titolo: francese con accento');
m = V.matchGame({titles: ['Peter Tete de Pioche']});
ok(m && m.number === 43, 'titolo: francese senza accento');
m = V.matchGame({titles: ['Killer Bees!']});
ok(m && m.number === 52 && m.plus === false, 'titolo: Killer Bees (originale)');
m = V.matchGame({titles: ['Killer Bees!'], plusHint: true});
ok(m && m.number === 52 && m.plus === true, 'titolo: Killer Bees con indizio Plus');
m = V.matchGame({titles: ['Pick Axe Pete+']});
ok(m && m.number === 43 && m.plus === true, 'titolo: il «+» finale indica il Plus');
m = V.matchGame({titles: ['Air Battle']});
ok(m && m.number === 58 && m.plus === true && m.plusOnly === false, 'titolo: Air Battle esiste solo come 58+ nella lista europea');
m = V.matchGame({titles: ['Race + Spin-out + Cryptogram']});
ok(m && m.number === 1, 'titolo: separatori diversi (+, trattino) uguali a «Race / Spinout / Cryptogram"');
m = V.matchGame({titles: ['Course de Voitures + Autodrome + Cryptogram']});
ok(m && m.number === 1 && m.rows[0].rg === 'FR', 'titolo francese lungo (la lista lo abbrevia con «...»)');
m = V.matchGame({titles: ['Out of This World']});
ok(m && m.number === 2 && has(m, 'AK9419'), 'titolo: un pezzo del titolo doppio');
m = V.matchGame({titles: ['Helicopter Rescue']});
ok(m && m.number === 59 && m.plus === true && m.plusOnly, 'titolo: Helicopter Rescue = 59+ (il titolo intero batte il pezzo di «Out of This World / Helicopter Rescue»)');
m = V.matchGame({titles: ['Demon Attack']});
ok(m && m.number === 0 && has(m, '710075-2A') && has(m, '06AV9481'), 'titolo: Demon Attack (Imagic, senza numero Videopac)');
m = V.matchGame({titles: ['Chess']});
ok(m && m.number === 0 && m.rows.some((r) => /^C7010/.test(r.ct)), 'titolo: Chess');
m = V.matchGame({titles: ['Frogger']});
ok(m && m.number === 0 && has(m, '981502'), 'titolo: Frogger (Parker)');
m = V.matchGame({titles: ['Conquest of the World']});
ok(m && m.number === 41 && has(m, 'G7141') && has(m, 'AB9431'), 'titolo: Conquest of the World (41, anche Magnavox)');
m = V.matchGame({titles: ['Eroberung der Welt']});
ok(m && m.number === 41, 'titolo: tedesco');
m = V.matchGame({titles: ['Programa Completamente Sconosciuto 77']});
eq(m, null, 'titolo sconosciuto');
// piu' titoli (nome del file, MAME, nome alternativo): il primo che combacia con un numero
m = V.matchGame({titles: ['pr_killerbees', 'Qualcosa di nuovo', 'Killer Bees (Prototype)']});
ok(m && m.number === 52, 'piu\' titoli: il terzo combacia');
// ---- priorita' e casi limite
m = V.matchGame({sigla: 'vp_43', titles: ['Killer Bees']});
ok(m && m.how === 'sigla' && m.number === 43, 'la sigla vince sul titolo');
m = V.matchGame({sigla: 'pr_killerbees', titles: ['Killer Bees']});
ok(m && m.how === 'titolo' && m.number === 52, 'sigla non numerata: si passa al titolo');
eq(V.matchGame({}), null, 'niente: null');
eq(V.matchGame({titles: ['']}), null, 'titolo vuoto: null');
eq(V.matchGame({titles: ['a']}), null, 'titolo di una lettera: null (troppo corto per essere sicuro)');
eq(V.matchGame({titles: ['Golf']}) && V.matchGame({titles: ['Golf']}).number, 10, 'titolo corto ma intero: Golf = 10');
// ---- normalizzazione
eq(V.normTitle('  Pick-Axe  PETE! (Europe, USA) '), 'pickaxepete', 'normTitle');
eq(V.normTitle('Peter Tête de Pioche+'), 'petertetedepioche', 'normTitle: accento e +');
eq(V.normTitle('Spelet om V�rldsmakten'), 'speletomvrldsmakten', 'normTitle: carattere perso nel file originale');
eq(V.isPlusTitle('Pick Axe Pete+'), true, 'isPlusTitle +');
eq(V.isPlusTitle('Pick Axe Pete'), false, 'isPlusTitle no');
eq(V.isPlusTitle('Pickaxe Pete (Europe, plus)'), true, 'isPlusTitle (plus)');
// ---- testo breve da mostrare
m = V.matchGame({sigla: 'vp_43'});
const d = V.describeMatch(m);
ok(/43/.test(d.line) && /Pick Axe Pete/.test(d.line), 'riga: ' + d.line);
ok(d.catalogs.includes('G7143') && d.catalogs.includes('AC9437'), 'cataloghi');
ok(typeof d.rarity === 'string' && d.rarity.length > 0, 'rarita\'');
m = V.matchGame({sigla: 'vp_56pl'});
ok(/Plus/.test(V.describeMatch(m).flags.join(' ')), 'segnalazione «solo Videopac+»');
// ---- funzioni piccole, valori attesi scritti a mano
eq(V.normTitle('Tête-à-Tête (FR) [x]'), 'teteatete', 'normTitle: accenti, trattini, parentesi tonde e quadre');
eq(V.normTitle('Ça roule! 2'), 'caroule2', 'normTitle: cedilla, cifre');
eq(V.normTitle('ÀÉÎÕÜ Ñandú'), 'aeiounandu', 'normTitle: maiuscole accentate');
eq(V.normTitle('A\u0300\u0301 b'), 'ab', 'normTitle: segni combinanti');
eq(V.normTitle('Dr. Who (a) b (c)'), 'drwhob', 'normTitle: piu\' parentesi');
eq(V.normTitle(null), '', 'normTitle: vuoto');
eq(V.parseSigla('vp_43'), {kind: 'num', n: 43, plus: false, french: false, br: false}, 'parseSigla vp_43');
eq(V.parseSigla('VP_43PL'), {kind: 'num', n: 43, plus: true, french: false, br: false}, 'parseSigla VP_43PL');
eq(V.parseSigla('vp_43+'), {kind: 'num', n: 43, plus: true, french: false, br: false}, 'parseSigla vp_43+');
eq(V.parseSigla('vp_43_f'), {kind: 'num', n: 43, plus: false, french: true, br: false}, 'parseSigla vp_43_f');
eq(V.parseSigla('vp_43f'), {kind: 'num', n: 43, plus: false, french: true, br: false}, 'parseSigla vp_43f');
eq(V.parseSigla('vp_43fix'), {kind: 'num', n: 43, plus: false, french: false, br: false}, 'parseSigla vp_43fix (f non e\' francese)');
eq(V.parseSigla('br_12'), {kind: 'num', n: 12, plus: false, french: false, br: true}, 'parseSigla br_12');
eq(V.parseSigla('ntsc_12'), {kind: 'num', n: 12, plus: false, french: false, br: false}, 'parseSigla ntsc_12');
eq(V.parseSigla('o2_47'), {kind: 'cat', k: '47', plus: false}, 'parseSigla o2_47');
eq(V.parseSigla('o3_47'), {kind: 'cat', k: '47', plus: true}, 'parseSigla o3_47');
eq(V.parseSigla('o2_47pl'), {kind: 'cat', k: '47', plus: true}, 'parseSigla o2_47pl');
eq(V.parseSigla('vp_a'), {kind: 'let', l: 'A'}, 'parseSigla vp_a');
eq(V.parseSigla('vp_v'), {kind: 'let', l: 'V'}, 'parseSigla vp_v');
eq(V.parseSigla('pippo') === undefined || V.parseSigla('pippo') === null, true, 'parseSigla pippo');
// ---- titolo scelto e ordine delle voci (attese scritte guardando la lista)
m = V.matchGame({sigla: 'o2_47'});
eq([m.title, m.number, m.rows.map((r) => r.rg + ':' + r.ct)], ['Killer Bees', 52, ['US:AC9447', 'BR:06AV9447']], 'o2_47 = Magnavox AC9447 Killer Bees! (Videopac 52): il «!» si toglie dal titolo, prima gli USA');
m = V.matchGame({sigla: 'vp_52pl'});
eq([m.title, m.plus, m.rows.map((r) => r.rg)], ['Killer Bees', true, ['EU', 'UK', 'FR']], 'vp_52pl: titolo senza «+», solo le voci Plus nell\'ordine delle regioni');
m = V.matchGame({sigla: 'vp_47'});
eq([m.title, m.rows[0].ct, m.family.length >= m.rows.length], ['The Mousing Cat', 'G7147', true], 'vp_47 = The Mousing Cat (G7147)');
m = V.matchGame({sigla: 'vp_43_f'});
eq([m.rows[0].rg, m.title], ['FR', 'Pick Axe Pete'], 'vp_43_f: la versione francese viene per prima');
eq(V.matchGame({sigla: 'vp_43'}).rows.map((r) => r.rg + ':' + r.ct), ['EU:G7143', 'US:AC9437', 'FR:G7143', 'FR:G7143', 'BE:G7143', 'BR:06AV9437'], 'vp_43: ordine delle regioni EU, USA, FR, BE, BR (senza preferenza)');
// nessun abbinamento da cose che non sono sigle ne' titoli
eq(V.matchGame({}), null, 'senza ingressi: nessun abbinamento');
eq(V.matchGame({sigla: 'zzz_99', titles: ['x']}), null, 'sigla e titoli sconosciuti');
// ---- titoli da mostrare: note tra parentesi tolte, «AKA» come titolo a parte, carattere perso della lista come «?»
{
  const dd = V.describeMatch(V.matchGame({titles: ['Demon Attack']}));
  ok(dd.line === 'Demon Attack' && dd.titles.every((t) => !/[()]/.test(t)), 'Demon Attack: niente note tra parentesi (' + JSON.stringify(dd.titles) + ')');
  const rc = V.describeMatch(V.matchGame({titles: ['Robot City']}));
  eq([rc.line, rc.titles], ['Robot City', ['Laser']], 'Robot City (AKA Laser): l\'altro nome diventa un titolo a parte');
  const tr = V.describeMatch(V.matchGame({titles: ['Le Tr\u00e9sor Englouti']}));
  eq([tr.line, /\ufffd/.test(tr.line)], ['Le Tr?sor Englouti', false], 'carattere perso nel titolo mostrato: «?»');
  let anyFffd = false;
  const seenKeys = new Set();
  for (const r of V.ROWS) {
    const mm = V.matchGame({titles: [r.ti]});
    if (!mm || seenKeys.has(mm.key)) continue;
    seenKeys.add(mm.key);
    const d2 = V.describeMatch(mm);
    if (/\ufffd/.test(d2.line) || d2.titles.some((t) => /\ufffd|[()]/.test(t))) anyFffd = true;
  }
  ok(!anyFffd, 'in nessun gruppo del catalogo compare U+FFFD o una parentesi nei titoli mostrati');
}
// ---- vettori contro il riferimento Python
const file = process.argv[2];
if (file) {
  const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
  let diff = 0;
  for (const c of cases) {
    const got = V.matchGame(c.input);
    const ids = (r) => (r ? r.rows.map((x) => x.id) : null);
    const same = JSON.stringify([got && got.how, got && got.number, got && got.letter, got && got.plus, got && got.plusOnly, got && got.ambiguous, ids(got), got && got.family.map((x) => x.id), got && ((d) => [got.title, d.line, d.number, d.catalogs, d.flags, d.titles, d.rarity, d.makers])(V.describeMatch(got))]) ===
      JSON.stringify(c.expect);
    if (!same) { diff++; if (diff < 8) console.log('DIVERSO da hw/vplist_ref.py: ' + JSON.stringify(c.input) + '\n  JS ' + JSON.stringify([got && got.how, got && got.number, got && got.plus, ids(got)]) + '\n  PY ' + JSON.stringify([c.expect[0], c.expect[1], c.expect[3], c.expect[6]])); }
  }
  ok(diff === 0, 'vettori: ' + diff + ' diversi su ' + cases.length);
  console.log('vettori: ' + cases.length + ' casi');
}
console.log(bad ? 'FALLITI ' + bad + ' su ' + n : 'OK (' + n + ' controlli)');
process.exit(bad ? 1 : 0);
