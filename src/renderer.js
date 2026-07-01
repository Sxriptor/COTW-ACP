let currentState = null;
let selectedModId = null;
let activeView = "mods";
let sortAlpha = false;
let recentlyAdded = new Set();
let knownModIds = null; // null = first load, Set after

const el = {
  gameFolder:        document.getElementById("game-folder-label"),
  dropZone:          document.getElementById("drop-zone"),
  modList:           document.getElementById("mod-list"),
  details:           document.getElementById("details"),
  status:            document.getElementById("status"),
  setGameFolder:     document.getElementById("set-game-folder"),
  copyLaunchOptions: document.getElementById("copy-launch-options"),
  launchBtn:         document.getElementById("launch-btn"),
  addFolder:         document.getElementById("add-folder"),
  addZip:            document.getElementById("add-zip"),
  removeMod:         document.getElementById("remove-mod"),
  sidebar:           document.getElementById("sidebar"),
  collapseBtn:       document.getElementById("collapse-btn"),
  settingsGameFolder:document.getElementById("settings-game-folder"),
  settingsLaunchOpts:document.getElementById("settings-launch-opts"),
  helpLaunchOpts:    document.getElementById("help-launch-opts"),
};

wireEvents();
refresh();

function wireEvents() {
  // Launch
  el.launchBtn.addEventListener("click", () => run("Mods applied. Launching Steam.", () => window.angler.applyAndPlay()));

  // Mod view
  el.addFolder.addEventListener("click", () => run("Mod folder imported.", () => window.angler.chooseModFolders()));
  el.addZip.addEventListener("click",    () => run("Mod zip imported.",    () => window.angler.chooseModZips()));
  el.removeMod.addEventListener("click", () => {
    if (!selectedModId) return;
    run("Mod removed.", () => window.angler.removeMod(selectedModId));
  });

  // Drop — whole window is a drop target
  const appShell = document.querySelector(".app-shell");
  let dragDepth = 0;

  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    appShell.classList.add("drag-over");
    el.dropZone.classList.add("dragging");
  });

  document.addEventListener("dragover", (e) => e.preventDefault());

  document.addEventListener("dragleave", () => {
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      appShell.classList.remove("drag-over");
      el.dropZone.classList.remove("dragging");
    }
  });

  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragDepth = 0;
    appShell.classList.remove("drag-over");
    el.dropZone.classList.remove("dragging");
    const paths = [...e.dataTransfer.files].map((f) => window.angler.pathForFile(f)).filter(Boolean);
    if (paths.length > 0) await run("Mod(s) imported.", () => window.angler.importPaths(paths));
  });

  // Settings view
  el.setGameFolder.addEventListener("click",     () => run("Game folder set.", () => window.angler.chooseGameFolder()));
  el.copyLaunchOptions.addEventListener("click", () => run("Launch options copied.", () => window.angler.copyLaunchOptions()));

  // Sidebar nav
  for (const item of document.querySelectorAll(".nav-item[data-view]")) {
    item.addEventListener("click", () => switchView(item.dataset.view));
  }

  // Sort toggle
  document.getElementById("sort-toggle").addEventListener("click", () => {
    sortAlpha = !sortAlpha;
    document.getElementById("sort-toggle").classList.toggle("active", sortAlpha);
    render();
  });

  // Sidebar collapse
  el.collapseBtn.addEventListener("click", () => el.sidebar.classList.toggle("collapsed"));

  // Auto-updater overlay
  const overlay     = document.getElementById("update-overlay");
  const updateVer   = document.getElementById("update-version");
  const progressWrap= document.getElementById("update-progress-wrap");
  const progressFill= document.getElementById("update-progress-fill");
  const progressText= document.getElementById("update-progress-text");
  const updateAction= document.getElementById("update-action");
  const updateTitle = overlay.querySelector(".update-title");

  window.updater.onAvailable((info) => {
    updateVer.textContent = `v${info.version} is ready to download`;
    overlay.classList.remove("hidden");
  });

  window.updater.onProgress((p) => {
    progressWrap.classList.remove("hidden");
    progressFill.style.width = `${p.percent}%`;
    progressText.textContent = `${p.percent}%`;
    updateAction.disabled = true;
    updateAction.textContent = "Downloading…";
    updateTitle.textContent = "Downloading Update";
  });

  window.updater.onDownloaded((info) => {
    updateTitle.textContent = "Ready to Install";
    updateVer.textContent = `v${info.version} downloaded`;
    progressWrap.classList.add("hidden");
    updateAction.disabled = false;
    updateAction.textContent = "Restart & Install";
    updateAction.onclick = () => window.updater.install();
  });

  updateAction.addEventListener("click", () => window.updater.download());
  document.getElementById("update-dismiss").addEventListener("click", () => overlay.classList.add("hidden"));

  // Window controls
  document.getElementById("win-minimize").addEventListener("click", () => window.win.minimize());
  document.getElementById("win-maximize").addEventListener("click", async () => {
    const maximized = await window.win.maximize();
    const icon = document.querySelector("#win-maximize svg rect");
    if (icon) icon.setAttribute("y", maximized ? "3" : ".5");
  });
  document.getElementById("win-close").addEventListener("click", () => window.win.close());
}

