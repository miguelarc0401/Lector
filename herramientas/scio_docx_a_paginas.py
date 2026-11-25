"""Del Word de un libro de la Biblia de Scío a páginas para paginas_a_epub.py.

El Word (una transcripción del libro impreso, página por página) trae en
cada página:

  · el texto: el título del libro, «CAPÍTULO N», el sumario del capítulo y
    los versículos; el número del versículo y las llamadas a las notas (a,
    b, c…) van en superíndice; un versículo puede venir partido en varios
    párrafos del Word (los renglones de la columna impresa);
  · una raya «————» y, debajo, las notas: cada una empieza con su letra en
    superíndice; un párrafo sin letra sigue la nota de antes, de esa página
    o de la anterior;
  · los lugares paralelos del margen («a Num. xxxii. 39.—b Hebr. xi. 22.»),
    que no tienen llamada en el texto: se quitan;
  · un salto de página.

Escribe CARPETA/paginas/NNNN.txt (NNNN = página del Word) y
CARPETA/informe.txt con lo que conviene revisar: páginas cuyas llamadas no
cuadran con sus notas, lugares paralelos quitados, etc. Los arreglos a mano
del libro van en CARPETA/arreglos.txt, uno por renglón:

    texto que está en el Word => texto que lo sustituye
    texto que sobra =>                      (sin nada: se borra)

Se aplican a cada párrafo del Word con sus marcas: ^{a} es un superíndice y
_…_ cursiva. Si un párrafo queda sin letras, se quita.

Un «ADVERTENCIA» que aparece después de los capítulos es el prólogo del
libro siguiente: ahí se acaba.

Uso:
    python scio_docx_a_paginas.py LIBRO.docx CARPETA [--sin-numeros]
    python paginas_a_epub.py CARPETA/paginas SALIDA.epub --portada CARPETA/portada.jpg

Cada versículo empieza con su número como [v12]: en el EPUB va aparte
(<span class="versiculo">) y Lector lo enseña sin leerlo; en la app se
puede ver con números o sin ellos. Con --sin-numeros no se ponen.
Si hay ficha.txt en CARPETA, hace también CARPETA/portada.jpg.
"""
import argparse
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SALTO = '\f'

MINUSCULA = 'a-záéíóúñüàèìòùâêîôûç'


# ------------------------------------------------------------ leer el Word

def parrafos(docx):
    """Los párrafos del Word, en texto con marcas (^{x} superíndice, _x_
    cursiva); un salto de página es SALTO. Un salto de renglón dentro del
    párrafo lo parte en dos, como si fueran dos renglones."""
    raiz = etree.fromstring(zipfile.ZipFile(docx).read('word/document.xml'))
    out = []
    for p in raiz.iter(W + 'p'):
        trozos = [[]]
        for r in p.iter(W + 'r'):
            rpr = r.find(W + 'rPr')
            sup = cur = False
            if rpr is not None:
                va = rpr.find(W + 'vertAlign')
                sup = va is not None and va.get(W + 'val') == 'superscript'
                i = rpr.find(W + 'i')
                cur = i is not None and i.get(W + 'val') not in ('0', 'false')
            for x in r:
                if x.tag == W + 't':
                    trozos[-1].append((x.text or '', sup, cur))
                elif x.tag == W + 'br' and x.get(W + 'type') == 'page':
                    trozos += [None, []]
                elif x.tag in (W + 'br', W + 'cr'):
                    trozos += [[]]
                elif x.tag == W + 'tab':
                    trozos[-1].append((' ', False, False))
        for tr in trozos:
            if tr is None:
                out.append(SALTO)
                continue
            s = ''
            for t, sup, cur in tr:
                t = t.replace('_', ' ').replace('\u00a0', ' ')
                if sup and t.strip():
                    s += '^{%s}%s' % (t.strip(), ' ' if t.endswith(' ') else '')
                elif cur and t.strip():
                    m = re.match(r'(\s*)(.*?)(\s*)$', t, re.S)
                    s += '%s_%s_%s' % m.groups()
                else:
                    s += t
            s = re.sub(r'_(\s*)_', r'\1', s)
            if s.strip():
                out.append(s.strip())
    return out


