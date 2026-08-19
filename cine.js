/* ============================================================================
   NachoVuela · La Terminal — orquestador de la experiencia
   ----------------------------------------------------------------------------
   Todo pasa en UN solo plano fijo (#escenario). El scroll no mueve la página:
   mueve el TIEMPO de la escena. Cada tramo del scroll es un momento del relato:

     0.00–0.10  llegás a la terminal (te ves sentado, gorra NachoVuela)
     0.10–0.16  la cámara entra a tu punto de vista (regazo + Mac cerrada)
     0.16–0.38  se abre la tapa: buscás vuelos en la Mac
     0.38–0.46  cerrás la tapa y levantás la vista
     0.46–0.68  cartel de PARTIDAS (lo que encontró el radar)
     0.68–0.82  girás al cartel de LLEGADAS (las vueltas)
     0.82–1.00  abrís la revista (destinos + noticias)

   Cada escena se registra con NV.escena(nombre, {...}) y recibe su progreso
   local (0..1) ya normalizado, más el "cerebro" de la app (window.NV) para
   sacar datos y abrir las hojas del Armador o de cada destino.
   ========================================================================== */
(function () {
  'use strict';

  const NV = window.NV;
  const escenas = {};
  const orden = [];

  /* --- Tramos del relato (inicio, fin) en progreso global 0..1 --- */
  const ACTOS = {
    terminal: [0.00, 0.16],   // ambiente + vos sentado + entrada al POV
    mac:      [0.10, 0.46],   // la notebook: abre, buscás, cierra
    partidas: [0.42, 0.70],   // cartel split-flap de salidas
    llegadas: [0.66, 0.84],   // cartel de llegadas
    revista:  [0.80, 1.00],   // la revista
  };

  /* Progreso local dentro de un acto: 0 antes, 0..1 durante, 1 después */
  function local(p, [ini, fin]) {
    if (p <= ini) return 0;
    if (p >= fin) return 1;
    return (p - ini) / (fin - ini);
  }
  const activo = (p, [ini, fin], m = 0.04) => p > ini - m && p < fin + m;

  /* Utilidades de animación que usan todas las escenas */
  const U = {
    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    // curva suave: arranca y termina despacio
    ease: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    easeOut: t => 1 - Math.pow(1 - t, 3),
    easeIn: t => t * t * t,
    // mapea un tramo interno de un progreso (ej: del 20% al 60% de la escena)
    tramo: (p, a, b) => U.clamp((p - a) / (b - a)),
    // ¿el visitante pidió menos animación? (accesibilidad)
    calmo: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  window.NVU = U;

  /* --- Registro de escenas --------------------------------------------- */
  function escena(nombre, def) {
    escenas[nombre] = Object.assign({ nombre, montada: false, visible: null }, def);
    if (!orden.includes(nombre)) orden.push(nombre);
  }

  /* --- Contexto que reciben las escenas -------------------------------- */
  const ctx = {
    NV,                       // cerebro: datos, cálculos, links, hojas
    U,                        // utilidades de animación
    get datos() { return NV.state; },
    // atajos a los datos que más se usan
    get resultados() { return NV.state.latest?.resultados || []; },
    get ofertas() { return NV.state.ofertas?.posts || []; },
    get destinos() { return NV.state.destinos?.destinos || {}; },
    abrirDestino: k => NV.openDestino(k),
    abrirArmador: (d, ym, code, ida, vta) => NV.openArmador(d, ym, code, ida, vta),
  };

  /* --- Motor de scroll -------------------------------------------------- */
  let progreso = 0, objetivo = 0, rafId = null;

  function medir() {
    const viaje = document.getElementById('viaje');
    if (!viaje) return 0;
    const alto = viaje.offsetHeight - window.innerHeight;
    return alto > 0 ? U.clamp(window.scrollY / alto) : 0;
  }

  function pintar() {
    // suavizado: el progreso persigue al scroll, así nada salta de golpe
    progreso += (objetivo - progreso) * (U.calmo() ? 1 : 0.12);
    if (Math.abs(objetivo - progreso) < 0.0001) progreso = objetivo;

    for (const nombre of orden) {
      const e = escenas[nombre];
      const rango = ACTOS[nombre];
      if (!rango) continue;
      const vis = activo(progreso, rango);
      if (vis !== e.visible) {
        e.visible = vis;
        e.raiz?.classList.toggle('esc--on', vis);
        if (vis && e.enter) e.enter(ctx);
        if (!vis && e.exit) e.exit(ctx);
      }
      if (vis && e.update) e.update(local(progreso, rango), ctx, progreso);
    }
    document.documentElement.style.setProperty('--p', progreso.toFixed(4));
    rafId = requestAnimationFrame(pintar);
  }

  /* --- Arranque --------------------------------------------------------- */
  async function arrancar() {
    await NV.cargarDatos();

    const host = document.getElementById('escenario');
    for (const nombre of orden) {
      const e = escenas[nombre];
      const div = document.createElement('div');
      div.className = 'esc esc--' + nombre;
      div.id = 'esc-' + nombre;
      if (e.html) div.innerHTML = e.html(ctx);
      host.appendChild(div);
      e.raiz = div;
      if (e.mount) e.mount(div, ctx);
      e.montada = true;
    }

    NV.setupSheet();
    window.addEventListener('scroll', () => { objetivo = medir(); }, { passive: true });
    window.addEventListener('resize', () => { objetivo = medir(); });
    objetivo = progreso = medir();
    pintar();
    document.body.classList.add('listo');
    NV.registerSW?.();
  }

  /* Pinta un momento puntual del relato sin esperar al scroll.
     Lo usa el riel de capítulos y sirve para probar escenas sueltas. */
  function irA(p, saltar) {
    objetivo = U.clamp(p);
    if (saltar) progreso = objetivo;
    for (const nombre of orden) {
      const e = escenas[nombre];
      const rango = ACTOS[nombre];
      if (!rango) continue;
      const vis = activo(progreso, rango);
      if (vis !== e.visible) {
        e.visible = vis;
        e.raiz?.classList.toggle('esc--on', vis);
        if (vis && e.enter) e.enter(ctx);
        if (!vis && e.exit) e.exit(ctx);
      }
      if (vis && e.update) e.update(local(progreso, rango), ctx, progreso);
    }
    document.documentElement.style.setProperty('--p', progreso.toFixed(4));
  }

  window.NV.escena = escena;
  window.NV.arrancarCine = arrancar;
  window.NV.irA = irA;
  window.NV.ACTOS = ACTOS;
})();
