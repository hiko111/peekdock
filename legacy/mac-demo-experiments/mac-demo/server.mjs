import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const publicDir = join(rootDir, "mac-demo", "public");
const serialPort = process.env.PEEKDOCK_SERIAL_PORT || "/dev/cu.usbmodem1301";
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const headlessMode = process.env.PEEKDOCK_HEADLESS === "1";
const codexSessionsDir = process.env.PEEKDOCK_CODEX_SESSIONS_DIR || join(homedir(), ".codex", "sessions");
const codexMonitorEnabled = process.env.PEEKDOCK_CODEX_MONITOR !== "0";
const claudeProjectsDir = process.env.PEEKDOCK_CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
const claudeMonitorEnabled = process.env.PEEKDOCK_CLAUDE_MONITOR !== "0";
const AGENTS = ["codex", "claude", "jimeng"];
const completionSoundPath = process.env.PEEKDOCK_COMPLETE_SOUND || "/System/Library/Sounds/Glass.aiff";

const clients = new Set();
const state = {
  mode: "clean",
  phase: "idle",
  currentAgent: "codex",
  agentLocation: "mac",
  serialConnected: existsSync(serialPort),
  lastPrompt: "",
  currentTask: null,
  tasksByAgent: {
    codex: null,
    claude: null,
    jimeng: null
  },
  lastEvent: null
};

let serialWriter = null;
let serialReader = null;
let serialReadBuffer = "";
let taskProgressTimer = null;
let taskCompleteTimer = null;
let returnTimer = null;
let codexMonitorTimer = null;
let codexLogPath = "";
let codexLogOffset = 0;
let realCodexTaskId = "";
let realCodexProgress = 8;
let realCodexLastActivity = 0;
let realCodexSettleTimer = null;
let claudeMonitorTimer = null;
let claudeLogPath = "";
let claudeLogOffset = 0;
let realClaudeTaskId = "";
let realClaudeProgress = 8;
let realClaudeLastActivity = 0;
let realClaudeSettleTimer = null;
const completeToIdleTimers = {
  codex: null,
  claude: null,
  jimeng: null
};
const completedSoundTaskIds = new Set();
const codexInitialTailBytes = 64 * 1024;
const codexInitialReplayMs = 10_000;
const codexSettleMs = 45_000;
const completeToIdleMs = 5_000;
const agentMeta = {
  codex: {
    source: "codex",
    agentName: "CodeX",
    taskType: "real codex",
    scene: "coding_room",
    runningKey: "codex_running",
    completedKey: "codex_completed",
    failedKey: "codex_error",
    idleKey: "codex_idle"
  },
  claude: {
    source: "claude",
    agentName: "Claude",
    taskType: "claude code",
    scene: "writing_room",
    runningKey: "claude_running",
    completedKey: "claude_completed",
    failedKey: "claude_error",
    idleKey: "claude_idle"
  },
  jimeng: {
    source: "jimeng",
    agentName: "JIMENG",
    taskType: "image",
    scene: "visual_room",
    runningKey: "jimeng_running",
    completedKey: "jimeng_completed",
    failedKey: "jimeng_error",
    idleKey: "jimeng_idle"
  }
};

function contentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function safeResolve(base, urlPath) {
  const withoutQuery = decodeURIComponent(urlPath.split("?")[0]);
  const target = normalize(join(base, withoutQuery));
  if (!target.startsWith(base)) return null;
  return target;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendSse(client, event) {
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

function publicTask() {
  return toPublicTask(state.currentTask);
}

function toPublicTask(task) {
  if (!task) return null;
  return {
    taskId: task.task_id,
    source: task.source,
    agentName: task.agent_name,
    title: task.title,
    status: task.status,
    statusText: task.status_text,
    progress: task.progress,
    taskType: task.task_type,
    resultUri: task.result_uri || ""
  };
}

function publicState() {
  return {
    mode: state.mode,
    phase: state.phase,
    currentAgent: state.currentAgent,
    agentLocation: state.agentLocation,
    serialConnected: state.serialConnected,
    lastPrompt: state.lastPrompt,
    currentTask: publicTask(),
    tasksByAgent: Object.fromEntries(AGENTS.map((agent) => [agent, toPublicTask(state.tasksByAgent[agent])])),
    lastEventType: state.lastEvent?.type || null
  };
}

function taskForAgent(agent) {
  return state.tasksByAgent[agent] || null;
}

function setTaskForAgent(agent, task) {
  state.tasksByAgent[agent] = task;
  if (state.currentAgent === agent) {
    state.currentTask = task;
    state.phase = task?.status === "idle" ? "idle" : task?.status || "idle";
  }
}

function setCurrentAgent(agent) {
  if (!AGENTS.includes(agent)) return;
  state.currentAgent = agent;
  state.currentTask = taskForAgent(agent);
  state.phase = state.currentTask?.status === "idle" ? "idle" : state.currentTask?.status || "idle";
}

function agentFromSource(source = "") {
  if (source === "claude") return "claude";
  if (source === "jimeng") return "jimeng";
  return "codex";
}

function animationKeyFor(agent, status) {
  const meta = agentMeta[agent] || agentMeta.codex;
  if (status === "completed") return meta.completedKey;
  if (status === "failed" || status === "needs_input") return meta.failedKey;
  if (status === "idle") return meta.idleKey;
  return meta.runningKey;
}

function baseTaskForAgent(agent, title = "") {
  const meta = agentMeta[agent] || agentMeta.codex;
  const taskId = agent === "claude"
    ? (realClaudeTaskId || `claude_real_${Date.now()}`)
    : agent === "jimeng"
      ? `jimeng_local_${Date.now()}`
      : (realCodexTaskId || `codex_real_${Date.now()}`);
  return {
    task_id: taskId,
    source: meta.source,
    agent_name: meta.agentName,
    title: summarizeTitleForDock(title || `${meta.agentName} task`, meta.agentName),
    task_type: meta.taskType,
    status: "running",
    status_text: `watching ${meta.agentName}...`,
    progress: -1,
    updated_at: new Date().toISOString(),
    result_uri: "",
    actions: [],
    screen_role: "dock_working",
    agent_scene: meta.scene,
    animation_key: meta.runningKey
  };
}

function summarizeTitleForDock(input = "", fallback = "Task") {
  const raw = String(input || "").replace(/\s+/g, " ").trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  const hasChinese = /[\u3400-\u9fff]/.test(raw);

  const keywordMap = [
    [/ui|界面|视觉|排版|小屏|figma|css|design|layout|font|动效|动画|transition|motion/, "Refining UI"],
    [/esp32|firmware|烧录|flash|serial|串口|硬件|板子|lvgl/, "Firmware test"],
    [/bug|fix|报错|error|failed|crash|修复/, "Fixing issue"],
    [/review|检查|审查|diff|pr\b/, "Reviewing code"],
    [/build|实现|开发|app|website|page|component|功能/, "Building feature"],
    [/image|picture|photo|即梦|jimeng|生成图|绘图/, "Making image"],
    [/doc|文档|说明|readme|方案|原理/, "Writing notes"],
    [/test|测试|verify|验证/, "Running tests"]
  ];
  for (const [pattern, title] of keywordMap) {
    if (pattern.test(lower)) return title;
  }
  if (hasChinese) return "Task brief";

  const words = raw
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(please|help|can|you|the|and|with|this|that|for|into|about)$/i.test(word))
    .slice(0, 3);
  if (words.length === 0) return fallback;
  const title = words.join(" ");
  return title.length > 24 ? `${title.slice(0, 21)}...` : title;
}

function playCompletionSound(task) {
  const taskId = task?.task_id || "";
  if (!taskId || completedSoundTaskIds.has(taskId)) return;
  completedSoundTaskIds.add(taskId);
  if (completedSoundTaskIds.size > 80) completedSoundTaskIds.delete(completedSoundTaskIds.values().next().value);

  if (existsSync(completionSoundPath)) {
    execFile("afplay", [completionSoundPath], { timeout: 3000 }, () => {});
    return;
  }
  execFile("osascript", ["-e", "beep"], { timeout: 3000 }, () => {});
}

function broadcast(event) {
  state.lastEvent = event;
  for (const client of clients) sendSse(client, event);
}

function emitState() {
  broadcast({ type: "state", state: publicState() });
}

function writeSerial(event) {
  openSerial();

  state.serialConnected = Boolean(serialWriter);
  const line = `${JSON.stringify({ schema_version: 1, ...event })}\n`;
  if (serialWriter) serialWriter.write(line);
  return Boolean(serialWriter);
}

function openSerial() {
  if (!serialWriter && existsSync(serialPort)) {
    try {
      serialWriter = createWriteStream(serialPort, { flags: "a" });
      serialWriter.on("error", () => {
        serialWriter = null;
      });
    } catch {
      serialWriter = null;
    }
  }

  if (!serialReader && existsSync(serialPort)) {
    try {
      serialReader = createReadStream(serialPort, { encoding: "utf8" });
      serialReader.on("data", handleSerialData);
      serialReader.on("error", () => {
        serialReader = null;
      });
      serialReader.on("close", () => {
        serialReader = null;
      });
    } catch {
      serialReader = null;
    }
  }

  state.serialConnected = Boolean(serialWriter || serialReader);
}

function handleSerialData(chunk) {
  serialReadBuffer += chunk;
  let newlineIndex = serialReadBuffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = serialReadBuffer.slice(0, newlineIndex).trim();
    serialReadBuffer = serialReadBuffer.slice(newlineIndex + 1);
    if (line) handleSerialLine(line);
    newlineIndex = serialReadBuffer.indexOf("\n");
  }
}

function handleSerialLine(line) {
  try {
    const event = JSON.parse(line);
    if (event.type === "action_event") {
      if (event.action === "return_to_mac") {
        putAgentOnMac("return");
      } else if (event.action === "switch_agent_prev") {
        cycleCurrentAgent(-1);
      } else if (event.action === "switch_agent_next") {
        cycleCurrentAgent(1);
      }
    }
  } catch {
    // Ignore firmware logs and partial boot output on the same serial port.
  }
}

