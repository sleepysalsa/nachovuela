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
    "florianopolis": {
        "nombre": "Florianópolis", "pais": "Brasil", "region": "sudamerica",
        "emoji": "🏄", "lat": -27.67, "lon": -48.55, "moneda": "USD",
        "aeropuertos": [
            {"code": "FLN", "ciudad": "Florianópolis"},
        ],
    },
    "bariloche": {
        "nombre": "Bariloche", "pais": "Argentina", "region": "cabotaje",
        "emoji": "🏔️", "lat": -41.15, "lon": -71.16, "moneda": "ARS",
        "aeropuertos": [{"code": "BRC", "ciudad": "Bariloche"}],
    },
    "mendoza": {
        "nombre": "Mendoza", "pais": "Argentina", "region": "cabotaje",
        "emoji": "🍷", "lat": -32.89, "lon": -68.85, "moneda": "ARS",
        "aeropuertos": [{"code": "MDZ", "ciudad": "Mendoza"}],
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


# Qué aerolíneas vuelan cada ruta desde Buenos Aires (curado a mano).
# v: "directo" o la conexión típica. Sirve para saber dónde más mirar.
AEROLINEAS = {
    "miami": [
        {"n": "American Airlines", "v": "directo", "url": "https://www.aa.com"},
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "LATAM", "v": "vía Santiago/San Pablo", "url": "https://www.latamairlines.com/ar/es"},
        {"n": "Copa", "v": "vía Panamá", "url": "https://www.copaair.com"},
        {"n": "Avianca", "v": "vía Bogotá", "url": "https://www.avianca.com"},
        {"n": "United", "v": "vía Houston (a Orlando/Miami)", "url": "https://www.united.com"},
    ],
    "nueva_york": [
        {"n": "American Airlines", "v": "directo (JFK)", "url": "https://www.aa.com"},
        {"n": "Aerolíneas Argentinas", "v": "directo (JFK)", "url": "https://www.aerolineas.com.ar"},
        {"n": "United", "v": "directo (EWR)", "url": "https://www.united.com"},
        {"n": "LATAM", "v": "vía Lima/Santiago", "url": "https://www.latamairlines.com/ar/es"},
        {"n": "Copa", "v": "vía Panamá", "url": "https://www.copaair.com"},
    ],
    "los_angeles": [
        {"n": "LATAM", "v": "vía Lima/Santiago", "url": "https://www.latamairlines.com/ar/es"},
        {"n": "American Airlines", "v": "vía Miami/Dallas", "url": "https://www.aa.com"},
        {"n": "Copa", "v": "vía Panamá", "url": "https://www.copaair.com"},
        {"n": "Avianca", "v": "vía Bogotá", "url": "https://www.avianca.com"},
    ],
    "madrid": [
        {"n": "Iberia", "v": "directo", "url": "https://www.iberia.com"},
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "Air Europa", "v": "directo", "url": "https://www.aireuropa.com"},
    ],
    "barcelona": [
        {"n": "Level", "v": "directo (low cost)", "url": "https://www.flylevel.com"},
        {"n": "Iberia", "v": "vía Madrid", "url": "https://www.iberia.com"},
        {"n": "Air Europa", "v": "vía Madrid", "url": "https://www.aireuropa.com"},
    ],
    "roma": [
        {"n": "ITA Airways", "v": "directo", "url": "https://www.ita-airways.com"},
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "Iberia", "v": "vía Madrid", "url": "https://www.iberia.com"},
        {"n": "Lufthansa", "v": "vía Frankfurt", "url": "https://www.lufthansa.com"},
    ],
    "paris": [
        {"n": "Air France", "v": "directo", "url": "https://www.airfrance.com.ar"},
        {"n": "KLM", "v": "vía Ámsterdam", "url": "https://www.klm.com.ar"},
        {"n": "Iberia", "v": "vía Madrid", "url": "https://www.iberia.com"},
    ],
    "lisboa": [
        {"n": "TAP Air Portugal", "v": "directo", "url": "https://www.flytap.com"},
        {"n": "Iberia", "v": "vía Madrid", "url": "https://www.iberia.com"},
    ],
    "rio": [
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "GOL", "v": "directo/vía San Pablo", "url": "https://www.voegol.com.br/es-ar"},
        {"n": "LATAM", "v": "directo/vía San Pablo", "url": "https://www.latamairlines.com/ar/es"},
        {"n": "Flybondi", "v": "directo (low cost)", "url": "https://flybondi.com"},
    ],
    "sao_paulo": [
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "GOL", "v": "directo", "url": "https://www.voegol.com.br/es-ar"},
        {"n": "LATAM", "v": "directo", "url": "https://www.latamairlines.com/ar/es"},
        {"n": "JetSmart", "v": "directo (low cost)", "url": "https://jetsmart.com"},
    ],
    "florianopolis": [
        {"n": "Aerolíneas Argentinas", "v": "directo (temporada)", "url": "https://www.aerolineas.com.ar"},
        {"n": "GOL", "v": "directo/vía San Pablo", "url": "https://www.voegol.com.br/es-ar"},
        {"n": "JetSmart", "v": "directo (low cost)", "url": "https://jetsmart.com"},
        {"n": "Flybondi", "v": "directo (temporada)", "url": "https://flybondi.com"},
    ],
    "bariloche": [
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "Flybondi", "v": "directo (low cost)", "url": "https://flybondi.com"},
        {"n": "JetSmart", "v": "directo (low cost)", "url": "https://jetsmart.com"},
    ],
    "mendoza": [
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "Flybondi", "v": "directo (low cost)", "url": "https://flybondi.com"},
        {"n": "JetSmart", "v": "directo (low cost)", "url": "https://jetsmart.com"},
    ],
    "iguazu": [
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "Flybondi", "v": "directo (low cost)", "url": "https://flybondi.com"},
        {"n": "JetSmart", "v": "directo (low cost)", "url": "https://jetsmart.com"},
    ],
    "ushuaia": [
        {"n": "Aerolíneas Argentinas", "v": "directo", "url": "https://www.aerolineas.com.ar"},
        {"n": "Flybondi", "v": "directo (low cost)", "url": "https://flybondi.com"},
        {"n": "JetSmart", "v": "directo (low cost)", "url": "https://jetsmart.com"},
    ],
}

