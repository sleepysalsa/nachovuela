/* ================= NachoVuela · app ================= */

/* ---- Clave de ingreso ----
   Hash SHA-256 de la clave. Para cambiarla, corré en la Terminal:
   python3 -c "import hashlib; print(hashlib.sha256('TU_NUEVA_CLAVE'.encode()).hexdigest())"
   y pegá el resultado acá. */
const PIN_HASH = '893993ca8c030d8316e3f50e4675e69473a1ca8f87d4e38e5843d04d43727fcb';
const GH_EDIT_CONFIG = 'https://github.com/sleepysalsa/nachovuela/edit/main/engine/config.json';

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_LONG = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DOW = ['L','M','M','J','V','S','D'];

const state = { latest:null, clima:null, destinos:null, config:null, filtro:'todos' };

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

async function loadJSON(path){
  try{ const r = await fetch(path,{cache:'no-cache'}); if(!r.ok) throw 0; return await r.json(); }
  catch(e){ return null; }
}

function fmtMiles(n){ return n==null ? '—' : n.toLocaleString('es-AR'); }

function ymLabel(ym){ const [y,m]=ym.split('-'); return `${MONTHS[+m-1]} ${y}`; }

function dateLabel(iso){
  const [y,m,d]=iso.split('-').map(Number);
  return `${d} ${MONTHS[m-1]} ${y}`;
}

function haceCuanto(iso){
  if(!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime())/1000;
  if(diff<90) return 'recién';
  if(diff<3600) return `hace ${Math.round(diff/60)} min`;
  if(diff<86400) return `hace ${Math.round(diff/3600)} h`;
  return `hace ${Math.round(diff/86400)} días`;
}

/* Deep link a la búsqueda de Smiles para esa ruta/fecha */
function smilesURL(r){
  const [y,m,d] = r.mejor_fecha.split('-').map(Number);
  const ms = new Date(y, m-1, d, 12, 0, 0).getTime();
  const p = new URLSearchParams({
    originAirportCode:r.origen, destinationAirportCode:r.aeropuerto,
    departureDate:String(ms), adults:'1', children:'0', infants:'0',
    tripType:'2', cabinType:'all', currencyCode:r.moneda||'USD',
    isFlexibleDateChecked:'false'
  });
  return `https://www.smiles.com.ar/emission?${p.toString()}`;
}

/* ---------- Candado ---------- */
async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function setupLock(){
  const lock = $('#lock');
  if(localStorage.getItem('nv_auth') === PIN_HASH){ lock.hidden = true; return; }
  lock.hidden = false;
  $('#lockPin').focus();
  $('#lockForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const h = await sha256hex($('#lockPin').value.trim());
    if(h === PIN_HASH){
      localStorage.setItem('nv_auth', h);
      lock.hidden = true;
    } else {
      const err = $('#lockErr');
      err.hidden = false;
      $('#lockPin').value = '';
      err.style.animation='none'; err.offsetHeight; err.style.animation='';
    }
  });
}

/* ---------- init ---------- */
async function init(){
  setupLock();
  [state.latest, state.clima, state.destinos, state.config] = await Promise.all([
    loadJSON('data/latest.json'),
    loadJSON('data/clima.json'),
    loadJSON('data/destinos.json'),
    loadJSON('engine/config.json'),
  ]);

  setupTabs();
  setupFilters();
  setupSheet();
  $('#editTripsBtn')?.addEventListener('click', openEditor);
  renderStatus();
  renderHero();
  renderStats();
  renderRadar();
  renderViajes();
  renderDestinos();
  registerSW();
}

function setupTabs(){
  $$('#tabs .tab').forEach(t=>t.addEventListener('click',()=>{
    $$('#tabs .tab').forEach(x=>x.classList.remove('is-active'));
    t.classList.add('is-active');
    $$('.view').forEach(v=>v.classList.remove('is-active'));
    $('#view-'+t.dataset.view).classList.add('is-active');
    window.scrollTo({top:0,behavior:'smooth'});
  }));
}

