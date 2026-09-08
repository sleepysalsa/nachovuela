#!/usr/bin/env python3
"""
NachoVuela — motor de rastrillaje.

Qué hace, en una corrida:
  1. Lee engine/config.json (viajes activos + destinos vigilados).
  2. Para cada ruta (origen -> cada aeropuerto de cada destino) y cada mes,
     consulta el calendario de precios award de Smiles.
  3. Acumula cada resultado en data/historial.json (nuestro histórico propio,
     que con el tiempo se vuelve el dato más valioso).
  4. Clasifica cada precio en un semáforo (oportunidad / normal / caro) usando
     dos señales: el cuartil que da Smiles y la comparación contra nuestro
     propio promedio histórico de esa ruta+mes.
  5. Escribe data/latest.json (lo que muestra la app), data/destinos.json y
     data/clima.json.

Uso:
    python3 engine/rastrillar.py               # corrida completa (radar + extras)
    python3 engine/rastrillar.py --clima       # además refresca el clima
    python3 engine/rastrillar.py --demo        # una sola ruta, para probar rápido
    python3 engine/rastrillar.py --rapido      # solo el radar + una tanda de vueltas

EN DOS ETAPAS (lo que usa scripts/run.sh para publicar antes)
-------------------------------------------------------------
En un completo el radar queda listo a los ~8 minutos pero antes había que
esperar los ~25 de la corrida entera para publicar (y hasta 11 h si la Mac se
durmió en el medio). Ahora el completo se puede partir:

    python3 engine/rastrillar.py --solo-radar    # etapa 1: el radar
    → run.sh publica acá, con el dato fresco
    python3 engine/rastrillar.py --solo-extras   # etapa 2: buscador, apertura…
    → run.sh vuelve a publicar

  --solo-radar   consulta Smiles ruta por ruta y escribe latest.json,
                 historial.json, destinos.json, las IDAS de busqueda.json y
                 meta.json. NO toca vueltas, ofertas, apertura ni clima.
  --solo-extras  no consulta el radar: lee el latest.json de la etapa 1 y
                 hace las VUELTAS del buscador, las ofertas, la apertura y
                 (si corresponde) el clima. Vuelve a escribir meta.json.

Sin ninguna de las dos flags hace todo junto, como siempre.

CÓDIGO DE SALIDA
----------------
Sale con != 0 cuando la corrida NO tiene nada bueno para publicar: no hay
servidor de Smiles sirviendo precios, o ninguna ruta trajo resultado, o
trajeron muchas menos de lo normal y encima hubo errores. En esos casos NO
pisa latest.json ni historial.json (el dato viejo es mejor que uno vacío: el
5-sep-2026 un rápido sin red publicó 0 rutas y la app quedó 3 h 21 min en
blanco). Lo único que igual escribe es meta.json, con estado "vacio" o
"sin_servidor", para que la app pueda avisar "el barrido de las 12:14 falló,
mostrando datos de las 09:12".

Es respetuoso con Smiles: pausas aleatorias entre llamadas.
"""

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import destinos as cat
import smiles_client
import clima_client
import busqueda as busq
import detalle_client
import cash_client

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "engine")
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)

CONFIG_PATH = os.path.join(ENGINE, "config.json")
HIST_PATH = os.path.join(DATA, "historial.json")
LATEST_PATH = os.path.join(DATA, "latest.json")
DESTINOS_PATH = os.path.join(DATA, "destinos.json")
CLIMA_PATH = os.path.join(DATA, "clima.json")
BUSQUEDA_PATH = os.path.join(DATA, "busqueda.json")


def ahora_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def cargar_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return default
    return default


def guardar_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Semáforo de oportunidades
# ---------------------------------------------------------------------------

