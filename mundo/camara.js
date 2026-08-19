/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/camara.js — la cabeza de Nacho.

   Primera persona: la cámara está en el asiento y NO se mueve de ahí. Lo único
   que hace es MIRAR (yaw/pitch) y ACERCARSE (dolly) a lo que le interesa.

   Fuentes de intención:
     · mouse (o dedo arrastrando): mira suave hacia donde apuntás
     · scroll / pinch: acerca o aleja
     · click en una estación (o su chip): la cámara viaja sola hasta ella
     · teclado: flechas miran, Enter acerca, Esc aleja

   Todo pasa por un solo estado {yaw, pitch, zoom} suavizado con easing
   crítico (sin rebote) — el mismo para el 3D y para los paneles DOM que
   se pegan a cada estación. Exporta NV.camara.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});

  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ── Estaciones: dónde está cada cosa en la esfera de la mirada ──────────
     yaw  = giro horizontal en grados (0 = de frente al ventanal, + = derecha)
     pitch= inclinación (0 = horizonte, + = arriba, − = abajo)
     zoom = 0 vista general … 1 la estación ocupa la pantalla y es usable
     Los valores los ajustan las escenas al montarse (registrar()).       */
  const estaciones = {};

  const cam = {
    yaw: 0, pitch: 0, zoom: 0,           // estado real (suavizado)
    tYaw: 0, tPitch: 0, tZoom: 0,        // objetivo
    enfocada: null,                      // nombre de la estación con zoom
    mirando: null,                       // la más cercana a la mirada
    libre: true,                         // el mouse gobierna la mirada
    limites: { yaw: [-95, 95], pitch: [-55, 45] },
    sens: { mouse: 1.0, drag: 0.35, rueda: 0.0011 },
    suav: { mirar: 0.085, zoom: 0.10 },  // 60fps: ~0.35s hasta el 90%
    hooks: [],                           // callbacks(cam) por frame
    animando: false,
  };

  function registrar(nombre, def) {
    estaciones[nombre] = Object.assign({ yaw: 0, pitch: 0, radioEnfoque: 22 }, def);
  }

  /* Cuál estación queda más cerca de la mirada actual (para chips/hints). */
  function masCercana() {
    let mejor = null, d0 = 1e9;
    for (const [n, e] of Object.entries(estaciones)) {
      const dy = cam.yaw - e.yaw, dp = cam.pitch - e.pitch;
      const d = Math.hypot(dy, dp);
      if (d < d0) { d0 = d; mejor = n; }
    }
    return d0 < 40 ? mejor : null;
  }

  /* ── Órdenes ─────────────────────────────────────────────────────────── */
  function mirarA(nombre, zoom) {
    const e = estaciones[nombre]; if (!e) return;
    cam.libre = false;
    cam.tYaw = e.yaw; cam.tPitch = e.pitch;
    if (zoom != null) cam.tZoom = clamp(zoom, 0, 1);
    cam.enfocada = zoom > 0.5 ? nombre : cam.enfocada;
    marcar();
  }
  function enfocar(nombre) { mirarA(nombre, 1); cam.enfocada = nombre; marcar(); }
  function soltar() { cam.tZoom = 0; cam.enfocada = null; cam.libre = true; marcar(); }
  function acercar(delta) {
    // Al acercar, se engancha a la estación más cercana para que el zoom "aterrice".
    const n = cam.enfocada || masCercana();
    if (delta > 0 && n) { cam.enfocada = n; cam.libre = false;
      const e = estaciones[n]; cam.tYaw = e.yaw; cam.tPitch = e.pitch; }
    cam.tZoom = clamp(cam.tZoom + delta, 0, 1);
    if (cam.tZoom <= 0.02) { cam.tZoom = 0; cam.enfocada = null; cam.libre = true; }
    marcar();
  }

  /* ── Entradas ────────────────────────────────────────────────────────── */
  let ancho = 1, alto = 1, arrastrando = false, ax = 0, ay = 0, ultimoToque = 0;
  function medir() { ancho = window.innerWidth || 1; alto = window.innerHeight || 1; }

  function onMove(e) {
    if (!cam.libre || arrastrando) return;
    // el mouse define la mirada de forma absoluta: centro = de frente
    const nx = (e.clientX / ancho) * 2 - 1;      // -1..1
    const ny = (e.clientY / alto) * 2 - 1;
    cam.tYaw = clamp(nx * cam.limites.yaw[1] * cam.sens.mouse, ...cam.limites.yaw);
    cam.tPitch = clamp(-ny * cam.limites.pitch[1] * cam.sens.mouse, ...cam.limites.pitch);
    marcar();
  }
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    arrastrando = true; ax = e.clientX; ay = e.clientY;
    if (cam.tZoom < 0.5) cam.libre = false;   // el drag toma el mando
  }
  function onDrag(e) {
    if (!arrastrando) return;
    const dx = e.clientX - ax, dy = e.clientY - ay; ax = e.clientX; ay = e.clientY;
    if (cam.tZoom > 0.5) return;               // enfocado: la estación se scrollea
    cam.tYaw = clamp(cam.tYaw - dx * cam.sens.drag, ...cam.limites.yaw);
    cam.tPitch = clamp(cam.tPitch + dy * cam.sens.drag, ...cam.limites.pitch);
    marcar();
  }
  function onUp() { arrastrando = false; if (cam.tZoom < 0.02) cam.libre = !('ontouchstart' in window); }

  function onWheel(e) {
    // Si estás enfocado en una estación y ella scrollea internamente, la dejamos.
    if (cam.tZoom > 0.6 && e.target.closest && e.target.closest('[data-scroll-interno]')) {
      const el = e.target.closest('[data-scroll-interno]');
      const enTope = e.deltaY < 0 && el.scrollTop <= 0;
      const enFondo = e.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (!enTope && !enFondo) return;         // scrollea adentro
      if (enFondo) return;                     // en el fondo, no salimos: seguí leyendo
      // en el tope y scrolleás hacia arriba: soltamos la estación
    }
    e.preventDefault();
    acercar(e.deltaY * cam.sens.rueda);
  }
  function onKey(e) {
    const p = 6;
    if (e.key === 'ArrowLeft')  { cam.libre = false; cam.tYaw = clamp(cam.tYaw - p, ...cam.limites.yaw); }
    else if (e.key === 'ArrowRight') { cam.libre = false; cam.tYaw = clamp(cam.tYaw + p, ...cam.limites.yaw); }
    else if (e.key === 'ArrowUp')    { cam.libre = false; cam.tPitch = clamp(cam.tPitch + p, ...cam.limites.pitch); }
    else if (e.key === 'ArrowDown')  { cam.libre = false; cam.tPitch = clamp(cam.tPitch - p, ...cam.limites.pitch); }
    else if (e.key === 'Enter') { const n = masCercana(); if (n) enfocar(n); }
    else if (e.key === 'Escape') soltar();
    else return;
    e.preventDefault(); marcar();
  }

  /* ── Bucle ───────────────────────────────────────────────────────────── */
  let pedido = false;
  function marcar() { if (!pedido) { pedido = true; requestAnimationFrame(tic); } }
  function tic() {
    pedido = false;
    const sm = cam.suav.mirar, sz = cam.suav.zoom;
    cam.yaw = lerp(cam.yaw, cam.tYaw, sm);
    cam.pitch = lerp(cam.pitch, cam.tPitch, sm);
    cam.zoom = lerp(cam.zoom, cam.tZoom, sz);
    const quieto = Math.abs(cam.yaw - cam.tYaw) < 0.02 && Math.abs(cam.pitch - cam.tPitch) < 0.02
                && Math.abs(cam.zoom - cam.tZoom) < 0.002;
    if (quieto) { cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; cam.zoom = cam.tZoom; }
    cam.mirando = masCercana();
    for (const h of cam.hooks) h(cam);
    document.documentElement.style.setProperty('--yaw', cam.yaw.toFixed(2));
    document.documentElement.style.setProperty('--pitch', cam.pitch.toFixed(2));
    document.documentElement.style.setProperty('--zoom', cam.zoom.toFixed(3));
    document.body.classList.toggle('cam-enfocada', cam.zoom > 0.85);
    document.body.dataset.enfocada = cam.enfocada || '';
    document.body.dataset.mirando = cam.mirando || '';
    if (!quieto) marcar();
  }

  function arrancar() {
    medir();
    window.addEventListener('resize', medir);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onDrag, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchstart', e => { const t = e.touches[0]; ultimoToque = Date.now(); onDown({ clientX: t.clientX, clientY: t.clientY }); }, { passive: true });
    window.addEventListener('touchmove', e => { const t = e.touches[0]; onDrag({ clientX: t.clientX, clientY: t.clientY }); }, { passive: true });
    window.addEventListener('touchend', onUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    marcar();
  }

  NV.camara = { cam, estaciones, registrar, mirarA, enfocar, soltar, acercar,
                masCercana, arrancar, onFrame: h => cam.hooks.push(h),
                D2R, clamp, lerp };
})();
