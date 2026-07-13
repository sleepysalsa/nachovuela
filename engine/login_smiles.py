#!/usr/bin/env python3
"""
Login de Smiles para NachoVuela — se corre UNA vez (o cuando expire la sesión).

Abre una ventana de Chrome real donde vos iniciás sesión con tu cuenta de
Smiles. La sesión queda guardada en engine/.perfil_smiles/ (solo en tu Mac,
nunca se sube a GitHub) y el motor la reutiliza para pedir el detalle de
vuelos: aerolínea, horarios, duración y escalas.

Tu clave la tipeás VOS en la ventana — este programa no la ve ni la guarda.

Uso:
    python3 engine/login_smiles.py
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ENGINE = Path(__file__).resolve().parent
PERFIL = ENGINE / ".perfil_smiles"
MARCA = ENGINE / ".login_ok"

SENIALES_LOGIN = [
    "Cerrar sesión", "Cerrar Sesión", "CERRAR SESIÓN",
    "Mis datos", "Mi cuenta", "Extracto",
    "Millas disponibles", "Categoría",
]


def main():
    print("Abriendo Smiles Argentina... iniciá sesión en la ventana que aparece.")
    print("(Tenés 15 minutos; la ventana se cierra sola cuando detecte el login.)")
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PERFIL), headless=False,
            viewport={"width": 1280, "height": 860},
            locale="es-AR", timezone_id="America/Argentina/Buenos_Aires",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.smiles.com.ar/home", wait_until="domcontentloaded",
                  timeout=60000)
        # Llevarlo directo al botón de login lo confunde menos que buscarlo él
        try:
            page.get_by_text("Iniciá sesión", exact=False).first.click(timeout=8000)
        except Exception:
            pass  # si no está el botón, quizá ya hay sesión

        limite = time.time() + 15 * 60
        logueado = False
        while time.time() < limite:
            try:
                texto = page.evaluate("document.body.innerText") or ""
                if any(s in texto for s in SENIALES_LOGIN):
                    logueado = True
                    break
            except Exception:
                pass  # navegando entre páginas
            time.sleep(3)

        if logueado:
            MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
            print("✓ ¡Sesión detectada! Ya podés cerrar esto. El radar va a usar "
                  "tu sesión para traer aerolíneas, horarios y escalas.")
            time.sleep(4)
        else:
            print("✗ No detecté el login en 15 minutos. Corré de nuevo:")
            print("    python3 engine/login_smiles.py")
        ctx.close()
    return 0 if logueado else 1


if __name__ == "__main__":
    sys.exit(main())
