#pragma once

#include <cstddef>

struct PeekDockTask {
    char task_id[64];
    char source[24];
    char agent_name[24];
    char title[96];
    char task_type[64];
    char status[24];
    char status_text[96];
    char animation_key[64];
    char result_uri[128];
    int progress;
    bool has_open_result;
};

struct PeekDockEvent {
    char type[32];
    char event[32];
    PeekDockTask task;
    PeekDockTask tasks[4];
    size_t task_count;
};

bool parse_peekdock_event(const char* line, PeekDockEvent* out);
