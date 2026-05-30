# P0 Asset Manifest

This file freezes the first demo asset set. Raw PNGs stay in `assets/raw/`.

## Ready Assets

### Codex

- `assets/raw/codex_idle_01.png`
- `assets/raw/codex_idle_02.png`
- `assets/raw/codex_running_01.png`
- `assets/raw/codex_running_02.png`
- `assets/raw/codex_completed_01.png`
- `assets/raw/codex_completed_02.png`
- `assets/raw/codex_error_01.png`
- `assets/raw/codex_error_02.png`

### Claude Web

- `assets/raw/claude_idle_01.png`
- `assets/raw/claude_idle_02.png`
- `assets/raw/claude_running_01.png`
- `assets/raw/claude_running_02.png`
- `assets/raw/claude_completed_01.png`
- `assets/raw/claude_completed_02.png`

### Jimeng

- `assets/raw/jimeng_completed_01.png`
- `assets/raw/jimeng_completed_02.png`

## Missing Or Optional

- Jimeng running frames are missing. P0 may use completed frames as a temporary visual stand-in.
- Mac-specific handoff/return frames are missing. P0 Web demo can animate the existing Codex idle/running/completed frames.
- Claude needs-input frames are missing. P0 may use Claude completed or running frames with a clear `Need input` status style.

## Animation Key Mapping

| animation_key | Asset |
| --- | --- |
| `codex_idle` | `codex_idle_01.png`, `codex_idle_02.png` |
| `codex_handoff_in` | `codex_running_01.png` |
| `codex_running` | `codex_running_01.png`, `codex_running_02.png` |
| `codex_completed` | `codex_completed_01.png`, `codex_completed_02.png` |
| `codex_failed` | `codex_error_01.png`, `codex_error_02.png` |
| `codex_return_to_mac` | `codex_completed_01.png` |
| `claude_running` | `claude_running_01.png`, `claude_running_02.png` |
| `claude_needs_input` | `claude_completed_01.png` |
| `jimeng_running` | `jimeng_completed_01.png` |
| `jimeng_completed` | `jimeng_completed_01.png`, `jimeng_completed_02.png` |

## Processing Rules

- Keep source PNGs unchanged in `assets/raw/`.
- Put cropped/resized versions in `assets/processed/`.
- Put LVGL converter output in `assets/lvgl/`.
- Use lowercase, underscores, and numeric frame suffixes only.

