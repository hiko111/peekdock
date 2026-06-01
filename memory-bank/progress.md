# PeekDock 进度日志

## 2026-06-01 Center UI Cleanup Pass

- 针对用户最新指出的中部异常浮层，重新检查 `src/ui/screens/peekdock_screen.cpp`，确认真正的视觉来源不是右上角状态点，而是内容区中段历史遗留的 `tool_chip` 胶囊层。
- 本轮只做小范围 UI 收敛，不碰 bridge、MCP、状态协议和触摸状态机：
  - 停止在运行态 / 完成态 / review 态显示中部 `tool_chip`，避免再出现“小点 + done + 边框”的悬浮感。
  - 把 `task_type_label` 改成内容层中的纯文字副信息行，和大标题、打字机小字拆成更接近参考稿的三层结构。
  - 重做百分比布局，新增 `layout_percent_group()`，按数字实际宽度计算 `%` 和数值的整体居中，避免此前数字整体偏右。
  - `idle` 态继续隐藏进度区，并去掉多余的中段标签残留。
- 代码清理：
  - 删除了已不再使用的 `style_tool_chip()` 旧样式函数，避免后续继续误把中段 chip 当作当前设计的一部分。
- 验证：
  - 使用 repo-local ESP-IDF toolchain 手动补全 `cmake` / `ninja` / `xtensa` / `riscv32` 路径后，`idf.py build` 成功，生成新的 `build/peekdock.bin`。
  - 随后两次 `idf.py -p /dev/cu.usbmodem1301 flash` 均失败，不是代码错误，而是串口打开阶段被系统拒绝：`Operation not permitted: '/dev/cu.usbmodem1301'`。期间还确认并手动结束过一个占串口的 `node` 进程，但系统层串口权限/占用问题仍需继续处理后才能完成本轮烧录。

## 2026-06-01 Small Screen UI Refinement Pass

- 按最新三张参考 SVG，对 `src/ui/screens/peekdock_screen.cpp` 做了一轮继续收敛的单卡片化 UI 微调，保持现有状态机、bridge 协议和触摸链路不变，只调整视觉层。
- 已保留一份并行安全备份：`src/ui/screens/peekdock_screen_交互优化版.cpp`，方便你另一线程继续跑时随时对照。
- 本轮主要变化：
  - `working` 状态继续去“仪表盘感”，让 hero、主标题、副标题和细进度条更接近参考稿里的海报式层级。
  - `needs_input` 继续做强区分：保留 tool chip 但改为更低存在感的冷色样式，`review now` 按钮加重边框和阴影，避免看起来像普通 running。
  - `idle` 保持轻量，不恢复旧的大气泡感，只延续小卡片和更安静的文案。
- 代码层新增 `style_tool_chip()`，统一处理普通态和 need-input 态的 chip 风格；`set_progress_area_mode()` 现在会在 idle 隐藏 chip，在 running / need-input 时按需显示。
- 重新人工复查了 `render_idle()`、`render_task()` 和初始化布局，确认 `needs_input -> running` 时按钮阴影、标题色和 chip 样式会回到正常分支，不会把 review 态样式残留到普通任务。
- 构建验证情况：
  - 先确认 `.venv/bin/pio run` 不是当前仓库的正式验证路径，因为项目并非 PlatformIO 工程。
  - 随后切回 ESP-IDF 正式路径执行 `idf.py build`，目前阻塞在本机工具链 PATH：`idf.py` 已启动，但 shell 没拿到 `cmake`。
  - 进一步检查发现 `cmake` 实际位于 `.tools/espressif/tools/cmake/3.30.2/CMake.app/Contents/bin/cmake`，当前构建环境还没把这个路径显式挂进去。
- 结论：UI 代码已经落盘并完成代码级自检，但这轮还没在本机完成一次正式 ESP-IDF build；下次验证前应先把 `CMake.app/Contents/bin` 补进 PATH，再跑 `idf.py build`。

## 2026-06-01 Touch Drag Stall Recovery

- 继续针对 ESP32 小屏“上滑到一半全局卡死”问题做最小修复，确认主要故障模式不是 LVGL 动画本身，而是 AXS5106 在拖拽中途偶发停止上报新坐标或缺失 release，导致一次 touch sequence 一直不收口。
- 在 `src/app/app_main.cpp` 新增 drag idle watchdog：记录最近一次有效触摸位移时间；当 hero drag 已启动且约 180ms 没再收到新坐标时，固件不再继续等待。
- 恢复策略分两档：
  - 拖拽进度已达到 35 以上，直接提交 local hero hide，再执行触摸控制器复位。
  - 拖拽进度不足 35，回弹 hero 到原位，再执行触摸控制器复位。
