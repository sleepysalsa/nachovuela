/* ============================================================================
   NachoVuela · escena "revista"
   ----------------------------------------------------------------------------
   El último gesto del relato: Nacho saca la revista de a bordo del bolsillo del
   asiento. Se abre en el aire y el scroll pasa las páginas, una por una.

   Cómo está armada:
     · La revista son N HOJAS apiladas sobre el lomo (left:50%, origen izquierdo).
       Cada hoja tiene dos caras: frente (página derecha) y dorso (página
       izquierda del pliego siguiente). backface-visibility esconde la de atrás.
     · El apilado en 3D no usa z-index: cada hoja lleva `rotateY(a) translateZ(z)`.
       Con la hoja sin girar, translateZ la empuja hacia el ojo (queda arriba en
       la pila derecha); girada 180°, su eje Z apunta al revés y la misma hoja se
       hunde (queda abajo en la pila izquierda). El orden sale solo, gratis.
     · update() reparte el progreso p entre las hojas y sólo escribe dos custom
       properties (--a y --t) en las hojas que efectivamente cambiaron. Las
       sombras, el barrido de luz y el papel leen --t por herencia desde el CSS.
     · CULLING: sólo las hojas a ±2 del pliego activo se pintan y reciben
       estilos; el resto va visibility:hidden sin una sola escritura. El
       will-change:transform se pone y saca por clase, sólo en las que giran.
       Nada de lecturas de layout acá adentro: update() es sólo escritura.

   El índice:
     tapa → un pliego por destino con datos → pliegos de noticias → "buen viaje".
   ========================================================================== */
