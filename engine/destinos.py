"""
Catálogo de destinos de NachoVuela.

Cada destino tiene:
- code: código IATA del aeropuerto
- ciudad / pais: para mostrar lindo
- grupo: para agrupar aeropuertos alternativos (ej. Miami = MIA/FLL/PBI)
- lat / lon: para traer el clima de Open-Meteo
- emoji: decoración

Los "grupos" permiten que, si buscás Miami, el motor rastree también
Fort Lauderdale y West Palm Beach automáticamente.
"""

# Orígenes habituales (Argentina)
ORIGENES = {
    "EZE": {"ciudad": "Buenos Aires", "aeropuerto": "Ezeiza", "pais": "Argentina"},
    "AEP": {"ciudad": "Buenos Aires", "aeropuerto": "Aeroparque", "pais": "Argentina"},
    "COR": {"ciudad": "Córdoba", "aeropuerto": "Pajas Blancas", "pais": "Argentina"},
    "ROS": {"ciudad": "Rosario", "aeropuerto": "Fisherton", "pais": "Argentina"},
    "MDZ": {"ciudad": "Mendoza", "aeropuerto": "El Plumerillo", "pais": "Argentina"},
}

# Destinos con sus aeropuertos alternativos agrupados.
# clave = grupo, contiene la lista de aeropuertos y datos de la ciudad "cabecera".
DESTINOS = {
    # ---- Estados Unidos ----
    "miami": {
        "nombre": "Miami y alrededores", "pais": "Estados Unidos", "region": "eeuu",
        "emoji": "🌴", "lat": 25.79, "lon": -80.29, "moneda": "USD",
        "aeropuertos": [
            {"code": "MIA", "ciudad": "Miami"},
            {"code": "FLL", "ciudad": "Fort Lauderdale"},
            {"code": "PBI", "ciudad": "West Palm Beach"},
            {"code": "MCO", "ciudad": "Orlando"},
        ],
    },
    "nueva_york": {
        "nombre": "Nueva York", "pais": "Estados Unidos", "region": "eeuu",
        "emoji": "🗽", "lat": 40.69, "lon": -74.17, "moneda": "USD",
        "aeropuertos": [
            {"code": "JFK", "ciudad": "Nueva York (JFK)"},
            {"code": "EWR", "ciudad": "Newark"},
            {"code": "LGA", "ciudad": "LaGuardia"},
        ],
    },
    "los_angeles": {
        "nombre": "Los Ángeles", "pais": "Estados Unidos", "region": "eeuu",
        "emoji": "🌉", "lat": 33.94, "lon": -118.41, "moneda": "USD",
        "aeropuertos": [
            {"code": "LAX", "ciudad": "Los Ángeles"},
        ],
    },
    # ---- Europa ----
    "madrid": {
        "nombre": "Madrid", "pais": "España", "region": "europa",
        "emoji": "🇪🇸", "lat": 40.47, "lon": -3.56, "moneda": "USD",
        "aeropuertos": [{"code": "MAD", "ciudad": "Madrid"}],
    },
    "barcelona": {
        "nombre": "Barcelona", "pais": "España", "region": "europa",
        "emoji": "🏖️", "lat": 41.30, "lon": 2.08, "moneda": "USD",
        "aeropuertos": [{"code": "BCN", "ciudad": "Barcelona"}],
    },
    "roma": {
        "nombre": "Roma", "pais": "Italia", "region": "europa",
        "emoji": "🏛️", "lat": 41.80, "lon": 12.24, "moneda": "USD",
        "aeropuertos": [
            {"code": "FCO", "ciudad": "Roma Fiumicino"},
        ],
    },
    "paris": {
        "nombre": "París", "pais": "Francia", "region": "europa",
        "emoji": "🗼", "lat": 49.01, "lon": 2.55, "moneda": "USD",
        "aeropuertos": [
            {"code": "CDG", "ciudad": "París Charles de Gaulle"},
            {"code": "ORY", "ciudad": "París Orly"},
        ],
    },
    "lisboa": {
        "nombre": "Lisboa", "pais": "Portugal", "region": "europa",
        "emoji": "🇵🇹", "lat": 38.77, "lon": -9.13, "moneda": "USD",
        "aeropuertos": [{"code": "LIS", "ciudad": "Lisboa"}],
    },
    # ---- Sudamérica / cabotaje e internacionales cercanos ----
    "rio": {
        "nombre": "Río de Janeiro", "pais": "Brasil", "region": "sudamerica",
        "emoji": "🏝️", "lat": -22.81, "lon": -43.25, "moneda": "USD",
        "aeropuertos": [
            {"code": "GIG", "ciudad": "Río (Galeão)"},
            {"code": "SDU", "ciudad": "Río (Santos Dumont)"},
        ],
    },
    "sao_paulo": {
        "nombre": "San Pablo", "pais": "Brasil", "region": "sudamerica",
        "emoji": "🇧🇷", "lat": -23.43, "lon": -46.47, "moneda": "USD",
        "aeropuertos": [
            {"code": "GRU", "ciudad": "San Pablo (Guarulhos)"},
        ],
    },
    "bariloche": {
        "nombre": "Bariloche", "pais": "Argentina", "region": "cabotaje",
        "emoji": "🏔️", "lat": -41.15, "lon": -71.16, "moneda": "ARS",
        "aeropuertos": [{"code": "BRC", "ciudad": "Bariloche"}],
    },
    "iguazu": {
        "nombre": "Puerto Iguazú", "pais": "Argentina", "region": "cabotaje",
        "emoji": "💦", "lat": -25.74, "lon": -54.47, "moneda": "ARS",
        "aeropuertos": [{"code": "IGR", "ciudad": "Iguazú"}],
    },
    "ushuaia": {
        "nombre": "Ushuaia", "pais": "Argentina", "region": "cabotaje",
        "emoji": "🐧", "lat": -54.84, "lon": -68.30, "moneda": "ARS",
        "aeropuertos": [{"code": "USH", "ciudad": "Ushuaia"}],
    },
}


def destino_por_codigo(code):
    """Devuelve (clave_grupo, dict_destino, dict_aeropuerto) para un IATA dado."""
    for clave, d in DESTINOS.items():
        for a in d["aeropuertos"]:
            if a["code"] == code:
                return clave, d, a
    return None, None, None


def todos_los_aeropuertos_destino():
    """Lista plana de todos los códigos de destino conocidos."""
    codigos = []
    for d in DESTINOS.values():
        for a in d["aeropuertos"]:
            codigos.append(a["code"])
    return codigos
