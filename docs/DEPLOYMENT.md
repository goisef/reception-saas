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
| データストアが in-memory | インスタンス再起動・スケールアウトでデータが消える／インスタンス間で食い違う | `lib/store/index.ts` の `createDatastore()` に Firestore ドライバを実装 |
| Rate Limit がプロセス内 | インスタンス数だけ上限が増える。実質的に制限が効かない | Memorystore(Redis) 実装へ差し替え |
| Idempotency がプロセス内 | 再送が別インスタンスに当たると二重登録になる | 同上 |
| 帳票がメモリ上 | 生成したインスタンス以外からダウンロードできない | GCS + 署名付きURL へ |
| 管理Webの認証がスタブ | `/admin` に誰でも入れる | `lib/admin/session.ts` を実際のログインへ差し替え |

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

# Cloud Run のサービスアカウントに読み取り権限を与える
gcloud secrets add-iam-policy-binding reception-device-api-key \
  --member=serviceAccount:SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

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