function switchView(name) {
  activeView = name;
  for (const item of document.querySelectorAll(".nav-item[data-view]")) {
    item.classList.toggle("active", item.dataset.view === name);
  }
  for (const view of document.querySelectorAll(".view")) {
    view.classList.toggle("active", view.id === `view-${name}`);
  }
}

async function refresh() {
  currentState = await window.angler.getState();
  knownModIds = new Set(currentState.mods.map((m) => m.id));
  render();
}

async function run(successText, action) {
  try {
    const result = await action();
    if (result && result.mods) currentState = result;
    else currentState = await window.angler.getState();
    trackNewMods();
    setStatus(successText);
    render();
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
}

function trackNewMods() {
  if (knownModIds === null) {
    knownModIds = new Set(currentState.mods.map((m) => m.id));
    return;
  }
  for (const mod of currentState.mods) {
    if (!knownModIds.has(mod.id)) {
      recentlyAdded.add(mod.id);
      knownModIds.add(mod.id);
    }
  }
  // clean up removed mods
  for (const id of knownModIds) {
    if (!currentState.mods.some((m) => m.id === id)) knownModIds.delete(id);
  }
  for (const id of recentlyAdded) {
    if (!currentState.mods.some((m) => m.id === id)) recentlyAdded.delete(id);
  }
}

function render() {
  // Topbar path
  el.gameFolder.textContent = currentState.gameFolder || "Game folder not set";

  // Settings view
  el.settingsGameFolder.textContent = currentState.gameFolder || "Not set";
  el.settingsLaunchOpts.textContent = currentState.launchOptions;

  // Help view
  el.helpLaunchOpts.textContent = currentState.launchOptions;

  // Mod list
  el.modList.innerHTML = "";

  if (currentState.mods.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<img class="empty-icon" src="../public/logo.png" alt=""/><div>No mods installed</div><div style="font-size:11px;margin-top:2px;color:var(--muted)">Drop a folder or .zip above to get started</div>`;
    el.modList.append(empty);
  } else {
    const groups = buildModGroups(currentState.mods);
    for (const group of groups) {
      if (group.label) {
        const header = document.createElement("div");
        header.className = "mod-section-label";
        header.textContent = group.label;
        el.modList.append(header);
      }
      for (const mod of group.mods) {
        el.modList.append(buildModRow(mod));
      }
    }
  }

  if (selectedModId && !currentState.mods.some((m) => m.id === selectedModId)) {
    selectedModId = null;
  }

  const selected = currentState.mods.find((m) => m.id === selectedModId);
  el.removeMod.disabled = !selected;
  el.details.textContent = selected ? selectedDetails(selected) : defaultDetails();
}

function buildModGroups(mods) {
  const alpha = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  if (sortAlpha) {
    return [{ label: null, mods: [...mods].sort(alpha) }];
  }

  const recent = mods.filter((m) => recentlyAdded.has(m.id));
  const rest   = mods.filter((m) => !recentlyAdded.has(m.id)).sort(alpha);

  if (recent.length === 0) return [{ label: null, mods: rest }];

  return [
    { label: "Recently Added", mods: recent },
    { label: "All Mods",       mods: rest },
  ];
}

function buildModRow(mod) {
  const row = document.createElement("div");
  row.className = `mod-row${mod.id === selectedModId ? " selected" : ""}`;
  row.addEventListener("click", () => { selectedModId = mod.id; render(); });

  const label = document.createElement("label");
  label.className = "toggle";
  label.addEventListener("click", (e) => e.stopPropagation());

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = mod.enabled;
  checkbox.addEventListener("change", () =>
    run("Mod saved — click Apply to deploy.", () => window.angler.setEnabled(mod.id, checkbox.checked))
  );

  const track = document.createElement("span");
  track.className = "toggle-track";
  label.append(checkbox, track);

  const name = document.createElement("div");
  name.className = "mod-name";
  name.textContent = mod.name;

  const count = document.createElement("div");
  count.className = "mod-count";
  count.textContent = `${mod.fileCount} file${mod.fileCount === 1 ? "" : "s"}`;

  row.append(label, name, count);
  return row;
}

function selectedDetails(mod) {
  return [
    `Name:     ${mod.name}`,
    `Enabled:  ${mod.enabled ? "yes" : "no"}`,
    `Files:    ${mod.fileCount}`,
    `Imported: ${mod.importedAt || ""}`,
    "",
    "Files:",
    ...(mod.files && mod.files.length ? mod.files : ["(none)"]),
  ].join("\n");
}

function defaultDetails() {
  return "Select a mod to see details.";
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("error", isError);
}
