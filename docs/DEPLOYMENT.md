# デプロイ手順

PRD: [`PRD.md`](./PRD.md) 13章 / 17章

```text
Cloud Load Balancer → WAF → API Gateway → Cloud Run → Application → Firestore
```

---

## 本番前に必ず塞ぐ穴

**この状態のまま本番トラフィックを流さないでください。** 以下は設計上わざと
後回しにしている箇所で、複数インスタンスや再起動で壊れます。

| 穴 | 何が起きるか | 対応 |
| --- | --- | --- |
| Rate Limit がプロセス内 | インスタンス数だけ上限が増える。実質的に制限が効かない | Cloud Armor か Memorystore(Redis) へ（`lib/security/rate-limit.ts` に判断の経緯） |
| 帳票がメモリ上 | 生成したインスタンス以外からダウンロードできない | GCS + 署名付きURL へ |
| 管理ユーザーを画面から作れない | 招待・パスワード変更・停止がシード経由でしかできない | 管理ユーザー画面の実装 |

塞ぎ済み: データストア（Firestore ドライバ）、Idempotency（共有ストア）、
管理Webの認証（PBKDF2 + 署名付きセッション）。

### 必ず設定する環境変数

| 変数 | 未設定だと |
| --- | --- |
| `RECEPTION_DATASTORE=firestore` | in-memory のまま動き、インスタンス再起動でデータが消える |
| `RECEPTION_SEED=0` | デモデータと開発用ログインが本番に入る |
| `RECEPTION_ADMIN_SESSION_SECRET` | 管理Webのセッションを偽造できる。本番では起動を止める |
| `RECEPTION_ACCESS_PASSWORD` | 共有URLの目隠しが無効になる（本番公開時は意図的に外す） |

`minScale: 1` / `maxScale: 1` にすれば単一インスタンスで動きますが、
それは**デモ用の運用**です。実店舗のデータを入れる前に上記を塞いでください。

---

## 1. 前提

```bash
gcloud auth login
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com
```

Artifact Registry のリポジトリを作成します。

```bash
gcloud artifacts repositories create reception \
  --repository-format=docker \
  --location=asia-northeast1
```

## 2. シークレット

署名鍵・APIシークレットは Secret Manager で管理します（PRD 13-4）。
**開発者PCへ恒久保存しないこと。**

```bash
# 受付端末用のAPIキー
printf 'rk_live_xxxxxxxx' | gcloud secrets create reception-device-api-key --data-file=-

# 管理Webのセッション署名鍵。値は生成し、手元に残さない
openssl rand -base64 32 \
  | gcloud secrets create reception-admin-session-secret --data-file=-

# Cloud Run のサービスアカウントに読み取り権限を与える
for SECRET in reception-device-api-key reception-admin-session-secret; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member=serviceAccount:SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
```

署名鍵を差し替えると、その時点の管理Webのセッションはすべて失効します。
鍵が漏れた疑いがあるときは新しい版を作って再デプロイしてください。

### 最初の管理ユーザー

本番は `RECEPTION_SEED=0` のためシードが走らず、管理ユーザーが1人もいません。
初回だけ環境変数で1人作ります。

```bash
gcloud run services update reception-saas --region=$REGION \
  --set-env-vars RECEPTION_BOOTSTRAP_ADMIN_EMAIL=you@example.com \
  --set-env-vars RECEPTION_BOOTSTRAP_ADMIN_PASSWORD='生成した長いパスワード'
```

起動時に**管理ユーザーが1人もいないときだけ** TenantAdmin を1人作ります。
ログインできることを確認したら、環境変数を外してください。

```bash
gcloud run services update reception-saas --region=$REGION \
  --remove-env-vars RECEPTION_BOOTSTRAP_ADMIN_EMAIL,RECEPTION_BOOTSTRAP_ADMIN_PASSWORD
```

外し忘れても、既に利用者がいれば何もしません。2人目以降は管理Webから
招待する想定ですが、その画面はまだありません。

