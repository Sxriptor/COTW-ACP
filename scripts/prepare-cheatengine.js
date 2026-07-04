// Populates resources/cheatengine/ with a trimmed copy of Cheat Engine, so
// ACM can ship its own copy for users who don't have CE installed.
//
// Source: a local Cheat Engine install (checked in the standard install
// locations). This script does NOT download anything — it copies files that
// must already exist on the machine building the release. Run it before
// `dist:win` / `pack:win` (already wired into those npm scripts).
//
// We only keep what's needed to run the x86_64 build headlessly via its Lua
// engine for simple memory read/write (openProcess/getAddress/readInteger/
// writeInteger/createTimer). We deliberately drop: the i386 build (unused —
// both the game and Cheat Engine target x64), tutorials/help/autorun demos,
// the DBK kernel-driver support files (not needed for plain
// ReadProcessMemory/WriteProcessMemory), and standalone .NET/registry
// utilities. This takes the ~89MB install down to a small fraction of that.
//
// Usage: node scripts/prepare-cheatengine.js

const fs = require("fs");
const path = require("path");

const DEST = path.join(__dirname, "..", "resources", "cheatengine");

const KEEP_FILES = [
  "cheatengine-x86_64.exe",
  "cheatengine-x86_64.exe.sig",
  "lua53-64.dll",
  "luaclient-x86_64.dll",
  "allochook-x86_64.dll",
  "CSCompiler.dll",
  "ced3d9hook64.dll",
  "ced3d10hook64.dll",
  "ced3d11hook64.dll",
  "d3dhook64.dll",
  "tcc32-64.dll",
  "tcc32-32.dll",
  "defines.lua",
  "celua.txt",
  "main.lua",
];

const KEEP_DIRS = ["clibs64", "languages", "include"];

function findLocalCheatEngine() {
  const pf   = process.env["ProgramFiles"]      || "C:/Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const candidates = [path.join(pf, "Cheat Engine"), path.join(pf86, "Cheat Engine")];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "cheatengine-x86_64.exe"))) return dir;
  }
  return null;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  const source = findLocalCheatEngine();
  if (!source) {
    console.warn(
      "[prepare-cheatengine] No local Cheat Engine install found — shipping WITHOUT a\n" +
      "  bundled copy this build. ACM will fall back to detecting the user's own\n" +
      "  install (or the in-app download) at runtime.\n" +
      "  To include a bundled copy, install Cheat Engine on this machine and rebuild."
    );
    // Always leave the directory in place (even empty) so electron-builder's
    // extraResources "from" path resolves regardless of whether we found CE.
    fs.rmSync(DEST, { recursive: true, force: true });
    fs.mkdirSync(DEST, { recursive: true });
    fs.writeFileSync(path.join(DEST, ".empty"), "no bundled Cheat Engine in this build\n");
    return;
  }

  console.log(`[prepare-cheatengine] Bundling from: ${source}`);
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  let copied = 0, missing = 0;
  for (const name of KEEP_FILES) {
    const s = path.join(source, name);
    if (fs.existsSync(s)) { copyFile(s, path.join(DEST, name)); copied++; }
    else { missing++; console.warn(`  (skip, not found in source) ${name}`); }
  }
  for (const name of KEEP_DIRS) {
    const s = path.join(source, name);
    if (fs.existsSync(s)) { copyDir(s, path.join(DEST, name)); copied++; }
    else { missing++; console.warn(`  (skip, not found in source) ${name}/`); }
  }

  const sizeOf = (p) => {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      total += sizeOf(path.join(p, e.name));
    }
    return total;
  };
  const totalMb = (sizeOf(DEST) / (1024 * 1024)).toFixed(1);
  console.log(`[prepare-cheatengine] Bundled ${copied} item(s) (${missing} missing/skipped), ${totalMb} MB -> ${DEST}`);
}

main();
