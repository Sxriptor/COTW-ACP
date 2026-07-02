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

contextBridge.exposeInMainWorld("profiles", {
  switch: (id)         => ipcRenderer.invoke("profiles:switch", id),
  create: (name)       => ipcRenderer.invoke("profiles:create", name),
  rename: (id, name)   => ipcRenderer.invoke("profiles:rename", { id, name }),
  delete: (id)         => ipcRenderer.invoke("profiles:delete", id),
});

contextBridge.exposeInMainWorld("appSettings", {
  get:            () => ipcRenderer.invoke("settings:get"),
  setTray:        (v) => ipcRenderer.invoke("settings:set-tray", v),
  setOverlayEnabled: (v) => ipcRenderer.invoke("settings:set-overlay-enabled", v),
  setOverlayHotkey:  (v) => ipcRenderer.invoke("settings:set-overlay-hotkey", v),
  onTrayChanged:  (cb) => ipcRenderer.on("settings:tray-changed", (_, v) => cb(v)),
});

contextBridge.exposeInMainWorld("overlay", {
  toggle: () => ipcRenderer.invoke("overlay:toggle"),
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
