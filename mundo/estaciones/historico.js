/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones/historico.js — la pizarra de cotizaciones.

   El activo más valioso del proyecto son los ~2.000 snapshots de data/historial.json
   (2 lecturas por día desde julio) y hasta hoy no se veían en ningún lado. Esta
   estación los pone en un monitor de aeropuerto, abajo a la derecha del ventanal.

   LEJOS  un titular grande de una línea: "3 rutas bajaron hoy", con el que más
          se movió, tres contadores y una tira de micro-sparklines.
   CERCA  tres secciones que scrollean adentro (.est__scroll[data-scroll-interno]):
            1 · QUÉ SE MOVIÓ            último snapshot vs el anterior
            2 · CÓMO VIENE CADA RUTA    sparkline + mínimo + cuánto está por encima
            3 · LAS MEJORES VENTANAS    el mínimo histórico de cada ruta y cuándo

   Los datos los carga esta estación sola: app.js NO lee historial.json. Se cruza
   con NV.state.latest.resultados (emoji/nombre/nivel) y, para las rutas que ya no
   se rastrean, con data/destinos.json (aeropuerto → destino). Cada fila llama a
   NV.openDestino(destino_key).

   Contrato NV.estacion: html / mount / enfocar / desenfocar. Sin tick: el fundido
   lejos↔cerca lo hace el CSS leyendo --zoom. El CSS propio (historico.css) se
   inyecta como <link> desde acá. Nada de filter:blur ni feTurbulence.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});
  if (typeof NV.estacion !== 'function') return;

  const SRC = (document.currentScript && document.currentScript.src) || '';

  /* ── CSS propio: un <link> junto a este script ─────────────────────────── */
  (function inyectarCSS() {
    if (document.querySelector('link[data-est-css="historico"]')) return;
    const href = SRC ? new URL('historico.css', SRC).href : 'mundo/estaciones/historico.css';
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.estCss = 'historico';
    document.head.appendChild(l);
  })();

  const URL_HIST = SRC ? new URL('../../data/historial.json', SRC).href : 'data/historial.json';

  /* ── helpers ────────────────────────────────────────────────────────────── */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const MESES = (NV.MONTHS && NV.MONTHS.length === 12) ? NV.MONTHS
    : ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const miles = n => (n == null ? '—' : (NV.fmtMiles ? NV.fmtMiles(n) : String(n)));
  const ymL = ym => { try { return NV.ymLabel ? NV.ymLabel(ym) : ym; } catch (e) { return ym || ''; } };
  const hace = iso => { try { return NV.haceCuanto ? NV.haceCuanto(iso) : ''; } catch (e) { return ''; } };

  const H_MS = 3600e3;
  const VIVA_H = 48;      // una ruta sigue "vigilada" si la vimos hace menos de 48 h
  const HOY_H = 36;       // un movimiento cuenta como "de hoy" si es más nuevo que esto

  /* "+12,4%" / "−32,9%" con el menos tipográfico y coma decimal (es-AR) */
  function pct(v, conSigno) {
    const a = Math.abs(v);
    const t = (a >= 100 ? a.toFixed(0) : a.toFixed(1)).replace('.', ',') + '%';
    if (!conSigno) return t;
    return (v < 0 ? '−' : '+') + t;
  }
  /* fecha corta de un snapshot: "hoy 14:44" · "ayer 09:03" · "13 Jul" */
  function cuando(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const hoy = new Date(); const dif = Math.floor((hoy - d) / 864e5);
    const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const mismoDia = d.toDateString() === hoy.toDateString();
    if (mismoDia) return 'hoy ' + hh;
    if (dif < 2) return 'ayer ' + hh;
    return d.getDate() + ' ' + MESES[d.getMonth()];
  }
  /* fecha de viaje "2027-03-09" → "9 Mar 2027" */
  function fviaje(iso) {
    if (!iso) return '';
    const p = String(iso).split('-'); if (p.length < 3) return iso;
    return (+p[2]) + ' ' + MESES[+p[1] - 1] + ' ' + p[0];
  }

  /* Qué tan lejos del mínimo está hoy → color y etiqueta. */
  function estado(sobre) {
    if (sobre == null) return { c: 'nd', t: 'sin dato' };
    if (sobre <= 0.5) return { c: 'min', t: 'tocando el piso' };
    if (sobre <= 8) return { c: 'cerca', t: 'cerca del mínimo' };
    if (sobre <= 25) return { c: 'medio', t: 'sobre el mínimo' };
    return { c: 'caro', t: 'lejos del mínimo' };
  }

  /* ── Datos ──────────────────────────────────────────────────────────────
     rutas: {"EZE-MIA-2027-03": {snapshots:[{ts,min_miles,min_date}]}}
     Se ordenan por ts (defensivo), se tiran los snapshots sin precio y se cruza
     con latest.json por r.ruta; si la ruta ya no se rastrea, el destino sale del
     código de aeropuerto contra destinos.json.                               */
  let crudo = null, tCarga = 0, cargando = null, elVivo = null, errorCarga = false;

  function mapaAeropuertos() {
    const D = (NV.state && NV.state.destinos && NV.state.destinos.destinos) || {};
    const m = {};
    for (const k of Object.keys(D)) for (const a of (D[k].aeropuertos || [])) if (a && a.code) m[a.code] = k;
    return m;
  }

  function procesar() {
    const R = (NV.state && NV.state.latest && NV.state.latest.resultados) || [];
    const porRuta = {}; for (const r of R) if (r && r.ruta) porRuta[r.ruta] = r;
    const D = (NV.state && NV.state.destinos && NV.state.destinos.destinos) || {};
    const AERO = mapaAeropuertos();
    const rutas = (crudo && crudo.rutas) || {};
    const ahora = Date.now();
    const out = [];

    for (const k of Object.keys(rutas)) {
      const s = ((rutas[k] || {}).snapshots || [])
        .filter(x => x && typeof x.min_miles === 'number' && x.min_miles > 0 && x.ts)
        .slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      if (!s.length) continue;

      const ultimo = s[s.length - 1], previo = s.length > 1 ? s[s.length - 2] : null;
      let min = Infinity, max = 0;
      for (const x of s) { if (x.min_miles < min) min = x.min_miles; if (x.min_miles > max) max = x.min_miles; }
      const enMin = s.filter(x => x.min_miles === min);
      const ultMin = enMin[enMin.length - 1];
      const sobre = min > 0 ? (ultimo.min_miles - min) / min * 100 : null;

      const partes = String(k).split('-');            // EZE-MIA-2027-03
      const origen = partes[0] || '', code = partes[1] || '';
      const ym = partes.length >= 4 ? partes[2] + '-' + partes[3] : '';

      const res = porRuta[k] || null;
      const destKey = (res && res.destino_key) || AERO[code] || null;
      const d = destKey ? D[destKey] : null;

      const edadH = (ahora - new Date(ultimo.ts).getTime()) / H_MS;
      out.push({
        ruta: k, origen, code, ym,
        destKey,
        nombre: (res && res.destino_nombre) || (d && d.nombre) || code,
        emoji: (res && res.destino_emoji) || (d && d.emoji) || '✈️',
        pais: (res && res.destino_pais) || (d && d.pais) || '',
        region: (res && res.region) || (d && d.region) || 'otros',
        nivel: res && res.nivel || null,
        snaps: s, n: s.length,
        ultimo, previo, min, max, sobre,
        vecesEnMin: enMin.length, ultMinTs: ultMin.ts, minDate: ultMin.min_date,
        edadH, viva: edadH < VIVA_H,
        delta: previo ? (ultimo.min_miles - previo.min_miles) : 0,
        deltaPct: previo && previo.min_miles > 0 ? (ultimo.min_miles - previo.min_miles) / previo.min_miles * 100 : 0,
        movidoHace: edadH,
      });
    }
    return out;
  }

  function resumen(rs) {
    const lecturas = rs.reduce((a, r) => a + r.n, 0);
    const vivas = rs.filter(r => r.viva);
    const conHist = vivas.filter(r => r.n >= 4);
    const movs = rs.filter(r => r.previo && r.delta !== 0);
    const frescos = movs.filter(r => r.movidoHace < HOY_H);
    const bajaron = frescos.filter(r => r.delta < 0).sort((a, b) => a.deltaPct - b.deltaPct);
    const subieron = frescos.filter(r => r.delta > 0).sort((a, b) => b.deltaPct - a.deltaPct);
    const enMinimo = conHist.filter(r => r.sobre <= 0.5);
    const cerca = conHist.filter(r => r.sobre > 0.5 && r.sobre <= 8);
    return { lecturas, total: rs.length, vivas, conHist, movs, frescos, bajaron, subieron, enMinimo, cerca };
  }

  /* ── Sparkline SVG (sin librerías, sin filtros) ──────────────────────────
     El dominio vertical incluye SIEMPRE el mínimo histórico, así la línea de
     puntos del piso se ve y de un vistazo sabés cuánto te falta para tocarlo. */
  function sparkline(snaps, minGlobal, clase, W, Hh, puntos) {
    const P = 3.5;
    const vs = snaps.slice(-(puntos || 30)).map(x => x.min_miles);
    const n = vs.length;
    if (!n) return '';
    let lo = minGlobal, hi = vs[0];
    for (const v of vs) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) hi = lo + Math.max(1, lo * 0.02);
    const x = i => P + (W - 2 * P) * (n === 1 ? 0.5 : i / (n - 1));
    const y = v => P + (Hh - 2 * P) * (1 - (v - lo) / (hi - lo));
    let d = '';
    for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(vs[i]).toFixed(1) + ' ';
    const area = d + 'L' + x(n - 1).toFixed(1) + ' ' + (Hh - P).toFixed(1) +
                 ' L' + x(0).toFixed(1) + ' ' + (Hh - P).toFixed(1) + ' Z';
    const yMin = y(lo).toFixed(1);
    return `<svg class="hi__spark hi__spark--${clase}" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" preserveAspectRatio="none" aria-hidden="true">
      <path class="hi__sparkArea" d="${area}"/>
      <line class="hi__sparkPiso" x1="${P}" y1="${yMin}" x2="${W - P}" y2="${yMin}"/>
      <path class="hi__sparkLinea" d="${d.trim()}"/>
      <circle class="hi__sparkFin" cx="${x(n - 1).toFixed(1)}" cy="${y(vs[n - 1]).toFixed(1)}" r="2.6"/>
    </svg>`;
  }

  /* ═══════════════════════════ LEJOS ═══════════════════════════════════════ */
  function vistaLejos(rs) {
    if (!rs) {
      return `<div class="hi__lejos" aria-hidden="true"><div class="hi__marco">
        <div class="hi__barra"><span class="hi__led"></span><span>histórico de precios</span></div>
        <div class="hi__titular hi__titular--nd">leyendo el archivo…</div>
        <div class="hi__pie">2 lecturas por día desde julio</div>
      </div></div>`;
    }
    const R = resumen(rs);
    let tono = 'quieto', titular, sub;
    if (R.bajaron.length) {
      tono = 'baja';
      titular = `${R.bajaron.length} ruta${R.bajaron.length === 1 ? '' : 's'} bajaron hoy`;
      const t = R.bajaron[0];
      sub = `${t.emoji} ${t.nombre} · ${ymL(t.ym)} ${pct(t.deltaPct, true)}`;
    } else if (R.subieron.length) {
      tono = 'suba';
      titular = `${R.subieron.length} ruta${R.subieron.length === 1 ? '' : 's'} subieron hoy`;
      const t = R.subieron[0];
      sub = `${t.emoji} ${t.nombre} · ${ymL(t.ym)} ${pct(t.deltaPct, true)}`;
    } else if (R.enMinimo.length) {
      tono = 'min';
      titular = `${R.enMinimo.length} en su mínimo histórico`;
      sub = R.enMinimo.slice(0, 2).map(r => `${r.emoji} ${r.nombre}`).join(' · ');
    } else {
      titular = 'sin cambios hoy';
      sub = `${R.vivas.length} rutas vigiladas, todas quietas`;
    }
    const tira = R.conHist.slice()
      .sort((a, b) => a.sobre - b.sobre).slice(0, 7)
      .map(r => `<i class="hi__micro hi__micro--${estado(r.sobre).c}">${sparkline(r.snaps, r.min, estado(r.sobre).c, 54, 30, 24)}</i>`).join('');
    return `<div class="hi__lejos" aria-hidden="true"><div class="hi__marco">
      <div class="hi__barra"><span class="hi__led"></span><span>histórico de precios</span><b>${miles(R.lecturas)} lecturas</b></div>
      <div class="hi__titular hi__titular--${tono}">${esc(titular)}</div>
      <div class="hi__sub">${esc(sub)}</div>
      <div class="hi__tira">${tira}</div>
      <div class="hi__conts">
        <span><b>${R.vivas.length}</b>rutas vigiladas</span>
        <span class="is-min"><b>${R.enMinimo.length}</b>en su mínimo</span>
        <span><b>${R.cerca.length}</b>a menos de 8%</span>
      </div>
      <div class="hi__pie">acercate para ver el archivo completo</div>
    </div></div>`;
  }

  /* ═══════════════════ 1 · QUÉ SE MOVIÓ ════════════════════════════════════ */
  function filaMov(r) {
    const baja = r.delta < 0;
    const viejo = r.movidoHace >= HOY_H;
    return `<button type="button" class="hi__mov hi__mov--${baja ? 'baja' : 'suba'}${viejo ? ' is-viejo' : ''}"
        data-dest="${esc(r.destKey || '')}" ${r.destKey ? '' : 'disabled'}
        title="${esc(r.ruta)} · lectura anterior ${esc(cuando(r.previo.ts))}">
      <span class="hi__movDelta">${baja ? '▼' : '▲'} ${esc(pct(r.deltaPct, false))}</span>
      <span class="hi__movQuien"><b>${esc(r.emoji)} ${esc(r.nombre)}</b><small>${esc(ymL(r.ym))} · ${esc(r.origen)}–${esc(r.code)}</small></span>
      <span class="hi__movNums"><s>${miles(r.previo.min_miles)}</s><em>${miles(r.ultimo.min_miles)}</em></span>
      <span class="hi__movCuando">${esc(cuando(r.ultimo.ts))}</span>
    </button>`;
  }

  function seccionMovimientos(rs) {
    const R = resumen(rs);
    const orden = l => l.slice().sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
    const viejos = R.movs.filter(r => r.movidoHace >= HOY_H);
    const bajaron = orden(R.frescos.filter(r => r.delta < 0));
    const subieron = orden(R.frescos.filter(r => r.delta > 0));
    const quietas = R.vivas.length - R.frescos.length;

    const col = (titulo, lista, clase, vacio) => `<div class="hi__col hi__col--${clase}">
      <h4><span>${titulo}</span><b>${lista.length}</b></h4>
      ${lista.length ? lista.map(filaMov).join('') : `<p class="hi__vacio">${vacio}</p>`}
    </div>`;

    return `<section class="hi__sec" id="hi-mov" data-sec="mov">
      <header class="hi__secCab">
        <h3><i>01</i> Qué se movió</h3>
        <p>Cada ruta comparada con la lectura anterior del rastrillaje. ${quietas} de las ${R.vivas.length} vigiladas quedaron en el mismo precio.</p>
      </header>
      <div class="hi__cols">
        ${col('Bajaron', bajaron, 'baja', 'Ninguna bajó en las últimas 36 h.')}
        ${col('Subieron', subieron, 'suba', 'Ninguna subió en las últimas 36 h.')}
      </div>
      ${viejos.length ? `<details class="hi__extra"><summary>${viejos.length} movimiento${viejos.length === 1 ? '' : 's'} más viejo${viejos.length === 1 ? '' : 's'} (rutas que el rastrillaje ya no consulta)</summary>
        <div class="hi__cols"><div class="hi__col">${orden(viejos).map(filaMov).join('')}</div></div></details>` : ''}
    </section>`;
  }

  /* ═════════════ 2 · CÓMO VIENE CADA RUTA (sparklines) ═════════════════════ */
  function filaRuta(r) {
    // Una ruta que el rastrillaje ya no consulta no puede decir "en su mínimo":
    // el dato tiene semanas. Se muestra en gris y sin veredicto.
    const e = r.viva ? estado(r.sobre) : { c: 'nd', t: 'sin datos nuevos' };
    const puntos = Math.min(r.n, 30);
    return `<button type="button" class="hi__ruta hi__ruta--${e.c}${r.viva ? '' : ' is-archivo'}"
        data-dest="${esc(r.destKey || '')}" ${r.destKey ? '' : 'disabled'}
        title="${esc(r.ruta)} · ${r.n} lecturas · última ${esc(cuando(r.ultimo.ts))}">
      <span class="hi__rutaMes">${esc(ymL(r.ym))}<small>${esc(r.origen)}–${esc(r.code)}</small><small>${puntos} de ${r.n} lecturas</small></span>
      <span class="hi__rutaGraf">${sparkline(r.snaps, r.min, e.c, 200, 40, 30)}</span>
      <span class="hi__rutaNums">
        <b>${miles(r.ultimo.min_miles)}</b>
        <small>mín ${miles(r.min)}</small>
      </span>
      <span class="hi__rutaSobre hi__rutaSobre--${e.c}">
        ${r.sobre <= 0.5 ? (r.viva ? 'EN SU MÍNIMO' : '=') : '+' + esc(pct(r.sobre, false))}
        <small>${esc(e.t)}</small>
      </span>
    </button>`;
  }

  function seccionRutas(rs) {
    const conHist = rs.filter(r => r.n >= 4);
    const grupos = {};
    for (const r of conHist) {
      const k = r.destKey || r.code;
      (grupos[k] = grupos[k] || { nombre: r.nombre, emoji: r.emoji, pais: r.pais, destKey: r.destKey, rutas: [] }).rutas.push(r);
    }
    const lista = Object.values(grupos);
    for (const g of lista) {
      g.rutas.sort((a, b) => (a.viva === b.viva ? String(a.ym).localeCompare(String(b.ym)) : (a.viva ? -1 : 1)));
      g.mejor = Math.min.apply(null, g.rutas.filter(r => r.viva).map(r => r.sobre).concat([999]));
      g.vivas = g.rutas.filter(r => r.viva).length;
    }
    lista.sort((a, b) => (a.mejor - b.mejor) || String(a.nombre).localeCompare(String(b.nombre)));

    const cuerpo = lista.map(g => `<div class="hi__grupo">
      <h4 class="hi__grupoCab"${g.destKey ? ` data-dest="${esc(g.destKey)}" role="button" tabindex="0"` : ''}>
        <span class="hi__grupoEmoji">${esc(g.emoji)}</span>
        <span class="hi__grupoNom"><b>${esc(g.nombre)}</b><small>${esc(g.pais)}</small></span>
        <span class="hi__grupoTag">${g.rutas.length} mes${g.rutas.length === 1 ? '' : 'es'}${g.vivas < g.rutas.length ? ` · ${g.vivas} vigilado${g.vivas === 1 ? '' : 's'}` : ''}</span>
      </h4>
      <div class="hi__grupoRutas">${g.rutas.map(filaRuta).join('')}</div>
    </div>`).join('');

    const nMin = conHist.filter(r => r.viva && r.sobre <= 0.5).length;
    return `<section class="hi__sec" id="hi-rutas" data-sec="rutas">
      <header class="hi__secCab">
        <h3><i>02</i> Cómo viene cada ruta</h3>
        <p>Últimas 30 lecturas de cada ruta con 4 o más. La línea punteada es el mínimo histórico: cuanto más pegada esté la curva al piso, mejor momento. Hoy hay <b>${nMin}</b> tocando el piso.</p>
      </header>
      <div class="hi__leyenda">
        <span class="hi__lg hi__lg--min">en su mínimo</span>
        <span class="hi__lg hi__lg--cerca">hasta +8%</span>
        <span class="hi__lg hi__lg--medio">hasta +25%</span>
        <span class="hi__lg hi__lg--caro">más de +25%</span>
        <span class="hi__lg hi__lg--arch">sin datos nuevos</span>
      </div>
      ${cuerpo || '<p class="hi__vacio">Todavía no hay ninguna ruta con 4 lecturas.</p>'}
    </section>`;
  }

  /* ═════════════ 3 · LAS MEJORES VENTANAS QUE VIMOS ════════════════════════ */
  function seccionMinimos(rs) {
    const lista = rs.slice().sort((a, b) => a.min - b.min);
    const filas = lista.map(r => {
      const e = r.viva ? estado(r.sobre) : { c: 'nd', t: 'sin datos nuevos' };
      return `<button type="button" class="hi__min${r.viva ? '' : ' is-archivo'}"
          data-dest="${esc(r.destKey || '')}" ${r.destKey ? '' : 'disabled'}
          title="${esc(r.ruta)}">
        <span class="hi__minQuien"><b>${esc(r.emoji)} ${esc(r.nombre)}</b><small>${esc(ymL(r.ym))} · ${esc(r.origen)}–${esc(r.code)}</small></span>
        <span class="hi__minPrecio">${miles(r.min)}<small>millas</small></span>
        <span class="hi__minVuelo">${esc(fviaje(r.minDate))}<small>para volar</small></span>
        <span class="hi__minVisto">${esc(cuando(r.ultMinTs))}<small>${r.vecesEnMin > 1 ? r.vecesEnMin + ' veces' : 'una sola vez'}</small></span>
        <span class="hi__minHoy hi__minHoy--${e.c}">${r.sobre <= 0.5 ? '=' : '+' + esc(pct(r.sobre, false))}<small>${miles(r.ultimo.min_miles)} hoy</small></span>
      </button>`;
    }).join('');
    return `<section class="hi__sec" id="hi-min" data-sec="min">
      <header class="hi__secCab">
        <h3><i>03</i> Las mejores ventanas que vimos</h3>
        <p>El precio más bajo que este radar le vio a cada ruta, la fecha de vuelo que lo tenía y cuándo lo vimos por última vez. Es el número al que hay que aspirar.</p>
      </header>
      <div class="hi__minTabla">
        <div class="hi__minCab"><span>ruta</span><span>mínimo visto</span><span>fecha de vuelo</span><span>última vez</span><span>vs hoy</span></div>
        ${filas}
      </div>
    </section>`;
  }

  /* ═══════════════════════════ CERCA ═══════════════════════════════════════ */
  function vistaCerca(rs) {
    if (!rs) {
      return `<div class="hi__cerca"><div class="hi__cargando">${errorCarga
        ? 'No pude leer <code>data/historial.json</code>.'
        : 'Leyendo el archivo de precios…'}</div></div>`;
    }
    const R = resumen(rs);
    const gen = NV.state && NV.state.latest && NV.state.latest.generado;
    return `<div class="hi__cerca">
      <header class="hi__cab">
        <div class="hi__cabTit"><span class="hi__led"></span>
          <b>Histórico de precios</b>
          <small>${miles(R.lecturas)} lecturas · ${R.total} rutas · ${R.vivas.length} vigiladas${gen ? ' · ' + esc(hace(gen)) : ''}</small>
        </div>
        <nav class="hi__nav">
          <button type="button" data-ir="mov" class="is-activa">01 Qué se movió</button>
          <button type="button" data-ir="rutas">02 Cómo viene</button>
          <button type="button" data-ir="min">03 Mejores ventanas</button>
        </nav>
        <button type="button" class="hi__soltar" data-soltar title="Volver a mirar alrededor (Esc)">↩ mirar alrededor</button>
      </header>
      <div class="hi__pantalla">
        <div class="est__scroll hi__scroll" data-scroll-interno>
          ${seccionMovimientos(rs)}
          ${seccionRutas(rs)}
          ${seccionMinimos(rs)}
          <p class="hi__firma">El motor guarda una lectura cada vez que rastrilla (2 por día). Nada de esto sale de tu Mac.</p>
        </div>
      </div>
    </div>`;
  }

  /* ═══════════════════════════ montaje ═════════════════════════════════════ */
  function html() {
    return `<div class="hi">${vistaLejos(null)}${vistaCerca(null)}</div>`;
  }

  function pintar(el) {
    if (!el) return;
    const rs = crudo ? procesar() : null;
    const raiz = el.querySelector('.hi'); if (!raiz) return;
    const sc = raiz.querySelector('.hi__scroll');
    const y = sc ? sc.scrollTop : 0;
    raiz.innerHTML = vistaLejos(rs) + vistaCerca(rs);
    const sc2 = raiz.querySelector('.hi__scroll');
    if (sc2 && y) sc2.scrollTop = y;
    engancharScroll(raiz);
  }

  async function cargar(el) {
    if (cargando) return cargando;
    cargando = (async () => {
      try {
        const r = await fetch(URL_HIST, { cache: 'no-cache' });
        if (!r.ok) throw new Error('http ' + r.status);
        const j = await r.json();
        if (!j || !j.rutas) throw new Error('sin rutas');
        crudo = j; tCarga = Date.now(); errorCarga = false;
      } catch (e) {
        errorCarga = true;
        console.warn('[historico] no pude leer historial.json:', e && e.message);
      } finally {
        cargando = null;
        pintar(el || elVivo);
      }
    })();
    return cargando;
  }

  /* Marca en la nav qué sección estás leyendo (una sola lectura por frame). */
  function engancharScroll(raiz) {
    const sc = raiz.querySelector('.hi__scroll'); if (!sc) return;
    let pedido = false;
    sc.addEventListener('scroll', () => {
      if (pedido) return; pedido = true;
      requestAnimationFrame(() => {
        pedido = false;
        const top = sc.scrollTop + 90;
        let act = 'mov';
        raiz.querySelectorAll('.hi__sec').forEach(s => { if (s.offsetTop <= top) act = s.dataset.sec; });
        raiz.querySelectorAll('.hi__nav button').forEach(b => b.classList.toggle('is-activa', b.dataset.ir === act));
      });
    }, { passive: true });
  }

  function mount(el, ctx) {
    elVivo = el;
    el.addEventListener('click', e => {
      const t = e.target;
      if (t.closest && t.closest('[data-soltar]')) { e.preventDefault(); ctx.soltar(); return; }
      const ir = t.closest && t.closest('[data-ir]');
      if (ir) {
        e.preventDefault();
        const sc = el.querySelector('.hi__scroll'), sec = el.querySelector('#hi-' + ir.dataset.ir);
        if (sc && sec) sc.scrollTo({ top: Math.max(0, sec.offsetTop - 6), behavior: 'smooth' });
        return;
      }
      const d = t.closest && t.closest('[data-dest]');
      if (d && d.dataset.dest) { e.preventDefault(); ctx.abrirDestino(d.dataset.dest); }
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const d = e.target.closest && e.target.closest('.hi__grupoCab[data-dest]');
      if (!d) return;
      e.preventDefault(); ctx.abrirDestino(d.dataset.dest);
    });
    // La hoja modal (ficha de destino) scrollea con la rueda: la cámara respeta
    // [data-scroll-interno]. Es idempotente y no toca ningún archivo ajeno.
    const panel = document.querySelector('#sheet .sheet__panel');
    if (panel && !panel.hasAttribute('data-scroll-interno')) panel.setAttribute('data-scroll-interno', '');

    cargar(el);

    // El texto del HUD lo escribe mundo/arranque.js con un mapa que no nos conoce.
    // Nos colgamos DESPUÉS de su hook (por eso el setTimeout) y completamos el
    // nombre de esta estación sin tocar ese archivo.
    setTimeout(() => {
      NV.camara.onFrame(cam => {
        if (cam.enfocada || cam.mirando !== 'historico') return;
        const p = document.getElementById('hudPista');
        if (p) p.textContent = 'estás mirando la pizarra del histórico · scrolleá o hacé clic para acercarte';
      });
    }, 0);
  }

  function enfocar(el) {
    el.classList.add('hi--foco');
    if (!crudo || Date.now() - tCarga > 120e3) cargar(el);
    else pintar(el);                     // latest.json pudo cambiar bajo nuestros pies
  }
  function desenfocar(el) { el.classList.remove('hi--foco'); }

  NV.estacion('historico', { html, mount, enfocar, desenfocar });
})();
