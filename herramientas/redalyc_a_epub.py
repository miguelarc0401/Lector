"""De un artículo en EPUB de Redalyc / AmeliCA a un EPUB 3 para Lector.

Los artículos que bajan de redalyc.org o portal.amelica.org («ePub generado
a partir de XML JATS4R») traen el texto bien, pero:

- el índice sin nombres (toc.ncx con las etiquetas vacías) y sin título ni
  autor en los datos del libro;
- una «portada» que es la ficha de la revista (ISSN, correo, licencia…), que
  Lector leería en voz alta;
- el resumen también en inglés, que la voz española leería mal;
- las siglas y los números romanos en minúscula (versalitas: «acjm», «iv»).

Este script saca un EPUB limpio, con la forma de los que hace
paginas_a_epub.py:

    portada (imagen hecha aquí: título y autor)
    Título, autor y revista
    Resumen y palabras clave (sólo en español)
    Las secciones del artículo, con sus apartados en el índice
    Referencias
    Datos de la publicación (revista, DOI, licencia)

Cada nota es un <aside epub:type="footnote"> al final del artículo y su
llamada un <a epub:type="noteref">: Lector la lee detrás del párrafo que la
llama, o la calla («Con notas» / «Sin notas»). Las citas «(Vázquez, 2019,
p. 18)» quedan como texto, sin enlace.

Uso:
    python redalyc_a_epub.py ARTICULO.epub SALIDA.epub
"""
import argparse
import datetime
import html
import io
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path, PurePosixPath

X = '{http://www.w3.org/1999/xhtml}'

# Erratas de un artículo concreto, que se arreglan al pasar: (de, a).
ARREGLOS = [
    ('iNEGI', 'INEGI'),            # «i<span class="romanos">negi</span>»
    ('Censo de pPoblación', 'Censo de Población'),
]


def clase(el):
    return (el.get('class') or '').split()


def hijos(el, tag, cls=None):
    return [c for c in el.iter(X + tag) if cls is None or cls in clase(c)]


def uno(el, tag, cls=None):
    r = hijos(el, tag, cls)
    return r[0] if r else None


def plano(el):
    return re.sub(r'\s+', ' ', ''.join(el.itertext())).strip() if el is not None else ''


def arregla(t):
    for a, b in ARREGLOS:
        t = t.replace(a, b)
    return t


