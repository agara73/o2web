'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// console.js - console Odyssey 2 / Videopac G7000 (G7200): CPU 8048 + BIOS + cartuccia + RAM esterna + chip video 8244/8245
// (vdc.js) + tastiera e joystick. BIOS, cartuccia e set di caratteri sono PARAMETRI (li porta l'utente: nessuno e' nel codice).
// Implementa l'interfaccia "ambiente" della CPU (vedi cpu8048.js). Codice originale; i fatti sull'hardware (mappe, collegamenti,
// codifica della tastiera) sono quelli di hw/o2line.py, ricavati da documentazione e sorgenti di altri emulatori letti come
// documentazione e dai dump: tutti DA VERIFICARE finche' non confermati (o2web-stato.md).
//
// Memoria programma (4 KB):  0x000-0x3FF BIOS (1 KB);  0x400-0xFFF cartuccia (schemi in cartmap.js: banchi da 2 KB scelti da
//   P1 & (banchi - 1) per 2, 4 e 8 KB con 0xC00-0xFFF specchio di 0x800-0xBFF; 4 KB lineare; 16 KB 'rally' (8 banchi con latch MOVX) e 12 KB
//   (parte alta di una finestra da 16 KB); altre dimensioni oltre 8 KB non supportate).
// MOVX (indirizzo a 8 bit): P1 bit 4 = 0 e A7 = 0 -> RAM 6810 da 128 byte; P1 bit 3 = 0 -> registri del chip video;
//   P1 bit 6 = 1 blocca le scritture sulla RAM (non sul chip video). P1 bit 2 = 0 abilita la tastiera: P2 bit 0-2 sceglie la riga e
//   il 74148 restituisce su P2 bit 5-7 la colonna; con la riga 0 o 1 i joystick 0 e 1 sono sul BUS (bit 0 su, 1 destra, 2 giu',
//   3 sinistra, 4 fuoco; premuto = 0).
// G7400 (Videopac+, tappa 5, opts.g7400 = true): con P1 bit 5 = 0 il MOVX parla con la coppia EF9340/41 (ef934x.js, accessi: indirizzo
//   bit 0 = B/A, bit 1 = C/T, bit 2 = lettura). I registri di mix sono i latch dell'8243: P5 (nibble basso) + P4 (alto) = mix del
//   segnale EF (pilota CX e luminosita' EF), P7 (basso) + P6 (alto) = mix dell'8245 (l'ordine dei nibble e' quello giusto dal 15/10/2026:
//   con quello vecchio, P4 basso e P5 alto, Trans American Rally mostrava solo il fondo dell'8245; coincide con MAME, vedi o2web-stato.md); P1 bit 7 = 0 aggiunge la luminosita' all'8245. Dopo ogni riga dell'8245 (hook
//   postLine del chip video) la riga si mescola con quella dell'EF9341 (spostamento 15 pixel e 5 righe) e si calcolano le collisioni CX.
//   Il pin B della cartuccia (opts.cartBHigh) non e' nel dump. Tutto DA VERIFICARE (vedi hw/ef934x_ref.py).
// Tempo: sync() applica agli istanti giusti gli eventi video (righe, vblank) e i cambi di livello di T1 (modo contatore).
//
// Stato serializzabile (snapshot): saveState() / loadState(). Contiene SOLO stato (CPU, chip video, RAM, indice degli eventi) e le
// impronte SHA-256 di BIOS, cartuccia e set di caratteri; mai il loro contenuto. loadState rifiuta uno stato di un altro BIOS o
// di un'altra cartuccia (e avverte se il set di caratteri e' diverso: le collisioni dipendono dai glifi).

const {CPU8048} = require('./cpu8048.js');
const {Vdc, VIS_W, VIS_H} = require('./vdc.js');
const {EfPair, mixLine, cxCollisions, ROM_SIZE: EF_ROM_SIZE} = require('./ef934x.js');
const {sha256} = require('./sha256.js');
const {analyzeCart, cartOffset, layoutCart} = require('./cartmap.js');
const {ChessModule, ROM_SIZE: CHESS_ROM_SIZE} = require('./chessmod.js');

