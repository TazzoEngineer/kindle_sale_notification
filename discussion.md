# アーキテクチャの検討

> 設計の検討と作業ログ。使い方の概要は [README.md](README.md) を参照。
>
> 本文中の `poc/...` というパスは、後のリファクタで `src/...` に移動している。
> 対応は末尾の「フォルダ構成の整理」を参照。

## 1. 実行環境

- shell を中心に、まずは mac で動けばよい。

## 2. Amazon の情報のハンドリング

- 2.1 Amazon への自分の login を実施できるか。
- 2.2 自分の Library を取得できるか。
- 2.3 自分の Library からサンプルの書籍を取得できるか。
- 2.4 Amazon から書籍の価格、定価、売価、及び還元ポイントを取得できるか。

## 8. 将来構想

- 将来は AWS で動作させてみたい。

---

## 決定事項（アーキテクチャ方針）

参考実装: 社内の別プロジェクト（Puppeteer で認証付き
Web サービスにログインし画面をキャプチャするサンプル）を踏襲する。

### 方式: スクレイピング（Node.js + Puppeteer）

- shell 中心ではなく **Node.js + Puppeteer**（ヘッドフル Chrome 自動操作）を土台にする。
  shell は cron 起動やデプロイの薄いラッパーに留める。
- 参考実装が「方式B（ヘッドフルブラウザ自動操作＋2FA手動突破）」の実例であり、これに倣う。

### 認証（2.1）

- **実 Chrome の Default プロファイルを流用**する（`userDataDir` に指定）。
  普段 Amazon にログイン済みなら起動時点で認証済みになり得る。
- ログインは全自動にせず、**2FA/CAPTCHA は人間が手動で突破して Enter** する半自動方式。
- 注意: Default プロファイル使用時、Chrome を別で開いているとプロファイルロックで
  起動できない場合がある（まずは Default で進める）。

### データ取得方式（2.2〜2.4）

- スクリーンショットではなく **DOM からのテキスト抽出**（`page.evaluate()`）を本命とする。
  価格・定価・売価・還元ポイントを数値で取得し、セール判定に使う。
- 動的描画対策として、参考実装同様に固定 delay 等で描画待ちを行う。

### 運用

- cron で定期実行（参考実装は 15 分毎）。将来は AWS 上での定期実行に発展させる。

---

## PoC 進捗

### 2.1 ログイン: ✅ 成功（PoC: `poc/2.1_login.js`）

- **専用プロファイル方式**を採用（`.chrome-profile/`、gitignore 済み）。
  - 実 Chrome の Default を直接使う方式は、実 Chrome 起動中だと競合し
    `channel:'chrome'` で WS エンドポイントがタイムアウトしたため断念。
  - 専用プロファイルなら実 Chrome を終了せず起動でき、初回手動ログイン
    （2FA 含む）後はセッションが `.chrome-profile/` に永続し再利用できる。
- 検証結果:
  - Library（コンテンツと端末の管理 `/hz/mycd/digital-console/...`）へ
    `signin` にリダイレクトされずに到達。
  - ヘッダ挨拶がアカウント名表示（ログイン済み）に変化。
- 学び:
  - Amazon は接続が途切れず `networkidle2` がハングしやすい →
    `domcontentloaded` + 固定 delay に変更。
  - ログイン判定は `#nav-link-accountList` のテキストに「ログイン」を含むかで判定。

### 2.2 Library 取得 / 2.3 サンプル識別: ✅ 成功（PoC: `poc/2.3_samples.js`）

- 判明した DOM 構造:
  - 一覧: `table.ListLayout-module_table > tbody > tr[role="listitem"]`（1行=1書籍）
  - 総数: `#CONTENT_COUNT`（例「188のうち1から25までの商品を表示しています」）
  - 各行の ID に ASIN が埋め込まれている:
    - タイトル: `content-title-{ASIN}`（`div.digital_entity_title` 内の heading）
    - 著者: `content-author-{ASIN}`
    - 取得日: `content-acquired-date-{ASIN}`
    - チェックボックス: `input#{ASIN}:KindleEBook`
  - サンプル判定: 行内に本文がちょうど「サンプル」のバッジ要素が存在するか。
    （購入済みには無い。ページ上部の絞り込みドロップダウン
    `ContentSubCategoryDropDown` にも「購入済み/サンプル」があり、
    フィルタで samples だけに絞る手も可能）
