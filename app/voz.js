/* La voz que lee el libro.
 *
 * Se le da una lista de trozos —frases, en orden— y lee desde el que se le
 * diga. La voz la hace Piper en el momento, en su worker (piper.js), y aquí
 * se le van pidiendo los trozos que vienen por delante del que suena. Lo
 * hecho vive sólo en memoria y se suelta en cuanto suena: en el disco no
 * queda nada más que la voz misma, bajada una vez.
 *
 * Lo de sonar con la pantalla apagada es lo de Liturgicum: cada trozo por
 * un <audio>, que es lo que el sistema respeta con la pantalla apagada; un
 * audio mudo en bucle que mantiene viva la página entre trozo y trozo; y
 * los mandos del volante y de los auriculares por MediaSession. Y ni un
 * temporizador: el adelanto avanza con las respuestas del worker y con el
 * fin de cada trozo, que llegan aunque la página esté escondida.
 *
 * De paso va midiendo lo que decide si esto sirve para un libro entero: a
 * qué ritmo hace la voz el teléfono con la pantalla encendida y con la
 * apagada, cuánto adelanto queda, y cuándo se quedó sin voz preparada.
 *
 * Por fuera es `Voz`, y el resto de la app no sabe que existe Piper: si un
 * día la voz la hace el teléfono por su cuenta (Plan.md, §5), cambia esto y
 * nada más.
 */
