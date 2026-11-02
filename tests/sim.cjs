// A small G-code simulator for laser programs: what each move does with
// the laser. Enough of grbl/grblHAL in laser mode ($32=1): M4 is dynamic
// power, the laser fires only on G1/G2/G3 while M4 is on with S > 0; G0 is
// always dark.
function simulate(lines) {
  var st = { motion: null, m4: false, s: 0, f: 0, x: 0, y: 0, z: null, abs: true, paused: false },
    moves = [], events = [];
  lines.forEach(function(raw, n) {
    var line = raw.replace(/\(.*?\)/g, '').trim().toUpperCase();
    if (!line) return;
    var words = {}, g = [], m = [], re = /([A-Z])(-?[\d.]+)/g, w;
    while ((w = re.exec(line))) {
      if (w[1] === 'G') g.push(w[2]); else if (w[1] === 'M') m.push(w[2]); else words[w[1]] = +w[2];
    }
    var g53 = g.indexOf('53') >= 0;
    g.forEach(function(c) { if (c === '0' || c === '1' || c === '2' || c === '3') st.motion = c; if (c === '90') st.abs = true; if (c === '91') st.abs = false; });
    m.forEach(function(c) {
      if (c === '4') st.m4 = true; if (c === '3') { st.m4 = true; st.m3 = true; } if (c === '5') st.m4 = false;
      if (c === '0') events.push({ n: n, type: 'pause' });
      events.push({ n: n, type: 'M' + c, p: words.P });
    });
    if ('S' in words) st.s = words.S;
    if ('F' in words) st.f = words.F;
    if ('X' in words || 'Y' in words || 'Z' in words) {
      var to = { x: 'X' in words ? words.X : st.x, y: 'Y' in words ? words.Y : st.y, z: 'Z' in words ? words.Z : st.z };
      var fire = st.motion !== '0' && st.m4 && st.s > 0;
      moves.push({ n: n, from: { x: st.x, y: st.y, z: st.z }, to: to, motion: st.motion, fire: fire, s: st.s, f: st.f, g53: g53 });
      st.x = to.x; st.y = to.y; st.z = to.z;
    }
  });
  return { moves: moves, events: events, end: st };
}
module.exports = { simulate: simulate };
