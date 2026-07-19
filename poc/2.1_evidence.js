/**
 * PoC 2.1 (証拠取得) - Library ページに到達できたことをスクリーンショットと
 * DOM 情報で示す。保存済みセッション（.chrome-profile）を再利用する。
 *
 * 実行:
 *   npm run poc:evidence
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const PROFILE_DIR = path.join(__dirname, '..', '.chrome-profile');
const OUT_DIR = path.join(__dirname, 'out');
const CONTENT_URL =
  'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/dateDsc/';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja' });

    await page.goto(CONTENT_URL, { waitUntil: 'domcontentloaded' });
    await delay(5000); // 動的描画待ち

    const finalUrl = page.url();
    const title = await page.title();
    const greeting = await page
      .$eval('#nav-link-accountList', (el) =>
        el.innerText.replace(/\s+/g, ' ').trim()
      )
      .catch(() => null);

    const shotPath = path.join(OUT_DIR, 'library.png');
    await page.screenshot({ path: shotPath, fullPage: false });

    console.log('----------------------------------------');
    console.log('[証拠] 最終 URL   :', finalUrl);
    console.log('[証拠] ページ title:', JSON.stringify(title));
    console.log('[証拠] ヘッダ表示 :', JSON.stringify(greeting));
    console.log('[証拠] スクショ   :', shotPath);
    console.log('----------------------------------------');
  } finally {
    await browser.close();
  }
})();
