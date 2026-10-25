/* La biblioteca: los libros, guardados en el teléfono.
 *
 * En IndexedDB, en cuatro almacenes: `libros` lleva lo que la biblioteca
 * enseña de cada uno —título, portada, índice, por dónde va—, `textos` el
 * libro entero, que sólo se lee al abrirlo, y `archivos` el archivo tal como
 * se abrió, que es lo que se sube a Drive para que el libro salga en los
 * otros aparatos (nube.js). Así pintar la biblioteca no tiene que cargar
 * diez libros completos en memoria. `colecciones` son las carpetas en que
 * se ordenan los libros, unas dentro de otras.
 *
 *  · libros: { id, titulo, autor, lengua, formato, archivo, portada (Blob),
 *              n (párrafos), indice: [{ t, p, hijos }], pos: { p, f, c },
 *              paginas: [[párrafo, letra, nombre?], …] (dónde empieza
 *              cada página; ver importar.js),
 *              notas (cuántas trae), leeNotas, anadido, abierto,
 *              huella (SHA-256 del archivo), cambiado (hora del último
 *              cambio de `pos` o `leeNotas`), nube (ya está en Drive),
 *              marcas: [{ id, tipo: 'marca'|'nota', p, c, fin: { p, c }
 *              (sólo las notas: dónde acaba el trozo), cita, texto (lo
 *              escrito en la nota), hecho, cambiado }],
 *              quitadas: { id de marca: hora en que se quitó },
 *              colecciones: [id de colección, …],
 *              colTiempos: { id de colección: hora en que entró o salió } }
 *  · textos: { id, t: [párrafo, …], h: { índice: nivel de título },
 *              k: { índice: 1 si el párrafo es una nota al pie } }
 *  · archivos: { id, blob, nombre }
 *  · colecciones: { id, nombre, padre (la colección de encima, o ''),
 *              creada, cambiado }, o { id, quitada: hora } si se quitó
 *
 * Un libro puede estar en varias colecciones; la colección no apunta a sus
 * libros, es el libro el que dice en cuáles está. Así quitar un libro se
 * lleva consigo sus colecciones y sus marcas, y no queda nada colgando.
 *
 * Las colecciones y las marcas viajan a Drive en un solo archivo (nube.js,
 * ponOrden), que se mezcla pieza a pieza con lo de cada aparato: gana el
 * cambio más reciente de cada marca, de cada colección y de cada «este
 * libro está en esta colección». Por eso se apunta la hora de cada cambio,
 * y lo que se quita no se borra del todo: queda la hora en que se quitó
 * (`quitadas`, `quitada`), para que se quite también en los otros aparatos
 * y no vuelva con la próxima mezcla.
 *
 * `pos` es el párrafo y la frase dentro del párrafo: no el número de trozo,
 * que depende de cómo se parta el texto y puede cambiar de una versión a
 * otra de la app. `c`, la letra del párrafo en que empieza esa frase, es
 * sólo para saber en qué página se va; no viaja a Drive.
 *
 * Los libros abiertos antes de la versión 2 no tienen archivo ni huella:
 * se quedan sólo en su aparato hasta que se vuelve a abrir su archivo.
 */
