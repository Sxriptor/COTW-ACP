// Renderer for the in-game overlay window (overlay.html). Runs with the same
// preload as the main window, so window.fasttravel is available.

const btn = document.getElementById("ft-btn");
const statusEl = document.getElementById("ft-status");

let busy = false;

function render(s) {
  const on = !!(s && s.on);
  const ceInstalled = !!(s && s.ceInstalled);
  const modPresent = !!(s && s.modPresent);

  btn.disabled = !ceInstalled || !modPresent || busy;
  btn.classList.toggle("on", on);
  btn.textContent = on ? "Restore My Unlocks" : "Unlock All Fast Travel";

  if (!modPresent) {
    statusEl.textContent = "Import \"Unlock All Fast Travel\" from Get Mods first.";
  } else if (!ceInstalled) {
    statusEl.textContent = "Cheat Engine not found — install it and try again.";
  } else if (on) {
    statusEl.textContent = "All fast-travel points shown. Click to restore your real unlocks.";
  } else {
    statusEl.textContent = "Only your real unlocks are shown right now.";
  }
}

async function refresh() {
  try {
    const s = await window.fasttravel.status();
    render(s);
  } catch (_) {
    statusEl.textContent = "Couldn't reach ACM.";
  }
}

btn.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  try {
    const s = await window.fasttravel.status();
    if (s && s.on) await window.fasttravel.stop();
    else await window.fasttravel.start();
  } catch (_) {}
  busy = false;
  await refresh();
});

refresh();
setInterval(refresh, 2000);
