#pragma once

#include "protocol/task_protocol.h"

using PeekDockScreenActionCallback = void (*)(const char* action);

void peekdock_screen_init();
void peekdock_screen_apply_event(const PeekDockEvent* event);
void peekdock_screen_switch_page(int direction);
void peekdock_screen_touch_feedback();
void peekdock_screen_set_hero_drag(int progress);
void peekdock_screen_commit_hero_hide();
void peekdock_screen_restore_hero();
bool peekdock_screen_hero_hidden();
void peekdock_screen_current_source(char* target, size_t target_size);
bool peekdock_screen_current_needs_confirmation();
void peekdock_screen_set_action_callback(PeekDockScreenActionCallback callback);
