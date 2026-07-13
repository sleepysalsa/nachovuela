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

# 1) Rastrillar Smiles + generar datos.
#    Los domingos (día 7) además refresca el clima.
if [ "$(date +%u)" = "7" ]; then
  python3 engine/rastrillar.py --clima
else
  python3 engine/rastrillar.py
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
