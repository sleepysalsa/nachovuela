/* Enciende la experiencia: clave de entrada, escenas, riel y estado del radar. */
(function () {
  'use strict';
  const NV = window.NV;

  const CAPITULOS = [
    { id: 'terminal', p: 0.02, txt: 'la terminal' },
    { id: 'mac',      p: 0.24, txt: 'buscar vuelos' },
    { id: 'partidas', p: 0.55, txt: 'partidas' },
    { id: 'llegadas', p: 0.74, txt: 'llegadas' },
    { id: 'revista',  p: 0.90, txt: 'la revista' },
  ];

  function armarRiel() {
    const riel = document.getElementById('riel');
    riel.innerHTML = CAPITULOS.map(c =>
      `<button class="riel__p" data-p="${c.p}" aria-label="${c.txt}"><span>${c.txt}</span></button>`
    ).join('');
    const viaje = document.getElementById('viaje');
    riel.querySelectorAll('.riel__p').forEach(b => {
      b.addEventListener('click', () => {
        const alto = viaje.offsetHeight - window.innerHeight;
        window.scrollTo({ top: alto * parseFloat(b.dataset.p), behavior: 'smooth' });
      });
    });
    // marcar el capítulo actual
    const puntos = [...riel.querySelectorAll('.riel__p')];
    const marcar = () => {
      const p = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--p')) || 0;
      let idx = 0;
      CAPITULOS.forEach((c, i) => { if (p >= c.p - 0.06) idx = i; });
      puntos.forEach((b, i) => b.classList.toggle('on', i === idx));
      requestAnimationFrame(marcar);
    };
    marcar();
  }

  function pintarEstado() {
    const el = document.getElementById('hudEstado');
    const L = NV.state.latest;
    if (!L) { el.textContent = 'sin datos'; return; }
    const ops = (L.resultados || []).filter(r => r.nivel === 'oportunidad').length;
    el.innerHTML = `<span class="hud__punto"></span>`
      + (ops ? `<b>${ops}</b> oportunidad${ops === 1 ? '' : 'es'}` : 'radar activo')
      + ` · ${NV.haceCuanto(L.generado)}`;
  }

  document.getElementById('hudTop').addEventListener('click', e => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  (async function () {
    NV.setupLock();
    await NV.arrancarCine();
    armarRiel();
    pintarEstado();
  })();
})();
