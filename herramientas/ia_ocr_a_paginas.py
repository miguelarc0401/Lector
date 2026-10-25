"""De un EPUB hecho por OCR en el Internet Archive a páginas para paginas_a_epub.py.

Los EPUB «[ocr]» de archive.org (hocr-to-epub) traen una página impresa por
archivo (page_N.html), toda en un solo párrafo, y con lo que en Lector
estorba al oírlo: la cabecera y el número de cada página, las notas al pie
pegadas al texto, la palabra partida entre dos páginas, las erratas del OCR
y, en las páginas de fotos, letras sueltas sin sentido.

Este script saca, de cada página que vale, un NNNN.txt con el formato de
paginas_a_epub.py (NNNN = el N de page_N.html):

  - quita la cabecera y el número de la página (y lo apunta: «@ 14»);
  - pone los títulos de `indice.txt` (# parte, ## capítulo, ### sección,
    #### apartado) donde los encuentra, en mayúsculas, en su página;
  - separa las notas del pie (bajo «====») y pone su llamada [^n]; la nota
    cuya llamada no aparece se llama al final de su página;
  - une la palabra partida entre dos páginas y pega al párrafo de antes
    («+») la frase que sigue en la página siguiente;
  - arregla las erratas típicas del OCR (c/e, n/u, l/i, rn/m…) cuando la
    palabra no existe y el cambio da una que sí: en el diccionario de
    español de LibreOffice o en el propio libro.

Lo que no se sabe arreglar solo va a `informe.txt`, página por página.

Las páginas de `revisadas/` (NNNN.txt hechos o corregidos a mano, en el
mismo formato y con sus títulos) pasan tal cual: mandan sobre lo de aquí.

En la carpeta del libro van también:

  receta.txt    omitir: 0-15 19-21 …     páginas del EPUB que no entran
                cabecera: LA EXPLOSIÓN   cada cabecera de página del libro
                cambio: sj s] => SJ      palabras que se cambian siempre
                (renglones con // son comentarios)
  indice.txt    # | 11 | I. Gente de Iglesia, católicos y cristeros
                ## | 13 | 1. Los obispos, Roma y la lucha armada
                nivel | página impresa | título | (si hace falta) el texto
                del título como se busca en la página; si no, el título
                sin su número («1. », «II. »)

Uso:
    python ia_ocr_a_paginas.py LIBRO.epub CARPETA_DEL_LIBRO
    (escribe CARPETA_DEL_LIBRO/paginas/ e informe.txt; luego, el EPUB:
     python paginas_a_epub.py CARPETA_DEL_LIBRO/paginas SALIDA.epub)
"""
import argparse
import difflib
import html
import re
import statistics
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

DICC = Path(r'C:\Program Files\LibreOffice\share\extensions\dict-es')
LETRA = 'A-Za-zÁÉÍÓÚÑÜáéíóúñüÀ-ÿ'
FIN_FRASE = '.!?…”»")]:;'
# abreviaturas tras las que un punto no acaba la frase
ABREV = set('''p pp t vol vols núm fol leg exp f ff cap caps n nn op cit loc ed
    eds trad art arts Mons Sr Sra Sres Srta D Dña Dr Lic Gral Ing Pbro P PP RP
    S SS Sto Sta etc cf ibid íd Excmo Exmo Ilmo Rmo Rvdo Ntra Nra Ntro Jal Zac
    Mich Gro Gto Ags Dgo Col Mor Pue Oax Qro Méx Tamps Sin Nay Coah Chih Hgo
    Edo ca aprox Cía Hnos ms mss sec secs vid'''.split())


# ------------------------------------------------------------ diccionario

class Hunspell:
    """Lo justo de Hunspell para saber si una palabra existe: la raíz del
    .dic con un sufijo (y otro detrás, si la regla lo deja) o un prefijo."""

    def __init__(self, aff, dic):
        self.sfx, self.pfx = defaultdict(list), defaultdict(list)
        for l in open(aff, encoding='utf-8').read().splitlines():
            p = l.split()
            if len(p) < 5 or p[0] not in ('SFX', 'PFX'):
                continue
            tipo, flag, quita, pone, cond = p[:5]
            quita = '' if quita == '0' else quita
            pone, _, sigue = pone.partition('/')
            pone = '' if pone == '0' else pone
            cond = '' if cond == '.' else cond
            try:
                rx = re.compile(cond + '$' if tipo == 'SFX' else '^' + cond)
            except re.error:
                continue
            (self.sfx if tipo == 'SFX' else self.pfx)[pone].append((flag, quita, rx, set(sigue)))
        self.raices = defaultdict(set)
        for l in open(dic, encoding='utf-8').read().splitlines()[1:]:
            w, _, fl = l.partition('/')
            if w.strip():
                self.raices[w.strip()] |= set(fl.split()[0]) if fl.strip() else set()
        self.vistas = {}

    def _sufijo(self, w, segundo=None):
        for i in range(len(w) + 1):
            for flag, quita, rx, sigue in self.sfx.get(w[i:], ()):
                if segundo is not None and segundo not in sigue:
                    continue
                base = w[:i] + quita
                if not base or not rx.search(base):
                    continue
                if flag in self.raices.get(base, ()):
                    return True
                if segundo is None and self._sufijo(base, flag):
                    return True
        return False

    def _existe(self, w):
        if w in self.raices or self._sufijo(w):
            return True
        for i in range(1, len(w)):
            for flag, quita, rx, _ in self.pfx.get(w[:i], ()):
                base = quita + w[i:]
                if rx.search(base) and flag in self.raices.get(base, ()):
                    return True
        return False

    def existe(self, w):
        if w not in self.vistas:
            self.vistas[w] = (self._existe(w) or (w[:1].isupper() and self._existe(w.lower()))
                              or (w.isupper() and self._existe(w.capitalize())))
        return self.vistas[w]


