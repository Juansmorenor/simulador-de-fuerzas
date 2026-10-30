# Cambios · versión 1.3 (30-oct-2026)

- **Escudo institucional en la cabecera:** el icono genérico de trazo (`#i-marca`) se reemplazó por el escudo de la Universidad de Pamplona. El archivo `assets/logo-upamplona.png` quedó en un lienzo cuadrado de 512 × 512 px con el sello centrado y márgenes blancos iguales a los lados, para que no se deforme dentro de un contenedor circular. El contenedor `.brand-icon` pasó a ser un disco blanco de 46 px con borde suave y `object-fit: contain`.

# Cambios · versión 1.2 (30-oct-2026)

- **Iconografía nueva:** los caracteres sueltos (□ ⊙ ∕ ∿ ◎ ✓ ✗ ∅ ⚠) se cambiaron por un juego de iconos SVG de trazo uniforme (sprite al inicio de `index.html`, helper `ico()` en `app.js`). Los botones de cabecera, herramientas de la vista, edición, verificación y las tarjetas de estado llevan su icono; el aviso «revisar / falta dato» de la escena dibuja un triángulo.
- **Ejes que crecen:** cada semieje se alarga hasta abarcar el cuerpo, anclaje o polea más lejano (mínimo 2,6 m, holgura de 0,6 m). Si hay elementos en coordenadas negativas aparece el semieje negativo a trazos, y el piso se agranda con los ejes. El paso entre marcas se ajusta para que no se amontonen.
- **Ejemplos de sistemas:** una lista en la cabecera carga cuatro sistemas armados y en equilibrio: resorte con polea fija (el de siempre), lámpara colgada de tres cuerdas en 3D, dos cuerpos con resortes en serie y carga con polea móvil. Las tensiones y longitudes en reposo se calculan con g y la geometría. «Restablecer» recarga el ejemplo elegido.
- **Ejes en centímetros:** las marcas de los ejes se rotulan en cm (cada 50 cm por defecto). Las coordenadas de los campos siguen en metros.

# Cambios · versión 1.1 (30-oct-2026)

## Errores corregidos
- **Diálogo de confirmación inoperante.** Los botones «Sí, eliminar» y «Conservar todo» no estaban dentro de un formulario `method="dialog"`, así que no cerraban el diálogo. Por eso no se podía eliminar en cadena (RF-05) ni empezar un sistema nuevo con elementos en la escena (RF-01).
- **Rótulos de los ejes gigantes.** Cada redibujo vaciaba la lista que mantiene su tamaño en pantalla, y los rótulos quedaban de 1 m.
- **Color de la cuadrícula inválido** (`0xdfdacff`, con 7 dígitos).
- **«Nuevo sistema» no restablecía g a 9,81 m/s²** (RF-01).
- **La polea móvil no seguía a su cuerpo** al moverlo, y su fuerza se calculaba desde el cuerpo en vez de desde la polea.
- **Validación permisiva:** `parseFloat` aceptaba «12abc». Ahora se rechaza todo lo que no sea un número y lo que pase de 1×10⁶ (RF-32, RNF-11, RNF-17).
- **«−0,00» en pantalla.** El formato podía mostrar ceros negativos (RNF-10).
- **Geometría NaN** con extremos coincidentes en cuerdas y resortes (RF-33).
- **Clics fantasma:** al soltar el ratón tras girar la cámara se seleccionaba o se creaba un elemento. Además, arrastrar un elemento giraba la cámara a la vez.
- **Flechas no proporcionales:** había una longitud mínima, y la escala cambiaba al ocultar un tipo de vector (RF-23, RNF-25).
- **Fugas de memoria:** materiales de flechas y resaltados que no se liberaban.
- **Polea fuera del catálogo** unida a un cuerpo: se ignoraba en silencio. Ahora deja el cuerpo en «No determinado» (RF-20).

## Funciones completadas
- **RF-20:** el motor comprueba que la cuerda sea continua, que no la interrumpa un cuerpo y que la polea esté en el catálogo. Si algo falla, no aplica T₁ = T₂.
- **RF-21:** ejes con punta en el sentido positivo, rótulos +X/+Y/+Z y marcas cada metro.
- **RF-25:** interruptores para la resultante ΣF (flecha gruesa) y para las componentes X, Y, Z del cuerpo de la tabla.
- **RF-30:** las tensiones desconocidas, sin definir o no admitidas aparecen en la tabla con su categoría y sin valor.
- **RF-33 / RF-34:** marcas «⚠» en la escena y un panel de avisos con la causa, el elemento y qué hacer.
- **RF-37 / RNF-22:** el desarrollo abierto se actualiza con cada cambio. Si la actualización en vivo está apagada, los resultados se marcan «Pendiente de verificar» y se ocultan los vectores.
- **RNF-19:** cada cuerda tiene un patrón de línea según su tensión: continua si es conocida, a trazos si es desconocida y punteada si está sin definir. Con las etiquetas apagadas, los vectores conservan su símbolo (P, T, Fe, ΣF).
- **RNF-21:** teclado completo. Enter coloca un elemento en su posición por defecto, la lista «Editar» elige los extremos de cuerdas y resortes, las flechas orbitan, + y − hacen zoom, 0 encuadra y Enter en una fila de la tabla abre su desarrollo.
- **RF-04:** con Mayús + arrastre se cambia la altura de un elemento.
- **RNF-09:** las longitudes se muestran con 3 decimales y los campos editables conservan el valor sin redondear.

## Pruebas
`node tests/engine.test.js` ejecuta 31 casos con los criterios de aceptación (RF-07 a RF-37, RNF-08, 10, 11, 13, 17 y 23) sin cargar la interfaz.

## Pendiente (depende de decisiones del equipo)
- **RF-14** (resolver incógnitas): condicionado a D-08. El motor tiene el interruptor `RESOLVER_INCOGNITAS = false`.
- **RNF-20:** varios textos secundarios miden 10,5–12 px, por debajo de los 14 px propuestos. Cambiarlo afecta al diseño general.
- **τ absoluta o relativa** (D-05): por ahora τ = 0,01 N absoluta.
