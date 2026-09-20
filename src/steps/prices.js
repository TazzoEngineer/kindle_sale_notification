/**
 * PoC 2.4 (バッチ) - all_samples.json の各サンプル書籍について、
 * 商品ページから Kindle 価格・ポイント・参考価格を取得し、セールを検知する。
 * 保存済みセッション（.chrome-profile）を再利用。
 *
 * 実行:
 *   npm run poc:batch                 # 既定 25 件
 *   npm run poc:batch -- --limit=149  # 全件
 *   npm run poc:batch -- --start=25 --limit=25
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { fetchPrice, resolveByTitle, delay } = require('../lib/amazon');

const PROFILE_DIR = path.join(__dirname, '..', '..', '.chrome-profile');
const OUT_DIR = path.join(__dirname, '..', '..', 'out');
const SAMPLES_FILE = path.join(OUT_DIR, 'all_samples.json');

function argVal(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const START = parseInt(argVal('start', '0'), 10);
const LIMIT = parseInt(argVal('limit', '25'), 10);
// --no-fallback で 404 タイトル検索フォールバックを無効化できる
const NO_FALLBACK = process.argv.includes('--no-fallback');

(async () => {
  const samples = JSON.parse(fs.readFileSync(SAMPLES_FILE, 'utf8'));
  const target = samples.slice(START, START + LIMIT);
  console.log(`[対象] ${target.length} 件 (start=${START}, limit=${LIMIT} / 全${samples.length})`);

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const results = [];
  const sales = [];
  try {
    async function newConfiguredPage() {
      const pg = await browser.newPage();
      await pg.setViewport({ width: 1440, height: 900 });
      await pg.setExtraHTTPHeaders({ 'Accept-Language': 'ja' });
      return pg;
    }

    let page = await newConfiguredPage();

    for (let i = 0; i < target.length; i++) {
      const b = target[i];
      let p = null;
      // フレーム切断/タブ落ち等はページを作り直して 1 回だけ再試行する
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          p = await fetchPrice(page, b.asin);
          break;
        } catch (err) {
          const recoverable =
            /detached Frame|Target closed|Session closed|Navigating frame was detached|Execution context/i.test(
              err.message
            );
          if (recoverable && attempt === 0) {
            try {
              await page.close();
            } catch {}
            page = await newConfiguredPage();
            continue; // 作り直して再試行
          }
          console.log(`  [${i + 1}/${target.length}] ${b.asin} 取得失敗: ${err.message}`);
          results.push({ asin: b.asin, title: b.title, error: err.message });
          break;
        }
      }
      // 404 フォールバック: タイトル検索で購入可能な ASIN を解決して再取得
      if (p && p.notFound && !NO_FALLBACK && b.title) {
        try {
          const hit = await resolveByTitle(page, b.title, b.asin);
          if (hit) {
            const alt = await fetchPrice(page, hit.asin);
            if (!alt.notFound && alt.kindlePrice != null) {
              alt.sampleAsin = b.asin; // ライブラリ上のサンプル ASIN
              alt.resolvedAsin = hit.asin; // 検索で解決した購入可能 ASIN
              alt.resolvedFrom = '404-title-search';
              p = alt;
            }
          }
        } catch (err) {
          // フォールバック失敗は致命的でないため 404 のまま続行
          console.log(`      (フォールバック失敗: ${err.message})`);
        }
      }
      if (p) {
        p.title = b.title;
        results.push(p);
        const tags = [];
        if (p.isKindleUnlimited) tags.push('読み放題');
        if (p.notFound) tags.push('404');
        if (p.resolvedAsin) tags.push(`解決:${p.resolvedAsin}`);
        const rate = p.discountRate != null ? `${Math.round(p.discountRate * 100)}%` : '-';
        const flag = p.onSale ? ` 🔥SALE(実質${rate})` : '';
        console.log(
          `  [${i + 1}/${target.length}] ${b.asin} Kindle￥${p.kindlePrice ?? '-'}` +
            `${p.paperPrice ? ` / 紙￥${p.paperPrice}` : ''} / ${p.points ?? '-'}pt 実質${rate}` +
            `${tags.length ? ` [${tags.join(',')}]` : ''}${flag}  ${b.title}`
        );
        if (p.onSale) sales.push(p);
      }
      await delay(1200); // 礼儀的な間隔
    }

    fs.writeFileSync(
      path.join(OUT_DIR, 'prices.json'),
      JSON.stringify(results, null, 2)
    );
    fs.writeFileSync(
      path.join(OUT_DIR, 'prices_onsale.json'),
      JSON.stringify(sales, null, 2)
    );

    console.log('========================================');
    console.log('[取得完了]', results.length, '件');
    const withPaper = sales.filter((s) => s.paperPrice).length;
    const notFound = results.filter((s) => s.notFound).length;
    const resolved = results.filter((s) => s.resolvedAsin).length;
    const noPrice = results.filter((s) => !s.error && s.kindlePrice == null).length;
    console.log(`[セール中] ${sales.length} 件（うち紙価格あり ${withPaper} 件）`);
    console.log(`[404] ${notFound} 件（フォールバック解決 ${resolved} 件）/ [価格取得不可] ${noPrice} 件`);
    for (const s of sales) {
      const rate = s.discountRate != null ? `${Math.round(s.discountRate * 100)}%` : '-';
      const paper = s.paperPrice ? `紙￥${s.paperPrice} ` : '';
      console.log(`  🔥 [${s.asin}] 実質${rate}  ${paper}Kindle￥${s.kindlePrice} / ${s.points ?? '-'}pt  ${s.title}`);
    }
    console.log('[保存] out/prices.json / out/prices_onsale.json');
  } finally {
    await browser.close();
  }
})();
