'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// chessmod.js - modulo scacchi Philips C7010 (Videopac, 1982, solo Europa): un secondo computer dentro la cartuccia. Una CPU Z80
// (NSC800) con la sua ROM da 8 KB e 2 KB di RAM che parla con l'8048 della console attraverso DUE latch da 8 bit; la ROM da 2 KB
// vista dall'8048 e' una cartuccia normale (schema 'std' con un solo banco, console.js). La ROM da 8 KB la porta l'utente (e'
// un ingresso come il BIOS: mai nel codice ne' nei pacchetti). Codice originale; i fatti sull'hardware vengono dalla lettura del
// sorgente di MAME (src/devices/bus/odyssey2/chess.cpp) come documentazione e sono TUTTI DA VERIFICARE:
//   - mappa della CPU del modulo: 0x0000-0x1FFF ROM; 0xE000-0xFFFF RAM da 2 KB con specchio (maschera 0x1800: 0xE000-0xE7FF ripetuta
//     quattro volte); il resto non risponde (si legge 0xFF); vettore di reset 0x0000;
//   - porte della CPU del modulo: una sola porta, specchiata su tutti gli indirizzi; IN legge il latch 1 (scritto dalla console),
//     OUT scrive il latch 0 (letto dalla console);
//   - lato console (8048): P1 bit 1 = reset del modulo (0 = in reset, 1 = libera); i latch rispondono solo con P1 bit 0 = 0, P1 bit
//     4 = 0 E P1 bit 3 = 1 (chip video NON selezionato; l'ultima condizione NON viene dalla fonte letta: l'ha imposta la prova con le
//     ROM vere, il 17/10/2026: la cartuccia scrive il registro di controllo 0xA0 del chip video con P1 = 0xE6 (bit 0 e 4 a zero) in
//     ogni interrupt, e senza questa condizione quella scrittura entra nel latch 1 e il modulo non capisce piu' i comandi); MOVX in
//     lettura con (indirizzo & 0xA0) == 0xA0 legge il latch 0 (altrimenti il bus resta 0xFF), MOVX in scrittura con indirizzo & 0x80
//     scrive il latch 1. Non ci sono altri segnali di sincronia;
//   - velocita': la scheda ha il suo quarzo da 17,734475 MHz / 4 = 4,43361875 MHz (come il quarzo PAL; il valore del quarzo viene dal
//     sorgente di MAME ed e' DA VERIFICARE). L'NSC800 divide per due la frequenza del suo oscillatore (datasheet National Semiconductor
//     NSC800: «The chip operation frequency is equal to one half of the frequency of this oscillator»; l'utente l'ha confermato il
//     17/10/2026), quindi la CPU gira a 2,2168 MHz: SPEED sotto. Il solo dato non confermato da un documento e' il valore del quarzo;
//   - valore iniziale dei latch e della RAM (qui 0: indefiniti sul chip vero); i latch non si azzerano con il reset della CPU.
//
// Tempo. L'8048 e' il padrone del tempo (console.js): a ogni confine fra istruzioni (e prima di ogni MOVX) la console chiama
// advance(now, p1) e il modulo porta lo Z80 al tempo equivalente, con un accumulatore esatto in interi (nessuna deriva): per ogni
// ciclo macchina dell'8048 passano NUM / DEN stati T dello Z80 (PAL 45 / 8 = 5,625; NTSC 17734475 / 2863636 circa 6,19). Lo
// Z80 si ferma sull'istruzione che supera il bersaglio (al piu' qualche decina di T di anticipo, mai un T perso). Il segnale di
// reset vale per l'intervallo trascorso con il VECCHIO valore di P1, e cambia al confine: un fronte 1 -> 0 e un fronte 0 -> 1 si
// vedono quindi con la risoluzione di un'istruzione dell'8048.
//
// Stato serializzabile: saveState() / loadState() (solo stato: la ROM non entra mai).

const {Z80} = require('./z80.js');

const ROM_SIZE = 0x2000;
const RAM_SIZE = 0x800;
// cancello dei latch sulla porta P1 dell'8048: bit 0 = 0, bit 3 = 1 (chip video non selezionato), bit 4 = 0 (DA VERIFICARE, vedi sopra)
const GATE_MASK = 0x19;
const GATE_VALUE = 0x08;
// stati T dello Z80 per ciclo macchina dell'8048: la CPU gira a meta' del quarzo (17734475/8 Hz); PAL: 17734475/45 cicli/s dell'8048 ->
// 45/8; NTSC: 3579545/10 cicli/s -> (17734475/8) / (3579545/10) = 17734475/2863636 (frazione ridotta)
const SPEED = {PAL: [45, 8], NTSC: [17734475, 2863636]};

class ChessModule {
  constructor(rom, standard) {
    if (!(rom instanceof Uint8Array) || rom.length !== ROM_SIZE) throw new Error('la ROM del modulo scacchi deve essere di 8192 byte');
    this.rom = rom;
    this.ram = new Uint8Array(RAM_SIZE);
    const sp = SPEED[standard === 'NTSC' ? 'NTSC' : 'PAL'];
    this.num = sp[0];
    this.den = sp[1];
    this.cpu = new Z80(this);
    this.reset();
  }

