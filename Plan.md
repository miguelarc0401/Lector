# Lector — plan

Una app para escuchar libros en voz alta, **sin conexión**, con el libro
partido en sus capítulos y secciones, y que empiece a leer donde uno toque.

Este plan sale de `Lector.txt` y de lo que ya se aprendió haciendo
Liturgicum (`..\Lectionarium\app\`), sobre todo de `piper.js` y de la
sección «Rezarla en alta voz» de su `LEEME.md`.

---

## 0. Decisiones tomadas

- **Android con Chrome.**
- **La mayoría de los libros en español, pero cualquier idioma**: cada libro
  lleva su idioma y la voz se elige por idioma.
- **El OCR, sobre todo en la computadora, pero que también se pueda en el
  teléfono.** Es el mismo código en los dos (la app abierta en Chrome del PC
  va más rápido); el libro ya pasado por OCR se exporta a EPUB y se abre en
  el teléfono.
- **Se publica en el mismo GitHub que Liturgicum**:
  `miguelarc0401.github.io/lector/`.
- **No se guarda audio en el teléfono. Se lee en el momento.** Lo único que se
  baja es la voz misma (el modelo de Piper, una vez); el audio se hace mientras
  se escucha, vive solo en memoria y se suelta en cuanto suena.

---

## 1. La forma de la app

**Una PWA como Liturgicum**: HTML + JS sin paso de compilación, publicada en
GitHub Pages, instalada en la pantalla de inicio y funcionando sin red.
Todo pasa **dentro del teléfono** (o del PC): el libro no se sube a ningún
servidor, «subir» quiere decir solo «abrirlo en la app».

```
 archivo ──▶ extraer texto ──▶ limpiar ──▶ hallar la estructura ──▶ revisar índice
 (EPUB, PDF,   (o OCR si es                (índice propio del        (el usuario
  DOCX, TXT)    un escaneo)                 libro, o heurísticas)     corrige)
                                                     │
                                                     ▼
                         biblioteca ◀── libro guardado: árbol de capítulos
                                                     │
                                                     ▼
            tocar un párrafo ──▶ Piper (worker) ──▶ audio en memoria ──▶ se oye y se suelta
                                 hace lo que viene     (unos minutos      (pantalla apagada,
                                 por delante            por delante)       auriculares, volante)
```

### Lo que se reutiliza de Liturgicum

- **`piper.js` tal cual** (el motor en un worker, la caché propia `voz-piper`,
  la descarga con barra, «decir no baja nunca nada»).
- **La lista de voces**, que ya trae las de México (`es_MX-claude-high`,
  `es_MX-ald-medium`, `es_MX-ald-x_low`) y las de España.
- **La forma de sonar con la pantalla apagada**: cada trozo por un `<audio>`,
  el audio mudo en bucle que mantiene viva la página, y los mandos por
  MediaSession.
- **El service worker y `publicar.ps1`**, adaptados.
- **La voz se baja una sola vez para las dos apps**: Lector y Liturgicum
  estarán en el mismo origen (`miguelarc0401.github.io`), así que la caché
  `voz-piper` es la misma. El service worker de Liturgicum solo borra las
  cachés `leccionario-*`, y el de Lector solo borrará las `lector-*`.

---

## 2. Las piezas

### 2.1 Importar el libro

| Formato | Cómo se lee | De dónde sale el índice |
|---|---|---|
| **EPUB** | JSZip + DOMParser | el índice del propio EPUB (`nav.xhtml` / `toc.ncx`): exacto |
| **DOCX** | mammoth.js | los estilos de título (Título 1, 2…) |
| **PDF con texto** | pdf.js | los marcadores del PDF (`getOutline`); si no hay, el índice impreso; si no, el tamaño de letra |
| **PDF escaneado** | pdf.js pinta la página → Tesseract.js en un worker | como el anterior, una vez hecho el OCR |
| **TXT / MD** | directo | «Capítulo N», numerales romanos, `#` de Markdown |

- **El idioma del libro**: del propio EPUB (`dc:language`) si lo trae; si no,
  se adivina por las palabras más comunes y se confirma al importar. De él
  salen la voz y el idioma del OCR.
- **Antes del OCR, mirar si la página ya trae texto**: muchos PDF que parecen
  escaneados ya traen una capa de OCR. Solo se pasa por Tesseract la página que
  no la tenga.
- **El OCR se guarda página por página**: si se corta a la mitad, sigue por
  donde iba.
- **Exportar** el texto ya limpio y con su estructura a **EPUB** (para pasarlo
  del PC al teléfono y para cualquier lector), **DOCX** (lo que pide el txt) y
  TXT.

### 2.2 Limpiar el texto (lo que más se nota al oírlo)

- Quitar cabeceras y pies repetidos y los números de página.
- Unir las palabras partidas a final de línea (`pala-` + `bra`) y las líneas
  del mismo párrafo.
- Las **notas al pie**: callarlas, o leerlas al final del párrafo (ajuste).
- Separar en **párrafos y oraciones**: la oración es la unidad que se dice,
  se resalta y desde la que se puede empezar.

### 2.3 Hallar la estructura — «según su propio índice»

Por orden de confianza:

1. **El índice que trae el archivo** (EPUB, marcadores del PDF, estilos de Word).
2. **El índice impreso del libro**: localizar las páginas del «Índice» o
   «Contenido», sacar cada entrada (título + página) y buscar ese título en el
   cuerpo, cerca de esa página, con búsqueda aproximada (tolera errores de OCR).
3. **Heurísticas**: tamaño y peso de la letra (pdf.js lo da), líneas cortas
   aisladas, «Capítulo», «Parte», numerales.

Y siempre, al final, una pantalla **«Revisar índice»**: ver lo detectado,
renombrar, unir, partir, subir o bajar de nivel. Ninguna detección en PDF va a
acertar siempre, y es mejor un minuto de revisión que un libro mal partido.

### 2.4 La voz

- **Piper, como en Liturgicum.** Sigue siendo lo mejor que corre en el
  teléfono sin red y sin tarjeta gráfica (Kokoro y Chatterbox ya se
  descartaron allí por eso).
- **Una voz por idioma**: Piper tiene voces para unas cuarenta lenguas. Cada
  una se baja la primera vez que haga falta (de 20 a 80 MB) y queda para
  siempre; el motor (29 MB) es común a todas.
- **Normalizar para la voz sin tocar el texto que se ve**: numerales romanos
  (*Capítulo IV*, *Felipe II*), abreviaturas (*Sr.*, *pág.*, *etc.*), llamadas
  de nota, siglas.
- **Un diccionario de pronunciación editable** por el usuario, por libro y
  general (nombres propios, extranjerismos).

### 2.5 El audio: en el momento, sin guardar nada

Piper hace la voz **mientras se escucha**. Lo que va haciendo por delante se
queda en memoria y se suelta en cuanto suena; en el disco no queda nada.

**El reto**, ya visto en Liturgicum: con la pantalla apagada el navegador
frena a Piper casi al ritmo de lo que dice. Si lo frena *más* que eso, la voz
se va quedando callada entre frase y frase. Para la hora del oficio bastaba
con adelantar cuarenta trozos; un libro se escucha horas. Lo que se hace:

- **Adelantar en memoria mientras la pantalla está encendida**: unos minutos
  por delante (cada minuto de voz son ~2,6 MB de memoria; veinte minutos,
  unos 50 MB, que un teléfono lleva sin notarlo). Lo adelantado cubre después
  lo que el teléfono no alcanza a hacer con la pantalla apagada.
- **Medirlo en tu teléfono antes de construir nada más** (Fase 0): si con la
  pantalla apagada hace la voz al menos tan deprisa como la dice, el libro
  entero suena sin cortes y no hay más que hablar.
- Si no llega: **la voz ligera** (`x_low`, casi el doble de rápida); y si
  tampoco, el plan B de la app nativa (§5).
- **Tocar un párrafo** suelta lo adelantado y empieza ahí: la primera frase
  se hace sola, para que suene en un segundo.
- **La velocidad** se le pide a Piper (dice más deprisa, sin cambiar el tono);
  al cambiarla se rehace lo adelantado.

### 2.6 Leer y escuchar

- Biblioteca con portada, progreso y última posición de cada libro.
- Índice desplegable (capítulos → secciones).
- Vista de lectura con **la oración que suena resaltada**; **tocar cualquier
  párrafo empieza a leer desde ahí**.
- Recordar la posición exacta (libro, párrafo, oración) y retomarla al abrir.
- Barra de mandos: anterior / pausa / siguiente (sección y párrafo),
  retroceder una frase, velocidad, **temporizador de apagado**.
- Mandos del volante y de los auriculares (MediaSession).
- Marcadores.

---

## 3. Fases

Cada fase termina en algo que se puede usar en el teléfono.

### Fase 0 — Pruebas de viabilidad

Un banco de pruebas (`app/pruebas.html`) para medir en **tu teléfono** lo que
puede tumbar el diseño:

- [ ] Bajar las voces candidatas y oír la misma frase en cada una.
- [ ] Medir cuánto más deprisa hace la voz de lo que la dice, con la pantalla
      encendida.
- [ ] **Escucha larga**: un texto largo, en vivo, 30 minutos con la pantalla
      apagada; al volver, el informe dice cuántas veces se calló, cuánto, y a
      qué ritmo hizo la voz con la pantalla encendida y con la apagada.
- [ ] Publicarlo en GitHub Pages para abrirlo en el teléfono (la caché de la
      voz pide `https`).

**Listo cuando:** sabemos la voz, y si con la pantalla apagada aguanta media
hora sin cortes.

### Fase 1 — Esqueleto y primer libro (EPUB y TXT)

- [ ] PWA (`index.html`, `sw.js`, manifest) y biblioteca en IndexedDB.
- [ ] Importar EPUB y TXT, con su árbol de capítulos y su idioma.
- [ ] Vista de lectura, índice, tocar un párrafo → leer desde ahí, resaltado.
- [ ] Recordar la posición.

**Listo cuando:** abro un EPUB en el teléfono, veo su índice, toco un párrafo
del capítulo 5 y lo lee, sin red.

### Fase 2 — Escucha larga (coche, bolsillo, cama)

- [ ] El adelanto en memoria ajustado a lo que midió la Fase 0.
- [ ] Mandos por MediaSession, velocidad, temporizador de apagado.
- [ ] Si el teléfono la corta, al volver sigue por donde iba.

**Listo cuando:** una hora seguida con la pantalla apagada, sin cortes, y al
volver a mirar el teléfono la vista está en la oración que suena.

### Fase 3 — PDF con texto y Word

- [ ] pdf.js: texto, marcadores, tamaños de letra.
- [ ] Limpieza: cabeceras, pies, números de página, guiones, notas.
- [ ] Emparejar el índice impreso con el cuerpo.
- [ ] DOCX con mammoth.js.
- [ ] Pantalla «Revisar índice».

**Listo cuando:** un PDF digital de un libro tuyo queda partido como su índice
con, a lo sumo, un par de retoques a mano.

### Fase 4 — PDF escaneado (OCR) y exportar

- [ ] Detectar las páginas sin texto y pasarlas por Tesseract.js, en un
      worker, con barra y reanudable. En el PC y en el teléfono.
- [ ] Exportar a EPUB, DOCX y TXT.

**Listo cuando:** un libro escaneado entra en el PC, sale como EPUB, se abre
en el teléfono y se oye bien.

### Fase 5 — Pulido y publicación

- [ ] Normalización para la voz y diccionario de pronunciación.
- [ ] Marcadores y búsqueda dentro del libro.
- [ ] `LEEME.md`.

---

## 4. Riesgos y planes B

| Riesgo | Cómo se nota | Plan B |
|---|---|---|
| Con la pantalla apagada, Piper no llega | la escucha larga de la Fase 0 se calla | más adelanto en memoria; voz ligera; y si no, app nativa (§5) |
| Piper va lento hasta con la pantalla encendida | la Fase 0 da menos de 1,5 veces | voz ligera (`x_low`) |
| OCR malo en algún escaneo | texto con basura | un script en el PC (OCRmyPDF u otro OCR mejor) que deja un PDF con texto y entra por la Fase 3 |
| Libro en un idioma sin voz de Piper | no hay voz que bajar | la voz del sistema de Android para ese libro |

---

## 5. Si un día es una app «de verdad»

La parte que cambia es la voz, y cambia para bien. Una app nativa de Android
corre Piper **fuera del navegador**: con **sherpa-onnx**, que lee los mismos
modelos `.onnx` de Piper y trae el espeak-ng dentro, desde un *servicio en
primer plano* de reproducción, que es lo que usan las apps de música y de
audiolibros. Ahí el sistema no la frena con la pantalla apagada, puede usar
varios núcleos y va varias veces más deprisa que en el navegador.

Hay dos caminos, y el código que se haga ahora sirve para los dos:

- **Capacitor**: la misma app web metida en un APK, con un complemento nativo
  que hace la voz con sherpa-onnx. Se reutiliza casi todo (importar, índice,
  lectura) y solo se reescribe el motor de la voz. **Es el que recomiendo.**
- **Kotlin desde cero**: lo más fino, pero es rehacerla entera.

Por eso el motor de la voz va aparte desde el principio (`voz.js` habla con
`piper.js` por mensajes): cambiar el motor no toca el resto de la app.