function setupFilters(){
  $$('#radarFilters .chip-filter').forEach(c=>c.addEventListener('click',()=>{
    $$('#radarFilters .chip-filter').forEach(x=>x.classList.remove('is-active'));
    c.classList.add('is-active');
    state.filtro = c.dataset.flt;
    renderRadar();
  }));
}

function renderStatus(){
  const el = $('#scanStatusText'); const foot = $('#footScan');
  if(!state.latest){ el.textContent='sin datos aún'; return; }
  const t = haceCuanto(state.latest.generado);
  el.textContent = `rastrillado ${t}`;
  foot.textContent = `último rastrillaje · ${state.latest.generado?.slice(0,16).replace('T',' ')}`;
}

/* ---------- HERO ---------- */
function renderHero(){
  const host = $('#heroTop');
  if(!state.latest || !state.latest.resultados.length){
    host.innerHTML = `<p class="hero__kicker">radar en espera</p>
      <div class="hero__route">Todavía no hay vuelos cargados</div>
      <p class="hero__sub">Corré el motor con <code>python3 engine/rastrillar.py</code> para empezar a cazar.</p>`;
    return;
  }
  const r = state.latest.resultados[0];
  const isOp = r.nivel==='oportunidad';
  host.innerHTML = `
    <p class="hero__kicker">${isOp?'🟢 oportunidad detectada':'mejor precio ahora'}</p>
    <div class="hero__route"><span class="emoji">${r.destino_emoji}</span> ${r.destino_nombre}</div>
    <p class="hero__sub">${r.origen_ciudad} → ${r.aeropuerto_ciudad} · ${dateLabel(r.mejor_fecha)}</p>
    <div class="hero__price">
      <span class="hero__miles">${fmtMiles(r.mejor_precio_millas)} <small>millas</small></span>
    </div>
    <a class="hero__cta" href="${smilesURL(r)}" target="_blank" rel="noopener">Abrir en Smiles ↗</a>`;
}

/* ---------- STATS ---------- */
function renderStats(){
  const host = $('#statStrip');
  if(!state.latest){ host.innerHTML=''; return; }
  const R = state.latest.resultados;
  const ops = R.filter(r=>r.nivel==='oportunidad').length;
  const rutas = R.length;
  const destinos = new Set(R.map(r=>r.destino_key)).size;
  const min = R.length ? Math.min(...R.map(r=>r.mejor_precio_millas)) : null;
  host.innerHTML = `
    <div class="stat op"><b>${ops}</b><span>oportunidades</span></div>
    <div class="stat"><b>${rutas}</b><span>rutas activas</span></div>
    <div class="stat"><b>${destinos}</b><span>destinos</span></div>
    <div class="stat"><b>${min?fmtMiles(min):'—'}</b><span>millas · mínimo</span></div>`;
}

/* ---------- RADAR CARDS ---------- */
function filtraResultados(){
  let R = state.latest ? [...state.latest.resultados] : [];
  const f = state.filtro;
  if(f==='oportunidad') R = R.filter(r=>r.nivel==='oportunidad'||r.nivel==='bueno');
  else if(f==='eeuu') R = R.filter(r=>r.region==='eeuu');
  else if(f==='europa') R = R.filter(r=>r.region==='europa');
  return R;
}

function nivelLabel(n){
  return {oportunidad:'🟢 Oportunidad',bueno:'🟢 Buen precio',normal:'⚪ Precio normal',caro:'🔴 Caro'}[n]||n;
}

function renderRadar(){
  const host = $('#radarCards');
  const R = filtraResultados();
  if(!R.length){ host.innerHTML = `<p class="empty">No hay rutas para este filtro todavía.</p>`; return; }
  host.innerHTML = R.map((r,i)=>cardHTML(r,i)).join('');
  // toggles + expand
  $$('.card').forEach(c=>{
    const btn = c.querySelector('[data-toggle]');
    if(btn) btn.addEventListener('click',()=>{
      c.querySelector('.monthcal').classList.toggle('open');
      btn.textContent = c.querySelector('.monthcal').classList.contains('open') ? 'Ocultar mes' : 'Ver el mes';
    });
  });
}