## 3. ビルドとデプロイ

```bash
REGION=asia-northeast1
PROJECT_ID=your-project
TAG=$(git rev-parse --short HEAD)
IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/reception/reception-saas:$TAG

docker build -t "$IMAGE" .
docker push "$IMAGE"

SA=deployer@$PROJECT_ID.iam.gserviceaccount.com

# SERVICE_ACCOUNT_EMAIL を先に置換する。後にすると PROJECT_ID の置換が
# メールアドレス内のプロジェクト名にも当たって壊れる。
sed -e "s|SERVICE_ACCOUNT_EMAIL|$SA|g" \
    -e "s|IMAGE_TAG|$TAG|g" \
    -e "s|PROJECT_ID|$PROJECT_ID|g" \
    -e "s|REGION|$REGION|g" \
    deploy/cloud-run.yaml > /tmp/cloud-run.rendered.yaml

gcloud run services replace /tmp/cloud-run.rendered.yaml --region "$REGION"
```

GitHub Actions からデプロイする場合は
`.github/workflows/deploy.yml` を使ってください（手動起動 / タグ push）。
Workload Identity 連携が前提で、サービスアカウントキーは使いません。

## 4. 段階的リリースとロールバック

PRD 4-4 / 4-5 に対応します。**アプリの配信とは別に、機能の公開率は
管理画面の Feature Flag で制御できる**ため、多くの場合はリビジョンを
切り替えずに済みます。

```bash
# 新リビジョンへ5%だけ流す
gcloud run services update-traffic reception-saas --region "$REGION" \
  --to-revisions LATEST=5

# 問題なければ100%
gcloud run services update-traffic reception-saas --region "$REGION" \
  --to-latest

# 問題が出たら前のリビジョンへ即時ロールバック
gcloud run revisions list --service reception-saas --region "$REGION"
gcloud run services update-traffic reception-saas --region "$REGION" \
  --to-revisions reception-saas-00042-abc=100
```

## 5. 前段（WAF / ロードバランサ）

Cloud Run の ingress は `internal-and-cloud-load-balancing` にしてあります。
直接公開せず、必ず外部 HTTPS ロードバランサ + Cloud Armor を前に置いてください。

```bash
# Cloud Armor のポリシー例: レート制限と既知の攻撃パターン
gcloud compute security-policies create reception-waf
gcloud compute security-policies rules create 1000 \
  --security-policy reception-waf \
  --expression "evaluatePreconfiguredExpr('xss-stable')" \
  --action deny-403
```

アプリ側にもテナント単位の Rate Limit がありますが、
これは**多層防御の内側**です。前段の Cloud Armor と両方入れてください。

## 6. 監視 (PRD 12-4)

| 対象 | 方法 |
| --- | --- |
| Liveness | `GET /health` — プロセス生存のみ。依存は見ない |
| Readiness | `GET /ready` — 依存リソース込み。異常時 503 |
| 外形監視 | Cloud Monitoring の Uptime Check で `/health` と `/reception` |
| 受付端末 | `GET /api/v1/device/heartbeat` で途絶端末を取得しアラート化 |

```bash
gcloud monitoring uptime create reception-health \
  --resource-type=uptime-url \
  --resource-labels=host=reception.example.com \
  --path=/health --period=60
```

Critical の通知先（Slack / Chatwork / Google Chat / Email）は
Cloud Monitoring の通知チャネルとして設定します。

## 7. バックアップ (PRD 12-1 / 12-2)

Firestore ドライバ導入後に設定します。

```bash
# 日次エクスポート
gcloud firestore export gs://BUCKET/backups/$(date +%Y%m%d)
```

**「バックアップがある」ではなく「復元できる」ことを保証してください。**
定期的に別プロジェクトへリストアし、件数と整合性を検証する運用を
セットで組んでください（PRD 12-2）。目標は RPO 1時間 / RTO 4時間です。
