# Laser Toolbox: a new ncSender plugin for laser basics

## Context

The user runs a LaserTree K60 on a bracket beside the spindle of a grblHAL router (SuperLongBoard Ext,
grblHAL 1.1f 20261015). Laser marking in Spoilboard Toolbox (grid lines, labels, laser test) needs the
spindle-to-laser offset configured reliably, and laser users without spoilboard grids want the basics too:
offsets, a crosshair (positioning laser) offset, and tests that find power, feed and focus. It becomes its
own plugin, **Laser Toolbox** (`com.tmuka.laser-toolbox`), public, GPL-3.0, the user's own (like Gears).

### What exists today (researched)

- **grblHAL has the spindle-to-laser offset; it isn't set.** The Pi's firmware has `$770` Laser X offset,
  `$771` Laser Y offset and `$772` Laser offset options (0 = Keep new position, 1 = Update G92 on spindle
  change), all 0 now. From grblHAL `Plugins_spindle/offset.c`: on switching to a non-default, laser-capable
  spindle (`M104 Q1`), the firmware **rapids MPos += ($770, $771)** at the current Z so the laser lands where
  the spindle was; switching back rapids it back. With `$772=1` it also adds the offset to G92, so work
  coordinates read the same and a program in normal work coordinates lands right. One offset only.
- **The Pi's spindles:** spindle 0 = Huanyang VFD (default, `$395`), spindle 1 = PWM2 (`$511`), power
  S0–1000 (`$730`), 2 kHz, laser capability on. `$32` = 0 now. Event outputs 1–4 follow spindle enable and
  flood; none is "Laser enable".
- **ncSender:** Community has no laser code (scripts get `context.laserMode`, always false). Pro's Laser Mode
  (Settings › Auxiliary I/O) sets `$32`, has a test fire (M3 at 1%), a laser-head visualizer, and settings
  `laserSpindle` (Pi: 1) and `laserZOffset` (Pi: 30, undocumented). **No XY offset, no pointer support**;
  tool-table X/Y offsets only move where a tool is measured. Unknown: whether Pro's toggle sends `M104 Q1`.
- **Nothing anywhere** (grblHAL, ncSender, the plugins) handles a crosshair-to-beam offset.
- **Spoilboard Toolbox** (`~/Documents/projects/ncsender-plugin-spoilboard-toolbox`): laser Grid lines,
  Laser test (power × feed crosses, `laserTestPattern` config.html:3283), Labels (single-stroke font :3075,
  `engraveProgram` :3331); `M4 S`, no Z moves, no XY offset; requires `$32=1`; header stop lines refuse to run
  when **G92 is active** (:2862-2866), which conflicts with `$772=1`.

### Decisions (from the user)

- K60 on a bracket beside the spindle: one fixed XY offset to calibrate.
- The offset lives in **grblHAL `$770/$771` with `$772=1`** (Update G92), so every sender and plugin gets it.
- The crosshair shows whenever the module has DC power and goes dark while the beam fires. Today the module is
  switched by hand; it could be a relay on M7/M8 or an aux output. So: a crosshair **offset**, plus optional
  **module power control** through a chosen output.
- v1 has all four parts: setup check + offsets, material test grid, focus test, cut-through test.

## Approach

New repo `~/Documents/projects/ncsender-plugin-laser-toolbox` (GitHub `tmuka/ncsender-plugin-laser-toolbox`),
built like **Gears** (`~/Documents/projects/ncsender-plugin-gears`): `lib/*.cjs` (pure code, tested by
`node --test`) inlined into `config.html` by `.scripts/inline.cjs` (`--check` fails on a stale copy),
`.scripts/build.sh` zip, tag-driven `release.yml`, public `CLAUDE.md` + local `.claude/CLAUDE.md`, manifest
`platforms: ["v2","pro-v2"]`, `toolMenu` open-config. Sidebar tabs like Spoilboard Toolbox's `.mw-nav-btn`.

### Tab 1: Setup

A checklist read from `GET /api/firmware`, `/api/settings`, `/api/server-state` (no commands), each line with
what's wrong and how to fix it:
- A laser spindle: a non-default PWM/PWM2 spindle in `$511–$513` without "Disable laser mode capability"
  (`$9`/`$709`); its number (for `M104 Q<n>`) and S range (`$730` or `$30`).
- `$32` laser mode, and ncSender Pro's `laserMode` / `laserSpindle` agree with it.
- The offset plugin is present (`$770` exists), its values, `$772` = 1.
- Homed (offsets and crosshair zeroing need machine coordinates).
- **Laser profile** (plugin settings): name (K60), **power modes** (20 / 40 / 60 W, a manual switch),
  **module power output** (None / M7 / M8 / aux `M64/M65 P<n>`) with a boot delay, **air assist output**
  (None / M7 / M8 / aux), focus height (from the focus test).
- Buttons that change the controller each say exactly what they send and ask first; only when Idle:
  "Write offset" (`$770=`, `$771=`, `$772=1`).

### Tab 2: Offsets (guided calibration)

Pure math in `lib/offsets.cjs`, with the sign convention fixed against `offset.c` by tests.

