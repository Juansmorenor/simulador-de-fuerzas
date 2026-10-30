'use strict';
/* ============================================================
   Pruebas automatizadas del motor de cálculo (RNF-13, RNF-14,
   RNF-23). Se ejecutan sin interfaz ni gráficos:

       node tests/engine.test.js

   Cada caso cita el criterio de aceptación que comprueba.
   ============================================================ */

const assert = require('assert');
const E = require('../engine.js');

let ok = 0, fallos = 0;
function caso(nombre, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nombre); }
  catch (e) { fallos++; console.log('  ✗ ' + nombre + '\n      ' + e.message); }
}
// RNF-23: error relativo ≤ 1e-9 (absoluto ≤ 1e-9 si el esperado es 0)
function cerca(real, esperado, msg = '') {
  const tol = Math.abs(esperado) < 1e-12 ? 1e-9 : Math.abs(esperado) * 1e-9;
  assert.ok(Math.abs(real - esperado) <= tol, `${msg} esperado ${esperado}, obtenido ${real}`);
}
function cercaV(v, e, msg) { e.forEach((x, i) => cerca(v[i], x, `${msg}[${i}]`)); }

const base = () => ({ g: 9.81, cuerpos: [], anclajes: [], cuerdas: [], resortes: [], poleas: [] });
const cuerpo = (id, pos, masa = 1) => ({ id, nombre: id, masa, pos });
const anclaje = (id, pos) => ({ id, nombre: id, pos });
const cuerda = (id, tramos, tension) => ({ id, nombre: 'Cuerda ' + id, tramos, tension });
const resorte = (id, a, b, k, L0) => ({ id, nombre: 'Resorte ' + id, a, b, k, L0 });
const resDe = (out, id) => out.resultados.find(r => r.cuerpo.id === id);

console.log('\nMotor de cálculo · pruebas de aceptación\n');

/* ---------------- RF-08 / RF-07 · peso ---------------- */
caso('RF-08: m = 2,0 kg, g = 9,81 → P = 19,62 N y vector (0; −19,62; 0)', () => {
  const s = base(); s.cuerpos.push(cuerpo('A', [0, 0, 0], 2));
  const P = resDe(E.calcular(s), 'A').fuerzas.find(f => f.clase === 'peso');
  cerca(P.mag, 19.62); cercaV(P.vec, [0, -19.62, 0], 'P');
  assert.strictEqual(E.fmt(P.mag), '19,62');
});
caso('RF-07: g de 9,81 a 1,62 → peso de 10 kg pasa de 98,1 a 16,2 N hacia −Y', () => {
  const s = base(); s.cuerpos.push(cuerpo('A', [0, 0, 0], 10));
  cerca(resDe(E.calcular(s), 'A').fuerzas[0].mag, 98.1);
  s.g = 1.62;
  const P = resDe(E.calcular(s), 'A').fuerzas[0];
  cerca(P.mag, 16.2); assert.ok(P.vec[1] < 0 && P.vec[0] === 0 && P.vec[2] === 0);
});
caso('RF-37: desarrollo del peso «P = 2,00 kg × 9,81 m/s² = 19,62 N»', () => {
  const P = E.fenomenos.fuerzaPeso(cuerpo('A', [0, 0, 0], 2), 9.81);
  assert.ok(P.formula.includes('2,00 kg × 9,81 m/s² = 19,62 N'), P.formula);
});

/* ---------------- RF-10 / RF-11 · tensión ---------------- */
caso('RF-10: cuerpo (0,0,0) y anclaje (3,4,0) → û = (0,6; 0,8; 0)', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]));
  s.anclajes.push(anclaje('K', [3, 4, 0]));
  s.cuerdas.push(cuerda('C1', [{ a: 'A', b: 'K' }], { tipo: 'conocida', valor: 50 }));
  const T = resDe(E.calcular(s), 'A').fuerzas.find(f => f.clase === 'tension');
  cercaV(T.extra.u, [0.6, 0.8, 0], 'û');
  cercaV(T.vec, [30, 40, 0], 'T');            // RF-11
  // al mover el anclaje, la dirección se actualiza (RF-04)
  s.anclajes[0].pos = [0, 5, 0];
  const T2 = resDe(E.calcular(s), 'A').fuerzas.find(f => f.clase === 'tension');
  cercaV(T2.extra.u, [0, 1, 0], 'û2');
});
caso('RF-11: T < 0 se rechaza', () => {
  assert.strictEqual(E.validar('T', '-1').ok, false);
  assert.strictEqual(E.validar('T', '0').ok, true);
});

