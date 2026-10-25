# 余裕額を中心にした家計簿（v5）計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v4 の土台（取り込み・重複の処理・ログイン・明細の表）を残し、計算と画面を「余裕額」を中心にした形に入れ替える。

**Architecture:** 新しい計算は `src/engine/` に v5 用の小さなファイルとして足し、画面を1つずつ v5 の計算に切り替える。v5 だけが使うデータは新しい表（`ggmg.v5_*`）に置くので、切り替えまで main の v4 は今までどおり動く。最後の段階で v4 の計算・画面・表の使い方を消し、仕様書を v5 にする。

**Tech Stack:** Vite + React 19 + TypeScript 5.9、Vitest、Supabase（`ggmg` スキーマ）、GAS、Vercel（ブランチごとのプレビュー）。

**Spec:** `docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md`（以下「設計書」）

## 進め方（本人との約束）

- 1回の返答で1段階だけ作る。作ったら設計書と見比べて自分でレビューし、ずれや問題を報告する。
- 段階ごとに「確かめ方」を本人に伝え、本人が確かめてから次へ進む。
- 途中で「違う」となったら、コードより先に設計書を直す。
- 作業ブランチは `claude/determined-bardeen-f06n1g`。push するたびに Vercel のプレビューができる。本人はプレビューで確かめる。main（v4）には段階11まで入れない。

## Global Constraints

- 表はすべて `ggmg` スキーマ。`public` は使わない。新しい表も `ggmg.` を付けて `supabase/migrations/` に書く。何度実行しても壊れない SQL にする。
- 計算は `src/engine/` だけで行う。画面（`src/ui/`）は engine の関数の結果を出すだけ。
- お店→費目の正規化は `src/engine/rules.ts` と `gas/Code.gs` の両方にある。変えるときは両方直す（この計画では変えない）。
- リポジトリは公開。テストの値は作り物。家計のデータはコミットしない。
- 確認：`npm run typecheck && npm test && npm run build` が通ってから push する。
- 段階11まで、v4 の表（`plans`・`plan_debts`・`plan_funds`・`months`・`goals`）には書かない。v4 の画面が壊れないこと。
- 画面に出る名前は設計書 §6 の用語表の熟語を使う（余裕額・支払予定額・確保額・予算残額・費目別残額・目安額・積立額・目標額・期日・配分・借入残高・借入残高の修正・取崩順・取崩不可・請求見込・未入金給与・未回収立替）。
- 計算した数字は、例外なくタップで内訳（式と数字、その中身の行）が出る（設計書 §4.1）。説明文は置かない。
- 金額は頭に ¥、右寄せ。見込みは点線の枠と「見込」の印。

## Review Focus

1. **月の変わり目**（月末 → 1日、15日の給料日、カードの引落日）で余裕額が跳ねないこと。設計書 §2.4 の例を日ごとにたどったとき、表のとおりになる（段階4・6のテスト）。
2. **土日祝で引落日がずれる**とき、その請求が「未払い」から外れるのは、ずれた後の引落日の翌日からであること（段階4のテスト）。
3. **重複でまとめられた明細・消した明細**（`merged_into` がある・`deleted`）は、予算にも請求見込にも余裕額にも数えないこと（段階2・4のテスト）。
4. **給与の予定がない月**（定期を入れていない先の月）は、目安額に `settings.salaryEstimate` を使い、未入金給与もその額で数えること（段階2・6のテスト）。
5. **同じ日に借入残高を2回直した**ときは、あとから入れたほうを使うこと（`at` の順）。修正の差は1回分ずつ内訳に出る（段階3のテスト）。

---

## ファイルの分け方

| ファイル | 役目 | 段階 |
| --- | --- | --- |
| `supabase/migrations/0008_v5.sql` | v5 の表（`v5_plans`・`v5_loans`・`v5_loan_balances`・`v5_moves`・`v5_months`）と、口座明細の大費目に `bonus` を足す | 1 |
| `src/engine/types.ts` | v5 の型を足す（`V5Plan`・`Loan`・`LoanBalance`・`PlanMove`・`V5Month`・`Data.v5`）。`AccountGroup` に `"bonus"` | 1 |
| `src/engine/breakdown.ts` | 内訳の型 `Part` と、合計・表示用の小さな関数 | 2 |
| `src/engine/budget5.ts` | 月の予算・目安額・予算残額・費目別残額 | 2 |
| `src/engine/loan.ts` | 借入残高・毎月の返済（見込みの行）・リボに回した分・修正 | 3 |
| `src/engine/slack.ts` | 余裕額とその部品（①〜⑤・確保額・未入金給与・未回収立替） | 4 |
| `src/engine/reserve.ts` | 購入・貯蓄の計画の積立額・配分・取崩順・ひも付けた購入 | 5 |
| `src/engine/outlook.ts` | 見通し：日ごとの口座残高と余裕額、返済の計画の3つの表示、一番少なくなる日 | 6 |
| `src/engine/whatif.ts` | 変更を当てる前と後の比べ（予定を入れる・予算に足す・Claude の取り込み） | 7 |
| `src/engine/v5.test.ts` ほか `*.test.ts` | 各ファイルのテスト（作り物の数字） | 各段階 |
| `src/data/backend.ts`・`src/data/store.ts` | v5 の表を読む・書く（表がまだなければ空として読む） | 1・各段階 |
| `src/ui/Parts.tsx` | 内訳を出す下からの板（どの画面でも同じ形） | 2 |
| `src/ui/Home5.tsx` | v5 のホーム | 2・4 |
| `src/ui/Plans5.tsx` | v5 の計画（借入・購入・貯蓄・返済） | 3・5 |
| `src/ui/Outlook5.tsx` | v5 の見通し | 6 |
| `src/ui/Preview.tsx` | 予定を入れる前の比べと、余裕額がマイナスになるときの確認 | 7 |
| `src/ui/Ledger.tsx`・`src/ui/Sheets.tsx` | 明細の切り替え・リボに回す・計画にひも付け | 8 |
| `src/ui/Settings.tsx` | 予算・給与と賞与 | 9 |
| `src/data/snapshot.ts`・`src/data/ops.ts`・`docs/OPS.md` | Claude との書き出し・取り込み（v2） | 10 |
| `docs/SPEC.md`・`README.md`・`CLAUDE.md` | v5 の仕様 | 11 |

