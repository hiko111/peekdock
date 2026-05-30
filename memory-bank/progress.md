# PeekDock 进度日志

## 2026-05-30

- 从 `/Users/karinadeng/Downloads/Prd_PeekDock AI任务舱.md` 提炼产品目标、P0/P1 范围、风险和待澄清问题。
- 建立 `vibe-coding-standard-workflow` 要求的 `memory-bank/` 文档结构。
- 当前尚未开始执行实施计划中的代码步骤。
- 重新读取 `/Users/karinadeng/Downloads/Prd_PeekDock AI任务舱.pdf`，补充理解 Mac 端闲置态、小屏端工作态、跨屏进入/召回、多 Agent 横滑和 IP 状态动画。
- 调研 LVGL 图片和动画方案：PNG 可通过 LVGL Image Converter 转为 C array 或二进制资源，少量序列帧可用 `lv_animimg` 播放。
- 更新 PRD、设计文档、技术方案、实施计划和架构记录，使 P0 聚焦黑客松跨屏演示闭环。
- 根据用户澄清更新可执行决策：硬件为 ESP32-S3 revision v0.2，16MB Flash，8MB Embedded PSRAM，Wi-Fi/Bluetooth，USB-Serial/JTAG，端口 `/dev/tty.usbmodem1301`；P0 使用 mock demo；Mac 端使用 Web 模拟；通信使用 USB Serial；小屏触摸横滑优先、边缘点击降级；agent 固定为 Codex、Claude 网页端、即梦；快操打开本地 HTML 或图片。
- 根据最新硬件背景新增 `PROJECT_CONTEXT.md`，确认目标板为 Waveshare ESP32-S3-Touch-LCD-1.47，显示为 172 x 320 JD9853 SPI，触摸为 AXS5106L I2C；目标固件栈改为 ESP-IDF 5.2+ 和 LVGL 9.x，不再继续基于 Arduino/PlatformIO 扩展。

## 2026-05-30 Step 1-4

- Step 1 completed: created `memory-bank/p0-demo-contract.md` to freeze the P0 hackathon demo scope: mock-only tasks, three agents, Mac Web UI, USB Serial, local HTML/image quick actions, and explicit non-goals.
- Step 2 completed: created `memory-bank/demo-state-script.md` with the 90-second demo timeline, Codex main flow, Claude web/Jimeng side flows, and required task fields.
- Step 3 completed: created `protocol/README.md`, `protocol/mock-timeline.json`, and `protocol/demo-events.jsonl` for the P0 JSON Lines protocol and mock data.
- Step 4 completed: created `assets/p0-asset-manifest.md` to freeze the first usable PNG set and document missing optional assets.
- Verification: `protocol/mock-timeline.json` parses successfully; every line in `protocol/demo-events.jsonl` parses as JSON.

## 2026-05-30 Step 5-9 Implementation Pass

- Step 5 partial: created ESP-IDF target skeleton with root `CMakeLists.txt`, `sdkconfig.defaults`, `src/CMakeLists.txt`, and `src/idf_component.yml`.
- Step 5 partial: imported the official Waveshare ESP-IDF demo components from `ESP32-S3-Touch-LCD-1.47-Demo 2/ESP-IDF/03_lvgl_example/components/` into local `components/esp_bsp`, `components/esp_lcd_jd9853`, and `components/esp_lcd_touch_axs5106`, so the firmware uses known JD9853 and AXS5106L initialization code instead of guessed register sequences.
- Step 6 partial: wired firmware startup to the Waveshare BSP display/touch initialization and `esp_lvgl_port`; configured LVGL display/touch registration for the 172 x 320 portrait screen.
- Step 7 superseded by the later scope correction: the earlier Mac-side demo rendered a simulated dock, which is no longer the current validation direction.
- Step 8 superseded by the later scope correction: the helper no longer plays the full mock timeline for this minimal demo; it only sends one Codex task to the physical ESP32.
- Step 9 partial: added first ESP32 small-screen task UI in `src/ui/screens/peekdock_screen.*` and task protocol parser in `src/protocol/task_protocol.*`. The UI can render source, title, status text, action availability, and status color for `running`, `completed`, `needs_input`, and `failed`.
- Historical verification before scope correction: `npm --prefix mac-demo run check` passed; `mac-demo/public/app.js` passed `node --check`; mock timeline and JSONL fixtures parsed.
- Final pass: added direct firmware dependencies for `esp_lcd` and `nvs_flash`, removed stale architecture references from the earlier local-driver draft, and confirmed the Mac helper is still running on `http://127.0.0.1:4173`.
- Limitation: `idf.py` is not installed in this environment, so ESP-IDF firmware build/flash/display/touch validation was not run. Hardware validation should be the next gate before adding richer LVGL assets or real tool adapters.

