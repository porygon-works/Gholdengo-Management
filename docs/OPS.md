# Claude とのやりとりの形式（v2）

Claude が家計簿のデータを読み、相談して決めた内容を家計簿に戻すための形式。考え方は [設計書](superpowers/specs/2026-10-23-v5-yoyuugaku-design.md)（v5・余裕額）。
例の値はすべて作り物（このリポジトリは公開されている）。

```
アプリ ──(開くたび)──→ Supabase の snapshots ──(GAS・1時間ごと)──→ Google ドライブ「Gholdengo/gholdengo-snapshot.json」──→ Claude が読む
Claude が gholdengo-ops-v2 の JSON を作る ──→ アプリ「設定 → データ → Claude との相談を取り込む」で中身と余裕額の変わり方を確かめて実行
```

v1（`gholdengo-snapshot-v1`・`gholdengo-ops-v1`）は使わない。v1 の JSON は取り込まない。

## 読む：gholdengo-snapshot-v2

Google ドライブの `Gholdengo/gholdengo-snapshot.json`。アプリの「設定 → データ → いまの書き出しをダウンロード」でも同じものが取れる。

| 項目 | 中身 |
| --- | --- |
| `summary` | アプリが計算したまとめ。**数を答えるときはこれを使う**（自分で計算し直さない） |
| `summary.slack` | 今日の余裕額と内訳。`parts` はアプリでタップすると出る式と同じ（口座残高 ＋ 未入金給与 ＋ 未回収立替 − 支払予定額 − 確保額）。確保額は使う日のある貯蓄計画（buy）の積立額だけで、使う日のない貯蓄計画（save）は余裕額に入ったまま。説明するときはこの名前と数字を使う |
| `summary.thisMonth`・`nextMonth` | その月の予算（`budget`・`budgetSource`：決めた額 `decided`／月の初めの目安額 `guide`／いまの目安額 `live`）・目安額の内訳（`guide`）・予算残額の内訳（`budgetLeft`）・費目ごと（`categories`） |
| `summary.loans` | 借入ごとの借入残高の内訳（記録した残高 ＋ リボに回した分 − 返した分）・毎月の返済額・借入残高の修正 |
| `summary.plans` | 計画ごと。購入・貯蓄は積立額の内訳（`saved`）と配分の予定（`plannedBonus`）。返済は期日の返す額の見込み（`repay.due`）・その日の口座残高の見込み（`bankThen`）・返せるか（`ok`）・返した後の余裕額（`slackAfter`） |
| `summary.outlook` | 日ごとの口座残高と余裕額（今日から6か月先。週に1回と月末）。先は見込み（予算どおりに使う前提） |
| `settings`・`budgets`・`v5_months`・`v5_plans`・`v5_loans`・`v5_loan_balances`・`v5_moves`・`recurring`・`rules`・`balances` | 設定とマスタ（ops の key に使う名前・id が分かる） |
| `account_entries`・`card_entries` | 口座明細・クレカ明細（直近1年。消したもの・財布の明細は入らない） |
| `appSavedAt` | アプリが最後に保存した時刻。`summary` はこの時点の計算 |
| `gasExportedAt`・`latestCardEntries` | GAS が書き出した時刻と、その時点のクレカ明細（直近45日） |

## 戻す：gholdengo-ops-v2

例は、計画「サンプルの貯蓄」と借入「サンプルのリボ」がもうあるとき。

```json
{
  "format": "gholdengo-ops-v2",
  "note": "12月の予算とリボの返し方を相談して決めた",
  "ops": [
    { "op": "set", "table": "budgets", "key": { "month": "2026-12", "category": "食料品" }, "data": { "amount": 18000 } },
    { "op": "set", "table": "v5_months", "key": { "month": "2026-12" }, "data": { "budget": 85000 } },
    { "op": "set", "table": "v5_plans", "key": { "name": "サンプルの貯蓄" }, "data": { "kind": "save", "target": 60000, "monthly": 10000, "start_month": "2026-12" } },
    { "op": "set", "table": "v5_moves", "key": { "ref": "claude:save-1" }, "data": { "plan": "サンプルの貯蓄", "kind": "manual", "amount": 5000, "date": "2026-11-20" } },
    { "op": "set", "table": "v5_loan_balances", "data": { "loan": "サンプルのリボ", "date": "2026-11-20", "balance": 120000 } },
    { "op": "set", "table": "card_entries", "key": { "ref": "claude:rent-to-revolving" }, "data": { "card": "saison", "date": "2026-11-01", "amount": 50000, "group": "purchase", "category": "家賃" } },
    { "op": "set", "table": "account_entries", "key": { "ref": "claude:2026-12-bonus" }, "data": { "direction": "in", "group": "bonus", "name": "賞与", "date": "2026-12-10", "amount": 100000, "status": "plan" } }
  ]
}
```