v4 の `compute.ts`・`plans.ts` と v4 の画面は、段階11で使っていない部分を消す。それまでは残す（v4 の画面と並べて比べられるように）。

---

### 段階1：v5 の表と型

**作るもの:** v5 の表を作る SQL、v5 の型、v5 の表を読む仕組み（表がまだなくても今までどおり動く）。画面は変えない。

**確かめ方（本人）:**
1. Supabase の SQL Editor で `0008_v5.sql` を貼って Run し、エラーが出ない。もう一度 Run してもエラーが出ない。
2. プレビューの URL を開き、ホーム・明細・見通し・計画・設定が今までどおり出る。

**完成の条件:** 上の2つ。`npm run typecheck && npm test && npm run build` が通る。

**Files:**
- Create: `supabase/migrations/0008_v5.sql`
- Modify: `src/engine/types.ts`、`src/data/backend.ts`、`src/data/store.ts`
- Test: `src/data/v5load.test.ts`

**Interfaces:**
- Produces（型。列名と同じ名前）:
  - `V5Plan { id; kind: "repay"|"buy"|"save"; name; target: number; due_date: string|null; monthly: number; start_month: string|null; draw_order: number; no_draw: boolean; done: boolean; sort: number }`
  - `Loan { id; plan_id: string|null; name; card: string|null; monthly: number; pay_day: number|null; sort: number }`（`card` があれば、毎月の返済はそのカードの引落日。なければ `pay_day`）
  - `LoanBalance { id; loan_id; date: string; balance: number; at?: string }`
  - `PlanMove { id; plan_id; kind: "manual"|"bonus"|"draw"|"spend"; amount: number; date: string; bonus_entry_id: string|null; entry_kind: "card"|"account"|null; entry_id: string|null; memo: string }`（`amount` はいつもプラス。`draw`・`spend` は積立額を減らす）
  - `V5Month { month: string; budget: number; source: "guide"|"decided" }`
  - `Data.v5: { plans: V5Plan[]; loans: Loan[]; balances: LoanBalance[]; moves: PlanMove[]; months: V5Month[] }`（表がなければ全部 `[]`）
  - `AccountGroup` に `"bonus"`。`IN_GROUPS` に足す。`ACCOUNT_GROUP_LABEL.bonus = "賞与"`
  - 変動費の費目の初めの値に「現金」を足す（`DEFAULT_SETTINGS.varCats`。設計書 §3.6）

- [x] **Step 1: 失敗するテストを書く** — `src/data/v5load.test.ts`：`toData(raw)`（`src/data/store.ts` の読み込みの変換。テストから使えるように export する）に v5 の表がない raw を渡すと `data.v5` が全部空配列になる。v5 の表に1行ずつ入った raw を渡すと、数値の列（`target`・`monthly`・`balance`・`amount`・`budget`）が number になっている。
- [x] **Step 2: テストを流して失敗を見る** — `npx vitest run src/data/v5load.test.ts` → FAIL（`v5` がない）
- [x] **Step 3: `0008_v5.sql` を書く** — 0007 と同じ形（`user_id default auth.uid()`、RLS の `own` ポリシー、`updated_at`）。`v5_months` は `(user_id, month)` が主キー。`v5_loan_balances.loan_id` と `v5_moves.plan_id` は `on delete cascade`。`account_entries` の大費目の check 制約を、`'bonus'` を足したものに作り直す（制約名は `pg_constraint` から引く `do $$ … $$`）。
- [x] **Step 4: 型と読み込みを足す** — `backend.ts` に `V5Table = "v5_plans"|"v5_loans"|"v5_loan_balances"|"v5_moves"|"v5_months"` を足し、`V4_TABLES` と同じく「なければ空」で読む。`upsertKeyed` に `v5_months` を足す。`store.ts` の変換で `data.v5` を作る。
- [x] **Step 5: テストを流して通るのを見る** — `npx vitest run src/data/v5load.test.ts` → PASS
- [ ] **Step 6: 全体の確認** — `npm run typecheck && npm test && npm run build` → すべて通る
- [ ] **Step 7: コミットして push**

---

### 段階2：内訳の仕組みと、予算（ホームの上半分）

**作るもの:** 計算した数字をタップすると内訳が出る仕組み。v5 の月の予算・目安額・予算残額・費目別残額。v5 のホーム（予算残額と費目別残額、最近の明細）。下のタブの「ホーム」を v5 のホームにする（ほかのタブは v4 のまま）。

