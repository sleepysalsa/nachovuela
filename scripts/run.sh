#!/bin/bash
# ============================================================
# NachoVuela — una corrida del motor + publicación de los datos.
# Se puede correr a mano o dejar agendada (ver scripts/agendar.md).
#
#   bash scripts/run.sh            → corrida COMPLETA (radar + buscador y extras)
#   bash scripts/run.sh --rapido   → solo el radar (el turno de cada hora)
#
# El script decide SI corresponde correr antes de gastar batería y datos:
# hay tres compuertas (corrida en curso, frescura del dato, tapa+batería).
# ============================================================
set -e

# Carpeta raíz del proyecto (un nivel arriba de este script)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

MODO="completo"
if [ "$1" = "--rapido" ]; then MODO="rapido"; fi

# ------------------------------------------------------------------
# Perillas (lo único que hay que tocar si algo cambia)
# ------------------------------------------------------------------
# Flags con las que el motor corre cada mitad de un completo por separado,
# para poder publicar en dos etapas. Si el motor todavía no las acepta, el
# script lo detecta solo (mira su --help) y hace una sola etapa como siempre.
FLAG_RADAR="--solo-radar"
FLAG_EXTRAS="--solo-extras"

# Techo de duración por modo. Un rápido sano tarda ~7 min y un completo ~25
# (en dos etapas, ~20 la más larga). Lo que pase de acá está congelado: la Mac
# se durmió en el medio. El umbral viejo era 90 min para los dos, y encima
# nunca se llegaba a evaluar (ver el vigilante más abajo).
LIMITE_RAPIDO_MIN=20
LIMITE_COMPLETO_MIN=45

# Un rápido no hace nada si los datos del radar son más nuevos que esto.
# Con turnos cada hora, 90 min deja el dato con ~2 h de antigüedad máxima:
# el turno de +53 min se saltea y el de +1 h 53 corre. Si pusiéramos 120 se
# saltearía también ese y terminaríamos barriendo cada 3 h en vez de cada 2.
FRESCO_MIN=90

# ------------------------------------------------------------------
# PARA PROBAR (nada de esto se usa en la corrida real)
#   NV_MOTOR=ruta/al/motor.py     usa otro motor (ej: uno falso de prueba)
#   NV_TAPA=Yes|No                finge el estado de la tapa
#   NV_ENERGIA=bateria|corriente  finge de dónde toma la energía
#   NV_SIN_GIT=1                  no toca git (ni pull, ni commit, ni push)
#   NV_FORZAR=1                   ignora las compuertas de frescura y tapa
# ------------------------------------------------------------------
MOTOR="${NV_MOTOR:-engine/rastrillar.py}"
PATRON_MOTOR="$MOTOR"   # con esto buscamos corridas vivas con pgrep

# ------------------------------------------------------------------
# Ayudantes
# ------------------------------------------------------------------

# Minutos desde que se escribió un archivo (un número gigante si no existe).
edad_archivo_min() {
  local f="$1"
  if [ ! -f "$f" ]; then echo 999999; return 0; fi
  local m
  m=$(stat -f %m "$f" 2>/dev/null || echo 0)
  if [ -z "$m" ] || [ "$m" = "0" ]; then echo 999999; return 0; fi
  echo $(( ( $(date +%s) - m ) / 60 ))
}