function dispatchToDock(event) {
  const serialConnected = writeSerial(event);
  state.serialConnected = serialConnected;
  broadcast(event);
  emitState();
  broadcast({ type: "serial_status", connected: serialConnected });
  return serialConnected;
}

function serializedTask(task) {
  if (!task) return null;
  return {
    task_id: task.task_id,
    source: task.source,
    agent_name: task.agent_name,
    title: task.title,
    task_type: task.task_type,
    status: task.status,
    status_text: task.status_text,
    animation_key: task.animation_key,
    result_uri: task.result_uri || "",
    progress: task.progress,
    actions: Array.isArray(task.actions) ? task.actions : [],
    screen_role: task.screen_role || "dock_working",
    agent_scene: task.agent_scene || "workspace"
  };
}

function activeTasksSnapshot() {
  return AGENTS
    .map((agent) => taskForAgent(agent))
    .filter(Boolean)
    .map((task) => serializedTask(task));
}

function syncDockSnapshot() {
  const tasks = activeTasksSnapshot();
  if (tasks.length === 0) return;
  dispatchToDock({
    type: "task_snapshot",
    tasks
  });
}

function createTask(prompt) {
  return {
    task_id: `codex_${Date.now()}`,
    source: "codex",
    agent_name: "CodeX",
    title: summarizeTitleForDock(prompt, "Codex task"),
    task_type: "website build",
    status: "running",
    status_text: "crafting interface...",
    progress: 18,
    updated_at: new Date().toISOString(),
    result_uri: "/demo-results/codex-review.html",
    actions: [],
    screen_role: "dock_working",
    agent_scene: "coding_room",
    animation_key: "codex_running"
  };
}

function createRealCodexTask(title = "Real Codex task") {
  return {
    ...baseTaskForAgent("codex", title),
    task_id: realCodexTaskId || `codex_real_${Date.now()}`,
    status_text: "watching real Codex..."
  };
}

function createRealClaudeTask(title = "Real Claude task") {
  return {
    ...baseTaskForAgent("claude", title),
    task_id: realClaudeTaskId || `claude_real_${Date.now()}`,
    status_text: "watching Claude Code..."
  };
}

function updateTask(patch) {
  if (!state.currentTask) return null;
  state.currentTask = {
    ...state.currentTask,
    ...patch,
    updated_at: new Date().toISOString()
  };
  const agent = agentFromSource(state.currentTask.source);
  state.tasksByAgent[agent] = state.currentTask;
  return state.currentTask;
}

function applyTaskStatus(patch, { sendToDock = true } = {}) {
  if (!state.currentTask) return null;
  const task = updateTask(patch);
  if (!task) return null;
  state.phase = task.status === "completed" ? "completed" : task.status === "idle" ? "idle" : task.status;
  if (sendToDock && state.agentLocation === "dock") {
    dispatchToDock({ type: "task_update", task });
  } else {
    emitState();
  }
  return task;
}

function clearMockTimers() {
  for (const timer of [taskProgressTimer, taskCompleteTimer, returnTimer]) {
    if (timer) clearTimeout(timer);
  }
  taskProgressTimer = null;
  taskCompleteTimer = null;
  returnTimer = null;
}

function clearAgentTimers(agent) {
  const settleTimer = agent === "claude" ? realClaudeSettleTimer : realCodexSettleTimer;
  if (settleTimer) clearTimeout(settleTimer);
  if (agent === "claude") realClaudeSettleTimer = null;
  else realCodexSettleTimer = null;
  if (completeToIdleTimers[agent]) {
    clearTimeout(completeToIdleTimers[agent]);
    completeToIdleTimers[agent] = null;
  }
}

function scheduleIdleAfterCompletion(agent, taskId = taskForAgent(agent)?.task_id || "") {
  if (completeToIdleTimers[agent]) clearTimeout(completeToIdleTimers[agent]);
  completeToIdleTimers[agent] = setTimeout(() => {
    const task = taskForAgent(agent);
    if (!task || task.task_id !== taskId) return;
    if (task.status !== "completed") return;
    const idleTask = {
      ...task,
      status: "idle",
      status_text: "ready for next task",
      progress: -1,
      actions: [],
      animation_key: animationKeyFor(agent, "idle"),
      updated_at: new Date().toISOString()
    };
    setTaskForAgent(agent, idleTask);
    if (state.currentAgent === agent) {
      state.phase = "idle";
      if (state.agentLocation === "dock") {
        dispatchToDock({ type: "task_update", task: idleTask });
        syncDockSnapshot();
      } else {
        emitState();
      }
    } else {
      emitState();
    }
  }, completeToIdleMs);
}

function syncDockIdle() {
  dispatchToDock({
    type: "transition_event",
    event: "agent_idle_on_mac",
    task_id: state.currentTask?.task_id || "",
    source: state.currentAgent
  });
}

function syncDockReturn() {
  dispatchToDock({
    type: "transition_event",
    event: "return_to_mac",
    task_id: state.currentTask?.task_id || "",
    source: state.currentAgent
  });
}