def clasificar(miles, price_range, historico_ruta_mes, declarado=None):
    """
    Devuelve ("oportunidad" | "bueno" | "normal" | "caro", motivo_texto).

    Combina dos señales:
      - price_range: cuartil de Smiles (1 = más barato de la ruta, 4 = más caro).
      - historico_ruta_mes: lista de precios mínimos que ya vimos para esa
        ruta+mes en corridas anteriores (nuestro baseline propio).

    declarado: lo que smiles_client detectó sobre la respuesta. Si el
    calendario vino PARCIAL no clasificamos nada: un mes del que Smiles nos
    mostró 1 día de 31 no es ni una oportunidad ni un mes caro, es una
    respuesta incompleta. Así dejamos de cantar "🔴 caro 115.500" con un solo
    día (AEP-GIG, 6-sep-2026) y "🟢🔥 oportunidad" con otro.
    """
    if declarado and declarado.get("parcial"):
        n = declarado.get("dias_obtenidos") or 0
        esp = declarado.get("dias_esperados")
        # Ojo con cómo lo decimos: `esp` sale del histograma de precios que
        # manda Smiles, que cuenta OPCIONES, no días (ver _declaracion en
        # smiles_client). Es un techo confiable de "hay mucho más que esto",
        # no un "Smiles dice que hay N días": no se lo atribuimos como cita.
        return "normal", [f"Smiles está mostrando solo {n} día"
                          f"{'s' if n != 1 else ''} de este mes"
                          + (f"; su resumen de precios da para {esp}" if esp else "")]

    motivos = []
    score = 0  # negativo = oportunidad, positivo = caro

    # Señal 1: cuartil de Smiles
    if price_range == 1:
        score -= 2
        motivos.append("está en el 25% más barato de esta ruta")
    elif price_range == 2:
        score -= 1
    elif price_range == 4:
        score += 2
        motivos.append("está en el 25% más caro de esta ruta")
    elif price_range == 3:
        score += 1

    # Señal 2: comparación contra nuestro histórico
    if historico_ruta_mes and len(historico_ruta_mes) >= 3:
        prom = sum(historico_ruta_mes) / len(historico_ruta_mes)
        minimo = min(historico_ruta_mes)
        if miles < minimo:
            score -= 2
            motivos.append("nuevo mínimo histórico: nunca lo vimos tan barato")
        elif miles == minimo:
            score -= 1
            motivos.append("iguala el precio más bajo que registramos")
        elif miles <= prom * 0.85:
            score -= 2
            motivos.append(f"un {round((1 - miles / prom) * 100)}% bajo el promedio")
        elif miles <= prom * 0.95:
            score -= 1
        elif miles >= prom * 1.15:
            score += 2
            motivos.append(f"un {round((miles / prom - 1) * 100)}% sobre el promedio")

    # Regla de sentido común: si iguala o mejora el mínimo que ya vimos,
    # nunca puede ser "caro" (los cuartiles de Smiles a veces confunden).
    if historico_ruta_mes and miles <= min(historico_ruta_mes):
        score = min(score, -1)

    if score <= -3:
        nivel = "oportunidad"
    elif score <= -1:
        nivel = "bueno"
    elif score >= 2:
        nivel = "caro"
    else:
        nivel = "normal"

    return nivel, motivos


# ---------------------------------------------------------------------------
# Rastrillaje
# ---------------------------------------------------------------------------

def clave_ruta(origen, destino, mes):
    return f"{origen}-{destino}-{mes}"


def rutas_desde_config(config):
    """Genera la lista de tareas (origen, grupo_destino, aeropuerto, año, mes)."""
    tareas = []
    vistos = set()

    def agregar(origenes, destinos_claves, meses):
        for dk in destinos_claves:
            d = cat.DESTINOS.get(dk)
            if not d:
                continue
            # Si el destino declara desde dónde tiene sentido salir, mandan
            # esos (ej. Mendoza y Brasil también desde Aeroparque; Miami no).
            ogs = d.get("origenes") or origenes
            for og in ogs:
                for aero in d["aeropuertos"]:
                    for ym in meses:
                        anio, mes = int(ym[:4]), int(ym[5:7])
                        k = (og, aero["code"], anio, mes)
                        if k in vistos:
                            continue
                        vistos.add(k)
                        tareas.append({
                            "origen": og,
                            "destino_key": dk,
                            "destino": d,
                            "aeropuerto": aero,
                            "anio": anio, "mes": mes,
                            "ym": ym,
                        })

    for viaje in config.get("viajes", []):
        if not viaje.get("activo"):
            continue
        agregar(viaje["origenes"], viaje["destinos"], viaje["meses"])

    # Destinos vigilados (fuera de viajes) desde EZE por defecto
    if config.get("destinos_vigilados") and config.get("meses_vigilados"):
        agregar(["EZE"], config["destinos_vigilados"], config["meses_vigilados"])

    return tareas


