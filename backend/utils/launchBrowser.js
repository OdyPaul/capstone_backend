// backend/utils/launchBrowser.js
const isRender =
  !!process.env.RENDER ||
  !!process.env.RENDER_INTERNAL_HOSTNAME ||
  process.env.NODE_ENV === "production";

async function launchBrowser() {
  if (isRender) {
    // Production (Render): chromium + puppeteer-core
    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");

    // Some platforms need a fallback path if chromium.executablePath() returns null
    const execPath = (await chromium.executablePath()) || process.env.CHROME_PATH;

    return puppeteer.launch({
      executablePath: execPath,
      headless: chromium.headless !== undefined ? chromium.headless : true,
      defaultViewport: chromium.defaultViewport,
      ignoreHTTPSErrors: true,
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
      ],
    });
  }

  // Local dev: full puppeteer (bundled Chrome)
  const puppeteer = require("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  });
}

module.exports = launchBrowser;
