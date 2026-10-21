import { Fragment, useState } from "react";
import { addDays, addMonths, balanceAfterDebits, budgetCats, computeMonth, debitLines, debitsFor, dipBefore, nextMonthDebits, RESERVE, type CardDebit, type DebitLine } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Bar, Chip, Field, fromPayKey, md, NumInput, payKeys, payLabels, QUICK_METHODS, Select, signed, toast, yen } from "./common";

interface Props {
  store: Store;
  data: AppData;
  month: string;
  today: string;
  reviews: number;
  go: (to: "ledger" | "review" | "passbook" | "balance" | "settings", cat?: string) => void;
}

function QuickForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const cats = budgetCats(data.settings).filter((c) => c !== RESERVE);
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const st = data.settings;
  const [pay, setPay] = useState("cash");
  const [more, setMore] = useState(false);
  const [date, setDate] = useState(today);
  const [item, setItem] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!amount) { toast("金額を入れてください"); return; }
    setBusy(true);
    const { method, card } = fromPayKey(pay);
    const ok = await store.run(() => actions.addEntry({ kind: "expense", status: "confirmed", date, amount, method, card, category: cat, item, shop }));
    setBusy(false);
    if (ok) {
      toast(pay === payKeys(st, ["card"])[0] ? `${cat} ${yen(amount)}円を入れました。カードのメールが来たら自動でまとめます` : `${cat} ${yen(amount)}円を入れました`);
      setAmount(""); setItem(""); setShop(""); setDate(today); setMore(false);
    }
  };

  return (
    <div className="panel quick">
      <div className="grid2">
        <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <div className="seg" role="group" aria-label="金種">
        {payKeys(st, QUICK_METHODS).map((k) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{payLabels(st)[k]}</button>)}
      </div>
      {more && (
        <>
          <div className="grid2">
            <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="お店"><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>
          </div>
          <Field label="買ったもの"><input value={item} onChange={(e) => setItem(e.target.value)} /></Field>
        </>
      )}
      <div className="btns">
        <button className="btn" onClick={add} disabled={busy}>入れる</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>日付・お店も入れる</button>}
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
      <td className="num">{yen(sum((r) => r.budget))}</td>
      <td className="num">{yen(sum((r) => r.used))}{sum((r) => r.planned) ? <span className="note">＋{yen(sum((r) => r.planned))}</span> : null}</td>
      <td className={`num ${rem < 0 ? "neg" : ""}`}>{fixed ? yen(sum((r) => Math.max(0, r.budget - r.used))) : signed(rem)}</td>
      {daily && <td />}
    </tr>
  );
}

/** 来月の支払い予定：来月に口座から出る引き落としを、固定費／変動費／返済に分ける（§5.8） */
function NextMonth({ data, month }: { data: AppData; month: string }) {
  const n = nextMonthDebits(data, addMonths(month, 1));
  const m = +n.ym.slice(5), cur = +month.slice(5);
  const rows: [string, number][] = [
    [`固定費：カード（${cur}月に使う家賃など）`, n.cardFixed],
    ["固定費：口座から直接（奨学金・共済など）", n.directFixed],
    [`変動費：カード（${cur}月の使った＋予定）`, n.cardVar],
    ["リボ・分割の返済", n.repay],
    ...(n.other ? [["そのほか（予算外など）", n.other] as [string, number]] : []),
  ];
  return (
    <section>
      <h2>来月の支払い予定 <small>{m}月に口座から出るお金</small></h2>
      <div className="panel scroll">
        <table className="tbl">
          <thead><tr><th>項目</th><th>金額</th></tr></thead>
          <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{yen(v)}</td></tr>)}</tbody>
          <tfoot><tr><td>計</td><td className="num">{yen(n.total)}</td></tr></tfoot>
        </table>
        <div className="note">カードの変動費は、{cur}月にこれからカードで使う分だけ増えます。</div>
      </div>
    </section>
  );
}

