const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const https = require("https");

const STEAM_APP_ID = "1408610";

// Cheat Engine executable candidates (first existing one wins). ACM's own
// downloaded copy under userData is checked too (see cheatEngineDownloadDir).
const CE_EXE_NAMES = [
  "cheatengine-x86_64.exe",
  "cheatengine-x86_64-SSE4-AVX2.exe",
  "cheatengine-i386.exe",
  "Cheat Engine.exe",
];
// Official Cheat Engine installer (used only if CE isn't already installed).
const CE_DOWNLOAD_URL = "https://github.com/cheat-engine/cheat-engine/releases/download/7.5/CheatEngine75.exe";
const LAUNCH_OPTIONS = "--vfs-fs mods --vfs-archive archives_win64";
const SPLASH_MIN_DURATION_MS = 3000;

let mainWindow;
let tray = null;
let isQuitting = false;
let appSettings;
let settingsPath;
let splashWindow;
let overlayWindow;
let splashShownAt = 0;
let mainWindowRevealPending = false;
let dataRoot;
let libraryRoot;
let statePath;
let manifestPath;
let state;

const DEFAULT_OVERLAY_SETTINGS = {
  trayBehavior: "ask",
  overlayEnabled: false,
  overlayHotkey: "F8",
};

const ALLOWED_OVERLAY_HOTKEYS = new Set(["F6", "F7", "F8", "F9", "F10", "F11", "F12"]);

function getSplashVideoPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "splash.mp4")
    : path.join(app.getAppPath(), "public", "splash.mp4");
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow;
  }

  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 760,
    height: 460,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  const videoPath = getSplashVideoPath();
  const videoUrl = fs.existsSync(videoPath) ? pathToFileURL(videoPath).href : "";
  splashWindow.loadFile(path.join(__dirname, "splash.html"), {
    query: { video: videoUrl },
  }).catch(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });

  return splashWindow;
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function revealMainWindowAfterSplash() {
  if (mainWindowRevealPending) {
    return;
  }

  mainWindowRevealPending = true;
  const elapsedMs = Date.now() - splashShownAt;
  const remainingMs = Math.max(0, SPLASH_MIN_DURATION_MS - elapsedMs);

  setTimeout(() => {
    closeSplashWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
    mainWindowRevealPending = false;
  }, remainingMs);
}

function createWindow() {
  Menu.setApplicationMenu(null);
  createSplashWindow();

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    show: false,
    backgroundColor: "#111111",
    icon: path.join(__dirname, "../public/logo.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.once("did-finish-load", () => {
    revealMainWindowAfterSplash();
  });

  mainWindow.webContents.once("did-fail-load", () => {
    revealMainWindowAfterSplash();
  });

  // Safety fallback: close splash after 30s even if the page never fires did-finish-load
  setTimeout(() => {
    if (!mainWindowRevealPending) {
      revealMainWindowAfterSplash();
    }
  }, 30000);

  mainWindow.on("close", async (event) => {
    if (isQuitting) return;
    event.preventDefault();

    const behavior = appSettings.trayBehavior;

    if (behavior === "tray") {
      mainWindow.hide();
      return;
    }

    if (behavior === "quit") {
      isQuitting = true;
      app.quit();
      return;
    }

    // "ask" — first time only
    const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
      type:            "question",
      title:           "Angler CM",
      message:         "What should happen when you close the window?",
      detail:          "You can change this anytime in Settings.",
      buttons:         ["Minimize to Tray", "Quit"],
      defaultId:       0,
      cancelId:        1,
      checkboxLabel:   "Remember my choice — don't ask again",
      checkboxChecked: false,
    });

    const chosen = response === 0 ? "tray" : "quit";

    if (checkboxChecked) {
      appSettings.trayBehavior = chosen;
      saveSettings();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("settings:tray-changed", chosen);
      }
    }

    if (chosen === "tray") {
      mainWindow.hide();
    } else {
      isQuitting = true;
      app.quit();
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  if (app.isPackaged) {
    setupAutoUpdater();
  }
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 320,
    height: 220,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  positionOverlayWindow();
  return overlayWindow;
}

function positionOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }
  const display = screen.getPrimaryDisplay();
  const bounds = display.workArea;
  const size = overlayWindow.getBounds();
  overlayWindow.setBounds({
    x: Math.round(bounds.x + bounds.width - size.width - 24),
    y: Math.round(bounds.y + bounds.height - size.height - 24),
    width: size.width,
    height: size.height,
  });
}

function toggleOverlayWindow() {
  const win = createOverlayWindow();
  positionOverlayWindow();
  if (win.isVisible()) {
    win.hide();
  } else {
    win.showInactive();
  }
}

function normalizeOverlayHotkey(value) {
  const candidate = String(value || "").trim().toUpperCase();
  return ALLOWED_OVERLAY_HOTKEYS.has(candidate) ? candidate : DEFAULT_OVERLAY_SETTINGS.overlayHotkey;
}

function registerOverlayShortcut() {
  globalShortcut.unregisterAll();
  if (!appSettings.overlayEnabled) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
    return true;
  }
  const accelerator = normalizeOverlayHotkey(appSettings.overlayHotkey);
  appSettings.overlayHotkey = accelerator;
  return globalShortcut.register(accelerator, toggleOverlayWindow);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow.webContents.send("update:available", { version: info.version, notes: info.releaseNotes });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow.webContents.send("update:progress", {
      percent:      Math.floor(progress.percent),
      transferred:  progress.transferred,
      total:        progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow.webContents.send("update:downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    // silent — don't nag the user if update check fails
    console.error("Updater error:", err.message);
  });

  // Check on launch, then every 2 hours
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  dataRoot = path.join(app.getPath("userData"), "data");
  libraryRoot = path.join(dataRoot, "mods");
  statePath = path.join(dataRoot, "state.json");
  manifestPath = path.join(dataRoot, "installed-files.json");
  settingsPath = path.join(dataRoot, "settings.json");
  fs.mkdirSync(libraryRoot, { recursive: true });
  state = loadJson(statePath, { gameFolder: "", mods: [] });
  appSettings = { ...DEFAULT_OVERLAY_SETTINGS, ...loadJson(settingsPath, DEFAULT_OVERLAY_SETTINGS) };
  appSettings.overlayHotkey = normalizeOverlayHotkey(appSettings.overlayHotkey);
  initProfiles();

  if (!isGameFolder(state.gameFolder)) {
    const detected = detectGameFolder();
    if (detected) {
      state.gameFolder = detected;
      saveState();
    }
  }
  ensureModsFolderIfReady();

  registerIpc();
  createWindow();
  createTray();
  registerOverlayShortcut();
});

app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); });

