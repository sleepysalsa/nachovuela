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
    "api-air-calendar-green.smiles.com.br",
    "api-air-calendar-blue.smiles.com.br",
    "api.travelpayouts.com",
    "archive-api.open-meteo.com",
])

# Smiles despliega su API en varios entornos y de tanto en tanto MUEVE el
# tráfico de uno a otro (2-ago-2026: pasó de "blue" a "green" y el viejo quedó
# devolviendo calendarios vacíos, sin error — parecía que nos habían bloqueado).
# Por eso ya no fijamos un servidor: probamos los conocidos y nos quedamos con
# el que realmente devuelve precios. Ver base_activa().
_HOSTS = ["green", "blue", "prd"]
_PATH = ".smiles.com.br/v1/airlines/calendar/month"
BASES = [f"https://api-air-calendar-{h}{_PATH}" for h in _HOSTS]

import os as _os
_BASE_FILE = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".base_smiles")

BASE = BASES[0]  # se ajusta en base_activa()

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


def _sondear(base, timeout=25):
    """Cuántos días con millas devuelve `base` en una consulta de prueba.

    Usamos una ruta muy transitada a ~2 meses vista: si el servidor está vivo
    y sirviendo datos, ahí seguro hay premios. -1 = no respondió.
    """
    import datetime
    obj = datetime.date.today() + datetime.timedelta(days=70)
    y, m = obj.year, obj.month
    params = {
        "adults": 1, "children": 0, "infants": 0, "cabinType": "all", "tripType": 2,
        "currencyCode": "USD", "departureDate": f"{y}-{m:02d}-15",
        "originAirportCode": "EZE", "originAirportIsAny": "false",
        "destinationAirportCode": "MIA", "destinAirportIsAny": "false",
        "startDate": f"{y}-{m:02d}-01", "endDate": f"{y}-{m:02d}-28",
        "searchType": "g3", "segments": 1, "isFlexibleDateChecked": "false",
        "forceCongener": "true", "checkCalendar": "false", "r": "ar",
    }
    try:
        r = requests.get(base, headers=HEADERS, params=params, timeout=timeout)
        if r.status_code != 200:
            return -1
        segs = r.json().get("calendarSegmentList") or []
        dias = segs[0].get("calendarDayList", []) if segs else []
        return sum(1 for d in dias if d.get("miles"))
    except requests.RequestException:
        return -1


