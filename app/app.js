/* Lector: la biblioteca, la vista de lectura y los ajustes.
 *
 * Tres vistas, por la dirección:
 *  · #/            la biblioteca, sus colecciones, y abrir un libro nuevo
 *  · #/coleccion/<id>  una colección: las de dentro y sus libros
 *  · #/libro/<id>  el libro: su texto por tramos, su índice, sus marcadores
 *                  y notas, y la voz
 *  · #/ajustes     las voces de cada lengua, la velocidad y la
 *                  sincronización con Google Drive (nube.js)
 *
 * La voz (voz.js) lee el libro entero, frase por frase, desde la que se
 * toque; aquí se le da la lista de frases y se escucha qué frase suena para
 * resaltarla, seguirla con la vista y apuntar por dónde va. El libro se
 * pinta por tramos —un capítulo, o un trozo de él si es muy largo—, que un
 * libro entero de golpe son miles de párrafos para un teléfono.
 */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const vista = $('#vista');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;',
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const mb = (b) => Math.round(b / 1048576) + ' MB';

  /* Los iconos: trazos de 24×24 del color del texto (.ico en estilos.css),
   * y no letras como ⏮ o ☾, que en Android salen como emoji. */
  const ICONOS = {
    atras: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    adelante: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    izquierda: '<path d="M15 18l-6-6 6-6"/>',
    derecha: '<path d="M9 18l6-6-6-6"/>',
    indice: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    ajustes: '<path d="M3 6h11M18 6h3M3 12h3M10 12h11M3 18h13M20 18h1"/>'
      + '<circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    quita: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    nube: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9h1.3a4 4 0 0 1 2.5 7.9z"/>',
    refresca: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.6"/><path d="M20 3.5v5.1h-5.1"/>',
    play: '<path class="lleno" d="M8 5.3v13.4a1 1 0 0 0 1.5.86l10.6-6.7a1 1 0 0 0 0-1.72L9.5 4.44A1 1 0 0 0 8 5.3z"/>',
    pausa: '<rect class="lleno" x="6" y="4.5" width="4.4" height="15" rx="1.3"/>'
      + '<rect class="lleno" x="13.6" y="4.5" width="4.4" height="15" rx="1.3"/>',
    anterior: '<path class="lleno" d="M18.5 6.2v11.6a.8.8 0 0 1-1.25.66L9.6 12.66a.8.8 0 0 1 0-1.32l7.65-5.8a.8.8 0 0 1 1.25.66z"/>'
      + '<path d="M6 6v12"/>',
    siguiente: '<path class="lleno" d="M5.5 6.2v11.6a.8.8 0 0 0 1.25.66l7.65-5.8a.8.8 0 0 0 0-1.32L6.75 5.54A.8.8 0 0 0 5.5 6.2z"/>'
      + '<path d="M18 6v12"/>',
    luna: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    notas: '<path d="M4 7h9M4 12h9M4 17h6"/><path d="M18 4v6M15.4 5.5l5.2 3M20.6 5.5l-5.2 3"/>',
    libro: '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z"/>'
      + '<path d="M22 5.5A1.5 1.5 0 0 0 20.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z"/>',
    sigue: '<circle cx="12" cy="12" r="7"/><circle class="lleno" cx="12" cy="12" r="2.5"/>'
      + '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    descarga: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    hecho: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    velocidad: '<path d="M12 14l4.5-4.5"/><path d="M3.6 18a9 9 0 1 1 16.8 0"/>',
    tema: '<circle cx="12" cy="12" r="9"/><path class="lleno" d="M12 3a9 9 0 0 1 0 18z"/>',
    disco: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/>'
      + '<path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    onda: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
    toca: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.8'
      + 'a6 6 0 0 1-4.6-2.2L4.3 15.6a1.6 1.6 0 0 1 2.4-2.1L9 15.5"/>',
    marcador: '<path d="M7 3.5h10a1 1 0 0 1 1 1V20.5l-6-4.3-6 4.3V4.5a1 1 0 0 1 1-1z"/>',
    marcado: '<path class="lleno" d="M7 2.5h10a2 2 0 0 1 2 2v16a1 1 0 0 1-1.6.8L12 17.4l-5.4 3.9A1 1 0 0 1 5 20.5v-16a2 2 0 0 1 2-2z"/>',
    lapiz: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 8.5l2 2"/>',
    carpeta: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
    saca: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>'
      + '<path d="M9 14h6"/>',
    puntos: '<circle class="lleno" cx="5.5" cy="12" r="1.7"/><circle class="lleno" cx="12" cy="12" r="1.7"/>'
      + '<circle class="lleno" cx="18.5" cy="12" r="1.7"/>'
  };
  const ico = (n) => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + ICONOS[n] + '</svg>';

  /* El sello de la app (el icono) y las telas de las tapas que se hacen
   * para los libros que no traen portada: el color sale del título, así un
   * libro tiene siempre la misma. */
  const SELLO = '<svg class="sello" viewBox="0 0 64 64" aria-hidden="true" focusable="false">'
    + '<rect width="64" height="64" rx="14" fill="#8a3b12"/>'
    + '<path d="M14 18c6-2 12-1 16 3v27c-4-4-10-5-16-3z" fill="#fffdf9"/>'
    + '<path d="M50 18c-6-2-12-1-16 3v27c4-4 10-5 16-3z" fill="#f3e3d6"/>'
    + '<path d="M41 28a5 5 0 0 1 0 8M45 25a9 9 0 0 1 0 14" fill="none" stroke="#8a3b12" '
    + 'stroke-width="2.4" stroke-linecap="round"/></svg>';
  const TELAS = [['#6e2318', '#e0b66c'], ['#1f3350', '#d8b673'], ['#24402f', '#d3b26e'],
    ['#4a2340', '#dcb877'], ['#5b3a17', '#e6c78a'], ['#2f3b40', '#cfae70'], ['#1d4a4a', '#d9ba7b']];
  const telaDe = (t) => TELAS[Array.from(String(t || '')).reduce((h, c) =>
    (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TELAS.length];

  /* Un tramo no pasa de estos párrafos: si un capítulo es más largo, se
   * parte por sus secciones, y si no las tiene, a pedazos de esta medida. */
  const TRAMO = 500;

  /* Los archivos que se pueden abrir como libro. */
  const ACEPTA = '.epub,.txt,.md,application/epub+zip,text/plain,text/markdown';

  /* ------------------------------------------------------------ ajustes */

  const CLAVE = 'lector-ajustes';
  const A = Object.assign({ voces: {}, vel: 1, tema: 'auto' }, (() => {
    try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); }
    catch (_) { return {}; }
  })());
  // cómo se ve el libro: lo que cambia el panel Aa
  A.lec = Object.assign({ modo: 'paginas', letra: 100, fuente: 'serif',
    interlinea: 'normal', margen: 'normal', justifica: 'si' }, A.lec || {});

  // las velocidades que se pueden elegir, en la cinta y en Ajustes:
  // de 0,1 en 0,1, de 0,6 a 2
  const VELS = Array.from({ length: 15 }, (_, i) => (6 + i) / 10);
  const velTexto = (v) => String(v).replace('.', ',') + '×';

  /** Un paso más despacio (-1) o más deprisa (+1), desde la de ahora. */
  function ponVelocidad(paso) {
    const ahora = +A.vel || 1;
    let i = VELS.findIndex((v) => v >= ahora - 1e-9);
    if (i < 0) i = VELS.length - 1;
    // si la guardada no es de la lista, el primer paso lleva a la vecina
    else if (paso < 0 || VELS[i] === ahora) i += paso;
    i = Math.max(0, Math.min(VELS.length - 1, i));
    if (VELS[i] === ahora) return;
    A.vel = VELS[i];
    guardaAjustes();
    pintaVelocidad();
    if (Voz.estado().estado !== 'parada') Voz.cambia({ vel: A.vel });
  }

  function pintaVelocidad() {
    const v = +A.vel || 1;
    const t = $('#vel');
    if (t) t.textContent = velTexto(v);
    if ($('#b-lento')) $('#b-lento').disabled = v <= VELS[0];
    if ($('#b-rapido')) $('#b-rapido').disabled = v >= VELS[VELS.length - 1];
    if ($('#a-vel')) $('#a-vel').value = v;
  }

  function guardaAjustes() {
    try { localStorage.setItem(CLAVE, JSON.stringify(A)); } catch (_) { /* */ }
  }

  /* El aspecto: el tema vale para toda la app; la letra, los renglones y
   * los márgenes, para el texto del libro (variables de estilos.css). */
  const FUENTES = {
    serif: '"Literata", Georgia, "Noto Serif", "Times New Roman", serif',
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  };
  // la de los títulos del libro y la letra capitular: con serifa, la de las
  // tapas; sin ella, la misma del texto
  const TITULOS = '"Cormorant Garamond", "Literata", Georgia, serif';
  const TEMAS = [['auto', 'Auto', 'Como el teléfono (claro u oscuro)'], ['claro', 'Claro'],
    ['sepia', 'Sepia'], ['oscuro', 'Oscuro'], ['noche', 'Noche', 'Negro, para leer a oscuras']];

  /** Las muestras de los temas, para el panel Aa y para Ajustes. */
  const botonesTema = () => TEMAS.map((t) => '<button type="button" data-v="' + t[0]
    + '" class="t-' + t[0] + '" title="' + esc(t[2] || t[1]) + '">'
    + '<span class="circulo" aria-hidden="true">Aa</span><small>' + t[1] + '</small></button>').join('');
  $('#d-aspecto .temas').innerHTML = botonesTema();
  const INTERLINEAS = { junta: 1.45, normal: 1.65, amplia: 1.9 };
  const MARGENES = { estrecho: '.9rem', normal: '1.4rem', ancho: '2.6rem' };
  const LETRAS = [80, 90, 100, 110, 120, 135, 150, 170, 190];

  function aplicaAspecto() {
    const r = document.documentElement;
    if (A.tema && A.tema !== 'auto') r.dataset.tema = A.tema;
    else delete r.dataset.tema;
    const l = A.lec;
    r.style.setProperty('--fuente', FUENTES[l.fuente] || FUENTES.serif);
    r.style.setProperty('--fuente-titulo', l.fuente === 'sans' ? FUENTES.sans : TITULOS);
    r.style.setProperty('--letra', (1.15 * (l.letra || 100) / 100).toFixed(3) + 'rem');
    r.style.setProperty('--interlinea', INTERLINEAS[l.interlinea] || INTERLINEAS.normal);
    r.style.setProperty('--margen', MARGENES[l.margen] || MARGENES.normal);
    r.style.setProperty('--alinea', l.justifica === 'no' ? 'left' : 'justify');
    colorBarra();
  }

  /** La barra del teléfono, del color de lo de arriba: el papel del libro
   *  leyendo, el fondo en lo demás. */
  function colorBarra() {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = getComputedStyle(document.body).backgroundColor || '#8a3b12';
  }
  aplicaAspecto();
  if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicaAspecto);
  }

  /** La voz con que se lee una lengua: la elegida en Ajustes, o la primera
   *  que haya para ella. */
  function vozDe(lengua) {
    const elegida = A.voces[lengua];
    if (elegida && Voz.VOCES.some((v) => v[0] === elegida)) return elegida;
    const v = Voz.VOCES.find((x) => x[2] === lengua);
    return v ? v[0] : null;
  }

  const rotuloVoz = (id) => (Voz.VOCES.find((v) => v[0] === id) || [id, id])[1];
  const nombreLengua = (l) => Voz.LENGUAS[l] || l || '¿?';
  const base = (id) => String(id).split(':')[0];

  /* ------------------------------------------------------------- estado */

  /* Un libro abierto: lo guardado más lo que se calcula al abrirlo. Las
   * frases se parten la primera vez que se lee, no al abrir. */
  const L = {
    vista: null,     // el libro que se ve
    sonando: null,   // el libro que lee la voz (puede no ser el que se ve)
    tramo: -1,       // el tramo pintado del libro que se ve
    sigue: true,     // la vista va detrás de la frase que suena
    mueve: false,    // el dedo ha movido el texto desde la última vez
    hay: {},         // voz -> está bajada
    urls: [],        // portadas pintadas, para soltarlas
    sueno: null,     // el temporizador: { hasta } (una hora) o { parrafo } (fin del capítulo)
    ro: null,        // el que mira el tamaño de la hoja, en páginas
    pestana: '',     // la pestaña del índice que se vio la última vez
    elegido: null    // el trozo del texto seleccionado (un Range), para una nota
  };

  /* Las páginas del tramo pintado (sólo leyendo por páginas): cuántas son,
   * cuál se ve, cuánto se corre el texto de una a otra, cuánto está corrido
   * ahora (`x`, también a medio deslizar), y el «ancla», la letra con que
   * empieza la que se ve, para no perderla si cambia la medida de la hoja
   * (girar el teléfono, cambiar la letra). */
  const P = { pagina: 0, total: 1, paso: 0, x: 0, ancla: null };

  function abierto(libro, texto) {
    const O = { libro: libro, t: texto.t, h: texto.h || {}, k: texto.k || {},
      trozos: null, primero: null, rangos: new Map() };
    O.hayNotas = Object.keys(O.k).length > 0;
    O.plano = aplanaIndice(libro.indice || []);
    O.tramos = tramos(libro.indice || [], O.t.length);
    return O;
  }

  /** El índice en una lista, en orden, con la profundidad de cada entrada. */
  function aplanaIndice(indice) {
    const r = [];
    const recorre = (l, nivel) => l.forEach((e) => {
      r.push({ t: e.t, p: e.p, nivel: nivel });
      recorre(e.hijos || [], nivel + 1);
    });
    recorre(indice, 0);
    return r.map((e, i) => Object.assign(e, { i: i }))
      .sort((a, b) => a.p - b.p || a.i - b.i);
  }

  /** La entrada del índice en que cae un párrafo: la más honda que empiece
   *  en él o antes. */
  function entradaDe(O, p) {
    let r = null;
    for (const e of O.plano) { if (e.p <= p) r = e; else break; }
    return r;
  }

  /** La página en que cae la letra `c` del párrafo `p`, como «p. 50/750»
   *  (la última es el total); nada si el libro no tiene páginas. */
  function pagina(pg, p, c) {
    if (!pg || !pg.length) return '';
    let i = 0;
    let lo = 0;
    let hi = pg.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (pg[m][0] < p || (pg[m][0] === p && pg[m][1] <= c)) { i = m; lo = m + 1; } else hi = m - 1;
    }
    const nombre = (j) => pg[j][2] || String(j + 1);
    return 'p. ' + nombre(i) + '/' + nombre(pg.length - 1);
  }

  /** Las páginas de un libro guardado antes de que las hubiera: las del
   *  EPUB, si se tiene el archivo y sale partido igual; si no, contadas. */
  async function ponPaginas(l, t) {
    let pg = null;
    try {
      const a = l.formato === 'epub' && await Biblioteca.archivo(l.id);
      if (a) {
        const r = await Importa.archivo(new File([a.blob], a.nombre || 'libro.epub',
          { type: 'application/epub+zip' }));
        if (r.t.length === l.n) pg = r.paginas;
      }
    } catch (_) { /* se cuentan */ }
    if (!pg) pg = Importa.paginas(t || (await Biblioteca.texto(l.id)).t);
    l.paginas = pg;
    await Biblioteca.cambia(l.id, { paginas: pg });
  }

  function tramos(indice, n) {
    const cortes = new Set([0]);
    const parte = (lista, fin) => lista.forEach((e, i) => {
      cortes.add(e.p);
      const hasta = i + 1 < lista.length ? lista[i + 1].p : fin;
      if (hasta - e.p > TRAMO && e.hijos && e.hijos.length) parte(e.hijos, hasta);
    });
    parte(indice, n);
    const c = Array.from(cortes).filter((x) => x >= 0 && x < n).sort((a, b) => a - b);
    const r = [];
    c.forEach((desde, i) => {
      const hasta = i + 1 < c.length ? c[i + 1] : n;
      for (let d = desde; d < hasta; d += TRAMO) {
        const h = Math.min(hasta, d + TRAMO);
        // los capítulos cortos van juntos en un tramo, para no tener que
        // pasar de página cada diez párrafos
        const ult = r[r.length - 1];
        if (ult && h - ult.desde <= TRAMO) ult.hasta = h;
        else r.push({ desde: d, hasta: h });
      }
    });
    return r;
  }

  const tramoDe = (O, p) => Math.max(0, O.tramos.findIndex((x) => p >= x.desde && p < x.hasta));

  /* Las notas al pie se leen o no, según el libro: si no, su párrafo no da
   * ninguna frase, y la voz pasa de largo. */
  const leeNotas = (O) => O.hayNotas && !!O.libro.leeNotas;
  const callada = (O, p) => !!O.k[p] && !leeNotas(O);

  /** Las frases del libro, partidas como las dice la voz, y dónde empieza
   *  cada párrafo en esa lista. */
  function prepara(O) {
    if (O.trozos) return;
    O.trozos = Voz.deParrafos(O.t.map((x, p) => (callada(O, p) ? '' : x)), O.libro.lengua);
    O.primero = new Int32Array(O.t.length).fill(-1);
    for (let k = O.trozos.length - 1; k >= 0; k--) O.primero[O.trozos[k].parrafo] = k;
  }

  /** La frase de una posición guardada ({ p, f }). */
  function trozoDe(O, pos) {
    prepara(O);
    let p = Math.max(0, Math.min(O.t.length - 1, (pos && pos.p) || 0));
    while (p < O.t.length && O.primero[p] < 0) p++;
    if (p >= O.t.length) return 0;
    let k = O.primero[p] + ((pos && pos.f) || 0);
    while (k > O.primero[p] && (k >= O.trozos.length || O.trozos[k].parrafo !== p)) k--;
    return k;
  }

  /** La posición que se guarda de la frase `k`: su párrafo, cuál es en él
   *  y en qué letra empieza (para la página). */
  function posDe(O, k) {
    const p = O.trozos[k].parrafo;
    const r = rangos(O, p)[k - O.primero[p]];
    return { p: p, f: k - O.primero[p], c: r ? r[0] : 0 };
  }

  /** Dónde cae cada frase de un párrafo dentro de su texto: [ini, fin]. */
  function rangos(O, p) {
    let r = O.rangos.get(p);
    if (r) return r;
    prepara(O);
    r = [];
    const t = O.t[p];
    let c = 0;
    for (let k = O.primero[p]; k >= 0 && k < O.trozos.length && O.trozos[k].parrafo === p; k++) {
      const x = O.trozos[k].texto;
      let i = t.indexOf(x, c);
      if (i < 0) i = c;
      r.push([i, Math.min(t.length, i + x.length)]);
      c = i + x.length;
    }
    O.rangos.set(p, r);
    return r;
  }

  /* -------------------------------------------------------------- rutas */

  function ruta() {
    const h = location.hash.replace(/^#\/?/, '');
    const [a, b] = h.split('/');
    if (a === 'libro' && b) return { vista: 'libro', id: decodeURIComponent(b) };
    if (a === 'ajustes') return { vista: 'ajustes' };
    if (a === 'coleccion' && b) return { vista: 'biblioteca', coleccion: decodeURIComponent(b) };
    return { vista: 'biblioteca' };
  }

  async function pinta() {
    const r = ruta();
    L.vista = null;
    L.tramo = -1;
    document.body.dataset.vista = r.vista;
    document.body.classList.remove('paginas', 'inmersivo');
    colorBarra();
    if (L.ro) { L.ro.disconnect(); L.ro = null; }
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('suena'); CSS.highlights.delete('notas'); }
    try {
      if (r.vista === 'libro') await pintaLibro(r.id);
      else if (r.vista === 'ajustes') pintaAjustes();
      else await pintaBiblioteca(r.coleccion);
    } catch (err) {
      console.error(err);
      vista.innerHTML = '<main><p class="mal">' + esc(err.message || err) + '</p>'
        + '<p><a href="#/">← Biblioteca</a></p></main>';
    }
  }

  window.addEventListener('hashchange', pinta);

  /* --------------------------------------------------------- biblioteca */

  /** La biblioteca, o una colección (`cid`): sus colecciones, como
   *  carpetas, y sus libros. */
  async function pintaBiblioteca(cid) {
    L.urls.forEach((u) => URL.revokeObjectURL(u));
    L.urls = [];
    const [libros, cols] = await Promise.all([Biblioteca.libros(), Biblioteca.colecciones()]);
    const col = cid ? cols.find((c) => c.id === cid) : null;
    if (cid && !col) { location.replace('#/'); return; }
    const est = Voz.estado().estado;
    const suena = L.sonando && est !== 'parada' ? L.sonando.libro.id : null;
    const ondas = '<span class="ondas" aria-hidden="true"><i></i><i></i><i></i></span>';
    const enVoz = est === 'pausada' ? 'En pausa' : 'Sonando';
    /** Por dónde va un libro: el tanto por ciento, la página y el capítulo. */
    const donde = (l) => {
      const pos = (l.pos && l.pos.p) || 0;
      return { pos: pos, pct: l.n ? Math.round((100 * pos) / l.n) : 0,
        pag: pagina(l.paginas, pos, (l.pos && l.pos.c) || 0),
        e: entradaDe({ plano: aplanaIndice(l.indice || []) }, pos) };
    };
    const barra = (pct) => '<div class="barra" role="progressbar" aria-label="Leído" aria-valuemin="0" '
      + 'aria-valuemax="100" aria-valuenow="' + pct + '"><div style="width:' + pct + '%"></div></div>';
    const ficha = (l) => {
      const d = donde(l);
      const vivo = suena === l.id;
      return '<li class="ficha">'
        + '<a class="libro" href="#/libro/' + encodeURIComponent(l.id) + '" title="'
        + esc([d.pct + ' %', d.pag, d.e ? d.e.t : ''].filter(Boolean).join(' · ')) + '">'
        + tapaDe(l, vivo ? '<span class="chapa">' + ondas + enVoz + '</span>' : '')
        + '<span class="ficha-titulo">' + esc(l.titulo) + '</span>'
        + (l.autor ? '<span class="ficha-autor">' + esc(l.autor) + '</span>' : '')
        + '</a><div class="ficha-pie">'
        + (d.pos ? barra(d.pct) + '<span class="ficha-pct">' + d.pct + ' %</span>'
          : '<span class="ficha-pct nuevo">Sin empezar</span>')
        + '<button type="button" class="mas icono" data-id="' + esc(l.id) + '" aria-label="Más de «'
        + esc(l.titulo) + '»: colecciones, quitar" title="Colecciones, quitar…">' + ico('puntos')
        + '</button></div></li>';
    };
    /** Una colección: los últimos libros que se abrieron de dentro, en
     *  abanico, su nombre y cuánto lleva. */
    const carpeta = (c) => {
      const dentro = rama(cols, c.id);
      const suyos = libros.filter((l) => (l.colecciones || []).some((x) => dentro.has(x)));
      const subs = hijas(cols, c.id).length;
      const cuenta = [suyos.length ? suyos.length + (suyos.length === 1 ? ' libro' : ' libros') : '',
        subs ? subs + (subs === 1 ? ' colección' : ' colecciones') : ''].filter(Boolean).join(' · ');
      return '<li><a class="carpeta" href="#/coleccion/' + encodeURIComponent(c.id) + '">'
        + '<span class="abanico" aria-hidden="true">' + (suyos.length
          ? suyos.slice(0, 3).reverse().map((l) => tapaDe(l)).join('') : ico('carpeta')) + '</span>'
        + '<span class="carpeta-datos"><b>' + esc(c.nombre) + '</b><small>' + (cuenta || 'Vacía')
        + '</small></span></a></li>';
    };
    const nueva = '<li><button type="button" class="carpeta nueva" id="b-nueva"><span class="abanico" '
      + 'aria-hidden="true">' + ico('mas') + '</span><span class="carpeta-datos"><b>'
      + (col ? 'Nueva subcolección' : 'Nueva colección') + '</b><small>'
      + (col ? 'Dentro de «' + esc(col.nombre) + '»' : 'Ordena tus libros en carpetas')
      + '</small></span></button></li>';
    const abrir = '<input type="file" id="archivo" hidden accept="' + ACEPTA + '">';
    const estado = '<p class="nota" id="importa-estado">' + esc(textoImporta()) + '</p>';

    if (col) {
      const suyos = libros.filter((l) => (l.colecciones || []).includes(col.id));
      const arriba = ancestros(cols, col.id);
      vista.innerHTML = '<main class="biblioteca">'
        + '<header class="portadilla vuelta coleccion"><a class="boton icono" href="'
        + (arriba.length ? '#/coleccion/' + encodeURIComponent(arriba[arriba.length - 1].id) : '#/')
        + '" aria-label="Volver" title="Volver">' + ico('atras') + '</a>'
        + '<div class="titulos"><nav class="migas" aria-label="Dónde estás"><a href="#/">Biblioteca</a>'
        + arriba.map((c) => '<span aria-hidden="true">›</span><a href="#/coleccion/'
          + encodeURIComponent(c.id) + '">' + esc(c.nombre) + '</a>').join('')
        + '</nav><h1>' + esc(col.nombre) + '</h1></div>'
        + '<button type="button" class="boton icono" id="b-coleccion" aria-label="Más de la colección: '
        + 'nombre, mover, quitar" title="Nombre, mover, quitar…">' + ico('puntos') + '</button></header>'
        + '<ul class="carpetas">' + hijas(cols, col.id).map(carpeta).join('') + nueva + '</ul>'
        + '<div class="estante-cabeza"><h2 class="biblio-titulo">Libros <span>' + suyos.length + '</span></h2>'
        + '<button type="button" class="boton" id="b-meter">' + ico('mas') + 'Añadir libros</button>'
        + abrir + '</div>'
        + estado
        + (suyos.length ? '<ul class="estante">' + suyos.map(ficha).join('') + '</ul>'
          : '<p class="vacio-coleccion">' + ico('libro') + '<span>Todavía no hay libros aquí. Toca '
            + '<b>Añadir libros</b> para traerlos de tu biblioteca o abrir uno nuevo.</span></p>')
        + '</main>';
    } else {
      // el último que se abrió, en grande, para seguir con un toque
      const ult = libros.find((l) => l.abierto);
      let seguir = '';
      if (ult) {
        const d = donde(ult);
        const vivo = suena === ult.id;
        seguir = '<a class="seguir" href="#/libro/' + encodeURIComponent(ult.id) + '">'
          + tapaDe(ult)
          + '<div class="datos"><span class="rotulo">' + (vivo ? ondas + enVoz : 'Seguir leyendo') + '</span>'
          + '<b>' + esc(ult.titulo) + '</b>'
          + (ult.autor ? '<p class="nota autor">' + esc(ult.autor) + '</p>' : '')
          + (d.e ? '<span class="donde">' + esc(d.e.t) + '</span>' : '')
          + '<div class="pie">' + barra(d.pct) + '<span>' + d.pct + ' %'
          + (d.pag ? ' · ' + esc(d.pag) : '') + '</span></div>'
          + '<span class="boton principal">' + ico('play') + 'Seguir</span></div></a>';
      }
      const raiz = hijas(cols, '');
      const h = new Date().getHours();
      const saludo = h >= 6 && h < 13 ? 'Buenos días' : h >= 13 && h < 21 ? 'Buenas tardes' : 'Buenas noches';
      vista.innerHTML = '<main class="biblioteca">'
        + '<header class="portadilla"><div class="marca">' + SELLO + '<div><h1>Lector</h1>'
        + '<p class="sub">' + (libros.length ? saludo + '. ¿Qué leemos hoy?' : 'Libros en voz alta, sin conexión.')
        + '</p></div></div>'
        + '<a class="boton icono" href="#/ajustes" aria-label="Ajustes" title="Ajustes">' + ico('ajustes') + '</a></header>'
        + seguir
        + '<div id="nube" class="nube" hidden></div>'
        + (libros.length || raiz.length
          ? '<div class="estante-cabeza"><h2 class="biblio-titulo">Colecciones'
            + (raiz.length ? ' <span>' + raiz.length + '</span>' : '') + '</h2></div>'
            + '<ul class="carpetas">' + raiz.map(carpeta).join('') + nueva + '</ul>'
          : '')
        + (libros.length
          ? '<div class="estante-cabeza"><h2 class="biblio-titulo">Biblioteca <span>' + libros.length + '</span></h2>'
            + '<label class="boton" tabindex="0">' + ico('mas') + 'Añadir libro' + abrir + '</label></div>'
            + estado
            + '<ul class="estante">' + libros.map(ficha).join('') + '</ul>'
          : '<section class="vacio">' + SELLO + '<h2>Tu biblioteca está vacía</h2>'
            + '<p>Abre un EPUB o un TXT: se guarda aquí, con su índice, y se puede escuchar '
            + 'sin conexión desde cualquier párrafo.</p>'
            + '<label class="boton principal" tabindex="0">' + ico('mas') + 'Abrir un libro' + abrir + '</label>'
            + estado + '</section>')
        + '</main>';
      pintaNube();
    }

    sinPaginas(libros);
    const arch = $('#archivo');
    arch.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (f) importa(f, cid);
    });
    // con el teclado, la etiqueta abre el archivo como un botón
    if (arch.parentElement.tagName === 'LABEL') {
      arch.parentElement.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        arch.click();
      });
    }
    const bn = $('#b-nueva');
    if (bn) bn.addEventListener('click', async () => {
      // la nueva se abre, para meterle libros enseguida
      const c = await nuevaColeccion(col);
      if (c) location.hash = '#/coleccion/' + encodeURIComponent(c.id);
    });
    vista.querySelectorAll('.ficha .mas').forEach((b) => b.addEventListener('click', () => {
      const l = libros.find((x) => x.id === b.dataset.id);
      if (l) accionesLibro(l, col);
    }));
    const bc = $('#b-coleccion');
    if (bc) bc.addEventListener('click', () => accionesColeccion(col));
    const bm = $('#b-meter');
    if (bm) bm.addEventListener('click', async () => {
      if (!libros.length) { arch.click(); return; }
      const f = await eligeLibros(col, libros);
      await pinta();
      if (f) importa(f, col.id);
    });
  }

  /** La tapa: la portada del libro, o una de tela con su título en oro. */
  function tapaDe(l, chapa) {
    if (l.portada) {
      const u = URL.createObjectURL(l.portada);
      L.urls.push(u);
      return '<div class="tapa"><img src="' + u + '" alt="">' + (chapa || '') + '</div>';
    }
    const t = telaDe(l.titulo);
    return '<div class="tapa hecha" style="--tela:' + t[0] + ';--dorado:' + t[1] + '">'
      + '<span class="t-titulo" aria-hidden="true">' + esc(l.titulo) + '</span>'
      + '<span class="t-orla"></span>'
      + (l.autor ? '<span class="t-autor" aria-hidden="true">' + esc(l.autor) + '</span>' : '')
      + (chapa || '') + '</div>';
  }

  /* -------------------------------------------------------- colecciones */

  /** La colección de encima de `c`: '' si está arriba del todo (o si la
   *  suya ya no existe). */
  const padreDe = (cols, c) => (c.padre && cols.some((x) => x.id === c.padre) ? c.padre : '');

  /** Las que hay dentro de `padre` ('' para las de arriba), por su nombre. */
  const hijas = (cols, padre) => cols.filter((c) => padreDe(cols, c) === (padre || ''))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' }));

  /** Una colección y todas las de dentro, a cualquier hondura. */
  function rama(cols, id) {
    const r = new Set([id]);
    let mas = true;
    while (mas) {
      mas = false;
      for (const c of cols) {
        if (!r.has(c.id) && r.has(padreDe(cols, c))) { r.add(c.id); mas = true; }
      }
    }
    return r;
  }

  /** Las de encima de una, de la de más arriba a la suya (sin ella). */
  function ancestros(cols, id) {
    const r = [];
    let c = cols.find((x) => x.id === id);
    while (c && padreDe(cols, c) && r.length < cols.length) {
      c = cols.find((x) => x.id === padreDe(cols, c));
      r.unshift(c);
    }
    return r;
  }

  /** Todas, en árbol y en orden, con su hondura; sin las de `fuera` (ni
   *  las de dentro de ellas). */
  function arbol(cols, fuera) {
    const r = [];
    const baja = (padre, nivel) => hijas(cols, padre).forEach((c) => {
      if (fuera && fuera.has(c.id)) return;
      r.push({ c: c, nivel: nivel });
      baja(c.id, nivel + 1);
    });
    baja('', 0);
    return r;
  }

  /** Pide un nombre, para una colección nueva o para cambiárselo.
   *  Devuelve el nombre, o nada si se cancela. */
  function pideNombre(titulo, nota, valor) {
    const d = $('#d-nombre');
    $('#dno-titulo').textContent = titulo;
    $('#dno-nota').textContent = nota || '';
    $('#dno-nota').hidden = !nota;
    const i = $('#dno-nombre');
    i.value = valor || '';
    d.returnValue = '';
    d.showModal();
    i.select();
    return new Promise((res) => {
      d.onclose = () => res(d.returnValue === 'guarda' ? i.value.trim() : '');
    });
  }

  /** Una colección nueva dentro de `padre` (o arriba del todo). */
  async function nuevaColeccion(padre) {
    const nombre = await pideNombre(padre ? 'Nueva subcolección' : 'Nueva colección',
      padre ? 'Dentro de «' + padre.nombre + '».' : '', '');
    return nombre ? Biblioteca.nuevaColeccion(nombre, padre ? padre.id : '') : null;
  }

  /** El menú que sube de abajo: devuelve la acción elegida, o nada. */
  function acciones(titulo, lista) {
    const d = $('#d-acciones');
    const ul = $('#acciones-lista');
    $('#dac-titulo').textContent = titulo;
    ul.innerHTML = lista.map((a) => '<li><button type="button" data-v="' + a.v + '"'
      + (a.peligro ? ' class="peligro"' : '') + '>' + ico(a.ico) + '<span>' + esc(a.t) + '</span></button></li>')
      .join('');
    let v = '';
    ul.onclick = (ev) => {
      const b = ev.target.closest('button[data-v]');
      if (!b) return;
      v = b.dataset.v;
      d.close();
    };
    d.showModal();
    return new Promise((res) => { d.onclose = () => res(v); });
  }

  /** Lo que se puede hacer con un libro desde la biblioteca. */
  async function accionesLibro(l, col) {
    const ops = [{ v: 'colecciones', ico: 'carpeta', t: 'Guardar en colecciones…' }];
    if (col && (l.colecciones || []).includes(col.id)) {
      ops.push({ v: 'saca', ico: 'saca', t: 'Sacar de «' + col.nombre + '»' });
    }
    ops.push({ v: 'quita', ico: 'quita', t: 'Quitar de la biblioteca', peligro: true });
    const v = await acciones(l.titulo, ops);
    if (v === 'colecciones') {
      await eligeColecciones(l);
      pinta();
    } else if (v === 'saca') {
      await Biblioteca.ponColecciones(l.id, (l.colecciones || []).filter((x) => x !== col.id));
      pinta();
    } else if (v === 'quita') {
      const como = await preguntaQuitar(l);
      if (!como) return;
      if (L.sonando && L.sonando.libro.id === l.id) { Voz.para(); L.sonando = null; }
      await Nube.quita(l, como === 'todos');
      pinta();
    }
  }

  /** Lo que se puede hacer con una colección, desde dentro de ella. */
  async function accionesColeccion(col) {
    const v = await acciones(col.nombre, [
      { v: 'nombre', ico: 'lapiz', t: 'Cambiar el nombre' },
      { v: 'mueve', ico: 'carpeta', t: 'Mover a otra colección' },
      { v: 'quita', ico: 'quita', t: 'Quitar la colección', peligro: true }]);
    if (v === 'nombre') {
      const n = await pideNombre('Cambiar el nombre', '', col.nombre);
      if (!n || n === col.nombre) return;
      await Biblioteca.guardaColeccion(Object.assign({}, col, { nombre: n }));
      pinta();
    } else if (v === 'mueve') {
      const dest = await eligeDestino(col);
      if (dest === null || dest === (col.padre || '')) return;
      await Biblioteca.guardaColeccion(Object.assign({}, col, { padre: dest }));
      pinta();
    } else if (v === 'quita') {
      const cols = await Biblioteca.colecciones();
      const r = rama(cols, col.id);
      const n = r.size - 1;
      if (!confirm('¿Quitar la colección «' + col.nombre + '»'
        + (n ? (n === 1 ? ' y la que tiene dentro' : ' y las ' + n + ' que tiene dentro') : '')
        + '? Los libros no se borran: siguen en la biblioteca.')) return;
      const padre = padreDe(cols, col);
      await Biblioteca.quitaColecciones(Array.from(r));
      location.hash = padre ? '#/coleccion/' + encodeURIComponent(padre) : '#/';
    }
  }

  /** La hoja de elegir, con su título, la lista y lo de abajo. Se cumple
   *  al cerrarla. */
  function abreElige(titulo, sub, lista, pie) {
    const d = $('#d-elige');
    $('#de-titulo').textContent = titulo;
    $('#de-sub').textContent = sub || '';
    $('#de-sub').hidden = !sub;
    $('#de-lista').innerHTML = lista;
    $('#de-lista').onchange = null;
    $('#de-lista').onclick = null;
    $('#de-pie').innerHTML = pie || '';
    d.showModal();
    return new Promise((res) => { d.onclose = () => res(); });
  }

  /** En qué colecciones está un libro: casillas, en árbol. Cada cambio se
   *  guarda en el momento. */
  async function eligeColecciones(l) {
    const si = new Set(l.colecciones || []);
    let cols = await Biblioteca.colecciones();
    const lista = () => {
      const a = arbol(cols);
      return a.length ? a.map((x) => '<li style="--nivel:' + x.nivel + '"><label class="casilla">'
        + '<input type="checkbox" value="' + esc(x.c.id) + '"' + (si.has(x.c.id) ? ' checked' : '') + '>'
        + ico('carpeta') + '<span>' + esc(x.c.nombre) + '</span></label></li>').join('')
        : '<li class="nada">Todavía no hay ninguna colección. Crea la primera aquí abajo.</li>';
    };
    const listo = abreElige('Guardar en colecciones', l.titulo, lista(),
      '<button type="button" id="de-nueva">' + ico('mas') + 'Nueva colección</button>'
      + '<button type="button" class="principal" id="de-hecho">Hecho</button>');
    const ul = $('#de-lista');
    const guarda = () => {
      l.colecciones = Array.from(si).filter((x) => cols.some((c) => c.id === x));
      return Biblioteca.ponColecciones(l.id, l.colecciones);
    };
    ul.onchange = (ev) => {
      const i = ev.target;
      if (i.type !== 'checkbox') return;
      if (i.checked) si.add(i.value);
      else si.delete(i.value);
      guarda().catch((err) => alert('No se pudo guardar: ' + (err.message || err)));
    };
    $('#de-nueva').onclick = async () => {
      const c = await nuevaColeccion(null);
      if (!c) return;
      cols = await Biblioteca.colecciones();
      si.add(c.id);
      await guarda();
      ul.innerHTML = lista();
    };
    $('#de-hecho').onclick = () => $('#d-elige').close();
    return listo;
  }

  /** Adónde mover una colección: arriba del todo, o dentro de otra que no
   *  sea ella ni ninguna de las suyas. Devuelve el id ('' arriba), o null. */
  async function eligeDestino(col) {
    const cols = await Biblioteca.colecciones();
    const ahora = padreDe(cols, col);
    const op = [{ id: '', t: 'Biblioteca (arriba del todo)', nivel: 0, icono: 'libro' }]
      .concat(arbol(cols, rama(cols, col.id)).map((x) => ({ id: x.c.id, t: x.c.nombre, nivel: x.nivel + 1,
        icono: 'carpeta' })));
    let v = null;
    const listo = abreElige('Mover «' + col.nombre + '»', 'Elige dónde ponerla, con todo lo que lleva dentro.',
      op.map((x) => '<li style="--nivel:' + x.nivel + '"><button type="button" class="destino" data-id="'
        + esc(x.id) + '"' + (x.id === ahora ? ' aria-current="true"' : '') + '>' + ico(x.icono)
        + '<span>' + esc(x.t) + '</span>' + (x.id === ahora ? '<small>Está aquí</small>' : '')
        + '</button></li>').join(''));
    $('#de-lista').onclick = (ev) => {
      const b = ev.target.closest('button[data-id]');
      if (!b) return;
      v = b.dataset.id;
      $('#d-elige').close();
    };
    await listo;
    return v;
  }

  /** Qué libros de la biblioteca están en una colección: casillas, que se
   *  guardan en el momento. Abajo, abrir un libro nuevo para meterlo en
   *  ella: devuelve su archivo, si se eligió uno. */
  async function eligeLibros(col, libros) {
    let archivo = null;
    const listo = abreElige('Libros en «' + col.nombre + '»', 'Marca los que quieras tener aquí.',
      libros.map((l) => '<li><label class="casilla con-tapa"><input type="checkbox" value="' + esc(l.id) + '"'
        + ((l.colecciones || []).includes(col.id) ? ' checked' : '') + '>' + tapaDe(l)
        + '<span><b>' + esc(l.titulo) + '</b>' + (l.autor ? '<small>' + esc(l.autor) + '</small>' : '')
        + '</span></label></li>').join(''),
      '<label class="boton" tabindex="0">' + ico('mas') + 'Abrir un libro nuevo'
      + '<input type="file" id="de-archivo" hidden accept="' + ACEPTA + '"></label>'
      + '<button type="button" class="principal" id="de-hecho">Hecho</button>');
    $('#de-lista').onchange = (ev) => {
      const i = ev.target;
      if (i.type !== 'checkbox') return;
      const l = libros.find((x) => x.id === i.value);
      if (!l) return;
      const s = new Set(l.colecciones || []);
      if (i.checked) s.add(col.id);
      else s.delete(col.id);
      l.colecciones = Array.from(s);
      Biblioteca.ponColecciones(l.id, l.colecciones)
        .catch((err) => alert('No se pudo guardar: ' + (err.message || err)));
    };
    const fi = $('#de-archivo');
    fi.onchange = () => {
      archivo = (fi.files && fi.files[0]) || null;
      fi.value = '';
      if (archivo) $('#d-elige').close();
    };
    fi.parentElement.onkeydown = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      fi.click();
    };
    $('#de-hecho').onclick = () => $('#d-elige').close();
    await listo;
    return archivo;
  }

  /** Los libros guardados antes de que hubiera páginas las sacan una vez,
   *  uno tras otro, y la biblioteca se vuelve a pintar con ellas. */
  const _paginados = new Set();
  async function sinPaginas(libros) {
    const faltan = libros.filter((l) => !l.paginas && !_paginados.has(l.id));
    if (!faltan.length) return;
    faltan.forEach((l) => _paginados.add(l.id));
    for (const l of faltan) {
      try { await ponPaginas(l); } catch (err) { console.error(err); }
    }
    if (ruta().vista === 'biblioteca') pinta();
  }

  const textoImporta = () => (Nube.estado().conectada
    ? 'EPUB o TXT. Se guarda aquí y en tu Google Drive, para tus otros aparatos.'
    : 'EPUB o TXT. El libro no sale de este teléfono.');

  /** Quitar un libro: si está en Drive, de aquí sólo o de todos los
   *  aparatos. Devuelve 'aqui', 'todos' o nada. */
  function preguntaQuitar(l) {
    if (!Nube.estado().conectada || !l.nube) {
      return Promise.resolve(confirm('¿Quitar «' + l.titulo + '» de la biblioteca?') ? 'aqui' : '');
    }
    const d = $('#d-quita');
    $('#dq-titulo').textContent = '¿Quitar «' + l.titulo + '»?';
    d.returnValue = '';
    d.showModal();
    return new Promise((res) => {
      d.onclose = () => res(d.returnValue === 'aqui' || d.returnValue === 'todos' ? d.returnValue : '');
    });
  }

  /** La línea de la nube en la biblioteca: cuándo se puso al día, o el
   *  botón para hacerlo cuando el permiso de Google ha caducado. */
  function pintaNube() {
    const el = $('#nube');
    if (!el) return;
    const e = Nube.estado();
    el.hidden = !e.conectada;
    if (!e.conectada) return;
    let t;
    if (e.aviso) t = e.aviso;
    else if (e.trabajando) t = 'Poniéndose al día con Drive…';
    else if (e.error) t = e.error;
    else if (!e.permiso) t = 'Para traer lo de tus otros aparatos, toca Sincronizar.';
    else t = e.ultima ? 'Al día con Drive ' + haceCuanto(e.ultima) + '.' : 'Conectado a Drive.';
    el.innerHTML = ico('nube') + '<span class="' + (e.error ? 'mal' : 'nota') + '">' + esc(t) + '</span>'
      + '<button type="button" id="b-nube"' + (e.trabajando ? ' disabled' : '') + '>' + ico('refresca')
      + 'Sincronizar</button>';
    $('#b-nube').addEventListener('click', () => Nube.ahora());
  }

  function haceCuanto(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'ahora mismo';
    if (m < 60) return 'hace ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'hace ' + h + ' h';
    return 'el ' + new Date(t).toLocaleDateString('es');
  }

  /* ------------------------------------------------------------ importar */

  /** Abre un archivo como libro; dentro de una colección (`cid`), lo mete
   *  en ella. */
  async function importa(file, cid) {
    const est = $('#importa-estado');
    est.className = 'nota';
    est.textContent = 'Abriendo «' + file.name + '»…';
    let r;
    try {
      r = await Importa.archivo(file);
    } catch (err) {
      console.error(err);
      est.className = 'mal';
      est.textContent = 'No se pudo abrir «' + file.name + '»: ' + (err.message || err);
      return;
    }
    est.textContent = textoImporta();

    // el mismo archivo otra vez: se abre el que ya está; y si es un libro
    // abierto antes de que se guardaran los archivos (mismo nombre, mismos
    // párrafos), se le guarda el archivo, y conserva su posición
    let huella = '';
    try { huella = await Biblioteca.huella(file); } catch (_) { /* sin crypto.subtle */ }
    const ya = await Biblioteca.libros();
    const igual = huella && ya.find((l) => l.huella === huella);
    if (igual) {
      if (cid && !(igual.colecciones || []).includes(cid)) {
        await Biblioteca.ponColecciones(igual.id, (igual.colecciones || []).concat(cid));
      }
      location.hash = '#/libro/' + encodeURIComponent(igual.id);
      return;
    }
    const viejo = ya.find((l) => !l.huella && l.archivo === file.name && l.n === r.t.length);
    if (viejo) {
      await Biblioteca.ponArchivo(viejo.id, file, file.name, huella);
      Nube.sincroniza();
      location.hash = '#/libro/' + encodeURIComponent(viejo.id);
      return;
    }

    const d = $('#d-importa');
    $('#i-titulo').value = r.titulo;
    $('#i-autor').value = r.autor || '';
    const sel = $('#i-lengua');
    const lenguas = Object.keys(Voz.LENGUAS);
    if (r.lengua && !lenguas.includes(r.lengua)) lenguas.push(r.lengua);
    sel.innerHTML = lenguas.map((l) => '<option value="' + esc(l) + '">'
      + esc(Voz.LENGUAS[l] || l + ' (sin voz todavía)') + '</option>').join('');
    sel.value = r.lengua || 'es';
    const capitulos = r.indice.length;
    const notas = Object.keys(r.k || {}).length;
    const palabras = r.t.reduce((s, x, i) => s + ((r.k || {})[i] ? 0 : x.split(' ').length), 0);
    $('#i-resumen').textContent = (capitulos
      ? capitulos + (capitulos === 1 ? ' entrada' : ' entradas') + ' en el índice'
      : 'Sin índice: se verá como un solo texto')
      + ' · ' + (r.t.length - notas).toLocaleString('es') + ' párrafos'
      + (notas ? ' y ' + notas.toLocaleString('es') + ' notas' : '') + ' · unas '
      + Math.max(1, Math.round(palabras / 9000)) + ' h de escucha';
    d.returnValue = '';
    d.showModal();
    d.onclose = async () => {
      if (d.returnValue !== 'guarda') return;
      const libro = Biblioteca.nuevo(r, {
        titulo: $('#i-titulo').value.trim() || r.titulo,
        autor: $('#i-autor').value.trim(),
        lengua: sel.value,
        archivo: file.name,
        huella: huella,
        colecciones: cid ? [cid] : []
      });
      try {
        await Biblioteca.guarda(libro, { t: r.t, h: r.h, k: r.k || {} }, file);
      } catch (err) {
        alert('No se pudo guardar el libro: ' + (err.message || err));
        return;
      }
      Nube.sincroniza();
      location.hash = '#/libro/' + encodeURIComponent(libro.id);
    };
  }

  /* ---------------------------------------------------------- el libro */

  async function pintaLibro(id) {
    let O;
    if (L.sonando && L.sonando.libro.id === id) {
      O = L.sonando;
    } else {
      const [libro, texto] = await Promise.all([Biblioteca.libro(id), Biblioteca.texto(id)]);
      if (!libro || !texto) throw new Error('Ese libro ya no está en la biblioteca.');
      O = abierto(libro, texto);
    }
    Biblioteca.cambia(id, { abierto: Date.now() });
    L.vista = O;
    if (!O.libro.paginas) {
      ponPaginas(O.libro, O.t).then(() => {
        if (L.vista === O) pintaCapitulo(O, primerVisible() ?? ((O.libro.pos || {}).p || 0));
      }).catch(() => {});
    }

    document.body.classList.toggle('paginas', A.lec.modo === 'paginas');
    vista.innerHTML = '<header class="cabeza">'
      + '<a class="boton icono" href="#/" aria-label="Biblioteca" title="Biblioteca">' + ico('atras') + '</a>'
      + '<div class="rotulos"><b>' + esc(O.libro.titulo) + '</b>'
      + '<span id="capitulo" class="nota"></span></div>'
      + (O.hayNotas ? '<button type="button" class="boton" id="b-notas"></button>' : '')
      + '<button type="button" class="boton icono" id="b-marca" aria-pressed="false"></button>'
      + '<button type="button" class="boton icono" id="b-indice" aria-label="Índice, marcadores y notas" '
      + 'title="Índice, marcadores y notas">' + ico('indice') + '</button>'
      + '</header>'
      + '<main class="lectura">'
      + '<div id="cornisa" class="cornisa" title="Ver sólo la página, o los mandos"></div>'
      + '<div id="hoja"><article id="texto" class="texto" lang="'
      + esc(O.libro.lengua || 'es') + '"></article>'
      + '<button type="button" id="marcapaginas" class="marcapaginas" aria-label="Quitar el marcador de esta página" '
      + 'title="Quitar el marcador" hidden></button></div>'
      + '<div id="folio" class="folio" title="Ver sólo la página, o los mandos"></div></main>'
      + '<button type="button" id="b-sigue" class="boton principal flota" hidden>' + ico('sigue')
      + 'Ir a lo que suena</button>'
      + '<div id="seleccion" class="seleccion" role="toolbar" aria-label="Con lo seleccionado" hidden>'
      + '<button type="button" id="b-sel-nota">' + ico('lapiz') + 'Nota</button>'
      + '<button type="button" id="b-sel-marca">' + ico('marcador') + 'Marcador</button></div>'
      + '<footer class="mandos"><p id="voz-aviso" class="nota" aria-live="polite"></p>'
      + '<div class="avance"><span id="av-pag"></span><div class="cinta">'
      + '<div class="marcas" aria-hidden="true">' + marcas(O) + '</div>'
      + '<input type="range" id="avance" min="0" max="' + Math.max(0, O.t.length - 1)
      + '" step="1" aria-label="Avance en el libro"></div><span id="av-pct"></span></div>'
      + '<div class="fila">'
      + '<button type="button" id="b-sueno" class="lado" aria-label="Temporizador: apagar la voz dentro de un rato" title="Temporizador"></button>'
      + '<button type="button" id="b-atras" aria-label="Frase anterior" title="Frase anterior">' + ico('anterior') + '</button>'
      + '<button type="button" id="b-dice" class="principal grande" aria-label="Leer">' + ico('play') + '</button>'
      + '<button type="button" id="b-adelante" aria-label="Frase siguiente" title="Frase siguiente">' + ico('siguiente') + '</button>'
      + '<button type="button" id="b-aspecto" class="lado" aria-label="Aspecto: páginas, letra y tema" title="Aspecto">Aa</button>'
      + '</div><div class="fila velocidad" role="group" aria-label="Velocidad">'
      + '<button type="button" id="b-lento" aria-label="Más despacio" title="Más despacio">' + ico('menos') + '</button>'
      + '<span id="vel" aria-live="polite"></span>'
      + '<button type="button" id="b-rapido" aria-label="Más deprisa" title="Más deprisa">' + ico('mas') + '</button>'
      + '</div></footer>';

    $('#b-indice').addEventListener('click', () => abreIndice(O));
    $('#b-marca').addEventListener('click', () => cambiaMarcador(O));
    barraSeleccion(O);
    if (O.hayNotas) {
      $('#b-notas').addEventListener('click', () => cambiaNotas(O));
      pintaNotas(O);
    }
    $('#b-sigue').addEventListener('click', () => {
      L.sigue = true;
      $('#b-sigue').hidden = true;
      sigueALaVoz(true);
    });
    $('#b-dice').addEventListener('click', () => dice(O));
    $('#b-atras').addEventListener('click', () => salta(O, -1));
    $('#b-adelante').addEventListener('click', () => salta(O, +1));
    $('#b-lento').addEventListener('click', () => ponVelocidad(-1));
    $('#b-rapido').addEventListener('click', () => ponVelocidad(+1));
    $('#b-sueno').addEventListener('click', () => abreSueno(O));
    $('#b-aspecto').addEventListener('click', () => abreAspecto(O));
    pintaVelocidad();
    pintaSueno();
    const hoja = $('#hoja');
    hoja.addEventListener('click', (ev) => tocaHoja(O, ev));
    gestos(hoja);
    ['#cornisa', '#folio'].forEach((s) => $(s).addEventListener('click', () =>
      ponInmersivo(!document.body.classList.contains('inmersivo'))));
    cintaDeAvance(O);

    const suenaEste = L.sonando === O && Voz.estado().estado !== 'parada';
    L.sigue = true;
    const pos = O.libro.pos || {};
    const p = suenaEste ? O.trozos[Voz.estado().i].parrafo : pos.p || 0;
    pintaTramo(O, tramoDe(O, p));
    pintaEstado();
    if (suenaEste) sigueALaVoz(false);
    else irA(p, false, pos.c || 0);
    observaHoja();
    miraLaVoz(O);
    ayudaPaginas();
  }

  function pintaTramo(O, i) {
    const art = $('#texto');
    if (!art) return;
    const tr = O.tramos[i];
    L.tramo = i;
    // por páginas, de un tramo a otro se pasa como de página: sin botones
    const pag = enPaginas();
    const f = document.createDocumentFragment();
    if (i > 0 && !pag) f.appendChild(botonTramo(O, i - 1, true));
    let capitular = false;   // el primer párrafo de un capítulo lleva letra capitular
    for (let p = tr.desde; p < tr.hasta; p++) {
      const n = O.h[p];
      const el = document.createElement(n ? (n === 1 ? 'h2' : n === 2 ? 'h3' : 'h4') : 'p');
      el.dataset.i = p;
      el.textContent = O.t[p];
      if (O.k[p]) {
        el.className = 'nota-pie';
        el.hidden = callada(O, p);
      } else if (n === 1 || n === 2) {
        capitular = true;
      } else if (!n && capitular) {
        if (/^\p{L}/u.test(O.t[p])) el.className = 'capitular';
        capitular = false;
      }
      f.appendChild(el);
    }
    if (i < O.tramos.length - 1 && !pag) f.appendChild(botonTramo(O, i + 1, false));
    art.replaceChildren(f);
    pintaMarcas(O);   // antes de partir en páginas: los lápices de las notas ocupan sitio
    maqueta();
    pintaCapitulo(O, tr.desde);
    if (L.sonando === O && Voz.estado().estado !== 'parada') resalta(O, Voz.estado().i);
  }

  function botonTramo(O, i, antes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tramo';
    const e = entradaDe(O, O.tramos[i].desde);
    b.innerHTML = (antes ? ico('atras') : '') + '<span>' + esc(e ? e.t : 'Sigue') + '</span>'
      + (antes ? '' : ico('adelante'));
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      dejaDeSeguir();
      pintaTramo(O, i);
      // al de antes se llega por su final, como pasando la página hacia atrás
      if (antes) irA(O.tramos[i].hasta - 1, false);
      else window.scrollTo(0, 0);
      apuntaVista();
    });
    return b;
  }

  /** La página y el capítulo de la letra `c` del párrafo `p` (lo que suena
   *  o lo que se ve): en la cabecera, en la cornisa y el folio de la página,
   *  y en la cinta del avance. */
  function pintaCapitulo(O, p, c) {
    const el = $('#capitulo');
    if (!el) return;
    const e = entradaDe(O, p);
    const pag = pagina(O.libro.paginas, p, c || 0);
    el.textContent = [pag, e ? e.t : ''].filter(Boolean).join(' · ');
    // en una página que empieza por títulos, cuenta el capítulo que empiezan
    let q = p;
    while (O.h[q] && q < O.t.length - 1) { q++; c = 0; }
    const cap = capituloDe(O, q);
    $('#cornisa').textContent = cap ? cap.t : O.libro.titulo;
    $('#folio').textContent = [pag.replace(/^p\. (.*)\/(.*)$/, 'p. $1 de $2'),
      quedan(O, q, c || 0)].filter(Boolean).join(' · ');
    const pct = O.t.length > 1 ? Math.round((100 * p) / (O.t.length - 1)) : 0;
    const av = $('#avance');
    if (av && !L.arrastra) { av.value = p; llenaCinta(av); }
    $('#av-pag').textContent = pag.replace(/\/.*$/, '');
    $('#av-pct').textContent = pct + ' %';
    // por páginas, el marcador se mira al pasar de página (muestra)
    if (!enPaginas()) pintaMarcador();
  }

  /** Lo andado de la cinta del avance, hasta donde está su botón. */
  const llenaCinta = (av) => av.style.setProperty('--f', (+av.value / Math.max(1, +av.max)).toFixed(4));

  /** Las marcas de los capítulos en la cinta del avance (si son tantos que
   *  no se verían, ninguna). */
  function marcas(O) {
    capituloDe(O, 0);   // deja puesto O.nivelCap
    const n = Math.max(1, O.t.length - 1);
    const caps = O.plano.filter((e) => e.nivel <= O.nivelCap && e.p > 0 && e.p < n);
    if (caps.length > 60) return '';
    return caps.map((e) => '<i style="left:' + ((100 * e.p) / n).toFixed(2) + '%"></i>').join('');
  }

  /** El capítulo en que cae un párrafo: la entrada de primer nivel del
   *  índice, o la de segundo si el primero son partes (pocas y con hijos). */
  function capituloDe(O, p) {
    if (O.nivelCap === undefined) {
      const n0 = O.plano.filter((e) => e.nivel === 0).length;
      const n1 = O.plano.filter((e) => e.nivel === 1).length;
      O.nivelCap = n1 > 0 && n1 >= n0 ? 1 : 0;
    }
    let r = null;
    for (const e of O.plano) {
      if (e.p > p) break;
      if (e.nivel <= O.nivelCap) r = e;
    }
    return r;
  }

  /** Dónde acaba el capítulo del párrafo `p`: el primer párrafo del que
   *  sigue (o el final del libro). */
  function finCapitulo(O, p) {
    const cap = capituloDe(O, p);
    if (!cap) return O.t.length;
    const sig = O.plano.find((e) => e.p > cap.p && e.nivel <= O.nivelCap);
    return sig ? sig.p : O.t.length;
  }

  /** Las palabras del libro, sumadas párrafo a párrafo (sin las notas que
   *  se callan): para saber cuánto falta. */
  function palabras(O) {
    if (O.pal) return O.pal;
    const r = new Float64Array(O.t.length + 1);
    for (let i = 0; i < O.t.length; i++) {
      r[i + 1] = r[i] + (callada(O, i) ? 0 : O.t[i].split(' ').length);
    }
    O.pal = r;
    return r;
  }

  /** «quedan 12 min del capítulo», a la velocidad de la voz (unas 150
   *  palabras por minuto a 1×). */
  function quedan(O, p, c) {
    const w = palabras(O);
    const fin = finCapitulo(O, p);
    const n = w[fin] - w[p] - (c ? O.t[p].slice(0, c).split(' ').length - 1 : 0);
    if (n <= 0) return '';
    const m = Math.round(n / (150 * (+A.vel || 1)));
    const de = capituloDe(O, p) ? ' del capítulo' : ' del libro';
    if (m < 1) return 'menos de 1 min' + de;
    if (m < 60) return 'quedan ' + m + ' min' + de;
    return 'quedan ' + Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') + de;
  }

  /** Lleva la vista al párrafo `p` (pintando su tramo si hace falta); por
   *  páginas, a la página de su letra `c`. */
  function irA(p, suave, c) {
    const O = L.vista;
    if (!O) return;
    const t = tramoDe(O, p);
    if (t !== L.tramo) pintaTramo(O, t);
    if (enPaginas()) {
      P.ancla = { p: p, c: c || 0 };
      muestra(paginaDe(p, c || 0), suave);
    } else {
      const el = $('[data-i="' + p + '"]');
      if (el) el.scrollIntoView({ block: 'start', behavior: suave ? 'smooth' : 'auto' });
      else window.scrollTo(0, 0);
    }
    pintaCapitulo(O, p, c);
  }

  /* --------------------------------------------------------- las páginas */

  const enPaginas = () => document.body.classList.contains('paginas');

  /** Mide la hoja y pone el tramo en columnas de su medida: una página por
   *  columna, o dos columnas por página si la hoja es ancha. Se queda en la
   *  primera página. */
  function maqueta() {
    const art = $('#texto');
    const hoja = $('#hoja');
    if (!art || !hoja) return;
    if (!enPaginas()) { art.removeAttribute('style'); return; }
    const cs = getComputedStyle(hoja);
    const m = parseFloat(cs.paddingLeft) || 0;
    const ancho = Math.floor(hoja.clientWidth - m - (parseFloat(cs.paddingRight) || 0));
    const alto = Math.floor(hoja.clientHeight - (parseFloat(cs.paddingTop) || 0)
      - (parseFloat(cs.paddingBottom) || 0));
    const hueco = Math.max(2 * m, 28);
    const dos = ancho >= 860;
    const col = dos ? Math.floor((ancho - hueco) / 2) : ancho;
    const w = dos ? 2 * col + hueco : col;
    Object.assign(art.style, { width: w + 'px', height: Math.max(80, alto) + 'px',
      columnWidth: col + 'px', columnGap: hueco + 'px' });
    hoja.classList.toggle('dos', dos);   // el pliegue del libro abierto
    P.paso = w + hueco;
    P.medida = hoja.clientWidth + 'x' + hoja.clientHeight;
    cuentaPaginas();
    muestra(0, false);
  }

  /** En qué página cae algo que empieza en la `x` de la pantalla. */
  function paginaDeX(x) {
    const art = $('#texto');
    if (!art || !P.paso) return 0;
    return Math.max(0, Math.floor((x - art.getBoundingClientRect().left + 2) / P.paso));
  }

  function cuentaPaginas() {
    const art = $('#texto');
    let ult = art && art.lastElementChild;
    while (ult && ult.hidden) ult = ult.previousElementSibling;
    P.total = 1;
    const r = ult ? ult.getClientRects() : [];
    if (r.length) P.total = paginaDeX(r[r.length - 1].left) + 1;
  }

  /** Corre la tira de páginas hasta `x` (y apunta dónde se queda). */
  function corre(art, x) {
    P.x = x;
    art.style.transform = 'translateX(' + x + 'px)';
  }

  /** Muestra la página `n` del tramo, deslizándola si `anima`. Se desliza a
   *  mano, cuadro a cuadro, y no con una transición CSS: con ella Chrome
   *  vuelve a repartir en capas la tira entera —cientos de páginas— al
   *  empezar cada paso, y la página se traba. */
  let _desliza = 0;
  const QUIETO = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function muestra(n, anima) {
    const art = $('#texto');
    if (!art || !enPaginas()) return;
    P.pagina = Math.max(0, Math.min(P.total - 1, n));
    pintaMarcador();
    const x = -P.pagina * P.paso;
    const desde = P.x;
    cancelAnimationFrame(_desliza);
    // con «menos movimiento» en el teléfono, la página cambia sin deslizarse
    if (!anima || desde === x || QUIETO.matches) { corre(art, x); return; }
    let t0 = 0;
    const cuadro = (t) => {
      if (!t0) t0 = t;
      const k = Math.min(1, (t - t0) / 300);
      // frena al llegar, como la página que se suelta
      corre(art, Math.round(desde + (x - desde) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) _desliza = requestAnimationFrame(cuadro);
    };
    _desliza = requestAnimationFrame(cuadro);
  }

  /** La página en que cae la letra `c` del párrafo `p` del tramo. */
  function paginaDe(p, c) {
    let el = $('#texto [data-i="' + p + '"]');
    while (el && el.hidden) { el = el.nextElementSibling; c = 0; }
    if (!el) return 0;
    const t = el.firstChild;
    let r = null;
    // por la letra, no por la caja del párrafo: la caja puede empezar con un
    // trozo vacío al pie de la página de antes
    if (t && t.nodeType === 3 && t.length) {
      const g = document.createRange();
      const i = Math.min(c, t.length - 1);
      g.setStart(t, i);
      g.setEnd(t, i + 1);
      r = g.getClientRects()[0];
    }
    if (!r) r = el.getClientRects()[0];
    return r ? paginaDeX(r.left) : 0;
  }

  /** La primera letra de la página `n`: { p, c }. El párrafo, y si la
   *  página empieza a media frase la letra, se buscan a saltos (como en un
   *  diccionario): mirarlos uno a uno, hacia el final de un tramo largo,
   *  frenaba el paso de página. */
  function anclaDe(n) {
    const art = $('#texto');
    if (!art) return null;
    // el primer párrafo que acaba en la página `n` o más allá
    const els = art.querySelectorAll('[data-i]:not([hidden])');
    let a = 0;
    let b = els.length;
    while (a < b) {
      const m = (a + b) >> 1;
      const rs = els[m].getClientRects();
      if (!rs.length || paginaDeX(rs[rs.length - 1].left) < n) a = m + 1;
      else b = m;
    }
    const el = els[a];
    const rs = el && el.getClientRects();
    if (!rs || !rs.length) return null;
    const p = +el.dataset.i;
    const t = el.firstChild;
    if (paginaDeX(rs[0].left) >= n || !t || t.nodeType !== 3) return { p: p, c: 0 };
    let lo = 0;
    let hi = t.length - 1;
    const g = document.createRange();
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      g.setStart(t, m);
      g.setEnd(t, m + 1);
      const r = g.getClientRects()[0];
      if (!r || paginaDeX(r.left) < n) lo = m + 1;
      else hi = m;
    }
    return { p: p, c: lo };
  }

  /** Pasa una página adelante (+1) o atrás (-1); en el borde del tramo,
   *  pinta el de al lado. */
  function pasaPagina(d) {
    const O = L.vista;
    if (!O || !enPaginas()) return;
    const n = P.pagina + d;
    if (n < 0) {
      if (L.tramo <= 0) { muestra(0, true); return; }
      pintaTramo(O, L.tramo - 1);
      muestra(P.total - 1, false);
    } else if (n >= P.total) {
      if (L.tramo >= O.tramos.length - 1) { muestra(P.total - 1, true); return; }
      pintaTramo(O, L.tramo + 1);
      muestra(0, false);
    } else {
      muestra(n, true);
    }
    dejaDeSeguir();
    P.ancla = anclaDe(P.pagina);
    if (P.ancla) pintaCapitulo(O, P.ancla.p, P.ancla.c);
    apuntaVista();
  }

  /** Vuelve a partir en páginas si la hoja ha cambiado de medida (o si
   *  `forzar`, porque cambió la letra), sin perder lo que se leía. */
  let _remaqueta = 0;
  function remaqueta(forzar) {
    clearTimeout(_remaqueta);
    _remaqueta = setTimeout(() => {
      const O = L.vista;
      const hoja = $('#hoja');
      if (!O || !hoja || !enPaginas()) return;
      if (!forzar && P.medida === hoja.clientWidth + 'x' + hoja.clientHeight) return;
      const a = P.ancla;
      maqueta();
      if (L.sonando === O && L.sigue && Voz.estado().estado !== 'parada') {
        sigueALaVoz(false);
        return;
      }
      if (a) {
        muestra(paginaDe(a.p, a.c), false);
        P.ancla = a;
        pintaCapitulo(O, a.p, a.c);
      }
    }, 30);
  }

  function observaHoja() {
    if (L.ro) { L.ro.disconnect(); L.ro = null; }
    const hoja = $('#hoja');
    if (!hoja || !enPaginas() || !window.ResizeObserver) return;
    L.ro = new ResizeObserver(() => remaqueta());
    L.ro.observe(hoja);
  }

  /** Sólo la página, sin cabecera ni mandos (o volverlos a ver). */
  function ponInmersivo(si) {
    if (!enPaginas()) si = false;
    document.body.classList.toggle('inmersivo', !!si);
  }

  /** Tocar la hoja: por páginas, los lados pasan de página; en medio, una
   *  frase se lee desde ahí (o, sólo con la página, vuelven los mandos). */
  function tocaHoja(O, ev) {
    if (Date.now() < (L.sinClic || 0)) return;
    // el lápiz de una nota la abre; la cinta del marcador lo quita
    const lapiz = ev.target.closest('.nota-marca');
    if (lapiz) { abreNota(O, lapiz.dataset.nota); return; }
    if (ev.target.closest('#marcapaginas')) { cambiaMarcador(O); return; }
    if (enPaginas()) {
      const r = $('#hoja').getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      if (x < 0.25) { pasaPagina(-1); return; }
      if (x > 0.75) { pasaPagina(+1); return; }
      if (document.body.classList.contains('inmersivo')) { ponInmersivo(false); return; }
      if (!ev.target.closest('[data-i]')) { ponInmersivo(true); return; }
    }
    toca(O, ev);
  }

  /** Por páginas, el dedo arrastra la página y, si va lo bastante, la pasa;
   *  la rueda del ratón también pasa de página. */
  function gestos(hoja) {
    let t0 = null;
    hoja.addEventListener('touchstart', (ev) => {
      t0 = enPaginas() && ev.touches.length === 1
        ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY, t: Date.now(), lado: false, dx: 0 }
        : null;
    }, { passive: true });
    hoja.addEventListener('touchmove', (ev) => {
      if (!t0 || !L.vista) return;
      if (ev.touches.length > 1) { t0 = null; muestra(P.pagina, true); return; }
      // eligiendo un trozo del texto (para una nota), el dedo no pasa la página
      if (window.getSelection && !getSelection().isCollapsed) {
        if (t0.lado) muestra(P.pagina, true);
        t0 = null;
        return;
      }
      const dx = ev.touches[0].clientX - t0.x;
      const dy = ev.touches[0].clientY - t0.y;
      if (!t0.lado) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { t0 = null; return; }
        if (Math.abs(dx) < 10) return;
        t0.lado = true;
      }
      // en la primera y en la última del libro, la página se resiste
      const tope = (dx > 0 && P.pagina === 0 && L.tramo === 0)
        || (dx < 0 && P.pagina === P.total - 1 && L.tramo === L.vista.tramos.length - 1);
      t0.dx = dx;
      cancelAnimationFrame(_desliza);
      corre($('#texto'), -P.pagina * P.paso + (tope ? dx / 4 : dx));
    }, { passive: true });
    const suelta = () => {
      const t = t0;
      t0 = null;
      if (!t || !t.lado) return;
      L.sinClic = Date.now() + 400;
      const rapido = Math.abs(t.dx) / Math.max(1, Date.now() - t.t) > 0.35;
      if (Math.abs(t.dx) > 60 || (rapido && Math.abs(t.dx) > 20)) pasaPagina(t.dx < 0 ? 1 : -1);
      else muestra(P.pagina, true);
    };
    hoja.addEventListener('touchend', suelta);
    hoja.addEventListener('touchcancel', suelta);
    hoja.addEventListener('wheel', (ev) => {
      if (!enPaginas() || ev.ctrlKey) return;
      ev.preventDefault();
      const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (Math.abs(d) < 4 || Date.now() < (L.rueda || 0)) return;
      L.rueda = Date.now() + 380;
      pasaPagina(d > 0 ? 1 : -1);
    }, { passive: false });
  }

  // con teclado: las flechas y Re Pág / Av Pág pasan de página
  document.addEventListener('keydown', (ev) => {
    if (!L.vista || !enPaginas() || document.querySelector('dialog[open]')) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.target.closest && ev.target.closest('input, select, textarea')) return;
    const k = ev.key;
    if (k === 'ArrowRight' || k === 'PageDown') { ev.preventDefault(); pasaPagina(+1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { ev.preventDefault(); pasaPagina(-1); }
    else if (k === 'Escape') ponInmersivo(false);
  });

  /** La primera vez que se lee por páginas: dónde tocar. */
  function ayudaPaginas() {
    if (!enPaginas() || A.vistaAyuda) return;
    const d = document.createElement('div');
    d.className = 'ayuda';
    d.innerHTML = '<div><b>' + ico('izquierda') + '</b>Página anterior</div>'
      + '<div class="medio"><span>' + ico('toca') + 'Toca una frase<br>para oírla desde ahí</span>'
      + '<span>' + ico('libro') + 'Toca el número de página<br>para ver sólo la página</span>'
      + '<button type="button" class="principal">Entendido</button></div>'
      + '<div><b>' + ico('derecha') + '</b>Página siguiente</div>';
    d.addEventListener('click', (ev) => {
      ev.stopPropagation();
      d.remove();
      A.vistaAyuda = true;
      guardaAjustes();
    });
    $('#hoja').appendChild(d);
  }

  /** La cinta del avance: arrastrarla dice adónde se va, y soltarla va. */
  function cintaDeAvance(O) {
    const av = $('#avance');
    av.addEventListener('input', () => {
      L.arrastra = true;
      llenaCinta(av);
      const p = +av.value;
      const e = entradaDe(O, p);
      aviso([pagina(O.libro.paginas, p, 0), e ? e.t : ''].filter(Boolean).join(' · '));
    });
    av.addEventListener('change', () => {
      L.arrastra = false;
      aviso('');
      dejaDeSeguir();
      let p = +av.value;
      while (p < O.t.length - 1 && callada(O, p)) p++;
      irA(p, false, 0);
      apuntaVista();
    });
  }

  /* ----------------------------------------------------- el panel Aa */

  function abreAspecto(O) {
    const d = $('#d-aspecto');
    const marca = () => {
      d.querySelectorAll('[data-ajuste]').forEach((g) => {
        const k = g.dataset.ajuste;
        const v = k === 'tema' ? A.tema || 'auto' : A.lec[k];
        g.querySelectorAll('button[data-v]').forEach((b) =>
          b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'));
      });
      const il = LETRAS.indexOf(+A.lec.letra);
      $('#da-letra').innerHTML = '<span class="escala" aria-hidden="true">'
        + LETRAS.map((_, j) => '<i' + (j <= il ? ' class="si"' : '') + '></i>').join('')
        + '</span><span>' + A.lec.letra + ' %</span>';
      $('#da-menos').disabled = A.lec.letra <= LETRAS[0];
      $('#da-mas').disabled = A.lec.letra >= LETRAS[LETRAS.length - 1];
      $('#da-completa').hidden = A.lec.modo !== 'paginas';
    };
    const cambiado = (k) => {
      guardaAjustes();
      aplicaAspecto();
      marca();
      if (k !== 'tema' && k !== 'modo') remaqueta(true);
    };
    d.onclick = (ev) => {
      const b = ev.target.closest('[data-ajuste] button[data-v]');
      if (!b) return;
      const k = b.closest('[data-ajuste]').dataset.ajuste;
      const v = b.dataset.v;
      if (k === 'tema') A.tema = v;
      else if (k === 'modo') { if (A.lec.modo !== v) cambiaModo(O, v); }
      else A.lec[k] = v;
      cambiado(k);
    };
    const letra = (paso) => {
      let i = LETRAS.indexOf(+A.lec.letra);
      if (i < 0) i = LETRAS.indexOf(100);
      A.lec.letra = LETRAS[Math.max(0, Math.min(LETRAS.length - 1, i + paso))];
      cambiado('letra');
    };
    $('#da-menos').onclick = () => letra(-1);
    $('#da-mas').onclick = () => letra(+1);
    $('#da-completa').onclick = () => { d.close(); ponInmersivo(true); };
    marca();
    d.showModal();
  }

  /** Por páginas o de corrido, sin moverse de lo que se leía. */
  function cambiaModo(O, modo) {
    let a = null;
    if (enPaginas()) a = P.ancla;
    else {
      const p = primerVisible();
      if (p !== null) a = { p: p, c: 0 };
    }
    A.lec.modo = modo;
    document.body.classList.toggle('paginas', modo === 'paginas');
    document.body.classList.remove('inmersivo');
    pintaTramo(O, L.tramo);
    window.scrollTo(0, 0);
    observaHoja();
    if (L.sonando === O && L.sigue && Voz.estado().estado !== 'parada') sigueALaVoz(false);
    else if (a) irA(a.p, false, a.c);
    ayudaPaginas();
  }

  /* -------------------------------------------------- el temporizador */

  /** Apagar la voz dentro de un rato, o al acabar el capítulo: se para al
   *  empezar la frase siguiente, así no corta ninguna a medias. */
  function abreSueno(O) {
    const d = $('#d-sueno');
    const ul = $('#sueno-lista');
    const s = L.sueno;
    // los minutos, en fichas; lo demás, a lo ancho
    const op = [10, 20, 30, 45, 60, 90].map((m) => [String(m), '<b>' + m + '</b><small>min</small>', '',
      'Dentro de ' + m + ' minutos'])
      .concat([['cap', ico('libro') + 'Al acabar el capítulo', 'ancho']])
      .concat(s ? [['no', ico('quita') + 'Quitar el temporizador', 'ancho quitar']] : []);
    ul.innerHTML = op.map((x) => {
      const yo = s && ((x[0] === 'cap' && s.parrafo !== undefined) || String(s.min) === x[0]);
      return '<li' + (x[2] ? ' class="' + x[2] + '"' : '') + '><button type="button" data-v="' + x[0] + '"'
        + (yo ? ' aria-pressed="true"' : '') + (x[3] ? ' aria-label="' + x[3] + '"' : '')
        + '>' + x[1] + '</button></li>';
    }).join('');
    ul.onclick = (ev) => {
      const b = ev.target.closest('button[data-v]');
      if (!b) return;
      d.close();
      ponSueno(O, b.dataset.v);
    };
    d.showModal();
  }

  function ponSueno(O, v) {
    if (v === 'no') {
      L.sueno = null;
      aviso('Sin temporizador.');
    } else if (v === 'cap') {
      const suena = L.sonando === O && Voz.estado().estado !== 'parada';
      const p = suena ? O.trozos[Voz.estado().i].parrafo : (O.libro.pos || {}).p || 0;
      L.sueno = { parrafo: finCapitulo(O, p), libro: O.libro.id };
      aviso('La voz se apagará al acabar el capítulo.');
    } else {
      L.sueno = { hasta: Date.now() + v * 60000, min: +v };
      aviso('La voz se apagará dentro de ' + v + ' min.');
    }
    pintaSueno();
  }

  function pintaSueno() {
    const b = $('#b-sueno');
    const s = L.sueno;
    if (s && s.hasta && Date.now() >= s.hasta && Voz.estado().estado !== 'diciendo') L.sueno = null;
    if (!b) return;
    if (!L.sueno) {
      b.innerHTML = ico('luna');
      b.classList.remove('activo');
      return;
    }
    b.classList.add('activo');
    b.innerHTML = ico('luna') + '<span>' + (L.sueno.hasta
      ? Math.max(1, Math.ceil((L.sueno.hasta - Date.now()) / 60000)) + '′'
      : 'cap.') + '</span>';
  }
  setInterval(pintaSueno, 15000);

  /** A cada frase, mira si ya toca apagar la voz. */
  function compruebaSueno(O, k) {
    const s = L.sueno;
    if (!s) return;
    const ya = (s.hasta && Date.now() >= s.hasta)
      || (s.parrafo !== undefined && s.libro === O.libro.id && O.trozos[k].parrafo >= s.parrafo);
    if (!ya) return;
    L.sueno = null;
    Voz.pausa();
    pintaSueno();
    aviso('Voz apagada por el temporizador. Toca ▶ para seguir.');
  }

  /* ----------------------------------------------------------- el índice */

  function abreIndice(O) {
    const d = $('#d-indice');
    const lista = $('#indice-lista');
    const ahora = L.sonando === O && Voz.estado().estado !== 'parada'
      ? O.trozos[Voz.estado().i].parrafo : primerVisible() ?? ((O.libro.pos || {}).p || 0);
    const actual = entradaDe(O, ahora);
    const contiene = (e) => actual && (e.p === actual.p && e.t === actual.t
      || (e.hijos || []).some(contiene));
    const item = (e) => {
      const yo = actual && e.p === actual.p && e.t === actual.t;
      const b = '<button type="button" data-p="' + e.p + '"' + (yo ? ' class="actual" aria-current="true"' : '')
        + '>' + esc(e.t) + '</button>';
      if (!e.hijos || !e.hijos.length) return '<li>' + b + '</li>';
      return '<li><details' + (contiene(e) ? ' open' : '') + '><summary>' + b + '</summary>'
        + '<ul>' + e.hijos.map(item).join('') + '</ul></details></li>';
    };
    lista.innerHTML = (O.libro.indice || []).length
      ? '<ul>' + O.libro.indice.map(item).join('') + '</ul>'
      : '<p class="nota">Este libro no trae índice.</p>';
    lista.onclick = (ev) => {
      const b = ev.target.closest('button[data-p]');
      if (!b) return;
      // tocar el título va a él; el triángulo de al lado abre y cierra
      ev.preventDefault();
      d.close();
      dejaDeSeguir();
      irA(+b.dataset.p, false);
      apuntaVista();
    };
    // dos pestañas: el índice y los marcadores y notas; se abre en la de
    // la última vez
    const pestana = (v) => {
      L.pestana = v;
      d.querySelectorAll('[data-pestana]').forEach((b) =>
        b.setAttribute('aria-selected', b.dataset.pestana === v ? 'true' : 'false'));
      lista.hidden = v !== 'indice';
      $('#marcas-lista').hidden = v !== 'marcas';
    };
    d.querySelectorAll('[data-pestana]').forEach((b) => { b.onclick = () => pestana(b.dataset.pestana); });
    pintaListaMarcas(O);
    pestana(L.pestana === 'marcas' ? 'marcas' : 'indice');
    d.showModal();
    const act = $('.actual', lista);
    if (act && !lista.hidden) act.scrollIntoView({ block: 'center' });
  }

  /* ------------------------------------------------ marcadores y notas
   * Un marcador señala una página: la letra con que empieza ({ p, c }).
   * Una nota, un trozo del texto, de { p, c } a `fin`, con lo que se quiera
   * apuntar (o nada: queda subrayado). Van en la ficha del libro (`marcas`)
   * y se ven en la pestaña «Marcadores y notas» del índice. En el texto, el
   * trozo de cada nota va subrayado (CSS.highlights, como la frase que
   * suena) y lleva un lápiz al final de su párrafo, que la abre; la página
   * marcada, una cinta arriba. No tienen nada que ver con las notas al pie
   * del libro (`O.k`, «Con notas»). */

  const marcasDe = (O) => O.libro.marcas || (O.libro.marcas = []);

  function guardaMarcas(O) {
    Biblioteca.ponMarcas(O.libro.id, O.libro.marcas)
      .catch((err) => aviso('No se pudo guardar: ' + (err.message || err), true));
  }

  /** Un texto largo, cortado por una palabra y con puntos suspensivos. */
  function recorta(t, n) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    const c = t.lastIndexOf(' ', n);
    return t.slice(0, c > n * 0.6 ? c : n) + '…';
  }

  /** Dónde está una marca: la página y la entrada del índice. */
  function dondeMarca(O, m) {
    const e = entradaDe(O, m.p);
    return [pagina(O.libro.paginas, m.p, m.c).replace(/\/.*$/, ''), e ? e.t : ''].filter(Boolean).join(' · ');
  }

  /** El texto de un párrafo pintado (su primer hijo), si lo está. */
  function textoDe(p) {
    const el = $('#texto [data-i="' + p + '"]');
    const t = el && el.firstChild;
    return t && t.nodeType === 3 ? t : null;
  }

  /** El trozo de una nota en el tramo pintado, como Range (recortado al
   *  tramo, si empieza antes o acaba después). */
  function rangoDe(O, m) {
    const tr = O.tramos[L.tramo];
    const fin = m.fin || m;
    if (!tr || fin.p < tr.desde || m.p >= tr.hasta) return null;
    const a = m.p < tr.desde ? { p: tr.desde, c: 0 } : m;
    const b = fin.p >= tr.hasta ? { p: tr.hasta - 1, c: O.t[tr.hasta - 1].length } : fin;
    const n1 = textoDe(a.p);
    const n2 = textoDe(b.p);
    if (!n1 || !n2) return null;
    const g = document.createRange();
    g.setStart(n1, Math.min(a.c, n1.length));
    g.setEnd(n2, Math.min(b.c, n2.length));
    return g;
  }

  /** Pone en el tramo pintado las notas (subrayado y lápiz) y los
   *  marcadores (de corrido, una cinta al margen de su párrafo). */
  function pintaMarcas(O) {
    const art = $('#texto');
    if (!art || L.vista !== O || L.tramo < 0) return;
    const tr = O.tramos[L.tramo];
    art.querySelectorAll('.nota-marca').forEach((b) => b.remove());
    art.querySelectorAll('.marcado').forEach((el) => el.classList.remove('marcado'));
    const rs = [];
    for (const m of marcasDe(O)) {
      if (m.tipo === 'nota') {
        const g = rangoDe(O, m);
        if (g) rs.push(g);
        const q = (m.fin || m).p;
        const el = q >= tr.desde && q < tr.hasta && art.querySelector('[data-i="' + q + '"]');
        if (el) el.appendChild(lapizDe(m));
      } else if (m.p >= tr.desde && m.p < tr.hasta) {
        const el = art.querySelector('[data-i="' + m.p + '"]');
        if (el) el.classList.add('marcado');
      }
    }
    if (window.CSS && CSS.highlights && window.Highlight) {
      if (rs.length) {
        const h = new Highlight(...rs);
        h.priority = -1;   // por debajo de la frase que suena
        CSS.highlights.set('notas', h);
      } else {
        CSS.highlights.delete('notas');
      }
    }
    pintaMarcador();
  }

  /** El lápiz que va detrás del trozo de una nota. Va al final del
   *  párrafo, después de su texto: el primer hijo sigue siendo el texto. */
  function lapizDe(m) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nota-marca';
    b.dataset.nota = m.id;
    b.title = m.texto ? recorta(m.texto, 120) : 'Subrayado';
    b.setAttribute('aria-label', m.texto ? 'Tu nota: ' + recorta(m.texto, 120) : 'Tu subrayado');
    b.innerHTML = ico('lapiz');
    return b;
  }

  /** Los marcadores de lo que se ve: por páginas, los de la página; de
   *  corrido, los de los párrafos a la vista. */
  function marcasAqui(O) {
    if (!O || L.tramo < 0 || !$('#texto')) return [];
    const tr = O.tramos[L.tramo];
    const ms = marcasDe(O).filter((m) => m.tipo === 'marca' && m.p >= tr.desde && m.p < tr.hasta);
    if (!ms.length) return [];
    if (enPaginas()) return ms.filter((m) => paginaDe(m.p, m.c) === P.pagina);
    const arriba = ($('.cabeza') || { offsetHeight: 0 }).offsetHeight;
    const abajo = window.innerHeight - (($('.mandos') || { offsetHeight: 0 }).offsetHeight);
    return ms.filter((m) => {
      const el = $('#texto [data-i="' + m.p + '"]');
      const r = el && el.getBoundingClientRect();
      return r && r.bottom > arriba && r.top < abajo;
    });
  }

  /** El botón del marcador, lleno si lo que se ve está marcado, y la
   *  cinta de la página. */
  function pintaMarcador() {
    const b = $('#b-marca');
    if (!b || !L.vista) return;
    const si = marcasAqui(L.vista).length > 0;
    if (b.getAttribute('aria-pressed') !== String(si) || !b.firstChild) {
      b.innerHTML = ico(si ? 'marcado' : 'marcador');
      b.setAttribute('aria-pressed', String(si));
      b.setAttribute('aria-label', si ? 'Quitar el marcador de esta página' : 'Poner un marcador en esta página');
      b.title = si ? 'Quitar el marcador' : 'Marcador';
    }
    const cinta = $('#marcapaginas');
    if (cinta) cinta.hidden = !(si && enPaginas());
  }

  /** Un marcador en la letra `a` ({ p, c }). */
  function ponMarcador(O, a) {
    marcasDe(O).push({ id: Biblioteca.nuevoId(), tipo: 'marca', p: a.p, c: a.c,
      cita: (a.c > 0 ? '…' : '') + recorta(O.t[a.p].slice(a.c), 160), hecho: Date.now(), cambiado: Date.now() });
  }

  /** El botón del marcador: marca la página que se ve (de corrido, el
   *  primer párrafo a la vista), o le quita el marcador si ya lo tiene. */
  function cambiaMarcador(O) {
    const aqui = marcasAqui(O);
    if (aqui.length) {
      O.libro.marcas = marcasDe(O).filter((m) => !aqui.includes(m));
      aviso('Marcador quitado.');
    } else {
      let a = null;
      if (enPaginas()) a = anclaDe(P.pagina) || P.ancla;
      else {
        const p = primerVisible();
        if (p !== null) a = { p: p, c: 0 };
      }
      if (!a) return;
      ponMarcador(O, a);
      aviso('Página marcada. Está en el índice, en «Marcadores y notas».');
    }
    guardaMarcas(O);
    pintaMarcas(O);
  }

  /** La hoja de una nota: el trozo, dónde está y lo apuntado. Guardarla,
   *  o quitarla, la pinta o la borra del texto. */
  function editaNota(O, m, nueva) {
    const d = $('#d-nota');
    $('#dn-titulo').textContent = nueva ? 'Nueva nota' : 'Tu nota';
    $('#dn-donde').textContent = dondeMarca(O, m);
    $('#dn-cita').textContent = m.cita;
    const t = $('#dn-texto');
    t.value = m.texto || '';
    $('#dn-quita').hidden = !!nueva;
    // al escribir una nueva, el teclado sale solo; al mirar una, no
    t.autofocus = !!nueva;
    $('#dn-cita').autofocus = !nueva;
    d.returnValue = '';
    d.showModal();
    return new Promise((res) => {
      d.onclose = () => {
        const v = d.returnValue;
        if (v === 'guarda') {
          // la de la lista, que puede ser otra si llegó de otro aparato
          // mientras estaba abierta
          const x = marcasDe(O).find((y) => y.id === m.id) || m;
          x.texto = t.value.trim();
          x.cambiado = Date.now();
          if (nueva && x === m) marcasDe(O).push(m);
          aviso(nueva ? 'Nota guardada. Está en el índice, en «Marcadores y notas».' : 'Nota guardada.');
        } else if (v === 'quita') {
          O.libro.marcas = marcasDe(O).filter((x) => x.id !== m.id);
          aviso('Nota quitada.');
        } else {
          res(v);
          return;
        }
        guardaMarcas(O);
        pintaMarcas(O);
        remaqueta(true);   // el lápiz ocupa sitio: la página puede correrse
        res(v);
      };
    });
  }

  function abreNota(O, id) {
    const m = marcasDe(O).find((x) => x.id === id);
    if (m) editaNota(O, m, false);
  }

  /** La pestaña «Marcadores y notas» del índice: todos, en el orden del
   *  libro. Tocar uno va a él. */
  function pintaListaMarcas(O) {
    const el = $('#marcas-lista');
    const ms = marcasDe(O).slice().sort((a, b) => a.p - b.p || a.c - b.c);
    $('#dx-cuenta').textContent = ms.length || '';
    if (!ms.length) {
      el.innerHTML = '<div class="sin-marcas">' + ico('marcador')
        + '<p><b>Todavía no hay marcadores ni notas</b></p>'
        + '<p class="nota">Toca ' + ico('marcador') + ' arriba para marcar la página que lees. '
        + 'Para una nota, deja el dedo sobre una palabra, elige el trozo y toca «Nota».</p></div>';
      el.onclick = null;
      return;
    }
    el.innerHTML = '<ul>' + ms.map((m) => {
      const nota = m.tipo === 'nota';
      return '<li class="' + (nota ? 'es-nota' : 'es-marca') + '">'
        + '<button type="button" class="ir" data-ir="' + esc(m.id) + '">'
        + '<span class="tipo">' + ico(nota ? 'lapiz' : 'marcado') + '</span>'
        + '<span class="cuerpo"><span class="donde">' + esc(dondeMarca(O, m) || (nota ? 'Nota' : 'Marcador'))
        + '</span><span class="cita">' + esc(m.cita) + '</span>'
        + (nota && m.texto ? '<span class="escrito">' + esc(m.texto) + '</span>' : '')
        + '</span></button>'
        + (nota ? '<button type="button" class="icono" data-edita="' + esc(m.id)
          + '" aria-label="Cambiar la nota" title="Cambiar la nota">' + ico('lapiz') + '</button>' : '')
        + '<button type="button" class="icono" data-quita="' + esc(m.id) + '" aria-label="Quitar'
        + (nota ? ' la nota' : ' el marcador') + '" title="Quitar">' + ico('quita') + '</button></li>';
    }).join('') + '</ul>';
    el.onclick = async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const id = b.dataset.ir || b.dataset.edita || b.dataset.quita;
      const m = marcasDe(O).find((x) => x.id === id);
      if (!m) return;
      if (b.dataset.ir) {
        $('#d-indice').close();
        dejaDeSeguir();
        irA(m.p, false, m.c);
        apuntaVista();
      } else if (b.dataset.edita) {
        await editaNota(O, m, false);
        pintaListaMarcas(O);
      } else {
        if (m.tipo === 'nota' && m.texto && !confirm('¿Quitar esta nota?')) return;
        O.libro.marcas = marcasDe(O).filter((x) => x.id !== m.id);
        guardaMarcas(O);
        pintaMarcas(O);
        if (m.tipo === 'nota') remaqueta(true);
        pintaListaMarcas(O);
      }
    };
  }

  /** La letra del libro ({ p, c }) de un punto de la selección: donde
   *  empieza el trozo elegido, o con `fin`, donde acaba. */
  function puntoDe(O, nodo, off, fin) {
    const art = $('#texto');
    let el;
    if (nodo === art) {
      // entre dos párrafos: el que sigue (o, al final, el de antes)
      el = art.childNodes[fin ? off - 1 : off];
      while (el && !(el.dataset && el.dataset.i !== undefined)) el = fin ? el.previousSibling : el.nextSibling;
      if (!el) return null;
      const p = +el.dataset.i;
      return { p: p, c: fin ? O.t[p].length : 0 };
    }
    el = (nodo.nodeType === 3 ? nodo.parentElement : nodo).closest('[data-i]');
    if (!el || !art.contains(el)) return null;
    const p = +el.dataset.i;
    let c;
    if (nodo === el.firstChild && nodo.nodeType === 3) c = off;
    else if (nodo === el) c = off === 0 ? 0 : O.t[p].length;
    else c = O.t[p].length;   // dentro del lápiz de otra nota
    return { p: p, c: Math.max(0, Math.min(O.t[p].length, c)) };
  }

  /** Una nota nueva con el trozo elegido. */
  function notaDe(O, r) {
    const a = puntoDe(O, r.startContainer, r.startOffset, false);
    let b = puntoDe(O, r.endContainer, r.endOffset, true);
    if (!a || !b) return;
    // elegir un párrafo entero acaba en la entrada del siguiente
    if (b.c === 0 && b.p > a.p) b = { p: b.p - 1, c: O.t[b.p - 1].length };
    editaNota(O, { id: Biblioteca.nuevoId(), tipo: 'nota', p: a.p, c: a.c, fin: b,
      cita: recorta(String(r), 400), texto: '', hecho: Date.now() }, true);
  }

  /** Un marcador donde empieza el trozo elegido. */
  function marcaDe(O, r) {
    const a = puntoDe(O, r.startContainer, r.startOffset, false);
    if (!a) return;
    ponMarcador(O, a);
    guardaMarcas(O);
    pintaMarcas(O);
    aviso('Marcador puesto. Está en el índice, en «Marcadores y notas».');
  }

  /** La barra de lo seleccionado: al elegir un trozo del texto (en el
   *  teléfono, dejando el dedo sobre una palabra) sale abajo, para hacer de
   *  él una nota o poner ahí un marcador. */
  function barraSeleccion(O) {
    const bar = $('#seleccion');
    // tocarla puede deshacer la selección antes del clic: se guarda en
    // L.elegido, y mientras se toca, la barra no se va
    bar.addEventListener('pointerdown', () => { L.pulsaBarra = true; });
    const suelta = () => setTimeout(() => { L.pulsaBarra = false; }, 500);
    bar.addEventListener('pointerup', suelta);
    bar.addEventListener('pointercancel', suelta);
    bar.addEventListener('mousedown', (ev) => ev.preventDefault());
    const usa = (fn) => () => {
      const r = L.elegido;
      quitaSeleccion();
      if (r) fn(O, r);
    };
    $('#b-sel-nota').addEventListener('click', usa(notaDe));
    $('#b-sel-marca').addEventListener('click', usa(marcaDe));
  }

  function quitaSeleccion() {
    L.elegido = null;
    L.pulsaBarra = false;
    const s = window.getSelection && getSelection();
    if (s) s.removeAllRanges();
    const bar = $('#seleccion');
    if (bar) bar.hidden = true;
  }

  function miraSeleccion() {
    const bar = $('#seleccion');
    const art = $('#texto');
    if (!bar || !art || !L.vista) return;
    const s = getSelection();
    let r = null;
    if (s && !s.isCollapsed && s.rangeCount && String(s).trim()) {
      const g = s.getRangeAt(0);
      if (art.contains(g.commonAncestorContainer)) r = g.cloneRange();
    }
    if (r) {
      L.elegido = r;
      const m = $('.mandos');
      bar.style.bottom = ((m ? m.offsetHeight : 0) + 14) + 'px';
      bar.hidden = false;
    } else if (!L.pulsaBarra) {
      L.elegido = null;
      bar.hidden = true;
    }
  }

  let _sel = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(_sel);
    _sel = setTimeout(miraSeleccion, 150);
  });

  /* ---------------------------------------------------- las notas al pie */

  function pintaNotas(O) {
    const b = $('#b-notas');
    if (!b) return;
    const si = leeNotas(O);
    b.innerHTML = ico('notas') + '<span>' + (si ? 'Con notas' : 'Sin notas') + '</span>';
    b.setAttribute('aria-pressed', si ? 'true' : 'false');
    b.title = si ? 'Lee las notas al pie, detrás de su párrafo. Toca para leer sólo el texto.'
      : 'Lee sólo el texto. Toca para leer también las notas al pie.';
  }

  /** Leer las notas o sólo el texto. Si está sonando, sigue sonando desde la
   *  misma frase; si sonaba una nota y ahora se callan, desde el párrafo
   *  siguiente. */
  function cambiaNotas(O) {
    const est = Voz.estado().estado;
    const suena = L.sonando === O && est !== 'parada';
    let pos = O.libro.pos || { p: 0, f: 0 };
    if (suena) {
      pos = posDe(O, Voz.estado().i);
    }
    const visto = primerVisible();
    O.libro.leeNotas = !leeNotas(O);
    Biblioteca.cambia(O.libro.id, { leeNotas: O.libro.leeNotas }).catch(() => {});
    if (callada(O, pos.p)) pos = { p: pos.p, f: 0, c: 0 };
    O.trozos = null;
    O.rangos = new Map();
    O.pal = null;
    prepara(O);
    const k = trozoDe(O, pos);
    pintaNotas(O);
    pintaTramo(O, L.tramo);
    if (suena && est === 'diciendo') {
      Voz.lee(O.trozos, k, { voz: Voz.estado().voz, vel: +A.vel || 1, titulo: O.libro.titulo });
    } else if (suena) {
      Voz.para();
      O.libro.pos = posDe(O, k);
      Biblioteca.cambia(O.libro.id, { pos: O.libro.pos }).catch(() => {});
    }
    // la vista se queda donde estaba (o en lo que sigue, si era una nota)
    let v = visto ?? pos.p;
    while (v < O.t.length - 1 && callada(O, v)) v++;
    if (L.sigue && suena) sigueALaVoz(false);
    else irA(v, false);
    aviso(leeNotas(O) ? 'Ahora lee también las notas, detrás de su párrafo.' : 'Ahora lee sólo el texto.');
  }

  /* -------------------------------------------------------------- la voz */

  /** Lee el libro desde la frase `k`. Si la voz no está bajada, lo dice y
   *  ofrece bajarla: leer no baja nunca nada por sorpresa. */
  async function empieza(O, k) {
    const voz = vozDe(O.libro.lengua);
    if (!voz) {
      aviso('No hay voz para «' + nombreLengua(O.libro.lengua) + '» todavía.', true);
      return;
    }
    if (L.hay[base(voz)] === undefined) {
      try { L.hay[base(voz)] = await Voz.hay(voz); } catch (_) { L.hay[base(voz)] = false; }
    }
    if (!L.hay[base(voz)]) { pideVoz(voz); return; }
    prepara(O);
    L.sigue = true;
    const bs = $('#b-sigue');
    if (bs) bs.hidden = true;
    if (L.sonando === O && Voz.estado().estado !== 'parada' && Voz.estado().voz === voz) {
      Voz.ve(k);
    } else {
      L.sonando = O;
      aviso('Preparando la voz…');
      Voz.lee(O.trozos, k, { voz: voz, vel: +A.vel || 1, titulo: O.libro.titulo });
    }
  }

  function dice(O) {
    const e = Voz.estado().estado;
    if (L.sonando === O && e === 'diciendo') Voz.pausa();
    else if (L.sonando === O && e === 'pausada') Voz.sigue();
    else empieza(O, trozoDe(O, O.libro.pos));
  }

  function salta(O, d) {
    if (L.sonando === O && Voz.estado().estado !== 'parada') {
      L.sigue = true;
      Voz.ve(Voz.estado().i + d);
      return;
    }
    const k = Math.max(0, Math.min(trozoDe(O, O.libro.pos) + d, O.trozos.length - 1));
    empieza(O, k);
  }

  /** Tocar el texto: lee desde la frase tocada. */
  function toca(O, ev) {
    const el = ev.target.closest('[data-i]');
    if (!el) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;   // estaba seleccionando
    const p = +el.dataset.i;
    let off = 0;
    const c = document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY)
      : null;
    if (c && el.contains(c.startContainer)) off = c.startOffset;
    const r = rangos(O, p);
    let f = 0;
    r.forEach((x, j) => { if (off >= x[0]) f = j; });
    empieza(O, O.primero[p] + f);
  }

  /* El aviso flota sobre la página: se va solo al rato, para no tapar el
   * texto (los de «Preparando…» se quitan al empezar a sonar). */
  let _aviso = 0;
  function aviso(t, malo) {
    const a = $('#voz-aviso');
    if (!a) return;
    a.textContent = t || '';
    a.className = malo ? 'mal' : 'nota';
    clearTimeout(_aviso);
    if (t && !/…$/.test(t)) {
      _aviso = setTimeout(() => { if (a.textContent === t) a.textContent = ''; }, malo ? 12000 : 6000);
    }
  }

  function pintaEstado() {
    // las ondas de la biblioteca se mueven sólo mientras dice
    document.body.classList.toggle('diciendo', Voz.estado().estado === 'diciendo');
    const b = $('#b-dice');
    if (!b) return;
    const diciendo = L.sonando === L.vista && Voz.estado().estado === 'diciendo';
    if (b.classList.contains('diciendo') !== diciendo || !b.firstChild) b.innerHTML = ico(diciendo ? 'pausa' : 'play');
    b.classList.toggle('diciendo', diciendo);
    b.setAttribute('aria-label', diciendo ? 'Pausa' : 'Leer');
  }

  /** Comprueba, al abrir un libro, si su voz está bajada: así tocar un
   *  párrafo no tiene que esperar a preguntarlo. */
  function miraLaVoz(O) {
    const voz = vozDe(O.libro.lengua);
    if (!voz) {
      aviso('No hay voz para «' + nombreLengua(O.libro.lengua) + '» todavía: se puede leer, pero no oír.');
      return;
    }
    if (L.hay[base(voz)] !== undefined) return;
    Voz.hay(voz).then((h) => {
      L.hay[base(voz)] = h;
      if (!h && L.vista === O) aviso('La voz de este libro no está bajada todavía. Toca ▶ para bajarla.');
    }).catch(() => {});
  }

  function pideVoz(voz) {
    const d = $('#d-voz');
    $('#dv-nombre').textContent = rotuloVoz(voz);
    $('#dv-estado').textContent = 'La primera vez se bajan además 29 MB del motor, '
      + 'comunes a todas las voces. Mejor con wifi. Después lee sin conexión.';
    $('#dv-estado').className = 'nota';
    const barra = $('#dv-barra');
    barra.hidden = true;
    const b = $('#dv-baja');
    b.disabled = false;
    b.onclick = async () => {
      b.disabled = true;
      barra.hidden = false;
      try {
        await Voz.baja(voz, (p) => {
          $('#dv-estado').textContent = 'Bajando… ' + mb(p.hecho)
            + (p.total > p.hecho ? ' de ' + mb(p.total) : '');
          barra.firstElementChild.style.width = p.total
            ? Math.min(100, (100 * p.hecho) / p.total) + '%' : '5%';
        });
        L.hay[base(voz)] = true;
        d.close();
        aviso('Voz lista. Toca ▶ o cualquier párrafo.');
      } catch (err) {
        $('#dv-estado').textContent = 'No se pudo bajar: ' + (err.message || err);
        $('#dv-estado').className = 'mal';
        b.disabled = false;
      }
    };
    d.showModal();
  }

  /* --------------------------------------------- lo que dice la voz */

  Voz.on('trozo', (k) => {
    const O = L.sonando;
    if (!O || !O.trozos[k]) return;
    O.libro.pos = posDe(O, k);
    Biblioteca.cambia(O.libro.id, { pos: O.libro.pos }).catch(() => {});
    compruebaSueno(O, k);
    if (L.vista === O) {
      resalta(O, k);
      if (L.sigue) sigueALaVoz(true);
    }
  });

  Voz.on('suena', () => { if (L.vista === L.sonando) aviso(''); });

  Voz.on('estado', (e) => {
    pintaEstado();
    if (e === 'parada' && window.CSS && CSS.highlights) CSS.highlights.delete('suena');
  });

  Voz.on('error', (err) => {
    const m = (err && err.message) || String(err);
    if (/no está bajada/.test(m) && L.sonando) L.hay[base(vozDe(L.sonando.libro.lengua))] = false;
    aviso('La voz ha fallado: ' + m, true);
  });

  Voz.on('fin', () => aviso('Fin del libro.'));

  /** Resalta la frase `k`, si su párrafo está pintado. */
  function resalta(O, k) {
    const viejo = $('.sonando');
    if (viejo) viejo.classList.remove('sonando');
    const p = O.trozos[k].parrafo;
    const el = $('[data-i="' + p + '"]');
    if (!el) return null;
    el.classList.add('sonando');
    const r = rangos(O, p)[k - O.primero[p]];
    const txt = el.firstChild;
    if (!r || !txt || !window.CSS || !CSS.highlights || !window.Highlight) return null;
    const rg = document.createRange();
    rg.setStart(txt, r[0]);
    rg.setEnd(txt, r[1]);
    CSS.highlights.set('suena', new Highlight(rg));
    return rg;
  }

  /** Pone en pantalla la frase que suena: cambia de tramo si ha pasado al
   *  siguiente, y desplaza si se ha salido de lo que se ve. */
  function sigueALaVoz(suave) {
    const O = L.vista;
    if (!O || L.sonando !== O || Voz.estado().estado === 'parada') return;
    const k = Voz.estado().i;
    const p = O.trozos[k].parrafo;
    if (tramoDe(O, p) !== L.tramo) { pintaTramo(O, tramoDe(O, p)); suave = false; }
    pintaCapitulo(O, p, posDe(O, k).c);
    const el = $('[data-i="' + p + '"]');
    if (!el) return;
    const rg = resalta(O, k);
    if (enPaginas()) {
      // por páginas: se pasa a la página de la frase, si no es la que se ve
      const r = (rg && rg.getClientRects()[0]) || el.getClientRects()[0];
      const n = r ? paginaDeX(r.left) : P.pagina;
      if (n !== P.pagina) muestra(n, suave);
      P.ancla = { p: p, c: posDe(O, k).c };
      return;
    }
    const caja = (rg || el).getBoundingClientRect();
    const arriba = ($('.cabeza') || { offsetHeight: 0 }).offsetHeight;
    const abajo = window.innerHeight - (($('.mandos') || { offsetHeight: 0 }).offsetHeight);
    if (caja.top >= arriba + 8 && caja.bottom <= abajo - 8) return;
    const y = window.scrollY + caja.top - arriba - (abajo - arriba) * 0.3;
    window.scrollTo({ top: Math.max(0, y), behavior: suave ? 'smooth' : 'auto' });
  }

  function dejaDeSeguir() {
    if (L.sonando !== L.vista || Voz.estado().estado === 'parada') return;
    L.sigue = false;
    const b = $('#b-sigue');
    if (!b) return;
    b.hidden = false;
    const m = $('.mandos');
    b.style.bottom = ((m && m.offsetHeight) || 0) + 18 + 'px';
  }

  // el dedo en la pantalla mientras lee: quiere mirar otra cosa, y la vista
  // deja de ir detrás de la voz hasta que pida volver (por páginas, eso es
  // pasar de página: lo ve pasaPagina)
  ['touchmove', 'wheel'].forEach((n) => window.addEventListener(n, () => {
    if (!L.vista || enPaginas()) return;
    L.mueve = true;
    dejaDeSeguir();
  }, { passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && L.vista && L.sigue) sigueALaVoz(false);
  });

  /* Sin voz, la posición es lo que se está mirando: el primer párrafo a la
   * vista, apuntado un momento después de dejar de desplazar. */
  function primerVisible() {
    const art = $('#texto');
    if (!art) return null;
    if (enPaginas()) {
      const a = anclaDe(P.pagina);
      return a ? a.p : null;
    }
    const arriba = ($('.cabeza') || { offsetHeight: 0 }).offsetHeight;
    for (const el of art.querySelectorAll('[data-i]:not([hidden])')) {
      if (el.getBoundingClientRect().bottom > arriba + 4) return +el.dataset.i;
    }
    return null;
  }

  let _apunta = 0;
  function apuntaVista() {
    clearTimeout(_apunta);
    _apunta = setTimeout(() => {
      L.mueve = false;
      const O = L.vista;
      if (!O || (L.sonando === O && Voz.estado().estado !== 'parada')) return;
      let pos;
      if (enPaginas() && P.ancla) {
        // por páginas, la frase con que empieza la página: ▶ lee desde ahí
        const a = P.ancla;
        let f = 0;
        if (!callada(O, a.p)) rangos(O, a.p).forEach((x, j) => { if (a.c >= x[0]) f = j; });
        pos = { p: a.p, f: f, c: a.c };
      } else {
        const p = primerVisible();
        if (p === null) return;
        pos = { p: p, f: 0, c: 0 };
      }
      pintaCapitulo(O, pos.p, pos.c);
      const ya = O.libro.pos;
      if (ya && ya.p === pos.p && ya.f === pos.f && (ya.c || 0) === pos.c) return;
      O.libro.pos = pos;
      Biblioteca.cambia(O.libro.id, { pos: O.libro.pos }).catch(() => {});
    }, 700);
  }

  // sólo lo que mueve el dedo: los saltos de la propia app ya lo apuntan, y
  // abrir el libro no tiene que mover la posición guardada
  window.addEventListener('scroll', () => {
    if (L.vista && L.mueve) apuntaVista();
  }, { passive: true });

  /* ------------------------------------------------------------ ajustes */

  function pintaAjustes() {
    const lenguas = Object.keys(Voz.LENGUAS);
    vista.innerHTML = '<main class="ajustes">'
      + '<header class="portadilla vuelta"><a class="boton icono" href="#/" aria-label="Biblioteca" '
      + 'title="Biblioteca">' + ico('atras') + '</a><div><h1>Ajustes</h1>'
      + '<p class="sub">Las voces se bajan una vez y quedan en el teléfono.</p></div></header>'
      + '<h2 class="seccion">La voz</h2>'
      + '<section class="tarjeta"><h3 class="titulo-tarjeta">' + ico('velocidad') + 'Velocidad</h3>'
      + '<div class="ajuste-vel">'
      + '<button type="button" id="b-lento" class="icono" aria-label="Más despacio" title="Más despacio">'
      + ico('menos') + '</button>'
      + '<input type="range" id="a-vel" min="' + VELS[0] + '" max="' + VELS[VELS.length - 1]
      + '" step="0.1" aria-label="Velocidad">'
      + '<button type="button" id="b-rapido" class="icono" aria-label="Más deprisa" title="Más deprisa">'
      + ico('mas') + '</button>'
      + '<output id="vel" for="a-vel" aria-live="polite"></output></div></section>'
      + '<section class="tarjeta"><h3 class="titulo-tarjeta">' + ico('onda') + 'Voces</h3>'
      + '<p class="nota">Una por lengua: la del libro decide cuál suena. El motor '
      + '(29 MB) es común a todas y se baja con la primera.</p>'
      + lenguas.map((l) => '<div class="lengua" data-l="' + l + '">'
        + '<div class="lengua-cabeza"><label class="campo" for="a-voz-' + l + '">' + esc(Voz.LENGUAS[l])
        + '</label><span class="sello-voz"></span></div>'
        + '<select id="a-voz-' + l + '">'
        + Voz.VOCES.filter((v) => v[2] === l).map((v) => '<option value="' + v[0] + '">'
          + esc(v[1]) + '</option>').join('')
        + '</select><p class="nota estado"></p>'
        + '<div class="barra" hidden><div></div></div>'
        + '<div class="botones"><button type="button" class="baja" hidden>' + ico('descarga')
        + 'Bajar</button>'
        + '<button type="button" class="quita-voz" hidden>' + ico('quita') + 'Quitarla</button></div></div>').join('')
      + '</section>'
      + '<h2 class="seccion">El aspecto</h2>'
      + '<section class="tarjeta"><h3 class="titulo-tarjeta">' + ico('tema') + 'Tema</h3>'
      + '<div class="temas" data-ajuste="tema">' + botonesTema() + '</div>'
      + '<p class="nota">La letra, los renglones y leer por páginas o de corrido: '
      + 'con el botón <b class="aa">Aa</b>, dentro del libro.</p></section>'
      + '<h2 class="seccion">Tus libros</h2>'
      + '<section class="tarjeta" id="a-nube"></section>'
      + '<section class="tarjeta"><h3 class="titulo-tarjeta">' + ico('disco') + 'Espacio</h3>'
      + '<div id="a-espacio"><p class="nota">…</p></div></section>'
      + '<p class="nota pie-ajustes"><a href="pruebas.html">Pruebas de voz</a> · '
      + '<a href="privacidad.html">Privacidad</a></p>'
      + '</main>';

    // la velocidad: la cinta, o un paso con − y + (como en el libro)
    const vel = $('#a-vel');
    vel.addEventListener('input', () => {
      A.vel = Math.round(+vel.value * 10) / 10;
      guardaAjustes();
      pintaVelocidad();
    });
    vel.addEventListener('change', () => {
      if (Voz.estado().estado !== 'parada') Voz.cambia({ vel: A.vel });
    });
    $('#b-lento').addEventListener('click', () => ponVelocidad(-1));
    $('#b-rapido').addEventListener('click', () => ponVelocidad(+1));
    pintaVelocidad();
    const temas = $('.ajustes .temas');
    const marcaTema = () => temas.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.v === (A.tema || 'auto') ? 'true' : 'false'));
    temas.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-v]');
      if (!b) return;
      A.tema = b.dataset.v;
      guardaAjustes();
      aplicaAspecto();
      marcaTema();
    });
    marcaTema();

    lenguas.forEach((l) => {
      const caja = $('.lengua[data-l="' + l + '"]');
      const sel = $('select', caja);
      sel.value = vozDe(l);
      const pintaUna = async () => {
        const voz = sel.value;
        const est = $('.estado', caja);
        const sello = $('.sello-voz', caja);
        if (L.hay[base(voz)] === undefined) {
          sello.className = 'sello-voz';
          sello.textContent = 'Mirando…';
          try { L.hay[base(voz)] = await Voz.hay(voz); } catch (_) { L.hay[base(voz)] = false; }
        }
        if (sel.value !== voz) return;
        const hay = L.hay[base(voz)];
        est.className = 'nota estado';
        est.textContent = '';
        sello.className = 'sello-voz' + (hay ? ' si' : '');
        sello.innerHTML = hay ? ico('hecho') + 'Bajada' : 'Sin bajar';
        $('.baja', caja).hidden = hay;
        $('.quita-voz', caja).hidden = !hay;
      };
      sel.addEventListener('change', () => {
        A.voces[l] = sel.value;
        guardaAjustes();
        pintaUna();
      });
      $('.baja', caja).addEventListener('click', async (ev) => {
        const b = ev.currentTarget;   // no ev.target: puede ser el icono
        const voz = sel.value;
        const barra = $('.barra', caja);
        const est = $('.estado', caja);
        b.disabled = true;
        barra.hidden = false;
        try {
          await Voz.baja(voz, (p) => {
            est.textContent = 'Bajando… ' + mb(p.hecho) + (p.total > p.hecho ? ' de ' + mb(p.total) : '');
            barra.firstElementChild.style.width = p.total
              ? Math.min(100, (100 * p.hecho) / p.total) + '%' : '5%';
          });
          L.hay[base(voz)] = true;
        } catch (err) {
          est.className = 'mal estado';
          est.textContent = 'No se pudo bajar: ' + (err.message || err);
          b.disabled = false;
          barra.hidden = true;
          return;
        }
        b.disabled = false;
        barra.hidden = true;
        pintaUna();
        espacio();
      });
      $('.quita-voz', caja).addEventListener('click', async () => {
        const voz = sel.value;
        if (!confirm('¿Quitar la voz «' + rotuloVoz(voz) + '»? Habría que volver a bajarla para oír libros en '
          + Voz.LENGUAS[l] + '.')) return;
        if (L.sonando && Voz.estado().voz && base(Voz.estado().voz) === base(voz)) Voz.para();
        await Voz.quita(voz);
        L.hay[base(voz)] = false;
        pintaUna();
        espacio();
      });
      pintaUna();
    });
    pintaAjustesNube();
    espacio();
  }

  /** La tarjeta de Google Drive en Ajustes. */
  async function pintaAjustesNube() {
    const el = $('#a-nube');
    if (!el) return;
    const e = Nube.estado();
    let h = '<h3 class="titulo-tarjeta">' + ico('nube') + 'Sincronizar con Google Drive</h3>'
      + '<p class="nota">Los libros que abras aquí salen también en tus otros aparatos, '
      + 'con la frase por la que vas, sus marcadores y notas, y tus colecciones. Se guardan '
      + 'en una carpeta oculta de tu Drive que '
      + 'sólo ve Lector. Sin conexión todo sigue igual: se pone al día después. '
      + '<a href="privacidad.html">Privacidad</a>.</p>';
    if (!e.disponible) {
      h += '<p class="nota">Todavía no se puede: falta el ID de cliente de Google (Plan.md §6).</p>';
    } else if (!e.conectada) {
      h += (e.error ? '<p class="mal">' + esc(e.error) + '</p>' : '')
        + '<div class="botones"><button type="button" class="principal" id="a-conecta"'
        + (e.aviso ? ' disabled' : '') + '>' + (e.aviso ? esc(e.aviso) : 'Conectar con Google')
        + '</button></div>';
    } else {
      const solo = [];
      for (const l of await Biblioteca.libros()) {
        if (!l.huella && !(await Biblioteca.archivo(l.id))) solo.push(l.titulo);
      }
      h += '<p>' + (e.aviso ? esc(e.aviso) : e.trabajando ? 'Poniéndose al día…'
        : e.error ? '<span class="mal">' + esc(e.error) + '</span>'
          : e.ultima ? 'Al día ' + haceCuanto(e.ultima) + '.' : 'Conectado.') + '</p>'
        + (e.permiso ? '' : '<p class="nota">El permiso de Google dura una hora; al tocar '
          + 'Sincronizar se renueva, sin preguntar nada.</p>')
        + (solo.length ? '<p class="nota">Sólo en este aparato, porque se abrieron antes de '
          + 'sincronizar: ' + solo.map((t) => '«' + esc(t) + '»').join(', ')
          + '. Vuelve a abrir su archivo y se subirán, sin perder por dónde vas.</p>' : '')
        + '<div class="botones"><button type="button" class="principal" id="a-sincroniza"'
        + (e.trabajando ? ' disabled' : '') + '>' + ico('refresca') + 'Sincronizar ahora</button>'
        + '<button type="button" id="a-desconecta">Desconectar</button></div>'
        + '<p class="nota">Desconectar olvida la sesión en este aparato; los libros se quedan. '
        + 'Para borrar lo guardado en Drive: Drive → Configuración → Administrar aplicaciones '
        + '→ Lector → Eliminar datos ocultos.</p>';
    }
    if (e.falso) h += '<p class="nota">(En la computadora: Drive de mentira, herramientas/drive_falso.py.)</p>';
    if (!$('#a-nube')) return;
    el.innerHTML = h;
    const b = $('#a-conecta') || $('#a-sincroniza');
    if (b) b.addEventListener('click', () => Nube.ahora());
    const d = $('#a-desconecta');
    if (d) d.addEventListener('click', () => {
      if (confirm('¿Desconectar de Google Drive en este aparato? Los libros se quedan aquí.')) Nube.desconecta();
    });
  }

  async function espacio() {
    const el = $('#a-espacio');
    if (!el) return;
    try {
      const e = await navigator.storage.estimate();
      const fijo = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      el.innerHTML = '<p class="cifra-grande"><b>' + mb(e.usage || 0) + '</b>ocupan los libros y las voces</p>'
        + '<p class="nota">' + (fijo ? 'El navegador no los borrará para hacer sitio.'
          : 'El navegador podría borrarlos si se queda sin sitio: al guardar un libro se le pide que no.')
        + '</p>';
    } catch (_) {
      el.innerHTML = '<p class="nota">Este navegador no dice cuánto ocupa.</p>';
    }
  }

  /* ------------------------------------------------------------ arranque */

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sin service worker:', e));
  }
  // las letras (fuentes/) pueden llegar después de partir el libro en
  // páginas: con ellas cambian las medidas, y se vuelve a partir
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => remaqueta(true));
  /* La nube: lo que cambia en Drive se pinta; lo que suena no se toca. */
  Nube.on('estado', () => {
    const r = ruta();
    if (r.vista === 'biblioteca') pintaNube();
    else if (r.vista === 'ajustes') pintaAjustesNube();
  });
  Nube.on('cambio', async (ids) => {
    const r = ruta();
    if (r.vista === 'biblioteca') {
      if (!document.querySelector('dialog[open]')) pintaBiblioteca(r.coleccion);
    } else if (r.vista === 'libro' && L.vista && ids.includes(L.vista.libro.id)) {
      const O = L.vista;
      const l = await Biblioteca.libro(O.libro.id);
      if (!l || L.vista !== O) return;
      // la posición que llega de otro aparato: para la próxima vez que se toque ▶
      if (L.sonando !== O) Object.assign(O.libro, { pos: l.pos, leeNotas: l.leeNotas, cambiado: l.cambiado });
      // las marcas y notas hechas en otro aparato, a la vista
      const antes = JSON.stringify(O.libro.marcas || []);
      Object.assign(O.libro, { marcas: l.marcas || [], colecciones: l.colecciones || [] });
      if (JSON.stringify(O.libro.marcas) === antes) return;
      pintaMarcas(O);
      remaqueta(true);
      if ($('#d-indice').open) pintaListaMarcas(O);
    }
  });
  Nube.inicia({ ocupado: (id) => !!L.sonando && L.sonando.libro.id === id
    && Voz.estado().estado !== 'parada' });

  pinta();
})();
