# O2web - emulatore Odyssey 2 / Videopac per browser

(c) 2026 by Agara73 - software libero, **GPL-3.0-only** (vedi `LICENSE`; vale solo per il codice).

O2web e' un emulatore, in **un solo file HTML con JavaScript**, delle console **Magnavox Odyssey 2** e **Philips Videopac G7000 / G7200** e **Videopac+ G7400** (EF9340 / EF9341, con i giochi nativi da 12 e 16 KB; per il G7400 molti dettagli sono ancora **da verificare**: vedi sotto). Si apre dal disco, funziona **senza connessione** e **nessun file lascia il tuo computer**. **All'apertura** la pagina legge da sola i due **set di caratteri** dal sorgente pubblico di O2EM su GitHub (due GET in sola lettura; se non c'e' connessione resta il set GPL incluso e la pagina funziona lo stesso; per non fare **nessuna** richiesta apri la pagina con **`?offline`** in fondo all'indirizzo). Per il resto fa richieste solo se premi **«Scarica»**: legge (in sola lettura, solo https, senza cookie ne' referrer) un indirizzo che scegli tu; non invia mai niente
(la regola di sicurezza della pagina, `connect-src https:`, lo fa rispettare dal browser: niente http, niente altri canali).

> **I giochi, il BIOS e il set di caratteri del chip video restano dei rispettivi titolari.** Qui non c'e' nessun BIOS, nessuna cartuccia, nessun set di
> caratteri e nessuna copertina: i file li porti tu, per uso personale. Il codice e' originale; MAME e O2EM sono stati letti solo come documentazione.

**Provalo online:** <https://o2web-flame.vercel.app/> (la stessa pagina, ospitata su Vercel: anche li' BIOS e giochi restano nel tuo browser e non vengono caricati da nessuna parte). **Codice sorgente:** <https://github.com/agara73/o2web>.

Stato: **tappa 6a (modulo scacchi Philips C7010) fatta**: nucleo Z80 originale (`src/z80.js`) e modulo (`src/chessmod.js`), tutto da verificare sull'hardware vero; la ROM da 8 KB la porti tu. Tappa 5 (Videopac+ G7400) fatta: console G7400 con EF9340 / EF9341, mixer con l'8245, cartucce da 12 e 16 KB, set di caratteri dell'EF9341 come secondo ingresso. Tappa 4c: rete su richiesta, copertine dei giochi. **Tappa 5c (15/10/2026): nuova pagina** (scelta della macchina, tasti come quelli del G7000 sotto lo schermo, «Schermo e suono» sotto i tasti, pannelli riordinati). Tappa 4b: aspetto (monitor in bianco e nero del G7200, filtri da tubo catodico, disegno della macchina). Tappa 4: file HTML unico, licenza, schermata di avvio, set di caratteri come ingresso in evidenza. Suono, joystick 1 e 2, gamepad, tasti
configurabili, elenco unico di giochi e BIOS anche da archivi .zip, sessione, schermo intero, PAL / NTSC: tappa 3. 

## Lingua e donazioni
La pagina e' in **inglese** e in **italiano**: all'apertura parte in inglese; le due bandiere in alto a destra cambiano lingua al volo, oppure aggiungi **`?lang=it`** (o `?lang=en`) in fondo all'indirizzo. La lingua non si ricorda tra una visita e l'altra (la pagina non usa `localStorage`). In fondo al menu a destra c'e' la voce **Donazioni** (sempre aperta) con il collegamento alla mia lista dei desideri su Amazon: e' facoltativo, si apre solo se lo clicchi e la pagina non contatta Amazon da sola. Questo README e' in italiano.

## Per chi usa l'emulatore
1. Apri `o2web.html` con un browser recente (Chrome, Edge, Firefox, Safari), oppure l'indirizzo dove e' pubblicato.
2. In **«Macchina e giochi»** servono tre cose, che porti tu dal tuo computer. La schermata di avvio mostra per ognuna **PRONTO** o **MANCA**:
   - **BIOS** (1024 byte: Odyssey 2 / Videopac G7000, Philips C52 francese, **Videopac+ G7400** e Brandt Jopac).
   - **Set di caratteri del chip video** (512 byte: stanno nel chip video, **non** nel BIOS). La pagina ne contiene uno **GPL disegnato da zero** (segnato **GPL**): il menu
     e molti giochi si leggono, ma i simboli speciali (celle 48-63) non coincidono con l'originale e **alcuni giochi, per esempio Nightmare, restano difficili o ingiocabili**.
     Puoi correggerlo nell'**Editor dei caratteri** (sotto) o aggiungere l'originale. Come procurartelo: vedi sotto.
   - **Solo per il Videopac+ G7400 / Jopac: set di caratteri dell'EF9341** (esattamente **2560 byte**, 256 voci da 10 byte: la ROM dei caratteri del chip di testo, che non e' nel BIOS). Come per il chip video, e' un file tuo: si riconosce dalla dimensione, anche dentro uno zip, oppure col pulsante «Scarica il set dell'EF9341 (Videopac+) da GitHub». Senza, la pagina usa la ROM GPL inclusa (disegnata da zero sul datasheet: i testi si leggono, i disegni non sono identici), e lo dice.
   - **Giochi**: cartucce `.bin` e/o interi archivi compressi in file `.zip` (anche uno zip che contiene altri zip, uno per gioco).
   Aggiungi tutto con «Aggiungi file...» o **trascinando i file sulla pagina**, in un colpo solo: BIOS, set di caratteri (un file da esattamente 512 byte,
   anche dentro uno zip, o un sorgente C con la tabella), giochi, copertine, stati di gioco e sessioni si riconoscono da soli e finiscono al posto giusto.
   **«Aggiungi file...» e' l'unico punto di caricamento della pagina** ed e' sempre in vista nella barra in alto, accanto al pulsante del menu (le tre righe): il menu apre un cassetto con i pannelli (Macchina e giochi, Stato, Rete, Aspetto, Tasti, Caratteri, Informazioni), **uno solo aperto alla volta**; sul telefono il cassetto copre lo schermo e si chiude con il menu, con un tocco fuori o con Esc, sul computer spinge la pagina di lato. In tutta la pagina, le istruzioni sono dietro i pulsanti tondi **«?»** accanto a ogni voce (macchina, giochi, set di caratteri, tasti...): si aprono e si chiudono con un clic (o con Invio / Spazio; Esc chiude). Se aggiungi due file diversi da 512 byte la pagina non sceglie: aggiungi solo quello giusto.
   I set di caratteri si scaricano **da soli all'apertura** da GitHub (O2EM); i due pulsanti «Scarica ... da GitHub» servono a riprovare se non c'era connessione. Un set che aggiungi tu vince sempre su quello scaricato.