def _ficha(t, og, code, moneda, k, consultado, dias, bandas, declarado,
           nivel, motivos, promedio_hist, cash):
    """Una entrada de latest.json["resultados"].

    Campos nuevos del 8-sep-2026 (los usa la app):
      consultado     cuándo se consultó ESTA ruta (no la corrida entera)
      dias_min       TODAS las fechas que están al precio mínimo, ordenadas.
                     Smiles rota cuál de los días empatados deja al mínimo, y
                     publicar uno solo hacía que la app marcara "Madrid 12-may
                     166.500" cuando ese día ya valía 435.700 y otros 7 días de
                     mayo seguían a 166.500 (medido el 7-sep-2026: 21 de 33
                     ruta-mes tenían más de un día empatado en el mínimo).
      parcial        el calendario vino recortado (ver smiles_client)
      dias_esperados días con precio que declara Smiles, o None
      min_declarado  piso de precio que declara Smiles, o None

    Si dias viene vacío (recortado), mejor_precio_millas y mejor_fecha van en
    null: no hay ningún día del que sacarlos y no vamos a inventar uno.
    """
    mejor = min(dias, key=lambda d: d["miles"]) if dias else None
    dias_min = sorted(d["date"] for d in dias
                      if mejor and d["miles"] == mejor["miles"])
    return {
        "ruta": k,
        "origen": og,
        "origen_ciudad": cat.ORIGENES.get(og, {}).get("ciudad", og),
        "destino_key": t["destino_key"],
        "destino_nombre": t["destino"]["nombre"],
        "destino_pais": t["destino"]["pais"],
        "destino_emoji": t["destino"].get("emoji", "✈️"),
        "region": t["destino"].get("region"),
        "aeropuerto": code,
        "aeropuerto_ciudad": t["aeropuerto"]["ciudad"],
        "moneda": moneda,
        "ym": t["ym"],
        "consultado": consultado,
        "mejor_precio_millas": mejor["miles"] if mejor else None,
        "mejor_fecha": mejor["date"] if mejor else None,
        "dias_min": dias_min,
        "price_range": mejor["price_range"] if mejor else None,
        "quartil_bandas": bandas,
        "parcial": bool(declarado.get("parcial")),
        "dias_esperados": declarado.get("dias_esperados"),
        "min_declarado": declarado.get("min_declarado"),
        "nivel": nivel,
        "motivos": motivos,
        "promedio_historico": promedio_hist,
        "dias": dias,
        "total_dias_disponibles": len(dias),
        "cash": cash,
    }