class Articulo:
    def __init__(self, epub):
        self.z = zipfile.ZipFile(epub)
        cont = ET.fromstring(self.z.read('META-INF/container.xml'))
        opf = next(e for e in cont.iter() if e.tag.endswith('rootfile')).get('full-path')
        self.base = PurePosixPath(opf).parent
        self.notas = {}       # id de la nota en el original → su número
        self.orden = []       # números de nota, en el orden en que se llaman

    def doc(self, nombre):
        return ET.fromstring(self.z.read(str(self.base / nombre)))

    def enlinea(self, el, cursiva=True, raiz=True):
        """El contenido de `el` como XHTML en línea, ya limpio."""
        out = [html.escape(el.text or '', False)]
        for c in el:
            tag = c.tag.replace(X, '')
            cls = clase(c)
            dentro = self.enlinea(c, cursiva, False)
            if tag == 'sup':
                a = uno(c, 'a')
                frag = a.get('href', '').partition('#')[2] if a is not None else ''
                if frag.startswith('fn'):
                    n = re.sub(r'\D', '', plano(a)) or frag[2:]
                    self.notas[frag] = n
                    self.orden.append(n)
                    out.append('<sup><a epub:type="noteref" role="doc-noteref" id="r%s" '
                               'href="#n%s">%s</a></sup>' % (n, n, n))
                else:
                    out.append('<sup>%s</sup>' % dentro)
            elif tag == 'span' and 'romanos' in cls:
                out.append(html.escape(plano(c).upper(), False)
                           + (' ' if re.search(r'\s$', ''.join(c.itertext())) else ''))
            elif tag == 'span' and 'italica' in cls and cursiva:
                out.append('<em>%s</em>' % dentro)
            elif tag == 'br':
                out.append(' ')
            else:
                out.append(dentro)    # negrita, subrayado, enlaces a la bibliografía…
            out.append(html.escape(c.tail or '', False))
        t = re.sub(r'\s+', ' ', ''.join(out))
        if raiz:
            t = re.sub(r'\s+(<sup><a epub:type="noteref")', r'\1', t).strip()
            t = re.sub(r'<em>\s*</em>', '', t)
            t = re.sub(r'<em> ', ' <em>', re.sub(r' </em>', '</em> ', t))
            t = arregla(re.sub(r'\s+', ' ', t).strip())
        return t

    def ficha(self):
        cub = self.doc('cover.xhtml')
        f = {
            'titulo': plano(uno(cub, 'h2', 'articulo-titulo')),
            'autores': [plano(a) for a in hijos(cub, 'div', 'autor-name')],
            'revista': plano(uno(cub, 'div', 'journal-title')),
            'institucion': '',
            'numero': '',
            'doi': plano(uno(cub, 'a', 'doi-value')),
            'licencia': '',
            'categoria': plano(uno(cub, 'div', 'articulo-categoria')),
        }
        for d in hijos(cub, 'div', 'texto-meta'):
            t = plano(d)
            if t.startswith('vol.'):
                # «vol. 23, núm. 23, e7001, 2025»: el e7001 es el número del artículo
                f['numero'] = re.sub(r',\s*e\d+\b', '', re.sub(r'\s+', ' ', t))
            elif 'Universidad' in t and not f['institucion']:
                f['institucion'] = t
        lic = next((a for a in hijos(cub, 'a') if a.get('rel') == 'license' and plano(a)), None)
        if lic is not None:
            f['licencia'] = plano(lic).rstrip('.')
        if not f['autores']:
            f['autores'] = [plano(uno(cub, 'div', 'autores'))]
        return f

    def cuerpo(self):
        """[(tipo, nivel, xhtml)]: 'h' título, 'p' párrafo, 'q' cita aparte,
        'b' entrada de la bibliografía; y las notas, {número: xhtml}."""
        d = self.doc('content.xhtml')
        bloques = []
        resumen = uno(d, 'p', 'articulo-resumen')
        if resumen is not None:
            bloques.append(('h', 1, 'Resumen'))
            bloques.append(('p', 0, self.enlinea(uno(resumen, 'span', 'capital'))))
        palabras = uno(d, 'p', 'articulo-palabras')
        if palabras is not None:
            t = self.enlinea(palabras)
            t = re.sub(r'^Palabras clave:\s*', '', t).rstrip('. ') + '.'
            bloques.append(('p', 0, '<strong>Palabras clave:</strong> ' + t))
        notas = {}
        for sec in hijos(d, 'div', 'first'):
            h = uno(sec, 'h3')
            if h is None:
                continue
            titulo = self.enlinea(h, cursiva=False)
            # los apartados van en cursiva; las secciones, no
            ital = [s for s in h.iter(X + 'span') if 'italica' in clase(s)]
            nivel = 2 if ital and plano(ital[0]) == plano(h) else 1
            if titulo == 'Notas':
                for n in hijos(sec, 'div', 'nota'):
                    # el «[5]» del principio sobra: lo pone el enlace de vuelta
                    s = n.find(X + 'sup')
                    if s is not None:
                        n.text = (n.text or '') + (s.tail or '')
                        n.remove(s)
                    notas[self.notas.get(n.get('id'), n.get('id'))] = self.enlinea(n)
                continue
            bloques.append(('h', nivel, titulo))
            for p in sec.findall(X + 'p'):
                # una cita aparte viene metida en un párrafo vacío
                for q in p.findall(X + 'p') or [p]:
                    t = self.enlinea(q)
                    if t:
                        tipo = 'q' if 'quote' in clase(q) else 'b' if 'bibliografia' in clase(q) else 'p'
                        bloques.append((tipo, 0, t))
        return bloques, notas


def xhtml(titulo, cuerpo):
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" '
            'xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es">\n'
            '<head><meta charset="utf-8"/><title>%s</title>'
            '<link rel="stylesheet" href="estilo.css"/></head>\n<body>\n%s\n</body>\n</html>\n'
            % (html.escape(titulo), cuerpo))


def nav_xhtml(toc):
    """El índice, anidado por niveles (como en paginas_a_epub.py)."""
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
        out.append('<li><a href="%s">%s</a>' % (href, html.escape(t)))
    while len(pila) > 1:
        out.append('</li></ol>')
        pila.pop()
    return xhtml('Índice', '<nav epub:type="toc" role="doc-toc" id="toc"><h1>Índice</h1>\n%s\n</nav>'
                 % '\n'.join(out))


