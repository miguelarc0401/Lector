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
  const A = Object.assign({ voces: {}, vel: 1 }, (() => {
    try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); }
    catch (_) { return {}; }
  })());

  function guardaAjustes() {
    try { localStorage.setItem(CLAVE, JSON.stringify(A)); } catch (_) { /* */ }
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
    urls: []         // portadas pintadas, para soltarlas
  };

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
    const fichas = libros.map((l) => {
      let tapa;
      if (l.portada) {
        const u = URL.createObjectURL(l.portada);
        L.urls.push(u);
        tapa = '<img src="' + u + '" alt="">';
      } else {
        tapa = '<span>' + esc((l.titulo || '?').trim().slice(0, 1).toUpperCase()) + '</span>';
      }
      const pos = (l.pos && l.pos.p) || 0;
      const pct = l.n ? Math.round((100 * pos) / l.n) : 0;
      const e = entradaDe({ plano: aplanaIndice(l.indice || []) }, pos);
      return '<li class="ficha">'
        + '<a class="libro" href="#/libro/' + encodeURIComponent(l.id) + '">'
        + '<div class="tapa">' + tapa + '</div>'
        + '<div class="datos"><b>' + esc(l.titulo) + '</b>'
        + (l.autor ? '<span class="nota">' + esc(l.autor) + '</span>' : '')
        + '<div class="barra"><div style="width:' + pct + '%"></div></div>'
        + '<span class="nota">' + (suena === l.id ? '<span class="vivo">' + (est === 'pausada' ? 'En pausa' : 'Sonando') + '</span> · ' : '')
        + pct + ' %' + (e ? ' · ' + esc(e.t) : '') + '</span></div></a>'
        + '<button type="button" class="quita" data-id="' + esc(l.id) + '" aria-label="Quitar «'
        + esc(l.titulo) + '»">×</button></li>';
    });
    vista.innerHTML = '<main>'
      + '<header class="portadilla"><div><h1>Lector</h1>'
      + '<p class="sub">Libros en voz alta, sin conexión.</p></div>'
      + '<a class="boton" href="#/ajustes">Ajustes</a></header>'
      + '<div class="botones"><label class="boton principal">Abrir un libro'
      + '<input type="file" id="archivo" hidden accept=".epub,.txt,.md,application/epub+zip,text/plain,text/markdown">'
      + '</label></div>'
      + '<p class="nota" id="importa-estado">' + esc(textoImporta()) + '</p>'
      + '<div id="nube" class="nube" hidden></div>'
      + (fichas.length ? '<ul class="fichas">' + fichas.join('') + '</ul>'
        : '<section class="tarjeta"><h2>Todavía no hay libros</h2><p>Abre un '
          + 'EPUB o un TXT: se guarda aquí, con su índice, y se puede escuchar '
          + 'sin conexión desde cualquier párrafo.</p></section>')
      + '</main>';

    pintaNube();
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

    vista.innerHTML = '<header class="cabeza">'
      + '<a class="boton icono" href="#/" aria-label="Biblioteca">←</a>'
      + '<div class="rotulos"><b>' + esc(O.libro.titulo) + '</b>'
      + '<span id="capitulo" class="nota"></span></div>'
      + (O.hayNotas ? '<button type="button" class="boton" id="b-notas"></button>' : '')
      + '<button type="button" class="boton" id="b-indice">Índice</button></header>'
      + '<main class="lectura"><article id="texto" class="texto" lang="'
      + esc(O.libro.lengua || 'es') + '"></article></main>'
      + '<button type="button" id="b-sigue" class="boton principal flota" hidden>Ir a lo que suena</button>'
      + '<footer class="mandos"><p id="voz-aviso" class="nota" aria-live="polite"></p>'
      + '<div class="fila">'
      + '<button type="button" id="b-atras" aria-label="Frase anterior">⏮</button>'
      + '<button type="button" id="b-dice" class="principal grande" aria-label="Leer">▶</button>'
      + '<button type="button" id="b-adelante" aria-label="Frase siguiente">⏭</button>'
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
    $('#texto').addEventListener('click', (ev) => toca(O, ev));

    const suenaEste = L.sonando === O && Voz.estado().estado !== 'parada';
    L.sigue = true;
    const p = suenaEste ? O.trozos[Voz.estado().i].parrafo : (O.libro.pos || {}).p || 0;
    pintaTramo(O, tramoDe(O, p));
    pintaEstado();
    if (suenaEste) sigueALaVoz(false);
    else irA(p, false);
    miraLaVoz(O);
  }

  function pintaTramo(O, i) {
    const art = $('#texto');
    if (!art) return;
    const tr = O.tramos[i];
    L.tramo = i;
    const f = document.createDocumentFragment();
    if (i > 0) f.appendChild(botonTramo(O, i - 1, '← '));
    for (let p = tr.desde; p < tr.hasta; p++) {
      const n = O.h[p];
      const el = document.createElement(n ? (n === 1 ? 'h2' : n === 2 ? 'h3' : 'h4') : 'p');
      el.dataset.i = p;
      el.textContent = O.t[p];
      if (O.k[p]) {
        el.className = 'nota-pie';
        el.hidden = callada(O, p);
      }
      f.appendChild(el);
    }
    if (i < O.tramos.length - 1) f.appendChild(botonTramo(O, i + 1, '', ' →'));
    art.replaceChildren(f);
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

  function pintaCapitulo(O, p) {
    const c = $('#capitulo');
    if (!c) return;
    const e = entradaDe(O, p);
    c.textContent = e ? e.t : '';
  }

  /** Lleva la vista al párrafo `p` (pintando su tramo si hace falta). */
  function irA(p, suave) {
    const O = L.vista;
    if (!O) return;
    const t = tramoDe(O, p);
    if (t !== L.tramo) pintaTramo(O, t);
    const el = $('[data-i="' + p + '"]');
    if (el) el.scrollIntoView({ block: 'start', behavior: suave ? 'smooth' : 'auto' });
    else window.scrollTo(0, 0);
    pintaCapitulo(O, p);
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
      const k = Voz.estado().i;
      const p = O.trozos[k].parrafo;
      pos = { p: p, f: k - O.primero[p] };
    }
    const visto = primerVisible();
    O.libro.leeNotas = !leeNotas(O);
    Biblioteca.cambia(O.libro.id, { leeNotas: O.libro.leeNotas }).catch(() => {});
    if (callada(O, pos.p)) pos = { p: pos.p, f: 0 };
    O.trozos = null;
    O.rangos = new Map();
    prepara(O);
    const k = trozoDe(O, pos);
    pintaNotas(O);
    pintaTramo(O, L.tramo);
    if (suena && est === 'diciendo') {
      Voz.lee(O.trozos, k, { voz: Voz.estado().voz, vel: +A.vel || 1, titulo: O.libro.titulo });
    } else if (suena) {
      Voz.para();
      const p = O.trozos[k].parrafo;
      O.libro.pos = { p: p, f: k - O.primero[p] };
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

  function aviso(t, malo) {
    const a = $('#voz-aviso');
    if (!a) return;
    a.textContent = t || '';
    a.className = malo ? 'mal' : 'nota';
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
    const p = O.trozos[k].parrafo;
    O.libro.pos = { p: p, f: k - O.primero[p] };
    Biblioteca.cambia(O.libro.id, { pos: O.libro.pos }).catch(() => {});
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
    pintaCapitulo(O, p);
    const el = $('[data-i="' + p + '"]');
    if (!el) return;
    const rg = resalta(O, k);
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
    if (b) b.hidden = false;
  }

  // el dedo en la pantalla mientras lee: quiere mirar otra cosa, y la vista
  // deja de ir detrás de la voz hasta que pida volver
  ['touchmove', 'wheel'].forEach((n) => window.addEventListener(n, () => {
    if (!L.vista) return;
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
      const p = primerVisible();
      if (p === null) return;
      pintaCapitulo(O, p);
      if (O.libro.pos && O.libro.pos.p === p) return;
      O.libro.pos = { p: p, f: 0 };
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
      + [['0.8', 'Más despacio'], ['0.9', 'Un poco más despacio'], ['1', 'Normal'],
        ['1.1', 'Un poco más deprisa'], ['1.25', 'Más deprisa'], ['1.5', 'Mucho más deprisa']]
        .map(([v, r]) => '<option value="' + v + '">' + r + '</option>').join('')
      + '</select></section>'
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
