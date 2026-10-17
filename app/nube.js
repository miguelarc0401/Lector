/* La nube: la misma biblioteca en el PC y en el teléfono, por Google Drive.
 *
 * Opcional. Sin conectar, la app no la toca; conectada, sigue funcionando
 * sin red, y lo de Drive se pone al día cuando la hay (Plan.md §6).
 *
 * Todo va en la carpeta oculta de la app en Drive (`appDataFolder`), que
 * sólo ve Lector; el permiso que se pide (`drive.appdata`) es sólo esa
 * carpeta. Por cada libro, dos archivos:
 *
 *  · <id>.epub (o .txt, .md)  el archivo tal como se abrió
 *  · <id>.json                la ficha: título, autor, lengua…
 *
 * y en las `appProperties` de los dos { libro: id, tipo: 'archivo'|'ficha' };
 * la ficha lleva además lo que cambia al leer —p, f, notas, cambiado— y
 * `borrado` si se quitó «de todos». Así ponerse al día es pedir la lista,
 * y mandar la posición, cambiar esas propiedades, sin subir nada.
 *
 * El permiso de Google dura una hora y, sin servidor propio, renovarlo
 * tiene que empezar con un toque: la ventana de Google no se abre sola.
 * Se pide con la dirección de Google para apps sin servidor
 * (response_type=token) y lo recibe oauth.html, que lo deja en
 * localStorage y avisa por un BroadcastChannel.
 *
 * En la computadora (localhost) habla con un Drive de mentira
 * (herramientas/drive_falso.py), salvo que `lector-drive-real` esté en
 * localStorage.
 */
