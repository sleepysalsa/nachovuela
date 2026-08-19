/* ═══════════════════════════════════════════════════════════════════════════
   NachoVuela · mundo/terminal3d.js — la terminal en Three.js.

   La cámara está sentada (y=1.22m) en una butaca frente a un ventanal enorme.
   Estilo: realista estilizado, nocturno. Luces cálidas adentro, plataforma fría
   afuera, reflejos en el vidrio, un avión estacionado en la puerta, gente que
   camina, aviones que ruedan/despegan/cruzan el cielo.

   Estaciones (posiciones en el mundo → la cámara las mira con yaw/pitch):
     mac        abajo, en el regazo            yaw 0    pitch -40
     partidas   arriba a la izquierda          yaw -27  pitch  20
     llegadas   arriba a la derecha            yaw  29  pitch  19
     mostrador  a la izquierda, kiosco/revista yaw -54  pitch   1
   Los paneles DOM de cada estación se proyectan encima del 3D con
   NV.mundo.proyectar(nombre) → {x,y,escala,visible}.

   PERFORMANCE (objetivo ≥45fps incluso en swiftshader 1440x900):
     · 3 PointLights en total (2 techo + mostrador) + Hemisphere + Directional
     · MeshLambert para casi todo; MeshStandard solo en piso y vidrio
     · el vidrio NO usa transmission (eso solo costaba ~5x el frame)
     · geometría repetida FUSIONADA en un solo mesh (butacas, ciudad, ventanas,
       ventanillas del avión, luminarias, parteluces); luces de pista = Points
     · nada de post-proceso; sombras opcionales (SOMBRAS=false por defecto)
   ═══════════════════════════════════════════════════════════════════════════ */
import * as THREE from '../vendor/three.module.min.js';

const NV = (window.NV = window.NV || {});
const C = NV.camara;
const D2R = Math.PI / 180;
const SOMBRAS = false;                     // sombra direccional (cuesta ~15fps en software)

/* ── Escena / cámara / render ────────────────────────────────────────────── */
const lienzo = document.getElementById('mundo3d');
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
if (SOMBRAS) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a14);
scene.fog = new THREE.FogExp2(0x070a14, 0.0036);   // niebla suave: la ciudad se ve, lejana

const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 700);
const CABEZA = new THREE.Vector3(0, 1.22, 0);   // sentado en la butaca
camera.position.copy(CABEZA);

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const _tmpColor = new THREE.Color();

/* Fusiona varias geometrías (ya transformadas) en una sola no indexada.
   partes: [{ geo, color? }] — si alguna trae color, se genera atributo color. */
function fusionar(partes) {
  const pos = [], nor = [], uv = [], col = [];
  const conColor = partes.some(p => p.color != null);
  let conUV = true;
  for (const p of partes) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    if (!U) conUV = false;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N ? N.getX(i) : 0, N ? N.getY(i) : 1, N ? N.getZ(i) : 0);
      if (U) uv.push(U.getX(i), U.getY(i));
      if (conColor) { const c = p.color != null ? _tmpColor.set(p.color) : _tmpColor.set(0xffffff); const k = p.k || 1; col.push(c.r * k, c.g * k, c.b * k); }
    }
    if (g !== p.geo) g.dispose();
    p.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (conUV) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (conColor) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
/* Geometría transformada rápida: geo(pos, rot?, scale?) */
function G(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) geo.rotateX(rx), geo.rotateY(ry), geo.rotateZ(rz);
  geo.translate(x, y, z); return geo;
}
/* Textura de canvas: draw(ctx, w, h). Se re-dibuja cuando cargan las fuentes. */
function texturaCanvas(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  tex.__redibujar = () => { draw(ctx, w, h); tex.needsUpdate = true; };
  tex.__redibujar();
  document.fonts?.ready?.then(() => tex.__redibujar());
  return tex;
}
/* Material "que emite luz" barato: Basic con color HDR (ACES lo comprime lindo). */
const luz = (hex, k = 1, extra = {}) => new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(hex).multiplyScalar(k) }, extra));

/* ── Materiales base ─────────────────────────────────────────────────────── */
const M = {
  piso: new THREE.MeshStandardMaterial({ color: 0x2c3040, roughness: 0.32, metalness: 0.18 }),
  techo: new THREE.MeshLambertMaterial({ color: 0x1e2230 }),
  manga: new THREE.MeshLambertMaterial({ color: 0x3a4458 }),
  metal: new THREE.MeshLambertMaterial({ color: 0x3a4256 }),
  vidrio: new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.09, depthWrite: false }),   // el brillo lo dan los reflejos espejados
  parteluz: new THREE.MeshLambertMaterial({ color: 0x1c2436 }),
  butaca: new THREE.MeshLambertMaterial({ color: 0x24304a }),
  pista: new THREE.MeshLambertMaterial({ color: 0x0b0f1a }),
  plataforma: new THREE.MeshLambertMaterial({ color: 0x11161f }),
  ciudad: new THREE.MeshLambertMaterial({ color: 0x0c1220 }),
  panelOscuro: new THREE.MeshLambertMaterial({ color: 0x0b0e18 }),
  ambar: luz(0xf5a623, 1.7),
  verde: luz(0x34e0a1, 1.5),
  rojo: luz(0xff5a6e, 1.5),
  blanco: luz(0xfff2d8, 1.35),
  fuselaje: new THREE.MeshLambertMaterial({ color: 0xdfe6f2 }),
  vehiculo: new THREE.MeshLambertMaterial({ color: 0x1c2230 }),
  jean: new THREE.MeshLambertMaterial({ color: 0x1b2540 }),
  piel: new THREE.MeshLambertMaterial({ color: 0x252b3d }),
  piel2: new THREE.MeshLambertMaterial({ color: 0x2e2a30 }),
  planta: new THREE.MeshLambertMaterial({ color: 0x1d4a34 }),
  maceta: new THREE.MeshLambertMaterial({ color: 0x2a2f3a }),
  tacho: new THREE.MeshLambertMaterial({ color: 0x2b3242 }),
  vertices: new THREE.MeshBasicMaterial({ vertexColors: true }),
  reflejo: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6c0).multiplyScalar(1.1), transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
};

/* ── Luces (pocas y bien puestas) ────────────────────────────────────────── */
{
  scene.add(new THREE.HemisphereLight(0xffe0b8, 0x1c2030, 1.2));
  const dir = new THREE.DirectionalLight(0xffd9a8, 1.2);
  dir.position.set(3, 9, 4); dir.target.position.set(0, 0, -6); scene.add(dir, dir.target);
  if (SOMBRAS) { dir.castShadow = true; dir.shadow.mapSize.set(1024, 1024); dir.shadow.camera.left = -14; dir.shadow.camera.right = 14; dir.shadow.camera.top = 12; dir.shadow.camera.bottom = -12; dir.shadow.camera.far = 40; }
  const lA = new THREE.PointLight(0xffe2b0, 40, 22, 2); lA.position.set(-4.5, 3.75, -3.5); scene.add(lA);
  const lB = new THREE.PointLight(0xffe2b0, 40, 22, 2); lB.position.set(4.5, 3.75, -3.5); scene.add(lB);
}

