"""
Cliente de la API de calendario de Smiles Argentina.

Usa el endpoint público que la propia web de Smiles consume para pintar el
calendario de precios: devuelve, para cada día de un mes, el precio award
MÍNIMO en millas y en qué cuartil de precio cae ese día (1 = más barato,
4 = más caro). Ese cuartil es, literalmente, nuestro semáforo de oportunidades.

Detalles importantes:
- Trabajamos en MILLAS como unidad universal de comparación (el precio award
  es en millas sin importar la moneda de las tasas).
- Somos respetuosos con Smiles: pausa entre llamadas y user-agent de navegador
  real. Smiles bloquea búsquedas masivas, así que vamos despacio.
"""

import time
import random
import requests

import dns_cache
dns_cache.precalentar([
    "api-air-calendar-blue.smiles.com.br",
    "api.travelpayouts.com",
    "archive-api.open-meteo.com",
])

BASE = "https://api-air-calendar-blue.smiles.com.br/v1/airlines/calendar/month"

# Clave pública que usa el propio sitio de Smiles (visible en el navegador).
API_KEY = "aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw"
BEARER = "Bearer EQjdqeAqKyfFnM4ggBh8oVrV9iSzQvX823u81K4eGVPfKpEdfKnSri"

HEADERS = {
    "x-api-key": API_KEY,
    "authorization": BEARER,
    "region": "ARGENTINA",
    "channel": "Web",
    "language": "es-ES",
    "accept": "application/json, text/plain, */*",
    "origin": "https://www.smiles.com.ar",
    "referer": "https://www.smiles.com.ar/",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}


class SmilesError(Exception):
    pass


def calendario_mes(origen, destino, anio, mes, currency="USD",
                   pausa=(2.5, 5.0), reintentos=4, preferir_socias=False,
                   solo_socias=False):
    """
    Trae el calendario de precios award de un mes para una ruta, consultando
    DOS veces: la búsqueda normal (GOL + socias según la ruta) y la forzada a
    aerolíneas socias (forceCongener=true). Smiles a veces solo muestra las
    opciones de socias en la segunda, así que fusionamos ambas. Verificado el
    13-jul-2026: en EZE->GRU la normal daba 0 días y la de socias 2 días.

    preferir_socias (para destinos fuera de Brasil): el precio del día es el
    de aerolíneas socias; el de la consulta normal (GOL, usualmente con
    conexión por Brasil) solo se usa si las socias no tienen ese día, y el
    día queda etiquetado fuente="gol". Para Brasil (preferir_socias=False)
    GOL compite de igual a igual y gana el más barato.

    Returns:
        (dias, quartil_bands)
        dias: lista de dicts {date, miles, price_range, is_lowest, fare_type,
              fuente ("gol"|"socias"|"ambas"), gol_alt (millas GOL si además
              existe opción GOL más barata que la elegida)}.
    """
    # Para EEUU/Europa GOL no tiene vuelos propios: la consulta normal es
    # redundante (verificado: EZE-MIA idéntico con y sin forceCongener).
    # solo_socias=True la saltea y el rastrillaje tarda la mitad.
    if solo_socias:
        dias_a, bandas_a = [], None
    else:
        dias_a, bandas_a = _consulta(origen, destino, anio, mes, currency,
                                     force_congener="false", reintentos=reintentos)
        _dormir(pausa)
    dias_b, bandas_b = _consulta(origen, destino, anio, mes, currency,
                                 force_congener="true", reintentos=reintentos)
    _dormir(pausa)

    mapa_a = {d["date"]: d for d in dias_a}   # consulta normal (incluye GOL)
    mapa_b = {d["date"]: d for d in dias_b}   # solo aerolíneas socias

    por_fecha = {}
    for f in set(mapa_a) | set(mapa_b):
        a, b = mapa_a.get(f), mapa_b.get(f)
        if a and b:
            if preferir_socias:
                elegido = dict(b)
                elegido["fuente"] = "ambas"
                if a["miles"] < b["miles"]:
                    elegido["gol_alt"] = a["miles"]
            else:
                elegido = dict(a if a["miles"] <= b["miles"] else b)
                elegido["fuente"] = "ambas"
        elif b:
            elegido = dict(b)
            elegido["fuente"] = "socias"
        else:
            elegido = dict(a)
            elegido["fuente"] = "gol"
        por_fecha[f] = elegido

    dias = sorted(por_fecha.values(), key=lambda x: x["date"])
    return dias, (bandas_b or bandas_a)


def _consulta(origen, destino, anio, mes, currency, force_congener, reintentos=4):
    """Una llamada al calendario. Devuelve (dias, bandas)."""
    # Ventana: primer día del mes objetivo hasta ~5 días del mes siguiente,
    # con departureDate a mitad de mes para que la API poble ese mes.
    departure = f"{anio:04d}-{mes:02d}-15"
    start = f"{anio:04d}-{mes:02d}-01"
    # fin: día 5 del mes siguiente
    if mes == 12:
        end = f"{anio + 1:04d}-01-05"
    else:
        end = f"{anio:04d}-{mes + 1:02d}-05"

    params = {
        "adults": 1, "children": 0, "infants": 0,
        "cabinType": "all", "tripType": 2,
        "currencyCode": currency,
        "departureDate": departure,
        "originAirportCode": origen, "originAirportIsAny": "false",
        "destinationAirportCode": destino, "destinAirportIsAny": "false",
        "startDate": start, "endDate": end,
        "searchType": "g3", "segments": 1,
        "isFlexibleDateChecked": "false",
        "forceCongener": force_congener, "checkCalendar": "false",
        "r": "ar",
    }

    ultimo_error = None
    for intento in range(reintentos):
        try:
            resp = requests.get(BASE, headers=HEADERS, params=params, timeout=40)
            if resp.status_code == 200:
                return _parsear(resp.json(), anio, mes)
            ultimo_error = f"HTTP {resp.status_code}"
            time.sleep(3 * (intento + 1))
        except requests.RequestException as e:
            ultimo_error = str(e)
            # Falla de red (DNS caído, wifi, etc.): esperar bastante más,
            # suele ser transitorio (visto 17-jul-2026: DNS flameante).
            time.sleep(15 * (intento + 1))

    raise SmilesError(f"{origen}->{destino} {anio}-{mes:02d} (congener={force_congener}): {ultimo_error}")


def _parsear(data, anio, mes):
    segs = data.get("calendarSegmentList") or []
    if not segs:
        return [], None
    day_list = segs[0].get("calendarDayList", [])
    bandas = None
    dias = []
    prefijo = f"{anio:04d}-{mes:02d}-"
    for d in day_list:
        fecha = d.get("date", "")
        miles = d.get("miles")
        if not miles:
            continue
        # Solo días del mes objetivo (la ventana incluye días del mes siguiente)
        if not fecha.startswith(prefijo):
            continue
        if bandas is None and d.get("Quartil"):
            bandas = d["Quartil"]
        dias.append({
            "date": fecha,
            "miles": miles,
            "price_range": d.get("priceRange"),
            "is_lowest": bool(d.get("is_lowest") or d.get("isLowestPrice")),
            "fare_type": (d.get("fare") or {}).get("type"),
        })
    return dias, bandas


def _dormir(pausa):
    lo, hi = pausa
    time.sleep(random.uniform(lo, hi))