1. **Spindle to laser** (laser first, then the spindle's tip):
   - Laser selected and focused over taped scrap: **Burn a mark** loads a small cross at the current position
     (low power, ~6 mm, M4, laser off on rapids) and records the laser's **MPos_L**.
   - Switch to the spindle; plugin moves to safe Z first (`G53 G0 Z…`), because the firmware's offset move
     happens at the current Z.
   - Jog a V-bit or a pointed tool down onto the mark's center; **Spindle is on the mark** records **MPos_S**.
   - Offset = **MPos_L − MPos_S** (from offset.c: switching to the laser moves MPos by +offset, so the laser
     lands where the spindle was). Raw MPos is read at both moments, so an existing offset doesn't matter.
   - **Write offset** (Setup's button), then **Check**: a laser square around a point, and a "Go there with the
     spindle" move to a corner at a small height, to see that they agree.
2. **Crosshair to beam:** burn a mark, power the module with the beam off, jog the crosshair's center onto
   it, record. Stored in plugin settings (no firmware slot). Then:
   - **Zero at crosshair:** sets the active work offset with `G10 L2 P<n>` so X0 Y0 is the point under the
     crosshair, as the spindle sees it (stock corner alignment). The math accounts for both offsets and for
     whether the laser spindle (and its G92 shift) is active; unit-tested for both states.
   - **Crosshair to X0 Y0:** moves so the crosshair sits on the work zero, to check a placement.

### Tab 3: Tests (G-code generators in `lib/tests.cjs`)

Common card: laser profile and **power mode** (the program's header names it, and the dialog says it when the program
loads; no `M0`, since ncSender shows no prompt for one, so a pause only looks stuck), material name, test area origin (X0 Y0 at its front-left),
air assist, module power, focus height. Every program: `M4 S<n>` only while cutting, `S0`/G0 between, the
laser spindle selected first if needed, `M5` and outputs off at the end, labels in a single-stroke font.

- **Material grid:** rows of feeds × columns of power (% of S max), N each; cells **filled** (hatch at a line
  interval, for engraving) or **lines** (for scoring); feed and power labels on the edges.
- **Focus ladder:** N short lines at Z = focus guess ± k·step (Z moves only with the laser off), labelled
  with their Z; the thinnest line is the focus. Engrave and cut focus can differ: two saved values.
- **Cut-through:** short cuts at a chosen power, rows of feeds × columns of passes (1…N), optional Z step per
  pass; the first cell cut through is the setting.
- **Save as preset:** pick the best cell → a preset (material, thickness, operation engrave / score / cut,
  power %, feed, passes, focus Z, line interval, power mode) in plugin settings, which other plugins read with
  `GET /api/plugins/com.tmuka.laser-toolbox/settings`.

### Spoilboard Toolbox changes (its own repo, separate commits)

- Read `$770/$771/$772` and the laser spindle; the header's G92 check accepts a G92 equal to the laser offset
  while the laser is selected (with `$772=1`); warn when a laser spindle exists but the offset is 0.
- Laser test and grid lines: "Use a Laser Toolbox preset" when that plugin is installed.

### Shared code (add to the testkit's WORKING.md list)

`parseUnitValue` (QuickCut `lib/unit-input.cjs`), the single-stroke font and stroke emitter (Spoilboard
Toolbox :3075, :3331), the tool menu only if a tool is picked. A laser materials table is new (no feeds formula
like the spindle's; presets come from tests).

## Open points to settle on the machine (with the user, never sent by Claude)

- What ncSender Pro's Laser Mode toggle sends (watch the console): if it sends `M104 Q1`, programs don't; if
  not, programs select the laser spindle themselves.
- The firmware's offset move on `M104 Q1` happens at the current Z: confirm and always go to safe Z first.
- The K60's boot time after power-on (for the module power output's delay).

## Verification

- `npm test`: generator tests simulate the G-code (no firing on rapids, `M4` only, S within range, Z moves only
  with the laser off, labels inside the area, M0 pause before the first burn); offset math against offset.c's
  rule with numeric cases (laser selected or not, `$772` 0 or 1, existing offset non-zero); `inline.cjs --check`.
- Test harness (`~/Documents/projects/ncsender-plugin-testkit`, `openLocal`, `audit`): every tab, mm and inch,
  Pi settings by GET, no page errors, layout audit; the Setup checklist with the Pi's real firmware.
- On the Pi with the user: install a test zip (Idle only); the user runs the mark-and-measure calibration and a
  small material grid at low power on scrap, with laser glasses. Claude never sends commands to the controller.
- Spoilboard Toolbox: its tests plus a laser grid line program checked with a non-zero offset.

## Order of work

0. Create `~/Documents/projects/ncsender-plugin-laser-toolbox` (named like the other plugin folders), `git init`,
   and save this plan in it as `docs/PLAN.md` (and point the local `.claude/CLAUDE.md` at it). Add the repo to
   the testkit's WORKING.md table. No GitHub repo or push until the user asks.
1. Repo scaffold, Setup tab (read-only checklist, profile settings).
2. Offsets tab and the offset math (+ Write offset with confirmation).
3. Tests tab: material grid, focus ladder, cut-through, presets.
4. Spoilboard Toolbox: offset-aware G92 check, presets.
