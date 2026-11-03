// What the controller and ncSender say about the laser: read from
// GET /api/firmware (grblHAL's $ settings with their names and formats),
// GET /api/settings (ncSender's) and GET /api/server-state. Nothing here
// talks to the controller.

// The $ settings as { id: { value, format, name } }, from either shape
// /api/firmware gives (a list, or an object keyed by id).
function fwSettings(fw) {
  var out = {}, s = fw && fw.settings;
  if (!s) return out;
  var list = Array.isArray(s) ? s : Object.keys(s).map(function(k) { var v = s[k]; return v && v.id == null ? Object.assign({ id: k }, v) : v; });
  list.forEach(function(v) {
    if (!v || v.id == null) return;
    out[String(v.id)] = { value: v.value, format: String(v.format || ''), name: String(v.name || '') };
  });
  return out;
}
function lsNum(v) { var n = Number(v); return isFinite(n) ? n : null; }
function lsOptions(format) { return String(format || '').split(',').map(function(t) { return t.trim(); }); }
// A bit of a mask setting ($9, $709): its options are the format's names.
function lsMaskHas(setting, name) {
  if (!setting) return false;
  var i = lsOptions(setting.format).indexOf(name), v = lsNum(setting.value);
  return i >= 0 && v != null && (v & (1 << i)) !== 0;
}

// The spindles grblHAL has: spindle 0 is the default ($395, an index into
// its list of types); spindles 1-3 are $511-$513 (a list that starts with
// "Disabled"). M104 Q<num> selects one. A PWM spindle can drive a laser
// unless its options say "Disable laser mode capability" ($9 for PWM, $709
// for PWM2); its power range is $30/$31 or $730/$731.
var PWM_SETTINGS = { PWM: { options: '9', max: '30', min: '31' }, PWM2: { options: '709', max: '730', min: '731' } };
function spindleInfo(S, num_, type) {
  var p = PWM_SETTINGS[type], sp = { num: num_, type: type, laserCapable: false, sMax: null, sMin: null };
  if (p) {
    sp.laserCapable = !lsMaskHas(S[p.options], 'Disable laser mode capability');
    sp.sMax = lsNum(S[p.max] && S[p.max].value);
    sp.sMin = lsNum(S[p.min] && S[p.min].value);
  }
  return sp;
}
function analyzeLaser(fw) {
  var S = fwSettings(fw), spindles = [];
  var def = S['395'];
  if (def) spindles.push(spindleInfo(S, 0, lsOptions(def.format)[lsNum(def.value)] || 'unknown'));
  else if (S['30']) spindles.push(spindleInfo(S, 0, 'PWM'));
  ['511', '512', '513'].forEach(function(id, k) {
    var s = S[id];
    if (!s) return;
    var t = lsOptions(s.format)[lsNum(s.value)];
    if (t && t !== 'Disabled') spindles.push(spindleInfo(S, k + 1, t));
  });
  var laser = spindles.filter(function(sp) { return sp.num > 0 && sp.laserCapable; })[0] ||
    spindles.filter(function(sp) { return sp.laserCapable; })[0] || null;
  var off = { available: !!S['770'], x: lsNum(S['770'] && S['770'].value) || 0, y: lsNum(S['771'] && S['771'].value) || 0,
    updateG92: !!S['772'] && lsNum(S['772'].value) === 1 };
  return {
    firmware: fw && (fw.firmwareVersion || fw.version) || '',
    spindles: spindles,
    laser: laser,
    laserMode: !!S['32'] && lsNum(S['32'].value) === 1,
    offset: off,
    // grblHAL saves G92 at a program's end unless $384=1 (null: no $384).
    g92Saved: S['384'] ? lsNum(S['384'].value) !== 1 : null,
    reportInches: !!S['13'] && lsNum(S['13'].value) === 1
  };
}

