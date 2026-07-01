const { default: pngToIco } = require("png-to-ico");
const fs = require("fs");
const path = require("path");

const src  = path.join(__dirname, "../public/logo.png");
const dest = path.join(__dirname, "../public/logo.ico");

pngToIco(src)
  .then((buf) => {
    fs.writeFileSync(dest, buf);
    console.log("logo.ico written to public/");
  })
  .catch((err) => {
    console.error("Failed to convert logo.png to .ico:", err.message);
    process.exit(1);
  });
