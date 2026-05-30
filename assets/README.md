# PeekDock Assets

Put PNG UI assets here so they can move cleanly into the ESP32/LVGL pipeline.

## Folder Layout

- `assets/raw/`: original exported PNGs from Figma or design tools.
- `assets/processed/`: cropped, resized, compressed PNG frames that match the target small-screen resolution.
- `assets/lvgl/`: LVGL Image Converter outputs, such as C arrays or `.bin` files.

## Naming

Use lowercase names with this pattern:

```text
<agent>_<state>_<frame>.png
```

Examples:

```text
codex_idle_01.png
codex_running_01.png
codex_running_02.png
codex_completed_01.png
codex_failed_01.png
claude_web_running_01.png
jimeng_running_01.png
```

Avoid mixed separators. Use underscores, not hyphens. For example, rename `codex-running_01.png` to `codex_running_01.png` before conversion.

## Required For P0

Minimum useful set:

- Codex: idle, handoff, running, completed, failed, needs_input.
- Claude web: running.
- Jimeng: running.

For animation, provide 2 frames per state when possible. Static 1-frame states are acceptable for the hackathon demo.

## Offline Conversion

Use the repo-local converter entrypoint:

```bash
/Users/karinadeng/Documents/peekdock/scripts/convert_lvgl_assets.sh
```

Default behavior:

- input: `assets/raw`
- output: `assets/lvgl`
- output format: `C`
- color format: `RGB565A8`

You can also pass custom input and output folders:

```bash
/Users/karinadeng/Documents/peekdock/scripts/convert_lvgl_assets.sh /path/to/input /path/to/output
```
