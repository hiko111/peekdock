const apiBase = location.protocol === "file:" ? "http://127.0.0.1:4173" : "";

const dom = {
  connection: document.querySelector("#connection"),
  form: document.querySelector("#task-form"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  taskCard: document.querySelector("#task-card"),
  taskLocation: document.querySelector("#task-location"),
  taskPhase: document.querySelector("#task-phase"),
  taskTitle: document.querySelector("#task-title")
};

function setModeButtons(mode) {
  for (const button of dom.modeButtons) {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  }
}

function render(state) {
  dom.connection.textContent = state.serialConnected ? "serial ready" : "ui only";
  setModeButtons(state.mode);

  if (!state.currentTask) {
    dom.taskCard.hidden = true;
    return;
  }

  dom.taskCard.hidden = false;
  dom.taskTitle.textContent = state.currentTask.title;
  dom.taskPhase.textContent = state.phase;
  dom.taskLocation.textContent = state.agentLocation;
}

async function postJson(path, body = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

dom.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = dom.prompt.value.trim();
  if (!prompt) {
    dom.prompt.focus();
    return;
  }

  dom.send.disabled = true;
  try {
    const result = await postJson("/api/send-task", { prompt });
    render(result.state);
  } finally {
    dom.send.disabled = false;
  }
});

for (const button of dom.modeButtons) {
  button.addEventListener("click", async () => {
    const result = await postJson("/api/set-mode", { mode: button.dataset.mode });
    render(result.state);
  });
}

const events = new EventSource(`${apiBase}/events`);
events.onopen = () => {
  dom.connection.textContent = "bridge connected";
};
events.onerror = () => {
  dom.connection.textContent = "bridge offline";
};
events.onmessage = (message) => {
  const event = JSON.parse(message.data);
  if (event.type === "state") render(event.state);
};
