"""Deja el EPUB completo de la Historia de la Iglesia III listo para Lector.

El EPUB «COMPLETO» se armó juntando lotes hechos por separado, y trae cosas
que en Lector estorban al oírlo o sólo pesan:

  - la flecha «↩» de vuelta al final de cada nota, que se veía y se oía;
  - «Parte I. Desde la muerte de Bonifacio VIII…» repetido al principio de
    cada capítulo de la Parte I (se deja sólo el del capítulo I);
  - las páginas que son sólo una imagen (cubierta, guardas, el índice
    alfabético en facsímil, colofón, contracubierta): Lector no enseña
    imágenes, y de ellas sólo se oía «esta página todavía no tiene
    transcripción…»; y el «Índice general» impreso, que es una lista de
    títulos con puntos y números de página (Lector tiene el suyo);
  - los restos de cada lote: su nav, su toc.ncx, su portada repetida.

Y arregla el índice: «Parte I» y «Parte II» llevan a su título, y los
títulos en mayúsculas de la Parte II («PARTE II», «CAPÍTULO I»,
«MIRADA DE CONJUNTO») van como los demás.

Lo demás —texto, notas, páginas impresas— queda como estaba.

Uso:
    python preparar_historia3.py ENTRADA.epub SALIDA.epub
"""
import datetime
import posixpath
import re
import sys
import zipfile
from pathlib import PurePosixPath

from lxml import etree

XHTML = 'http://www.w3.org/1999/xhtml'
OPF = 'http://www.idpf.org/2007/opf'
EPUB = 'http://www.idpf.org/2007/ops'
NS = {'h': XHTML, 'o': OPF, 'e': EPUB}

# las páginas que salen del libro, relativas a OEBPS/
FUERA = re.compile(r'^(lotes/prelim/(cubierta|guarda|indice_general)\.xhtml'
                   r'|anexos/.*\.xhtml)$')


def texto(el):
    return re.sub(r'\s+', ' ', ''.join(el.itertext())).strip()


def quita(el):
    """Quita `el` sin perder el texto que va detrás de él."""
    padre = el.getparent()
    if el.tail:
        ant = el.getprevious()
        if ant is not None:
            ant.tail = (ant.tail or '') + el.tail
        else:
            padre.text = (padre.text or '') + el.tail
    padre.remove(el)


def es_salto(el):
    return 'pagebreak' in (el.get('{%s}type' % EPUB) or '') + (el.get('role') or '')


def cambia_texto(el, viejo, nuevo):
    for n in el.iter():
        if n.text and viejo in n.text:
            n.text = n.text.replace(viejo, nuevo)
        if n is not el and n.tail and viejo in n.tail:
            n.tail = n.tail.replace(viejo, nuevo)


def arregla_doc(ruta, doc):
    cambios = 0
    # la flecha de vuelta de las notas
    for a in doc.iter('{%s}a' % XHTML):
        if len(a) == 0 and (a.text or '').strip() == '↩':
            quita(a)
            cambios += 1
    # «Parte I. …» repetido delante de cada capítulo, menos el primero; los
    # saltos de página que lleve dentro se quedan
    if re.match(r'lotes/p1_(02_09|10|11_15)/', ruta):
        for el in list(doc.iter('{%s}p' % XHTML, '{%s}h1' % XHTML)):
            if texto(el).startswith('Parte I.'):
                for s in [x for x in el.iter() if es_salto(x)]:
                    s.tail = None
                    el.addprevious(s)
                quita(el)
                cambios += 1
    # los títulos en mayúsculas de la Parte II
    if ruta.startswith('lotes/p2_01_05/'):
        for h in doc.iter(*['{%s}h%d' % (XHTML, i) for i in range(1, 7)]):
            for v, n in (('PARTE II', 'Parte II'), ('CAPÍTULO', 'Capítulo'),
                         ('MIRADA DE CONJUNTO', 'Mirada de conjunto')):
                if v in texto(h):
                    cambia_texto(h, v, n)
                    cambios += 1
    return cambios