(function () {
  'use strict';

  /* El ID de cliente de Google Cloud (Plan.md §6). Es público. */
  const CLIENTE = '';

  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const FALSO = LOCAL && !leeLS('lector-drive-real');
  const DRIVE = FALSO ? 'http://localhost:8790' : 'https://www.googleapis.com';
  const AUTH = FALSO ? DRIVE + '/auth' : 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = DRIVE + '/drive/v3';
  const SUBE = DRIVE + '/upload/drive/v3';
  const ALCANCE = 'https://www.googleapis.com/auth/drive.appdata';

  const CLAVE = 'lector-nube';          // { conectada, ultima, quitados, porBorrar }
  const PERMISO = 'lector-nube-permiso'; // { token, caduca } (lo escribe oauth.html)
  const IDA = 'lector-nube-ida';         // { estado, vuelta, modo } mientras se entra

  /* La posición se manda como mucho una vez por minuto mientras se lee. */
  const CADA = 60000;

  const TIPOS = { epub: 'application/epub+zip', txt: 'text/plain', md: 'text/markdown' };

  function leeLS(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; }
  }
  function ponLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* */ }
  }

  const S = Object.assign({ conectada: false, ultima: 0, quitados: [], porBorrar: [] }, leeLS(CLAVE));
  const guardaS = () => ponLS(CLAVE, S);

  /* Lo que la app quiere saber: quién oye y si un libro está sonando. */
  const oyentes = {};
  function on(n, fn) { (oyentes[n] = oyentes[n] || []).push(fn); }
  function emite(n, x) { (oyentes[n] || []).forEach((fn) => { try { fn(x); } catch (e) { console.error(e); } }); }
  let ocupado = () => false;

  const E = { trabajando: false, error: '', aviso: '' };

  /* ------------------------------------------------------------ permiso */

  const disponible = () => FALSO || !!CLIENTE;

  function token() {
    const p = leeLS(PERMISO);
    return p && p.token && p.caduca > Date.now() ? p.token : null;
  }

  function olvidaPermiso() {
    try { localStorage.removeItem(PERMISO); } catch (_) { /* */ }
  }

  let _espera = null;    // { res, rej } mientras está abierta la ventana de Google

  function recibe(m) {
    if (!m) return;
    if (!_espera) {
      // llegó tarde, cuando ya se había dado por perdido: vale igual
      if (m.token) {
        S.conectada = true;
        guardaS();
        sincroniza();
      }
      return;
    }
    const e = _espera;
    _espera = null;
    if (m.token) e.res(m.token);
    else e.rej(new Error(m.error === 'access_denied' ? 'No se dio permiso.' : (m.error || 'No se pudo entrar.')));
  }

  try {
    new BroadcastChannel('lector-nube').onmessage = (ev) => recibe(ev.data);
  } catch (_) { /* sin BroadcastChannel: queda el evento storage */ }
  window.addEventListener('storage', (ev) => {
    if (ev.key === PERMISO && token()) recibe({ token: token() });
  });

  /** Pide el permiso a Google. Tiene que llamarse justo al tocar algo: si
   *  no, el navegador no deja abrir la ventana. Si no se abre, se va a
   *  Google en esta misma página y oauth.html vuelve aquí.
   *
   *  No se mira si la ventana se ha cerrado: las páginas de Google la
   *  separan de la app, y desde aquí parece cerrada aunque no lo esté. Se
   *  da por perdida cuando la app vuelve a estar delante y el permiso no
   *  llega. */
  function pidePermiso() {
    if (!disponible()) return Promise.reject(new Error('Falta el ID de cliente de Google (Plan.md §6).'));
    const estado = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, '');
    const q = new URLSearchParams({
      client_id: CLIENTE || 'falso',
      redirect_uri: new URL('oauth.html', location.origin + location.pathname).href,
      response_type: 'token',
      scope: ALCANCE,
      include_granted_scopes: 'true',
      state: estado
    });
    const url = AUTH + '?' + q;
    ponLS(IDA, { estado: estado, vuelta: location.hash || '#/', modo: 'ventana' });
    const w = window.open(url, 'lector-google', 'popup,width=480,height=640');
    if (!w) {
      ponLS(IDA, { estado: estado, vuelta: location.hash || '#/', modo: 'pagina' });
      location.href = url;
      return new Promise(() => {});
    }
    if (_espera) _espera.rej(null);
    return new Promise((res, rej) => {
      _espera = { res: res, rej: rej };
      const vuelta = () => setTimeout(() => {
        if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
        if (token()) recibe({ token: token() });
        else recibe({ error: 'No llegó el permiso de Google. Prueba otra vez.' });
      }, 2500);
      window.addEventListener('focus', vuelta, { once: true });
      document.addEventListener('visibilitychange', vuelta, { once: true });
    });
  }

  /* ------------------------------------------------------------ Drive */

  class SinPermiso extends Error {}

  async function drive(metodo, url, cuerpo, tipo, extra) {
    const t = token();
    if (!t) throw new SinPermiso('Hace falta entrar otra vez en Google.');
    const h = Object.assign({ Authorization: 'Bearer ' + t }, extra || {});
    if (tipo) h['Content-Type'] = tipo;
    const r = await fetch(url, { method: metodo, headers: h, body: cuerpo });
    if (r.status === 401) {
      olvidaPermiso();
      throw new SinPermiso('Hace falta entrar otra vez en Google.');
    }
    if (!r.ok) {
      let m = '';
      try { m = (await r.json()).error.message; } catch (_) { /* */ }
      throw new Error('Drive contestó ' + r.status + (m ? ': ' + m : ''));
    }
    return r;
  }

  /** Lo que hay en la carpeta, por libro: { id: { ficha, archivo } }. */
  async function lista() {
    const r = {};
    let pagina = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000',
        fields: 'nextPageToken,files(id,name,appProperties)' });
      if (pagina) q.set('pageToken', pagina);
      const j = await (await drive('GET', API + '/files?' + q)).json();
      (j.files || []).forEach((f) => {
        const a = f.appProperties || {};
        if (!a.libro || (a.tipo !== 'ficha' && a.tipo !== 'archivo')) return;
        (r[a.libro] = r[a.libro] || {})[a.tipo] = f;
      });
      pagina = j.nextPageToken || '';
    } while (pagina);
    return r;
  }

  /** Sube un archivo nuevo a la carpeta (subida reanudable: vale para
   *  cualquier tamaño). Devuelve su ficha de Drive. */
  async function sube(nombre, props, blob, tipo) {
    const meta = { name: nombre, parents: ['appDataFolder'], appProperties: props };
    const r = await drive('POST', SUBE + '/files?uploadType=resumable',
      JSON.stringify(meta), 'application/json; charset=UTF-8', { 'X-Upload-Content-Type': tipo });
    const donde = r.headers.get('Location');
    if (!donde) throw new Error('Drive no dio dónde subir el archivo');
    const p = await fetch(donde, { method: 'PUT', headers: { 'Content-Type': tipo }, body: blob });
    if (!p.ok) throw new Error('No se pudo subir «' + nombre + '» (' + p.status + ')');
    return p.json();
  }

  const cambiaProps = (id, props) => drive('PATCH', API + '/files/' + id + '?fields=id',
    JSON.stringify({ appProperties: props }), 'application/json; charset=UTF-8');

  const baja = async (id) => (await drive('GET', API + '/files/' + id + '?alt=media')).blob();

  const borra = (id) => drive('DELETE', API + '/files/' + id).catch((e) => {
    if (!/ 404/.test(e.message)) throw e;
  });

  /** Lo que cambia al leer, como propiedades de la ficha. */
  function propsDe(l) {
    return { p: String((l.pos && l.pos.p) || 0), f: String((l.pos && l.pos.f) || 0),
      notas: l.leeNotas ? '1' : '0', cambiado: String(l.cambiado || 0) };
  }

  /* ---------------------------------------------------- sincronizar */

  let _corre = null;
  let _fichas = {};   // id del libro -> id de su ficha en Drive

  /** Pone al día este aparato y Drive. No espera a nadie ni pide nada: si
   *  no hay permiso o no hay red, no hace nada. */
  function sincroniza() {
    if (!S.conectada || !token()) return Promise.resolve(false);
    if (_corre) return _corre;
    E.trabajando = true;
    E.error = '';
    emite('estado');
    _corre = haz().then(() => {
      S.ultima = Date.now();
      guardaS();
      return true;
    }, (err) => {
      console.warn('nube:', err);
      // TypeError: fetch no llegó a ninguna parte (sin red)
      E.error = err instanceof SinPermiso ? '' : (navigator.onLine === false || err instanceof TypeError
        ? 'Sin conexión con Drive: se pondrá al día luego.' : (err.message || String(err)));
      return false;
    }).finally(() => {
      _corre = null;
      E.trabajando = false;
      emite('estado');
    });
    return _corre;
  }

  async function haz() {
    // lo que se quitó «de todos» sin red, primero
    let remotos = await lista();
    if (S.porBorrar.length) {
      for (const id of S.porBorrar.slice()) {
        await marcaBorrado(remotos[id]);
        S.porBorrar = S.porBorrar.filter((x) => x !== id);
        guardaS();
      }
      remotos = await lista();
    }

    const cambiados = [];
    let locales = await Biblioteca.libros();
    const vivos = (r) => r.ficha && !(r.ficha.appProperties || {}).borrado;

    // el mismo libro abierto aquí y en otro aparato: se queda el id de Drive
    for (const [id, r] of Object.entries(remotos)) {
      const a = (r.ficha && r.ficha.appProperties) || {};
      if (!vivos(r) || !r.archivo || locales.some((l) => l.id === id)) continue;
      const libre = (x) => !remotos[x.id] && !ocupado(x.id);
      let l = a.huella && locales.find((x) => x.huella === a.huella && libre(x));
      // o abierto aquí antes de sincronizar (sin huella ni archivo): mismo
      // nombre de archivo y mismos párrafos; se le pone el archivo de Drive
      const sin = locales.filter((x) => !x.huella && +a.n === x.n && libre(x));
      if (!l && sin.length) {
        const ficha = JSON.parse(await (await baja(r.ficha.id)).text());
        l = sin.find((x) => x.archivo === ficha.archivo);
        if (l) await Biblioteca.ponArchivo(l.id, await baja(r.archivo.id), ficha.archivo, ficha.huella || a.huella);
      }
      if (!l) continue;
      await Biblioteca.rebautiza(l.id, id);
      S.quitados = S.quitados.filter((x) => x !== id);
      guardaS();
      cambiados.push(l.id, id);
    }
    if (cambiados.length) locales = await Biblioteca.libros();

    _fichas = {};
    for (const [id, r] of Object.entries(remotos)) if (r.ficha) _fichas[id] = r.ficha.id;

    // los de aquí
    for (const l of locales) {
      const r = remotos[l.id];
      if (r && r.ficha && (r.ficha.appProperties || {}).borrado) {
        // se quitó de todos en otro aparato
        if (ocupado(l.id)) continue;
        await Biblioteca.quita(l.id);
        cambiados.push(l.id);
        continue;
      }
      if (!r || !r.ficha || !r.archivo) {
        if (await subeLibro(l, r || {})) cambiados.push(l.id);
        continue;
      }
      // en los dos: gana el último cambio
      const a = r.ficha.appProperties || {};
      const rc = +a.cambiado || 0;
      const lc = l.cambiado || 0;
      const mismo = !a.n || +a.n === l.n;
      if (!mismo) continue;
      if (rc > lc) {
        if (ocupado(l.id)) continue;   // lo que suena manda: será más nuevo enseguida
        await Biblioteca.cambia(l.id, { pos: { p: +a.p || 0, f: +a.f || 0 },
          leeNotas: a.notas === '1', cambiado: rc, nube: true });
        cambiados.push(l.id);
      } else if (lc > rc) {
        await cambiaProps(r.ficha.id, propsDe(l));
      } else if (!l.nube) {
        await Biblioteca.cambia(l.id, { nube: true, cambiado: lc });
      }
    }

    // los de Drive que no están aquí
    for (const [id, r] of Object.entries(remotos)) {
      if (!vivos(r) || !r.archivo || locales.some((l) => l.id === id)) continue;
      if (S.quitados.includes(id)) continue;
      E.aviso = 'Bajando un libro de Drive…';
      emite('estado');
      try {
        await bajaLibro(id, r);
        cambiados.push(id);
      } finally {
        E.aviso = '';
      }
    }

    if (cambiados.length) emite('cambio', cambiados);
  }

  /** Sube un libro de aquí (o lo que le falte en Drive). Los que no tienen
   *  su archivo guardado (abiertos antes de la sincronización) no pueden. */
  async function subeLibro(l, r) {
    const arch = await Biblioteca.archivo(l.id);
    if (!arch || !arch.blob) return false;
    if (!l.huella) {
      l.huella = await Biblioteca.huella(arch.blob);
      await Biblioteca.cambia(l.id, { huella: l.huella, cambiado: l.cambiado || 0 });
    }
    const fmt = l.formato || 'txt';
    if (!r.archivo) {
      await sube(l.id + '.' + fmt, { libro: l.id, tipo: 'archivo' }, arch.blob,
        arch.blob.type || TIPOS[fmt] || 'application/octet-stream');
    }
    if (!r.ficha) {
      const ficha = { v: 1, id: l.id, titulo: l.titulo, autor: l.autor || '', lengua: l.lengua,
        formato: fmt, archivo: arch.nombre || l.archivo || '', n: l.n, notas: l.notas || 0,
        huella: l.huella, anadido: l.anadido };
      const f = await sube(l.id + '.json', Object.assign({ libro: l.id, tipo: 'ficha',
        n: String(l.n), huella: l.huella }, propsDe(l)),
      new Blob([JSON.stringify(ficha)], { type: 'application/json' }), 'application/json');
      _fichas[l.id] = f.id;
    }
    await Biblioteca.cambia(l.id, { nube: true, cambiado: l.cambiado || 0 });
    return true;
  }

  /** Baja un libro de Drive y lo abre como si se abriera a mano. */
  async function bajaLibro(id, r) {
    const ficha = JSON.parse(await (await baja(r.ficha.id)).text());
    const a = r.ficha.appProperties || {};
    const blob = await baja(r.archivo.id);
    const fmt = ficha.formato || 'txt';
    const nombre = ficha.archivo || (id + '.' + fmt);
    const file = new File([blob], nombre, { type: blob.type || TIPOS[fmt] || '' });
    const t = await Importa.archivo(file);
    const l = Biblioteca.nuevo(t, {
      id: id,
      titulo: ficha.titulo || t.titulo,
      autor: ficha.autor != null ? ficha.autor : (t.autor || ''),
      lengua: ficha.lengua || t.lengua || 'es',
      archivo: nombre,
      huella: ficha.huella || a.huella,
      leeNotas: a.notas === '1',
      anadido: ficha.anadido || Date.now(),
      abierto: 0,
      cambiado: +a.cambiado || 0,
      nube: true
    });
    // la posición, sólo si el libro ha salido partido igual que allí
    if (!a.n || +a.n === l.n) l.pos = { p: +a.p || 0, f: +a.f || 0 };
    await Biblioteca.guarda(l, { t: t.t, h: t.h, k: t.k || {} }, file);
  }

  async function marcaBorrado(r) {
    if (!r) return;
    if (r.ficha) await cambiaProps(r.ficha.id, { borrado: String(Date.now()) });
    if (r.archivo) await borra(r.archivo.id);
  }

  /* --------------------------------------------- la posición al leer */

  const pendientes = new Set();
  let _temporizador = 0;
  let _enviado = 0;

  window.addEventListener('lector-cambia', (ev) => {
    if (!S.conectada) return;
    pendientes.add(ev.detail.id);
    if (_temporizador) return;
    _temporizador = setTimeout(envia, Math.max(5000, CADA - (Date.now() - _enviado)));
  });

  /** Manda a Drive la posición de los libros que han cambiado. Sin
   *  permiso o sin red se quedan para la próxima sincronización, que
   *  compara las horas. Al ocultarse la app, la página aún vive lo que
   *  tarda una petición; si se cierra antes, la manda la próxima vez. */
  async function envia() {
    clearTimeout(_temporizador);
    _temporizador = 0;
    if (!pendientes.size || !token() || _corre) return;
    _enviado = Date.now();
    const ids = Array.from(pendientes);
    pendientes.clear();
    for (const id of ids) {
      const f = _fichas[id];
      if (!f) continue;   // aún no está en Drive: lo subirá la sincronización
      try {
        const l = await Biblioteca.libro(id);
        if (l) await cambiaProps(f, propsDe(l));
      } catch (e) {
        console.warn('nube: no se mandó la posición', e);
        return;
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!S.conectada) return;
    if (document.visibilityState === 'hidden') envia();
    else if (Date.now() - S.ultima > 2 * 60000) sincroniza();
  });
  window.addEventListener('pagehide', () => { if (S.conectada) envia(); });
  window.addEventListener('online', () => { if (S.conectada) sincroniza(); });

  /* ---------------------------------------------------------- fuera */

  /** Conectar (desde Ajustes) o «Sincronizar» (desde la biblioteca): pide
   *  el permiso si hace falta y se pone al día. Llamar al tocar. */
  async function ahora() {
    if (!token()) {
      E.error = '';
      E.aviso = 'Esperando a Google…';
      emite('estado');
      try {
        await pidePermiso();
      } catch (err) {
        if (err) E.error = err.message || String(err);   // null: se pidió otra vez
        return false;
      } finally {
        E.aviso = '';
        emite('estado');
      }
    }
    if (!S.conectada) {
      S.conectada = true;
      guardaS();
    }
    return sincroniza();
  }

  function desconecta() {
    const t = token();
    S.conectada = false;
    S.ultima = 0;
    guardaS();
    olvidaPermiso();
    pendientes.clear();
    _fichas = {};
    if (t && !FALSO) {
      fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t),
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .catch(() => {});
    }
    emite('estado');
  }

  /** Quitar un libro: de este aparato sólo (no se vuelve a bajar aquí) o
   *  de todos (se borra de Drive, y de los demás al sincronizar). */
  async function quita(l, deTodos) {
    await Biblioteca.quita(l.id);
    pendientes.delete(l.id);
    if (!S.conectada || !l.nube) return;
    if (!deTodos) {
      if (!S.quitados.includes(l.id)) S.quitados.push(l.id);
      guardaS();
      return;
    }
    S.porBorrar.push(l.id);
    guardaS();
    if (!token()) return;
    try {
      const r = (await lista())[l.id];
      await marcaBorrado(r);
      S.porBorrar = S.porBorrar.filter((x) => x !== l.id);
      guardaS();
    } catch (e) { console.warn('nube: se borrará luego', e); }
  }

  /** Al abrir un libro a mano en este aparato: si se había quitado «sólo
   *  de aquí», vuelve a valer. */
  function vuelve(id) {
    if (!S.quitados.includes(id)) return;
    S.quitados = S.quitados.filter((x) => x !== id);
    guardaS();
  }

  function estado() {
    return { disponible: disponible(), falso: FALSO, conectada: S.conectada, permiso: !!token(),
      ultima: S.ultima, trabajando: E.trabajando, error: E.error, aviso: E.aviso };
  }

  function inicia(o) {
    if (o && o.ocupado) ocupado = o.ocupado;
    // volviendo de entrar en Google en esta misma página (oauth.html)
    if (token() && !S.conectada) {
      S.conectada = true;
      guardaS();
    }
    if (S.conectada && navigator.onLine !== false) sincroniza();
  }

  window.Nube = { inicia: inicia, on: on, estado: estado, ahora: ahora, sincroniza: sincroniza,
    desconecta: desconecta, quita: quita, vuelve: vuelve };
})();