def correr(demo=False, refrescar_clima=False, rapido=False, etapa="todo"):
    """
    Una corrida del motor. Devuelve el latest.json resultante, o None si no
    hubo nada bueno para publicar (ahí el que llama tiene que salir con != 0).

    etapa: "todo" (radar + extras, lo de siempre), "radar" (--solo-radar) o
    "extras" (--solo-extras). Ver el docstring del módulo.
    """
    config = cargar_json(CONFIG_PATH, {})
    modo = "rapido" if rapido else "completo"
    iniciado = ahora_iso()

    if etapa == "extras":
        return correr_extras(config, iniciado, modo, refrescar_clima, demo)

    historial = cargar_json(HIST_PATH, {"rutas": {}})
    rutas_hist = historial.setdefault("rutas", {})
    previo = cargar_json(LATEST_PATH, {})

    tareas = rutas_desde_config(config)
    if demo:
        tareas = tareas[:1]

    # Smiles cambia de servidor cada tanto y el viejo queda devolviendo
    # calendarios vacíos (sin error). Elegimos el que esté sirviendo datos.
    print(f"[{ahora_iso()}] Verificando el servidor de Smiles...")
    if smiles_client.base_activa(log=print) is None:
        # Sin servidor no tiene sentido gastar 80 llamadas para nada: cualquier
        # cosa que "consiguiéramos" sería un calendario vacío disfrazado.
        print("⚠ Ningún servidor de Smiles sirve precios: no rastrillo y no "
              "piso los datos buenos.")
        escribir_meta(config, iniciado=iniciado, modo=modo, estado="sin_servidor",
                      rutas=0, consultadas=0, n_errores=0)
        return None

    cash_tok = cash_client.token(config)
    print(f"[{ahora_iso()}] Rastrillando {len(tareas)} ruta-mes...")
    if cash_tok:
        print("  (precios cash activados vía Travelpayouts)")
    else:
        print("  (sin token de precios cash: la app muestra solo millas — "
              "ver README para activarlo)")

    resultados = []
    # `errores` es la lista que se publica en latest.json y arrastra de todo:
    # rutas que no contestaron Y el precio cash de Travelpayouts, que es otra
    # API y no tiene nada que ver con el radar. `errores_rutas` cuenta SOLO las
    # rutas: es el número honesto para el estado de la corrida y para la
    # compuerta. Sin esta separación, un hipo de Travelpayouts (una entrada en
    # la lista) marcaba la corrida como "parcial" —la app le decía a Nacho
    # "corrida incompleta · 1 con error" con el radar impecable— y, peor,
    # activaba la regla del 40% de _hay_que_abortar: si encima Smiles estaba en
    # sequía de verdad, nos guardábamos una caída real por un error ajeno.
    errores = []
    errores_rutas = 0
    fallidas = []
    # Dos vueltas: la principal y una repesca de lo que falló (las fallas de
    # red suelen ser transitorias — visto 17-jul-2026 con DNS flameante).
    cola = [(i, t) for i, t in enumerate(tareas, 1)]
    repescando = False
    while cola or (fallidas and not repescando):
        if not cola:
            repescando = True
            print(f"  — Repesca: reintentando {len(fallidas)} rutas en 90 s...")
            time.sleep(90)
            cola, fallidas = fallidas, []
        (i, t), cola = cola[0], cola[1:]
        og, code = t["origen"], t["aeropuerto"]["code"]
        moneda = t["destino"].get("moneda", config.get("moneda_default", "USD"))
        etiqueta = f"{og}->{code} {t['ym']}"
        es_brasil = t["destino"]["pais"] == "Brasil"
        region = t["destino"].get("region")
        try:
            dias, bandas, declarado = smiles_client.calendario_mes(
                og, code, t["anio"], t["mes"], currency=moneda,
                pausa=(0.4, 0.9) if demo else (2.5, 5.0),
                preferir_socias=not es_brasil,
                solo_socias=region in ("eeuu", "europa"),
            )
        except smiles_client.SmilesError as e:
            if not repescando:
                fallidas.append((i, t))
                print(f"  [{i}/{len(tareas)}] {etiqueta}: falló, va a repesca")
            else:
                print(f"  [{i}/{len(tareas)}] {etiqueta}: ERROR {e}")
                errores.append(str(e))
                errores_rutas += 1
            continue

        consultado = ahora_iso()
        k = clave_ruta(og, code, t["ym"])

        if not dias:
            if not declarado.get("dias_esperados"):
                print(f"  [{i}/{len(tareas)}] {etiqueta}: sin disponibilidad")
                continue
            # Smiles DICE tener días con precio y no nos dio ninguno: eso no es
            # "sin disponibilidad", es un calendario recortado. La dejamos en
            # latest.json (con dias vacío) para que la app pueda decir "Smiles
            # no muestra días ahora; a la mañana mostró 31 desde 39.600" en vez
            # de hacer desaparecer la ruta del tablero.
            resultados.append(_ficha(t, og, code, moneda, k, consultado,
                                     dias=[], bandas=bandas, declarado=declarado,
                                     nivel="normal",
                                     motivos=["Smiles no está mostrando ningún día "
                                              "de este mes; su resumen de precios "
                                              f"da para {declarado['dias_esperados']}"],
                                     promedio_hist=None, cash=None))
            print(f"  [{i}/{len(tareas)}] {etiqueta}: ⚠ calendario recortado — "
                  f"0 días, con resumen de precios para "
                  f"{declarado['dias_esperados']}")
            continue

        # Mínimo del mes para esta ruta
        mejor = min(dias, key=lambda d: d["miles"])

        # Histórico propio de esta ruta+mes (mínimos de corridas previas)
        previos = [s["min_miles"]
                   for s in (rutas_hist.get(k) or {}).get("snapshots", [])]

        nivel, motivos = clasificar(mejor["miles"], mejor["price_range"],
                                    previos, declarado)

        # Guardar snapshot en el histórico — pero NO los calendarios parciales.
        # Un mínimo sacado de 1 día suelto no es el mínimo del mes: metido en
        # el histórico ensucia el promedio y el "mínimo visto" para siempre (de
        # ahí salía el falso "Florianópolis subió 242%"). Preferimos un hueco
        # en la serie antes que un punto mentiroso.
        if declarado.get("parcial"):
            print(f"      ({len(dias)} de {declarado['dias_esperados']} días: "
                  f"calendario parcial, no va al histórico)")
        else:
            hist = rutas_hist.setdefault(k, {"snapshots": []})
            hist["snapshots"].append({
                "ts": consultado,
                "min_miles": mejor["miles"],
                "min_date": mejor["date"],
            })
            # Mantener el histórico acotado (últimos 400 snapshots por ruta)
            hist["snapshots"] = hist["snapshots"][-400:]

        promedio_hist = round(sum(previos) / len(previos)) if previos else None

        # Precio en efectivo (cash) para comparar millas vs plata. Solo si hay
        # token de Travelpayouts; si falla, seguimos sin cash (no rompe nada).
        cash = None
        if cash_tok:
            try:
                cash = cash_client.precio_cash_mes(
                    og, code, t["anio"], t["mes"], cash_tok, currency="usd",
                    pausa=(0.2, 0.5) if demo else (0.6, 1.2),
                )
            except cash_client.CashError as e:
                if str(e) not in errores:
                    errores.append(str(e))

        resultados.append(_ficha(t, og, code, moneda, k, consultado, dias, bandas,
                                 declarado, nivel, motivos, promedio_hist, cash))
        flag = {"oportunidad": "🟢🔥", "bueno": "🟢", "normal": "⚪", "caro": "🔴"}[nivel]
        aviso = " ⚠ parcial" if declarado.get("parcial") else ""
        print(f"  [{i}/{len(tareas)}] {etiqueta}: {flag} {mejor['miles']:,} millas "
              f"({mejor['date']}) — {len(dias)} días disp.{aviso}")

    # Ordenar: oportunidades primero, luego por precio. Las ruta-mes recortadas
    # (sin precio) van al final: no compiten con las que sí tienen un número.
    orden_nivel = {"oportunidad": 0, "bueno": 1, "normal": 2, "caro": 3}
    resultados.sort(key=lambda r: (orden_nivel[r["nivel"]],
                                   r["mejor_precio_millas"] or 10 ** 9))

    # Detalle de vuelos (aerolínea / duración / escalas) para los mejores días.
    # Requiere sesión de Smiles iniciada (python3 engine/login_smiles.py).
    agregar_detalles(resultados, config, demo=demo)

    # --- Compuerta: ¿tenemos algo que valga la pena publicar? ---------------
    con_datos = [r for r in resultados if r["dias"]]
    motivo_corte = _hay_que_abortar(con_datos, tareas, errores_rutas, previo, demo)
    if motivo_corte:
        print(f"⚠ {motivo_corte}")
        print("  No piso latest.json ni historial.json: el dato viejo es "
              "mejor que uno vacío. Solo dejo el aviso en meta.json.")
        escribir_meta(config, iniciado=iniciado, modo=modo, estado="vacio",
                      rutas=len(con_datos), consultadas=len(tareas),
                      n_errores=errores_rutas)
        return None

    latest = {
        "generado": ahora_iso(),
        "iniciado": iniciado,
        "modo": modo,
        # "parcial" = la corrida terminó pero con RUTAS que fallaron; la app
        # puede avisar que lo que muestra está incompleto. Ojo: solo rutas —
        # que se caiga el precio cash no deja incompleto al radar.
        "estado": "parcial" if errores_rutas else "ok",
        "total_rutas": len(resultados),
        # Cuántas ruta-mes se consultaron en total. Sirve para que la app
        # distinga "el motor falló" de "Smiles no tiene premios cargados":
        # si consultamos 47 y solo 1 trajo precio, es sequía de Smiles.
        "total_consultadas": len(tareas),
        "errores": errores,
        "resultados": resultados,
    }
    guardar_json(LATEST_PATH, latest)
    guardar_json(HIST_PATH, historial)
    escribir_destinos()

    # El BUSCADOR ida+vuelta: las idas salen gratis de lo que acabamos de
    # consultar, así que se actualizan SIEMPRE (antes solo en los completos, y
    # por eso la estación Buscar mostraba datos de hasta 24 h mientras el HUD
    # mostraba los del último rápido). Las vueltas sí cuestan llamadas:
    #   --solo-radar → ninguna (las hace la etapa 2)
    #   --rapido     → una tanda rotativa
    #   completo     → todas
    if etapa == "radar":
        escribir_busqueda(config, latest, demo=demo, max_llamadas=0)
    elif rapido:
        escribir_busqueda(config, latest, demo=demo,
                          max_llamadas=busq.LLAMADAS_VUELTA_RAPIDO,
                          max_segundos=busq.SEGUNDOS_VUELTA_RAPIDO)
    else:
        escribir_busqueda(config, latest, demo=demo)

    escribir_meta(config, iniciado=iniciado, modo=modo, estado="ok",
                  rutas=len(con_datos), consultadas=len(tareas),
                  n_errores=errores_rutas)

    if etapa == "todo" and not rapido:
        escribir_ofertas()
        escribir_apertura(config)
        _clima_si_hace_falta(refrescar_clima)
    elif rapido:
        print("  (modo rápido: sin clima, apertura ni noticias)")

    n_op = sum(1 for r in resultados if r["nivel"] == "oportunidad")
    n_parc = sum(1 for r in resultados if r["parcial"])
    print(f"[{ahora_iso()}] Listo. {len(resultados)} rutas, {n_op} oportunidades 🔥, "
          f"{n_parc} calendarios recortados, {errores_rutas} rutas con error.")
    return latest


