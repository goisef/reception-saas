# 環境の構成（本番 / 開発・デモ）

2つの環境を、**同じコード・同じ構成のまま、プロジェクトと環境変数で分けます。**
環境ごとに別のアーキテクチャを持たないので、本番を足すときにコードは変わりません。

| | 開発・デモ | 本番 |
| --- | --- | --- |
| 用途 | 開発の確認、上司・関係者への共有 | 実店舗の運用 |
| ブランチ | `main`（push のたびに自動デプロイ） | `production`（`main` から意図してマージしたときだけ） |
| Vercel | プロジェクト A（Hobby で可） | プロジェクト B（**Pro 以上**、または Cloud Run） |
| Firebase | `reception-saas`（Spark / 無料） | 別プロジェクト（例 `reception-saas-prod`、Blaze 推奨） |
| データ | デモデータ（シード）。消してよい | 実データ。消えてはいけない |
| 現状 | **稼働準備中** | **未作成**（下記の理由） |

## 分ける単位

**Firebase プロジェクトと Vercel プロジェクトを、環境ごとに別にします。**
同じ Firestore を共有すると、デモの操作が実データに触れ、シードのデモデータと
開発用ログインが本番に混ざります。ブランチやプレビューだけで分ける案は採りません。

- 本番だけを別の契約・別の場所（Pro / Cloud Run）へ移せる
- 「デモを今すぐ止める」操作が、本番に影響しない
- 鍵・パスワードが環境をまたいで使い回されない

## 環境変数の違い

| 変数 | 開発・デモ | 本番 |
| --- | --- | --- |
| `RECEPTION_ENV_LABEL` | `demo` | `prod` |
| `FIRESTORE_PROJECT_ID` | `reception-saas` | 本番用プロジェクトのID |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | デモ用プロジェクトの鍵 | **本番用プロジェクトの別の鍵** |
| `RECEPTION_SESSION_SECRET` | ランダムな値 | **別の**ランダムな値 |
| `RECEPTION_ADMIN_SESSION_SECRET` | ランダムな値 | **別の**ランダムな値 |
| `RECEPTION_ACCESS_PASSWORD` | 設定する（共有URLの目隠し） | 公開前だけ設定し、運用開始で外す |
| `RECEPTION_SEED` | 未設定（デモデータを入れる） | `0`（**必ず**） |
| `RECEPTION_DEMO_ADMIN_PASSWORD` | 設定する | **設定しない** |
| `RECEPTION_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | 不要 | 初回起動だけ設定し、ログインできたら外す |
| `RECEPTION_TENANT_ID` | 既定（`ten_demo`） | 本番のテナントID |
| `RECEPTION_PUBLIC_URL` | デモのURL | 本番のURL |

署名鍵（`*_SECRET`）を環境ごとに変えるのは、**デモで発行したログインが本番では
絶対に通らない**ようにするためです。

## ブランチと昇格

```text
main  ──push──▶  開発・デモ（自動デプロイ）
  │
  └─ 動作確認が済んだら ─ merge ─▶  production  ──▶  本番（自動デプロイ）
```

- 普段の開発は `main` へ。デモで確認します。
- 本番へ出すときだけ `production` へマージします。マージ前に、デモで次を通します:
  `npm test` / `bash scripts/smoke.sh` / 管理画面の主要操作。
- 本番で問題が出たら、Vercel の Deployments から**前のデプロイを Production に戻します**
  （コードを戻す前に、まず切り戻す）。
- `production` へ直接 push しません。ブランチ保護（直接 push 禁止・CI 必須）を
  GitHub の Settings → Branches で設定してください。

## 本番を立てる前に必要なもの

本番は **まだ作りません**。次が揃うまで、実店舗のデータを入れる環境は作れないためです。

1. **初期データの作成手段（未実装）。** 店舗・端末設定・受付端末のAPIキー・番号の
   プールを作る処理は、いまシード (`lib/store/seed.ts`) にしかありません。
   `RECEPTION_SEED=0` の本番にはテナントも店舗も存在せず、受付端末が動きません。
   管理ユーザーは `RECEPTION_BOOTSTRAP_ADMIN_*` で作れますが、その先がありません。
2. **ホスティングの決定。** Vercel Hobby は商用利用できません
   （[`HOSTING-FREE.md`](./HOSTING-FREE.md)）。Pro か Cloud Run
   （[`DEPLOYMENT.md`](./DEPLOYMENT.md)）のどちらにするか。
3. **Firestore の無料枠では足りない。** 一覧取得が全件読みのため、実データの常用は
   Blaze（従量課金）前提です。予算アラートを設定してください。
4. **本番の運用ルール。** 誰が `production` へマージするか、切り戻しの判断者、
   障害時の連絡先。

揃ったら、手順は次のとおりです。コードの変更はありません。

1. Firebase で本番用プロジェクトを作り、`npx firebase use --add` で別名 `prod` を付けて
   `npx firebase deploy --only firestore:rules` を実行する
2. サービスアカウント鍵を作る（デモとは別のもの）
3. GitHub に `production` ブランチを作り、保護を設定する
4. Vercel でプロジェクト B を作り、Production Branch を `production` にする
5. 上の表の「本番」の列のとおり環境変数を入れてデプロイする
6. 初期データの作成手段で、テナント・店舗・端末設定・端末キーを作る
7. 初期管理者でログインできることを確認し、`RECEPTION_BOOTSTRAP_ADMIN_*` を外す

## アプリ（APK / IPA）

接続先は `RECEPTION_APP_SERVER_URL` でビルド時に決まるため、GitHub の Environments を
`demo` と `prod` に分け、それぞれの URL を入れます（[`APP-RELEASE.md`](./APP-RELEASE.md)）。
同じ Bundle ID のアプリは1台に1つしか入らないので、デモ用と本番用を同じ端末で
併用しないでください。
