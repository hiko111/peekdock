#include "ui/screens/peekdock_screen.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "lvgl.h"

LV_IMAGE_DECLARE(codex_idle_p2);
LV_IMAGE_DECLARE(codex_idle_p2_b);
LV_IMAGE_DECLARE(codex_running_p2);
LV_IMAGE_DECLARE(codex_running_p2_b);
LV_IMAGE_DECLARE(codex_completed_p2);
LV_IMAGE_DECLARE(codex_completed_p2_b);
LV_IMAGE_DECLARE(codex_error_p2);
LV_IMAGE_DECLARE(codex_error_p2_b);
LV_IMAGE_DECLARE(claude_idle_p2);
LV_IMAGE_DECLARE(claude_idle_p2_b);
LV_IMAGE_DECLARE(claude_running_p2);
LV_IMAGE_DECLARE(claude_running_p2_b);
LV_IMAGE_DECLARE(claude_completed_p2);
LV_IMAGE_DECLARE(claude_completed_p2_b);

static lv_obj_t* title_label = nullptr;
static lv_obj_t* hero_image = nullptr;
static lv_obj_t* percent_label = nullptr;
static lv_obj_t* task_type_label = nullptr;
static lv_obj_t* status_label = nullptr;
static lv_obj_t* title_small_label = nullptr;
static lv_obj_t* progress_bar = nullptr;
static lv_obj_t* progress_hint_label = nullptr;
static lv_obj_t* touch_debug_label = nullptr;
static lv_obj_t* input_layer = nullptr;
static lv_obj_t* page_dots[3] = {};
static lv_timer_t* animation_timer = nullptr;

static PeekDockTask current_task = {};
static PeekDockTask task_cache[4] = {};
static size_t task_cache_count = 0;
static size_t selected_task_index = 0;
static PeekDockScreenActionCallback action_callback = nullptr;
static int animation_tick = 0;
static uint32_t last_click_ms = 0;
static lv_point_t press_point = {};
static bool has_press_point = false;

static void apply_hero_layout(const PeekDockTask* task) {
    const bool is_claude = task && std::strcmp(task->source, "claude") == 0;
    lv_image_set_scale(hero_image, is_claude ? 284 : LV_SCALE_NONE);
    lv_obj_align(hero_image, LV_ALIGN_TOP_MID, 0, is_claude ? 58 : 64);
}

static void set_touch_debug(const char* text) {
    if (touch_debug_label) {
        lv_label_set_text(touch_debug_label, text);
    }
}

static void emit_action(const char* action) {
    if (action_callback) {
        action_callback(action);
    }
}

static const lv_image_dsc_t* image_frames_for_task(const PeekDockTask* task, int frame_index) {
    const bool alt = frame_index % 2 == 1;
    const bool is_claude = task && std::strcmp(task->source, "claude") == 0;
    if (!task) return alt ? &codex_idle_p2_b : &codex_idle_p2;
    if (is_claude) {
        if (std::strcmp(task->status, "completed") == 0) return alt ? &claude_completed_p2_b : &claude_completed_p2;
        if (std::strcmp(task->status, "failed") == 0) return alt ? &claude_completed_p2_b : &claude_completed_p2;
        if (std::strcmp(task->status, "needs_input") == 0) return alt ? &claude_completed_p2_b : &claude_completed_p2;
        if (std::strcmp(task->status, "running") == 0) return alt ? &claude_running_p2_b : &claude_running_p2;
        return alt ? &claude_idle_p2_b : &claude_idle_p2;
    }
    if (std::strcmp(task->status, "completed") == 0) return alt ? &codex_completed_p2_b : &codex_completed_p2;
    if (std::strcmp(task->status, "failed") == 0) return alt ? &codex_error_p2_b : &codex_error_p2;
    if (std::strcmp(task->status, "needs_input") == 0) return alt ? &codex_error_p2_b : &codex_error_p2;
    if (std::strcmp(task->status, "running") == 0) return alt ? &codex_running_p2_b : &codex_running_p2;
    return alt ? &codex_idle_p2_b : &codex_idle_p2;
}

static lv_color_t progress_color(const char* status) {
    if (std::strcmp(status, "completed") == 0) return lv_color_hex(0xff9f43);
    if (std::strcmp(status, "failed") == 0) return lv_color_hex(0xff5a54);
    if (std::strcmp(status, "needs_input") == 0) return lv_color_hex(0xffd166);
    if (std::strcmp(status, "running") == 0) return lv_color_hex(0xff6b1a);
    return lv_color_hex(0x5d5d5d);
}