// "x,y,z,a" as numbers.
function parseVec(s) {
  if (s && typeof s === 'object') return { x: lsNum(s.x), y: lsNum(s.y), z: lsNum(s.z) };
  var p = String(s || '').split(',').map(Number);
  return { x: isFinite(p[0]) ? p[0] : null, y: isFinite(p[1]) ? p[1] : null, z: isFinite(p[2]) ? p[2] : null };
}
// The work offset in use: its name (G54...), its index for G10 L2 P<n>
// (G54 = 1 ... G59 = 6, G59.1-G59.3 = 7-9), and its origin in machine
// coordinates (ncSender's g54...g59 strings), if known.
function activeWcs(ms) {
  var name = String(ms && ms.workspace || 'G54').toUpperCase();
  var list = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G59.1', 'G59.2', 'G59.3'];
  var i = list.indexOf(name);
  var origin = ms ? parseVec(ms[name.toLowerCase()]) : { x: null, y: null, z: null };
  return { name: name, index: i < 0 ? 1 : i + 1, origin: origin };
}
// Whether the laser spindle is selected, from the work coordinate offset:
// with $772 = 1 grblHAL adds the laser offset to G92 when it switches to the
// laser, so WCO - (the work offset's origin) = the laser offset. 'unknown'
// when there's no offset to see, or some other G92 is set.
function laserSelected(ms, offset) {
  if (!ms || !offset || (!offset.x && !offset.y) || !offset.updateG92) return 'unknown';
  var wco = parseVec(ms.WCO), o = activeWcs(ms).origin;
  if (wco.x == null || o.x == null) return 'unknown';
  var dx = wco.x - o.x, dy = wco.y - o.y, near = function(a, b) { return Math.abs(a - b) < 0.01; };
  if (near(dx, offset.x) && near(dy, offset.y)) return true;
  if (near(dx, 0) && near(dy, 0)) return false;
  return 'unknown';
}

// The G92 offset now (WCO - the work offset's origin), X Y, or null.
function g92Now(ms) {
  var wco = parseVec(ms && ms.WCO), o = activeWcs(ms).origin;
  if (wco.x == null || o.x == null) return null;
  return { x: Math.round((wco.x - o.x) * 1000) / 1000, y: Math.round((wco.y - o.y) * 1000) / 1000 };
}
// A G92 offset that isn't the laser's shift: it would move X0 Y0 for both.
function strayG92(ms, offset) {
  var g = g92Now(ms);
  if (!g || (Math.abs(g.x) < 0.01 && Math.abs(g.y) < 0.01)) return null;
  if (offset && offset.updateG92 && Math.abs(g.x - offset.x) < 0.01 && Math.abs(g.y - offset.y) < 0.01) return null;
  return g;
}

