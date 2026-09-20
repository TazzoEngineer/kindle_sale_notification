#!/usr/bin/env bash
#
# Kindle セール通知 実行ランチャー
#
#   セール情報は GitHub Actions がフィードを監視し、該当があれば Issue で知らせる。
#   その通知を受け取ったら、このスクリプトで手元の価格チェックを回す。
#
#   使い方:
#     ./run.sh              メニューを表示して選択
#     ./run.sh all          一覧更新 → 価格取得 → 差分検知・通知 → 表 を通しで実行
#     ./run.sh login        初回ログイン（手動 2FA）
#     ./run.sh samples      ライブラリを巡回してサンプル一覧を更新
#     ./run.sh batch [N]    サンプル価格を取得（N 件、未指定は全件）
#     ./run.sh detect       価格差分を検知して macOS 通知
#     ./run.sh report       ゴールの表(Markdown/CSV)を出力
#     ./run.sh price ASIN   1冊だけ価格を確認
#     ./run.sh feed         セール情報フィードを手元で確認（Actions と同じ判定）
#
set -euo pipefail
cd "$(dirname "$0")"

REPO_DIR="$(pwd -P)"
OUT_DIR="$REPO_DIR/poc/out"
SAMPLES_JSON="$OUT_DIR/all_samples.json"

# all_samples.json の件数（無ければ 0）
sample_count() {
  node -e 'try{const a=require(process.argv[1]);console.log(Array.isArray(a)?a.length:0)}catch(e){console.log(0)}' \
    "$SAMPLES_JSON" 2>/dev/null || echo 0
}

run_login()   { npm run poc:login; }
run_samples() { npm run poc:all-samples; }
run_batch()   { npm run poc:batch -- --limit="${1:-$(sample_count)}"; }
run_detect()  { npm run poc:detect; }
run_report()  { npm run poc:report; }
run_price()   { npm run poc:price -- "$1"; }
run_feed()    { node scripts/check_feed.js "$@"; }

run_all() {
  echo "▶ 1/4 サンプル一覧を更新..."
  run_samples
  local n
  n="$(sample_count)"
  if [ "$n" -eq 0 ]; then
    echo "[中止] サンプルが 0 件です。Amazon のセッション切れかもしれません（./run.sh login）" >&2
    exit 1
  fi
  echo "▶ 2/4 価格取得（$n 件）..."
  run_batch "$n"
  echo "▶ 3/4 差分検知・通知..."
  run_detect
  echo "▶ 4/4 表を出力..."
  run_report
  echo "✅ 完了: poc/out/report.md / report.csv"
}

menu() {
  cat <<'EOF'
========================================
 Kindle セール通知 ランチャー
========================================
  1) 通し実行（一覧更新→取得→検知→表）
  2) ログイン（初回のみ）
  3) サンプル一覧を更新
  4) 価格取得（全件）
  5) 価格取得（件数を指定）
  6) 差分検知・通知
  7) 表を出力（ゴール）
  8) 1冊だけ価格確認（ASIN 指定）
  9) セール情報フィードを確認
  q) 終了
----------------------------------------
EOF
  printf "選択してください: "
  read -r choice
  case "$choice" in
    1) run_all ;;
    2) run_login ;;
    3) run_samples ;;
    4) run_batch ;;
    5) printf "取得件数: "; read -r n; run_batch "${n:-$(sample_count)}" ;;
    6) run_detect ;;
    7) run_report ;;
    8) printf "ASIN: "; read -r asin; run_price "$asin" ;;
    9) run_feed --dry ;;
    q|Q) exit 0 ;;
    *) echo "不明な選択: $choice" ;;
  esac
}

cmd="${1:-menu}"
case "$cmd" in
  menu)    menu ;;
  all)     run_all ;;
  login)   run_login ;;
  samples) run_samples ;;
  batch)   run_batch "${2:-$(sample_count)}" ;;
  detect)  run_detect ;;
  report)  run_report ;;
  price)   run_price "${2:?ASIN を指定してください}" ;;
  feed)    shift; run_feed "$@" ;;
  *)       echo "不明なコマンド: $cmd"; echo "使い方は run.sh 冒頭のコメントを参照。"; exit 1 ;;
esac
