"""
Radar de la comunidad: últimas alertas de los blogs cazadores de ofertas
que Nacho ya sigue a mano (InfoViajera, Ratamundo, Promociones Aéreas).

Leemos sus RSS (público y estable, sin scraping frágil) y guardamos los
últimos posts para mostrarlos en la app. Así, además del rastrillaje propio
de Smiles, la app avisa cuando la comunidad detecta una oportunidad.
"""
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

FUENTES = [
    {"clave": "infoviajera", "nombre": "InfoViajera", "feed": "https://www.infoviajera.com/feed/"},
    {"clave": "ratamundo", "nombre": "Ratamundo", "feed": "https://ratamundo.com/feed/"},
    {"clave": "promaereas", "nombre": "Promociones Aéreas", "feed": "https://www.promocionesaereas.com.ar/feed/"},
]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _texto(el, tag):
    x = el.find(tag)
    return (x.text or "").strip() if x is not None and x.text else ""


def traer_ofertas(dias=21, max_por_fuente=10, log=print):
    """Devuelve lista de posts recientes: {fuente, titulo, link, fecha}."""
    limite = datetime.now(timezone.utc) - timedelta(days=dias)
    out = []
    for f in FUENTES:
        try:
            r = requests.get(f["feed"], headers={"user-agent": UA}, timeout=20)
            if r.status_code != 200:
                log(f"  {f['nombre']}: HTTP {r.status_code}")
                continue
            root = ET.fromstring(r.content)
            items = root.findall(".//item")[:max_por_fuente * 2]
            n = 0
            for it in items:
                titulo = _texto(it, "title")
                link = _texto(it, "link")
                fecha_raw = _texto(it, "pubDate")
                if not titulo or not link:
                    continue
                try:
                    fecha = parsedate_to_datetime(fecha_raw)
                except Exception:
                    fecha = None
                if fecha and fecha < limite:
                    continue
                out.append({
                    "fuente": f["nombre"],
                    "titulo": titulo,
                    "link": link,
                    "fecha": fecha.isoformat() if fecha else None,
                })
                n += 1
                if n >= max_por_fuente:
                    break
            log(f"  {f['nombre']}: {n} alertas")
        except Exception as e:
            log(f"  {f['nombre']}: error {e}")
    out.sort(key=lambda x: x["fecha"] or "", reverse=True)
    return out
