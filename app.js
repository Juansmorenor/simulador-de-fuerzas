/* ============================================================
   app.js — Interfaz y escena 3D del simulador de equilibrio.
   Script clásico + import() dinámico de Three.js (WebGL),
   para funcionar tanto con doble clic (file://) como por
   servidor local (http://).

   Construcción del sistema: nuevo sistema, cuerpos, anclajes,
   posición (clic + arrastre + coordenadas), eliminación en
   cadena con confirmación, cuerdas, resortes, catálogo de
   poleas, selección y propiedades. El cálculo lo hace Engine.
   ============================================================ */

(async () => {

let THREE, OrbitControls;
try {
  THREE = await import('three');
  ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
} catch (e) {
  const nota = document.getElementById('canvasNote');
  if (nota) nota.innerHTML = '<strong>No se pudo cargar la librería 3D (Three.js).</strong><br>Revisa tu conexión a internet y recarga la página.';
  console.error('Falló la carga de Three.js:', e);
  return;
}

/* ================= utilidades ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// icono del sprite SVG de index.html
const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const f2 = (n, d = 2) => Engine.fmt(n, d);   // fuerzas: 2 decimales
const f3 = n => Engine.fmt(n, 3);              // longitudes: 3 decimales
const fIn = n => Engine.fmtInput(n);           // valor editable, sin redondeo visible
const sgn = n => Engine.fmt(n, 2);

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ================= modelo de datos ================= */
const MAXES = Engine.MAXES; // {cuerpos, cuerdas, resortes, poleas}

const S = {
  nombre: 'Sistema 01',
  g: 9.81,
  cuerpos: [], anclajes: [], cuerdas: [], resortes: [], poleas: [],
  cont: { cuerpo: 0, anclaje: 0, cuerda: 0, resorte: 0, polea: 0, soporte: 0 },
};

let uidN = 0;
const nid = pref => pref + (++uidN);

const LISTAS = () => ({
  cuerpo: S.cuerpos, anclaje: S.anclajes, cuerda: S.cuerdas,
  resorte: S.resortes, polea: S.poleas,
});

function buscar(id) {
  for (const [tipo, lista] of Object.entries(LISTAS())) {
    const el = lista.find(e => e.id === id);
    if (el) return { tipo, el };
  }
  return null;
}
const siguienteNombre = tipo => {
  const n = ++S.cont[tipo];
  return { cuerpo: `Cuerpo ${n}`, anclaje: `Anclaje ${n}`, cuerda: `Cuerda C${n}`, resorte: `Resorte R${n}`, polea: `Polea P${n}`, soporte: `Soporte ${n}` }[tipo];
};
const contar = tipo => ({ cuerpo: S.cuerpos, anclaje: S.anclajes, cuerda: S.cuerdas, resorte: S.resortes, polea: S.poleas }[tipo]).length;

function dentroLimite(tipo) {
  const clave = { cuerpo: 'cuerpos', cuerda: 'cuerdas', resorte: 'resortes', polea: 'poleas', anclaje: null }[tipo];
  if (!clave) return true;
  if (contar(tipo) >= MAXES[clave]) {
    const carte = { cuerpos: '10 cuerpos', cuerdas: '30 cuerdas', resortes: '15 resortes', poleas: '5 poleas' }[clave];
    toast(`Llegaste al máximo de ${carte}. Quita alguno para poder crear otro.`);
    return false;
  }
  return true;
}

/* -------- creación de elementos -------- */
function crearCuerpo(pos) {
  if (!dentroLimite('cuerpo')) return null;
  const el = { id: nid('cu'), nombre: siguienteNombre('cuerpo'), masa: 1.0, pos: [pos[0], pos[1], pos[2]] };
  S.cuerpos.push(el);
  return el;
}
function crearAnclaje(pos) {
  const el = { id: nid('an'), nombre: siguienteNombre('anclaje'), pos: [pos[0], pos[1], pos[2]] };
  S.anclajes.push(el);
  return el;
}
function crearCuerda(a, b) {
  if (!dentroLimite('cuerda')) return null;
  const el = { id: nid('cd'), nombre: siguienteNombre('cuerda'), tramos: [{ a, b }], tension: { tipo: 'sin_definir', valor: 0 }, ext: null };
  S.cuerdas.push(el);
  return el;
}
function crearResorte(a, b) {
  if (!dentroLimite('resorte')) return null;
  const el = { id: nid('rs'), nombre: siguienteNombre('resorte'), a, b, k: 100, L0: 1.0 };
  S.resortes.push(el);
  return el;
}
/* Polea fija: redirige una cuerda existente */
function crearPoleaFija(cuerdaId, pos) {
  if (!dentroLimite('polea')) return null;
  const cuerda = S.cuerdas.find(c => c.id === cuerdaId);
  if (!cuerda || cuerda.tramos.length !== 1) { toast('Esa cuerda ya tiene una polea.'); return null; }
  const { a, b } = cuerda.tramos[0];
  const el = { id: nid('pl'), nombre: siguienteNombre('polea'), tipo: 'fija', pos: [pos[0], pos[1], pos[2]], cuerdaId };
  S.poleas.push(el);
  cuerda.tramos = [{ a, b: el.id }, { a: el.id, b }];
  return el;
}
/* Polea móvil: se une a un cuerpo; crea soporte + cuerda de dos tramos */
function crearPoleaMovil(cuerpoId) {
  if (!dentroLimite('polea')) return null;
  const cuerpo = S.cuerpos.find(c => c.id === cuerpoId);
  if (!cuerpo) return null;
  const soporte = crearAnclaje([cuerpo.pos[0], +(cuerpo.pos[1] + 1.3).toFixed(3), cuerpo.pos[2]]);
  soporte.nombre = siguienteNombre('soporte');
  const cuerda = crearCuerda(soporte.id, null);
  if (!cuerda) { quitarDirecto('anclaje', soporte.id); return null; }
  const el = { id: nid('pl'), nombre: siguienteNombre('polea'), tipo: 'movil', pos: [cuerpo.pos[0], +(cuerpo.pos[1] + 0.5).toFixed(3), cuerpo.pos[2]], cuerdaId: cuerda.id, unidoA: cuerpoId, soporteId: soporte.id };
  S.poleas.push(el);
  cuerda.tramos = [{ a: soporte.id, b: el.id }, { a: el.id, b: soporte.id }];
  return el;
}
function quitarDirecto(tipo, id) {
  const lista = LISTAS()[tipo];
  const i = lista.findIndex(e => e.id === id);
  if (i >= 0) lista.splice(i, 1);
}

/* -------- dependencias y eliminación en cadena -------- */
const tramosTocan = (cuerda, id) => cuerda.tramos.some(t => t.a === id || t.b === id);

function dependenciasDe(id) {
  const out = [];
  const b = buscar(id);
  if (!b) return out;
  const va = (idDep, texto) => out.push({ id: idDep, texto });

  if (b.tipo === 'cuerpo' || b.tipo === 'anclaje') {
    for (const c of S.cuerdas) if (tramosTocan(c, id)) va(c.id, `${c.nombre} (cuerda amarrada)`);
    for (const r of S.resortes) if (r.a === id || r.b === id) va(r.id, `${r.nombre} (resorte conectado)`);
    if (b.tipo === 'cuerpo')
      for (const p of S.poleas) if (p.unidoA === id) va(p.id, `${p.nombre} (polea móvil unida)`);
  } else if (b.tipo === 'cuerda') {
    for (const p of S.poleas) if (p.cuerdaId === id) va(p.id, `${p.nombre} (polea sobre esta cuerda)`);
  }
  // una polea móvil arrastra su cuerda y su soporte
  return out;
}

function eliminarEnCadena(id, borrados = []) {
  const b = buscar(id);
  if (!b) return borrados;
  const polea = b.tipo === 'polea' ? b.el : null;

  // polea móvil: se retira junto con su cuerda y su soporte
  if (polea && polea.tipo === 'movil') {
    const suCuerda = S.cuerdas.find(c => c.id === polea.cuerdaId);
    if (suCuerda) {
      borrados.push(suCuerda.nombre);
      quitarDirecto('cuerda', suCuerda.id);
      // con la cuerda fuera, cualquier otra polea de esa cuerda también se retira
      for (const otra of [...S.poleas]) if (otra.cuerdaId === suCuerda.id) {
        borrados.push(otra.nombre);
        quitarDirecto('polea', otra.id);
      }
    }
    if (polea.soporteId && buscar(polea.soporteId)) {
      const libre = !S.cuerdas.some(c => tramosTocan(c, polea.soporteId)) && !S.resortes.some(r => r.a === polea.soporteId || r.b === polea.soporteId);
      if (libre) {
        const sop = buscar(polea.soporteId);
        borrados.push(sop.el.nombre);
        quitarDirecto(sop.tipo, sop.el.id);
      }
    }
    borrados.push(polea.nombre);
    quitarDirecto('polea', polea.id);
    if (S_SEL === polea.id) seleccionar(null);
    return borrados;
  }

  for (const dep of dependenciasDe(id)) eliminarEnCadena(dep.id, borrados);

  // restaurar la cuerda si quitamos una polea fija que la redirigía
  if (polea && polea.tipo === 'fija' && polea.cuerdaId) {
    const cuerda = S.cuerdas.find(c => c.id === polea.cuerdaId);
    if (cuerda) {
      const primero = cuerda.tramos[0], ultimo = cuerda.tramos[cuerda.tramos.length - 1];
      if (primero.a !== ultimo.b) cuerda.tramos = [{ a: primero.a, b: ultimo.b }];
    }
  }

  borrados.push(b.el.nombre);
  quitarDirecto(b.tipo, b.el.id);
  if (S_SEL === id) seleccionar(null);
  return borrados;
}

/* -------- polea móvil: va unida a su cuerpo y lo acompaña -------- */
const DESFASE_MOVIL = 0.5;  // m sobre el cuerpo
function sincronizarPoleasMoviles() {
  for (const p of S.poleas) {
    if (p.tipo !== 'movil') continue;
    const c = S.cuerpos.find(x => x.id === p.unidoA);
    if (c) p.pos = [c.pos[0], c.pos[1] + DESFASE_MOVIL, c.pos[2]];
  }
}

/* -------- construcción del input del motor -------- */
function sistParaMotor() {
  sincronizarPoleasMoviles();
  return {
    g: S.g,
    cuerpos: S.cuerpos.map(({ id, nombre, masa, pos }) => ({ id, nombre, masa, pos })),
    anclajes: S.anclajes.map(({ id, nombre, pos }) => ({ id, nombre, pos })),
    poleas: S.poleas.map(({ id, nombre, pos, tipo, cuerdaId, unidoA }) => ({ id, nombre, pos, tipo, cuerdaId, unidoA })),
    cuerdas: S.cuerdas.map(({ id, nombre, tramos, tension }) => ({ id, nombre, tramos, tension })),
    resortes: S.resortes.map(({ id, nombre, a, b, k, L0 }) => ({ id, nombre, a, b, k, L0 })),
  };
}

/* ================= selección ================= */
let S_SEL = null;          // id del elemento seleccionado
let TABLA_CUERPO = null;   // id del cuerpo mostrado en la tabla

function seleccionar(id) {
  S_SEL = id;
  const b = id ? buscar(id) : null;
  if (b && b.tipo === 'cuerpo') TABLA_CUERPO = id;
  renderUI();
}

/* ================= pipeline de cálculo ================= */
let RESULT = Engine.calcular(sistParaMotor());
let STALE = false;   // hay cambios sin verificar (actualización en vivo apagada)

function recalc() {
  RESULT = Engine.calcular(sistParaMotor());
  STALE = false;
  renderUI();
  drawScene();
}
// actualización en vivo apagada: se redibuja la geometría, pero los resultados
// anteriores se ocultan o se marcan como desactualizados
function recalcVisual() {
  STALE = true;
  drawScene();
  renderUI();
}
const datoPendiente = () => !$('#chkAuto').checked;
const cambio = () => (datoPendiente() ? recalcVisual() : recalc());

/* ================= escena 3D (Three.js) ================= */
const stage = $('#stage');
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf7f5f1);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
const HOME = { pos: new THREE.Vector3(5.4, 3.5, 6.6), target: new THREE.Vector3(0, 1.0, 0) };
const HOME_DIST = HOME.pos.distanceTo(HOME.target);
camera.position.copy(HOME.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 40;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a4, 0.95));
const luz = new THREE.DirectionalLight(0xffffff, 0.75);
luz.position.set(4, 7, 3);
scene.add(luz);

