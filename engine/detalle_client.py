"""
Detalle de vuelos de un día puntual: aerolínea, horarios, duración y escalas.

Smiles solo muestra esta información a usuarios logueados, así que este módulo
usa la sesión guardada por login_smiles.py (engine/.perfil_smiles/). Abre la
página de resultados con un navegador invisible y captura la respuesta interna
que la propia web recibe.

Si no hay sesión iniciada, el motor simplemente sigue sin detalle (la app
muestra precios igual, pero sin aerolínea/duración).
"""
import datetime
import json
import os
import time
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
PERFIL = ENGINE / ".perfil_smiles"
DEBUG_DIR = ENGINE / ".debug"


def hay_sesion():
    return (PERFIL / "Default").exists() or (PERFIL / "Cookies").exists()


class DetalleBrowser:
    """Un navegador persistente reutilizado para varias consultas de detalle."""

    def __init__(self):
        self._pw = None
        self._ctx = None
        self._page = None

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._ctx = self._pw.chromium.launch_persistent_context(
            str(PERFIL), headless=True,
            viewport={"width": 1440, "height": 900},
            locale="es-AR", timezone_id="America/Argentina/Buenos_Aires",
        )
        self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self

    def __exit__(self, *exc):
        try:
            if self._ctx:
                self._ctx.close()
        finally:
            if self._pw:
                self._pw.stop()

    def detalle_dia(self, origen, destino, fecha, currency="USD", timeout_s=50):
        """
        Trae los vuelos de un día. `fecha` es "YYYY-MM-DD".
        Devuelve dict {"vuelos": [...], "directos": n} o None si no se pudo.
        """
        dt = datetime.datetime.strptime(fecha, "%Y-%m-%d").replace(hour=12)
        ms = int(dt.timestamp() * 1000)
        url = (
            f"https://www.smiles.com.ar/emission?adults=1&cabinType=all&children=0"
            f"&currencyCode={currency}&departureDate={ms}"
            f"&destinationAirportCode={destino}&infants=0&isFlexibleDateChecked=false"
            f"&originAirportCode={origen}&searchType=g3&segments=1&tripType=2"
            f"&originAirportIsAny=false&destinAirportIsAny=false"
        )

        capturas = []

        def on_response(resp):
            if "airlines/search" in resp.url and "calendar" not in resp.url:
                try:
                    capturas.append(resp.json())
                except Exception:
                    pass

        page = self._page
        page.on("response", on_response)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            limite = time.time() + timeout_s
            while time.time() < limite and not capturas:
                page.wait_for_timeout(1000)
            page.wait_for_timeout(2500)  # dejar llegar respuestas tardías
        finally:
            page.remove_listener("response", on_response)

        for body in capturas:
            vuelos = _parsear_vuelos(body)
            if vuelos:
                if os.environ.get("NACHOVUELA_DEBUG"):
                    DEBUG_DIR.mkdir(exist_ok=True)
                    (DEBUG_DIR / f"detalle_{origen}_{destino}_{fecha}.json").write_text(
                        json.dumps(body, ensure_ascii=False)[:800000])
                return {
                    "fecha": fecha,
                    "vuelos": vuelos,
                    "directos": sum(1 for v in vuelos if v["escalas"] == 0),
                }
        if capturas and os.environ.get("NACHOVUELA_DEBUG"):
            DEBUG_DIR.mkdir(exist_ok=True)
            (DEBUG_DIR / f"detalle_raw_{origen}_{destino}_{fecha}.json").write_text(
                json.dumps(capturas, ensure_ascii=False)[:800000])
        return None


def _minutos_duracion(f):
    """Duración total en minutos, tolerante a los formatos que usa Smiles."""
    dur = f.get("duration")
    if isinstance(dur, dict):
        h = dur.get("hours", 0) or 0
        m = dur.get("minutes", 0) or 0
        if h or m:
            return int(h) * 60 + int(m)
    if isinstance(dur, (int, float)) and dur > 0:
        # a veces viene en minutos directo
        return int(dur)
    # último recurso: restar horarios (aprox., ignora zonas horarias)
    try:
        d1 = _fecha_iso(f["departure"]["date"])
        d2 = _fecha_iso(f["arrival"]["date"])
        m = int((d2 - d1).total_seconds() // 60)
        return m if m > 0 else None
    except Exception:
        return None


def _fecha_iso(s):
    return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def _hora(s):
    try:
        return _fecha_iso(s).strftime("%H:%M")
    except Exception:
        return None


def _millas_vuelo(f):
    """Millas mínimas del vuelo entre sus tarifas (SMILES / SMILES_CLUB)."""
    tarifas = f.get("fareList") or []
    mejores = []
    for t in tarifas:
        miles = t.get("miles")
        if isinstance(miles, (int, float)) and miles > 0:
            mejores.append((int(miles), t.get("type") or ""))
    if not mejores:
        return None, None
    mejores.sort()
    return mejores[0]


def _parsear_vuelos(body):
    segs = body.get("requestedFlightSegmentList") or []
    if not segs:
        return []
    vuelos = []
    for f in segs[0].get("flightList") or []:
        millas, tarifa = _millas_vuelo(f)
        if not millas:
            continue
        aerolinea = (f.get("airline") or {}).get("name") or ""
        codigo = (f.get("airline") or {}).get("code") or ""
        escalas = f.get("stops")
        if escalas is None:
            legs = f.get("legList") or []
            escalas = max(len(legs) - 1, 0)
        vuelos.append({
            "aerolinea": aerolinea.title() if aerolinea.isupper() else aerolinea,
            "codigo": codigo,
            "salida": _hora((f.get("departure") or {}).get("date")),
            "llegada": _hora((f.get("arrival") or {}).get("date")),
            "duracion_min": _minutos_duracion(f),
            "escalas": int(escalas),
            "millas": millas,
            "tarifa": tarifa,
        })
    vuelos.sort(key=lambda v: v["millas"])
    return vuelos[:8]
