/**
 * PoC 2.4 (フォールバック) - サンプル ASIN が /dp/{ASIN} で 404 になる書籍について、
 * Kindle ストアをタイトル検索して購入可能な ASIN を解決する。
 * 保存済みセッション（.chrome-profile）を再利用。
 *
 * 背景:
 *   ライブラリのサンプル ASIN は、版・フォーマット差で購入用の商品ページに
 *   直接解決しないことがある（例: ハンチバック, ツミデミック, BUTTER 等）。
 *   その場合はタイトルで検索し、Kindle 版の先頭候補 ASIN を採用する。
 *
 * 実行:
 *   npm run poc:search -- "ハンチバック"
 *   npm run poc:search -- "ツミデミック 一穂ミチ"
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { fetchPrice, searchKindle } = require('../lib/amazon');

const PROFILE_DIR = path.join(__dirname, '..', '..', '.chrome-profile');
const OUT_DIR = path.join(__dirname, '..', '..', 'out');
const QUERY = process.argv.slice(2).join(' ') || 'ハンチバック';

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

    console.log('[検索]', QUERY);
    const candidates = await searchKindle(page, QUERY);
    const usable = candidates.filter((c) => c.asin && !c.sponsored);

    console.log(`[候補] ${candidates.length} 件（広告除外後 ${usable.length} 件）`);
    usable.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.asin}  ${c.title ?? '(タイトル不明)'}`);
    });

    if (usable.length === 0) {
      console.log('[結果] 候補なし。検索語を見直してください。');
      return;
    }

    // 先頭候補を採用して価格取得
    const top = usable[0];
    console.log(`[採用] ${top.asin}  ${top.title ?? ''}`);
    const p = await fetchPrice(page, top.asin);

    const result = { query: QUERY, resolvedAsin: top.asin, candidates: usable.slice(0, 5), price: p };
    fs.writeFileSync(
      path.join(OUT_DIR, `search_${top.asin}.json`),
      JSON.stringify(result, null, 2)
    );

    console.log('----------------------------------------');
    console.log('[Kindle価格]  ', p.kindlePrice != null ? `￥${p.kindlePrice}` : '(取得不可)');
    console.log('[還元ポイント]', p.points != null ? `${p.points}pt (${Math.round((p.pointRate ?? 0) * 100)}%)` : '(なし)');
    console.log('[読み放題]    ', p.isKindleUnlimited ? '対象' : '対象外');
    console.log('[セール判定]  ', p.onSale ? '🔥 セール中' : '通常価格');
    console.log(`[保存] out/search_${top.asin}.json`);
  } finally {
    await browser.close();
  }
})();