const gFondo = new THREE.Group();   // piso, ejes
const gModelo = new THREE.Group();  // elementos del sistema
const gFuerzas = new THREE.Group(); // vectores de fuerza
scene.add(gFondo, gModelo, gFuerzas);

let grid = new THREE.GridHelper(10, 10, 0xc9c1b5, 0xdfdacf);
gFondo.add(grid);
const ejes = new THREE.Group();     // ejes X, Y, Z: crecen con los elementos y se rotulan en cm
gFondo.add(ejes);

/* -------- materiales compartidos -------- */
const MAT = {
  cuerpo: new THREE.MeshStandardMaterial({ color: 0xad3333, roughness: 0.35 }),
  anclaje: new THREE.MeshStandardMaterial({ color: 0x6d655d, roughness: 0.6 }),
  pincho: new THREE.MeshStandardMaterial({ color: 0x4a443e, roughness: 0.5 }),
  poleaFija: new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.35, metalness: 0.25 }),
  poleaMovil: new THREE.MeshStandardMaterial({ color: 0xb98a2d, roughness: 0.4, metalness: 0.2 }),
  libre: new THREE.MeshStandardMaterial({ color: 0x8d857a, roughness: 0.6 }),
};
const GEO = {
  cuerpo: new THREE.SphereGeometry(0.14, 24, 18),
  pin: new THREE.CylinderGeometry(0.02, 0.02, 0.16, 10),
  nodo: new THREE.SphereGeometry(0.045, 12, 10),
  tramo: new THREE.CylinderGeometry(0.013, 0.013, 1, 8, 1, true),
  aro: new THREE.TorusGeometry(0.11, 0.028, 12, 28),
  esferaLibre: new THREE.SphereGeometry(0.05, 10, 8),
  tick: new THREE.SphereGeometry(0.028, 8, 6),
  eje: new THREE.CylinderGeometry(1, 1, 1, 10),
  punta: new THREE.ConeGeometry(1, 1, 14),
};
const MAT_CUERDA = {
  conocida: new THREE.MeshBasicMaterial({ color: 0x2f4d6b }),
  desconocida: new THREE.MeshBasicMaterial({ color: 0x5b7ea3 }),
  sin_definir: new THREE.MeshBasicMaterial({ color: 0xa09789 }),
};
const COL = { tension: 0x2f4d6b, tensionND: 0xb0a89d, resorte: 0x2f6b5e, peso: 0x3a342e, resultante: 0xad3333 };

/* -------- etiquetas (sprites con tamaño de pantalla constante) -------- */
const labelSprites = [];   // etiquetas que se redibujan con la escena
const labelsFijos = [];    // rótulos de los ejes (no se borran)
const labelCache = new Map();

function materialLabel(texto, { color = '#27221e', chip = true, peso = 700, aviso = false }) {
  const clave = `${peso}|${color}|${chip}|${aviso}|${texto}`;
  if (labelCache.has(clave)) return labelCache.get(clave);

  const cnv = document.createElement('canvas');
  const ctx = cnv.getContext('2d');
  const fuente = `${peso} 30px "Nunito Sans", "Segoe UI", Arial, sans-serif`;
  ctx.font = fuente;
  const wTxt = ctx.measureText(texto).width;
  const padX = chip ? 14 : 2, padY = chip ? 9 : 2;
  const wIco = aviso ? 34 : 0;   // triángulo de aviso + separación
  cnv.width = Math.ceil(wTxt + wIco + padX * 2);
  cnv.height = Math.ceil(30 * 1.25 + padY * 2);
  ctx.font = fuente;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (chip) {
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.strokeStyle = '#d3ccc2';
    ctx.lineWidth = 2;
    const r = 9;
    ctx.beginPath();
    ctx.roundRect(1, 1, cnv.width - 2, cnv.height - 2, r);
    ctx.fill(); ctx.stroke();
  }
  if (aviso) {
    const cx = padX + 13, cy = cnv.height / 2;
    ctx.strokeStyle = color; ctx.lineWidth = 3.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 13, cy + 11); ctx.lineTo(cx - 13, cy + 11); ctx.closePath();
    ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy + 7.5, 1.9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillText(texto, (cnv.width + wIco) / 2, cnv.height / 2 + 1);

  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  labelCache.set(clave, mat);
  return mat;
}

function ponerLabel(texto, pos, { px = 12, color = '#27221e', chip = true, peso = 700, aviso = false } = {}, grupo = gModelo) {
  const spr = new THREE.Sprite(materialLabel(texto, { color, chip, peso, aviso }));
  spr.renderOrder = 20;
  spr.position.copy(pos);
  spr.userData.px = px;
  (grupo === gModelo || grupo === gFuerzas ? labelSprites : labelsFijos).push(spr);
  grupo.add(spr);
  return spr;
}

/* -------- posiciones -------- */
function posV3(id) {
  const b = buscar(id);
  return b ? new THREE.Vector3(...b.el.pos) : null;
}
function posFinTramo(cuerda, lado) {
  if (lado === 'LIBRE') {
    // el extremo libre cuelga decorativamente desde el tramo al que pertenece
    const tramo = cuerda.tramos.find(t => t.a === 'LIBRE' || t.b === 'LIBRE');
    const base = tramo ? (posV3(tramo.a === 'LIBRE' ? tramo.b : tramo.a) || new THREE.Vector3()) : new THREE.Vector3();
    return new THREE.Vector3(base.x + 0.55, Math.max(base.y - 0.75, 0.2), base.z);
  }
  return posV3(lado) || new THREE.Vector3();
}

/* -------- dibujo de la escena -------- */
let pickTargets = [];
const EPS_GEO = Engine.EPS_GEO;

// libera geometrías y materiales propios de lo que se retira (evita fugas de memoria)
function limpiar(grupo) {
  for (const hijo of [...grupo.children]) {
    hijo.traverse(o => {
      if (o.userData.geo) o.geometry?.dispose?.();
      if (o.userData.mat) o.material?.dispose?.();
    });
    grupo.remove(hijo);
  }
}
const desechable = (obj, { geo = false, mat = true } = {}) => {
  obj.traverse(o => { o.userData.geo = geo; o.userData.mat = mat; });
  return obj;
};

// segmento cilíndrico entre a y b; null si la distancia es nula
function cilindroEntre(a, b, radio, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (!(len > EPS_GEO)) return null;
  const mesh = new THREE.Mesh(GEO.tramo, material);
  mesh.scale.set(radio / 0.013, len, radio / 0.013);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}
// patrón de línea según el estado de la tensión (no depender solo del color)
const PATRON = { conocida: null, desconocida: [0.11, 0.07], sin_definir: [0.03, 0.06] };
function tramoConPatron(a, b, material, patron) {
  if (!patron) { const m = cilindroEntre(a, b, 0.013, material); return m ? [m] : []; }
  const len = a.distanceTo(b);
  if (!(len > EPS_GEO)) return [];
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const [trazo, hueco] = patron, piezas = [];
  for (let t = 0; t < len; t += trazo + hueco) {
    const p0 = a.clone().addScaledVector(dir, t);
    const p1 = a.clone().addScaledVector(dir, Math.min(len, t + trazo));
    const m = cilindroEntre(p0, p1, 0.015, material);
    if (m) piezas.push(m);
  }
  return piezas;
}

function resorteZigzag(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (!(len > EPS_GEO)) return null;
  dir.normalize();
  const w = new THREE.Vector3(0, 0, 1).cross(dir);
  if (w.lengthSq() < 0.02) w.set(0, 1, 0).cross(dir);
  w.normalize();
  const vueltas = Math.max(6, Math.min(16, Math.round(len / 0.09)));
  const pts = [a.clone(), a.clone().addScaledVector(dir, len * 0.06)];
  for (let i = 0; i <= vueltas; i++) {
    const t = 0.1 + 0.8 * (i / vueltas);
    const p = a.clone().addScaledVector(dir, len * t);
    p.addScaledVector(w, i % 2 ? 0.045 : -0.045);
    pts.push(p);
  }
  pts.push(a.clone().addScaledVector(dir, len * 0.94), b.clone());
  return pts;
}

// flecha gruesa (cilindro + cono) para la resultante: forma distinta de las demás
function flechaGruesa(origen, dir, len, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const cabeza = Math.min(0.2, len * 0.35);
  const cuerpo = new THREE.Mesh(GEO.eje, mat);
  cuerpo.scale.set(0.022, Math.max(len - cabeza, 1e-4), 0.022);
  cuerpo.position.y = (len - cabeza) / 2;
  const punta = new THREE.Mesh(GEO.punta, mat);
  punta.scale.set(0.06, cabeza, 0.06);
  punta.position.y = len - cabeza / 2;
  g.add(cuerpo, punta);
  g.position.copy(origen);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.renderOrder = 12;
  cuerpo.renderOrder = punta.renderOrder = 12;
  return g;
}

/* ejes X, Y, Z: sentido positivo con punta y marcas rotuladas en centímetros.
   Cada semieje se alarga hasta abarcar el elemento más lejano en esa dirección;
   la escena sigue en metros, solo los rótulos pasan a cm. */
const EJE_MIN = 2.6;     // largo mínimo del semieje positivo (m)
const EJE_MARGEN = 0.6;  // holgura más allá del elemento más lejano (m)
const EJE_EPS_NEG = 0.05; // coordenadas negativas menores que esto no abren el semieje negativo
let ejesClave = '';

// extensión ocupada por los elementos: [mín, máx] por eje, en metros
function extensionElementos() {
  const ext = [[0, 0], [0, 0], [0, 0]];
  const incluir = pos => pos.forEach((v, k) => {
    if (!isFinite(v)) return;
    ext[k][0] = Math.min(ext[k][0], v);
    ext[k][1] = Math.max(ext[k][1], v);
  });
  for (const el of [...S.cuerpos, ...S.anclajes, ...S.poleas]) if (el.pos) incluir(el.pos);
  return ext;
}

