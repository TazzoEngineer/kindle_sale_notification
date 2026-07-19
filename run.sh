#!/usr/bin/env bash
#
# Kindle セール通知 PoC 手動実行ランチャー
#   使い方:
#     ./run.sh            メニューを表示して選択
#     ./run.sh all        取得(全件) → 検知 → 表 を通しで実行
#     ./run.sh login      初回ログイン
#     ./run.sh batch [N]  サンプル価格を取得（N件、未指定は全件149）
#     ./run.sh detect     価格差分を検知して通知
#     ./run.sh report     ゴールの表(Markdown/CSV)を出力
#     ./run.sh price ASIN 1冊だけ価格を確認
#
set -euo pipefail
cd "$(dirname "$0")"

ALL=149

run_login()  { npm run poc:login; }
run_batch()  { npm run poc:batch -- --limit="${1:-$ALL}"; }
run_detect() { npm run poc:detect; }
run_report() { npm run poc:report; }
run_price()  { npm run poc:price -- "$1"; }

run_all() {
  echo "▶ 1/3 価格取得（全 $ALL 件）..."
  run_batch "$ALL"
  echo "▶ 2/3 差分検知・通知..."
  run_detect
  echo "▶ 3/3 表を出力..."
  run_report
  echo "✅ 完了: poc/out/report.md / report.csv"
}

menu() {
  cat <<'EOF'
========================================
 Kindle セール通知 PoC ランチャー
========================================
  1) ログイン（初回のみ）
  2) 価格取得（全件）
  3) 価格取得（件数を指定）
  4) 差分検知・通知
  5) 表を出力（ゴール）
  6) 通し実行（取得→検知→表）
  7) 1冊だけ価格確認（ASIN 指定）
  q) 終了
----------------------------------------
EOF
  printf "選択してください: "
  read -r choice
  case "$choice" in
    1) run_login ;;
    2) run_batch "$ALL" ;;
    3) printf "取得件数: "; read -r n; run_batch "${n:-$ALL}" ;;
    4) run_detect ;;
    5) run_report ;;
    6) run_all ;;
    7) printf "ASIN: "; read -r asin; run_price "$asin" ;;
    q|Q) exit 0 ;;
    *) echo "不明な選択: $choice" ;;
  esac
}

cmd="${1:-menu}"
case "$cmd" in
  menu)   menu ;;
  all)    run_all ;;
  login)  run_login ;;
  batch)  run_batch "${2:-$ALL}" ;;
  detect) run_detect ;;
  report) run_report ;;
  price)  run_price "${2:?ASIN を指定してください}" ;;
  *)      echo "不明なコマンド: $cmd"; echo "使い方は run.sh 冒頭のコメントを参照。"; exit 1 ;;
esac