app.on("window-all-closed", () => {
  // Stay alive in tray; only quit if explicitly quitting or no tray
  if (process.platform !== "darwin" && (isQuitting || !tray)) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function registerIpc() {
  ipcMain.handle("settings:get", () => ({
    trayBehavior: appSettings.trayBehavior,
    overlayEnabled: !!appSettings.overlayEnabled,
    overlayHotkey: normalizeOverlayHotkey(appSettings.overlayHotkey),
  }));
  ipcMain.handle("settings:set-tray", (_, value) => {
    appSettings.trayBehavior = value;
    saveSettings();
  });
  ipcMain.handle("settings:set-overlay-enabled", (_, value) => {
    appSettings.overlayEnabled = !!value;
    const registered = registerOverlayShortcut();
    saveSettings();
    return {
      ok: registered,
      overlayEnabled: appSettings.overlayEnabled,
      overlayHotkey: appSettings.overlayHotkey,
    };
  });
  ipcMain.handle("settings:set-overlay-hotkey", (_, value) => {
    const previous = appSettings.overlayHotkey;
    appSettings.overlayHotkey = normalizeOverlayHotkey(value);
    const registered = registerOverlayShortcut();
    if (!registered) {
      appSettings.overlayHotkey = previous;
      registerOverlayShortcut();
    }
    saveSettings();
    return {
      ok: registered,
      overlayEnabled: appSettings.overlayEnabled,
      overlayHotkey: appSettings.overlayHotkey,
    };
  });
  ipcMain.handle("overlay:toggle", () => {
    toggleOverlayWindow();
    return {
      visible: !!overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible(),
    };
  });

  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate().catch(() => {}));
  ipcMain.handle("update:install",  () => autoUpdater.quitAndInstall());

  ipcMain.handle("window:minimize",     () => mainWindow.minimize());
  ipcMain.handle("window:maximize",     () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); return mainWindow.isMaximized(); });
  ipcMain.handle("window:close",        () => mainWindow.close());
  ipcMain.handle("window:is-maximized", () => mainWindow.isMaximized());

  ipcMain.handle("state:get", () => publicState());

  ipcMain.handle("game-folder:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose The Angler install folder",
      properties: ["openDirectory"],
      defaultPath: isGameFolder(state.gameFolder) ? state.gameFolder : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return publicState();
    const chosen = result.filePaths[0];
    if (!isGameFolder(chosen)) {
      throw new Error("That folder does not contain archives_win64. Pick the game install folder.");
    }
    state.gameFolder = chosen;
    ensureModsFolderIfReady();
    saveState();
    return publicState();
  });

  ipcMain.handle("mods:choose-folders", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose mod folder",
      properties: ["openDirectory", "multiSelections"],
    });
    if (!result.canceled) importPaths(result.filePaths);
    return publicState();
  });

  ipcMain.handle("mods:choose-zips", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose mod zip",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Zip files", extensions: ["zip"] }],
    });
    if (!result.canceled) importPaths(result.filePaths);
    return publicState();
  });

  ipcMain.handle("mods:import", (_event, paths) => {
    importPaths(Array.isArray(paths) ? paths : []);
    return publicState();
  });

  ipcMain.handle("mods:set-enabled", (_event, payload) => {
    const profile = getActiveProfile();
    if (profile) {
      if (payload.enabled) {
        if (!profile.enabledMods.includes(payload.id)) profile.enabledMods.push(payload.id);
      } else {
        profile.enabledMods = profile.enabledMods.filter((id) => id !== payload.id);
      }
      saveState();
    }
    return publicState();
  });

  ipcMain.handle("mods:remove", (_event, id) => {
    const mod = state.mods.find((item) => item.id === id);
    if (mod) {
      state.mods = state.mods.filter((item) => item.id !== id);
      for (const profile of state.profiles) {
        profile.enabledMods = profile.enabledMods.filter((eid) => eid !== id);
      }
      fs.rmSync(modPath(mod), { recursive: true, force: true });
      saveState();
      autoApplyIfReady();
    }
    return publicState();
  });

  ipcMain.handle("profiles:switch", (_event, id) => {
    if (state.profiles.some((p) => p.id === id)) {
      state.activeProfileId = id;
      saveState();
    }
    return publicState();
  });

  ipcMain.handle("profiles:create", (_event, name) => {
    if (state.profiles.length >= 3) throw new Error("Maximum of 3 profiles allowed.");
    const profile = {
      id: crypto.randomUUID(),
      name: (name && name.trim()) || `Profile ${state.profiles.length + 1}`,
      enabledMods: [],
    };
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    saveState();
    return publicState();
  });

  ipcMain.handle("profiles:rename", (_event, { id, name }) => {
    const profile = state.profiles.find((p) => p.id === id);
    if (profile && name && name.trim()) {
      profile.name = name.trim();
      saveState();
    }
    return publicState();
  });

  ipcMain.handle("profiles:delete", (_event, id) => {
    if (state.profiles.length <= 1) throw new Error("Cannot delete the last profile.");
    state.profiles = state.profiles.filter((p) => p.id !== id);
    if (state.activeProfileId === id) state.activeProfileId = state.profiles[0].id;
    saveState();
    return publicState();
  });

  ipcMain.handle("mods:apply", () => {
    applyEnabledMods();
    return publicState();
  });

  ipcMain.handle("mods:apply-play", () => {
    applyEnabledMods();
    shell.openExternal(`steam://run/${STEAM_APP_ID}`);
    return publicState();
  });

  ipcMain.handle("launch-options:copy", () => {
    clipboard.writeText(LAUNCH_OPTIONS);
    return LAUNCH_OPTIONS;
  });

  // ---- Fast-Travel Unlock (Cheat Engine memory mod) ----
  ipcMain.handle("fasttravel:status", () => fasttravelStatus());
  ipcMain.handle("fasttravel:start", () => startFastTravel());
  ipcMain.handle("fasttravel:stop", () => stopFastTravel());
  ipcMain.handle("fasttravel:download-ce", (event) => downloadCheatEngine(event));
}