- 検証結果（ページ1）:
  - 25 件抽出、うち **サンプル 19 件**を ASIN・タイトル・著者・取得日付きで取得。
  - 出力: `poc/out/library_page1.json`, `poc/out/samples_page1.json`
- 残課題:
  - **ページング**（全 188 件 / 25 件ずつ ≒ 8 ページ）の巡回が必要。
  - サンプルのみに絞る場合は絞り込みフィルタの利用も検討。

### 2.4 価格・還元ポイント取得: ✅ 成功（PoC: `poc/2.4_price.js`）

- 商品ページ `https://www.amazon.co.jp/dp/{ASIN}` を開いて DOM 抽出。
- 判明した DOM:
  - フォーマットスワッチ `#tmm-grid-swatch-KINDLE` が最も確実。
    例）`Kindle版 (電子書籍) ￥2,970 (148pt) すぐに購読可能`
    → 正規表現で **Kindle 価格** と **還元ポイント** を同時取得。
  - Kindle 価格ピンポイント: `span.ebook-price-value`（例 `￥2,970`）。
  - セール時の参考価格（定価）: Kindle 価格近傍の取り消し線 `span.a-text-strike`
    に入る想定。売価 < 参考価格なら `onSale = true`。
- 検証結果（B0GX2XQNGK / 非セール書籍）:
  - Kindle 価格 ￥2,970 / 還元ポイント 148pt を取得。参考価格は非セールのため無し。
  - 出力: `poc/out/price_B0GX2XQNGK.json`
- 残課題:
  - **セール中の書籍で参考価格（取り消し線）と割引率の DOM を確定**する
    （非セール書籍では取り消し線が出ないため未確認）。
  - ページ全体には関連商品の価格・取り消し線が多数あるため、
    Kindle 買い物ボックス近傍にスコープを限定して誤検出を防ぐ。

## 現時点の結論

2.1〜2.4 のコア機能はすべて PoC で実証できた。
Node.js + Puppeteer + 専用プロファイルで、
「ログイン → サンプル一覧取得 → 各書籍の価格/ポイント取得 → セール判定」
の一連が技術的に成立する。

### ページング全巡回: ✅ 成功（PoC: `poc/2.3_all_samples.js`）

- `#pagination > a.page-item`（`page-1`..`page-N`）を順にクリックし、
  先頭行 ASIN の変化で再描画完了を検知して全ページ抽出。
- 結果: 全 8 ページ・**188 件（ユニーク）**を巡回、**サンプル 149 件**を収集。
- 出力: `poc/out/all_books.json`, `poc/out/all_samples.json`

### 一括価格取得（149件）と重要な発見（PoC: `poc/2.4_batch.js`）

- サンプル 149 件すべての商品ページから価格・ポイントを取得。
- **取り消し線（値引き）は 0 件**。しかし **ポイント還元率が極端に高い本が多数**存在。
  - 例）春かずら ￥2,299 / 1,150pt（約 50%）、謎のアジア納豆 ￥970 / 485pt（50%）、
    論争 関ヶ原合戦 ￥1,650 / 825pt（50%）。通常本は還元率 ~1%。
- **重要な学び: Kindle のセールは「価格の値引き」より「ポイント高還元（実質値引き）」で
  行われることが多い。** よって「セール判定」は取り消し線だけでなく
  **ポイント還元率（points / price）が閾値以上か**も条件に含めるべき。
- 精度課題:
  - **￥0 表示（6件）**: 読み放題(Kindle Unlimited)/無料本で `.ebook-price-value` が
    別要素を拾っている疑い。
  - **￥null（6件）**: フォーマットスワッチが無いレイアウトの本で価格未取得。
    （BUTTER, 白鶴亮翅, ツミデミック, ハンチバック 等）
- 出力: `poc/out/prices.json`, `poc/out/prices_onsale.json`

### 抽出ロジックの修正（￥0 / KU 対応）: ✅

- **原因確定**: 読み放題(Kindle Unlimited)対象本ではスワッチが
  `Kindle版 (電子書籍) ￥0 または￥561 (281pt)で購入` の形になり、
  従来は先頭の「￥0」（KU価格）を拾っていた。
- **修正**: 購入価格は必ず「`(NNNpt)` の直前の ￥金額」を採用する共通ロジックに変更。
  正規表現 `/￥([0-9,]+)\s*\(([0-9,]+)\s*pt\)/` で **購入価格＋還元ポイントを一体取得**。
  通常本・KU本の双方で正しく取れる。`￥0 または` 検出で `isKindleUnlimited` フラグも付与。
