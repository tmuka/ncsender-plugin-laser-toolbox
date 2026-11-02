const test = require('node:test');
const assert = require('node:assert');
Object.assign(global, require('../lib/stroke-font.cjs'));
const T = require('../lib/laser-tests.cjs');
const { simulate } = require('./sim.cjs');

const O = { laserName: 'K60', powerMode: '40 W', sMax: 1000, module: { out: 'M8', delay: 2 }, air: 'M7', rapid: 5000 };
const grid = () => T.materialGrid(O, { powers: T.ltRange(10, 100, 4, 1), feeds: T.ltRange(500, 3000, 3, 50), cell: 8, gap: 2, mode: 'fill', interval: 0.2, textH: 3, labelPower: 30, labelFeed: 1500 });
const ladder = () => T.focusLadder(O, { zs: [-2, -1, 0, 1, 2], length: 30, spacing: 6, power: 50, feed: 1500, textH: 3, labelPower: 30, labelFeed: 1500, labelZ: 0 });
const cut = (zStep) => T.cutThrough(O, { power: 100, feeds: [200, 400], passes: 3, length: 15, gapX: 4, gapY: 6, zTop: 0, zStep: zStep, textH: 3, labelPower: 30, labelFeed: 1500 });

function safety(name, prog) {
  test(name + ': fires only on G1 under M4, never on rapids, never moving Z', () => {
    const r = simulate(prog.lines);
    assert.ok(r.moves.some((m) => m.fire), 'burns something');
    r.moves.forEach((m) => {
      if (m.motion === '0') assert.ok(!m.fire);
      if (m.fire) {
        assert.strictEqual(m.motion, '1', 'line ' + m.n);
        assert.ok(m.from.z === m.to.z, 'Z moves while firing at line ' + m.n);
        assert.ok(m.s <= 1000 && m.s > 0);
        assert.ok(m.f > 0);
      }
    });
    assert.ok(!r.end.m4, 'ends with the laser off');
  });
  test(name + ': names the power mode, no M0 (ncSender shows no prompt), M30 last, module and air off', () => {
    const r = simulate(prog.lines);
    const firstBurn = r.moves.find((m) => m.fire).n;
    assert.ok(!r.events.some((e) => e.type === 'pause'));
    assert.ok(prog.lines.some((l) => /40 W power mode before running/.test(l)));
    assert.ok(r.events.find((e) => e.type === 'M8').n < firstBurn, 'module powered before burning');
    assert.strictEqual(prog.lines[prog.lines.length - 1], 'M30');
    assert.ok(prog.lines.includes('M9'));
    assert.ok(!prog.lines.some((l) => /^M104/.test(l)), 'never selects a spindle');
    assert.ok(prog.lines.indexOf('G4 P2') > prog.lines.indexOf('M8'));
  });
}
safety('material grid', grid());
safety('focus ladder', ladder());
safety('cut-through', cut(0.5));

