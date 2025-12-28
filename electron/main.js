const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");

// Keytar for secure token storage
let keytar;
try {
  keytar = require("keytar");
} catch (err) {
  console.error("Keytar not available:", err.message);
}

const SERVICE_NAME = "gitsignal";
const ACCOUNT_NAME = "github-token";

// Check if we're in development by looking for dist folder
const distPath = path.join(__dirname, "..", "dist", "index.html");
const isDev =
  !fs.existsSync(distPath) || process.env.NODE_ENV === "development";

console.log("Development mode:", isDev);

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("ready-to-show", () => mainWindow.show());
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "public", "icon.png");
  const nImg = nativeImage.createFromPath(iconPath);
  tray = new Tray(nImg);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open GitSignal", click: () => mainWindow.show() },
    {
      label: "Mark all read",
      click: () => mainWindow.webContents.send("mark-all-read"),
    },
    { type: "separator" },
    {
      label: "Preferences",
      click: () => mainWindow.webContents.send("open-preferences"),
    },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip("GitSignal");
  tray.on("click", () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Example: send a system notification when renderer reports new items
ipcMain.on("notify", (event, { title, body, url }) => {
  const n = new Notification({ title, body });
  n.on("click", () => {
    if (url) shell.openExternal(url);
  });
  n.show();
});

// Simple stub: main can trigger polling via renderer requests or handle it itself
ipcMain.handle("open-external", async (event, url) => {
  await shell.openExternal(url);
});

// Auth handlers
ipcMain.handle("auth:save-token", async (event, token) => {
  try {
    // Store token securely in keychain
    if (keytar) {
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
      return { success: true };
    }
    return { success: false, error: "Keytar not available" };
  } catch (error) {
    console.error("Save token error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("auth:get-token", async () => {
  try {
    if (keytar) {
      const token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      return token;
    }
    return null;
  } catch (error) {
    console.error("Error retrieving token:", error);
    return null;
  }
});

ipcMain.handle("auth:logout", async () => {
  try {
    if (keytar) {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    }
    return { success: true };
  } catch (error) {
    console.error("Logout error:", error);
    return { success: false, error: error.message };
  }
});