static void set_dot_state(int active_index) {
    for (int i = 0; i < 3; ++i) {
        lv_obj_set_style_bg_opa(page_dots[i], i == active_index ? LV_OPA_COVER : LV_OPA_40, 0);
    }
}

static void set_agent_dots() {
    const int active = static_cast<int>(selected_task_index);
    for (int i = 0; i < 3; ++i) {
        const bool visible = i < static_cast<int>(task_cache_count) && i < 3;
        lv_obj_set_style_bg_opa(page_dots[i], visible ? (i == active ? LV_OPA_COVER : LV_OPA_40) : LV_OPA_0, 0);
    }
}

static void set_progress(const PeekDockTask* task) {
    int progress = task->progress;
    if (progress < 0) {
        if (std::strcmp(task->status, "completed") == 0) progress = 100;
        else if (std::strcmp(task->status, "failed") == 0) progress = 18;
        else if (std::strcmp(task->status, "needs_input") == 0) progress = 36;
        else progress = 54;
    }

    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;

    char percent_text[24];
    std::snprintf(percent_text, sizeof(percent_text), "%d%%", progress);
    lv_label_set_text(percent_label, percent_text);
    lv_bar_set_value(progress_bar, progress, LV_ANIM_OFF);
}

static void render_idle() {
    lv_label_set_text(title_label, "CodeX");
    lv_image_set_src(hero_image, &codex_idle_p2);
    apply_hero_layout(nullptr);
    lv_obj_add_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(percent_label, "--%");
    lv_label_set_text(task_type_label, "waiting");
    lv_label_set_text(status_label, "ready for next task");
    lv_label_set_text(title_small_label, "dock idle");
    lv_bar_set_value(progress_bar, 0, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x585858), LV_PART_MAIN);
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x585858), LV_PART_INDICATOR);
    lv_label_set_text(progress_hint_label, "mac idle");
    set_agent_dots();
    if (animation_timer) {
        lv_timer_pause(animation_timer);
    }
}

static void render_task(const PeekDockTask* task) {
    if (!task || task->task_id[0] == '\0') {
        render_idle();
        return;
    }

    current_task = *task;
    lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(title_label, task->agent_name[0] ? task->agent_name : "CodeX");
    lv_image_set_src(hero_image, image_frames_for_task(task, animation_tick));
    apply_hero_layout(task);
    set_progress(task);
    lv_label_set_text(task_type_label, task->task_type[0] ? task->task_type : "website");
    lv_label_set_text(status_label, task->status_text[0] ? task->status_text : "working");
    lv_label_set_text(title_small_label, task->title[0] ? task->title : "untitled task");
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x5b5b5b), LV_PART_MAIN);
    lv_obj_set_style_bg_color(progress_bar, progress_color(task->status), LV_PART_INDICATOR);
    lv_label_set_text(progress_hint_label, task->has_open_result ? "ready to review" : "working on device");
    set_agent_dots();

    animation_tick = 0;
    if (animation_timer) {
        lv_timer_resume(animation_timer);
    }
}

static void render_transition(const PeekDockEvent* event) {
    if (std::strcmp(event->event, "agent_idle_on_mac") == 0) {
        render_idle();
        return;
    }

    PeekDockTask transition_task = current_task;
    if (transition_task.agent_name[0] == '\0') {
        std::snprintf(transition_task.agent_name, sizeof(transition_task.agent_name), "CodeX");
    }

    if (std::strcmp(event->event, "handoff_to_dock") == 0) {
        std::snprintf(transition_task.status, sizeof(transition_task.status), "running");
        std::snprintf(transition_task.status_text, sizeof(transition_task.status_text), "syncing to dock...");
        std::snprintf(transition_task.title, sizeof(transition_task.title), "codex task entering dock");
        std::snprintf(transition_task.task_type, sizeof(transition_task.task_type), "handoff");
        transition_task.progress = 12;
        render_task(&transition_task);
        return;
    }

    if (std::strcmp(event->event, "return_to_mac") == 0) {
        lv_obj_add_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(title_label, "CodeX");
        lv_label_set_text(percent_label, "--%");
        lv_label_set_text(task_type_label, "on mac");
        lv_label_set_text(status_label, "returned to desktop");
        lv_label_set_text(title_small_label, transition_task.title[0] ? transition_task.title : "task on mac");
        lv_bar_set_value(progress_bar, 0, LV_ANIM_OFF);
        lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x585858), LV_PART_INDICATOR);
        lv_label_set_text(progress_hint_label, "mac owns agent");
        set_agent_dots();
        if (animation_timer) {
            lv_timer_pause(animation_timer);
        }
    }
}

