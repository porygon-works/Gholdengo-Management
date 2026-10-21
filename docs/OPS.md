# Claude とのやりとりの形式

Claude が家計簿のデータを読み、相談して決めた内容を家計簿に戻すための形式。仕様は [SPEC.md](SPEC.md)。
例の値はすべて作り物（このリポジトリは公開されている）。

```
アプリ ──(開くたび)──→ Supabase の snapshots ──(GAS・1時間ごと)──→ Google ドライブ「Gholdengo/gholdengo-snapshot.json」──→ Claude が読む
Claude が gholdengo-ops-v1 の JSON を作る ──→ アプリ「設定 → データ → Claude との相談を取り込む」で中身を確かめて実行
```

## 読む：gholdengo-snapshot-v1

Google ドライブの `Gholdengo/gholdengo-snapshot.json`。アプリの「設定 → データ → いまの書き出しをダウンロード」でも同じものが取れる。

| 項目 | 中身 |
| --- | --- |
| `summary` | アプリが計算したまとめ。**数を答えるときはこれを使う**（自分で計算し直さない） |
| `summary.thisMonth` | 今月の予算（`budget`）・残り予算（`remaining`）・予算の元（`base`：給与・追加予算・固定費・目標用マイナス）・費目ごと（`categories`：予算・使った・予定・残り） |
| `summary.account` | いまの口座残高（`bankNow`）・財布（`walletNow`）・次の給料日（`nextPayday`）・給料日の前日に残る額（`leftBeforePayday`）・それまでの口座の動き（`flow`） |
| `summary.nextMonthPayments` | 来月に口座から出るお金（大費目ごと・明細つき） |
| `summary.nextMonthBudget` | 来月の予算と予算の元 |
| `summary.goals` | 目標ごとの、いまの残高（見込み）・毎月の額・0になる月／届く月・先の予定 |
| `settings`・`budgets`・`goals`・`recurring`・`rules`・`balances` | 設定とマスタ（ops の key に使う名前・id が分かる） |
| `account_entries`・`card_entries` | 口座明細・クレカ明細（直近1年。消したものは入らない） |
| `appSavedAt` | アプリが最後に保存した時刻。`summary` はこの時点の計算 |
| `gasExportedAt`・`latestCardEntries` | GAS が書き出した時刻と、その時点のクレカ明細（直近45日）。アプリを開いていなくても、メールから入った明細はここで分かる |

## 戻す：gholdengo-ops-v1

```json
{
  "format": "gholdengo-ops-v1",
  "note": "12月の予算とリボの返し方を相談して決めた",
  "ops": [
    { "op": "set", "table": "budgets", "key": { "month": "2026-12", "category": "食料品" }, "data": { "amount": 18000 } },
    { "op": "set", "table": "budgets", "key": { "month": "2026-12", "category": "#目標用マイナス" }, "data": { "amount": 30000 } },
    { "op": "set", "table": "goals", "key": { "name": "サンプルのリボ" }, "data": { "monthly": 12000, "lumps": [{ "date": "2026-12-15", "amount": 0, "memo": "賞与から全額" }] } },
    { "op": "set", "table": "recurring", "key": { "name": "年払いのサービス" }, "data": { "kind": "expense", "group": "fixed", "category": "サブスク", "amount": 2400, "day": 10, "pay": "card", "every": 12, "start_month": "2026-12" } },
    { "op": "delete", "table": "recurring", "key": { "name": "やめたサブスク" } },
    { "op": "set", "table": "account_entries", "key": { "ref": "claude:2026-12-bonus" }, "data": { "direction": "in", "group": "other", "name": "賞与", "date": "2026-12-10", "amount": 100000, "status": "plan" } },
    { "op": "set", "table": "settings", "data": { "safety": 10000 } }
  ]
}
```

- `op`：`set`（あれば直す・なければ足す）か `delete`（消す）。
- `data` に書いた項目だけ変わる（書かない項目はそのまま）。書けない項目があると、ファイル全体を取り込まない。
- アプリは取り込む前に、変わる内容（足す・直す・消す）を一覧で見せる。本人が「実行」を押したときだけ書く。

### 表ごとの key と書ける項目

| table | key | 書ける項目（data） | 足すときに要る項目 |
| --- | --- | --- | --- |
| `budgets` | `month`（YYYY-MM）＋ `category` | `amount` | `amount` |
| `goals` | `name` か `id` | `kind`（repay／save）・`card`・`balance`・`as_of`・`target`・`monthly`・`day`・`start_month`・`end_month`・`lumps`・`active`・`sort` | `kind` |
| `recurring` | `name` か `id` | `kind`（expense／income）・`group`・`category`・`amount`・`day`・`shift`・`pay`（bank／wallet／card）・`card`・`shop`・`every`（1・2・3・6・12）・`start_month`・`end_month`・`active` | `kind`・`amount`・`day` |
| `rules` | `pattern` か `id` | `category` | `category` |
| `account_entries` | `ref` か `id` | `account`（bank／wallet）・`direction`（in／out）・`status`（plan／confirmed）・`group`・`category`・`name`・`memo`・`date`・`amount` | `date`・`amount`・`direction`・`group` |
| `card_entries` | `ref` か `id` | `card`・`status`・`date`・`amount`・`group`・`category`・`name`・`shop`・`memo`・`tatekae` | `date`・`amount` |
| `balances` | （消すときだけ `id`） | `date`・`bank`・`cash`・`memo` | `date`・`bank` |
| `settings` | なし | `safety`・`payday`・`salaryEstimate`・`varCats`・`fixCats`・`dailyCats`・`cards`・`labels` | — |

- `budgets` の `category` に `#目標用マイナス` を入れると、その月の目標用マイナスを手で直した値になる（消すと目標マスタから出す値に戻る）。
- 明細を Claude から足すときは、`ref` に `claude:` で始まる、ほかと重ならない名前をつける。あとで同じ `ref` で直す・消すができる。`status` を書かなければ予定になる。
- 明細の `group`（大費目）を書かず `category` を書けば、費目から変動費か固定費かを決める。
- 大費目の id：口座明細の出金は `variable`・`fixed`・`tatekae`・`other`（`card` はクレカの請求なので Claude からは使わない）、入金は `salary`・`extra`・`refund`・`other`。クレカ明細は `variable`・`fixed`・`tatekae`・`installment`（分割の返済）・`purchase`（分割で買った物）。
- 目標・定期を直すと、その目標・定期から作った今月以降の予定は作り直される（画面から直したときと同じ）。