const STATE_FORMAT = 'o2web-snapshot';
const STATE_VERSION = 4;                      // 2: aggiunge lo stato del suono nel chip video; 3: G7400 (EF9340/41, pin B); 4: modulo scacchi C7010; si caricano anche gli stati di versione 1, 2 e 3
const STATE_VERSIONS_OK = [1, 2, 3, 4];

// 74148: bit 5-7 = zeri iniziali della riga (bit 7 = priorita' piu' alta), bit 4 = 0 se c'e' un tasto
function keyCode(row8) {
  if (row8 === 0) return 0xFF;
  let lz = 0;
  while (!(row8 & (0x80 >> lz))) lz++;
  return (lz << 5) | 0x0F;
}

class SnapshotError extends Error {}

class Console {
  // opts: {bios: Uint8Array (1024), cart: Uint8Array | null, charset: Uint8Array (512), standard: 'PAL' | 'NTSC',
  //        g7400: boolean, efRom: Uint8Array (2560, solo G7400), cartBHigh: boolean (pin B della cartuccia, solo G7400),
  //        chessRom: Uint8Array (8192, ROM dello Z80 del modulo scacchi C7010; la cartuccia `cart` e' la sua ROM da 2 KB)}
  constructor(opts) {
    const bios = opts.bios;
    if (!bios || bios.length < 1) throw new Error('manca il BIOS');
    this.bios = new Uint8Array(0x400).fill(0xFF);
    this.bios.set(bios.subarray(0, 0x400));
    this.cart = null;
    if (opts.cart && opts.cart.length) {
      const n = Math.ceil(opts.cart.length / 0x800);
      this.cart = new Uint8Array(n * 0x800).fill(0xFF);
      this.cart.set(opts.cart);
      this.cart = layoutCart(this.cart);              // 12 KB: parte alta di una finestra da 16 KB (cartmap.js)
    }
    this.cartBank = 0;                            // latch del banco delle cartucce 'rally' (16 KB)
    this.cartInfo = analyzeCart(this.cart);       // {kind, banks, mask, ok, reason}: schema di mappa (cartmap.js)
    this.bankMask = this.cartInfo.mask;
    this.std = opts.standard || 'PAL';
    this.vdc = new Vdc(opts.charset, this.std);
    this.g7400 = !!opts.g7400;
    this.cartBHigh = !!opts.cartBHigh;
    this.ef = null;
    if (this.g7400) {
      if (!opts.efRom || opts.efRom.length !== EF_ROM_SIZE) throw new Error('manca il set di caratteri dell\'EF9341 (2560 byte)');
      this.ef = new EfPair(opts.efRom);
      this.efLine = new Uint8Array(320);
      this.cxLine = new Uint8Array(VIS_W);
      this.vdc.postLine = (j, fb, cmap) => this.mixRow(j, fb, cmap);
    }
    this.chess = null;
    if (opts.chessRom) {
      if (this.g7400) throw new Error('il modulo scacchi C7010 e\' per il G7000 / G7200, non per il G7400');
      this.chess = new ChessModule(opts.chessRom, this.std);
    }
    this.t = this.vdc.t;
    this.xram = new Uint8Array(0x80);
    this.keyRows = new Uint8Array(8);
    this.joy = new Uint8Array(2);
    this.cpu = new CPU8048(this);
    this.hashes = {
      bios: sha256(opts.bios), cart: opts.cart && opts.cart.length ? sha256(opts.cart) : '', charset: sha256(opts.charset),
    };
    if (this.g7400) this.hashes.efrom = sha256(opts.efRom);
    if (this.chess) this.hashes.chess = sha256(opts.chessRom);
    this.reset();
  }