// The setup checklist: { id, level: 'ok' | 'warn' | 'bad' | 'info', title, detail }.
// ncs: ncSender's settings; ms: server-state's machineState.
function setupChecks(info, ncs, ms) {
  var out = [], add = function(id, level, title, detail) { out.push({ id: id, level: level, title: title, detail: detail || '' }); };
  ncs = ncs || {};
  ms = ms || {};
  if (!ms.connected) add('connected', 'bad', 'Not connected', 'Connect to the controller, then check again.');
  var L = info.laser;
  if (!L) {
    add('spindle', 'bad', 'No laser spindle', 'grblHAL needs a PWM spindle that can run a laser. For a laser beside a VFD spindle, that’s a second spindle: $511 = PWM2.');
  } else {
    add('spindle', L.num > 0 ? 'ok' : 'warn', 'Laser on spindle ' + L.num + ' (' + L.type + ')',
      (L.sMax ? 'Power S0–' + L.sMax + '. ' : '') + (L.num > 0 ? 'M104 Q' + L.num + ' selects it, M104 Q0 the spindle.'
        : 'It’s the default spindle, so grblHAL’s laser offset ($770/$771) never applies: it only moves for a non-default laser spindle.'));
  }
  add('laserMode', info.laserMode ? 'ok' : 'warn', 'Laser mode ' + (info.laserMode ? 'on ($32=1)' : 'off ($32=0)'),
    info.laserMode ? 'The laser turns off on rapids and between moves.' : 'Turn on Laser Mode in ncSender (Pro), or set $32=1, before a laser program: with it off, M4 keeps the laser on during rapids. Laser Toolbox won’t make a program until it’s on.');
  if ('laserSpindle' in ncs || 'showLaserMode' in ncs) {
    var same = !L || Number(ncs.laserSpindle) === L.num;
    add('ncsender', same ? 'ok' : 'warn', 'ncSender’s Laser Mode: spindle ' + ncs.laserSpindle + (ncs.laserMode ? ', on' : ', off'),
      same ? 'Matches the laser spindle.' : 'ncSender’s laser spindle (' + ncs.laserSpindle + ') isn’t the one grblHAL can run a laser on (' + L.num + '): change it in Laser Settings.');
  } else {
    add('ncsender', 'info', 'No Laser Mode switch in this ncSender', 'Laser Mode is in ncSender Pro. Here, switch between the spindle and the laser with Laser Toolbox’s buttons, and set $32.');
  }
  var o = info.offset;
  if (!o.available) {
    add('offset', 'bad', 'No laser offset in the firmware', 'This grblHAL has no $770/$771 (its spindle offset plugin, SPINDLE_OFFSET, isn’t built in). The offsets can’t be applied by the controller.');
  } else if (!o.x && !o.y) {
    add('offset', 'warn', 'Spindle-to-laser offset not set', '$770 and $771 are 0. Measure it on the Offsets tab.');
  } else {
    add('offset', 'ok', 'Spindle-to-laser offset X ' + o.x.toFixed(3) + ', Y ' + o.y.toFixed(3) + ' mm', 'Switching to the laser moves the head this far, so the laser lands where the spindle was.');
  }
  if (o.available) {
    add('g92', o.updateG92 ? 'ok' : 'warn', o.updateG92 ? 'Work coordinates stay put ($772=1)' : 'Work coordinates shift on a switch ($772=0)',
      o.updateG92 ? 'grblHAL keeps X0 Y0 where it was when it switches, so a program lands where the spindle’s would.'
        : 'With "Keep new position", work coordinates move by the offset when you switch to the laser. Set $772=1 (Update G92 on spindle change).');
  }
  if (o.available && (o.x || o.y) && o.updateG92 && info.g92Saved === true) {
    add('g92save', 'warn', 'G92 is kept through a power cycle ($384=0)', 'grblHAL saves G92 at the end of every program. Turned off with the laser selected, it comes back with the spindle selected but the laser\u2019s offset still in G92, so spindle jobs land off by it. Set $384=1 (Disable G92 persistence). If it happens, G92.1 clears it.');
  }
  if (info.reportInches) add('inches', 'warn', 'Positions reported in inches ($13=1)', 'ncSender and Laser Toolbox expect mm ($13=0); the offsets would be read wrong.');
  var stray = strayG92(ms, o);
  if (stray) add('strayg92', 'warn', 'A G92 offset is active (X ' + stray.x + ', Y ' + stray.y + ')', 'It moves X0 Y0 for the spindle and the laser. G92.1 clears it (the laser\u2019s own shift, with $772=1, is fine).');
  add('homed', ms.homed ? 'ok' : 'warn', ms.homed ? 'Homed' : 'Not homed', ms.homed ? '' : 'Home first: offsets and crosshair zeroing use machine coordinates.');
  var sel = laserSelected(ms, o);
  if (sel !== 'unknown') add('selected', 'info', sel ? 'The laser is selected' : 'The spindle is selected', '');
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fwSettings: fwSettings, analyzeLaser: analyzeLaser, parseVec: parseVec, activeWcs: activeWcs,
    laserSelected: laserSelected, setupChecks: setupChecks, g92Now: g92Now, strayG92: strayG92 };
}