# Minutos desde que se generaron los datos del radar.
# Miramos el campo "generado" de latest.json y NO la fecha del archivo: esa
# fecha cambia por cosas que no son un barrido (un `git pull` que se lo traiga,
# o el rescate de filtrar_json), y ahí la compuerta de frescura creería que el
# dato está fresco cuando en realidad es viejo — justo el tipo de mentira que
# estamos tratando de sacar de la app. Si no se puede leer el JSON, caemos a la
# fecha del archivo, que es lo que se usaba antes.
edad_dato_min() {
  local f="data/latest.json" mins
  mins=$(python3 -c '
import datetime, json, sys
g = json.load(open(sys.argv[1]))["generado"]
d = datetime.datetime.fromisoformat(g)
print(int((datetime.datetime.now(d.tzinfo) - d).total_seconds() // 60))
' "$f" 2>/dev/null || true)
  case "$mins" in
    ''|*[!0-9]*) edad_archivo_min "$f" ;;
    *) echo "$mins" ;;
  esac
}

# Minutos que hace que arrancó un proceso.
# OJO: macOS NO tiene `ps -o etimes` (solo `etime`, en formato dd-hh:mm:ss).
# El vigilante viejo usaba etimes, así que siempre calculaba edad 0 y nunca
# mataba nada. Acá sacamos la hora de arranque con lstart y la pasamos a
# segundos con `date -j`, que sí anda en esta Mac. (Verificado 8-sep-2026.)
edad_proceso_min() {
  local pid="$1" arranque ini
  arranque=$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/[[:space:]]*$//')
  if [ -z "$arranque" ]; then echo 0; return 0; fi
  ini=$(date -j -f "%a %b %e %T %Y" "$arranque" +%s 2>/dev/null || echo 0)
  if [ "$ini" = "0" ]; then echo 0; return 0; fi
  echo $(( ( $(date +%s) - ini ) / 60 ))
}

# ¿La tapa está cerrada? (ioreg devuelve "Yes"/"No")
tapa_cerrada() {
  if [ -n "$NV_TAPA" ]; then [ "$NV_TAPA" = "Yes" ]; return; fi
  ioreg -r -k AppleClamshellState -d 4 2>/dev/null \
    | grep -m1 AppleClamshellState | grep -q "Yes"
}

# ¿Está a batería? (pmset arranca con "Now drawing from 'Battery Power'")
en_bateria() {
  if [ -n "$NV_ENERGIA" ]; then [ "$NV_ENERGIA" = "bateria" ]; return; fi
  pmset -g batt 2>/dev/null | grep -q "Battery Power"
}

# Corre un comando con límite de tiempo duro en minutos.
# macOS no trae `timeout`, así que largamos un vigía en paralelo. El vigía
# mira el reloj de pared en vez de hacer un `sleep` largo: si la Mac se
# duerme, un sleep se congela con ella y el límite no llegaría nunca.
# Devuelve 137 si el proceso murió por SIGKILL, y deja en CORTADO_POR_LIMITE
# si el que lo mató fuimos nosotros: un 137 también puede venir del vigilante
# de otro turno o de un `kill` a mano, y ahí decir "se pasó del tope" sería
# mentira (visto el 8-sep-2026 probando dos corridas encimadas).
CORTADO_POR_LIMITE=0
correr_con_limite() {
  local limite_seg=$(( $1 * 60 )); shift
  local marca="${TMPDIR:-/tmp}/nv_limite.$$"
  rm -f "$marca"
  "$@" &
  local pid=$!
  ( fin=$(( $(date +%s) + limite_seg ))
    while [ "$(date +%s)" -lt "$fin" ]; do sleep 5; done
    : > "$marca"
    kill -9 "$pid" 2>/dev/null ) &
  local vigia=$!
  local rc=0
  # El 2>/dev/null es solo para que bash no ensucie el log con su
  # "Killed: 9 $@" cuando el vigía corta. Lo que escribe el motor no se pierde:
  # su stderr ya está enganchado al log desde antes.
  wait "$pid" 2>/dev/null || rc=$?
  kill "$vigia" 2>/dev/null || true
  wait "$vigia" 2>/dev/null || true
  CORTADO_POR_LIMITE=0
  if [ -f "$marca" ]; then CORTADO_POR_LIMITE=1; fi
  rm -f "$marca"
  return "$rc"
}

# Corre el motor con el límite que corresponde al modo.
correr_motor() {
  local limite="$LIMITE_COMPLETO_MIN"
  if [ "$MODO" = "rapido" ]; then limite="$LIMITE_RAPIDO_MIN"; fi
  echo "→ python3 $MOTOR $* (tope ${limite} min)"
  local rc=0
  correr_con_limite "$limite" python3 "$MOTOR" "$@" || rc=$?
  if [ "$CORTADO_POR_LIMITE" = "1" ]; then
    echo "⚠ El motor pasó de ${limite} min y lo corté: casi seguro la Mac se durmió en el medio."
  elif [ "$rc" = "137" ]; then
    echo "⚠ Al motor lo mató algo de afuera (otro turno que lo vio colgado, o un kill a mano)."
  fi
  return "$rc"
}

# Deja pasar solo los .json que de verdad son JSON, y sanea los que no.
# Desde que hay límite de tiempo duro, una corrida se puede cortar JUSTO
# mientras el motor escribe un archivo grande (busqueda.json son 324 KB) y
# dejarlo truncado en el disco. Ese archivo no se commitea en la corrida que
# falló, pero la SIGUIENTE corrida buena hacía `git add data/*.json` y lo
# arrastraba: la app se comía un JSON roto. Reproducido el 8-sep-2026 —
# quedó publicado literalmente `{"generado": "roto", "mese`.
# Al archivo roto lo devolvemos a la última versión publicada. No es tocar el
# historial a ciegas: solo se toca lo que ya NO se puede leer, y la versión
# buena la tiene git. De paso deja el árbol limpio, que hace falta: un archivo
# modificado y sin commitear hace fallar el `git pull --rebase` del próximo
# turno y la config que Nacho edita desde el celu no llegaría nunca.
# Escribe en JSON_BUENOS los archivos que sí se pueden publicar.
JSON_BUENOS=""
filtrar_json() {
  local f
  JSON_BUENOS=""
  for f in "$@"; do
    if [ ! -f "$f" ]; then continue; fi
    case "$f" in
      *.json)
        if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" >/dev/null 2>&1; then
          echo "⚠ $f quedó a medio escribir (no es JSON válido): no lo publico."
          if git checkout -- "$f" >/dev/null 2>&1; then
            echo "  Lo devolví a la última versión publicada."
          else
            echo "  No pude recuperarlo de git, lo dejo afuera de esta publicación."
            continue
          fi
        fi ;;
    esac
    JSON_BUENOS="$JSON_BUENOS $f"
  done
}

