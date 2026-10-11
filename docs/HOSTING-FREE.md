# 無料で共有URLを立てる

**Vercel Hobby（無料）+ Firebase Firestore（Spark / 無料）** の組み合わせです。
クレジットカードの登録なしで動きます。

PRD 13-1 の本番構成は Cloud Run ですが、Cloud Run は**請求先アカウントの
有効化が必須**で「無料枠はあるが無料では始められない」ため、共有用途では
この構成を採ります。本番へ移す際は [`DEPLOYMENT.md`](./DEPLOYMENT.md) を参照してください。

---

## 先に知っておくこと

### 1. Vercel Hobby は商用利用不可

Hobby プランの利用規約は個人・非商用に限られます。**社内デモや評価の段階なら
問題ありませんが、顧客に売る製品として運用する段階になったら Pro（有料）か
Cloud Run へ移してください。** ここを曖昧にしたまま進めないでください。

### 2. Firestore 無料枠の上限

| 項目 | Spark プランの上限 |
| --- | --- |
| 読み取り | 50,000 / 日 |
| 書き込み | 20,000 / 日 |
| 保存容量 | 1 GiB |

**このアプリは一覧取得でコレクションを全件読みます。**（`lib/store/firestore.ts` の
NOTE 参照）。デモ規模なら1画面あたり数十〜百件程度の読み取りで、1日500回ほど
画面を開ける計算です。デモには十分ですが、実データを入れて常用する段階では
足りません。

上限に達すると**その日は読み書きが止まります**。上司に見せる直前に大量操作を
しないでください。

### 3. サービスアカウント鍵を1つだけ作ります

Vercel は GCP の外にあるため、Cloud Run のような自動認証が使えません。
サービスアカウント鍵（JSON）を Vercel の環境変数に入れます。

**この鍵はリポジトリに入れないでください。** `.gitignore` 済みですが、
コピペ先にも注意してください。鍵が漏れたら Firestore を直接読み書きされます。

---

## 手順

### 1. Firebase プロジェクトを作る

1. https://console.firebase.google.com/ で「プロジェクトを追加」
2. プロジェクト名を決める（例: `reception-saas`）
3. Google アナリティクスは不要
4. 左メニュー **Firestore Database** → 「データベースの作成」
   - モードは **本番環境モード**（ルールは後で入れます）
   - ロケーションは `asia-northeast1`（東京）

### 2. セキュリティルールを入れる

このアプリはサーバーからしか Firestore を触りません。
ブラウザから直接読まれないよう全部閉じます。

```bash
npx firebase login
npx firebase use --add        # 作ったプロジェクトを選ぶ
npx firebase deploy --only firestore:rules,firestore:indexes
```

`firestore.indexes.json` には `idempotency.expiresAt` の TTL 設定が入っており、
期限切れの冪等キーが自動で消えます。

### 3. サービスアカウント鍵を作る

1. Firebase コンソール → プロジェクトの設定 → **サービスアカウント**
2. 「新しい秘密鍵の生成」→ JSON がダウンロードされる

### 4. Vercel へデプロイ

```bash
npx vercel login
npx vercel link          # このリポジトリを Vercel プロジェクトに紐付け
```

環境変数を設定します（Vercel の管理画面 → Settings → Environment Variables）。

