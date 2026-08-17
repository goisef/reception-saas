#!/usr/bin/env bash
#
# 共有URLのパスワード管理と、デモ環境の即時公開/非公開。
#
#   npm run password:show -- demo     現在のパスワードを表示
#   npm run password:set  -- demo     新しいパスワードを設定して反映
#   npm run demo:offline              デモを即時非公開（URLを知っていても403）
#   npm run demo:online               デモを再公開
#
# パスワードは Secret Manager に置く (PRD 13-4)。
# リポジトリにも開発者PCにも平文を残さない。
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-northeast1}"

if [ -z "$PROJECT" ]; then
  echo "GCP_PROJECT_ID を設定してください（例: export GCP_PROJECT_ID=my-project）" >&2
  exit 1
fi

need_gcloud() {
  command -v gcloud >/dev/null || {
    echo "gcloud が見つかりません。https://cloud.google.com/sdk/docs/install" >&2
    exit 1
  }
}

# 環境名 -> シークレット名 / サービス名
secret_name() { echo "reception-$1-password"; }
service_name() { echo "reception-saas-$1"; }

usage() {
  cat >&2 <<'USAGE'
使い方:
  access-control.sh show <dev|demo>
  access-control.sh set  <dev|demo>
  access-control.sh offline
  access-control.sh online
USAGE
  exit 1
}

require_env() {
  case "${1:-}" in
    dev | demo) ;;
    *) echo "環境は dev か demo を指定してください" >&2; exit 1 ;;
  esac
}

cmd="${1:-}"
shift || true

case "$cmd" in
  show)
    need_gcloud
    require_env "${1:-}"
    gcloud secrets versions access latest \
      --secret="$(secret_name "$1")" --project="$PROJECT"
    echo
    ;;

  set)
    need_gcloud
    require_env "${1:-}"
    ENV_NAME="$1"
    # 端末に残らないよう履歴に出さない形で読む
    read -r -s -p "新しいパスワード: " PW1; echo
    read -r -s -p "もう一度入力: " PW2; echo
    if [ "$PW1" != "$PW2" ]; then
      echo "一致しません。中止しました。" >&2
      exit 1
    fi
    if [ ${#PW1} -lt 8 ]; then
      echo "8文字以上にしてください。" >&2
      exit 1
    fi

    SECRET="$(secret_name "$ENV_NAME")"
    if ! gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
      gcloud secrets create "$SECRET" --replication-policy=automatic --project="$PROJECT"
    fi
    printf '%s' "$PW1" | gcloud secrets versions add "$SECRET" --data-file=- --project="$PROJECT"

    # Cloud Run は起動時にシークレットを読むため、新リビジョンを出さないと
    # 反映されない。ここまでやって初めて「変更した」と言える。
    gcloud run services update "$(service_name "$ENV_NAME")" \
      --region="$REGION" --project="$PROJECT" \
      --update-secrets="RECEPTION_ACCESS_PASSWORD=${SECRET}:latest" \
      --quiet
    echo "反映しました。既存のログインセッションも失効します。"
    ;;

  offline)
    need_gcloud
    # IAM から公開を外す。アプリの再起動が不要なので数秒で効く。
    # パスワード変更より速く確実なので、「今すぐ止めたい」はこちら。
    gcloud run services remove-iam-policy-binding "$(service_name demo)" \
      --region="$REGION" --project="$PROJECT" \
      --member=allUsers --role=roles/run.invoker --quiet
    echo "デモを非公開にしました。URLを知っていても 403 になります。"
    ;;

  online)
    need_gcloud
    gcloud run services add-iam-policy-binding "$(service_name demo)" \
      --region="$REGION" --project="$PROJECT" \
      --member=allUsers --role=roles/run.invoker --quiet
    echo "デモを再公開しました。"
    ;;

  *)
    usage
    ;;
esac
