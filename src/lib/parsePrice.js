/**
 * 商品ページから取得した生テキストを、価格・ポイント・セール判定に変換する共通ロジック。
 *
 * 入力 raw:
 *   - swatchText:    #tmm-grid-swatch-KINDLE のテキスト
 *       例1) "Kindle版 (電子書籍) ￥2,970 (148pt) すぐに購読可能"
 *       例2) "Kindle版 (電子書籍) ￥0 または￥561 (281pt)で購入"  ← 読み放題(KU)
 *   - ebookPriceText: .ebook-price-value のテキスト（KU本では "￥0" になり得る）
 *   - paperPriceText: 「紙の本の価格」= 定価扱いのベース価格
 *
 * セール判定の方針（ユーザー定義）:
 *   重要な3値は「紙の本の価格（定価）」「Kindle価格」「獲得ポイント」。
 *   実質割引率 = (紙 − Kindle + ポイント) / 紙
 *   （紙の本の価格が無い＝紙版が無い本は、ベースが無いのでポイント還元率で代替）
 */

const SALE_THRESHOLD = 0.2; // 実質割引率 20% 以上を「セール」とみなす

function toNumber(t) {
  if (t == null) return null;
  const m = String(t).replace(/[,，]/g, '').match(/([0-9]+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parsePrice(raw) {
  const swatch = raw.swatchText || '';

  // 1) 「￥金額 (NNNpt)」を最優先で採用（購入価格＋ポイントが一体で取れる）
  const priced = swatch.match(/￥([0-9,]+)\s*\(([0-9,]+)\s*pt\)/);

  let kindlePrice = null;
  let points = null;

  if (priced) {
    kindlePrice = toNumber(priced[1]);
    points = toNumber(priced[2]);
  } else {
    // 2) フォールバック: ebook-price-value が非ゼロならそれ、無ければスワッチ最初の￥
    const ev = toNumber(raw.ebookPriceText);
    kindlePrice =
      ev && ev > 0 ? ev : toNumber((swatch.match(/￥([0-9,]+)/) || [])[1]);
    const pt = swatch.match(/\(([0-9,]+)\s*pt\)/);
    points = pt ? toNumber(pt[1]) : null;
  }

  // 読み放題(Kindle Unlimited)対象フラグ
  const isKindleUnlimited = /￥0\s*または/.test(swatch) || /読み放題/.test(swatch);

  // 紙の本の価格 = 定価扱い
  const paperPrice = toNumber(raw.paperPriceText);
  const pts = points ?? 0;

  // 実質割引率:
  //   紙価格あり → (紙 − Kindle + ポイント) / 紙
  //   紙価格なし → ポイント還元率 (ポイント / Kindle) で代替
  let discountRate = null;
  if (paperPrice && paperPrice > 0 && kindlePrice != null) {
    discountRate = (paperPrice - kindlePrice + pts) / paperPrice;
  } else if (kindlePrice && kindlePrice > 0 && points != null) {
    discountRate = pts / kindlePrice;
  }

  // 参考: 純粋なポイント還元率（ポイント / Kindle価格）
  const pointRate =
    kindlePrice && kindlePrice > 0 && points != null
      ? points / kindlePrice
      : null;

  const onSale = discountRate != null && discountRate >= SALE_THRESHOLD;

  return {
    kindlePrice, // Kindle 購入価格（売価）
    paperPrice, // 紙の本の価格（定価扱い）
    points, // 獲得ポイント
    pointRate, // ポイント還元率（参考）
    discountRate, // 実質割引率 = (紙 − Kindle + ポイント) / 紙
    isKindleUnlimited, // 読み放題対象か
    onSale, // 実質割引率が閾値以上
  };
}

module.exports = { parsePrice, toNumber, SALE_THRESHOLD };
