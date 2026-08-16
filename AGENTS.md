<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# このリポジトリについて

無人受付・来店管理SaaS。PRD は `docs/PRD.md` が単一の正で、
製品スコープ・データモデル・段階計画はすべてそこを参照する。
仕様が変わったら、他の場所で管理せずこのファイルを直接更新する。

API 仕様は `openapi/reception-v1.yaml` が単一の正。

## 触る前に読むもの

- `docs/PRD.md` — 特に 2章「最重要アーキテクチャ原則」の7原則
- `docs/DEVELOPMENT.md` — ディレクトリ構成と設計上の約束

## 守ること

- `lib/domain/` に I/O を書かない。純粋関数のみ。
- データへは `lib/store` の Datastore ポート越しにしか触らない。
- リポジトリ操作には必ず `tenantId` を渡す（テナント分離）。
- API ルートは必ず `lib/api/handler.ts` の `apiRoute()` を通す。
  認証・スコープ・Rate Limit・Idempotency・監査ログを素通りさせない。
- Server Action でも権限を確認する（Zero Trust）。
- 端末に判定を持たせない。文言も機能ON/OFFもサーバーが決める。
