/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones/carteles.js — EL TABLERO.

   Un solo mueble colgado del techo (arriba a la izquierda) con dos pestañas:
     · SALIDAS  → lo que encontró el radar (latest.json)
     · VUELTAS  → la mejor vuelta por destino (busqueda.json)
   Antes eran dos estaciones separadas ("partidas" y "llegadas"), cada una
   leyendo un archivo distinto sin decirlo: el 18% de los días mostraban cosas
   que no coincidían. Ahora están juntas y CADA pestaña dice de qué hora es su
   dato (NV.ui.sello: 'radar' para Salidas, 'buscador' para Vueltas).

   Dos maneras de dibujar las filas, y la elige el ANCHO del panel enfocado
   (no la orientación: el celular acostado también deja un panel angosto):
     · FICHAS (panel ≥ 760px)  el split-flap de siempre — es donde luce
     · LISTA  (panel < 760px)  una lista HTML legible. Con el panel en 366px
                               las fichas quedaban con letra de 5,4 px y los
                               chips de día en 6,2: ilegible. Se rearma sola
                               al girar el celular.

   Y en las dos: los DÍAS AL MÍNIMO, no una fecha sola. Smiles rota cuál de los
   días empatados está al mínimo (21 de 33 rutas tienen más de uno), así que
   mostrar uno solo era la causa #1 de "eso ya no vale eso". Cada día es un link
   directo a Smiles para ESE día.

   Contrato NV.estacion: html / mount / enfocar / desenfocar / tick / refrescar.
   El CSS propio (carteles.css) se inyecta como <link> desde acá.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});
  if (typeof NV.estacion !== 'function') return;

  /* ── CSS propio: un <link> junto a este script ─────────────────────────── */
  (function inyectarCSS() {
    const src = document.currentScript && document.currentScript.src;
    const href = src ? new URL('carteles.css', src).href : 'mundo/estaciones/carteles.css';
    if (document.querySelector('link[data-est-css="carteles"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.estCss = 'carteles';
    document.head.appendChild(l);
  })();

  /* ══════════════════════════════════════════════════════════════════════
     1 · EL MOTOR SPLIT-FLAP
     ══════════════════════════════════════════════════════════════════════ */
  const ALFA = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.·:-/';
  const NUM  = ' 0123456789.:';

  const MAPAS = new Map();
  function pos(alfa, ch) {
    let m = MAPAS.get(alfa);
    if (!m) { m = new Map(); for (let i = 0; i < alfa.length; i++) m.set(alfa.charAt(i), i); MAPAS.set(alfa, m); }
    const v = m.get(ch);
    return v === undefined ? 0 : v;
  }

  /* Los carteles no tienen acentos: mayúscula y sin tildes. Lo que la ficha
     no sabe mostrar se vuelve blanco. */
  function limpiar(txt, alfa) {
    let t = String(txt == null ? '' : txt).toUpperCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* nada */ }
    let out = '';
    for (const ch of t) {
      if (alfa.indexOf(ch) >= 0) out += ch;
      else if (ch === ',') out += '.';
      else if (ch === '–' || ch === '—') out += '-';
      else out += ' ';
    }
    return out;
  }
  function encajar(txt, n, ali) {
    let t = txt.length > n ? txt.slice(0, n) : txt;
    while (t.length < n) t = (ali === 'd') ? ' ' + t : t + ' ';
    return t;
  }

  const ahora = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const calmo = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  const girando = new Set();
  let corriendo = false;

  function frenar(f) { f.el.classList.remove('ca-flap--gira'); girando.delete(f); }

  function tic(t) {
    corriendo = false;
    girando.forEach(f => {
      if (t < f.next) return;
      if (f.i === f.t) { frenar(f); return; }
      // una letra más, clac — y si el frame llegó tarde, las que debía
      let n = 0;
      do { f.i = (f.i + 1) % f.alfa.length; f.next += f.paso; n++; }
      while (f.i !== f.t && f.next <= t && n < f.alfa.length);
      if (f.next < t) f.next = t + f.paso;
      f.c.textContent = f.alfa.charAt(f.i);
      if (f.i === f.t) frenar(f);
    });
    if (girando.size) { corriendo = true; requestAnimationFrame(tic); }
  }
  function encender() { if (!corriendo) { corriendo = true; requestAnimationFrame(tic); } }

  /* Manda una ficha hacia su letra. `retardo` = desfase de la cascada (ms). */
  function girar(f, ch, retardo, seco) {
    const t = pos(f.alfa, ch);
    if (seco) {                                    // sin giro: cae directo
      if (girando.has(f)) frenar(f);
      f.i = f.t = t;
      f.c.textContent = f.alfa.charAt(t);
      return;
    }
    if (t === f.i && !girando.has(f)) return;      // ya está donde va
    f.t = t;
    f.paso = 16 + (f.k % 4) * 4;                   // 16–28 ms por paso
    f.next = ahora() + retardo;
    f.el.classList.add('ca-flap--gira');
    girando.add(f);
    encender();
  }
  function ponerCelda(celda, txt, retardo, seco) {
    const t = encajar(limpiar(txt, celda.alfa), celda.n, celda.ali);
    for (let i = 0; i < celda.n; i++) girar(celda.flaps[i], t.charAt(i), retardo + i * 13, seco);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2 · LOS DATOS
     ══════════════════════════════════════════════════════════════════════ */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const millas = n => { try { return NV.fmtMiles(n); } catch (e) { return String(n == null ? '--' : n); } };
  const ymL = ym => { try { return ym ? NV.ymLabel(ym) : ''; } catch (e) { return ym || ''; } };
  const ui = () => NV.ui || {};

  const ESTADO_IDA = {
    oportunidad: { txt: 'EMBARCANDO', cls: 'ca-est--verde ca-est--late' },
    bueno:       { txt: 'A HORARIO',  cls: 'ca-est--tiza' },
    normal:      { txt: 'A HORARIO',  cls: 'ca-est--tiza' },
    caro:        { txt: 'DEMORADO',   cls: 'ca-est--rojo' },
    /* Calendario incompleto: para las rutas GOL/cabotaje Smiles solo devuelve
       el mes entero entre las 9 y las 11 de la mañana; el resto del día manda
       0-6 días sueltos. Con eso no se puede decir "caro" ni "oportunidad". */
    parcial:     { txt: 'PARCIAL',    cls: 'ca-est--ambar' },
    /* Ni un solo día con premio: el motor publica la ruta igual (dias:[],
       mejor_precio_millas null) para que no desaparezca del tablero. Mostrarla
       como "A HORARIO · precio normal" era mentir sobre una fila vacía. */
    sindias:     { txt: 'SIN DIAS',   cls: 'ca-est--gris' },
  };
  const estadoVuelta = i => (i < 3
    ? { txt: 'ATERRIZANDO', cls: 'ca-est--verde' + (i === 0 ? ' ca-est--late' : '') }
    : { txt: 'EN VUELO',    cls: 'ca-est--tiza' });

  /* Grupos: explican el orden sin que haga falta leer la leyenda. El ORDEN y
     el GRUPO salen de la misma función a propósito — cuando eran dos tablas
     distintas, una ruta sin nivel pesaba 9 (después de las parciales) pero se
     rotulaba "normal", y el tablero sacaba DOS encabezados "Precio normal",
     uno a cada lado de las parciales, los dos con la cuenta total. */
  const GRUPOS = {
    oportunidad: 'Barato para su ruta',
    bueno:       'Buen precio',
    normal:      'Precio normal',
    caro:        'Caro para su ruta',
    parcial:     'Smiles está listando pocos días',
    sindias:     'Sin días a la vista',
  };
  const ORDEN_GRUPO = { oportunidad: 0, bueno: 1, normal: 2, caro: 3, parcial: 8, sindias: 9 };
  /* En qué grupo cae una ruta del radar. Primero los casos en los que NO se la
     puede juzgar (sin precio, calendario parcial) y recién después el nivel. */
  function grupoDe(r) {
    if (!r || r.mejor_precio_millas == null) return 'sindias';
    if (r.parcial) return 'parcial';
    return ORDEN_GRUPO[r.nivel] == null || r.nivel === 'parcial' || r.nivel === 'sindias' ? 'normal' : r.nivel;
  }

  /* "Miami y alrededores" → "MIAMI". */
  function nombreCorto(s, max) {
    let t = String(s || '').split(/\s+y\s+|\s*\/\s*|,/i)[0].trim();
    if (!t) t = String(s || '').trim();
    if (max && t.length > max) t = t.slice(0, max).trim();
    return t;
  }
  /* Nombre · IATA si entra en n fichas; si no, solo el nombre. */
  function destTxt(nombre, code, n) {
    const nom = nombreCorto(nombre, n);
    if (!code) return nom;
    const full = nom + ' · ' + code;
    return full.length <= n ? full : nom;      // si no entra la sigla, gana el nombre
  }
  /* "Abr 2027" si todos los días caen en el mismo mes, "Abr–Jun 2027" si no. */
  function rangoYM(dias) {
    const meses = [...new Set((dias || []).map(d => String(d).slice(0, 7)))].sort();
    if (!meses.length) return '';
    return meses.length === 1 ? ymL(meses[0]) : ymL(meses[0]) + ' – ' + ymL(meses[meses.length - 1]);
  }
  /* ¿Vale la pena mostrar la hora de ESTA ruta? Solo si se consultó más de una
     hora antes de lo que dice el encabezado del tablero (el motor recorre las
     33 rutas a lo largo de horas). Si no, sería la misma hora repetida 33 veces. */
  function selloDistinto(s) {
    if (!s || !s.iso) return null;
    const g = NV.state && NV.state.latest && NV.state.latest.generado;
    if (!g) return s;
    const dif = Math.abs(new Date(g).getTime() - new Date(s.iso).getTime());
    return dif > 3600e3 ? s : null;
  }

  function notaParcial(r) {
    const n = Array.isArray(r.dias) ? r.dias.length : 0;
    const esp = r.dias_esperados;
    return esp
      ? `Smiles está listando ${n} de los ${esp} días de ${ymL(r.ym)} — vuelve a listar el mes entero a la mañana`
      : `Smiles está listando solo ${n} día${n === 1 ? '' : 's'} de ${ymL(r.ym)} — a la mañana lista el mes entero`;
  }

  /* SALIDAS: una fila por destino+aeropuerto (la mejor). Orden: primero lo que
     está barato PARA SU PROPIA RUTA, y dentro de cada grupo por millas. Las
     rutas con calendario parcial —y las que no trajeron ningún día— van aparte,
     al final: no se las puede juzgar. */
  function filasSalidas(ctx) {
    let R = [];
    try { R = (ctx.resultados || []).filter(r => r && r.destino_key); } catch (e) { R = []; }
    const peso = r => ORDEN_GRUPO[grupoDe(r)];
    R = R.slice().sort((a, b) => (peso(a) - peso(b)) || ((a.mejor_precio_millas == null ? 9e12 : a.mejor_precio_millas) - (b.mejor_precio_millas == null ? 9e12 : b.mejor_precio_millas)));
    const vistas = new Set(), filas = [];
    for (const r of R) {
      const id = r.destino_key + '·' + (r.aeropuerto || '');
      if (vistas.has(id)) continue;
      vistas.add(id);
      const grupo = grupoDe(r);
      const est = ESTADO_IDA[grupo] || ESTADO_IDA.normal;
      const orig = r.origen || 'EZE', code = r.aeropuerto || '';
      const U = ui();
      const dias = grupo === 'sindias' ? [] : (U.diasMin ? U.diasMin(r) : (r.mejor_fecha ? [r.mejor_fecha] : []));
      const selloR = U.selloRuta ? U.selloRuta(r) : null;
      filas.push({
        k: r.destino_key, grupo, estCls: est.cls, est: est.txt,
        emoji: r.destino_emoji || '', nombre: nombreCorto(r.destino_nombre || r.destino_key),
        dest: destTxt(r.destino_nombre || r.destino_key, code, COLS[0].n),
        destL: destTxt(r.destino_nombre || r.destino_key, code, COLS_L[0].n),
        ruta: orig + ' → ' + code, ym: ymL(r.ym), orig,
        mi: millas(r.mejor_precio_millas),
        nDias: dias.length,
        chips: U.diasChips ? U.diasChips(r, dias.slice(0, MAX_CHIPS)) : '',
        resto: Math.max(0, dias.length - MAX_CHIPS),
        nota: grupo === 'parcial' ? notaParcial(r)
            : grupo === 'sindias' ? `Smiles no mostró ningún día con premio en ${ymL(r.ym)}` : '',
        // el sello por fila solo cuando ESA ruta se consultó bastante antes que
        // la corrida: si no, repetiría 33 veces la hora que ya dice el encabezado
        sello: selloDistinto(selloR),
        lee: nombreCorto(r.destino_nombre) + ', ' + millas(r.mejor_precio_millas) + ' millas, ' + est.txt
             + (dias.length ? ', ' + (NV.diasMinTxt ? NV.diasMinTxt(r) : dias.length + ' días') : ''),
      });
    }
    return filas;
  }

  /* VUELTAS: la mejor vuelta (destino → EZE) por destino, de la más barata para
     arriba, con TODOS los días de ese aeropuerto que están a ese mismo precio. */
  function filasVueltas(ctx) {
    let keys = [];
    try { keys = ctx.NV.destinosConVuelta() || []; } catch (e) { keys = []; }
    const crudo = [];
    keys.forEach(k => {
      let v = null;
      try { v = ctx.NV.vueltasDestino(k); } catch (e) { v = null; }
      if (!v || !v.porAero) return;
      let mejor = null;
      Object.keys(v.porAero).forEach(code => {
        const dias = v.porAero[code] || {};
        Object.keys(dias).forEach(f => {
          const mi = dias[f] && dias[f].mi;
          if (mi == null) return;
          if (!mejor || mi < mejor.mi) mejor = { code, mi };
        });
      });
      if (!mejor) return;
      const mapa = v.porAero[mejor.code] || {};
      const dias = Object.keys(mapa).filter(f => mapa[f] && mapa[f].mi === mejor.mi).sort();
      crudo.push({ k, nombre: v.nombre || k, emoji: v.emoji || '', code: mejor.code, mi: mejor.mi,
                   dias, orig: v.orig || 'EZE', moneda: v.moneda });
    });
    crudo.sort((a, b) => (a.mi - b.mi) || (a.dias[0] < b.dias[0] ? -1 : a.dias[0] > b.dias[0] ? 1 : 0));
    const U = ui();
    return crudo.map((v, i) => {
      const est = estadoVuelta(i);
      return {
        k: v.k, grupo: null, estCls: est.cls, est: est.txt,
        emoji: v.emoji, nombre: nombreCorto(v.nombre),
        dest: destTxt(v.nombre, v.code, COLS[0].n),
        destL: destTxt(v.nombre, v.code, COLS_L[0].n),
        // el mes también acá: las vueltas de un destino juntan TODOS los meses
        // del viaje y los chips dicen "5 Abr" sin año (los viajes van de
        // nov-2026 a jun-2027, así que sin el mes no se sabe de qué se habla)
        ruta: v.code + ' → ' + v.orig, ym: rangoYM(v.dias), orig: v.code,
        mi: millas(v.mi),
        nDias: v.dias.length,
        // la vuelta va del destino al origen: origen y destino al revés
        chips: U.chipsSueltos ? U.chipsSueltos(v.dias.slice(0, MAX_CHIPS), v.code, v.orig, v.moneda) : '',
        resto: Math.max(0, v.dias.length - MAX_CHIPS),
        nota: '', sello: null,
        lee: 'vuelta desde ' + nombreCorto(v.nombre) + ', ' + millas(v.mi) + ' millas, ' + est.txt,
      };
    });
  }

  /* El pie sale de las filas que hay, no de una constante: decía siempre
     "EZE · Ministro Pistarini" y en el tablero conviven salidas desde EZE y
     desde AEP (San Pablo, Río, Mendoza salen de Aeroparque). */
  const PESTANAS = {
    salidas: { icono: '🛫', txt: 'Salidas', fuente: 'radar',    datos: filasSalidas,
               colDest: 'Destino', agrupa: true,
               pie: filas => {
                 const o = [...new Set((filas || []).map(f => f.orig).filter(Boolean))].sort();
                 return o.length ? 'saliendo desde ' + o.join(' y ') : 'salidas con millas';
               } },
    vueltas: { icono: '🛬', txt: 'Vueltas', fuente: 'buscador', datos: filasVueltas,
               colDest: 'Desde',   agrupa: false,
               pie: () => 'la mejor vuelta de cada destino' },
  };

  /* ══════════════════════════════════════════════════════════════════════
     3 · EL MUEBLE (markup)
     ══════════════════════════════════════════════════════════════════════ */
  /* Cerca (fichas): 3 columnas + la tira de días abajo.  Lejos: 3, letra grande. */
  const COLS   = [
    { cls: 'dest', n: 18, num: false, ali: 'i', campo: 'dest' },
    { cls: 'est',  n: 11, num: false, ali: 'i', campo: 'est'  },
    { cls: 'mi',   n: 8,  num: true,  ali: 'd', campo: 'mi'   },
  ];
  const COLS_L = [
    { cls: 'dest', n: 14, num: false, ali: 'i', campo: 'destL' },
    { cls: 'est',  n: 11, num: false, ali: 'i', campo: 'est' },
    { cls: 'mi',   n: 7,  num: true,  ali: 'd', campo: 'mi' },
  ];
  const FILAS_LEJOS = 8;      // capa lejos: las primeras (las que entren)
  /* Tope de chips por fila: hay rutas con 43 días al mismo precio (Mendoza, el
     8-sep) y una sola fila se comía el tablero entero. El resto se cuenta, y la
     lista completa está en la ficha del destino. */
  const MAX_CHIPS = 8;

  /* ¿Fichas o lista? Manda el ANCHO que va a tener el panel enfocado, NO la
     orientación. Medido el 8-sep-2026: con el celular acostado (844x390) el
     panel queda en 611px, las fichas caen a 9px y los chips de día a 6,5px —
     la misma letra ilegible que motivó la lista, nomás que apaisada. Desde
     760px de panel para arriba las fichas se leen (chip ≥ 11px) y el cartel
     luce, que es la gracia del tablero.
     El ancho se calcula igual que en estaciones.js/medirPantalla (verificado
     al px: 844x390 → 611,1 y 1440x900 → 1240). */
  const ANCHO_FICHAS = 760;
  function anchoPanel() {
    const W = window.innerWidth || 1, H = window.innerHeight || 1;
    if (H > W) return W * 0.94;                       // vertical: el panel llena el ancho
    const e = (NV.camara && NV.camara.estaciones && NV.camara.estaciones.partidas) || null;
    const rel = (e && e.alto ? e.ancho / e.alto : 2.1) || 2.1;
    let fw = Math.min(W * 0.94, 1240);
    const maxAlto = H * (H < 520 ? 0.74 : 0.88);
    if (fw / rel > maxAlto) fw = maxAlto * rel;
    return fw;
  }
  function esLista() { return anchoPanel() < ANCHO_FICHAS; }

  function fichas(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += '<span class="ca-flap"><span class="ca-flap__c"> </span><span class="ca-flap__l"></span></span>';
    return s;
  }
  /* Fichas ya asentadas (capa lejos): la letra impresa, sin motor. */
  function fichasFijas(txt, col) {
    const t = encajar(limpiar(txt, col.num ? NUM : ALFA), col.n, col.ali);
    let s = '';
    for (let i = 0; i < col.n; i++) {
      const ch = t.charAt(i);
      s += '<span class="ca-flap"><span class="ca-flap__c">' + (ch === ' ' ? '&nbsp;' : esc(ch)) + '</span></span>';
    }
    return s;
  }
  function celdaHTML(col, txt, extraCls) {
    return '<span class="ca-celda ca-c--' + col.cls + (extraCls ? ' ' + extraCls : '') + '"'
      + ' data-t="' + esc(txt) + '" data-n="' + col.n + '"'
      + (col.num ? ' data-a="n"' : '') + (col.ali === 'd' ? ' data-l="d"' : '')
      + ' aria-hidden="true">' + fichas(col.n) + '</span>';
  }

  /* La tira de días al mínimo: cada uno abre Smiles con ESA fecha. Los chips
     los arma NV.ui.diasChips con el formato del cerebro (clase .diamin). */
  function diasHTML(f) {
    let s = '<div class="ca-dias">';
    if (f.nDias) {
      // el mes adelante: los chips dicen "2 Mar" sin año y las rutas van de
      // noviembre 2026 a junio 2027, así que sin el mes se lee mal
      const lbl = (f.ym ? f.ym + ' · ' : '') + (f.nDias > 1 ? f.nDias + ' días al mismo precio' : 'un solo día');
      s += '<span class="ca-dias__lbl">' + esc(lbl) + '</span>';
      s += f.chips;
      if (f.resto) s += '<span class="ca-dias__mas">+' + f.resto + ' más · abrí la ficha</span>';
    } else if (!f.nota) {
      s += '<span class="ca-dias__lbl">sin días con premio</span>';
    }
    if (f.nota) s += '<span class="ca-dias__nota">' + esc(f.nota) + '</span>';
    if (f.sello) s += '<span class="ca-dias__sello">' + esc(f.sello.txt || '') + '</span>';
    return s + '</div>';
  }

  /* En modo lista el separador va dentro de un <li>: un <ol> solo admite <li>. */
  function grupoHTML(id, n, lista) {
    const cuerpo = '<div class="ca-grupo ca-grupo--' + esc(id) + '"><span>' + esc(GRUPOS[id] || id) + '</span>'
      + '<small>' + n + ' vuelo' + (n === 1 ? '' : 's') + '</small></div>';
    return lista ? '<li class="ca-grupo-li">' + cuerpo + '</li>' : cuerpo;
  }

  /* ── Filas con FICHAS (apaisado) ───────────────────────────────────────── */
  function filaFichasHTML(f, i) {
    const celdas = COLS.map(c => celdaHTML(c, f[c.campo] || '', c.cls === 'est' ? f.estCls : '')).join('');
    return '<div class="ca-fila" data-k="' + esc(f.k) + '">'
      + '<button type="button" class="ca-fila__cab" data-k="' + esc(f.k) + '" aria-label="' + esc(f.lee || '') + '">'
      +   '<span class="ca-fila__n" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>'
      +   celdas + '<span class="ca-fila__flecha" aria-hidden="true">›</span>'
      + '</button>' + diasHTML(f) + '</div>';
  }
  /* ── Filas en LISTA (celular de pie) ───────────────────────────────────── */
  function filaListaHTML(f, i) {
    return '<li class="ca-li" data-k="' + esc(f.k) + '">'
      + '<button type="button" class="ca-li__cab" data-k="' + esc(f.k) + '" aria-label="' + esc(f.lee || '') + '">'
      +   '<span class="ca-li__n" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>'
      +   '<span class="ca-li__dest"><b>' + (f.emoji ? esc(f.emoji) + ' ' : '') + esc(f.nombre) + '</b>'
      +     '<small>' + esc(f.ruta) + '</small></span>'
      +   '<span class="ca-li__mi"><b>' + esc(f.mi) + '</b><small>millas</small></span>'
      +   '<span class="ca-li__flecha" aria-hidden="true">›</span>'
      + '</button>'
      + '<div class="ca-li__est ' + esc(f.estCls) + '"><i></i>' + esc(f.est) + '</div>'
      + diasHTML(f) + '</li>';
  }

  function filasHTML(filas, cfg, lista) {
    if (!filas.length) {
      return '<div class="ca-vacio">Todavía no hay vuelos para mostrar acá.</div>';
    }
    // las cuentas, precalculadas: filtrar adentro del forEach daba el total del
    // grupo entero aunque el encabezado cubriera solo un tramo
    const cuenta = {};
    filas.forEach(f => { if (f.grupo) cuenta[f.grupo] = (cuenta[f.grupo] || 0) + 1; });
    let html = '', grupoActual = null;
    filas.forEach((f, i) => {
      if (cfg.agrupa && f.grupo && f.grupo !== grupoActual) {
        grupoActual = f.grupo;
        html += grupoHTML(f.grupo, cuenta[f.grupo], lista);
      }
      html += lista ? filaListaHTML(f, i) : filaFichasHTML(f, i);
    });
    return lista ? '<ol class="ca-lista">' + html + '</ol>' : html;
  }
  function filasLejosHTML(filas) {
    if (!filas.length) return '<div class="ca-fila ca-fila--fija ca-fila--vacia"><span class="ca-celda ca-c--vacia">' + fichasFijas('SIN VUELOS', { n: 10, num: false, ali: 'i' }) + '</span></div>';
    return filas.slice(0, FILAS_LEJOS).map(f => {
      const celdas = COLS_L.map(c => '<span class="ca-celda ca-c--' + c.cls + (c.cls === 'est' ? ' ' + f.estCls : '') + '">' + fichasFijas(f[c.campo] || '', c) + '</span>').join('');
      return '<div class="ca-fila ca-fila--fija">' + celdas + '</div>';
    }).join('');
  }
  function cabHTML(cols, cfg) {
    const nombre = { dest: cfg.colDest, est: 'Estado', mi: 'Millas' };
    return '<div class="ca-cab" aria-hidden="true">'
      + (cols === COLS ? '<span class="ca-fila__n"></span>' : '')
      + cols.map(c => '<span class="ca-c--' + c.cls + '">' + esc(nombre[c.cls]) + '</span>').join('')
      + '</div>';
  }

  /* Sello de hora: de QUÉ hora es el dato de ESTA pestaña. Salidas lee el radar
     (se refresca en cada barrido rápido) y Vueltas el buscador (solo se rehace
     en los completos): por eso a veces no coinciden, y ahora se ve. */
  function selloHTML(cfg) {
    const U = ui();
    if (!U.selloHTML) return '';
    return U.selloHTML(cfg.fuente, cfg.fuente);
  }

  /* Una línea al pie que traduce el semáforo: los estados de aeropuerto son
     lindos pero no dicen nada solos (y el orden mezcla Nueva York a 256.400
     con Mendoza a 10.700 porque "barato" es siempre respecto de SU ruta). */
  function leyendaHTML(tab) {
    return tab === 'vueltas'
      ? '<span class="ca__ley"><i class="ca-pt ca-pt--verde"></i>las 3 más baratas'
        + '<i class="ca-pt ca-pt--tiza"></i>el resto</span>'
      : '<span class="ca__ley"><i class="ca-pt ca-pt--verde"></i>barato para su ruta'
        + '<i class="ca-pt ca-pt--tiza"></i>normal'
        + '<i class="ca-pt ca-pt--rojo"></i>caro para su ruta'
        + '<i class="ca-pt ca-pt--ambar"></i>pocos días listados'
        + '<i class="ca-pt ca-pt--gris"></i>sin días</span>';
  }

  function muebleHTML(tab, filas, lista) {
    const cfg = PESTANAS[tab];
    const tabs = Object.keys(PESTANAS).map(t =>
      '<button type="button" role="tab" class="ca__tab' + (t === tab ? ' is-activa' : '') + '"'
      + ' data-tab="' + t + '" aria-selected="' + (t === tab ? 'true' : 'false') + '">'
      + PESTANAS[t].icono + ' ' + esc(PESTANAS[t].txt) + '</button>').join('');
    return '<div class="ca ca--tablero' + (lista ? ' ca--lista' : '') + '">'
      +   '<span class="ca__tirante ca__tirante--izq"></span><span class="ca__tirante ca__tirante--der"></span>'
      +   '<div class="ca__luz"></div>'
      +   '<div class="ca__marco">'
      +     '<i class="ca__torn ca__torn--a"></i><i class="ca__torn ca__torn--b"></i><i class="ca__torn ca__torn--c"></i><i class="ca__torn ca__torn--d"></i>'
      +     '<div class="ca__panel">'
      +       '<header class="ca__head">'
      +         '<h2 class="ca__tit"><span class="ca__avion">' + cfg.icono + '</span>TABLERO<em>' + esc(cfg.txt) + '</em></h2>'
      +         '<nav class="ca__tabs" role="tablist" aria-label="Salidas o vueltas">' + tabs + '</nav>'
      +         '<span class="ca__sello">' + selloHTML(cfg) + '</span>'
      +       '</header>'
      +       '<div class="ca__cuerpo">'
      +         '<div class="ca__lejos" aria-hidden="true">' + cabHTML(COLS_L, cfg)
      +           '<div class="ca__filas-lejos">' + filasLejosHTML(filas) + '</div></div>'
      +         '<div class="ca__cerca">' + (lista ? '' : cabHTML(COLS, cfg))
      +           '<div class="ca__tabla"><div class="est__scroll ca__scroll" data-scroll-interno>'
      +             '<div class="ca__filas">' + filasHTML(filas, cfg, lista) + '</div>'
      +           '</div></div>'
      +         '</div>'
      +       '</div>'
      +       '<footer class="ca__pie"><span class="ca__led"></span>'
      +         '<span class="ca__pie-n">' + filas.length + ' vuelo' + (filas.length === 1 ? '' : 's') + ' · ' + esc(typeof cfg.pie === 'function' ? cfg.pie(filas) : cfg.pie) + '</span>'
      +         '<span class="ca__pie-hint">tocá un día y se abre en Smiles</span>'
      +         leyendaHTML(tab)
      +       '</footer>'
      +       '<div class="ca__vidrio" aria-hidden="true"></div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="ca__sombra"></div>'
      + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     4 · MONTAJE: del DOM a los objetos que mueve el motor
     ══════════════════════════════════════════════════════════════════════ */
  function leerCeldas(filaEl) {
    const celdas = [], nodos = filaEl.querySelectorAll('.ca-celda');
    for (let j = 0; j < nodos.length; j++) {
      const c = nodos[j], alfa = c.getAttribute('data-a') === 'n' ? NUM : ALFA;
      const fl = c.querySelectorAll('.ca-flap'), flaps = [];
      for (let i = 0; i < fl.length; i++) flaps.push({ el: fl[i], c: fl[i].firstElementChild, alfa, i: 0, t: 0, k: i, paso: 24, next: 0 });
      celdas.push({ flaps, n: flaps.length, alfa, ali: c.getAttribute('data-l') === 'd' ? 'd' : 'i', txt: c.getAttribute('data-t') || '' });
    }
    return celdas;
  }
  function leerFilas(B) {
    B.filas = [];
    if (B.lista) return;                       // en lista no hay fichas que mover
    const nodos = B.raiz.querySelectorAll('.ca__filas .ca-fila[data-k]');
    for (let i = 0; i < nodos.length; i++) B.filas.push({ el: nodos[i], celdas: leerCeldas(nodos[i]) });
  }
  /* Huella de los datos: si cambia, hay que rearmar las filas. */
  const sello = () => [NV.state?.latest?.generado, NV.state?.busqueda?.generado].join('|');

  /* ══════════════════════════════════════════════════════════════════════
     5 · MOVIMIENTO
     ══════════════════════════════════════════════════════════════════════ */
  function pintarFila(B, i, on, seco) {
    const f = B.filas[i]; if (!f) return;
    for (let j = 0; j < f.celdas.length; j++) ponerCelda(f.celdas[j], on ? f.celdas[j].txt : '', i * 28 + j * 40, seco);
  }
  function blanquear(B) { for (let i = 0; i < B.filas.length; i++) pintarFila(B, i, false, true); B.sucio = false; }
  function girarTodo(B) {
    const seco = calmo();
    for (let i = 0; i < B.filas.length; i++) pintarFila(B, i, true, seco);
    B.sucio = true;
  }

  /* Rearma el mueble entero (cambio de pestaña, de datos o de orientación). */
  function rearmar(B, ctx) {
    B.lista = esLista();
    const cfg = PESTANAS[B.tab];
    let filas = [];
    try { filas = cfg.datos(ctx); } catch (e) { filas = []; }
    B.raiz.innerHTML = muebleHTML(B.tab, filas, B.lista);
    leerFilas(B);
    B.stamp = sello();
    B.sucio = false;
    if (B.enfocada && !B.lista) girarTodo(B);
  }
  /* Solo el sello (el minuto que pasa): no toca las filas. */
  function repintarSello(B) {
    const s = B.raiz.querySelector('.ca__sello');
    if (s) s.innerHTML = selloHTML(PESTANAS[B.tab]);
  }

  /* ══════════════════════════════════════════════════════════════════════
     6 · LA ESTACIÓN
     ══════════════════════════════════════════════════════════════════════ */
  let B = null;

  NV.estacion('partidas', {
    html(ctx) {
      const lista = esLista();
      let filas = [];
      try { filas = PESTANAS.salidas.datos(ctx); } catch (e) { filas = []; }
      return muebleHTML('salidas', filas, lista);
    },

    mount(el, ctx) {
      B = { raiz: el, tab: 'salidas', lista: esLista(), filas: [], enfocada: false, sucio: false, stamp: sello() };
      leerFilas(B);

      el.addEventListener('click', ev => {
        const t = ev.target;
        // los días son links de verdad a Smiles: que sigan su curso
        if (t.closest && t.closest('a')) return;
        const tab = t.closest && t.closest('.ca__tab');
        if (tab && PESTANAS[tab.dataset.tab]) {
          ev.preventDefault();
          if (tab.dataset.tab === B.tab) return;
          B.tab = tab.dataset.tab;
          rearmar(B, ctx);
          return;
        }
        const cab = t.closest && t.closest('[data-k]');
        const k = cab && cab.getAttribute('data-k');
        if (!k) return;
        ev.preventDefault();
        try { ctx.abrirDestino(k); } catch (err) { /* silencio */ }
      });

      // Flechas dentro de las pestañas: cambiar de pestaña sin mover la cámara
      el.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (!e.target.closest || !e.target.closest('.ca__tabs')) return;
        e.preventDefault(); e.stopPropagation();
        B.tab = B.tab === 'salidas' ? 'vueltas' : 'salidas';
        rearmar(B, ctx);
        el.querySelector('.ca__tab.is-activa')?.focus();
      });

      // Girar el celular cambia fichas ↔ lista
      let tRe = 0;
      window.addEventListener('resize', () => {
        clearTimeout(tRe);
        tRe = setTimeout(() => { if (B && B.lista !== esLista()) rearmar(B, ctx); }, 220);
      });

      // La hoja modal (ficha de destino) scrollea con la rueda
      const panel = document.querySelector('#sheet .sheet__panel');
      if (panel && !panel.hasAttribute('data-scroll-interno')) panel.setAttribute('data-scroll-interno', '');
    },

    enfocar(el, ctx) {
      if (!B) return;
      B.enfocada = true;
      if (sello() !== B.stamp || B.lista !== esLista()) rearmar(B, ctx);
      else repintarSello(B);
      if (!B.lista) { blanquear(B); girarTodo(B); }     // arranca en blanco y cae letra por letra
      const sc = el.querySelector('.ca__scroll'); if (sc) sc.scrollTop = 0;
    },
    desenfocar() {
      if (!B) return;
      B.enfocada = false;
      girando.forEach(f => { if (f.el.closest('.ca--tablero')) { f.i = f.t; f.c.textContent = f.alfa.charAt(f.t); frenar(f); } });
    },
    /* Barato: cuando la capa cercana ya no se ve, la dejamos en blanco para que
       la próxima llegada vuelva a girar desde cero. */
    tick(el, ctx, cam) {
      if (!B || B.lista) return;
      if (B.sucio && !(cam.enfocada === 'partidas' && cam.zoom > 0.25)) blanquear(B);
    },
    /* Entraron datos nuevos (o pasó un minuto): si cambió el archivo rearmamos,
       si no alcanza con repintar el sello para que el "hace X" no se congele. */
    refrescar(el, ctx) {
      if (!B) return;
      if (sello() !== B.stamp) rearmar(B, ctx);
      else repintarSello(B);
    },
  });
})();
