# 無人受付・来店管理SaaS PRD v6.0

**Product Requirements Document / 正式版**

| 項目 | 内容 |
| --- | --- |
| プロダクト名 | 無人受付・来店管理SaaS（コードネーム: Reception） |
| Version | v6.0 |
| ステータス | 正式版（このドキュメントが単一の正とする） |
| 初期リリース | PWA + API + 管理Web |
| アーキテクチャ | Modular Monolith + API First + Event Driven |
| 初期バックエンド | Cloud Run + Firestore（将来 BigQuery 併用） |
| クライアント | PWA (P0) / Android APK (P0) / iOS App・IPA (P1) |

> このドキュメントは、検討メモを整理して確定仕様に落としたものです。まだ決めきっていない
> 論点は各章末の **[検討事項]** に隔離してあります。確定仕様と検討事項を混ぜないこと。

---

# 1. Product Vision

## 「店舗の来店体験OS」

単なる無人受付システムではない。

```text
予約 → 受付 → 本人確認 → 滞在 → 退出 → 通知 → 顧客管理 → 外部システム連携
```

を一気通貫で管理する店舗向けプラットフォームとする。

## 1-1. 対象業種

ジム / 整体 / 屋内ゴルフ / 美容 / サウナ / コワーキング / スタジオ / クリニック /
無人店舗 / オフィス / その他予約型店舗。

## 1-2. プロダクトの資産定義

「受付画面」ではなく **「受付API・来店データ基盤」** を資産とする。
受付UIは差し替え可能な一クライアントに過ぎない。

---

# 2. 最重要アーキテクチャ原則（コア設計思想）

以下7つは非機能要件ではなく、**プロダクトのコア設計思想**として扱う。
機能追加の可否は、この7原則を壊さないかどうかで判断する。

| # | 原則 | 実装上の帰結 |
| --- | --- | --- |
| P-1 | 端末をアップデートしなくても仕様変更できる | Thin Client + Remote Config + Feature Flag |
| P-2 | 外部システムからAPIで操作できる | API First / OpenAPI / Webhook |
| P-3 | APIが落ちても可能な限り店舗受付を止めない | Offline Queue + Local Cache（P1） |
| P-4 | データを失わない | Backup + Restore Test + 監査ログ |
| P-5 | 障害を検知して通知できる | Health Check + 外形監視 + Alert |
| P-6 | 一つの顧客の障害が他顧客へ波及しない | Tenant Isolation + テナント単位Rate Limit |
| P-7 | アプリ配布方式にプロダクトの進化速度を依存させない | PWA優先 + サーバー主導の仕様変更 |

---

# 3. プロダクト構成

```text
                     ┌──────────────────┐
                     │   顧客アプリ      │
                     │    iOS/Android   │
                     └────────┬─────────┘
                              │
┌─────────────┐               │
│ 外部予約     │───────────────┤
│ CRM/カルテ   │               │
└─────────────┘               ▼
                       ┌──────────────┐
                       │ API Gateway  │
                       └──────┬───────┘
                              │
                       ┌──────▼───────┐
                       │ Application  │
                       │ API          │
                       └──────┬───────┘
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          予約管理          顧客管理          来店管理
             │                │                │
             └────────────────┼────────────────┘
                              ▼
                       ┌──────────────┐
                       │  Database    │
                       └──────────────┘
                              │
       ┌──────────────────────┼────────────────────┐
       ▼                      ▼                    ▼
    通知基盤                帳票基盤             Analytics
```

## 受付端末

| 方式 | 優先度 | 用途 |
| --- | --- | --- |
| PWA (iPad / PC / Android Tablet / Chromebook) | **P0** | 即時導入 |
| Android APK | **P0** | 店舗端末 |
| iOS App / IPA | P1 | iPad |
| App Store | P1 | 一般配布 |

---

# 4. 端末アプリの基本方針 — Thin Client

受付端末は **Thin Client** とする。

端末が担当するのは以下のみ。

- 画面表示
- カメラ / QR読み取り
- 顔認証キャプチャ（P1）
- 番号入力

