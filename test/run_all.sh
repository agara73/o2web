#!/bin/sh
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
# run_all.sh - tutti i test delle tappe 1 (nucleo 8048 JavaScript), 2 (console + video per riga + stato), 3 (suono, ingressi, elenco,
# sessione, regista, pagina), 7 (elenco a voci con fusione dei duplicati, sigle, anteprime), 4 (file unico con licenza, set di caratteri come ingresso, controllo di rilascio) e 4b (aspetto). Solo per sviluppatori:
# servono Python 3 e Node.js (e, per il punto 10, Playwright con Chromium).
# Uso: sh test/run_all.sh DUMPS [--mutation]      (variabile facoltativa Z80_LIB: cartella del pacchetto Python z80 1.2.0 per le prove differenziali della tappa 6a)
#   DUMPS: cartella locale con bios/o2rom.bin, bios/g7400.bin, blockout.bin, killerbees.bin, pickaxepete.bin, demonattack.bin
#          (i tuoi dump: non fanno parte del progetto e non vanno mai inclusi nei pacchetti). Per gli scenari in piu' della tappa 2
#          (cartucce lineari, specchio 0xC00, contatore, 8 KB: vedi test/line_scenarios.json) servono anche i file indicati sotto
#          `carts/`: quelli che mancano si saltano.
#          Facoltative anche DUMPS/chess/vp_c7010.bin e DUMPS/chess/z80_c7010.bin (modulo scacchi C7010: prova con le ROM vere, si salta se mancano).
#   --mutation: aggiunge la prova di mutazione (alcuni minuti)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
DUMPS=${1:?"serve la cartella dei dump: sh test/run_all.sh DUMPS [--mutation]"}
export O2_DUMPS="$DUMPS"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# tl N comando...: esegue il comando, ne mostra le ultime N righe e FALLISCE se il comando fallisce (con `comando | tail` l'uscita di tail nasconderebbe l'errore)
tl() {
  n=$1; shift
  "$@" > "$WORK/step.out" 2>&1 && rc=0 || rc=$?
  tail -n "$n" "$WORK/step.out"
  if [ "$rc" -ne 0 ]; then echo "FALLITO (uscita $rc): $*"; cat "$WORK/step.out"; exit 1; fi
}
echo "== 1. riferimento CPU (Python), tabelle opcode, disassemblatore"
tl 1 python3 -I "$ROOT/ref/test_ref8048.py"
tl 1 python3 -I "$ROOT/ref/check_i48.py"
tl 1 python3 -I "$ROOT/tools/dis48.py" --selftest
echo "== 2. test differenziale JS contro ref8048.py (casuali, ogni opcode, interrupt, contatore, reset)"
python3 -I "$HERE/difftest.py"
echo "== 3. interfaccia del nucleo"
tl 1 node "$HERE/test_api.js"
echo "== 4. BIOS + cartucce: registra e riproduci"
python3 -I "$HERE/replay.py" "$WORK/replay"
node "$HERE/replay_run.js" "$WORK/replay" "$DUMPS"
echo "== 5. avvio dal vivo del BIOS fino al menu e dentro il gioco (console minima di prova)"
node "$HERE/boot_menu.js" "$DUMPS" "$WORK/replay"
echo "== 6. tappa 2: console JS + chip video JS contro il modello per riga (CPU, collisioni, T1, banchi, righe)"
python3 -I "$HERE/line_record.py" "$WORK/line" --frames 70
node "$HERE/line_run.js" "$WORK/line" "$DUMPS"
echo "== 7. chip video: prova casuale (registri e set di caratteri casuali, scritture a meta' fotogramma, PAL e NTSC)"
python3 -I "$HERE/vdc_stress.py" "$WORK/stress.json" --cases 150 --seed 2
node "$HERE/vdc_stress.js" "$WORK/stress.json"
echo "== 8. console: prove puntuali (SHA-256, mappe delle cartucce, MOVX, tastiera, temporizzazione, colori)"
node "$HERE/test_misc.js"
echo "== 9. stato di gioco: andata e ritorno, ripresa deterministica, rifiuto di stati falsi o corrotti"
node "$HERE/test_state.js" "$DUMPS"
echo "== 9b. file in uno zip: deflate contro zlib, contenitore, zip rotti"
node "$HERE/test_unzip.js"
echo "== 9c. suono: campioni PCM contro il riferimento esatto in Python, ripresa deterministica, tasto RESET"
tl 1 python3 -I "$HERE/audio_ref.py" "$WORK/audio" --line "$WORK/line"
node "$HERE/test_audio.js" "$WORK/audio" "$DUMPS"
echo "== 9d. ingressi: tastiera, joystick 1 e 2 configurabili, gamepad, tastiera a schermo"
node "$HERE/test_input.js" "$DUMPS"
echo "== 9e. zip scritti, elenco giochi / BIOS (archivi annidati), sessione, uscita Web Audio"
node "$HERE/test_zipstore.js"
node "$HERE/test_library.js" "$DUMPS"
node "$HERE/test_session.js" "$DUMPS"
node "$HERE/test_webaudio.js"
echo "== 9f. regista (app.js): cambio di gioco, stati memorizzati, BIOS, sessioni, passo guidato dall'audio"
node "$HERE/test_app.js" "$DUMPS"
echo "== 9g. tappa 4b - aspetto: monitor B/N e filtri da tubo catodico contro il riferimento Python indipendente, scelta e disegno della macchina"
tl 1 python3 -I "$HERE/look_record.py" "$WORK/look"
tl 2 node "$HERE/test_look.js" "$WORK/look" "$DUMPS"
echo "== 9h. foto delle macchine: crediti, licenze libere, SHA-256, WebP, pagina"
tl 2 node "$HERE/test_photos.js"
echo "== 9i. tappa 4c - rete su richiesta (fetch finto), copertine, regista con scarico e abbinamento, regola di sicurezza della pagina (CSP)"
node "$HERE/test_net.js"
node "$HERE/test_covers.js"
node "$HERE/test_app_net.js"
echo "== 9j. tappa 5 - EF9340/41 (G7400): accessi, comandi, memoria, resa per riga, mixer e CX contro il riferimento Python (tutto DA VERIFICARE)"
python3 -I "$HERE/ef_record.py" "$WORK/ef.json" --cases 40 --seed 3
node "$HERE/ef_run.js" "$WORK/ef.json"
node "$HERE/test_g7400.js" "$DUMPS"
echo "== 9k. editor dei set di caratteri (charedit.js) e set GPL di ripiego (chip video, EF9341)"
node "$HERE/test_charedit.js"
node "$HERE/test_charlive.js" "$DUMPS"
tl 1 python3 -I "$HERE/test_extract_charset.py"
echo "== 9l. tappa 5c - la macchina come scelta unica (BIOS, standard e schermo B/N seguono la macchina; sessioni vecchie e nuove)"
node "$HERE/test_machine.js" "$DUMPS"
echo "== 9m. tappa 5d - lingue: inglese predefinito, tabelle, modelli, frammenti, plurali; i moduli di base restano in italiano"
node "$HERE/test_i18n.js"
echo "== 9n. tappa 6a - Z80 (z80.js) e modulo scacchi C7010 (chessmod.js): prove puntuali, sessione, regista; differenziale contro il pacchetto Python z80 (Z80_LIB)"
tl 1 node "$HERE/test_z80_misc.js"
tl 1 node "$HERE/test_chess.js"
tl 1 node "$HERE/test_chess_app.js"
node "$HERE/chess_testrom.js" "$WORK/chess" > /dev/null
tl 3 node "$HERE/chess_real.js" "$DUMPS"
if [ -n "$Z80_LIB" ] && [ -d "$Z80_LIB/z80" ]; then
  tl 1 python3 -I "$HERE/z80_record.py" "$WORK/z80rec" --lib "$Z80_LIB"
  tl 1 node "$HERE/z80_run.js" "$WORK/z80rec"
  tl 1 python3 -I "$HERE/chess_record.py" "$WORK/chess" --lib "$Z80_LIB" --cycles 150000
  tl 2 node "$HERE/chess_run.js" "$WORK/chess"
