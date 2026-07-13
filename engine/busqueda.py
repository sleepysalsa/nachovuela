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
"""

import smiles_client as sc
import destinos as cat


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


def construir(config, log=print, demo=False):
    """
    Devuelve el dict de búsqueda listo para guardar como data/busqueda.json.
    Recorre solo los viajes activos (destinos + meses).
    """
    origen_default = "EZE"
    # Recolectar (destino_key, set de meses) de todos los viajes activos
    destinos_meses = {}
    origen_por_destino = {}
    for viaje in config.get("viajes", []):
        if not viaje.get("activo"):
            continue
        ogs = viaje.get("origenes") or [origen_default]
        for dk in viaje.get("destinos", []):
            destinos_meses.setdefault(dk, set()).update(viaje.get("meses", []))
            origen_por_destino.setdefault(dk, ogs[0])

    salida = {
        "generado": None,  # lo pone rastrillar
        "origen_default": origen_default,
        "destinos": {},
    }

    items = list(destinos_meses.items())
    if demo:
        items = items[:1]

    for dk, meses in items:
        d = cat.DESTINOS.get(dk)
        if not d:
            continue
        og = origen_por_destino.get(dk, origen_default)
        moneda = d.get("moneda", config.get("moneda_default", "USD"))
        es_brasil = d.get("pais") == "Brasil"
        preferir_socias = not es_brasil  # GOL secundario salvo Brasil

        dest_out = {
            "nombre": d["nombre"], "pais": d["pais"], "region": d.get("region"),
            "emoji": d.get("emoji", "✈️"), "moneda": moneda,
            "origen": og, "origen_ciudad": cat.ORIGENES.get(og, {}).get("ciudad", og),
            "aeropuertos": d["aeropuertos"],
            "meses": {},
        }

        meses_ord = sorted(meses)
        if demo:
            meses_ord = meses_ord[:1]

        for ym in meses_ord:
            anio, mes = int(ym[:4]), int(ym[5:7])
            a2, m2 = _mes_siguiente(anio, mes)
            bloque = {"ida": {}, "vuelta": {}}

            for aero in d["aeropuertos"]:
                code = aero["code"]
                pausa = (0.3, 0.7) if demo else (2.2, 4.5)

                # IDA: EZE -> destino, mes del viaje
                try:
                    dias_ida, _ = sc.calendario_mes(
                        og, code, anio, mes, currency=moneda,
                        pausa=pausa, preferir_socias=preferir_socias)
                except sc.SmilesError as e:
                    log(f"    ida {og}->{code} {ym}: ERROR {e}")
                    dias_ida = []
                if dias_ida:
                    bloque["ida"][code] = _dias_compactos(dias_ida)

                # VUELTA: destino -> EZE, mes del viaje + mes siguiente
                vuelta = []
                for (ya, ma) in ((anio, mes), (a2, m2)):
                    try:
                        dv, _ = sc.calendario_mes(
                            code, og, ya, ma, currency=moneda,
                            pausa=pausa, preferir_socias=preferir_socias)
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
                    bloque["vuelta"][code] = _dias_compactos(
                        sorted(porf.values(), key=lambda z: z["date"]))

                n_i = len(bloque["ida"].get(code, []))
                n_v = len(bloque["vuelta"].get(code, []))
                log(f"    {dk} {ym} {code}: ida {n_i}d · vuelta {n_v}d")

            dest_out["meses"][ym] = bloque

        salida["destinos"][dk] = dest_out

    return salida