- 共通化: `poc/lib/parsePrice.js` に抽出＋セール判定を集約し、
  `poc/2.4_price.js` / `poc/2.4_batch.js` の両方から利用（ロジック重複を排除）。
- 検証: `B0CYZ95626`（ごんぎつね）→ **￥561 / 281pt（50%）/ KU対象 → 高還元セール** と正しく判定。
- 404 検出: `document.title` に「ページが見つかりません」を含む場合 `notFound=true` を付与
  （タイトル検索フォールバックは次段で実装）。

### セール判定の再定義（設計方針）

- `セール = (参考価格 > 売価) OR (ポイント還元率 >= 閾値%)` とする。
  - 還元率の閾値は要調整（例: 20%）。通常 ~1% と高還元 ~50% は明確に分離できる。
- 定期実行では「前回取得値」と比較し、価格下落 or 還元率上昇を検知して通知する案も有効。

### セールの2形態（ユーザー確認済み）

- Kindle のセールには2形態あり、**両方を検知対象**とする:
  - ケースA: **ポイント高還元**（実質値引き）→ 還元率で判定。
  - ケースB: **売価そのものの値引き**（参考価格 > 売価、取り消し線）→ 価格差で判定。
- 追加の精度課題（要対応）:
  - **一部のサンプル ASIN は `/dp/{ASIN}` が 404**（例: 白鶴亮翅 B0C3V9LJVZ =
    「ページが見つかりません」）。ライブラリのサンプル ASIN が購入可能な
    商品ページに直接解決しない版・フォーマット差がある。
    → **タイトル検索でのフォールバック**が必要。
  - ケースB の値引きレイアウト DOM は、実際に値引き中の書籍で要確認
    （今回のサンプルには値引き中の本が無く未確認）。

### 一括再取得（149件・修正版）の結果: ✅

- ￥0 修正後に全 149 件を再取得。**￥0 は解消**（KU本も正しい購入価格を取得）。
- **セール（高還元）は 40 件**検出（還元率 30〜50%）。値引き（取り消し線）は 0 件。
- **404 は 6 件**（購入可能な `/dp/` に解決しないサンプル）:
  - BUTTER `B083K1ZZN6` / 白鶴亮翅 `B0C3V9LJVZ` / ツミデミック `B0CLL1KXZ1`
  - 寝煙草の危険 `B0C5HR3N9M` / ハンチバック `B0C7TQPKWW` / 黄金比の縁 `B0C6TG6BKN`
  - → いずれもタイトル検索フォールバックで別 ASIN 解決が必要。

### 堅牢性の修正（detached Frame 対策）: ✅

- **事象**: 一括取得の途中（131件目付近）で `Attempted to use detached Frame` が発生し、
  以降の全件が同じ落ちた `page` を使い回して連鎖失敗（19件）。
  Amazon 側の遷移/タブ落ちで page の実行コンテキストが切れたことが原因。
- **修正**: 一括処理でエラーが `detached Frame`/`Target closed` 等の回復可能系なら
  **`page` を作り直して同一 ASIN を 1 回だけ再試行**する（`poc/2.4_batch.js`）。
  再取得で当該 19 件はすべて正常取得できることを確認。
- **注意（運用メモ）**: `--start`/`--limit` を付けた部分実行は `prices.json` を
  その範囲だけで上書きする。全件のクリーンなデータが必要なときは全件実行する。

### 404 タイトル検索フォールバック: ✅（PoC: `poc/2.4_search_fallback.js`）

- `/dp/{ASIN}` が 404 の本は、Kindle ストア検索（`/s?k=...&i=digital-text`）で
  タイトル解決する。検索結果カード `div.s-result-item[data-asin]` から
  広告（スポンサー）を除外し、先頭候補の ASIN を採用 → 価格取得。
- 検証: 「ハンチバック」原 ASIN `B0C7TQPKWW`（文春e-book）は 404 だが、
  検索で文春文庫版 `B0FSKDF357` に解決 → **￥660 / 330pt（50%）= 高還元セール**を取得。
- 残課題: 候補が複数版（文庫/単行本/e-book）ある場合の**最適候補選択**（タイトル類似度・
  著者一致・最安/最新など）は要検討。現状は先頭候補を採用する簡易版。
- 実行: `npm run poc:search -- "タイトル 著者"`

### 404 フォールバックの一括処理への統合: ✅

- 共通ライブラリ `poc/lib/amazon.js`（`fetchPrice` / `searchKindle` / `resolveByTitle`）を新設し、
  `2.4_batch.js` / `2.4_price.js` / `2.4_search_fallback.js` の重複コードを排除。
