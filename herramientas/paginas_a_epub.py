"""De las páginas transcritas de un libro a un EPUB 3, con su índice y sus notas.

Cada página del libro es un archivo de texto (0028.txt, 0029.txt…, en el
orden del PDF) con esta forma:

    @ 14                      el número de página impreso
    +palabras que siguen      la página empieza a media frase: va pegado al
                              párrafo de la página de antes (y «Mu-» + «chos»
                              se une en «Muchos»)
    # Parte I. …              títulos: # parte, ## capítulo, ### sección,
                              #### apartado de una sección
    {1. Título.}—Texto…       epígrafe numerado dentro de una sección (o de
                              su apartado): sale como título pequeño y el
                              texto aparte
    Texto con nota[^5].       llamada a la nota 5 (o [^*], [^102*])
    _cursiva_  **negrita**

    ====                      lo de abajo son las notas al pie de la página
    [5] Texto de la nota.
    [+] sigue la última nota de la página de antes
    Un renglón sin [..] es otro párrafo de la nota de arriba.

Los párrafos van separados por un renglón en blanco. Las notas se numeran
como en el libro, por capítulo o por página: la llamada [^5] se empareja
con la primera nota [5] que viene después de ella y no tiene dueña.

En el EPUB, cada capítulo es un archivo; cada nota es un <aside
epub:type="footnote"> al final de su capítulo, y la llamada, un <a
epub:type="noteref">. Así cualquier lector de EPUB la enseña como nota, y
Lector sabe leerla o callarla.

Los datos del libro (título, autores…) van en `ficha.txt`, junto a la
carpeta de las páginas, renglón por renglón:

    titulo: La evolución homogénea del dogma católico
    autor: Francisco Marín-Sola, O.P.        (uno por renglón, los que haya)
    editorial: Biblioteca de Autores Cristianos
    lengua: es

Si no hay ficha, son los de la Historia de la Iglesia III.

Uso:
    python paginas_a_epub.py CARPETA_DE_PAGINAS SALIDA.epub [--portada X.jpg]
"""
import argparse
import datetime
import html
import re
import sys
import uuid
import zipfile
from pathlib import Path

TITULO = 'Historia de la Iglesia Católica III. Edad Nueva'
AUTORES = ['Ricardo García-Villoslada, S.I.', 'Bernardino Llorca, S.I.']
EDITORIAL = 'Biblioteca de Autores Cristianos'
LENGUA = 'es'


def ficha(carpeta):
    """Lee `ficha.txt` (junto a la carpeta de las páginas), si la hay."""
    global TITULO, AUTORES, EDITORIAL, LENGUA
    f = Path(carpeta).resolve().parent / 'ficha.txt'
    if not f.exists():
        return
    autores = []
    for r in f.read_text(encoding='utf-8').splitlines():
        clave, _, valor = r.partition(':')
        clave, valor = clave.strip().lower(), valor.strip()
        if clave == 'titulo':
            TITULO = valor
        elif clave == 'autor':
            autores.append(valor)
        elif clave == 'editorial':
            EDITORIAL = valor
        elif clave == 'lengua':
            LENGUA = valor
    AUTORES = autores

# ---------------------------------------------------------------- leer

NIVEL = {'#': 1, '##': 2, '###': 3, '####': 4}


def pega(antes, despues):
    """Une el final de una página con el principio de la siguiente."""
    if re.search(r'\w-$', antes) and re.match(r'[a-záéíóúñü]', despues):
        return antes[:-1] + despues
    return antes + ' ' + despues


def lee(carpeta):
    """Las páginas, en bloques: ('h', nivel, texto, pág) o ('p', texto, pág),
    y las notas en el orden en que aparecen: (id, [párrafos], pág)."""
    bloques, notas = [], []
    apartado = False
    for f in sorted(Path(carpeta).glob('*.txt')):
        crudo = f.read_text(encoding='utf-8').replace('\r\n', '\n')
        cuerpo, _, pie = crudo.partition('\n====\n')
        pag = None
        m = re.match(r'@ *(\S+)\n', cuerpo)
        if m:
            pag = m.group(1)
            cuerpo = cuerpo[m.end():]
        primero = True
        for b in re.split(r'\n\s*\n', cuerpo.strip()):
            b = ' '.join(r.strip() for r in b.split('\n') if r.strip())
            if not b:
                continue
            if primero and b.startswith('+'):
                ult = next(x for x in reversed(bloques) if x[0] == 'p')
                i = bloques.index(ult)
                bloques[i] = ('p', pega(ult[1], b[1:].lstrip()), ult[2])
                primero = False
                continue
            primero = False
            m = re.match(r'(#{1,4}) +(.*)', b)
            if m:
                bloques.append(('h', NIVEL[m.group(1)], m.group(2), pag))
                apartado = len(m.group(1)) == 4
                continue
            m = re.match(r'\{(.+?)\.?\}\s*—\s*(.*)', b)
            if m:
                # el epígrafe va debajo del apartado (####) de su sección, si lo hay
                bloques.append(('h', 5 if apartado else 4, m.group(1), pag))
                if m.group(2):
                    bloques.append(('p', m.group(2), pag))
                continue
            bloques.append(('p', b, pag))
        for r in pie.strip().split('\n'):
            r = r.strip()
            if not r:
                continue
            m = re.match(r'\[([^\]]+)\]\s*(.*)', r)
            if m and m.group(1) == '+':
                ult = notas[-1][1]
                ult[-1] = pega(ult[-1], m.group(2))
            elif m:
                notas.append((m.group(1), [m.group(2)], pag))
            else:
                notas[-1][1].append(r)
    return bloques, notas