# --------------------------------------------------------------- utilidades

def sin_acentos(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def norm(s):
    """Para comparar títulos: mayúsculas, sin acentos ni signos."""
    return re.sub(r'[^A-Z0-9]+', ' ', sin_acentos(s).upper()).strip()


def parecido(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def letras(tok):
    return re.sub('[^%s]' % LETRA, '', tok)


def es_mayus(tok):
    """En mayúsculas, aunque el OCR haya bajado alguna («LeS ALTOS»)."""
    le = letras(tok)
    return len(le) >= 2 and sum(c.isupper() for c in le) >= .6 * len(le)


def palabra(tok):
    """(lo de antes, la palabra, lo de después) de un token con signos."""
    m = re.match(r'^([^%s]*)([%s](?:[%s\'’]*[%s])?)([^%s]*)$' % ((LETRA,) * 5), tok)
    return m.groups() if m else None


# ------------------------------------------------------------------ leer

def paginas_del_epub(ruta):
    z = zipfile.ZipFile(ruta)
    pags = {}
    for nm in z.namelist():
        m = re.search(r'page_(\d+)\.x?html?$', nm)
        if not m:
            continue
        t = z.read(nm).decode('utf-8')
        c = re.search(r'<body[^>]*>(.*)</body>', t, re.S)
        b = c.group(1) if c else ''
        mala = 'estimated to be only' in b
        b = re.sub(r'<b>The text on this page.*?</b>', ' ', b, flags=re.S)
        txt = html.unescape(re.sub(r'<[^>]+>', ' ', b))
        pags[int(m.group(1))] = (re.sub(r'\s+', ' ', txt).strip(), mala)
    return pags


def lee_receta(carpeta):
    omitir, cabeceras, cambios = set(), [], {}
    for l in (carpeta / 'receta.txt').read_text(encoding='utf-8').splitlines():
        l = l.strip()
        if not l or l.startswith('//'):
            continue
        clave, _, valor = l.partition(':')
        clave, valor = clave.strip().lower(), valor.strip()
        if clave == 'omitir':
            for r in valor.split():
                a, _, b = r.partition('-')
                omitir.update(range(int(a), int(b or a) + 1))
        elif clave == 'cabecera':
            cabeceras.append(norm(valor))
        elif clave == 'cambio':
            de, _, a = valor.partition('=>')
            for w in de.split():
                cambios[w] = a.strip()
    return omitir, cabeceras, cambios


def lee_indice(carpeta):
    titulos = []
    for l in (carpeta / 'indice.txt').read_text(encoding='utf-8').splitlines():
        p = [x.strip() for x in l.split('|')]
        if len(p) < 3 or not re.fullmatch(r'#{1,4}', p[0]):
            continue
        busca = p[3] if len(p) > 3 and p[3] else re.sub(r'^(?:[IVX]+|\d+)\.\s+', '', p[2])
        titulos.append({'nivel': len(p[0]), 'pag': int(p[1]), 'titulo': p[2], 'busca': norm(busca)})
    return titulos


# ------------------------------------------- cabecera y número de página

def numero(tok):
    d = re.sub(r'\D', '', tok)
    return int(d) if d and len(d) <= 3 else None


def cabecera(toks, cabeceras):
    """¿Empieza la página con su cabecera? → (tokens que ocupa, número que
    trae o None) o None. Verso: «14 GENTE DE IGLESIA…»; recto:
    «LOS OBISPOS, ROMA… 15»."""
    i = 0
    while i < len(toks) and not re.search(r'\w', toks[i]):
        i += 1
    mejor = None
    for h in cabeceras:
        k = len(h.split())
        for kk in (k, k + 1, k - 1):
            if kk < 1:
                continue
            # verso: el número primero
            if i + 1 + kk <= len(toks) and re.fullmatch(r'[\dlIOoSs/|]{1,4}\W?', toks[i]) \
                    and re.search(r'\d', toks[i]):
                r = parecido(norm(' '.join(toks[i + 1:i + 1 + kk])), h)
                if r >= .8 and (not mejor or r > mejor[0]):
                    mejor = (r, i + 1 + kk, numero(toks[i]))
            # recto: el número detrás
            if i + kk < len(toks):
                r = parecido(norm(' '.join(toks[i:i + kk])), h)
                if r >= .8 and (not mejor or r > mejor[0]):
                    sig = toks[i + kk]
                    tras = toks[i + kk + 1] if i + kk + 1 < len(toks) else ''
                    if re.fullmatch(r'[\dlIOoSs/|]{1,4}\W?', sig) and re.search(r'\d', sig):
                        mejor = (r, i + kk + 1, numero(sig))
                    elif len(sig) <= 3 and tras[:1].islower() and not sig[:1].islower():
                        mejor = (r, i + kk + 1, None)    # «Al tica»: 71 mal leído
                    else:
                        mejor = (r, i + kk, None)
    return (mejor[1], mejor[2]) if mejor else None


RX_PIE = re.compile(r'\s*[\[(]\s*(\d{1,3})\s*[\])]\s*$|\s*[\[(]\s*(\d{1,3})\s*$|\s+(\d{1,3})\s*[\])]\s*$')


def numero_al_pie(t):
    """El número de página entre corchetes al final («[13]», «(30]»)."""
    m = RX_PIE.search(t)
    if not m:
        return t, None
    return t[:m.start()], int(next(g for g in m.groups() if g))


def numera(pags, orden, cabeceras):
    """El número impreso de cada página: el que trae, corregido con el de
    las vecinas (la diferencia con el número del archivo sólo cambia donde
    hay láminas de fotos o faltan páginas)."""
    dif = {}
    for n in orden:
        t = pags[n][0]
        _, pie = numero_al_pie(t)
        cab = cabecera(t.split(), cabeceras)
        crudo = pie if pie is not None else (cab[1] if cab else None)
        if crudo is not None:
            dif[n] = n - crudo
    numeros = {}
    con = [n for n in orden if n in dif]
    for n in orden:
        antes = [dif[m] for m in con if m < n][-3:]
        despues = [dif[m] for m in con if m > n][:3]
        izq = statistics.median_low(antes) if antes else None
        der = statistics.median_low(despues) if despues else None
        if n in dif and dif[n] in (izq, der):
            d = dif[n]
        elif izq is not None:
            d = izq      # mal leído, o sin número: sigue la cuenta de antes
        elif der is not None:
            d = der
        else:
            continue
        numeros[n] = n - d
    return numeros


# ------------------------------------------------------------- títulos

def busca_titulos(toks, esperados):
    """Dónde están, en orden, los títulos que tocan a esta página: [(i, j,
    título, cola)]: tokens de i a j; cola, lo que lleva pegado el último
    (una llamada: «CRISTEROS59»)."""
    hallados, desde = [], 0
    for t in esperados:
        h = t['busca']
        k = len(h.split())
        mejor = None
        for i in range(desde, len(toks)):
            if not (es_mayus(toks[i]) or (len(toks[i]) <= 2 and not toks[i][:1].islower())
                    or re.fullmatch(r'[\d.()\-–:,]+|l\.?', toks[i])):
                continue
            for kk in range(max(1, k - 2), k + 3):
                tramo = toks[i:i + kk]
                if len(tramo) < kk or not all(es_mayus(x) or len(letras(x)) <= 2 for x in tramo):
                    continue
                if not any(es_mayus(x) for x in tramo):
                    continue
                r = parecido(norm(' '.join(tramo)), h)
                if r >= .8 and (not mejor or r > mejor[0] + .001):
                    mejor = (r, i, i + kk)
        if mejor:
            _, i, j = mejor
            while i < j - 1 and not re.search(r'\w', toks[i]):
                i += 1
            # el número del capítulo delante («l LOS OBISPOS», «3 LA RESPUESTA»)
            if i > desde and t['nivel'] <= 2 and re.fullmatch(r'[\dlIJ]{1,2}\.?', toks[i - 1]):
                i -= 1
            # lo que lleva pegado la última palabra: una llamada («CRISTEROS59»)
            ult, tok = h.split()[-1], toks[j - 1]
            cola, cuenta = '', 0
            if norm(tok).replace(' ', '').startswith(ult) and not ult[-1].isdigit():
                for k, c in enumerate(tok):
                    if norm(c):
                        cuenta += 1
                    if cuenta == len(ult):
                        cola = tok[k + 1:]
                        break
            if not re.search(r'[\d%*?]', cola):
                cola = ''
            hallados.append((i, j, t, cola))
            desde = j
        else:
            hallados.append((None, None, t, ''))
    return hallados


# ---------------------------------------------------------------- notas

# lo que suele haber en una nota
RX_CITA = re.compile(r'op\. ?cit|loc\. ?cit|[ÍíIf1]dem|ibid|\bp\. ?\d|\bpp\. ?\d|\bfol\.|\bleg\.|'
                     r'\bexp\.|\bt\. ?[\dIVX]|Meyer|[Tt]estimonio|[Mm]anuscrit|[Aa]rchivo|'
                     r'[Mm]emor[áa]ndum|[Cc]arta|[Ii]nforme|Excélsior|Universal|\b1[89]\d\d\b|'
                     r'\b[A-Z]{2,6}\b')
ANTES_DE_CIFRA = {'p.', 'pp.', 't.', 'núm.', 'fol.', 'leg.', 'vol.', 'vols.', 'art.', 'cap.',
                  'f.', 'n.', 'nn.', 'exp.', 'tomo', 'capítulo', 'número', 'y', 'a', 'al', 'el',
                  'de', 'los', 'las', 'unos', 'sus', 'con', 'en', 'por', 'entre', 'sólo'}


def llamada(tok, ant, sig, c, resto_largo):
    """¿Es `tok` una llamada a nota (toca la `c`)? → (lo que queda del token,
    número leído o None si es ilegible) o None. `ant` y `sig`: los tokens de
    al lado; `resto_largo`: si queda mucha página detrás."""
    # pegada a un signo: «independencia”.1», «montañas;11»
    m = re.fullmatch(r'(.*[.,;:”»"\')!?…\]])(\d{1,3})', tok)
    if m and c <= int(m.group(2)) <= c + 3 and re.search('[%s]' % LETRA, m.group(1)):
        return m.group(1), int(m.group(2))
    # ilegible, tras un signo: «cabeza.?*», «convertidos”.?», «siguiente,*»
    m = re.fullmatch(r'(.*[%s][.,;:”»"\')\]]+)(?:[?*%%!§$¡]{1,2}\d{0,3}|\d{1,3}[?*%%]|:\*)' % LETRA, tok)
    if m:
        return m.group(1), None
    # «mantenien­do.”t11», «Juchipila.s5»: una letra mal leída por la primera cifra
    m = re.fullmatch(r'(.*[%s][.”»)]+)[a-zA-Z](\d{1,3})' % LETRA, tok)
    if m:
        return m.group(1), None
    # suelta, tras un signo: «contribuir...” ? Cuatro días»
    if re.search(r'[.,;”»"\')…]$', ant) and re.search('[%s]' % LETRA, ant):
        if re.fullmatch(r'[?*%§$]{1,2}|\d[?*%]|[?*%]\d', tok) and resto_largo:
            return '', None
        # «católicos.. .” 8 El 15 de enero»: si es el que toca y la página sigue
        # (si no, es el número de la primera nota: «místico”. 2 El Universal»)
        if re.fullmatch(r'\d{1,3}', tok) and int(tok) == c and resto_largo and abre_nota(sig):
            return '', c
    # pegada a la palabra, a media frase: «montañas11 no»
    m = re.fullmatch(r'(.*[a-záéíóúñü])(\d{1,3})', tok)
    if m and int(m.group(2)) == c and sig[:1].islower():
        return m.group(1), c
    return None


def abre_nota(sig):
    """¿Puede empezar una nota con la palabra `sig`?"""
    return bool(sig) and bool(re.match(r'[A-ZÁÉÍÓÚÑ0-9“"«(¿¡‘\']', sig)
                              or re.match(r'(op|loc|cf|ibid|[íi]d|[íif1]dem|dem)\b', sig, re.I))


DIC = None        # el diccionario (Hunspell), si lo hay: lo pone prepara()
# con lo que empieza una nota y nunca una frase del texto
RX_FUERTE = re.compile(r'(?:[ÍIíi\[f1]dem|Meyer|Mever|Meycr|Mcycr|Mueyer|Jean Meyer|AAA|SJ|UNAM|DSR|'
                       r'LNDLR|AGN|AHDN|Inform|Testimoni|Carta |Corresponden|Manuscrit|Excélsior|'
                       r'Memori|Archivo|Cf\.|Véase|Entrevista|Circular|Telegrama)')
RX_SEGURO = re.compile(r'(?:[ÍIíi\[f1]dem\b|Me[yvc][ce]?[ry]?r? ?/|Jean Me)')


def es_palabra(w):
    return DIC is not None and DIC.existe(w)


def numero_raro(tok):
    """¿Es `tok` un número de nota que el OCR leyó mal? «%», «£2», «1M», «td»…"""
    if re.fullmatch(r'\d{4}', tok):
        return False
    if re.fullmatch(r'[\d%$*?§&¢£<>(“"\'/]{1,3}|\S{0,2}\d{1,3}\S?', tok):
        return True
    # dos o tres letras que no son palabra ni sigla: «td», «ce», «Tm», «xú»
    return (len(tok) <= 3 and not tok.endswith('.') and bool(re.fullmatch('[%s]+[”]?' % LETRA, tok))
            and not es_palabra(tok.rstrip('”')) and not (len(tok) >= 2 and tok.isupper()))


def numero_de_nota(tok, sig, ant, c):
    """¿Es `tok` el número con que empiezan las notas? → (el pedazo de
    palabra que lleve pegado delante: «com1» → «com», la palabra partida del
    texto; el número leído o None; lo que sobra del número; si es seguro) o
    None."""
    m = re.fullmatch(r'([%s][a-záéíóúñü]{0,14})([\d%%$*?]{1,4})' % LETRA, tok)
    if m and not m.group(1).isupper():
        pedazo, num = m.groups()
        if abre_nota(sig):
            return pedazo, (int(num) if num.isdigit() else None), '', True
        # «teo316 de marzo»: la nota 3 empieza por «16 de marzo»
        for k in range(1, len(num)):
            if num.isdigit() and c <= int(num[:k]) <= c + 3:
                return pedazo, int(num[:k]), num[k:], True
        return None
    if not abre_nota(sig):
        return None
    # delante de «Ídem», «Meyer/Acevedo», «AAA»… no hay duda, lo lea como lo
    # lea (delante de «Ídem» y «Meyer/», aunque sea «e» o «Y»)
    if RX_FUERTE.match(sig) and (re.fullmatch(r'\d{1,3}', tok) or numero_raro(tok)
                                 or (RX_SEGURO.match(sig) and len(tok) <= 2)):
        return '', (int(tok) if tok.isdigit() else None), '', True
    if re.fullmatch(r'\d{1,3}', tok):
        v = int(tok)
        if not cuadra(v, c):
            return None
        # tras «de», «y»… una cifra suele ser del texto («de 42 hombres»);
        # sólo vale si es justo la que toca («vicario de 42 90 sacerdotes…»)
        if ant.lower() in ANTES_DE_CIFRA and not cuadra(v, c, 0, 1):
            return None
        return '', v, '', False
    # un signo suelto («texto % Declaraciones…») no es del texto; unas letras
    # sueltas («td», «ce») sólo cuentan tras un punto
    if re.fullmatch(r'[%$*?§&¢£<>/]{1,3}', tok) \
            or (numero_raro(tok) and re.search(r'[.)”»"\'…]$', ant)):
        return '', None, '', False
    return None


def cuadra(v, c, desde=-1, hasta=5):
    """¿Puede ser `v` (leído por el OCR) el número de una nota, si toca la
    `c`? El OCR se come o cambia la primera cifra: «1» o «313» por 113."""
    if v is None:
        return True
    for e in range(max(1, c + desde), c + hasta + 1):
        se, sv = str(e), str(v)
        if v == e or (len(se) > len(sv) and se.endswith(sv)) \
                or (len(sv) == len(se) > 1 and sv[1:] == se[1:]) \
                or (len(sv) == len(se) + 1 and sv.endswith(se)):
            return True
    return False


def otra_nota(tok, sig, ant):
    """Ya en las notas: ¿empieza aquí la siguiente?"""
    if not re.search(r'[.)”»"\']$', ant) or ant.lower() in ANTES_DE_CIFRA:
        return False
    if tok == 'a' and sig.lower().startswith('dem'):
        return True      # «a dem.»: «23 Ídem.»
    if RX_FUERTE.match(sig) and len(tok) <= 3 and not tok.endswith('.'):
        return True      # «… de 1928. e UNAM, fol. 5»
    return numero_raro(tok) and abre_nota(sig)


def acaba_frase(t):
    t = re.sub(r'\[\^[^\]]+\]', '', t)
    base = re.sub(r'[.!?…”»"\')]+$', '', t)
    return bool(re.search(r'[.!?…][”»"\')]*$', t)) and base not in ABREV \
        and not re.fullmatch(r'[A-ZÁÉÍÓÚÑ]', base)


def notas_de_pagina(items, c, sigue_nota=False):
    """`items`: los tokens de la página (str) y sus títulos (dict); c: la
    nota que toca; sigue_nota: si la última nota de la página de antes quedó
    a medias. → (items del texto, notas [(número, o None si es lo que sigue
    de la de antes; texto)], llamadas [(posición, número)], c que sigue)."""
    largos = [len(t) + 1 if isinstance(t, str) else 0 for t in items]
    quedan = [sum(largos[i + 1:]) for i in range(len(items))]
    # si la cuenta se perdió en páginas de antes, las llamadas bien leídas
    # («”.82» … «.83») dicen por dónde va
    leidas = [int(m.group(1)) for t in items if isinstance(t, str)
              for m in [re.fullmatch(r'.*[%s][.,;:”»"\')!?…\]]+(\d{1,3})' % LETRA, t)] if m]
    for a, b in zip(leidas, leidas[1:]):
        if 1 <= b - a <= 2 and not c <= a <= c + 3:
            c = a
            break
    llamadas, cc = [], c
    for i, t in enumerate(items):
        if isinstance(t, dict):
            if t.get('cola'):
                llamadas.append((i, cc))
                cc += 1
            continue
        ant = items[i - 1] if i > 0 and isinstance(items[i - 1], str) else ''
        sig = items[i + 1] if i + 1 < len(items) and isinstance(items[i + 1], str) else ''
        r = llamada(t, ant, sig, cc, quedan[i] > 350)
        if r:
            items[i] = r[0]
            n = r[1] if r[1] is not None else cc
            llamadas.append((i, n))
            cc = n + 1
    # las notas empiezan detrás de la última llamada (y del último título)...
    tras_titulo = max([i + 1 for i, t in enumerate(items) if isinstance(t, dict)] + [0])
    desde = max([i + 1 for i, _ in llamadas] + [tras_titulo])
    # ...salvo que antes haya un comienzo seguro («com1 Se nos dijo», «12 Ídem»):
    # entonces lo que parecía llamada detrás de él es de una nota
    for i in range(tras_titulo, desde):
        if isinstance(items[i], str):
            sig = items[i + 1] if i + 1 < len(items) and isinstance(items[i + 1], str) else ''
            ant = items[i - 1] if i > 0 and isinstance(items[i - 1], str) else '.'
            r = numero_de_nota(items[i], sig, ant, c)
            if r and r[3] and any(j < i for j, _ in llamadas):
                llamadas = [x for x in llamadas if x[0] < i]
                desde = i
                break
    inicio = None
    for i in range(desde, len(items)):
        t = items[i]
        sig = items[i + 1] if i + 1 < len(items) else ''
        ant = items[i - 1] if i > 0 and isinstance(items[i - 1], str) else '.'
        r = numero_de_nota(t, sig, ant, c)
        if r is None:
            continue
        # un pedazo de palabra pegado al número ya dice bastante; si no, que
        # detrás venga algo que se cita, y un número que cuadre si no se
        # vio ninguna llamada
        if not r[0] and not r[3]:
            if not RX_CITA.search(' '.join(items[i + 1:])):
                continue
            if not llamadas and (r[1] is None or not cuadra(r[1], c, 0, 3)):
                continue
        inicio = (i, r[:3])
        break
    fin = inicio[0] if inicio else len(items)
    # lo que sigue de la última nota de la página de antes va entre el texto
    # y la primera nota: empieza tras un punto, con minúscula
    resto = []
    if sigue_nota:
        for k in range(max(desde, 1) - 1, fin - 1):
            if isinstance(items[k], str) and isinstance(items[k + 1], str) and acaba_frase(items[k]) \
                    and re.match('[a-záéíóúñü]', items[k + 1]):
                resto = items[k + 1:fin]
                items = items[:k + 1] + items[fin:]
                if inicio:
                    inicio = (k + 1, inicio[1])
                break
    notas = [(None, resto)] if resto else []
    if inicio:
        i0, (pedazo, leido, sobra) = inicio
        n = leido if leido is not None and c <= leido <= c + 3 else c
        actual = (n, [sobra] if sobra else [])
        # cuánto va del número leído al que le damos: si faltan notas por
        # separar, el último número bien leído dice por dónde sigue la cuenta
        ajuste = leido - n if leido is not None and 0 <= leido - n <= 6 else 0
        for k in range(i0 + 1, len(items)):
            t, ant = items[k], items[k - 1]
            sig = items[k + 1] if k + 1 < len(items) else ''
            if otra_nota(t, sig, ant):
                notas.append(actual)
                n += 1               # el OCR lee mal los números: van seguidos
                actual = (n, [])
                if t.isdigit() and 0 <= int(t) - n <= 6:
                    ajuste = int(t) - n
            else:
                actual[1].append(t)
        notas.append(actual)
        items = items[:i0] + ([pedazo] if pedazo else [])
        cc = max(cc, n + ajuste + 1)
    notas = [(n, ' '.join(x)) for n, x in notas if x]
    # cada nota con su llamada: si hay tantas como notas, por orden; si no,
    # la del mismo número o la siguiente libre; si no hay, al final del texto
    numeradas = [n for n, _ in notas if n is not None]
    libres = [x for x in llamadas if x[0] < len(items)]
    puestas = []
    if len(libres) == len(numeradas):
        puestas = [(i, n) for (i, _), n in zip(libres, numeradas)]
        libres = []
    for n in numeradas[len(puestas):]:
        k = next((x for x in libres if x[1] == n), None) or next(iter(libres), None)
        if k is not None:
            libres = [x for x in libres if x[0] > k[0]]
            puestas.append((k[0], n))
        else:
            j = max((i for i, t in enumerate(items) if isinstance(t, str) and t), default=None)
            if j is None:
                items.append('')
                j = len(items) - 1
            puestas.append((j, n))
    sigue = max([cc] + [n + 1 for n in numeradas])
    return items, notas, puestas, sigue


# --------------------------------------------------------------- erratas

# lo que el OCR confunde, en una letra (o un par)
CAMBIOS_OCR = [('c', 'e'), ('e', 'c'), ('n', 'u'), ('u', 'n'), ('l', 'i'), ('i', 'l'), ('1', 'l'),
               ('0', 'o'), ('rn', 'm'), ('m', 'rn'), ('m', 'n'), ('n', 'm'), ('C', 'G'), ('G', 'C'),
               ('f', 'í'), ('l', 'í'), ('a', 'á'), ('e', 'é'), ('i', 'í'), ('o', 'ó'), ('u', 'ú'),
               ('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u'), ('t', 'l'), ('h', 'b'),
               ('ii', 'ü'), ('cl', 'd'), ('d', 'cl'), ('J', 'I'), ('I', 'l'), ('Í', 'I'), ('Á', 'A'),
               ('Af', 'M')]
MESES = ('(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre'
         '|diciembre)')


class Corrector:
    def __init__(self, textos, cambios):
        self.dicc = DIC
        self.frec = Counter()
        for t in textos:
            for tok in t.split():
                p = palabra(tok)
                if p:
                    self.frec[p[1].lower()] += 1
        self.cambios = cambios
        self.hechos = Counter()

    def en_dicc(self, w):
        return self.dicc is not None and self.dicc.existe(w)

    def conocida(self, w, minimo=3):
        return self.en_dicc(w) or self.frec[w.lower()] >= minimo

    def candidata(self, w):
        """El arreglo de `w`, si no está en el diccionario y cambiando una
        letra sale una que sí está, o que el libro trae mucho más veces."""
        if len(w) < 2 or w.isupper() or self.en_dicc(w):
            return None
        f = self.frec[w.lower()]
        opciones = Counter()
        for a, b in CAMBIOS_OCR:
            k = w.find(a)
            while k >= 0:
                o = w[:k] + b + w[k + len(a):]
                fo = self.frec[o.lower()]
                if w[:1].isupper():
                    # un nombre propio sólo se cambia por otro que el libro trae mucho más
                    vale = fo >= 3 and fo >= 5 * max(f, 1)
                else:
                    vale = (self.en_dicc(o) or fo >= 2) and (f <= 1 or (fo >= 3 and fo >= 5 * f))
                if vale:
                    opciones[o] = fo + .5
                k = w.find(a, k + 1)
        if not opciones:
            return None
        (o, f), *otras = opciones.most_common()
        if otras and otras[0][1] == f:
            return None       # dos arreglos igual de buenos: mejor no tocar
        return o

    def token(self, tok):
        # los cambios fijos de la receta, sobre el token entero
        m = re.fullmatch(r'([(“"«¿¡]*)(.*?)([.,;:)”"»!?]*)', tok)
        if m and m.group(2) in self.cambios:
            self.hechos[m.group(2) + ' → ' + self.cambios[m.group(2)]] += 1
            return m.group(1) + self.cambios[m.group(2)] + m.group(3)
        p = palabra(tok)
        if not p or re.search(r'\d', tok) or tok.endswith('-'):
            return tok
        o = self.candidata(p[1])
        if not o:
            return tok
        self.hechos[p[1] + ' → ' + o] += 1
        return p[0] + o + p[2]

    def texto(self, t):
        out = []
        for tok in t.split():
            if out and re.fullmatch(r'[%s]+[:.\-]' % LETRA, out[-1]) and re.match('[a-záéíóúñü]', tok):
                # palabra partida con un signo en medio: «cris: tiada», «personal. mente»
                p = palabra(tok)
                junta = out[-1][:-1] + p[1] if p else ''
                if p and (self.en_dicc(junta) or (self.conocida(junta, 1)
                                                  and not self.conocida(out[-1][:-1]))):
                    out[-1] = out[-1][:-1] + tok
                    self.hechos['(junta) ' + junta] += 1
                    continue
                # un punto suelto a media frase: «de. clero», «que. los»
                if out[-1] in ('de.', 'que.', 'a.', 'y.', 'en.', 'la.', 'el.', 'los.', 'las.'):
                    out[-1] = out[-1][:-1]
            out.append(self.token(tok))
        t = ' '.join(out)
        t = re.sub(r'\b(\d{1,2})[?%%](?= de %s)' % MESES, r'\1º', t)      # «el 1? de marzo»
        t = re.sub(r'\b(1[89]\d\d)(1[89]\d\d)\b', r'\1-\2', t)             # «19261929»: perdió el guion
        t = re.sub(r'\b(siglos?) ([xvil]{1,6})\b', lambda m: m.group(1) + ' ' + m.group(2).upper(), t)
        return t


# ------------------------------------------------------------- páginas

def fin_de_frase(toks):
    """El primer token con que acaba una frase, o None."""
    for k, t in enumerate(toks[:-1]):
        t = re.sub(r'\[\^[^\]]+\]', '', t)
        if not re.search(r'[.!?…][”»"\')]*$', t):
            continue
        base = re.sub(r'[.!?…”»"\')]+$', '', t)
        if base in ABREV or re.fullmatch(r'[A-ZÁÉÍÓÚÑ]', base):
            continue
        if re.match(r'[A-ZÁÉÍÓÚÑ¿¡«“"(—]', toks[k + 1]):
            return k
    return None


def pagina_revisada(f):
    txt = f.read_text(encoding='utf-8').replace('\r\n', '\n')
    m = re.match(r'@ *(\d+)', txt)
    return txt, (int(m.group(1)) if m else None)


def prepara(epub, carpeta):
    global DIC
    if (DICC / 'es_MX.aff').exists():
        DIC = Hunspell(DICC / 'es_MX.aff', DICC / 'es_MX.dic')
    else:
        print('aviso: no encuentro el diccionario de LibreOffice; las erratas se arreglan peor',
              file=sys.stderr)
    pags = paginas_del_epub(epub)
    omitir, cabeceras, cambios = lee_receta(carpeta)
    titulos = lee_indice(carpeta)
    rev = {int(f.stem): f for f in (carpeta / 'revisadas').glob('*.txt')} \
        if (carpeta / 'revisadas').is_dir() else {}
    orden = [n for n in sorted(set(pags) | set(rev))
             if n in rev or (n not in omitir and not pags[n][1] and pags[n][0])]
    auto = [n for n in orden if n not in rev]
    nums = numera(pags, auto, cabeceras)
    for n in rev:
        nums[n] = pagina_revisada(rev[n])[1]
    informe = []

    # cada título, a la primera página que llega a su número (si es una
    # revisada, ya lo trae ella)
    porpag = defaultdict(list)
    for t in titulos:
        n = next((m for m in orden if nums.get(m) is not None and nums[m] >= t['pag']), None)
        if n is not None and n not in rev:
            porpag[n].append(t)

    datos, c, abierta = {}, 1, False
    for n in orden:
        if n in rev:
            txt, _ = pagina_revisada(rev[n])
            pie = txt.partition('\n====\n')[2].strip()
            ids = [int(x) for x in re.findall(r'^\[(\d+)\]', pie, re.M)]
            if re.search(r'^#{1,2} ', txt, re.M):
                c = 1
            if ids:
                c = max(ids) + 1
            abierta = bool(re.search(r'[%s,;]$' % LETRA, pie))
            datos[n] = {'revisada': txt}
            continue
        texto, _ = numero_al_pie(pags[n][0])
        toks = texto.split()
        esperados = porpag.get(n, [])
        if not any(t['nivel'] <= 2 and t['pag'] == nums.get(n) for t in esperados):
            cab = cabecera(toks, cabeceras)      # la primera de un capítulo no la lleva
            if cab:
                toks = toks[cab[0]:]
        hallados = busca_titulos(toks, esperados)
        items = []
        for i, j, t, cola in hallados:
            if i is None:
                items.append(dict(t))            # arriba de la página
                if t['pag'] == nums.get(n):
                    informe.append((n, 'no encuentro el título «%s»: lo pongo arriba' % t['titulo']))
        pos = 0
        for i, j, t, cola in sorted((h for h in hallados if h[0] is not None), key=lambda h: h[0]):
            items += toks[pos:i]
            items.append(dict(t, cola=cola))
            pos = j
        items += toks[pos:]
        if any(t['nivel'] <= 2 for t in esperados):
            c = 1                                # las notas van por capítulo
        items, notas, llamadas, c = notas_de_pagina(items, c, abierta)
        # ¿queda a medias la última nota? (acaba en minúscula o coma)
        abierta = bool(notas) and bool(re.search(r'[a-záéíóúñü,;]$', notas[-1][1]))
        for i, num in llamadas:
            if isinstance(items[i], dict):
                items[i]['llamada'] = num
                continue
            while i > 0 and items[i] == '' and isinstance(items[i - 1], str):
                i -= 1           # una llamada suelta va pegada a la palabra de antes
            items[i] += '[^%d]' % num
        bloques = []
        for it in items:
            if isinstance(it, dict):
                bloques.append(['h', it])
            elif it:
                if not bloques or bloques[-1][0] != 'p':
                    bloques.append(['p', []])
                bloques[-1][1].append(it)
        datos[n] = {'num': nums.get(n), 'bloques': bloques,
                    'notas': notas}
        tail = ' '.join(toks[-25:])
        if not notas and RX_CITA.search(tail) and re.search(r'\b(op\. ?cit|[ÍíI]dem|Meyer/|AAA|SJ|sj)\b', tail):
            informe.append((n, 'parece que hay notas al pie y no las separo'))

    corr = Corrector([pags[n][0] for n in auto], cambios)

    # entre una página y la siguiente: la palabra partida y la frase que sigue.
    # Una página revisada trae su palabra partida con guion al final («sindica-»)
    # y, si empieza a media frase, «+» al principio.
    def ultimo_de(n):
        """La última palabra del texto de la página `n` (una lista con ella, si
        es automática, para poder cambiarla), o None si acaba en título."""
        d = datos[n]
        if 'revisada' in d:
            lineas = [l for l in d['revisada'].partition('\n====\n')[0].split('\n')
                      if l.strip() and not l.startswith('@')]
            return lineas[-1].split()[-1:] if lineas and not lineas[-1].startswith('#') else None
        pb = d['bloques']
        return pb[-1][1] if pb and pb[-1][0] == 'p' and pb[-1][1] else None

    def partida(ult, f):
        """¿Son `ult` (final de página) y `f` (principio de la siguiente) una
        palabra partida («com» + «bate:»)?"""
        f = palabra(f)
        if not (re.fullmatch('[%s]+' % LETRA, ult) and f and not f[0] and f[1][:1].islower()):
            return False
        return corr.conocida(ult + f[1], 1) and not (corr.conocida(ult) and corr.conocida(f[1]))

    prev = None
    for n in orden:
        d = datos[n]
        ult = ultimo_de(prev) if prev is not None else None
        if 'revisada' in d:
            primera = next((l for l in d['revisada'].partition('\n====\n')[0].split('\n')
                            if l.strip() and not l.startswith('@')), '')
            if ult and 'revisada' not in datos[prev] and primera.startswith('+') \
                    and partida(ult[-1], primera[1:].split()[0]):
                ult[-1] += '-'                       # «sindica» + «+listas…»
            prev = n
            continue
        b = d['bloques']
        if ult and b and b[0][0] == 'p' and b[0][1]:
            if 'revisada' not in datos[prev] and partida(ult[-1], b[0][1][0]):
                ult[-1] += b[0][1].pop(0)            # «com» + «bate:» → «combate:»
            if b[0][1] and (not re.search(r'[.!?…][”»"\')]*(\[\^\d+\])?$', ult[-1])
                            or b[0][1][0][:1].islower()):
                d['sigue'] = True
                k = fin_de_frase(b[0][1])
                if k is not None:
                    b.insert(1, ['p', b[0][1][k + 1:]])
                    b[0][1] = b[0][1][:k + 1]
            b[:] = [x for x in b if x[0] == 'h' or x[1]]
        prev = n

    salida = carpeta / 'paginas'
    if salida.is_dir():
        for f in salida.glob('*.txt'):
            f.unlink()
    salida.mkdir(exist_ok=True)
    k_nota = 1      # las notas se numeran seguidas en cada capítulo
    for n in orden:
        d = datos[n]
        if 'revisada' in d:
            # sus notas también se numeran seguidas: con los números que traiga
            cuerpo, sep, pie = d['revisada'].partition('\n====\n')
            if re.search(r'^#{1,2} ', cuerpo, re.M):
                k_nota = 1
            nuevo = {}
            for x in re.findall(r'^\[(\d+)\]', pie, re.M):
                nuevo[x] = k_nota
                k_nota += 1
            cuerpo = re.sub(r'\[\^(\d+)\]', lambda m: '[^%d]' % nuevo.get(m.group(1), 0), cuerpo)
            pie = re.sub(r'^\[(\d+)\]', lambda m: '[%d]' % nuevo[m.group(1)], pie, flags=re.M)
            (salida / ('%04d.txt' % n)).write_text(cuerpo + sep + pie, encoding='utf-8')
            continue
        if any(tipo == 'h' and x['nivel'] <= 2 for tipo, x in d['bloques']):
            k_nota = 1
        nuevo = {}
        for num, _ in d['notas']:
            if num is not None:
                nuevo[num] = k_nota
                k_nota += 1
        llama = lambda t: re.sub(r'\[\^(\d+)\]', lambda m: '[^%d]' % nuevo.get(int(m.group(1)), 0), t)
        r = ['@ %d' % d['num']] if d['num'] is not None else []
        for k, (tipo, x) in enumerate(d['bloques']):
            if tipo == 'h':
                r.append('%s %s%s' % ('#' * x['nivel'], x['titulo'],
                                      '[^%d]' % nuevo[x['llamada']] if x.get('llamada') else ''))
            else:
                r.append(('+' if k == 0 and d.get('sigue') else '') + llama(corr.texto(' '.join(x))))
            r.append('')
        if d['notas']:
            r.append('====')
            r += ['[%s] %s' % ('+' if num is None else nuevo[num], corr.texto(t)) for num, t in d['notas']]
        (salida / ('%04d.txt' % n)).write_text('\n'.join(r).strip() + '\n', encoding='utf-8')

    with open(carpeta / 'informe.txt', 'w', encoding='utf-8') as f:
        f.write('Lo que ia_ocr_a_paginas.py no supo hacer solo (página del EPUB: aviso)\n\n')
        for n, a in informe:
            f.write('%04d (pág. %s): %s\n' % (n, nums.get(n), a))
        f.write('\nErratas arregladas (veces):\n')
        for k, v in sorted(corr.hechos.items(), key=lambda x: (-x[1], x[0])):
            f.write('  %s (%d)\n' % (k, v))
    n_notas = sum(len(d.get('notas', [])) for d in datos.values())
    print('%d páginas (%d revisadas a mano), %d notas, %d erratas arregladas, %d avisos en informe.txt'
          % (len(orden), len(rev), n_notas, sum(corr.hechos.values()), len(informe)))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('epub')
    ap.add_argument('carpeta')
    a = ap.parse_args()
    prepara(a.epub, Path(a.carpeta))


if __name__ == '__main__':
    main()