def _hay_que_abortar(con_datos, tareas, errores_rutas, previo, demo):
    """Motivo por el que esta corrida NO debería publicarse, o None.

    El 5-sep-2026 un rápido sin red publicó un latest.json con 0 rutas y la app
    quedó 3 h 21 min en blanco. Desde entonces preferimos el dato viejo.

    errores_rutas cuenta SOLO rutas que no contestaron. Los errores del precio
    cash (otra API) no cuentan: si contaran, un hipo de Travelpayouts armaría
    la regla del 40% y nos taparía una sequía real de Smiles, que es
    información que Nacho quiere ver.
    """
    if tareas and not con_datos:
        return (f"Se consultaron {len(tareas)} ruta-mes y NINGUNA trajo "
                f"resultado ({errores_rutas} con error).")
    # Una caída fuerte contra la corrida anterior solo es sospechosa si además
    # hubo errores. Sin errores puede ser sequía real de Smiles, y eso es
    # información válida que Nacho quiere ver.
    previas = len([r for r in (previo or {}).get("resultados", []) if r.get("dias")])
    if not demo and previas and errores_rutas and len(con_datos) < previas * 0.4:
        return (f"Solo {len(con_datos)} rutas con datos contra {previas} de la "
                f"corrida anterior, y encima {errores_rutas} con error.")
    return None


