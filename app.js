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
  finder:{ dest:null, orig:'EZE', mes:null, nMin:10, nMax:20, esc:'todos', diaIda:null },
  vueltas:{ dest:null, mes:null } };

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

async function loadJSON(path, modo){
  try{ const r = await fetch(path,{cache: modo || 'no-cache'}); if(!r.ok) throw 0; return await r.json(); }
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

/* ================= PASAJEROS =================
   Nacho viaja con la familia: los deep links abrían Smiles con 1 adulto y
   después había que rehacer la búsqueda a mano. El bloque "pasajeros" de
   engine/config.json manda; si no está, asumimos la familia completa. */
const PAX_DEFAULT = {adultos:2, ninos:2, bebes:0};

function pasajeros(){
  const p = state.config?.pasajeros;
  if(!p) return {...PAX_DEFAULT};
  const n = (v,d)=> Number.isFinite(+v) ? Math.max(0, Math.round(+v)) : d;
  return {adultos: Math.max(1, n(p.adultos, PAX_DEFAULT.adultos)),
          ninos:   n(p.ninos,  PAX_DEFAULT.ninos),
          bebes:   n(p.bebes,  PAX_DEFAULT.bebes)};
}
function paxTxt(){
  const p = pasajeros();
  const bits = [`${p.adultos} ${p.adultos===1?'adulto':'adultos'}`];
  if(p.ninos) bits.push(`${p.ninos} ${p.ninos===1?'chico':'chicos'}`);
  if(p.bebes) bits.push(`${p.bebes} ${p.bebes===1?'bebé':'bebés'}`);
  return bits.length>1 ? bits.slice(0,-1).join(', ')+' y '+bits[bits.length-1] : bits[0];
}
function paxTotal(){ const p = pasajeros(); return p.adultos + p.ninos + p.bebes; }

// Nota honesta al lado de cada link: el calendario de Smiles devuelve el precio
// del asiento más barato y NO cambia según cuántos viajen (verificado: adults=1
// y adults=3 traen exactamente lo mismo). Lo que sí puede faltar es lugar.
function paxHint(){
  const t = paxTotal();
  return `<p class="hint pax">👨‍👩‍👧‍👦 Los links abren Smiles para <b>${paxTxt()}</b>. Ojo: el calendario muestra el precio del asiento <b>más barato</b> y no cambia según cuántos viajen — en Smiles confirmá que haya lugar para ${t===1?'vos':'los '+t}.</p>`;
}

/* ================= SELLOS DE HORA =================
   Cada pantalla tiene que decir de qué hora es SU dato. La Mac rastrilla con
   la tapa cerrada y macOS la despierta 30 s cada ~15 min: un barrido que
   debería durar 7 min tarda de 2 a 6 h, así que lo que ves puede ser de hace
   media jornada. Antes los carteles mostraban la hora actual y el "hace X min"
   se calculaba una sola vez al cargar y quedaba congelado toda la sesión. */
const SELLO_FRESCO_H = 3;    // menos de 3 h: es de la corrida en curso
const SELLO_VIEJO_H  = 8;    // más de 8 h: ya pasó medio día
const SELLO_AVISO_H  = 6;    // desde acá avisamos "verificá antes de decidir"

// El motor escribe hora local con offset (…-03:00), así que cortar el string
// da la hora de Buenos Aires aunque el celular ande por otro huso. Si alguna
// vez llegara en UTC (terminado en Z), hay que convertirla.
function enUTC(iso){ return /[zZ]$/.test(String(iso)); }
function dosD(n){ return String(n).padStart(2,'0'); }
function horaCorta(iso){
  if(!iso) return '';
  if(enUTC(iso)){ const d = new Date(iso); return `${dosD(d.getHours())}:${dosD(d.getMinutes())}`; }
  return String(iso).slice(11,16);
}
function fechaCorta(iso){
  if(!iso) return '';
  if(enUTC(iso)){ const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  const p = String(iso).slice(0,10).split('-');
  return `${+p[2]} ${MONTHS[+p[1]-1]}`;
}
function esHoy(iso){
  const d = new Date(iso), h = new Date();
  return d.getFullYear()===h.getFullYear() && d.getMonth()===h.getMonth() && d.getDate()===h.getDate();
}

function selloDe(iso){
  if(!iso) return {iso:null, horas:null, hace:'sin dato', nivel:'muy_viejo',
                   txt:'todavía no hay datos', avisar:true};
  const ms = new Date(iso).getTime();
  const horas = (Date.now()-ms)/36e5;
  const nivel = horas < SELLO_FRESCO_H ? 'fresco' : (horas < SELLO_VIEJO_H ? 'viejo' : 'muy_viejo');
  const txt = esHoy(iso) ? `datos de las ${horaCorta(iso)}`
                         : `datos del ${fechaCorta(iso)}, ${horaCorta(iso)}`;
  return {iso, horas, hace:haceCuanto(iso), nivel, txt, avisar: horas >= SELLO_AVISO_H};
}

// El buscador (busqueda.json) tiene su propio reloj: las idas salen gratis del
// radar y se refrescan en cada barrido, pero las vueltas cuestan llamadas y se
// renuevan de a tandas (busqueda.py: cola ordenada por g_vta más viejo). Por eso
// el sello global es el de la pierna MÁS VIEJA de todo el archivo — el contrato
// lo pide así para los carteles generales. Para una pantalla de un solo
// destino-mes está selloBloque(), que es el que Nacho realmente está mirando.
let _selloBuscadorISO;
function buscadorISO(){
  if(_selloBuscadorISO !== undefined) return _selloBuscadorISO;
  let peor = null;
  const B = state.busqueda?.destinos || {};
  for(const d of Object.values(B)){
    for(const bloque of Object.values(d.meses || {})){
      for(const k of ['g_ida','g_vta']){
        const v = bloque[k];
        if(!v) continue;
        if(!peor || new Date(v).getTime() < new Date(peor).getTime()) peor = v;
      }
    }
  }
  _selloBuscadorISO = peor || state.busqueda?.generado || null;
  return _selloBuscadorISO;
}

function sello(fuente){
  return selloDe(fuente==='buscador' ? buscadorISO() : (state.latest?.generado || null));
}
/* Sello de UN destino-mes del buscador. sello('buscador') devuelve el peor de
   todo el archivo (eso pide el contrato y sirve para un cartel general), pero
   cuando la pantalla muestra UN destino y UN mes lo honesto es la hora de ESE
   bloque: las idas se refrescan en cada barrido y las vueltas rotan de a tandas,
   así que el peor global puede ser de ayer mientras lo que estás mirando es de
   recién. Todos los sellos del motor llevan el mismo huso (-03:00), así que
   ordenarlos como texto los ordena en el tiempo. */
function isosBloque(destKey, ym){
  const b = state.busqueda?.destinos?.[destKey]?.meses?.[ym];
  return [b && b.g_ida, b && b.g_vta].filter(Boolean).sort();
}
function selloBloque(destKey, ym){
  const isos = isosBloque(destKey, ym);
  return isos.length ? selloDe(isos[0]) : sello('buscador');
}
function selloBloqueHTML(destKey, ym){
  const isos = isosBloque(destKey, ym);
  return isos.length ? selloHTML(isos[0]) : selloHTML('buscador');
}
// Sello de UNA ruta: el motor consulta las 33 rutas a lo largo de horas, así
// que "cuándo se consultó esta ruta" no es lo mismo que "cuándo arrancó".
function selloRuta(r){
  return selloDe((r && r.consultado) || state.latest?.generado || null);
}

function selloTexto(s){ return `🕒 ${s.txt} · ${s.hace}`; }
// fuente: "radar" | "buscador" | un ISO suelto (ej. r.consultado)
function selloHTML(fuente, clase){
  const esFuente = fuente==='radar' || fuente==='buscador';
  const s = esFuente ? sello(fuente) : selloDe(fuente);
  const attr = esFuente ? `data-sello="${fuente}"` : `data-sello="iso" data-sello-iso="${fuente||''}"`;
  return `<span class="sello sello--${s.nivel}${clase?' '+clase:''}" ${attr}>${selloTexto(s)}</span>`;
}
// Reescribe los "hace X" ya pintados (los dispara el latido cada minuto)
function refrescarSellos(root){
  $$('[data-sello]', root || document).forEach(el=>{
    const f = el.dataset.sello;
    const s = f==='iso' ? selloDe(el.dataset.selloIso || null) : sello(f);
    el.textContent = selloTexto(s);
    el.className = el.className.replace(/sello--\w+/, 'sello--'+s.nivel);
  });
}

// Aviso cuando el dato ya tiene unas horas. Smiles rota precios todo el día:
// el 27% de los barridos consecutivos trae otro número.
function avisoVigencia(s){
  if(!s || s.horas == null || s.horas < SELLO_AVISO_H) return '';
  return `<p class="vigencia">⏳ Precio de ${s.hace} — Smiles mueve la disponibilidad durante el día: verificá en Smiles antes de decidir.</p>`;
}

/* Estado real del motor, leído de meta.json (que se publica aunque el barrido
   termine mal). Sin esto la app decía "rastrillado hace 2 h" cuando en realidad
   ese barrido había fallado y estabas viendo el de la madrugada. */
function estadoMotor(){
  const m = state.meta || {}, L = state.latest || {};
  const s = sello('radar');
  const rutas = m.rutas ?? L.total_rutas ?? (L.resultados||[]).length;
  const consultadas = m.consultadas ?? L.total_consultadas ?? null;
  const errEnLatest = Array.isArray(L.errores) ? L.errores.length : (L.errores || 0);
  const errores = Number.isFinite(+m.errores) ? +m.errores : errEnLatest;
  // Único síntoma confiable de barrido fallido: el estado que escribe el motor.
  // "vacio" = corrió y no trajo nada; "sin_servidor" = ningún server de Smiles
  // sirve precios. En los dos casos el motor NO pisa latest.json a propósito.
  // OJO: no sirve comparar meta.generado contra latest.generado. Un completo
  // sano corre en dos etapas (run.sh: --solo-radar y después --solo-extras):
  // el radar publica latest a los pocos minutos y meta recién se reescribe al
  // final de la etapa 2, media hora o varias horas después. Con esa cuenta la
  // app cantaba "el barrido de las 20:25 falló" en TODOS los completos buenos.
  const ok = !(m.estado==='vacio' || m.estado==='sin_servidor');
  const metaISO = m.generado || m.iniciado || null;
  let txt;
  if(!ok){
    const cuando = metaISO ? `el barrido de las ${horaCorta(metaISO)}` : 'el último barrido';
    txt = L.generado
      ? `${cuando} falló: estás viendo datos de las ${horaCorta(L.generado)}`
      : `${cuando} falló y todavía no hay precios publicados`;
  } else if(!L.generado){
    txt = 'todavía no hay ningún barrido publicado';
  } else {
    txt = `último barrido ${horaCorta(L.generado)} · ${rutas} ${rutas===1?'ruta':'rutas'}`;
    if(L.estado==='parcial') txt += ' · corrida incompleta';
    if(errores) txt += ` · ${errores} con error`;
    if(s.horas != null && s.horas >= SELLO_VIEJO_H) txt += ` (${s.hace})`;
  }
  return {ok, txt, sello:s, rutas, consultadas, errores,
          modo: m.modo || L.modo || null, estado: m.estado || L.estado || null};
}

/* ================= DÍAS AL MÍNIMO =================
   La causa #1 de la queja. El motor publica un único mejor_fecha (el primero
   empatado al mínimo) y Smiles rota cuál de los días empatados está barato:
   el 7-sep Madrid figuraba 12-may a 166.500 y 48 min después ese día valía
   435.700 mientras otros 7 días de mayo seguían a 166.500. Mostramos TODOS los
   días al mínimo, cada uno con su link. 23 de las 33 rutas tienen más de uno. */
const DIAS_A_LA_VISTA = 4;   // hasta 4 van sueltos; de ahí en más, desplegable

function diasMin(r){
  if(!r) return [];
  if(Array.isArray(r.dias_min) && r.dias_min.length) return [...r.dias_min].sort();
  const dias = (r.dias || []).filter(d => d && typeof d.miles === 'number' && d.miles > 0);
  if(!dias.length) return r.mejor_fecha ? [r.mejor_fecha] : [];
  let min = Infinity;
  for(const d of dias) if(d.miles < min) min = d.miles;
  const out = dias.filter(d => d.miles === min).map(d => d.date).sort();
  return out.length ? out : (r.mejor_fecha ? [r.mejor_fecha] : []);
}

function unirTxt(a){
  if(!a.length) return '';
  return a.length===1 ? a[0] : a.slice(0,-1).join(', ') + ' y ' + a[a.length-1];
}
// "18, 22 y 29 Abr" si son del mismo mes; si no, "18 Abr, 3 May y 12 May"
function listaDiasTxt(dias){
  if(!dias.length) return '';
  const meses = new Set(dias.map(d=>d.slice(0,7)));
  if(meses.size === 1){
    const m = +dias[0].slice(5,7);
    return unirTxt(dias.map(d=>String(+d.slice(8,10)))) + ' ' + MONTHS[m-1];
  }
  return unirTxt(dias.map(fechaCorta));
}
function diasMinTxt(r){
  const dias = diasMin(r), n = dias.length;
  if(!n) return '';
  if(n === 1) return dateLabel(dias[0]);
  if(n <= DIAS_A_LA_VISTA) return `${n} días (${listaDiasTxt(dias)})`;
  return `${n} días en ${ymLabel(r.ym)}`;
}
function diasMinChips(r, dias){
  return dias.map(f=>`<a class="diamin" href="${smilesOneWayURL(r.origen, r.aeropuerto, f)}" target="_blank" rel="noopener" title="Verificar ${dateLabel(f)} en Smiles">${fechaCorta(f)}<span>↗</span></a>`).join('');
}
// Chips con link por día; si son muchos, desplegable para no tapar el celular.
function diasMinHTML(r){
  const dias = diasMin(r), n = dias.length;
  if(!n) return '';
  if(n <= DIAS_A_LA_VISTA) return `<div class="diasmin">${diasMinChips(r, dias)}</div>`;
  return `<details class="diasmin diasmin--mas"><summary>ver los ${n} días al mismo precio</summary>
    <div class="diasmin__grid">${diasMinChips(r, dias)}</div></details>`;
}
// La misma frase en el hero, en la tarjeta y en la ficha (incluido el caso en
// que Smiles no mostró NINGÚN día, donde antes salía "0 días al mismo precio").
function diasMinLinea(r, conMes){
  const dias = diasMin(r);
  if(!dias.length) return 'Smiles no nos mostró ningún día de este mes';
  if(dias.length === 1) return `un solo día a ese precio: <b>${dateLabel(dias[0])}</b>`;
  const cola = dias.length <= DIAS_A_LA_VISTA ? `: ${listaDiasTxt(dias)}`
                                              : (conMes ? ` en ${ymLabel(r.ym)}` : '');
  return `<b>${dias.length} días</b> al mismo precio${cola}`;
}
// Línea completa: "desde 107.500 · 3 días (18, 22 y 29 Abr)"
function desdeTxt(r){
  // Sin precio (calendario recortado a cero días) no hay "desde": decirlo así,
  // en vez de escupir "desde — · " en el cartel que lo use.
  if(!conPrecio(r)) return `sin días a la vista en ${ymLabel(r.ym)}`;
  const n = diasMin(r).length;
  return `desde ${fmtMiles(r.mejor_precio_millas)} · ${n===1 ? '1 día' : diasMinTxt(r)}`;
}

/* Calendario incompleto (campo "parcial" del motor). Para Brasil y cabotaje
   Smiles solo devuelve el mes entero entre las 9 y las 11 de la mañana; el
   resto del día manda 1 a 6 días sueltos. Eso no es "caro" ni "oportunidad":
   es media foto, y así hay que mostrarlo. */
function esParcial(r){ return !!(r && r.parcial); }

/* Ruta sin NINGÚN día a la vista. El motor la publica igual (dias:[], con
   mejor_precio_millas y mejor_fecha en null) cuando Smiles declara días con
   precio pero no muestra ninguno: así la ruta no desaparece del tablero. La app
   no le puede inventar una fecha, y sin fecha no hay link a un día. */
function conPrecio(r){ return !!(r && r.mejor_precio_millas != null); }
function fechaLink(r){ return diasMin(r)[0] || (r && r.mejor_fecha) || null; }
// La ruta más barata de una lista, ignorando las que no trajeron ningún precio
// (null <= cualquier cosa es true en JS: sin este filtro una ruta vacía ganaba
// el desempate y la ficha del destino mostraba "— millas" como mejor precio).
function masBarata(R){
  const con = (R || []).filter(conPrecio);
  if(!con.length) return (R && R[0]) || null;
  return con.reduce((a,b)=> a.mejor_precio_millas <= b.mejor_precio_millas ? a : b);
}
// El mes entero en Smiles, para cuando no hay un día que abrir.
function smilesMesURL(r){
  const [y,m] = String((r && r.ym) || '').split('-').map(Number);
  if(!y || !m) return '';
  return smilesOneWayURL(r.origen, r.aeropuerto, `${y}-${dosD(m)}-15`);
}
// Botón "verificar": al día más barato si lo tenemos; si Smiles no mostró
// ninguno, al mes y diciéndolo. Nunca abrimos un día cualquiera como si fuera
// el barato.
function ctaSmilesHTML(r, clase, estilo){
  const st = estilo ? ` style="${estilo}"` : '';
  const f = fechaLink(r);
  if(f) return `<a class="${clase}"${st} href="${smilesURL(r, f)}" target="_blank" rel="noopener">Verificar en Smiles ↗</a>`;
  const u = smilesMesURL(r);
  if(!u) return '';
  return `<a class="${clase}"${st} href="${u}" target="_blank" rel="noopener" title="Smiles no nos mostró ningún día de este mes: el link abre el mes para que lo veas vos">Ver el mes en Smiles ↗</a>`;
}
function parcialHTML(r){
  if(!esParcial(r)) return '';
  const n = (r.dias || []).length;
  // n puede ser 0: Smiles declara días con precio y no nos muestra ninguno.
  const cuantos = n === 0 ? 'no está mostrando ningún día'
                          : (n === 1 ? 'está mostrando solo 1 día' : `está mostrando solo ${n} días`);
  let t = `⏳ <b>Media foto</b>: Smiles ${cuantos} de ${ymLabel(r.ym)} en este momento`;
  if(r.dias_esperados) t += ` (declara ${r.dias_esperados} días con precio)`;
  t += `. A la mañana suele listar el mes completo — no tomes esto como el precio del mes.`;
  // Con n === 0 no hay mejor_precio_millas contra qué comparar, pero el mínimo
  // declarado es lo único concreto que tenemos: mostralo igual.
  if(r.min_declarado && (r.mejor_precio_millas == null || r.min_declarado < r.mejor_precio_millas)){
    t += ` Smiles declara un mínimo de ${fmtMiles(r.min_declarado)} millas para el mes, pero no nos mostró qué día es.`;
  }
  return `<p class="parcial">${t}</p>`;
}

/* ================= HISTÓRICO (disuelto en la ficha) =================
   data/historial.json pesa 419 KB: se lee una vez, se indexa una vez y el JSON
   crudo se descarta (nos quedamos solo con el índice). */
let _histIdx = null;

function indexarHistorial(crudo){
  _histIdx = {};
  const rutas = (crudo && crudo.rutas) || {};
  for(const k of Object.keys(rutas)){
    const s = ((rutas[k] || {}).snapshots || [])
      .filter(x => x && typeof x.min_miles === 'number' && x.min_miles > 0 && x.ts)
      .slice().sort((a,b)=> String(a.ts).localeCompare(String(b.ts)));
    if(!s.length) continue;
    let min = Infinity;
    for(const x of s) if(x.min_miles < min) min = x.min_miles;
    const enMin = s.filter(x => x.min_miles === min);
    const ult = enMin[enMin.length-1];
    _histIdx[k] = {snapshots:s, n:s.length, veces:enMin.length,
                   minVisto:{miles:min, date:ult.min_date, ts:ult.ts}};
  }
}
// rutaKey = "EZE-MIA-2027-03"
function hist(rutaKey){ return (_histIdx && _histIdx[rutaKey]) || null; }

/* Cuando el latido trae un latest nuevo NO volvemos a bajar historial.json (419
   KB): metemos a mano la lectura que acaba de entrar, con la misma regla que usa
   el motor (los calendarios recortados no se guardan, porque ensucian la serie).
   Sin esto la ficha decía "bajó 5% desde la lectura anterior" comparando contra
   la lectura vieja, con el precio nuevo pintado justo arriba. */
function sumarLecturasDeLatest(latest){
  if(!_histIdx || !latest) return;
  for(const r of latest.resultados || []){
    if(!r || !r.ruta || esParcial(r) || r.mejor_precio_millas == null) continue;
    const h = _histIdx[r.ruta];
    // Solo con r.consultado: el motor guarda el snapshot con ESE mismo sello, así
    // que comparando ts sabemos si la lectura ya estaba. Sin el campo (datos
    // viejos, previos al 8-sep-2026) no folqueamos nada: usar latest.generado
    // como sello duplicaría la última lectura en cada repesca.
    const ts = r.consultado;
    if(!h || !ts) continue;
    const ultimo = h.snapshots[h.n-1];
    if(ultimo && String(ultimo.ts) >= String(ts)) continue;   // ya la teníamos
    h.snapshots.push({ts, min_miles:r.mejor_precio_millas, min_date:r.mejor_fecha});
    h.n = h.snapshots.length;
    if(r.mejor_precio_millas < h.minVisto.miles){
      h.minVisto = {miles:r.mejor_precio_millas, date:r.mejor_fecha, ts};
      h.veces = 1;
    } else if(r.mejor_precio_millas === h.minVisto.miles){
      h.minVisto = {miles:r.mejor_precio_millas, date:r.mejor_fecha, ts};
      h.veces += 1;
    }
  }
}

/* Variación honesta entre las dos últimas lecturas. El código viejo de la
   estación Histórico comparaba los últimos dos snapshots sin mirar el día, y
   por eso cantaba "Florianópolis subió 242%" cuando lo que había cambiado era
   el día visible, no el precio. Si cambió el día, lo decimos y no damos %. */
function histMovimiento(rutaKey){
  const h = hist(rutaKey);
  if(!h || h.n < 2) return null;
  const ult = h.snapshots[h.n-1], prev = h.snapshots[h.n-2];
  const delta = ult.min_miles - prev.min_miles;
  const mismoDia = prev.min_date === ult.min_date;
  const pct = prev.min_miles ? delta/prev.min_miles*100 : 0;
  let txt;
  if(delta === 0) txt = 'Sin cambios desde la lectura anterior.';
  else if(mismoDia) txt = `${delta<0?'Bajó':'Subió'} ${Math.abs(Math.round(pct))}% desde la lectura anterior, con el mismo día más barato (${fechaCorta(ult.min_date)}).`;
  else txt = `Cambió el día más barato: antes ${fechaCorta(prev.min_date)} a ${fmtMiles(prev.min_miles)}, ahora ${fechaCorta(ult.min_date)} a ${fmtMiles(ult.min_miles)} — no es que el precio se movió, es otro día.`;
  return {delta, pct, mismoDia, txt, ult, prev};
}

/* Sparkline sin librerías. El piso punteado es el mínimo histórico de la ruta,
   así de un vistazo se ve cuánto falta para tocarlo. Colores literales (no
   variables CSS) para que sirva igual dentro de los paneles del mundo 3D. */
function sparkline(snapshots, w, h){
  const W = w || 140, H = h || 34, P = 3.5;
  const vs = (snapshots || []).filter(x=>x && x.min_miles > 0).slice(-40).map(x=>x.min_miles);
  const n = vs.length;
  if(!n) return '';
  let lo = vs[0], hi = vs[0];
  for(const v of vs){ if(v<lo) lo=v; if(v>hi) hi=v; }
  if(!(hi > lo)) hi = lo + Math.max(1, lo*0.02);
  const x = i => P + (W-2*P)*(n===1 ? 0.5 : i/(n-1));
  const y = v => P + (H-2*P)*(1-(v-lo)/(hi-lo));
  let d = '';
  for(let i=0;i<n;i++) d += (i?'L':'M') + x(i).toFixed(1) + ' ' + y(vs[i]).toFixed(1) + ' ';
  const area = d + 'L' + x(n-1).toFixed(1) + ' ' + (H-P).toFixed(1) +
               ' L' + x(0).toFixed(1) + ' ' + (H-P).toFixed(1) + ' Z';
  const yPiso = y(lo).toFixed(1);
  return `<svg class="nvspark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="rgba(245,166,35,.13)"/>
    <line x1="${P}" y1="${yPiso}" x2="${(W-P).toFixed(1)}" y2="${yPiso}" stroke="rgba(52,224,161,.5)" stroke-width="1" stroke-dasharray="3 3"/>
    <path d="${d.trim()}" fill="none" stroke="#ffd479" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(n-1).toFixed(1)}" cy="${y(vs[n-1]).toFixed(1)}" r="2.4" fill="#ffd479"/>
  </svg>`;
}

// Bloque para la ficha del destino: mínimo registrado + sparkline + movimiento.
// Solo para rutas que siguen en latest (el código viejo daba por "viva"
// cualquier ruta con snapshot de menos de 48 h aunque ya no se rastreara).
function histBlock(r){
  if(!r || !r.ruta) return '';
  const h = hist(r.ruta);
  if(!h || h.n < 2) return '';
  const mv = h.minVisto;
  const mov = histMovimiento(r.ruta);
  // Sin precio de hoy (calendario recortado a cero días) no hay con qué comparar:
  // sin este guard, null - 102.900 daba -100% y cantaba "Hoy está en ese mínimo".
  const sobre = (mv.miles && r.mejor_precio_millas != null)
    ? Math.round((r.mejor_precio_millas - mv.miles)/mv.miles*100) : null;
  const dondeEsta = sobre == null ? ''
    : (sobre <= 0 ? 'Hoy está en ese mínimo.'
                  : (sobre <= 8 ? `Hoy está apenas ${sobre}% arriba.` : `Hoy está ${sobre}% arriba de ese mínimo.`));
  return `<div class="block">
    <h3>Lo que vimos en esta ruta</h3>
    <div class="histmini">
      <div class="histmini__k">
        <b>mínimo que vimos: ${fmtMiles(mv.miles)}</b>
        <span>lo registramos el ${fechaCorta(mv.ts)}${mv.date?` · para volar el ${fechaCorta(mv.date)}`:''}${h.veces>1?` · ${h.veces} veces`:''}</span>
      </div>
      ${sparkline(h.snapshots, 200, 40)}
    </div>
    <p class="hint">${h.n} lecturas guardadas de ${r.origen}→${r.aeropuerto} ${ymLabel(r.ym)}. ${dondeEsta} ${mov?mov.txt:''}</p>
  </div>`;
}

/* ================= LATIDO =================
   Nacho usa la PWA en el celular y vuelve horas después. Antes los "hace X min"
   se calculaban una sola vez al cargar y quedaban clavados toda la sesión, y no
   había forma de ver un barrido nuevo sin recargar a mano. */
const LATIDO_MS  = 60000;      // refrescar los "hace X" cada minuto
const REPESCA_MS = 5*60000;    // mirar meta.json (200 bytes) cada 5 minutos
let _latido = null, _ultRepesca = 0, _refrescando = null;

function emitirDatos(nuevo){
  window.dispatchEvent(new CustomEvent('nv:datos', {detail:{nuevo:!!nuevo, sello:sello('radar')}}));
}

async function _repescar(forzar){
  _ultRepesca = Date.now();
  const meta = await loadJSON('data/meta.json','no-store');
  if(!meta) return false;
  const cambio = !state.meta || meta.generado !== state.meta.generado;
  state.meta = meta;
  if(!cambio && !forzar){ emitirDatos(false); return false; }
  const [latest, busqueda] = await Promise.all([
    loadJSON('data/latest.json','no-store'),
    loadJSON('data/busqueda.json','no-store'),
  ]);
  let hubo = false;
  if(latest && latest.generado !== state.latest?.generado){
    state.latest = latest; sumarLecturasDeLatest(latest); hubo = true;
  }
  if(busqueda && busqueda.generado !== state.busqueda?.generado){
    state.busqueda = busqueda; _selloBuscadorISO = undefined; hubo = true;
  }
  emitirDatos(hubo);
  return hubo;
}

function refrescar(forzar){
  if(_refrescando) return _refrescando;
  _refrescando = _repescar(forzar).catch(()=>false).then(v=>{ _refrescando = null; return v; });
  return _refrescando;
}

function arrancarLatido(){
  if(_latido) return;
  _ultRepesca = Date.now();
  _latido = setInterval(()=>{
    if(document.hidden) return;                              // en background no gastamos nada
    emitirDatos(false);                                      // que se muevan los "hace X"
    if(Date.now() - _ultRepesca > REPESCA_MS) refrescar();
  }, LATIDO_MS);
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden) return;
    emitirDatos(false);
    refrescar();                                             // volvió a la app: ¿hay barrido nuevo?
  });
}

