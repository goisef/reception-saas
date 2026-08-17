# 開発ガイド

PRD: [`PRD.md`](./PRD.md) / ロードマップ: [`ROADMAP.md`](./ROADMAP.md) /
デプロイ: [`DEPLOYMENT.md`](./DEPLOYMENT.md)

## 起動

```bash
npm install
npm run dev
```

| URL | 内容 |
| --- | --- |
| http://localhost:3000/ | トップ（各画面への入口） |
| http://localhost:3000/reception | 受付端末 PWA |
| http://localhost:3000/admin | 管理Web |
| http://localhost:3000/health | Liveness |
| http://localhost:3000/ready | Readiness |
| http://localhost:3000/api/v1/openapi | OpenAPI 仕様 |

起動時に in-memory ストアへデモデータ（1テナント / 2店舗 / 顧客5名 / 予約5件）が
投入されます。`RECEPTION_SEED=0` でシードを止められます。

## コマンド

```bash
npm run dev        # 開発サーバー
npm run build      # 本番ビルド
npm start          # 本番サーバー
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest
npm run icons      # PWA アイコンの再生成
npm run docker:build && npm run docker:run   # コンテナで起動
```

## API を叩く

開発用の API キーはシードに含まれています（`lib/store/seed.ts`）。

| キー | ロール | 用途 |
| --- | --- | --- |
| `rk_dev_demo_tenant_key` | TenantAdmin | 管理用。全スコープ |
| `rk_dev_reception_terminal_key` | ReceptionOnly | 受付端末用。顧客一覧は引けない |

```bash
# 予約一覧
curl -H 'Authorization: Bearer rk_dev_demo_tenant_key' \
  http://localhost:3000/api/v1/reservations

# 4桁番号で受付
curl -X POST http://localhost:3000/api/v1/checkins \
  -H 'Authorization: Bearer rk_dev_reception_terminal_key' \
  -H 'Content-Type: application/json' \
  -H 'X-Device-Id: dev_osaka_01' \
  -H 'Idempotency-Key: demo-1' \
  -d '{"storeId":"sto_osaka","method":"number","accessNumber":"5555"}'

# 退出
curl -X PATCH http://localhost:3000/api/v1/checkouts \
  -H 'Authorization: Bearer rk_dev_reception_terminal_key' \
  -H 'Content-Type: application/json' \
  -d '{"storeId":"sto_osaka","accessNumber":"5555"}'

# 受付端末が顧客一覧を引こうとすると 403（スコープ外）
curl -i -H 'Authorization: Bearer rk_dev_reception_terminal_key' \
  http://localhost:3000/api/v1/customers
```

受付から退出、帳票、Webhook までの一連の流れは `scripts/smoke.sh` で
まとめて確認できます。

```bash
npm run build && npm start &
bash scripts/smoke.sh
```

## 環境変数

`.env.example` を参照してください。本番では Secret Manager から注入します
（PRD 13-4: 署名鍵・APIシークレットを開発者PCへ恒久保存しない）。

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `RECEPTION_DEMO_API_KEY` | `rk_dev_demo_tenant_key` | 管理APIキー |
| `RECEPTION_DEMO_DEVICE_KEY` | `rk_dev_reception_terminal_key` | 端末APIキー |
| `RECEPTION_DEVICE_API_KEY` | 上記端末キー | 受付端末がサーバーへ送るキー |
| `RECEPTION_TENANT_ID` | `ten_demo` | 受付端末・管理画面のテナント |
| `RECEPTION_STORE_ID` | `sto_osaka` | 受付端末の店舗 |
| `RECEPTION_DEVICE_ID` | `dev_osaka_01` | 受付端末の識別子 |
| `RECEPTION_SEED` | 有効 | `0` でシードを止める |
| `PORT` | `3000` | 待ち受けポート（Cloud Run では 8080） |

## ディレクトリ構成

```text
docs/                   PRD / ロードマップ / 開発ガイド / デプロイ手順
openapi/                API 仕様（単一の正）
deploy/                 Cloud Run のサービス定義

lib/
  domain/               ドメインモデルと純粋なルール（I/O を書かない）
    types.ts            エンティティ定義
    access-number.ts    4桁番号の状態機械・解放判定・払い出し
  core/                 ID / エラー / バリデータ
  store/                Datastore ポート + in-memory ドライバ + シード
  security/             API Key 認証 / RBAC / Rate Limit / Idempotency
                        / Webhook 署名 / 監査ログ
  services/             ユースケース（受付・予約・顧客・番号・通知・
                        Remote Config・Webhook・ダッシュボード）
  export/               CSV / xlsx / JSON と非同期ジョブ
  api/handler.ts        ルートハンドラ共通処理
  client/               受付端末から API を叩くクライアント
  admin/session.ts      管理Webのセッション（要差し替え）

app/
  api/v1/               API v1
  health, ready         ヘルスチェック
  reception/            受付端末 PWA
  admin/                管理Web
  manifest.ts           PWA マニフェスト

tests/                  Vitest
scripts/                アイコン生成 / スモークテスト
```

## 設計上の約束

- **ドメイン層に I/O を書かない。** `lib/domain/` は純粋関数のみ。状態遷移の
  正しさをデータストア抜きで検証できるようにする。
- **データへは Datastore ポート越しにしか触らない。** Firestore への差し替えは
  `lib/store/index.ts` の `createDatastore()` 一箇所で行う。
- **全リポジトリ操作に `tenantId` を渡す。** テナント分離（原則 P-6）はここで
  強制する。テナントを跨げる API を生やさない。
- **API ルートは必ず `apiRoute()` を通す。** 認証・スコープ・Rate Limit・
  Idempotency・監査ログを素通りするエンドポイントを作らない。
- **Server Action でも権限を確認する。** 管理画面から呼ばれるから安全、
  という前提は置かない（Zero Trust）。
- **端末に判定を持たせない。** 表示文言もボタン構成も機能ON/OFFもサーバーが決める。

## 未実装（本番までに必要なもの）

| 項目 | 内容 |
| --- | --- |
| 管理Webの認証 | `lib/admin/session.ts` が開発用スタブ |
| Rate Limit の共有ストア | 単一プロセス前提。全リクエストで書き込みが発生するため、あえて Firestore に載せていない（`lib/security/rate-limit.ts` の説明を参照） |
| Storage | 帳票をメモリに置いている。GCS + 署名付きURLへ |
| キュー基盤 | Webhook / 帳票 / 通知のワーカーを手動エンドポイントで代用中 |
| 通知の実送信 | Slack / Chatwork / Google Chat / Email のアダプタ未実装 |
| PDF 帳票 | P0 対象外 |

共有URLを無料で立てる手順は [`HOSTING-FREE.md`](./HOSTING-FREE.md)、
Cloud Run での本番運用は [`DEPLOYMENT.md`](./DEPLOYMENT.md) を参照してください。