test('material grid: one cell per power x feed, at the right S and F, all inside the box', () => {
  const g = grid();
  assert.strictEqual(g.cells.length, 12);
  const r = simulate(g.lines);
  g.cells.forEach((c) => {
    const inCell = r.moves.filter((m) => m.fire && m.to.x >= c.x - 1e-6 && m.to.x <= c.x + c.w + 1e-6 && m.to.y >= c.y - 1e-6 && m.to.y <= c.y + c.h + 1e-6 && m.from.y === m.to.y);
    assert.ok(inCell.length > 30, 'hatched');
    inCell.forEach((m) => { assert.strictEqual(m.s, Math.round(c.power * 10)); assert.strictEqual(m.f, c.feed); });
  });
  r.moves.forEach((m) => { assert.ok(m.to.x >= g.box.x0 - 1e-6 && m.to.x <= g.box.x1 + 1e-6 && m.to.y >= g.box.y0 - 1e-6 && m.to.y <= g.box.y1 + 1e-6); });
  assert.ok(g.box.x0 >= -1e-6 && g.box.y0 >= -1e-6, 'X0 Y0 is the front-left');
});
test('material grid: hatch lines are the interval apart and cells don\'t overlap', () => {
  const g = grid();
  const c = g.cells[0], ys = [...new Set(g.groups[0].paths.map((p) => p[0].y))].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1] - 0.2) < 0.01);
  assert.ok(Math.abs(ys[ys.length - 1] - (c.y + c.h)) < 1e-9);
  for (const a of g.cells) for (const b of g.cells) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
});
test('focus ladder: each line at its Z, Z changed only by rapids', () => {
  const f = ladder();
  const r = simulate(f.lines);
  f.rows.forEach((row) => {
    const burn = r.moves.find((m) => m.fire && Math.abs(m.to.y - row.y) < 1e-6 && m.to.x - m.from.x > 20);
    assert.ok(burn, 'line ' + row.index);
    assert.strictEqual(burn.to.z, row.z);
  });
  r.moves.filter((m) => m.from.z !== m.to.z && m.from.z != null).forEach((m) => assert.strictEqual(m.motion, '0'));
});
test('cut-through: n passes in column n, each lower by zStep, back and forth', () => {
  const c = cut(0.5);
  const r = simulate(c.lines);
  c.cells.forEach((cell) => {
    const passes = r.moves.filter((m) => m.fire && Math.abs(m.to.y - cell.y) < 1e-6 && Math.min(m.from.x, m.to.x) >= cell.x - 1e-6 && Math.max(m.from.x, m.to.x) <= cell.x + cell.w + 1e-6);
    assert.strictEqual(passes.length, cell.passes);
    passes.forEach((m, k) => { assert.ok(Math.abs(m.to.z + 0.5 * k) < 1e-9); assert.strictEqual(m.f, cell.feed); assert.strictEqual(m.s, 1000); });
  });
});
test('no power mode: not named; no outputs: no M7/M8/M9', () => {
  const g = T.materialGrid({ sMax: 1000 }, { powers: [20], feeds: [1000], cell: 5, gap: 1, mode: 'outline', interval: 0.2, textH: 3, labelPower: 20, labelFeed: 1000 });
  assert.ok(!g.lines.some((l) => /power mode/.test(l)));
  assert.ok(!g.lines.some((l) => /^M[789]$/.test(l)));
});
test('aux outputs use M64/M65', () => {
  assert.strictEqual(T.ltOutput('aux:2', true), 'M64 P2');
  assert.strictEqual(T.ltOutput('aux:2', false), 'M65 P2');
  assert.strictEqual(T.ltOutput('', true), null);
});
test('calibration mark: G53 cross centered on the head, head left over its center, module left on', () => {
  const m = T.calibrationMark(O, { x: 400, y: 300, size: 6, power: 15, feed: 1000 });
  const r = simulate(m.lines);
  r.moves.forEach((mv) => assert.ok(mv.g53, 'every move in machine coordinates'));
  const burns = r.moves.filter((mv) => mv.fire);
  assert.strictEqual(burns.length, 2);
  assert.deepStrictEqual([r.end.x, r.end.y], [400, 300]);
  assert.ok(!m.lines.includes('M9') || m.lines.indexOf('M9') > m.lines.indexOf('M5 S0'));
  assert.ok(m.lines.includes('M9'), 'air off at the end');
});
test('check cross: on work X0 Y0', () => {
  const c = T.checkCross(O, { size: 10, power: 20, feed: 1000 });
  const r = simulate(c.lines);
  const burns = r.moves.filter((m) => m.fire);
  assert.strictEqual(burns.length, 2);
  assert.deepStrictEqual(burns.map((b) => [b.from.x + b.to.x, b.from.y + b.to.y]), [[0, 0], [0, 0]]);
});
test('ltRange spreads evenly and rounds', () => {
  assert.deepStrictEqual(T.ltRange(10, 100, 4, 1), [10, 40, 70, 100]);
  assert.deepStrictEqual(T.ltRange(500, 3000, 3, 50), [500, 1750, 3000]);
  assert.deepStrictEqual(T.ltRange(5, 5, 1), [5]);
});
test('material grid: power labels never wider than their column', () => {
  Object.assign(global, require('../lib/stroke-font.cjs'));
  const g = T.materialGrid({ sMax: 1000 }, { powers: T.ltRange(10, 100, 10, 1), feeds: [1000], cell: 8, gap: 2, mode: 'outline', interval: 0.1, textH: 3, labelPower: 20, labelFeed: 1000 });
  const lab = g.groups[g.groups.length - 1].paths;
  const topY = Math.max(...lab.flat().map((q) => q.y));
  // strokes in the top row, grouped by column: each spans less than cell + gap
  g.cells.forEach((c) => {
    const xs = lab.flat().filter((q) => q.y > g.cells[0].y + g.cells[0].h && q.x >= c.x - 1 && q.x <= c.x + c.w + 1).map((q) => q.x);
    if (xs.length) assert.ok(Math.max(...xs) - Math.min(...xs) <= 10 + 1e-6);
  });
  assert.ok(topY > 0);
});
