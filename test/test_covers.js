'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_covers.js - copertine (src/covers.js): riconoscimento delle immagini dal contenuto, dimensioni dall'intestazione, nomi TOSEC, abbinamento ai giochi,
// zip e zip annidati, doppioni, limiti contro file malevoli. Le immagini sono SINTETICHE (intestazioni minime generate qui): nessuna copertina vera nei test.
const path = require('path');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');
const C = require(path.join(SRC, 'covers.js'));
const {zipStore} = require(path.join(SRC, 'zipstore.js'));
const U = require(path.join(SRC, 'unzip.js'));

let fails = 0, checks = 0, finished = false;
process.on('exit', (c) => { if (!finished && c === 0) { console.log('FALLITO: il test si e\' interrotto senza finire (promessa mai risolta)'); process.exitCode = 1; } });
function ok(c, m) { checks++; if (!c) { fails++; console.log('FAIL ' + m); } }
const eqj = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));

// ---- immagini sintetiche
function png(w, h, pad) {
  const b = new Uint8Array(33 + (pad || 0));
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.set([w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], 16);
  for (let i = 24; i < b.length; i++) b[i] = (i * 7 + w + h) & 255;
  return b;
}
function gif(w, h) { return Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0, 0, 0]); }
function jpeg(w, h, sof) {
  const m = sof === undefined ? 0xC0 : sof;
  return Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xDB, 0, 4, 0, 0, 0xFF, m, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 0xFF, 0xD9]);
}
function webpX(w, h) {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  const x = w - 1, y = h - 1;
  b.set([x & 255, (x >> 8) & 255, (x >> 16) & 255, y & 255, (y >> 8) & 255, (y >> 16) & 255], 24);
  return b;
}
function webpL(w, h) {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4C, 0, 0, 0, 0, 0x2F]);
  const bits = ((w - 1) & 0x3FFF) | (((h - 1) & 0x3FFF) << 14);
  b.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], 21);
  return b;
}
function webpV(w, h) {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0, 0, 0, 0, 0x9D, 0x01, 0x2A]);
  b.set([w & 255, (w >> 8) & 0x3F, h & 255, (h >> 8) & 0x3F], 26);
  return b;
}
const text = (s) => new TextEncoder().encode(s);
const zip = (entries) => zipStore(entries.map(([name, data]) => ({name, data})));
const game = (title, year, country, publisher) => ({title, year, country, publisher, name: title + ' (' + year + ')(' + publisher + ')(' + country + ').bin'});

