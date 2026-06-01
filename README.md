# PeekDock

PeekDock is a helper + ESP32 dock for watching AI task state on a small screen.

- Helper side: `runtime-bridge/server.mjs` watches Codex, Claude Code, and JiMeng, then normalizes task state
- Firmware side: ESP32 + LVGL renders the dock UI and sends touch actions back
- Transport: JSON Lines over USB Serial/JTAG

This repo is optimized for fast hardware iteration. The active path is `runtime-bridge + src/ firmware + assets`.

## Start Here

- Product and scope: [PRD.md](/Users/karinadeng/Documents/peekdock/PRD.md)
- Hardware truth source: [PROJECT_CONTEXT.md](/Users/karinadeng/Documents/peekdock/PROJECT_CONTEXT.md)
- Current architecture: [memory-bank/architecture.md](/Users/karinadeng/Documents/peekdock/memory-bank/architecture.md)
- Progress log: [memory-bank/progress.md](/Users/karinadeng/Documents/peekdock/memory-bank/progress.md)

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

runtime-bridge/
  server.mjs                  active helper bridge and local debug API

protocol/
  README.md                   JSON Lines contract
  demo-events.jsonl           example event stream

scripts/
  convert_lvgl_assets.sh      offline LVGL asset conversion
  start-peekdock.sh           helper start script
  com.peekdock.bridge.plist   helper launch agent template

src/
  app/app_main.cpp            firmware entrypoint
  protocol/                   firmware-side event parsing
  ui/screens/                 dock screen UI

legacy/
  platformio-arduino-serial-test/
                              old Arduino smoke test, not active
  mac-demo-experiments/
                              old Mac-side experiments, not active

references/
  vendor/waveshare-esp32-s3-touch-lcd-1.47-demo/
                              vendor demo bundle for comparison only
```

## Active Entry Points

- Firmware entry: [src/app/app_main.cpp](/Users/karinadeng/Documents/peekdock/src/app/app_main.cpp)
- Firmware build config: [CMakeLists.txt](/Users/karinadeng/Documents/peekdock/CMakeLists.txt), [src/CMakeLists.txt](/Users/karinadeng/Documents/peekdock/src/CMakeLists.txt)
- Active helper: [runtime-bridge/server.mjs](/Users/karinadeng/Documents/peekdock/runtime-bridge/server.mjs)
- Launch script: [scripts/start-peekdock.sh](/Users/karinadeng/Documents/peekdock/scripts/start-peekdock.sh)
- LaunchAgent template: [scripts/com.peekdock.bridge.plist](/Users/karinadeng/Documents/peekdock/scripts/com.peekdock.bridge.plist)

## Not The Main Path

- [legacy](/Users/karinadeng/Documents/peekdock/legacy) keeps old experiments so they do not distract from the active ESP-IDF path.
- [references](/Users/karinadeng/Documents/peekdock/references) keeps large vendor materials that are useful for bring-up but should not be edited first.

## Current Demo Flow

1. Start `runtime-bridge/server.mjs`
2. Helper watches Codex, Claude Code, and JiMeng state
3. Helper sends `task_update`, `task_snapshot`, and transition events to the ESP32
4. ESP32 renders the active agent on the small screen and can send touch actions back
5. Helper reopens the right desktop context when the dock asks for it

## Important Reality Check

This repo currently contains board-specific assumptions for the Waveshare ESP32-S3-Touch-LCD-1.47.

If your teammate is using a different board, they should not start by editing UI code first. They should first read:

- [PROJECT_CONTEXT.md](/Users/karinadeng/Documents/peekdock/PROJECT_CONTEXT.md)

## Asset Workflow

- Put source images in [assets/raw](/Users/karinadeng/Documents/peekdock/assets/raw)
- For screen-specific variants, store them in [assets/processed](/Users/karinadeng/Documents/peekdock/assets/processed)
- Convert to LVGL C assets with:

```bash
/Users/karinadeng/Documents/peekdock/scripts/convert_lvgl_assets.sh
```
