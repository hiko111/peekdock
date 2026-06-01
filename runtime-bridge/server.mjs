import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { exec, execFile } from "node:child_process";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const serialPort = process.env.PEEKDOCK_SERIAL_PORT || "/dev/cu.usbmodem1301";
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const headlessMode = process.env.PEEKDOCK_HEADLESS === "1";
const codexSessionsDir = process.env.PEEKDOCK_CODEX_SESSIONS_DIR || join(homedir(), ".codex", "sessions");
const codexMonitorEnabled = process.env.PEEKDOCK_CODEX_MONITOR !== "0";
const claudeProjectsDir = process.env.PEEKDOCK_CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
const claudeMonitorEnabled = process.env.PEEKDOCK_CLAUDE_MONITOR !== "0";
const jimengMonitorEnabled = process.env.PEEKDOCK_JIMENG_MONITOR !== "0";
const AGENTS = ["codex", "claude", "jimeng"];
const completionSoundPath = process.env.PEEKDOCK_COMPLETE_SOUND || "/System/Library/Sounds/Glass.aiff";
const startSoundPath = process.env.PEEKDOCK_START_SOUND || "/System/Library/Sounds/Pop.aiff";
const jimengUrl = process.env.PEEKDOCK_JIMENG_URL || "https://jimeng.jianying.com/";
const preferredBrowser = process.env.PEEKDOCK_BROWSER || "chrome";
const bridgeBuildId = "review-debug-20260531-2030";

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
let lastSerialLine = "";
let lastSerialLineAt = 0;
let dockConfirmationBusyUntil = 0;
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
let codexApprovalCheckTimer = null;
let codexReviewHoldUntil = 0;
let claudeMonitorTimer = null;
let claudeLogPath = "";
let claudeLogOffset = 0;
let realClaudeTaskId = "";
let realClaudeProgress = 8;
let realClaudeLastActivity = 0;
let realClaudeSettleTimer = null;
let jimengMonitorTimer = null;
let realJimengTaskId = "";
let realJimengProgress = 8;
let realJimengLastActivity = 0;
let jimengMonitorBusy = false;
let jimengLastFocusKey = "";
let jimengAutoIdleFocusKey = "";
let jimengTransientIdleCount = 0;
let manualAgentLockAgent = "";
let manualAgentLockUntil = 0;
const completeToIdleTimers = {
  codex: null,
  claude: null,
  jimeng: null
};
const completedSoundTaskIds = new Set();
const startedSoundTaskIds = new Set();
const codexInitialTailBytes = 64 * 1024;
const codexInitialReplayMs = 10_000;
const codexSettleMs = 45_000;
const completeToIdleMs = 5_000;
const manualAgentLockMs = 90_000;
const phaseProgressRanges = {
  queued: [4, 10],
  analyzing: [10, 24],
  starting: [12, 22],
  editing: [24, 54],
  "reading files": [18, 34],
  "using tool": [28, 58],
  "tool finished": [48, 74],
  "applying changes": [42, 68],
  "running checks": [58, 78],
  reviewing: [70, 88],
  finalizing: [86, 96],
  reconnecting: [34, 72],
  "waiting for confirmation": [36, 56]
};
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

function noteManualAgentSelection(agent) {
  if (!AGENTS.includes(agent)) return;
  manualAgentLockAgent = agent;
  manualAgentLockUntil = Date.now() + manualAgentLockMs;
}

function canAutoFocusAgent(agent) {
  return !(manualAgentLockAgent && manualAgentLockAgent !== agent && Date.now() < manualAgentLockUntil);
}

function jimengFocusKeyFromParsed(parsed = {}) {
  const uri = String(parsed.resultUri || "").trim();
  const title = String(parsed.title || "").replace(/\s+/g, " ").trim().toLowerCase();
  let workspace = "";
  try {
    const resolved = new URL(uri || jimengUrl);
    workspace = resolved.searchParams.get("workspace") || "";
  } catch {}
  return [workspace, title].filter(Boolean).join("::") || uri || title || "jimeng";
}

