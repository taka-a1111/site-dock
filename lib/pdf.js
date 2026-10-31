// HTML を A4 の PDF にする（Vercel の関数の中で動く Chromium を使う）
// どちらのパッケージも ES Module なので、import() で読み込む

async function htmlToPdf(html) {
  const cm = await import('@sparticuz/chromium');
  const chromium = cm.default || cm;
  const pm = await import('puppeteer-core');
  const puppeteer = pm.default || pm;
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: { width: 794, height: 1123 },
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { htmlToPdf };