- **一括処理（`2.4_batch.js`）で 404 を検出したら、自動でタイトル検索フォールバック**を実行し、
  購入可能 ASIN を解決して価格を再取得する。結果には `sampleAsin`（元）・`resolvedAsin`（解決先）を記録。
- `--no-fallback` でフォールバック無効化も可能。
- 検証（index 140–141 の 404 本 2 件）:
  - 寝煙草の危険 `B0C5HR3N9M` → `B0FGP825RR` に解決（￥2701 / 27pt）。
  - ハンチバック `B0C7TQPKWW` → `B0FSKDF357` に解決（￥660 / 330pt = 高還元セール）。
  - サマリ表示: `[404] 0 件（フォールバック解決 2 件）`。

### 2.5 差分検知＆通知: ✅（PoC: `poc/2.5_detect.js`）

- 前回スナップショット `price_history.json` と今回 `prices.json` を比較し、
  以下を「通知対象」として検出:
  - **新規セール入り**: 今回 onSale かつ前回 非onSale（初回はセール中のものを拾う）。
  - **値下がり**: 今回売価 < 前回売価。
  - **還元率アップ**: 今回還元率が前回 + 閾値（既定 `+10pt`）以上に上昇。
- 通知は **macOS 通知（osascript）** ＋ `notifications.json` 出力。実行後、履歴を今回値で更新。
- `--dry` は通知を送らず、**履歴/通知ファイルも更新しない**（状態を変えない安全な確認用）。
- 検証（履歴を細工した非破壊シミュレーション）:
  - `B00UFF0HG2` → 「新規セール / 値下がり ￥1200→￥1012 / 還元率 1%→50%」を検出。
  - `B09SK657LR` → 「値下がり ￥3500→￥3018」を検出。
  - 変化なしの回は通知 0 件（誤検知なし）。
- 実行: `npm run poc:detect`（通知あり） / `npm run poc:detect -- --dry`（確認のみ）

### PoC 全体の到達点

「ログイン → サンプル一覧 → 価格/ポイント取得（KU・404対応）→ セール判定（値引き/高還元）
→ 前回との差分検知 → 通知」の一連が PoC で成立。定期実行（cron）→ 将来 AWS へ発展可能。

### 取り消し線の誤判定対策（紙の本の価格 vs Kindle 値引き）: ✅

- **ユーザー指摘**: 取り消し線は「紙の本の価格 → Kindle 価格」の**差額表示**でも出る。
  これは Kindle の値引き（ケースB）ではないため、セール判定に使ってはいけない。
- **DOM 確認**（保存済み商品HTMLを解析）:
  - 主買い物ボックスの取り消し線は `span.a-price.apex-basisprice-value`（`data-a-strike="true"`）、
    ラベルは `apex-basisprice-label`「紙の本の価格：」、割引率は `savingspercentagedisplaystring`
    （＝紙比の %。例 2%）。これは常時表示される**紙版比較**であり値引きではない。
  - `a-text-strike` の多くは**関連商品カルーセル**（`d_rd_i=`）内の他書籍の紙価格だった。
- **修正**（`poc/lib/amazon.js` + `poc/lib/parsePrice.js`）:
  - 取り消し線抽出を買い物ボックス（`#centerCol/#rightCol/#buybox`）にスコープし、
    **`apex-basisprice`（紙価格）とカルーセル、周辺に「紙の本」を含む要素を除外**。
  - 残った「本物の Kindle 参考価格」だけを `listPrice`（ケースB判定用）に採用。
  - 紙の本の価格は `paperPrice` として**参考情報のみ**保持（セール判定に不使用）。
  - `2.4_price.js` も共通 `fetchPrice` を使うよう統一。
- **検証**（B0CYZ95626）: Kindle ￥561 / 参考価格「なし・非値引き」/ 紙の本 ￥572（判定外）/
  高還元のみでセール判定 → **紙比較を値引きと誤認しないことを確認**。
- 残課題: 実際に Kindle 値引き中の本で、本物の参考価格の取り消し線 DOM を最終確認する。

### セール判定の最終定義（ユーザー確定）: ✅

- **重要な3値**: 「紙の本の価格（＝定価扱い）」「Kindle 価格（売価）」「獲得ポイント」。
- **実質割引率 = (紙 − Kindle + ポイント) / 紙**。
  - 紙版が無い本（紙価格なし）は基準が無いため、ポイント還元率（ポイント/Kindle）で代替。
  - `セール = 実質割引率 >= 閾値`（既定 20%。`SALE_THRESHOLD`）。