// paso entre marcas (m): se agranda con el eje para que los rótulos no se amontonen
const pasoMarcas = largo => [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find(p => largo / p <= 8) || 200;
const cm = m => `${Math.round(m * 100)} cm`;

function construirEjes() {
  const ext = extensionElementos();
  const pos = ext.map(([, mx]) => Math.max(EJE_MIN, Math.ceil((mx + EJE_MARGEN) * 2) / 2));
  const neg = ext.map(([mn]) => (mn < -EJE_EPS_NEG ? Math.ceil((-mn + EJE_MARGEN) * 2) / 2 : 0));
  const clave = pos.concat(neg).join('|');
  if (clave === ejesClave) return;   // nada cambió: no se reconstruye
  ejesClave = clave;

  // retira los ejes anteriores y sus rótulos
  for (const o of ejes.children) if (o.isSprite) labelsFijos.splice(labelsFijos.indexOf(o), 1);
  ejes.children.filter(o => o.isSprite).forEach(o => { o.userData.mat = false; });   // materiales en caché
  limpiar(ejes);

  const defs = [
    { v: [1, 0, 0], col: 0xa33b3b, css: '#8c3b3b', txt: 'X' },
    { v: [0, 1, 0], col: 0x3f6b4f, css: '#3f6b4f', txt: 'Y' },
    { v: [0, 0, 1], col: 0x3b5a7a, css: '#3b5a7a', txt: 'Z' },
  ];
  defs.forEach((d, k) => {
    const dir = new THREE.Vector3(...d.v);
    const L = pos[k], Ln = neg[k];
    const flecha = new THREE.ArrowHelper(dir, new THREE.Vector3(), L, d.col, 0.18, 0.08);
    ejes.add(desechable(flecha));
    const matTick = new THREE.MeshBasicMaterial({ color: d.col });

    // semieje negativo: solo si hay elementos de ese lado (línea tenue, sin punta)
    if (Ln > 0) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-Ln)]);
      const linea = new THREE.Line(g, new THREE.LineDashedMaterial({ color: d.col, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.7 }));
      linea.computeLineDistances();
      ejes.add(desechable(linea, { geo: true }));
    }

    const paso = pasoMarcas(Math.max(L, Ln));
    const off = d.txt === 'Y' ? new THREE.Vector3(0.2, 0, 0) : new THREE.Vector3(0, 0.12, 0);
    const marcas = [];
    for (let m = paso; m <= L - 0.25 + 1e-9; m += paso) marcas.push(m);
    for (let m = paso; m <= Ln - 0.1 + 1e-9; m += paso) marcas.push(-m);
    for (const m of marcas) {
      const tick = desechable(new THREE.Mesh(GEO.tick, matTick));
      tick.position.copy(dir).multiplyScalar(m);
      ejes.add(tick);
      ponerLabel(cm(m), tick.position.clone().add(off), { px: 10, chip: false, peso: 600, color: d.css }, ejes);
    }
    ponerLabel(`+${d.txt}`, dir.clone().multiplyScalar(L + 0.2), { px: 13, chip: false, peso: 800, color: d.css }, ejes);
  });

  // el piso acompaña a los ejes: cuadrícula de 1 m que cubre todo X-Z
  const lado = 2 * Math.ceil(Math.max(5, pos[0], pos[2], neg[0], neg[2]));
  if (grid.userData.lado !== lado) {
    const visible = grid.visible;
    gFondo.remove(grid);
    grid.geometry.dispose(); grid.material.dispose();
    grid = new THREE.GridHelper(lado, lado, 0xc9c1b5, 0xdfdacf);
    grid.userData.lado = lado;
    grid.visible = visible;
    gFondo.add(grid);
  }
}
/* posición de referencia de un elemento para marcarlo en la escena */
function posMarca(id) {
  const b = buscar(id);
  if (!b) return null;
  if (b.tipo === 'cuerda') {
    const t = b.el.tramos[0];
    if (!t || !buscarPos(t.a) || !buscarPos(t.b)) return null;
    return posFinTramo(b.el, t.a).add(posFinTramo(b.el, t.b)).multiplyScalar(0.5);
  }
  if (b.tipo === 'resorte') {
    const pa = posV3(b.el.a), pb = posV3(b.el.b);
    return pa && pb ? pa.add(pb).multiplyScalar(0.5) : null;
  }
  return new THREE.Vector3(...b.el.pos);
}
const buscarPos = id => id === 'LIBRE' || !!buscar(id);

const LIM_ARR = 1.5; // largo (m) del vector más grande de la escena

function drawScene() {
  sincronizarPoleasMoviles();
  construirEjes();
  labelSprites.length = 0;
  limpiar(gModelo);
  limpiar(gFuerzas);
  pickTargets = [];
  const conEtiquetas = $('#chkEtiquetas').checked;

  /* --- elementos --- */
  for (const c of S.cuerpos) {
    const grupo = new THREE.Group();
    const esfera = new THREE.Mesh(GEO.cuerpo, MAT.cuerpo);
    esfera.position.set(...c.pos);
    esfera.userData.elId = c.id;
    grupo.add(esfera);
    pickTargets.push(esfera);
    gModelo.add(grupo);
    if (conEtiquetas)
      ponerLabel(`${c.nombre} · ${f2(c.masa)} kg`, esfera.position.clone().add(new THREE.Vector3(0, 0.24, 0)));
    marcarSel(grupo);
  }

  for (const a of S.anclajes) {
    const grupo = new THREE.Group();
    const pin = new THREE.Mesh(GEO.pin, MAT.anclaje);
    pin.position.set(a.pos[0], a.pos[1] + 0.08, a.pos[2]);
    pin.userData.elId = a.id;
    const nodo = new THREE.Mesh(GEO.nodo, MAT.pincho);
    nodo.position.set(...a.pos);
    nodo.userData.elId = a.id;
    grupo.add(pin, nodo);
    pickTargets.push(pin, nodo);
    gModelo.add(grupo);
    if (conEtiquetas)
      ponerLabel(a.nombre, nodo.position.clone().add(new THREE.Vector3(0, 0.18, 0)), { px: 11 });
    marcarSel(grupo);
  }

  for (const p of S.poleas) {
    const grupo = new THREE.Group();
    const aro = new THREE.Mesh(GEO.aro, p.tipo === 'movil' ? MAT.poleaMovil : MAT.poleaFija);
    const centro = new THREE.Vector3(...p.pos);
    aro.position.copy(centro);
    aro.userData.elId = p.id;
    // orientar el aro: su plano contiene las direcciones de los tramos
    const dirs = [];
    const cuerda = S.cuerdas.find(c => c.id === p.cuerdaId);
    if (cuerda) for (const t of cuerda.tramos) {
      if (t.a === p.id || t.b === p.id) {
        const otro = posFinTramo(cuerda, t.a === p.id ? t.b : t.a);
        const d = new THREE.Vector3().subVectors(otro, centro);
        if (d.lengthSq() > 1e-6) dirs.push(d.normalize());
      }
    }
    let normal = dirs.length >= 2 ? new THREE.Vector3().crossVectors(dirs[0], dirs[1]) : new THREE.Vector3();
    if (normal.lengthSq() < 0.02) {
      // tramos paralelos: el aro queda vertical y de frente a la cámara
      normal.set(camera.position.x - centro.x, 0, camera.position.z - centro.z);
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
    }
    normal.normalize();
    let x = dirs[0] ? dirs[0].clone() : new THREE.Vector3(1, 0, 0);
    x.sub(normal.clone().multiplyScalar(x.dot(normal)));
    if (x.lengthSq() < 1e-6) x = new THREE.Vector3(0, 1, 0).cross(normal);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(normal, x);
    aro.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, normal));
    const eje = new THREE.Mesh(GEO.nodo, MAT.pincho);
    eje.position.copy(centro);
    eje.userData.elId = p.id;
    grupo.add(aro, eje);
    pickTargets.push(aro, eje);
    // la polea móvil cuelga del cuerpo con una horquilla
    if (p.tipo === 'movil') {
      const cu = S.cuerpos.find(c => c.id === p.unidoA);
      const h = cu && cilindroEntre(new THREE.Vector3(...cu.pos), centro, 0.01, MAT.pincho);
      if (h) grupo.add(h);
    }
    gModelo.add(grupo);
    const sub = p.tipo === 'movil' ? 'móvil' : 'fija';
    if (conEtiquetas)
      ponerLabel(`${p.nombre} · ${sub}`, centro.clone().add(new THREE.Vector3(0.28, 0.12, 0)), { px: 11 });
    marcarSel(grupo);
  }

  for (const cd of S.cuerdas) {
    const tipoT = cd.tension.tipo in MAT_CUERDA ? cd.tension.tipo : 'sin_definir';
    const mat = MAT_CUERDA[tipoT];
    for (const t of cd.tramos) {
      if (!buscarPos(t.a) || !buscarPos(t.b)) continue;
      const pa = posFinTramo(cd, t.a), pb = posFinTramo(cd, t.b);
      for (const seg of tramoConPatron(pa, pb, mat, PATRON[tipoT])) {
        seg.userData.elId = cd.id;
        pickTargets.push(seg);
        gModelo.add(seg);
      }
      if (t.b === 'LIBRE' || t.a === 'LIBRE') {
        const libre = t.b === 'LIBRE' ? pb : pa;
        const bola = new THREE.Mesh(GEO.esferaLibre, MAT.libre);
        bola.position.copy(libre);
        gModelo.add(bola);
        if (conEtiquetas)
          ponerLabel('extremo libre', libre.clone().add(new THREE.Vector3(0, -0.14, 0)), { px: 10, chip: false, color: '#6d655d', peso: 600 });
      }
    }
    const t0 = cd.tramos[0];
    if (conEtiquetas && t0 && buscarPos(t0.a) && buscarPos(t0.b)) {
      const pa = posFinTramo(cd, t0.a), pb = posFinTramo(cd, t0.b);
      const medio = pa.clone().add(pb).multiplyScalar(0.5);
      const corto = cd.nombre.replace(/^Cuerda\s+/, '');
      const txtT = cd.tension.tipo === 'conocida' ? `${corto} · T = ${f2(cd.tension.valor)} N`
        : cd.tension.tipo === 'desconocida' ? `${corto} · T desconocida` : `${corto} · T sin definir`;
      ponerLabel(txtT, medio.add(new THREE.Vector3(0.12, 0.14, 0)), { px: 11 });
    }
  }

  for (const rs of S.resortes) {
    const pa = posV3(rs.a), pb = posV3(rs.b);
    if (!pa || !pb) continue;
    const pts = resorteZigzag(pa, pb);
    if (!pts) continue;   // extremos coincidentes: se marca como aviso, sin geometría NaN
    const curva = new THREE.CatmullRomCurve3(pts);
    const tubo = new THREE.TubeGeometry(curva, pts.length * 3, 0.018, 7, false);
    const mat = new THREE.MeshBasicMaterial({ color: COL.resorte });
    const mesh = desechable(new THREE.Mesh(tubo, mat), { geo: true });
    mesh.userData.elId = rs.id;
    pickTargets.push(mesh);
    gModelo.add(mesh);
    if (conEtiquetas)
      ponerLabel(`${rs.nombre} · k ${f2(rs.k)} N/m`, pa.clone().add(pb).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.2, 0)), { px: 11 });
  }

  /* --- marcas de configuración inválida --- */
  for (const iss of RESULT.issues) {
    const p = posMarca(iss.elemento);
    if (!p) continue;
    ponerLabel(iss.nivel === 'error' ? 'revisar' : 'falta dato', p.add(new THREE.Vector3(0, -0.22, 0)),
      { px: 11, aviso: true, color: iss.nivel === 'error' ? '#a33b3b' : '#7a5410' });
  }

  /* --- vectores de fuerza --- */
  // con los resultados desactualizados no se dibuja ningún vector
  if (STALE) { $('#escalaVec').textContent = ' · vectores ocultos: falta verificar'; return; }

  const mostrar = {
    peso: $('#chkPeso').checked, tension: $('#chkTension').checked, elastica: $('#chkElastica').checked,
    resultante: $('#chkResultante').checked, componentes: $('#chkComponentes').checked,
  };
  // un único factor de escala común, calculado con TODAS las fuerzas (no cambia al ocultar)
  let maxMag = 0;
  for (const r of RESULT.resultados) {
    for (const f of r.fuerzas) maxMag = Math.max(maxMag, f.mag);
    if (r.completa) maxMag = Math.max(maxMag, r.SF);
  }
  const escala = maxMag > 0 ? LIM_ARR / maxMag : 0;

  const dibujar = (origen, vec, mag, color, texto, simbolo) => {
    const len = mag * escala;   // proporcional exacto
    if (!(len > 1e-4)) return;
    const dir = new THREE.Vector3(...vec).normalize();
    const flecha = desechable(new THREE.ArrowHelper(dir, origen, len, color, Math.min(len * 0.3, 0.16), Math.min(len * 0.22, 0.09)));
    gFuerzas.add(flecha);
    const punta = origen.clone().addScaledVector(dir, len + 0.1).add(new THREE.Vector3(0, 0.05, 0));
    ponerLabel(conEtiquetas ? texto : simbolo, punta, { px: conEtiquetas ? 11 : 12 }, gFuerzas);
  };

  for (const r of RESULT.resultados) {
    const origen = new THREE.Vector3(...r.cuerpo.pos);
    for (const f of r.fuerzas) {
      if (!mostrar[f.clase] || !(f.mag > Engine.EPS_NUM)) continue;
      const color = f.clase === 'peso' ? COL.peso : f.clase === 'elastica' ? COL.resorte : COL.tension;
      dibujar(origen, f.vec, f.mag, color, `${f.nombre} = ${f2(f.mag)} N`, f.simbolo);

      // componentes cartesianas del cuerpo mostrado en la tabla
      if (mostrar.componentes && r.cuerpo.id === TABLA_CUERPO) {
        ['x', 'y', 'z'].forEach((eje, k) => {
          const v = [0, 0, 0]; v[k] = f.vec[k];
          const m = Math.abs(f.vec[k]);
          if (m * escala < 0.02) return;
          const len = m * escala;
          const d = new THREE.Vector3(...v).normalize();
          const fl = desechable(new THREE.ArrowHelper(d, origen, len, color, Math.min(len * 0.25, 0.08), 0.04));
          fl.line.material.transparent = true; fl.line.material.opacity = 0.45;
          fl.cone.material.transparent = true; fl.cone.material.opacity = 0.45;
          gFuerzas.add(fl);
          if (conEtiquetas)
            ponerLabel(`${f.simbolo}${eje} = ${sgn(f.vec[k])} N`, origen.clone().addScaledVector(d, len * 0.6).add(new THREE.Vector3(0.05, -0.08, 0.05)),
              { px: 9, chip: false, peso: 600, color: '#6d655d' }, gFuerzas);
        });
      }
    }
    // resultante solo cuando es completa: sin veredicto no hay ΣF que dibujar
    if (mostrar.resultante && r.completa && r.SF * escala > 1e-4) {
      const dir = new THREE.Vector3(...r.R).normalize();
      const len = r.SF * escala;
      gFuerzas.add(desechable(flechaGruesa(origen, dir, len, COL.resultante)));
      const punta = origen.clone().addScaledVector(dir, len + 0.12);
      ponerLabel(conEtiquetas ? `ΣF = ${f2(r.SF)} N` : 'ΣF', punta, { px: 12, color: '#8c2727' }, gFuerzas);
    }
  }

  // resaltado de cuerdas y resortes seleccionados
  const selB = S_SEL ? buscar(S_SEL) : null;
  if (selB && (selB.tipo === 'cuerda' || selB.tipo === 'resorte')) {
    const extremos = selB.tipo === 'cuerda'
      ? selB.el.tramos.filter(t => buscarPos(t.a) && buscarPos(t.b)).flatMap(t => [posFinTramo(selB.el, t.a), posFinTramo(selB.el, t.b)])
      : [posV3(selB.el.a), posV3(selB.el.b)].filter(Boolean);
    const caja = new THREE.Box3();
    for (const p of extremos) if (p) caja.expandByPoint(p);
    if (!caja.isEmpty()) {
      caja.expandByScalar(0.1);
      const helper = desechable(new THREE.Box3Helper(caja, 0x27221e), { geo: true });
      helper.material.depthTest = false;
      helper.renderOrder = 15;
      gModelo.add(helper);
    }
  }

  $('#escalaVec').textContent = escala > 0 ? ` · escala de vectores: 1 m = ${f2(1 / escala)} N` : '';
}

