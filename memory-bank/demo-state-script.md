# Demo State Script

This script is the source of truth for the mock timeline and protocol fixtures.

## Timeline

| Time | Surface | Event | User-visible behavior |
| --- | --- | --- | --- |
| 0s | Mac | `agent_idle_on_mac` | Codex agent idles on Mac. |
| 2s | Mac | user starts Codex task | Mac begins handoff animation. |
| 3s | Mac + Dock | `handoff_to_dock` | Codex leaves Mac; dock shows Codex entering work state. |
| 5s | Dock | `task_snapshot` | Dock has Codex, Claude web, and Jimeng tasks. |
| 8s | Dock | user views Codex | Codex shows running. |
| 14s | Dock | user swipes or edge taps | Claude web shows needs input. |
| 20s | Dock | user swipes or edge taps | Jimeng shows running. |
| 30s | Dock | `task_update` | Codex becomes completed / Ready to review. |
| 36s | Dock | user taps primary action | Dock emits `action_event: open_result`. |
| 37s | Mac | `return_to_mac` | Mac opens local result and plays return animation. |
| 45s | Dock | user views Claude web | Claude web demonstrates blocked/needs-input state. |

## Tasks

### Codex

- `task_id`: `task_codex_landing_page`
- `source`: `codex`
- `agent_name`: `Codex`
- `title`: `Polish landing page`
- `scene`: `coding_room`
- `result_uri`: `/demo-results/codex-review.html`
- State sequence:
  - `idle`: `Ready on Mac`
  - `handoff_to_dock`: `Heading to dock`
  - `running`: `Codex running`
  - `completed`: `Ready to review`
  - `return_to_mac`: `Opening result`

### Claude Web

- `task_id`: `task_claude_prd`
- `source`: `claude_web`
- `agent_name`: `Claude`
- `title`: `Rewrite PRD intro`
- `scene`: `writing_room`
- `result_uri`: `/demo-results/claude-draft.html`
- State sequence:
  - `running`: `Drafting PRD`
  - `needs_input`: `Need input`

### Jimeng

- `task_id`: `task_jimeng_visual`
- `source`: `jimeng`
- `agent_name`: `Jimeng`
- `title`: `Generate hero frames`
- `scene`: `studio_cloud`
- `result_uri`: `/demo-results/jimeng-preview.html`
- State sequence:
  - `running`: `Rendering frames`
  - `completed`: `Frames ready`

## User Actions

- `start_codex_demo`: Starts the mock timeline.
- `dock_next_agent`: Shows the next agent on the dock.
- `dock_prev_agent`: Shows the previous agent on the dock.
- `open_result`: Opens the task result on Mac and triggers `return_to_mac`.

## Priority Order

1. `needs_input`
2. `failed`
3. `completed`
4. `running`
5. `queued`
6. `paused`
7. `idle`

