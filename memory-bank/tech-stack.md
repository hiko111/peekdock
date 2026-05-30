# PeekDock 技术栈

## 1. 当前结论

目标固件技术栈必须从当前仓库里的 Arduino/PlatformIO 串口测试原型，迁移到 ESP-IDF 5.2+。

当前 `platformio.ini` 和 `src/main.cpp` 只能视为早期连板测试痕迹，不再作为目标工程形态继续扩展。

## 2. 目标硬件

- Board: Waveshare ESP32-S3-Touch-LCD-1.47
- MCU: ESP32-S3R8, Xtensa LX7 dual core, up to 240MHz
- Flash: 16MB
- PSRAM: 8MB embedded PSRAM
- Wireless: WiFi 2.4GHz, Bluetooth LE 5
- Storage: MicroSD slot
- USB: USB-Serial/JTAG
- Current Mac serial port: `/dev/tty.usbmodem1301`
- MAC: `1c:db:d4:7b:9a:14`

## 3. Display And Touch

- Display: 1.47 inch IPS TFT
- Resolution: 172 x 320
- Color depth: 262K
- Pixel format: RGB565
- LCD driver: JD9853
- LCD interface: 4-wire SPI
- Touch controller: AXS5106L
- Touch interface: I2C
- Touch points: single touch
- Gesture: supported by controller, but P0 should gracefully degrade to edge taps if gesture handling is unstable

Known GPIO mapping:

- `LCD_SCLK`: 38
- `LCD_MOSI`: 39
- `LCD_CS`: 21
- `LCD_DC`: 45
- `LCD_RST`: 40
- `LCD_BL`: 48
- `TP_SDA`: 17
- `TP_SCL`: 18
- `TP_INT`: 16
- `SD_CS`: 14

## 4. Firmware Stack

Use:

- ESP-IDF 5.2+
- LVGL 9.x
- Native ESP-IDF SPI/I2C APIs
- DMA SPI display flush
- PSRAM double buffering

Avoid:

- Arduino framework
- Blocking SPI transfers
- Single framebuffer
- Dynamic allocations in render loop
- Guessing JD9853 or AXS5106L register sequences

The most important implementation dependency is the official Waveshare demo code for JD9853 and AXS5106L initialization. LVGL integration should happen only after display and touch drivers are known-good.

## 5. Firmware Architecture

Recommended target structure:

```text
src/
 ├── app/
 │    ├── app_main.cpp
 │
 ├── drivers/
 │    ├── jd9853.cpp
 │    ├── jd9853.h
 │    ├── axs5106l.cpp
 │    ├── axs5106l.h
 │
 ├── lvgl_port/
 │    ├── lv_port_display.cpp
 │    ├── lv_port_touch.cpp
 │
 ├── ui/
 │    ├── screens/
 │    ├── widgets/
 │    ├── theme/
 │
 └── assets/
      ├── fonts/
      ├── images/
```

## 6. Display Driver

Create a `JD9853Display` driver with:

- `begin()`
- `setBacklight(uint8_t brightness)`
- `flush(const lv_area_t* area, uint16_t* color_buffer)`

Required initialization:

- reset
- sleep out
- pixel format RGB565
- MADCTL
- display on

Required capabilities:

- 0 / 90 / 180 / 270 degree rotation
- DMA SPI transfer
- LVGL flush callback compatibility

Do not invent JD9853 register commands. Use Waveshare official ESP-IDF/LVGL demo as the truth source.

## 7. Touch Driver

Create an `AXS5106LTouch` driver with:

- `begin()`
- `getPoint(uint16_t* x, uint16_t* y)`

Required behavior:

- I2C init
- touch scan
- coordinate read
- press/release detect
- coordinate transform
- rotation mapping
- LVGL pointer input mapping

Do not guess AXS5106L registers. Use Waveshare official demo or known-good community driver as the truth source.

## 8. LVGL Integration

Use LVGL 9.x.

Display callback:

```cpp
void lvgl_flush_cb(
    lv_display_t* display,
    const lv_area_t* area,
    uint8_t* color_p);
```

Touch callback:

```cpp
void lvgl_touch_cb(
    lv_indev_t* indev,
    lv_indev_data_t* data);
```

Resolution constants:

```cpp
#define LCD_H_RES 172
#define LCD_V_RES 320
```

## 9. Memory Strategy

Frame buffer math:

```text
172 x 320 x 2 = 110080 bytes, about 108KB
Double buffer: about 216KB
Triple buffer: about 324KB
```

Recommendation:

- RGB565
- PSRAM draw buffers
- double buffering

Expected `sdkconfig.defaults`:

```text
CONFIG_SPIRAM=y
CONFIG_SPIRAM_FETCH_INSTRUCTIONS=y
CONFIG_SPIRAM_RODATA=y
```

Use `heap_caps_malloc(buffer_size, MALLOC_CAP_SPIRAM)` for draw buffers.

## 10. Mac And Helper Stack

Mac-side remains separate from firmware:

- Mac agent UI: Web page prototype for hackathon demo
- Mac/helper: Node.js/TypeScript preferred
- Mac/helper <-> ESP32: USB Serial on `/dev/tty.usbmodem1301`
- Mac/helper <-> Mac UI: WebSocket or localhost HTTP
- Quick action: open whitelisted local HTML or image files only

## 11. Task Protocol

Use JSON Lines over USB Serial for P0:

- `task_snapshot`
- `task_update`
- `transition_event`
- `action_event`
- `heartbeat`
- `sync_snapshot`

Keep helper as the state authority. The ESP32 device caches recent tasks but does not own task truth.

## 12. Asset Pipeline

Input assets:

- Raw PNGs: `assets/raw/`
- Processed 172 x 320 or cropped frame PNGs: `assets/processed/`
- LVGL converted C arrays or binary assets: `assets/lvgl/`

For P0:

- Use 1-2 frame animations.
- Convert images offline.
- Avoid runtime PNG/GIF decoding on ESP32.
- Prefer RGB565 / RGB565A8 output from LVGL Image Converter.

## 13. Testing

Firmware:

- `idf.py build`
- `idf.py flash monitor`
- display color/fill smoke test
- touch point logging test
- LVGL screen smoke test
- serial protocol fixture test

Mac/helper:

- serial mock test
- WebSocket event test
- quick-action whitelist test

End-to-end:

- Mac UI starts mock Codex task
- ESP32 shows running task
- ESP32 switches among Codex, Claude web, Jimeng
- ESP32 sends `open_result`
- Mac UI opens local HTML/image and plays return animation

## 14. Real Tool Integration Path

After mock demo is stable:

- Codex: investigate CLI/log/workspace event wrapping.
- Claude web: investigate browser extension, notification listening, or manual task registration.
- Jimeng: investigate official API/task center/browser notification; fallback to semi-manual result URL/image import.