ビジネスロジックはすべてサーバー側に寄せる。

## 4-1. なぜThin Clientなのか

店舗ごとの仕様変更を「アプリ再審査 → アップデート」に依存させないため。

```text
悪い設計                        本システム
アプリ修正                      管理画面
  ↓                              ↓
APK / IPA                       設定変更
  ↓                              ↓
審査                            API
  ↓                              ↓
アップデート                     即時反映
```

「受付ボタンの文言を変えたい」程度の要望は、**サーバー設定変更だけで即時反映**させる。

## 4-2. Remote Configuration

端末は起動時および定期的に設定をサーバーから取得する。

```json
{
  "configVersion": 12,
  "logo": "https://cdn.example.com/tenants/t_001/logo.svg",
  "theme": "light",
  "language": "ja",
  "notificationSound": "chime",
  "buttons": [
    { "id": "qr",     "label": "QRコードで受付", "action": "reception.qr",     "visible": true,  "order": 1 },
    { "id": "number", "label": "4桁番号で受付", "action": "reception.number", "visible": true,  "order": 2 },
    { "id": "other",  "label": "その他の受付",   "action": "reception.other",  "visible": true,  "order": 3 }
  ],
  "features": {
    "faceRecognition": false,
    "numberReception": true,
    "qrReception": true
  }
}
```

ボタンは **表示/非表示・文言変更・並び替え** が管理画面から可能。

## 4-3. Feature Flag

機能単位でON/OFFできる。粒度は `tenantId` / `storeId` / `userId` / `deviceId`。

対象フラグ（初期）:
`faceRecognition` / `calendar` / `staffReception` / `eventReception` /
`exitNotification` / `offlineMode`

## 4-4. 段階的リリース

新機能を全店舗へ一斉公開しない。

```text
開発環境 → 社内 → テスト店舗 → 5% → 25% → 50% → 100%
```

ロールアウト率は Feature Flag に付随する属性として保持し、`deviceId` のハッシュで
安定的に振り分ける（同一端末が毎回同じ判定になること）。

## 4-5. ロールバック

新バージョンで問題が発生した場合、`v1.5.0 → v1.4.2` のように **設定・配信の両面で**
即座に戻せること。Remote Config は `configVersion` を持ち、過去バージョンへ戻せる。

---

# 5. 受付UI

横向きタブレットを基本とする。

```text
┌──────────────────────────────────────┐
│ [企業ロゴ]                            │
│                                      │
│        QRコードで受付                 │
│                                      │
│        4桁番号で受付                  │
│                                      │
│        その他の受付                   │
│                                      │
└──────────────────────────────────────┘
```

- 受付画面左上に顧客企業のロゴを表示（管理画面からアップロード）
- ロゴ形式: PNG / SVG / JPG、サイズ上限を設定
- ボタンは Remote Config 駆動（4-2参照）

---

# 6. クライアント配布戦略

## 6-1. PWA（P0）

最初に提供する。対応: iPad / Android Tablet / Windows / Mac / Chromebook。

メリット: 審査不要 / URLだけで導入 / 即時アップデート / 端末交換が容易 / 初期開発が高速。

## 6-2. Android APK（P0）

Google Play公開前でも店舗導入できる。公式ダウンロードサイトから
`Reception-v1.0.0.apk` を提供する。

### APKリリース管理項目

Version / Build Number / Release Date / SHA-256 / Release Notes /
Minimum OS / Required Update / Supported Device

### アップデート確認

アプリ起動時に `GET /api/v1/device/version` で最新版を確認する。

```text
現在 1.0.0 / 最新 1.1.0 → 「新しいバージョンがあります」
```

重大なセキュリティ更新の場合は **強制アップデート**（`requiredUpdate: true`）も可能にする。

## 6-3. iOS / IPA（P1）

iOSアプリはXcode等から `Reception.ipa` を生成できる。
本プロダクトのCI/CDでIPAをビルド・署名できる構成を採用する。

### 重要: IPAの自由配布はしない

