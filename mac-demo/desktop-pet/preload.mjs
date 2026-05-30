import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("peekdockPet", {
  bridgeUrl: () => ipcRenderer.invoke("bridge-url"),
  dragStart: (point) => ipcRenderer.send("drag-start", point),
  dragMove: () => ipcRenderer.send("drag-move"),
  dragEnd: () => ipcRenderer.send("drag-end")
});