(function () {
  'use strict';

  const NV = window.NV;
  if (!NV || typeof NV.escena !== 'function') return;

  /* ---------- texto y formato -------------------------------------------- */

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESCAPES[c]);

  const MESES = (NV.MONTHS && NV.MONTHS.length === 12)
    ? NV.MONTHS
    : ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const MESES_L = (NV.MONTHS_LONG && NV.MONTHS_LONG.length === 12)
    ? NV.MONTHS_LONG
    : ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
       'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_HOY = new Date().getMonth() + 1;

  const REGION = {
    eeuu: 'Estados Unidos', europa: 'Europa', sudamerica: 'Sudamérica',
    cabotaje: 'Argentina', caribe: 'Caribe', asia: 'Asia', oceania: 'Oceanía',
  };
  const NIVEL = {
    oportunidad: 'oportunidad', bueno: 'buen precio',
    normal: 'precio normal', caro: 'caro',
  };

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const miles = n => (n == null ? '—' : (NV.fmtMiles ? NV.fmtMiles(n) : String(n)));
  const fecha = iso => {
    if (!iso) return '';
    try { return NV.dateLabel ? NV.dateLabel(iso) : iso; } catch (e) { return iso; }
  };
  const hace = iso => {
    if (!iso) return '';
    try { return NV.haceCuanto ? NV.haceCuanto(iso) : ''; } catch (e) { return ''; }
  };

  /* Frío azul → templado verde → calor ámbar → sofoco rojo.
     La curva (u^.72) hace que el calor llegue antes al ámbar: si fuera lineal,
     casi todos los destinos caerían en la misma franja verde-amarilla. */
  function colorTemp(t) {
    const u = clamp01((t + 6) / 42);
    const w = Math.pow(u, 0.72);
    const h = 208 - w * 200;
    const s = 48 + w * 24;
    const l = 44 + Math.sin(u * Math.PI) * 8;
    return 'hsl(' + h.toFixed(0) + ' ' + s.toFixed(0) + '% ' + l.toFixed(0) + '%)';
  }

  /* ---------- lectura de datos (todo tolerante a huecos) ------------------ */

  function mejorDe(resultados, k) {
    let best = null;
    for (let i = 0; i < resultados.length; i++) {
      const r = resultados[i];
      if (!r || r.destino_key !== k || r.mejor_precio_millas == null) continue;
      if (!best || r.mejor_precio_millas < best.mejor_precio_millas) best = r;
    }
    return best;
  }

  /* Destinos que merecen pliego: los que tienen precio rastreado o clima. */
  function sumario(ctx) {
    const D = ctx.destinos || {};
    const R = ctx.resultados || [];
    const CL = (ctx.datos && ctx.datos.clima && ctx.datos.clima.destinos) || {};
    const lista = [];
    for (const k of Object.keys(D)) {
      const d = D[k];
      if (!d) continue;
      const best = mejorDe(R, k);
      const meses = (CL[k] && Array.isArray(CL[k].meses)) ? CL[k].meses : [];
      if (!best && !meses.length) continue;
      lista.push({ k: k, d: d, best: best, meses: meses });
    }
    /* Primero lo que el radar encontró, de más barato a más caro. */
    lista.sort((a, b) => {
      if (!!a.best !== !!b.best) return a.best ? -1 : 1;
      if (a.best && b.best) return a.best.mejor_precio_millas - b.best.mejor_precio_millas;
      return String(a.d.nombre || '').localeCompare(String(b.d.nombre || ''));
    });
    return lista;
  }

  /* El tip del mes: el de hoy; si no hay, el del mes del mejor precio; si no, cualquiera. */
  function tipDe(d, mesBest) {
    const tips = d && d.tips;
    if (!tips) return null;
    const orden = [MES_HOY];
    if (mesBest) orden.push(mesBest);
    for (let m = 1; m <= 12; m++) orden.push(m);
    for (const m of orden) {
      const txt = tips[String(m)];
      if (txt) return { mes: m, txt: txt };
    }
    return null;
  }

  /* ---------- ladrillos de página ---------------------------------------- */

  function cabecera(izqTxt, derTxt) {
    return '<header class="revista-cab">'
      + '<span>' + esc(izqTxt) + '</span>'
      + '<span>' + esc(derTxt) + '</span>'
      + '</header>';
  }

  function climaHTML(meses) {
    if (!meses || !meses.length) {
      return '<section class="revista-bloque revista-clima">'
        + '<h3 class="revista-h3">El clima<em>durante el año</em></h3>'
        + '<p class="revista-nota">Sin registro climático para este destino.</p>'
        + '</section>';
    }
    const porMes = {};
    for (const m of meses) {
      if (!m || m.mes == null || m.t_media == null) continue;
      const t = Number(m.t_media);
      const mes = Number(m.mes);
      if (!isFinite(t) || !(mes >= 1 && mes <= 12)) continue;   // nada de NaN en el CSS
      porMes[mes] = t;
    }
    let cols = '';
    let picoT = -99, picoM = 1;
    for (let m = 1; m <= 12; m++) {
      const t = porMes[m];                 // ya validada: número o nada
      const hoy = m === MES_HOY ? ' is-hoy' : '';
      if (t == null) {
        cols += '<li class="revista-clima__col is-vacio' + hoy + '">'
          + '<span class="revista-clima__t">·</span>'
          + '<span class="revista-clima__pista"><i style="height:6%"></i></span>'
          + '<span class="revista-clima__m">' + esc(MESES[m - 1].charAt(0)) + '</span>'
          + '</li>';
        continue;
      }
      if (t > picoT) { picoT = t; picoM = m; }
      const h = (8 + clamp01((t + 8) / 44) * 92).toFixed(1);
      cols += '<li class="revista-clima__col' + hoy + '" title="'
        + esc(MESES_L[m - 1]) + ': ' + t.toFixed(1) + '°C de media">'
        + '<span class="revista-clima__t">' + Math.round(t) + '</span>'
        + '<span class="revista-clima__pista"><i style="height:' + h + '%;background:'
        + colorTemp(t) + '"></i></span>'
        + '<span class="revista-clima__m">' + esc(MESES[m - 1].charAt(0)) + '</span>'
        + '</li>';
    }
    /* Si ningún mes trajo temperatura, no inventamos un pico. */
    const pie = picoT > -99
      ? '<p class="revista-clima__pie">pico en <b>' + esc(MESES_L[picoM - 1]) + '</b>'
        + ' · la columna marcada es el mes de hoy</p>'
      : '<p class="revista-clima__pie">registro incompleto</p>';
    return '<section class="revista-bloque revista-clima">'
      + '<h3 class="revista-h3">El clima<em>°C de media, mes a mes</em></h3>'
      + '<ol class="revista-clima__grilla">' + cols + '</ol>'
      + pie
      + '</section>';
  }

  function tipHTML(tip) {
    if (!tip) return '';
    const et = tip.mes === MES_HOY
      ? 'el tip de este mes'
      : 'el tip de ' + MESES_L[tip.mes - 1];
    return '<section class="revista-bloque revista-tip">'
      + '<span class="revista-tip__et">' + esc(et) + '</span>'
      + '<p class="revista-tip__txt">' + esc(tip.txt) + '</p>'
      + '</section>';
  }

  function aerolineasHTML(aero) {
    const A = Array.isArray(aero) ? aero.filter(a => a && a.n) : [];
    if (!A.length) return '';
    const top = A.slice(0, 5);
    let filas = '';
    for (const a of top) {
      filas += '<li><b>' + esc(a.n) + '</b><span>' + esc(a.v || '') + '</span></li>';
    }
    const resto = A.length - top.length;
    return '<section class="revista-bloque revista-aero">'
      + '<h3 class="revista-h3">Quién vuela<em>la ruta</em></h3>'
      + '<ul class="revista-aero__lista">' + filas + '</ul>'
      + (resto > 0 ? '<p class="revista-nota">y ' + resto + ' más</p>' : '')
      + '</section>';
  }

  function precioHTML(best) {
    if (!best) {
      return '<div class="revista-precio revista-precio--vacio">'
        + '<span class="revista-precio__et">mejor precio detectado</span>'
        + '<p class="revista-nota">El radar todavía no rastreó esta ruta. '
        + 'Está en la lista, esperando turno.</p>'
        + '</div>';
    }
    const niv = NIVEL[best.nivel] || best.nivel || '';
    return '<div class="revista-precio">'
      + '<span class="revista-precio__et">mejor precio detectado</span>'
      + '<p class="revista-precio__n"><b>' + esc(miles(best.mejor_precio_millas)) + '</b>'
      + '<i>millas</i></p>'
      + '<p class="revista-precio__d">' + esc(best.origen || '') + ' → '
      + esc(best.aeropuerto || '') + ' · <b>' + esc(fecha(best.mejor_fecha)) + '</b></p>'
      + (niv ? '<span class="revista-nivel is-' + esc(best.nivel) + '">' + esc(niv) + '</span>' : '')
      + '</div>';
  }

  /* ---------- páginas ----------------------------------------------------- */

  function pagDestinoIzq(it, i, total) {
    const d = it.d;
    const codes = Array.isArray(d.aeropuertos) ? d.aeropuertos.filter(a => a && a.code) : [];
    let chips = '';
    for (const a of codes.slice(0, 5)) {
      chips += '<li><b>' + esc(a.code) + '</b><span>' + esc(a.ciudad || '') + '</span></li>';
    }
    const nn = String(i + 1).padStart(2, '0');
    return {
      sec: 'destinos',
      cuerpo: cabecera('destino ' + nn + ' / ' + String(total).padStart(2, '0'), 'guía de destinos')
        + '<div class="revista-dest">'
        + '<div class="revista-dest__marca">'
        + '<span class="revista-dest__emoji">' + esc(d.emoji || '✈') + '</span>'
        + '<span class="revista-dest__region">' + esc(REGION[d.region] || d.region || '') + '</span>'
        + '</div>'
        + '<h2 class="revista-dest__nombre">' + esc(d.nombre || it.k) + '</h2>'
        + '<p class="revista-dest__pais">' + esc(d.pais || '') + '</p>'
        + (chips ? '<ul class="revista-codes">' + chips + '</ul>' : '')
        + precioHTML(it.best)
        + '</div>',
    };
  }

  function pagDestinoDer(it) {
    const mesBest = it.best && it.best.ym ? +String(it.best.ym).slice(5, 7) : null;
    return {
      sec: 'destinos',
      cuerpo: cabecera(esc(it.d.nombre || it.k), 'ficha')
        + '<div class="revista-ficha">'
        + climaHTML(it.meses)
        + tipHTML(tipDe(it.d, mesBest))
        + aerolineasHTML(it.d.aerolineas)
        + '<button type="button" class="revista-btn" data-dest="' + esc(it.k) + '">'
        + 'ver ficha completa <i>→</i></button>'
        + '</div>',
    };
  }

  function recorteHTML(o, i) {
    const rot = ((i % 4) - 1.5) * 0.55;
    const cuando = hace(o.fecha);
    return '<li class="revista-recorte" style="--rot:' + rot.toFixed(2) + 'deg">'
      + '<a class="revista-recorte__a" href="' + esc(o.link || '#') + '"'
      + ' target="_blank" rel="noopener">'
      + '<span class="revista-recorte__fuente">' + esc(o.fuente || 'blog') + '</span>'
      + '<h3 class="revista-recorte__tit">' + esc(o.titulo || '') + '</h3>'
      + '<span class="revista-recorte__pie">' + esc(cuando) + '<i>↗</i></span>'
      + '</a></li>';
  }

  function paginasNoticias(ctx) {
    const posts = (ctx.ofertas || []).filter(o => o && o.titulo).slice(0, 11);
    const pags = [];

    /* Portada de sección */
    let portada = cabecera('noticias', 'la terminal')
      + '<div class="revista-seccion">'
      + '<span class="revista-seccion__et">sección</span>'
      + '<h2 class="revista-seccion__tit">Lo que se dice<em>en la terminal</em></h2>'
      + '<p class="revista-seccion__baj">Recortes frescos de los blogs que Nacho tiene fichados. '
      + 'Tocá cualquiera y se abre la nota.</p>';
    if (posts.length) {
      portada += '<ul class="revista-recortes">'
        + posts.slice(0, 3).map((o, i) => recorteHTML(o, i)).join('') + '</ul>';
    } else {
      portada += '<p class="revista-nota">Todavía no llegaron recortes nuevos. '
        + 'El radar sigue escuchando.</p>';
    }
    portada += '</div>';
    pags.push({ sec: 'noticias', cuerpo: portada });

    /* Páginas de recortes */
    const resto = posts.slice(3);
    for (let i = 0; i < resto.length; i += 4) {
      const grupo = resto.slice(i, i + 4);
      pags.push({
        sec: 'noticias',
        cuerpo: cabecera('lo que se dice', 'la terminal')
          + '<div class="revista-seccion revista-seccion--corrida">'
          + '<ul class="revista-recortes">'
          + grupo.map((o, j) => recorteHTML(o, i + j + 3)).join('')
          + '</ul></div>',
      });
    }

    /* Colofón: de dónde salen los recortes */
    const fuentes = [];
    for (const o of (ctx.ofertas || [])) {
      if (o && o.fuente && fuentes.indexOf(o.fuente) === -1) fuentes.push(o.fuente);
    }
    const gen = ctx.datos && ctx.datos.ofertas && ctx.datos.ofertas.generado;
    pags.push({
      sec: 'noticias',
      cuerpo: cabecera('colofón', 'la terminal')
        + '<div class="revista-colofon">'
        + '<h3 class="revista-h3">Las fuentes<em>que mira el radar</em></h3>'
        + (fuentes.length
          ? '<ul class="revista-fuentes">' + fuentes.map(f =>
              '<li>' + esc(f) + '</li>').join('') + '</ul>'
          : '<p class="revista-nota">Sin fuentes cargadas.</p>')
        + '<p class="revista-colofon__pie">'
        + (gen ? 'última recolección ' + esc(hace(gen)) : 'recolección continua')
        + '</p>'
        + '<div class="revista-colofon__sello">NV</div>'
        + '</div>',
    });

    if (pags.length % 2) {
      pags.push({
        sec: 'noticias',
        cuerpo: cabecera('anotaciones', 'la terminal')
          + '<div class="revista-notas">'
          + '<h3 class="revista-h3">Anotaciones<em>del pasajero</em></h3>'
          + '<div class="revista-notas__renglones"></div>'
          + '</div>',
      });
    }
    return pags;
  }

  function paginasVacias() {
    return [
      {
        sec: 'sin datos',
        cuerpo: cabecera('edición en blanco', 'nachovuela')
          + '<div class="revista-seccion">'
          + '<span class="revista-seccion__et">todavía</span>'
          + '<h2 class="revista-seccion__tit">Una revista<em>sin imprimir</em></h2>'
          + '<p class="revista-seccion__baj">El radar no trajo destinos ni recortes esta vez. '
          + 'Cuando corra el motor, estas páginas se llenan solas.</p>'
          + '</div>',
      },
      {
        sec: 'sin datos',
        cuerpo: cabecera('', 'nachovuela')
          + '<div class="revista-notas">'
          + '<div class="revista-notas__renglones"></div>'
          + '<p class="revista-nota">espacio reservado para el próximo viaje</p>'
          + '</div>',
      },
    ];
  }

  function tapaHTML(ctx, nDest, nOps) {
    const gen = (ctx.datos && ctx.datos.latest && ctx.datos.latest.generado) || null;
    let edicion = '';
    if (gen) {
      const dt = new Date(gen);
      if (!isNaN(dt)) edicion = MESES_L[dt.getMonth()] + ' ' + dt.getFullYear();
    }
    let barras = '';
    for (let i = 0; i < 26; i++) {
      barras += '<i style="width:' + (1 + (i * 7 % 3)) + 'px"></i>';
    }
    return '<div class="revista-tapa">'
      + '<header class="revista-tapa__marca">'
      + '<img src="assets/logo-mark.svg" alt="" width="40" height="40">'
      + '<span>Nacho<em>Vuela</em></span>'
      + '</header>'
      + '<span class="revista-tapa__et">revista de a bordo'
      + (edicion ? ' · ' + esc(edicion) : '') + '</span>'
      + '<h1 class="revista-tapa__tit">Guía de<em>destinos</em></h1>'
      + '<p class="revista-tapa__baj">'
      + (nDest ? '<b>' + nDest + '</b> destino' + (nDest === 1 ? '' : 's') + ' bajo la lupa' : 'el radar sigue mirando')
      + (nOps ? ' · <b>' + nOps + '</b> oportunidad' + (nOps === 1 ? '' : 'es') + ' abierta' + (nOps === 1 ? '' : 's') : '')
      + '</p>'
      + '<footer class="revista-tapa__pie">'
      + '<span>precios en millas · smiles</span>'
      + '<span class="revista-barras">' + barras + '</span>'
      + '</footer>'
      + '</div>';
  }

  function cierreHTML() {
    return '<div class="revista-cierre">'
      + '<span class="revista-cierre__et">fin de la edición</span>'
      + '<p class="revista-cierre__txt">buen viaje,<em>Nacho</em> <b>✈</b></p>'
      + '<span class="revista-cierre__linea"></span>'
      + '<p class="revista-cierre__pie">volvé cuando quieras: el radar no duerme</p>'
      + '</div>';
  }

  /* ---------- armado del objeto ------------------------------------------ */

  function envolver(pag, nro) {
    return '<div class="revista-pag">'
      + pag.cuerpo
      + '<div class="revista-folio"><b>' + nro + '</b><span>' + esc(pag.sec) + '</span></div>'
      + '</div>';
  }

  /* estado vivo de la escena (una sola instancia)
     t[]    = último valor ESCRITO en el DOM por hoja (cache anti-escrituras)
     tc[]   = valor computado este frame (matemática pura, sin DOM)
     off[]  = ¿la hoja está culled (visibility:hidden)?
     viva[] = ¿la hoja tiene will-change:transform puesto? */
  const S = {
    raiz: null, libro: null, hojas: [], frentes: [], dorsos: [],
    baseDer: null, cinta: null, ini: [], fin: [], t: [], tc: [], off: [], viva: [],
    vIzq: null, vDer: null, ultEnt: -1, ultAbrir: -1, ultCinta: -1,
  };

  /* Culling: sólo las hojas a ±VENTANA del pliego activo se pintan y reciben
     estilos. Las demás quedan visibility:hidden con CERO escrituras. */
  const VENTANA = 2;

  NV.escena('revista', {

    html(ctx) {
      const dests = sumario(ctx);
      const paginas = [];
      dests.forEach((it, i) => {
        paginas.push(pagDestinoIzq(it, i, dests.length));
        paginas.push(pagDestinoDer(it));
      });
      const noticias = paginasNoticias(ctx);
      for (const p of noticias) paginas.push(p);
      if (!paginas.length) {
        const v = paginasVacias();
        paginas.push(v[0], v[1]);
      }
      if (paginas.length % 2) paginas.push({ sec: '', cuerpo: '' });

      const pliegos = [];
      for (let i = 0; i < paginas.length; i += 2) {
        pliegos.push({
          izq: envolver(paginas[i], i + 2),
          der: envolver(paginas[i + 1], i + 3),
        });
      }

      const nOps = (ctx.resultados || []).filter(r => r && r.nivel === 'oportunidad').length;
      const nHojas = pliegos.length + 1;
      const paso = 0.62;                                   // grosor de cada hoja, en px
      const tope = (nHojas + 3) * paso;
      const zBase = (-tope).toFixed(2) + 'px';             // debajo de todo lo dado vuelta
      const zTop = (tope + 6).toFixed(2) + 'px';           // encima de toda la pila

      let hojas = '';
      for (let i = 0; i < nHojas; i++) {
        const frente = i === 0 ? tapaHTML(ctx, dests.length, nOps) : pliegos[i - 1].der;
        const dorso = i < pliegos.length ? pliegos[i].izq : cierreHTML();
        const zi = ((nHojas - i) * paso).toFixed(2) + 'px';
        hojas += '<div class="revista-hoja" style="--z:' + zi + '">'
          + '<div class="revista-cara revista-cara--frente'
          + (i === 0 ? ' revista-cara--tapa' : '') + '">'
          + frente
          + '<i class="revista-luz"></i><i class="revista-brillo"></i></div>'
          + '<div class="revista-cara revista-cara--dorso'
          + (i === nHojas - 1 ? ' revista-cara--fin' : '') + '">'
          + dorso
          + '<i class="revista-luz"></i><i class="revista-brillo"></i></div>'
          + '</div>';
      }

      return '<div class="revista-escena">'
        + '<div class="revista-lampara" aria-hidden="true"></div>'
        + '<div class="revista-sombra" aria-hidden="true"></div>'
        + '<div class="revista-libro">'
        + '<div class="revista-libro__in" style="--rv-zbase:' + zBase + ';--rv-ztop:' + zTop + '">'
        + '<div class="revista-base revista-base--izq" aria-hidden="true"></div>'
        + '<div class="revista-base revista-base--der">'
        + '<div class="revista-contra"><img src="assets/logo-mark.svg" alt="" width="34" height="34">'
        + '<span>NachoVuela</span><small>radar privado de vuelos</small></div>'
        + '</div>'
        + hojas
        + '<div class="revista-cinta" aria-hidden="true"></div>'
        + '</div></div>'
        + '<p class="revista-pie">seguí scrolleando · se pasan solas</p>'
        + '</div>';
    },

    mount(el, ctx) {
      S.raiz = el;
      S.libro = el.querySelector('.revista-libro');
      S.hojas = Array.prototype.slice.call(el.querySelectorAll('.revista-hoja'));
      S.frentes = S.hojas.map(h => h.querySelector('.revista-cara--frente'));
      S.dorsos = S.hojas.map(h => h.querySelector('.revista-cara--dorso'));
      S.baseDer = el.querySelector('.revista-base--der');
      S.cinta = el.querySelector('.revista-cinta');

      /* Reparto del progreso: la tapa y el cierre se toman su tiempo. */
      const n = S.hojas.length;
      /* SOLAPE chico a propósito: si las hojas se pisan mucho, nunca hay un
         momento en que el pliego esté quieto y los links no llegan a activarse. */
      const A = 0.055, B = 0.965, SOLAPE = 0.06;
      const peso = new Array(n).fill(1);
      if (n > 1) peso[0] = 1.8;
      if (n > 2) peso[n - 1] = 1.35;
      let total = 0;
      for (let i = 0; i < n; i++) total += peso[i];
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const a = A + (acc / total) * (B - A);
        acc += peso[i];
        const b = A + (acc / total) * (B - A);
        const ext = (b - a) * SOLAPE;
        S.ini[i] = Math.max(0, a - ext);
        S.fin[i] = Math.min(1, b + ext);
        S.t[i] = -1;                                       // fuerza la primera escritura
        S.tc[i] = 0;
        S.off[i] = false;
        S.viva[i] = false;
      }

      /* Un solo listener para todo: botones de ficha. Los links van solos. */
      el.addEventListener('click', e => {
        const btn = e.target.closest ? e.target.closest('.revista-btn') : null;
        if (!btn) return;
        e.preventDefault();
        const k = btn.getAttribute('data-dest');
        if (!k || !ctx.abrirDestino) return;
        try { ctx.abrirDestino(k); } catch (err) { /* la revista sigue pasando páginas */ }
      });

      if (ctx.U.calmo()) el.classList.add('revista--calmo');
    },

    update(p, ctx) {
      const U = ctx.U;
      const n = S.hojas.length;
      if (!n) return;

      /* La revista entra en cuadro */
      const ent = U.easeOut(U.tramo(p, 0, 0.06));
      if (ent !== S.ultEnt) {
        S.raiz.style.setProperty('--rv-in', ent.toFixed(4));
        S.ultEnt = ent;
      }

      /* 1) Matemática pura: el t de cada hoja, sin tocar el DOM. flip cuenta
         cuántas ya pasaron la mitad → de ahí sale el pliego activo. */
      let flip = 0;
      for (let i = 0; i < n; i++) {
        const t = U.ease(U.tramo(p, S.ini[i], S.fin[i]));
        S.tc[i] = t;
        if (t > 0.5) flip++;
      }
      const s = flip - 1;                                  // última hoja dada vuelta

      /* 2) Culling ±VENTANA del pliego activo (hojas s y s+1). Sólo esa
         ventanita se pinta y recibe estilos; el resto, visibility:hidden y
         CERO escrituras (el cache S.t guarda lo último escrito en el DOM,
         así al volver a entrar en ventana se re-sincroniza sola). */
      const lo = Math.max(0, s - VENTANA);
      const hi = Math.min(n - 1, s + 1 + VENTANA);
      for (let i = 0; i < n; i++) {
        const h = S.hojas[i];
        const fuera = i < lo || i > hi;
        if (fuera !== S.off[i]) {
          S.off[i] = fuera;
          h.classList.toggle('revista-hoja--off', fuera);
        }
        if (fuera) {
          if (S.viva[i]) {                                 // que no quede will-change colgado
            S.viva[i] = false;
            h.classList.remove('revista-hoja--viva');
          }
          continue;
        }
        const t = S.tc[i];
        if (t !== S.t[i]) {
          S.t[i] = t;
          h.style.setProperty('--t', t.toFixed(4));
          h.style.setProperty('--a', (-180 * t).toFixed(2) + 'deg');
        }
        /* will-change:transform sólo mientras la hoja está girando de verdad */
        const viva = t > 0.0001 && t < 0.9999;
        if (viva !== S.viva[i]) {
          S.viva[i] = viva;
          h.classList.toggle('revista-hoja--viva', viva);
        }
      }

      /* La tapa manda: mientras gira, el libro se corre y se endereza */
      const abrir = U.clamp(S.tc[0] * 1.35);
      if (abrir !== S.ultAbrir) {
        S.raiz.style.setProperty('--rv-abrir', abrir.toFixed(4));
        S.ultAbrir = abrir;
      }

      /* El marcador de tela se hamaca despacio con el scroll. Cuantizado a
         décima de grado (no se nota) y escrito sobre la cinta misma, así el
         recálculo de estilo no arranca desde la raíz de la escena. */
      const cinta = (Math.round((Math.sin(p * 7.2) * 2.6 + 1.4) * 10) / 10).toFixed(1);
      if (cinta !== S.ultCinta && S.cinta) {
        S.cinta.style.setProperty('--rv-cinta', cinta + 'deg');
        S.ultCinta = cinta;
      }

      /* Clicables: sólo las caras que miran de frente. El umbral no es 0/1
         exacto — a 20° de giro la página se ve y el navegador acierta el hit
         test igual, y así la ventana para hacer click no es un pelo. */
      const QUIETA = 0.88, CRUDA = 0.12;
      let nIzq = null, nDer = null;
      if (s < 0) {
        nDer = S.tc[0] <= CRUDA ? S.frentes[0] : null;
      } else {
        nIzq = S.tc[s] >= QUIETA ? S.dorsos[s] : null;
        if (s + 1 < n) nDer = S.tc[s + 1] <= CRUDA ? S.frentes[s + 1] : null;
        else nDer = S.baseDer;
      }
      if (nIzq !== S.vIzq) {
        if (S.vIzq) S.vIzq.classList.remove('is-viva');
        if (nIzq) nIzq.classList.add('is-viva');
        S.vIzq = nIzq;
      }
      if (nDer !== S.vDer) {
        if (S.vDer) S.vDer.classList.remove('is-viva');
        if (nDer) nDer.classList.add('is-viva');
        S.vDer = nDer;
      }
    },

    exit() {
      /* Al salir de cuadro nada queda clicable por accidente */
      if (S.vIzq) { S.vIzq.classList.remove('is-viva'); S.vIzq = null; }
      if (S.vDer) { S.vDer.classList.remove('is-viva'); S.vDer = null; }
    },
  });
})();
