import { useState } from "react";
import { ACCOUNT_GROUP_LABEL, accountFlow, addDays, addMonths, budgetCats, computeMonth, groupOfCat, nextPayments, PAY_GROUP_LABEL, RESERVE, ymOf, type AccountEntry, type PayGroup } from "../engine";
import type { Open } from "./Sheets";
import { actions, type AppData, type Store } from "../data/store";
import { accountTitle, Bar, cardOfPay, Chip, Field, md, money, NumInput, payLabels, payOptions, Select, Sheet, Spent, toast, yen, ymLabel, type Pay } from "./common";

interface Props {
  store: Store;
  data: AppData;
  month: string;
  today: string;
  reviews: number;
  go: (to: "ledger" | "review" | "passbook" | "balance" | "settings", cat?: string) => void;
  open: (e: AccountEntry) => void;
  onOpen: (o: Open) => void;
}

/** 使ったものを入れる。クレカはクレカ明細、現金は財布、PayPay・口座は口座の口座明細 */
function QuickForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const s = data.settings;
  const cats = budgetCats(s).filter((c) => c !== RESERVE);
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const [pay, setPay] = useState<Pay>(payOptions(s)[0]);
  const [more, setMore] = useState(false);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!amount) { toast("金額を入れてください"); return; }
    setBusy(true);
    const card = cardOfPay(pay);
    const group = groupOfCat(s, cat);
    const ok = await store.run(() => card
      ? actions.addCard({ card, status: "confirmed", date, amount, group, category: cat, name, shop })
      : actions.addAccount({ account: pay === "wallet" ? "wallet" : "bank", direction: "out", status: "confirmed", group, category: cat, name: name || (pay === "paypay" ? "PayPayチャージ" : shop), date, amount }));
    setBusy(false);
    if (ok) {
      toast(card === s.cards[0].id ? `${cat} ${yen(amount)}円を入れました。カードのメールが来たら自動でまとめます` : `${cat} ${yen(amount)}円を入れました`);
      setAmount(""); setName(""); setShop(""); setDate(today); setMore(false);
    }
  };

  return (
    <div className="panel quick">
      <div className="grid2">
        <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <div className="seg" role="group" aria-label="払い方">
        {payOptions(s).map((k) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{payLabels(s)[k]}</button>)}
      </div>
      {more && (
        <>
          <div className="grid2">
            <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="店"><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>
          </div>
          <Field label="名称（買ったもの）"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </>
      )}
      <div className="btns">
        <button className="btn" onClick={add} disabled={busy}>入れる</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>日付・店も入れる</button>}
      </div>
    </div>
  );
}

type Row = ReturnType<typeof computeMonth>["cats"][number];



/** 表の合計の行 */
function total(rs: Row[], daily: boolean, fixed = false) {
  const sum = (f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0);
  const rem = sum((r) => r.rem);
  return (
    <tr className="sum">
      <td>合計</td>
      <td className="num">{money(sum((r) => r.budget))}</td>
      <td className="num"><Spent used={sum((r) => r.used)} planned={sum((r) => r.planned)} /></td>
      <td className={`num ${rem < 0 ? "neg" : ""}`}>{fixed ? money(sum((r) => Math.max(0, r.budget - r.used))) : money(rem)}</td>
      {daily && <td />}
    </tr>
  );
}