def sinmarcas(t):
    return html.unescape(re.sub(r'<[^>]+>', '', t))


def portada_jpg(f):
    """Una portada sencilla, con el título y el autor; None si no hay Pillow."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    W, H = 1200, 1800
    im = Image.new('RGB', (W, H), (246, 240, 228))
    d = ImageDraw.Draw(im)
    fuentes = Path('C:/Windows/Fonts')

    def fuente(nombre, tam):
        try:
            return ImageFont.truetype(str(fuentes / nombre), tam)
        except OSError:
            return ImageFont.load_default()

    def renglones(t, fnt, ancho):
        out, r = [], ''
        for w in t.split():
            s = (r + ' ' + w).strip()
            if d.textlength(s, font=fnt) > ancho and r:
                out.append(r)
                r = w
            else:
                r = s
        return out + [r] if r else out

    def centra(lineas, fnt, y, color, alto):
        for ln in lineas:
            d.text(((W - d.textlength(ln, font=fnt)) / 2, y), ln, font=fnt, fill=color)
            y += alto
        return y

    rojo, tinta = (122, 28, 28), (40, 32, 28)
    d.rectangle([60, 60, W - 60, H - 60], outline=rojo, width=6)
    d.rectangle([80, 80, W - 80, H - 80], outline=rojo, width=2)
    y = centra([f['revista'].upper()], fuente('GARA.TTF', 46), 190, rojo, 60)
    y = centra([f['numero']], fuente('GARAIT.TTF', 40), y + 10, tinta, 50)
    d.line([W / 2 - 120, y + 60, W / 2 + 120, y + 60], fill=rojo, width=3)
    t = f['titulo']
    principal, _, sub = t.partition(':')
    y = centra(renglones(principal, fuente('GARABD.TTF', 104), W - 260),
               fuente('GARABD.TTF', 104), y + 170, tinta, 122)
    if sub:
        y = centra(renglones(sub.strip()[0].upper() + sub.strip()[1:], fuente('GARAIT.TTF', 64), W - 280),
                   fuente('GARAIT.TTF', 64), y + 50, tinta, 80)
    d.line([W / 2 - 120, y + 70, W / 2 + 120, y + 70], fill=rojo, width=3)
    centra([', '.join(f['autores'])], fuente('GARA.TTF', 62), H - 330, tinta, 70)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=88)
    return b.getvalue()


ESTILO = """body { font-family: serif; line-height: 1.45; margin: 0 4%; }
h1, h2 { text-align: center; }
h3 { font-size: 1em; font-style: italic; margin: 1.2em 0 .3em; }
p { text-indent: 1.2em; margin: 0 0 .4em; text-align: justify; }
blockquote { margin: .6em 2em; font-size: .95em; }
blockquote p { text-indent: 0; }
.ficha p, .datos p { text-indent: 0; text-align: center; }
.autor { font-size: 1.15em; margin-top: 1em; }
.bib { text-indent: -1.5em; margin-left: 1.5em; text-align: left; }
sup a { text-decoration: none; font-size: .75em; }
.notas { margin-top: 2em; border-top: 1px solid #999; font-size: .85em; }
.notas p { text-indent: 0; }
.vuelta { font-weight: bold; text-decoration: none; }
"""


def escribe(f, bloques, notas, salida):
    toc, partes = [], []
    partes.append('<section class="ficha">')
    partes.append('<h1 id="t0">%s</h1>' % html.escape(f['titulo']))
    toc.append((1, f['titulo'], 'articulo.xhtml#t0'))
    partes.append('<p class="autor">%s</p>' % html.escape(' y '.join(f['autores'])))
    partes.append('<p><em>%s</em>, %s</p>' % (html.escape(f['revista']), html.escape(f['numero'])))
    partes.append('</section>')
    k = 0
    for tipo, nivel, t in bloques:
        if tipo == 'h':
            k += 1
            partes.append('<h%d id="t%d">%s</h%d>' % (nivel + 1, k, t, nivel + 1))
            # en el índice, todos a la vista: un artículo tiene pocos, y en
            # Lector los apartados quedarían plegados bajo su sección
            toc.append((1, sinmarcas(t), 'articulo.xhtml#t%d' % k))
        elif tipo == 'q':
            partes.append('<blockquote><p>%s</p></blockquote>' % t)
        elif tipo == 'b':
            partes.append('<p class="bib">%s</p>' % t)
        else:
            partes.append('<p>%s</p>' % t)
    # los datos de la revista, al final: no estorban al empezar a oírlo
    k += 1
    partes.append('<section class="datos"><h2 id="t%d">Datos de la publicación</h2>' % k)
    toc.append((1, 'Datos de la publicación', 'articulo.xhtml#t%d' % k))
    for t in [f['categoria'] + '.' if f['categoria'] else '',
              '%s. %s. %s.' % (f['revista'], f['institucion'], f['numero']),
              'DOI: %s' % f['doi'] if f['doi'] else '',
              ('Esta obra está bajo una %s.' % f['licencia']) if f['licencia'] else '']:
        if t:
            partes.append('<p>%s</p>' % html.escape(t))
    partes.append('</section>')
    if notas:
        partes.append('<section epub:type="footnotes" role="doc-endnotes" class="notas">')
        for n in sorted(notas, key=lambda x: int(x) if x.isdigit() else 0):
            partes.append('<aside epub:type="footnote" role="doc-footnote" id="n%s">'
                          '<p><a href="#r%s" class="vuelta">%s</a> %s</p></aside>'
                          % (n, n, n, notas[n]))
        partes.append('</section>')
    art = xhtml(f['titulo'], '\n'.join(partes))
    ET.fromstring(art.split('\n', 2)[2])   # que el XHTML esté bien formado

    titulo = f['titulo']
    ident = 'urn:uuid:%s' % uuid.uuid5(uuid.NAMESPACE_URL, f['doi'] or titulo)
    ahora = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    jpg = portada_jpg(f)
    items = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
             '<item id="css" href="estilo.css" media-type="text/css"/>',
             '<item id="art" href="articulo.xhtml" media-type="application/xhtml+xml"/>']
    spine = ['<itemref idref="art"/>']
    if jpg:
        items.append('<item id="portada-img" href="portada.jpg" media-type="image/jpeg" properties="cover-image"/>')
        items.append('<item id="portada" href="portada.xhtml" media-type="application/xhtml+xml"/>')
        spine.insert(0, '<itemref idref="portada" linear="yes"/>')
    opf = ('<?xml version="1.0" encoding="utf-8"?>\n'
           '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="es">\n'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
           '<dc:identifier id="id">%s</dc:identifier>\n<dc:title>%s</dc:title>\n%s\n'
           '<dc:publisher>%s</dc:publisher>\n<dc:language>es</dc:language>\n'
           '<meta property="dcterms:modified">%s</meta>\n%s</metadata>\n'
           '<manifest>\n%s\n</manifest>\n<spine>\n%s\n</spine>\n</package>\n') % (
        ident, html.escape(titulo),
        '\n'.join('<dc:creator>%s</dc:creator>' % html.escape(a) for a in f['autores']),
        html.escape(f['revista']), ahora,
        '<meta name="cover" content="portada-img"/>\n' if jpg else '',
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
        w('OEBPS/articulo.xhtml', art)
        if jpg:
            w('OEBPS/portada.jpg', jpg)
            w('OEBPS/portada.xhtml', xhtml(titulo, '<div style="text-align:center">'
              '<img src="portada.jpg" alt="Portada" style="max-width:100%;max-height:100%"/></div>'))
    return toc


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('articulo')
    ap.add_argument('salida')
    a = ap.parse_args()
    art = Articulo(a.articulo)
    f = art.ficha()
    bloques, notas = art.cuerpo()
    sin_nota = [n for n in art.orden if n not in notas]
    toc = escribe(f, bloques, notas, a.salida)
    print('%s: «%s», %d párrafos, %d notas, %d entradas de índice'
          % (a.salida, f['titulo'], sum(1 for b in bloques if b[0] != 'h'), len(notas), len(toc)))
    if sin_nota:
        print('¡Ojo! Llamadas sin su nota: %s' % ', '.join(sin_nota))
    for nivel, t, _ in toc:
        print('  ' * nivel + t)


if __name__ == '__main__':
    main()