def lee_arreglos(f):
    arr = []
    if f.exists():
        for r in f.read_text(encoding='utf-8').splitlines():
            if '=>' in r and not r.lstrip().startswith('#'):
                viejo, _, nuevo = r.partition('=>')
                arr.append([viejo.strip(), nuevo.strip(), 0])
    return arr


# --------------------------------------------------------------- unir

def une(a, b):
    """Une dos renglones: «espíri-» + «tu» = «espíritu», aunque la cursiva
    los parta («_espíri-_» + «_tu_»)."""
    m = re.search(r'\w-(_?)$', a)
    n = re.match(r'(_?)[%s]' % MINUSCULA, b)
    if m and n:
        if m.group(1) and n.group(1):
            return a[:-2] + b[1:]
        return a[:-1 - len(m.group(1))] + b[len(n.group(1)):]
    return a + ' ' + b


def limpia(t):
    t = re.sub(r'_(\s*)_', r'\1', t)
    t = re.sub(r'\*([^*]+?)\*', r'_\1_', t)       # *cursiva* de la transcripción
    t = t.replace('*', '')
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r' +([,.;:])', r'\1', t)
    return t


FINAL = re.compile(r'[.!?»”")\]]_?$')

# «a Num. xxxii. 39.—b Hebr. xi. 22.»: letra, libro abreviado, capítulo
PARALELO = re.compile(r'^[a-z][.,]?\s+(?:(?:\d+|[IV]+)[.,]\s*)?[A-ZÁÉÍÓÚ][\wæÆ]*[.,]\s*'
                      r'(?:[ivxlcIVXLC]+|\d+)[.,]')
CAPITULO = re.compile(r'^CAP[IÍ]TULO\s+([IVXLC]+)\.?$')
CABEZA = re.compile(r'^(?:A\.\s*T\.[\s.-]*T\.\s*[IV]+\.?(?:\s+\d+)?|\d+)$')   # pie y número
LETRA = re.compile(r'[^\W\d_]')
RAYA = re.compile(r'[—–_-]{5,}')        # la raya que separa el texto de las notas

PEQUENAS = {'de', 'del', 'la', 'las', 'los', 'el', 'y', 'al', 'a', 'en', 'sobre'}
ACENTOS = {'Genesis': 'Génesis', 'Moyses': 'Moisés', 'Exodo': 'Éxodo', 'Levitico': 'Levítico',
           'Numeros': 'Números', 'Deuteronomio': 'Deuteronomio'}


def nombre(t):
    """«AL PENTATEUCO Y AL GENESIS» → «al Pentateuco y al Génesis»."""
    pal = []
    for w in t.strip(' .').lower().split():
        w = w if w in PEQUENAS else w[:1].upper() + w[1:]
        pal.append(ACENTOS.get(w, w))
    return ' '.join(pal)


def mayusculas(t):
    return bool(LETRA.search(t)) and not re.search(r'[%s]' % MINUSCULA, t) and len(t) < 80


# ------------------------------------------------------------- convertir

