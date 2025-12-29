import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Store from "electron-store";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = "GitSignal";
const WEBSITE_URL = "https://gitsignal.dev";

// Use a nicer internal name for menus in development. (Packaging name is handled by the OS.)
if (process.platform === "darwin" || process.platform === "win32") {
  app.setName(APP_NAME);
}

const settingsStore = new Store({
  name: "gitsignal",
  defaults: {
    launchAtLogin: false,
    showMenubarIcon: true,
    showDockIcon: true,
    closeToTray: true,
  },
});

function findFirstExistingPath(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function getAppIconPath() {
  return findFirstExistingPath([
    path.join(__dirname, "..", "dist", "icon.png"),
    path.join(__dirname, "..", "public", "icon.png"),
  ]);
}

function getTrayIconPaths() {
  return {
    base: findFirstExistingPath([
      path.join(__dirname, "..", "dist", "trayTemplate.png"),
      path.join(__dirname, "..", "public", "trayTemplate.png"),
    ]),
    retina: findFirstExistingPath([
      path.join(__dirname, "..", "dist", "trayTemplate@2x.png"),
      path.join(__dirname, "..", "public", "trayTemplate@2x.png"),
    ]),
  };
}

function getPackageMetadata() {
  try {
    const pkgPath = path.join(app.getAppPath(), "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return {};
  }
}

function getAuthorName() {
  const pkg = getPackageMetadata();
  if (typeof pkg.author === "string") return pkg.author;
  if (pkg.author && typeof pkg.author === "object" && pkg.author.name)
    return pkg.author.name;
  return "Unknown";
}

function getAppSettings() {
  const current = settingsStore.store || {};
  const merged = {
    launchAtLogin: Boolean(current.launchAtLogin),
    showMenubarIcon: Boolean(current.showMenubarIcon),
    showDockIcon: Boolean(current.showDockIcon),
    closeToTray: Boolean(current.closeToTray),
  };

  // Prevent users from hiding both dock + menubar icons on macOS (they'd lose access).
  if (
    process.platform === "darwin" &&
    !merged.showDockIcon &&
    !merged.showMenubarIcon
  ) {
    merged.showDockIcon = true;
  }

  return merged;
}

function applyAppSettings() {
  const settings = getAppSettings();

  // Persist any sanitization.
  settingsStore.set(settings);

  // Launch at login (macOS / Windows supported by Electron).
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    } catch (err) {
      console.error("Failed to update launchAtLogin:", err?.message);
    }
  }

  // Dock icon (macOS only).
  if (process.platform === "darwin" && app.dock) {
    if (settings.showDockIcon) app.dock.show();
    else app.dock.hide();
  }

  // Menubar (tray) icon.
  if (settings.showMenubarIcon) {
    if (!tray && mainWindow) createTray();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
}

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
let isQuitting = false;

function createWindow() {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: APP_NAME,
    icon: iconPath || undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
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

  mainWindow.on("close", (event) => {
    if (isQuitting) return;

    const settings = getAppSettings();
    const canHide =
      settings.showMenubarIcon ||
      (process.platform === "darwin" && settings.showDockIcon);

    if (settings.closeToTray && canHide) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPaths = getTrayIconPaths();
  const iconPath =
    process.platform === "darwin" && iconPaths.retina
      ? iconPaths.retina
      : iconPaths.base || iconPaths.retina;
  const nImg = iconPath
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  if (process.platform === "darwin") nImg.setTemplateImage(true);
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

function setDockIcon() {
  if (process.platform !== "darwin" || !app.dock) return;
  const iconPath = getAppIconPath();
  if (!iconPath) return;

  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  } catch (err) {
    console.error("Failed to set dock icon:", err?.message);
  }
}

function configureAboutPanel() {
  const iconPath = getAppIconPath();
  const author = getAuthorName();
  const hasAuthor = Boolean(author) && author !== "Unknown";
  const credits =
    [WEBSITE_URL, hasAuthor ? `Author: ${author}` : null]
      .filter(Boolean)
      .join("\n") || undefined;

  try {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: hasAuthor
        ? `© ${new Date().getFullYear()} ${author}`
        : undefined,
      credits,
      ...(process.platform !== "darwin" ? { iconPath: iconPath || undefined } : {}),
      ...(process.platform === "linux"
        ? { website: WEBSITE_URL, authors: hasAuthor ? [author] : undefined }
        : {}),
    });
  } catch (err) {
    console.error("Failed to set About panel options:", err?.message);
  }
}

function createAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: `${APP_NAME} Website`,
          click: async () => {
            await shell.openExternal(WEBSITE_URL);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createAppMenu();
  configureAboutPanel();
  setDockIcon();
  createWindow();
  applyAppSettings();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      applyAppSettings();
      return;
    }
    if (mainWindow) mainWindow.show();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
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

ipcMain.handle("settings:get", async () => {
  return getAppSettings();
});

ipcMain.handle("settings:set", async (event, updates) => {
  const allowedKeys = [
    "launchAtLogin",
    "showMenubarIcon",
    "showDockIcon",
    "closeToTray",
  ];
  const safeUpdates = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(updates || {}, key)) {
      safeUpdates[key] = Boolean(updates[key]);
    }
  }

  settingsStore.set(safeUpdates);
  applyAppSettings();

  return getAppSettings();
});