- 这样即使用户只拖到 `drag 46%` 就遇到控制器失联，也不会把整个屏幕锁进一条永远不结束的按下状态里。
- 验证：
  - ESP-IDF build 成功，生成 `build/peekdock.bin`
  - 首次 flash 失败，定位为 LaunchAgent bridge 占用同一串口导致 `Uploading stub... Failed to write to target RAM (Checksum error)`
  - 临时停掉 `com.peekdock.bridge` 后重新 flash 成功，随后已重新 bootstrap bridge 恢复实时联动

## 2026-05-31 JiMeng Live Polling Stabilization

- 继续排查“即梦状态不实时”后确认，主判定逻辑本身没坏；真正脆弱的是后台轮询和调试探针共用同一份超长 Chrome 注入脚本，周期执行时更容易触发 `osascript` / `execute javascript` 失败。
- 已把 `runtime-bridge/server.mjs` 的 JiMeng snapshot 拆成两套：
  - 轮询路径使用 `jimengPollingSnapshotScript()`，只返回实时判定必需字段，例如 `href`、短 `bodyText`、有限按钮/标题、`generatedImageCount` 和轻量 `apiSubject`。
  - `/api/jimeng-probe` 保留 `jimengProbeSnapshotScript()`，继续返回完整调试信息，方便深挖页面结构和接口回包。
- `runJimengSnapshot()` 现在按 `mode=poll|probe` 分开执行，并给轮询使用更短超时；同时在 `pollJimengChrome()` 里把 `stderr` 也写进日志，方便区分 AppleScript 失败和页面注入失败。
- 验证：`node --check runtime-bridge/server.mjs` 通过；本地 `4191` 上现存进程仍是旧 bridge，因此还需要重启真实 runtime-bridge，新的轻量轮询修复才会实际生效。

## 2026-05-31 JiMeng Focus Stealing Fix

- 继续联调时发现，即梦在后台轮询每次刷状态时都会尝试续命当前焦点，导致用户手动切到 `codex` / `claude` 后，当前页又被 `jimeng` 抢回。
- 已收紧 `syncRealJimengTask()` 的焦点条件：现在只在真正需要首次聚焦时才 `setCurrentAgent("jimeng")`，不再因为“当前曾经是即梦”而在后续轮询里反复抢占。
- 验证：重启 `4191` 上的真实 runtime-bridge 后，先让即梦保持 completed，再手动 `POST /api/switch-agent` 切到 `codex`；随后多个即梦轮询周期继续刷新任务缓存，但日志中的 `current` 保持为 `codex`，未再被即梦抢回。

## 2026-05-31 JiMeng Idle Flap Fix

- 继续看 live log 后确认，即梦的“状态不对 + 时机不对”并不是单一判定错误，而是三层问题叠加：
  - 轮询里同状态会被重复发送，导致小屏被无意义刷新。
  - 即梦沿用了 Codex/Claude 的随机 running 进度推进，不适合当前三态模型。
  - 更关键的是，即梦不该走 `completed -> 5 秒后自动 idle` 的 bridge 定时器；它本来就有真实浏览器页面状态，这个定时器会和轮询互相打架，制造假 `idle`。
- 已做的修复：
  - 为即梦增加手动切页锁，用户切到其他 agent 后，90 秒内禁止即梦自动抢焦点。
  - 即梦 running 进度改为稳定值，不再每轮随机前进。
  - 相同的即梦状态/标题/结果页不再反复发送 `task_update`。
  - 即梦完成后不再由 bridge 自动回 idle，只由真实页面状态驱动 `idle/running/completed`。
  - 轮询选页时优先匹配 `jimeng` 的 `/ai-tool/generate` 标签页，再退回其他即梦页，减少首页和生成页混读。
- 实机验证：重启 `4191` 上真实 runtime-bridge 后，live log 中之前每 1-2 个轮询就出现一次的 `completed -> idle -> completed` 抖动已消失；7 秒观察窗口内只出现一次即梦 `completed` 更新。

## 2026-05-31 Single Runtime Bridge Recovery

- 用户指出“应该只有一个 bridge 管三个 agent”后，重新核对本机运行态，确认问题确实被我前面的临时调试副本放大了：正式 LaunchAgent bridge 监听 `127.0.0.1:4173`，同时还残留了一个手动拉起的 `127.0.0.1:4191` debug bridge。
- 已清理掉 `4191` 临时 bridge，只保留 LaunchAgent 管理的 `runtime-bridge/server.mjs` 在 `4173` 统一服务 Codex、Claude、JiMeng 三个 agent。
- 同时修正了即梦 parser 的优先级错误：当生成页正文里同时存在旧结果和新一轮进行中的文本时，bridge 现在优先识别 `"(0/1) 图片生成中"`、`"85%造梦中"` 这类当前生成信号，不再被旧的 completed 结果图区误判。
- 验证：`lsof -Pan -iTCP:4173,4191 -sTCP:LISTEN` 现只剩 `4173`；`/api/state` 的真实主链也回到 `4173`。当前 live 页面再次落回 completed，因此新的“running 优先”规则还需要下一次即梦真实生成时继续盯一次正式链路。