**確かめ方（本人）:**
1. プレビューのホームの一番上に今月の予算残額、その下に費目別残額が出る。予算をこえた費目は赤い。最後の行に固定費の合計（見込みと使った額）。
2. 予算残額をタップすると「予算残額 ＝ 予算 − 使った額 − 予定 − 固定費の超過」が数字つきで出る。「使った額」をタップすると、その明細の一覧が出る。
3. 予算をタップすると、目安額の内訳（給与の見込み − 固定費 − 借入の毎月の返済 − 計画の毎月の積立額）が出る（借入・計画はまだ0）。
4. 最近の明細に、メールから入った明細の印がある。

**完成の条件:** 上の4つ。今月の予算残額が v4 の残り予算と同じ考え方で合っている（v4 と違うのは、目安額の引き算の中身だけ）。

**Files:**
- Create: `src/engine/breakdown.ts`、`src/engine/budget5.ts`、`src/engine/budget5.test.ts`、`src/ui/Parts.tsx`、`src/ui/Home5.tsx`
- Modify: `src/engine/index.ts`、`src/ui/App.tsx`（ホームのタブだけ差し替え）

**Interfaces:**
- Produces:
  - `interface Part { key: string; label: string; amount: number; sign: 1 | -1; parts?: Part[]; rows?: PartRow[] }`、`interface PartRow { date: string; name: string; amount: number; plan: boolean; ref: { kind: "card"|"account"|"virtual"; id: string } }`
  - `total(parts: Part[]): number`（`Σ sign × amount`）
  - `guideOf(d: Data, ym: string): Part`（key `guide`。子：`salary`（給与の見込み。その月の給与の入金、なければ `settings.salaryEstimate`）・`fixed`・`loanMonthly`・`planMonthly`。借入と計画は段階3・5で中身が入る。いまは0の子として出す）
  - `monthBudget(d: Data, ym: string): { amount: number; source: "decided"|"guide"|"live"; guide: Part }`（`v5.months` にあればその額、なければ目安額（`live`））
  - `budgetView(d: Data, ym: string, today: string): { budget: number; left: Part; cats: CatLeft[]; fixed: { budget: number; used: number } }`（`left` の key は `budgetLeft`。子：`budget`・`used`・`planned`・`fixedOver`。`CatLeft { cat; budget; used; planned; left; over: boolean; rows: PartRow[] }`。予備は v4 と同じく「予算 − 費目別の予算の合計」で、使いすぎを予備で埋めない）
- Consumes: v4 の `spendOf`・`budgetsFor`（`compute.ts`）はそのまま使ってよい。

- [x] **Step 1: 失敗するテストを書く** — `budget5.test.ts`：
  - `budgetView` 予算 17万・食費予算 3万で、食費のカード明細 3.5万（確定）を入れると、食費の `left` が −5千・`over` が true、予備の `left` は変わらない、全体の `left.amount` は 13.5万。
  - `merged_into` がある明細と、消した（読み込みで外した）明細は数えない。
  - 固定費の費目の予算 8万に対して家賃の明細が 8.5万なら、`fixedOver` が 5千で、全体の `left` が 5千減る。
  - `guideOf`：その月に給与の入金（予定）25万・固定費の予算 8万なら `amount` 17万。給与の入金がない月は `salaryEstimate`（例 24万）を使う。
  - `monthBudget`：`v5.months` に `{ month, budget: 15万, source: "decided" }` があれば 15万、なければ目安額。
- [x] **Step 2: テストを流して失敗を見る** — `npx vitest run src/engine/budget5.test.ts` → FAIL
- [x] **Step 3: `breakdown.ts`・`budget5.ts` を書く** — 署名は上のとおり。
- [x] **Step 4: テストを流して通るのを見る** → PASS
- [x] **Step 5: `Parts.tsx` を書く** — `<PartSheet part={Part} />`：上に式（`label ¥amount ＝ 子 ± 子 …`）、子をタップするとその子の式、`rows` があれば明細の一覧（タップで v4 の明細の板を開く）。どの数字もこの板で開く。
- [ ] **Step 6: `Home5.tsx` を書き、ホームのタブを差し替える** — 上から：予算残額（大）、費目別残額、最近の明細（取り込み元が `card_flash`・`card_statement` なら印）、余裕額（段階4まで「―」）、使ったものを入れる（v4 の入力をそのまま使う）。
- [ ] **Step 7: 全体の確認とプレビュー** — `npm run typecheck && npm test && npm run build` → 通る。`npm run dev` のお試しモードで、ホームが出て、予算残額の内訳が開くのを見る。
- [ ] **Step 8: コミットして push**

---

### 段階3：借入（リボ）

**作るもの:** 借入残高の計算（記録した残高 ＋ リボに回した分 − 毎月の返済 − まとめての返済）、借入残高の修正、毎月の返済を口座の予定として出す（保存しない見込みの行）。計画のタブに v5 の「借入」の欄を足し、返す先・残高・毎月の返済額を入れられるようにする。

**確かめ方（本人）:**
1. 計画のタブの「借入」に、セゾンのリボを返す先として入れ、いまの残高と毎月の返済額を入れられる。
2. 借入残高をタップすると、記録した残高・そのあとリボに回した分・返した分が出る。
3. カードのサイトの額に直すと、内訳に「借入残高の修正 ¥…」が出る。
4. ホームの予算をタップしたときの目安額の内訳に、借入の毎月の返済が入る。

**完成の条件:** 上の4つ。

**Files:**
- Create: `src/engine/loan.ts`、`src/engine/loan.test.ts`、`src/ui/Plans5.tsx`（借入の欄だけ）
- Modify: `src/engine/budget5.ts`（`loanMonthly` の中身）、`src/data/store.ts`（`actions` に `addLoan`・`updateLoan`・`removeLoan`・`setLoanBalance`）、`src/ui/App.tsx`

