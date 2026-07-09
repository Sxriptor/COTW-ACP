const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

if (process.platform !== "darwin") {
  console.log("make-icns: skipped (not macOS)");
  process.exit(0);
}

const src = path.join(__dirname, "../public/logo.png");
const iconsetDir = path.join(os.tmpdir(), `acm-logo-${Date.now()}.iconset`);
const dest = path.join(__dirname, "../public/logo.icns");

fs.mkdirSync(iconsetDir, { recursive: true });

// iconutil requires this exact naming convention
const entries = [
  { file: "icon_16x16.png",       size: 16  },
  { file: "icon_16x16@2x.png",    size: 32  },
  { file: "icon_32x32.png",       size: 32  },
  { file: "icon_32x32@2x.png",    size: 64  },
  { file: "icon_128x128.png",     size: 128 },
  { file: "icon_128x128@2x.png",  size: 256 },
  { file: "icon_256x256.png",     size: 256 },
  { file: "icon_256x256@2x.png",  size: 512 },
  { file: "icon_512x512.png",     size: 512 },
  { file: "icon_512x512@2x.png",  size: 1024 },
];

try {
  for (const { file, size } of entries) {
    execSync(
      `sips -z ${size} ${size} "${src}" --out "${path.join(iconsetDir, file)}"`,
      { stdio: "ignore" }
    );
  }
  execSync(`iconutil -c icns "${iconsetDir}" -o "${dest}"`);
  console.log("logo.icns written to public/");
} finally {
  fs.rmSync(iconsetDir, { recursive: true, force: true });
}
