// The offsets between the spindle, the laser and its crosshair, in machine
// mm (raw MPos, as /api/server-state reports it). Every command starts with
// G21: ncSender leaves the controller in G20 for imperial users, and these
// numbers are mm (the dialog sends G20 back after them).
//
// grblHAL's spindle offset plugin (Plugins_spindle/offset.c) stores one
// offset in $770/$771: switching to the (non-default) laser spindle moves
// the head by +offset, switching back by -offset, so the laser lands where
// the spindle was. With $772 = 1 it adds the offset to G92 too, so work
// coordinates read the same and a program lands where the spindle's would.
//
// So with both centered over the same mark: offset = MPos(laser) - MPos(spindle).
// The crosshair's offset is ours (grblHAL has one slot): MPos(crosshair) - MPos(laser),
// both over the same mark.

function ofR3(v) { return Math.round(v * 1000) / 1000; }
function ofF3(v) { var r = ofR3(v); return (Object.is(r, -0) ? 0 : r).toFixed(3); }

// The spindle-to-laser offset for $770/$771, from the head's machine
// position with the laser over a mark and with the spindle's tip over it.
// Read both as raw MPos, so an offset grblHAL already applies doesn't matter.
function laserOffset(mposLaser, mposSpindle) {
  return { x: ofR3(mposLaser.x - mposSpindle.x), y: ofR3(mposLaser.y - mposSpindle.y) };
}
// The crosshair's offset from the beam: machine position with the
// crosshair's center over a mark, less that with the laser over it.
function crosshairOffset(mposCrosshair, mposLaser) {
  return { x: ofR3(mposCrosshair.x - mposLaser.x), y: ofR3(mposCrosshair.y - mposLaser.y) };
}
// The commands that store the spindle-to-laser offset in grblHAL.
function offsetCommands(off) {
  return ['$770=' + ofF3(off.x), '$771=' + ofF3(off.y), '$772=1'];
}

// Where the head would be (machine X Y) with the spindle's tip over the
// point the crosshair is on now, the laser over it, or the crosshair. These
// hold whichever spindle is selected: the offsets are where things sit on
// the head, and machine positions don't depend on G92.
function spindlePointFromCrosshair(mposCrosshair, crossOff, laserOff) {
  return { x: ofR3(mposCrosshair.x - crossOff.x - laserOff.x), y: ofR3(mposCrosshair.y - crossOff.y - laserOff.y) };
}
// Work zero (X0 Y0) on the point under the crosshair, as the spindle sees
// it: G10 L2 sets the work offset's origin in machine coordinates, whatever
// G92 holds, so it's right with the laser selected too (its G92 shift then
// puts the laser on the same point).
function zeroAtCrosshairCommand(mposCrosshair, crossOff, laserOff, wcsIndex) {
  var p = spindlePointFromCrosshair(mposCrosshair, crossOff, laserOff);
  return 'G21 G10 L2 P' + (wcsIndex || 1) + ' X' + ofF3(p.x) + ' Y' + ofF3(p.y);
}
// The machine move that puts the crosshair, the laser or the spindle's tip
// over work zero (wcsOrigin: the work offset's origin in machine X Y, the
// spindle's frame). which: 'crosshair' | 'laser' | 'spindle'.
function moveOverZero(wcsOrigin, crossOff, laserOff, which) {
  var x = wcsOrigin.x, y = wcsOrigin.y;
  if (which === 'laser' || which === 'crosshair') { x += laserOff.x; y += laserOff.y; }
  if (which === 'crosshair') { x += crossOff.x; y += crossOff.y; }
  return 'G21 G53 G0 X' + ofF3(x) + ' Y' + ofF3(y);
}

// Switching between the spindle and the laser: up to Safe Z first (machine
// Z, ncSender's safeZHeight, else 0), since grblHAL's offset move happens at
// the current height. Never select the laser when it's already selected:
// offset.c then takes the "switching back" branch and moves by -offset.
// safeZCommand: this ncSender runs $SAFEZ (safeZVersionOk), which lifts to
// Safe Z as it's set, in the current units, and is refused unhomed.
function switchCommands(toLaser, laserNum, safeZMachine, safeZCommand) {
  var z = typeof safeZMachine === 'number' && isFinite(safeZMachine) ? safeZMachine : 0;
  return [safeZCommand ? '$SAFEZ' : 'G21 G53 G0 Z' + ofF3(z), 'M104 Q' + (toLaser ? laserNum : 0)];
}

// ncSender's $SAFEZ raises Z to the Safe Z setting, in machine coordinates
// and in the program's own units. It arrived in ncSender 2.0.228 and
// ncSender Pro 2.0.326; older versions pass it on to the controller, which
// rejects it. edition: /api/app-info's; version: the running version
// (/api/updates/check's currentVersion). When in doubt, the answer is no.
function safeZVersionOk(edition, version) {
  var v = String(version || '');
  if (v === 'dev' || /-dev\b/.test(v)) return true;
  var m = /^v?(\d+)\.(\d+)\.(\d+)(-.*)?$/.exec(v.trim());
  if (!m) return false;
  var min = edition === 'pro' ? [2, 0, 326] : [2, 0, 228];
  for (var i = 0; i < 3; i++) {
    var d = Number(m[i + 1]) - min[i];
    if (d) return d > 0;
  }
  return !m[4]; // a beta of the first version that has it may not
}

// What grblHAL does on a switch, for the tests: the head's new machine
// position, G92, and whether the laser is selected, as offset.c has it.
// Selecting the laser: +offset if the laser wasn't selected. Any selection
// while the laser is selected (even the laser again): -offset, and grblHAL
// then counts the laser as not selected. Nothing at all with no offset.
function simulateSwitch(state, toLaser, off, updateG92) {
  var s = { mpos: Object.assign({}, state.mpos), g92: Object.assign({}, state.g92), laser: !!state.laser };
  if (!off.x && !off.y) { s.laser = false; return s; }
  var k = 0;
  if (toLaser && !s.laser) { k = 1; s.laser = true; }
  else if (s.laser) { k = -1; s.laser = false; }
  s.mpos.x += k * off.x; s.mpos.y += k * off.y;
  if (updateG92) { s.g92.x += k * off.x; s.g92.y += k * off.y; }
  return s;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { laserOffset: laserOffset, crosshairOffset: crosshairOffset, offsetCommands: offsetCommands,
    spindlePointFromCrosshair: spindlePointFromCrosshair, zeroAtCrosshairCommand: zeroAtCrosshairCommand,
    moveOverZero: moveOverZero, switchCommands: switchCommands, simulateSwitch: simulateSwitch,
    safeZVersionOk: safeZVersionOk };
}
