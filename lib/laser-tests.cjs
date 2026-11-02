// Laser test programs: a material grid (power x feed), a focus ladder (Z),
// a cut-through grid (feed x passes), the calibration mark and the check
// cross. mm throughout; every program is G21 G90.
//
// Each program fires only on G1 moves under M4 (dynamic power: off while
// not moving, and with grblHAL's laser mode, $32=1, off on G0 rapids too),
// moves Z only on G0 rapids, and pauses with M0 before the first burn when
// the laser has a power mode to set by hand. It never selects a spindle:
// selecting the laser while it's selected makes grblHAL's offset plugin move
// the head back (see offsets.cjs), so that's the operator's (or the Switch
// buttons') job. needs: textStrokes/textWidth (stroke-font.cjs).

function ltF3(v) { var r = Math.round(v * 1000) / 1000; return (Object.is(r, -0) ? 0 : r).toFixed(3); }
function ltFmt(v) { var r = Math.round(v * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); }
function ltComment(t) { return '(' + String(t).replace(/[()]/g, '') + ')'; }
// n values from a to b, evenly spaced, rounded to `step`.
function ltRange(a, b, n, step) {
  n = Math.max(1, Math.floor(n));
  step = step || 1;
  var out = [];
  for (var i = 0; i < n; i++) {
    var v = n === 1 ? a : a + (b - a) * i / (n - 1);
    out.push(Math.round(v / step) * step);
  }
  return out;
}
// S for a power in % of the laser spindle's maximum.
function ltS(pct, sMax) { return Math.round(Math.max(0, Math.min(100, pct)) / 100 * sMax); }

// An output: 'M7' | 'M8' | 'aux:<n>' | '' (none). On and off lines.
function ltOutput(out, on) {
  if (!out) return null;
  if (out === 'M7' || out === 'M8') return on ? out : 'M9';
  var m = /^aux:(\d+)$/.exec(out);
  return m ? (on ? 'M64 P' : 'M65 P') + m[1] : null;
}