/* ── La sala: piso, techo, ventanal, butacas ──────────────────────────────── */
const sala = new THREE.Group(); scene.add(sala);
const VZ = -9;                                          // plano del ventanal
const luminarias = [];                                  // [x,z] para reflejos
{
  // piso y techo terminan en el ventanal (así el cielo y la plataforma se ven de verdad)
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(60, 23), M.piso);
  piso.rotation.x = -Math.PI / 2; piso.position.set(0, 0, 2.5); piso.receiveShadow = SOMBRAS; sala.add(piso);
  const techo = new THREE.Mesh(new THREE.PlaneGeometry(60, 23), M.techo);
  techo.rotation.x = Math.PI / 2; techo.position.set(0, 5.2, 2.5); sala.add(techo);
  // alero exterior fino sobre el ventanal (para que la fachada tenga espesor)
  const alero = new THREE.Mesh(new THREE.BoxGeometry(44, 0.35, 1.6), M.parteluz); alero.position.set(0, 5.35, VZ - 0.7); sala.add(alero);
  // Guías de luz en el techo (tiras tenues) para que no sea un plano muerto
  const guias = [];
  for (let z = -1; z >= -8; z -= 2.4) guias.push({ geo: G(new THREE.BoxGeometry(60, 0.03, 0.06), 0, 5.17, z) });
  sala.add(new THREE.Mesh(fusionar(guias), new THREE.MeshLambertMaterial({ color: 0x232b40 })));

  // Ventanal: un plano de vidrio enorme al frente, con parteluces
  const vidrio = new THREE.Mesh(new THREE.PlaneGeometry(40, 5.2), M.vidrio);
  vidrio.position.set(0, 2.6, VZ); vidrio.renderOrder = 2; sala.add(vidrio);
  const partes = [];
  for (let x = -20; x <= 20; x += 4) partes.push({ geo: G(new THREE.BoxGeometry(0.16, 5.2, 0.22), x, 2.6, VZ + 0.05) });
  partes.push({ geo: G(new THREE.BoxGeometry(40, 0.14, 0.22), 0, 2.9, VZ + 0.05) });
  partes.push({ geo: G(new THREE.BoxGeometry(40, 0.12, 0.26), 0, 5.14, VZ + 0.05) });
  sala.add(new THREE.Mesh(fusionar(partes), M.parteluz));
  const zocalo = new THREE.Mesh(new THREE.BoxGeometry(40, 0.7, 0.4), M.metal);
  zocalo.position.set(0, 0.35, VZ + 0.1); sala.add(zocalo);
  // Paredes laterales lejanas (para que la sala tenga fin) y pared de atrás
  const pared = new THREE.MeshLambertMaterial({ color: 0x0f1424 });
  for (const x of [-20, 20]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(23, 5.2), pared); p.position.set(x, 2.6, 2.5); p.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; sala.add(p); }
  { const p = new THREE.Mesh(new THREE.PlaneGeometry(60, 5.2), pared); p.position.set(0, 2.6, 14); p.rotation.y = Math.PI; sala.add(p); }

  // Luminarias del techo (cálidas, en fila) — emisivas, fusionadas (la luz real la dan 2 PointLights)
  const lums = [];
  for (let x = -12; x <= 12; x += 6) for (const z of [-2, -6]) { lums.push({ geo: G(new THREE.BoxGeometry(2.4, 0.06, 0.5), x, 5.1, z) }); luminarias.push([x, z]); }
  sala.add(new THREE.Mesh(fusionar(lums), M.blanco));
  const texPozo = texturaCanvas(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,205,140,.42)'); g.addColorStop(0.4, 'rgba(255,205,140,.14)'); g.addColorStop(1, 'rgba(255,205,140,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const pozos = [];
  for (const [x, z] of luminarias) pozos.push({ geo: G(new THREE.PlaneGeometry(5.6, 3.6), x, 5.185, z, Math.PI / 2) });
  sala.add(new THREE.Mesh(fusionar(pozos), new THREE.MeshBasicMaterial({ map: texPozo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  // Reflejos de las luminarias en el vidrio: sus imágenes espejadas, aditivas y tenues
  const refl = [];
  for (const [x, z] of luminarias) refl.push({ geo: G(new THREE.PlaneGeometry(2.4, 0.5), x, 5.05, 2 * VZ - z, Math.PI / 2) });
  const reflM = new THREE.Mesh(fusionar(refl), M.reflejo); reflM.renderOrder = 1; sala.add(reflM);

  // Butacas: una fila a nuestra izquierda y derecha, y la de atrás — todo fusionado
  const tela = [], patas = [];
  const butaca = (x, z) => {
    tela.push({ geo: G(new THREE.BoxGeometry(0.62, 0.12, 0.6), x, 0.48, z) });
    tela.push({ geo: G(new THREE.BoxGeometry(0.62, 0.62, 0.1), x, 0.85, z + 0.26) });
    patas.push({ geo: G(new THREE.BoxGeometry(0.62, 0.42, 0.06), x, 0.21, z) });
    patas.push({ geo: G(new THREE.BoxGeometry(0.05, 0.08, 0.5), x - 0.34, 0.6, z) });
    patas.push({ geo: G(new THREE.BoxGeometry(0.05, 0.08, 0.5), x + 0.34, 0.6, z) });
  };
  for (const x of [-2.1, -1.4, -0.7, 0.7, 1.4, 2.1]) butaca(x, 0);
  for (const x of [-2.1, -1.4, -0.7, 0, 0.7, 1.4, 2.1]) butaca(x, 3.2);
  for (const x of [-7.5, -6.8, -6.1, 6.1, 6.8, 7.5]) butaca(x, -2.4);          // filas laterales
  // apoyabrazos de NUESTRA butaca (primera persona)
  patas.push({ geo: G(new THREE.BoxGeometry(0.06, 0.08, 0.5), -0.36, 0.62, 0) });
  patas.push({ geo: G(new THREE.BoxGeometry(0.06, 0.08, 0.5), 0.36, 0.62, 0) });
  tela.push({ geo: G(new THREE.BoxGeometry(0.62, 0.12, 0.6), 0, 0.42, 0) });
  sala.add(new THREE.Mesh(fusionar(tela), M.butaca));
  sala.add(new THREE.Mesh(fusionar(patas), M.metal));

  // Columnas (fusionadas) + pantallitas de información en cada una
  const cols = [], marcosPant = [], pantallas = [];
  const COLS = [[-9, -4], [9, -4], [-9, 2], [9, 2]];
  for (const [x, z] of COLS) {
    cols.push({ geo: G(new THREE.CylinderGeometry(0.28, 0.28, 5.2, 14), x, 2.6, z) });
    cols.push({ geo: G(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 14), x, 0.06, z) });
    // pantalla mirando a la butaca
    const dx = -x, dz = -z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ry = Math.atan2(ux, uz);
    marcosPant.push({ geo: G(new THREE.BoxGeometry(0.78, 0.5, 0.05), x + ux * 0.30, 2.35, z + uz * 0.30, 0, ry) });
    pantallas.push({ geo: G(new THREE.PlaneGeometry(0.7, 0.42), x + ux * 0.33, 2.35, z + uz * 0.33, 0, ry) });
  }
  sala.add(new THREE.Mesh(fusionar(cols), M.parteluz));
  sala.add(new THREE.Mesh(fusionar(marcosPant), M.panelOscuro));
  NV.__texPantallas = texturaCanvas(512, 320, dibujarPantalla);
  sala.add(new THREE.Mesh(fusionar(pantallas), new THREE.MeshBasicMaterial({ map: NV.__texPantallas })));

  // Cartel "PUERTA 14" colgado sobre el ventanal
  const texPuerta = texturaCanvas(1024, 256, dibujarPuerta);
  const cajaP = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.95, 0.12), M.panelOscuro); cajaP.position.set(0, 4.55, VZ + 0.5); sala.add(cajaP);
  const caraP = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.86), new THREE.MeshBasicMaterial({ map: texPuerta })); caraP.position.set(0, 4.55, VZ + 0.565); sala.add(caraP);
  const varillas = [];
  for (const x of [-1.4, 1.4]) varillas.push({ geo: G(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), x, 5.1, VZ + 0.5) });
  // varillas de los carteles de partidas/llegadas (cuelgan del techo)
  for (const [x, y, z, ry] of [[-3.4, 3.9, -6.6, 0.30], [3.6, 3.8, -6.4, -0.36]]) for (const s of [-1.5, 1.5]) {
    const h = 5.2 - (y + 1.0); varillas.push({ geo: G(new THREE.CylinderGeometry(0.015, 0.015, h, 6), x + Math.cos(ry) * s, y + 1.0 + h / 2, z - Math.sin(ry) * s) });
  }
  sala.add(new THREE.Mesh(fusionar(varillas), M.metal));

  // Paredes laterales: máquinas expendedoras con frente iluminado y carteles (para que mirar a los costados tenga algo)
  const maquinas = [], frentes = [];
  const texSalida = texturaCanvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0a0d18'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#34e0a1'; ctx.font = '700 64px "Hanken Grotesk", system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('→ SALIDA · EXIT', 24, h / 2);
  });
  const texCafe = texturaCanvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0a0d18'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5a623'; ctx.font = '900 70px Fraunces, Georgia, serif'; ctx.textBaseline = 'middle';
    ctx.fillText('Café', 24, h / 2); ctx.fillStyle = '#e8e4d8'; ctx.font = '500 34px "JetBrains Mono", ui-monospace, monospace'; ctx.fillText('· ABIERTO 24 H', 200, h / 2);
  });
  for (const s of [-1, 1]) {
    const x = s * 19.55, ry = s < 0 ? Math.PI / 2 : -Math.PI / 2;      // pegadas a la pared, mirando al centro
    for (const z of [-4.5, -3.2, 4.0]) {
      maquinas.push({ geo: G(new THREE.BoxGeometry(0.9, 1.9, 1.0), x, 0.95, z, 0, ry) });
      frentes.push({ geo: G(new THREE.PlaneGeometry(0.72, 1.3), x - s * 0.505, 1.1, z, 0, ry), color: z > 0 ? 0xf5a623 : 0x6ea8ff, k: z > 0 ? 0.9 : 0.8 });
    }
  }
  sala.add(new THREE.Mesh(fusionar(maquinas), M.panelOscuro));
  sala.add(new THREE.Mesh(fusionar(frentes), M.vertices));
  const cartelSalida = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: texSalida })); cartelSalida.position.set(-19.9, 3.6, 0.5); cartelSalida.rotation.y = Math.PI / 2; sala.add(cartelSalida);
  const cartelCafe = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: texCafe })); cartelCafe.position.set(19.9, 3.6, 0.5); cartelCafe.rotation.y = -Math.PI / 2; sala.add(cartelCafe);

  // Tachos y plantas
  const tachos = [], plantas = [], macetas = [];
  for (const [x, z] of [[-6.2, -8.2], [6.4, -8.2], [10.6, 1.4]]) {
    tachos.push({ geo: G(new THREE.CylinderGeometry(0.24, 0.2, 0.75, 12), x, 0.375, z) });
    tachos.push({ geo: G(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 12), x, 0.77, z) });
  }
  sala.add(new THREE.Mesh(fusionar(tachos), M.tacho));
  for (const [x, z] of [[-10.4, -7.8], [10.4, -7.8], [-10.2, 1.2]]) {
    macetas.push({ geo: G(new THREE.CylinderGeometry(0.42, 0.34, 0.6, 12), x, 0.3, z) });
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, r = 0.22 + (i % 2) * 0.12;
      plantas.push({ geo: G(new THREE.ConeGeometry(0.16, 0.9 + (i % 3) * 0.25, 5), x + Math.cos(a) * r, 0.95 + (i % 3) * 0.12, z + Math.sin(a) * r, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35) });
    }
    plantas.push({ geo: G(new THREE.SphereGeometry(0.34, 8, 6), x, 1.05, z) });
  }
  sala.add(new THREE.Mesh(fusionar(macetas), M.maceta));
  sala.add(new THREE.Mesh(fusionar(plantas), M.planta));
}