def convierte(docx, carpeta, numeros=True):
    carpeta = Path(carpeta)
    arreglos = lee_arreglos(carpeta / 'arreglos.txt')
    informe = []

    # 1. renglones por página, con los arreglos ya hechos
    paginas = [[]]
    for t in parrafos(docx):
        if t == SALTO:
            paginas.append([])
            continue
        for a in arreglos:
            if a[0] in t:
                t = t.replace(a[0], a[1])
                a[2] += 1
        if LETRA.search(t) or RAYA.fullmatch(t.strip()):
            paginas[-1].append(t.strip())
    for a in arreglos:
        if not a[2]:
            informe.append('ARREGLO SIN USAR: %s' % a[0])

    # 2. cada página, en texto y notas
    estado = 'prologo'           # prologo → sumario → versiculos
    vistos_caps = versiculo = 0
    ult_nota = ''                # el último renglón de nota (para unir)
    hay_nota = False
    salida = []
    fin = None
    for np_, renglones in enumerate(paginas, 1):
        cuerpo, notas = [], []   # párrafos (texto) y renglones de notas
        zona = 'texto'
        primero = True
        llamadas, letras = [], []
        for t in renglones:
            if RAYA.fullmatch(t):
                zona = 'notas'
                continue
            plano = re.sub(r'\^\{[^}]*\}|_', '', t).strip()
            if CABEZA.match(plano):
                informe.append('p%04d: quito el pie o número de página «%s»' % (np_, plano))
                continue
            if zona == 'texto':
                m = CAPITULO.match(plano)
                if plano.startswith('ADVERTENCIA') and vistos_caps:
                    fin = np_
                    break
                if m:
                    cuerpo.append('## Capítulo %s' % m.group(1))
                    estado = 'sumario'
                    vistos_caps += 1
                    primero = False
                    continue
                if estado == 'prologo' and mayusculas(plano):
                    if cuerpo and cuerpo[-1].startswith('# ') and not cuerpo[-1].startswith('# El '):
                        cuerpo[-1] += ' ' + nombre(plano)
                    else:
                        cuerpo.append('# ' + nombre(plano)[:1].upper() + nombre(plano)[1:])
                    primero = False
                    continue
                if PARALELO.match(plano):
                    informe.append('p%04d: ¿lugar paralelo en el texto? «%s»' % (np_, plano[:90]))
                llamadas += re.findall(r'\^\{([a-z]{1,2})\}', t)
                v = re.match(r'\^\{(\d+)\}\s*', t)
                if v:
                    if estado == 'sumario':
                        versiculo = 0
                    if int(v.group(1)) != versiculo + 1:
                        informe.append('p%04d: VERSÍCULO %s después del %d (cap. %d)'
                                       % (np_, v.group(1), versiculo, vistos_caps))
                    versiculo = int(v.group(1))
                    estado = 'versiculos'
                    resto = t[v.end():].lstrip(' .')
                    cuerpo.append(('\x01%s\x02 ' % v.group(1) if numeros else '') + resto)
                elif estado == 'sumario' and cuerpo and cuerpo[-1].startswith('## '):
                    cuerpo.append('¶' + t)           # el sumario del capítulo
                elif cuerpo and not cuerpo[-1].startswith('#'):
                    if (estado == 'prologo' and FINAL.search(cuerpo[-1])
                            and not re.match(r'_?[%s]' % MINUSCULA, t)):
                        cuerpo.append(t)
                    else:
                        cuerpo[-1] = une(cuerpo[-1], t)
                elif primero and not cuerpo:
                    # sigue el párrafo de la página de antes
                    nuevo = estado == 'prologo' and salida and FINAL.search(salida[-1][2])
                    cuerpo.append(t if nuevo else '+' + t)
                else:
                    cuerpo.append(t)
                primero = False
            else:
                if re.fullmatch(r'\^\{[a-z]+\}', t):
                    informe.append('p%04d: quito la signatura de imprenta «%s»' % (np_, t))
                    continue
                m = re.match(r'\^\{([a-z]{1,2})\}\s*', t)
                if m:
                    letras.append(m.group(1))
                    notas.append('[%s] %s' % (m.group(1), t[m.end():]))
                    ult_nota, hay_nota = t[m.end():], True
                    continue
                if PARALELO.match(plano):
                    informe.append('p%04d: quito el lugar paralelo «%s»' % (np_, plano[:120]))
                    continue
                if re.match(r'\^\{', t):
                    informe.append('p%04d: superíndice raro al empezar una nota «%s»' % (np_, t[:80]))
                if not hay_nota:
                    informe.append('p%04d: renglón de nota sin nota antes «%s»' % (np_, t[:80]))
                    continue
                junta = not FINAL.search(ult_nota) or re.match(r'_?[%s]' % MINUSCULA, t)
                if junta:
                    # sigue el mismo párrafo: el de esta página o, si aún no
                    # hay notas en ella, el de la anterior
                    if notas:
                        notas[-1] = une(notas[-1], t)
                    else:
                        notas.append('[+] ' + t)
                    ult_nota = une(ult_nota, t)
                else:
                    notas.append(t)
                    ult_nota = t
        if fin:
            break
        if llamadas != letras:
            informe.append('p%04d: LLAMADAS %s ≠ NOTAS %s' % (np_, ' '.join(llamadas) or '-',
                                                               ' '.join(letras) or '-'))
        salida.append((np_, cuerpo, ' '.join(cuerpo[-1:]), notas))

    # 3. escribir
    dest = carpeta / 'paginas'
    dest.mkdir(parents=True, exist_ok=True)
    for f in dest.glob('*.txt'):
        f.unlink()
    for np_, cuerpo, _, notas in salida:
        pars = []
        for c in cuerpo:
            if c.startswith('¶'):
                c = '_%s_' % limpia(c[1:]).replace('_', '')
            elif not c.startswith('#'):
                c = limpia(re.sub(r'\s*\^\{([a-z]{1,2})\}', r'[^\1]', c))
                c = re.sub(r'\^\{([^}]*)\}', r'\1', c)
                c = re.sub(r'\x01(\d+)\x02 ?', r'[v\1] ', c)
            pars.append(c)
        # el sumario partido en varios renglones: uno solo
        junto = []
        for c in pars:
            if junto and c.startswith('_') and junto[-1].startswith('_') and junto[-1].endswith('_') \
                    and len(junto) >= 2 and junto[-2].startswith('## '):
                junto[-1] = '_%s_' % une(junto[-1].strip('_'), c.strip('_'))
            else:
                junto.append(c)
        txt = '\n\n'.join(junto)
        if notas:
            txt += '\n\n====\n' + '\n'.join(limpia(re.sub(r'\^\{([^}]*)\}', r'\1', n)) for n in notas)
        (dest / ('%04d.txt' % np_)).write_text(txt + '\n', encoding='utf-8')

    resumen = ('%d páginas escritas (de %d del Word)%s; %d capítulos'
               % (len(salida), len(paginas),
                  ', se acaba en la p%04d (prólogo del libro siguiente)' % fin if fin else '',
                  vistos_caps))
    (carpeta / 'informe.txt').write_text(resumen + '\n\n' + '\n'.join(informe) + '\n',
                                         encoding='utf-8')
    print(resumen)
    print('%d avisos en %s' % (len(informe), carpeta / 'informe.txt'))


