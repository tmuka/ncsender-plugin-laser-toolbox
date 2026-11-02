# Changelog

## 0.1.0: First version

- Setup: the laser spindle, laser mode, grblHAL's laser offset ($770-$772) and ncSender's Laser Mode, read without sending anything; your laser's power modes, module power and air assist outputs.
- Offsets: measure the spindle-to-laser offset with a burned mark and the spindle's tip, store it in grblHAL; measure the crosshair's offset, set X0 Y0 with the crosshair, move the crosshair, laser or spindle over X0 Y0; switch between the spindle and the laser at Safe Z.
- Tests: material grid (power x feed, filled or outlined), focus ladder (Z), cut-through (feed x passes), each pausing for the power mode; presets.