## 2026-05-31 JiMeng Completion Lifecycle Alignment

- 按产品要求把即梦的完成态生命周期重新对齐到 Codex / Claude：即梦现在也重新走 `running -> completed -> hold -> idle` 的统一 helper 逻辑，而不是永久停留在 completed。
- 实现上直接复用了现有的 `scheduleIdleAfterCompletion()`，没有为即梦引入单独的对外状态机；唯一额外补的是最小防抖：如果即梦因为 hold 定时器回到了 idle，而浏览器仍停留在同一张旧 completed 页面上，bridge 会忽略这一次旧 completed 回弹，避免刚回 idle 又被同页立刻打回 completed。
- 同时保持之前已经修好的即梦启动规则：`认真思考中/正在思考` 会先进入 `running`，并且从上一轮 completed 重启时会重置为低进度起步，不再继承 100% 尾巴。

## 2026-05-31 Runtime-Bridge Cleanup And UI Lift

- 重新按当前主链路清理了误导项：README 和架构记录现在以 `runtime-bridge/server.mjs + ESP32 小屏 + helper` 作为唯一主线，不再把旧 `mac-demo` 页面路径写成当前入口。
- `runtime-bridge/server.mjs` 去掉了对已不存在 `mac-demo/public` 的静态资源兜底引用，避免 helper 继续暗示旧网页 demo 仍是运行依赖。
- JiMeng 实时同步现在在状态从 `idle` 进入非空任务时会主动 focus 到 `jimeng`，所以 helper 的 `currentAgent`、小屏当前页和任务缓存会一起切到即梦。
- 小屏 UI 做了一轮整体上移：hero、小标题、工具 chip、进度条、百分比、accept 按钮和 idle panel 都整体抬高了一点，保持交互状态机不变，只修正视觉重心。
- 验证：`/api/state` 在当前 JiMeng 完成页上返回 `currentAgent = "jimeng"`、`agentLocation = "dock"`、`currentTask.status = "completed"`。

## 2026-05-31 ESP32 Life Motion Pass

- Added restrained LVGL motion polish for the 172 x 320 dock screen: hero breathing by state, completed bounce, organic status-dot glow, page-dot wave opacity, agent switch scale/fade entry, and label fade transitions for main status copy.
- Improved the running progress rail with a white head shimmer when the pulse advances and a small head bounce at 25% / 50% / 75% milestones; the running indicator also breathes subtly between deeper and lighter agent tones.
- Added `peekdock_screen_touch_feedback()` and wired it from `touch_poll_task` for long press / double tap feedback without changing the serial protocol or adding new timers.
- Kept the existing frame animation under control by running the life timer faster while only alternating sprite frames every fourth tick.
- Follow-up rollback: removed page-dot breathing and removed whole-layer opacity/scale transitions from `content_layer` because they looked like a dark overlay during swipes. Agent switching now keeps only a light horizontal slide plus hero-level motion; touch feedback pulses the hero instead of the whole screen layer.
- Verification: ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 JiMeng API-First Probe

- 把 `runtime-bridge/server.mjs` 的 JiMeng probe 从纯 DOM 文本快照升级为 API-first：Chrome 注入脚本现在会优先恢复页面真实调用过的 `dreamina_subject/get` URL，并在同页上下文内同步 `POST` `{cursor, limit, keyword, subjectIdList, onlyFavorite}` 请求。
- 新 probe 会把 `ret`、`errmsg`、`itemCount` 和前几个任务摘要一并带回 bridge，服务端优先用这些 API 字段映射 `running` / `completed` / `failed` / `needs_input`，只有 API 无结果时才回退到旧的页面文案启发式。
- 实机验证结果：当前 Chrome JiMeng 标签页 `https://jimeng.jianying.com/ai-tool/generate` 的内部接口返回 `ret=1015, errmsg=login error`，所以 `/api/jimeng-probe` 现已稳定输出 `needs_input` 与 `login required`，证明之前的瓶颈主要是登录态缺失，而不是 bridge 完全读不到真实接口。
- 验证：`node --check runtime-bridge/server.mjs` 通过；临时 bridge `PORT=4191` 启动后，`curl http://127.0.0.1:4191/api/jimeng-probe` 返回包含 `apiSubject` 的实时 JSON，且 `parsed.status` 为 `needs_input`。

## 2026-05-31 JiMeng Three-State Bridge And P2 Assets