/* Pantalla de información: destinos reales del radar (si hay), si no un placeholder */
function dibujarPantalla(ctx, w, h) {
  ctx.fillStyle = '#070a14'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f5a623'; ctx.font = '700 26px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('PARTIDAS', 22, 40); ctx.fillStyle = '#7f8aa8'; ctx.font = '500 20px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('SALIDAS · millas', 180, 40);
  ctx.fillStyle = 'rgba(245,166,35,.35)'; ctx.fillRect(22, 52, w - 44, 2);
  const res = (NV.state?.latest?.resultados || []).slice();
  res.sort((a, b) => (a.mejor_precio_millas || 9e9) - (b.mejor_precio_millas || 9e9));
  const off = NV.__pantOffset || 0, filas = [];
  for (let i = 0; i < 7; i++) { const r = res[(off + i) % Math.max(1, res.length)]; if (r) filas.push(r); }
  if (!filas.length) filas.push({ destino_nombre: 'Miami', aeropuerto: 'MIA', mejor_precio_millas: 45000, nivel: 'oportunidad' }, { destino_nombre: 'Madrid', aeropuerto: 'MAD', mejor_precio_millas: 89000, nivel: 'bueno' }, { destino_nombre: 'Río', aeropuerto: 'GIG', mejor_precio_millas: 21000, nivel: 'normal' });
  ctx.font = '600 24px "JetBrains Mono", ui-monospace, monospace';
  filas.forEach((r, i) => {
    const y = 90 + i * 34;
    ctx.fillStyle = r.nivel === 'oportunidad' ? '#34e0a1' : r.nivel === 'bueno' ? '#f5a623' : '#e8e4d8';
    ctx.fillText(String(r.destino_nombre || '').split(' ')[0].slice(0, 12).toUpperCase(), 22, y);
    ctx.fillStyle = '#7f8aa8'; ctx.fillText(String(r.aeropuerto || '—'), 260, y);
    ctx.fillStyle = r.nivel === 'oportunidad' ? '#34e0a1' : '#e8e4d8';
    const mi = r.mejor_precio_millas != null ? (NV.fmtMiles ? NV.fmtMiles(r.mejor_precio_millas) : String(r.mejor_precio_millas)) : '—';
    ctx.textAlign = 'right'; ctx.fillText(mi, w - 24, y); ctx.textAlign = 'left';
  });
}
function dibujarPuerta(ctx, w, h) {
  ctx.fillStyle = '#0a0d18'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(245,166,35,.45)'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = '#f5a623'; ctx.font = '900 150px Fraunces, Georgia, serif'; ctx.textBaseline = 'middle';
  ctx.fillText('14', 60, h / 2 + 8);
  ctx.fillStyle = '#f3efe4'; ctx.font = '600 58px Fraunces, Georgia, serif'; ctx.fillText('Puerta', 300, h / 2 - 40);
  ctx.fillStyle = '#7f8aa8'; ctx.font = '600 30px "JetBrains Mono", ui-monospace, monospace'; ctx.fillText('GATE 14 · EMBARQUE', 302, h / 2 + 30);
  ctx.fillStyle = '#34e0a1'; ctx.font = '600 30px "JetBrains Mono", ui-monospace, monospace'; ctx.fillText('A TIEMPO', 302, h / 2 + 76);
  ctx.fillStyle = '#f5a623'; ctx.font = '120px serif'; ctx.fillText('✈', 800, h / 2 + 4);
}

