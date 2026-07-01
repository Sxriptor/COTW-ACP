const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("angler", {
  getState:          () => ipcRenderer.invoke("state:get"),
  chooseGameFolder:  () => ipcRenderer.invoke("game-folder:choose"),
  chooseModFolders:  () => ipcRenderer.invoke("mods:choose-folders"),
  chooseModZips:     () => ipcRenderer.invoke("mods:choose-zips"),
  importPaths:       (paths) => ipcRenderer.invoke("mods:import", paths),
  setEnabled:        (id, enabled) => ipcRenderer.invoke("mods:set-enabled", { id, enabled }),
  removeMod:         (id) => ipcRenderer.invoke("mods:remove", id),
  applyEnabled:      () => ipcRenderer.invoke("mods:apply"),
  applyAndPlay:      () => ipcRenderer.invoke("mods:apply-play"),
  copyLaunchOptions: () => ipcRenderer.invoke("launch-options:copy"),
  pathForFile:       (file) => webUtils.getPathForFile(file),
});

contextBridge.exposeInMainWorld("appSettings", {
  get:            () => ipcRenderer.invoke("settings:get"),
  setTray:        (v) => ipcRenderer.invoke("settings:set-tray", v),
  onTrayChanged:  (cb) => ipcRenderer.on("settings:tray-changed", (_, v) => cb(v)),
});

contextBridge.exposeInMainWorld("updater", {
  onAvailable:  (cb) => ipcRenderer.on("update:available",  (_, info) => cb(info)),
  onProgress:   (cb) => ipcRenderer.on("update:progress",   (_, p)    => cb(p)),
  onDownloaded: (cb) => ipcRenderer.on("update:downloaded", (_, info) => cb(info)),
  download: () => ipcRenderer.invoke("update:download"),
  install:  () => ipcRenderer.invoke("update:install"),
});

contextBridge.exposeInMainWorld("win", {
  minimize:    () => ipcRenderer.invoke("window:minimize"),
  maximize:    () => ipcRenderer.invoke("window:maximize"),
  close:       () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
});