function meterHTML(range){
  let segs='';
  for(let i=1;i<=4;i++){
    const on = range && i<=range ? `on${range}` : '';
    // colorear solo el segmento activo del nivel
    segs += `<div class="meter__seg ${range===i?`on${i}`:''}"></div>`;
  }
  return `<div class="meter"><div class="meter__bar">${segs}</div>
    <div class="meter__lbl"><span>+ barato</span><span>+ caro</span></div></div>`;
}

function cardHTML(r,i){
  const op = r.nivel==='oportunidad';
  const motivo = r.motivos && r.motivos.length ? `<p class="card__motivo">✦ ${r.motivos[0]}</p>` : '';
  return `
  <article class="card lvl-${r.nivel}" style="animation-delay:${i*40}ms">
    <div class="card__top">
      <div>
        <div class="card__dest"><span class="emoji">${r.destino_emoji}</span> ${r.destino_nombre}</div>
        <div class="card__air">${r.origen}<span class="arw">→</span>${r.aeropuerto} · ${r.aeropuerto_ciudad}</div>
      </div>
      <span class="semaforo ${r.nivel}">${nivelLabel(r.nivel).replace(/^..\s/,'')}</span>
    </div>
    <div class="card__price">
      <span class="card__miles ${op?'op':''}">${fmtMiles(r.mejor_precio_millas)}</span>
      <span class="card__unit">millas</span>
    </div>
    <p class="card__when">mejor día: <b>${dateLabel(r.mejor_fecha)}</b> · ${ymLabel(r.ym)}${r.promedio_historico?` · prom. ${fmtMiles(r.promedio_historico)}`:''}</p>
    ${cashLine(r)}
    ${vueloLine(r)}
    ${motivo}
    ${meterHTML(r.price_range)}
    <div class="card__actions">
      <button class="btn" data-toggle>Ver el mes</button>
      <a class="btn btn--go" href="${smilesURL(r)}" target="_blank" rel="noopener">Abrir en Smiles ↗</a>
    </div>
    <div class="monthcal">${monthCalHTML(r)}</div>
  </article>`;
}

function fmtUSD(v){ return 'US$ ' + Math.round(v).toLocaleString('es-AR'); }

// Línea de precio cash + veredicto millas vs plata en la tarjeta
function cashLine(r){
  const c = r.cash;
  if(!c || !c.precio) return '';
  return `<p class="card__cash">💵 en plata: <b>${fmtUSD(c.precio)}</b>${c.escalas===0?' · <span class="esc-dir">directo</span>':(c.escalas!=null?` · ${escTxt(c.escalas)}`:'')}</p>`;
}

// Bloque grande de comparación para la ficha del destino
function comparaBlock(r){
  const c = r && r.cash;
  if(!c || !c.precio) return '';
  return `<div class="block">
    <h3>Millas vs plata · ${dateLabel(r.mejor_fecha)}</h3>
    <div class="vs">
      <div class="vs__side">
        <div class="vs__k">${fmtMiles(r.mejor_precio_millas)}</div>
        <div class="vs__u">millas (Smiles)</div>
      </div>
      <div class="vs__x">vs</div>
      <div class="vs__side">
        <div class="vs__k">${fmtUSD(c.precio)}</div>
        <div class="vs__u">en efectivo${c.escalas===0?' · directo':''}</div>
      </div>
    </div>
    ${c.link?`<a class="btn btn--ghost" style="display:inline-block;margin-top:10px;padding:8px 14px" href="${c.link}" target="_blank" rel="noopener">Ver vuelo en efectivo ↗</a>`:''}
    <p class="hint" style="margin-top:8px">El precio en efectivo es la mejor tarifa cash encontrada para esa ruta y mes (referencia para decidir si conviene usar millas o pagar).</p>
  </div>`;
}

