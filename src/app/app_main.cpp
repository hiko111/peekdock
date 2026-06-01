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
#include "esp_timer.h"
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
static constexpr int TOUCH_EDGE_ZONE = 44;
static constexpr int TOUCH_TAP_SLOP = 18;
static constexpr int TOUCH_DOUBLE_TAP_MIN_US = 70000;
static constexpr int TOUCH_DOUBLE_TAP_MAX_US = 360000;
static constexpr int TOUCH_DOUBLE_TAP_DISTANCE = 26;
static constexpr int TOUCH_DIRECTION_SLOP = 10;
static constexpr int TOUCH_HORIZONTAL_LOCK_DISTANCE = 32;
static constexpr int TOUCH_HORIZONTAL_FIRE_DISTANCE = 40;
static constexpr int TOUCH_POLL_MS = 22;

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
static uint16_t last_tap_x = 0;
static uint16_t last_tap_y = 0;
static int64_t touch_press_us = 0;
static int64_t last_tap_us = 0;
static bool touch_was_down = false;
static bool touch_horizontal_swipe_fired = false;

enum class TouchGestureMode {
    pending,
    horizontal_swipe,
    tap_candidate,
    consumed,
};

static TouchGestureMode touch_gesture_mode = TouchGestureMode::pending;

static void touch_debug(const char* text) {
    ESP_LOGI(TAG, "touch: %s", text ? text : "");
}

static bool with_lvgl_lock(uint32_t timeout_ms) {
    return lvgl_port_lock(timeout_ms);
}

static void unlock_lvgl() {
    lvgl_port_unlock();
}

static bool screen_current_needs_confirmation() {
    bool needs_confirmation = false;
    if (with_lvgl_lock(50)) {
        needs_confirmation = peekdock_screen_current_needs_confirmation();
        unlock_lvgl();
    } else {
        touch_debug("needs confirmation lock miss");
    }
    return needs_confirmation;
}

static void screen_current_source(char* target, size_t target_size) {
    if (!target || target_size == 0) return;
    target[0] = '\0';
    if (with_lvgl_lock(50)) {
        peekdock_screen_current_source(target, target_size);
        unlock_lvgl();
    } else {
        touch_debug("current source lock miss");
    }
}

static void screen_switch_page(int direction) {
    if (direction == 0) return;
    if (with_lvgl_lock(50)) {
        peekdock_screen_switch_page(direction);
        unlock_lvgl();
    } else {
        touch_debug("switch page lock miss");
    }
}

static void screen_touch_feedback() {
    if (with_lvgl_lock(50)) {
        peekdock_screen_touch_feedback();
        unlock_lvgl();
    } else {
        touch_debug("touch feedback lock miss");
    }
}

static void send_action_event(const char* action) {
    if (!action || action[0] == '\0') return;
    char source[24] = {};
    screen_current_source(source, sizeof(source));
    const char* payload_source = source[0] ? source : "codex";
    char line[192];
    const int written = snprintf(
        line,
        sizeof(line),
        "{\"schema_version\":1,\"type\":\"action_event\",\"source\":\"%s\",\"action\":\"%s\"}\n",
        payload_source,
        action
    );
    if (written > 0) {
        usb_serial_jtag_write_bytes(reinterpret_cast<const uint8_t*>(line), written, pdMS_TO_TICKS(50));
    }
}

static void reset_touch_sequence() {
    touch_was_down = false;
    touch_horizontal_swipe_fired = false;
    touch_gesture_mode = TouchGestureMode::pending;
}

static bool is_horizontal_lock(int dx, int dy) {
    const int abs_dx = std::abs(dx);
    const int abs_dy = std::abs(dy);
    return abs_dx > TOUCH_HORIZONTAL_LOCK_DISTANCE && abs_dx * 10 > abs_dy * 15;
}

static bool is_pending_motion(int dx, int dy) {
    return std::abs(dx) < TOUCH_DIRECTION_SLOP && std::abs(dy) < TOUCH_DIRECTION_SLOP;
}

static bool is_small_release(int dx, int dy) {
    return std::abs(dx) < TOUCH_TAP_SLOP && std::abs(dy) < TOUCH_TAP_SLOP;
}

static bool is_center_zone(uint16_t x) {
    return x > TOUCH_EDGE_ZONE && x < LCD_H_RES - TOUCH_EDGE_ZONE;
}