function jimengStableProgress(status, previousTask, explicitProgress) {
  if (status === "completed" || status === "idle") return explicitProgress;
  if (typeof explicitProgress === "number" && explicitProgress >= 0) {
    return clampProgressForStatus(explicitProgress, status);
  }
  if (!previousTask || previousTask.status === "completed" || previousTask.status === "idle") {
    return 12;
  }
  if (typeof previousTask?.progress === "number" && previousTask.progress >= 0) {
    return previousTask.progress;
  }
  return 42;
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

function clampProgressForStatus(progress, status) {
  if (!Number.isFinite(progress)) return -1;
  if (status === "completed") return 100;
  if (status === "idle") return -1;
  return Math.max(0, Math.min(96, Math.round(progress)));
}

function phaseRange(phase = "analyzing") {
  return phaseProgressRanges[phase] || phaseProgressRanges.analyzing;
}

function nextPhaseProgress(agent, phase, status, explicitProgress) {
  if (status === "completed") return 100;
  if (status === "failed" || status === "idle") return -1;
  if (typeof explicitProgress === "number" && explicitProgress >= 0) return clampProgressForStatus(explicitProgress, status);

  const [min, max] = phaseRange(phase);
  const current = agent === "claude" ? realClaudeProgress : agent === "jimeng" ? realJimengProgress : realCodexProgress;
  const seeded = Math.max(min, current || min);
  const step = phase === "reconnecting" || /waiting|review/i.test(phase || "") ? 1 : 2 + Math.floor(Math.random() * 3);
  return clampProgressForStatus(Math.min(max, seeded + step), status);
}

function rememberPhaseProgress(agent, progress) {
  if (typeof progress !== "number" || progress < 0) return;
  if (agent === "claude") realClaudeProgress = progress;
  else if (agent === "jimeng") realJimengProgress = progress;
  else realCodexProgress = progress;
}

function normalizePhaseText(status, phase = "", fallback = "") {
  if (status === "completed") return "completed";
  if (status === "failed") return fallback || "error";
  if (status === "idle") return "idle";
  if (status === "needs_input") {
    return "review";
  }
  if (/reconnect|connection|disconnected|network/i.test(phase || fallback)) return "reconnecting";
  if (/^using tools$/i.test(phase || fallback) || /^working$/i.test(phase || fallback)) return "editing";
  return phase || fallback || "analyzing";
}

function parseToolArguments(args = "") {
  if (!args || typeof args !== "string") return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function codexPhaseForTool(name = "", args = "") {
  const tool = String(name || "").toLowerCase();
  const text = `${name} ${args}`.toLowerCase();
  if (/apply_patch|write|edit|replace|patch/.test(text)) return "applying changes";
  if (/test|build|npm|pytest|cargo|pio|idf|esptool|check/.test(text)) return "running checks";
  if (/read|rg|grep|sed|cat|ls|find|open/.test(text) || /read|open|list|search|find/.test(tool)) return "reading files";
  return "using tool";
}

function codexInterventionPhase(payload = {}) {
  const payloadType = String(payload.type || "").toLowerCase();
  if (/approval|confirmation|confirm_required|user_input|needs_input/.test(payloadType)) return "probe_review_ui";

  const name = String(payload.name || "");
  const args = typeof payload.arguments === "string" ? payload.arguments : textFromPayload(payload);
  const parsed = parseToolArguments(args);
  const permissionValue = String(parsed.sandbox_permissions || parsed.permission || parsed.approval || "").toLowerCase();
  const explicitEscalation = permissionValue === "require_escalated" ||
    parsed.with_escalated_permissions === true ||
    parsed.requires_approval === true ||
    parsed.needs_approval === true ||
    (typeof parsed.justification === "string" && parsed.justification.trim());
  if (!explicitEscalation) return "";

  if (name === "shell_command" || name === "exec_command") return "review";
  return "probe_review_ui";
}

function codexPhaseForToolOutput(output = "") {
  const text = String(output || "").toLowerCase();
  if (/tests? failed|build failed|error:|traceback|exception/.test(text)) return "checking output";
  if (/success|done|finished|completed|exit code: 0|process exited with code 0/.test(text)) return "tool finished";
  return "reviewing output";
}

function claudePhaseForTool(content = []) {
  const text = JSON.stringify(content || []).toLowerCase();
  if (/permission|confirm|approve|allow/.test(text)) {
    if (/edit|write|patch|update/.test(text)) return "review patch";
    if (/network|download|install|fetch|curl|pip|npm/.test(text)) return "review network";
    if (/bash|shell|command|terminal/.test(text)) return "review command";
    return "review action";
  }
  if (/edit|write|patch|update/.test(text)) return "applying changes";
  if (/test|build|check|run/.test(text)) return "running checks";
  return "editing";
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

function playStartSound(task) {
  const taskId = task?.task_id || "";
  if (!taskId || startedSoundTaskIds.has(taskId)) return;
  startedSoundTaskIds.add(taskId);
  if (startedSoundTaskIds.size > 80) startedSoundTaskIds.delete(startedSoundTaskIds.values().next().value);

  if (existsSync(startSoundPath)) {
    execFile("afplay", [startSoundPath], { timeout: 2500 }, () => {});
    return;
  }
  execFile("osascript", ["-e", "beep 1"], { timeout: 2500 }, () => {});
}

function normalizedBrowserName(browser = preferredBrowser) {
  const lower = String(browser || "").trim().toLowerCase();
  if (lower === "safari") return "safari";
  return "chrome";
}

function appleScriptQuoted(text) {
  return String(text || "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function shellSingleQuoted(text) {
  return `'${String(text || "").replaceAll("'", `'\\''`)}'`;
}

function jimengAppleScriptArgs(browser = preferredBrowser) {
  const escapedUrl = appleScriptQuoted(jimengUrl);
  if (normalizedBrowserName(browser) === "safari") {
    return [
      "-e", 'tell application "Safari"',
      "-e", "activate",
      "-e", "repeat with w in windows",
      "-e", "set tabIndex to 0",
      "-e", "repeat with t in tabs of w",
      "-e", "set tabIndex to tabIndex + 1",
      "-e", "set tabUrl to URL of t",
      "-e", 'if tabUrl contains "jimeng" then',
      "-e", "set index of w to 1",
      "-e", "set current tab of front window to tab tabIndex of front window",
      "-e", "return true",
      "-e", "end if",
      "-e", "end repeat",
      "-e", "end repeat",
      "-e", `open location "${escapedUrl}"`,
      "-e", "return false",
      "-e", "end tell"
    ];
  }

  return [
    "-e", 'tell application "Google Chrome"',
    "-e", "activate",
    "-e", "repeat with w in windows",
    "-e", "set tabIndex to 0",
    "-e", "repeat with t in tabs of w",
    "-e", "set tabIndex to tabIndex + 1",
    "-e", "set tabUrl to URL of t",
    "-e", 'if tabUrl contains "jimeng" then',
    "-e", "set index of w to 1",
    "-e", "set active tab index of front window to tabIndex",
    "-e", "return true",
    "-e", "end if",
    "-e", "end repeat",
    "-e", "end repeat",
    "-e", `open location "${escapedUrl}"`,
    "-e", "return false",
    "-e", "end tell"
  ];
}

function openAgentOnMac(source = state.currentAgent, browser = preferredBrowser) {
  console.log(`openAgentOnMac: source=${source} browser=${browser}`);
  if (source === "claude") {
    execFile("open", ["-a", "Trae CN"], { timeout: 4000 }, (error) => {
      if (error) {
        console.warn(`openAgentOnMac claude open failed: ${error.message}`);
        return;
      }
      execFile("osascript", ["-e", 'tell application "Trae CN" to activate'], { timeout: 4000 }, () => {});
    });
    return;
  }
  if (source === "jimeng") {
    execFile("osascript", jimengAppleScriptArgs(browser), { timeout: 4000 }, (error) => {
      if (!error) return;
      console.warn(`openAgentOnMac jimeng script failed: ${error.message}`);
      execFile("open", [jimengUrl], { timeout: 4000 }, () => {});
    });
    return;
  }
  execFile("open", ["-b", "com.openai.codex"], { timeout: 4000 }, (error) => {
    if (error) {
      console.warn(`openAgentOnMac codex open failed: ${error.message}`);
      return;
    }
    execFile("osascript", ["-e", 'tell application id "com.openai.codex" to activate'], { timeout: 4000 }, () => {});
  });
}

function broadcast(event) {
  state.lastEvent = event;
  for (const client of clients) sendSse(client, event);
}

function emitState() {
  broadcast({ type: "state", state: publicState() });
}

function serialSummary(event = {}) {
  if (event.type === "task_update" && event.task) {
    const task = event.task;
    return `task_update source=${task.source || ""} status=${task.status || ""} text=${task.status_text || ""} progress=${task.progress}`;
  }
  if (event.type === "task_snapshot" && Array.isArray(event.tasks)) {
    return `task_snapshot count=${event.tasks.length} current=${state.currentAgent}`;
  }
  if (event.type === "transition_event") {
    return `transition_event event=${event.event || ""} source=${event.source || ""}`;
  }
  return String(event.type || "unknown");
}

function writeSerial(event) {
  openSerial();

  state.serialConnected = Boolean(serialWriter);
  const line = `${JSON.stringify({ schema_version: 1, ...event })}\n`;
  const now = Date.now();
  const duplicateWindowMs = event.type === "task_snapshot" ? 8000 : 2500;
  if (line === lastSerialLine && now - lastSerialLineAt < duplicateWindowMs) {
    console.log(`Serial skip duplicate: ${serialSummary(event)}`);
    return Boolean(serialWriter);
  }
  lastSerialLine = line;
  lastSerialLineAt = now;
  console.log(`Serial send: connected=${Boolean(serialWriter)} ${serialSummary(event)}`);
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
      const action = String(event.action || "").trim();
      const source = String(event.source || state.currentAgent || "").trim();
      console.log(`Dock action event: ${action} source=${source || state.currentAgent}`);
      if (action === "return_to_mac") {
        putAgentOnMac("return");
      } else if (action === "switch_agent_prev") {
        cycleCurrentAgent(-1);
      } else if (action === "switch_agent_next") {
        cycleCurrentAgent(1);
      } else if (action === "open_agent") {
        openAgentOnMac(source || state.currentAgent);
      } else if (action === "accept_confirmation") {
        console.log(`Dock confirmation requested: source=${source || state.currentAgent}`);
        handleDockConfirmation(source || state.currentAgent);
      } else {
        console.log(`Dock action ignored: raw=${JSON.stringify(event.action)}`);
      }
    }
  } catch (error) {
    if (line.trim().startsWith("{")) {
      console.warn(`Dock serial action error: ${error?.message || error}`);
    }
    // Ignore firmware logs and partial boot output on the same serial port.
  }
}

function handleDockConfirmation(source = state.currentAgent) {
  const now = Date.now();
  if (now < dockConfirmationBusyUntil) {
    console.log("Dock confirmation ignored: busy");
    return;
  }
  dockConfirmationBusyUntil = now + 2500;
  const agent = agentFromSource(source);
  const task = taskForAgent(agent);
  console.log(`Dock confirmation handling: agent=${agent} status=${task?.status || "none"}`);
  if (agent === "codex") {
    chooseCodexApprovalOption2((ok, reason) => {
      if (!ok) {
        const title = task?.title || `${agentMeta.codex.agentName} task`;
        const statusText = reason === "accessibility_denied" ? "open Codex" : "review";
        syncRealCodexTask("needs_input", statusText, {
          title,
          phase: "review",
          progress: -1
        });
        return;
      }
      releaseCodexReviewHold();
      const title = task?.title || `${agentMeta.codex.agentName} task`;
      syncRealCodexTask("running", "resuming", {
        title,
        phase: "resuming",
        progress: Math.max(task?.progress || 0, 42)
      });
    });
    return;
  } else {
    openAgentOnMac(agent);
  }
  if (!task || task.status !== "needs_input") return;

  const title = task.title || `${agentMeta[agent]?.agentName || "Agent"} task`;
  if (agent === "codex") {
    syncRealCodexTask("running", "resuming", { title, phase: "resuming", progress: Math.max(task.progress || 0, 42) });
  } else if (agent === "claude") {
    syncRealClaudeTask("running", "resuming", { title, phase: "resuming", progress: Math.max(task.progress || 0, 42) });
  } else if (agent === "jimeng") {
    syncRealJimengTask("running", "resuming", { title, phase: "resuming", progress: Math.max(task.progress || 0, 42) });
  }
}

function codexApprovalUiVisible(callback) {
  const script = [
    'tell application "System Events"',
    'set foundReview to false',
    'repeat with proc in application processes',
    'if (name of proc contains "Codex") then',
    'set uiText to ""',
    'try',
    'repeat with w in windows of proc',
    'try',
    'set uiText to uiText & " " & (name of buttons of w as text)',
    'end try',
    'try',
    'set uiText to uiText & " " & (name of static texts of w as text)',
    'end try',
    'try',
    'set uiText to uiText & " " & (value of static texts of w as text)',
    'end try',
    'end repeat',
    'end try',
    'if uiText contains "本次会话不再询问" then set foundReview to true',
    'if uiText contains "不再询问" then set foundReview to true',
    'if uiText contains "don’t ask again" then set foundReview to true',
    'if uiText contains "don\'t ask again" then set foundReview to true',
    'if uiText contains "Don’t ask again" then set foundReview to true',
    'if uiText contains "Don\'t ask again" then set foundReview to true',
    'if uiText contains "提交" and uiText contains "跳过" and uiText contains "询问" then set foundReview to true',
    'end if',
    'end repeat',
    'return foundReview',
    'end tell'
  ];
  execFile("osascript", script.flatMap((line) => ["-e", line]), { timeout: 1800 }, (error, stdout = "") => {
    callback(!error && /true/i.test(String(stdout)));
  });
}

function scheduleCodexApprovalReview() {
  if (codexApprovalCheckTimer) clearTimeout(codexApprovalCheckTimer);
  codexApprovalCheckTimer = setTimeout(() => {
    codexApprovalCheckTimer = null;
    codexApprovalUiVisible((visible) => {
      if (!visible) {
        console.log("Codex review probe: no approval UI visible; keep running");
        return;
      }
      console.log("Codex review probe: approval UI visible -> needs_input");
      holdCodexReview();
      syncRealCodexTask("needs_input", "review", { phase: "review" });
    });
  }, 650);
}

function clearCodexApprovalReview() {
  if (!codexApprovalCheckTimer) return;
  clearTimeout(codexApprovalCheckTimer);
  codexApprovalCheckTimer = null;
}

function chooseCodexApprovalOption2(callback = () => {}) {
  let settled = false;
  const finish = (ok, reason = "") => {
    if (settled) return;
    settled = true;
    callback(ok, reason);
  };

  console.log("Codex review option 2: starting");
  execFile("open", ["-b", "com.openai.codex"], { timeout: 4000 }, (openError) => {
    if (openError) console.warn("Codex activation failed:", openError.message);
  });
  const script = [
    'try',
    'tell application id "com.openai.codex" to activate',
    'end try',
    'delay 0.8',
    'tell application "System Events"',
    'set codexProcesses to application processes whose name contains "Codex"',
    'if (count of codexProcesses) is 0 then return "no_codex_process"',
    'set frontmost of item 1 of codexProcesses to true',
    'delay 0.35',
    'key code 19',
    'delay 0.08',
    'key code 36',
    'return "keyed_option_2"',
    'end tell'
  ];
  execFile("osascript", script.flatMap((line) => ["-e", line]), { timeout: 2500 }, (error, stdout = "", stderr = "") => {
    if (error) {
      const detail = String(stderr || error.message || "");
      const reason = /-25211|辅助访问|assistive|accessibility/i.test(detail) ? "accessibility_denied" : "script_failed";
      console.warn(`Codex review option 2 failed (${reason}):`, detail);
      openAgentOnMac("codex");
      finish(false, reason);
      return;
    }
    console.log(`Codex review option 2 sent: ${String(stdout).trim() || "ok"}`);
    finish(true);
  });
}

function holdCodexReview(ms = 12000) {
  codexReviewHoldUntil = Math.max(codexReviewHoldUntil, Date.now() + ms);
}

function codexReviewHoldActive() {
  const task = taskForAgent("codex");
  return Date.now() < codexReviewHoldUntil && task?.status === "needs_input";
}

function releaseCodexReviewHold() {
  codexReviewHoldUntil = 0;
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

function createRealJimengTask(title = "JiMeng task") {
  return {
    ...baseTaskForAgent("jimeng", title),
    task_id: realJimengTaskId || `jimeng_real_${Date.now()}`,
    status_text: "watching JiMeng..."
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
    if (agent === "jimeng") {
      jimengAutoIdleFocusKey = jimengFocusKeyFromParsed({
        resultUri: task.result_uri,
        title: task.title
      });
    }
    const idleTask = {
      ...task,
      status: "idle",
      status_text: "idle",
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
  noteManualAgentSelection(nextAgent);
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
  const title = options.title || taskForAgent("codex")?.title || "Real Codex task";
  const codexTask = taskForAgent("codex");
  if (!realCodexTaskId || !codexTask || codexTask.source !== "codex" || !codexTask.task_id.startsWith("codex_real_")) {
    realCodexTaskId = realCodexTaskId || `codex_real_${Date.now()}`;
    setTaskForAgent("codex", createRealCodexTask(title));
  }
  const task = ensureRealCodexTask(title);
  if (options.focus || !state.currentTask || state.currentAgent === "codex") {
    setCurrentAgent("codex");
  }
  const previousLocation = state.agentLocation;
  const phaseText = normalizePhaseText(status, options.phase || statusText, statusText);
  const progress = nextPhaseProgress("codex", phaseText, status, options.progress);
  rememberPhaseProgress("codex", progress);
  const patch = {
    status,
    status_text: phaseText,
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
  setTaskForAgent("codex", task);
  if (state.currentAgent === "codex") {
    state.phase = status === "idle" ? "idle" : status;
  }

  if (state.agentLocation === "dock" && status !== "idle" && state.currentAgent === "codex") {
    if (previousLocation !== "dock") {
      syncDockTask(task);
      syncDockSnapshot();
    } else {
      dispatchToDock({ type: "task_update", task });
      syncDockSnapshot();
    }
  } else if (status === "idle" && state.currentAgent === "codex") {
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
    scheduleIdleAfterCompletion("codex", task.task_id);
  } else if (status === "running") {
    playStartSound(task);
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

function ensureRealJimengTask(title = "JiMeng task") {
  if (!realJimengTaskId) realJimengTaskId = `jimeng_real_${Date.now()}`;
  const existing = taskForAgent("jimeng");
  if (!existing || existing.task_id !== realJimengTaskId) {
    setTaskForAgent("jimeng", createRealJimengTask(title));
  }
  state.lastPrompt = title;
  return taskForAgent("jimeng");
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

  if (options.focus || !state.currentTask || state.currentAgent === "claude") {
    setCurrentAgent("claude");
  }

  const task = ensureRealClaudeTask(title);
  const previousLocation = state.agentLocation;
  const phaseText = normalizePhaseText(status, options.phase || statusText, statusText);
  const progress = nextPhaseProgress("claude", phaseText, status, options.progress);
  rememberPhaseProgress("claude", progress);
  const patch = {
    status,
    status_text: phaseText,
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
  } else if (status === "running") {
    playStartSound(task);
  }
}

function syncRealJimengTask(status, statusText, options = {}) {
  clearAgentTimers("jimeng");
  realJimengLastActivity = Date.now();
  const title = options.title || taskForAgent("jimeng")?.title || "JiMeng task";
  const jimengTask = taskForAgent("jimeng");
  if (!realJimengTaskId || !jimengTask || jimengTask.source !== "jimeng" || !jimengTask.task_id.startsWith("jimeng_real_")) {
    realJimengTaskId = realJimengTaskId || `jimeng_real_${Date.now()}`;
    setTaskForAgent("jimeng", createRealJimengTask(title));
  }

  if ((options.focus && canAutoFocusAgent("jimeng")) || !state.currentTask) {
    setCurrentAgent("jimeng");
    if (options.focusKey) jimengLastFocusKey = options.focusKey;
  }

  const task = ensureRealJimengTask(title);
  const previousLocation = state.agentLocation;
  const phaseText = normalizePhaseText(status, options.phase || statusText, statusText);
  const progress = nextPhaseProgress("jimeng", phaseText, status, options.progress);
  rememberPhaseProgress("jimeng", progress);
  const patch = {
    status,
    status_text: phaseText,
    progress,
    result_uri: options.resultUri || task.result_uri || "",
    actions: status === "completed" ? ["open_result"] : status === "needs_input" ? ["provide_input"] : [],
    animation_key: animationKeyFor("jimeng", status)
  };

  if (status === "idle") {
    if (state.currentAgent === "jimeng") state.agentLocation = "mac";
  } else if (state.mode === "clean") {
    state.agentLocation = "dock";
  }

  Object.assign(task, patch, { updated_at: new Date().toISOString() });
  setTaskForAgent("jimeng", task);

  if (state.currentAgent === "jimeng") {
    state.phase = status === "idle" ? "idle" : status;
  }

  if (state.agentLocation === "dock" && status !== "idle" && state.currentAgent === "jimeng") {
    if (previousLocation !== "dock") {
      syncDockTask(task);
      syncDockSnapshot();
    } else {
      dispatchToDock({ type: "task_update", task });
      syncDockSnapshot();
    }
  } else if (status === "idle" && state.currentAgent === "jimeng") {
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
    scheduleIdleAfterCompletion("jimeng", task.task_id);
  } else if (status === "running") {
    playStartSound(task);
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
    realCodexProgress = 8;
    syncRealCodexTask("running", "analyzing", { title: userTitleFromPayload(payload), phase: "analyzing", focus: true });
    return;
  }

  if (event.type === "event_msg" && payloadType === "task_started") {
    console.log("Codex monitor event: task_started -> running");
    syncRealCodexTask("running", "starting", { phase: "starting" });
    return;
  }

  if (event.type === "response_item" && payloadType === "function_call") {
    const args = textFromPayload(payload);
    const interventionPhase = codexInterventionPhase(payload);
    if (interventionPhase === "review") {
      console.log("Codex monitor event: explicit command approval -> needs_input");
      holdCodexReview();
      syncRealCodexTask("needs_input", "review", { phase: "review" });
      return;
    }
    if (interventionPhase === "probe_review_ui") {
      console.log("Codex monitor event: possible approval -> probing UI");
      scheduleCodexApprovalReview();
    }
    const phase = codexPhaseForTool(payload.name || "", args);
    console.log("Codex monitor event: function_call -> running");
    syncRealCodexTask("running", phase, { phase });
    return;
  }

  if (event.type === "response_item" && payloadType === "custom_tool_call") {
    console.log("Codex monitor event: custom_tool_call -> running");
    const phase = codexPhaseForTool(payload.name || "", textFromPayload(payload));
    syncRealCodexTask("running", phase, { phase });
    return;
  }

  if (event.type === "response_item" && (payloadType === "function_call_output" || payloadType === "custom_tool_call_output")) {
    clearCodexApprovalReview();
    const output = textFromPayload(payload);
    const phase = codexPhaseForToolOutput(output);
    if (codexReviewHoldActive()) {
      console.log(`Codex monitor event: tool output ignored during review hold (${phase})`);
      return;
    }
    console.log("Codex monitor event: tool output -> running");
    syncRealCodexTask("running", phase, { phase });
    return;
  }

  if (event.type === "event_msg" && payloadType === "agent_message") {
    const phase = payload.phase || "";
    if (phase === "final_answer") {
      console.log("Codex monitor event: final_answer -> finalizing");
      syncRealCodexTask("running", "finalizing", { phase: "finalizing" });
    } else if (/reconnect/i.test(phase)) {
      syncRealCodexTask("running", "reconnecting", { phase: "reconnecting" });
    } else if (phase) {
      syncRealCodexTask("running", phase === "finalizing" ? "finalizing" : "reviewing", {
        phase: phase === "finalizing" ? "finalizing" : "reviewing"
      });
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
        syncRealClaudeTask("running", "reviewing", { phase: "reviewing" });
      }
      return;
    }

    if (typeof content === "string" || Array.isArray(content)) {
      realClaudeTaskId = `claude_real_${Date.now()}`;
      realClaudeProgress = 8;
      syncRealClaudeTask("running", "analyzing", { title: claudeTitleFromContent(content), phase: "analyzing", focus: true });
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
      const phase = claudePhaseForTool(content);
      syncRealClaudeTask("running", phase, { phase });
      return;
    }

    if (hasThinking) {
      syncRealClaudeTask("running", "analyzing", { phase: "analyzing" });
    }

    if (hasText && message.stop_reason === "end_turn") {
      syncRealClaudeTask("completed", "ready to review", { progress: 100 });
      return;
    }

    if (hasText) {
      syncRealClaudeTask("running", "finalizing", { phase: "finalizing" });
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
        const phase = waitingForInput ? claudePhaseForTool([stdout]) : "editing";
        syncRealClaudeTask(waitingForInput ? "needs_input" : "running", phase, { phase });
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

function jimengPollingSnapshotScript() {
  return `JSON.stringify((() => {
    const normalizeText = (value = "") => String(value || "").replace(/\\s+/g, " ").trim();
    const probeSubjectApi = () => {
      const resources = performance.getEntriesByType("resource")
        .map((entry) => entry && entry.name)
        .filter(Boolean);
      const direct = resources.filter((url) => url.includes("/mweb/v1/dreamina_subject/get")).slice(-1)[0];
      const base = direct || resources.filter((url) => /\\/mweb\\/v1\\/(get_user_local_item_list|feed)/.test(url)).slice(-1)[0];
      let subjectUrl = "/mweb/v1/dreamina_subject/get";
      if (base) {
        try {
          const parsed = new URL(base, location.href);
          parsed.pathname = "/mweb/v1/dreamina_subject/get";
          parsed.search = "";
          subjectUrl = parsed.toString();
        } catch {}
      }

      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", subjectUrl, false);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({ cursor: 0, limit: 8, keyword: "", subjectIdList: [], onlyFavorite: false }));
        let parsed = null;
        try {
          parsed = JSON.parse(String(xhr.responseText || ""));
        } catch {}
        const dataList = parsed?.data?.data_list || parsed?.data_list || [];
        return {
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          ret: parsed?.ret ?? "",
          errmsg: parsed?.errmsg ?? "",
          itemCount: Array.isArray(dataList) ? dataList.length : 0,
          items: Array.isArray(dataList)
            ? dataList.slice(0, 3).map((item) => ({
              taskStatus: normalizeText(
                item?.task_status ?? item?.taskStatus ?? item?.generate_status ?? item?.status ?? ""
              ).slice(0, 80),
              title: normalizeText(
                item?.prompt ?? item?.title ?? item?.caption ?? item?.desc ?? item?.text ?? ""
              ).slice(0, 200)
            }))
            : []
        };
      } catch (error) {
        return {
          ok: false,
          status: -1,
          ret: "",
          errmsg: String(error)
        };
      }
    };

    return {
      title: document.title,
      href: location.href,
      bodyText: normalizeText(document.body ? document.body.innerText : "").slice(0, 2200),
      buttonTexts: Array.from(document.querySelectorAll("button, [role=button], a"))
        .map((el) => normalizeText(el.innerText || el.getAttribute("aria-label") || el.title || ""))
        .filter(Boolean)
        .slice(0, 20),
      headings: Array.from(document.querySelectorAll("h1,h2,h3"))
        .map((el) => normalizeText(el.innerText || ""))
        .filter(Boolean)
        .slice(0, 8),
      textareas: Array.from(document.querySelectorAll("textarea, input[type=text]"))
        .map((el) => ({
          placeholder: normalizeText(el.placeholder || el.getAttribute("aria-label") || "").slice(0, 120),
          value: normalizeText(el.value || "").slice(0, 160)
        }))
        .slice(0, 4),
      generatedImageCount: Array.from(document.images)
        .filter((img) => {
          const src = String(img.currentSrc || img.src || "");
          return /dreamina-sign|tb4s082cfz/.test(src) && ((img.naturalWidth || 0) >= 300 || (img.naturalHeight || 0) >= 300);
        })
        .length,
      imageCount: document.images.length,
      timestamp: Date.now(),
      apiSubject: probeSubjectApi()
    };
  })())`;
}

function jimengProbeSnapshotScript() {
  return `JSON.stringify((() => {
    const normalizeText = (value = "") => String(value || "").replace(/\\s+/g, " ").trim();
    const isUseful = (value) => value !== undefined && value !== null && value !== "";
    const visit = (input, fn, seen = new WeakSet(), depth = 0) => {
      if (depth > 4 || !input || typeof input !== "object") return;
      if (seen.has(input)) return;
      seen.add(input);
      fn(input, depth);
      if (Array.isArray(input)) {
        input.slice(0, 12).forEach((item) => visit(item, fn, seen, depth + 1));
        return;
      }
      Object.values(input).slice(0, 24).forEach((value) => visit(value, fn, seen, depth + 1));
    };
    const firstByKeys = (input, patterns = []) => {
      let match = "";
      visit(input, (node) => {
        if (match || Array.isArray(node)) return;
        for (const [key, value] of Object.entries(node)) {
          if (!isUseful(value) || typeof value === "object") continue;
          if (!patterns.some((pattern) => pattern.test(key))) continue;
          const text = normalizeText(value).slice(0, 240);
          if (text) {
            match = text;
            break;
          }
        }
      });
      return match;
    };
    const firstStatusValue = (input) => {
      let match = "";
      visit(input, (node) => {
        if (match || Array.isArray(node)) return;
        for (const [key, value] of Object.entries(node)) {
          if (!isUseful(value) || typeof value === "object") continue;
          if (!/taskstatus|task_status|generate_status|status/i.test(key)) continue;
          match = normalizeText(value).slice(0, 80);
          if (match) break;
        }
      });
      return match;
    };
    const buildSubjectUrl = () => {
      const resources = performance.getEntriesByType("resource")
        .map((entry) => entry && entry.name)
        .filter(Boolean);
      const direct = resources.filter((url) => url.includes("/mweb/v1/dreamina_subject/get")).slice(-1)[0];
      if (direct) return direct;

      const base = resources.filter((url) => /\\/mweb\\/v1\\/(get_user_local_item_list|feed)/.test(url)).slice(-1)[0];
      if (!base) return "/mweb/v1/dreamina_subject/get";
      try {
        const parsed = new URL(base, location.href);
        parsed.pathname = "/mweb/v1/dreamina_subject/get";
        parsed.searchParams.delete("device_platform");
        parsed.searchParams.delete("region");
        parsed.searchParams.delete("web_id");
        parsed.searchParams.delete("a_bogus");
        return parsed.toString();
      } catch {
        return "/mweb/v1/dreamina_subject/get";
      }
    };
    const summarizeSubjectItem = (item = {}) => ({
      id: firstByKeys(item, [/subject_?id$/i, /^id$/i, /item_?id$/i]),
      taskStatus: firstStatusValue(item),
      title: firstByKeys(item, [/prompt/i, /title/i, /caption/i, /desc/i, /text/i, /query/i]),
      updatedAt: firstByKeys(item, [/update/i, /create/i, /time/i, /date/i]),
      keys: Object.keys(item || {}).slice(0, 24),
      sample: JSON.stringify(item).slice(0, 800)
    });
    const probeSubjectApi = () => {
      const subjectUrl = buildSubjectUrl();
      const body = { cursor: 0, limit: 20, keyword: "", subjectIdList: [], onlyFavorite: false };
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", subjectUrl, false);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify(body));
        const text = String(xhr.responseText || "");
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {}
        const dataList = parsed?.data?.data_list || parsed?.data_list || [];
        return {
          ok: xhr.status >= 200 && xhr.status < 300,
          url: subjectUrl,
          status: xhr.status,
          requestBody: body,
          ret: parsed?.ret ?? "",
          errmsg: parsed?.errmsg ?? "",
          itemCount: Array.isArray(dataList) ? dataList.length : 0,
          items: Array.isArray(dataList) ? dataList.slice(0, 4).map(summarizeSubjectItem) : [],
          rawSample: text.slice(0, 1600)
        };
      } catch (error) {
        return {
          ok: false,
          url: subjectUrl,
          status: -1,
          requestBody: body,
          error: String(error),
          rawSample: String(error?.stack || "")
        };
      }
    };

    return {
      title: document.title,
      href: location.href,
      bodyText: normalizeText(document.body ? document.body.innerText : "").slice(0, 8000),
      buttonTexts: Array.from(document.querySelectorAll("button, [role=button], a"))
        .map((el) => normalizeText(el.innerText || el.getAttribute("aria-label") || el.title || ""))
        .filter(Boolean)
        .slice(0, 80),
      headings: Array.from(document.querySelectorAll("h1,h2,h3"))
        .map((el) => normalizeText(el.innerText || ""))
        .filter(Boolean)
        .slice(0, 20),
      textareas: Array.from(document.querySelectorAll("textarea, input[type=text]"))
        .map((el) => ({
          placeholder: normalizeText(el.placeholder || el.getAttribute("aria-label") || ""),
          value: normalizeText(el.value || "").slice(0, 200)
        }))
        .slice(0, 12),
      generatedImageCount: Array.from(document.images)
        .filter((img) => {
          const src = String(img.currentSrc || img.src || "");
          return /dreamina-sign|tb4s082cfz/.test(src) && ((img.naturalWidth || 0) >= 300 || (img.naturalHeight || 0) >= 300);
        })
        .length,
      imageCount: document.images.length,
      timestamp: Date.now(),
      apiSubject: probeSubjectApi()
    };
  })())`;
}

function jimengAppleScriptArgsForSnapshot(mode = "probe") {
  const script = appleScriptQuoted(mode === "poll" ? jimengPollingSnapshotScript() : jimengProbeSnapshotScript());
  return [
    "-e", 'tell application "Google Chrome"',
    "-e", "repeat with w in windows",
    "-e", "repeat with t in tabs of w",
    "-e", 'if (URL of t as text) contains "jimeng" and (URL of t as text) contains "/ai-tool/generate" then',
    "-e", `return execute t javascript "${script}"`,
    "-e", "end if",
    "-e", "end repeat",
    "-e", "end repeat",
    "-e", "repeat with w in windows",
    "-e", "repeat with t in tabs of w",
    "-e", 'if (URL of t as text) contains "jimeng" then',
    "-e", `return execute t javascript "${script}"`,
    "-e", "end if",
    "-e", "end repeat",
    "-e", "end repeat",
    "-e", 'return "{\\"found\\":false}"',
    "-e", "end tell"
  ];
}

function runJimengSnapshot(options, callback) {
  const normalized = typeof options === "function" ? { mode: "probe" } : (options || {});
  const done = typeof options === "function" ? options : callback;
  const mode = normalized.mode === "poll" ? "poll" : "probe";
  const timeout = typeof normalized.timeout === "number" ? normalized.timeout : (mode === "poll" ? 3200 : 5000);
  execFile("osascript", jimengAppleScriptArgsForSnapshot(mode), { timeout }, done);
}

function jimengStatusFromApiProbe(apiSubject = {}, fallback = {}) {
  if (!apiSubject || typeof apiSubject !== "object") return null;

  const statusCode = Number(apiSubject.status);
  const ret = String(apiSubject.ret || "").trim();
  const errorText = `${apiSubject.errmsg || ""} ${apiSubject.error || ""}`.toLowerCase();
  const items = Array.isArray(apiSubject.items) ? apiSubject.items : [];
  const fallbackHref = String(fallback.href || "");
  const fallbackTitle = String(fallback.title || "");
  const fallbackPrompt = Array.isArray(fallback.textareas)
    ? fallback.textareas.map((item) => item?.value || "").find(Boolean) || ""
    : "";

  if ((statusCode === 200 || statusCode === 401) && (ret === "1015" || /login/.test(errorText))) {
    return {
      status: fallbackHref.includes("/ai-tool/home") ? "idle" : "running",
      statusText: fallbackHref.includes("/ai-tool/home") ? "ready to create" : "working in JiMeng",
      phase: fallbackHref.includes("/ai-tool/home") ? "idle" : "editing",
      title: fallbackPrompt || "JiMeng login",
      progress: -1,
      resultUri: fallbackHref
    };
  }

  if (!(statusCode >= 200 && statusCode < 300) || (ret && ret !== "0")) {
    return null;
  }

  const normalizeStatus = (value = "") => {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    if (/finished|success|done|complete|completed|\b3\b/.test(text)) return "completed";
    if (/failed|error|reject|blocked/.test(text)) return "failed";
    if (/queue|waiting|pending|running|stream|generating|processing|\b1\b|\b2\b/.test(text)) return "running";
    if (/cancel/.test(text)) return "running";
    return "";
  };

  const activeItem = items.find((item) => normalizeStatus(item?.taskStatus) === "running") ||
    items.find((item) => normalizeStatus(item?.taskStatus) === "failed") ||
    items.find((item) => normalizeStatus(item?.taskStatus) === "completed") ||
    items[0];
  const apiStatus = normalizeStatus(activeItem?.taskStatus);
  if (!apiStatus) {
    if (Number(apiSubject.itemCount) === 0) {
      if (!fallbackHref.includes("/ai-tool/home")) return null;
      return {
        status: "idle",
        statusText: "ready to create",
        phase: "idle",
        title: fallbackPrompt || fallbackTitle || "JiMeng ready",
        progress: -1,
        resultUri: fallbackHref
      };
    }
    return null;
  }

  const apiTitle = activeItem?.title || fallbackPrompt || fallbackTitle || "JiMeng task";
  if (apiStatus === "completed") {
    return {
      status: "completed",
      statusText: "completed",
      phase: "completed",
      title: apiTitle,
      progress: 100,
      resultUri: fallbackHref
    };
  }
  if (apiStatus === "failed") {
    return {
      status: "running",
      statusText: "working in JiMeng",
      phase: "editing",
      title: apiTitle,
      progress: -1,
      resultUri: fallbackHref
    };
  }
  return {
    status: "running",
    statusText: "generating image",
    phase: "editing",
    title: apiTitle,
    progress: -1,
    resultUri: fallbackHref
  };
}

function jimengStatusFromSnapshot(snapshot = {}) {
  if (!snapshot || snapshot.found === false) {
    return {
      status: "idle",
      statusText: "JiMeng tab closed",
      phase: "idle",
      title: "JiMeng task",
      progress: -1,
      resultUri: ""
    };
  }

  const body = String(snapshot.bodyText || "");
  const title = String(snapshot.title || "");
  const href = String(snapshot.href || "");
  const joinedButtons = Array.isArray(snapshot.buttonTexts) ? snapshot.buttonTexts.join(" | ") : "";
  const joinedHeadings = Array.isArray(snapshot.headings) ? snapshot.headings.join(" | ") : "";
  const generatedImageCount = Number(snapshot.generatedImageCount || 0);
  const promptValue = Array.isArray(snapshot.textareas)
    ? snapshot.textareas.map((item) => item?.value || "").find(Boolean) || ""
    : "";
  const combined = `${title}\n${href}\n${joinedHeadings}\n${joinedButtons}\n${body}`;
  const activeProgressMatch = body.match(/(\d{1,3})%\s*造梦中/);
  const activeProgress = activeProgressMatch ? Number(activeProgressMatch[1]) : -1;
  const hasActiveThinking = href.includes("/ai-tool/generate") && (
    /认真思考中/.test(body) ||
    /正在思考/.test(body) ||
    /思考中\.\.\./.test(body) ||
    /思考中(?![^。\n]{0,8}完成)/.test(body)
  );
  const hasActiveGeneration = href.includes("/ai-tool/generate") && (
    /\(\s*\d+\s*\/\s*\d+\s*\)\s*图片生成中/.test(body) ||
    /\d{1,3}%\s*造梦中/.test(body) ||
    /图片生成中\.\.\.|图片生成中|造梦中|渲染中|处理中，请稍候/.test(body)
  );
  const apiDerived = jimengStatusFromApiProbe(snapshot.apiSubject, snapshot);
  if (apiDerived) return apiDerived;

  if (hasActiveThinking) {
    return {
      status: "running",
      statusText: "thinking",
      phase: "analyzing",
      title: promptValue || "JiMeng thinking",
      progress: 12,
      resultUri: href
    };
  }

  if (hasActiveGeneration) {
    return {
      status: "running",
      statusText: activeProgress >= 0 ? `generating image ${Math.min(activeProgress, 99)}%` : "generating image",
      phase: "editing",
      title: promptValue || "JiMeng generation",
      progress: activeProgress >= 0 ? Math.min(activeProgress, 99) : 42,
      resultUri: href
    };
  }

  if (
    href.includes("/ai-tool/generate") &&
    (
      (generatedImageCount >= 4 && /时间|生成模式|操作类型/.test(body)) ||
      (/已完成/.test(body) && generatedImageCount >= 1) ||
      (/再次生成|继续编辑|去画布|查看结果|查看作品/.test(joinedButtons) && generatedImageCount >= 1)
    )
  ) {
    return {
      status: "completed",
      statusText: "completed",
      phase: "completed",
      title: promptValue || "JiMeng result",
      progress: 100,
      resultUri: href
    };
  }

  if (
    href.includes("/ai-tool/generate") &&
    (
      /请问.+[？?]/.test(body) ||
      /需要展示哪些核心信息/.test(body) ||
      /主题是什么/.test(body) ||
      /用户要求.+询问信息/.test(body)
    )
  ) {
    return {
      status: "running",
      statusText: "working in JiMeng",
      phase: "editing",
      title: promptValue || "JiMeng follow-up",
      progress: -1,
      resultUri: href
    };
  }

  if (href.includes("/ai-tool/home")) {
    return {
      status: "idle",
      statusText: "ready to create",
      phase: "idle",
      title: promptValue || "JiMeng ready",
      progress: -1,
      resultUri: href
    };
  }

  if (/登录|注册|授权|手机号|验证码|请登录|登录后/i.test(combined)) {
    return {
      status: href.includes("/ai-tool/home") ? "idle" : "running",
      statusText: href.includes("/ai-tool/home") ? "ready to create" : "working in JiMeng",
      phase: href.includes("/ai-tool/home") ? "idle" : "editing",
      title: promptValue || "JiMeng login",
      progress: -1,
      resultUri: href
    };
  }

  if (/失败|出错|错误|重试|网络异常|服务异常|生成失败/i.test(combined)) {
    return {
      status: "running",
      statusText: "working in JiMeng",
      phase: "editing",
      title: promptValue || "JiMeng generation",
      progress: -1,
      resultUri: href
    };
  }

  if (/排队中|生成中|创作中|处理中|渲染中|提交中|正在生成|正在创作|预计|队列|任务执行中|处理中，请稍候/i.test(combined)) {
    return {
      status: "running",
      statusText: "generating image",
      phase: "editing",
      title: promptValue || "JiMeng generation",
      progress: -1,
      resultUri: href
    };
  }

  if ((/下载|保存|再次生成|继续编辑|去画布|发布|分享|查看结果|查看作品/i.test(joinedButtons) || /作品|结果|已完成|生成完成/i.test(combined)) && !href.includes("/ai-tool/home")) {
    return {
      status: "completed",
      statusText: "completed",
      phase: "completed",
      title: promptValue || "JiMeng result",
      progress: 100,
      resultUri: href
    };
  }

  return {
    status: "running",
    statusText: "watching JiMeng",
    phase: "editing",
    title: promptValue || joinedHeadings || title || "JiMeng task",
    progress: -1,
    resultUri: href
  };
}

function pollJimengChrome() {
  if (!jimengMonitorEnabled || jimengMonitorBusy) return;
  jimengMonitorBusy = true;
  runJimengSnapshot({ mode: "poll" }, (error, stdout = "", stderr = "") => {
    jimengMonitorBusy = false;
    if (error) {
      const stderrText = String(stderr || "").trim();
      console.log(`JiMeng Chrome monitor error: ${error.message}${stderrText ? ` | stderr=${stderrText}` : ""}`);
      return;
    }

    try {
      const snapshot = JSON.parse(String(stdout || "").trim() || "{}");
      const previousTask = taskForAgent("jimeng");
      if (snapshot?.found === false && previousTask && previousTask.status !== "idle") {
        return;
      }
      const parsed = jimengStatusFromSnapshot(snapshot);
      const previousStatus = String(previousTask?.status || "idle");
      const focusKey = jimengFocusKeyFromParsed(parsed);
      const isFreshRunningTask = parsed.status === "running" && (!previousTask || previousStatus === "idle" || previousStatus === "completed");
      const shouldFocus = parsed.status !== "idle" && (previousStatus === "idle" || !previousTask);
      if (
        parsed.status === "completed" &&
        previousTask &&
        previousTask.status === "idle" &&
        focusKey &&
        focusKey === jimengAutoIdleFocusKey
      ) {
        return;
      }
      if (parsed.status === "idle" && !taskForAgent("jimeng")) return;
      if (
        parsed.status === "idle" &&
        previousTask &&
        previousTask.status !== "idle" &&
        !String(parsed.resultUri || "").includes("/ai-tool/home")
      ) {
        return;
      }
      if (parsed.status === "idle" && previousTask && previousTask.status !== "idle") {
        jimengTransientIdleCount += 1;
        if (jimengTransientIdleCount < 2) return;
      } else {
        jimengTransientIdleCount = 0;
      }
      if (isFreshRunningTask) {
        realJimengTaskId = `jimeng_real_${Date.now()}`;
        realJimengProgress = 12;
        jimengAutoIdleFocusKey = "";
      }
      if (parsed.status !== "idle" && !realJimengTaskId) {
        realJimengTaskId = `jimeng_real_${Date.now()}`;
        realJimengProgress = 8;
      }
      const stableProgress = jimengStableProgress(parsed.status, previousTask, parsed.progress);
      const nextTitle = summarizeTitleForDock(parsed.title, "Making image");
      if (
        previousTask &&
        previousTask.status === parsed.status &&
        previousTask.status_text === normalizePhaseText(parsed.status, parsed.phase || parsed.statusText, parsed.statusText) &&
        previousTask.title === nextTitle &&
        previousTask.result_uri === String(parsed.resultUri || "") &&
        previousTask.progress === (typeof stableProgress === "number" ? stableProgress : previousTask.progress) &&
        !shouldFocus
      ) {
        return;
      }
      syncRealJimengTask(parsed.status, parsed.statusText, {
        title: nextTitle,
        focus: shouldFocus,
        focusKey,
        progress: stableProgress,
        phase: parsed.phase,
        resultUri: parsed.resultUri
      });
    } catch (parseError) {
      console.log(`JiMeng snapshot parse failed: ${parseError.message}`);
    }
  });
}

function startJimengMonitor() {
  if (!jimengMonitorEnabled) {
    console.log("JiMeng monitor disabled via PEEKDOCK_JIMENG_MONITOR=0");
    return;
  }
  if (normalizedBrowserName(preferredBrowser) !== "chrome") {
    console.log(`JiMeng monitor only supports Chrome for now; current browser=${preferredBrowser}`);
    return;
  }
  pollJimengChrome();
  jimengMonitorTimer = setInterval(pollJimengChrome, 1800);
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
      noteManualAgentSelection(agent);
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
        focus: body.focus !== false,
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
        focus: body.focus !== false,
        progress: typeof body.progress === "number" ? body.progress : -1
      });
      return sendJson(res, 200, { ok: true, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/debug-codex-accept" && req.method === "POST") {
    console.log("Debug Codex accept requested");
    handleDockConfirmation("codex");
    return sendJson(res, 200, { ok: true, state: publicState() });
  }

  if (url.pathname === "/api/jimeng-test-event" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const status = String(body.status || "running");
      const title = summarizeTitleForDock(body.title || "JiMeng smoke test", "Making image");
      const statusText = String(body.statusText || "testing JiMeng bridge...").slice(0, 90);
      realJimengTaskId = realJimengTaskId || `jimeng_real_${Date.now()}`;
      syncRealJimengTask(status, statusText, {
        title,
        focus: body.focus !== false,
        progress: typeof body.progress === "number" ? body.progress : -1,
        resultUri: typeof body.resultUri === "string" ? body.resultUri : jimengUrl
      });
      return sendJson(res, 200, { ok: true, state: publicState() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/jimeng-probe") {
    runJimengSnapshot({ mode: "probe" }, (error, stdout = "", stderr = "") => {
      if (error) {
        return sendJson(res, 500, { ok: false, error: error.message, stderr: String(stderr || "") });
      }
      try {
        const snapshot = JSON.parse(String(stdout || "").trim() || "{}");
        const parsed = jimengStatusFromSnapshot(snapshot);
        return sendJson(res, 200, { ok: true, snapshot, parsed });
      } catch (parseError) {
        return sendJson(res, 500, { ok: false, error: parseError.message, raw: String(stdout || "") });
      }
    });
    return;
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

  sendJson(res, 404, { ok: false, error: "Not found" });
});

function startRuntimeMonitors(serialMissingText = " (not present)") {
  openSerial();
  startCodexSessionMonitor();
  startClaudeSessionMonitor();
  startJimengMonitor();
  console.log(`Serial target: ${serialPort}${existsSync(serialPort) ? "" : serialMissingText}`);
}

console.log(`PeekDock bridge build: ${bridgeBuildId}`);

if (headlessMode) {
  server.listen(port, host, () => {
    startRuntimeMonitors(" (not present)");
    console.log(`PeekDock bridge running in headless mode on http://${host}:${port}`);
  });
} else {
  server.listen(port, host, () => {
    startRuntimeMonitors(" (not present, UI-only mode)");
    console.log(`PeekDock bridge listening on http://${host}:${port}`);
  });
}
