/**
 * PoC 2.5 - 差分検知と通知。
 *   前回の価格スナップショット（price_history.json）と、今回取得（prices.json）を
 *   比較し、以下を「通知対象」として検出する:
 *     - 新規セール入り: 今回 onSale かつ 前回 非onSale（または初回）
 *     - 値下がり:       今回売価 < 前回売価
 *     - 還元率アップ:   今回還元率 が 前回 + 閾値 以上に上昇
 *   検出結果は macOS 通知（osascript）とファイル出力（notifications.json）に反映し、
 *   履歴（price_history.json）を今回値で更新する。
 *
 * 実行:
 *   npm run poc:detect            # 通知あり（macOS）
 *   npm run poc:detect -- --dry   # 通知を出さず結果表示のみ
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const OUT_DIR = path.join(__dirname, 'out');
const PRICES_FILE = path.join(OUT_DIR, 'prices.json');
const HISTORY_FILE = path.join(OUT_DIR, 'price_history.json');
const NOTIF_FILE = path.join(OUT_DIR, 'notifications.json');

const DRY = process.argv.includes('--dry');
// 実質割引率が前回よりこの幅以上上がったら「割引率アップ」とみなす
const DISCOUNT_UP_DELTA = 0.1;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** macOS 通知を1件出す（osascript）。 */
function notifyMac(title, message) {
  return new Promise((resolve) => {
    const safe = (s) => String(s).replace(/["\\]/g, ' ');
    const script = `display notification "${safe(message)}" with title "${safe(title)}"`;
    execFile('osascript', ['-e', script], () => resolve());
  });
}

(async () => {
  const current = readJson(PRICES_FILE, []);
  if (!Array.isArray(current) || current.length === 0) {
    console.log('[中止] prices.json が空です。先に価格取得を実行してください。');
    return;
  }
  const history = readJson(HISTORY_FILE, {}); // { [asin]: {kindlePrice, points, pointRate, onSale} }
  const firstRun = Object.keys(history).length === 0;

  const notifications = [];

  for (const c of current) {
    if (c.error || c.kindlePrice == null) continue; // 価格取得不可はスキップ
    const prev = history[c.asin];

    const reasons = [];
    // 新規セール入り（初回はセール中のものだけ拾う）
    if (c.onSale && (!prev || !prev.onSale)) {
      reasons.push(firstRun ? 'セール中' : '新規セール');
    }
    if (prev) {
      // 値下がり
      if (prev.kindlePrice != null && c.kindlePrice < prev.kindlePrice) {
        reasons.push(`値下がり ￥${prev.kindlePrice}→￥${c.kindlePrice}`);
      }
      // 実質割引率アップ
      const prevRate = prev.discountRate ?? 0;
      const curRate = c.discountRate ?? 0;
      if (curRate - prevRate >= DISCOUNT_UP_DELTA) {
        reasons.push(`割引率 ${Math.round(prevRate * 100)}%→${Math.round(curRate * 100)}%`);
      }
    }

    if (reasons.length > 0) {
      notifications.push({
        asin: c.asin,
        title: c.title,
        kindlePrice: c.kindlePrice,
        paperPrice: c.paperPrice,
        points: c.points,
        discountRate: c.discountRate,
        onSale: c.onSale,
        reasons,
      });
    }

    // 履歴更新（今回値で上書き）
    history[c.asin] = {
      kindlePrice: c.kindlePrice,
      paperPrice: c.paperPrice ?? null,
      points: c.points ?? null,
      discountRate: c.discountRate ?? null,
      onSale: !!c.onSale,
      title: c.title,
      updatedAt: new Date().toISOString(),
    };
  }

  console.log('========================================');
  console.log(`[比較] 今回 ${current.length} 件 / 履歴 ${Object.keys(history).length} 件` +
    `${firstRun ? '（初回実行）' : ''}`);
  console.log(`[通知対象] ${notifications.length} 件`);
  for (const n of notifications) {
    const rate = n.discountRate != null ? ` 実質${Math.round(n.discountRate * 100)}%` : '';
    console.log(`  🔔 [${n.asin}] Kindle￥${n.kindlePrice} ${n.points ?? '-'}pt${rate}  ${n.title}`);
    console.log(`      理由: ${n.reasons.join(' / ')}`);
  }

  if (!DRY && notifications.length > 0) {
    // 件数が多いと通知が埋もれるため、サマリ1通＋上位数件を個別通知
    await notifyMac(
      `Kindle セール検知 ${notifications.length} 件`,
      notifications.slice(0, 3).map((n) => n.title).join(' / ')
    );
    for (const n of notifications.slice(0, 5)) {
      await notifyMac(`🔔 ${n.title}`, `￥${n.kindlePrice} / ${n.points ?? '-'}pt（${n.reasons.join(' / ')}）`);
    }
  }

  // 出力（ドライラン時は履歴/通知ファイルを更新しない）
  if (!DRY) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    fs.writeFileSync(NOTIF_FILE, JSON.stringify(notifications, null, 2));
    console.log('[保存] poc/out/price_history.json / poc/out/notifications.json');
  } else {
    console.log('[--dry] macOS 通知は送信せず、履歴/通知ファイルも更新していません。');
  }
})();
