/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones.js — paneles DOM pegados al mundo 3D.

   Cada estación (mac, partidas, llegadas, mostrador) es un <section> HTML
   normal — con su buscador, su cartel, su índice — que se PROYECTA encima del
   3D en la posición de su ancla. Cuando la mirada se acerca (zoom→1) el panel
   crece hasta ocupar la pantalla y recibe clics/scroll; lejos, es un cartel
   dentro de la escena que se ve chiquito y no se toca.

   Contrato de una estación:
     NV.estacion('partidas', {
       html()   → string con el interior del panel
       mount(el, ctx)         una vez, al crear
       enfocar(el, ctx)       cuando la cámara la enfoca (zoom>0.85)
       desenfocar(el, ctx)
       tick(el, ctx, cam)     opcional, por frame (barato)
     })
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});
  const defs = {}, vivas = {};

  NV.estacion = (nombre, def) => { defs[nombre] = def; };

  function ctx() {
    return {
      NV, resultados: NV.state?.latest?.resultados || [],
      ofertas: NV.state?.ofertas?.posts || [],
      abrirDestino: k => NV.openDestino?.(k),
      abrirArmador: (...a) => NV.openArmador?.(...a),
      enfocar: n => NV.camara.enfocar(n),
      soltar: () => NV.camara.soltar(),
    };
  }

  function montar() {
    const capa = document.getElementById('estaciones');
    for (const [n, def] of Object.entries(defs)) {
      const el = document.createElement('section');
      el.className = 'est est--' + n; el.id = 'est-' + n; el.dataset.est = n;
      el.innerHTML = def.html ? def.html(ctx()) : '';
      capa.appendChild(el);
      vivas[n] = { el, def, enfocada: false };
      def.mount?.(el, ctx());
      // click en el panel lejano → la cámara viaja hasta él
      el.addEventListener('click', e => {
        if (NV.camara.cam.zoom < 0.5) { e.preventDefault(); NV.camara.enfocar(n); }
      }, true);
    }
    medirPantalla();
    NV.mundo.onFrame(colocar);
  }

  /* ── Tamaño fijo de cada panel ─────────────────────────────────────────
     Clave para la fluidez: el panel NUNCA cambia de ancho/alto mientras la
     cámara viaja. Se le da de entrada el tamaño que va a tener enfocado
     (el mayor que entra en pantalla respetando la proporción de su marco
     3D) y todo el movimiento se hace con transform: la placa de video
     compone y escala sin recalcular la maqueta. Antes, cambiar width/height
     por frame obligaba a re-maquetar 2.500 fichas del cartel → 60ms/frame.
     Solo se recalcula al cambiar el tamaño de la ventana.                */
  const base = { W: 0, H: 0 };
  function medirPantalla() {
    base.W = window.innerWidth; base.H = window.innerHeight;
    for (const [n, v] of Object.entries(vivas)) {
      const e = NV.camara.estaciones[n];
      const rel = (e?.ancho || 1.5) / (e?.alto || 1);      // proporción del ancla 3D
      let fw, fh;
      if (base.H > base.W) {
        // Pantalla vertical (celular): el panel llena lo que hay. Respetar la
        // proporción del marco 3D dejaría la Mac en una franjita apaisada con
        // todo el alto desperdiciado.
        fw = base.W * 0.94; fh = base.H * 0.80;
      } else {
        fw = Math.min(base.W * 0.94, 1240); fh = fw / rel;
        const maxAlto = base.H * 0.88;
        if (fh > maxAlto) { fh = maxAlto; fw = fh * rel; }
      }
      v.fw = fw; v.fh = fh;
      v.el.style.width = fw + 'px';
      v.el.style.height = fh + 'px';
    }
  }

  /* Por frame: proyectar cada panel a la pantalla (solo transform/opacity) */
  function colocar() {
    const cam = NV.camara.cam;
    if (base.W !== window.innerWidth || base.H !== window.innerHeight) medirPantalla();
    // ¿la cámara está en movimiento? mientras viaja, cada panel vive en su
    // propia capa (will-change) para que solo se componga, y al frenar se
    // suelta para que vuelva a dibujarse nítido.
    const moviendo = Math.abs(cam.zoom - cam.tZoom) > 0.002
                  || Math.abs(cam.yaw - cam.tYaw) > 0.05
                  || Math.abs(cam.pitch - cam.tPitch) > 0.05;
    for (const [n, v] of Object.entries(vivas)) {
      const p = NV.mundo.proyectar(n);
      const el = v.el;
      if (!p || !p.visible) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; continue; }
      const esFoco = cam.enfocada === n;
      const zoomLocal = esFoco ? cam.zoom : 0;
      const fw = v.fw || 1, fh = v.fh || 1;
      // escala lejana = qué fracción del panel ocupa su marco en el mundo
      const escLejos = Math.min(1, p.anchoPx / fw, p.altoPx / fh);
      const esc = escLejos + (1 - escLejos) * zoomLocal;
      const x = p.x + (base.W / 2 - p.x) * zoomLocal;
      const y = p.y + (base.H / 2 - p.y) * zoomLocal;
      el.style.transform =
        `translate(${(x - fw / 2).toFixed(1)}px, ${(y - fh / 2).toFixed(1)}px) scale(${esc.toFixed(4)})`;
      const otroEnfocado = cam.enfocada && !esFoco;
      el.style.opacity = otroEnfocado ? String(1 - cam.zoom * 0.9) : '1';
      el.style.pointerEvents = (esFoco && cam.zoom > 0.85) || (!cam.enfocada) ? 'auto' : 'none';
      el.classList.toggle('est--foco', esFoco && cam.zoom > 0.85);
      el.classList.toggle('est--lejos', !esFoco);
      el.classList.toggle('est--mirando', cam.mirando === n && !cam.enfocada);
      if (v.mov !== moviendo) { v.mov = moviendo; el.classList.toggle('est--mov', moviendo); }
      const ahora = esFoco && cam.zoom > 0.85;
      if (ahora !== v.enfocada) { v.enfocada = ahora; (ahora ? v.def.enfocar : v.def.desenfocar)?.(el, ctx()); }
      v.def.tick?.(el, ctx(), cam);
    }
  }

  NV.montarEstaciones = montar;
})();
