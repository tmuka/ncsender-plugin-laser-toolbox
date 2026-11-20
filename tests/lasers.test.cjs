const test = require('node:test');
const assert = require('node:assert');
Object.assign(global, require('../lib/stroke-font.cjs'));
const Z = require('../lib/lasers.cjs');
const T = require('../lib/laser-tests.cjs');
const { analyzeLaser } = require('../lib/laser-setup.cjs');
const { simulate } = require('./sim.cjs');
const fw = require('./fixture-firmware.json');

// The single-laser settings saved by 0.1.0 (as on the Pi, 2026-11-07, plus a crosshair and focus).
const OLD = { name: 'K60', modes: '20 W, 40 W, 60 W', moduleOut: 'M8', moduleDelay: 3, airOut: 'M7', mode: '40 W',
  mark: { x: 400, y: 300, t: 1 }, spindleAt: null, crossOff: { x: 1.5, y: -2 }, test: 'focus',
  fields: { 'lt-focus-z': '1.5', 'lt-use-focus': true, 'lt-material': 'Birch 3 mm' }, presets: [{ material: 'Birch', laser: 'K60', power: 40 }] };

test('a new install gets the K60 and the R2, the K60 picked', () => {
  const c = Z.migrateConfig({});
  assert.deepStrictEqual(c.lasers.map((l) => l.name), ['K60', 'R2']);
  assert.strictEqual(c.laserId, 'k60');
  assert.match(c.lasers[1].wavelength, /1064/);
  assert.strictEqual(c.lasers[1].offset, null);
});

test('old single-laser settings become the first laser, everything kept', () => {
  const c = Z.migrateConfig(JSON.parse(JSON.stringify(OLD)));
  const k = c.lasers[0];
  assert.strictEqual(k.name, 'K60');
  assert.strictEqual(k.modes, '20 W, 40 W, 60 W');
  assert.strictEqual(k.mode, '40 W');
  assert.strictEqual(k.moduleOut, 'M8');
  assert.strictEqual(k.moduleDelay, 3);
  assert.strictEqual(k.airOut, 'M7');
  assert.deepStrictEqual(k.crossOff, { x: 1.5, y: -2 });
  assert.strictEqual(k.focusZ, 1.5);
  assert.strictEqual(k.useFocus, true);
  assert.match(k.wavelength, /455/);
  assert.strictEqual(k.adoptFirmware, true);
  assert.deepStrictEqual(c.lasers.map((l) => l.name), ['K60', 'R2'], 'the R2 added once, the K60 not twice');
  assert.strictEqual(c.laserId, k.id);
  assert.strictEqual(c.mark.laser, k.id, 'the last mark was the K60\'s');
  ['name', 'modes', 'mode', 'moduleOut', 'moduleDelay', 'airOut', 'crossOff'].forEach((key) => assert.ok(!(key in c), key + ' moved'));
  assert.ok(!('lt-focus-z' in c.fields) && c.fields['lt-material'] === 'Birch 3 mm');
  assert.strictEqual(c.presets.length, 1);
  assert.strictEqual(c.test, 'focus');
});

test('an old laser with another name keeps it, and both defaults follow', () => {
  const c = Z.migrateConfig({ name: 'Opt 10W', modes: '' });
  assert.deepStrictEqual(c.lasers.map((l) => l.name), ['Opt 10W', 'K60', 'R2']);
  assert.strictEqual(c.lasers[0].wavelength, '');
});

test('migrating twice changes nothing', () => {
  const once = Z.migrateConfig(JSON.parse(JSON.stringify(OLD)));
  const twice = Z.migrateConfig(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice, once);
});

