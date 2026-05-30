#pragma once

#include "protocol/task_protocol.h"

using PeekDockScreenActionCallback = void (*)(const char* action);

void peekdock_screen_init();
void peekdock_screen_apply_event(const PeekDockEvent* event);
void peekdock_screen_set_action_callback(PeekDockScreenActionCallback callback);
void peekdock_screen_set_touch_debug(const char* text);
