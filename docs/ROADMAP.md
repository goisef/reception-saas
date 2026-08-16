# 開発ロードマップ — 無人受付・来店管理SaaS

PRD: [`PRD.md`](./PRD.md) / デプロイ: [`DEPLOYMENT.md`](./DEPLOYMENT.md)

| Step | 内容 | 優先度 | 状態 |
| --- | --- | --- | --- |
| 1 | PWA + API + 管理Web | P0 | 実装中 |
| 2 | 帳票 + 多店舗 + 権限 | P0 | 実装中 |
| 3 | Android APK | P0/P1 | 未着手 |
| 4 | Google / Outlook Calendar | P1 | 未着手 |
| 5 | 外部API / Webhook | P0 | 実装中 |
| 6 | iOS / IPA CI/CD | P1 | 未着手 |
| 7 | 顔認証PoC | P1 | 未着手 |
| 8 | 業務委託者入退館 | P1 | 未着手 |
| 9 | AI / Analytics | P2 | 未着手 |

---

## Step 1 — PWA + API + 管理Web

**Goal:** 1店舗が「予約 → 受付 → 滞在 → 退出」を紙なしで回せる。

- [x] ドメインモデル（テナント / 店舗 / 顧客 / 予約 / 来店 / 4桁番号）
- [x] Datastore ポート + in-memory ドライバ（Firestore 差し替え前提）
- [x] 4桁アクセス番号のライフサイクル状態機械
- [x] API v1: customers / reservations / checkins / checkouts / visits / access-numbers / stores
- [x] Remote Config + Feature Flag + 段階リリース
- [x] 受付PWA（QR / 4桁番号 / 退出）+ manifest + Service Worker
- [x] 管理Web ダッシュボード
- [x] `GET /health` / `GET /ready`
- [x] Cloud Run 向けのコンテナ化とデプロイ手順
- [ ] Firestore ドライバ実装
- [ ] 管理Webの認証（現在は開発用スタブセッション）
- [ ] Rate Limit / Idempotency の共有ストア（複数インスタンス対応）

## Step 2 — 帳票 + 多店舗 + 権限

**Goal:** 複数店舗を持つテナントが、権限を分けて運用しデータを持ち出せる。

- [x] RBAC（7ロール）+ scope
- [x] テナント分離（全リポジトリ操作が tenantId 必須）
- [x] 監査ログ
- [x] CSV（UTF-8 BOM / CRLF）/ Excel(xlsx) / JSON エクスポート
- [x] 非同期エクスポート（Request → Queue → Worker → Storage → Signed URL）
- [ ] PDF帳票

## Step 3 — Android APK

- [x] `GET /api/v1/device/version` によるバージョン確認・強制アップデート
- [x] リリースレジストリ（Version / Build / SHA-256 / Minimum OS / Required Update）
- [ ] APKビルド・署名パイプライン
- [ ] 公式ダウンロードサイト

## Step 4 — Calendar 連携

- [ ] Google Calendar（空き時間取得 / 予約作成 / 更新 / 削除 / Webhook）
- [ ] Outlook
- [ ] Apple Calendar (ICS)
- TimeTree は対象外

## Step 5 — 外部API / Webhook

- [x] API Key 認証（ハッシュ保管）+ scope
- [x] Rate Limit（テナント単位）
- [x] Idempotency-Key
- [x] Webhook 配信（HMAC-SHA256 + Timestamp + Nonce + Request ID）
- [x] Webhook リトライ（指数バックオフ）
- [x] OpenAPI 仕様 (`openapi/reception-v1.yaml`)
- [ ] 生成SDK（TypeScript クライアント）
- [ ] 顧客カルテ連携アダプタ

## Step 6 — iOS / IPA CI/CD

- [ ] Xcode プロジェクト（WKWebView シェル or ネイティブ Thin Client）
- [ ] Build → Test → Code Sign → IPA → Artifact
- [ ] TestFlight 配信
- [ ] 署名鍵を Secret Manager 管理（開発者PCへ恒久保存しない）

## Step 7 — 顔認証PoC

- [ ] SDK 比較評価（Liveness / 1:1 / 国内リージョン保管）
- [ ] 1:1 照合フロー（会員ID → 撮影 → Liveness → 照合）
- [ ] 同意・削除・保存期間・アクセスログ

## Step 8 — 業務委託者入退館

- [ ] 業者/外部スタッフのマスタ
- [ ] 入退館ログと在館者一覧
- [ ] 長時間滞在アラート

## Step 9 — AI / Analytics

- [ ] BigQuery エクスポート
- [ ] 稼働率 / 回転率 / 解約兆候
- [ ] 需要予測