function durTxt(min){
  if(min==null) return '';
  return `${Math.floor(min/60)} h ${String(min%60).padStart(2,'0')}`;
}
function escTxt(n){
  return n===0 ? 'directo' : (n===1 ? '1 escala' : `${n} escalas`);
}
function vueloLine(r){
  const v = r.detalle?.vuelos?.[0];
  if(!v) return '';
  const dir = v.escalas===0;
  const partes = [
    `<b>${v.aerolinea||v.codigo||'—'}</b>`,
    `<span class="${dir?'esc-dir':'esc-con'}">${escTxt(v.escalas)}</span>`,
    v.duracion_min!=null?durTxt(v.duracion_min):null,
    v.salida?`sale ${v.salida}`:null,
  ].filter(Boolean);
  const extra = r.detalle.directos>0 && !dir
    ? ` · <span class="esc-dir">hay ${r.detalle.directos} directo${r.detalle.directos>1?'s':''}</span>` : '';
  return `<p class="card__vuelo">✈ ${partes.join(' · ')}${extra}</p>`;
}
function vuelosBlock(det){
  if(!det?.vuelos?.length) return '';
  const rows = det.vuelos.slice(0,6).map(v=>`
    <div class="vrow">
      <div class="vrow__air"><b>${v.aerolinea||v.codigo||'—'}</b></div>
      <div class="vrow__time">${v.salida||'—'} → ${v.llegada||'—'}${v.duracion_min!=null?` · ${durTxt(v.duracion_min)}`:''}</div>
      <div class="vrow__tags"><span class="${v.escalas===0?'esc-dir':'esc-con'}">${escTxt(v.escalas)}</span>
        <span class="vrow__miles">${fmtMiles(v.millas)} mi</span></div>
    </div>`).join('');
  return `<div class="block"><h3>Vuelos del mejor día · ${dateLabel(det.fecha)}</h3>
    <div class="vlist">${rows}</div>
    <p class="hint" style="margin-top:8px">Del más barato al más caro. Verde = directo.</p></div>`;
}

function monthCalHTML(r){
  const [y,m] = r.ym.split('-').map(Number);
  const byDate = {}; r.dias.forEach(d=>byDate[d.date]=d);
  const first = new Date(y,m-1,1);
  const startDow = (first.getDay()+6)%7; // lunes=0
  const days = new Date(y,m,0).getDate();
  let cells = DOW.map(d=>`<div class="dow">${d}</div>`).join('');
  for(let i=0;i<startDow;i++) cells+=`<div></div>`;
  for(let d=1; d<=days; d++){
    const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const info = byDate[iso];
    if(info){
      const q = info.price_range?`q${info.price_range}`:'';
      const km = Math.round(info.miles/1000);
      const esBrasil = r.destino_pais==='Brasil';
      const gol = !esBrasil && info.fuente==='gol' ? ' gol' : '';
      const golTip = gol ? ' · solo vía GOL (conexión por Brasil)' : '';
      cells += `<div class="dcell has ${q}${gol}" title="${dateLabel(iso)}: ${fmtMiles(info.miles)} millas${golTip}"><span>${d}</span><span class="dm">${km}k</span></div>`;
    } else {
      cells += `<div class="dcell"><span>${d}</span></div>`;
    }
  }
  return `<div class="monthcal__grid">${cells}</div>`;
}

