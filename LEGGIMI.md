# Pacchetto progetto "Emulatore Odyssey 2 / Videopac G7000 / G7400 per browser"
(c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - 11/10/2026, aggiornato il 17/10/2026 (tappa 6a)

Questo pacchetto raccoglie quanto del progetto "emulatore per ZX Spectrum" serve a un emulatore da browser. **Non contiene BIOS, cartucce
ne' set di caratteri del chip video**: i dump li porti tu (uso personale) e sono gli stessi che hai gia' nel progetto precedente.

## Contenuto
| Percorso | A cosa serve |
|---|---|
| `CLAUDE.md` | istruzioni per Claude Code: regole fisse del progetto ed eccezioni gia' decise |
| `o2web-stato.md` | documento di stato: decisioni, fatti verificati e da verificare, tabella di marcia, domande aperte. Da caricare nel progetto |
| `tools/dis48.py` | disassemblatore 8048 con cicli macchina e tracciamento dai vettori (`--selftest`) |
| `tools/check_dumps.py` | MD5 e coerenza dei dump (BIOS, cartucce) |
| `tools/extract_charset.py` | ricava il set di caratteri (512 byte del chip video, o 2560 con `--ef`) da una tabella C in qualunque sorgente o zip che porti tu; il file resta tuo |
| `src/charedit.js`, `src/charui.js`, `test/test_charedit.js`, `test/test_charlive.js`, `test/test_extract_charset.py` | **Editor dei caratteri**: logica pura (glifi, trasformazioni, lettura di tabelle C e zip, riconoscimento), pannello della pagina, sostituzione a caldo nella console |
| `ref/ref8048.py`, `ref/test_ref8048.py` | riferimento CPU 8048 in Python (fonte di verita' per i test differenziali) e sue prove |
| `ref/i48.js`, `ref/check_i48.py` | tabelle degli opcode in JavaScript (lunghezza, cicli, tipo), verificate contro Python su tutti i 256 opcode |
| `ref/check_dis48_vs_mame.py` | controllo di sviluppo di `dis48.py` contro la tabella di MAME (serve il file `mcs48.cpp` di MAME, non incluso) |
| `hw/o2hw.py` | modello hardware di riferimento: chip video 8244/8245, posizione del raggio, T1, interrupt, collisioni, `MOVX`, tastiera, joystick |
| `hw/charset_own.js` | set di caratteri ORIGINALE di ripiego (glifi disegnati da zero) |
| `src/cpu8048.js` | **tappa 1**: nucleo 8048 in JavaScript (interprete), interfaccia CPU / ambiente documentata nella testata |
| `test/` | **tappe 1 e 2**: test differenziali contro `ref/ref8048.py`, prova di mutazione, registra-e-riproduci di BIOS + cartucce, avvio dal vivo, misura di velocita', console + video contro il modello per riga, prova casuale del chip video, stato di gioco, prova nel browser (vedi sotto) |
| `src/console.js`, `src/cartmap.js`, `src/vdc.js`, `src/sha256.js`, `src/unzip.js` | **tappa 2**: console (bus, MOVX, porte, tastiera, joystick, stato serializzabile), mappe delle cartucce, chip video 8244/8245 per riga di scansione, SHA-256, apertura degli zip |
| `src/screen.js`, `src/ui.js`, `web/index.template.html`, `tools/build.js` | **tappa 2**: pagina del browser e build del file HTML unico (`dist/o2web.html`) |
| `hw/o2line.py` | **tappa 2**: modello di riferimento PER RIGA (video, T1 a fronti, banchi della cartuccia) usato come oracolo dei test |
| `tools/classify_carts.py`, `tools/survey_carts.js`, `tools/probe_keys.js` | **tappa 2**: classificazione statica (non conosce lo schema lineare) e dinamica (affidabile) delle cartucce; matrice della tastiera dal BIOS |
| `src/audio.js`, `src/webaudio.js`, `hw/o2audio.py` | **tappa 3**: dal livello del suono del chip ai campioni PCM (dipende solo dal tempo emulato), uscita Web Audio, riferimento esatto in Python |
| `src/input.js`, `src/library.js`, `src/session.js`, `src/zipstore.js`, `src/app.js` | **tappa 3**: tastiera / joystick 1 e 2 / gamepad configurabili, elenco unico di giochi e BIOS (zip anche annidati), file di sessione (zip senza compressione), regista senza DOM |
| `tools/survey_sound.js` | **tappa 3**: conta le scritture ai registri del suono nelle cartucce dell'utente |
| `README.md` | istruzioni per l'utente e per gli sviluppatori (con le note su Vercel e la licenza) |
| `LICENSE`, `vercel.json`, `.gitignore`, `tools/check_release.py` | **tappa 4**: testo ufficiale della GPL-3.0; configurazione Vercel (sito statico, intestazioni di sicurezza); esclusione dei dump dal repository; controllo di rilascio (copyright e licenza in ogni file, nessun dump o immagine nel pacchetto) |
| `src/look.js`, `src/machines.js`, `hw/look_ref.py`, `test/look_record.py`, `test/test_look.js` | **tappa 4b**: aspetto (monitor B/N del G7200, sfocatura, persistenza, alone, righe, maschera, curvatura: funzioni pure sul fotogramma, uscita esatta a filtri spenti), scelta e disegno originale della macchina dal BIOS / standard / monitor; riferimento indipendente in Python e confronto pixel per pixel |
| `src/netfetch.js`, `src/covers.js`, `test/test_net.js`, `test/test_covers.js`, `test/test_app_net.js` | **tappa 4c**: rete su richiesta (scarico GET da un indirizzo https scelto dall'utente, limiti, annullamento; unico modulo con la rete, controllato dal build e dalla CSP `connect-src https:`) e copertine in memoria (riconoscimento dal contenuto, abbinamento per titolo, zip annidati, limiti); prove con un fetch finto e immagini sintetiche |
| `web/photos/` (foto `.webp` + `CREDITS.json`), `src/photos.js`, `test/test_photos.js` | **tappa 4b**: foto delle macchine con licenza libera fornite dall'utente (NON GPL: ognuna con autore, licenza, fonte e modifiche); controllo dei crediti, SHA-256 e licenze libere; incorporate nella pagina dal build |
| `src/ef934x.js`, `hw/ef934x_ref.py`, `hw/o2g7400.py`, `hw/charset9341_own.js`, `test/ef_record.py`, `test/ef_run.js`, `test/test_g7400.js` | **tappa 5**: Videopac+ G7400, EF9340 / EF9341 (accessi, comandi, memoria di pagina e dei caratteri ridefinibili, resa per riga, mixer con l'8245, collisioni CX); modello di riferimento in Python scritto a parte (anche console G7400 per riga) e prove contro di esso; set di caratteri ORIGINALE di ripiego dell'EF9341 (2560 byte); mappe delle cartucce da 12 / 16 KB in `src/cartmap.js` |
| `src/z80.js`, `src/chessmod.js`, `test/z80_record.py`, `test/z80_run.js`, `test/test_z80_misc.js`, `test/zex_run.js`, `test/test_chess.js`, `test/test_chess_app.js`, `test/chess_testrom.js`, `hw/chessmod_ref.py`, `test/chess_record.py`, `test/chess_run.js`, `test/chess_real.js` | **tappa 6a**: Z80 / NSC800 originale (provato passo per passo contro il pacchetto Python `z80`, ZEXDOC / ZEXALL), modulo scacchi Philips C7010 (Z80 + ROM da 8 KB + RAM da 2 KB + due latch verso l'8048; la ROM la porta l'utente), ROM di prova ORIGINALI (nessuna ROM vera nel pacchetto), riferimento a parte in Python (`hw/chessmod_ref.py`), prova con le ROM vere in locale (`chess_real.js`) |
| `src/i18n.js`, `src/lang_en.js`, `src/lang_en_dom.js`, `test/test_i18n.js`, `test/browser_i18n.py` | **tappa 5d**: lingue (inglese predefinito, italiano; bandiere in alto a destra; `?lang=it`): `t()` con modelli e frammenti per i messaggi dei moduli di base, tabella dei testi fissi dell'HTML, pannello «Donazioni» (nel template) |
| `src/machines.js`, `src/app.js`, `src/ui.js`, `web/index.template.html`, `test/test_machine.js`, `test/browser_check.py` | **tappa 5c**: scelta della macchina (Odyssey 2, G7000, G7200 in bianco e nero, C52, Jopac, G7400; voci senza BIOS in grigio), piastra dei tasti come quelle del G7000 e fascia «Schermo e suono» sotto lo schermo, pannelli riordinati, niente collegamenti a raccolte |
| `src/touch.js`, `src/pacer.js`, `hw/touch_ref.py`, `hw/pacer_ref.py`, `test/touch_vectors.py`, `test/test_touch.js`, `test/pacer_vectors.py`, `test/test_pacer.js`, `test/browser_mobile.py` | **tappa 8**: web mobile: joystick a tocco (croce fissa o stick che segue il dito, piu' dita), comandi a tocco nella pagina (verticale e orizzontale, schermo intero con i comandi), passo dell'emulazione con l'orologio della pagina e piccola correzione dall'audio (anticipo adattato ai telefoni con l'audio a blocchi); riferimenti indipendenti in Python e prova della pagina su un telefono simulato |

I file vengono dal progetto Spectrum e conservano il suo vocabolario ("tappa 3", "nucleo Z80"): contano solo i contenuti. In
particolare le "Semplificazioni" nella testata di `o2hw.py` valgono per lo Spectrum e **non vanno portate** nel progetto browser
(vedi `o2web-stato.md`).

## Come lanciare il progetto
1. Crea un nuovo progetto e scrivi nelle istruzioni le regole di `CLAUDE.md` (il testo delle istruzioni del progetto su claude.ai non e' nel repository).
2. Carica nel progetto: `o2web-stato.md`, i file di `tools/`, `ref/`, `hw/` (o lo zip) e i **tre zip dei dump** che hai gia' (BIOS Odyssey 2,
   BIOS Videopac+, cartuccia Blockout + Breakdown). Non servono `spectrum-kit.zip` ne' gli zip delle tappe 1-3.
3. Nella prima chat: "Tappa 1: nucleo 8048 in JavaScript e test differenziali". Prima di partire, rispondi se vuoi alle "Domande aperte" in
   fondo a `o2web-stato.md` (hanno gia' una proposta).

## Prove rapide (servono Python 3 e Node.js; solo per sviluppatori)
```sh
python3 tools/dis48.py --selftest                          # disassemblatore
python3 ref/test_ref8048.py                                # riferimento CPU: 0 prove fallite
python3 ref/check_i48.py                                   # tabelle JS = Python = dis48 (256 opcode)
python3 tools/check_dumps.py BIOS.bin CARTUCCIA.bin        # MD5 e coerenza dei dump
```
Per far girare BIOS + cartuccia nel modello Python (`hw/o2hw.py`): `Machine(load_image(bios, cart), own_charset())`, poi
`run_frames(n)`; con `env.keep_bitmaps = True` ogni fotogramma si salva come bitmap 360 x 243 (indici di colore 0-15).

## Tappa 1: test del nucleo JavaScript (solo sviluppatori; servono Python 3 e Node.js)
I dump (BIOS e cartucce) li porti tu e restano in una tua cartella, mai nel progetto ne' negli zip. La cartella deve contenere
`bios/o2rom.bin`, `bios/g7400.bin`, `blockout.bin`, `killerbees.bin`, `pickaxepete.bin`, `demonattack.bin` (i nomi sono quelli usati dai test).
```sh
sh test/run_all.sh CARTELLA_DEI_DUMP              # tutto: riferimenti, differenziale, api, replay, avvio dal vivo (circa 3 minuti)
sh test/run_all.sh CARTELLA_DEI_DUMP --mutation   # in piu' la prova di mutazione (altri 4-5 minuti)
python3 -I test/difftest.py --seed 2              # solo il differenziale con un altro seme (--quick per la meta')
node test/test_api.js                             # reset, 256 opcode, runUntil
node test/bench.js CARTELLA_DEI_DUMP              # velocita' (nessuna ottimizzazione: solo misura)
```
`test/stub_console.js` e' una console minima di prova (nessuna grafica): sara' sostituita dalla console vera della tappa 2.
**Su Windows** (29/10/2026): la batteria gira con `sh` di Git for Windows (`& 'C:\Program Files\Git\bin\sh.exe' test/run_all.sh CARTELLA_DEI_DUMP`). Servono un comando `python3` raggiungibile sia da `sh` sia da Node (per esempio una copia di `python.exe` chiamata `python3.exe`) e `Z80_LIB` scritto con le barre `/` (`C:/.../o2web-z80`). I test leggono l'uscita di Python in UTF-8 e accettano gli a capo `\r\n`; `test_app_list.js` cerca il set vero in `CARTELLA_DEI_DUMP/../cs/charset.bin` e, se manca, usa il set GPL. Dettagli in `o2web-stato.md`, «Portabilita' Windows».

## Tappa 2: console, video per riga, stato di gioco, pagina (solo sviluppatori)
```sh
sh test/run_all.sh CARTELLA_DEI_DUMP                       # tutto, tappe 1 e 2 (circa 6 minuti); --mutation in piu'
O2_DUMPS=CARTELLA python3 -I test/line_record.py /tmp/rec --frames 70 && node test/line_run.js /tmp/rec CARTELLA   # console JS contro il modello per riga
python3 -I test/vdc_stress.py /tmp/s.json && node test/vdc_stress.js /tmp/s.json                                    # chip video, prova casuale
node test/test_misc.js ; node test/test_state.js CARTELLA                                                           # prove puntuali e stato di gioco
python3 -I test/mutate2.py vdc --dumps CARTELLA --stress /tmp/s.json --rec /tmp/rec                                  # mutazione (anche console, cartmap, sha256, unzip, cpu8048)
node tools/build.js && python3 -I test/browser_check.py dist/o2web.html CARTELLA /tmp/shots                          # file unico + prova in Chromium
```
Oltre ai sei dump della tappa 1, gli scenari in piu' di `test/line_scenarios.json` usano cartucce sotto `CARTELLA/carts/` (4 in 1 Row, Musician,
Missao Impossivel, Armored Encounter, Popeye, Atlantis, Type & Tell): se mancano si saltano. Gli screenshot del browser mostrano grafica dei giochi:
restano in locale.

## Tappa 3: suono, ingressi, elenco, sessione, pagina (solo sviluppatori)
```sh
sh test/run_all.sh CARTELLA_DEI_DUMP                       # tutto, tappe 1-3 (circa 10 minuti); --mutation in piu' (molti minuti)
python3 -I test/audio_ref.py /tmp/a --line /tmp/rec && node test/test_audio.js /tmp/a CARTELLA                      # suono contro il riferimento esatto
node test/test_input.js CARTELLA ; node test/test_zipstore.js ; node test/test_library.js CARTELLA                   # ingressi, zip scritti, elenco
node test/test_session.js CARTELLA ; node test/test_webaudio.js ; node test/test_app.js CARTELLA                     # sessione, uscita audio, regista
python3 -I test/mutate2.py library --dumps CARTELLA --stress /tmp/s.json --rec /tmp/rec --audio-ref /tmp/a           # mutazione (anche audio, input, zipstore, session, webaudio, app); --lines 86-190,285-310 limita ai mutanti di quelle righe
```
Per le prove sugli archivi di giochi veri la cartella dei dump deve avere anche `_tosec_o2/` e `_tosec_vp/` (le cartelle estratte dai due archivi scaricati a mano: dentro, uno zip per gioco);
le prove le impacchettano al volo in uno zip esterno. Il file di sessione e le prove con i dump veri restano in locale: non si consegnano.

## Tappa 4: file unico, licenza, schermata di avvio (solo sviluppatori)
```sh
node tools/build.js dist/o2web.html                         # file unico (anche il testo di LICENSE, l'avviso GPL e la regola di sicurezza della pagina)
sh test/run_all.sh CARTELLA_DEI_DUMP                        # tutto, tappe 1-4; il passo 10 costruisce la pagina e la prova in Chromium; il 10b controlla il rilascio
python3 -I tools/check_release.py . --dumps CARTELLA        # prima di consegnare (anche su uno zip: python3 -I tools/check_release.py sorgenti.zip --dumps CARTELLA)
```
Il pacchetto dei sorgenti si fa dalla cartella del progetto escludendo `__pycache__`, `dist` e ogni dump; `check_release.py` lo verifica (nessun file binario, nessuna immagine, nessun pezzo
di dump). Licenza **GPL-3.0-only** (scelta dell'utente: «GPL-3.0»; ho letto «solo la versione 3», non «o successive»: se vuoi «o successive» si cambia l'identificatore in ogni intestazione,
nel README, nella pagina e in `check_release.py`).

## Tappa 5: Videopac+ G7400 (solo sviluppatori)
```sh
sh test/run_all.sh CARTELLA_DEI_DUMP                        # tutto, tappe 1-5 (il passo 9j e' quello dell'EF9340/41 e del G7400; il passo 6 include 10 scenari G7400)
python3 -I test/ef_record.py /tmp/e.json --cases 40 --seed 3 && node test/ef_run.js /tmp/e.json    # EF9340/41 contro hw/ef934x_ref.py
node test/test_g7400.js CARTELLA                            # MOVX verso l'EF9341, mappe 12 / 16 KB, mixer, stato v3, regista (con i dump veri se ci sono)
python3 -I test/mutate2.py ef934x --dumps CARTELLA --ef-ref /tmp/e.json                              # mutazione del modulo dell'EF9340/41
```
Per le prove con i dump veri la cartella deve avere anche `bios/g7400.bin` e le cartucce Videopac+ sotto `carts/`: `vp_killer_bees.bin`, `vp_pickaxe_pete.bin`, `vp_demon_attack.bin`, `vp_air_battle_12k.bin`,
`vp_neutron_star_12k.bin`, `vp_helicopter_rescue_16k.bin`, `vp_trans_american_rally_16k.bin` (se mancano, quelle prove si saltano). Il set di caratteri vero dell'EF9341 (2560 byte) **non e' nel progetto**:
le prove usano il ripiego originale (`hw/charset9341_own.js`) o una ROM sintetica. Gli screenshot del G7400 mostrano giochi: restano in locale.

## Tappa 6a: modulo scacchi Philips C7010 (solo sviluppatori)
```sh
Z80_LIB=/percorso/pipz80 sh test/run_all.sh CARTELLA_DEI_DUMP   # tutto; il passo 9n e' quello della tappa 6a (senza Z80_LIB le prove differenziali si saltano)
pip install --target /percorso/pipz80 z80==1.2.0                # solo sviluppo: riferimento per il Z80 (MIT), non fa parte del pacchetto
python3 -I test/z80_record.py /tmp/z --lib /percorso/pipz80 && node test/z80_run.js /tmp/z       # Z80 passo per passo (casi per ogni opcode, programmi casuali, interrupt)
node test/zex_run.js ZEXDOC.com                                 # facoltativo: programmi di terzi (Cringle / Yaze), da portare da fuori
node test/chess_testrom.js /tmp/c && python3 -I test/chess_record.py /tmp/c --lib /percorso/pipz80 && node test/chess_run.js /tmp/c    # modulo + console, PAL e NTSC
node test/chess_real.js CARTELLA_DEI_DUMP                       # DUMPS/chess/vp_c7010.bin e z80_c7010.bin (ROM vere, mai nel pacchetto): il motore risponde alle mosse in PAL
python3 -I test/mutate2.py z80 --dumps CARTELLA --stress x --rec x --z80-ref /tmp/z --n 250       # mutazione del Z80
python3 -I test/mutate2.py chessmod --dumps CARTELLA --stress x --rec x                        # mutazione del modulo
```
`test/chess_testrom.js` costruisce da zero il BIOS 8048 di prova, la ROM dello Z80 di prova e la cartuccia di prova (originali; per il riconoscimento nell'elenco si forgiano file con le dimensioni e i
CRC-32 delle ROM vere, senza usarne il contenuto). Il pacchetto non contiene le ROM del modulo e `tools/check_release.py --dumps` le cerca anche in `DUMPS/chess/`. I fatti sull'hardware (cancello dei
latch con P1 bit 0 = 0, bit 3 = 1 e bit 4 = 0, velocita' dello Z80, valori iniziali di latch e RAM) sono **da verificare**: l'elenco e' in `o2web-stato.md`.

## Tappa 7: elenco a voci, duplicati, nomi e anteprime (solo sviluppatori)
```sh
sh test/run_all.sh CARTELLA_DEI_DUMP                        # tutto; il passo 9o e' quello della tappa 7
node test/test_sha1.js && node test/test_gamenames.js CARTELLA_DEI_DUMP && node test/test_gamelist.js   # SHA-1, sigle e nomi, elenco unito
python3 -I test/preview_vectors.py /tmp/pv/vec.json && node test/test_preview.js /tmp/pv/vec.json && node test/test_previews.js   # anteprime contro hw/preview_ref.py
O2_DUMPS=CARTELLA python3 -I test/preview_record.py /tmp/pv && node test/preview_run.js /tmp/pv CARTELLA   # console contro hw/o2line.py
node test/test_app_list.js CARTELLA && python3 -I test/browser_list.py dist/o2web.html CARTELLA /tmp/shots  # regista e pagina intera
python3 -I tools/make_gamedb.py videopac.xml -o src/gamedb_data.js    # rigenera src/gamedb_data.js (sigla, SHA-1, nome: nessun dato delle ROM)
python3 -I test/mutate2.py preview --dumps CARTELLA --stress x --rec x --prev-ref /tmp/pv   # mutazione (anche sha1, previews, gamenames, gamelist)
```
Test del tavolo di lavoro del 18/10/2026 (sera): `test/test_automachine.js DUMPS` (cambio macchina automatico per i giochi «solo Videopac+», scelta a mano, interruttore, anteprime col G7400), blocco «discordanza nome/impronta» in `test/test_gamenames.js` e in `test/test_gamelist.js`, blocco «ordinamento» in `test/test_gamelist.js`; mutazione: `mutate2.py gamelist|gamenames|app --lines ...`.
Test dei comandi sotto lo schermo (18/10/2026, notte): `test/test_usability.js DUMPS` (scambio dei comandi 1-2 dal regista alla console, sessione, ciclo dei Filtri CRT con il personalizzato messo da parte), blocchi «scambio» in `test/test_input.js` e «ciclo» in `test/test_look.js`, `test/browser_plate.py` (pagina intera, inglese e italiano, 360 px); mutazione: `mutate2.py input|session|look|app --lines ...`.
Catalogo: `src/vplist_data.js` (GENERATO da `tools/make_vplist.py` dalla lista HTML di Maurice Simon, 479 voci; dati non GPL, con credito) e `src/vplist.js` (abbinamento ROM -> gioco: sigla, codice, titolo; `matchGame`, `describeMatch`); riferimento indipendente `hw/vplist_ref.py`; prove `test/test_vplist.js` (+ `vplist_infos.js`, `vplist_vectors.py`) e `test/test_vplist_parse.py` (serve la lista HTML: `O2_VPLIST=lista.html sh test/run_all.sh ...`); mutazione: `mutate2.py vplist --vp-vec VEC.json`.
Moduli: `src/sha1.js`, `src/gamedb_data.js` (generato, 187 voci), `src/gamenames.js` (sigle, elenchi di nomi come `Gamelist777.txt`, titolo), `src/gamelist.js` (voci unite per SHA-256, filtro, ordine),
`src/preview.js` (copione di tasti in due fasi, punteggio dei quadri, riduzione a 80 x 54) e `src/previews.js` (coda a fette di tempo e cache in memoria); riferimento indipendente `hw/preview_ref.py`.
La tabella incorporata contiene titoli di giochi (lista CC0 di MAME): non e' grafica ne' dati delle ROM, ma e' da tenere presente per la regola sui titoli. Le anteprime stanno solo in memoria.

## Tappa 8: web mobile (solo sviluppatori)
```sh
sh test/run_all.sh CARTELLA_DEI_DUMP                        # tutto; i passi 9r (tocco) e 9s (passo) sono quelli della tappa 8, il 10 include browser_mobile.py
python3 -I test/touch_vectors.py /tmp/t.json && node test/test_touch.js /tmp/t.json   # joystick a tocco contro hw/touch_ref.py
python3 -I test/pacer_vectors.py /tmp/p.json && node test/test_pacer.js /tmp/p.json   # passo dell'emulazione contro hw/pacer_ref.py (18 scenari)
python3 -I test/browser_mobile.py dist/o2web.html CARTELLA /tmp/shots   # pagina su un Android simulato (screenshot della sola zona dei comandi)
python3 -I test/mutate2.py pacer --dumps CARTELLA --stress x --rec x --pacer-vec /tmp/p.json   # mutazione (anche touch con --touch-vec)
```
Misure sul telefono vero (Motorola Edge 60 Pro) e decisioni: `o2web-stato.md`, sezione «Tappa 8 - web mobile».