# --------------------------------------------------------- en capítulos

def capitulos(bloques, notas):
    """Parte el libro por capítulos (o por partes, si una parte trae texto
    antes de su primer capítulo) y le da a cada uno las notas que llama."""
    caps = []
    for b in bloques:
        if b[0] == 'h' and b[1] <= 2:
            # el título de una parte va con su primer capítulo
            if not caps or any(x[0] == 'p' for x in caps[-1]['bloques']):
                caps.append({'bloques': [], 'n': len(caps) + 1})
        if not caps:
            caps.append({'bloques': [], 'n': 1})
        caps[-1]['bloques'].append(b)

    # cada llamada, con la primera nota de ese número que no tenga dueña
    # (si las notas van por página, un número se repite en el capítulo:
    # por eso cada llamada se apunta, por orden, con el lugar de su nota)
    libres = list(notas)
    for c in caps:
        c['notas'], c['llamadas'] = [], []
        for b in c['bloques']:
            for ref in re.findall(r'\[\^([^\]]+)\]', b[2] if b[0] == 'h' else b[1]):
                k = next((i for i, x in enumerate(libres) if x[0] == ref), None)
                if k is None:
                    print('aviso: la llamada [^%s] del capítulo %d (pág. %s) no tiene nota'
                          % (ref, c['n'], b[-1]), file=sys.stderr)
                    c['llamadas'].append(None)
                    continue
                c['notas'].append(libres.pop(k))
                c['llamadas'].append(len(c['notas']))
    for x in libres:
        print('aviso: la nota [%s] (pág. %s) no tiene llamada' % (x[0], x[2]),
              file=sys.stderr)
    return caps


# ------------------------------------------------------------- a XHTML

def nid(cap, k):
    return 'n%d-%d' % (cap, k)


def enlinea(t, cap, llamadas=None):
    """Las marcas de un párrafo, a XHTML; `llamadas` da, por orden, el lugar
    de la nota de cada llamada (None: no tiene nota)."""
    t = html.escape(t, quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<!\w)_(.+?)_(?!\w)', r'<i>\1</i>', t)

    def llamada(m):
        ref = html.escape(m.group(1))
        k = next(llamadas, None) if llamadas else None
        if k is None:
            return '<sup>%s</sup>' % ref
        i = nid(cap, k)
        return ('<sup><a epub:type="noteref" role="doc-noteref" id="r%s" href="#%s">%s</a></sup>'
                % (i, i, ref))
    return re.sub(r'\[\^([^\]]+)\]', llamada, t)


def sinmarcas(t):
    t = re.sub(r'\[\^[^\]]+\]', '', t)
    return re.sub(r'\*\*|(?<!\w)_|_(?!\w)', '', t)


def xhtml(titulo, cuerpo):
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" '
            'xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es">\n'
            '<head><meta charset="utf-8"/><title>%s</title>'
            '<link rel="stylesheet" href="estilo.css"/></head>\n<body>\n%s\n</body>\n</html>\n'
            % (html.escape(titulo), cuerpo))


def capitulo_xhtml(c, archivo, toc):
    """El XHTML de un capítulo; apunta sus títulos en `toc`."""
    n = c['n']
    partes, k = [], 0
    pag_vista = None
    llamadas = iter(c['llamadas'])
    for b in c['bloques']:
        pag = b[-1]
        if pag and pag != pag_vista:
            partes.append('<span epub:type="pagebreak" role="doc-pagebreak" id="p%s" title="%s"/>'
                          % (pag, pag))
            pag_vista = pag
        if b[0] == 'h':
            k += 1
            hid = 't%d-%d' % (n, k)
            partes.append('<h%d id="%s">%s</h%d>' % (b[1], hid, enlinea(b[2], n, llamadas), b[1]))
            toc.append((b[1], sinmarcas(b[2]), '%s#%s' % (archivo, hid)))
        else:
            partes.append('<p>%s</p>' % enlinea(b[1], n, llamadas))
    if c['notas']:
        partes.append('<section epub:type="footnotes" role="doc-endnotes" class="notas">')
        partes.append('<h2 class="notas-titulo">Notas</h2>')
        for j, (ref, pars, _) in enumerate(c['notas'], 1):
            i = nid(n, j)
            cuerpo = ''.join('<p>%s%s</p>' % (
                ('<a href="#r%s" class="vuelta">%s</a> ' % (i, html.escape(ref))) if j == 0 else '',
                enlinea(p, n)) for j, p in enumerate(pars))
            partes.append('<aside epub:type="footnote" role="doc-footnote" id="%s">%s</aside>'
                          % (i, cuerpo))
        partes.append('</section>')
    primero = next((sinmarcas(b[2]) for b in c['bloques'] if b[0] == 'h'), TITULO)
    return xhtml(primero, '\n'.join(partes))