# ---------------------------------------------------------------- portada

def portada(carpeta):
    f = Path(carpeta) / 'ficha.txt'
    if not f.exists():
        return
    datos = {}
    for r in f.read_text(encoding='utf-8').splitlines():
        k, _, v = r.partition(':')
        datos.setdefault(k.strip().lower(), v.strip())
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return
    W_, H = 1200, 1800
    im = Image.new('RGB', (W_, H), (246, 240, 228))
    d = ImageDraw.Draw(im)

    def fuente(n, tam):
        try:
            return ImageFont.truetype('C:/Windows/Fonts/' + n, tam)
        except OSError:
            return ImageFont.load_default()

    def centra(texto, fnt, y, color):
        d.text(((W_ - d.textlength(texto, font=fnt)) / 2, y), texto, font=fnt, fill=color)

    rojo, tinta = (122, 28, 28), (40, 32, 28)
    d.rectangle([60, 60, W_ - 60, H - 60], outline=rojo, width=6)
    d.rectangle([80, 80, W_ - 80, H - 80], outline=rojo, width=2)
    centra((datos.get('coleccion') or 'LA SANTA BIBLIA').upper(), fuente('GARA.TTF', 50), 260, rojo)
    d.line([W_ / 2 - 120, 380, W_ / 2 + 120, 380], fill=rojo, width=3)
    centra(datos.get('titulo', ''), fuente('GARABD.TTF', 130), 620, tinta)
    d.line([W_ / 2 - 120, 860, W_ / 2 + 120, 860], fill=rojo, width=3)
    centra('Traducción y notas de', fuente('GARAIT.TTF', 52), H - 520, tinta)
    centra(datos.get('autor', ''), fuente('GARA.TTF', 64), H - 430, tinta)
    im.save(Path(carpeta) / 'portada.jpg', 'JPEG', quality=88)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('docx')
    ap.add_argument('carpeta')
    ap.add_argument('--sin-numeros', action='store_true')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    convierte(a.docx, a.carpeta, numeros=not a.sin_numeros)
    portada(a.carpeta)


if __name__ == '__main__':
    main()