- `op`：`set`（あれば直す・なければ足す）か `delete`（消す）。
- `data` に書いた項目だけ変わる（書かない項目はそのまま）。書けない項目があると、ファイル全体を取り込まない。
- アプリは取り込む前に、変わる内容（足す・直す・消す）の一覧と、**余裕額がいくらからいくらになるか**を見せる。本人が「実行」を押したときだけ書く。
- 同じファイルの中で足した行を、あとの行で使うことはできない（足した計画にお金を入れる・足した賞与に配分する など）。先に足す分だけのファイルを取り込んでから、次のファイルを取り込む。賞与からの配分は `{ "kind": "bonus", "bonus_ref": "<賞与の ref か id>", … }`。

### 表ごとの key と書ける項目

| table | key | 書ける項目（data） | 足すときに要る項目 |
| --- | --- | --- | --- |
| `budgets` | `month`（YYYY-MM）＋ `category` | `amount` | `amount` |
| `v5_months` | `month` | `budget`（null で目安額に戻す。目安額より多い分は余裕額から出す） | `budget` |
| `v5_plans` | `name` か `id` | `kind`（repay／buy／save）・`name`・`target`・`due_date`・`monthly`・`start_month`・`draw_order`・`no_draw`（どちらも今は使わない）・`done`・`sort` | `kind` |
| `v5_loans` | `name` か `id` | `name`・`card`（カードの請求と一緒に返すならカードの id）・`monthly`・`pay_day`・`plan`（期日にまとめて返す返済の計画の名前） | ― |
| `v5_loan_balances` | なし（足すだけ） | `loan`（借入の名前）・`date`・`balance`（カードのサイトで見た額。前の記録との差は「借入残高の修正」になる） | 全部 |
| `v5_moves` | 足すとき `ref`（見出し用）、消すとき `id` | `plan`（購入・貯蓄の計画の名前）・`kind`（manual：余裕額から入れる／bonus：賞与からの配分／draw：取り崩す）・`amount`・`date`・`bonus_ref`（bonus のとき、賞与の口座明細の ref か id）・`memo` | `plan`・`kind`・`amount`・`date` |
| `recurring` | `name` か `id` | `kind`（expense／income）・`group`・`category`・`amount`・`day`・`shift`・`pay`（bank／card）・`card`・`shop`・`every`（1・2・3・6・12）・`start_month`・`end_month`・`active` | `kind`・`amount`・`day` |
| `rules` | `pattern` か `id` | `category` | `category` |
| `account_entries` | `ref` か `id` | `direction`（in／out）・`status`（plan／confirmed）・`group`・`category`・`name`・`memo`・`date`・`amount` | `date`・`amount`・`direction`・`group` |
| `card_entries` | `ref` か `id` | `card`・`status`・`date`・`amount`・`group`・`category`・`name`・`shop`・`memo`・`tatekae` | `date`・`amount` |
| `balances` | （消すときだけ `id`） | `date`・`bank`・`memo` | `date`・`bank` |
| `settings` | なし | `safety`・`payday`・`salaryEstimate`・`varCats`・`fixCats`・`dailyCats`・`cards`・`labels` | — |

- **リボに回す**：そのクレカ明細の `group` を `purchase` にする（その月の請求から外れ、そのカードの借入残高に足される。予算にはその費目で数える）。戻すときは費目の大費目（`variable`・`fixed`）にする。
- **余裕額から予算に足す**：`v5_months` でその月の予算を目安額より多く決める。先の月でも、足した時点で今日の余裕額から引かれる。
- 明細を Claude から足すときは、`ref` に `claude:` で始まる、ほかと重ならない名前をつける。あとで同じ `ref` で直す・消すができる。`status` を書かなければ予定になる。
- 明細の `group`（大費目）を書かず `category` を書けば、費目から変動費か固定費かを決める。
- 大費目の id：口座明細の出金は `variable`・`fixed`・`tatekae`・`other`（`card` はクレカの請求なので Claude からは使わない）、入金は `salary`・`extra`・`refund`・`bonus`（賞与）・`other`。クレカ明細は `variable`・`fixed`・`tatekae`・`purchase`（リボに回した明細）。`installment` は前の版の名残で、計算に入れない。
- 財布は管理しない。ATM で引き出した額は、口座の出金・費目「現金」として入れる。
- 定期を直すと、その定期から作った今月以降の予定は作り直される（画面から直したときと同じ）。
