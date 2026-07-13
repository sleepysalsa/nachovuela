#!/usr/bin/env python3
"""
Login de Smiles para NachoVuela — se corre cuando expira la sesión.

Abre una ventana de Chrome real donde vos iniciás sesión con tu cuenta de
Smiles. Tu clave la tipeás VOS — este programa no la ve ni la guarda.

Al detectar el login, captura automáticamente lo que el radar necesita para
pedir el detalle de vuelos (aerolínea, horarios, duración, escalas):
  - engine/.storage_smiles.json : cookies + almacenamiento del navegador
  - engine/.token_smiles        : token de autorización de tu sesión
  - y hace una búsqueda de prueba para verificar que el detalle funciona.

Todo queda SOLO en tu Mac (está en .gitignore, jamás viaja a GitHub).

Uso:
    python3 engine/login_smiles.py
"""
import datetime
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ENGINE = Path(__file__).resolve().parent
PERFIL = ENGINE / ".perfil_smiles"
STORAGE = ENGINE / ".storage_smiles.json"
TOKEN = ENGINE / ".token_smiles"
MARCA = ENGINE / ".login_ok"
DEBUG = ENGINE / ".debug"

ANON_BEARER = "EQjdqeAqKyfFnM4ggBh8oVrV9iSzQvX823u81K4eGVPfKpEdfKnSri"

SENIALES_LOGIN = [
    "Cerrar sesión", "Cerrar Sesión", "CERRAR SESIÓN",
    "Mis datos", "Mi cuenta", "Extracto",
    "Millas disponibles", "Categoría",
]


