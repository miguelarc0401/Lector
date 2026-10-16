/* La voz de Piper, dentro del teléfono.
 *
 * Esto corre en un worker, aparte de la página: sintetizar es cuenta pura y
 * en el hilo de la página trabaría el desplazamiento mientras suena. La
 * página le pide un trozo de texto y él le devuelve el audio hecho, en WAV.
 *
 * Nada de lo que usa está en el repositorio. Son tres piezas de fuera:
 *  · onnxruntime-web, que es quien ejecuta la red (MIT), de cdnjs;
 *  · piper_phonemize, que pasa el texto a fonemas con espeak-ng, de jsDelivr
 *    —espeak-ng es GPL, y por eso se trae y no se copia aquí—;
 *  · y la voz misma, el modelo de rhasspy/piper-voices en Hugging Face.
 * Se bajan una vez, la primera, y quedan en la caché del navegador con su
 * propio nombre, aparte de la de la app: al publicar una versión nueva, el
 * service worker tira la suya y ésta se queda, que son noventa megas. Desde
 * entonces no se vuelve a pedir nada a la red: la voz habla sin conexión.
 *
 * Mensajes que entiende, todos con `id`, y contesta con el mismo `id`:
 *  · { tipo: 'hay', voz }       ¿está todo bajado para esta voz?
 *  · { tipo: 'baja', voz }      bájalo, avisando de cómo va ({ progreso })
 *  · { tipo: 'di', voz, hablante, texto, vel }   el audio, en `wav`
 *  · { tipo: 'borra', voz }     quita el modelo de esa voz de la caché
 */

const CACHE = 'voz-piper';
const ORT = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const FON = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/'
  + 'build/piper_phonemize';
const VOCES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

/* Las piezas que no dependen de la voz. El wasm de onnxruntime es el que va
 * con SIMD y sin hilos: hilos no puede haber —pedirían unas cabeceras que
 * GitHub Pages no pone—, y SIMD lo tiene cualquier teléfono de estos años. */
const COMUNES = [
  ORT + 'ort.wasm.min.js',
  ORT + 'ort-wasm-simd.wasm',
  FON + '.js',
  FON + '.wasm',
  FON + '.data'
];
/* Lo que mide cada una, para la barra de la descarga. Van escritas porque
 * jsDelivr no lo dice al preguntarle —manda los datos de espeak sin
 * medida— y la barra se quedaba dieciocho megas corta. Son versiones
 * fijadas: no cambian. */
const MIDEN = [142930, 10595041, 120714, 635212, 18077249];

/** La ruta de una voz dentro del repositorio: es_ES-davefx-medium vive en
 *  es/es_ES/davefx/medium/. */
function rutaVoz(voz) {
  const [loc, nombre, calidad] = voz.split('-');
  return VOCES + loc.slice(0, 2) + '/' + loc + '/' + nombre + '/' + calidad
    + '/' + voz + '.onnx';
}

function piezas(voz) {
  return COMUNES.concat([rutaVoz(voz) + '.json', rutaVoz(voz)]);
}

/* ------------------------------------------------------------ la caché */

async function guardadas(urls) {
  const c = await caches.open(CACHE);
  const r = [];
  for (const u of urls) r.push(!!(await c.match(u)));
  return r;
}

/** Una pieza, de la caché si está y de la red si no; y lo que viene de la
 *  red se guarda antes de devolverlo. `avisa(n)` recibe los bytes que van
 *  llegando, para la barra de la descarga. */
async function trae(url, avisa) {
  const c = await caches.open(CACHE);
  const hay = await c.match(url);
  if (hay) return hay.blob();
  const r = await fetch(url);
  if (!r.ok) throw new Error('la red responde ' + r.status);
  let blob;
  if (avisa && r.body) {
    const lector = r.body.getReader();
    const partes = [];
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      partes.push(value);
      avisa(value.length);
    }
    blob = new Blob(partes);
  } else {
    blob = await r.blob();
  }
  await c.put(url, new Response(blob, { headers: {
    'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream'
  } }));
  return blob;
}

