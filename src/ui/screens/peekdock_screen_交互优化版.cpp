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
LV_IMAGE_DECLARE(jimeng_idle_p2);
LV_IMAGE_DECLARE(jimeng_idle_p2_b);
LV_IMAGE_DECLARE(jimeng_running_p2);
LV_IMAGE_DECLARE(jimeng_running_p2_b);
LV_IMAGE_DECLARE(jimeng_completed_p2);
LV_IMAGE_DECLARE(jimeng_completed_p2_b);

static lv_obj_t* content_layer = nullptr;
static lv_obj_t* title_label = nullptr;
static lv_obj_t* title_pill = nullptr;
static lv_obj_t* status_dot = nullptr;
static lv_obj_t* hero_image = nullptr;
static lv_obj_t* percent_group = nullptr;
static lv_obj_t* percent_label = nullptr;
static lv_obj_t* percent_unit_label = nullptr;
static lv_obj_t* task_type_label = nullptr;
static lv_obj_t* status_label = nullptr;
static lv_obj_t* title_small_label = nullptr;
static lv_obj_t* progress_bar = nullptr;
static lv_obj_t* progress_pulse = nullptr;
static lv_obj_t* accept_button = nullptr;
static lv_obj_t* accept_label = nullptr;
static lv_obj_t* idle_panel = nullptr;
static lv_obj_t* idle_tail = nullptr;
static lv_obj_t* idle_text_label = nullptr;
static lv_obj_t* mood_label = nullptr;
static lv_obj_t* mood_bubble = nullptr;
static lv_obj_t* tool_chip = nullptr;
static lv_obj_t* tool_dot = nullptr;
static lv_obj_t* touch_debug_label = nullptr;
static lv_obj_t* page_dots[3] = {};
static lv_obj_t* burst_particles[10] = {};
static lv_timer_t* animation_timer = nullptr;
static lv_timer_t* hero_drag_timer = nullptr;
static lv_timer_t* typewriter_timer = nullptr;
static PeekDockScreenActionCallback action_callback = nullptr;

static PeekDockTask current_task = {};
static PeekDockTask task_cache[4] = {};
static size_t task_cache_count = 0;
static size_t selected_task_index = 0;
static int animation_tick = 0;
static int transition_direction = 0;
static int displayed_progress = 0;
static int current_progress = 0;
static int pulse_tick = 0;
static int last_pulse_x = -100;
static int progress_milestone_mask = 0;
static int typewriter_index = 0;
static int hero_drag_progress = 0;
static int hero_drag_applied_progress = -1;
static volatile int hero_drag_requested_progress = -1;
static volatile int hero_drag_requested_command = 0;
static bool hero_dragging = false;
static volatile bool hero_locally_hidden = false;
static volatile bool touch_debug_pending = false;
static char last_rendered_task_id[64] = {};
static char last_rendered_status[24] = {};
static char typewriter_text[96] = {};
static char touch_debug_text[96] = {};

static constexpr int HERO_COMMAND_HIDE = 1;
static constexpr int HERO_COMMAND_RESTORE = 2;

static void consume_hero_drag_requests();

static void scale_exec(void* obj, int32_t value) {
    lv_obj_set_style_transform_scale(static_cast<lv_obj_t*>(obj), value, 0);
}

static void translate_y_exec(void* obj, int32_t value) {
    lv_obj_set_style_translate_y(static_cast<lv_obj_t*>(obj), value, 0);
}

static void translate_x_exec(void* obj, int32_t value) {
    lv_obj_set_style_translate_x(static_cast<lv_obj_t*>(obj), value, 0);
}

static void opa_exec(void* obj, int32_t value) {
    lv_obj_set_style_opa(static_cast<lv_obj_t*>(obj), static_cast<lv_opa_t>(value), 0);
}

static void text_opa_exec(void* obj, int32_t value) {
    lv_obj_set_style_text_opa(static_cast<lv_obj_t*>(obj), static_cast<lv_opa_t>(value), 0);
}

static void bg_opa_exec(void* obj, int32_t value) {
    lv_obj_set_style_bg_opa(static_cast<lv_obj_t*>(obj), static_cast<lv_opa_t>(value), 0);
}

static void shadow_opa_exec(void* obj, int32_t value) {
    lv_obj_set_style_shadow_opa(static_cast<lv_obj_t*>(obj), static_cast<lv_opa_t>(value), 0);
}

static void make_passive(lv_obj_t* obj) {
    if (!obj) return;
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_CHECKABLE);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_PRESS_LOCK);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_ADV_HITTEST);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_SNAPPABLE);
    lv_obj_remove_state(obj, LV_STATE_PRESSED);
    lv_obj_remove_state(obj, LV_STATE_FOCUSED);
}

static bool is_claude_task(const PeekDockTask* task) {
    return task && std::strcmp(task->source, "claude") == 0;
}

static bool is_jimeng_task(const PeekDockTask* task) {
    return task && std::strcmp(task->source, "jimeng") == 0;
}

static lv_color_t agent_color(const PeekDockTask* task) {
    if (is_claude_task(task)) return lv_color_hex(0xf29b52);
    if (is_jimeng_task(task)) return lv_color_hex(0xa875ff);
    return lv_color_hex(0x69c86e);
}

static void apply_hero_layout(const PeekDockTask* task) {
    const bool is_claude = is_claude_task(task);
    const bool is_jimeng = is_jimeng_task(task);
    const int32_t scale = is_claude ? 286 : is_jimeng ? 238 : LV_SCALE_NONE;
    const lv_coord_t y = is_claude ? 54 : is_jimeng ? 67 : 62;
    lv_image_set_scale(hero_image, scale);
    lv_obj_align(hero_image, LV_ALIGN_TOP_MID, 0, y);
}

static void delete_hero_motion_anims() {
    if (!hero_image) return;
    lv_anim_delete(hero_image, scale_exec);
    lv_anim_delete(hero_image, translate_y_exec);
    lv_anim_delete(hero_image, translate_x_exec);
    lv_anim_delete(hero_image, opa_exec);
}

static void reset_hero_local_transform(bool show) {
    if (!hero_image) return;
    hero_drag_progress = 0;
    hero_dragging = false;
    lv_obj_set_style_translate_y(hero_image, 0, 0);
    lv_obj_set_style_translate_x(hero_image, 0, 0);
    lv_obj_set_style_transform_scale(hero_image, 256, 0);
    lv_obj_set_style_opa(hero_image, LV_OPA_COVER, 0);
    if (show) {
        hero_locally_hidden = false;
        lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    }
}

static void restore_hidden_hero_for_new_context() {
    if (!hero_locally_hidden && !hero_dragging) return;
    delete_hero_motion_anims();
    reset_hero_local_transform(true);
    hero_drag_applied_progress = -1;
    hero_drag_requested_progress = -1;
    hero_drag_requested_command = 0;
}

static void update_title_pill(const PeekDockTask* task) {
    if (!title_pill || !title_label) return;
    const lv_color_t accent = agent_color(task);
    lv_obj_set_style_bg_color(title_pill, lv_color_mix(accent, lv_color_hex(0x050608), 72), 0);
    lv_obj_set_style_border_color(title_pill, lv_color_mix(accent, lv_color_hex(0xffffff), 58), 0);
    lv_obj_set_style_shadow_color(title_pill, accent, 0);
    lv_obj_set_style_text_color(title_label, lv_color_hex(0xf9fbf7), 0);
}

static void set_touch_debug(const char* text) {
    std::snprintf(touch_debug_text, sizeof(touch_debug_text), "%s", text ? text : "");
    touch_debug_pending = true;
}

static void consume_touch_debug() {
    if (!touch_debug_pending || !touch_debug_label) return;
    touch_debug_pending = false;
    lv_label_set_text(touch_debug_label, touch_debug_text);
    lv_obj_clear_flag(touch_debug_label, LV_OBJ_FLAG_HIDDEN);
}

