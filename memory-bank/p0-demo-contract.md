# P0 Demo Contract

This contract defines the hackathon demo boundary. Anything outside this page is not required for P0 unless explicitly re-scoped.

## Product Promise

PeekDock demonstrates an AI task cockpit where agents move from Mac idle state into a small hardware work dock, then call the user back to Mac when work is ready or blocked.

## Fixed Scope

- Agents: Codex, Claude web, Jimeng.
- Task source: mock timeline only.
- Mac UI: browser-based demo surface.
- Hardware: Waveshare ESP32-S3-Touch-LCD-1.47.
- Firmware target: ESP-IDF 5.2+ and LVGL 9.x.
- Transport: USB Serial on `/dev/tty.usbmodem1301`.
- Small-screen navigation: touch swipe first; left/right edge tap fallback.
- Quick action: open whitelisted local HTML or image results.

## Explicit Non-Goals

- No cloud service.
- No account system.
- No real Codex, Claude, or Jimeng API integration.
- No full Mac configuration app.
- No detachable remote/mobile mode.
- No arbitrary shell execution from device messages.

## Required Demo States

- `idle`: agent is waiting on Mac.
- `handoff_to_dock`: Mac agent leaves, dock agent appears.
- `running`: task is actively working.
- `completed`: result is ready for review.
- `failed`: user should notice a problem.
- `needs_input`: user must clarify or provide input.
- `return_to_mac`: result or task context opens on Mac.

## Demo Acceptance

P0 is acceptable when a viewer can understand these beats without explanation:

1. The agent starts on Mac.
2. Starting a task sends the agent into the dock.
3. The dock shows Codex running.
4. The user can inspect Claude web and Jimeng from the dock.
5. Codex becomes ready to review.
6. The dock action brings the result back to Mac.
7. A blocked or failed state is visibly different from running/completed.

