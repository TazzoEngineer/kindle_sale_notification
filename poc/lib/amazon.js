/**
 * Amazon 商品ページ/検索の共通操作。
 * Puppeteer の page を受け取り、価格取得・Kindle 検索を行う。
 */
const { parsePrice } = require('./parsePrice');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 商品ページ `/dp/{ASIN}` から価格・ポイント・セール判定を取得する。
 * 404 の場合は notFound=true を返す。
 */
async function fetchPrice(page, asin) {
  await page.goto(`https://www.amazon.co.jp/dp/${asin}`, {
    waitUntil: 'domcontentloaded',
  });
  await delay(2500);

  const raw = await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const swatch = document.querySelector('#tmm-grid-swatch-KINDLE');
    const swatchText = swatch ? clean(swatch.innerText) : null;
    const ebookPriceEl = document.querySelector('.ebook-price-value');
    const ebookPriceText = ebookPriceEl ? clean(ebookPriceEl.innerText) : null;

    // 「紙の本の価格」(apex-basisprice) = 定価扱いのベース価格。
    //   「紙の本の価格：」ラベル(apex-basisprice-label)がある時のみ採用する。
    //   ラベルが無いページはカルーセル(関連本)の価格を誤取得しないよう null にする。
    const paperLabel = document.querySelector('.apex-basisprice-label');
    let paperPriceText = null;
    if (paperLabel) {
      const paperScope =
        paperLabel.closest('#centerCol, #rightCol, #buybox') ||
        paperLabel.parentElement ||
        document;
      const paperEl =
        paperScope.querySelector('.apex-basisprice-value') ||
        document.querySelector('.apex-basisprice-value');
      paperPriceText = paperEl ? clean(paperEl.innerText) : null;
    }

    // タイトル
    const titleEl = document.querySelector('#productTitle, #ebooksProductTitle');
    const title = titleEl ? clean(titleEl.innerText) : null;

    // 著者・訳者（byline の各 .author: 名前 + 役割「(著)」「(翻訳)」）
    const authors = [];
    document.querySelectorAll('#bylineInfo .author').forEach((a) => {
      const nameEl = a.querySelector('a');
      const name = nameEl ? clean(nameEl.innerText) : clean(a.innerText);
      const roleEl = a.querySelector('.contribution');
      const role = roleEl
        ? clean(roleEl.innerText).replace(/[()（）,，、\s]/g, '')
        : '';
      if (name) authors.push({ name, role });
    });

    // 発売日
    let releaseDate = null;
    const dateEl = document.querySelector(
      '[data-cel-widget="rpi-attribute-book_details-publication_date"] .rpi-attribute-value span'
    );
    if (dateEl) releaseDate = clean(dateEl.innerText);
    if (!releaseDate) {
      const m = (document.body.innerText || '').match(
        /発売日[^0-9]*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})/
      );
      if (m) releaseDate = m[1];
    }

    return {
      swatchText,
      ebookPriceText,
      paperPriceText, // 紙の本の価格（定価扱い）
      title,
      authors,
      releaseDate,
      pageTitle: document.title,
    };
  });


  const notFound = /ページが見つかりません/.test(raw.pageTitle || '');
  // 著者・訳者を1つの文字列にまとめる（例: "新美南吉(著) / 山田太郎(訳)"）
  const byline =
    raw.authors && raw.authors.length
      ? raw.authors
          .map((a) => (a.role ? `${a.name}(${a.role})` : a.name))
          .join(' / ')
      : null;
  return {
    asin,
    notFound,
    swatchText: raw.swatchText,
    productTitle: raw.title,
    authors: raw.authors || [],
    byline,
    releaseDate: raw.releaseDate || null,
    ...parsePrice(raw),
  };
}

/**
 * Kindle ストア（i=digital-text）をタイトル検索し、候補配列を返す。
 * 返り値: [{ asin, title, sponsored }]
 */
async function searchKindle(page, query) {
  const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}&i=digital-text`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await delay(2500);

  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const items = [];
    const cards = document.querySelectorAll(
      'div.s-result-item[data-asin][data-component-type="s-search-result"]'
    );
    for (const c of cards) {
      const asin = c.getAttribute('data-asin');
      if (!asin) continue;
      const titleEl = c.querySelector('h2 a span, h2 span');
      const title = titleEl ? clean(titleEl.innerText) : null;
      const sponsored = /Sponsored|スポンサー/.test(c.innerText || '');
      items.push({ asin, title, sponsored });
    }
    return items;
  });
}

/**
 * 404 等でタイトル検索し、購入可能な Kindle 候補（先頭・広告除外・ASIN が B 始まり）を
 * 1 件解決する。見つからなければ null。
 */
async function resolveByTitle(page, query, excludeAsin) {
  const candidates = await searchKindle(page, query);
  const top = candidates.find(
    (c) => c.asin && /^B/i.test(c.asin) && !c.sponsored && c.asin !== excludeAsin
  );
  return top || null;
}

module.exports = { fetchPrice, searchKindle, resolveByTitle, delay };