/* ── Pasajeros abstractos que caminan por la sala ─────────────────────────── */
const pasajeros = [];
{
  const geoCuerpo = new THREE.CapsuleGeometry(0.19, 0.95, 4, 10), geoCabeza = new THREE.SphereGeometry(0.115, 10, 8);
  const rutas = [
    { a: [17, -5.6], b: [-17, -5.6], v: 0.55, t: 0.15 },
    { a: [-17, -6.8], b: [17, -6.8], v: 0.42, t: 0.55 },
    { a: [12, -1.6], b: [-3.5, -7.4], v: 0.5, t: 0.4 },
    { a: [4.6, -8.1], b: [5.2, -8.1], v: 0.03, t: 0.5, mira: true },   // parado mirando el avión
  ];
  for (const r of rutas) {
    const g = new THREE.Group();
    const mat = pasajeros.length % 2 ? M.piel2 : M.piel;
    const c = new THREE.Mesh(geoCuerpo, mat); c.position.y = 0.85; g.add(c);
    const h = new THREE.Mesh(geoCabeza, mat); h.position.y = 1.62; g.add(h);
    // una mochila / cartera abstracta para variar la silueta
    if (Math.random() < 0.7) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.14), M.jean); m.position.set(0, 1.05, -0.2); g.add(m); }
    g.userData = { a: new THREE.Vector2(...r.a), b: new THREE.Vector2(...r.b), v: r.v, t: r.t, dir: 1, mira: !!r.mira };
    scene.add(g); pasajeros.push(g);
  }
}
const _p2 = new THREE.Vector2();
function moverPasajeros(dt, now) {
  for (const g of pasajeros) {
    const u = g.userData, L = u.a.distanceTo(u.b) || 1;
    u.t += (u.v * dt / L) * u.dir;
    if (u.t >= 1) { u.t = 1; u.dir = -1; } else if (u.t <= 0) { u.t = 0; u.dir = 1; }
    _p2.lerpVectors(u.a, u.b, u.t);
    g.position.set(_p2.x, u.mira ? 0 : Math.abs(Math.sin(now / 260 + u.t * 40)) * 0.02, _p2.y);
    if (u.mira) g.rotation.y = Math.PI + Math.sin(now / 3000) * 0.15;
    else { const dx = (u.b.x - u.a.x) * u.dir, dz = (u.b.y - u.a.y) * u.dir; g.rotation.y = Math.atan2(dx, dz); }
  }
}

/* ── Afuera: plataforma, luces de pista, ciudad, torre, cielo ─────────────── */
const afuera = new THREE.Group(); scene.add(afuera);
{
  const pista = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), M.pista);
  pista.rotation.x = -Math.PI / 2; pista.position.set(0, -0.6, -200); afuera.add(pista);
  const plataforma = new THREE.Mesh(new THREE.PlaneGeometry(120, 70), M.plataforma);
  plataforma.rotation.x = -Math.PI / 2; plataforma.position.set(10, -0.59, -44); afuera.add(plataforma);
  // Líneas de guía pintadas en la plataforma (amarillas, tenues)
  const lineas = [];
  lineas.push({ geo: G(new THREE.PlaneGeometry(0.25, 40), 15, -0.58, -36, -Math.PI / 2), color: 0xf5a623, k: 0.35 });
  lineas.push({ geo: G(new THREE.PlaneGeometry(0.25, 40), -22, -0.58, -36, -Math.PI / 2), color: 0xf5a623, k: 0.35 });
  lineas.push({ geo: G(new THREE.PlaneGeometry(0.25, 90), 0, -0.58, -14, -Math.PI / 2, Math.PI / 2, 0), color: 0xf5a623, k: 0.35 });
  afuera.add(new THREE.Mesh(fusionar(lineas), M.vertices));

  // Luces de borde de pista (azules y ámbar), de rodaje (verdes): un solo Points
  const pos = [], col = [];
  const punto = (x, y, z, hex, k) => { pos.push(x, y, z); _tmpColor.set(hex).multiplyScalar(k); col.push(_tmpColor.r, _tmpColor.g, _tmpColor.b); };
  for (let z = -14; z > -260; z -= 6) for (const x of [-9, 9]) punto(x, -0.45, z, 0x6ea8ff, 2.2);
  for (let z = -14; z > -260; z -= 12) punto(0, -0.45, z, 0xf5a623, 2.0);
  for (let x = -120; x <= 180; x += 7) punto(x, -0.45, -100, 0x34e0a1, 1.6);          // rodaje paralelo (verde)
  for (let x = -120; x <= 180; x += 14) { punto(x, -0.45, -108, 0x6ea8ff, 1.6); punto(x, -0.45, -92, 0x6ea8ff, 1.6); }
  for (let x = -60; x <= 60; x += 8) punto(x, -0.45, -70, 0xf5a623, 1.4);              // borde plataforma
  for (let i = 0; i < 26; i++) punto(-90 + i * 10, -0.45, -140, i % 2 ? 0xffffff : 0xff5a6e, 1.6); // pista de despegue lejana
  const cerca = { p: [], c: [] }, lejos = { p: [], c: [] };
  for (let i = 0; i < pos.length; i += 3) { const d = Math.hypot(pos[i], pos[i + 2]); const o = d < 75 ? cerca : lejos; o.p.push(pos[i], pos[i + 1], pos[i + 2]); o.c.push(col[i], col[i + 1], col[i + 2]); }
  for (const [o, mat] of [[cerca, { size: 0.3, sizeAttenuation: true }], [lejos, { size: 2.2, sizeAttenuation: false }]]) {
    const gPts = new THREE.BufferGeometry();
    gPts.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    gPts.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3));
    afuera.add(new THREE.Points(gPts, new THREE.PointsMaterial(Object.assign({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }, mat))));
  }

  // Torres de iluminación de plataforma (postes con cabezal emisivo)
  const postes = [], cabezales = [];
  for (const [x, z] of [[-30, -30], [42, -34], [8, -66]]) {
    postes.push({ geo: G(new THREE.CylinderGeometry(0.25, 0.4, 22, 8), x, 10.4, z) });
    cabezales.push({ geo: G(new THREE.BoxGeometry(2.6, 0.5, 1.2), x, 21.4, z) });
  }
  afuera.add(new THREE.Mesh(fusionar(postes), M.parteluz));
  afuera.add(new THREE.Mesh(fusionar(cabezales), luz(0xdce8ff, 1.6)));

  // Ciudad al fondo: edificios fusionados + ventanitas fusionadas (colores por vértice) + carteles luminosos
  const edif = [], vent = [], balizas = [];
  for (let i = 0; i < 90; i++) {
    const w = rnd(5, 16), h = rnd(8, 52), d = rnd(5, 14);
    const x = rnd(-220, 220), z = rnd(-250, -330);
    edif.push({ geo: G(new THREE.BoxGeometry(w, h, d), x, h / 2 - 0.6, z) });
    const filas = Math.floor(h / 2.6), colsN = Math.max(1, Math.floor(w / 2.2));
    for (let f = 0; f < filas; f++) for (let c = 0; c < colsN; c++) if (Math.random() < 0.42) {
      const cx = x - w / 2 + 1.1 + c * 2.2, cy = 1.2 + f * 2.6;
      const r = Math.random(); const hex = r < 0.72 ? 0xffe6b8 : r < 0.9 ? 0xf5a623 : 0x9fc4ff;
      vent.push({ geo: G(new THREE.PlaneGeometry(1.0, 1.2), cx, cy, z + d / 2 + 0.05), color: hex, k: rnd(1.0, 2.0) });
    }
    if (h > 34) balizas.push({ geo: G(new THREE.SphereGeometry(0.5, 6, 6), x, h - 0.4, z), color: 0xff5a6e, k: 2 });
  }
  afuera.add(new THREE.Mesh(fusionar(edif), M.ciudad));
  afuera.add(new THREE.Mesh(fusionar(vent.concat(balizas)), M.vertices));
  // Carteles luminosos en las azoteas (ámbar / verde)
  const carteles = [], titila = [];
  for (const [x, y, z, hex, w, t] of [[-70, 44, -262, 0xf5a623, 18], [95, 38, -272, 0x34e0a1, 14, true], [20, 30, -255, 0xffe6b8, 10]]) {
    (t ? titila : carteles).push({ geo: G(new THREE.PlaneGeometry(w, w * 0.32), x, y, z), color: hex, k: 1.4 });
    carteles.push({ geo: G(new THREE.BoxGeometry(w + 0.6, w * 0.32 + 0.6, 0.6), x, y, z - 0.35), color: 0x05070c, k: 1 });
  }
  afuera.add(new THREE.Mesh(fusionar(carteles), M.vertices));
  const cartelT = new THREE.Mesh(fusionar(titila), M.vertices); afuera.add(cartelT); NV.__carteles = cartelT;

  // Torre de control con faro y cabina iluminada
  const torre = new THREE.Group();
  const fuste = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 30, 12), M.parteluz); fuste.position.y = 15; torre.add(fuste);
  const cabina = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 2.6, 4, 12), M.panelOscuro); cabina.position.y = 32; torre.add(cabina);
  const vidrioT = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.3, 1.3, 12, 1, true), luz(0xffe6b8, 0.9, { transparent: true, opacity: 0.75, side: THREE.DoubleSide })); vidrioT.position.y = 32.6; torre.add(vidrioT);
  const faro = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshLambertMaterial({ color: 0xff5a6e, emissive: 0xff5a6e, emissiveIntensity: 1.4 })); faro.position.y = 34.6; torre.add(faro);
  torre.position.set(70, -0.6, -170); afuera.add(torre);
  NV.__faro = faro;

  // Cielo: estrellas (Points, sin niebla) + luna tenue con halo
  const estrellas = (n, size, k) => {
    const p = [], c = [];
    for (let i = 0; i < n; i++) {
      const az = rnd(-Math.PI, Math.PI), el = Math.asin(rnd(0.05, 1)) * 0.95;
      const r = 520; p.push(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r + 10, -Math.cos(el) * Math.cos(az) * r);
      const t = Math.random(); _tmpColor.set(t < 0.75 ? 0xffffff : t < 0.9 ? 0xcfe0ff : 0xffe6c0).multiplyScalar(k * rnd(0.5, 1));
      c.push(_tmpColor.r, _tmpColor.g, _tmpColor.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
  };
  afuera.add(estrellas(1600, 2.0, 1.1)); afuera.add(estrellas(160, 3.2, 1.4));
  const texLuna = texturaCanvas(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(232,236,245,.85)'); g.addColorStop(0.18, 'rgba(232,236,245,.55)'); g.addColorStop(0.5, 'rgba(180,196,230,.12)'); g.addColorStop(1, 'rgba(180,196,230,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ map: texLuna, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(378, 108, -340); halo.lookAt(CABEZA); afuera.add(halo);
  const luna = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false }));
  luna.position.copy(halo.position); luna.lookAt(CABEZA); afuera.add(luna);
}