/* ---------------- RF-12 / RF-13 / RNF-12 · incógnitas ---------------- */
caso('RF-12: con tensión desconocida no hay veredicto y aparece como «desconocida» sin valor', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]));
  s.anclajes.push(anclaje('K', [0, 2, 0]));
  s.cuerdas.push(cuerda('C1', [{ a: 'A', b: 'K' }], { tipo: 'desconocida', valor: 0 }));
  const r = resDe(E.calcular(s), 'A');
  assert.strictEqual(r.estado, 'No determinado');
  assert.strictEqual(r.pendientes[0].categoria, 'desconocida');
  assert.ok(!('mag' in r.pendientes[0]));
  assert.ok(r.fuerzas.every(f => f.clase !== 'tension'));
});
caso('RF-13: cuatro cuerdas desconocidas → indeterminación, sin valores ni veredicto', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]));
  [[1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]].forEach((p, i) => {
    s.anclajes.push(anclaje('K' + i, p));
    s.cuerdas.push(cuerda('C' + i, [{ a: 'A', b: 'K' + i }], { tipo: 'desconocida', valor: 0 }));
  });
  const out = E.calcular(s), r = resDe(out, 'A');
  assert.strictEqual(r.estado, 'No determinado');
  assert.strictEqual(out.resumen.global, 'No determinado');
  assert.strictEqual(r.pendientes.length, 4);
  assert.ok(r.causas.some(c => c.includes('no determinable')));
});
caso('RF-33: cuerda «sin definir» deja el cuerpo «No determinado»', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]));
  s.anclajes.push(anclaje('K', [0, 2, 0]));
  s.cuerdas.push(cuerda('C1', [{ a: 'A', b: 'K' }], { tipo: 'sin_definir', valor: 0 }));
  assert.strictEqual(resDe(E.calcular(s), 'A').estado, 'No determinado');
});

/* ---------------- RF-17 · Hooke ---------------- */
caso('RF-17: k = 200, L₀ = 0,5; extremo en (0; 0,8; 0) → (0; 60; 0) N, estirado', () => {
  const f = E.fenomenos.fuerzaResorte({ id: 'R', nombre: 'Resorte R', k: 200, L0: 0.5 }, [0, 0, 0], [0, 0.8, 0]);
  cercaV(f.vec, [0, 60, 0], 'F'); assert.strictEqual(f.extra.estado, 'estirado');
});
caso('RF-17: extremo en (0; 0,3; 0) → (0; −40; 0) N, comprimido', () => {
  const f = E.fenomenos.fuerzaResorte({ id: 'R', nombre: 'Resorte R', k: 200, L0: 0.5 }, [0, 0, 0], [0, 0.3, 0]);
  cercaV(f.vec, [0, -40, 0], 'F'); assert.strictEqual(f.extra.estado, 'comprimido');
});
caso('RF-17: L = L₀ → (0; 0; 0) N sin «−0»', () => {
  const f = E.fenomenos.fuerzaResorte({ id: 'R', nombre: 'Resorte R', k: 200, L0: 0.5 }, [0, 0, 0], [0, 0.5, 0]);
  cercaV(f.vec, [0, 0, 0], 'F');
  assert.ok(!f.vectorTxt.includes('−0,00'), f.vectorTxt);
  assert.strictEqual(f.extra.estado, 'en su longitud natural');
});
caso('RF-17: sobre el extremo B la fuerza es la opuesta', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]), cuerpo('B', [0, 0.8, 0]));
  s.resortes.push(resorte('R', 'A', 'B', 200, 0.5));
  const out = E.calcular(s);
  const fa = resDe(out, 'A').fuerzas.find(f => f.clase === 'elastica');
  const fb = resDe(out, 'B').fuerzas.find(f => f.clase === 'elastica');
  cercaV(fa.vec, [0, 60, 0], 'A'); cercaV(fb.vec, [0, -60, 0], 'B');
});

