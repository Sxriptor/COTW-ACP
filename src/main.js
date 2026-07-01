const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

const STEAM_APP_ID = "1408610";
const LAUNCH_OPTIONS = "--vfs-fs mods --vfs-archive archives_win64";

let mainWindow;
let dataRoot;
let libraryRoot;
let statePath;
let manifestPath;
let state;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#111418",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  dataRoot = path.join(app.getPath("userData"), "data");
  libraryRoot = path.join(dataRoot, "mods");
  statePath = path.join(dataRoot, "state.json");
  manifestPath = path.join(dataRoot, "installed-files.json");
  fs.mkdirSync(libraryRoot, { recursive: true });
  state = loadJson(statePath, { gameFolder: "", mods: [] });

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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function registerIpc() {
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
    const mod = state.mods.find((item) => item.id === payload.id);
    if (mod) {
      mod.enabled = !!payload.enabled;
      saveState();
      autoApplyIfReady();
    }
    return publicState();
  });

  ipcMain.handle("mods:remove", (_event, id) => {
    const mod = state.mods.find((item) => item.id === id);
    if (mod) {
      state.mods = state.mods.filter((item) => item.id !== id);
      fs.rmSync(modPath(mod), { recursive: true, force: true });
      saveState();
      autoApplyIfReady();
    }
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
}

function publicState() {
  return {
    gameFolder: state.gameFolder || "",
    launchOptions: LAUNCH_OPTIONS,
    libraryRoot,
    mods: state.mods.map((mod) => ({
      ...mod,
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
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function createMod(name) {
  return {
    id: crypto.randomUUID(),
    name: name && name.trim() ? name.trim() : "Unnamed Mod",
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

  const installed = [];
  for (const mod of state.mods.filter((item) => item.enabled)) {
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
