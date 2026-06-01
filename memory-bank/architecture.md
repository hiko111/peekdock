# PeekDock 架构记录

## 当前仓库结构

- `assets/README.md`: PNG 资产放置、命名和 P0 最小资产要求。
- `assets/raw/`: 用户提供的原始 PNG UI 稿，按 agent 和状态命名。
- `assets/processed/`: 已按小屏分辨率裁切、压缩、整理后的 PNG 帧。
- `assets/lvgl/`: 由 LVGL Image Converter 输出的 `C` image resources。当前流程使用仓库内 `managed_components/lvgl__lvgl/scripts/LVGLImage.py` 离线批量生成，默认格式为 `RGB565A8`。
- `assets/p0-asset-manifest.md`: P0 demo 使用的最小 PNG 资产清单，以及缺失/可替代资产说明。
- `demo-results/`: P0 快操打开的本地 HTML 结果页，模拟 Codex/Claude/Jimeng 交付物。
- `runtime-bridge/server.mjs`: 当前唯一的 helper/bridge 主入口。它负责读取 Codex、Claude Code、JiMeng 的真实状态，统一任务模型，通过 USB Serial/JTAG 给 ESP32 发 `task_update` / `task_snapshot` / `transition_event`，并接收小屏动作事件。
- `scripts/start-peekdock.sh`: 当前 helper 启动脚本；默认串口为 `/dev/cu.usbmodem1301`，默认 host 为 `127.0.0.1`。
- `scripts/com.peekdock.bridge.plist`: 当前 LaunchAgent 模板，用来把 `runtime-bridge/server.mjs` 作为后台 helper 拉起。
- `legacy/mac-demo-experiments/`: 旧的 Mac 端网页/桌宠实验，保留作历史参考，不再是当前主链路。
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

## 2026-05-31 Bridge 行为补充

- `runtime-bridge/server.mjs` 的 `openAgentOnMac` 现在把 Claude 入口固定为 `open -a "Trae CN"`，匹配当前 macOS 上的实际应用名，避免 `Trae` 找不到应用。
- 同一函数对 JiMeng 增加了浏览器复用逻辑：优先读取 `PEEKDOCK_BROWSER`（默认 `chrome`），通过 AppleScript 在 Chrome 或 Safari 现有窗口中查找 URL 包含 `jimeng` 的标签页；找到则激活该标签页，找不到才打开 `https://jimeng.jianying.com/` 新页面。
- JiMeng 的 AppleScript 执行失败时仍保留 `open <jimengUrl>` 兜底，因此 bridge 重启后即可生效，不依赖固件改动。
- `runtime-bridge/server.mjs` 现在还包含一个 Chrome-only JiMeng monitor：读取 `PEEKDOCK_JIMENG_MONITOR`（默认开启），后台轮询 URL 包含 `jimeng` 的 Chrome 标签页，对页面执行 JavaScript 抓取 `title`、`href`、正文文本、按钮文案、标题和输入框值，再映射为 PeekDock 的 `idle` / `running` / `completed` / `failed` / `needs_input` 状态。
- 当前 JiMeng monitor 采用页面文本启发式而非官方 API：首页 `https://jimeng.jianying.com/ai-tool/home` 会被视为 `idle`，出现登录/授权类文案映射为 `needs_input`，出现生成中/排队中等文案映射为 `running`，出现下载/保存/查看结果等动作且不在首页时映射为 `completed`。
- JiMeng monitor 现已升级为 API-first probe：同一段 Chrome 注入脚本会先从 `performance.getEntriesByType("resource")` 中恢复真实的 `dreamina_subject/get` URL，再用页面内同步 `POST` 请求读取 `ret`、`errmsg`、`itemCount` 和若干任务摘要；只有在 API 无法给出结论时才回退到页面文本启发式。
- 当前实机验证表明，Chrome 里的 `https://jimeng.jianying.com/ai-tool/generate` 标签页虽然会加载 JiMeng SPA，但 `dreamina_subject/get` 返回 `ret=1015, errmsg=login error`。因此 bridge 现在会把这类场景明确归一为 `needs_input / login required`，而不是误判成普通 `running` 或依赖截图。
- 随后又把 JiMeng 的对外状态模型进一步简化成三态：`idle`、`running`、`completed`。即使页面内部出现登录提示、追问补充信息或失败类文案，bridge 对外也不再发 `needs_input` / `failed`，而是把首页视为 `idle`、非首页中间过程统一视为 `running`、结果页/完成态统一视为 `completed`。
- JiMeng snapshot 的 AppleScript 执行路径也从 `exec("osascript ...")` 改成 `execFile("osascript", ["-e", ...])`，避免长脚本在后台轮询里偶发 shell/转义失败。
- 为了让即梦状态更接近实时，JiMeng snapshot 现在进一步拆成两层：后台 `pollJimengChrome()` 走轻量 polling script，只抓实时判定必需字段；`/api/jimeng-probe` 走详细 probe script，保留深度调试数据。两者共用同一套服务端状态归一逻辑，但不再共用同一份超长浏览器注入脚本。
- 当前正式主链重新收敛回单 bridge：LaunchAgent 管理的 `runtime-bridge/server.mjs` 监听 `127.0.0.1:4173`，统一承接 Codex、Claude、JiMeng。此前用于联调即梦的 `4191` 只是临时 debug 副本，现已清理，不应再作为真实状态来源。
- JiMeng 的状态归一现在还包含一个“当前生成优先”规则：在 `/ai-tool/generate` 页面里，如果正文同时出现旧完成结果和新一轮的显式生成信号（如 `图片生成中`、`85%造梦中`），bridge 会优先输出 `running`，避免被历史结果图区误判为 `completed`。
- JiMeng 的完成态生命周期现重新和 Codex / Claude 对齐：helper 统一在 completed 后经过同一段 hold 时间再回 idle。由于浏览器页面可能仍停留在旧 completed 结果页，bridge 对同一张 completed 页面加了一层最小抑制，避免 completed -> idle 后被同页立即弹回 completed；这只是内部防抖，不改变对外统一的任务状态模型。
- 当前 runtime bridge 不再依赖旧 `mac-demo/public` 静态页面兜底；主链路只认 `runtime-bridge/server.mjs`、串口同步和本地 API 调试入口。JiMeng 进入非空任务时也会主动切到当前 agent，保证 helper 当前页、小屏页签和任务缓存同步落到 `jimeng`。
- ESP32 小屏现在为 JiMeng 接入了和 completed 同规格的三套 P2 资源：`jimeng_idle_p2*`、`jimeng_running_p2*`、`jimeng_completed_p2*`。`src/ui/screens/peekdock_screen.cpp` 会按即梦任务的 `idle` / `running` / `completed` 状态切换对应 hero 帧图，不再始终复用 completed 图。
- JiMeng completed 态的页面信号并不总是通过按钮文案暴露。有些完成页仍会保留旧追问文本，但同时已经出现大量 `dreamina-sign` 结果图和结果元信息（例如 `时间 / 生成模式 / 操作类型`）。bridge 现会在页面快照里额外统计 `generatedImageCount`，并优先把“生成页 + 结果图 + 结果元信息”的组合判成 `completed`。

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