// The start of every program. o: { title, laserName, powerMode, sMax,
// module: { out, delay }, air: out, focusZ (work Z, or null to stay), lines: notes }.
function ltStart(o) {
  var L = [ltComment('Laser Toolbox: ' + o.title)];
  L.push(ltComment((o.laserName || 'Laser') + (o.powerMode ? ', power mode ' + o.powerMode : '') + ', S0-' + o.sMax + ' = 0-100%'));
  (o.notes || []).forEach(function(n) { L.push(ltComment(n)); });
  L.push(ltComment('Select the laser and turn on Laser Mode ($32=1) before running this'));
  L.push('G21 G90 G17');
  var mod = o.module && ltOutput(o.module.out, true);
  if (mod) {
    L.push(ltComment('Laser module power on'));
    L.push(mod);
    if (o.module.delay > 0) L.push('G4 P' + ltFmt(o.module.delay));
  }
  if (o.powerMode) {
    L.push(ltComment('Set the ' + (o.laserName || 'laser') + ' to its ' + o.powerMode + ' power mode, then press Cycle Start'));
    L.push('M0');
  }
  if (typeof o.focusZ === 'number' && isFinite(o.focusZ)) L.push('G0 Z' + ltF3(o.focusZ));
  L.push('M4 S0');
  var air = ltOutput(o.air, true);
  if (air && air !== mod) L.push(air);
  return L;
}
function ltEnd(o, L) {
  L.push('M5 S0');
  var air = ltOutput(o.air, false), mod = o.module && !o.keepModuleOn ? ltOutput(o.module.out, false) : null;
  if (air) L.push(air);
  if (mod && mod !== air) L.push(mod);
  L.push('M30');
  return L;
}
// Burns groups of paths: each group { comment, power (%), feed, z (work Z or
// undefined), paths: [[{x,y}...]] }. G0 to each path's start, then G1.
// machine: prefix every move with G53 (the calibration mark).
function ltBurn(o, L, groups, machine) {
  var pre = machine ? 'G53 ' : '', z = null;
  groups.forEach(function(g) {
    if (g.comment) L.push(ltComment(g.comment));
    var s = ltS(g.power, o.sMax), f = Math.round(g.feed);
    if (typeof g.z === 'number' && g.z !== z) { L.push('G0 Z' + ltF3(g.z)); z = g.z; }
    g.paths.forEach(function(p) {
      if (p.length < 2) return;
      L.push(pre + 'G0 X' + ltF3(p[0].x) + ' Y' + ltF3(p[0].y));
      for (var i = 1; i < p.length; i++) {
        L.push(pre + 'G1 X' + ltF3(p[i].x) + ' Y' + ltF3(p[i].y) + (i === 1 ? ' F' + f + ' S' + s : ''));
      }
    });
  });
  return L;
}
// Minutes the burning takes (cutting moves at their feed, rapids at `rapid`).
function ltMinutes(groups, rapid) {
  var min = 0, at = null;
  groups.forEach(function(g) {
    g.paths.forEach(function(p) {
      if (at) min += Math.hypot(p[0].x - at.x, p[0].y - at.y) / (rapid || 5000);
      for (var i = 1; i < p.length; i++) min += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) / Math.max(1, g.feed);
      at = p[p.length - 1];
    });
  });
  return min;
}
function ltBox(groups) {
  var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  groups.forEach(function(g) { g.paths.forEach(function(p) { p.forEach(function(q) {
    b.x0 = Math.min(b.x0, q.x); b.y0 = Math.min(b.y0, q.y); b.x1 = Math.max(b.x1, q.x); b.y1 = Math.max(b.y1, q.y);
  }); }); });
  return b;
}
function ltText(text, x, y, h) { return textStrokes(text, x, y, h); }
// A filled square: lines along X, `interval` apart, back and forth.
function ltHatch(x, y, w, h, interval) {
  var out = [], n = Math.max(1, Math.floor(h / interval + 1e-9) + 1), d = n > 1 ? h / (n - 1) : 0;
  for (var i = 0; i < n; i++) {
    var yy = y + i * d;
    out.push(i % 2 ? [{ x: x + w, y: yy }, { x: x, y: yy }] : [{ x: x, y: yy }, { x: x + w, y: yy }]);
  }
  return out;
}
function ltSquare(x, y, w, h) { return [[{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }, { x: x, y: y }]]; }

// Material grid: rows of feeds (slowest at the front) x columns of power
// (lowest on the left), each cell filled (engraving) or outlined (scoring).
// p: { powers: [%], feeds: [mm/min], cell, gap, mode: 'fill' | 'outline',
// interval, textH, labelPower, labelFeed }. X0 Y0 at the front-left.
function materialGrid(o, p) {
  var h = p.textH, pad = 2;
  var left = Math.max.apply(null, p.feeds.map(function(f) { return textWidth(String(f), h); })) + pad + 1;
  var cells = [], groups = [];
  p.feeds.forEach(function(feed, r) {
    p.powers.forEach(function(pw, c) {
      var x = left + c * (p.cell + p.gap), y = r * (p.cell + p.gap);
      cells.push({ row: r, col: c, power: pw, feed: feed, x: x, y: y, w: p.cell, h: p.cell });
      groups.push({ comment: 'Cell ' + (r + 1) + '-' + (c + 1) + ': ' + pw + '% at F' + feed, power: pw, feed: feed,
        paths: p.mode === 'outline' ? ltSquare(x, y, p.cell, p.cell) : ltHatch(x, y, p.cell, p.cell, p.interval) });
    });
  });
  var labels = [], top = p.feeds.length * (p.cell + p.gap) - p.gap + pad + 1;
  p.feeds.forEach(function(feed, r) {
    var t = String(feed), y = r * (p.cell + p.gap) + p.cell / 2 - h / 2;
    labels = labels.concat(ltText(t, left - pad - 1 - textWidth(t, h), y, h));
  });
  // Power labels as tall as fits their column (100% is 3.7 characters wide).
  var widest = Math.max.apply(null, p.powers.map(function(pw) { return textWidth(pw + '%', 1); }));
  var hp = Math.min(h, (p.cell + p.gap - 1) / widest);
  p.powers.forEach(function(pw, c) {
    var t = pw + '%', x = left + c * (p.cell + p.gap) + p.cell / 2 - textWidth(t, hp) / 2;
    labels = labels.concat(ltText(t, x, top, hp));
  });
  labels = labels.concat(ltText('F', 0, top, h));
  groups.push({ comment: 'Labels: feed (mm/min) on the left, power on top', power: p.labelPower, feed: p.labelFeed, paths: labels, label: true });
  var L = ltStart(Object.assign({}, o, { title: 'material grid, ' + p.powers.length + ' powers x ' + p.feeds.length + ' feeds, ' + (p.mode === 'outline' ? 'outlined' : 'filled at ' + ltFmt(p.interval) + ' mm') + ' cells of ' + ltFmt(p.cell) + ' mm' }));
  ltBurn(o, L, groups);
  return { lines: ltEnd(o, L), groups: groups, cells: cells, box: ltBox(groups), minutes: ltMinutes(groups, o.rapid) };
}

