# O2web - istruzioni per Claude Code

(c) 2026 by Agara73 - GPL-3.0 (solo per il codice)

## Cos'e' il progetto

O2web e' un emulatore da browser (HTML + JavaScript) delle console Magnavox Odyssey 2,
Philips Videopac G7000 / G7200 e Videopac+ G7400. Funziona aprendo un solo file HTML
nel browser, anche da disco e senza connessione: l'utente sceglie dal proprio computer
il BIOS, il set di caratteri e il .bin della cartuccia, e quei file non lasciano mai il
suo computer (nessun caricamento in rete, salvo le eccezioni decise piu' sotto).

## Prima di fare qualsiasi cosa

1. In `o2web-stato.md` leggi la sezione «Piano dopo la tappa 7» (tappe P, 8, 9, 10, mobile / PWA / Drive, vincoli tecnici, domande aperte nuove): trovala con Grep, come le altre sezioni (punto 2).
2. `o2web-stato.md` e' la fonte di verita', ma e' MOLTO lungo: NON leggerlo tutto a ogni sessione.
   Leggi l'intestazione (prime righe), poi cerca con Grep le sezioni che servono (la tappa in
   corso, "Domande aperte", "Da verificare") e leggi solo quelle. Se serve, proponi all'utente
   di spezzarlo (riassunto breve + dettagli per tappa); non farlo senza consenso.
3. Lavora su UNA tappa per sessione. Non iniziare una tappa senza aver chiuso la precedente con i test verdi.
4. Se l'utente chiede un'analisi o un parere, NON produrre file ne' modificare nulla senza il suo consenso esplicito.

## Regole fisse