**Interfaces:**
- Produces:
  - `loanPayments(d: Data, loan: Loan, from: string, to: string): PartRow[]`（毎月の返済の見込みの行。`card` があれば `cardPayDate`（`schedule.ts`）の日、なければ `pay_day` を `shiftBusiness(…, "next")`。残高を超えない。期日にまとめて返す計画（`V5Plan.kind = "repay"`・`due_date`）があれば、その日に残りを全部返す行を1つ足し、そのあとは出さない）
  - `loanAt(d: Data, loan: Loan, t: string): Part`（key `loan:<id>`。子：`recorded`（`t` 以前で一番新しい記録。同じ日なら `at` があとのもの）・`purchase`（記録の日より後〜`t` の、その `card` のクレカ明細の大費目「分割（購入）」＝リボに回した分）・`paid`（記録の日より後〜`t` の返済の行）。0 より小さくしない）
  - `loanCorrections(d: Data, loan: Loan): PartRow[]`（記録ごとに「1つ前の記録から計算した額」との差。名前は「借入残高の修正」）
  - `loansAt(d: Data, t: string): Part`（key `loans`。返す先ごとの `loanAt` の合計）
- Consumes: `Part`・`PartRow`（段階2）。

- [x] **Step 1: 失敗するテストを書く** — `loan.test.ts`（作り物の数字）：
  - 記録 10/1 に 20万、毎月の返済 1万（セゾン、翌月4日払い）。`loanAt(…, "2026-12-31")` は 18万（11/4・12/4 の2回）。
  - 11/20 の家賃 8万をリボに回す（セゾンのクレカ明細・大費目 `purchase`）と、`loanAt(…, "2026-11-30")` は 27万。
  - 期日 12/27 にまとめて返す返済の計画があれば、`loanPayments` の 12/27 に残り全部の行があり、`loanAt(…, "2026-12-31")` は 0。
  - 同じ日 11/10 に 26万（`at` 10:00）と 25.5万（`at` 11:00）を記録すると、11/10 の残高は 25.5万、`loanCorrections` は記録ごとに1行ずつ出る。
  - 12/4 が土曜なら返済の行は 12/7（翌営業日）。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: `loan.ts` を書き、`guideOf` の `loanMonthly` にその月の返済の行の合計を入れる**
- [x] **Step 4: テストを流して通るのを見る** → PASS（`budget5.test.ts` も通ったまま）
- [x] **Step 5: `Plans5.tsx` の借入の欄と store の actions を書く** — 借入の一覧（返す先・借入残高（タップで内訳）・毎月の返済額）、足す・直す・消す、残高を直す（今日の日付で `v5_loan_balances` に1行）。計画のタブは、上に v5 の借入、下に v4 の計画（比べるため）。
- [ ] **Step 6: 全体の確認** → 通る
- [ ] **Step 7: コミットして push**

---

### 段階4：余裕額（今日）

**作るもの:** 余裕額とその部品の計算（設計書 §2.2）。ホームに余裕額を出し、タップで内訳を出す。

**確かめ方（本人）:**
1. ホームの余裕額をタップすると「余裕額 ＝ 口座残高 ＋ 未入金給与 ＋ 未回収立替 − 支払予定額 − 確保額」が数字つきで出る。
2. 支払予定額をタップすると、①未払いのクレカ請求（カード・引落日ごと）、②今月の口座の予定、③今月の予算残額、④借入残高、⑤先の月の追加予算（まだ0）が出て、どれも中の行までたどれる。
3. 自分の感覚で、口座残高と支払予定額の中身が合っている（入っていない請求や、二重に入っているものがない）。

**完成の条件:** 上の3つ。設計書 §2.4 の例が、テストで日ごとに表のとおりになる。

**Files:**
- Create: `src/engine/slack.ts`、`src/engine/slack.test.ts`
- Modify: `src/ui/Home5.tsx`、`src/engine/index.ts`

**Interfaces:**
- Produces:
  - `slackAt(d: Data, t: string, today: string): Part`（key `slack`。子は次の順）
    - `bank`：口座残高。`t ≤ today` は v4 の `accountNow`（財布は使わない）と、`t` 以前の確定した口座明細。`t > today` は段階6で作る（いまは `t = today` だけ対応し、それ以外は例外）
    - `salary`（+）：`ym(t)` の給与の入金で計上日が `t` より後のもの（予定）。その月に給与の入金がなければ `salaryEstimate`
    - `refund`（+）：大費目「立替の返金」の予定の入金
    - `due`（−）：支払予定額。子：`card`（① カードごと・引落日ごとの `Bill`（`compute.ts` の `billsFor`）のうち、締め月が `ym(t)` 以前で引落日が `t` より後のもの。額は `Bill.amount`）、`planned`（② 計上日が `t` より後〜`ym(t)` の月末の、口座の予定の出金。大費目「クレカ支払い」と借入の返済は除く）、`budget`（③ `max(0, budgetView(d, ym(t), today).left.amount)`）、`loans`（④ `loansAt(d, t)`）、`ahead`（⑤ 段階7で中身。いまは0）
    - `reserve`（−）：確保額（段階5で中身。いまは0）
  - `slackValue(d, t, today): number` ＝ `total(slackAt(…).parts)`
- Consumes: `billsFor`（`compute.ts`）、`budgetView`（段階2）、`loansAt`（段階3）。

