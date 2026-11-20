// The lasers: a list the user names, edits and picks between (plugin
// settings, cfg.lasers, cfg.laserId). Each keeps its own power range, its
// spindle (M104 Q<n>), its offset from the spindle and its crosshair's,
// its focus, power modes and outputs.
//
// grblHAL's offset plugin has one slot ($770/$771), so only one laser's
// offset is in the controller at a time: the one whose stored offset
// matches it. Loading another's is a $770/$771 change, made with the
// spindle selected (offsets.cjs, offsetCommands).

var LZ_DEFAULTS = [
  { id: 'k60', name: 'K60', wavelength: '455 nm (blue)', modes: '20 W, 40 W, 60 W', watts: 60 },
  { id: 'r2', name: 'R2', wavelength: '1064 nm (IR)', modes: '', watts: 2 }
];

function lzNum(v) { var n = v === '' || v == null ? NaN : Number(v); return isFinite(n) ? n : null; }
function lzXY(v) { return v && lzNum(v.x) != null && lzNum(v.y) != null ? { x: Number(v.x), y: Number(v.y) } : null; }

// A laser with every field, from whatever was saved.
function normalizeLaser(l, i) {
  l = l || {};
  return {
    id: String(l.id || 'laser' + (i || 0)),
    name: String(l.name == null ? 'Laser' : l.name),
    wavelength: String(l.wavelength || ''),
    watts: lzNum(l.watts),
    modes: String(l.modes || ''),
    mode: String(l.mode || ''),
    spindle: lzNum(l.spindle),
    sMin: lzNum(l.sMin),
    sMax: lzNum(l.sMax),
    moduleOut: String(l.moduleOut || ''),
    moduleDelay: lzNum(l.moduleDelay) == null ? 2 : Number(l.moduleDelay),
    airOut: String(l.airOut || ''),
    focusZ: lzNum(l.focusZ),
    useFocus: !!l.useFocus,
    offset: lzXY(l.offset),
    crossOff: lzXY(l.crossOff),
    // The offset grblHAL already holds is this laser's (a migrated config):
    // taken as its own the first time the firmware is read.
    adoptFirmware: !!l.adoptFirmware
  };
}
function defaultLasers() { return LZ_DEFAULTS.map(function(d, i) { return normalizeLaser(d, i); }); }

// Settings from before the list (one laser: name, modes, moduleOut,
// moduleDelay, airOut, crossOff, mode, and the focus fields) become its
// first entry; the user's other laser (R2, or K60) follows unless the old
// one already had that name. Settings with a list pass through, normalized.
function migrateConfig(cfg) {
  cfg = Object.assign({}, cfg || {});
  if (Array.isArray(cfg.lasers) && cfg.lasers.length) {
    cfg.lasers = cfg.lasers.map(normalizeLaser);
  } else if (cfg.name != null || cfg.modes != null || cfg.crossOff || cfg.moduleOut || cfg.airOut) {
    var f = cfg.fields || {};
    var old = normalizeLaser({ id: 'laser0', name: cfg.name == null ? 'K60' : cfg.name, modes: cfg.modes, mode: cfg.mode,
      moduleOut: cfg.moduleOut, moduleDelay: cfg.moduleDelay, airOut: cfg.airOut, crossOff: cfg.crossOff,
      focusZ: f['lt-focus-z'], useFocus: f['lt-use-focus'], adoptFirmware: true }, 0);
    var match = LZ_DEFAULTS.filter(function(d) { return d.name.toLowerCase() === old.name.trim().toLowerCase(); })[0];
    if (match) { old.wavelength = match.wavelength; old.watts = match.watts; }
    cfg.lasers = [old].concat(defaultLasers().filter(function(d) { return d.name.toLowerCase() !== old.name.trim().toLowerCase(); }));
    if (cfg.mark && !cfg.mark.laser) cfg.mark.laser = old.id;
  } else {
    cfg.lasers = defaultLasers();
  }
  ['name', 'modes', 'mode', 'moduleOut', 'moduleDelay', 'airOut', 'crossOff'].forEach(function(k) { delete cfg[k]; });
  if (cfg.fields) { delete cfg.fields['lt-focus-z']; delete cfg.fields['lt-use-focus']; }
  if (!cfg.lasers.some(function(l) { return l.id === cfg.laserId; })) cfg.laserId = cfg.lasers[0].id;
  return cfg;
}
function selectedLaser(cfg) {
  return cfg.lasers.filter(function(l) { return l.id === cfg.laserId; })[0] || cfg.lasers[0];
}
// A new laser with an unused id and name.
function newLaser(lasers) {
  var n = lasers.length + 1, ids = lasers.map(function(l) { return l.id; }), names = lasers.map(function(l) { return l.name; });
  while (ids.indexOf('laser' + n) >= 0 || names.indexOf('Laser ' + n) >= 0) n++;
  return normalizeLaser({ id: 'laser' + n, name: 'Laser ' + n }, n);
}