// Focus ladder: a line along X at each Z, labelled with its Z; the thinnest
// line is in focus. p: { zs: [work Z], length, spacing, power, feed, textH,
// labelPower, labelFeed, labelZ }. The lines run front to back in the order
// of zs; Z moves happen between lines, with the laser off.
function focusLadder(o, p) {
  var h = p.textH, pad = 2, groups = [], rows = [];
  var left = Math.max.apply(null, p.zs.map(function(z) { return textWidth('Z' + ltFmt(z), h); })) + pad + 1;
  p.zs.forEach(function(z, i) {
    var y = i * p.spacing + h / 2;
    rows.push({ index: i, z: z, y: y });
    groups.push({ comment: 'Line ' + (i + 1) + ' at Z' + ltFmt(z), power: p.power, feed: p.feed, z: z,
      paths: [[{ x: left, y: y }, { x: left + p.length, y: y }]] });
  });
  var labels = [];
  p.zs.forEach(function(z, i) { labels = labels.concat(ltText('Z' + ltFmt(z), 0, i * p.spacing, h)); });
  groups.push({ comment: 'Labels: each line’s Z', power: p.labelPower, feed: p.labelFeed, z: p.labelZ, paths: labels, label: true });
  var L = ltStart(Object.assign({}, o, { focusZ: null, title: 'focus ladder, ' + p.zs.length + ' lines from Z' + ltFmt(p.zs[0]) + ' to Z' + ltFmt(p.zs[p.zs.length - 1]) + ' at ' + p.power + '% and F' + p.feed,
    notes: (o.notes || []).concat(['Z is work Z: keep Z0 where you will keep it for real jobs']) }));
  ltBurn(o, L, groups);
  return { lines: ltEnd(o, L), groups: groups, rows: rows, box: ltBox(groups), minutes: ltMinutes(groups, o.rapid) };
}