- [x] **Step 1: 失敗するテストを書く** — `slack.test.ts` に設計書 §2.4 のデータを作る（給与 25万・家賃 8万（セゾン）・予算 17万（三井）・11/1 の口座 30万、10月の三井 17万と10月の家賃 8万が未払い）。
  - `slackValue(d, "2026-11-01", "2026-11-01")` が 5万。
  - 11/4・11/15・11/26 の各日を `today` にして（その日までの明細を確定にして）5万のまま。
  - 11/20 に家賃をリボに回したデータで、11/20 も 5万のまま（④が +8万、①が −8万）。
  - 12/4 が土曜の年のデータでは、12/5 でもセゾンの請求が①に残り、12/7 の翌日に外れる（Review Focus 2）。
  - まとめられた（`merged_into`）クレカ明細は①に入らない（Review Focus 3）。
  - 立替の返金の予定 3千があれば `refund` が 3千。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: `slack.ts` を書く**
- [x] **Step 4: テストを流して通るのを見る** → PASS
- [x] **Step 5: ホームに余裕額を出す** — 小さく1行、タップで `PartSheet`。マイナスなら赤。
- [ ] **Step 6: 全体の確認** → 通る
- [ ] **Step 7: コミットして push**

---

### 段階5：計画（購入・貯蓄・返済）

**作るもの:** 購入・貯蓄の計画の積立額（毎月の積立額・余裕額から入れる・賞与からの配分・取り崩し・ひも付けた購入）、確保額、取崩順と取崩不可。返済の計画（期日と、その計画で返す借入）。計画のタブに v5 の計画の一覧と中身を足す。

**確かめ方（本人）:**
1. 「生活費1か月分」（貯蓄・毎月の積立額つき）と「リボを12月に返す」（返済・期日 12/27・セゾンの借入）を作れる。
2. 貯蓄の計画に余裕額から入れると、その分だけ余裕額が減り、確保額が増える（ホームの余裕額の内訳で見える）。
3. 12月の賞与（予定）からの配分を、購入・貯蓄の計画に入れられる。賞与が予定のあいだは積立額に入らず、「配分の予定」として出る。
4. 計画の一覧で取崩順を並べ替えられ、取崩不可の印を付けられる。
5. 予算の内訳の目安額に、計画の毎月の積立額が入る。

**完成の条件:** 上の5つ。返済の計画には積立額の欄がない（設計書 §3.3）。

**Files:**
- Create: `src/engine/reserve.ts`、`src/engine/reserve.test.ts`
- Modify: `src/engine/slack.ts`（`reserve` の中身）、`src/engine/budget5.ts`（`planMonthly`）、`src/ui/Plans5.tsx`、`src/data/store.ts`（`addPlan5`・`updatePlan5`・`removePlan5`・`addMove`・`removeMove`・`setDrawOrder`）

**Interfaces:**
- Produces:
  - `savedAt(d: Data, p: V5Plan, t: string): Part`（key `plan:<id>`。購入・貯蓄だけ。子：`monthly`（`start_month` から `ym(t)` までの各月1日に `monthly`）・`manual`・`bonus`（ひも付けた賞与の入金が確定していて、その計上日が `t` 以前のもの。段階6の見込みでは計上日が `t` 以前の予定も数える：引数 `projected: boolean`）・`draw`・`spend`。目標額をこえて積まない。`done` の計画は 0）
  - `reserveAt(d: Data, t: string, projected?: boolean): Part`（key `reserve`。購入・貯蓄の計画の `savedAt` の合計）
  - `plannedBonus(d: Data, p: V5Plan): PartRow[]`（予定の賞与にひも付いた配分）
  - `drawPlan(d: Data, need: number, t: string): { plan: V5Plan; amount: number }[]`（取崩順に、取崩不可を除いて `need` まで。足りなければあるだけ）
  - `planMonthlyOf(d: Data, ym: string): number`（その月の購入・貯蓄の毎月の積立額の合計。目標額に届いた計画は0）
- Consumes: `Part`（段階2）、`slackAt`（段階4）。

- [x] **Step 1: 失敗するテストを書く** — `reserve.test.ts`：
  - 貯蓄 目標 30万・毎月 5万・11月から：`savedAt(…, "2026-12-15")` は 10万。2027-05 には 30万で止まり、`planMonthlyOf(…, "2027-05")` は 0。
  - 余裕額から 2万入れると（`manual`）、`slackValue` が 2万減る。
  - 賞与 30万（予定・12/10）に 25万の配分：`savedAt(…, "2026-12-11", false)` は配分を数えない、賞与を確定にすると数える。賞与の額を 28万に直しても配分は 25万のまま。
  - `drawPlan(d, 3万)`：取崩順 [A(積立 2万), B(取崩不可), C(積立 5万)] なら A 2万・C 1万。
  - 購入 目標 6万・積立 6万に、6.5万のクレカ明細をひも付ける（`spend`）：その明細は `budgetView` の使った額に入らず、余裕額は 5千減る。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: `reserve.ts` を書き、`slackAt` の `reserve` と `guideOf` の `planMonthly` をつなぐ。`spend` でひも付けた明細は `budgetView` で数えない**
- [x] **Step 4: テストを流して通るのを見る** → PASS（前の段階のテストも通ったまま）
- [x] **Step 5: `Plans5.tsx` に計画の一覧と中身を書く** — 一覧：計画・種類・目標額・期日・積立額・そろうか（購入・貯蓄）。返済の計画は期日と返す借入だけ（3つの表示は段階6）。中身：毎月の積立額・余裕額から入れる・賞与からの配分（予定の賞与を選ぶ）・取り崩し・取崩順（上下で並べ替え）・取崩不可。
- [ ] **Step 6: 全体の確認** → 通る
- [ ] **Step 7: コミットして push**

