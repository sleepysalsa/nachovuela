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
                    reintentos=3, pausa=(0.5, 1.0)):
    """
    Precio cash más barato para una ruta, en cascada de precisión.

    La Data API devuelve precios que otros usuarios ya buscaron; para meses
    lejanos o rutas de solo-ida a veces no hay datos. Por eso probamos, de más
    a menos preciso, y devolvemos el primero que traiga algo, etiquetando qué
    es (para no confundir al comparar):
      1. solo ida, ese mes            -> tipo "ida", exacto=True
      2. ida y vuelta, ese mes        -> tipo "ida_vuelta", exacto=True
      3. solo ida, cualquier fecha    -> tipo "ida", exacto=False (referencia)
      4. ida y vuelta, cualquier fecha-> tipo "ida_vuelta", exacto=False

    Returns dict o None:
        {
          "precio": 812.0, "moneda": "usd", "fecha": "2026-11-18",
          "aerolinea": "AA", "escalas": 0, "duracion_min": 585,
          "link": "https://www.aviasales.com/search/...",
          "tipo": "ida" | "ida_vuelta",
          "exacto": True | False,   # False = referencia general de la ruta
        }
    """
    intentos = [
        {"one_way": "true",  "mes": True,  "tipo": "ida",        "exacto": True},
        {"one_way": "false", "mes": True,  "tipo": "ida_vuelta", "exacto": True},
        {"one_way": "true",  "mes": False, "tipo": "ida",        "exacto": False},
        {"one_way": "false", "mes": False, "tipo": "ida_vuelta", "exacto": False},
    ]
    ultimo = None
    for cfg in intentos:
        params = {
            "origin": origen, "destination": destino,
            "currency": currency, "unique": "false", "sorting": "price",
            "direct": "false", "limit": 30, "page": 1,
            "one_way": cfg["one_way"], "token": tok,
        }
        if cfg["mes"]:
            params["departure_at"] = f"{anio:04d}-{mes:02d}"
        headers = {"accept": "application/json", "user-agent": UA,
                   "x-access-token": tok}
        try:
            r = requests.get(BASE, params=params, headers=headers, timeout=30)
            if r.status_code in (401, 403):
                raise CashError(f"token rechazado ({r.status_code}) — revisá tu token de Travelpayouts")
            if r.status_code == 200:
                mejor = _mejor((r.json().get("data") or []), currency)
                if mejor:
                    mejor["tipo"] = cfg["tipo"]
                    mejor["exacto"] = cfg["exacto"]
                    return mejor
            else:
                ultimo = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            ultimo = str(e)
        _dormir(pausa)
    if ultimo:
        raise CashError(f"{origen}->{destino} {anio}-{mes:02d}: {ultimo}")
    return None  # sin error, simplemente no hay datos cash para esta ruta


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


def _dormir(pausa):
    import random
    lo, hi = pausa
    time.sleep(random.uniform(lo, hi))


def cash_por_dia(origen, destino, anio, mes, tok, currency="usd"):
    """
    Precio cash MÍNIMO por día para una ruta en un mes (solo ida).
    Una sola llamada trae los vuelos con fecha del mes; nos quedamos con el
    mínimo de cada fecha. Devuelve dict {"YYYY-MM-DD": {"p": 123.0, "e": escalas}}.
    Si no hay datos, dict vacío (no es error).
    """
    params = {
        "origin": origen, "destination": destino,
        "departure_at": f"{anio:04d}-{mes:02d}",
        "currency": currency, "unique": "false", "sorting": "price",
        "direct": "false", "limit": 300, "page": 1,
        "one_way": "true", "token": tok,
    }
    headers = {"accept": "application/json", "user-agent": UA,
               "x-access-token": tok}
    try:
        r = requests.get(BASE, params=params, headers=headers, timeout=30)
        if r.status_code != 200:
            return {}
        filas = r.json().get("data") or []
    except requests.RequestException:
        return {}
    por_dia = {}
    for f in filas:
        precio = f.get("price")
        fecha = (f.get("departure_at") or "")[:10]
        if not precio or not fecha:
            continue
        if fecha not in por_dia or precio < por_dia[fecha]["p"]:
            por_dia[fecha] = {"p": round(float(precio), 2),
                              "e": f.get("transfers")}
    return por_dia
