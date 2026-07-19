/**
 * PoC 2.2 / 2.3 - コンテンツと端末の管理ページから書籍一覧を DOM 抽出し、
 * サンプル書籍を識別する。保存済みセッション（.chrome-profile）を再利用。
 *
 * 判明している DOM 構造:
 *   - 一覧:   table.ListLayout-module_table > tbody > tr[role="listitem"]
 *   - 総数:   #CONTENT_COUNT （「188のうち1から25までの商品を表示しています」）
 *   - 各行:   content-title-{ASIN} / content-author-{ASIN} / content-acquired-date-{ASIN}
 *   - サンプル: 行内に本文「サンプル」のバッジ要素が存在する
 *
 * 実行:
 *   npm run poc:samples
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
    // 一覧行が描画されるまで待つ
    await page.waitForSelector('tr[role="listitem"]', { timeout: 20000 });
    await delay(1500);

    const result = await page.evaluate(() => {
      const countText =
        document.querySelector('#CONTENT_COUNT')?.innerText.trim() || null;

      const rows = Array.from(document.querySelectorAll('tr[role="listitem"]'));
      const books = rows.map((row) => {
        const titleEl = row.querySelector('[id^="content-title-"]');
        const asin = titleEl
          ? titleEl.id.replace('content-title-', '')
          : null;
        const title = titleEl ? titleEl.innerText.replace(/\s+/g, ' ').trim() : null;
        const author =
          row
            .querySelector('[id^="content-author-"]')
            ?.innerText.replace(/\s+/g, ' ')
            .trim() || null;
        const acquired =
          row
            .querySelector('[id^="content-acquired-date-"]')
            ?.innerText.replace(/\s+/g, ' ')
            .trim() || null;

        // サンプル判定: 行内に本文がちょうど「サンプル」の要素があるか
        const isSample = Array.from(row.querySelectorAll('*')).some(
          (el) =>
            el.children.length === 0 &&
            (el.textContent || '').trim() === 'サンプル'
        );

        return { asin, title, author, acquired, isSample };
      });

      return { countText, books };
    });

    const samples = result.books.filter((b) => b.isSample);

    fs.writeFileSync(
      path.join(OUT_DIR, 'library_page1.json'),
      JSON.stringify(result, null, 2)
    );
    fs.writeFileSync(
      path.join(OUT_DIR, 'samples_page1.json'),
      JSON.stringify(samples, null, 2)
    );

    console.log('========================================');
    console.log('[総数表示]', result.countText);
    console.log('[このページの書籍数]', result.books.length);
    console.log('[うちサンプル]', samples.length);
    console.log('----------------------------------------');
    console.log('サンプル書籍一覧（このページ）:');
    for (const b of samples) {
      console.log(`  - [${b.asin}] ${b.title}  / ${b.author}  (${b.acquired})`);
    }
    console.log('========================================');
    console.log('[保存] poc/out/library_page1.json');
    console.log('[保存] poc/out/samples_page1.json');
  } finally {
    await browser.close();
  }
})();