static void running_tick(lv_timer_t*) {
    animation_tick = (animation_tick + 1) % 2;
    lv_image_set_src(hero_image, image_frames_for_task(&current_task, animation_tick));
    apply_hero_layout(&current_task);

    if (std::strcmp(current_task.status, "running") == 0) {
        set_agent_dots();
    } else if (std::strcmp(current_task.status, "completed") == 0) {
        set_agent_dots();
    } else if (std::strcmp(current_task.status, "failed") == 0) {
        set_agent_dots();
    } else {
        set_agent_dots();
    }
}

static void input_event_cb(lv_event_t* event) {
    const lv_event_code_t code = lv_event_get_code(event);

    if (code == LV_EVENT_PRESSED) {
        lv_indev_t* indev = lv_indev_active();
        if (indev) {
            lv_indev_get_point(indev, &press_point);
            has_press_point = true;
            char debug[96];
            std::snprintf(debug, sizeof(debug), "DOWN %d,%d", static_cast<int>(press_point.x), static_cast<int>(press_point.y));
            set_touch_debug(debug);
        }
        return;
    }

    if (code == LV_EVENT_RELEASED) {
        lv_indev_t* indev = lv_indev_active();
        lv_point_t release_point = {};
        if (indev) {
            lv_indev_get_point(indev, &release_point);
        }

        if (has_press_point) {
            const int dx = release_point.x - press_point.x;
            const int dy = release_point.y - press_point.y;
            char debug[120];
            std::snprintf(
                debug,
                sizeof(debug),
                "UP %d,%d dx=%d dy=%d",
                static_cast<int>(release_point.x),
                static_cast<int>(release_point.y),
                dx,
                dy
            );
            set_touch_debug(debug);
            if (dx < -36 && std::abs(dy) < 90) {
                set_touch_debug("LEFT SWIPE -> NEXT");
                emit_action("switch_agent_next");
                has_press_point = false;
                return;
            }
            if (dx > 36 && std::abs(dy) < 90) {
                set_touch_debug("RIGHT SWIPE -> PREV");
                emit_action("switch_agent_prev");
                has_press_point = false;
                return;
            }
            if (dy < -40 && std::abs(dx) < 90) {
                set_touch_debug("UP SWIPE -> MAC");
                emit_action("return_to_mac");
                has_press_point = false;
                return;
            }
        }
        has_press_point = false;
    }
}

