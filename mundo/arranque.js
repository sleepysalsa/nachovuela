/* NachoVuela · mundo/arranque.js — enciende el mundo en el orden correcto. */
(function () {
  'use strict';
  const NV = window.NV;
  const $ = s => document.querySelector(s);
  const fm = n => { try { return NV.fmtMiles ? NV.fmtMiles(n) : String(n); } catch (e) { return String(n); } };
  /* "Miami y alrededores" → "Miami" */
  const corto = s => String(s || '').split(/\s+y\s+|\s*\/\s*|,/i)[0].trim() || String(s || '');

  /* ── HUD de estado ────────────────────────────────────────────────────────
     Antes decía "hace X min" calculado UNA sola vez al cargar y se quedaba así
     toda la sesión: a las tres horas seguía diciendo "hace 2 min". Ahora lo
     pinta NV.estadoMotor() (que además sabe si el último barrido falló) y se
     repinta con cada nv:datos — el cerebro lo dispara al entrar datos nuevos y
     una vez por minuto. El setInterval de acá es el respaldo por si el cerebro
     todavía no emite el evento.                                             */
  function pintarHUD() {
    const el = $('#hudEstado'); if (!el) return;
    const span = el.querySelector('span'); if (!span) return;
    const L = NV.state && NV.state.latest;
    const rutas = (L && L.resultados) || [];
    const ops = rutas.filter(r => r && r.nivel === 'oportunidad').length;

    let est = null;
    if (typeof NV.estadoMotor === 'function') { try { est = NV.estadoMotor(); } catch (e) { est = null; } }
    if (!est) {                                   // respaldo mientras no exista NV.estadoMotor
      const s = NV.ui ? NV.ui.sello('radar') : null;
      est = rutas.length
        ? { ok: true, txt: (s ? s.txt : 'radar') + ' · ' + rutas.length + ' rutas' }
        : { ok: false, txt: 'sin datos del radar todavía' };
    }
    const s = NV.ui ? NV.ui.sello('radar') : null;
    el.classList.toggle('es-mal', est.ok === false);
    el.classList.toggle('es-viejo', est.ok !== false && !!s && s.nivel !== 'fresco');
    span.textContent = est.txt + (ops ? ' · ' + ops + ' oport.' : '');
  }

  /* ── Titular de la pizarra de cotizaciones ────────────────────────────────
     La pizarra dejó de ser una estación (el histórico se mudó a la ficha de
     cada destino), pero sigue en la escena: le dejamos UNA línea con lo más
     jugoso — qué ruta está más cerca de su mínimo visto. */
  function titularPizarra() {
    const R = ((NV.state && NV.state.latest && NV.state.latest.resultados) || [])
      .filter(r => r && r.mejor_precio_millas != null);
    if (!R.length) return 'todavía no hay datos del radar';
    if (typeof NV.hist === 'function') {
      let mejor = null;
      for (const r of R) {
        let h = null; try { h = NV.hist(r.ruta); } catch (e) { h = null; }
        const min = h && h.minVisto && h.minVisto.miles;
        if (!min) continue;
        const sobre = r.mejor_precio_millas / min;      // 1.00 = está en su mínimo histórico
        if (!mejor || sobre < mejor.sobre) mejor = { r, min, sobre };
      }
      if (mejor) {
        const pct = Math.round((mejor.sobre - 1) * 100);
        const nom = corto(mejor.r.destino_nombre || mejor.r.destino_key);
        return pct <= 0
          ? nom + ' está en su mínimo visto: ' + fm(mejor.r.mejor_precio_millas) + ' millas'
          : nom + ' a ' + pct + '% de su mínimo visto (' + fm(mejor.min) + ')';
      }
    }
    const b = R.reduce((a, x) => (x.mejor_precio_millas < a.mejor_precio_millas ? x : a));
    return R.length + ' rutas vigiladas · lo más barato hoy: ' + corto(b.destino_nombre) + ' ' + fm(b.mejor_precio_millas);
  }

  (async function () {
    NV.setupLock?.();
    await NV.cargarDatos?.();
    NV.setupSheet?.();
    pintarHUD();

    // El 3D es un módulo: esperamos a que dispare nv:mundo-listo (o ya esté)
    await new Promise(res => NV.mundo ? res() : document.addEventListener('nv:mundo-listo', res, { once: true }));

    NV.camara.arrancar();
    NV.montarEstaciones();
    NV.mundo.pizarra?.(titularPizarra());

    // Brújula: tres paradas y una sola salida (el chip .volver, igual que Esc)
    const bru = $('#brujula');
    bru?.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const n = b.dataset.est;
      if (!n) NV.camara.soltar(); else NV.camara.enfocar(n);
    });
    const NOMBRE = { mac: 'tu Mac', partidas: 'el tablero de vuelos', mostrador: 'el mostrador de revistas' };
    NV.camara.onFrame(cam => {
      bru?.querySelectorAll('button[data-est]').forEach(b => {
        const n = b.dataset.est; if (!n) return;
        b.classList.toggle('is-foco', cam.enfocada === n && cam.zoom > 0.5);
        b.classList.toggle('is-mirando', !cam.enfocada && cam.mirando === n);
      });
      const pista = $('#hudPista');
      if (pista && !cam.enfocada) {
        pista.textContent = cam.mirando
          ? `estás mirando ${NOMBRE[cam.mirando] || cam.mirando} · scrolleá o hacé clic para acercarte`
          : 'movete con el mouse para mirar · scrolleá o hacé clic para acercarte';
      }
    });

    /* El latido del cerebro: repesca meta.json cada 5 minutos (200 bytes) y
       emite nv:datos cada minuto para que los "hace X" se muevan. Lo arranca
       init() de app.js, que en el mundo 3D no corre: hay que pedirlo acá. */
    NV.arrancarLatido?.();
    window.addEventListener('nv:datos', () => {
      pintarHUD();
      NV.refrescarSellos?.();                 // reescribe todos los [data-sello] de una
      NV.mundo.pizarra?.(titularPizarra());
    });
    setInterval(() => { pintarHUD(); NV.refrescarSellos?.(); }, 60000);   // respaldo

    // Empieza mirando al frente y, tras un instante, baja la vista a la Mac como saludo
    setTimeout(() => { if (NV.camara.cam.libre && NV.camara.cam.zoom === 0) NV.camara.mirarA('mac', 0); }, 1400);
    setTimeout(() => { NV.camara.cam.libre = true; }, 3400);

    document.body.classList.add('listo');
    NV.registerSW?.();
  })();
})();
