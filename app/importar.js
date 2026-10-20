/* Abrir un libro: de un archivo EPUB o TXT a párrafos y un índice.
 *
 * Todo pasa en el teléfono: el archivo no sale de aquí. Lo que devuelve
 * `Importa.archivo(file)` es lo que guarda la biblioteca (biblioteca.js):
 *
 *   { titulo, autor, lengua, formato, portada, indice, t: [párrafo, …],
 *     h: { índice del párrafo: nivel de título }, paginas }
 *
 * `paginas` dice dónde empieza cada página: [[párrafo, letra, nombre?], …].
 * Si el EPUB marca las páginas del libro impreso (epub:type="pagebreak"),
 * son ésas, con su número; si no, se parte el texto en páginas de
 * PAGINA letras, como las de un libro corriente.
 *
 * Cada párrafo es texto ya limpio —un solo espacio entre palabras, sin
 * saltos de renglón—, que es lo que la voz parte en frases (voz.js) y lo que
 * se ve en pantalla: los dos tienen que coincidir letra por letra para que
 * la frase que suena se pueda resaltar.
 *
 * El EPUB es un ZIP, y para abrirlo no hace falta ninguna librería: Chrome
 * descomprime solo (DecompressionStream). El índice es el del propio libro
 * (nav.xhtml en EPUB 3, toc.ncx en EPUB 2); el TXT no trae índice, y se
 * busca por los renglones que parecen títulos: «Capítulo 5», «IV», «# …».
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------- el ZIP */

  /** Las entradas de un ZIP, por nombre, y cómo sacar cada una. Lee el
   *  directorio del final, que es el que manda: los tamaños de la cabecera
   *  de cada entrada pueden venir a cero. */
  function zip(buf) {
    const d = new DataView(buf);
    let fin = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (d.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El archivo no es un EPUB (no es un ZIP)');
    const n = d.getUint16(fin + 10, true);
    let p = d.getUint32(fin + 16, true);
    const utf8 = new TextDecoder('utf-8');
    const entradas = new Map();
    for (let k = 0; k < n; k++) {
      if (d.getUint32(p, true) !== 0x02014b50) break;
      const metodo = d.getUint16(p + 10, true);
      const comp = d.getUint32(p + 20, true);
      const largoNombre = d.getUint16(p + 28, true);
      const extra = d.getUint16(p + 30, true);
      const coment = d.getUint16(p + 32, true);
      const local = d.getUint32(p + 42, true);
      const nombre = utf8.decode(new Uint8Array(buf, p + 46, largoNombre));
      entradas.set(nombre, { metodo: metodo, comp: comp, local: local });
      p += 46 + largoNombre + extra + coment;
    }
    async function lee(nombre) {
      const e = entradas.get(nombre);
      if (!e) return null;
      const ini = e.local + 30 + d.getUint16(e.local + 26, true)
        + d.getUint16(e.local + 28, true);
      const datos = new Uint8Array(buf, ini, e.comp);
      if (e.metodo === 0) return datos;
      if (e.metodo !== 8) throw new Error('compresión desconocida en ' + nombre);
      const s = new Blob([datos]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return { entradas: entradas, lee: lee };
  }

  /* ----------------------------------------------------------- rutas */

  /** `href` (relativo a `desde`, que es la ruta de un archivo dentro del
   *  ZIP) a ruta dentro del ZIP, y el fragmento aparte. */
  function resuelve(desde, href) {
    const [camino, frag] = String(href).split('#');
    let ruta = '';
    if (camino) {
      let c;
      try { c = decodeURIComponent(camino); } catch (_) { c = camino; }
      const partes = c.startsWith('/') ? [] : desde.split('/').slice(0, -1);
      c.replace(/^\//, '').split('/').forEach((x) => {
        if (x === '..') partes.pop();
        else if (x && x !== '.') partes.push(x);
      });
      ruta = partes.join('/');
    } else {
      ruta = desde;
    }
    return { ruta: ruta, frag: frag || '' };
  }

  /* ---------------------------------------------------------- lenguas */

  const TRES = { spa: 'es', eng: 'en', fra: 'fr', fre: 'fr', ita: 'it',
    por: 'pt', deu: 'de', ger: 'de', lat: 'la', cat: 'ca' };

  function codigoLengua(x) {
    const c = String(x || '').trim().toLowerCase().split(/[-_]/)[0];
    return TRES[c] || (c.length === 2 ? c : '');
  }

  /* Las palabras más comunes de cada lengua: la que más aparezca en el
   * texto es la del libro. Se confirma al importar, así que basta con que
   * acierte casi siempre. */
  const COMUNES = {
    es: 'de la que el en y los se del las un por con no una su para es al lo como más pero sus le ya o fue este ha sí porque esta son entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante',
    en: 'the of and to in is was that he for it with as his on be at by i this had not are but from or have an they which you were her she there would their we him been has when who will more no if out so said what up its about into than them can only other',
    fr: 'de la le et les des en un du une que est pour qui dans par plus pas au sur ne se ce il sont avec son elle nous vous mais ou comme tout',
    it: 'di e il la che in un per non una è del le si con da i al lo come più ma della gli ha anche sono nel questo alla ci se mi',
    pt: 'de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela',
    de: 'der die und in den von zu das mit sich des auf für ist im dem nicht ein die eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man'
  };
  const _comunes = {};
  Object.keys(COMUNES).forEach((l) => { _comunes[l] = new Set(COMUNES[l].split(' ')); });

  function adivinaLengua(texto) {
    const cuenta = {};
    Object.keys(_comunes).forEach((l) => { cuenta[l] = 0; });
    const palabras = String(texto).slice(0, 40000).toLowerCase()
      .match(/\p{L}+/gu) || [];
    for (const w of palabras) {
      for (const l in _comunes) if (_comunes[l].has(w)) cuenta[l]++;
    }
    let mejor = 'es', max = 0;
    for (const l in cuenta) if (cuenta[l] > max) { max = cuenta[l]; mejor = l; }
    return mejor;
  }

  /* ------------------------------------------------- de HTML a párrafos */

  const BLOQUE = new Set(('address article aside blockquote body center dd details '
    + 'dialog dir div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 '
    + 'h6 header hgroup hr li main menu nav ol p pre section summary table tbody '
    + 'td tfoot th thead tr ul caption').split(' '));
  const NADA = new Set('script style head title rt rp svg math template noscript'.split(' '));

  /* Las notas: lo que suena mal al oírlo en medio de una frase. Las que el
   * EPUB marca como tales, y las llamadas sin marcar que son un numerito
   * con enlace —«<sup><a href="#n3">3</a></sup>»—. */
  const TIPO_NOTA = /\b(noteref|footnotes?|endnotes?|rearnotes?|doc-noteref|doc-footnote|doc-endnotes?)\b/;
  const tipoDe = (el) => (el.getAttribute('epub:type') || '') + ' ' + (el.getAttribute('role') || '');

  function esNota(el, tag) {
    if (TIPO_NOTA.test(tipoDe(el))) return true;
    if (tag === 'a' && /#/.test(el.getAttribute('href') || '')) {
      const t = el.textContent.trim();
      if (/^[\[(]?[\d*†‡a-z]{1,3}[\])]?$/i.test(t)) return true;
    }
    return false;
  }

  /** El texto de la nota a la que lleva una llamada, o null. La nota no se
   *  lee donde está —al final del capítulo, o en otro archivo—, sino justo
   *  después del párrafo que la llama: así, al oírla, se sabe de qué habla. */
  function textoDeNota(a, ruta, L) {
    const href = a.getAttribute('href');
    if (!href || !/#/.test(href) || !L.docs) return null;
    const r = resuelve(ruta, href);
    const doc = L.docs.get(r.ruta);
    if (!doc || !r.frag) return null;
    let el = doc.getElementById(r.frag);
    if (!el) {
      try { el = doc.querySelector('[name="' + CSS.escape(r.frag) + '"]'); } catch (_) { el = null; }
    }
    if (!el) return null;
    // la nota entera: el bloque marcado como nota que la contiene, o el
    // párrafo en que cae el ancla
    let caja = el;
    for (let x = el; x && x.nodeType === 1; x = x.parentNode) {
      if (/\b(footnote|endnote|rearnote|doc-footnote|doc-endnote)\b/.test(tipoDe(x))) { caja = x; break; }
    }
    if (caja === el && !BLOQUE.has(el.localName.toLowerCase())) {
      for (let x = el.parentNode; x && x.nodeType === 1; x = x.parentNode) {
        if (BLOQUE.has(x.localName.toLowerCase())) { caja = x; break; }
      }
    }
    L.usadas.add(caja);
    const num = a.textContent.replace(/[\s\[\]()]/g, '');
    let t = caja.textContent.replace(/\s+/g, ' ').trim();
    // el número con que empieza la nota (o su enlace de vuelta) ya lo dice
    // «Nota 5»
    if (num && t.startsWith(num)) t = t.slice(num.length).replace(/^[\s.):\]]+/, '');
    if (!tieneLetra(t)) return null;
    const n = /\d+/.exec(num);
    return (n ? 'Nota ' + n[0] + '. ' : 'Nota. ') + t;
  }

  const tieneLetra = (t) => /[\p{L}\p{N}]/u.test(t);

  /** Los párrafos de un documento, añadidos a `L` (el libro que se va
   *  armando). Apunta en `L.anclas` dónde cae cada `id`, para que el índice
   *  pueda llevar a una sección a media página. Las notas que llama un
   *  párrafo van detrás de él, cada una en su párrafo, apuntado en `L.k`. */
  function aplana(doc, ruta, L) {
    const cuerpo = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
    let buf = '';
    let nivel = 0;
    let notas = [];
    const suelta = () => {
      const t = buf.replace(/\s+/g, ' ').trim();
      buf = '';
      if (t && tieneLetra(t)) {
        if (nivel) L.h[L.t.length] = nivel;
        L.t.push(t);
      }
      for (const n of notas) {
        L.k[L.t.length] = 1;
        L.t.push(n);
      }
      notas = [];
    };
    const ancla = (el) => {
      const id = el.getAttribute('id') || (el.localName === 'a' && el.getAttribute('name'));
      const k = ruta + '#' + id;
      if (id && !L.anclas.has(k)) L.anclas.set(k, L.t.length);
    };
    const recorre = (nodo) => {
      for (let c = nodo.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 || c.nodeType === 4) { buf += c.data; continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.localName.toLowerCase();
        if (NADA.has(tag)) continue;
        if (L.usadas.has(c)) continue;   // una nota que ya se leyó tras su llamada
        if (/\bpagebreak\b/.test(tipoDe(c))) {
          // dónde empieza una página del libro impreso; su número no se lee
          ancla(c);
          const n = (c.getAttribute('title') || c.getAttribute('aria-label')
            || c.textContent).replace(/\s+/g, ' ').trim();
          L.pags.push([L.t.length, buf.replace(/\s+/g, ' ').trimStart().length, n]);
          continue;
        }
        if (BLOQUE.has(tag)) {
          suelta();
          ancla(c);
          if (esNota(c, tag)) continue;
          const antes = nivel;
          if (/^h[1-6]$/.test(tag)) nivel = +tag[1];
          recorre(c);
          suelta();
          nivel = antes;
        } else {
          ancla(c);
          if (esNota(c, tag)) {
            const llama = tag === 'a' ? c : c.querySelector && c.querySelector('a[href]');
            const n = llama && textoDeNota(llama, ruta, L);
            if (n && !notas.includes(n)) notas.push(n);
            continue;
          }
          if (tag === 'br') buf += ' ';
          else if (tag === 'img') { /* la imagen no se lee */ }
          else recorre(c);
        }
      }
    };
    L.inicios.set(ruta, L.t.length);
    recorre(cuerpo);
    suelta();
  }

  function parsea(texto, tipo) {
    const p = new DOMParser();
    let d = p.parseFromString(texto, tipo || 'application/xhtml+xml');
    // un XHTML mal cerrado da un documento de error: se reintenta como
    // HTML, que lo tolera todo
    if (d.getElementsByTagName('parsererror').length && tipo !== 'text/html') {
      d = p.parseFromString(texto, 'text/html');
    }
    return d;
  }

  const hijos = (el, nombre) => Array.from(el.children || [])
    .filter((c) => c.localName.toLowerCase() === nombre);

  /* -------------------------------------------------------------- EPUB */

  async function epub(file) {
    const Z = zip(await file.arrayBuffer());
    const utf8 = new TextDecoder('utf-8');
    const texto = async (ruta) => {
      const b = await Z.lee(ruta);
      return b ? utf8.decode(b) : null;
    };

    const cont = await texto('META-INF/container.xml');
    if (!cont) throw new Error('El EPUB no trae META-INF/container.xml');
    const raiz = parsea(cont, 'application/xml').getElementsByTagName('rootfile')[0];
    const rutaOpf = raiz && raiz.getAttribute('full-path');
    const opfTxt = rutaOpf && await texto(rutaOpf);
    if (!opfTxt) throw new Error('El EPUB no dice dónde está su contenido');
    const opf = parsea(opfTxt, 'application/xml');
    const meta = (n) => {
      const el = opf.getElementsByTagNameNS('*', n)[0];
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    };

    // lo que trae el libro, por id
    const items = new Map();
    Array.from(opf.getElementsByTagNameNS('*', 'item')).forEach((it) => {
      items.set(it.getAttribute('id'), {
        ruta: resuelve(rutaOpf, it.getAttribute('href') || '').ruta,
        tipo: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || ''
      });
    });
    const spineEl = opf.getElementsByTagNameNS('*', 'spine')[0];
    const orden = Array.from(opf.getElementsByTagNameNS('*', 'itemref'))
      .map((r) => items.get(r.getAttribute('idref')))
      .filter((it) => it && /html|xml/.test(it.tipo));

    // el texto, documento por documento, en el orden de lectura; todos
    // abiertos antes, que una nota puede estar en otro archivo
    const L = { t: [], h: {}, k: {}, anclas: new Map(), inicios: new Map(),
      docs: new Map(), usadas: new WeakSet(), pags: [] };
    for (const it of orden) {
      const x = await texto(it.ruta);
      if (x) L.docs.set(it.ruta, parsea(x, /x?html\+?xml/.test(it.tipo) ? 'application/xhtml+xml' : 'text/html'));
    }
    for (const it of orden) {
      if (L.docs.has(it.ruta)) aplana(L.docs.get(it.ruta), it.ruta, L);
    }
    if (!L.t.length) throw new Error('El EPUB no trae texto que leer');

    const donde = (desde, href) => {
      const r = resuelve(desde, href);
      let p = r.frag ? L.anclas.get(r.ruta + '#' + r.frag) : undefined;
      if (p === undefined) p = L.inicios.get(r.ruta);
      return p === undefined ? null : Math.min(p, L.t.length - 1);
    };

    // el índice: nav.xhtml (EPUB 3) o toc.ncx (EPUB 2)
    let indice = [];
    const nav = Array.from(items.values()).find((it) => /\bnav\b/.test(it.props));
    if (nav) {
      const d = parsea(await texto(nav.ruta) || '');
      const navs = Array.from(d.getElementsByTagNameNS('*', 'nav'));
      const toc = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || ''))
        || navs[0];
      const ol = toc && toc.getElementsByTagNameNS('*', 'ol')[0];
      const lee = (lista) => hijos(lista, 'li').map((li) => {
        const a = hijos(li, 'a')[0] || hijos(li, 'span')[0];
        const sub = hijos(li, 'ol')[0];
        return { t: a ? a.textContent.replace(/\s+/g, ' ').trim() : '',
          p: a && a.getAttribute('href') ? donde(nav.ruta, a.getAttribute('href')) : null,
          hijos: sub ? lee(sub) : [] };
      });
      if (ol) indice = lee(ol);
    }
    if (!indice.length) {
      const ncxId = spineEl && spineEl.getAttribute('toc');
      const ncx = items.get(ncxId)
        || Array.from(items.values()).find((it) => /dtbncx/.test(it.tipo));
      if (ncx) {
        const d = parsea(await texto(ncx.ruta) || '', 'application/xml');
        const map = d.getElementsByTagNameNS('*', 'navMap')[0];
        const lee = (el) => hijos(el, 'navpoint').map((np) => {
          const lab = np.getElementsByTagNameNS('*', 'text')[0];
          const c = hijos(np, 'content')[0];
          return { t: lab ? lab.textContent.replace(/\s+/g, ' ').trim() : '',
            p: c ? donde(ncx.ruta, c.getAttribute('src') || '') : null,
            hijos: lee(np) };
        });
        if (map) indice = lee(map);
      }
    }
    indice = limpiaIndice(indice);
    if (!indice.length) indice = indiceDeTitulos(L.t, L.h);

    return {
      titulo: meta('title') || file.name.replace(/\.[^.]+$/, ''),
      autor: Array.from(opf.getElementsByTagNameNS('*', 'creator'))
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' y '),
      lengua: codigoLengua(meta('language')) || adivinaLengua(L.t.slice(0, 400).join(' ')),
      formato: 'epub',
      portada: await portada(Z, opf, items),
      indice: indice,
      t: L.t,
      h: L.h,
      k: L.k,
      paginas: L.pags.length > 1
        ? L.pags.sort((a, b) => a[0] - b[0] || a[1] - b[1]) : null
    };
  }

  /** La imagen de la portada, si el EPUB dice cuál es. */
  async function portada(Z, opf, items) {
    let it = Array.from(items.values()).find((x) => /\bcover-image\b/.test(x.props));
    if (!it) {
      const m = Array.from(opf.getElementsByTagNameNS('*', 'meta'))
        .find((x) => x.getAttribute('name') === 'cover');
      if (m) it = items.get(m.getAttribute('content'));
    }
    if (!it) {
      it = Array.from(items.entries()).map((e) => e[1])
        .find((x) => /^image\//.test(x.tipo) && /cover|portada/i.test(x.ruta));
    }
    if (!it || !/^image\//.test(it.tipo)) return null;
    const b = await Z.lee(it.ruta);
    return b ? new Blob([b], { type: it.tipo }) : null;
  }

  /** Quita del índice las entradas que no llevan a ningún sitio. Una que
   *  sólo agrupa —«Primera parte», sin enlace— se queda, y lleva a donde
   *  empieza su primer hijo. */
  function limpiaIndice(lista) {
    const r = [];
    for (const e of lista) {
      const h = limpiaIndice(e.hijos || []);
      const p = (e.p === null || e.p === undefined) ? (h.length ? h[0].p : null) : e.p;
      if (p === null) continue;
      r.push({ t: e.t || '—', p: p, hijos: h });
    }
    return r;
  }

  /** Un índice a partir de los títulos del texto, para el libro que no
   *  trae uno: los niveles que haya, de mayor a menor, en árbol. */
  function indiceDeTitulos(t, h) {
    const planos = Object.keys(h).map((p) => ({ p: +p, nivel: h[p], t: t[p] }))
      .sort((a, b) => a.p - b.p);
    return arbol(planos);
  }

  function arbol(planos) {
    const raiz = { nivel: 0, hijos: [] };
    const pila = [raiz];
    for (const e of planos) {
      while (pila.length > 1 && pila[pila.length - 1].nivel >= e.nivel) pila.pop();
      const nodo = { t: e.t.length > 90 ? e.t.slice(0, 88) + '…' : e.t, p: e.p,
        nivel: e.nivel, hijos: [] };
      pila[pila.length - 1].hijos.push(nodo);
      pila.push(nodo);
    }
    const quitaNivel = (l) => l.map((x) => ({ t: x.t, p: x.p, hijos: quitaNivel(x.hijos) }));
    return quitaNivel(raiz.hijos);
  }

  /* --------------------------------------------------------------- TXT */

  /** El texto de un archivo: UTF-8 si lo es, y si no, la codificación de
   *  Windows, que es la de casi cualquier TXT viejo en español. */
  async function decodifica(file) {
    const b = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch (_) {
      return new TextDecoder('windows-1252').decode(b);
    }
  }

  const TITULO = new RegExp('^(?:cap[ií]tulo|chapter|chapitre|capitolo|kapitel|'
    + 'pr[oó]logo|prologue|prolog|ep[ií]logo|epilogue|epilog|introducci[oó]n|'
    + 'introduction|einleitung|pr[ée]face|prefacio|vorwort|ap[ée]ndice|appendix|'
    + 'anhang|conclusi[oó]n|conclusion)\\b', 'i');
  const PARTE = /^(?:parte|part|partie|teil|libro|book|livre|buch|tomo|volume[n]?)\b/i;
  const ROMANO = /^(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})\.?$/;

  /** El nivel de título de un renglón suelto, o 0 si no parece título. */
  function nivelDe(r) {
    const m = /^(#{1,6})\s+\S/.exec(r);
    if (m) return m[1].length;
    if (r.length > 80 || /[,;]$/.test(r)) return 0;
    if (PARTE.test(r)) return 1;
    if (TITULO.test(r)) return 2;
    if (ROMANO.test(r) || /^\d{1,3}\.?$/.test(r)) return 3;
    return 0;
  }

  /** Lo de Markdown que no se lee: almohadillas, asteriscos, enlaces. */
  function sinMarcas(t) {
    return t.replace(/^#{1,6}\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)]|$)/g, '$1$2');
  }

  async function txt(file) {
    let x = (await decodifica(file)).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const md = /\.(md|markdown)$/i.test(file.name);

    // Project Gutenberg: su cabecera dice el título y el autor, y lo de antes
    // y después de las marcas no es el libro
    let titulo = '', autor = '';
    const ini = /^\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG.*$/im.exec(x);
    if (ini) {
      const cab = x.slice(0, ini.index);
      titulo = ((/^Title:\s*(.+)$/im.exec(cab) || [])[1] || '').trim();
      autor = ((/^Author:\s*(.+)$/im.exec(cab) || [])[1] || '').trim();
      x = x.slice(ini.index + ini[0].length);
      const fin = /^\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG.*$/im.exec(x);
      if (fin) x = x.slice(0, fin.index);
    }

    // párrafos: separados por renglón en blanco; si el texto casi no trae
    // ninguno, cada renglón es un párrafo
    const renglones = x.split('\n');
    const blancos = renglones.filter((r) => !r.trim()).length;
    const porRenglon = blancos < renglones.length / 20;
    const bloques = porRenglon ? renglones : x.split(/\n[ \t]*\n/);

    const t = [], h = {};
    for (const b of bloques) {
      const rs = b.split('\n').map((r) => r.trim()).filter(Boolean);
      if (!rs.length) continue;
      // un título de Markdown en medio de un bloque va aparte
      let resto = [];
      const echa = () => {
        if (!resto.length) return;
        let p = resto.join('\n').replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
          .replace(/\s+/g, ' ').trim();
        if (md) p = sinMarcas(p);
        if (tieneLetra(p)) t.push(p);
        resto = [];
      };
      for (const r of rs) {
        const n = (md && /^#{1,6}\s/.test(r)) ? nivelDe(r)
          : (rs.length === 1 ? nivelDe(r) : 0);
        if (n) {
          echa();
          const p = sinMarcas(r).replace(/\s+/g, ' ').trim();
          if (tieneLetra(p)) { h[t.length] = n; t.push(p); }
        } else {
          resto.push(r);
        }
      }
      echa();
    }
    if (!t.length) throw new Error('El archivo está vacío');

    // un número suelto o un romano pasa por título sólo si hay varios: uno
    // solo es más bien un renglón cualquiera
    const sueltos = Object.keys(h).filter((p) => h[p] === 3 && !/^#/.test(t[p]));
    if (sueltos.length < 3) sueltos.forEach((p) => { delete h[p]; });
    // y los niveles, apretados: si no hay partes, los capítulos van arriba
    const usados = Array.from(new Set(Object.values(h))).sort();
    Object.keys(h).forEach((p) => { h[p] = usados.indexOf(h[p]) + 1; });

    return {
      titulo: titulo || file.name.replace(/\.[^.]+$/, ''),
      autor: autor,
      lengua: adivinaLengua(t.slice(0, 400).join(' ')),
      formato: md ? 'md' : 'txt',
      portada: null,
      indice: indiceDeTitulos(t, h),
      t: t,
      h: h
    };
  }

  /* ----------------------------------------------------------- páginas */

  /* Las letras de una página de libro corriente (unas 300 palabras). */
  const PAGINA = 1800;

  /** Las páginas de un libro que no trae las suyas: cada PAGINA letras,
   *  contando las notas, que en el libro impreso también ocupan sitio. */
  function paginas(t) {
    const r = [[0, 0]];
    let falta = PAGINA;
    for (let p = 0; p < t.length; p++) {
      let c = 0;
      while (t[p].length - c > falta) {
        c += falta;
        falta = PAGINA;
        r.push([p, c]);
      }
      falta -= t[p].length - c;
    }
    return r;
  }

  /* ------------------------------------------------------------ fuera */

  async function archivo(file) {
    const r = await abre(file);
    if (!r.paginas) r.paginas = paginas(r.t);
    return r;
  }

  async function abre(file) {
    const n = file.name.toLowerCase();
    if (n.endsWith('.epub') || file.type === 'application/epub+zip') return epub(file);
    if (/\.(txt|md|markdown|text)$/.test(n) || /^text\//.test(file.type)) return txt(file);
    if (/\.(pdf|docx?|odt|rtf)$/.test(n) || /pdf|word/.test(file.type)) {
      throw new Error('PDF y Word todavía no: llegan en la Fase 3. Por ahora, EPUB o TXT.');
    }
    // sin extensión conocida: si empieza como un ZIP, EPUB; si no, texto
    const cab = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (cab[0] === 0x50 && cab[1] === 0x4b) return epub(file);
    return txt(file);
  }

  window.Importa = { archivo: archivo, paginas: paginas, adivinaLengua: adivinaLengua, arbol: arbol };
})();