function marcarSel(grupo) {
  // resalta con una caja de líneas el elemento seleccionado dentro del grupo
  if (!S_SEL || !grupo.children.some(ch => ch.userData.elId === S_SEL)) return;
  const b = buscar(S_SEL);
  if (!b || !Array.isArray(b.el.pos)) return;   // cuerdas y resortes se resaltan aparte
  const pos = new THREE.Vector3(...b.el.pos);
  const radio = b.tipo === 'cuerpo' ? 0.2 : b.tipo === 'polea' ? 0.16 : b.tipo === 'anclaje' ? 0.12 : 0.14;
  const centro = b.tipo === 'anclaje' ? pos.clone().add(new THREE.Vector3(0, 0.08, 0)) : pos;
  const caja = new THREE.Box3().setFromCenterAndSize(centro, new THREE.Vector3(radio * 2, radio * 2, radio * 2));
  const helper = desechable(new THREE.Box3Helper(caja, 0x27221e), { geo: true });
  helper.material.depthTest = false;
  helper.renderOrder = 15;
  grupo.add(helper);
}

/* -------- redimensionado -------- */
function acomodar() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(acomodar).observe(stage);
acomodar();

/* ================= interacción con la escena ================= */
const rayo = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let dragInfo = null;          // {id, moved, sx, sy, vertical}
let downPt = null;            // dónde empezó el clic (para distinguir clic de órbita)
const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let vistaModo = 'orbitar';
const LIM_XZ = 5.5, LIM_Y = [-2, 8];

function coordsDe(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  rayo.setFromCamera(ndc, camera);
}

function golpear(e) {
  coordsDe(e);
  const hits = rayo.intersectObjects(pickTargets, false);
  return hits.length ? { id: hits[0].object.userData.elId } : null;
}

function puntoEnPlano(alturaY) {
  plano.normal.set(0, 1, 0);
  plano.constant = -alturaY;
  const p = new THREE.Vector3();
  return rayo.ray.intersectPlane(plano, p) ? p : null;
}
// plano vertical que pasa por el punto y mira hacia la cámara (arrastre con Mayús)
function puntoEnVertical(punto) {
  const n = new THREE.Vector3(camera.position.x - punto.x, 0, camera.position.z - punto.z);
  if (n.lengthSq() < 1e-6) return null;
  plano.setFromNormalAndCoplanarPoint(n.normalize(), punto);
  const p = new THREE.Vector3();
  return rayo.ray.intersectPlane(plano, p) ? p : null;
}

const esArrastrable = b => b && (b.tipo === 'cuerpo' || b.tipo === 'anclaje' || (b.tipo === 'polea' && b.el.tipo === 'fija'));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = v => Math.round(v * 1000) / 1000;

// fase de captura en el contenedor: se ejecuta antes que OrbitControls,
// así un arrastre sobre un elemento no hace girar la cámara a la vez
stage.addEventListener('pointerdown', e => {
  if (e.target !== canvas) return;
  downPt = { x: e.clientX, y: e.clientY };
  if (e.button !== 0 || flujo) return;
  const hit = golpear(e);
  if (!hit) return;
  const b = buscar(hit.id);
  if (!esArrastrable(b)) return;
  dragInfo = { id: hit.id, moved: false, sx: e.clientX, sy: e.clientY, vertical: e.shiftKey };
  controls.enabled = false;
}, true);

canvas.addEventListener('pointermove', e => {
  if (dragInfo) {
    if (!dragInfo.moved && Math.hypot(e.clientX - dragInfo.sx, e.clientY - dragInfo.sy) < 4) return;
    dragInfo.moved = true;
    const b = buscar(dragInfo.id);
    if (!b) { dragInfo = null; controls.enabled = true; return; }
    canvas.classList.add('dragging');
    coordsDe(e);
    const actual = new THREE.Vector3(...b.el.pos);
    if (dragInfo.vertical || e.shiftKey) {
      const p = puntoEnVertical(actual);
      if (p) b.el.pos[1] = r3(clamp(p.y, LIM_Y[0], LIM_Y[1]));
    } else {
      const p = puntoEnPlano(b.el.pos[1]);
      if (p) {
        b.el.pos[0] = r3(clamp(p.x, -LIM_XZ, LIM_XZ));
        b.el.pos[2] = r3(clamp(p.z, -LIM_XZ, LIM_XZ));
      }
    }
    cambio();
    return;
  }
  // cursor de mano sobre elementos
  const hit = flujo ? null : golpear(e);
  canvas.style.cursor = flujo ? 'crosshair' : hit ? 'pointer' : (vistaModo === 'desplazar' ? 'move' : 'grab');
});

function finArrastre() {
  controls.enabled = true;
  canvas.classList.remove('dragging');
  dragInfo = null;
}

canvas.addEventListener('pointerup', e => {
  const fueClic = downPt && Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) < 5;
  downPt = null;
  if (dragInfo) {
    const { id, moved } = dragInfo;
    finArrastre();
    if (!moved) seleccionar(id);
    return;
  }
  if (e.button !== 0 || !fueClic) return;   // fue una órbita o un desplazamiento de la vista
  const hit = golpear(e);
  if (flujo) {
    if (flujo.tipo === 'cuerda' || flujo.tipo === 'resorte') {
      if (hit) elegirConFlujo(hit.id);
      else if (flujo.paso === 0) toast('Elige un cuerpo o un anclaje como extremo.');
    } else manejarClicFlujo(e);
  } else if (hit) {
    seleccionar(hit.id);
  }
});
canvas.addEventListener('pointercancel', () => { if (dragInfo) finArrastre(); downPt = null; });

canvas.addEventListener('dblclick', () => encuadrar());

/* -------- encuadre y zoom -------- */
function encuadrar() {
  camera.position.copy(HOME.pos);
  controls.target.copy(HOME.target);
  controls.update();
}
function dolly(factor) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const d = Math.max(controls.minDistance, Math.min(controls.maxDistance, dir.length() * factor));
  camera.position.copy(controls.target).addScaledVector(dir.normalize(), d);
}
function orbitarTeclado(dAz, dPol) {
  const off = new THREE.Vector3().subVectors(camera.position, controls.target);
  const sph = new THREE.Spherical().setFromVector3(off);
  sph.theta += dAz;
  sph.phi = clamp(sph.phi + dPol, 0.08, Math.PI - 0.08);
  off.setFromSpherical(sph);
  camera.position.copy(controls.target).add(off);
}
function refrescarZoom() {
  const d = camera.position.distanceTo(controls.target);
  const pct = HOME_DIST / d * 100;
  $('#zoomPct').textContent = isFinite(pct) ? `${Math.round(pct)} %` : '100 %';
}

/* ================= flujos de construcción ================= */
let flujo = null; // {tipo, paso, primero, cuerdaId, cuerpoId, y}

const AVISOS = {
  cuerpo: ['Haz clic en el piso para colocar el cuerpo (quedará a 1 m de altura) o pulsa Enter para dejarlo en el origen.'],
  anclaje: ['Haz clic donde quieras el punto de conexión (queda en el piso; luego ajusta su altura) o pulsa Enter.'],
  cuerda: ['Elige el primer punto de la cuerda: un cuerpo o un anclaje (en la escena o en la lista «Editar»).', 'Ahora elige el segundo punto (distinto del primero).'],
  resorte: ['Elige el primer punto del resorte: un cuerpo o un anclaje (en la escena o en la lista «Editar»).', 'Ahora elige el segundo punto (distinto del primero).'],
  'polea-fija': ['Haz clic para colocar la polea (quedará a 2,2 m de altura; luego la arrastras) o pulsa Enter.'],
};

function iniciarFlujo(tipo, ctx = {}) {
  cancelarFlujo(true);
  flujo = { tipo, paso: 0, primero: null, ...ctx };
  pintarFlujoActivo();
  toast(AVISOS[tipo]?.[0] ?? '', 3400);
  renderNota();
}
function cancelarFlujo(silencioso = false) {
  flujo = null;
  pintarFlujoActivo();
  renderNota();
  if (!silencioso) toast('Acción cancelada.');
}
function pintarFlujoActivo() {
  document.querySelectorAll('.add-btn').forEach(b => b.classList.toggle('active', !!flujo && flujo.tipo === b.dataset.add));
}

