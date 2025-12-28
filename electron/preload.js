const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  notify: (payload) => ipcRenderer.send("notify", payload),
  on: (channel, cb) => {
    const valid = ["mark-all-read", "open-preferences"];
    if (!valid.includes(channel)) return;
    ipcRenderer.on(channel, (e, ...args) => cb(...args));
  },
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Auth methods
  auth: {
    saveToken: (token) => ipcRenderer.invoke("auth:save-token", token),
    getToken: () => ipcRenderer.invoke("auth:get-token"),
    logout: () => ipcRenderer.invoke("auth:logout"),
  },
});
