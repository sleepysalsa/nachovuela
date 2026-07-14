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
    python3 engine/rastrillar.py            # rastrilla según config
    python3 engine/rastrillar.py --clima    # además refresca el clima
    python3 engine/rastrillar.py --demo     # una sola ruta, para probar rápido

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

def clasificar(miles, price_range, historico_ruta_mes):
    """
    Devuelve ("oportunidad" | "bueno" | "normal" | "caro", motivo_texto).

    Combina dos señales:
      - price_range: cuartil de Smiles (1 = más barato de la ruta, 4 = más caro).
      - historico_ruta_mes: lista de precios mínimos que ya vimos para esa
        ruta+mes en corridas anteriores (nuestro baseline propio).
    """
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
        for og in origenes:
            for dk in destinos_claves:
                d = cat.DESTINOS.get(dk)
                if not d:
                    continue
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


def correr(demo=False, refrescar_clima=False):
    config = cargar_json(CONFIG_PATH, {})
    historial = cargar_json(HIST_PATH, {"rutas": {}})
    rutas_hist = historial.setdefault("rutas", {})

    tareas = rutas_desde_config(config)
    if demo:
        tareas = tareas[:1]

    cash_tok = cash_client.token(config)
    print(f"[{ahora_iso()}] Rastrillando {len(tareas)} ruta-mes...")
    if cash_tok:
        print("  (precios cash activados vía Travelpayouts)")
    else:
        print("  (sin token de precios cash: la app muestra solo millas — "
              "ver README para activarlo)")

    resultados = []
    errores = []
    for i, t in enumerate(tareas, 1):
        og, code = t["origen"], t["aeropuerto"]["code"]
        moneda = t["destino"].get("moneda", config.get("moneda_default", "USD"))
        etiqueta = f"{og}->{code} {t['ym']}"
        es_brasil = t["destino"]["pais"] == "Brasil"
        try:
            dias, bandas = smiles_client.calendario_mes(
                og, code, t["anio"], t["mes"], currency=moneda,
                pausa=(0.4, 0.9) if demo else (2.5, 5.0),
                preferir_socias=not es_brasil,
            )
        except smiles_client.SmilesError as e:
            print(f"  [{i}/{len(tareas)}] {etiqueta}: ERROR {e}")
            errores.append(str(e))
            continue

        if not dias:
            print(f"  [{i}/{len(tareas)}] {etiqueta}: sin disponibilidad")
            continue

        # Mínimo del mes para esta ruta
        mejor = min(dias, key=lambda d: d["miles"])
        k = clave_ruta(og, code, t["ym"])

        # Histórico propio de esta ruta+mes (mínimos de corridas previas)
        hist = rutas_hist.setdefault(k, {"snapshots": []})
        previos = [s["min_miles"] for s in hist["snapshots"]]

        nivel, motivos = clasificar(mejor["miles"], mejor["price_range"], previos)

        # Guardar snapshot en el histórico
        hist["snapshots"].append({
            "ts": ahora_iso(),
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

        resultados.append({
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
            "mejor_precio_millas": mejor["miles"],
            "mejor_fecha": mejor["date"],
            "price_range": mejor["price_range"],
            "quartil_bandas": bandas,
            "nivel": nivel,
            "motivos": motivos,
            "promedio_historico": promedio_hist,
            "dias": dias,
            "total_dias_disponibles": len(dias),
            "cash": cash,
        })
        flag = {"oportunidad": "🟢🔥", "bueno": "🟢", "normal": "⚪", "caro": "🔴"}[nivel]
        print(f"  [{i}/{len(tareas)}] {etiqueta}: {flag} {mejor['miles']:,} millas "
              f"({mejor['date']}) — {len(dias)} días disp.")

    # Ordenar: oportunidades primero, luego por precio
    orden_nivel = {"oportunidad": 0, "bueno": 1, "normal": 2, "caro": 3}
    resultados.sort(key=lambda r: (orden_nivel[r["nivel"]], r["mejor_precio_millas"]))

    # Detalle de vuelos (aerolínea / duración / escalas) para los mejores días.
    # Requiere sesión de Smiles iniciada (python3 engine/login_smiles.py).
    agregar_detalles(resultados, config, demo=demo)

    latest = {
        "generado": ahora_iso(),
        "total_rutas": len(resultados),
        "errores": errores,
        "resultados": resultados,
    }
    guardar_json(LATEST_PATH, latest)
    guardar_json(HIST_PATH, historial)
    escribir_destinos()
    if refrescar_clima or not os.path.exists(CLIMA_PATH):
        escribir_clima()

    # Datos del BUSCADOR ida+vuelta (piernas de ida y de regreso por día)
    escribir_busqueda(config, demo=demo)
    escribir_meta(config)
    escribir_ofertas()

    n_op = sum(1 for r in resultados if r["nivel"] == "oportunidad")
    print(f"[{ahora_iso()}] Listo. {len(resultados)} rutas, {n_op} oportunidades 🔥, "
          f"{len(errores)} errores.")
    return latest


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


def escribir_busqueda(config, demo=False):
    """Construye y guarda data/busqueda.json (piernas ida+vuelta por día)."""
    print("Armando datos del buscador ida+vuelta...")
    try:
        data = busq.construir(config, log=print, demo=demo)
    except Exception as e:
        print(f"  Buscador no generado en esta corrida: {e}")
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


def escribir_meta(config):
    """Dólar MEP + costo real de la milla en USD (para el armador)."""
    import dolar_client
    precio_ars = float(config.get("precio_milla_ars", 2.90))
    dolar, dolar_fecha = dolar_client.dolar_mep()
    valor_usd = round(precio_ars / dolar, 6) if dolar else \
        float(config.get("valor_milla_usd", 0.012))
    meta = {
        "generado": ahora_iso(),
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
    args = ap.parse_args()
    correr(demo=args.demo, refrescar_clima=args.clima)