else
  echo "Z80_LIB non impostata (cartella con il pacchetto Python z80 1.2.0, pip install --target): prova differenziale del Z80 e del modulo saltata"
fi
echo "== 9o. tappa 7 - elenco a voci: SHA-1, sigle e nomi (tabella da MAME, elenchi di nomi), fusione dei dump identici, anteprime (riferimento Python indipendente, console contro modello)"
tl 1 node "$HERE/test_sha1.js"
node "$HERE/test_gamenames.js" "$DUMPS"
tl 1 node "$HERE/test_gamelist.js" "$DUMPS"
tl 1 node "$HERE/test_previews.js"
python3 -I "$HERE/preview_vectors.py" "$WORK/prev_vec.json" > /dev/null
tl 2 node "$HERE/test_preview.js" "$WORK/prev_vec.json"
mkdir -p "$WORK/prev"
cp "$WORK/prev_vec.json" "$WORK/prev/vec.json"
python3 -I "$HERE/preview_record.py" "$WORK/prev" --only o2_blockout,o2_killerbees,o2_4in1row_linear,o2_missao_mirror,o2_popeye_8k,ntsc_popeye_8k,o2_typetell_counter4k,o2_armored_counter
tl 1 node "$HERE/preview_run.js" "$WORK/prev" "$DUMPS"
tl 1 node "$HERE/test_app_list.js" "$DUMPS"
tl 1 node "$HERE/test_automachine.js" "$DUMPS"
echo "== 9q. comandi sotto lo schermo: scambio dei comandi dei giocatori 1-2 (tasti, gamepad, sessione) e pulsante Filtri CRT (ciclo degli insiemi pronti)"
tl 1 node "$HERE/test_usability.js" "$DUMPS"
echo "== 9p. catalogo delle cartucce (lista di Maurice Simon): abbinamento ROM -> gioco contro il riferimento Python indipendente; lettura della lista HTML se O2_VPLIST la indica"
node "$HERE/vplist_infos.js" "$DUMPS" "$WORK/vp_infos.json" > /dev/null
python3 -I "$HERE/vplist_vectors.py" "$WORK/vp_vec.json" "$WORK/vp_infos.json" > /dev/null
tl 1 node "$HERE/test_vplist.js" "$WORK/vp_vec.json"
if [ -n "$O2_VPLIST" ] && [ -f "$O2_VPLIST" ]; then
  tl 1 python3 -I "$HERE/test_vplist_parse.py" "$O2_VPLIST"