function syncDockTask(task) {
  dispatchToDock({
    type: "transition_event",
    event: "handoff_to_dock",
    task_id: task.task_id,
    source: agentFromSource(task.source)
  });
  dispatchToDock({
    type: "task_update",
    task
  });
}

function cycleCurrentAgent(direction = 1) {
  const visibleAgents = AGENTS.filter((agent) => taskForAgent(agent));
  const pool = visibleAgents.length > 0 ? visibleAgents : AGENTS;
  const currentIndex = Math.max(0, pool.indexOf(state.currentAgent));
  const nextIndex = (currentIndex + direction + pool.length) % pool.length;
  const nextAgent = pool[nextIndex];
  if (!nextAgent) return;
  setCurrentAgent(nextAgent);
  emitState();
  if (state.agentLocation === "dock") {
    syncDockSnapshot();
    if (state.currentTask) {
      dispatchToDock({ type: "task_update", task: state.currentTask });
    } else {
      syncDockIdle();
    }
  }
}

function putAgentOnMac(reason = "return") {
  state.agentLocation = "mac";
  if (reason === "idle") syncDockIdle();
  else syncDockReturn();
  emitState();
}

function putAgentOnDock(task = state.currentTask) {
  if (!task) return;
  state.agentLocation = "dock";
  syncDockTask(task);
  emitState();
}

function sendAgentToDock() {
  if (!state.currentTask) {
    const task = createTask(state.lastPrompt || "Desktop handoff");
    setTaskForAgent("codex", task);
    setCurrentAgent("codex");
    state.phase = "running";
    scheduleTaskTimeline();
  }
  putAgentOnDock(state.currentTask);
}

function setMode(mode) {
  state.mode = mode === "desktop" ? "desktop" : "clean";
  if (!state.currentTask) {
    state.agentLocation = "mac";
    syncDockIdle();
    emitState();
    return;
  }

  if (state.mode === "desktop") {
    putAgentOnMac("return");
  } else if (state.phase === "running") {
    putAgentOnDock();
  } else {
    putAgentOnMac("return");
  }
}

function updateRunningTask(progress, statusText) {
  const task = updateTask({
    progress,
    status: "running",
    status_text: statusText,
    actions: [],
    animation_key: animationKeyFor(agentFromSource(state.currentTask?.source), "running")
  });
  if (!task) return;
  state.phase = "running";
  if (state.agentLocation === "dock") dispatchToDock({ type: "task_update", task });
  else emitState();
}

function completeTask() {
  const agent = agentFromSource(state.currentTask?.source);
  const task = updateTask({
    status: "completed",
    status_text: "ready to review",
    progress: 100,
    actions: ["open_result"],
    animation_key: animationKeyFor(agent, "completed")
  });
  if (!task) return;

  state.phase = "completed";
  if (state.agentLocation === "dock") {
    dispatchToDock({ type: "task_update", task });
  } else {
    emitState();
  }

  emitState();
  playCompletionSound(task);
  scheduleIdleAfterCompletion(agent, task.task_id);
}

function ensureRealCodexTask(title = "Real Codex task") {
  if (!realCodexTaskId) realCodexTaskId = `codex_real_${Date.now()}`;
  const existing = taskForAgent("codex");
  if (!existing || existing.task_id !== realCodexTaskId) {
    setTaskForAgent("codex", createRealCodexTask(title));
  }
  state.lastPrompt = title;
  return taskForAgent("codex");
}

function syncRealCodexTask(status, statusText, options = {}) {
  clearAgentTimers("codex");
  realCodexLastActivity = Date.now();
  const title = options.title || state.currentTask?.title || "Real Codex task";
  const codexTask = taskForAgent("codex");
  if (!realCodexTaskId || !codexTask || codexTask.source !== "codex" || !codexTask.task_id.startsWith("codex_real_")) {
    realCodexTaskId = realCodexTaskId || `codex_real_${Date.now()}`;
    setTaskForAgent("codex", createRealCodexTask(title));
  }
  const task = ensureRealCodexTask(title);
  if (!state.currentTask || state.currentAgent === "codex") {
    setCurrentAgent("codex");
  }
  const previousLocation = state.agentLocation;
  const progress = typeof options.progress === "number" ? options.progress : -1;
  const patch = {
    status,
    status_text: statusText,
    progress,
    actions: status === "completed" ? ["open_result"] : status === "needs_input" ? ["provide_input"] : [],
    animation_key: status === "completed" ? "codex_completed" : status === "failed" ? "codex_error" : "codex_running"
  };

  if (status === "idle") {
    state.agentLocation = "mac";
  } else if (state.mode === "clean") {
    state.agentLocation = "dock";
  }

  Object.assign(task, patch, { updated_at: new Date().toISOString() });
  state.phase = status === "idle" ? "idle" : status;

  if (state.agentLocation === "dock" && status !== "idle") {
    if (previousLocation !== "dock") {
      syncDockTask(task);
      syncDockSnapshot();
    } else {
      dispatchToDock({ type: "task_update", task });
      syncDockSnapshot();
    }
  } else if (status === "idle") {
    syncDockIdle();
    emitState();
  } else {
    emitState();
  }

  if (status === "completed") {
    playCompletionSound(task);
    scheduleIdleAfterCompletion("codex", task.task_id);
  }

  if (status === "running" || status === "needs_input") {
    const taskId = task.task_id;
    realCodexSettleTimer = setTimeout(() => {
      if (state.currentTask?.task_id === taskId && Date.now() - realCodexLastActivity >= codexSettleMs) {
        syncRealCodexTask("completed", "ready to review", { progress: 100, title: state.currentTask.title });
      }
    }, codexSettleMs + 250);
  }
}

