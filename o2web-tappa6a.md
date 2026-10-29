# O2web - Tappa 6a: Modulo scacchi Philips C7010 (brief per la nuova chat)

(c) 2026 by Agara73 - documento di lavoro del progetto O2web (GPL-3.0 per il codice). Preparato il 17/10/2026.
Leggere prima `o2web-stato.md` (decisioni, fatti verificati, regole) e la sezione «Tappa 6a» in fondo; questo file la completa.

## 1. Obiettivo
Far giocare a scacchi con il **C7010 Chess Module** (Videopac, 1982, solo Europa): la console G7000 / G7200 (8048) parla con un secondo computer
sulla scheda del modulo (**NSC800, compatibile Z80**). Serve un nucleo Z80 originale, il modulo con i due latch sul bus della console,
il riconoscimento dei due file nella pagina, lo stato salvabile e i test. Tappa chiusa solo con tutta la batteria verde (regola 6 del progetto).

## 2. File dell'utente (verificati il 17/10/2026; MAI nel pacchetto, nel repository, nello zip o nell'HTML)
| File | Byte | CRC-32 | SHA-1 | MD5 |
|---|---|---|---|---|
| `vp_c7010.bin` (ROM lato console, vista dall'8048) | 2048 | 77066338 | 7162359313f66fe759bdd8a34755a5f62f3cadfb | 78604f22cacfa1a7f3d5bfd1e7e75b3f |
| `z80_c7010.bin` (ROM del modulo, vista dallo Z80) | 8192 | 45080245 | fff3e6449a0e82e8e4ff45e5830c98fc38a8848e | 8f5ddd6a41508888036588fa7f0751bd |

I valori attesi vengono dall'elenco software di MAME `hash/videopac.xml`, voce `chess` (seriale C7010, slot `o2_chess`); l'utente ha caricato
`chess.zip` con i due file e le impronte coincidono. Nel sandbox della sessione precedente: `scratchpad/chess2/z80rom.bin` (se la sessione e'
nuova, chiedere di ricaricare lo zip: e' tra i file dell'utente). Il vecchio `chess.zip` delle raccolte 0.202 / TOSEC / NonGood ha solo i 2 KB.
La ROM da 8 KB comincia con `F3 31 00 F9 CD 03 1D` (DI; LD SP,F900h; CALL 1D03h): e' codice Z80 vero; contiene testo ASCII (messaggi in olandese).
**Non sono state trovate** istruzioni `OUT (0),A` / `IN A,(0)` (D3 00 / DB 00): il programma usa la porta in altro modo (ad es. `OUT (C),A` / `IN A,(C)`) o con un altro numero: da capire sul codice.

## 3. Fatti sull'hardware (TUTTI DA VERIFICARE; fonte: lettura del sorgente MAME `src/devices/bus/odyssey2/chess.cpp` di hap, solo come documentazione, nessun codice copiato)
- NSC800 a **4,433619 MHz** (= il quarzo PAL 17,734475 MHz diviso 4), **ROM 8 KB, RAM 2 KB**. Motore: Gambiet di Wim Rens (versione 1980).
- **Mappa della CPU del modulo:** 0000-1FFF ROM (8 KB); E000-FFFF RAM 2 KB con specchio (maschera 0x1800: E000-E7FF ripetuta quattro volte). Vettore di reset 0000h.
- **Porte della CPU del modulo:** una sola porta (0x00) specchiata su tutti i 256 indirizzi. Lettura = latch 1 (scritto dalla console); scrittura = latch 0 (letto dalla console).
- **Lato console (8048):** P1 bit 1 (P11) = reset del modulo (0 = in reset, 1 = libera). I latch si vedono solo con **P10 = 0 e P14 = 0**.
  MOVX in lettura con `(indirizzo & 0xA0) == 0xA0` -> latch 0 (altrimenti 0xFF); MOVX in scrittura con `indirizzo & 0x80` -> latch 1.
  Lettura della ROM da 2 KB: due finestre (a 0x400 e a 0xC00), da confrontare con `cartmap.js` ('std' con un solo banco da 2 KB).
- **Rapporto di velocita':** nel progetto la console PAL fa 17734475/45 = 394099 cicli macchina 8048 al secondo (`console.cyclesPerSecond`).
  Il modulo ha il suo quarzo: 4433619 / 394099 = **11,25 cicli Z80 per ciclo macchina 8048** (esatto: 45/4) in PAL; in NTSC la console e' piu' lenta
  (357955 cicli/s) e il rapporto sale a circa 12,39. Il modulo era venduto solo in Europa: decidere se bloccare l'NTSC o usare il tempo reale (DA VERIFICARE / scelta).
- **Non documentato nelle fonti lette:** protocollo tra le due CPU (quali byte, quale handshake), politica di sincronizzazione di MAME (cicli per riga o per fotogramma),
  differenze NSC800-Z80 (interrupt RSTA/B/C, istruzioni extra). Il protocollo si ricava dal codice dell'8048 (ROM 2 KB) e dalla ROM Z80, non da un'altra fonte.
- Informazioni di contorno: il modulo e' un «piggyback» che si collega alla console tramite una cartuccia «dummy» (pagina odyssey2.info). Per l'emulazione le due ROM sono un'unica unita'.

## 4. Dove si aggancia nel codice (stato al 17/10/2026, dopo tappa 5d)
- `src/cartmap.js`: `analyzeCart` / `cartOffset` / `layoutCart` (schemi 'std', 'linear', 'rally', 'big'; il file da 2 KB = 'std' con 1 banco). Il modulo e' un nuovo tipo (es. `kind: 'chess'`) o un oggetto accanto alla cartuccia; `hw/o2line.py` ha la stessa logica in Python (l'oracolo): tenerli uguali.
- `src/console.js`: `movxRead(a)` / `movxWrite(a,v)` (bus esterno; qui si aggiungono i latch: P10 = P14 = 0 e le maschere di A7 / A5), `sync()`, `runCycles(n)`, `runFrame()`, `saveState()` / `loadState()` (STATE_VERSION 3: servira' la 4, accettando 1-3), `hashes` (impronte SHA-256 di BIOS / cartuccia, qui anche del secondo file), `this.cpu.p1` / `p2`. La CPU 8048 e' `src/cpu8048.js` (nessun indirizzo ne' registro della console dentro la CPU: stessa regola per lo Z80).
- Nuovo `src/z80.js` (nucleo, interfaccia piccola: `read(a)`, `write(a,v)`, `in(port)`, `out(port,v)`, `reset()`, `run(cycles)`, `saveState()/loadState()`) e `src/chessmod.js` (ROM, RAM, latch, reset, sincronizzazione).
- `src/library.js` / `src/app.js` / `src/session.js` / `src/ui.js`: riconoscimento nel «Aggiungi file» (anche dentro uno zip con i due file: abbinarli), avviso chiaro se manca la ROM da 8 KB, salvataggio / ripristino stato e sessioni, testi it + en (`src/lang_en.js`, `src/lang_en_dom.js`; regola: nucleo in italiano, tradotto ai bordi; `test/test_i18n.js` controlla i testi nuovi).
- Impronta di riconoscimento: CRC-32 + dimensione (come `charedit.identify`) per la ROM da 8 KB; non si usa il nome del file.

## 5. Piano (ordine consigliato)
1. **Z80 (`src/z80.js`).** Nucleo originale, tutte le istruzioni non documentate incluse se servono (flag X/Y). Riferimento indipendente per i test: pacchetto Python `z80` 1.2.0 (kosarev; `pip install z80 --break-system-packages`, cp313, solo in sviluppo, non distribuito) oppure un riferimento Python scritto da zero in `ref/refz80.py` come `ref/ref8048.py`. Test differenziale stato per stato: ogni opcode (anche CB, DD, ED, FD, DDCB, FDCB) con stati polarizzati, programmi casuali, memoria / porte finte, prova di mutazione (`test/mutate2.py` ha un esempio). Misurare i cicli (T-state) per istruzione.
2. **Modulo (`src/chessmod.js`).** ROM 8 KB, RAM 2 KB con specchi, due latch, reset da P11, cancello P10/P14, sincronizzazione col tempo dell'8048 (11,25 T per ciclo macchina). ROM di PROVA ORIGINALE scritta da noi (eco dei latch, test di RAM, specchi, reset): serve a collaudare il bus senza la ROM vera.
3. **Console.** Aggancio a `movxRead/movxWrite`, `saveState/loadState` (versione 4, retrocompatibile), impronte, `hw/o2line.py` / `hw/o2hw.py` aggiornati come oracolo del bus.
4. **Pagina.** Riconoscere le due ROM (anche in uno zip), avviso se manca la seconda, testi it / en, README e LEGGIMI (istruzioni per l'utente: dove si trova la ROM e come riconoscerla, senza scaricare nulla per lui).
5. **Prova con la ROM vera, solo in locale.** Avviare BIOS G7000 + `vp_c7010.bin` + `z80_c7010.bin`, controllare che il modulo si svegli, che compaia la scacchiera, che si possa muovere un pezzo (tastiera) e che risponda. Screenshot in locale, non consegnati. Annotare il protocollo reale tra le due CPU in `o2web-stato.md` (da verificare, nessun listato).
6. **Chiusura.** Batteria completa verde (`sh test/run_all.sh DUMPS`), `tools/check_release.py` OK (il controllo deve rifiutare le due ROM se finissero nel pacchetto: aggiungere le impronte all'elenco dei dump noti), `tools/build.js`, prova nel browser, aggiornamento di `o2web-stato.md` anche nel Project.

## 6. Regole fisse da ricordare (dalle istruzioni del Progetto)
Rispondere in italiano; codice interamente originale (MAME e O2EM solo come documentazione, non si copia codice); nessun BIOS / ROM / copertina / foto di terzi nel pacchetto; copyright «(c) 2026 by Agara73» e `SPDX-License-Identifier: GPL-3.0-only` in ogni file; nessun `localStorage`, `alert`, `confirm`, emoji come `\uXXXX`; download con TextEncoder + Blob; fatti dall'hardware ricavati da altri emulatori o dalla memoria marcati «da verificare»; nessuna richiesta di rete se l'utente non la chiede; non ottimizzare senza una misura prima e dopo; ogni tappa in una chat separata.

## 7. Domande aperte (da porre all'utente, una alla volta e solo se servono)
1. NTSC: bloccare il modulo (era venduto solo in Europa) o permettere il tempo reale anche in NTSC?
2. Il modulo si carica solo con la ROM da 2 KB giusta (impronta) o con qualunque cartuccia da 2 KB + ROM Z80? (proposta: solo l'impronta nota, con messaggio chiaro; un altro file e' una cartuccia normale.)
3. Pubblicazione su GitHub / Vercel ancora da fare (non e' di questa tappa): GPL-only o or-later, indirizzo del repository, `package.json` con Node 22, esclusione degli appunti interni; nessuna email nei crediti (decisione dell'utente).

## 8. Rischi
- Il protocollo tra le due CPU e' ignoto: la sincronizzazione grossolana (per riga o per fotogramma) potrebbe non bastare. Partire per riga e misurare; passare a una sincronizzazione per istruzione solo se serve.
- Differenze NSC800 / Z80 non note: se la ROM usa istruzioni o interrupt propri dell'NSC800, comparira' come blocco: aggiungerle dopo averle viste nel codice.
- Il costo della batteria di test (circa 9-12 minuti) cresce con i test Z80: tenerli veloci.