function elegirConFlujo(id) {
  if (!flujo) { seleccionar(id); return; }
  if (flujo.tipo === 'cuerda' || flujo.tipo === 'resorte') {
    const b = buscar(id);
    if (b && b.tipo === 'polea') { toast('Las poleas se conectan desde su catálogo, no con cuerdas sueltas.'); return; }
    if (!b || (b.tipo !== 'cuerpo' && b.tipo !== 'anclaje')) { toast('Elige un cuerpo o un anclaje como extremo.'); return; }
    if (flujo.paso === 0) {
      flujo.primero = id;
      flujo.paso = 1;
      toast(AVISOS[flujo.tipo][1], 3200);
      renderNota();
      return;
    }
    // paso 2
    if (id === flujo.primero) { toast('Los dos extremos no pueden ser el mismo punto.'); return; }
    const p1 = buscar(flujo.primero), p2 = b;
    const pieza = flujo.tipo === 'cuerda' ? 'Una cuerda' : 'Un resorte';
    if (p1.tipo === 'anclaje' && p2.tipo === 'anclaje') { toast(`${pieza} no puede ir de anclaje a anclaje: al menos un extremo debe ser un cuerpo.`); return; }
    const d = Math.hypot(p1.el.pos[0] - p2.el.pos[0], p1.el.pos[1] - p2.el.pos[1], p1.el.pos[2] - p2.el.pos[2]);
    if (d < 0.05) { toast('Los puntos están demasiado cerca (menos de 5 cm): sepáralos para poder tender la pieza.'); return; }
    if (flujo.tipo === 'cuerda') {
      if (!dentroLimite('cuerda')) { cancelarFlujo(true); return; }
      const cd = crearCuerda(flujo.primero, id);
      seleccionar(cd.id);
      toast(`${cd.nombre} creada. Asígnale su tensión en Propiedades.`);
    } else {
      if (!dentroLimite('resorte')) { cancelarFlujo(true); return; }
      const rs = crearResorte(flujo.primero, id);
      seleccionar(rs.id);
      toast(`${rs.nombre} creado. Ajusta k y L₀ en Propiedades si hace falta.`);
    }
    cancelarFlujo(true);
    recalc();
  }
}

function manejarClicFlujo(e) {
  coordsDe(e);
  if (!flujo) return;
  const p = puntoEnPlano(0);
  if (!p) return;
  colocarFlujo(r3(clamp(p.x, -LIM_XZ, LIM_XZ)), r3(clamp(p.z, -LIM_XZ, LIM_XZ)));
}
// con el teclado: Enter coloca el elemento en su posición por defecto
function colocarPorDefecto() {
  if (!flujo) return;
  if (flujo.tipo === 'polea-fija') {
    const cd = S.cuerdas.find(c => c.id === flujo.cuerdaId);
    const ps = cd ? [cd.tramos[0].a, cd.tramos[0].b].map(id => buscar(id)?.el.pos).filter(Boolean) : [];
    const x = ps.length ? ps.reduce((a, q) => a + q[0], 0) / ps.length : 0;
    const z = ps.length ? ps.reduce((a, q) => a + q[2], 0) / ps.length : 0;
    colocarFlujo(r3(x), r3(z));
  } else colocarFlujo(0, 0, true);
}

function colocarFlujo(x, z, porDefecto = false) {
  const tipo = flujo.tipo;
  if (tipo === 'cuerpo' || tipo === 'anclaje') {
    const pos = tipo === 'cuerpo' ? [x, porDefecto ? 0 : 1.0, z] : [x, 0.0, z];
    if (!dentroLimite(tipo)) { cancelarFlujo(true); return; }
    const el = tipo === 'cuerpo' ? crearCuerpo(pos) : crearAnclaje(pos);
    cancelarFlujo(true);
    seleccionar(el.id);
    toast(`${el.nombre} creado. Arrástralo en la escena o ajusta sus datos a la derecha.`);
    recalc();
    return;
  }

  if (tipo === 'polea-fija') {
    const el = crearPoleaFija(flujo.cuerdaId, [x, 2.2, z]);
    const nombre = el?.nombre;
    cancelarFlujo(true);
    if (el) {
      seleccionar(el.id);
      toast(`${nombre} colocada: la cuerda queda en dos tramos con la misma tensión.`);
      recalc();
    }
  }
}

/* ================= panel de propiedades ================= */
const propsDin = $('#propsDinamico');

function campoHTML({ etiqueta, unidad, valor, clave, dueño, disabled = false, paso = null }) {
  return `
    <div class="field">
      <label for="pf_${dueño}_${clave}">${esc(etiqueta)}</label>
      <input id="pf_${dueño}_${clave}" type="text" value="${esc(valor)}" inputmode="decimal" data-cl="${clave}" data-dueño="${dueño}" ${disabled ? 'disabled' : ''} ${paso ? `data-paso="${paso}"` : ''}>
      <span class="unit">${unidad}</span>
      <small class="field-msg" hidden></small>
    </div>`;
}

function bloquesCoord(dueñoId, pos) {
  return ['x', 'y', 'z'].map((eje, i) => campoHTML({
    etiqueta: `Posición ${eje}`, unidad: 'm', valor: fIn(pos[i]),
    clave: `coord${i}`, dueño: dueñoId, paso: 'coord',
  })).join('');
}

function notaHTML(txt) { return `<p class="meto">${esc(txt)}</p>`; }

function renderProps() {
  const b = S_SEL ? buscar(S_SEL) : null;
  const propEntity = $('#propEntity');

  if (!b) {
    propEntity.textContent = 'nada seleccionado';
    propsDin.innerHTML = `
      <div class="tip-box">
        <p><strong>Sin selección</strong></p>
        <p>Haz clic sobre un elemento de la escena (o en la lista «Editar») para ver y cambiar sus datos aquí.</p>
        <p class="meto">Los datos de todo el sistema (gravedad) están más abajo y siempre están a la mano.</p>
      </div>`;
    return;
  }

  const { tipo, el } = b;
  propEntity.textContent = el.nombre;

  if (tipo === 'cuerpo') {
    const conecta = [];
    for (const c of S.cuerdas) for (const t of c.tramos) if ((t.a === el.id || t.b === el.id) && t.a !== t.b)
      conecta.push({ id: c.id, txt: `${c.nombre} — ${TextoTension(c)}` });
    for (const r of S.resortes) if (r.a === el.id || r.b === el.id)
      conecta.push({ id: r.id, txt: `${r.nombre} — k ${f2(r.k)} N/m` });
    for (const p of S.poleas) if (p.unidoA === el.id)
      conecta.push({ id: p.id, txt: `${p.nombre} — polea móvil unida` });

    propsDin.innerHTML = `
      <div class="section-label">Datos del cuerpo</div>
      ${campoHTML({ etiqueta: 'Masa del cuerpo', unidad: 'kg', valor: fIn(el.masa), clave: 'masa', dueño: el.id })}
      <div class="box-calculated">
        <div class="section-label tight">Esto lo calcula el simulador</div>
        <div class="calc-row"><span>Peso P = m · g</span><output>${f2(el.masa * S.g)} N</output></div>
      </div>
      ${bloquesCoord(el.id, el.pos)}
      ${conecta.length ? `
        <div class="conn-head"><span>Conectado a este cuerpo</span><em>${conecta.length} pieza${conecta.length > 1 ? 's' : ''}</em></div>
        ${conecta.map(c => `<button class="conn-item" data-goto="${c.id}">${esc(c.txt)}</button>`).join('')}` : ''}
      ${notaHTML('Arrastrar el cuerpo en la escena también cambia estas coordenadas (con Mayús, la altura).')}`;
  }

  if (tipo === 'anclaje') {
    const conecta = [];
    for (const c of S.cuerdas) for (const t of c.tramos) if (t.a === el.id || t.b === el.id)
      conecta.push({ id: c.id, txt: `${c.nombre} (cuerda)` });
    for (const r of S.resortes) if (r.a === el.id || r.b === el.id)
      conecta.push({ id: r.id, txt: `${r.nombre} (resorte)` });
    propsDin.innerHTML = `
      <div class="section-label">Punto de conexión</div>
      ${bloquesCoord(el.id, el.pos)}
      ${conecta.length ? `
        <div class="conn-head"><span>Amarrado aquí</span><em>${conecta.length} pieza${conecta.length > 1 ? 's' : ''}</em></div>
        ${conecta.map(c => `<button class="conn-item" data-goto="${c.id}">${esc(c.txt)}</button>`).join('')}` : ''}
      ${notaHTML('Un anclaje es un punto fijo: no se le calculan fuerzas, solo sirve de sujeción.')}`;
  }

  if (tipo === 'cuerda') {
    const tramosTxt = el.tramos
      .map(t => nombreLado(t.a) + ' → ' + nombreLado(t.b))
      .join(' &nbsp;·&nbsp; ');
    const polea = S.poleas.find(p => p.cuerdaId === el.id);
    propsDin.innerHTML = `
      <div class="section-label">Tramo(s) de la cuerda</div>
      <p class="meto tramos">${tramosTxt}</p>
      ${polea ? notaHTML(`Pasa por ${polea.nombre} (${polea.tipo === 'movil' ? 'móvil, dos tramos' : 'fija, redirige la cuerda'}): la tensión es la misma en todos los tramos.`) : ''}
      <div class="section-label">Tensión de la cuerda</div>
      <div class="tseg" role="radiogroup" aria-label="Estado de la tensión">
        <label><input type="radio" name="tseg" value="sin_definir" ${el.tension.tipo === 'sin_definir' ? 'checked' : ''}> Sin definir</label>
        <label><input type="radio" name="tseg" value="conocida" ${el.tension.tipo === 'conocida' ? 'checked' : ''}> Valor conocido</label>
        <label><input type="radio" name="tseg" value="desconocida" ${el.tension.tipo === 'desconocida' ? 'checked' : ''}> Incógnita</label>
      </div>
      ${campoHTML({ etiqueta: 'Tensión conocida (T)', unidad: 'N', valor: fIn(el.tension.valor), clave: 'T', dueño: el.id, disabled: el.tension.tipo !== 'conocida' })}
      ${el.tension.tipo === 'sin_definir' ? notaHTML('Aún sin dato: mientras no definas la tensión, los cuerpos de esta cuerda quedan sin evaluar.') : ''}
      ${el.tension.tipo === 'desconocida' ? `<p class="meto incog">Marcada como <strong>incógnita</strong>: la suma queda parcial y no se emite veredicto, porque el simulador no la resuelve solo.</p>` : ''}
      ${boxCalcCuerda(el)}`;
  }

  if (tipo === 'resorte') {
    const pa = posV3(el.a), pb = posV3(el.b);
    let L = 0;
    if (pa && pb) L = pa.distanceTo(pb);
    const dL = L - el.L0;
    const estado = Math.abs(dL) < Engine.EPS_GEO ? 'en su longitud natural' : (dL > 0 ? 'estirado' : 'comprimido');
    propsDin.innerHTML = `
      <div class="section-label">Datos del resorte</div>
      ${campoHTML({ etiqueta: 'Constante del resorte (k)', unidad: 'N/m', valor: fIn(el.k), clave: 'k', dueño: el.id })}
      ${campoHTML({ etiqueta: 'Longitud natural (L₀)', unidad: 'm', valor: fIn(el.L0), clave: 'L0', dueño: el.id })}
      ${notaHTML('El extremo «a» va en ' + nombreLado(el.a) + ' y el «b» en ' + nombreLado(el.b) + '. El largo actual lo fija la geometría de la escena.')}
      ${boxCalcResorte(el.k, L, dL, estado)}`;
  }

  if (tipo === 'polea') {
    const cuerda = S.cuerdas.find(c => c.id === el.cuerdaId);
    const cuerpo = el.unidoA ? S.cuerpos.find(c => c.id === el.unidoA) : null;
    propsDin.innerHTML = `
      <div class="section-label">Polea ideal</div>
      ${el.tipo === 'movil'
        ? `<div class="box-calculated"><div class="calc-row"><span>Posición (sigue al cuerpo)</span><output>(${f3(el.pos[0])}; ${f3(el.pos[1])}; ${f3(el.pos[2])}) m</output></div></div>`
        : bloquesCoord(el.id, el.pos)}
      ${notaHTML(el.tipo === 'movil'
        ? `Configuración: <strong>móvil con dos tramos</strong>. Va unida al cuerpo ${cuerpo ? cuerpo.nombre : '—'} y lo sostiene la cuerda ${cuerda ? cuerda.nombre : '—'}; la fuerza sobre el cuerpo suma las tensiones de los dos tramos.`
        : `Configuración: <strong>fija simple</strong>. Redirige ${cuerda ? 'la ' + cuerda.nombre : 'una cuerda'}: la tensión es igual en los dos tramos.`)}
      ${cuerda ? `<button class="conn-item" data-goto="${cuerda.id}">${cuerda.nombre} — ver tensión</button>` : ''}
      ${cuerpo ? `<button class="conn-item" data-goto="${cuerpo.id}">${cuerpo.nombre} — cuerpo que carga</button>` : ''}
      ${notaHTML('Las configuraciones fuera de este catálogo no están admitidas.')}`;
  }

  /* --- conectar los campos --- */
  propsDin.querySelectorAll('input[data-cl]').forEach(inp => {
    const dueño = buscar(inp.dataset.dueño);
    inp.addEventListener('change', () => confirmarCampo(inp, dueño));
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); });
  });
  propsDin.querySelectorAll('input[name="tseg"]').forEach(rad => {
    rad.addEventListener('change', () => {
      const b2 = S_SEL ? buscar(S_SEL) : null;
      if (!b2 || b2.tipo !== 'cuerda') return;
      b2.el.tension.tipo = rad.value;
      recalc();
      if (rad.value === 'conocida') setTimeout(() => $(`#pf_${b2.el.id}_T`)?.focus(), 0);
    });
  });
  propsDin.querySelectorAll('[data-goto]').forEach(bt => {
    bt.addEventListener('click', () => seleccionar(bt.dataset.goto));
  });
}

