# Gholdengo 家計簿

前の家計簿アーティファクトを置き換える、家計簿の Web アプリ（PWA）。
「予算残額」（今月あといくら使えるか）と「余裕額」（使い道の決まっていないお金がいくらあるか）の2つを主役にした家計簿（v5）。給与から固定費・借入の毎月の返済・貯蓄の積立を引いた目安額から月の予算を決め、口座明細とクレカ明細でお金の動きを管理する。見通し（線グラフ）と、返済計画・貯蓄計画で先の動きを見る。どの数字もタップで内訳がたどれる。三井住友カードの通知メールは GAS で自動で取り込む。

- 仕様：[docs/SPEC.md](docs/SPEC.md)（設計の理由：[docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md](docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md)）
- Claude との相談の取り込み：[docs/OPS.md](docs/OPS.md)
- 計算エンジン：`src/engine/`（画面と分けた関数。`npm test` でテスト）
- 画面：`src/ui/`
- DB：`supabase/migrations/`（v3 の表は `0004_v3_tables.sql`：口座明細 `account_entries`・クレカ明細 `card_entries`。v5 の計画・借入・月の予算は `0008_v5.sql`：`v5_plans`・`v5_loans`・`v5_loan_balances`・`v5_moves`・`v5_months`）
- メールの取り込み：`gas/Code.gs`

```
Gmail ──(15分ごと)── GAS ──→ Supabase ←──→ Webアプリ（Vercel・PWA）
```

## はじめの準備（1回だけ・15分くらい）

### 1. Supabase（データの置き場所）

Supabase はプロジェクト **porygon-works** に複数のアプリの DB をまとめている。新しいプロジェクトは作らず、この家計簿の表は **`ggmg` スキーマ** に置く。

1. <https://supabase.com> で **porygon-works** プロジェクトを開く。
2. 左の **SQL Editor** を開き、`supabase/migrations/` のファイルを番号の順に（`0001_init.sql` → `0002_recurring_shop.sql` → `0003_cards.sql` → `0004_v3_tables.sql` → `0005_deleted_every.sql` → `0006_snapshots.sql` → `0007_plans_months.sql` → `0008_v5.sql`）全部貼って **Run**（`ggmg` スキーマと表ができる。何度実行しても壊れない）。
3. **Project Settings → Data API → Exposed schemas** に **`ggmg`** を足して **Save**（これをしないとアプリと GAS から表が見えない）。
4. **Authentication → Users → Add user → Create new user** で、自分のメールとパスワードを入れて作る（Auto Confirm User にチェック。ほかのアプリで作ったユーザーがあればそれを使ってよい）。
5. **Authentication → Sign In / Providers** で **Allow new users to sign up をオフ** にする（自分以外がユーザーを作れないように。ほかのアプリで新規登録を使っているなら、そちらに合わせる）。
6. 次の4つを控える。
   - **Project URL**（Project Settings → Data API）
   - **anon / publishable キー**（Project Settings → API Keys）… アプリに入れる。公開してよいキー（RLS で守られる）
   - **service_role / secret キー**（同じ画面）… GAS だけに入れる。**ほかには絶対に置かない**
   - 自分のユーザーの **UID**（Authentication → Users）… GAS に入れる

### 2. Vercel（アプリの公開）

1. <https://vercel.com> に GitHub でログインし、**Add New → Project** で `porygon-works/Gholdengo-Management` を Import。
2. Framework は Vite（自動で選ばれる）。**Environment Variables** に次の2つを入れて **Deploy**。
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon / publishable キー
3. 本番は `main` ブランチ。ほかのブランチは push するたびにプレビュー URL ができる。
4. iPhone の Safari で URL を開き、共有ボタン → **ホーム画面に追加**。開いて、1-4 で作ったメールとパスワードでログイン。

環境変数を入れずに開くと「お試しモード」（データはその端末のブラウザの中だけ）で動く。

### 3. 今のデータを移す

1. アプリの **設定 → データ → 移行用の JSON を取り込む** で、移行用のファイル（`gholdengo-import.json`）を選ぶ。2回取り込んでも二重にはならない。
2. メニュー → **口座と財布** で、今の口座と財布の残高を入れる。

移行用のファイルは家計のデータそのものなので、リポジトリには入れない（このリポジトリは公開されている）。

### 4. GAS（カードのメールの取り込み）

