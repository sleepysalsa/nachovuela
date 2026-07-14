"""
Cotización del dólar (para pasar el precio de la milla de ARS a USD).

Usa dolarapi.com (gratis, sin key). Tomamos el dólar MEP/bolsa (venta): es el
valor real al que un argentino accede a dólares, así la cuenta "cuánto me
cuesta reponer una milla en dólares" es honesta.
"""
import requests

URL = "https://dolarapi.com/v1/dolares/bolsa"


def dolar_mep():
    """Devuelve (venta, fecha_actualizacion) o (None, None) si falla."""
    try:
        r = requests.get(URL, timeout=15)
        if r.status_code == 200:
            d = r.json()
            return float(d.get("venta") or 0) or None, d.get("fechaActualizacion")
    except requests.RequestException:
        pass
    return None, None