def _clima_si_hace_falta(refrescar_clima):
    clima_actual = cargar_json(CLIMA_PATH, {}).get("destinos", {})
    faltan = [k for k in cat.DESTINOS if k not in clima_actual]
    if refrescar_clima or faltan:
        if faltan:
            print(f"Clima: destinos nuevos sin datos {faltan}, refrescando...")
        escribir_clima()


def correr_extras(config, iniciado, modo, refrescar_clima, demo):
    """
    Etapa 2 de un completo (--solo-extras): todo lo que no es el radar.

    No consulta el calendario de ida de ninguna ruta: reusa el latest.json que
    dejó la etapa 1. Sí consulta las VUELTAS del buscador, que el radar no mira.
    """
    latest = cargar_json(LATEST_PATH, {})
    if not latest.get("resultados"):
        print("⚠ No hay un latest.json con datos: corré primero la etapa "
              "--solo-radar.")
        return None

    print(f"[{ahora_iso()}] Extras sobre el radar de {latest.get('generado')}.")
    if smiles_client.base_activa(log=print) is None:
        print("⚠ Ningún servidor de Smiles sirve precios: no hago las vueltas.")
        return None

    escribir_busqueda(config, latest, demo=demo)
    # La etapa 2 no vuelve a consultar el radar, así que el parte del barrido
    # (rutas / consultadas / errores) es el que dejó la etapa 1 en meta.json.
    # Recontar los errores desde latest["errores"] daría de más: esa lista
    # arrastra también los del precio cash, que no son rutas caídas.
    meta_1 = cargar_json(os.path.join(DATA, "meta.json"), {})
    escribir_meta(config, iniciado=iniciado, modo=modo, estado="ok",
                  rutas=meta_1.get("rutas")
                  or len([r for r in latest["resultados"] if r.get("dias")]),
                  consultadas=meta_1.get("consultadas")
                  or latest.get("total_consultadas") or 0,
                  n_errores=meta_1.get("errores") or 0)
    escribir_ofertas()
    escribir_apertura(config)
    _clima_si_hace_falta(refrescar_clima)
    print(f"[{ahora_iso()}] Extras listos.")
    return latest


