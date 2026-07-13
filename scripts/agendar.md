# Agendar el rastrillaje automático en tu Mac

Para que NachoVuela busque solo (sin que abras nada), usamos `launchd`, el
agendador propio de macOS. Corre dos veces por día: **9:00 y 20:00**.

> Si tu Mac está apagada o dormida a esa hora, la tarea corre apenas se
> despierta. No necesitás dejarla prendida toda la noche.

## Instalación (una sola vez)

Abrí la **Terminal** y pegá esto (todo junto):

```bash
cd ~/Desktop/NachoVuela
# 1) Poné la ruta real del proyecto dentro del plist
sed "s|__RUTA__|$(pwd)|g" scripts/com.nachovuela.rastrillaje.plist > ~/Library/LaunchAgents/com.nachovuela.rastrillaje.plist
# 2) Cargar la agenda
launchctl unload ~/Library/LaunchAgents/com.nachovuela.rastrillaje.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.nachovuela.rastrillaje.plist
echo "✓ Agendado: NachoVuela va a rastrillar a las 9:00 y 20:00"
```

## Probar que anda (corrida manual ya mismo)

```bash
launchctl start com.nachovuela.rastrillaje
# o directamente:
bash ~/Desktop/NachoVuela/scripts/run.sh
```

El resultado queda en `data/rastrillaje.log`.

## Cambiar los horarios

Editá `~/Library/LaunchAgents/com.nachovuela.rastrillaje.plist` (las horas
están en `StartCalendarInterval`) y volvé a correr los dos comandos de
`launchctl unload` / `launchctl load` de arriba.

## Sacar la agenda

```bash
launchctl unload ~/Library/LaunchAgents/com.nachovuela.rastrillaje.plist
rm ~/Library/LaunchAgents/com.nachovuela.rastrillaje.plist
```
