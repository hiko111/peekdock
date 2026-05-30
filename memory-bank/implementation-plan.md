# PeekDock 实施计划

原则：每一步都要小、具体、可验证；验证通过前不进入下一步。黑客松 P0 的目标不是“做完所有底层驱动”，而是跑通一个可信的跨屏任务舱 demo：Mac 闲置态 -> 发起 mock AI 任务 -> 小屏工作态 -> 多 Agent 查看 -> 完成/异常提示 -> 小屏召回 Mac。

## Step 1: 锁定 P0 Demo 契约

把黑客松 P0 的演示契约写清楚，作为后续所有开发的边界。契约必须包含：3 个 Agent、状态列表、跨屏事件、mock 任务脚本、快操行为、降级策略和不做事项。

固定决策：

- Agent：Codex、Claude 网页端、即梦。
- 任务源：全部 mock，不接真实 AI 工具。
- Mac 端：Web 页面模拟桌面 agent 和跨屏动画。
- 小屏端：Waveshare ESP32-S3-Touch-LCD-1.47，ESP-IDF 5.2+，LVGL 9.x。
- 通信：USB Serial，`/dev/tty.usbmodem1301`。
- 小屏切换：优先触摸横滑，失败则左右边缘点击。
- 快操：只打开白名单内本地 HTML 或图片。
- P0 不做：云服务、账号体系、真实 AI API 接入、完整 Mac 配置软件、可拆卸随身模式。

验证：用户确认 P0 契约；`design-document.md`、`hackathon-demo-plan.md`、`tech-stack.md` 中没有与以上契约冲突的描述。

## Step 2: 建立 Demo 信息架构和状态脚本

把演示从“想法”变成一份可以驱动 UI 和协议的状态脚本。定义 90 秒 demo 的任务时间线、三个 Agent 的状态变化、每个状态的小屏文案、Mac 动画段，以及用户点击/滑动的触发点。

产物应覆盖：

- Codex 主线：idle -> handoff_to_dock -> running -> completed -> open_result -> return_to_mac。
- Claude 网页端支线：running 或 needs_input，用于横滑查看。
- 即梦支线：running 或 completed，用于横滑查看。
- 至少一个异常展示：failed 或 needs_input。
- 每个任务的 `task_id`、`source`、`title`、`status_text`、`animation_key`、`result_uri`、`actions`。

验证：不运行任何代码，仅阅读状态脚本，就能复述完整 demo；脚本中的每个状态都能映射到设计文档的状态模型。

## Step 3: 定义跨屏协议和 Mock 数据

把 Step 2 的状态脚本转换成 JSON Lines 协议样例。协议先服务 demo，但字段要保留后续真实接入的空间。

产物应包含：

- `task_snapshot`
- `task_update`
- `transition_event`
- `action_event`
- `heartbeat`
- `sync_snapshot`
- Codex、Claude 网页端、即梦三组 mock 数据。

验证：每条 JSON 都包含必要字段；Mac/helper 能按顺序播放脚本；ESP32 即使只打印日志，也能识别 task、status 和 action。

## Step 4: 梳理并冻结 P0 资产清单

整理 `assets/raw/` 中已有 PNG，确定 P0 真正使用的最小资产集，并统一命名。资产先服务 demo，不追求覆盖全部角色和全部状态。

最小资产集：

- Codex：idle、handoff/running、completed、failed 或 needs_input。
- Claude 网页端：running，另可选 completed/needs_input。
- 即梦：running，另可选 completed。
- Mac Web 端需要的闲置/离开/召回图像。

验证：资产清单中每个 `animation_key` 都能找到对应 PNG；文件命名只使用小写、下划线和数字；`codex-running_01.png` 这类混合命名需要统一为 `codex_running_01.png`。

## Step 5: 建立固件 Bring-Up 最小路径

建立 ESP-IDF 5.2+ 工程骨架，并先做“硬件可显示、可触摸、可收串口”的最小验证。这里的目标是解除硬件不确定性，不做 PeekDock 业务 UI。

产物应包含：

- `CMakeLists.txt`
- `sdkconfig.defaults`
- `PROJECT_CONTEXT.md` 中约定的目录结构。
- Waveshare 官方 demo 中 JD9853 和 AXS5106L 初始化代码的来源记录。
- 屏幕纯色/色条烟测。
- 触摸坐标串口日志。
- USB Serial 接收一行文本并打印。

验证：`idf.py build` 通过；刷机后屏幕有可见输出；触摸有坐标日志；Mac 通过 `/dev/tty.usbmodem1301` 发一行文本，设备能打印。

## Step 6: 接入 LVGL 基础 UI 壳

在硬件 bring-up 通过后接入 LVGL 9.x，先做一个不含业务逻辑的 UI 壳，验证显示刷新、触摸输入、布局边界和性能。

产物应包含：

- LVGL display flush callback。
- LVGL touch input callback。
- 172 x 320 portrait 布局。
- 一个状态栏、一个占位 Agent 图像区域、一个主按钮、一个页面切换区域。

验证：LVGL 页面能稳定显示；点击按钮有反馈；左右边缘点击或简单滑动能切换占位页面；没有明显卡死、错色、文字溢出。

## Step 7: 搭建 Mac Web Demo 壳

搭建 Mac 端 Web 原型，先不连硬件，只根据 Step 2 的状态脚本播放 Mac 端体验。

