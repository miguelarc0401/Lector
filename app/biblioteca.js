/* La biblioteca: los libros, guardados en el teléfono.
 *
 * En IndexedDB, en tres almacenes: `libros` lleva lo que la biblioteca
 * enseña de cada uno —título, portada, índice, por dónde va—, `textos` el
 * libro entero, que sólo se lee al abrirlo, y `archivos` el archivo tal como
 * se abrió, que es lo que se sube a Drive para que el libro salga en los
 * otros aparatos (nube.js). Así pintar la biblioteca no tiene que cargar
 * diez libros completos en memoria.
 *
 *  · libros: { id, titulo, autor, lengua, formato, archivo, portada (Blob),
 *              n (párrafos), indice: [{ t, p, hijos }], pos: { p, f, c },
 *              paginas: [[párrafo, letra, nombre?], …] (dónde empieza
 *              cada página; ver importar.js),
 *              notas (cuántas trae), leeNotas, anadido, abierto,
 *              huella (SHA-256 del archivo), cambiado (hora del último
 *              cambio de `pos` o `leeNotas`), nube (ya está en Drive) }
 *  · textos: { id, t: [párrafo, …], h: { índice: nivel de título },
 *              k: { índice: 1 si el párrafo es una nota al pie } }
 *  · archivos: { id, blob, nombre }
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
      const q = indexedDB.open('lector', 2);
      q.onupgradeneeded = () => {
        const db = q.result;
        if (!db.objectStoreNames.contains('libros')) db.createObjectStore('libros', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('textos')) db.createObjectStore('textos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('archivos')) db.createObjectStore('archivos', { keyPath: 'id' });
      };
      q.onsuccess = () => res(q.result);
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
    return Object.assign({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(ahora) + Math.random()),
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
      anadido: ahora,
      abierto: ahora,
      cambiado: 0
    }, campos);
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

  window.Biblioteca = { libros: libros, libro: libro, texto: texto, archivo: archivo,
    nuevo: nuevo, guarda: guarda, ponArchivo: ponArchivo, cambia: cambia,
    rebautiza: rebautiza, quita: quita, huella: huella };
})();