- ケースA/ケースB を分けず、**この単一指標に統合**（紙の本の価格を定価とみなし、
  Kindle 価格を割引後価格、ポイントを追加値引きとして扱う）。
- 実装:
  - `poc/lib/parsePrice.js`: `paperPrice` / `kindlePrice` / `points` / `discountRate` / `onSale` を返す。
  - `poc/lib/amazon.js`: 紙の本の価格 `apex-basisprice-value` を買い物ボックス内から取得。
  - `2.4_batch.js` / `2.4_price.js` / `2.5_detect.js` を新指標（実質割引率）に統一。
    差分検知は「値下がり」「実質割引率アップ（+10pt）」「新規セール」で通知。
- **検証**（B0CYZ95626）: 紙 ￥572 / Kindle ￥561 / 281pt →
  実質割引率 (572−561+281)/572 = **51%** → セール中。

### ゴール出力（表）: ✅（PoC: `poc/2.6_report.js`）

- `prices.json` から次のヘッダの表を **Markdown / CSV** で出力（割引率の降順）:
  **割引率 / 紙の本の価格 / Kindle価格 / 獲得ポイント / タイトル / 著者、訳者 / 発売日**
- 追加抽出（`poc/lib/amazon.js` の `fetchPrice`）:
  - 著者・訳者: `#bylineInfo .author`（名前＋`.contribution`の役割「(著)」「(翻訳)」）→ `byline`。
  - 発売日: `rpi-attribute-book_details-publication_date` の値、無ければ本文「発売日 : YYYY/M/D」。
- 実行: `npm run poc:report`（全件） / `npm run poc:report -- --sale`（セールのみ）。
- 出力: `poc/out/report.md` / `poc/out/report.csv`（Excel 用 BOM 付き）。
- 検証（先頭5件）: 全カラムが正しく出力。著者・訳者・発売日も取得（例: 上野千鶴子(著) /
  アグネス・チャン(著)、2026/4/7）。
- **紙価格の誤取得バグ修正** ✅: 紙版比較の無いページで、`document` 全体フォールバックが
  カルーセル（関連本）の `apex-basis-price-value` を拾い、無関係な安い価格を「紙の本の価格」に
  してしまう不具合があった（例 B0GX2XQNGK: 誤 ¥1,540 → 実質-83%）。
  「紙の本の価格：」ラベル `apex-basisprice-label` が存在する時のみ紙価格を採用するよう修正。
  修正後 B0GX2XQNGK は紙価格なし→ポイント還元率5%、B0CYZ95626 は紙¥572/51% のまま。
  ※ 紙 < Kindle（割引率が負）は理論上あり得るが稀。極端な負値は抽出ミスの疑いが濃い。

### 定期実行（launchd）: ✅ → 後に撤回（次節参照）

> この節は「毎日 09:00 に全件クロール」を実装した時点の記録。
> 方針変更により launchd 対応は削除済み。現在の構成は次節「RSS 起点」を参照。

- **課題**: PoC は `run.sh` を人が叩いたときにしか動かず、「セールになったら教えてくれる」
  という当初の狙いを満たしていなかった（通知自体は `2.5_detect.js` で実装済みだが、
  起動する人がいなかった）。
- **実装**: macOS の LaunchAgent を `run.sh` から生成・登録する。
  - `./run.sh install [HH:MM]`（既定 09:00）→ `~/Library/LaunchAgents/local.kindle-sale-notification.plist`
    を生成し `launchctl bootstrap gui/$UID` で登録。`uninstall` / `schedule`（状態表示）も用意。
  - ジョブの本体は `./run.sh watch` = サンプル一覧の更新 → 全件の価格取得 → 差分検知・通知 → 表の出力。
  - ログは `poc/out/watch.log`（1MB 超で 1 世代退避）。
- **ハマりどころ**: **launchd の PATH は `/usr/bin:/bin:/usr/sbin:/sbin` しかない**ため、
  nodenv/homebrew 配下の `node` / `npm` が見つからずジョブが即死する。
  install 時に `command -v node/npm/nodenv` から解決したディレクトリを
  plist の `EnvironmentVariables > PATH` に焼き込むことで回避した。
- **セッション切れの扱い**: ライブラリ取得に失敗、またはサンプル 0 件なら
  「再ログインが必要」という macOS 通知を出して中断する（無言で失敗させない）。
