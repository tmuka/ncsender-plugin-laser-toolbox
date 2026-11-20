# Laser Toolbox

Laser basics for an [ncSender](https://github.com/siganberg/ncSender) router with a laser module beside the spindle, on grblHAL: check the laser setup, measure the spindle-to-laser offset once and store it in grblHAL, measure the crosshair (positioning laser) offset and zero on the stock with it, and run material, focus and cut-through tests to find power, feed and focus.

Built for a LaserTree K60 and a 2 W infrared R2 beside a VFD spindle (SuperLongBoard Ext, grblHAL 1.1f), but nothing in it is specific to that module.

## Setup

The **Setup** tab reads what grblHAL and ncSender have (without sending anything to the controller) and says what's missing:

- **A laser spindle:** a PWM spindle that can run a laser. Beside a VFD spindle that's a second spindle (`$511` = PWM2); `M104 Q1` selects it, `M104 Q0` the VFD. Its power range comes from `$730` (PWM2) or `$30` (PWM).
- **Laser mode** (`$32=1`): with it off, `M4` keeps the beam on during rapids. ncSender Pro's Laser Mode switch sets it; Laser Toolbox won't make a program until it's on.
- **The offset:** grblHAL's spindle offset plugin keeps the laser's offset from the spindle in `$770` (X) and `$771` (Y). `$772=1` (Update G92 on spindle change) keeps X0 Y0 where it was when you switch, so a laser program lands where the same program would with the spindle.
- **Your lasers:** a list you add to, name, edit and remove from; pick one in the sidebar's **Laser** menu, and Setup edits it while Offsets and Tests use it. It starts with a K60 (455 nm blue diode) and an R2 (1064 nm infrared). Each has its own **spindle** (`M104 Q<n>`; two lasers can share one output when only one is plugged in), its own **power range** (S from / to S: 0% is `S0`, 1-100% spans the range, never above the spindle's maximum), its own offsets and focus Z, its name, its **power modes** (switched by hand on the module, like the K60's 20 / 40 / 60 W: every program names the mode to set, in its header and when it loads; no `M0` pause, since ncSender shows no prompt for one), how its **power** is switched (by hand, or a relay on Mist, Flood or an aux output: then the crosshair can be switched too), and the **air assist** output.

## Offsets

Each laser has its own offsets, measured with that laser picked. grblHAL holds one offset at a time (`$770`/`$771`): the Offsets tab says whose it holds and **Load the R2's offset into grblHAL** swaps it in (with the spindle selected, since grblHAL takes the old amount back out of G92 when it switches away). Programs and **Switch to the laser** refuse while grblHAL holds another laser's offset.

**Spindle to laser** (once, and again if the bracket moves):

1. Select the laser (ncSender's Laser Mode, or **Switch to the laser**).
2. Focus it over taped scrap and **Burn a mark here**: a small cross centered where the laser is. Laser Toolbox remembers that machine position.
3. **Switch to the spindle** (it goes to Safe Z first: grblHAL's offset move happens at the current height) and put in a V-bit or a pointed tool.
4. Jog the tip onto the cross's center and press **The tip is on the mark**.
5. **Store it in grblHAL** writes `$770`, `$771` and `$772=1`.
6. Check it: burn a cross on X0 Y0 with the laser, then send the spindle's tip to X0 Y0.

The offset is the machine position with the laser over the mark less that with the spindle's tip over it: switching to the laser moves the head by +offset, so the laser lands where the spindle was.

**Crosshair:** with the module powered and the beam off, jog the crosshair's center onto a burned mark and press **The crosshair is on the mark**. Then **Set X0 Y0 at the crosshair** puts work zero on whatever the crosshair points at (a stock corner, say) for the spindle and the laser alike, without firing; **Crosshair to X0 Y0** shows where a zero is.

## Tests

X0 Y0 is the front-left corner of every test. Each program names the power mode to set, fires only on cutting moves under `M4`, moves Z only with the laser off, and turns air assist and the module on and off if they're on outputs. Labels are burned in a single-stroke font.

- **Material grid:** power across, feed up the side; cells filled (engraving, at a line interval) or outlined (scoring).
- **Focus ladder:** the same line at a row of heights, each labelled with its Z. The thinnest line is in focus.
- **Cut-through:** at one power, rows of feed and columns of passes (optionally lower each pass). The first cut through is the setting.
- **Presets:** save the best cell (laser, material, power, feed, passes, focus Z, power mode). Spoilboard Toolbox can read them for its laser grid and labels.

## Programs never select a spindle

grblHAL's offset plugin treats selecting the laser while it's already selected as switching away, and moves the head back by the offset. So Laser Toolbox's programs leave the spindle alone: select the laser first, with ncSender's Laser Mode or the Switch buttons, which won't select it twice.

## Safety

Wear glasses rated for your laser's wavelength, never leave it running unattended, and keep an extinguisher near.

- A laser program needs the laser selected (with the spindle selected, `M4` would run the spindle). Laser Toolbox sees which is selected from the G92 shift (with an offset and `$772=1`) and asks when it can't tell; it refuses while a job runs.
- Every rapid carries `S0`, so it stays dark even if a program runs with laser mode off.
- grblHAL saves G92 at the end of a program unless `$384=1`: turned off with the laser selected, it comes back with the spindle selected and the laser's offset still in G92. Setup offers `$384=1`; `G92.1` clears it.
- Commands are sent in mm (`G21`), and `G20` follows for imperial users. Every button that sends a command shows exactly what it sends and waits for **Send**; it only sends while the machine is idle.

## Development

```
npm test        # the libs' tests, and a check that config.html carries the current lib/*.cjs
npm run inline  # copy lib/*.cjs into config.html
npm run build   # dist/com.tmuka.laser-toolbox_v<version>.zip
```

`lib/unit-input.cjs` is QuickCut's and `lib/stroke-font.cjs` Spoilboard Toolbox's single-stroke font: keep them in step.

## License

GPL-3.0. See `LICENSE`.