function ensureRealClaudeTask(title = "Real Claude task") {
  if (!realClaudeTaskId) realClaudeTaskId = `claude_real_${Date.now()}`;
  const existing = taskForAgent("claude");
  if (!existing || existing.task_id !== realClaudeTaskId) {
    setTaskForAgent("claude", createRealClaudeTask(title));
  }
  state.lastPrompt = title;
  return taskForAgent("claude");
}

function syncRealClaudeTask(status, statusText, options = {}) {
  clearAgentTimers("claude");
  realClaudeLastActivity = Date.now();
  const title = options.title || taskForAgent("claude")?.title || "Real Claude task";
  const claudeTask = taskForAgent("claude");
  if (!realClaudeTaskId || !claudeTask || claudeTask.source !== "claude" || !claudeTask.task_id.startsWith("claude_real_")) {
    realClaudeTaskId = realClaudeTaskId || `claude_real_${Date.now()}`;
    setTaskForAgent("claude", createRealClaudeTask(title));
  }

  if (!state.currentTask || state.currentAgent === "claude") {
    setCurrentAgent("claude");
  }

  const task = ensureRealClaudeTask(title);
  const previousLocation = state.agentLocation;
  const progress = typeof options.progress === "number" ? options.progress : -1;
  const patch = {
    status,
    status_text: statusText,
    progress,
    actions: status === "completed" ? ["open_result"] : status === "needs_input" ? ["provide_input"] : [],
    animation_key: animationKeyFor("claude", status)
  };

  if (status === "idle") {
    if (state.currentAgent === "claude") state.agentLocation = "mac";
  } else if (state.mode === "clean") {
    state.agentLocation = "dock";
  }

  Object.assign(task, patch, { updated_at: new Date().toISOString() });
  setTaskForAgent("claude", task);

  if (state.currentAgent === "claude") {
    state.phase = status === "idle" ? "idle" : status;
  }

  if (state.agentLocation === "dock" && status !== "idle" && state.currentAgent === "claude") {
    if (previousLocation !== "dock") {
      syncDockTask(task);
      syncDockSnapshot();
    } else {
      dispatchToDock({ type: "task_update", task });
      syncDockSnapshot();
    }
  } else if (status === "idle" && state.currentAgent === "claude") {
    syncDockIdle();
    emitState();
  } else {
    emitState();
    if (state.agentLocation === "dock") {
      syncDockSnapshot();
    }
  }

  if (status === "completed") {
    playCompletionSound(task);
    scheduleIdleAfterCompletion("claude", task.task_id);
  }

  if (status === "running" || status === "needs_input") {
    const taskId = task.task_id;
    realClaudeSettleTimer = setTimeout(() => {
      const currentClaudeTask = taskForAgent("claude");
      if (currentClaudeTask?.task_id === taskId && Date.now() - realClaudeLastActivity >= codexSettleMs) {
        syncRealClaudeTask("completed", "ready to review", { progress: 100, title: currentClaudeTask.title });
      }
    }, codexSettleMs + 250);
  }
}

function textFromPayload(payload) {
  if (!payload) return "";
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.arguments === "string") return payload.arguments;
  if (Array.isArray(payload.content)) {
    return payload.content.map((item) => item?.text || "").filter(Boolean).join("\n");
  }
  return "";
}

function userTitleFromPayload(payload) {
  const text = textFromPayload(payload).replace(/\s+/g, " ").trim();
  return text ? summarizeTitleForDock(text, "Codex task") : "Codex task";
}

function claudeTitleFromContent(content) {
  if (typeof content === "string") {
    const normalized = content.replace(/\s+/g, " ").trim();
    return normalized ? summarizeTitleForDock(normalized, "Claude task") : "Claude task";
  }
  if (!Array.isArray(content)) return "Claude Code task";
  const text = content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? summarizeTitleForDock(text, "Claude task") : "Claude task";
}

function outputLooksFailed(text) {
  return /Process exited with code [1-9]|Exit code: [1-9]|Traceback \(most recent call last\)|Unhandled exception/i.test(text || "");
}

function claudeOutputLooksFailed(result = {}) {
  return Boolean(
    result.is_error ||
    result.interrupted ||
    (typeof result.stderr === "string" && result.stderr.trim()) ||
    outputLooksFailed(result.stdout || "") ||
    outputLooksFailed(result.stderr || "")
  );
}

