# PeekDock 架构记录

## 当前仓库结构

- `assets/README.md`: PNG 资产放置、命名和 P0 最小资产要求。
- `assets/raw/`: 用户提供的原始 PNG UI 稿，按 agent 和状态命名。
- `assets/processed/`: 已按小屏分辨率裁切、压缩、整理后的 PNG 帧。
- `assets/lvgl/`: 由 LVGL Image Converter 输出的 `C` image resources。当前流程使用仓库内 `managed_components/lvgl__lvgl/scripts/LVGLImage.py` 离线批量生成，默认格式为 `RGB565A8`。
- `assets/p0-asset-manifest.md`: P0 demo 使用的最小 PNG 资产清单，以及缺失/可替代资产说明。
- `demo-results/`: P0 快操打开的本地 HTML 结果页，模拟 Codex/Claude/Jimeng 交付物。
- `docs/TEAM_HANDOFF.md`: 给协作者的快速上手说明，解释入口文件、当前粗糙边界和推荐 debug 顺序。
- `docs/HARDWARE_PORTING.md`: 硬件迁移说明，明确哪些层可复用、哪些层必须按板子重配。
- `mac-demo/`: 本地 Mac bridge、网页测试发送器和桌面小人原型。`server.mjs` 承担单一状态源角色，统一管理 `mode`、`agentLocation`、任务阶段和串口同步；`public/` 只保留网页输入/模式切换/任务卡测试面板；`desktop-pet-swift/PeekDockPet.swift` 是当前主用 Mac 端透明桌宠，`desktop-pet-tk.py` 仅作为 fallback。
- `protocol/`: P0 JSON Lines 协议说明和 mock fixtures。`mock-timeline.json` 驱动 helper，`demo-events.jsonl` 可直接作为串口测试数据。
- `PROJECT_CONTEXT.md`: Waveshare ESP32-S3-Touch-LCD-1.47 的硬件事实、驱动要求和 ESP-IDF 目标约束。
- `CMakeLists.txt`: ESP-IDF project-level build file for the target firmware.
- `sdkconfig.defaults`: ESP-IDF default configuration, including ESP32-S3 target, 16MB flash and PSRAM settings.
- `components/esp_bsp/`: 从官方 Waveshare ESP-IDF LVGL demo 导入的板级组件，封装 SPI LCD、I2C touch、背光、SD、Wi-Fi 等板级初始化；当前固件主要使用 display、touch、I2C 和背光部分。
- `components/esp_lcd_jd9853/`: 从官方 Waveshare demo 导入的 JD9853 panel driver and initialization sequence。
- `components/esp_lcd_touch_axs5106/`: 从官方 Waveshare demo 导入的 AXS5106L capacitive touch driver。
- `src/CMakeLists.txt`: ESP-IDF component build file for the firmware source tree.
- `src/idf_component.yml`: ESP-IDF managed component dependency declaration, currently pulling LVGL 9.x, `esp_lvgl_port`, `esp_lcd_touch`, and button dependencies used by the imported BSP.
- `src/app/app_main.cpp`: ESP-IDF firmware entrypoint; initializes NVS, official Waveshare BSP display/touch, LVGL port, PeekDock screen, and USB-Serial/JTAG JSON Lines receive task.
- `src/protocol/`: Firmware-side JSON Lines parser for P0 task events.
- `src/ui/screens/`: First LVGL small-screen task UI skeleton. The current minimal demo explicitly handles idle, `handoff_to_dock`, running, completed, and `return_to_mac` visual states so one serial event can produce an obvious hardware-screen reaction.
- `scripts/convert_lvgl_assets.sh`: one-command offline asset conversion entrypoint; converts `assets/raw` PNG files into LVGL `C` assets in `assets/lvgl`.
- `PRD.md`: 从原始产品方案标准化得到的轻量 PRD。
- `memory-bank/p0-demo-contract.md`: P0 demo scope contract and non-goals.
- `memory-bank/demo-state-script.md`: Product-level demo timeline used to drive protocol fixtures and UI behavior.
- `memory-bank/design-document.md`: 当前产品设计、P0 范围、状态模型和验收标准。
- `memory-bank/tech-stack.md`: 当前推荐技术栈和阶段性技术选择。
- `memory-bank/implementation-plan.md`: 后续按步骤执行的实施计划。
- `memory-bank/hackathon-demo-plan.md`: 黑客松演示路径、开发难点和 demo 取舍。
- `memory-bank/progress.md`: 工作进度和验证记录。
- `memory-bank/architecture.md`: 本文件，记录重要文件职责和架构变化。
- `README.md`: 项目级地图，供新协作者快速理解当前 repo 的结构和入口。
- `PROJECT_CONTEXT.md`: 当前硬件事实和协作入口，用来避免新同学直接从 UI 层开始改。
- `AGENTS.md`: Codex 工作规则和 memory-bank 读取要求。
- `legacy/platformio-arduino-serial-test/`: 早期 Arduino/PlatformIO 串口烟测原型，保留作历史参考，不参与当前 ESP-IDF 主路径。
- `references/vendor/waveshare-esp32-s3-touch-lcd-1.47-demo/`: 厂商原始 demo 整包，保留作 bring-up、驱动和显示行为对照，不作为当前应用工程入口。