- 按产品要求把 JiMeng 对外状态收敛成三态：`idle`、`running`、`completed`。bridge 不再对外发 JiMeng 的 `needs_input` / `failed`，登录提示、追问补充信息、失败文案等中间页面都统一映射到 `running`，首页保持 `idle`，明确完成态映射到 `completed`。
- 修复了 JiMeng 轮询的稳定性问题：snapshot 执行从 shell 拼接的 `exec("osascript ...")` 改成 `execFile("osascript", ["-e", ...])`，避免长注入脚本在后台定时轮询里偶发失败。
- 把用户新增的 `assets/raw/jimeng_idle_01.png`、`jimeng_idle_02.png`、`jimeng_running_01.png`、`jimeng_running_02.png` 按 completed 同规格处理成 `108x108` 的 `assets/processed/p2_jimeng/*.png`，并生成对应的 `assets/lvgl/jimeng_idle_p2*.c`、`jimeng_running_p2*.c`。
- ESP32 工程已接入这些即梦新资源：`src/CMakeLists.txt` 新增四个 LVGL 源文件，`src/ui/screens/peekdock_screen.cpp` 现在能按 JiMeng 的 `idle` / `running` / `completed` 三态切换 hero 图。
- 验证：`node --check runtime-bridge/server.mjs` 通过；新生成的 JiMeng idle/running P2 PNG 全部为 `108x108`；`curl http://127.0.0.1:4191/api/jimeng-probe` 在当前 JiMeng 追问补充信息页面上返回 `parsed.status = "running"`。

## 2026-05-31 JiMeng Completed Detection Fix

- 继续排查后确认，JiMeng 某些完成页不会暴露明显的“下载/查看结果”按钮，正文里还会混着旧的追问文本，导致旧规则被误判成 `running`。
- 已在 snapshot 中增加 `generatedImageCount`，专门统计当前页面里来自 `dreamina-sign` 结果域且尺寸足够大的生成图。
- 新完成规则优先级已上提：当页面位于 `generate`，且出现“结果元信息（如 `时间 / 生成模式 / 操作类型`）+ 真实生成图”或“`已完成` + 真实生成图”时，bridge 直接输出 `completed`。
- 验证：在当前 `https://jimeng.jianying.com/ai-tool/generate?workspace=13786201579020` 页面上，`generatedImageCount = 27`，`/api/jimeng-probe` 现已返回 `parsed.status = "completed"`、`progress = 100`。

## 2026-05-31 Codex Review Gate And Screen Polish

- Tightened Codex review gating: ordinary file/tool reads remain `running`, and a possible approval event only becomes ESP32 `Review` after a macOS Accessibility probe sees the real three-option approval UI marker such as `本次会话不再询问` / `don't ask again`.
- Follow-up fix: explicit tool approvals such as `sandbox_permissions=require_escalated` now enter ESP32 `Review` immediately instead of waiting for Accessibility text, because these approvals are already confirmed by Codex's function-call metadata and may not expose the three-option copy to System Events in time.
- Changed Codex ESP32 review tap behavior so the bridge activates Codex and sends option `2` plus Enter, matching the "yes, and do not ask again this session" path.
- Changed Review-state touch handling so single tap accepts after a short double-tap window, while double tap opens the current agent on Mac; this prevents single-tap accept from swallowing the second tap.
- Hardened Codex option-2 execution: the bridge now first tries to click a matching "do not ask again" approval button through System Events, then falls back to `2` + Enter and logs success/failure.
- Follow-up fix: Codex activation now uses the bundle id `com.openai.codex` via `open -b` instead of AppleScript `tell application "Codex"`, because direct AppleScript application resolution returned `-1728` even though `/Applications/Codex.app` exists.
- Simplified the confirmation title on ESP32 to `Review`, softened the `%` unit opacity/size, enabled Montserrat 16 for a slightly stronger task title, and tightened the gap between the big task label and the small phase text.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 ESP32 Idle Bubble Polish

- Refined the ESP32 idle bubble after the visual review: idle copy is now constrained to two-word phrases, the left yellow mood mark was removed, and the bubble uses a neutral dark surface with subtle gray border/shadow instead of agent-colored edges.
- Kept the idle mood cue passive only: it now appears as a small white/gray right-side symbol such as `<3` or `..`, with no click-to-expand behavior.
- Tightened percent alignment by positioning the number and `%` as one centered group, reducing the visible gap at `100%`.
- Verification: ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 Confirmation UI And Idle Copy Pass

- Fixed the percent readout optical centering by using stable digit-width positioning, so `9%`, `54%`, and `100%` stay centered above the progress area instead of drifting with LVGL label width.
- Reduced false confirmation flashes by narrowing ESP32 confirmation detection to explicit `needs_input` / confirmation-required states instead of broad `permission` / `approve` text matches.
- Improved confirmation UI: the task title now shows content type such as `Review patch`, `Review command`, or `Review network`; the phase line is shortened to `waiting...`; the CTA is a larger `review` button.
- Added single-tap handling for confirmation pages. The ESP32 now sends `accept_confirmation`; the bridge opens the relevant Mac app and advances the dock status to `resuming`.
- Expanded idle copy to six two-word, cuter persona lines per agent while keeping the neutral non-distracting bubble treatment.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 Codex State Mapping Stabilization

