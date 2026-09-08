# Agendar el rastrillaje automático en tu Mac

Para que NachoVuela busque solo (sin que abras nada), usamos `launchd`, el
agendador propio de macOS. Son dos agendas:

| Agenda | Qué hace | Cuándo |
|---|---|---|
| `com.nachovuela.rapido` | solo el radar (~7 min) | **un turno por hora, de 9 a 23, en el minuto 20** |
| `com.nachovuela.rastrillaje` | completo: radar + buscador ida+vuelta + apertura + clima + ofertas (~25 min) | **11:00 y 17:00** |

> Antes los completos iban a las **9:00 y 20:00** y los rápidos en 4 horarios
> fijos. Se cambió porque a esas horas la Mac suele estar cerrada: el completo
> de las 20:00 terminaba a las 11 de la mañana siguiente y encima bloqueaba al
> de las 9:00. En `data/rastrillaje.log`, sobre los 7 días completos que hay
> registrados (1 al 7-sep-2026), el turno de las 9:00 arrancó 4 veces y el de
> las 12:00 los 7: por eso los completos se mudan a esa franja.

## Un turno por hora no significa barrer 15 veces por día

Casi todos los turnos no hacen nada: `run.sh` tiene tres compuertas y sale
enseguida si no corresponde. La idea es que **cuando la Mac está abierta el
dato nunca pase de ~2 h**, y cuando está cerrada no se largue ni una corrida.

1. **¿Hay una corrida en curso?** Si quedó una anterior colgada (más de 20 min
   un rápido, 45 min un completo) la mata; si hay una sana corriendo, este
   turno se saltea. *Ojo con el orden: el vigilante va primero. Antes estaba
   al revés y por eso nunca llegó a ejecutarse.*
2. **¿El dato está fresco?** Si `data/latest.json` tiene menos de 90 min, el
   rápido sale sin hacer nada. Así el turno de +53 min se saltea y el de
   +1 h 53 sí corre: un barrido cada 2 h, no cada hora. Los completos no pasan
   por esta compuerta (tienen que regenerar el buscador igual).
3. **¿Tapa cerrada y a batería?** No arranca. Con la tapa cerrada y sin
   enchufe, macOS deja avanzar el proceso ~30 s cada ~15 min (DarkWake): un
   barrido de 7 min tarda entre 2 y 6 h, bloquea el turno siguiente y se come
   la batería (del 4 al 7-sep-2026 pasó del 26% al 1%). Mejor no arrancar.

Además, cada corrida tiene un **límite de tiempo duro** (20 min los rápidos,
45 los completos): si la Mac se duerme en el medio, se corta sola en vez de
quedar colgada bloqueando todo. Y como cortar una corrida puede dejar un
archivo escrito a medias, antes de publicar nada `run.sh` revisa que cada
`data/*.json` sea JSON de verdad; al que quedó roto lo devuelve a la última
versión publicada y no lo sube. La app nunca recibe un archivo cortado.

Y los completos **publican en dos etapas**: primero el radar (que es lo que
mira el HUD y el cartel de Partidas) y después el buscador ida+vuelta y los
extras. Antes los carteles esperaban a que terminara todo.

---

## Instalar / actualizar la agenda

Los archivos `scripts/*.plist` son **plantillas**: tienen el marcador
`__RUTA__` donde va la carpeta real del proyecto. Hay que reemplazarlo al
copiarlos a `~/Library/LaunchAgents` — si se instalan crudos, launchd falla
con *exit 78*.

Abrí la **Terminal** y pegá esto tal cual (todo junto):

```bash
PROY="$(cd ~/NachoVuela && pwd -P)"   # ojo: la ruta real, no el alias del Escritorio
mkdir -p ~/Library/LaunchAgents
for L in com.nachovuela.rastrillaje com.nachovuela.rapido; do
  # Primero armamos el plist aparte y lo revisamos. Recién si está bien lo
  # instalamos: así, si algo falla (la carpeta no está donde creíamos, por
  # ejemplo), la agenda que ya tenías sigue andando en vez de quedar sin nada.
  sed "s|__RUTA__|$PROY|g" "$PROY/scripts/$L.plist" > "/tmp/$L.plist" \
    || { echo "✗ No encontré $PROY/scripts/$L.plist — no toco nada"; continue; }
  plutil -lint "/tmp/$L.plist" \
    || { echo "✗ $L quedó mal armado — no lo instalo"; continue; }
  launchctl unload ~/Library/LaunchAgents/$L.plist 2>/dev/null
  cp "/tmp/$L.plist" ~/Library/LaunchAgents/$L.plist
  launchctl load ~/Library/LaunchAgents/$L.plist && echo "✓ $L cargado"
done
launchctl list | grep nachovuela
echo "✓ Agendado: completos 11:00 y 17:00, rápidos cada hora de 9 a 23 (minuto 20)"
```

El `unload` de arriba no es opcional cuando ya había una agenda cargada:
launchd no se entera de los horarios nuevos si no la descargás y la volvés a
cargar.

## Probar que anda (corrida manual ya mismo)

```bash
launchctl start com.nachovuela.rapido      # dispara el turno como si fuera la hora
# o directamente, viendo la salida:
bash ~/NachoVuela/scripts/run.sh --rapido  # solo el radar
bash ~/NachoVuela/scripts/run.sh           # completo
```

Si contesta *"está fresco, no hago nada"* o *"tapa cerrada y a batería"*, está
funcionando: son las compuertas. Para saltearlas a propósito:

```bash
NV_FORZAR=1 bash ~/NachoVuela/scripts/run.sh --rapido
```

El resultado de todas las corridas queda en `data/rastrillaje.log`:

```bash
tail -f ~/NachoVuela/data/rastrillaje.log
```

## Cambiar los horarios

Editá los `scripts/*.plist` del proyecto (las horas están en
`StartCalendarInterval`) y volvé a correr el bloque de instalación de arriba.
No edites los de `~/Library/LaunchAgents` a mano: se pisan en la próxima
instalación.

## Sacar la agenda

```bash
for L in com.nachovuela.rastrillaje com.nachovuela.rapido; do
  launchctl unload ~/Library/LaunchAgents/$L.plist 2>/dev/null
  rm -f ~/Library/LaunchAgents/$L.plist
done
echo "✓ Agenda sacada. NachoVuela ya no busca solo."
```

## Perillas de prueba de run.sh

Sirven para probar el script sin salir a Smiles ni tocar git. En la corrida
real no se usa ninguna.

| Variable | Para qué |
|---|---|
| `NV_MOTOR=ruta/al/motor.py` | usar otro motor (ej: uno falso de prueba) |
| `NV_TAPA=Yes\|No` | fingir el estado de la tapa |
| `NV_ENERGIA=bateria\|corriente` | fingir de dónde toma la energía |
| `NV_SIN_GIT=1` | no tocar git (ni pull, ni commit, ni push) |
| `NV_FORZAR=1` | ignorar las compuertas de frescura y de tapa/batería |

Ejemplo: probar la compuerta de la tapa sin cerrar la tapa.

```bash
cd ~/NachoVuela
NV_TAPA=Yes NV_ENERGIA=bateria bash scripts/run.sh --rapido
```