/* ---------- VIAJES ---------- */
function renderViajes(){
  const host = $('#viajesWrap');
  const viajes = state.config?.viajes?.filter(v=>v.activo) || [];
  if(!viajes.length){ host.innerHTML=`<p class="empty">No hay viajes activos en la configuración.</p>`; return; }
  const R = state.latest?.resultados || [];
  host.innerHTML = viajes.map(v=>{
    // mejor precio por destino dentro del viaje
    const porDest = {};
    R.filter(r=>v.destinos.includes(r.destino_key) && v.origenes.includes(r.origen))
     .forEach(r=>{ if(!porDest[r.destino_key] || r.mejor_precio_millas<porDest[r.destino_key].mejor_precio_millas) porDest[r.destino_key]=r; });
    const cells = Object.values(porDest)
      .sort((a,b)=>a.mejor_precio_millas-b.mejor_precio_millas)
      .map(r=>{
        const op = r.nivel==='oportunidad';
        return `<div class="bestcell ${op?'op':''}" data-ruta="${r.ruta}">
          <div class="bestcell__d">${r.destino_emoji} ${r.destino_nombre}</div>
          <div class="bestcell__m ${op?'op':''}">${fmtMiles(r.mejor_precio_millas)}</div>
          <div class="bestcell__w">millas · ${dateLabel(r.mejor_fecha)}</div>
        </div>`;
      }).join('') || `<p class="empty">Sin datos rastreados aún para este viaje.</p>`;
    return `<div class="viaje">
      <div class="viaje__head">
        <div class="viaje__name">${v.nombre}</div>
        <div class="viaje__meta">${v.origenes.join('/')} · ${v.meses.map(ymLabel).join(' · ')}</div>
      </div>
      ${v.notas?`<p class="viaje__notas">“${v.notas}”</p>`:''}
      <div class="viaje__best">${cells}</div>
    </div>`;
  }).join('');
  $$('.bestcell[data-ruta]').forEach(c=>c.addEventListener('click',()=>{
    const r = R.find(x=>x.ruta===c.dataset.ruta);
    if(r) openDestino(r.destino_key);
  }));
}

/* ---------- DESTINOS ---------- */
function renderDestinos(){
  const host = $('#destGrid');
  const D = state.destinos?.destinos || {};
  const R = state.latest?.resultados || [];
  const minPorDest = {};
  R.forEach(r=>{ if(!minPorDest[r.destino_key]||r.mejor_precio_millas<minPorDest[r.destino_key]) minPorDest[r.destino_key]=r.mejor_precio_millas; });
  const opsPorDest = {};
  R.forEach(r=>{ if(r.nivel==='oportunidad') opsPorDest[r.destino_key]=true; });

  host.innerHTML = Object.entries(D).map(([k,d])=>{
    const badge = opsPorDest[k]?`<span class="destcard__badge">🟢 oferta</span>`
      : (minPorDest[k]?`<span class="destcard__badge" style="color:var(--amber-lt);background:rgba(245,166,35,.1);border-color:rgba(245,166,35,.3)">${fmtMiles(minPorDest[k])}</span>`:'');
    return `<div class="destcard" data-dest="${k}">
      ${badge}
      <div class="destcard__emoji">${d.emoji}</div>
      <div>
        <div class="destcard__name">${d.nombre}</div>
        <div class="destcard__pais">${d.pais}</div>
      </div>
    </div>`;
  }).join('');
  $$('.destcard[data-dest]').forEach(c=>c.addEventListener('click',()=>openDestino(c.dataset.dest)));
}

