# Gholdengo 家計簿

前の家計簿アーティファクトを置き換える、家計簿の Web アプリ（PWA）。
給与から固定費と目標用マイナス（リボの返済・積立）を引いた「今月の予算」を出し、口座明細とクレカ明細でお金の動きを管理する。三井住友カードの通知メールは GAS で自動で取り込む。

- 仕様：[docs/SPEC.md](docs/SPEC.md)
- 計算エンジン：`src/engine/`（画面と分けた関数。`npm test` でテスト）
- 画面：`src/ui/`
- DB：`supabase/migrations/`（v3 の表は `0004_v3_tables.sql`：口座明細 `account_entries`・クレカ明細 `card_entries`・目標マスタ `goals`）
- メールの取り込み：`gas/Code.gs`

```
Gmail ──(15分ごと)── GAS ──→ Supabase ←──→ Webアプリ（Vercel・PWA）
```

## はじめの準備（1回だけ・15分くらい）

### 1. Supabase（データの置き場所）

Supabase はプロジェクト **porygon-works** に複数のアプリの DB をまとめている。新しいプロジェクトは作らず、この家計簿の表は **`ggmg` スキーマ** に置く。

1. <https://supabase.com> で **porygon-works** プロジェクトを開く。
2. 左の **SQL Editor** を開き、`supabase/migrations/` のファイルを番号の順に（`0001_init.sql` → `0002_recurring_shop.sql` → `0003_cards.sql` → `0004_v3_tables.sql` …）全部貼って **Run**（`ggmg` スキーマと表ができる。何度実行しても壊れない）。
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
4. 設定 → **目標** で、返済の目標（毎月の額・臨時の返済）と積立の目標を確かめる。
5. メニュー → **口座と財布** で、口座と財布の本当の残高を入れて直す。

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
