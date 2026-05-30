/* PeekDock Unified Frontend — App Logic
 * Handles: CodeX (activity bar, Ask CodeX, terminal) |
 *          Jim/即梦 (generation, history, credit) |
 *          Claude (chat, history)
 */

(function () {
  'use strict';

  // ================================================================
  // State
  // ================================================================
  let state = {};
  let es = null;

  // ================================================================
  // DOM refs
  // ================================================================
  const app = document.getElementById('app');
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  const topbarTime = document.getElementById('topbar-time');
  const modeTabs = document.querySelectorAll('.mode-tab');
  const panelViews = document.querySelectorAll('.panel-view');

  // CodeX
  const codexInput = document.getElementById('codex-ask-input');
  const codexSendBtn = document.getElementById('codex-ask-send');
  const codexMessages = document.getElementById('codex-ask-messages');
  const activityIcons = document.querySelectorAll('.activity-icon');

  // Jim
  const jimPrompt = document.getElementById('jim-prompt-textarea');
  const jimCharN = document.getElementById('jim-char-n');
  const jimGenBtn = document.getElementById('jim-generate-btn');
  const jimCanvasEmpty = document.getElementById('jim-canvas-empty');
  const jimCanvasImg = document.getElementById('jim-canvas-img');
  const jimCanvasLoading = document.getElementById('jim-canvas-loading');
  const jimLoadingText = document.getElementById('jim-loading-text');
  const jimClearBtn = document.getElementById('jim-clear-btn');
  const jimCheckCreditBtn = document.getElementById('jim-check-credit-btn');
  const jimCreditNum = document.getElementById('jim-credit-num');
  const jimHistoryList = document.getElementById('jim-history-list');

  // Claude
  const claudeInput = document.getElementById('claude-input');
  const claudeSendBtn = document.getElementById('claude-send-btn');
  const claudeMessages = document.getElementById('claude-message-list');
  const claudeWelcome = document.getElementById('claude-welcome');
  const claudeThinking = document.getElementById('claude-thinking');
  const claudeNewChatBtn = document.getElementById('claude-new-chat');

  // ================================================================
  // Clock
  // ================================================================
  function updateTime() {
    const now = new Date();
    topbarTime.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }
  setInterval(updateTime, 1000);
  updateTime();

  // ================================================================
  // SSE
  // ================================================================
  function connectSSE() {
    es = new EventSource('/events');
    es.addEventListener('open', () => setStatus('connected', 'connected'));
    es.addEventListener('state', e => { try { state = e.data?.state || {}; } catch (_) {} });
    es.addEventListener('serial_status', e => {
      try {
        const d = JSON.parse(e.data);
        setStatus(d.connected ? 'connected' : 'offline', d.connected ? 'serial connected' : 'serial offline');
      } catch (_) {}
    });
    es.addEventListener('error', () => {
      setStatus('connecting', 'reconnecting...');
      es.close();
      setTimeout(connectSSE, 3500);
    });
  }

  function setStatus(type, label) {
    statusDot.className = 'status-dot' + (type !== 'connected' ? ' ' + type : '');
    statusLabel.textContent = label;
  }

  // ================================================================
  // Panel switching
  // ================================================================
  function switchPanel(name) {
    modeTabs.forEach(tab => {
      const active = tab.dataset.panel === name;
      tab.classList.toggle('is-active', active);
    });
    panelViews.forEach(panel => {
      panel.classList.toggle('is-active', panel.id === 'panel-' + name);
    });
    app.dataset.activePanel = name;
    autoResize(codexInput);
    autoResize(jimPrompt);
    autoResize(claudeInput);
  }

  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => switchPanel(tab.dataset.panel));
  });

  // ================================================================
  // Auto-resize textarea
  // ================================================================
  function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ================================================================
  // CODEX
  // ================================================================

  // Activity bar
  function codexActivateView(view) {
    activityIcons.forEach(i => i.classList.remove('is-active'));
    const icon = document.querySelector(`.activity-icon[data-tip="${view.charAt(0).toUpperCase() + view.slice(1)}"]`) ||
                 document.querySelector(`[data-tip="${view}"]`);
    if (icon) icon.classList.add('is-active');
  }

  window.codexActivateView = codexActivateView;

  // Tree item toggle
  document.querySelectorAll('.tree-item.has-children').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('expanded');
    });
  });

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      codexInput.value = chip.dataset.q;
      autoResize(codexInput);
      codexInput.focus();
    });
  });

  // Input handling
  codexInput.addEventListener('input', () => autoResize(codexInput));
  codexInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCodexMessage();
    }
  });
  codexSendBtn.addEventListener('click', sendCodexMessage);

  function sendCodexMessage() {
    const text = codexInput.value.trim();
    if (!text) return;

    if (codexMessages.querySelector('.codex-ask-hint')) {
      const hint = codexMessages.querySelector('.codex-ask-hint');
      if (hint) hint.remove();
    }

    appendCodexMsg('user', text);
    codexInput.value = '';
    autoResize(codexInput);

    showCodexTyping();
    setTimeout(() => {
      hideCodexTyping();
      const responses = getCodexResponses(text);
      responses.forEach((r, i) => setTimeout(() => appendCodexMsg('assistant', r), i * 800));
    }, 1200);
  }

  function showCodexTyping() {
    const existing = codexMessages.querySelector('.codex-typing');
    if (existing) return;
    const div = document.createElement('div');
    div.className = 'codex-typing';
    div.innerHTML = `<div class="codex-message codex-message-assistant">
      <div class="codex-message-role">CodeX</div>
      <div class="codex-message-content" style="display:flex;gap:4px;align-items:center">
        <span style="color:#8b949e;font-size:12px">Thinking</span>
        <span class="t-cursor"></span>
      </div>
    </div>`;
    codexMessages.appendChild(div);
    codexMessages.scrollTop = codexMessages.scrollHeight;
  }

  function hideCodexTyping() {
    const el = codexMessages.querySelector('.codex-typing');
    if (el) el.remove();
  }

  function appendCodexMsg(role, content) {
    const div = document.createElement('div');
    div.className = `codex-message codex-message-${role}`;
    const isCode = content.startsWith('```');
    if (isCode) {
      const code = content.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'');
      div.innerHTML = `<div class="codex-message-role">${role === 'user' ? 'You' : 'CodeX'}</div>
        <div class="codex-message-content"><pre class="codex-code"><code>${escapeHtml(code)}</code></pre></div>`;
    } else {
      div.innerHTML = `<div class="codex-message-role">${role === 'user' ? 'You' : 'CodeX'}</div>
        <div class="codex-message-content">${linkify(escapeHtml(content))}</div>`;
    }
    codexMessages.appendChild(div);
    codexMessages.scrollTop = codexMessages.scrollHeight;
  }

  function getCodexResponses(question) {
    const q = question.toLowerCase();
    if (q.includes('lvgl flush callback') || q.includes('flush')) {
      return [
        'The LVGL flush callback in `esp_lvgl_port` invokes `esp_lcd_panel_draw_bitmap()` with the `color_map` pointer. For RGB565 panels like the JD9853, the byte order is critical.',
        '```c\nstatic void lvgl_port_flush_callback(lv_display_t *drv, const lv_area_t *area, uint8_t *color_map) {\n    // swap_bytes swaps each u16 in the buffer before sending\n    if (disp_ctx->flags.swap_bytes) {\n        lv_draw_sw_rgb565_swap(color_map, lv_area_get_size(area));\n    }\n    esp_lcd_panel_draw_bitmap(disp_ctx->panel_handle,\n        offsetx1, offsety1, offsetx2+1, offsety2+1, color_map);\n}\n```',
        'The `swap_bytes=true` flag is the likely culprit for white screen — JD9853 expects native byte order. Set it to `false` in your `lvgl_port_display_cfg_t` flags.'
      ];
    }
    if (q.includes('jd9853') || q.includes('white screen') || q.includes('rgb565')) {
      return [
        'White screen on JD9853 typically means pixel data byte order mismatch. The panel uses RGB565 where each pixel is 2 bytes.',
        'In `init_lvgl()` (app_main.cpp line ~157), change:\n```\ndisplay_cfg.flags.swap_bytes = false;  // was true\n```',
        'Also verify `esp_lcd_panel_invert_color(panel_handle, true)` is called — the JD9853 driver from Espressif sets this in `esp_lcd_new_panel_jd9853()`.'
      ];
    }
    if (q.includes('serial') || q.includes('protocol') || q.includes('json')) {
      return [
        'The protocol is JSON Lines over USB Serial JTAG. Each line is a JSON object with `schema_version`, `type`, and event-specific fields.',
        '```json\n{"schema_version":1,"type":"task_update","task":{"task_id":"...","status":"running"}}\n{"schema_version":1,"type":"action_event","source":"codex","action":"return_to_mac"}\n```',
        'On the ESP32 side, `serial_task()` reads bytes until `\\n`, parses with `parse_peekdock_event()`, then calls `peekdock_screen_apply_event()`.'
      ];
    }
    return [
      `I found relevant code for "${question.slice(0, 50)}...". Looking at the codebase, there are several related files.`,
      'The key files are `src/app/app_main.cpp` (initialization), `src/protocol/task_protocol.cpp` (parsing), and `src/ui/screens/peekdock_screen.cpp` (UI rendering).',
      'I can provide a more detailed analysis if you narrow down which specific part of the system you want to understand.'
    ];
  }

  // ================================================================
  // JIM
  // ================================================================
  window.jimSwitchView = function(view) {
    document.querySelectorAll('.jim-nav-item').forEach(n => n.classList.remove('is-active'));
    const activeNav = document.querySelector(`.jim-nav-item[data-view="${view}"]`);
    if (activeNav) activeNav.classList.add('is-active');
    document.querySelectorAll('.jim-view').forEach(v => v.style.display = 'none');
    const target = document.getElementById(`jim-view-${view}`);
    if (target) target.style.display = 'flex';
  };

  jimPrompt.addEventListener('input', () => {
    const len = jimPrompt.value.length;
    jimCharN.textContent = len;
    if (len > 500) jimCharN.parentElement.classList.add('over');
    else jimCharN.parentElement.classList.remove('over');
    autoResize(jimPrompt);
  });

  jimClearBtn.addEventListener('click', () => {
    jimPrompt.value = '';
    jimCharN.textContent = '0';
    autoResize(jimPrompt);
  });

  // Jim pill selection
  document.querySelectorAll('.jim-pill[data-model], .jim-pill[data-ratio], .jim-pill[data-style]').forEach(pill => {
    pill.addEventListener('click', () => {
      const group = pill.closest('.jim-option-pills').querySelectorAll('.jim-pill');
      group.forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');
    });
  });

  // Generate button
  jimGenBtn.addEventListener('click', async () => {
    const text = jimPrompt.value.trim();
    if (!text) { jimPrompt.focus(); return; }

    const ratioPill = document.querySelector('.jim-pill.is-active[data-ratio]');
    const stylePill = document.querySelector('.jim-pill.is-active[data-style]');
    const ratio = ratioPill ? ratioPill.dataset.ratio : '1:1';
    const style = stylePill ? stylePill.dataset.style : '动漫';

    jimGenBtn.disabled = true;
    jimGenBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/></svg> 生成中...`;

    jimCanvasEmpty.style.display = 'none';
    jimCanvasImg.style.display = 'none';
    jimCanvasLoading.style.display = 'flex';
    jimLoadingText.textContent = '正在生成图片...';

    try {
      const result = await fetch('/api/jim-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text, ratio, style })
      }).then(r => r.json());

      jimCanvasLoading.style.display = 'none';
      if (result.image_url) {
        jimCanvasImg.src = result.image_url;
        jimCanvasImg.style.display = 'block';
        jimCanvasImg.classList.add('is-visible');
        addToJimHistory(text, result.image_url);
        window.jimSwitchView('history');
      } else if (result.submit_id) {
        pollJimResult(result.submit_id);
      } else {
        showJimError('生成失败，请重试');
      }
    } catch (err) {
      jimCanvasLoading.style.display = 'none';
      showJimError('网络错误，请检查连接');
    }

    jimGenBtn.disabled = false;
    jimGenBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/></svg> 生成图片`;
  });

  function showJimError(msg) {
    jimCanvasEmpty.innerHTML = `<div class="jim-canvas-empty-icon" style="color:#ef4444"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div><p class="jim-canvas-empty-title" style="color:#ef4444">${msg}</p>`;
    jimCanvasEmpty.style.display = 'flex';
  }

  async function pollJimResult(submitId) {
    jimLoadingText.textContent = '查询结果中...';
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/jim-query?id=${submitId}`).then(r => r.json());
        if (res.status === 'success' && res.image_url) {
          jimCanvasLoading.style.display = 'none';
          jimCanvasImg.src = res.image_url;
          jimCanvasImg.style.display = 'block';
          jimCanvasImg.classList.add('is-visible');
          return;
        }
        if (res.status === 'fail') {
          showJimError('生成失败: ' + (res.fail_reason || '未知原因'));
          return;
        }
        jimLoadingText.textContent = `进度 ${i * 10}%...`;
      } catch {}
    }
    showJimError('超时，请稍后重试');
  }

  function addToJimHistory(prompt, imageUrl) {
    const empty = jimHistoryList.querySelector('.jim-history-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'jim-history-item is-active';
    item.innerHTML = `<img src="${imageUrl}" alt="generated" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;" />
      <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(prompt)}</span>`;
    item.onclick = () => {
      jimCanvasImg.src = imageUrl;
      jimCanvasImg.style.display = 'block';
      jimCanvasImg.classList.add('is-visible');
      jimCanvasEmpty.style.display = 'none';
    };
    jimHistoryList.prepend(item);
  }

  // Check credit
  jimCheckCreditBtn.addEventListener('click', async () => {
    jimCheckCreditBtn.disabled = true;
    jimCheckCreditBtn.textContent = '检查中...';
    try {
      const res = await fetch('/api/jim-credit').then(r => r.json());
      jimCreditNum.textContent = res.total_credit || '--';
    } catch {
      jimCreditNum.textContent = '错误';
    }
    jimCheckCreditBtn.disabled = false;
    jimCheckCreditBtn.textContent = '检查余额';
  });

  // ================================================================
  // CLAUDE
  // ================================================================
  window.claudeFillExample = function(text) {
    claudeInput.value = text;
    autoResize(claudeInput);
    claudeInput.focus();
  };

  claudeInput.addEventListener('input', () => autoResize(claudeInput));
  claudeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendClaudeMessage();
    }
  });
  claudeSendBtn.addEventListener('click', sendClaudeMessage);

  claudeNewChatBtn.addEventListener('click', () => {
    claudeMessages.innerHTML = '';
    claudeWelcome.style.display = 'flex';
    claudeInput.value = '';
    autoResize(claudeInput);
  });

  document.querySelectorAll('.claude-history-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.claude-history-item').forEach(i => i.classList.remove('is-active'));
      item.classList.add('is-active');
    });
  });

  function sendClaudeMessage() {
    const text = claudeInput.value.trim();
    if (!text) return;

    if (claudeWelcome.style.display !== 'none') {
      claudeWelcome.style.display = 'none';
    }

    appendClaudeMsg('user', text);
    claudeInput.value = '';
    autoResize(claudeInput);

    showThinking();
    setTimeout(() => {
      hideThinking();
      const responses = getClaudeResponses(text);
      responses.forEach((r, i) => setTimeout(() => appendClaudeMsg('assistant', r), i * 900));
    }, 1400);
  }

  function showThinking() {
    claudeThinking.style.display = 'flex';
    claudeMessages.scrollTop = claudeMessages.scrollHeight;
  }

  function hideThinking() {
    claudeThinking.style.display = 'none';
  }

  function appendClaudeMsg(role, content) {
    const div = document.createElement('div');
    div.className = `claude-msg ${role === 'user' ? 'is-user' : ''}`;

    const isCode = content.startsWith('```');
    let bubble = '';
    if (isCode) {
      const code = content.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'');
      bubble = `<div class="claude-msg-bubble"><pre class="claude-msg-code">${escapeHtml(code)}</pre></div>`;
    } else {
      bubble = `<div class="claude-msg-bubble">${linkify(escapeHtml(content))}</div>`;
    }

    const actions = role === 'assistant' ? `
      <div class="claude-msg-actions">
        <button class="claude-msg-action-btn" title="Good response">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="claude-msg-action-btn" title="Copy">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button class="claude-msg-action-btn" title="Regenerate">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="23 4 23 10 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>` : '';

    div.innerHTML = `<div class="claude-msg-avatar">${role === 'user' ? 'K' : 'A'}</div>
      <div class="claude-msg-content">${bubble}${actions}</div>`;

    claudeMessages.appendChild(div);
    claudeMessages.scrollTop = claudeMessages.scrollHeight;
  }

  function getClaudeResponses(question) {
    const q = question.toLowerCase();
    if (q.includes('lvgl flush') || q.includes('jd9853') || q.includes('white screen')) {
      return [
        'The white screen issue on the JD9853 is almost certainly the `swap_bytes` flag. In LVGL 9.x, when `display_cfg.flags.swap_bytes = true`, the flush callback calls `lv_draw_sw_rgb565_swap()` which byte-swaps every pixel before sending to the panel.',
        'The JD9853 uses standard RGB565 where byte 0 = R[4:0]|G[5:3], byte 1 = G[2:0]|B[4:0]. Swapping gives R in wrong position → all white.',
        'Fix in `src/app/app_main.cpp` line ~157:\n```\ndisplay_cfg.flags.swap_bytes = false;  // native RGB565 byte order\n```',
        'Also verify the panel bus clock: 80MHz SPI clock with DMA is correct. The panel\'s `max_transfer_sz` should match `LCD_H_RES * LCD_DRAW_BUFFER_HEIGHT * 2` bytes. If the buffer is too small, only partial flushes reach the panel, causing visual corruption.'
      ];
    }
    if (q.includes('json') || q.includes('protocol') || q.includes('serial')) {
      return [
        'The PeekDock protocol uses JSON Lines (newline-delimited JSON) over USB Serial JTAG. Each message is a single-line JSON object.',
        'Key message types:\n• `task_update` — task state changes (running/completed/failed)\n• `transition_event` — agent handoffs between Mac and Dock\n• `action_event` — dock sends actions back to Mac\n• `ping/pong` — keepalive',
        'On the ESP32 side, `serial_task()` reads in 20ms polling loops, accumulates into `serial_line_buffer`, and parses on `\\n`. Invalid lines are ignored (boot logs, partial reads).'
      ];
    }
    if (q.includes('state machine') || q.includes('handoff') || q.includes('task')) {
      return [
        'The PeekDock state machine has two primary states:\n• `agentLocation` ∈ {mac, dock}\n• `phase` ∈ {idle, handoff, running, needs_input, completed, failed}',
        'The transition rules:\n• clean mode + task start → handoff to dock immediately\n• desktop mode + task start → agent stays on mac\n• dock action "return_to_mac" → agentLocation = mac\n• dock touch swipe left → return_to_mac event',
        'This gives a clean state space of 2×6 = 12 combined states. The UI and serial protocol both reflect `agentLocation` and `phase` in every broadcast.'
      ];
    }
    return [
      `That's a broad question — "${question.slice(0, 60)}..." — let me break it down.`,
      'The PeekDock system has a few key components: the ESP32 firmware (display, touch, LVGL), the USB Serial JTAG bridge, the mac helper server, and the protocol layer.',
      'For a concrete answer, could you narrow the scope? I can walk through the firmware init sequence, the serial protocol, or the UI rendering pipeline in detail.'
    ];
  }

  // ================================================================
  // Helpers
  // ================================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function linkify(text) {
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:underline">$1</a>').replace(/\n/g, '<br>');
  }

  // ================================================================
  // Init
  // ================================================================
  connectSSE();
  setStatus('connecting', 'connecting...');

})();
