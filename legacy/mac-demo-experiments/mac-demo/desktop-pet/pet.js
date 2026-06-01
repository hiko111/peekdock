const dom = {
  avatar: document.querySelector("#avatar"),
  avatarButton: document.querySelector("#avatar-button"),
  pet: document.querySelector("#pet"),
  phase: document.querySelector("#phase"),
  status: document.querySelector("#status"),
  taskCard: document.querySelector("#task-card"),
  title: document.querySelector("#title")
};

let bridgeUrl = "http://127.0.0.1:4173";
let lastLocation = "mac";
let dragging = false;
let moved = false;
let pointerStart = null;

function avatarFor(state) {
  if (state.phase === "completed") return "../../assets/raw/codex_completed_01.png";
  if (state.phase === "running" || state.phase === "handoff") return "../../assets/raw/codex_running_01.png";
  return "../../assets/raw/codex_idle_01.png";
}

function render(state) {
  const task = state.currentTask;
  const location = state.agentLocation;

  dom.avatar.src = avatarFor(state);
  dom.pet.classList.toggle("is-on-dock", location === "dock");

  if (lastLocation === "dock" && location === "mac") {
    dom.pet.classList.remove("is-returning");
    requestAnimationFrame(() => dom.pet.classList.add("is-returning"));
  }
  lastLocation = location;

  if (!task) {
    dom.phase.textContent = "idle";
    dom.title.textContent = "CodeX";
    dom.status.textContent = "ready on Mac";
    return;
  }

  dom.phase.textContent = state.phase;
  dom.title.textContent = task.title;
  dom.status.textContent = task.statusText || (location === "mac" ? "working on Mac" : "working on dock");
}

async function loadInitialState() {
  const response = await fetch(`${bridgeUrl}/api/state`);
  const payload = await response.json();
  if (payload.ok) render(payload.state);
}

function connectEvents() {
  const events = new EventSource(`${bridgeUrl}/events`);
  events.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "state") render(event.state);
  };
}

dom.avatarButton.addEventListener("pointerdown", (event) => {
  dragging = true;
  moved = false;
  pointerStart = { x: event.clientX, y: event.clientY };
  dom.avatarButton.setPointerCapture(event.pointerId);
  window.peekdockPet.dragStart({ x: event.clientX, y: event.clientY });
});

dom.avatarButton.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
  window.peekdockPet.dragMove();
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  window.peekdockPet.dragEnd();
}

dom.avatarButton.addEventListener("pointerup", (event) => {
  endDrag();
  if (moved) return;
  dom.avatarButton.classList.remove("is-clicked");
  requestAnimationFrame(() => dom.avatarButton.classList.add("is-clicked"));
  dom.taskCard.hidden = !dom.taskCard.hidden;
});

dom.avatarButton.addEventListener("pointercancel", endDrag);

bridgeUrl = await window.peekdockPet.bridgeUrl();
await loadInitialState();
connectEvents();
