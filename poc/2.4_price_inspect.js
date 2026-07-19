/**
 * PoC 2.4 (価格 DOM 調査) - 書籍の商品ページを開き、価格・定価・売価・
 * 還元ポイントらしき要素を洗い出す。保存済みセッションを再利用。
 *
 * 実行:
 *   npm run poc:price-inspect -- B0GX2XQNGK
 *   （ASIN を引数で渡す。省略時は既定 ASIN）
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const PROFILE_DIR = path.join(__dirname, '..', '.chrome-profile');
const OUT_DIR = path.join(__dirname, 'out');
const ASIN = process.argv[2] || 'B0GX2XQNGK';
const URL = `https://www.amazon.co.jp/dp/${ASIN}`;

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

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await delay(5000);

    const title = await page.title();
    const finalUrl = page.url();

    fs.writeFileSync(
      path.join(OUT_DIR, `product_${ASIN}.html`),
      await page.content()
    );

    // 「￥」「ポイント」「pt」を含む末端要素を洗い出す
    const report = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const leaf = all.filter((el) => el.children.length === 0);
      const pick = (re) =>
        leaf
          .filter((el) => re.test(el.textContent || ''))
          .slice(0, 25)
          .map((el) => ({
            tag: el.tagName,
            id: el.id,
            class:
              typeof el.className === 'string' ? el.className : '',
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          }));

      return {
        yen: pick(/￥|円/),
        points: pick(/ポイント|pt/),
        // フォーマット切替タブ（Kindle/単行本など）
        swatches: Array.from(
          document.querySelectorAll('[id^="tmm-grid-swatch-"]')
        ).map((el) => ({
          id: el.id,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        })),
      };
    });

    fs.writeFileSync(
      path.join(OUT_DIR, `price_inspect_${ASIN}.json`),
      JSON.stringify({ asin: ASIN, finalUrl, title, ...report }, null, 2)
    );

    console.log('========================================');
    console.log('[ASIN]', ASIN);
    console.log('[title]', title);
    console.log('[finalUrl]', finalUrl);
    console.log('---- swatches (フォーマット) ----');
    console.log(JSON.stringify(report.swatches, null, 2));
    console.log('---- ￥/円 を含む要素 ----');
    console.log(JSON.stringify(report.yen, null, 2));
    console.log('---- ポイント/pt を含む要素 ----');
    console.log(JSON.stringify(report.points, null, 2));
    console.log('========================================');
    console.log(`[保存] poc/out/product_${ASIN}.html`);
    console.log(`[保存] poc/out/price_inspect_${ASIN}.json`);
  } finally {
    await browser.close();
  }
})();
