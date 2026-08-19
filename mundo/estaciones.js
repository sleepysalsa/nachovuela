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
    NV.mundo.onFrame(colocar);
  }

  /* Por frame: proyectar cada panel a la pantalla */
  function colocar() {
    const cam = NV.camara.cam;
    for (const [n, v] of Object.entries(vivas)) {
      const p = NV.mundo.proyectar(n);
      const el = v.el;
      if (!p || !p.visible) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; continue; }
      const esFoco = cam.enfocada === n;
      // Escala: en el mundo (pxm) o, si está enfocada, interpola hacia "ocupar la pantalla"
      const W = window.innerWidth, H = window.innerHeight;
      const zoomLocal = esFoco ? cam.zoom : 0;
      const anchoObjetivo = Math.min(W * 0.92, 1180), altoObjetivo = H * 0.86;
      // Lejos, el panel no puede desbordar la pantalla (en móvil la Mac quedaba de 608px en 390)
      const cap = Math.min(1, (W * 0.94) / Math.max(1, p.anchoPx));
      const anchoMundo = p.anchoPx * cap, altoMundo = p.altoPx * cap;
      const ancho = anchoMundo + (anchoObjetivo - anchoMundo) * zoomLocal;
      const alto = altoMundo + (altoObjetivo - altoMundo) * zoomLocal;
      const x = p.x + (W / 2 - p.x) * zoomLocal;
      const y = p.y + (H / 2 - p.y) * zoomLocal;
      el.style.width = ancho + 'px'; el.style.height = alto + 'px';
      el.style.transform = `translate(${(x - ancho / 2).toFixed(1)}px, ${(y - alto / 2).toFixed(1)}px)`;
      // Los paneles se apagan un poco cuando otro está enfocado
      const otroEnfocado = cam.enfocada && !esFoco;
      el.style.opacity = otroEnfocado ? String(1 - cam.zoom * 0.9) : '1';
      el.style.pointerEvents = (esFoco && cam.zoom > 0.85) || (!cam.enfocada) ? 'auto' : 'none';
      el.classList.toggle('est--foco', esFoco && cam.zoom > 0.85);
      el.classList.toggle('est--lejos', !esFoco);
      el.classList.toggle('est--mirando', cam.mirando === n && !cam.enfocada);
      // hooks de enfoque
      const ahora = esFoco && cam.zoom > 0.85;
      if (ahora !== v.enfocada) { v.enfocada = ahora; (ahora ? v.def.enfocar : v.def.desenfocar)?.(el, ctx()); }
      v.def.tick?.(el, ctx(), cam);
    }
  }

  NV.montarEstaciones = montar;
})();