def base_activa(forzar=False, log=print):
    """Elige el servidor de Smiles que realmente está sirviendo precios.

    Recuerda el elegido en engine/.base_smiles para no sondear cada vez. Si el
    recordado deja de traer datos (o `forzar`), vuelve a probar todos. Así, la
    próxima vez que Smiles mude de entorno, el radar se reacomoda solo en vez
    de quedar devolviendo cero (lo que pasó del 21-jul al 2-ago-2026).

    Devuelve None si NINGÚN servidor respondió. Antes en ese caso caía a
    BASES[0] (green), que es justamente el que devuelve calendarios vacíos sin
    error: el motor rastrillaba 58 rutas para nada y publicaba un latest.json
    con 0 resultados (pasó el 5-sep-2026 y quedó 3 h 21 min así). Ahora avisa y
    el que llama decide — rastrillar.py aborta sin pisar los datos buenos.

    OJO con el matiz: "no respondió nadie" (red caída, Smiles caído) NO es lo
    mismo que "respondieron pero la ruta sonda no tenía premios en ese rato".
    La sonda es UNA sola ruta (EZE→MIA a 70 días) y apagar el motor entero por
    ella dejaría a la app diciendo "el barrido falló" con Smiles perfecto. Si
    hubo respuesta seguimos igual, y la decisión de publicar o no la toma
    rastrillar.py con las 58 rutas de verdad (_hay_que_abortar), que es la
    compuerta que realmente evita la pantalla en blanco.
    """
    global BASE
    guardada = None
    if not forzar:
        try:
            with open(_BASE_FILE, encoding="utf-8") as f:
                guardada = f.read().strip()
            if guardada:
                n = _sondear(guardada)
                if n > 0:
                    BASE = guardada
                    return BASE
                log(f"  El servidor guardado no trae datos ({n}), buscando otro...")
        except OSError:
            pass

    mejor, mejor_n = None, 0
    respondieron = []
    for b in BASES:
        n = _sondear(b)
        etiqueta = b.split("//")[1].split(".")[0]
        log(f"  sondeo {etiqueta}: {n if n >= 0 else 'sin respuesta'}")
        if n >= 0:
            respondieron.append(b)
        if n > mejor_n:
            mejor, mejor_n = b, n
        time.sleep(1.5)

    if mejor:
        BASE = mejor
        try:
            with open(_BASE_FILE, "w", encoding="utf-8") as f:
                f.write(mejor)
        except OSError:
            pass
        log(f"  → usando {mejor.split('//')[1].split('.')[0]} ({mejor_n} días de prueba)")
        return BASE

    if respondieron:
        # Contestaron bien pero ninguno tenía premios en la ruta sonda. Puede
        # ser Smiles a medio andar o puede ser que EZE→MIA se haya quedado sin
        # premios ese mes: no es motivo suficiente para no salir a mirar.
        BASE = guardada if guardada in respondieron else respondieron[0]
        log(f"  ⚠ Los servidores responden pero la ruta de prueba no tiene "
            f"premios ahora. Sigo con {BASE.split('//')[1].split('.')[0]} y que "
            f"decidan las rutas de verdad.")
        return BASE

    log("  ⚠ Ningún servidor de Smiles respondió: no hay con qué rastrillar.")
    return None


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
        (dias, quartil_bands, declarado)
        dias: lista de dicts {date, miles, price_range, is_lowest, fare_type,
              fuente ("gol"|"socias"|"ambas"), gol_alt (millas GOL si además
              existe opción GOL más barata que la elegida)}.
        declarado: {"parcial": bool, "dias_esperados": int|None,
                    "min_declarado": int|None, "dias_obtenidos": int,
                    "dias_mes": int} — ver _declaracion() y UMBRAL_PARCIAL.
    """
    # Para EEUU/Europa GOL no tiene vuelos propios: la consulta normal es
    # redundante (verificado: EZE-MIA idéntico con y sin forceCongener).
    # solo_socias=True la saltea y el rastrillaje tarda la mitad.
    if solo_socias:
        dias_a, bandas_a, decl_a = [], None, None
    else:
        dias_a, bandas_a, decl_a = _consulta(origen, destino, anio, mes, currency,
                                             force_congener="false", reintentos=reintentos)
        _dormir(pausa)
    dias_b, bandas_b, decl_b = _consulta(origen, destino, anio, mes, currency,
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
    return dias, (bandas_b or bandas_a), _fusionar(decl_a, decl_b, len(dias),
                                                   _dias_del_mes(anio, mes))


# Cuánto del mes declarado nos tiene que dar Smiles para que lo demos por
# completo. Con 0.8 sobre los casos medidos el 8-sep-2026:
#   AEP-GIG 2026-12 a las 04:35 → 2 días de 31 declarados: 2 < 24,8 → PARCIAL
#   AEP-GIG 2026-12 a las 07:39 → 31 días de 31 (la de socias vino entera,
#                                 la de GOL recortada): 31 < 24,8 es falso →
#                                 completo, que es lo correcto: tenemos el mes.
#   AEP-GRU 2026-12 a las 04:35 → 1 día de 22 declarados: PARCIAL
#   EZE-FLN 2026-12 a las 04:35 → 1 día de 22 declarados: PARCIAL
# Queda margen para el mes que legítimamente tiene un par de días sin premio
# (un feriado sin asientos no vuelve parcial a un calendario entero).
UMBRAL_PARCIAL = 0.8


def _fusionar(decl_a, decl_b, dias_obtenidos, dias_mes):
    """Junta lo que declaró cada consulta y decide si el calendario vino corto.

    Nos quedamos con la declaración MÁS GRANDE de las dos (si la de GOL dice
    que hay 31 días con precio y la de socias no dice nada, hay 31) y con el
    piso de precio MÁS BAJO. Que la respuesta de socias venga completa no tapa
    que la de GOL vino recortada, y al revés tampoco: el 8-sep a las 04:35 la
    de AEP-MDZ que trajo 3 días guardaba el aviso solo en la consulta de GOL,
    y el motor se quedaba con el Quartil de socias, que no decía nada.
    """
    decls = [d for d in (decl_a, decl_b) if d]
    esperados = [d["declarados"] for d in decls if d.get("declarados")]
    minimos = [d["min_declarado"] for d in decls if d.get("min_declarado")]
    dias_esperados = max(esperados) if esperados else None
    parcial = bool(dias_esperados
                   and dias_obtenidos < dias_esperados * UMBRAL_PARCIAL)
    return {
        "parcial": parcial,
        "dias_esperados": dias_esperados,
        "min_declarado": min(minimos) if minimos else None,
        "dias_obtenidos": dias_obtenidos,
        "dias_mes": dias_mes,
    }


def _consulta(origen, destino, anio, mes, currency, force_congener, reintentos=4):
    """Una llamada al calendario. Devuelve (dias, bandas, declarado)."""
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


def _declaracion(day_list, anio, mes):
    """Lo que Smiles DECLARA del mes, más allá de los días que efectivamente dio.

    Cada día con precio viene con un bloque "Quartil": cuatro bandas de precio
    con minPrice/maxPrice y, a veces, un "count" por banda. Ese bloque es
    idéntico en todos los días de la respuesta (verificado) y describe una
    población MÁS GRANDE que la ventana consultada.

    El hallazgo (medido el 8-sep-2026 entre las 07:39 y las 07:46, servidor
    blue, ventana de 36 días 1-dic a 5-ene):

      consulta                          días con millas   Quartil
      AEP→GIG 2026-12 forceCongener     36 de 36          SIN count
      AEP→GIG 2026-12 normal (GOL)       8 de 36          count 41+29+6+1 = 77
      AEP→GRU 2026-12 normal (GOL)       9 de 36          count 56+7+2+5 = 70
      AEP→MDZ 2026-11 normal (GOL)      35 de 35          SIN count
      AEP→MDZ 2026-10 normal (GOL)      36 de 36          SIN count
      AEP→GIG 2027-10 normal (sin venta) 0 de 36          SIN Quartil

    Y en el data/latest.json de las 04:35 de ese mismo día: las ÚNICAS 3
    ruta-mes con "count" fueron las 3 que trajeron 1 o 2 días (AEP-GIG,
    AEP-GRU, EZE-FLN de diciembre); las otras 30, con 23 a 31 días, ninguna.

    O sea: cuando Smiles se guarda días, manda el histograma de todo lo que
    tiene. Cuando manda el mes completo, no hace falta y no lo manda.

    Ojo con los números: esos "count" NO son días (77 en una ventana de 36),
    son opciones/vuelos de una búsqueda más amplia que la ventana. Por eso el
    total se topea a los días que tiene el mes. Lo que publicamos en
    dias_esperados es entonces un TECHO —"el resumen de precios da para tantos
    días"—, no una cita de Smiles: sirve para decidir que el calendario vino
    recortado y para escribir "nos mostró 1 día y hay bastante más", pero no
    para prometerle a Nacho "Smiles dice que hay exactamente 31 días".

    Un mes que directamente no salió a la venta no trae Quartil en ningún día,
    así que declarados queda en None y eso sigue siendo "sin disponibilidad"
    de verdad (no lo confundimos con un calendario recortado).

    Devuelve {"declarados": int|None, "min_declarado": int|None,
              "obtenidos": int}  (obtenidos = días del mes con precio).
    """
    prefijo = f"{anio:04d}-{mes:02d}-"
    dias_mes = _dias_del_mes(anio, mes)
    quartil = None
    obtenidos = 0
    for d in day_list:
        if not d.get("miles"):
            continue
        if d.get("date", "").startswith(prefijo):
            obtenidos += 1
        # El Quartil vive solo en los días con precio; da igual de cuál lo
        # saquemos (es el mismo en toda la respuesta), incluso si el único día
        # con precio cayó fuera del mes objetivo.
        if quartil is None and d.get("Quartil"):
            quartil = d["Quartil"]

    if not quartil:
        return {"declarados": None, "min_declarado": None, "obtenidos": obtenidos}

    counts = [b.get("count") for b in quartil if isinstance(b, dict)]
    declarados = None
    if any(c for c in counts):
        declarados = min(sum(c for c in counts if c), dias_mes)
    minimos = [b.get("minPrice") for b in quartil
               if isinstance(b, dict) and b.get("minPrice")]
    return {
        "declarados": declarados,
        "min_declarado": min(minimos) if minimos else None,
        "obtenidos": obtenidos,
    }


def _dias_del_mes(anio, mes):
    import calendar
    return calendar.monthrange(anio, mes)[1]


def _parsear(data, anio, mes):
    """Devuelve (dias, bandas, declarado). Ver _declaracion() por el tercero."""
    segs = data.get("calendarSegmentList") or []
    if not segs:
        return [], None, {"declarados": None, "min_declarado": None, "obtenidos": 0}
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
    return dias, bandas, _declaracion(day_list, anio, mes)


def _dormir(pausa):
    lo, hi = pausa
    time.sleep(random.uniform(lo, hi))
