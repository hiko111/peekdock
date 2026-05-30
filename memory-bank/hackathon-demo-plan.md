# PeekDock 黑客松演示计划

## 1. 演示目标

黑客松 demo 不追求完整产品化，而要让观众一眼理解：

- AI 员工平时在 Mac 主屏待命。
- 用户发起任务后，AI 员工跨到外置小屏工作。
- 多个 AI 员工可以在小屏横滑查看状态。
- 完成、失败、需要澄清时，小屏能把用户召回到 Mac 上的对应上下文。

## 2. 推荐 90 秒演示脚本

1. Mac 主屏显示空闲 agent，小屏处于待命或空舱状态。
2. 用户在 Mac 上点击“Start Codex task”。
3. Codex agent 从 Mac 主屏向小屏方向离开。
4. 小屏出现 Codex 工作画面，显示 `Codex running`、任务名和运行时长。
5. 用户横滑小屏，看到即梦 agent 正在生成视觉、Claude agent 正在写文档。
6. Codex 状态变为 `Ready to review`。
7. 用户点击小屏主按钮。
8. Mac 主屏打开模拟交付页面，agent 从小屏方向跳回 Mac，提示任务完成。
9. 再切一个失败或需要介入状态，展示 `Retry` 或 `Need input` 的快操。

演示固定使用三个 agent：

- Codex：主流程，展示跨屏进入、running、ready to review、open_result 召回。
- Claude 网页端：横滑展示文档/思考工作态。
- 即梦：横滑展示图片/视频生成工作态。

## 3. P0 必做

- Mac 端闲置 agent 和离开/召回动画。
- Mac/helper 到 ESP32 的串口消息。
- ESP32 小屏 LVGL 基础画面。
- 三个 agent 的状态画面：Codex、Claude 网页端、即梦。
- 小屏触摸横滑；若不稳定，降级为屏幕边缘点击切换。
- 小屏动作事件回传 Mac/helper。
- 快操打开本地 HTML 或图片。

## 4. 可 Mock 的部分

- AI 工具真实状态采集先 mock。
- Codex、即梦、Claude 的结果页面可以用本地 HTML、图片或假窗口模拟。
- 百分比进度可以只用于演示，但文档中要注明真实工具不一定提供准确百分比。
- 语音转录可以只演示入口，不做完整语音识别。

## 5. 最大开发难点

### 5.1 跨屏通信

Mac 和 ESP32 不是同一个应用，不能把动画当成一条连续 timeline。必须用 helper 维护状态机，通过串口或网络发事件，让两端各自播放对应段落。

### 5.2 小屏 UI 工程

ESP32 小屏不是 Web 前端。PNG UI 稿需要转换成 LVGL 可用资源，并受限于屏幕分辨率、Flash、RAM、PSRAM 和刷新率。

### 5.3 动画资产体积

多 agent、多状态、多帧动画会迅速占用 Flash。黑客松建议每个核心状态先用 2 帧动画，优先展示状态切换而不是高帧率。

### 5.4 快操安全边界

小屏只发动作事件，Mac/helper 执行白名单动作。不要让小屏消息直接拼接 shell 命令或任意打开路径。

## 6. LVGL 资产建议

- 原始 PNG 放入 `assets/raw/`。
- 裁切和压缩后的 PNG 放入 `assets/processed/`。
- LVGL Image Converter 输出放入 `assets/lvgl/`。
- 小屏背景和 agent 帧按目标分辨率导出。
- 每个状态先保留 1-2 帧。
- 使用 LVGL Image Converter 生成 C array，放进固件编译。
- 使用 `lv_image` 展示单帧，使用 `lv_animimg` 播放序列帧。
- 等 demo 稳定后，再考虑 `.bin` 文件和文件系统加载。

## 7. 风险和降级方案

- 如果触摸横滑来不及做，用屏幕左右边缘点击或串口命令模拟横滑。
- 如果 LVGL 接屏失败，先用 Waveshare 官方 demo 的显示驱动做纯色/图片烟测，保留协议和演示逻辑。
- 真实 AI 工具接入不进入黑客松 P0 主路径，使用 mock 任务源跑完整故事。
- 如果 Mac 桌面置顶窗口成本高，用浏览器全屏页面模拟 Mac 主端。