/* ── El avión estacionado en la puerta (nose-in, grande y cerca) + manga ─── */
const gate = new THREE.Group(); scene.add(gate);
{
  const AX = 15.5, AZ = -37, AY = 2.35;              // centro del fuselaje (piso exterior en -0.6)
  const R = 1.95, LARGO = 30;
  const cuerpo = [];
  cuerpo.push({ geo: G(new THREE.CylinderGeometry(R, R, LARGO, 22, 1, true), AX, AY, AZ, Math.PI / 2) });
  // trompa (esfera alargada hacia +z), cono de cola hacia -z (levanta apenas)
  const trompa = new THREE.SphereGeometry(R, 22, 12); trompa.scale(1, 0.94, 1.6);
  cuerpo.push({ geo: G(trompa, AX, AY - 0.1, AZ + LARGO / 2) });
  const colaCono = new THREE.CylinderGeometry(R, 0.45, 8, 22, 1, true); colaCono.rotateX(Math.PI / 2);
  cuerpo.push({ geo: G(colaCono, AX, AY + 0.36, AZ - LARGO / 2 - 4, 0.09) });
  // alas (barridas hacia atrás, diedro leve), estabilizadores y deriva
  for (const s of [-1, 1]) {
    const ala = new THREE.BoxGeometry(17, 0.32, 4.6); ala.translate(s * 8.5, 0, 0);
    cuerpo.push({ geo: G(ala, AX, AY - 1.0, AZ - 1, 0, s * 0.42, s * 0.07) });
    const est = new THREE.BoxGeometry(6, 0.18, 2.4); est.translate(s * 3, 0, 0);
    cuerpo.push({ geo: G(est, AX, AY + 0.6, AZ - LARGO / 2 - 5.5, 0, s * 0.5, 0) });
    // motores bajo las alas (adelantados al borde de ataque)
    cuerpo.push({ geo: G(new THREE.CylinderGeometry(1.0, 0.9, 3.6, 16), AX + s * 6.2, AY - 1.75, AZ - 1.5, Math.PI / 2) });
  }
  const deriva = new THREE.BoxGeometry(0.32, 6.4, 3.4); deriva.translate(0, 3.2, 0);
  cuerpo.push({ geo: G(deriva, AX, AY + 1.5, AZ - LARGO / 2 - 4.5, -0.55) });
  // tren de aterrizaje
  for (const [x, z] of [[0, LARGO / 2 - 4], [-2.6, -1], [2.6, -1]]) {
    cuerpo.push({ geo: G(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 8), AX + x, AY - R - 0.2, AZ + z) });
  }
  const avionM = new THREE.Mesh(fusionar(cuerpo), M.fuselaje); gate.add(avionM);
  const ruedas = [];
  for (const [x, z] of [[0, LARGO / 2 - 4], [-2.6, -1], [2.6, -1]]) for (const dx of [-0.32, 0.32])
    ruedas.push({ geo: G(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12), AX + x + dx, -0.1, AZ + z, 0, 0, Math.PI / 2) });
  // entradas de los motores (discos oscuros)
  for (const s of [-1, 1]) ruedas.push({ geo: G(new THREE.CircleGeometry(0.94, 16), AX + s * 6.2, AY - 1.75, AZ + 0.31) });
  gate.add(new THREE.Mesh(fusionar(ruedas), M.panelOscuro));
  // franja ámbar de la aerolínea + logo en la deriva
  const marca = [];
  marca.push({ geo: G(new THREE.BoxGeometry(0.02, 0.5, LARGO - 2), AX - R - 0.005, AY - 0.55, AZ), color: 0xf5a623, k: 0.9 });
  marca.push({ geo: G(new THREE.BoxGeometry(0.02, 0.5, LARGO - 2), AX + R + 0.005, AY - 0.55, AZ), color: 0xf5a623, k: 0.9 });
  const logo = new THREE.PlaneGeometry(1.6, 1.6); logo.rotateY(-Math.PI / 2); logo.translate(-0.18, 3.6, 0); logo.rotateX(-0.55);
  marca.push({ geo: G(logo, AX, AY + 1.5, AZ - LARGO / 2 - 4.5), color: 0xf5a623, k: 1.2 });
  gate.add(new THREE.Mesh(fusionar(marca), M.vertices));
  // ventanillas de cabina encendidas (dos filas) + cabina de mando
  const vent = [];
  for (let i = 0; i < 30; i++) {
    const z = AZ - LARGO / 2 + 2.5 + i * 0.86;
    if (i > 22 && i < 25) continue;                                  // puerta delantera (L1)
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.34, 0.46); g.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
      vent.push({ geo: G(g, AX + s * (R + 0.01), AY + 0.55, z), color: 0xffe6b8, k: rnd(1.2, 1.9) });
    }
  }
  for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(1.4, 0.5); g.rotateY(s > 0 ? Math.PI / 2 - 0.5 : -(Math.PI / 2 - 0.5)); vent.push({ geo: G(g, AX + s * 1.55, AY + 0.75, AZ + LARGO / 2 + 1.4), color: 0x0a1020, k: 1 }); }
  // puertas (rectángulos apenas más claros)
  for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(1.0, 1.9); g.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2); vent.push({ geo: G(g, AX + s * (R + 0.008), AY + 0.2, AZ - LARGO / 2 + 2.5 + 23.5 * 0.86), color: 0xbcc6d8, k: 0.6 }); }
  gate.add(new THREE.Mesh(fusionar(vent), M.vertices));
  // luces: baliza roja giratoria (arriba y abajo), navegación, estrobos, faro de logo
  const baliza = new THREE.Group(); baliza.position.set(AX, AY + R + 0.12, AZ - 4); gate.add(baliza);
  const balBulbo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), M.rojo); baliza.add(balBulbo);
  const haz = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a6e).multiplyScalar(0.9), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  haz.rotation.x = -Math.PI / 2; haz.position.y = 0.05; baliza.add(haz);
  const balBajo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), M.rojo); balBajo.position.set(AX, AY - R - 0.1, AZ + 2); gate.add(balBajo);
  const navs = [];
  navs.push({ geo: G(new THREE.SphereGeometry(0.16, 8, 6), AX - 15.6, AY + 0.2, AZ - 8.0), color: 0x34e0a1, k: 2 });   // estribor (−x): verde
  navs.push({ geo: G(new THREE.SphereGeometry(0.16, 8, 6), AX + 15.6, AY + 0.2, AZ - 8.0), color: 0xff5a6e, k: 2 });   // babor (+x): rojo
  navs.push({ geo: G(new THREE.SphereGeometry(0.16, 8, 6), AX, AY + 7.0, AZ - LARGO / 2 - 7.9), color: 0xffffff, k: 2 });   // cola blanca
  gate.add(new THREE.Mesh(fusionar(navs), M.vertices));
  const estrobos = new THREE.Mesh(fusionar([
    { geo: G(new THREE.SphereGeometry(0.22, 8, 6), AX - 15.3, AY + 0.2, AZ - 7.6), color: 0xffffff, k: 3 },
    { geo: G(new THREE.SphereGeometry(0.22, 8, 6), AX + 15.3, AY + 0.2, AZ - 7.6), color: 0xffffff, k: 3 },
  ]), M.vertices); gate.add(estrobos);
  NV.__gate = { baliza, balBulbo, balBajo, estrobos, haz };

  // Manga / finger de embarque: de la terminal (derecha) a la puerta L1 del avión (babor, +x)
  const puertaZ = AZ - LARGO / 2 + 2.5 + 23.5 * 0.86, puertaX = AX + R, puertaY = AY + 0.2;
  const inicio = new THREE.Vector3(21, 3.0, VZ - 0.6), fin = new THREE.Vector3(puertaX + 1.4, puertaY, puertaZ);
  const mangaG = new THREE.Group(); gate.add(mangaG);
  const rotonda = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 3.0, 12), M.manga); rotonda.position.copy(inicio); mangaG.add(rotonda);
  const L = fin.distanceTo(inicio), mid = inicio.clone().add(fin).multiplyScalar(0.5);
  const tubo = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, L), M.manga); tubo.position.copy(mid); tubo.lookAt(fin); mangaG.add(tubo);
  const franja = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.5, L - 1), luz(0xffe6b8, 0.75, { transparent: true, opacity: 0.85 })); franja.position.copy(mid); franja.position.y += 0.35; franja.lookAt(fin.clone().setY(fin.y + 0.35)); mangaG.add(franja);
  const cabezal = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 2.2), M.manga); cabezal.position.set(puertaX + 1.25, puertaY + 0.2, puertaZ); mangaG.add(cabezal);
  const columnaM = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4.6, 8), M.parteluz); columnaM.position.set(puertaX + 1.75, 1.7, puertaZ - 0.6); mangaG.add(columnaM);
  const patasM = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.4, 8), M.parteluz); patasM.position.copy(mid).setY(0.6); mangaG.add(patasM);
}

