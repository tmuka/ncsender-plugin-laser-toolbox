const test = require('node:test');
const assert = require('node:assert');
const O = require('../lib/offsets.cjs');

// A head where the laser's beam sits at (spindle + d): d = (+40.5, -27.75).
const d = { x: 40.5, y: -27.75 };
const mark = { x: 300, y: 200 };
// Machine positions with each over the mark: the spindle's tip at the mark; the
// laser at the mark means the head is d back from it.
const mposS = { x: mark.x, y: mark.y }, mposL = { x: mark.x - d.x, y: mark.y - d.y };

test('laser offset = MPos(laser over the mark) - MPos(spindle over the mark) = -d', () => {
  assert.deepStrictEqual(O.laserOffset(mposL, mposS), { x: -40.5, y: 27.75 });
});
test('with that offset, switching to the laser puts the beam where the spindle was (offset.c)', () => {
  const off = O.laserOffset(mposL, mposS);
  for (const updateG92 of [false, true]) {
    const s0 = { mpos: { x: 123, y: 456 }, g92: { x: 0, y: 0 }, laser: false };
    const s1 = O.simulateSwitch(s0, true, off, updateG92);
    // beam position = MPos + d
    assert.ok(Math.abs(s1.mpos.x + d.x - s0.mpos.x) < 1e-9 && Math.abs(s1.mpos.y + d.y - s0.mpos.y) < 1e-9);
    // with $772=1, work coordinates (MPos - G92, G54 aside) read the same
    const w0 = s0.mpos.x - s0.g92.x, w1 = s1.mpos.x - s1.g92.x;
    if (updateG92) assert.ok(Math.abs(w0 - w1) < 1e-9); else assert.ok(Math.abs(w1 - w0 - off.x) < 1e-9);
    const s2 = O.simulateSwitch(s1, false, off, updateG92);
    assert.deepStrictEqual(s2.mpos, s0.mpos);
    assert.deepStrictEqual(s2.g92, s0.g92);
  }
});
test('selecting the laser again while selected moves the head back (why programs never send M104)', () => {
  const off = { x: -40.5, y: 27.75 };
  const s1 = O.simulateSwitch({ mpos: { x: 0, y: 0 }, g92: { x: 0, y: 0 }, laser: false }, true, off, true);
  const s2 = O.simulateSwitch(s1, true, off, true);
  assert.deepStrictEqual(s2.mpos, { x: 0, y: 0 });
  assert.strictEqual(s2.laser, false);
});
test('offset commands', () => {
  assert.deepStrictEqual(O.offsetCommands({ x: -40.5, y: 27.75 }), ['$770=-40.500', '$771=27.750', '$772=1']);
  assert.deepStrictEqual(O.offsetCommands({ x: -0.0001, y: 0 }), ['$770=0.000', '$771=0.000', '$772=1']);
});

// The crosshair sits at (beam + c) on the head.
const c = { x: 12, y: 8 };
const mposC = { x: mark.x - d.x - c.x, y: mark.y - d.y - c.y };
test('crosshair offset = MPos(crosshair over the mark) - MPos(laser over it)', () => {
  assert.deepStrictEqual(O.crosshairOffset(mposC, mposL), { x: -12, y: -8 });
});
test('zero at crosshair: work zero where the spindle\'s tip is over that point, with either spindle selected', () => {
  const crossOff = O.crosshairOffset(mposC, mposL), laserOff = O.laserOffset(mposL, mposS);
  const p = O.spindlePointFromCrosshair(mposC, crossOff, laserOff);
  assert.deepStrictEqual(p, mposS);
  assert.strictEqual(O.zeroAtCrosshairCommand(mposC, crossOff, laserOff, 2), 'G21 G10 L2 P2 X300.000 Y200.000');
  // With the laser selected ($772=1): G92 = laser offset, so the laser over the
  // point reads work 0: MPos - G54 - G92 = (mposL) - (mposS) - laserOff = 0.
  const wx = mposL.x - p.x - laserOff.x, wy = mposL.y - p.y - laserOff.y;
  assert.ok(Math.abs(wx) < 1e-9 && Math.abs(wy) < 1e-9);
});
test('moves over work zero for the spindle, the laser and the crosshair', () => {
  const crossOff = { x: -12, y: -8 }, laserOff = { x: -40.5, y: 27.75 }, origin = { x: 300, y: 200 };
  assert.strictEqual(O.moveOverZero(origin, crossOff, laserOff, 'spindle'), 'G21 G53 G0 X300.000 Y200.000');
  assert.strictEqual(O.moveOverZero(origin, crossOff, laserOff, 'laser'), 'G21 G53 G0 X259.500 Y227.750');
  assert.strictEqual(O.moveOverZero(origin, crossOff, laserOff, 'crosshair'), 'G21 G53 G0 X247.500 Y219.750');
});
test('switch commands go to Safe Z first', () => {
  assert.deepStrictEqual(O.switchCommands(true, 1, -5), ['G21 G53 G0 Z-5.000', 'M104 Q1']);
  assert.deepStrictEqual(O.switchCommands(false, 1, null), ['G21 G53 G0 Z0.000', 'M104 Q0']);
});
test('every motion command the dialog sends is in mm (G21), whatever ncSender left the controller in', () => {
  for (const c of [O.zeroAtCrosshairCommand({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1), O.moveOverZero({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 'laser'), O.switchCommands(true, 1, -5)[0]]) assert.match(c, /^G21 /);
});