function TextoTension(cuerda) {
  return cuerda.tension.tipo === 'conocida' ? `T ${f2(cuerda.tension.valor)} N`
    : cuerda.tension.tipo === 'desconocida' ? 'T incógnita' : 'T sin definir';
}
function nombreLado(id) {
  if (id === 'LIBRE') return 'extremo libre';
  const b = buscar(id);
  return b ? b.el.nombre : id;
}

function boxCalcCuerda(cuerda) {
  return `
    <div class="box-calculated">
      <div class="section-label tight">Esto lo calcula el simulador</div>
      <div class="calc-row"><span>Estado de la tensión</span><output>${esc(TextoTension(cuerda))}</output></div>
      <div class="calc-row"><span>Tramos de la cuerda</span><output>${cuerda.tramos.length}</output></div>
    </div>`;
}
function boxCalcResorte(k, L, dL, estado) {
  return `
    <div class="box-calculated">
      <div class="section-label tight">Esto lo calcula el simulador</div>
      <div class="calc-row"><span>Largo actual L</span><output>${f3(L)} m</output></div>
      <div class="calc-row"><span>Deformación (L − L₀)</span><output>${f3(dL)} m</output></div>
      <div class="calc-row"><span>|F| = k · |L − L₀|</span><output>${f2(Math.abs(k * dL))} N</output></div>
      <div class="calc-row"><span>Estado de deformación</span><output>${esc(estado)}</output></div>
    </div>`;
}

function confirmarCampo(inp, b) {
  const msg = inp.closest('.field').querySelector('.field-msg');
  const clave = inp.dataset.cl;
  const base = clave.startsWith('coord') ? 'coord' : clave;
  const res = Engine.validar(base, inp.value);

  if (!res.ok) {
    msg.textContent = res.mensaje;
    msg.hidden = false;
    inp.closest('.field').classList.add('has-error');
    // conservar el valor anterior, ya formateado
    if (b) {
      const el = b.el;
      if (clave === 'masa') inp.value = fIn(el.masa);
      else if (clave === 'T') inp.value = fIn(el.tension.valor);
      else if (clave === 'k') inp.value = fIn(el.k);
      else if (clave === 'L0') inp.value = fIn(el.L0);
      else if (clave.startsWith('coord')) inp.value = fIn(el.pos[+clave.slice(5)]);
    }
    return;
  }
  msg.hidden = true;
  inp.closest('.field').classList.remove('has-error');
  inp.value = fIn(res.valor);

  if (b) {
    const el = b.el;
    if (clave === 'masa') el.masa = res.valor;
    else if (clave === 'T') el.tension.valor = res.valor;
    else if (clave === 'k') el.k = res.valor;
    else if (clave === 'L0') el.L0 = res.valor;
    else if (clave.startsWith('coord')) el.pos[+clave.slice(5)] = res.valor;
  }
  cambio();
}

/* ================= lista «Editar» y tabla ================= */
function renderListas() {
  const sel = $('#selEditar');
  const actual = S_SEL || '';
  const grupos = [
    ['Cuerpos', S.cuerpos], ['Anclajes', S.anclajes], ['Cuerdas', S.cuerdas],
    ['Resortes', S.resortes], ['Poleas', S.poleas],
  ];
  sel.innerHTML = `<option value="">Seleccionar…</option>` + grupos
    .filter(([, l]) => l.length)
    .map(([t, l]) => `<optgroup label="${t}">${l.map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</optgroup>`)
    .join('');
  sel.value = buscar(actual) ? actual : '';

  const selTab = $('#selCuerpoTabla');
  if (!S.cuerpos.some(c => c.id === TABLA_CUERPO)) TABLA_CUERPO = S.cuerpos[0]?.id ?? null;
  selTab.innerHTML = S.cuerpos.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')
    || '<option value="">—</option>';
  selTab.value = TABLA_CUERPO || '';
  selTab.disabled = S.cuerpos.length === 0;
}

const claseCat = c => c.replace(/\s+/g, '-');
let DEV = null;   // {cuerpoId, clave} de la fuerza cuyo desarrollo está abierto

function renderTabla() {
  const tb = $('#tbFuerzas');
  if (!TABLA_CUERPO || !S.cuerpos.some(c => c.id === TABLA_CUERPO)) TABLA_CUERPO = S.cuerpos[0]?.id ?? null;
  $('.results').classList.toggle('stale', STALE);

  const r = RESULT.resultados.find(x => x.cuerpo.id === TABLA_CUERPO);
  if (!r) {
    $('#forcesCount').textContent = 'Todavía no hay cuerpos en la escena.';
    tb.innerHTML = `<tr><td colspan="7" class="vacia">Aún no hay fuerzas que mostrar: coloca un cuerpo con «Cuerpo / partícula».</td></tr>`;
    for (const id of ['#resMag', '#resX', '#resY', '#resZ']) $(id).textContent = '0,00';
    $('#resCateg').textContent = ''; $('#resLabel').textContent = 'Suma de todas ΣF';
    $('#devPanel').hidden = true; DEV = null;
    return;
  }

  const filas = r.fuerzas.map((f, i) => {
    const extra = f.clase === 'elastica' && f.extra ? `<em class="deform"> (${f.extra.estado}, ΔL = ${f3(f.extra.dL)} m)</em>` : '';
    const hacia = f.extra?.hacia ? ` <span class="origin">hacia ${esc(f.extra.hacia)}</span>` : '';
    return `<tr class="row-force" data-i="${i}" tabindex="0" aria-label="Ver el desarrollo de ${esc(f.nombre)}">
      <td>${esc(f.nombre)}${extra}</td>
      <td><span class="cat ${claseCat(f.categoria)}">${f.categoria}</span></td>
      <td>${esc(f.origen)}${hacia}</td>
      <td class="num">${f2(f.mag)}</td>
      <td class="num">${sgn(f.vec[0])}</td>
      <td class="num">${sgn(f.vec[1])}</td>
      <td class="num">${sgn(f.vec[2])}</td>
    </tr>`;
  });
  // magnitudes sin valor: se listan, pero no tienen número ni entran en la suma
  const pend = (r.pendientes || []).map(p => `<tr class="row-pend">
      <td>${esc(p.nombre)}</td>
      <td><span class="cat ${claseCat(p.categoria)}">${p.categoria}</span></td>
      <td>${esc(p.origen)}</td>
      <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
    </tr>`);
  tb.innerHTML = filas.concat(pend).join('');

  const nP = (r.pendientes || []).length;
  $('#forcesCount').textContent = `${r.fuerzas.length} fuerza${r.fuerzas.length !== 1 ? 's' : ''}`
    + (nP ? ` + ${nP} sin valor` : '') + ' · componentes en el sistema global (X, Y, Z)';

  const parcial = !r.completa;
  $('#resLabel').textContent = parcial ? 'Suma parcial (excluye tensiones sin valor)' : 'Resultante ΣF';
  $('#resCateg').innerHTML = parcial ? '<span class="cat desconocida">parcial</span>' : '<span class="cat calculada">calculada</span>';
  $('#resMag').textContent = f2(r.SF);
  $('#resX').textContent = sgn(r.R[0]);
  $('#resY').textContent = sgn(r.R[1]);
  $('#resZ').textContent = sgn(r.R[2]);
  $('#rowResultante').classList.toggle('parcial', parcial);

  tb.querySelectorAll('.row-force').forEach(tr => {
    const abrir = () => mostrarDesarrollo(r, +tr.dataset.i);
    tr.addEventListener('click', abrir);
    tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } });
  });

  // el desarrollo abierto se actualiza con los valores vigentes o se cierra
  if (DEV) {
    const i = DEV.cuerpoId === r.cuerpo.id ? r.fuerzas.findIndex(f => `${f.elemento}|${f.nombre}` === DEV.clave) : -1;
    if (i >= 0) mostrarDesarrollo(r, i); else { $('#devPanel').hidden = true; DEV = null; }
  }
}

function mostrarDesarrollo(r, i) {
  const f = r.fuerzas[i];
  if (!f) return;
  DEV = { cuerpoId: r.cuerpo.id, clave: `${f.elemento}|${f.nombre}` };
  $('#devTitle').textContent = `Desarrollo · ${f.nombre} sobre ${r.cuerpo.nombre}`;
  const extra = [];
  if (f.extra?.hacia) extra.push(`<span>Dirigida hacia ${esc(f.extra.hacia)}: la cuerda solo jala, nunca empuja.</span>`);
  if (f.extra?.estado) extra.push(`<span>El resorte está ${esc(f.extra.estado)}: L = ${f3(f.extra.L)} m y L − L₀ = ${f3(f.extra.dL)} m.</span>`);
  const veredicto = r.completa
    ? `Con todos los aportes: |ΣF| = ${f2(r.SF)} N; tolerancia τ = ${f2(Engine.TOL)} N → ${r.estado}.`
    : 'La suma del cuerpo es parcial: hay tensiones sin valor, así que no hay veredicto.';
  $('#devBody').innerHTML = `
    <span>${esc(f.origen)} · categoría ${esc(f.categoria)}</span>
    <code>${esc(f.formula)}</code>
    <code class="strong">${esc(f.vectorTxt)} · |${esc(f.simbolo || 'F')}| = ${f2(f.mag)} N</code>
    ${extra.join('')}
    <span>${esc(veredicto)}</span>`;
  $('#devPanel').hidden = false;
}

/* ================= avisos de la configuración ================= */
function renderIssues() {
  const card = $('#issuesCard');
  const lista = RESULT.issues;
  card.hidden = lista.length === 0;
  if (!lista.length) return;
  const nE = lista.filter(i => i.nivel === 'error').length;
  $('#issuesCount').textContent = `${nE} error${nE !== 1 ? 'es' : ''} · ${lista.length - nE} aviso${lista.length - nE !== 1 ? 's' : ''}`;
  $('#issuesList').innerHTML = lista.map(i => `
    <li class="${i.nivel}">
      <span class="lvl">${i.nivel === 'error' ? 'Error' : 'Aviso'}</span>${esc(i.mensaje)}
      ${buscar(i.elemento) ? `<button data-goto="${esc(i.elemento)}">ver</button>` : ''}
      ${i.accion ? `<span class="fix">Qué hacer: ${esc(i.accion)}</span>` : ''}
    </li>`).join('');
  $('#issuesList').querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => seleccionar(b.dataset.goto)));
}