/** 今月の引き落とし：その月に口座から出るもの。カードは前の月の利用から見込みを出し、請求額が分かれば確定にする */
function Debits({ store, data, month, today }: { store: Store; data: AppData; month: string; today: string }) {
  const x = debitsFor(data, month);
  const lines = debitLines(x);
  const [edit, setEdit] = useState<CardDebit | null>(null);
  const [val, setVal] = useState<number | "">("");
  const current = month === today.slice(0, 7);
  const saveBill = async (c: CardDebit, amount: number | null) => {
    const id = data.cardBills.find((b) => b.card === c.card.id && b.pay_date === c.date)?.id;
    if (await store.run(() => actions.saveBill(c.card.id, c.date, amount, id))) { toast(amount == null ? "見込みに戻しました" : `${c.card.name}の請求額を確定にしました`); setEdit(null); }
  };
  const chip = (s: DebitLine["state"]) => <Chip kind={s === "確定" ? "ok" : "warn"}>{s}</Chip>;
  return (
    <section>
      <h2>{current ? "今月の引き落とし" : `${+month.slice(5)}月の引き落とし`} <small>口座から出るお金・カードの行をタップで請求額を入れる</small></h2>
      <div className="panel scroll">
        <table className="tbl">
          <thead><tr><th>日</th><th style={{ textAlign: "left" }}>項目</th><th>金額</th><th>状態</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={l.card ? "tap" : ""} onClick={l.card ? () => { setEdit(l.card!); setVal(l.card!.bill ?? l.card!.estimate); } : undefined}>
                <td className="num">{md(l.date)}</td>
                <td style={{ textAlign: "left" }}>{l.label}</td>
                <td className="num">{yen(l.amount)}</td>
                <td>{chip(l.state)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td /><td style={{ textAlign: "left" }}>合計</td><td className="num">{yen(x.total)}</td><td /></tr></tfoot>
        </table>
        {x.cards.filter((c) => c.bill != null && c.items.length > 0 && c.bill !== c.estimate).map((c) => (
          <div className="note" key={c.card.id}>{c.card.name}：請求額 {yen(c.bill!)}円 と明細・予定の合計 {yen(c.estimate)}円 の差 {signed(c.bill! - c.estimate)}円（入っていない明細があるかもしれません）</div>
        ))}
        {edit && (
          <div style={{ marginTop: 8 }}>
            <Field label={`${edit.card.name}（${md(edit.date)}）の請求額（返済を含む合計）`}><NumInput value={val} onChange={setVal} /></Field>
            <div className="btns">
              <button className="btn sm" onClick={() => val !== "" && saveBill(edit, val)}>確定にする</button>
              {edit.bill != null && <button className="btn ghost sm" onClick={() => saveBill(edit, null)}>見込みに戻す</button>}
              <button className="btn ghost sm" onClick={() => setEdit(null)}>やめる</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** 口座の今後の動き：いまの残高から、今月これからの引き落とし・次の給料日の前日までの引き落としを引く（§5.9） */
function AccountFlow({ data, today, go }: { data: AppData; today: string; go: Props["go"] }) {
  const x = balanceAfterDebits(data, today);
  if (!x) return <button className="panel" onClick={() => go("balance")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}><div className="note">口座の残高を入れると、引き落としのあとと、次の給料日の前日に残る額を出します。タップで入れる</div></button>;
  const pd = addDays(x.payday, -1);
  const neg = (n: number) => `num ${n < 0 ? "neg" : ""}`;
  return (
    <>
      <div className="cards">
        <div className="kpi tap" onClick={() => go("balance")} style={{ cursor: "pointer" }}>
          <div className="lb">口座残高（いま）</div>
          <div className="v num">{yen(x.now.bank)}<small>円</small></div>
          <div className="note">財布 {yen(x.now.cash)}円・タップで直す</div>
        </div>
        <div className={`kpi ${x.beforePayday < 0 ? "bad" : "main"}`}>
          <div className="lb">給料日の前日（{md(pd)}）に残る額</div>
          <div className="v num">{signed(x.beforePayday)}<small>円</small></div>
          <div className="note" style={{ color: "inherit", opacity: .85 }}>{x.beforePayday < 0 ? "引き落としに足りません。先に入金が必要です" : `次の給料日 ${md(x.payday)}`}</div>
        </div>
      </div>
      <div className="panel scroll">
        <table className="tbl">
          <thead><tr><th>日</th><th style={{ textAlign: "left" }}>内容</th><th>入出金</th><th>残高</th></tr></thead>
          <tbody>
            <tr><td className="num">{md(today)}</td><td style={{ textAlign: "left" }}>口座残高（いま）</td><td /><td className="num">{yen(x.now.bank)}</td></tr>
            {x.rows.map((r, i) => {
              const monthEnd = r.date.slice(0, 7) === today.slice(0, 7) && x.rows[i + 1]?.date.slice(0, 7) !== today.slice(0, 7);
              return (
                <Fragment key={i}>
                  <tr>
                    <td className="num">{md(r.date)}</td>
                    <td style={{ textAlign: "left" }}>{r.label}{r.state !== "確定" && <> <Chip kind="warn">{r.state}</Chip></>}</td>
                    <td className={`num ${r.delta < 0 ? "neg" : ""}`}>{r.delta > 0 ? "＋" : "−"}{yen(Math.abs(r.delta))}</td>
                    <td className={neg(r.balance)}>{signed(r.balance)}</td>
                  </tr>
                  {monthEnd && <tr className="sum"><td /><td style={{ textAlign: "left" }}><b>今月の引き落としのあと</b></td><td /><td className={neg(x.afterThisMonth)}><b>{signed(x.afterThisMonth)}</b></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot><tr><td className="num">{md(pd)}</td><td style={{ textAlign: "left" }}>給料日の前日に残る額</td><td /><td className={neg(x.beforePayday)}>{signed(x.beforePayday)}</td></tr></tfoot>
        </table>
        <div className="note">給与は給料日に入るので入れていません。現金で使う分は口座が動かないので入っていません。カードで使った分は引落日に減ります。</div>
        <div className="btns">
          <button className="btn ghost sm" onClick={() => go("balance")}>残高を直す・ATM</button>
          <button className="btn ghost sm" onClick={() => go("passbook")}>口座の見通し</button>
        </div>
      </div>
    </>
  );
}

export function Dashboard({ store, data, month, today, reviews, go }: Props) {
  const v = computeMonth(data, month, today);
  const b = v.base;
  const rows = v.cats.filter((c) => c.budget || c.used || c.planned);
  // 口座の残高から見た「出金の予定に対して足りなくなる日」だけを警告に使う（口座からの計算はいったんここまで）
  const dip = v.when === "current" ? dipBefore(data, today) : null;
  const label = v.when === "past" ? "この月の予算" : v.when === "future" ? `${+month.slice(5)}月の予算` : "今月の予算";

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}

      <section>
        <div className="cards">
          <div className="kpi">
            <div className="lb">{label}</div>
            <div className="v num">{signed(v.T)}<small>円</small></div>
            <div className="note">変動費で使った {yen(v.U)}・予定 {yen(v.P)}</div>
          </div>
          <div className={`kpi ${v.R < 0 || dip ? "bad" : "main"}`}>
            <div className="lb">自由に使える残り</div>
            <div className="v num">{signed(v.R)}<small>円</small></div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>{dip ? `${md(dip.date)}に口座が足りません。先に入金が必要です` : v.R < 0 ? "予算をこえています" : v.daysLeft ? `残り${v.daysLeft}日・1日 ${yen(Math.max(0, Math.floor(v.R / v.daysLeft)))}円` : ""}</div>
          </div>
        </div>
        {v.T > 0 && <Bar budget={v.T} used={v.U} planned={v.P} />}
        <h2 style={{ marginTop: 16 }}>{label}の出し方 <small>タップすると設定で直せます</small></h2>
        <button className="panel scroll" onClick={() => go("settings")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", width: "100%" }}>
          <table className="tbl">
            <tbody>
              <tr><td>給与</td><td className="num">{yen(b.salary)}</td></tr>
              {b.extra !== 0 && <tr><td>＋ 追加予算（イベチケなど）</td><td className="num">{yen(b.extra)}</td></tr>}
              <tr><td>− 固定費（家賃・奨学金・通信・サブスクなど）</td><td className="num">{yen(b.fixed)}</td></tr>
              <tr><td>− 目標用マイナス（リボの返済・貯金）</td><td className="num">{yen(b.goal)}</td></tr>
            </tbody>
            <tfoot><tr><td>＝ {label}</td><td className="num">{signed(b.T)}</td></tr></tfoot>
          </table>
        </button>
      </section>

      {v.when !== "past" && (
        <section>
          <h2>口座の今後の動き</h2>
          <AccountFlow data={data} today={today} go={go} />
        </section>
      )}

      <section>
        {dip && <div className="alert bad">{md(dip.date)}に口座が {signed(dip.value)}円 になる見込みです。出金の予定に対して {yen(data.settings.safety - dip.value)}円 足りません。それまでに入金するか、引落の予定を確かめてください。</div>}
        {v.overAllocated && <div className="alert">費目の予算の合計が、今月の予算を {yen(-v.reserveBudget)}円 こえています。「設定」の予算を見直してください。</div>}
      </section>

      {v.when !== "past" && (
        <section>
          <h2>使ったものを入れる <small>カードはメールから自動で入ります</small></h2>
          <QuickForm store={store} data={data} today={today} />
        </section>
      )}

      <section>
        <h2>変動費 <small>自由に使えるお金から使う・タップで明細</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>予算</th><th>使った＋予定</th><th>残り</th>{v.when !== "past" && <th>1日あたり</th>}</tr></thead>
            <tbody>
              {rows.filter((r) => !r.fixed).map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}{r.unclassified > 0 && <> <Chip kind="warn">未分類 {yen(r.unclassified)}</Chip></>}</td>
                  <td className="num">{yen(r.budget)}</td>
                  <td className="num">{yen(r.used)}{r.planned ? <span className="note">＋{yen(r.planned)}</span> : null}</td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{signed(r.rem)}</td>
                  {v.when !== "past" && <td className="num"><b>{r.daily == null ? "―" : yen(r.daily)}</b></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>{total(rows.filter((r) => !r.fixed), v.when !== "past")}</tfoot>
          </table>
        </div>
        {v.unclassified.length > 0 && <button className="alert" onClick={() => go("ledger")}>未分類の明細が {v.unclassified.length} 件あります（予備で数えています）。タップして費目を入れてください。</button>}
      </section>

      <section>
        <h2>固定費 <small>見込み {yen(b.fixed)}円 を給与から引いてある</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>見込み</th><th>引かれた＋予定</th><th>これから</th></tr></thead>
            <tbody>
              {rows.filter((r) => r.fixed).map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}</td>
                  <td className="num">{yen(r.budget)}</td>
                  <td className="num">{yen(r.used)}{r.planned ? <span className="note">＋{yen(r.planned)}</span> : null}</td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{r.rem < 0 ? `超過 ${yen(-r.rem)}` : yen(Math.max(0, r.budget - r.used))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>{total(rows.filter((r) => r.fixed), false, true)}</tfoot>
          </table>
        </div>
        {v.fixedOver > 0 && <div className="alert">固定費が見込みを {yen(v.fixedOver)}円 こえたので、その分を自由に使える残りから引いています。</div>}
      </section>

      <NextMonth data={data} month={month} />
      <Debits store={store} data={data} month={month} today={today} />

    </>
  );
}
