# Gholdengo 家計簿

## Supabase
- Supabase はプロジェクト **porygon-works** 1つに、複数のアプリの DB をまとめている。新しいプロジェクトは作らない。
- アプリごとにスキーマを分ける。この家計簿の表はすべて **`ggmg` スキーマ**に置く（`public` は使わない）。
  - SQL では `ggmg.` を付けて書く（`supabase/migrations/`）。
  - アプリは `createClient(..., { db: { schema: "ggmg" } })`（`src/data/backend.ts`）。
  - GAS は REST の `Accept-Profile` / `Content-Profile` ヘッダーに `ggmg` を入れる（`gas/Code.gs`）。
  - Supabase の Data API → Exposed schemas に `ggmg` が入っている必要がある。

## リポジトリ
- このリポジトリは公開されている。家計のデータ（金額・お店・名前・移行用 JSON など）はコミットしない。テストの値は作り物にする。
- 計算は `src/engine/` だけで行う。仕様は `docs/SPEC.md`（v5）、設計の理由は `docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md`。計算式を変えたら設計書・仕様書とテストも直す。
- v5 の表は `v5_plans`・`v5_loans`・`v5_loan_balances`・`v5_moves`・`v5_months`（`0008_v5.sql`）。v4 の `plans`・`plan_debts`・`plan_funds`・`months` と v3 の `goals` は読まない（表は残している）。
- Claude との相談の取り込みは `gholdengo-ops-v2`（`docs/OPS.md`・`src/data/ops.ts`）。
- お店→費目の正規化は `src/engine/rules.ts` と `gas/Code.gs` の両方にある。変えるときは両方直す。
- 確認：`npm run typecheck && npm test && npm run build`