def escribir_apertura(config):
    """
    Detector de apertura de venta (data/apertura.json).

    Mira los próximos ~14 meses y marca, ruta por ruta, si Smiles ya tiene
    premios o todavía no salió a la venta. Reusa lo que este mismo barrido
    acaba de escribir en latest.json, así que casi no consulta de más.
    Ver engine/apertura.py. Si falla, la corrida sigue igual.
    """
    try:
        import apertura
        apertura.correr(config=config, log=print, verificar_base=False)
    except Exception as e:
        print(f"  Apertura no actualizada en esta corrida: {e}")


def agregar_detalles(resultados, config, demo=False):
    """
    Enriquece los mejores resultados con el detalle del mejor día:
    aerolínea, horarios, duración y escalas. Solo si hay sesión de Smiles.
    """
    cfg = config.get("detalle", {})
    if not cfg.get("activado", True):
        return
    if not detalle_client.hay_sesion():
        print("  (sin sesión de Smiles: corré `python3 engine/login_smiles.py` "
              "para ver aerolíneas y escalas)")
        return

    niveles = set(cfg.get("solo_niveles", ["oportunidad", "bueno"]))
    maximo = 1 if demo else int(cfg.get("max_por_corrida", 10))
    candidatos = [r for r in resultados if r["nivel"] in niveles][:maximo]
    if not candidatos:
        return

    print(f"Trayendo detalle de vuelos para {len(candidatos)} mejores días...")
    try:
        with detalle_client.DetalleBrowser() as db:
            for r in candidatos:
                try:
                    det = db.detalle_dia(r["origen"], r["aeropuerto"],
                                         r["mejor_fecha"], currency=r["moneda"])
                except Exception as e:
                    print(f"  {r['ruta']}: detalle falló ({e})")
                    det = None
                if det and det.get("vuelos"):
                    r["detalle"] = det
                    v = det["vuelos"][0]
                    esc = "directo" if v["escalas"] == 0 else f"{v['escalas']} escala(s)"
                    print(f"  {r['ruta']} {r['mejor_fecha']}: {v['aerolinea']} "
                          f"{esc}, {len(det['vuelos'])} vuelos")
                else:
                    print(f"  {r['ruta']} {r['mejor_fecha']}: sin detalle")
                time.sleep(random.uniform(2.0, 4.0))
    except Exception as e:
        print(f"  Detalle no disponible en esta corrida: {e}")


def escribir_busqueda(config, radar, demo=False, max_llamadas=None,
                      max_segundos=None):
    """Actualiza y guarda data/busqueda.json (piernas ida+vuelta por día).

    Las idas salen de `radar` (el latest.json de esta corrida) sin gastar una
    llamada; las vueltas se consultan hasta agotar el presupuesto. Lo que no
    se refresca se conserva del archivo anterior, con su sello viejo.
    """
    print("Actualizando el buscador ida+vuelta...")
    previo = cargar_json(BUSQUEDA_PATH, {})
    try:
        data = busq.actualizar(config, previo, radar, log=print, demo=demo,
                               max_llamadas=max_llamadas,
                               max_segundos=max_segundos)
    except Exception as e:
        print(f"  Buscador no actualizado en esta corrida: {e}")
        return
    data["generado"] = ahora_iso()
    guardar_json(BUSQUEDA_PATH, data)
    n = sum(len(d.get("meses", {})) for d in data.get("destinos", {}).values())
    print(f"  Buscador: {len(data.get('destinos', {}))} destinos, {n} meses cargados.")


def escribir_destinos():
    """Vuelca el catálogo de destinos para que la app lo muestre."""
    out = {}
    for k, d in cat.DESTINOS.items():
        out[k] = {
            "nombre": d["nombre"], "pais": d["pais"], "region": d.get("region"),
            "emoji": d.get("emoji", "✈️"), "moneda": d.get("moneda", "USD"),
            "aeropuertos": d["aeropuertos"],
            "aerolineas": cat.AEROLINEAS.get(k, []),
            "tips": {str(m): t for m, t in cat.TIPS.get(k, {}).items()},
        }
    guardar_json(DESTINOS_PATH, {"origenes": cat.ORIGENES, "destinos": out})


