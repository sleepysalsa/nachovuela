/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones/carteles.js — los dos carteles split-flap.

   Dos muebles colgados del techo de la terminal:
     · 'partidas'  (arriba a la izquierda)  → lo que encontró el radar (idas)
     · 'llegadas'  (arriba a la derecha)    → la mejor vuelta por destino

   Cada cartel es UN mueble (marco metálico, tornillos, luz cenital, reloj,
   pie) con DOS capas dentro del panel que se funden según el zoom:
     .ca__lejos  → cartel estático: primeras filas ya asentadas, 3 columnas,
                   letra grande. Es lo que se ve desde la butaca.
     .ca__cerca  → el cartel completo: 4 columnas, TODAS las filas, scroll
                   interno (data-scroll-interno). Al ENFOCAR, las fichas giran
                   letra por letra hasta caer en la definitiva y quedan quietas.

   Motor de fichas: cada ficha conoce su alfabeto y avanza de a una letra (no
   salta a destino). Un solo rAF para todas las fichas que giran; se apaga solo.
   Contrato NV.estacion: html / mount / enfocar / desenfocar / tick.
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
  const ORDEN_NIVEL = { oportunidad: 0, bueno: 1, normal: 2, caro: 3 };
  const ESTADO_IDA = {
    oportunidad: { txt: 'EMBARCANDO', cls: 'ca-est--verde ca-est--late' },
    bueno:       { txt: 'A HORARIO',  cls: 'ca-est--tiza' },
    normal:      { txt: 'A HORARIO',  cls: 'ca-est--tiza' },
    caro:        { txt: 'DEMORADO',   cls: 'ca-est--rojo' },
  };
  const estadoIda = nivel => ESTADO_IDA[nivel] || ESTADO_IDA.normal;
  const estadoVuelta = i => (i < 3
    ? { txt: 'ATERRIZANDO', cls: 'ca-est--verde' + (i === 0 ? ' ca-est--late' : '') }
    : { txt: 'EN VUELO',    cls: 'ca-est--tiza' });

  /* "Miami y alrededores" → "MIAMI". */
  function nombreCorto(s, max) {
    let t = String(s || '').split(/\s+y\s+|\s*\/\s*|,/i)[0].trim();
    if (!t) t = String(s || '').trim();
    if (t.length > max) t = t.slice(0, max).trim();
    return t;
  }
  /* Nombre · IATA si entra en n fichas; si no, solo el nombre. */
  function destTxt(nombre, code, n) {
    const nom = nombreCorto(nombre, n);
    if (!code) return nom;
    const full = nom + ' · ' + code;
    return full.length <= n ? full : nom;      // si no entra la sigla, gana el nombre
  }
  function fecha(iso) { if (!iso) return '--'; try { return NV.dateLabel(iso); } catch (e) { return String(iso); } }
  function millas(n) { try { return NV.fmtMiles(n); } catch (e) { return String(n == null ? '--' : n); } }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* PARTIDAS: oportunidad → bueno → normal → caro, y por millas; una fila por
     destino+aeropuerto (la mejor). TODAS las filas: el panel scrollea. */
  function datosPartidas(ctx) {
    let R = [];
    try { R = (ctx.resultados || []).filter(r => r && r.destino_key); } catch (e) { R = []; }
    R = R.slice().sort((a, b) => {
      const na = ORDEN_NIVEL[a.nivel] == null ? 9 : ORDEN_NIVEL[a.nivel];
      const nb = ORDEN_NIVEL[b.nivel] == null ? 9 : ORDEN_NIVEL[b.nivel];
      if (na !== nb) return na - nb;
      return (a.mejor_precio_millas || 9e12) - (b.mejor_precio_millas || 9e12);
    });
    const vistas = new Set(), filas = [];
    for (const r of R) {
      const id = r.destino_key + '·' + (r.aeropuerto || '');
      if (vistas.has(id)) continue;
      vistas.add(id);
      const est = estadoIda(r.nivel);
      filas.push({
        k: r.destino_key, estCls: est.cls,
        dest: destTxt(r.destino_nombre || r.destino_key, r.aeropuerto || '', COLS[0].n),
        destL: destTxt(r.destino_nombre || r.destino_key, r.aeropuerto || '', COLS_L[0].n),
        fecha: fecha(r.mejor_fecha), est: est.txt, mi: millas(r.mejor_precio_millas),
        lee: nombreCorto(r.destino_nombre, 30) + ', sale ' + fecha(r.mejor_fecha) + ', ' + millas(r.mejor_precio_millas) + ' millas, ' + est.txt,
      });
    }
    return filas;
  }

  /* LLEGADAS: la mejor vuelta (destino → EZE) por destino, de la más barata
     para arriba. Las 3 más baratas ATERRIZANDO; el resto EN VUELO. */
  function datosLlegadas(ctx) {
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
          if (!mejor || mi < mejor.mi || (mi === mejor.mi && f < mejor.f)) mejor = { code, f, mi };
        });
      });
      if (mejor) crudo.push({ k, nombre: v.nombre || k, code: mejor.code, f: mejor.f, mi: mejor.mi });
    });
    crudo.sort((a, b) => (a.mi - b.mi) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
    return crudo.map((v, i) => {
      const est = estadoVuelta(i);
      return {
        k: v.k, estCls: est.cls,
        dest: destTxt(v.nombre, v.code, COLS[0].n),
        destL: destTxt(v.nombre, v.code, COLS_L[0].n),
        fecha: fecha(v.f), est: est.txt, mi: millas(v.mi),
        lee: 'desde ' + nombreCorto(v.nombre, 30) + ', llega ' + fecha(v.f) + ', ' + millas(v.mi) + ' millas, ' + est.txt,
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     3 · EL MUEBLE (markup)
     ══════════════════════════════════════════════════════════════════════ */
  /* Cerca: 4 columnas.  Lejos: 3 (sin fecha), letra grande. */
  const COLS   = [
    { cls: 'dest', n: 20, num: false, ali: 'i', campo: 'dest' },
    { cls: 'fec',  n: 11, num: false, ali: 'i', campo: 'fecha' },
    { cls: 'est',  n: 11, num: false, ali: 'i', campo: 'est' },
    { cls: 'mi',   n: 8,  num: true,  ali: 'd', campo: 'mi' },
  ];
  const COLS_L = [
    { cls: 'dest', n: 14, num: false, ali: 'i', campo: 'destL' },
    { cls: 'est',  n: 11, num: false, ali: 'i', campo: 'est' },
    { cls: 'mi',   n: 7,  num: true,  ali: 'd', campo: 'mi' },
  ];
  const FILAS_LEJOS = 8;      // capa lejos: las primeras (las que entren)
  const MIN_FILAS = 14;       // capa cerca: se rellena con filas en blanco hasta acá (antes de medir)
  const RELLENO_MIN = 2;      // …y nunca menos de estas filas vacías al final

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
  function filaHTML(f, i) {
    const celdas = COLS.map(c => celdaHTML(c, f[c.campo] || '', c.cls === 'est' ? f.estCls : '')).join('');
    return '<button type="button" class="ca-fila" style="--i:' + i + '" data-k="' + esc(f.k) + '" aria-label="' + esc(f.lee || '') + '">'
      + '<span class="ca-fila__n" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>'
      + celdas + '<span class="ca-fila__flecha" aria-hidden="true">›</span></button>';
  }
  function filaLejosHTML(f) {
    const celdas = COLS_L.map(c => '<span class="ca-celda ca-c--' + c.cls + (c.cls === 'est' ? ' ' + f.estCls : '') + '">' + fichasFijas(f[c.campo] || '', c) + '</span>').join('');
    return '<div class="ca-fila ca-fila--fija">' + celdas + '</div>';
  }
  /* Filas de relleno: fichas en blanco, como en un cartel de verdad. */
  function filaRellenoHTML(i) {
    const celdas = COLS.map(c => '<span class="ca-celda ca-c--' + c.cls + '">' + fichasFijas('', c) + '</span>').join('');
    return '<div class="ca-fila ca-fila--relleno" aria-hidden="true"><span class="ca-fila__n">' + String(i + 1).padStart(2, '0') + '</span>' + celdas + '</div>';
  }
  function filasHTML(filas) {
    if (!filas.length) return '<div class="ca-fila ca-fila--vacia"><span class="ca-celda ca-c--vacia">' + fichasFijas('SIN VUELOS EN PANTALLA', { n: 22, num: false, ali: 'i' }) + '</span></div>';
    let html = filas.map(filaHTML).join('');
    const relleno = Math.max(RELLENO_MIN, MIN_FILAS - filas.length);
    for (let i = 0; i < relleno; i++) html += filaRellenoHTML(filas.length + i);
    return html;
  }
  function filasLejosHTML(filas) {
    if (!filas.length) return '<div class="ca-fila ca-fila--fija ca-fila--vacia"><span class="ca-celda ca-c--vacia">' + fichasFijas('SIN VUELOS', { n: 10, num: false, ali: 'i' }) + '</span></div>';
    return filas.slice(0, FILAS_LEJOS).map(filaLejosHTML).join('');
  }
  function cabHTML(cols, cfg) {
    const nombre = { dest: cfg.colDest, fec: cfg.colFecha, est: 'Estado', mi: 'Millas' };
    return '<div class="ca-cab" aria-hidden="true">'
      + (cols === COLS ? '<span class="ca-fila__n"></span>' : '')
      + cols.map(c => '<span class="ca-c--' + c.cls + '">' + esc(nombre[c.cls]) + '</span>').join('')
      + '</div>';
  }
  function relojHTML() {
    return '<div class="ca__reloj" aria-hidden="true">'
      + '<span class="ca__reloj-lbl">hora local</span>'
      + '<span class="ca__reloj-pila">'
      +   '<span class="ca__reloj-txt">--:--</span>'
      +   '<span class="ca__reloj-caja">' + fichas(2) + '<i class="ca__dosp">:</i>' + fichas(2) + '<i class="ca__dosp">:</i>' + fichas(2) + '</span>'
      + '</span></div>';
  }
  function muebleHTML(cfg, filas) {
    return '<div class="ca ca--' + cfg.clase + '">'
      +   '<span class="ca__tirante ca__tirante--izq"></span><span class="ca__tirante ca__tirante--der"></span>'
      +   '<div class="ca__luz"></div>'
      +   '<div class="ca__marco">'
      +     '<i class="ca__torn ca__torn--a"></i><i class="ca__torn ca__torn--b"></i><i class="ca__torn ca__torn--c"></i><i class="ca__torn ca__torn--d"></i>'
      +     '<div class="ca__panel">'
      +       '<header class="ca__head">'
      +         '<h2 class="ca__tit"><span class="ca__avion">' + cfg.icono + '</span>' + esc(cfg.titulo) + '<em>' + esc(cfg.sub) + '</em></h2>'
      +         relojHTML()
      +       '</header>'
      +       '<div class="ca__cuerpo">'
      +         '<div class="ca__lejos" aria-hidden="true">' + cabHTML(COLS_L, cfg)
      +           '<div class="ca__filas-lejos">' + filasLejosHTML(filas) + '</div></div>'
      +         '<div class="ca__cerca">' + cabHTML(COLS, cfg)
      +           '<div class="ca__tabla"><div class="est__scroll ca__scroll" data-scroll-interno>'
      +             '<div class="ca__filas">' + filasHTML(filas) + '</div>'
      +           '</div></div>'
      +         '</div>'
      +       '</div>'
      +       '<footer class="ca__pie"><span class="ca__led"></span><span>' + esc(cfg.pie) + '</span>'
      +         '<span class="ca__pie-n">' + filas.length + ' vuelo' + (filas.length === 1 ? '' : 's') + '</span>'
      +         '<span class="ca__pie-hint">tocá una fila para el detalle</span></footer>'
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
    const nodos = B.raiz.querySelectorAll('.ca__filas .ca-fila[data-k]');
    for (let i = 0; i < nodos.length; i++) B.filas.push({ el: nodos[i], celdas: leerCeldas(nodos[i]) });
  }
  const sello = () => [NV.state?.latest?.generado, NV.state?.busqueda?.generado].join('|');

  function montar(nombre, el, ctx, cfg) {
    const B = { nombre, cfg, raiz: el, filas: [], reloj: [], relojUlt: '', relojTxt: null, timer: null,
                enfocada: false, sucio: false, medir: false, stamp: sello() };
    leerFilas(B);
    const rel = el.querySelectorAll('.ca__reloj .ca-flap');
    for (let i = 0; i < rel.length; i++) B.reloj.push({ el: rel[i], c: rel[i].firstElementChild, alfa: NUM, i: 0, t: 0, k: i, paso: 24, next: 0 });
    B.relojTxt = el.querySelector('.ca__reloj-txt');

    // Click en la fila → la ficha del destino (solo llega cuando está enfocada)
    el.addEventListener('click', ev => {
      const f = ev.target && ev.target.closest ? ev.target.closest('.ca-fila[data-k]') : null;
      const k = f && f.getAttribute('data-k');
      if (!k) return;
      ev.preventDefault();
      try { ctx.abrirDestino(k); } catch (err) { /* silencio */ }
    });

    hora(B, true);
    B.timer = setInterval(() => hora(B, !B.enfocada), 1000);   // el reloj corre de verdad
    return B;
  }

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
  function hora(B, seco) {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0'), ss = String(d.getSeconds()).padStart(2, '0');
    const t = hh + mm + ss;
    if (t === B.relojUlt) return;
    B.relojUlt = t;
    if (B.relojTxt) B.relojTxt.textContent = hh + ':' + mm;
    const s = seco || calmo();
    for (let i = 0; i < B.reloj.length; i++) girar(B.reloj[i], t.charAt(i), 0, s);
  }
  /* Completa el cartel con filas en blanco hasta llenar el alto visible (sin
     scroll de más). Una lectura de layout, solo cuando el cartel ya está a
     tamaño (la dispara tick() con zoom≈1). */
  function rellenar(B) {
    const sc = B.raiz.querySelector('.ca__scroll'), cont = B.raiz.querySelector('.ca__filas');
    if (!sc || !cont) return;
    const primera = cont.querySelector('.ca-fila');
    const hFila = primera ? primera.offsetHeight : 0;
    if (!hFila) return;
    const extra = cont.offsetHeight - cont.clientHeight;         // por si acaso: bordes
    const pad = (cont.offsetHeight - hFila * cont.children.length) + extra;
    const caben = Math.floor((sc.clientHeight - pad - 2) / hFila);
    const reales = B.filas.length;
    const objetivo = Math.max(reales + RELLENO_MIN, caben);
    const rellenos = cont.querySelectorAll('.ca-fila--relleno');
    let actuales = rellenos.length;
    const quiero = objetivo - reales;
    if (quiero === actuales) return;
    if (quiero < actuales) { for (let i = actuales - 1; i >= quiero; i--) rellenos[i].remove(); return; }
    let html = '';
    for (let i = actuales; i < quiero; i++) html += filaRellenoHTML(reales + i);
    cont.insertAdjacentHTML('beforeend', html);
  }
  function rerender(B, ctx) {
    const filas = B.cfg.datos(ctx);
    const cerca = B.raiz.querySelector('.ca__filas'), lejos = B.raiz.querySelector('.ca__filas-lejos'), n = B.raiz.querySelector('.ca__pie-n');
    if (cerca) cerca.innerHTML = filasHTML(filas);
    if (lejos) lejos.innerHTML = filasLejosHTML(filas);
    if (n) n.textContent = filas.length + ' vuelo' + (filas.length === 1 ? '' : 's');
    leerFilas(B);
    B.stamp = sello();
  }

  /* ══════════════════════════════════════════════════════════════════════
     6 · LAS DOS ESTACIONES
     ══════════════════════════════════════════════════════════════════════ */
  function definir(nombre, cfg) {
    let B = null;
    NV.estacion(nombre, {
      html(ctx) {
        let filas = [];
        try { filas = cfg.datos(ctx); } catch (e) { filas = []; }
        return muebleHTML(cfg, filas);
      },
      mount(el, ctx) { B = montar(nombre, el, ctx, cfg); },
      enfocar(el, ctx) {
        if (!B) return;
        B.enfocada = true; B.medir = true;
        if (sello() !== B.stamp) rerender(B, ctx);
        blanquear(B);              // arranca en blanco…
        girarTodo(B);              // …y cae letra por letra
        const sc = el.querySelector('.ca__scroll'); if (sc) sc.scrollTop = 0;
      },
      desenfocar() {
        if (!B) return;
        B.enfocada = false;
        girando.forEach(f => { if (f.el.closest('.ca--' + cfg.clase)) { f.i = f.t; f.c.textContent = f.alfa.charAt(f.t); frenar(f); } });
      },
      /* Barato: solo cuando la capa cercana ya no se ve, la dejamos en blanco
         para que la próxima llegada vuelva a girar desde cero. */
      tick(el, ctx, cam) {
        if (!B) return;
        if (B.sucio && !(cam.enfocada === nombre && cam.zoom > 0.25)) blanquear(B);
        if (B.medir && cam.enfocada === nombre && cam.zoom > 0.97) { B.medir = false; rellenar(B); }
      },
    });
  }

  definir('partidas', {
    clase: 'partidas', icono: '🛫', titulo: 'PARTIDAS', sub: 'departures',
    colDest: 'Destino', colFecha: 'Sale', pie: 'EZE · Ministro Pistarini',
    datos: datosPartidas,
  });
  definir('llegadas', {
    clase: 'llegadas', icono: '🛬', titulo: 'LLEGADAS', sub: 'arrivals',
    colDest: 'Desde', colFecha: 'Llega', pie: 'EZE · Ministro Pistarini',
    datos: datosLlegadas,
  });
})();