static bool is_double_tap_candidate(uint16_t x, uint16_t y, int64_t now_us) {
    if (!is_center_zone(x) || last_tap_us <= 0) return false;
    const int64_t delta_us = now_us - last_tap_us;
    if (delta_us < TOUCH_DOUBLE_TAP_MIN_US || delta_us > TOUCH_DOUBLE_TAP_MAX_US) return false;
    return std::abs(static_cast<int>(x) - static_cast<int>(last_tap_x)) <= TOUCH_DOUBLE_TAP_DISTANCE &&
        std::abs(static_cast<int>(y) - static_cast<int>(last_tap_y)) <= TOUCH_DOUBLE_TAP_DISTANCE;
}

static void arm_single_tap(uint16_t x, uint16_t y, int64_t now_us) {
    last_tap_us = now_us;
    last_tap_x = x;
    last_tap_y = y;
}

static void clear_tap_memory() {
    last_tap_us = 0;
    last_tap_x = 0;
    last_tap_y = 0;
}

static void perform_page_switch(int direction) {
    screen_switch_page(direction);
    send_action_event(direction > 0 ? "switch_agent_next" : "switch_agent_prev");
}

static void handle_tap_release(uint16_t x, uint16_t y, int64_t now_us) {
    if (is_center_zone(x) && is_double_tap_candidate(x, y, now_us) && !screen_current_needs_confirmation()) {
        touch_debug("double tap open");
        screen_touch_feedback();
        send_action_event("open_agent");
        clear_tap_memory();
        return;
    }

    if (screen_current_needs_confirmation() && is_center_zone(x)) {
        touch_debug("tap accept");
        send_action_event("accept_confirmation");
        clear_tap_memory();
        return;
    }

    if (x <= TOUCH_EDGE_ZONE) {
        touch_debug("tap prev");
        perform_page_switch(-1);
        clear_tap_memory();
        return;
    }

    if (x >= LCD_H_RES - TOUCH_EDGE_ZONE) {
        touch_debug("tap next");
        perform_page_switch(1);
        clear_tap_memory();
        return;
    }

    if (is_center_zone(x)) {
        touch_debug("tap armed");
        arm_single_tap(x, y, now_us);
        return;
    }

    clear_tap_memory();
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
        touch_press_us = esp_timer_get_time();
        touch_was_down = true;
        touch_horizontal_swipe_fired = false;
        touch_gesture_mode = TouchGestureMode::pending;
    } else if (down && touch_was_down) {
        touch_last_x = x[0];
        touch_last_y = y[0];
        if (touch_gesture_mode == TouchGestureMode::consumed) {
            vTaskDelay(pdMS_TO_TICKS(TOUCH_POLL_MS));
            continue;
        }

        const int dx = static_cast<int>(touch_last_x) - static_cast<int>(touch_press_x);
        const int dy = static_cast<int>(touch_last_y) - static_cast<int>(touch_press_y);

        if (touch_gesture_mode == TouchGestureMode::pending) {
            if (is_pending_motion(dx, dy)) {
                vTaskDelay(pdMS_TO_TICKS(TOUCH_POLL_MS));
                continue;
            }
            if (is_horizontal_lock(dx, dy)) {
                touch_gesture_mode = TouchGestureMode::horizontal_swipe;
                clear_tap_memory();
                touch_debug("gesture horizontal");
            }
        }

        if (touch_gesture_mode == TouchGestureMode::horizontal_swipe) {
            if (!touch_horizontal_swipe_fired && dx <= -TOUCH_HORIZONTAL_FIRE_DISTANCE) {
                touch_debug("swipe next");
                perform_page_switch(1);
                touch_horizontal_swipe_fired = true;
                touch_gesture_mode = TouchGestureMode::consumed;
            } else if (!touch_horizontal_swipe_fired && dx >= TOUCH_HORIZONTAL_FIRE_DISTANCE) {
                touch_debug("swipe prev");
                perform_page_switch(-1);
                touch_horizontal_swipe_fired = true;
                touch_gesture_mode = TouchGestureMode::consumed;
            }
        }
    } else if (!down && touch_was_down) {
        const int dx = static_cast<int>(touch_last_x) - static_cast<int>(touch_press_x);
        const int dy = static_cast<int>(touch_last_y) - static_cast<int>(touch_press_y);
        const int64_t now_us = esp_timer_get_time();

        if (touch_gesture_mode == TouchGestureMode::pending && is_small_release(dx, dy)) {
            touch_gesture_mode = TouchGestureMode::tap_candidate;
            handle_tap_release(touch_last_x, touch_last_y, now_us);
        } else if (touch_gesture_mode == TouchGestureMode::horizontal_swipe && !touch_horizontal_swipe_fired) {
            touch_debug("release incomplete horizontal");
        } else if (touch_gesture_mode == TouchGestureMode::consumed) {
            touch_debug("release consumed");
        }

        reset_touch_sequence();
    }

        vTaskDelay(pdMS_TO_TICKS(TOUCH_POLL_MS));
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