---

### 段階6：見通し

**作るもの:** 先の日の口座残高と余裕額の見込み、過去の余裕額。見通しのタブを v5 にする（線グラフ：口座残高と余裕額、これからの入出金）。返済の計画の3つの表示（返す額の見込み・その日の口座残高の見込みと返せるか・返した後の余裕額）。

**確かめ方（本人）:**
1. 見通しのグラフに、口座残高と余裕額の2本の線が出る。今日より先は薄い線。
2. 12月の賞与の日に余裕額の線が上がり、リボを返す日に口座残高だけが下がって、余裕額は変わらない。
3. 計画のタブの「リボを12月に返す」に、返す額の見込み・12/27 の口座残高の見込み（返せるか）・返した後の余裕額が出る。どれもタップで内訳。
4. これからの入出金に、請求見込（点線の枠・見込の印）と借入の返済の見込みが入っている。

**完成の条件:** 上の4つ。設計書 §2.4 の例を、11/1 を今日にして先の日の見込みとして計算しても、表と同じ数字になる。

**Files:**
- Create: `src/engine/outlook.ts`、`src/engine/outlook.test.ts`、`src/ui/Outlook5.tsx`
- Modify: `src/engine/slack.ts`（`t > today` の `bank`）、`src/ui/Plans5.tsx`、`src/ui/App.tsx`

**Interfaces:**
- Produces:
  - `projectedRows(d: Data, today: string, to: string): ForecastRow5[]`（`ForecastRow5 { date; name; amount: number（入金 +・出金 −）; kind: "entry"|"bill"|"loan"|"lump"; virtual: boolean; ref }`。v4 の `accountsWithBills` の請求見込（いつものカードには、その月の予算残額を足す）と、`loanPayments` の行を入れる。予定のまま日付が過ぎた手入力の予定は今日に数える）
  - `bankAt(d, t, today)`：`t > today` は今日の口座残高 ＋ `projectedRows` の `t` までの合計
  - `slackAt` の `t > today`：`bank` は上の `bankAt`、① には「予算どおりに使う」見込みとして、`ym(t)` より前の月（今月以降）の予算残額を、いつものカードのその月の請求に足したものを使う。`reserve` は `projected = true`
  - `outlook(d: Data, today: string, from: string, to: string): { date: string; bank: number; slack: number }[]`（日ごと。過去は記録から計算し直す。設計書 §8）
  - `repayView(d: Data, p: V5Plan, today: string): { due: Part; bankThen: Part; ok: boolean; slackAfter: Part }`
  - `lowest(d, today, to): { date: string; bank: number }`（段階7で使う）
- Consumes: `slackAt`（段階4）、`loanPayments`・`loansAt`（段階3）、`reserveAt`（段階5）。

- [x] **Step 1: 失敗するテストを書く** — `outlook.test.ts`：
  - §2.4 のデータで `today = "2026-11-01"`：`outlook` の 11/4・11/15・11/20・11/26・12/4・12/10・12/15・12/26・12/27 が表の口座残高と余裕額（12/10 からは 35万）になる。
  - 月末 11/30 → 12/1 で余裕額が変わらない（予算どおりに使う前提。Review Focus 1）。
  - 先の月で給与の予定がない月は `salaryEstimate` で数える（Review Focus 4）。
  - `repayView`：期日 12/27・借入 8万 → `due` 8万、`bankThen` 68万、`ok` true、`slackAfter` 35万。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: `outlook.ts` を書き、`slackAt` を `t > today` に広げる**
- [x] **Step 4: テストを流して通るのを見る** → PASS（前のテストも通ったまま）
- [x] **Step 5: `Outlook5.tsx` を書き、見通しのタブを差し替える** — v4 の `Flow.tsx` のグラフ（なぞるとその日の額）と期間の切り替えを引き継ぎ、線を口座残高と余裕額にする。返済の計画の3つの表示を `Plans5.tsx` に足す。
- [ ] **Step 6: 全体の確認** → 通る
- [ ] **Step 7: コミットして push**

---

### 段階7：予定を入れる前の比べ・予算に足す・マイナスのときの確認

**作るもの:** 予定を入れるとき、保存する前に「余裕額 ¥A → ¥B」「その月の予算残額 ¥C → ¥D」「口座残高が一番少なくなる日と額」を出す。予算残額が足りなければ「余裕額から◯月の予算に足しますか？」。余裕額から予算に足す（先の月なら⑤に入る）。余裕額がマイナスになるときの確認（設計書 §3.5）。

**確かめ方（本人）:**
1. 来月の予備に「結婚式 3万」の予定を入れようとすると、保存する前に3つの比べが出る。閉じれば何も変わらない。
2. 来月の予算残額が足りないと「足りない ¥… を余裕額から12月の予算に足しますか？」と出て、「はい」で今日の余裕額がその分減る（内訳の⑤に出る）。
3. 余裕額が 0 以上のとき、操作でマイナスになるなら「◯◯から ¥… を差し引きます。よろしいですか？」と出る。取崩不可の計画からは引かれない。
4. 余裕額がもとからマイナスのときは、確認は出ず注意だけ出る。
5. 使いすぎで余裕額がマイナスになっていると、ホームに「確保額から差し引く」ボタンが出る。

