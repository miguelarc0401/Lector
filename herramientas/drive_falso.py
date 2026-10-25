"""Un Google Drive de mentira, para probar la sincronización de Lector
(app/nube.js) en la computadora, sin Google y sin red.

Contesta lo poco de la API de Drive que usa la app, en http://localhost:8790:

  GET    /auth?redirect_uri=…&state=…        «entra» al momento: vuelve a
                                             redirect_uri con un permiso falso
  GET    /drive/v3/files?spaces=appDataFolder la lista, con sus appProperties
  GET    /drive/v3/files/<id>?alt=media      el contenido
  PATCH  /drive/v3/files/<id>                cambia appProperties (null quita)
  PATCH  /upload/drive/v3/files/<id>?uploadType=media  cambia el contenido
  DELETE /drive/v3/files/<id>
  POST   /upload/drive/v3/files?uploadType=resumable  y luego
  PUT    /upload/sesion/<n>                  subir un archivo

Y para las pruebas:

  GET    /estado      lo que hay guardado (sin el contenido)
  POST   /caduca      invalida los permisos dados (la app tiene que pedir otro)
  POST   /vacia       lo borra todo

Todo vive en memoria: al pararlo, se olvida. Uso:

    python herramientas/drive_falso.py [puerto]

y la app en localhost (python -m http.server 8780 --directory app) habla
con él sola; para hablar con Google de verdad desde localhost, poner
`lector-drive-real` en localStorage.
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8790

cerrojo = threading.Lock()
archivos = {}        # id -> { id, name, appProperties, mimeType, datos }
sesiones = {}        # n -> metadatos a la espera del contenido
permisos = set()
cuenta = [0]


def nuevo_id(prefijo):
    cuenta[0] += 1
    return '%s%d' % (prefijo, cuenta[0])


def ficha(f):
    return {'id': f['id'], 'name': f['name'], 'mimeType': f['mimeType'],
            'appProperties': dict(f['appProperties'])}


class Drive(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('drive_falso: %s\n' % (fmt % args))

    def cabeceras_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers',
                         'Authorization, Content-Type, X-Upload-Content-Type')
        self.send_header('Access-Control-Allow-Methods',
                         'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'Location')

    def contesta(self, codigo, cuerpo=None, tipo='application/json', extra=None):
        datos = b''
        if cuerpo is not None:
            datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo).encode('utf-8')
        self.send_response(codigo)
        self.cabeceras_cors()
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if cuerpo is not None:
            self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def cuerpo(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def con_permiso(self):
        a = self.headers.get('Authorization') or ''
        if a.startswith('Bearer ') and a[7:] in permisos:
            return True
        self.contesta(401, {'error': {'code': 401, 'message': 'Invalid Credentials'}})
        return False

    def do_OPTIONS(self):
        self.contesta(204)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/auth':
            t = nuevo_id('falso-')
            permisos.add(t)
            vuelta = q['redirect_uri'][0] + '#' + urlencode({
                'access_token': t, 'token_type': 'Bearer', 'expires_in': '3600',
                'state': q.get('state', [''])[0], 'scope': q.get('scope', [''])[0]})
            self.send_response(302)
            self.send_header('Location', vuelta)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if u.path == '/estado':
            with cerrojo:
                return self.contesta(200, {'files': [dict(ficha(f), size=len(f['datos']))
                                                     for f in archivos.values()]})
        if u.path == '/drive/v3/files':
            if not self.con_permiso():
                return
            with cerrojo:
                return self.contesta(200, {'files': [ficha(f) for f in archivos.values()]})
        if u.path.startswith('/drive/v3/files/'):
            if not self.con_permiso():
                return
            f = archivos.get(u.path.rsplit('/', 1)[1])
            if not f:
                return self.contesta(404, {'error': {'code': 404, 'message': 'File not found'}})
            if q.get('alt') == ['media']:
                return self.contesta(200, f['datos'], f['mimeType'])
            return self.contesta(200, ficha(f))
        self.contesta(404, {'error': {'code': 404, 'message': 'no hay tal cosa'}})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == '/caduca':
            permisos.clear()
            return self.contesta(200, {})
        if u.path == '/vacia':
            with cerrojo:
                archivos.clear()
            return self.contesta(200, {})
        if u.path == '/upload/drive/v3/files':
            if not self.con_permiso():
                return
            meta = json.loads(self.cuerpo() or b'{}')
            n = nuevo_id('s')
            sesiones[n] = {'name': meta.get('name', ''), 'appProperties': meta.get('appProperties') or {},
                           'mimeType': self.headers.get('X-Upload-Content-Type') or 'application/octet-stream'}
            donde = 'http://localhost:%d/upload/sesion/%s' % (PUERTO, n)
            return self.contesta(200, None, extra={'Location': donde})
        self.contesta(404, {'error': {'code': 404, 'message': 'no hay tal cosa'}})

    def do_PUT(self):
        u = urlparse(self.path)
        if u.path.startswith('/upload/sesion/'):
            meta = sesiones.pop(u.path.rsplit('/', 1)[1], None)
            if not meta:
                return self.contesta(404, {'error': {'code': 404, 'message': 'sesión desconocida'}})
            f = dict(meta, id=nuevo_id('f'), datos=self.cuerpo())
            with cerrojo:
                archivos[f['id']] = f
            return self.contesta(200, ficha(f))
        self.contesta(404, {'error': {'code': 404, 'message': 'no hay tal cosa'}})

    def do_PATCH(self):
        u = urlparse(self.path)
        if u.path.startswith('/upload/drive/v3/files/'):
            # uploadType=media: el contenido nuevo de un archivo que ya está
            if not self.con_permiso():
                return
            f = archivos.get(u.path.rsplit('/', 1)[1])
            if not f:
                return self.contesta(404, {'error': {'code': 404, 'message': 'File not found'}})
            datos = self.cuerpo()
            with cerrojo:
                f['datos'] = datos
            return self.contesta(200, ficha(f))
        if not u.path.startswith('/drive/v3/files/') or not self.con_permiso():
            return
        f = archivos.get(u.path.rsplit('/', 1)[1])
        if not f:
            return self.contesta(404, {'error': {'code': 404, 'message': 'File not found'}})
        meta = json.loads(self.cuerpo() or b'{}')
        with cerrojo:
            for k, v in (meta.get('appProperties') or {}).items():
                if v is None:
                    f['appProperties'].pop(k, None)
                else:
                    f['appProperties'][k] = str(v)
        self.contesta(200, {'id': f['id']})

    def do_DELETE(self):
        u = urlparse(self.path)
        if not u.path.startswith('/drive/v3/files/') or not self.con_permiso():
            return
        with cerrojo:
            f = archivos.pop(u.path.rsplit('/', 1)[1], None)
        if not f:
            return self.contesta(404, {'error': {'code': 404, 'message': 'File not found'}})
        self.contesta(204)


if __name__ == '__main__':
    print('Drive de mentira en http://localhost:%d' % PUERTO)
    ThreadingHTTPServer(('localhost', PUERTO), Drive).serve_forever()