/* ---------------- RF-19 / RF-20 · poleas ---------------- */
function sistemaPoleaMovil(T, sep = 0) {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0], 5));
  s.anclajes.push(anclaje('S1', [-sep, 2, 0]), anclaje('S2', [sep, 2, 0]));
  s.cuerdas.push(cuerda('C', [{ a: 'S1', b: 'P' }, { a: 'P', b: 'S2' }], { tipo: 'conocida', valor: T }));
  s.poleas.push({ id: 'P', nombre: 'Polea P', tipo: 'movil', pos: [0, 0.5, 0], cuerdaId: 'C', unidoA: 'A' });
  return s;
}
caso('RF-19: polea móvil, tramos verticales, T = 25 N → (0; 50; 0) N', () => {
  const r = resDe(E.calcular(sistemaPoleaMovil(25)), 'A');
  const f = r.fuerzas.find(f => f.elemento === 'P');
  cercaV(f.vec, [0, 50, 0], 'F');
});
caso('RF-19: tramos no verticales → suma vectorial, no 2T', () => {
  const r = resDe(E.calcular(sistemaPoleaMovil(25, 1.5)), 'A');
  const f = r.fuerzas.find(f => f.elemento === 'P');
  cerca(f.vec[1], 2 * 25 * 1.5 / Math.hypot(1.5, 1.5));
  cerca(f.vec[0], 0);
  assert.ok(f.mag < 50);
});
caso('RF-19: polea fija simple → misma T en el cuerpo, hacia la polea', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]), cuerpo('B', [2, 0, 0]));
  s.poleas.push({ id: 'P', nombre: 'Polea P', tipo: 'fija', pos: [1, 1, 0], cuerdaId: 'C' });
  s.cuerdas.push(cuerda('C', [{ a: 'A', b: 'P' }, { a: 'P', b: 'B' }], { tipo: 'conocida', valor: 10 }));
  const out = E.calcular(s);
  const ta = resDe(out, 'A').fuerzas.find(f => f.clase === 'tension');
  const tb = resDe(out, 'B').fuerzas.find(f => f.clase === 'tension');
  cerca(ta.mag, 10); cerca(tb.mag, 10);
  cercaV(ta.extra.u, [Math.SQRT1_2, Math.SQRT1_2, 0], 'ûA');
  cercaV(tb.extra.u, [-Math.SQRT1_2, Math.SQRT1_2, 0], 'ûB');
});
caso('RF-20: cuerda interrumpida por un cuerpo sobre una polea → no admitida, sin T₁ = T₂', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]), cuerpo('M', [1, 0.5, 0]), cuerpo('B', [2, 0, 0]));
  s.poleas.push({ id: 'P', nombre: 'Polea P', tipo: 'fija', pos: [1, 1, 0], cuerdaId: 'C' });
  s.cuerdas.push(cuerda('C', [{ a: 'A', b: 'M' }, { a: 'M', b: 'P' }, { a: 'P', b: 'B' }], { tipo: 'conocida', valor: 10 }));
  const out = E.calcular(s);
  assert.ok(out.issues.some(i => i.elemento === 'P' && i.nivel === 'error'));
  for (const id of ['A', 'M', 'B']) {
    const r = resDe(out, id);
    assert.strictEqual(r.estado, 'No determinado', id);
    assert.ok(r.fuerzas.every(f => f.clase !== 'tension'), id);
  }
});
caso('RF-20: configuración fuera del catálogo → no admitida', () => {
  const s = sistemaPoleaMovil(25); s.poleas[0].tipo = 'diferencial';
  assert.strictEqual(resDe(E.calcular(s), 'A').estado, 'No determinado');
});

