"""
Precios en efectivo (cash) de vuelos — vía la Data API de Travelpayouts/Aviasales.

¿Por qué esta API y no Despegar directo? Despegar (y Smiles) bloquean los
accesos automáticos con un escudo anti-robot. Esta API, en cambio, es un
servicio oficial y gratuito para desarrolladores: no tiene ese bloqueo y
funciona headless en el cron. Devuelve el precio cash más barato encontrado
para una ruta y mes, en la moneda que pidas (usamos USD para comparar contra
las millas). Sus precios salen del mismo pool que usan muchas agencias
argentinas (Despegar incluido), así que son una referencia realista de
"cuánto saldría en plata".

Necesita un token gratuito (se obtiene registrándose en travelpayouts.com).
El token se lee de:
  - engine/.travelpayouts_token   (archivo, gitignoreado), o
  - la variable de entorno TRAVELPAYOUTS_TOKEN, o
  - config.json -> cash.token

Si no hay token, el motor sigue sin precios cash (la app muestra solo millas).
"""
import os
import time
from pathlib import Path

import requests

ENGINE = Path(__file__).resolve().parent
TOKEN_FILE = ENGINE / ".travelpayouts_token"

BASE = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


class CashError(Exception):
    pass


def token(config=None):
    """Devuelve el token de Travelpayouts, o None si no está configurado."""
    if TOKEN_FILE.exists():
        t = TOKEN_FILE.read_text().strip()
        if t:
            return t
    env = os.environ.get("TRAVELPAYOUTS_TOKEN", "").strip()
    if env:
        return env
    if config:
        t = (config.get("cash") or {}).get("token", "").strip()
        if t:
            return t
    return None


def hay_token(config=None):
    return token(config) is not None


def precio_cash_mes(origen, destino, anio, mes, tok, currency="usd",
                    directos_solo=False, reintentos=3, pausa=(0.5, 1.0)):
    """
    Precio cash más barato para una ruta en un mes dado.

    Returns dict o None:
        {
          "precio": 812.0,            # en `currency`
          "moneda": "usd",
          "fecha": "2026-11-18",      # día del vuelo más barato hallado
          "aerolinea": "AA",          # código IATA de la aerolínea
          "escalas": 0,               # cantidad de escalas del tramo de ida
          "duracion_min": 585,        # duración total en minutos (si viene)
          "link": "https://www.aviasales.com/search/..."  # link para reservar
        }
    """
    params = {
        "origin": origen,
        "destination": destino,
        "departure_at": f"{anio:04d}-{mes:02d}",
        "currency": currency,
        "unique": "false",
        "sorting": "price",
        "direct": "true" if directos_solo else "false",
        "limit": 30,
        "page": 1,
        "one_way": "true",
        "token": tok,
    }
    headers = {"accept": "application/json", "user-agent": UA,
               "x-access-token": tok}

    ultimo = None
    for intento in range(reintentos):
        try:
            r = requests.get(BASE, params=params, headers=headers, timeout=30)
            if r.status_code == 200:
                data = r.json()
                return _mejor(data.get("data") or [], currency)
            if r.status_code in (401, 403):
                raise CashError(f"token rechazado ({r.status_code}) — revisá tu token de Travelpayouts")
            ultimo = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            ultimo = str(e)
        time.sleep(2 * (intento + 1))
    raise CashError(f"{origen}->{destino} {anio}-{mes:02d}: {ultimo}")


def _mejor(filas, currency):
    """Elige la fila más barata y la normaliza."""
    candidatas = [f for f in filas if f.get("price")]
    if not candidatas:
        return None
    f = min(candidatas, key=lambda x: x["price"])
    dur = f.get("duration_to") or f.get("duration")
    salida = f.get("departure_at", "")
    return {
        "precio": round(float(f["price"]), 2),
        "moneda": currency,
        "fecha": salida[:10] if salida else None,
        "aerolinea": f.get("airline"),
        "escalas": f.get("transfers"),
        "duracion_min": int(dur) if isinstance(dur, (int, float)) else None,
        "link": ("https://www.aviasales.com" + f["link"]) if f.get("link") else None,
    }