function handleCodexRolloutEvent(event) {
  const payload = event.payload || {};
  const payloadType = payload.type || "";

  if (event.type === "event_msg" && payloadType === "user_message") {
    console.log("Codex monitor event: user_message -> running");
    realCodexTaskId = `codex_real_${Date.now()}`;
    realCodexProgress = 12;
    syncRealCodexTask("running", "thinking through request...", {
      title: userTitleFromPayload(payload),
      progress: realCodexProgress
    });
    return;
  }

  if (event.type === "event_msg" && payloadType === "task_started") {
    console.log("Codex monitor event: task_started -> running");
    realCodexProgress = Math.max(realCodexProgress, 18);
    syncRealCodexTask("running", "starting Codex turn...", { progress: realCodexProgress });
    return;
  }

  if (event.type === "response_item" && payloadType === "function_call") {
    realCodexProgress = Math.min(88, realCodexProgress + 9);
    const toolName = payload.name ? `using ${payload.name}...` : "working with tools...";
    const args = textFromPayload(payload);
    const needsPermission = /require_escalated|sandbox_permissions/i.test(args);
    console.log(`Codex monitor event: function_call -> ${needsPermission ? "needs_input" : "running"}`);
    syncRealCodexTask(needsPermission ? "needs_input" : "running", needsPermission ? "needs permission..." : toolName, {
      progress: needsPermission ? -1 : realCodexProgress
    });
    return;
  }

  if (event.type === "response_item" && payloadType === "custom_tool_call") {
    console.log("Codex monitor event: custom_tool_call -> running");
    realCodexProgress = Math.min(88, realCodexProgress + 7);
    syncRealCodexTask("running", payload.name ? `using ${payload.name}...` : "editing files...", { progress: realCodexProgress });
    return;
  }

  if (event.type === "response_item" && (payloadType === "function_call_output" || payloadType === "custom_tool_call_output")) {
    const output = textFromPayload(payload);
    if (outputLooksFailed(output)) {
      console.log("Codex monitor event: tool output -> failed");
      syncRealCodexTask("failed", "Codex hit an error", { progress: -1 });
    } else {
      console.log("Codex monitor event: tool output -> running");
      realCodexProgress = Math.min(92, realCodexProgress + 5);
      syncRealCodexTask("running", "tool finished, continuing...", { progress: realCodexProgress });
    }
    return;
  }

  if (event.type === "event_msg" && payloadType === "agent_message") {
    const phase = payload.phase || "";
    if (phase === "final_answer") {
      console.log("Codex monitor event: final_answer -> completed");
      syncRealCodexTask("completed", "ready to review", { progress: 100 });
    }
    return;
  }

  if (event.type === "event_msg" && payloadType === "task_complete") {
    console.log("Codex monitor event: task_complete -> completed");
    syncRealCodexTask("completed", "ready to review", { progress: 100 });
    return;
  }

  if (event.type === "event_msg" && (payloadType === "turn_aborted" || payloadType === "thread_rolled_back")) {
    console.log(`Codex monitor event: ${payloadType} -> failed`);
    syncRealCodexTask("failed", "Codex turn interrupted", { progress: -1 });
  }
}

function listRolloutFiles(dir, depth = 0) {
  if (depth > 5 || !existsSync(dir)) return [];
  let files = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(listRolloutFiles(fullPath, depth + 1));
    } else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function latestRolloutFile() {
  const files = listRolloutFiles(codexSessionsDir);
  let latest = "";
  let latestMtime = 0;
  for (const file of files) {
    try {
      const { mtimeMs } = statSync(file);
      if (mtimeMs > latestMtime) {
        latestMtime = mtimeMs;
        latest = file;
      }
    } catch {
      // Ignore files that disappear while Codex rotates sessions.
    }
  }
  return latest;
}

function processCodexLogChunk(chunk, { sinceMs = 0 } = {}) {
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (sinceMs > 0) {
        const eventTime = Date.parse(event.timestamp || "");
        if (!Number.isFinite(eventTime) || eventTime < sinceMs) continue;
      }
      handleCodexRolloutEvent(event);
    } catch {
      // Ignore partially-written JSONL lines; the next poll will catch completed records.
    }
  }
}

function processCodexLogBuffer(buffer, options = {}) {
  const text = buffer.toString("utf8");
  const firstNewline = text.indexOf("\n");
  const safeText = firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  processCodexLogChunk(safeText, options);
}

function pollCodexSessions() {
  const latest = latestRolloutFile();
  if (!latest) return;

  if (latest !== codexLogPath) {
    codexLogPath = latest;
    try {
      const size = statSync(latest).size;
      const start = Math.max(0, size - codexInitialTailBytes);
      codexLogOffset = size;
      if (start < size) {
        processCodexLogBuffer(readFileSync(latest).subarray(start), { sinceMs: Date.now() - codexInitialReplayMs });
      }
      console.log(`Codex session monitor attached: ${latest}`);
    } catch {
      codexLogOffset = 0;
    }
    return;
  }

  let size = 0;
  try {
    size = statSync(codexLogPath).size;
  } catch {
    codexLogPath = "";
    codexLogOffset = 0;
    return;
  }

  if (size < codexLogOffset) {
    codexLogOffset = size;
    return;
  }
  if (size === codexLogOffset) return;

  const data = readFileSync(codexLogPath).subarray(codexLogOffset).toString("utf8");
  codexLogOffset = size;
  processCodexLogChunk(data);
}