**完成の条件:** 上の5つ。

**Files:**
- Create: `src/engine/whatif.ts`、`src/engine/whatif.test.ts`、`src/ui/Preview.tsx`
- Modify: `src/engine/slack.ts`（⑤ `ahead`）、`src/ui/Home5.tsx`、`src/ui/Sheets.tsx`（予定を入れる板から `Preview` を開く）、`src/data/store.ts`（`decideBudget(month, amount)` で `v5_months` に `source: "decided"`）

**Interfaces:**
- Produces:
  - ⑤ `ahead`：`ym(t)` より先の月で `v5.months` が `decided` のものの `max(0, budget − guideOf(…).amount)` の合計
  - `type Change = { kind: "addAccount"; entry: Omit<AccountEntry, "id"> } | { kind: "addCard"; entry: Omit<CardEntry, "id"> } | { kind: "decideBudget"; month: string; amount: number } | { kind: "addMove"; move: Omit<PlanMove, "id"> }`
  - `applyChange(d: Data, c: Change): Data`（保存せず、Data の写しに当てる）
  - `compare(d: Data, c: Change, today: string): { slack: [number, number]; budget: { month: string; before: number; after: number }; lowest: { date: string; bank: number }; shortBudget: number; draw: { plan: V5Plan; amount: number }[] | null; warnOnly: boolean }`（`shortBudget` はその月の予算残額のマイナスの分。`draw` は「前が 0 以上で後がマイナス」のときだけ、マイナスの分について `drawPlan`。前からマイナスなら `draw: null`・`warnOnly: true`）
- Consumes: `slackValue`（段階4・6）、`budgetView`（段階2）、`drawPlan`（段階5）、`lowest`（段階6）。

- [x] **Step 1: 失敗するテストを書く** — `whatif.test.ts`：
  - 来月の予備に 3万の予定（来月の予算残額 2万）→ `shortBudget` 1万。`decideBudget(来月, 予算 + 1万)` の `compare` で今日の余裕額が 1万減る。
  - 余裕額 5千のとき 1万足す → `draw` が取崩順の計画から 5千、`warnOnly` false。
  - 余裕額 −20万のとき 1万足す → `draw` null、`warnOnly` true。
  - `applyChange` は元の `d` を変えない。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: `whatif.ts` と ⑤ を書く**
- [x] **Step 4: テストを流して通るのを見る** → PASS
- [x] **Step 5: `Preview.tsx` を書き、予定の入力・予算に足す・計画に入れるの各操作の前に出す。ホームに「確保額から差し引く」**
- [ ] **Step 6: 全体の確認** → 通る
- [ ] **Step 7: コミットして push**

---

### 段階8：明細

**作るもの:** 明細のタブを v5 の決まりにする。「クレカ明細｜口座明細」の切り替え（同じ表に混ぜない）、費目ごと／日付ごと、クレカ明細の「リボに回す」と「計画にひも付け」、ATM の引き出しは費目「現金」の出金として入れる。財布の明細は出さない。

**確かめ方（本人）:**
1. 明細の一番上で「クレカ明細｜口座明細」を切り替えられ、混ざって出ない。
2. 11月の家賃のクレカ明細を開いて「リボに回す」と、借入残高が増え、余裕額は変わらない。戻すこともできる。
3. クレカ明細を購入の計画にひも付けると、その明細は予算から外れる。
4. 入力で「ATM で引き出した」を選ぶと、口座の出金・費目「現金」として入る。あとから2行に分けられる。
5. メニューの「口座と財布」に財布の残高が出ない（口座だけ）。

**完成の条件:** 上の4つ。

**Files:**
- Modify: `src/ui/Ledger.tsx`、`src/ui/Sheets.tsx`、`src/data/store.ts`（`toRevolving(cardId, on: boolean)`：`on` なら大費目を `purchase` にする。戻すときの大費目は費目から `groupOfCat` で決める。`splitAccount(id, parts: {category; amount}[])`：1行を費目ごとの行に分ける）
- Test: `src/data/store5.test.ts`（`splitAccount` の合計が元の額と同じでなければ失敗、`toRevolving` で戻すと元の大費目）

- [x] **Step 1: 失敗するテストを書く** — 上の2つ。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: store の2つの関数を書く**
- [x] **Step 4: テストを流して通るのを見る** → PASS
- [x] **Step 5: `Ledger.tsx`・`Sheets.tsx` を直す**
- [ ] **Step 6: 全体の確認** → 通る
- [ ] **Step 7: コミットして push**

---

### 段階9：設定（予算・給与と賞与）

**作るもの:** 設定の「予算」を v5 にする（目安額の内訳、その月の予算の入力（`v5_months` の `decided`）、費目別の予算）。月の初めに、決めていない月は目安額を `source: "guide"` で保存する（設計書 §3.2）。「給与・賞与」で賞与を大費目「賞与」の入金として入れる。

**確かめ方（本人）:**
1. 設定の予算に、目安額の式（給与の見込み − 固定費 − 借入の毎月の返済 − 計画の毎月の積立額）が数字つきで出る。
2. 今月の予算を入れると、ホームの予算残額と余裕額が変わる（目安額より多く入れれば余裕額が減る）。
3. 12月の賞与 30万（予定）を入れると、計画の配分で選べるようになり、見通しの 12/10 に余裕額が上がる。
4. 来月になって初めて開くと、来月の予算が目安額で保存される（設定に「目安額で決めた」と出る）。

**完成の条件:** 上の4つ。