/* ── Vehículos de plataforma con luces ámbar, moviéndose lento ───────────── */
const vehiculos = [];
{
  const hacer = (w, h, d, ruta) => {
    const g = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.vehiculo); cuerpo.position.y = h / 2 + 0.3; g.add(cuerpo);
    const cabina = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.7, d * 0.35), M.vehiculo); cabina.position.set(0, h + 0.3 + h * 0.35, d * 0.28); g.add(cabina);
    const luces = new THREE.Mesh(fusionar([
      { geo: G(new THREE.PlaneGeometry(0.28, 0.16), -w * 0.3, 0.75, d / 2 + 0.01), color: 0xffffff, k: 2.2 },
      { geo: G(new THREE.PlaneGeometry(0.28, 0.16), w * 0.3, 0.75, d / 2 + 0.01), color: 0xffffff, k: 2.2 },
      { geo: G(new THREE.PlaneGeometry(0.22, 0.14), -w * 0.3, 0.75, -d / 2 - 0.01, 0, Math.PI), color: 0xff5a6e, k: 1.5 },
      { geo: G(new THREE.PlaneGeometry(0.22, 0.14), w * 0.3, 0.75, -d / 2 - 0.01, 0, Math.PI), color: 0xff5a6e, k: 1.5 },
    ]), M.vertices); g.add(luces);
    const baliza = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M.ambar); baliza.position.set(0, h + 0.3 + h * 0.7 + 0.15, d * 0.28); g.add(baliza);
    g.userData = Object.assign({ baliza, t: Math.random(), fase: Math.random() * 7 }, ruta);
    g.position.y = -0.6; scene.add(g); vehiculos.push(g); return g;
  };
  hacer(1.6, 0.9, 2.6, { a: [-34, -14], b: [40, -14], v: 3.2 });          // tractor de valijas frente a la puerta
  hacer(2.2, 1.6, 6.5, { a: [60, -66], b: [-70, -66], v: 4.5 });             // camión de combustible detrás del avión
  hacer(1.6, 0.9, 2.6, { a: [-40, -80], b: [50, -84], v: 2.6 });             // otro tractor por la calle de rodaje
  hacer(1.8, 1.4, 4.0, { a: [27, -50], b: [27, -49.6], v: 0.15 });       // cisterna estacionada junto al avión
}
const _v2a = new THREE.Vector2(), _v2b = new THREE.Vector2();
function moverVehiculos(dt, now) {
  for (const g of vehiculos) {
    const u = g.userData; _v2a.set(u.a[0], u.a[1]); _v2b.set(u.b[0], u.b[1]);
    const L = _v2a.distanceTo(_v2b) || 1; u.t += u.v * dt / L;
    if (u.t > 1) u.t = 0;
    _p2.lerpVectors(_v2a, _v2b, u.t);
    g.position.x = _p2.x; g.position.z = _p2.y;
    g.rotation.y = Math.atan2(_v2b.x - _v2a.x, _v2b.y - _v2a.y);
    g.userData.baliza.visible = ((now / 380 + u.fase) % 2) < 1;
  }
}