## 2026-05-30 Scope Correction: Real ESP32 Dock Minimal Demo

- User corrected the direction: the small screen is the physical Waveshare ESP32-S3-Touch-LCD-1.47, not a Mac-side simulated dock.
- Identified previous solution issue: Mac Web should not render or simulate the ESP32 screen for the current validation step; it should only act as a Codex desktop task sender.
- Reworked `mac-demo/public/` into a simple Codex input page: text area plus `Send to ESP32` button.
- Reworked `mac-demo/server.mjs` to expose `POST /api/send-task`, creating one `task_update` JSON Lines message and writing it to `/dev/tty.usbmodem1301`.
- Reworked firmware serial receive path from UART0 to `usb_serial_jtag`, matching the board's USB-Serial/JTAG mode.
- Added a minimal ESP32 LVGL working animation: received Codex task sets the screen to running state, updates the task title/status, and pulses a small Codex label.
- Verification: `npm --prefix mac-demo run check` passes; `mac-demo/public/app.js` passes `node --check`; local page returns HTTP 200; `POST /api/send-task` returns `{"ok":true,"serialConnected":true}` while the board serial path is present.
- ESP-IDF status: `idf.py` is not found in `PATH`, and common install locations `/Users/karinadeng/esp`, `/opt/esp`, `/opt/homebrew/bin/idf.py`, and `/usr/local/bin/idf.py` do not exist. Custom firmware build/flash still requires installing or sourcing ESP-IDF.

## 2026-05-30 Minimal Firmware Demo Hardening

- Hardened the physical-screen LVGL demo so `transition_event` states now render clearly: `agent_idle_on_mac`, `handoff_to_dock`, and `return_to_mac` each produce a visible screen change instead of only `task_update`.
- Kept the firmware intentionally minimal: one main task card, one animated status block, and one action affordance, optimized for “send one message and see the dock react”.
- Verified ESP-IDF build end-to-end using the repo-local toolchain under `.tools/esp-idf` and `.tools/espressif`; generated `build/peekdock.bin` successfully.
- Current validated outcome: the repo can now build a flashable firmware image for the simplest PeekDock loop, and the Mac sender protocol still matches the firmware parser.

## 2026-05-30 Offline LVGL Asset Conversion

- Reused the bundled LVGL offline converter at `managed_components/lvgl__lvgl/scripts/LVGLImage.py`.
- Installed the missing converter dependencies `pypng` and `lz4` into the repo-local ESP-IDF Python environment.
- Batch-converted all current `assets/raw/*.png` files into LVGL `C` resources under `assets/lvgl/` using `RGB565A8`.
- Added `scripts/convert_lvgl_assets.sh` as the one-command asset conversion entrypoint for future PNG updates.

## 2026-05-30 Collaboration Packaging

- Added root `README.md` as a project map for teammates.
- Added `docs/TEAM_HANDOFF.md` to explain where firmware, helper, and assets live.
- Added `docs/HARDWARE_PORTING.md` to separate portable UI/protocol work from board-specific display and touch adaptation.
- Chose a low-risk organization pass: document the project clearly without large file moves that could destabilize the current firmware/demo flow.

## 2026-05-30 Repo Cleanup Pass