/** Lo mismo, como dirección que se le puede dar a quien sólo sabe pedir
 *  por dirección (importScripts, el wasm de onnxruntime, el de espeak). */
async function direccion(url) {
  return URL.createObjectURL(await trae(url));
}

/* --------------------------------------------------- lo que se carga una vez */

let _base = null;       // onnxruntime y el fonetizador, cargados
let _voz = null;        // { nombre, cfg, sesion } de la voz cargada

function cargaBase() {
  if (_base) return _base;
  _base = (async () => {
    importScripts(await direccion(ORT + 'ort.wasm.min.js'));
    self.ort.env.wasm.numThreads = 1;
    self.ort.env.wasm.wasmPaths = {
      'ort-wasm-simd.wasm': await direccion(ORT + 'ort-wasm-simd.wasm'),
      // sin SIMD no se ha visto ninguno, pero si lo hay, que lo baje
      'ort-wasm.wasm': ORT + 'ort-wasm.wasm'
    };
    importScripts(await direccion(FON + '.js'));
    return {
      wasm: await direccion(FON + '.wasm'),
      data: await direccion(FON + '.data')
    };
  })();
  _base.catch(() => { _base = null; });
  return _base;
}

async function cargaVoz(nombre) {
  if (_voz && _voz.nombre === nombre) return _voz;
  await cargaBase();
  const cfg = JSON.parse(await (await trae(rutaVoz(nombre) + '.json')).text());
  const modelo = await (await trae(rutaVoz(nombre))).arrayBuffer();
  const sesion = await self.ort.InferenceSession.create(modelo,
    { executionProviders: ['wasm'] });
  if (_voz && _voz.sesion && _voz.sesion.release) _voz.sesion.release();
  _voz = { nombre: nombre, cfg: cfg, sesion: sesion };
  return _voz;
}

/* El fonetizador es un programa de línea de órdenes compilado a wasm: se le
 * da el texto en la entrada y escribe los fonemas en la salida. Se monta uno
 * por trozo, que es como lo usa quien lo compiló: montarlo cuesta poco, con
 * el wasm y los datos ya en memoria, y uno reutilizado arrastraría el estado
 * de espeak de una llamada a la siguiente. */
async function fonemas(texto, lengua) {
  const base = await cargaBase();
  let ids = null;
  let fallo = '';
  const m = await self.createPiperPhonemize({
    print: (s) => { try { ids = JSON.parse(s).phoneme_ids; } catch (_) {} },
    printErr: (s) => { fallo += s + '\n'; },
    locateFile: (u) => u.endsWith('.wasm') ? base.wasm
      : u.endsWith('.data') ? base.data : u
  });
  m.callMain(['-l', lengua, '--input', JSON.stringify([{ text: texto }]),
    '--espeak_data', '/espeak-ng-data']);
  if (!ids) throw new Error('espeak no ha dado fonemas' + (fallo ? ': ' + fallo : ''));
  return ids;
}

/* --------------------------------------------------------- decir un trozo */

/* El verso viene partido en renglones con un salto, y espeak lo toma por un
 * espacio: el salmo se diría de corrido. Donde el renglón acaba sin signo,
 * se le pone una coma, que es la pausa que el lector hace ahí. */
function conPausas(t) {
  return t.replace(/([^\s.,;:!?¡¿…])\s*\n\s*/g, '$1, ')
    .replace(/\s*\n\s*/g, ' ');
}

async function di(voz, hablante, texto, vel) {
  const v = await cargaVoz(voz);
  const t0 = performance.now();
  const ids = await fonemas(conPausas(texto), v.cfg.espeak.voice);
  const t1 = performance.now();
  const inf = v.cfg.inference || {};
  const ort = self.ort;
  const entrada = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)),
      [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
    // más velocidad es menos largo: la escala de duración va al revés
    scales: new ort.Tensor('float32', Float32Array.from([
      inf.noise_scale ?? 0.667,
      (inf.length_scale ?? 1) / (vel || 1),
      inf.noise_w ?? 0.8]))
  };
  const mapa = v.cfg.speaker_id_map || {};
  if (Object.keys(mapa).length) {
    const sid = hablante in mapa ? mapa[hablante] : 0;
    entrada.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid)]));
  }
  const salida = await v.sesion.run(entrada);
  const r = aWav(salida.output.data, v.cfg.audio.sample_rate);
  // lo que tarda cada mitad, para saber dónde se va el tiempo si no llega
  r.msFon = t1 - t0;
  r.msRed = performance.now() - t1;
  return r;
}