Android APK と違い、「IPAをWebに置く → 誰でもダウンロード → iPadにインストール」
という運用は基本的にできない。Appleの署名・プロビジョニング・配布方式に従う。

### iOS配布方式の使い分け

| 用途 | 方式 |
| --- | --- |
| 開発 | Development Build |
| 社内・検証 | TestFlight |
| 特定端末への限定配布 | Ad Hoc |
| 法人・大規模顧客 | Apple Business Manager / MDM |
| 一般公開 | App Store |

### iOS導入戦略

```text
最速        → PWA
Android     → APK
iPad        → PWA / TestFlight
本番        → App Store
法人        → Apple Business Manager / MDM
```

### IPAリリース管理項目

Version / Build Number / Commit SHA / Release Date / Signing Profile /
Minimum iOS / Release Notes

---

# 7. 受付機能

## 7-1. 受付方式

- QR
- 4桁番号
- 顔認証（P1）
- 業者受付
- イベント受付
- カスタム受付

## 7-2. QR受付

QRには**直接個人情報を保存しない**。参照情報のみを持つ。

```json
{ "reservationId": "...", "token": "...", "exp": 1700000000 }
```

## 7-3. 4桁アクセス番号

### 状態

```text
available → reserved → checked_in → in_use → exited → released → available
                                                   ↘ expired ↗
                                    exited → reserved  （固定番号の再確保）
                          （任意状態） →  locked        （管理者による利用停止）
```

| 状態 | 意味 |
| --- | --- |
| `available` | 未使用。払い出し可能 |
| `reserved` | 予約・顧客に紐付けて確保済み |
| `checked_in` | 受付完了 |
| `in_use` | 滞在中 |
| `exited` | 退出済み（保持時間中） |
| `expired` | 有効期限切れ |
| `released` | 解放済み。再利用可能 |
| `locked` | 管理者により利用停止 |

> **重要:** 「固定番号」は状態ではなく `pinned` 属性で表す。固定番号も受付には
> 使うため、状態は通常どおり `reserved → checked_in → in_use` と遷移する。
> `pinned` が効くのは自動解放の判定だけ。`locked` は「管理者が明示的に止めた番号」
> であり、受付には使えない。
>
> 受付完了と滞在開始は現行フローでは同時なので、`checked_in` と `in_use` は
> 連続して遷移する。「受付だけして後から入場する」フローに備えて状態は分けてある。

### 番号確保

| 種別 | 仕様 |
| --- | --- |
| 通常 | 予約作成時に確保 |
| VIP | 固定番号を設定（解放対象外） |
| 特定会員 | 会員IDと番号を紐付け |
| 時間指定 | 18:00〜21:00 のように時間帯で確保 |

### 番号解放

**退出済みを最も優先する。** ただし安全性を考え、即時解放はしない。

```text
退出済み → 保持時間（holdMinutes）経過 → 解放
```

解放対象:

1. 退出済み（保持時間経過後）
2. キャンセル
3. No-show
4. 予定終了 + timeout
5. 管理者手動解放

固定番号（`pinned`）は自動解放の対象外。ただし退出したまま放置すると次回使えなく
なるため、保持時間の経過後に **同じ顧客向けの `reserved` へ戻す（再確保）**。
固定番号を完全に手放すのは管理者の手動解放だけ。

### Shared Number

1番号に複数人を紐付け可能。

```text
5555 ── 田中
     ├─ 田中花子
     └─ 田中太郎
```

## 7-4. 退出管理

保存項目: `scheduledExitAt` / `actualExitAt`。管理画面から変更可能。

### 退出通知

| 宛先 | タイミング |
| --- | --- |
| 利用者 | 30分前 / 15分前 / 10分前 / 5分前 / 終了 / 超過 |
| 店舗 | 未退出 / 超過 / 長時間滞在 |

---

# 8. 顔認証（P1 / 高優先PoC）

## 8-1. 用途

業務委託 / 外部スタッフ / トレーナー / 清掃業者 / VIP / 特定会員

## 8-2. 方式

| フェーズ | 方式 | フロー |
| --- | --- | --- |
| MVP | 1:1 | 会員ID → 顔撮影 → Liveness → 照合 |
| 将来 | 1:N | 顔 → DB検索 → 人物特定 |

