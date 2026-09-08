"""
Constructor de datos para el BUSCADOR de viajes (ida + vuelta).

La app es estática (vive en GitHub Pages), así que no puede "salir a buscar"
cuando Nacho toca un botón. Este módulo pre-cocina, para cada destino y mes de
sus viajes activos, el precio award de CADA día tanto de ida (EZE→destino) como
de vuelta (destino→EZE), cubriendo el mes del viaje y el siguiente (para poder
combinar salidas y regresos que cruzan de mes).

Con eso, la app arma del lado del cliente las mejores combinaciones ida+vuelta
según el rango de días que elija Nacho, sin ninguna llamada en vivo.

Salida: data/busqueda.json

Cómo se refresca (cambió el 8-sep-2026)
---------------------------------------
Antes esto se reconstruía entero y SOLO en el barrido completo, así que la
estación Buscar mostraba datos de hasta 24 h mientras el HUD y Partidas
mostraban los del último rápido: dos relojes distintos para el mismo vuelo, y
el 18% de los días no coincidían entre las dos pantallas.

Ahora:
  - Las IDAS salen GRATIS del radar. rastrillar.py consulta exactamente el
    mismo calendario (origen→destino, mes del viaje) que pedía este módulo:
    eran 50 llamadas duplicadas por corrida completa. Se actualizan en TODAS
    las corridas, rápidas incluidas.
  - Las VUELTAS (destino→origen) el radar no las consulta, así que hay que
    pedirlas. En el completo van todas (100 llamadas); en el rápido va una
    tanda rotativa de ~34 para que el rápido no pase de ~10 min.
  - Cada bloque mes queda sellado con g_ida / g_vta: de cuándo es CADA pierna.
    Si una ida se conserva de antes (porque el radar la vio parcial), g_ida
    guarda la fecha vieja, no la de ahora: el sello no miente.

Entrada principal: actualizar(config, previo, radar, ...).
"""

import time
from datetime import datetime, timezone

import smiles_client as sc
import cash_client as cc
import destinos as cat

# Cuántas llamadas de vuelta como mucho gasta un barrido RÁPIDO.
# Medido el 8-sep-2026: las vueltas completas son 100 llamadas y el radar 80.
# A ~4,9 s por llamada (pausa 2,2-4,5 s + la respuesta), el radar tarda ~7 min
# y las 100 vueltas ~8 min: juntos rozarían los 15 min, y el tope duro que
# run.sh le pone al rápido son 20. Con un tercio (34 llamadas ≈ 2,8 min) el
# rápido queda en ~10 min y cada destino-mes se refresca cada 3 rápidos.
LLAMADAS_VUELTA_RAPIDO = 34
# Y un tope de reloj por las dudas: si Smiles está lento, cortamos igual.
SEGUNDOS_VUELTA_RAPIDO = 240
# Cuánto más barato tiene que estar el otro aeropuerto de salida para que valga
# la pena mudar un destino entero (ver la histéresis en actualizar()).
MARGEN_MUDANZA = 0.05


def ahora_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _dias_compactos(dias):
    """Reduce la lista de días de smiles_client a claves cortas para el JSON."""
    out = []
    for d in dias:
        out.append({
            "d": d["date"],
            "mi": d["miles"],
            "q": d.get("price_range"),
            "f": d.get("fuente", "gol"),
        })
    return out


def _mes_siguiente(anio, mes):
    return (anio + 1, 1) if mes == 12 else (anio, mes + 1)


def _cash_ref_compacto(ref):
    """Reduce la referencia cash de la cascada a lo que la app necesita."""
    if not ref:
        return None
    return {"p": ref["precio"], "t": ref["tipo"], "x": ref["exacto"],
            "e": ref.get("escalas"), "f": ref.get("fecha")}


def _precios_por_origen(latest, destino_key, posibles):
    """{origen: el mínimo que el radar vio para ese destino} (sin parciales).

    Un calendario parcial no sirve para elegir origen: comparar un día suelto
    de AEP contra el mes entero de EZE elige cualquier cosa.
    """
    out = {}
    for r in (latest or {}).get("resultados", []):
        og = r.get("origen")
        if r.get("destino_key") != destino_key or og not in posibles:
            continue
        if r.get("parcial") or not r.get("dias"):
            continue
        p = r.get("mejor_precio_millas")
        if p is None:
            continue
        if og not in out or p < out[og]:
            out[og] = p
    return out


