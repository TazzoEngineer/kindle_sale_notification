/**
 * PoC 2.2/2.3 (DOM 構造調査) - コンテンツと端末の管理ページの一覧 DOM を
 * ダンプして、書籍1件あたりの構造・サンプル判定・ASIN の在り処を特定する。
 *
 * 実行:
 *   npm run poc:inspect
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const PROFILE_DIR = path.join(__dirname, '..', '..', '.chrome-profile');
const OUT_DIR = path.join(__dirname, '..', '..', 'out');
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
    await delay(6000); // 動的描画待ち

    // ページ全体の HTML を保存（後で解析）
    const html = await page.content();
    fs.writeFileSync(path.join(OUT_DIR, 'library_full.html'), html);

    // 「サンプル」という文字を含む要素の周辺構造を探索
    const report = await page.evaluate(() => {
      const out = {};

      // 1. 「サンプル」テキストを持つ要素を探す
      const all = Array.from(document.querySelectorAll('*'));
      const sampleEls = all.filter(
        (el) =>
          el.children.length === 0 &&
          /サンプル/.test(el.textContent || '')
      );
      out.sampleTextElementCount = sampleEls.length;
      out.sampleSamples = sampleEls.slice(0, 3).map((el) => ({
        tag: el.tagName,
        class: el.className,
        id: el.id,
        text: (el.textContent || '').trim().slice(0, 30),
      }));

      // 2. id に ASIN らしき文字列(B0...)を含む要素を探す
      const asinEls = all.filter((el) => /B0[A-Z0-9]{8}/.test(el.id || ''));
      out.asinIdSamples = asinEls.slice(0, 5).map((el) => ({
        tag: el.tagName,
        id: el.id,
        class: el.className,
      }));

      // 3. 一覧行らしきコンテナ候補（id/class に "content" や "row" を含む）
      const rowCandidates = all.filter((el) =>
        /content.*row|row.*content|listRow|contentTableList/i.test(
          (el.id || '') + ' ' + (el.className || '')
        )
      );
      out.rowCandidateSamples = rowCandidates.slice(0, 8).map((el) => ({
        tag: el.tagName,
        id: el.id,
        class: el.className,
      }));

      // 4. タイトルらしき要素（class に title を含む）
      const titleEls = all.filter((el) =>
        /title/i.test(el.className || '')
      );
      out.titleClassSamples = titleEls.slice(0, 8).map((el) => ({
        tag: el.tagName,
        id: el.id,
        class: el.className,
        text: (el.textContent || '').trim().slice(0, 40),
      }));

      return out;
    });

    fs.writeFileSync(
      path.join(OUT_DIR, 'inspect_report.json'),
      JSON.stringify(report, null, 2)
    );

    console.log('----------------------------------------');
    console.log(JSON.stringify(report, null, 2));
    console.log('----------------------------------------');
    console.log('[保存] out/library_full.html');
    console.log('[保存] out/inspect_report.json');
  } finally {
    await browser.close();
  }
})();