(function () {
  'use strict';

  /* Las voces, con lo que pesan. El motor son 29 MB más, la primera vez, y
   * lo comparten todas. Las de México y España son las de Liturgicum; las
   * demás están para los libros en otra lengua. La de sharvard son dos
   * hablantes en un mismo modelo, y se baja una vez para los dos. */
  const VOCES = [
    ['es_MX-claude-high', 'México · mujer · 63 MB', 'es'],
    ['es_MX-ald-medium', 'México · hombre · 63 MB', 'es'],
    ['es_MX-ald-x_low', 'México · hombre, ligera y rápida · 21 MB', 'es'],
    ['es_ES-sharvard-medium:F', 'España · mujer · 77 MB', 'es'],
    ['es_ES-sharvard-medium:M', 'España · hombre · la misma descarga', 'es'],
    ['es_ES-davefx-medium', 'España · hombre (2) · 63 MB', 'es'],
    ['es_ES-carlfm-x_low', 'España · hombre, la más rápida · 28 MB', 'es'],
    ['en_US-lessac-medium', 'Inglés · EE. UU. · ≈63 MB', 'en'],
    ['fr_FR-siwis-medium', 'Francés · mujer · ≈63 MB', 'fr'],
    ['it_IT-paola-medium', 'Italiano · mujer · 64 MB', 'it'],
    ['pt_BR-faber-medium', 'Portugués · Brasil · ≈63 MB', 'pt'],
    ['de_DE-thorsten-medium', 'Alemán · hombre · ≈63 MB', 'de']
  ];

  const LENGUAS = { es: 'Español', en: 'Inglés', fr: 'Francés',
    it: 'Italiano', pt: 'Portugués', de: 'Alemán' };

  /* El silencio que se le pone a cada trozo al final, dentro del propio
   * audio: así la pausa entre frases y la de fin de párrafo no piden un
   * temporizador, que con la pantalla apagada llegaría tarde. */
  const PAUSA = { frase: 0.12, parrafo: 0.55 };

  /* Un trozo no pasa de esta medida. Piper no tiene el defecto de Chrome
   * que obligaba en Liturgicum a 220, pero un trozo largo tarda en empezar a
   * sonar —al tocar un párrafo se espera a que esté hecho entero— y uno muy
   * corto pierde la entonación de la frase. */
  const LARGO = 280;

  /* Segundos de silencio de más a partir de los cuales una espera cuenta
   * como corte en el informe. */
  const CORTE = 0.3;

  function partes(id) {
    const [voz, hablante] = String(id).split(':');
    return { voz: voz, hablante: hablante || '' };
  }

  function lenguaDe(id) {
    const v = VOCES.find((x) => x[0] === id);
    return v ? v[2] : String(id).slice(0, 2);
  }

  /* ------------------------------------------------------------ el worker */

  // `cargada`: la voz que el worker ya tiene en memoria. El primer trozo de
  // otra voz tarda además lo que se tarda en cargarla, y ése no se mide.
  const W = { w: null, n: 0, esperan: new Map(), cargada: null };

  function trabajador() {
    if (W.w) return W.w;
    W.w = new Worker('piper.js');
    W.w.onmessage = (ev) => {
      const d = ev.data || {};
      const e = W.esperan.get(d.id);
      if (!e) return;
      if (d.progreso) { if (e.avisa) e.avisa(d.progreso); return; }
      W.esperan.delete(d.id);
      if (d.ok) e.res(d); else e.rej(new Error(d.error || 'Piper ha fallado'));
    };
    // el worker mismo se ha caído —no ha podido cargar lo que trae de
    // fuera—: se contesta que no a todo lo que esperaba, y el siguiente
    // pedido arranca uno nuevo
    W.w.onerror = (ev) => {
      const msg = (ev && ev.message) || 'Piper no ha arrancado';
      W.esperan.forEach((e) => e.rej(new Error(msg)));
      W.esperan.clear();
      W.w.terminate();
      W.w = null;
      W.cargada = null;
    };
    return W.w;
  }

  function pide(q, avisa) {
    return new Promise((res, rej) => {
      const id = ++W.n;
      W.esperan.set(id, { res: res, rej: rej, avisa: avisa });
      trabajador().postMessage(Object.assign({ id: id }, q));
    });
  }

  async function hay(id) {
    const r = await pide({ tipo: 'hay', voz: partes(id).voz });
    return !!r.hay;
  }

  async function baja(id, avisa) {
    // que el navegador no la tire para hacer sitio: volver a bajar noventa
    // megas a media lectura no es una opción
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (_) { /* sin permiso: se guarda igual, sólo que no blindada */ }
    await pide({ tipo: 'baja', voz: partes(id).voz }, avisa);
  }

  async function quita(id) {
    await pide({ tipo: 'borra', voz: partes(id).voz });
  }

  /** Dice un texto suelto y mide cuánto tarda. Dos veces: la primera carga
   *  la voz en memoria, y eso no es lo que tarda leyendo. */
  async function prueba(id, texto, vel) {
    const p = partes(id);
    const q = { tipo: 'di', voz: p.voz, hablante: p.hablante,
      texto: paraDecir(texto, lenguaDe(id)), vel: vel || 1 };
    await pide(q);
    W.cargada = p.voz;
    const r = await pide(q);
    return { segundos: r.segundos, ms: r.ms, msFon: r.msFon, msRed: r.msRed,
      blob: new Blob([r.wav], { type: 'audio/wav' }) };
  }

  /* ------------------------------------------------------ partir el texto */

  /** Un texto corrido, en trozos para decir: párrafos partidos en frases, y
   *  las frases largas partidas por donde se respira. Cada trozo dice si
   *  cierra párrafo, que es donde va la pausa larga. */
  function trocea(texto, lengua) {
    const limpio = String(texto).replace(/\r\n?/g, '\n');
    // párrafos separados por renglón en blanco; si el texto no trae ni uno,
    // cada renglón es un párrafo
    const parrafos = /\n\s*\n/.test(limpio)
      ? limpio.split(/\n\s*\n/)
      : limpio.split('\n');
    return deParrafos(parrafos.map((par) => par.replace(/-\n(?=\p{Ll})/gu, '')
      .replace(/\s+/g, ' ').trim()).filter(Boolean), lengua);
  }

  /** Lo mismo, de una lista de párrafos ya separados —los de un libro—: el
   *  `parrafo` de cada trozo es su lugar en la lista. Cada trozo es un
   *  pedazo literal de su párrafo, ya con los espacios apretados, para que
   *  quien lo enseña pueda encontrarlo y resaltarlo. */
  function deParrafos(lista, lengua) {
    const r = [];
    lista.forEach((par, p) => {
      const t = String(par).replace(/\s+/g, ' ').trim();
      if (!t) return;
      const fs = frases(t, lengua).flatMap(parte);
      fs.forEach((f, j) => r.push({ texto: f, parrafo: p, fin: j === fs.length - 1 }));
    });
    return r;
  }

  const _segmentadores = {};

  /* Abreviaturas tras las que el punto no cierra la frase: el segmentador
   * de Chrome corta en «Sr. Gómez» y la voz haría una pausa en medio. Y la
   * inicial suelta de un nombre, «J. R. Jiménez». */
  const ABREVIA = new RegExp('(?:^|\\s)(?:sr|sra|srta|d|dña|dr|dra|lic|ing|prof|'
    + 'sto|sta|fr|mons|gral|mr|mrs|ms|st|mme|mlle|hr|sig|vd|ud|uds|vds|art|'
    + 'núm|vol|cf|vs|et al|p\\. ?ej)\\.$', 'i');
  const INICIAL = /(?:^|\s)\p{Lu}\.$/u;

  function frases(t, lengua) {
    let r = null;
    if (window.Intl && Intl.Segmenter) {
      try {
        const l = lengua || 'es';
        const s = _segmentadores[l]
          || (_segmentadores[l] = new Intl.Segmenter(l, { granularity: 'sentence' }));
        r = Array.from(s.segment(t), (x) => x.segment.trim()).filter(Boolean);
      } catch (_) { /* esa lengua no la sabe: va la regla de abajo */ }
    }
    if (!r) {
      r = (t.match(/[^.!?…]+(?:[.!?…]+["'»”’)\]]*|$)/g) || [t])
        .map((x) => x.trim()).filter(Boolean);
    }
    // se vuelve a pegar lo que se partió tras una abreviatura: entre las dos
    // había un espacio y nada más, así que sigue siendo un pedazo literal
    const u = [];
    for (const f of r) {
      const ant = u[u.length - 1];
      if (ant && (ABREVIA.test(ant) || INICIAL.test(ant))) u[u.length - 1] += ' ' + f;
      else u.push(f);
    }
    return u;
  }

  function parte(f) {
    const r = [];
    while (f.length > LARGO) {
      const m = f.slice(0, LARGO);
      let c = -1;
      for (const re of [/[;:]\s/g, /,\s/g, /\s/g]) {
        let x, ult = -1;
        while ((x = re.exec(m))) ult = x.index + 1;
        if (ult > LARGO * 0.4) { c = ult; break; }
      }
      if (c < 0) c = LARGO;
      r.push(f.slice(0, c).trim());
      f = f.slice(c).trim();
    }
    if (f) r.push(f);
    return r;
  }

  /* ------------------------------------------------ decirlo como se lee */

  /* Los números romanos, como los dice quien lee en voz alta: «Felipe IV» es
   * «Felipe cuarto», «Juan XXII», «Juan veintidós», «siglo XIV», «siglo
   * catorce». Espeak los diría letra por letra. Sólo cambia lo que se le da
   * a Piper: el texto del trozo se queda tal cual, que es el que se resalta
   * en pantalla. */
  // sin \b, que no tiene por letras las acentuadas: la D de «Délicieux»
  // pasaría por un quinientos
  const ROMANO = /(?<![\p{L}\p{N}])(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?![\p{L}\p{N}])/gu;
  const VALOR = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

  function valor(r) {
    let n = 0;
    for (let i = 0; i < r.length; i++) {
      const v = VALOR[r[i]], s = VALOR[r[i + 1]] || 0;
      n += v < s ? -v : v;
    }
    return n;
  }

  const UNIDADES = ('cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce '
    + 'trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte veintiuno '
    + 'veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete veintiocho '
    + 'veintinueve').split(' ');
  const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta',
    'ochenta', 'noventa'];
  const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos',
    'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  /** Un número de 1 a 3999, en letra. */
  function enLetra(n) {
    if (n >= 1000) {
      const m = Math.floor(n / 1000), r = n % 1000;
      return (m === 1 ? 'mil' : enLetra(m) + ' mil') + (r ? ' ' + enLetra(r) : '');
    }
    if (n >= 100) {
      const r = n % 100;
      return (n === 100 ? 'cien' : CENTENAS[Math.floor(n / 100)]) + (r ? ' ' + enLetra(r) : '');
    }
    if (n < 30) return UNIDADES[n];
    return DECENAS[Math.floor(n / 10)] + (n % 10 ? ' y ' + UNIDADES[n % 10] : '');
  }

  const ORDINAL = ['', 'primer', 'segund', 'tercer', 'cuart', 'quint', 'sext', 'séptim',
    'octav', 'noven', 'décim'];

  /* Reyes, papas, concilios: ordinal hasta el diez («Clemente quinto»,
   * «Isabel segunda»), y de ahí en adelante el número («León trece»). */
  const ordinal = (n, fem) => (n <= 10 ? ORDINAL[n] + (fem ? 'a' : 'o') : enLetra(n));

  const FEMENINO = new Set(('juana isabel maría catalina margarita ana leonor cristina '
    + 'blanca urraca berenguela teresa beatriz constanza mafalda luisa carlota victoria '
    + 'sancha elena cruzada asamblea').split(' '));
  // tras estas palabras va el número, en letra: «capítulo tres», «siglo catorce»
  const CUENTA = new Set(('capítulo capítulos cap c parte partes tomo tomos t volumen '
    + 'volúmenes vol vols libro libros lib título tít sección canto acto apéndice número '
    + 'núm n siglo siglos s fase grado clase').split(' '));
  // y tras éstas, el ordinal: «concilio segundo de Lyón»
  const ORDEN = new Set('concilio concilios sínodo cruzada asamblea congreso'.split(' '));
  // con mayúscula por ir al principio de la frase, no por ser un nombre:
  // «Véase C. Wenck» no es ningún rey
  const NO_NOMBRE = new Set(('véase véanse ver cf según por con en de del y e o el la los '
    + 'las lo un una al a ante tras así pero sin sobre entre desde hasta para hacia como '
    + 'que cuando donde si no ni ya también después antes este esta estos estas').split(' '));

  function romanos(t) {
    let fin = -1, modo = '';
    return t.replace(ROMANO, (r, i) => {
      if (!r) return r;
      const n = valor(r);
      const antes = t.slice(0, i);
      const tras = t.slice(i + r.length);
      // la palabra de antes, con su punto si lo lleva («t.», «cap.»)
      const m = /([\p{L}]+)(\.?)\s*$/u.exec(antes);
      const palabra = m ? m[1] : '';
      const baja = palabra.toLowerCase();
      let dice = null;

      // «siglos XII y XIII», «Felipe IV y V»: el segundo, como el primero
      const enCadena = fin >= 0 && /^\s*(?:y|e|o|u|al|a|,|-|–)\s*$/.test(t.slice(fin, i));
      if (enCadena && modo) dice = modo;
      else if (/^[,-]\s?\d/.test(tras)) dice = 'n';               // cita: «III,240», «VI-2»
      // «c.IV», «t.III» sí; «C. V. Langlois» no, que son iniciales
      else if (m && CUENTA.has(baja) && (palabra.length > 1 || !/\s$/.test(antes))) dice = 'n';
      else if (m && !m[2] && ORDEN.has(baja)) dice = FEMENINO.has(baja) ? 'oa' : 'o';
      else if (m && !m[2] && palabra.length > 1 && /^\p{Lu}\p{Ll}/u.test(palabra)
        && !NO_NOMBRE.has(baja) && (r.length > 1 || /^[IVX]$/.test(r))) {
        dice = FEMENINO.has(baja) ? 'oa' : 'o';                   // «Clemente V», «Isabel II»
      } else if (/^\s*$/.test(antes) && /^\.(\s|$)/.test(tras) && /^[IVX]+$/.test(r)) {
        dice = 'n';                                               // «III. El proceso…»
      } else if (r.length > 1 && /^[IVXL]+$/.test(r)) {
        dice = 'n';                                               // suelto: el número
      }
      // una sola letra sin nada de lo anterior es más bien una inicial
      // («C. V. Langlois») o una palabra: se deja
      if (!dice) { fin = -1; modo = ''; return r; }
      fin = i + r.length;
      modo = dice;
      if (dice === 'n') return enLetra(n);
      return ordinal(n, dice === 'oa');
    });
  }

  /** Lo que se le da a Piper para que diga `texto`, en la lengua de la voz. */
  function paraDecir(texto, lengua) {
    if (lengua !== 'es') return texto;
    return romanos(texto);
  }

  /** El WAV de Piper con silencio al final. La cabecera es la de 44 bytes que
   *  escribe piper.js, y el silencio son ceros: basta con alargar el búfer y
   *  corregir las dos medidas. */
  function conSilencio(wav, seg) {
    const d = new DataView(wav);
    const hz = d.getUint32(24, true);
    const datos = d.getUint32(40, true);
    const extra = Math.round(hz * seg) * 2;
    const b = new ArrayBuffer(wav.byteLength + extra);
    new Uint8Array(b).set(new Uint8Array(wav));
    const e = new DataView(b);
    e.setUint32(4, 36 + datos + extra, true);
    e.setUint32(40, datos + extra, true);
    return b;
  }

  /* --------------------------------------------------------- el estado */

  const S = {
    trozos: [],
    i: 0,                 // el trozo que suena
    desde: 0,             // donde se empezó o se saltó: esperarlo no es corte
    estado: 'parada',     // parada | diciendo | pausada
    gen: 0,               // de qué tanda es lo que suena (ver ve)
    voz: VOCES[0][0],
    vel: 1,
    delante: 20 * 60,     // segundos de voz por delante, como mucho
    hechos: new Map(),    // k -> { p: promesa, r: lo hecho, cuando llega }
    adelantando: false,
    despierta: null,
    audio: null,          // el del trozo que suena, ya hecho
    cargando: 0,          // la tanda que espera a que su trozo esté hecho
    url: null,
    silencio: null,
    titulo: 'Lector',
    oyentes: {}
  };

  function on(que, fn) {
    (S.oyentes[que] = S.oyentes[que] || []).push(fn);
  }

  function emite(que, x) {
    (S.oyentes[que] || []).forEach((fn) => {
      try { fn(x); } catch (err) { console.error(err); }
    });
  }

  /* ------------------------------------------------------- lo que se mide */

  const CLAVE_INFORME = 'lector-informe-voz';
  let M = null;

  function nuevaMedida() {
    M = {
      inicio: Date.now(),
      aparato: navigator.userAgent,
      voz: S.voz,
      vel: S.vel,
      delante: S.delante,
      trozos: S.trozos.length,
      frases: 0,                 // las que han sonado enteras
      escuchado: { visible: 0, hidden: 0 },
      ritmo: { visible: { voz: 0, ms: 0, n: 0 }, hidden: { voz: 0, ms: 0, n: 0 } },
      cortes: [],                // { t, k, seg, oculta }
      pausa: { n: 0, total: 0 }, // entre trozo y trozo, cuando estaba listo
      minAdelanto: { visible: null, hidden: null },
      maxMemoria: 0,
      eventos: [],
      fin: null
    };
    M._esperaDesde = 0;
    M._acabo = 0;
    evento('empieza');
  }

  function evento(que) {
    if (!M) return;
    M.eventos.push({ t: Date.now(), que: que, k: S.i });
    if (M.eventos.length > 300) M.eventos.splice(0, M.eventos.length - 300);
  }

  function guarda() {
    if (!M) return;
    try {
      const copia = Object.assign({}, M);
      delete copia._esperaDesde; delete copia._acabo;
      localStorage.setItem(CLAVE_INFORME, JSON.stringify(copia));
    } catch (_) { /* sin almacenamiento: el informe queda en pantalla */ }
  }

  function ultimoInforme() {
    try { return JSON.parse(localStorage.getItem(CLAVE_INFORME) || 'null'); }
    catch (_) { return null; }
  }

  function vis() { return document.visibilityState === 'hidden' ? 'hidden' : 'visible'; }

  /** Segundos de voz ya hechos, seguidos, por delante del que suena. */
  function adelanto() {
    let s = 0;
    for (let k = S.i + 1; k < S.trozos.length; k++) {
      const h = S.hechos.get(k);
      if (!h || !h.r) break;
      s += h.r.segundos;
    }
    return s;
  }

  function memoria() {
    let b = 0;
    S.hechos.forEach((h) => { if (h.r) b += h.r.bytes; });
    return b;
  }

  /* Lo que le pasa a la página mientras lee, con su hora: si el teléfono la
   * congela o la tira, el informe lo dice. `pagehide` y `pageshow` llegan a
   * la ventana; los otros, al documento. */
  [[document, 'visibilitychange'], [document, 'freeze'], [document, 'resume'],
    [window, 'pagehide'], [window, 'pageshow']].forEach(([donde, n]) => {
    donde.addEventListener(n, () => {
      if (!M || S.estado === 'parada') return;
      evento(n === 'visibilitychange' ? 'pantalla-' + vis() : n);
      guarda();
    });
  });

  /* --------------------------------------------- hacer la voz por delante */

  function hecho(k) {
    let h = S.hechos.get(k);
    if (h) return h;
    const tz = S.trozos[k];
    const p = partes(S.voz);
    const pausa = tz.fin ? PAUSA.parrafo : PAUSA.frase;
    const v0 = vis();
    const fria = W.cargada !== p.voz;
    h = { r: null };
    h.p = pide({ tipo: 'di', voz: p.voz, hablante: p.hablante,
      texto: paraDecir(tz.texto, lenguaDe(S.voz)), vel: S.vel }).then((d) => {
      W.cargada = p.voz;
      const wav = conSilencio(d.wav, pausa);
      h.r = { blob: new Blob([wav], { type: 'audio/wav' }),
        segundos: d.segundos + pausa, bytes: wav.byteLength };
      // el ritmo sólo cuenta si la pantalla estuvo igual de principio a fin,
      // y con la voz ya cargada
      const v1 = vis();
      if (M && v0 === v1 && !fria) {
        const m = M.ritmo[v1];
        m.voz += d.segundos; m.ms += d.ms; m.n++;
      }
      if (M) M.maxMemoria = Math.max(M.maxMemoria, memoria());
      return h.r;
    });
    h.p.catch(() => { if (S.hechos.get(k) === h) S.hechos.delete(k); });
    S.hechos.set(k, h);
    return h;
  }

  function espera() {
    return new Promise((res) => { S.despierta = res; });
  }

  function despierta() {
    const d = S.despierta;
    S.despierta = null;
    if (d) d();
  }

  /** Va haciendo, de uno en uno y por orden, los trozos que vienen detrás del
   *  que suena, hasta tener `delante` segundos hechos; y suelta los que ya
   *  quedaron atrás. Si ya está en marcha no hace nada: la vuelta en curso se
   *  entera sola de por dónde va la lectura. */
  async function adelanta() {
    if (S.adelantando) return;
    S.adelantando = true;
    try {
      for (;;) {
        if (S.estado === 'parada') break;
        for (const k of S.hechos.keys()) if (k < S.i) S.hechos.delete(k);
        let k = S.i;
        while (k < S.trozos.length && S.hechos.has(k) && S.hechos.get(k).r) k++;
        if (k >= S.trozos.length) break;
        if (adelanto() >= S.delante) { await espera(); continue; }
        try {
          await hecho(k).p;
        } catch (err) {
          emite('error', err);
          await espera();
        }
      }
    } finally {
      S.adelantando = false;
    }
  }

  /* -------------------------------------------------------- sonar */

  /* Un audio en bucle de un solo bit de amplitud, que ningún oído alcanza y
   * que al navegador le basta para tratar la página como un reproductor.
   * Es el de Liturgicum. */
  function wavMudo() {
    const hz = 8000, n = hz / 2;
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
    for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }

  function arrancaSilencio() {
    if (!S.silencio) {
      S.silencio = new Audio(wavMudo());
      S.silencio.loop = true;
    }
    // tiene que salir del toque que arranca la voz: un audio que empieza
    // solo no lo deja ningún navegador
    S.silencio.play().catch(() => { /* sin él se corta al apagar la pantalla */ });
  }

  async function suena(k) {
    const g = S.gen;
    S.i = k;
    S.audio = null;
    S.cargando = g;
    despierta();
    adelanta();
    emite('trozo', k);
    nombraEnLosMandos();
    const h = hecho(k);
    const corte = !h.r && k !== S.desde;
    if (corte && M) M._esperaDesde = performance.now();
    let r;
    try {
      r = await h.p;
    } catch (err) {
      if (g !== S.gen) return;
      S.cargando = 0;
      emite('error', err);
      para();
      return;
    }
    if (g !== S.gen || S.estado === 'parada') return;
    S.cargando = 0;
    // esperar un suspiro a un trozo que estaba a punto de acabarse no es un
    // corte: no se oye. Corte es cuando se nota el silencio.
    const espero = corte && M ? (performance.now() - M._esperaDesde) / 1000 : 0;
    const seNota = espero >= CORTE;
    if (seNota) {
      M.cortes.push({ t: Date.now(), k: k, oculta: vis() === 'hidden', seg: espero });
      if (M.cortes.length > 200) M.cortes.splice(0, M.cortes.length - 200);
    }
    if (S.url) URL.revokeObjectURL(S.url);
    S.url = URL.createObjectURL(r.blob);
    const a = new Audio(S.url);
    S.audio = a;
    a.addEventListener('playing', () => {
      if (M && M._acabo && !seNota) {
        M.pausa.n++;
        M.pausa.total += (performance.now() - M._acabo) / 1000;
      }
      if (M) M._acabo = 0;
    }, { once: true });
    a.addEventListener('ended', () => { if (g === S.gen) acabo(k, r); });
    a.addEventListener('error', () => { if (g === S.gen) acabo(k, r); });
    if (S.estado === 'pausada') return;
    // `suena`: que ya se oye, para quien enseña «Preparando la voz…»
    a.play().then(() => { if (g === S.gen) emite('suena', k); })
      .catch(() => { if (g === S.gen) acabo(k, r); });
  }

  function acabo(k, r) {
    if (M) {
      const v = vis();
      M.frases++;
      M.escuchado[v] += r.segundos;
      const ad = adelanto();
      M.minAdelanto[v] = M.minAdelanto[v] === null ? ad : Math.min(M.minAdelanto[v], ad);
      M._acabo = performance.now();
      if (M.frases % 10 === 0) guarda();
    }
    // pausada justo al acabar el trozo: al seguir, va el siguiente, no éste
    // otra vez desde el principio
    if (S.estado === 'pausada') {
      S.audio = null;
      if (k + 1 < S.trozos.length) { S.i = k + 1; S.desde = k + 1; }
      return;
    }
    if (S.estado !== 'diciendo') return;
    if (k + 1 >= S.trozos.length) {
      evento('fin');
      para();
      emite('fin');
      return;
    }
    suena(k + 1);
  }

  /* ------------------------------------------------------- los mandos */

  function ponMandos() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const pon = (n, f) => {
      try { ms.setActionHandler(n, f); } catch (_) { /* ése no lo tiene */ }
    };
    pon('play', () => sigue());
    pon('pause', () => pausa());
    pon('stop', () => para());
    pon('nexttrack', () => ve(S.i + 1));
    pon('previoustrack', () => ve(S.i - 1));
  }

  function nombraEnLosMandos() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    if (window.MediaMetadata) {
      try {
        ms.metadata = new MediaMetadata({ title: S.titulo,
          artist: 'Lector · ' + partes(S.voz).voz,
          artwork: [{ src: 'icono.svg', sizes: 'any', type: 'image/svg+xml' }] });
      } catch (_) { /* sin rótulo en la pantalla de bloqueo: se oye igual */ }
    }
    ms.playbackState = S.estado === 'diciendo' ? 'playing'
      : S.estado === 'pausada' ? 'paused' : 'none';
  }

  /* ---------------------------------------------------- lo que se le pide */

  /** Empieza a leer `trozos` desde `desde`. Tiene que salir de un toque: el
   *  audio mudo que mantiene viva la página no arranca sin uno. */
  function lee(trozos, desde, op) {
    op = op || {};
    para();
    S.trozos = trozos;
    if (op.voz) S.voz = op.voz;
    if (op.vel) S.vel = op.vel;
    if (op.delante) S.delante = op.delante;
    if (op.titulo) S.titulo = op.titulo;
    S.hechos.clear();
    S.estado = 'diciendo';
    S.gen++;
    S.desde = desde || 0;
    arrancaSilencio();
    ponMandos();
    nuevaMedida();
    emite('estado', S.estado);
    suena(S.desde);
  }

  function pausa() {
    if (S.estado !== 'diciendo') return;
    S.estado = 'pausada';
    if (S.audio) S.audio.pause();
    if (S.silencio) S.silencio.pause();
    evento('pausa');
    nombraEnLosMandos();
    emite('estado', S.estado);
  }

  function sigue() {
    if (S.estado !== 'pausada') return;
    S.estado = 'diciendo';
    arrancaSilencio();
    evento('sigue');
    nombraEnLosMandos();
    emite('estado', S.estado);
    // a medio trozo, sigue donde iba; esperando a que el trozo esté hecho,
    // ya sonará al llegar; y si no hay ninguno de los dos, empieza el que toca
    if (S.audio) S.audio.play().catch(() => ve(S.i));
    else if (S.cargando !== S.gen) { S.desde = S.i; suena(S.i); }
  }

  function para() {
    if (S.estado === 'parada') return;
    S.estado = 'parada';
    S.gen++;
    if (S.audio) { S.audio.pause(); S.audio = null; }
    if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
    if (S.silencio) S.silencio.pause();
    S.hechos.clear();
    despierta();
    if (M) { M.fin = Date.now(); evento('para'); guarda(); }
    nombraEnLosMandos();
    emite('estado', S.estado);
  }

  /** Salta al trozo `k`: lo que ya estaba hecho de ahí en adelante sirve, y
   *  lo de antes se suelta. */
  function ve(k) {
    if (S.estado === 'parada') return;
    k = Math.max(0, Math.min(S.trozos.length - 1, k));
    S.gen++;
    if (S.audio) { S.audio.pause(); S.audio = null; }
    S.desde = k;
    S.i = k;
    if (S.estado === 'pausada') {
      S.estado = 'diciendo';
      arrancaSilencio();
      emite('estado', S.estado);
    }
    evento('salta');
    suena(k);
  }

  /** Otra velocidad u otra voz: lo adelantado ya no vale y se rehace desde
   *  el trozo que suena. */
  function cambia(op) {
    if (op.vel) S.vel = op.vel;
    if (op.voz) S.voz = op.voz;
    if (op.delante) { S.delante = op.delante; despierta(); }
    if (M) { M.vel = S.vel; M.voz = S.voz; M.delante = S.delante; }
    if ((op.vel || op.voz) && S.estado !== 'parada') {
      S.hechos.clear();
      ve(S.i);
    }
  }

  function estado() {
    return { estado: S.estado, i: S.i, n: S.trozos.length, voz: S.voz,
      vel: S.vel, delante: S.delante, adelanto: adelanto(),
      memoria: memoria(), medida: M };
  }

  window.Voz = {
    VOCES: VOCES, LENGUAS: LENGUAS, lenguaDe: lenguaDe,
    hay: hay, baja: baja, quita: quita, prueba: prueba,
    trocea: trocea, deParrafos: deParrafos, paraDecir: paraDecir,
    lee: lee, pausa: pausa, sigue: sigue, para: para, ve: ve, cambia: cambia,
    estado: estado, on: on, ultimoInforme: ultimoInforme
  };
})();
