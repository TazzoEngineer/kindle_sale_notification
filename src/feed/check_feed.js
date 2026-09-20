/**
 * Kindle セール情報フィードの監視。
 *   設定（feed.config.json）の各フィードを取得し、
 *     - キーワードに該当する
 *     - まだ通知していない（.github/feed_state.json に無い）
 *     - 新しい（maxAgeHours 以内）
 *   エントリだけを「検知」として出力する。
 *
 * 依存なし（Node 18+ の fetch を使う）。GitHub Actions からもローカルからも動く。
 *
 * 実行:
 *   node scripts/check_feed.js            # 検知したら state を更新する
 *   node scripts/check_feed.js --dry      # state を更新しない（確認用）
 *
 * 出力:
 *   標準出力にサマリ、out/feed_matched.json に検知内容。
 *   GITHUB_OUTPUT があれば count / title を書き出す（Actions 用）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT, 'feed.config.json');
const STATE_FILE = path.join(ROOT, '.github', 'feed_state.json');
const OUT_DIR = path.join(ROOT, 'out');
const MATCHED_FILE = path.join(OUT_DIR, 'feed_matched.json');
const SUMMARY_FILE = path.join(OUT_DIR, 'feed_summary.md');
const DRY = process.argv.includes('--dry');
// 動作確認用: 対象期間を一時的に広げる（例 --max-age=100000）
const MAX_AGE_OVERRIDE = (() => {
  const a = process.argv.find((x) => x.startsWith('--max-age='));
  return a ? Number(a.split('=')[1]) : null;
})();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** <![CDATA[...]]> と実体参照をほどく */
function unwrap(text) {
  if (text == null) return '';
  let s = String(text).replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unwrap(m[1]) : null;
}

/** RSS 2.0 / Atom のどちらでも item を取り出す */
function parseFeed(xml, feedName) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const link =
      tag(b, 'link') ||
      (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] ||
      null;
    // RSS 2.0 は pubDate、Atom は updated/published、RSS 1.0(RDF) は dc:date
    const dateText =
      tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date');
    const published = dateText ? new Date(dateText) : null;
    return {
      feed: feedName,
      title: tag(b, 'title') || '(無題)',
      link,
      guid: tag(b, 'guid') || tag(b, 'id') || link,
      published: published && !isNaN(published) ? published.toISOString() : null,
    };
  });
}

function matchedKeywords(title, keywords) {
  const t = title.toLowerCase();
  return keywords.filter((k) => t.includes(String(k).toLowerCase()));
}

(async () => {
  const config = readJson(CONFIG_FILE, null);
  if (!config) {
    console.error(`[中止] ${CONFIG_FILE} を読めません`);
    process.exit(1);
  }
  const keywords = config.keywords || [];
  const excludes = config.excludeKeywords || [];
  const maxAgeMs = (MAX_AGE_OVERRIDE ?? config.maxAgeHours ?? 48) * 3600 * 1000;
  const state = readJson(STATE_FILE, { seen: [] });
  const seen = new Set(state.seen || []);

  const entries = [];
  for (const feed of config.feeds || []) {
    try {
      const res = await fetch(feed.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        console.error(`[警告] ${feed.name}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseFeed(xml, feed.name);
      console.log(`[取得] ${feed.name}: ${items.length} 件`);
      entries.push(...items);
    } catch (err) {
      // 1つのフィードの失敗で全体を止めない
      console.error(`[警告] ${feed.name}: ${err.message}`);
    }
  }

  const now = Date.now();
  const matched = [];
  for (const e of entries) {
    if (!e.guid || seen.has(e.guid)) continue;
    if (!e.published) {
      // 日付が読めないエントリは古い記事の可能性があるので既定では通さない
      if (!config.allowUndated) continue;
    } else if (now - Date.parse(e.published) > maxAgeMs) {
      continue;
    }
    if (excludes.some((k) => e.title.toLowerCase().includes(String(k).toLowerCase()))) continue;
    const hits = matchedKeywords(e.title, keywords);
    if (hits.length === 0) continue;
    matched.push({ ...e, keywords: hits });
  }

  console.log('========================================');
  console.log(`[検知] ${matched.length} 件（走査 ${entries.length} 件 / 既知 ${seen.size} 件）`);
  for (const m of matched) {
    console.log(`  🔔 ${m.title}`);
    console.log(`      該当: ${m.keywords.join(', ')} / ${m.link}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(MATCHED_FILE, JSON.stringify(matched, null, 2));

  const summary = matched.length
    ? [
        'Kindle のセール情報フィードに、ウォッチ対象のキーワードを含む記事が出ました。',
        '',
        ...matched.map(
          (m) => `- [${m.title}](${m.link})\n  - 該当キーワード: ${m.keywords.join(', ')}（${m.feed}）`
        ),
        '',
        '---',
        '',
        '手元の Mac で以下を実行すると、サンプル書籍の価格を取り直して差分を通知します。',
        '',
        '```sh',
        './run.sh all',
        '```',
      ].join('\n')
    : '';
  fs.writeFileSync(SUMMARY_FILE, summary);

  if (!DRY && matched.length > 0) {
    const nextSeen = [...(state.seen || []), ...matched.map((m) => m.guid)];
    const trimmed = nextSeen.slice(-(config.maxStateEntries ?? 300));
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ updatedAt: new Date().toISOString(), seen: trimmed }, null, 2) + '\n'
    );
    console.log(`[保存] ${path.relative(ROOT, STATE_FILE)}（既知 ${trimmed.length} 件）`);
  } else if (DRY) {
    console.log('[--dry] state は更新していません。');
  }

  if (process.env.GITHUB_OUTPUT) {
    const title = matched.length
      ? `Kindle セール検知: ${matched[0].title}${matched.length > 1 ? ` ほか${matched.length - 1}件` : ''}`
      : '';
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `count=${matched.length}\ntitle=${title.replace(/\n/g, ' ')}\n`
    );
  }
})();
