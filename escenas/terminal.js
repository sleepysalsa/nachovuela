/* ============================================================================
   NachoVuela · escena TERMINAL — el mundo donde ocurre todo
   ----------------------------------------------------------------------------
   Esta escena no se apaga nunca: es el fondo de todas las demás. Por eso vive
   en z-index bajo (0..3), no toca el centro del plano y su estado final (p=1)
   es un fondo estable y lindo para la Mac, los carteles y la revista.

   Capas, de atrás hacia adelante:
     0 · exterior   cielo, resplandor de ciudad, skyline, pista viva (aviones,
                    carro de equipaje, balizas con ritmos distintos)
     1 · ventanal   vidrio con reflejos + parteluces verticales + marco
     1 · techo/piso interior de la terminal, luminarias y sus reflejos
     2 · hazes      conos de luz cenital
     2 · gente      siluetas de pasajeros con parallax (una con valijita)
     3 · nacho      el protagonista sentado, gorra "NachoVuela"
     3 · polvo      partículas suspendidas
     3 · viñeta     cierre óptico + corte suave al POV
     3 · título     "NachoVuela · tu radar de oportunidades"

   Todo lo autónomo corre con animaciones CSS: la terminal está viva aunque
   nadie scrollee. update(p) sólo mueve la cámara (transform/opacity).
   ========================================================================== */
