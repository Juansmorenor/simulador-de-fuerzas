'use strict';

/* ============================================================
   engine.js — Motor de cálculo del simulador de equilibrio

   Convenciones:
   · Sistema Internacional fijo: N · kg · m · m/s²
   · Coordenadas dextrógiras, eje Y hacia arriba, gravedad en −Y
   · Equilibrio traslacional de partículas: ΣF = 0

   Independencia: este archivo no usa el DOM ni la
   biblioteca gráfica. Funciona como script clásico en el
   navegador (window.Engine) y como módulo CommonJS en Node
   (require('./engine.js')) para las pruebas automatizadas.

   Cubre: peso, tensiones, ley de Hooke, poleas, componentes,
   resultante, equilibrio por cuerpo y global, categorías de las
   fuerzas, validación de datos, configuraciones inválidas
   (mensajes con causa, elemento y acción) y los datos para la
   tabla y el desarrollo del cálculo.

   Alcance:
   · Las incógnitas no se resuelven: toda tensión desconocida
     deja «No determinado» a los cuerpos afectados.
   · La cuerda se modela siempre tensa; la holgura no se simula.
   ============================================================ */

const Engine = (() => {

  /* ---------------- parámetros (propuestas provisionales) ---------------- */
  const TOL = 0.01;          // τ: tolerancia pedagógica, N
  const EPS_NUM = 1e-9;      // ε_num: residuo de punto flotante, N
  const EPS_GEO = 1e-6;      // ε_geo: extremos coincidentes, m
  const MAX_VAL = 1e6;       // rango máximo de entrada
  const G_DEF = 9.81;        // g por defecto, m/s²
  const MAXES = { cuerpos: 10, cuerdas: 30, resortes: 15, poleas: 5 };
  const CATALOGO_POLEAS = ['fija', 'movil'];
  const RESOLVER_INCOGNITAS = false;                                      // las incógnitas no se resuelven

  /* ---------------- vectores ---------------- */
  const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vLen = a => Math.hypot(a[0], a[1], a[2]);
  const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vUnit = a => {
    const l = vLen(a);
    return l < EPS_GEO ? null : [a[0] / l, a[1] / l, a[2] / l];
  };
  // limpia residuos por debajo de ε_num y ceros negativos
  const limpio = v => v.map(x => (Math.abs(x) < EPS_NUM ? 0 : x));

  /* ---------------- formato para mostrar ----------------
     Redondea solo al mostrar; nunca devuelve «−0», NaN ni infinito.
     Usa coma decimal y el signo menos tipográfico (−).               */
  function fmt(n, d = 2) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    const p = Math.pow(10, d);
    let r = Math.round(Math.abs(n) * p) / p;
    const neg = n < 0 && r !== 0;
    return (neg ? '−' : '') + r.toFixed(d).replace('.', ',');
  }
  // formato para campos editables: sin perder decimales significativos
  function fmtInput(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    let s = (Math.round(n * 1e6) / 1e6).toString();
    if (/e/i.test(s)) s = n.toPrecision(7);
    if (s === '-0') s = '0';
    return s.replace('.', ',');
  }

  /* ---------------- validación ---------------- */
  const CAMPO = {
    masa: 'la masa', g: 'la gravedad g', k: 'la constante k del resorte',
    L0: 'la longitud natural L₀', T: 'la tensión T', coord: 'la coordenada',
  };
  const NUM_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

  function validar(field, raw) {
    const nombre = CAMPO[field] || 'el valor';
    const Nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    const s = String(raw ?? '').trim().replace(/−/g, '-');
    if (s === '')
      return { ok: false, mensaje: `Falta ${nombre}: escribe un número. Se conserva el valor anterior.` };
    if (s.length > 40 || !NUM_RE.test(s))
      return { ok: false, mensaje: `${Nombre} debe ser un número (usa coma o punto para los decimales). Se conserva el valor anterior.` };
    const v = Number(s.replace(',', '.'));
    if (!isFinite(v))
      return { ok: false, mensaje: `${Nombre} debe ser un número finito. Se conserva el valor anterior.` };
    switch (field) {
      case 'masa': case 'g': case 'k': case 'L0':
        if (!(v > 0))
          return { ok: false, mensaje: `${Nombre} debe ser mayor que 0; escribe un valor positivo. Se conserva el valor anterior.` };
        if (v > MAX_VAL)
          return { ok: false, mensaje: `${Nombre} no puede superar ${fmt(MAX_VAL, 0)} en su unidad. Se conserva el valor anterior.` };
        break;
      case 'T':
        if (v < 0)
          return { ok: false, mensaje: 'La tensión no puede ser negativa: una cuerda solo jala, nunca empuja. Escribe 0 o un valor positivo.' };
        if (v > MAX_VAL)
          return { ok: false, mensaje: `La tensión no puede superar ${fmt(MAX_VAL, 0)} N. Se conserva el valor anterior.` };
        break;
      case 'coord':
        if (Math.abs(v) > MAX_VAL)
          return { ok: false, mensaje: `La coordenada debe estar entre −${fmt(MAX_VAL, 0)} y ${fmt(MAX_VAL, 0)} m. Se conserva el valor anterior.` };
        break;
    }
    return { ok: true, valor: v === 0 ? 0 : v };
  }

  /* ============================================================
     Fenómenos físicos: cada uno es una unidad con sus
     propias pruebas que añade fuerzas a un cuerpo.
     ============================================================ */

  /* Peso: P = m·g, vertical hacia −Y */
  function fuerzaPeso(cuerpo, g) {
    const P = cuerpo.masa * g;
    return {
      clase: 'peso', simbolo: 'P', nombre: 'Peso P', categoria: 'calculada', origen: 'm · g',
      elemento: cuerpo.id, vec: limpio([0, -P, 0]), mag: P,
      formula: `P = m · g = ${fmt(cuerpo.masa)} kg × ${fmt(g)} m/s² = ${fmt(P)} N`,
      vectorTxt: `P = (0,00; ${fmt(-P)}; 0,00) N`,
    };
  }

  /* Tensión de una cuerda sobre un cuerpo */
  function fuerzaTension(cd, desde, hacia, nombreHacia) {
    const u = vUnit(vSub(hacia, desde));
    if (!u) return null;
    const T = cd.tension.valor;
    const vec = limpio(vScale(u, T));
    const etiqueta = cd.nombre.replace(/^Cuerda\s+/, '');
    return {
      clase: 'tension', simbolo: 'T', nombre: `Tensión ${etiqueta}`, categoria: 'conocida',
      origen: 'Dato ingresado', elemento: cd.id, vec, mag: T,
      formula: `T = |T| · û = ${fmt(T)} N × (${fmt(u[0], 3)}; ${fmt(u[1], 3)}; ${fmt(u[2], 3)})`,
      vectorTxt: `T = (${fmt(vec[0])}; ${fmt(vec[1])}; ${fmt(vec[2])}) N`,
      extra: { hacia: nombreHacia, u },
    };
  }

  /* Ley de Hooke: F = k (L − L₀) û, û del cuerpo al otro extremo */
  function fuerzaResorte(rs, desde, hacia) {
    const d = vSub(hacia, desde);
    const L = vLen(d);
    const u = vUnit(d);
    if (!u) return null;
    const dL = L - rs.L0;
    const F = rs.k * dL;
    const vec = limpio(vScale(u, F));
    const estado = Math.abs(dL) < EPS_GEO ? 'en su longitud natural' : (dL > 0 ? 'estirado' : 'comprimido');
    return {
      clase: 'elastica', simbolo: 'Fe', nombre: `Elástica ${rs.nombre.replace(/^Resorte\s+/, '')}`, categoria: 'calculada',
      origen: 'k · (L − L₀)', elemento: rs.id, vec, mag: Math.abs(F),
      formula: `F = k · (L − L₀) · û = ${fmt(rs.k)} N/m × (${fmt(L, 3)} − ${fmt(rs.L0, 3)}) m × (${fmt(u[0], 3)}; ${fmt(u[1], 3)}; ${fmt(u[2], 3)})`,
      vectorTxt: `F = (${fmt(vec[0])}; ${fmt(vec[1])}; ${fmt(vec[2])}) N`,
      extra: { L, dL, estado, u },
    };
  }

  /* Polea móvil: misma T en cada tramo, suma vectorial con la geometría real */
  function fuerzaPoleaMovil(pl, cd, tramosDestino) {
    const T = cd.tension.valor;
    let acum = [0, 0, 0];
    const partes = [];
    for (const destino of tramosDestino) {
      const u = vUnit(vSub(destino, pl.pos));
      if (!u) return null;
      acum = vAdd(acum, vScale(u, T));
      partes.push(`(${fmt(u[0], 3)}; ${fmt(u[1], 3)}; ${fmt(u[2], 3)})`);
    }
    const vec = limpio(acum);
    const mag = vLen(vec);
    return {
      clase: 'tension', simbolo: 'T', nombre: `${cd.nombre} vía ${pl.nombre}`, categoria: 'calculada',
      origen: `${tramosDestino.length} tramos × T (polea móvil)`, elemento: pl.id, vec, mag,
      formula: `F = T · Σû = ${fmt(T)} N × [${partes.join(' + ')}]`,
      vectorTxt: `F = (${fmt(vec[0])}; ${fmt(vec[1])}; ${fmt(vec[2])}) N`,
    };
  }

  /* ---------------- verificación de poleas ---------------- */
  function revisarPolea(pl, sist, tipoDe) {
    if (!CATALOGO_POLEAS.includes(pl.tipo))
      return 'su configuración no está en el catálogo del simulador (fija simple o móvil con dos tramos)';
    const cd = sist.cuerdas.find(c => c.id === pl.cuerdaId);
    if (!cd) return 'no tiene una cuerda continua asociada';
    const tr = cd.tramos || [];
    if (tr.length < 2) return 'la cuerda no pasa por la polea';
    for (let i = 0; i < tr.length - 1; i++)
      if (tr[i].b !== tr[i + 1].a) return `la cuerda ${cd.nombre} no es continua`;
    const interiores = tr.slice(1).map(t => t.a);
    if (interiores.some(id => tipoDe(id) !== 'polea'))
      return `la cuerda ${cd.nombre} está interrumpida por un cuerpo o anclaje intermedio`;
    if (!interiores.includes(pl.id)) return `la cuerda ${cd.nombre} no pasa por esta polea`;
    if (pl.tipo === 'movil') {
      if (tr.length !== 2) return 'una polea móvil debe tener exactamente dos tramos';
      if (!sist.cuerpos.some(c => c.id === pl.unidoA)) return 'la polea móvil no está unida a ningún cuerpo';
    }
    return null;
  }

  /* ============================================================
     calcular(sist)
     sist: {
       g,
       cuerpos:  [{id, nombre, masa, pos}],
       anclajes: [{id, nombre, pos}],
       poleas:   [{id, nombre, pos, tipo:'fija'|'movil', cuerdaId, unidoA?}],
       cuerdas:  [{id, nombre, tramos:[{a,b}], tension:{tipo, valor}}],
       resortes: [{id, nombre, a, b, k, L0}],
     }
     Los extremos de tramo son ids de cuerpos, anclajes, poleas o
     «LIBRE» (extremo del que se tira con la tensión conocida).
     ============================================================ */
  function calcular(sist) {
    const poleas = sist.poleas || [];
    const issues = [];
    const vistos = new Set();
    const nota = (nivel, elemento, mensaje, accion) => {
      const clave = `${nivel}|${elemento}|${mensaje}`;
      if (vistos.has(clave)) return;
      vistos.add(clave);
      issues.push({ nivel, elemento, mensaje, accion });
    };

    const tipoDe = id => {
      if (sist.cuerpos.some(c => c.id === id)) return 'cuerpo';
      if (sist.anclajes.some(a => a.id === id)) return 'anclaje';
      if (poleas.some(p => p.id === id)) return 'polea';
      if (id === 'LIBRE') return 'libre';
      return null;
    };
    const elDe = id => sist.cuerpos.find(c => c.id === id) || sist.anclajes.find(a => a.id === id) || poleas.find(p => p.id === id) || null;
    const posOf = id => elDe(id)?.pos || null;
    const nombreDe = id => (id === 'LIBRE' ? 'extremo libre' : elDe(id)?.nombre || 'un extremo sin asignar');

    /* ---- 1. Revisión de conexiones y poleas ---- */
    const cuerdaNoAdmitida = new Map();  // id cuerda → motivo
    for (const pl of poleas) {
      const motivo = revisarPolea(pl, sist, tipoDe);
      if (motivo) {
        nota('error', pl.id, `${pl.nombre}: configuración no admitida, ${motivo}. No se aplica T₁ = T₂.`,
          'Elimina la polea y vuelve a crearla desde el catálogo.');
        if (pl.cuerdaId) cuerdaNoAdmitida.set(pl.cuerdaId, `${pl.nombre} ${motivo}`);
      }
    }
    for (const cd of sist.cuerdas) {
      for (const t of cd.tramos || []) {
        if (!tipoDe(t.a) || !tipoDe(t.b)) {
          nota('error', cd.id, `${cd.nombre} tiene un extremo sin asignar.`, 'Elimínala y vuelve a crearla eligiendo sus dos extremos.');
          continue;
        }
        const pa = t.a === 'LIBRE' ? null : posOf(t.a), pb = t.b === 'LIBRE' ? null : posOf(t.b);
        if (pa && pb && vLen(vSub(pa, pb)) < EPS_GEO)
          nota('error', cd.id, `${cd.nombre} une dos puntos coincidentes (distancia cero): no hay dirección para la tensión.`,
            `Mueve ${nombreDe(t.a)} o ${nombreDe(t.b)} para separarlos.`);
      }
      if (cd.tension.tipo === 'sin_definir')
        nota('aviso', cd.id, `${cd.nombre} no tiene tensión definida.`, 'En Propiedades, escribe su valor conocido o márcala como incógnita.');
      else if (cd.tension.tipo === 'conocida' && !(cd.tension.valor >= 0 && isFinite(cd.tension.valor)))
        nota('error', cd.id, `${cd.nombre} tiene una tensión inválida.`, 'Escribe una tensión mayor o igual que 0 N.');
    }
    for (const rs of sist.resortes) {
      const pa = posOf(rs.a), pb = posOf(rs.b);
      if (!pa || !pb)
        nota('error', rs.id, `${rs.nombre} tiene un extremo sin asignar.`, 'Elimínalo y vuelve a crearlo eligiendo sus dos extremos.');
      else if (vLen(vSub(pa, pb)) < EPS_GEO)
        nota('error', rs.id, `${rs.nombre} une dos puntos coincidentes (distancia cero).`, `Mueve ${nombreDe(rs.a)} o ${nombreDe(rs.b)} para separarlos.`);
      if (!(rs.k > 0) || !(rs.L0 > 0))
        nota('error', rs.id, `${rs.nombre} tiene k o L₀ fuera de rango.`, 'Escribe valores mayores que 0.');
    }

    /* ---- 2. Fuerzas por cuerpo ---- */
    const resultados = [];
    for (const cuerpo of sist.cuerpos) {
      const fuerzas = [];
      const pendientes = [];   // magnitudes sin valor: no entran en la suma
      const causas = [];
      const incognitas = [];

      fuerzas.push(fuerzaPeso(cuerpo, sist.g));

      /* Cuerdas atadas directamente al cuerpo */
      for (const cd of sist.cuerdas) {
        const tramos = cd.tramos || [];
        const extremos = [];
        for (const t of tramos) {
          if (t.a === cuerpo.id) extremos.push(t.b);
          if (t.b === cuerpo.id) extremos.push(t.a);
        }
        if (!extremos.length) continue;
        const etiqueta = cd.nombre.replace(/^Cuerda\s+/, '');

        if (cuerdaNoAdmitida.has(cd.id)) {
          causas.push(`${cd.nombre}: polea no admitida (${cuerdaNoAdmitida.get(cd.id)}); no se calcula su tensión.`);
          pendientes.push({ clase: 'tension', nombre: `Tensión ${etiqueta}`, categoria: 'no admitida', elemento: cd.id, origen: 'Polea fuera del modelo' });
          continue;
        }
        if (cd.tension.tipo === 'desconocida') {
          incognitas.push(cd.nombre);
          pendientes.push({ clase: 'tension', nombre: `Tensión ${etiqueta}`, categoria: 'desconocida', elemento: cd.id, origen: 'Incógnita' });
          continue;
        }
        if (cd.tension.tipo !== 'conocida' || !(cd.tension.valor >= 0)) {
          causas.push(`${cd.nombre} no tiene tensión definida: escribe su valor o márcala como incógnita.`);
          pendientes.push({ clase: 'tension', nombre: `Tensión ${etiqueta}`, categoria: 'sin definir', elemento: cd.id, origen: 'Falta el dato' });
          continue;
        }
        for (const otro of extremos) {
          if (otro === 'LIBRE') continue;
          const destino = posOf(otro);
          if (!destino) { causas.push(`${cd.nombre} tiene un extremo sin asignar.`); continue; }
          const f = fuerzaTension(cd, cuerpo.pos, destino, nombreDe(otro));
          if (!f) { causas.push(`${cd.nombre} une puntos coincidentes: distancia cero, sin dirección.`); continue; }
          fuerzas.push(f);
        }
      }

      /* Poleas móviles unidas al cuerpo */
      for (const pl of poleas) {
        if (pl.unidoA !== cuerpo.id) continue;
        const cd = sist.cuerdas.find(c => c.id === pl.cuerdaId);
        if (pl.tipo !== 'movil' || !cd || cuerdaNoAdmitida.has(cd.id)) {
          causas.push(`${pl.nombre}: configuración de polea no admitida; no se aplica ninguna relación de tensiones.`);
          pendientes.push({ clase: 'tension', nombre: `Polea ${pl.nombre}`, categoria: 'no admitida', elemento: pl.id, origen: 'Polea fuera del modelo' });
          continue;
        }
        if (cd.tension.tipo === 'desconocida') {
          incognitas.push(cd.nombre);
          pendientes.push({ clase: 'tension', nombre: `${cd.nombre} vía ${pl.nombre}`, categoria: 'desconocida', elemento: cd.id, origen: 'Incógnita' });
          continue;
        }
        if (cd.tension.tipo !== 'conocida') {
          causas.push(`${cd.nombre} (polea móvil ${pl.nombre}) no tiene tensión definida.`);
          pendientes.push({ clase: 'tension', nombre: `${cd.nombre} vía ${pl.nombre}`, categoria: 'sin definir', elemento: cd.id, origen: 'Falta el dato' });
          continue;
        }
        const destinos = [];
        for (const t of cd.tramos) {
          if (t.a !== pl.id && t.b !== pl.id) continue;
          const otro = t.a === pl.id ? t.b : t.a;
          const p = otro === 'LIBRE' ? null : posOf(otro);
          if (p) destinos.push(p);
        }
        const f = fuerzaPoleaMovil(pl, cd, destinos);
        if (!f) { causas.push(`Un tramo de ${pl.nombre} une puntos coincidentes.`); continue; }
        fuerzas.push(f);
      }

      /* Resortes */
      for (const rs of sist.resortes) {
        if (rs.a !== cuerpo.id && rs.b !== cuerpo.id) continue;
        const otroPos = posOf(rs.a === cuerpo.id ? rs.b : rs.a);
        if (!otroPos) { causas.push(`${rs.nombre} tiene un extremo sin asignar.`); continue; }
        if (!(rs.k > 0) || !(rs.L0 > 0)) { causas.push(`${rs.nombre} tiene k o L₀ fuera de rango.`); continue; }
        const f = fuerzaResorte(rs, cuerpo.pos, otroPos);
        if (!f) { causas.push(`${rs.nombre} une puntos coincidentes: distancia cero.`); continue; }
        fuerzas.push(f);
      }

      /* Resultante y equilibrio */
      for (const n of incognitas)
        causas.push(`Tensión no determinable con el modelo actual: «${n}» es una incógnita y el simulador no resuelve incógnitas.`);
      const completa = causas.length === 0;
      const R = limpio(fuerzas.reduce((acc, f) => vAdd(acc, f.vec), [0, 0, 0]));
      const SF = vLen(R) < EPS_NUM ? 0 : vLen(R);

      let estado;
      if (!completa) estado = 'No determinado';
      else if (SF <= TOL) estado = 'En equilibrio';
      else estado = 'No está en equilibrio';

      if (incognitas.length)
        nota('aviso', cuerpo.id, `${cuerpo.nombre}: tensión no determinable con el modelo actual (${incognitas.join(', ')}).`,
          'Escribe un valor conocido para la tensión; el simulador no resuelve incógnitas.');

      resultados.push({ cuerpo, fuerzas, pendientes, incognitas, causas, completa, R, SF, estado });
    }

    /* ---- 3. Estado global ---- */
    let global = 'Sin cuerpos';
    const fuera = resultados.filter(r => r.estado === 'No está en equilibrio').map(r => r.cuerpo.nombre);
    const indets = resultados.filter(r => r.estado === 'No determinado').map(r => r.cuerpo.nombre);
    if (resultados.length > 0) {
      if (indets.length > 0) global = 'No determinado';
      else if (fuera.length === 0) global = 'En equilibrio';
      else global = 'No está en equilibrio';
    }

    return { resultados, resumen: { global, fuera, indeterminados: indets }, issues, tol: TOL };
  }

  return {
    validar, calcular, fmt, fmtInput, f2: fmt,
    TOL, EPS_NUM, EPS_GEO, MAX_VAL, G_DEF, MAXES, CATALOGO_POLEAS, RESOLVER_INCOGNITAS,
    fenomenos: { fuerzaPeso, fuerzaTension, fuerzaResorte, fuerzaPoleaMovil, revisarPolea },
  };
})();

if (typeof window !== 'undefined') window.Engine = Engine;
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
