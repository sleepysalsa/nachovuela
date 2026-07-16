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

const state = { latest:null, clima:null, destinos:null, config:null, busqueda:null, filtro:'todos',
  finder:{ dest:null, orig:'EZE', mes:null, nMin:10, nMax:20, esc:'todos', diaIda:null } };

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
  [state.latest, state.clima, state.destinos, state.config, state.busqueda,
   state.meta, state.ofertas] = await Promise.all([
    loadJSON('data/latest.json'),
    loadJSON('data/clima.json'),
    loadJSON('data/destinos.json'),
    loadJSON('engine/config.json'),
    loadJSON('data/busqueda.json'),
    loadJSON('data/meta.json'),
    loadJSON('data/ofertas.json'),
  ]);

  setupTabs();
  setupFilters();
  setupSheet();
  $('#editTripsBtn')?.addEventListener('click', openEditor);
  setupFinder();
  renderStatus();
  renderHero();
  renderStats();
  renderRadar();
  renderDestinos();
  renderOfertas();
  renderIdeas();
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

/* ================= BUSCADOR ida+vuelta ================= */
function bDestinos(){ return state.busqueda?.destinos || {}; }

function setupFinder(){
  const B = bDestinos();
  const dSel = $('#fDest'), oSel = $('#fOrig'), mSel = $('#fMes');
  const keys = Object.keys(B);
  if(!keys.length){
    $('#finderForm').innerHTML = `<p class="empty">Todavía no hay datos del buscador. Configurá un viaje (destinos + meses) con “Configurar qué rastrillar” y esperá el próximo rastrillaje.</p>`;
    return;
  }
  // Destinos
  dSel.innerHTML = keys.map(k=>`<option value="${k}">${B[k].emoji} ${B[k].nombre}</option>`).join('');
  state.finder.dest = keys[0];

  // Orígenes (los que aparezcan en los destinos)
  const origs = [...new Set(keys.map(k=>B[k].origen))];
  const O = state.destinos?.origenes || {};
  oSel.innerHTML = origs.map(o=>`<option value="${o}">${o} · ${O[o]?.ciudad||o}</option>`).join('');
  state.finder.orig = origs[0];

  const refreshMeses = ()=>{
    const d = B[state.finder.dest];
    const meses = Object.keys(d?.meses||{}).sort();
    mSel.innerHTML = meses.map(m=>`<option value="${m}">${ymLabel(m)}</option>`).join('');
    state.finder.mes = meses[0] || null;
    renderDiasIda();
  };
  refreshMeses();

  dSel.addEventListener('change', ()=>{ state.finder.dest=dSel.value; refreshMeses(); });
  mSel.addEventListener('change', ()=>{ state.finder.mes=mSel.value; renderDiasIda(); });
  oSel.addEventListener('change', ()=>{ state.finder.orig=oSel.value; });
  $('#fNochesMin').addEventListener('input', e=>state.finder.nMin=+e.target.value||1);
  $('#fNochesMax').addEventListener('input', e=>state.finder.nMax=+e.target.value||1);
  $$('#fEscalas .segbtn').forEach(b=>b.addEventListener('click',()=>{
    $$('#fEscalas .segbtn').forEach(x=>x.classList.remove('is-active'));
    b.classList.add('is-active'); state.finder.esc=b.dataset.esc;
  }));
  $('#finderForm').addEventListener('submit', e=>{ e.preventDefault(); runFinder(); });
}

// Días de ida disponibles (unión de aeropuertos) para elegir uno puntual
function idaDaysUnion(dest, mes){
  const d = bDestinos()[dest]; if(!d) return {};
  const bloque = d.meses?.[mes]?.ida || {};
  const byDate = {};
  Object.values(bloque).forEach(arr=>arr.forEach(x=>{
    if(!byDate[x.d] || x.mi<byDate[x.d].mi) byDate[x.d]={...x};
  }));
  return byDate;
}

