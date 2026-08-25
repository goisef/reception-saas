# アプリ配布ガイド（APK / IPA）

PRD: [`PRD.md`](./PRD.md) 6章・17-2 / サーバー側のデプロイ:
[`DEPLOYMENT.md`](./DEPLOYMENT.md) / 無料の共有URL: [`HOSTING-FREE.md`](./HOSTING-FREE.md)

---

## まず結論

| やりたいこと | 必要なもの | 所要 |
| --- | --- | --- |
| iPad で今すぐ使う | URL だけ | 5分 |
| Android 端末に APK を入れる | GitHub Actions + 署名鍵 | 30分 |
| iPad に IPA を入れる / TestFlight | **Mac** + Apple Developer Program（年 99 USD） | 半日〜 |
| App Store 公開 | 上記 + 審査 | 数日〜 |

**iPad で使うだけなら、アプリは要りません。** 受付画面をホーム画面に追加すれば、
アドレスバーもタブも消えて全画面で起動します。手順は端末で
`/reception/setup` を開くと案内が出ます。

アプリが要るのは次のいずれかに当てはまるときだけです。

- App Store / Google Play に載せたい
- MDM で店舗端末を一括管理したい
- キオスクモードなど、ブラウザではできない端末制御をしたい

---

## アプリの中身

受付画面はアプリに焼き込んでいません。アプリはサーバーの受付画面を
読み込むだけの薄い殻です（`capacitor.config.ts` の `server.url`）。

```text
アプリが持つもの        サーバーが持つもの
どのサーバーを見るか  →  受付画面 / ボタン文言 / 機能ON/OFF / 業務ロジック
通信できないときの画面
```

設計原則 P-1「端末をアップデートしなくても仕様変更できる」と
P-7「アプリ配布方式に進化速度を依存させない」を、ネイティブ配布に
移っても崩さないためです。**ボタンの文言を変えるのに審査は要りません。**

接続先はビルド時に決まります。dev / demo / 本番で別のソースを持たず、
`RECEPTION_APP_SERVER_URL` を差し替えて同じソースから出します。

```bash
RECEPTION_APP_SERVER_URL=https://reception-demo.example.com npx cap sync
```

未指定のとき、および `https://` で始まらないときはビルドが失敗します。
受付端末は氏名と予約情報を運ぶため、平文で載せる構成を作らせません。

---

## リリースする

GitHub Actions の **App Release** ワークフローを手動実行します。

| 入力 | 意味 |
| --- | --- |
| `environment` | どの Environment の Secret と接続先を使うか |
| `version` | `1.1.0` などの表示バージョン |
| `platform` | `both` / `android` / `ios` |
| `ios_method` | `app-store-connect` / `ad-hoc` / `development` |
| `upload_testflight` | TestFlight まで上げるか |

Build Number は `github.run_number` を使うため、手で採番する必要はありません。
実行後、ジョブのサマリに PRD 6-2 / 6-3 のリリース管理項目
（Version / Build Number / Commit / SHA-256 / Minimum OS / Signing Profile）が出ます。

成果物は Actions の Artifact に置かれます。取得にはリポジトリの権限が要ります。

---

## 必要な Secret

GitHub の **Environments**（dev / demo / prod）ごとに登録します。
環境をまたいで同じ鍵を使い回さないでください。

### 変数

| 名前 | 種別 | 内容 |
| --- | --- | --- |
| `RECEPTION_APP_SERVER_URL` | Variable | アプリの接続先。`https://` 必須 |

### Android

| 名前 | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore を base64 にしたもの |
| `ANDROID_KEYSTORE_PASSWORD` | keystore のパスワード |
| `ANDROID_KEY_ALIAS` | 鍵のエイリアス |
| `ANDROID_KEY_PASSWORD` | 鍵のパスワード |

keystore の作成:

```bash
keytool -genkeypair -v -keystore release.jks -alias reception \
  -keyalg RSA -keysize 4096 -validity 10000

base64 -w0 release.jks   # 出力を ANDROID_KEYSTORE_BASE64 へ貼る
```

> **この keystore を失うと、同じアプリの更新版を二度と出せません。**
> Secret へ登録したら手元からは消し、原本はパスワードマネージャか
> Secret Manager にだけ置いてください（PRD 13-4）。

