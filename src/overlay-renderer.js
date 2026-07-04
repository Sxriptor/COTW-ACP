// Renderer for the in-game overlay window (overlay.html). Runs with the same
// preload as the main window, so window.fasttravel is available.

const btn = document.getElementById("ft-btn");
const statusEl = document.getElementById("ft-status");

let busy = false;

function render(s) {
  const on = !!(s && s.on);
  const ceInstalled = !!(s && s.ceInstalled);

  btn.disabled = !ceInstalled || busy;
  btn.classList.toggle("on", on);
  btn.textContent = on ? "Restore My Unlocks" : "Unlock All Fast Travel";

  if (!ceInstalled) {
    statusEl.textContent = "Cheat Engine not found — install it from ACM's Tweaks tab.";
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