- Moved the large vendor bundle from root into `references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo/` so the active project path is easier to scan.
- Moved the old Arduino smoke test into `legacy/platformio-arduino-serial-test/`, including the historical `platformio.ini` and `src/main.cpp`.
- Deleted `.DS_Store` files and removed empty placeholder directories under `src/`.
- Added `PROJECT_CONTEXT.md` back as a real file because the onboarding docs already relied on it as the hardware truth-source entrypoint.
- Updated `README.md`, `docs/TEAM_HANDOFF.md`, and `memory-bank/architecture.md` to reflect the cleaned structure and the separation between active, legacy, and reference paths.

## 2026-05-30 Mac Agent Presence Demo

- Reworked `mac-demo/server.mjs` into a single state authority for `mode`, `agentLocation`, `phase`, current task data, and hardware sync.
- Added new Mac-side interaction APIs: `POST /api/set-mode`, `POST /api/pull-to-mac`, and `POST /api/send-to-dock`.
- Rebuilt `mac-demo/public/` into a dual-container experience showing a Mac desktop area and a dock area, with the rule that only one Codex avatar can be visible at a time.
- Added `clean mode` and `desktop mode` toggles so the MVP can demonstrate default handoff-to-dock behavior plus the “keep it on desktop” preference.
- Added manual recall from dock to Mac through both a button and a drag-to-Mac interaction.
- Preserved ESP32 compatibility by continuing to emit `transition_event` and `task_update` messages over USB Serial/JTAG when the agent is sent to or recalled from the dock.
- Verification: `node --check mac-demo/server.mjs` passes; `node --check mac-demo/public/app.js` passes; `/api/send-task`, `/api/pull-to-mac`, `/api/send-to-dock`, and `/api/set-mode` all return successful state transitions on the local server.

## 2026-05-30 Real Desktop Pet Correction

- Corrected the Mac-side architecture so the browser page is no longer the pet display surface. It is now only a simple testing sender with prompt input, mode toggle, and a small current-task card.
- Added a separate Mac desktop pet process at `mac-demo/desktop-pet-tk.py`. It creates a topmost desktop window in the upper-right corner, reuses the existing Codex PNG assets, supports click-to-toggle task card, and supports dragging.
- Updated bridge behavior: in `clean` mode, sending a task moves `agentLocation` to `dock`, writes `handoff_to_dock` and `task_update` to ESP32, hides the Mac pet, then automatically returns to Mac after completion. In `desktop` mode, the pet stays on Mac.
- Added Electron desktop pet scaffolding under `mac-demo/desktop-pet/`, but Electron currently aborts on this local Mac session, so the runnable demo uses the Tk-based pet.
- Verification: `npm --prefix mac-demo run check` passes; `PYTHONPYCACHEPREFIX=/Users/karinadeng/Documents/peekdock/build/pycache python3 -m py_compile mac-demo/desktop-pet-tk.py` passes; bridge is running on `http://127.0.0.1:4173`; Tk desktop pet process stays alive; `/api/send-task` transitions from `agentLocation=dock` to `agentLocation=mac` after completion in clean mode.

## 2026-05-30 Desktop Pet And ESP32 Manual Handoff

- Added native Swift/AppKit desktop pet at `mac-demo/desktop-pet-swift/PeekDockPet.swift` after Electron and Tk had visibility/runtime issues on the local desktop session.
- Fixed the Swift pet asset path so Codex PNGs load from `assets/raw`.
- Reduced the normal Mac pet size and kept the card hidden until click.
- Added Mac drag-to-dock behavior: dragging the Swift pet to the right screen edge calls `POST /api/send-to-dock`, moves `agentLocation` to `dock`, and sends `handoff_to_dock` plus `task_update` to ESP32.
- Changed clean-mode completion behavior: completion no longer automatically returns to Mac. User action on the ESP32 is now the intended return trigger.
- Added ESP32 input handling in `src/ui/screens/peekdock_screen.cpp`: double-click or left swipe emits `return_to_mac`.
- Added firmware-to-bridge action path: ESP32 writes `action_event` JSON over USB Serial/JTAG, and `mac-demo/server.mjs` reads serial lines and converts `return_to_mac` into `agentLocation=mac`.
- Verification: `npm --prefix mac-demo run check` passes; Swift pet builds with repo-local module cache; ESP-IDF build passes; firmware flashed successfully to `/dev/cu.usbmodem1301`; `POST /api/send-to-dock` returns `agentLocation=dock`.