## 8-3. 対応カメラ

iPad: 内蔵フロントカメラ / Android: 内蔵フロントカメラ / PC: Webカメラ

## 8-4. SDK要件

クロスプラットフォームSDKを優先する。必須要件:
iOS / Android / Web / Liveness / 1:1 / 1:N / SDK・API提供 / 商用利用可能。

## 8-5. 顔認証データの取扱（必須要件）

利用目的表示 / 同意取得 / 削除 / 利用停止 / 保存期間 / アクセスログ /
暗号化 / RBAC / テナント分離。

> **[検討事項]** SDKベンダー選定は未確定。PoC段階でLiveness精度・単価・国内リージョン
> 保管可否を比較評価する。

---

# 9. 外部連携

## 9-1. カレンダー連携

対象: Google Calendar / Outlook / Apple Calendar (ICS)。
**TimeTreeは対象外。**

可能な操作: 空き時間取得 / 予約作成 / 更新 / 削除 / Webhook / 同期。

## 9-2. 外部API

| リソース | メソッド |
| --- | --- |
| Customer | POST / GET / PATCH |
| Reservation | POST / GET / PATCH / DELETE |
| Checkin | GET / POST |
| Checkout | GET / PATCH |

## 9-3. 顧客カルテ連携

外部システムへ送信する項目: 来店日時 / 退出日時 / 滞在時間 / 店舗 / 利用サービス。

## 9-4. Webhook イベント

```text
reservation.created
reservation.updated
reservation.deleted
checkin.completed
checkout.completed
customer.created
customer.updated
access_number.reserved
access_number.released
```

---

# 10. API設計

## 10-1. APIセキュリティ（P0）

| 項目 | 仕様 |
| --- | --- |
| TLS | HTTPS必須 |
| WAF | 不正アクセス防御 |
| Rate Limit | API乱用防止（テナント単位） |
| Authentication | OAuth2 / JWT / API Key |
| Authorization | Scope + RBAC |

## 10-2. Webhook偽装対策

`HMAC-SHA256` + `Timestamp` + `Nonce` + `Request ID` を利用する。

送信ヘッダ:

```text
X-Reception-Signature: t=<unix>,v1=<hex hmac>
X-Reception-Event-Id:  evt_...
X-Reception-Nonce:     <random>
X-Request-Id:          req_...
```

署名対象文字列: `<timestamp>.<nonce>.<raw body>`

## 10-3. Replay Attack対策

タイムスタンプが **5分以上古いリクエストは拒否**する。Nonceは同期間内で一意。

## 10-4. Idempotency

予約登録等の作成系APIで `Idempotency-Key` ヘッダを受け付ける。
同一キーの再送は、初回のレスポンスをそのまま返す。

## 10-5. API Version

`/api/v1` / `/api/v2` 方式。既存顧客のAPIを突然壊さない。

## 10-6. API互換性

アプリが古くても一定期間は旧APIを利用できるようにする。**これが非常に重要。**

```text
PWA v1.5 / Android v1.3 / iOS v1.2  ←  すべて同時に Backend が対応できること
```

全クライアントは `App Version` / `API Version` / `Config Version` を保持し、
リクエストヘッダで申告する。

## 10-7. OpenAPI

API仕様を `openapi/reception-v1.yaml` としてGit管理する。
そこから SDK / TypeScript Types / API Client / ドキュメント を生成する。

---

# 11. 帳票（P0）

| 形式 | 優先度 | 用途 |
| --- | --- | --- |
| CSV | 最優先 | 汎用 |
| Excel | 最優先 | 人間の集計作業 |
| JSON | 高 | API連携・移行 |
| PDF | 中 | 人間向け帳票 |

## 11-1. 帳票対象

顧客 / 予約 / 来店 / 退出 / 滞在 / 番号 / 通知 / APIログ

## 11-2. 生成フロー

大量データは非同期。

```text
Export Request → Queue → Worker → File → Storage → Signed URL
```

