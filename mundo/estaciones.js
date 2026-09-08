/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones.js — paneles DOM pegados al mundo 3D.

   Cada estación (mac, partidas, mostrador) es un <section> HTML normal — con
   su buscador, su tablero, su índice — que se PROYECTA encima del 3D en la
   posición de su ancla. Cuando la mirada se acerca (zoom→1) el panel crece
   hasta ocupar la pantalla y recibe clics/scroll; lejos, es un cartel dentro
   de la escena que se ve chiquito y no se toca.

   Contrato de una estación:
     NV.estacion('partidas', {
       html()   → string con el interior del panel
       mount(el, ctx)         una vez, al crear
       enfocar(el, ctx)       cuando la cámara la enfoca (zoom>0.85)
       desenfocar(el, ctx)
       tick(el, ctx, cam)     opcional, por frame (barato)
       refrescar(el, ctx)     opcional: entraron datos nuevos (o pasó un minuto
                              y hay que repintar los "hace X"). Lo dispara el
                              evento nv:datos del cerebro; si el cerebro todavía
                              no lo emite, acá hay un respaldo cada 60 s.
     })

   Además vive acá NV.ui: los helpers de PRESENTACIÓN que comparten las
   estaciones (sello de hora, días al mínimo, links a Smiles). Son envoltorios
   finos sobre la API del cerebro (NV.sello, NV.diasMin, NV.pasajeros…): si el
   cerebro todavía no la expone, calculan lo mismo con lo que hay en
   NV.state para que ninguna pantalla se rompa mientras tanto.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});
  const defs = {}, vivas = {};

  NV.estacion = (nombre, def) => { defs[nombre] = def; };

  /* ═══════════════════════════════════════════════════════════════════════
     NV.ui — presentación compartida
     ═══════════════════════════════════════════════════════════════════════ */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* "2027-05-12" → "12 May". El formato lo define el cerebro (NV.fechaCorta):
     acá solo está el respaldo por si todavía no lo expone. */
  function fechaCorta(iso) {
    if (typeof NV.fechaCorta === 'function') { try { return NV.fechaCorta(iso); } catch (e) { /* respaldo */ } }
    if (!iso || typeof iso !== 'string') return '';
    const p = iso.split('-'); if (p.length < 3) return iso;
    const y = +p[0], m = +p[1], d = +p[2];
    if (!(m >= 1 && m <= 12)) return iso;
    const mismoAnio = y === new Date().getFullYear();
    return d + ' ' + MESES[m - 1] + (mismoAnio ? '' : ' ' + String(y).slice(2));
  }
  const hhmm = iso => { try { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } };
  const haceTxt = iso => { try { return NV.haceCuanto ? NV.haceCuanto(iso) : ''; } catch (e) { return ''; } };

  /* Sello de hora de una fuente. Preferimos el del cerebro (NV.sello, que sabe
     de g_ida/g_vta por destino-mes); si no está todavía, lo armamos con el
     "generado" del archivo. Forma: {iso, horas, hace, nivel, txt}. */
  function sello(fuente) {
    if (typeof NV.sello === 'function') {
      try { const s = NV.sello(fuente); if (s && s.iso) return s; } catch (e) { /* seguimos con el respaldo */ }
    }
    const iso = fuente === 'buscador'
      ? (NV.state && NV.state.busqueda && NV.state.busqueda.generado)
      : (NV.state && NV.state.latest && NV.state.latest.generado);
    return selloDe(iso);
  }
  function selloDe(iso) {
    if (!iso) return { iso: null, horas: null, hace: '', nivel: 'muy_viejo', txt: 'sin datos todavía' };
    const horas = (Date.now() - new Date(iso).getTime()) / 36e5;
    const nivel = horas < 3 ? 'fresco' : horas < 8 ? 'viejo' : 'muy_viejo';
    return { iso, horas, hace: haceTxt(iso), nivel, txt: 'datos de las ' + hhmm(iso) };
  }
  /* Sello de UNA ruta: cuándo se consultó ESA ruta (campo nuevo `consultado`). */
  function selloRuta(r) {
    if (typeof NV.selloRuta === 'function') {
      try { const s = NV.selloRuta(r); if (s && s.iso) return s; } catch (e) { /* respaldo */ }
    }
    return selloDe((r && r.consultado) || (NV.state && NV.state.latest && NV.state.latest.generado));
  }
  /* El chip visual: una píldora con la ETIQUETA de la fuente ("radar" /
     "buscador") y adentro el sello del cerebro. Usamos el markup de NV.selloHTML
     porque trae data-sello: así el latido de app.js (NV.refrescarSellos, una vez
     por minuto) reescribe el "hace X" también acá adentro, sin que la estación
     tenga que rearmarse. `fuente` es "radar" | "buscador" | un ISO suelto.    */
  function selloHTML(fuente, etiqueta) {
    const cabeza = '<span class="nv-sello">' + (etiqueta ? '<i>' + esc(etiqueta) + '</i>' : '');
    if (typeof NV.selloHTML === 'function') {
      try { return cabeza + NV.selloHTML(fuente) + '</span>'; } catch (e) { /* respaldo */ }
    }
    const s = (fuente === 'radar' || fuente === 'buscador') ? sello(fuente) : selloDe(fuente);
    const nivel = s.nivel || 'fresco';
    const cola = s.hace ? ' · ' + s.hace : '';
    return cabeza + '<span class="sello sello--' + esc(nivel) + '">🕒 ' + esc(s.txt || '') + esc(cola) + '</span></span>';
  }

  /* TODAS las fechas al precio mínimo de un resultado del radar. Es la causa #1
     del diagnóstico: el motor publicaba un solo mejor_fecha y Smiles rota cuál
     de los días empatados está al mínimo (21 de 33 rutas tienen más de uno). */
  function diasMin(r) {
    if (!r) return [];
    if (typeof NV.diasMin === 'function') {
      try { const a = NV.diasMin(r); if (Array.isArray(a) && a.length) return a; } catch (e) { /* respaldo */ }
    }
    if (Array.isArray(r.dias_min) && r.dias_min.length) return r.dias_min.slice().sort();
    const dias = Array.isArray(r.dias) ? r.dias : [];
    let min = null;
    for (const d of dias) if (d && d.miles != null && (min == null || d.miles < min)) min = d.miles;
    if (min == null) return r.mejor_fecha ? [r.mejor_fecha] : [];
    return dias.filter(d => d && d.miles === min).map(d => d.date).filter(Boolean).sort();
  }

  /* Nacho viaja con la familia: los deep links salen con los pasajeros reales. */
  function pasajeros() {
    if (typeof NV.pasajeros === 'function') {
      try { const p = NV.pasajeros(); if (p) return p; } catch (e) { /* respaldo */ }
    }
    const c = (NV.state && NV.state.config && NV.state.config.pasajeros) || null;
    return { adultos: (c && c.adultos) || 1, ninos: (c && c.ninos) || 0, bebes: (c && c.bebes) || 0 };
  }

  /* Link de una sola pierna para UN día puntual. smilesOneWayURL ya sale con
     los pasajeros de config (Nacho viaja con las dos nenas). */
  function unaVia(orig, code, iso, moneda) {
    try { if (NV.smilesOneWayURL) return NV.smilesOneWayURL(orig, code, iso, moneda) || ''; } catch (e) { /* nada */ }
    return '';
  }

  /* Los chips de días con link. Para un resultado del radar usamos los del
     cerebro tal cual (NV.diasMinChips): mismo formato, misma clase .diamin y
     los mismos links en toda la app. Para las vueltas —que salen de
     busqueda.json y van del destino al origen— armamos los mismos chips a mano. */
  function diasChips(r, dias) {
    const d = dias || diasMin(r);
    if (typeof NV.diasMinChips === 'function' && r && r.origen && r.aeropuerto) {
      try { return NV.diasMinChips(r, d); } catch (e) { /* respaldo */ }
    }
    return chipsSueltos(d, (r && r.origen) || '', (r && r.aeropuerto) || '', r && r.moneda);
  }
  function chipsSueltos(dias, orig, code, moneda) {
    return (dias || []).map(f => {
      // smilesOneWayURL devuelve '' si falta la fecha o el aeropuerto. Un
      // href="" recarga la app entera de un toque: mejor un chip sin link.
      const url = unaVia(orig, code, f, moneda);
      if (!url || url === '#') return '<span class="diamin diamin--muerto">' + esc(fechaCorta(f)) + '</span>';
      return '<a class="diamin" href="' + esc(url) + '" target="_blank" rel="noopener"'
        + ' title="Verificar ' + esc(fechaCorta(f)) + ' en Smiles">' + esc(fechaCorta(f)) + '<span>↗</span></a>';
    }).join('');
  }

  NV.ui = { esc, fechaCorta, sello, selloDe, selloRuta, selloHTML, diasMin, diasChips, chipsSueltos, pasajeros, unaVia };

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
        // Celular acostado (alto < 520): con el 88% del alto el panel llegaba
        // hasta y=23 y la brújula, que ahí no puede irse abajo, le caía encima.
        const maxAlto = base.H * (base.H < 520 ? 0.74 : 0.88);
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

  /* ── "Entraron datos nuevos" ────────────────────────────────────────────
     El cerebro dispara nv:datos cuando repesca meta.json y también una vez por
     minuto para que los "hace X" no queden congelados (antes se calculaban una
     sola vez al cargar y ahí quedaban toda la sesión). Cada estación decide en
     su refrescar() si le alcanza con repintar el sello o si tiene que rearmar
     las filas. El setInterval es el respaldo por si el cerebro todavía no
     emite el evento: sin él las horas volverían a congelarse.               */
  let ultimoAviso = 0;
  function avisar(porEvento) {
    if (!porEvento && Date.now() - ultimoAviso < 45000) return;   // el respaldo no pisa al evento
    ultimoAviso = Date.now();
    const c = ctx();
    for (const v of Object.values(vivas)) {
      try { v.def.refrescar?.(v.el, c); } catch (e) { /* una estación rota no apaga a las otras */ }
    }
  }
  NV.avisarEstaciones = () => avisar(true);

  NV.montarEstaciones = () => {
    montar();
    window.addEventListener('nv:datos', () => avisar(true));
    setInterval(() => avisar(false), 60000);
  };
})();
