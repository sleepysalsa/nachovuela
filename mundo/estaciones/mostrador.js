/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/estaciones/mostrador.js — el mostrador de revistas.

   Un kiosco a la izquierda de la butaca con dos revistas apoyadas:
     · "Destinos"        → índice en grilla de todos los destinos (ficha al click)
     · "Lo que se dice"  → novedades de los blogs (Ratamundo, InfoViajera…)

   LEJOS  se ven las dos tapas con lomo y sombra sobre el mostrador.
   CERCA  dos pestañas de papel arriba y una página marfil con el índice, que
          scrollea adentro (data-scroll-interno). Nada de pasar páginas: se
          mira el índice y se elige qué abrir.

   Contrato NV.estacion: html / mount / enfocar / desenfocar. Sin tick: el
   fundido lejos↔cerca lo hace el CSS leyendo --zoom (lo escribe la cámara).
   El CSS propio (mostrador.css) se inyecta como <link> desde acá.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const NV = (window.NV = window.NV || {});
  if (typeof NV.estacion !== 'function') return;

  /* ── CSS propio: un <link> junto a este script ─────────────────────────── */
  (function inyectarCSS() {
    const src = document.currentScript && document.currentScript.src;
    const href = src ? new URL('mostrador.css', src).href : 'mundo/estaciones/mostrador.css';
    if (document.querySelector('link[data-est-css="mostrador"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.estCss = 'mostrador';
    document.head.appendChild(l);
  })();

  /* ── helpers ────────────────────────────────────────────────────────────── */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const MESES = (NV.MONTHS && NV.MONTHS.length === 12) ? NV.MONTHS
    : ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const MESES_L = (NV.MONTHS_LONG && NV.MONTHS_LONG.length === 12) ? NV.MONTHS_LONG
    : ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_HOY = new Date().getMonth() + 1;
  const miles = n => (n == null ? '—' : (NV.fmtMiles ? NV.fmtMiles(n) : String(n)));
  const ymL = ym => { try { return NV.ymLabel ? NV.ymLabel(ym) : ym; } catch (e) { return ym || ''; } };
  const hace = iso => { try { return NV.haceCuanto ? NV.haceCuanto(iso) : ''; } catch (e) { return ''; } };
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  const REGION = { eeuu: 'Estados Unidos', europa: 'Europa', sudamerica: 'Sudamérica', cabotaje: 'Argentina',
                   caribe: 'Caribe', asia: 'Asia', oceania: 'Oceanía' };
  const ORDEN_REGION = ['cabotaje', 'sudamerica', 'eeuu', 'europa', 'caribe', 'asia', 'oceania'];
  const NIVEL = { oportunidad: 'oportunidad', bueno: 'buen precio', normal: 'normal', caro: 'caro' };

  /* Frío azul → templado verde → calor ámbar → sofoco rojo (mismo criterio que la revista). */
  function colorTemp(t) {
    const u = clamp01((t - 1) / 34);   // ~1° azul · ~12° verde · ~22° ámbar · 35° rojo
    const w = Math.pow(u, 0.72);
    const h = 208 - w * 200, s = 52 + w * 22, l = 46 + Math.sin(u * Math.PI) * 8;
    return 'hsl(' + h.toFixed(0) + ' ' + s.toFixed(0) + '% ' + l.toFixed(0) + '%)';
  }

  /* ── datos ──────────────────────────────────────────────────────────────── */
  function mejorDe(resultados, k) {
    let best = null;
    for (const r of resultados) {
      if (!r || r.destino_key !== k || r.mejor_precio_millas == null) continue;
      if (!best || r.mejor_precio_millas < best.mejor_precio_millas) best = r;
    }
    return best;
  }
  function climaDe(k) {
    const cl = NV.state && NV.state.clima && NV.state.clima.destinos && NV.state.clima.destinos[k];
    const out = new Array(12).fill(null);
    if (cl && Array.isArray(cl.meses)) for (const m of cl.meses) {
      const mes = Number(m && m.mes), t = Number(m && m.t_media);
      if (mes >= 1 && mes <= 12 && isFinite(t)) out[mes - 1] = t;
    }
    return out;
  }
  function destinos(ctx) {
    const D = (NV.state && NV.state.destinos && NV.state.destinos.destinos) || {};
    const R = ctx.resultados || [];
    const lista = Object.keys(D).map(k => ({ k, d: D[k], best: mejorDe(R, k), meses: climaDe(k) }));
    lista.sort((a, b) => {
      const ra = ORDEN_REGION.indexOf(a.d.region), rb = ORDEN_REGION.indexOf(b.d.region);
      if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
      if (!!a.best !== !!b.best) return a.best ? -1 : 1;
      if (a.best && b.best) return a.best.mejor_precio_millas - b.best.mejor_precio_millas;
      return String(a.d.nombre || '').localeCompare(String(b.d.nombre || ''));
    });
    return lista;
  }
  function posts(ctx) {
    const P = (ctx.ofertas && ctx.ofertas.length ? ctx.ofertas : (NV.state && NV.state.ofertas && NV.state.ofertas.posts)) || [];
    return P.filter(p => p && p.titulo).slice()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }
  const slug = s => String(s || 'otro').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

  /* ── HTML: cerca ────────────────────────────────────────────────────────── */
  function tarjeta(it) {
    const { k, d, best, meses } = it;
    const franja = meses.map((t, i) => {
      const hoy = (i + 1) === MES_HOY ? ' is-hoy' : '';
      if (t == null) return `<i class="mo__c mo__c--nd${hoy}" title="${MESES[i]} · sin dato"></i>`;
      return `<i class="mo__c${hoy}" style="--c:${colorTemp(t)}" title="${MESES[i]} · ${t.toFixed(0)}°"></i>`;
    }).join('');
    const tHoy = meses[MES_HOY - 1];
    const tip = d.tips && d.tips[String(MES_HOY)];
    const precio = best
      ? `<div class="mo__precio mo__precio--${esc(best.nivel || 'normal')}"><b>${miles(best.mejor_precio_millas)}</b><small>mi · ${esc(ymL(best.ym))}</small><span class="mo__nivel">${esc(NIVEL[best.nivel] || best.nivel || '')}</span></div>`
      : `<div class="mo__precio mo__precio--sin"><small>sin precio en el radar</small></div>`;
    return `<button type="button" class="mo__card" data-dest="${esc(k)}" aria-label="Abrir ficha de ${esc(d.nombre)}">
      <div class="mo__card-top"><span class="mo__emoji">${esc(d.emoji || '✈️')}</span>
        <span class="mo__nom"><b>${esc(d.nombre)}</b><small>${esc(d.pais || REGION[d.region] || '')}</small></span></div>
      ${precio}
      <div class="mo__clima" title="Temperatura media por mes">
        <div class="mo__franja">${franja}</div>
        <div class="mo__meses"><span>E</span><span>F</span><span>M</span><span>A</span><span>M</span><span>J</span><span>J</span><span>A</span><span>S</span><span>O</span><span>N</span><span>D</span></div>
        ${tHoy != null ? `<div class="mo__thoy">${esc(MESES[MES_HOY - 1])} <b>${tHoy.toFixed(0)}°</b></div>` : ''}
      </div>
      ${tip ? `<p class="mo__tip"><em>${esc(MESES_L[MES_HOY - 1])}</em> ${esc(tip)}</p>` : `<p class="mo__tip mo__tip--vacio">Sin tip para ${esc(MESES_L[MES_HOY - 1])} · abrí la ficha</p>`}
      <span class="mo__ir">ficha completa →</span>
    </button>`;
  }

  function paginaDestinos(ctx) {
    const lista = destinos(ctx);
    if (!lista.length) return `<div class="mo__vacio"><p>Todavía no hay destinos cargados.</p></div>`;
    let html = '', regionActual = null;
    for (const it of lista) {
      const reg = it.d.region || 'otros';
      if (reg !== regionActual) {
        regionActual = reg;
        const n = lista.filter(x => (x.d.region || 'otros') === reg).length;
        html += `<h3 class="mo__seccion"><span>${esc(REGION[reg] || reg)}</span><small>${n} destino${n === 1 ? '' : 's'}</small></h3>`;
      }
      html += tarjeta(it);
    }
    return `<div class="mo__grid">${html}</div>`;
  }

  function paginaNovedades(ctx) {
    const P = posts(ctx);
    if (!P.length) return `<div class="mo__vacio"><p>Sin novedades por ahora.</p></div>`;
    const filas = P.map((p, i) => `<a class="mo__post" href="${esc(p.link || '#')}" target="_blank" rel="noopener noreferrer">
        <span class="mo__n">${String(i + 1).padStart(2, '0')}</span>
        <span class="mo__post-cuerpo">
          <span class="mo__fuente mo__fuente--${slug(p.fuente)}">${esc(p.fuente || 'blog')}</span>
          <span class="mo__tit">${esc(p.titulo)}</span>
        </span>
        <span class="mo__hace">${esc(hace(p.fecha))}</span>
        <span class="mo__ext" aria-hidden="true">↗</span>
      </a>`).join('');
    const fuentes = [...new Set(P.map(p => p.fuente).filter(Boolean))];
    return `<div class="mo__lista">
      <p class="mo__lista-cab">${P.length} notas · ${esc(fuentes.join(' · '))} · se abren en pestaña nueva</p>
      ${filas}</div>`;
  }

  /* ── HTML: lejos (las dos tapas sobre el mostrador) ─────────────────────── */
  function tapas(ctx) {
    const nD = Object.keys((NV.state && NV.state.destinos && NV.state.destinos.destinos) || {}).length;
    const nP = posts(ctx).length;
    const ops = (ctx.resultados || []).filter(r => r && r.nivel === 'oportunidad').length;
    return `<div class="mo__lejos" aria-hidden="true">
      <div class="mo__kiosco">revistas · mostrador</div>
      <div class="mo__tapa mo__tapa--dest">
        <span class="mo__lomo"></span>
        <span class="mo__tapa-et">NachoVuela · índice</span>
        <span class="mo__tapa-tit">Destinos</span>
        <span class="mo__tapa-baj">${nD} lugares · ${ops} oportunidad${ops === 1 ? '' : 'es'}</span>
        <span class="mo__tapa-emojis">🌴 🗽 🗼 🏔️ 🍷 🐧</span>
      </div>
      <div class="mo__tapa mo__tapa--novs">
        <span class="mo__lomo"></span>
        <span class="mo__tapa-et">lo que se dice</span>
        <span class="mo__tapa-tit">Novedades</span>
        <span class="mo__tapa-baj">${nP} notas de los blogs</span>
        <span class="mo__tapa-lineas"><i></i><i></i><i></i></span>
      </div>
      <div class="mo__repisa"></div>
    </div>`;
  }

  function html(ctx) {
    return `<div class="mo">
      ${tapas(ctx)}
      <div class="mo__cerca">
        <header class="mo__cab">
          <div class="mo__kicker">📰 Mostrador de revistas</div>
          <nav class="mo__tabs" role="tablist" aria-label="Revistas">
            <button type="button" role="tab" class="mo__tab is-activa" data-tab="dest" aria-selected="true">📍 Destinos</button>
            <button type="button" role="tab" class="mo__tab" data-tab="novs" aria-selected="false">📰 Novedades</button>
          </nav>
          <button type="button" class="mo__soltar" data-soltar title="Volver a mirar alrededor (Esc)">↩ mirar alrededor</button>
        </header>
        <div class="mo__pagina">
          <div class="est__scroll mo__scroll" data-scroll-interno>
            <section class="mo__pag mo__pag--dest" data-pag="dest">${paginaDestinos(ctx)}</section>
            <section class="mo__pag mo__pag--novs" data-pag="novs" hidden>${paginaNovedades(ctx)}</section>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* ── comportamiento ─────────────────────────────────────────────────────── */
  let tabActiva = 'dest', stamp = '';
  const sello = () => [NV.state?.latest?.generado, NV.state?.ofertas?.generado, NV.state?.clima?.generado].join('|');

  function mostrarTab(el, tab) {
    tabActiva = tab;
    el.querySelectorAll('.mo__tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-activa', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.querySelectorAll('.mo__pag').forEach(p => { p.hidden = p.dataset.pag !== tab; });
    const sc = el.querySelector('.mo__scroll'); if (sc) sc.scrollTop = 0;
    el.classList.toggle('mo--novs', tab === 'novs');
  }

  function rerender(el, ctx) {
    const d = el.querySelector('.mo__pag--dest'), n = el.querySelector('.mo__pag--novs');
    if (d) d.innerHTML = paginaDestinos(ctx);
    if (n) n.innerHTML = paginaNovedades(ctx);
    const lejos = el.querySelector('.mo__lejos');
    if (lejos) lejos.outerHTML = tapas(ctx);
    stamp = sello();
  }

  function mount(el, ctx) {
    stamp = sello();
    el.addEventListener('click', e => {
      const t = e.target;
      const tab = t.closest && t.closest('.mo__tab');
      if (tab) { e.preventDefault(); mostrarTab(el, tab.dataset.tab); return; }
      if (t.closest && t.closest('[data-soltar]')) { e.preventDefault(); ctx.soltar(); return; }
      const card = t.closest && t.closest('[data-dest]');
      if (card) { e.preventDefault(); ctx.abrirDestino(card.dataset.dest); return; }
      // los links de novedades siguen su curso (target=_blank)
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!e.target.closest || !e.target.closest('.mo__tabs')) return;
      e.preventDefault(); e.stopPropagation();
      mostrarTab(el, tabActiva === 'dest' ? 'novs' : 'dest');
      el.querySelector('.mo__tab.is-activa')?.focus();
    });
    // La hoja modal (ficha de destino) scrollea con la rueda: la cámara respeta
    // [data-scroll-interno]. Es idempotente y no toca ningún archivo ajeno.
    const panel = document.querySelector('#sheet .sheet__panel');
    if (panel && !panel.hasAttribute('data-scroll-interno')) panel.setAttribute('data-scroll-interno', '');
  }

  function enfocar(el, ctx) {
    if (sello() !== stamp) rerender(el, ctx);
    el.classList.add('mo--foco');
  }
  function desenfocar(el) { el.classList.remove('mo--foco'); }

  NV.estacion('mostrador', { html, mount, enfocar, desenfocar });
})();
