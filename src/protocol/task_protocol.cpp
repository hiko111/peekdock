#include "protocol/task_protocol.h"

#include <cstring>

#include "cJSON.h"

static void copy_json_string(cJSON* object, const char* key, char* target, size_t target_size) {
    if (!target || target_size == 0) return;
    target[0] = '\0';
    cJSON* item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (cJSON_IsString(item) && item->valuestring) {
        std::strncpy(target, item->valuestring, target_size - 1);
        target[target_size - 1] = '\0';
    }
}

static int copy_json_int(cJSON* object, const char* key, int default_value) {
    cJSON* item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (cJSON_IsNumber(item)) {
        return item->valueint;
    }
    return default_value;
}

static bool has_action(cJSON* task, const char* action) {
    cJSON* actions = cJSON_GetObjectItemCaseSensitive(task, "actions");
    if (!cJSON_IsArray(actions)) return false;
    cJSON* item = nullptr;
    cJSON_ArrayForEach(item, actions) {
        if (cJSON_IsString(item) && std::strcmp(item->valuestring, action) == 0) return true;
    }
    return false;
}

static void parse_task(cJSON* json, PeekDockTask* task) {
    if (!json || !task) return;
    std::memset(task, 0, sizeof(PeekDockTask));
    copy_json_string(json, "task_id", task->task_id, sizeof(task->task_id));
    copy_json_string(json, "source", task->source, sizeof(task->source));
    copy_json_string(json, "agent_name", task->agent_name, sizeof(task->agent_name));
    copy_json_string(json, "title", task->title, sizeof(task->title));
    copy_json_string(json, "task_type", task->task_type, sizeof(task->task_type));
    copy_json_string(json, "status", task->status, sizeof(task->status));
    copy_json_string(json, "status_text", task->status_text, sizeof(task->status_text));
    copy_json_string(json, "animation_key", task->animation_key, sizeof(task->animation_key));
    copy_json_string(json, "result_uri", task->result_uri, sizeof(task->result_uri));
    task->progress = copy_json_int(json, "progress", -1);
    task->has_open_result = has_action(json, "open_result");
}

bool parse_peekdock_event(const char* line, PeekDockEvent* out) {
    if (!line || !out) return false;
    cJSON* root = cJSON_Parse(line);
    if (!root) return false;

    std::memset(out, 0, sizeof(PeekDockEvent));
    copy_json_string(root, "type", out->type, sizeof(out->type));
    copy_json_string(root, "event", out->event, sizeof(out->event));

    cJSON* task = cJSON_GetObjectItemCaseSensitive(root, "task");
    if (cJSON_IsObject(task)) {
        parse_task(task, &out->task);
    }

    cJSON* tasks = cJSON_GetObjectItemCaseSensitive(root, "tasks");
    if (cJSON_IsArray(tasks)) {
        cJSON* item = nullptr;
        cJSON_ArrayForEach(item, tasks) {
            if (out->task_count >= 4) break;
            parse_task(item, &out->tasks[out->task_count++]);
        }
    }

    cJSON_Delete(root);
    return out->type[0] != '\0';
}