## 当前系统假设

P0 采用三层结构：

1. Mac agent UI：负责闲置态、任务发起离开动画、完成召回动画和后台入口。
2. Mac/helper bridge：作为权威状态层，负责采集/模拟任务、归一化、发送状态、执行快操。
3. ESP32-S3 小屏固件：负责工作态展示、多 Agent 横滑、状态动画和动作输入。

## 已确认硬件

- Board：Waveshare ESP32-S3-Touch-LCD-1.47
- MCU：ESP32-S3R8
- CPU：Xtensa LX7 dual core, up to 240MHz
- Flash：16MB
- PSRAM：8MB
- 无线：WiFi 2.4GHz / Bluetooth LE 5
- Storage：MicroSD slot
- USB 模式：USB-Serial/JTAG
- MAC：`1c:db:d4:7b:9a:14`
- 当前 Mac 串口：`/dev/tty.usbmodem1301`
- Display：1.47 inch IPS, 172 x 320, RGB565, 262K color
- LCD driver：JD9853
- LCD interface：4-wire SPI
- Touch controller：AXS5106L
- Touch interface：I2C
- Touch：single touch, gesture supported

## GPIO Mapping

- `LCD_SCLK`: 38
- `LCD_MOSI`: 39
- `LCD_CS`: 21
- `LCD_DC`: 45
- `LCD_RST`: 40
- `LCD_BL`: 48
- `TP_SDA`: 17
- `TP_SCL`: 18
- `TP_INT`: 16
- `SD_CS`: 14

## Target Firmware Architecture

Target firmware must use ESP-IDF 5.2+ and LVGL 9.x, not Arduino.

```text
components/
 ├── esp_bsp/
 ├── esp_lcd_jd9853/
 └── esp_lcd_touch_axs5106/
src/
 ├── app/
 │    └── app_main.cpp
 ├── protocol/
 │    ├── task_protocol.cpp
 │    └── task_protocol.h
 └── ui/
      └── screens/
          ├── peekdock_screen.cpp
          └── peekdock_screen.h
```

Do not invent JD9853 or AXS5106L register sequences. The current firmware imports the official Waveshare ESP-IDF/LVGL demo components as the source of truth for display and touch initialization.

## P0 数据流

Current minimal demo flow:

1. Mac Codex input page shows a text box and `Send to ESP32`.
2. User enters a task prompt.
3. Mac/helper creates one `task_update` event and writes it as JSON Lines to `/dev/tty.usbmodem1301`.
4. ESP32-S3 reads the message through the USB-Serial/JTAG driver.
5. ESP32-S3 physical screen switches to Codex running state and plays a simple pulse/dots animation.

Supported visual reactions in the current firmware:

