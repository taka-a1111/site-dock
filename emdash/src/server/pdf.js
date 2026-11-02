// HTML を A4 の PDF にする（Cloudflare の「ブラウザ実行」＝Browser Rendering を使う）
// wrangler.jsonc の browser バインディング（BROWSER）が要る
import puppeteer from "@cloudflare/puppeteer";
import { env } from "cloudflare:workers";

export async function htmlToPdf(html) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return new Uint8Array(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}