def arregla_nav(nav):
    # fuera las entradas de las páginas quitadas
    for a in list(nav.iter('{%s}a' % XHTML)):
        href = (a.get('href') or '').split('#')[0]
        if FUERA.match(href):
            li = a.getparent()
            li.getparent().remove(li)
    # las partes llevan a su título
    for s in list(nav.iter('{%s}span' % XHTML)):
        t = texto(s)
        href = None
        if t.startswith('Parte I.'):
            href = 'lotes/p1_01/capitulo_i.xhtml#parte-i'
        elif t.startswith('Parte II.'):
            href = 'lotes/p2_01_05/introduccion.xhtml#parte-ii'
        if href:
            s.tag = '{%s}a' % XHTML
            s.set('href', href)
    # las listas vacías no valen en un nav
    for ol in list(nav.iter('{%s}ol' % XHTML)):
        if len(ol) == 0:
            ol.getparent().remove(ol)


def serializa(doc):
    return etree.tostring(doc, xml_declaration=True, encoding='utf-8')


def main(entrada, salida):
    zin = zipfile.ZipFile(entrada)
    rutas = set(zin.namelist())
    opf_ruta = 'OEBPS/package.opf'
    base = 'OEBPS/'
    opf = etree.fromstring(zin.read(opf_ruta))
    manifiesto = opf.find('o:manifest', NS)
    items = {it.get('id'): it for it in manifiesto.findall('o:item', NS)}
    spine = opf.find('o:spine', NS)

    # el orden de lectura, sin las páginas que salen
    for ref in list(spine.findall('o:itemref', NS)):
        if FUERA.match(items[ref.get('idref')].get('href')):
            spine.remove(ref)
    lectura = [items[r.get('idref')].get('href') for r in spine.findall('o:itemref', NS)]

    nuevos = {}
    total = 0
    for href in lectura:
        doc = etree.fromstring(zin.read(base + href))
        total += arregla_doc(href, doc)
        nuevos[href] = doc
    nav_href = next(it.get('href') for it in items.values()
                    if 'nav' in (it.get('properties') or '').split())
    nav = etree.fromstring(zin.read(base + nav_href))
    arregla_nav(nav)
    nuevos[nav_href] = nav

    # lo que se queda: lo que se lee, el nav, la portada y lo que ellos usan
    portada = next(it.get('href') for it in items.values()
                   if 'cover-image' in (it.get('properties') or '').split())
    queda = set(nuevos) | {portada}
    for href, doc in nuevos.items():
        for el in doc.iter('{%s}link' % XHTML, '{%s}img' % XHTML):
            r = el.get('href') or el.get('src')
            if r and not re.match(r'^[a-z]+:', r):
                queda.add(posixpath.normpath(posixpath.join(posixpath.dirname(href), r.split('#')[0])))
    for it in list(items.values()):
        if it.get('href') not in queda:
            manifiesto.remove(it)

    meta = opf.find('o:metadata', NS)
    for m in meta.findall('o:meta', NS):
        if m.get('property') == 'dcterms:modified':
            m.text = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    desc = meta.find('{http://purl.org/dc/elements/1.1/}description')
    if desc is not None:
        desc.text = desc.text.replace(' y facsímil del índice onomástico', '')

    with zipfile.ZipFile(salida, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip',
                   compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', zin.read('META-INF/container.xml'),
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr(opf_ruta, serializa(opf), compress_type=zipfile.ZIP_DEFLATED)
        for href in sorted(queda):
            datos = serializa(nuevos[href]) if href in nuevos else zin.read(base + href)
            z.writestr(base + href, datos, compress_type=zipfile.ZIP_DEFLATED)

    print(f'{len(lectura)} documentos, {total} cambios, '
          f'{len(rutas)} archivos antes, {len(queda) + 3} ahora')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