def _mejor_origen(posibles, destino_key, latest=None):
    """De los orígenes posibles, el que el último rastrillaje vio más barato.

    Devuelve None cuando el radar NO trae con qué decidir (ninguna ruta de ese
    destino, o todas parciales). Antes caía a posibles[0], y eso hacía que una
    corrida sin datos "opinara" y mandara a mudar de origen a un destino que
    estaba bien: si no sabemos, el que llama se queda con lo que ya tenía.
    """
    if len(posibles) == 1:
        return posibles[0]
    if latest is None:
        import json as _j, os as _o
        p = _o.path.join(_o.path.dirname(_o.path.dirname(_o.path.abspath(__file__))),
                         "data", "latest.json")
        try:
            with open(p, encoding="utf-8") as f:
                latest = _j.load(f)
        except (OSError, ValueError):
            return None
    precios = _precios_por_origen(latest, destino_key, posibles)
    if not precios:
        return None
    return min(precios, key=lambda og: precios[og])


def _destinos_meses(config):
    """{destino_key: (set de meses, orígenes posibles)} de los viajes activos."""
    origen_default = "EZE"
    out = {}
    for viaje in config.get("viajes", []):
        if not viaje.get("activo"):
            continue
        ogs = viaje.get("origenes") or [origen_default]
        for dk in viaje.get("destinos", []):
            meses = out.get(dk, (set(), None))[0]
            meses.update(viaje.get("meses", []))
            posibles = cat.DESTINOS.get(dk, {}).get("origenes") or ogs
            out[dk] = (meses, posibles)
    return out


def _indice_radar(radar):
    """{(origen, aeropuerto, ym): resultado} del latest.json que dejó el radar."""
    idx = {}
    for r in (radar or {}).get("resultados", []):
        idx[(r.get("origen"), r.get("aeropuerto"), r.get("ym"))] = r
    return idx


def _min_dias(mapa):
    """El mínimo de millas de un mapa {code: [dias compactos]} (o None)."""
    vals = [x["mi"] for arr in (mapa or {}).values() for x in arr]
    return min(vals) if vals else None


def _costo_llamadas(d):
    """Cuántas llamadas a Smiles cuesta refrescar las vueltas de un destino-mes."""
    por_consulta = 1 if d.get("region") in ("eeuu", "europa") else 2
    return len(d["aeropuertos"]) * por_consulta * 2   # dos meses de regreso


def _armar_ida(d, og, ym, idx, bloque_ant, sirve_lo_previo, radar_ts,
               sello_previo=None):
    """
    Las idas de un destino-mes desde `og`, gratis, con lo que vio el radar.

    Devuelve (mapa_por_aeropuerto, g_ida). Si el radar vio un calendario
    PARCIAL (Smiles mostrando 2 días de 31), no lo usamos: preferimos el dato
    viejo entero antes que borrar el mes del buscador en cada rápido. El sello
    devuelto es el del dato MÁS VIEJO que quedó a la vista.

    sello_previo: de cuándo es el busqueda.json anterior. Se usa para las
    piernas conservadas que todavía no tienen g_ida propio (la primera corrida
    después de este cambio). Sin eso, un mes con una pierna fresca y tres
    viejas se sellaría con la hora de la fresca y el cartel mentiría.
    """
    mapa, sellos = {}, []
    for aero in d["aeropuertos"]:
        code = aero["code"]
        r = idx.get((og, code, ym))
        if r and r.get("dias") and not r.get("parcial"):
            mapa[code] = _dias_compactos(r["dias"])
            sellos.append(r.get("consultado") or radar_ts)
        elif sirve_lo_previo and (bloque_ant.get("ida") or {}).get(code):
            mapa[code] = bloque_ant["ida"][code]
            sellos.append(bloque_ant.get("g_ida") or sello_previo)
    sellos = [s for s in sellos if s]
    return mapa, (min(sellos) if sellos else None)


