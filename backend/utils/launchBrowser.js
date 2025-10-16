// backend/utils/launchBrowser.js
const isRender = !!process.env.RENDER || !!process.env.RENDER_INTERNAL_HOSTNAME || process.env.NODE_ENV === 'production';

async function launchBrowser() {
  if (isRender) {
    // Production (Render): use puppeteer-core + portable chromium
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');

    return puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(), // resolves the packaged binary
      headless: chromium.headless !== undefined ? chromium.headless : true,
    });
  } else {
    // Local dev: use full puppeteer (which bundles Chrome on install)
    const puppeteer = require('puppeteer');
    return puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });
  }
}

module.exports = launchBrowser;