/* Deep link a la búsqueda de Smiles para esa ruta/fecha */
// Recordatorio de las dos formas de pago de Smiles. El link ya abre en pesos;
// el desglose exacto de "millas + pesos" (Smiles&Money) solo lo muestra Smiles
// al abrir (vive en la página de detalle que Smiles bloquea para robots).
const smilesMoneyHint = `<p class="hint smoney">💡 En Smiles vas a ver <b>dos formas de pagar</b> (tarifa Club Smiles): <b>todo en millas</b>, o <b>menos millas + pesos</b> (Smiles&Money) — esta última suele convenir bastante. El link abre en pesos así ves las tasas reales; el desglose exacto lo muestra Smiles.</p>`;

// Acepta una fecha que pisa a r.mejor_fecha: cada día al mínimo abre SU día,
// no el único que publicó el motor (que Smiles rota durante el día).
function smilesURL(r, fechaISO){
  return smilesOneWayURL(r.origen, r.aeropuerto, fechaISO || r.mejor_fecha);
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
async function cargarDatos(){
  let historial;
  [state.latest, state.clima, state.destinos, state.config, state.busqueda,
   state.meta, state.ofertas, historial] = await Promise.all([
    loadJSON('data/latest.json'),
    loadJSON('data/clima.json'),
    loadJSON('data/destinos.json'),
    loadJSON('engine/config.json'),
    loadJSON('data/busqueda.json'),
    loadJSON('data/meta.json'),
    loadJSON('data/ofertas.json'),
    loadJSON('data/historial.json'),
  ]);
  // El histórico crudo pesa 419 KB: se indexa una sola vez y el JSON se suelta;
  // en memoria queda el índice y nada más (NV.hist lo consulta desde ahí).
  indexarHistorial(historial);
  historial = null;
  _selloBuscadorISO = undefined;
  arrancarLatido();
}

async function init(){
  setupLock();
  await cargarDatos();
  setupTabs();
  setupFilters();
  setupSheet();
  $('#editTripsBtn')?.addEventListener('click', openEditor);
  setupFinder();
  setupVueltas();
  renderStatus();
  renderHero();
  renderStats();
  renderRadar();
  renderDestinos();
  renderOfertas();
  renderIdeas();
  registerSW();
  // El cerebro avisa cuando entran datos nuevos, y cada minuto para que los
  // "hace X" se muevan solos (antes se calculaban al cargar y quedaban clavados).
  window.addEventListener('nv:datos', e=>{
    renderStatus();
    if(e.detail && e.detail.nuevo) repintar();
    // Siempre: repintar() solo rehace el radar y las tarjetas, y los sellos del
    // buscador, de Vueltas, del Armador y de la hoja abierta quedarían clavados
    // en la hora vieja mientras el resto de la app ya muestra la nueva.
    refrescarSellos();
  });
}

function repintar(){
  renderHero(); renderStats(); renderRadar(); renderDestinos();
  renderOfertas(); renderIdeas();
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
      cells+=`<button type="button" class="daychip has${best}" data-d="${iso}" title="${dateLabel(iso)} · ${fmtMiles(info.mi)} millas"><span>${dd}</span><span class="dm">${km}k</span></button>`;
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
// Los tres constructores abren Smiles con la familia entera (NV.pasajeros()),
// no con 1 adulto como antes.
function paxParams(){
  const p = pasajeros();
  return {adults:String(p.adultos), children:String(p.ninos), infants:String(p.bebes)};
}
function smilesRoundURL(orig, code, idaISO, vueltaISO, moneda){
  if(!orig || !code || !idaISO || !vueltaISO) return '';   // sin fecha no hay link (ver smilesOneWayURL)
  const ms = iso=>{ const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d,12,0,0).getTime(); };
  const p = new URLSearchParams({
    originAirportCode:orig, destinationAirportCode:code,
    departureDate:String(ms(idaISO)), returnDate:String(ms(vueltaISO)),
    ...paxParams(), tripType:'1', cabinType:'all',
    currencyCode:'ARS', isFlexibleDateChecked:'false'
  });
  return `https://www.smiles.com.ar/emission?${p.toString()}`;
}
// Devuelve '' si falta la fecha en vez de reventar: desde el 8-sep-2026 el motor
// publica rutas con dias:[] y mejor_fecha:null (Smiles declara días con precio y
// no muestra ninguno), y una sola de esas dejaba el radar entero en blanco.
function smilesOneWayURL(orig, code, idaISO, moneda){
  if(!orig || !code || !idaISO) return '';
  const [y,m,d]=idaISO.split('-').map(Number);
  const ms=new Date(y,m-1,d,12,0,0).getTime();
  const p=new URLSearchParams({originAirportCode:orig,destinationAirportCode:code,
    departureDate:String(ms), ...paxParams(), tripType:'2',
    cabinType:'all',currencyCode:'ARS',isFlexibleDateChecked:'false'});
  return `https://www.smiles.com.ar/emission?${p.toString()}`;
}

// Núcleo: mejores combinaciones ida+vuelta
// Ojo: el filtro "evitar conexión por Brasil" y la etiqueta "vía Brasil" se
// fueron (8-sep-2026). Dependían de fuente==='gol' fuera de Brasil, y eso no
// pasa nunca: de los 1.838 días de busqueda.json, los 4 con fuente gol son
// vuelos a Brasil, donde GOL es la aerolínea que opera, no una escala.
function calcularCombos(){
  const {dest, orig, mes, nMin, nMax, diaIda} = state.finder;
  const d = bDestinos()[dest]; if(!d) return [];
  const bloque = d.meses?.[mes]; if(!bloque) return [];
  const combos = [];
  for(const code of Object.keys(bloque.ida||{})){
    let idas = bloque.ida[code]||[];
    const vueltas = bloque.vuelta?.[code]||[];
    if(!vueltas.length) continue;
    if(diaIda) idas = idas.filter(x=>x.d===diaIda);
    for(const ida of idas){
      let mejor=null;
      for(const v of vueltas){
        const n = diasEntre(ida.d, v.d);
        if(n<nMin || n>nMax) continue;
        if(!mejor || (ida.mi+v.mi)<mejor.total){
          mejor={total:ida.mi+v.mi, vuelta:v, noches:n};
        }
      }
      if(mejor){
        combos.push({
          code, ciudad:(d.aeropuertos.find(a=>a.code===code)||{}).ciudad||code,
          ida, vuelta:mejor.vuelta, noches:mejor.noches, total:mejor.total,
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
    const bloque = d.meses?.[mes] || {};
    const sinAward = !Object.values(bloque.ida||{}).some(a=>a.length) &&
                     !Object.values(bloque.vuelta||{}).some(a=>a.length);
    const code0 = (d.aeropuertos[0]||{}).code;
    const dia15 = `${mes}-15`;
    const explic = sinAward
      ? `<div class="res__cash">🎫 <b>Smiles todavía no cargó pasajes con millas para ${ymLabel(mes)}</b> — pasa seguido en temporada alta: los libera más cerca de la fecha (o los pocos que había ya volaron). El radar vuelve a mirar en cada barrido y los vas a ver acá apenas aparezcan. Mientras tanto, mirá los precios en plata:</div>
        <div class="diaslinks" style="margin-top:10px">
          <a class="btn" href="${googleFlightsURL(orig,code0,dia15)}" target="_blank" rel="noopener">Google Flights ↗</a>
          <a class="btn" href="${despegarDayURL(orig,code0,dia15)}" target="_blank" rel="noopener">Despegar ↗</a>
          <a class="btn" href="${kayakURL(orig,code0,dia15)}" target="_blank" rel="noopener">Kayak ↗</a>
        </div>
        <p class="hint" style="margin-top:8px">Los links abren a mitad de mes — ajustá la fecha ahí. Cuando Smiles libere premios, acá vas a poder armar ida y vuelta día por día.</p>`
      : `<p class="empty">No encontré combinaciones ida+vuelta con ${nMin}–${nMax} noches para ese mes. Probá ampliar el rango de noches, cambiar el mes, o sacar “Cualquiera” en el día de salida.</p>`;
    host.innerHTML = `<div class="res__head"><h2>${d.emoji} ${d.nombre} · ${ymLabel(mes)}</h2>
      <p class="res__sub">${selloBloqueHTML(dest, mes)}</p></div>
      ${cashHTML}${explic}`;
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
        </div>
        ${armadoLine(c)}
      </div>
      <div class="combo__side">
        <div class="combo__total">${fmtMiles(c.total)}</div>
        <div class="combo__totu">millas ida+vuelta</div>
        <a class="btn btn--go combo__cta" href="${smilesRoundURL(orig,c.code,c.ida.d,c.vuelta.d,d.moneda)}" target="_blank" rel="noopener">Verificar en Smiles ↗</a>
        <button class="combo__detail" data-idx="${i}">armar este viaje →</button>
        <button class="combo__detail armlink" data-dest="${dest}" data-ym="${mes}" data-code="${c.code}" data-ida="${c.ida.d}" data-vta="${c.vuelta.d}">🔀 elegir otros días</button>
      </div>
    </article>`;
  }).join('');
  state.lastCombos = combos;

  host.innerHTML = `
    <div class="res__head">
      <h2>${d.emoji} ${d.nombre} · ${ymLabel(mes)}</h2>
      <p class="res__sub">${combos.length} mejores combinaciones · ${nMin}–${nMax} noches · saliendo desde ${orig}</p>
      <p class="res__sub">${selloBloqueHTML(dest, mes)}</p>
    </div>
    ${avisoVigencia(selloBloque(dest, mes))}
    ${cashHTML}
    <div class="combos">${rows}</div>
    <p class="hint" style="margin-top:12px">El total es la suma de millas de ida + vuelta (el mejor regreso dentro de tu rango de noches). Tocá <b>“armar este viaje”</b> para comparar pierna por pierna si conviene millas o plata, con los links a Smiles, Despegar y Aviasales de ese día exacto.</p>`;
  $$('.combo__detail',host).forEach(b=>b.addEventListener('click',()=>openArmadoSheet(+b.dataset.idx)));
  host.scrollIntoView({behavior:'smooth'});
}

/* ================= VUELTAS sueltas (regreso → EZE) ================= */
// Junta, por destino, todos los días de vuelta (destino→EZE) de todos los
// meses del viaje, deduplicados por aeropuerto+fecha con el precio más bajo.
function vueltasDestino(destKey){
  const d = bDestinos()[destKey]; if(!d) return null;
  const porAero = {};
  Object.values(d.meses||{}).forEach(bloque=>{
    Object.entries(bloque.vuelta||{}).forEach(([code, dias])=>{
      const m = porAero[code] = porAero[code] || {};
      dias.forEach(x=>{ if(!m[x.d] || x.mi<m[x.d].mi) m[x.d]={mi:x.mi, f:x.f, q:x.q}; });
    });
  });
  return { orig:d.origen, moneda:d.moneda, aeropuertos:d.aeropuertos,
           nombre:d.nombre, emoji:d.emoji, porAero };
}
// ¿Qué destinos tienen alguna vuelta cargada?
function destinosConVuelta(){
  return Object.keys(bDestinos()).filter(k=>{
    const v = vueltasDestino(k);
    return v && Object.values(v.porAero).some(m=>Object.keys(m).length);
  });
}
// Meses de regreso disponibles para un destino (de las fechas reales de vuelta)
function mesesVuelta(destKey){
  const v = vueltasDestino(destKey); if(!v) return [];
  const set = new Set();
  Object.values(v.porAero).forEach(m=>Object.keys(m).forEach(f=>set.add(f.slice(0,7))));
  return [...set].sort();
}

function setupVueltas(){
  const dSel = $('#vDest'), mSel = $('#vMes');
  const keys = destinosConVuelta();
  if(!keys.length){
    $('#vueltasForm').style.display='none';
    $('#vueltasResults').innerHTML = `<p class="empty">Todavía no hay vueltas rastreadas. Aparecen solas cuando un viaje activo incluye ese destino.</p>`;
    return;
  }
  const B = bDestinos();
  dSel.innerHTML = keys.map(k=>`<option value="${k}">${B[k].emoji} ${B[k].nombre}</option>`).join('');
  state.vueltas.dest = keys[0];
  const refreshMeses = ()=>{
    const meses = mesesVuelta(state.vueltas.dest);
    mSel.innerHTML = meses.map(m=>`<option value="${m}">${ymLabel(m)}</option>`).join('');
    state.vueltas.mes = meses[0] || null;
    renderVueltas();
  };
  refreshMeses();
  dSel.addEventListener('change', ()=>{ state.vueltas.dest=dSel.value; refreshMeses(); });
  mSel.addEventListener('change', ()=>{ state.vueltas.mes=mSel.value; renderVueltas(); });
}

// Calendario de un mes de vuelta para un aeropuerto: cada día linkea a Smiles
// (solo vuelta: aeropuerto → EZE, en pesos).
function vueltaCalHTML(orig, code, mapaDias, ym, moneda){
  const dias = Object.entries(mapaDias)
    .filter(([f])=>f.startsWith(ym))
    .map(([f,info])=>({d:f, ...info}));
  if(!dias.length) return '';
  const [y,m] = ym.split('-').map(Number);
  const min = Math.min(...dias.map(x=>x.mi));
  const byDate = {}; dias.forEach(x=>byDate[x.d]=x);
  const startDow = (new Date(y,m-1,1).getDay()+6)%7;
  const ndays = new Date(y,m,0).getDate();
  let cells = DOW.map(x=>`<div class="dow">${x}</div>`).join('');
  for(let i=0;i<startDow;i++) cells+=`<div></div>`;
  for(let dd=1; dd<=ndays; dd++){
    const iso=`${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const info=byDate[iso];
    if(info){
      const best = info.mi===min?' best':'';
      cells+=`<a class="daychip has arm${best}" href="${smilesOneWayURL(code, orig, iso, moneda)}" target="_blank" rel="noopener" title="${dateLabel(iso)} · ${fmtMiles(info.mi)} millas (volver a ${orig})">
        <span>${dd}</span><span class="dm">${Math.round(info.mi/1000)}k</span></a>`;
    } else cells+=`<div class="daycell-empty">${dd}</div>`;
  }
  const ciudad = (state.destinos?.destinos?.[state.vueltas.dest]?.aeropuertos||[])
    .find(a=>a.code===code)?.ciudad || code;
  return `<div class="block">
    <h3>${code} → ${orig} <span class="arm__dir">${ciudad} · desde ${fmtMiles(min)} mi</span></h3>
    <div class="daygrid">${cells}</div></div>`;
}

function renderVueltas(){
  const host = $('#vueltasResults');
  const {dest, mes} = state.vueltas;
  const v = vueltasDestino(dest);
  if(!v || !mes){ host.innerHTML=''; return; }
  const cals = Object.keys(v.porAero)
    .filter(code=>Object.keys(v.porAero[code]).some(f=>f.startsWith(mes)))
    .sort((a,b)=>{ // aeropuerto con el día más barato primero
      const mn = c=>Math.min(...Object.entries(v.porAero[c]).filter(([f])=>f.startsWith(mes)).map(([,x])=>x.mi));
      return mn(a)-mn(b);
    })
    .map(code=>vueltaCalHTML(v.orig, code, v.porAero[code], mes, v.moneda))
    .join('');
  host.innerHTML = `
    <div class="res__head">
      <h2>${v.emoji} Volver de ${v.nombre} · ${ymLabel(mes)}</h2>
      <p class="res__sub">Días más baratos volviendo a ${v.orig}. Tocá un día para abrirlo (solo vuelta) en Smiles, en pesos.</p>
      <p class="res__sub">${selloBloqueHTML(dest, mes)}</p>
    </div>
    ${avisoVigencia(selloBloque(dest, mes))}
    ${cals}
    <p class="hint">Verde = el día más barato del mes. Los números son miles de millas. Si enganchás una vuelta que te cierra, después buscás la ida para esas fechas en la solapa <b>Buscar</b> o en el <b>Armador</b>.</p>`;
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
        <a class="btn btn--go" href="${smilesRoundURL(orig,c.code,c.ida.d,c.vuelta.d,d.moneda)}" target="_blank" rel="noopener">✈ Verificar ida y vuelta en Smiles ↗</a>
        <a class="btn" href="${googleFlightsURL(orig,c.code,c.ida.d,c.vuelta.d)}" target="_blank" rel="noopener">Ida y vuelta en Google Flights (todas las aerolíneas) ↗</a>
        <a class="btn" href="${despegarDayURL(orig,c.code,c.ida.d).replace('/oneway/','/roundtrip/').replace(`/${c.ida.d}/`,`/${c.ida.d}/${c.vuelta.d}/`)}" target="_blank" rel="noopener">Ida y vuelta en Despegar ↗</a>
        <a class="btn" href="${kayakURL(orig,c.code,c.ida.d,c.vuelta.d)}" target="_blank" rel="noopener">Ida y vuelta en Kayak ↗</a>
      </div>
      ${aerolineasBlock(dest, false)}
      ${paxHint()}
      <p class="hint" style="margin-top:10px">El “equivalente” usa tu costo real de reponer millas: ${valorMillaTxt()} — configurable en la config. Ojo: a las millas sumales las tasas de Smiles (confirmalas en el link). Google Flights y Kayak buscan en todas las aerolíneas a la vez, como hacías a mano.</p>
    </div>`;
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden','false');
}

function renderStatus(){
  const el = $('#scanStatusText'); const foot = $('#footScan');
  if(!el) return;
  const E = estadoMotor();
  const s = E.sello;
  el.textContent = state.latest ? E.txt : 'sin datos aún';
  el.title = state.latest ? `${E.txt} — ${s.txt} (${s.hace})` : '';
  $('#scanStatus')?.classList.toggle('is-frio', !E.ok || s.nivel==='muy_viejo');
  if(foot) foot.textContent = state.latest?.generado ? `${s.txt} · ${s.hace}` : '';
  // Antes este aviso recién aparecía a las 26 h y prometía un cronograma
  // ("9:00 y 20:00") que la Mac no cumple: con la tapa cerrada macOS la despierta
  // 30 s cada 15 min y un barrido de 7 min tarda de 2 a 6 h. Medido en 14 días de
  // septiembre 2026: 12 corridas congeladas y atrasos típicos de 5 a 20 h. Ahora
  // avisamos a las 8 h y decimos la hora real del dato, sin prometer horarios.
  $('#staleWarn')?.remove();
  const main = document.querySelector('main');
  if(!main || !state.latest) return;
  if(!E.ok || (s.horas != null && s.horas >= SELLO_VIEJO_H)){
    const div = document.createElement('div');
    div.id = 'staleWarn';
    div.className = 'stalewarn';
    div.innerHTML = !E.ok
      ? `⚠️ <b>El último barrido no llegó a publicar precios.</b> ${E.txt}. Verificá en Smiles antes de decidir.`
      : `⚠️ <b>Los precios que ves son de las ${horaCorta(s.iso)} (${s.hace}).</b> La Mac rastrilla con la tapa cerrada y a veces tarda medio día en terminar. Smiles mueve la disponibilidad todo el tiempo: verificá antes de decidir.`;
    main.prepend(div);
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
  const R = state.latest.resultados;
  // Ni una media foto ni una ruta sin precio pueden ser "la mejor oportunidad".
  const r = R.find(x=>!esParcial(x) && conPrecio(x)) || R.find(conPrecio) || R[0];
  const parcial = esParcial(r);
  const isOp = r.nivel==='oportunidad' && !parcial;
  host.innerHTML = `
    <p class="hero__kicker">${parcial?'⏳ dato parcial':(isOp?'🟢 oportunidad detectada':'mejor precio ahora')}</p>
    <div class="hero__route"><span class="emoji">${r.destino_emoji}</span> ${r.destino_nombre}</div>
    <p class="hero__sub">${r.origen_ciudad} → ${r.aeropuerto_ciudad} · ${ymLabel(r.ym)}</p>
    <div class="hero__price">
      <span class="hero__miles">${fmtMiles(r.mejor_precio_millas)} <small>millas</small></span>
    </div>
    <p class="hero__dias">${diasMinLinea(r, true)}</p>
    ${diasMinHTML(r)}
    ${parcialHTML(r)}
    ${ctaSmilesHTML(r, 'hero__cta')}
    <p class="hero__sello">${selloHTML(r.consultado || 'radar')}</p>
    ${avisoVigencia(selloRuta(r))}`;
}

/* ---------- STATS ---------- */
function renderStats(){
  const host = $('#statStrip');
  if(!state.latest){ host.innerHTML=''; return; }
  const R = state.latest.resultados;
  const ops = R.filter(r=>r.nivel==='oportunidad' && !esParcial(r)).length;   // una media foto no es oportunidad
  const rutas = R.length;
  const destinos = new Set(R.map(r=>r.destino_key)).size;
  // Sin el filtro, una sola ruta sin precio (mejor_precio_millas en null) hacía
  // Math.min(null, …) = 0 y el mínimo del tablero se mostraba como "—".
  const precios = R.map(r=>r.mejor_precio_millas).filter(v=>v!=null);
  const min = precios.length ? Math.min(...precios) : null;
  host.innerHTML = `
    <div class="stat op"><b>${ops}</b><span>oportunidades</span></div>
    <div class="stat"><b>${rutas}</b><span>rutas activas</span></div>
    <div class="stat"><b>${destinos}</b><span>destinos</span></div>
    <div class="stat"><b>${min?fmtMiles(min):'—'}</b><span>millas · mínimo</span></div>`;
  renderSequia();
}

// Aviso de "sequía": el motor consultó muchas rutas y Smiles devolvió premios
// en muy pocas. Sin esto, la app parece rota cuando en realidad es Smiles el
// que vació su inventario (visto 24-jul-2026: de 47 consultadas, 1 con precio).
function renderSequia(){
  const L = state.latest;
  $('#sequiaWarn')?.remove();
  if(!L || !L.total_consultadas) return;
  // Cuántas trajeron precio de verdad. Desde el 8-sep-2026 total_rutas cuenta
  // también las que quedan publicadas con dias vacío (calendario recortado), así
  // que usarlo acá inflaba la cobertura y el aviso de sequía no salía nunca.
  const con = (L.resultados || []).filter(conPrecio).length;
  const tot = L.total_consultadas;
  if(tot < 5 || con/tot > 0.25) return;   // cobertura sana, no avisamos
  const div = document.createElement('div');
  div.id = 'sequiaWarn';
  div.className = 'stalewarn sequia';
  div.innerHTML = `🎫 <b>Smiles está mostrando muy pocos premios</b>: de ${tot} búsquedas, solo ${con} ${con===1?'trajo':'trajeron'} precio en millas.
    No es un problema de la app — Smiles carga y retira asientos con millas todo el tiempo, y cuando los saca no hay nada que mostrar.
    Radar: ${estadoMotor().txt}.`;
  $('#statStrip').insertAdjacentElement('afterend', div);
}

/* ---------- RADAR CARDS ---------- */
function filtraResultados(){
  let R = state.latest ? [...state.latest.resultados] : [];
  const f = state.filtro;
  if(f==='oportunidad') R = R.filter(r=>!esParcial(r) && (r.nivel==='oportunidad'||r.nivel==='bueno'));
  else if(f==='eeuu') R = R.filter(r=>r.region==='eeuu');
  else if(f==='europa') R = R.filter(r=>r.region==='europa');
  return R;
}

function nivelLabel(n){
  return {oportunidad:'🟢 Oportunidad',bueno:'🟢 Buen precio',normal:'⚪ Precio normal',caro:'🔴 Caro',
          parcial:'⏳ Media foto'}[n]||n;
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
  // Si el calendario vino incompleto no clasificamos: ni "caro" ni oportunidad,
  // porque con 1 día a la vista cualquier veredicto es mentira.
  const parcial = esParcial(r);
  const nivel = parcial ? 'parcial' : r.nivel;
  const op = r.nivel==='oportunidad' && !parcial;
  const motivo = (!parcial && r.motivos && r.motivos.length) ? `<p class="card__motivo">✦ ${r.motivos[0]}</p>` : '';
  return `
  <article class="card lvl-${nivel}" style="animation-delay:${i*40}ms">
    <div class="card__top">
      <div>
        <div class="card__dest"><span class="emoji">${r.destino_emoji}</span> ${r.destino_nombre}</div>
        <div class="card__air">${r.origen}<span class="arw">→</span>${r.aeropuerto} · ${r.aeropuerto_ciudad}</div>
      </div>
      <span class="semaforo ${nivel}">${nivelLabel(nivel).replace(/^\S+\s/,'')}</span>
    </div>
    <div class="card__price">
      <span class="card__miles ${op?'op':''}">${fmtMiles(r.mejor_precio_millas)}</span>
      <span class="card__unit">millas</span>
    </div>
    <p class="card__when">${ymLabel(r.ym)} · ${diasMinLinea(r)}${(r.promedio_historico&&!parcial)?` · prom. ${fmtMiles(r.promedio_historico)}`:''}</p>
    ${diasMinHTML(r)}
    ${parcialHTML(r)}
    ${cashLine(r)}
    ${vueloLine(r)}
    ${motivo}
    ${parcial?'':meterHTML(r.price_range)}
    <div class="card__actions">
      <button class="btn" data-toggle>Ver el mes</button>
      ${ctaSmilesHTML(r, 'btn btn--go')}
    </div>
    <p class="card__sello">${selloHTML(r.consultado || 'radar')}</p>
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
  if(!c || !c.precio || !conPrecio(r)) return '';   // sin millas no hay "millas vs plata"
  return `<div class="block">
    <h3>Millas vs plata · ${ymLabel(r.ym)}</h3>
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
  const byDate = {}; (r.dias||[]).forEach(d=>byDate[d.date]=d);
  const first = new Date(y,m-1,1);
  const startDow = (first.getDay()+6)%7; // lunes=0
  const days = new Date(y,m,0).getDate();
  const minSet = new Set(diasMin(r));   // una vez por calendario, no una por día
  let cells = DOW.map(d=>`<div class="dow">${d}</div>`).join('');
  for(let i=0;i<startDow;i++) cells+=`<div></div>`;
  for(let d=1; d<=days; d++){
    const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const info = byDate[iso];
    if(info){
      const q = info.price_range?`q${info.price_range}`:'';
      const km = Math.round(info.miles/1000);
      const min = minSet.has(iso) ? ' esmin' : '';
      cells += `<a class="dcell has ${q}${min}" href="${smilesOneWayURL(r.origen, r.aeropuerto, iso)}" target="_blank" rel="noopener" title="${dateLabel(iso)}: ${fmtMiles(info.miles)} millas — verificar en Smiles"><span>${d}</span><span class="dm">${km}k</span></a>`;
    } else {
      cells += `<div class="dcell"><span>${d}</span></div>`;
    }
  }
  const s = selloRuta(r);
  const armable = armadorCodes(r.destino_key, r.ym).includes(r.aeropuerto);
  const armBtn = armable ? `<button type="button" class="btn btn--go armlink" style="margin-top:10px;padding:9px 16px" data-dest="${r.destino_key}" data-ym="${r.ym}" data-code="${r.aeropuerto}">🔀 Armar ida y vuelta con estos días</button>` : '';
  return `<div class="monthcal__grid">${cells}</div>
  ${armBtn}
  <p class="hint" style="margin-top:8px">Verde = los días al mejor precio. Tocá cualquier día para abrirlo en Smiles. Tarifa Club Smiles según ${s.txt} (${s.hace}); la disponibilidad se mueve durante el día y el precio final lo confirma Smiles al abrir.</p>
  ${avisoVigencia(s)}`;
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
     .forEach(r=>{ if(!conPrecio(r)) return;
       if(!porDest[r.destino_key] || r.mejor_precio_millas<porDest[r.destino_key].mejor_precio_millas) porDest[r.destino_key]=r; });
    const cells = Object.values(porDest)
      .sort((a,b)=>a.mejor_precio_millas-b.mejor_precio_millas)
      .map(r=>{
        const op = r.nivel==='oportunidad';
        return `<div class="bestcell ${op?'op':''}" data-ruta="${r.ruta}">
          <div class="bestcell__d">${r.destino_emoji} ${r.destino_nombre}</div>
          <div class="bestcell__m ${op?'op':''}">${fmtMiles(r.mejor_precio_millas)}</div>
          <div class="bestcell__w">millas · ${diasMinTxt(r)}</div>
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
  R.forEach(r=>{ if(!conPrecio(r)) return;   // sin precio no hay barra que dibujar
    const mi=+r.ym.slice(5,7); if(!porMes[mi]||r.mejor_precio_millas<porMes[mi]) porMes[mi]=r.mejor_precio_millas; });
  // la ruta más barata del destino: de ahí salen la comparación y el histórico
  const mejorR = masBarata(R);

  const body = $('#sheetBody');
  body.innerHTML = `
    <div class="destcard__emoji" style="font-size:2.4rem">${d.emoji}</div>
    <h2 class="sheet__title">${d.nombre}</h2>
    <p class="sheet__pais">${d.pais} · ${d.aeropuertos.map(a=>a.code).join(' / ')}</p>
    ${bestFound(R)}
    ${histBlock(mejorR)}
    ${armadorEntradaBlock(key)}
    ${comparaBlock(mejorR)}
    ${vuelosBlock(mejorR ? (mejorR.detalle || (R.find(x=>x.detalle)?.detalle) || null) : null)}
    ${pricesByMonthBlock(porMes,R)}
    ${climateBlock(clima)}
    ${seasonHint(porMes, clima)}
  `;
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden','false');
}

function bestFound(R){
  if(!R.length) return `<div class="block"><p class="hint">Todavía no rastreamos precios para este destino. Agregalo a un viaje o a los destinos vigilados en la config y corré el motor.</p></div>`;
  const best = masBarata(R);   // mismo desempate que comparaBlock, salteando las que no trajeron precio
  const parcial = esParcial(best);
  const op = best.nivel==='oportunidad' && !parcial;
  const s = selloRuta(best);
  return `<div class="block">
    <h3>Mejor precio detectado</h3>
    <div class="card__price"><span class="card__miles ${op?'op':''}">${fmtMiles(best.mejor_precio_millas)}</span><span class="card__unit">millas</span></div>
    <p class="card__when">${best.origen} → ${best.aeropuerto} · ${ymLabel(best.ym)} · ${diasMinLinea(best)}</p>
    ${diasMinHTML(best)}
    ${parcialHTML(best)}
    ${ctaSmilesHTML(best, 'btn btn--go', 'display:inline-block;margin-top:8px;padding:9px 16px')}
    <p class="card__sello">${selloHTML(best.consultado || 'radar')}</p>
    ${avisoVigencia(s)}
    ${paxHint()}
    ${smilesMoneyHint}
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
      El motor la toma en el próximo barrido. 🛰️
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

if (!window.NV_CINE) init();

/* ================= ARMADOR ida y vuelta (elegí día por día) ================= */
function armadorCodes(destKey, ym){
  const b = bDestinos()[destKey]?.meses?.[ym];
  if(!b) return [];
  return Object.keys(b.ida||{}).filter(c=>(b.vuelta?.[c]||[]).length);
}

function openArmador(destKey, ym, code, preIda, preVuelta){
  const codes = armadorCodes(destKey, ym);
  if(!codes.length) return;
  state.armador = {
    dest: destKey, ym,
    code: (code && codes.includes(code)) ? code : codes[0],
    ida: preIda || null, vuelta: preVuelta || null,
  };
  renderArmador(true);
}

function armadorGrid(dias, seleccionado, tipo){
  // dias: [{d,mi,q,f}] puede cruzar de mes (la vuelta cubre mes + siguiente)
  const porMes = {};
  dias.forEach(x=>{ const k=x.d.slice(0,7); (porMes[k]=porMes[k]||[]).push(x); });
  const min = Math.min(...dias.map(x=>x.mi));
  return Object.keys(porMes).sort().map(ymk=>{
    const [y,m] = ymk.split('-').map(Number);
    const byDate = {}; porMes[ymk].forEach(x=>byDate[x.d]=x);
    const startDow = (new Date(y,m-1,1).getDay()+6)%7;
    const ndays = new Date(y,m,0).getDate();
    let cells = DOW.map(d=>`<div class="dow">${d}</div>`).join('');
    for(let i=0;i<startDow;i++) cells+=`<div></div>`;
    for(let dd=1; dd<=ndays; dd++){
      const iso=`${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      const info=byDate[iso];
      if(info){
        const sel = iso===seleccionado ? ` sel-${tipo}`:'';
        const best = info.mi===min?' best':'';
        cells+=`<button type="button" class="daychip has arm${best}${sel}" data-tipo="${tipo}" data-d="${iso}" title="${dateLabel(iso)} · ${fmtMiles(info.mi)} millas">
          <span>${dd}</span><span class="dm">${Math.round(info.mi/1000)}k</span></button>`;
      } else cells+=`<div class="daycell-empty">${dd}</div>`;
    }
    return `<p class="arm__meslabel">${ymLabel(ymk)}</p><div class="daygrid">${cells}</div>`;
  }).join('');
}

function renderArmador(abrir){
  const A = state.armador;
  const d = bDestinos()[A.dest]; if(!d) return;
  const b = d.meses[A.ym];
  const codes = armadorCodes(A.dest, A.ym);
  const idas = b.ida[A.code]||[];
  const vueltas = b.vuelta[A.code]||[];
  const ciudad = (d.aeropuertos.find(a=>a.code===A.code)||{}).ciudad || A.code;

  const chips = codes.length>1 ? `<div class="arm__codes">${codes.map(c=>{
    const cc=(d.aeropuertos.find(a=>a.code===c)||{}).ciudad||c;
    return `<button type="button" class="segbtn arm__code${c===A.code?' is-active':''}" data-code="${c}">${c} · ${cc}</button>`;
  }).join('')}</div>` : '';

  const body = $('#sheetBody');
  body.innerHTML = `
    <h2 class="sheet__title">🔀 Armá tu ${d.nombre}</h2>
    <p class="sheet__pais">${d.origen} ⇄ ${A.code} · ${ciudad} · ${ymLabel(A.ym)}</p>
    ${chips}
    <div class="block">
      <h3>1 · Elegí tu día de IDA <span class="arm__dir">${d.origen} → ${A.code}</span></h3>
      ${armadorGrid(idas, A.ida, 'ida')}
    </div>
    <div class="block">
      <h3>2 · Elegí tu día de VUELTA <span class="arm__dir">${A.code} → ${d.origen}</span></h3>
      ${armadorGrid(vueltas, A.vuelta, 'vta')}
    </div>
    <div class="armbar" id="armBar">${armadorBarHTML()}</div>
    <p class="hint">${selloBloqueHTML(A.dest, A.ym)} — las idas se refrescan en cada barrido; las vueltas se renuevan de a tandas, así que el sello marca la pierna más vieja de este destino-mes.</p>
    <p class="hint">Verde punteado = el día más barato de cada calendario. Los números son miles de millas (63k = 63.000). Tocá un día de cada calendario y abajo se arma el viaje.</p>
  `;
  $$('.daychip.arm',body).forEach(c=>c.addEventListener('click',()=>{
    if(c.dataset.tipo==='ida') A.ida = c.dataset.d; else A.vuelta = c.dataset.d;
    renderArmador(false);
  }));
  $$('.arm__code',body).forEach(c=>c.addEventListener('click',()=>{
    A.code = c.dataset.code; A.ida = A.vuelta = null; renderArmador(false);
  }));
  if(abrir){ $('#sheet').classList.add('open'); $('#sheet').setAttribute('aria-hidden','false'); }
  if(!abrir){ /* mantener al usuario cerca de la barra */ }
}

function armadorBarHTML(){
  const A = state.armador;
  const d = bDestinos()[A.dest];
  const b = d.meses[A.ym];
  const idas = b.ida[A.code]||[], vueltas = b.vuelta[A.code]||[];
  const iSel = idas.find(x=>x.d===A.ida), vSel = vueltas.find(x=>x.d===A.vuelta);
  if(!iSel && !vSel) return `<div class="armbar__hint">👆 Elegí un día de ida y uno de vuelta</div>`;
  if(iSel && !vSel) return `<div class="armbar__hint">IDA ${dateLabel(iSel.d)} · ${fmtMiles(iSel.mi)} mi — falta la vuelta 👆</div>`;
  if(!iSel && vSel) return `<div class="armbar__hint">VUELTA ${dateLabel(vSel.d)} · ${fmtMiles(vSel.mi)} mi — falta la ida 👆</div>`;
  const n = diasEntre(iSel.d, vSel.d);
  if(n<=0) return `<div class="armbar__hint">⚠️ La vuelta (${dateLabel(vSel.d)}) tiene que ser después de la ida (${dateLabel(iSel.d)})</div>`;
  const total = iSel.mi + vSel.mi;
  const c = {ida:iSel, vuelta:vSel,
             cashIda: cashLeg(b,'ida',A.code,iSel.d),
             cashVuelta: cashLeg(b,'vuelta',A.code,vSel.d)};
  const a = mejorArmado(c);
  const orig = d.origen;
  return `
    <div class="armbar__row">
      <div class="armbar__tot"><b>${fmtMiles(total)}</b> millas · ${n} ${n===1?'noche':'noches'}</div>
      <div class="armbar__fechas">${dateLabel(iSel.d)} → ${dateLabel(vSel.d)}</div>
    </div>
    ${a?`<div class="armbar__sug">💡 ${armadoTxt(a)} ≈ <b>${fmtUSD(a.totalEq)}</b> <span class="cash__t">equivalente</span></div>`:''}
    <div class="armbar__btns">
      <a class="btn btn--go" href="${smilesRoundURL(orig,A.code,iSel.d,vSel.d,d.moneda)}" target="_blank" rel="noopener">✈ Verificar ida y vuelta en Smiles ↗</a>
      <a class="btn" href="${smilesOneWayURL(orig,A.code,iSel.d,d.moneda)}" target="_blank" rel="noopener">Solo ida ↗</a>
      <a class="btn" href="${smilesOneWayURL(A.code,orig,vSel.d,d.moneda)}" target="_blank" rel="noopener">Solo vuelta ↗</a>
      <a class="btn" href="${googleFlightsURL(orig,A.code,iSel.d,vSel.d)}" target="_blank" rel="noopener">Google Flights ↗</a>
      <a class="btn" href="${despegarDayURL(orig,A.code,iSel.d).replace('/oneway/','/roundtrip/').replace('/'+iSel.d+'/','/'+iSel.d+'/'+vSel.d+'/')}" target="_blank" rel="noopener">Despegar ↗</a>
    </div>
    ${paxHint()}
    ${smilesMoneyHint}`;
}

// Entrada al armador desde cualquier lado (tarjetas, ficha, combos)
document.addEventListener('click', e=>{
  const b = e.target.closest('.armlink');
  if(!b) return;
  openArmador(b.dataset.dest, b.dataset.ym, b.dataset.code||null,
              b.dataset.ida||null, b.dataset.vta||null);
});

// Bloque de entrada al armador desde la ficha de destino (un botón por mes)
function armadorEntradaBlock(destKey){
  const d = bDestinos()[destKey];
  if(!d) return '';
  const meses = Object.keys(d.meses||{}).sort().filter(ym=>armadorCodes(destKey,ym).length);
  if(!meses.length) return '';
  const btns = meses.map(ym=>`<button type="button" class="btn armlink" data-dest="${destKey}" data-ym="${ym}">🔀 ${ymLabel(ym)}</button>`).join('');
  return `<div class="block"><h3>Armar ida y vuelta</h3>
    <div class="diaslinks">${btns}</div>
    <p class="hint" style="margin-top:8px">Elegís tu día de ida y tu día de vuelta en dos calendarios, y te suma el total al instante.</p></div>`;
}


/* ================= Puente para la experiencia cinematográfica =================
   La capa visual nueva (cine.js + escenas/) reutiliza este mismo cerebro:
   datos, cálculos de millas vs plata, links a Smiles/Despegar y las hojas del
   Armador y de cada destino. Nada de esa lógica se duplica allá. */
window.NV = {
  state, cargarDatos, setupSheet, closeSheet, setupLock,
  // --- API del contrato (las estaciones programan contra esto) ---
  pasajeros, paxTxt, paxTotal, paxHint,
  diasMin, diasMinTxt, diasMinHTML, diasMinChips, listaDiasTxt, desdeTxt, diasMinLinea,
  conPrecio, masBarata, fechaLink, smilesMesURL, ctaSmilesHTML,
  sello, selloRuta, selloDe, selloHTML, selloTexto, refrescarSellos, avisoVigencia,
  selloBloque, selloBloqueHTML,
  estadoMotor, hist, histMovimiento, histBlock, sparkline,
  esParcial, parcialHTML,
  refrescar, emitirDatos, arrancarLatido,
  // datos derivados
  bDestinos, vueltasDestino, destinosConVuelta, mesesVuelta,
  calcularCombos, mejorArmado, armadoTxt, cashLeg, cashRefDestino, cpp,
  valorMilla, valorMillaTxt, idaDaysUnion, diasEntre,
  // hojas (modales) que ya existen
  openDestino, openArmador, openArmadoSheet, openEditor,
  // helpers de formato
  fmtMiles, fmtUSD, ymLabel, dateLabel, fechaCorta, horaCorta, haceCuanto,
  durTxt, escTxt, cashTipoTxt, nivelLabel,
  // links
  smilesURL, smilesRoundURL, smilesOneWayURL,
  despegarDayURL, googleFlightsURL, kayakURL, aviasalesDayURL,
  // constantes
  MONTHS, MONTHS_LONG, DOW, PIN_HASH,
  registerSW,
};