/* ================= tarjetas de estado ================= */
function renderStatus() {
  const card = $('#statusCard');
  const r = RESULT.resultados.find(x => x.cuerpo.id === TABLA_CUERPO);
  if (!r) {
    card.className = 'status-card nd';
    $('#statusTitle').innerHTML = ico('nd') + 'Aún sin cuerpos';
    $('#statusValue').textContent = '— N';
    $('#statusValue').classList.add('muted-val');
    $('#statusDetail').innerHTML = 'La verificación corre cuerpo por cuerpo: coloca el primero para empezar.';
    return;
  }
  $('#statusValue').classList.remove('muted-val');
  if (STALE) {
    card.className = 'status-card nd stale';
    $('#statusTitle').innerHTML = ico('pendiente') + 'Pendiente de verificar';
    $('#statusValue').textContent = '— N';
    $('#statusValue').classList.add('muted-val');
    $('#statusDetail').innerHTML = 'Cambiaste datos con la actualización en vivo apagada. Pulsa «Verificar equilibrio» para ver los resultados vigentes.';
    return;
  }
  if (r.estado === 'En equilibrio') {
    card.className = 'status-card ok';
    $('#statusTitle').innerHTML = ico('ok') + 'En equilibrio';
    $('#statusValue').textContent = `${f2(r.SF)} N`;
    $('#statusDetail').innerHTML =
      `ΣFx = ${sgn(r.R[0])} N · ΣFy = ${sgn(r.R[1])} N · ΣFz = ${sgn(r.R[2])} N<br>Se cumple |ΣF| ≤ τ = ${f2(Engine.TOL)} N.`;
  } else if (r.estado === 'No está en equilibrio') {
    card.className = 'status-card bad';
    $('#statusTitle').innerHTML = ico('mal') + 'No está en equilibrio';
    $('#statusValue').textContent = `${f2(r.SF)} N`;
    $('#statusDetail').innerHTML =
      `|ΣF| supera τ = ${f2(Engine.TOL)} N.<br>ΣFx = ${sgn(r.R[0])} N · ΣFy = ${sgn(r.R[1])} N · ΣFz = ${sgn(r.R[2])} N<br>Mira la tabla y ajusta datos o geometría.`;
  } else {
    card.className = 'status-card nd';
    $('#statusTitle').innerHTML = ico('nd') + 'No determinado';
    $('#statusValue').textContent = `${f2(r.SF)} N (parcial)`;
    $('#statusDetail').innerHTML = r.causas.slice(0, 2).map(esc).join('<br>') + (r.causas.length > 2 ? '<br>… y más avisos.' : '');
  }
}

let cardTagFijo = 'Ahora mismo';
function renderCards() {
  const g = RESULT.resumen.global;
  const card = $('#stateCard');
  let clase = 'ok', icono = 'ok', titulo = '', texto = '';
  const nC = S.cuerpos.length;

  if (STALE && nC) {
    clase = 'nd'; icono = 'pendiente'; titulo = 'Pendiente de verificar';
    texto = 'Hay cambios sin calcular. Pulsa «Verificar equilibrio» o activa la actualización en vivo.';
  } else if (g === 'En equilibrio') {
    clase = 'ok'; icono = 'ok'; titulo = 'En equilibrio';
    texto = nC === 1 ? 'El cuerpo compensa todas sus fuerzas: la suma |ΣF| no pasa de 0,01 N.'
      : `Los ${nC} cuerpos compensan sus fuerzas: ninguna |ΣF| pasa de 0,01 N.`;
  } else if (g === 'No está en equilibrio') {
    clase = 'bad'; icono = 'mal'; titulo = 'No está en equilibrio';
    texto = `Hay fuerzas sin compensar en: ${RESULT.resumen.fuera.join(', ')}. Ajusta datos o geometría y vuelve a verificar.`;
  } else if (g === 'No determinado') {
    clase = 'nd'; icono = 'nd'; titulo = 'No determinado';
    const primera = RESULT.resultados.flatMap(r => r.causas)[0];
    texto = `Faltan datos para decidir (${cuentaCausas()} aviso${cuentaCausas() !== 1 ? 's' : ''}).${primera ? ' Pista: ' + primera : ''}`;
  } else {
    clase = 'unsolvable'; icono = 'nd'; titulo = 'Aún no hay cuerpos';
    texto = 'Coloca tu primer cuerpo con «Cuerpo / partícula» y sostenlo con cuerdas o resortes.';
  }
  card.className = `state-card ${clase}`;
  $('#stateIcon').innerHTML = ico(icono);
  $('#stateHeading').textContent = titulo;
  $('#stateText').textContent = texto;
  $('#stateTag').textContent = cardTagFijo;
}
function cuentaCausas() {
  return RESULT.resultados.reduce((n, r) => n + r.causas.length, 0);
}

/* ================= notas y meta ================= */
function renderNota() {
  const nota = $('#canvasNote');
  if (flujo) {
    const t = flujo.tipo === 'cuerda' || flujo.tipo === 'resorte' ? AVISOS[flujo.tipo][flujo.paso] : AVISOS[flujo.tipo][0];
    nota.innerHTML = `<strong>${esc(CancelarTexto())}</strong><br>${esc(t)}`;
    return;
  }
  const n = [contar('cuerpo'), contar('cuerda'), contar('resorte'), contar('polea')];
  nota.innerHTML = `${n[0]} cuerpo${n[0] !== 1 ? 's' : ''} · ${n[1]} cuerda${n[1] !== 1 ? 's' : ''} · ${n[2]} resorte${n[2] !== 1 ? 's' : ''} · ${n[3]} polea${n[3] !== 1 ? 's' : ''}<br>Tolerancia de equilibrio: ${f2(Engine.TOL)} N`;
}
function CancelarTexto() {
  return { cuerpo: 'Colocando cuerpo', anclaje: 'Colocando punto de conexión', cuerda: 'Nueva cuerda', resorte: 'Nuevo resorte', 'polea-fija': 'Colocando polea' }[flujo?.tipo] || '';
}

function renderMeta() {
  $('#resultsMeta').textContent = STALE
    ? 'Resultados desactualizados — pulsa «Verificar equilibrio»'
    : `Valores al día · fuerzas con 2 decimales, longitudes con 3 · τ = ${f2(Engine.TOL)} N`;
}

function renderSelInfo() {
  const nombre = $('#selNombre'), notaEl = $('#selNota');
  const b = S_SEL ? buscar(S_SEL) : null;
  if (!b) {
    nombre.textContent = 'Nada seleccionado todavía';
    notaEl.textContent = 'Haz clic sobre un elemento de la escena para verlo aquí.';
    return;
  }
  nombre.textContent = `Tienes seleccionado: ${b.el.nombre}`;
  const notas = {
    cuerpo: b => `Partícula de ${f2(b.el.masa)} kg: arrástrala en la escena o edita sus datos a la derecha.`,
    anclaje: () => 'Punto fijo de sujeción: muévelo con arrastre o con sus coordenadas.',
    cuerda: b => `Estado de tensión: ${TextoTension(b.el).toLowerCase()}. Revísalo en Propiedades.`,
    resorte: b => `Constante k = ${f2(b.el.k)} N/m y longitud natural L₀ = ${f2(b.el.L0)} m.`,
    polea: b => b.el.tipo === 'movil' ? 'Polea móvil: la fuerza sobre el cuerpo suma los dos tramos (2T si van paralelos).' : 'Polea fija: cambia la dirección de la cuerda sin alterar la tensión.',
  };
  notaEl.textContent = notas[b.tipo](b);
}

/* ================= render general ================= */
function renderUI() {
  renderListas();
  renderProps();
  renderTabla();
  renderStatus();
  renderCards();
  renderNota();
  renderSelInfo();
  renderMeta();
  renderIssues();
}

/* ================= acciones ================= */
function verificar() {
  recalc();
  cardTagFijo = 'Verificado ahora';
  renderCards();
  const g = RESULT.resumen.global;
  const msg = {
    'En equilibrio': 'Verificado: todos los cuerpos están en equilibrio.',
    'No está en equilibrio': 'Verificado: hay cuerpos fuera de equilibrio, mira el detalle.',
    'No determinado': 'Verificado: faltan datos o hay incógnitas sin definir.',
    'Sin cuerpos': 'Aún no hay cuerpos: primero coloca uno.',
  }[g];
  toast(msg, 3000);
}

function confirmarEliminacion() {
  const b = S_SEL ? buscar(S_SEL) : null;
  if (!b) { toast('Primero selecciona el elemento que quieres quitar.'); return; }
  const deps = dependenciasDe(b.el.id);
  if (!deps.length) {
    const nombres = eliminarEnCadena(S_SEL);
    toast(nombres.length === 1 ? `${nombres[0]} eliminado.` : `Se retiró ${b.el.nombre} y lo que dependía de él.`);
    recalc();
    return;
  }
  const dlg = $('#dlgConfirmar');
  $('#confTitulo').textContent = `¿Eliminar ${b.el.nombre}?`;
  $('#confTexto').textContent = `${b.el.nombre} tiene piezas conectadas. Si lo quitas, también se retiran:`;
  $('#confLista').innerHTML = deps.map(d => `<li>${esc(d.texto)}</li>`).join('');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const nombres = eliminarEnCadena(b.el.id);
    toast(nombres.length === 1 ? `${nombres[0]} eliminado.` : `Se eliminó ${b.el.nombre} junto con ${nombres.length - 1} pieza${nombres.length - 1 !== 1 ? 's' : ''} conectada${nombres.length - 1 !== 1 ? 's' : ''}.`);
    recalc();
  }, { once: true });
}

/* -------- catálogo de poleas -------- */
function abrirDlgPolea() {
  const dlg = $('#dlgPolea');
  const selCd = $('#selCuerdaPolea'), selCp = $('#selCuerpoPolea');
  const cuerdasLibres = S.cuerdas.filter(c => !S.poleas.some(p => p.cuerdaId === c.id) && c.tramos.length === 1);
  selCd.innerHTML = cuerdasLibres.map(c => `<option value="${c.id}">${esc(c.nombre)} (${TextoTension(c)})</option>`).join('');
  $('#poleaFijaHint').textContent = cuerdasLibres.length
    ? 'Colocarás la polea con un clic en la escena; al final la podrás arrastrar.'
    : 'No hay cuerdas libres: crea primero una cuerda y vuelve a intentarlo.';
  $('#btnPoleaOK').disabled = false;
  selCp.innerHTML = S.cuerpos.map(c => `<option value="${c.id}">${esc(c.nombre)} · ${f2(c.masa)} kg</option>`).join('');
  dlg.returnValue = '';
  dlg.showModal();
}

function confirmarPolea() {
  const dlg = $('#dlgPolea');
  if (dlg.returnValue !== 'ok') return;
  const tipoRadio = dlg.querySelector('input[name="plTipo"]:checked')?.value || 'fija';

  if (tipoRadio === 'fija') {
    const idC = $('#selCuerdaPolea').value;
    if (!idC) { toast('No hay cuerdas libres para redirigir: crea una cuerda primero.'); return; }
    iniciarFlujo('polea-fija', { cuerdaId: idC });
  } else {
    const idCp = $('#selCuerpoPolea').value;
    if (!idCp) { toast('No hay cuerpos: crea uno antes de usar una polea móvil.'); return; }
    const el = crearPoleaMovil(idCp);
    if (!el) { recalc(); return; }
    seleccionar(el.id);
    toast(`${el.nombre} móvil unida: la cuerda de dos tramos queda sin tensión, asígnala en Propiedades.`);
    recalc();
  }
}

