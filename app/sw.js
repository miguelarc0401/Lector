/* Service worker: lo que hace que Lector abra sin conexión.
 *
 * Caché primero, como en Liturgicum: un libro se escucha justo donde no hay
 * cobertura. La caché se llama por la versión (version.js), que GitHub
 * Actions pone con el commit al publicar: cada versión nueva tira la caché
 * de la anterior y vuelve a llenarla.
 *
 * Sólo toca sus propias cachés, las `lector-*`. La de la voz, `voz-piper`,
 * la lleva piper.js, y es la misma que la de Liturgicum —las dos apps viven
 * en el mismo sitio—: la voz se baja una vez para las dos. Los libros no
 * están aquí sino en IndexedDB (biblioteca.js).
 *
 * En la computadora, al probar (localhost), va a la red primero: si no,
 * cada cambio pediría recargar dos veces.
 */
importScripts('version.js');

const CACHE = 'lector-' + (self.VERSION || 'sin-version');
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const FICHEROS = [
  './',
  'index.html',
  'estilos.css',
  'app.js',
  'voz.js',
  'biblioteca.js',
  'importar.js',
  'piper.js',
  'version.js',
  'manifest.webmanifest',
  'icono.svg',
  'icono-32.png',
  'icono-180.png',
  'icono-192.png'
];

/* Lo que no hace falta para abrir la app, después y sin esperarlo. */
const DESPUES = [
  'icono-512.png',
  'icono-maskable-512.png',
  'pruebas.html',
  'pruebas.js'
];

async function guarda(c, ficheros) {
  // de uno en uno: si falla un fichero suelto, el resto queda instalado
  await Promise.all(ficheros.map((f) =>
    c.add(new Request(f, { cache: 'reload' }))
      .catch((e) => console.warn('sin cachear:', f, e))));
}

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await guarda(c, FICHEROS);
    guarda(c, DESPUES);            // sin await: no retrasa la instalación
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== CACHE && k.startsWith('lector-')) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  ev.respondWith((async () => {
    if (!LOCAL) {
      const guardado = await caches.match(req, { ignoreSearch: true });
      if (guardado) return guardado;
    }
    try {
      const red = await fetch(req);
      if (red.ok) (await caches.open(CACHE)).put(req, red.clone());
      return red;
    } catch (e) {
      const guardado = await caches.match(req, { ignoreSearch: true });
      if (guardado) return guardado;
      // navegación sin red y sin caché: al menos que se abra la app
      if (req.mode === 'navigate') {
        const inicio = await caches.match('index.html');
        if (inicio) return inicio;
      }
      throw e;
    }
  })());
});
