// convertTor.js
import { fromPath } from "pdf2pic";

const converter = fromPath("./template-tor.pdf", {
  density: 150,
  saveFilename: "tor-page",   // ✅ clearer prefix
  savePath: "./assets",       // ✅ matches folder you just made
  format: "png",
  width: 1654,                // A4 width at 150 DPI
  height: 2339,               // A4 height at 150 DPI
  quality: 100
});

(async () => {
  // Convert all pages (start with 1 and 2, can add more if your TOR has more)
  await converter(1);
  await converter(2);
  console.log("✅ PNGs saved in /assets");
})();
