#!/usr/bin/env bash
#
# 受付〜退出〜帳票〜Webhook までを HTTP 越しに確認する。
#
#   npm run build && npm start &
#   bash scripts/smoke.sh
#
# 期待する結果は各ステップのラベルに書いてある。CI の統合テストの叩き台であり、
# 「認証が効いているか」「番号が即解放されないか」など、
# 単体テストでは落ちない結合部分の確認を目的にしている。
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
ADMIN_KEY="${RECEPTION_DEMO_API_KEY:-rk_dev_demo_tenant_key}"
DEVICE_KEY="${RECEPTION_DEMO_DEVICE_KEY:-rk_dev_reception_terminal_key}"
STORE="${RECEPTION_STORE_ID:-sto_osaka}"

ADMIN="Authorization: Bearer $ADMIN_KEY"
TERMINAL="Authorization: Bearer $DEVICE_KEY"
JSON='Content-Type: application/json'

fail=0
# Idempotency-Key は実行ごとに変える。固定にすると2回目以降の実行で
# 初回のレスポンスが再生され、スクリプトが再実行できなくなる。
RUN_ID="$(date +%s)-$$"
c() { curl -s --noproxy '*' "$@"; }
pick() { node -e "process.stdout.write(String(JSON.parse(process.argv[1])$2))" "$1"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  ok   %s\n' "$label"
  else
    printf '  FAIL %s (期待: %s / 実際: %s)\n' "$label" "$expected" "$actual"
    fail=1
  fi
}

echo "== 1. 認証 =="
check "認証なしは401" 401 "$(c -o /dev/null -w '%{http_code}' "$BASE/api/v1/reservations")"
check "不正キーは401" 401 "$(c -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer nope' "$BASE/api/v1/reservations")"
check "端末キーで顧客一覧は403" 403 "$(c -o /dev/null -w '%{http_code}' -H "$TERMINAL" "$BASE/api/v1/customers")"
check "管理キーで顧客一覧は200" 200 "$(c -o /dev/null -w '%{http_code}' -H "$ADMIN" "$BASE/api/v1/customers")"
check "未対応APIバージョンは400" 400 "$(c -o /dev/null -w '%{http_code}' -H "$ADMIN" -H 'X-Api-Version: 1999-01-01' "$BASE/api/v1/stores")"

echo "== 2. ヘルスチェック =="
check "/health" 200 "$(c -o /dev/null -w '%{http_code}' "$BASE/health")"
check "/ready" 200 "$(c -o /dev/null -w '%{http_code}' "$BASE/ready")"

echo "== 3. 端末設定とバージョン =="
CFG=$(c -H "$TERMINAL" -H 'X-Device-Id: dev_osaka_01' "$BASE/api/v1/device/config?storeId=$STORE")
check "受付ボタンが配られる" 3 "$(pick "$CFG" '.data.buttons.length')"
VER=$(c -H "$TERMINAL" "$BASE/api/v1/device/version?platform=android&version=1.0.0")
check "更新あり判定" true "$(pick "$VER" '.data.updateAvailable')"

echo "== 4. 予約と冪等性 =="
BODY="{\"storeId\":\"$STORE\",\"guestName\":\"スモーク太郎\",\"startAt\":\"2030-01-01T01:00:00Z\",\"endAt\":\"2030-01-01T02:00:00Z\",\"reserveNumber\":true}"
RES=$(c -X POST -H "$ADMIN" -H "$JSON" -H "Idempotency-Key: smoke-res-$RUN_ID" -d "$BODY" "$BASE/api/v1/reservations")
NUM=$(pick "$RES" '.data.accessNumber')
QR=$(pick "$RES" '.data.qrToken')
RID=$(pick "$RES" '.data.id')
check "4桁番号が確保される" 4 "${#NUM}"
REPLAY=$(c -o /dev/null -D - -X POST -H "$ADMIN" -H "$JSON" -H "Idempotency-Key: smoke-res-$RUN_ID" -d "$BODY" "$BASE/api/v1/reservations" | grep -ci 'idempotency-replayed: true')
check "同一キーの再送は再生される" 1 "$REPLAY"

echo "== 5. 受付 =="
CI=$(c -X POST -H "$TERMINAL" -H "$JSON" -H 'X-Device-Id: dev_osaka_01' \
  -d "{\"storeId\":\"$STORE\",\"method\":\"qr\",\"qrToken\":\"$QR\"}" "$BASE/api/v1/checkins")
check "受付できる" "$NUM" "$(pick "$CI" '.data.accessNumber')"
check "滞在中になる" in_store "$(pick "$CI" '.data.visit.status')"
DUP=$(c -o /dev/null -w '%{http_code}' -X POST -H "$TERMINAL" -H "$JSON" \
  -d "{\"storeId\":\"$STORE\",\"method\":\"qr\",\"qrToken\":\"$QR\"}" "$BASE/api/v1/checkins")