function renderDiasIda(){
  const host = $('#fDiasIda');
  const {dest, mes} = state.finder;
  const byDate = idaDaysUnion(dest, mes);
  const fechas = Object.keys(byDate).sort();
  state.finder.diaIda = null;
  if(!fechas.length){ host.innerHTML = `<p class="fld__hint">Sin días de ida rastreados para ese mes todavía.</p>`; return; }
  const [y,m] = mes.split('-').map(Number);
  const first = new Date(y,m-1,1); const startDow=(first.getDay()+6)%7;
  const ndays = new Date(y,m,0).getDate();
  const min = Math.min(...fechas.map(f=>byDate[f].mi));
  let cells = DOW.map(d=>`<div class="dow">${d}</div>`).join('');
  cells += `<button type="button" class="daychip any is-active" data-d="">Cualquiera</button>`;
  // relleno para alinear el "cualquiera" ocupa 1; ajustamos grilla con inicio
  for(let i=0;i<startDow;i++) cells+=`<div></div>`;
  for(let dd=1; dd<=ndays; dd++){
    const iso=`${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const info=byDate[iso];
    if(info){
      const km=Math.round(info.mi/1000);
      const best=info.mi===min?' best':'';
      const gol=info.f==='gol'?' gol':'';
      cells+=`<button type="button" class="daychip has${best}${gol}" data-d="${iso}" title="${dateLabel(iso)} · ${fmtMiles(info.mi)} millas"><span>${dd}</span><span class="dm">${km}k</span></button>`;
    } else {
      cells+=`<div class="daycell-empty">${dd}</div>`;
    }
  }
  host.innerHTML = `<div class="daygrid">${cells}</div>`;
  $$('.daychip',host).forEach(c=>c.addEventListener('click',()=>{
    $$('.daychip',host).forEach(x=>x.classList.remove('is-active'));
    c.classList.add('is-active');
    state.finder.diaIda = c.dataset.d || null;
  }));
}

function diasEntre(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }

/* ---- Valor de la milla y estrategia por pierna ---- */
// Costo real de reponer una milla, en US$: precio en ARS (Galicia/Smiles)
// convertido al dólar MEP del día. Viene calculado por el motor en meta.json.
function valorMilla(){
  return state.meta?.valor_milla_usd || state.busqueda?.valor_milla_usd || 0.012;
}
function valorMillaTxt(){
  const m = state.meta;
  if(!m?.dolar_mep) return `milla valuada a ${(valorMilla()*100).toFixed(1)}¢`;
  return `milla a AR$${m.precio_milla_ars.toFixed(2).replace('.',',')} ≈ ${(m.valor_milla_usd*100).toFixed(2)}¢ (dólar MEP $${Math.round(m.dolar_mep).toLocaleString('es-AR')})`;
}

// Cash de una pierna: precio del día exacto si existe; si no, referencia del mes.
// Si la referencia es de ida y vuelta, se estima la pierna como la mitad (≈½).
function cashLeg(bloque, tipo, code, fecha){
  const porDia = bloque['cash_'+tipo]?.[code];
  if(porDia && porDia[fecha]) return {p:porDia[fecha].p, e:porDia[fecha].e, nivel:'dia'};
  const ref = bloque.cash_ref?.[code]?.[tipo];
  if(ref && ref.p!=null){
    if(ref.t==='ida_vuelta') return {p:Math.round(ref.p/2), e:ref.e, nivel:'mitad_iv'};
    return {p:ref.p, e:ref.e, nivel:ref.x?'mes':'ruta'};
  }
  return null;
}
function cashNivelTxt(n){
  return {dia:'precio de ese día', mes:'ref. del mes', ruta:'ref. de la ruta', mitad_iv:'≈ mitad de un ida y vuelta'}[n]||'';
}
function cpp(cashUSD, millas){ return millas ? (cashUSD/millas)*100 : null; } // ¢ por milla

// Decide el mejor armado del viaje (qué pierna pagar con millas y cuál en plata)
function mejorArmado(c){
  const V = valorMilla();
  const opciones = [];
  const mi = {tipo:'millas', ida:c.ida.mi, vuelta:c.vuelta.mi};
  const ci = c.cashIda, cv = c.cashVuelta;
  const eq = (leg, modo)=> modo==='millas' ? leg.mi*V : leg.cash.p;
  const push=(mIda,mVta)=>{
    if(mIda==='plata'&&!ci) return; if(mVta==='plata'&&!cv) return;
    const totalEq = (mIda==='millas'? c.ida.mi*V : ci.p) + (mVta==='millas'? c.vuelta.mi*V : cv.p);
    opciones.push({mIda, mVta, totalEq});
  };
  push('millas','millas'); push('millas','plata'); push('plata','millas'); push('plata','plata');
  if(!opciones.length) return null;
  opciones.sort((a,b)=>a.totalEq-b.totalEq);
  return opciones[0];
}
function armadoTxt(a){
  if(!a) return '';
  const w = m=> m==='millas'?'millas':'plata';
  if(a.mIda==='millas'&&a.mVta==='millas') return 'todo en millas';
  if(a.mIda==='plata'&&a.mVta==='plata') return 'todo en plata';
  return `ida en ${w(a.mIda)} + vuelta en ${w(a.mVta)}`;
}

// Deep link a Smiles: viaje redondo (ida+vuelta) para un aeropuerto y fechas
function smilesRoundURL(orig, code, idaISO, vueltaISO, moneda){
  const ms = iso=>{ const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d,12,0,0).getTime(); };
  const p = new URLSearchParams({
    originAirportCode:orig, destinationAirportCode:code,
    departureDate:String(ms(idaISO)), returnDate:String(ms(vueltaISO)),
    adults:'1', children:'0', infants:'0', tripType:'1', cabinType:'all',
    currencyCode:moneda||'USD', isFlexibleDateChecked:'false'
  });
  return `https://www.smiles.com.ar/emission?${p.toString()}`;
}
function smilesOneWayURL(orig, code, idaISO, moneda){
  const [y,m,d]=idaISO.split('-').map(Number);
  const ms=new Date(y,m-1,d,12,0,0).getTime();
  const p=new URLSearchParams({originAirportCode:orig,destinationAirportCode:code,
    departureDate:String(ms),adults:'1',children:'0',infants:'0',tripType:'2',
    cabinType:'all',currencyCode:moneda||'USD',isFlexibleDateChecked:'false'});
  return `https://www.smiles.com.ar/emission?${p.toString()}`;
}

// Núcleo: mejores combinaciones ida+vuelta
function calcularCombos(){
  const {dest, orig, mes, nMin, nMax, esc, diaIda} = state.finder;
  const d = bDestinos()[dest]; if(!d) return [];
  const bloque = d.meses?.[mes]; if(!bloque) return [];
  const soloDirecto = esc==='directo';
  const esBrasil = d.pais==='Brasil';
  const combos = [];
  for(const code of Object.keys(bloque.ida||{})){
    let idas = bloque.ida[code]||[];
    const vueltas = bloque.vuelta?.[code]||[];
    if(!vueltas.length) continue;
    if(diaIda) idas = idas.filter(x=>x.d===diaIda);
    if(soloDirecto && !esBrasil){ idas=idas.filter(x=>x.f!=='gol'); }
    for(const ida of idas){
      let mejor=null;
      for(const v of vueltas){
        const n = diasEntre(ida.d, v.d);
        if(n<nMin || n>nMax) continue;
        if(soloDirecto && !esBrasil && v.f==='gol') continue;
        if(!mejor || (ida.mi+v.mi)<mejor.total){
          mejor={total:ida.mi+v.mi, vuelta:v, noches:n};
        }
      }
      if(mejor){
        combos.push({
          code, ciudad:(d.aeropuertos.find(a=>a.code===code)||{}).ciudad||code,
          ida, vuelta:mejor.vuelta, noches:mejor.noches, total:mejor.total,
          viaGol: (!esBrasil && (ida.f==='gol'||mejor.vuelta.f==='gol')),
          cashIda: cashLeg(bloque,'ida',code,ida.d),
          cashVuelta: cashLeg(bloque,'vuelta',code,mejor.vuelta.d),
        });
      }
    }
  }
  // dedupe: una combinación por (aeropuerto, día de ida), quedándonos con el mejor total
  const best={};
  combos.forEach(c=>{ const k=c.code+'|'+c.ida.d; if(!best[k]||c.total<best[k].total) best[k]=c; });
  return Object.values(best).sort((a,b)=>a.total-b.total).slice(0,15);
}

// Referencia cash del destino/mes (de lo que ya rastreamos en el radar)
function cashRefDestino(dest, mes){
  const R = (state.latest?.resultados||[]).filter(r=>r.destino_key===dest && r.ym===mes && r.cash);
  if(!R.length) return null;
  return R.reduce((a,b)=> (a.cash.precio<=b.cash.precio? a : b)).cash;
}

function runFinder(){
  const host = $('#finderResults');
  const {dest, orig, mes, nMin, nMax} = state.finder;
  const d = bDestinos()[dest];
  const combos = calcularCombos();
  const cashRef = cashRefDestino(dest, mes);
  const cashHTML = cashRef ? `<div class="res__cash">💵 Referencia en plata para ${d.nombre}: <b>${fmtUSD(cashRef.precio)}</b> <span class="cash__t">${cashTipoTxt(cashRef)}</span>${cashRef.link?` · <a href="${cashRef.link}" target="_blank" rel="noopener">ver en Aviasales ↗</a>`:''}</div>` : '';

  if(!combos.length){
    host.innerHTML = `<div class="res__head"><h2>${d.emoji} ${d.nombre} · ${ymLabel(mes)}</h2></div>
      ${cashHTML}
      <p class="empty">No encontré combinaciones ida+vuelta con ${nMin}–${nMax} noches para ese mes. Probá ampliar el rango de noches, cambiar el mes, o sacar “Cualquiera” en el día de salida.</p>`;
    host.scrollIntoView({behavior:'smooth'});
    return;
  }
  const minTotal = combos[0].total;
  const rows = combos.map((c,i)=>{
    const esMin = c.total===minTotal;
    return `<article class="combo${esMin?' combo--best':''}" style="animation-delay:${i*35}ms">
      <div class="combo__rank">${i+1}</div>
      <div class="combo__body">
        <div class="combo__legs">
          <div class="leg">
            <span class="leg__tag">IDA</span>
            <span class="leg__date">${dateLabel(c.ida.d)}</span>
            <span class="leg__mi">${fmtMiles(c.ida.mi)} mi</span>
          </div>
          <div class="leg">
            <span class="leg__tag">VUELTA</span>
            <span class="leg__date">${dateLabel(c.vuelta.d)}</span>
            <span class="leg__mi">${fmtMiles(c.vuelta.mi)} mi</span>
          </div>
        </div>
        <div class="combo__meta">
          <span class="combo__air">${orig} <span class="arw">⇄</span> ${c.code} · ${c.ciudad}</span>
          <span class="combo__nights">${c.noches} noches</span>
          ${c.viaGol?`<span class="combo__gol" title="Alguna pierna solo sale conectando por Brasil (GOL)">vía Brasil</span>`:''}
        </div>
        ${armadoLine(c)}
      </div>
      <div class="combo__side">
        <div class="combo__total">${fmtMiles(c.total)}</div>
        <div class="combo__totu">millas ida+vuelta</div>
        <a class="btn btn--go combo__cta" href="${smilesRoundURL(orig,c.code,c.ida.d,c.vuelta.d,d.moneda)}" target="_blank" rel="noopener">Abrir en Smiles ↗</a>
        <button class="combo__detail" data-idx="${i}">armar este viaje →</button>
      </div>
    </article>`;
  }).join('');
  state.lastCombos = combos;

  host.innerHTML = `
    <div class="res__head">
      <h2>${d.emoji} ${d.nombre} · ${ymLabel(mes)}</h2>
      <p class="res__sub">${combos.length} mejores combinaciones · ${nMin}–${nMax} noches · saliendo desde ${orig}</p>
    </div>
    ${cashHTML}
    <div class="combos">${rows}</div>
    <p class="hint" style="margin-top:12px">El total es la suma de millas de ida + vuelta (el mejor regreso dentro de tu rango de noches). Tocá <b>“armar este viaje”</b> para comparar pierna por pierna si conviene millas o plata, con los links a Smiles, Despegar y Aviasales de ese día exacto.</p>`;
  $$('.combo__detail',host).forEach(b=>b.addEventListener('click',()=>openArmadoSheet(+b.dataset.idx)));
  host.scrollIntoView({behavior:'smooth'});
}

// Línea "mejor armado" en la tarjeta de combo
function armadoLine(c){
  const a = mejorArmado(c);
  if(!a || (a.mIda==='millas'&&a.mVta==='millas')) return '';
  return `<p class="combo__armado">💡 conviene: <b>${armadoTxt(a)}</b> · total ≈ ${fmtUSD(a.totalEq)}</p>`;
}

// Links de un día puntual en todas las fuentes
function aviasalesDayURL(og, de, iso){
  const [,m,d] = iso.split('-');
  return `https://www.aviasales.com/search/${og}${d}${m}${de}1`;
}
function despegarDayURL(og, de, iso){
  return `https://www.despegar.com.ar/shop/flights/results/oneway/${og}/${de}/${iso}/1/0/0`;
}
function googleFlightsURL(og, de, iso, vueltaISO){
  const q = vueltaISO
    ? `Flights from ${og} to ${de} on ${iso} through ${vueltaISO}`
    : `Flights from ${og} to ${de} on ${iso} one way`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=USD`;
}
function kayakURL(og, de, iso, vueltaISO){
  return `https://www.kayak.com.ar/flights/${og}-${de}/${iso}${vueltaISO?'/'+vueltaISO:''}?sort=price_a`;
}

// Qué aerolíneas vuelan esta ruta (curado) — para saber dónde más mirar
function aerolineasBlock(destKey, comoBloque=true){
  const d = state.destinos?.destinos?.[destKey];
  const aer = d?.aerolineas || [];
  if(!aer.length) return '';
  const chips = aer.map(a=>`<a class="airchip" href="${a.url}" target="_blank" rel="noopener"><b>${a.n}</b><span>${a.v}</span></a>`).join('');
  const inner = `<h3>Aerolíneas que vuelan esta ruta</h3><div class="airchips">${chips}</div>`;
  return comoBloque ? `<div class="block">${inner}</div>` : `<div style="margin-top:14px">${inner}</div>`;
}

// Hoja "armar este viaje": comparación millas vs plata pierna por pierna
function openArmadoSheet(idx){
  const c = state.lastCombos?.[idx]; if(!c) return;
  const {dest, orig} = state.finder;
  const d = bDestinos()[dest];
  const V = valorMilla();
  const a = mejorArmado(c);

  const legRow = (tag, legAward, cash, ogL, deL, iso)=>{
    const eqMillas = legAward.mi*V;
    const costoC = V*100;                      // ¢ que cuesta reponer la milla
    const c_pp = cash ? cpp(cash.p, legAward.mi) : null;  // ¢ que rinde acá
    const veredicto = !cash ? '' :
      (c_pp >= costoC*1.25 ? `<span class="cpp good">millas: rinden ${c_pp.toFixed(2)}¢ y te cuestan ${costoC.toFixed(2)}¢</span>`
       : c_pp < costoC*0.9 ? `<span class="cpp bad">plata: la milla rendiría ${c_pp.toFixed(2)}¢ (te cuesta ${costoC.toFixed(2)}¢)</span>`
       : `<span class="cpp mid">parejo: rinde ${c_pp.toFixed(2)}¢ vs ${costoC.toFixed(2)}¢</span>`);
    return `<div class="legcmp">
      <div class="legcmp__head"><span class="leg__tag">${tag}</span>
        <b>${dateLabel(iso)}</b> · ${ogL} → ${deL} ${veredicto}</div>
      <div class="legcmp__opts">
        <div class="legopt">
          <div class="legopt__k">${fmtMiles(legAward.mi)} <small>millas</small></div>
          <div class="legopt__eq">≈ ${fmtUSD(eqMillas)} eq.</div>
          <a href="${smilesOneWayURL(ogL,deL,iso,d.moneda)}" target="_blank" rel="noopener">Smiles ↗</a>
        </div>
        <div class="legopt">
          ${cash?`
          <div class="legopt__k">${fmtUSD(cash.p)} <small>plata</small></div>
          <div class="legopt__eq">${cashNivelTxt(cash.nivel)}${cash.e===0?' · directo':''}</div>
          <span class="legopt__links">
            <a href="${despegarDayURL(ogL,deL,iso)}" target="_blank" rel="noopener">Despegar ↗</a>
            <a href="${googleFlightsURL(ogL,deL,iso)}" target="_blank" rel="noopener">Google Flights ↗</a>
            <a href="${kayakURL(ogL,deL,iso)}" target="_blank" rel="noopener">Kayak ↗</a>
            <a href="${aviasalesDayURL(ogL,deL,iso)}" target="_blank" rel="noopener">Aviasales ↗</a>
          </span>`:`
          <div class="legopt__k">—</div>
          <div class="legopt__eq">sin precio cash cacheado — miralo en vivo:</div>
          <span class="legopt__links">
            <a href="${despegarDayURL(ogL,deL,iso)}" target="_blank" rel="noopener">Despegar ↗</a>
            <a href="${googleFlightsURL(ogL,deL,iso)}" target="_blank" rel="noopener">Google Flights ↗</a>
            <a href="${kayakURL(ogL,deL,iso)}" target="_blank" rel="noopener">Kayak ↗</a>
          </span>`}
        </div>
      </div>
    </div>`;
  };

  const body = $('#sheetBody');
  body.innerHTML = `
    <div class="destcard__emoji" style="font-size:2.2rem">${d.emoji}</div>
    <h2 class="sheet__title">Armar este viaje</h2>
    <p class="sheet__pais">${d.nombre} · ${orig} ⇄ ${c.code} · ${c.noches} noches</p>
    ${a?`<div class="res__cash">💡 Armado sugerido: <b>${armadoTxt(a)}</b> — total equivalente ≈ <b>${fmtUSD(a.totalEq)}</b> <span class="cash__t">(${valorMillaTxt()})</span></div>`:''}
    ${legRow('IDA', c.ida, c.cashIda, orig, c.code, c.ida.d)}
    ${legRow('VUELTA', c.vuelta, c.cashVuelta, c.code, orig, c.vuelta.d)}
    <div class="block">
      <h3>Viaje completo, de una</h3>
      <div class="diaslinks">
        <a class="btn btn--go" href="${smilesRoundURL(orig,c.code,c.ida.d,c.vuelta.d,d.moneda)}" target="_blank" rel="noopener">✈ Ida y vuelta en Smiles ↗</a>
        <a class="btn" href="${googleFlightsURL(orig,c.code,c.ida.d,c.vuelta.d)}" target="_blank" rel="noopener">Ida y vuelta en Google Flights (todas las aerolíneas) ↗</a>
        <a class="btn" href="${despegarDayURL(orig,c.code,c.ida.d).replace('/oneway/','/roundtrip/').replace(`/${c.ida.d}/`,`/${c.ida.d}/${c.vuelta.d}/`)}" target="_blank" rel="noopener">Ida y vuelta en Despegar ↗</a>
        <a class="btn" href="${kayakURL(orig,c.code,c.ida.d,c.vuelta.d)}" target="_blank" rel="noopener">Ida y vuelta en Kayak ↗</a>
      </div>
      ${aerolineasBlock(dest, false)}
      <p class="hint" style="margin-top:10px">El “equivalente” usa tu costo real de reponer millas: ${valorMillaTxt()} — configurable en la config. Ojo: a las millas sumales las tasas de Smiles (confirmalas en el link). Google Flights y Kayak buscan en todas las aerolíneas a la vez, como hacías a mano.</p>
    </div>`;
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden','false');
}

function renderStatus(){
  const el = $('#scanStatusText'); const foot = $('#footScan');
  if(!state.latest){ el.textContent='sin datos aún'; return; }
  const t = haceCuanto(state.latest.generado);
  el.textContent = `rastrillado ${t}`;
  foot.textContent = `último rastrillaje · ${state.latest.generado?.slice(0,16).replace('T',' ')}`;
  // Aviso si el radar no corre hace más de un día (Mac apagada, error, etc.)
  const horas = (Date.now() - new Date(state.latest.generado)) / 36e5;
  const warn = $('#staleWarn');
  if(warn) warn.remove();
  if(horas > 26){
    const dias = Math.floor(horas/24);
    const div = document.createElement('div');
    div.id = 'staleWarn';
    div.className = 'stalewarn';
    div.innerHTML = `⚠️ El radar no rastrilla hace ${dias>=1?dias+(dias===1?' día':' días'):Math.round(horas)+' h'}. Suele pasar si la Mac estuvo apagada a las 9:00 y 20:00. Los precios pueden estar desactualizados.`;
    document.querySelector('main').prepend(div);
  }
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

function cashTipoTxt(c){
  const t = c.tipo==='ida_vuelta' ? 'ida y vuelta' : 'solo ida';
  return c.exacto ? t : `${t}, ref.`;
}
// Línea de precio cash + veredicto millas vs plata en la tarjeta (clickeable)
function cashLine(r){
  const c = r.cash;
  if(!c || !c.precio) return '';
  const esc = c.escalas===0?' · <span class="esc-dir">directo</span>':(c.escalas!=null?` · ${escTxt(c.escalas)}`:'');
  const fecha = c.fecha || r.mejor_fecha;
  const precio = c.link
    ? `<a class="cash__link" href="${c.link}" target="_blank" rel="noopener"><b>${fmtUSD(c.precio)}</b> ↗</a>`
    : `<b>${fmtUSD(c.precio)}</b>`;
  return `<p class="card__cash">💵 en plata: ${precio} <span class="cash__t">${cashTipoTxt(c)}</span>${esc}
    · <a class="cash__link" href="${despegarDayURL(r.origen, r.aeropuerto, fecha)}" target="_blank" rel="noopener">Despegar ↗</a></p>`;
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
        <div class="vs__u">en efectivo · ${cashTipoTxt(c)}${c.escalas===0?' · directo':''}</div>
      </div>
    </div>
    ${c.link?`<a class="btn btn--ghost" style="display:inline-block;margin-top:10px;padding:8px 14px" href="${c.link}" target="_blank" rel="noopener">Ver vuelo en efectivo ↗</a>`:''}
    <p class="hint" style="margin-top:8px">Mejor tarifa cash encontrada para esta ruta${c.exacto?' en ese mes':' (referencia general, no de ese mes puntual)'}. ${c.tipo==='ida_vuelta'?'Es precio de ida y vuelta.':'Es precio de solo ida.'} Sirve para decidir si conviene usar millas o pagar.</p>
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
  const hora = state.latest?.generado ? state.latest.generado.slice(11,16) : '';
  return `<div class="monthcal__grid">${cells}</div>
  <p class="hint" style="margin-top:8px">Precios de la tarifa Club Smiles según el último rastrillaje${hora?` (${hora} hs)`:''}. La disponibilidad se mueve durante el día: puede haber sorpresas para bien o para mal — el precio final siempre lo confirma Smiles al abrir el día. El radar corre 9:00 y 20:00.</p>`;
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

/* ---------- Radar de la comunidad (RSS de los blogs cazadores) ---------- */
function renderOfertas(){
  const host = $('#ofertasWrap');
  if(!host) return;
  const posts = state.ofertas?.posts || [];
  if(!posts.length){ host.innerHTML=''; return; }
  const rows = posts.slice(0,12).map(p=>{
    const f = p.fecha ? haceCuanto(p.fecha) : '';
    return `<a class="oferta" href="${p.link}" target="_blank" rel="noopener">
      <span class="oferta__src">${p.fuente}</span>
      <span class="oferta__t">${p.titulo}</span>
      <span class="oferta__f">${f}</span>
    </a>`;
  }).join('');
  host.innerHTML = `<div class="section-head" style="margin-top:26px"><h2>📰 Radar de la comunidad</h2>
    <p class="section-sub">Lo último de los blogs cazadores que seguís — sin entrar uno por uno.</p></div>
    <div class="ofertas">${rows}</div>`;
}

/* ---------- Ideas de caza (precio + clima + qué se aprovecha) ---------- */
function renderIdeas(){
  const host = $('#ideasWrap');
  if(!host) return;
  const R = state.latest?.resultados || [];
  const D = state.destinos?.destinos || {};
  const C = state.clima?.destinos || {};
  if(!R.length){ host.innerHTML=''; return; }

  // mejor precio por destino+mes
  const ideas = [];
  R.forEach(r=>{
    const mes = +r.ym.slice(5,7);
    const d = D[r.destino_key]; if(!d) return;
    const tip = d.tips?.[String(mes)];
    const cl = C[r.destino_key]?.meses?.find(x=>x.mes===mes);
    const t = cl?.t_media;
    const climaOK = t!=null && t>=14 && t<=29;
    let score = 0;
    if(r.nivel==='oportunidad') score+=3; else if(r.nivel==='bueno') score+=2; else if(r.nivel==='caro') score-=2;
    if(tip) score+=2;
    if(climaOK) score+=1;
    ideas.push({r, mes, tip, t, score});
  });
  // una idea por destino (la de mejor score), top 6
  const porDest = {};
  ideas.forEach(i=>{ const k=i.r.destino_key; if(!porDest[k]||i.score>porDest[k].score||(i.score===porDest[k].score&&i.r.mejor_precio_millas<porDest[k].r.mejor_precio_millas)) porDest[k]=i; });
  const top = Object.values(porDest).sort((a,b)=>b.score-a.score).slice(0,6);
  if(!top.length){ host.innerHTML=''; return; }

  const cards = top.map(i=>{
    const r = i.r;
    const enBuscador = !!bDestinos()[r.destino_key]?.meses?.[r.ym];
    return `<div class="idea ${r.nivel==='oportunidad'?'op':''}" data-dest="${r.destino_key}" data-ym="${r.ym}" data-buscable="${enBuscador?1:0}">
      <div class="idea__head">${r.destino_emoji} <b>${r.destino_nombre}</b> en ${MONTHS_LONG[i.mes-1]}</div>
      <div class="idea__datos">
        <span class="idea__mi">${fmtMiles(r.mejor_precio_millas)} mi</span>
        ${i.t!=null?`<span class="idea__t">${Math.round(i.t)}°C prom.</span>`:''}
        ${r.nivel==='oportunidad'?'<span class="idea__op">🟢 oportunidad</span>':''}
      </div>
      ${i.tip?`<p class="idea__tip">${i.tip}</p>`:''}
      <span class="idea__cta">${enBuscador?'buscar combinaciones →':'ver destino →'}</span>
    </div>`;
  }).join('');
  host.innerHTML = `<div class="section-head" style="margin-top:26px"><h2>🎯 Ideas de caza</h2>
    <p class="section-sub">Dónde y cuándo conviene, cruzando precio, clima y qué se aprovecha en cada época.</p></div>
    <div class="ideas">${cards}</div>`;

  $$('.idea',host).forEach(c=>c.addEventListener('click',()=>{
    const k=c.dataset.dest, ym=c.dataset.ym;
    if(c.dataset.buscable==='1'){
      $('#fDest').value=k; state.finder.dest=k;
      $('#fDest').dispatchEvent(new Event('change'));
      $('#fMes').value=ym; state.finder.mes=ym;
      $('#fMes').dispatchEvent(new Event('change'));
      runFinder();
    } else {
      openDestino(k);
    }
  }));
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
    <p class="hint" style="margin-bottom:14px">💬 <b>El camino fácil:</b> decile a Claude qué destinos y meses querés ("buscame Miami en marzo y abril") y él carga todo. Este editor es la alternativa manual: al guardar te lleva a GitHub donde tenés que pegar y confirmar.</p>
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