- Changed the ESP32 progress readout to a single centered label such as `54%`, removing the split number/unit layout that could drift to the right on LVGL.
- Tightened Codex intervention mapping: normal `function_call` events now stay `running` and only explicit approval/confirmation/user-input events or parsed escalation fields enter `needs_input`.
- Codex tool outputs no longer force `failed`. They update the small phase line with tool-oriented text such as `tool finished`, `checking output`, or `reviewing output`, while the task remains running until a real final state arrives.
- Added tool-phase labels like `reading files`, `using tool`, and `tool finished` so small text reflects what Codex is doing without hijacking the main status.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 New Task Auto Focus

- Added the product rule that a truly new task should become the active dock page immediately, while ordinary status updates for an existing task should not steal the user's manually selected page.
- Bridge now passes a focus intent for real Codex `user_message`, real Claude new user content, and local test-event endpoints. Existing task phase updates continue to update cache/snapshot without changing `currentAgent`.
- ESP32 firmware now upserts incoming `task_update` events into fixed agent pages by `source` (`codex`, `claude`, `jimeng`) and switches to that page only when the incoming `task_id` is new for that source.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 Runtime Bridge App Launch Fixes

- 修复 `runtime-bridge/server.mjs` 中 Claude 打开失败的问题：`openAgentOnMac` 现在使用 `open -a "Trae CN"`，与本机安装的 `Trae CN.app` 一致。
- 修复 JiMeng 每次都新开标签页的问题：bridge 新增 `PEEKDOCK_BROWSER` 环境变量支持，默认 `chrome`，并通过 AppleScript 在 Chrome/Safari 现有窗口中优先复用 URL 包含 `jimeng` 的标签页，未命中时才新开页面。
- 保留 JiMeng 的 `open` 兜底路径，因此这次只需要重启 bridge，不需要重新烧录固件。
- 验证：`node --check runtime-bridge/server.mjs` 通过；JiMeng 的 Chrome/Safari AppleScript 以 `get URL of t` 形式完成语法收敛，本环境下直接执行会受 GUI/sandbox 限制，未在这一 turn 内完成实际浏览器激活验证。

## 2026-05-31 Runtime Bridge JiMeng Reuse Debug

- 继续排查后确认，JiMeng 出现“Chrome 被唤起后又新开页/窗”的直接原因不是还有第二份打开逻辑，而是 bridge 把整段多行 AppleScript 当成单个 `osascript -e` 参数传入，导致真实浏览器字典解析失败，随后触发了 `open <jimengUrl>` 兜底。
- 已将 JiMeng 脚本改为逐行 `-e` 参数执行，并保留同一脚本内的“先查已有标签页，找不到再 `open location`”流程；因此命中已有 JiMeng 标签页时不会再额外触发一次 shell `open`。
- 验证：在沙箱外直接对真实 Chrome/Safari 运行逐行 `osascript -e ...` 脚本，两个浏览器分支都返回 `true`，说明已有 JiMeng 标签页时复用逻辑可以成立。

## 2026-05-31 JiMeng Chrome Monitor

- 在 `runtime-bridge/server.mjs` 中新增 JiMeng 实时状态接入骨架：`createRealJimengTask`、`ensureRealJimengTask`、`syncRealJimengTask`、`startJimengMonitor`、`pollJimengChrome` 和 `/api/jimeng-test-event`、`/api/jimeng-probe` 调试入口。
- JiMeng monitor 当前限定在 Chrome，依赖用户已开启 Chrome 的 `允许 Apple 事件中的 JavaScript`。bridge 会查找 URL 包含 `jimeng` 的标签页，并执行页面 JavaScript 快照，抓取 `title`、`href`、正文文本、按钮文本、标题和输入框内容。
- 新增第一版启发式状态映射：登录/授权文案 -> `needs_input`，失败类文案 -> `failed`，生成中/排队中类文案 -> `running`，下载/保存/查看结果且不在首页 -> `completed`，JiMeng 首页 -> `idle`。
- 验证：真实 Chrome 标签页 JavaScript 快照可以稳定返回 JSON；当前首页 `https://jimeng.jianying.com/ai-tool/home` 的 live snapshot 已成功抓取，包含标题 `即梦AI - 一站式AI创作平台`、正文文案、按钮文案和 headings。用沙箱外 headless bridge 自检时，JiMeng monitor 已不再输出 AppleScript 语法错误。

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

## 2026-05-31 ESP32 Dock UI Refinement