### iOS

| 名前 | 内容 |
| --- | --- |
| `APPLE_DISTRIBUTION_CERT_P12_BASE64` | Distribution 証明書（`.p12`）の base64 |
| `APPLE_DISTRIBUTION_CERT_PASSWORD` | `.p12` のパスワード |
| `APPLE_PROVISIONING_PROFILE_BASE64` | プロビジョニングプロファイルの base64 |
| `APPLE_TEAM_ID` | Apple Developer の Team ID |
| `APPSTORE_CONNECT_KEY_ID` | App Store Connect API キーの ID |
| `APPSTORE_CONNECT_ISSUER_ID` | 同 Issuer ID |
| `APPSTORE_CONNECT_PRIVATE_KEY_BASE64` | `AuthKey_XXXX.p8` の base64 |

証明書とプロファイルの作成は Apple Developer のサイトと Xcode で行います。
Bundle ID は `jp.receptionsaas.terminal` です。

ワークフローは証明書を一時キーチェーンにだけ取り込み、成功・失敗に
関わらずジョブ終了時に破棄します。ランナーにも開発者PCにも鍵を残しません。

---

## iOS の配布方式

**IPA を Web に置いて誰でもインストールできる形にはしません**（PRD 6-3）。
Android の APK と違い、Apple の署名・プロビジョニング・配布方式に従います。

| 用途 | 方式 | 相手の端末に必要なこと |
| --- | --- | --- |
| 開発 | Development Build | 端末UDIDの登録 |
| 社内・検証 | TestFlight | 招待メールと TestFlight アプリ |
| 特定端末への限定配布 | Ad Hoc | 端末UDIDの登録（100台/年） |
| 法人・大規模顧客 | Apple Business Manager / MDM | 組織の ABM 参加 |
| 一般公開 | App Store | なし（審査あり） |

上司や顧客に見せるだけなら **PWA（URL を共有）が最短**です。
TestFlight は招待とインストールの手間がかかり、審査（Beta App Review）も入ります。

### 審査で気をつける点

このアプリは Web 画面を読み込む薄い殻です。App Store に一般公開する場合、
ガイドライン 4.2（最低限の機能）に触れる可能性があります。
店舗向けの業務端末として TestFlight / Ad Hoc / ABM で配る分には問題になりません。
一般公開する段階になったら、カメラでのQR読み取りなどネイティブ機能を
アプリ側に持たせる判断が要ります。

---

## 手元で動かす

```bash
npm install

# 接続先を決めてネイティブプロジェクトへ反映
RECEPTION_APP_SERVER_URL=https://reception-demo.example.com npx cap sync

# Android (要 Android SDK)
npm run android:apk

# iOS (要 Mac + Xcode)
npm run ios:open
```

`android/` と `ios/` はコミットしていますが、`cap sync` が生成する
`capacitor.config.json` と `public/` は Git 管理外です。接続先が
コミットに焼き付かないようにするためで、**チェックアウト直後は
必ず一度 `cap sync` を通してください。**

---

## 端末側の設定

アプリを入れただけでは受付端末になりません。来店客が別の画面へ
移動できる状態を残さないでください。

| OS | 設定 |
| --- | --- |
| iPadOS | 設定 → アクセシビリティ → アクセスガイド（単一アプリに固定） |
| iPadOS（法人） | Apple Business Manager + MDM の自動デバイス登録 |
| Android | 設定 → セキュリティ → 画面の固定、または MDM のキオスクモード |

画面の自動消灯は切ってください。アプリ側でも表示中は消灯を抑止していますが、
端末の電源設定が優先される場合があります。

---

## この環境でできないこと

CI を書いた開発環境は Linux です。次は**この場では検証できていません**。

| 項目 | 理由 |
| --- | --- |
| APK の実ビルド | Android SDK を取得できない（ネットワーク制限） |
| IPA のビルド・署名 | macOS と Xcode が必要 |
| 実機での起動確認 | 実機がない |

検証済みなのは、ネイティブプロジェクトの生成、設定の注入、
リソース（アイコン・スプラッシュ・マニフェスト・Info.plist）の妥当性、
オフライン画面の描画までです。初回の APK / IPA ビルドは
**GitHub Actions 上で通ることを確認してから**店舗へ配ってください。
