#!/usr/bin/env python3
"""
NachoVuela — detector de APERTURA DE VENTA.

Las aerolíneas no venden con infinita anticipación: abren la venta de cada mes
unos 11-12 meses antes. El día que abren es el momento de MÁXIMA disponibilidad
de asientos premio de todo el ciclo: está el inventario entero sin tocar. Después
solo se achica. Cazar ahí es la diferencia entre elegir fecha y agarrar lo que
quedó.

Este módulo mira, para cada ruta de los viajes activos, los próximos ~14 meses y
responde una sola pregunta por (ruta, mes): ¿HAY premios o NO HAY? Con eso:

  - Mantiene data/apertura.json con el estado de cada ruta+mes.
  - Detecta las TRANSICIONES de 'cerrado' a 'abierto' y las guarda como
    NOVEDADES con su timestamp, para que la app pueda cantar "se abrió la venta
    de septiembre 2027".
  - Arma un ranking de "próximos a abrir": los meses todavía cerrados ordenados
    por cercanía, con una estimación de cuánto falta.

Es MUY económico con Smiles, que es el recurso escaso:

  1. Los meses que el radar (rastrillar.py) ya consultó salen GRATIS de
     data/latest.json — cero consultas nuevas.
  2. Un mes que ya vimos abierto NO se vuelve a consultar: la venta no se cierra.
     Queda cacheado del run anterior.
  3. Solo se consultan los meses en la FRONTERA y más allá (desde el último mes
     que sabemos abierto hacia adelante). Los meses anteriores a la frontera se
     dan por abiertos sin gastar una consulta: si hay premios en agosto 2027,
     obviamente la venta de octubre 2026 está abierta.
  4. Hay un tope de consultas por corrida (`limite`), y las que entran se
     reparten mes por mes en round-robin: con 6 consultas se sondean los 4 o 5
     meses de la frontera en vez de agotarlas en uno solo.

Uso:
    python3 engine/apertura.py                 # corrida normal
    python3 engine/apertura.py --limite 8      # tope de consultas a Smiles
    python3 engine/apertura.py --horizonte 18  # cuántos meses mirar
    python3 engine/apertura.py --sin-smiles    # solo reusa el radar, no consulta

rastrillar.py lo llama solo al final del barrido COMPLETO (no en el rápido).
"""

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import destinos as cat
import smiles_client

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "engine")
DATA = os.path.join(ROOT, "data")

CONFIG_PATH = os.path.join(ENGINE, "config.json")
LATEST_PATH = os.path.join(DATA, "latest.json")
APERTURA_PATH = os.path.join(DATA, "apertura.json")

# Valores por defecto. Se pueden pisar desde config.json con un bloque
# "apertura": {"meses_horizonte": 14, "max_consultas": 30}
HORIZONTE_MESES = 14
MAX_CONSULTAS = 30
# Cuánto tiempo conservamos una novedad de apertura (días) y cuántas como mucho.
NOVEDADES_DIAS = 120
NOVEDADES_MAX = 150

MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def ym_de(anio, mes):
    return f"{anio:04d}-{mes:02d}"