static const lv_image_dsc_t* image_frames_for_task(const PeekDockTask* task, int frame_index) {
    const bool alt = frame_index % 2 == 1;
    const bool is_claude = task && std::strcmp(task->source, "claude") == 0;
    const bool is_jimeng = task && std::strcmp(task->source, "jimeng") == 0;
    if (!task) return alt ? &codex_idle_p2_b : &codex_idle_p2;
    if (is_jimeng) {
        if (std::strcmp(task->status, "completed") == 0) return alt ? &jimeng_completed_p2_b : &jimeng_completed_p2;
        if (std::strcmp(task->status, "running") == 0) return alt ? &jimeng_running_p2_b : &jimeng_running_p2;
        return alt ? &jimeng_idle_p2_b : &jimeng_idle_p2;
    }
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

static lv_color_t signal_color_for_task(const PeekDockTask* task) {
    if (!task || std::strcmp(task->status, "idle") == 0) return lv_color_hex(0x69c86e);
    if (std::strcmp(task->status, "failed") == 0) return lv_color_hex(0xf0645b);
    if (std::strcmp(task->status, "needs_input") == 0) return lv_color_hex(0x6da8ff);
    if (std::strcmp(task->status, "completed") == 0) return lv_color_hex(0xf2c66d);
    return agent_color(task);
}

static void set_signal_color(lv_color_t color, bool glow) {
    lv_obj_set_style_bg_color(status_dot, color, 0);
    lv_obj_set_style_shadow_color(status_dot, color, 0);
    lv_obj_set_style_shadow_opa(status_dot, glow ? LV_OPA_50 : LV_OPA_20, 0);
    if (tool_dot) lv_obj_set_style_bg_color(tool_dot, color, 0);
}

static const char* task_type_fallback(const PeekDockTask* task) {
    if (!task) return "standby";
    if (task->task_type[0]) return task->task_type;
    if (std::strcmp(task->source, "claude") == 0) return "writing";
    if (std::strcmp(task->source, "jimeng") == 0) return "visual";
    return "coding";
}

static const char* agent_label_for_task(const PeekDockTask* task) {
    if (!task) return "CODEX";
    if (std::strcmp(task->source, "claude") == 0) return "CLAUDE";
    if (std::strcmp(task->source, "jimeng") == 0) return "JIMENG";
    return "CODEX";
}

static const char* primary_status_for_task(const PeekDockTask* task) {
    if (!task) return "Ready";
    if (std::strcmp(task->status, "completed") == 0) return "Done";
    if (std::strcmp(task->status, "failed") == 0) return "Error";
    if (std::strcmp(task->status, "needs_input") == 0) return "Input";
    if (std::strcmp(task->status, "idle") == 0) return "Idle";
    return "Working";
}

static bool contains_ci(const char* text, const char* needle) {
    if (!text || !needle || needle[0] == '\0') return false;
    const size_t needle_len = std::strlen(needle);
    for (size_t i = 0; text[i] != '\0'; ++i) {
        size_t j = 0;
        while (j < needle_len && text[i + j] != '\0') {
            char a = text[i + j];
            char b = needle[j];
            if (a >= 'A' && a <= 'Z') a = static_cast<char>(a - 'A' + 'a');
            if (b >= 'A' && b <= 'Z') b = static_cast<char>(b - 'A' + 'a');
            if (a != b) break;
            ++j;
        }
        if (j == needle_len) return true;
    }
    return false;
}

static bool task_needs_confirmation(const PeekDockTask* task) {
    if (!task) return false;
    if (std::strcmp(task->status, "needs_input") == 0) return true;
    return contains_ci(task->status_text, "waiting for confirmation") ||
        contains_ci(task->status_text, "confirmation required");
}

static const char* confirmation_title_for_task(const PeekDockTask* task) {
    (void)task;
    return "Review";
}

static const char* phase_text_for_task(const PeekDockTask* task) {
    if (!task) return "idle";
    if (task_needs_confirmation(task)) return "waiting...";
    if (task->status_text[0] != '\0') return task->status_text;
    if (std::strcmp(task->status, "completed") == 0) return "completed";
    if (std::strcmp(task->status, "failed") == 0) return "error";
    if (std::strcmp(task->status, "idle") == 0) return "idle";
    return "analyzing";
}

static bool is_generic_task_title(const char* title) {
    if (!title || title[0] == '\0') return true;
    return std::strcmp(title, "Real Codex task") == 0 ||
        std::strcmp(title, "Real Claude task") == 0 ||
        std::strcmp(title, "Codex task") == 0 ||
        std::strcmp(title, "Claude task") == 0;
}

static const char* chip_label_for_task(const PeekDockTask* task) {
    if (!task) return "idle";
    if (std::strcmp(task->status, "completed") == 0) return "done";
    if (std::strcmp(task->status, "failed") == 0) return "error";
    if (std::strcmp(task->status, "needs_input") == 0) return "input";
    if (std::strcmp(task->source, "jimeng") == 0) return "image";
    if (std::strcmp(task->source, "claude") == 0) return "write";
    return "shell";
}

static void compact_title(const char* input, char* output, size_t output_size) {
    if (!output || output_size == 0) return;
    const char* fallback = "Task brief";
    if (!input || input[0] == '\0') input = fallback;

    char normalized[64] = {};
    size_t w = 0;
    bool last_space = false;
    for (size_t r = 0; input[r] != '\0' && w + 1 < sizeof(normalized); ++r) {
        const unsigned char c = static_cast<unsigned char>(input[r]);
        if (c >= 0x80) {
            std::snprintf(output, output_size, "Task brief");
            return;
        }
        if (c == '\n' || c == '\r' || c == '\t' || c == ' ') {
            if (!last_space && w > 0) normalized[w++] = ' ';
            last_space = true;
            continue;
        }
        if (c == '.' || c == ',' || c == ';' || c == ':' || c == '?' || c == '!') {
            if (w >= 14) break;
            continue;
        }
        normalized[w++] = static_cast<char>(c);
        last_space = false;
    }
    while (w > 0 && normalized[w - 1] == ' ') --w;
    normalized[w] = '\0';

    if (w == 0) {
        std::snprintf(output, output_size, "%s", fallback);
        return;
    }
    if (w > 24) {
        normalized[21] = '.';
        normalized[22] = '.';
        normalized[23] = '.';
        normalized[24] = '\0';
    }
    std::snprintf(output, output_size, "%s", normalized);
}

static void set_agent_dots() {
    const int active = static_cast<int>(selected_task_index);
    for (int i = 0; i < 3; ++i) {
        lv_obj_set_size(page_dots[i], i == active ? 18 : 6, 6);
        lv_obj_set_style_bg_color(page_dots[i], lv_color_hex(0xffffff), 0);
        lv_obj_set_style_bg_opa(page_dots[i], i == active ? LV_OPA_COVER : LV_OPA_40, 0);
        lv_obj_align(page_dots[i], LV_ALIGN_BOTTOM_MID, (i - 1) * 18, -18);
    }
}

static void set_percent_label(int progress) {
    char percent_text[12];
    std::snprintf(percent_text, sizeof(percent_text), "%d", progress);
    lv_label_set_text(percent_label, percent_text);
    lv_obj_align(percent_group, LV_ALIGN_TOP_MID, 0, 242);
    lv_obj_align(percent_label, LV_ALIGN_LEFT_MID, 7, -1);
    lv_obj_align(percent_unit_label, LV_ALIGN_RIGHT_MID, -9, 4);
}

static void set_label_text_fade(lv_obj_t* label, const char* text) {
    if (!label) return;
    const char* next = text ? text : "";
    const char* current = lv_label_get_text(label);
    if (current && std::strcmp(current, next) == 0) return;
    static char pending_status_text[64] = {};
    static char pending_small_text[96] = {};
    char* pending = label == status_label ? pending_status_text : pending_small_text;
    const size_t pending_size = label == status_label ? sizeof(pending_status_text) : sizeof(pending_small_text);
    std::snprintf(pending, pending_size, "%s", next);

    lv_anim_delete(label, text_opa_exec);
    lv_anim_t out;
    lv_anim_init(&out);
    lv_anim_set_var(&out, label);
    lv_anim_set_values(&out, LV_OPA_COVER, LV_OPA_TRANSP);
    lv_anim_set_time(&out, 120);
    lv_anim_set_exec_cb(&out, text_opa_exec);
    lv_anim_set_completed_cb(&out, [](lv_anim_t* anim) {
        lv_obj_t* target = static_cast<lv_obj_t*>(anim->var);
        const char* pending_text = static_cast<const char*>(lv_anim_get_user_data(anim));
        lv_label_set_text(target, pending_text ? pending_text : "");
        lv_anim_t in;
        lv_anim_init(&in);
        lv_anim_set_var(&in, target);
        lv_anim_set_values(&in, LV_OPA_TRANSP, LV_OPA_COVER);
        lv_anim_set_time(&in, 150);
        lv_anim_set_delay(&in, 80);
        lv_anim_set_path_cb(&in, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&in, text_opa_exec);
        lv_anim_start(&in);
    });
    lv_anim_set_user_data(&out, pending);
    lv_anim_start(&out);
}

static void start_progress_head_flash() {
    if (!progress_pulse) return;
    lv_obj_set_style_bg_color(progress_pulse, lv_color_hex(0xffffff), 0);
    lv_obj_set_style_bg_opa(progress_pulse, LV_OPA_COVER, 0);
    lv_anim_t flash;
    lv_anim_init(&flash);
    lv_anim_set_var(&flash, progress_pulse);
    lv_anim_set_values(&flash, LV_OPA_COVER, LV_OPA_40);
    lv_anim_set_time(&flash, 30);
    lv_anim_set_exec_cb(&flash, bg_opa_exec);
    lv_anim_set_completed_cb(&flash, [](lv_anim_t* anim) {
        lv_obj_t* obj = static_cast<lv_obj_t*>(anim->var);
        lv_obj_set_style_bg_color(obj, agent_color(&current_task), 0);
    });
    lv_anim_start(&flash);
}

static void bounce_progress_bar() {
    if (!progress_bar) return;
    lv_obj_set_style_transform_pivot_x(progress_bar, 63, 0);
    lv_obj_set_style_transform_pivot_y(progress_bar, 3, 0);

    lv_anim_t up;
    lv_anim_init(&up);
    lv_anim_set_var(&up, progress_bar);
    lv_anim_set_values(&up, 256, 294);
    lv_anim_set_time(&up, 100);
    lv_anim_set_path_cb(&up, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&up, [](void* obj, int32_t value) {
        lv_obj_set_style_transform_scale(static_cast<lv_obj_t*>(obj), value, 0);
    });
    lv_anim_set_completed_cb(&up, [](lv_anim_t* anim) {
        lv_anim_t down;
        lv_anim_init(&down);
        lv_anim_set_var(&down, anim->var);
        lv_anim_set_values(&down, 294, 256);
        lv_anim_set_time(&down, 100);
        lv_anim_set_path_cb(&down, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&down, [](void* obj, int32_t value) {
            lv_obj_set_style_transform_scale(static_cast<lv_obj_t*>(obj), value, 0);
        });
        lv_anim_start(&down);
    });
    lv_anim_start(&up);
}

static void bounce_progress_head() {
    if (!progress_pulse) return;
    lv_obj_set_style_transform_pivot_x(progress_pulse, 9, 0);
    lv_obj_set_style_transform_pivot_y(progress_pulse, 3, 0);
    lv_anim_t up;
    lv_anim_init(&up);
    lv_anim_set_var(&up, progress_pulse);
    lv_anim_set_values(&up, 256, 294);
    lv_anim_set_time(&up, 100);
    lv_anim_set_path_cb(&up, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&up, scale_exec);
    lv_anim_set_completed_cb(&up, [](lv_anim_t* anim) {
        lv_anim_t down;
        lv_anim_init(&down);
        lv_anim_set_var(&down, anim->var);
        lv_anim_set_values(&down, 294, 256);
        lv_anim_set_time(&down, 100);
        lv_anim_set_path_cb(&down, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&down, scale_exec);
        lv_anim_start(&down);
    });
    lv_anim_start(&up);
}

static void maybe_trigger_progress_milestone(int progress) {
    static const int milestones[] = {25, 50, 75};
    for (int i = 0; i < 3; ++i) {
        const int bit = 1 << i;
        if (progress >= milestones[i] && (progress_milestone_mask & bit) == 0) {
            progress_milestone_mask |= bit;
            bounce_progress_bar();
            bounce_progress_head();
        }
    }
}

static void layout_progress_pulse(const PeekDockTask* task) {
    if (!progress_pulse || !task) return;
    const bool running = std::strcmp(task->status, "running") == 0 && current_progress > 4 && !task_needs_confirmation(task);
    if (!running) {
        lv_obj_add_flag(progress_pulse, LV_OBJ_FLAG_HIDDEN);
        last_pulse_x = -100;
        return;
    }

    lv_obj_clear_flag(progress_pulse, LV_OBJ_FLAG_HIDDEN);
    const int rail_x = (172 - 126) / 2;
    const int rail_y = 224;
    const int filled = (126 * current_progress) / 100;
    const int travel = filled > 18 ? filled - 18 : 1;
    const int x = rail_x + ((pulse_tick * 7) % travel);
    const lv_opa_t opa = (pulse_tick % 3) == 0 ? LV_OPA_COVER : (pulse_tick % 3) == 1 ? LV_OPA_70 : LV_OPA_40;
    lv_obj_set_pos(progress_pulse, x, rail_y);
    lv_obj_set_style_opa(progress_pulse, opa, 0);
    lv_obj_set_style_bg_color(progress_pulse, agent_color(task), 0);
    if (last_pulse_x >= 0 && x - last_pulse_x >= 8) {
        start_progress_head_flash();
    }
    last_pulse_x = x;
}

static void set_progress_area_mode(const PeekDockTask* task) {
    const bool show_accept = task_needs_confirmation(task);
    const bool show_idle = task && std::strcmp(task->status, "idle") == 0;
    if (show_idle) {
        if (percent_group) lv_obj_add_flag(percent_group, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(percent_label, LV_OBJ_FLAG_HIDDEN);
        if (percent_unit_label) lv_obj_add_flag(percent_unit_label, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(progress_bar, LV_OBJ_FLAG_HIDDEN);
        if (progress_pulse) lv_obj_add_flag(progress_pulse, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(accept_button, LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(idle_panel, LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(idle_tail, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    lv_obj_add_flag(idle_panel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(idle_tail, LV_OBJ_FLAG_HIDDEN);
    if (show_accept) {
        if (percent_group) lv_obj_add_flag(percent_group, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(percent_label, LV_OBJ_FLAG_HIDDEN);
        if (percent_unit_label) lv_obj_add_flag(percent_unit_label, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(progress_bar, LV_OBJ_FLAG_HIDDEN);
        if (progress_pulse) lv_obj_add_flag(progress_pulse, LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(accept_button, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_bg_color(accept_button, agent_color(task), 0);
        lv_obj_set_style_shadow_color(accept_button, agent_color(task), 0);
        return;
    }
    if (percent_group) lv_obj_clear_flag(percent_group, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(percent_label, LV_OBJ_FLAG_HIDDEN);
    if (percent_unit_label) lv_obj_clear_flag(percent_unit_label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(progress_bar, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(accept_button, LV_OBJ_FLAG_HIDDEN);
}

static void animate_percent_to(int progress) {
    lv_anim_t number;
    lv_anim_init(&number);
    lv_anim_set_var(&number, &displayed_progress);
    lv_anim_set_values(&number, displayed_progress, progress);
    lv_anim_set_time(&number, 380);
    lv_anim_set_path_cb(&number, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&number, [](void* value_ptr, int32_t value) {
        *static_cast<int*>(value_ptr) = value;
        set_percent_label(value);
    });
    lv_anim_start(&number);
}

static void set_progress(const PeekDockTask* task, bool animate) {
    const int previous_progress = current_progress;
    int progress = task->progress;
    if (progress < 0) {
        if (std::strcmp(task->status, "completed") == 0) progress = 100;
        else if (std::strcmp(task->status, "failed") == 0) progress = 18;
        else if (std::strcmp(task->status, "needs_input") == 0) progress = 36;
        else if (std::strcmp(task->status, "idle") == 0) progress = 0;
        else progress = 54;
    }

    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;
    current_progress = progress;

    if (animate) {
        animate_percent_to(progress);
        lv_bar_set_value(progress_bar, progress, LV_ANIM_ON);
    } else {
        displayed_progress = progress;
        set_percent_label(progress);
        lv_bar_set_value(progress_bar, progress, LV_ANIM_OFF);
    }
    layout_progress_pulse(task);
    if (std::strcmp(task->status, "running") == 0 && progress > previous_progress) {
        maybe_trigger_progress_milestone(progress);
    }
}

static PeekDockTask placeholder_task(size_t index) {
    PeekDockTask task = {};
    if (index == 1) {
        std::snprintf(task.task_id, sizeof(task.task_id), "placeholder_claude");
        std::snprintf(task.source, sizeof(task.source), "claude");
        std::snprintf(task.agent_name, sizeof(task.agent_name), "Claude");
        std::snprintf(task.title, sizeof(task.title), "Writing queue");
        std::snprintf(task.task_type, sizeof(task.task_type), "writing");
        std::snprintf(task.status, sizeof(task.status), "idle");
        std::snprintf(task.status_text, sizeof(task.status_text), "idle");
        task.progress = -1;
        return task;
    }
    if (index == 2) {
        std::snprintf(task.task_id, sizeof(task.task_id), "placeholder_jimeng");
        std::snprintf(task.source, sizeof(task.source), "jimeng");
        std::snprintf(task.agent_name, sizeof(task.agent_name), "JIMENG");
        std::snprintf(task.title, sizeof(task.title), "Image queue");
        std::snprintf(task.task_type, sizeof(task.task_type), "visual");
        std::snprintf(task.status, sizeof(task.status), "idle");
        std::snprintf(task.status_text, sizeof(task.status_text), "idle");
        task.progress = -1;
        return task;
    }
    std::snprintf(task.task_id, sizeof(task.task_id), "placeholder_codex");
    std::snprintf(task.source, sizeof(task.source), "codex");
    std::snprintf(task.agent_name, sizeof(task.agent_name), "CodeX");
    std::snprintf(task.title, sizeof(task.title), "Code queue");
    std::snprintf(task.task_type, sizeof(task.task_type), "coding");
    std::snprintf(task.status, sizeof(task.status), "idle");
    std::snprintf(task.status_text, sizeof(task.status_text), "idle");
    task.progress = -1;
    return task;
}

static PeekDockTask task_for_page(size_t index) {
    if (index < task_cache_count) return task_cache[index];
    return placeholder_task(index);
}

static size_t page_index_for_source(const char* source) {
    if (source && std::strcmp(source, "claude") == 0) return 1;
    if (source && std::strcmp(source, "jimeng") == 0) return 2;
    return 0;
}

static bool upsert_task_for_source(const PeekDockTask* task) {
    if (!task || task->task_id[0] == '\0') return false;
    const size_t page_index = page_index_for_source(task->source);
    while (task_cache_count <= page_index && task_cache_count < 3) {
        task_cache[task_cache_count] = placeholder_task(task_cache_count);
        ++task_cache_count;
    }

    const bool is_new_task = std::strcmp(task_cache[page_index].task_id, task->task_id) != 0;
    task_cache[page_index] = *task;
    return is_new_task;
}

static void animate_content_in(int direction) {
    if (!content_layer) return;
    const int start_x = direction == 0 ? 0 : direction * 16;
    lv_obj_set_x(content_layer, start_x);
    lv_obj_set_style_opa(content_layer, LV_OPA_COVER, 0);
    lv_obj_set_style_transform_scale(content_layer, 256, 0);

    if (direction != 0) {
        lv_anim_t slide;
        lv_anim_init(&slide);
        lv_anim_set_var(&slide, content_layer);
        lv_anim_set_values(&slide, start_x, 0);
        lv_anim_set_time(&slide, 240);
        lv_anim_set_path_cb(&slide, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&slide, [](void* obj, int32_t value) {
            lv_obj_set_x(static_cast<lv_obj_t*>(obj), value);
        });
        lv_anim_start(&slide);
    }
}

static void animate_hero_enter(int32_t start_scale, int32_t end_scale, lv_opa_t start_opa = LV_OPA_40) {
    if (!hero_image) return;
    if (hero_locally_hidden || hero_dragging) return;
    lv_obj_set_style_transform_pivot_x(hero_image, 54, 0);
    lv_obj_set_style_transform_pivot_y(hero_image, 54, 0);
    lv_obj_set_style_transform_scale(hero_image, start_scale, 0);
    lv_obj_set_style_opa(hero_image, start_opa, 0);

    lv_anim_t scale;
    lv_anim_init(&scale);
    lv_anim_set_var(&scale, hero_image);
    lv_anim_set_values(&scale, start_scale, end_scale);
    lv_anim_set_time(&scale, 240);
    lv_anim_set_path_cb(&scale, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&scale, [](void* obj, int32_t value) {
        lv_obj_set_style_transform_scale(static_cast<lv_obj_t*>(obj), value, 0);
    });
    lv_anim_start(&scale);

    lv_anim_t fade;
    lv_anim_init(&fade);
    lv_anim_set_var(&fade, hero_image);
    lv_anim_set_values(&fade, start_opa, LV_OPA_COVER);
    lv_anim_set_time(&fade, 240);
    lv_anim_set_path_cb(&fade, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&fade, [](void* obj, int32_t value) {
        lv_obj_set_style_opa(static_cast<lv_obj_t*>(obj), static_cast<lv_opa_t>(value), 0);
    });
    lv_anim_start(&fade);
}

static void animate_state_change() {
    animate_hero_enter(226, 256, LV_OPA_60);
}

static void start_hero_breath(const PeekDockTask* task) {
    if (!hero_image || !task) return;
    if (hero_locally_hidden || hero_dragging) return;
    lv_anim_delete(hero_image, scale_exec);
    lv_anim_delete(hero_image, translate_x_exec);
    lv_anim_delete(hero_image, translate_y_exec);
    lv_obj_set_style_translate_x(hero_image, 0, 0);
    lv_obj_set_style_translate_y(hero_image, 0, 0);
    lv_obj_set_style_transform_pivot_x(hero_image, 54, 0);
    lv_obj_set_style_transform_pivot_y(hero_image, 54, 0);

    if (std::strcmp(task->status, "completed") == 0) {
        lv_anim_t pop;
        lv_anim_init(&pop);
        lv_anim_set_var(&pop, hero_image);
        lv_anim_set_values(&pop, 254, 268);
        lv_anim_set_time(&pop, 160);
        lv_anim_set_path_cb(&pop, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&pop, scale_exec);
        lv_anim_set_completed_cb(&pop, [](lv_anim_t* anim) {
            lv_anim_t settle;
            lv_anim_init(&settle);
            lv_anim_set_var(&settle, anim->var);
            lv_anim_set_values(&settle, 268, 256);
            lv_anim_set_time(&settle, 180);
            lv_anim_set_path_cb(&settle, lv_anim_path_ease_out);
            lv_anim_set_exec_cb(&settle, scale_exec);
            lv_anim_start(&settle);
        });
        lv_anim_start(&pop);
        return;
    }

    const bool running = std::strcmp(task->status, "running") == 0;
    const int32_t min_scale = running ? 254 : 254;
    const int32_t max_scale = running ? 262 : 258;
    const uint32_t duration = running ? 1000 : 1500;
    lv_anim_t breath;
    lv_anim_init(&breath);
    lv_anim_set_var(&breath, hero_image);
    lv_anim_set_values(&breath, min_scale, max_scale);
    lv_anim_set_time(&breath, duration);
    lv_anim_set_playback_time(&breath, duration);
    lv_anim_set_repeat_count(&breath, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_path_cb(&breath, lv_anim_path_ease_in_out);
    lv_anim_set_exec_cb(&breath, scale_exec);
    lv_anim_start(&breath);

    lv_anim_t gesture;
    lv_anim_init(&gesture);
    lv_anim_set_var(&gesture, hero_image);
    lv_anim_set_path_cb(&gesture, lv_anim_path_ease_in_out);
    lv_anim_set_repeat_count(&gesture, LV_ANIM_REPEAT_INFINITE);
    if (is_claude_task(task)) {
        lv_anim_set_values(&gesture, -3, 3);
        lv_anim_set_time(&gesture, 1200);
        lv_anim_set_playback_time(&gesture, 1200);
        lv_anim_set_exec_cb(&gesture, translate_x_exec);
    } else if (is_jimeng_task(task)) {
        lv_anim_set_values(&gesture, -4, 4);
        lv_anim_set_time(&gesture, 1350);
        lv_anim_set_playback_time(&gesture, 1350);
        lv_anim_set_exec_cb(&gesture, translate_y_exec);
    } else {
        lv_anim_set_values(&gesture, 0, 3);
        lv_anim_set_time(&gesture, 850);
        lv_anim_set_playback_time(&gesture, 850);
        lv_anim_set_exec_cb(&gesture, translate_y_exec);
    }
    lv_anim_start(&gesture);
}

static void start_status_dot_mood(const PeekDockTask* task) {
    if (!status_dot || !task) return;
    lv_anim_delete(status_dot, shadow_opa_exec);
    lv_anim_delete(status_dot, scale_exec);
    lv_obj_set_style_transform_pivot_x(status_dot, 4, 0);
    lv_obj_set_style_transform_pivot_y(status_dot, 4, 0);
    lv_obj_set_style_transform_scale(status_dot, 256, 0);

    const bool running = std::strcmp(task->status, "running") == 0;
    const bool failed = std::strcmp(task->status, "failed") == 0;
    const bool completed = std::strcmp(task->status, "completed") == 0;
    const bool needs_input = std::strcmp(task->status, "needs_input") == 0;
    const bool idle = std::strcmp(task->status, "idle") == 0;

    lv_anim_t glow;
    lv_anim_init(&glow);
    lv_anim_set_var(&glow, status_dot);
    lv_anim_set_exec_cb(&glow, shadow_opa_exec);
    lv_anim_set_path_cb(&glow, lv_anim_path_ease_in_out);

    if (failed) {
        lv_anim_set_values(&glow, LV_OPA_30, LV_OPA_COVER);
        lv_anim_set_time(&glow, 90);
        lv_anim_set_playback_time(&glow, 90);
        lv_anim_set_repeat_count(&glow, 5);
    } else if (completed) {
        lv_anim_set_values(&glow, LV_OPA_COVER, LV_OPA_TRANSP);
        lv_anim_set_time(&glow, 620);
        lv_anim_set_delay(&glow, 120);
    } else if (needs_input) {
        lv_anim_set_values(&glow, LV_OPA_40, LV_OPA_90);
        lv_anim_set_time(&glow, 760);
        lv_anim_set_playback_time(&glow, 760);
        lv_anim_set_repeat_count(&glow, LV_ANIM_REPEAT_INFINITE);
    } else if (idle) {
        lv_anim_set_values(&glow, LV_OPA_10, LV_OPA_40);
        lv_anim_set_time(&glow, 1650);
        lv_anim_set_playback_time(&glow, 1650);
        lv_anim_set_repeat_count(&glow, LV_ANIM_REPEAT_INFINITE);
    } else {
        lv_anim_set_values(&glow, LV_OPA_30, LV_OPA_70);
        lv_anim_set_time(&glow, 560);
        lv_anim_set_playback_time(&glow, 560);
        lv_anim_set_repeat_count(&glow, LV_ANIM_REPEAT_INFINITE);
    }
    lv_anim_start(&glow);

    if (running) {
        lv_anim_t spread;
        lv_anim_init(&spread);
        lv_anim_set_var(&spread, status_dot);
        lv_anim_set_values(&spread, 256, 308);
        lv_anim_set_time(&spread, 620);
        lv_anim_set_playback_time(&spread, 620);
        lv_anim_set_repeat_count(&spread, LV_ANIM_REPEAT_INFINITE);
        lv_anim_set_path_cb(&spread, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&spread, scale_exec);
        lv_anim_start(&spread);
    }
}

static void particle_exec_x(void* obj, int32_t value) {
    lv_obj_set_x(static_cast<lv_obj_t*>(obj), value);
}

static void particle_exec_y(void* obj, int32_t value) {
    lv_obj_set_y(static_cast<lv_obj_t*>(obj), value);
}

static void particle_exec_opa(void* obj, int32_t value) {
    lv_obj_set_style_opa(static_cast<lv_obj_t*>(obj), static_cast<lv_opa_t>(value), 0);
}

static void hide_particle(lv_anim_t* anim) {
    lv_obj_add_flag(static_cast<lv_obj_t*>(anim->var), LV_OBJ_FLAG_HIDDEN);
}

static void start_completed_burst(const PeekDockTask* task) {
    static const int8_t dx[10] = {0, 14, 24, 18, 0, -18, -24, -14, 9, -9};
    static const int8_t dy[10] = {-26, -20, -2, 18, 26, 18, -2, -20, 8, 8};
    const lv_color_t color = agent_color(task);
    for (int i = 0; i < 10; ++i) {
        lv_obj_t* particle = burst_particles[i];
        if (!particle) continue;
        lv_obj_clear_flag(particle, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_bg_color(particle, color, 0);
        lv_obj_set_style_opa(particle, LV_OPA_COVER, 0);
        lv_obj_set_pos(particle, 84, 137);

        lv_anim_t x_anim;
        lv_anim_init(&x_anim);
        lv_anim_set_var(&x_anim, particle);
        lv_anim_set_values(&x_anim, 84, 84 + dx[i]);
        lv_anim_set_time(&x_anim, 600);
        lv_anim_set_path_cb(&x_anim, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&x_anim, particle_exec_x);
        lv_anim_start(&x_anim);

        lv_anim_t y_anim;
        lv_anim_init(&y_anim);
        lv_anim_set_var(&y_anim, particle);
        lv_anim_set_values(&y_anim, 137, 137 + dy[i]);
        lv_anim_set_time(&y_anim, 600);
        lv_anim_set_path_cb(&y_anim, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&y_anim, particle_exec_y);
        lv_anim_start(&y_anim);

        lv_anim_t opa_anim;
        lv_anim_init(&opa_anim);
        lv_anim_set_var(&opa_anim, particle);
        lv_anim_set_values(&opa_anim, LV_OPA_COVER, LV_OPA_TRANSP);
        lv_anim_set_time(&opa_anim, 600);
        lv_anim_set_exec_cb(&opa_anim, particle_exec_opa);
        lv_anim_set_completed_cb(&opa_anim, hide_particle);
        lv_anim_start(&opa_anim);
    }
}

static void update_mood_bubble(const PeekDockTask* task) {
    (void)task;
    if (!mood_bubble || !mood_label) return;
    lv_obj_add_flag(mood_bubble, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(mood_label, LV_OBJ_FLAG_HIDDEN);
}

static const char* idle_copy_for_task(const PeekDockTask* task) {
    const int variant = (pulse_tick / 18) % 6;
    if (is_claude_task(task)) {
        static const char* claude_copy[] = {
            "tiny thoughts",
            "soft logic",
            "draft nest",
            "book hug",
            "calm brain",
            "note cozy"
        };
        return claude_copy[variant];
    }
    if (is_jimeng_task(task)) {
        static const char* jimeng_copy[] = {
            "paint nap",
            "cloud doodle",
            "color snack",
            "tiny sparkle",
            "canvas purr",
            "dream ink"
        };
        return jimeng_copy[variant];
    }
    static const char* codex_copy[] = {
        "bug blanket",
        "patch paws",
        "lint dreams",
        "coffee break",
        "tiny compiler",
        "ship spark"
    };
    return codex_copy[variant];
}

static void update_idle_panel(const PeekDockTask* task) {
    if (!idle_panel || !idle_tail || !idle_text_label || !mood_label) return;
    const bool idle = task && std::strcmp(task->status, "idle") == 0;
    if (!idle) {
        lv_obj_add_flag(idle_panel, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(idle_tail, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    const lv_color_t bubble_color = lv_color_hex(0x171a21);
    lv_obj_clear_flag(idle_panel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(idle_tail, LV_OBJ_FLAG_HIDDEN);
    const int phase = pulse_tick % 16;
    const int wave = phase < 8 ? phase : 16 - phase;
    lv_obj_set_style_transform_pivot_x(idle_panel, 63, 0);
    lv_obj_set_style_transform_pivot_y(idle_panel, 20, 0);
    lv_obj_set_style_transform_scale(idle_panel, 256 + wave, 0);
    lv_obj_set_style_transform_scale(idle_tail, 256 + wave, 0);
    lv_obj_set_style_bg_color(idle_panel, bubble_color, 0);
    lv_obj_set_style_border_color(idle_panel, lv_color_hex(0x2a2e38), 0);
    lv_obj_set_style_shadow_color(idle_panel, lv_color_hex(0x05060a), 0);
    lv_obj_set_style_bg_color(idle_tail, bubble_color, 0);
    lv_label_set_text(idle_text_label, idle_copy_for_task(task));
}

static void typewriter_tick(lv_timer_t*) {
    const size_t len = std::strlen(typewriter_text);
    if (len == 0) {
        lv_timer_pause(typewriter_timer);
        return;
    }
    if (typewriter_index >= static_cast<int>(len)) {
        lv_label_set_text(title_small_label, typewriter_text);
        lv_timer_pause(typewriter_timer);
        return;
    }

    char partial[96] = {};
    const int next = typewriter_index + 1;
    std::snprintf(partial, sizeof(partial), "%.*s", next, typewriter_text);
    lv_label_set_text(title_small_label, partial);
    typewriter_index = next;
}

static void start_typewriter(const char* text) {
    if (!title_small_label || !typewriter_timer) return;
    std::snprintf(typewriter_text, sizeof(typewriter_text), "%s", text && text[0] ? text : "working");
    typewriter_index = 0;
    lv_label_set_text(title_small_label, "");
    lv_timer_resume(typewriter_timer);
    typewriter_tick(typewriter_timer);
}

static void stop_typewriter(const char* text) {
    if (typewriter_timer) lv_timer_pause(typewriter_timer);
    if (title_small_label) set_label_text_fade(title_small_label, text ? text : "");
}

static void render_idle() {
    lv_label_set_text(title_label, "CODEX");
    lv_image_set_src(hero_image, &codex_idle_p2);
    PeekDockTask task = placeholder_task(selected_task_index);
    current_task = task;
    restore_hidden_hero_for_new_context();
    apply_hero_layout(&task);
    lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(title_label, agent_label_for_task(&task));
    update_title_pill(&task);
    progress_milestone_mask = 0;
    last_pulse_x = -100;
    lv_obj_set_style_transform_scale(hero_image, 256, 0);
    set_progress(&task, false);
    set_progress_area_mode(&task);
    lv_label_set_text(task_type_label, chip_label_for_task(&task));
    char title[32] = {};
    compact_title(task.title, title, sizeof(title));
    set_label_text_fade(status_label, title);
    stop_typewriter("");
    set_label_text_fade(status_label, "IDLE MODE");
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x1f2228), LV_PART_MAIN);
    const lv_color_t accent = agent_color(&task);
    lv_obj_set_style_bg_color(progress_bar, accent, LV_PART_INDICATOR);
    if (progress_pulse) lv_obj_set_style_bg_color(progress_pulse, accent, 0);
    set_signal_color(lv_color_hex(0x56605c), false);
    start_hero_breath(&task);
    start_status_dot_mood(&task);
    update_mood_bubble(&task);
    update_idle_panel(&task);
    set_agent_dots();
    animate_content_in(transition_direction);
    if (animation_timer) lv_timer_resume(animation_timer);
}

static void render_task(const PeekDockTask* task) {
    if (!task || task->task_id[0] == '\0') {
        render_idle();
        return;
    }

    current_task = *task;
    const bool changed_state = std::strcmp(last_rendered_task_id, task->task_id) != 0 ||
        std::strcmp(last_rendered_status, task->status) != 0;
    if (changed_state || transition_direction != 0) restore_hidden_hero_for_new_context();
    std::snprintf(last_rendered_task_id, sizeof(last_rendered_task_id), "%s", task->task_id);
    std::snprintf(last_rendered_status, sizeof(last_rendered_status), "%s", task->status);

    if (!hero_locally_hidden) lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(title_label, agent_label_for_task(task));
    update_title_pill(task);
    lv_image_set_src(hero_image, image_frames_for_task(task, animation_tick));
    apply_hero_layout(task);
    if (changed_state) {
        progress_milestone_mask = 0;
        last_pulse_x = -100;
    }
    set_progress(task, changed_state);
    set_progress_area_mode(task);
    lv_label_set_text(task_type_label, chip_label_for_task(task));
    char title[32] = {};
    const char* display_title = task_needs_confirmation(task)
        ? confirmation_title_for_task(task)
        : is_generic_task_title(task->title) ? primary_status_for_task(task) : task->title;
    compact_title(display_title[0] ? display_title : task_type_fallback(task), title, sizeof(title));
    set_label_text_fade(status_label, title);
    if (std::strcmp(task->status, "idle") == 0) {
        set_label_text_fade(status_label, "IDLE MODE");
        stop_typewriter("");
    } else if (std::strcmp(task->status, "running") == 0 && !task_needs_confirmation(task)) {
        if (changed_state || std::strcmp(typewriter_text, phase_text_for_task(task)) != 0) {
            start_typewriter(phase_text_for_task(task));
        }
    } else {
        stop_typewriter(phase_text_for_task(task));
    }
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x1f2228), LV_PART_MAIN);
    const lv_color_t accent = agent_color(task);
    const lv_color_t signal = signal_color_for_task(task);
    lv_obj_set_style_bg_color(progress_bar, accent, LV_PART_INDICATOR);
    if (progress_pulse) lv_obj_set_style_bg_color(progress_pulse, accent, 0);
    set_signal_color(signal, std::strcmp(task->status, "idle") != 0);
    if (changed_state || transition_direction != 0) {
        start_hero_breath(task);
        start_status_dot_mood(task);
    }
    update_mood_bubble(task);
    update_idle_panel(task);
    set_agent_dots();
    animate_content_in(transition_direction);
    if (changed_state && transition_direction == 0) animate_state_change();
    if (changed_state && std::strcmp(task->status, "completed") == 0) start_completed_burst(task);
    transition_direction = 0;

    animation_tick = 0;
    if (animation_timer) lv_timer_resume(animation_timer);
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
        lv_label_set_text(title_label, "CODEX");
        displayed_progress = 0;
        set_percent_label(0);
        lv_label_set_text(task_type_label, "on mac");
        set_progress_area_mode(&transition_task);
        if (idle_panel) lv_obj_add_flag(idle_panel, LV_OBJ_FLAG_HIDDEN);
        if (mood_bubble) lv_obj_add_flag(mood_bubble, LV_OBJ_FLAG_HIDDEN);
        if (mood_label) lv_obj_add_flag(mood_label, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(status_label, "returned to desktop");
        char title[32] = {};
        compact_title(transition_task.title[0] ? transition_task.title : "task on mac", title, sizeof(title));
        lv_label_set_text(title_small_label, title);
        lv_bar_set_value(progress_bar, 0, LV_ANIM_OFF);
        lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x585858), LV_PART_INDICATOR);
        set_signal_color(lv_color_hex(0x30343a), false);
        set_agent_dots();
        if (animation_timer) {
            lv_timer_pause(animation_timer);
        }
    }
}

static void running_tick(lv_timer_t*) {
    static int frame_subtick = 0;
    frame_subtick = (frame_subtick + 1) % 4;
    if (frame_subtick == 0) animation_tick = (animation_tick + 1) % 2;
    pulse_tick = (pulse_tick + 1) % 32;
    if (!hero_locally_hidden && !hero_dragging) {
        lv_image_set_src(hero_image, image_frames_for_task(&current_task, animation_tick));
        apply_hero_layout(&current_task);
    }
    layout_progress_pulse(&current_task);
    update_mood_bubble(&current_task);
    update_idle_panel(&current_task);

    if (std::strcmp(current_task.status, "running") == 0) {
        const int phase = pulse_tick % 16;
        const int wave = phase < 8 ? phase : 16 - phase;
        const lv_color_t deep = agent_color(&current_task);
        const lv_color_t light = lv_color_mix(lv_color_hex(0xf0fff0), deep, 80);
        lv_obj_set_style_bg_color(progress_bar, lv_color_mix(light, deep, static_cast<uint8_t>(40 + wave * 10)), LV_PART_INDICATOR);
    }

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

void peekdock_screen_switch_page(int direction) {
    if (direction == 0) return;
    restore_hidden_hero_for_new_context();
    selected_task_index = (selected_task_index + (direction > 0 ? 1 : 2)) % 3;
    transition_direction = direction > 0 ? 1 : -1;
    PeekDockTask task = task_for_page(selected_task_index);
    render_task(&task);
    animate_hero_enter(216, 256, LV_OPA_30);
}

void peekdock_screen_touch_feedback() {
    if (!hero_image) return;
    if (hero_locally_hidden || hero_dragging) return;
    lv_obj_set_style_transform_pivot_x(hero_image, 54, 0);
    lv_obj_set_style_transform_pivot_y(hero_image, 54, 0);
    lv_anim_delete(hero_image, scale_exec);

    lv_anim_t pulse;
    lv_anim_init(&pulse);
    lv_anim_set_var(&pulse, hero_image);
    lv_anim_set_values(&pulse, 256, 261);
    lv_anim_set_time(&pulse, 50);
    lv_anim_set_path_cb(&pulse, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&pulse, scale_exec);
    lv_anim_set_completed_cb(&pulse, [](lv_anim_t* anim) {
        lv_anim_t settle;
        lv_anim_init(&settle);
        lv_anim_set_var(&settle, anim->var);
        lv_anim_set_values(&settle, 261, 256);
        lv_anim_set_time(&settle, 50);
        lv_anim_set_path_cb(&settle, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&settle, scale_exec);
        lv_anim_start(&settle);
    });
    lv_anim_start(&pulse);
}

static void apply_hero_drag_now(int progress) {
    if (!hero_image) return;
    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;
    if (progress == hero_drag_applied_progress) return;
    const bool was_dragging = hero_dragging;
    hero_drag_progress = progress;
    hero_drag_applied_progress = progress;
    hero_dragging = progress > 0;
    if (!was_dragging && progress > 0) {
        delete_hero_motion_anims();
        lv_obj_set_style_translate_x(hero_image, 0, 0);
    }
    lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_style_transform_pivot_x(hero_image, 54, 0);
    lv_obj_set_style_transform_pivot_y(hero_image, 54, 0);
    lv_obj_set_style_translate_y(hero_image, -(progress * 92) / 100, 0);
    lv_obj_set_style_transform_scale(hero_image, 256 - (progress * 86) / 100, 0);
    lv_obj_set_style_opa(hero_image, static_cast<lv_opa_t>(255 - (progress * 220) / 100), 0);
    if (progress == 0) {
        hero_dragging = false;
        start_hero_breath(&current_task);
    }
}

static void commit_hero_hide_now() {
    if (!hero_image) return;
    hero_dragging = false;
    hero_locally_hidden = true;
    hero_drag_applied_progress = -1;
    lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    delete_hero_motion_anims();

    lv_anim_t y_anim;
    lv_anim_init(&y_anim);
    lv_anim_set_var(&y_anim, hero_image);
    lv_anim_set_values(&y_anim, -(hero_drag_progress * 92) / 100, -112);
    lv_anim_set_time(&y_anim, 220);
    lv_anim_set_path_cb(&y_anim, lv_anim_path_ease_in);
    lv_anim_set_exec_cb(&y_anim, translate_y_exec);
    lv_anim_start(&y_anim);

    lv_anim_t scale_anim;
    lv_anim_init(&scale_anim);
    lv_anim_set_var(&scale_anim, hero_image);
    lv_anim_set_values(&scale_anim, 256 - (hero_drag_progress * 86) / 100, 150);
    lv_anim_set_time(&scale_anim, 220);
    lv_anim_set_path_cb(&scale_anim, lv_anim_path_ease_in);
    lv_anim_set_exec_cb(&scale_anim, scale_exec);
    lv_anim_start(&scale_anim);

    lv_anim_t fade_anim;
    lv_anim_init(&fade_anim);
    lv_anim_set_var(&fade_anim, hero_image);
    lv_anim_set_values(&fade_anim, 255 - (hero_drag_progress * 220) / 100, LV_OPA_TRANSP);
    lv_anim_set_time(&fade_anim, 220);
    lv_anim_set_path_cb(&fade_anim, lv_anim_path_ease_in);
    lv_anim_set_exec_cb(&fade_anim, opa_exec);
    lv_anim_set_completed_cb(&fade_anim, [](lv_anim_t* anim) {
        lv_obj_t* obj = static_cast<lv_obj_t*>(anim->var);
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_translate_y(obj, 0, 0);
        lv_obj_set_style_transform_scale(obj, 256, 0);
        lv_obj_set_style_opa(obj, LV_OPA_COVER, 0);
    });
    lv_anim_start(&fade_anim);
    hero_drag_progress = 0;
}

static void restore_hero_now() {
    if (!hero_image) return;
    hero_dragging = false;
    hero_locally_hidden = false;
    hero_drag_applied_progress = -1;
    delete_hero_motion_anims();
    lv_obj_clear_flag(hero_image, LV_OBJ_FLAG_HIDDEN);
    lv_image_set_src(hero_image, image_frames_for_task(&current_task, animation_tick));
    apply_hero_layout(&current_task);
    lv_obj_set_style_transform_pivot_x(hero_image, 54, 0);
    lv_obj_set_style_transform_pivot_y(hero_image, 54, 0);
    lv_obj_set_style_translate_y(hero_image, -96, 0);
    lv_obj_set_style_transform_scale(hero_image, 170, 0);
    lv_obj_set_style_opa(hero_image, LV_OPA_TRANSP, 0);

    lv_anim_t y_anim;
    lv_anim_init(&y_anim);
    lv_anim_set_var(&y_anim, hero_image);
    lv_anim_set_values(&y_anim, -96, 0);
    lv_anim_set_time(&y_anim, 260);
    lv_anim_set_path_cb(&y_anim, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&y_anim, translate_y_exec);
    lv_anim_start(&y_anim);

    lv_anim_t scale_anim;
    lv_anim_init(&scale_anim);
    lv_anim_set_var(&scale_anim, hero_image);
    lv_anim_set_values(&scale_anim, 170, 256);
    lv_anim_set_time(&scale_anim, 260);
    lv_anim_set_path_cb(&scale_anim, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&scale_anim, scale_exec);
    lv_anim_set_completed_cb(&scale_anim, [](lv_anim_t* anim) {
        start_hero_breath(&current_task);
    });
    lv_anim_start(&scale_anim);

    lv_anim_t fade_anim;
    lv_anim_init(&fade_anim);
    lv_anim_set_var(&fade_anim, hero_image);
    lv_anim_set_values(&fade_anim, LV_OPA_TRANSP, LV_OPA_COVER);
    lv_anim_set_time(&fade_anim, 180);
    lv_anim_set_exec_cb(&fade_anim, opa_exec);
    lv_anim_start(&fade_anim);
}

static void consume_hero_drag_requests() {
    consume_touch_debug();
    const int command = hero_drag_requested_command;
    if (command != 0) {
        hero_drag_requested_command = 0;
        const int progress = hero_drag_requested_progress;
        hero_drag_requested_progress = -1;
        if (progress >= 0) apply_hero_drag_now(progress);
        if (command == HERO_COMMAND_HIDE) {
            commit_hero_hide_now();
        } else if (command == HERO_COMMAND_RESTORE) {
            restore_hero_now();
        }
        return;
    }

    const int progress = hero_drag_requested_progress;
    if (progress >= 0) {
        hero_drag_requested_progress = -1;
        apply_hero_drag_now(progress);
    }
}

void peekdock_screen_set_hero_drag(int progress) {
    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;
    hero_drag_requested_progress = progress;
}

void peekdock_screen_commit_hero_hide() {
    hero_drag_requested_command = HERO_COMMAND_HIDE;
}

void peekdock_screen_restore_hero() {
    hero_drag_requested_command = HERO_COMMAND_RESTORE;
}

bool peekdock_screen_hero_hidden() {
    return hero_locally_hidden;
}

void peekdock_screen_init() {
    lv_obj_t* root = lv_screen_active();
    lv_obj_set_style_bg_color(root, lv_color_hex(0x000000), 0);
    lv_obj_set_style_pad_all(root, 0, 0);
    lv_obj_set_scrollbar_mode(root, LV_SCROLLBAR_MODE_OFF);
    lv_obj_clear_flag(root, LV_OBJ_FLAG_SCROLLABLE);

    content_layer = lv_obj_create(root);
    lv_obj_remove_style_all(content_layer);
    make_passive(content_layer);
    lv_obj_set_size(content_layer, 172, 320);
    lv_obj_align(content_layer, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_color(content_layer, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_opa(content_layer, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(content_layer, 0, 0);
    lv_obj_set_scrollbar_mode(content_layer, LV_SCROLLBAR_MODE_OFF);
    lv_obj_clear_flag(content_layer, LV_OBJ_FLAG_SCROLLABLE);

    title_pill = lv_obj_create(content_layer);
    lv_obj_remove_style_all(title_pill);
    make_passive(title_pill);
    lv_obj_set_size(title_pill, 72, 25);
    lv_obj_set_style_radius(title_pill, 12, 0);
    lv_obj_set_style_bg_color(title_pill, lv_color_hex(0x19351f), 0);
    lv_obj_set_style_bg_opa(title_pill, LV_OPA_60, 0);
    lv_obj_set_style_border_width(title_pill, 1, 0);
    lv_obj_set_style_border_color(title_pill, lv_color_hex(0x69c86e), 0);
    lv_obj_set_style_border_opa(title_pill, LV_OPA_30, 0);
    lv_obj_set_style_shadow_width(title_pill, 6, 0);
    lv_obj_set_style_shadow_opa(title_pill, LV_OPA_10, 0);
    lv_obj_align(title_pill, LV_ALIGN_TOP_LEFT, 18, 24);

    title_label = lv_label_create(title_pill);
    make_passive(title_label);
    lv_label_set_text(title_label, "CODEX");
    lv_obj_set_style_text_color(title_label, lv_color_hex(0xf2f0f4), 0);
    lv_obj_set_style_text_font(title_label, LV_FONT_DEFAULT, 0);
    lv_obj_set_style_text_letter_space(title_label, 0, 0);
    lv_obj_center(title_label);

    status_dot = lv_obj_create(content_layer);
    lv_obj_remove_style_all(status_dot);
    make_passive(status_dot);
    lv_obj_set_size(status_dot, 8, 8);
    lv_obj_set_style_radius(status_dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(status_dot, lv_color_hex(0x75c978), 0);
    lv_obj_set_style_bg_opa(status_dot, LV_OPA_COVER, 0);
    lv_obj_set_style_shadow_width(status_dot, 8, 0);
    lv_obj_set_style_shadow_color(status_dot, lv_color_hex(0x75c978), 0);
    lv_obj_set_style_shadow_opa(status_dot, LV_OPA_50, 0);
    lv_obj_align(status_dot, LV_ALIGN_TOP_RIGHT, -30, 34);

    hero_image = lv_image_create(content_layer);
    make_passive(hero_image);
    lv_image_set_src(hero_image, &codex_idle_p2);
    lv_obj_align(hero_image, LV_ALIGN_TOP_MID, 0, 78);

    percent_group = lv_obj_create(content_layer);
    lv_obj_remove_style_all(percent_group);
    make_passive(percent_group);
    lv_obj_set_size(percent_group, 78, 34);
    lv_obj_align(percent_group, LV_ALIGN_TOP_MID, 0, 242);

    percent_label = lv_label_create(percent_group);
    make_passive(percent_label);
    lv_label_set_text(percent_label, "0");
    lv_obj_set_style_text_color(percent_label, lv_color_hex(0xf3f0f6), 0);
#if LV_FONT_MONTSERRAT_28
    lv_obj_set_style_text_font(percent_label, &lv_font_montserrat_28, 0);
#else
    lv_obj_set_style_text_font(percent_label, LV_FONT_DEFAULT, 0);
#endif
    lv_obj_set_width(percent_label, 54);
    lv_obj_set_style_text_align(percent_label, LV_TEXT_ALIGN_RIGHT, 0);
    lv_obj_align(percent_label, LV_ALIGN_LEFT_MID, 7, -1);

    percent_unit_label = lv_label_create(percent_group);
    make_passive(percent_unit_label);
    lv_label_set_text(percent_unit_label, "%");
    lv_obj_set_style_text_color(percent_unit_label, lv_color_hex(0xa6abb5), 0);
    lv_obj_set_style_text_opa(percent_unit_label, LV_OPA_50, 0);
    lv_obj_set_style_text_font(percent_unit_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(percent_unit_label, LV_ALIGN_RIGHT_MID, -9, 4);

    tool_chip = lv_obj_create(content_layer);
    lv_obj_remove_style_all(tool_chip);
    make_passive(tool_chip);
    lv_obj_set_size(tool_chip, 94, 28);
    lv_obj_set_style_radius(tool_chip, 9, 0);
    lv_obj_set_style_bg_color(tool_chip, lv_color_hex(0x15171d), 0);
    lv_obj_set_style_bg_opa(tool_chip, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(tool_chip, 1, 0);
    lv_obj_set_style_border_color(tool_chip, lv_color_hex(0x242832), 0);
    lv_obj_align(tool_chip, LV_ALIGN_TOP_MID, 0, 188);
    lv_obj_add_flag(tool_chip, LV_OBJ_FLAG_HIDDEN);

    tool_dot = lv_obj_create(tool_chip);
    lv_obj_remove_style_all(tool_dot);
    make_passive(tool_dot);
    lv_obj_set_size(tool_dot, 6, 6);
    lv_obj_set_style_radius(tool_dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(tool_dot, lv_color_hex(0x69c86e), 0);
    lv_obj_set_style_bg_opa(tool_dot, LV_OPA_COVER, 0);
    lv_obj_align(tool_dot, LV_ALIGN_LEFT_MID, 15, 0);

    task_type_label = lv_label_create(tool_chip);
    make_passive(task_type_label);
    lv_label_set_text(task_type_label, "shell");
    lv_obj_set_width(task_type_label, 50);
    lv_label_set_long_mode(task_type_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_color(task_type_label, lv_color_hex(0x8f95a3), 0);
    lv_obj_set_style_text_font(task_type_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(task_type_label, LV_ALIGN_LEFT_MID, 27, 0);

    status_label = lv_label_create(content_layer);
    make_passive(status_label);
    lv_label_set_text(status_label, "Refining UI");
    lv_obj_set_width(status_label, 136);
    lv_label_set_long_mode(status_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_color(status_label, lv_color_hex(0xe8e5ed), 0);
#if LV_FONT_MONTSERRAT_16
    lv_obj_set_style_text_font(status_label, &lv_font_montserrat_16, 0);
#else
    lv_obj_set_style_text_font(status_label, LV_FONT_DEFAULT, 0);
#endif
    lv_obj_set_style_text_align(status_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(status_label, LV_ALIGN_TOP_MID, 0, 168);

    progress_bar = lv_bar_create(content_layer);
    make_passive(progress_bar);
    lv_obj_set_size(progress_bar, 126, 6);
    lv_obj_set_style_radius(progress_bar, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x20232a), LV_PART_MAIN);
    lv_obj_set_style_bg_color(progress_bar, lv_color_hex(0x69c86e), LV_PART_INDICATOR);
    lv_obj_set_style_border_width(progress_bar, 0, 0);
    lv_obj_align(progress_bar, LV_ALIGN_TOP_MID, 0, 224);
    lv_bar_set_range(progress_bar, 0, 100);

    progress_pulse = lv_obj_create(content_layer);
    lv_obj_remove_style_all(progress_pulse);
    make_passive(progress_pulse);
    lv_obj_set_size(progress_pulse, 18, 6);
    lv_obj_set_style_radius(progress_pulse, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(progress_pulse, lv_color_hex(0x69c86e), 0);
    lv_obj_set_style_bg_opa(progress_pulse, LV_OPA_COVER, 0);
    lv_obj_add_flag(progress_pulse, LV_OBJ_FLAG_HIDDEN);

    accept_button = lv_obj_create(content_layer);
    lv_obj_remove_style_all(accept_button);
    make_passive(accept_button);
    lv_obj_set_size(accept_button, 108, 34);
    lv_obj_set_style_radius(accept_button, 14, 0);
    lv_obj_set_style_bg_color(accept_button, lv_color_hex(0x69c86e), 0);
    lv_obj_set_style_bg_opa(accept_button, LV_OPA_COVER, 0);
    lv_obj_set_style_shadow_width(accept_button, 10, 0);
    lv_obj_set_style_shadow_color(accept_button, lv_color_hex(0x69c86e), 0);
    lv_obj_set_style_shadow_opa(accept_button, LV_OPA_30, 0);
    lv_obj_align(accept_button, LV_ALIGN_TOP_MID, 0, 220);
    lv_obj_add_flag(accept_button, LV_OBJ_FLAG_HIDDEN);

    accept_label = lv_label_create(accept_button);
    make_passive(accept_label);
    lv_label_set_text(accept_label, "review");
    lv_obj_set_style_text_color(accept_label, lv_color_hex(0x172018), 0);
    lv_obj_set_style_text_font(accept_label, LV_FONT_DEFAULT, 0);
    lv_obj_center(accept_label);

    idle_panel = lv_obj_create(content_layer);
    lv_obj_remove_style_all(idle_panel);
    make_passive(idle_panel);
    lv_obj_set_size(idle_panel, 126, 40);
    lv_obj_set_style_radius(idle_panel, 13, 0);
    lv_obj_set_style_bg_color(idle_panel, lv_color_hex(0x171a21), 0);
    lv_obj_set_style_bg_opa(idle_panel, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(idle_panel, 1, 0);
    lv_obj_set_style_border_color(idle_panel, lv_color_hex(0x2a2e38), 0);
    lv_obj_set_style_border_opa(idle_panel, LV_OPA_50, 0);
    lv_obj_set_style_shadow_width(idle_panel, 8, 0);
    lv_obj_set_style_shadow_opa(idle_panel, LV_OPA_10, 0);
    lv_obj_align(idle_panel, LV_ALIGN_TOP_MID, 0, 212);
    lv_obj_add_flag(idle_panel, LV_OBJ_FLAG_HIDDEN);

    idle_tail = lv_obj_create(content_layer);
    lv_obj_remove_style_all(idle_tail);
    make_passive(idle_tail);
    lv_obj_set_size(idle_tail, 8, 8);
    lv_obj_set_style_bg_color(idle_tail, lv_color_hex(0x171a21), 0);
    lv_obj_set_style_bg_opa(idle_tail, LV_OPA_COVER, 0);
    lv_obj_set_style_transform_angle(idle_tail, 450, 0);
    lv_obj_align_to(idle_tail, idle_panel, LV_ALIGN_OUT_TOP_MID, 0, 5);
    lv_obj_add_flag(idle_tail, LV_OBJ_FLAG_HIDDEN);

    idle_text_label = lv_label_create(idle_panel);
    make_passive(idle_text_label);
    lv_label_set_text(idle_text_label, "patch ready");
    lv_obj_set_width(idle_text_label, 78);
    lv_label_set_long_mode(idle_text_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_color(idle_text_label, lv_color_hex(0xcfd4dc), 0);
    lv_obj_set_style_text_font(idle_text_label, LV_FONT_DEFAULT, 0);
    lv_obj_align(idle_text_label, LV_ALIGN_LEFT_MID, 15, 0);

    title_small_label = lv_label_create(content_layer);
    make_passive(title_small_label);
    lv_label_set_text(title_small_label, "Idle");
    lv_obj_set_width(title_small_label, 126);
    lv_label_set_long_mode(title_small_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_color(title_small_label, lv_color_hex(0x6f7480), 0);
    lv_obj_set_style_text_font(title_small_label, LV_FONT_DEFAULT, 0);
    lv_obj_set_style_text_align(title_small_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(title_small_label, LV_ALIGN_TOP_MID, 0, 189);

    mood_bubble = lv_obj_create(content_layer);
    lv_obj_remove_style_all(mood_bubble);
    make_passive(mood_bubble);
    lv_obj_set_size(mood_bubble, 34, 22);
    lv_obj_set_style_radius(mood_bubble, 11, 0);
    lv_obj_set_style_bg_color(mood_bubble, lv_color_hex(0x15191f), 0);
    lv_obj_set_style_bg_opa(mood_bubble, LV_OPA_70, 0);
    lv_obj_set_style_border_width(mood_bubble, 1, 0);
    lv_obj_set_style_border_color(mood_bubble, lv_color_hex(0x4c5460), 0);
    lv_obj_set_style_border_opa(mood_bubble, LV_OPA_50, 0);
    lv_obj_set_style_shadow_width(mood_bubble, 8, 0);
    lv_obj_set_style_shadow_opa(mood_bubble, LV_OPA_20, 0);
    lv_obj_align(mood_bubble, LV_ALIGN_TOP_RIGHT, -18, 76);
    lv_obj_add_flag(mood_bubble, LV_OBJ_FLAG_HIDDEN);

    mood_label = lv_label_create(mood_bubble);
    make_passive(mood_label);
    lv_label_set_text(mood_label, "<3");
    lv_obj_set_style_text_color(mood_label, lv_color_hex(0xe6e9ef), 0);
    lv_obj_set_style_text_font(mood_label, LV_FONT_DEFAULT, 0);
    lv_obj_center(mood_label);
    lv_obj_add_flag(mood_label, LV_OBJ_FLAG_HIDDEN);

    for (int i = 0; i < 10; ++i) {
        burst_particles[i] = lv_obj_create(content_layer);
        lv_obj_remove_style_all(burst_particles[i]);
        make_passive(burst_particles[i]);
        lv_obj_set_size(burst_particles[i], 4, 4);
        lv_obj_set_style_radius(burst_particles[i], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(burst_particles[i], lv_color_hex(0x69c86e), 0);
        lv_obj_set_style_bg_opa(burst_particles[i], LV_OPA_COVER, 0);
        lv_obj_add_flag(burst_particles[i], LV_OBJ_FLAG_HIDDEN);
    }

    for (int i = 0; i < 3; ++i) {
        page_dots[i] = lv_obj_create(content_layer);
        lv_obj_remove_style_all(page_dots[i]);
        make_passive(page_dots[i]);
        lv_obj_set_size(page_dots[i], 6, 6);
        lv_obj_set_style_radius(page_dots[i], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(page_dots[i], lv_color_hex(0x30343a), 0);
        lv_obj_align(page_dots[i], LV_ALIGN_BOTTOM_MID, (i - 1) * 18, -18);
    }

    touch_debug_label = lv_label_create(content_layer);
    make_passive(touch_debug_label);
    lv_label_set_text(touch_debug_label, "touch monitor");
    lv_obj_set_width(touch_debug_label, 146);
    lv_label_set_long_mode(touch_debug_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_color(touch_debug_label, lv_color_hex(0x69707a), 0);
    lv_obj_set_style_text_font(touch_debug_label, LV_FONT_DEFAULT, 0);
    lv_obj_set_style_text_align(touch_debug_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(touch_debug_label, LV_ALIGN_TOP_MID, 0, 6);

    animation_timer = lv_timer_create(running_tick, 120, nullptr);
    lv_timer_pause(animation_timer);
    hero_drag_timer = lv_timer_create([](lv_timer_t*) {
        consume_hero_drag_requests();
    }, 24, nullptr);
    typewriter_timer = lv_timer_create(typewriter_tick, 60, nullptr);
    lv_timer_pause(typewriter_timer);
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
        PeekDockTask task = task_for_page(selected_task_index);
        render_task(&task);
        return;
    }

    if (std::strcmp(event->type, "task_update") == 0) {
        const size_t target_index = page_index_for_source(event->task.source);
        const bool is_new_task = upsert_task_for_source(&event->task);
        if (is_new_task && selected_task_index != target_index) {
            transition_direction = target_index > selected_task_index ? 1 : -1;
            selected_task_index = target_index;
        }
        PeekDockTask task = task_for_page(selected_task_index);
        render_task(&task);
    }
}

void peekdock_screen_set_action_callback(PeekDockScreenActionCallback callback) {
    action_callback = callback;
}

void peekdock_screen_set_touch_debug(const char* text) {
    set_touch_debug(text);
}

void peekdock_screen_current_source(char* target, size_t target_size) {
    if (!target || target_size == 0) return;
    PeekDockTask task = task_for_page(selected_task_index);
    const char* source = task.source[0] ? task.source : "codex";
    std::snprintf(target, target_size, "%s", source);
}

bool peekdock_screen_current_needs_confirmation() {
    PeekDockTask task = task_for_page(selected_task_index);
    return task_needs_confirmation(&task);
}