- Helper bridge: `scripts/start-peekdock.sh` or `node runtime-bridge/server.mjs`
- Physical dock transport: USB Serial/JTAG on `/dev/cu.usbmodem1301`
- Firmware target build command, once ESP-IDF is installed: `idf.py build`

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
14. ESP32 小屏 UI 现在固定展示三页 agent：Codex、Claude、JiMeng。Codex/Claude 可以由真实或测试状态驱动，JiMeng 是固件内置占位页，不要求 Mac/helper 提供真实状态。
15. ESP32 小屏所有可见内容都位于 172 x 320 viewport 内，root/content layer 关闭滚动，避免 LVGL 在右侧显示默认滚动条。
16. ESP32 小屏左右滑会先在固件本地切换页面并播放短 slide/fade 过渡，再继续发送 `switch_agent_next` / `switch_agent_prev` 给 Mac/helper 做状态同步。
17. Codex/Claude 真实状态展示现在把底层事件进一步归一为短阶段文案：`analyzing`、`starting`、`editing`、`applying changes`、`running checks`、`reviewing`、`finalizing`、`reconnecting`、`waiting for confirmation`。这些阶段写入 `status_text`，ESP32 小屏直接用作小字状态行。
18. `completed` 只代表最终任务完成：真实监控不再用静默/settle 定时器自动推断完成；非完成阶段的假进度被限制在 100 以下，只有显式完成事件进入 100，然后沿用 5 秒 completed hold 后回到 idle。
19. ESP32 小屏在 confirmation/permission 状态下隐藏进度条和百分比，显示跟 agent 主题色一致的 `accept` 按钮；running 状态的右上状态点做轻量呼吸，completed 切入时播放一次小粒子爆发，idle 偶尔显示可点击的小心情气泡。
20. ESP32 小屏当前 idle 态不再显示 `0%` 进度，而是隐藏百分比/进度条并显示一个小心情框；运行态阶段文案通过 60ms timer 做打字机效果，进度条由 `progress_pulse` 和 `progress_flash` 共同呈现移动充能高光，并在 25/50/75 进度节点触发一次短暂 scale 弹跳。
21. ESP32 底部三点现在固定为白色，只通过尺寸和透明度表达当前页，不再跟随 agent 主题色。
22. Codex completion mapping now treats `final_answer` as `finalizing`, not final completion; only explicit `task_complete` becomes `completed`. This is intentionally conservative to avoid mid-task false completed states.
23. The ESP32 idle panel is now a speech-bubble style card with a small tail and short persona copy; idle suppresses the small phase line and hides progress/percent. The previous progress white-flash object was removed, leaving the simpler moving pulse plus milestone bounce.
24. The ESP32 idle bubble is intentionally neutral rather than agent-colored: it uses a dark surface, subtle gray border/shadow, two-word persona copy, and a passive right-side mood mark such as `<3` or `..`. The percent number and `%` are positioned as a single centered group to avoid visual separation at `100%`.
25. Confirmation handling now has an explicit ESP32 -> bridge action path: when the current page is in `needs_input`, a single tap sends `accept_confirmation`. The bridge opens the relevant Mac app and moves the visible dock task to a short `resuming` running state. Confirmation UI uses content-type titles (`Review patch`, `Review command`, `Review network`) plus a compact `waiting...` phase line and `review` CTA.
26. Codex intervention state is now guarded by explicit approval/confirmation/user-input signals or parsed escalation fields in tool arguments. Ordinary `function_call` and `function_call_output` events stay in `running` and only update `status_text` with phase labels like `reading files`, `using tool`, `tool finished`, or `checking output`; tool output text no longer maps Codex to `failed` by itself.
27. New task focus is handled as a deliberate one-shot transition. Real Codex `user_message`, real Claude new user content, and local test-event endpoints can mark an update as focus-worthy, causing the bridge to switch `currentAgent`; subsequent status updates for the same task do not steal focus. Firmware also treats a new `task_id` for a given `source` as a page focus signal and stores tasks in fixed agent page slots.
28. Codex review state uses a split guard before entering `needs_input`: explicit `exec_command` / `shell_command` approvals with `sandbox_permissions=require_escalated` or a non-empty `justification` immediately show ESP32 `Review`, matching Codex's real command-approval flow. More ambiguous confirmation/user-input-like events still schedule a short macOS Accessibility probe and only show `Review` if the live Codex UI contains a three-option approval marker such as `本次会话不再询问` / `don't ask again`. This keeps ordinary file/tool activity in `running` while avoiding missed real command approvals. Tapping the ESP32 review action for Codex activates Codex, tries to click the "don't ask again" approval button when accessible, and otherwise sends keyboard option `2` plus Enter.
29. Review-state touch handling distinguishes single tap and double tap on-device. A single tap waits for the 360ms double-tap window and then sends `accept_confirmation`; a second tap inside that window cancels the accept and sends `open_agent`, so users can double-tap the agent in Review state to return to Codex instead of approving.
30. `runtime-bridge/server.mjs` now keeps Codex Review visible with a short review hold window. While the hold is active, later `function_call_output` / `custom_tool_call_output` events are ignored instead of overwriting `needs_input` back to `running`; the hold is released after the ESP32 Review action successfully sends Codex approval option 2.
31. The bridge now logs every serial write with a compact summary (`task_update`, `task_snapshot`, or `transition_event`) and suppresses exact duplicate serial payloads for a short window. Duplicate snapshots use a longer window so JiMeng/monitor polling cannot flood the ESP32 with identical refreshes.
30. Codex Mac activation uses `open -b com.openai.codex` instead of AppleScript `tell application "Codex"`; the latter can fail with `-1728` despite `/Applications/Codex.app` existing. AppleScript is now only used after activation to inspect/click approval buttons or fall back to `2` + Enter.
31. Codex approval automation depends on macOS Accessibility permission for `osascript` / System Events. If macOS returns `-25211`, the bridge now opens Codex and keeps the dock task in `needs_input` with `open Codex` instead of falsely switching to `resuming`; only a successful option-2 script changes the task back to `running`.
32. Runtime bridge headless mode now also listens on `127.0.0.1:4173` and prints a build marker at startup. This keeps the physical serial bridge active while allowing local debug endpoints such as `/api/debug-codex-accept` to simulate an ESP32 Review tap and verify the Codex approval automation path.
33. ESP32 UI motion now uses a single faster LVGL animation timer for life cues while keeping protocol unchanged. `peekdock_screen.cpp` owns hero breathing, status-dot mood glow, progress-head shimmer, static page dots, light content slide, label fade transitions, and `peekdock_screen_touch_feedback()`; `app_main.cpp` only triggers the feedback pulse on long press/double tap. Whole-screen opacity/scale transitions are intentionally avoided because the black `content_layer` background can read as a large overlay during swipes.
33. Review tap handling was simplified after repeated testing: when the current page is in confirmation state, any tap now immediately sends `accept_confirmation`; the older double-tap-to-open behavior is disabled for Review state because it made rapid testing produce `open_agent` instead of approval. The bridge also trims serial action/source fields and logs `Dock confirmation requested` / `Dock confirmation handling` before running the Codex option-2 script.
34. ESP32 hero art now supports a local-only drag hide interaction. `app_main.cpp` detects a deliberate vertical drag on the current agent and calls UI-only APIs in `peekdock_screen.cpp`; upward drag previews shrink/fade/translate the hero toward the top edge, release beyond threshold hides only the hero image, and downward drag restores it. This does not emit `return_to_mac`, so the older Mac handoff path remains available outside this hero-local gesture.
35. The local hero drag interaction is performance-sensitive: drag preview no longer deletes LVGL animations every frame, and `app_main.cpp` throttles small drag progress deltas before taking the LVGL lock. The same ESP32 screen pass also adds agent-colored title pills, state-specific status-dot rhythms, per-agent hero idle motion, an idle panel micro-breath, and a small top-right mood bubble using default-font-safe symbols.
36. The local hero drag interaction now treats LVGL as UI-thread-owned. `app_main.cpp` only records touch intent and calls lock-free request functions, while `peekdock_screen.cpp` consumes drag/hide/restore requests from a lightweight LVGL timer before mutating hero transforms. This avoids the touch task repeatedly taking the LVGL lock during finger movement and prevents drag preview from fighting hero breathing animations. The separate top-right mood bubble is disabled; idle expression remains in the lower idle panel only.
37. ESP32 touch debugging now has a minimal firmware-side monitor: `app_main.cpp` posts concise `touch:` logs and `peekdock_screen.cpp` renders the latest touch state in a tiny top overlay. Upward hero drag also has a watchdog path: once the drag reaches the top threshold, or the touch controller does not release after a clear upward drag, the firmware commits hide and clears the touch sequence so later swipes/taps are not locked by a stale `touch_was_down` state.
38. Touch input is now treated as unreliable for continuous coordinates on the AXS5106 path. The firmware keeps swipe recognition when `dx/dy` are available, but adds deterministic tap zones: left/right screen edges switch agents, top hides the hero, and bottom restores it. The AXS5106 driver also clears `tp->data.points` when the controller reports zero touches so stale points cannot survive a release/no-touch read.
39. Because upward hero drags can leave the AXS5106 path in a stale pressed state, the touch task now performs a short hardware reset of the touch controller via `EXAMPLE_PIN_TP_RST` after hero-hide commits and after stale-touch watchdog expiry. It also ignores touch input for 300ms after reset to drain residual controller state before accepting new taps/swipes.
40. Mid-drag coordinate loss is now treated as a first-class failure mode. `src/app/app_main.cpp` tracks the last observed motion timestamp during hero drag; if the AXS5106 stops producing new coordinates for ~180ms before a release arrives, the firmware auto-recovers on its own path: progress >= 35 commits the local hide, otherwise the hero snaps back, and both branches reset the touch controller. This keeps a half-finished upward drag from pinning the whole screen in one stale touch sequence.
41. The touch gesture state machine in `src/app/app_main.cpp` has been refactored into a release-driven flow: touch down only records origin/time, move phase locks to horizontal or vertical direction once intent is clear, and all actions are emitted only after a valid locked gesture or on release. Horizontal swipe now has higher priority than hero hide once horizontal intent is clear; confirmation no longer fires on touch down; double tap is evaluated from center-zone release events; and all `peekdock_screen_*` calls from the touch task go through LVGL lock wrappers instead of direct unlocked UI access.
41. The local hero hide interaction is now page-local and release-driven. `peekdock_screen.cpp` stores hidden state per fixed agent page instead of one global flag, so hiding Codex no longer hides Claude/JiMeng or blocks later horizontal swipes. `app_main.cpp` no longer commits hide mid-drag or sends `return_to_mac` for a plain upward swipe; it only previews while the finger is moving, commits hide on release past threshold, and restores only when the user drags downward from the bottom area on that same hidden page.
42. The touch gesture model no longer treats `hero hidden` as a modal restore-only state. `src/app/app_main.cpp` now separates `hero_hidden` from `gesture_mode`: horizontal swipe and double tap work the same whether the hero is visible or hidden, upward drag only hides when the hero was visible at touch-down, downward drag only restores when the hero was hidden at touch-down, and invalid vertical directions are marked consumed instead of hijacking later tap/swipe handling.

这层逻辑当前主要在：

- `mac-demo/server.mjs`
- `mac-demo/public/app.js`
- `mac-demo/public/index.html`
- `mac-demo/public/styles.css`
- `mac-demo/desktop-pet-tk.py`
- `mac-demo/desktop-pet-swift/PeekDockPet.swift`
- `src/ui/screens/peekdock_screen.cpp`
- `src/app/app_main.cpp`

历史上的 `mac-demo` / 桌宠实验现已迁入 legacy 范畴，不再作为当前协作者理解项目主链路的入口。

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