产物应包含：

- 闲置 agent 画面。
- “Start Codex task” 触发器。
- agent 离开 Mac 的动画。
- 接收 return 事件后的召回动画。
- 打开本地 HTML/图片结果的占位交互。

验证：浏览器中可以完整播放 Mac 侧 idle -> handoff -> return；不依赖 ESP32 也能演示 Mac 端叙事。

## Step 8: 搭建 Mac/helper 桥接层

实现 helper 作为状态权威，连接 Mac Web UI 和 ESP32。此时 ESP32 可以先只打印收到的协议，不要求完整 UI。

产物应包含：

- WebSocket 或 localhost HTTP 服务，给 Mac Web UI 推送事件。
- USB Serial writer/reader，连接 `/dev/tty.usbmodem1301`。
- mock timeline runner，按 Step 2 时间线发送事件。
- action whitelist，只允许打开本地 HTML/图片。

验证：点击 Mac Web 的开始按钮后，helper 能同时向 Web UI 和 ESP32 发送对应事件；ESP32 日志能看到事件；helper 收到模拟 `action_event` 后能触发 Mac return。

## Step 9: 实现小屏任务 UI 第一版

把 LVGL UI 壳接入真实任务协议，实现小屏上的核心任务画面。先做静态/少帧状态，不急着完善动画细节。

产物应包含：

- 当前 Agent 任务卡。
- source、title、status_text、运行时长或阶段文案。
- 状态图像区域。
- 主动作按钮或点击区域。
- failed / needs_input / completed / running 的明显视觉区分。

验证：helper 发送 Codex 状态变化时，小屏能从 running 切到 completed/failed/needs_input；未知进度不显示虚假百分比。

## Step 10: 实现多 Agent 查看

让小屏维护三个 mock 任务，并支持用户在 Codex、Claude 网页端、即梦之间切换。优先触摸横滑；如不稳，使用左右边缘点击。

产物应包含：

- 三个任务的本地缓存。
- 当前选中任务索引。
- 高优先级状态排序规则。
- 横滑或边缘点击切换。

验证：helper 发送三个任务后，小屏可切换查看；failed/needs_input 优先级高于 completed 和 running；切换不导致布局错乱。

## Step 11: 接入 P0 图片资产和轻量动画

把 Step 4 冻结的 PNG 资产接入 LVGL。动画只做关键状态的 1-2 帧，不做高帧率效果。

产物应包含：

- `assets/processed/` 中的裁切版本。
- `assets/lvgl/` 中的 LVGL 转换资源。
- Codex 主流程至少 3 个状态图。
- Claude 网页端和即梦至少 running 图。
- 至少一个 2 帧循环动画。

验证：小屏显示真实 Agent 图像；状态变化会切换图像；2 帧动画不卡顿；Flash/RAM 占用可接受。

## Step 12: 打通小屏快操到 Mac 召回

实现小屏主动作上报，并让 helper 触发 Mac Web 召回和打开结果。

产物应包含：

- 小屏发送 `action_event`。
- helper 识别 `open_result`。
- helper 打开白名单本地 HTML/图片。
- Mac Web 播放 return_to_mac 动画。

验证：用户在小屏点击 completed 任务的主动作后，Mac 端打开结果，并播放 agent 回到 Mac 的动画。

## Step 13: 完成端到端彩排

把 Mac Web、helper、ESP32 小屏按 90 秒 demo 脚本跑通，记录所有需要人工操作的节点。

验证流程：

- Mac 显示 idle。
- 用户点击 Start Codex task。
- Mac 播放离开动画。
- 小屏显示 Codex running。
- 小屏切换查看 Claude 网页端和即梦。
- Codex 变为 Ready to review。
- 用户在小屏触发 open_result。
- Mac 打开本地 HTML/图片并播放召回。
- 额外展示 failed 或 needs_input。

验证：连续跑 3 次 demo，不需要改代码、不需要手动重启进程；每次都能完成主流程。

## Step 14: 黑客松前打磨和降级预案

冻结 demo，补齐演示话术、失败预案和现场操作说明。只修影响演示稳定性的 bug，不再扩范围。

产物应包含：

- 60-120 秒演示脚本。
- 启动顺序说明。
- 常见故障恢复：串口断开、触摸不稳、WebSocket 断开、图片加载失败。
- 降级路径：触摸横滑失败则边缘点击；硬件 UI 异常则 Web 小屏模拟；真实工具接入不展示。

验证：团队成员只看说明即可启动 demo；现场没有网络时仍可演示 mock 主流程。

## Step 15: 真实接入探索

黑客松 P0 稳定后，再探索真实工具接入。不要让真实接入影响 mock demo 稳定性。

探索对象：

- Codex：CLI、日志、工作区事件或 helper 包装命令。
- Claude 网页端：浏览器扩展、通知监听、手动任务登记。
- 即梦：官方 API、任务中心、浏览器通知、结果 URL/图片导入。

验证：产出接入评估，说明每个工具可获得的状态、限制、隐私风险和最小可行方案。

## Step 16: 更新记忆文档

每完成一个经过用户验证的里程碑后，更新 `progress.md` 和 `architecture.md`。不要把设计决策散落在聊天记录里。

验证：另一个 agent 只读 `PROJECT_CONTEXT.md`、`PRD.md` 和 `memory-bank/`，能理解当前进度、文件职责、下一步动作和未决风险。