test('a saved list picks the first laser when the picked one is gone', () => {
  const c = Z.migrateConfig({ lasers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', sMax: '500' }], laserId: 'gone' });
  assert.strictEqual(c.laserId, 'a');
  assert.strictEqual(Z.selectedLaser(Object.assign(c, { laserId: 'b' })).sMax, 500);
});

test('a migrated laser takes the offset grblHAL already has, once', () => {
  const c = Z.migrateConfig(JSON.parse(JSON.stringify(OLD)));
  const fwOff = { available: true, x: -60.5, y: 12.25, updateG92: true };
  assert.strictEqual(Z.adoptFirmwareOffset(c.lasers, fwOff), true);
  assert.deepStrictEqual(c.lasers[0].offset, { x: -60.5, y: 12.25 });
  assert.strictEqual(c.lasers[1].offset, null, 'the R2 has its own, not measured yet');
  assert.strictEqual(Z.adoptFirmwareOffset(c.lasers, { available: true, x: 5, y: 5 }), false);
  assert.deepStrictEqual(c.lasers[0].offset, { x: -60.5, y: 12.25 });
  // No firmware read yet: wait for it.
  const d = Z.migrateConfig(JSON.parse(JSON.stringify(OLD)));
  assert.strictEqual(Z.adoptFirmwareOffset(d.lasers, { available: false, x: 0, y: 0 }), false);
  assert.strictEqual(d.lasers[0].adoptFirmware, true);
});

test('which laser grblHAL holds the offset of', () => {
  const lasers = Z.defaultLasers();
  lasers[0].offset = { x: -60.5, y: 12.25 };
  lasers[1].offset = { x: -42, y: -30.1 };
  const fwOff = { available: true, x: -42, y: -30.1 };
  assert.strictEqual(Z.offsetState(lasers[1], fwOff), 'loaded');
  assert.strictEqual(Z.offsetState(lasers[0], fwOff), 'other');
  assert.strictEqual(Z.firmwareOwner(lasers, fwOff), lasers[1]);
  assert.strictEqual(Z.firmwareOwner(lasers, { available: true, x: 0, y: 0 }), null);
  assert.strictEqual(Z.offsetState(Z.normalizeLaser({}), fwOff), 'unmeasured');
  assert.strictEqual(Z.offsetState(lasers[0], { available: false }), 'unavailable');
});

test('each laser its own power range inside its spindle\'s', () => {
  const info = analyzeLaser(fw);
  const sp = Z.laserSpindle(Z.normalizeLaser({}), info);
  assert.strictEqual(sp.num, 1);
  assert.deepStrictEqual(Z.powerRange(Z.normalizeLaser({}), sp), { sMin: 0, sMax: sp.sMax });
  assert.deepStrictEqual(Z.powerRange(Z.normalizeLaser({ sMin: 50, sMax: 400 }), sp), { sMin: 50, sMax: 400 });
  assert.deepStrictEqual(Z.powerRange(Z.normalizeLaser({ sMax: 99999 }), sp), { sMin: 0, sMax: sp.sMax }, 'never above the spindle\'s');
  assert.deepStrictEqual(Z.powerRange(Z.normalizeLaser({ sMin: 800, sMax: 400 }), sp), { sMin: 400, sMax: 400 });
  // A spindle grblHAL doesn't have: Setup's, and a check says so.
  const gone = Z.normalizeLaser({ name: 'R2', spindle: 3 });
  assert.strictEqual(Z.laserSpindle(gone, info).num, 1);
  assert.strictEqual(Z.laserChecks(gone, info)[0].level, 'bad');
  // The VFD (spindle 0) can't run a laser.
  const vfd = Z.normalizeLaser({ name: 'R2', spindle: 0 });
  assert.ok(Z.laserChecks(vfd, info).some((c) => c.id === 'laserSpindle' && c.level === 'bad'));
});

test('a new laser gets an unused id and name', () => {
  const lasers = Z.defaultLasers();
  const a = Z.newLaser(lasers); lasers.push(a);
  const b = Z.newLaser(lasers);
  assert.notStrictEqual(a.id, b.id);
  assert.notStrictEqual(a.name, b.name);
});

// Programs from each laser's settings: its range, its name, its outputs.
const O = (l) => ({ laserName: l.name, spindle: 1, powerMode: '', sMax: Z.powerRange(l, { sMax: 1000 }).sMax,
  sMin: Z.powerRange(l, { sMax: 1000 }).sMin, module: null, air: '', rapid: 5000 });
const gridFor = (l) => T.materialGrid(O(l), { powers: [10, 50, 100], feeds: [1000], cell: 5, gap: 1, mode: 'outline', interval: 0.2, textH: 3, labelPower: 0, labelFeed: 1000 });

test('the R2\'s program uses the R2\'s power range and name', () => {
  const r2 = Z.normalizeLaser({ name: 'R2', sMin: 100, sMax: 600 });
  const g = gridFor(r2);
  const r = simulate(g.lines);
  const s = [...new Set(r.moves.filter((m) => m.fire).map((m) => m.s))].sort((a, b) => a - b);
  assert.deepStrictEqual(s, [150, 350, 600]);
  assert.ok(g.lines.some((l) => /^\(R2, S100-600 = 0-100%\)$/.test(l)));
  assert.ok(g.lines.includes('(Select the R2 on spindle 1 and turn on Laser Mode, $32=1, before running)'));
  const k60 = gridFor(Z.normalizeLaser({ name: 'K60' }));
  assert.ok(simulate(k60.lines).moves.some((m) => m.fire && m.s === 1000));
});

test('0% stays S0 with a minimum power; 1% starts at it', () => {
  assert.strictEqual(T.ltS(0, 1000, 100), 0);
  assert.strictEqual(T.ltS(1, 1000, 100), 109);
  assert.strictEqual(T.ltS(100, 1000, 100), 1000);
  assert.strictEqual(T.ltS(50, 1000), 500);
});

test('every line any laser makes: printable ASCII, 79 characters at most, no ! ? ~', () => {
  const odd = Z.normalizeLaser({ name: 'Blue “K60” (60 W) ¡Hot! ~ really long name for a laser module that goes on and on?' });
  const o = Object.assign(O(odd), { powerMode: '60 W', notes: ['Material: Birch – 3 mm (best?)'] });
  const progs = [
    T.materialGrid(o, { powers: [10, 100], feeds: [1000], cell: 5, gap: 1, mode: 'fill', interval: 0.5, textH: 3, labelPower: 20, labelFeed: 1000 }),
    T.focusLadder(o, { zs: [-1, 0, 1], length: 10, spacing: 5, power: 50, feed: 1500, textH: 3, labelPower: 20, labelFeed: 1500, labelZ: 0 }),
    T.cutThrough(o, { power: 100, feeds: [200], passes: 2, length: 10, gapX: 4, gapY: 6, zTop: 0, zStep: 0.5, textH: 3, labelPower: 20, labelFeed: 1500 }),
    T.calibrationMark(o, { x: 1, y: 2, size: 6, power: 10, feed: 1000 }),
    T.checkCross(o, { size: 10, power: 10, feed: 1000 })
  ];
  progs.forEach((p) => p.lines.forEach((l) => {
    assert.ok(l.length <= 79, l);
    assert.ok(/^[\x20-\x7e]*$/.test(l), l);
    assert.ok(!/[!?~]/.test(l), l);
    if (l[0] === '(') assert.ok(/^\([^()]*\)$/.test(l), l);
  }));
});

test('a long header wraps over comment lines at words, nothing lost', () => {
  const g = T.materialGrid({ laserName: 'K60', sMax: 1000 }, { powers: T.ltRange(10, 100, 10, 1), feeds: T.ltRange(1000, 6000, 6, 10), cell: 8, gap: 2, mode: 'fill', interval: 0.1, textH: 3, labelPower: 20, labelFeed: 1000 });
  const head = g.lines.slice(0, g.lines.indexOf('G21 G90 G17')).map((l) => l.slice(1, -1)).join(' ');
  assert.match(head, /filled at 0\.1 mm cells of 8 mm K60/);
  g.lines.forEach((l) => assert.ok(l.length <= 79, l));
});
