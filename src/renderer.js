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
  trayToggle:        document.getElementById("tray-toggle"),
  overlayToggle:     document.getElementById("overlay-toggle"),
  overlayHotkey:     document.getElementById("overlay-hotkey"),
  overlayPreview:    document.getElementById("overlay-preview"),
};

wireEvents();
refresh();
initSettings();

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

  el.overlayToggle.addEventListener("change", async () => {
    const result = await window.appSettings.setOverlayEnabled(el.overlayToggle.checked);
    if (!result.ok && el.overlayToggle.checked) {
      el.overlayToggle.checked = false;
      setStatus(`Could not register ${result.overlayHotkey}. Another app may already be using it.`, true);
      return;
    }
    setStatus(`Overlay ${result.overlayEnabled ? "enabled" : "disabled"}.`);
  });

  el.overlayHotkey.addEventListener("change", async () => {
    const result = await window.appSettings.setOverlayHotkey(el.overlayHotkey.value);
    el.overlayHotkey.value = result.overlayHotkey;
    if (!result.ok) {
      setStatus(`Could not register ${result.overlayHotkey}. Another app may already be using it.`, true);
      return;
    }
    setStatus(`Overlay hotkey set to ${result.overlayHotkey}.`);
  });

  el.overlayPreview.addEventListener("click", async () => {
    await window.overlay.toggle();
    setStatus("Overlay toggled.");
  });
}

function switchView(name) {
  activeView = name;
  for (const item of document.querySelectorAll(".nav-item[data-view]")) {
    item.classList.toggle("active", item.dataset.view === name);
  }
  for (const view of document.querySelectorAll(".view")) {
    view.classList.toggle("active", view.id === `view-${name}`);
  }
  if (name === "get-mods") renderGetModsList(); // refresh "Already in My Mods" badges
}

async function refresh() {
  currentState = await window.angler.getState();
  knownModIds = new Set(currentState.mods.map((m) => m.id));
  render();
}

async function initSettings() {
  const settings = await window.appSettings.get();
  el.trayToggle.checked = settings.trayBehavior === "tray";
  el.overlayToggle.checked = !!settings.overlayEnabled;
  el.overlayHotkey.value = settings.overlayHotkey || "F8";

  el.trayToggle.addEventListener("change", async () => {
    const next = el.trayToggle.checked ? "tray" : "quit";
    await window.appSettings.setTray(next);
    setStatus(el.trayToggle.checked ? "Closing now minimizes to tray." : "Closing now quits the app.");
  });

  window.appSettings.onTrayChanged((value) => {
    el.trayToggle.checked = value === "tray";
  });
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

  renderProfileBar();

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
    const versionGroups = buildVersionGroups(currentState.mods);
    const groups = buildModGroups(currentState.mods);
    for (const group of groups) {
      if (group.label) {
        const header = document.createElement("div");
        header.className = "mod-section-label";
        header.textContent = group.label;
        el.modList.append(header);
      }
      for (const mod of group.mods) {
        el.modList.append(buildModRow(mod, versionGroups));
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

function renderProfileBar() {
  const bar = document.getElementById("profile-bar");
  bar.innerHTML = "";

  const { profiles = [], activeProfileId } = currentState;

  for (const profile of profiles) {
    const tab = document.createElement("button");
    tab.className = `profile-tab${profile.id === activeProfileId ? " active" : ""}`;
    tab.dataset.id = profile.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "profile-name";
    nameSpan.textContent = profile.name;
    tab.append(nameSpan);

    // Delete button (only when multiple profiles)
    if (profiles.length > 1) {
      const del = document.createElement("span");
      del.className = "profile-del";
      del.textContent = "×";
      del.title = "Delete profile";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await run(`Profile "${profile.name}" deleted.`, () => window.profiles.delete(profile.id));
      });
      tab.append(del);
    }

    // Switch on click
    tab.addEventListener("click", () => {
      if (profile.id !== currentState.activeProfileId) {
        run(`Switched to "${profile.name}".`, () => window.profiles.switch(profile.id));
      }
    });

    // Inline rename on double-click
    tab.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.className = "profile-rename-input";
      input.value = profile.name;
      input.style.cssText = "width:80px;font:inherit;font-size:11.5px;background:transparent;border:none;outline:none;color:inherit;padding:0;";
      nameSpan.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const val = input.value.trim();
        if (val && val !== profile.name) {
          run(`Profile renamed to "${val}".`, () => window.profiles.rename(profile.id, val));
        } else {
          render(); // revert
        }
      };
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } if (ev.key === "Escape") render(); });
      input.addEventListener("blur", commit);
    });

    bar.append(tab);
  }

  // Add profile button (hidden when at max 3)
  if (profiles.length < 3) {
    const add = document.createElement("button");
    add.className = "profile-add";
    add.title = "New profile";
    add.textContent = "+";
    add.addEventListener("click", () => {
      const name = `Profile ${profiles.length + 1}`;
      run(`Profile "${name}" created.`, () => window.profiles.create(name));
    });
    bar.append(add);
  }
}

