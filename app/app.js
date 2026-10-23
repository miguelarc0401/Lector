/* Lector: la biblioteca, la vista de lectura y los ajustes.
 *
 * Tres vistas, por la dirección:
 *  · #/            la biblioteca, y abrir un libro nuevo
 *  · #/libro/<id>  el libro: su texto por tramos, su índice y la voz
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

  /* Un tramo no pasa de estos párrafos: si un capítulo es más largo, se
   * parte por sus secciones, y si no las tiene, a pedazos de esta medida. */
  const TRAMO = 500;

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
  }

  function guardaAjustes() {
    try { localStorage.setItem(CLAVE, JSON.stringify(A)); } catch (_) { /* */ }
  }

  /* El aspecto: el tema vale para toda la app; la letra, los renglones y
   * los márgenes, para el texto del libro (variables de estilos.css). */
  const FUENTES = {
    serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  };
  const INTERLINEAS = { junta: 1.45, normal: 1.65, amplia: 1.9 };
  const MARGENES = { estrecho: '.9rem', normal: '1.4rem', ancho: '2.6rem' };
  const LETRAS = [80, 90, 100, 110, 120, 135, 150, 170, 190];

  function aplicaAspecto() {
    const r = document.documentElement;
    if (A.tema && A.tema !== 'auto') r.dataset.tema = A.tema;
    else delete r.dataset.tema;
    const l = A.lec;
    r.style.setProperty('--fuente', FUENTES[l.fuente] || FUENTES.serif);
    r.style.setProperty('--letra', (1.15 * (l.letra || 100) / 100).toFixed(3) + 'rem');
    r.style.setProperty('--interlinea', INTERLINEAS[l.interlinea] || INTERLINEAS.normal);
    r.style.setProperty('--margen', MARGENES[l.margen] || MARGENES.normal);
    r.style.setProperty('--alinea', l.justifica === 'no' ? 'left' : 'justify');
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
    ro: null         // el que mira el tamaño de la hoja, en páginas
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
    return { vista: 'biblioteca' };
  }

  async function pinta() {
    const r = ruta();
    L.vista = null;
    L.tramo = -1;
    document.body.dataset.vista = r.vista;
    document.body.classList.remove('paginas', 'inmersivo');
    if (L.ro) { L.ro.disconnect(); L.ro = null; }
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (window.CSS && CSS.highlights) CSS.highlights.delete('suena');
    try {
      if (r.vista === 'libro') await pintaLibro(r.id);
      else if (r.vista === 'ajustes') pintaAjustes();
      else await pintaBiblioteca();
    } catch (err) {
      console.error(err);
      vista.innerHTML = '<main><p class="mal">' + esc(err.message || err) + '</p>'
        + '<p><a href="#/">← Biblioteca</a></p></main>';
    }
  }

  window.addEventListener('hashchange', pinta);

  /* --------------------------------------------------------- biblioteca */

  async function pintaBiblioteca() {
    L.urls.forEach((u) => URL.revokeObjectURL(u));
    L.urls = [];
    const libros = await Biblioteca.libros();
    const est = Voz.estado().estado;
    const suena = L.sonando && est !== 'parada' ? L.sonando.libro.id : null;
    const tapaDe = (l) => {
      if (!l.portada) return '<span>' + esc((l.titulo || '?').trim().slice(0, 1).toUpperCase()) + '</span>';
      const u = URL.createObjectURL(l.portada);
      L.urls.push(u);
      return '<img src="' + u + '" alt="">';
    };
    const fichas = libros.map((l) => {
      const tapa = tapaDe(l);
      const pos = (l.pos && l.pos.p) || 0;
      const pct = l.n ? Math.round((100 * pos) / l.n) : 0;
      const pag = pagina(l.paginas, pos, (l.pos && l.pos.c) || 0);
      const e = entradaDe({ plano: aplanaIndice(l.indice || []) }, pos);
      return '<li class="ficha">'
        + '<a class="libro" href="#/libro/' + encodeURIComponent(l.id) + '">'
        + '<div class="tapa">' + tapa + '</div>'
        + '<div class="datos"><b>' + esc(l.titulo) + '</b>'
        + (l.autor ? '<span class="nota">' + esc(l.autor) + '</span>' : '')
        + '<div class="barra"><div style="width:' + pct + '%"></div></div>'
        + '<span class="nota">' + (suena === l.id ? '<span class="vivo">' + (est === 'pausada' ? 'En pausa' : 'Sonando') + '</span> · ' : '')
        + pct + ' %' + (pag ? ' · ' + esc(pag) : '') + (e ? ' · ' + esc(e.t) : '') + '</span></div></a>'
        + '<button type="button" class="quita" data-id="' + esc(l.id) + '" aria-label="Quitar «'
        + esc(l.titulo) + '»">×</button></li>';
    });
    // el último que se abrió, en grande, para seguir con un toque
    const ult = libros.find((l) => l.abierto);
    let seguir = '';
    if (ult) {
      const pos = (ult.pos && ult.pos.p) || 0;
      const pct = ult.n ? Math.round((100 * pos) / ult.n) : 0;
      const pag = pagina(ult.paginas, pos, (ult.pos && ult.pos.c) || 0);
      const e = entradaDe({ plano: aplanaIndice(ult.indice || []) }, pos);
      seguir = '<a class="seguir" href="#/libro/' + encodeURIComponent(ult.id) + '">'
        + '<div class="tapa">' + tapaDe(ult) + '</div>'
        + '<div class="datos"><span class="rotulo">'
        + (suena === ult.id ? (est === 'pausada' ? 'En pausa' : 'Sonando') : 'Seguir leyendo') + '</span>'
        + '<b>' + esc(ult.titulo) + '</b>'
        + (e ? '<span class="nota donde">' + esc(e.t) + '</span>' : '')
        + '<div class="barra"><div style="width:' + pct + '%"></div></div>'
        + '<span class="nota">' + pct + ' %' + (pag ? ' · ' + esc(pag) : '') + '</span>'
        + '<span class="boton principal">▶ Seguir</span></div></a>';
    }
    vista.innerHTML = '<main>'
      + '<header class="portadilla"><div><h1>Lector</h1>'
      + '<p class="sub">Libros en voz alta, sin conexión.</p></div>'
      + '<a class="boton" href="#/ajustes">Ajustes</a></header>'
      + seguir
      + '<div class="botones"><label class="boton' + (seguir ? '' : ' principal') + '">Abrir un libro'
      + '<input type="file" id="archivo" hidden accept=".epub,.txt,.md,application/epub+zip,text/plain,text/markdown">'
      + '</label></div>'
      + '<p class="nota" id="importa-estado">' + esc(textoImporta()) + '</p>'
      + '<div id="nube" class="nube" hidden></div>'
      + (fichas.length ? '<h2 class="biblio-titulo">Biblioteca</h2><ul class="fichas">' + fichas.join('') + '</ul>'
        : '<section class="tarjeta"><h2>Todavía no hay libros</h2><p>Abre un '
          + 'EPUB o un TXT: se guarda aquí, con su índice, y se puede escuchar '
          + 'sin conexión desde cualquier párrafo.</p></section>')
      + '</main>';

    pintaNube();
    sinPaginas(libros);
    $('#archivo').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (f) importa(f);
    });
    vista.querySelectorAll('.quita').forEach((b) => b.addEventListener('click', async () => {
      const l = libros.find((x) => x.id === b.dataset.id);
      if (!l) return;
      const como = await preguntaQuitar(l);
      if (!como) return;
      if (L.sonando && L.sonando.libro.id === l.id) { Voz.para(); L.sonando = null; }
      await Nube.quita(l, como === 'todos');
      pinta();
    }));
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
    el.innerHTML = '<span class="' + (e.error ? 'mal' : 'nota') + '">' + esc(t) + '</span>'
      + '<button type="button" id="b-nube"' + (e.trabajando ? ' disabled' : '') + '>☁ Sincronizar</button>';
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

  async function importa(file) {
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
        huella: huella
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
      + '<a class="boton icono" href="#/" aria-label="Biblioteca">←</a>'
      + '<div class="rotulos"><b>' + esc(O.libro.titulo) + '</b>'
      + '<span id="capitulo" class="nota"></span></div>'
      + (O.hayNotas ? '<button type="button" class="boton" id="b-notas"></button>' : '')
      + '<button type="button" class="boton icono" id="b-indice" aria-label="Índice" title="Índice">☰</button>'
      + '</header>'
      + '<main class="lectura">'
      + '<div id="cornisa" class="cornisa" title="Ver sólo la página, o los mandos"></div>'
      + '<div id="hoja"><article id="texto" class="texto" lang="'
      + esc(O.libro.lengua || 'es') + '"></article></div>'
      + '<div id="folio" class="folio" title="Ver sólo la página, o los mandos"></div></main>'
      + '<button type="button" id="b-sigue" class="boton principal flota" hidden>Ir a lo que suena</button>'
      + '<footer class="mandos"><p id="voz-aviso" class="nota" aria-live="polite"></p>'
      + '<div class="avance"><span id="av-pag"></span>'
      + '<input type="range" id="avance" min="0" max="' + Math.max(0, O.t.length - 1)
      + '" step="1" aria-label="Avance en el libro"><span id="av-pct"></span></div>'
      + '<div class="fila">'
      + '<button type="button" id="b-sueno" class="lado" aria-label="Temporizador: apagar la voz dentro de un rato" title="Temporizador">☾</button>'
      + '<button type="button" id="b-atras" aria-label="Frase anterior">⏮</button>'
      + '<button type="button" id="b-dice" class="principal grande" aria-label="Leer">▶</button>'
      + '<button type="button" id="b-adelante" aria-label="Frase siguiente">⏭</button>'
      + '<button type="button" id="b-aspecto" class="lado" aria-label="Aspecto: páginas, letra y tema" title="Aspecto">Aa</button>'
      + '</div><div class="fila velocidad">'
      + '<button type="button" id="b-lento" aria-label="Más despacio">−</button>'
      + '<span id="vel" aria-live="polite"></span>'
      + '<button type="button" id="b-rapido" aria-label="Más deprisa">+</button>'
      + '</div></footer>';

    $('#b-indice').addEventListener('click', () => abreIndice(O));
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
    if (i > 0 && !pag) f.appendChild(botonTramo(O, i - 1, '← '));
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
    if (i < O.tramos.length - 1 && !pag) f.appendChild(botonTramo(O, i + 1, '', ' →'));
    art.replaceChildren(f);
    maqueta();
    pintaCapitulo(O, tr.desde);
    if (L.sonando === O && Voz.estado().estado !== 'parada') resalta(O, Voz.estado().i);
  }

  function botonTramo(O, i, antes, despues) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tramo';
    const e = entradaDe(O, O.tramos[i].desde);
    b.textContent = (antes || '') + (e ? e.t : 'Sigue') + (despues || '');
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
    if (av && !L.arrastra) av.value = p;
    $('#av-pag').textContent = pag.replace(/\/.*$/, '');
    $('#av-pct').textContent = pct + ' %';
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
  function muestra(n, anima) {
    const art = $('#texto');
    if (!art || !enPaginas()) return;
    P.pagina = Math.max(0, Math.min(P.total - 1, n));
    const x = -P.pagina * P.paso;
    const desde = P.x;
    cancelAnimationFrame(_desliza);
    if (!anima || desde === x) { corre(art, x); return; }
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
    d.innerHTML = '<div><b>‹</b>Página anterior</div>'
      + '<div class="medio"><span>Toca una frase<br>para oírla desde ahí</span>'
      + '<span>Toca el número de página<br>para ver sólo la página</span>'
      + '<button type="button" class="principal">Entendido</button></div>'
      + '<div><b>›</b>Página siguiente</div>';
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
      $('#da-letra').textContent = A.lec.letra + ' %';
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
    const op = [['cap', 'Al acabar el capítulo']]
      .concat([10, 20, 30, 45, 60, 90].map((m) => [String(m), 'Dentro de ' + m + ' min']))
      .concat(s ? [['no', 'Quitar el temporizador']] : []);
    ul.innerHTML = op.map((x) => {
      const yo = s && ((x[0] === 'cap' && s.parrafo !== undefined) || String(s.min) === x[0]);
      return '<li><button type="button" data-v="' + x[0] + '"' + (yo ? ' aria-pressed="true"' : '')
        + '>' + esc(x[1]) + '</button></li>';
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
      b.textContent = '☾';
      b.classList.remove('activo');
      return;
    }
    b.classList.add('activo');
    b.textContent = L.sueno.hasta
      ? '☾ ' + Math.max(1, Math.ceil((L.sueno.hasta - Date.now()) / 60000)) + '′'
      : '☾ cap.';
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
    d.showModal();
    const act = $('.actual', lista);
    if (act) act.scrollIntoView({ block: 'center' });
  }

  /* ------------------------------------------------------------ las notas */

  function pintaNotas(O) {
    const b = $('#b-notas');
    if (!b) return;
    const si = leeNotas(O);
    b.textContent = si ? 'Con notas' : 'Sin notas';
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
    const b = $('#b-dice');
    if (!b) return;
    const diciendo = L.sonando === L.vista && Voz.estado().estado === 'diciendo';
    b.textContent = diciendo ? '⏸' : '▶';
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
    vista.innerHTML = '<main>'
      + '<header class="portadilla"><div><h1>Ajustes</h1>'
      + '<p class="sub">Las voces se bajan una vez y quedan en el teléfono.</p></div>'
      + '<a class="boton" href="#/">← Biblioteca</a></header>'
      + '<section class="tarjeta"><h2>Velocidad</h2>'
      + '<select id="a-vel">'
      + VELS.concat(VELS.includes(+A.vel || 1) ? [] : [+A.vel])
        .sort((a, b) => a - b)
        .map((v) => '<option value="' + v + '">' + velTexto(v)
          + (v === 1 ? ' (normal)' : '') + '</option>').join('')
      + '</select></section>'
      + '<section class="tarjeta"><h2>Tema</h2>'
      + '<select id="a-tema">'
      + [['auto', 'Como el teléfono (claro u oscuro)'], ['claro', 'Claro'], ['sepia', 'Sepia'],
        ['oscuro', 'Oscuro'], ['noche', 'Noche (negro, para leer a oscuras)']]
        .map((x) => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('')
      + '</select><p class="nota">La letra, los renglones y leer por páginas o de corrido: '
      + 'con el botón Aa, dentro del libro.</p></section>'
      + '<section class="tarjeta"><h2>Voces</h2>'
      + '<p class="nota">Una por lengua: la del libro decide cuál suena. El motor '
      + '(29 MB) es común a todas y se baja con la primera.</p>'
      + lenguas.map((l) => '<div class="lengua" data-l="' + l + '">'
        + '<label class="campo" for="a-voz-' + l + '">' + esc(Voz.LENGUAS[l]) + '</label>'
        + '<select id="a-voz-' + l + '">'
        + Voz.VOCES.filter((v) => v[2] === l).map((v) => '<option value="' + v[0] + '">'
          + esc(v[1]) + '</option>').join('')
        + '</select><p class="nota estado"></p>'
        + '<div class="barra" hidden><div></div></div>'
        + '<div class="botones"><button type="button" class="baja" hidden>Bajar</button>'
        + '<button type="button" class="quita-voz" hidden>Quitarla</button></div></div>').join('')
      + '</section>'
      + '<section class="tarjeta" id="a-nube"></section>'
      + '<section class="tarjeta"><h2>Espacio</h2><p class="nota" id="a-espacio">…</p></section>'
      + '<p class="nota"><a href="pruebas.html">Pruebas de voz (Fase 0)</a></p>'
      + '</main>';

    const vel = $('#a-vel');
    vel.value = String(A.vel || 1);
    vel.addEventListener('change', () => {
      A.vel = +vel.value;
      guardaAjustes();
      if (Voz.estado().estado !== 'parada') Voz.cambia({ vel: A.vel });
    });
    const tema = $('#a-tema');
    tema.value = A.tema || 'auto';
    tema.addEventListener('change', () => {
      A.tema = tema.value;
      guardaAjustes();
      aplicaAspecto();
    });

    lenguas.forEach((l) => {
      const caja = $('.lengua[data-l="' + l + '"]');
      const sel = $('select', caja);
      sel.value = vozDe(l);
      const pintaUna = async () => {
        const voz = sel.value;
        const est = $('.estado', caja);
        if (L.hay[base(voz)] === undefined) {
          est.textContent = 'Mirando…';
          try { L.hay[base(voz)] = await Voz.hay(voz); } catch (_) { L.hay[base(voz)] = false; }
        }
        if (sel.value !== voz) return;
        est.className = 'nota estado';
        est.textContent = L.hay[base(voz)] ? 'Bajada.' : 'No está bajada.';
        $('.baja', caja).hidden = L.hay[base(voz)];
        $('.quita-voz', caja).hidden = !L.hay[base(voz)];
      };
      sel.addEventListener('change', () => {
        A.voces[l] = sel.value;
        guardaAjustes();
        pintaUna();
      });
      $('.baja', caja).addEventListener('click', async (ev) => {
        const b = ev.target;
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
    let h = '<h2>Sincronizar con Google Drive</h2>'
      + '<p class="nota">Los libros que abras aquí salen también en tus otros aparatos, '
      + 'con la frase por la que vas. Se guardan en una carpeta oculta de tu Drive que '
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
        + (e.trabajando ? ' disabled' : '') + '>☁ Sincronizar ahora</button>'
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
      el.textContent = 'Libros y voces ocupan ' + mb(e.usage || 0) + '. '
        + (fijo ? 'El navegador no los borrará para hacer sitio.'
          : 'El navegador podría borrarlos si se queda sin sitio: al guardar un libro se le pide que no.');
    } catch (_) {
      el.textContent = 'Este navegador no dice cuánto ocupa.';
    }
  }

  /* ------------------------------------------------------------ arranque */

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sin service worker:', e));
  }
  /* La nube: lo que cambia en Drive se pinta; lo que suena no se toca. */
  Nube.on('estado', () => {
    const r = ruta();
    if (r.vista === 'biblioteca') pintaNube();
    else if (r.vista === 'ajustes') pintaAjustesNube();
  });
  Nube.on('cambio', async (ids) => {
    const r = ruta();
    if (r.vista === 'biblioteca') {
      if (!document.querySelector('dialog[open]')) pintaBiblioteca();
    } else if (r.vista === 'libro' && L.vista && ids.includes(L.vista.libro.id)
      && L.sonando !== L.vista) {
      // la posición que llega de otro aparato: para la próxima vez que se toque ▶
      const l = await Biblioteca.libro(L.vista.libro.id);
      if (l && L.vista) Object.assign(L.vista.libro, { pos: l.pos, leeNotas: l.leeNotas, cambiado: l.cambiado });
    }
  });
  Nube.inicia({ ocupado: (id) => !!L.sonando && L.sonando.libro.id === id
    && Voz.estado().estado !== 'parada' });

  pinta();
})();