/* ── La Mac en el regazo + rodillas (primera persona) ─────────────────────── */
{
  const macG = new THREE.Group(); scene.add(macG);
  const TILT = -0.75;                                   // tapa reclinada, mirando a la cabeza
  const centroTapa = new THREE.Vector3(0, 0.62, -0.72); // = ancla 'mac'
  const bisagra = centroTapa.clone().add(new THREE.Vector3(0, -0.27 * Math.cos(-TILT), 0.27 * Math.sin(-TILT)));
  const alu = new THREE.MeshLambertMaterial({ color: 0x646b7a });
  const tapa = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.56, 0.018), alu); tapa.position.copy(centroTapa); tapa.rotation.x = TILT; macG.add(tapa);
  const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.50), luz(0x9fb6e0, 0.45, { fog: false }));
  pantalla.position.copy(centroTapa).add(new THREE.Vector3(0, 0, 0.011).applyEuler(new THREE.Euler(TILT, 0, 0))); pantalla.rotation.x = TILT; macG.add(pantalla);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.02, 0.56), alu); base.position.copy(bisagra).add(new THREE.Vector3(0, 0.008, 0.28)); base.rotation.x = -0.06; macG.add(base);
  const teclado = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), new THREE.MeshLambertMaterial({ color: 0x23262f })); teclado.rotation.x = -Math.PI / 2 - 0.06; teclado.position.copy(base.position).add(new THREE.Vector3(0, 0.012, -0.08)); macG.add(teclado);
  const trackpad = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.16), new THREE.MeshLambertMaterial({ color: 0x6f7787 })); trackpad.rotation.x = -Math.PI / 2 - 0.06; trackpad.position.copy(base.position).add(new THREE.Vector3(0, 0.012, 0.16)); macG.add(trackpad);
  // rodillas / jean: muslos abiertos que bajan hacia las rodillas (asoman a los lados de la Mac), canillas y zapatillas
  const entre = (a, b, r0, r1, mat) => {
    const d = b.clone().sub(a), L = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, 10), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };
  const yCad = bisagra.y - 0.06;
  for (const s of [-1, 1]) {
    const cadera = new THREE.Vector3(s * 0.13, yCad, 0.08), rodilla = new THREE.Vector3(s * 0.40, yCad - 0.07, -0.66), tobillo = new THREE.Vector3(s * 0.44, 0.06, -0.72);
    macG.add(entre(cadera, rodilla, 0.095, 0.08, M.jean));
    const rod = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), M.jean); rod.position.copy(rodilla); macG.add(rod);
    macG.add(entre(rodilla, tobillo, 0.075, 0.06, M.jean));
    const zapa = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.3), M.piel2); zapa.position.set(s * 0.45, 0.045, -0.82); macG.add(zapa);
  }
  NV.__macTapa = tapa;
}

/* ── Aviones: ruedan por la pista, despegan, cruzan el cielo ──────────────── */
function avion() {
  const g = new THREE.Group();
  const cuerpo = fusionar([
    { geo: G(new THREE.CapsuleGeometry(1.1, 12, 6, 14), 0, 0, 0, 0, 0, Math.PI / 2) },
    { geo: G(new THREE.BoxGeometry(2.4, 0.16, 16), 0.5, -0.3, 0) },
    { geo: G(new THREE.BoxGeometry(0.4, 3.4, 2.4), -6, 1.6, 0) },
    { geo: G(new THREE.BoxGeometry(1.4, 0.12, 5.5), -6, 0.6, 0) },
  ]);
  g.add(new THREE.Mesh(cuerpo, M.fuselaje));
  const luces = new THREE.Mesh(fusionar([
    { geo: G(new THREE.SphereGeometry(0.22, 8, 6), 0.5, -0.3, 8), color: 0x34e0a1, k: 2 },
    { geo: G(new THREE.SphereGeometry(0.22, 8, 6), 0.5, -0.3, -8), color: 0xff5a6e, k: 2 },
    { geo: G(new THREE.SphereGeometry(0.22, 8, 6), -6, 3.2, 0), color: 0xffffff, k: 2 },
    // ventanillas
    ...Array.from({ length: 12 }, (_, i) => ({ geo: G(new THREE.PlaneGeometry(0.4, 0.4), -4 + i * 0.7, 0.3, 1.11), color: 0xffe6b8, k: 1.5 })),
    ...Array.from({ length: 12 }, (_, i) => ({ geo: G(new THREE.PlaneGeometry(0.4, 0.4), -4 + i * 0.7, 0.3, -1.11, 0, Math.PI), color: 0xffe6b8, k: 1.5 })),
  ]), M.vertices);
  g.add(luces);
  const estrobo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), M.blanco); estrobo.position.set(0, -1.3, 0); g.add(estrobo);
  const faroAt = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), M.blanco); faroAt.position.set(6.5, -0.9, 0); g.add(faroAt);
  g.userData.estrobo = estrobo; g.userData.faroAt = faroAt;
  return g;
}
const aviones = [];
{ // uno rodando lejos, uno despegando, dos cruzando alto
  const a1 = avion(); a1.userData.ruta = 'rodaje'; a1.userData.t = 0.2; scene.add(a1); aviones.push(a1);
  const a2 = avion(); a2.userData.ruta = 'despegue'; a2.userData.t = 0.0; scene.add(a2); aviones.push(a2);
  const a3 = avion(); a3.userData.ruta = 'cruce'; a3.userData.t = 0.35; a3.scale.setScalar(0.5); scene.add(a3); aviones.push(a3);
  const a4 = avion(); a4.userData.ruta = 'cruce2'; a4.userData.t = 0.7; a4.scale.setScalar(0.35); scene.add(a4); aviones.push(a4);
}
const suave = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function moverAviones(dt) {
  for (const a of aviones) {
    const u = a.userData; u.t += dt * (u.ruta === 'despegue' ? 0.022 : u.ruta === 'rodaje' ? 0.012 : 0.02);
    if (u.t > 1) u.t = 0;
    const t = u.t;
    if (u.ruta === 'rodaje') { a.position.set(-70 + t * 140, -0.2, -100); a.rotation.set(0, 0, 0); u.faroAt.visible = true; }
    else if (u.ruta === 'despegue') {
      // acelera por la pista, ROTA (nariz arriba) y recién después sube, con la senda de ascenso creíble
      const x = -95 + t * t * 0.4 * 340 + t * 120;
      const rota = suave(0.40, 0.50, t);                       // rotación de nariz
      const sube = suave(0.46, 1.0, t);
      const y = -0.2 + Math.pow(sube, 1.5) * 75;
      a.position.set(x, y, -140 - sube * 30);
      a.rotation.set(0, 0, rota * 0.19 - (t > 0.75 ? (t - 0.75) * 0.25 : 0));
      u.faroAt.visible = t < 0.7;
    }
    else if (u.ruta === 'cruce') { a.position.set(160 - t * 320, 55 + Math.sin(t * 6) * 2, -200); a.rotation.set(0, Math.PI, 0); u.faroAt.visible = false; }
    else { a.position.set(-200 + t * 400, 78, -260); a.rotation.set(0, 0, 0); u.faroAt.visible = false; }
    u.estrobo.visible = (Math.floor(performance.now() / 90) % 12) < 2;
  }
}

