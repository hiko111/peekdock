# PeekDock Protocol

The P0 protocol is JSON Lines over USB Serial between Mac/helper and ESP32.

## Message Types

- `task_snapshot`: Full task list replacement.
- `task_update`: Single task update.
- `transition_event`: Cross-screen transition cue.
- `action_event`: User action emitted by dock or simulated by helper.
- `heartbeat`: Liveness check.
- `sync_snapshot`: Helper asks device or UI to resync from canonical state.

## Required Task Fields

- `task_id`
- `source`
- `agent_name`
- `title`
- `status`
- `status_text`
- `updated_at`
- `screen_role`
- `agent_scene`
- `animation_key`
- `actions`

## P0 Transport

- Mac/helper to ESP32: USB Serial, `/dev/tty.usbmodem1301`.
- Mac/helper to Mac UI: Server-sent events and HTTP endpoints.
- ESP32 does not execute local system actions. It only emits `action_event`.

## Fixtures

- `mock-timeline.json`: Structured mock timeline consumed by helper.
- `demo-events.jsonl`: Serial-friendly line-delimited event fixture.

