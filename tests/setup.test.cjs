const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/laser-setup.cjs');
// The laser settings of a SuperLongBoard Ext with grblHAL 1.1f (2026-10-15):
// spindle 0 a Huanyang VFD, spindle 1 PWM2 (S0-1000), $770-$772 present and 0.
const fw = require('./fixture-firmware.json');

const set = (id, value) => {
  const c = JSON.parse(JSON.stringify(fw));
  c.settings.find((s) => String(s.id) === id).value = value;
  return c;
};

test('finds the laser on spindle 1 (PWM2), its power range and the offset settings', () => {
  const i = S.analyzeLaser(fw);
  assert.deepStrictEqual(i.spindles.map((s) => [s.num, s.type, s.laserCapable]), [[0, 'Huanyang v1', false], [1, 'PWM2', true]]);
  assert.strictEqual(i.laser.num, 1);
  assert.strictEqual(i.laser.sMax, 1000);
  assert.strictEqual(i.laserMode, false);
  assert.deepStrictEqual(i.offset, { available: true, x: 0, y: 0, updateG92: false });
});
test('a PWM2 with "Disable laser mode capability" is no laser', () => {
  const i = S.analyzeLaser(set('709', 1 | 4));
  assert.strictEqual(i.laser, null);
});
test('the settings as an object keyed by id work too', () => {
  const obj = { settings: {} };
  fw.settings.forEach((s) => { obj.settings[s.id] = s; });
  assert.strictEqual(S.analyzeLaser(obj).laser.num, 1);
});
test('checklist: what\'s missing on the Pi today', () => {
  const ms = { connected: true, homed: true, workspace: 'G54', WCO: '103.778,286.287,-89.726,0', g54: '103.778,286.287,-37.224,0' };
  const list = S.setupChecks(S.analyzeLaser(fw), { laserSpindle: 1, laserMode: false, showLaserMode: true }, ms);
  const by = Object.fromEntries(list.map((c) => [c.id, c.level]));
  assert.deepStrictEqual(by, { spindle: 'ok', laserMode: 'warn', ncsender: 'ok', offset: 'warn', g92: 'warn', homed: 'ok' });
});
test('checklist: all set, laser selected seen from the G92 shift', () => {
  let f = set('32', 1); f = JSON.parse(JSON.stringify(f));
  f.settings.find((s) => String(s.id) === '770').value = '-40.5';
  f.settings.find((s) => String(s.id) === '771').value = '27.75';
  f.settings.find((s) => String(s.id) === '772').value = 1;
  const i = S.analyzeLaser(f);
  const ms = { connected: true, homed: true, workspace: 'G55', WCO: '59.5,327.75,-10,0', g55: '100,300,-5,0' };
  assert.strictEqual(S.laserSelected(ms, i.offset), true);
  assert.strictEqual(S.laserSelected(Object.assign({}, ms, { WCO: '100,300,-10,0' }), i.offset), false);
  assert.strictEqual(S.laserSelected(Object.assign({}, ms, { WCO: '101,300,-10,0' }), i.offset), 'unknown');
  const by = Object.fromEntries(S.setupChecks(i, {}, ms).map((c) => [c.id, c.level]));
  assert.deepStrictEqual(by, { spindle: 'ok', laserMode: 'ok', ncsender: 'info', offset: 'ok', g92: 'ok', g92save: 'warn', homed: 'ok', selected: 'info' });
  assert.strictEqual(S.strayG92(ms, i.offset), null, 'the laser\'s own shift is fine');
  assert.deepStrictEqual(S.strayG92(Object.assign({}, ms, { WCO: '105,300,-10,0' }), i.offset), { x: 5, y: 0 });
});
test('active work offset index for G10 L2', () => {
  assert.strictEqual(S.activeWcs({ workspace: 'G54' }).index, 1);
  assert.strictEqual(S.activeWcs({ workspace: 'G59' }).index, 6);
  assert.strictEqual(S.activeWcs({ workspace: 'G59.2' }).index, 8);
  assert.deepStrictEqual(S.activeWcs({ workspace: 'G55', g55: '1,2,3,0' }).origin, { x: 1, y: 2, z: 3 });
});
