/* El banco de pruebas de la Fase 0 (Plan.md, §3).
 *
 * Tres cosas, y las tres se miden en el teléfono, que es donde se va a
 * escuchar: qué voz suena mejor, cuánto tarda en hacerla, y sobre todo si
 * leyendo en el momento —sin guardar audio— aguanta media hora con la
 * pantalla apagada sin quedarse callada. Esto último decide si Lector sigue
 * siendo una PWA o tiene que ser una app nativa.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const coma = (n, d) => n.toFixed(d === undefined ? 1 : d).replace('.', ',');
  const mb = (b) => coma(b / 1048576, 0) + ' MB';
  const veces = (n) => n + (n === 1 ? ' vez' : ' veces');

  function tiempo(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    if (h) return h + ' h ' + m + ' min';
    if (m) return m + ' min ' + x + ' s';
    return x + ' s';
  }

  function hora(t) {
    return new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit',
      minute: '2-digit', second: '2-digit' });
  }

  /* La frase de comparar, una por lengua. La de castellano es la de
   * siempre; las demás dicen lo mismo en cada lengua. */
  const FRASE = {
    es: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha '
      + 'mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga '
      + 'antigua, rocín flaco y galgo corredor.',
    en: 'The library was quiet, and the only sound was the slow turning of pages.',
    fr: 'La bibliothèque était silencieuse ; on n\'entendait que le bruit des '
      + 'pages qu\'on tournait lentement.',
    it: 'La biblioteca era silenziosa, e si sentiva soltanto il fruscio delle '
      + 'pagine voltate piano.',
    pt: 'A biblioteca estava em silêncio, e só se ouvia o virar lento das páginas.',
    de: 'Die Bibliothek war still, und man hörte nur das langsame Umblättern '
      + 'der Seiten.'
  };

  /* El texto de la escucha larga: unos tres minutos de voz, dichos quince
   * veces seguidas. Que se repita no le quita nada a la prueba: cada vuelta
   * se vuelve a hacer entera, que es lo que se mide. */
  const PRUEBA = [
    'Leer en voz alta es una costumbre más vieja que los libros. Durante '
      + 'siglos, quien sabía leer leía para los demás: en la plaza, en la '
      + 'cocina, en el taller, junto a la cama de un enfermo. El texto no era '
      + 'algo que uno recorría en silencio con los ojos, sino algo que se oía, '
      + 'que se compartía y que duraba exactamente lo que duraba la voz que lo '
      + 'decía.',
    'Con la imprenta los libros se volvieron baratos y la lectura se hizo '
      + 'íntima. Cada quien con su ejemplar, cada quien con su ritmo. Ganamos '
      + 'mucho: la libertad de volver atrás, de saltarnos una página, de '
      + 'detenernos en una frase hasta entenderla. Pero perdimos la compañía '
      + 'de la voz, y con ella algo de la música que todo buen escritor pone '
      + 'en sus frases.',
    'Hoy la voz regresa por otro camino. Una máquina pequeña, que cabe en el '
      + 'bolsillo, puede leernos un capítulo mientras caminamos, mientras '
      + 'cocinamos o mientras manejamos de regreso a casa. No lo hace como un '
      + 'buen lector, que sabe cuándo bajar el tono y cuándo dejar que el '
      + 'silencio diga lo suyo. Pero lo hace con una paciencia infinita, a '
      + 'cualquier hora, y sin cansarse nunca.',
    'Esta prueba sirve precisamente para eso: para saber si este teléfono es '
      + 'capaz de leer durante horas sin quedarse callado. Mientras la pantalla '
      + 'está encendida, la voz se va preparando con ventaja. Cuando la '
      + 'pantalla se apaga, el teléfono ahorra energía y trabaja más despacio, '
      + 'y entonces lo que importa es si alcanza a preparar cada frase antes de '
      + 'que termine la anterior.',
    'Si al volver a mirar la pantalla el informe dice que no hubo cortes, la '
      + 'idea funciona tal como está pensada. Si dice que hubo varios, sabremos '
      + 'cuánto adelanto hace falta, o si conviene una voz más ligera. En '
      + 'cualquier caso, lo que se mide aquí es lo que decide cómo seguir.',
    'Un libro, al final, es una conversación aplazada. Alguien escribió hace '
      + 'años, o hace siglos, pensando en un lector que no conocía. Que esa '
      + 'conversación llegue ahora por los oídos y no por los ojos no le quita '
      + 'nada; quizá le devuelve algo de lo que tuvo al principio, cuando leer '
      + 'era, casi siempre, escuchar.'
  ].join('\n\n');
  const VUELTAS = 15;

  /* ------------------------------------------------------------ ajustes */

  const CLAVE = 'lector-pruebas-ajustes';
  const A = Object.assign({ voz: Voz.VOCES[0][0], vel: '1', delante: '1200',
    fuente: 'prueba' }, (() => {
    try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); }
    catch (_) { return {}; }
  })());

  function guardaAjustes() {
    try { localStorage.setItem(CLAVE, JSON.stringify(A)); } catch (_) { /* */ }
  }

  const base = (id) => id.split(':')[0];
  const rotulo = (id) => (Voz.VOCES.find((v) => v[0] === id) || [id, id])[1];

  /* ------------------------------------------------------------- la voz */

  const H = { hay: {}, bajando: null, progreso: null, error: '', medida: '' };

  function pintaVoces() {
    const sel = $('#voz');
    const grupos = {};
    Voz.VOCES.forEach(([id, rot, l]) => {
      (grupos[l] = grupos[l] || []).push('<option value="' + id + '">' + rot
        + '</option>');
    });
    sel.innerHTML = Object.keys(grupos).map((l) => '<optgroup label="'
      + (Voz.LENGUAS[l] || l) + '">' + grupos[l].join('') + '</optgroup>').join('');
    if (!Voz.VOCES.some((v) => v[0] === A.voz)) A.voz = Voz.VOCES[0][0];
    sel.value = A.voz;
    $('#vel').value = A.vel;
    $('#delante').value = A.delante;
    $('#fuente').value = A.fuente;
  }

  function pintaVoz() {
    const b = base(A.voz);
    const hay = H.hay[b];
    const est = $('#voz-estado');
    const barra = $('#voz-barra');
    const ocupado = H.bajando !== null;
    barra.hidden = H.bajando !== b;
    if (H.bajando === b) {
      const p = H.progreso || { hecho: 0, total: 0 };
      est.textContent = 'Bajando… ' + mb(p.hecho)
        + (p.total > p.hecho ? ' de ' + mb(p.total) : '');
      barra.firstElementChild.style.width = p.total
        ? Math.min(100, (100 * p.hecho) / p.total) + '%' : '5%';
    } else if (hay === undefined) {
      est.textContent = 'Mirando si está bajada…';
    } else if (!hay) {
      est.textContent = (H.error ? H.error + '. ' : '') + 'No está bajada. La '
        + 'primera vez son 29 MB del motor, comunes a todas las voces, más la '
        + 'voz: mejor con wifi.';
    } else {
      est.textContent = 'Bajada: habla sin conexión.';
    }
    $('#b-baja').hidden = hay !== false;
    $('#b-baja').disabled = ocupado;
    $('#b-quita').hidden = !hay;
    $('#b-prueba').disabled = !hay || ocupado;
    $('#voz-medida').textContent = H.medida;
  }

  async function miraVoz() {
    const b = base(A.voz);
    if (H.hay[b] !== undefined) { pintaVoz(); return; }
    pintaVoz();
    try { H.hay[b] = await Voz.hay(A.voz); }
    catch (err) { H.hay[b] = false; H.error = err.message; }
    pintaVoz();
  }

  function juicio(x, id) {
    if (document.visibilityState === 'hidden') {
      return 'Con la página escondida no vale: el navegador la frena. Repítela '
        + 'mirando la pantalla.';
    }
    return x >= 3 ? 'Va sobrada.'
      : x >= 1.5 ? 'Va bien con la pantalla encendida; con la apagada lo dirá '
        + 'la escucha larga.'
      : 'Va justa: es fácil que se quede callada entre frases.'
        + (/x_low$/.test(id) ? '' : ' Prueba una ligera (x_low).');
  }

  function medidaDe(r, id) {
    const x = r.segundos / (r.ms / 1000);
    return { x: x, texto: 'Hace ' + coma(r.segundos) + ' s de voz en '
      + coma(r.ms / 1000) + ' s: ' + coma(x) + ' veces más deprisa de lo que '
      + 'la dice. ' + juicio(x, id) };
  }

  function oye(blob) {
    return new Promise((res) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      const fin = () => { URL.revokeObjectURL(url); res(); };
      a.addEventListener('ended', fin);
      a.addEventListener('error', fin);
      a.play().catch(fin);
    });
  }

  $('#voz').addEventListener('change', (ev) => {
    A.voz = ev.target.value;
    H.medida = '';
    H.error = '';
    guardaAjustes();
    miraVoz();
    Voz.cambia({ voz: A.voz });
  });

  $('#vel').addEventListener('change', (ev) => {
    A.vel = ev.target.value;
    guardaAjustes();
    Voz.cambia({ vel: +A.vel });
  });

  $('#b-baja').addEventListener('click', async () => {
    const b = base(A.voz);
    H.bajando = b;
    H.progreso = null;
    H.error = '';
    pintaVoz();
    try {
      await Voz.baja(A.voz, (p) => { H.progreso = p; pintaVoz(); });
      H.hay[b] = true;
    } catch (err) {
      H.hay[b] = false;
      H.error = 'No se ha podido bajar (' + (err.message || 'sin red') + ')';
    }
    H.bajando = null;
    pintaVoz();
  });

  $('#b-prueba').addEventListener('click', async () => {
    const boton = $('#b-prueba');
    boton.disabled = true;
    H.medida = 'Haciendo la prueba… (la primera vez carga la voz en memoria)';
    pintaVoz();
    try {
      const r = await Voz.prueba(A.voz, FRASE[Voz.lenguaDe(A.voz)] || FRASE.es, +A.vel);
      H.medida = medidaDe(r, A.voz).texto;
      pintaVoz();
      await oye(r.blob);
    } catch (err) {
      H.medida = 'La prueba ha fallado: ' + err.message;
    }
    pintaVoz();
  });

  $('#b-quita').addEventListener('click', async () => {
    if (!confirm('¿Quitar «' + rotulo(A.voz) + '» de este teléfono? Se puede '
      + 'volver a bajar cuando quieras.')) return;
    try { await Voz.quita(A.voz); } catch (_) { /* ya no estaba */ }
    H.hay[base(A.voz)] = false;
    H.medida = '';
    pintaVoz();
  });

  /* ---------------------------------------------------- comparar voces */

  $('#b-compara').addEventListener('click', async () => {
    const boton = $('#b-compara');
    const est = $('#compara-estado');
    if (Voz.estado().estado !== 'parada') {
      est.textContent = 'Primero para la escucha larga.';
      return;
    }
    const l = Voz.lenguaDe(A.voz);
    const ids = Voz.VOCES.filter((v) => v[2] === l).map((v) => v[0]);
    // cuáles están bajadas, sin pintar de más
    for (const id of ids) {
      if (H.hay[base(id)] === undefined) {
        try { H.hay[base(id)] = await Voz.hay(id); } catch (_) { H.hay[base(id)] = false; }
      }
    }
    const listas = ids.filter((id) => H.hay[base(id)]);
    if (listas.length < 2) {
      est.textContent = 'Hacen falta al menos dos voces bajadas de esta lengua '
        + '(hay ' + listas.length + '). Elige otra arriba y bájala.';
      return;
    }
    boton.disabled = true;
    const hechas = [];
    for (const id of listas) {
      est.textContent = 'Ahora: ' + rotulo(id) + '…';
      try {
        const r = await Voz.prueba(id, FRASE[l] || FRASE.es, +A.vel);
        hechas.push(rotulo(id) + ': ' + coma(medidaDe(r, id).x) + ' veces');
        est.textContent = 'Ahora: ' + rotulo(id);
        await oye(r.blob);
      } catch (err) {
        hechas.push(rotulo(id) + ': falló (' + err.message + ')');
      }
    }
    est.textContent = 'Lo que tarda cada una en este teléfono (más es mejor): '
      + hechas.join(' · ');
    boton.disabled = false;
  });

  /* --------------------------------------------------- la escucha larga */

  const T = { texto: '', nombre: '', trozos: [] };

  function textoDeFuente() {
    if (A.fuente === 'prueba') {
      return { texto: Array(VUELTAS).fill(PRUEBA).join('\n\n'),
        nombre: 'el texto de prueba' };
    }
    if (A.fuente === 'pega') return { texto: $('#pega').value, nombre: 'el texto pegado' };
    return { texto: T.texto, nombre: T.nombre };
  }

  function pintaTexto() {
    $('#pega').hidden = A.fuente !== 'pega';
    const f = textoDeFuente();
    const est = $('#texto-estado');
    if (!f.texto.trim()) {
      est.textContent = A.fuente === 'txt' ? 'Elige el archivo.' : 'Pega un texto.';
      return;
    }
    const n = Voz.trocea(f.texto, Voz.lenguaDe(A.voz)).length;
    // unos quince caracteres por segundo, medido en Liturgicum
    est.textContent = f.nombre.charAt(0).toUpperCase() + f.nombre.slice(1)
      + ': ' + n + ' frases, unos ' + tiempo(f.texto.length / 15) + ' de escucha.';
  }

  /** Un TXT puede venir en UTF-8 o en el Latin-1 de Windows; si no es UTF-8
   *  válido, es lo otro. */
  async function leeTxt(file) {
    const b = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
    catch (_) { return new TextDecoder('windows-1252').decode(b); }
  }

  $('#fuente').addEventListener('change', (ev) => {
    A.fuente = ev.target.value;
    guardaAjustes();
    if (A.fuente === 'txt' && !T.texto) $('#txt').click();
    pintaTexto();
  });

  $('#txt').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    T.texto = await leeTxt(f);
    T.nombre = f.name;
    pintaTexto();
  });

  $('#pega').addEventListener('input', pintaTexto);

  $('#delante').addEventListener('change', (ev) => {
    A.delante = ev.target.value;
    guardaAjustes();
    Voz.cambia({ delante: +A.delante });
  });

  $('#b-empieza').addEventListener('click', () => {
    const b = base(A.voz);
    if (!H.hay[b]) {
      $('#texto-estado').textContent = 'Primero baja la voz, arriba.';
      return;
    }
    if (A.fuente === 'txt' && !T.texto) { $('#txt').click(); return; }
    const f = textoDeFuente();
    T.trozos = Voz.trocea(f.texto, Voz.lenguaDe(A.voz));
    if (!T.trozos.length) { pintaTexto(); return; }
    Voz.lee(T.trozos, 0, { voz: A.voz, vel: +A.vel, delante: +A.delante,
      titulo: 'Pruebas de voz' });
  });

  $('#b-pausa').addEventListener('click', () => {
    if (Voz.estado().estado === 'pausada') Voz.sigue(); else Voz.pausa();
  });
  $('#b-para').addEventListener('click', () => Voz.para());
  $('#b-atras').addEventListener('click', () => Voz.ve(Voz.estado().i - 1));
  $('#b-adelante').addEventListener('click', () => Voz.ve(Voz.estado().i + 1));

  Voz.on('trozo', (k) => {
    const tz = T.trozos[k];
    if (tz) $('#ahora').textContent = tz.texto;
    pintaCifras();
  });

  Voz.on('estado', (e) => {
    $('#b-empieza').disabled = e !== 'parada';
    $('#b-pausa').disabled = e === 'parada';
    $('#b-pausa').textContent = e === 'pausada' ? 'Seguir' : 'Pausa';
    $('#b-para').disabled = e === 'parada';
    $('#saltos').hidden = e === 'parada';
    $('#b-compara').disabled = e !== 'parada';
    if (e === 'parada') $('#ahora').textContent = '—';
    pintaCifras();
    pintaInforme();
  });

  Voz.on('error', (err) => {
    $('#texto-estado').textContent = 'La voz ha fallado: ' + err.message;
  });

  /* ------------------------------------------------------- las cifras */

  function ritmo(r) { return r && r.n && r.ms ? r.voz / (r.ms / 1000) : null; }

  function pintaCifras() {
    const e = Voz.estado();
    const m = e.medida;
    const c = $('#cifras');
    if (!m || e.estado === 'parada') { c.innerHTML = ''; return; }
    const rv = ritmo(m.ritmo.visible), rh = ritmo(m.ritmo.hidden);
    const cortes = m.cortes.reduce((s, x) => s + x.seg, 0);
    const cifra = (v, t, cl) => '<div class="cifra"><b' + (cl ? ' class="' + cl + '"' : '')
      + '>' + v + '</b><span>' + t + '</span></div>';
    c.innerHTML = [
      cifra((e.i + 1) + ' de ' + e.n, 'frase'),
      cifra(tiempo(m.escuchado.visible + m.escuchado.hidden), 'escuchado'),
      cifra(tiempo(e.adelanto), 'de voz preparada por delante'),
      cifra(mb(e.memoria), 'en memoria'),
      cifra(rv ? coma(rv) + '×' : '—', 'ritmo con la pantalla encendida',
        rv ? (rv >= 1.2 ? 'bien' : 'mal') : ''),
      cifra(rh ? coma(rh) + '×' : '—', 'ritmo con la pantalla apagada',
        rh ? (rh >= 1.05 ? 'bien' : 'mal') : ''),
      cifra(m.cortes.length + (m.cortes.length ? ' · ' + tiempo(cortes) : ''),
        'cortes: se quedó sin voz', m.cortes.length ? 'mal' : 'bien'),
      cifra(m.pausa.n ? coma(m.pausa.total / m.pausa.n, 2) + ' s' : '—',
        'pausa de más entre frases')
    ].join('');
  }

  /* ------------------------------------------------------- el informe */

  function navegador(ua) {
    ua = ua || navigator.userAgent;
    const and = ua.match(/Android [\d.]+/);
    const chr = ua.match(/Chrome\/[\d.]+/);
    return [and ? and[0] : (/Windows/.test(ua) ? 'Windows' : 'otro sistema'),
      chr ? chr[0] : 'otro navegador'].join(' · ');
  }

  function veredicto(m) {
    const rh = ritmo(m.ritmo.hidden);
    const congela = m.eventos.filter((x) => x.que === 'freeze').length;
    const r = [];
    if (!rh || m.ritmo.hidden.n < 5) {
      r.push('Falta probar con la pantalla apagada: no se llegó a hacer voz con '
        + 'ella apagada.');
    } else if (rh >= 1.05) {
      r.push('Con la pantalla apagada hace la voz más deprisa de lo que la dice ('
        + coma(rh) + '×): un libro entero puede sonar sin cortes, leyendo en el '
        + 'momento.');
    } else {
      const dura = m.delante / (1 - rh);
      r.push('Con la pantalla apagada hace la voz más despacio de lo que la dice ('
        + coma(rh) + '×): el adelanto se va gastando. Con ' + tiempo(m.delante)
        + ' de adelanto alcanzaría para unos ' + tiempo(dura) + ' de pantalla '
        + 'apagada; después, cortes. Conviene probar una voz ligera (x_low).');
    }
    if (m.cortes.length) {
      r.push('Se quedó sin voz preparada ' + veces(m.cortes.length) + '.');
    }
    if (congela) {
      r.push('El teléfono congeló la página ' + veces(congela) + ': eso corta '
        + 'aunque el ritmo alcance.');
    }
    return r.join(' ');
  }

  function informe(m) {
    if (!m) return 'Todavía no hay ninguna prueba.';
    const rv = ritmo(m.ritmo.visible), rh = ritmo(m.ritmo.hidden);
    const total = m.escuchado.visible + m.escuchado.hidden;
    const cortes = m.cortes.reduce((s, x) => s + x.seg, 0);
    const ad = (x) => (x === null || x === undefined ? '—' : tiempo(x));
    const l = [
      'Lector · prueba de escucha larga',
      new Date(m.inicio).toLocaleString('es-MX') + ' – '
        + (m.fin ? hora(m.fin) : 'en curso'),
      'Voz: ' + m.voz + ' · velocidad ' + m.vel + ' · adelanto máx. '
        + tiempo(m.delante),
      'Aparato: ' + navegador(m.aparato),
      '',
      'Escuchado: ' + tiempo(total) + ' (' + m.frases + ' frases): '
        + tiempo(m.escuchado.visible) + ' con la pantalla encendida, '
        + tiempo(m.escuchado.hidden) + ' con la apagada',
      'Ritmo de la voz (cuántas veces más deprisa la hace de lo que la dice):',
      '  pantalla encendida: ' + (rv ? coma(rv, 2) + '×' : '—') + ' ('
        + m.ritmo.visible.n + ' frases)',
      '  pantalla apagada:   ' + (rh ? coma(rh, 2) + '×' : '—') + ' ('
        + m.ritmo.hidden.n + ' frases)',
      'Cortes (se quedó sin voz): ' + m.cortes.length
        + (m.cortes.length ? ' · ' + tiempo(cortes) + ' callada en total' : ''),
      'Pausa de más entre frases: '
        + (m.pausa.n ? coma(m.pausa.total / m.pausa.n, 2) + ' s de media' : '—'),
      'Adelanto mínimo: encendida ' + ad(m.minAdelanto.visible) + ' · apagada '
        + ad(m.minAdelanto.hidden),
      'Memoria del adelanto, como mucho: ' + mb(m.maxMemoria),
      '',
      'Veredicto: ' + veredicto(m)
    ];
    if (m.cortes.length) {
      l.push('', 'Cortes:');
      m.cortes.slice(-20).forEach((x) => l.push('  ' + hora(x.t) + ' frase '
        + (x.k + 1) + ' · ' + coma(x.seg) + ' s' + (x.oculta ? ' · pantalla apagada' : '')));
    }
    l.push('', 'Lo que pasó:');
    const NOMBRE = { empieza: 'empieza', 'pantalla-hidden': 'se apaga la pantalla',
      'pantalla-visible': 'se enciende la pantalla', freeze: 'el teléfono congela la página',
      resume: 'la descongela', pagehide: 'la página se esconde',
      pageshow: 'la página vuelve', pausa: 'pausa', sigue: 'sigue',
      salta: 'salto de frase', para: 'para', fin: 'se acaba el texto' };
    m.eventos.slice(-40).forEach((x) => l.push('  ' + hora(x.t) + ' '
      + (NOMBRE[x.que] || x.que) + ' (frase ' + (x.k + 1) + ')'));
    return l.join('\n');
  }

  function pintaInforme() {
    const e = Voz.estado();
    $('#informe').textContent = informe(e.medida || Voz.ultimoInforme());
  }

  $('#b-copia').addEventListener('click', async () => {
    const t = $('#informe').textContent;
    const b = $('#b-copia');
    try {
      await navigator.clipboard.writeText(t);
      b.textContent = 'Copiado';
    } catch (_) {
      // sin permiso para el portapapeles: se deja seleccionado
      const r = document.createRange();
      r.selectNodeContents($('#informe'));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      b.textContent = 'Seleccionado: cópialo';
    }
    setTimeout(() => { b.textContent = 'Copiar el informe'; }, 2500);
  });

  // con la pantalla encendida, las cifras al segundo; escondida no hace falta
  setInterval(() => {
    if (document.visibilityState === 'visible' && Voz.estado().estado !== 'parada') {
      pintaCifras();
      pintaInforme();
    }
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pintaCifras(); pintaInforme(); }
  });

  /* ------------------------------------------------------- al abrir */

  pintaVoces();
  miraVoz();
  pintaTexto();
  pintaInforme();
})();