# Tips de época por destino (mes -> qué se aprovecha). Curado, breve.
TIPS = {
    "mendoza": {
        9: "Empiezan a brotar las viñas, seco y templado, sin multitudes.",
        10: "Fiesta de la Vendimia y montañas con nieve todavía — combo perfecto.",
        11: "Días largos y cálidos para bodegas y alta montaña.",
        12: "Calor seco de precordillera, ideal previo a las fiestas.",
        2: "Vendimia en su punto: cosecha, calor y uvas en la planta.",
        3: "Otoño mendocino: viñedos dorados y clima ideal para recorrer bodegas.",
    },
    "florianopolis": {
        11: "Playas listas y precios pre-temporada.",
        12: "El mar más lindo del sur de Brasil, antes del pico de enero.",
        3: "Mar caliente y multitudes en retirada: la mejor relación.",
        4: "Otoño isleño: templado, verde y barato.",
    },
    "miami": {
        1: "Temporada seca y fresca: parques y playa sin humedad.",
        2: "Seco y templado, ideal Orlando: filas cortas post-vacaciones.",
        4: "Clima perfecto antes del calor; semana de Pascua sube precios.",
        5: "Empieza el calor; buenos precios antes del verano yanqui.",
        9: "Precios bajos (temporada de huracanes: mirá el pronóstico).",
        11: "Seco, 26-28°, parques tranquilos antes de Thanksgiving.",
    },
    "nueva_york": {
        4: "Primavera y Central Park en flor.",
        5: "Días largos y templados, la mejor época.",
        9: "Veranillo y menos turistas.",
        10: "Otoño dorado, la ciudad más linda.",
        12: "Navidad mágica pero carísima y helada.",
    },
    "madrid": {
        4: "Primavera, terrazas y buen clima.",
        5: "Ideal: 20-25° y días larguísimos.",
        9: "Se va el calor fuerte, vuelve la ciudad.",
        10: "Otoño templado, precios más tranquilos.",
    },
    "barcelona": {
        5: "Playa incipiente, ciudad a pleno sin agobio.",
        6: "Días de 15 h de luz, mar templándose.",
        9: "Mar caliente y menos multitud: la mejor.",
        10: "Todavía templado, precios en baja.",
    },
    "roma": {
        4: "Primavera romana, ideal caminar (ojo Semana Santa).",
        5: "La mejor época: 22-25° y todo abierto.",
        9: "Calor amable y ciudad recuperada del agosto.",
        10: "Otoño templado, menos filas en todo.",
    },
    "paris": {
        4: "París en flor.",
        5: "Días largos, 18-22°, la postal perfecta.",
        6: "Fiesta de la música (21/6) y verano suave.",
        9: "Vuelta de vacaciones: ciudad viva y templada.",
    },
    "lisboa": {
        4: "Sol suave y jacarandás.",
        5: "20-24° y precios pre-verano.",
        9: "Mar todavía tibio, multitudes en retirada.",
        10: "Templado y luminoso hasta tarde.",
    },
    "rio": {
        3: "Después de carnaval: calor de playa y precios en baja.",
        4: "Mar caliente, 27-30°, sin picos de temporada.",
        5: "Seco y 26°: playa sin agobio ni lluvia.",
        9: "Primavera carioca, precios bajos.",
        11: "Calor de playa antes de las fiestas.",
    },
    "sao_paulo": {
        4: "Seco y templado, ideal gastronomía y shows.",
        5: "Otoño paulista, el mejor clima del año.",
        9: "Primavera y agenda cultural a pleno.",
    },
    "bariloche": {
        3: "Otoño rojo en los bosques: la postal secreta, sin multitudes.",
        7: "Nieve plena (temporada alta cara).",
        11: "Primavera: lupinos, lagos y precios bajos.",
        12: "Días eternos y cerros verdes antes de las fiestas.",
    },
    "iguazu": {
        4: "Cataratas con caudal alto y calor amable.",
        5: "Templado y verde, sin el calor agobiante.",
        8: "Seco y fresco: pasarelas cómodas.",
        9: "Primavera, selva florecida.",
    },
    "ushuaia": {
        1: "Verano fueguino: trekking con 17 h de luz.",
        2: "Días largos y canal navegable.",
        7: "Nieve y esquí en Cerro Castor.",
        11: "Deshielo, pingüinos recién llegados.",
    },
}