// ============================ Fast-Travel Unlock ============================
// A Cheat Engine table (fasttravel_unlock.CT) carries the auto-attach Lua mod.
// Launching CE with that table auto-runs it, so the user never touches the
// Lua Engine. ON/OFF is controlled by writing "1"/"0" to a small shared state
// file that the running Lua script polls every second — so toggling from
// ACM's main window OR the in-game overlay button is instant and doesn't
// require relaunching Cheat Engine. CE is only ever launched once per
// session; after that we just flip the flag file.

let ceProcess = null;

function cheatEngineDownloadDir() {
  return path.join(dataRoot, "cheatengine");
}

// Shared with the .CT Lua script (same TEMP dir resolution on both sides).
function fasttravelStateFile() {
  return path.join(os.tmpdir(), "acm_fasttravel_state.txt");
}

function writeFasttravelState(on) {
  try { fs.writeFileSync(fasttravelStateFile(), on ? "1" : "0"); } catch (_) {}
}

function readFasttravelState() {
  try { return fs.readFileSync(fasttravelStateFile(), "utf8").trim() === "1"; } catch (_) { return false; }
}

// Best-effort check for whether a Cheat Engine process is alive, independent
// of whether *we* launched it (covers the user having it open already).
function isCheatEngineRunning() {
  if (ceProcess && !ceProcess.killed) return true;
  try {
    const out = require("child_process").execSync(
      'tasklist /FI "IMAGENAME eq cheatengine-x86_64.exe"', { encoding: "utf8" }
    );
    return /cheatengine/i.test(out);
  } catch (_) { return false; }
}

// Where ACM's own bundled copy of Cheat Engine lives (populated at build
// time by scripts/prepare-cheatengine.js from a trimmed local install).
function bundledCheatEngineDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "cheatengine")
    : path.join(app.getAppPath(), "resources", "cheatengine");
}

// Finds a usable Cheat Engine executable. Prefers the user's own install (so
// their existing settings/tables/plugins keep working) and falls back to
// ACM's bundled copy, then to a copy ACM previously downloaded itself.
// Returns { path, source } or null if none found anywhere.
function findCheatEngine() {
  const pf   = process.env["ProgramFiles"]      || "C:/Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const roots = [
    { dir: path.join(pf,   "Cheat Engine"), source: "user" },
    { dir: path.join(pf86, "Cheat Engine"), source: "user" },
    { dir: bundledCheatEngineDir(),         source: "bundled" },
    { dir: cheatEngineDownloadDir(),        source: "downloaded" },
  ];
  for (const { dir, source } of roots) {
    for (const name of CE_EXE_NAMES) {
      const full = path.join(dir, name);
      try { if (fs.existsSync(full)) return { path: full, source }; } catch (_) {}
    }
  }
  return null;
}

function fasttravelTablePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "fasttravel_unlock.CT")
    : path.join(app.getAppPath(), "resources", "fasttravel_unlock.CT");
}

