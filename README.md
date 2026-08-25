# 無人受付・来店管理SaaS

**店舗の来店体験OS。**

```text
予約 → 受付 → 本人確認 → 滞在 → 退出 → 通知 → 顧客管理 → 外部システム連携
```

を一気通貫で管理する店舗向けプラットフォームです。ジム / 整体 / 屋内ゴルフ /
美容 / サウナ / コワーキング / スタジオ / クリニック / 無人店舗 / オフィスなど、
予約型店舗を対象とします。

このプロダクトの資産は「受付画面」ではなく **「受付API・来店データ基盤」** です。
受付UIは差し替え可能な一クライアントに過ぎません。

---

## クイックスタート

```bash
npm install
npm run dev
```

| URL | 内容 |
| --- | --- |
| http://localhost:3000/ | トップ |
| http://localhost:3000/reception | 受付端末 PWA |
| http://localhost:3000/admin | 管理Web（要ログイン） |
| http://localhost:3000/api/v1/openapi | API 仕様 |

起動時にデモデータ（1テナント / 2店舗 / 顧客5名 / 予約5件）が入ります。
管理Webの開発用ログインは `admin@example.com` / `reception-dev` です。

コンテナで動かす場合:

```bash
npm run docker:build && npm run docker:run   # http://localhost:8080
```

---

## 設計思想

以下7つを、非機能要件ではなく**プロダクトのコア設計思想**として扱います。
機能追加の可否は、この原則を壊さないかで判断します。

| # | 原則 | 実装 |
| --- | --- | --- |
| P-1 | 端末をアップデートしなくても仕様変更できる | Thin Client + Remote Config + Feature Flag |
| P-2 | 外部システムからAPIで操作できる | API First / OpenAPI / Webhook |
| P-3 | APIが落ちても可能な限り店舗受付を止めない | オフラインキュー + 非同期処理 |
| P-4 | データを失わない | Backup + Restore Test + 監査ログ |
| P-5 | 障害を検知して通知できる | Health Check + 外形監視 + Alert |
| P-6 | 一つの顧客の障害が他顧客へ波及しない | テナント分離 + テナント単位Rate Limit |
| P-7 | アプリ配布方式に進化速度を依存させない | PWA優先 + サーバー主導の仕様変更 |

「受付ボタンの文言を変えたい」という要望に、アプリの再審査もアップデートも
なしで応えられることを、設計の中心に据えています。

```text
悪い設計                    本システム
アプリ修正                  管理画面
  ↓                          ↓
APK / IPA                   設定変更
  ↓                          ↓
審査                        API
  ↓                          ↓
アップデート                 即時反映
```

---

## 実装状況

### 実装済み

| 領域 | 内容 |
| --- | --- |
| 受付端末 PWA | Remote Config駆動のホーム / QR受付 / 4桁番号受付 / 退出、Service Worker、オフラインキュー、死活通知、バージョン確認 |
| API v1 | 顧客 / 予約 / 受付 / 退出 / 来店 / 番号 / 店舗 / 端末 / 帳票 / Webhook、`/health` `/ready`、OpenAPI 3.1 |
| セキュリティ | 管理Webのログイン（PBKDF2 保管 / 署名付きセッション）、APIキー認証（ハッシュ保管）、RBAC 7ロール、テナント分離、Rate Limit、Idempotency-Key、監査ログ、APIバージョニング、共有URLのパスワード保護 |
| データ | Firestore ドライバ（in-memory と契約テストで等価性を担保）|
| 4桁番号 | 8状態のライフサイクル、解放条件5種、Shared Number、時間指定確保、VIP固定番号 |
| Webhook | HMAC-SHA256 + Timestamp + Nonce + Request ID、指数バックオフ再送 |
| 帳票 | CSV（UTF-8 BOM）/ Excel / JSON、非同期パイプライン + 署名付きURL |
| 管理Web | ダッシュボード / 予約 / 来店・退出 / 顧客 / 番号 / 帳票 / 端末設定 |

### 未実装

管理ユーザーの招待・パスワード変更画面（現在はシード投入のみ）、
Rate Limit の共有ストア、GCS、キュー基盤、通知の実送信、PDF帳票、
顧客アプリ、SaaS管理画面、AI分析。

**本番トラフィックを流す前に塞ぐべき穴**は
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) にまとめています。

---

## クライアント配布戦略

| 方式 | 優先度 | 状況 |
| --- | --- | --- |
| PWA (iPad / Android Tablet / Windows / Mac / Chromebook) | P0 | 実装済み。iPad はホーム画面追加で全画面起動 |
| Android APK | P0 | プロジェクトと CI 実装済み。署名鍵の登録待ち |
| iOS App / IPA | P1 | プロジェクトと CI 実装済み。Apple Developer 登録待ち |
| App Store | P1 | 未着手 |

iPad で使うだけならアプリは要りません。端末で `/reception/setup` を開くと
ホーム画面への追加手順が出ます。追加するとアドレスバーとタブが消え、
据え置き端末として使える状態になります。

ネイティブアプリ（`android/` `ios/`）は Capacitor で作った薄い殻で、
受付画面はサーバーから読み込みます。**ボタンの文言を変えるのに審査は
要りません。** 接続先はビルド時に `RECEPTION_APP_SERVER_URL` で決めます。

IPA は CI/CD で生成・署名できますが、**Web に置いて誰でもインストール
できる形にはしません。** iOS では Apple の署名・プロビジョニング・配布方式に
従う必要があるため、用途に応じて TestFlight / Ad Hoc /
Apple Business Manager / App Store を使い分けます。

手順とビルドに必要な Secret は [`docs/APP-RELEASE.md`](./docs/APP-RELEASE.md)。

---

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [`docs/PRD.md`](./docs/PRD.md) | 製品要求仕様（単一の正） |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Step 1〜9 の開発計画と進捗 |
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | 開発ガイド・ディレクトリ構成・設計上の約束 |
| [`docs/HOSTING-FREE.md`](./docs/HOSTING-FREE.md) | **無料で共有URLを立てる**（Vercel + Firestore） |
| [`docs/APP-RELEASE.md`](./docs/APP-RELEASE.md) | APK / IPA のビルド・署名・配布 |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Cloud Run へのデプロイ手順（本番想定） |
| [`openapi/reception-v1.yaml`](./openapi/reception-v1.yaml) | API 仕様（単一の正） |

---

## 技術構成

**Modular Monolith + API First + Event Driven**

```text
Cloud Load Balancer → WAF → API Gateway → Cloud Run → Application → Firestore
                                                          ↓
                                        Cloud Tasks / Pub/Sub → Worker
```

- Next.js 16 (App Router) / TypeScript / Tailwind CSS v4
- データアクセスは Datastore ポート越し。Firestore への差し替えは
  `lib/store/index.ts` の 1 箇所
- ドメイン層は純粋関数のみ。状態遷移をデータストア抜きで検証できる

## 開発

```bash
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest
bash scripts/smoke.sh   # 起動中のサーバーに対する結合確認
```