- Refined the ESP32 LVGL dock UI to remove raw touch debug copy from the visible screen.
- Reworked the 172 x 320 layout so all text, progress, and page dots stay inside the physical viewport; this also removes the unwanted right-side LVGL scrollbar.
- Moved the progress bar below the percent/status row so it no longer competes with or overlaps the primary progress readout.
- Added a third placeholder JiMeng agent page on the firmware side. It is visual-only for now and does not require a real JiMeng status adapter.
- Added local swipe feedback on the firmware: left/right swipes update the selected page immediately with a short slide/fade transition before the bridge sync catches up.
- Updated the visual treatment toward a quieter premium dock style: warmer dark background, softer neutral text colors, smaller bottom dots, and a clearer hierarchy between agent name, percent, status, task type, title, and hint.
- Verification: ESP-IDF/Ninja build passes using the repo-local toolchain; firmware flashed successfully to `/dev/cu.usbmodem1301`; launchd helper restarted; `POST /api/send-task` returned `serialConnected=true`.

## 2026-05-31 ESP32 Reference UI Pass

- Reworked the ESP32 LVGL screen toward the supplied reference: top-left uppercase agent label, top-right glow status dot, centered character art, compact task summary, pill-shaped tool chip, thin progress rail, larger percent readout, and low-contrast page dots.
- Enabled `LV_FONT_MONTSERRAT_28` so the progress percent can carry visual weight instead of looking like debug text.
- Added firmware-side text compaction/truncation so long raw prompts never wrap over the small 172 x 320 layout; non-ASCII prompt titles fall back to a short English label unless a CJK font is enabled later.
- Kept the third `JIMENG` page available as a local placeholder even when the Mac helper only has live Codex/Claude tasks.
- Added smoother low-cost motion: page slide/fade for swipes, hero fade/scale on state changes, and animated progress/percent transitions.
- Extended the Mac helper with a JiMeng agent slot, heuristic task-title summarization before serial sync, and a completion sound using macOS built-in `Glass.aiff` with an `osascript beep` fallback.
- Verification: ESP-IDF/Ninja build passes after LVGL reconfiguration; firmware flashed successfully to `/dev/cu.usbmodem1301`; `node --check mac-demo/server.mjs` passes; launchd helper restarted; a long Chinese `/api/send-task` prompt was summarized to `Refining UI` and returned `serialConnected=true`; `/api/codex-test-event` completed successfully to exercise the completion path.

## 2026-05-31 ESP32 UI Color And Gesture Fix

- Fixed the RGB565 byte-order path by enabling LVGL display byte swapping (`display_cfg.flags.swap_bytes = true`) so LVGL colors should no longer render with severe purple/incorrect color casts.
- Mapped the top-right signal dot to task state: gray for idle, green for running/completed, yellow for needs-input, and red for failed; the dot glow now follows the same color.
- Added a small moving pulse over the filled progress segment during running state, giving the progress rail a live feel without expensive effects.
- Shortened tool-chip labels (`shell`, `write`, `image`, `input`, `done`, `error`) and constrained the label width with dot truncation to prevent overflow.
- Made horizontal swipes more reliable by moving gesture ownership to the manual touch polling task, lowering the horizontal threshold, triggering once during drag instead of waiting only for release, and removing the redundant LVGL touch callback path.
- Verification: ESP-IDF/Ninja build passes; firmware flashed successfully to `/dev/cu.usbmodem1301`; launchd helper restarted; running and completed Codex test events returned `serialConnected=true`.

## 2026-05-31 Real Status Display Refinement