def actualizar(config, previo, radar, log=print, demo=False,
               max_llamadas=None, max_segundos=None):
    """
    Devuelve el dict listo para guardar como data/busqueda.json.

    previo: el busqueda.json de la corrida anterior (lo que no se refresca se
      conserva, con su sello viejo).
    radar: el latest.json que este mismo barrido acaba de armar (las idas
      salen de ahí, sin gastar una llamada).
    max_llamadas / max_segundos: presupuesto para las VUELTAS. None = todas
      (barrido completo). En el rápido se pasa LLAMADAS_VUELTA_RAPIDO.

    Sobre el origen de cada destino: _mejor_origen() lo elige con el radar
    fresco, pero las VUELTAS guardadas son de un origen concreto. Si el elegido
    cambia, NO mezclamos piernas (el 7-sep-2026 el buscador dejó Río con idas
    de un origen y vueltas de otro). La mudanza es de a destino ENTERO y todo o
    nada: solo se intenta si sus meses entran en el presupuesto de esta corrida
    y, si las vueltas nuevas no llegan, el destino vuelve tal cual estaba.
    """
    idx = _indice_radar(radar)
    radar_ts = (radar or {}).get("generado")
    sello_previo = (previo or {}).get("generado")
    prev_dest = (previo or {}).get("destinos", {}) or {}
    dm = _destinos_meses(config)

    # --- Quién se muda de origen en esta corrida ----------------------------
    # Un destino con varios meses (Mendoza tiene 6) tiene que mudarse con
    # TODOS sus meses juntos: si mudáramos mes por mes, dest["origen"] diría
    # uno solo mientras la mitad de los meses siguen con idas del otro.
    mudanzas = {}
    # Con presupuesto cero (--solo-radar) no hay con qué pagar ninguna mudanza:
    # ni las evaluamos, así el log no se llena de avisos sobre algo que esta
    # etapa nunca iba a hacer.
    candidatas = dm.items() if max_llamadas != 0 else []
    for dk, (meses, posibles) in candidatas:
        d = cat.DESTINOS.get(dk)
        if not d:
            continue
        deseado = _mejor_origen(posibles, dk, latest=radar)
        anterior = (prev_dest.get(dk) or {}).get("origen")
        # Sin opinión del radar (deseado None) no se muda nadie.
        if not deseado or not anterior or anterior == deseado:
            continue
        # Histéresis: mudarse cuesta caro (Mendoza son 24 llamadas, el 70% del
        # presupuesto de vueltas de un rápido) y tira a la basura las vueltas
        # guardadas del origen viejo. Por 500 millas de diferencia no vale la
        # pena y encima al día siguiente Smiles las da vuelta y mudaríamos otra
        # vez, dejando al resto del buscador sin refrescar. Solo nos movemos si
        # el otro origen está al menos un MARGEN_MUDANZA más barato.
        precios = _precios_por_origen(radar, dk, posibles)
        p_nuevo, p_viejo = precios.get(deseado), precios.get(anterior)
        if p_viejo and p_nuevo and p_nuevo > p_viejo * (1 - MARGEN_MUDANZA):
            continue
        costo = _costo_llamadas(d) * len(meses)
        if max_llamadas is not None and costo > max_llamadas:
            log(f"    {dk}: convendría mudarse a {deseado}, pero son {costo} "
                f"llamadas y esta corrida tiene {max_llamadas}: lo dejo en "
                f"{anterior} hasta el próximo completo.")
            continue
        log(f"    {dk}: el radar prefiere {deseado} (hoy {anterior}); "
            f"lo mudo entero con {costo} llamadas.")
        mudanzas[dk] = deseado

    data = {
        "generado": None,  # lo pone rastrillar
        "origen_default": "EZE",
        "valor_milla_usd": config.get("valor_milla_usd", 0.012),
        "destinos": {},
    }

    # --- Paso 1: idas (gratis) y armado de la cola de vueltas ---------------
    cola = []
    respaldo = {}     # para deshacer una mudanza que no consiga vueltas
    for dk, (meses, posibles) in dm.items():
        d = cat.DESTINOS.get(dk)
        if not d:
            continue
        ant = prev_dest.get(dk) or {}
        muda = dk in mudanzas
        og = (mudanzas[dk] if muda else
              (ant.get("origen") or _mejor_origen(posibles, dk, latest=radar)
               or posibles[0]))

        moneda = d.get("moneda", config.get("moneda_default", "USD"))
        dest_out = {
            "nombre": d["nombre"], "pais": d["pais"], "region": d.get("region"),
            "emoji": d.get("emoji", "✈️"), "moneda": moneda,
            "origen": og, "origen_ciudad": cat.ORIGENES.get(og, {}).get("ciudad", og),
            "aeropuertos": d["aeropuertos"],
            "meses": {},
        }

        for ym in sorted(meses):
            bloque_ant = ((ant.get("meses") or {}).get(ym)) or {}
            # Lo guardado solo sirve si es del mismo origen que vamos a mostrar.
            sirve = ant.get("origen") == og
            mapa, g_ida = _armar_ida(d, og, ym, idx, bloque_ant, sirve,
                                     radar_ts, sello_previo)
            bloque = {
                "ida": mapa,
                "vuelta": dict(bloque_ant.get("vuelta") or {}) if sirve else {},
                "g_ida": g_ida,
                "g_vta": (bloque_ant.get("g_vta") or sello_previo) if sirve else None,
            }
            for clave in ("cash_ref", "cash_ida", "cash_vuelta"):
                if sirve and bloque_ant.get(clave):
                    bloque[clave] = bloque_ant[clave]
            dest_out["meses"][ym] = bloque

            # Prioridad de refresco:
            #   0 = mudanza de origen (el destino no sirve hasta completarla)
            #   1 = no tengo vueltas
            #   2 = el mínimo de ida se movió (cambian las combinaciones)
            #   3 = rutina, la más vieja primero
            if muda:
                prio = 0
            elif not bloque["vuelta"]:
                prio = 1
            elif _min_dias(mapa) != _min_dias(bloque_ant.get("ida")):
                prio = 2
            else:
                prio = 3
            cola.append((prio, bloque["g_vta"] or "", dk, ym))

        if muda:
            respaldo[dk] = ant
        data["destinos"][dk] = dest_out

    cola.sort()

    # --- Paso 2: vueltas (lo único que se consulta) -------------------------
    if demo:
        cola = cola[:1]
    _traer_vueltas(data, config, cola, log=log, demo=demo,
                   max_llamadas=max_llamadas, max_segundos=max_segundos)

    # --- Paso 3: deshacer las mudanzas que se quedaron sin vueltas ----------
    for dk, ant in respaldo.items():
        dest = data["destinos"].get(dk)
        if not dest:
            continue
        sin_vueltas = [ym for ym, b in dest["meses"].items() if not b.get("vuelta")]
        if not sin_vueltas:
            continue
        log(f"    {dk}: la mudanza a {dest['origen']} se quedó sin vueltas "
            f"({len(sin_vueltas)} mes/es); vuelvo a {ant.get('origen')}.")
        og = ant.get("origen")
        dest["origen"] = og
        dest["origen_ciudad"] = cat.ORIGENES.get(og, {}).get("ciudad", og)
        d = cat.DESTINOS[dk]
        for ym, bloque in dest["meses"].items():
            bloque_ant = ((ant.get("meses") or {}).get(ym)) or {}
            mapa, g_ida = _armar_ida(d, og, ym, idx, bloque_ant, True,
                                     radar_ts, sello_previo)
            bloque["ida"], bloque["g_ida"] = mapa, g_ida
            bloque["vuelta"] = dict(bloque_ant.get("vuelta") or {})
            bloque["g_vta"] = bloque_ant.get("g_vta") or sello_previo
            for clave in ("cash_ref", "cash_ida", "cash_vuelta"):
                if bloque_ant.get(clave):
                    bloque[clave] = bloque_ant[clave]

    return data