function startCodexSessionMonitor() {
  if (!codexMonitorEnabled) {
    console.log("Codex session monitor disabled via PEEKDOCK_CODEX_MONITOR=0");
    return;
  }
  pollCodexSessions();
  codexMonitorTimer = setInterval(pollCodexSessions, 850);
}

function listClaudeJsonlFiles(dir, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return [];
  let files = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(listClaudeJsonlFiles(fullPath, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files;
}

function latestClaudeLogFile() {
  const files = listClaudeJsonlFiles(claudeProjectsDir);
  let latest = "";
  let latestMtime = 0;
  for (const file of files) {
    try {
      const { mtimeMs } = statSync(file);
      if (mtimeMs > latestMtime) {
        latestMtime = mtimeMs;
        latest = file;
      }
    } catch {
      // Ignore rotated files.
    }
  }
  return latest;
}

function handleClaudeEvent(event) {
  if (!event || typeof event !== "object") return;

  if (event.type === "user") {
    const content = event.message?.content;
    if (Array.isArray(content) && content.some((item) => item?.type === "tool_result")) {
      if (claudeOutputLooksFailed(event.toolUseResult || {})) {
        syncRealClaudeTask("failed", "Claude Code hit an error", { progress: -1 });
      } else {
        realClaudeProgress = Math.min(92, realClaudeProgress + 5);
        syncRealClaudeTask("running", "tool finished, continuing...", { progress: realClaudeProgress });
      }
      return;
    }

    if (typeof content === "string" || Array.isArray(content)) {
      realClaudeTaskId = `claude_real_${Date.now()}`;
      realClaudeProgress = 12;
      syncRealClaudeTask("running", "reading your request...", {
        title: claudeTitleFromContent(content),
        progress: realClaudeProgress
      });
      return;
    }
    return;
  }

  if (event.type === "assistant") {
    const message = event.message || {};
    const content = Array.isArray(message.content) ? message.content : [];
    const hasToolUse = content.some((item) => item?.type === "tool_use");
    const hasText = content.some((item) => item?.type === "text");
    const hasThinking = content.some((item) => item?.type === "thinking");

    if (hasToolUse) {
      realClaudeProgress = Math.min(88, realClaudeProgress + 8);
      syncRealClaudeTask("running", "using tools...", { progress: realClaudeProgress });
      return;
    }

    if (hasThinking) {
      realClaudeProgress = Math.max(realClaudeProgress, 18);
      syncRealClaudeTask("running", "thinking...", { progress: realClaudeProgress });
    }

    if (hasText && message.stop_reason === "end_turn") {
      syncRealClaudeTask("completed", "ready to review", { progress: 100 });
      return;
    }

    if (hasText) {
      realClaudeProgress = Math.max(realClaudeProgress, 72);
      syncRealClaudeTask("running", "drafting response...", { progress: realClaudeProgress });
    }
    return;
  }

  if (event.type === "attachment") {
    const attachment = event.attachment || {};
    if (attachment.type === "async_hook_response") {
      const hookName = attachment.hookName || "";
      if (/PreToolUse/i.test(hookName)) {
        const stdout = String(attachment.stdout || "");
        const waitingForInput = /allow|permission|approve|confirm/i.test(stdout);
        syncRealClaudeTask(waitingForInput ? "needs_input" : "running", waitingForInput ? "needs permission..." : "using tools...", {
          progress: waitingForInput ? -1 : Math.min(88, realClaudeProgress + 6)
        });
        return;
      }
      if (/PostToolUse/i.test(hookName) && Number(attachment.exitCode || 0) > 0) {
        syncRealClaudeTask("failed", "Claude Code hit an error", { progress: -1 });
      }
    }
  }
}

function processClaudeLogChunk(chunk) {
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleClaudeEvent(JSON.parse(line));
    } catch {
      // Ignore partial lines until next poll.
    }
  }
}

function pollClaudeSessions() {
  const latest = latestClaudeLogFile();
  if (!latest) return;

  if (latest !== claudeLogPath) {
    claudeLogPath = latest;
    try {
      const size = statSync(latest).size;
      claudeLogOffset = Math.max(0, size - codexInitialTailBytes);
      if (claudeLogOffset < size) {
        processClaudeLogChunk(readFileSync(latest).subarray(claudeLogOffset).toString("utf8"));
      }
      claudeLogOffset = size;
      console.log(`Claude session monitor attached: ${latest}`);
    } catch {
      claudeLogOffset = 0;
    }
    return;
  }

  let size = 0;
  try {
    size = statSync(claudeLogPath).size;
  } catch {
    claudeLogPath = "";
    claudeLogOffset = 0;
    return;
  }

  if (size < claudeLogOffset) {
    claudeLogOffset = size;
    return;
  }
  if (size === claudeLogOffset) return;

  const data = readFileSync(claudeLogPath).subarray(claudeLogOffset).toString("utf8");
  claudeLogOffset = size;
  processClaudeLogChunk(data);
}