## 11-3. CSV仕様

**UTF-8 BOM付き。** Excelとの互換性を優先する。改行は CRLF。

## 11-4. JSON Export

外部システム移行用のバンドル形式。

```json
{ "customers": [], "reservations": [], "visits": [] }
```

---

# 12. 信頼性

## 12-1. バックアップ（P0）

対象: DB / Storage / マスタ / 設定 / 監査ログ

### サイクル（初期）

| 種別 | 頻度 | 保持 |
| --- | --- | --- |
| 重要DB | 1時間 | — |
| 日次 | 1日 | 30日 |
| 週次 | 1週 | 12週 |
| 月次 | 1ヶ月 | 12ヶ月 |

## 12-2. Restore Test

定期的に `Backup → Restore → Integrity Check` を実行する。

「バックアップがある」ではなく **「復元できる」ことを保証**する。

## 12-3. Disaster Recovery

| 指標 | 初期目標 | 将来目標 |
| --- | --- | --- |
| RPO | 1時間 | 15分 |
| RTO | 4時間 | 1時間 |

## 12-4. 障害監視

監視対象: API / DB / Storage / Queue / Authentication / Notification /
Calendar / 外部API / 受付端末

### Health Check

```text
GET /health   ... プロセス生存
GET /ready    ... 依存リソース込みで受付可能か
```

### 外形監視

外部から 受付 / API / ログイン を定期的に監視する。

### 障害通知

Critical の場合、Chatwork / Google Chat / Slack / Email へ通知する。

### 店舗端末障害

例: 「大阪店の受付端末が5分間サーバーと通信できていません」を管理者へ通知。
端末は定期的に `POST /api/v1/device/heartbeat` を送信し、途絶を検知する。

## 12-5. オフライン（P1）

将来的に最低限の受付を可能にする。

```text
Offline → Local Queue → 通信復旧 → Sync
```

---

# 13. アーキテクチャ

初期は **Modular Monolith + API First + Event Driven**。

## 13-1. Backend

```text
Cloud Load Balancer → WAF → API Gateway → Cloud Run → Application → Firestore
```

## 13-2. 非同期処理

`Cloud Tasks / Pub/Sub → Worker`

用途: 通知 / Webhook / 帳票 / カレンダー同期 / Retry / AI処理

## 13-3. Storage

ロゴ / 帳票 / QR / 設定ファイル / その他ファイル

## 13-4. Secret

Secret Manager + KMS。保存対象: API Secret / OAuth Token / Webhook Secret /
SDK Secret / DB Secret。

以下は **開発者PCへ恒久保存しない**:
Distribution Certificate / Private Key / Provisioning Profile / API Secret。

## 13-5. DB

初期は **Firestore** を第一候補とする。

理由: Firebaseとの親和性 / リアルタイム更新 / 小規模MVPに適する / サーバーレス / スケール容易。

帳票・分析・複雑な検索が増えた場合、`Firestore + BigQuery` 構成へ拡張する。

> 実装上は Datastore ポート（インターフェース）越しにアクセスし、ドライバを差し替え
> 可能にしておく。MVP開発時は in-memory ドライバで動作させる。

## 13-6. Analytics

BigQueryへイベントを蓄積する。
対象: 受付 / 来店 / 退出 / 予約 / 番号 / 通知 / API / 顔認証

### CS分析指標

| 軸 | 指標 |
| --- | --- |
| 顧客 | 来店回数 / 滞在時間 / 利用頻度 |
| 店舗 | 稼働率 / 回転率 / 来店数 |
| SaaS | MAU / テナント利用率 / API利用 / 機能利用率 / 解約兆候 |

---

# 14. 管理Web

## 14-1. Dashboard

今日の来店 / 現在滞在中 / 未退出 / 予約 / 稼働率 / エラー

## 14-2. 顧客管理

顧客情報 / 会員番号 / 来店履歴 / 予約履歴 / 滞在履歴 / 退出履歴 /
顔認証設定 / 外部ID

## 14-3. マスタ

