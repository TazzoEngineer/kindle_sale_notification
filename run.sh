#!/usr/bin/env bash
#
# Kindle セール通知 実行ランチャー
#   使い方:
#     ./run.sh                メニューを表示して選択
#     ./run.sh all            取得(全件) → 検知 → 表 を通しで実行
#     ./run.sh login          初回ログイン（手動 2FA）
#     ./run.sh samples        ライブラリを巡回してサンプル一覧を更新
#     ./run.sh batch [N]      サンプル価格を取得（N 件、未指定は全件）
#     ./run.sh detect         価格差分を検知して macOS 通知
#     ./run.sh report         ゴールの表(Markdown/CSV)を出力
#     ./run.sh price ASIN     1冊だけ価格を確認
#
#   定期実行（launchd / macOS）:
#     ./run.sh install [HH:MM]  毎日その時刻に watch を実行するよう登録（既定 09:00）
#     ./run.sh uninstall        登録を解除
#     ./run.sh schedule         登録状況とログの末尾を表示
#     ./run.sh watch            定期実行の本体（samples → batch → detect → report）
#
set -euo pipefail
cd "$(dirname "$0")"

REPO_DIR="$(pwd -P)"
OUT_DIR="$REPO_DIR/poc/out"
SAMPLES_JSON="$OUT_DIR/all_samples.json"
LOG_FILE="$OUT_DIR/watch.log"
LABEL="local.kindle-sale-notification"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DEFAULT_TIME="09:00"

# macOS 通知を1件出す（失敗しても処理は止めない）
notify() {
  local title="${1//\"/ }" message="${2//\"/ }"
  osascript -e "display notification \"$message\" with title \"$title\"" >/dev/null 2>&1 || true
}

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

run_all() {
  local n="${1:-$(sample_count)}"
  echo "▶ 1/3 価格取得（$n 件）..."
  run_batch "$n"
  echo "▶ 2/3 差分検知・通知..."
  run_detect
  echo "▶ 3/3 表を出力..."
  run_report
  echo "✅ 完了: poc/out/report.md / report.csv"
}

# ---- 定期実行（launchd から呼ばれる本体） --------------------------------