1. Rispondi in italiano. L'utente e' alla prima esperienza con Claude Code, con GitHub e con Vercel: dì cosa farai prima di farlo e spiega i comandi in modo semplice.
2. Il codice e' interamente originale. MAME, O2EM e i datasheet si leggono come documentazione; non si copia il loro codice, si riscrive da quanto si e' capito.
3. BIOS, cartucce, ROM (anche quelle del modulo scacchi), set di caratteri del chip video e dell'EF9341, copertine NON si distribuiscono: li porta l'utente, che li possiede, per uso personale. Per i test usali in locale (cartella `_privato/`); non includerli mai in commit, zip, repository, HTML consegnato, listati completi o disassemblaggi del BIOS. Non riprodurre grafica, titoli o loghi dei giochi e dei produttori.
4. Il set di caratteri e' un ingresso di prima classe come il BIOS: senza quello vero molti giochi sono ingiocabili. Il ripiego GPL incluso serve a vedere il menu e i testi, e ha ancora celle da migliorare.
5. Licenza GPL-3.0 solo per il codice (identificatore attuale: `GPL-3.0-only`, domanda aperta se "o successive"). Intestazione in ogni file: "(c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only". Il file LICENSE ha il testo ufficiale. Nome: O2web. Pubblicazione: GitHub + Vercel (sito statico, nessuna funzione sul server, nessun intermediario).
6. Architettura: moduli JavaScript separati in `src/` (CommonJS) e `tools/build.js` che produce il file HTML unico. Moduli sostituibili dietro interfacce piccole: CPU 8048 (nessun indirizzo ne' registro della console dentro la CPU), console, video (8244/8245 + EF9340/41), audio, ingressi, interfaccia, regista `app.js` senza DOM. Strato di aspetto (`look.js`: G7200, filtri CRT) che lavora solo sull'uscita dopo il framebuffer. BIOS e cartuccia sono parametri. PAL 50 Hz e NTSC 60 Hz selezionabili. Lingua dei sorgenti: italiano; l'inglese passa da `src/i18n.js`, `src/lang_en.js`, `src/lang_en_dom.js`.
7. Fedelta' prima di tutto: video per riga di scansione, collisioni come nel chip, 360 x 243, colori veri. Non ottimizzare senza una misura prima e dopo.
8. Ogni pezzo si prova contro un riferimento indipendente, con prova di mutazione. Batteria completa: `sh test/run_all.sh CARTELLA_DEI_DUMP` (circa 6-12 minuti; aggiungi `--mutation` per le mutazioni). Servono Python 3, Node.js, Playwright con Chromium per le prove della pagina, e per i test del modulo scacchi la variabile `Z80_LIB` (cartella creata con `pip install --target <cartella> z80==1.2.0`). Controllo del pacchetto: `python tools/check_release.py` (aggiungi `--dumps CARTELLA` per cercare pezzi dei dump veri nei sorgenti). Le prove usano `?offline` e `?lang=it` per non fare rete e avere i testi in italiano. Gli screenshot si fanno in locale e NON si consegnano ne' si committano se mostrano grafica dei giochi o copertine.
9. Fatti sull'hardware presi da altri emulatori o dalla memoria vanno marcati "da verificare" in `o2web-stato.md` finche' non confermati con dump o documentazione. I test provano che il JavaScript riproduce un riferimento scritto a parte, non che il riferimento sia fedele alla macchina. Se un requisito e' ambiguo e rifare costerebbe molto, fai una domanda prima di costruire; altrimenti parti e dichiara le scelte.
10. Regole di codice HTML/JavaScript dell'utente:
    - scarico file con `TextEncoder` + `Blob` (non `data:` URI);
    - finestre di dialogo inline nel DOM (mai `confirm()` o `alert()`);
    - emoji codificate come `\uXXXX` nelle stringhe JS (le bandiere sono SVG);
    - nessun `localStorage` (per ricordare impostazioni, lingua o BIOS chiedi prima);
    - tag `<script>` bilanciati prima di salvare; nessuna dichiarazione `let` duplicata;
    - dopo ogni scrittura di file da Python verifica dimensione > 0 e mai `errors='replace'` su file da riscrivere.
11. Prima di committare una tappa: batteria verde, build del file unico, prova nel browser, `check_release.py` verde, aggiornamento di `o2web-stato.md`, README e LEGGIMI.

## Eccezioni gia' decise alle regole (non allargarle senza chiedere)

- **Foto delle macchine:** solo 4 foto con licenza libera (CC BY-SA), in `web/photos/` con `CREDITS.json` (autore, licenza, fonte, SHA-256). `check_release.py` ammette immagini solo li'. Odyssey 2, G7000, G7200, G7400; C52 e Jopac restano disegni originali.
- **Dati di terzi nel codice:** `src/gamedb_data.js` (lista software MAME, CC0) e `src/vplist_data.js` (catalogo di Maurice Simon, www.renelips.nl: copia ammessa senza scopo di lucro con citazione; NON sono GPL; credito nel file, nella pagina e nel README).
- **File di sessione** (`o2web-session`): contiene i dump dell'utente; e' un file personale creato nel suo browser, mai prodotto o distribuito dal progetto.
- **Rete:** solo `src/netfetch.js` puo' usarla (il build lo controlla). Consentiti: scarico da un indirizzo https scelto dall'utente, pulsanti GitHub e caricamento automatico dei due set di caratteri da O2EM all'apertura (disattivabile con `?offline`), copertine da un indirizzo indicato dall'utente. CSP: `connect-src https:`; il build rifiuta di procedere se la CSP non coincide con quella di `vercel.json`. archive.org NON e' leggibile dalla pagina (CORS): i download delle raccolte restano a mano.
- **Google Drive** (decisione 21/10/2026): sincronizzazione SOLO nella versione ospitata, attivazione volontaria, mai nella versione da disco. Richiede di rivedere CSP e controlli del build: vedi `o2web-stato.md`, sezione «Piano dopo la tappa 7».

## Cartelle

- `src/` moduli; `tools/`, `ref/`, `hw/`, `test/`, `web/` (modello della pagina e foto) - vedi `LEGGIMI.md`
- `_privato/` BIOS, ROM, set di caratteri, copertine, `DUMPS/` per i test locali: NON in git
- `_import/` zip ricevuti dalle chat precedenti: NON in git

## Cosa non fare mai

- Committare o pubblicare BIOS, ROM, set di caratteri, copertine, foto non libere.
- Inserire l'email dell'utente nei credits (decisione: per ora nessuna).
- Usare la rete di nascosto, o far passare file dell'utente da un server.
- Cambiare le scelte gia' prese senza chiederlo (le scelte della tappa 3 per ora non si toccano).

## A fine tappa

Aggiorna `o2web-stato.md` (decisioni, misure, cose da fare), fai il commit con un messaggio chiaro e ricorda all'utente di copiare lo stato nel progetto su claude.ai.