function startClaudeSessionMonitor() {
  if (!claudeMonitorEnabled) {
    console.log("Claude session monitor disabled via PEEKDOCK_CLAUDE_MONITOR=0");
    return;
  }
  pollClaudeSessions();
  claudeMonitorTimer = setInterval(pollClaudeSessions, 900);
}

function scheduleTaskTimeline() {
  taskProgressTimer = setTimeout(() => {
    updateRunningTask(62, "building the first pass...");
  }, 1800);
  taskCompleteTimer = setTimeout(completeTask, 4200);
}

function startTask(prompt) {
  clearMockTimers();
  state.lastPrompt = prompt;
  setTaskForAgent("codex", createTask(prompt));
  setCurrentAgent("codex");
  state.phase = "handoff";

  if (state.mode === "clean") {
    putAgentOnDock(state.currentTask);
  } else {
    state.agentLocation = "mac";
    syncDockIdle();
    emitState();
  }

  state.phase = "running";
  emitState();
  scheduleTaskTimeline();
  return state.currentTask;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) rejectBody(new Error("Request body too large"));
    });
    req.on("end", () => {
      if (!body) return resolveBody({});
      try {
        resolveBody(JSON.parse(body));
      } catch (error) {
        rejectBody(error);
      }
    });
  });
}

function serveFile(res, base, urlPath) {
  const filePath = safeResolve(base, urlPath === "/" ? "/index.html" : urlPath);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return false;
  res.writeHead(200, {
    "access-control-allow-origin": "*",
    "content-type": contentType(filePath)
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    clients.add(res);
    sendSse(res, { type: "state", state: publicState() });
    sendSse(res, { type: "serial_status", connected: state.serialConnected });
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/api/send-task" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const prompt = String(body.prompt || "").trim().slice(0, 140);
      if (!prompt) return sendJson(res, 400, { ok: false, error: "Prompt is required" });
      const task = startTask(prompt);
      return sendJson(res, 200, { ok: true, serialConnected: state.serialConnected, taskId: task.task_id, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/set-mode" && req.method === "POST") {
    try {
      const body = await readBody(req);
      setMode(String(body.mode || "clean"));
      return sendJson(res, 200, { ok: true, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/send-to-dock" && req.method === "POST") {
    sendAgentToDock();
    return sendJson(res, 200, { ok: true, state: publicState() });
  }

  if (url.pathname === "/api/return-to-mac" && req.method === "POST") {
    putAgentOnMac("return");
    return sendJson(res, 200, { ok: true, state: publicState() });
  }

  if (url.pathname === "/api/switch-agent" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const agent = String(body.agent || "");
      if (!AGENTS.includes(agent)) return sendJson(res, 400, { ok: false, error: "Unknown agent" });
      setCurrentAgent(agent);
      emitState();
      if (state.agentLocation === "dock") {
        syncDockSnapshot();
        if (state.currentTask) dispatchToDock({ type: "task_update", task: state.currentTask });
      }
      return sendJson(res, 200, { ok: true, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/claude-test-event" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const status = String(body.status || "running");
      const title = summarizeTitleForDock(body.title || "Real Claude smoke test", "Claude test");
      const statusText = String(body.statusText || "testing Claude bridge...").slice(0, 90);
      realClaudeTaskId = realClaudeTaskId || `claude_real_${Date.now()}`;
      syncRealClaudeTask(status, statusText, {
        title,
        progress: typeof body.progress === "number" ? body.progress : -1
      });
      return sendJson(res, 200, { ok: true, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/codex-test-event" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const status = String(body.status || "running");
      const title = summarizeTitleForDock(body.title || "Real Codex smoke test", "Codex test");
      const statusText = String(body.statusText || "testing real Codex bridge...").slice(0, 90);
      realCodexTaskId = realCodexTaskId || `codex_real_${Date.now()}`;
      syncRealCodexTask(status, statusText, {
        title,
        progress: typeof body.progress === "number" ? body.progress : -1
      });
      return sendJson(res, 200, { ok: true, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/state") {
    return sendJson(res, 200, { ok: true, state: publicState() });
  }

  if (url.pathname.startsWith("/assets/")) {
    if (serveFile(res, rootDir, url.pathname.slice(1))) return;
  }

  if (url.pathname.startsWith("/demo-results/")) {
    if (serveFile(res, rootDir, url.pathname.slice(1))) return;
  }

  if (serveFile(res, publicDir, url.pathname)) return;

  sendJson(res, 404, { ok: false, error: "Not found" });
});

if (headlessMode) {
  openSerial();
  startCodexSessionMonitor();
  startClaudeSessionMonitor();
  console.log("PeekDock bridge running in headless mode");
  console.log(`Serial target: ${serialPort}${existsSync(serialPort) ? "" : " (not present)"}`);
} else {
  server.listen(port, host, () => {
    openSerial();
    startCodexSessionMonitor();
    startClaudeSessionMonitor();
    console.log(`PeekDock bridge listening on http://${host}:${port}`);
    console.log(`Serial target: ${serialPort}${existsSync(serialPort) ? "" : " (not present, UI-only mode)"}`);
  });
}
