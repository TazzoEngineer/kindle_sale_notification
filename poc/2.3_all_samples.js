/**
 * PoC 2.2/2.3 (全ページ) - ページングを巡回して全サンプル書籍を収集する。
 * 保存済みセッション（.chrome-profile）を再利用。
 *
 * ページング DOM:
 *   #pagination > a.page-item（id="page-1".."page-N"）を順にクリックし、
 *   一覧が再描画されるのを待って抽出する。
 *
 * 実行:
 *   npm run poc:all-samples
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

// 現在表示中ページの書籍を抽出
async function extractPage(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('tr[role="listitem"]'));
    return rows.map((row) => {
      const titleEl = row.querySelector('[id^="content-title-"]');
      const asin = titleEl ? titleEl.id.replace('content-title-', '') : null;
      const title = titleEl ? clean(titleEl.innerText) : null;
      const author =
        clean(row.querySelector('[id^="content-author-"]')?.innerText) || null;
      const acquired =
        clean(row.querySelector('[id^="content-acquired-date-"]')?.innerText) ||
        null;
      const isSample = Array.from(row.querySelectorAll('*')).some(
        (el) =>
          el.children.length === 0 && (el.textContent || '').trim() === 'サンプル'
      );
      return { asin, title, author, acquired, isSample };
    });
  });
}

// 先頭行の ASIN（ページ切替の完了検知に使う）
async function firstAsin(page) {
  return page.evaluate(() => {
    const t = document.querySelector('tr[role="listitem"] [id^="content-title-"]');
    return t ? t.id.replace('content-title-', '') : null;
  });
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
    await page.waitForSelector('tr[role="listitem"]', { timeout: 20000 });
    await delay(1500);

    const countText =
      (await page.$eval('#CONTENT_COUNT', (el) => el.innerText.trim()).catch(
        () => null
      )) || null;

    // ページ番号一覧を取得
    const pageIds = await page.$$eval('#pagination a.page-item', (els) =>
      els.map((el) => el.id)
    );
    const totalPages = pageIds.length || 1;
    console.log('[総数表示]', countText);
    console.log('[ページ数]', totalPages);

    const all = [];
    for (let n = 1; n <= totalPages; n++) {
      if (n > 1) {
        const prevFirst = await firstAsin(page);
        await page.click(`#page-${n}`);
        // 先頭行 ASIN が変わるまで待つ（再描画完了の検知）
        await page
          .waitForFunction(
            (prev) => {
              const t = document.querySelector(
                'tr[role="listitem"] [id^="content-title-"]'
              );
              const cur = t ? t.id.replace('content-title-', '') : null;
              return cur && cur !== prev;
            },
            { timeout: 15000 },
            prevFirst
          )
          .catch(() => {});
        await delay(1000);
      }
      const books = await extractPage(page);
      console.log(`  page ${n}: ${books.length} 件`);
      all.push(...books);
    }

    // ASIN で重複排除
    const seen = new Set();
    const unique = all.filter((b) => {
      if (!b.asin || seen.has(b.asin)) return false;
      seen.add(b.asin);
      return true;
    });
    const samples = unique.filter((b) => b.isSample);

    fs.writeFileSync(
      path.join(OUT_DIR, 'all_books.json'),
      JSON.stringify(unique, null, 2)
    );
    fs.writeFileSync(
      path.join(OUT_DIR, 'all_samples.json'),
      JSON.stringify(samples, null, 2)
    );

    console.log('========================================');
    console.log('[全書籍(ユニーク)]', unique.length);
    console.log('[全サンプル]', samples.length);
    console.log('----------------------------------------');
    for (const b of samples) {
      console.log(`  - [${b.asin}] ${b.title}  (${b.acquired})`);
    }
    console.log('========================================');
    console.log('[保存] poc/out/all_books.json');
    console.log('[保存] poc/out/all_samples.json');
  } finally {
    await browser.close();
  }
})();