/* ── Los soportes físicos de las estaciones (los paneles DOM van encima) ─── */
const anclas = {};
function ancla(nombre, pos, ancho, alto, giroY = 0) {
  const marco = new THREE.Mesh(new THREE.BoxGeometry(ancho + 0.3, alto + 0.3, 0.18), M.panelOscuro);
  marco.position.copy(pos); marco.rotation.y = giroY; scene.add(marco);
  const o = new THREE.Object3D(); o.position.copy(pos); scene.add(o);
  anclas[nombre] = { obj: o, ancho, alto, marco };
  return o;
}
// Carteles colgados del techo, mirando a Nacho
ancla('partidas',  new THREE.Vector3(-3.4, 3.9, -6.6), 3.6, 1.7,  0.30);
ancla('llegadas',  new THREE.Vector3( 3.6, 3.8, -6.4), 3.6, 1.7, -0.36);
// Mostrador / kiosco de revistas a la izquierda
{
  const mostr = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.05, 0.9), M.metal); mostr.position.set(-4.6, 0.52, -3.4); mostr.rotation.y = 0.9; scene.add(mostr);
  const tapaM = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 1.0), M.panelOscuro); tapaM.position.set(-4.6, 1.07, -3.4); tapaM.rotation.y = 0.9; scene.add(tapaM);
  // revistas apiladas (cajitas de colores tenues) sobre el mostrador
  const revistas = [];
  for (let i = 0; i < 7; i++) {
    const c = [0xf5a623, 0x34e0a1, 0xe8e4d8, 0x6ea8ff, 0xff5a6e][i % 5];
    const g = new THREE.BoxGeometry(0.22, 0.03 + (i % 3) * 0.02, 0.3); g.rotateY(0.9 + (i % 2 ? 0.2 : -0.15));
    const lx = -1.0 + i * 0.32;
    revistas.push({ geo: G(g, -4.6 + Math.cos(0.9) * lx, 1.12, -3.4 - Math.sin(0.9) * lx), color: c, k: 0.35 });
  }
  scene.add(new THREE.Mesh(fusionar(revistas), new THREE.MeshLambertMaterial({ vertexColors: true })));
  const l = new THREE.PointLight(0xffd479, 8, 7, 2); l.position.set(-4.4, 1.9, -3.2); scene.add(l);
}
ancla('mostrador', new THREE.Vector3(-4.6, 1.35, -3.4), 1.9, 1.25, 0.9);
// La Mac en el regazo: apenas delante y abajo de la cabeza (el modelo real está más arriba)
ancla('mac', new THREE.Vector3(0, 0.62, -0.72), 0.75, 0.5, 0);
anclas.mac.marco.visible = false;                       // la tapa de la Mac hace de marco

/* Registrar las estaciones en la cámara con sus yaw/pitch reales */
function registrarEstaciones() {
  for (const [n, a] of Object.entries(anclas)) {
    const v = a.obj.position.clone().sub(CABEZA);
    const yaw = Math.atan2(v.x, -v.z) / D2R;
    const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)) / D2R;
    const dist = v.length();
    C.registrar(n, { yaw, pitch, dist, ancho: a.ancho, alto: a.alto });
  }
}
registrarEstaciones();

/* ── Proyección: dónde cae cada estación en la pantalla ─────────────────── */
const _v = new THREE.Vector3();
function proyectar(nombre) {
  const a = anclas[nombre]; if (!a) return null;
  _v.copy(a.obj.position).project(camera);
  const visible = _v.z < 1;
  const x = (_v.x + 1) / 2 * renderer.domElement.clientWidth;
  const y = (1 - _v.y) / 2 * renderer.domElement.clientHeight;
  // escala en px por metro a esa distancia
  const dist = a.obj.position.distanceTo(camera.position);
  const pxm = (renderer.domElement.clientHeight / 2) / Math.tan(camera.fov / 2 * D2R) / dist;
  return { x, y, visible, pxm, anchoPx: a.ancho * pxm, altoPx: a.alto * pxm };
}

/* ── Animación ambiental (barata) ────────────────────────────────────────── */
let ultimaPantalla = 0;
function animar(now, dt) {
  moverAviones(dt);
  moverPasajeros(dt, now);
  moverVehiculos(dt, now);
  if (NV.__faro) NV.__faro.material.emissiveIntensity = 0.6 + Math.abs(Math.sin(now / 900)) * 1.6;
  const g = NV.__gate;
  if (g) {
    g.baliza.rotation.y = now / 350;                                    // baliza roja girando
    const p = 0.5 + 0.5 * Math.sin(now / 350 * 2);
    g.haz.material.opacity = 0.18 + p * 0.25;
    g.balBulbo.visible = g.balBajo.visible = p > 0.35;
    g.estrobos.visible = (Math.floor(now / 100) % 14) < 2;
  }
  if (NV.__carteles) NV.__carteles.visible = (now % 9000) > 500 || (Math.floor(now / 90) % 2 === 0); // un cartel que "titila" un instante cada 9s
  if (now - ultimaPantalla > 8000) {                                    // las pantallitas rotan destinos
    ultimaPantalla = now; NV.__pantOffset = (NV.__pantOffset || 0) + 3;
    NV.__texPantallas?.__redibujar?.();
  }
}

/* ── Resolución adaptativa: si la GPU no llega, bajamos el pixel ratio de a poco
      (los paneles DOM usan clientWidth/Height, así que no se enteran) ─────── */
const RATIO_MAX = Math.min(window.devicePixelRatio || 1, 2);
let ratio = RATIO_MAX, acumT = 0, acumN = 0, enfriar = 0;
function ajustarResolucion(dt) {
  acumT += dt; acumN++;
  if (acumT < 2) return;
  const fps = acumN / acumT; acumT = 0; acumN = 0;
  if (enfriar > 0) { enfriar--; return; }               // tras un cambio, dejamos asentar 4s
  let nuevo = ratio;
  if (fps < 40 && ratio > 0.75) nuevo = Math.max(0.75, ratio - 0.15);
  else if (fps > 57 && ratio < RATIO_MAX) nuevo = Math.min(RATIO_MAX, ratio + 0.1);
  if (nuevo !== ratio) { ratio = nuevo; enfriar = 2; renderer.setPixelRatio(ratio); redimensionar(); }
}

/* ── Frame ───────────────────────────────────────────────────────────────── */
let ultimo = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - ultimo) / 1000); ultimo = now;
  ajustarResolucion(dt);
  const cam = C.cam;
  // La cámara mira según yaw/pitch; el zoom acerca el FOV y adelanta apenas la cabeza
  camera.rotation.order = 'YXZ';
  camera.rotation.y = -cam.yaw * D2R;
  camera.rotation.x = cam.pitch * D2R;
  const foco = cam.enfocada ? C.estaciones[cam.enfocada] : null;
  const fovBase = 58, fovMin = foco ? Math.max(14, Math.min(58, (foco.alto / foco.dist) / D2R * 1.25)) : 30;
  camera.fov = fovBase + (fovMin - fovBase) * cam.zoom;
  camera.position.copy(CABEZA);
  if (foco && cam.zoom > 0) { // se inclina un poquito hacia adelante al enfocar
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    camera.position.addScaledVector(dir, 0.18 * cam.zoom);
  }
  camera.updateProjectionMatrix();
  animar(now, dt);
  renderer.render(scene, camera);
  for (const h of hooks) h();
  requestAnimationFrame(frame);
}
const hooks = [];

function redimensionar() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', redimensionar);
redimensionar();
requestAnimationFrame(frame);

NV.mundo = { THREE, scene, camera, renderer, anclas, proyectar, onFrame: h => hooks.push(h), CABEZA };
document.dispatchEvent(new CustomEvent('nv:mundo-listo'));