def _traer_vueltas(data, config, cola, log=print, demo=False,
                   max_llamadas=None, max_segundos=None):
    """Consulta las vueltas destino→origen en el orden de `cola`, con tope.

    Un destino-mes se refresca ENTERO (todos sus aeropuertos y los dos meses de
    regreso) o no se toca: así g_vta describe exactamente lo que se ve.
    """
    if max_llamadas is not None and max_llamadas <= 0:
        # Etapa --solo-radar: las idas ya quedaron actualizadas gratis y las
        # vueltas las hace la etapa 2. Ojo: sin este corte, la regla de "al
        # menos un destino-mes aunque no entre en el presupuesto" (la que
        # garantiza que la rotación siempre avanza) hacía uno igual.
        log("    (esta etapa no consulta vueltas)")
        return 0

    cash_tok = cc.token(config)
    arranque = time.time()
    gastadas, hechos, intentos = 0, 0, 0

    for _prio, _ts, dk, ym in cola:
        dest = data["destinos"].get(dk)
        d = cat.DESTINOS.get(dk)
        if not dest or not d:
            continue
        costo = _costo_llamadas(d)
        # El tope se aplica desde el segundo INTENTO, no desde el segundo
        # acierto: el primero pasa siempre para que la rotación avance aunque
        # no entre en el presupuesto, pero si contáramos aciertos y Smiles
        # estuviera devolviendo errores, el rápido seguiría gastando llamadas
        # sin techo hasta que alguno trajera algo.
        if max_llamadas is not None and intentos and gastadas + costo > max_llamadas:
            break
        if max_segundos is not None and time.time() - arranque > max_segundos:
            log(f"    (corto las vueltas: van {int(time.time() - arranque)} s)")
            break
        intentos += 1

        og = dest["origen"]
        moneda = dest.get("moneda", config.get("moneda_default", "USD"))
        preferir_socias = d.get("pais") != "Brasil"
        solo_soc = d.get("region") in ("eeuu", "europa")
        anio, mes = int(ym[:4]), int(ym[5:7])
        a2, m2 = _mes_siguiente(anio, mes)
        pausa = (0.3, 0.7) if demo else (2.2, 4.5)
        bloque = dest["meses"][ym]

        nuevas, cash_ref, cash_i, cash_v = {}, {}, {}, {}
        for aero in d["aeropuertos"]:
            code = aero["code"]
            vuelta = []
            for (ya, ma) in ((anio, mes), (a2, m2)):
                gastadas += 1 if solo_soc else 2
                try:
                    dv, _b, _decl = sc.calendario_mes(
                        code, og, ya, ma, currency=moneda,
                        pausa=pausa, preferir_socias=preferir_socias,
                        solo_socias=solo_soc)
                    vuelta.extend(dv)
                except sc.SmilesError as e:
                    log(f"    vuelta {code}->{og} {ya}-{ma:02d}: ERROR {e}")
            if vuelta:
                # de-duplicar por fecha quedándonos con el mínimo
                porf = {}
                for x in vuelta:
                    f = x["date"]
                    if f not in porf or x["miles"] < porf[f]["miles"]:
                        porf[f] = x
                nuevas[code] = _dias_compactos(
                    sorted(porf.values(), key=lambda z: z["date"]))

            # El cash viaja con la vuelta para que referencia y días sean del
            # mismo momento (antes se rehacía entero en cada completo).
            if cash_tok:
                try:
                    ref_i = cc.precio_cash_mes(og, code, anio, mes, cash_tok,
                                               pausa=(0.3, 0.6))
                    ref_v = cc.precio_cash_mes(code, og, anio, mes, cash_tok,
                                               pausa=(0.3, 0.6))
                    if ref_i or ref_v:
                        cash_ref[code] = {"ida": _cash_ref_compacto(ref_i),
                                          "vuelta": _cash_ref_compacto(ref_v)}
                except cc.CashError as e:
                    log(f"    cash ref {code}: {e}")
                di = cc.cash_por_dia(og, code, anio, mes, cash_tok)
                dv2 = dict(cc.cash_por_dia(code, og, anio, mes, cash_tok))
                dv2.update(cc.cash_por_dia(code, og, a2, m2, cash_tok))
                if di:
                    cash_i[code] = di
                if dv2:
                    cash_v[code] = dv2

        if not nuevas:
            log(f"    {dk} {ym} desde {og}: sin vueltas (dejo lo que había)")
            continue

        bloque["vuelta"] = nuevas
        bloque["g_vta"] = ahora_iso()
        if cash_ref:
            bloque["cash_ref"] = cash_ref
        if cash_i:
            bloque["cash_ida"] = cash_i
        if cash_v:
            bloque["cash_vuelta"] = cash_v
        hechos += 1

        n_v = sum(len(v) for v in bloque["vuelta"].values())
        n_i = sum(len(v) for v in bloque["ida"].values())
        log(f"    {dk} {ym} desde {og}: ida {n_i}d (del radar) · vuelta {n_v}d")

    log(f"    Vueltas: {hechos} de {len(cola)} destino-mes, {gastadas} llamadas, "
        f"{int(time.time() - arranque)} s.")
    return hechos
