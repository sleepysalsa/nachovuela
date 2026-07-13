"""
Cliente de clima usando Open-Meteo (gratis, sin API key).

Trae el promedio histórico de temperaturas (máx y mín) mes a mes para un
destino, para ayudar a decidir si conviene adelantar o atrasar el viaje.

Usa la API de archivo climático con los últimos años completos y promedia
por mes calendario.
"""

import requests
from datetime import date

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"


def promedios_mensuales(lat, lon, anios=5):
    """
    Devuelve una lista de 12 dicts (uno por mes) con:
    {mes (1-12), t_max, t_min, t_media}  en °C, promediados sobre 'anios' años.

    Si falla, devuelve None (el clima es un extra, no debe romper el rastrillaje).
    """
    hoy = date.today()
    fin = date(hoy.year - 1, 12, 31)
    inicio = date(hoy.year - anios, 1, 1)

    params = {
        "latitude": lat, "longitude": lon,
        "start_date": inicio.isoformat(), "end_date": fin.isoformat(),
        "daily": "temperature_2m_max,temperature_2m_min",
        "timezone": "auto",
    }
    try:
        resp = requests.get(ARCHIVE, params=params, timeout=40)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException:
        return None

    daily = data.get("daily", {})
    fechas = daily.get("time", [])
    tmax = daily.get("temperature_2m_max", [])
    tmin = daily.get("temperature_2m_min", [])
    if not fechas:
        return None

    # Acumular por mes
    acc = {m: {"max": [], "min": []} for m in range(1, 13)}
    for f, mx, mn in zip(fechas, tmax, tmin):
        if mx is None or mn is None:
            continue
        mes = int(f[5:7])
        acc[mes]["max"].append(mx)
        acc[mes]["min"].append(mn)

    salida = []
    for m in range(1, 13):
        mxs, mns = acc[m]["max"], acc[m]["min"]
        if not mxs:
            salida.append({"mes": m, "t_max": None, "t_min": None, "t_media": None})
            continue
        t_max = round(sum(mxs) / len(mxs), 1)
        t_min = round(sum(mns) / len(mns), 1)
        salida.append({
            "mes": m,
            "t_max": t_max,
            "t_min": t_min,
            "t_media": round((t_max + t_min) / 2, 1),
        })
    return salida
