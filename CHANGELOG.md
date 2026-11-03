# Changelog

## 0.1.0: First version

- Safety (from an independent review): laser programs need the laser selected (seen from the G92 shift, or asked), refuse while a job runs, and keep rapids dark with S0; switching can't be sent twice; the offset and $772 change only with the spindle selected; commands are sent in mm (G21) with G20 after for imperial users; a check for G92 kept through a power cycle ($384); the mark program keeps the module on; the power-mode reminder stays on screen.

- Setup: the laser spindle, laser mode, grblHAL's laser offset ($770-$772) and ncSender's Laser Mode, read without sending anything; your laser's power modes, module power and air assist outputs.
- Offsets: measure the spindle-to-laser offset with a burned mark and the spindle's tip, store it in grblHAL; measure the crosshair's offset, set X0 Y0 with the crosshair, move the crosshair, laser or spindle over X0 Y0; switch between the spindle and the laser at Safe Z.
- Tests: material grid (power x feed, filled or outlined), focus ladder (Z), cut-through (feed x passes), each naming the power mode to set; presets.