- Tightened `runtime-bridge/server.mjs` real Codex/Claude state mapping so phase text now uses short user-readable stages such as `analyzing`, `editing`, `applying changes`, `running checks`, `reviewing`, `finalizing`, `reconnecting`, and `waiting for confirmation`.
- Removed the unsafe quiet-period auto-complete path for real Codex/Claude tasks. `completed` now only comes from explicit completion events or test endpoints, then still returns to `idle` after the existing 5-second completed hold.
- Replaced jumpy real-task progress updates with stage-bounded fake progress. Non-completed states are capped below 100, while `completed` alone reaches 100.
- Updated the ESP32 LVGL task card so the small phase line displays `status_text`; confirmation-like states hide the progress bar/percent and show an accent-colored `accept` button.
- Added low-cost life cues on the ESP32 screen: breathing running status dot, one-shot completed particle burst, and an occasional idle mood bubble.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`; local bridge smoke tests confirmed `needs_input -> waiting for confirmation`, `using tools -> editing`, and explicit `completed -> 100`.

## 2026-05-31 Idle And Progress Motion Pass

- Changed ESP32 page dots to neutral white only, removing agent-colored bottom dots for the current visual pass.
- Replaced idle-state `0%` progress display with a compact idle mood panel. Codex now shows engineer-flavored idle copy such as `linting dreams`, `standing by with coffee`, and `ready to patch things`; Claude and JiMeng have their own short idle copy.
- Added a lightweight typewriter effect for the running phase text, updating the small status line every 60ms until the current `status_text` is fully shown.
- Added progress-rail charging details: the moving pulse head emits a brief white flash as it travels, and the progress bar bounces at 25%, 50%, and 75% milestones.
- Verification: ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 Status And Idle UX Bugfix Pass

- Tightened Codex completion mapping: `final_answer` now stays in `finalizing`, and only explicit `task_complete` moves the real Codex task to `completed`, reducing mid-task false completion.
- Changed real-task completed-to-idle bridge text from `ready for next task` to `idle`; ESP32 idle rendering also suppresses the small phase line so stale idle copy does not leak into the UI.
- Removed the progress bar white-flash object because the visual felt noisy; kept the simpler moving pulse and milestone bounce.
- Refined idle UI toward the provided HTML reference: small speech-bubble panel with a tail, short persona copy, and subtle hero breathing without moving the character layout.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 Codex Review Guard Fix

- Compared the Codex rollout handling with `clawd-on-desk` and adopted the same conservative shape for permission display: possible approval events now schedule a short probe instead of immediately forcing `needs_input`.
- Follow-up correction: macOS Accessibility can miss Codex's live approval UI, so explicit `exec_command` / `shell_command` approvals with `sandbox_permissions=require_escalated` or a non-empty `justification` once again show ESP32 `Review` immediately. Ambiguous non-command confirmation events still require the UI probe.
- Made the ESP32 Review action logging clearer and switched the keyboard fallback from text `keystroke "2"` to physical key code `19` followed by Enter, after first trying to click the accessible "don't ask again" button.
- Found the remaining Review-click sync blocker: macOS returned `-25211` because `osascript` / System Events is not allowed Accessibility control. The bridge now treats that as a real failure, opens Codex, and keeps the dock task in `needs_input` with `open Codex` instead of falsely moving to `resuming`.
- Follow-up hardware fix: Review-state taps on ESP32 no longer wait for the double-tap window or emit `open_agent`; any tap while confirmation is visible immediately sends `accept_confirmation`. The bridge now trims serial action/source strings and logs `Dock confirmation requested` plus `Dock confirmation handling` before running the option-2 script.
- Follow-up bridge debug fix: headless mode now also listens on `127.0.0.1:4173` and prints startup build marker `review-debug-20260531-2030`, so local debug routes can verify the same Review-accept path while the serial bridge stays active.
- Verification: `node --check runtime-bridge/server.mjs` passes; ESP-IDF build passes; firmware flashed successfully to `/dev/cu.usbmodem1301`; launchd bridge was restarted with `runtime-bridge/server.mjs`; `lsof` confirms `node` is listening on `127.0.0.1:4173`.

## 2026-05-31 Bridge Visibility And Serial Debug Pass

- Added a Codex Review hold window so explicit permission prompts are not immediately overwritten by following tool-output events.
- Added compact serial send logging in `runtime-bridge/server.mjs` so each ESP32 write now reports connection state, event type, source, status text, and progress.
- Added exact duplicate serial-payload suppression, with a longer window for repeated `task_snapshot` messages to reduce monitor-driven snapshot spam on the ESP32.
- Verification: `node --check runtime-bridge/server.mjs` passes; launchd bridge restarted; `/api/state` shows live Codex `running` state; `POST /api/codex-test-event` sends a visible `task_update` and logs `Serial send: connected=true`.

## 2026-05-31 Local Hero Drag Hide Interaction

- Added a local-only ESP32 hero drag interaction: upward drag shrinks, fades, and translates the current agent image toward the top edge; release past threshold hides the image; downward drag restores it from the top with a small LVGL scale/opacity/translate animation.
- Kept the existing Mac handoff path intact. The new gesture does not send `return_to_mac`; it only changes the local hero image visibility.
- New task/state changes and page switches automatically restore the hidden hero so status updates never leave the character missing unexpectedly.
- Verification: ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-05-31 Hero Drag Smoothness And Micro-motion Pass

- Fixed drag jank by removing per-frame `lv_anim_delete()` calls during hero drag preview and throttling tiny progress deltas before taking the LVGL lock.
- Added an agent-colored semi-transparent title pill for Codex, Claude, and JiMeng.
- Tuned status-dot animation rhythms by state: idle slow glow, running pulse/spread, needs-input faster attention pulse, completed fade-out glow, and failed rapid strobe.
- Added per-agent hero motion while visible: Codex nods lightly, Claude sways horizontally, and JiMeng floats vertically.
- Made the idle panel breathe subtly with the hero and moved the mood cue into a small top-right bubble using default-font-safe symbols.
- Verification: ESP-IDF/Ninja build passes and regenerated `build/peekdock.bin`.

## 2026-06-01 Hero Drag Freeze Fix

- Moved local hero drag preview off the touch task's direct LVGL lock path. Touch polling now only queues drag/hide/restore intent; `peekdock_screen.cpp` consumes it on a 24ms LVGL timer and owns all hero transform updates.
- Kept the existing local-only behavior: upward drag shrinks/fades/translates the hero toward the top edge, release past threshold hides it, and downward drag restores it.
- Disabled the separate top-right mood bubble completely so it cannot intercept/visually clutter touch interactions; the lower idle panel remains.
- Verification: ESP-IDF/Ninja build passes; firmware flashed successfully to `/dev/cu.usbmodem1301` at `115200`; launchd bridge restarted.

## 2026-06-01 Touch Monitor And Swipe Watchdog

- Added a tiny on-screen touch monitor plus concise `peekdock: touch ...` serial logs to see whether taps/swipes reach `touch_poll_task`.
- Added a hero-drag watchdog in `app_main.cpp`: a strong upward drag now commits hide and clears the touch sequence without waiting forever for the touch controller's release event.
- Reduced runtime log noise after `app_main()` starts by lowering global logs to warning while keeping `peekdock` info logs, so touch traces are readable in ESP-IDF monitor.
- Verification: ESP-IDF/Ninja build passes; firmware flashed successfully to `/dev/cu.usbmodem1301` at `115200`; ESP-IDF monitor starts and shows clean boot logs; launchd bridge restarted after monitor exit.

## 2026-06-01 Touch Fallback Zones

- Found that the AXS5106 touch path can report `up dx=0` for intended swipes, so continuous coordinate deltas are not reliable enough as the only interaction path.
- Added deterministic fallback zones in `app_main.cpp`: tap left/right edges to switch agents, tap the top zone to hide the hero, and tap the bottom zone to restore the hero.
- Hardened the AXS5106 driver by clearing cached touch points when the controller reports zero touches, preventing stale point state after no-touch reads.
- Verification: ESP-IDF/Ninja build passes; firmware flashed successfully to `/dev/cu.usbmodem1301` at `115200`; launchd bridge restarted.

## 2026-06-01 Touch Controller Reset After Hide

- Added a TP_RST hardware reset path after upward hero hide and stale-touch watchdog expiry, because software-only state clearing still allowed the controller to behave like one touch was stuck active.
- Added a 300ms input ignore window after touch reset so residual touch samples do not immediately start a new stuck sequence.
- Verification: ESP-IDF/Ninja build passes; firmware flashed successfully to `/dev/cu.usbmodem1301` at `115200`; launchd bridge restarted.

## 2026-06-01 Page-local Hero Hide Follow-up

- Reworked the local hero-hide gesture so it commits on release instead of halfway through the upward drag. This removes the previous mid-drag hide/reset path that could leave the touch controller or gesture state machine stuck.
- Made hero hidden state page-local on the LVGL side, so each fixed agent page remembers its own hidden/visible state and horizontal page switching remains available after one page's hero is hidden.
- Narrowed restore behavior to the current hidden page only: a downward drag from the bottom area restores the hero only when that page itself is hidden.
- Removed the plain upward-swipe `return_to_mac` action from `app_main.cpp`; upward swipe is now a local visual hide only, matching the current product decision.
- Verification: ESP-IDF/Ninja build passes; firmware flashed successfully to `/dev/cu.usbmodem1301` at `115200`; LaunchAgent bridge bootstrapped after flashing.

## 2026-06-01 Touch State Machine Refactor

- Replaced the ad hoc touch gesture logic in `src/app/app_main.cpp` with a simpler lock-and-release state machine.
- Touch down now only records starting position and timestamp; no confirmation or other action fires on touch down anymore.
- Move phase now locks direction using explicit thresholds: horizontal when `abs(dx) > 28` and dominates `dy`, vertical when `abs(dy) > 24` and dominates `dx`.
- Horizontal swipe now fires only once per touch sequence and no longer gets stolen by vertical hero logic.
- Hero hide now previews only while the hero is visible, commits only on release past threshold, and otherwise restores drag progress back to zero.
- Hidden-hero restore is constrained to touches that start near the bottom, and tap/double-tap handling is evaluated only on small releases.
- Double tap is now checked before center-zone edge tap fallbacks, and confirmation accept now happens only on release of a valid tap.
- All `peekdock_screen_*` calls from the touch task now go through helper wrappers that acquire and release `lvgl_port_lock`.
- Verification: `idf.py build` passes after the refactor.

## 2026-06-01 Hero Hidden Non-Modal Gesture Fix

- Reworked `src/app/app_main.cpp` again so `hero_hidden` is only a visual state, not a restore-only touch mode.
- The touch task now uses an explicit gesture enum: `pending`, `horizontal_swipe`, `hero_hide_drag`, `hero_restore_drag`, `tap_candidate`, and `consumed`.
- Horizontal swipe and double tap now stay available whether the hero is visible or hidden.
- Hidden-state downward swipe now restores the hero without requiring a bottom-start touch, while hidden-state upward swipe is explicitly ignored.
- Removed the old tap-time hidden restore path, so hidden hero no longer steals double tap or center tap handling.
- Verification: `idf.py build` passes; only the existing deprecated `esp_lcd_touch_get_coordinates()` warning remains.
