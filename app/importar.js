/* Abrir un libro: de un archivo EPUB, PDF, Word, TXT… a párrafos y un índice.
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
 *
 * Word (DOCX) y LibreOffice (ODT) también son ZIP: se leen igual, y el
 * índice sale de los estilos de título (Título 1, 2…); sus notas al pie van,
 * como en el EPUB, detrás del párrafo que las llama. El PDF lo lee pdf.js
 * (pdfjs/, de Mozilla), que da cada trozo de texto con su sitio y su tamaño
 * de letra: con eso se rehacen renglones y párrafos, se quitan cabeceras,
 * pies y números de página, se apartan las notas, y los títulos salen de
 * los marcadores del PDF o, si no trae, de la letra más grande. Un PDF
 * escaneado, sin texto, todavía no: pide OCR.
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
    return rotulaNota(num, t);
  }

  const tieneLetra = (t) => /[\p{L}\p{N}]/u.test(t);

  /** El párrafo de una nota, como se ve y se oye: «Nota 5. …». */
  function rotulaNota(num, texto) {
    const t = String(texto).replace(/\s+/g, ' ').trim();
    if (!tieneLetra(t)) return null;
    const n = /\d+/.exec(num || '');
    return (n ? 'Nota ' + n[0] + '. ' : 'Nota. ') + t;
  }

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

  /** Los niveles de título, apretados: si no hay partes, los capítulos van
   *  arriba. */
  function compacta(h) {
    const usados = Array.from(new Set(Object.values(h))).sort((a, b) => a - b);
    Object.keys(h).forEach((p) => { h[p] = usados.indexOf(h[p]) + 1; });
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
    compacta(h);

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

  /* ------------------------------------------------- Word y LibreOffice */

  /** Un atributo por su nombre sin prefijo (w:val → val), sea cual sea el
   *  espacio de nombres: el DOCX «estricto» usa otro. */
  function at(el, n) {
    for (const a of el.attributes) if (a.localName === n) return a.value;
    return null;
  }

  const hijo = (el, n) => Array.from(el.children).find((c) => c.localName === n);

  /** El texto de un XML de dentro del ZIP: título, autor, lengua. */
  function dcDe(d) {
    return (n) => {
      const el = d && d.getElementsByTagNameNS('*', n)[0];
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    };
  }

  /** De cada estilo de párrafo de Word, su nivel de título (0 si no lo es),
   *  si es el de un índice ya hecho (que no se lee: el de la app lo
   *  sustituye) y si es el del título del documento. El nivel se hereda
   *  del estilo en que se basa. */
  function estilosWord(d) {
    const est = new Map();
    if (d) {
      for (const s of d.getElementsByTagNameNS('*', 'style')) {
        if (at(s, 'type') !== 'paragraph') continue;
        const nombre = hijo(s, 'name');
        const base = hijo(s, 'basedOn');
        const ppr = hijo(s, 'pPr');
        const ol = ppr && hijo(ppr, 'outlineLvl');
        est.set(at(s, 'styleId'), { nombre: nombre ? at(nombre, 'val') || '' : '',
          base: base ? at(base, 'val') : null, ol: ol ? +at(ol, 'val') : null });
      }
    }
    const memo = new Map();
    const nivel = (id, prof) => {
      if (!id || prof > 12) return 0;
      if (memo.has(id)) return memo.get(id);
      const e = est.get(id);
      const m = /^(?:heading|t[íi]tulo|encabezado|[üu]berschrift|titre|titolo|kop)\s*(\d)$/i
        .exec(e ? e.nombre.trim() : '') || /^(?:heading|t[íi]?tulo|encabezado)(\d)$/i.exec(id);
      let n = 0;
      if (m) n = +m[1];
      else if (e && e.ol !== null && e.ol < 9) n = e.ol + 1;
      else if (e && e.base) n = nivel(e.base, prof + 1);
      memo.set(id, n);
      return n;
    };
    return (id) => {
      const e = est.get(id);
      const nombre = (e ? e.nombre : id || '').trim().toLowerCase();
      return { nivel: nivel(id, 0), indice: /^(toc|tdc)\b/.test(nombre) || /^(toc|tdc)/i.test(id || ''),
        titulo: nombre === 'title' || nombre === 'título' || nombre === 'titulo' };
    };
  }

  /* Lo de dentro de un párrafo de Word que no se lee: el texto borrado con
   * control de cambios, los códigos de campo, los dibujos y cuadros de
   * texto, las marcas de comentario. */
  const NO_WORD = new Set(('pPr rPr del delText instrText delInstrText drawing pict object '
    + 'AlternateContent fldChar footnoteRef endnoteRef commentReference sectPr').split(' '));

  async function docx(file) {
    const Z = zip(await file.arrayBuffer());
    const utf8 = new TextDecoder('utf-8');
    const xml = async (ruta) => {
      const b = await Z.lee(ruta);
      return b ? parsea(utf8.decode(b), 'application/xml') : null;
    };
    // dónde está el documento: casi siempre en word/document.xml, pero lo
    // dice _rels/.rels
    let ruta = 'word/document.xml';
    const rels = await xml('_rels/.rels');
    const rel = rels && Array.from(rels.getElementsByTagNameNS('*', 'Relationship'))
      .find((r) => /\/officeDocument$/.test(r.getAttribute('Type') || ''));
    if (rel) ruta = resuelve('', rel.getAttribute('Target') || '').ruta;
    const doc = await xml(ruta);
    const cuerpo = doc && doc.getElementsByTagNameNS('*', 'body')[0];
    if (!cuerpo) throw new Error('El archivo no es un documento de Word (.docx)');
    const dir = ruta.replace(/[^/]*$/, '');
    const estilo = estilosWord(await xml(dir + 'styles.xml'));

    // las notas al pie y al final, por su id; Word las numera cada clase
    // por su lado, en el orden en que se llaman
    const notas = {};
    for (const [clase, archivo] of [['footnote', 'footnotes.xml'], ['endnote', 'endnotes.xml']]) {
      const m = notas[clase] = new Map();
      const d = await xml(dir + archivo);
      if (!d) continue;
      for (const n of d.getElementsByTagNameNS('*', clase)) {
        const tipo = at(n, 'type');
        if (!tipo || tipo === 'normal') m.set(at(n, 'id'), n);
      }
    }
    const cuenta = { footnote: 0, endnote: 0 };

    const textoDe = (p, llamadas) => {
      let s = '';
      const r = (el) => {
        for (const c of el.children) {
          const n = c.localName;
          if (NO_WORD.has(n)) continue;
          if (n === 't') s += c.textContent;
          else if (n === 'tab' || n === 'ptab' || n === 'br' || n === 'cr') s += ' ';
          else if (n === 'noBreakHyphen') s += '-';
          else if (n === 'softHyphen') { /* el guion que sólo sale al partir */ }
          else if (n === 'footnoteReference' || n === 'endnoteReference') {
            const clase = n.replace('Reference', '');
            const nota = notas[clase].get(at(c, 'id'));
            if (!nota) continue;
            const num = String(++cuenta[clase]);
            const t = rotulaNota(num, Array.from(nota.getElementsByTagNameNS('*', 'p'))
              .map((x) => textoDe(x, null)).join(' '));
            if (t && llamadas) llamadas.push(t);
          } else r(c);
        }
      };
      r(p);
      return s;
    };

    const L = { t: [], h: {}, k: {} };
    let tituloDoc = '';
    const parrafo = (p) => {
      const ppr = hijo(p, 'pPr');
      const pst = ppr && hijo(ppr, 'pStyle');
      const pol = ppr && hijo(ppr, 'outlineLvl');
      const e = estilo(pst ? at(pst, 'val') : null);
      if (e.indice) return;
      const llamadas = [];
      const t = textoDe(p, llamadas).replace(/\s+/g, ' ').trim();
      if (e.titulo && !tituloDoc) tituloDoc = t;
      const ol = pol ? +at(pol, 'val') : NaN;
      const nivel = ol < 9 ? ol + 1 : e.nivel;
      if (t && tieneLetra(t)) {
        if (nivel && t.length <= 300) L.h[L.t.length] = nivel;
        L.t.push(t);
      }
      for (const n of llamadas) { L.k[L.t.length] = 1; L.t.push(n); }
    };
    const recorre = (el) => {
      for (const c of el.children) {
        if (c.localName === 'p') parrafo(c);
        else if (c.localName !== 'sectPr') recorre(c);   // tablas, controles…
      }
    };
    recorre(cuerpo);
    if (!L.t.length) throw new Error('El documento no trae texto que leer');
    compacta(L.h);

    const dc = dcDe(await xml('docProps/core.xml'));
    return {
      titulo: dc('title') || tituloDoc || file.name.replace(/\.[^.]+$/, ''),
      autor: dc('creator'),
      lengua: codigoLengua(dc('language')) || adivinaLengua(L.t.slice(0, 400).join(' ')),
      formato: 'docx',
      portada: null,
      indice: indiceDeTitulos(L.t, L.h),
      t: L.t,
      h: L.h,
      k: L.k
    };
  }

  /* Lo de un ODT que no se lee: índices ya hechos, declaraciones, cambios
   * guardados, dibujos, comentarios. */
  const NO_ODT = new Set(('table-of-content alphabetical-index illustration-index table-index '
    + 'object-index user-index bibliography sequence-decls variable-decls user-field-decls '
    + 'tracked-changes forms frame annotation note-citation').split(' '));

  async function odt(file) {
    const Z = zip(await file.arrayBuffer());
    const utf8 = new TextDecoder('utf-8');
    const xml = async (ruta) => {
      const b = await Z.lee(ruta);
      return b ? parsea(utf8.decode(b), 'application/xml') : null;
    };
    const doc = await xml('content.xml');
    const cuerpo = doc && doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0];
    if (!cuerpo) throw new Error('El archivo no es un documento de texto de LibreOffice (.odt)');

    const textoDe = (p, llamadas) => {
      let s = '';
      const r = (el) => {
        for (let c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) { s += c.data; continue; }
          if (c.nodeType !== 1) continue;
          const n = c.localName;
          if (NO_ODT.has(n)) continue;
          if (n === 's') s += ' '.repeat(Math.min(+at(c, 'c') || 1, 20));
          else if (n === 'tab' || n === 'line-break') s += ' ';
          else if (n === 'note') {
            const cita = hijo(c, 'note-citation');
            const cuerpoNota = hijo(c, 'note-body');
            const t = cuerpoNota && rotulaNota(cita ? cita.textContent : '',
              Array.from(cuerpoNota.getElementsByTagNameNS('*', 'p')).concat(
                Array.from(cuerpoNota.getElementsByTagNameNS('*', 'h'))).map((x) => textoDe(x, null)).join(' '));
            if (t && llamadas) llamadas.push(t);
          } else r(c);
        }
      };
      r(p);
      return s;
    };

    const L = { t: [], h: {}, k: {} };
    const recorre = (el) => {
      for (const c of el.children) {
        const n = c.localName;
        if (n === 'p' || n === 'h') {
          const llamadas = [];
          const t = textoDe(c, llamadas).replace(/\s+/g, ' ').trim();
          if (t && tieneLetra(t)) {
            if (n === 'h') L.h[L.t.length] = Math.min(+at(c, 'outline-level') || 1, 6);
            L.t.push(t);
          }
          for (const x of llamadas) { L.k[L.t.length] = 1; L.t.push(x); }
        } else if (!NO_ODT.has(n)) recorre(c);          // listas, tablas, secciones…
      }
    };
    recorre(cuerpo);
    if (!L.t.length) throw new Error('El documento no trae texto que leer');
    compacta(L.h);

    const dc = dcDe(await xml('meta.xml'));
    return {
      titulo: dc('title') || file.name.replace(/\.[^.]+$/, ''),
      autor: dc('creator') || dc('initial-creator'),
      lengua: codigoLengua(dc('language')) || adivinaLengua(L.t.slice(0, 400).join(' ')),
      formato: 'odt',
      portada: null,
      indice: indiceDeTitulos(L.t, L.h),
      t: L.t,
      h: L.h,
      k: L.k
    };
  }

  /* -------------------------------------------------------------- HTML */

  /** Una página web guardada: como un EPUB de un solo capítulo. */
  async function html(file) {
    const d = parsea(await decodifica(file), 'text/html');
    const ruta = 'libro.html';
    const L = { t: [], h: {}, k: {}, anclas: new Map(), inicios: new Map(),
      docs: new Map([[ruta, d]]), usadas: new WeakSet(), pags: [] };
    aplana(d, ruta, L);
    if (!L.t.length) throw new Error('La página no trae texto que leer');
    compacta(L.h);
    const autor = d.querySelector('meta[name="author" i]');
    return {
      titulo: (d.title || '').replace(/\s+/g, ' ').trim() || file.name.replace(/\.[^.]+$/, ''),
      autor: autor ? (autor.getAttribute('content') || '').trim() : '',
      lengua: codigoLengua(d.documentElement.getAttribute('lang'))
        || adivinaLengua(L.t.slice(0, 400).join(' ')),
      formato: 'html',
      portada: null,
      indice: indiceDeTitulos(L.t, L.h),
      t: L.t,
      h: L.h,
      k: L.k,
      paginas: L.pags.length > 1 ? L.pags : null
    };
  }

  /* --------------------------------------------------------------- PDF */

  /* pdf.js va dentro de la app (pdfjs/), para que abra sin conexión; se
   * carga la primera vez que hace falta. Los mapas de letras de algunos
   * PDF raros (chino, japonés…) se piden a la red sólo si los usan. */
  const CMAPS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/';
  let _pdfjs = null;

  function pdfjs() {
    if (!_pdfjs) {
      const base = (f) => new URL('pdfjs/' + f, document.baseURI).href;
      _pdfjs = import(base('pdf.min.mjs')).then((m) => {
        m.GlobalWorkerOptions.workerSrc = base('pdf.worker.min.mjs');
        return m;
      });
      _pdfjs.catch(() => { _pdfjs = null; });
    }
    return _pdfjs;
  }

  const letras = (s) => (s.match(/\p{L}/gu) || []).length;
  const cerca = (a, b) => Math.abs(a - b) <= b * 0.08;

  /** El valor que más pesa de una lista de [valor, peso]. */
  function moda(pares) {
    const m = new Map();
    let mejor = null, max = -1;
    for (const [v, w] of pares) {
      const x = (m.get(v) || 0) + w;
      m.set(v, x);
      if (x > max) { max = x; mejor = v; }
    }
    return mejor;
  }

  /** Dos trozos de texto seguidos: la palabra partida a final de renglón
   *  (`pala-` + `bra`) se junta. */
  function une(a, b) {
    if (!a) return b;
    if (/\p{L}[-­¬]$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
    return a + ' ' + b;
  }

  /** Los renglones de una página: los trozos de texto que da pdf.js,
   *  juntados por su altura, cada renglón con su tamaño de letra (el que
   *  más letras tiene). Las llamadas a nota —un numerito volado— no se
   *  leen: se apuntan aparte. */
  async function renglonesDe(pag) {
    const tc = await pag.getTextContent();
    const rs = [];
    let r = null;
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str) continue;
      const m = it.transform;
      const tam = Math.hypot(m[2], m[3]) || it.height || 0;
      if (!tam || Math.abs(m[1]) > Math.abs(m[0])) continue;   // de lado: no es el texto corrido
      const x = m[4], y = m[5], fin = x + (it.width || 0);
      const alto = r ? Math.max(tam, r.max) : tam;
      if (!r || Math.abs(y - r.y0) > alto * 0.6 || x < r.xFin - alto * 2) {
        if (!it.str.trim()) continue;
        r = { trozos: [], x: x, xFin: fin, y0: y, max: tam };
        rs.push(r);
      } else if (x - r.xFin > alto * 0.15) {
        r.trozos.push({ s: ' ', tam: 0, y: y });
      }
      r.trozos.push({ s: it.str, tam: tam, y: y });
      r.xFin = Math.max(r.xFin, fin);
      r.max = Math.max(r.max, tam);
    }
    const lista = [];
    for (const x of rs) {
      const tam = moda(x.trozos.filter((t) => t.tam).map((t) => [Math.round(t.tam * 2) / 2, letras(t.s) || 0.1]));
      const base = (x.trozos.find((t) => t.tam && cerca(Math.round(t.tam * 2) / 2, tam)) || x.trozos[0]).y;
      const llamadas = [];
      let s = '';
      x.trozos.forEach((t, i) => {
        if (i && t.tam && t.tam < tam * 0.85 && t.y > base + tam * 0.15 && /^\s*[\d*†‡]{1,3}\s*$/.test(t.s)
          && s.trim()) {
          llamadas.push(t.s.trim());
          return;
        }
        s += t.s;
      });
      s = s.replace(/\s+/g, ' ').trim();
      if (s) lista.push({ texto: s, x: x.x, xFin: x.xFin, y: base, tam: tam, llamadas: llamadas });
    }
    return lista;
  }

  async function pdf(file, avance) {
    let lib;
    try {
      lib = await pdfjs();
    } catch (e) {
      throw new Error('No se pudo cargar el lector de PDF (la primera vez hace falta conexión)');
    }
    let doc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false, cMapUrl: CMAPS, cMapPacked: true }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('El PDF tiene contraseña');
      throw new Error('El archivo no es un PDF que se pueda abrir');
    }
    try {
      const N = doc.numPages;
      const hojas = [];
      for (let i = 1; i <= N; i++) {
        const pag = await doc.getPage(i);
        hojas.push(await renglonesDe(pag));
        pag.cleanup();
        if (avance) avance(i, N);
      }
      const conTexto = hojas.filter((h) => h.reduce((s, r) => s + letras(r.texto), 0) >= 20).length;
      if (!conTexto || conTexto < N * 0.1) {
        throw new Error('Este PDF es de páginas escaneadas y no trae texto. Leerlo con OCR todavía no se puede.');
      }
      const L = armaPdf(hojas);
      if (!L.t.length) throw new Error('El PDF no trae texto que leer');

      let nombres = null;
      try { nombres = await doc.getPageLabels(); } catch (_) { /* sin nombres */ }
      const paginas = L.marcas.map((m, i) => [m[0], m[1], (nombres && nombres[i]) || String(i + 1)]);

      const ol = await indicePdf(doc, L);
      const h = ol && Object.keys(ol.h).length ? ol.h : L.h;
      compacta(h);
      const indice = ol && ol.indice.length ? ol.indice : indiceDeTitulos(L.t, h);

      let info = {};
      try { info = (await doc.getMetadata()).info || {}; } catch (_) { /* sin datos */ }
      const titulo = String(info.Title || '').replace(/^Microsoft (?:Word|PowerPoint) - /, '')
        .replace(/\.(?:docx?|odt|pdf|rtf)$/i, '').replace(/\s+/g, ' ').trim();

      return {
        titulo: (/^(untitled|sin t[íi]tulo|documento\d*)$/i.test(titulo) ? '' : titulo)
          || file.name.replace(/\.[^.]+$/, ''),
        autor: String(info.Author || '').replace(/\s+/g, ' ').trim(),
        lengua: adivinaLengua(L.t.slice(0, 400).join(' ')),
        formato: 'pdf',
        portada: await portadaPdf(doc),
        indice: indice,
        t: L.t,
        h: h,
        k: L.k,
        paginas: paginas
      };
    } finally {
      doc.destroy();
    }
  }

  /** De los renglones de cada página, los párrafos del libro. Cuenta con
   *  lo de casi todos los libros: la letra del cuerpo es la más usada; lo
   *  que se repite arriba o abajo de muchas páginas es cabecera o pie; lo
   *  de letra menor bajo el texto, empezando por un número, son las notas;
   *  y un párrafo nuevo se ve por la sangría, por un espacio de más o porque
   *  el renglón de antes acaba corto en punto. */
  function armaPdf(hojas) {
    const todos = hojas.flat();
    const cuerpo = moda(todos.map((r) => [Math.round(r.tam * 2) / 2, r.texto.length])) || 10;
    const saltos = [];
    hojas.forEach((h) => {
      for (let i = 1; i < h.length; i++) {
        const d = h[i - 1].y - h[i].y;
        if (cerca(h[i - 1].tam, cuerpo) && cerca(h[i].tam, cuerpo) && d > cuerpo * 0.8 && d < cuerpo * 3) {
          saltos.push([Math.round(d * 2) / 2, 1]);
        }
      }
    });
    const interlinea = moda(saltos) || cuerpo * 1.2;

    // cabeceras y pies: lo de arriba o abajo de la página que se repite (con
    // otro número) en tres o más, y los números de página sueltos
    const clave = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const NUMERO = /^[\s\-–—.]*(?:\d{1,4}|[ivxlcdm]{1,7})[\s\-–—.]*$/i;
    // los dos renglones de arriba y los dos de abajo; `aparte`, los que
    // además quedan separados del texto por más espacio que un renglón
    const extremos = (h) => {
      const o = h.slice().sort((a, b) => b.y - a.y);
      const n = o.length;
      const lejos = (a, b) => !b || Math.abs(a.y - b.y) > interlinea * 1.3;
      const aparte = new Set();
      if (n && lejos(o[0], o[1])) aparte.add(o[0]);
      if (n > 1 && aparte.has(o[0]) && lejos(o[1], o[2])) aparte.add(o[1]);
      if (n > 2 && lejos(o[n - 1], o[n - 2])) aparte.add(o[n - 1]);
      if (n > 3 && aparte.has(o[n - 1]) && lejos(o[n - 2], o[n - 3])) aparte.add(o[n - 2]);
      return { todos: new Set(o.slice(0, 2).concat(o.slice(-2))), aparte: aparte };
    };
    const veces = new Map();
    hojas.forEach((h) => {
      new Set(Array.from(extremos(h).aparte).map((r) => clave(r.texto)))
        .forEach((k) => veces.set(k, (veces.get(k) || 0) + 1));
    });
    const NOTA = /^(\d{1,3}|[*†‡]{1,3})(?:[.)]\s*|\s+|(?=\p{Lu}))(?=\S)/u;
    // lo que está bajo el texto y empieza por un número puede repetirse
    // («1 Ibid., p. 5»): es una nota, no un pie
    const suelo = (h) => {
      const g = h.filter((r) => r.tam >= cuerpo * 0.95);
      return g.length ? Math.min.apply(null, g.map((r) => r.y)) : -Infinity;
    };
    hojas = hojas.map((h) => {
      const ex = extremos(h);
      const s = suelo(h);
      return h.filter((r) => !(r.tam < cuerpo * 1.15
        && ((ex.todos.has(r) && NUMERO.test(r.texto))
          || (ex.aparte.has(r) && veces.get(clave(r.texto)) >= 3 && r.texto.length < 150
            && !(r.y < s - 1 && r.tam < cuerpo * 0.9 && NOTA.test(r.texto))))));
    });

    // el margen y el borde derecho de cada página, que las pares y las
    // impares no los tienen en el mismo sitio
    const geo = (rs) => {
      const xs = rs.map((r) => r.x).sort((a, b) => a - b);
      const fs = rs.map((r) => r.xFin).sort((a, b) => a - b);
      return { margen: xs[Math.floor(xs.length * 0.1)], borde: fs[Math.floor(fs.length * 0.85)] };
    };
    const general = geo(todos.filter((r) => cerca(r.tam, cuerpo)));

    const L = { t: [], h: {}, k: {}, marcas: [], comienzos: [] };
    const tamTit = {};
    let buf = '', esTit = false, bufTam = 0, pend = [], prev = null, ultimaNota = null;
    const cierra = () => {
      const t = buf.trim();
      if (t && tieneLetra(t)) {
        if (esTit) tamTit[L.t.length] = bufTam;
        L.t.push(t);
      }
      for (const n of pend) {
        const x = rotulaNota(n.num, n.texto);
        if (!x) continue;
        n.idx = L.t.length;
        L.k[L.t.length] = 1;
        L.t.push(x);
      }
      buf = ''; pend = []; esTit = false;
    };

    hojas.forEach((h, i) => {
      // las notas: bajo el último renglón de letra de cuerpo, con letra
      // menor, y la primera empieza por su número (o sigue la nota de la
      // página de antes)
      let notas = [];
      const s = suelo(h);
      const bajo = h.filter((r) => r.y < s - 1 && r.tam < cuerpo * 0.9)
        .sort((a, b) => b.y - a.y || a.x - b.x);
      if (bajo.length && (NOTA.test(bajo[0].texto) || (ultimaNota && cerca(bajo[0].tam, ultimaNota.tam)))) {
        let n = null, actual = null;
        for (const r of bajo) {
          const m = NOTA.exec(r.texto);
          const num = m && /\d/.test(m[1]) ? +m[1] : null;
          if (m && (!actual || num === null || n === null || num === n + 1)) {
            actual = { num: m[1], texto: r.texto.slice(m[0].length), tam: r.tam, idx: -1 };
            if (num !== null) n = num;
            notas.push(actual);
          } else if (actual) {
            actual.texto = une(actual.texto, r.texto);
          } else if (ultimaNota.idx >= 0) {
            L.t[ultimaNota.idx] = une(L.t[ultimaNota.idx], r.texto);
          } else {
            ultimaNota.texto = une(ultimaNota.texto, r.texto);
          }
        }
        const fuera = new Set(bajo);
        h = h.filter((r) => !fuera.has(r));
      }

      const cs = h.filter((r) => cerca(r.tam, cuerpo));
      const g = cs.length >= 3 ? geo(cs) : general;
      let marcada = false;
      const marca = (texto) => {
        if (marcada) return;
        marcada = true;
        L.marcas.push([L.t.length, !buf ? 0 : texto === null ? buf.length
          : une(buf, texto).length - texto.length]);
      };
      const parte = (a, b) => {
        if (a.hoja === i) {
          const dy = a.y - b.y;
          if (dy > interlinea * 1.6) return true;                 // un espacio de más
          if (dy > -cuerpo && b.x > a.x + cuerpo * 0.9 && b.x < a.x + cuerpo * 10) return true;   // sangría
        } else if (b.x > g.margen + cuerpo * 0.9 && b.x < g.margen + cuerpo * 10) {
          return true;
        }
        return a.xFin < a.borde - cuerpo * 3 && /[.!?:»”"')\]]$/.test(a.texto);   // acaba corto
      };

      for (const r of h) {
        r.hoja = i;
        r.borde = g.borde;
        const tit = r.tam >= cuerpo * 1.18 && r.texto.length <= 150 && tieneLetra(r.texto);
        let corta = false;
        if (buf) {
          if (tit) {
            corta = !(esTit && cerca(r.tam, bufTam) && prev.hoja === i
              && prev.y > r.y && prev.y - r.y < r.tam * 2.5);
          } else corta = esTit || parte(prev, r);
        }
        if (corta) cierra();
        marca(r.texto);
        if (!buf) {
          (L.comienzos[i] = L.comienzos[i] || []).push({ p: L.t.length, y: r.y });
          buf = r.texto;
          esTit = tit;
          bufTam = r.tam;
        } else {
          buf = une(buf, r.texto);
        }
        for (const num of r.llamadas) {
          const n = notas.find((x) => !x.puesta && x.num === num);
          if (n) { n.puesta = true; pend.push(n); }
        }
        prev = r;
      }
      marca(null);
      notas.forEach((n) => { if (!n.puesta) pend.push(n); });
      ultimaNota = notas.length ? notas[notas.length - 1] : null;
    });
    cierra();

    // los títulos: por el tamaño de su letra, de mayor a menor, hasta tres
    // niveles; si salen demasiados, no lo eran
    const tams = Array.from(new Set(Object.values(tamTit).map((x) => Math.round(x))))
      .sort((a, b) => b - a);
    Object.keys(tamTit).forEach((p) => { L.h[p] = Math.min(tams.indexOf(Math.round(tamTit[p])) + 1, 3); });
    if (Object.keys(L.h).length > L.t.length * 0.25) L.h = {};
    return L;
  }

  /** El índice de los marcadores del PDF, si los trae: cada uno lleva a una
   *  página (y a veces a una altura); allí se busca el párrafo que empieza
   *  como el título del marcador, y si no, el primero que empieza en ella.
   *  Los párrafos que se encuentran así son los títulos del libro. */
  async function indicePdf(doc, L) {
    let ol = null;
    try { ol = await doc.getOutline(); } catch (_) { /* sin marcadores */ }
    if (!ol || !ol.length) return null;
    const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
    const h = {};
    const sitio = async (e, nivel) => {
      let d = e.dest;
      try { if (typeof d === 'string') d = await doc.getDestination(d); } catch (_) { d = null; }
      if (!Array.isArray(d) || !d.length) return null;
      let n;
      try { n = typeof d[0] === 'number' ? d[0] : await doc.getPageIndex(d[0]); } catch (_) { return null; }
      if (!(n >= 0 && n < L.marcas.length)) return null;
      const tipo = d[1] && d[1].name;
      const y = tipo === 'XYZ' ? d[3] : (tipo === 'FitH' || tipo === 'FitBH') ? d[2] : null;
      const aqui = L.comienzos[n] || [];
      const k = norm(e.title).slice(0, 24);
      if (k.length >= 3) {
        const c = aqui.concat((L.comienzos[n + 1] || []).slice(0, 3)).find((c) => {
          const t = norm(L.t[c.p] || '').slice(0, 200);
          return t.startsWith(k) || (t.length >= 4 && k.startsWith(t.slice(0, 24)));
        });
        if (c) {
          if (L.t[c.p].length <= 200 && !(h[c.p] <= nivel)) h[c.p] = nivel;
          return c.p;
        }
      }
      if (typeof y === 'number') {
        const c = aqui.find((c) => c.y <= y + 2);
        if (c) return c.p;
      }
      if (L.marcas[n][1] === 0 || !aqui.length) return L.marcas[n][0];
      return aqui[0].p;
    };
    const lee = async (lista, nivel) => {
      const r = [];
      for (const e of lista) {
        const p = await sitio(e, nivel);
        r.push({ t: String(e.title || '').replace(/\s+/g, ' ').trim(),
          p: p === null ? null : Math.min(p, L.t.length - 1),
          hijos: e.items && e.items.length ? await lee(e.items, nivel + 1) : [] });
      }
      return r;
    };
    return { indice: limpiaIndice(await lee(ol, 1)), h: h };
  }

  /** La primera página, pintada, como portada. */
  async function portadaPdf(doc) {
    try {
      const pag = await doc.getPage(1);
      const v = pag.getViewport({ scale: 1 });
      const vp = pag.getViewport({ scale: 360 / v.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      // «print», que pinta de un tirón: la forma normal espera a cada cuadro
      // de pantalla, y con la pantalla apagada o la app atrás no acaba nunca
      const tarea = pag.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' });
      const tarde = setTimeout(() => tarea.cancel(), 15000);
      try { await tarea.promise; } finally { clearTimeout(tarde); }
      return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    } catch (_) {
      return null;
    }
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

  /** El libro de un archivo. `avance(hecho, total)`, si se da, va diciendo
   *  por qué página va (en un PDF largo, abrirlo tarda). */
  async function archivo(file, avance) {
    const r = await abre(file, avance);
    if (!r.paginas) r.paginas = paginas(r.t);
    return r;
  }

  async function abre(file, avance) {
    const n = file.name.toLowerCase();
    const tipo = file.type || '';
    if (n.endsWith('.epub') || tipo === 'application/epub+zip') return epub(file);
    if (n.endsWith('.pdf') || tipo === 'application/pdf') return pdf(file, avance);
    if (n.endsWith('.docx') || /wordprocessingml/.test(tipo)) return docx(file);
    if (n.endsWith('.odt') || /opendocument\.text/.test(tipo)) return odt(file);
    if (/\.x?html?$/.test(n) || /html/.test(tipo)) return html(file);
    if (/\.(txt|md|markdown|text)$/.test(n) || /^text\//.test(tipo)) return txt(file);
    if (/\.(doc|rtf|wps|pages)$/.test(n) || /msword|rtf/.test(tipo)) {
      throw new Error('ese formato no se puede abrir. En Word, guárdalo como .docx (Archivo › Guardar como) o como PDF.');
    }
    // sin extensión conocida: por cómo empieza. Un ZIP puede ser EPUB,
    // Word o LibreOffice; se mira qué trae dentro
    const cab = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode.apply(null, cab) === '%PDF-') return pdf(file, avance);
    if (cab[0] === 0x50 && cab[1] === 0x4b) {
      const e = zip(await file.arrayBuffer()).entradas;
      if (e.has('word/document.xml')) return docx(file);
      if (e.has('content.xml') && !e.has('META-INF/container.xml')) return odt(file);
      return epub(file);
    }
    return txt(file);
  }

  window.Importa = { archivo: archivo, paginas: paginas, adivinaLengua: adivinaLengua, arbol: arbol };
})();