# Publica en GitHub los archivos que le pasemos.
#   publicar "etiqueta del commit" data/*.json
publicar() {
  local etiqueta="$1"; shift
  if [ "${NV_SIN_GIT:-0}" = "1" ]; then
    echo "ℹ NV_SIN_GIT=1: acá publicaría «$etiqueta» con: $*"
    return 0
  fi
  if [ ! -d .git ] || ! git remote get-url origin >/dev/null 2>&1; then
    echo "ℹ Todavía no configuraste el repo/remoto de GitHub."
    echo "  Los datos quedaron en ./data (seguí el README para publicarlos)."
    return 0
  fi
  filtrar_json "$@"
  if [ -z "$JSON_BUENOS" ]; then
    echo "No quedó nada publicable ($etiqueta)."
    return 0
  fi
  git add $JSON_BUENOS 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "Sin cambios en los datos, no hace falta publicar ($etiqueta)."
    return 0
  fi
  git commit -m "datos: $etiqueta $(date '+%Y-%m-%d %H:%M')" >/dev/null
  if git push origin HEAD >/dev/null 2>&1; then
    echo "✓ Publicado en GitHub: $etiqueta."
  else
    echo "⚠ No se pudo hacer push (revisá tu conexión o credenciales de git)."
  fi
}

# El motor sale con código != 0 cuando NO tiene nada bueno para publicar
# (se quedó sin servidor, 0 rutas, etc). En ese caso NO publicamos los datos
# —así la app se queda con lo viejo, que es correcto, en vez de mostrar una
# pantalla vacía como pasó el 5-sep— pero SÍ publicamos data/meta.json, que
# el motor dejó con estado "vacio"/"sin_servidor" para que la app avise que
# el último barrido falló. El orden importa: primero meta, nada más.
# Lo que haya quedado a medio escribir en data/ no se revierte a ciegas —el
# historial de precios es lo más valioso del proyecto—, pero tampoco se
# publica: filtrar_json revisa archivo por archivo y solo devuelve a la última
# versión publicada los que directamente ya no son JSON.
abortar_por_motor() {
  local rc="$1" etapa="$2"
  echo "⚠ El motor terminó con código $rc en la etapa '$etapa': no hay nada bueno para publicar."
  # Si el motor se cortó a mitad de un archivo, lo saneamos ACÁ y no le
  # dejamos el árbol sucio al próximo turno (que si no ni podría hacer pull).
  if [ "${NV_SIN_GIT:-0}" != "1" ] && [ -d .git ]; then filtrar_json data/*.json; fi
  publicar "aviso: barrido $MODO fallido" data/meta.json
  echo "Corto acá. El dato viejo de la app queda como estaba."
  exit 1
}

echo "=================================================="
echo " NachoVuela · rastrillaje $MODO $(date '+%Y-%m-%d %H:%M')"
echo "=================================================="

# ------------------------------------------------------------------
# 1) Vigilante: matar corridas colgadas.  VA PRIMERO.
# ------------------------------------------------------------------
# Antes esto estaba DESPUÉS del chequeo "ya hay un rastrillaje en curso", que
# hacía salir al rápido de una: el vigilante no llegó a ejecutarse jamás en
# todo el historial del log. Y encima usaba `ps -o etimes`, que no existe en
# macOS, así que calculaba edad 0 y no habría matado nada igual.
# Sin vigilante, UNA sola corrida congelada bloquea todas las siguientes para
# siempre: launchd no larga otra instancia del mismo label mientras la vieja
# "sigue viva", aunque esté congelada por DarkWake.
for pid in $(pgrep -f "$PATRON_MOTOR" 2>/dev/null || true); do
  if [ "$pid" = "$$" ]; then continue; fi
  edad=$(edad_proceso_min "$pid")
  tope="$LIMITE_COMPLETO_MIN"
  cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  case "$cmd" in *--rapido*) tope="$LIMITE_RAPIDO_MIN" ;; esac
  if [ "$edad" -gt "$tope" ]; then
    echo "⚠ Corrida anterior colgada hace ${edad} min (pid $pid, tope ${tope} min) — la corto."
    # Primero el run.sh que la lanzó y RECIÉN DESPUÉS el motor. Si lo hacemos
    # al revés, ese run.sh se despierta, ve que su motor murió, se va por la
    # rama de "barrido fallido" y se pone a hacer git add/commit/push al mismo
    # tiempo que nosotros: se pelean por .git/index.lock y puede llegar a
    # publicar un commit a medias. (Reproducido el 8-sep-2026: la corrida
    # muerta siguió corriendo su rama de git después de que la cortamos.)
    padre=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    case "$padre" in
      ''|*[!0-9]*|0|1|"$$") ;;   # sin padre, launchd o nosotros mismos: ni tocarlo
      *)
        case "$(ps -o command= -p "$padre" 2>/dev/null || true)" in
          *run.sh*)
            echo "  También corto el run.sh que la lanzó (pid $padre) para que no toque git."
            # Anotamos sus hijos ANTES de matarlo: el motor, el vigía del
            # límite duro y el caffeinate. Después de matar al padre quedan
            # colgados de launchd y ya no hay forma de encontrarlos.
            hijos=$(pgrep -P "$padre" 2>/dev/null | tr '\n' ' ')
            kill -9 "$padre" 2>/dev/null || true
            if [ -n "$hijos" ]; then kill -9 $hijos 2>/dev/null || true; fi ;;
        esac ;;
    esac
    kill -9 "$pid" 2>/dev/null || true
  fi
done

# ------------------------------------------------------------------
# 2) ¿Quedó una corrida sana en curso?
# ------------------------------------------------------------------
# Dos motores a la vez se pisarían escribiendo data/latest.json y duplicarían
# las llamadas a Smiles. Lo colgado ya lo mató el vigilante de arriba, así que
# si todavía hay algo vivo es una corrida sana: le dejamos terminar.
if pgrep -f "$PATRON_MOTOR" >/dev/null 2>&1; then
  echo "Ya hay un rastrillaje en curso y no está colgado: este turno se saltea."
  exit 0
fi

# ------------------------------------------------------------------
# 3) Compuerta de frescura (solo para los rápidos)
# ------------------------------------------------------------------
# Los rápidos son un turno por hora justamente para que, cuando la Mac está
# abierta, el dato esté siempre fresco. Pero no tiene sentido barrer si recién
# barrimos: si el dato es nuevo, salimos sin gastar nada.
# Los completos NO pasan por acá: corren igual porque tienen que regenerar el
# buscador ida+vuelta, la apertura y el clima, que no dependen de esta edad.
EDAD_DATO=$(edad_dato_min)
if [ "$MODO" = "rapido" ] && [ "${NV_FORZAR:-0}" != "1" ] && [ "$EDAD_DATO" -lt "$FRESCO_MIN" ]; then
  echo "El dato tiene ${EDAD_DATO} min (el tope para barrer es ${FRESCO_MIN}): está fresco, no hago nada."
  exit 0
fi

# ------------------------------------------------------------------
# 4) Compuerta de tapa + batería
# ------------------------------------------------------------------
# Con la tapa cerrada y sin enchufe, macOS deja correr el proceso ~30 s cada
# ~15 min (DarkWake): medido del 4 al 7-sep-2026, un rápido de 7 min tardó
# entre 2 y 6 h y un completo de 25 min entre 13 y 15 h. Resultado: 12
# corridas congeladas, 8 turnos perdidos y la batería del 26% al 1%. Encima
# la corrida zombi bloquea su propio label en launchd.
# NO hay excepción "si el dato está muy viejo, intento igual": lo evaluamos y
# no sirve. En DarkWake el motor avanzaría ~50 s de trabajo real antes de que
# el límite duro lo corte, o sea 3 o 4 rutas de 33 — no alcanza ni para
# publicar, y gasta la batería igual. Si querés forzarla igual a mano:
#   NV_FORZAR=1 bash scripts/run.sh --rapido
# (y ahí el límite duro de arriba corta solo).
if [ "${NV_FORZAR:-0}" != "1" ] && tapa_cerrada && en_bateria; then
  echo "Tapa cerrada y a batería: no arranco (el dato tiene ${EDAD_DATO} min)."
  echo "  Así la Mac no se pasa horas congelada, no bloquea el turno siguiente"
  echo "  y no se come la batería. Vuelvo a intentar en el próximo turno."
  exit 0
fi

# Mientras corre, pedimos que la Mac no se duerma sola.
#   -i sirve también a batería (evita el idle sleep con la tapa abierta)
#   -s solo aplica con corriente, según man caffeinate
# Ninguno de los dos evita que se duerma si CERRÁS la tapa: eso lo decide
# macOS sin excepciones, y por eso existe la compuerta de arriba.
# Va suelto y atado a este script (-w $$) en vez de envolver al motor, así el
# vigilante y el pgrep ven solo al proceso de python.
caffeinate -i -s -w $$ >/dev/null 2>&1 &

# ------------------------------------------------------------------
# 5) Traer cambios hechos desde la app/GitHub (ej: viajes editados en el celu)
# ------------------------------------------------------------------
if [ "${NV_SIN_GIT:-0}" != "1" ] && [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then
  # Antes de traer nada, sacamos del medio cualquier JSON que haya quedado
  # truncado por una corrida cortada: si no, el pull ni arranca (abajo).
  filtrar_json data/*.json
  # El pull falla de dos maneras muy distintas y antes las dos se reportaban
  # como "sin conexión": si quedó algo sin commitear, git contesta "cannot pull
  # with rebase: You have unstaged changes" y la config que Nacho edita desde
  # el celu no llega nunca, sin ningún aviso. (Comprobado el 8-sep-2026.)
  salida_pull=$(git pull --rebase origin main 2>&1) && echo "✓ Config sincronizada desde GitHub" || {
    case "$salida_pull" in
      *"unstaged changes"*|*"local changes"*|*"cannot pull"*)
        echo "⚠ No pude traer la config de GitHub: hay cambios sin commitear en el proyecto."
        echo "  Sigo con la config local, pero revisá con: git -C \"$DIR\" status" ;;
      *)
        echo "ℹ Sin conexión a GitHub, uso la config local" ;;
    esac
  }
fi

# Los domingos (día 7) además refresca el clima.
EXTRA_CLIMA=""
if [ "$(date +%u)" = "7" ]; then EXTRA_CLIMA="--clima"; fi

# ------------------------------------------------------------------
# 6) Rastrillar y publicar
# ------------------------------------------------------------------
if [ "$MODO" = "rapido" ]; then
  # Un rápido es una sola etapa: solo toca el radar.
  rc=0
  correr_motor --rapido || rc=$?
  if [ "$rc" != "0" ]; then abortar_por_motor "$rc" "radar"; fi
  publicar "rastrillaje rapido" data/*.json

else
  # ¿El motor ya sabe correr las etapas por separado?
  DOS_ETAPAS=0
  if python3 "$MOTOR" --help 2>/dev/null | grep -q -- "$FLAG_RADAR"; then
    DOS_ETAPAS=1
  fi

  if [ "$DOS_ETAPAS" = "1" ]; then
    # Publicamos en dos pasos para que los carteles no esperen a que termine
    # todo: el radar (que es lo que mira el HUD y Partidas) sale a los pocos
    # minutos, y el buscador ida+vuelta llega después.
    echo "Etapa 1 de 2: radar."
    rc=0
    correr_motor "$FLAG_RADAR" || rc=$?
    if [ "$rc" != "0" ]; then abortar_por_motor "$rc" "radar"; fi
    publicar "radar (etapa 1 de 2)" data/*.json

    echo "Etapa 2 de 2: buscador ida+vuelta, apertura, clima y ofertas."
    rc2=0
    correr_motor "$FLAG_EXTRAS" $EXTRA_CLIMA || rc2=$?
    if [ "$rc2" != "0" ]; then
      # Ojo: acá NO usamos abortar_por_motor, porque el radar ya se publicó
      # bien y sería mentira decir que no hay nada nuevo.
      echo "⚠ Los extras terminaron con código $rc2. El radar de la etapa 1 ya quedó publicado."
      publicar "aviso: extras fallidos" data/meta.json
      exit 1
    fi
    publicar "extras (etapa 2 de 2)" data/*.json

  else
    echo "ℹ El motor todavía no acepta $FLAG_RADAR: hago una sola etapa, como antes."
    rc=0
    correr_motor $EXTRA_CLIMA || rc=$?
    if [ "$rc" != "0" ]; then abortar_por_motor "$rc" "completo"; fi
    publicar "rastrillaje completo" data/*.json
  fi
fi

echo "Listo ✈️"