/* -------- ejemplos de sistemas ( Restablecer recarga el elegido ) -------- */
// Cada ejemplo arranca en equilibrio: las tensiones y longitudes en reposo se
// calculan con la geometría y g, así |ΣF| queda por debajo de τ.
const EJEMPLOS = [
  {
    nombre: 'Sistema 01', desc: 'Cuerpo A con resorte y cuerda',
    construir() {
      const cu = crearCuerpo([0, 1, 0]);
      cu.nombre = 'Cuerpo A'; cu.masa = 2.0;
      const an = crearAnclaje([-1.0, 1.0, 0]);
      an.nombre = 'Anclaje fijo';
      const rs = crearResorte(cu.id, an.id);
      rs.nombre = 'Resorte R1'; rs.k = 100; rs.L0 = 0.90;
      const cd = crearCuerda(cu.id, 'LIBRE');
      cd.nombre = 'Cuerda C1';
      const pl = crearPoleaFija(cd.id, [0.849, 2.666, 0]);
      pl.nombre = 'Polea P1';
      cd.tension = { tipo: 'conocida', valor: 22.021 };
      return cu;
    },
  },
  {
    nombre: 'Sistema 02', desc: 'Cuerpo colgado de tres cuerdas en 3D',
    construir() {
      const cu = crearCuerpo([0, 1.0, 0]);
      cu.nombre = 'Lámpara'; cu.masa = 3.0;
      // tres anclajes en el techo, repartidos cada 120° alrededor del cuerpo
      const r = 1.0, h = 1.5;
      const senTheta = h / Math.hypot(r, h);
      const T = cu.masa * S.g / (3 * senTheta);
      [0, 120, 240].forEach((ang, i) => {
        const a = THREE.MathUtils.degToRad(ang);
        const an = crearAnclaje([+(r * Math.cos(a)).toFixed(6), cu.pos[1] + h, +(r * Math.sin(a)).toFixed(6)]);
        an.nombre = `Techo ${i + 1}`;
        const cd = crearCuerda(cu.id, an.id);
        cd.nombre = `Cuerda C${i + 1}`;
        cd.tension = { tipo: 'conocida', valor: T };
      });
      return cu;
    },
  },
  {
    nombre: 'Sistema 03', desc: 'Dos cuerpos colgados de resortes en serie',
    construir() {
      const techo = crearAnclaje([0, 3.0, 0]);
      techo.nombre = 'Techo';
      const a = crearCuerpo([0, 2.0, 0]);
      a.nombre = 'Cuerpo A'; a.masa = 1.0;
      const b = crearCuerpo([0, 1.0, 0]);
      b.nombre = 'Cuerpo B'; b.masa = 2.0;
      // R1 sostiene a los dos cuerpos y R2 solo a B: L₀ = L − m·g / k
      const r1 = crearResorte(a.id, techo.id);
      r1.nombre = 'Resorte R1'; r1.k = 150; r1.L0 = 1.0 - (a.masa + b.masa) * S.g / r1.k;
      const r2 = crearResorte(b.id, a.id);
      r2.nombre = 'Resorte R2'; r2.k = 100; r2.L0 = 1.0 - b.masa * S.g / r2.k;
      return b;
    },
  },
  {
    nombre: 'Sistema 04', desc: 'Carga sostenida por una polea móvil',
    construir() {
      const cu = crearCuerpo([0, 1.0, 0]);
      cu.nombre = 'Carga'; cu.masa = 4.0;
      const pl = crearPoleaMovil(cu.id);
      pl.nombre = 'Polea P1';
      // los dos tramos suben en vertical: 2T = m·g
      const cd = S.cuerdas.find(c => c.id === pl.cuerdaId);
      cd.nombre = 'Cuerda C1';
      cd.tension = { tipo: 'conocida', valor: cu.masa * S.g / 2 };
      return cu;
    },
  },
];
let EJEMPLO_ACTUAL = 0;

function construirEjemplo(i = EJEMPLO_ACTUAL) {
  EJEMPLO_ACTUAL = i;
  S.cuerpos = []; S.anclajes = []; S.cuerdas = []; S.resortes = []; S.poleas = [];
  S.cont = { cuerpo: 0, anclaje: 0, cuerda: 0, resorte: 0, polea: 0, soporte: 0 };
  uidN = 0;
  S.g = Engine.G_DEF;
  reiniciarCampoG();
  DEV = null; $('#devPanel').hidden = true;

  const ej = EJEMPLOS[i];
  const principal = ej.construir();

  S.nombre = ej.nombre;
  $('#sysName').textContent = S.nombre;
  $('#sysDesc').textContent = ej.desc;
  $('#selEjemplo').value = String(i);
  TABLA_CUERPO = principal.id;
  S_SEL = principal.id;
  cardTagFijo = 'Ahora mismo';
}

function vaciarSistema() {
  S.cuerpos = []; S.anclajes = []; S.cuerdas = []; S.resortes = []; S.poleas = [];
  S.cont = { cuerpo: 0, anclaje: 0, cuerda: 0, resorte: 0, polea: 0, soporte: 0 };
  uidN = 0;
  S.g = Engine.G_DEF;            // g vuelve a 9,81 m/s²
  reiniciarCampoG();
  DEV = null; $('#devPanel').hidden = true;
  S_SEL = null; TABLA_CUERPO = null;
  $('#selEjemplo').value = '';
  $('#sysName').textContent = 'Sistema nuevo';
  $('#sysDesc').textContent = 'empieza colocando tus primeros cuerpos';
  cardTagFijo = 'Ahora mismo';
}

/* ================= enlaces de la interfaz ================= */
document.querySelectorAll('.add-btn').forEach(b => {
  b.addEventListener('click', () => {
    if (flujo && flujo.tipo === b.dataset.add) { cancelarFlujo(); return; }
    if (b.dataset.add === 'polea') { abrirDlgPolea(); return; }
    iniciarFlujo(b.dataset.add);
  });
});
document.querySelectorAll('.action-btn').forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.action === 'conectar') {
      if (flujo && (flujo.tipo === 'cuerda')) { cancelarFlujo(); return; }
      iniciarFlujo('cuerda');
    } else confirmarEliminacion();
  });
});

$('#selEditar').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) return;
  // durante una cuerda o un resorte, la lista sirve para elegir extremos con el teclado
  if (flujo && (flujo.tipo === 'cuerda' || flujo.tipo === 'resorte')) { elegirConFlujo(id); renderListas(); }
  else seleccionar(id);
});
$('#selCuerpoTabla').addEventListener('change', e => { TABLA_CUERPO = e.target.value || null; renderTabla(); renderStatus(); drawScene(); });

$('#chkPeso').addEventListener('change', drawScene);
$('#chkTension').addEventListener('change', drawScene);
$('#chkElastica').addEventListener('change', drawScene);
$('#chkResultante').addEventListener('change', drawScene);
$('#chkComponentes').addEventListener('change', drawScene);
$('#chkEtiquetas').addEventListener('change', drawScene);
$('#chkCuadricula').addEventListener('change', e => { grid.visible = ejes.visible = e.target.checked; });

$('#chkAuto').addEventListener('change', () => { renderMeta(); if ($('#chkAuto').checked) recalc(); });
$('#btnAplicar').addEventListener('click', verificar);

$('#btnOrbitar').addEventListener('click', () => fijarVista('orbitar'));
$('#btnDesplazar').addEventListener('click', () => fijarVista('desplazar'));
function fijarVista(modo) {
  vistaModo = modo;
  controls.mouseButtons.LEFT = modo === 'desplazar' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  $('#btnOrbitar').classList.toggle('active', modo === 'orbitar');
  $('#btnDesplazar').classList.toggle('active', modo === 'desplazar');
  canvas.style.cursor = modo === 'desplazar' ? 'move' : 'grab';
}
$('#zoomIn').addEventListener('click', () => dolly(0.85));
$('#zoomOut').addEventListener('click', () => dolly(1.18));
$('#btnEncuadrar').addEventListener('click', encuadrar);

$('#devClose').addEventListener('click', () => { $('#devPanel').hidden = true; });
$('#btnAyuda').addEventListener('click', () => $('#dlgAyuda').showModal());
$('#btnCerrarAyuda').addEventListener('click', () => $('#dlgAyuda').close());
document.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', () => $(`#${b.dataset.cerrar}`).close()));
$('#dlgPolea').addEventListener('close', confirmarPolea);
$('#dlgPolea').addEventListener('change', e => {
  if (e.target.name === 'plTipo') {
    $('#poleaPickFija').hidden = e.target.value !== 'fija';
    $('#poleaPickMovil').hidden = e.target.value !== 'movil';
  }
});

$('#btnNuevo').addEventListener('click', () => {
  if (contar('cuerpo') || contar('anclaje')) {
    const dlg = $('#dlgConfirmar');
    $('#confTitulo').textContent = '¿Empezar un sistema nuevo?';
    $('#confTexto').textContent = 'La escena se vaciará por completo para que construyas desde cero.';
    $('#confLista').innerHTML = '';
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return;
      vaciarSistema(); recalc(); toast('Escena limpia: coloca tu primer cuerpo.');
    }, { once: true });
  } else { vaciarSistema(); recalc(); toast('Escena limpia: coloca tu primer cuerpo.'); }
});
$('#btnReset').addEventListener('click', () => { construirEjemplo(); recalc(); toast('Ejemplo del sistema restablecido.'); });

/* selector de ejemplos */
$('#selEjemplo').innerHTML = '<option value="" disabled>Cargar un ejemplo…</option>' +
  EJEMPLOS.map((e, i) => `<option value="${i}">${esc(e.desc)}</option>`).join('');
$('#selEjemplo').addEventListener('change', e => {
  const i = +e.target.value;
  if (!EJEMPLOS[i]) return;
  construirEjemplo(i); recalc(); encuadrar();
  toast(`Ejemplo cargado: ${EJEMPLOS[i].desc}.`);
});

/* gravedad (campo global) */
const inGravedad = $('#inGravedad');
function reiniciarCampoG() {
  inGravedad.value = fIn(S.g);
  inGravedad.closest('.field').classList.remove('has-error');
  inGravedad.closest('.field').querySelector('.field-msg').hidden = true;
}
inGravedad.addEventListener('change', () => {
  const msg = inGravedad.closest('.field').querySelector('.field-msg');
  const res = Engine.validar('g', inGravedad.value);
  if (!res.ok) {
    msg.textContent = res.mensaje; msg.hidden = false;
    inGravedad.closest('.field').classList.add('has-error');
    inGravedad.value = fIn(S.g);
    return;
  }
  msg.hidden = true;
  inGravedad.closest('.field').classList.remove('has-error');
  inGravedad.value = fIn(res.valor);
  S.g = res.valor;
  cambio();
});
inGravedad.addEventListener('keydown', e => { if (e.key === 'Enter') inGravedad.blur(); });

/* teclado */
window.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;
  const tag = document.activeElement?.tagName;
  if (e.key === 'Escape' && flujo) { cancelarFlujo(); return; }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enBoton = tag === 'BUTTON' || document.activeElement?.classList.contains('row-force');
  if (e.key === 'Enter' && flujo && !enBoton && flujo.tipo !== 'cuerda' && flujo.tipo !== 'resorte') { e.preventDefault(); colocarPorDefecto(); }
  else if ((e.key === 'Delete' || e.key === 'Supr') && S_SEL) { confirmarEliminacion(); }
  else if ((e.key === 'c' || e.key === 'C') && !flujo) { iniciarFlujo('cuerda'); }
  // cámara con el teclado
  else if (e.key === 'ArrowLeft') { e.preventDefault(); orbitarTeclado(-0.12, 0); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); orbitarTeclado(0.12, 0); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); orbitarTeclado(0, -0.1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); orbitarTeclado(0, 0.1); }
  else if (e.key === '+' || e.key === '=') dolly(0.85);
  else if (e.key === '-' || e.key === '_') dolly(1.18);
  else if (e.key === '0') encuadrar();
});

/* ================= arranque ================= */
/* rótulos de los ejes (parte del fondo, no se redibujan) */
construirEjes();

construirEjemplo();
recalc();
renderNota();

/* ================= bucle de animación ================= */
const reloj = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  refrescarZoom();

  // etiquetas con tamaño de pantalla constante
  const h = canvas.clientHeight || 1;
  for (const spr of labelSprites.concat(labelsFijos)) {
    const d = camera.position.distanceTo(spr.position);
    const wpp = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / h;
    const alturaMundo = spr.userData.px * wpp;
    const img = spr.material.map.image;
    if (img) spr.scale.set(alturaMundo * (img.width / img.height), alturaMundo, 1);
  }
  renderer.render(scene, camera);
}
animate();

/* puente para pruebas automatizadas */
window.__sim = {
  S, get RESULT(){ return RESULT; }, recalc, drawScene, seleccionar, buscar,
  flujos: { iniciar: iniciarFlujo, cancelar: cancelarFlujo, estado: () => flujo },
  crear: { cuerpo: crearCuerpo, anclaje: crearAnclaje, cuerda: crearCuerda, resorte: crearResorte, poleaFija: crearPoleaFija, poleaMovil: crearPoleaMovil },
  eliminarEnCadena, verificar: () => { verificar(); return RESULT; },
  get STALE() { return STALE; }, camera, controls, gFuerzas, gModelo, labelsFijos,
};

})();
