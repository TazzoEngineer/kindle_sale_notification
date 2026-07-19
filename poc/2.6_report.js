/**
 * PoC 2.6 - ゴール出力（表）。
 *   prices.json を読み込み、以下のヘッダの表を Markdown / CSV で出力する:
 *     割引率 / 紙の本の価格 / Kindle価格 / 獲得ポイント / タイトル / 著者、訳者 / 発売日
 *   割引率の降順（高い順）で並べる。
 *
 * 実行:
 *   npm run poc:report              # 全件
 *   npm run poc:report -- --sale    # セール（割引率>=閾値）のみ
 */
const path = require('path');
const fs = require('fs');
const { SALE_THRESHOLD } = require('./lib/parsePrice');

const OUT_DIR = path.join(__dirname, 'out');
const PRICES_FILE = path.join(OUT_DIR, 'prices.json');
const SALE_ONLY = process.argv.includes('--sale');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const yen = (n) => (n != null ? `￥${n.toLocaleString('ja-JP')}` : '-');
const pct = (r) => (r != null ? `${Math.round(r * 100)}%` : '-');

(async () => {
  const rows = readJson(PRICES_FILE, []);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('[中止] prices.json が空です。先に `npm run poc:batch` を実行してください。');
    return;
  }

  let list = rows.filter((r) => !r.error && r.kindlePrice != null);
  if (SALE_ONLY) list = list.filter((r) => r.onSale);

  // 割引率 降順（null は最後）
  list.sort((a, b) => (b.discountRate ?? -1) - (a.discountRate ?? -1));

  const headers = ['割引率', '紙の本の価格', 'Kindle価格', '獲得ポイント', 'タイトル', '著者、訳者', '発売日'];

  const cell = (r) => [
    pct(r.discountRate),
    yen(r.paperPrice),
    yen(r.kindlePrice),
    r.points != null ? `${r.points}pt` : '-',
    (r.title || r.productTitle || '').replace(/\|/g, '／'),
    (r.byline || '').replace(/\|/g, '／'),
    r.releaseDate || '-',
  ];

  // Markdown
  const md = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...list.map((r) => `| ${cell(r).join(' | ')} |`),
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), md + '\n');

  // CSV（Excel 用に BOM 付き）
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = [
    headers.map(esc).join(','),
    ...list.map((r) => cell(r).map(esc).join(',')),
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'report.csv'), '\ufeff' + csv + '\n');

  // コンソール表示
  console.log(md);
  console.log('\n========================================');
  console.log(`[出力] ${list.length} 件${SALE_ONLY ? '（セールのみ）' : ''}`);
  console.log('[保存] poc/out/report.md / poc/out/report.csv');
})();