(async () => {
  // ------------------------------------------------------------ sniffImage / imageInfo
  {
    eqj([C.sniffImage(png(10, 20)), C.sniffImage(gif(3, 4)), C.sniffImage(jpeg(5, 6)), C.sniffImage(webpX(7, 8))], ['image/png', 'image/gif', 'image/jpeg', 'image/webp'], 'tipi dal contenuto');
    eqj([C.sniffImage(new Uint8Array(0)), C.sniffImage(text('GIF')), C.sniffImage(text('GIF89')), C.sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"/>')), C.sniffImage(text('%PDF-1.4 ...')), C.sniffImage(Uint8Array.from([0x89, 0x50, 0x4E, 0x47]))],
      [null, null, null, null, null, null], 'non immagini e intestazioni troppo corte');
    ok(C.sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) === 'image/gif', 'GIF87a');
    ok(C.sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x38, 0x61])) === null, 'GIF88a non esiste');
    ok(C.sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])) === null, 'RIFF WAVE non e\' WebP');
    eqj(C.imageInfo(png(360, 243)), {mime: 'image/png', w: 360, h: 243}, 'PNG 360x243');
    eqj(C.imageInfo(png(1, 1)), {mime: 'image/png', w: 1, h: 1}, 'PNG 1x1');
    eqj(C.imageInfo(gif(300, 200)), {mime: 'image/gif', w: 300, h: 200}, 'GIF');
    eqj(C.imageInfo(jpeg(640, 480)), {mime: 'image/jpeg', w: 640, h: 480}, 'JPEG baseline');
    eqj(C.imageInfo(jpeg(640, 480, 0xC2)), {mime: 'image/jpeg', w: 640, h: 480}, 'JPEG progressivo');
    eqj(C.imageInfo(webpX(1000, 700)), {mime: 'image/webp', w: 1000, h: 700}, 'WebP VP8X');
    eqj(C.imageInfo(webpL(512, 384)), {mime: 'image/webp', w: 512, h: 384}, 'WebP VP8L');
    eqj(C.imageInfo(webpV(320, 240)), {mime: 'image/webp', w: 320, h: 240}, 'WebP VP8');
    ok(C.imageInfo(text('niente')) === null && C.imageInfo(new Uint8Array(0)) === null, 'imageInfo: non immagine -> null');
    const badPng = png(10, 10); badPng[11] = 12;
    ok(C.imageInfo(badPng) === null, 'PNG con IHDR di lunghezza sbagliata');
    const badPng2 = png(10, 10); badPng2[12] = 0x58;
    ok(C.imageInfo(badPng2) === null, 'PNG senza IHDR');
    ok(C.imageInfo(png(10, 10).slice(0, 20)) === null, 'PNG troncato');
    ok(C.imageInfo(gif(3, 4).slice(0, 8)) === null, 'GIF troncato');
    ok(C.imageInfo(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xD9])) === null, 'JPEG senza SOF');
    ok(C.imageInfo(jpeg(10, 10).slice(0, 18)) === null, 'JPEG troncato prima delle dimensioni');
    ok(C.imageInfo(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0])) === null, 'JPEG con segmento di lunghezza 0: nessun ciclo infinito');
    const loop = new Uint8Array(70000); loop[0] = 0xFF; loop[1] = 0xD8; loop[2] = 0xFF;
    for (let i = 3; i < loop.length - 4; i += 4) { loop[i] = 0xFF; loop[i + 1] = 0xE1; loop[i + 2] = 0; loop[i + 3] = 2; }
    const t0 = Date.now();
    ok(C.imageInfo(loop) === null && Date.now() - t0 < 1000, 'JPEG con migliaia di segmenti: si ferma');
    ok(C.imageInfo(webpX(10, 10).slice(0, 20)) === null, 'WebP troncato');
    const unk = webpX(10, 10); unk[15] = 0x5A;
    ok(C.imageInfo(unk) === null, 'WebP con sotto-formato sconosciuto');
    eqj(C.imageInfo(png(0xFFFFFFFF, 0xFFFFFFFF)), {mime: 'image/png', w: 4294967295, h: 4294967295}, 'PNG enorme: dimensioni lette senza segno');
    ok(C.ext('a/b/Foto.PNG') === '.png' && C.ext('senza') === '' && C.ext('x.jpeg') === '.jpeg' && C.ext('x.toolong') === '', 'ext');
  }

  // ------------------------------------------------------------ nomi
  {
    const a = C.parseCoverName('Killer Bees (1981)(Philips)(EU).png');
    eqj([a.tkey, a.year, a.countries, a.publisher, a.norm, a.role], ['killerbees', '1981', ['EU'], ['philips'], 'killerbees1981philipseu', ''], 'nome TOSEC');
    const b = C.parseCoverName('Blockout & Breakdown (1981)(Philips)(EU-US).jpg');
    eqj([b.tkey, b.year, b.countries], ['blockoutbreakdown', '1981', ['EU', 'US']], 'titolo con «&» e due paesi');
    eqj(C.parseCoverName('Blockout and Breakdown.png').tkey, 'blockoutbreakdown', '«and» come «&»');
    eqj(C.parseCoverName('Killer Bees, The (1981).png').tkey, 'killerbees', 'articolo finale «, The»');
    eqj(C.parseCoverName('The Killer Bees.png').tkey, 'killerbees', 'articolo iniziale');
    eqj(C.parseCoverName('Le Chevalier.png').tkey, 'chevalier', 'articolo francese');
    eqj(C.parseCoverName('The.png').tkey, 'the', 'titolo che e\' solo un articolo si tiene');
    eqj(C.parseCoverName('Pétanque.png').tkey, 'petanque', 'accenti tolti');
    eqj(C.parseCoverName('PETANQUE.png').tkey, 'petanque', 'maiuscole');
    eqj(C.parseCoverName("Pick-Axe Pete!.png").tkey, 'pickaxepete', 'punteggiatura');
    const c = C.parseCoverName('Demon Attack (Europe).webp');
    eqj([c.tkey, c.countries, c.year], ['demonattack', ['EU'], ''], 'forma «Titolo (Europe)»');
    eqj(C.parseCoverName('Demon Attack (Europe, USA).png').countries, ['EU', 'US'], 'Europe, USA');
    eqj(C.parseCoverName('Demon Attack (Imagic)(Europe).png').publisher, ['imagic'], 'editore prima del paese');
    eqj(C.parseCoverName('X (198x)(Philips).png').year, '198x', 'anno 198x');
    eqj(C.parseCoverName('X (19xx)(Philips).png').year, '19xx', 'anno 19xx');
    eqj(C.parseCoverName('X (1981-05-12)(Philips).png').year, '1981', 'data completa -> anno');
    eqj(C.parseCoverName('X (-)(Philips).png').publisher, ['philips'], 'editore «-» saltato');
    eqj(C.parseCoverName('Killer Bees [a1].png').tkey, 'killerbees', 'etichette fra quadre dopo il titolo');
    eqj(C.parseCoverName('cartella\\sotto\\Killer Bees.png').tkey, 'killerbees', 'percorso con barra rovesciata');
    eqj(C.parseCoverName('(1981).png').tkey !== undefined, true, 'nome fatto solo di parentesi non fa errori');
    eqj(C.parseCoverName('').tkey, '', 'nome vuoto');
    eqj(C.countriesOf('EU-US'), ['EU', 'US'], 'countriesOf EU-US');
    eqj(C.countriesOf('Europe'), ['EU'], 'countriesOf Europe');
    eqj(C.countriesOf('Europe, USA'), ['EU', 'US'], 'countriesOf elenco');
    eqj(C.countriesOf('World'), ['EU', 'US'], 'countriesOf World');
    eqj(C.countriesOf(''), [], 'countriesOf vuoto');
    eqj(C.countriesOf('Philips'), null, 'countriesOf: un editore non e\' un paese');
    eqj(C.countriesOf('Europe, Philips'), null, 'countriesOf: elenco misto non e\' un elenco di paesi');
    eqj(C.roleOf('Boxart'), 'box', 'ruolo box'); eqj(C.roleOf('Covers'), 'box', 'ruolo cover'); eqj(C.roleOf('Copertine'), 'box', 'ruolo copertine');
    eqj(C.roleOf('Snaps'), 'shot', 'ruolo snap'); eqj(C.roleOf('Titles'), 'shot', 'ruolo title'); eqj(C.roleOf('Screenshots'), 'shot', 'ruolo screenshots'); eqj(C.roleOf('Schermate'), 'shot', 'ruolo schermate');
    eqj(C.roleOf('Magnavox'), '', 'nessun ruolo');
    eqj(C.parseCoverName('Box/Killer Bees.png').role, 'box', 'ruolo dalla cartella del file');
    eqj(C.parseCoverName('Snaps/Killer Bees.png').role, 'shot', 'ruolo shot dalla cartella');
    eqj(C.parseCoverName('Box/altra/Killer Bees.png').role, '', 'conta solo la cartella immediata');
    const g = C.gameDesc(game('Killer Bees', '1981', 'EU', 'Philips'));
    eqj([g.tkey, g.year, g.countries, g.publisher, g.norm], ['killerbees', '1981', ['EU'], ['philips'], 'killerbees1981philipseu'], 'gameDesc');
    eqj(C.gameDesc({title: 'Killer Bees, The', name: 'Killer Bees, The.bin'}).tkey, 'killerbees', 'gameDesc con articolo');
    eqj(C.gameDesc({name: 'Pickaxe Pete (1983)(Philips)(EU).bin'}).tkey, 'pickaxepete', 'gameDesc senza titolo: dal nome');
    eqj(C.gameDesc({}).tkey, '', 'gameDesc vuoto');
    eqj(C.gameDesc({title: 'X', country: 'EU-US', name: 'X.rom'}).countries, ['EU', 'US'], 'gameDesc paesi doppi');
  }

  // ------------------------------------------------------------ aggiunta e abbinamento
  {
    const cv = new C.Covers();
    eqj([cv.count, cv.bytes, cv.rev, cv.nextId], [0, 0, 0, 1], 'stato iniziale');
    const p1 = png(200, 300, 100);
    const r = await cv.addFile('Killer Bees (1981)(Philips)(EU).png', p1);
    eqj([r.added, r.dups, r.skipped.length, r.errors.length, r.addedIds], [1, 0, 0, 0, [1]], 'una PNG aggiunta');
    eqj([cv.count, cv.bytes, cv.rev], [1, p1.length, 1], 'conteggi dopo la prima');
    const c1 = cv.get(1);
    eqj([c1.name, c1.mime, c1.w, c1.h, c1.size, c1.tkey, c1.role, c1.folder], ['Killer Bees (1981)(Philips)(EU).png', 'image/png', 200, 300, p1.length, 'killerbees', '', ''], 'campi della copertina');
    ok(c1.data === p1 || (c1.data.length === p1.length), 'dati conservati');
    ok(cv.get(99) === null, 'get di un id inesistente');
    // doppione identico
    const r2 = await cv.addFile('Killer Bees (1981)(Philips)(EU).png', p1);
    eqj([r2.added, r2.dups, cv.count, cv.rev], [0, 1, 1, 1], 'doppione ignorato e rev invariata');
    // stesso contenuto con altro titolo: non e' un doppione
    const r3 = await cv.addFile('Pickaxe Pete (1983)(Philips)(EU).png', p1);
    eqj([r3.added, r3.dups], [1, 0], 'stesso contenuto, altro titolo: aggiunto');
    // stesso nome, contenuto diverso: aggiunto
    const r4 = await cv.addFile('Killer Bees (1981)(Philips)(EU).png', png(200, 300, 101));
    eqj([r4.added, r4.dups], [1, 0], 'stesso nome, altro contenuto: aggiunto');
    eqj(cv.count, 3, 'tre copertine');
    // abbinamento: nome identico vince
    const m = cv.matchFor(game('Killer Bees', '1981', 'EU', 'Philips'));
    ok(m && m.exact && m.score >= 100 && m.cover.tkey === 'killerbees', 'abbinamento esatto per nome');
    const m2 = cv.matchFor(game('Pickaxe Pete', '1983', 'EU', 'Philips'));
    ok(m2 && m2.cover.id === 2 && m2.exact, 'abbinamento di Pickaxe Pete');
    ok(cv.matchFor(game('Altro Gioco', '1983', 'EU', 'Philips')) === null, 'nessuna copertina per un altro titolo');
    ok(cv.matchFor({}) === null && cv.matchFor({title: ''}) === null, 'gioco senza titolo: nessun abbinamento');
    ok(cv.forGame(game('Killer Bees', '1981', 'EU', 'Philips')).tkey === 'killerbees' && cv.forGame(game('Altro', '1', 'EU', 'x')) === null, 'forGame');
    eqj(cv.matchedCount([game('Killer Bees', '1981', 'EU', 'Philips'), game('Pickaxe Pete', '1983', 'EU', 'Philips'), game('Altro', '1', 'EU', 'x')]), 2, 'matchedCount');
    // titolo uguale ma versione diversa: vicinanza per anno, paese, editore
    const cv2 = new C.Covers();
    await cv2.addFile('Demon Attack (1983)(Imagic)(US).png', png(10, 10, 1));
    await cv2.addFile('Demon Attack (1983)(Imagic)(EU).png', png(10, 10, 2));
    await cv2.addFile('Demon Attack (1982)(Imagic)(EU).png', png(10, 10, 3));
    const gs = (y, c, p) => ({title: 'Demon Attack', year: y, country: c, publisher: p, name: 'Demon Attack (' + y + ')(' + p + ')(' + c + ').bin'});
    ok(cv2.forGame(gs('1983', 'US', 'Imagic')).countries[0] === 'US', 'scelta per paese (nome esatto)');
    const v1 = cv2.matchFor({title: 'Demon Attack', year: '1983', country: 'EU', publisher: 'Imagic', name: 'Demon Attack.bin'});
    ok(v1.cover.year === '1983' && v1.cover.countries[0] === 'EU' && !v1.exact, 'senza nome identico: anno e paese uguali vincono (' + v1.score + ')');
    const v2 = cv2.matchFor({title: 'Demon Attack', year: '1982', country: 'US', publisher: 'Imagic', name: 'Demon Attack.bin'});
    ok(v2.cover.year === '1982', 'anno uguale pesa piu\' del paese (' + v2.cover.year + ')');
    const v3 = cv2.matchFor({title: 'Demon Attack', name: 'Demon Attack.bin'});
    ok(v3 && !v3.exact, 'gioco senza dati extra: una copertina di quel titolo viene comunque scelta');
    // a parita' di tutto vince il nome in ordine alfabetico, poi l'ordine di arrivo
    const cv3 = new C.Covers();
    await cv3.addFile('Zeta/Gioco.png', png(10, 10, 1));
    await cv3.addFile('Alfa/Gioco.png', png(10, 10, 2));
    ok(cv3.forGame({title: 'Gioco', name: 'Gioco.bin'}).folder === 'Zeta' || cv3.forGame({title: 'Gioco', name: 'Gioco.bin'}).folder === 'Alfa', 'parita\': una scelta c\'e\'');
    const t1 = cv3.forGame({title: 'Gioco', name: 'Gioco.bin'}).id;
    const t2 = cv3.forGame({title: 'Gioco', name: 'Gioco.bin'}).id;
    ok(t1 === t2, 'parita\': la scelta e\' stabile');
    // copertina contro schermata
    const cv4 = new C.Covers();
    await cv4.addFile('Snaps/Gioco.png', png(10, 10, 1));
    await cv4.addFile('Box/Gioco.png', png(10, 10, 2));
    await cv4.addFile('Snaps/Altro.png', png(10, 10, 3));
    ok(cv4.forGame({title: 'Gioco', name: 'Gioco.bin'}).role === 'box', 'la copertina batte la schermata');
    ok(cv4.forGame({title: 'Altro', name: 'Altro.bin'}).role === 'shot', 'se c\'e\' solo la schermata, si usa quella');
    const cv5 = new C.Covers();
    await cv5.addFile('Box/Gioco (1981).png', png(10, 10, 1));
    await cv5.addFile('Gioco (1981)(Philips)(EU).png', png(10, 10, 2));
    ok(cv5.matchFor({title: 'Gioco', year: '1981', country: 'EU', publisher: 'Philips', name: 'Gioco (1981)(Philips)(EU).bin'}).cover.id === 2, 'nome TOSEC identico vince su tutto (anche sul ruolo)');
    // cartelle: il ruolo e il nome della cartella restano
    const cv6 = new C.Covers();
    await cv6.addFile('Boxart/Philips/Killer Bees.png', png(10, 10, 1));
    eqj([cv6.get(1).folder, cv6.get(1).role], ['Philips', ''], 'cartella immediata e ruolo vuoto');
  }

  // ------------------------------------------------------------ file non validi
  {
    const cv = new C.Covers();
    const sk = async (n, b) => (await cv.addFile(n, b));
    let r = await sk('Gioco.txt', text('ciao'));
    ok(r.added === 0 && r.skipped.length === 1 && /non è un’immagine \(\.txt\)/.test(r.skipped[0].why), 'estensione non immagine: ' + JSON.stringify(r.skipped));
    r = await sk('Gioco', text('ciao'));
    ok(/senza estensione/.test(r.skipped[0].why), 'senza estensione');
    r = await sk('Gioco.png', text('questo non e\' un PNG'));
    ok(r.added === 0 && /il contenuto non è un’immagine/.test(r.skipped[0].why), 'estensione png ma contenuto di testo');
    r = await sk('Gioco.png', gif(3, 3));
    ok(r.added === 1 && cv.get(r.addedIds[0]).mime === 'image/gif', 'il tipo viene dal contenuto, non dall\'estensione');
    r = await sk('Gioco.png', new Uint8Array(0));
    ok(/vuoto/.test(r.skipped[0].why), 'file vuoto');
    const trunc = png(10, 10).slice(0, 20);
    r = await sk('Troncato.png', trunc);
    ok(/intestazione dell’immagine non leggibile/.test(r.skipped[0].why), 'PNG troncato');
    r = await sk('Enorme.png', png(9000, 100));
    ok(/dimensioni non ammesse \(9000 x 100 punti\)/.test(r.skipped[0].why), 'larghezza oltre 8192');
    r = await sk('Enorme2.png', png(8192, 8192));
    ok(/dimensioni non ammesse/.test(r.skipped[0].why), '8192 x 8192 = 67 milioni di punti, oltre 40 milioni');
    r = await sk('Limite.png', png(8000, 5000));
    ok(r.added === 1, '8000 x 5000 = 40 milioni: ammesso');
    r = await sk('Zero.png', png(0, 10));
    ok(/dimensioni non ammesse/.test(r.skipped[0].why), 'larghezza zero');
    r = await sk('.png', png(10, 10, 5));
    ok(/nome senza titolo/.test(r.skipped[0].why), 'nome senza titolo');
    r = await sk('Bomba.png', png(100, 100, C.LIMITS.image));
    ok(/immagine troppo grande/.test(r.skipped[0].why), 'immagine oltre 8 MB');
    ok(cv.count === 2, 'solo le due valide sono entrate (' + cv.count + ')');
    const rev = cv.rev; await sk('Niente.txt', text('x')); ok(cv.rev === rev, 'rev invariata se non si aggiunge nulla');
  }

  // ------------------------------------------------------------ zip
  {
    const cv = new C.Covers();
    const z = zip([
      ['Box/Killer Bees (1981)(Philips)(EU).png', png(20, 30, 1)],
      ['Box/Pickaxe Pete (1983)(Philips)(EU).jpg', jpeg(20, 30)],
      ['Snaps/Killer Bees (1981)(Philips)(EU).png', png(20, 30, 2)],
      ['LEGGIMI.txt', text('ciao')],
      ['Box/rotta.png', text('niente')],
    ]);
    ok(U.isZip(z) && C.isCoverArchive(z), 'isCoverArchive: zip di immagini');
    const r = await cv.addFile('Raccolta.zip', z);
    eqj([r.added, r.dups], [3, 0], 'zip: tre immagini');
    eqj(r.skipped.map((s) => s.name).sort(), ['LEGGIMI.txt', 'rotta.png'], 'zip: file saltati');
    const k = cv.list.map((c) => c.role + ':' + c.folder + ':' + c.tkey).sort();
    eqj(k, ['box:Box:killerbees', 'box:Box:pickaxepete', 'shot:Snaps:killerbees'], 'zip: ruolo e cartella dalle voci');
    const r2 = await cv.addFile('Raccolta.zip', z);
    eqj([r2.added, r2.dups], [0, 3], 'lo stesso zip due volte: tutti doppioni');
    // lo zip porta il proprio percorso: cartella/Raccolta.zip -> le voci ereditano la cartella
    const cv2 = new C.Covers();
    await cv2.addFile('Box/Archivio.zip', zip([['Gioco.png', png(10, 10, 1)]]));
    eqj([cv2.get(1).role, cv2.get(1).folder], ['box', 'Box'], 'le voci ereditano la cartella dello zip');
    // zip annidato
    const inner = zip([['Gioco A (1981).png', png(10, 10, 1)], ['Gioco B (1982).png', png(10, 10, 2)]]);
    const outer = zip([['interno.zip', inner], ['Gioco C.png', png(10, 10, 3)]]);
    const cv3 = new C.Covers();
    const r3 = await cv3.addFile('esterno.zip', outer);
    eqj([r3.added, cv3.list.map((c) => c.tkey).sort()], [3, ['giocoa', 'giocob', 'giococ']], 'zip dentro zip');
    ok(!C.isCoverArchive(outer), 'isCoverArchive: uno zip con zip annidato non e\' un archivio di sole copertine');
    // profondita'
    const lvl3 = zip([['x.zip', zip([['y.zip', zip([['Gioco.png', png(10, 10, 1)]])]])]]);
    const cv4 = new C.Covers();
    const r4 = await cv4.addFile('l0.zip', lvl3);
    ok(r4.added === 0 && r4.skipped.some((s) => /annidati troppo in profondità/.test(s.why)), 'tre livelli di zip: oltre il limite (' + JSON.stringify(r4.skipped) + ')');
    // zip rotto
    const cv5 = new C.Covers();
    const bad = z.slice(0, z.length - 30);
    const r5 = await cv5.addFile('rotto.zip', Uint8Array.from([0x50, 0x4B, 3, 4, 1, 2, 3]));
    ok(r5.added === 0 && r5.errors.length >= 1, 'zip rotto: errore e nessuna copertina (' + JSON.stringify(r5.errors) + ')');
    const r5b = await cv5.addFile('troncato.zip', bad);
    ok(r5b.added === 0, 'zip troncato: nessuna copertina entra');
    // voce corrotta (CRC): le altre entrano
    const zc = zip([['Buona (1981).png', png(10, 10, 1)], ['Guasta (1981).png', png(10, 10, 2)]]);
    const idx = Buffer.from(zc).indexOf(Buffer.from('Guasta (1981).png')) + 17 + 30;
    zc[idx] ^= 0xFF;
    const cv6 = new C.Covers();
    const r6 = await cv6.addFile('uno.zip', zc);
    ok(r6.added === 1 && r6.errors.length === 1 && cv6.list[0].tkey === 'buona', 'voce con CRC sbagliato: errore sulla sola voce (' + JSON.stringify(r6.errors) + ')');
    // isCoverArchive: i casi
    ok(!C.isCoverArchive(zip([['Gioco.bin', new Uint8Array(2048)], ['Gioco.png', png(10, 10)]])), 'isCoverArchive: con un .bin no');
    ok(!C.isCoverArchive(zip([['Gioco.rom', new Uint8Array(2048)]])), 'isCoverArchive: con un .rom no');
    ok(!C.isCoverArchive(zip([['Gioco.o2', new Uint8Array(2048)]])) && !C.isCoverArchive(zip([['Gioco.vp', new Uint8Array(2048)]])), 'isCoverArchive: .o2 e .vp no');
    ok(!C.isCoverArchive(zip([['note.txt', text('x')]])), 'isCoverArchive: solo testo no');
    ok(C.isCoverArchive(zip([['note.txt', text('x')], ['a/b.PNG', png(10, 10)]])), 'isCoverArchive: immagine piu\' file di contorno si');
    ok(!C.isCoverArchive(png(10, 10)) && !C.isCoverArchive(new Uint8Array(0)) && !C.isCoverArchive(text('PK')), 'isCoverArchive: non zip no');
    ok(!C.isCoverArchive(Uint8Array.from([0x50, 0x4B, 3, 4, 9, 9, 9, 9])), 'isCoverArchive: zip rotto no (nessuna eccezione)');
  }

  // ------------------------------------------------------------ limiti
  {
    const L = C.LIMITS, saved = Object.assign({}, L);
    const restore = () => Object.assign(L, saved);
    try {
      // troppe voci
      L.entries = 5;
      const many = zip(Array.from({length: 10}, (_, i) => ['G' + i + ' (1981).png', png(10, 10, i + 1)]));
      let cv = new C.Covers();
      let r = await cv.addFile('molte.zip', many);
      ok(r.errors.length === 1 && /troppe voci/.test(r.errors[0]) && r.visited > 5, 'troppe voci: ' + JSON.stringify(r.errors));
      ok(cv.count <= 5, 'le copertine gia\' lette restano (' + cv.count + ')');
      restore();
      // byte estratti
      L.budget = 1000;
      cv = new C.Covers();
      r = await cv.addFile('grosso.zip', zip([['A (1981).png', png(10, 10, 400)], ['B (1981).png', png(10, 10, 400)], ['C (1981).png', png(10, 10, 400)]]));
      ok(r.errors.length === 1 && /limite di byte estratti/.test(r.errors[0]), 'byte estratti: ' + JSON.stringify(r.errors));
      ok(cv.count === 2, 'prima del limite entrano le immagini che stanno nel budget (' + cv.count + ')');
      restore();
      // zip bomba: la dimensione dichiarata supera il limite di una immagine -> saltata senza estrarla
      L.image = 500;
      cv = new C.Covers();
      r = await cv.addFile('bomba.zip', zip([['Grande (1981).png', png(10, 10, 600)], ['Piccola (1981).png', png(10, 10, 100)]]));
      ok(r.added === 1 && r.skipped.some((s) => /immagine troppo grande/.test(s.why) && s.name === 'Grande (1981).png'), 'voce troppo grande saltata prima di estrarla: ' + JSON.stringify(r.skipped));
      restore();
      L.inner = 100;
      cv = new C.Covers();
      r = await cv.addFile('ext.zip', zip([['interno.zip', zip([['G (1981).png', png(10, 10, 300)]])]]));
      ok(r.added === 0 && r.skipped.some((s) => /zip troppo grande/.test(s.why)), 'zip annidato troppo grande');
      restore();
      // numero di copertine
      L.covers = 3;
      cv = new C.Covers();
      r = await cv.addFile('tante.zip', zip(Array.from({length: 6}, (_, i) => ['G' + i + ' (1981).png', png(10, 10, i + 1)])));
      ok(cv.count === 3 && r.errors.some((e) => /troppe copertine/.test(e)), 'tetto di copertine: ' + cv.count + ' ' + JSON.stringify(r.errors));
      restore();
      // memoria totale
      L.total = 700;
      cv = new C.Covers();
      r = await cv.addFile('peso.zip', zip([['A (1981).png', png(10, 10, 300)], ['B (1981).png', png(10, 10, 300)], ['C (1981).png', png(10, 10, 300)]]));
      ok(cv.count === 2 && r.errors.some((e) => /limite di memoria/.test(e)) && cv.bytes <= 700, 'tetto di memoria: ' + cv.count + ' ' + cv.bytes + ' ' + JSON.stringify(r.errors));
      restore();
      // errori che non sono limiti si propagano
      cv = new C.Covers();
      let thrown = null;
      try { await cv.addFile('x.png', null); } catch (e) { thrown = e; }
      ok(thrown !== null, 'un errore di programma non viene nascosto');
      // avanzamento
      const prog = [];
      cv = new C.Covers();
      await cv.addFile('prog.zip', zip(Array.from({length: 40}, (_, i) => ['P' + i + ' (1981).png', png(10, 10, i + 1)])), {onProgress: (n) => prog.push(n)});
      ok(prog.length >= 2 && prog[0] === 16, 'avanzamento ogni 16 voci: ' + JSON.stringify(prog));
    } finally { restore(); }
  }

  // ------------------------------------------------------------ remove / clear / id
  {
    const cv = new C.Covers();
    await cv.addFile('A (1981).png', png(10, 10, 1));
    await cv.addFile('B (1981).png', png(10, 10, 2));
    await cv.addFile('A (1982).png', png(10, 10, 3));
    const rev = cv.rev, bytes = cv.bytes, sz = cv.get(1).size;
    ok(cv.remove(1) === true, 'remove');
    eqj([cv.count, cv.bytes, cv.rev > rev], [2, bytes - sz, true], 'dopo remove: conteggio, byte, rev');
    ok(cv.remove(1) === false && cv.remove(999) === false, 'remove di un id assente');
    ok(cv.get(1) === null && cv.get(2) !== null, 'get dopo remove');
    ok(cv.forGame({title: 'A', year: '1981', name: 'A (1981).bin'}).id === 3, 'la copertina rimossa non si abbina piu\'');
    await cv.addFile('A (1981).png', png(10, 10, 1));
    ok(cv.get(4) && cv.get(4).tkey === 'a', 'dopo remove la stessa immagine si puo\' riaggiungere (la chiave si libera)');
    ok(cv.remove(3) && cv.remove(4) && cv.forGame({title: 'A', name: 'A.bin'}) === null, 'tolte tutte quelle di un titolo: l\'indice si svuota');
    const rev2 = cv.rev;
    cv.clear();
    eqj([cv.count, cv.bytes, cv.list.length, cv.rev > rev2], [0, 0, 0, true], 'clear');
    ok(cv.forGame({title: 'B', name: 'B.bin'}) === null, 'clear: nessun abbinamento');
    await cv.addFile('Z (1981).png', png(10, 10, 9));
    ok(cv.list[0].id === 5 && cv.nextId === 6, 'gli id non si riusano nemmeno dopo clear (' + cv.list[0].id + ')');
    const rev3 = cv.rev; cv.clear(); cv.clear(); ok(cv.rev === rev3 + 2, 'rev sale a ogni svuotamento');
  }

  // ------------------------------------------------------------ approfondimenti (nati dalla prova di mutazione)
  {
    // limiti dichiarati
    eqj(C.LIMITS, {depth: 2, entries: 20000, image: 8 << 20, inner: 256 << 20, budget: 512 << 20, total: 256 << 20, covers: 5000, side: 8192, pixels: 40000000}, 'valori dei limiti');
    eqj(C.IMG_EXTS, ['.png', '.jpg', '.jpeg', '.webp', '.gif'], 'estensioni delle immagini');

    // intestazioni: ogni byte della firma conta, e la lunghezza minima esatta basta
    const sig = {png: png(10, 10), gif: gif(3, 3), jpeg: jpeg(5, 5), webp: webpX(7, 7)};
    const sigLen = {png: 8, gif: 6, jpeg: 3, webp: 12};
    const sigTouch = {png: [0, 1, 2, 3, 4, 5, 6, 7], gif: [0, 1, 2, 3, 4, 5], jpeg: [0, 1, 2], webp: [0, 1, 2, 3, 8, 9, 10, 11]};
    for (const k of Object.keys(sig)) {
      const mime = 'image/' + k;
      ok(C.sniffImage(sig[k].slice(0, sigLen[k])) === mime, 'firma ' + k + ': basta la lunghezza minima (' + sigLen[k] + ')');
      ok(C.sniffImage(sig[k].slice(0, sigLen[k] - 1)) === null, 'firma ' + k + ': un byte in meno non basta');
      for (const i of sigTouch[k]) { const b = sig[k].slice(); b[i] ^= 0x55; ok(C.sniffImage(b) === null, 'firma ' + k + ': byte ' + i + ' alterato -> non riconosciuto'); }
    }
    ok(C.sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) === 'image/gif' && C.sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) === 'image/gif', 'GIF87a e GIF89a');
    // lunghezze minime per leggere le dimensioni
    ok(C.imageInfo(png(10, 20).slice(0, 24)) !== null && C.imageInfo(png(10, 20).slice(0, 23)) === null, 'PNG: servono 24 byte');
    ok(C.imageInfo(gif(3, 4).slice(0, 10)) !== null && C.imageInfo(gif(3, 4).slice(0, 9)) === null, 'GIF: servono 10 byte');
    ok(C.imageInfo(webpX(100, 200).slice(0, 30)) !== null && C.imageInfo(webpX(100, 200).slice(0, 29)) === null, 'WebP VP8X: servono 30 byte');
    ok(C.imageInfo(webpL(100, 200).slice(0, 25)) !== null && C.imageInfo(webpL(100, 200).slice(0, 24)) === null, 'WebP VP8L: servono 25 byte');
    ok(C.imageInfo(webpV(100, 200).slice(0, 30)) !== null && C.imageInfo(webpV(100, 200).slice(0, 29)) === null, 'WebP VP8: servono 30 byte');
    for (const i of [23, 24, 25]) { const b = webpV(100, 200); b[i] ^= 0x33; ok(C.imageInfo(b) === null, 'WebP VP8: byte di firma ' + i + ' alterato'); }
    { const b = webpL(100, 200); b[20] ^= 0x33; ok(C.imageInfo(b) === null, 'WebP VP8L: firma 0x2F alterata'); }
    // dimensioni grandi e alte
    eqj(C.imageInfo(webpX(70000, 100)), {mime: 'image/webp', w: 70000, h: 100}, 'VP8X: 24 bit di larghezza');
    eqj(C.imageInfo(webpX(100, 70000)), {mime: 'image/webp', w: 100, h: 70000}, 'VP8X: 24 bit di altezza');
    eqj(C.imageInfo(webpL(10, 4000)), {mime: 'image/webp', w: 10, h: 4000}, 'VP8L alto 4000');
    eqj(C.imageInfo(webpL(16384, 16384)), {mime: 'image/webp', w: 16384, h: 16384}, 'VP8L 16384 x 16384');
    eqj(C.imageInfo(webpL(5000, 3)), {mime: 'image/webp', w: 5000, h: 3}, 'VP8L largo 5000');
    eqj(C.imageInfo(webpV(16383, 16383)), {mime: 'image/webp', w: 16383, h: 16383}, 'VP8 14 bit');
    eqj(C.imageInfo(png(70000, 3)), {mime: 'image/png', w: 70000, h: 3}, 'PNG largo 70000');
    eqj(C.imageInfo(gif(65535, 1)), {mime: 'image/gif', w: 65535, h: 1}, 'GIF largo 65535');

    // JPEG: segmenti, marcatori senza lunghezza, riempimenti, SOF diversi
    const sof = (m, w, h) => [0xFF, m === undefined ? 0xC0 : m, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0];
    const jp = (...parts) => Uint8Array.from([0xFF, 0xD8].concat(...parts));
    const seg = (m, n) => [0xFF, m, (n + 2) >> 8, (n + 2) & 255].concat(new Array(n).fill(0x11));
    eqj(C.imageInfo(jp(seg(0xE1, 0), sof(0xC0, 33, 44))), {mime: 'image/jpeg', w: 33, h: 44}, 'JPEG: segmento di lunghezza 2');
    ok(C.imageInfo(jp([0xFF, 0xE1, 0, 1], sof(0xC0, 33, 44))) === null, 'JPEG: segmento di lunghezza 1 -> non valido');
    ok(C.imageInfo(jp([0xFF, 0xE1, 0, 0], sof(0xC0, 33, 44))) === null, 'JPEG: segmento di lunghezza 0 -> non valido');
    eqj(C.imageInfo(jp(seg(0xE1, 300), sof(0xC0, 111, 222))), {mime: 'image/jpeg', w: 111, h: 222}, 'JPEG: segmento lungo 302 (byte alto della lunghezza)');
    eqj(C.imageInfo(jp(seg(0xE1, 254), sof(0xC0, 5, 6))), {mime: 'image/jpeg', w: 5, h: 6}, 'JPEG: segmento lungo 256');
    for (const m of [0xD0, 0xD3, 0xD7, 0xD8, 0xD9, 0x01]) eqj(C.imageInfo(jp([0xFF, m], sof(0xC0, 40, 50))), {mime: 'image/jpeg', w: 40, h: 50}, 'JPEG: marcatore ' + m.toString(16) + ' senza lunghezza');
    eqj(C.imageInfo(jp([0xFF, 0xFF], sof(0xC0, 41, 51))), {mime: 'image/jpeg', w: 41, h: 51}, 'JPEG: byte di riempimento FF');
    eqj(C.imageInfo(jp([0xFF, 0xFF, 0xFF], sof(0xC0, 41, 52))), {mime: 'image/jpeg', w: 41, h: 52}, 'JPEG: due byte di riempimento');
    eqj(C.imageInfo(jp([0xFF, 0xE1, 0, 3, 7], [0x00, 0x00], sof(0xC0, 42, 53))), {mime: 'image/jpeg', w: 42, h: 53}, 'JPEG: byte estranei fra i segmenti si saltano');
    for (const m of [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]) eqj(C.imageInfo(jp(sof(m, 321, 123))), {mime: 'image/jpeg', w: 321, h: 123}, 'JPEG: SOF ' + m.toString(16));
    for (const m of [0xC4, 0xC8, 0xCC]) eqj(C.imageInfo(jp(seg(m, 20), sof(0xC0, 77, 88))), {mime: 'image/jpeg', w: 77, h: 88}, 'JPEG: segmento ' + m.toString(16) + ' non e\' un SOF');
    ok(C.imageInfo(jp(seg(0xDB, 20))) === null, 'JPEG: nessun SOF');
    // SOF che finisce esattamente: servono 9 byte dal marcatore
    { const full = jp(sof(0xC0, 600, 400)); ok(C.imageInfo(full.slice(0, 2 + 9)) !== null && C.imageInfo(full.slice(0, 2 + 8)) === null, 'JPEG: SOF troncato di un byte -> null'); }
    // numero massimo di segmenti
    const many = (n) => jp(...Array.from({length: n}, () => [0xFF, 0xE1, 0, 2]), sof(0xC0, 9, 8));
    ok(C.imageInfo(many(4095)) !== null && C.imageInfo(many(4096)) === null, 'JPEG: 4095 segmenti si leggono, 4096 no');
    ok(C.imageInfo(many(10)) !== null, 'JPEG: dieci segmenti');

    // titoli e nomi: lettere e cifre
    const all = 'abcdefghijklmnopqrstuvwxyz0123456789';
    eqj(C.titleWords(all).join(''), all, 'titleWords: tutte le lettere e le cifre restano');
    eqj(C.titleWords('Space 1999').join(' '), 'space 1999', 'titleWords con numeri');
    eqj(C.titleWords('Pac-Man 2: Z!y').join(' '), 'pac man 2 z y', 'titleWords: separatori');
    eqj(C.normName(all.toUpperCase() + ' -_ ' + all), all + all, 'normName: lettere, cifre e separatori');
    eqj(C.parseCoverName('Atari 2600 Kit (1983)(Atari 2600 Corp)(US).png').publisher, ['atari', '2600', 'corp'], 'editore con cifre');
    eqj(C.parseCoverName('Atari 2600 Kit (1983)(Atari 2600 Corp)(US).png').tkey, 'atari2600kit', 'titolo con cifre');
    eqj(C.parseCoverName('X (Philips)(Altro).png').publisher, ['philips'], 'vale il primo editore');
    eqj(C.parseCoverName('X (-)(-)(Philips).png').publisher, ['philips'], 'i «-» non contano come editore');
    eqj(C.parseCoverName('X (1981)(1982)(Philips).png').year, '1981', 'vale il primo anno');
    eqj(C.parseCoverName('X (Europe)(USA).png').countries, ['EU', 'US'], 'paesi in gruppi separati');
    eqj(C.parseCoverName('X (EU)(EU-US).png').countries, ['EU', 'US'], 'paesi senza doppioni');
    for (const e of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'PNG', 'JPEG']) eqj(C.parseCoverName('Gioco Bello.' + e).norm, 'giocobello', 'estensione .' + e + ' tolta dal nome');
    eqj(C.parseCoverName('Gioco Bello.bmp').norm, 'giocobellobmp', 'estensione non immagine resta nel nome');
    for (const e of ['bin', 'rom', 'o2', 'vp', 'zip', 'BIN']) eqj(C.gameDesc({title: 'Gioco Bello', name: 'Gioco Bello.' + e}).norm, 'giocobello', 'gameDesc: estensione .' + e + ' tolta');
    eqj(C.gameDesc({title: 'X', name: 'Gioco.txt'}).norm, 'giocotxt', 'gameDesc: .txt resta');
    for (const [k, role] of [['snap', 'shot'], ['screen', 'shot'], ['title', 'shot'], ['ingame', 'shot'], ['gameplay', 'shot'], ['schermat', 'shot'], ['SNAPS', 'shot'],
      ['box', 'box'], ['cover', 'box'], ['front', 'box'], ['artwork', 'box'], ['copertin', 'box'], ['jaquette', 'box'], ['cartridge', 'box'], ['BOXART', 'box']]) eqj(C.roleOf('x ' + k + ' y'), role, 'ruolo ' + k);
    eqj(C.roleOf(''), '', 'ruolo vuoto');
    eqj(C.parseCoverName('/Box/Alfa.png').role, 'box', 'percorso con barra iniziale');
    eqj(C.parseCoverName('Box/Alfa.png').role, 'box', 'percorso con una cartella');
    eqj(C.parseCoverName('a/b/Box/Alfa.png').role, 'box', 'percorso lungo');
    eqj(C.parseCoverName('Alfa.png').role, '', 'nessuna cartella');
    eqj(C.parseCoverName('Box\\Alfa.png').role, 'box', 'barra rovesciata');
    eqj(C.ext('a.zz'), '.zz', 'ext due lettere'); eqj(C.ext('a.c'), '.c', 'ext una lettera'); eqj(C.ext('a.abcd'), '.abcd', 'ext quattro'); eqj(C.ext('a.abcde'), '', 'ext cinque: no');
    eqj(C.ext('a.m4a'), '.m4a', 'ext con cifra'); eqj(C.ext('a.7z'), '.7z', 'ext che inizia per cifra'); eqj(C.ext('a.9'), '.9', 'ext 9'); eqj(C.ext('a.Z0'), '.z0', 'ext Z0'); eqj(C.ext('a.a-b'), '', 'ext con trattino no'); eqj(C.ext('a.a_b'), '', 'ext con trattino basso no');
    eqj(C.ext('a.zzzz'), '.zzzz', 'ext zzzz'); eqj(C.ext('A.AAAA'), '.aaaa', 'ext AAAA');

    // punteggio, valori esatti
    const D = (o) => Object.assign({norm: 'x', year: '', countries: [], publisher: [], role: ''}, o);
    const sc = (g, c) => C.score(D(g), D(c));
    eqj(sc({norm: 'a'}, {norm: 'a'}), 100, 'punteggio: nome identico');
    eqj(sc({norm: 'a'}, {norm: 'a', role: 'box'}), 100.5, 'nome identico + copertina');
    eqj(sc({norm: 'a'}, {norm: 'a', role: 'shot'}), 99.5, 'nome identico + schermata');
    eqj(sc({norm: 'a'}, {norm: 'b'}), 10, 'punteggio base 10');
    eqj(sc({norm: 'a'}, {norm: 'b', role: 'box'}), 10.5, 'base + copertina');
    eqj(sc({norm: 'a'}, {norm: 'b', role: 'shot'}), 9.5, 'base - schermata');
    eqj(sc({norm: 'a', year: '1981'}, {norm: 'b', year: '1981'}), 14, 'anno uguale +4');
    eqj(sc({norm: 'a', year: '1981'}, {norm: 'b', year: '1982'}), 9, 'anno diverso -1');
    eqj(sc({norm: 'a', year: '1981'}, {norm: 'b', year: ''}), 10, 'anno mancante nella copertina: 0');
    eqj(sc({norm: 'a', year: ''}, {norm: 'b', year: '1981'}), 10, 'anno mancante nel gioco: 0');
    eqj(sc({norm: 'a', year: '198x'}, {norm: 'b', year: '1981'}), 10, 'anno 198x non conta');
    eqj(sc({norm: 'a', year: '1981'}, {norm: 'b', year: '198x'}), 10, 'anno 198x della copertina non conta');
    eqj(sc({norm: 'a', countries: ['EU']}, {norm: 'b', countries: ['EU', 'US']}), 12, 'paese in comune +2');
    eqj(sc({norm: 'a', countries: ['EU']}, {norm: 'b', countries: ['US']}), 9, 'paesi diversi -1');
    eqj(sc({norm: 'a', countries: []}, {norm: 'b', countries: ['US']}), 10, 'paese mancante nel gioco');
    eqj(sc({norm: 'a', countries: ['EU']}, {norm: 'b', countries: []}), 10, 'paese mancante nella copertina');
    eqj(sc({norm: 'a', publisher: ['philips']}, {norm: 'b', publisher: ['philips', 'x']}), 11, 'editore in comune +1');
    eqj(sc({norm: 'a', publisher: ['philips']}, {norm: 'b', publisher: ['imagic']}), 10, 'editori diversi: 0');
    eqj(sc({norm: 'a', publisher: []}, {norm: 'b', publisher: ['imagic']}), 10, 'editore mancante nel gioco');
    eqj(sc({norm: 'a', publisher: ['philips']}, {norm: 'b', publisher: []}), 10, 'editore mancante nella copertina');
    eqj(sc({norm: 'a', year: '1981', countries: ['EU'], publisher: ['p']}, {norm: 'b', year: '1981', countries: ['EU'], publisher: ['p'], role: 'box'}), 17.5, 'tutto insieme');
    eqj(sc({norm: 'a', year: '1981', countries: ['EU'], publisher: ['p']}, {norm: 'b', year: '1982', countries: ['US'], publisher: ['q'], role: 'shot'}), 7.5, 'tutto contro');

    // scelta fra copertine di pari punteggio e piu' vicine
    { const cv = new C.Covers();
      await cv.addFile('Zeta/G.png', png(10, 10, 1)); await cv.addFile('Alfa/G.png', png(10, 10, 2)); await cv.addFile('Mezzo/G.png', png(10, 10, 3));
      ok(cv.forGame({title: 'G', name: 'G.bin'}).id === 1 || cv.forGame({title: 'G', name: 'G.bin'}).id === 2, 'pari punteggio: scelta stabile');
      const cv2 = new C.Covers();
      await cv2.addFile('G (1981)(A).png', png(10, 10, 1)); await cv2.addFile('G (1981)(B).png', png(10, 10, 2));
      ok(cv2.forGame({title: 'G', name: 'G.bin'}).name === 'G (1981)(A).png', 'pari punteggio: vince il nome in ordine alfabetico');
      const cv3 = new C.Covers();
      await cv3.addFile('G (1981)(B).png', png(10, 10, 2)); await cv3.addFile('G (1981)(A).png', png(10, 10, 1));
      ok(cv3.forGame({title: 'G', name: 'G.bin'}).name === 'G (1981)(A).png', 'pari punteggio: il nome vince anche se arriva dopo');
      const cv4 = new C.Covers();
      await cv4.addFile('Box/G.png', png(10, 10, 1)); await cv4.addFile('Snap/G.png', png(10, 10, 2));
      ok(cv4.forGame({title: 'G', name: 'G.bin'}).role === 'box', 'copertina contro schermata a nome uguale');
      // stesso nome file in due cartelle: vince il primo arrivato (id piu' piccolo)
      const cv5 = new C.Covers();
      await cv5.addFile('X/G.png', png(10, 10, 1)); await cv5.addFile('Y/G.png', png(10, 10, 2));
      ok(cv5.forGame({title: 'G', name: 'G.bin'}).folder === 'X', 'stesso nome in due cartelle: il primo arrivato');
      const cv6 = new C.Covers();
      await cv6.addFile('Y/G.png', png(10, 10, 2)); await cv6.addFile('X/G.png', png(10, 10, 1));
      ok(cv6.forGame({title: 'G', name: 'G.bin'}).folder === 'Y', 'stesso nome in due cartelle: il primo arrivato anche se alfabeticamente dopo');
      const m = cv.matchFor({title: 'G', name: 'G.bin'});
      ok(m.exact === true && m.score === 100, 'exact vero a 100 punti');
      const cv7 = new C.Covers(); await cv7.addFile('G (1981).png', png(10, 10, 1));
      const m7 = cv7.matchFor({title: 'G', year: '1981', name: 'Altro nome.bin'});
      ok(m7.exact === false && m7.score === 14, 'exact falso sotto i 100 punti (' + m7.score + ')');
    }

    // messaggi e confini esatti
    { const cv = new C.Covers();
      const e1 = await cv.addFile('rotto.zip', Uint8Array.from([0x50, 0x4B, 3, 4, 1, 2, 3]));
      ok(/^rotto\.zip: /.test(e1.errors[0]), 'errore di zip: «nome: motivo» (' + e1.errors[0] + ')');
      const e2 = await cv.addFile('dir/rotto.zip', Uint8Array.from([0x50, 0x4B, 3, 4, 1, 2, 3]));
      ok(/^rotto\.zip: /.test(e2.errors[0]), 'errore di zip: solo il nome del file (' + e2.errors[0] + ')');
      const zc = zip([['Buona (1981).png', png(10, 10, 1)], ['Guasta (1981).png', png(10, 10, 2)]]);
      zc[Buffer.from(zc).indexOf(Buffer.from('Guasta (1981).png')) + 17 + 30] ^= 0xFF;
      const e3 = await new C.Covers().addFile('d/uno.zip', zc);
      ok(/^Guasta \(1981\)\.png: /.test(e3.errors[0]), 'errore di una voce: «voce: motivo» (' + e3.errors[0] + ')');
      const e4 = await new C.Covers().addFile('d/x.zip', zip([['sotto/a.txt', text('x')], ['b', text('y')], ['c.PDF', text('z')]]));
      eqj(e4.skipped.map((x) => [x.name, x.why]), [['a.txt', 'non è un’immagine (.txt)'], ['b', 'non è un’immagine (senza estensione)'], ['c.PDF', 'non è un’immagine (.pdf)']], 'voci non immagini: nome e motivo');
      const e5 = await new C.Covers().addFile('s.txt', text('x'));
      eqj(e5.skipped, [{name: 's.txt', why: 'non è un’immagine (.txt)'}], 'file non immagine: motivo');
      const e6 = await new C.Covers().addFile('d\\e\\s.png', new Uint8Array(0));
      eqj(e6.skipped, [{name: 's.png', why: 'file vuoto'}], 'file vuoto con percorso a barre rovesciate');
      const e7 = await new C.Covers().addFile('x.png', text('niente'));
      eqj(e7.skipped, [{name: 'x.png', why: 'il contenuto non è un’immagine PNG, JPEG, WebP o GIF'}], 'contenuto non immagine: motivo');
      const e8 = await new C.Covers().addFile('x.png', png(9000, 2));
      eqj(e8.skipped, [{name: 'x.png', why: 'dimensioni non ammesse (9000 x 2 punti)'}], 'dimensioni non ammesse: motivo');
      const e9 = await new C.Covers().addFile('x.png', png(10, 10).slice(0, 20));
      eqj(e9.skipped, [{name: 'x.png', why: 'intestazione dell’immagine non leggibile'}], 'PNG troncato: motivo');
      const e10 = await new C.Covers().addFile('.png', png(10, 10));
      eqj(e10.skipped, [{name: '.png', why: 'nome senza titolo'}], 'nome senza titolo: motivo');
      const e11 = await new C.Covers().addFile('l0.zip', zip([['x.zip', zip([['y.zip', zip([['G.png', png(10, 10)]])]])]]));
      eqj(e11.skipped, [{name: 'y.zip', why: 'zip annidati troppo in profondità'}], 'troppa profondita\': motivo');
    }
    // confini delle dimensioni
    { const cv = new C.Covers();
      const t = async (n, w, h) => (await cv.addFile(n + '.png', png(w, h, w + h))).added;
      ok(await t('uno', 1, 1) === 1, '1 x 1 ammessa');
      ok(await t('larga', 8192, 4882) === 1, '8192 x 4882 ammessa');
      ok(await t('alta', 4882, 8192) === 1, '4882 x 8192 ammessa');
      ok(await t('troppo larga', 8193, 1) === 0, 'larghezza 8193 no');
      ok(await t('troppo alta', 1, 8193) === 0, 'altezza 8193 no');
      ok(await t('esatta', 6400, 6250) === 1, 'esattamente 40 milioni di punti si');
      ok(await t('oltre', 6400, 6251) === 0, '40 milioni e 6400 punti no');
      ok(await t('senza altezza', 10, 0) === 0, 'altezza 0 no');
    }
    // confine dei byte di una immagine: esattamente 8 MB si
    { const cv = new C.Covers();
      const big = png(100, 100, C.LIMITS.image - 33);
      ok(big.length === C.LIMITS.image && (await cv.addFile('Esatta.png', big)).added === 1, 'immagine di esattamente 8 MB ammessa');
      const big2 = png(100, 100, C.LIMITS.image - 32);
      const r = await new C.Covers().addFile('Oltre.png', big2);
      ok(r.added === 0 && r.skipped[0].why === 'immagine troppo grande (' + big2.length + ' byte)', 'un byte oltre 8 MB: ' + JSON.stringify(r.skipped));
      // voce di uno zip: esattamente al limite si, oltre no (la dimensione dichiarata)
      const L = C.LIMITS, saved = L.image;
      try {
        L.image = 100;
        const rz = await new C.Covers().addFile('z.zip', zip([['Ok.png', png(10, 10, 100 - 33)], ['No.png', png(10, 10, 100 - 32)]]));
        ok(rz.added === 1 && rz.skipped.length === 1 && rz.skipped[0].name === 'No.png' && rz.skipped[0].why === 'immagine troppo grande (101 byte)', 'zip: limite per voce esatto ' + JSON.stringify(rz.skipped));
      } finally { L.image = saved; }
    }
    // limiti in dettaglio: confini esatti e messaggi
    { const L = C.LIMITS, saved = Object.assign({}, L);
      const restore = () => Object.assign(L, saved);
      try {
        L.entries = 3;
        let r = await new C.Covers().addFile('x.zip', zip([['A (1).png', png(10, 10, 1)], ['B (1).png', png(10, 10, 2)]]));
        ok(r.errors.length === 0 && r.added === 2, 'voci: zip + 2 immagini = 3 voci, entro il limite (' + JSON.stringify(r.errors) + ')');
        r = await new C.Covers().addFile('x.zip', zip([['A (1).png', png(10, 10, 1)], ['B (1).png', png(10, 10, 2)], ['C (1).png', png(10, 10, 3)]]));
        ok(r.errors.length === 1 && r.errors[0] === 'x.zip: troppe voci (oltre 3)', 'voci: una oltre il limite -> «x.zip: troppe voci (oltre 3)» (' + JSON.stringify(r.errors) + ')');
        restore();
        L.budget = 3 * 200;
        const mk = (k) => zip(Array.from({length: k}, (_, i) => ['B' + i + ' (1).png', png(10, 10, 200 - 33)]));
        r = await new C.Covers().addFile('b.zip', mk(3));
        ok(r.errors.length === 0 && r.added === 3, 'budget: esattamente 600 byte estratti passano (' + JSON.stringify(r.errors) + ')');
        r = await new C.Covers().addFile('b.zip', mk(4));
        ok(r.errors.length === 1 && /^b\.zip: limite di byte estratti superato \(0 MB\)$/.test(r.errors[0]), 'budget: oltre il limite (' + JSON.stringify(r.errors) + ')');
        restore();
        L.budget = 512 << 20;
        restore();
        L.covers = 2;
        r = await new C.Covers().addFile('c.zip', zip([['A (1).png', png(10, 10, 1)], ['B (1).png', png(10, 10, 2)]]));
        ok(r.added === 2 && r.errors.length === 0, 'copertine: esattamente al tetto passano');
        r = await new C.Covers().addFile('c.zip', zip([['A (1).png', png(10, 10, 1)], ['B (1).png', png(10, 10, 2)], ['C (1).png', png(10, 10, 3)]]));
        ok(r.added === 2 && r.errors.length === 1 && r.errors[0] === 'c.zip: troppe copertine (oltre 2)', 'copertine: oltre il tetto (' + JSON.stringify(r.errors) + ')');
        restore();
        L.total = 3 * 200;
        const cv = new C.Covers();
        r = await cv.addFile('t.zip', zip(Array.from({length: 3}, (_, i) => ['T' + i + ' (1).png', png(10, 10, 200 - 33)])));
        ok(r.added === 3 && cv.bytes === 600 && r.errors.length === 0, 'memoria: esattamente al tetto passa (' + cv.bytes + ')');
        r = await cv.addFile('u.png', png(10, 10, 1));
        ok(r.added === 0 && r.errors.length === 1 && /^u\.png: copertine oltre il limite di memoria \(0 MB\)$/.test(r.errors[0]), 'memoria: un byte oltre il tetto (' + JSON.stringify(r.errors) + ')');
        restore();
        L.inner = 100;
        r = await new C.Covers().addFile('i.zip', zip([['in.zip', new Uint8Array(100).fill(7)]]));
        ok(!r.skipped.some((x) => x.why === 'zip troppo grande'), 'zip annidato: esattamente al limite non e\' troppo grande');
        r = await new C.Covers().addFile('i.zip', zip([['in.zip', new Uint8Array(101).fill(7)]]));
        eqj(r.skipped, [{name: 'in.zip', why: 'zip troppo grande'}], 'zip annidato di 101 byte: troppo grande');
        restore();
      } finally { restore(); }
      // limiti con i valori veri: i messaggi dicono i MB giusti
      const msgs = [];
      const L2 = C.LIMITS, sv = Object.assign({}, L2);
      try {
        L2.budget = 1 << 20; L2.inner = 1 << 30; L2.image = 1 << 30;
        const r = await new C.Covers().addFile('m.zip', zip([['A (1).png', png(10, 10, 600000)], ['B (1).png', png(10, 10, 600000)]]));
        ok(r.errors.length === 1 && r.errors[0] === 'm.zip: limite di byte estratti superato (1 MB)', 'messaggio budget in MB (' + r.errors[0] + ')');
        L2.budget = sv.budget; L2.total = 1 << 20;
        const r2 = await new C.Covers().addFile('m.zip', zip([['A (1).png', png(10, 10, 600000)], ['B (1).png', png(10, 10, 600000)]]));
        ok(r2.errors.length === 1 && r2.errors[0] === 'm.zip: copertine oltre il limite di memoria (1 MB)', 'messaggio memoria in MB (' + r2.errors[0] + ')');
      } finally { Object.assign(L2, sv); }
    }
    // il punteggio piu' alto vince anche se il nome e' alfabeticamente dopo; cartella di un percorso con barra iniziale
    { const cv = new C.Covers();
      await cv.addFile('A (1982).png', png(10, 10, 1)); await cv.addFile('B (1981).png', png(10, 10, 2));
      ok(cv.forGame({title: 'A', year: '1981', name: 'A.bin'}).name === 'A (1982).png' && cv.forGame({title: 'C', name: 'C.bin'}) === null, 'solo il titolo uguale si abbina');
      const cv2 = new C.Covers();
      await cv2.addFile('G (1982)(Z).png', png(10, 10, 1)); await cv2.addFile('G (1981)(Y).png', png(10, 10, 2));
      await cv2.addFile('G (1980)(X).png', png(10, 10, 3));
      ok(cv2.forGame({title: 'G', year: '1981', name: 'G.bin'}).year === '1981', 'il punteggio piu\' alto vince anche se arriva in mezzo');
      ok(cv2.forGame({title: 'G', year: '1982', name: 'G.bin'}).year === '1982', 'il punteggio piu\' alto vince anche se arriva per primo');
      ok(cv2.forGame({title: 'G', year: '1980', name: 'G.bin'}).year === '1980', 'il punteggio piu\' alto vince anche se arriva per ultimo');
      const cv3 = new C.Covers();
      await cv3.addFile('/Box/Alfa.png', png(10, 10, 1));
      eqj([cv3.get(1).folder, cv3.get(1).role], ['Box', 'box'], 'percorso con barra iniziale: cartella Box');
      await cv3.addFile('Box/Beta.png', png(10, 10, 1)); await cv3.addFile('Box/', png(10, 10, 1));
      eqj(cv3.get(2).folder, 'Box', 'cartella di un percorso semplice');
    }
    // l'avanzamento ogni 16 voci e il conteggio delle voci visitate
    { const cv = new C.Covers();
      const seen = [];
      const r = await cv.addFile('v.zip', zip(Array.from({length: 33}, (_, i) => ['V' + i + ' (1).png', png(10, 10, i + 1)])), {onProgress: (n) => seen.push(n)});
      eqj(seen, [16, 32], 'avanzamento a 16 e 32');
      eqj([r.visited, r.added], [34, 33], 'voci visitate: lo zip piu\' 33 immagini');
      const r2 = await new C.Covers().addFile('solo.png', png(10, 10));
      eqj(r2.visited, 1, 'voci visitate: un file');
    }
  }

  finished = true;
  console.log((fails ? 'FALLITO' : 'OK') + ' (' + checks + ' controlli)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERRORE ' + (e && e.stack || e)); process.exit(1); });