/* ---------------- RF-26 / RF-27 · componentes y resultante ---------------- */
caso('RF-26: 10 N a 30° en XY → (8,66; 5,00; 0) y |F| = 10', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0]));
  s.anclajes.push(anclaje('K', [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]));
  s.cuerdas.push(cuerda('C', [{ a: 'A', b: 'K' }], { tipo: 'conocida', valor: 10 }));
  const T = resDe(E.calcular(s), 'A').fuerzas.find(f => f.clase === 'tension');
  assert.strictEqual(E.fmt(T.vec[0]), '8,66'); assert.strictEqual(E.fmt(T.vec[1]), '5,00');
  cerca(Math.hypot(...T.vec), 10);
});
caso('RF-27: P + dos tensiones simétricas → resultante con componentes sumadas', () => {
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0], 5));
  s.anclajes.push(anclaje('K1', [-1, 1, 0]), anclaje('K2', [1, 1, 0]));
  const T = 5 * 9.81 / 2 / Math.SQRT1_2;   // equilibrio exacto
  s.cuerdas.push(cuerda('C1', [{ a: 'A', b: 'K1' }], { tipo: 'conocida', valor: T }));
  s.cuerdas.push(cuerda('C2', [{ a: 'A', b: 'K2' }], { tipo: 'conocida', valor: T }));
  const r = resDe(E.calcular(s), 'A');
  cercaV(r.R, [0, 0, 0], 'R');
  assert.strictEqual(r.estado, 'En equilibrio');
  assert.strictEqual(E.fmt(r.R[1]), '0,00');
});

/* ---------------- RF-28 / RNF-08 · tolerancia ---------------- */
function conResultante(Fy) {
  // cuerpo de 1 kg sostenido por una cuerda vertical con T = P + Fy
  const s = base();
  s.cuerpos.push(cuerpo('A', [0, 0, 0], 1));
  s.anclajes.push(anclaje('K', [0, 1, 0]));
  s.cuerdas.push(cuerda('C', [{ a: 'A', b: 'K' }], { tipo: 'conocida', valor: 9.81 + Fy }));
  return resDe(E.calcular(s), 'A');
}
caso('RF-28: |F_R| = 0,004 N → «En equilibrio»', () => assert.strictEqual(conResultante(0.004).estado, 'En equilibrio'));
caso('RF-28: |F_R| = 0,02 N → «No está en equilibrio»', () => assert.strictEqual(conResultante(0.02).estado, 'No está en equilibrio'));
caso('RNF-08: |F_R| = 0,0100001 N → «No está en equilibrio»', () => assert.strictEqual(conResultante(0.0100001).estado, 'No está en equilibrio'));
caso('RNF-08: 3×10⁻¹² N se muestra «0,00» sin signo', () => {
  assert.strictEqual(E.fmt(-3e-12), '0,00'); assert.strictEqual(E.fmt(-0.004), '0,00');
  assert.strictEqual(E.fmt(-0.006), '−0,01');
});

/* ---------------- RF-29 · estado global ---------------- */
caso('RF-29: tres cuerpos, uno fuera de equilibrio → global «No está en equilibrio» y lo nombra', () => {
  const s = base();
  ['A', 'B', 'C'].forEach((id, i) => {
    s.cuerpos.push(cuerpo(id, [i * 2, 0, 0], 1));
    s.anclajes.push(anclaje('K' + id, [i * 2, 1, 0]));
    s.cuerdas.push(cuerda('C' + id, [{ a: id, b: 'K' + id }], { tipo: 'conocida', valor: id === 'C' ? 5 : 9.81 }));
  });
  const out = E.calcular(s);
  assert.strictEqual(out.resumen.global, 'No está en equilibrio');
  assert.deepStrictEqual(out.resumen.fuera, ['C']);
});
caso('RF-33: cuerpo sin conexiones → solo su peso y «No está en equilibrio»', () => {
  const s = base(); s.cuerpos.push(cuerpo('A', [0, 1, 0], 1));
  const r = resDe(E.calcular(s), 'A');
  assert.strictEqual(r.fuerzas.length, 1); assert.strictEqual(r.estado, 'No está en equilibrio');
});

