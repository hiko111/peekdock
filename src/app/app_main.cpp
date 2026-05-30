#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "driver/usb_serial_jtag.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "bsp_display.h"
#include "bsp_i2c.h"
#include "bsp_touch.h"
#include "protocol/task_protocol.h"
#include "ui/screens/peekdock_screen.h"

static const char* TAG = "peekdock";
static constexpr int SERIAL_BUFFER_SIZE = 2048;
static constexpr int DISPLAY_ROTATION = 0;

#if DISPLAY_ROTATION == 90 || DISPLAY_ROTATION == 270
static constexpr int LCD_H_RES = 320;
static constexpr int LCD_V_RES = 172;
#else
static constexpr int LCD_H_RES = 172;
static constexpr int LCD_V_RES = 320;
#endif

static constexpr int LCD_DRAW_BUFFER_HEIGHT = 50;
static constexpr bool LCD_DRAW_BUFFER_DOUBLE = true;
static constexpr int SERIAL_TASK_STACK_SIZE = 8192;
static constexpr int TOUCH_TASK_STACK_SIZE = 4096;

static esp_lcd_panel_io_handle_t io_handle = nullptr;
static esp_lcd_panel_handle_t panel_handle = nullptr;
static esp_lcd_touch_handle_t touch_handle = nullptr;
static lv_display_t* lvgl_display = nullptr;
static lv_indev_t* lvgl_touch = nullptr;
static char serial_line_buffer[SERIAL_BUFFER_SIZE] = {};
static uint16_t touch_press_x = 0;
static uint16_t touch_press_y = 0;
static uint16_t touch_last_x = 0;
static uint16_t touch_last_y = 0;
static bool touch_was_down = false;

static void send_action_event(const char* action) {
    if (!action || action[0] == '\0') return;
    char line[192];
    const int written = snprintf(
        line,
        sizeof(line),
        "{\"schema_version\":1,\"type\":\"action_event\",\"source\":\"codex\",\"action\":\"%s\"}\n",
        action
    );
    if (written > 0) {
        usb_serial_jtag_write_bytes(reinterpret_cast<const uint8_t*>(line), written, pdMS_TO_TICKS(50));
    }
}

static void set_touch_debug_text(const char* text) {
    if (lvgl_port_lock(0)) {
        peekdock_screen_set_touch_debug(text);
        lvgl_port_unlock();
    }
}

static void touch_poll_task(void*) {
    while (true) {
        if (!touch_handle) {
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }

        uint16_t x[1] = {};
        uint16_t y[1] = {};
        uint8_t count = 0;
        esp_lcd_touch_read_data(touch_handle);
        const bool down = esp_lcd_touch_get_coordinates(touch_handle, x, y, nullptr, &count, 1) && count > 0;

        if (down && !touch_was_down) {
            touch_press_x = x[0];
            touch_press_y = y[0];
            touch_last_x = x[0];
            touch_last_y = y[0];
            touch_was_down = true;
            char debug[96];
            snprintf(debug, sizeof(debug), "RAW DOWN %u,%u", touch_press_x, touch_press_y);
            set_touch_debug_text(debug);
        } else if (down && touch_was_down) {
            touch_last_x = x[0];
            touch_last_y = y[0];
            char debug[96];
            snprintf(debug, sizeof(debug), "RAW MOVE %u,%u", x[0], y[0]);
            set_touch_debug_text(debug);
        } else if (!down && touch_was_down) {
            touch_was_down = false;
            const int dx = static_cast<int>(touch_last_x) - static_cast<int>(touch_press_x);
            const int dy = static_cast<int>(touch_last_y) - static_cast<int>(touch_press_y);
            const TickType_t now = xTaskGetTickCount();
            char debug[128];
            snprintf(debug, sizeof(debug), "RAW UP dx=%d dy=%d", dx, dy);
            set_touch_debug_text(debug);

            if (dx < -36 && std::abs(dy) < 90) {
                set_touch_debug_text("RAW LEFT -> NEXT");
                send_action_event("switch_agent_next");
            } else if (dx > 36 && std::abs(dy) < 90) {
                set_touch_debug_text("RAW RIGHT -> PREV");
                send_action_event("switch_agent_prev");
            } else if (dy < -40 && std::abs(dx) < 90) {
                set_touch_debug_text("RAW UP -> MAC");
                send_action_event("return_to_mac");
            }
        }

        vTaskDelay(pdMS_TO_TICKS(35));
    }
}

static esp_err_t init_nvs() {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_RETURN_ON_ERROR(nvs_flash_erase(), TAG, "NVS erase failed");
        ret = nvs_flash_init();
    }
    return ret;
}

