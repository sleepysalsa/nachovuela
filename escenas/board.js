/* ============================================================================
   NachoVuela · La Terminal — escenas PARTIDAS y LLEGADAS
   ----------------------------------------------------------------------------
   Los dos carteles split-flap: el mueble colgado en lo alto, la luz cálida que
   lo baña, el reloj que corre, y las fichas que giran hasta caer en la letra
   definitiva (efecto cascada de izquierda a derecha).

   Las dos escenas comparten TODO: el mismo motor de fichas, el mismo mueble,
   la misma grilla. Cambian los datos (idas vs. vueltas) y la entrada de cámara.

   Reglas de la casa que se respetan acá:
     · html()/mount() crean el DOM. update() solo escribe transform, opacity y
       custom-properties (nunca innerHTML, nunca nodos nuevos, nunca layout).
     · Las fichas giran en su propio rAF, disparado cuando cambia el contenido
       de una fila (o sea: cuando el scroll la revela).
     · El reloj es la única animación con setInterval — y se apaga al salir.
   ========================================================================== */
(function () {
  'use strict';

  const NV = window.NV;
  if (!NV || typeof NV.escena !== 'function') return;
  let U = window.NVU;

  /* ══════════════════════════════════════════════════════════════════════
     1 · EL MOTOR SPLIT-FLAP
     Cada ficha conoce su alfabeto y avanza de a una letra, como las de verdad:
     no salta a destino, pasa por todas las intermedias hasta llegar.
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

  /* Los carteles viejos no tienen acentos: se los sacamos y pasamos a mayúscula.
     Cualquier carácter que la ficha no sepa mostrar se convierte en blanco. */
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

  const girando = new Set();
  let corriendo = false;

  function frenar(f) {
    f.el.classList.remove('board-flap--gira');
    girando.delete(f);
  }

  function tic(t) {
    corriendo = false;
    girando.forEach(f => {
      if (t < f.next) return;
      if (f.i === f.t) { frenar(f); return; }
      f.i = (f.i + 1) % f.alfa.length;           // una letra más, clac
      f.c.textContent = f.alfa.charAt(f.i);
      f.next = t + f.paso;
      if (f.i === f.t) frenar(f);
    });
    if (girando.size) { corriendo = true; requestAnimationFrame(tic); }
  }

  function encender() { if (!corriendo) { corriendo = true; requestAnimationFrame(tic); } }

  /* Manda una ficha hacia su letra. `retardo` es el desfase de la cascada. */
  function girar(f, ch, retardo, calmo) {
    const t = pos(f.alfa, ch);
    if (calmo) {                                  // menos movimiento: sin giro
      if (girando.has(f)) frenar(f);
      f.i = f.t = t;
      f.c.textContent = f.alfa.charAt(t);
      return;
    }
    if (t === f.i && !girando.has(f)) return;      // ya está donde va
    f.t = t;
    f.paso = 16 + (f.k % 4) * 4;                   // 16–28 ms: se lee rápido y sigue sonando a cartel
    f.next = ahora() + retardo;
    f.el.classList.add('board-flap--gira');
    girando.add(f);
    encender();
  }

  function ponerCelda(celda, txt, retardo, calmo) {
    const t = encajar(limpiar(txt, celda.alfa), celda.n, celda.ali);
    for (let i = 0; i < celda.n; i++) girar(celda.flaps[i], t.charAt(i), retardo + i * 13, calmo);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2 · LOS DATOS
     ══════════════════════════════════════════════════════════════════════ */

  const MAX_PARTIDAS = 8;
  const MAX_LLEGADAS = 7;

  const ORDEN_NIVEL = { oportunidad: 0, bueno: 1, normal: 2, caro: 3 };

  const ESTADO_IDA = {
    oportunidad: { txt: 'EMBARCANDO', cls: 'board-est--verde board-est--late' },
    bueno:       { txt: 'A HORARIO',  cls: 'board-est--verde' },
    normal:      { txt: 'EN HORA',    cls: 'board-est--tiza' },
    caro:        { txt: 'DEMORADO',   cls: 'board-est--rojo' },
  };

  function estadoIda(nivel) { return ESTADO_IDA[nivel] || ESTADO_IDA.normal; }

  function estadoVuelta(i, n) {
    const q = n <= 1 ? 0 : i / (n - 1);
    if (i === 0)   return { txt: 'ATERRIZANDO', cls: 'board-est--verde board-est--late' };
    if (q < 0.34)  return { txt: 'EN VUELO',    cls: 'board-est--verde' };
    if (q < 0.75)  return { txt: 'EN HORA',     cls: 'board-est--tiza' };
    return { txt: 'DEMORADO', cls: 'board-est--rojo' };
  }

  /* "Miami y alrededores" → "MIAMI". Los carteles no tienen lugar para novelas. */
  function nombreCorto(s) {
    let t = String(s || '').split(/\s+y\s+|\s*\/\s*|,/i)[0].trim();
    if (!t) t = String(s || '').trim();
    if (t.length > 14) t = t.slice(0, 14).trim();
    return t;
  }

  /* Código de vuelo creíble y ESTABLE: sale de las millas + la ruta.
     La misma ruta da siempre el mismo número (nada de random por frame). */
  function codigoVuelo(millas, semilla) {
    const d = String(Math.abs(Math.round(Number(millas) || 0))).padStart(4, '0');
    const tres = d.slice(-4, -1);
    const s = String(semilla || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 10;
    return 'NV' + tres + h;
  }

  function fecha(iso) {
    if (!iso) return '--';
    try { return NV.dateLabel(iso); } catch (e) { return String(iso); }
  }
  function millas(n) {
    try { return NV.fmtMiles(n); } catch (e) { return String(n == null ? '--' : n); }
  }

  /* --- PARTIDAS: lo que encontró el radar, oportunidad primero --------- */
  function datosPartidas(ctx) {
    let R = [];
    try { R = (ctx.resultados || []).filter(r => r && r.destino_key); } catch (e) { R = []; }

    R = R.slice().sort((a, b) => {
      const na = ORDEN_NIVEL[a.nivel] == null ? 9 : ORDEN_NIVEL[a.nivel];
      const nb = ORDEN_NIVEL[b.nivel] == null ? 9 : ORDEN_NIVEL[b.nivel];
      if (na !== nb) return na - nb;
      return (a.mejor_precio_millas || 9e12) - (b.mejor_precio_millas || 9e12);
    });

    const vistas = new Set();
    const filas = [];
    for (const r of R) {
      const id = r.destino_key + '·' + (r.aeropuerto || '');
      if (vistas.has(id)) continue;               // una fila por ruta: la mejor
      vistas.add(id);
      const est = estadoIda(r.nivel);
      const nom = nombreCorto(r.destino_nombre || r.destino_key);
      const cod = r.aeropuerto || '';
      filas.push({
        k: r.destino_key,
        estCls: est.cls,
        txt: [
          cod ? nom + ' · ' + cod : nom,
          codigoVuelo(r.mejor_precio_millas, r.destino_key + cod + (r.ym || '')),
          fecha(r.mejor_fecha),
          est.txt,
          millas(r.mejor_precio_millas),
        ],
        lee: nom + ', vuelo ' + fecha(r.mejor_fecha) + ', ' + millas(r.mejor_precio_millas) + ' millas, ' + est.txt,
      });
      if (filas.length >= MAX_PARTIDAS) break;
    }
    return filas;
  }

  /* --- LLEGADAS: las vueltas (destino → EZE), de la más barata para arriba */
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
          if (!mejor || mi < mejor.mi || (mi === mejor.mi && f < mejor.f)) mejor = { code: code, f: f, mi: mi };
        });
      });
      if (mejor) crudo.push({ k: k, nombre: v.nombre || k, orig: v.orig || 'EZE', code: mejor.code, f: mejor.f, mi: mejor.mi });
    });

    crudo.sort((a, b) => (a.mi - b.mi) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
    const corte = crudo.slice(0, MAX_LLEGADAS);

    return corte.map((v, i) => {
      const est = estadoVuelta(i, corte.length);
      const nom = nombreCorto(v.nombre);
      return {
        k: v.k,
        estCls: est.cls,
        txt: [
          nom + ' · ' + v.code,
          codigoVuelo(v.mi, v.code + v.k + 'v'),
          fecha(v.f),
          est.txt,
          millas(v.mi),
        ],
        lee: 'desde ' + nom + ', llega ' + fecha(v.f) + ', ' + millas(v.mi) + ' millas, ' + est.txt,
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     3 · EL MUEBLE (markup)
     ══════════════════════════════════════════════════════════════════════ */

  const COLS = [
    { cls: 'dest',  n: 20, num: false, ali: 'i' },
    { cls: 'vuelo', n: 6,  num: false, ali: 'i' },
    { cls: 'sale',  n: 11, num: false, ali: 'i' },
    { cls: 'est',   n: 11, num: false, ali: 'i' },
    { cls: 'mi',    n: 8,  num: true,  ali: 'd' },
  ];
  const VACIO_N = 23;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fichas(n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += '<span class="board-flap"><span class="board-flap__c"> </span><span class="board-flap__l"></span></span>';
    }
    return s;
  }

  function celdaHTML(col, txt, extraCls) {
    return '<span class="board-celda board-c--' + col.cls + (extraCls ? ' ' + extraCls : '') + '"'
      + ' data-t="' + esc(txt) + '"'
      + ' data-n="' + col.n + '"'
      + (col.num ? ' data-a="n"' : '')
      + (col.ali === 'd' ? ' data-l="d"' : '')
      + ' aria-hidden="true">' + fichas(col.n) + '</span>';
  }

  function filaHTML(f, i) {
    const celdas = COLS.map((c, j) => celdaHTML(c, f.txt[j] || '', c.cls === 'est' ? f.estCls : '')).join('');
    return '<button type="button" class="board-fila" style="--i:' + i + '"'
      + ' data-k="' + esc(f.k) + '" aria-label="' + esc(f.lee || '') + '">'
      + celdas + '<span class="board-fila__flecha" aria-hidden="true">›</span></button>';
  }

  function filaVaciaHTML() {
    const col = { cls: 'vacia', n: VACIO_N, num: false, ali: 'i' };
    return '<div class="board-fila board-fila--vacia" style="--i:0">'
      + celdaHTML(col, 'SIN VUELOS EN PANTALLA', '') + '</div>';
  }

  function relojHTML() {
    return '<div class="board-reloj" aria-hidden="true">'
      + '<span class="board-reloj__lbl">hora local</span>'
      + '<span class="board-reloj__caja">'
      + fichas(2) + '<span class="board-dosp">:</span>' + fichas(2)
      + '<span class="board-dosp">:</span>' + fichas(2)
      + '</span></div>';
  }

  function muebleHTML(cfg, filas) {
    const cuerpo = filas.length ? filas.map(filaHTML).join('') : filaVaciaHTML();
    const n = filas.length || 1;
    return ''
      + '<div class="board-escena board-escena--' + cfg.clase + '">'
      +   '<div class="board-mueble">'
      +     '<span class="board-tirante board-tirante--izq"></span>'
      +     '<span class="board-tirante board-tirante--der"></span>'
      +     '<div class="board-luz"></div>'
      +     '<div class="board-marco">'
      +       '<i class="board-torn board-torn--a"></i><i class="board-torn board-torn--b"></i>'
      +       '<i class="board-torn board-torn--c"></i><i class="board-torn board-torn--d"></i>'
      +       '<div class="board-panel">'
      +         '<header class="board-head">'
      +           '<h2 class="board-head__tit"><span class="board-avion">✈</span>' + esc(cfg.titulo)
      +             '<em>' + esc(cfg.sub) + '</em></h2>'
      +           relojHTML()
      +         '</header>'
      +         '<div class="board-tabla" style="--c1:' + COLS[0].n + ';--c2:' + COLS[1].n
      +             ';--c3:' + COLS[2].n + ';--c4:' + COLS[3].n + ';--c5:' + COLS[4].n + '">'
      +           '<div class="board-cab" aria-hidden="true">'
      +             '<span class="board-c--dest">' + esc(cfg.colDest) + '</span>'
      +             '<span class="board-c--vuelo">Vuelo</span>'
      +             '<span class="board-c--sale">' + esc(cfg.colFecha) + '</span>'
      +             '<span class="board-c--est">Estado</span>'
      +             '<span class="board-c--mi">Millas</span>'
      +           '</div>'
      +           '<div class="board-filas" style="--n:' + n + ';--rp:0">' + cuerpo + '</div>'
      +         '</div>'
      +         '<footer class="board-pie">'
      +           '<span class="board-pie__led"></span>'
      +           '<span>' + esc(cfg.pie) + '</span>'
      +           '<span class="board-pie__hint">tocá una fila para el detalle</span>'
      +         '</footer>'
      +         '<div class="board-vidrio" aria-hidden="true"></div>'
      +       '</div>'
      +     '</div>'
      +     '<div class="board-sombra"></div>'
      +   '</div>'
      + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     4 · MONTAJE (una sola vez): del DOM a los objetos que mueve el motor
     ══════════════════════════════════════════════════════════════════════ */

  function leerCeldas(filaEl) {
    const celdas = [];
    const nodos = filaEl.querySelectorAll('.board-celda');
    for (let j = 0; j < nodos.length; j++) {
      const c = nodos[j];
      const alfa = c.getAttribute('data-a') === 'n' ? NUM : ALFA;
      const fl = c.querySelectorAll('.board-flap');
      const flaps = [];
      for (let i = 0; i < fl.length; i++) {
        flaps.push({ el: fl[i], c: fl[i].firstElementChild, alfa: alfa, i: 0, t: 0, k: i, paso: 32, next: 0 });
      }
      celdas.push({
        flaps: flaps,
        n: flaps.length,
        alfa: alfa,
        ali: c.getAttribute('data-l') === 'd' ? 'd' : 'i',
        txt: c.getAttribute('data-t') || '',
      });
    }
    return celdas;
  }

  function montar(el, ctx) {
    U = ctx.U || U;
    const B = {
      raiz: el,
      mueble: el.querySelector('.board-mueble'),
      filasEl: el.querySelector('.board-filas'),
      filas: [],
      reloj: [],
      relojUlt: '',
      timer: null,
      ultT: '', ultOp: -1, ultRp: -1, ultPe: '',
    };

    const nodos = el.querySelectorAll('.board-fila');
    for (let i = 0; i < nodos.length; i++) {
      B.filas.push({ el: nodos[i], celdas: leerCeldas(nodos[i]), on: false });
    }

    const rel = el.querySelectorAll('.board-reloj .board-flap');
    for (let i = 0; i < rel.length; i++) {
      B.reloj.push({ el: rel[i], c: rel[i].firstElementChild, alfa: NUM, i: 0, t: 0, k: i, paso: 30, next: 0 });
    }

    // Click en la fila → la ficha del destino (con clima, precios y armador)
    if (B.filasEl) {
      B.filasEl.addEventListener('click', ev => {
        const f = ev.target && ev.target.closest ? ev.target.closest('.board-fila') : null;
        const k = f && f.getAttribute('data-k');
        if (!k) return;
        /* si la ficha no puede abrirse (destino sin clima/cash), el cartel sigue vivo */
        try { ctx.abrirDestino(k); } catch (err) { /* silencio */ }
      });
    }

    hora(B, true);        // el reloj arranca con la hora correcta, sin girar
    return B;
  }

  /* ══════════════════════════════════════════════════════════════════════
     5 · MOVIMIENTO
     ══════════════════════════════════════════════════════════════════════ */

  function pintarFila(B, i, on, seco) {
    const f = B.filas[i];
    if (!f) return;
    const calmo = seco || (U && U.calmo ? U.calmo() : false);
    for (let j = 0; j < f.celdas.length; j++) {
      const c = f.celdas[j];
      ponerCelda(c, on ? c.txt : "", j * 42, calmo);   // cascada de izq. a der.
    }
  }

  function blanquear(B) {
    for (let i = 0; i < B.filas.length; i++) { B.filas[i].on = false; pintarFila(B, i, false, true); }
    B.ultRp = -1;
    if (B.filasEl) B.filasEl.style.setProperty('--rp', '0');
  }

  function hora(B, seco) {
    if (!B.reloj.length) return;
    const d = new Date();
    const t = String(d.getHours()).padStart(2, '0')
            + String(d.getMinutes()).padStart(2, '0')
            + String(d.getSeconds()).padStart(2, '0');
    if (t === B.relojUlt) return;
    B.relojUlt = t;
    const calmo = seco || (U && U.calmo ? U.calmo() : false);
    for (let i = 0; i < B.reloj.length; i++) girar(B.reloj[i], t.charAt(i), 0, calmo);
  }

  function poner(B, t, op) {
    if (!B.mueble) return;
    if (t !== B.ultT) { B.ultT = t; B.mueble.style.transform = t; }
    const o = op < 0 ? 0 : op > 1 ? 1 : op;
    if (Math.abs(o - B.ultOp) > 0.004) { B.ultOp = o; B.mueble.style.opacity = o.toFixed(3); }
    const pe = o > 0.55 ? 'auto' : 'none';
    if (pe !== B.ultPe && B.filasEl) { B.ultPe = pe; B.filasEl.style.pointerEvents = pe; }
  }

  /* El cartel se va cargando fila por fila mientras scrolleás. El CSS hace el
     fundido de cada fila con --rp/--i/--n; acá solo disparamos las fichas. */
  function revelar(B, rp) {
    if (Math.abs(rp - B.ultRp) > 0.0015) {
      B.ultRp = rp;
      if (B.filasEl) B.filasEl.style.setProperty('--rp', rp.toFixed(4));
    }
    const n = B.filas.length;
    if (!n) return;
    const carga = rp * (n + 0.6);
    for (let i = 0; i < n; i++) {
      const on = carga > i + 0.3;
      if (on !== B.filas[i].on) { B.filas[i].on = on; pintarFila(B, i, on, false); }
    }
  }

  function entrar(B) {
    blanquear(B);
    B.relojUlt = '';
    hora(B, true);
    if (B.timer) clearInterval(B.timer);
    B.timer = setInterval(() => hora(B, false), 1000);   // el reloj corre de verdad
  }

  function salir(B) {
    if (B.timer) { clearInterval(B.timer); B.timer = null; }
  }

  /* ══════════════════════════════════════════════════════════════════════
     6 · LAS DOS ESCENAS
     ══════════════════════════════════════════════════════════════════════ */

  let BP = null, BL = null;

  NV.escena('partidas', {
    html(ctx) {
      let filas = [];
      try { filas = datosPartidas(ctx); } catch (e) { filas = []; }
      return muebleHTML({
        clase: 'partidas',
        titulo: 'PARTIDAS',
        sub: 'departures',
        colDest: 'Destino',
        colFecha: 'Sale',
        pie: 'EZE · Ministro Pistarini · salidas con millas',
      }, filas);
    },
    mount(el, ctx) { BP = montar(el, ctx); },
    enter() { if (BP) entrar(BP); },
    exit() { if (BP) salir(BP); },
    update(p, ctx) {
      if (!BP) return;
      const u = ctx.U;
      const ent = u.easeOut(u.tramo(p, 0, 0.15));     // el cartel baja y aparece
      const sal = u.ease(u.tramo(p, 0.85, 1));        // y después se aleja
      const y  = u.lerp(-15, 0, ent) - sal * 6;
      const z  = -sal * 300;
      const sc = u.lerp(0.93, 1, ent) * u.lerp(1, 0.86, sal);
      const rx = u.lerp(11, 0, ent) + sal * 7;
      poner(BP,
        'translate3d(0,' + y.toFixed(2) + '%,' + z.toFixed(0) + 'px) rotateX(' + rx.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')',
        ent * (1 - sal * 0.92));
      BP.raiz.style.setProperty('--luz', (0.35 + 0.65 * ent).toFixed(3));
      revelar(BP, u.easeOut(u.tramo(p, 0.15, 0.85)));
    },
  });

  NV.escena('llegadas', {
    html(ctx) {
      let filas = [];
      try { filas = datosLlegadas(ctx); } catch (e) { filas = []; }
      return muebleHTML({
        clase: 'llegadas',
        titulo: 'LLEGADAS',
        sub: 'arrivals',
        colDest: 'Desde',
        colFecha: 'Llega',
        pie: 'vuelta a EZE · lo que hay para volver',
      }, filas);
    },
    mount(el, ctx) { BL = montar(el, ctx); },
    enter() { if (BL) entrar(BL); },
    exit() { if (BL) salir(BL); },
    update(p, ctx) {
      if (!BL) return;
      const u = ctx.U;
      const ent = u.easeOut(u.tramo(p, 0, 0.22));     // giro de cabeza al otro cartel
      const sal = u.ease(u.tramo(p, 0.88, 1));
      const x  = u.lerp(24, 0, ent) - sal * 9;
      const ry = u.lerp(-25, 0, ent) + sal * 13;
      const sc = u.lerp(0.9, 1, ent) * u.lerp(1, 0.87, sal);
      const z  = u.lerp(-180, 0, ent) - sal * 240;
      poner(BL,
        'translate3d(' + x.toFixed(2) + '%,0,' + z.toFixed(0) + 'px) rotateY(' + ry.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')',
        ent * (1 - sal * 0.92));
      BL.raiz.style.setProperty('--luz', (0.35 + 0.65 * ent).toFixed(3));
      revelar(BL, u.easeOut(u.tramo(p, 0.2, 0.85)));
    },
  });
})();
