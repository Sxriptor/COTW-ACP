const modsEl = document.getElementById("mods");
const idleEl = document.getElementById("idle");

let busyIds = new Set();

function renderMods(mods) {
  modsEl.innerHTML = "";
  const visible = Array.isArray(mods) ? mods : [];

  modsEl.classList.toggle("hidden", visible.length === 0);
  idleEl.classList.toggle("hidden", visible.length !== 0);

  for (const mod of visible) {
    const row = document.createElement("div");
    row.className = "mod-row";

    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "mod-name";
    name.textContent = mod.name;
    const status = document.createElement("div");
    status.className = "mod-status";
    status.textContent = mod.on ? "Live patch enabled." : "Loaded in ACM, currently disabled.";
    text.append(name, status);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mod-btn" + (mod.on ? " on" : "");
    btn.textContent = mod.on ? "Disable" : "Enable";
    btn.disabled = busyIds.has(mod.id) || !mod.ceInstalled;
    if (!mod.ceInstalled) status.textContent = "Cheat Engine not found.";
    btn.addEventListener("click", async () => {
      if (busyIds.has(mod.id)) return;
      busyIds.add(mod.id);
      await refresh();
      try {
        await window.runtimeMods.set(mod.id, !mod.on);
      } catch (_) {}
      busyIds.delete(mod.id);
      await refresh();
    });

    row.append(text, btn);
    modsEl.append(row);
  }
}

async function refresh() {
  try {
    const res = await window.runtimeMods.list();
    renderMods((res && res.mods) || []);
  } catch (_) {
    modsEl.classList.add("hidden");
    idleEl.classList.remove("hidden");
    idleEl.textContent = "Couldn't reach ACM.";
  }
}

refresh();
setInterval(refresh, 2000);