- **制約**: Amazon がヘッドレスを弾くため実行中は Chrome のウィンドウが開く。
  全件（約 150 冊）で 10 分前後。Mac がスリープしていれば復帰後に launchd が実行する。

### 定期実行をやめ、RSS 起点（GitHub Actions）に変更: ✅

- **経緯**: launchd で毎日 09:00 に全件クロールする形にしたが、
  「定期実行は望ましくない。セール情報の RSS をキャッチしたときだけ実行したい」との方針変更。
  さらに「GitHub Actions で動かせないか」という要望。
- **調査結果**:
  - **Amazon 公式の Kindle セール RSS は存在しない**（RSS 提供は終了済み）。
  - 使えるフィード: きんどう `kindou.info/feed`、Google ニュース検索 RSS、はてブ検索 RSS。
  - **どのフィードも ASIN を持たない。** きんどうの記事ページ本文も確認したが、
    静的 HTML に ASIN は 1 個しか出ず（残りは JS 描画）、
    「フィードに載った本 ↔ 自分のサンプル」の突き合わせはできない。
    → **RSS は「きっかけ」としてのみ使い、何が安いかは手元の価格チェックで判定する。**
- **Actions に載せられる範囲**:
  - 載る: RSS のポーリング、キーワード判定、Issue による通知。
  - 載らない: ライブラリ取得（Amazon のログインセッションが必要。
    データセンター IP では CAPTCHA/2FA を突破できない）、macOS 通知。
  - よって **検知は Actions、価格チェックは Mac** の分業とした。
    蔵書リスト（`all_samples.json`）はリポジトリに置かず、Actions にも渡さない。
- **キーワード設計が肝**: 「50%還元」等はマンガのセール記事にほぼ毎回付き、
  実測で 20 件中 9 件が該当してしまった（1日 6〜10 回発火）。
  自分の読書帯（文庫/新書/選書/学術文庫/岩波/早川/文春/新潮/均一/半額）に寄せ、
  ラノベ・異世界・コミックを除外したところ、通常時 0 件・
  出版社の文庫/新書フェア時のみ発火する挙動になった。
  （検証: 期間を広げると「講談社499円均一セール 新書大賞」「新潮文庫nex 99円」
  「早川書房 夏のKindle超ビッグセール」等を正しく拾えた）
- **ハマりどころ**: はてブの検索 RSS は RSS 1.0(RDF) で日付が `<dc:date>` にあり、
  `pubDate` しか見ていなかったため 2023〜2025 年の古い記事が「新着」として通過していた。
  `dc:date` に対応し、日付が読めないエントリは既定で無視するようにした。
- 実装: `scripts/check_feed.js` / `feed.config.json` / `.github/workflows/sale-watch.yml`。
  既読管理は `.github/feed_state.json`（通知済み GUID のみ、最大 300 件）。

### フォルダ構成の整理（poc → src）: ✅

- PoC の名残で `poc/` に本体・共通ライブラリ・生成物が同居し、隣に `scripts/` もあって
  ちぐはぐだったため、役割で分けた。ファイル名の `2.1_` 等の番号（この文書の章番号由来）も外した。

| 変更前 | 変更後 |
| --- | --- |
| `poc/2.1_login.js` | `src/steps/login.js` |
| `poc/2.3_all_samples.js` | `src/steps/samples.js` |
| `poc/2.4_batch.js` | `src/steps/prices.js` |
| `poc/2.4_price.js` | `src/steps/price.js` |
| `poc/2.5_detect.js` | `src/steps/detect.js` |
| `poc/2.6_report.js` | `src/steps/report.js` |
| `poc/lib/*.js` | `src/lib/*.js` |
| `scripts/check_feed.js` | `src/feed/check_feed.js` |
| `poc/2.3_inspect.js` | `src/tools/inspect_library.js` |
| `poc/2.4_price_inspect.js` | `src/tools/inspect_price.js` |
| `poc/2.4_search_fallback.js` | `src/tools/search_fallback.js` |
| `poc/2.1_evidence.js` | `src/tools/evidence.js` |
| `poc/2.3_samples.js` | `src/tools/samples_page1.js` |
| `poc/out/` | `out/` |

- npm スクリプトも `poc:batch` → `prices` のように整理（調査用は `tool:` 接頭辞）。
- 追随させた箇所: 各スクリプト内の `__dirname` 基準のパス（1 階層深くなった）、
  `require` の相対パス、ログに出すパス表記、`run.sh`、`.gitignore`、
  `.github/workflows/sale-watch.yml`、README。