def sumar_meses(ym, k):
    """'2027-06' + 3 -> '2027-09' (acepta k negativo)."""
    anio, mes = int(ym[:4]), int(ym[5:7])
    total = anio * 12 + (mes - 1) + k
    return ym_de(total // 12, total % 12 + 1)


def distancia_meses(ym_a, ym_b):
    """Cuántos meses hay de ym_a a ym_b (negativo si ym_b es anterior)."""
    a = int(ym_a[:4]) * 12 + int(ym_a[5:7])
    b = int(ym_b[:4]) * 12 + int(ym_b[5:7])
    return b - a


def mes_texto(ym):
    return f"{MESES_ES[int(ym[5:7]) - 1]} {ym[:4]}"


def horizonte(n, desde=None):
    """Los próximos n meses en formato 'YYYY-MM', arrancando por el actual."""
    hoy = desde or date.today()
    base = ym_de(hoy.year, hoy.month)
    return [sumar_meses(base, i) for i in range(n)]


def clave(origen, aeropuerto, ym):
    """Misma convención que el radar: 'EZE-MIA-2027-09'."""
    return f"{origen}-{aeropuerto}-{ym}"


# ---------------------------------------------------------------------------
# Qué rutas vigilamos y qué ya cubrió el radar
# ---------------------------------------------------------------------------

def _combinar(origenes_default, claves_destino, meses):
    """Expande (orígenes, destinos, meses) igual que rastrillar.rutas_desde_config."""
    for dk in claves_destino:
        d = cat.DESTINOS.get(dk)
        if not d:
            continue
        # Si el destino declara desde dónde tiene sentido salir, mandan esos.
        for og in (d.get("origenes") or origenes_default):
            for aero in d["aeropuertos"]:
                for ym in meses:
                    yield og, aero, dk, d, ym


def pares_vigilados(config):
    """
    Los (origen, aeropuerto) de los VIAJES ACTIVOS, con la ficha del destino.

    Los "destinos_vigilados" sueltos quedan afuera a propósito: son curiosidades,
    no planes, y cada uno multiplicaría las consultas por 14 meses.
    """
    pares = {}
    for viaje in config.get("viajes", []):
        if not viaje.get("activo"):
            continue
        for og, aero, dk, d, _ in _combinar(viaje.get("origenes", ["EZE"]),
                                            viaje.get("destinos", []), ["x"]):
            pares.setdefault((og, aero["code"]), {
                "origen": og,
                "origen_ciudad": cat.ORIGENES.get(og, {}).get("ciudad", og),
                "aeropuerto": aero["code"],
                "aeropuerto_ciudad": aero.get("ciudad", aero["code"]),
                "destino_key": dk,
                "destino_nombre": d["nombre"],
                "destino_pais": d["pais"],
                "destino_emoji": d.get("emoji", "✈️"),
                "region": d.get("region"),
                "moneda": d.get("moneda", config.get("moneda_default", "USD")),
            })
    return pares


def cobertura_radar(config):
    """Los (origen, aeropuerto, ym) que el radar SÍ consulta en cada corrida."""
    cubiertos = set()
    for viaje in config.get("viajes", []):
        if not viaje.get("activo"):
            continue
        for og, aero, _dk, _d, ym in _combinar(viaje.get("origenes", ["EZE"]),
                                               viaje.get("destinos", []),
                                               viaje.get("meses", [])):
            cubiertos.add((og, aero["code"], ym))
    if config.get("destinos_vigilados") and config.get("meses_vigilados"):
        for og, aero, _dk, _d, ym in _combinar(["EZE"], config["destinos_vigilados"],
                                               config["meses_vigilados"]):
            cubiertos.add((og, aero["code"], ym))
    return cubiertos


# ---------------------------------------------------------------------------
# Lectura del radar (gratis) y consulta a Smiles (cara)
# ---------------------------------------------------------------------------

# De dónde puede venir un estado: "radar" y "smiles" son observaciones reales,
# "cache" es una observación real de una corrida anterior, "inferido" es deducción
# (ver más abajo). El campo "fresco" dice si el dato se miró en ESTA corrida.
FUENTES_REALES = ("radar", "smiles", "cache")


def confirmado(fuente):
    """¿Ese estado se apoya en una consulta real y no en una inferencia?"""
    return fuente in FUENTES_REALES


def _radar_fallo(errores, origen, aeropuerto, ym):
    """¿El radar falló en esa ruta-mes? Entonces 'sin días' no significa cerrado."""
    marca = f"{origen}->{aeropuerto} {ym}"
    return any(marca in str(e) for e in errores or [])


def leer_radar(latest, cubiertos, pares, meses):
    """
    Convierte data/latest.json en estados sin gastar una sola consulta.

    Una ruta-mes que el radar consultó y NO aparece en resultados es un
    'cerrado' legítimo (rastrillar lo imprime como "sin disponibilidad"),
    salvo que esa consulta haya quedado registrada como error.
    """
    ts = latest.get("generado") or ahora_iso()
    errores = latest.get("errores") or []
    con_datos = {}
    for r in latest.get("resultados", []):
        con_datos[(r.get("origen"), r.get("aeropuerto"), r.get("ym"))] = r

    out = {}
    for (og, code) in pares:
        for ym in meses:
            k3 = (og, code, ym)
            if k3 not in cubiertos:
                continue
            r = con_datos.get(k3)
            if r:
                out[k3] = {
                    "estado": "abierto",
                    "dias_con_premio": r.get("total_dias_disponibles") or len(r.get("dias") or []),
                    "min_millas": r.get("mejor_precio_millas"),
                    "min_fecha": r.get("mejor_fecha"),
                    "visto": ts,
                    "fuente": "radar",
                    "fresco": True,
                }
            elif not _radar_fallo(errores, og, code, ym):
                out[k3] = {
                    "estado": "cerrado",
                    "dias_con_premio": 0,
                    "min_millas": None,
                    "min_fecha": None,
                    "visto": ts,
                    "fuente": "radar",
                    "fresco": True,
                }
    return out


def consultar_smiles(info, ym):
    """
    Una consulta de calendario a Smiles. Devuelve (dias, error).

    Mismo trato que el radar: pausas de 2.5-5 s, y para EEUU/Europa una sola
    llamada (solo_socias) porque GOL no vuela esas rutas.
    """
    anio, mes = int(ym[:4]), int(ym[5:7])
    try:
        dias, _bandas = smiles_client.calendario_mes(
            info["origen"], info["aeropuerto"], anio, mes,
            currency=info.get("moneda", "USD"),
            pausa=(2.5, 5.0),
            preferir_socias=info.get("destino_pais") != "Brasil",
            solo_socias=info.get("region") in ("eeuu", "europa"),
        )
        return dias, None
    except smiles_client.SmilesError as e:
        return None, str(e)
    except Exception as e:  # red rara, JSON roto: no rompemos la corrida
        return None, f"{type(e).__name__}: {e}"


# ---------------------------------------------------------------------------
# Corrida
# ---------------------------------------------------------------------------

def correr(config=None, limite=None, meses=None, log=print,
           verificar_base=True, consultar=True, salida=None):
    """
    Actualiza data/apertura.json. Devuelve el dict que escribió.

    limite: tope de consultas NUEVAS a Smiles en esta corrida.
    consultar=False: no toca Smiles, solo reusa el radar y lo cacheado.
    """
    if config is None:
        config = cargar_json(CONFIG_PATH, {})
    cfg = config.get("apertura", {}) or {}
    n_meses = int(cfg.get("meses_horizonte", HORIZONTE_MESES))
    if limite is None:
        limite = int(cfg.get("max_consultas", MAX_CONSULTAS))
    if meses is None:
        meses = horizonte(n_meses)

    pares = pares_vigilados(config)
    if not pares:
        log("  Apertura: no hay viajes activos, no hay nada que vigilar.")
        return None

    previo = cargar_json(salida or APERTURA_PATH, {})
    rutas_previas = previo.get("rutas", {}) or {}
    latest = cargar_json(LATEST_PATH, {})
    cubiertos = cobertura_radar(config)
    del_radar = leer_radar(latest, cubiertos, pares, meses)

    log(f"  Apertura: {len(pares)} rutas x {len(meses)} meses "
        f"({meses[0]} a {meses[-1]}), {len(del_radar)} ruta-mes gratis del radar.")

    # --- Estado de arranque: radar (fresco) > cache del run anterior ---------
    estados = {}
    for (og, code), info in pares.items():
        for ym in meses:
            k = clave(og, code, ym)
            reg = dict(info)
            reg["ruta"] = k
            reg["ym"] = ym
            reg["mes_texto"] = mes_texto(ym)
            ant = rutas_previas.get(k) or {}
            reg["abierto_desde"] = ant.get("abierto_desde")
            reg["chequeos"] = int(ant.get("chequeos") or 0)
            reg["_previo"] = ant.get("estado")
            reg["_previo_motivo"] = ant.get("motivo")

            obs_radar = del_radar.get((og, code, ym))
            if obs_radar:
                reg.update(obs_radar)
                reg["chequeos"] += 1
            elif (ant.get("estado") in ("abierto", "cerrado")
                  and confirmado(ant.get("fuente"))):
                reg.update({
                    "estado": ant["estado"],
                    "dias_con_premio": ant.get("dias_con_premio"),
                    "min_millas": ant.get("min_millas"),
                    "min_fecha": ant.get("min_fecha"),
                    "visto": ant.get("visto"),
                    "fuente": ant.get("fuente"),
                    "fresco": False,
                })
            else:
                reg.update({
                    "estado": "desconocido",
                    "dias_con_premio": None,
                    "min_millas": None,
                    "min_fecha": None,
                    "visto": None,
                    "fuente": None,
                    "fresco": False,
                })
            estados[k] = reg

    def frontera_de(estados_):
        """Último mes del horizonte con premios confirmados en alguna ruta."""
        abiertos = [r["ym"] for r in estados_.values()
                    if r["estado"] == "abierto" and confirmado(r.get("fuente"))]
        return max(abiertos) if abiertos else None

    # --- Qué consultamos: solo la frontera y para adelante -------------------
    frontera = frontera_de(estados)
    desde = frontera or meses[0]
    candidatos = {}
    for k, reg in estados.items():
        if reg["estado"] == "abierto":
            continue                      # la venta no se cierra: no re-consultamos
        if reg["ym"] < desde:
            continue                      # antes de la frontera: se da por abierto
        if reg.get("fresco"):
            continue                      # ya lo miramos gratis en esta corrida
        candidatos.setdefault(reg["ym"], []).append(reg)

    # Dentro de cada mes, primero las que hace más que no miramos.
    for ym in candidatos:
        candidatos[ym].sort(key=lambda r: (r.get("visto") or "", r["aeropuerto"]))

    # Round-robin por mes ascendente: con pocas consultas sondeamos TODOS los
    # meses de la frontera en vez de agotarlas en el primero.
    cola = []
    if candidatos:
        meses_c = sorted(candidatos)
        vuelta = 0
        while any(len(candidatos[m]) > vuelta for m in meses_c):
            for m in meses_c:
                if len(candidatos[m]) > vuelta:
                    cola.append(candidatos[m][vuelta])
            vuelta += 1

    consultas, errores = 0, []
    if consultar and cola and limite > 0:
        if verificar_base:
            smiles_client.base_activa(log=log)
        log(f"  Apertura: {len(cola)} ruta-mes por confirmar desde {desde}; "
            f"consulto hasta {min(limite, len(cola))}.")
        for reg in cola[:limite]:
            dias, err = consultar_smiles(reg, reg["ym"])
            consultas += 1
            reg["chequeos"] += 1
            if err:
                errores.append(err)
                log(f"    {reg['ruta']}: error ({err[:70]})")
                continue
            reg["visto"] = ahora_iso()
            reg["fuente"] = "smiles"
            reg["fresco"] = True
            if dias:
                mejor = min(dias, key=lambda d: d["miles"])
                reg.update({
                    "estado": "abierto",
                    "dias_con_premio": len(dias),
                    "min_millas": mejor["miles"],
                    "min_fecha": mejor["date"],
                })
                log(f"    {reg['ruta']}: ABIERTO — {len(dias)} días, "
                    f"desde {mejor['miles']:,} millas")
            else:
                reg.update({
                    "estado": "cerrado",
                    "dias_con_premio": 0,
                    "min_millas": None,
                    "min_fecha": None,
                })
                log(f"    {reg['ruta']}: cerrado (sin premios)")
    elif cola:
        log(f"  Apertura: {len(cola)} ruta-mes sin confirmar (no consulto Smiles).")

    # --- Cierre: inferencias, motivos, novedades ------------------------------
    frontera = frontera_de(estados)
    ahora = ahora_iso()
    hoy_ym = meses[0]

    # Meses confirmados abiertos por ruta: todo lo anterior está a la venta sí o sí.
    tope_por_par = {}
    for reg in estados.values():
        if reg["estado"] == "abierto" and confirmado(reg.get("fuente")):
            par = (reg["origen"], reg["aeropuerto"])
            if reg["ym"] > tope_por_par.get(par, ""):
                tope_por_par[par] = reg["ym"]

    novedades_nuevas = []
    for reg in estados.values():
        par = (reg["origen"], reg["aeropuerto"])
        if reg["estado"] == "desconocido":
            # Si esa misma ruta tiene premios en un mes POSTERIOR, este mes ya
            # está a la venta: lo damos por abierto sin gastar una consulta.
            if reg["ym"] < tope_por_par.get(par, "") or (frontera and reg["ym"] < frontera):
                reg["estado"] = "abierto"
                reg["fuente"] = "inferido"
                reg["fresco"] = False

        if reg["estado"] == "cerrado":
            # Cerrado más allá de la frontera = todavía no salió a la venta.
            # Cerrado por debajo de la frontera = está a la venta pero sin
            # asientos premio (se agotaron o no liberaron esa ruta).
            reg["motivo"] = ("no_a_la_venta"
                             if (frontera is None or reg["ym"] > frontera)
                             else "sin_premios")
        else:
            reg["motivo"] = None

        # Primera vez que lo vimos abierto (con dato real, no inferido).
        if reg["estado"] == "abierto" and reg.get("fresco"):
            if not reg.get("abierto_desde"):
                reg["abierto_desde"] = reg.get("visto") or ahora
            # TRANSICIÓN: lo teníamos cerrado y ahora tiene premios.
            if reg.get("_previo") == "cerrado":
                reg["abierto_desde"] = reg.get("visto") or ahora
                # Un mes que estaba "no a la venta" y ahora tiene premios es LA
                # apertura. Si solo estaba "sin premios", es que reaparecieron
                # asientos en una ruta que ya se vendía: bueno, pero no es lo mismo.
                tipo = ("apertura" if reg.get("_previo_motivo") != "sin_premios"
                        else "reaparicion")
                novedades_nuevas.append({
                    "tipo": tipo,
                    "ruta": reg["ruta"],
                    "ym": reg["ym"],
                    "mes_texto": reg["mes_texto"],
                    "origen": reg["origen"],
                    "aeropuerto": reg["aeropuerto"],
                    "aeropuerto_ciudad": reg["aeropuerto_ciudad"],
                    "destino_key": reg["destino_key"],
                    "destino_nombre": reg["destino_nombre"],
                    "destino_emoji": reg["destino_emoji"],
                    "dias_con_premio": reg["dias_con_premio"],
                    "min_millas": reg["min_millas"],
                    "min_fecha": reg["min_fecha"],
                    "ts": reg.get("visto") or ahora,
                    "titulo": ((f"Se abrió la venta de {reg['mes_texto']}: "
                                if tipo == "apertura"
                                else f"Volvieron a haber premios en {reg['mes_texto']}: ")
                               + f"{reg['origen']}→{reg['aeropuerto']}"),
                })

    for reg in estados.values():
        reg.pop("_previo", None)
        reg.pop("_previo_motivo", None)
        reg.pop("destino_pais", None)
        reg.pop("moneda", None)

    # --- Rollup por mes ------------------------------------------------------
    resumen_meses = []
    for ym in meses:
        regs = [r for r in estados.values() if r["ym"] == ym]
        ab = [r for r in regs if r["estado"] == "abierto"]
        ce = [r for r in regs if r["estado"] == "cerrado"]
        de = [r for r in regs if r["estado"] == "desconocido"]
        if ab and not ce:
            estado_mes = "abierto"
        elif ab:
            estado_mes = "parcial"
        elif ce:
            estado_mes = "cerrado"
        else:
            estado_mes = "desconocido"
        resumen_meses.append({
            "ym": ym,
            "mes_texto": mes_texto(ym),
            "estado": estado_mes,
            "abiertas": len(ab), "cerradas": len(ce), "desconocidas": len(de),
            "total": len(regs),
            "min_millas": min([r["min_millas"] for r in ab if r.get("min_millas")] or [0]) or None,
        })

    # --- Ranking de próximos a abrir ----------------------------------------
    # Anticipación observada: cuántos meses adelante llega hoy la venta.
    anticipacion = distancia_meses(hoy_ym, frontera) if frontera else None
    proximos = []
    for m in resumen_meses:
        if m["estado"] == "abierto":
            continue
        if frontera and m["ym"] <= frontera:
            continue        # hasta la frontera la venta ya está abierta
        k = distancia_meses(hoy_ym, m["ym"])
        espera_meses = max(0, k - anticipacion) if anticipacion is not None else None
        apertura_est = sumar_meses(hoy_ym, espera_meses) if espera_meses is not None else None
        proximos.append({
            "ym": m["ym"],
            "mes_texto": m["mes_texto"],
            "estado": m["estado"],
            "cerradas": m["cerradas"],
            "abiertas": m["abiertas"],
            "desconocidas": m["desconocidas"],
            "total": m["total"],
            "meses_de_espera": espera_meses,
            "apertura_estimada": apertura_est,
            "apertura_estimada_texto": mes_texto(apertura_est) if apertura_est else None,
            "estimado": True,
        })
    proximos.sort(key=lambda p: p["ym"])

    # --- Novedades: las nuevas + las que ya teníamos, sin repetir ------------
    novedades = list(novedades_nuevas)
    vistas = {(n["ruta"], n["ts"]) for n in novedades}
    for n in previo.get("novedades", []) or []:
        if (n.get("ruta"), n.get("ts")) in vistas:
            continue
        novedades.append(n)
    corte = datetime.now(timezone.utc).astimezone().timestamp() - NOVEDADES_DIAS * 86400

    def _vigente(n):
        try:
            return datetime.fromisoformat(n["ts"]).timestamp() >= corte
        except (ValueError, KeyError, TypeError):
            return True
    novedades = [n for n in novedades if _vigente(n)]
    novedades.sort(key=lambda n: n.get("ts") or "", reverse=True)
    novedades = novedades[:NOVEDADES_MAX]

    rutas = {k: estados[k] for k in sorted(estados)}
    n_ab = sum(1 for r in rutas.values() if r["estado"] == "abierto")
    n_ce = sum(1 for r in rutas.values() if r["estado"] == "cerrado")
    n_de = sum(1 for r in rutas.values() if r["estado"] == "desconocido")

    out = {
        "generado": ahora,
        "horizonte_meses": len(meses),
        "desde": meses[0],
        "hasta": meses[-1],
        "frontera": {
            "ym": frontera,
            "mes_texto": mes_texto(frontera) if frontera else None,
            "anticipacion_meses": anticipacion,
            "nota": ("Último mes con premios confirmados. La venta suele abrirse "
                     "11-12 meses antes; lo de más allá todavía no salió."),
        },
        "resumen": {
            "rutas": len(rutas),
            "abiertas": n_ab, "cerradas": n_ce, "desconocidas": n_de,
            "consultas_smiles": consultas,
            "reusados_radar": len(del_radar),
            "novedades_nuevas": len(novedades_nuevas),
        },
        "novedades": novedades,
        "proximos_a_abrir": proximos,
        "meses": resumen_meses,
        "errores": errores,
        "rutas": rutas,
    }
    guardar_json(salida or APERTURA_PATH, out)

    if novedades_nuevas:
        for n in novedades_nuevas[:5]:
            d = n["dias_con_premio"] or 0
            log(f"  🎉 {n['titulo']} ({d} día{'s' if d != 1 else ''} con premio)")
    log(f"  Apertura: {n_ab} abiertas / {n_ce} cerradas / {n_de} sin datos, "
        f"{consultas} consultas nuevas. Frontera: {frontera or 'sin datos'}.")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Detector de apertura de venta")
    ap.add_argument("--limite", type=int, default=None,
                    help="tope de consultas nuevas a Smiles en esta corrida")
    ap.add_argument("--horizonte", type=int, default=None,
                    help="cuántos meses mirar hacia adelante (default 14)")
    ap.add_argument("--sin-smiles", action="store_true",
                    help="no consulta Smiles: solo reusa el radar y lo cacheado")
    ap.add_argument("--salida", default=None,
                    help="escribir a otro archivo (para probar sin tocar data/)")
    args = ap.parse_args()
    cfg = cargar_json(CONFIG_PATH, {})
    ms = horizonte(args.horizonte) if args.horizonte else None
    correr(config=cfg, limite=args.limite, meses=ms,
           consultar=not args.sin_smiles, salida=args.salida)
