#!/usr/bin/env python3
import json
import os
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageTk

BRIDGE_URL = "http://127.0.0.1:4173"
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "raw"
TRANSPARENT = "#00ff01"
DEBUG_VISIBLE = os.environ.get("PEEKDOCK_PET_DEBUG") == "1"


def fetch_state():
    with urlopen(f"{BRIDGE_URL}/api/state", timeout=2) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("state", {})


def load_image(path, size=132):
    image = Image.open(path).convert("RGBA")
    image.thumbnail((size, size), Image.LANCZOS)
    return ImageTk.PhotoImage(image)


class DesktopPet:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("PeekDock Pet")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.window_bg = "#101217" if DEBUG_VISIBLE else TRANSPARENT
        self.root.configure(bg=self.window_bg)
        self.root.attributes("-alpha", 1.0 if DEBUG_VISIBLE else 0.96)

        self.events = queue.Queue()
        self.visible_on_mac = True
        self.card_visible = False
        self.drag_start = None
        self.window_start = None

        self.images = {
            "idle": load_image(ASSETS / "codex_idle_01.png"),
            "running": load_image(ASSETS / "codex_running_01.png"),
            "completed": load_image(ASSETS / "codex_completed_01.png"),
        }

        self.frame = tk.Frame(self.root, bg=self.window_bg)
        self.frame.pack()

        self.avatar = tk.Label(self.frame, image=self.images["idle"], bg=self.window_bg, bd=0, cursor="hand2")
        self.avatar.pack()

        self.card = tk.Frame(self.frame, bg="#15171b", bd=0, highlightthickness=1, highlightbackground="#343944")
        self.phase_label = tk.Label(self.card, text="idle", fg="#ff6a1a", bg="#15171b", font=("Helvetica", 10, "bold"))
        self.title_label = tk.Label(self.card, text="CodeX", fg="#f5efe7", bg="#15171b", wraplength=170, justify="left", font=("Helvetica", 13, "bold"))
        self.status_label = tk.Label(self.card, text="ready on Mac", fg="#aaa39b", bg="#15171b", wraplength=170, justify="left", font=("Helvetica", 11))
        self.phase_label.pack(anchor="w", padx=10, pady=(8, 2))
        self.title_label.pack(anchor="w", padx=10)
        self.status_label.pack(anchor="w", padx=10, pady=(3, 9))

        for widget in (self.avatar, self.card, self.phase_label, self.title_label, self.status_label):
            widget.bind("<ButtonPress-1>", self.on_press)
            widget.bind("<B1-Motion>", self.on_drag)
            widget.bind("<ButtonRelease-1>", self.on_release)

        self.position_top_right()
        self.start_event_thread()
        self.apply_state(fetch_state())
        self.root.after(80, self.process_events)

    def position_top_right(self):
        self.root.update_idletasks()
        width = 260 if DEBUG_VISIBLE else 210
        height = 290 if DEBUG_VISIBLE else 230
        screen_width = self.root.winfo_screenwidth()
        if DEBUG_VISIBLE:
            self.root.geometry(f"{width}x{height}+80+80")
        else:
            self.root.geometry(f"{width}x{height}+{screen_width - width - 24}+28")

    def start_event_thread(self):
        thread = threading.Thread(target=self.listen_events, daemon=True)
        thread.start()

    def listen_events(self):
        while True:
            try:
                with urlopen(f"{BRIDGE_URL}/events", timeout=30) as response:
                    for raw_line in response:
                        line = raw_line.decode("utf-8").strip()
                        if not line.startswith("data: "):
                            continue
                        event = json.loads(line[6:])
                        if event.get("type") == "state":
                            self.events.put(event.get("state", {}))
            except Exception as error:
                print(f"pet event reconnect: {error}", file=sys.stderr)

    def process_events(self):
        while not self.events.empty():
            self.apply_state(self.events.get())
        self.root.after(80, self.process_events)

    def image_key_for(self, state):
        phase = state.get("phase")
        if phase == "completed":
            return "completed"
        if phase in ("running", "handoff"):
            return "running"
        return "idle"

    def apply_state(self, state):
        task = state.get("currentTask")
        location = state.get("agentLocation", "mac")
        self.avatar.configure(image=self.images[self.image_key_for(state)])

        if location == "dock":
            self.visible_on_mac = False
            self.animate_out()
        else:
            was_hidden = not self.visible_on_mac
            self.visible_on_mac = True
            self.root.deiconify()
            if was_hidden:
                self.animate_in()

        if task:
            self.phase_label.configure(text=state.get("phase", "idle"))
            self.title_label.configure(text=task.get("title") or "CodeX")
            self.status_label.configure(text=task.get("statusText") or "working")
        else:
            self.phase_label.configure(text="idle")
            self.title_label.configure(text="CodeX")
            self.status_label.configure(text="ready on Mac")

    def animate_out(self, step=0):
        if step >= 9:
            self.root.withdraw()
            return
        x = self.root.winfo_x() + 26
        y = self.root.winfo_y()
        self.root.geometry(f"+{x}+{y}")
        self.root.after(22, lambda: self.animate_out(step + 1))

    def animate_in(self, step=0):
        if step == 0:
            self.position_top_right()
        if step >= 6:
            return
        x = self.root.winfo_x() - 10
        y = self.root.winfo_y()
        self.root.geometry(f"+{x}+{y}")
        self.root.after(26, lambda: self.animate_in(step + 1))

    def toggle_card(self):
        self.card_visible = not self.card_visible
        if self.card_visible:
            self.card.pack(pady=(0, 8))
        else:
            self.card.pack_forget()

    def on_press(self, event):
        self.drag_start = (event.x_root, event.y_root)
        self.window_start = (self.root.winfo_x(), self.root.winfo_y())

    def on_drag(self, event):
        if not self.drag_start or not self.window_start:
            return
        dx = event.x_root - self.drag_start[0]
        dy = event.y_root - self.drag_start[1]
        self.root.geometry(f"+{self.window_start[0] + dx}+{self.window_start[1] + dy}")

    def on_release(self, event):
        if not self.drag_start:
            return
        moved = abs(event.x_root - self.drag_start[0]) + abs(event.y_root - self.drag_start[1])
        self.drag_start = None
        self.window_start = None
        if moved < 5:
            self.toggle_card()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    DesktopPet().run()