def nav_xhtml(toc):
    """El índice, anidado por niveles."""
    out, pila = [], [0]
    for nivel, t, href in toc:
        if nivel > pila[-1]:
            out.append('<ol>')
            pila.append(nivel)
        else:
            out.append('</li>')
            while nivel < pila[-1]:
                out.append('</ol></li>')
                pila.pop()
            if nivel > pila[-1]:   # un salto de nivel hacia arriba que no cuadra
                out.append('<ol>')
                pila.append(nivel)
        out.append('<li><a href="%s">%s</a>' % (href, html.escape(t)))
    while len(pila) > 1:
        out.append('</li></ol>')
        pila.pop()
    cuerpo = ('<nav epub:type="toc" role="doc-toc" id="toc"><h1>Índice</h1>\n%s\n</nav>'
              % '\n'.join(out))
    return xhtml('Índice', cuerpo)


ESTILO = """body { font-family: serif; line-height: 1.45; margin: 0 4%; }
h1, h2 { text-align: center; }
h4, h5 { font-size: 1em; margin: 1.2em 0 .3em; }
p { text-indent: 1.2em; margin: 0 0 .4em; text-align: justify; }
sup a { text-decoration: none; font-size: .75em; }
.notas { margin-top: 2em; border-top: 1px solid #999; font-size: .85em; }
.notas p { text-indent: 0; }
.notas-titulo { font-size: 1em; text-align: left; }
.vuelta { font-weight: bold; text-decoration: none; }
"""


def escribe(caps, salida, portada=None):
    toc, docs = [], []
    for c in caps:
        archivo = 'cap%02d.xhtml' % c['n']
        docs.append((archivo, capitulo_xhtml(c, archivo, toc)))
    ident = 'urn:uuid:%s' % uuid.uuid5(uuid.NAMESPACE_URL, TITULO)
    ahora = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    items = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
             '<item id="css" href="estilo.css" media-type="text/css"/>']
    spine = []
    if portada:
        items.append('<item id="portada-img" href="portada.jpg" media-type="image/jpeg" properties="cover-image"/>')
        items.append('<item id="portada" href="portada.xhtml" media-type="application/xhtml+xml"/>')
        spine.append('<itemref idref="portada" linear="yes"/>')
    for i, (a, _) in enumerate(docs):
        items.append('<item id="c%d" href="%s" media-type="application/xhtml+xml"/>' % (i, a))
        spine.append('<itemref idref="c%d"/>' % i)
    opf = ('<?xml version="1.0" encoding="utf-8"?>\n'
           '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="es">\n'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
           '<dc:identifier id="id">%s</dc:identifier>\n<dc:title>%s</dc:title>\n%s\n'
           '<dc:publisher>%s</dc:publisher>\n<dc:language>%s</dc:language>\n'
           '<meta property="dcterms:modified">%s</meta>\n%s</metadata>\n'
           '<manifest>\n%s\n</manifest>\n<spine>\n%s\n</spine>\n</package>\n') % (
        ident, html.escape(TITULO),
        '\n'.join('<dc:creator>%s</dc:creator>' % html.escape(a) for a in AUTORES),
        html.escape(EDITORIAL), LENGUA, ahora,
        '<meta name="cover" content="portada-img"/>\n' if portada else '',
        '\n'.join(items), '\n'.join(spine))
    with zipfile.ZipFile(salida, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', zipfile.ZIP_STORED)
        w = lambda n, s: z.writestr(n, s, zipfile.ZIP_DEFLATED)
        w('META-INF/container.xml',
          '<?xml version="1.0"?>\n<container version="1.0" '
          'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles>'
          '<rootfile full-path="OEBPS/libro.opf" media-type="application/oebps-package+xml"/>'
          '</rootfiles>\n</container>\n')
        w('OEBPS/libro.opf', opf)
        w('OEBPS/nav.xhtml', nav_xhtml(toc))
        w('OEBPS/estilo.css', ESTILO)
        if portada:
            z.write(portada, 'OEBPS/portada.jpg', zipfile.ZIP_DEFLATED)
            w('OEBPS/portada.xhtml', xhtml(TITULO, '<div style="text-align:center">'
              '<img src="portada.jpg" alt="Portada" style="max-width:100%;max-height:100%"/></div>'))
        for a, x in docs:
            w('OEBPS/' + a, x)
    return toc


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('paginas')
    ap.add_argument('salida')
    ap.add_argument('--portada')
    a = ap.parse_args()
    ficha(a.paginas)
    bloques, notas = lee(a.paginas)
    caps = capitulos(bloques, notas)
    toc = escribe(caps, a.salida, a.portada)
    n_notas = sum(len(c['notas']) for c in caps)
    n_par = sum(1 for b in bloques if b[0] == 'p')
    print('%s: %d capítulo(s), %d párrafos, %d notas, %d entradas de índice'
          % (a.salida, len(caps), n_par, n_notas, len(toc)))


if __name__ == '__main__':
    main()