static esp_err_t init_lvgl() {
    lvgl_port_cfg_t lvgl_cfg = {};
    lvgl_cfg.task_priority = 4;
    lvgl_cfg.task_stack = 1024 * 10;
    lvgl_cfg.task_affinity = -1;
    lvgl_cfg.task_max_sleep_ms = 500;
    lvgl_cfg.timer_period_ms = 5;
    ESP_RETURN_ON_ERROR(lvgl_port_init(&lvgl_cfg), TAG, "LVGL port init failed");

    lvgl_port_display_cfg_t display_cfg = {};
    display_cfg.io_handle = io_handle;
    display_cfg.panel_handle = panel_handle;
    display_cfg.buffer_size = LCD_H_RES * LCD_DRAW_BUFFER_HEIGHT;
    display_cfg.double_buffer = LCD_DRAW_BUFFER_DOUBLE;
    display_cfg.hres = LCD_H_RES;
    display_cfg.vres = LCD_V_RES;
    display_cfg.monochrome = false;
    display_cfg.rotation.swap_xy = false;
    display_cfg.rotation.mirror_x = false;
    display_cfg.rotation.mirror_y = false;
    display_cfg.flags.buff_spiram = false;
    display_cfg.flags.buff_dma = true;
#if LVGL_VERSION_MAJOR >= 9
    display_cfg.flags.swap_bytes = true;
#endif

#if DISPLAY_ROTATION == 90
    display_cfg.rotation.swap_xy = true;
    display_cfg.rotation.mirror_x = true;
    display_cfg.rotation.mirror_y = false;
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(panel_handle, 0, 34), TAG, "set gap failed");
#elif DISPLAY_ROTATION == 180
    display_cfg.rotation.swap_xy = false;
    display_cfg.rotation.mirror_x = true;
    display_cfg.rotation.mirror_y = true;
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(panel_handle, 34, 0), TAG, "set gap failed");
#elif DISPLAY_ROTATION == 270
    display_cfg.rotation.swap_xy = true;
    display_cfg.rotation.mirror_x = false;
    display_cfg.rotation.mirror_y = true;
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(panel_handle, 0, 34), TAG, "set gap failed");
#else
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(panel_handle, 34, 0), TAG, "set gap failed");
#endif

    lvgl_display = lvgl_port_add_disp(&display_cfg);

    lvgl_port_touch_cfg_t touch_cfg = {};
    touch_cfg.disp = lvgl_display;
    touch_cfg.handle = touch_handle;
    lvgl_touch = lvgl_port_add_touch(&touch_cfg);
    return lvgl_display && lvgl_touch ? ESP_OK : ESP_FAIL;
}

static void serial_task(void*) {
    uint8_t byte = 0;
    size_t length = 0;

    while (true) {
        const int read = usb_serial_jtag_read_bytes(&byte, 1, pdMS_TO_TICKS(20));
        if (read <= 0) {
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }

        if (byte == '\n') {
            serial_line_buffer[length] = '\0';
            if (length > 0) {
                PeekDockEvent event = {};
                if (parse_peekdock_event(serial_line_buffer, &event)) {
                    if (lvgl_port_lock(0)) {
                        peekdock_screen_apply_event(&event);
                        lvgl_port_unlock();
                    }
                } else {
                    ESP_LOGW(TAG, "Ignored invalid protocol line: %s", serial_line_buffer);
                }
            }
            length = 0;
            continue;
        }

        if (length < sizeof(serial_line_buffer) - 1 && byte != '\r') {
            serial_line_buffer[length++] = static_cast<char>(byte);
        }
    }
}

extern "C" void app_main(void) {
    ESP_LOGI(TAG, "PeekDock firmware starting");
    ESP_LOGI(TAG, "Step 1: NVS init");
    ESP_ERROR_CHECK(init_nvs());
    ESP_LOGI(TAG, "Step 2: I2C bus");
    i2c_master_bus_handle_t i2c_bus = bsp_i2c_init();
    ESP_LOGI(TAG, "Step 3: Display init");
    bsp_display_init(&io_handle, &panel_handle, LCD_H_RES * LCD_DRAW_BUFFER_HEIGHT);
    ESP_LOGI(TAG, "Step 4: Touch init");
    bsp_touch_init(&touch_handle, i2c_bus, LCD_H_RES, LCD_V_RES, DISPLAY_ROTATION);
    ESP_LOGI(TAG, "Step 5: LVGL init");
    ESP_ERROR_CHECK(init_lvgl());
    ESP_LOGI(TAG, "Step 6: Backlight");
    bsp_display_brightness_init();
    bsp_display_set_brightness(100);
    ESP_LOGI(TAG, "Step 7: Screen init");
    if (lvgl_port_lock(0)) {
        peekdock_screen_init();
        peekdock_screen_set_action_callback(send_action_event);
        lvgl_port_unlock();
    }
    ESP_LOGI(TAG, "Step 8: USB Serial JTAG");
    usb_serial_jtag_driver_config_t serial_config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    serial_config.rx_buffer_size = SERIAL_BUFFER_SIZE;
    serial_config.tx_buffer_size = SERIAL_BUFFER_SIZE;
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&serial_config));
    ESP_LOGI(TAG, "Step 9: Serial task");
    xTaskCreate(serial_task, "peekdock_serial", SERIAL_TASK_STACK_SIZE, nullptr, 5, nullptr);
    ESP_LOGI(TAG, "Step 10: Touch poll task");
    xTaskCreate(touch_poll_task, "peekdock_touch", TOUCH_TASK_STACK_SIZE, nullptr, 4, nullptr);
    ESP_LOGI(TAG, "All done, running");
}
