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
                   pausa=(2.5, 5.0), reintentos=3):
    """
    Trae el calendario de precios award de un mes para una ruta.

    Args:
        origen, destino: códigos IATA (ej. "EZE", "MIA").
        anio, mes: año y mes a consultar (int).
        currency: moneda de las tasas ("USD" o "ARS"). No afecta las millas.
        pausa: rango (min, max) de segundos a esperar tras la llamada, para
               no golpear a Smiles.
        reintentos: intentos ante errores transitorios.

    Returns:
        Lista de dicts, uno por día:
        {date, miles, price_range (1-4 o None), is_lowest (bool)}
        Solo incluye días con precio disponible.
        Además devuelve, aparte, las bandas de cuartil de la ruta.

    Returns:
        (dias, quartil_bands)
    """
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
        "forceCongener": "false", "checkCalendar": "false",
        "r": "ar",
    }

    ultimo_error = None
    for intento in range(reintentos):
        try:
            resp = requests.get(BASE, headers=HEADERS, params=params, timeout=40)
            if resp.status_code == 200:
                dias, bandas = _parsear(resp.json(), anio, mes)
                _dormir(pausa)
                return dias, bandas
            ultimo_error = f"HTTP {resp.status_code}"
        except requests.RequestException as e:
            ultimo_error = str(e)
        # backoff antes de reintentar
        time.sleep(3 * (intento + 1))

    raise SmilesError(f"{origen}->{destino} {anio}-{mes:02d}: {ultimo_error}")


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
