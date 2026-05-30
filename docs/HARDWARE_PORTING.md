# Hardware Porting Guide

This repo currently targets the Waveshare ESP32-S3-Touch-LCD-1.47.

If your teammate is using a different board, do not start by editing the screen layout. Start by adapting the hardware layer.

## Portable Vs Non-Portable

### Portable

- task protocol shape
- high-level dock UI concept
- web helper flow
- PNG to LVGL asset conversion flow

### Non-Portable

- LCD panel driver
- touch driver
- GPIO assignments
- screen resolution
- rotation and mirror settings
- LCD `gap`
- byte-order and color tuning
- backlight pin and polarity

## Files Most Likely To Change

### Board And LCD

- [components/esp_bsp/bsp_display.h](/Users/karinadeng/Documents/peekdock/components/esp_bsp/bsp_display.h)
- [components/esp_bsp/bsp_display.c](/Users/karinadeng/Documents/peekdock/components/esp_bsp/bsp_display.c)
- [src/app/app_main.cpp](/Users/karinadeng/Documents/peekdock/src/app/app_main.cpp)
- [references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo](/Users/karinadeng/Documents/peekdock/references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo)

### Touch

- [components/esp_bsp/bsp_touch.c](/Users/karinadeng/Documents/peekdock/components/esp_bsp/bsp_touch.c)
- [components/esp_lcd_touch_axs5106](/Users/karinadeng/Documents/peekdock/components/esp_lcd_touch_axs5106)

### Resolution-Dependent UI

- [src/ui/screens/peekdock_screen.cpp](/Users/karinadeng/Documents/peekdock/src/ui/screens/peekdock_screen.cpp)

## Porting Order

1. Confirm target board resolution and orientation
2. Confirm panel controller and touch controller
3. Verify GPIO mapping
4. Bring up the LCD with a plain test pattern
5. Verify LVGL full-screen flush
6. Verify one static image
7. Verify touch input
8. Only then reuse the current dock UI

## Recommended Debug Ladder

### Step 1: Raw Display

Test with:

- full black
- full white
- full red / green / blue
- border rectangle
- four-corner markers

This isolates:

- `hres` / `vres`
- visible area offset
- `set_gap`
- rotation / mirror
- byte order

### Step 2: LVGL Basics

Test with:

- one centered label
- one centered rectangle
- one static image

This isolates:

- LVGL coordinate alignment
- flush callback correctness

### Step 3: Real Dock UI

Only after Step 1 and Step 2 look correct should you reuse:

- [src/ui/screens/peekdock_screen.cpp](/Users/karinadeng/Documents/peekdock/src/ui/screens/peekdock_screen.cpp)

## What To Share Back To The Team

When adapting to a new board, document:

- board name
- LCD driver
- touch driver
- resolution
- GPIO mapping
- working rotation
- final `set_gap`
- whether `swap_bytes` is needed

Put that information into:

- [memory-bank/architecture.md](/Users/karinadeng/Documents/peekdock/memory-bank/architecture.md)
- [memory-bank/progress.md](/Users/karinadeng/Documents/peekdock/memory-bank/progress.md)
