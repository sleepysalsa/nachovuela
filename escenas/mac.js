/* ============================================================================
   NachoVuela · escena "mac"
   ----------------------------------------------------------------------------
   Sos la MacBook Air apoyada en el regazo de Nacho. Primera persona: abajo se
   insinúan las piernas, arriba la notebook en CSS 3D real (base + tapa que gira
   sobre la bisagra). Cuando la tapa se abre, la pantalla enciende y adentro vive
   un buscador de verdad: destino, mes, noches, y las mejores combinaciones
   ida+vuelta calculadas por el cerebro de la app (NV.calcularCombos).

   Tiempo de la escena (p = 0..1):
     0.00–0.30  entra en cuadro desde abajo, tapa cerrada
     0.30–0.55  se abre la tapa y la pantalla enciende
     0.55–0.80  abierta y usable (clase .mac--usable en la raíz)
     0.80–1.00  se cierra y baja
   ========================================================================== */
(function () {
  'use strict';

  const NV = window.NV;
  if (!NV || typeof NV.escena !== 'function') return;

  /* ---- Ancho lógico del "monitor": el UI se diseña acá y se escala ------- */
  const LOGW = 760;

  const MESES = (NV.MONTHS && NV.MONTHS.length)
    ? NV.MONTHS
    : ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  /* ---- Formato (todo blindado: los datos pueden faltar) ----------------- */
  const txt = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const dia = iso => {
    if (!iso) return '—';
    const p = String(iso).split('-');
    const m = +p[1], d = +p[2];
    return (d || '?') + ' ' + (MESES[m - 1] || '');
  };
  const mil = n => { try { return NV.fmtMiles(n); } catch (e) { return n == null ? '—' : String(n); } };
  const usd = v => { try { return NV.fmtUSD(v); } catch (e) { return '—'; } };
  const yml = m => { try { return NV.ymLabel(m); } catch (e) { return m || ''; } };

  /* ---- Teclado: pesos de ancho de cada tecla, fila por fila -------------- */
  const FILAS = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.62],
    [1.55, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.07],
    [1.85, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.92],
    [2.42, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.42],
    [1, 1, 1.22, 1.22, 6.5, 1.22, 1.22, 1, 1]
  ];

  /* ---- Referencias del DOM (se llenan en mount) -------------------------- */
  let CTX = null, raiz = null, rig = null, nb = null, lomo = null, tapa = null,
      scr = null, ui = null, flash = null, luzLap = null, luzDeck = null, pista = null,
      selD = null, selM = null, inpA = null, inpB = null, cajaRes = null, cajaMeta = null,
      formu = null;

  let escala = 1, altoEsc = 720, usable = null;
  let ultimos = [];                       // combos mostrados (para el click)
  let busq = { dest: null, mes: null };   // sobre qué se buscó lo que se ve
  let ini = { dest: null, mes: null };    // preselección calculada en html()
  let pedido = 0;

  /* ========================= DATOS ======================================== */
  function bDest() {
    try { return NV.bDestinos() || {}; } catch (e) { return {}; }
  }
  function mesesDe(k) {
    const d = bDest()[k];
    return Object.keys((d && d.meses) || {}).sort();
  }
  function origenDe(k) {
    const d = bDest()[k];
    return (d && d.origen) || (NV.state && NV.state.busqueda && NV.state.busqueda.origen_default) || 'EZE';
  }

  /* El cálculo real: se setea el finder del cerebro y se le pide combinar. */
  function combinar(dest, mes, nMin, nMax) {
    if (!dest || !mes || typeof NV.calcularCombos !== 'function') return [];
    try {
      NV.state.finder = {
        dest: dest,
        orig: origenDe(dest),
        mes: mes,
        nMin: nMin,
        nMax: nMax,
        esc: 'todos',
        diaIda: null
      };
      return NV.calcularCombos() || [];
    } catch (e) { return []; }
  }

  /* Preselección: el primer destino/mes que devuelva algo para ver */
  function elegirInicial(nMin, nMax) {
    const D = bDest();
    const keys = Object.keys(D);
    if (!keys.length) return { dest: null, mes: null };
    for (const k of keys) {
      for (const m of mesesDe(k)) {
        if (combinar(k, m, nMin, nMax).length) return { dest: k, mes: m };
      }
    }
    return { dest: keys[0], mes: mesesDe(keys[0])[0] || null };
  }

  /* ========================= MARKUP ======================================= */
  function teclasHTML() {
    return FILAS.map((f, i) =>
      '<div class="mac-krow' + (i === 0 ? ' mac-krow--fn' : '') + '">' +
      f.map(w => '<i class="mac-key" style="flex:' + w + '"></i>').join('') +
      '</div>'
    ).join('');
  }

  function optDest(sel) {
    const D = bDest();
    const keys = Object.keys(D);
    if (!keys.length) return '<option value="">sin destinos</option>';
    return keys.map(k => {
      const d = D[k] || {};
      return '<option value="' + txt(k) + '"' + (k === sel ? ' selected' : '') + '>' +
        txt((d.emoji ? d.emoji + ' ' : '') + (d.nombre || k)) + '</option>';
    }).join('');
  }

  function optMes(dest, sel) {
    const ms = mesesDe(dest);
    if (!ms.length) return '<option value="">sin meses</option>';
    return ms.map(m =>
      '<option value="' + txt(m) + '"' + (m === sel ? ' selected' : '') + '>' + txt(yml(m)) + '</option>'
    ).join('');
  }

  function estadoTxt() {
    const L = NV.state && NV.state.latest;
    if (!L) return 'radar en frío';
    let c = '';
    try { c = NV.haceCuanto(L.generado); } catch (e) { c = ''; }
    return 'radar · ' + (c || 'al día');
  }

  /* ========================= RESULTADOS =================================== */
  function vacioHTML(tipo, dest, mes) {
    if (tipo === 'sin-datos') {
      return '<div class="mac-vacio">' +
        '<div class="mac-vacio__ic">✈</div>' +
        '<b>El radar todavía no cargó destinos</b>' +
        '<p>Cuando el motor termine el próximo rastrillaje, acá van a aparecer los meses ' +
        'con asientos y las combinaciones de ida y vuelta.</p></div>';
    }
    const D = bDest()[dest] || {};
    return '<div class="mac-vacio">' +
      '<div class="mac-vacio__ic">◇</div>' +
      '<b>Nada cierra con ese rango de noches</b>' +
      '<p>Para <em>' + txt(D.nombre || dest || 'ese destino') + '</em> en ' + txt(yml(mes)) +
      ' hay días sueltos, pero ninguna vuelta cae dentro de las noches pedidas. ' +
      'Ampliá el rango o probá otro mes: Smiles libera asientos de a poco y el radar mira dos veces por día.</p>' +
      '</div>';
  }

  function filasHTML(lista) {
    return lista.map((c, i) => {
      const ida = c.ida || {}, vta = c.vuelta || {};
      return '<button type="button" class="mac-fila' + (i === 0 ? ' mac-fila--top' : '') + '" data-i="' + i + '">' +
        '<span class="mac-fila__cod">' + txt(c.code) +
          (c.viaGol ? '<i class="mac-tag">gol</i>' : '') + '</span>' +
        '<span class="mac-fila__fx"><b>' + dia(ida.d) + '</b><i>→</i><b>' + dia(vta.d) + '</b></span>' +
        '<span class="mac-fila__n">' + (c.noches != null ? c.noches : '—') + ' noches</span>' +
        '<span class="mac-fila__mi">' + mil(c.total) + '<small>mi</small></span>' +
        '<span class="mac-fila__go">armar ↗</span>' +
      '</button>';
    }).join('');
  }

  function buscar() {
    if (!cajaRes || !cajaMeta) return;
    const dest = selD && selD.value;
    const mes = selM && selM.value;

    let a = parseInt(inpA && inpA.value, 10); if (!(a > 0)) a = 1;
    let b = parseInt(inpB && inpB.value, 10); if (!(b > 0)) b = a;
    const nMin = Math.min(a, b), nMax = Math.max(a, b);

    if (!Object.keys(bDest()).length) {
      ultimos = [];
      cajaMeta.innerHTML = '';
      cajaRes.innerHTML = vacioHTML('sin-datos');
      return;
    }

    const todos = combinar(dest, mes, nMin, nMax);
    busq = { dest: dest, mes: mes };
    ultimos = todos.slice(0, 5);

    if (!ultimos.length) {
      cajaMeta.innerHTML = '<span>' + txt(yml(mes)) + '</span><span>' + nMin + '–' + nMax + ' noches</span>';
      cajaRes.innerHTML = vacioHTML('sin-combos', dest, mes);
      return;
    }

    let vm = 0.012; try { vm = NV.valorMilla() || 0.012; } catch (e) {}
    const mejor = ultimos[0].total || 0;
    const D = bDest()[dest] || {};

    cajaMeta.innerHTML =
      '<span><b>' + todos.length + '</b> ' + (todos.length === 1 ? 'combinación' : 'combinaciones') + '</span>' +
      '<span>desde <b>' + mil(mejor) + '</b> millas</span>' +
      '<span>≈ ' + usd(mejor * vm) + ' de reposición</span>' +
      '<span class="mac-meta__ym">' + txt(origenDe(dest)) + ' → ' + txt(D.nombre || dest) +
        ' · ' + txt(yml(mes)) + '</span>';

    cajaRes.innerHTML = filasHTML(ultimos);
  }

  /* ========================= MEDIDAS ====================================== */
  /* Se corre en mount / enter / resize — nunca dentro de update(). */
  function ajustar() {
    if (!scr || !ui) return;
    const w = scr.clientWidth, h = scr.clientHeight;
    if (w > 0 && h > 0) {
      escala = w / LOGW;
      ui.style.width = LOGW + 'px';
      ui.style.height = (h / escala).toFixed(1) + 'px';
      ui.style.transform = 'scale(' + escala.toFixed(4) + ')';
    }
    if (raiz && raiz.clientHeight) altoEsc = raiz.clientHeight;
  }
  function pedirAjuste() {
    if (pedido) return;
    pedido = requestAnimationFrame(() => { pedido = 0; ajustar(); });
  }

  /* ========================= ESCENA ======================================= */
  NV.escena('mac', {

    html(ctx) {
      const f = (NV.state && NV.state.finder) || {};
      const nMin = f.nMin > 0 ? f.nMin : 10;
      const nMax = f.nMax > 0 ? f.nMax : 20;
      ini = elegirInicial(nMin, nMax);

      return '' +
      /* --- el regazo: piernas en perspectiva, apenas insinuadas --- */
      '<div class="mac-regazo" aria-hidden="true">' +
        '<div class="mac-pierna mac-pierna--i"></div>' +
        '<div class="mac-pierna mac-pierna--d"></div>' +
        '<div class="mac-regazo__luz"></div>' +
      '</div>' +

      /* --- la notebook --- */
      '<div class="mac-rig">' +
        '<div class="mac-nb">' +
          '<div class="mac-sombra" aria-hidden="true"></div>' +

          '<div class="mac-base" aria-hidden="true">' +
            '<div class="mac-rejilla mac-rejilla--i"></div>' +
            '<div class="mac-rejilla mac-rejilla--d"></div>' +
            '<div class="mac-teclado">' + teclasHTML() + '</div>' +
            '<div class="mac-trackpad"></div>' +
            '<div class="mac-muesca"></div>' +
            '<div class="mac-deckluz"></div>' +
            '<div class="mac-canto"></div>' +
          '</div>' +

          '<div class="mac-lomo" aria-hidden="true"></div>' +

          '<div class="mac-tapa">' +
            '<div class="mac-tapa__dorso" aria-hidden="true">' +
              '<span class="mac-marca">Nacho<em>Vuela</em></span>' +
            '</div>' +
            '<div class="mac-tapa__cara">' +
              '<div class="mac-camara" aria-hidden="true"></div>' +
              '<div class="mac-scr">' +

                '<div class="mac-scr__ui">' +
                  '<div class="mac-top">' +
                    '<span class="mac-top__marca">Nacho<em>Vuela</em></span>' +
                    '<span class="mac-top__tag">buscador ida + vuelta</span>' +
                    '<span class="mac-top__estado"><i></i>' + txt(estadoTxt()) + '</span>' +
                  '</div>' +

                  '<div class="mac-cuerpo">' +
                    '<form class="mac-form" novalidate>' +
                      '<label class="mac-campo"><span>destino</span>' +
                        '<select class="mac-sel" data-mac="dest">' + optDest(ini.dest) + '</select>' +
                      '</label>' +
                      '<label class="mac-campo"><span>mes</span>' +
                        '<select class="mac-sel" data-mac="mes">' + optMes(ini.dest, ini.mes) + '</select>' +
                      '</label>' +
                      '<label class="mac-campo"><span>noches mín</span>' +
                        '<input class="mac-num" type="number" inputmode="numeric" min="1" max="120" ' +
                          'data-mac="nmin" value="' + nMin + '">' +
                      '</label>' +
                      '<label class="mac-campo"><span>noches máx</span>' +
                        '<input class="mac-num" type="number" inputmode="numeric" min="1" max="120" ' +
                          'data-mac="nmax" value="' + nMax + '">' +
                      '</label>' +
                      '<button class="mac-btn" type="submit">Buscar combinaciones <span>✈</span></button>' +
                    '</form>' +

                    '<div class="mac-meta" data-mac="meta"></div>' +
                    '<div class="mac-res" data-mac="res"></div>' +
                  '</div>' +
                '</div>' +

                '<div class="mac-scr__flash" aria-hidden="true"></div>' +
                '<div class="mac-scr__vidrio" aria-hidden="true"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="pista-txt mac-pista">elegí destino y mes · buscá la combinación</div>';
    },

    mount(el, ctx) {
      CTX = ctx;
      raiz = el;
      const q = s => el.querySelector(s);

      rig     = q('.mac-rig');
      nb      = q('.mac-nb');
      lomo    = q('.mac-lomo');
      tapa    = q('.mac-tapa');
      scr     = q('.mac-scr');
      ui      = q('.mac-scr__ui');
      flash   = q('.mac-scr__flash');
      luzLap  = q('.mac-regazo__luz');
      luzDeck = q('.mac-deckluz');
      pista   = q('.mac-pista');

      formu    = q('.mac-form');
      selD     = q('[data-mac="dest"]');
      selM     = q('[data-mac="mes"]');
      inpA     = q('[data-mac="nmin"]');
      inpB     = q('[data-mac="nmax"]');
      cajaMeta = q('[data-mac="meta"]');
      cajaRes  = q('[data-mac="res"]');

      if (selD) selD.addEventListener('change', () => {
        if (selM) selM.innerHTML = optMes(selD.value, null);
        buscar();
      });
      if (selM) selM.addEventListener('change', buscar);
      if (formu) formu.addEventListener('submit', e => { e.preventDefault(); buscar(); });

      /* delegación: cada fila abre el Armador con esa combinación */
      if (cajaRes) cajaRes.addEventListener('click', e => {
        const b = e.target && e.target.closest ? e.target.closest('.mac-fila') : null;
        if (!b) return;
        const c = ultimos[+b.dataset.i];
        if (!c || !busq.dest || !busq.mes) return;
        try {
          CTX.abrirArmador(busq.dest, busq.mes, c.code,
            (c.ida || {}).d, (c.vuelta || {}).d);
        } catch (err) { /* si el armador no puede abrir, no rompemos la escena */ }
      });

      ajustar();
      buscar();
      window.addEventListener('resize', pedirAjuste, { passive: true });
    },

    enter() { ajustar(); },

    exit() {
      if (raiz && usable) { raiz.classList.remove('mac--usable'); usable = false; }
    },

    /* --------- 60fps: sólo transform / opacity, nada de DOM ni layout ----- */
    update(p, ctx) {
      if (!nb) return;
      const U = ctx.U;

      const ent  = U.easeOut(U.tramo(p, 0.00, 0.30));   // entra en cuadro
      const abre = U.ease(U.tramo(p, 0.30, 0.55));      // se abre la tapa
      const cie  = U.ease(U.tramo(p, 0.80, 0.93));      // se cierra
      const baja = U.easeIn(U.tramo(p, 0.86, 1.00));    // se va

      const lid = -90 + 90 * abre - 90 * cie;           // -90 (cerrada) → 0 (abierta)
      const y   = altoEsc * (0.62 * (1 - ent) + 0.34 * baja);
      const s   = (0.88 + 0.12 * ent) * (1 - 0.10 * baja);
      const cam = -27 + 14 * ent;                       // la cámara se acomoda al regazo

      nb.style.transform =
        'translateY(' + y.toFixed(1) + 'px) scale(' + s.toFixed(4) + ') rotateX(' + cam.toFixed(2) + 'deg)';
      tapa.style.transform = 'rotateX(' + lid.toFixed(2) + 'deg)';
      /* la bisagra abre a mitad de camino: se ve el codo del aluminio */
      lomo.style.transform = 'rotateX(' + (-90 + (lid + 90) * 0.55).toFixed(2) + 'deg)';
      rig.style.opacity = (U.tramo(p, 0, 0.06) * (1 - U.tramo(p, 0.90, 1.00))).toFixed(3);

      /* encendido de la pantalla: negra → destello → interfaz */
      const enc = U.tramo(p, 0.375, 0.50) * (1 - U.tramo(p, 0.795, 0.855));
      const t   = U.tramo(p, 0.345, 0.47);
      const fl  = (t <= 0 || t >= 1) ? 0 : Math.pow(Math.sin(t * Math.PI), 3);

      ui.style.opacity      = enc.toFixed(3);
      flash.style.opacity   = (fl * 0.9).toFixed(3);
      luzDeck.style.opacity = (enc * 0.95).toFixed(3);
      luzLap.style.opacity  = (enc * 0.85).toFixed(3);
      pista.style.opacity   = (U.tramo(p, 0.52, 0.60) * (1 - U.tramo(p, 0.74, 0.80))).toFixed(3);

      /* ventana usable: el CSS habilita los clics dentro de la pantalla */
      const us = (p > 0.50 && p < 0.85);
      if (us !== usable) { usable = us; raiz.classList.toggle('mac--usable', us); }
    }
  });
})();