function fasttravelStatus() {
  const ceRunning = isCheatEngineRunning();
  const found = findCheatEngine();
  return {
    ceInstalled: !!found,
    cePath: found ? found.path : "",
    ceSource: found ? found.source : null, // "user" | "bundled" | "downloaded"
    ceRunning,
    tablePresent: fs.existsSync(fasttravelTablePath()),
    // "on" = the mod is actively revealing waypoints right now.
    on: ceRunning && readFasttravelState(),
  };
}

// Turns the mod ON. Launches Cheat Engine with the table the first time
// (auto-attaches, auto-runs); after that, just flips the shared flag so the
// already-running script picks it up within ~1s.
function startFastTravel() {
  writeFasttravelState(true);
  if (isCheatEngineRunning()) return { ok: true, on: true, launched: false };

  const found = findCheatEngine();
  if (!found) return { ok: false, error: "ce-not-found" };
  const table = fasttravelTablePath();
  if (!fs.existsSync(table)) return { ok: false, error: "table-missing" };
  try {
    ceProcess = spawn(found.path, [table], { detached: true, stdio: "ignore" });
    ceProcess.on("exit", () => { ceProcess = null; });
    ceProcess.unref();
    return { ok: true, on: true, launched: true };
  } catch (err) {
    ceProcess = null;
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Turns the mod OFF. Leaves Cheat Engine running (attached) so re-enabling
// is instant; the script itself re-locks only the points it revealed,
// leaving anything genuinely traveled-to untouched. We never touch save
// files or kill the process here.
function stopFastTravel() {
  writeFasttravelState(false);
  return { ok: true, on: false };
}

// Download the official Cheat Engine installer into ACM's data dir, then open
// it so the user can install (CE isn't distributed as a silent portable).
// Progress is streamed to the renderer via "fasttravel:download-progress".
function downloadCheatEngine(event) {
  return new Promise((resolve) => {
    const existing = findCheatEngine();
    if (existing) { resolve({ ok: true, alreadyInstalled: true, cePath: existing.path }); return; }

    const dir = cheatEngineDownloadDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const dest = path.join(dir, "CheatEngineInstaller.exe");
    const send = (p) => { try { event.sender.send("fasttravel:download-progress", p); } catch (_) {} };

    const get = (url, redirectsLeft) => {
      https.get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return get(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve({ ok: false, error: `http-${res.statusCode}` });
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total) send({ received, total, pct: Math.round((received / total) * 100) });
        });
        res.pipe(out);
        out.on("finish", () => out.close(() => {
          send({ received: total || received, total: total || received, pct: 100 });
          // Open the installer for the user to complete setup.
          shell.openPath(dest).catch(() => {});
          resolve({ ok: true, installer: dest });
        }));
        out.on("error", (err) => resolve({ ok: false, error: String(err.message || err) }));
      }).on("error", (err) => resolve({ ok: false, error: String(err.message || err) }));
    };
    get(CE_DOWNLOAD_URL, 5);
  });
}

function publicState() {
  const activeProfile = getActiveProfile();
  const enabledSet = new Set(activeProfile ? activeProfile.enabledMods : []);
  return {
    gameFolder: state.gameFolder || "",
    launchOptions: LAUNCH_OPTIONS,
    libraryRoot,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    mods: state.mods.map((mod) => ({
      ...mod,
      baseName: mod.baseName || mod.name,
      version:  mod.version  || 1,
      enabled:  enabledSet.has(mod.id),
      files: listModFiles(mod).slice(0, 250),
    })),
  };
}

function importPaths(paths) {
  let imported = 0;
  for (const inputPath of paths) {
    if (!inputPath || !fs.existsSync(inputPath)) continue;
    const stat = fs.statSync(inputPath);
    if (stat.isDirectory()) {
      importDirectory(inputPath);
      imported++;
    } else if (stat.isFile() && path.extname(inputPath).toLowerCase() === ".zip") {
      importZip(inputPath);
      imported++;
    }
  }
  if (imported > 0) {
    saveState();
    autoApplyIfReady();
  }
}

