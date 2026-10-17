/* La biblioteca: los libros, guardados en el teléfono.
 *
 * En IndexedDB, en dos almacenes: `libros` lleva lo que la biblioteca
 * enseña de cada uno —título, portada, índice, por dónde va— y `textos` el
 * libro entero, que sólo se lee al abrirlo. Así pintar la biblioteca no
 * tiene que cargar diez libros completos en memoria.
 *
 *  · libros: { id, titulo, autor, lengua, formato, archivo, portada (Blob),
 *              n (párrafos), indice: [{ t, p, hijos }], pos: { p, f },
 *              notas (cuántas trae), leeNotas, anadido, abierto }
 *  · textos: { id, t: [párrafo, …], h: { índice: nivel de título },
 *              k: { índice: 1 si el párrafo es una nota al pie } }
 *
 * `pos` es el párrafo y la frase dentro del párrafo: no el número de trozo,
 * que depende de cómo se parta el texto y puede cambiar de una versión a
 * otra de la app.
 */
(function () {
  'use strict';

  let _db = null;

  function abre() {
    if (_db) return _db;
    _db = new Promise((res, rej) => {
      const q = indexedDB.open('lector', 1);
      q.onupgradeneeded = () => {
        const db = q.result;
        if (!db.objectStoreNames.contains('libros')) db.createObjectStore('libros', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('textos')) db.createObjectStore('textos', { keyPath: 'id' });
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

  /** Un libro nuevo, con su texto: los dos o ninguno. */
  async function guarda(l, t) {
    const db = await abre();
    const tx = db.transaction(['libros', 'textos'], 'readwrite');
    tx.objectStore('libros').put(l);
    tx.objectStore('textos').put(Object.assign({ id: l.id }, t));
    await hecha(tx);
    // que el navegador no tire los libros para hacer sitio
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (_) { /* sin permiso: se guardan igual */ }
  }

  /** Cambia unos campos de un libro ya guardado (la posición, la hora en
   *  que se abrió) sin tocar lo demás. */
  async function cambia(id, campos) {
    const db = await abre();
    const tx = db.transaction('libros', 'readwrite');
    const st = tx.objectStore('libros');
    const l = await pide(st.get(id));
    if (l) st.put(Object.assign(l, campos));
    await hecha(tx);
    return l;
  }

  async function quita(id) {
    const db = await abre();
    const tx = db.transaction(['libros', 'textos'], 'readwrite');
    tx.objectStore('libros').delete(id);
    tx.objectStore('textos').delete(id);
    await hecha(tx);
  }

  window.Biblioteca = { libros: libros, libro: libro, texto: texto,
    guarda: guarda, cambia: cambia, quita: quita };
})();