/** 口座の今後の動き（§5.5）：いまの口座残高と、給料日の前日までの口座明細。合計の行が給料日の前日に残る額 */
function AccountFlow({ data, today, go, open }: { data: AppData; today: string; go: Props["go"]; open: Props["open"] }) {
  const f = accountFlow(data, today);
  if (!f) return <button className="panel" onClick={() => go("balance")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", width: "100%" }}><div className="note">口座の残高を入れると、給料日の前日までの口座の動きと、残る額を出します。タップで入れる</div></button>;
  const pd = addDays(f.end, -1);
  const neg = (n: number) => `num ${n < 0 ? "neg" : ""}`;
  return (
    <>
      <div className="cards">
        <button className="kpi" onClick={() => go("balance")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
          <div className="lb">口座残高（いま）</div>
          <div className="v num">{money(f.now.bank)}</div>
          <div className="note">財布 {money(f.now.wallet)}・タップで直す</div>
        </button>
        <div className={`kpi ${f.short ? "bad" : "main"}`}>
          <div className="lb">給料日の前日（{md(pd)}）に残る額</div>
          <div className="v num">{money(f.last)}</div>
          <div className="note" style={{ color: "inherit", opacity: .85 }}>{f.short ? `${yen(f.short)}円 足りません。先に入金が必要です` : `次の給料日 ${md(f.end)}`}</div>
        </div>
      </div>
      <div className="panel scroll">
        <table className="tbl">
          <thead><tr><th>日</th><th style={{ textAlign: "left" }}>内容</th><th>入出金</th><th>残高</th></tr></thead>
          <tbody>
            <tr><td className="num">{md(today)}</td><td style={{ textAlign: "left" }}>口座残高（いま）</td><td /><td className="num">{money(f.now.bank)}</td></tr>
            {f.rows.map((r) => (
              <tr key={r.entry.id} className="tap" onClick={() => open(r.entry)}>
                <td className="num">{md(r.date)}</td>
                <td style={{ textAlign: "left" }}>{accountTitle(r.entry)} {r.entry.group === "card" ? <Chip kind={r.entry.locked ? "ok" : "warn"}>{r.entry.locked ? "確定" : "見込み"}</Chip> : r.entry.status === "plan" ? <Chip kind="warn">{r.overdue ? "日付が過ぎた予定" : "予定"}</Chip> : null}</td>
                <td className={`num ${r.delta < 0 ? "neg" : ""}`}>{r.delta > 0 ? "＋" : "−"}{money(Math.abs(r.delta))}</td>
                <td className={neg(r.balance)}>{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="num">{md(pd)}</td><td style={{ textAlign: "left" }}>給料日の前日に残る額</td><td className="num">{money(f.last - f.now.bank)}</td><td className={neg(f.last)}>{money(f.last)}</td></tr></tfoot>
        </table>
        <div className="note">口座明細（口座）の、明日から給料日の前日までの動きです。カードで使った分は、引落日に「クレカ支払い」で減ります。各行をタップすると詳細を見て直せます。</div>
      </div>
    </>
  );
}

/** 来月の支払い予定（§5.6）：来月に口座から出るお金を大費目ごとに。タップでその大費目の明細を子画面で開く */
function NextMonth({ data, month, onOpen }: { data: AppData; month: string; onOpen: (o: Open) => void }) {
  const n = nextPayments(data, addMonths(month, 1));
  const [open, setOpen] = useState<PayGroup | null>(null);
  const g = n.groups.find((x) => x.group === open);
  const cur = +month.slice(5);
  return (
    <section>
      <h2>来月の支払い予定 <small>{ymLabel(n.ym)}に口座から出るお金・タップで明細</small></h2>
      <div className="panel scroll">
        {n.groups.length ? (
          <table className="tbl">
            <thead><tr><th style={{ textAlign: "left" }}>大費目</th><th>件数</th><th>金額</th></tr></thead>
            <tbody>
              {n.groups.map((x) => (
                <tr key={x.group} className="tap" onClick={() => setOpen(x.group)}>
                  <td style={{ textAlign: "left" }}>{PAY_GROUP_LABEL[x.group]}</td>
                  <td className="num">{x.items.length}件</td>
                  <td className="num">{money(x.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td style={{ textAlign: "left" }}>計</td><td /><td className="num">{money(n.total)}</td></tr></tfoot>
          </table>
        ) : <div className="note">来月に口座から出るお金の予定はまだありません</div>}
        <div className="note">クレカの分は、{cur}月にカードで使ったもの（予定を含む）。これからカードで使うと増えます。</div>
      </div>
      {g && (
        <Sheet title={`${PAY_GROUP_LABEL[g.group]}（${ymLabel(n.ym)}に口座から出る）`} onClose={() => setOpen(null)}>
          <table className="tbl">
            <thead><tr><th style={{ textAlign: "left" }}>内容</th><th>金額</th></tr></thead>
            <tbody>
              {g.items.map((x, i) => (
                <tr key={i} className={x.card || x.account ? "tap" : ""} onClick={() => { setOpen(null); if (x.card) onOpen({ type: "card", entry: x.card }); else if (x.account) onOpen({ type: "account", entry: x.account }); }}>
                  <td style={{ textAlign: "left" }}>{x.name} {x.plan && <Chip kind="warn">予定</Chip>}<div className="note">{md(x.date)}・{x.from}</div></td>
                  <td className="num">{money(x.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td style={{ textAlign: "left" }}>計 {g.items.length}件</td><td className="num">{money(g.amount)}</td></tr></tfoot>
          </table>
          <div className="note">日付は口座から出る日（クレカは引落日）です。タップすると明細を開いて直せます。</div>
          <div className="btns"><button className="btn ghost" onClick={() => setOpen(null)}>閉じる</button></div>
        </Sheet>
      )}
    </section>
  );
}

export function Dashboard({ store, data, month, today, reviews, go, open, onOpen }: Props) {
  const v = computeMonth(data, month, today);
  const b = v.base;
  const rows = v.cats.filter((c) => c.budget || c.used || c.planned);
  const label = v.when === "past" ? "この月の予算" : v.when === "future" ? `${+month.slice(5)}月の予算` : "今月の予算";
  const current = month === ymOf(today);

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}

      <section>
        <div className="cards">
          <div className="kpi">
            <div className="lb">{label}</div>
            <div className="v num">{money(v.T)}</div>
            <div className="note">変動費 {money(v.U + v.P)}{v.P ? `（${yen(v.P)}）` : ""}{v.P ? "・（）内は予定" : ""}</div>
          </div>
          <div className={`kpi ${v.R < 0 ? "bad" : "main"}`}>
            <div className="lb">残り予算</div>
            <div className="v num">{money(v.R)}</div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>{v.R < 0 ? "予算をこえています" : v.daysLeft ? `残り${v.daysLeft}日・1日 ${yen(Math.max(0, Math.floor(v.R / v.daysLeft)))}円` : ""}</div>
          </div>
        </div>
        {v.T > 0 && <Bar budget={v.T} used={v.U} planned={v.P} />}
        <h2 style={{ marginTop: 16 }}>{label}の出し方 <small>タップすると設定で直せます</small></h2>
        <button className="panel scroll" onClick={() => go("settings")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", width: "100%" }}>
          <table className="tbl">
            <tbody>
              <tr><td>給与</td><td className="num">{money(b.salary)}</td></tr>
              {b.extra !== 0 && <tr><td>＋ 追加予算（イベチケなど）</td><td className="num">{money(b.extra)}</td></tr>}
              <tr><td>− 固定費（家賃・奨学金・通信・サブスクなど）</td><td className="num">{money(b.fixed)}</td></tr>
              <tr><td>− 目標用マイナス（リボの返済・積立）{b.goalManual && <span className="note">（この月だけ直した額）</span>}</td><td className="num">{money(b.goal)}</td></tr>
              {v.fixedOver > 0 && <tr><td>（固定費が見込みをこえた分 {yen(v.fixedOver)}円 は、残り予算から引いています）</td><td /></tr>}
            </tbody>
            <tfoot><tr><td>＝ {label}</td><td className="num">{money(b.T)}</td></tr></tfoot>
          </table>
        </button>
        {v.overAllocated && <div className="alert">費目の予算の合計が、今月の予算を {yen(-v.reserveBudget)}円 こえています。「設定」の予算を見直してください。</div>}
      </section>

      {current && (
        <section>
          <h2>口座の今後の動き</h2>
          <AccountFlow data={data} today={today} go={go} open={open} />
        </section>
      )}

      {v.when !== "past" && (
        <section>
          <h2>使ったものを入れる <small>三井はメールから自動で入ります</small></h2>
          <QuickForm store={store} data={data} today={today} />
        </section>
      )}

      <section>
        <h2>{ACCOUNT_GROUP_LABEL.variable} <small>（）内は予定・タップで明細</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>予算</th><th>使った</th><th>残り</th>{v.when !== "past" && <th>1日あたり</th>}</tr></thead>
            <tbody>
              {rows.filter((r) => !r.fixed).map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}{r.unclassified > 0 && <> <Chip kind="warn">未分類 {yen(r.unclassified)}</Chip></>}</td>
                  <td className="num">{money(r.budget)}</td>
                  <td className="num"><Spent used={r.used} planned={r.planned} /></td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{money(r.rem)}</td>
                  {v.when !== "past" && <td className="num"><b>{r.daily == null ? "―" : money(r.daily)}</b></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>{total(rows.filter((r) => !r.fixed), v.when !== "past")}</tfoot>
          </table>
        </div>
        {v.unclassified.length > 0 && <button className="alert" onClick={() => go("ledger")}>未分類の明細が {v.unclassified.length} 件あります（予備で数えています）。タップして費目を入れてください。</button>}
      </section>

      <section>
        <h2>{ACCOUNT_GROUP_LABEL.fixed} <small>（）内は予定・見込みを給与から引いてある</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>見込み</th><th>使った</th><th>これから</th></tr></thead>
            <tbody>
              {rows.filter((r) => r.fixed).map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}</td>
                  <td className="num">{money(r.budget)}</td>
                  <td className="num"><Spent used={r.used} planned={r.planned} /></td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{r.rem < 0 ? `超過 ${money(-r.rem)}` : money(Math.max(0, r.budget - r.used))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>{total(rows.filter((r) => r.fixed), false, true)}</tfoot>
          </table>
        </div>
      </section>

      <NextMonth data={data} month={month} onOpen={onOpen} />
    </>
  );
}
