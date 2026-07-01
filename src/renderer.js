let currentState = null;
let selectedModId = null;

const elements = {
  gameFolder: document.getElementById("game-folder-label"),
  dropZone: document.getElementById("drop-zone"),
  modList: document.getElementById("mod-list"),
  details: document.getElementById("details"),
  status: document.getElementById("status"),
  setGameFolder: document.getElementById("set-game-folder"),
  copyLaunchOptions: document.getElementById("copy-launch-options"),
  applyEnabled: document.getElementById("apply-enabled"),
  applyPlay: document.getElementById("apply-play"),
  addFolder: document.getElementById("add-folder"),
  addZip: document.getElementById("add-zip"),
  removeMod: document.getElementById("remove-mod"),
};

wireEvents();
refresh();

function wireEvents() {
  elements.setGameFolder.addEventListener("click", () => run("Game folder set.", () => window.angler.chooseGameFolder()));
  elements.addFolder.addEventListener("click", () => run("Mod folder imported.", () => window.angler.chooseModFolders()));
  elements.addZip.addEventListener("click", () => run("Mod zip imported.", () => window.angler.chooseModZips()));
  elements.copyLaunchOptions.addEventListener("click", () => run("Launch options copied.", () => window.angler.copyLaunchOptions()));
  elements.applyEnabled.addEventListener("click", () => run("Enabled mods applied.", () => window.angler.applyEnabled()));
  elements.applyPlay.addEventListener("click", () => run("Enabled mods applied. Starting Steam.", () => window.angler.applyAndPlay()));
  elements.removeMod.addEventListener("click", () => {
    if (!selectedModId) return;
    run("Mod removed from library.", () => window.angler.removeMod(selectedModId));
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, () => {
      elements.dropZone.classList.remove("dragging");
    });
  }

  elements.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    const paths = [...event.dataTransfer.files]
      .map((file) => window.angler.pathForFile(file))
      .filter(Boolean);
    await run("Dropped mod(s) imported.", () => window.angler.importPaths(paths));
  });
}

async function refresh() {
  currentState = await window.angler.getState();
  render();
}

async function run(successText, action) {
  try {
    const result = await action();
    if (result && result.mods) currentState = result;
    else currentState = await window.angler.getState();
    setStatus(successText);
    render();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

function render() {
  elements.gameFolder.textContent = currentState.gameFolder || "Game folder not set";
  elements.modList.innerHTML = "";

  for (const mod of currentState.mods) {
    const row = document.createElement("div");
    row.className = `mod-row${mod.id === selectedModId ? " selected" : ""}`;
    row.addEventListener("click", () => {
      selectedModId = mod.id;
      render();
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = mod.enabled;
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => run("Mod toggle saved and applied.", () => window.angler.setEnabled(mod.id, checkbox.checked)));

    const name = document.createElement("div");
    name.className = "mod-name";
    name.textContent = mod.name;

    const count = document.createElement("div");
    count.className = "mod-count";
    count.textContent = `${mod.fileCount} file${mod.fileCount === 1 ? "" : "s"}`;

    row.append(checkbox, name, count);
    elements.modList.append(row);
  }

  if (selectedModId && !currentState.mods.some((mod) => mod.id === selectedModId)) {
    selectedModId = null;
  }

  const selected = currentState.mods.find((mod) => mod.id === selectedModId);
  elements.removeMod.disabled = !selected;
  elements.details.textContent = selected ? selectedDetails(selected) : defaultDetails();
}

function selectedDetails(mod) {
  const lines = [
    `Mod: ${mod.name}`,
    `Enabled: ${mod.enabled ? "yes" : "no"}`,
    `Files: ${mod.fileCount}`,
    `Imported: ${mod.importedAt || ""}`,
    "",
    "Stored files:",
    ...(mod.files && mod.files.length ? mod.files : ["(none)"]),
  ];
  return lines.join("\n");
}

function defaultDetails() {
  return [
    "How it works:",
    "1. Drop mod folders or .zip files into the app.",
    "2. Toggle the mods you want loaded. Toggles apply automatically when the game folder is known.",
    "3. Click Apply & Play to launch through Steam.",
    "",
    "Required Steam launch options:",
    currentState.launchOptions,
    "",
    "App library:",
    currentState.libraryRoot,
  ].join("\n");
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.style.color = isError ? "var(--danger)" : "var(--muted)";
}