/* ---------------- RF-32 / RNF-11 / RNF-17 · validación ---------------- */
caso('RF-32: masa 0, −5, «abc», vacío e infinito se rechazan; 0,001 y 1000 se aceptan', () => {
  for (const v of ['0', '-5', 'abc', '', 'Infinity', '1e999', 'NaN', '12abc', '2,5,1'])
    assert.strictEqual(E.validar('masa', v).ok, false, `«${v}» debería rechazarse`);
  cerca(E.validar('masa', '0,001').valor, 0.001);
  cerca(E.validar('masa', '1000').valor, 1000);
  cerca(E.validar('masa', '2.5').valor, 2.5);
});
caso('RNF-11: magnitudes por encima de 1×10⁶ se rechazan', () => {
  assert.strictEqual(E.validar('k', '1000001').ok, false);
  assert.strictEqual(E.validar('k', '1000000').ok, true);
});
caso('RNF-17: cadenas de ataque se rechazan sin ejecutarse', () => {
  for (const v of ['<script>alert(1)</script>', '1+1', 'alert(1)', '${1}', 'x'.repeat(100000), '9'.repeat(100000)])
    assert.strictEqual(E.validar('masa', v).ok, false);
});
caso('RF-34: el mensaje de masa negativa nombra el campo, pide > 0 y no tiene trazas', () => {
  const m = E.validar('masa', '-2').mensaje;
  assert.ok(/masa/i.test(m) && /mayor que 0/.test(m) && !/Error|at |undefined|NaN/.test(m), m);
});

/* ---------------- RNF-10 · casos límite ---------------- */
caso('RNF-10: casos límite sin NaN, infinitos ni «−0»', () => {
  const casos = [
    { d: 0 }, { d: 1e-12 }, { d: 1, m: 0.001 }, { d: 1, m: 1e6 },
    { d: 1, k: 1e-3 }, { d: 1, k: 1e6 }, { d: 1, lejos: 1e6 },
  ];
  for (const c of casos) {
    const s = base();
    const x = c.lejos || 0;
    s.cuerpos.push(cuerpo('A', [x, 0, 0], c.m || 1));
    s.anclajes.push(anclaje('K', [x, c.d, 0]));
    s.cuerdas.push(cuerda('C', [{ a: 'A', b: 'K' }], { tipo: 'conocida', valor: 3 }));
    s.resortes.push(resorte('R', 'A', 'K', c.k || 100, 0.5));
    const out = E.calcular(s);
    const r = resDe(out, 'A');
    const nums = [...r.R, r.SF, ...r.fuerzas.flatMap(f => [...f.vec, f.mag])];
    assert.ok(nums.every(Number.isFinite), JSON.stringify(c));
    const textos = r.fuerzas.flatMap(f => [f.vectorTxt, f.formula, E.fmt(f.mag)]).concat(r.R.map(v => E.fmt(v)));
    assert.ok(textos.every(t => !/NaN|Infinity|−0,00(?!\d)/.test(t)), JSON.stringify(c) + ' ' + textos.join(' | '));
    if (c.d < E.EPS_GEO) {
      assert.strictEqual(r.estado, 'No determinado');
      assert.ok(out.issues.some(i => i.elemento === 'C'));
    }
  }
});

/* ---------------- RNF-13 · independencia ---------------- */
caso('RNF-13: el motor no depende del DOM ni de Three.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'engine.js'), 'utf8');
  assert.ok(!/document\.|THREE|import\s*\(|require\(['"]three/.test(src));
});

console.log(`\n${ok} correctas · ${fallos} con fallo\n`);
process.exit(fallos ? 1 : 0);
