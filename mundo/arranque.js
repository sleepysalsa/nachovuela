/* NachoVuela · mundo/arranque.js — enciende el mundo en el orden correcto. */
(async function () {
  'use strict';
  const NV = window.NV;
  const $ = s => document.querySelector(s);

  NV.setupLock?.();
  await NV.cargarDatos?.();
  NV.setupSheet?.();

  // HUD estado
  const L = NV.state?.latest;
  const ops = (L?.resultados || []).filter(r => r.nivel === 'oportunidad').length;
  const est = $('#hudEstado span');
  if (est) est.textContent = L ? `${ops} oportunidad${ops === 1 ? '' : 'es'} · ${NV.haceCuanto(L.generado)}` : 'sin datos aún';

  // El 3D es un módulo: esperamos a que dispare nv:mundo-listo (o ya esté)
  await new Promise(res => NV.mundo ? res() : document.addEventListener('nv:mundo-listo', res, { once: true }));

  NV.camara.arrancar();
  NV.montarEstaciones();

  // Brújula
  const bru = $('#brujula');
  bru?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const n = b.dataset.est;
    if (!n) NV.camara.soltar(); else NV.camara.enfocar(n);
  });
  NV.camara.onFrame(cam => {
    bru?.querySelectorAll('button[data-est]').forEach(b => {
      const n = b.dataset.est; if (!n) return;
      b.classList.toggle('is-foco', cam.enfocada === n && cam.zoom > 0.5);
      b.classList.toggle('is-mirando', !cam.enfocada && cam.mirando === n);
    });
    const pista = $('#hudPista');
    if (pista && !cam.enfocada) {
      pista.textContent = cam.mirando
        ? `estás mirando ${ {mac:'tu Mac',partidas:'el cartel de partidas',llegadas:'el cartel de llegadas',mostrador:'el mostrador de revistas'}[cam.mirando] } · scrolleá o hacé clic para acercarte`
        : 'movete con el mouse para mirar · scrolleá o hacé clic para acercarte';
    }
  });

  // Empieza mirando al frente y, tras un instante, baja la vista a la Mac como saludo
  setTimeout(() => { if (NV.camara.cam.libre && NV.camara.cam.zoom === 0) NV.camara.mirarA('mac', 0); }, 1400);
  setTimeout(() => { NV.camara.cam.libre = true; }, 3400);

  document.body.classList.add('listo');
  NV.registerSW?.();
})();
