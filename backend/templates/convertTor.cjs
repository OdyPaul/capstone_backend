/* backend/templates/convertTor.cjs */
const fs = require("fs");
const path = require("path");
const { fromPath } = require("pdf2pic");

// adjust if your file is named differently or in another folder
const INPUT_PDF = path.resolve(__dirname, "template-tor.pdf");
const OUTPUT_DIR = path.resolve(__dirname, "assets");

// CLI: allow --all to convert all pages with bulk
const convertAll = process.argv.includes("--all");

if (!fs.existsSync(INPUT_PDF)) {
  console.error("❌ PDF not found at:", INPUT_PDF);
  process.exit(1);
}

// make sure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const options = {
  density: 150,
  saveFilename: "tor-page",
  savePath: OUTPUT_DIR,
  format: "png",
  width: 1654,   // A4 @ 150DPI
  height: 2339,  // A4 @ 150DPI
  quality: 100
};

const convert = fromPath(INPUT_PDF, options);

(async () => {
  try {
    if (convertAll) {
      // Convert ALL pages.  -1 means: all pages. Return type true → save files.
      await convert.bulk(-1, true);
      console.log("✅ Converted ALL pages to:", OUTPUT_DIR);
    } else {
      // Convert only first 2 pages (common case for TOR)
      await convert(1);
      await convert(2);
      console.log("✅ Converted pages 1–2 to:", OUTPUT_DIR);
    }
  } catch (err) {
    console.error("❌ Conversion failed:", err.message || err);
    process.exit(1);
  }
})();
