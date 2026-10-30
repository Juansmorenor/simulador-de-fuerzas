# Simulador tridimensional de fuerzas y equilibrio

Simulador mecánico en 3D desarrollado para la **Universidad de Pamplona** (color institucional #ad3333). Permite construir sistemas de cuerpos, anclajes, cuerdas y resortes, colocarlos en una escena WebGL con Three.js y comprobar si el conjunto queda en equilibrio traslacional (ΣF = 0).

---

## Características

- **Escena 3D real (WebGL):** rotación, desplazamiento y zoom con el ratón; encuadre automático.
- **Construcción del sistema:** coloca cuerpos (partículas), anclajes, cuerdas y resortes directamente en la escena o desde las propiedades.
- **Catálogo de poleas:** polea fija simple (redirige una cuerda existente) y polea móvil con dos tramos (sostiene un cuerpo, fuerza 2T si los tramos son paralelos).
- **Propiedades dinámicas:** selecciona cualquier elemento para editar masa, posiciones, tensión, constante k y longitud natural L₀.
- **Eliminación en cadena:** borrar un elemento pregunta si hay piezas conectadas y las retira con confirmación.
- **Cálculo y resultados:** peso (m·g), tensión de cuerdas, fuerzas elásticas (Ley de Hooke), resultante por cuerpo, tabla de fuerzas con categorías (conocida/calculada) y desarrollo del cálculo por fila.
- **Estado del sistema:** tarjeta dinámica con veredictos *En equilibrio*, *No está en equilibrio*, *No determinado* o *Sin cuerpos*, con tolerancia de 0,01 N.
- **Límites:** máximo 10 cuerpos, 30 cuerdas, 15 resortes y 5 poleas por escena, con avisos al alcanzarlos.
- **Copia de seguridad del valor anterior:** los datos inválidos no se aceptan y se restaura el valor previo (RF-32).
- **Texto humanizado en español** con decimales en coma (es-CO) y unidades del SI (m, kg, N).

---

## Estructura del proyecto

```
.
├── index.html      # Interfaz: paneles, escena, tablas y diálogos
├── engine.js       # Motor de cálculo puro (sin DOM)
├── app.js          # Escena Three.js, flujos de construcción y UI
├── styles.css      # Tema visual Universidad de Pamplona
├── CAMBIOS.md      # Historial de cambios
├── tests/engine.test.js  # Pruebas del motor de cálculo
└── README.md       # Este archivo
```

---

## Cómo usarlo

### Opción A: doble clic (sin servidor)
Abre `index.html` directamente en el navegador. La librería Three.js se carga desde un CDN, por lo que se necesita conexión a internet la primera vez.

### Opción B: servidor local
```bash
node -e "require('http').createServer((q,r)=>r.end(require('fs').createReadStream('.'+q.url||'/index.html'))).listen(8080)"
```
o cualquier servidor estático, y visita `http://localhost:8080`.

---

## Flujo de trabajo

1. **Nuevo sistema** o **Restablecer**: empieza con el ejemplo precargado (Cuerpo A con resorte y cuerda) o con una escena vacía.
2. **Agregar elementos:** usa el panel izquierdo. Cuerdas y resortes requieren elegir dos puntos (cuerpo o anclaje) en la escena.
3. **Colocar poleas:** abre el catálogo, elige configuración (fija o móvil) y coloca con un clic en la escena.
4. **Editar:** selecciona un elemento en la escena o en la lista *Editar*; ajusta sus datos en el panel derecho.
5. **Verificar:** pulsa *Verificar equilibrio* para calcular ΣF por cuerpo y ver el estado global.
6. **Eliminar:** selecciona un elemento y pulsa *Eliminar*; si tiene conexiones, se pide confirmación antes de retirarlas en cadena.

---

## Requisitos técnicos

- Navegador moderno con soporte para módulos ES y WebGL.
- Conexión a internet para cargar Three.js desde el CDN (si no hay servidor local con las dependencias).
- No requiere instalación, compilación ni frameworks.

---

## Convenciones del sistema internacional

- Longitudes: metros (m)
- Masas: kilogramos (kg)
- Fuerzas: newtons (N)
- Gravedad: 9,81 m/s² por defecto (editable)
- Decimales: coma (ej. 2,00) según es-CO
- Tolerancia de equilibrio: 0,01 N

---

## Licencia

Uso académico — Universidad de Pamplona.
