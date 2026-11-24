# Laser Toolbox: notes for working on it

An ncSender plugin (`com.tmuka.laser-toolbox`) for a laser module beside the spindle on grblHAL: setup check,
spindle-to-laser offset (grblHAL `$770/$771/$772`), crosshair offset and zeroing, material / focus / cut-through
tests. `docs/PLAN.md` is the plan; README.md the user guide. GPL-3.0.

## Layout

| File | What |
| --- | --- |
| `config.html` | The dialog: markup, styles, the UI script. ncSender runs it inline, so `lib/*.cjs` are copied into it between `/* BEGIN lib/x.cjs */` markers (they share one scope: prefix helper names per lib). |
| `lib/laser-setup.cjs` | Reads `/api/firmware` (spindles `$395`, `$511-$513`, PWM options `$9`/`$709`, S ranges, `$32`, `$770-$772`), the checklist, which spindle is selected (from WCO − work offset = laser offset when `$772=1`). |
| `lib/offsets.cjs` | The offset math and commands; `simulateSwitch` models grblHAL's `Plugins_spindle/offset.c`. |
| `lib/lasers.cjs` | The laser list (`cfg.lasers`, `cfg.laserId`): defaults (K60, R2), migrating 0.1.0's single laser, each laser's spindle, power range and offset, whose offset grblHAL holds (`offsetState`, `firmwareOwner`). |
| `lib/laser-tests.cjs` | The programs: material grid, focus ladder, cut-through, calibration mark (G53), check cross. |
| `lib/unit-input.cjs`, `lib/stroke-font.cjs` | Copied from QuickCut and Spoilboard Toolbox; keep in step. |

## grblHAL's offset plugin (what the code relies on)

`offset.c`: on selecting a non-default, laser-capable spindle when the laser isn't selected, the head rapids by
+($770, $771) at the current Z; any selection while the laser is selected (even the laser again) rapids it back by
−offset; with `$772=1` the same amounts go into G92. Nothing happens with a zero offset. So: offset = MPos(laser over a
mark) − MPos(spindle over it); go to Safe Z before switching (`$SAFEZ` where `safeZVersionOk` says ncSender has it: 2.0.228 on, Pro 2.0.326 on; `sendCommand` takes its "skipped" refusal as a failure); programs never send `M104`.

## Testing

`npm test` (inline check, a G-code simulator in `tests/sim.cjs`: no firing on rapids, Z only on rapids, the power mode
named and no M0 (ncSender shows no prompt for it), no M104; the offset math against offset.c; the setup reading with the Pi's firmware in
`tests/fixture-firmware.json`). UI: the test kit (`~/Documents/projects/ncsender-plugin-testkit`),
`openLocal({ config: 'config.html', pluginId: 'com.tmuka.laser-toolbox', settings: {} })`, `audit(page,
'.lt-tab:not([hidden])', '.lt-field')`; pass `api` to mock the machine for the calibration flow.

**Releasing:** as Gears: bump `version` in manifest.json and package.json, add `## <version>` to CHANGELOG.md, commit,
tag `v<version>`, push the tag; `.github/workflows/release.yml` tests, builds and publishes.
