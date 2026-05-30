import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join, resolve } from "node:path";

const bridgeUrl = process.env.PEEKDOCK_BRIDGE_URL || "http://127.0.0.1:4173";
const petDir = resolve(new URL(".", import.meta.url).pathname);

let win;
let dragStart = null;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;

  win = new BrowserWindow({
    width: 220,
    height: 250,
    x: x + width - 248,
    y: y + 28,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(petDir, "preload.mjs")
    }
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(join(petDir, "index.html"));
}

ipcMain.handle("bridge-url", () => bridgeUrl);

ipcMain.on("drag-start", (_event, point) => {
  if (!win) return;
  const bounds = win.getBounds();
  dragStart = {
    mouse: screen.getCursorScreenPoint(),
    window: bounds,
    point
  };
});

ipcMain.on("drag-move", () => {
  if (!win || !dragStart) return;
  const current = screen.getCursorScreenPoint();
  win.setPosition(
    dragStart.window.x + current.x - dragStart.mouse.x,
    dragStart.window.y + current.y - dragStart.mouse.y
  );
});

ipcMain.on("drag-end", () => {
  dragStart = null;
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