(function () {
  'use strict';

  const NV = window.NV;
  if (!NV || typeof NV.escena !== 'function') return;

  /* ---------- utilidades de construcción (corren UNA vez, en html()) ------ */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const n2  = v => Math.round(v * 100) / 100;
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- datos: rutas reales para los avioncitos -------------------- */
  function rutasDelRadar(ctx) {
    const res = (ctx && ctx.resultados) || [];
    const orden = res.slice().sort((a, b) => {
      const pa = (a && a.nivel === 'oportunidad') ? 0 : (a && a.nivel === 'bueno') ? 1 : 2;
      const pb = (b && b.nivel === 'oportunidad') ? 0 : (b && b.nivel === 'bueno') ? 1 : 2;
      return pa - pb;
    });
    const out = [];
    for (const x of orden) {
      if (!x) continue;
      const par = (x.origen || 'EZE') + '→' + (x.aeropuerto || (x.destino_key || '').slice(0, 3).toUpperCase());
      if (par.length > 4 && out.indexOf(par) === -1) out.push(par);
      if (out.length >= 4) break;
    }
    const relleno = ['EZE→MIA', 'EZE→MAD', 'EZE→GRU', 'EZE→SCL'];
    while (out.length < 4) out.push(relleno[out.length]);
    return out;
  }

  /* Mejor oportunidad: la usa el avión que despega */
  function mejorVuelo(ctx) {
    const res = (ctx && ctx.resultados) || [];
    /* manda el veredicto del radar; a igual nivel, la que menos millas pide */
    const rango = n => n === 'oportunidad' ? 0 : n === 'bueno' ? 1 : n === 'normal' ? 2 : 3;
    let mejor = null;
    for (const x of res) {
      if (!x || !x.mejor_precio_millas) continue;
      const cand = { niv: rango(x.nivel), mi: x.mejor_precio_millas, r: x };
      if (!mejor || cand.niv < mejor.niv || (cand.niv === mejor.niv && cand.mi < mejor.mi)) mejor = cand;
    }
    if (!mejor) return null;
    const r = mejor.r;
    const mi = (ctx.NV && ctx.NV.fmtMiles) ? ctx.NV.fmtMiles(r.mejor_precio_millas) : r.mejor_precio_millas;
    return {
      par: (r.origen || 'EZE') + '→' + (r.aeropuerto || '···'),
      txt: mi + ' millas',
    };
  }

  function copete(ctx) {
    const res = (ctx && ctx.resultados) || [];
    const ops = res.filter(x => x && x.nivel === 'oportunidad').length;
    const cod = (res[0] && res[0].origen) || 'EZE';
    const ciu = (res[0] && res[0].origen_ciudad) || 'Buenos Aires';
    let dato;
    if (!res.length)   dato = 'el radar sigue mirando el cielo';
    else if (ops)      dato = ops + ' oportunidad' + (ops === 1 ? '' : 'es') + ' en el aire';
    else               dato = res.length + ' ruta' + (res.length === 1 ? '' : 's') + ' vigiladas';
    return { origen: cod + ' · ' + ciu, dato };
  }

  /* ======================================================================== *
   *  1 · EXTERIOR: pista de noche detrás del vidrio
   * ======================================================================== */

  /* Skyline lejano: perfil dentado + ventanitas encendidas recortadas */
  function svgSkyline() {
    let d = 'M0,140 L0,104 ';
    let x = 0;
    while (x < 1600) {
      const w = rnd(26, 104), h = rnd(14, 78);
      d += 'L' + n2(x) + ',' + n2(140 - h) + ' L' + n2(x + w) + ',' + n2(140 - h) + ' ';
      x += w;
    }
    d += 'L1600,140 Z';

    let ventanas = '';
    for (let i = 0; i < 130; i++) {
      ventanas += '<rect x="' + n2(rnd(0, 1596)) + '" y="' + n2(rnd(62, 136)) +
                  '" width="2.4" height="3.4" opacity="' + n2(rnd(.18, .8)) + '"/>';
    }

    return '<svg viewBox="0 0 1600 140" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><clipPath id="terminalSkyClip"><path d="' + d + '"/></clipPath></defs>' +
      '<path class="terminal-sky__masa" d="' + d + '"/>' +
      '<g class="terminal-sky__ventanas" clip-path="url(#terminalSkyClip)">' + ventanas + '</g>' +
      /* torre de control */
      '<g class="terminal-sky__torre">' +
        '<path d="M1268,140 L1268,58 L1282,58 L1282,140 Z"/>' +
        '<path d="M1252,58 L1298,58 L1292,34 L1258,34 Z"/>' +
      '</g>' +
      '<circle class="terminal-sky__faro" cx="1275" cy="28" r="4"/>' +
      '</svg>';
  }

  /* Luces de borde de pista, con espaciado en perspectiva */
  function lucesPista() {
    const N = 12;
    let out = '';
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const f = Math.pow(u, 2.15);
      const y  = f * 100;
      const s  = 1.1 + f * 3.6;
      const op = 0.22 + f * 0.62;
      const xl = 41 + (1 - 41) * f;
      const xr = 52 + (126 - 52) * f;
      out += '<i class="terminal-luz" style="left:' + n2(xl) + '%;top:' + n2(y) +
             '%;--s:' + n2(s) + 'px;--o:' + n2(op) + ';animation-delay:-' + n2(i * .37) + 's"></i>';
      out += '<i class="terminal-luz terminal-luz--fria" style="left:' + n2(xr) + '%;top:' + n2(y) +
             '%;--s:' + n2(s) + 'px;--o:' + n2(op * .9) + ';animation-delay:-' + n2(i * .41 + .2) + 's"></i>';
    }
    return out;
  }

  /* "Conejo": estrobos de aproximación en secuencia */
  function estrobos() {
    let out = '';
    for (let i = 0; i < 6; i++) {
      const f = Math.pow(i / 5, 1.9) * .26;
      out += '<i class="terminal-estrobo" style="left:' + n2(45 + (63 - 45) * f) + '%;top:' +
             n2(f * 100) + '%;animation-delay:' + n2(i * .09) + 's"></i>';
    }
    return out;
  }

  /* Balizas dispersas, cada una con su ritmo */
  function balizas() {
    const spec = [
      [8,  1.4, 'a', 3.1], [17, 2.6, 'b', 4.4], [26, 0.9, 'c', 6.2],
      [34, 3.4, 'a', 2.3], [63, 1.1, 'b', 5.1], [71, 2.2, 'c', 3.7],
      [79, 0.7, 'a', 4.9], [88, 3.9, 'b', 2.8], [95, 1.8, 'c', 5.6],
    ];
    return spec.map(function (s, i) {
      return '<i class="terminal-baliza terminal-baliza--' + s[2] +
        '" style="left:' + s[0] + '%;top:' + s[1] + '%;animation-duration:' + s[3] +
        's;animation-delay:-' + n2(i * .8) + 's"></i>';
    }).join('');
  }

  /* Avión chiquito de perfil */
  function svgAvion() {
    return '<svg viewBox="0 0 150 42" aria-hidden="true">' +
      '<path d="M8,26 C24,19 52,16 84,16 L110,16 C126,16 140,19 145,24 C140,29 126,31 110,31 L36,31 C22,31 12,29 8,26 Z"/>' +
      '<path d="M78,16 L92,2 L101,2 L92,16 Z"/>' +
      '<path d="M62,29 L52,40 L61,40 L73,29 Z"/>' +
      '</svg>';
  }

  /* Aviones que cruzan lento el horizonte */
  function aviones(rutas) {
    const cfg = [
      { top: '46%', s: .34, dur: 78, del: -14, dir: 1,  tag: rutas[0], op: .5 },
      { top: '33%', s: .22, dur: 112, del: -52, dir: -1, tag: '',        op: .38 },
      { top: '54%', s: .46, dur: 64, del: -33, dir: 1,  tag: rutas[1], op: .58 },
    ];
    return cfg.map(function (c, i) {
      return '<div class="terminal-avion terminal-avion--' + (c.dir > 0 ? 'der' : 'izq') +
        '" style="top:' + c.top + ';animation-duration:' + c.dur + 's;animation-delay:' + c.del + 's">' +
        '<div class="terminal-avion__cuerpo" style="--s:' + c.s + ';--o:' + c.op + '">' +
          svgAvion() +
          '<i class="terminal-nav terminal-nav--roja" style="animation-delay:-' + (i * .3) + 's"></i>' +
          '<i class="terminal-nav terminal-nav--verde"></i>' +
          '<i class="terminal-nav terminal-nav--blanca" style="animation-delay:-' + (i * .55) + 's"></i>' +
        '</div>' +
        (c.tag ? '<span class="terminal-tag">' + esc(c.tag) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  /* El que despega en diagonal, con la mejor ruta del radar */
  function despegue(ctx, rutas) {
    const m = mejorVuelo(ctx);
    const par = m ? m.par : rutas[0];
    const sub = m ? m.txt : 'rumbo norte';
    return '<div class="terminal-despegue">' +
      '<div class="terminal-despegue__nave">' +
        svgAvion() +
        '<i class="terminal-nav terminal-nav--roja"></i>' +
        '<i class="terminal-nav terminal-nav--blanca"></i>' +
        '<span class="terminal-tag terminal-tag--vuelo">' + esc(par) +
          '<b>' + esc(sub) + '</b></span>' +
      '</div></div>';
  }

  /* Carro de equipaje cruzando la plataforma */
  function carro() {
    return '<div class="terminal-carro">' +
      '<div class="terminal-carro__tren">' +
        '<svg viewBox="0 0 230 62" aria-hidden="true">' +
          '<path d="M4,30 L4,14 L30,14 L36,30 L44,30 L44,44 L4,44 Z"/>' +
          '<path d="M56,20 L104,20 L104,44 L56,44 Z"/>' +
          '<path d="M116,20 L164,20 L164,44 L116,44 Z"/>' +
          '<path d="M176,20 L224,20 L224,44 L176,44 Z"/>' +
          '<circle cx="14" cy="48" r="6"/><circle cx="36" cy="48" r="6"/>' +
          '<circle cx="66" cy="48" r="5"/><circle cx="96" cy="48" r="5"/>' +
          '<circle cx="126" cy="48" r="5"/><circle cx="156" cy="48" r="5"/>' +
          '<circle cx="186" cy="48" r="5"/><circle cx="216" cy="48" r="5"/>' +
        '</svg>' +
        '<i class="terminal-carro__baliza"></i>' +
      '</div></div>';
  }

  function exterior(ctx) {
    const rutas = rutasDelRadar(ctx);
    return '<div class="terminal-exterior">' +
      '<div class="terminal-cielo"></div>' +
      '<div class="terminal-resplandor"></div>' +
      '<div class="terminal-skyline">' + svgSkyline() + '</div>' +
      '<div class="terminal-horizonte"></div>' +
      '<div class="terminal-suelo">' +
        '<div class="terminal-asfalto"></div>' +
        '<div class="terminal-luces">' + lucesPista() + estrobos() + balizas() + '</div>' +
        carro() +
      '</div>' +
      aviones(rutas) +
      despegue(ctx, rutas) +
      '</div>';
  }

  /* ======================================================================== *
   *  2 · VENTANAL: parteluces, vidrio y reflejos
   * ======================================================================== */
  function ventanal() {
    let reflejos = '';
    const rf = [[6, 18, 34], [38, 12, 26], [72, 22, 40]];
    for (const [l, w, h] of rf) {
      reflejos += '<i class="terminal-reflejo" style="left:' + l + '%;width:' + w + '%;height:' + h + '%"></i>';
    }
    return '<div class="terminal-ventanal">' +
      '<div class="terminal-vidrio"></div>' +
      '<div class="terminal-reflejos">' + reflejos + '</div>' +
      '<div class="terminal-brillo"></div>' +
      '<div class="terminal-parteluces"></div>' +
      '<div class="terminal-travesano"></div>' +
      '<div class="terminal-marco"></div>' +
      '</div>';
  }

  function interior() {
    let luminarias = '';
    for (let i = 0; i < 7; i++) {
      luminarias += '<i style="left:' + n2(4 + i * 14) + '%"></i>';
    }
    let charcos = '';
    for (let i = 0; i < 7; i++) {
      charcos += '<i style="left:' + n2(3 + i * 14) + '%;animation-delay:-' + n2(i * 1.7) + 's"></i>';
    }
    return '<div class="terminal-techo">' + luminarias + '</div>' +
      '<div class="terminal-piso"><div class="terminal-piso__charcos">' + charcos + '</div></div>';
  }

  /* ======================================================================== *
   *  3 · GENTE: siluetas con parallax
   * ======================================================================== */
  function svgPasajero(valija) {
    return '<svg viewBox="0 0 130 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
      '<path class="terminal-p-pierna terminal-p-pierna--a" d="M46,148 L38,222 L31,286 L51,288 L55,224 L63,150 Z"/>' +
      '<path class="terminal-p-pierna terminal-p-pierna--b" d="M67,150 L75,222 L81,286 L100,282 L87,222 L80,148 Z"/>' +
      '<circle class="terminal-p-cabeza" cx="62" cy="28" r="17"/>' +
      '<path class="terminal-p-torso" d="M62,46 C46,50 38,66 37,94 C36,120 40,140 43,156 L84,156 C87,140 90,120 89,94 C88,66 78,50 62,46 Z"/>' +
      '<path class="terminal-p-brazo" d="M45,62 C36,86 33,112 34,142 L46,144 C48,116 51,92 57,70 Z"/>' +
      (valija
        ? '<g class="terminal-p-valija">' +
            '<rect x="2" y="198" width="28" height="44" rx="5"/>' +
            '<path class="terminal-p-asa" d="M22,200 L28,150 L36,148"/>' +
            '<circle cx="9" cy="247" r="4"/><circle cx="24" cy="247" r="4"/>' +
          '</g>'
        : '') +
      '</svg>';
  }

  function gente() {
    /* escala · piso · duración · retraso · dirección · desenfoque · opacidad · valija */
    const P = [
      { s: .30, b: 21, d: 74, t: -8,  dir:  1, bl: 2.2, o: .42, v: 0, paso: 1.25 },
      { s: .42, b: 17, d: 58, t: -31, dir: -1, bl: 1.4, o: .55, v: 1, paso: 1.05 },
      { s: .52, b: 13, d: 46, t: -12, dir:  1, bl: .8,  o: .68, v: 0, paso: .95 },
      { s: .64, b: 10, d: 39, t: -25, dir: -1, bl: .4,  o: .78, v: 0, paso: .88 },
      { s: .80, b: 5,  d: 33, t: -47, dir:  1, bl: 0,   o: .88, v: 1, paso: .82 },
      { s: .95, b: 1,  d: 27, t: -63, dir: -1, bl: 0,   o: .94, v: 0, paso: .76 },
    ];
    return '<div class="terminal-gente">' + P.map(function (c) {
      return '<div class="terminal-pasajero terminal-pasajero--' + (c.dir > 0 ? 'der' : 'izq') +
        '" style="bottom:' + c.b + '%;animation-duration:' + c.d + 's;animation-delay:' + c.t + 's">' +
        '<div class="terminal-pasajero__bob" style="--s:' + c.s + ';--bl:' + c.bl +
          'px;--o:' + c.o + ';--paso:' + c.paso + 's">' +
          svgPasajero(c.v) +
        '</div></div>';
    }).join('') + '</div>';
  }

  /* ======================================================================== *
   *  4 · EL PROTAGONISTA
   * ======================================================================== */
  function nacho() {
    return '<div class="terminal-nacho"><div class="terminal-nacho__aura"></div>' +
      '<svg class="terminal-nacho__svg" viewBox="0 0 400 520" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="terminalCuerpo" gradientUnits="userSpaceOnUse" x1="0" y1="80" x2="0" y2="500">' +
          '<stop offset="0" stop-color="#26334f"/>' +
          '<stop offset=".42" stop-color="#141d33"/>' +
          '<stop offset="1" stop-color="#111b2e"/>' +
        '</linearGradient>' +
        '<linearGradient id="terminalGorra" gradientUnits="userSpaceOnUse" x1="108" y1="84" x2="252" y2="156">' +
          '<stop offset="0" stop-color="#3d527f"/>' +
          '<stop offset="1" stop-color="#13203a"/>' +
        '</linearGradient>' +
      '</defs>' +

      /* butaca de sala de espera */
      '<g class="terminal-butaca">' +
        '<path d="M292,350 L380,342 L370,228 L296,238 Z"/>' +
        '<path d="M146,350 L394,340 L398,370 L148,378 Z"/>' +
        '<path class="terminal-butaca__pata" d="M174,376 L170,504"/>' +
        '<path class="terminal-butaca__pata" d="M372,370 L376,504"/>' +
        '<path class="terminal-butaca__pata" d="M172,468 L374,460"/>' +
      '</g>' +

      /* mochila apoyada */
      '<path class="terminal-mochila" d="M300,504 C286,504 278,492 280,474 C282,452 292,440 308,440 C324,440 334,452 334,472 C334,492 322,504 306,504 Z"/>' +

      /* pierna lejana */
      '<g class="terminal-nacho__lejos">' +
        '<path class="terminal-miembro" style="stroke-width:44" d="M262,350 L140,368"/>' +
        '<path class="terminal-miembro" style="stroke-width:32" d="M140,368 L128,490"/>' +
        '<path class="terminal-miembro" style="stroke-width:18" d="M128,494 L86,502"/>' +
      '</g>' +

      /* torso */
      '<path class="terminal-cuerpo" d="M212,178 C246,192 258,258 266,332 C270,352 262,366 242,364 L216,360 C202,344 197,300 196,258 C194,224 196,196 212,178 Z"/>' +

      /* pierna cercana */
      '<path class="terminal-miembro terminal-miembro--near" style="stroke-width:48" d="M252,344 L118,352"/>' +
      '<path class="terminal-miembro terminal-miembro--near" style="stroke-width:34" d="M118,352 L104,486"/>' +
      '<path class="terminal-miembro terminal-miembro--near" style="stroke-width:20" d="M102,490 L54,500"/>' +

      /* brazo apoyado en el muslo */
      '<path class="terminal-miembro terminal-brazo" style="stroke-width:30" d="M224,198 L240,272"/>' +
      '<path class="terminal-miembro terminal-brazo" style="stroke-width:24" d="M240,272 L188,338"/>' +
      '<circle class="terminal-brazo-mano" cx="182" cy="341" r="12"/>' +

      /* cuello + cabeza de perfil */
      '<path class="terminal-miembro terminal-miembro--near" style="stroke-width:26" d="M208,186 L214,208"/>' +
      '<g class="terminal-cabeza" transform="translate(40,31) scale(.8)">' +
        '<path class="terminal-cuerpo" d="M244,142 C244,118 227,101 203,101 C184,101 170,113 166,131 C165,137 161,142 157,147 C154,151 155,155 160,157 C165,159 166,163 166,170 C166,180 175,190 189,192 C216,196 244,178 244,154 Z"/>' +
        /* la gorra: la marca es la protagonista */
        '<path class="terminal-gorra" d="M164,129 C168,102 191,86 215,90 C238,94 248,111 248,133 C229,120 188,119 164,129 Z"/>' +
        '<path class="terminal-gorra terminal-gorra--visera" d="M166,127 C145,127 125,131 113,138 C119,147 145,149 171,141 C168,136 167,131 166,127 Z"/>' +
        '<text class="terminal-marca" x="173" y="118" transform="rotate(-8 200 112)">NachoVuela</text>' +
        '<g class="terminal-rim terminal-rim--frio"><path d="M248,133 C248,111 238,95 215,90"/></g>' +
        '<g class="terminal-rim">' +
          '<path d="M113,138 C125,131 145,127 166,127"/>' +
          '<path d="M166,131 C165,137 161,142 157,147 C154,151 155,155 160,157 C165,159 166,163 166,170"/>' +
        '</g>' +
      '</g>' +

      /* luz de borde: el ventanal desde la izquierda, la luminaria desde arriba */
      '<g class="terminal-rim terminal-rim--frio">' +
        '<path d="M214,182 C244,195 256,246 262,300"/>' +
        '<path d="M232,206 L244,268"/>' +
      '</g>' +
      '<g class="terminal-rim">' +
        '<path d="M196,258 C194,224 196,196 212,180"/>' +
        '<path d="M100,364 L88,486"/>' +
      '</g>' +
      '</svg></div>';
  }

  /* ======================================================================== *
   *  5 · ATMÓSFERA
   * ======================================================================== */
  function hazes() {
    const H = [[10, 24, 11], [46, 17, 15], [78, 27, 13]];
    return '<div class="terminal-hazes">' + H.map(function (h, i) {
      return '<i style="left:' + h[0] + '%;--w:' + h[1] + 'vw;animation-duration:' + h[2] +
        's;animation-delay:-' + (i * 2.4) + 's"></i>';
    }).join('') + '</div>';
  }

  function polvo(n) {
    let out = '';
    for (let i = 0; i < n; i++) {
      out += '<i style="left:' + n2(rnd(1, 99)) + '%;top:' + n2(rnd(6, 94)) +
        '%;--sz:' + n2(rnd(1.3, 3.4)) + 'px;--dx:' + n2(rnd(-46, 46)) +
        'px;--dy:' + n2(rnd(-92, -26)) + 'px;--op:' + n2(rnd(.12, .5)) +
        ';animation-duration:' + n2(rnd(11, 26)) + 's;animation-delay:-' + n2(rnd(0, 26)) + 's"></i>';
    }
    return '<div class="terminal-polvo">' + out + '</div>';
  }

  /* ======================================================================== *
   *  6 · TÍTULO DE APERTURA
   * ======================================================================== */
  function titulo(ctx) {
    const c = copete(ctx);
    return '<div class="terminal-titulo"><div class="terminal-titulo__int">' +
      '<div class="terminal-titulo__kicker"><i></i>' + esc(c.origen) + '</div>' +
      '<h1 class="terminal-titulo__nombre">Nacho<em>Vuela</em></h1>' +
      '<p class="terminal-titulo__bajada">tu radar de oportunidades</p>' +
      '<div class="terminal-titulo__regla"></div>' +
      '<div class="terminal-titulo__dato">' + esc(c.dato) + '</div>' +
      '</div></div>';
  }

  /* ======================================================================== *
   *  CÁMARA — lo único que toca el scroll
   * ======================================================================== */
  let $mundo = null, $tit = null, $nac = null, $gen = null,
      $ext = null, $vin = null, $cor = null, $piso = null, $U = null;

  function aplicar(p, U) {
    if (!$mundo || !U) return;

    /* título: está desde el frame 0 (entra con su propia animación) y se va con el scroll */
    const tOut = U.ease(U.tramo(p, .14, .42));
    if ($tit) {
      $tit.style.opacity = (1 - tOut).toFixed(3);
      $tit.style.transform = 'translate3d(0,' + (-tOut * 86).toFixed(2) +
        'px,0) scale(' + (1 - tOut * .07).toFixed(4) + ')';
    }

    /* cámara: deriva mínima al principio, avance decidido después de 0.5 */
    const deriva = U.easeOut(U.tramo(p, 0, .5));
    const av     = U.ease(U.tramo(p, .5, 1));
    $mundo.style.transform = 'translate3d(0,' + (-av * 11).toFixed(2) + 'vh,0) scale(' +
      (1 + deriva * .02 + av * .27).toFixed(4) + ')';

    /* Nacho: la cámara se le viene encima y él se disuelve en su punto de vista */
    if ($nac) {
      const na = U.ease(U.tramo(p, .48, .94));
      $nac.style.opacity = (1 - na).toFixed(3);
      $nac.style.transform = 'translate3d(' + (-na * 5).toFixed(2) + '%,' +
        (na * 20).toFixed(2) + '%,0) scale(' + (1 + na * .62).toFixed(4) + ')';
    }

    /* parallax: la gente pasa más rápido que la pista */
    if ($gen)  $gen.style.transform  = 'translate3d(0,' + (av * 6).toFixed(2) + 'vh,0) scale(' + (1 + av * .16).toFixed(4) + ')';
    if ($ext)  $ext.style.transform  = 'scale(' + (1 + av * .05).toFixed(4) + ')';
    if ($piso) $piso.style.transform = 'translate3d(0,' + (av * 4).toFixed(2) + 'vh,0)';

    /* la viñeta cierra y un pestañeo hace el corte al POV */
    if ($vin) $vin.style.opacity = (.82 + av * .18).toFixed(3);
    if ($cor) $cor.style.opacity = (Math.sin(U.clamp(U.tramo(p, .64, .96)) * Math.PI) * .72).toFixed(3);
  }

  /* ======================================================================== */
  NV.escena('terminal', {

    html(ctx) {
      return '<div class="terminal-mundo"><div class="terminal-respira">' +
        exterior(ctx) +
        ventanal() +
        interior() +
        hazes() +
        gente() +
        nacho() +
        polvo(20) +
        '</div>' +
        '<div class="terminal-vineta"></div>' +
        '<div class="terminal-corte"></div>' +
        titulo(ctx) +
        '</div>';
    },

    mount(el, ctx) {
      el.classList.add('terminal-esc');
      const q = s => el.querySelector(s);
      $mundo = q('.terminal-mundo');
      $tit   = q('.terminal-titulo');
      $nac   = q('.terminal-nacho');
      $gen   = q('.terminal-gente');
      $ext   = q('.terminal-exterior');
      $vin   = q('.terminal-vineta');
      $cor   = q('.terminal-corte');
      $piso  = q('.terminal-piso');
      $U     = ctx && ctx.U;
      if ($U && $U.calmo && $U.calmo()) el.classList.add('terminal-calmo');
      aplicar(0, $U);
    },

    update(p, ctx) { aplicar(p, ctx.U); },

    enter(ctx) { $U = ctx.U; },

    /* al salir de cuadro queda congelada en su estado final: es el fondo */
    exit(ctx) { aplicar(1, (ctx && ctx.U) || $U); },
  });
})();
