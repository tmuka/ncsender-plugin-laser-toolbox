# Changelog

## 0.1.0: First version

- New icon: the laser burning a test grid.
- Switching between the spindle and the laser, and Go to X0 Y0, lift with ncSender's `$SAFEZ` on ncSender 2.0.228 or Pro 2.0.326 and later, so the lift follows Safe Z as it's set and leaves the units alone. If ncSender refuses it (the machine isn't homed), nothing after it is sent. Older versions get `G21 G53 G0 Z<Safe Z>` as before.
- More than one laser: a list in Setup (Your lasers) to add, name, edit and remove lasers, and a Laser menu in the sidebar to pick one. Starts with the K60 (455 nm blue diode, 20/40/60 W) and the R2 (1064 nm infrared, 2 W).
- Each laser keeps its own spindle (M104 Q), power range (S from / to S: 0% stays S0, 1-100% spans the range), offset from the spindle, crosshair offset, focus Z, power modes, module power and air assist outputs. Programs, presets and the Offsets tab use the picked laser.
- grblHAL holds one offset ($770/$771): the Offsets tab says whose it holds and loads the picked laser's (only with the spindle selected). Programs and Switch to the laser refuse while it holds another laser's offset.
- Settings from the 0.1.0 test builds move into the first laser, which takes the offset grblHAL already has; the other default laser is added beside it.
- Program comments are printable ASCII without ( ) ! ? ~ and 79 characters at most; long headers wrap over several lines.

- Safety (from an independent review): laser programs need the laser selected (seen from the G92 shift, or asked), refuse while a job runs, and keep rapids dark with S0; switching can't be sent twice; the offset and $772 change only with the spindle selected; commands are sent in mm (G21) with G20 after for imperial users; a check for G92 kept through a power cycle ($384); the mark program keeps the module on; the power-mode reminder stays on screen.

- Setup: the laser spindle, laser mode, grblHAL's laser offset ($770-$772) and ncSender's Laser Mode, read without sending anything; your laser's power modes, module power and air assist outputs.
- Offsets: measure the spindle-to-laser offset with a burned mark and the spindle's tip, store it in grblHAL; measure the crosshair's offset, set X0 Y0 with the crosshair, move the crosshair, laser or spindle over X0 Y0; switch between the spindle and the laser at Safe Z.
- Tests: material grid (power x feed, filled or outlined), focus ladder (Z), cut-through (feed x passes), each naming the power mode to set; presets.