(function () {
  'use strict';

  let _db = null;

  function abre() {
    if (_db) return _db;
    _db = new Promise((res, rej) => {
      const q = indexedDB.open('lector', 3);
      q.onupgradeneeded = () => {
        const db = q.result;
        for (const n of ['libros', 'textos', 'archivos', 'colecciones']) {
          if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
        }
      };
      q.onsuccess = () => {
        // otra pestaña con una versión nueva de la app quiere cambiar los
        // almacenes: se le deja, y ésta vuelve a abrir la base al pedirla
        q.result.onversionchange = () => { q.result.close(); _db = null; };
        res(q.result);
      };
      q.onerror = () => rej(q.error);
    });
    _db.catch(() => { _db = null; });
    return _db;
  }

  function hecha(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('no se pudo guardar'));
    });
  }

  function pide(q) {
    return new Promise((res, rej) => {
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }

  /** Todos los libros, el último abierto primero. */
  async function libros() {
    const db = await abre();
    const r = await pide(db.transaction('libros').objectStore('libros').getAll());
    return r.sort((a, b) => (b.abierto || b.anadido) - (a.abierto || a.anadido));
  }

  async function libro(id) {
    const db = await abre();
    return pide(db.transaction('libros').objectStore('libros').get(id));
  }

  async function texto(id) {
    const db = await abre();
    return pide(db.transaction('textos').objectStore('textos').get(id));
  }

  /** El archivo original de un libro ({ id, blob, nombre }), si lo hay. */
  async function archivo(id) {
    const db = await abre();
    return pide(db.transaction('archivos').objectStore('archivos').get(id));
  }

  /** La ficha de un libro nuevo, de lo que devuelve `Importa.archivo` y lo
   *  que se elige al guardarlo (título, autor, lengua…). */
  function nuevo(r, campos) {
    const ahora = Date.now();
    const l = Object.assign({
      id: nuevoId(),
      titulo: r.titulo,
      autor: r.autor || '',
      lengua: r.lengua || 'es',
      formato: r.formato,
      archivo: '',
      portada: r.portada,
      n: r.t.length,
      notas: Object.keys(r.k || {}).length,
      leeNotas: false,
      indice: r.indice,
      paginas: r.paginas || null,
      pos: { p: 0, f: 0 },
      marcas: [],
      quitadas: {},
      colecciones: [],
      anadido: ahora,
      abierto: ahora,
      cambiado: 0
    }, campos);
    // las colecciones en que entra al abrirlo, con su hora
    if (!l.colTiempos) {
      l.colTiempos = {};
      l.colecciones.forEach((c) => { l.colTiempos[c] = ahora; });
    }
    return l;
  }

  /** Un id nuevo: para un libro, una colección o una marca. */
  function nuevoId() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  }

  /** Un libro nuevo, con su texto y su archivo: todo o nada. */
  async function guarda(l, t, arch) {
    const db = await abre();
    const tx = db.transaction(['libros', 'textos', 'archivos'], 'readwrite');
    tx.objectStore('libros').put(l);
    tx.objectStore('textos').put(Object.assign({ id: l.id }, t));
    if (arch) tx.objectStore('archivos').put({ id: l.id, blob: arch, nombre: l.archivo || '' });
    await hecha(tx);
    // que el navegador no tire los libros para hacer sitio
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (_) { /* sin permiso: se guardan igual */ }
  }

  /** Guarda el archivo de un libro que ya estaba (abierto antes de que se
   *  guardaran los archivos), con su huella. */
  async function ponArchivo(id, blob, nombre, huella) {
    const db = await abre();
    const tx = db.transaction(['libros', 'archivos'], 'readwrite');
    const st = tx.objectStore('libros');
    const l = await pide(st.get(id));
    if (l) {
      st.put(Object.assign(l, { huella: huella, archivo: nombre || l.archivo }));
      tx.objectStore('archivos').put({ id: id, blob: blob, nombre: nombre || l.archivo || '' });
    }
    await hecha(tx);
    return l;
  }

  /** Cambia unos campos de un libro ya guardado (la posición, la hora en
   *  que se abrió) sin tocar lo demás. Si cambian la posición o las notas,
   *  apunta la hora (`cambiado`), que es lo que compara la sincronización,
   *  y lo avisa con el evento `lector-cambia`; quien ya trae su `cambiado`
   *  (la sincronización misma) no avisa. */
  async function cambia(id, campos) {
    const avisa = ('pos' in campos || 'leeNotas' in campos) && !('cambiado' in campos);
    if (avisa) campos = Object.assign({ cambiado: Date.now() }, campos);
    const db = await abre();
    const tx = db.transaction('libros', 'readwrite');
    const st = tx.objectStore('libros');
    const l = await pide(st.get(id));
    if (l) st.put(Object.assign(l, campos));
    await hecha(tx);
    if (l && avisa) window.dispatchEvent(new CustomEvent('lector-cambia', { detail: { id: id } }));
    return l;
  }

  /** Le da a un libro otro id (el que tiene ese mismo libro en Drive). */
  async function rebautiza(viejo, nuevoId) {
    const db = await abre();
    const tx = db.transaction(['libros', 'textos', 'archivos'], 'readwrite');
    for (const n of ['libros', 'textos', 'archivos']) {
      const st = tx.objectStore(n);
      const x = await pide(st.get(viejo));
      if (!x) continue;
      st.put(Object.assign(x, { id: nuevoId }));
      st.delete(viejo);
    }
    await hecha(tx);
  }

  async function quita(id) {
    const db = await abre();
    const tx = db.transaction(['libros', 'textos', 'archivos'], 'readwrite');
    tx.objectStore('libros').delete(id);
    tx.objectStore('textos').delete(id);
    tx.objectStore('archivos').delete(id);
    await hecha(tx);
  }

  /** La huella de un archivo: SHA-256 en hexadecimal. Es lo que dice que
   *  dos libros son el mismo, aunque se abrieran en aparatos distintos. */
  async function huella(blob) {
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ------------------------------------------- colecciones y marcas */

  /** Avisa de que ha cambiado lo que viaja en el archivo de orden (las
   *  colecciones y las marcas), para que la nube lo mande. Lo que llega de
   *  la nube misma (aplicaOrden) no avisa. */
  const avisaOrden = () => window.dispatchEvent(new CustomEvent('lector-orden'));

  /** Todas las colecciones (sin las quitadas), sin ordenar: el árbol lo
   *  arma app.js. */
  async function colecciones() {
    const db = await abre();
    const r = await pide(db.transaction('colecciones').objectStore('colecciones').getAll());
    return r.filter((c) => !c.quitada);
  }

  /** Una colección nueva, dentro de `padre` (o arriba del todo). */
  async function nuevaColeccion(nombre, padre) {
    const c = { id: nuevoId(), nombre: nombre, padre: padre || '', creada: Date.now() };
    await guardaColeccion(c);
    return c;
  }

  /** Guarda una colección (con otro nombre, o en otro sitio), con la hora
   *  del cambio. */
  async function guardaColeccion(c) {
    c.cambiado = Date.now();
    const db = await abre();
    const tx = db.transaction('colecciones', 'readwrite');
    tx.objectStore('colecciones').put(c);
    await hecha(tx);
    avisaOrden();
  }

  /** Quita unas colecciones y saca de ellas a sus libros, que se quedan en
   *  la biblioteca. Quien llama da también las de dentro. */
  async function quitaColecciones(ids) {
    const fuera = new Set(ids);
    const ahora = Date.now();
    const db = await abre();
    const tx = db.transaction(['colecciones', 'libros'], 'readwrite');
    ids.forEach((id) => tx.objectStore('colecciones').put({ id: id, quitada: ahora }));
    const st = tx.objectStore('libros');
    for (const l of await pide(st.getAll())) {
      const cs = l.colecciones || [];
      if (cs.some((c) => fuera.has(c))) st.put(Object.assign(l, { colecciones: cs.filter((c) => !fuera.has(c)) }));
    }
    await hecha(tx);
    avisaOrden();
  }

  /** En qué colecciones está un libro. Las que entran o salen apuntan la
   *  hora (`colTiempos`). */
  async function ponColecciones(id, lista) {
    const ahora = Date.now();
    const db = await abre();
    const tx = db.transaction('libros', 'readwrite');
    const st = tx.objectStore('libros');
    const l = await pide(st.get(id));
    if (l) {
      const antes = new Set(l.colecciones || []);
      const luego = new Set(lista);
      const t = Object.assign({}, l.colTiempos);
      new Set([...antes, ...luego]).forEach((c) => { if (antes.has(c) !== luego.has(c)) t[c] = ahora; });
      st.put(Object.assign(l, { colecciones: Array.from(luego), colTiempos: t }));
    }
    await hecha(tx);
    avisaOrden();
    return l;
  }

  /** Las marcas de un libro. Las que ya no están quedan apuntadas como
   *  quitadas, con su hora. */
  async function ponMarcas(id, marcas) {
    const ahora = Date.now();
    const db = await abre();
    const tx = db.transaction('libros', 'readwrite');
    const st = tx.objectStore('libros');
    const l = await pide(st.get(id));
    if (l) {
      const siguen = new Set(marcas.map((m) => m.id));
      const q = Object.assign({}, l.quitadas);
      (l.marcas || []).forEach((m) => { if (!siguen.has(m.id)) q[m.id] = ahora; });
      st.put(Object.assign(l, { marcas: marcas, quitadas: q }));
    }
    await hecha(tx);
    avisaOrden();
    return l;
  }

  /** JSON con las claves en orden: para comparar sin que importe en qué
   *  orden se pusieron. */
  const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((o, n) => { o[n] = v[n]; return o; }, {}) : v));

  /** Lo de un libro como viaja: { marcas: { id: marca }, quitadas,
   *  en: { colección: [1 si está, hora] } }. */
  function ordenDe(l) {
    const marcas = {};
    (l.marcas || []).forEach((m) => { marcas[m.id] = m; });
    const t = l.colTiempos || {};
    const cs = l.colecciones || [];
    const en = {};
    new Set([...cs, ...Object.keys(t)]).forEach((c) => { en[c] = [cs.includes(c) ? 1 : 0, t[c] || 0]; });
    return { marcas: marcas, quitadas: Object.assign({}, l.quitadas), en: en };
  }

  /** Todo lo que viaja en el archivo de orden: { colecciones: { id: { nombre,
   *  padre, creada, cambiado } }, quitadas: { id: hora }, libros: { id: lo
   *  de ese libro (ordenDe) } }. */
  async function orden() {
    const db = await abre();
    const tx = db.transaction(['colecciones', 'libros']);
    const [cs, ls] = await Promise.all([pide(tx.objectStore('colecciones').getAll()),
      pide(tx.objectStore('libros').getAll())]);
    const r = { colecciones: {}, quitadas: {}, libros: {} };
    for (const c of cs) {
      if (c.quitada) r.quitadas[c.id] = c.quitada;
      else r.colecciones[c.id] = { nombre: c.nombre, padre: c.padre || '', creada: c.creada || 0,
        cambiado: c.cambiado || c.creada || 0 };
    }
    for (const l of ls) {
      const o = ordenDe(l);
      if (Object.keys(o.marcas).length || Object.keys(o.quitadas).length || Object.keys(o.en).length) {
        r.libros[l.id] = o;
      }
    }
    return r;
  }

  /** Deja aquí lo que vino mezclado de la nube (con el formato de orden()).
   *  Sólo escribe lo que cambia, y no avisa. Devuelve los libros que han
   *  cambiado y si han cambiado las colecciones. */
  async function aplicaOrden(d) {
    const db = await abre();
    const tx = db.transaction(['colecciones', 'libros'], 'readwrite');
    const sc = tx.objectStore('colecciones');
    const sl = tx.objectStore('libros');
    const ya = new Map((await pide(sc.getAll())).map((c) => [c.id, c]));
    let cols = false;
    for (const [id, x] of Object.entries(d.colecciones || {})) {
      const c = { id: id, nombre: x.nombre, padre: x.padre || '', creada: x.creada || 0, cambiado: x.cambiado || 0 };
      if (!ya.has(id) || canon(ya.get(id)) !== canon(c)) { sc.put(c); cols = true; }
    }
    for (const [id, t] of Object.entries(d.quitadas || {})) {
      if (!ya.has(id) || ya.get(id).quitada !== t) { sc.put({ id: id, quitada: t }); cols = true; }
    }
    const vivas = new Set(Object.keys(d.colecciones || {}));
    const libros = [];
    for (const l of await pide(sl.getAll())) {
      const x = (d.libros || {})[l.id];
      if (!x) continue;
      const en = x.en || {};
      const colTiempos = {};
      Object.keys(en).forEach((c) => { colTiempos[c] = en[c][1]; });
      const nuevo = { marcas: Object.values(x.marcas || {}), quitadas: x.quitadas || {},
        colecciones: Object.keys(en).filter((c) => en[c][0] && vivas.has(c)), colTiempos: colTiempos };
      // comparado como viaja, y con las colecciones que siguen: el orden no cuenta
      const antes = ordenDe(Object.assign({}, l, { colecciones: (l.colecciones || []).filter((c) => vivas.has(c)) }));
      if (canon(antes) !== canon(ordenDe(nuevo))) {
        sl.put(Object.assign(l, nuevo));
        libros.push(l.id);
      }
    }
    await hecha(tx);
    return { libros: libros, colecciones: cols };
  }

  window.Biblioteca = { libros: libros, libro: libro, texto: texto, archivo: archivo,
    nuevo: nuevo, nuevoId: nuevoId, guarda: guarda, ponArchivo: ponArchivo, cambia: cambia,
    rebautiza: rebautiza, quita: quita, huella: huella,
    colecciones: colecciones, nuevaColeccion: nuevaColeccion, guardaColeccion: guardaColeccion,
    quitaColecciones: quitaColecciones, ponColecciones: ponColecciones, ponMarcas: ponMarcas,
    orden: orden, aplicaOrden: aplicaOrden, canon: canon };
})();