// The spindle this laser runs on: its own choice if grblHAL has it, else
// the laser spindle Setup found (analyzeLaser's info.laser). null: none.
function laserSpindle(laser, info) {
  var list = (info && info.spindles) || [];
  if (laser && laser.spindle != null) {
    var s = list.filter(function(sp) { return sp.num === laser.spindle; })[0];
    if (s) return s;
  }
  return (info && info.laser) || null;
}
// Its power range in S: the laser's own, inside its spindle's (grblHAL clamps
// S to the spindle's max anyway). 0% is S0, 1-100% runs sMin to sMax.
function powerRange(laser, spindle) {
  var top = spindle && spindle.sMax ? spindle.sMax : 1000;
  var max = laser && laser.sMax != null && laser.sMax > 0 ? Math.min(laser.sMax, top) : top;
  var min = laser && laser.sMin != null && laser.sMin > 0 ? Math.min(laser.sMin, max) : 0;
  return { sMin: min, sMax: max };
}

// Whether grblHAL holds this laser's offset: 'loaded', 'other' (another
// offset is in $770/$771), 'unmeasured' (this laser has none yet), or
// 'unavailable' (no $770 in this firmware).
function lzNear(a, b) { return Math.abs(a - b) < 0.0015; }
function offsetState(laser, fwOffset) {
  if (!fwOffset || !fwOffset.available) return 'unavailable';
  if (!laser.offset) return 'unmeasured';
  return lzNear(laser.offset.x, fwOffset.x) && lzNear(laser.offset.y, fwOffset.y) ? 'loaded' : 'other';
}
// The laser whose offset grblHAL holds, if any (a zero offset is no one's).
function firmwareOwner(lasers, fwOffset) {
  if (!fwOffset || !fwOffset.available || (!fwOffset.x && !fwOffset.y)) return null;
  return lasers.filter(function(l) { return offsetState(l, fwOffset) === 'loaded'; })[0] || null;
}
// A migrated laser takes the offset grblHAL already has as its own (it was
// the only laser then). Returns true when something changed.
function adoptFirmwareOffset(lasers, fwOffset) {
  var changed = false;
  lasers.forEach(function(l) {
    if (!l.adoptFirmware || !fwOffset || !fwOffset.available) return;
    if (!l.offset && (fwOffset.x || fwOffset.y)) l.offset = { x: fwOffset.x, y: fwOffset.y };
    l.adoptFirmware = false;
    changed = true;
  });
  return changed;
}

// Checks for the picked laser, in Setup's shape: { id, level, title, detail }.
function laserChecks(laser, info) {
  var out = [], add = function(id, level, title, detail) { out.push({ id: id, level: level, title: title, detail: detail || '' }); };
  var sp = laserSpindle(laser, info), r = powerRange(laser, sp);
  if (laser.spindle != null && (!sp || sp.num !== laser.spindle)) {
    add('laserSpindle', 'bad', laser.name + ': spindle ' + laser.spindle + ' isn’t in grblHAL', 'Pick its spindle again in Your lasers.');
  } else if (sp && !sp.laserCapable) {
    add('laserSpindle', 'bad', laser.name + ': spindle ' + sp.num + ' (' + sp.type + ') can’t run a laser', 'Pick a PWM spindle without "Disable laser mode capability".');
  } else if (sp) {
    add('laserSpindle', 'ok', laser.name + ' on spindle ' + sp.num + ', power S' + r.sMin + '–' + r.sMax, 'M104 Q' + sp.num + ' selects it.');
  }
  var s = offsetState(laser, info && info.offset);
  if (s === 'loaded') add('laserOffset', 'ok', 'grblHAL holds ' + laser.name + '’s offset', '');
  else if (s === 'other') add('laserOffset', 'warn', 'grblHAL holds another laser’s offset', 'Load ' + laser.name + '’s (Offsets tab) before its programs: they would land off by the difference.');
  else if (s === 'unmeasured') add('laserOffset', 'warn', laser.name + '’s offset isn’t measured', 'Measure it on the Offsets tab.');
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LZ_DEFAULTS: LZ_DEFAULTS, normalizeLaser: normalizeLaser, defaultLasers: defaultLasers, migrateConfig: migrateConfig,
    selectedLaser: selectedLaser, newLaser: newLaser, laserSpindle: laserSpindle, powerRange: powerRange, offsetState: offsetState,
    firmwareOwner: firmwareOwner, adoptFirmwareOffset: adoptFirmwareOffset, laserChecks: laserChecks };
}
