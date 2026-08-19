/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones/mac.js — la MacBook en el regazo.

   Cuando bajás la vista ves tu notebook sobre las piernas. LEJOS la pantalla
   muestra un resumen grande (la mejor oportunidad del radar + "tocá para
   buscar"). Al acercarte, SU PANTALLA es la pantalla: el buscador completo
   de combinaciones ida+vuelta, grande y cómodo, con scroll interno.

   Toda la lógica de negocio vive en app.js (NV.calcularCombos, NV.mejorArmado,
   NV.armadoTxt, NV.smilesRoundURL, NV.openArmador…): acá solo se arma la UI
   y se escribe NV.state.finder antes de pedir los combos.

   Contrato NV.estacion: html / mount / enfocar / desenfocar. Sin tick.
   El CSS propio (mac.css) se inyecta como <link> desde acá.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});
  if (typeof NV.estacion !== 'function') return;

  /* ── CSS propio: un <link> junto a este script ─────────────────────────── */
  (function inyectarCSS() {
    const src = document.currentScript && document.currentScript.src;
    const href = src ? new URL('mac.css', src).href : 'mundo/estaciones/mac.css';
    if (document.querySelector('link[data-est-css="mac"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.estCss = 'mac';
    document.head.appendChild(l);
  })();

  /* ── helpers ────────────────────────────────────────────────────────────── */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const miles = n => (n == null ? '—' : (NV.fmtMiles ? NV.fmtMiles(n) : String(n)));
  const usd = v => { try { return NV.fmtUSD ? NV.fmtUSD(v) : 'US$ ' + Math.round(v); } catch (e) { return ''; } };
  const ymL = ym => { try { return ym ? (NV.ymLabel ? NV.ymLabel(ym) : ym) : ''; } catch (e) { return ym || ''; } };
  const fecha = iso => { try { return iso ? (NV.dateLabel ? NV.dateLabel(iso) : iso) : ''; } catch (e) { return iso || ''; } };
  const hace = iso => { try { return NV.haceCuanto ? NV.haceCuanto(iso) : ''; } catch (e) { return ''; } };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const NIVEL = { oportunidad: 'oportunidad', bueno: 'buen precio', normal: 'normal', caro: 'caro' };
  const N_MIN = 1, N_MAX = 60, TOP = 8;

  const finder = () => (NV.state && NV.state.finder) || (NV.state.finder = { dest: null, orig: 'EZE', mes: null, nMin: 10, nMax: 20, esc: 'todos', diaIda: null });
  const bDest = () => { try { return NV.bDestinos ? (NV.bDestinos() || {}) : {}; } catch (e) { return {}; } };
  const mesesDe = k => { const d = bDest()[k]; return Object.keys((d && d.meses) || {}).sort(); };

  /* Estado del radar (para la cabecera): fresco si tiene menos de un día. */
  function radar() {
    const gen = NV.state && NV.state.latest && NV.state.latest.generado;
    if (!gen) return { txt: 'radar sin datos', frio: true };
    const h = (Date.now() - new Date(gen).getTime()) / 36e5;
    return { txt: 'radar · ' + hace(gen), frio: !(h < 30) };
  }

  /* La mejor oportunidad del radar (para el resumen de LEJOS). */
  function mejorDelRadar(ctx) {
    const R = (ctx && ctx.resultados) || [];
    const peso = { oportunidad: 0, bueno: 1, normal: 2, caro: 3 };
    let best = null;
    for (const r of R) {
      if (!r || r.mejor_precio_millas == null) continue;
      if (!best) { best = r; continue; }
      const pa = peso[r.nivel] == null ? 9 : peso[r.nivel], pb = peso[best.nivel] == null ? 9 : peso[best.nivel];
      if (pa < pb || (pa === pb && r.mejor_precio_millas < best.mejor_precio_millas)) best = r;
    }
    return best;
  }

  /* ── HTML: LEJOS (resumen grande dentro de la pantalla) ─────────────────── */
  function resumen(ctx) {
    const r = mejorDelRadar(ctx), rd = radar();
    const kicker = `<div class="kicker"><b>Nacho<em>Vuela</em></b><span><i></i>${esc(rd.txt)}</span></div>`;
    if (!r) {
      return `<div class="mac__resumen" aria-hidden="true">${kicker}
        <div class="nivel es-normal">buscador</div>
        <div class="dest">Tu buscador de millas</div>
        <div class="cuando">todavía no hay resultados del radar</div>
        <div class="cta">tocá para buscar</div></div>`;
    }
    const nivel = r.nivel || 'normal';
    return `<div class="mac__resumen" aria-hidden="true">${kicker}
      <div class="nivel es-${esc(nivel)}">${esc(NIVEL[nivel] || nivel)}</div>
      <div class="dest">${esc(r.destino_emoji || '')} ${esc(r.destino_nombre || r.destino_key || '')}</div>
      <div class="millas">${miles(r.mejor_precio_millas)}<small>millas</small></div>
      <div class="cuando">${esc(r.origen || '')} → ${esc(r.aeropuerto || '')} · ${esc(fecha(r.mejor_fecha))}</div>
      <div class="cta">tocá para buscar</div></div>`;
  }

  /* ── HTML: ENFOCADO (la UI del buscador) ────────────────────────────────── */
  function opcionesDestino(sel) {
    const B = bDest();
    return Object.keys(B).map(k => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(B[k].emoji || '✈️')} ${esc(B[k].nombre || k)}</option>`).join('');
  }
  function opcionesMes(k, sel) {
    const ms = mesesDe(k);
    if (!ms.length) return `<option value="">sin meses rastreados</option>`;
    return ms.map(m => `<option value="${esc(m)}"${m === sel ? ' selected' : ''}>${esc(ymL(m))}</option>`).join('');
  }

  function formulario() {
    const F = finder();
    const B = bDest(), keys = Object.keys(B);
    if (!keys.length) {
      return `<div class="mac__form mac__form--vacio"><div class="mac-vacio" style="grid-column:1/-1">
        <b>Todavía no hay datos del buscador</b>
        <p>Configurá un viaje (destinos + meses) en el radar y esperá el próximo rastrillaje.</p></div></div>`;
    }
    return `<form class="mac__form" novalidate>
      <label class="mac-fld"><span>Destino</span>
        <span class="mac-sel"><select name="dest" aria-label="Destino">${opcionesDestino(F.dest)}</select></span></label>
      <label class="mac-fld"><span>Mes</span>
        <span class="mac-sel"><select name="mes" aria-label="Mes">${opcionesMes(F.dest, F.mes)}</select></span></label>
      <div class="mac-fld"><span>Noches</span>
        <div class="mac-noches">
          <span class="mac-step" data-campo="nMin"><button type="button" data-d="-1" aria-label="Menos noches mínimas">−</button><output>${F.nMin}</output><button type="button" data-d="1" aria-label="Más noches mínimas">+</button></span>
          <em>a</em>
          <span class="mac-step" data-campo="nMax"><button type="button" data-d="-1" aria-label="Menos noches máximas">−</button><output>${F.nMax}</output><button type="button" data-d="1" aria-label="Más noches máximas">+</button></span>
        </div></div>
      <button type="submit" class="mac__go">Buscar combinaciones ✈</button>
    </form>`;
  }

  function veredicto(c) {
    let a = null;
    try { a = NV.mejorArmado ? NV.mejorArmado(c) : null; } catch (e) { a = null; }
    if (!a) return '';
    const txt = NV.armadoTxt ? NV.armadoTxt(a) : '';
    const todoMillas = a.mIda === 'millas' && a.mVta === 'millas';
    return `<span class="veredicto">${todoMillas ? 'conviene ' : '💡 conviene '}<b>${esc(txt)}</b>${a.totalEq != null ? ` · ≈ <strong>${esc(usd(a.totalEq))}</strong>` : ''}</span>`;
  }

  function filaCombo(c, i, ctx) {
    const F = finder(), d = bDest()[F.dest] || {};
    const orig = F.orig || d.origen || 'EZE';
    let smiles = '#';
    try { smiles = NV.smilesRoundURL ? NV.smilesRoundURL(orig, c.code, c.ida.d, c.vuelta.d, d.moneda) : '#'; } catch (e) { smiles = '#'; }
    return `<li class="mac-combo${i === 0 ? ' mac-combo--best' : ''}" style="animation-delay:${i * 40}ms">
      <div class="mac-combo__rank">${i + 1}</div>
      <div class="mac-combo__fechas">
        <span class="mac-leg"><i>IDA</i><b>${esc(fecha(c.ida.d))}</b><span>${miles(c.ida.mi)} mi</span></span>
        <span class="mac-combo__flecha" aria-hidden="true">→</span>
        <span class="mac-leg"><i>VUELTA</i><b>${esc(fecha(c.vuelta.d))}</b><span>${miles(c.vuelta.mi)} mi</span></span>
      </div>
      <div class="mac-combo__meta">
        <span class="ruta">${esc(orig)} ⇄ <b>${esc(c.code)}</b> · ${esc(c.ciudad || c.code)}</span>
        <span class="noches">${c.noches} noche${c.noches === 1 ? '' : 's'}</span>
        ${c.viaGol ? `<span class="gol" title="Alguna pierna solo sale conectando por Brasil (GOL)">vía Brasil</span>` : ''}
        ${veredicto(c)}
      </div>
      <div class="mac-combo__total"><b>${miles(c.total)}</b><small>millas ida+vuelta</small></div>
      <div class="mac-combo__acciones">
        <button type="button" class="mac-btn mac-btn--armar" data-armar="${i}">Armar 🔀</button>
        <a class="mac-btn" href="${esc(smiles)}" target="_blank" rel="noopener noreferrer">Abrir en Smiles ↗</a>
      </div>
    </li>`;
  }

  function resultados(combos, ctx) {
    const F = finder(), d = bDest()[F.dest];
    if (!d) return `<div class="mac-vacio"><b>Elegí un destino</b><p>y tocá “Buscar combinaciones”.</p></div>`;
    const orig = F.orig || d.origen || 'EZE';
    const head = `<div class="mac-rhead"><h2>${esc(d.emoji || '')} ${esc(d.nombre || F.dest)}<small>${esc(ymL(F.mes))}</small></h2>
      <p>${combos.length ? `${Math.min(combos.length, TOP)} mejores · ` : ''}${F.nMin}–${F.nMax} noches · desde ${esc(orig)}</p></div>`;
    if (!combos.length) {
      const bloque = (d.meses && d.meses[F.mes]) || {};
      const sinAward = !Object.values(bloque.ida || {}).some(a => a && a.length) && !Object.values(bloque.vuelta || {}).some(a => a && a.length);
      const code0 = ((d.aeropuertos || [])[0] || {}).code || '';
      const dia15 = F.mes ? `${F.mes}-15` : '';
      let links = '';
      if (code0 && dia15) {
        const g = NV.googleFlightsURL ? NV.googleFlightsURL(orig, code0, dia15) : '', de = NV.despegarDayURL ? NV.despegarDayURL(orig, code0, dia15) : '';
        links = `<div class="links">${g ? `<a class="mac-btn" href="${esc(g)}" target="_blank" rel="noopener noreferrer">Google Flights ↗</a>` : ''}${de ? `<a class="mac-btn" href="${esc(de)}" target="_blank" rel="noopener noreferrer">Despegar ↗</a>` : ''}</div>`;
      }
      return head + (sinAward
        ? `<div class="mac-vacio"><b>🎫 Smiles todavía no cargó premios para ${esc(ymL(F.mes))}</b>
            <p>Pasa seguido en temporada alta: los libera más cerca de la fecha. El radar chequea dos veces por día y los vas a ver acá apenas aparezcan. Mientras tanto, mirá los precios en plata:</p>${links}</div>`
        : `<div class="mac-vacio"><b>Sin combinaciones con ${F.nMin}–${F.nMax} noches</b>
            <p>Probá ampliar el rango de noches o cambiar el mes.</p>${links}</div>`);
    }
    const filas = combos.slice(0, TOP).map((c, i) => filaCombo(c, i, ctx)).join('');
    return head + `<ul class="mac-combos">${filas}</ul>
      <p class="mac-nota">El total suma millas de ida + la mejor vuelta dentro de tu rango de noches. <b>Armar</b> abre los calendarios para elegir otros días; <b>Smiles</b> abre la búsqueda ida y vuelta con esas fechas.</p>`;
  }

  function html(ctx) {
    const rd = radar();
    return `<div class="mac">
      <div class="mac__tapa">
        <span class="mac__cam" aria-hidden="true"></span>
        <div class="mac__pantalla">
          ${resumen(ctx)}
          <div class="mac__ui est__scroll" data-scroll-interno>
            <header class="mac__barra">
              <div class="titulo"><b>Nacho<em>Vuela</em></b><span>buscador</span></div>
              <div class="radar${rd.frio ? ' frio' : ''}"><i></i><span>${esc(rd.txt)}</span></div>
            </header>
            ${formulario()}
            <div class="mac__res"><div class="mac-vacio mac-vacio--inicio"><b>Elegí destino, mes y noches</b><p>y tocá “Buscar combinaciones ✈”. Te muestro las ${TOP} mejores idas y vueltas con millas.</p></div></div>
          </div>
        </div>
        <div class="mac__marca" aria-hidden="true">MacBook</div>
      </div>
      <div class="mac__teclado" aria-hidden="true"></div>
    </div>`;
  }

  /* ── comportamiento ─────────────────────────────────────────────────────── */
  let combosVivos = [], stamp = '';
  const sello = () => [NV.state && NV.state.latest && NV.state.latest.generado, NV.state && NV.state.busqueda && NV.state.busqueda.generado].join('|');

  function asegurarFinder() {
    const F = finder(), B = bDest(), keys = Object.keys(B);
    if (!keys.length) return F;
    if (!F.dest || !B[F.dest]) F.dest = keys[0];
    const ms = mesesDe(F.dest);
    if (!F.mes || !ms.includes(F.mes)) F.mes = ms[0] || null;
    F.orig = B[F.dest].origen || F.orig || 'EZE';
    F.nMin = clamp(+F.nMin || 10, N_MIN, N_MAX); F.nMax = clamp(+F.nMax || 20, F.nMin, N_MAX);
    if (!F.esc) F.esc = 'todos';
    return F;
  }

  function refrescarMeses(el) {
    const F = finder();
    const mSel = el.querySelector('select[name="mes"]'); if (!mSel) return;
    const ms = mesesDe(F.dest);
    if (!ms.includes(F.mes)) F.mes = ms[0] || null;
    mSel.innerHTML = opcionesMes(F.dest, F.mes);
    F.diaIda = null;
  }

  function pintarNoches(el) {
    const F = finder();
    el.querySelectorAll('.mac-step').forEach(s => {
      const o = s.querySelector('output'); if (o) o.textContent = F[s.dataset.campo];
    });
  }

  function buscar(el, ctx) {
    const F = asegurarFinder();
    F.diaIda = null;                       // acá no se elige día puntual
    const go = el.querySelector('.mac__go'), host = el.querySelector('.mac__res');
    if (go) go.classList.add('buscando');
    let combos = [];
    try { combos = NV.calcularCombos ? (NV.calcularCombos() || []) : []; } catch (e) { combos = []; }
    combosVivos = combos.slice(0, TOP);
    if (NV.state) NV.state.lastCombos = combos;   // openArmadoSheet (app.js) lee de acá
    if (host) host.innerHTML = resultados(combos, ctx);
    if (go) go.classList.remove('buscando');
    // Los resultados arrancan justo debajo del formulario: si el usuario ya
    // había scrolleado una lista anterior, volvemos arriba para verlos enteros.
    const sc = el.querySelector('.mac__ui');
    if (sc && sc.scrollTop > 0) { try { sc.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { sc.scrollTop = 0; } }
  }

  function rerender(el, ctx) {
    asegurarFinder();
    const lejos = el.querySelector('.mac__resumen'); if (lejos) lejos.outerHTML = resumen(ctx);
    const rd = radar(), rEl = el.querySelector('.mac__barra .radar');
    if (rEl) { rEl.classList.toggle('frio', rd.frio); const s = rEl.querySelector('span'); if (s) s.textContent = rd.txt; }
    const form = el.querySelector('.mac__form'); if (form) form.outerHTML = formulario();
    combosVivos = [];
    stamp = sello();
  }

  function mount(el, ctx) {
    asegurarFinder();
    const form = el.querySelector('.mac__form'); if (form) form.outerHTML = formulario();
    stamp = sello();

    el.addEventListener('change', e => {
      const t = e.target; if (!t || t.tagName !== 'SELECT') return;
      const F = finder();
      if (t.name === 'dest') { F.dest = t.value; const B = bDest(); F.orig = (B[F.dest] && B[F.dest].origen) || F.orig; refrescarMeses(el); }
      else if (t.name === 'mes') { F.mes = t.value || null; F.diaIda = null; }
    });

    el.addEventListener('click', e => {
      const t = e.target;
      const step = t.closest && t.closest('.mac-step button');
      if (step) {
        e.preventDefault();
        const F = finder(), campo = step.parentElement.dataset.campo, d = +step.dataset.d || 0;
        if (campo === 'nMin') { F.nMin = clamp(F.nMin + d, N_MIN, N_MAX); if (F.nMax < F.nMin) F.nMax = F.nMin; }
        else if (campo === 'nMax') { F.nMax = clamp(F.nMax + d, N_MIN, N_MAX); if (F.nMin > F.nMax) F.nMin = F.nMax; }
        pintarNoches(el);
        return;
      }
      const armar = t.closest && t.closest('[data-armar]');
      if (armar) {
        e.preventDefault();
        const c = combosVivos[+armar.dataset.armar]; if (!c) return;
        const F = finder();
        ctx.abrirArmador(F.dest, F.mes, c.code, c.ida.d, c.vuelta.d);
        return;
      }
      // los links a Smiles/Google/Despegar siguen su curso (target=_blank)
    });

    el.addEventListener('submit', e => {
      if (!e.target.closest || !e.target.closest('.mac__form')) return;
      e.preventDefault(); buscar(el, ctx);
    });

    // Que las flechas/Enter dentro de la UI no muevan la cámara (camara.js escucha en window)
    el.addEventListener('keydown', e => {
      if (!e.target.closest || !e.target.closest('.mac__ui')) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) e.stopPropagation();
    });

    // La hoja modal (Armador) scrollea con la rueda: la cámara respeta [data-scroll-interno].
    const panel = document.querySelector('#sheet .sheet__panel');
    if (panel && !panel.hasAttribute('data-scroll-interno')) panel.setAttribute('data-scroll-interno', '');
  }

  function enfocar(el, ctx) {
    if (sello() !== stamp) rerender(el, ctx);
    el.classList.add('mac--foco');
    const sc = el.querySelector('.mac__ui'); if (sc) sc.scrollTop = 0;
    // Primera vez (o datos nuevos): corremos la búsqueda con lo que hay en el
    // finder así la pantalla ya muestra combinaciones y no un vacío.
    if (!combosVivos.length && Object.keys(bDest()).length) buscar(el, ctx);
  }
  function desenfocar(el) { el.classList.remove('mac--foco'); }

  NV.estacion('mac', { html, mount, enfocar, desenfocar });
})();