run_watch() {
  mkdir -p "$OUT_DIR"
  # ログが 1MB を超えたら 1 世代だけ退避
  if [ -f "$LOG_FILE" ] && [ "$(wc -c <"$LOG_FILE")" -gt 1048576 ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi

  echo "===== $(date '+%Y-%m-%d %H:%M:%S') watch 開始 ====="

  echo "▶ 1/4 サンプル一覧を更新..."
  if ! run_samples; then
    notify "Kindle セール通知: 失敗" "ライブラリを取得できませんでした。再ログインが必要かもしれません（./run.sh login）"
    echo "[中止] サンプル一覧の取得に失敗"
    return 1
  fi
  local n
  n="$(sample_count)"
  if [ "$n" -eq 0 ]; then
    notify "Kindle セール通知: 失敗" "サンプルが 0 件でした。Amazon のセッション切れの可能性があります（./run.sh login）"
    echo "[中止] サンプル 0 件"
    return 1
  fi

  echo "▶ 2/4 価格取得（$n 件）..."
  if ! run_batch "$n"; then
    notify "Kindle セール通知: 失敗" "価格の取得に失敗しました。poc/out/watch.log を確認してください"
    echo "[中止] 価格取得に失敗"
    return 1
  fi

  echo "▶ 3/4 差分検知・通知..."
  if ! run_detect; then
    notify "Kindle セール通知: 失敗" "差分検知に失敗しました。poc/out/watch.log を確認してください"
    echo "[中止] 差分検知に失敗"
    return 1
  fi

  echo "▶ 4/4 表を出力..."
  run_report

  echo "===== $(date '+%Y-%m-%d %H:%M:%S') watch 完了 ====="
}

# ---- launchd への登録 / 解除 / 状態表示 -----------------------------------

# launchd の PATH は最小限なので、node / npm の場所を明示的に渡す
agent_path() {
  local dirs=()
  for bin in node npm nodenv; do
    local p
    p="$(command -v "$bin" 2>/dev/null || true)"
    [ -n "$p" ] && dirs+=("$(dirname "$p")")
  done
  dirs+=(/opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin)
  printf '%s\n' "${dirs[@]}" | awk '!seen[$0]++' | paste -sd: -
}

install_agent() {
  local at="${1:-$DEFAULT_TIME}"
  if [[ ! "$at" =~ ^([0-9]{1,2}):([0-9]{2})$ ]]; then
    echo "時刻は HH:MM で指定してください（例: ./run.sh install 09:00）" >&2
    exit 1
  fi
  local hour=$((10#${BASH_REMATCH[1]})) minute=$((10#${BASH_REMATCH[2]}))
  if [ "$hour" -gt 23 ] || [ "$minute" -gt 59 ]; then
    echo "時刻の範囲が不正です: $at" >&2
    exit 1
  fi

  mkdir -p "$OUT_DIR" "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/run.sh</string>
    <string>watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(agent_path)</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$hour</integer>
    <key>Minute</key>
    <integer>$minute</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST_EOF

  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$PLIST"
  launchctl enable "gui/$UID/$LABEL"
  printf '✅ 登録しました: 毎日 %02d:%02d に実行\n' "$hour" "$minute"
  echo "   plist: $PLIST"
  echo "   ログ : $LOG_FILE"
  echo "   ※ 実行中は Chrome のウィンドウが開きます（ヘッドレス不可のため）"
  echo "   ※ 今すぐ試す: launchctl kickstart gui/$UID/$LABEL"
}

uninstall_agent() {
  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "✅ 登録を解除しました（$PLIST を削除）"
}

agent_status() {
  if [ -f "$PLIST" ]; then
    echo "[plist] $PLIST"
    local h m
    h="$(awk '/<key>Hour<\/key>/{getline; gsub(/[^0-9]/,""); print}' "$PLIST")"
    m="$(awk '/<key>Minute<\/key>/{getline; gsub(/[^0-9]/,""); print}' "$PLIST")"
    printf '[予定] 毎日 %02d:%02d\n' "${h:-0}" "${m:-0}"
  else
    echo "[plist] 未登録（./run.sh install [HH:MM] で登録）"
  fi
  if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
    echo "[状態] launchd に読み込み済み"
  else
    echo "[状態] launchd に未読み込み"
  fi
  if [ -f "$LOG_FILE" ]; then
    echo "[ログ] $LOG_FILE（末尾 10 行）"
    tail -n 10 "$LOG_FILE" | sed 's/^/  /'
  else
    echo "[ログ] まだありません"
  fi
}

menu() {
  cat <<'EOF'
========================================
 Kindle セール通知 ランチャー
========================================
  1) ログイン（初回のみ）
  2) 価格取得（全件）
  3) 価格取得（件数を指定）
  4) 差分検知・通知
  5) 表を出力（ゴール）
  6) 通し実行（取得→検知→表）
  7) 1冊だけ価格確認（ASIN 指定）
  8) サンプル一覧を更新
  ----------------------------------------
  i) 定期実行を登録（毎日）
  s) 定期実行の状態を表示
  u) 定期実行を解除
  q) 終了
----------------------------------------
EOF
  printf "選択してください: "
  read -r choice
  case "$choice" in
    1) run_login ;;
    2) run_batch ;;
    3) printf "取得件数: "; read -r n; run_batch "${n:-$(sample_count)}" ;;
    4) run_detect ;;
    5) run_report ;;
    6) run_all ;;
    7) printf "ASIN: "; read -r asin; run_price "$asin" ;;
    8) run_samples ;;
    i|I) printf "実行時刻 (HH:MM, 既定 $DEFAULT_TIME): "; read -r t; install_agent "${t:-$DEFAULT_TIME}" ;;
    s|S) agent_status ;;
    u|U) uninstall_agent ;;
    q|Q) exit 0 ;;
    *) echo "不明な選択: $choice" ;;
  esac
}

cmd="${1:-menu}"
case "$cmd" in
  menu)      menu ;;
  all)       run_all ;;
  login)     run_login ;;
  samples)   run_samples ;;
  batch)     run_batch "${2:-$(sample_count)}" ;;
  detect)    run_detect ;;
  report)    run_report ;;
  price)     run_price "${2:?ASIN を指定してください}" ;;
  watch)     run_watch ;;
  install)   install_agent "${2:-$DEFAULT_TIME}" ;;
  uninstall) uninstall_agent ;;
  schedule)  agent_status ;;
  *)         echo "不明なコマンド: $cmd"; echo "使い方は run.sh 冒頭のコメントを参照。"; exit 1 ;;
esac