check "同じ予約の二重受付は409" 409 "$DUP"
N1=$(c -H "$TERMINAL" "$BASE/api/v1/access-numbers/$NUM?storeId=$STORE")
check "番号は利用中" in_use "$(pick "$N1" '.data.status')"

echo "== 6. 退出 =="
CO=$(c -X PATCH -H "$TERMINAL" -H "$JSON" -d "{\"storeId\":\"$STORE\",\"accessNumber\":\"$NUM\"}" "$BASE/api/v1/checkouts")
check "退出できる" exited "$(pick "$CO" '.data.visit.status')"
N2=$(c -H "$TERMINAL" "$BASE/api/v1/access-numbers/$NUM?storeId=$STORE")
check "番号は即解放されず退出済み" exited "$(pick "$N2" '.data.status')"
SW=$(c -X POST -H "$ADMIN" -H "$JSON" -d "{\"storeId\":\"$STORE\"}" "$BASE/api/v1/access-numbers/sweep")
# 解放件数の合計はシードの経過時間で変わる。いま退出した番号が
# 保持時間内に解放されていないことだけを見る。
MINE=$(node -e "
  const d = JSON.parse(process.argv[1]).data;
  process.stdout.write(String(d.released.some((r) => r.number === process.argv[2])));
" "$SW" "$NUM")
check "保持時間内の番号は解放されない" false "$MINE"
check "スイープが途中で落ちていない" 0 "$(pick "$SW" '.data.failures.length')"
N3=$(c -H "$TERMINAL" "$BASE/api/v1/access-numbers/$NUM?storeId=$STORE")
check "退出済みのまま維持される" exited "$(pick "$N3" '.data.status')"

echo "== 7. 帳票 =="
for FORMAT in csv xlsx json; do
  JOB=$(c -X POST -H "$ADMIN" -H "$JSON" -d "{\"resource\":\"visits\",\"format\":\"$FORMAT\"}" "$BASE/api/v1/exports")
  JID=$(pick "$JOB" '.data.id')
  c -X POST -H "$ADMIN" "$BASE/api/v1/exports/$JID/run" > /dev/null
  DONE=$(c -H "$ADMIN" "$BASE/api/v1/exports/$JID")
  check "$FORMAT 生成" succeeded "$(pick "$DONE" '.data.status')"
  URL=$(pick "$DONE" '.data.downloadUrl')
  OUT=$(mktemp)
  c -H "$ADMIN" "$BASE$URL" > "$OUT"
  if [ "$FORMAT" = csv ]; then
    check "CSVはUTF-8 BOM付き" "efbbbf" "$(head -c 3 "$OUT" | od -An -tx1 | tr -d ' \n')"
  elif [ "$FORMAT" = xlsx ]; then
    check "xlsxはZIP形式" "504b" "$(head -c 2 "$OUT" | od -An -tx1 | tr -d ' \n')"
  fi
  rm -f "$OUT"
done

echo "== 8. Webhook =="
EP=$(c -X POST -H "$ADMIN" -H "$JSON" \
  -d '{"url":"https://example.invalid/hook","events":["checkin.completed"]}' \
  "$BASE/api/v1/webhooks/endpoints")
check "エンドポイント登録" 201 "$(c -o /dev/null -w '%{http_code}' -X POST -H "$ADMIN" -H "$JSON" \
  -d '{"url":"https://example.invalid/hook2","events":["checkout.completed"]}' "$BASE/api/v1/webhooks/endpoints")"
check "secretは登録時のみ返る" 43 "$(pick "$EP" '.data.secret.length')"
LIST=$(c -H "$ADMIN" "$BASE/api/v1/webhooks/endpoints")
check "一覧にsecretは含まれない" undefined "$(pick "$LIST" '.data[0].secret')"
check "平文httpは拒否" 400 "$(c -o /dev/null -w '%{http_code}' -X POST -H "$ADMIN" -H "$JSON" \
  -d '{"url":"http://example.com/hook","events":["checkin.completed"]}' "$BASE/api/v1/webhooks/endpoints")"

echo "== 9. 後片付け =="
c -X DELETE -H "$ADMIN" "$BASE/api/v1/reservations/$RID" > /dev/null
c -X DELETE -H "$ADMIN" "$BASE/api/v1/access-numbers/$NUM?storeId=$STORE" > /dev/null
echo "  ok   テストデータを削除"

echo
if [ "$fail" -eq 0 ]; then
  echo "すべて成功しました。"
else
  echo "失敗した項目があります。"
fi
exit "$fail"
