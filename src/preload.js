const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("angler", {
  getState: () => ipcRenderer.invoke("state:get"),
  chooseGameFolder: () => ipcRenderer.invoke("game-folder:choose"),
  chooseModFolders: () => ipcRenderer.invoke("mods:choose-folders"),
  chooseModZips: () => ipcRenderer.invoke("mods:choose-zips"),
  importPaths: (paths) => ipcRenderer.invoke("mods:import", paths),
  setEnabled: (id, enabled) => ipcRenderer.invoke("mods:set-enabled", { id, enabled }),
  removeMod: (id) => ipcRenderer.invoke("mods:remove", id),
  applyEnabled: () => ipcRenderer.invoke("mods:apply"),
  applyAndPlay: () => ipcRenderer.invoke("mods:apply-play"),
  copyLaunchOptions: () => ipcRenderer.invoke("launch-options:copy"),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