  // (editor dei caratteri) sostituisce il set in uso SENZA toccare lo stato della macchina: da qui in poi le righe disegnate usano i glifi nuovi.
  // Le impronte dello stato si aggiornano, cosi' uno stato salvato dopo porta quella giusta.
  replaceCharset(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 512) throw new Error('il set di caratteri deve essere di 512 byte');
    this.vdc.charset.set(bytes);
    this.hashes.charset = sha256(bytes);
  }
  replaceEfRom(bytes) {
    if (!this.g7400) throw new Error('la ROM dei caratteri dell\'EF9341 serve solo al G7400');
    if (!(bytes instanceof Uint8Array) || bytes.length !== EF_ROM_SIZE) throw new Error('la ROM dei caratteri EF9341 deve essere di 2560 byte');
    this.ef.rom.set(bytes);
    this.hashes.efrom = sha256(bytes);
  }

  reset() {
    this.cpu.reset();
    this.vdc.reset();
    this.cartBank = 0;
    if (this.ef) this.ef.reset();
    if (this.chess) this.chess.reset();
    this.xram.fill(0);
  }

  // G7400: mescola la riga j dell'8245 (indici in fb) con la linea di teletext, poi le collisioni CX (ritorna bit 0-7 e 0x100 se contatto)
  mixRow(j, fb, cmap) {
    const ef = this.ef, c = this.cpu, e = c.exp;
    if (j === 0) ef.frameTick();
    const tl = j - ef.offsetY;
    let line = null;
    if (tl >= 0) { ef.renderLine(tl, this.efLine); line = this.efLine; }
    mixLine(fb.subarray(j * VIS_W, (j + 1) * VIS_W), line, ef.offsetX, e[3] | (e[2] << 4), e[1] | (e[0] << 4), this.cartBHigh,
      !(c.p1 & 0x80), this.cxLine);
    return cxCollisions(cmap, this.cxLine, this.vdc.reg[0xA2]);
  }

  // Tasto RESET della macchina (DA VERIFICARE su hardware vero: qui azzera SOLO l'8048, come il pin RESET). Il PC torna a 0 (menu del
  // BIOS, la cartuccia resta inserita), le porte tornano a 0xFF (la cartuccia riparte dall'ultimo banco), timer e interrupt si
  // fermano. Restano com'erano: il tempo (il raggio del video continua), il chip video con i suoi registri, la RAM esterna, e della
  // CPU la RAM interna e il latch dell'espansore 8243 (un reset non cancella le RAM).
  resetButton() {
    const c = this.cpu;
    const now = c.now, ram = Uint8Array.from(c.ram), exp = Uint8Array.from(c.exp), t1Prev = c.t1Prev;
    c.reset();
    c.ram.set(ram);
    c.exp.set(exp);
    c.now = now;
    c.t1Prev = t1Prev;
  }

  get fb() { return this.vdc.fb; }
  get frameCycles() { return Math.floor(this.t.frame / this.t.dpc); }
  // cicli macchina al secondo (DA VERIFICARE): PAL 17,734475 MHz / 45 = 394099; NTSC 3,579545 MHz / 10 = 357954. Frequenza di quadro =
  // cyclesPerSecond / (frame / dpc): PAL 49,7 Hz, NTSC 59,8 Hz.
  get cyclesPerSecond() { return this.t.ntsc ? 3579545 / 10 : 17734475 / 45; }

  // esegue istruzioni finche' non e' stato disegnato un altro fotogramma completo (riga 242); ritorna il numero del fotogramma
  runFrame() {
    const v = this.vdc, cpu = this.cpu;
    const target = v.frameDone + 1;
    while (v.frameDone < target) cpu.step();
    return v.frameDone;
  }

  runCycles(n) { this.cpu.runUntil(this.cpu.now + n); }

  // ------------------------------------------------------------------ interfaccia dell'ambiente della CPU
  readProg(a) {
    a &= 0xFFF;
    if (a < 0x400) return this.bios[a];
    return this.cart ? this.cart[cartOffset(this.cartInfo, this.cpu.p1, a, this.cartBank)] : 0xFF;
  }

  // applica gli eventi scaduti (<= cpu.now): eventi video, di suono e cambi di livello di T1, nell'ordine del tempo (a parita': video,
  // poi suono, poi T1)
  sync(cpu) {
    const v = this.vdc, now = cpu.now;
    for (;;) {
      const cv = v.nextEv, cs = v.nextSnd, ct = v.nextT1;
      if (cv <= cs && cv <= ct) {
        if (cv > now) break;
        v.event();
      } else if (cs <= ct) {
        if (cs > now) break;
        v.sndEvent();
      } else {
        if (ct > now) break;
        cpu.t1Changed(v.t1Pop());
      }
    }
    if (this.chess) this.chess.advance(now, cpu.p1);      // modulo scacchi: lo Z80 raggiunge il tempo dell'8048
  }

  intActive() { this.sync(this.cpu); return this.vdc.irq ? 1 : 0; }
  t0() { return 0; }
  t1() { return this.vdc.t1At(this.cpu.now); }
  p1Pin() { return 0xFF; }
  p2Pin() {
    const c = this.cpu;
    let d = 0xFF;
    if (!(c.p1 & 0x04)) {
      const code = keyCode(this.keyRows[c.p2 & 7]);
      if (code !== 0xFF) d &= code;
    }
    return d;
  }
  busPin() {
    const c = this.cpu;
    let d = 0xFF;
    if (!(c.p1 & 0x04)) {
      const sel = c.p2 & 7;
      if (sel < 2) d &= ~this.joy[sel] & 0xFF;
    }
    return d;
  }
  movxRead(a) {
    a &= 0xFF;
    this.sync(this.cpu);
    const c = this.cpu;
    let d = 0xFF;
    if (!(c.p1 & 0x10) && !(a & 0x80)) d &= this.xram[a];
    if ((c.p1 & 0x48) === 0) d &= this.vdc.read(a, c.now);
    if (this.ef && !(c.p1 & 0x20)) d &= this.ef.access(a, 0, false);
    if (this.chess) d &= this.chess.read8048(a, c.p1);
    // ROM dati della cartuccia 'linear' (DA VERIFICARE, ipotesi ricavata dal codice di 4 in 1 Row): P2 (bit 0-3) e' il byte alto
    // dell'indirizzo; risponde quando ne' la RAM ne' il chip video sono in lettura
    if (this.cartInfo.kind === 'linear' && ((c.p1 & 0x10) || (a & 0x80)) && (c.p1 & 0x48) !== 0) {
      d &= this.cart[((c.p2 & 0x0F) << 8) | a];
    }
    return d;
  }
  movxWrite(a, v) {
    a &= 0xFF;
    v &= 0xFF;
    this.sync(this.cpu);
    const c = this.cpu;
    if (!(c.p1 & 0x40)) {
      if (!(c.p1 & 0x10) && !(a & 0x80)) this.xram[a] = v;
    }
    // latch del banco (DA VERIFICARE): A7 = 1, P1 bit 4 = 0 e P1 bit 3 = 1 (chip video NON selezionato). Neutron Star scrive il registro 0xA0 del
    // chip video con P1 bit 4 = 0 e bit 3 = 0: non e' un cambio di banco (15/10/2026)
    if (this.cartInfo.kind === 'rally' && (a & 0x80) && !(c.p1 & 0x10) && (c.p1 & 0x08)) this.cartBank = v & 7;
    if (!(c.p1 & 0x08)) this.vdc.write(a, v, c.now);
    if (this.ef && !(c.p1 & 0x20)) this.ef.access(a, v, true);
    if (this.chess) this.chess.write8048(a, v, c.p1);
  }

  // ------------------------------------------------------------------ stato serializzabile
  saveState() {
    const s = {format: STATE_FORMAT, version: STATE_VERSION, standard: this.std, hashes: Object.assign({}, this.hashes),
      cpu: this.cpu.saveState(), vdc: this.vdc.saveState(), xram: Array.from(this.xram)};
    if (this.g7400) { s.g7400 = true; s.pinB = this.cartBHigh ? 1 : 0; s.ef = this.ef.saveState(); }
    if (this.chess) s.chess = this.chess.saveState();
    return s;
  }

  // ritorna la lista degli avvisi (stringhe); lancia SnapshotError se lo stato non e' di questo BIOS / questa cartuccia / standard
  loadState(s) {
    if (!s || s.format !== STATE_FORMAT) throw new SnapshotError("Il file non e' uno stato di gioco di questo emulatore.");
    if (!STATE_VERSIONS_OK.includes(s.version)) throw new SnapshotError('Versione dello stato non supportata: ' + s.version + '.');
    if (!s.hashes || s.hashes.bios !== this.hashes.bios) throw new SnapshotError("Lo stato e' stato salvato con un altro BIOS.");
    if (s.hashes.cart !== this.hashes.cart) throw new SnapshotError("Lo stato e' stato salvato con un'altra cartuccia.");
    if (s.standard !== this.std) throw new SnapshotError("Lo stato e' stato salvato con lo standard video " + s.standard + ".");
    const stG7400 = s.g7400 === true;
    if (s.g7400 !== undefined && s.g7400 !== true && s.g7400 !== false) throw new SnapshotError('Stato non valido: tipo di macchina.');
    if (stG7400 !== this.g7400) throw new SnapshotError(stG7400 ? "Lo stato e' di un Videopac+ G7400: serve il BIOS G7400." : "Lo stato e' di un G7000 / Odyssey 2, non di un G7400.");
    if ((s.chess !== undefined) !== (this.chess !== null)) {
      throw new SnapshotError(this.chess ? "Lo stato e' di una console senza il modulo scacchi C7010." : "Lo stato e' di una console con il modulo scacchi C7010.");
    }
    if (this.chess && s.hashes.chess !== this.hashes.chess) throw new SnapshotError("Lo stato e' stato salvato con un'altra ROM del modulo scacchi.");
    if (!Array.isArray(s.xram) || s.xram.length !== 0x80) throw new SnapshotError('Stato non valido: RAM esterna.');
    const xram = s.xram.map((v) => {
      if (!Number.isInteger(v) || v < 0 || v > 255) throw new SnapshotError('Stato non valido: RAM esterna.');
      return v;
    });
    // convalida prima di toccare qualcosa: si prova su copie
    try {
      const probeCpu = new CPU8048(null);
      probeCpu.loadState(s.cpu);
      const probeVdc = new Vdc(new Uint8Array(512), this.std);
      probeVdc.loadState(s.vdc);
      if (this.g7400) new EfPair(new Uint8Array(EF_ROM_SIZE)).loadState(s.ef);
      if (this.chess) new ChessModule(new Uint8Array(CHESS_ROM_SIZE), this.std).loadState(s.chess, probeCpu.now);
      if (this.g7400 && s.pinB !== 0 && s.pinB !== 1) throw new Error('pin B');
      // coerenza dei tempi: un indice di evento molto lontano dal tempo della CPU farebbe girare sync() quasi all'infinito
      const lim = 3 * this.frameCycles;
      if (Math.abs(probeVdc.nextEv - probeCpu.now) > lim || Math.abs(probeVdc.nextT1 - probeCpu.now) > lim ||
        (!probeVdc.legacySound && Math.abs(probeVdc.nextSnd - probeCpu.now) > lim)) {
        throw new Error('tempo della CPU e del chip video incoerenti');
      }
    } catch (e) {
      throw new SnapshotError('Stato non valido (' + e.message + ').');
    }
    this.cpu.loadState(s.cpu);
    this.vdc.loadState(s.vdc);
    if (this.vdc.legacySound) {                      // stato di versione 1 (senza suono): si riparte dal primo evento di suono utile
      this.vdc.legacySound = false;
      this.vdc.alignSound(this.cpu.now);
    }
    this.xram.set(xram);
    if (this.chess) this.chess.loadState(s.chess, this.cpu.now);
    const warnings = [];
    if (this.g7400) {
      this.ef.loadState(s.ef);
      if (s.hashes.efrom !== this.hashes.efrom) warnings.push("Il set di caratteri dell'EF9341 e' diverso da quello dello stato salvato: cambia solo l'aspetto del testo.");
      if ((s.pinB === 1) !== this.cartBHigh) warnings.push('Il pin B della cartuccia e\' diverso da quello dello stato salvato: cambia il modo in cui si mescolano testo e grafica.');
    }
    if (s.hashes.charset !== this.hashes.charset) {
      warnings.push("Il set di caratteri e' diverso da quello dello stato salvato: le collisioni potrebbero differire.");
    }
    return warnings;
  }

  // snapshot <-> byte (file di testo UTF-8 con JSON): per il download si usa TextEncoder + Blob, per il caricamento TextDecoder
  static encodeState(state) { return new TextEncoder().encode(JSON.stringify(state)); }
  static decodeState(bytes) {
    try {
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    } catch (e) {
      throw new SnapshotError("Il file non e' uno stato di gioco leggibile.");
    }
  }
}

module.exports = {Console, SnapshotError, keyCode, VIS_W, VIS_H, STATE_FORMAT, STATE_VERSION};
