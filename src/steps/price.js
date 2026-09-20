/**
 * PoC 2.4 - 書籍の商品ページから Kindle 価格・ポイント（および可能なら
 * 参考価格/割引）を DOM 抽出する。保存済みセッションを再利用。
 *
 * 判明している DOM:
 *   - フォーマットスワッチ: #tmm-grid-swatch-KINDLE
 *       例) "Kindle版 (電子書籍) ￥2,970 (148pt) すぐに購読可能"
 *   - Kindle 価格ピンポイント: span.ebook-price-value （例 "￥2,970"）
 *   - ポイント: スワッチ文の "(148pt)" / 近傍 span.a-color-price.a-text-bold
 *   - セール時の参考価格: Kindle 価格近傍の取り消し線 span.a-text-strike（要セール時確認）
 *
 * 実行:
 *   npm run poc:price -- B0GX2XQNGK
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { fetchPrice } = require('../lib/amazon');

const PROFILE_DIR = path.join(__dirname, '..', '..', '.chrome-profile');
const OUT_DIR = path.join(__dirname, '..', '..', 'out');
const ASIN = process.argv[2] || 'B0GX2XQNGK';
const URL = `https://www.amazon.co.jp/dp/${ASIN}`;

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

    // 共通ライブラリで取得（価格・ポイント・紙価格・セール判定）
    const parsed = await fetchPrice(page, ASIN);
    const notFound = parsed.notFound;

    const result = {
      asin: ASIN,
      url: URL,
      ...parsed,
    };

    fs.writeFileSync(
      path.join(OUT_DIR, `price_${ASIN}.json`),
      JSON.stringify(result, null, 2)
    );

    const { kindlePrice, paperPrice, points, pointRate, discountRate, isKindleUnlimited, onSale, swatchText } = parsed;
    console.log('========================================');
    console.log('[ASIN]        ', result.asin);
    if (notFound) console.log('[注意]        ページが見つかりません (404)');
    console.log('[紙の本の価格]', paperPrice != null ? `￥${paperPrice}（定価扱い）` : '(なし/紙版なし)');
    console.log('[Kindle価格]  ', kindlePrice != null ? `￥${kindlePrice}` : '(取得不可)');
    console.log('[獲得ポイント]', points != null ? `${points}pt${pointRate != null ? ` (還元${Math.round(pointRate * 100)}%)` : ''}` : '(なし)');
    console.log('[実質割引率]  ', discountRate != null ? `${Math.round(discountRate * 100)}%  = (紙−Kindle+pt)/紙` : '(算出不可)');
    console.log('[読み放題]    ', isKindleUnlimited ? 'Kindle Unlimited 対象' : '対象外');
    console.log('[セール判定]  ', onSale ? '🔥 セール中' : '通常価格');
    console.log('----------------------------------------');
    console.log('[swatch]', swatchText);
    console.log('========================================');
    console.log(`[保存] out/price_${ASIN}.json`);
  } finally {
    await browser.close();
  }
})();