def escribir_meta(config, iniciado=None, modo=None, estado="ok",
                  rutas=0, consultadas=0, n_errores=0):
    """Dólar MEP + costo de la milla + cómo le fue a ESTA corrida.

    meta.json pesa 200 bytes y la app lo repesca cada pocos minutos para saber
    si hay dato nuevo, así que acá va el parte del barrido:
      estado "ok"           terminó y publicó
             "vacio"        corrió pero no trajo nada; latest.json quedó viejo
             "sin_servidor" ningún servidor de Smiles sirve precios
    Es el ÚNICO archivo que se pisa cuando la corrida aborta: así la app puede
    decir "el barrido de las 12:14 falló, mostrando datos de las 09:12".
    """
    import dolar_client
    meta_previa = cargar_json(os.path.join(DATA, "meta.json"), {})
    precio_ars = float(config.get("precio_milla_ars", 2.90))
    dolar, dolar_fecha = dolar_client.dolar_mep()
    if not dolar:
        # Si dolarapi no contesta, el MEP de la corrida anterior es muchísimo
        # mejor que el valor_milla_usd de config (0,012 contra 0,0019 real:
        # multiplicaría por 6 todo lo que la app muestra en dólares).
        dolar = meta_previa.get("dolar_mep")
        dolar_fecha = meta_previa.get("dolar_fecha")
    valor_usd = round(precio_ars / dolar, 6) if dolar else \
        float(config.get("valor_milla_usd", 0.012))
    meta = {
        "generado": ahora_iso(),
        "iniciado": iniciado or ahora_iso(),
        "modo": modo or "completo",
        "estado": estado,
        "rutas": rutas,
        "consultadas": consultadas,
        "errores": n_errores,
        "dolar_mep": dolar,
        "dolar_fecha": dolar_fecha,
        "precio_milla_ars": precio_ars,
        "valor_milla_usd": valor_usd,
    }
    guardar_json(os.path.join(DATA, "meta.json"), meta)
    if dolar:
        print(f"  Dólar MEP ${dolar:,.0f} → milla a AR${precio_ars} = "
              f"{valor_usd*100:.2f}¢ USD")
    return meta


def escribir_ofertas():
    """Alertas recientes de los blogs de la comunidad (RSS)."""
    import ofertas_client
    print("Trayendo alertas de la comunidad (RSS)...")
    try:
        posts = ofertas_client.traer_ofertas(log=print)
    except Exception as e:
        print(f"  Ofertas no disponibles: {e}")
        return
    guardar_json(os.path.join(DATA, "ofertas.json"),
                 {"generado": ahora_iso(), "posts": posts})


def escribir_clima():
    """Trae y guarda promedios de temperatura por destino."""
    print("Refrescando clima (Open-Meteo)...")
    clima = {}
    for k, d in cat.DESTINOS.items():
        prom = clima_client.promedios_mensuales(d["lat"], d["lon"], anios=5)
        if prom:
            clima[k] = {"nombre": d["nombre"], "meses": prom}
            print(f"  {d['nombre']}: OK")
    guardar_json(CLIMA_PATH, {"generado": ahora_iso(), "destinos": clima})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="una sola ruta, prueba rápida")
    ap.add_argument("--clima", action="store_true", help="refresca también el clima")
    ap.add_argument("--rapido", action="store_true",
                    help="radar + una tanda de vueltas (las corridas del día)")
    ap.add_argument("--solo-radar", action="store_true",
                    help="etapa 1 de un completo: solo el radar, para publicar antes")
    ap.add_argument("--solo-extras", action="store_true",
                    help="etapa 2 de un completo: buscador, apertura, clima y ofertas")
    args = ap.parse_args()
    if args.solo_radar and args.solo_extras:
        ap.error("--solo-radar y --solo-extras son las dos mitades de un "
                 "completo: pasá una o ninguna, no las dos.")
    etapa = "radar" if args.solo_radar else "extras" if args.solo_extras else "todo"
    resultado = correr(demo=args.demo, refrescar_clima=args.clima,
                       rapido=args.rapido, etapa=etapa)
    # != 0 avisa a scripts/run.sh que NO publique los datos (ver el docstring).
    sys.exit(0 if resultado else 1)
