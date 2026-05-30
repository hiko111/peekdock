# PeekDock

PeekDock is a cross-screen AI task dock demo:

- Web side: a mock CodeX task page that sends task state to the dock
- Firmware side: an ESP32 + LVGL small-screen dock UI
- Bridge: JSON Lines over USB Serial

This repo is currently optimized for fast hardware iteration. The structure below separates the active demo path from reference and legacy material so teammates can onboard without guessing.

## Start Here

- Product and scope: [PRD.md](/Users/karinadeng/Documents/peekdock/PRD.md)
- Hardware truth source: [PROJECT_CONTEXT.md](/Users/karinadeng/Documents/peekdock/PROJECT_CONTEXT.md)
- Current architecture: [memory-bank/architecture.md](/Users/karinadeng/Documents/peekdock/memory-bank/architecture.md)
- Progress log: [memory-bank/progress.md](/Users/karinadeng/Documents/peekdock/memory-bank/progress.md)
- Team handoff guide: [docs/TEAM_HANDOFF.md](/Users/karinadeng/Documents/peekdock/docs/TEAM_HANDOFF.md)
- Hardware porting guide: [docs/HARDWARE_PORTING.md](/Users/karinadeng/Documents/peekdock/docs/HARDWARE_PORTING.md)

## Repo Map

```text
assets/
  raw/        source PNG assets
  processed/  resized/screen-specific PNGs
  lvgl/       generated LVGL C image assets

components/
  esp_bsp/                    board support imported from Waveshare demo
  esp_lcd_jd9853/             LCD panel driver
  esp_lcd_touch_axs5106/      touch driver

mac-demo/
  public/                     mock CodeX web UI
  server.mjs                  localhost helper + serial bridge

protocol/
  README.md                   JSON Lines contract
  demo-events.jsonl           example event stream

scripts/
  convert_lvgl_assets.sh      offline LVGL asset conversion

src/
  app/app_main.cpp            firmware entrypoint
  protocol/                   firmware-side event parsing
  ui/screens/                 dock screen UI

docs/
  TEAM_HANDOFF.md             teammate onboarding
  HARDWARE_PORTING.md         how to adapt to a different board

legacy/
  platformio-arduino-serial-test/
                              old Arduino smoke test, not active

references/
  vendor/waveshare-esp32-s3-touch-lcd-1.47-demo/
                              vendor demo bundle for comparison only
```

## Active Entry Points

- Firmware entry: [src/app/app_main.cpp](/Users/karinadeng/Documents/peekdock/src/app/app_main.cpp)
- Firmware build config: [CMakeLists.txt](/Users/karinadeng/Documents/peekdock/CMakeLists.txt), [src/CMakeLists.txt](/Users/karinadeng/Documents/peekdock/src/CMakeLists.txt)
- Web helper: [mac-demo/server.mjs](/Users/karinadeng/Documents/peekdock/mac-demo/server.mjs)
- Web UI: [mac-demo/public/index.html](/Users/karinadeng/Documents/peekdock/mac-demo/public/index.html)

## Not The Main Path

- [legacy](/Users/karinadeng/Documents/peekdock/legacy) keeps old experiments so they do not distract from the active ESP-IDF path.
- [references](/Users/karinadeng/Documents/peekdock/references) keeps large vendor materials that are useful for bring-up but should not be edited first.

## Current Demo Flow

1. Start the local web demo
2. Enter a task in the CodeX-like page
3. Helper sends `handoff_to_dock` and `task_update` events to the ESP32
4. ESP32 renders the current task state on the small screen
5. Helper mocks `running -> completed`

## Important Reality Check

This repo currently contains board-specific assumptions for the Waveshare ESP32-S3-Touch-LCD-1.47.

If your teammate is using a different board, they should not start by editing UI code first. They should first read:

- [PROJECT_CONTEXT.md](/Users/karinadeng/Documents/peekdock/PROJECT_CONTEXT.md)
- [docs/HARDWARE_PORTING.md](/Users/karinadeng/Documents/peekdock/docs/HARDWARE_PORTING.md)

## Asset Workflow

- Put source images in [assets/raw](/Users/karinadeng/Documents/peekdock/assets/raw)
- For screen-specific variants, store them in [assets/processed](/Users/karinadeng/Documents/peekdock/assets/processed)
- Convert to LVGL C assets with:

```bash
/Users/karinadeng/Documents/peekdock/scripts/convert_lvgl_assets.sh
```
