"""
Detalle de vuelos de un día puntual: aerolínea, horarios, duración y escalas.

Smiles solo muestra esto a usuarios logueados. login_smiles.py guarda la
sesión (cookies + almacenamiento + token) en archivos locales ignorados por
git, y acá la reutilizamos con dos vías:

  Vía 1: abrir la página de resultados con la sesión inyectada y capturar la
         respuesta interna de la web.
  Vía 2: llamar a la API de búsqueda desde adentro de la página con el token
         de usuario capturado.

Si ninguna funciona (token vencido), el motor sigue sin detalle y la app
avisa que conviene correr login_smiles.py de nuevo.
"""
import datetime
import json
import os
import time
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
PERFIL = ENGINE / ".perfil_smiles"
STORAGE = ENGINE / ".storage_smiles.json"
TOKEN = ENGINE / ".token_smiles"
DEBUG_DIR = ENGINE / ".debug"

API_KEY = "aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw"


def hay_sesion():
    return STORAGE.exists()


def _token_usuario():
    if TOKEN.exists():
        t = TOKEN.read_text().strip()
        if t.lower().startswith("bearer"):
            return t
    return None


class DetalleBrowser:
    """Un navegador reutilizado para varias consultas de detalle."""

    def __init__(self):
        self._pw = None
        self._browser = None
        self._ctx = None
        self._page = None

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        kwargs = {
            "viewport": {"width": 1440, "height": 900},
            "locale": "es-AR",
            "timezone_id": "America/Argentina/Buenos_Aires",
        }
        if STORAGE.exists():
            kwargs["storage_state"] = str(STORAGE)
        self._ctx = self._browser.new_context(**kwargs)

        # sessionStorage no viaja en storage_state: inyectarlo antes de cargar
        try:
            extra = json.loads(STORAGE.read_text()).get("nachovuela_extra", {})
            ss = extra.get("sessionStorage") or {}
            if ss:
                script = "".join(
                    f"try{{sessionStorage.setItem({json.dumps(k)},{json.dumps(v)})}}catch(e){{}};"
                    for k, v in ss.items()
                )
                self._ctx.add_init_script(script)
        except Exception:
            pass

        self._page = self._ctx.new_page()
        return self

    def __exit__(self, *exc):
        try:
            if self._ctx:
                self._ctx.close()
            if self._browser:
                self._browser.close()
        finally:
            if self._pw:
                self._pw.stop()

    def detalle_dia(self, origen, destino, fecha, currency="USD", timeout_s=45):
        """Vuelos de un día ("YYYY-MM-DD"). Dict {vuelos, directos} o None."""
        res = self._via_pagina(origen, destino, fecha, currency, timeout_s)
        if res:
            return res
        return self._via_fetch(origen, destino, fecha, currency)

    # ---- Vía 1: la página busca sola y capturamos su respuesta ----
    def _via_pagina(self, origen, destino, fecha, currency, timeout_s):
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
            page.wait_for_timeout(2000)
        except Exception:
            pass
        finally:
            page.remove_listener("response", on_response)

        for body in capturas:
            vuelos = _parsear_vuelos(body)
            if vuelos:
                self._debug(body, origen, destino, fecha, "pagina")
                return _armar(fecha, vuelos)
        return None

    # ---- Vía 2: fetch desde adentro de la página con el token de usuario ----
    def _via_fetch(self, origen, destino, fecha, currency):
        token = _token_usuario()
        if not token:
            return None
        page = self._page
        try:
            if "smiles.com.ar" not in page.url:
                page.goto("https://www.smiles.com.ar/home",
                          wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(1500)
        except Exception:
            return None

        api = (
            "https://api-air-flightsearch-prd.smiles.com.br/v1/airlines/search"
            f"?adults=1&cabinType=all&children=0&currencyCode={currency}"
            f"&departureDate={fecha}&destinationAirportCode={destino}"
            f"&forceCongener=false&infants=0&isFlexibleDateChecked=false"
            f"&originAirportCode={origen}&r=ar&region=ARGENTINA&tripType=2"
        )
        headers = {
            "x-api-key": API_KEY,
            "authorization": token,
            "region": "ARGENTINA",
            "channel": "Web",
            "language": "es-ES",
        }
        try:
            res = page.evaluate(
                """async ([url, headers]) => {
                    try {
                        const r = await fetch(url, {headers});
                        return {status: r.status, body: await r.text()};
                    } catch (e) { return {status: -1, body: String(e)}; }
                }""",
                [api, headers],
            )
        except Exception:
            return None
        if res.get("status") != 200:
            return None
        try:
            body = json.loads(res["body"])
        except Exception:
            return None
        vuelos = _parsear_vuelos(body)
        if vuelos:
            self._debug(body, origen, destino, fecha, "fetch")
            return _armar(fecha, vuelos)
        return None

    @staticmethod
    def _debug(body, origen, destino, fecha, via):
        if os.environ.get("NACHOVUELA_DEBUG"):
            DEBUG_DIR.mkdir(exist_ok=True)
            (DEBUG_DIR / f"detalle_{via}_{origen}_{destino}_{fecha}.json").write_text(
                json.dumps(body, ensure_ascii=False)[:800000])


def _armar(fecha, vuelos):
    return {
        "fecha": fecha,
        "vuelos": vuelos,
        "directos": sum(1 for v in vuelos if v["escalas"] == 0),
    }


def _minutos_duracion(f):
    """Duración total en minutos, tolerante a los formatos que usa Smiles."""
    dur = f.get("duration")
    if isinstance(dur, dict):
        h = dur.get("hours", 0) or 0
        m = dur.get("minutes", 0) or 0
        if h or m:
            return int(h) * 60 + int(m)
    if isinstance(dur, (int, float)) and dur > 0:
        return int(dur)
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