void peekdock_screen_init() {
    lv_obj_t* root = lv_screen_active();
    lv_obj_set_style_bg_color(root, lv_color_hex(0x020202), 0);
    lv_obj_set_style_pad_all(root, 0, 0);

    title_label = lv_label_create(root);
    lv_label_set_text(title_label, "CodeX");
    lv_obj_set_style_text_color(title_label, lv_color_hex(0xf9f7f2), 0);
    lv_obj_set_style_text_font(title_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(title_label, LV_ALIGN_TOP_MID, 0, 14);

    hero_image = lv_image_create(root);
    lv_image_set_src(hero_image, &codex_idle_p2);
    lv_obj_align(hero_image, LV_ALIGN_TOP_MID, 0, 64);

    percent_label = lv_label_create(root);
    lv_label_set_text(percent_label, "--%");
    lv_obj_set_style_text_color(percent_label, lv_color_hex(0xf9f7f2), 0);
    lv_obj_set_style_text_font(percent_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(percent_label, LV_ALIGN_TOP_LEFT, 18, 186);

    task_type_label = lv_label_create(root);
    lv_label_set_text(task_type_label, "website");
    lv_obj_set_style_text_color(task_type_label, lv_color_hex(0xcfc7bb), 0);
    lv_obj_set_style_text_font(task_type_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(task_type_label, LV_ALIGN_TOP_LEFT, 18, 230);

    status_label = lv_label_create(root);
    lv_label_set_text(status_label, "ready for next task");
    lv_obj_set_width(status_label, 136);
    lv_label_set_long_mode(status_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(status_label, lv_color_hex(0xf9f7f2), 0);
    lv_obj_set_style_text_font(status_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(status_label, LV_ALIGN_TOP_LEFT, 18, 254);

    progress_bar = lv_bar_create(root);
    lv_obj_set_size(progress_bar, 124, 14);
    lv_obj_set_style_radius(progress_bar, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x5b5b5b), LV_PART_MAIN);
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0xff6b1a), LV_PART_INDICATOR);
    lv_obj_set_style_border_width(progress_bar, 0, 0);
    lv_obj_align(progress_bar, LV_ALIGN_TOP_LEFT, 18, 302);
    lv_bar_set_range(progress_bar, 0, 100);

    title_small_label = lv_label_create(root);
    lv_label_set_text(title_small_label, "dock idle");
    lv_obj_set_width(title_small_label, 136);
    lv_label_set_long_mode(title_small_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(title_small_label, lv_color_hex(0xa8a29b), 0);
    lv_obj_set_style_text_font(title_small_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(title_small_label, LV_ALIGN_TOP_LEFT, 18, 324);

    progress_hint_label = lv_label_create(root);
    lv_label_set_text(progress_hint_label, "mac idle");
    lv_obj_set_style_text_color(progress_hint_label, lv_color_hex(0x7f7c75), 0);
    lv_obj_set_style_text_font(progress_hint_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(progress_hint_label, LV_ALIGN_TOP_LEFT, 18, 346);

    touch_debug_label = lv_label_create(root);
    lv_label_set_text(touch_debug_label, "touch debug: ready");
    lv_obj_set_width(touch_debug_label, 150);
    lv_label_set_long_mode(touch_debug_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(touch_debug_label, lv_color_hex(0x69d2ff), 0);
    lv_obj_set_style_text_font(touch_debug_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(touch_debug_label, LV_ALIGN_BOTTOM_MID, 0, -28);

    for (int i = 0; i < 3; ++i) {
        page_dots[i] = lv_obj_create(root);
        lv_obj_remove_style_all(page_dots[i]);
        lv_obj_set_size(page_dots[i], 10, 10);
        lv_obj_set_style_radius(page_dots[i], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(page_dots[i], lv_color_hex(0xf2efeb), 0);
        lv_obj_align(page_dots[i], LV_ALIGN_BOTTOM_MID, (i - 1) * 20, -10);
    }

    input_layer = lv_obj_create(root);
    lv_obj_remove_style_all(input_layer);
    lv_obj_set_size(input_layer, lv_pct(100), lv_pct(100));
    lv_obj_align(input_layer, LV_ALIGN_CENTER, 0, 0);
    lv_obj_add_flag(input_layer, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(input_layer, input_event_cb, LV_EVENT_PRESSED, nullptr);
    lv_obj_add_event_cb(input_layer, input_event_cb, LV_EVENT_RELEASED, nullptr);
    lv_obj_move_foreground(input_layer);

    animation_timer = lv_timer_create(running_tick, 420, nullptr);
    lv_timer_pause(animation_timer);
    task_cache_count = 0;
    selected_task_index = 0;
    render_idle();
}

void peekdock_screen_apply_event(const PeekDockEvent* event) {
    if (!event) return;

    if (std::strcmp(event->type, "transition_event") == 0) {
        render_transition(event);
        return;
    }

    if (std::strcmp(event->type, "task_snapshot") == 0 && event->task_count > 0) {
        task_cache_count = event->task_count > 4 ? 4 : event->task_count;
        for (size_t i = 0; i < task_cache_count; ++i) {
            task_cache[i] = event->tasks[i];
        }
        if (selected_task_index >= task_cache_count) {
            selected_task_index = 0;
        }
        render_task(&task_cache[selected_task_index]);
        return;
    }

    if (std::strcmp(event->type, "task_update") == 0) {
        bool replaced = false;
        for (size_t i = 0; i < task_cache_count; ++i) {
            if (std::strcmp(task_cache[i].task_id, event->task.task_id) == 0) {
                task_cache[i] = event->task;
                replaced = true;
                break;
            }
        }
        if (!replaced && task_cache_count < 4) {
            task_cache[task_cache_count++] = event->task;
        }
        for (size_t i = 0; i < task_cache_count; ++i) {
            if (std::strcmp(task_cache[i].task_id, event->task.task_id) == 0) {
                selected_task_index = i;
                render_task(&task_cache[selected_task_index]);
                return;
            }
        }
        render_task(&event->task);
    }
}

void peekdock_screen_set_action_callback(PeekDockScreenActionCallback callback) {
    action_callback = callback;
}

void peekdock_screen_set_touch_debug(const char* text) {
    set_touch_debug(text);
}