## 2026-05-30 Desktop Pet Handoff Reliability Fix

- Reduced the normal Swift/AppKit pet window from `190 x 126` to `116 x 98` and resized the Codex image/card to feel closer to a small desktop pet.
- Hardened Mac drag-to-dock: the pet now checks the global mouse position during drag and on mouse-up, and triggers `POST /api/send-to-dock` when the pointer or window reaches the right screen edge.
- Hardened return-to-Mac: the Swift pet now consumes bridge state through both SSE and a 0.75-second `/api/state` polling fallback, so ESP32 left-swipe/double-tap return can still bring the Mac pet back if an event is missed.
- Hardened duplicate cleanup: the Swift pet single-instance lock now terminates the previous recorded PID before starting, and the local stale lock file was cleared before launching the rebuilt pet.
- Verification: `npm --prefix mac-demo run check` passes; Swift pet rebuild passes without warnings; `POST /api/send-to-dock` returns `agentLocation=dock`; `POST /api/return-to-mac` returns `agentLocation=mac`; bridge remains connected to serial.

## 2026-05-30 Real Codex Status Monitor

- Added a real Codex status monitor inside `mac-demo/server.mjs` that only reads `~/.codex/sessions/**/rollout-*.jsonl` and starts from the current file tail on bridge startup.
- Intentionally did not modify `~/.codex/hooks.json` or any Clawd on Desk files. This avoids interfering with existing Clawd hooks already installed on the machine.
- Mapped live Codex log events into PeekDock task states: `running`, `needs_input`, `failed`, `completed`, and `idle`.
- Added `POST /api/codex-test-event` as a local smoke-test endpoint for the bridge-to-ESP32/desktop-pet path; this is not the real source of truth.
- Updated the Swift pet so `failed` and `needs_input` use the Codex error frames.
- Updated the ESP32 LVGL screen so `needs_input` has a yellow progress color and uses the Codex error frames, while `failed` remains red.
- Verification: `npm --prefix mac-demo run check` passes; Swift pet build passes; ESP-IDF build passes; firmware flashed successfully to `/dev/cu.usbmodem1301`; smoke-tested `/api/codex-test-event` for `running`, `needs_input`, and `failed`, each returning `serialConnected=true` and `agentLocation=dock`.

## 2026-05-30 Dual-Agent Runtime: Codex + Claude Code

- Extended `mac-demo/server.mjs` from a single-agent state source to a dual-agent authority with `currentAgent`, `tasksByAgent`, and shared Mac/ESP32 ownership rules.
- Kept the original Codex session monitor path intact while adding a separate read-only Claude Code monitor for `~/.claude/projects/**/*.jsonl`.
- Added real Claude Code status mapping into PeekDock states:
  - new user prompt -> `running`
  - assistant `tool_use` / `thinking` -> `running`
  - permission-like hook hints -> `needs_input`
  - failing `tool_result` / hook exit -> `failed`
  - assistant `end_turn` text -> `completed`
- Added `POST /api/claude-test-event` and `POST /api/switch-agent` for local smoke testing without disturbing real monitors.
- Updated ESP32 task rendering to cache multi-agent `task_snapshot` payloads locally, render Claude frames, and treat Claude `needs_input` / `failed` as the same visual for now.
- Changed ESP32 gestures to the new interaction contract:
  - left swipe -> next agent
  - right swipe -> previous agent
  - up swipe -> return current agent to Mac
- Updated the Swift/AppKit desktop pet to consume `currentAgent` and current task `source`, switch between Codex and Claude PNGs, and reduce the default pet footprint further for the normal transparent mode.
- Verification:
  - `npm --prefix mac-demo run check` passes after the bridge refactor.
  - `npm --prefix mac-demo run pet:swift:build` passes after the desktop pet agent-switching update.
  - ESP-IDF build passes with the new Claude LVGL resources and gesture changes.
- Current limitation:
  - This pass validated buildability, but I have not yet reflashed the ESP32 in this turn, so device-side runtime verification still needs one flash-and-test pass on `/dev/cu.usbmodem1301`.