1. `transition_event` `agent_idle_on_mac`: reset screen to waiting/idle state.
2. `transition_event` `handoff_to_dock`: show a handoff/incoming state immediately, before a full task update arrives.
3. `task_update` and first item of `task_snapshot`: render the primary task card and status color.
4. `transition_event` `return_to_mac`: show a finished/returning state on the dock.

Later full demo flow:

1. Mac agent UI 显示闲置 agent。
2. 用户发起 mock 任务，Mac/helper 创建任务并通知 Mac UI 播放离开动画。
3. Mac/helper 通过 USB Serial 发送 `handoff_to_dock` 和任务快照到 ESP32-S3。
4. ESP32-S3 播放进入动画，切到对应 agent 工作画面。
5. Mac/helper 持续发送 `dock_status_update`。
6. ESP32-S3 缓存任务列表，支持触摸横滑或屏幕边缘点击切换多 Agent。
7. 用户在小屏触发动作。
8. ESP32-S3 发送 `action_event` 给 Mac/helper。
9. Mac/helper 根据白名单打开本地 HTML 或图片结果，并通知 Mac UI 播放召回动画。

## 通信边界

- Mac UI 与小屏不是同一个渲染表面，跨屏动画通过状态机对齐，不追求逐像素连续。
- Mac/helper 是唯一能执行本地系统动作的模块，小屏不能直接打开文件或控制应用。
- 小屏重启后，Mac/helper 必须下发 `sync_snapshot` 恢复当前任务状态。
- Mac/helper 也是当前唯一允许修改 `agentLocation` 的模块；Web UI 和 ESP32 都只消费该状态，不自行决定双端同时显示。

## 小屏固件建议模块

- `components/esp_bsp`: 官方板级 bring-up，初始化 SPI display、I2C touch 和 backlight。
- `components/esp_lcd_jd9853`: 官方 JD9853 panel driver。
- `components/esp_lcd_touch_axs5106`: 官方 AXS5106L touch driver。
- `esp_lvgl_port`: LVGL display/touch registration and refresh task。
- `assets`: 存放由 PNG 转换得到的 LVGL 图片资源。
- `protocol`: 解析 JSON Lines 任务事件并上报动作事件。
- `task_store`: 缓存任务列表、排序和当前选中项。
- `screens`: idle、working、completed、needs_input、failed 等小屏画面。
- `input`: 触摸横滑和边缘点击降级，映射多 agent 切换和主动作。

## Mac 端建议模块

- `agent-ui`: 桌面闲置、离开和召回动画。
- `bridge`: 串口连接 ESP32，WebSocket/HTTP 连接 Mac UI。
- `mock-task-adapters`: Codex、Claude 网页端、即梦三个 mock 任务源。
- `real-task-adapters`: 后续真实 Codex、Claude 网页端、即梦接入适配器。
- `action-runner`: 白名单执行打开本地 HTML 或图片。

## Current Runtime Entry Points

- Mac Codex sender: `npm --prefix mac-demo start`, then open `http://127.0.0.1:4173`.
- Send a task to the physical ESP32: submit the form, or call `POST /api/send-task` with `{"prompt":"..."}`.
- Firmware target build command, once ESP-IDF is installed: `idf.py build`.

## 当前 Mac Bridge / Desktop Pet 状态机

- `mode`: `clean` 或 `desktop`
- `agentLocation`: `mac` 或 `dock`
- `currentAgent`: 当前在 Mac 和 ESP32 同步展示的 agent，现阶段为 `codex` 或 `claude`
- `phase`: `idle`、`handoff`、`running`、`needs_input`、`failed`、`completed`
- Codex real status monitor: `mac-demo/server.mjs` 默认只读监听 `~/.codex/sessions/**/rollout-*.jsonl` 的新增行，不修改 `~/.codex/hooks.json`，避免影响 Clawd on Desk 或 Codex 原有 hook。
- Claude Code real status monitor: `mac-demo/server.mjs` 只读监听 `~/.claude/projects/**/*.jsonl` 的新增行，不修改 Claude Code 本身或 Clawd on Desk 的任何实现。

当前 demo 行为：