else
  echo "O2_VPLIST non impostata (file HTML della lista delle cartucce): prova della lettura della lista saltata"
fi
echo "== 9r. tappa 8 - joystick a tocco (touch.js): direzioni e sequenze di dita contro il riferimento Python indipendente (hw/touch_ref.py)"
python3 -I "$HERE/touch_vectors.py" "$WORK/touch_vec.json" > /dev/null
tl 1 node "$HERE/test_touch.js" "$WORK/touch_vec.json"
echo "== 10. file HTML unico (build) e prova nel browser vero (si salta se manca Playwright)"
node "$ROOT/tools/build.js" "$WORK/o2web.html"
if python3 -c "import playwright" 2>/dev/null; then
  tl 3 python3 -I "$HERE/browser_check.py" "$WORK/o2web.html" "$DUMPS" "$WORK/shots"
  tl 3 python3 -I "$HERE/browser_i18n.py" "$WORK/o2web.html" "$DUMPS" "$WORK/shots_i18n"
  tl 3 python3 -I "$HERE/browser_list.py" "$WORK/o2web.html" "$DUMPS" "$WORK/shots_list"
  tl 3 python3 -I "$HERE/browser_plate.py" "$WORK/o2web.html" "$DUMPS" "$WORK/shots_plate"
else
  echo "Playwright non installato: prova nel browser saltata"
fi
echo "== 10b. controllo di rilascio: copyright e licenza in ogni file, nessun dump ne' immagine nei sorgenti"
python3 -I "$ROOT/tools/check_release.py" "$ROOT" --dumps "$DUMPS" > "$WORK/release.txt" || { cat "$WORK/release.txt"; exit 1; }
tail -3 "$WORK/release.txt"
if [ "$2" = "--mutation" ]; then
  echo "== 11. prova di mutazione: CPU (cache dei casi rapidi + replay) e moduli delle tappe 2 e 3"
  tl 1 python3 -I "$HERE/difftest.py" --quick --save-cache "$WORK/cache_quick.json"
  python3 -I "$HERE/mutate.py" "$WORK/cache_quick.json" "$WORK/replay" "$DUMPS" --n 0
  for t in cartmap sha256 unzip console vdc audio input zipstore library session webaudio app look machines screen photos netfetch covers ef934x charedit i18n chessmod sha1 gamenames gamelist vplist preview previews touch; do
    python3 -I "$HERE/mutate2.py" $t --dumps "$DUMPS" --stress "$WORK/stress.json" --rec "$WORK/line" --audio-ref "$WORK/audio" --look-ref "$WORK/look" --ef-ref "$WORK/ef.json" --prev-ref "$WORK/prev" --vp-vec "$WORK/vp_vec.json" --touch-vec "$WORK/touch_vec.json" | head -2
  done
  if [ -n "$Z80_LIB" ] && [ -d "$Z80_LIB/z80" ]; then
    python3 -I "$HERE/mutate2.py" z80 --dumps "$DUMPS" --stress "$WORK/stress.json" --rec "$WORK/line" --z80-ref "$WORK/z80rec" --n 250 | head -2
  fi
  python3 -I "$HERE/mutate2.py" cpu8048 --dumps "$DUMPS" --stress "$WORK/stress.json" --rec "$WORK/line" --cache "$WORK/cache_quick.json" --replay "$WORK/replay" | head -2
fi
echo "TUTTO OK"
