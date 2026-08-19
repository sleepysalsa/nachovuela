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

  /* Skyline lejano: edificios regordetes, esquinas redondas, ventanotas */
  function svgSkyline() {
    let edificios = '';
    let ventanas = '';
    let x = -12;
    while (x < 1612) {
      const w = rnd(48, 122), h = rnd(24, 86);
      const r = Math.min(16, w * .3);
      const top = 140 - h;
      edificios += '<rect x="' + n2(x) + '" y="' + n2(top) + '" width="' + n2(w) +
                   '" height="' + n2(h + 24) + '" rx="' + n2(r) + '"/>';
      /* ventanitas grandes y desparejas, algunas apagadas */
      const cols = Math.max(1, Math.round(w / 27));
      for (let c = 0; c < cols; c++) {
        const filas = 1 + Math.floor(rnd(1, Math.max(2, h / 24)));
        for (let f = 0; f < filas; f++) {
          if (Math.random() < .34) continue;
          ventanas += '<rect x="' + n2(x + 9 + c * (w - 16) / cols + rnd(-2.5, 2.5)) +
                      '" y="' + n2(top + 8 + f * 17 + rnd(-2.5, 2.5)) +
                      '" width="' + n2(rnd(4.5, 8.5)) + '" height="' + n2(rnd(5, 9.5)) +
                      '" rx="2" opacity="' + n2(rnd(.25, .9)) + '"/>';
        }
      }
      x += w - rnd(6, 16);
    }
    return '<svg viewBox="0 0 1600 140" preserveAspectRatio="none" aria-hidden="true">' +
      '<g class="terminal-sky__masa">' + edificios + '</g>' +
      '<g class="terminal-sky__ventanas">' + ventanas + '</g>' +
      /* torre de control regordeta, con cabina inflada y faro grandote */
      '<g class="terminal-sky__torre">' +
        '<path d="M1252,146 C1255,102 1260,74 1266,58 L1290,58 C1296,74 1301,102 1304,146 Z"/>' +
        '<rect class="terminal-sky__torre-vent" x="1272" y="78" width="7" height="9" rx="2"/>' +
        '<rect class="terminal-sky__torre-vent" x="1279" y="104" width="7" height="9" rx="2"/>' +
        '<path d="M1246,62 C1246,40 1260,28 1278,28 C1296,28 1310,40 1310,62 C1300,69 1256,69 1246,62 Z"/>' +
        '<path class="terminal-sky__torre-luz" d="M1257,52 C1259,42 1268,36 1278,36 C1288,36 1297,42 1299,52 C1289,57 1267,57 1257,52 Z"/>' +
        '<path d="M1275,28 L1275,12 L1281,12 L1281,28 Z"/>' +
      '</g>' +
      '<circle class="terminal-sky__faro" cx="1278" cy="10" r="7"/>' +
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

  /* Avioncito de juguete: nariz redonda, panza gorda, ventanillas encendidas */
  function svgAvion() {
    return '<svg viewBox="0 0 160 64" aria-hidden="true">' +
      '<path class="terminal-av-metal" d="M30,34 C22,32 16,26 14,18 C13,11 17,6 24,6 C32,6 38,14 41,25 Z"/>' +
      '<path class="terminal-av-cuerpo" d="M18,34 C34,26 62,22 92,22 C118,22 138,26 148,33 C152,36 152,42 147,45 C136,51 114,54 88,54 C58,54 32,50 18,44 C14,42 14,36 18,34 Z"/>' +
      '<path class="terminal-av-panza" d="M20,43 C36,48 60,51 88,51 C114,51 134,48 145,43 C136,50 114,54 88,54 C58,54 32,50 18,44 Z"/>' +
      '<path class="terminal-av-metal" d="M62,38 C56,48 52,56 54,60 C56,63 62,63 68,58 C76,52 84,44 88,38 Z"/>' +
      '<path class="terminal-av-vidrio" d="M124,27 C132,27 140,29 144,32 C140,36 132,38 124,37 C121,34 121,30 124,27 Z"/>' +
      '<circle class="terminal-av-ventana" cx="52" cy="35" r="4.6"/>' +
      '<circle class="terminal-av-ventana" cx="72" cy="34" r="4.6"/>' +
      '<circle class="terminal-av-ventana" cx="92" cy="33" r="4.6"/>' +
      '<circle class="terminal-av-ventana" cx="111" cy="33" r="4.6"/>' +
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

  /* Carro de equipaje: tractorcito regordete + valijitas apiladas */
  function carro() {
    return '<div class="terminal-carro">' +
      '<div class="terminal-carro__tren">' +
        '<svg viewBox="0 0 230 66" aria-hidden="true">' +
          '<path class="terminal-cr-cabina" d="M8,46 C4,46 2,42 2,36 L2,22 C2,13 8,9 17,9 L30,9 C36,9 41,13 43,19 L48,33 C50,40 48,46 42,46 Z"/>' +
          '<rect class="terminal-cr-vidrio" x="8" y="15" width="18" height="14" rx="6"/>' +
          '<g class="terminal-cr-valijas">' +
            '<rect x="66" y="12" width="20" height="15" rx="5"/>' +
            '<rect x="90" y="8" width="16" height="19" rx="5"/>' +
            '<rect x="130" y="10" width="22" height="17" rx="6"/>' +
            '<rect x="190" y="12" width="18" height="15" rx="5"/>' +
          '</g>' +
          '<g class="terminal-cr-carrito">' +
            '<rect x="58" y="24" width="54" height="24" rx="10"/>' +
            '<rect x="120" y="24" width="54" height="24" rx="10"/>' +
            '<rect x="182" y="24" width="44" height="24" rx="10"/>' +
          '</g>' +
          '<g class="terminal-cr-rueda">' +
            '<circle cx="14" cy="53" r="9"/><circle cx="38" cy="53" r="9"/>' +
            '<circle cx="74" cy="53" r="7"/><circle cx="100" cy="53" r="7"/>' +
            '<circle cx="136" cy="53" r="7"/><circle cx="162" cy="53" r="7"/>' +
            '<circle cx="196" cy="53" r="7"/><circle cx="218" cy="53" r="7"/>' +
          '</g>' +
          '<g class="terminal-cr-llanta">' +
            '<circle cx="14" cy="53" r="3.5"/><circle cx="38" cy="53" r="3.5"/>' +
            '<circle cx="74" cy="53" r="2.6"/><circle cx="100" cy="53" r="2.6"/>' +
            '<circle cx="136" cy="53" r="2.6"/><circle cx="162" cy="53" r="2.6"/>' +
            '<circle cx="196" cy="53" r="2.6"/><circle cx="218" cy="53" r="2.6"/>' +
          '</g>' +
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
      '<path class="terminal-p-pierna terminal-p-pierna--a" d="M44,188 C38,216 34,248 32,272 C31,283 36,289 46,289 C56,289 60,283 60,274 C60,248 62,216 64,192 Z"/>' +
      '<path class="terminal-p-pierna terminal-p-pierna--b" d="M66,192 C70,216 74,248 76,272 C77,283 82,289 92,289 C101,289 105,282 103,272 C97,246 90,214 86,190 Z"/>' +
      '<circle class="terminal-p-cabeza" cx="64" cy="44" r="27"/>' +
      '<path class="terminal-p-torso" d="M64,74 C42,76 30,96 28,128 C26,158 32,184 40,200 C48,208 82,208 90,198 C98,182 102,156 100,126 C98,96 86,76 64,74 Z"/>' +
      '<path class="terminal-p-brazo" d="M42,102 C32,118 27,140 27,164 C27,172 31,177 38,177 C44,177 47,172 47,166 C48,144 52,124 58,108 Z"/>' +
      (valija
        ? '<g class="terminal-p-valija">' +
            '<rect x="0" y="196" width="34" height="52" rx="11"/>' +
            '<path class="terminal-p-asa" d="M24,198 L30,152 L40,148"/>' +
            '<circle cx="9" cy="252" r="6"/><circle cx="26" cy="252" r="6"/>' +
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
    /* miembro "inflado": contorno grueso + relleno plano (doble trazo) */
    const limb = (d, w, cls) =>
      '<path class="terminal-nk-borde" style="stroke-width:' + (w + 6) + '" d="' + d + '"/>' +
      '<path class="' + cls + '" style="stroke-width:' + w + '" d="' + d + '"/>';

    return '<div class="terminal-nacho"><div class="terminal-nacho__aura"></div>' +
      '<svg class="terminal-nacho__svg" viewBox="0 0 400 520" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +

      /* butaca inflada de sala de espera */
      '<g class="terminal-butaca">' +
        '<path class="terminal-butaca__pata" d="M150,396 L146,502"/>' +
        '<path class="terminal-butaca__pata" d="M272,396 L276,502"/>' +
        '<path class="terminal-butaca__pata terminal-butaca__pata--fina" d="M148,470 L274,466"/>' +
        '<rect class="terminal-butaca__almohadon" x="104" y="232" width="58" height="150" rx="26"/>' +
        '<rect class="terminal-butaca__almohadon" x="108" y="356" width="196" height="42" rx="19"/>' +
        '<path class="terminal-butaca__brillo" d="M116,252 C114,296 114,330 118,360"/>' +
      '</g>' +

      /* pierna lejana */
      '<g class="terminal-nacho__lejos">' +
        limb('M192,354 L268,351', 42, 'terminal-nl-pant2') +
        limb('M270,354 L280,440', 28, 'terminal-nl-pant2') +
        '<path class="terminal-nk-zapa2" d="M266,442 C260,460 262,474 270,480 C284,487 310,487 326,481 C336,477 338,467 330,461 C318,451 298,444 284,442 Z"/>' +
        '<path class="terminal-nk-zapa2-suela" d="M270,478 L328,476"/>' +
      '</g>' +

      /* la mochila, apoyada contra la butaca */
      '<g class="terminal-mochila" transform="rotate(-7 80 462)">' +
        '<rect class="terminal-mochila__cuerpo" x="42" y="410" width="76" height="96" rx="26"/>' +
        '<path class="terminal-mochila__tapa" d="M46,446 C60,436 100,436 114,446 L114,432 C114,418 102,410 80,410 C58,410 46,418 46,432 Z"/>' +
        '<rect class="terminal-mochila__bolsillo" x="54" y="452" width="52" height="44" rx="15"/>' +
        '<path class="terminal-mochila__cierre" d="M60,446 C74,440 88,440 100,446"/>' +
        '<circle class="terminal-mochila__tirador" cx="100" cy="447" r="3.4"/>' +
        '<path class="terminal-mochila__correa" d="M50,428 C40,444 38,470 44,494"/>' +
      '</g>' +

      /* torso + cabezota: el grupo respira */
      '<g class="terminal-vivo">' +
        '<path class="terminal-nk-piel--sombra" d="M206,232 L242,236 L248,268 L204,266 Z"/>' +
        '<path class="terminal-nk-camisa" d="M214,250 C190,256 172,276 164,306 C157,338 160,368 172,382 L256,386 C266,362 266,336 258,314 C272,300 276,282 266,268 C258,256 238,248 214,250 Z"/>' +
        '<path class="terminal-nk-camisa--sombra" d="M214,250 C190,256 172,276 164,306 C157,338 160,368 172,382 L206,384 C192,356 190,300 202,252 Z"/>' +
        '<path class="terminal-nk-cuello terminal-nk-cuello--atras" d="M214,250 C206,254 202,262 203,272 L216,266 C213,260 213,254 214,250 Z"/>' +
        '<path class="terminal-nk-cuello" d="M238,254 L262,274 L240,290 C229,279 230,262 238,254 Z"/>' +
        '<path class="terminal-nk-linea" d="M248,288 C258,310 262,336 258,362"/>' +
        '<circle class="terminal-nk-boton" cx="253" cy="302" r="3.4"/>' +
        '<circle class="terminal-nk-boton" cx="258" cy="324" r="3.4"/>' +
        '<circle class="terminal-nk-boton" cx="259" cy="346" r="3.4"/>' +
        '<path class="terminal-nk-cadena" d="M220,272 C230,291 248,293 258,276"/>' +
        '<path class="terminal-cadena-brillo" d="M239,283 L241.5,289 L247,291.5 L241.5,294 L239,300 L236.5,294 L231,291.5 L236.5,289 Z"/>' +

        '<g class="terminal-cabeza">' +
          '<path class="terminal-nk-piel" d="M172,238 C152,214 148,162 174,124 C198,94 252,90 280,112 C298,126 304,150 300,168 L298,174 C310,176 320,186 318,197 C316,206 306,210 298,208 L296,214 C302,224 304,236 297,244 C286,258 258,262 238,258 C214,254 196,248 186,244 C178,242 174,240 172,238 Z"/>' +
          '<path class="terminal-nk-pelo" d="M166,176 C150,190 146,212 156,234 C161,243 172,244 176,235 C169,229 169,220 174,213 C165,209 165,198 172,191 Z"/>' +
          '<path class="terminal-nk-piel" d="M200,178 C185,174 177,190 185,206 C191,216 203,214 204,202 C204,193 202,184 200,178 Z"/>' +
          '<path class="terminal-nk-linea terminal-nk-linea--fina" d="M192,190 C188,196 190,202 194,206"/>' +
          '<path class="terminal-nk-barba" d="M184,196 C182,204 184,212 190,218 L198,212 C193,206 192,200 192,194 Z"/>' +
          '<ellipse class="terminal-nk-rubor" cx="246" cy="204" rx="13" ry="8"/>' +
          '<path class="terminal-nk-barba" d="M190,212 C188,228 192,244 202,252 C218,262 248,264 272,258 C292,251 302,238 302,224 C302,212 298,204 292,204 C286,205 281,207 277,210 C283,216 283,222 277,226 C268,232 258,232 250,228 C238,222 216,214 202,210 C197,209 192,210 190,212 Z"/>' +
          '<path class="terminal-nk-barba--sombra" d="M206,242 C224,256 252,258 272,252 C288,247 298,236 300,226 C298,242 288,250 272,256 C252,262 222,258 206,242 Z"/>' +
          '<path class="terminal-nk-linea" d="M258,224 C268,227 278,224 284,213"/>' +
          '<path class="terminal-nk-labio" d="M263,228 C269,232 277,231 281,226 C277,233 267,234 263,228 Z"/>' +
          '<g class="terminal-ojo">' +
            '<ellipse class="terminal-nk-blanco" cx="266" cy="180" rx="13" ry="14.5"/>' +
            '<circle class="terminal-nk-iris" cx="270.5" cy="177" r="7.6"/>' +
            '<circle class="terminal-nk-pupila" cx="272" cy="176.5" r="3.5"/>' +
            '<circle class="terminal-nk-chispa" cx="274" cy="173" r="2.2"/>' +
            '<circle class="terminal-nk-chispa" cx="268" cy="181" r="1.1"/>' +
            '<path class="terminal-nk-linea" d="M253,169 C260,162 275,163 280,171"/>' +
          '</g>' +
          '<path class="terminal-nk-ceja" d="M246,156 C254,147 270,145 281,151 C285,154 285,159 280,159 C269,155 256,157 250,162 C245,162 243,159 246,156 Z"/>' +
          '<path class="terminal-nk-pelo" d="M236,120 C246,100 268,96 285,106 C297,113 301,129 295,143 C291,134 284,136 282,146 C276,134 267,138 265,150 C258,138 250,142 248,154 C238,146 233,131 236,120 Z"/>' +
          '<path class="terminal-nk-pelo--luz" d="M250,110 C261,102 275,102 284,109"/>' +
          '<path class="terminal-nk-gorra" d="M156,180 C142,146 156,102 198,88 C242,76 286,92 298,116 L299,124 C250,116 198,136 156,180 Z"/>' +
          '<path class="terminal-nk-gorra--sombra" d="M299,124 C250,116 198,136 156,180 C162,166 172,152 188,142 C228,120 268,116 299,124 Z"/>' +
          '<path class="terminal-nk-linea terminal-nk-linea--fina" d="M232,88 C224,104 220,118 221,130"/>' +
          '<path class="terminal-nk-linea terminal-nk-linea--fina" d="M268,96 C266,110 266,118 268,127"/>' +
          '<circle class="terminal-nk-gorra--boton" cx="226" cy="84" r="6"/>' +
          '<path class="terminal-nk-visera" d="M287,112 C326,107 358,118 367,136 C371,148 361,157 345,155 C317,150 297,139 289,129 C285,123 285,115 287,112 Z"/>' +
          '<path class="terminal-nk-visera--bajo" d="M293,132 C303,140 322,148 344,152 C354,152 361,146 363,139 C351,147 327,145 308,138 Z"/>' +
          '<text class="terminal-marca" x="161" y="146" transform="rotate(-12 218 136)">Nacho<tspan class="terminal-marca-v">Vuela</tspan></text>' +
          '<g class="terminal-rim terminal-rim--frio"><path d="M198,90 C240,78 284,94 297,116"/><path d="M156,180 C146,152 150,122 170,105"/></g>' +
          '<g class="terminal-rim"><path d="M300,150 L298,174 C308,178 316,190 313,200"/><path d="M302,222 C302,238 292,251 274,258"/><path d="M291,115 C327,110 357,121 366,137"/></g>' +
        '</g>' +

        '<g class="terminal-rim"><path d="M266,272 C275,288 271,304 260,314"/></g>' +
        '<g class="terminal-rim terminal-rim--frio"><path d="M172,282 C163,306 158,340 162,368"/></g>' +
      '</g>' +

      /* pierna cercana + pie que marca el ritmo */
      limb('M182,366 L296,368', 46, 'terminal-nl-pant') +
      limb('M300,372 L306,452', 30, 'terminal-nl-pant') +
      '<g class="terminal-pie">' +
        '<path class="terminal-nk-zapa" d="M292,450 C287,466 287,479 292,487 C306,492 330,492 346,488 C360,484 366,476 362,469 C353,456 335,449 318,449 C308,448 298,448 292,450 Z"/>' +
        '<path class="terminal-nk-suela" d="M287,486 C283,498 291,505 305,505 L362,503 C375,501 377,491 367,485 C344,492 310,493 287,486 Z"/>' +
        '<path class="terminal-nk-zapa-detalle" d="M304,458 L316,466 M316,454 L328,462"/>' +
        '<path class="terminal-nk-zapa-acento" d="M336,486 C348,484 356,478 358,471 C362,478 358,485 348,488 Z"/>' +
      '</g>' +
      '<g class="terminal-rim"><path d="M310,378 L315,448"/></g>' +

      /* brazo apoyado en el muslo (respira junto al torso) */
      '<g class="terminal-vivo">' +
        limb('M238,276 C252,300 262,318 266,334', 34, 'terminal-nl-shirt') +
        limb('M263,331 L269,343', 40, 'terminal-nl-cuff') +
        limb('M268,342 C282,354 296,362 304,366', 26, 'terminal-nl-skin') +
        '<path class="terminal-nk-piel" d="M300,356 C314,352 328,360 328,371 C328,382 316,389 304,385 C295,381 294,361 300,356 Z"/>' +
        '<path class="terminal-nk-linea terminal-nk-linea--fina" d="M314,360 C317,366 317,374 314,380"/>' +
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