1. <https://script.google.com> で **新しいプロジェクト** を作る（Gmail と同じ Google アカウントで）。
2. `コード.gs` の中身を消して、`gas/Code.gs` の中身を貼る。
3. **プロジェクトの設定（歯車）→ スクリプト プロパティ** に次の4つを追加。
   | プロパティ | 値 |
   | --- | --- |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_SERVICE_KEY` | service_role / secret キー |
   | `OWNER_USER_ID` | 自分のユーザーの UID |
   | `SINCE` | `2026/10/20`（これより前のメールは読まない。移行したデータと重ねないため） |
4. エディタで関数 **backfill** を選んで **実行**。初回は Gmail を読む許可を求められるので許可する（「このアプリは確認されていません」→ 詳細 → 安全ではないページに移動、で進む。自分で作ったスクリプトなので問題ない）。
5. 関数 **setup** を選んで **実行**。15分ごとに動くトリガーができる。
6. 実行ログに「読んだスレッド … 明細 …」と出れば OK。アプリを開くと明細が入っている。

## v2 から v3 にするとき（1回だけ）

1. Supabase の SQL Editor で `supabase/migrations/0004_v3_tables.sql` を貼って **Run**。
2. アプリを開く（新しい版になったら）。前の版の明細・請求額・借金・毎月の貯金が、口座明細・クレカ明細・目標マスタへ自動で写る。
3. GAS のエディタで `コード.gs` を、新しい `gas/Code.gs` の中身に貼り替えて保存（トリガーはそのままでよい）。貼り替えるまでは前の表に書くが、アプリが開いたときに写すので消えない。
4. メニュー → **口座と財布** で、口座と財布の本当の残高を入れて直す。

## v3 から v4 にするとき（1回だけ）

1. Supabase の SQL Editor で `supabase/migrations/0007_plans_months.sql` を貼って **Run**（計画・月の予算の表と、口座明細の計画の列ができる）。
2. アプリを開く。動いている目標マスタ（返済・積立）が、計画へ自動で写る（臨時の返済の日が同じ返済の目標は1つの計画にまとまる）。
3. **計画** の画面で、残高（カードのサイトで見た額）・毎月の支払い・まとめて返す日・賞与から入れる額を確かめて直す。
4. 設定 → **予算** で、その月の予算を決める（空なら目安のまま）。

## v4 から v5 にするとき（1回だけ）

1. Supabase の SQL Editor で `supabase/migrations/0008_v5.sql` を貼って **Run**（v5 の計画・借入・月の予算の表と、クレカ明細の `revolved_at` ができる。何度実行しても壊れない）。
2. **計画** の画面で、返済計画（返済先と借入残高）と貯蓄計画を入れる。Claude と相談して作った `gholdengo-ops-v2` の JSON を、設定 → データから取り込んでもよい。
3. 設定 → **データ** の「v4 から引き継ぎ」で一覧を確かめて **引き継ぎ実行**（v4 の計画の予定の行と、前の版の「給与の調整」「追加予算の調整」の行を消し、v4 の計画の確定した行は普通の明細として残す）。
4. 設定 → **予算** で、その月の予算を確かめる（決めていなければ月の初めの目安額になる）。

## Claude が読めるようにする（Google ドライブ）

形式は [docs/OPS.md](docs/OPS.md)。

1. Supabase の SQL Editor で `supabase/migrations/0006_snapshots.sql` を貼って **Run**。
2. GAS の `コード.gs` を新しい `gas/Code.gs` に貼り替えて保存。
3. 関数 **setup** を選んで **実行**。Google ドライブを使う許可を求められるので許可する（15分ごとの取り込みと、1時間ごとのドライブへの書き出しのトリガーができる）。
4. アプリを一度開く（開くたびに書き出しを保存する）。数分後、Google ドライブに「Gholdengo/gholdengo-snapshot.json」ができる。
5. Claude で Google ドライブをつなぐと、いつでも読める。Claude が作った変更（gholdengo-ops-v2）は、アプリの「設定 → データ → Claude 相談の取込」で中身を確かめてから実行する。

## 開発

```sh
npm install
npm run dev        # http://localhost:5173 （.env.local がなければお試しモード）
npm test           # 計算エンジンと GAS のメール読み取りのテスト
npm run build
```

`.env.local` の例：

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```
