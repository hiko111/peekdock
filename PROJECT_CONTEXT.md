# Project Context

This project currently targets the `Waveshare ESP32-S3-Touch-LCD-1.47`.

## Hardware Facts

- MCU: `ESP32-S3R8`
- Flash: `16MB`
- PSRAM: `8MB`
- Display: `JD9853`, `172 x 320`, `RGB565`, `4-wire SPI`
- Touch: `AXS5106L`, `I2C`
- USB mode: `USB-Serial/JTAG`
- Expected local serial port during current development: `/dev/tty.usbmodem1301`

## Current Firmware Target

- Framework: `ESP-IDF`
- UI stack: `LVGL 9.x`
- Active firmware entry: [src/app/app_main.cpp](/Users/karinadeng/Documents/peekdock/src/app/app_main.cpp)

## Source Of Truth

The current board bring-up should follow the imported Waveshare-derived drivers in:

- [components/esp_bsp](/Users/karinadeng/Documents/peekdock/components/esp_bsp)
- [components/esp_lcd_jd9853](/Users/karinadeng/Documents/peekdock/components/esp_lcd_jd9853)
- [components/esp_lcd_touch_axs5106](/Users/karinadeng/Documents/peekdock/components/esp_lcd_touch_axs5106)

Vendor reference projects are kept separately in:

- [references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo](/Users/karinadeng/Documents/peekdock/references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo)

## Important Collaboration Rule

Do not start by editing the dock UI if the hardware is different.

First confirm:

1. panel driver
2. touch driver
3. GPIO mapping
4. resolution and orientation
5. `swap_bytes`, mirror, and `set_gap` tuning