// Cut-through grid: rows of feeds x columns of passes (1..N), each cell a
// short cut along X run that many times, back and forth, at one power. With
// zStep, each pass after the first starts that much lower (a G0 down at the
// line's end, laser off). p: { power, feeds, passes, length, gapX, gapY,
// zTop (work Z of the first pass, or null), zStep, textH, labelPower, labelFeed }.
function cutThrough(o, p) {
  var h = p.textH, pad = 2, groups = [], cells = [];
  var left = Math.max.apply(null, p.feeds.map(function(f) { return textWidth(String(f), h); })) + pad + 1;
  var zTop = typeof p.zTop === 'number' && isFinite(p.zTop) ? p.zTop : null;
  p.feeds.forEach(function(feed, r) {
    for (var c = 0; c < p.passes; c++) {
      var n = c + 1, x = left + c * (p.length + p.gapX), y = r * p.gapY + h / 2;
      cells.push({ row: r, col: c, feed: feed, passes: n, x: x, y: y, w: p.length });
      for (var k = 0; k < n; k++) {
        var a = { x: k % 2 ? x + p.length : x, y: y }, b = { x: k % 2 ? x : x + p.length, y: y };
        var g = { comment: k === 0 ? 'Cut ' + (r + 1) + '-' + n + ': ' + n + ' pass' + (n > 1 ? 'es' : '') + ' at F' + feed : null,
          power: p.power, feed: feed, paths: [[a, b]] };
        if (zTop != null) g.z = zTop - k * (p.zStep || 0);
        groups.push(g);
      }
    }
  });
  var labels = [], top = (p.feeds.length - 1) * p.gapY + h + pad + 1;
  p.feeds.forEach(function(feed, r) {
    var t = String(feed);
    labels = labels.concat(ltText(t, left - pad - 1 - textWidth(t, h), r * p.gapY, h));
  });
  for (var c = 0; c < p.passes; c++) {
    var t = String(c + 1), x = left + c * (p.length + p.gapX) + p.length / 2 - textWidth(t, h) / 2;
    labels = labels.concat(ltText(t, x, top, h));
  }
  labels = labels.concat(ltText('F', 0, top, h));
  groups.push({ comment: 'Labels: feed (mm/min) on the left, passes on top', power: p.labelPower, feed: p.labelFeed, z: zTop == null ? undefined : zTop, paths: labels, label: true });
  var L = ltStart(Object.assign({}, o, { title: 'cut-through test at ' + p.power + '%, ' + p.feeds.length + ' feeds x 1-' + p.passes + ' passes' + (p.zStep ? ', ' + ltFmt(p.zStep) + ' mm lower each pass' : '') }));
  ltBurn(o, L, groups);
  return { lines: ltEnd(o, L), groups: groups, cells: cells, box: ltBox(groups), minutes: ltMinutes(groups, o.rapid) };
}

// The calibration mark: a cross of `size` mm centered on the head's machine
// position now (G53 moves, so work offsets and G92 don't matter), the head
// left back over its center. The module stays powered for the crosshair.
function calibrationMark(o, p) {
  var a = p.size / 2, cx = p.x, cy = p.y;
  var groups = [{ comment: 'A cross centered where the laser is now', power: p.power, feed: p.feed,
    paths: [[{ x: cx - a, y: cy }, { x: cx + a, y: cy }], [{ x: cx, y: cy - a }, { x: cx, y: cy + a }]] }];
  var oo = Object.assign({}, o, { focusZ: null, keepModuleOn: true, title: 'calibration mark, a ' + ltFmt(p.size) + ' mm cross at machine X' + ltF3(cx) + ' Y' + ltF3(cy) });
  var L = ltBurn(o, ltStart(oo), groups, true);
  L.push('G53 G0 X' + ltF3(cx) + ' Y' + ltF3(cy));
  return { lines: ltEnd(oo, L), groups: groups, box: ltBox(groups) };
}
// The check: a cross on work X0 Y0, burned with the laser. With the offset
// right, the spindle's tip over X0 Y0 sits on its center.
function checkCross(o, p) {
  var a = p.size / 2;
  var groups = [{ comment: 'A cross on X0 Y0', power: p.power, feed: p.feed,
    paths: [[{ x: -a, y: 0 }, { x: a, y: 0 }], [{ x: 0, y: -a }, { x: 0, y: a }]] }];
  var oo = Object.assign({}, o, { title: 'offset check, a ' + ltFmt(p.size) + ' mm cross on X0 Y0' });
  var L = ltBurn(o, ltStart(oo), groups);
  L.push('G0 X0 Y0');
  return { lines: ltEnd(oo, L), groups: groups, box: ltBox(groups) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ltRange: ltRange, ltS: ltS, ltOutput: ltOutput, materialGrid: materialGrid, focusLadder: focusLadder,
    cutThrough: cutThrough, calibrationMark: calibrationMark, checkCross: checkCross };
}