function buildVersionGroups(mods) {
  const counts = {};
  for (const mod of mods) {
    const base = mod.baseName || mod.name;
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
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

function buildModRow(mod, versionGroups = {}) {
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

  const nameArea = document.createElement("div");
  nameArea.className = "mod-name-area";

  const name = document.createElement("div");
  name.className = "mod-name";
  name.textContent = mod.name;
  nameArea.append(name);

  const base = mod.baseName || mod.name;
  if ((versionGroups[base] || 0) > 1) {
    const badge = document.createElement("span");
    badge.className = "mod-version";
    badge.textContent = `v${mod.version || 1}`;
    nameArea.append(badge);
  }

  const count = document.createElement("div");
  count.className = "mod-count";
  count.textContent = `${mod.fileCount} file${mod.fileCount === 1 ? "" : "s"}`;

  row.append(label, nameArea, count);
  return row;
}

function selectedDetails(mod) {
  const versionGroups = buildVersionGroups(currentState.mods);
  const base = mod.baseName || mod.name;
  const totalVersions = versionGroups[base] || 1;

  return [
    `Name:     ${mod.name}`,
    totalVersions > 1 ? `Version:  v${mod.version || 1} of ${totalVersions}` : null,
    `Enabled:  ${mod.enabled ? "yes" : "no"}`,
    `Files:    ${mod.fileCount}`,
    `Imported: ${mod.importedAt || ""}`,
    "",
    "Files:",
    ...(mod.files && mod.files.length ? mod.files : ["(none)"]),
  ].filter((l) => l !== null).join("\n");
}

function defaultDetails() {
  return "Select a mod to see details.";
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("error", isError);
}

function ceSourceLabel(source) {
  if (source === "user") return "your installed Cheat Engine";
  if (source === "bundled") return "ACM's bundled Cheat Engine";
  if (source === "downloaded") return "the Cheat Engine ACM downloaded";
  return "Cheat Engine";
}

// ---- Get Mods (fetches releases from GitHub, one-click import) ----
const gm = {
  status: document.getElementById("get-mods-status"),
  list:   document.getElementById("get-mods-list"),
  refreshBtn: document.getElementById("get-mods-refresh"),
};

let getModsCache = [];
let downloadingTag = null;

function initGetMods() {
  if (!gm.list) return;
  gm.refreshBtn.addEventListener("click", () => loadGetMods(true));

  window.getMods.onDownloadProgress((p) => {
    if (!p || !downloadingTag) return;
    const card = gm.list.querySelector(`[data-tag="${cssEscape(downloadingTag)}"]`);
    if (!card) return;
    const fill = card.querySelector(".getmods-progress-fill");
    const text = card.querySelector(".getmods-progress-text");
    if (fill) fill.style.width = (p.pct || 0) + "%";
    if (text) text.textContent = (p.pct || 0) + "%";
  });

  loadGetMods(false);
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

async function loadGetMods(forceRefresh) {
  gm.status.textContent = "Loading…";
  const res = await window.getMods.fetchAvailable(!!forceRefresh);
  if (!res || !res.ok) {
    gm.status.textContent = "Couldn't load mods: " + ((res && res.error) || "unknown error");
    gm.list.innerHTML = "";
    return;
  }
  getModsCache = res.mods || [];
  gm.status.textContent = getModsCache.length
    ? `${getModsCache.length} mod${getModsCache.length === 1 ? "" : "s"} available.`
    : "No mods published yet.";
  renderGetModsList();
}

function importedVersionFor(modName) {
  if (!currentState) return null;
  const match = currentState.mods.find(
    (m) => (m.baseName || m.name || "").toLowerCase() === modName.toLowerCase()
  );
  return match ? match.version : null;
}

// ---- tiny, safe markdown-lite renderer for release-note excerpts ----
// Escapes HTML first, then applies a small readable subset (bold, italic,
// headings-as-bold, bullet lines, paragraphs) — plenty for a short excerpt.
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excerptReadme(body, maxLen = 260) {
  if (!body) return "";
  let text = body.replace(/^#{1,6}\s.*\r?\n+/, "").trim(); // drop a leading heading (redundant with card title)
  if (text.length > maxLen) {
    text = text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

function markdownLiteToHtml(md) {
  let html = escapeHtml(md);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
  html = html.replace(/^[-*]\s+(.+)$/gm, "• $1");
  html = html
    .split(/\r?\n\r?\n+/)
    .map((p) => `<p>${p.replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
  return html;
}

function renderGetModsList() {
  gm.list.innerHTML = "";
  for (const mod of getModsCache) {
    const card = document.createElement("div");
    card.className = "getmods-card";
    card.dataset.tag = mod.tag;

    const head = document.createElement("div");
    head.className = "getmods-card-head";
    const nameEl = document.createElement("strong");
    nameEl.textContent = mod.modName;
    const versionEl = document.createElement("span");
    versionEl.className = "getmods-version";
    versionEl.textContent = `v${mod.version}`;
    head.append(nameEl, versionEl);

    const meta = document.createElement("div");
    meta.className = "getmods-card-meta";
    const sizeStr = mod.size
      ? (mod.size >= 1024 * 1024 ? (mod.size / (1024 * 1024)).toFixed(1) + " MB" : Math.max(1, Math.round(mod.size / 1024)) + " KB")
      : "";
    const dateStr = mod.publishedAt ? new Date(mod.publishedAt).toLocaleDateString() : "";
    meta.textContent = [dateStr, sizeStr].filter(Boolean).join(" · ");

    card.append(head, meta);

    if (mod.official) {
      const officialBadge = document.createElement("div");
      officialBadge.className = "getmods-official";
      officialBadge.title = "Officially created and tested by the creator of ACM";
      officialBadge.textContent = "★ Official — created & tested by ACM's creator";
      card.append(officialBadge);
    }

    const excerpt = excerptReadme(mod.body);
    if (excerpt) {
      const readme = document.createElement("div");
      readme.className = "getmods-readme";
      readme.innerHTML = markdownLiteToHtml(excerpt);
      card.append(readme);
    }

    const already = importedVersionFor(mod.modName);
    if (already) {
      const badge = document.createElement("div");
      badge.className = "getmods-imported";
      badge.textContent = "Already in My Mods";
      card.append(badge);
    }

    const actions = document.createElement("div");
    actions.className = "getmods-actions";

    const btn = document.createElement("button");
    btn.className = "getmods-download primary";
    btn.textContent = already ? "Download Again" : "Download & Add";

    const githubBtn = document.createElement("button");
    githubBtn.className = "getmods-github";
    githubBtn.textContent = "View on GitHub";
    githubBtn.addEventListener("click", () => {
      if (mod.htmlUrl) window.getMods.openReleasePage(mod.htmlUrl);
    });

    actions.append(btn, githubBtn);
    card.append(actions);

    const progressWrap = document.createElement("div");
    progressWrap.className = "getmods-progress-wrap hidden";
    const progress = document.createElement("div");
    progress.className = "getmods-progress";
    const progressFill = document.createElement("div");
    progressFill.className = "getmods-progress-fill";
    progress.append(progressFill);
    const progressText = document.createElement("span");
    progressText.className = "getmods-progress-text";
    progressText.textContent = "0%";
    progressWrap.append(progress, progressText);
    card.append(progressWrap);

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      progressWrap.classList.remove("hidden");
      progressFill.style.width = "0%";
      progressText.textContent = "0%";
      downloadingTag = mod.tag;
      const res = await window.getMods.downloadAndImport({ zipUrl: mod.zipUrl, zipName: mod.zipName, modName: mod.modName });
      downloadingTag = null;
      progressWrap.classList.add("hidden");
      btn.disabled = false;
      if (res && res.ok) {
        setStatus(`${mod.modName} added to My Mods.`);
        await refresh();
        renderGetModsList();
      } else {
        setStatus(`Couldn't download ${mod.modName}: ` + ((res && res.error) || "unknown error"), true);
      }
    });

    gm.list.appendChild(card);
  }
}

initGetMods();