def main():
    DEBUG.mkdir(exist_ok=True)
    tokens_vistos = {}
    capturas_busqueda = []

    print("Abriendo Smiles Argentina... iniciá sesión en la ventana que aparece.")
    print("(Tenés 15 minutos; al detectar el login se hace sola una búsqueda de")
    print(" prueba y la ventana se cierra. No la cierres vos antes.)")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PERFIL), headless=False,
            viewport={"width": 1280, "height": 860},
            locale="es-AR", timezone_id="America/Argentina/Buenos_Aires",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        pagina_logueada = []

        def on_request(req):
            auth = req.headers.get("authorization", "")
            if auth and ANON_BEARER not in auth and auth.lower().startswith("bearer"):
                tokens_vistos[auth] = req.url[:100]
                try:
                    pagina_logueada.append(req.frame.page)
                except Exception:
                    pass

        def on_response(resp):
            if "airlines/search" in resp.url and "calendar" not in resp.url:
                try:
                    capturas_busqueda.append(resp.json())
                except Exception:
                    pass

        # A nivel de CONTEXTO: vigila todas las pestañas y popups
        ctx.on("request", on_request)
        ctx.on("response", on_response)

        page.goto("https://www.smiles.com.ar/home", wait_until="domcontentloaded",
                  timeout=60000)
        try:
            page.get_by_text("Iniciá sesión", exact=False).first.click(timeout=8000)
        except Exception:
            pass

        JS_TOKEN = """(() => {
            const bolsas = [localStorage, sessionStorage];
            for (const b of bolsas) {
                for (let i = 0; i < b.length; i++) {
                    const k = b.key(i), v = b.getItem(k) || '';
                    if (/token|auth|session/i.test(k) && v.length > 60) return k;
                    if (v.startsWith('eyJ') && v.length > 100) return k; // JWT
                }
            }
            return null;
        })()"""

        limite = time.time() + 20 * 60
        ultimo_diag = 0.0
        logueado = False
        while time.time() < limite:
            # Señal 1 (la fuerte): apareció tu token en alguna llamada de red
            if tokens_vistos:
                logueado = True
                if pagina_logueada:
                    try:
                        if not pagina_logueada[-1].is_closed():
                            page = pagina_logueada[-1]
                    except Exception:
                        pass
                break
            # Señal 2: texto o almacenamiento en cualquier pestaña
            for pg in list(ctx.pages):
                try:
                    texto = pg.evaluate("document.body.innerText") or ""
                    if any(s in texto for s in SENIALES_LOGIN):
                        logueado = True
                        page = pg
                        break
                    if "smiles.com.ar" in pg.url and pg.evaluate(JS_TOKEN):
                        logueado = True
                        page = pg
                        break
                except Exception:
                    pass
            if logueado:
                break
            # Diagnóstico continuo cada 30s (para depurar si algo falla)
            if time.time() - ultimo_diag > 30:
                ultimo_diag = time.time()
                try:
                    diag = []
                    for pg in list(ctx.pages):
                        try:
                            t = (pg.evaluate("document.body.innerText") or "")[:800]
                        except Exception:
                            t = "(sin acceso)"
                        diag.append(f"URL: {pg.url}\n{t}\n{'-'*50}")
                    (DEBUG / "login_diag.txt").write_text(
                        f"{time.strftime('%H:%M:%S')} tokens:{len(tokens_vistos)}\n"
                        + "\n".join(diag))
                except Exception:
                    pass
            time.sleep(3)

        if not logueado:
            print("✗ No detecté el login en 15 minutos. Corré de nuevo:")
            print("    python3 engine/login_smiles.py")
            ctx.close()
            return 1

        print("✓ Sesión detectada. Capturando credenciales y probando el detalle")
        print("  de vuelos (unos 40 segundos, no cierres la ventana)...")

        # 1. Guardar cookies + localStorage
        ctx.storage_state(path=str(STORAGE))
        # sessionStorage no entra en storage_state: lo guardamos aparte
        try:
            ss = page.evaluate("JSON.stringify(sessionStorage)")
            local = page.evaluate("JSON.stringify(localStorage)")
            extra = {"sessionStorage": json.loads(ss), "localStorage": json.loads(local),
                     "url": page.url}
            st = json.loads(STORAGE.read_text())
            st["nachovuela_extra"] = extra
            STORAGE.write_text(json.dumps(st, ensure_ascii=False))
        except Exception as e:
            print("  (no pude volcar el storage extra:", e, ")")

        # 2. Búsqueda de prueba: EZE->GIG en ~4 meses, para capturar el token
        #    de usuario y verificar si la página busca vuelos por URL.
        objetivo = datetime.date.today() + datetime.timedelta(days=120)
        dt = datetime.datetime(objetivo.year, objetivo.month, 15, 12, 0)
        ms = int(dt.timestamp() * 1000)
        url = (f"https://www.smiles.com.ar/emission?adults=1&cabinType=all&children=0"
               f"&currencyCode=USD&departureDate={ms}&destinationAirportCode=GIG"
               f"&infants=0&isFlexibleDateChecked=false&originAirportCode=EZE"
               f"&searchType=g3&segments=1&tripType=2"
               f"&originAirportIsAny=false&destinAirportIsAny=false")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            fin = time.time() + 35
            while time.time() < fin and not capturas_busqueda:
                page.wait_for_timeout(1000)
            page.wait_for_timeout(3000)
            page.screenshot(path=str(DEBUG / "login_busqueda_prueba.png"))
            (DEBUG / "login_busqueda_texto.txt").write_text(
                (page.evaluate("document.body.innerText") or "")[:4000])
        except Exception as e:
            print("  (búsqueda de prueba falló:", e, ")")

        # 3. Guardar el token de usuario si apareció
        if tokens_vistos:
            token = max(tokens_vistos, key=len)
            TOKEN.write_text(token)
            print(f"  ✓ Token de sesión capturado ({len(tokens_vistos)} visto/s).")
        else:
            print("  (no vi ningún token de usuario en las llamadas)")

        if capturas_busqueda:
            (DEBUG / "login_flightsearch.json").write_text(
                json.dumps(capturas_busqueda[0], ensure_ascii=False)[:900000])
            print("  ✓ ¡La búsqueda de detalle FUNCIONA! Respuesta de vuelos capturada.")
        else:
            print("  (la página no disparó la búsqueda de vuelos por URL; el radar")
            print("   intentará otra vía con el token — diagnóstico en engine/.debug/)")

        MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
        ctx.close()

    print("✓ Listo. Ya podés cerrar la terminal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
