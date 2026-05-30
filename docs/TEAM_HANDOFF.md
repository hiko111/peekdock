# Team Handoff

This file is for teammates who want to contribute code without first reverse-engineering the repo.

## What This Repo Does

PeekDock is a prototype where:

- a local web page mocks CodeX task creation
- a Node helper sends task events over USB Serial
- an ESP32 small screen shows the task state with LVGL

## Best First Reads

Read these in order:

1. [PRD.md](/Users/karinadeng/Documents/peekdock/PRD.md)
2. [PROJECT_CONTEXT.md](/Users/karinadeng/Documents/peekdock/PROJECT_CONTEXT.md)
3. [memory-bank/design-document.md](/Users/karinadeng/Documents/peekdock/memory-bank/design-document.md)
4. [memory-bank/architecture.md](/Users/karinadeng/Documents/peekdock/memory-bank/architecture.md)
5. [docs/HARDWARE_PORTING.md](/Users/karinadeng/Documents/peekdock/docs/HARDWARE_PORTING.md) if you are not using the same board

## Where To Work

### Firmware

- Entry: [src/app/app_main.cpp](/Users/karinadeng/Documents/peekdock/src/app/app_main.cpp)
- Protocol parsing: [src/protocol](/Users/karinadeng/Documents/peekdock/src/protocol)
- Screen UI: [src/ui/screens](/Users/karinadeng/Documents/peekdock/src/ui/screens)
- Board drivers: [components](/Users/karinadeng/Documents/peekdock/components)

### Web And Helper

- Helper server: [mac-demo/server.mjs](/Users/karinadeng/Documents/peekdock/mac-demo/server.mjs)
- Frontend: [mac-demo/public](/Users/karinadeng/Documents/peekdock/mac-demo/public)

### Assets

- Source PNGs: [assets/raw](/Users/karinadeng/Documents/peekdock/assets/raw)
- Screen-tuned PNGs: [assets/processed](/Users/karinadeng/Documents/peekdock/assets/processed)
- LVGL resources: [assets/lvgl](/Users/karinadeng/Documents/peekdock/assets/lvgl)

### Reference And Historical Material

- Vendor reference bundle: [references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo](/Users/karinadeng/Documents/peekdock/references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo)
- Old serial prototype: [legacy/platformio-arduino-serial-test](/Users/karinadeng/Documents/peekdock/legacy/platformio-arduino-serial-test)

## What Is Board-Specific

These parts are not portable by default:

- GPIO numbers in `components/esp_bsp`
- panel driver assumptions
- touch driver assumptions
- screen resolution and rotation
- LCD `gap` / mirror / byte-order tuning

If your hardware is different, start from the board layer before touching the dock UI.

## Current Collaboration Rules

- Product context lives in [memory-bank](/Users/karinadeng/Documents/peekdock/memory-bank)
- Do not invent display or touch register sequences
- Use the imported vendor components as the current source of truth
- After major milestones, update:
  - [memory-bank/progress.md](/Users/karinadeng/Documents/peekdock/memory-bank/progress.md)
  - [memory-bank/architecture.md](/Users/karinadeng/Documents/peekdock/memory-bank/architecture.md)

## Recommended Working Style

If you are debugging:

1. Isolate one layer
2. Verify it end-to-end
3. Then move up the stack

Example order:

1. Panel bring-up
2. LVGL coordinate system
3. Static image rendering
4. Animated image switching
5. Protocol-driven UI
6. Web + dock integration

## Current Known Rough Edges

- Display tuning is still board-sensitive
- Helper and firmware are optimized for one-board local demo speed
- Web UI is functional but still evolving
- Vendor demo files are intentionally kept out of the root active path
- Legacy Arduino test files were moved out of the main firmware path
