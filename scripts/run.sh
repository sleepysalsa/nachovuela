#!/bin/bash
# ============================================================
# NachoVuela — corrida completa: rastrilla Smiles y publica.
# Se puede correr a mano o dejar agendada (ver scripts/agendar.md).
# ============================================================
set -e

# Carpeta raíz del proyecto (un nivel arriba de este script)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=================================================="
echo " NachoVuela · rastrillaje $(date '+%Y-%m-%d %H:%M')"
echo "=================================================="

# -1) Vigilante anti-Mac-dormida: si quedó una corrida anterior colgada
#     (la Mac se durmió en el medio y recién despertó), la matamos si tiene
#     más de 90 minutos — una corrida normal tarda mucho menos. Sin esto,
#     una sola vez que la Mac se duerma bloquea TODAS las corridas siguientes
#     para siempre, porque launchd nunca larga una nueva mientras la vieja
#     "sigue viva" (aunque esté congelada). Visto en vivo: 19→20-jul-2026.
for pid in $(pgrep -f "engine/rastrillar.py" 2>/dev/null); do
  if [ "$pid" != "$$" ]; then
    edad_min=$(( $(ps -o etimes= -p "$pid" 2>/dev/null || echo 0) / 60 ))
    if [ "$edad_min" -gt 90 ]; then
      echo "⚠ Corrida anterior colgada hace ${edad_min} min (pid $pid) — probablemente la Mac se durmió. La corto."
      kill -9 "$pid" 2>/dev/null
    fi
  fi
done

# 0) Traer cambios hechos desde la app/GitHub (ej: viajes editados en el celu)
if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then
  git pull --rebase origin main >/dev/null 2>&1 && echo "✓ Config sincronizada desde GitHub" || echo "ℹ Sin conexión a GitHub, uso la config local"
fi

# 1) Rastrillar Smiles + generar datos. caffeinate evita que la Mac se
#    duerma por inactividad mientras corre (no evita dormirse si cerrás
#    la tapa — eso lo decide macOS sin excepciones).
#    Los domingos (día 7) además refresca el clima.
if [ "$(date +%u)" = "7" ]; then
  caffeinate -s python3 engine/rastrillar.py --clima
else
  caffeinate -s python3 engine/rastrillar.py
fi

# 2) Si hay un repositorio git con remoto configurado, publicar los datos
#    para que la app en el celular vea lo último.
if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then
  echo "Publicando datos en GitHub..."
  git add data/*.json
  if ! git diff --cached --quiet; then
    git commit -m "datos: rastrillaje $(date '+%Y-%m-%d %H:%M')" >/dev/null
    if git push origin HEAD >/dev/null 2>&1; then
      echo "✓ Datos publicados. La app ya muestra lo último."
    else
      echo "⚠ No se pudo hacer push (revisá tu conexión o credenciales de git)."
    fi
  else
    echo "Sin cambios en los datos, no hace falta publicar."
  fi
else
  echo "ℹ Todavía no configuraste el repo/remoto de GitHub."
  echo "  Los datos quedaron en ./data (seguí el README para publicarlos)."
fi

echo "Listo ✈️"