/** Las muestras en coma flotante, a un WAV de 16 bits. */
function aWav(pcm, hz) {
  const n = pcm.length;
  const b = new ArrayBuffer(44 + n * 2);
  const d = new DataView(b);
  const pon = (p, s) => {
    for (let i = 0; i < s.length; i++) d.setUint8(p + i, s.charCodeAt(i));
  };
  pon(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); pon(8, 'WAVEfmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, hz, true); d.setUint32(28, hz * 2, true);
  d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  pon(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    d.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return { wav: b, segundos: n / hz };
}

/* ------------------------------------------------------------ el correo */

/* De uno en uno: con dos trozos a la vez, los dos cargarían la voz y la red
 * se pisaría consigo misma. La página tampoco pide dos seguidos sin esperar,
 * pero el orden no puede depender de eso. */
let _cola = Promise.resolve();
self.onmessage = (ev) => { _cola = _cola.then(() => atiende(ev)); };

async function atiende(ev) {
  const q = ev.data || {};
  const responde = (r, transf) => self.postMessage(
    Object.assign({ id: q.id }, r), transf || []);
  try {
    if (q.tipo === 'hay') {
      const r = await guardadas(piezas(q.voz));
      responde({ ok: true, hay: r.every(Boolean) });
    } else if (q.tipo === 'baja') {
      const urls = piezas(q.voz);
      // lo que mide cada pieza, para dar la barra en megas y no en piezas
      let total = 0, hecho = 0, ultimo = 0;
      const ya = await guardadas(urls);
      for (let i = 0; i < urls.length; i++) {
        if (ya[i]) continue;
        if (i < MIDEN.length) { total += MIDEN[i]; continue; }
        // la voz sí se pregunta: Hugging Face da la medida
        try {
          const h = await fetch(urls[i], { method: 'HEAD' });
          total += +(h.headers.get('Content-Length') || 0);
        } catch (_) { /* sin medida: la barra irá a ojo */ }
      }
      for (let i = 0; i < urls.length; i++) {
        if (ya[i]) continue;
        await trae(urls[i], (n) => {
          hecho += n;
          if (hecho - ultimo > 256 * 1024) {
            ultimo = hecho;
            responde({ progreso: { hecho: hecho, total: total } });
          }
        });
      }
      responde({ ok: true });
    } else if (q.tipo === 'di') {
      // decir no baja nada: noventa megas no se piden por sorpresa a media
      // hora rezada y con los datos del teléfono. Eso se hace en Ajustes.
      if (!_voz || _voz.nombre !== q.voz) {
        if (!(await guardadas(piezas(q.voz))).every(Boolean)) {
          throw new Error('La voz no está bajada: se baja en Ajustes');
        }
      }
      const t0 = performance.now();
      const r = await di(q.voz, q.hablante, q.texto, q.vel);
      responde({ ok: true, wav: r.wav, segundos: r.segundos,
        ms: performance.now() - t0, msFon: r.msFon, msRed: r.msRed }, [r.wav]);
    } else if (q.tipo === 'borra') {
      const c = await caches.open(CACHE);
      await c.delete(rutaVoz(q.voz));
      await c.delete(rutaVoz(q.voz) + '.json');
      if (_voz && _voz.nombre === q.voz) _voz = null;
      responde({ ok: true });
    } else {
      responde({ ok: false, error: 'no sé qué es «' + q.tipo + '»' });
    }
  } catch (err) {
    responde({ ok: false, error: (err && err.message) || String(err) });
  }
}