3. Scegli la **macchina** e **clicca un gioco**. Nell'elenco delle macchine: **Odyssey 2** (BIOS G7000, NTSC), **Videopac G7000** (PAL), **Videopac G7200** (lo stesso BIOS, PAL, **schermo in bianco e nero**: cambiano solo i colori mostrati, non l'emulazione; i livelli di grigio sono la luminanza standard, **da verificare** sulla macchina vera), **Philips C52**, **Brandt Jopac** e **Videopac+ G7400**. Le macchine di cui manca il BIOS sono **in grigio** («manca il BIOS»). In «Avanzate» si cambiano lo standard video e, se hai piu' BIOS adatti, quale usare.
   Il gioco parte a freddo con quella cartuccia (compare «SELECT GAME»: premi il numero del gioco). Ricerca per testo (titolo, anno, editore, paese) e filtro per cartella aiutano con gli elenchi grandi. Si passa da un gioco all'altro senza
   ricaricare niente: la partita che lasci viene **memorizzata** (pallino verde nell'elenco) e si riprende con un clic sul pallino. Con il Videopac+ G7400 (o Jopac)
   i giochi Videopac+ (anche da 12 e 16 KB) usano il testo e la grafica dell'EF9340 / EF9341 sopra l'immagine del chip 8245. Il **pin B della cartuccia** (non e' nel dump) si sceglie sotto lo schermo, in «Schermo e suono» (compare solo con il G7400): in automatico e' alto per i giochi Videopac+ e le cartucce da 12 / 16 KB, basso per gli altri.
   **Nomi, duplicati e anteprime (tappa 7).** Ogni gioco ha una sigla (per esempio `vp_13`, `o2_05`, `br_58`) letta dal nome del file; se il nome non la contiene, la si ricava dall'impronta SHA-1 del contenuto con una tabella
   incorporata di sole sigle, impronte e nomi (lista CC0 di MAME; **i nomi sono quelli dell'elenco, da verificare**). La voce mostra «sigla — nome» e, sotto, gli altri nomi trovati nei file. Il pulsante **«Unisci giochi duplicati»**
   (attivo all'apertura, si spegne con un clic) mostra una voce sola per i file con **lo stesso identico contenuto** (SHA-256), anche con nomi diversi o da raccolte diverse; versioni diverse dello stesso gioco restano separate. E' solo un modo di
   mostrare l'elenco: i file, le sessioni e gli stati restano uno per file (la «×» toglie tutti i file della voce; il pallino verde riprende la partita memorizzata). Se aggiungi un file di nomi come `Gamelist777.txt` (righe «file.bin  descrizione»,
   anche dentro uno zip) i suoi nomi vengono usati per le sigle `vp_`, `o2_`, `br_`, `csv`; se manca o non si legge, vale la tabella incorporata. **«Anteprime»** (acceso all'apertura) mostra accanto a ogni nome una piccola schermata del gioco, ottenuta
   facendolo girare in silenzio per qualche secondo nel tuo browser, solo per le righe che si vedono (se dopo 270 fotogrammi lo schermo ha meno del 2% di punti diversi dal fondo, si prova un tasto alla volta, tutti i 47, fino a che qualcosa compare; «vuota» solo sotto lo 0,2%); restano in memoria e non vengono salvate (ne' nella sessione). L'elenco dei nomi letto da un file non entra nella sessione: dopo averla riaperta vale la tabella incorporata.
   **Catalogo delle cartucce.** Sotto il nome di ogni gioco riconosciuto compare una riga con il **numero Videopac** (es. «Videopac 43+»), i codici dei cataloghi (Philips, Magnavox, Radiola, Brasile...), i titoli nelle altre lingue, la rarita' e le segnalazioni («solo Videopac+», «solo versione originale», «Voice», «non uscito per l'Odyssey2 USA», «diverso negli USA»); la ricerca trova anche per numero (`videopac 43`) o codice (`G7143`, `AC9437`). L'abbinamento ROM -> gioco usa, nell'ordine: la sigla (`vp_43`, `vp_43pl`, `o2_47`, `br_NN`...), il codice del catalogo e il titolo (in tutte le lingue). Se nessuna strada porta a un gioco (giochi nuovi, prototipi, versioni amatoriali) la riga manca: non si indovina. I dati vengono dalla lista di Maurice Simon (vedi «Licenza»).
   **Ordine dell'elenco** («Ordina per»): *Dispositivo e numero di cassetta* (predefinito) mette prima i giochi Odyssey² (sigla `o2_`, o versione solo USA), poi Videopac G7000, poi Videopac+ (versioni Plus), ciascun blocco per numero Videopac (le lettere A e V dopo i numeri) con un'intestazione; i giochi senza numero (Imagic, Parker, Jopac, modulo scacchi...) e quelli che la lista non conosce vanno in blocchi per editore (quello della lista o, se il gioco non c'e', quello scritto nel nome TOSEC), in ordine alfabetico, e quelli senza editore per ultimi. *Nome del gioco* e' l'ordine alfabetico di sempre, senza intestazioni.
   **L'impronta SHA-1 prevale sul nome del file**: se un file si chiama `vp_47.bin` ma il suo contenuto e' (per la tabella MAME) un altro gioco, la voce prende la sigla e il titolo del contenuto e mostra una nota «il nome del file dice vp_47, ma il contenuto e' vp_43pl». La stessa cosa in versione diversa (`vp_52` / `vp_52pl`) non e' una discordanza; se l'impronta non e' nella tabella vale il nome.
   **Cambio macchina automatico** (interruttore sotto la macchina, acceso all'apertura): avviando (o riprendendo) un gioco che la lista segna **«solo Videopac+»** la pagina passa da sola al Videopac+ G7400, se hai il suo BIOS; con un gioco normale torna alla macchina di prima; anche le anteprime di quei giochi si fanno col G7400. Se scegli tu la macchina o il BIOS, la scelta vince e il cambio automatico resta fermo (basta riaccendere l'interruttore per riaverlo); senza il BIOS G7400 la pagina te lo dice. La lista segna cosi' solo Norseman, Helicopter Rescue, Trans-American Rally, Moto Crash e il Home Computer Module (altri giochi che vogliono il Videopac+ non sono segnati: la dimensione della ROM da sola non basta, quindi non si deduce da quella).
   Gli interruttori non si ricordano fra una visita e l'altra (niente `localStorage`).
   **Sotto lo schermo** ci sono i tasti della console, disposti come quelli del G7000 (Avvia, Pausa, Memorizza, Schermo intero e il tasto rosso **Reset console**; scorciatoie F8 pausa, F9 reset, F10 schermo intero). Accanto ci sono due comandi in piu': **«Scambia comandi 1-2»** (gruppo «Giocatori»: i tasti e il gamepad del giocatore 1 muovono il joystick 2 e viceversa, utile nei giochi a turni giocati da soli; resta acceso cambiando gioco e dopo il reset, si salva nella sessione; la tastiera della console non cambia) e **«Filtri CRT»** (gruppo «Schermo»: copia del selettore del pannello «Aspetto»; ogni clic passa all'insieme successivo: nessun filtro, leggero, anni '80, poi il tuo personalizzato se ne hai fatto uno con i cursori, poi di nuovo nessun filtro; il B/N non si tocca). Subito sotto i tasti c'e' la fascia la fascia **«Schermo e suono»** (volume, muto, ingrandimento, proporzioni, multipli interi).
4. Se cambi **macchina (quando cambia BIOS o standard), standard (PAL 50 Hz / NTSC 60 Hz) o set di caratteri** mentre gira un gioco, la console riparte a freddo con quel gioco (la partita
   resta memorizzata): sono cose che cambiano la macchina, non solo l'aspetto. Da G7000 a G7200 (e ritorno) non riparte niente: cambiano solo i colori.

**Editor dei caratteri** (pannello nella pagina). Due schede: il chip video (64 caratteri 8 x 8) e l'EF9341 (256 voci 8 x 10). Griglia dei caratteri, disegno a punti (clic o trascinamento; anche da tastiera),
annulla / ripeti, azzera, inverti, sposta, ribalta, copia / incolla, e il carattere come testo (`#` e `.`) da copiare o condividere. **Le modifiche valgono subito nella partita in corso, senza riavviare**: si ritocca una
cella e si guarda il gioco. «Salva il set (.bin)» scarica il file; un `.bin` (512 o 2560 byte), uno zip che lo contiene (anche zip dentro zip) o un **sorgente C** con la tabella di 512 valori si riaprono con «Aggiungi file...» (punto unico di caricamento);
«Torna al set GPL» rimette quello incluso. Il set modificato resta nella pagina e finisce nella sessione, non altrove. Un set disegnato da te si puo' condividere con la licenza del progetto (GPL-3.0);
un set copiato o ritoccato a partire dall'originale resta un file personale.

**Come procurarti i set di caratteri originali** (la pagina non li contiene: all'apertura li legge da GitHub se c'e' connessione; altrimenti li ricavi tu, per uso personale). Il set del chip video **non sta nelle cartucce ne' nel BIOS**: e' la ROM interna del chip 8244/8245, quindi possedere le cartucce non lo da'. Gli emulatori pero' lo contengono:
1. **O2EM** (la via piu' semplice). Il sorgente C di O2EM ha il set come tabella `cset[512]` nel file `src/cset.c` (**verificato**: sorgente `libretro-o2em` su GitHub, licenza Artistic 2.0).
   - **Con un clic:** in «Macchina e giochi», aprendo **«Set di caratteri»**, il pulsante **«Scarica il set di caratteri del chip video da GitHub»** (o, nell'Editor dei caratteri, «Scarica da O2EM (GitHub)»). La pagina legge il file da `raw.githubusercontent.com` **solo quando premi il pulsante** (non invia nessun dato tuo; la rete e' ammessa solo per indirizzi https), trova la tabella, scrive «set riconosciuto» e mette il set in uso subito, anche nella partita in corso. Il set non e' nel codice di O2web: sta solo nella tua pagina. Poi **«Salva il set (.bin)»** per tenerlo come `charset_i8244.bin`. Provato in Chromium con la pagina aperta da disco (CORS compreso). Il pulsante usa il ramo `master`: se il sito cambia i nomi o il ramo, il messaggio lo dice e restano i passi a mano.
   - **A mano:** apri `https://github.com/libretro/libretro-o2em/blob/master/src/cset.c`, salva il file con «Raw» (o scarica lo zip del sorgente), poi aggiungilo con **«Aggiungi file...»** (il `.c` va bene com'e'; anche lo zip). In locale, da riga di comando:
```sh
python3 tools/extract_charset.py CARTELLA_FILE_O_ZIP -o charset_i8244.bin           # cerca la tabella da 512 valori in qualunque file di testo, anche dentro gli zip
```
2. **MAME**: le raccolte di ROM di MAME tengono il set come file a parte: `charset_i8244.bin` (512 byte). Il CRC-32 dichiarato da MAME, `b46a3f31`, e' **uguale** a quello del set ricavato da O2EM: due fonti indipendenti concordano. I nomi dei file nelle raccolte non li ho potuti controllare (DA VERIFICARE; archive.org non e' raggiungibile dal sandbox di sviluppo). Aggiungi il file (o lo zip) come gli altri.
3. **Videopac+ G7400, ROM dell'EF9341 (2560 byte).** Il file `src/vpp_cset.c` di O2EM (`https://github.com/libretro/libretro-o2em/blob/master/src/vpp_cset.c`) la contiene come tabella `vpp_cset[2][1280]` con i bit scritti **al contrario**. Con i bit rimessi in ordine l'impronta e' CRC-32 `8de85988`, **identica** a quella di `charset_ef9340_1.rom` di MAME (**verificato**): O2EM e MAME hanno gli stessi dati. La pagina li rimette in ordine da sola e accetta la tabella solo se l'impronta e' quella (altrimenti l'ordine dei bit sarebbe una scommessa): usa il pulsante «Scarica il set dell'EF9341 (Videopac+) da GitHub», oppure «Aggiungi file...», oppure `python3 tools/extract_charset.py CARTELLA_O_FILE --ef -o charset_ef9340.rom`. **Attenzione:** questa ROM e' ricavata dal datasheet del chip, **non letta dal chip vero** (MAME la segna come dump «cattivo»): un dump del chip non risulta pubblicato (DA VERIFICARE).

Il file prodotto e' tuo e resta sul tuo computer: non va in zip, repository o screenshot.

**Aspetto e macchina** (pannello «Aspetto e macchina»; solo l'uscita: l'emulazione e i test dei pixel non cambiano, e **con tutto spento l'immagine e' esattamente quella del chip**, 360 x 243).
- **Monitor in bianco e nero** (come il Videopac G7200): i 16 colori diventano grigi con la luminanza standard (`Y = (77 R + 150 G + 29 B + 128) >> 8`). I livelli di grigio della macchina vera sono **da verificare**.
- **Filtri da tubo catodico**, spenti all'inizio: sfocatura del segnale (orizzontale), persistenza del fosforo, alone, righe di scansione, maschera (punti rosso / verde / blu), curvatura dello schermo.
  Tre insiemi pronti («Nessun filtro», «leggero», «anni '80») e un cursore per ciascuno. Righe, maschera e curvatura usano **3 x 3 o 4 x 4 pixel per punto** («Dettaglio»):
  il canvas diventa 1080 x 729 o 1440 x 972 e la pagina lo mostra alla stessa dimensione di prima; il 4 x 4 pesa di piu' (nel sandbox, con tutti i filtri, circa 15-20 ms per fotogramma:
  su un computer lento abbassa il dettaglio o spegni qualche filtro). Non cambiano la temporizzazione dell'emulazione.
- **Disegno della macchina**: sei disegni **originali** (nessuna fotografia, nessun logo o scritta) per Odyssey 2, Videopac G7000, G7200, C52, Jopac e G7400. Si sceglie da solo:
- **Foto delle macchine**: per Odyssey 2, G7000, G7200 e G7400 la pagina mostra una **foto con licenza libera** (cartella `web/photos/`, scelta e fornita dall'utente) al posto del disegno; per C52 e Jopac, di cui non c'e' una foto con fonte nota, resta il disegno originale. Le foto sono ritagliate / ridimensionate a 640 pixel e incorporate nella pagina (circa 100 KB).
  **Le foto non sono coperte dalla GPL del codice**: ognuna ha la propria licenza (CC BY-SA 3.0 o 4.0), con autore, fonte e modifiche elencati in `web/photos/CREDITS.json` e nel pannello «Informazioni e licenza»: Evan-Amos (Odyssey 2), Jzh2074 (G7000 e G7200), Marco van den Hout (G7400), tutte via Wikimedia Commons. **CC BY-SA vuole la stessa licenza per le versioni modificate**: chi ridistribuisce la pagina o i sorgenti con le foto deve mantenere crediti e licenza.
  Il build rifiuta foto con SHA-256 diverso, non WebP, troppo grandi o con licenza non libera (le licenze con clausole NC / ND non sono ammesse); il controllo di rilascio ammette immagini **solo** in `web/photos/` e solo se elencate. Le foto mostrano anche marchi e scritte di terzi presenti nello scatto.
  Per togliere le foto basta svuotare `web/photos/` (restano i disegni).
  il BIOS dell'Odyssey 2 e quello del Videopac G7000 sono lo **stesso file**, quindi decide lo standard (NTSC = Odyssey 2, PAL = G7000); con «Monitor in bianco e nero» la famiglia G7000 diventa il G7200;
  C52, Jopac e G7400 si riconoscono dall'impronta del BIOS; un BIOS sconosciuto si tratta come G7000. «Macchina mostrata» permette di scegliere a mano. Colori e proporzioni dei modelli veri: **da verificare**.
- Le scelte entrano nel file di **sessione** (aspetto e macchina); una sessione senza queste voci (di prima) lascia i valori attuali.

**Comandi.** `F9` = **reset della console** (il tasto RESET della macchina: la cartuccia resta, si torna al menu del BIOS), `F8` = pausa,
`F10` = schermo intero. «Avvia / Riavvia» = avvio a freddo.

**Tasti.** Console: cifre e lettere, `Spazio`, `Invio` (ENT), `Esc` o `Canc` (CLR), `+ - * / = . ? :`. **Joystick 1**: frecce, `Ctrl` = fuoco.
**Joystick 2**: tastierino numerico (8-4-5-6, `0` = fuoco); per i portatili senza tastierino c'e' il preset `I J K L` + `;` (le lettere diventano
joystick). In «Tasti, joystick e gamepad» ogni azione si puo' riassegnare («Cambia», poi premi il tasto). **Gamepad**: qualunque pad con
mappatura standard (croce o levetta = direzioni, A B X Y e dorsali = fuoco, Start = ENT, Indietro = CLR); un pad per giocatore, in automatico o a scelta.
C'e' anche una **tastiera a schermo** (utile col mouse o col tocco).

**Telefono e tablet.** Con lo schermo tattile accanto allo schermo compaiono i **comandi a tocco**: croce del joystick 1 a sinistra, «Fuoco» e «Tastiera» a destra
(direzione e fuoco insieme si possono premere con due dita). In «Tasti, joystick e gamepad»: «Comandi a tocco» (automatici, sempre, mai) e «Joystick a tocco»
(croce fissa, oppure uno stick che nasce dove appoggi il dito e lo segue). In orizzontale schermo e comandi stanno affiancati; lo schermo intero tiene anche i comandi.
Provato su un telefono Android vero (Chrome); iPhone non ancora provato.

**Suono.** Il suono parte con il primo clic o tasto (regole del browser); volume e «Muto» sotto lo schermo. Il ritmo dell'emulazione lo da' l'orologio della pagina,
con una piccola correzione (al massimo 0,5%) dall'audio; la riserva di suono in coda si adatta da sola al browser (di piu' sui telefoni che fanno avanzare
l'audio a blocchi grandi). Sotto lo schermo le statistiche mostrano fotogrammi al secondo, ridisegni, vuoti dell'audio, riserva e ritardo dichiarato dal browser. Il suono e' modellato da documentazione di terzi e non e' stato confrontato con la macchina vera (vedi `o2web-stato.md`).

**Stato di una partita.** «Salva stato» scarica un file `.o2state` con lo stato della macchina e le impronte SHA-256 di BIOS, cartuccia e set di caratteri, **non** i file;
«Aggiungi file...» (o trascinarlo sulla pagina) lo riprende cercando nell'elenco BIOS e cartuccia giusti. Stati di un altro BIOS, di un'altra cartuccia, di un altro
standard o corrotti si rifiutano con un messaggio, senza toccare la partita in corso.

**Rete e copertine (tappa 4c).** Nel pannello «Rete e copertine»:
- **Scarica da un indirizzo.** Scrivi un indirizzo `https://...` (un `.bin` o un archivio `.zip`), scegli se sono «Giochi e BIOS» o «Copertine» e premi **Scarica**
  (o Invio). Il file si tratta come se l'avessi scelto dal disco. Il limite e' 128 MB, lo scarico si puo' annullare, e se il sito non manda dati per 30 secondi si interrompe.
  Una sessione o uno stato di gioco **non** si aprono da un indirizzo (sostituirebbero la partita in corso): salvali sul disco e aprili da li'.
- **Archivi compressi.** Se un sito non permette la lettura da un'altra pagina (come archive.org, **provato in un browser vero il 15/10/2026**: regola CORS), scarica l'archivio `.zip` con il browser e aggiungilo con «Aggiungi file…» (o trascinalo sulla pagina). Gli archivi possono contenere giochi e BIOS di terzi: scarica solo cio' che hai il diritto di avere.
- Il pannello Rete non ha indirizzi suggeriti: resta per qualsiasi indirizzo https che permetta la lettura da un'altra pagina (come GitHub).
- **Copertine.** Immagini PNG, JPEG, WebP o GIF (anche in uno zip, in uno zip di zip o in una cartella; da disco o da un indirizzo), abbinate al gioco **per titolo** (nome con anno, editore e paese tra parentesi come
  «Killer Bees (1981)(Philips)(EU).png», oppure semplice, come «Killer Bees.png»; articoli, maiuscole e accenti non contano; a parita' di titolo scelgono anno, paese ed editore;
  una cartella chiamata «Box» o «Cover» e' una copertina, «Snaps» o «Titles» una schermata). Compaiono come miniatura nell'elenco e in grande per il gioco in uso. **Restano solo in memoria nel browser:**
  non entrano nella sessione, non vengono inviate, si perdono chiudendo la pagina. Le copertine, come i giochi, restano dei rispettivi titolari e le porti tu. Le immagini sono controllate
  dall'intestazione (massimo 8 MB e 8192 x 8192 punti ciascuna, 256 MB in tutto): un file che non e' un'immagine o e' troppo grande si salta con il motivo.

**Modulo scacchi Philips C7010 (Videopac, 1982, solo Europa).** E' un secondo computer dentro la cartuccia: un Z80 con una ROM da 8 KB. Servono **due file** che porti tu:
la cartuccia da 2 KB (si aggiunge come un gioco) e la ROM da 8 KB dello Z80 (di solito `z80_c7010.bin`); si riconoscono dalla dimensione e dal CRC-32, non dal nome, anche dentro uno zip, e
la ROM dello Z80 compare nel riquadro «Set di caratteri e modulo scacchi» (la sessione la conserva). Con il G7000 / G7200 in **PAL** (la cartuccia e' europea: con i tempi NTSC non legge piu' i tasti) si
gioca con la tastiera della console: **Y** (o **N**) alla prima domanda, il livello (1-6), poi le mosse come lettera e cifra (per esempio E 2 E 4) e **INVIO**. Non c'e' con il G7400. Tutto il comportamento
del modulo (porte, cancello dei latch, velocita' dello Z80) e' **da verificare** sulla macchina vera: vedi `src/chessmod.js`.

**Sessione.** «Salva sessione» scarica **un solo file** (uno zip senza compressione) con l'elenco, **tutti i dump**, il set di caratteri (anche quello dell'EF9341, se c'e'), lo stato di ogni gioco, il gioco in uso
e le impostazioni; «Aggiungi file...» (o trascinarla sulla pagina) ritrova tutto, e la partita riprende dove l'avevi lasciata. **Attenzione: la sessione contiene i dump
(BIOS, cartucce, set di caratteri) che hai caricato: e' un file personale, non condividerlo.** Viene creata solo dal tuo browser, con i tuoi file; questo progetto non ne produce ne'
ne distribuisce. La lettura e' severa: una sessione con voci mancanti, in piu', duplicate o alterate (controllo SHA-256) viene rifiutata prima di toccare la partita in corso.

Cartucce supportate: 2, 4 e 8 KB (cambio di banco con P1), 4 KB a mappa lineare, 16 KB (8 banchi da 2 KB, banco scelto con un MOVX e il bit 4 di P1) e 12 KB (letti come la parte alta di una finestra da 16 KB). Altre dimensioni oltre gli 8 KB sono segnalate come non supportate.

**Videopac+ G7400: che cosa e' sicuro e che cosa no.** Il modello dell'EF9340 / EF9341 (accessi, comandi, memoria di pagina, caratteri ridefinibili, zoom, boxing, flash, cursore) e' stato confrontato con il datasheet Thomson «EF9340/EF9341 Semi-graphic CRT display processor» e corretto dove lo contraddiceva; il progetto e' stato provato contro un riferimento scritto a parte in Python, non contro l'hardware. **Restano «da verificare»** (il datasheet non li copre): il mixer con l'8245 e lo scarto dello schermo EF (stanno nella logica del G7400), i tempi esatti di «occupato» (non modellati: il bit resta 0), la numerazione dei colori fra 8245 e mixer, il pin B per ogni cartuccia, la disposizione dei file da 12 KB, quale meta' di un delimitatore di bordo del boxing e' trasparente e la forma del set di caratteri dell'EF9341 (il datasheet ne mostra le tabelle solo come figure). Se un gioco Videopac+ mostra testo o colori sbagliati, e' probabile che il motivo sia uno di questi punti.

## Pubblicare su Vercel (sito statico: nessuna funzione sul server)
O2web e' un sito statico: un solo file HTML, nessun intermediario, nessun server che veda i file dell'utente. `vercel.json` dice a Vercel di costruirlo con
`node tools/build.js dist/index.html` e di servire la cartella `dist`, con le intestazioni di sicurezza (la pagina puo' leggere solo indirizzi https, e solo su richiesta dell'utente; nessun incorporamento in altri siti, nessun referrer).
- **Da Git:** metti il repository (senza dump: `.gitignore` esclude `*.bin`, `*.zip`, immagini e le cartelle di prova `_tosec*`) su GitHub e importalo in Vercel (preset «Other»; il resto lo
  decide `vercel.json`).
- **A mano:** `node tools/build.js dist/index.html` e poi, dalla cartella del progetto, `vercel deploy dist --prod` (serve la CLI di Vercel).
- **Provato il 30/10/2026:** il sito <https://o2web-flame.vercel.app/>, costruito da Vercel dal repository GitHub con la configurazione di `vercel.json`, avvia l'emulatore e carica BIOS e cartuccia.
- La regola di sicurezza (`connect-src https:`) e' uguale nella pagina (`web/index.template.html`) e in `vercel.json`: il build rifiuta di procedere se non coincidono o se qualcuno la allarga.
  Il sito non ha funzioni sul server e non fa da intermediario: gli scarichi vanno dal browser dell'utente direttamente al sito che ha indicato.
- **Codice sorgente (GPL):** la pagina contiene tutto il codice JavaScript in chiaro; i moduli separati, i test e gli strumenti stanno nel repository <https://github.com/agara73/o2web>
  (collegato anche dalla sezione «Informazioni e licenza» della pagina).

## Per chi sviluppa (servono Node.js 22 e Python 3; per la prova nel browser anche Playwright con Chromium)
```sh
node tools/build.js                        # scrive dist/o2web.html (tutti i moduli di src/ + hw/charset_own.js + il testo di LICENSE, in un solo file)
node tools/build.js dist/index.html        # lo stesso, con il nome che serve a Vercel
sh test/run_all.sh CARTELLA_DEI_DUMP       # tutti i test (circa 12 minuti); --mutation aggiunge la prova di mutazione (molti minuti); con Z80_LIB=CARTELLA_Z80 anche le prove differenziali del Z80 e del modulo scacchi
python3 -I tools/check_release.py . --dumps CARTELLA_DEI_DUMP   # prima di consegnare: licenza e copyright ovunque, nessun dump o immagine nel pacchetto
python3 -I tools/make_vplist.py LISTA.html -o src/vplist_data.js   # rigenera i dati del catalogo dalla lista HTML di Maurice Simon (solo sviluppo)
python3 -I test/test_vplist_parse.py LISTA.html   # lettura della lista contro un oracolo indipendente (testo della pagina)
node test/vplist_infos.js CARTELLA_DEI_DUMP /tmp/vp/infos.json && python3 -I test/vplist_vectors.py /tmp/vp/vec.json /tmp/vp/infos.json && node test/test_vplist.js /tmp/vp/vec.json   # abbinamento ROM -> catalogo contro hw/vplist_ref.py (riferimento indipendente)
node test/test_sha1.js && node test/test_gamenames.js && node test/test_gamelist.js   # tappa 7: SHA-1, sigle e nomi (tabella src/gamedb_data.js), elenco unito e filtri
python3 -I tools/make_gamedb.py videopac.xml -o src/gamedb_data.js   # rigenera la tabella sigle / impronte / nomi dalla lista software di MAME (solo sviluppo; non contiene dati delle ROM)
python3 -I test/preview_vectors.py /tmp/pv/vec.json && node test/test_preview.js /tmp/pv/vec.json && node test/test_previews.js   # anteprime: punteggio e riduzione contro hw/preview_ref.py (riferimento indipendente), coda a fette e cache
O2_DUMPS=CARTELLA_DEI_DUMP python3 -I test/preview_record.py /tmp/pv && node test/preview_run.js /tmp/pv CARTELLA_DEI_DUMP   # console JavaScript contro il modello per riga (hw/o2line.py), scenari end-to-end
node test/test_app_list.js CARTELLA_DEI_DUMP   # regista: elenco unito, nomi da Gamelist, anteprime
python3 -I test/browser_list.py dist/o2web.html CARTELLA_DEI_DUMP /tmp/shots   # tappa 7 nella pagina intera (screenshot locali: mostrano i giochi)
node test/test_usability.js CARTELLA_DEI_DUMP   # scambio dei comandi 1-2 e pulsante Filtri CRT (ingressi, regista, sessione)
python3 -I test/browser_plate.py dist/o2web.html CARTELLA_DEI_DUMP /tmp/shots   # i due pulsanti sotto lo schermo nella pagina intera (screenshot della sola barra)
node test/test_i18n.js                     # lingue: t(), tabella inglese (src/lang_en.js), ogni T('...') ha la voce, modelli e frammenti, i moduli di base restano in italiano
python3 -I test/browser_i18n.py dist/o2web.html CARTELLA_DEI_DUMP /tmp/shots   # lingue nella pagina intera: inglese predefinito, bandiere, ritorno senza residui, donazioni
node test/test_z80_misc.js                 # tappa 6a: Z80 (src/z80.js), prove puntuali (flag non documentati, MEMPTR, interrupt, NMI, HALT, stato)
python3 -I test/z80_record.py /tmp/z --lib CARTELLA_Z80 && node test/z80_run.js /tmp/z   # Z80 passo per passo contro il pacchetto Python `z80` 1.2.0 (solo sviluppo: pip install --target CARTELLA_Z80 z80==1.2.0)
node test/zex_run.js zexdoc.com            # ZEXDOC / ZEXALL (programmi di terzi, da portare da fuori; lunghi)
node test/test_chess.js && node test/test_chess_app.js   # modulo scacchi con una ROM di prova originale (test/chess_testrom.js), cancello dei latch, stato, libreria, sessione, regista
node test/chess_testrom.js /tmp/c && python3 -I test/chess_record.py /tmp/c --lib CARTELLA_Z80 && node test/chess_run.js /tmp/c   # modulo + console contro hw/chessmod_ref.py (PAL e NTSC)
node test/chess_real.js CARTELLA_DEI_DUMP  # con le ROM VERE in DUMPS/chess/ (vp_c7010.bin, z80_c7010.bin): il motore risponde alle mosse; si salta se mancano
node test/test_unzip.js                    # apertura degli zip (deflate contro zlib, zip rotti)
node test/test_zipstore.js                 # scrittura di zip senza compressione (controllo con Python e unzip)
node test/test_g7400.js CARTELLA_DEI_DUMP   # tappa 5: MOVX verso l'EF9341, mappe da 12 / 16 KB, mixer e CX nella console, stato v3, regista (BIOS G7400, set EF9341, pin B)
python3 -I test/ef_record.py /tmp/e.json && node test/ef_run.js /tmp/e.json   # EF9340/41 contro hw/ef934x_ref.py (riferimento scritto a parte)
node test/test_misc.js                     # SHA-256, mappe delle cartucce, MOVX, tastiera, tempo, colori
node test/test_state.js CARTELLA_DEI_DUMP  # salva / carica stato, ripresa deterministica, stati falsi
python3 -I test/audio_ref.py /tmp/a && node test/test_audio.js /tmp/a CARTELLA_DEI_DUMP   # suono: PCM contro il riferimento in Python, ripresa deterministica
node test/test_input.js CARTELLA_DEI_DUMP  # tastiera, joystick 1 e 2, gamepad, tasti configurabili
node test/test_library.js CARTELLA_DEI_DUMP  # elenco giochi / BIOS / set di caratteri, zip annidati (archivi finti e, in locale, quelli veri); include test/lib_extra.js
node test/test_session.js CARTELLA_DEI_DUMP  # sessione: andata e ritorno, sessioni false o rotte, ripresa deterministica
node test/test_webaudio.js                 # uscita Web Audio con un AudioContext finto
node test/test_photos.js                   # foto delle macchine: crediti (CREDITS.json), licenze libere, SHA-256, WebP, pagina
python3 -I test/look_record.py /tmp/l && node test/test_look.js /tmp/l CARTELLA_DEI_DUMP   # aspetto: filtri e B/N bit per bit contro hw/look_ref.py (riferimento indipendente), macchine e disegni
node test/test_net.js                     # rete su richiesta con un fetch FINTO (nessuna richiesta vera): indirizzi, limiti, attesa, annullamento, reindirizzamenti, CSP, scansione statica
node test/test_covers.js                   # copertine: riconoscimento delle immagini, nomi con anno e paese, abbinamento, zip annidati, limiti (immagini sintetiche)
node test/test_app_net.js                  # regista con scarico e copertine: smistamento, sessioni rifiutate dalla rete, annullamento, messaggi esatti
node test/test_app.js CARTELLA_DEI_DUMP    # regista senza DOM: cambio gioco, set di caratteri, stati, BIOS, sessioni, passo (anche un telefono con l'audio a blocchi); include test/app_extra.js
python3 -I test/touch_vectors.py /tmp/t.json && node test/test_touch.js /tmp/t.json   # tappa 8: joystick a tocco contro hw/touch_ref.py (riferimento indipendente)
python3 -I test/pacer_vectors.py /tmp/p.json && node test/test_pacer.js /tmp/p.json   # tappa 8: passo dell'emulazione contro hw/pacer_ref.py (computer, telefoni, pause)
python3 -I test/browser_mobile.py dist/o2web.html CARTELLA_DEI_DUMP /tmp/shots   # tappa 8: pagina su un telefono simulato (tocchi veri, verticale e orizzontale, inglese)
python3 -I test/vdc_stress.py /tmp/s.json && node test/vdc_stress.js /tmp/s.json     # chip video: prova casuale contro il modello
python3 -I test/browser_check.py dist/o2web.html CARTELLA_DEI_DUMP /tmp/shots         # pagina intera in Chromium (screenshot locali)
node tools/survey_carts.js BIOS.bin CARTELLA_CARTUCCE --frames 300                    # classificazione dinamica delle cartucce
node tools/survey_sound.js BIOS.bin CARTELLA_CARTUCCE --frames 600                    # uso dei registri del suono nelle cartucce
```
I dump stanno in una cartella tua (`bios/o2rom.bin`, `blockout.bin`, ...; per le prove sugli archivi anche `_tosec_o2/` e `_tosec_vp/`, le cartelle estratte dai due
archivi di giochi; vedi `test/run_all.sh`): non vanno mai in un pacchetto o nel repository. Le prove che usano i dump veri partono solo se la cartella c'e'.
Gli screenshot della prova nel browser mostrano grafica dei giochi: restano in locale.

Struttura: `src/cpu8048.js` (nucleo), `src/console.js` (bus, MOVX, tastiera, joystick, stato), `src/cartmap.js` (mappe delle cartucce), `src/vdc.js` (chip video per
riga e suono), `src/ef934x.js` (EF9340 / EF9341 del G7400: memoria, comandi, resa per riga, mixer e collisioni con l'8245), `src/audio.js` (dal livello del suono ai campioni, deterministico), `src/webaudio.js` (uscita Web Audio), `src/input.js` (tastiera, joystick, gamepad),
`src/library.js` (elenco giochi / BIOS, nomi dei file, riconoscimento del set di caratteri), `src/z80.js` (Z80 / NSC800, tappa 6a) e `src/chessmod.js` (modulo scacchi C7010: Z80, ROM, RAM e due latch verso l'8048), `src/session.js` + `src/zipstore.js` (file di sessione), `src/app.js` (regista senza DOM),
`src/netfetch.js` (l'unico punto della pagina che usa la rete, solo su richiesta; il build controlla che nessun altro modulo usi fetch, WebSocket, ecc.) e `src/covers.js` (copertine),
`src/look.js` (aspetto: B/N e filtri, funzioni pure sul fotogramma), `src/machines.js` (elenco delle macchine, BIOS adatti, disegno) e `src/photos.js` (crediti delle foto in `web/photos/`), `src/screen.js` e `src/ui.js` (pagina), `src/sha256.js`, `src/unzip.js`; `hw/look_ref.py` e `hw/o2line.py`, `hw/o2g7400.py`, `hw/ef934x_ref.py`, `hw/o2audio.py` e `hw/o2hw.py` sono i modelli di riferimento in Python; `ref/` il riferimento CPU;
`test/` i test; `tools/` strumenti (build, controllo di rilascio, classificazione delle cartucce, ricavo del set di caratteri); `web/index.template.html` la pagina.
Ogni file di codice porta in testa «(c) 2026 by Agara73» e `SPDX-License-Identifier: GPL-3.0-only` (fa eccezione `test/line_scenarios.json`: JSON, senza commenti).

## Tradurre o correggere i testi
I sorgenti sono in italiano. I testi che scrive il codice passano da `t('testo italiano con {segnaposti}', {valori})` (`src/i18n.js`) e la loro versione inglese sta in `src/lang_en.js` (chiave = testo italiano; le chiavi che iniziano con `~` sono frammenti dei messaggi dei moduli di base; `{n|uno|altri}` e' il plurale). I testi fissi dell'HTML (`web/index.template.html`) restano in italiano e la loro versione inglese sta in `src/lang_en_dom.js` (chiave = contenuto HTML del blocco, a spazi normalizzati). Se cambi un testo italiano devi cambiare anche la chiave: `node test/test_i18n.js` e `test/browser_i18n.py` dicono che cosa manca o e' superato.

## Licenza
O2web - (c) 2026 by Agara73. Questo programma e' software libero secondo i termini della **GNU General Public License, versione 3** (solo la versione 3, non «o successive»);
il testo completo e' in `LICENSE` ed e' anche dentro la pagina («Informazioni e licenza»). La licenza copre **solo il codice**: giochi, BIOS, set di caratteri e copertine
restano dei rispettivi titolari e non fanno parte del progetto.

**Dati del catalogo (`src/vplist_data.js`): NON sono sotto la GPL.** Vengono dalla *Videopac/Odyssey2 Cartridge list* v0.74 (28/01/2006) di **Maurice Simon** <maurice@videopac.info> (www.renelips.nl), che ne permette la copia, intera o in parte, senza scopo di lucro e citandolo. Se pubblichi O2web a fini di lucro (o in un modo non compatibile con quella condizione) togli quel file e `src/vplist.js`: il resto funziona lo stesso. I nomi delle ROM usati per l'abbinamento sono quelli della lista software di MAME (CC0).

```
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License
as published by the Free Software Foundation, version 3 of the License.
This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```