1. 默认 `clean` 模式。
2. Mac 端小人由独立桌面窗口负责展示，默认位于屏幕右上角。
3. 网页端只负责测试发送任务和切换 `clean` / `desktop` 模式。
4. `clean` 模式发起任务后，Mac 小人向右滑出并隐藏，ESP32 小屏接收 `handoff_to_dock` 和 `task_update`。
5. 任务完成后会先停留在 `completed` 5 秒，再转成 `idle`；当前 agent 处于 `dock` 时，用户可在 ESP32 上上滑把它召回到 Mac。
6. `desktop` 模式发起任务后，小人留在 Mac；ESP32 只收到 idle/return 类事件，不承担小人形象展示。
7. Mac 小人支持点击展开/收起任务卡，也支持拖动窗口位置；拖到屏幕右边缘会调用 bridge 的 `POST /api/send-to-dock`，把小人送回 ESP32。
8. Swift/AppKit 桌宠使用 `/tmp/peekdock-pet.lock` 做单实例保护；新版启动会终止旧 PID 并覆盖锁，避免桌面残留多个历史小人。
9. Swift/AppKit 桌宠同时使用 SSE 和 0.75 秒 HTTP 轮询消费 `/api/state`，所以 ESP32 上滑触发 `return_to_mac` 后，即使 SSE 漏包也会把 Mac 小人重新 `orderFront` 回桌面。
10. 真实 Codex 状态接入当前采用 session JSONL 只读轮询：`user_message` / `task_started` 映射为 `running`，工具调用映射为 `running`，包含 `require_escalated` 的工具调用映射为 `needs_input`，异常工具输出或 turn 中断映射为 `failed`，`final_answer` / `task_complete` 映射为 `completed`。
11. 真实 Claude Code 状态接入当前采用 project JSONL 只读轮询：用户新输入映射为 `running`，assistant `tool_use` 映射为 `running`，权限/确认类 hook 提示映射为 `needs_input`，失败的 `tool_result` 或 hook exit code 映射为 `failed`，assistant `end_turn` 文本映射为 `completed`。
12. 小屏当前以 `task_snapshot` 为多 agent 本地缓存源，左右滑切换 `currentAgent`，上滑返回 Mac；bridge 始终保证 Mac 和小屏只展示同一个当前 agent。
13. 本地调试入口 `POST /api/codex-test-event` 和 `POST /api/claude-test-event` 仅用于验证 bridge -> Swift pet -> ESP32 链路，不作为真实任务来源；真实来源仍分别是 Codex 与 Claude Code 的 session/project 日志。

这层逻辑当前主要在：

- `mac-demo/server.mjs`
- `mac-demo/public/app.js`
- `mac-demo/public/index.html`
- `mac-demo/public/styles.css`
- `mac-demo/desktop-pet-tk.py`
- `mac-demo/desktop-pet-swift/PeekDockPet.swift`
- `src/ui/screens/peekdock_screen.cpp`
- `src/app/app_main.cpp`

`mac-demo/desktop-pet/` 中保留 Electron 透明窗尝试，但当前本机启动 Electron 会 `SIGABRT`，所以现阶段 demo 以 Swift/AppKit 桌宠为准。
Tk 版曾用于验证置顶窗口路径，但 macOS Tk 在透明度、PNG 和窗口可见性上不够稳定，当前只保留为 fallback。

## 目录整理说明

- 已将早期 `platformio.ini` 和 `src/main.cpp` 从根目录主路径迁入 `legacy/platformio-arduino-serial-test/`，避免协作者误把 Arduino 原型当作当前入口。
- 已将体积较大的 Waveshare 厂商 demo 整包迁入 `references/vendor/`，保留参考价值，同时降低根目录噪音。
- 已删除仓库中的 `.DS_Store` 和无内容占位目录，减少无效文件。

## 尚未实现

- ESP-IDF build verification; `idf.py` is not available in the current environment.
- Hardware flash/display/touch validation on the physical Waveshare board.
- PNG 到 LVGL 资源转换。
- 多任务缓存。
- 小屏输入事件。
- 真实 AI 工具接入。