  // accensione della macchina: CPU in reset, RAM e latch a 0, tempo a 0
  reset() {
    this.cpu.reset();
    this.ram.fill(0);
    this.latch0 = 0;                   // scritto dallo Z80, letto dall'8048
    this.latch1 = 0;                   // scritto dall'8048, letto dallo Z80
    this.frac = 0;                     // resto dell'accumulatore (0 .. den - 1)
    this.target = 0;                   // stati T dello Z80 che dovrebbero essere trascorsi
    this.lastNow = 0;                  // tempo dell'8048 (cicli macchina) dell'ultima chiamata
    this.running = 0;                  // 1 se il reset e' stato rilasciato (P1 bit 1 = 1) all'ultima chiamata
  }

  // ---- bus dello Z80 (interfaccia della CPU)
  read(a) {
    if (a < ROM_SIZE) return this.rom[a];
    if (a >= 0xE000) return this.ram[a & 0x7FF];
    return 0xFF;
  }
  write(a, v) {
    if (a >= 0xE000) this.ram[a & 0x7FF] = v;
  }
  in() { return this.latch1; }
  out(port, v) { this.latch0 = v & 0xFF; }

  // ---- bus della console (8048): a = indirizzo MOVX a 8 bit, p1 = valore della porta P1
  read8048(a, p1) {
    if ((p1 & GATE_MASK) === GATE_VALUE && (a & 0xA0) === 0xA0) return this.latch0;
    return 0xFF;
  }
  write8048(a, v, p1) {
    if ((p1 & GATE_MASK) === GATE_VALUE && (a & 0x80)) this.latch1 = v & 0xFF;
  }

  // porta lo Z80 al tempo `now` (cicli macchina dell'8048). p1 = valore di P1 DOPO l'ultima istruzione; per l'intervallo trascorso
  // vale lo stato del reset registrato alla chiamata precedente.
  advance(now, p1) {
    const dt = now - this.lastNow;
    if (dt > 0) {
      this.frac += dt * this.num;
      const adv = Math.floor(this.frac / this.den);
      this.frac -= adv * this.den;
      this.target += adv;
      this.lastNow = now;
    }
    if (this.running) this.cpu.runUntil(this.target);
    else this.cpu.t = this.target;
    const run = (p1 & 0x02) ? 1 : 0;
    if (run !== this.running) {          // fronte del reset: la CPU riparte dal vettore 0 (o si ferma) a questo istante
      this.cpu.reset();
      this.cpu.t = this.target;
      this.running = run;
    }
  }

  // ---- stato serializzabile
  saveState() {
    return {cpu: this.cpu.saveState(), ram: Array.from(this.ram), latch0: this.latch0, latch1: this.latch1, frac: this.frac,
      target: this.target, lastNow: this.lastNow, running: this.running};
  }

  // convalida TUTTO prima di toccare qualcosa; `cpuNow` = tempo della CPU 8048 dello stesso stato (coerenza dei tempi)
  loadState(s, cpuNow) {
    const chk = (v, lo, hi, name) => {
      if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('stato non valido: ' + name);
      return v;
    };
    if (!s || !Array.isArray(s.ram) || s.ram.length !== RAM_SIZE) throw new Error('stato non valido: RAM del modulo scacchi');
    const ram = s.ram.map((v) => chk(v, 0, 255, 'RAM del modulo scacchi'));
    const n = {
      latch0: chk(s.latch0, 0, 255, 'latch 0'), latch1: chk(s.latch1, 0, 255, 'latch 1'), frac: chk(s.frac, 0, this.den - 1, 'resto del tempo'),
      target: chk(s.target, 0, Number.MAX_SAFE_INTEGER, 'tempo del modulo'), lastNow: chk(s.lastNow, 0, Number.MAX_SAFE_INTEGER, 'tempo dell\'8048'),
      running: chk(s.running, 0, 1, 'reset del modulo'),
    };
    // coerenza: l'ultima chiamata e' di pochi cicli prima del tempo della CPU, lo Z80 e' vicino al suo bersaglio
    if (Number.isInteger(cpuNow) && (n.lastNow > cpuNow || cpuNow - n.lastNow > 16)) throw new Error('stato non valido: tempi del modulo e della console incoerenti');
    const probe = new Z80(null);
    probe.loadState(s.cpu);
    if (n.running ? Math.abs(probe.t - n.target) > 64 : probe.t !== n.target) throw new Error('stato non valido: tempo dello Z80 incoerente');
    this.cpu.loadState(s.cpu);
    this.ram.set(ram);
    Object.assign(this, n);
  }
}

module.exports = {ChessModule, ROM_SIZE, RAM_SIZE, SPEED, GATE_MASK, GATE_VALUE};