/* ---------- SHEET (destino detail) ---------- */
function setupSheet(){
  const sheet = $('#sheet');
  $$('[data-close]',sheet).forEach(el=>el.addEventListener('click',closeSheet));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeSheet(); });
}
function closeSheet(){ $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden','true'); }

function openDestino(key){
  const d = state.destinos?.destinos?.[key];
  if(!d) return;
  const clima = state.clima?.destinos?.[key];
  const R = (state.latest?.resultados||[]).filter(r=>r.destino_key===key);

  // precios por mes (de lo rastreado)
  const porMes = {};
  R.forEach(r=>{ const mi=+r.ym.slice(5,7); if(!porMes[mi]||r.mejor_precio_millas<porMes[mi]) porMes[mi]=r.mejor_precio_millas; });

  const body = $('#sheetBody');
  body.innerHTML = `
    <div class="destcard__emoji" style="font-size:2.4rem">${d.emoji}</div>
    <h2 class="sheet__title">${d.nombre}</h2>
    <p class="sheet__pais">${d.pais} · ${d.aeropuertos.map(a=>a.code).join(' / ')}</p>
    ${bestFound(R)}
    ${comparaBlock(R.length ? R.reduce((a,b)=>a.mejor_precio_millas<=b.mejor_precio_millas?a:b) : null)}
    ${vuelosBlock(R.length ? ((R.reduce((a,b)=>a.mejor_precio_millas<=b.mejor_precio_millas?a:b).detalle) || (R.find(x=>x.detalle)?.detalle) || null) : null)}
    ${pricesByMonthBlock(porMes,R)}
    ${climateBlock(clima)}
    ${seasonHint(porMes, clima)}
  `;
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden','false');
}

function bestFound(R){
  if(!R.length) return `<div class="block"><p class="hint">Todavía no rastreamos precios para este destino. Agregalo a un viaje o a los destinos vigilados en la config y corré el motor.</p></div>`;
  const best = R.reduce((a,b)=>a.mejor_precio_millas<b.mejor_precio_millas?a:b);
  const op = best.nivel==='oportunidad';
  return `<div class="block">
    <h3>Mejor precio detectado</h3>
    <div class="card__price"><span class="card__miles ${op?'op':''}">${fmtMiles(best.mejor_precio_millas)}</span><span class="card__unit">millas</span></div>
    <p class="card__when">${best.origen} → ${best.aeropuerto} · <b>${dateLabel(best.mejor_fecha)}</b></p>
    <a class="btn btn--go" style="display:inline-block;margin-top:8px;padding:9px 16px" href="${smilesURL(best)}" target="_blank" rel="noopener">Abrir en Smiles ↗</a>
  </div>`;
}

function pricesByMonthBlock(porMes,R){
  if(!Object.keys(porMes).length) return '';
  const vals = Object.values(porMes);
  const max = Math.max(...vals), min = Math.min(...vals);
  let cols='';
  for(let m=1;m<=12;m++){
    const v = porMes[m];
    if(v){
      const h = 20 + ((max-v)/(max-min||1))*80; // más barato = más alto invertido? -> queremos barato = barra corta/verde
      const height = 15 + (v/max)*85;
      const op = v===min;
      cols += `<div class="pbm__col" title="${MONTHS_LONG[m-1]}: ${fmtMiles(v)} millas">
        <span class="pbm__v">${Math.round(v/1000)}k</span>
        <div class="pbm__bar ${op?'op':''}" style="height:${height}%"></div>
        <span class="pbm__m">${MONTHS[m-1]}</span></div>`;
    } else {
      cols += `<div class="pbm__col"><span class="pbm__v"></span><div class="pbm__bar none" style="height:10%"></div><span class="pbm__m">${MONTHS[m-1]}</span></div>`;
    }
  }
  return `<div class="block"><h3>Precio por mes (millas · lo rastreado)</h3>
    <div class="pbm">${cols}</div>
    <p class="hint" style="margin-top:10px">Barra <b>verde</b> = el mes más barato que registramos. Las grises aún no se rastrearon.</p></div>`;
}

function climateBlock(clima){
  if(!clima) return '';
  const meses = clima.meses;
  const W=520,H=170,padL=34,padR=14,padT=16,padB=26;
  const maxs = meses.map(x=>x.t_max).filter(v=>v!=null);
  const mins = meses.map(x=>x.t_min).filter(v=>v!=null);
  const hi = Math.ceil(Math.max(...maxs)), lo = Math.floor(Math.min(...mins));
  const x = i => padL + i*((W-padL-padR)/11);
  const y = t => H-padB - ((t-lo)/((hi-lo)||1))*(H-padT-padB);
  const line = key => meses.map((mm,i)=> (mm[key]==null?'':`${i===0?'M':'L'}${x(i).toFixed(1)},${y(mm[key]).toFixed(1)}`)).join(' ');
  // Eje Y: líneas de referencia con sus grados
  const ticks = [lo, Math.round((lo+hi)/2), hi];
  const grid = ticks.map(t=>`<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${W-padR}" y2="${y(t).toFixed(1)}" stroke="rgba(120,140,190,.15)" stroke-dasharray="2 4"/>
    <text x="${padL-5}" y="${(y(t)+3).toFixed(1)}" font-size="9" fill="var(--ink-dim)" text-anchor="end" font-family="var(--mono)">${t}°</text>`).join('');
  // Valores de máx y mín sobre las curvas, mes por medio para que respire
  const vals = meses.map((mm,i)=>{
    if(i%2!==0 || mm.t_max==null) return '';
    return `<text x="${x(i).toFixed(1)}" y="${(y(mm.t_max)-5).toFixed(1)}" font-size="8.5" fill="var(--red)" text-anchor="middle" font-family="var(--mono)" font-weight="700">${Math.round(mm.t_max)}°</text>
      <text x="${x(i).toFixed(1)}" y="${(y(mm.t_min)+12).toFixed(1)}" font-size="8.5" fill="var(--blue)" text-anchor="middle" font-family="var(--mono)" font-weight="700">${Math.round(mm.t_min)}°</text>`;
  }).join('');
  const dots = meses.map((mm,i)=> mm.t_media==null?'':`<circle cx="${x(i).toFixed(1)}" cy="${y(mm.t_media).toFixed(1)}" r="2.4" fill="var(--amber-lt)"/>`).join('');
  const labels = meses.map((mm,i)=>`<text x="${x(i).toFixed(1)}" y="${H-8}" font-size="8" fill="var(--ink-faint)" text-anchor="middle" font-family="var(--mono)">${MONTHS[i]}</text>`).join('');
  // Fila de temperaturas concretas, mes por mes
  const badges = meses.map((mm,i)=> mm.t_max==null?'':`<span class="tempbadge">${MONTHS[i]} <b style="color:var(--red)">${Math.round(mm.t_max)}°</b><i style="color:var(--ink-faint)">/</i><b style="color:var(--blue)">${Math.round(mm.t_min)}°</b></span>`).join('');
  return `<div class="block"><h3>Clima — promedio histórico (°C)</h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${grid}
      <path d="${line('t_max')}" fill="none" stroke="var(--red)" stroke-width="2" opacity=".85"/>
      <path d="${line('t_min')}" fill="none" stroke="var(--blue)" stroke-width="2" opacity=".85"/>
      <path d="${line('t_media')}" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="3 3" opacity=".9"/>
      ${vals}${dots}${labels}
    </svg>
    <div class="chart-legend"><span><i style="background:var(--red)"></i>máx</span>
      <span><i style="background:var(--amber)"></i>media</span>
      <span><i style="background:var(--blue)"></i>mín</span></div>
    <div style="margin-top:10px">${badges}</div></div>`;
}

function seasonHint(porMes, clima){
  const bits=[];
  if(Object.keys(porMes).length>=2){
    const entries=Object.entries(porMes).map(([m,v])=>[+m,v]);
    const cheapest=entries.reduce((a,b)=>a[1]<b[1]?a:b);
    const dearest=entries.reduce((a,b)=>a[1]>b[1]?a:b);
    bits.push(`El mes más barato rastreado es <b>${MONTHS_LONG[cheapest[0]-1]}</b> (${fmtMiles(cheapest[1])} millas); el más caro, <b>${MONTHS_LONG[dearest[0]-1]}</b>. Ahí se ve la temporada alta.`);
  }
  if(clima){
    const m=clima.meses.filter(x=>x.t_media!=null);
    if(m.length){
      const nice=m.filter(x=>x.t_media>=15&&x.t_media<=26).map(x=>MONTHS_LONG[x.mes-1]);
      if(nice.length) bits.push(`Temperatura más agradable (15–26°) en: <b>${nice.slice(0,6).join(', ')}</b>.`);
    }
  }
  if(!bits.length) return '';
  return `<div class="block"><h3>Para decidir la fecha</h3><p class="hint">${bits.join(' ')}</p></div>`;
}

/* ---------- Editor de viajes ---------- */
function proximosMeses(n){
  const out=[]; const hoy=new Date();
  for(let i=1;i<=n;i++){
    const d=new Date(hoy.getFullYear(), hoy.getMonth()+i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return out;
}

function chipsHTML(id, items, selected){
  return `<div class="ed-chips" id="${id}">` + items.map(it=>
    `<span class="ed-chip ${selected.includes(it.value)?'on':''}" data-v="${it.value}">${it.label}</span>`
  ).join('') + `</div>`;
}

function chipsSelected(id){
  return $$(`#${id} .ed-chip.on`).map(c=>c.dataset.v);
}

function openEditor(){
  const cfg = state.config || {moneda_default:'USD', viajes:[], destinos_vigilados:[], meses_vigilados:[]};
  const v = (cfg.viajes||[])[0] || {id:'viaje-1', nombre:'Mi próximo viaje', activo:true,
    origenes:['EZE'], destinos:[], meses:[], notas:''};
  const D = state.destinos?.destinos || {};
  const O = state.destinos?.origenes || {};
  const destItems = Object.entries(D).map(([k,d])=>({value:k, label:`${d.emoji} ${d.nombre}`}));
  const origItems = Object.keys(O).map(k=>({value:k, label:`${k} · ${O[k].ciudad}`}));
  const mesItems = proximosMeses(20).map(ym=>({value:ym, label:ymLabel(ym)}));

  const body = $('#sheetBody');
  body.innerHTML = `
    <h2 class="sheet__title">✏️ Editar viajes</h2>
    <p class="sheet__pais">elegí qué rastrillar — el motor lo toma en la próxima pasada</p>

    <label class="ed-label">Nombre del viaje</label>
    <input class="ed-input" id="edNombre" value="${(v.nombre||'').replace(/"/g,'&quot;')}">

    <label class="ed-label">Salir desde</label>
    ${chipsHTML('edOrig', origItems, v.origenes||[])}

    <label class="ed-label">Destinos en carpeta</label>
    ${chipsHTML('edDest', destItems, v.destinos||[])}

    <label class="ed-label">Meses del viaje</label>
    ${chipsHTML('edMeses', mesItems, v.meses||[])}

    <label class="ed-label">Notas</label>
    <input class="ed-input" id="edNotas" value="${(v.notas||'').replace(/"/g,'&quot;')}">

    <label class="ed-label">Vigilancia general (sin viaje puntual)</label>
    ${chipsHTML('edVigDest', destItems, cfg.destinos_vigilados||[])}
    <div style="height:8px"></div>
    ${chipsHTML('edVigMeses', mesItems, cfg.meses_vigilados||[])}

    <button class="ed-save" id="edSave">💾 Guardar cambios</button>
    <div class="ed-steps" id="edSteps" hidden>
      <b>¡Config copiada al portapapeles!</b> Se abrió GitHub en otra pestaña:<br>
      1. Borrá todo el contenido del archivo (tocá adentro, seleccioná todo y borrá).<br>
      2. Pegá lo copiado.<br>
      3. Tocá el botón verde <b>Commit changes</b> (dos veces).<br>
      El motor usa la nueva config en el próximo rastrillaje (9:00 / 20:00). 🛰️
    </div>`;

  // chips clickeables
  $$('.ed-chip', body).forEach(c=>c.addEventListener('click',()=>c.classList.toggle('on')));

  $('#edSave').addEventListener('click', async ()=>{
    const nuevo = {
      moneda_default: cfg.moneda_default || 'USD',
      viajes: [{
        id: v.id || 'viaje-1',
        nombre: $('#edNombre').value.trim() || 'Mi viaje',
        activo: true,
        origenes: chipsSelected('edOrig'),
        destinos: chipsSelected('edDest'),
        meses: chipsSelected('edMeses'),
        notas: $('#edNotas').value.trim(),
      }, ...(cfg.viajes||[]).slice(1)],
      destinos_vigilados: chipsSelected('edVigDest'),
      meses_vigilados: chipsSelected('edVigMeses'),
    };
    const json = JSON.stringify(nuevo, null, 2) + '\n';
    try { await navigator.clipboard.writeText(json); } catch(e) {
      // fallback viejo
      const ta=document.createElement('textarea'); ta.value=json; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    $('#edSteps').hidden = false;
    $('#edSteps').scrollIntoView({behavior:'smooth'});
    window.open(GH_EDIT_CONFIG, '_blank');
  });

  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden','false');
}

/* ---------- Service worker ---------- */
function registerSW(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

init();