function importDirectory(sourcePath) {
  const payloadRoot = findPayloadRoot(sourcePath);
  const mod = createMod(path.basename(stripTrailingSlash(sourcePath)));
  fs.mkdirSync(modPath(mod), { recursive: true });
  copyDirectory(payloadRoot, modPath(mod));
  mod.fileCount = countFiles(modPath(mod));
  state.mods.push(mod);
  const profile = getActiveProfile();
  if (profile) profile.enabledMods.push(mod.id);
}

function importZip(zipPath) {
  const temp = path.join(os.tmpdir(), `angler-mod-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(temp, { recursive: true });
  try {
    new AdmZip(zipPath).extractAllTo(temp, true);
    const payloadRoot = findPayloadRoot(temp);
    const mod = createMod(path.basename(zipPath, path.extname(zipPath)));
    fs.mkdirSync(modPath(mod), { recursive: true });
    copyDirectory(payloadRoot, modPath(mod));
    mod.fileCount = countFiles(modPath(mod));
    state.mods.push(mod);
    const profile = getActiveProfile();
    if (profile) profile.enabledMods.push(mod.id);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function createMod(name) {
  const baseName = (name && name.trim()) ? name.trim() : "Unnamed Mod";

  const existingVersions = state.mods
    .filter((m) => (m.baseName || m.name) === baseName)
    .map((m) => m.version || 1);

  const version = existingVersions.length > 0
    ? Math.max(...existingVersions) + 1
    : 1;

  return {
    id: crypto.randomUUID(),
    name: baseName,
    baseName,
    version,
    enabled: true,
    fileCount: 0,
    importedAt: new Date().toISOString(),
  };
}

function applyEnabledMods() {
  if (!isGameFolder(state.gameFolder)) {
    throw new Error("Set the game folder first. It must contain archives_win64.");
  }

  const modsRoot = ensureModsFolderIfReady();

  const previous = loadJson(manifestPath, { files: [] });
  removePreviouslyInstalledFiles(modsRoot, previous.files || []);

  const activeProfile = getActiveProfile();
  const enabledSet = new Set(activeProfile ? activeProfile.enabledMods : []);
  const installed = [];
  for (const mod of state.mods.filter((item) => enabledSet.has(item.id))) {
    const root = modPath(mod);
    if (!fs.existsSync(root)) continue;
    for (const file of walkFiles(root)) {
      const relative = path.relative(root, file);
      const target = path.join(modsRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
      installed.push(relative.split(path.sep).join("/"));
    }
  }

  saveJson(manifestPath, { files: installed });
}

function autoApplyIfReady() {
  if (!isGameFolder(state.gameFolder)) return false;
  applyEnabledMods();
  return true;
}

function ensureModsFolderIfReady() {
  if (!isGameFolder(state.gameFolder)) return "";
  const modsRoot = path.join(state.gameFolder, "mods");
  fs.mkdirSync(modsRoot, { recursive: true });
  return modsRoot;
}

function removePreviouslyInstalledFiles(modsRoot, files) {
  const root = path.resolve(modsRoot);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const dirs = new Set();

  for (const stored of files) {
    const full = path.resolve(modsRoot, stored.split("/").join(path.sep));
    if (!full.startsWith(rootWithSep)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) fs.rmSync(full, { force: true });

    let dir = path.dirname(full);
    while (dir.startsWith(rootWithSep) && dir !== root) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }

  [...dirs].sort((a, b) => b.length - a.length).forEach((dir) => {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  });
}

function findPayloadRoot(root) {
  const directModsFolder = path.join(root, "mods");
  if (fs.existsSync(directModsFolder) && looksLikeModRoot(directModsFolder)) return directModsFolder;
  if (looksLikeModRoot(root)) return root;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (files.length === 0 && dirs.length === 1) {
    const nested = path.join(root, dirs[0].name);
    const nestedModsFolder = path.join(nested, "mods");
    if (fs.existsSync(nestedModsFolder) && looksLikeModRoot(nestedModsFolder)) return nestedModsFolder;
    if (looksLikeModRoot(nested)) return nested;
  }

  const discovered = findFirstModRoot(root, 4);
  if (discovered) return discovered;

  return root;
}

function findFirstModRoot(root, maxDepth) {
  const queue = [{ folder: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth > 0) {
      const modsFolder = path.join(current.folder, "mods");
      if (fs.existsSync(modsFolder) && looksLikeModRoot(modsFolder)) return modsFolder;
      if (looksLikeModRoot(current.folder)) return current.folder;
    }
    if (current.depth >= maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current.folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push({ folder: path.join(current.folder, entry.name), depth: current.depth + 1 });
    }
  }
  return "";
}

function looksLikeModRoot(candidate) {
  const roots = [
    "ai",
    "animations",
    "editor",
    "environment",
    "gdc",
    "global",
    "graphs",
    "locations",
    "models",
    "resourcesets",
    "settings",
    "tables",
    "text",
    "textures",
    "ui",
    "worlds",
    "__UNKNOWN",
    "game_data_tables",
  ];
  return roots.some((name) => fs.existsSync(path.join(candidate, name)));
}

function isGameFolder(candidate) {
  return !!candidate && fs.existsSync(path.join(candidate, "archives_win64"));
}

function detectGameFolder() {
  for (const steamRoot of candidateSteamRoots()) {
    const direct = folderFromManifest(path.join(steamRoot, "steamapps", `appmanifest_${STEAM_APP_ID}.acf`), steamRoot);
    if (isGameFolder(direct)) return direct;

    const librariesPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
    for (const library of parseSteamLibraries(librariesPath)) {
      const folder = folderFromManifest(path.join(library, "steamapps", `appmanifest_${STEAM_APP_ID}.acf`), library);
      if (isGameFolder(folder)) return folder;
    }
  }
  return "";
}

function candidateSteamRoots() {
  return [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Steam"),
  ];
}

function parseSteamLibraries(vdfPath) {
  if (!fs.existsSync(vdfPath)) return [];
  const text = fs.readFileSync(vdfPath, "utf8");
  const matches = [...text.matchAll(/"path"\s+"([^"]+)"/gi)];
  return matches.map((match) => match[1].replace(/\\\\/g, "\\"));
}

function folderFromManifest(manifestPath, libraryRoot) {
  if (!fs.existsSync(manifestPath)) return "";
  const text = fs.readFileSync(manifestPath, "utf8");
  const match = text.match(/"installdir"\s+"([^"]+)"/i);
  if (!match) return "";
  return path.join(libraryRoot, "steamapps", "common", match[1]);
}

function modPath(mod) {
  return path.join(libraryRoot, mod.id);
}

function listModFiles(mod) {
  const root = modPath(mod);
  if (!fs.existsSync(root)) return [];
  return walkFiles(root).map((file) => path.relative(root, file));
}

function copyDirectory(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDirectory(from, to);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function walkFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function countFiles(root) {
  return fs.existsSync(root) ? walkFiles(root).length : 0;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveState() {
  saveJson(statePath, state);
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function stripTrailingSlash(value) {
  return value.replace(/[\\/]+$/, "");
}

function createTray() {
  const iconPath = path.join(__dirname, "../public/logo.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Angler CM");

  tray.on("double-click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "Show Angler CM",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(menu);
}

function saveSettings() {
  saveJson(settingsPath, appSettings);
}

function getActiveProfile() {
  return state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0] || null;
}

function initProfiles() {
  if (!Array.isArray(state.profiles) || state.profiles.length === 0) {
    // Migrate: seed default profile from existing mod.enabled flags
    const enabledMods = state.mods.filter((m) => m.enabled).map((m) => m.id);
    state.profiles = [{ id: crypto.randomUUID(), name: "Default", enabledMods }];
  }
  if (!state.activeProfileId || !state.profiles.some((p) => p.id === state.activeProfileId)) {
    state.activeProfileId = state.profiles[0].id;
  }
  saveState();
}