**Files:**
- Modify: `src/ui/Settings.tsx`、`src/data/store.ts`（開いたときに今月の `v5_months` がなければ `guide` で保存）、`src/engine/budget5.ts`（`monthBudget` の `source` に `guide` 保存済みを反映）
- Test: `src/engine/budget5.test.ts` に「`guide` で保存した月は、あとで給与の見込みを変えても予算が動かない」を足す

- [x] **Step 1: 失敗するテストを足す** → FAIL
- [x] **Step 2: 実装して通す** → PASS
- [x] **Step 3: 設定の画面を直す**
- [x] **Step 4: 全体の確認** → 通る
- [x] **Step 5: コミットして push**

---

### 段階10：Claude との相談（v2）

**作るもの:** 書き出しを `gholdengo-snapshot-v2` にする（`summary` に余裕額・予算残額・費目別残額・計画・借入・見通しの内訳を `Part` の形で入れる）。取り込みを `gholdengo-ops-v2` にし、v5 の表（`v5_plans`・`v5_loans`・`v5_loan_balances`・`v5_moves`・`v5_months`）と、操作の名前（予算に足す・リボに回す・配分）を受け付ける。取り込む前の一覧に「余裕額 ¥A → ¥B」を出す。`docs/OPS.md` を書き直す。

**確かめ方（本人）:**
1. 設定 → データ → いまの書き出しをダウンロードで、余裕額の内訳が入った JSON が取れる。
2. `docs/OPS.md` の例の JSON（作り物）を取り込むと、実行する前に変わる内容と「余裕額 ¥A → ¥B」が出る。「実行」を押すまで何も変わらない。
3. v1 の JSON を取り込もうとすると「古い形式です」と出て取り込まない。

**完成の条件:** 上の3つ。

**Files:**
- Modify: `src/data/snapshot.ts`、`src/data/ops.ts`、`src/data/ops.test.ts`、`docs/OPS.md`、`src/ui/Settings.tsx`（取り込みの確認）

**Interfaces:**
- Consumes: `slackAt`・`budgetView`・`reserveAt`・`loansAt`・`outlook`・`repayView`・`compare`（`applyChange` で ops 全体を当てる）。

- [x] **Step 1: 失敗するテストを書く** — `ops.test.ts`：v2 の ops で `v5_moves` を足す・`v5_months` を決める・クレカ明細を `purchase` にする が受け付けられる。v1 の `format` は拒む。書けない列があればファイル全体を拒む（v4 と同じ）。
- [x] **Step 2: テストを流して失敗を見る** → FAIL
- [x] **Step 3: 実装して通す** → PASS
- [x] **Step 4: `docs/OPS.md` を v2 に書き直す（例は作り物）**
- [x] **Step 5: 全体の確認** → 通る
- [ ] **Step 6: コミットして push**

---

### 段階11：切り替え

**作るもの:** v4 からの引き継ぎ（設計書 §7.3）、v4 の計算と画面を消す、仕様書を v5 にする、main に入れる。

**確かめ方（本人）:**
1. 切り替えの前に、計画のタブで「生活費1か月分」「リボを12月に返す」と借入の残高を入れ直してある。
2. プレビューで「v4 から引き継ぐ」を1回押すと、v4 の計画から作った予定の行が消え、確定した行は普通の明細として残る（実行前に一覧が出る）。
3. 全部のタブが v5 になり、v4 の言葉（実質残高・確保額の内訳の予備・たまる額 など）が画面にない。
4. main に入れたあと、本番の URL で同じように見える。

**完成の条件:** 上の4つ。`docs/SPEC.md` が v5 になり、設計書と食い違いがない。

**Files:**
- Modify: `src/data/store.ts`（引き継ぎ：`plan_id` のある口座明細のうち予定のものを消す、確定のものは `plan_id`・`plan_role`・`budget_month` を空にする。実行前に件数と一覧を出す）、`src/ui/App.tsx`（v5 の画面だけにする）
- Delete: v4 だけが使う `src/engine/plans.ts`・`src/ui/PlansView.tsx`・`src/ui/Plans.tsx`・`src/ui/Flow.tsx`・`src/ui/Dashboard.tsx`、`compute.ts` のうち v5 で使っていない関数（`goalSchedule`・`monthBase`・`nextPayments`・`normalizeBills`・`duplicateInstallments` など。消す前に `grep` で使っていないことを確かめる）と、それらのテスト
- Modify: `docs/SPEC.md`（v5 として書き直す。設計書の中身を仕様の形にする）、`README.md`、`CLAUDE.md`（「仕様は docs/SPEC.md」のまま。v5 の表を書き足す）
- Test: `src/data/store5.test.ts` に引き継ぎのテスト（予定の行は消す・確定の行はつながりだけ外す）

- [x] **Step 1: 引き継ぎの失敗するテストを書く** → FAIL
- [x] **Step 2: 引き継ぎを実装して通す** → PASS
- [x] **Step 3: v4 の画面と使っていない計算を消し、`npm run typecheck && npm test && npm run build` が通るまで直す**
- [x] **Step 4: `docs/SPEC.md`・`README.md`・`CLAUDE.md` を書き直す**
- [x] **Step 5: 全体の確認** → 通る。画面の文字に v4 の言葉が残っていないか `grep -rn "実質残高\|たまる額\|使う額\|確保額の内訳" src/ui` で確かめる
- [ ] **Step 6: コミットして push。本人の確認のあと、PR を作って main に入れる（PR は本人が頼んだときだけ）**