| 変数 | 値 | 備考 |
| --- | --- | --- |
| `RECEPTION_DATASTORE` | `firestore` | これが無いと in-memory のままでデータが壊れます |
| `FIRESTORE_PROJECT_ID` | Firebase のプロジェクトID | |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | 手順3のJSONの中身をそのまま貼る | **Sensitive にすること** |
| `RECEPTION_ACCESS_PASSWORD` | 共有用パスワード | 8文字以上 |
| `RECEPTION_SESSION_SECRET` | ランダムな文字列 | `openssl rand -base64 32` |
| `RECEPTION_ENV_LABEL` | `demo` または `dev` | ログイン画面に出ます |
| `RECEPTION_ADMIN_SESSION_SECRET` | ランダムな文字列 | `openssl rand -base64 32`。**未設定だと `/admin` が開けません**（偽造を防ぐため起動を止めます） |
| `RECEPTION_DEMO_ADMIN_PASSWORD` | 10文字以上のパスワード | **必ず設定。** 未設定だとデモの管理ユーザーが作られず、管理画面にログインできません（既知のパスワードを共有URLに残さないため） |
| `RECEPTION_PUBLIC_URL` | デプロイ先のURL（例 `https://xxx.vercel.app`） | 招待リンクの土台。未設定だと Host ヘッダから組み立てます |
| `RECEPTION_SEED` | 初回だけ未設定、以降 `0` | 下記参照 |

```bash
npx vercel --prod
```

### 5. シードの扱い

初回デプロイ時はデモデータを入れたいので `RECEPTION_SEED` は未設定のままに
します。シードは**投入済みなら何もしない**ので、2回目以降の起動で上書き
されることはありません。

シードには管理画面のログイン（`admin@example.com` / `osaka@example.com` /
`viewer@example.com`）が含まれます。**3人とも `RECEPTION_DEMO_ADMIN_PASSWORD` の
値がパスワードになる**ので、共有URLに出す前に必ず設定してください。
初回ログイン後は、管理画面の「アカウント」からご自身のパスワードを変更できます。
メールアドレスは `RECEPTION_DEMO_ADMIN_EMAIL` で変えられます（管理者の1人目のみ）。

**すでにデプロイ済みの環境**は、テナントが投入済みなのでシードが走り直さず、管理ユーザーが
1人もいません。その場合は `RECEPTION_BOOTSTRAP_ADMIN_EMAIL` と
`RECEPTION_BOOTSTRAP_ADMIN_PASSWORD` を設定して再デプロイすると、管理ユーザーが0人のときだけ
管理者を1人作ります（ログインできたら環境変数は外してください）。

デモ中に追加したデータを消したくないので、そのままで構いません。
初期状態に戻したい場合は Firestore の `tenants` コレクションを削除してから
再デプロイしてください。

---

## 環境の分け方

本番と開発・デモを、プロジェクトごとに分けます。ブランチ、環境変数の違い、
本番を立てる前に必要なものは [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) にあります。

この文書の手順は **開発・デモ** の環境（`main` ブランチ、Vercel Hobby、Firebase Spark）を
立てるものです。本番は、同じ手順を別の Firebase / Vercel プロジェクトで行いますが、
ホスティングの条件（Hobby は商用不可）と初期データの作成手段が先に必要です。

### デモを今すぐ止める

Vercel の管理画面で以下のいずれか。どちらも数十秒で効きます。

- **Settings → Deployment Protection → Vercel Authentication を ON**
  Vercel にログインできる人だけがアクセスできる状態になります。
- **Deployments → 該当デプロイ → Delete**
  URL ごと消えます。

コマンドからは次で止まります。

```bash
npx vercel env add RECEPTION_ACCESS_PASSWORD production   # 新しい値に変える
npx vercel --prod                                          # 反映
```

パスワード変更は既存のログインセッションも失効させます（セッション鍵に
パスワードを使っているため）。

---

## 動作確認

```bash
curl https://<あなたのURL>/health     # {"status":"ok",...}
curl https://<あなたのURL>/ready      # {"status":"ready","checks":{"datastore":"ok"}}
```

`/ready` の `datastore` が `error` なら Firestore に繋がっていません。
`RECEPTION_DATASTORE` と認証情報の設定を見直してください。

ブラウザで開くとパスワードを聞かれ、通ると受付画面と管理画面が使えます。

---

## ローカルで同じ構成を試す

エミュレータを使えば、GCP のアカウントなしで Firestore 構成を確認できます。

```bash
npm run emulator        # 別ターミナルで起動しておく
npm run dev:firestore   # Firestore を使って開発サーバー起動
npm run test:firestore  # 両ドライバで契約テスト
```