1. 店舗
2. 顧客
3. サービス
4. 受付ボタン
5. メッセージ
6. 通知音
7. 通知先
8. カレンダー
9. 権限
10. 番号
11. 退出設定
12. 顔認証
13. テーマ
14. ロゴ
15. 多言語
16. API Client

---

# 15. 権限

粒度は **画面 × 操作 × データ範囲**。

| Role | データ範囲 |
| --- | --- |
| SuperAdmin | 全テナント |
| TenantAdmin | 自テナント全体 |
| AreaManager | 担当エリアの店舗 |
| StoreManager | 自店舗 |
| Staff | 自店舗（限定操作） |
| ReceptionOnly | 受付端末用（受付・退出のみ） |
| Viewer | 参照のみ |

---

# 16. セキュリティ思想

本プロダクトでは **Zero Trust** を基本原則とする。
「店舗ネットワークだから安全」「端末だから安全」という前提を置かない。

## 16-1. セキュリティ監視（将来）

Dependency Scan / SAST / DAST / Container Scan / Secret Scan / Penetration Test
をCI/CDに組み込む。

---

# 17. CI/CD

## 17-1. アプリケーション

```text
Git Push → Lint → Unit Test → Integration Test → Security Scan → Build → Deploy
```

## 17-2. 配布

```text
Android:  Build → Sign → APK → Hash → Artifact → 配布
iOS:      Build → Test → Code Sign → IPA → Artifact → TestFlight / App Store
```

署名鍵はCI/CDのSecure Storage / Secret Managerで管理する（13-4参照）。

---

# 18. 開発スコープ

## 18-1. P0（最初のリリース）

| 領域 | 内容 |
| --- | --- |
| 受付 | PWA / QR / 4桁番号 / 退出 |
| 管理 | 顧客 / 予約 / 来店 / 店舗 / マスタ |
| Data | CSV / Excel / JSON |
| API | v1 / OpenAPI / API Key / Webhook |
| Security | Authentication / RBAC / Tenant Isolation / WAF / Rate Limit / Audit Log / Secret Manager |
| Reliability | Backup / Restore / Monitoring / Alert |

## 18-2. P1

Android APK / iOSアプリ / IPA CI/CD / Google Calendar / Outlook / Apple Calendar /
Chatwork / Google Chat / CRM API / 顧客カルテAPI / 顔認証PoC / 業務委託者管理 / オフライン

## 18-3. P2

1:N顔認証 / AI / スマートロック / NFC / Wallet / IoT / 海外展開

---

# 19. ロードマップ

[`ROADMAP.md`](./ROADMAP.md) を参照。

---

# 20. 意思決定の背景（Design Rationale）

「iOS/Androidアプリを作ってストアに出すサービス」から始める設計にはしない。

最初から **APIを中心にした店舗向けプラットフォーム** として作り、その上に
`PWA → APK → IPA / App Store` という複数のクライアントを載せる構造にする。

これにより、将来「整体院向け予約システムと連携したい」「ゴルフ練習場の会員管理から
予約を入れたい」「業務委託トレーナーだけ顔認証で入館させたい」となっても、
受付アプリそのものを作り直す必要がない。

---

# 21. 検討事項（未確定）

確定仕様ではない。設計判断が必要なもの。

| # | 論点 | 現時点の方針 |
| --- | --- | --- |
| Q-1 | 顔認証SDKベンダー | PoCで比較評価。国内リージョン保管可否が要件 |
| Q-2 | 認証方式（OAuth2 / JWT / API Key の使い分け） | 管理Web=セッション、外部連携=API Key、将来OAuth2 |
| Q-3 | Firestore単体 vs BigQuery併用の切替時期 | 帳票の非同期化で当面持たせ、分析要件発生時に拡張 |
| Q-4 | PDF帳票のレンダリング方式 | P0では対象外。ヘッドレスChrome or サーバーサイド生成 |
| Q-5 | 番号の保持時間デフォルト値 | 店舗マスタで設定可能とし、初期値15分 |
| Q-6 | オフライン時の重複受付の解決方針 | Local Queueに `clientEventId` を付与し、Sync時に冪等処理 |
