/**
 * PoC 2.1 - Amazon へのログインができるか検証する。
 *
 * 方針（discussion.md の決定事項）:
 *   - Node.js + Puppeteer（ヘッドフル Chrome）
 *   - 専用プロファイル方式: プロジェクト内の専用 userDataDir を使い、
 *     初回だけ手動ログイン（2FA）→ 以降はセッションを再利用する。
 *     （実 Chrome の Default を直接使うと、実 Chrome 起動中は競合して
 *       WS エンドポイントが出ずタイムアウトするため）
 *   - 2FA / CAPTCHA は人間が手動で突破して Enter する半自動方式
 *
 * 事前準備:
 *   - 特になし（実 Chrome を終了する必要はない）
 *   - 初回は Amazon への手動ログインが必要
 *
 * 実行:
 *   npm run poc:login
 */
const path = require('path');
const readline = require('readline');
const puppeteer = require('puppeteer');

// プロジェクト内の専用プロファイル（.gitignore 済み。ログインセッションを保持）
const PROFILE_DIR = path.join(__dirname, '..', '.chrome-profile');

const AMAZON_TOP = 'https://www.amazon.co.jp/';
// ログイン必須ページ（コンテンツと端末の管理 = Library）
const CONTENT_URL =
  'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/dateDsc/';

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  console.log('[PoC 2.1] Chrome を起動します（専用プロファイル）...');
  console.log('  Profile Dir:', PROFILE_DIR);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      userDataDir: PROFILE_DIR,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
  } catch (err) {
    console.error('[PoC 2.1] Chrome の起動に失敗しました。');
    console.error('  詳細:', err.message);
    process.exit(1);
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja' });

    // 1. Amazon トップを開く
    await page.goto(AMAZON_TOP, { waitUntil: 'domcontentloaded' });
    await delay(2000);

    // 2. 現在のログイン状態を判定（nav の挨拶文）
    const greeting = await readGreeting(page);
    console.log('[PoC 2.1] 現在のヘッダ表示:', JSON.stringify(greeting));

    if (!isLoggedIn(greeting)) {
      console.log(
        '[PoC 2.1] 未ログインのようです。ブラウザ上で手動ログイン（2FA 含む）を完了してください。'
      );
      await askQuestion('ログインが完了したら Enter を押してください... ');
    } else {
      console.log('[PoC 2.1] 既にログイン済みのようです。');
    }

    // 3. ログイン必須ページ（Library）に到達できるか確認
    await page.goto(CONTENT_URL, { waitUntil: 'domcontentloaded' });
    await delay(3000);
    const finalUrl = page.url();
    const redirectedToSignin = /\/ap\/signin/.test(finalUrl);

    const greeting2 = await readGreeting(page);

    console.log('----------------------------------------');
    console.log('[結果] 最終 URL          :', finalUrl);
    console.log('[結果] signin へ誘導された:', redirectedToSignin ? 'はい' : 'いいえ');
    console.log('[結果] ヘッダ表示        :', JSON.stringify(greeting2));

    const loggedIn = !redirectedToSignin && isLoggedIn(greeting2);
    console.log('----------------------------------------');
    console.log(
      loggedIn
        ? '[判定] ✅ 2.1 成功: ログイン状態で Library ページに到達できました。'
        : '[判定] ❌ 2.1 未達: ログイン状態を確認できませんでした。'
    );

    await askQuestion('確認が終わったら Enter を押すとブラウザを閉じます... ');
  } finally {
    await browser.close();
  }
})();

/**
 * ヘッダ（#nav-link-accountList）のテキストを読む。
 * ログイン済み: 「こんにちは、<名前>さん」等
 * 未ログイン  : 「こんにちは、ログイン」等
 */
async function readGreeting(page) {
  try {
    return await page.$eval(
      '#nav-link-accountList',
      (el) => el.innerText.replace(/\s+/g, ' ').trim()
    );
  } catch {
    return null;
  }
}

function isLoggedIn(greetingText) {
  if (!greetingText) return false;
  // 「ログイン」という文字が含まれる = 未ログインの誘導表示
  return !greetingText.includes('ログイン');
}
